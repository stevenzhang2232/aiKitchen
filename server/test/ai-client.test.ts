import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chat, parseJsonAnswer, AiError } from '../src/ai/client';
import { RealAiService, recipePrompt } from '../src/ai/service';
import { DEFAULT_AI_CONFIG, capabilities, maskKey, type AiConfig } from '../src/ai/config';

interface Seen {
  path: string;
  auth: string | undefined;
  body: Record<string, unknown>;
}

let server: http.Server;
let port: number;
let seen: Seen[] = [];
let reply: (body: Record<string, unknown>) => { status: number; json: unknown; delayMs?: number };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      const body = JSON.parse(data || '{}');
      seen.push({ path: req.url ?? '', auth: req.headers.authorization, body });
      const r = reply(body);
      setTimeout(() => {
        res.writeHead(r.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r.json));
      }, r.delayMs ?? 0);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  seen = [];
  reply = () => ({ status: 200, json: { choices: [{ message: { content: 'OK' } }] } });
});

function cfg(over: Partial<AiConfig> = {}): AiConfig {
  return { ...DEFAULT_AI_CONFIG, baseUrl: `http://127.0.0.1:${port}/dashscope/compatible-mode/v1`, apiKey: 'sk-test-123456', ...over };
}

const answer = (content: string, extra: Record<string, unknown> = {}) => ({ status: 200, json: { choices: [{ message: { content } }], ...extra } });

describe('OpenAI-compatible client', () => {
  it('sends the key, model and messages to /chat/completions', async () => {
    const r = await chat(cfg(), { messages: [{ role: 'user', content: 'hi' }] });
    expect(r.content).toBe('OK');
    expect(seen[0].path).toBe('/dashscope/compatible-mode/v1/chat/completions');
    expect(seen[0].auth).toBe('Bearer sk-test-123456');
    expect(seen[0].body).toMatchObject({ model: 'qwen-plus', messages: [{ role: 'user', content: 'hi' }] });
  });

  it('turns on Qwen web search with sources, and reads search results', async () => {
    reply = () => answer('{"days":3}', { search_info: { search_results: [{ title: 'FDA chart', url: 'https://www.fda.gov/x', index: 1 }, { title: 'bad', url: 'javascript:alert(1)' }] } });
    const r = await chat(cfg(), { messages: [{ role: 'user', content: 'q' }], search: true, json: true });
    expect(seen[0].body).toMatchObject({ enable_search: true, search_options: { forced_search: true, enable_source: true } });
    expect(seen[0].body.response_format).toBeUndefined();
    expect(r.sources).toEqual([{ title: 'FDA chart', url: 'https://www.fda.gov/x' }]);
  });

  it('does not send Qwen-only search flags to other providers', async () => {
    await chat(cfg({ baseUrl: `http://127.0.0.1:${port}/v1` }), { messages: [{ role: 'user', content: 'q' }], search: true, json: true });
    expect(seen[0].body.enable_search).toBeUndefined();
    expect(seen[0].body.response_format).toEqual({ type: 'json_object' });
  });

  it('explains a rejected key', async () => {
    reply = () => ({ status: 401, json: { error: { message: 'Incorrect API key provided.' } } });
    const err = await chat(cfg(), { messages: [{ role: 'user', content: 'q' }] }).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.kind).toBe('auth');
    expect(err.message).toMatch(/API key was rejected \(401\)/);
    expect(err.message).toMatch(/Incorrect API key/);
  });

  it('reports network failures and timeouts', async () => {
    const down = await chat(cfg({ baseUrl: 'http://127.0.0.1:9/v1' }), { messages: [{ role: 'user', content: 'q' }] }).catch((e) => e);
    expect(down.kind).toBe('network');
    reply = () => ({ ...answer('late'), delayMs: 500 });
    const slow = await chat(cfg(), { messages: [{ role: 'user', content: 'q' }], timeoutMs: 100 }).catch((e) => e);
    expect(slow.kind).toBe('timeout');
  });

  it('extracts JSON from fenced or chatty answers', () => {
    expect(parseJsonAnswer('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonAnswer('Sure! {"a":{"b":2}} Hope this helps')).toEqual({ a: { b: 2 } });
    expect(() => parseJsonAnswer('no json here')).toThrow(AiError);
  });

  it('reports capabilities and masks keys', () => {
    expect(capabilities(cfg())).toMatchObject({ configured: true, search: true, vision: true });
    expect(capabilities(cfg({ apiKey: '' })).configured).toBe(false);
    expect(capabilities(cfg({ baseUrl: 'https://api.deepseek.com/v1', visionModel: '' }))).toMatchObject({ search: false, vision: false });
    expect(maskKey('sk-abcdefghijkl')).toBe('sk-••••ijkl');
    expect(maskKey('')).toBe('');
  });
});

describe('real AI service', () => {
  it('estimates shelf life and prefers sources from the search', async () => {
    reply = () =>
      answer('{"days": 21, "conditions": "Whole eggs in the shell, refrigerated at 4°C.", "sources": [{"title":"Model cite","url":"https://example.com/eggs"}]}', {
        search_info: { search_results: [{ title: 'USDA egg storage', url: 'https://www.usda.gov/eggs' }] },
      });
    const ai = new RealAiService(() => cfg());
    const r = await ai.estimateShelfLife({ foodName: 'Egg', category: 'egg_dairy', location: 'fridge' });
    expect(r).toEqual({ days: 21, note: 'Whole eggs in the shell, refrigerated at 4°C.', sources: [{ title: 'USDA egg storage', url: 'https://www.usda.gov/eggs' }] });
    expect(JSON.stringify(seen[0].body.messages)).toMatch(/in the refrigerator/);
  });

  it('returns no date when the model has no reliable information', async () => {
    reply = () => answer('{"days": null, "conditions": "Not enough information.", "sources": []}');
    const r = await new RealAiService(() => cfg()).estimateShelfLife({ foodName: 'Mystery', category: 'other', location: 'pantry' });
    expect(r?.days).toBeNull();
  });

  it('marks answers from models without web search as having no sources', async () => {
    reply = () => answer('{"days": 3, "conditions": "Cooked rice in a sealed box.", "sources": [{"title":"x","url":"https://x.com"}]}');
    const r = await new RealAiService(() => cfg({ baseUrl: `http://127.0.0.1:${port}/v1` })).estimateShelfLife({ foodName: 'Rice', category: 'staple', location: 'fridge' });
    expect(r?.days).toBe(3);
    expect(r?.sources).toEqual([]);
    expect(r?.note).toMatch(/no web sources/);
  });

  it('reads a receipt with the vision model', async () => {
    reply = () => answer('{"items":[{"name":"Tomato","qty":3,"unit":"pcs"},{"name":"Pork belly","qty":500,"unit":"g"},{"name":"","qty":1,"unit":"pcs"}]}');
    const items = await new RealAiService(() => cfg()).readReceipt('data:image/png;base64,AAAA');
    expect(items).toEqual([{ name: 'Tomato', qty: 3, unit: 'pcs' }, { name: 'Pork belly', qty: 500, unit: 'g' }]);
    expect(seen[0].body.model).toBe('qwen-vl-plus');
    expect(JSON.stringify(seen[0].body.messages)).toContain('data:image/png;base64,AAAA');
  });

  it('refuses receipts when there is no vision model', async () => {
    const err = await new RealAiService(() => cfg({ visionModel: '' })).readReceipt('data:image/png;base64,AAAA').catch((e) => e);
    expect(err.message).toMatch(/can’t read images/);
  });

  it('asks for dishes and sends the rule problems back on retry', async () => {
    reply = () => answer('{"dishes":[{"name":"Egg soup","minutes":"10","servings":2,"ingredients":[{"foodId":"2","amount":2,"unit":"pcs"}],"seasonings":[20],"missing":[],"steps":["Boil water, add eggs."]}]}');
    const ai = new RealAiService(() => cfg());
    const ctx = {
      mode: 'suggest' as const, servings: 2, taste: { spice: 'mild' as const, avoid: ['cilantro'], cuisines: ['Cantonese'] },
      stock: [{ foodId: 2, name: 'Egg', category: 'egg_dairy' as const, kind: 'count' as const, amount: 4, unit: 'pcs' as const, expiresInDays: 1 }],
      seasonings: [{ foodId: 20, name: 'Salt' }],
    };
    const r = await ai.suggestDishes(ctx, { answer: '{"dishes":[]}', errors: ['Return between 1 and 3 dishes (got 0).'] });
    expect(r.dishes[0]).toMatchObject({ name: 'Egg soup', minutes: 10, ingredients: [{ foodId: 2, amount: 2, unit: 'pcs' }] });
    const msgs = seen[0].body.messages as { role: string; content: string }[];
    expect(msgs).toHaveLength(4);
    expect(msgs[3].content).toMatch(/broke these rules/);
    expect(msgs[1].content).toMatch(/2: Egg — 4 pcs — unit "pcs" — expires in 1 day\(s\) — USE FIRST/);
    expect(msgs[1].content).toMatch(/never use or suggest: cilantro/);
  });

  it('describes each mode in the prompt', () => {
    const base = { servings: 3, taste: null, stock: [], seasonings: [] };
    expect(recipePrompt({ ...base, mode: 'dish', dishName: 'Mapo tofu' })).toMatch(/wants to cook: "Mapo tofu"[\s\S]*missing/);
    expect(recipePrompt({ ...base, mode: 'pick' })).toMatch(/picked exactly the stock/);
    expect(recipePrompt({ ...base, mode: 'suggest' })).toMatch(/Prefer ingredients marked USE FIRST/);
  });
});
