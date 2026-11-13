import type { Batch, Food } from '../src/types';

let nextId = 1;
export function food(partial: Partial<Food> & { name: string }): Food {
  return {
    id: partial.id ?? nextId++,
    key: partial.key ?? partial.name.toLowerCase().replace(/\s+/g, '_'),
    category: 'vegetable',
    aliases: [],
    defaultUnit: null,
    suggestedUnit: 'pcs',
    defaultLocation: 'fridge',
    image: null,
    pieceGrams: null,
    isSeasoning: false,
    custom: false,
    ...partial,
  };
}

let nextBatch = 1;
export function batch(partial: Partial<Batch> & { foodId: number }): Batch {
  return {
    id: partial.id ?? nextBatch++,
    qty: 1,
    unit: 'pcs',
    location: 'fridge',
    addedDate: '2026-11-10',
    expiryDate: null,
    expirySource: null,
    aiStatus: null,
    aiNote: null,
    aiSources: [],
    ...partial,
  };
}

export const tomato = food({ id: 1, name: 'Tomato', aliases: ['tomatoes', '番茄', '西红柿'], pieceGrams: 150 });
export const egg = food({ id: 2, name: 'Egg', category: 'egg_dairy', aliases: ['eggs', '鸡蛋'], pieceGrams: 50 });
export const pork = food({ id: 3, name: 'Pork', category: 'meat', aliases: ['猪肉'], suggestedUnit: 'g' });
export const potato = food({ id: 4, name: 'Potato', aliases: ['土豆', '马铃薯'], pieceGrams: 200 });
export const scallion = food({ id: 5, name: 'Scallion', category: 'aromatic', aliases: ['green onion', 'spring onion', '葱'] });
export const onion = food({ id: 6, name: 'Onion', aliases: ['洋葱'] });
export const eggplant = food({ id: 7, name: 'Eggplant', aliases: ['aubergine', '茄子'] });
export const salt = food({ id: 20, name: 'Salt', category: 'seasoning', aliases: ['盐'], isSeasoning: true });
export const oil = food({ id: 21, name: 'Oil', category: 'seasoning', aliases: ['cooking oil', '食用油'], isSeasoning: true });
export const lightSoy = food({ id: 22, name: 'Light soy sauce', category: 'seasoning', aliases: ['soy sauce', 'light soy', '生抽'], isSeasoning: true });
export const darkSoy = food({ id: 23, name: 'Dark soy sauce', category: 'seasoning', aliases: ['dark soy', '老抽'], isSeasoning: true });
export const sugar = food({ id: 24, name: 'Sugar', category: 'seasoning', aliases: ['糖'], isSeasoning: true });
export const chicken = food({ id: 8, name: 'Chicken breast', category: 'meat', aliases: ['chicken', '鸡胸肉'] });
export const peanut = food({ id: 9, name: 'Peanut', category: 'tofu_bean', aliases: ['peanuts', '花生'] });
export const rice = food({ id: 10, name: 'Rice', category: 'staple', aliases: ['大米'], suggestedUnit: 'g' });
export const servingSoup = food({ id: 11, name: 'Leftover soup', category: 'other', suggestedUnit: 'serving' });

export const FOODS: Food[] = [
  tomato, egg, pork, potato, scallion, onion, eggplant, salt, oil, lightSoy, darkSoy, sugar, chicken, peanut, rice, servingSoup,
];
