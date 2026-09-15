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

/**
 * Zero cost is the trap in this price list: 68 seed rows carry 0 in the price
 * column — a 400T main circuit board among them — because the cell was never
 * filled in, not because the part is free.
 */
import { dealerPrice } from '@/lib/pricing';

describe('dealerPrice', () => {
  const ctx = {
    settings: { defaultMarkupPct: 35, pricesVisibleToDealers: true, roundToCents: 1 },
    rules: [],
  };
  const base = {
    dealerCents: null,
    priceOverridden: false,
    categoryId: null,
    vendor: null,
    segmentCode: null,
  };

  it('never quotes a zero-cost part as free', () => {
    expect(dealerPrice({ ...base, costCents: 0 }, 'STANDARD', ctx)).toBeNull();
  });

  it('marks up a real cost', () => {
    expect(dealerPrice({ ...base, costCents: 1000 }, 'STANDARD', ctx)).toBe(1350);
  });

  it('says nothing when there is no cost at all', () => {
    expect(dealerPrice({ ...base, costCents: null }, 'STANDARD', ctx)).toBeNull();
  });

  it('hides derived prices while the switch is off', () => {
    const off = { ...ctx, settings: { ...ctx.settings, pricesVisibleToDealers: false } };
    expect(dealerPrice({ ...base, costCents: 1000 }, 'STANDARD', off)).toBeNull();
  });

  it('still shows a hand-set price while the switch is off', () => {
    // Somebody typed this deliberately, so it is not a guess to withhold.
    const off = { ...ctx, settings: { ...ctx.settings, pricesVisibleToDealers: false } };
    expect(
      dealerPrice({ ...base, costCents: 0, dealerCents: 4999, priceOverridden: true }, 'STANDARD', off),
    ).toBe(4999);
  });
});
