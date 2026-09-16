import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/session';
import { buildPickList } from '@/lib/documents';
import { loadOrderDocument, documentFilename } from '@/lib/orderDocuments';

/**
 * The pick list for one shipment.
 *
 * Staff only. It is the warehouse's working copy — it carries the supplier's
 * name and the walk order, neither of which is a dealer's business.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  // Not requireStaff(): that redirects, which is right for a page and wrong
  // for a file download. A dealer asking for a pick list gets a flat no.
  const user = await getSessionUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });
  if (user.kind !== 'STAFF') return new NextResponse('Not found', { status: 404 });

  const shipment = await prisma.shipment.findUnique({
    where: { id: params.id },
    select: { orderId: true, vendor: true, fulfilledBy: true, order: { select: { number: true } } },
  });
  if (!shipment) return new NextResponse('Not found', { status: 404 });

  const doc = await loadOrderDocument({
    orderId: shipment.orderId,
    shipmentId: params.id,
    audience: 'STAFF',
  });
  if (!doc) return new NextResponse('Not found', { status: 404 });

  const pdf = await buildPickList(doc);
  const who = shipment.fulfilledBy === 'HEAD_OFFICE' ? 'head-office' : shipment.vendor;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${documentFilename('pick-list', shipment.order.number, who)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
