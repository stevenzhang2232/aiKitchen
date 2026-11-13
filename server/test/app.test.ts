import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

let dir: string;
let app: FastifyInstance;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fridge-app-'));
  const webDist = path.join(dir, 'dist');
  fs.mkdirSync(webDist);
  fs.writeFileSync(path.join(webDist, 'index.html'), '<html>app</html>');
  app = await buildApp({ dataDir: path.join(dir, 'data'), webDist });
});
afterAll(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('app skeleton', () => {
  it('reports health', async () => {
    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
  it('creates the data folder', () => {
    expect(fs.existsSync(path.join(dir, 'data'))).toBe(true);
  });
  it('serves the web app for page routes (SPA fallback)', async () => {
    const res = await app.inject('/settings');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('app');
  });
  it('returns JSON 404 for unknown API routes', async () => {
    const res = await app.inject('/api/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBeTruthy();
  });
});
