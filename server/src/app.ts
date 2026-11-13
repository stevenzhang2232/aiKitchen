import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import { openDb, wipeUserData, type Db } from './db.js';
import { Store } from './store.js';
import { HttpError } from './errors.js';
import { registerFridgeRoutes } from './routes/fridge.js';

export interface AppOptions {
  dataDir: string;
  webDist?: string;
  logger?: boolean;
  now?: () => Date;
}

export interface AppContext {
  db: Db;
  store: Store;
  dataDir: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  fs.mkdirSync(opts.dataDir, { recursive: true });
  const db = openDb(opts.dataDir);
  const store = new Store(db, { now: opts.now });
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 15 * 1024 * 1024 });
  app.decorate('ctx', { db, store, dataDir: opts.dataDir });

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
    db.close();
  });

  app.get('/api/health', async () => ({ ok: true }));
  if (process.env.FRIDGE_TEST_HOOKS === '1') {
    // Only for automated end-to-end tests: start every test from an empty fridge.
    app.post('/api/test/reset', async () => {
      wipeUserData(db);
      return { ok: true };
    });
  }
  registerFridgeRoutes(app, store, () => ({}));

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
  return app;
}
