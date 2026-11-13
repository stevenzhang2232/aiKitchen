import { describe, it, expect, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRoot } from '../src/paths';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fridge-proc-'));
const port = 5191;
const base = `http://127.0.0.1:${port}`;
let child: ChildProcess | null = null;

function start(): Promise<void> {
  child = spawn(process.execPath, [path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(repoRoot, 'server', 'src', 'main.ts')], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), AI_MOCK: '' },
    stdio: 'ignore',
  });
  return (async () => {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) return;
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error('server did not start');
  })();
}

async function stop() {
  if (!child) return;
  const c = child;
  child = null;
  const exited = new Promise((r) => c.once('exit', r));
  c.kill('SIGKILL');
  await exited;
}

afterAll(async () => {
  await stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('real server process (acceptance 2)', () => {
  it('keeps data after the process is killed and started again', async () => {
    await start();
    const state = await (await fetch(`${base}/api/state`)).json();
    const tomato = state.foods.find((f: { name: string }) => f.name === 'Tomato').id;
    const r = await fetch(`${base}/api/batches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foodId: tomato, qty: 4, unit: 'pcs', expiryDate: '2030-01-01' }),
    });
    expect(r.ok).toBe(true);
    // Hard kill, like closing the window or a power cut.
    await stop();
    await start();
    const after = await (await fetch(`${base}/api/state`)).json();
    expect(after.batches).toHaveLength(1);
    expect(after.batches[0]).toMatchObject({ foodId: tomato, qty: 4, expiryDate: '2030-01-01' });
    expect(fs.existsSync(path.join(dir, 'fridge.db'))).toBe(true);
  }, 60_000);
});
