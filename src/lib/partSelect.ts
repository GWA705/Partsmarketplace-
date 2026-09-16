import type { Prisma } from '@prisma/client';

/**
 * The ONLY shape a dealer-facing query may select.
 *
 * Two things stay on our side of the counter, for the same reason:
 *
 *   · `costCents` is vendor cost — it sits in the source spreadsheet right next
 *     to the vendor's name. Showing a dealer that a union connector costs us
 *     $2.24 hands them our margin.
 *   · `vendor` is who we buy from. A dealer who can read "Watergroup" off a
 *     row can buy direct next time. The supplier list is the business.
 *
 * Neither is something to be careful about in a template — templates get
 * copied. It is enforced here: every read in a dealer-facing route goes through
 * `dealerPartSelect`, which cannot express either column, so a dealer payload
 * physically cannot carry one. A mistake is a compile error, not a leak.
 *
 * A dealer sees what they need to order: the part number, what it is, a photo,
 * and what it costs them.
 */
export const dealerPartSelect = {
  id: true,
  code: true,
  catalogueCode: true,
  name: true,
  catalogueName: true,
  unit: true,
  dealerCents: true,
  priceOverridden: true,
  fulfilledBy: true,
  categoryId: true,
  segmentCode: true,
  active: true,
  featured: true,
  tags: true,
  imageStorageKey: true,
  imageMime: true,
  note: true,
  supersededBy: true,
  fitsSkus: true,
  category: { select: { id: true, name: true } },
  segment: { select: { code: true, kind: true, label: true } },
} satisfies Prisma.PartSelect;

export type DealerPart = Prisma.PartGetPayload<{ select: typeof dealerPartSelect }>;

/**
 * Staff see the whole row — cost and vendor included. That is the point of the
 * staff catalogue: it is where "who do we buy this from, and for how much"
 * lives, one search away whenever somebody needs it.
 */
export const staffPartSelect = {
  ...dealerPartSelect,
  vendor: true,
  costCents: true,
  source: true,
  sortOrder: true,
  importedAt: true,
  alsoUsedFor: true,
} satisfies Prisma.PartSelect;

export type StaffPart = Prisma.PartGetPayload<{ select: typeof staffPartSelect }>;

/**
 * How a filling party is named to each audience.
 *
 * Staff need the supplier by name to chase an order. A dealer needs to know
 * only that it ships from somewhere other than our shelf, because lead times
 * differ — not who it ships from.
 */
export function fillerLabel(
  fulfilledBy: 'HEAD_OFFICE' | 'SUPPLIER',
  vendor: string | null | undefined,
  audience: 'DEALER' | 'STAFF',
): string {
  if (fulfilledBy === 'HEAD_OFFICE') return 'Head office';
  return audience === 'STAFF' ? vendor || 'Supplier' : 'Ships direct';
}

/** Strip the internal columns from a payload assembled by hand. */
export function forDealer<T extends Record<string, unknown>>(
  row: T,
): Omit<T, 'costCents' | 'vendor'> {
  const { costCents: _c, vendor: _v, ...rest } = row as T & {
    costCents?: unknown;
    vendor?: unknown;
  };
  return rest;
}
