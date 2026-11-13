import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';

export interface AppOptions {
  dataDir: string;
  webDist?: string;
  logger?: boolean;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  fs.mkdirSync(opts.dataDir, { recursive: true });
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 15 * 1024 * 1024 });

  app.get('/api/health', async () => ({ ok: true }));

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
