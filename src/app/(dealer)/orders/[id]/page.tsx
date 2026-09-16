import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { prisma } from '@/lib/db';
import { formatCents } from '@/lib/money';
import Shell from '@/components/Shell';
import { fillerLabel } from '@/lib/partSelect';
import ReorderButton from '../ReorderButton';

export const dynamic = 'force-dynamic';

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { placed?: string };
}) {
  const user = await requireUser();

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: { shipments: { include: { lines: true } }, dealer: true },
  });

  if (!order) notFound();
  // A dealer sees their own company's orders; staff see everything.
  if (user.kind === 'DEALER' && order.dealerId !== user.dealerId) notFound();

  const allLines = order.shipments.flatMap((s) => s.lines);
  const total = allLines.reduce((sum, l) => sum + (l.unitCents ?? 0) * l.quantity, 0);
  const cartCount = await prisma.cartLine.count({ where: { userId: user.userId } });

  return (
    <Shell user={user} cartCount={cartCount}>
      {searchParams.placed ? (
        <div
          className="card p-4 mb-4 border-l-4"
          style={{ borderLeftColor: 'var(--accent)' }}
          role="status"
        >
          <p className="font-semibold">Order {order.number} is in.</p>
          <p className="text-sm text-muted mt-0.5">
            {order.shipments.length > 1
              ? `It has gone to ${order.shipments.length} fillers, so it may arrive in separate deliveries.`
              : 'The parts desk has it.'}
          </p>
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold tabular flex items-center gap-2">
            {order.number}
            {order.rush ? (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-red-600 text-white">
                Rush
              </span>
            ) : null}
          </h1>
          <p className="text-sm text-muted">
            {order.submittedAt.toLocaleString('en-CA', {
              year: 'numeric', month: 'long', day: 'numeric',
              hour: 'numeric', minute: '2-digit',
            })}
            {' · placed by '}{order.placedByName}
            {order.jobRef ? ` · job ${order.jobRef}` : ''}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <a href={`/api/orders/${order.id}/invoice`} className="btn text-sm" target="_blank" rel="noreferrer">
            Invoice PDF
          </a>
          <ReorderButton orderId={order.id} />
          <Link href="/orders" className="btn text-sm">All orders</Link>
        </div>
      </div>

      <div className="space-y-4">
        {order.shipments.map((s) => {
          // Staff looking at the same order see the supplier by name; the
          // dealer sees only that this part of it ships direct.
          const label = fillerLabel(s.fulfilledBy, s.vendor, user.kind === 'DEALER' ? 'DEALER' : 'STAFF');
          const subtotal = s.lines.reduce((sum, l) => sum + (l.unitCents ?? 0) * l.quantity, 0);
          return (
            <section key={s.id} className="card overflow-hidden">
              <header className="px-3 py-2 border-b border-line flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="font-semibold text-sm">
                    {s.fulfilledBy === 'HEAD_OFFICE' ? `Ships from ${label}` : label}
                  </h2>
                  <p className="text-xs text-muted">
                    {s.shippingMethod ?? 'Shipping not specified'}
                    {' · '}
                    {s.status.toLowerCase()}
                    {s.trackingRef ? ` · ${s.trackingRef}` : ''}
                  </p>
                </div>
                <span className="flex items-center gap-2">
                  <span className="text-sm tabular font-semibold">
                    {subtotal > 0 ? formatCents(subtotal) : ''}
                  </span>
                  <a href={`/api/shipments/${s.id}/slip`} className="btn py-1 px-2 text-xs" target="_blank" rel="noreferrer">
                    Packing slip
                  </a>
                </span>
              </header>

              <table className="w-full text-sm">
                <tbody>
                  {s.lines.map((l) => (
                    <tr key={l.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 tabular font-semibold w-36">{l.code ?? '—'}</td>
                      <td className="px-3 py-2">{l.name}</td>
                      <td className="px-3 py-2 text-center w-28 tabular">
                        {l.quantity}
                        {l.unit ? <span className="text-muted text-xs"> · {l.unit}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right w-28 tabular">
                        {l.unitCents === null ? '—' : formatCents(l.unitCents * l.quantity)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>

      {order.note ? (
        <div className="card p-3 mt-4">
          <h3 className="text-xs uppercase tracking-wide text-muted font-semibold mb-1">Note</h3>
          <p className="text-sm whitespace-pre-wrap">{order.note}</p>
        </div>
      ) : null}

      <div className="flex justify-end mt-4">
        <div className="text-right">
          <div className="text-xs text-muted uppercase tracking-wide">Order total</div>
          <div className="text-xl font-bold tabular">{total > 0 ? formatCents(total) : '—'}</div>
        </div>
      </div>
    </Shell>
  );
}
