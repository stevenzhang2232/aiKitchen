import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeApp, type TestApp } from './helpers';

let t: TestApp;
afterEach(async () => {
  await t.close();
});

async function prepUnit(name: string, unit: string) {
  const id = await t.foodId(name);
  await t.call('POST', `/api/foods/${id}/unit`, { unit });
  return id;
}

describe('shelf-life suggestions (acceptance 5, 16)', () => {
  it('adds immediately, then fills in an AI date with sources in the background', async () => {
    t = await makeApp({ aiMode: 'mock' });
    const egg = await prepUnit('Egg', 'pcs');
    const r = await t.call('POST', `/api/foods/${egg}/quick-add`);
    expect(r.status).toBe(200);
    let b = (await t.state()).batches[0];
    expect(b.addedDate).toBe('2026-11-12');
    await t.app.ctx.worker.idle();
    b = (await t.state()).batches[0];
    expect(b).toMatchObject({ aiStatus: 'done', expirySource: 'ai', expiryDate: '2026-11-26' });
    expect(b.aiSources[0].url).toMatch(/^https:/);
    expect(b.aiNote).toMatch(/egg/);
  });

  it('reuses the answer for the same food and place without asking again', async () => {
    t = await makeApp({ aiMode: 'mock' });
    const egg = await t.foodId('Egg');
    await t.call('POST', '/api/batches', { foodId: egg, qty: 6, unit: 'pcs' });
    await t.app.ctx.worker.idle();
    t.clock.now = new Date(2026, 10, 15, 9);
    await t.call('POST', '/api/batches', { foodId: egg, qty: 6, unit: 'pcs' });
    const s = await t.state();
    expect(s.batches[1]).toMatchObject({ aiStatus: 'done', expiryDate: '2026-11-29' });
    expect(t.app.ctx.mock.calls.shelfLife).toBe(1);
  });

  it('keeps the user’s date when they entered one', async () => {
    t = await makeApp({ aiMode: 'mock' });
    const egg = await t.foodId('Egg');
    const { body } = await t.call('POST', '/api/batches', { foodId: egg, qty: 6, unit: 'pcs' });
    await t.call('POST', `/api/batches/${body.batchId}/expiry`, { expiryDate: '2026-11-14' });
    await t.app.ctx.worker.idle();
    expect((await t.state()).batches[0]).toMatchObject({ expiryDate: '2026-11-14', expirySource: 'user' });
  });

  it('records the date added and shows no suggestion when offline, then retries (acceptance 5, 9)', async () => {
    t = await makeApp({ aiMode: 'mock' });
    t.app.ctx.mock.offline = true;
    const pork = await prepUnit('Pork', 'g');
    await t.call('POST', `/api/foods/${pork}/quick-add`);
    await t.app.ctx.worker.idle();
    let b = (await t.state()).batches[0];
    expect(b).toMatchObject({ addedDate: '2026-11-12', expiryDate: null, aiStatus: 'none' });
    t.app.ctx.mock.offline = false;
    expect((await t.call('POST', `/api/batches/${b.id}/shelf-life`)).status).toBe(200);
    await t.app.ctx.worker.idle();
    b = (await t.state()).batches[0];
    expect(b).toMatchObject({ aiStatus: 'done', expiryDate: '2026-11-14' });
  });

  it('says no suggestion when the AI has no reliable information', async () => {
    t = await makeApp({ aiMode: 'mock' });
    const pork = await t.foodId('Pork');
    await t.call('POST', '/api/batches', { foodId: pork, qty: 200, unit: 'g', location: 'pantry' });
    await t.app.ctx.worker.idle();
    expect((await t.state()).batches[0]).toMatchObject({ aiStatus: 'none', expiryDate: null });
  });

  it('without an AI model, adding still works and nothing is pending', async () => {
    t = await makeApp({ aiMode: 'auto' });
    const s0 = await t.state();
    expect(s0.ai.configured).toBe(false);
    const egg = await t.foodId('Egg');
    const { body } = await t.call('POST', '/api/batches', { foodId: egg, qty: 6, unit: 'pcs' });
    expect((await t.state()).batches[0].aiStatus).toBe('none');
    const retry = await t.call('POST', `/api/batches/${body.batchId}/shelf-life`);
    expect(retry.status).toBe(400);
    expect(retry.body.code).toBe('ai-not-configured');
  });

  it('finishes lookups left pending when the app was closed', async () => {
    t = await makeApp({ aiMode: 'mock' });
    const egg = await t.foodId('Egg');
    t.app.ctx.mock.offline = true;
    const { body } = await t.call('POST', '/api/batches', { foodId: egg, qty: 6, unit: 'pcs' });
    await t.app.ctx.worker.idle();
    t.app.ctx.db.prepare("UPDATE batches SET ai_status = 'pending' WHERE id = ?").run(body.batchId);
    await t.restart({ aiMode: 'mock' });
    await t.app.ctx.worker.idle();
    expect((await t.state()).batches[0].aiStatus).toBe('done');
  });
});

describe('AI settings (acceptance 27, 28)', () => {
  it('saves settings in data/config.json and never returns the key', async () => {
    t = await makeApp({ aiMode: 'auto' });
    const r = await t.call('PUT', '/api/ai-config', { apiKey: 'sk-secret-abcdef123', model: 'qwen-max' });
    expect(r.body.capabilities).toMatchObject({ configured: true, search: true, vision: true });
    const got = await t.call('GET', '/api/ai-config');
    expect(got.body).toMatchObject({ apiKey: '', hasKey: true, apiKeyMasked: 'sk-••••f123', model: 'qwen-max' });
    expect(JSON.stringify(got.body)).not.toContain('sk-secret-abcdef123');
    expect(JSON.stringify(await t.state())).not.toContain('sk-secret');
    const file = JSON.parse(fs.readFileSync(path.join(t.dir, 'data', 'config.json'), 'utf8'));
    expect(file.ai.apiKey).toBe('sk-secret-abcdef123');
    await t.call('PUT', '/api/ai-config', { apiKey: '', model: 'qwen-plus' });
    expect((await t.call('GET', '/api/ai-config')).body.hasKey).toBe(true);
    await t.call('PUT', '/api/ai-config', { clearKey: true });
    expect((await t.call('GET', '/api/ai-config')).body.hasKey).toBe(false);
    expect((await t.call('PUT', '/api/ai-config', { baseUrl: 'ftp://x' })).status).toBe(400);
  });

  it('Test connection reports a clear error for a bad address', async () => {
    t = await makeApp({ aiMode: 'auto' });
    await t.call('PUT', '/api/ai-config', { apiKey: 'sk-x', baseUrl: 'http://127.0.0.1:9/v1' });
    const r = await t.call('POST', '/api/ai-config/test');
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/Couldn’t reach the AI service/);
  });

  it('Test connection succeeds with a working AI', async () => {
    t = await makeApp({ aiMode: 'mock' });
    const r = await t.call('POST', '/api/ai-config/test');
    expect(r.body).toMatchObject({ ok: true, message: expect.stringMatching(/Connected/) });
  });
});

describe('receipt scanning (acceptance 17)', () => {
  it('reads a receipt, matches catalog foods (including Chinese names) and adds the reviewed list', async () => {
    t = await makeApp({ aiMode: 'mock' });
    const bad = await t.call('POST', '/api/receipt/read', { image: 'hello' });
    expect(bad.status).toBe(400);
    const r = await t.call('POST', '/api/receipt/read', { image: 'data:image/png;base64,iVBORw0KGgo=' });
    expect(r.status).toBe(200);
    const items = r.body.items;
    expect(items.map((i: { matchedName: string | null }) => i.matchedName)).toEqual(['Tomato', 'Pork belly', 'Milk', 'Light soy sauce', null]);
    items[0].qty = 4;
    const add = await t.call('POST', '/api/receipt/add', { items });
    expect(add.status).toBe(200);
    const s = await t.state();
    const names = s.batches.map((b: { foodId: number }) => s.foods.find((f: { id: number }) => f.id === b.foodId).name);
    expect(names).toEqual(['Tomato', 'Pork belly', 'Milk', 'Dragon fruit']);
    expect(s.batches[0].qty).toBe(4);
    const soy = s.foods.find((f: { name: string }) => f.name === 'Light soy sauce').id;
    expect(s.seasonings.find((x: { foodId: number }) => x.foodId === soy).have).toBe(true);
    await t.call('POST', `/api/undo/${add.body.undoId}`);
    expect((await t.state()).batches).toEqual([]);
  });

  it('explains when the model cannot read images', async () => {
    t = await makeApp({ aiMode: 'auto' });
    await t.call('PUT', '/api/ai-config', { apiKey: 'sk-x', visionModel: '' });
    const r = await t.call('POST', '/api/receipt/read', { image: 'data:image/png;base64,iVBORw0KGgo=' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('ai-no-vision');
  });
});
