# GWA Portal — Marketplace feature: complete source bundle

This is an export of every file that makes up the **Marketplace** feature in the
GWA Dealer Portal, packaged so it can be lifted into another Next.js 14 (App
Router) + Prisma/PostgreSQL project.

## What the feature does
A no-price **ordering system** (not e-commerce — no payment):
- Admins create **items** with a photo, description, options (e.g. sizes),
  per-option SKUs, category, merchandising tags (New/Sale/Clearance/Popular),
  and "featured / New Arrivals" flag. Items are either **ORDER** (dealers order
  qty + option) or **DOWNLOAD** (dealers download an attached file).
- Dealers browse by category, add to a cart, pick a **shipping method**, add a
  note, and submit an **order**. Submitting emails the fulfillment team and
  generates a **packing-slip PDF** (pdf-lib, no headless browser).
- Product photos and downloadable files are stored via a storage abstraction
  (S3 in prod / local in dev) and streamed through API routes.

## Stack assumptions in this code (swap as needed for the new marketplace)
- Next.js 14 App Router: `(admin)` and `(dealer)` route groups, server actions.
- Prisma + PostgreSQL. Auth/session via `@/lib/session` (getSessionUser).
- Storage via `@/lib/storage` (putObject/getObject/deleteObject).
- Email via `@/lib/email` (sendEmail) + `@/lib/email-templates`.
- Image normalize/resize via `@/lib/image` used on upload.
- PDF via `pdf-lib`. Audit via `@/lib/audit`.
- i18n labels via `@/i18n` (optional — you can hardcode English).

## Table of contents
1. Prisma models (schema.prisma)
2. Migrations (SQL, in order)
3. Constants (tags, shipping methods, file MIME types)
4. Admin: list/manage page, server actions, item form
5. Dealer: marketplace page, order form (cart), server actions
6. API routes: item image + downloadable file streaming
7. Packing-slip PDF generator (orderPdf.ts)

> NOTE: paths shown are the originals. The order form is a client component; the
> pages and actions are server-side. Dependencies you'll need to provide in the
> new project are the `@/lib/*` helpers listed under "Stack assumptions" above.


---

## 1. Prisma models

_Source: `prisma/schema.prisma`. Add these models; `Dealer` and `User` are your own existing models — adjust the relations._

```prisma
// Marketplace: items GWA makes available for dealers to order (clothing, gear,
// signage). No prices and no payment — it's an ordering system. A submitted
// order emails whoever handles fulfillment.
// A grouping for marketplace items (e.g. Apparel, Signage, Sample Kits). Admins
// can add/rename/reorder/hide these at any time.
model MarketplaceCategory {
  id        String   @id @default(cuid())
  name      String
  sortOrder Int      @default(0)
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  items MarketplaceItem[]

  @@index([active])
}

model MarketplaceItem {
  id             String   @id @default(cuid())
  name           String
  // Internal part / SKU number for the fulfillment team. Shown in the order
  // email so the filler can pull each item; not shown to dealers.
  partNumber     String?
  description    String?  @db.Text
  options        String[] @default([]) // e.g. sizes: S, M, L, XL — optional
  // Per-option part number, index-aligned with `options` (options[i]'s SKU is
  // optionSkus[i]). Empty entry → fall back to the item's base `partNumber`.
  optionSkus     String[] @default([])
  imageStorageKey String? // product photo (normalized + resized on upload)
  imageMime       String?
  imageSizeBytes  Int?
  active         Boolean  @default(true)
  sortOrder      Int      @default(0)
  // Featured in the "New Arrivals" strip at the top of the marketplace. Curated
  // by admins — an item keeps its normal category too.
  featured       Boolean  @default(false)
  // Merchandising tags shown as coloured badges. Values from a fixed set
  // (MARKETPLACE_TAGS in constants): NEW, SALE, CLEARANCE, POPULAR.
  tags           String[] @default([])
  // "ORDER" = physical item dealers order (qty/options). "DOWNLOAD" = a file
  // dealers download (fileStorageKey below), not ordered.
  kind           String   @default("ORDER")
  fileStorageKey String? // downloadable file (DOWNLOAD items)
  fileName       String?
  fileMime       String?
  fileSizeBytes  Int?
  // Optional grouping. If the category is deleted, items are kept and become
  // uncategorized (the FK is set null) rather than being removed.
  categoryId String?
  category   MarketplaceCategory? @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  createdById String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  orderItems OrderItem[]

  @@index([active])
  @@index([categoryId])
}

model Order {
  id          String   @id @default(cuid())
  dealerId    String
  dealer      Dealer   @relation(fields: [dealerId], references: [id])
  createdById String
  createdBy   User     @relation("OrderCreatedBy", fields: [createdById], references: [id])
  note        String?  @db.Text
  // How the dealer wants it shipped (e.g. Standard ground, Rush/express, Pickup).
  // Shown to the shipper on the order email + packing slip so they know how to send it.
  shippingMethod String?
  status      String   @default("SUBMITTED") // SUBMITTED | FULFILLED | CANCELLED
  createdAt   DateTime @default(now())

  items OrderItem[]

  @@index([createdAt])
}

model OrderItem {
  id       String           @id @default(cuid())
  orderId  String
  order    Order            @relation(fields: [orderId], references: [id], onDelete: Cascade)
  itemId     String?
  item       MarketplaceItem? @relation(fields: [itemId], references: [id])
  itemName   String // snapshot of the item name at order time
  partNumber String? // snapshot of the part/SKU number at order time
  option     String? // chosen option (e.g. size), if any
  quantity   Int
}
```

---

## 2. Migrations (SQL — apply in this order)

### migration: 20260803020000_marketplace_and_dealer_type
```sql
-- CreateEnum
CREATE TYPE "DealerType" AS ENUM ('DISTRIBUTOR', 'DEALER');

-- AlterTable
ALTER TABLE "Dealer" ADD COLUMN     "type" "DealerType" NOT NULL DEFAULT 'DEALER';

-- CreateTable
CREATE TABLE "MarketplaceItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "dealerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemId" TEXT,
    "itemName" TEXT NOT NULL,
    "option" TEXT,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketplaceItem_active_idx" ON "MarketplaceItem"("active");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MarketplaceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

### migration: 20260803030000_marketplace_item_image
```sql
-- AlterTable
ALTER TABLE "MarketplaceItem" ADD COLUMN     "imageStorageKey" TEXT,
ADD COLUMN     "imageMime" TEXT;
```

### migration: 20260803040000_marketplace_image_size
```sql
-- AlterTable
ALTER TABLE "MarketplaceItem" ADD COLUMN     "imageSizeBytes" INTEGER;
```

### migration: 20260803050000_marketplace_categories
```sql
-- CreateTable
CREATE TABLE "MarketplaceCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MarketplaceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketplaceCategory_active_idx" ON "MarketplaceCategory"("active");

-- AlterTable
ALTER TABLE "MarketplaceItem" ADD COLUMN "categoryId" TEXT;

-- CreateIndex
CREATE INDEX "MarketplaceItem_categoryId_idx" ON "MarketplaceItem"("categoryId");

-- AddForeignKey
ALTER TABLE "MarketplaceItem" ADD CONSTRAINT "MarketplaceItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MarketplaceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the starter categories (safe: runs once, on first apply of this migration)
INSERT INTO "MarketplaceCategory" ("id", "name", "sortOrder", "active", "createdAt", "updatedAt") VALUES
    (gen_random_uuid()::text, 'Apparel', 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Signage', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Sample Kits', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Tree Hangers', 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
```

### migration: 20260803060000_marketplace_downloadable
```sql
-- AlterTable: add downloadable-file support to marketplace items
ALTER TABLE "MarketplaceItem"
    ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'ORDER',
    ADD COLUMN "fileStorageKey" TEXT,
    ADD COLUMN "fileName" TEXT,
    ADD COLUMN "fileMime" TEXT,
    ADD COLUMN "fileSizeBytes" INTEGER;
```

### migration: 20260808010000_marketplace_featured_tags
```sql
-- Marketplace: New Arrivals (featured) + merchandising tags (New/Sale/Clearance/Popular).
-- AlterTable
ALTER TABLE "MarketplaceItem" ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MarketplaceItem" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
```

### migration: 20260809020000_marketplace_part_number
```sql
-- Part / SKU number for marketplace items, snapshotted onto each order line so
-- the fulfillment email can show what to pull. Not shown to dealers.
ALTER TABLE "MarketplaceItem" ADD COLUMN "partNumber" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "partNumber" TEXT;
```

### migration: 20260908150000_marketplace_option_skus
```sql
-- Per-option part numbers for marketplace items (index-aligned with "options").
ALTER TABLE "MarketplaceItem" ADD COLUMN IF NOT EXISTS "optionSkus" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
```

---

## 3. Constants (marketplace tags, shipping methods, file MIME types)

_Source: `src/lib/constants.ts` — the marketplace-relevant excerpts._

```ts
// --- Downloadable file MIME types ---
// Files a dealer can download from a marketplace item (e.g. print-ready signage,
// artwork, guides). Broader than application uploads: also allows zipped bundles.
export const MARKETPLACE_FILE_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/zip',
  'application/x-zip-compressed',
];

// --- Merchandising tags (coloured badges) ---
// Marketplace merchandising tags (fixed set, coloured badges)
// ---------------------------------------------------------------------------
export interface MarketplaceTag {
  key: string;
  label: string;
  // Tailwind classes for the coloured badge shown on item cards.
  badgeClass: string;
}

export const MARKETPLACE_TAGS: MarketplaceTag[] = [
  { key: 'NEW', label: 'New', badgeClass: 'bg-green-600 text-white' },
  { key: 'SALE', label: 'Sale', badgeClass: 'bg-red-600 text-white' },
  { key: 'CLEARANCE', label: 'Clearance', badgeClass: 'bg-orange-600 text-white' },
  { key: 'POPULAR', label: 'Popular', badgeClass: 'bg-purple-600 text-white' },
];

export const MARKETPLACE_TAG_KEYS: string[] = MARKETPLACE_TAGS.map((t) => t.key);

export function marketplaceTag(key: string): MarketplaceTag | undefined {
  return MARKETPLACE_TAGS.find((t) => t.key === key);
}


// --- Shipping methods (checkout) ---
// Marketplace order shipping methods
// ---------------------------------------------------------------------------
// The dealer picks one of these at checkout so the shipper knows how to send
// the order. `value` is what we store, email, and print on the packing slip —
// keep it stable/English so the shipper always reads a consistent term; the
// UI label is translated via `labelKey`.
export interface ShippingMethod {
  value: string;
  labelKey: string;
}

export const MARKETPLACE_SHIPPING_METHODS: ShippingMethod[] = [
  { value: 'Standard ground', labelKey: 'marketplace.shipStandard' },
  { value: 'Rush / express', labelKey: 'marketplace.shipRush' },
  { value: 'Courier', labelKey: 'marketplace.shipCourier' },
  { value: 'Pickup in person', labelKey: 'marketplace.shipPickup' },
];

export const MARKETPLACE_SHIPPING_METHOD_VALUES: string[] = MARKETPLACE_SHIPPING_METHODS.map((m) => m.value);
```

---

## FILE: src/app/(admin)/admin/marketplace/page.tsx

```tsx
import { requireAdminSection } from '@/lib/session';
import { prisma } from '@/lib/db';
import { getSetting, MARKETPLACE_SETTING_KEYS } from '@/lib/settings';
import { MARKETPLACE_TAGS } from '@/lib/constants';
import { ItemForm } from './ItemForm';
import { ItemRowActions } from './ItemRowActions';
import { OrderEmailForm } from './OrderEmailForm';
import { CategoryForm } from './CategoryForm';
import { CategoryRowActions } from './CategoryRowActions';

export const dynamic = 'force-dynamic';

export default async function AdminMarketplace() {
  await requireAdminSection('marketplace');

  const [orderEmail, categories, items, orders] = await Promise.all([
    getSetting(MARKETPLACE_SETTING_KEYS.orderEmail),
    prisma.marketplaceCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.marketplaceItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { dealer: { select: { name: true } }, createdBy: { select: { name: true } }, items: true },
    }),
  ]);

  // Options offered in each item's category dropdown.
  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  // Group items for display: each category in sort order, then any uncategorized
  // items last. A category with no items still shows (so it's easy to file into).
  const groups: { key: string; name: string; items: typeof items }[] = categories.map((c) => ({
    key: c.id,
    name: c.active ? c.name : `${c.name} (hidden)`,
    items: items.filter((it) => it.categoryId === c.id),
  }));
  const uncategorized = items.filter((it) => !it.categoryId || !categoryName.has(it.categoryId));
  if (uncategorized.length > 0) groups.push({ key: '__none__', name: 'Uncategorized', items: uncategorized });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-gray-900">Marketplace</h1>

      <section className="card p-6">
        <h2 className="mb-1 text-base font-semibold text-gray-900">Where orders go</h2>
        <p className="mb-3 text-sm text-gray-500">The email that receives each order. Leave blank to email all admins.</p>
        <OrderEmailForm current={orderEmail ?? ''} />
      </section>

      <section className="card p-6">
        <h2 className="mb-1 text-base font-semibold text-gray-900">Categories</h2>
        <p className="mb-3 text-sm text-gray-500">Group items so dealers can find them. Add as many as you like; lower “sort” numbers show first.</p>
        {categories.length > 0 && (
          <div className="mb-4 space-y-2">
            {categories.map((c) => (
              <div key={c.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-100 p-2 ${c.active ? '' : 'bg-gray-50/60'}`}>
                <div className="min-w-[12rem] flex-1">
                  <CategoryForm category={{ id: c.id, name: c.name, sortOrder: c.sortOrder }} />
                </div>
                <div className="flex items-center gap-2">
                  {!c.active && <span className="badge bg-gray-100 text-gray-600">Hidden</span>}
                  <CategoryRowActions id={c.id} active={c.active} />
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="border-t border-gray-100 pt-3">
          <CategoryForm />
        </div>
      </section>

      <section className="card p-6">
        <h2 className="mb-3 text-base font-semibold text-gray-900">Add an item</h2>
        <ItemForm categories={categoryOptions} />
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-900">Items</h2>
        {items.length === 0 ? (
          <div className="card p-8 text-center text-sm text-gray-500">No items yet.</div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group.key}>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                  {group.name} <span className="font-normal normal-case text-gray-400">· {group.items.length}</span>
                </h3>
                {group.items.length === 0 ? (
                  <div className="card p-4 text-center text-xs text-gray-400">No items in this category yet.</div>
                ) : (
                  <div className="space-y-3">
                    {group.items.map((item) => (
                      <div key={item.id} className={`card p-4 ${item.active ? '' : 'bg-gray-50/60'}`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-3">
                            {item.imageStorageKey && (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img src={`/api/marketplace/items/${item.id}/image?v=${item.updatedAt.getTime()}`} alt="" className="h-14 w-14 shrink-0 rounded object-cover ring-1 ring-gray-200" />
                            )}
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-gray-900">{item.name}</span>
                                {item.partNumber && <span className="badge bg-gray-100 font-mono text-gray-600">#{item.partNumber}</span>}
                                {!item.active && <span className="badge bg-gray-100 text-gray-600">Hidden</span>}
                                {item.featured && <span className="badge bg-amber-100 text-amber-800">✨ New Arrivals</span>}
                                {MARKETPLACE_TAGS.filter((t) => item.tags.includes(t.key)).map((t) => (
                                  <span key={t.key} className={`badge ${t.badgeClass}`}>{t.label}</span>
                                ))}
                                {item.kind === 'DOWNLOAD' && <span className="badge bg-emerald-50 text-emerald-700">Download</span>}
                                {item.kind !== 'DOWNLOAD' && item.options.length > 0 && <span className="badge bg-brand-50 text-brand-700">{item.options.join(' · ')}</span>}
                              </div>
                              {item.description && <p className="mt-1 text-sm text-gray-500">{item.description}</p>}
                              {item.kind === 'DOWNLOAD' && item.fileStorageKey && (
                                <a href={`/api/marketplace/items/${item.id}/file`} className="mt-1 inline-block text-xs font-medium text-brand-700 underline">
                                  {item.fileName || 'Download file'}
                                </a>
                              )}
                              {item.kind === 'DOWNLOAD' && !item.fileStorageKey && (
                                <p className="mt-1 text-xs text-amber-600">No file uploaded yet — edit to add one.</p>
                              )}
                            </div>
                          </div>
                          <ItemRowActions id={item.id} active={item.active} />
                        </div>
                        <details className="mt-3 border-t border-gray-100 pt-3">
                          <summary className="cursor-pointer text-sm font-medium text-brand-700">Edit</summary>
                          <div className="mt-3">
                            <ItemForm
                              categories={categoryOptions}
                              item={{
                                id: item.id,
                                name: item.name,
                                partNumber: item.partNumber,
                                description: item.description,
                                options: item.options,
                                optionSkus: item.optionSkus,
                                sortOrder: item.sortOrder,
                                active: item.active,
                                hasImage: !!item.imageStorageKey,
                                imageVersion: item.updatedAt.getTime(),
                                categoryId: item.categoryId,
                                kind: item.kind,
                                hasFile: !!item.fileStorageKey,
                                fileName: item.fileName,
                                featured: item.featured,
                                tags: item.tags,
                              }}
                            />
                          </div>
                        </details>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-900">Recent orders</h2>
        {orders.length === 0 ? (
          <div className="card p-8 text-center text-sm text-gray-500">No orders yet.</div>
        ) : (
          <div className="card divide-y divide-gray-100">
            {orders.map((o) => (
              <div key={o.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-gray-900">{o.dealer.name}</span>
                  <span className="text-xs text-gray-500">{o.createdBy.name} · {o.createdAt.toLocaleString('en-CA')}</span>
                </div>
                {o.shippingMethod && (
                  <p className="mt-1 text-xs font-medium text-brand-700">🚚 {o.shippingMethod}</p>
                )}
                <ul className="mt-2 space-y-0.5 text-sm text-gray-700">
                  {o.items.map((li) => (
                    <li key={li.id}>
                      {li.quantity} × {li.itemName}{li.option ? ` — ${li.option}` : ''}
                      {li.partNumber && <span className="ml-2 font-mono text-xs text-gray-400">#{li.partNumber}</span>}
                    </li>
                  ))}
                </ul>
                {o.note && <p className="mt-2 text-sm text-gray-500"><span className="font-medium">Note:</span> {o.note}</p>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
```

---

## FILE: src/app/(admin)/admin/marketplace/actions.ts

```ts
'use server';

import crypto from 'crypto';
import { revalidatePath } from 'next/cache';
import { requireAdminSection } from '@/lib/session';
import { prisma } from '@/lib/db';
import { toTitleCase, sentenceOrNull } from '@/lib/textcase';
import { MARKETPLACE_TAG_KEYS } from '@/lib/constants';
import { audit } from '@/lib/audit';
import { setSetting, MARKETPLACE_SETTING_KEYS } from '@/lib/settings';
import { putDocument, deleteDocument } from '@/lib/storage';
import { normalizeProductImage } from '@/lib/image';
import { MAX_FILE_BYTES, MARKETPLACE_FILE_MIME_TYPES } from '@/lib/constants';

// Validate + normalize an uploaded photo and store it, returning the new key.
async function storeItemImage(itemId: string, file: File): Promise<{ storageKey: string; mime: string; sizeBytes: number } | { error: string }> {
  if (file.size > MAX_FILE_BYTES) return { error: `Image is too large (max ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)} MB).` };
  if (!file.type.startsWith('image/')) return { error: 'The photo must be an image (JPG, PNG, WEBP, HEIC).' };
  try {
    const { bytes, mime } = await normalizeProductImage(Buffer.from(await file.arrayBuffer()));
    const key = `marketplace/${itemId}/img-${crypto.randomBytes(6).toString('hex')}.webp`;
    await putDocument(key, bytes);
    return { storageKey: key, mime, sizeBytes: bytes.length };
  } catch (err) {
    console.error('[marketplace] image processing failed', err);
    return { error: 'Could not process that image. Try a different file.' };
  }
}

// Keep a filename safe to echo back in a Content-Disposition header later.
function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() || 'download';
  return base.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'download';
}

// Validate + store a downloadable file (PDF / image / zip) for a DOWNLOAD item.
async function storeItemFile(itemId: string, file: File): Promise<{ storageKey: string; fileName: string; mime: string; sizeBytes: number } | { error: string }> {
  if (file.size > MAX_FILE_BYTES) return { error: `File is too large (max ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)} MB).` };
  if (!MARKETPLACE_FILE_MIME_TYPES.includes(file.type)) {
    return { error: 'Unsupported file type. Upload a PDF, image (JPG/PNG/WEBP), or ZIP.' };
  }
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const ext = (file.name.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] || '').toLowerCase();
    const key = `marketplace/${itemId}/file-${crypto.randomBytes(6).toString('hex')}${ext}`;
    await putDocument(key, bytes);
    return { storageKey: key, fileName: safeFileName(file.name), mime: file.type, sizeBytes: bytes.length };
  } catch (err) {
    console.error('[marketplace] file storage failed', err);
    return { error: 'Could not save that file. Try again.' };
  }
}

export interface ItemActionState {
  error?: string;
  ok?: boolean;
}

export interface CategoryActionState {
  error?: string;
  ok?: boolean;
}

/** Create or rename/reorder a marketplace category. */
export async function saveCategoryAction(_prev: CategoryActionState, formData: FormData): Promise<CategoryActionState> {
  await requireAdminSection('marketplace');
  const id = (formData.get('id') ?? '').toString() || null;
  const name = toTitleCase((formData.get('name') ?? '').toString().trim());
  const sortOrder = Number.parseInt((formData.get('sortOrder') ?? '0').toString(), 10) || 0;
  if (!name) return { error: 'Category name is required.' };
  try {
    if (id) {
      await prisma.marketplaceCategory.update({ where: { id }, data: { name, sortOrder } });
    } else {
      await prisma.marketplaceCategory.create({ data: { name, sortOrder } });
    }
  } catch (err) {
    console.error('[marketplace] saveCategoryAction failed', err);
    return { error: 'Could not save this category. Please try again.' };
  }
  revalidatePath('/admin/marketplace');
  revalidatePath('/dealer/marketplace');
  return { ok: true };
}

export async function toggleCategoryActiveAction(id: string) {
  await requireAdminSection('marketplace');
  const c = await prisma.marketplaceCategory.findUnique({ where: { id }, select: { active: true } });
  if (!c) return;
  await prisma.marketplaceCategory.update({ where: { id }, data: { active: !c.active } });
  revalidatePath('/admin/marketplace');
  revalidatePath('/dealer/marketplace');
}

export async function deleteCategoryAction(id: string) {
  await requireAdminSection('marketplace');
  // Items in this category are kept — the FK sets their categoryId to null, so
  // they simply become uncategorized.
  await prisma.marketplaceCategory.delete({ where: { id } }).catch(() => {});
  revalidatePath('/admin/marketplace');
  revalidatePath('/dealer/marketplace');
}

function parseOptions(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30);
}

/**
 * Sizes + their per-size part numbers from the form's hidden `optionsJson`
 * ([{size, sku}]). Returns index-aligned `options` and `optionSkus`. Falls back to
 * the legacy comma-separated `options` field (no per-size SKUs) if JSON is absent.
 */
function parseSizeRows(formData: FormData): { options: string[]; optionSkus: string[] } {
  const json = (formData.get('optionsJson') ?? '').toString().trim();
  if (json) {
    try {
      const rows = JSON.parse(json);
      if (Array.isArray(rows)) {
        const options: string[] = [];
        const optionSkus: string[] = [];
        for (const r of rows.slice(0, 30)) {
          const size = String(r?.size ?? '').trim();
          if (!size) continue;
          options.push(size);
          optionSkus.push(String(r?.sku ?? '').trim());
        }
        return { options, optionSkus };
      }
    } catch {
      /* malformed — fall through to legacy */
    }
  }
  return { options: parseOptions((formData.get('options') ?? '').toString()), optionSkus: [] };
}

/** Create or update a marketplace item. */
export async function saveItemAction(_prev: ItemActionState, formData: FormData): Promise<ItemActionState> {
  const session = await requireAdminSection('marketplace');
  const id = (formData.get('id') ?? '').toString() || null;
  const name = toTitleCase((formData.get('name') ?? '').toString().trim());
  const partNumber = (formData.get('partNumber') ?? '').toString().trim() || null;
  const description = sentenceOrNull((formData.get('description') ?? '').toString());
  const { options, optionSkus } = parseSizeRows(formData);
  const sortOrder = Number.parseInt((formData.get('sortOrder') ?? '0').toString(), 10) || 0;
  const active = formData.get('active') === 'on';
  const featured = formData.get('featured') === 'on';
  // Keep only recognised tag keys, in the canonical order.
  const picked = new Set(formData.getAll('tags').map(String));
  const tags = MARKETPLACE_TAG_KEYS.filter((k) => picked.has(k));
  const categoryId = (formData.get('categoryId') ?? '').toString() || null;
  const kind = (formData.get('kind') ?? 'ORDER').toString() === 'DOWNLOAD' ? 'DOWNLOAD' : 'ORDER';

  if (!name) return { error: 'Item name is required.' };

  const image = formData.get('image') as File | null;
  const hasNewImage = !!image && typeof image !== 'string' && image.size > 0;
  const removeImage = formData.get('removeImage') === 'on';

  const file = formData.get('file') as File | null;
  const hasNewFile = !!file && typeof file !== 'string' && file.size > 0;
  const removeFile = formData.get('removeFile') === 'on';

  // Any failure below (DB, storage, image processing) is returned to the form as
  // a friendly message rather than thrown — an unhandled throw here would tear
  // down the whole page with a generic "client-side exception" error.
  try {
    if (id) {
      const existing = await prisma.marketplaceItem.findUnique({ where: { id }, select: { imageStorageKey: true, fileStorageKey: true } });
      if (!existing) return { error: 'That item no longer exists — reload the page and try again.' };
      await prisma.marketplaceItem.update({ where: { id }, data: { name, partNumber, description, options, optionSkus, sortOrder, active, featured, tags, categoryId, kind } });
      if (hasNewImage) {
        const stored = await storeItemImage(id, image!);
        if ('error' in stored) return { error: stored.error };
        if (existing.imageStorageKey) await deleteDocument(existing.imageStorageKey).catch(() => {});
        await prisma.marketplaceItem.update({ where: { id }, data: { imageStorageKey: stored.storageKey, imageMime: stored.mime, imageSizeBytes: stored.sizeBytes } });
      } else if (removeImage && existing.imageStorageKey) {
        await deleteDocument(existing.imageStorageKey).catch(() => {});
        await prisma.marketplaceItem.update({ where: { id }, data: { imageStorageKey: null, imageMime: null, imageSizeBytes: null } });
      }
      if (hasNewFile) {
        const stored = await storeItemFile(id, file!);
        if ('error' in stored) return { error: stored.error };
        if (existing.fileStorageKey) await deleteDocument(existing.fileStorageKey).catch(() => {});
        await prisma.marketplaceItem.update({ where: { id }, data: { fileStorageKey: stored.storageKey, fileName: stored.fileName, fileMime: stored.mime, fileSizeBytes: stored.sizeBytes } });
      } else if (removeFile && existing.fileStorageKey) {
        await deleteDocument(existing.fileStorageKey).catch(() => {});
        await prisma.marketplaceItem.update({ where: { id }, data: { fileStorageKey: null, fileName: null, fileMime: null, fileSizeBytes: null } });
      }
    } else {
      const created = await prisma.marketplaceItem.create({
        data: { name, partNumber, description, options, optionSkus, sortOrder, active, featured, tags, categoryId, kind, createdById: session.userId },
      });
      if (hasNewImage) {
        const stored = await storeItemImage(created.id, image!);
        if ('error' in stored) return { error: stored.error };
        await prisma.marketplaceItem.update({ where: { id: created.id }, data: { imageStorageKey: stored.storageKey, imageMime: stored.mime, imageSizeBytes: stored.sizeBytes } });
      }
      if (hasNewFile) {
        const stored = await storeItemFile(created.id, file!);
        if ('error' in stored) return { error: stored.error };
        await prisma.marketplaceItem.update({ where: { id: created.id }, data: { fileStorageKey: stored.storageKey, fileName: stored.fileName, fileMime: stored.mime, fileSizeBytes: stored.sizeBytes } });
      }
    }
  } catch (err) {
    console.error('[marketplace] saveItemAction failed', err);
    return { error: 'Could not save this item. Please try again in a moment.' };
  }

  revalidatePath('/admin/marketplace');
  revalidatePath('/dealer/marketplace');
  return { ok: true };
}

export async function toggleItemActiveAction(id: string) {
  await requireAdminSection('marketplace');
  const item = await prisma.marketplaceItem.findUnique({ where: { id }, select: { active: true } });
  if (!item) return;
  await prisma.marketplaceItem.update({ where: { id }, data: { active: !item.active } });
  revalidatePath('/admin/marketplace');
  revalidatePath('/dealer/marketplace');
}

export async function deleteItemAction(id: string) {
  await requireAdminSection('marketplace');
  // Keep past orders intact — only delete when nothing references the item.
  const uses = await prisma.orderItem.count({ where: { itemId: id } });
  if (uses > 0) {
    await prisma.marketplaceItem.update({ where: { id }, data: { active: false } });
  } else {
    await prisma.marketplaceItem.delete({ where: { id } });
  }
  revalidatePath('/admin/marketplace');
  revalidatePath('/dealer/marketplace');
}

/** Save where marketplace order emails should go (blank = all admins). */
export async function saveOrderEmailAction(_prev: { ok?: boolean }, formData: FormData): Promise<{ ok?: boolean }> {
  const session = await requireAdminSection('marketplace');
  await setSetting(MARKETPLACE_SETTING_KEYS.orderEmail, (formData.get('orderEmail') ?? '').toString());
  await audit({ actorId: session.userId, action: 'CONTENT_UPDATE', entityType: 'AppSetting', entityId: MARKETPLACE_SETTING_KEYS.orderEmail });
  revalidatePath('/admin/marketplace');
  return { ok: true };
}
```

---

## FILE: src/app/(admin)/admin/marketplace/ItemForm.tsx

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { saveItemAction, type ItemActionState } from './actions';
import { MARKETPLACE_TAGS } from '@/lib/constants';

interface Item {
  id: string;
  name: string;
  partNumber?: string | null;
  description: string | null;
  options: string[];
  optionSkus?: string[];
  sortOrder: number;
  active: boolean;
  featured?: boolean;
  tags?: string[];
  hasImage?: boolean;
  imageVersion?: number;
  categoryId?: string | null;
  kind?: string;
  hasFile?: boolean;
  fileName?: string | null;
}

interface CategoryOption {
  id: string;
  name: string;
}

const initial: ItemActionState = {};

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Add item'}
    </button>
  );
}

export function ItemForm({ item, categories }: { item?: Item; categories: CategoryOption[] }) {
  const [state, action] = useFormState(saveItemAction, initial);
  const isEdit = !!item;
  const formRef = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<string>(item?.kind === 'DOWNLOAD' ? 'DOWNLOAD' : 'ORDER');
  const isDownload = kind === 'DOWNLOAD';

  // Per-size rows: each size carries its own part number (apparel part numbers
  // change by size). Serialized to a hidden `optionsJson` field on submit.
  const [sizeRows, setSizeRows] = useState<{ size: string; sku: string }[]>(
    (item?.options ?? []).length > 0
      ? item!.options.map((size, i) => ({ size, sku: item!.optionSkus?.[i] ?? '' }))
      : [],
  );
  const setRow = (i: number, patch: Partial<{ size: string; sku: string }>) =>
    setSizeRows((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setSizeRows((rows) => [...rows, { size: '', sku: '' }]);
  const removeRow = (i: number) => setSizeRows((rows) => rows.filter((_, j) => j !== i));
  const optionsJson = JSON.stringify(sizeRows.filter((r) => r.size.trim()));

  // Clear the "Add an item" form (including the file input) after a successful
  // add so it's ready for the next one. Edit forms keep their values.
  useEffect(() => {
    if (state.ok && !isEdit) {
      formRef.current?.reset();
      setKind('ORDER');
    }
  }, [state, isEdit]);

  return (
    <form ref={formRef} action={action} className="space-y-3">
      {item && <input type="hidden" name="id" value={item.id} />}
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Name</label>
          <input name="name" defaultValue={item?.name ?? ''} className="input" />
        </div>
        <div>
          <label className="label">Category</label>
          <select name="categoryId" defaultValue={item?.categoryId ?? ''} className="input">
            <option value="">— Uncategorized —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label">Part number <span className="font-normal text-gray-400">(internal — for items with no sizes, or the fallback when a size has none. Shown on the order email, never to dealers)</span></label>
        <input name="partNumber" defaultValue={item?.partNumber ?? ''} className="input" placeholder="e.g. GWA-TS-GRY" autoComplete="off" />
      </div>
      <div>
        <label className="label">Type</label>
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className="input">
          <option value="ORDER">Orderable item (dealers choose a quantity)</option>
          <option value="DOWNLOAD">Downloadable file (dealers download it)</option>
        </select>
      </div>
      {isDownload ? (
        <div>
          <label className="label">File <span className="font-normal text-gray-400">(PDF, image, or ZIP — max 15&nbsp;MB)</span></label>
          {item?.hasFile && (
            <p className="mb-1 text-xs text-gray-500">
              Current file: <span className="font-medium text-gray-700">{item.fileName || 'attached'}</span>
            </p>
          )}
          <input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.zip,application/pdf,image/*,application/zip" className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100" />
          {item?.hasFile && (
            <label className="mt-2 flex items-center gap-2 text-xs text-gray-500">
              <input type="checkbox" name="removeFile" className="h-3.5 w-3.5" />
              Remove current file
            </label>
          )}
        </div>
      ) : (
        <div>
          <input type="hidden" name="optionsJson" value={optionsJson} />
          <label className="label">Sizes &amp; part numbers <span className="font-normal text-gray-400">(optional — each size can have its own part number)</span></label>
          {sizeRows.length === 0 ? (
            <p className="mb-2 text-xs text-gray-500">No sizes — the item is ordered as one, using the part number above.</p>
          ) : (
            <div className="space-y-2">
              {sizeRows.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={r.size}
                    onChange={(e) => setRow(i, { size: e.target.value })}
                    className="input w-28"
                    placeholder="Size (M)"
                    aria-label={`Size ${i + 1}`}
                  />
                  <input
                    value={r.sku}
                    onChange={(e) => setRow(i, { sku: e.target.value })}
                    className="input flex-1"
                    placeholder="Part number for this size (6012)"
                    autoComplete="off"
                    aria-label={`Part number for size ${i + 1}`}
                  />
                  <button type="button" onClick={() => removeRow(i)} className="flex-none rounded-md border border-gray-200 px-2.5 py-2 text-sm text-gray-500 hover:bg-gray-50" aria-label="Remove size">✕</button>
                </div>
              ))}
            </div>
          )}
          <button type="button" onClick={addRow} className="mt-2 text-sm font-medium text-brand-700 hover:underline">+ Add a size</button>
        </div>
      )}
      <div>
        <label className="label">Description <span className="font-normal text-gray-400">(optional)</span></label>
        <textarea name="description" defaultValue={item?.description ?? ''} rows={2} className="input" />
      </div>
      <div>
        <label className="label">Photo <span className="font-normal text-gray-400">(optional thumbnail — auto-sized on upload)</span></label>
        <div className="flex items-center gap-3">
          {item?.hasImage && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={`/api/marketplace/items/${item.id}/image?v=${item.imageVersion ?? 0}`} alt="" className="h-14 w-14 rounded object-cover ring-1 ring-gray-200" />
          )}
          <input name="image" type="file" accept="image/*" className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100" />
        </div>
        {item?.hasImage && (
          <label className="mt-2 flex items-center gap-2 text-xs text-gray-500">
            <input type="checkbox" name="removeImage" className="h-3.5 w-3.5" />
            Remove current photo
          </label>
        )}
      </div>
      <div className="rounded-md border border-gray-200 p-3">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
          <input type="checkbox" name="featured" defaultChecked={item?.featured ?? false} className="h-4 w-4" />
          ✨ Feature in New Arrivals
        </label>
        <p className="mt-1 text-xs text-gray-500">Shows this item in the scrolling strip at the top of the marketplace. It keeps its normal category too.</p>
        <div className="mt-3">
          <span className="label">Tags <span className="font-normal text-gray-400">(shown as badges)</span></span>
          <div className="mt-1 flex flex-wrap gap-3">
            {MARKETPLACE_TAGS.map((t) => (
              <label key={t.key} className="flex items-center gap-1.5 text-sm text-gray-700">
                <input type="checkbox" name="tags" value={t.key} defaultChecked={item?.tags?.includes(t.key) ?? false} className="h-4 w-4" />
                <span className={`badge ${t.badgeClass}`}>{t.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-28">
          <label className="label">Sort order</label>
          <input name="sortOrder" type="number" defaultValue={item?.sortOrder ?? 0} className="input" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
          <input type="checkbox" name="active" defaultChecked={item ? item.active : true} className="h-4 w-4" />
          Active (visible to dealers)
        </label>
        <div className="ml-auto flex items-center gap-3">
          {state.ok && <span className="text-xs text-green-600">✓ {isEdit ? 'Saved' : 'Added'}</span>}
          <SubmitButton isEdit={isEdit} />
        </div>
      </div>
    </form>
  );
}
```

---

## FILE: src/app/(dealer)/dealer/marketplace/page.tsx

```tsx
import { requireDealerAccess } from '@/lib/session';
import { prisma } from '@/lib/db';
import { MarketplaceOrderForm } from './MarketplaceOrderForm';
import { SectionHero } from '@/components/SectionHero';
import { getT } from '@/i18n/server';
import { Shirt, Presentation, Gift, Package } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function DealerMarketplace({ searchParams }: { searchParams: { ok?: string } }) {
  await requireDealerAccess();
  const t = getT();
  const [categories, rows] = await Promise.all([
    prisma.marketplaceCategory.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
    }),
    prisma.marketplaceItem.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, description: true, options: true, imageStorageKey: true, updatedAt: true, categoryId: true, kind: true, fileStorageKey: true, fileName: true, featured: true, tags: true },
    }),
  ]);
  const items = rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    options: r.options,
    hasImage: !!r.imageStorageKey,
    imageVersion: r.updatedAt.getTime(),
    categoryId: r.categoryId,
    kind: r.kind,
    hasFile: !!r.fileStorageKey,
    fileName: r.fileName,
    featured: r.featured,
    tags: r.tags,
  }));

  return (
    <div className="space-y-5">
      <SectionHero
        title={t('marketplace.heroTitle')}
        subtitle={t('marketplace.heroSubtitle')}
        bgImage="/marketplace-hero.webp"
        tiles={[
          { Icon: Shirt, title: t('marketplace.tileApparel') },
          { Icon: Presentation, title: t('marketplace.tileSignage') },
          { Icon: Gift, title: t('marketplace.tilePromo') },
          { Icon: Package, title: t('marketplace.tileSamples') },
        ]}
      />

      {searchParams.ok && (
        <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          {t('marketplace.orderSubmitted')}
        </div>
      )}

      {items.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-500">{t('marketplace.nothingAvailable')}</div>
      ) : (
        <MarketplaceOrderForm items={items} categories={categories} />
      )}
    </div>
  );
}
```

---

## FILE: src/app/(dealer)/dealer/marketplace/MarketplaceOrderForm.tsx

```tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import {
  ShoppingCart, Search, LifeBuoy, ArrowRight, Truck, BadgeCheck, HelpCircle,
  Shirt, Presentation, Package, Sparkles, LayoutGrid, MoreHorizontal, type LucideIcon,
} from 'lucide-react';
import { createOrderAction, type OrderActionState } from './actions';
import { MARKETPLACE_TAGS, MARKETPLACE_SHIPPING_METHODS } from '@/lib/constants';
import { useT } from '@/i18n/client';
import type { TFunction } from '@/i18n/translator';

interface Item {
  id: string;
  name: string;
  description: string | null;
  options: string[];
  hasImage: boolean;
  imageVersion?: number;
  categoryId: string | null;
  kind: string;
  hasFile: boolean;
  fileName: string | null;
  featured: boolean;
  tags: string[];
}

interface Category {
  id: string;
  name: string;
}

// A single line in the cart: an item, a chosen option (size), and a quantity.
// Multiple sizes of the same item are separate lines (e.g. 3×S and 3×L).
interface CartLine {
  itemId: string;
  itemName: string;
  option: string | null;
  qty: number;
}

const initial: OrderActionState = {};
const NEW_ARRIVALS = '__new__';
const ALL = '__all__';
const OTHER = '__other__';

const lineKey = (itemId: string, option: string | null) => `${itemId}::${option ?? ''}`;

/** Best-effort icon for a marketplace category, by name. */
function categoryIcon(label: string): LucideIcon {
  const l = label.toLowerCase();
  if (l.includes('apparel') || l.includes('cloth') || l.includes('wear')) return Shirt;
  if (l.includes('sign')) return Presentation;
  if (l.includes('sample') || l.includes('kit')) return Package;
  if (l.includes('new')) return Sparkles;
  if (l.includes('other')) return MoreHorizontal;
  return LayoutGrid;
}

function TagBadges({ tags }: { tags: string[] }) {
  const shown = MARKETPLACE_TAGS.filter((t) => tags.includes(t.key));
  if (shown.length === 0) return null;
  return (
    <div className="pointer-events-none absolute left-2 top-2 flex flex-col items-start gap-1">
      {shown.map((t) => (
        <span key={t.key} className={`badge ${t.badgeClass} shadow-sm`}>{t.label}</span>
      ))}
    </div>
  );
}

// Full-size image shown over the marketplace; closes on ✕, backdrop click, or Esc.
function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <div className="relative max-h-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('marketplace.close')}
          className="absolute -right-3 -top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white text-lg text-gray-700 shadow-lg ring-1 ring-gray-200 hover:bg-gray-100"
        >
          ✕
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="max-h-[85vh] w-auto rounded-lg bg-white object-contain shadow-2xl" />
      </div>
    </div>
  );
}

function ItemImage({ item, onImageClick, className }: { item: Item; onImageClick: (src: string, alt: string) => void; className?: string }) {
  const t = useT();
  const imgSrc = `/api/marketplace/items/${item.id}/image?v=${item.imageVersion ?? 0}`;
  return item.hasImage ? (
    <button
      type="button"
      onClick={() => onImageClick(`${imgSrc}&size=full`, item.name)}
      className={`photo-mat relative block h-56 w-full cursor-zoom-in border-b border-gray-200 ${className ?? ''}`}
      aria-label={t('marketplace.viewLarger', { name: item.name })}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imgSrc} alt={item.name} loading="lazy" className="h-full w-full object-contain p-3" />
      <TagBadges tags={item.tags} />
    </button>
  ) : (
    <div className={`photo-mat relative flex h-56 w-full items-center justify-center border-b border-gray-200 text-4xl text-gray-300 ${className ?? ''}`} aria-hidden>
      👕
      <TagBadges tags={item.tags} />
    </div>
  );
}

// Order controls for one product: pick a size/option and quantity, then Add to
// cart. Adding the same item in a different size creates a separate cart line.
function OrderControls({ item, onAdd }: { item: Item; onAdd: (item: Item, option: string | null, qty: number) => void }) {
  const t = useT();
  const [option, setOption] = useState(item.options[0] ?? '');
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  function add() {
    const q = Math.max(1, qty);
    onAdd(item, item.options.length > 0 ? option : null, q);
    setQty(1);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1300);
  }

  return (
    <div className="mt-auto space-y-2 pt-4">
      <div className="flex items-end gap-2">
        {item.options.length > 0 && (
          <div className="flex-1">
            <label className="label" htmlFor={`opt_${item.id}`}>{t('marketplace.sizeOption')}</label>
            <select id={`opt_${item.id}`} value={option} onChange={(e) => setOption(e.target.value)} className="input">
              {item.options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
        )}
        <div className="w-20">
          <label className="label" htmlFor={`qty_${item.id}`}>{t('marketplace.qty')}</label>
          <input
            id={`qty_${item.id}`}
            type="number"
            min="1"
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number.parseInt(e.target.value || '1', 10) || 1))}
            className="input"
          />
        </div>
      </div>
      <button
        type="button"
        onClick={add}
        className={`flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
          added ? 'bg-green-600 text-white' : 'bg-brand-600 text-white hover:bg-brand-700'
        }`}
      >
        {added ? t('marketplace.addedToCart') : <><ShoppingCart size={15} /> {t('marketplace.addToCart')}</>}
      </button>
    </div>
  );
}

function ItemCard({
  item,
  onImageClick,
  onAdd,
}: {
  item: Item;
  onImageClick: (src: string, alt: string) => void;
  onAdd: (item: Item, option: string | null, qty: number) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:shadow-md">
      <ItemImage item={item} onImageClick={onImageClick} />
      <div className="flex flex-1 flex-col p-4">
        <div className="font-semibold text-gray-900">{item.name}</div>
        {item.description && <p className="mt-1 text-sm text-gray-500">{item.description}</p>}
        {item.kind === 'DOWNLOAD' ? (
          <div className="mt-auto pt-4">
            {item.hasFile ? (
              <a
                href={`/api/marketplace/items/${item.id}/file`}
                className="btn-primary inline-flex w-full items-center justify-center gap-2"
              >
                ⬇ {item.fileName ? t('marketplace.download') : t('marketplace.downloadFile')}
              </a>
            ) : (
              <p className="text-sm text-gray-400">{t('marketplace.comingSoon')}</p>
            )}
          </div>
        ) : (
          <OrderControls item={item} onAdd={onAdd} />
        )}
      </div>
    </div>
  );
}

function NewArrivalsRail({ items, onImageClick }: { items: Item[]; onImageClick: (src: string, alt: string) => void }) {
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);
  const paused = useRef(false);

  function nudge(dir: 1 | -1) {
    const el = scroller.current;
    if (!el) return;
    const step = Math.max(200, Math.round(el.clientWidth * 0.8));
    if (dir === 1 && el.scrollLeft + el.clientWidth >= el.scrollWidth - 8) {
      el.scrollTo({ left: 0, behavior: 'smooth' });
    } else {
      el.scrollBy({ left: dir * step, behavior: 'smooth' });
    }
  }

  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || items.length <= 1) return;
    const id = window.setInterval(() => {
      if (!paused.current) nudge(1);
    }, 3800);
    return () => window.clearInterval(id);
  }, [items.length]);

  return (
    <section className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900"><Sparkles size={18} className="text-blue-600" /> {t('marketplace.newArrivals')}</h2>
          <p className="text-xs text-gray-500">{t('marketplace.newArrivalsSub')}</p>
        </div>
        <div className="hidden gap-2 sm:flex">
          <button type="button" onClick={() => nudge(-1)} aria-label={t('marketplace.prev')} className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:bg-gray-50">‹</button>
          <button type="button" onClick={() => nudge(1)} aria-label={t('marketplace.next')} className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:bg-gray-50">›</button>
        </div>
      </div>
      <div
        ref={scroller}
        onMouseEnter={() => { paused.current = true; }}
        onMouseLeave={() => { paused.current = false; }}
        onTouchStart={() => { paused.current = true; }}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]"
      >
        {items.map((item) => (
          <article key={item.id} className="group flex w-64 flex-none snap-start flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <ItemImage item={item} onImageClick={onImageClick} />
            <div className="p-4">
              <div className="font-semibold leading-snug text-gray-900">{item.name}</div>
              {item.description && <p className="mt-1 line-clamp-2 text-sm text-gray-500">{item.description}</p>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// Big category cards (mockup style): icon, name, item count.
function CategoryCards({
  chips,
  active,
  onSelect,
}: {
  chips: { key: string; label: string; count: number }[];
  active: string;
  onSelect: (key: string) => void;
}) {
  const t = useT();
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {chips.map((c) => {
        const on = c.key === active;
        const Icon = c.key === ALL ? LayoutGrid : c.key === NEW_ARRIVALS ? Sparkles : c.key === OTHER ? MoreHorizontal : categoryIcon(c.label);
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onSelect(c.key)}
            aria-pressed={on}
            className={`flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition ${
              on ? 'border-blue-500 bg-blue-50 shadow-sm ring-1 ring-blue-200' : 'border-gray-200 bg-white hover:bg-gray-50'
            }`}
          >
            <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-lg ${on ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-600'}`}>
              <Icon size={18} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-[#0d2a63] dark:text-slate-100">{c.label.replace(/^✨\s*/, '')}</span>
              <span className="block text-xs text-gray-500">{c.count === 1 ? t('marketplace.itemCountOne') : t('marketplace.itemsCount', { n: c.count })}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ItemGrid({
  items,
  onImageClick,
  onAdd,
}: {
  items: Item[];
  onImageClick: (src: string, alt: string) => void;
  onAdd: (item: Item, option: string | null, qty: number) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <ItemCard key={item.id} item={item} onImageClick={onImageClick} onAdd={onAdd} />
      ))}
    </div>
  );
}

// Shared cart body: the line list + note + submit form. Used by both the
// desktop rail and the mobile drawer, so they stay in sync.
function CartContents({
  lines,
  onQty,
  onRemove,
  action,
  error,
  listClass,
}: {
  lines: CartLine[];
  onQty: (key: string, qty: number) => void;
  onRemove: (key: string) => void;
  action: (formData: FormData) => void;
  error?: string;
  listClass?: string;
}) {
  const t = useT();
  const cartJson = JSON.stringify(lines.map((l) => ({ itemId: l.itemId, option: l.option, quantity: l.qty })));
  return (
    <>
      <div className={`min-h-0 overflow-y-auto ${listClass ?? ''}`}>
        {lines.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-gray-500">
            {t('marketplace.cartEmpty')}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {lines.map((l) => (
              <li key={lineKey(l.itemId, l.option)} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-gray-900">{l.itemName}</div>
                  {l.option && <div className="text-xs text-gray-500">{l.option}</div>}
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => onQty(lineKey(l.itemId, l.option), l.qty - 1)} aria-label="Decrease" className="h-7 w-7 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">−</button>
                  <input
                    type="number"
                    min="1"
                    value={l.qty}
                    onChange={(e) => onQty(lineKey(l.itemId, l.option), Math.max(1, Number.parseInt(e.target.value || '1', 10) || 1))}
                    className="w-12 rounded-md border border-gray-200 py-1 text-center text-sm tabular-nums"
                    aria-label={`Quantity of ${l.itemName}${l.option ? ` ${l.option}` : ''}`}
                  />
                  <button type="button" onClick={() => onQty(lineKey(l.itemId, l.option), l.qty + 1)} aria-label="Increase" className="h-7 w-7 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">+</button>
                </div>
                <button type="button" onClick={() => onRemove(lineKey(l.itemId, l.option))} aria-label={`Remove ${l.itemName}`} className="ml-1 text-gray-400 hover:text-red-600">✕</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form action={action} className="mt-3 border-t border-gray-200 pt-3">
        <input type="hidden" name="cart" value={cartJson} />
        {error && <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-800" role="alert">{error}</div>}
        <label className="label" htmlFor="shippingMethod">{t('marketplace.shippingMethod')}</label>
        <select id="shippingMethod" name="shippingMethod" defaultValue={MARKETPLACE_SHIPPING_METHODS[0]?.value} className="input mb-3">
          {MARKETPLACE_SHIPPING_METHODS.map((m) => (
            <option key={m.value} value={m.value}>{t(m.labelKey)}</option>
          ))}
        </select>
        <label className="label" htmlFor="note">{t('marketplace.noteLabel')} <span className="font-normal text-gray-400">{t('marketplace.optional')}</span></label>
        <textarea id="note" name="note" rows={2} className="input mb-3" placeholder={t('marketplace.notePlaceholder')} />
        <SubmitButton disabled={lines.length === 0} t={t} />
        <p className="mt-2 text-center text-[11px] text-gray-400">{t('marketplace.noPaymentNote')}</p>
      </form>
    </>
  );
}

function SubmitButton({ disabled, t }: { disabled: boolean; t: TFunction }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary flex w-full items-center justify-center gap-2" disabled={pending || disabled}>
      {pending ? t('marketplace.submitting') : <>{t('marketplace.submitOrder')} <ArrowRight size={16} /></>}
    </button>
  );
}

/** Support card in the rail — opens the corner chat (ChatWidget listens). */
function SupportRailCard() {
  const t = useT();
  return (
    <div className="relative overflow-hidden rounded-2xl bg-[#0e2b5c] p-5 text-white shadow-sm">
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-[56%] bg-cover bg-no-repeat"
        style={{
          backgroundImage: "url('/support-agent.webp')",
          backgroundPosition: '62% 16%',
          maskImage: 'linear-gradient(to right, transparent 0%, #000 46%)',
          WebkitMaskImage: 'linear-gradient(to right, transparent 0%, #000 46%)',
        }}
        aria-hidden
      />
      <LifeBuoy className="pointer-events-none absolute -right-3 bottom-2 text-white/5" size={120} aria-hidden />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#0e2b5c] via-[#0e2b5c]/70 to-transparent" aria-hidden />
      <div className="relative z-10 max-w-[62%]">
        <div className="text-lg font-bold">{t('marketplace.needHelpTitle')}</div>
        <p className="mt-1 text-sm text-blue-100">{t('marketplace.needHelpBody')}</p>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('gwa:open-chat', { detail: { support: true } }))}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#ffffff] px-3.5 py-1.5 text-[13px] font-semibold text-[#0e2b5c] transition hover:bg-blue-50"
        >
          {t('marketplace.contactSupport')} <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

const INFO_TILES: { Icon: LucideIcon; titleKey: string; bodyKey: string }[] = [
  { Icon: Truck, titleKey: 'marketplace.infoFastTitle', bodyKey: 'marketplace.infoFastBody' },
  { Icon: BadgeCheck, titleKey: 'marketplace.infoExclusiveTitle', bodyKey: 'marketplace.infoExclusiveBody' },
  { Icon: HelpCircle, titleKey: 'marketplace.infoQuestionsTitle', bodyKey: 'marketplace.infoQuestionsBody' },
];

function InfoTiles() {
  const t = useT();
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <ul className="space-y-3">
        {INFO_TILES.map((tile) => (
          <li key={tile.titleKey} className="flex items-start gap-3">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-blue-50 text-blue-600"><tile.Icon size={18} /></span>
            <div className="leading-tight">
              <div className="text-sm font-bold text-[#0d2a63] dark:text-slate-100">{t(tile.titleKey)}</div>
              <div className="text-xs text-gray-500">{t(tile.bodyKey)}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Slide-over cart for mobile (the desktop rail shows the cart inline).
function CartDrawer({
  open, onClose, lines, onQty, onRemove, action, error,
}: {
  open: boolean;
  onClose: () => void;
  lines: CartLine[];
  onQty: (key: string, qty: number) => void;
  onRemove: (key: string) => void;
  action: (formData: FormData) => void;
  error?: string;
}) {
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  const totalUnits = lines.reduce((s, l) => s + l.qty, 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose} role="dialog" aria-modal="true" aria-label={t('marketplace.yourOrder')}>
      <aside className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">{t('marketplace.yourOrder')} {lines.length > 0 && <span className="text-gray-400">· {totalUnits === 1 ? t('marketplace.itemCountOne') : t('marketplace.itemsCount', { n: totalUnits })}</span>}</h2>
          <button type="button" onClick={onClose} aria-label={t('marketplace.close')} className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100">✕</button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
          <CartContents lines={lines} onQty={onQty} onRemove={onRemove} action={action} error={error} listClass="flex-1" />
        </div>
      </aside>
    </div>
  );
}

export function MarketplaceOrderForm({ items, categories }: { items: Item[]; categories: Category[] }) {
  const t = useT();
  const [state, action] = useFormState(createOrderAction, initial);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [active, setActive] = useState<string>(ALL);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'featured' | 'name'>('featured');

  // On a successful submit the action returns { ok: true } — clear + confirm.
  useEffect(() => {
    if (state?.ok) {
      setCart([]);
      setCartOpen(false);
      setSubmitted(true);
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [state]);

  const openImage = (src: string, alt: string) => setLightbox({ src, alt });

  // Add to cart — same item + option increments that line; a different size is a
  // new line, so 3×S and 3×L of one shirt sit side by side.
  function addToCart(item: Item, option: string | null, qty: number) {
    setSubmitted(false);
    setCart((prev) => {
      const key = lineKey(item.id, option);
      const existing = prev.find((l) => lineKey(l.itemId, l.option) === key);
      if (existing) {
        return prev.map((l) => (lineKey(l.itemId, l.option) === key ? { ...l, qty: Math.min(9999, l.qty + qty) } : l));
      }
      return [...prev, { itemId: item.id, itemName: item.name, option, qty: Math.min(9999, qty) }];
    });
  }
  function setQty(key: string, qty: number) {
    if (qty < 1) { setCart((prev) => prev.filter((l) => lineKey(l.itemId, l.option) !== key)); return; }
    setCart((prev) => prev.map((l) => (lineKey(l.itemId, l.option) === key ? { ...l, qty: Math.min(9999, qty) } : l)));
  }
  function remove(key: string) {
    setCart((prev) => prev.filter((l) => lineKey(l.itemId, l.option) !== key));
  }

  const totalUnits = cart.reduce((s, l) => s + l.qty, 0);

  const activeIds = new Set(categories.map((c) => c.id));
  const featured = items.filter((it) => it.featured);
  const sections = categories
    .map((c) => ({ key: c.id, name: c.name, items: items.filter((it) => it.categoryId === c.id) }))
    .filter((s) => s.items.length > 0);
  const other = items.filter((it) => !it.categoryId || !activeIds.has(it.categoryId));

  const chips = [
    { key: ALL, label: t('marketplace.catAll'), count: items.length },
    ...(featured.length > 0 ? [{ key: NEW_ARRIVALS, label: t('marketplace.catNewArrivals'), count: featured.length }] : []),
    ...sections.map((s) => ({ key: s.key, label: s.name, count: s.items.length })),
    ...(other.length > 0 ? [{ key: OTHER, label: t('marketplace.catOther'), count: other.length }] : []),
  ];

  // Which items are visible given the active category, search and sort.
  const visibleItems = useMemo(() => {
    let list: Item[];
    if (active === ALL) list = items;
    else if (active === NEW_ARRIVALS) list = featured;
    else if (active === OTHER) list = other;
    else list = items.filter((it) => it.categoryId === active);

    const q = query.trim().toLowerCase();
    if (q) list = list.filter((it) => it.name.toLowerCase().includes(q) || (it.description ?? '').toLowerCase().includes(q));

    const sorted = [...list];
    if (sortBy === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else sorted.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
    return sorted;
  }, [items, featured, other, active, query, sortBy]);

  const activeLabel = chips.find((c) => c.key === active)?.label.replace(/^✨\s*/, '') ?? t('marketplace.catAll');

  return (
    <>
      {submitted && (
        <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          {t('marketplace.orderSubmitted')}
        </div>
      )}

      <CategoryCards chips={chips} active={active} onSelect={setActive} />

      {/* Search + sort */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
          <Search size={17} className="text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('marketplace.searchProducts')}
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="mp-sort" className="text-xs font-semibold text-gray-500">{t('marketplace.sortBy')}</label>
          <select
            id="mp-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'featured' | 'name')}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm outline-none"
          >
            <option value="featured">{t('marketplace.sortFeatured')}</option>
            <option value="name">{t('marketplace.sortName')}</option>
          </select>
        </div>
      </div>

      {/* Products + rail */}
      <div className="grid grid-cols-1 gap-5 pb-24 xl:grid-cols-[1fr_320px] xl:pb-5">
        <div className="min-w-0 space-y-4">
          {featured.length > 0 && !query.trim() && (active === ALL || active === NEW_ARRIVALS) && (
            <NewArrivalsRail items={featured} onImageClick={openImage} />
          )}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{query.trim() ? t('marketplace.searchResults') : activeLabel}</h2>
            <span className="text-xs text-gray-400">{visibleItems.length === 1 ? t('marketplace.itemCountOne') : t('marketplace.itemsCount', { n: visibleItems.length })}</span>
          </div>
          {visibleItems.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
              {query.trim() ? t('marketplace.noProductsQuery', { q: query.trim() }) : t('marketplace.noProductsCategory')}
            </div>
          ) : (
            <ItemGrid items={visibleItems} onImageClick={openImage} onAdd={addToCart} />
          )}
        </div>

        {/* Desktop rail */}
        <aside className="hidden xl:block">
          <div className="sticky top-4 space-y-4">
            <section className="flex max-h-[70vh] flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-base font-bold text-[#0d2a63] dark:text-slate-100">
                  <ShoppingCart size={18} className="text-blue-600" /> {t('marketplace.yourCart')}
                  {totalUnits > 0 && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">{totalUnits}</span>}
                </h3>
                {cart.length > 0 && (
                  <button type="button" onClick={() => setCart([])} className="text-xs font-semibold text-gray-400 hover:text-red-600">{t('marketplace.clearAll')}</button>
                )}
              </div>
              <CartContents lines={cart} onQty={setQty} onRemove={remove} action={action} error={state.error} listClass="max-h-[38vh]" />
            </section>
            <SupportRailCard />
            <InfoTiles />
          </div>
        </aside>
      </div>

      {/* Floating cart button (mobile only — desktop uses the rail) */}
      <button
        type="button"
        onClick={() => setCartOpen(true)}
        className="fixed bottom-24 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-brand-700 xl:hidden"
      >
        <ShoppingCart size={16} /> {t('marketplace.cart')}
        {totalUnits > 0 && (
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-white px-1.5 text-xs font-bold text-brand-700 tabular-nums">{totalUnits}</span>
        )}
      </button>

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        lines={cart}
        onQty={setQty}
        onRemove={remove}
        action={action}
        error={state.error}
      />

      {lightbox && <Lightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />}
    </>
  );
}
```

---

## FILE: src/app/(dealer)/dealer/marketplace/actions.ts

```ts
'use server';

import { requireDealerAccess } from '@/lib/session';
import { prisma } from '@/lib/db';
import { sendEmail, type EmailAttachment } from '@/lib/email';
import { renderEmail } from '@/lib/email-templates';
import { getDocument } from '@/lib/storage';
import { getSetting, MARKETPLACE_SETTING_KEYS } from '@/lib/settings';
import { audit } from '@/lib/audit';
import { MARKETPLACE_SHIPPING_METHOD_VALUES } from '@/lib/constants';
import { buildOrderPdf } from '@/lib/orderPdf';

export interface OrderActionState {
  error?: string;
  ok?: boolean;
}

function appUrl(): string {
  return (process.env.APP_URL || '').replace(/\/$/, '');
}

/** A dealer submits a marketplace order. No prices/payment — it emails whoever
 *  handles fulfillment. */
export async function createOrderAction(_prev: OrderActionState, formData: FormData): Promise<OrderActionState> {
  const session = await requireDealerAccess();
  if (!session.dealerId) return { error: 'Your account is not linked to a dealer.' };

  // Only orderable items — DOWNLOAD items are files, never part of an order.
  const items = await prisma.marketplaceItem.findMany({ where: { active: true, kind: 'ORDER' } });
  const note = (formData.get('note') ?? '').toString().trim() || null;

  // Shipping method the dealer chose (so the shipper knows how to send it). Only
  // accept a value from the known list; otherwise leave it unset.
  const rawMethod = (formData.get('shippingMethod') ?? '').toString().trim();
  const shippingMethod = MARKETPLACE_SHIPPING_METHOD_VALUES.includes(rawMethod) ? rawMethod : null;

  // The cart arrives as a JSON array of { itemId, option, quantity } lines — one
  // per size, so the same item can appear more than once (e.g. 3×S and 3×L).
  const byId = new Map(items.map((i) => [i.id, i]));
  let cart: unknown = [];
  try {
    cart = JSON.parse((formData.get('cart') ?? '[]').toString());
  } catch {
    cart = [];
  }

  const lines: { itemId: string; itemName: string; partNumber: string | null; option: string | null; quantity: number }[] = [];
  if (Array.isArray(cart)) {
    for (const raw of cart.slice(0, 500)) {
      const c = raw as { itemId?: unknown; option?: unknown; quantity?: unknown };
      const item = typeof c.itemId === 'string' ? byId.get(c.itemId) : undefined;
      if (!item) continue;
      const qty = Number.parseInt(String(c.quantity ?? ''), 10);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      // Only accept an option the item actually offers; otherwise fall back.
      const option =
        item.options.length > 0
          ? typeof c.option === 'string' && item.options.includes(c.option)
            ? c.option
            : item.options[0]
          : null;
      // Part number for the chosen size (falls back to the item's base part number).
      const idx = option ? item.options.indexOf(option) : -1;
      const partNumber = (idx >= 0 ? (item.optionSkus?.[idx] || '').trim() : '') || item.partNumber;
      lines.push({ itemId: item.id, itemName: item.name, partNumber, option, quantity: Math.min(qty, 9999) });
    }
  }

  if (lines.length === 0) return { error: 'Add at least one item to your cart before submitting.' };

  const order = await prisma.order.create({
    data: {
      dealerId: session.dealerId,
      createdById: session.userId,
      note,
      shippingMethod,
      items: { create: lines.map((l) => ({ itemId: l.itemId, itemName: l.itemName, partNumber: l.partNumber, option: l.option, quantity: l.quantity })) },
    },
    include: {
      dealer: {
        select: {
          name: true,
          profile: {
            select: { businessName: true, address: true, shippingAddress: true, phone: true, altPhone: true },
          },
        },
      },
      createdBy: { select: { name: true } },
    },
  });

  // Dealer ship-to details for the shipper (prefer the profile's shipping
  // address, then the general address). Business name overrides the dealer name
  // when set.
  const profile = order.dealer.profile;
  const shipToName = (profile?.businessName || order.dealer.name).trim();
  const shipToAddress = (profile?.shippingAddress || profile?.address || '').trim() || null;
  const dealerPhone = (profile?.phone || '').trim() || null;
  const dealerAltPhone = (profile?.altPhone || '').trim() || null;

  await audit({ actorId: session.userId, action: 'ORDER_SUBMIT', entityType: 'Order', entityId: order.id, detail: `${lines.length} item(s)` });

  // Email whoever handles fulfillment: the configured address, or all admins.
  try {
    const configured = await getSetting(MARKETPLACE_SETTING_KEYS.orderEmail);
    let recipients: string[] = [];
    if (configured) {
      recipients = [configured];
    } else {
      const admins = await prisma.user.findMany({ where: { role: 'ADMIN', active: true }, select: { email: true, notificationEmail: true } });
      recipients = admins.map((a) => a.notificationEmail || a.email);
    }

    // Attach each ordered item's photo inline, so the email shows a small
    // thumbnail beside every line. Load each item's image once (deduped), and
    // skip any that fail so a missing image never blocks the email.
    const attachments: EmailAttachment[] = [];
    const cidByItem = new Map<string, string>();
    const seen = new Set<string>();
    for (const l of lines) {
      if (seen.has(l.itemId)) continue;
      seen.add(l.itemId);
      const item = byId.get(l.itemId);
      if (!item?.imageStorageKey) continue;
      try {
        const bytes = await getDocument(item.imageStorageKey);
        const cid = `item-${l.itemId}@gwa`;
        const ext = (item.imageMime?.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        attachments.push({
          filename: `${l.itemName}.${ext}`.replace(/[^\w.\- ]/g, '_'),
          content: bytes,
          contentType: item.imageMime || 'image/jpeg',
          cid,
        });
        cidByItem.set(l.itemId, cid);
      } catch (e) {
        console.error('[marketplace] order image attach failed', l.itemId, e);
      }
    }

    // Attach a print-ready packing slip PDF so the shipper can print & pack
    // straight from the email. A PDF failure must never block the email.
    try {
      const pdfBytes = await buildOrderPdf({
        orderId: order.id,
        createdAt: order.createdAt,
        dealerName: shipToName,
        shipTo: shipToAddress,
        phone: dealerPhone,
        altPhone: dealerAltPhone,
        submittedBy: order.createdBy.name,
        shippingMethod: order.shippingMethod,
        note,
        lines: lines.map((l) => ({ quantity: l.quantity, itemName: l.itemName, option: l.option, partNumber: l.partNumber })),
      });
      const slug = shipToName.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'order';
      attachments.push({
        filename: `packing-slip-${slug}-${order.id.slice(-6)}.pdf`,
        content: pdfBytes,
        contentType: 'application/pdf',
      });
    } catch (e) {
      console.error('[marketplace] order PDF build failed', e);
    }

    // Ship-to + shipping-method block for the shipper (escaped — dealer-entered).
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
    const addrLines = (shipToAddress ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
    const phones = [dealerPhone, dealerAltPhone].filter(Boolean) as string[];
    const shipToHtml =
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;border-collapse:collapse;width:100%;">` +
      `<tr><td style="padding:12px 14px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;">` +
      `<div style="font-size:11px;font-weight:700;letter-spacing:.04em;color:#6b7280;text-transform:uppercase;margin-bottom:6px;">Ship to</div>` +
      `<div style="font-size:15px;font-weight:700;color:#111827;">${esc(shipToName)}</div>` +
      (addrLines.length
        ? `<div style="font-size:13px;color:#374151;line-height:1.5;margin-top:2px;">${addrLines.map(esc).join('<br>')}</div>`
        : `<div style="font-size:13px;color:#b45309;margin-top:2px;">No address on file — confirm with the dealer.</div>`) +
      (phones.length ? `<div style="font-size:13px;color:#374151;margin-top:4px;"><strong>Phone:</strong> ${phones.map(esc).join(' / ')}</div>` : '') +
      `<div style="font-size:13px;color:#374151;margin-top:8px;"><strong>Shipping method:</strong> ${esc(order.shippingMethod || 'Not specified')}</div>` +
      `</td></tr></table>`;

    const rowsHtml = lines
      .map((l) => {
        const cid = cidByItem.get(l.itemId);
        const thumb = cid
          ? `<td style="width:60px;padding:6px 12px 6px 0;vertical-align:middle;"><img src="cid:${cid}" width="48" height="48" alt="" style="width:48px;height:48px;object-fit:contain;border:1px solid #e5e7eb;border-radius:8px;background:#fff;"></td>`
          : '<td style="width:0;padding:0;"></td>';
        const part = l.partNumber
          ? `<span style="margin-left:8px;font-family:monospace;font-size:12px;color:#6b7280;">#${l.partNumber}</span>`
          : '';
        return `<tr>${thumb}<td style="padding:6px 0;font-size:14px;color:#374151;vertical-align:middle;"><strong>${l.quantity} ×</strong> ${l.itemName}${l.option ? ` — ${l.option}` : ''}${part}</td></tr>`;
      })
      .join('');
    const listHtml = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;border-collapse:collapse;">${rowsHtml}</table>`;

    for (const to of recipients) {
      await sendEmail({
        to,
        subject: `New marketplace order — ${order.dealer.name}`,
        html: renderEmail({
          heading: 'New marketplace order',
          intro: `${order.dealer.name} (submitted by ${order.createdBy.name}) ordered:`,
          bodyHtml:
            shipToHtml +
            listHtml +
            (note ? `<p style="margin:0 0 14px;font-size:14px;color:#374151;"><strong>Note:</strong> ${note}</p>` : '') +
            `<p style="margin:0 0 14px;font-size:13px;color:#6b7280;">📎 A print-ready packing slip is attached as a PDF.</p>`,
          ctaLabel: 'View orders',
          ctaUrl: `${appUrl()}/admin/marketplace`,
        }),
        attachments,
      });
    }
  } catch (e) {
    console.error('[marketplace] order email failed', e);
  }

  // Return success rather than redirect(): a redirect() thrown from inside a
  // useFormState action surfaces as an error to the dealer on Next 14 (the order
  // still saves). The client clears the cart and shows the confirmation.
  return { ok: true };
}
```

---

## FILE: src/app/api/marketplace/items/[id]/file/route.ts

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { getDocument } from '@/lib/storage';
import { audit } from '@/lib/audit';

// Downloadable file attached to a marketplace item (e.g. print-ready signage).
// Auth-gated: any portal user may download an active item's file; staff may
// download regardless of active state (for previewing hidden items).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return new NextResponse('Unauthorized', { status: 401 });

  const item = await prisma.marketplaceItem.findUnique({
    where: { id: params.id },
    select: { active: true, fileStorageKey: true, fileMime: true, fileName: true },
  });
  if (!item?.fileStorageKey) return new NextResponse('Not found', { status: 404 });

  const isStaff = session.role === 'REVIEWER' || session.role === 'ADMIN';
  if (!item.active && !isStaff) return new NextResponse('Not found', { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await getDocument(item.fileStorageKey);
  } catch (err) {
    console.error('[marketplace] file retrieval failed', err);
    return new NextResponse('Unavailable', { status: 500 });
  }

  await audit({
    actorId: session.userId,
    action: 'MARKETPLACE_FILE_DOWNLOAD',
    entityType: 'MarketplaceItem',
    entityId: params.id,
  });

  const fileName = item.fileName || 'download';
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': item.fileMime || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
```

---

## FILE: src/app/api/marketplace/items/[id]/image/route.ts

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { getDocument } from '@/lib/storage';
import { resizedImageResponse } from '@/lib/imageResponse';

// Product image for a marketplace item. Auth-gated (portal users only). Resized
// and cached via the shared image helper; `?size=full` for a larger view.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return new NextResponse('Unauthorized', { status: 401 });

  const item = await prisma.marketplaceItem.findUnique({
    where: { id: params.id },
    select: { imageStorageKey: true, imageMime: true },
  });
  if (!item?.imageStorageKey) return new NextResponse('Not found', { status: 404 });

  const width = req.nextUrl.searchParams.get('size') === 'full' ? 1400 : 640;
  const versioned = req.nextUrl.searchParams.has('v');

  try {
    const bytes = await getDocument(item.imageStorageKey);
    return await resizedImageResponse(bytes, { width, versioned, fallbackMime: item.imageMime });
  } catch (err) {
    console.error('[marketplace] image retrieval failed', err);
    return new NextResponse('Unavailable', { status: 500 });
  }
}
```

---

## FILE: src/lib/orderPdf.ts

```ts
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';

export interface OrderPdfLine {
  quantity: number;
  itemName: string;
  option: string | null;
  partNumber: string | null;
}

export interface OrderPdfData {
  orderId: string;
  createdAt: Date;
  dealerName: string;
  /** Multi-line ship-to address (already newline-joined). */
  shipTo?: string | null;
  phone?: string | null;
  altPhone?: string | null;
  submittedBy?: string | null;
  shippingMethod?: string | null;
  note?: string | null;
  lines: OrderPdfLine[];
}

const M = 54;
const RIGHT = 612 - M;
const TOP = 748;
const navy = rgb(0.055, 0.169, 0.361);
const gray = rgb(0.42, 0.45, 0.5);
const ink = rgb(0.1, 0.1, 0.12);
const line = rgb(0.9, 0.91, 0.93);

/**
 * Build a print-ready packing slip PDF for a marketplace order. It's attached to
 * the shipper's order email so they can print and pack straight from it — dealer
 * ship-to details, shipping method, and the item lines with per-size part
 * numbers. No prices (the marketplace carries none).
 */
export async function buildOrderPdf(data: OrderPdfData): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdf.addPage([612, 792]);
  let y = TOP;

  const text = (s: string, x: number, size = 10, f: PDFFont = font, color = ink) =>
    page.drawText(s, { x, y, size, font: f, color });
  const right = (s: string, size = 10, f: PDFFont = font, color = ink) =>
    page.drawText(s, { x: RIGHT - f.widthOfTextAtSize(s, size), y, size, font: f, color });
  const rule = (thickness = 0.5, color = line) =>
    page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness, color });
  const clip = (s: string, size: number, f: PDFFont = font, max = RIGHT - M - 170) => {
    if (f.widthOfTextAtSize(s, size) <= max) return s;
    let out = s;
    while (out.length > 1 && f.widthOfTextAtSize(`${out}…`, size) > max) out = out.slice(0, -1);
    return `${out}…`;
  };
  // Start a fresh continuation page and reset y to a headed position.
  const newPage = () => {
    page = pdf.addPage([612, 792]);
    y = TOP;
    text('Marketplace Order (continued)', M, 11, bold, navy);
    y -= 24;
  };

  // Header
  text('Georgian Water & Air', M, 17, bold, navy); y -= 18;
  text('Marketplace Order — Packing Slip', M, 11, font, gray); y -= 14;
  const printed = data.createdAt.toLocaleString('en-CA', {
    year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  text(`Order ${data.orderId.slice(-8).toUpperCase()}  ·  ${printed}`, M, 9, font, gray);
  y -= 12;
  rule(1.5, navy); y -= 22;

  // Ship-to block
  text('SHIP TO', M, 9, bold, gray); y -= 16;
  text(clip(data.dealerName, 12, bold), M, 12, bold); y -= 15;
  if (data.shipTo) {
    for (const addrLine of data.shipTo.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4)) {
      text(clip(addrLine, 10, font, RIGHT - M), M, 10); y -= 13;
    }
  } else {
    text('No address on file — confirm with the dealer.', M, 10, font, gray); y -= 13;
  }
  const contact: string[] = [];
  if (data.phone) contact.push(data.phone);
  if (data.altPhone) contact.push(data.altPhone);
  if (contact.length) { text(`Phone: ${contact.join('  /  ')}`, M, 10); y -= 13; }
  if (data.submittedBy) { text(`Ordered by: ${clip(data.submittedBy, 10, font, RIGHT - M)}`, M, 10, font, gray); y -= 13; }
  y -= 6;

  // Shipping method — highlighted so the shipper can't miss it
  text('SHIPPING METHOD', M, 9, bold, gray);
  text(data.shippingMethod || 'Not specified', M + 130, 11, bold, navy);
  y -= 20;
  rule(1, navy); y -= 20;

  // Item table
  const QTY_X = M;
  const NAME_X = M + 44;
  text('QTY', QTY_X, 9, bold, gray);
  text('ITEM', NAME_X, 9, bold, gray);
  right('PART #', 9, bold, gray);
  y -= 8;
  rule(); y -= 15;

  for (const l of data.lines) {
    if (y < 90) newPage();
    text(String(l.quantity), QTY_X, 11, bold);
    const label = l.option ? `${l.itemName} — ${l.option}` : l.itemName;
    text(clip(label, 10), NAME_X, 10);
    right(l.partNumber || '—', 10, l.partNumber ? bold : font, l.partNumber ? ink : gray);
    y -= 8;
    rule(); y -= 15;
  }

  const totalUnits = data.lines.reduce((s, l) => s + l.quantity, 0);
  y -= 4;
  if (y < 60) newPage();
  right(`Total pieces: ${totalUnits}`, 10, bold); y -= 22;

  if (data.note) {
    if (y < 80) newPage();
    text('NOTE', M, 9, bold, gray); y -= 15;
    let lineBuf = '';
    const flush = () => { if (lineBuf) { text(lineBuf, M, 10); y -= 13; lineBuf = ''; } };
    for (const w of data.note.split(/\s+/)) {
      const trial = lineBuf ? `${lineBuf} ${w}` : w;
      if (font.widthOfTextAtSize(trial, 10) > RIGHT - M) { flush(); lineBuf = w; }
      else lineBuf = trial;
      if (y < 70) { flush(); newPage(); }
    }
    flush();
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
```
