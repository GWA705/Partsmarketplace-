import { describe, it, expect } from 'vitest';
import { toCents, formatCents, applyMarkup } from '@/lib/money';

describe('toCents', () => {
  it('rounds vendor prices quoted past two decimals', () => {
    // Real values from the price list: 3.689 and 1.32909.
    expect(toCents(3.689)).toBe(369);
    expect(toCents(1.32909)).toBe(133);
    expect(toCents(412.31)).toBe(41231);
  });

  it('accepts a formatted string', () => {
    expect(toCents('$1,234.56')).toBe(123456);
  });

  it('rejects blanks and junk rather than guessing zero', () => {
    expect(toCents(null)).toBeNull();
    expect(toCents('')).toBeNull();
    expect(toCents('n/a')).toBeNull();
    expect(toCents(-5)).toBeNull();
  });

  it('keeps a genuine zero, which is not the same as missing', () => {
    expect(toCents(0)).toBe(0);
  });
});

describe('applyMarkup', () => {
  it('applies a percentage over cost', () => {
    expect(applyMarkup(1000, 35)).toBe(1350);
    expect(applyMarkup(224, 35)).toBe(302);
  });

  it('rounds to the configured step', () => {
    expect(applyMarkup(224, 35, 5)).toBe(300);
    expect(applyMarkup(1000, 0, 100)).toBe(1000);
  });
});

describe('formatCents', () => {
  it('shows an em dash rather than $0.00 for a missing price', () => {
    expect(formatCents(null)).toBe('—');
    expect(formatCents(0)).toContain('0.00');
  });
});
