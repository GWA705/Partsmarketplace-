import 'server-only';
import { prisma } from '@/lib/db';
import { searchParts, facets, type SearchParams } from '@/lib/search';
import { dealerPartSelect, staffPartSelect, fillerLabel } from '@/lib/partSelect';
import { loadPricingContext, dealerPrice } from '@/lib/pricing';
import type { SessionUser } from '@/lib/session';

/**
 * A page of catalogue rows, priced for whoever is looking.
 *
 * One entry point for both sides so search behaves identically, while the
 * select — and therefore whether cost can be in the payload at all — is decided
 * here by who is asking, not by a template remembering to leave a column out.
 */

export interface CatalogueRow {
  id: string;
  code: string | null;
  catalogueCode: string | null;
  name: string;
  unit: string | null;
  categoryName: string | null;
  segmentCode: string | null;
  segmentLabel: string | null;
  fulfilledBy: 'HEAD_OFFICE' | 'SUPPLIER';
  /** "Head office" or, for a dealer, "Ships direct" — never the supplier. */
  fillerLabel: string;
  tags: string[];
  hasImage: boolean;
  supersededBy: string | null;
  /** What this viewer pays. Null means "call for pricing". */
  priceCents: number | null;
  /** Staff only — absent entirely from a dealer payload. */
  vendor?: string | null;
  costCents?: number | null;
}

export interface CataloguePage {
  rows: CatalogueRow[];
  total: number;
  page: number;
  pages: number;
  pricesHidden: boolean;
}

export async function cataloguePage(
  user: SessionUser,
  params: SearchParams,
): Promise<CataloguePage> {
  const isDealer = user.kind === 'DEALER';
  const result = await searchParts({
    ...params,
    includeInactive: !isDealer && params.includeInactive,
    // A dealer typing "Watergroup" must not be able to shake out that vendor's
    // parts. Hiding the column is not enough if the search still matches on it.
    matchVendor: !isDealer,
  });

  if (result.ids.length === 0) {
    const ctx = await loadPricingContext();
    return {
      rows: [],
      total: 0,
      page: result.page,
      pages: result.pages,
      pricesHidden: isDealer && !ctx.settings.pricesVisibleToDealers,
    };
  }

  const [parts, ctx] = await Promise.all([
    prisma.part.findMany({
      where: { id: { in: result.ids } },
      select: isDealer ? dealerPartSelect : staffPartSelect,
    }),
    loadPricingContext(),
  ]);

  // findMany does not preserve the search's ordering, so put it back.
  const byId = new Map(parts.map((p) => [p.id, p]));
  const ordered = result.ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p);

  const rows: CatalogueRow[] = ordered.map((p) => {
    const cost = 'costCents' in p ? (p.costCents as number | null) : null;
    const vendor = 'vendor' in p ? (p.vendor as string | null) : null;
    const price = isDealer
      ? dealerPrice(
          {
            costCents: cost,
            dealerCents: p.dealerCents,
            priceOverridden: p.priceOverridden,
            categoryId: p.categoryId,
            vendor,
            segmentCode: p.segmentCode,
          },
          user.dealerTier,
          ctx,
        )
      : cost;

    const row: CatalogueRow = {
      id: p.id,
      code: p.code,
      catalogueCode: p.catalogueCode,
      // The catalogue description is usually the more human of the two.
      name: p.catalogueName || p.name,
      unit: p.unit,
      categoryName: p.category?.name ?? null,
      segmentCode: p.segmentCode,
      segmentLabel: p.segment?.label ?? null,
      fulfilledBy: p.fulfilledBy,
      fillerLabel: fillerLabel(p.fulfilledBy, vendor, isDealer ? 'DEALER' : 'STAFF'),
      tags: p.tags,
      hasImage: !!p.imageStorageKey,
      supersededBy: p.supersededBy,
      priceCents: price,
    };
    if (!isDealer) {
      row.costCents = cost;
      row.vendor = vendor;
    }
    return row;
  });

  return {
    rows,
    total: result.total,
    page: result.page,
    pages: result.pages,
    pricesHidden: isDealer && !ctx.settings.pricesVisibleToDealers,
  };
}

export async function catalogueFacets() {
  return facets();
}

/** A dealer's own most-ordered parts — the list that beats search for repeats. */
export async function frequentlyOrdered(dealerId: string, limit = 12) {
  const rows = await prisma.$queryRaw<{ partId: string; times: bigint; qty: bigint }[]>`
    SELECT ol."partId", count(*)::bigint AS times, sum(ol."quantity")::bigint AS qty
    FROM "OrderLine" ol
    JOIN "Shipment" s ON s."id" = ol."shipmentId"
    JOIN "Order" o ON o."id" = s."orderId"
    WHERE o."dealerId" = ${dealerId} AND ol."partId" IS NOT NULL
    GROUP BY ol."partId"
    ORDER BY times DESC, qty DESC
    LIMIT ${limit}
  `;
  if (!rows.length) return [];

  const parts = await prisma.part.findMany({
    where: { id: { in: rows.map((r) => r.partId) }, active: true },
    select: dealerPartSelect,
  });
  const byId = new Map(parts.map((p) => [p.id, p]));
  return rows
    .map((r) => {
      const p = byId.get(r.partId);
      return p ? { part: p, times: Number(r.times), qty: Number(r.qty) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}
