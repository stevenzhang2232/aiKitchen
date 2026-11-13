import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { CATALOG, DEFAULT_SEASONING_PACK } from './catalog.js';

export const SCHEMA_VERSION = 1;
export const FRIDGE_ID = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fridges (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS foods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  suggested_unit TEXT NOT NULL DEFAULT 'pcs',
  default_unit TEXT,
  default_location TEXT NOT NULL DEFAULT 'fridge',
  image TEXT,
  piece_grams REAL,
  is_seasoning INTEGER NOT NULL DEFAULT 0,
  custom INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS food_aliases (
  food_id INTEGER NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  PRIMARY KEY (food_id, alias)
);
CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fridge_id INTEGER NOT NULL DEFAULT 1,
  food_id INTEGER NOT NULL REFERENCES foods(id),
  qty REAL NOT NULL CHECK (qty >= 0),
  unit TEXT NOT NULL,
  location TEXT NOT NULL,
  added_date TEXT NOT NULL,
  expiry_date TEXT,
  expiry_source TEXT,
  ai_status TEXT,
  ai_note TEXT,
  ai_sources TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS batches_food ON batches(fridge_id, food_id);
CREATE TABLE IF NOT EXISTS seasoning_state (
  fridge_id INTEGER NOT NULL DEFAULT 1,
  food_id INTEGER NOT NULL,
  have INTEGER NOT NULL,
  PRIMARY KEY (fridge_id, food_id)
);
CREATE TABLE IF NOT EXISTS seasoning_pack (
  fridge_id INTEGER NOT NULL DEFAULT 1,
  food_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fridge_id, food_id)
);
CREATE TABLE IF NOT EXISTS favorites (
  fridge_id INTEGER NOT NULL DEFAULT 1,
  food_id INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  pinned_at INTEGER,
  add_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  PRIMARY KEY (fridge_id, food_id)
);
CREATE TABLE IF NOT EXISTS preferences (
  fridge_id INTEGER NOT NULL DEFAULT 1,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (fridge_id, key)
);
CREATE TABLE IF NOT EXISTS cart_items (
  fridge_id INTEGER NOT NULL DEFAULT 1,
  food_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  qty REAL NOT NULL,
  PRIMARY KEY (fridge_id, food_id, kind)
);
CREATE TABLE IF NOT EXISTS to_cook (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fridge_id INTEGER NOT NULL DEFAULT 1,
  dish_name TEXT NOT NULL,
  servings INTEGER NOT NULL,
  taste TEXT NOT NULL DEFAULT '{}',
  missing TEXT NOT NULL DEFAULT '[]',
  saved_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fridge_id INTEGER NOT NULL DEFAULT 1,
  dish_name TEXT NOT NULL,
  cooked_at TEXT NOT NULL,
  servings INTEGER NOT NULL DEFAULT 1,
  mode TEXT NOT NULL DEFAULT 'suggest',
  deductions TEXT NOT NULL DEFAULT '[]',
  missing TEXT NOT NULL DEFAULT '[]',
  dish TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS shelf_life_cache (
  food_id INTEGER NOT NULL,
  location TEXT NOT NULL,
  days INTEGER,
  note TEXT,
  sources TEXT NOT NULL DEFAULT '[]',
  fetched_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (food_id, location)
);
CREATE TABLE IF NOT EXISTS undo_log (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  ops TEXT NOT NULL
);
`;

export type Db = DatabaseSync;

export function openDb(dataDir: string): Db {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'fridge.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec(SCHEMA);
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version') as { value: string } | undefined;
  if (!row) {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION));
  }
  // Future schema upgrades go here, keyed on Number(row.value) < N.
  db.prepare('INSERT OR IGNORE INTO fridges (id, name) VALUES (?, ?)').run(FRIDGE_ID, 'My fridge');
  seedCatalog(db);
}

/** Insert or update catalog foods by key. Ids of existing foods never change. */
export function seedCatalog(db: Db): void {
  const upsert = db.prepare(`
    INSERT INTO foods (key, name, category, suggested_unit, default_location, image, piece_grams, is_seasoning, custom)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(key) DO UPDATE SET
      name = excluded.name, category = excluded.category, suggested_unit = excluded.suggested_unit,
      default_location = excluded.default_location, image = excluded.image,
      piece_grams = excluded.piece_grams, is_seasoning = excluded.is_seasoning
  `);
  const idOf = db.prepare('SELECT id FROM foods WHERE key = ?');
  const alias = db.prepare('INSERT OR IGNORE INTO food_aliases (food_id, alias) VALUES (?, ?)');
  tx(db, () => {
    for (const c of CATALOG) {
      upsert.run(c.key, c.name, c.category, c.unit, c.location, c.image ?? null, c.pieceGrams ?? null, c.category === 'seasoning' ? 1 : 0);
      const { id } = idOf.get(c.key) as { id: number };
      for (const a of c.aliases) alias.run(id, a);
    }
    const seeded = db.prepare('SELECT value FROM meta WHERE key = ?').get('pack_seeded');
    if (!seeded) {
      const add = db.prepare('INSERT OR IGNORE INTO seasoning_pack (fridge_id, food_id, position) VALUES (?, ?, ?)');
      DEFAULT_SEASONING_PACK.forEach((key, i) => {
        const r = idOf.get(key) as { id: number } | undefined;
        if (r) add.run(FRIDGE_ID, r.id, i);
      });
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('pack_seeded', '1');
    }
  });
}

let depth = 0;
/** Run fn in a transaction. Nested calls join the outer transaction. */
export function tx<T>(db: Db, fn: () => T): T {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
}

export const USER_TABLES = [
  'batches', 'seasoning_state', 'seasoning_pack', 'favorites', 'preferences', 'cart_items',
  'to_cook', 'history', 'shelf_life_cache', 'undo_log', 'food_aliases', 'foods',
];

/** Delete all user data and re-seed the catalog (used by tests and before a restore). */
export function wipeUserData(db: Db): void {
  tx(db, () => {
    for (const t of USER_TABLES) db.exec(`DELETE FROM ${t}`);
    db.exec("DELETE FROM meta WHERE key = 'pack_seeded'");
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('foods','batches','to_cook','history')");
  });
  seedCatalog(db);
}
