import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { prisma } from '@/lib/db';
import { cataloguePage, catalogueFacets } from '@/lib/catalogue';
import type { SortKey } from '@/lib/search';
import { PAGE_SIZE } from '@/lib/constants';
import Shell from '@/components/Shell';
import SearchBar from '@/app/(dealer)/catalogue/SearchBar';
import Filters, { type FacetGroup } from '@/app/(dealer)/catalogue/Filters';
import PartsTable from '@/app/(dealer)/catalogue/PartsTable';

export const dynamic = 'force-dynamic';

type Search = Record<string, string | undefined>;

/**
 * The staff view of the catalogue. Same search, same table — but costed, and
 * able to see the inactive rows that a dealer must not.
 */
export default async function StaffCataloguePage({ searchParams }: { searchParams: Search }) {
  const user = await requireStaff();

  const q = searchParams.q?.trim() || undefined;
  const sort = (searchParams.sort as SortKey) || (q ? 'relevance' : 'code');
  const page = Number(searchParams.page ?? 1) || 1;

  const [result, f, cartCount] = await Promise.all([
    cataloguePage(user, {
      q,
      sort,
      page,
      pageSize: PAGE_SIZE,
      categoryId: searchParams.category,
      vendor: searchParams.vendor,
      segmentCode: searchParams.segment,
      fulfilledBy: searchParams.ships as 'HEAD_OFFICE' | 'SUPPLIER' | undefined,
      includeInactive: searchParams.inactive === '1',
    }),
    catalogueFacets(),
    prisma.cartLine.count({ where: { userId: user.userId } }),
  ]);

  const active: Search = {
    q,
    sort: searchParams.sort,
    category: searchParams.category,
    vendor: searchParams.vendor,
    segment: searchParams.segment,
    ships: searchParams.ships,
    inactive: searchParams.inactive,
  };

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
      title: 'Department / warehouse',
      param: 'segment',
      hint: 'From the end of the part number.',
      options: f.segments
        .filter((s) => s.count > 0)
        .sort((a, b) => Number(!!b.label) - Number(!!a.label) || b.count - a.count)
        .map((s) => ({
          value: s.code,
          label: s.label ? `${s.label} (${s.code})` : s.code,
          count: s.count,
        })),
    },
  ];

  return (
    <Shell user={user} cartCount={cartCount}>
      <div className="space-y-4">
        <SearchBar total={result.total} />

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            href={searchParams.inactive === '1' ? '/staff' : '/staff?inactive=1'}
            className={`btn py-1 px-2.5 text-xs ${searchParams.inactive === '1' ? 'btn-primary' : ''}`}
          >
            {searchParams.inactive === '1' ? '✓ ' : ''}Include retired &amp; uncoded
          </Link>
          {user.staffRole === 'ADMIN' ? (
            <Link href="/admin" className="btn py-1 px-2.5 text-xs">Admin</Link>
          ) : null}
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          <Filters groups={groups} active={active} basePath="/staff" />
          <div className="flex-1 min-w-0">
            <PartsTable
              rows={result.rows}
              sort={sort}
              params={active}
              pricesHidden={false}
              showCost
              basePath="/staff"
            />
          </div>
        </div>
      </div>
    </Shell>
  );
}
