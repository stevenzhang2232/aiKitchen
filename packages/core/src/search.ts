import type { Food } from './types';

export function normalizeText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim();
}

function singular(s: string): string {
  if (s.endsWith('oes')) return s.slice(0, -2);
  if (s.endsWith('ies')) return `${s.slice(0, -3)}y`;
  if (s.endsWith('es') && /(ch|sh|x|s)es$/.test(s)) return s.slice(0, -2);
  if (s.endsWith('s') && !s.endsWith('ss')) return s.slice(0, -1);
  return s;
}

function termsOf(food: Food): string[] {
  return [food.name, ...food.aliases].map(normalizeText).filter(Boolean);
}

function scoreTerm(term: string, q: string): number {
  if (term === q) return 100;
  if (term.startsWith(q)) return 80;
  if (term.split(' ').some((w) => w.startsWith(q))) return 60;
  if (term.includes(q)) return 40;
  return 0;
}

export interface SearchHit {
  food: Food;
  score: number;
}

/** Search foods and seasonings by English name, English alias or Chinese name. */
export function searchFoods(foods: Food[], query: string, limit = 20): Food[] {
  const q = normalizeText(query);
  if (!q) return [];
  const qs = singular(q);
  const hits: SearchHit[] = [];
  for (const food of foods) {
    let best = 0;
    for (const t of termsOf(food)) {
      best = Math.max(best, scoreTerm(t, q), q !== qs ? scoreTerm(t, qs) - 1 : 0);
    }
    if (best > 0) hits.push({ food, score: best });
  }
  hits.sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name));
  return hits.slice(0, limit).map((h) => h.food);
}

/** Exact match on name or alias (case, spacing and plural insensitive). */
export function findFoodByName(foods: Food[], name: string): Food | undefined {
  const q = normalizeText(name);
  if (!q) return undefined;
  const qs = singular(q);
  for (const food of foods) {
    for (const t of termsOf(food)) {
      if (t === q || t === qs || singular(t) === qs) return food;
    }
  }
  return undefined;
}
