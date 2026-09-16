import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/session';
import { buildInvoice } from '@/lib/documents';
import { loadOrderDocument, documentFilename } from '@/lib/orderDocuments';

/**
 * The invoice for a whole order.
 *
 *   /api/orders/<id>/invoice            priced, when dealer pricing is live
 *   /api/orders/<id>/invoice?priced=0   the same sheet as an order confirmation
 *
 * While prices are still being settled it falls back to the unpriced
 * confirmation by itself, so nobody can print a total built on a markup that
 * has not been signed off.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: { dealerId: true, number: true },
  });
  if (!order) return new NextResponse('Not found', { status: 404 });
  if (user.kind === 'DEALER' && order.dealerId !== user.dealerId) {
    return new NextResponse('Not found', { status: 404 });
  }

  const settings = await prisma.pricingSettings.findUnique({ where: { id: 'default' } });
  const asked = new URL(request.url).searchParams.get('priced') !== '0';
  // Staff can always see the money; a dealer only once prices are switched on.
  const priced = asked && (user.kind === 'STAFF' || !!settings?.pricesVisibleToDealers);

  const doc = await loadOrderDocument({
    orderId: params.id,
    audience: user.kind === 'DEALER' ? 'DEALER' : 'STAFF',
  });
  if (!doc) return new NextResponse('Not found', { status: 404 });

  const pdf = await buildInvoice(doc, { priced });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${documentFilename(priced ? 'invoice' : 'order', order.number)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
