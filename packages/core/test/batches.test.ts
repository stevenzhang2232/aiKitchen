import { describe, it, expect } from 'vitest';
import { buildFoodCards, buildInventory, compareBatches, countAlerts, sortBatches, subtractInventory } from '../src/batches';
import { planDeduction } from '../src/deduct';
import { batch, egg, FOODS, pork, potato, salt, tomato } from './fixtures';

const today = '2026-11-12';

describe('batch ordering (acceptance 11)', () => {
  it('puts the soonest expiry first and undated batches last', () => {
    const a = batch({ id: 1, foodId: 1, expiryDate: '2026-11-18' });
    const b = batch({ id: 2, foodId: 1, expiryDate: '2026-11-13' });
    const c = batch({ id: 3, foodId: 1, expiryDate: null });
    expect(sortBatches([a, c, b]).map((x) => x.id)).toEqual([2, 1, 3]);
  });

  it('breaks ties by the oldest added date', () => {
    const a = batch({ id: 1, foodId: 1, addedDate: '2026-11-11' });
    const b = batch({ id: 2, foodId: 1, addedDate: '2026-11-09' });
    expect(compareBatches(a, b)).toBeGreaterThan(0);
  });
});

describe('food cards', () => {
  const batches = [
    batch({ id: 1, foodId: tomato.id, qty: 2, expiryDate: '2026-11-18', addedDate: '2026-11-05' }),
    batch({ id: 2, foodId: tomato.id, qty: 1, expiryDate: '2026-11-13', addedDate: '2026-11-11' }),
    batch({ id: 3, foodId: egg.id, qty: 6, expiryDate: '2026-11-26' }),
    batch({ id: 4, foodId: potato.id, qty: 1200, unit: 'kg' }),
    batch({ id: 5, foodId: pork.id, qty: 300, unit: 'g', expiryDate: '2026-11-11', location: 'freezer' }),
    batch({ id: 6, foodId: salt.id, qty: 1 }),
    batch({ id: 7, foodId: egg.id, qty: 0, expiryDate: '2026-11-01' }),
  ];

  it('merges batches per food and keeps each batch', () => {
    const cards = buildFoodCards(FOODS, batches, today);
    const t = cards.find((c) => c.food.id === tomato.id)!;
    expect(t.batches.map((b) => b.id)).toEqual([2, 1]);
    expect(t.totals).toEqual({ count: 3 });
    expect(t.expiry).toEqual({ state: 'soon', daysLeft: 1 });
    expect(t.oldestAdded).toBe('2026-11-05');
  });

  it('orders cards by soonest expiry and leaves seasonings and empty batches out', () => {
    const cards = buildFoodCards(FOODS, batches, today);
    expect(cards.map((c) => c.food.name)).toEqual(['Pork', 'Tomato', 'Egg', 'Potato']);
    expect(cards.find((c) => c.food.id === egg.id)!.batches).toHaveLength(1);
  });

  it('counts foods to eat first (soon or expired)', () => {
    expect(countAlerts(buildFoodCards(FOODS, batches, today))).toBe(2);
  });

  it('filters by storage location', () => {
    const cards = buildFoodCards(FOODS, batches, today, 'freezer');
    expect(cards.map((c) => c.food.name)).toEqual(['Pork']);
  });

  it('builds inventory totals and subtracts held amounts', () => {
    const inv = buildInventory(batches);
    expect(inv[tomato.id]).toEqual({ count: 3 });
    expect(inv[potato.id]).toEqual({ weight: 1200 });
    const left = subtractInventory(inv, { [tomato.id]: { count: 2 }, [potato.id]: { weight: 5000 } });
    expect(left[tomato.id]).toEqual({ count: 1 });
    expect(left[potato.id]).toEqual({ weight: 0 });
  });
});

describe('deduction (acceptance 13 and 23)', () => {
  const batches = [
    batch({ id: 1, foodId: 1, qty: 2, expiryDate: '2026-11-18' }),
    batch({ id: 2, foodId: 1, qty: 1, expiryDate: '2026-11-13' }),
    batch({ id: 3, foodId: 1, qty: 500, unit: 'g' }),
  ];

  it('takes from the soonest-expiring batch first', () => {
    const plan = planDeduction(batches, 'count', 2);
    expect(plan.takes).toEqual([
      { batchId: 2, amount: 1, remaining: 0 },
      { batchId: 1, amount: 1, remaining: 1 },
    ]);
    expect(plan.shortfall).toBe(0);
  });

  it('stops at zero and reports the shortfall', () => {
    const plan = planDeduction(batches, 'count', 5);
    expect(plan.deducted).toBe(3);
    expect(plan.shortfall).toBe(2);
    expect(plan.takes.every((t) => t.remaining >= 0)).toBe(true);
  });

  it('only touches batches of the same kind of unit', () => {
    const plan = planDeduction(batches, 'weight', 200);
    expect(plan.takes).toEqual([{ batchId: 3, amount: 200, remaining: 300 }]);
  });

  it('ignores zero or negative requests', () => {
    expect(planDeduction(batches, 'count', 0).takes).toEqual([]);
    expect(planDeduction(batches, 'count', -1).takes).toEqual([]);
  });
});
