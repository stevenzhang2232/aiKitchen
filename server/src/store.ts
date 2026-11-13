import { randomUUID } from 'node:crypto';
import {
  CATEGORIES, LOCATIONS, findFoodByName, isDateString, isUnit, planDeduction, quickAddBase, rankFavorites,
  resolveExpiry, round, todayLocal, toBase, unitKind, validateOnboardingPick, buildInventory,
  type Batch, type Category, type ExpiryInput, type FavoriteStat, type Food, type Inventory, type Location,
  type Source, type TastePrefs, type Unit, type UnitKind,
} from '@kitchen/core';
import { FRIDGE_ID, tx, type Db } from './db.js';
import { bad, conflict, notFound } from './errors.js';

type Row = Record<string, unknown>;

export interface CartItem {
  foodId: number;
  kind: UnitKind;
  qty: number;
}

export interface ToCookItem {
  id: number;
  dishName: string;
  servings: number;
  taste: TastePrefs | null;
  missing: { name: string; foodId?: number | null; amount?: number | null; unit?: Unit | null }[];
  savedAt: string;
}

export interface HistoryDeduction {
  foodId: number;
  name: string;
  amount: number;
  unit: Unit;
}

export interface HistoryItem {
  id: number;
  dishName: string;
  cookedAt: string;
  servings: number;
  mode: string;
  deductions: HistoryDeduction[];
  missing: { name: string }[];
  dish: unknown;
}

export interface ShelfLifeResult {
  days: number | null;
  note: string | null;
  sources: Source[];
}

type UndoOp =
  | { type: 'batch-created'; batchId: number }
  | { type: 'batch-increased'; batchId: number; amount: number }
  | { type: 'favorite'; foodId: number; before: Row | null };

export interface StoreOptions {
  now?: () => Date;
  /** Whether a background shelf-life lookup can run (AI configured). */
  aiEnabled?: () => boolean;
  /** Called after a new batch needs a shelf-life lookup. */
  onNeedsShelfLife?: (batchId: number) => void;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function asLocation(v: unknown, fallback?: Location): Location {
  if (typeof v === 'string' && (LOCATIONS as string[]).includes(v)) return v as Location;
  if (fallback) return fallback;
  bad('Choose Fridge, Freezer or Pantry.');
}

function positiveNumber(v: unknown, what: string): number {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) bad(`${what} must be a number greater than 0.`);
  return n;
}

export class Store {
  readonly now: () => Date;
  private aiEnabled: () => boolean;
  onNeedsShelfLife?: (batchId: number) => void;

  constructor(public db: Db, opts: StoreOptions = {}) {
    this.now = opts.now ?? (() => new Date());
    this.aiEnabled = opts.aiEnabled ?? (() => false);
    this.onNeedsShelfLife = opts.onNeedsShelfLife;
  }

  setAiEnabled(fn: () => boolean) {
    this.aiEnabled = fn;
  }

  today(): string {
    return todayLocal(this.now());
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  // ---------- reading ----------

  foods(): Food[] {
    const aliases = this.db.prepare('SELECT food_id, alias FROM food_aliases ORDER BY rowid').all() as Row[];
    const byFood = new Map<number, string[]>();
    for (const a of aliases) {
      const list = byFood.get(a.food_id as number) ?? [];
      list.push(a.alias as string);
      byFood.set(a.food_id as number, list);
    }
    const rows = this.db.prepare('SELECT * FROM foods ORDER BY name').all() as Row[];
    return rows.map((r) => ({
      id: r.id as number,
      key: r.key as string,
      name: r.name as string,
      category: r.category as Category,
      aliases: byFood.get(r.id as number) ?? [],
      defaultUnit: (r.default_unit as Unit | null) ?? null,
      suggestedUnit: r.suggested_unit as Unit,
      defaultLocation: r.default_location as Location,
      image: (r.image as string | null) ?? null,
      pieceGrams: (r.piece_grams as number | null) ?? null,
      isSeasoning: !!r.is_seasoning,
      custom: !!r.custom,
    }));
  }

  food(id: number): Food {
    const f = this.foods().find((x) => x.id === id);
    if (!f) notFound('That ingredient does not exist.');
    return f;
  }

  private toBatch(r: Row): Batch {
    return {
      id: r.id as number,
      foodId: r.food_id as number,
      qty: r.qty as number,
      unit: r.unit as Unit,
      location: r.location as Location,
      addedDate: r.added_date as string,
      expiryDate: (r.expiry_date as string | null) ?? null,
      expirySource: (r.expiry_source as Batch['expirySource']) ?? null,
      aiStatus: (r.ai_status as Batch['aiStatus']) ?? null,
      aiNote: (r.ai_note as string | null) ?? null,
      aiSources: parseJson<Source[]>(r.ai_sources, []),
    };
  }

  batches(): Batch[] {
    const rows = this.db.prepare('SELECT * FROM batches WHERE fridge_id = ? AND qty > 0 ORDER BY id').all(FRIDGE_ID) as Row[];
    return rows.map((r) => this.toBatch(r));
  }

  batch(id: number): Batch {
    const r = this.db.prepare('SELECT * FROM batches WHERE id = ? AND fridge_id = ?').get(id, FRIDGE_ID) as Row | undefined;
    if (!r) notFound('That batch no longer exists.');
    return this.toBatch(r);
  }

  inventory(): Inventory {
    return buildInventory(this.batches());
  }

  seasonings(): { foodId: number; have: boolean }[] {
    const rows = this.db.prepare(`
      SELECT f.id AS food_id, COALESCE(s.have, 0) AS have
      FROM foods f
      LEFT JOIN seasoning_state s ON s.food_id = f.id AND s.fridge_id = ?
      LEFT JOIN seasoning_pack p ON p.food_id = f.id AND p.fridge_id = ?
      WHERE f.is_seasoning = 1 AND (s.food_id IS NOT NULL OR p.food_id IS NOT NULL)
      ORDER BY COALESCE(p.position, 1000), f.name
    `).all(FRIDGE_ID, FRIDGE_ID) as Row[];
    return rows.map((r) => ({ foodId: r.food_id as number, have: !!r.have }));
  }

  ownedSeasonings(): Set<number> {
    const rows = this.db.prepare('SELECT food_id FROM seasoning_state WHERE fridge_id = ? AND have = 1').all(FRIDGE_ID) as Row[];
    return new Set(rows.map((r) => r.food_id as number));
  }

  pack(): number[] {
    const rows = this.db.prepare('SELECT food_id FROM seasoning_pack WHERE fridge_id = ? ORDER BY position').all(FRIDGE_ID) as Row[];
    return rows.map((r) => r.food_id as number);
  }

  favoriteStats(): FavoriteStat[] {
    const rows = this.db.prepare('SELECT * FROM favorites WHERE fridge_id = ?').all(FRIDGE_ID) as Row[];
    return rows.map((r) => ({
      foodId: r.food_id as number,
      pinned: !!r.pinned,
      pinnedAt: (r.pinned_at as number | null) ?? null,
      addCount: r.add_count as number,
      lastUsedAt: (r.last_used_at as string | null) ?? null,
    }));
  }

  favorites(): number[] {
    return rankFavorites(this.favoriteStats(), this.now());
  }

  pref<T>(key: string, fallback: T): T {
    const r = this.db.prepare('SELECT value FROM preferences WHERE fridge_id = ? AND key = ?').get(FRIDGE_ID, key) as Row | undefined;
    return r ? parseJson<T>(r.value, fallback) : fallback;
  }

  setPref(key: string, value: unknown): void {
    this.db.prepare(`
      INSERT INTO preferences (fridge_id, key, value) VALUES (?, ?, ?)
      ON CONFLICT(fridge_id, key) DO UPDATE SET value = excluded.value
    `).run(FRIDGE_ID, key, JSON.stringify(value));
  }

  cart(): CartItem[] {
    const rows = this.db.prepare('SELECT * FROM cart_items WHERE fridge_id = ? AND qty > 0 ORDER BY rowid').all(FRIDGE_ID) as Row[];
    return rows.map((r) => ({ foodId: r.food_id as number, kind: r.kind as UnitKind, qty: r.qty as number }));
  }

  toCook(): ToCookItem[] {
    const rows = this.db.prepare('SELECT * FROM to_cook WHERE fridge_id = ? ORDER BY saved_at DESC, id DESC').all(FRIDGE_ID) as Row[];
    return rows.map((r) => ({
      id: r.id as number,
      dishName: r.dish_name as string,
      servings: r.servings as number,
      taste: parseJson<TastePrefs | null>(r.taste, null),
      missing: parseJson(r.missing, []),
      savedAt: r.saved_at as string,
    }));
  }

  history(): HistoryItem[] {
    const rows = this.db.prepare('SELECT * FROM history WHERE fridge_id = ? ORDER BY cooked_at DESC, id DESC').all(FRIDGE_ID) as Row[];
    return rows.map((r) => ({
      id: r.id as number,
      dishName: r.dish_name as string,
      cookedAt: r.cooked_at as string,
      servings: r.servings as number,
      mode: r.mode as string,
      deductions: parseJson(r.deductions, []),
      missing: parseJson(r.missing, []),
      dish: parseJson(r.dish, {}),
    }));
  }

  state() {
    return {
      today: this.today(),
      foods: this.foods(),
      batches: this.batches(),
      seasonings: this.seasonings(),
      pack: this.pack(),
      favorites: this.favorites(),
      favoriteStats: this.favoriteStats(),
      onboarded: this.pref('onboarded', false),
      taste: this.pref<TastePrefs | null>('taste', null),
      cart: this.cart(),
      toCook: this.toCook(),
      history: this.history(),
    };
  }

  // ---------- foods ----------

  setDefaultUnit(foodId: number, unit: unknown): void {
    if (!isUnit(unit)) bad('Choose g, kg, pcs or serving.');
    this.food(foodId);
    this.db.prepare('UPDATE foods SET default_unit = ? WHERE id = ?').run(unit, foodId);
  }

  createFood(input: { name?: unknown; category?: unknown; isSeasoning?: unknown }): Food {
    const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
    if (!name) bad('Enter a name.');
    if (name.length > 60) bad('Keep the name under 60 characters.');
    const existing = findFoodByName(this.foods(), name);
    if (existing) return existing;
    const isSeasoning = input.isSeasoning === true;
    const category: Category = isSeasoning
      ? 'seasoning'
      : typeof input.category === 'string' && (CATEGORIES as string[]).includes(input.category) && input.category !== 'seasoning'
        ? (input.category as Category)
        : 'other';
    const key = `custom:${name.toLowerCase()}`;
    const r = this.db.prepare(`
      INSERT INTO foods (key, name, category, suggested_unit, default_location, is_seasoning, custom)
      VALUES (?, ?, ?, ?, 'fridge', ?, 1)
    `).run(key, name[0].toUpperCase() + name.slice(1), category, isSeasoning ? 'pcs' : 'pcs', isSeasoning ? 1 : 0);
    return this.food(Number(r.lastInsertRowid));
  }

  // ---------- onboarding and favorites ----------

  completeOnboarding(foodIds: unknown): void {
    if (!Array.isArray(foodIds) || foodIds.some((x) => typeof x !== 'number')) bad('Pick ingredients from the list.');
    const ids = [...new Set(foodIds as number[])];
    const err = validateOnboardingPick(ids.length);
    if (err) bad(err);
    const foods = new Map(this.foods().map((f) => [f.id, f]));
    for (const id of ids) {
      const f = foods.get(id);
      if (!f) bad('One of the picked ingredients does not exist.');
      if (f.isSeasoning) bad('Pick ingredients, not seasonings. Seasonings have their own pack.');
    }
    tx(this.db, () => {
      const ins = this.db.prepare(`
        INSERT INTO favorites (fridge_id, food_id, add_count, last_used_at) VALUES (?, ?, 0, NULL)
        ON CONFLICT(fridge_id, food_id) DO NOTHING
      `);
      for (const id of ids) ins.run(FRIDGE_ID, id);
      this.setPref('onboarded', true);
    });
  }

  setPinned(foodId: number, pinned: boolean): void {
    this.food(foodId);
    const maxRow = this.db.prepare('SELECT MAX(pinned_at) AS m FROM favorites WHERE fridge_id = ?').get(FRIDGE_ID) as Row;
    const next = ((maxRow.m as number | null) ?? 0) + 1;
    this.db.prepare(`
      INSERT INTO favorites (fridge_id, food_id, pinned, pinned_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(fridge_id, food_id) DO UPDATE SET pinned = excluded.pinned, pinned_at = excluded.pinned_at
    `).run(FRIDGE_ID, foodId, pinned ? 1 : 0, pinned ? next : null);
  }

  private favoriteRow(foodId: number): Row | null {
    return (this.db.prepare('SELECT * FROM favorites WHERE fridge_id = ? AND food_id = ?').get(FRIDGE_ID, foodId) as Row | undefined) ?? null;
  }

  private bumpFavorite(foodId: number, countAdd: boolean): UndoOp {
    const before = this.favoriteRow(foodId);
    this.db.prepare(`
      INSERT INTO favorites (fridge_id, food_id, add_count, last_used_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(fridge_id, food_id) DO UPDATE SET add_count = add_count + ?, last_used_at = excluded.last_used_at
    `).run(FRIDGE_ID, foodId, countAdd ? 1 : 0, this.nowIso(), countAdd ? 1 : 0);
    return { type: 'favorite', foodId, before };
  }

  /** Mark foods as recently used (after cooking). */
  touchFavorites(foodIds: number[]): void {
    for (const id of foodIds) {
      this.db.prepare('UPDATE favorites SET last_used_at = ? WHERE fridge_id = ? AND food_id = ?').run(this.nowIso(), FRIDGE_ID, id);
    }
  }

  // ---------- adding ----------

  private recordUndo(ops: UndoOp[]): string {
    const id = randomUUID();
    this.db.prepare('INSERT INTO undo_log (id, created_at, ops) VALUES (?, ?, ?)').run(id, this.nowIso(), JSON.stringify(ops));
    this.db.prepare('DELETE FROM undo_log WHERE id NOT IN (SELECT id FROM undo_log ORDER BY created_at DESC LIMIT 50)').run();
    return id;
  }

  private cachedShelfLife(foodId: number, location: Location): ShelfLifeResult | null {
    const r = this.db.prepare('SELECT * FROM shelf_life_cache WHERE food_id = ? AND location = ?').get(foodId, location) as Row | undefined;
    if (!r || r.days == null) return null;
    return { days: r.days as number, note: (r.note as string | null) ?? null, sources: parseJson(r.sources, []) };
  }

  private insertBatch(foodId: number, qty: number, unit: Unit, location: Location, expiry: string | null): number {
    const added = this.today();
    let status: Batch['aiStatus'] = null;
    let expiryDate = expiry;
    let source: Batch['expirySource'] = expiry ? 'user' : null;
    let note: string | null = null;
    let sources: Source[] = [];
    if (!expiry) {
      const cached = this.cachedShelfLife(foodId, location);
      if (cached && cached.days != null) {
        const d = new Date(`${added}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + cached.days);
        expiryDate = d.toISOString().slice(0, 10);
        source = 'ai';
        status = 'done';
        note = cached.note;
        sources = cached.sources;
      } else {
        status = this.aiEnabled() ? 'pending' : 'none';
      }
    }
    const r = this.db.prepare(`
      INSERT INTO batches (fridge_id, food_id, qty, unit, location, added_date, expiry_date, expiry_source, ai_status, ai_note, ai_sources, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(FRIDGE_ID, foodId, qty, unit, location, added, expiryDate, source, status, note, JSON.stringify(sources), this.nowIso());
    return Number(r.lastInsertRowid);
  }

  private notifyPending(batchIds: number[]) {
    for (const id of batchIds) {
      const b = this.db.prepare('SELECT ai_status FROM batches WHERE id = ?').get(id) as Row | undefined;
      if (b?.ai_status === 'pending') this.onNeedsShelfLife?.(id);
    }
  }

  /**
   * One click: adds 100 g, 1 kg, 1 pc or 1 serving in the food's default unit.
   * Clicks on the same day merge into today's batch for that food and location.
   */
  quickAdd(foodId: number, locationInput?: unknown): { undoId: string; batchId: number } {
    const food = this.food(foodId);
    if (food.isSeasoning) bad('Seasonings are tracked as have / don’t have.');
    if (!food.defaultUnit) conflict(`Choose a unit for ${food.name} first.`, 'unit-required');
    const unit = food.defaultUnit;
    const location = asLocation(locationInput, food.defaultLocation);
    const step = quickAddBase(unit);
    const result = tx(this.db, () => {
      const ops: UndoOp[] = [];
      const existing = this.db.prepare(`
        SELECT id, unit FROM batches
        WHERE fridge_id = ? AND food_id = ? AND location = ? AND added_date = ? AND qty > 0
          AND (expiry_source IS NULL OR expiry_source = 'ai')
        ORDER BY id DESC
      `).all(FRIDGE_ID, foodId, location, this.today()) as Row[];
      const same = existing.find((r) => unitKind(r.unit as Unit) === unitKind(unit));
      let batchId: number;
      if (same) {
        batchId = same.id as number;
        this.db.prepare('UPDATE batches SET qty = qty + ? WHERE id = ?').run(step, batchId);
        ops.push({ type: 'batch-increased', batchId, amount: step });
      } else {
        batchId = this.insertBatch(foodId, step, unit, location, null);
        ops.push({ type: 'batch-created', batchId });
      }
      ops.push(this.bumpFavorite(foodId, true));
      return { undoId: this.recordUndo(ops), batchId };
    });
    this.notifyPending([result.batchId]);
    return result;
  }

  /** Detailed add / restock: always creates a new batch, never changes older batches. */
  addBatch(input: {
    foodId?: unknown; qty?: unknown; unit?: unknown; location?: unknown;
    expiryDate?: unknown; startDate?: unknown; keepDays?: unknown;
  }): { undoId: string; batchId: number } {
    const foodId = Number(input.foodId);
    const food = this.food(foodId);
    if (food.isSeasoning) bad('Seasonings are tracked as have / don’t have.');
    const unit = input.unit ?? food.defaultUnit ?? food.suggestedUnit;
    if (!isUnit(unit)) bad('Choose g, kg, pcs or serving.');
    const amount = positiveNumber(input.qty, 'Amount');
    const location = asLocation(input.location, food.defaultLocation);
    const expiry = this.parseExpiry(input);
    const result = tx(this.db, () => {
      if (!food.defaultUnit) this.db.prepare('UPDATE foods SET default_unit = ? WHERE id = ?').run(unit, foodId);
      const batchId = this.insertBatch(foodId, round(toBase(amount, unit), 6), unit, location, expiry);
      const ops: UndoOp[] = [{ type: 'batch-created', batchId }, this.bumpFavorite(foodId, true)];
      return { undoId: this.recordUndo(ops), batchId };
    });
    this.notifyPending([result.batchId]);
    return result;
  }

  /** Add several items at once (receipt). One undo covers all of them. */
  addMany(items: { foodId: number; qty: number; unit: Unit; location?: Location }[]): { undoId: string; batchIds: number[] } {
    if (!Array.isArray(items) || !items.length) bad('Nothing to add.');
    const result = tx(this.db, () => {
      const ops: UndoOp[] = [];
      const batchIds: number[] = [];
      for (const item of items) {
        const food = this.food(Number(item.foodId));
        if (food.isSeasoning) {
          this.setSeasoning(food.id, true);
          continue;
        }
        if (!isUnit(item.unit)) bad(`Choose a unit for ${food.name}.`);
        const qty = positiveNumber(item.qty, `Amount of ${food.name}`);
        if (!food.defaultUnit) this.db.prepare('UPDATE foods SET default_unit = ? WHERE id = ?').run(item.unit, food.id);
        const batchId = this.insertBatch(food.id, round(toBase(qty, item.unit), 6), item.unit, asLocation(item.location, food.defaultLocation), null);
        batchIds.push(batchId);
        ops.push({ type: 'batch-created', batchId }, this.bumpFavorite(food.id, true));
      }
      return { undoId: this.recordUndo(ops), batchIds };
    });
    this.notifyPending(result.batchIds);
    return result;
  }

  undo(undoId: string): void {
    const r = this.db.prepare('SELECT ops FROM undo_log WHERE id = ?').get(undoId) as Row | undefined;
    if (!r) notFound('There is nothing to undo.');
    const ops = parseJson<UndoOp[]>(r.ops, []);
    tx(this.db, () => {
      for (const op of [...ops].reverse()) {
        if (op.type === 'batch-created') {
          this.db.prepare('DELETE FROM batches WHERE id = ?').run(op.batchId);
        } else if (op.type === 'batch-increased') {
          this.db.prepare('UPDATE batches SET qty = MAX(0, qty - ?) WHERE id = ?').run(op.amount, op.batchId);
          this.db.prepare('DELETE FROM batches WHERE id = ? AND qty <= 0.000001').run(op.batchId);
        } else if (op.type === 'favorite') {
          if (!op.before) {
            this.db.prepare('DELETE FROM favorites WHERE fridge_id = ? AND food_id = ?').run(FRIDGE_ID, op.foodId);
          } else {
            this.db.prepare('UPDATE favorites SET add_count = ?, last_used_at = ? WHERE fridge_id = ? AND food_id = ?')
              .run(op.before.add_count as number, (op.before.last_used_at as string | null) ?? null, FRIDGE_ID, op.foodId);
          }
        }
      }
      this.db.prepare('DELETE FROM undo_log WHERE id = ?').run(undoId);
    });
  }

  // ---------- batch operations ----------

  private parseExpiry(input: { expiryDate?: unknown; startDate?: unknown; keepDays?: unknown }): string | null {
    let spec: ExpiryInput | null = null;
    if (input.expiryDate != null && input.expiryDate !== '') {
      spec = { expiryDate: String(input.expiryDate) };
    } else if (input.startDate != null && input.startDate !== '') {
      spec = { startDate: String(input.startDate), keepDays: Number(input.keepDays) };
    }
    if (!spec) return null;
    try {
      return resolveExpiry(spec);
    } catch (e) {
      bad((e as Error).message);
    }
  }

  /** Set the amount of one batch. 0 removes the batch. */
  adjust(batchId: number, qtyInput: unknown, unitInput?: unknown): void {
    const b = this.batch(batchId);
    const qty = typeof qtyInput === 'string' ? Number(qtyInput) : qtyInput;
    if (typeof qty !== 'number' || !Number.isFinite(qty) || qty < 0) bad('Amount must be 0 or more.');
    const unit = unitInput == null ? b.unit : unitInput;
    if (!isUnit(unit) || unitKind(unit) !== unitKind(b.unit)) bad(`This batch is measured in ${b.unit}; use a matching unit.`);
    const base = round(toBase(qty, unit), 6);
    if (base <= 0) this.db.prepare('DELETE FROM batches WHERE id = ?').run(batchId);
    else this.db.prepare('UPDATE batches SET qty = ?, unit = ? WHERE id = ?').run(base, unit, batchId);
  }

  move(batchId: number, location: unknown): void {
    this.batch(batchId);
    this.db.prepare('UPDATE batches SET location = ? WHERE id = ?').run(asLocation(location), batchId);
  }

  /** User-confirmed expiry always wins over the AI suggestion. null clears it. */
  setExpiry(batchId: number, input: { expiryDate?: unknown; startDate?: unknown; keepDays?: unknown; clear?: unknown }): void {
    this.batch(batchId);
    if (input.clear === true) {
      this.db.prepare("UPDATE batches SET expiry_date = NULL, expiry_source = NULL, ai_status = 'none' WHERE id = ?").run(batchId);
      return;
    }
    const expiry = this.parseExpiry(input);
    if (!expiry) bad('Enter an expiry date, or a start date and days to keep.');
    this.db.prepare("UPDATE batches SET expiry_date = ?, expiry_source = 'user' WHERE id = ?").run(expiry, batchId);
  }

  setAddedDate(batchId: number, date: unknown): void {
    this.batch(batchId);
    if (!isDateString(date)) bad('Enter a valid date.');
    if (date > this.today()) bad('The date added cannot be in the future.');
    this.db.prepare('UPDATE batches SET added_date = ? WHERE id = ?').run(date, batchId);
  }

  remove(batchId: number): void {
    this.batch(batchId);
    this.db.prepare('DELETE FROM batches WHERE id = ?').run(batchId);
  }

  /**
   * Use an amount of a food, taking the soonest-expiring batches first.
   * Never goes below zero; returns what was actually taken.
   */
  use(foodId: number, amountInput: unknown, unitInput: unknown) {
    this.food(foodId);
    if (!isUnit(unitInput)) bad('Choose g, kg, pcs or serving.');
    const amount = positiveNumber(amountInput, 'Amount');
    return tx(this.db, () => this.deduct(foodId, unitKind(unitInput), toBase(amount, unitInput)));
  }

  /** Internal FIFO deduction; must run inside a transaction. */
  deduct(foodId: number, kind: UnitKind, base: number) {
    const batches = this.batches().filter((b) => b.foodId === foodId);
    const plan = planDeduction(batches, kind, base);
    for (const t of plan.takes) {
      if (t.remaining <= 1e-6) this.db.prepare('DELETE FROM batches WHERE id = ?').run(t.batchId);
      else this.db.prepare('UPDATE batches SET qty = ? WHERE id = ?').run(t.remaining, t.batchId);
    }
    return plan;
  }

  // ---------- shelf life ----------

  pendingShelfLife(): number[] {
    const rows = this.db.prepare("SELECT id FROM batches WHERE ai_status = 'pending' AND qty > 0").all() as Row[];
    return rows.map((r) => r.id as number);
  }

  markShelfLifeLookup(batchId: number): void {
    const b = this.batch(batchId);
    if (b.expirySource === 'user') return;
    this.db.prepare("UPDATE batches SET ai_status = 'pending' WHERE id = ?").run(batchId);
  }

  /** Save an AI result for a batch (and cache it for this food and location). */
  applyShelfLife(batchId: number, result: ShelfLifeResult | null): void {
    const r = this.db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId) as Row | undefined;
    if (!r) return;
    const b = this.toBatch(r);
    tx(this.db, () => {
      if (result && result.days != null && result.days >= 0) {
        this.db.prepare(`
          INSERT INTO shelf_life_cache (food_id, location, days, note, sources, fetched_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(food_id, location) DO UPDATE SET days = excluded.days, note = excluded.note, sources = excluded.sources, fetched_at = excluded.fetched_at
        `).run(b.foodId, b.location, Math.round(result.days), result.note, JSON.stringify(result.sources), this.nowIso());
      }
      if (b.expirySource === 'user') {
        // The user's date wins; just keep the AI note for reference.
        this.db.prepare("UPDATE batches SET ai_status = 'done', ai_note = ?, ai_sources = ? WHERE id = ?")
          .run(result?.note ?? null, JSON.stringify(result?.sources ?? []), batchId);
        return;
      }
      if (!result || result.days == null || result.days < 0) {
        this.db.prepare("UPDATE batches SET ai_status = 'none', ai_note = ?, ai_sources = ? WHERE id = ?")
          .run(result?.note ?? null, JSON.stringify(result?.sources ?? []), batchId);
        return;
      }
      const d = new Date(`${b.addedDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + Math.round(result.days));
      this.db.prepare(`
        UPDATE batches SET expiry_date = ?, expiry_source = 'ai', ai_status = 'done', ai_note = ?, ai_sources = ? WHERE id = ?
      `).run(d.toISOString().slice(0, 10), result.note, JSON.stringify(result.sources), batchId);
    });
  }

  clearShelfLifeCache(foodId: number, location: Location): void {
    this.db.prepare('DELETE FROM shelf_life_cache WHERE food_id = ? AND location = ?').run(foodId, location);
  }

  // ---------- seasonings ----------

  setSeasoning(foodId: number, have: boolean): void {
    const f = this.food(foodId);
    if (!f.isSeasoning) bad(`${f.name} is an ingredient, not a seasoning.`);
    this.db.prepare(`
      INSERT INTO seasoning_state (fridge_id, food_id, have) VALUES (?, ?, ?)
      ON CONFLICT(fridge_id, food_id) DO UPDATE SET have = excluded.have
    `).run(FRIDGE_ID, foodId, have ? 1 : 0);
  }

  /** Remove a seasoning from the seasoning row (only if it is not in the pack). */
  hideSeasoning(foodId: number): void {
    if (this.pack().includes(foodId)) bad('This seasoning is in your pack. Remove it from the pack in Settings first.');
    this.db.prepare('DELETE FROM seasoning_state WHERE fridge_id = ? AND food_id = ?').run(FRIDGE_ID, foodId);
  }

  applyPack(): number[] {
    const pack = this.pack();
    if (!pack.length) bad('Your seasoning pack is empty. Add seasonings to it in Settings.');
    tx(this.db, () => {
      for (const id of pack) this.setSeasoning(id, true);
    });
    return pack;
  }

  setPack(foodIds: unknown): void {
    if (!Array.isArray(foodIds) || foodIds.some((x) => typeof x !== 'number')) bad('Pick seasonings from the list.');
    const ids = [...new Set(foodIds as number[])];
    const foods = new Map(this.foods().map((f) => [f.id, f]));
    for (const id of ids) {
      if (!foods.get(id)?.isSeasoning) bad('Only seasonings can be in the seasoning pack.');
    }
    tx(this.db, () => {
      this.db.prepare('DELETE FROM seasoning_pack WHERE fridge_id = ?').run(FRIDGE_ID);
      const ins = this.db.prepare('INSERT INTO seasoning_pack (fridge_id, food_id, position) VALUES (?, ?, ?)');
      ids.forEach((id, i) => ins.run(FRIDGE_ID, id, i));
    });
  }

  renameFood(foodId: number, name: unknown): void {
    const f = this.food(foodId);
    if (!f.custom) bad('Only ingredients you created can be renamed.');
    const n = typeof name === 'string' ? name.trim() : '';
    if (!n) bad('Enter a name.');
    const clash = findFoodByName(this.foods(), n);
    if (clash && clash.id !== foodId) bad(`${clash.name} already exists.`);
    this.db.prepare('UPDATE foods SET name = ?, key = ? WHERE id = ?').run(n, `custom:${n.toLowerCase()}`, foodId);
  }

  // ---------- taste ----------

  setTaste(input: { spice?: unknown; avoid?: unknown; cuisines?: unknown }): TastePrefs {
    const spice = input.spice;
    if (spice !== 'none' && spice !== 'mild' && spice !== 'medium' && spice !== 'hot') bad('Choose a spice level.');
    const list = (v: unknown) =>
      (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [])
        .map((x) => String(x).trim())
        .filter(Boolean)
        .slice(0, 20);
    const taste: TastePrefs = { spice, avoid: list(input.avoid), cuisines: list(input.cuisines) };
    this.setPref('taste', taste);
    return taste;
  }

  // ---------- cart ----------

  setCart(items: unknown): void {
    if (!Array.isArray(items)) bad('The cart must be a list.');
    const inv = this.inventory();
    const clean: CartItem[] = [];
    for (const it of items as Row[]) {
      const foodId = Number(it.foodId);
      const kind = it.kind as UnitKind;
      const qty = Number(it.qty);
      if (!['weight', 'count', 'serving'].includes(kind) || !Number.isFinite(qty) || qty < 0) bad('Cart item is not valid.');
      if (qty === 0) continue;
      const have = inv[foodId]?.[kind] ?? 0;
      if (qty > have + 1e-6) bad(`Only ${have} of ${this.food(foodId).name} is in stock.`);
      clean.push({ foodId, kind, qty });
    }
    tx(this.db, () => {
      this.db.prepare('DELETE FROM cart_items WHERE fridge_id = ?').run(FRIDGE_ID);
      const ins = this.db.prepare('INSERT INTO cart_items (fridge_id, food_id, kind, qty) VALUES (?, ?, ?, ?)');
      for (const c of clean) ins.run(FRIDGE_ID, c.foodId, c.kind, c.qty);
    });
  }

  clearCart(): void {
    this.db.prepare('DELETE FROM cart_items WHERE fridge_id = ?').run(FRIDGE_ID);
  }

  // ---------- to cook and history ----------

  addToCook(input: { dishName?: unknown; servings?: unknown; taste?: unknown; missing?: unknown }): number {
    const dishName = typeof input.dishName === 'string' ? input.dishName.trim() : '';
    if (!dishName) bad('The dish needs a name.');
    const servings = Math.round(positiveNumber(input.servings, 'Servings'));
    const missing = Array.isArray(input.missing) ? input.missing : [];
    const r = this.db.prepare(`
      INSERT INTO to_cook (fridge_id, dish_name, servings, taste, missing, saved_at) VALUES (?, ?, ?, ?, ?, ?)
    `).run(FRIDGE_ID, dishName, servings, JSON.stringify(input.taste ?? this.pref('taste', null)), JSON.stringify(missing), this.nowIso());
    return Number(r.lastInsertRowid);
  }

  deleteToCook(id: number): void {
    const r = this.db.prepare('DELETE FROM to_cook WHERE id = ? AND fridge_id = ?').run(id, FRIDGE_ID);
    if (!r.changes) notFound('That dish is no longer in To cook.');
  }

  deleteHistory(id: number): void {
    const r = this.db.prepare('DELETE FROM history WHERE id = ? AND fridge_id = ?').run(id, FRIDGE_ID);
    if (!r.changes) notFound('That history entry no longer exists.');
  }

  addHistory(entry: Omit<HistoryItem, 'id'>): number {
    const r = this.db.prepare(`
      INSERT INTO history (fridge_id, dish_name, cooked_at, servings, mode, deductions, missing, dish) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      FRIDGE_ID, entry.dishName, entry.cookedAt, entry.servings, entry.mode,
      JSON.stringify(entry.deductions), JSON.stringify(entry.missing), JSON.stringify(entry.dish ?? {}),
    );
    return Number(r.lastInsertRowid);
  }
}
