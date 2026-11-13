import { describe, it, expect } from 'vitest';
import { dishDeductions, findMentionedFoods, validateDishes, type Dish } from '../src/recipe';
import type { Inventory } from '../src/types';
import {
  chicken, darkSoy, egg, eggplant, FOODS, lightSoy, oil, onion, peanut, pork, potato, salt, scallion, sugar, tomato,
} from './fixtures';

const inventory: Inventory = {
  [tomato.id]: { count: 3 },
  [egg.id]: { count: 4 },
  [pork.id]: { weight: 300 },
  [potato.id]: { weight: 1200 },
  [scallion.id]: { count: 2 },
};
const owned = new Set([salt.id, oil.id, lightSoy.id]);

function dish(partial: Partial<Dish> = {}): Dish {
  return {
    name: 'Tomato egg stir-fry',
    minutes: 15,
    servings: 2,
    ingredients: [
      { foodId: tomato.id, amount: 2, unit: 'pcs' },
      { foodId: egg.id, amount: 3, unit: 'pcs' },
    ],
    seasonings: [salt.id, oil.id],
    missing: [],
    steps: ['Beat the eggs with a pinch of salt.', 'Cut the tomatoes into wedges.', 'Heat oil, scramble eggs, add tomatoes and a splash of water.'],
    ...partial,
  };
}

const base = { foods: FOODS, inventory, ownedSeasonings: owned, allowMissing: false };

describe('recipe check (acceptance 20)', () => {
  it('accepts a dish that only uses stock, owned seasonings and water', () => {
    const r = validateDishes([dish()], base);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('rejects an ingredient that is not in stock', () => {
    const r = validateDishes([dish({ ingredients: [{ foodId: chicken.id, amount: 200, unit: 'g' }], steps: ['Fry the chicken.'] })], base);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Chicken breast is not in stock/);
  });

  it('rejects amounts above stock', () => {
    const r = validateDishes([dish({ ingredients: [{ foodId: egg.id, amount: 6, unit: 'pcs' }], steps: ['Scramble the eggs.'] })], base);
    expect(r.errors.join(' ')).toMatch(/Egg: the dishes need 6 pcs in total but only 4 pcs is available/);
  });

  it('checks the total of a whole meal, not just each dish', () => {
    const d1 = dish({ name: 'A', ingredients: [{ foodId: pork.id, amount: 200, unit: 'g' }], steps: ['Fry the pork.'] });
    const d2 = dish({ name: 'B', ingredients: [{ foodId: pork.id, amount: 0.15, unit: 'kg' }], steps: ['Stew the pork.'] });
    const r = validateDishes([d1, d2], base);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Pork: the dishes need 350 g in total but only 300 g/);
    expect(validateDishes([d1], base).ok).toBe(true);
  });

  it('rejects a unit that does not match how the food is stocked', () => {
    const r = validateDishes([dish({ ingredients: [{ foodId: tomato.id, amount: 200, unit: 'g' }], steps: ['Slice the tomato.'] })], base);
    expect(r.errors.join(' ')).toMatch(/Tomato is stocked in pcs, not g/);
  });

  it('rejects seasonings the user does not have', () => {
    const r = validateDishes([dish({ seasonings: [salt.id, sugar.id], steps: ['Beat eggs.', 'Add tomatoes.'] })], base);
    expect(r.errors.join(' ')).toMatch(/does not have Sugar/);
  });

  it('rejects steps that mention unlisted stock, marinades or garnishes', () => {
    const r = validateDishes([dish({ steps: ['Marinate with dark soy sauce.', 'Garnish with chopped scallions.', 'Fry eggs and tomatoes.'] })], base);
    const all = r.errors.join(' ');
    expect(all).toMatch(/steps use Dark soy sauce, which the user does not have/);
    expect(all).toMatch(/mention Scallion, which is not in the ingredient list/);
  });

  it('rejects steps that mention food not in stock at all', () => {
    const r = validateDishes([dish({ steps: ['Fry eggs and tomatoes.', 'Top with crushed peanuts.'] })], base);
    expect(r.errors.join(' ')).toMatch(/Peanut/);
  });

  it('moves seasonings listed as ingredients to the seasoning list', () => {
    const r = validateDishes([dish({ ingredients: [{ foodId: tomato.id, amount: 1, unit: 'pcs' }, { foodId: salt.id, amount: 2, unit: 'g' }], steps: ['Salt the tomato.'] })], base);
    expect(r.ok).toBe(true);
    expect(r.dishes[0].seasonings).toContain(salt.id);
    expect(r.dishes[0].ingredients.map((i) => i.foodId)).toEqual([tomato.id]);
  });

  it('enforces the number of dishes', () => {
    expect(validateDishes([], base).ok).toBe(false);
    expect(validateDishes([dish(), dish(), dish(), dish()], base).ok).toBe(false);
    expect(validateDishes([dish(), dish()], { ...base, maxDishes: 1 }).ok).toBe(false);
  });

  it('requires minutes and steps', () => {
    const r = validateDishes([dish({ minutes: 0, steps: [] })], base);
    expect(r.errors.join(' ')).toMatch(/minutes/);
    expect(r.errors.join(' ')).toMatch(/steps/);
  });

  it('does not allow missing ingredients unless asked', () => {
    const d = dish({ missing: [{ name: 'Chicken breast', foodId: chicken.id, amount: 300, unit: 'g' }] });
    expect(validateDishes([d], base).ok).toBe(false);
  });

  it('allows marked missing ingredients for "Cook anyway"', () => {
    const d = dish({
      name: 'Kung pao chicken',
      ingredients: [{ foodId: scallion.id, amount: 2, unit: 'pcs' }],
      seasonings: [lightSoy.id, darkSoy.id],
      missing: [
        { name: 'Chicken breast', foodId: chicken.id, amount: 300, unit: 'g' },
        { name: 'Peanuts', foodId: peanut.id, amount: 50, unit: 'g' },
        { name: 'Dark soy sauce', foodId: darkSoy.id },
        { name: 'Dried chili', foodId: null },
      ],
      steps: ['Dice the chicken breast and marinate with soy sauce and dark soy sauce.', 'Fry dried chili, add chicken, scallions and peanuts.'],
    });
    const r = validateDishes([d], { ...base, allowMissing: true, maxDishes: 1 });
    expect(r.errors).toEqual([]);
  });
});

describe('finding foods in step text', () => {
  it('matches whole words only, with plurals', () => {
    expect([...findMentionedFoods('Bring to a boil; add eggs.', FOODS)]).toEqual([egg.id]);
    expect(findMentionedFoods('Roast the eggplant.', FOODS)).toEqual(new Set([eggplant.id]));
    expect(findMentionedFoods('Dice 2 potatoes and 1 onion.', FOODS)).toEqual(new Set([potato.id, onion.id]));
  });

  it('prefers the longest name', () => {
    expect(findMentionedFoods('Add dark soy sauce.', FOODS)).toEqual(new Set([darkSoy.id]));
    expect(findMentionedFoods('Add soy sauce.', FOODS)).toEqual(new Set([lightSoy.id]));
    expect(findMentionedFoods('Top with green onion.', FOODS)).toEqual(new Set([scallion.id]));
  });

  it('never flags water', () => {
    expect(findMentionedFoods('Add 200 ml of water and boiling water.', FOODS).size).toBe(0);
  });
});

describe('deductions for "I cooked it"', () => {
  it('merges ingredients per food and converts kg to g', () => {
    const lines = dishDeductions(dish({
      ingredients: [
        { foodId: pork.id, amount: 100, unit: 'g' },
        { foodId: pork.id, amount: 0.1, unit: 'kg' },
        { foodId: tomato.id, amount: 1, unit: 'pcs' },
      ],
    }), inventory);
    expect(lines).toEqual([
      { foodId: pork.id, kind: 'weight', unit: 'g', amount: 200, requested: 200 },
      { foodId: tomato.id, kind: 'count', unit: 'pcs', amount: 1, requested: 1 },
    ]);
  });

  it('caps at what is in stock so nothing goes negative', () => {
    const lines = dishDeductions(dish({ ingredients: [{ foodId: egg.id, amount: 10, unit: 'pcs' }, { foodId: chicken.id, amount: 300, unit: 'g' }] }), inventory);
    expect(lines).toEqual([{ foodId: egg.id, kind: 'count', unit: 'pcs', amount: 4, requested: 10 }]);
  });
});
