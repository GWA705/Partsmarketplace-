import Link from 'next/link';
import { requireAdmin } from '@/lib/session';
import { prisma } from '@/lib/db';
import Shell from '@/components/Shell';
import CodeAssign from './CodeAssign';

export const dynamic = 'force-dynamic';

/**
 * Parts the catalogue lists but the price list does not.
 *
 * They arrived with a catalogue part number, no item code and no price, so they
 * cannot be ordered — they import inactive and land here rather than being
 * dropped on the floor or shown to a dealer who then cannot buy them.
 */
export default async function UncodedPage() {
  const user = await requireAdmin();

  const parts = await prisma.part.findMany({
    where: { code: null },
    orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
    include: { category: true },
    take: 300,
  });

  return (
    <Shell user={user}>
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-lg font-semibold">Parts needing a code</h1>
        <Link href="/admin" className="btn py-1 px-2 text-xs ml-auto">Back to admin</Link>
      </div>

      <p className="text-sm text-muted mb-4 max-w-2xl">
        These are in the catalogue but not the price list, so they have no item code and no price.
        They are hidden from dealers until one is entered. Giving a part its code activates it.
      </p>

      {parts.length === 0 ? (
        <div className="card p-10 text-center text-muted">Nothing outstanding.</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted border-b border-line">
              <tr>
                <th className="text-left font-medium px-3 py-2 w-44">Catalogue #</th>
                <th className="text-left font-medium px-3 py-2">Description</th>
                <th className="text-left font-medium px-3 py-2 w-56">Category</th>
                <th className="text-left font-medium px-3 py-2 w-64">Item code</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 tabular">{p.catalogueCode ?? '—'}</td>
                  <td className="px-3 py-2">
                    {p.catalogueName || p.name}
                    {p.supersededBy ? (
                      <span className="block text-[11px] text-amber-700 dark:text-amber-400">
                        Replaced by {p.supersededBy}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-muted">{p.category?.name ?? '—'}</td>
                  <td className="px-3 py-2">
                    <CodeAssign partId={p.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
