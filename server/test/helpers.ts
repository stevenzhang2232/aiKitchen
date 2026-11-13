import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppOptions } from '../src/app';

export interface TestApp {
  app: FastifyInstance;
  dir: string;
  clock: { now: Date };
  call: <T = any>(method: string, url: string, body?: unknown) => Promise<{ status: number; body: T }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  state: () => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  foodId: (name: string) => Promise<number>;
  restart: (extra?: Partial<AppOptions>) => Promise<void>;
  close: () => Promise<void>;
}

export async function makeApp(extra: Partial<AppOptions> = {}, dir?: string): Promise<TestApp> {
  const root = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'fridge-test-'));
  const clock = { now: new Date(2026, 10, 12, 10, 0, 0) };
  const t: TestApp = {
    app: null as unknown as FastifyInstance,
    dir: root,
    clock,
    async call(method, url, body) {
      const res = await t.app.inject({ method: method as 'GET', url, payload: body as object | undefined });
      return { status: res.statusCode, body: res.body ? res.json() : (undefined as never) };
    },
    async state() {
      return (await t.call('GET', '/api/state')).body;
    },
    async foodId(name) {
      const s = await t.state();
      const f = s.foods.find((x: { name: string }) => x.name === name);
      if (!f) throw new Error(`no food ${name}`);
      return f.id;
    },
    async restart(more = {}) {
      await t.app.close();
      t.app = await buildApp({ dataDir: path.join(root, 'data'), now: () => clock.now, ...extra, ...more });
    },
    async close() {
      await t.app.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
  t.app = await buildApp({ dataDir: path.join(root, 'data'), now: () => clock.now, ...extra });
  return t;
}
