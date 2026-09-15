import Link from 'next/link';
import { requireAdmin } from '@/lib/session';
import { prisma } from '@/lib/db';
import Shell from '@/components/Shell';
import SegmentRow from './SegmentRow';

export const dynamic = 'force-dynamic';

export default async function SegmentsPage() {
  const user = await requireAdmin();

  const segments = await prisma.codeSegment.findMany({
    orderBy: [{ confirmed: 'asc' }, { code: 'asc' }],
    include: { _count: { select: { parts: true } } },
  });

  const unnamed = segments.filter((s) => !s.confirmed).length;

  return (
    <Shell user={user}>
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-lg font-semibold">Departments &amp; warehouses</h1>
        <Link href="/admin" className="btn py-1 px-2 text-xs ml-auto">Back to admin</Link>
      </div>

      <p className="text-sm text-muted mb-4 max-w-2xl">
        Part numbers end in a code that says which department or warehouse the part belongs to —
        the <span className="tabular">.SC</span> in <span className="tabular">10010006.SC</span>.
        Only 28% of the catalogue carries a category, so these are the filter that covers
        everything. Name them and dealers see words instead of codes.
        {unnamed > 0 ? (
          <span className="block mt-1 font-medium text-amber-700 dark:text-amber-400">
            {unnamed} still to name — unnamed ones are listed first.
          </span>
        ) : null}
      </p>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted border-b border-line">
            <tr>
              <th className="text-left font-medium px-3 py-2">Code</th>
              <th className="text-right font-medium px-3 py-2">Parts</th>
              <th className="text-left font-medium px-3 py-2">Kind</th>
              <th className="text-left font-medium px-3 py-2">Name</th>
              <th className="px-3 py-2" />
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {segments.map((s) => (
              <SegmentRow
                key={s.code}
                code={s.code}
                kind={s.kind}
                label={s.label}
                confirmed={s.confirmed}
                count={s._count.parts}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
