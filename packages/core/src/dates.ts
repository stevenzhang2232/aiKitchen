export const SOON_DAYS = 2;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Today's date in the computer's local time zone, as YYYY-MM-DD. */
export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toUtcMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  return new Date(toUtcMs(date) + days * 86_400_000).toISOString().slice(0, 10);
}

export function storedLabel(addedDate: string, today: string): string {
  const days = Math.max(0, diffDays(addedDate, today));
  if (days === 0) return 'Just added';
  return `In fridge ${days} ${days === 1 ? 'day' : 'days'}`;
}

export type ExpiryState = 'unknown' | 'ok' | 'soon' | 'expired';

export interface ExpiryInfo {
  state: ExpiryState;
  daysLeft: number | null;
}

export function expiryInfo(expiryDate: string | null, today: string, soonDays = SOON_DAYS): ExpiryInfo {
  if (!expiryDate) return { state: 'unknown', daysLeft: null };
  const daysLeft = diffDays(today, expiryDate);
  if (daysLeft < 0) return { state: 'expired', daysLeft };
  if (daysLeft <= soonDays) return { state: 'soon', daysLeft };
  return { state: 'ok', daysLeft };
}

export function daysLeftLabel(info: ExpiryInfo): string | null {
  if (info.daysLeft === null) return null;
  const d = info.daysLeft;
  if (d < 0) return `Expired ${-d} ${d === -1 ? 'day' : 'days'} ago`;
  if (d === 0) return 'Expires today';
  return `${d} ${d === 1 ? 'day' : 'days'} left`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 26" */
export function shortDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

export type ExpiryInput =
  | { expiryDate: string }
  | { startDate: string; keepDays: number };

/** Resolve the two ways a user can enter shelf life into a single expiry date. */
export function resolveExpiry(input: ExpiryInput): string {
  if ('expiryDate' in input) {
    if (!isDateString(input.expiryDate)) throw new Error('Enter a valid expiry date.');
    return input.expiryDate;
  }
  if (!isDateString(input.startDate)) throw new Error('Enter a valid start date.');
  if (!Number.isFinite(input.keepDays) || input.keepDays < 0 || !Number.isInteger(input.keepDays)) {
    throw new Error('Days to keep must be a whole number of 0 or more.');
  }
  return addDays(input.startDate, input.keepDays);
}
