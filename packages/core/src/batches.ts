import type { Batch, Food, Inventory, KindAmounts, Location } from './types';
import { addKindAmount, EPSILON, unitKind } from './units';
import { diffDays, expiryInfo, type ExpiryInfo } from './dates';

/** Soonest expiry first; batches without an expiry date go last; then oldest first. */
export function compareBatches(a: Batch, b: Batch): number {
  if (a.expiryDate && b.expiryDate) {
    if (a.expiryDate !== b.expiryDate) return a.expiryDate < b.expiryDate ? -1 : 1;
  } else if (a.expiryDate) {
    return -1;
  } else if (b.expiryDate) {
    return 1;
  }
  if (a.addedDate !== b.addedDate) return a.addedDate < b.addedDate ? -1 : 1;
  return a.id - b.id;
}

export function sortBatches(batches: Batch[]): Batch[] {
  return [...batches].sort(compareBatches);
}

export interface FoodCard {
  food: Food;
  batches: Batch[];
  totals: KindAmounts;
  /** Expiry of the batch that expires soonest. */
  expiry: ExpiryInfo;
  /** Date of the oldest batch, used for "In fridge X days". */
  oldestAdded: string;
  pendingAi: boolean;
  noSuggestion: boolean;
}

export function totalsOf(batches: Batch[]): KindAmounts {
  const totals: KindAmounts = {};
  for (const b of batches) addKindAmount(totals, unitKind(b.unit), b.qty);
  return totals;
}

/**
 * Merge batches into one card per food. Cards are ordered by soonest expiry
 * (unknown expiry last), then by name.
 */
export function buildFoodCards(
  foods: Food[],
  batches: Batch[],
  today: string,
  location?: Location | 'all',
): FoodCard[] {
  const byFood = new Map<number, Batch[]>();
  for (const b of batches) {
    if (b.qty <= EPSILON) continue;
    if (location && location !== 'all' && b.location !== location) continue;
    const list = byFood.get(b.foodId) ?? [];
    list.push(b);
    byFood.set(b.foodId, list);
  }
  const foodById = new Map(foods.map((f) => [f.id, f]));
  const cards: FoodCard[] = [];
  for (const [foodId, list] of byFood) {
    const food = foodById.get(foodId);
    if (!food || food.isSeasoning) continue;
    const sorted = sortBatches(list);
    const first = sorted[0];
    const oldestAdded = sorted.reduce((min, b) => (b.addedDate < min ? b.addedDate : min), first.addedDate);
    cards.push({
      food,
      batches: sorted,
      totals: totalsOf(sorted),
      expiry: expiryInfo(first.expiryDate, today),
      oldestAdded,
      pendingAi: sorted.some((b) => !b.expiryDate && b.aiStatus === 'pending'),
      noSuggestion: !first.expiryDate && first.aiStatus !== 'pending',
    });
  }
  cards.sort((a, b) => {
    const da = a.expiry.daysLeft;
    const db = b.expiry.daysLeft;
    if (da !== null && db !== null && da !== db) return da - db;
    if (da !== null && db === null) return -1;
    if (da === null && db !== null) return 1;
    return a.food.name.localeCompare(b.food.name);
  });
  return cards;
}

/** Number of foods that should be eaten first (expiring soon or already expired). */
export function countAlerts(cards: FoodCard[]): number {
  return cards.filter((c) => c.expiry.state === 'soon' || c.expiry.state === 'expired').length;
}

export function isAlert(card: FoodCard): boolean {
  return card.expiry.state === 'soon' || card.expiry.state === 'expired';
}

export function buildInventory(batches: Batch[]): Inventory {
  const inv: Inventory = {};
  for (const b of batches) {
    if (b.qty <= EPSILON) continue;
    const entry = (inv[b.foodId] ??= {});
    addKindAmount(entry, unitKind(b.unit), b.qty);
  }
  return inv;
}

/** Subtract held amounts (e.g. the cart) from an inventory, never below zero. */
export function subtractInventory(inv: Inventory, held: Inventory): Inventory {
  const out: Inventory = {};
  for (const [id, amounts] of Object.entries(inv)) {
    const h = held[Number(id)] ?? {};
    const entry: KindAmounts = {};
    for (const [kind, value] of Object.entries(amounts) as [keyof KindAmounts, number][]) {
      entry[kind] = Math.max(0, value - (h[kind] ?? 0));
    }
    out[Number(id)] = entry;
  }
  return out;
}

/** Days a batch has been in storage. */
export function storedDays(batch: Batch, today: string): number {
  return Math.max(0, diffDays(batch.addedDate, today));
}
