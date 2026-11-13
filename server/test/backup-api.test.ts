import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeApp, type TestApp } from './helpers';

let t: TestApp;
beforeEach(async () => {
  t = await makeApp({ aiMode: 'off' });
});
afterEach(async () => {
  await t.close();
});

async function seed() {
  const s = await t.state();
  const id = (n: string) => s.foods.find((f: { name: string }) => f.name === n).id;
  await t.call('POST', '/api/onboarding', { foodIds: ['Tomato', 'Egg', 'Potato', 'Pork', 'Rice', 'Bread'].map(id) });
  await t.call('POST', '/api/seasoning-pack/apply');
  await t.call('POST', '/api/batches', { foodId: id('Tomato'), qty: 3, unit: 'pcs', expiryDate: '2026-11-20' });
  await t.call('POST', '/api/batches', { foodId: id('Pork'), qty: 0.5, unit: 'kg' });
  const custom = await t.call('POST', '/api/foods', { name: 'Dragon fruit', category: 'fruit' });
  await t.call('POST', '/api/batches', { foodId: custom.body.food.id, qty: 1, unit: 'pcs' });
  await t.call('PUT', '/api/taste', { spice: 'hot', avoid: ['cilantro'], cuisines: [] });
  await t.call('PUT', '/api/cart', { items: [{ foodId: id('Tomato'), kind: 'count', qty: 1 }] });
  await t.call('POST', '/api/to-cook', { dishName: 'Mapo tofu', servings: 2, missing: [{ name: 'Tofu' }] });
  await t.call('POST', '/api/cook/confirm', { mode: 'suggest', servings: 2, dish: { name: 'Fried rice' }, lines: [{ foodId: id('Pork'), amount: 100, unit: 'g' }] });
  await t.call('PUT', '/api/ai-config', { apiKey: 'sk-very-secret-key-999' });
  return id;
}

describe('backup and restore (acceptance 28, 29)', () => {
  it('exports everything except the API key, as a downloadable file', async () => {
    await seed();
    const res = await t.app.inject('/api/backup/export');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="fridge-backup-20261112-100000\.json"/);
    expect(res.body).not.toContain('sk-very-secret');
    const backup = res.json();
    expect(backup).toMatchObject({ format: 'virtual-fridge-backup', version: 1 });
    expect(backup.data.batches).toHaveLength(3);
    expect(backup.data.history).toHaveLength(1);
    expect(backup.data.to_cook).toHaveLength(1);
    expect(backup.data.cart_items).toHaveLength(1);
  });

  it('restores the exported state after changes, keeping a safety copy', async () => {
    const id = await seed();
    const backup = (await t.app.inject('/api/backup/export')).json();
    const before = await t.state();

    const s = await t.state();
    for (const b of s.batches) await t.call('DELETE', `/api/batches/${b.id}`);
    await t.call('DELETE', `/api/history/${s.history[0].id}`);
    await t.call('PUT', '/api/taste', { spice: 'none', avoid: [], cuisines: [] });
    await t.call('POST', '/api/batches', { foodId: id('Egg'), qty: 12, unit: 'pcs' });

    const preview = await t.call('POST', '/api/backup/preview', { backup });
    expect(preview.body).toMatchObject({ ok: true, counts: { batches: 3, history: 1 } });
    const r = await t.call('POST', '/api/backup/import', { backup });
    expect(r.status).toBe(200);
    const after = await t.state();
    expect(after.batches).toEqual(before.batches);
    expect(after.history).toEqual(before.history);
    expect(after.toCook).toEqual(before.toCook);
    expect(after.cart).toEqual(before.cart);
    expect(after.taste).toEqual(before.taste);
    expect(after.seasonings).toEqual(before.seasonings);
    expect(after.foods.find((f: { name: string }) => f.name === 'Dragon fruit')).toBeTruthy();
    // The key stays as configured on this computer.
    expect((await t.call('GET', '/api/ai-config')).body.hasKey).toBe(true);

    const copies = fs.readdirSync(path.join(t.dir, 'data', 'auto-backups'));
    expect(copies).toHaveLength(1);
    const copy = JSON.parse(fs.readFileSync(path.join(t.dir, 'data', 'auto-backups', copies[0]), 'utf8'));
    expect(copy.data.batches).toHaveLength(1);
    expect(r.body.safetyCopy).toMatch(/auto-backups/);
  });

  it('rejects a broken file and leaves data unchanged', async () => {
    await seed();
    const before = await t.state();
    const r1 = await t.call('POST', '/api/backup/import', { backup: { hello: 1 } });
    expect(r1.status).toBe(400);
    expect(r1.body.error).toMatch(/unchanged/);
    const bad = (await t.app.inject('/api/backup/export')).json();
    bad.data.batches.push({ id: 999, food_id: 1, qty: -5, unit: 'pcs', location: 'fridge', added_date: '2026-11-12' });
    const r2 = await t.call('POST', '/api/backup/import', { backup: bad });
    expect(r2.status).toBe(400);
    expect(await t.state()).toEqual(before);
    expect(fs.existsSync(path.join(t.dir, 'data', 'auto-backups'))).toBe(true);
  });

  it('restored data survives a restart', async () => {
    await seed();
    const backup = (await t.app.inject('/api/backup/export')).json();
    await t.call('POST', '/api/backup/import', { backup });
    const before = await t.state();
    await t.restart({ aiMode: 'off' });
    expect((await t.state()).batches).toEqual(before.batches);
  });
});
