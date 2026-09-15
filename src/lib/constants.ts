/** Merchandising badges an admin can put on a part. */
export interface PartTag {
  key: string;
  label: string;
  badgeClass: string;
}

export const PART_TAGS: PartTag[] = [
  { key: 'NEW', label: 'New', badgeClass: 'bg-emerald-600 text-white' },
  { key: 'SALE', label: 'Sale', badgeClass: 'bg-red-600 text-white' },
  { key: 'CLEARANCE', label: 'Clearance', badgeClass: 'bg-orange-600 text-white' },
  { key: 'POPULAR', label: 'Popular', badgeClass: 'bg-violet-600 text-white' },
];

export const PART_TAG_KEYS = PART_TAGS.map((t) => t.key);
export const partTag = (key: string) => PART_TAGS.find((t) => t.key === key);

/**
 * Shipping methods offered at checkout. `value` is what we store, email and
 * print, so it stays stable English — the shipper reads the same term every
 * time regardless of what the UI shows.
 */
export const SHIPPING_METHODS = [
  'Standard ground',
  'Rush / express',
  'Courier',
  'Pickup at head office',
] as const;

export type ShippingMethod = (typeof SHIPPING_METHODS)[number];

/** Image types accepted for a part photo. */
export const PART_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** How many parts a search page shows before paging. */
export const PAGE_SIZE = 50;
