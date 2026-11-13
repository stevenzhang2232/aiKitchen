import type { FastifyInstance } from 'fastify';
import {
  buildInventory, diffDays, dishDeductions, findFoodByName, formatAmount, friendlyAmount, fromBase, isUnit,
  preferredUnitForKind, round, toBase, unitKind, validateDishes,
  type CookMode, type Dish, type Inventory, type TastePrefs, type Unit, type UnitKind,
} from '@kitchen/core';
import type { Store } from '../store.js';
import type { AiService, RecipeContext, StockLine } from '../ai/service.js';
import { tx } from '../db.js';
import { bad, HttpError } from '../errors.js';
import { aiErrorToHttp } from './ai.js';

type Body = Record<string, unknown>;

const MODES: CookMode[] = ['dish', 'suggest', 'pick'];

function parseServings(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 20) bad('Enter how many people are eating (1–20).');
  return n;
}

export function registerCookRoutes(app: FastifyInstance, deps: { store: Store; getAi: () => AiService | null }) {
  const { store, getAi } = deps;

  /** Stock lines for the AI: one per food and unit kind, with the soonest expiry. */
  function stockLines(inv: Inventory): StockLine[] {
    const today = store.today();
    const foods = new Map(store.foods().map((f) => [f.id, f]));
    const batches = store.batches();
    const lines: StockLine[] = [];
    for (const [idStr, amounts] of Object.entries(inv)) {
      const food = foods.get(Number(idStr));
      if (!food || food.isSeasoning) continue;
      for (const [kind, amount] of Object.entries(amounts) as [UnitKind, number][]) {
        if (!(amount > 0)) continue;
        const dates = batches
          .filter((b) => b.foodId === food.id && unitKind(b.unit) === kind && b.expiryDate)
          .map((b) => b.expiryDate!)
          .sort();
        lines.push({
          foodId: food.id,
          name: food.name,
          category: food.category,
          kind,
          amount,
          unit: preferredUnitForKind(kind),
          expiresInDays: dates.length ? diffDays(today, dates[0]) : null,
        });
      }
    }
    return lines.sort((a, b) => (a.expiresInDays ?? 9999) - (b.expiresInDays ?? 9999));
  }

  function cartInventory(): Inventory {
    const inv: Inventory = {};
    for (const c of store.cart()) (inv[c.foodId] ??= {})[c.kind] = c.qty;
    return inv;
  }

  /** Add kitchen-friendly wording and a preview of what "I cooked it" would take from the fridge. */
  function present(dish: Dish, available: Inventory, fridge: Inventory) {
    const foods = new Map(store.foods().map((f) => [f.id, f]));
    return {
      ...dish,
      ingredients: dish.ingredients.map((i) => {
        const kind = unitKind(i.unit);
        const base = toBase(i.amount, i.unit);
        return {
          ...i,
          name: foods.get(i.foodId)?.name ?? `#${i.foodId}`,
          display: friendlyAmount(base, available[i.foodId]?.[kind] ?? 0, i.unit),
          exact: formatAmount(base, i.unit),
          howTo: i.howTo?.trim() || undefined,
        };
      }),
      seasoningNames: dish.seasonings.map((id) => foods.get(id)?.name ?? `#${id}`),
      deductions: dishDeductions(dish, fridge).map((l) => ({
        foodId: l.foodId,
        name: foods.get(l.foodId)?.name ?? `#${l.foodId}`,
        unit: l.unit,
        amount: round(fromBase(l.amount, l.unit), 3),
        available: round(fromBase(fridge[l.foodId]?.[l.kind] ?? 0, l.unit), 3),
      })),
    };
  }

  app.post<{ Body: Body }>('/api/cook/suggest', async (req) => {
    const b = req.body ?? {};
    const mode = b.mode as CookMode;
    if (!MODES.includes(mode)) bad('Choose how you want to cook.');
    const servings = parseServings(b.servings);
    const ai = getAi();
    if (!ai) throw new HttpError(400, 'Set up an AI model in Settings → AI model to get recipes.', 'ai-not-configured');

    let dishName: string | undefined;
    let taste = store.pref<TastePrefs | null>('taste', null);
    if (b.toCookId != null) {
      const item = store.toCook().find((x) => x.id === Number(b.toCookId));
      if (!item) bad('That dish is no longer in To cook.');
      if (mode !== 'dish') bad('To cook items continue as “I want a dish”.');
      dishName = item.dishName;
      taste = item.taste ?? taste;
    }
    if (mode === 'dish') {
      dishName = (typeof b.dishName === 'string' ? b.dishName.trim() : '') || dishName;
      if (!dishName) bad('Enter the dish you want to cook.');
      if (dishName.length > 80) bad('Keep the dish name under 80 characters.');
    }

    const foods = store.foods();
    const fridge = buildInventory(store.batches());
    const picked = mode === 'pick' ? cartInventory() : fridge;
    if (mode === 'pick' && !Object.keys(picked).length) bad('Pick some ingredients first.');
    // Foods the user avoids (allergies, dislikes) are never offered to the AI, so the checker rejects them.
    const avoided = new Set((taste?.avoid ?? []).map((n) => findFoodByName(foods, n)?.id).filter((x): x is number => x != null));
    const available: Inventory = Object.fromEntries(Object.entries(picked).filter(([fid]) => !avoided.has(Number(fid))));
    const stock = stockLines(available);
    if (mode === 'suggest' && !stock.length) {
      return { status: 'cannot', reason: 'Your fridge is empty, so there is nothing to cook with yet.' };
    }
    const owned = new Set([...store.ownedSeasonings()].filter((fid) => !avoided.has(fid)));
    const ctx: RecipeContext = {
      mode,
      servings,
      taste,
      dishName,
      stock,
      seasonings: foods.filter((f) => owned.has(f.id)).map((f) => ({ foodId: f.id, name: f.name })),
    };

    let previous: { answer: string; errors: string[] } | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      let answer;
      try {
        answer = await ai.suggestDishes(ctx, previous);
      } catch (e) {
        aiErrorToHttp(e);
      }
      // Link "missing" names to known foods so the step check recognises them.
      for (const d of answer.dishes) {
        for (const m of d.missing ?? []) {
          if (m.foodId == null || !foods.some((f) => f.id === m.foodId)) m.foodId = findFoodByName(foods, m.name)?.id ?? null;
        }
      }
      const check = validateDishes(answer.dishes, {
        foods,
        inventory: available,
        ownedSeasonings: owned,
        allowMissing: mode === 'dish',
        minDishes: 1,
        maxDishes: mode === 'dish' ? 1 : 3,
      });
      if (check.ok) {
        const dishes = check.dishes.map((d) => present({ ...d, servings }, available, fridge));
        if (mode === 'dish' && dishes[0].missing.length) return { status: 'missing', dishes, servings, dishName };
        return { status: 'ok', dishes, servings, dishName };
      }
      previous = { answer: answer.raw, errors: check.errors };
    }
    return {
      status: 'cannot',
      reason:
        mode === 'pick'
          ? 'The AI couldn’t make a dish from just these picks. Try adding or changing ingredients.'
          : 'The AI couldn’t suggest a dish that uses only what you have. Try again, or add more ingredients.',
      problems: previous?.errors ?? [],
    };
  });

  app.post<{ Body: Body }>('/api/cook/confirm', async (req) => {
    const b = req.body ?? {};
    const mode = b.mode as CookMode;
    if (!MODES.includes(mode)) bad('Unknown cooking mode.');
    const servings = parseServings(b.servings);
    const dish = (b.dish ?? {}) as Partial<Dish> & { name?: string };
    const dishName = typeof dish.name === 'string' ? dish.name.trim() : '';
    if (!dishName) bad('The dish needs a name.');
    const linesIn = Array.isArray(b.lines) ? (b.lines as Body[]) : [];
    const lines = linesIn.map((l) => {
      const unit = l.unit as Unit;
      const amount = Number(l.amount);
      if (!isUnit(unit) || !Number.isFinite(amount) || amount < 0) bad('Each amount must be 0 or more with a unit.');
      return { foodId: Number(l.foodId), unit, amount };
    });
    const toCookId = b.toCookId == null ? null : Number(b.toCookId);
    const missing = Array.isArray(dish.missing) ? dish.missing.map((m) => ({ name: String(m.name) })) : [];

    const historyId = tx(store.db, () => {
      const deductions: { foodId: number; name: string; amount: number; unit: Unit }[] = [];
      for (const l of lines) {
        if (!(l.amount > 0)) continue;
        const food = store.food(l.foodId);
        const plan = store.deduct(l.foodId, unitKind(l.unit), toBase(l.amount, l.unit));
        if (!(plan.deducted > 0)) continue;
        // One history line per food and kind of unit, in the unit first used.
        const same = deductions.find((d) => d.foodId === food.id && unitKind(d.unit) === unitKind(l.unit));
        if (same) same.amount = round(same.amount + fromBase(plan.deducted, same.unit), 3);
        else deductions.push({ foodId: food.id, name: food.name, amount: round(fromBase(plan.deducted, l.unit), 3), unit: l.unit });
      }
      const id = store.addHistory({
        dishName,
        cookedAt: store.now().toISOString(),
        servings,
        mode,
        deductions,
        missing,
        dish,
      });
      if (mode === 'pick') store.clearCart();
      if (toCookId != null && store.toCook().some((x) => x.id === toCookId)) store.deleteToCook(toCookId);
      store.touchFavorites(deductions.map((d) => d.foodId));
      return id;
    });
    const entry = store.history().find((h) => h.id === historyId)!;
    return {
      ok: true,
      historyId,
      summary: entry.deductions.map((d) => `${d.name} ${formatAmount(toBase(d.amount, d.unit), d.unit)}`).join(', '),
    };
  });
}
