import { describe, it, expect } from 'vitest';
import {
  calculateTax, taxOn, taxTotal, ratePct, provinceCode, SEED_REGIONS,
  type TaxRegionRow,
} from '@/lib/tax';

const region = (code: string, over: Partial<TaxRegionRow> = {}): TaxRegionRow => ({
  ...(SEED_REGIONS.find((r) => r.code === code) as TaxRegionRow),
  ...over,
});

const base = { subtotalCents: 10_000, chargeTax: true };

describe('taxOn', () => {
  it('works in exact integers, including a rate with three decimals', () => {
    expect(taxOn(10_000, 13_000)).toBe(1_300);   // 13% of $100 = $13.00
    expect(taxOn(10_000, 5_000)).toBe(500);      // 5%  of $100 = $5.00
    expect(taxOn(10_000, 9_975)).toBe(998);      // 9.975% of $100 = $9.975 -> $9.98
  });

  it('rounds to the cent rather than carrying a fraction', () => {
    expect(taxOn(1_999, 13_000)).toBe(260);      // 13% of $19.99 = $2.5987
  });
});

describe('ratePct', () => {
  it('prints whole rates plainly and fractional ones exactly', () => {
    expect(ratePct(13_000)).toBe('13%');
    expect(ratePct(5_000)).toBe('5%');
    expect(ratePct(9_975)).toBe('9.975%');
  });
});

describe('calculateTax', () => {
  it('charges Ontario one HST line', () => {
    const lines = calculateTax({ ...base, region: region('ON') });
    expect(lines).toHaveLength(1);
    expect(lines[0].label).toBe('HST 13%');
    expect(lines[0].amountCents).toBe(1_300);
  });

  it('charges Alberta GST alone', () => {
    const lines = calculateTax({ ...base, region: region('AB') });
    expect(lines).toHaveLength(1);
    expect(lines[0].label).toBe('GST 5%');
    expect(taxTotal(lines)).toBe(500);
  });

  it('follows the ship-to province, not ours', () => {
    // The whole point: a Barrie business shipping to Calgary charges 5%.
    const ab = taxTotal(calculateTax({ ...base, region: region('AB') }));
    const on = taxTotal(calculateTax({ ...base, region: region('ON') }));
    expect(ab).toBe(500);
    expect(on).toBe(1_300);
  });

  it('charges GST alone into BC until we register there', () => {
    const lines = calculateTax({ ...base, region: region('BC') });
    expect(lines.map((l) => l.label)).toEqual(['GST 5%']);
  });

  it('adds BC PST as a separate line once we are registered', () => {
    const lines = calculateTax({ ...base, region: region('BC', { collectProvincial: true }) });
    expect(lines.map((l) => l.label)).toEqual(['GST 5%', 'PST 7%']);
    expect(taxTotal(lines)).toBe(1_200);
  });

  it('calls Manitoba RST and Quebec QST by their own names', () => {
    expect(
      calculateTax({ ...base, region: region('MB', { collectProvincial: true }) })[1].label,
    ).toBe('RST 7%');
    expect(
      calculateTax({ ...base, region: region('QC', { collectProvincial: true }) })[1].label,
    ).toBe('QST 9.975%');
  });

  it('charges QST on the pre-GST amount, not on top of the GST', () => {
    const lines = calculateTax({ ...base, region: region('QC', { collectProvincial: true }) });
    // Both on $100: $5.00 + $9.98. Stacking QST on $105 would give $10.47.
    expect(lines[0].amountCents).toBe(500);
    expect(lines[1].amountCents).toBe(998);
  });

  it('keeps charging GST/HST to a resale-exempt dealer', () => {
    // The common mistake: treating "resale" as exempt from everything, which
    // under-collects federal tax the business still owes.
    const on = calculateTax({ ...base, region: region('ON'), provincialExempt: true });
    expect(on.map((l) => l.label)).toEqual(['HST 13%']);

    const bc = calculateTax({
      ...base,
      region: region('BC', { collectProvincial: true }),
      provincialExempt: true,
    });
    expect(bc.map((l) => l.label)).toEqual(['GST 5%']);
  });

  it('charges nothing to a fully exempt customer', () => {
    expect(
      calculateTax({ ...base, region: region('ON'), gstExempt: true }),
    ).toEqual([]);
    expect(
      calculateTax({
        ...base,
        region: region('BC', { collectProvincial: true }),
        gstExempt: true,
        provincialExempt: true,
      }),
    ).toEqual([]);
  });

  it('charges nothing while the master switch is off', () => {
    expect(calculateTax({ ...base, chargeTax: false, region: region('ON') })).toEqual([]);
  });

  it('charges nothing when the province is unknown', () => {
    // Better an untaxed invoice somebody queries than a wrong rate applied
    // silently to an address we could not read.
    expect(calculateTax({ ...base, region: null })).toEqual([]);
  });

  it('returns no lines rather than a zero line on an empty order', () => {
    expect(calculateTax({ ...base, subtotalCents: 0, region: region('ON') })).toEqual([]);
  });
});

describe('provinceCode', () => {
  it('reads the ways people actually type a province', () => {
    for (const v of ['ON', 'on', ' on ', 'Ontario', 'ontario', 'Ont.', 'Ont']) {
      expect(provinceCode(v)).toBe('ON');
    }
  });

  it('handles the codes that differ from the obvious abbreviation', () => {
    expect(provinceCode('PQ')).toBe('QC');
    expect(provinceCode('Québec')).toBe('QC');
    expect(provinceCode('NF')).toBe('NL');
    expect(provinceCode('PEI')).toBe('PE');
    expect(provinceCode('Yukon')).toBe('YT');
  });

  it('returns null rather than guessing', () => {
    expect(provinceCode('')).toBeNull();
    expect(provinceCode(null)).toBeNull();
    expect(provinceCode('Michigan')).toBeNull();
  });
});

describe('seeded rates', () => {
  it('covers every province and territory', () => {
    expect(SEED_REGIONS).toHaveLength(13);
  });

  it('gives each region either HST or GST, never both', () => {
    for (const r of SEED_REGIONS) {
      const harmonised = r.hstThou !== null;
      expect(harmonised ? r.gstThou : r.hstThou).toBeNull();
    }
  });

  it('starts with every provincial tax uncollected', () => {
    // Charging a province's own tax without being registered there
    // over-collects, so none of them are on until somebody says so.
    expect(SEED_REGIONS.every((r) => !r.collectProvincial)).toBe(true);
  });
});
