import 'server-only';
import { prisma } from '@/lib/db';
import { applyMarkup } from '@/lib/money';
import type { PriceRuleScope } from '@prisma/client';

/**
 * What a dealer pays.
 *
 * The source price list is VENDOR COST. A dealer price is derived from it, and
 * four mechanisms can set one — most specific wins:
 *
 *   1. A hand-set price on the part        (priceOverridden = true)
 *   2. A PriceRule matching the part       (tier > vendor > category > segment)
 *   3. The catalogue-wide default markup
 *   4. Nothing -> "call for pricing"
 *
 * Until someone confirms the markup, `pricesVisibleToDealers` stays false and
 * every dealer-facing price reads "call for pricing". A made-up number quoted
 * to a dealer as though it were real is worse than no number.
 */

export interface PricingContext {
  settings: {
    defaultMarkupPct: number;
    pricesVisibleToDealers: boolean;
    roundToCents: number;
  };
  rules: { scope: PriceRuleScope; target: string; markupPct: number; priority: number }[];
}

export async function loadPricingContext(): Promise<PricingContext> {
  const [settings, rules] = await Promise.all([
    prisma.pricingSettings.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    }),
    prisma.priceRule.findMany({
      where: { active: true },
      select: { scope: true, target: true, markupPct: true, priority: true },
    }),
  ]);
  return {
    settings: {
      defaultMarkupPct: settings.defaultMarkupPct,
      pricesVisibleToDealers: settings.pricesVisibleToDealers,
      roundToCents: settings.roundToCents,
    },
    rules,
  };
}

export interface PricedPartInput {
  costCents: number | null;
  dealerCents: number | null;
  priceOverridden: boolean;
  categoryId: string | null;
  vendor: string | null;
  segmentCode: string | null;
}

/** Scope precedence when several rules match: the narrower target wins. */
const SCOPE_RANK: Record<PriceRuleScope, number> = {
  TIER: 4,
  VENDOR: 3,
  CATEGORY: 2,
  SEGMENT: 1,
};

function markupFor(part: PricedPartInput, tier: string, ctx: PricingContext): number {
  // Every rule that matches this part, each tagged with how narrow its scope is.
  const matches = ctx.rules
    .map((r) => {
      const target =
        r.scope === 'TIER' ? tier
        : r.scope === 'VENDOR' ? part.vendor
        : r.scope === 'CATEGORY' ? part.categoryId
        : part.segmentCode;
      if (!target || r.target.toUpperCase() !== target.toUpperCase()) return null;
      return { rank: SCOPE_RANK[r.scope], priority: r.priority, pct: r.markupPct };
    })
    .filter((m): m is { rank: number; priority: number; pct: number } => m !== null);

  if (matches.length === 0) return ctx.settings.defaultMarkupPct;

  // Explicit priority wins; ties break toward the narrower scope.
  matches.sort((a, b) => b.priority - a.priority || b.rank - a.rank);
  return matches[0].pct;
}

/**
 * The dealer-facing price, in cents, or null for "call for pricing".
 *
 * Never returns a number derived from cost while prices are switched off — the
 * hand-set override is the one thing that still shows, because someone typed it
 * deliberately.
 */
export function dealerPrice(
  part: PricedPartInput,
  tier: string,
  ctx: PricingContext,
): number | null {
  if (part.priceOverridden && part.dealerCents !== null) return part.dealerCents;
  if (!ctx.settings.pricesVisibleToDealers) return null;
  if (part.dealerCents !== null) return part.dealerCents;
  if (part.costCents === null) return null;
  return applyMarkup(part.costCents, markupFor(part, tier, ctx), ctx.settings.roundToCents);
}

/**
 * Recompute stored dealerCents across the catalogue after a markup change.
 * Skips every part whose price was set by hand — an override exists precisely
 * so a bulk recalculation cannot wipe it.
 */
export async function recomputeDealerPrices(tier = 'STANDARD'): Promise<number> {
  const ctx = await loadPricingContext();
  const parts = await prisma.part.findMany({
    where: { priceOverridden: false, costCents: { not: null } },
    select: {
      id: true,
      costCents: true,
      dealerCents: true,
      priceOverridden: true,
      categoryId: true,
      vendor: true,
      segmentCode: true,
    },
  });

  let changed = 0;
  for (const p of parts) {
    const next = applyMarkup(
      p.costCents as number,
      markupFor(p, tier, ctx),
      ctx.settings.roundToCents,
    );
    if (next !== p.dealerCents) {
      await prisma.part.update({ where: { id: p.id }, data: { dealerCents: next } });
      changed += 1;
    }
  }
  return changed;
}
