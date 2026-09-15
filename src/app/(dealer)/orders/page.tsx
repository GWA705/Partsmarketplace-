import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { prisma } from '@/lib/db';
import { formatCents } from '@/lib/money';
import Shell from '@/components/Shell';
import ReorderButton from './ReorderButton';

export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  const user = await requireUser();

  const orders = await prisma.order.findMany({
    where: user.kind === 'DEALER' ? { dealerId: user.dealerId } : { placedById: user.userId },
    orderBy: { submittedAt: 'desc' },
    take: 100,
    include: { shipments: { include: { lines: true } } },
  });

  const cartCount = await prisma.cartLine.count({ where: { userId: user.userId } });

  return (
    <Shell user={user} cartCount={cartCount}>
      <h1 className="text-lg font-semibold mb-4">Your orders</h1>

      {orders.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-medium">No orders yet.</p>
          <Link href="/catalogue" className="btn btn-primary mt-3">Search the catalogue</Link>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted border-b border-line">
              <tr>
                <th className="text-left font-medium px-3 py-2 w-28">Order</th>
                <th className="text-left font-medium px-3 py-2 w-36">Placed</th>
                <th className="text-left font-medium px-3 py-2">Contents</th>
                <th className="text-left font-medium px-3 py-2 w-32">Status</th>
                <th className="text-right font-medium px-3 py-2 w-28">Total</th>
                <th className="text-right font-medium px-3 py-2 w-28">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const lines = o.shipments.flatMap((s) => s.lines);
                const total = lines.reduce(
                  (sum, l) => sum + (l.unitCents ?? 0) * l.quantity,
                  0,
                );
                const pieces = lines.reduce((sum, l) => sum + l.quantity, 0);
                return (
                  <tr key={o.id} className="border-b border-line last:border-0 hover:bg-canvas/60">
                    <td className="px-3 py-2 align-top">
                      <Link href={`/orders/${o.id}`} className="tabular font-semibold underline underline-offset-2">
                        {o.number}
                      </Link>
                    </td>
                    <td className="px-3 py-2 align-top text-muted">
                      {o.submittedAt.toLocaleDateString('en-CA', {
                        year: 'numeric', month: 'short', day: 'numeric',
                      })}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {lines.length} lines · {pieces} pieces
                      {o.shipments.length > 1 ? (
                        <span className="text-muted"> · {o.shipments.length} shipments</span>
                      ) : null}
                      {o.jobRef ? <span className="text-muted"> · {o.jobRef}</span> : null}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className="text-xs">{o.status.replace(/_/g, ' ').toLowerCase()}</span>
                    </td>
                    <td className="px-3 py-2 align-top text-right tabular">
                      {total > 0 ? formatCents(total) : '—'}
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      <ReorderButton orderId={o.id} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
