import Link from 'next/link';
import { requireAdmin } from '@/lib/session';
import { prisma } from '@/lib/db';
import Shell from '@/components/Shell';
import DealerForm from './DealerForm';

export const dynamic = 'force-dynamic';

export default async function DealersPage() {
  const user = await requireAdmin();

  const dealers = await prisma.dealer.findMany({
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { users: true, orders: true } } },
  });

  return (
    <Shell user={user}>
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-lg font-semibold">Dealers</h1>
        <Link href="/admin" className="btn py-1 px-2 text-xs ml-auto">Back to admin</Link>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted border-b border-line">
              <tr>
                <th className="text-left font-medium px-3 py-2">Dealer</th>
                <th className="text-left font-medium px-3 py-2 w-28">Tier</th>
                <th className="text-right font-medium px-3 py-2 w-20">Users</th>
                <th className="text-right font-medium px-3 py-2 w-20">Orders</th>
              </tr>
            </thead>
            <tbody>
              {dealers.map((d) => (
                <tr key={d.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">
                    <div className={d.active ? 'font-medium' : 'text-muted line-through'}>
                      {d.name}
                    </div>
                    <div className="text-[11px] text-muted">
                      {[d.code, d.shipCity].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted text-xs">{d.tier}</td>
                  <td className="px-3 py-2 text-right tabular">{d._count.users}</td>
                  <td className="px-3 py-2 text-right tabular">{d._count.orders}</td>
                </tr>
              ))}
              {dealers.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-muted">No dealers yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <DealerForm />
      </div>
    </Shell>
  );
}
