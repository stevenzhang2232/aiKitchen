export type Unit = 'g' | 'kg' | 'pcs' | 'serving';
export type UnitKind = 'weight' | 'count' | 'serving';
export type Location = 'fridge' | 'freezer' | 'pantry';
export type Category =
  | 'vegetable'
  | 'fruit'
  | 'meat'
  | 'seafood'
  | 'egg_dairy'
  | 'staple'
  | 'tofu_bean'
  | 'mushroom'
  | 'aromatic'
  | 'seasoning'
  | 'other';

export const UNITS: Unit[] = ['g', 'kg', 'pcs', 'serving'];
export const LOCATIONS: Location[] = ['fridge', 'freezer', 'pantry'];
export const CATEGORIES: Category[] = [
  'vegetable', 'fruit', 'meat', 'seafood', 'egg_dairy', 'staple', 'tofu_bean', 'mushroom', 'aromatic', 'seasoning', 'other',
];

export interface Food {
  id: number;
  key: string;
  name: string;
  category: Category;
  aliases: string[];
  /** Unit the user picked the first time they added this food. null = not chosen yet. */
  defaultUnit: Unit | null;
  /** Unit suggested by the catalog for the first-add dialog. */
  suggestedUnit: Unit;
  defaultLocation: Location;
  image: string | null;
  /** Approximate weight of one piece, used for serving estimates. */
  pieceGrams: number | null;
  isSeasoning: boolean;
  custom: boolean;
}

export interface Source {
  title: string;
  url: string;
}

export type AiStatus = 'pending' | 'done' | 'none' | null;

export interface Batch {
  id: number;
  foodId: number;
  /** Base amount: grams for weight units, count for pcs, servings for serving. */
  qty: number;
  /** Unit the batch is displayed in. Weight batches always store grams in qty. */
  unit: Unit;
  location: Location;
  addedDate: string;
  expiryDate: string | null;
  expirySource: 'user' | 'ai' | null;
  aiStatus: AiStatus;
  aiNote: string | null;
  aiSources: Source[];
}

/** Base amounts in stock per unit kind. */
export type KindAmounts = Partial<Record<UnitKind, number>>;
export type Inventory = Record<number, KindAmounts>;

export interface TastePrefs {
  spice: 'none' | 'mild' | 'medium' | 'hot';
  avoid: string[];
  cuisines: string[];
}

export type CookMode = 'dish' | 'suggest' | 'pick';
