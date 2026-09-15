// Deliberately NOT 'server-only': this module is shared by the admin server
// action and by scripts/import-catalogue.ts, which runs under tsx on the CLI.
// It reaches the browser through neither.
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/db';
import { toCents } from '@/lib/money';
import {
  segmentOf,
  alsoUsedForCodes,
  normalizeCode,
  parseSupersession,
  SUGGESTED_WAREHOUSES,
} from '@/lib/codes';
import type { PartSource, Prisma } from '@prisma/client';

/**
 * Catalogue import.
 *
 * Built to be RE-RUN, not run once. The price list is reissued periodically, so
 * the importer upserts on part code and is careful about what it is allowed to
 * overwrite: vendor pricing and descriptions come from the file and are
 * refreshed; categories, tags, images, fitment, fulfilment routing and
 * hand-set dealer prices are ours and are never clobbered by a re-import.
 *
 * It never silently drops a row. Anything it cannot use is counted and
 * reported with its spreadsheet row number.
 */

/** Column headers as they appear in the merged catalogue workbook. */
const COL = {
  image: 'Image',
  source: 'Source',
  category: 'Category (Catalogue)',
  code: 'Price List Item Code',
  description: 'Price List Description',
  vendor: 'Preferred Vendor',
  price: 'Price',
  unit: 'U/M',
  cataloguePart: 'Catalogue Part #',
  catalogueDesc: 'Catalogue Description',
  note: 'Note',
} as const;

const SOURCE_MAP: Record<string, PartSource> = {
  'price list only': 'PRICE_LIST',
  'price list + catalogue': 'PRICE_LIST_AND_CATALOGUE',
  'catalogue only (not in price list)': 'CATALOGUE_ONLY',
};

export interface ImportOptions {
  filePath: string;
  /** Nothing is written unless this is true. */
  commit?: boolean;
  actorName?: string;
}

export interface ImportReport {
  fileName: string;
  dryRun: boolean;
  rowsRead: number;
  created: number;
  updated: number;
  skipped: number;
  /// Rows folded into an earlier row with the same part number (one part that
  /// fits several systems). Not an error — counted so the arithmetic adds up.
  merged: number;
  deactivated: number;
  problems: string[];
  newSegments: string[];
  newCategories: string[];
}

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/\s+/g, ' ');
  return s === '' ? null : s;
};

export async function importCatalogue(opts: ImportOptions): Promise<ImportReport> {
  const fileName = opts.filePath.split('/').pop() || opts.filePath;
  const dryRun = !opts.commit;

  const wb = XLSX.readFile(opts.filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  const report: ImportReport = {
    fileName,
    dryRun,
    rowsRead: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    merged: 0,
    deactivated: 0,
    problems: [],
    newSegments: [],
    newCategories: [],
  };

  // ── Pass 1: read and validate every row before writing anything ──────────
  interface Staged {
    rowNo: number;
    key: string;
    data: Prisma.PartCreateInput;
    categoryName: string | null;
    segment: string | null;
    supersededBy: string | null;
    /// Extra categories the same part number appeared under on other rows.
    alsoCategories: string[];
  }
  const staged: Staged[] = [];
  const stagedByKey = new Map<string, Staged>();

  rows.forEach((raw, i) => {
    const rowNo = i + 2; // +1 for the header, +1 because spreadsheets are 1-based

    // Either code column may carry a supersession annotation, e.g.
    // "36002018 (USE 400547)". Split it before anything else touches the value.
    const codeParsed = parseSupersession(raw[COL.code]);
    const cataloguePartParsed = parseSupersession(raw[COL.cataloguePart]);
    const code = codeParsed.code;
    const cataloguePart = cataloguePartParsed.code;
    const supersededBy = codeParsed.supersededBy ?? cataloguePartParsed.supersededBy;
    const name = str(raw[COL.description]) || str(raw[COL.catalogueDesc]);
    const sourceRaw = (str(raw[COL.source]) || '').toLowerCase();
    const source = SOURCE_MAP[sourceRaw];

    if (!name) {
      report.problems.push(`row ${rowNo}: no description in either column — skipped`);
      report.skipped += 1;
      return;
    }
    if (!source) {
      report.problems.push(`row ${rowNo}: unrecognised Source "${str(raw[COL.source])}" — skipped`);
      report.skipped += 1;
      return;
    }
    // Catalogue-only rows have no item code and no price. They are real parts,
    // so they import — but inactive, and they surface in the admin "needs a
    // code" queue rather than being quietly dropped or shown to dealers.
    const key = code || cataloguePart;
    if (!key) {
      report.problems.push(`row ${rowNo}: no part code in either column — skipped`);
      report.skipped += 1;
      return;
    }

    // The same part number legitimately appears on more than one row when one
    // physical part serves several systems — a UV lamp listed under both UV10
    // and UV15, say. That is one part that fits two things, not two parts and
    // not an error, so the rows MERGE: the first wins, later ones contribute
    // their category as a cross-reference.
    const prior = stagedByKey.get(key);
    if (prior) {
      const cat = str(raw[COL.category]);
      if (cat && cat !== prior.categoryName && !prior.alsoCategories.includes(cat)) {
        prior.alsoCategories.push(cat);
      }
      report.merged += 1;
      return;
    }

    const catalogueName = str(raw[COL.catalogueDesc]);
    const note = str(raw[COL.note]);
    const segment = segmentOf(code) || segmentOf(cataloguePart);
    const categoryName = str(raw[COL.category]);

    const entry: Staged = {
      rowNo,
      key,
      segment,
      categoryName,
      supersededBy,
      alsoCategories: [],
      data: {
        code,
        catalogueCode: cataloguePart && cataloguePart !== code ? cataloguePart : null,
        name,
        catalogueName: catalogueName && catalogueName !== name ? catalogueName : null,
        vendor: str(raw[COL.vendor]),
        unit: str(raw[COL.unit]),
        costCents: toCents(raw[COL.price]),
        source,
        // A row with no code cannot be ordered, so it lands inactive.
        active: !!code,
        note,
        alsoUsedFor: alsoUsedForCodes(note),
        importedAt: new Date(),
      },
    };
    staged.push(entry);
    stagedByKey.set(key, entry);
  });

  // ── Segments and categories referenced by the file ───────────────────────
  const segments = [...new Set(staged.map((s) => s.segment).filter((s): s is string => !!s))];
  const categories = [...new Set(staged.map((s) => s.categoryName).filter((c): c is string => !!c))];

  const [existingSegments, existingCategories] = await Promise.all([
    prisma.codeSegment.findMany({ select: { code: true } }),
    prisma.partCategory.findMany({ select: { id: true, name: true } }),
  ]);
  const haveSegment = new Set(existingSegments.map((s) => s.code));
  const categoryByName = new Map(existingCategories.map((c) => [c.name, c.id]));

  report.newSegments = segments.filter((s) => !haveSegment.has(s));
  report.newCategories = categories.filter((c) => !categoryByName.has(c));

  if (dryRun) {
    // Count what WOULD happen, without touching the database.
    const existing = await prisma.part.findMany({ select: { code: true, catalogueCode: true } });
    const known = new Set<string>();
    for (const p of existing) {
      if (p.code) known.add(p.code);
      if (p.catalogueCode) known.add(p.catalogueCode);
    }
    for (const s of staged) {
      if (known.has(s.key)) report.updated += 1;
      else report.created += 1;
    }
    return report;
  }

  // ── Pass 2: write ────────────────────────────────────────────────────────
  for (const code of report.newSegments) {
    const suggested = SUGGESTED_WAREHOUSES[code];
    await prisma.codeSegment.create({
      data: {
        code,
        kind: suggested ? 'WAREHOUSE' : 'UNKNOWN',
        label: suggested ?? null,
        // Even a confident guess waits on a human. The admin screen lists
        // everything unconfirmed so a new price list's codes get named.
        confirmed: false,
      },
    });
  }

  for (const name of report.newCategories) {
    const created = await prisma.partCategory.create({ data: { name } });
    categoryByName.set(name, created.id);
  }

  for (const s of staged) {
    const where = s.data.code ? { code: s.data.code } : { code: s.key };
    const existing = await prisma.part.findFirst({
      where: s.data.code
        ? { code: s.data.code }
        : { OR: [{ code: s.key }, { catalogueCode: s.key }] },
      select: { id: true, categoryId: true, priceOverridden: true },
    });

    // Fields the FILE owns — always refreshed on re-import.
    const fromFile = {
      code: s.data.code,
      catalogueCode: s.data.catalogueCode,
      name: s.data.name,
      catalogueName: s.data.catalogueName,
      vendor: s.data.vendor,
      unit: s.data.unit,
      costCents: s.data.costCents,
      source: s.data.source,
      note: s.data.note,
      alsoUsedFor: s.data.alsoUsedFor,
      supersededBy: s.supersededBy,
      segmentCode: s.segment,
      importedAt: new Date(),
    };

    if (existing) {
      // Everything NOT in `fromFile` is ours: category (once set by hand),
      // tags, image, fitment, fulfilledBy, sortOrder, featured, and a
      // hand-set dealer price. A re-import must not undo that work.
      await prisma.part.update({
        where: { id: existing.id },
        data: {
          ...fromFile,
          // Only fill a category the file knows if nobody has set one here.
          ...(existing.categoryId || !s.categoryName
            ? {}
            : { categoryId: categoryByName.get(s.categoryName) ?? null }),
        },
      });
      report.updated += 1;
    } else {
      await prisma.part.create({
        data: {
          ...fromFile,
          active: s.data.active,
          categoryId: s.categoryName ? categoryByName.get(s.categoryName) ?? null : null,
        },
      });
      report.created += 1;
    }
    void where;
  }

  await prisma.importRun.create({
    data: {
      fileName,
      dryRun: false,
      rowsRead: report.rowsRead,
      created: report.created,
      updated: report.updated,
      skipped: report.skipped,
      problems: report.problems.join('\n') || null,
      actorName: opts.actorName ?? null,
      finishedAt: new Date(),
    },
  });

  return report;
}
