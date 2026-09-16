import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/session';
import { prisma } from '@/lib/db';
import { loadPricingContext, dealerPrice } from '@/lib/pricing';
import Shell from '@/components/Shell';
import PartEditor from './PartEditor';

export const dynamic = 'force-dynamic';

export default async function PartPage({ params }: { params: { id: string } }) {
  const user = await requireAdmin();

  const [part, categories, ctx] = await Promise.all([
    prisma.part.findUnique({
      where: { id: params.id },
      include: { category: true, segment: true },
    }),
    prisma.partCategory.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    loadPricingContext(),
  ]);

  if (!part) notFound();

  // What the markup WOULD give, so the editor can show it as the placeholder
  // behind an empty override box.
  const derived = dealerPrice(
    {
      costCents: part.costCents,
      dealerCents: null,
      priceOverridden: false,
      categoryId: part.categoryId,
      vendor: part.vendor,
      segmentCode: part.segmentCode,
    },
    'STANDARD',
    { ...ctx, settings: { ...ctx.settings, pricesVisibleToDealers: true } },
  );

  return (
    <Shell user={user}>
      <div className="flex items-baseline gap-3 mb-1 flex-wrap">
        <h1 className="text-lg font-semibold tabular">{part.code ?? '(no code)'}</h1>
        <Link href="/staff" className="btn py-1 px-2 text-xs ml-auto">Back to catalogue</Link>
      </div>
      <p className="text-sm text-muted mb-5">
        {part.catalogueName || part.name}
        {part.segment?.label ? ` · ${part.segment.label}` : ''}
        {part.unit ? ` · ${part.unit}` : ''}
      </p>

      <PartEditor
        categories={categories}
        part={{
          id: part.id,
          code: part.code,
          name: part.catalogueName || part.name,
          vendor: part.vendor,
          costCents: part.costCents,
          dealerCents: part.dealerCents,
          priceOverridden: part.priceOverridden,
          categoryId: part.categoryId,
          fulfilledBy: part.fulfilledBy,
          active: part.active,
          tags: part.tags,
          fitsSkus: part.fitsSkus,
          hasImage: !!part.imageStorageKey,
          derivedPrice: derived,
        }}
      />
    </Shell>
  );
}
