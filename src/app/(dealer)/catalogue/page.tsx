import Link from 'next/link';
import { requireDealer } from '@/lib/session';
import { prisma } from '@/lib/db';
import { cataloguePage, catalogueFacets, frequentlyOrdered } from '@/lib/catalogue';
import type { SortKey } from '@/lib/search';
import { PAGE_SIZE } from '@/lib/constants';
import Shell from '@/components/Shell';
import SearchBar from './SearchBar';
import Filters, { type FacetGroup } from './Filters';
import PartsTable from './PartsTable';
import AddToCart from './AddToCart';

export const dynamic = 'force-dynamic';

type Search = Record<string, string | undefined>;

export default async function CataloguePage({ searchParams }: { searchParams: Search }) {
  const user = await requireDealer();

  const q = searchParams.q?.trim() || undefined;
  const sort = (searchParams.sort as SortKey) || (q ? 'relevance' : 'code');
  const page = Number(searchParams.page ?? 1) || 1;
  const mine = searchParams.mine === '1';

  const [result, f, cartCount, frequent] = await Promise.all([
    cataloguePage(user, {
      q,
      sort,
      page,
      pageSize: PAGE_SIZE,
      categoryId: searchParams.category,
      vendor: searchParams.vendor,
      segmentCode: searchParams.segment,
      fulfilledBy: searchParams.ships as 'HEAD_OFFICE' | 'SUPPLIER' | undefined,
      tag: searchParams.tag,
      orderedByDealerId: mine ? user.dealerId : undefined,
    }),
    catalogueFacets(),
    prisma.cartLine.count({ where: { userId: user.userId } }),
    // Only worth the query on a bare catalogue view — it is the landing page
    // shortcut, not something to compute on every search.
    !q && page === 1 ? frequentlyOrdered(user.dealerId, 8) : Promise.resolve([]),
  ]);

  const active: Search = {
    q,
    sort: searchParams.sort,
    category: searchParams.category,
    vendor: searchParams.vendor,
    segment: searchParams.segment,
    ships: searchParams.ships,
    tag: searchParams.tag,
    mine: mine ? '1' : undefined,
  };

  // A segment nobody has named yet shows as its raw code ("03", "SC"), which
  // means nothing to a dealer. Named ones lead; the rest fall to the bottom by
  // size rather than sitting at the top because they sort numerically first.
  const bySegment = (a: { label: string | null; count: number }, b: { label: string | null; count: number }) =>
    Number(!!b.label) - Number(!!a.label) || b.count - a.count;

  const departments = f.segments
    .filter((s) => s.kind !== 'WAREHOUSE' && s.count > 0)
    .sort(bySegment);
  const warehouses = f.segments
    .filter((s) => s.kind === 'WAREHOUSE' && s.count > 0)
    .sort(bySegment);

  const groups: FacetGroup[] = [
    {
      title: 'Category',
      param: 'category',
      options: f.categories.map((c) => ({ value: c.id, label: c.name, count: c.count })),
    },
    {
      title: 'Vendor',
      param: 'vendor',
      options: f.vendors.map((v) => ({ value: v.name, label: v.name, count: v.count })),
    },
    {
      title: 'Department',
      param: 'segment',
      hint: 'From the end of the part number.',
      options: departments.map((s) => ({
        value: s.code,
        label: s.label || s.code,
        count: s.count,
      })),
    },
  ];
  if (warehouses.length) {
    groups.push({
      title: 'Warehouse',
      param: 'segment',
      options: warehouses.map((s) => ({
        value: s.code,
        label: s.label || s.code,
        count: s.count,
      })),
    });
  }
  groups.push({
    title: 'Ships from',
    param: 'ships',
    options: [
      { value: 'HEAD_OFFICE', label: 'Head office', count: 0 },
      { value: 'SUPPLIER', label: 'Direct from supplier', count: 0 },
    ].filter((o) => o.label),
  });

  const pageHref = (n: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(active)) if (v) next.set(k, v);
    next.set('page', String(n));
    return `/catalogue?${next.toString()}`;
  };

  return (
    <Shell user={user} cartCount={cartCount}>
      <div className="space-y-4">
        <SearchBar total={result.total} />

        {/* A dealer reordering the same filters every month should never have
            to search at all — their own history is the better catalogue. */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            href={mine ? '/catalogue' : '/catalogue?mine=1'}
            className={`btn py-1 px-2.5 text-xs ${mine ? 'btn-primary' : ''}`}
          >
            {mine ? '✓ ' : ''}Parts I have ordered
          </Link>
          <Link href="/orders" className="btn py-1 px-2.5 text-xs">
            Reorder from a past order
          </Link>
        </div>

        {frequent.length > 0 && !mine ? (
          <section className="card p-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
              You order these most
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {frequent.map(({ part, times }) => (
                <li key={part.id} className="flex items-center gap-2 border border-line rounded px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="tabular text-xs font-semibold truncate">{part.code}</div>
                    <div className="text-xs text-muted truncate">
                      {part.catalogueName || part.name}
                    </div>
                    <div className="text-[10px] text-muted">ordered {times}x</div>
                  </div>
                  <AddToCart partId={part.id} unit={part.unit} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="flex flex-col lg:flex-row gap-6">
          <Filters groups={groups} active={active} />

          <div className="flex-1 min-w-0 space-y-3">
            <PartsTable
              rows={result.rows}
              sort={sort}
              params={active}
              pricesHidden={result.pricesHidden}
            />

            {result.pages > 1 ? (
              <nav className="flex items-center justify-between text-sm">
                <span className="text-muted">
                  Page {result.page} of {result.pages} · {result.total.toLocaleString('en-CA')} parts
                </span>
                <div className="flex gap-2">
                  {result.page > 1 ? (
                    <Link href={pageHref(result.page - 1)} className="btn py-1 px-3">Previous</Link>
                  ) : null}
                  {result.page < result.pages ? (
                    <Link href={pageHref(result.page + 1)} className="btn py-1 px-3">Next</Link>
                  ) : null}
                </div>
              </nav>
            ) : null}
          </div>
        </div>
      </div>
    </Shell>
  );
}
