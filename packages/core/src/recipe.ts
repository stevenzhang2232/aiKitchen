import type { Food, Inventory, KindAmounts, Unit, UnitKind } from './types';
import { addKindAmount, EPSILON, formatAmount, isUnit, preferredUnitForKind, round, toBase, unitKind } from './units';
import { normalizeText } from './search';

export interface RecipeIngredient {
  foodId: number;
  amount: number;
  unit: Unit;
  /** Kitchen-friendly wording, e.g. "half of what's left". */
  howTo?: string;
}

export interface MissingItem {
  name: string;
  foodId?: number | null;
  amount?: number | null;
  unit?: Unit | null;
}

export interface Dish {
  name: string;
  minutes: number;
  servings: number;
  ingredients: RecipeIngredient[];
  /** Food ids of seasonings used. */
  seasonings: number[];
  missing: MissingItem[];
  steps: string[];
}

export interface ValidateOptions {
  foods: Food[];
  /** Stock the dishes may use (whole fridge, or the cart in "pick" mode). */
  inventory: Inventory;
  /** Seasonings marked as "have". */
  ownedSeasonings: Set<number>;
  /** Only "I want a dish" with "Cook anyway" may list missing ingredients. */
  allowMissing: boolean;
  minDishes?: number;
  maxDishes?: number;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  /** Dishes after normalization (seasonings listed as ingredients are moved). */
  dishes: Dish[];
}

/** Words that are always allowed in steps even though they are not stock. */
const ALWAYS_ALLOWED = new Set(['water', 'ice water', 'hot water', 'cold water', 'boiling water', 'warm water']);

interface Term {
  text: string;
  foodId: number;
}

function buildTerms(foods: Food[]): Term[] {
  const terms: Term[] = [];
  for (const f of foods) {
    for (const t of [f.name, ...f.aliases]) {
      const n = normalizeText(t);
      if (!n || /[^\x20-\x7e]/.test(n) || ALWAYS_ALLOWED.has(n)) continue;
      terms.push({ text: n, foodId: f.id });
    }
  }
  // Longest first so "dark soy sauce" wins over "soy sauce".
  terms.sort((a, b) => b.text.length - a.text.length);
  return terms;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find catalog foods mentioned in free text. Matches whole words (with simple plurals),
 * longest names first, and never matches the same words twice.
 * `blocked` phrases (e.g. names of missing items) are removed before scanning.
 */
export function findMentionedFoods(text: string, foods: Food[], blocked: string[] = []): Set<number> {
  let work = ` ${normalizeText(text).replace(/[^a-z0-9 ]+/g, ' ')} `;
  for (const b of blocked) {
    const n = normalizeText(b).replace(/[^a-z0-9 ]+/g, ' ').trim();
    if (n) work = work.replace(new RegExp(`(?<=\\W)${escapeRe(n)}(?:es|s)?(?=\\W)`, 'g'), ' # ');
  }
  for (const w of ALWAYS_ALLOWED) {
    work = work.replace(new RegExp(`(?<=\\W)${escapeRe(w)}(?=\\W)`, 'g'), ' # ');
  }
  const found = new Set<number>();
  for (const term of buildTerms(foods)) {
    const re = new RegExp(`(?<=\\W)${escapeRe(term.text)}(?:es|s)?(?=\\W)`, 'g');
    if (re.test(work)) {
      found.add(term.foodId);
      work = work.replace(re, ' # ');
    }
  }
  return found;
}

function stockFor(inv: Inventory, foodId: number): KindAmounts {
  return inv[foodId] ?? {};
}

/** Move seasonings that the AI listed as ingredients into the seasonings list. */
export function normalizeDish(dish: Dish, foods: Food[]): Dish {
  const byId = new Map(foods.map((f) => [f.id, f]));
  const seasonings = new Set(dish.seasonings ?? []);
  const ingredients: RecipeIngredient[] = [];
  for (const ing of dish.ingredients ?? []) {
    if (byId.get(ing.foodId)?.isSeasoning) seasonings.add(ing.foodId);
    else ingredients.push(ing);
  }
  return {
    ...dish,
    ingredients,
    seasonings: [...seasonings],
    missing: dish.missing ?? [],
    steps: dish.steps ?? [],
  };
}

/**
 * Check AI dishes against the rules: only stock and owned seasonings (water excepted),
 * amounts within stock for the whole set of dishes, and steps may not mention anything else.
 */
export function validateDishes(input: Dish[], opts: ValidateOptions): ValidationResult {
  const errors: string[] = [];
  const byId = new Map(opts.foods.map((f) => [f.id, f]));
  const min = opts.minDishes ?? 1;
  const max = opts.maxDishes ?? 3;
  const dishes = (Array.isArray(input) ? input : []).map((d) => normalizeDish(d, opts.foods));
  if (dishes.length < min || dishes.length > max) {
    errors.push(`Return between ${min} and ${max} dishes (got ${dishes.length}).`);
  }
  const used: Inventory = {};
  for (const dish of dishes) {
    const label = dish.name?.trim() || 'Unnamed dish';
    if (!dish.name?.trim()) errors.push('Every dish needs a name.');
    if (!(Number.isFinite(dish.minutes) && dish.minutes > 0)) errors.push(`${label}: give the estimated minutes.`);
    if (!dish.steps.length || dish.steps.some((s) => typeof s !== 'string' || !s.trim())) {
      errors.push(`${label}: give the cooking steps.`);
    }
    if (dish.missing.length && !opts.allowMissing) {
      errors.push(`${label}: uses ingredients that are not in stock (${dish.missing.map((m) => m.name).join(', ')}).`);
    }
    const allowed = new Set<number>();
    for (const ing of dish.ingredients) {
      const food = byId.get(ing.foodId);
      if (!food) {
        errors.push(`${label}: unknown ingredient id ${ing.foodId}.`);
        continue;
      }
      allowed.add(food.id);
      if (!isUnit(ing.unit) || !(Number.isFinite(ing.amount) && ing.amount > 0)) {
        errors.push(`${label}: ${food.name} needs a positive amount and a unit (g, kg, pcs or serving).`);
        continue;
      }
      const kind = unitKind(ing.unit);
      const stock = stockFor(opts.inventory, food.id);
      if (!(stock[kind] && stock[kind]! > EPSILON)) {
        const have = (Object.keys(stock) as UnitKind[]).filter((k) => (stock[k] ?? 0) > EPSILON);
        if (have.length) {
          errors.push(`${label}: ${food.name} is stocked in ${have.map(preferredUnitForKind).join('/')}, not ${ing.unit}.`);
        } else {
          errors.push(`${label}: ${food.name} is not in stock.`);
        }
        continue;
      }
      addKindAmount((used[food.id] ??= {}), kind, toBase(ing.amount, ing.unit));
    }
    for (const sid of dish.seasonings) {
      const food = byId.get(sid);
      if (!food) {
        errors.push(`${label}: unknown seasoning id ${sid}.`);
        continue;
      }
      const listedMissing = opts.allowMissing && dish.missing.some((m) => m.foodId === sid);
      if (!opts.ownedSeasonings.has(sid) && !listedMissing) {
        errors.push(`${label}: the user does not have ${food.name}.`);
      }
    }
    for (const sid of opts.ownedSeasonings) allowed.add(sid);
    for (const sid of dish.seasonings) allowed.add(sid);
    const blocked: string[] = [];
    if (opts.allowMissing) {
      for (const m of dish.missing) {
        if (m.foodId != null) allowed.add(m.foodId);
        if (m.name) blocked.push(m.name);
      }
    }
    const text = [...dish.steps, ...dish.ingredients.map((i) => i.howTo ?? '')].join('\n');
    for (const id of findMentionedFoods(text, opts.foods, blocked)) {
      if (!allowed.has(id)) {
        const f = byId.get(id)!;
        errors.push(
          f.isSeasoning
            ? `${label}: the steps use ${f.name}, which the user does not have.`
            : `${label}: the steps mention ${f.name}, which is not in the ingredient list.`,
        );
      }
    }
  }
  for (const [id, amounts] of Object.entries(used)) {
    const stock = stockFor(opts.inventory, Number(id));
    for (const [kind, amount] of Object.entries(amounts) as [UnitKind, number][]) {
      const have = stock[kind] ?? 0;
      if (amount > have + EPSILON) {
        const unit = preferredUnitForKind(kind);
        errors.push(
          `${byId.get(Number(id))?.name ?? id}: the dishes need ${formatAmount(amount, unit)} in total but only ${formatAmount(have, unit)} is available.`,
        );
      }
    }
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)], dishes };
}

export interface DeductionLine {
  foodId: number;
  kind: UnitKind;
  unit: Unit;
  /** Base amount to take from stock. */
  amount: number;
  /** Base amount the recipe asked for. */
  requested: number;
}

/**
 * What "I cooked it" takes from stock: the dish's ingredients, merged per food,
 * capped at what is actually available (so stock never goes negative).
 */
export function dishDeductions(dish: Dish, inventory: Inventory): DeductionLine[] {
  const merged = new Map<string, DeductionLine>();
  for (const ing of dish.ingredients) {
    if (!isUnit(ing.unit) || !(ing.amount > 0)) continue;
    const kind = unitKind(ing.unit);
    const key = `${ing.foodId}:${kind}`;
    const line = merged.get(key) ?? { foodId: ing.foodId, kind, unit: ing.unit, amount: 0, requested: 0 };
    line.requested = round(line.requested + toBase(ing.amount, ing.unit), 6);
    merged.set(key, line);
  }
  for (const line of merged.values()) {
    const have = inventory[line.foodId]?.[line.kind] ?? 0;
    line.amount = round(Math.min(line.requested, have), 6);
  }
  return [...merged.values()].filter((l) => l.amount > EPSILON);
}
