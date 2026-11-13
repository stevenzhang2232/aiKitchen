import type { FastifyInstance } from 'fastify';
import { findFoodByName, isUnit, type Unit } from '@kitchen/core';
import type { Store } from '../store.js';
import { AiError } from '../ai/client.js';
import { capabilities, maskKey, type AiConfigStore } from '../ai/config.js';
import type { AiService } from '../ai/service.js';
import type { ShelfLifeWorker } from '../ai/shelfLifeWorker.js';
import { bad, HttpError } from '../errors.js';

type Body = Record<string, unknown>;

export function aiErrorToHttp(err: unknown): never {
  if (err instanceof AiError) throw new HttpError(err.kind === 'auth' ? 400 : 502, err.message, `ai-${err.kind}`);
  throw err;
}

export function registerAiRoutes(
  app: FastifyInstance,
  deps: { store: Store; config: AiConfigStore; getAi: () => AiService | null; worker: ShelfLifeWorker },
) {
  const { store, config, getAi, worker } = deps;

  const requireAi = () => {
    const ai = getAi();
    if (!ai) throw new HttpError(400, 'Set up an AI model in Settings → AI model first.', 'ai-not-configured');
    return ai;
  };

  app.get('/api/ai-config', async () => {
    const cfg = config.get();
    return { ...cfg, apiKey: '', apiKeyMasked: maskKey(cfg.apiKey), hasKey: !!cfg.apiKey, capabilities: capabilities(cfg) };
  });

  app.put<{ Body: Body }>('/api/ai-config', async (req) => {
    const b = req.body ?? {};
    try {
      const next = config.save({
        baseUrl: b.baseUrl as string | undefined,
        // An empty key field means "keep the saved key" unless clearKey is set.
        apiKey: b.clearKey === true ? '' : typeof b.apiKey === 'string' && b.apiKey.trim() ? b.apiKey : undefined,
        model: b.model as string | undefined,
        visionModel: b.visionModel as string | undefined,
        webSearch: b.webSearch as boolean | undefined,
      });
      worker.resumePending();
      return { ok: true, capabilities: capabilities(next) };
    } catch (e) {
      bad((e as Error).message);
    }
  });

  app.post('/api/ai-config/test', async () => {
    const ai = requireAi();
    try {
      return { ok: true, message: await ai.testConnection() };
    } catch (e) {
      aiErrorToHttp(e);
    }
  });

  app.post<{ Params: { id: string } }>('/api/batches/:id/shelf-life', async (req) => {
    requireAi();
    const id = Number(req.params.id);
    const b = store.batch(id);
    store.clearShelfLifeCache(b.foodId, b.location);
    store.markShelfLifeLookup(id);
    worker.enqueue(id);
    return { ok: true };
  });

  app.post<{ Body: Body }>('/api/receipt/read', async (req) => {
    const ai = requireAi();
    if (!capabilities(config.get()).vision && ai.kind === 'real') {
      throw new HttpError(400, 'The current AI model can’t read images. Add a vision model in Settings → AI model.', 'ai-no-vision');
    }
    const image = req.body?.image;
    if (typeof image !== 'string' || !/^data:image\/(png|jpe?g|webp|gif|bmp);base64,/i.test(image)) bad('Choose a photo (JPG, PNG or WebP).');
    let lines;
    try {
      lines = await ai.readReceipt(image);
    } catch (e) {
      aiErrorToHttp(e);
    }
    const foods = store.foods();
    return {
      items: lines.map((l) => {
        const match = findFoodByName(foods, l.name);
        return {
          name: l.name,
          foodId: match?.id ?? null,
          matchedName: match?.name ?? null,
          isSeasoning: match?.isSeasoning ?? false,
          qty: l.qty,
          unit: l.unit,
        };
      }),
    };
  });

  /** Add the reviewed receipt lines. Unknown names become custom ingredients. */
  app.post<{ Body: Body }>('/api/receipt/add', async (req) => {
    const items = req.body?.items;
    if (!Array.isArray(items) || !items.length) bad('Nothing to add.');
    const resolved = (items as Body[]).map((it) => {
      let foodId = it.foodId == null ? null : Number(it.foodId);
      if (foodId == null) {
        const name = typeof it.name === 'string' ? it.name : '';
        foodId = store.createFood({ name, category: 'other' }).id;
      }
      const unit = it.unit as Unit;
      if (!isUnit(unit)) bad(`Choose a unit for ${String(it.name)}.`);
      return { foodId, qty: Number(it.qty), unit };
    });
    return store.addMany(resolved);
  });
}
