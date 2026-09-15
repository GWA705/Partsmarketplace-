# GWA Parts Marketplace — build plan

A standalone parts-ordering system for the water side of the business: a
sortable, searchable catalogue of 1,381 parts that **dealers log into and order
from** — filled either by head office or shipped direct by the supplier. The
office and service techs order from the same catalogue internally. It runs as
its own app and its own database, and attaches into the booking portal
(`gwa-booking`) when we want it there.

Nothing in here is built yet. This document is the design we agreed before code,
so it can be argued with cheaply.

---

## 1. Decisions already made

| Question | Decision |
|---|---|
| Who buys | **Dealers, primarily** — they log in, search the catalogue and build an order. Office/techs order internally on the same catalogue. No homeowner self-serve in v1. |
| Fulfilled by | Head office **or** direct from the supplier. One dealer order can split across both — see §4a. |
| Payment | **None in v1.** Orders are submitted, not paid. Dealers are invoiced on their existing terms. |
| Prices | Shown, but **never the vendor cost** — see §4. This is the biggest single decision in the build. |
| Codebase | Separate repo (`gwa705/partsmarketplace-`), separate database, separate deploy. |
| Join to the portal | On **part code**, not a foreign key. Neither database reaches into the other. |

### Why separate, not a route group inside the portal

The booking portal is the thing that runs the day — the call console, the board,
dispatch. Its schema is already ~3,500 lines. Three reasons to keep the
marketplace out of it:

1. **Blast radius.** A storefront bug, a bad import, or a traffic spike must not
   be able to touch the database that books appointments.
2. **Cadence.** The portal ships constantly; a parts catalogue moves when vendor
   pricing moves. Different release rhythms want different repos.
3. **Audience.** Dealers are not staff. Putting external accounts into the
   portal's `User` table and its `Role` enum would mean every portal permission
   check has to start considering a party that should never see a lead.

The cost is that we lose SQL joins between the two. We pay it with part-code
reconciliation — which is already how the portal mirrors the credit portal
(`Product.sku` holds the credit portal's journal name, e.g. `WHCCF`). It is a
pattern the team already runs.

---

## 2. What is actually in the catalogue

Source: `data/Full_Merged_Water_Parts_Catalogue_1.xlsx` (banked in this repo),
one sheet, 1,381 data rows,
11 columns: Image, Source, Category (Catalogue), Price List Item Code, Price
List Description, Preferred Vendor, Price, U/M, Catalogue Part #, Catalogue
Description, Note.

**This file is v1 and will be superseded.** A newer price list is expected, so
every design choice below assumes re-import over replacement: the importer
upserts on part code and never clobbers hand-entered data (§7).

**The shape of it:**

- **1,294 rows carry a price-list item code, and all 1,294 codes are unique.**
  That is the natural primary key. No dedupe work needed.
- **Three populations,** flagged in the `Source` column:
  - `Price List only` — 999 rows. Priced, vendored, **no category**.
  - `Price List + Catalogue` — 295 rows. Priced *and* categorised.
  - `Catalogue only (not in price list)` — 87 rows. Categorised, **no item code
    and no price at all** (they carry only a Catalogue Part #).
- **17 categories**, covering only 382 rows (28%). The big ones: Demo Materials
  (111), Pur100-7 Replacement Parts (68), Soft & Soft+ Conditioner Replacement
  Parts (58), Quick Connect (23), Paper Work (17), UV10 (16), UV15 (15), SIM
  (14). The rest are ≤13 each.
- **35 vendors.** Watergroup 508, RespirAide Tech 363, Liquid Soap Products 78,
  GHS-Barrie 77 (i.e. our own), La Motte 47.
- **Prices** present on 1,280 rows, ranging $0 to $6,988.
- **U/M** on 758 rows only (each / Case / dozen).
- **Images: zero.** The Image column is empty in every row.
- **Code suffixes look like a real taxonomy**: `.03` (348), `.SC` (207), `.SO`
  (190), `.H2O` (103), `.DEM` (81), `.HD` (78), `.IN` (71), `.RT` (49), `.EX`
  (40), `.TDC` (39), `.WR` (33), and 60 with no suffix. Worth confirming what
  these mean — they may be a better categorisation axis than the sparse
  Category column.

### The three data problems to solve before launch

These are not blockers for the build; they are blockers for the catalogue being
*usable*. Flagging them now so they don't surprise us at go-live.

1. **72% of parts have no category.** A browsable marketplace whose default view
   is 999 uncategorized items is not browsable. Options, in order of preference:
   (a) derive a category from the code suffix if the suffixes mean what they
   look like they mean; (b) bulk-categorize in an admin screen built for it;
   (c) launch with search-first navigation and let categories fill in over time.
   **Recommendation: (a) then (c)** — ship search-first so the catalogue is
   useful on day one regardless.
2. **87 parts have no code and no price.** They cannot be ordered as-is. Either
   they get codes, or they are imported inactive and surfaced in an admin
   "needs attention" list.
3. **No product images, at all.** 1,381 photos is not a task anyone is going to
   finish. Plan for a catalogue that reads well *without* photos (code,
   description, vendor, U/M laid out densely), and treat images as an
   incremental nice-to-have added to the parts that get ordered most.

Two smaller ones: 137 rows have a Price List Description that differs from the
Catalogue Description (we keep both — see schema), and only 5 rows carry a Note,
all of the form "Also used for: <other category> - <other code>" — a fitment
cross-reference we should preserve as structured data, not free text.

---

## 3. Schema

Starting from the portal's existing Marketplace models (in
`marketplace-bundle.md`), with the changes a *parts* catalogue needs. Kept:
`MarketplaceCategory`, the item/order/order-item shape, DOWNLOAD-type items,
merchandising tags, shipping methods. Changed as below.

```prisma
model Part {
  id            String  @id @default(cuid())
  /// Price-list item code — the unique key across the business. 1,294 of
  /// 1,381 catalogue rows have one; the rest import inactive until they do.
  code          String? @unique
  /// Catalogue Part # where it differs from `code` (e.g. 0208W.IN vs
  /// 0208W.H2O). Kept so either number finds the part in search.
  catalogueCode String?
  /// Price-list description — what the office and the vendor call it.
  name          String
  /// Catalogue description where it differs (137 rows). Shown to dealers when
  /// present, because it is usually the more human of the two.
  catalogueName String?
  vendor        String?
  unit          String?   // "each (ea)" | "Case (cs)" | "dozen (dz)"
  /// Who fills a dealer order for this part: HEAD_OFFICE (our stock) or
  /// SUPPLIER (drop-shipped by `vendor`). Drives the order split — see §4a.
  fulfilledBy   String  @default("HEAD_OFFICE")

  // ── Money (see §4) ──
  /// What we pay the vendor, in cents. INTERNAL ONLY — never serialized to a
  /// dealer-facing payload. Nothing in the dealer route group may select this.
  costCents     Int?
  /// What a dealer pays, in cents. Null = "call for pricing" until set.
  dealerCents   Int?

  categoryId    String?
  category      PartCategory? @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  /// Import provenance: PRICE_LIST | PRICE_LIST_AND_CATALOGUE | CATALOGUE_ONLY
  source        String
  active        Boolean @default(true)
  tags          String[] @default([])   // NEW | SALE | CLEARANCE | POPULAR
  featured      Boolean @default(false)
  sortOrder     Int     @default(0)

  imageStorageKey String?
  imageMime       String?
  imageSizeBytes  Int?

  /// Free-text note from the import (the 5 "Also used for:" rows).
  note          String?
  /// Structured fitment — which equipment this part serves. Holds portal SKUs
  /// (WHCCF, UV12, …). This is the join to the booking portal; see §6.
  fitsSkus      String[] @default([])

  importedAt    DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  orderLines    OrderLine[]

  @@index([active])
  @@index([categoryId])
  @@index([vendor])
}
```

`PartCategory` is the bundle's `MarketplaceCategory` verbatim (id, name,
sortOrder, active, timestamps).

`Order` / `Shipment` / `OrderLine` follow the bundle's order shape, with these
differences:

- The buyer is polymorphic: `buyerKind` (`INTERNAL` | `DEALER`) plus
  `dealerId?` and `placedByUserId`. Internal orders skip shipping and carry a
  `jobRef` instead — the portal's `J-####` service job number, as a **string**,
  not a foreign key.
- **`Shipment` sits between order and line** (§4a): one per fulfilling party,
  carrying `fulfilledBy`, `vendor?`, `shippingMethod`, and its own status. The
  dealer places one order; it may produce two or more shipments.
- Line items snapshot `code`, `name`, **and `unitCents`** at order time. A
  submitted order must never re-read live pricing.
- `status` on both order and shipment:
  `SUBMITTED | ACKNOWLEDGED | FULFILLED | CANCELLED`. The order's status is
  derived from its shipments.

---

## 4. Pricing — the decision that matters most

The spreadsheet's `Price` column is **vendor cost**, sitting right next to
`Preferred Vendor`. Two consequences:

1. **It must never reach a dealer.** Showing a dealer that Watergroup sells us a
   1/4" union connector for $2.24 hands them our margin on 508 parts and our
   vendor list on all of them. This is not a UI concern to be careful about — it
   is an architectural one. Hence `costCents` and `dealerCents` as separate
   columns, with the rule that **no query in the dealer route group selects
   `costCents`**, enforced by a shared `dealerPartSelect` Prisma selector that
   every dealer-side read must go through.
2. **`dealerCents` has to come from somewhere.** Options: a flat markup
   multiplier over cost, a markup per vendor, a markup per category, or a
   hand-set price per part. Realistically: **a default multiplier, overridable
   per category, overridable per part.** The import seeds `dealerCents` from the
   multiplier so nothing launches priceless; admin overrides accumulate.

Internal orders show cost, because that is the number the office needs for job
costing.

**This needs your input before I write the import** — see §9.

---

## 4a. Fulfillment: head office vs. supplier

"From our head office or suppliers" is a routing decision per part, and it shapes
both the schema and the checkout.

Each part carries a `fulfilledBy`: `HEAD_OFFICE` (we hold stock and ship it) or
`SUPPLIER` (drop-shipped by the vendor on the dealer's behalf). The vendor mix
makes this real — Watergroup alone is 508 of 1,294 priced parts, RespirAide 363,
and 77 are `GHS-BARRIE`, i.e. our own stock.

Consequences:

- **One dealer order can split.** A cart with a Watergroup part and a GHS-Barrie
  part is one `Order` the dealer sees, and two `Shipment` rows underneath it —
  one per fulfilling party. Each shipment gets its own packing slip / PO email
  to whoever fills it. The dealer never has to care; they place one order.
- **The dealer sees "ships from head office" / "ships direct" per line,** because
  lead times differ and they will ask.
- **Shipping method is per shipment, not per order.** The bundle's
  `MARKETPLACE_SHIPPING_METHODS` still applies, chosen once at checkout and
  carried onto each shipment.
- **Supplier-facing emails must not leak dealer margin.** A drop-ship PO to
  Watergroup shows our cost and the dealer's ship-to address — never
  `dealerCents`. Same discipline as §4, opposite direction.

`Order` therefore gains a `Shipment` child; `OrderLine` hangs off the shipment
rather than the order directly.

---

## 4b. Search and sort — the thing that makes it usable

A dealer's job is: *find the part, add it, submit.* With 1,381 parts and 72% of
them uncategorized (§2), navigation is search, not browsing. This is the part of
the build that decides whether the tool gets used.

**Search must hit, in one box:** part code, catalogue part #, price-list
description, catalogue description, and vendor. A dealer holding a physical part
reads the number off it — `0208W.IN` and `0208W.H2O` are the same part and both
must find it. Typo tolerance and partial-code matching matter more than clever
relevance ranking; Postgres full-text plus a trigram index on the code columns
covers it without a search service.

**Sort by:** relevance (default on a query), part code, name, price, vendor, and
recently ordered. Persist the dealer's choice.

**Filter by:** category, vendor, fulfilled-by, in-stock (if we expose stock),
and "parts I have ordered before" — which for a repeat-ordering dealer is the
single most useful filter on the page.

**Reorder in one click.** A dealer's order history is their real catalogue. Past
orders get a "reorder" that refills the cart, and a per-dealer "frequently
ordered" list on the landing page. Most dealer sessions should never need search
at all.

**Dense rows, not a photo grid.** There are no product images (§2), and a grid of
1,381 placeholder tiles is worse than useless. A table — code, description,
vendor, unit, price, qty, add — is the right default, with images shown on the
parts that eventually have them.

---

## 5. Identity

Two populations, and the portal's `Role` enum fits neither cleanly.

- **Internal** — office and service techs. Small, known, already exists in the
  portal's `User` table.
- **Dealers** — external accounts, each with one or more contacts, a shipping
  address, and a price tier.

Build the marketplace with its own `User` and `Dealer` tables and its own
session (reusing the portal's `jose`/HS256 pattern from `src/lib/session.ts`,
which is sound, but not its cookie or its `Role` enum). Internal staff get in
via a **portal-minted token** rather than a second password: the portal signs a
short-lived `{userId, email, name, scope: 'INTERNAL'}` JWT with a shared
`PARTS_LINK_SECRET`, the marketplace verifies it and issues its own session. One
login, no second user directory to keep in sync.

---

## 6. The seam into the portal

Three pieces, all optional, all off until switched on.

1. **Part code and portal SKU are the shared vocabulary.** `Part.fitsSkus` holds
   portal `Product.sku` values. Nothing else crosses.
2. **Embed route.** `/embed/parts?fits=WHCCF,UV12` renders chrome-less for an
   iframe in the portal's customer profile or service job screen, entered with
   the same short-lived signed token as §5. A tech looking at a job sees the
   parts that fit what is actually in that home — which is exactly what
   `CustomerProduct` in the portal already knows.
3. **Feature flag.** The portal grows one env var, `PARTS_URL`. Unset, the nav
   entry and the embed do not render at all. That is the "attach when needed"
   switch: the marketplace can go live and sit dark in the portal until we want
   it visible.

A thin read API (`GET /api/parts?fits=SKU`, token-authed) covers the case where
the portal wants parts data server-side rather than in an iframe — e.g. putting
a parts list on a printed job sheet.

---

## 7. Import pipeline

A repeatable importer, not a one-time seed — the price list will be re-sent.

- `scripts/import-catalogue.ts` reads the .xlsx directly (no manual CSV step).
- **Upsert on `code`.** Re-running updates prices and descriptions without
  creating duplicates or disturbing hand-set categories, tags, images, or
  `dealerCents` overrides.
- Rows with no code (the 87 catalogue-only) import **inactive**, keyed by
  `catalogueCode`, and land in an admin "needs a code" queue.
- Parses the 5 `Also used for:` notes into `fitsSkus` where the referenced code
  resolves.
- Writes an import report: rows read, created, updated, skipped, and every row
  that failed validation with its row number. Never silently drops a row.
- Dry-run mode by default; `--commit` to write.

---

## 8. What to port from the bundle, what to rebuild

Asked and answered, from the bundle's "Stack assumptions":

| Helper | Call |
|---|---|
| `@/lib/storage` (S3/local) | **Port as-is.** It is generic and already proven against the portal's S3 setup. |
| `@/lib/image` (upload resize) | **Port as-is.** |
| `@/lib/email` + templates | **Port the sender, rewrite the templates.** A parts order email is not a merch order email — it needs codes, vendor, and job ref. |
| `@/lib/audit` | **Port the shape, own table.** Separate database, so it cannot write to the portal's `AuditLog`. |
| `@/lib/session` | **Rebuild.** Same JWT approach, different identity model (§5). Porting it would import the portal's `Role` enum, which is wrong here. |
| `@/i18n` | **Drop for v1.** Hardcode English; the dealer base is Ontario. Re-add if that changes. |
| `orderPdf.ts` (pdf-lib packing slip) | **Port, then extend** with part code, vendor and unit columns. |
| `MARKETPLACE_TAGS`, shipping methods | **Port as-is.** Both fit unchanged. |
| The dealer order form (701 lines) | **Read it, rebuild it.** Cart/checkout logic carries over; a 1,381-part catalogue needs search-first navigation, not a category grid, so the browse UI is genuinely different. |

**Pricing/payment scaffolding:** yes to pricing (§4 — dealers on wholesale need
a number), **no to payment.** No cart total that charges anything, no processor,
no stored payment method. Orders are submitted and invoiced on existing terms.
Adding payment later is a clean addition; carrying a half-built checkout from
day one is not.

---

## 9. Open questions — I need answers to two before writing the importer

1. **Dealer pricing.** Flat markup over cost, per-vendor, per-category, or
   hand-set per part? If a multiplier, what is it? (I will build the mechanism
   for all four regardless; I need the default to seed 1,280 prices.)
2. **Code suffixes.** Do `.03 / .SC / .SO / .H2O / .DEM / .HD / .IN / .RT / .EX
   / .TDC / .WR` mean something consistent — product line, vendor, department?
   If they do, that is the fix for the 999 uncategorized parts and I should use
   it. If they are historical noise, I will go search-first.

Not blocking, but worth deciding before launch: which parts (if any) get photos
first, and whether dealers see stock levels or just place orders blind.

---

## 10. Build order

1. Scaffold: Next.js 14 App Router, Prisma, Postgres, Tailwind — mirroring the
   portal's conventions so the two codebases read alike.
2. Schema + first migration.
3. Importer with dry-run + report; import the 1,381 rows.
4. **Dealer accounts and login** (§5).
5. **Dealer catalogue: search, sort, filter** (§4b), priced with `dealerPartSelect`
   so cost cannot leak. *This is the first deployable thing* — a dealer who can
   only search the catalogue is already better off than one phoning to ask.
6. **Cart and checkout**: qty, shipping method, note, submit. Order splits into
   per-fulfiller shipments (§4a), emails each filler, produces packing slips.
7. Order history + one-click reorder + frequently-ordered (§4b). Cheap to build,
   and it is what makes the tool sticky.
8. Admin: categories, per-part edit, bulk categorize, dealer pricing overrides,
   the "needs a code" queue.
9. Internal ordering: same catalogue, cost visible, `jobRef` instead of shipping.
10. Portal seam: `PARTS_URL` flag, embed route, `fitsSkus` on the parts that
    matter.

Steps 1–6 are the smallest thing that does what you asked for.
