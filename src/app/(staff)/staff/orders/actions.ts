'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireStaff } from '@/lib/session';
import { audit } from '@/lib/audit';
import type { ShipmentStatus } from '@prisma/client';

/**
 * Move a shipment along. The parent order's status is derived from its
 * shipments rather than set by hand — an order is only shipped when every part
 * of it is, and "partially fulfilled" is a real state a dealer needs to see
 * when their order went to three different fillers.
 */
export async function setShipmentStatus(
  shipmentId: string,
  status: ShipmentStatus,
): Promise<void> {
  const user = await requireStaff('ORDERER');

  const shipment = await prisma.shipment.update({
    where: { id: shipmentId },
    data: {
      status,
      fulfilledAt: status === 'FULFILLED' ? new Date() : null,
    },
    select: { orderId: true },
  });

  const siblings = await prisma.shipment.findMany({
    where: { orderId: shipment.orderId },
    select: { status: true },
  });

  const live = siblings.filter((s) => s.status !== 'CANCELLED');
  const orderStatus =
    live.length === 0
      ? 'CANCELLED'
      : live.every((s) => s.status === 'FULFILLED')
        ? 'FULFILLED'
        : live.some((s) => s.status === 'FULFILLED')
          ? 'PARTIALLY_FULFILLED'
          : live.every((s) => s.status === 'ACKNOWLEDGED')
            ? 'ACKNOWLEDGED'
            : 'SUBMITTED';

  await prisma.order.update({
    where: { id: shipment.orderId },
    data: { status: orderStatus },
  });

  await audit({
    actorId: user.userId,
    actorName: user.name,
    action: 'shipment.status',
    entity: 'Shipment',
    entityId: shipmentId,
    detail: `${status} (order now ${orderStatus})`,
  });

  revalidatePath('/staff/orders');
  revalidatePath(`/orders/${shipment.orderId}`);
}
