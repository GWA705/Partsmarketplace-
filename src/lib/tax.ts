/**
 * Canadian sales tax, worked out from where the goods go.
 *
 * The rules this implements, and why each one is here:
 *
 *  · Tax follows the SHIP-TO province, not ours. A Barrie business shipping to
 *    Calgary charges Alberta's 5% GST, not Ontario's 13% HST.
 *  · Harmonised provinces get one line (HST). The rest get GST and, separately,
 *    the province's own tax — they are two different taxes and an invoice has
 *    to show them separately.
 *  · A provincial tax is only charged by a business registered in that
 *    province. GST/HST is charged on every Canadian sale once registered
 *    federally. Charging BC PST without a BC registration over-collects, so
 *    each region carries a `collectProvincial` flag that is off until someone
 *    says otherwise.
 *  · A dealer buying for resale is usually exempt from the PROVINCIAL tax and
 *    still pays GST/HST, which they recover as an input tax credit. Treating
 *    "resale" as exempt from everything under-collects federal tax, so the two
 *    exemptions are separate flags.
 *
 * Rates are integers in thousandths of a percent — 13% is 13000, Quebec's
 * 9.975% is 9975 — so no rate is ever a float. Same reason money is in cents.
 *
 * None of this is tax advice. The rates ship as a starting point and live in
 * the database precisely so an accountant can correct them without a deploy.
 */

export interface TaxRegionRow {
  code: string;
  label: string;
  hstThou: number | null;
  gstThou: number | null;
  provincialThou: number | null;
  provincialLabel: string | null;
  collectProvincial: boolean;
}

export interface TaxLine {
  label: string;
  rateThou: number;
  amountCents: number;
  sortOrder: number;
}

export interface TaxInput {
  subtotalCents: number;
  region: TaxRegionRow | null;
  /** Off until we have a registration number to print. */
  chargeTax: boolean;
  gstExempt?: boolean;
  provincialExempt?: boolean;
}

/** Format a thousandths-of-a-percent rate the way it prints: 13%, 9.975%. */
export function ratePct(rateThou: number): string {
  const pct = rateThou / 1000;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(3).replace(/0+$/, '')}%`;
}

/** Tax on an amount, rounded to the cent. */
export function taxOn(subtotalCents: number, rateThou: number): number {
  return Math.round((subtotalCents * rateThou) / 100_000);
}

/**
 * The tax lines for an order.
 *
 * Returns an empty list rather than a zero line when no tax applies — an
 * invoice showing "Tax $0.00" invites the question of why, where showing
 * nothing is simply an untaxed sale.
 */
export function calculateTax(input: TaxInput): TaxLine[] {
  const { subtotalCents, region } = input;
  if (!input.chargeTax || !region || subtotalCents <= 0) return [];

  const lines: TaxLine[] = [];

  // Harmonised provinces: one line, and the provincial half is inside it, so
  // a provincial exemption cannot be applied to part of it.
  if (region.hstThou && region.hstThou > 0) {
    if (!input.gstExempt) {
      lines.push({
        label: `HST ${ratePct(region.hstThou)}`,
        rateThou: region.hstThou,
        amountCents: taxOn(subtotalCents, region.hstThou),
        sortOrder: 0,
      });
    }
    return lines;
  }

  if (region.gstThou && region.gstThou > 0 && !input.gstExempt) {
    lines.push({
      label: `GST ${ratePct(region.gstThou)}`,
      rateThou: region.gstThou,
      amountCents: taxOn(subtotalCents, region.gstThou),
      sortOrder: 0,
    });
  }

  if (
    region.provincialThou &&
    region.provincialThou > 0 &&
    region.collectProvincial &&
    !input.provincialExempt
  ) {
    // Quebec's QST is charged on the pre-GST amount, as is every other
    // provincial tax here — none of them stack on the federal line.
    lines.push({
      label: `${region.provincialLabel ?? 'PST'} ${ratePct(region.provincialThou)}`,
      rateThou: region.provincialThou,
      amountCents: taxOn(subtotalCents, region.provincialThou),
      sortOrder: 1,
    });
  }

  return lines;
}

export const taxTotal = (lines: TaxLine[]): number =>
  lines.reduce((sum, l) => sum + l.amountCents, 0);

// ─────────────────────────────────────────────────────────────────────────────
// Turning an address into a region
// ─────────────────────────────────────────────────────────────────────────────

const PROVINCE_ALIASES: Record<string, string> = {
  AB: 'AB', ALBERTA: 'AB',
  BC: 'BC', 'BRITISH COLUMBIA': 'BC',
  MB: 'MB', MANITOBA: 'MB',
  NB: 'NB', 'NEW BRUNSWICK': 'NB',
  NL: 'NL', NF: 'NL', NEWFOUNDLAND: 'NL', 'NEWFOUNDLAND AND LABRADOR': 'NL',
  NS: 'NS', 'NOVA SCOTIA': 'NS',
  NT: 'NT', 'NORTHWEST TERRITORIES': 'NT',
  NU: 'NU', NUNAVUT: 'NU',
  ON: 'ON', ONTARIO: 'ON',
  PE: 'PE', PEI: 'PE', 'PRINCE EDWARD ISLAND': 'PE',
  QC: 'QC', PQ: 'QC', QUEBEC: 'QC', 'QUÉBEC': 'QC',
  SK: 'SK', SASKATCHEWAN: 'SK',
  YT: 'YT', YUKON: 'YT',
};

/**
 * Normalise whatever was typed into an address field to a province code.
 *
 * People type "Ontario", "ON", "ont." and "on" into the same box, and a tax
 * calculation that only recognises one of them silently charges nothing.
 */
export function provinceCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.trim().toUpperCase().replace(/\.$/, '');
  if (PROVINCE_ALIASES[key]) return PROVINCE_ALIASES[key];
  // "Ont" / "Que" and similar truncations.
  const match = Object.keys(PROVINCE_ALIASES).find(
    (k) => k.length > 2 && k.startsWith(key) && key.length >= 3,
  );
  return match ? PROVINCE_ALIASES[match] : null;
}

/** The rates as of this build. Seeded into TaxRegion, editable thereafter. */
export const SEED_REGIONS: (TaxRegionRow & { note?: string })[] = [
  { code: 'AB', label: 'Alberta', hstThou: null, gstThou: 5000, provincialThou: null, provincialLabel: null, collectProvincial: false },
  { code: 'BC', label: 'British Columbia', hstThou: null, gstThou: 5000, provincialThou: 7000, provincialLabel: 'PST', collectProvincial: false },
  { code: 'MB', label: 'Manitoba', hstThou: null, gstThou: 5000, provincialThou: 7000, provincialLabel: 'RST', collectProvincial: false },
  { code: 'NB', label: 'New Brunswick', hstThou: 15000, gstThou: null, provincialThou: null, provincialLabel: null, collectProvincial: false },
  { code: 'NL', label: 'Newfoundland and Labrador', hstThou: 15000, gstThou: null, provincialThou: null, provincialLabel: null, collectProvincial: false },
  { code: 'NS', label: 'Nova Scotia', hstThou: 14000, gstThou: null, provincialThou: null, provincialLabel: null, collectProvincial: false, note: 'Reduced from 15% on 1 April 2025.' },
  { code: 'NT', label: 'Northwest Territories', hstThou: null, gstThou: 5000, provincialThou: null, provincialLabel: null, collectProvincial: false },
  { code: 'NU', label: 'Nunavut', hstThou: null, gstThou: 5000, provincialThou: null, provincialLabel: null, collectProvincial: false },
  { code: 'ON', label: 'Ontario', hstThou: 13000, gstThou: null, provincialThou: null, provincialLabel: null, collectProvincial: false },
  { code: 'PE', label: 'Prince Edward Island', hstThou: 15000, gstThou: null, provincialThou: null, provincialLabel: null, collectProvincial: false },
  { code: 'QC', label: 'Quebec', hstThou: null, gstThou: 5000, provincialThou: 9975, provincialLabel: 'QST', collectProvincial: false },
  { code: 'SK', label: 'Saskatchewan', hstThou: null, gstThou: 5000, provincialThou: 6000, provincialLabel: 'PST', collectProvincial: false },
  { code: 'YT', label: 'Yukon', hstThou: null, gstThou: 5000, provincialThou: null, provincialLabel: null, collectProvincial: false },
];
