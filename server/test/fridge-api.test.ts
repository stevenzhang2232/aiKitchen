import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeApp, type TestApp } from './helpers';

let t: TestApp;
beforeEach(async () => {
  t = await makeApp();
});
afterEach(async () => {
  await t.close();
});

async function setUnit(name: string, unit: string) {
  const id = await t.foodId(name);
  expect((await t.call('POST', `/api/foods/${id}/unit`, { unit })).status).toBe(200);
  return id;
}

describe('catalog and state', () => {
  it('seeds the food catalog with images, aliases and seasonings', async () => {
    const s = await t.state();
    expect(s.foods.length).toBeGreaterThanOrEqual(80);
    const tomato = s.foods.find((f: { key: string }) => f.key === 'tomato');
    expect(tomato.aliases).toEqual(expect.arrayContaining(['番茄', '西红柿']));
    expect(s.foods.filter((f: { isSeasoning: boolean }) => f.isSeasoning).length).toBeGreaterThanOrEqual(15);
    expect(s.onboarded).toBe(false);
    expect(s.batches).toEqual([]);
    expect(s.today).toBe('2026-11-12');
  });

  it('starts with the default seasoning pack, none owned yet', async () => {
    const s = await t.state();
    const names = s.pack.map((id: number) => s.foods.find((f: { id: number }) => f.id === id).name);
    expect(names).toEqual(['Oil', 'Salt', 'Sugar', 'Light soy sauce', 'Dark soy sauce', 'Vinegar']);
    expect(s.seasonings.every((x: { have: boolean }) => !x.have)).toBe(true);
  });
});

describe('onboarding (acceptance 7)', () => {
  it('requires 6 to 8 picks and puts them in favorites without adding stock', async () => {
    const s = await t.state();
    const ids = s.foods.filter((f: { isSeasoning: boolean }) => !f.isSeasoning).slice(0, 9).map((f: { id: number }) => f.id);
    expect((await t.call('POST', '/api/onboarding', { foodIds: ids.slice(0, 5) })).status).toBe(400);
    expect((await t.call('POST', '/api/onboarding', { foodIds: ids })).status).toBe(400);
    expect((await t.call('POST', '/api/onboarding', { foodIds: ids.slice(0, 6) })).status).toBe(200);
    const after = await t.state();
    expect(after.onboarded).toBe(true);
    expect(after.favorites).toEqual(expect.arrayContaining(ids.slice(0, 6)));
    expect(after.batches).toEqual([]);
  });

  it('rejects seasonings as onboarding picks', async () => {
    const s = await t.state();
    const salt = s.foods.find((f: { name: string }) => f.name === 'Salt').id;
    const ids = s.foods.filter((f: { isSeasoning: boolean }) => !f.isSeasoning).slice(0, 5).map((f: { id: number }) => f.id);
    expect((await t.call('POST', '/api/onboarding', { foodIds: [...ids, salt] })).status).toBe(400);
  });
});

describe('adding (acceptance 9, 10)', () => {
  it('asks for a unit before the first quick add', async () => {
    const id = await t.foodId('Tomato');
    const r = await t.call('POST', `/api/foods/${id}/quick-add`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('unit-required');
  });

  it('one click adds 1 pc or 100 g, merging clicks on the same day', async () => {
    const tomato = await setUnit('Tomato', 'pcs');
    const pork = await setUnit('Pork', 'g');
    await t.call('POST', `/api/foods/${tomato}/quick-add`);
    await t.call('POST', `/api/foods/${tomato}/quick-add`);
    await t.call('POST', `/api/foods/${pork}/quick-add`);
    const s = await t.state();
    const tb = s.batches.filter((b: { foodId: number }) => b.foodId === tomato);
    expect(tb).toHaveLength(1);
    expect(tb[0].qty).toBe(2);
    expect(tb[0].addedDate).toBe('2026-11-12');
    expect(s.batches.find((b: { foodId: number }) => b.foodId === pork).qty).toBe(100);
  });

  it('kg quick add adds 1 kg', async () => {
    const rice = await setUnit('Rice', 'kg');
    await t.call('POST', `/api/foods/${rice}/quick-add`);
    const s = await t.state();
    expect(s.batches[0]).toMatchObject({ qty: 1000, unit: 'kg' });
  });

  it('records the date added even when no shelf life can be suggested', async () => {
    const egg = await setUnit('Egg', 'pcs');
    await t.call('POST', `/api/foods/${egg}/quick-add`);
    const b = (await t.state()).batches[0];
    expect(b.addedDate).toBe('2026-11-12');
    expect(b.expiryDate).toBeNull();
    expect(b.aiStatus).toBe('none');
  });

  it('undo restores the stock to before the add', async () => {
    const tomato = await setUnit('Tomato', 'pcs');
    await t.call('POST', `/api/foods/${tomato}/quick-add`);
    const second = await t.call('POST', `/api/foods/${tomato}/quick-add`);
    expect((await t.call('POST', `/api/undo/${second.body.undoId}`)).status).toBe(200);
    let s = await t.state();
    expect(s.batches[0].qty).toBe(1);
    const fav = s.favoriteStats.find((f: { foodId: number }) => f.foodId === tomato);
    expect(fav.addCount).toBe(1);
    const third = await t.call('POST', '/api/batches', { foodId: tomato, qty: 3, unit: 'pcs', expiryDate: '2026-11-20' });
    await t.call('POST', `/api/undo/${third.body.undoId}`);
    s = await t.state();
    expect(s.batches).toHaveLength(1);
    expect((await t.call('POST', `/api/undo/${third.body.undoId}`)).status).toBe(404);
  });

  it('detailed add accepts an expiry date or start date plus days', async () => {
    const pork = await t.foodId('Pork');
    await t.call('POST', '/api/batches', { foodId: pork, qty: 0.5, unit: 'kg', location: 'freezer', expiryDate: '2026-12-01' });
    await t.call('POST', '/api/batches', { foodId: pork, qty: 200, unit: 'g', startDate: '2026-11-10', keepDays: 3 });
    const s = await t.state();
    expect(s.batches.map((b: { qty: number; expiryDate: string; expirySource: string; location: string }) => [b.qty, b.expiryDate, b.expirySource, b.location]))
      .toEqual([[500, '2026-12-01', 'user', 'freezer'], [200, '2026-11-13', 'user', 'fridge']]);
    expect(s.foods.find((f: { id: number }) => f.id === pork).defaultUnit).toBe('kg');
  });

  it('rejects invalid input with a clear message', async () => {
    const pork = await t.foodId('Pork');
    const r1 = await t.call('POST', '/api/batches', { foodId: pork, qty: -1, unit: 'g' });
    expect(r1.status).toBe(400);
    expect(r1.body.error).toMatch(/greater than 0/);
    const r2 = await t.call('POST', '/api/batches', { foodId: pork, qty: 1, unit: 'g', expiryDate: '2026-02-30' });
    expect(r2.status).toBe(400);
    const r3 = await t.call('POST', '/api/batches', { foodId: 99999, qty: 1, unit: 'g' });
    expect(r3.status).toBe(404);
  });

  it('creates custom ingredients and reuses existing names', async () => {
    const r = await t.call('POST', '/api/foods', { name: 'dragon fruit', category: 'fruit' });
    expect(r.body.food).toMatchObject({ name: 'Dragon fruit', category: 'fruit', custom: true });
    const again = await t.call('POST', '/api/foods', { name: '西红柿' });
    expect(again.body.food.name).toBe('Tomato');
  });
});

describe('batches (acceptance 11, 12, 13)', () => {
  it('restock adds a new batch and keeps old dates', async () => {
    const tomato = await t.foodId('Tomato');
    await t.call('POST', '/api/batches', { foodId: tomato, qty: 2, unit: 'pcs', expiryDate: '2026-11-18' });
    t.clock.now = new Date(2026, 10, 14, 9, 0);
    await t.call('POST', '/api/batches', { foodId: tomato, qty: 1, unit: 'pcs', expiryDate: '2026-11-16' });
    const s = await t.state();
    expect(s.batches).toHaveLength(2);
    expect(s.batches[0]).toMatchObject({ addedDate: '2026-11-12', expiryDate: '2026-11-18' });
    expect(s.batches[1]).toMatchObject({ addedDate: '2026-11-14', expiryDate: '2026-11-16' });
  });

  it('adjusts, moves and removes batches', async () => {
    const pork = await t.foodId('Pork');
    const { body } = await t.call('POST', '/api/batches', { foodId: pork, qty: 500, unit: 'g' });
    await t.call('POST', `/api/batches/${body.batchId}/adjust`, { qty: 1.5, unit: 'kg' });
    await t.call('POST', `/api/batches/${body.batchId}/move`, { location: 'freezer' });
    let b = (await t.state()).batches[0];
    expect(b).toMatchObject({ qty: 1500, unit: 'kg', location: 'freezer' });
    expect((await t.call('POST', `/api/batches/${body.batchId}/adjust`, { qty: 2, unit: 'pcs' })).status).toBe(400);
    expect((await t.call('POST', `/api/batches/${body.batchId}/move`, { location: 'garage' })).status).toBe(400);
    await t.call('DELETE', `/api/batches/${body.batchId}`);
    b = (await t.state()).batches[0];
    expect(b).toBeUndefined();
  });

  it('using more than in stock stops at zero (acceptance 13)', async () => {
    const egg = await t.foodId('Egg');
    await t.call('POST', '/api/batches', { foodId: egg, qty: 2, unit: 'pcs', expiryDate: '2026-11-20' });
    await t.call('POST', '/api/batches', { foodId: egg, qty: 3, unit: 'pcs', expiryDate: '2026-11-15' });
    const r1 = await t.call('POST', `/api/foods/${egg}/use`, { amount: 4, unit: 'pcs' });
    expect(r1.body).toMatchObject({ deducted: 4, shortfall: 0 });
    let s = await t.state();
    expect(s.batches).toHaveLength(1);
    expect(s.batches[0]).toMatchObject({ qty: 1, expiryDate: '2026-11-20' });
    const r2 = await t.call('POST', `/api/foods/${egg}/use`, { amount: 10, unit: 'pcs' });
    expect(r2.body).toMatchObject({ deducted: 1, shortfall: 9 });
    s = await t.state();
    expect(s.batches).toEqual([]);
  });

  it('keeps weight and piece batches separate (acceptance 12)', async () => {
    const tomato = await t.foodId('Tomato');
    await t.call('POST', '/api/batches', { foodId: tomato, qty: 500, unit: 'g' });
    await t.call('POST', '/api/batches', { foodId: tomato, qty: 1, unit: 'kg' });
    await t.call('POST', '/api/batches', { foodId: tomato, qty: 2, unit: 'pcs' });
    const r = await t.call('POST', `/api/foods/${tomato}/use`, { amount: 1.2, unit: 'kg' });
    expect(r.body.deducted).toBe(1200);
    const s = await t.state();
    const total = s.batches.filter((b: { unit: string }) => b.unit !== 'pcs').reduce((a: number, b: { qty: number }) => a + b.qty, 0);
    expect(total).toBe(300);
    expect(s.batches.find((b: { unit: string }) => b.unit === 'pcs').qty).toBe(2);
  });

  it('user can set and change expiry and date added (acceptance 14, 15)', async () => {
    const egg = await t.foodId('Egg');
    const { body } = await t.call('POST', '/api/batches', { foodId: egg, qty: 6, unit: 'pcs' });
    await t.call('POST', `/api/batches/${body.batchId}/expiry`, { expiryDate: '2026-11-13' });
    await t.call('POST', `/api/batches/${body.batchId}/added-date`, { date: '2026-11-09' });
    const b = (await t.state()).batches[0];
    expect(b).toMatchObject({ expiryDate: '2026-11-13', expirySource: 'user', addedDate: '2026-11-09' });
    expect((await t.call('POST', `/api/batches/${body.batchId}/added-date`, { date: '2026-11-20' })).status).toBe(400);
  });
});

describe('seasonings (acceptance 18 and favorites)', () => {
  it('applies the pack, toggles have, and uses an edited pack', async () => {
    const s = await t.state();
    const id = (n: string) => s.foods.find((f: { name: string }) => f.name === n).id;
    await t.call('POST', '/api/seasoning-pack/apply');
    let after = await t.state();
    expect(after.seasonings.filter((x: { have: boolean }) => x.have)).toHaveLength(6);
    await t.call('POST', `/api/seasonings/${id('Salt')}`, { have: false });
    after = await t.state();
    expect(after.seasonings.find((x: { foodId: number }) => x.foodId === id('Salt')).have).toBe(false);

    const chiliOil = id('Chili oil');
    await t.call('PUT', '/api/seasoning-pack', { foodIds: [id('Oil'), id('Salt'), chiliOil] });
    await t.call('POST', '/api/seasoning-pack/apply');
    after = await t.state();
    expect(after.pack).toEqual([id('Oil'), id('Salt'), chiliOil]);
    const have = after.seasonings.filter((x: { have: boolean }) => x.have).map((x: { foodId: number }) => x.foodId);
    expect(have).toEqual(expect.arrayContaining([id('Oil'), id('Salt'), chiliOil]));
    expect((await t.call('PUT', '/api/seasoning-pack', { foodIds: [id('Tomato')] })).status).toBe(400);
  });

  it('adds a custom seasoning', async () => {
    const r = await t.call('POST', '/api/foods', { name: 'Truffle salt', isSeasoning: true });
    await t.call('POST', `/api/seasonings/${r.body.food.id}`, { have: true });
    const s = await t.state();
    expect(s.seasonings.find((x: { foodId: number }) => x.foodId === r.body.food.id).have).toBe(true);
  });

  it('pins favorites and keeps pinned first', async () => {
    const tomato = await setUnit('Tomato', 'pcs');
    const egg = await setUnit('Egg', 'pcs');
    for (let i = 0; i < 3; i++) await t.call('POST', `/api/foods/${tomato}/quick-add`);
    await t.call('POST', `/api/foods/${egg}/quick-add`);
    let s = await t.state();
    expect(s.favorites.slice(0, 2)).toEqual([tomato, egg]);
    await t.call('POST', `/api/foods/${egg}/pin`, { pinned: true });
    s = await t.state();
    expect(s.favorites[0]).toBe(egg);
  });
});

describe('cart, taste, to cook, history', () => {
  it('saves the cart and refuses more than in stock', async () => {
    const tomato = await t.foodId('Tomato');
    await t.call('POST', '/api/batches', { foodId: tomato, qty: 3, unit: 'pcs' });
    expect((await t.call('PUT', '/api/cart', { items: [{ foodId: tomato, kind: 'count', qty: 2 }] })).status).toBe(200);
    expect((await t.state()).cart).toEqual([{ foodId: tomato, kind: 'count', qty: 2 }]);
    expect((await t.call('PUT', '/api/cart', { items: [{ foodId: tomato, kind: 'count', qty: 4 }] })).status).toBe(400);
    await t.call('DELETE', '/api/cart');
    expect((await t.state()).cart).toEqual([]);
  });

  it('stores taste preferences', async () => {
    const r = await t.call('PUT', '/api/taste', { spice: 'mild', avoid: 'cilantro, peanuts', cuisines: ['Sichuan'] });
    expect(r.body.taste).toEqual({ spice: 'mild', avoid: ['cilantro', 'peanuts'], cuisines: ['Sichuan'] });
    expect((await t.state()).taste.spice).toBe('mild');
    expect((await t.call('PUT', '/api/taste', { spice: 'volcanic' })).status).toBe(400);
  });

  it('adds and deletes To cook items', async () => {
    const r = await t.call('POST', '/api/to-cook', { dishName: 'Kung pao chicken', servings: 2, missing: [{ name: 'Peanuts' }] });
    let s = await t.state();
    expect(s.toCook[0]).toMatchObject({ id: r.body.id, dishName: 'Kung pao chicken', servings: 2, savedAt: expect.any(String) });
    await t.call('DELETE', `/api/to-cook/${r.body.id}`);
    s = await t.state();
    expect(s.toCook).toEqual([]);
  });
});

describe('persistence (acceptance 1, 2)', () => {
  it('keeps everything after the server restarts', async () => {
    const tomato = await setUnit('Tomato', 'pcs');
    await t.call('POST', `/api/foods/${tomato}/quick-add`);
    const pork = await t.foodId('Pork');
    await t.call('POST', '/api/batches', { foodId: pork, qty: 300, unit: 'g', expiryDate: '2026-11-14' });
    await t.call('POST', '/api/seasoning-pack/apply');
    await t.call('PUT', '/api/taste', { spice: 'hot', avoid: [], cuisines: [] });
    const before = await t.state();
    await t.restart();
    const after = await t.state();
    expect(after.batches).toEqual(before.batches);
    expect(after.seasonings).toEqual(before.seasonings);
    expect(after.taste).toEqual(before.taste);
    expect(after.favorites).toEqual(before.favorites);
    expect(after.foods.map((f: { id: number }) => f.id)).toEqual(before.foods.map((f: { id: number }) => f.id));
  });
});
