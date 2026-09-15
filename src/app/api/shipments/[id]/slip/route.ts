import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/session';
import { buildPackingSlip } from '@/lib/orderPdf';

/** The pick list, on demand — reprinted when the emailed one gets lost. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  const shipment = await prisma.shipment.findUnique({
    where: { id: params.id },
    include: { order: { include: { dealer: true } }, lines: true },
  });
  if (!shipment) return new NextResponse('Not found', { status: 404 });

  // A dealer may reprint their own order's slip and nobody else's.
  if (user.kind === 'DEALER' && shipment.order.dealerId !== user.dealerId) {
    return new NextResponse('Not found', { status: 404 });
  }

  const label =
    shipment.fulfilledBy === 'HEAD_OFFICE' ? 'Head office' : shipment.vendor ?? 'Supplier';
  const order = shipment.order;

  const pdf = await buildPackingSlip({
    orderNumber: order.number,
    submittedAt: order.submittedAt,
    fulfilledByLabel: label,
    buyerName: order.dealer?.name ?? 'GWA — internal',
    shipTo: [
      order.shipName,
      order.shipLine1,
      order.shipLine2,
      [order.shipCity, order.shipProvince, order.shipPostal].filter(Boolean).join(' '),
      order.shipCountry,
    ].filter((l): l is string => !!l),
    phone: order.shipPhone,
    submittedBy: order.placedByName,
    shippingMethod: shipment.shippingMethod,
    note: order.note,
    jobRef: order.jobRef,
    // A dealer reprinting sees their prices; staff see what the filler sees.
    showPrices: user.kind === 'DEALER' || shipment.fulfilledBy === 'HEAD_OFFICE',
    lines: shipment.lines.map((l) => ({
      quantity: l.quantity,
      code: l.code,
      name: l.name,
      unit: l.unit,
      unitCents: l.unitCents,
    })),
  });

  // Buffer -> Uint8Array: Node's Buffer is not in the DOM BodyInit union.
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${order.number}-${label.replace(/\W+/g, '-').toLowerCase()}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
