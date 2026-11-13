import type { Category, Food } from '@kitchen/core';
import images from '../foodImages.json';

const manifest = images as Record<string, string>;

export const CATEGORY_ICON: Record<Category, string> = {
  vegetable: '🥬',
  fruit: '🍎',
  meat: '🥩',
  seafood: '🐟',
  egg_dairy: '🥚',
  staple: '🍚',
  tofu_bean: '🫘',
  mushroom: '🍄',
  aromatic: '🧄',
  seasoning: '🧂',
  other: '🍽️',
};

export const CATEGORY_LABEL: Record<Category, string> = {
  vegetable: 'Vegetable',
  fruit: 'Fruit',
  meat: 'Meat',
  seafood: 'Seafood',
  egg_dairy: 'Eggs and dairy',
  staple: 'Staple',
  tofu_bean: 'Tofu, beans and nuts',
  mushroom: 'Mushroom',
  aromatic: 'Aromatic',
  seasoning: 'Seasoning',
  other: 'Other',
};

export function imageUrl(food: Food): string | null {
  const file = food.image ? manifest[food.image] : undefined;
  return file ? `/foods/${file}` : null;
}

export function FoodImage({ food, size = 'md' }: { food: Food; size?: 'sm' | 'md' }) {
  const url = imageUrl(food);
  return (
    <span className={`food-img food-img-${size}`} aria-hidden="true">
      {url ? <img src={url} alt="" loading="lazy" draggable={false} /> : <span className="food-icon">{CATEGORY_ICON[food.category]}</span>}
    </span>
  );
}
