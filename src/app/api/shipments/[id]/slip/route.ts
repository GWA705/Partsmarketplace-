import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/session';
import { buildPackingSlip } from '@/lib/documents';
import { loadOrderDocument, documentFilename } from '@/lib/orderDocuments';

/**
 * The packing slip for one shipment — the sheet that goes in the box.
 *
 * A dealer may print their own; it never names the supplier filling it, and it
 * carries no prices, because the person opening the carton is not the person
 * paying the invoice.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  const shipment = await prisma.shipment.findUnique({
    where: { id: params.id },
    select: {
      orderId: true, vendor: true, fulfilledBy: true,
      order: { select: { number: true, dealerId: true } },
    },
  });
  if (!shipment) return new NextResponse('Not found', { status: 404 });
  if (user.kind === 'DEALER' && shipment.order.dealerId !== user.dealerId) {
    return new NextResponse('Not found', { status: 404 });
  }

  const doc = await loadOrderDocument({
    orderId: shipment.orderId,
    shipmentId: params.id,
    audience: user.kind === 'DEALER' ? 'DEALER' : 'STAFF',
  });
  if (!doc) return new NextResponse('Not found', { status: 404 });

  const pdf = await buildPackingSlip(doc);
  const who =
    user.kind === 'DEALER'
      ? null
      : shipment.fulfilledBy === 'HEAD_OFFICE'
        ? 'head-office'
        : shipment.vendor;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${documentFilename('packing-slip', shipment.order.number, who)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
