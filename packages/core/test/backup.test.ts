import { describe, it, expect } from 'vitest';
import { BACKUP_FORMAT, BACKUP_TABLES, BACKUP_VERSION, validateBackup } from '../src/backup';

function emptyBackup() {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: '2026-11-12T10:00:00Z',
    data: Object.fromEntries(Object.keys(BACKUP_TABLES).map((t) => [t, [] as Record<string, unknown>[]])),
  };
}

describe('backup format', () => {
  it('accepts a valid backup and counts rows', () => {
    const b = emptyBackup();
    b.data.batches.push({ id: 1, food_id: 1, qty: 2, unit: 'pcs', location: 'fridge', added_date: '2026-11-12' });
    const r = validateBackup(b);
    expect(r.ok).toBe(true);
    expect(r.counts.batches).toBe(1);
  });

  it('rejects files that are not backups', () => {
    expect(validateBackup(null).ok).toBe(false);
    expect(validateBackup([1, 2]).ok).toBe(false);
    expect(validateBackup({ hello: 'world' }).errors[0]).toMatch(/not a Virtual Fridge backup/);
  });

  it('rejects newer versions and missing tables', () => {
    const b = emptyBackup();
    b.version = BACKUP_VERSION + 1;
    delete (b.data as Record<string, unknown>).history;
    const r = validateBackup(b);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/newer version/);
    expect(r.errors.join(' ')).toMatch(/"history"/);
  });

  it('rejects rows missing required columns', () => {
    const b = emptyBackup();
    b.data.batches.push({ id: 1, food_id: 1 });
    const r = validateBackup(b);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/batches row 1 is missing "qty"/);
  });
});
