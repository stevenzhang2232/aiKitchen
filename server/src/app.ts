import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import { openDb, wipeUserData, type Db } from './db.js';
import { Store } from './store.js';
import { HttpError } from './errors.js';
import { registerFridgeRoutes } from './routes/fridge.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerCookRoutes } from './routes/cook.js';
import { registerBackupRoutes } from './routes/backup.js';
import { AiConfigStore, capabilities, DEFAULT_AI_CONFIG } from './ai/config.js';
import { RealAiService, type AiService } from './ai/service.js';
import { MockAiService } from './ai/mock.js';
import { ShelfLifeWorker } from './ai/shelfLifeWorker.js';

export type AiMode = 'auto' | 'mock' | 'off';

export interface AppOptions {
  dataDir: string;
  webDist?: string;
  logger?: boolean;
  now?: () => Date;
  /** auto = use the configured provider; mock = built-in test AI; off = no AI. Defaults to env AI_MOCK. */
  aiMode?: AiMode;
}

export interface AppContext {
  db: Db;
  store: Store;
  dataDir: string;
  config: AiConfigStore;
  mock: MockAiService;
  worker: ShelfLifeWorker;
  getAi: () => AiService | null;
  setAiMode: (m: AiMode) => void;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  fs.mkdirSync(opts.dataDir, { recursive: true });
  const db = openDb(opts.dataDir);
  const config = new AiConfigStore(opts.dataDir);
  const real = new RealAiService(() => config.get());
  const mock = new MockAiService();
  let aiMode: AiMode = opts.aiMode ?? (process.env.AI_MOCK === '1' ? 'mock' : 'auto');
  const getAi = (): AiService | null => {
    if (aiMode === 'off') return null;
    if (aiMode === 'mock') return mock;
    return capabilities(config.get()).configured ? real : null;
  };
  const aiInfo = () => {
    if (aiMode === 'mock') return { configured: true, search: true, vision: true, model: 'built-in test AI' };
    if (aiMode === 'off') return { configured: false, search: false, vision: false, model: '' };
    return capabilities(config.get());
  };

  const store = new Store(db, { now: opts.now, aiEnabled: () => getAi() !== null });
  const worker = new ShelfLifeWorker(store, getAi);
  store.onNeedsShelfLife = (id) => worker.enqueue(id);

  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 15 * 1024 * 1024 });
  app.decorate('ctx', {
    db, store, dataDir: opts.dataDir, config, mock, worker, getAi,
    setAiMode: (m: AiMode) => {
      aiMode = m;
    },
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      reply.code(err.status).send({ error: err.message, code: err.code });
      return;
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      reply.code(status).send({ error: (err as Error).message });
      return;
    }
    app.log.error(err);
    reply.code(500).send({ error: 'Something went wrong on this computer. Try again.' });
  });

  app.addHook('onClose', async () => {
    await Promise.race([worker.idle(), new Promise((r) => setTimeout(r, 2000))]);
    db.close();
  });

  app.get('/api/health', async () => ({ ok: true }));
  if (process.env.FRIDGE_TEST_HOOKS === '1') {
    // Only for automated end-to-end tests.
    app.post('/api/test/reset', async () => {
      await worker.idle();
      wipeUserData(db);
      config.save({ ...DEFAULT_AI_CONFIG });
      mock.offline = false;
      aiMode = 'off';
      return { ok: true };
    });
    app.post<{ Body: { mode?: string } }>('/api/test/ai', async (req) => {
      const m = req.body?.mode;
      if (m === 'offline') {
        aiMode = 'mock';
        mock.offline = true;
      } else if (m === 'mock' || m === 'off' || m === 'auto') {
        aiMode = m;
        mock.offline = false;
      }
      return { ok: true };
    });
  }
  registerFridgeRoutes(app, store, () => ({ ai: aiInfo() }));
  registerAiRoutes(app, { store, config, getAi, worker });
  registerCookRoutes(app, { store, getAi });
  registerBackupRoutes(app, { db, store, dataDir: opts.dataDir, worker });

  if (opts.webDist && fs.existsSync(opts.webDist)) {
    await app.register(fastifyStatic, { root: opts.webDist, wildcard: false });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || !opts.webDist || !fs.existsSync(opts.webDist)) {
      reply.code(404).send({ error: 'Not found' });
    } else {
      reply.sendFile('index.html');
    }
  });

  worker.resumePending();
  return app;
}
