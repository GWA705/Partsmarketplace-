import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { prisma } from '@/lib/db';
import { dealerPartSelect, staffPartSelect, fillerLabel } from '@/lib/partSelect';
import { loadPricingContext, dealerPrice } from '@/lib/pricing';
import { formatCents } from '@/lib/money';
import Shell from '@/components/Shell';
import CartLines, { type CartRow } from './CartLines';
import CheckoutForm from './CheckoutForm';

export const dynamic = 'force-dynamic';

export default async function CartPage() {
  const user = await requireUser();
  const isDealer = user.kind === 'DEALER';

  const lines = await prisma.cartLine.findMany({
    where: { userId: user.userId },
    orderBy: { createdAt: 'asc' },
  });

  if (lines.length === 0) {
    return (
      <Shell user={user} cartCount={0}>
        <div className="card p-10 text-center max-w-lg mx-auto">
          <h1 className="text-lg font-semibold">Your cart is empty</h1>
          <p className="text-sm text-muted mt-1">
            Search the catalogue and add what you need, or reorder from a past order.
          </p>
          <div className="mt-4 flex gap-2 justify-center">
            <Link href={isDealer ? '/catalogue' : '/staff'} className="btn btn-primary">
              Search the catalogue
            </Link>
            <Link href="/orders" className="btn">Past orders</Link>
          </div>
        </div>
      </Shell>
    );
  }

  const [parts, ctx] = await Promise.all([
    prisma.part.findMany({
      where: { id: { in: lines.map((l) => l.partId) } },
      select: isDealer ? dealerPartSelect : staffPartSelect,
    }),
    loadPricingContext(),
  ]);
  const byId = new Map(parts.map((p) => [p.id, p]));

  const rows: CartRow[] = lines
    .map((l) => {
      const p = byId.get(l.partId);
      if (!p) return null;
      const cost = 'costCents' in p ? (p.costCents as number | null) : null;
      const vendor = 'vendor' in p ? (p.vendor as string | null) : null;
      const price = isDealer
        ? dealerPrice(
            {
              costCents: cost,
              dealerCents: p.dealerCents,
              priceOverridden: p.priceOverridden,
              categoryId: p.categoryId,
              vendor,
              segmentCode: p.segmentCode,
            },
            user.dealerTier,
            ctx,
          )
        : cost;
      return {
        partId: p.id,
        code: p.code,
        name: p.catalogueName || p.name,
        unit: p.unit,
        quantity: l.quantity,
        priceCents: price,
        hasImage: !!p.imageStorageKey,
        fillerLabel: fillerLabel(p.fulfilledBy, vendor, isDealer ? 'DEALER' : 'STAFF'),
      } satisfies CartRow;
    })
    .filter((r): r is CartRow => r !== null);

  const total = rows.reduce(
    (sum, r) => (r.priceCents === null ? sum : sum + r.priceCents * r.quantity),
    0,
  );
  const anyUnpriced = rows.some((r) => r.priceCents === null);

  // Tell the dealer up front that their order will arrive in more than one
  // delivery — finding out from two separate couriers is how a support call
  // starts. It says HOW MANY deliveries, never who is sending them: naming the
  // suppliers here would hand over the list a row at a time.
  const deliveries = new Set(rows.map((r) => r.fillerLabel)).size;
  const splitNote =
    deliveries > 1
      ? `This order will come in ${deliveries} deliveries — some items ship direct — so it may arrive on different days.`
      : null;

  return (
    <Shell user={user} cartCount={rows.length}>
      <h1 className="text-lg font-semibold mb-4">
        Your order <span className="text-muted font-normal">({rows.length} lines)</span>
      </h1>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0 space-y-3">
          <CartLines rows={rows} />
          <Link href={isDealer ? '/catalogue' : '/staff'} className="btn text-sm">
            ← Keep adding parts
          </Link>
        </div>

        <div className="w-full lg:w-80 shrink-0 space-y-3">
          <div className="card p-4">
            <div className="flex justify-between items-baseline">
              <span className="text-sm text-muted">{isDealer ? 'Total' : 'Cost'}</span>
              <span className="text-xl font-bold tabular">{formatCents(total)}</span>
            </div>
            {anyUnpriced ? (
              <p className="text-[11px] text-muted mt-2">
                Some lines have no price yet; the parts desk will confirm them.
              </p>
            ) : null}
          </div>

          <CheckoutForm isDealer={isDealer} splitNote={splitNote} />
        </div>
      </div>
    </Shell>
  );
}
