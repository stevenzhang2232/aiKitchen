import type { KindAmounts, Unit, UnitKind } from './types';

export const EPSILON = 1e-6;

export function unitKind(unit: Unit): UnitKind {
  switch (unit) {
    case 'g':
    case 'kg':
      return 'weight';
    case 'pcs':
      return 'count';
    case 'serving':
      return 'serving';
  }
}

export function isUnit(value: unknown): value is Unit {
  return value === 'g' || value === 'kg' || value === 'pcs' || value === 'serving';
}

/** Convert an amount typed by the user (e.g. 1.5 kg) into the stored base amount (1500 g). */
export function toBase(amount: number, unit: Unit): number {
  return unit === 'kg' ? amount * 1000 : amount;
}

/** Convert a base amount back into the given unit (e.g. 1500 -> 1.5 for kg). */
export function fromBase(base: number, unit: Unit): number {
  return unit === 'kg' ? base / 1000 : base;
}

/** The amount added by one click: 100 g, 1 kg, 1 pc or 1 serving. Returned as base amount. */
export function quickAddBase(unit: Unit): number {
  switch (unit) {
    case 'g':
      return 100;
    case 'kg':
      return 1000;
    case 'pcs':
    case 'serving':
      return 1;
  }
}

/** Two units can be added together only when they measure the same thing. */
export function canCombine(a: Unit, b: Unit): boolean {
  return unitKind(a) === unitKind(b);
}

export function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

function trimNumber(value: number, decimals = 2): string {
  return String(round(value, decimals));
}

/**
 * Human readable amount. Weight shows kg when the batch prefers kg or the amount reaches 1 kg.
 */
export function formatAmount(base: number, unit: Unit): string {
  const kind = unitKind(unit);
  if (kind === 'weight') {
    if (unit === 'kg' || base >= 1000) return `${trimNumber(base / 1000, 2)} kg`;
    return `${trimNumber(base, 0)} g`;
  }
  const n = trimNumber(base, 2);
  if (kind === 'count') return `${n} ${base === 1 ? 'pc' : 'pcs'}`;
  return `${n} ${base === 1 ? 'serving' : 'servings'}`;
}

export function preferredUnitForKind(kind: UnitKind): Unit {
  return kind === 'weight' ? 'g' : kind === 'count' ? 'pcs' : 'serving';
}

export function formatKindAmounts(amounts: KindAmounts, weightUnit: Unit = 'g'): string {
  const parts: string[] = [];
  if (amounts.weight && amounts.weight > EPSILON) parts.push(formatAmount(amounts.weight, weightUnit === 'kg' ? 'kg' : 'g'));
  if (amounts.count && amounts.count > EPSILON) parts.push(formatAmount(amounts.count, 'pcs'));
  if (amounts.serving && amounts.serving > EPSILON) parts.push(formatAmount(amounts.serving, 'serving'));
  return parts.length ? parts.join(' + ') : '0';
}

export function addKindAmount(target: KindAmounts, kind: UnitKind, base: number): KindAmounts {
  target[kind] = round((target[kind] ?? 0) + base, 6);
  return target;
}

/**
 * Short, kitchen-friendly wording for using `amount` out of `available` (both base amounts).
 * Examples: "all of it", "half of what's left", "one third of what's left", "about 200 g".
 */
export function friendlyAmount(amount: number, available: number, unit: Unit): string {
  const exact = formatAmount(amount, unit);
  if (available <= EPSILON) return exact;
  const ratio = amount / available;
  const close = (r: number) => Math.abs(ratio - r) <= 0.04;
  if (ratio >= 0.97) return `all of it (${exact})`;
  if (unitKind(unit) === 'count' && Number.isInteger(amount)) return exact;
  if (close(0.5)) return `half of what's left (${exact})`;
  if (close(1 / 3)) return `one third of what's left (${exact})`;
  if (close(2 / 3)) return `two thirds of what's left (${exact})`;
  if (close(0.25)) return `a quarter of what's left (${exact})`;
  return exact;
}
