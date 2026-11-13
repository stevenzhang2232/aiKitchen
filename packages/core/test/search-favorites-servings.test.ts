import { describe, it, expect } from 'vitest';
import { findFoodByName, normalizeText, searchFoods } from '../src/search';
import { rankFavorites, validateOnboardingPick, type FavoriteStat } from '../src/favorites';
import { estimateServings } from '../src/servings';
import { egg, eggplant, FOODS, food, pork, potato, rice, salt, scallion, servingSoup, tomato } from './fixtures';

describe('search (acceptance 8)', () => {
  it('finds Tomato by English name, Chinese names and plural', () => {
    for (const q of ['tomato', 'Tomato', '番茄', '西红柿', 'tomatoes', 'tom']) {
      expect(searchFoods(FOODS, q)[0]?.name, q).toBe('Tomato');
    }
  });

  it('finds seasonings', () => {
    expect(searchFoods(FOODS, 'salt')[0]).toBe(salt);
    expect(searchFoods(FOODS, '生抽')[0]?.name).toBe('Light soy sauce');
  });

  it('treats English aliases as the same food', () => {
    expect(searchFoods(FOODS, 'green onion')[0]).toBe(scallion);
    expect(searchFoods(FOODS, 'aubergine')[0]).toBe(eggplant);
  });

  it('ranks exact matches above partial ones', () => {
    expect(searchFoods(FOODS, 'egg').map((f) => f.name).slice(0, 2)).toEqual(['Egg', 'Eggplant']);
  });

  it('returns nothing for an empty query', () => {
    expect(searchFoods(FOODS, '   ')).toEqual([]);
  });

  it('matches exact names for receipts and AI output', () => {
    expect(findFoodByName(FOODS, 'Eggs')).toBe(egg);
    expect(findFoodByName(FOODS, 'potatoes')).toBe(potato);
    expect(findFoodByName(FOODS, '鸡蛋')).toBe(egg);
    expect(findFoodByName(FOODS, 'dragon fruit')).toBeUndefined();
    expect(normalizeText('  Jalapeño  Pepper ')).toBe('jalapeno pepper');
  });
});

describe('favorites', () => {
  const now = new Date('2026-11-12T12:00:00Z');
  const stat = (p: Partial<FavoriteStat> & { foodId: number }): FavoriteStat => ({
    pinned: false, pinnedAt: null, addCount: 0, lastUsedAt: null, ...p,
  });

  it('keeps pinned items first in pin order, then ranks by use', () => {
    const order = rankFavorites(
      [
        stat({ foodId: 1, addCount: 10 }),
        stat({ foodId: 2, pinned: true, pinnedAt: 2 }),
        stat({ foodId: 3, addCount: 1, lastUsedAt: '2026-11-11T12:00:00Z' }),
        stat({ foodId: 4, pinned: true, pinnedAt: 1 }),
        stat({ foodId: 5, addCount: 2 }),
      ],
      now,
    );
    expect(order).toEqual([4, 2, 1, 3, 5]);
  });

  it('shows at most 12 items', () => {
    const stats = Array.from({ length: 20 }, (_, i) => stat({ foodId: i + 1, addCount: i }));
    expect(rankFavorites(stats, now)).toHaveLength(12);
  });

  it('requires 6 to 8 picks during onboarding (acceptance 7)', () => {
    expect(validateOnboardingPick(5)).toMatch(/at least 6/);
    expect(validateOnboardingPick(6)).toBeNull();
    expect(validateOnboardingPick(8)).toBeNull();
    expect(validateOnboardingPick(9)).toMatch(/at most 8/);
  });
});

describe('serving estimate', () => {
  it('returns 0 for an empty pick', () => {
    expect(estimateServings([])).toBe(0);
  });

  it('1 tomato and 2 eggs feed about 1 person', () => {
    expect(estimateServings([
      { food: tomato, kind: 'count', amount: 1 },
      { food: egg, kind: 'count', amount: 2 },
    ])).toBe(1);
  });

  it('300 g pork and 500 g potato feed about 2 people', () => {
    expect(estimateServings([
      { food: pork, kind: 'weight', amount: 300 },
      { food: potato, kind: 'weight', amount: 500 },
    ])).toBe(2);
  });

  it('counts servings directly and ignores aromatics', () => {
    expect(estimateServings([
      { food: servingSoup, kind: 'serving', amount: 3 },
      { food: scallion, kind: 'count', amount: 5 },
    ])).toBe(3);
  });

  it('scales with staples', () => {
    expect(estimateServings([
      { food: rice, kind: 'weight', amount: 400 },
      { food: pork, kind: 'weight', amount: 600 },
    ])).toBe(4);
  });

  it('never returns less than 1 when something countable is picked', () => {
    expect(estimateServings([{ food: food({ name: 'Mystery', category: 'other' }), kind: 'weight', amount: 10 }])).toBe(1);
  });
});
