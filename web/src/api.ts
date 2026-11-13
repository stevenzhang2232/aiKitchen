import type { Batch, FavoriteStat, Food, Location, TastePrefs, Unit, UnitKind } from '@kitchen/core';

export interface CartItem {
  foodId: number;
  kind: UnitKind;
  qty: number;
}

export interface MissingItem {
  name: string;
  foodId?: number | null;
  amount?: number | null;
  unit?: Unit | null;
}

export interface ToCookItem {
  id: number;
  dishName: string;
  servings: number;
  taste: TastePrefs | null;
  missing: MissingItem[];
  savedAt: string;
}

export interface HistoryItem {
  id: number;
  dishName: string;
  cookedAt: string;
  servings: number;
  mode: string;
  deductions: { foodId: number; name: string; amount: number; unit: Unit }[];
  missing: { name: string }[];
}

export interface AiInfo {
  configured: boolean;
  search: boolean;
  vision: boolean;
  model: string;
}

export interface AppState {
  today: string;
  foods: Food[];
  commonFoods: number[];
  batches: Batch[];
  seasonings: { foodId: number; have: boolean }[];
  pack: number[];
  favorites: number[];
  favoriteStats: FavoriteStat[];
  onboarded: boolean;
  taste: TastePrefs | null;
  cart: CartItem[];
  toCook: ToCookItem[];
  history: HistoryItem[];
  ai?: AiInfo;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('The app’s local service is not running. Start it with start.bat.', 0);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data.code);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T = { ok: true }>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  put: <T = { ok: true }>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T = { ok: true }>(url: string) => request<T>('DELETE', url),

  state: () => request<AppState>('GET', '/api/state'),
  quickAdd: (foodId: number, location?: Location) =>
    request<{ undoId: string; batchId: number }>('POST', `/api/foods/${foodId}/quick-add`, location ? { location } : {}),
  setUnit: (foodId: number, unit: Unit) => request('POST', `/api/foods/${foodId}/unit`, { unit }),
  addBatch: (body: Record<string, unknown>) => request<{ undoId: string; batchId: number }>('POST', '/api/batches', body),
  undo: (undoId: string) => request('POST', `/api/undo/${undoId}`),
};
