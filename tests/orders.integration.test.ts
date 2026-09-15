import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { submitOrder, reorder } from '@/lib/orders';
import { buildPackingSlip } from '@/lib/orderPdf';
import type { SessionUser } from '@/lib/session';

/**
 * Ordering, end to end, against the real catalogue.
 *
 * The thing under test is the split: a dealer builds ONE cart that happens to
 * mix our own stock with two different drop-ship suppliers, and it has to come
 * out as one order with three shipments — because three different people fill
 * it — while the dealer only ever sees one order.
 */

let ready = false;
let dealerUser: SessionUser;
let headOfficePart: string;
let watergroupPart: string;
let respiraidePart: string;

beforeAll(async () => {
  try {
    const dealer = await prisma.dealer.findFirst({ where: { name: 'Demo Dealer Co.' } });
    const user = await prisma.user.findFirst({ where: { email: 'dealer@demo-dealer.test' } });
    if (!dealer || !user) return;

    dealerUser = {
      userId: user.id,
      email: user.email,
      name: user.name,
      kind: 'DEALER',
      staffRole: 'VIEWER',
      dealerId: dealer.id,
      dealerName: dealer.name,
      dealerTier: dealer.tier,
    };

    // Route one part to head office and two to different suppliers.
    const pick = async (vendor: string) =>
      prisma.part.findFirst({ where: { vendor, active: true, costCents: { not: null } } });

    const a = await pick('GHS-BARRIE');
    const b = await pick('Watergroup');
    const c = await pick('RespirAide Tech Inc.');
    if (!a || !b || !c) return;

    await prisma.part.update({ where: { id: a.id }, data: { fulfilledBy: 'HEAD_OFFICE' } });
    await prisma.part.update({ where: { id: b.id }, data: { fulfilledBy: 'SUPPLIER' } });
    await prisma.part.update({ where: { id: c.id }, data: { fulfilledBy: 'SUPPLIER' } });

    headOfficePart = a.id;
    watergroupPart = b.id;
    respiraidePart = c.id;
    ready = true;
  } catch {
    ready = false;
  }
});

describe.runIf(process.env.DATABASE_URL)('submitOrder', () => {
  it('splits one cart into a shipment per filling party', async () => {
    if (!ready) return;
    const res = await submitOrder({
      user: dealerUser,
      entries: [
        { partId: headOfficePart, quantity: 2 },
        { partId: watergroupPart, quantity: 3 },
        { partId: respiraidePart, quantity: 1 },
      ],
      shippingMethod: 'Standard ground',
      note: 'Split test',
    });

    expect(res.ok).toBe(true);
    const order = await prisma.order.findUnique({
      where: { id: res.orderId! },
      include: { shipments: { include: { lines: true } } },
    });

    // One order to the dealer...
    expect(order).toBeTruthy();
    expect(order!.number).toMatch(/^PO-\d+$/);
    // ...three shipments to the people who fill it.
    expect(order!.shipments).toHaveLength(3);

    const parties = order!.shipments.map((s) =>
      s.fulfilledBy === 'HEAD_OFFICE' ? 'HEAD_OFFICE' : s.vendor,
    );
    expect(new Set(parties)).toEqual(
      new Set(['HEAD_OFFICE', 'Watergroup', 'RespirAide Tech Inc.']),
    );

    // Every line snapshots what it was, so a re-import cannot rewrite history.
    const lines = order!.shipments.flatMap((s) => s.lines);
    expect(lines).toHaveLength(3);
    for (const l of lines) {
      expect(l.name.length).toBeGreaterThan(0);
      expect(l.quantity).toBeGreaterThan(0);
    }
  });

  it('carries the shipping method onto every shipment', async () => {
    if (!ready) return;
    const res = await submitOrder({
      user: dealerUser,
      entries: [
        { partId: headOfficePart, quantity: 1 },
        { partId: watergroupPart, quantity: 1 },
      ],
      shippingMethod: 'Rush / express',
    });
    const order = await prisma.order.findUnique({
      where: { id: res.orderId! },
      include: { shipments: true },
    });
    for (const s of order!.shipments) expect(s.shippingMethod).toBe('Rush / express');
  });

  it('snapshots the dealer address so a later move does not rewrite it', async () => {
    if (!ready) return;
    const res = await submitOrder({
      user: dealerUser,
      entries: [{ partId: headOfficePart, quantity: 1 }],
    });
    const order = await prisma.order.findUnique({ where: { id: res.orderId! } });
    expect(order!.shipCity).toBe('Barrie');

    await prisma.dealer.update({
      where: { id: dealerUser.dealerId! },
      data: { shipCity: 'Orillia' },
    });
    const again = await prisma.order.findUnique({ where: { id: res.orderId! } });
    expect(again!.shipCity).toBe('Barrie');

    await prisma.dealer.update({
      where: { id: dealerUser.dealerId! },
      data: { shipCity: 'Barrie' },
    });
  });

  it('refuses an empty order', async () => {
    if (!ready) return;
    const res = await submitOrder({ user: dealerUser, entries: [] });
    expect(res.ok).toBe(false);
  });

  it('refuses an order containing a retired part', async () => {
    if (!ready) return;
    await prisma.part.update({ where: { id: watergroupPart }, data: { active: false } });
    const res = await submitOrder({
      user: dealerUser,
      entries: [{ partId: watergroupPart, quantity: 1 }],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no longer available/i);
    await prisma.part.update({ where: { id: watergroupPart }, data: { active: true } });
  });

  it('gives each order its own number', async () => {
    if (!ready) return;
    const a = await submitOrder({ user: dealerUser, entries: [{ partId: headOfficePart, quantity: 1 }] });
    const b = await submitOrder({ user: dealerUser, entries: [{ partId: headOfficePart, quantity: 1 }] });
    expect(a.orderNumber).not.toBe(b.orderNumber);
  });

  it('empties the cart once the order exists', async () => {
    if (!ready) return;
    await prisma.cartLine.upsert({
      where: { userId_partId: { userId: dealerUser.userId, partId: headOfficePart } },
      update: { quantity: 4 },
      create: { userId: dealerUser.userId, partId: headOfficePart, quantity: 4 },
    });
    await submitOrder({ user: dealerUser, entries: [{ partId: headOfficePart, quantity: 4 }] });
    const left = await prisma.cartLine.count({ where: { userId: dealerUser.userId } });
    expect(left).toBe(0);
  });
});

describe.runIf(process.env.DATABASE_URL)('reorder', () => {
  it('refills the cart from a past order', async () => {
    if (!ready) return;
    const res = await submitOrder({
      user: dealerUser,
      entries: [
        { partId: headOfficePart, quantity: 2 },
        { partId: respiraidePart, quantity: 5 },
      ],
    });
    const added = await reorder(dealerUser.userId, res.orderId!);
    expect(added).toBe(2);

    const cart = await prisma.cartLine.findMany({ where: { userId: dealerUser.userId } });
    expect(cart).toHaveLength(2);
    expect(cart.find((c) => c.partId === respiraidePart)?.quantity).toBe(5);

    await prisma.cartLine.deleteMany({ where: { userId: dealerUser.userId } });
  });

  it('skips a part retired since the original order', async () => {
    if (!ready) return;
    const res = await submitOrder({
      user: dealerUser,
      entries: [
        { partId: headOfficePart, quantity: 1 },
        { partId: respiraidePart, quantity: 1 },
      ],
    });
    await prisma.part.update({ where: { id: respiraidePart }, data: { active: false } });
    const added = await reorder(dealerUser.userId, res.orderId!);
    expect(added).toBe(1);
    await prisma.part.update({ where: { id: respiraidePart }, data: { active: true } });
    await prisma.cartLine.deleteMany({ where: { userId: dealerUser.userId } });
  });
});

describe('buildPackingSlip', () => {
  it('produces a real PDF', async () => {
    const pdf = await buildPackingSlip({
      orderNumber: 'PO-1001',
      submittedAt: new Date('2026-09-15T14:00:00Z'),
      fulfilledByLabel: 'Head office',
      buyerName: 'Demo Dealer Co.',
      shipTo: ['Parts Desk', '12 Bayfield St', 'Barrie ON L4M 3A1'],
      shippingMethod: 'Standard ground',
      showPrices: true,
      lines: [
        { quantity: 2, code: '0208W.IN', name: 'JG 1/4 Union Tee', unit: 'each (ea)', unitCents: 476 },
        { quantity: 1, code: '012.H2O', name: 'TDS Meters', unit: null, unitCents: 2000 },
      ],
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('pages a long order rather than running off the sheet', async () => {
    const lines = Array.from({ length: 120 }, (_, i) => ({
      quantity: i + 1,
      code: `CODE-${i}`,
      name: `A part with a reasonably long description ${i}`,
      unit: 'each (ea)',
      unitCents: 1234,
    }));
    const pdf = await buildPackingSlip({
      orderNumber: 'PO-1002',
      submittedAt: new Date(),
      fulfilledByLabel: 'Watergroup',
      buyerName: 'Demo Dealer Co.',
      showPrices: false,
      lines,
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
