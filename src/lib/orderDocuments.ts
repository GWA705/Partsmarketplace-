import 'server-only';
import { prisma } from '@/lib/db';
import { fillerLabel } from '@/lib/partSelect';
import type { DocOrder, DocLine } from '@/lib/documents';

/**
 * Turning a stored order into the data a document prints.
 *
 * One loader for all three documents, because the audience rules have to be
 * applied in exactly one place: a supplier must never see the dealer's price,
 * and a dealer must never see which supplier is filling their order. Deciding
 * that per-document is how one of them eventually gets it wrong.
 */

export type Audience = 'DEALER' | 'STAFF' | 'SUPPLIER';

const addressLines = (
  line1: string | null, line2: string | null,
  city: string | null, province: string | null, postal: string | null,
  country: string | null,
) => [line1, line2, [city, province, postal].filter(Boolean).join(' '), country];

export interface LoadOptions {
  orderId: string;
  /** Limit the lines to one shipment — what a pick list and slip cover. */
  shipmentId?: string;
  audience: Audience;
}

export async function loadOrderDocument(opts: LoadOptions): Promise<DocOrder | null> {
  const order = await prisma.order.findUnique({
    where: { id: opts.orderId },
    include: {
      dealer: true,
      taxes: { orderBy: { sortOrder: 'asc' } },
      shipments: { include: { lines: { include: { part: { select: { catalogueCode: true, segment: { select: { label: true, code: true } } } } } } } },
    },
  });
  if (!order) return null;

  const settings = await prisma.pricingSettings.findUnique({ where: { id: 'default' } });

  const shipments = opts.shipmentId
    ? order.shipments.filter((s) => s.id === opts.shipmentId)
    : order.shipments;
  if (opts.shipmentId && shipments.length === 0) return null;

  const lines: DocLine[] = shipments.flatMap((s) =>
    s.lines.map((l) => ({
      code: l.code,
      altCode: l.part?.catalogueCode ?? null,
      name: l.name,
      unit: l.unit,
      quantity: l.quantity,
      // A supplier gets no prices at all: the stored line holds what the DEALER
      // pays, which is our margin, so there is nothing here safe to show them.
      unitCents: opts.audience === 'SUPPLIER' ? null : l.unitCents,
      location: l.part?.segment?.label ?? l.part?.segment?.code ?? null,
    })),
  );

  // Only meaningful for a single-shipment document; an invoice covers them all.
  const one = shipments.length === 1 ? shipments[0] : null;
  const label = one
    ? fillerLabel(one.fulfilledBy, one.vendor, opts.audience === 'DEALER' ? 'DEALER' : 'STAFF')
    : null;

  const dealer = order.dealer;

  return {
    orderNumber: order.number,
    submittedAt: order.submittedAt,
    rush: order.rush,
    customerName: order.dealer?.name ?? 'GWA — internal',
    customerCode: order.dealer?.code ?? null,
    placedBy: order.placedByName,
    shippingMethod: one?.shippingMethod ?? order.shipments[0]?.shippingMethod ?? null,
    note: order.note,
    jobRef: order.jobRef,
    fulfilledByLabel: label,
    shipTo: {
      name: order.shipName,
      lines: addressLines(
        order.shipLine1, order.shipLine2, order.shipCity,
        order.shipProvince, order.shipPostal, order.shipCountry,
      ),
      phone: order.shipPhone,
    },
    billTo: {
      // Falls back to the shipping address rather than printing an empty block:
      // most dealers are billed where they are shipped, and the ones who are
      // not have their own address on file.
      name: order.billName ?? order.shipName,
      lines: order.billLine1
        ? addressLines(
            order.billLine1, order.billLine2, order.billCity,
            order.billProvince, order.billPostal, order.billCountry,
          )
        : addressLines(
            order.shipLine1, order.shipLine2, order.shipCity,
            order.shipProvince, order.shipPostal, order.shipCountry,
          ),
      email: order.billEmail ?? dealer?.billEmail ?? dealer?.contactEmail ?? null,
    },
    lines,
    // The frozen lines, not a fresh calculation: the invoice has to keep
    // saying what it said when it went out.
    taxLines: order.taxes.map((t) => ({ label: t.label, amountCents: t.amountCents })),
    taxNumbers: order.taxes.length
      ? [
          settings?.gstNumber ? `GST/HST ${settings.gstNumber}` : null,
          settings?.qstNumber ? `QST ${settings.qstNumber}` : null,
        ]
      : [],
    exemptionNote:
      dealer && (dealer.gstExempt || dealer.provincialExempt) && dealer.taxExemptNumber
        ? `Tax exemption ${dealer.taxExemptNumber}`
        : null,
  };
}

/** A filename somebody can find again in a downloads folder. */
export function documentFilename(
  kind: 'invoice' | 'pick-list' | 'packing-slip' | 'order',
  orderNumber: string,
  suffix?: string | null,
): string {
  const tail = suffix ? `-${suffix.replace(/\W+/g, '-').toLowerCase()}` : '';
  return `${orderNumber}-${kind}${tail}.pdf`;
}
