/**
 * Part codes carry meaning in their suffix.
 *
 * Every code ends in a segment that names either a DEPARTMENT or a WAREHOUSE:
 *   departments — 03, SC, SO, H2O, DEM, HD, IN, RT, EX, TDC, WR, 01, 02, DP …
 *   warehouses  — LNDN (London), WIND (Windsor), EDM (Edmonton),
 *                 MISS (Mississauga), CAL (Calgary)
 *
 * Only 28% of the catalogue has a category, so these segments are the axis that
 * actually covers the whole catalogue. The import parses them off every code;
 * what each one MEANS is a lookup an admin fills in (CodeSegment), because the
 * list grows whenever a new price list lands and naming one should not need a
 * deploy.
 */

/** Suffixes that are plainly a place. Seeded as WAREHOUSE with a suggested
 *  label, still flagged unconfirmed so a human signs off. */
export const SUGGESTED_WAREHOUSES: Record<string, string> = {
  LNDN: 'London',
  WIND: 'Windsor',
  EDM: 'Edmonton',
  MISS: 'Mississauga',
  CAL: 'Calgary',
};

/**
 * Pull the trailing segment off a part code.
 *
 * "0208W.IN" -> "IN";  "10010006.SC" -> "SC";  "050822W" -> null.
 * Upper-cased so ".h2o" and ".H2O" are one segment, and "H20" (a typo present
 * in 3 seed rows) is folded into "H2O" rather than becoming its own department.
 */
export function segmentOf(code: string | null | undefined): string | null {
  if (!code) return null;
  const m = /\.([A-Za-z0-9]+)\s*$/.exec(String(code).trim());
  if (!m) return null;
  const seg = m[1].toUpperCase();
  return seg === 'H20' ? 'H2O' : seg;
}

/**
 * Parse the cross-reference notes the catalogue carries, of the form
 *   "Also used for: WHF Replacement Parts - 150295.IN"
 * into the part codes they point at, so fitment is structured data rather than
 * a sentence nobody can filter on.
 */
export function alsoUsedForCodes(note: string | null | undefined): string[] {
  if (!note) return [];
  const out = new Set<string>();
  for (const chunk of String(note).split(/[;\n]/)) {
    const m = /-\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*$/.exec(chunk.trim());
    if (m) out.add(m[1].toUpperCase());
  }
  return [...out];
}

/** Normalise a code for storage and comparison: trimmed, upper-cased. */
export function normalizeCode(code: unknown): string | null {
  if (code === null || code === undefined) return null;
  const s = String(code).trim().toUpperCase();
  return s === '' ? null : s;
}

/**
 * Split a code cell that carries a supersession annotation.
 *
 * The catalogue writes a retired part as "36002018 (USE 400547)" — the number
 * stamped on the part the dealer is holding, plus what to send instead. Both
 * halves matter: the old number is what gets searched, the new one is what gets
 * shipped. Stored as separate fields so neither is lost in a string.
 */
export function parseSupersession(raw: unknown): {
  code: string | null;
  supersededBy: string | null;
} {
  const s = normalizeCode(raw);
  if (!s) return { code: null, supersededBy: null };
  const m = /^(.+?)\s*\(\s*USE\s+([A-Z0-9._-]+)\s*\)$/i.exec(s);
  if (!m) return { code: s, supersededBy: null };
  return { code: normalizeCode(m[1]), supersededBy: normalizeCode(m[2]) };
}
