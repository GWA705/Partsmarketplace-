import Link from 'next/link';
import { requireAdmin } from '@/lib/session';
import { prisma } from '@/lib/db';
import Shell from '@/components/Shell';
import ContactForm from './ContactForm';

export const dynamic = 'force-dynamic';

/**
 * Where each filling party's pick list goes.
 *
 * A shipment whose party has no contact still exists — the order is not lost —
 * but nobody is told about it, so this screen leads with the parties that
 * actually have parts routed to them and no address on file.
 */
export default async function FulfillmentPage() {
  const user = await requireAdmin();

  const [contacts, dropShipVendors] = await Promise.all([
    prisma.fulfillmentContact.findMany({ orderBy: { party: 'asc' } }),
    prisma.part.groupBy({
      by: ['vendor'],
      where: { fulfilledBy: 'SUPPLIER', vendor: { not: null }, active: true },
      _count: { _all: true },
    }),
  ]);

  const have = new Set(contacts.map((c) => c.party));
  const missing = [
    ...(have.has('HEAD_OFFICE') ? [] : [{ party: 'HEAD_OFFICE', count: 0 }]),
    ...dropShipVendors
      .filter((v) => v.vendor && !have.has(v.vendor))
      .map((v) => ({ party: v.vendor as string, count: v._count._all })),
  ];

  return (
    <Shell user={user}>
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-lg font-semibold">Fulfillment contacts</h1>
        <Link href="/admin" className="btn py-1 px-2 text-xs ml-auto">Back to admin</Link>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <div className="space-y-4">
          {missing.length > 0 ? (
            <div className="card p-3 border-l-4 border-l-amber-500">
              <h2 className="font-semibold text-sm">Nobody is being emailed for these</h2>
              <p className="text-xs text-muted mt-0.5 mb-2">
                Parts are routed to them, but an order would go out with no pick-list email.
              </p>
              <ul className="text-sm space-y-0.5">
                {missing.map((m) => (
                  <li key={m.party} className="flex justify-between">
                    <span>{m.party === 'HEAD_OFFICE' ? 'Head office' : m.party}</span>
                    {m.count ? <span className="text-muted tabular text-xs">{m.count} parts</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted border-b border-line">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Filled by</th>
                  <th className="text-left font-medium px-3 py-2">Email</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">
                      {c.party === 'HEAD_OFFICE' ? 'Head office' : c.party}
                      {c.muted ? <span className="text-xs text-muted"> · muted</span> : null}
                    </td>
                    <td className="px-3 py-2 text-muted">
                      {c.email}
                      {c.ccEmail ? <span className="block text-[11px]">cc {c.ccEmail}</span> : null}
                    </td>
                  </tr>
                ))}
                {contacts.length === 0 ? (
                  <tr><td colSpan={2} className="px-3 py-8 text-center text-muted">None set.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <ContactForm
          parties={[
            'HEAD_OFFICE',
            ...dropShipVendors.map((v) => v.vendor as string).filter(Boolean).sort(),
          ]}
        />
      </div>
    </Shell>
  );
}
