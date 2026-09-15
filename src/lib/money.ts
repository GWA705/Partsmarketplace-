/**
 * Money is stored as integer cents, everywhere, always.
 *
 * The source price list carries values like 3.689 and 1.32909 — vendor prices
 * quoted to more than two decimals. Rounding those to cents at the boundary
 * (here, on import) and never touching a float again is what keeps an order
 * total from drifting a penny off what the packing slip says.
 */

/** Parse a spreadsheet price cell into cents. Returns null for blanks/junk. */
export function toCents(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** "$1,234.56" — the only place cents become a string for a human. */
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return (cents / 100).toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
  });
}

/** Apply a percentage markup to a cost, rounded to `roundTo` cents. */
export function applyMarkup(costCents: number, markupPct: number, roundTo = 1): number {
  const raw = costCents * (1 + markupPct / 100);
  const step = Math.max(1, Math.round(roundTo));
  return Math.round(raw / step) * step;
}
