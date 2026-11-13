import type { Source } from '@kitchen/core';
import type { AiConfig } from './config.js';
import { isDashscope } from './config.js';

export type ChatContent = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: ChatContent;
}

export interface ChatOptions {
  model?: string;
  messages: ChatMessage[];
  search?: boolean;
  json?: boolean;
  timeoutMs?: number;
  temperature?: number;
}

export interface ChatResult {
  content: string;
  sources: Source[];
}

export class AiError extends Error {
  constructor(
    message: string,
    public kind: 'auth' | 'network' | 'timeout' | 'provider' | 'format',
  ) {
    super(message);
  }
}

function extractSources(body: Record<string, unknown>): Source[] {
  const out: Source[] = [];
  const candidates = [
    (body.search_info as { search_results?: unknown[] } | undefined)?.search_results,
    ((body.output as Record<string, unknown> | undefined)?.search_info as { search_results?: unknown[] } | undefined)?.search_results,
  ];
  for (const list of candidates) {
    if (!Array.isArray(list)) continue;
    for (const r of list as Record<string, unknown>[]) {
      const url = typeof r.url === 'string' ? r.url : '';
      if (/^https?:\/\//.test(url)) out.push({ title: typeof r.title === 'string' ? r.title : url, url });
    }
  }
  return out;
}

/** Minimal client for OpenAI-compatible chat completion APIs (Qwen/DashScope, DeepSeek, Kimi, ...). */
export async function chat(cfg: AiConfig, opts: ChatOptions): Promise<ChatResult> {
  const body: Record<string, unknown> = {
    model: opts.model ?? cfg.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
  };
  const searching = !!opts.search && isDashscope(cfg);
  // Qwen does not allow JSON mode together with web search, so JSON is requested in the prompt instead.
  if (opts.json && !searching) body.response_format = { type: 'json_object' };
  if (searching) {
    body.enable_search = true;
    body.search_options = { forced_search: true, enable_source: true };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new AiError('The AI service took too long to answer.', 'timeout');
    throw new AiError('Couldn’t reach the AI service. Check your internet connection.', 'network');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // Not JSON; handled below.
  }
  if (!res.ok) {
    const detail = ((data.error as { message?: string } | undefined)?.message ?? (data.message as string | undefined) ?? '').slice(0, 200);
    if (res.status === 401 || res.status === 403) {
      throw new AiError(`The API key was rejected (${res.status}). Check the key in Settings → AI model.${detail ? ` ${detail}` : ''}`, 'auth');
    }
    if (res.status === 404) throw new AiError(`The model or address was not found (404). Check the model name and address.${detail ? ` ${detail}` : ''}`, 'provider');
    if (res.status === 429) throw new AiError('The AI service is busy or your quota is used up (429). Try again later.', 'provider');
    throw new AiError(`The AI service returned an error (${res.status}).${detail ? ` ${detail}` : ''}`, 'provider');
  }
  const choice = (data.choices as { message?: { content?: unknown } }[] | undefined)?.[0];
  const content = choice?.message?.content;
  if (typeof content !== 'string') throw new AiError('The AI service sent an empty answer.', 'format');
  return { content, sources: extractSources(data) };
}

/** Pull the first JSON object out of a model answer (handles ```json fences and extra text). */
export function parseJsonAnswer<T = unknown>(content: string): T {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = fenced ? fenced[1] : content;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new AiError('The AI answer was not in the expected format.', 'format');
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    throw new AiError('The AI answer was not in the expected format.', 'format');
  }
}
