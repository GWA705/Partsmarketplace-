# GWA Parts Marketplace

A sortable, searchable catalogue of 1,380 water-treatment parts that dealers log
into and order from — filled either by GWA head office or shipped direct by the
supplier. The office and service techs order from the same catalogue internally.

Runs as its own app and its own database, separate from the GWA booking portal
(`gwa-webiste-`), and attaches into that portal behind a feature flag.

## Running it

```bash
npm install
cp .env.example .env          # set DATABASE_URL and SESSION_SECRET at minimum
npm run prisma:deploy         # create the schema
npm run db:seed               # a demo dealer and a staff admin
npm run import:catalogue -- data/Full_Merged_Water_Parts_Catalogue_1.xlsx          # dry run
npm run import:catalogue -- data/Full_Merged_Water_Parts_Catalogue_1.xlsx --commit
npm run dev
```

Tests: `npm test`. The unit tests run anywhere; the integration tests run
against `DATABASE_URL` when one is set and skip quietly when it is not.

## Importing a new price list

The price list gets reissued, so the importer is built to be re-run rather than
run once. It upserts on part code and refreshes only what the file owns —
descriptions, vendor, cost, unit. Categories, tags, photos, fitment, fulfilment
routing and hand-set dealer prices are yours and survive every re-import.

Dry-run first; it reports what would change and names every row it could not
use, with its spreadsheet row number. Nothing is ever silently dropped.

## How it fits together

| Concept | Where |
|---|---|
| Search (the whole navigation model) | `src/lib/search.ts` |
| Dealer pricing and the cost guard | `src/lib/pricing.ts`, `src/lib/partSelect.ts` |
| The order split by filling party | `src/lib/orders.ts` |
| Catalogue import | `src/lib/importCatalogue.ts`, `scripts/import-catalogue.ts` |
| Part-code departments and warehouses | `src/lib/codes.ts`, `/admin/segments` |
| Portal hand-off and embed | `src/app/portal`, `src/app/embed/parts`, `src/app/api/parts` |

Three decisions carry most of the weight, and each is explained where it lives:

1. **Cost never reaches a dealer.** The source price column is vendor cost,
   sitting next to the vendor's name. Cost and dealer price are separate
   columns and dealer-side reads go through `dealerPartSelect`, which cannot
   express `costCents`.
2. **Search, not browsing.** Only 28% of the catalogue has a category, so
   navigation is a search box that matches partial part numbers in either code
   column, with sort and filters over a dense table.
3. **One order, several shipments.** A cart mixing our stock with two
   drop-ship suppliers becomes one order and three pick lists. The dealer never
   sees the split; the people filling it see nothing else.

## Attaching it to the booking portal

The portal needs one environment variable, `PARTS_URL`. While it is unset, the
nav entry and the embed do not render — the marketplace can go live and sit dark
until you want it visible.

- **Staff sign-in:** the portal signs a 5-minute token with the shared
  `PARTS_LINK_SECRET` and links to `/portal?token=…`. One login for the office.
- **Embed:** `/embed/parts?token=…&fits=WHCCF,UV12` renders chrome-less for an
  iframe on a customer profile or service job, showing the parts that fit the
  equipment the portal already knows is in that home.
- **Read API:** `GET /api/parts?fits=SKU` with the same bearer token, for when
  the portal wants the data server-side — a parts list on a printed job sheet.

Both sides join on part code and portal SKU. Neither database reaches into the
other.

## Status

Built and working end to end: catalogue import, search, dealer login, cart,
checkout with the shipment split, pick-list PDFs, fulfillment queue, order
history and reorder, admin pricing, code-segment naming, dealers, fulfillment
contacts, and the portal seam.

**Before it goes live, two things need a decision** — see `docs/PLAN.md` §9:
dealer prices are currently derived from a placeholder 35% markup and are
**hidden from dealers** until someone confirms the real number, and the
department/warehouse codes need naming in `/admin/segments`.
