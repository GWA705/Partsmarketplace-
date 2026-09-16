import { formatCents } from '@/lib/money';
import {
  type Sheet, newSheet, render, text, textAt, right, rule, box, clip, wrap,
  nextPage, addressBlock, rushBanner,
  M, RIGHT, TOP, PAGE, ink, navy, gray, hair, wash, alarm,
} from '@/lib/pdfKit';

/**
 * The paperwork one order produces.
 *
 *   invoice      — what the dealer and accounts see: bill-to, ship-to, prices,
 *                  tax and a total.
 *   packing slip — goes in the box: what is inside, no money.
 *   pick list    — the warehouse copy: laid out for somebody walking shelves
 *                  with it, no money, tick boxes, room to write.
 *
 * They are different documents because they are read by different people doing
 * different jobs, and squeezing all three into one sheet serves none of them.
 */

export interface DocLine {
  code: string | null;
  /** The number on the part when it differs from the item code. */
  altCode?: string | null;
  name: string;
  unit: string | null;
  quantity: number;
  unitCents: number | null;
  /** Department or warehouse, used to order the picker's walk. */
  location?: string | null;
}

export interface DocAddress {
  name?: string | null;
  lines: (string | null | undefined)[];
  email?: string | null;
  phone?: string | null;
}

export interface DocOrder {
  orderNumber: string;
  submittedAt: Date;
  rush: boolean;
  customerName: string;
  customerCode?: string | null;
  placedBy?: string | null;
  shippingMethod?: string | null;
  note?: string | null;
  jobRef?: string | null;
  shipTo: DocAddress;
  billTo: DocAddress;
  /** "Head office", a supplier's name, or "Ships direct" — audience decides. */
  fulfilledByLabel?: string | null;
  lines: DocLine[];
  /** Tax exactly as it was charged, frozen onto the order at submit. */
  taxLines?: { label: string; amountCents: number }[];
  /** Our GST/HST and QST registrations — an invoice charging tax needs them. */
  taxNumbers?: (string | null | undefined)[];
  /** The dealer's exemption number, when they claimed one. */
  exemptionNote?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared letterhead
// ─────────────────────────────────────────────────────────────────────────────

function letterhead(s: Sheet, title: string, order: DocOrder, subtitle?: string): void {
  text(s, 'Georgian Water & Air', M, 16, s.bold, navy);
  right(s, title.toUpperCase(), 13, s.bold, navy);
  s.y -= 15;
  text(s, 'Barrie, Ontario', M, 8.5, s.font, gray);
  right(s, order.orderNumber, 11, s.bold);
  s.y -= 12;
  if (subtitle) text(s, subtitle, M, 8.5, s.font, gray);
  right(
    s,
    order.submittedAt.toLocaleDateString('en-CA', {
      year: 'numeric', month: 'long', day: 'numeric',
    }),
    8.5,
    s.font,
    gray,
  );
  s.y -= 10;
  rule(s, 1.5, navy);
  s.y -= 18;
}

/** Label/value strip used across the top of every document. */
function metaRow(s: Sheet, pairs: [string, string][]): void {
  const cols = pairs.length;
  const w = (RIGHT - M) / cols;
  const top = s.y;
  pairs.forEach(([label, value], i) => {
    const x = M + i * w;
    textAt(s, label.toUpperCase(), x, top, 7, s.bold, gray);
    textAt(s, clip(value || '—', 10, s.bold, w - 8), x, top - 13, 10, s.bold);
  });
  s.y = top - 26;
}

// ─────────────────────────────────────────────────────────────────────────────
// Invoice
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The money document. Bill-to and ship-to side by side because they routinely
 * differ — parts go to the shop, the invoice goes to whoever pays.
 *
 * `priced: false` prints the same sheet as an order confirmation, with the
 * columns and totals omitted. That is the version that goes out while dealer
 * pricing is still being settled, so an order can be acknowledged on paper
 * without quoting a number nobody has confirmed.
 */
export async function buildInvoice(
  order: DocOrder,
  opts: { priced: boolean; title?: string } = { priced: true },
): Promise<Buffer> {
  const s = await newSheet();
  const priced = opts.priced;
  const title = opts.title ?? (priced ? 'Invoice' : 'Order confirmation');

  const header = (sheet: Sheet) => letterhead(sheet, title, order, 'Parts order');
  header(s);
  if (order.rush) rushBanner(s);

  // Bill to / Ship to
  const half = (RIGHT - M) / 2;
  const blockTop = s.y;
  const billEnd = addressBlock(
    s, 'BILL TO', order.billTo.name ?? order.customerName,
    [...order.billTo.lines, order.billTo.email], M, blockTop, half - 16,
  );
  const shipEnd = addressBlock(
    s, 'SHIP TO', order.shipTo.name ?? order.customerName,
    [...order.shipTo.lines, order.shipTo.phone], M + half, blockTop, half - 16,
  );
  s.y = Math.min(billEnd, shipEnd) - 12;

  rule(s);
  s.y -= 18;
  metaRow(s, [
    ['Customer', order.customerCode ? `${order.customerName} (${order.customerCode})` : order.customerName],
    ['Shipping', order.shippingMethod ?? 'Not specified'],
    ['Ordered by', order.placedBy ?? '—'],
  ]);
  if (order.jobRef) {
    metaRow(s, [['Service job', order.jobRef]]);
  }
  rule(s);
  s.y -= 16;

  // Columns
  const CODE_X = M;
  const NAME_X = M + 108;
  const QTY_X = priced ? RIGHT - 176 : RIGHT - 90;
  const UNIT_X = RIGHT - 118;
  const AMT_X = RIGHT;
  const nameW = QTY_X - NAME_X - 10;

  const tableHead = (sheet: Sheet) => {
    textAt(sheet, 'ITEM #', CODE_X, sheet.y, 7.5, sheet.bold, gray);
    textAt(sheet, 'DESCRIPTION', NAME_X, sheet.y, 7.5, sheet.bold, gray);
    textAt(sheet, 'QTY', QTY_X, sheet.y, 7.5, sheet.bold, gray);
    if (priced) {
      textAt(sheet, 'UNIT', UNIT_X, sheet.y, 7.5, sheet.bold, gray);
      const amt = 'AMOUNT';
      textAt(sheet, amt, AMT_X - sheet.bold.widthOfTextAtSize(amt, 7.5), sheet.y, 7.5, sheet.bold, gray);
    }
    sheet.y -= 7;
    rule(sheet);
    sheet.y -= 14;
  };
  tableHead(s);

  let subtotal = 0;
  let pieces = 0;
  for (const l of order.lines) {
    if (s.y < 120) {
      nextPage(s, (sheet) => { header(sheet); tableHead(sheet); });
    }
    pieces += l.quantity;
    const amount = l.unitCents === null ? null : l.unitCents * l.quantity;
    if (amount !== null) subtotal += amount;

    text(s, clip(l.code ?? '—', 9, s.bold, NAME_X - CODE_X - 8), CODE_X, 9, s.bold);
    textAt(s, clip(l.name, 9, s.font, nameW), NAME_X, s.y, 9);
    textAt(s, String(l.quantity), QTY_X, s.y, 9.5, s.bold);
    if (l.unit) textAt(s, clip(l.unit, 7, s.font, 60), QTY_X + 20, s.y, 7, s.font, gray);
    if (priced) {
      textAt(s, formatCents(l.unitCents), UNIT_X, s.y, 9);
      const a = amount === null ? '—' : formatCents(amount);
      textAt(s, a, AMT_X - s.font.widthOfTextAtSize(a, 9), s.y, 9);
    }
    s.y -= 7;
    rule(s);
    s.y -= 13;
  }

  // Totals
  s.y -= 6;
  if (s.y < 130) nextPage(s, header);
  right(s, `${pieces} pieces on ${order.lines.length} lines`, 8.5, s.font, gray);
  s.y -= 16;

  if (priced) {
    const labelX = RIGHT - 190;
    const line = (label: string, value: string, strong = false) => {
      textAt(s, label, labelX, s.y, strong ? 10.5 : 9.5, strong ? s.bold : s.font, strong ? ink : gray);
      const f = strong ? s.bold : s.font;
      const size = strong ? 11.5 : 9.5;
      textAt(s, value, AMT_X - f.widthOfTextAtSize(value, size), s.y, size, f);
      s.y -= strong ? 18 : 14;
    };

    line('Subtotal', formatCents(subtotal));

    // Each tax is its own line. In a non-harmonised province GST and PST are
    // two different taxes remitted to two different governments, and an
    // invoice that blends them into one number is not a usable record for
    // either side.
    const taxes = order.taxLines ?? [];
    for (const t of taxes) line(t.label, formatCents(t.amountCents));
    const tax = taxes.reduce((sum, t) => sum + t.amountCents, 0);

    s.y -= 2;
    rule(s, 0.8, hair, labelX, RIGHT);
    s.y -= 14;
    line('Total', formatCents(subtotal + tax), true);

    // Registration numbers only where tax was actually charged. Printing them
    // under an untaxed total implies tax was collected when it was not.
    if (taxes.length > 0) {
      for (const n of (order.taxNumbers ?? []).filter(Boolean)) {
        textAt(s, n as string, labelX, s.y, 7.5, s.font, gray);
        s.y -= 11;
      }
    }
    if (order.exemptionNote) {
      textAt(s, order.exemptionNote, labelX, s.y, 7.5, s.font, gray);
      s.y -= 11;
    }
    const unpriced = order.lines.filter((l) => l.unitCents === null).length;
    if (unpriced > 0) {
      s.y -= 4;
      text(s, `${unpriced} line(s) not yet priced — the parts desk will confirm.`, M, 8.5, s.font, gray);
      s.y -= 12;
    }
  }

  if (order.note) {
    s.y -= 10;
    if (s.y < 90) nextPage(s, header);
    text(s, 'NOTE', M, 7.5, s.bold, gray);
    s.y -= 13;
    for (const l of wrap(order.note, 9.5, s.font, RIGHT - M)) {
      text(s, l, M, 9.5);
      s.y -= 12;
      if (s.y < 60) nextPage(s, header);
    }
  }

  // Footing
  textAt(s, 'No payment is taken online — invoiced on your account terms.', M, 52, 8, s.font, gray);

  return render(s);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pick list
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The warehouse copy, designed for the job it does: somebody walking shelves
 * with a sheet of paper and a pen.
 *
 * Every choice here follows from that. The part code is the biggest thing on
 * the line, because that is what is printed on the box. Quantity and unit sit
 * together in a bold block, because "6" alone is how six cases get picked
 * instead of six pieces. Lines are grouped by location so the walk runs in one
 * direction instead of zig-zagging. There is a tick box per line and a ruled
 * column to write a short or a substitute, because that is what actually
 * happens and it should not end up on the back of a hand.
 *
 * No prices. A picker does not need them and a supplier must not see them.
 */
export async function buildPickList(order: DocOrder): Promise<Buffer> {
  const s = await newSheet();

  const header = (sheet: Sheet) =>
    letterhead(sheet, 'Pick list', order, order.fulfilledByLabel ?? undefined);
  header(s);
  if (order.rush) rushBanner(s);

  metaRow(s, [
    ['For', order.customerName],
    ['Shipping', order.shippingMethod ?? 'Not specified'],
    ['Pieces', String(order.lines.reduce((t, l) => t + l.quantity, 0))],
  ]);

  if (order.jobRef) {
    text(s, `Service job ${order.jobRef}`, M, 9.5, s.bold);
    s.y -= 14;
  }
  rule(s, 1, navy);
  s.y -= 16;

  // Group by location so the picker walks the shelves in order.
  const groups = new Map<string, DocLine[]>();
  for (const l of order.lines) {
    const key = l.location || 'Other';
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const ordered = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const TICK_X = M;
  const CODE_X = M + 26;
  const NAME_X = M + 150;
  const QTY_X = RIGHT - 128;
  const NOTE_X = RIGHT - 70;
  const nameW = QTY_X - NAME_X - 12;

  const tableHead = (sheet: Sheet) => {
    textAt(sheet, 'ITEM #', CODE_X, sheet.y, 7.5, sheet.bold, gray);
    textAt(sheet, 'DESCRIPTION', NAME_X, sheet.y, 7.5, sheet.bold, gray);
    textAt(sheet, 'QTY', QTY_X, sheet.y, 7.5, sheet.bold, gray);
    textAt(sheet, 'SHORT / SUB', NOTE_X, sheet.y, 7.5, sheet.bold, gray);
    sheet.y -= 7;
    rule(sheet, 0.8, gray);
    sheet.y -= 4;
  };
  tableHead(s);

  for (const [location, lines] of ordered) {
    if (s.y < 130) nextPage(s, (sheet) => { header(sheet); tableHead(sheet); });

    // Location band — where to walk next.
    s.y -= 14;
    box(s, M, s.y - 4, RIGHT - M, 16, { fill: wash });
    textAt(s, location.toUpperCase(), M + 6, s.y + 1, 8.5, s.bold, navy);
    const count = `${lines.length} line${lines.length === 1 ? '' : 's'}`;
    textAt(s, count, RIGHT - 6 - s.font.widthOfTextAtSize(count, 8), s.y + 1, 8, s.font, gray);
    s.y -= 20;

    for (const l of lines) {
      if (s.y < 90) nextPage(s, (sheet) => { header(sheet); tableHead(sheet); });

      // Tick box, sized to be tickable with a pen.
      box(s, TICK_X, s.y - 3, 13, 13, { border: gray, width: 0.9 });

      text(s, clip(l.code ?? '—', 11, s.bold, NAME_X - CODE_X - 10), CODE_X, 11, s.bold);
      if (l.altCode && l.altCode !== l.code) {
        // The other number that might be on the box in front of them.
        textAt(s, clip(l.altCode, 7.5, s.font, NAME_X - CODE_X - 10), CODE_X, s.y - 10, 7.5, s.font, gray);
      }
      textAt(s, clip(l.name, 9, s.font, nameW), NAME_X, s.y, 9);

      // Quantity is the thing that gets got wrong, so it is the loudest.
      textAt(s, String(l.quantity), QTY_X, s.y - 1, 14, s.bold);
      if (l.unit) {
        textAt(s, clip(l.unit, 7.5, s.font, 58), QTY_X + 22, s.y, 7.5, s.font, gray);
      }

      // A ruled space to write in, rather than the back of a hand.
      s.page.drawLine({
        start: { x: NOTE_X, y: s.y - 4 },
        end: { x: RIGHT, y: s.y - 4 },
        thickness: 0.5,
        color: hair,
      });

      s.y -= l.altCode && l.altCode !== l.code ? 26 : 22;
      rule(s);
      s.y -= 6;
    }
  }

  // Sign-off
  s.y -= 14;
  if (s.y < 90) nextPage(s, header);
  const third = (RIGHT - M) / 3;
  for (const [i, label] of ['PICKED BY', 'CHECKED BY', 'DATE'].entries()) {
    const x = M + i * third;
    s.page.drawLine({
      start: { x, y: s.y }, end: { x: x + third - 20, y: s.y },
      thickness: 0.7, color: gray,
    });
    textAt(s, label, x, s.y - 11, 7.5, s.bold, gray);
  }
  s.y -= 26;

  if (order.note) {
    text(s, 'NOTE FROM THE ORDER', M, 7.5, s.bold, gray);
    s.y -= 13;
    for (const l of wrap(order.note, 9.5, s.font, RIGHT - M)) {
      text(s, l, M, 9.5);
      s.y -= 12;
    }
  }

  return render(s);
}

// ─────────────────────────────────────────────────────────────────────────────
// Packing slip
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Goes in the box. What is inside and who it is for — no money, because the
 * person opening the carton is not the person paying the invoice, and a price
 * on a slip that travels with the goods is how a dealer's customer sees it.
 */
export async function buildPackingSlip(order: DocOrder): Promise<Buffer> {
  const s = await newSheet();

  const header = (sheet: Sheet) => letterhead(sheet, 'Packing slip', order, 'Parts order');
  header(s);
  if (order.rush) rushBanner(s);

  const blockTop = s.y;
  const end = addressBlock(
    s, 'SHIP TO', order.shipTo.name ?? order.customerName,
    [...order.shipTo.lines, order.shipTo.phone], M, blockTop, (RIGHT - M) / 2 - 16,
  );
  textAt(s, 'SHIPPING', M + (RIGHT - M) / 2, blockTop, 7.5, s.bold, gray);
  textAt(
    s, order.shippingMethod ?? 'Not specified',
    M + (RIGHT - M) / 2, blockTop - 13, 10.5, s.bold, navy,
  );
  if (order.jobRef) {
    textAt(s, `Service job ${order.jobRef}`, M + (RIGHT - M) / 2, blockTop - 29, 9.5, s.bold);
  }
  s.y = end - 14;

  rule(s, 1, navy);
  s.y -= 16;

  const CODE_X = M;
  const NAME_X = M + 120;
  const QTY_X = RIGHT - 90;

  const tableHead = (sheet: Sheet) => {
    textAt(sheet, 'ITEM #', CODE_X, sheet.y, 7.5, sheet.bold, gray);
    textAt(sheet, 'DESCRIPTION', NAME_X, sheet.y, 7.5, sheet.bold, gray);
    textAt(sheet, 'QTY', QTY_X, sheet.y, 7.5, sheet.bold, gray);
    sheet.y -= 7;
    rule(sheet);
    sheet.y -= 14;
  };
  tableHead(s);

  let pieces = 0;
  for (const l of order.lines) {
    if (s.y < 110) nextPage(s, (sheet) => { header(sheet); tableHead(sheet); });
    pieces += l.quantity;
    text(s, clip(l.code ?? '—', 9.5, s.bold, NAME_X - CODE_X - 8), CODE_X, 9.5, s.bold);
    textAt(s, clip(l.name, 9.5, s.font, QTY_X - NAME_X - 12), NAME_X, s.y, 9.5);
    textAt(s, String(l.quantity), QTY_X, s.y, 10.5, s.bold);
    if (l.unit) textAt(s, clip(l.unit, 7.5, s.font, 60), QTY_X + 22, s.y, 7.5, s.font, gray);
    s.y -= 7;
    rule(s);
    s.y -= 13;
  }

  s.y -= 6;
  right(s, `Total pieces: ${pieces}`, 10, s.bold);
  s.y -= 20;

  if (order.note) {
    text(s, 'NOTE', M, 7.5, s.bold, gray);
    s.y -= 13;
    for (const l of wrap(order.note, 9.5, s.font, RIGHT - M)) {
      text(s, l, M, 9.5);
      s.y -= 12;
    }
  }

  textAt(s, 'Anything missing or damaged? Call the parts desk and quote this order number.', M, 52, 8, s.font, gray);

  return render(s);
}
