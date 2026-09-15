import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import { formatCents } from '@/lib/money';

/**
 * Packing slip / pick list, one per shipment.
 *
 * Ported from the booking portal's marketplace slip and reworked for parts: the
 * person filling this is pulling numbered stock off a shelf, so the part code
 * is a first-class column rather than a footnote, and the quantity/unit pair
 * ("6 · Case (cs)") has to be unambiguous or they pick the wrong amount.
 *
 * pdf-lib, so there is no headless browser in the deploy.
 */

export interface PackingSlipLine {
  quantity: number;
  code: string | null;
  name: string;
  unit: string | null;
  unitCents: number | null;
}

export interface PackingSlipData {
  orderNumber: string;
  submittedAt: Date;
  /** "Head office" or the supplier's name. */
  fulfilledByLabel: string;
  buyerName: string;
  shipTo?: string[] | null;
  phone?: string | null;
  submittedBy?: string | null;
  shippingMethod?: string | null;
  note?: string | null;
  jobRef?: string | null;
  /** Dealer slips show price; a drop-ship PO to a supplier shows cost. */
  showPrices: boolean;
  lines: PackingSlipLine[];
}

const M = 54;
const RIGHT = 612 - M;
const TOP = 748;
const navy = rgb(0.055, 0.169, 0.361);
const gray = rgb(0.42, 0.45, 0.5);
const ink = rgb(0.1, 0.1, 0.12);
const hair = rgb(0.9, 0.91, 0.93);

export async function buildPackingSlip(data: PackingSlipData): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdf.addPage([612, 792]);
  let y = TOP;

  const text = (s: string, x: number, size = 10, f: PDFFont = font, color = ink) =>
    page.drawText(s, { x, y, size, font: f, color });
  const rightText = (s: string, size = 10, f: PDFFont = font, color = ink) =>
    page.drawText(s, { x: RIGHT - f.widthOfTextAtSize(s, size), y, size, font: f, color });
  const at = (s: string, x: number, size = 10, f: PDFFont = font, color = ink) =>
    page.drawText(s, { x, y, size, font: f, color });
  const rule = (thickness = 0.5, color = hair) =>
    page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness, color });
  const clip = (s: string, size: number, f: PDFFont, max: number) => {
    if (f.widthOfTextAtSize(s, size) <= max) return s;
    let out = s;
    while (out.length > 1 && f.widthOfTextAtSize(`${out}…`, size) > max) out = out.slice(0, -1);
    return `${out}…`;
  };

  const CODE_X = M;
  const NAME_X = M + 110;
  const QTY_X = RIGHT - 150;
  const PRICE_X = RIGHT - 70;
  const NAME_W = QTY_X - NAME_X - 10;

  const tableHead = () => {
    text('CODE', CODE_X, 8, bold, gray);
    at('DESCRIPTION', NAME_X, 8, bold, gray);
    at('QTY', QTY_X, 8, bold, gray);
    if (data.showPrices) at('PRICE', PRICE_X, 8, bold, gray);
    y -= 8;
    rule();
    y -= 14;
  };

  const newPage = () => {
    page = pdf.addPage([612, 792]);
    y = TOP;
    text(`${data.orderNumber} — continued`, M, 11, bold, navy);
    y -= 24;
    tableHead();
  };

  // ── Header ──
  text('Georgian Water & Air', M, 17, bold, navy);
  y -= 18;
  text('Parts Order — Pick List', M, 11, font, gray);
  y -= 14;
  const printed = data.submittedAt.toLocaleString('en-CA', {
    year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  text(`${data.orderNumber}  ·  ${printed}`, M, 9, font, gray);
  y -= 12;
  rule(1.5, navy);
  y -= 22;

  // ── Who fills it, and for whom ──
  text('FILLED BY', M, 8, bold, gray);
  at(data.fulfilledByLabel, M + 90, 11, bold, navy);
  y -= 20;

  text('SHIP TO', M, 8, bold, gray);
  y -= 15;
  text(clip(data.buyerName, 12, bold, RIGHT - M), M, 12, bold);
  y -= 15;
  const addr = (data.shipTo ?? []).map((l) => l.trim()).filter(Boolean).slice(0, 5);
  if (addr.length) {
    for (const l of addr) {
      text(clip(l, 10, font, RIGHT - M), M, 10);
      y -= 13;
    }
  } else if (!data.jobRef) {
    text('No address on file — confirm before shipping.', M, 10, font, gray);
    y -= 13;
  }
  if (data.phone) { text(`Phone: ${data.phone}`, M, 10); y -= 13; }
  if (data.jobRef) { text(`Service job: ${data.jobRef}`, M, 10, bold); y -= 13; }
  if (data.submittedBy) {
    text(`Ordered by: ${clip(data.submittedBy, 10, font, RIGHT - M)}`, M, 10, font, gray);
    y -= 13;
  }
  y -= 6;

  text('SHIPPING', M, 8, bold, gray);
  at(data.shippingMethod || 'Not specified', M + 90, 11, bold, navy);
  y -= 20;
  rule(1, navy);
  y -= 18;

  tableHead();

  // ── Lines ──
  let totalPieces = 0;
  let totalCents = 0;
  for (const l of data.lines) {
    if (y < 90) newPage();
    totalPieces += l.quantity;
    if (l.unitCents !== null) totalCents += l.unitCents * l.quantity;

    text(clip(l.code ?? '—', 9, bold, NAME_X - CODE_X - 8), CODE_X, 9, bold);
    at(clip(l.name, 9, font, NAME_W), NAME_X, 9);
    // Quantity and unit together — "6" alone is how the wrong amount gets
    // picked when the unit is a case of twelve.
    at(`${l.quantity}${l.unit ? ` · ${l.unit}` : ''}`, QTY_X, 9, bold);
    if (data.showPrices) at(formatCents(l.unitCents), PRICE_X, 9);
    y -= 7;
    rule();
    y -= 13;
  }

  y -= 6;
  if (y < 70) newPage();
  rightText(`Total pieces: ${totalPieces}`, 10, bold);
  y -= 15;
  if (data.showPrices && totalCents > 0) {
    rightText(`Total: ${formatCents(totalCents)}`, 11, bold, navy);
    y -= 20;
  }

  if (data.note) {
    if (y < 90) newPage();
    text('NOTE', M, 8, bold, gray);
    y -= 15;
    let buf = '';
    const flush = () => { if (buf) { text(buf, M, 10); y -= 13; buf = ''; } };
    for (const w of data.note.split(/\s+/)) {
      const trial = buf ? `${buf} ${w}` : w;
      if (font.widthOfTextAtSize(trial, 10) > RIGHT - M) { flush(); buf = w; }
      else buf = trial;
      if (y < 70) { flush(); newPage(); }
    }
    flush();
  }

  return Buffer.from(await pdf.save());
}
