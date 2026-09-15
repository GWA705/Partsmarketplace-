import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { prisma } from '@/lib/db';
import { formatCents } from '@/lib/money';
import Shell from '@/components/Shell';
import ShipmentStatusControl from './ShipmentStatusControl';

export const dynamic = 'force-dynamic';

/**
 * The fulfillment queue, by shipment rather than by order — a picker at head
 * office cares about the lines they pull, not about the half of the order a
 * supplier is drop-shipping.
 */
export default async function StaffOrdersPage({
  searchParams,
}: {
  searchParams: { status?: string; party?: string };
}) {
  const user = await requireStaff();
  const status = searchParams.status ?? 'SUBMITTED';

  const shipments = await prisma.shipment.findMany({
    where: {
      ...(status === 'ALL' ? {} : { status: status as 'SUBMITTED' }),
      ...(searchParams.party === 'HEAD_OFFICE'
        ? { fulfilledBy: 'HEAD_OFFICE' }
        : searchParams.party === 'SUPPLIER'
          ? { fulfilledBy: 'SUPPLIER' }
          : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { order: { include: { dealer: true } }, lines: true },
  });

  const tab = (value: string, label: string) => (
    <Link
      key={value}
      href={`/staff/orders?status=${value}`}
      className={`btn py-1 px-2.5 text-xs ${status === value ? 'btn-primary' : ''}`}
    >
      {label}
    </Link>
  );

  return (
    <Shell user={user}>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <h1 className="text-lg font-semibold mr-2">Fulfillment</h1>
        {tab('SUBMITTED', 'To pick')}
        {tab('ACKNOWLEDGED', 'In progress')}
        {tab('FULFILLED', 'Shipped')}
        {tab('ALL', 'Everything')}
      </div>

      {shipments.length === 0 ? (
        <div className="card p-10 text-center text-muted">Nothing here.</div>
      ) : (
        <div className="space-y-3">
          {shipments.map((s) => {
            const label = s.fulfilledBy === 'HEAD_OFFICE' ? 'Head office' : s.vendor ?? 'Supplier';
            const subtotal = s.lines.reduce((t, l) => t + (l.unitCents ?? 0) * l.quantity, 0);
            const pieces = s.lines.reduce((t, l) => t + l.quantity, 0);
            return (
              <section key={s.id} className="card overflow-hidden">
                <header className="px-3 py-2 border-b border-line flex items-center gap-3 flex-wrap">
                  <Link
                    href={`/orders/${s.orderId}`}
                    className="tabular font-semibold underline underline-offset-2"
                  >
                    {s.order.number}
                  </Link>
                  <span className="text-sm">
                    {s.order.dealer?.name ?? 'GWA internal'}
                    {s.order.jobRef ? ` · ${s.order.jobRef}` : ''}
                  </span>
                  <span className="text-xs text-muted">
                    {label} · {s.shippingMethod ?? 'no shipping method'} · {pieces} pieces
                  </span>
                  {!s.notifiedAt ? (
                    // If the email never went out, somebody has to be told —
                    // an order sitting unpicked because nobody knew is the
                    // failure this whole screen exists to prevent.
                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                      not emailed
                    </span>
                  ) : null}
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-sm tabular">{subtotal > 0 ? formatCents(subtotal) : ''}</span>
                    <a href={`/api/shipments/${s.id}/slip`} className="btn py-1 px-2 text-xs">
                      Pick list
                    </a>
                    <ShipmentStatusControl shipmentId={s.id} status={s.status} />
                  </span>
                </header>

                <table className="w-full text-sm">
                  <tbody>
                    {s.lines.map((l) => (
                      <tr key={l.id} className="border-b border-line last:border-0">
                        <td className="px-3 py-1.5 tabular font-semibold w-36">{l.code ?? '—'}</td>
                        <td className="px-3 py-1.5">{l.name}</td>
                        <td className="px-3 py-1.5 w-40 text-muted text-xs">{l.vendor}</td>
                        <td className="px-3 py-1.5 text-center w-32 tabular font-semibold">
                          {l.quantity}
                          {l.unit ? <span className="font-normal text-muted"> · {l.unit}</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
