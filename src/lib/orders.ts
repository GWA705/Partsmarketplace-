import 'server-only';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { sendEmail } from '@/lib/email';
import { buildPickList, buildInvoice } from '@/lib/documents';
import { loadOrderDocument, documentFilename } from '@/lib/orderDocuments';
import { loadPricingContext, dealerPrice } from '@/lib/pricing';
import { formatCents } from '@/lib/money';
import type { SessionUser } from '@/lib/session';
import type { FulfilledBy } from '@prisma/client';

/**
 * Placing an order.
 *
 * A dealer builds one cart and submits once. Underneath, the order splits into
 * a shipment per filling party — head office for our own stock, one per
 * drop-ship supplier — because each of those is a different person pulling
 * different stock in a different building. The dealer never sees the split;
 * the people filling it see nothing else.
 *
 * Everything on a line is a snapshot. The price list gets reissued; yesterday's
 * order must still say what it said yesterday.
 */

export interface CartEntry {
  partId: string;
  quantity: number;
}

export interface SubmitResult {
  ok: boolean;
  orderId?: string;
  orderNumber?: string;
  error?: string;
  /** Per-shipment notification outcome, so the UI can be honest about email. */
  notifications?: { party: string; ok: boolean; error?: string }[];
}

/** Sequential order numbers, PO-1000 upward. */
async function nextOrderNumber(): Promise<string> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COALESCE(MAX(NULLIF(regexp_replace("number", '\\D', '', 'g'), '')::int), 999) + 1 AS n
    FROM "Order"
  `;
  return `PO-${rows[0]?.n ?? 1000}`;
}

/** "Head office" or the supplier's name — what the slip and email are titled. */
function partyLabel(fulfilledBy: FulfilledBy, vendor: string | null): string {
  return fulfilledBy === 'HEAD_OFFICE' ? 'Head office' : vendor || 'Supplier';
}

/** Where a party's pick list goes. */
async function contactFor(party: string): Promise<{ email: string; cc?: string } | null> {
  const row = await prisma.fulfillmentContact.findUnique({ where: { party } });
  if (row) return row.muted ? null : { email: row.email, cc: row.ccEmail ?? undefined };
  if (party === 'HEAD_OFFICE' && process.env.FULFILLMENT_EMAIL) {
    return { email: process.env.FULFILLMENT_EMAIL };
  }
  return null;
}

export async function submitOrder(opts: {
  user: SessionUser;
  entries: CartEntry[];
  shippingMethod?: string | null;
  note?: string | null;
  /** Ahead of everything else in the warehouse. Shouts on every document. */
  rush?: boolean;
  /** Internal orders only: the portal's service job number. */
  jobRef?: string | null;
}): Promise<SubmitResult> {
  const { user } = opts;
  const entries = opts.entries.filter((e) => e.quantity > 0);
  if (entries.length === 0) return { ok: false, error: 'The order is empty.' };

  const isDealer = user.kind === 'DEALER';
  if (isDealer && !user.dealerId) return { ok: false, error: 'No dealer on this account.' };

  const parts = await prisma.part.findMany({
    where: { id: { in: entries.map((e) => e.partId) } },
    select: {
      id: true, code: true, name: true, catalogueName: true, vendor: true, unit: true,
      costCents: true, dealerCents: true, priceOverridden: true, categoryId: true,
      segmentCode: true, fulfilledBy: true, active: true,
    },
  });
  const byId = new Map(parts.map((p) => [p.id, p]));

  const missing = entries.filter((e) => !byId.has(e.partId) || !byId.get(e.partId)!.active);
  if (missing.length) {
    return { ok: false, error: `${missing.length} item(s) are no longer available. Remove them and try again.` };
  }

  const ctx = await loadPricingContext();
  const dealer = user.dealerId
    ? await prisma.dealer.findUnique({ where: { id: user.dealerId } })
    : null;

  // ── Split by filling party ──
  const groups = new Map<string, { fulfilledBy: FulfilledBy; vendor: string | null; entries: CartEntry[] }>();
  for (const e of entries) {
    const p = byId.get(e.partId)!;
    // Head office is one queue; each drop-ship supplier is its own.
    const key = p.fulfilledBy === 'HEAD_OFFICE' ? 'HEAD_OFFICE' : `SUPPLIER:${p.vendor ?? ''}`;
    const g = groups.get(key) ?? {
      fulfilledBy: p.fulfilledBy,
      vendor: p.fulfilledBy === 'HEAD_OFFICE' ? null : p.vendor,
      entries: [],
    };
    g.entries.push(e);
    groups.set(key, g);
  }

  const number = await nextOrderNumber();

  const order = await prisma.order.create({
    data: {
      number,
      buyerKind: isDealer ? 'DEALER' : 'INTERNAL',
      dealerId: user.dealerId,
      placedById: user.userId,
      placedByName: user.name,
      jobRef: isDealer ? null : opts.jobRef ?? null,
      note: opts.note ?? null,
      rush: !!opts.rush,
      // Snapshot the address: a dealer moving next year must not rewrite this.
      shipName: dealer?.shipAttn || dealer?.name || null,
      shipLine1: dealer?.shipLine1 ?? null,
      shipLine2: dealer?.shipLine2 ?? null,
      shipCity: dealer?.shipCity ?? null,
      shipProvince: dealer?.shipProvince ?? null,
      shipPostal: dealer?.shipPostal ?? null,
      shipCountry: dealer?.shipCountry ?? null,
      shipPhone: dealer?.phone ?? null,
      // Bill-to snapshot. Blank here means "same as shipping", which the
      // document loader resolves — the fallback lives in one place.
      billName: dealer?.billAttn ?? dealer?.name ?? null,
      billLine1: dealer?.billLine1 ?? null,
      billLine2: dealer?.billLine2 ?? null,
      billCity: dealer?.billCity ?? null,
      billProvince: dealer?.billProvince ?? null,
      billPostal: dealer?.billPostal ?? null,
      billCountry: dealer?.billCountry ?? null,
      billEmail: dealer?.billEmail ?? dealer?.contactEmail ?? null,
      shipments: {
        create: [...groups.values()].map((g) => ({
          fulfilledBy: g.fulfilledBy,
          vendor: g.vendor,
          shippingMethod: opts.shippingMethod ?? null,
          lines: {
            create: g.entries.map((e) => {
              const p = byId.get(e.partId)!;
              // A dealer is charged their price; an internal order is costed.
              const unitCents = isDealer
                ? dealerPrice(
                    {
                      costCents: p.costCents,
                      dealerCents: p.dealerCents,
                      priceOverridden: p.priceOverridden,
                      categoryId: p.categoryId,
                      vendor: p.vendor,
                      segmentCode: p.segmentCode,
                    },
                    user.dealerTier,
                    ctx,
                  )
                : p.costCents;
              return {
                partId: p.id,
                code: p.code,
                name: p.catalogueName || p.name,
                vendor: p.vendor,
                unit: p.unit,
                unitCents,
                quantity: e.quantity,
              };
            }),
          },
        })),
      },
    },
    include: { shipments: { include: { lines: true } }, dealer: true },
  });

  // Clear the cart only once the order exists.
  await prisma.cartLine.deleteMany({ where: { userId: user.userId } });

  await audit({
    actorId: user.userId,
    actorName: user.name,
    action: 'order.submit',
    entity: 'Order',
    entityId: order.id,
    detail: `${order.number}: ${entries.length} line(s) across ${order.shipments.length} shipment(s)`,
  });

  // ── Notify each filling party ──
  const notifications: { party: string; ok: boolean; error?: string }[] = [];
  for (const shipment of order.shipments) {
    const party = shipment.fulfilledBy === 'HEAD_OFFICE' ? 'HEAD_OFFICE' : shipment.vendor ?? '';
    const label = partyLabel(shipment.fulfilledBy, shipment.vendor);
    const contact = await contactFor(party);

    if (!contact) {
      notifications.push({ party: label, ok: false, error: 'No fulfillment contact configured.' });
      continue;
    }

    // The filler gets a PICK LIST — the working document, laid out for
    // walking shelves. A supplier's copy carries no prices; that rule lives in
    // loadOrderDocument rather than being re-decided here.
    const doc = await loadOrderDocument({
      orderId: order.id,
      shipmentId: shipment.id,
      audience: shipment.fulfilledBy === 'HEAD_OFFICE' ? 'STAFF' : 'SUPPLIER',
    });
    if (!doc) {
      notifications.push({ party: label, ok: false, error: 'Could not build the pick list.' });
      continue;
    }
    const pdf = await buildPickList(doc);
    const showPrices = shipment.fulfilledBy === 'HEAD_OFFICE';
    const buyerName = isDealer ? order.dealer?.name ?? 'Dealer' : 'GWA — internal';

    const text = [
      `${order.number} — ${label}`,
      order.rush ? '*** RUSH ORDER ***' : null,
      '',
      `From:     ${buyerName}`,
      `Ordered:  ${order.placedByName}`,
      order.jobRef ? `Job:      ${order.jobRef}` : null,
      `Shipping: ${shipment.shippingMethod || 'Not specified'}`,
      '',
      ...shipment.lines.map(
        (l) =>
          `  ${String(l.quantity).padStart(4)} x ${(l.code ?? '—').padEnd(16)} ${l.name}` +
          (showPrices && l.unitCents !== null ? `  ${formatCents(l.unitCents)}` : ''),
      ),
      '',
      order.note ? `Note: ${order.note}` : null,
      '',
      'Pick list attached.',
    ]
      .filter((l) => l !== null)
      .join('\n');

    const sent = await sendEmail({
      to: contact.email,
      cc: contact.cc,
      subject: `${order.rush ? 'RUSH — ' : ''}${order.number} — parts order for ${buyerName}${order.shipments.length > 1 ? ` (${label})` : ''}`,
      text,
      attachments: [
        {
          filename: documentFilename('pick-list', order.number, label),
          content: pdf,
          contentType: 'application/pdf',
        },
      ],
    });

    await prisma.shipment.update({
      where: { id: shipment.id },
      data: sent.ok
        ? { notifiedAt: new Date(), notifiedTo: contact.email }
        : { notifiedTo: null },
    });

    notifications.push({ party: label, ok: sent.ok, error: sent.error });
  }

  // ── And a confirmation to the dealer, with their copy of the paperwork ──
  // They just placed an order on account; a piece of paper saying what they
  // ordered and where it is going is the least of it. The invoice prints
  // unpriced while dealer pricing is still being settled, so nobody is sent a
  // total built on a markup that has not been signed off.
  if (isDealer && order.dealer) {
    const to = order.dealer.billEmail || order.dealer.contactEmail;
    if (to) {
      const doc = await loadOrderDocument({ orderId: order.id, audience: 'DEALER' });
      if (doc) {
        const priced = ctx.settings.pricesVisibleToDealers;
        const invoice = await buildInvoice(doc, { priced });
        const deliveries = new Set(order.shipments.map((sh) => sh.id)).size;

        await sendEmail({
          to,
          subject: `${order.rush ? 'RUSH — ' : ''}${order.number} — we have your parts order`,
          text: [
            `Thanks — order ${order.number} is in.`,
            '',
            `Ordered by: ${order.placedByName}`,
            `Shipping:   ${opts.shippingMethod || 'Not specified'}`,
            order.rush ? 'Marked RUSH.' : null,
            deliveries > 1
              ? `It will come in ${deliveries} deliveries, so it may arrive on different days.`
              : null,
            '',
            ...order.shipments.flatMap((sh) =>
              sh.lines.map((l) => `  ${String(l.quantity).padStart(4)} x ${(l.code ?? '—').padEnd(16)} ${l.name}`),
            ),
            '',
            priced ? 'Your invoice is attached.' : 'Your order confirmation is attached; pricing follows separately.',
          ]
            .filter((l) => l !== null)
            .join('\n'),
          attachments: [
            {
              filename: documentFilename(priced ? 'invoice' : 'order', order.number),
              content: invoice,
              contentType: 'application/pdf',
            },
          ],
        });
      }
    }
  }

  return { ok: true, orderId: order.id, orderNumber: order.number, notifications };
}

/** Rebuild a cart from a past order — the reorder button. */
export async function reorder(userId: string, orderId: string): Promise<number> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { shipments: { include: { lines: true } } },
  });
  if (!order) return 0;

  const lines = order.shipments.flatMap((s) => s.lines);
  let added = 0;
  for (const l of lines) {
    if (!l.partId) continue;
    const part = await prisma.part.findUnique({
      where: { id: l.partId },
      select: { active: true },
    });
    // Silently drop anything retired since — the dealer sees the cart that
    // results, which is more honest than an error naming a part they cannot buy.
    if (!part?.active) continue;
    await prisma.cartLine.upsert({
      where: { userId_partId: { userId, partId: l.partId } },
      update: { quantity: { increment: l.quantity } },
      create: { userId, partId: l.partId, quantity: l.quantity },
    });
    added += 1;
  }
  return added;
}
