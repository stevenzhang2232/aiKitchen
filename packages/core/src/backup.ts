export const BACKUP_FORMAT = 'virtual-fridge-backup';
export const BACKUP_VERSION = 1;

/** Tables included in a backup and the columns each row must have. */
export const BACKUP_TABLES: Record<string, string[]> = {
  foods: ['id', 'key', 'name', 'category'],
  food_aliases: ['food_id', 'alias'],
  batches: ['id', 'food_id', 'qty', 'unit', 'location', 'added_date'],
  seasoning_state: ['food_id', 'have'],
  seasoning_pack: ['food_id'],
  favorites: ['food_id'],
  preferences: ['key', 'value'],
  cart_items: ['food_id', 'kind', 'qty'],
  to_cook: ['id', 'dish_name', 'servings', 'saved_at'],
  history: ['id', 'dish_name', 'cooked_at'],
  shelf_life_cache: ['food_id', 'location'],
};

export interface BackupFile {
  format: string;
  version: number;
  exportedAt: string;
  data: Record<string, Record<string, unknown>[]>;
}

export interface BackupCheck {
  ok: boolean;
  errors: string[];
  counts: Record<string, number>;
}

export function validateBackup(input: unknown): BackupCheck {
  const errors: string[] = [];
  const counts: Record<string, number> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['This file is not a Virtual Fridge backup.'], counts };
  }
  const file = input as Partial<BackupFile>;
  if (file.format !== BACKUP_FORMAT) {
    return { ok: false, errors: ['This file is not a Virtual Fridge backup.'], counts };
  }
  if (typeof file.version !== 'number' || file.version < 1) errors.push('The backup has no valid version number.');
  else if (file.version > BACKUP_VERSION) errors.push('This backup was made by a newer version of the app.');
  if (!file.data || typeof file.data !== 'object' || Array.isArray(file.data)) {
    errors.push('The backup has no data section.');
    return { ok: false, errors, counts };
  }
  for (const [table, required] of Object.entries(BACKUP_TABLES)) {
    const rows = (file.data as Record<string, unknown>)[table];
    if (!Array.isArray(rows)) {
      errors.push(`The backup is missing the "${table}" list.`);
      continue;
    }
    counts[table] = rows.length;
    rows.forEach((row, i) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        errors.push(`${table} row ${i + 1} is not valid.`);
        return;
      }
      for (const col of required) {
        if (!(col in row)) errors.push(`${table} row ${i + 1} is missing "${col}".`);
      }
    });
  }
  return { ok: errors.length === 0, errors: errors.slice(0, 20), counts };
}
