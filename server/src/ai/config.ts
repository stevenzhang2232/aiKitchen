import fs from 'node:fs';
import path from 'node:path';

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Model used to read receipt photos. Empty = receipt scanning unavailable. */
  visionModel: string;
  /** Ask the provider to search the web (only supported by DashScope / Qwen). */
  webSearch: boolean;
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: '',
  model: 'qwen-plus',
  visionModel: 'qwen-vl-plus',
  webSearch: true,
};

export function isDashscope(cfg: Pick<AiConfig, 'baseUrl'>): boolean {
  return /dashscope/i.test(cfg.baseUrl);
}

export interface AiCapabilities {
  configured: boolean;
  search: boolean;
  vision: boolean;
  model: string;
}

export function capabilities(cfg: AiConfig): AiCapabilities {
  const configured = !!cfg.apiKey && !!cfg.baseUrl && !!cfg.model;
  return {
    configured,
    search: configured && cfg.webSearch && isDashscope(cfg),
    vision: configured && !!cfg.visionModel,
    model: cfg.model,
  };
}

export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 3)}••••${key.slice(-4)}`;
}

/** The API key lives in data/config.json only; it is never put in backups. */
export class AiConfigStore {
  private file: string;
  private cfg: AiConfig;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'config.json');
    this.cfg = { ...DEFAULT_AI_CONFIG };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && typeof raw === 'object' && raw.ai) this.cfg = { ...DEFAULT_AI_CONFIG, ...raw.ai };
    } catch {
      // No config yet.
    }
  }

  get(): AiConfig {
    return { ...this.cfg };
  }

  save(next: Partial<AiConfig>): AiConfig {
    const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined);
    const merged: AiConfig = {
      baseUrl: (clean(next.baseUrl) ?? this.cfg.baseUrl).replace(/\/+$/, ''),
      apiKey: clean(next.apiKey) ?? this.cfg.apiKey,
      model: clean(next.model) ?? this.cfg.model,
      visionModel: clean(next.visionModel) ?? this.cfg.visionModel,
      webSearch: typeof next.webSearch === 'boolean' ? next.webSearch : this.cfg.webSearch,
    };
    if (merged.baseUrl && !/^https?:\/\//i.test(merged.baseUrl)) throw new Error('The provider address must start with http:// or https://');
    this.cfg = merged;
    fs.writeFileSync(this.file, `${JSON.stringify({ ai: merged }, null, 2)}\n`, { mode: 0o600 });
    return this.get();
  }
}
