import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { BACKUP_FORMAT, BACKUP_TABLES, BACKUP_VERSION, validateBackup, type BackupFile } from '@kitchen/core';
import { seedCatalog, tx, type Db } from '../db.js';
import type { Store } from '../store.js';
import type { ShelfLifeWorker } from '../ai/shelfLifeWorker.js';
import { HttpError } from '../errors.js';

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function exportData(db: Db, now: Date): BackupFile {
  const data: BackupFile['data'] = {};
  for (const table of Object.keys(BACKUP_TABLES)) {
    data[table] = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), data };
}

function columns(db: Db, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
}

/** Replace all user data with the backup. Runs in one transaction: on any error nothing changes. */
export function importData(db: Db, backup: BackupFile): void {
  // Children first when deleting, parents first when inserting.
  const order = Object.keys(BACKUP_TABLES);
  const deleteOrder = ['batches', 'food_aliases', 'seasoning_state', 'seasoning_pack', 'favorites', 'cart_items', 'shelf_life_cache', 'preferences', 'to_cook', 'history', 'foods'];
  tx(db, () => {
    db.exec('DELETE FROM undo_log');
    for (const t of deleteOrder) db.exec(`DELETE FROM ${t}`);
    for (const table of order) {
      const cols = columns(db, table);
      for (const row of backup.data[table] ?? []) {
        const keys = Object.keys(row).filter((k) => cols.has(k));
        const values = keys.map((k) => {
          const v = row[k];
          if (v === null || typeof v === 'number' || typeof v === 'string') return v;
          if (typeof v === 'boolean') return v ? 1 : 0;
          return JSON.stringify(v);
        });
        db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...(values as (string | number | null)[]));
      }
    }
    // Make sure every current catalog food exists (backups from older versions may lack some).
    seedCatalog(db);
  });
}

export function registerBackupRoutes(app: FastifyInstance, deps: { db: Db; store: Store; dataDir: string; worker: ShelfLifeWorker }) {
  const { db, store, dataDir, worker } = deps;

  app.get('/api/backup/export', async (_req, reply) => {
    const now = store.now();
    const body = exportData(db, now);
    reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="fridge-backup-${stamp(now)}.json"`);
    return JSON.stringify(body, null, 2);
  });

  app.post<{ Body: { backup?: unknown } }>('/api/backup/preview', async (req) => validateBackup(req.body?.backup));

  app.post<{ Body: { backup?: unknown } }>('/api/backup/import', async (req) => {
    const check = validateBackup(req.body?.backup);
    if (!check.ok) throw new HttpError(400, `This file can’t be restored. ${check.errors[0] ?? ''} Your current data is unchanged.`, 'bad-backup');
    await worker.idle();
    const now = store.now();
    const dir = path.join(dataDir, 'auto-backups');
    fs.mkdirSync(dir, { recursive: true });
    const safety = path.join(dir, `before-import-${stamp(now)}.json`);
    fs.writeFileSync(safety, JSON.stringify(exportData(db, now), null, 2));
    try {
      importData(db, req.body!.backup as BackupFile);
    } catch {
      throw new HttpError(400, 'This backup has data that doesn’t fit. Nothing was changed.', 'bad-backup');
    }
    return { ok: true, counts: check.counts, safetyCopy: path.relative(dataDir, safety) };
  });
}
