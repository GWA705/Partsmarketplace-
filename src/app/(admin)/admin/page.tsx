import Link from 'next/link';
import { requireAdmin } from '@/lib/session';
import { prisma } from '@/lib/db';
import Shell from '@/components/Shell';
import PricingForm from './PricingForm';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const user = await requireAdmin();

  const [settings, pricedParts, overridden, unnamedSegments, uncoded, dealers, lastImport] =
    await Promise.all([
      prisma.pricingSettings.upsert({
        where: { id: 'default' },
        update: {},
        create: { id: 'default' },
      }),
      prisma.part.count({ where: { costCents: { not: null } } }),
      prisma.part.count({ where: { priceOverridden: true } }),
      prisma.codeSegment.count({ where: { confirmed: false } }),
      prisma.part.count({ where: { code: null } }),
      prisma.dealer.count({ where: { active: true } }),
      prisma.importRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    ]);

  const taxOn = settings.chargeTax && !!settings.gstNumber;

  const cards = [
    {
      href: '/admin/segments',
      title: 'Departments & warehouses',
      body: unnamedSegments
        ? `${unnamedSegments} code${unnamedSegments === 1 ? '' : 's'} still unnamed`
        : 'All named',
      urgent: unnamedSegments > 0,
    },
    {
      href: '/admin/uncoded',
      title: 'Parts needing a code',
      body: uncoded ? `${uncoded} parts cannot be ordered yet` : 'None outstanding',
      urgent: uncoded > 0,
    },
    { href: '/admin/dealers', title: 'Dealers', body: `${dealers} active`, urgent: false },
    {
      href: '/admin/tax',
      title: 'Sales tax',
      body: taxOn ? `Charging, by ship-to province` : 'Not charging tax yet',
      urgent: !taxOn,
    },
    {
      href: '/admin/fulfillment',
      title: 'Fulfillment contacts',
      body: 'Who gets each pick list',
      urgent: false,
    },
  ];

  return (
    <Shell user={user}>
      <h1 className="text-lg font-semibold mb-4">Admin</h1>

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <PricingForm
          defaultMarkupPct={settings.defaultMarkupPct}
          roundToCents={settings.roundToCents}
          pricesVisibleToDealers={settings.pricesVisibleToDealers}
          pricedParts={pricedParts}
          overriddenParts={overridden}
        />

        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            {cards.map((c) => (
              <Link
                key={c.href}
                href={c.href}
                className="card p-3 hover:bg-canvas transition-colors block"
              >
                <div className="font-semibold text-sm">{c.title}</div>
                <div
                  className={`text-xs mt-0.5 ${
                    c.urgent ? 'text-amber-700 dark:text-amber-400 font-medium' : 'text-muted'
                  }`}
                >
                  {c.body}
                </div>
              </Link>
            ))}
          </div>

          {lastImport ? (
            <div className="card p-3 text-xs text-muted">
              <div className="font-semibold text-ink text-sm mb-1">Last catalogue import</div>
              {lastImport.fileName} ·{' '}
              {lastImport.startedAt.toLocaleString('en-CA', {
                year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
              })}
              <div className="mt-1">
                {lastImport.created} created · {lastImport.updated} updated ·{' '}
                {lastImport.skipped} skipped
              </div>
              <div className="mt-2 text-[11px]">
                Re-import with{' '}
                <code className="tabular">npm run import:catalogue -- &lt;file&gt; --commit</code>.
                Categories, tags, fitment and hand-set prices survive.
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Shell>
  );
}
