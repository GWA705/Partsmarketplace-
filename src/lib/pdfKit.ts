import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';

/**
 * The shared page furniture behind every document this app prints.
 *
 * Three documents come off one order — an invoice, a packing slip and a pick
 * list — and they have to look like they came from the same company. Anything
 * that decides how a page looks lives here once; each document decides only
 * what goes on it.
 *
 * pdf-lib rather than HTML-to-PDF, so there is no headless browser in the
 * deploy.
 */

export const PAGE = { w: 612, h: 792 } as const;
export const M = 48;
export const RIGHT = PAGE.w - M;
export const TOP = PAGE.h - 44;

export const ink = rgb(0.09, 0.1, 0.13);
export const navy = rgb(0.055, 0.169, 0.361);
export const gray = rgb(0.42, 0.45, 0.5);
export const hair = rgb(0.87, 0.89, 0.91);
export const alarm = rgb(0.72, 0.13, 0.09);
export const wash = rgb(0.95, 0.96, 0.97);

export interface Sheet {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  y: number;
}

export async function newSheet(): Promise<Sheet> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE.w, PAGE.h]);
  return { doc, font, bold, page, y: TOP };
}

export function text(
  s: Sheet,
  str: string,
  x: number,
  size = 10,
  f: PDFFont = s.font,
  color = ink,
): void {
  s.page.drawText(str, { x, y: s.y, size, font: f, color });
}

export function textAt(
  s: Sheet,
  str: string,
  x: number,
  y: number,
  size = 10,
  f: PDFFont = s.font,
  color = ink,
): void {
  s.page.drawText(str, { x, y, size, font: f, color });
}

export function right(
  s: Sheet,
  str: string,
  size = 10,
  f: PDFFont = s.font,
  color = ink,
  edge = RIGHT,
): void {
  s.page.drawText(str, { x: edge - f.widthOfTextAtSize(str, size), y: s.y, size, font: f, color });
}

export function rule(s: Sheet, thickness = 0.5, color = hair, from = M, to = RIGHT): void {
  s.page.drawLine({ start: { x: from, y: s.y }, end: { x: to, y: s.y }, thickness, color });
}

export function box(
  s: Sheet,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { fill?: ReturnType<typeof rgb>; border?: ReturnType<typeof rgb>; width?: number } = {},
): void {
  s.page.drawRectangle({
    x, y, width: w, height: h,
    color: opts.fill,
    borderColor: opts.border,
    borderWidth: opts.width ?? (opts.border ? 0.7 : 0),
  });
}

/** Trim a string to fit a width, with an ellipsis. */
export function clip(str: string, size: number, f: PDFFont, max: number): string {
  if (f.widthOfTextAtSize(str, size) <= max) return str;
  let out = str;
  while (out.length > 1 && f.widthOfTextAtSize(`${out}…`, size) > max) out = out.slice(0, -1);
  return `${out}…`;
}

/** Break a string into lines that fit a width. */
export function wrap(str: string, size: number, f: PDFFont, max: number): string[] {
  const lines: string[] = [];
  let buf = '';
  for (const word of str.split(/\s+/)) {
    const trial = buf ? `${buf} ${word}` : word;
    if (f.widthOfTextAtSize(trial, size) > max) {
      if (buf) lines.push(buf);
      buf = word;
    } else {
      buf = trial;
    }
  }
  if (buf) lines.push(buf);
  return lines;
}

/** Start a fresh page and run the caller's header on it. */
export function nextPage(s: Sheet, header?: (s: Sheet) => void): void {
  s.page = s.doc.addPage([PAGE.w, PAGE.h]);
  s.y = TOP;
  header?.(s);
}

/** A labelled address block. Returns the y it finished at. */
export function addressBlock(
  s: Sheet,
  label: string,
  name: string | null,
  lines: (string | null | undefined)[],
  x: number,
  top: number,
  width: number,
): number {
  let y = top;
  textAt(s, label, x, y, 7.5, s.bold, gray);
  y -= 13;
  if (name) {
    textAt(s, clip(name, 10.5, s.bold, width), x, y, 10.5, s.bold);
    y -= 12.5;
  }
  for (const l of lines.map((v) => (v ?? '').trim()).filter(Boolean).slice(0, 5)) {
    textAt(s, clip(l, 9.5, s.font, width), x, y, 9.5);
    y -= 11.5;
  }
  return y;
}

/** The red RUSH flash. Loud on purpose — it is the whole point of the flag. */
export function rushBanner(s: Sheet): void {
  const h = 20;
  box(s, M, s.y - h + 5, RIGHT - M, h, { fill: alarm });
  const label = 'RUSH ORDER — PRIORITISE';
  textAt(
    s,
    label,
    M + (RIGHT - M) / 2 - s.bold.widthOfTextAtSize(label, 11) / 2,
    s.y - h + 11,
    11,
    s.bold,
    rgb(1, 1, 1),
  );
  s.y -= h + 10;
}

export async function render(s: Sheet): Promise<Buffer> {
  return Buffer.from(await s.doc.save());
}
