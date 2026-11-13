import { describe, it, expect } from 'vitest';
import {
  addDays, daysLeftLabel, diffDays, expiryInfo, isDateString, resolveExpiry, shortDate, storedLabel, todayLocal,
} from '../src/dates';

describe('dates', () => {
  it('uses the local calendar date', () => {
    expect(todayLocal(new Date(2026, 10, 12, 23, 59))).toBe('2026-11-12');
    expect(todayLocal(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
  });

  it('counts whole days, across month and year ends', () => {
    expect(diffDays('2026-11-10', '2026-11-12')).toBe(2);
    expect(diffDays('2026-12-31', '2027-01-01')).toBe(1);
    expect(diffDays('2026-11-12', '2026-11-10')).toBe(-2);
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
  });

  it('shows "Just added" on the day of entry and days stored after (acceptance 15)', () => {
    expect(storedLabel('2026-11-12', '2026-11-12')).toBe('Just added');
    expect(storedLabel('2026-11-11', '2026-11-12')).toBe('In fridge 1 day');
    expect(storedLabel('2026-11-09', '2026-11-12')).toBe('In fridge 3 days');
  });

  it('flags items expiring within 2 days and expired items (acceptance 14)', () => {
    const today = '2026-11-12';
    expect(expiryInfo(null, today)).toEqual({ state: 'unknown', daysLeft: null });
    expect(expiryInfo('2026-11-20', today).state).toBe('ok');
    expect(expiryInfo('2026-11-15', today).state).toBe('ok');
    expect(expiryInfo('2026-11-14', today).state).toBe('soon');
    expect(expiryInfo('2026-11-13', today)).toEqual({ state: 'soon', daysLeft: 1 });
    expect(expiryInfo('2026-11-12', today)).toEqual({ state: 'soon', daysLeft: 0 });
    expect(expiryInfo('2026-11-11', today)).toEqual({ state: 'expired', daysLeft: -1 });
  });

  it('labels days left', () => {
    expect(daysLeftLabel({ state: 'soon', daysLeft: 1 })).toBe('1 day left');
    expect(daysLeftLabel({ state: 'soon', daysLeft: 0 })).toBe('Expires today');
    expect(daysLeftLabel({ state: 'expired', daysLeft: -3 })).toBe('Expired 3 days ago');
    expect(daysLeftLabel({ state: 'unknown', daysLeft: null })).toBeNull();
    expect(shortDate('2026-11-26')).toBe('Nov 26');
  });

  it('accepts an expiry date or a start date plus days to keep', () => {
    expect(resolveExpiry({ expiryDate: '2026-11-20' })).toBe('2026-11-20');
    expect(resolveExpiry({ startDate: '2026-11-10', keepDays: 5 })).toBe('2026-11-15');
    expect(() => resolveExpiry({ expiryDate: '2026-13-01' })).toThrow();
    expect(() => resolveExpiry({ startDate: '2026-11-10', keepDays: -1 })).toThrow();
    expect(() => resolveExpiry({ startDate: '2026-11-10', keepDays: 1.5 })).toThrow();
  });

  it('validates date strings', () => {
    expect(isDateString('2026-02-28')).toBe(true);
    expect(isDateString('2026-02-30')).toBe(false);
    expect(isDateString('20261112')).toBe(false);
    expect(isDateString(null)).toBe(false);
  });
});
