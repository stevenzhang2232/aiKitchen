import type { Batch, UnitKind } from './types';
import { compareBatches } from './batches';
import { EPSILON, round, unitKind } from './units';

export interface BatchTake {
  batchId: number;
  amount: number;
  remaining: number;
}

export interface DeductionPlan {
  takes: BatchTake[];
  deducted: number;
  shortfall: number;
}

/**
 * Plan taking `amount` (base units of `kind`) from a food's batches.
 * Batches expiring soonest are used first. Never goes below zero: anything
 * that cannot be covered is reported as `shortfall`.
 */
export function planDeduction(batches: Batch[], kind: UnitKind, amount: number): DeductionPlan {
  if (!(amount > 0)) return { takes: [], deducted: 0, shortfall: 0 };
  const usable = batches.filter((b) => unitKind(b.unit) === kind && b.qty > EPSILON).sort(compareBatches);
  let left = amount;
  const takes: BatchTake[] = [];
  for (const b of usable) {
    if (left <= EPSILON) break;
    const take = Math.min(b.qty, left);
    takes.push({ batchId: b.id, amount: round(take, 6), remaining: round(b.qty - take, 6) });
    left -= take;
  }
  const shortfall = left > EPSILON ? round(left, 6) : 0;
  return { takes, deducted: round(amount - shortfall, 6), shortfall };
}
