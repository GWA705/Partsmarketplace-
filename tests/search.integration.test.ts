import { describe, it, expect, beforeAll } from 'vitest';
import { searchParts, facets } from '@/lib/search';
import { prisma } from '@/lib/db';

/**
 * Search, against a real database holding the real catalogue.
 *
 * Skips itself when there is no database or no imported catalogue, so it is
 * safe to run anywhere; it is the test that matters most when there is, because
 * search is the whole navigation model for a catalogue that is 72%
 * uncategorized.
 */
let hasData = false;

beforeAll(async () => {
  try {
    hasData = (await prisma.part.count()) > 100;
  } catch {
    hasData = false;
  }
});

const names = async (ids: string[]) => {
  const rows = await prisma.part.findMany({
    where: { id: { in: ids } },
    select: { id: true, code: true, catalogueCode: true, name: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)!);
};

describe.runIf(process.env.DATABASE_URL)('searchParts', () => {
  it('finds a part from a fragment of its code', async () => {
    if (!hasData) return;
    const r = await searchParts({ q: '0208' });
    expect(r.total).toBeGreaterThan(0);
    const hits = await names(r.ids);
    expect(hits.some((h) => h.code?.startsWith('0208'))).toBe(true);
  });

  it('ranks an exact code match first', async () => {
    if (!hasData) return;
    const r = await searchParts({ q: '0208W.IN' });
    const hits = await names(r.ids);
    expect(hits[0].code).toBe('0208W.IN');
  });

  it('finds a part by the OTHER code column', async () => {
    if (!hasData) return;
    // The price list calls it 0208W.IN; the catalogue calls it 0208W.H2O.
    // A dealer reads whichever is on the part in their hand.
    const r = await searchParts({ q: '0208W.H2O' });
    expect(r.total).toBeGreaterThan(0);
    const hits = await names(r.ids);
    expect(hits[0].catalogueCode === '0208W.H2O' || hits[0].code === '0208W.H2O').toBe(true);
  });

  it('finds parts by words in the description', async () => {
    if (!hasData) return;
    const r = await searchParts({ q: 'union connector' });
    expect(r.total).toBeGreaterThan(0);
    const hits = await names(r.ids);
    expect(hits.some((h) => /union/i.test(h.name))).toBe(true);
  });

  it('survives a typo', async () => {
    if (!hasData) return;
    const r = await searchParts({ q: 'conector' });
    expect(r.total).toBeGreaterThan(0);
  });

  it('filters by vendor without a query', async () => {
    if (!hasData) return;
    const r = await searchParts({ vendor: 'Watergroup' });
    expect(r.total).toBeGreaterThan(100);
  });

  it('pages without losing or repeating rows', async () => {
    if (!hasData) return;
    const p1 = await searchParts({ sort: 'code', page: 1, pageSize: 25 });
    const p2 = await searchParts({ sort: 'code', page: 2, pageSize: 25 });
    expect(p1.ids).toHaveLength(25);
    expect(new Set([...p1.ids, ...p2.ids]).size).toBe(50);
  });

  it('excludes inactive parts unless asked', async () => {
    if (!hasData) return;
    const visible = await searchParts({});
    const all = await searchParts({ includeInactive: true });
    // The catalogue-only rows have no code and no price, so they import
    // inactive and must not reach a dealer.
    expect(all.total).toBeGreaterThan(visible.total);
  });
});

describe.runIf(process.env.DATABASE_URL)('facets', () => {
  it('counts categories, vendors and code segments', async () => {
    if (!hasData) return;
    const f = await facets();
    expect(f.categories.length).toBeGreaterThan(10);
    expect(f.vendors.length).toBeGreaterThan(10);
    expect(f.segments.length).toBeGreaterThan(10);
    expect(f.vendors[0].count).toBeGreaterThan(f.vendors[f.vendors.length - 1].count - 1);
  });
});

/**
 * Hiding the vendor column achieves nothing if the search still matches on it:
 * a dealer could type "Watergroup" and read the supplier list off the results
 * by inference. The query has to be blind to it too.
 */
describe.runIf(process.env.DATABASE_URL)('vendor is not searchable for dealers', () => {
  it('finds parts by vendor name for staff', async () => {
    if (!hasData) return;
    const r = await searchParts({ q: 'Watergroup', matchVendor: true });
    expect(r.total).toBeGreaterThan(50);
  });

  it('finds none of them for a dealer', async () => {
    if (!hasData) return;
    const r = await searchParts({ q: 'Watergroup', matchVendor: false });
    // A handful of parts mention a maker in their own description; what must
    // not happen is the vendor column pulling in that vendor's whole shelf.
    expect(r.total).toBeLessThan(10);
  });

  it('still finds parts by description with vendor matching off', async () => {
    if (!hasData) return;
    const r = await searchParts({ q: 'union connector', matchVendor: false });
    expect(r.total).toBeGreaterThan(0);
  });

  it('still finds parts by code with vendor matching off', async () => {
    if (!hasData) return;
    const r = await searchParts({ q: '0208', matchVendor: false });
    expect(r.total).toBeGreaterThan(0);
  });
});
