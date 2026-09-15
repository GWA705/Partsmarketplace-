import type { Prisma } from '@prisma/client';

/**
 * The ONLY shape a dealer-facing query may select.
 *
 * `costCents` is vendor cost, and it sits in the source spreadsheet right next
 * to the vendor's name. Showing a dealer that a union connector costs us $2.24
 * hands them our margin on every part and our supplier list on top of it.
 *
 * That is not something to be careful about in a template — templates get
 * copied. It is enforced here: every read in the (dealer) route group goes
 * through `dealerPartSelect`, which cannot express `costCents`, so a dealer
 * payload physically cannot carry one. The type below makes a mistake a
 * compile error rather than a leak.
 */
export const dealerPartSelect = {
  id: true,
  code: true,
  catalogueCode: true,
  name: true,
  catalogueName: true,
  vendor: true,
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
  note: true,
  fitsSkus: true,
  category: { select: { id: true, name: true } },
  segment: { select: { code: true, kind: true, label: true } },
} satisfies Prisma.PartSelect;

export type DealerPart = Prisma.PartGetPayload<{ select: typeof dealerPartSelect }>;

/**
 * Staff see cost — that is the number the office needs for job costing and for
 * deciding a markup. Separate constant, separate route group, no overlap.
 */
export const staffPartSelect = {
  ...dealerPartSelect,
  costCents: true,
  source: true,
  sortOrder: true,
  importedAt: true,
  alsoUsedFor: true,
} satisfies Prisma.PartSelect;

export type StaffPart = Prisma.PartGetPayload<{ select: typeof staffPartSelect }>;

/**
 * Strip cost from anything before it crosses into a dealer response. A belt to
 * the select's braces, for payloads assembled by hand.
 */
export function withoutCost<T extends Record<string, unknown>>(row: T): Omit<T, 'costCents'> {
  const { costCents: _drop, ...rest } = row as T & { costCents?: unknown };
  return rest;
}
