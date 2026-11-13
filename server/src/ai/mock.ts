import type { Category, Dish, Location } from '@kitchen/core';
import { AiError } from './client.js';
import type { AiService, ReceiptLine, RecipeContext, ShelfLifeAnswer, ShelfLifeQuery } from './service.js';

/** Days by category for the fake shelf-life answers. */
const MOCK_DAYS: Partial<Record<Category, Record<Location, number>>> = {
  vegetable: { fridge: 5, freezer: 240, pantry: 7 },
  fruit: { fridge: 7, freezer: 180, pantry: 4 },
  meat: { fridge: 2, freezer: 120, pantry: 0 },
  seafood: { fridge: 1, freezer: 90, pantry: 0 },
  egg_dairy: { fridge: 14, freezer: 60, pantry: 1 },
  staple: { fridge: 30, freezer: 180, pantry: 180 },
  tofu_bean: { fridge: 3, freezer: 90, pantry: 120 },
  mushroom: { fridge: 4, freezer: 120, pantry: 2 },
  aromatic: { fridge: 7, freezer: 90, pantry: 14 },
};

/**
 * Deterministic stand-in for the AI, used by automated tests and for trying the app
 * without an API key. Special dish names drive the retry tests:
 * "invalid ..." answers wrongly once, "impossible ..." always answers wrongly.
 */
export class MockAiService implements AiService {
  readonly kind = 'mock' as const;
  calls = { shelfLife: 0, receipt: 0, dishes: 0 };
  /** Set to make every call fail like a network outage. */
  offline = false;

  private check() {
    if (this.offline) throw new AiError('Couldn’t reach the AI service. Check your internet connection.', 'network');
  }

  async testConnection() {
    this.check();
    return 'Connected to the built-in test AI.';
  }

  async estimateShelfLife(q: ShelfLifeQuery): Promise<ShelfLifeAnswer | null> {
    this.check();
    this.calls.shelfLife++;
    const days = MOCK_DAYS[q.category]?.[q.location];
    if (days == null || days === 0) return { days: null, note: 'Not enough reliable information for this storage method.', sources: [] };
    return {
      days,
      note: `Test estimate for ${q.foodName.toLowerCase()} kept in the ${q.location}, sealed and at a steady temperature.`,
      sources: [{ title: 'Example food storage chart', url: 'https://example.org/food-storage-chart' }],
    };
  }

  async readReceipt(imageDataUrl: string): Promise<ReceiptLine[]> {
    this.check();
    this.calls.receipt++;
    if (!imageDataUrl.startsWith('data:image/')) throw new AiError('That file is not an image.', 'format');
    return [
      { name: 'Tomato', qty: 3, unit: 'pcs' },
      { name: '五花肉', qty: 500, unit: 'g' },
      { name: 'Milk', qty: 2, unit: 'pcs' },
      { name: 'Soy sauce', qty: 1, unit: 'pcs' },
      { name: 'Dragon fruit', qty: 1, unit: 'pcs' },
    ];
  }

  async suggestDishes(ctx: RecipeContext, previous?: { answer: string; errors: string[] }) {
    this.check();
    this.calls.dishes++;
    const name = (ctx.dishName ?? '').toLowerCase();
    const bad = name.startsWith('impossible') || (name.startsWith('invalid') && !previous);
    const dishes = bad ? [this.badDish(ctx)] : ctx.mode === 'dish' ? [this.namedDish(ctx)] : this.mealFromStock(ctx);
    return { dishes, raw: JSON.stringify({ dishes }) };
  }

  private seasoningIds(ctx: RecipeContext, names: string[]) {
    return ctx.seasonings.filter((s) => names.includes(s.name)).map((s) => s.foodId);
  }

  private badDish(ctx: RecipeContext): Dish {
    return {
      name: ctx.dishName || 'Broken dish',
      minutes: 10,
      servings: ctx.servings,
      ingredients: [{ foodId: 999999, amount: 1, unit: 'pcs' }],
      seasonings: [],
      missing: [],
      steps: ['Cook the unicorn.'],
    };
  }

  private namedDish(ctx: RecipeContext): Dish {
    const want = (ctx.dishName ?? '').toLowerCase();
    const used = ctx.stock.filter((s) => s.name.toLowerCase().split(' ').some((w) => w.length > 3 && want.includes(w)));
    const missing: Dish['missing'] = [];
    // Words in the dish name that are not in stock become "missing" (simple test behaviour).
    for (const word of ['chicken', 'peanuts', 'beef', 'shrimp']) {
      if (want.includes(word) && !used.some((s) => s.name.toLowerCase().includes(word))) {
        missing.push({ name: word === 'peanuts' ? 'Peanuts' : word[0].toUpperCase() + word.slice(1), amount: word === 'peanuts' ? 50 : 300, unit: 'g' });
      }
    }
    const pick = used.length ? used : ctx.stock.slice(0, 1);
    const ingredients = pick.map((s) => ({
      foodId: s.foodId,
      amount: s.kind === 'weight' ? Math.min(s.amount, 200) : Math.min(s.amount, 2),
      unit: s.kind === 'weight' ? ('g' as const) : s.unit,
      howTo: 'part of what you have',
    }));
    const seasonings = this.seasoningIds(ctx, ['Oil', 'Salt']);
    const steps = [
      `Prepare the ${pick.map((s) => s.name.toLowerCase()).join(' and ')}.`,
      ...missing.map((m) => `Add the ${m.name.toLowerCase()} (missing).`),
      `Cook everything for a few minutes${seasonings.length ? ' and season to taste' : ''}.`,
    ];
    return { name: ctx.dishName || 'Dish', minutes: 20, servings: ctx.servings, ingredients, seasonings, missing, steps };
  }

  private mealFromStock(ctx: RecipeContext): Dish[] {
    const usable = ctx.stock
      .filter((s) => s.amount > 0 && s.category !== 'aromatic' && (s.expiresInDays == null || s.expiresInDays >= 0))
      .sort((a, b) => (a.expiresInDays ?? 999) - (b.expiresInDays ?? 999));
    if (!usable.length) return [];
    const seasonings = this.seasoningIds(ctx, ['Oil', 'Salt']);
    const take = (s: (typeof usable)[number], share: number) => ({
      foodId: s.foodId,
      amount: s.kind === 'weight' ? Math.max(1, Math.floor(s.amount * share)) : Math.max(1, Math.floor(s.amount * share)),
      unit: s.kind === 'weight' ? ('g' as const) : s.unit,
      howTo: share >= 1 ? 'all of what you have' : "half of what's left",
    });
    const share = ctx.mode === 'pick' ? 1 : 0.5;
    const first = usable.slice(0, 2);
    const dishes: Dish[] = [
      {
        name: `${first.map((s) => s.name).join(' and ')} stir-fry`,
        minutes: 15,
        servings: ctx.servings,
        ingredients: first.map((s) => take(s, share)),
        seasonings,
        missing: [],
        steps: [
          `Cut the ${first.map((s) => s.name.toLowerCase()).join(' and the ')} into bite-size pieces.`,
          'Stir-fry over high heat until cooked through, adding a splash of water if it sticks.',
          seasonings.length ? 'Season to taste and serve.' : 'Serve hot.',
        ],
      },
    ];
    const third = usable[2];
    if (third) {
      dishes.push({
        name: `Simple ${third.name.toLowerCase()} soup`,
        minutes: 25,
        servings: ctx.servings,
        ingredients: [take(third, share)],
        seasonings: this.seasoningIds(ctx, ['Salt']),
        missing: [],
        steps: [`Simmer the ${third.name.toLowerCase()} in water for 20 minutes.`, 'Season and serve.'],
      });
    }
    return dishes;
  }
}
