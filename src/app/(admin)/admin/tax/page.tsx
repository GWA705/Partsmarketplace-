import Link from 'next/link';
import { requireAdmin } from '@/lib/session';
import { prisma } from '@/lib/db';
import Shell from '@/components/Shell';
import RegistrationForm from './RegistrationForm';
import RegionRow from './RegionRow';

export const dynamic = 'force-dynamic';

export default async function TaxPage() {
  const user = await requireAdmin();

  const [settings, regions, dealerCounts] = await Promise.all([
    prisma.pricingSettings.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    }),
    prisma.taxRegion.findMany({ orderBy: { label: 'asc' } }),
    prisma.dealer.groupBy({
      by: ['shipProvince'],
      where: { active: true },
      _count: { _all: true },
    }),
  ]);

  const shipTo = new Map(
    dealerCounts.map((d) => [(d.shipProvince ?? '').toUpperCase(), d._count._all]),
  );

  return (
    <Shell user={user}>
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-lg font-semibold">Sales tax</h1>
        <Link href="/admin" className="btn py-1 px-2 text-xs ml-auto">Back to admin</Link>
      </div>

      <p className="text-sm text-muted mb-5 max-w-3xl">
        Tax is calculated per order from the <strong>ship-to province</strong>, not ours — an
        order going to Calgary is charged Alberta&rsquo;s 5% GST, not Ontario&rsquo;s 13% HST.
        Whatever is charged is frozen onto the order, so changing a rate here never restates an
        invoice that has already gone out.
      </p>

      <div className="grid lg:grid-cols-[360px_1fr] gap-5 items-start">
        <RegistrationForm
          chargeTax={settings.chargeTax}
          gstNumber={settings.gstNumber}
          qstNumber={settings.qstNumber}
        />

        <div className="space-y-3">
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted border-b border-line">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Province</th>
                  <th className="text-right font-medium px-2 py-2">HST %</th>
                  <th className="text-right font-medium px-2 py-2">GST %</th>
                  <th className="text-left font-medium px-2 py-2">Provincial %</th>
                  <th className="text-center font-medium px-2 py-2">We collect it</th>
                  <th className="text-right font-medium px-3 py-2">Charged</th>
                </tr>
              </thead>
              <tbody>
                {regions.map((r) => (
                  <RegionRow
                    key={r.code}
                    code={r.code}
                    label={
                      shipTo.get(r.code)
                        ? `${r.label} · ${shipTo.get(r.code)} dealer${shipTo.get(r.code) === 1 ? '' : 's'}`
                        : r.label
                    }
                    hstThou={r.hstThou}
                    gstThou={r.gstThou}
                    provincialThou={r.provincialThou}
                    provincialLabel={r.provincialLabel}
                    collectProvincial={r.collectProvincial}
                    note={r.note}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="card p-3 text-xs text-muted space-y-1.5">
            <p>
              <strong className="text-ink">&ldquo;We collect it&rdquo;</strong> — GST/HST is charged
              on every Canadian sale once you are registered federally. A province&rsquo;s own tax
              is only charged by a business registered in that province, so those stay off until
              you tick them. Leaving one off charges GST alone.
            </p>
            <p>
              <strong className="text-ink">Resale dealers</strong> — a dealer buying for resale is
              usually exempt from the provincial tax and still pays GST/HST, which they recover as
              an input tax credit. Set that per dealer, with their exemption number.
            </p>
            <p>
              Rates are seeded as of this build and are yours to correct — Nova Scotia dropped to
              14% in April 2025. Worth a look from your accountant before you switch it on.
            </p>
          </div>
        </div>
      </div>
    </Shell>
  );
}
