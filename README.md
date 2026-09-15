# GWA Parts Marketplace

A sortable, searchable parts catalogue that dealers log into to order the parts
they need — filled either by GWA head office or shipped direct by the supplier.
The office and service techs order from the same catalogue internally.

Runs as its own app and its own database, separate from the GWA booking portal
(`gwa-webiste-`), and attaches into that portal behind a feature flag when
wanted.

**Status: planning. No application code yet.**

## What's here

| Path | What it is |
|---|---|
| `docs/PLAN.md` | The build plan — decisions, catalogue analysis, schema, open questions. **Start here.** |
| `docs/portal-marketplace-bundle.md` | Reference export of the existing portal's Marketplace feature (dealer merch ordering). Source material to port from, not the design. |
| `data/Full_Merged_Water_Parts_Catalogue_1.xlsx` | The seed catalogue: 1,381 parts. Superseded by newer price lists as they arrive; the importer upserts rather than replaces. |

## Next step

Two open questions in `docs/PLAN.md` §9 need answers before the importer can be
written — dealer pricing basis, and what the part-code suffixes mean.
