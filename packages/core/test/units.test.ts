import { describe, it, expect } from 'vitest';
import {
  canCombine, formatAmount, formatKindAmounts, friendlyAmount, fromBase, quickAddBase, toBase, unitKind,
} from '../src/units';

describe('units', () => {
  it('maps units to kinds', () => {
    expect(unitKind('g')).toBe('weight');
    expect(unitKind('kg')).toBe('weight');
    expect(unitKind('pcs')).toBe('count');
    expect(unitKind('serving')).toBe('serving');
  });

  it('one click adds 100 g, 1 kg, 1 pc or 1 serving', () => {
    expect(quickAddBase('g')).toBe(100);
    expect(quickAddBase('kg')).toBe(1000);
    expect(quickAddBase('pcs')).toBe(1);
    expect(quickAddBase('serving')).toBe(1);
  });

  it('converts between g and kg', () => {
    expect(toBase(1.5, 'kg')).toBe(1500);
    expect(toBase(250, 'g')).toBe(250);
    expect(fromBase(1500, 'kg')).toBe(1.5);
  });

  it('500 g plus 1 kg shows as 1.5 kg (acceptance 12)', () => {
    const total = toBase(500, 'g') + toBase(1, 'kg');
    expect(formatAmount(total, 'g')).toBe('1.5 kg');
  });

  it('only combines compatible units (acceptance 12)', () => {
    expect(canCombine('g', 'kg')).toBe(true);
    expect(canCombine('pcs', 'g')).toBe(false);
    expect(canCombine('pcs', 'serving')).toBe(false);
    expect(canCombine('serving', 'serving')).toBe(true);
  });

  it('formats amounts for display', () => {
    expect(formatAmount(300, 'g')).toBe('300 g');
    expect(formatAmount(500, 'kg')).toBe('0.5 kg');
    expect(formatAmount(1, 'pcs')).toBe('1 pc');
    expect(formatAmount(3, 'pcs')).toBe('3 pcs');
    expect(formatAmount(1, 'serving')).toBe('1 serving');
    expect(formatAmount(2.5, 'serving')).toBe('2.5 servings');
    expect(formatKindAmounts({ count: 3, weight: 200 })).toBe('200 g + 3 pcs');
    expect(formatKindAmounts({})).toBe('0');
  });

  it('describes amounts in a kitchen-friendly way', () => {
    expect(friendlyAmount(500, 1000, 'g')).toBe("half of what's left (500 g)");
    expect(friendlyAmount(1000, 1000, 'g')).toBe('all of it (1 kg)');
    expect(friendlyAmount(100, 300, 'g')).toBe("one third of what's left (100 g)");
    expect(friendlyAmount(2, 3, 'pcs')).toBe('2 pcs');
    expect(friendlyAmount(3, 3, 'pcs')).toBe('all of it (3 pcs)');
    expect(friendlyAmount(170, 1000, 'g')).toBe('170 g');
  });
});
