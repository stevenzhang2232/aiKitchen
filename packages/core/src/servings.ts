import type { Category, Food, UnitKind } from './types';

/** Grams of a food one person typically eats in one meal, by category. 0 = ignored. */
export const GRAMS_PER_PERSON: Record<Category, number> = {
  meat: 150,
  seafood: 150,
  vegetable: 250,
  mushroom: 150,
  tofu_bean: 150,
  egg_dairy: 100,
  staple: 100,
  fruit: 200,
  other: 200,
  aromatic: 0,
  seasoning: 0,
};

/** Fallback weight of one piece when the food has no pieceGrams. */
export const DEFAULT_PIECE_GRAMS: Record<Category, number> = {
  meat: 200,
  seafood: 150,
  vegetable: 150,
  mushroom: 30,
  tofu_bean: 300,
  egg_dairy: 50,
  staple: 100,
  fruit: 150,
  other: 100,
  aromatic: 10,
  seasoning: 0,
};

export interface PickedItem {
  food: Food;
  kind: UnitKind;
  /** Base amount (grams, pieces or servings). */
  amount: number;
}

export function pieceGrams(food: Food): number {
  return food.pieceGrams ?? DEFAULT_PIECE_GRAMS[food.category];
}

/**
 * Estimate how many people the picked ingredients can feed.
 * A meal is assumed to combine about two components (e.g. a meat and a vegetable),
 * so the per-person portions are halved. Items recorded in servings count directly.
 * Returns 0 when nothing countable is picked, otherwise at least 1.
 */
export function estimateServings(items: PickedItem[]): number {
  let portions = 0;
  let servings = 0;
  for (const item of items) {
    if (!(item.amount > 0)) continue;
    if (item.kind === 'serving') {
      servings += item.amount;
      continue;
    }
    const perPerson = GRAMS_PER_PERSON[item.food.category];
    if (!perPerson) continue;
    const grams = item.kind === 'weight' ? item.amount : item.amount * pieceGrams(item.food);
    portions += grams / perPerson;
  }
  const total = portions / 2 + servings;
  if (total <= 0) return 0;
  return Math.max(1, Math.round(total));
}
