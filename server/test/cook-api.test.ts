import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeApp, type TestApp } from './helpers';

let t: TestApp;
let id: (name: string) => number;

beforeEach(async () => {
  t = await makeApp({ aiMode: 'mock' });
  const s = await t.state();
  id = (name) => s.foods.find((f: { name: string }) => f.name === name).id;
  await t.call('POST', '/api/seasoning-pack/apply');
  await t.call('POST', '/api/batches', { foodId: id('Tomato'), qty: 3, unit: 'pcs', expiryDate: '2026-11-20' });
  await t.call('POST', '/api/batches', { foodId: id('Egg'), qty: 2, unit: 'pcs', expiryDate: '2026-11-13' });
  await t.call('POST', '/api/batches', { foodId: id('Egg'), qty: 4, unit: 'pcs', expiryDate: '2026-11-25' });
  await t.call('POST', '/api/batches', { foodId: id('Pork'), qty: 300, unit: 'g', expiryDate: '2026-11-14' });
  await t.call('POST', '/api/batches', { foodId: id('Scallion'), qty: 3, unit: 'pcs' });
  await t.app.ctx.worker.idle();
});
afterEach(async () => {
  await t.close();
});

async function total(name: string) {
  const s = await t.state();
  return s.batches.filter((b: { foodId: number }) => b.foodId === id(name)).reduce((a: number, b: { qty: number }) => a + b.qty, 0);
}

describe('Suggest for me (acceptance 19, 20)', () => {
  it('suggests 1–3 checked dishes with minutes, using expiring food first', async () => {
    const r = await t.call('POST', '/api/cook/suggest', { mode: 'suggest', servings: 2 });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
    expect(r.body.dishes.length).toBeGreaterThanOrEqual(1);
    expect(r.body.dishes.length).toBeLessThanOrEqual(3);
    for (const d of r.body.dishes) expect(d.minutes).toBeGreaterThan(0);
    const firstIds = r.body.dishes[0].ingredients.map((i: { foodId: number }) => i.foodId);
    expect(firstIds).toEqual(expect.arrayContaining([id('Egg'), id('Pork')]));
    expect(r.body.dishes[0].deductions.length).toBeGreaterThan(0);
    expect(r.body.dishes[0].seasoningNames).toEqual(expect.arrayContaining(['Oil', 'Salt']));
  });

  it('does not change the fridge until "I cooked it"', async () => {
    const before = (await t.state()).batches;
    await t.call('POST', '/api/cook/suggest', { mode: 'suggest', servings: 2 });
    expect((await t.state()).batches).toEqual(before);
  });

  it('asks the AI again once when its answer breaks the rules', async () => {
    const r = await t.call('POST', '/api/cook/suggest', { mode: 'dish', dishName: 'invalid omelette', servings: 1 });
    expect(r.body.status).toBe('ok');
    expect(t.app.ctx.mock.calls.dishes).toBe(2);
  });

  it('says it can’t be done after a second bad answer', async () => {
    const r = await t.call('POST', '/api/cook/suggest', { mode: 'dish', dishName: 'impossible pie', servings: 1 });
    expect(r.body.status).toBe('cannot');
    expect(r.body.problems.join(' ')).toMatch(/unknown ingredient/);
    expect(t.app.ctx.mock.calls.dishes).toBe(2);
  });

  it('says so when the fridge is empty', async () => {
    const s = await t.state();
    for (const b of s.batches) await t.call('DELETE', `/api/batches/${b.id}`);
    const r = await t.call('POST', '/api/cook/suggest', { mode: 'suggest', servings: 2 });
    expect(r.body).toMatchObject({ status: 'cannot', reason: expect.stringMatching(/empty/) });
  });

  it('validates servings and explains when there is no AI', async () => {
    expect((await t.call('POST', '/api/cook/suggest', { mode: 'suggest', servings: 0 })).status).toBe(400);
    t.app.ctx.setAiMode('off');
    const r = await t.call('POST', '/api/cook/suggest', { mode: 'suggest', servings: 2 });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('ai-not-configured');
  });

  it('reports AI connection problems clearly (acceptance 6)', async () => {
    t.app.ctx.mock.offline = true;
    const r = await t.call('POST', '/api/cook/suggest', { mode: 'suggest', servings: 2 });
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/Couldn’t reach the AI service/);
    expect((await t.call('GET', '/api/state')).status).toBe(200);
  });
});

describe('I want a dish (acceptance 21)', () => {
  it('returns the recipe directly when everything is in stock', async () => {
    const r = await t.call('POST', '/api/cook/suggest', { mode: 'dish', dishName: 'Tomato and egg', servings: 2 });
    expect(r.body.status).toBe('ok');
    expect(r.body.dishes).toHaveLength(1);
    expect(r.body.dishes[0].name).toBe('Tomato and egg');
  });

  it('lists missing ingredients; "Buy first" saves to To cook and Continue rechecks', async () => {
    const r = await t.call('POST', '/api/cook/suggest', { mode: 'dish', dishName: 'Kung pao chicken with peanuts and scallion', servings: 2 });
    expect(r.body.status).toBe('missing');
    const names = r.body.dishes[0].missing.map((m: { name: string }) => m.name);
    expect(names).toEqual(['Chicken', 'Peanuts']);
    const saved = await t.call('POST', '/api/to-cook', { dishName: r.body.dishes[0].name, servings: 2, missing: r.body.dishes[0].missing });
    expect((await t.state()).toCook).toHaveLength(1);

    // Bought the chicken and peanuts, then Continue from To cook.
    await t.call('POST', '/api/batches', { foodId: id('Chicken breast'), qty: 300, unit: 'g' });
    await t.call('POST', '/api/batches', { foodId: id('Peanuts'), qty: 100, unit: 'g' });
    const again = await t.call('POST', '/api/cook/suggest', { mode: 'dish', toCookId: saved.body.id, servings: 2 });
    expect(again.body.status).toBe('ok');
    const dish = again.body.dishes[0];
    await t.call('POST', '/api/cook/confirm', {
      mode: 'dish', servings: 2, dish, toCookId: saved.body.id,
      lines: dish.deductions.map((d: { foodId: number; amount: number; unit: string }) => ({ foodId: d.foodId, amount: d.amount, unit: d.unit })),
    });
    expect((await t.state()).toCook).toEqual([]);
  });

  it('"Cook anyway" only takes what is in stock and never goes negative', async () => {
    const r = await t.call('POST', '/api/cook/suggest', { mode: 'dish', dishName: 'Scallion beef', servings: 2 });
    expect(r.body.status).toBe('missing');
    const dish = r.body.dishes[0];
    const lines = [
      ...dish.deductions.map((d: { foodId: number; amount: number; unit: string }) => ({ foodId: d.foodId, amount: d.amount, unit: d.unit })),
      { foodId: id('Scallion'), amount: 10, unit: 'pcs' },
    ];
    const c = await t.call('POST', '/api/cook/confirm', { mode: 'dish', servings: 2, dish, lines });
    expect(c.status).toBe(200);
    expect(await total('Scallion')).toBe(0);
    const h = (await t.state()).history[0];
    expect(h.missing).toEqual([{ name: 'Beef' }]);
    expect(h.deductions.find((d: { name: string }) => d.name === 'Scallion').amount).toBe(3);
  });
});

describe('Pick ingredients (acceptance 22, 23)', () => {
  it('cooks only from the cart, then clears it on confirm', async () => {
    expect((await t.call('POST', '/api/cook/suggest', { mode: 'pick', servings: 1 })).status).toBe(400);
    await t.call('PUT', '/api/cart', { items: [{ foodId: id('Tomato'), kind: 'count', qty: 2 }, { foodId: id('Egg'), kind: 'count', qty: 3 }] });
    const r = await t.call('POST', '/api/cook/suggest', { mode: 'pick', servings: 2 });
    expect(r.body.status).toBe('ok');
    const used = new Set(r.body.dishes.flatMap((d: { ingredients: { foodId: number }[] }) => d.ingredients.map((i) => i.foodId)));
    expect([...used].every((x) => x === id('Tomato') || x === id('Egg'))).toBe(true);
    expect(await total('Egg')).toBe(6);
    expect((await t.state()).cart).toHaveLength(2);

    const dish = r.body.dishes[0];
    await t.call('POST', '/api/cook/confirm', {
      mode: 'pick', servings: 2, dish,
      lines: dish.deductions.map((d: { foodId: number; amount: number; unit: string }) => ({ foodId: d.foodId, amount: d.amount, unit: d.unit })),
    });
    const s = await t.state();
    expect(s.cart).toEqual([]);
    expect(await total('Egg')).toBe(3);
    // The soonest-expiring eggs (2 pcs, Nov 13) were used first.
    expect(s.batches.filter((b: { foodId: number }) => b.foodId === id('Egg')).map((b: { expiryDate: string; qty: number }) => [b.expiryDate, b.qty])).toEqual([['2026-11-25', 3]]);
  });
});

describe('I cooked it → history (acceptance 23, 26)', () => {
  it('records dish, time, servings, mode and what was taken', async () => {
    t.clock.now = new Date(2026, 10, 12, 18, 42, 0);
    const dish = { name: 'Pork stir-fry', minutes: 15, servings: 3, ingredients: [], seasonings: [], missing: [], steps: ['Fry.'] };
    const r = await t.call('POST', '/api/cook/confirm', {
      mode: 'suggest', servings: 3, dish,
      lines: [{ foodId: id('Pork'), amount: 0.2, unit: 'kg' }, { foodId: id('Tomato'), amount: 0, unit: 'pcs' }],
    });
    expect(r.status).toBe(200);
    const h = (await t.state()).history[0];
    expect(h).toMatchObject({ dishName: 'Pork stir-fry', servings: 3, mode: 'suggest', cookedAt: new Date(2026, 10, 12, 18, 42, 0).toISOString() });
    expect(h.deductions).toEqual([{ foodId: id('Pork'), name: 'Pork', amount: 0.2, unit: 'kg' }]);
    expect(await total('Pork')).toBe(100);
    expect(await total('Tomato')).toBe(3);
    expect((await t.call('DELETE', `/api/history/${h.id}`)).status).toBe(200);
    expect((await t.state()).history).toEqual([]);
  });

  it('rejects bad input without changing anything', async () => {
    const before = (await t.state()).batches;
    const r = await t.call('POST', '/api/cook/confirm', { mode: 'suggest', servings: 2, dish: { name: 'X' }, lines: [{ foodId: id('Pork'), amount: -1, unit: 'g' }] });
    expect(r.status).toBe(400);
    const r2 = await t.call('POST', '/api/cook/confirm', { mode: 'suggest', servings: 2, dish: { name: 'X' }, lines: [{ foodId: id('Pork'), amount: 100, unit: 'g' }, { foodId: 999999, amount: 1, unit: 'pcs' }] });
    expect(r2.status).toBe(404);
    expect((await t.state()).batches).toEqual(before);
    expect((await t.state()).history).toEqual([]);
  });
});
