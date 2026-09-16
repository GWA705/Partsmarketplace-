import Link from 'next/link';
import { formatCents } from '@/lib/money';
import PartTags from '@/components/PartTags';
import PartThumb from '@/components/PartThumb';
import AddToCart from './AddToCart';
import type { CatalogueRow } from '@/lib/catalogue';

/**
 * The results table.
 *
 * Dense rows, not a photo grid. Almost no part has a photo yet, and 1,380
 * placeholder tiles would be worse than useless — what a dealer compares down a
 * column is the number, what it is, and what it costs. A small thumbnail rides
 * alongside the description for the parts that do have one.
 *
 * A dealer's row is deliberately four things: item number, description, photo,
 * price. No vendor column — who we buy from is ours (see partSelect.ts). Staff
 * get the same table with vendor and cost switched on.
 */
export default function PartsTable({
  rows,
  sort,
  params,
  pricesHidden,
  showCost = false,
  showVendor = false,
  editable = false,
  basePath = '/catalogue',
}: {
  rows: CatalogueRow[];
  sort: string;
  params: Record<string, string | undefined>;
  pricesHidden: boolean;
  showCost?: boolean;
  showVendor?: boolean;
  /** Staff: link each row through to the part editor. */
  editable?: boolean;
  basePath?: string;
}) {
  const sortHref = (key: string) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== 'sort' && k !== 'page') next.set(k, v);
    next.set('sort', key);
    return `${basePath}?${next.toString()}`;
  };

  // NOT named `key`: React reserves that prop and strips it before the
  // component ever sees it, so the column would silently sort by nothing.
  const SortHead = ({
    label,
    sortKey,
    align = 'left',
  }: {
    label: string;
    sortKey: string;
    align?: 'left' | 'right';
  }) => (
    <Link
      href={sortHref(sortKey)}
      className={`hover:text-ink ${sort === sortKey ? 'text-ink font-semibold' : ''} ${
        align === 'right' ? 'text-right block' : ''
      }`}
    >
      {label}
      {sort === sortKey ? ' ↓' : ''}
    </Link>
  );

  if (rows.length === 0) {
    return (
      <div className="card p-10 text-center">
        <p className="font-medium">Nothing matched.</p>
        <p className="text-sm text-muted mt-1">
          Try a shorter piece of the part number — searching <span className="tabular">0208</span>{' '}
          finds <span className="tabular">0208W.IN</span>.
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted border-b border-line">
            <tr>
              <th className="text-left font-medium px-3 py-2 w-40"><SortHead label="Item #" sortKey="code" /></th>
              <th className="text-left font-medium px-3 py-2"><SortHead label="Description" sortKey="name" /></th>
              {showVendor ? (
                <th className="text-left font-medium px-3 py-2 w-44 hidden md:table-cell">
                  <SortHead label="Vendor" sortKey="vendor" />
                </th>
              ) : null}
              <th className="text-left font-medium px-3 py-2 w-24 hidden lg:table-cell">Ships</th>
              <th className="text-right font-medium px-3 py-2 w-28">
                <SortHead label={showCost ? 'Cost' : 'Price'} sortKey="price" align="right" />
              </th>
              <th className="text-right font-medium px-3 py-2 w-32">Order</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0 hover:bg-canvas/60">
                <td className="px-3 py-2 align-top">
                  {editable ? (
                    <Link
                      href={`/admin/parts/${r.id}`}
                      className="tabular font-semibold underline underline-offset-2 decoration-line hover:decoration-current"
                    >
                      {r.code ?? '(no code)'}
                    </Link>
                  ) : (
                    <div className="tabular font-semibold">{r.code ?? '—'}</div>
                  )}
                  {r.catalogueCode && r.catalogueCode !== r.code ? (
                    // The price list and the catalogue disagree on 137 parts.
                    // Whichever number is on the part in their hand should be
                    // visible here, or they think they found the wrong thing.
                    <div className="tabular text-[11px] text-muted" title="Catalogue part number">
                      {r.catalogueCode}
                    </div>
                  ) : null}
                </td>

                <td className="px-3 py-2 align-top">
                  <div className="flex items-start gap-2.5">
                    <PartThumb partId={r.id} hasImage={r.hasImage} alt="" size={38} />
                    <div className="min-w-0">
                      <div className="flex items-start gap-2 flex-wrap">
                        <span>{r.name}</span>
                        <PartTags tags={r.tags} />
                      </div>
                      {r.supersededBy ? (
                        <div className="text-[11px] mt-0.5 font-medium text-amber-700 dark:text-amber-400">
                          Replaced by {r.supersededBy}
                        </div>
                      ) : null}
                      <div className="text-[11px] text-muted mt-0.5 lg:hidden">{r.fillerLabel}</div>
                    </div>
                  </div>
                </td>

                {showVendor ? (
                  <td className="px-3 py-2 align-top text-muted hidden md:table-cell">
                    {r.vendor ?? '—'}
                  </td>
                ) : null}

                <td className="px-3 py-2 align-top hidden lg:table-cell">
                  <span className="text-[11px] text-muted">{r.fillerLabel}</span>
                </td>

                <td className="px-3 py-2 align-top text-right">
                  <div className="tabular font-semibold">
                    {r.priceCents === null ? (
                      <span className="text-xs font-normal text-muted">Call for pricing</span>
                    ) : (
                      formatCents(r.priceCents)
                    )}
                  </div>
                  {r.unit ? <div className="text-[11px] text-muted">{r.unit}</div> : null}
                </td>

                <td className="px-3 py-2 align-top">
                  <AddToCart partId={r.id} unit={r.unit} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pricesHidden ? (
        <p className="px-3 py-2 text-xs text-muted border-t border-line">
          Prices are being finalised — add what you need and the parts desk will confirm pricing
          on your order.
        </p>
      ) : null}
    </div>
  );
}
