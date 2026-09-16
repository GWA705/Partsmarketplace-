import 'server-only';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';

/**
 * Catalogue search.
 *
 * The catalogue is 1,380 parts and only 28% of them carry a category, so
 * browsing by category was never going to be the way in — search is. What a
 * dealer actually does is read the number stamped on the part in their hand and
 * type some of it, so partial code matching matters more than clever ranking:
 * "0208" must find "0208W.IN", and the number may be in either code column
 * because the price list and the catalogue disagree on 137 parts.
 *
 * Ranking, highest first:
 *   1. exact code match (either column)
 *   2. code starts with the query
 *   3. code contains the query
 *   4. full-text hit on the description, weighted name > catalogue name > vendor
 *   5. fuzzy description match, for typos
 */

export type SortKey = 'relevance' | 'code' | 'name' | 'price' | 'vendor';

export interface SearchParams {
  q?: string;
  categoryId?: string;
  vendor?: string;
  segmentCode?: string;
  fulfilledBy?: 'HEAD_OFFICE' | 'SUPPLIER';
  tag?: string;
  /** Restrict to parts fitting these portal SKUs — used by the portal embed. */
  fitsSkus?: string[];
  /** Restrict to parts this dealer has ordered before. */
  orderedByDealerId?: string;
  sort?: SortKey;
  page?: number;
  pageSize?: number;
  /** Dealers never see inactive parts; admins do. */
  includeInactive?: boolean;
  /**
   * Whether a free-text query may match the vendor column. False for dealers:
   * the vendor is not shown to them, and a search that still matched it would
   * let anyone type "Watergroup" and read our supplier list off the results.
   */
  matchVendor?: boolean;
}

export interface SearchHit {
  id: string;
  rank: number;
}

export interface SearchResult {
  ids: string[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

/**
 * Resolve a query to an ordered page of part ids.
 *
 * Returns ids rather than rows on purpose: the caller then fetches them with
 * either `dealerPartSelect` or `staffPartSelect`, so one search implementation
 * serves both without ever being the thing that decides who sees cost.
 */
export async function searchParts(params: SearchParams): Promise<SearchResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
  const offset = (page - 1) * pageSize;
  const q = (params.q ?? '').trim();

  const where: Prisma.Sql[] = [];
  if (!params.includeInactive) where.push(Prisma.sql`p."active" = true`);
  if (params.categoryId) where.push(Prisma.sql`p."categoryId" = ${params.categoryId}`);
  if (params.vendor) where.push(Prisma.sql`p."vendor" = ${params.vendor}`);
  if (params.segmentCode) where.push(Prisma.sql`p."segmentCode" = ${params.segmentCode}`);
  if (params.fulfilledBy) {
    where.push(Prisma.sql`p."fulfilledBy"::text = ${params.fulfilledBy}`);
  }
  if (params.tag) where.push(Prisma.sql`${params.tag} = ANY(p."tags")`);
  if (params.fitsSkus?.length) {
    where.push(Prisma.sql`p."fitsSkus" && ${params.fitsSkus}::text[]`);
  }
  if (params.orderedByDealerId) {
    where.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "OrderLine" ol
      JOIN "Shipment" s ON s."id" = ol."shipmentId"
      JOIN "Order" o ON o."id" = s."orderId"
      WHERE ol."partId" = p."id" AND o."dealerId" = ${params.orderedByDealerId}
    )`);
  }

  const matchVendor = params.matchVendor !== false;

  // Defined once and reused by the WHERE clause and the ranking below, so the
  // two can never disagree about whether vendor is searchable.
  const textVector = Prisma.sql`(
    setweight(to_tsvector('english', coalesce(p."name", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(p."catalogueName", '')), 'B')
    ${matchVendor
      ? Prisma.sql`|| setweight(to_tsvector('english', coalesce(p."vendor", '')), 'C')`
      : Prisma.empty}
  )`;

  if (q) {
    const like = `%${q.toLowerCase()}%`;
    // Fuzzy matching is worth its noise only on a word. On a short string —
    // which is nearly always somebody typing a part number — trigram
    // similarity would drag in half the catalogue, so substring and full-text
    // carry it alone.
    const fuzzy =
      q.length >= 4
        ? Prisma.sql`
      OR lower(coalesce(p."name", '')) % ${q.toLowerCase()}
      OR lower(coalesce(p."catalogueName", '')) % ${q.toLowerCase()}`
        : Prisma.empty;

    where.push(Prisma.sql`(
      lower(p."code") LIKE ${like}
      OR lower(p."catalogueCode") LIKE ${like}
      OR lower(p."name") LIKE ${like}
      OR lower(p."catalogueName") LIKE ${like}
      ${matchVendor ? Prisma.sql`OR lower(p."vendor") LIKE ${like}` : Prisma.empty}
      OR ${textVector} @@ plainto_tsquery('english', ${q})
      ${fuzzy}
    )`);
  }

  const whereSql = where.length
    ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}`
    : Prisma.empty;

  // Relevance is only meaningful with a query; without one, fall back to the
  // office's own ordering so the default view is not arbitrary.
  const sort = params.sort ?? (q ? 'relevance' : 'code');
  const exact = q.toLowerCase();
  const prefix = `${q.toLowerCase()}%`;
  const contains = `%${q.toLowerCase()}%`;

  const relevance = q
    ? Prisma.sql`(
        CASE
          WHEN lower(p."code") = ${exact} OR lower(p."catalogueCode") = ${exact} THEN 100
          WHEN lower(p."code") LIKE ${prefix} OR lower(p."catalogueCode") LIKE ${prefix} THEN 80
          WHEN lower(p."code") LIKE ${contains} OR lower(p."catalogueCode") LIKE ${contains} THEN 60
          ELSE 0
        END
        + ts_rank(${textVector}, plainto_tsquery('english', ${q})) * 20
        + similarity(lower(coalesce(p."name", '')), ${exact}) * 10
      )`
    : Prisma.sql`0`;

  const orderSql =
    sort === 'code'
      ? Prisma.sql`ORDER BY p."code" ASC NULLS LAST, p."name" ASC`
      : sort === 'name'
        ? Prisma.sql`ORDER BY p."name" ASC`
        : sort === 'vendor'
          ? Prisma.sql`ORDER BY p."vendor" ASC NULLS LAST, p."name" ASC`
          : sort === 'price'
            ? Prisma.sql`ORDER BY p."dealerCents" ASC NULLS LAST, p."name" ASC`
            : Prisma.sql`ORDER BY ${relevance} DESC, p."code" ASC NULLS LAST`;

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`
      SELECT p."id" FROM "Part" p
      ${whereSql}
      ${orderSql}
      LIMIT ${pageSize} OFFSET ${offset}
    `,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM "Part" p ${whereSql}
    `,
  ]);

  const total = Number(countRows[0]?.n ?? 0);
  return {
    ids: rows.map((r) => r.id),
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Filter options for the sidebar, counted against the live catalogue. */
export async function facets() {
  const [categories, vendors, segments] = await Promise.all([
    prisma.partCategory.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, _count: { select: { parts: true } } },
    }),
    prisma.part.groupBy({
      by: ['vendor'],
      where: { active: true, vendor: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { vendor: 'desc' } },
    }),
    prisma.codeSegment.findMany({
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }],
      select: {
        code: true,
        kind: true,
        label: true,
        confirmed: true,
        _count: { select: { parts: true } },
      },
    }),
  ]);

  return {
    categories: categories.map((c) => ({ id: c.id, name: c.name, count: c._count.parts })),
    vendors: vendors
      .filter((v) => v.vendor)
      .map((v) => ({ name: v.vendor as string, count: v._count._all })),
    segments: segments.map((s) => ({
      code: s.code,
      kind: s.kind,
      label: s.label,
      confirmed: s.confirmed,
      count: s._count.parts,
    })),
  };
}
