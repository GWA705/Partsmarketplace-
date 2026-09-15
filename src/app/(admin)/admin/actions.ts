'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { audit } from '@/lib/audit';
import { recomputeDealerPrices } from '@/lib/pricing';
import { hashPassword, passwordProblem } from '@/lib/password';
import type { CodeSegmentKind, FulfilledBy } from '@prisma/client';

export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

// ── Pricing ──────────────────────────────────────────────────────────────────

export async function savePricing(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAdmin();

  const markup = Number(formData.get('defaultMarkupPct'));
  const roundTo = Number(formData.get('roundToCents'));
  const visible = formData.get('pricesVisibleToDealers') === 'on';

  if (!Number.isFinite(markup) || markup < 0 || markup > 1000) {
    return { error: 'Markup must be between 0 and 1000 percent.' };
  }
  if (!Number.isFinite(roundTo) || roundTo < 1 || roundTo > 500) {
    return { error: 'Rounding must be between 1 and 500 cents.' };
  }

  await prisma.pricingSettings.upsert({
    where: { id: 'default' },
    update: {
      defaultMarkupPct: Math.round(markup),
      roundToCents: Math.round(roundTo),
      pricesVisibleToDealers: visible,
      updatedById: user.userId,
    },
    create: {
      id: 'default',
      defaultMarkupPct: Math.round(markup),
      roundToCents: Math.round(roundTo),
      pricesVisibleToDealers: visible,
      updatedById: user.userId,
    },
  });

  const changed = await recomputeDealerPrices();

  await audit({
    actorId: user.userId,
    actorName: user.name,
    action: 'pricing.save',
    entity: 'PricingSettings',
    detail: `markup ${markup}%, round ${roundTo}c, visible=${visible}, ${changed} prices recomputed`,
  });

  revalidatePath('/admin');
  revalidatePath('/catalogue');
  return {
    ok: true,
    message: `Saved. ${changed.toLocaleString('en-CA')} dealer prices recalculated${
      visible ? ' and now visible to dealers.' : '. Prices stay hidden from dealers.'
    }`,
  };
}

// ── Code segments (departments / warehouses) ─────────────────────────────────

export async function nameSegment(
  code: string,
  kind: CodeSegmentKind,
  label: string,
): Promise<void> {
  const user = await requireAdmin();
  const clean = label.trim();

  await prisma.codeSegment.update({
    where: { code },
    data: {
      kind,
      label: clean || null,
      // Naming it IS the confirmation — that is the whole point of the screen.
      confirmed: !!clean && kind !== 'UNKNOWN',
    },
  });

  await audit({
    actorId: user.userId,
    actorName: user.name,
    action: 'segment.name',
    entity: 'CodeSegment',
    entityId: code,
    detail: `${kind} "${clean}"`,
  });

  revalidatePath('/admin/segments');
  revalidatePath('/catalogue');
  revalidatePath('/staff');
}

// ── Parts ────────────────────────────────────────────────────────────────────

export async function updatePart(
  partId: string,
  data: {
    categoryId?: string | null;
    fulfilledBy?: FulfilledBy;
    dealerCents?: number | null;
    priceOverridden?: boolean;
    active?: boolean;
    tags?: string[];
    fitsSkus?: string[];
    code?: string | null;
  },
): Promise<ActionState> {
  const user = await requireAdmin();

  if (data.code) {
    const clash = await prisma.part.findFirst({
      where: { code: data.code.toUpperCase(), NOT: { id: partId } },
      select: { id: true },
    });
    if (clash) return { error: `Another part already uses code ${data.code}.` };
  }

  await prisma.part.update({
    where: { id: partId },
    data: {
      ...data,
      ...(data.code ? { code: data.code.toUpperCase(), active: true } : {}),
      // Typing a price by hand is what makes it survive a bulk recalculation.
      ...(data.dealerCents !== undefined ? { priceOverridden: data.dealerCents !== null } : {}),
    },
  });

  await audit({
    actorId: user.userId,
    actorName: user.name,
    action: 'part.update',
    entity: 'Part',
    entityId: partId,
    detail: JSON.stringify(data),
  });

  revalidatePath('/admin');
  revalidatePath('/staff');
  revalidatePath('/catalogue');
  return { ok: true };
}

/** Put every part from one vendor, or one segment, on one filling route. */
export async function bulkSetFulfillment(
  scope: 'vendor' | 'segment',
  target: string,
  fulfilledBy: FulfilledBy,
): Promise<ActionState> {
  const user = await requireAdmin();

  const res = await prisma.part.updateMany({
    where: scope === 'vendor' ? { vendor: target } : { segmentCode: target },
    data: { fulfilledBy },
  });

  await audit({
    actorId: user.userId,
    actorName: user.name,
    action: 'part.bulkFulfillment',
    entity: 'Part',
    detail: `${scope}=${target} -> ${fulfilledBy} (${res.count} parts)`,
  });

  revalidatePath('/admin');
  return { ok: true, message: `${res.count.toLocaleString('en-CA')} parts updated.` };
}

// ── Dealers ──────────────────────────────────────────────────────────────────

export async function createDealer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAdmin();

  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('contactEmail') ?? '').trim().toLowerCase();
  const loginEmail = String(formData.get('loginEmail') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');

  if (!name) return { error: 'Give the dealer a name.' };
  if (await prisma.dealer.findUnique({ where: { name } })) {
    return { error: 'A dealer with that name already exists.' };
  }
  if (loginEmail) {
    const problem = passwordProblem(password);
    if (problem) return { error: problem };
    if (await prisma.user.findUnique({ where: { email: loginEmail } })) {
      return { error: 'That login email is already in use.' };
    }
  }

  const dealer = await prisma.dealer.create({
    data: {
      name,
      code: String(formData.get('code') ?? '').trim() || null,
      contactEmail: email || null,
      phone: String(formData.get('phone') ?? '').trim() || null,
      shipAttn: String(formData.get('shipAttn') ?? '').trim() || null,
      shipLine1: String(formData.get('shipLine1') ?? '').trim() || null,
      shipCity: String(formData.get('shipCity') ?? '').trim() || null,
      shipProvince: String(formData.get('shipProvince') ?? '').trim() || null,
      shipPostal: String(formData.get('shipPostal') ?? '').trim() || null,
    },
  });

  if (loginEmail) {
    await prisma.user.create({
      data: {
        email: loginEmail,
        name: String(formData.get('contactName') ?? '').trim() || name,
        kind: 'DEALER',
        dealerId: dealer.id,
        passwordHash: await hashPassword(password),
      },
    });
  }

  await audit({
    actorId: user.userId,
    actorName: user.name,
    action: 'dealer.create',
    entity: 'Dealer',
    entityId: dealer.id,
    detail: name,
  });

  revalidatePath('/admin/dealers');
  return { ok: true, message: `${name} added.` };
}

export async function setFulfillmentContact(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireAdmin();
  const party = String(formData.get('party') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();

  if (!party) return { error: 'Choose who fills these orders.' };
  if (!email) return { error: 'Enter an email address.' };

  await prisma.fulfillmentContact.upsert({
    where: { party },
    update: { email, ccEmail: String(formData.get('ccEmail') ?? '').trim() || null },
    create: { party, email, ccEmail: String(formData.get('ccEmail') ?? '').trim() || null },
  });

  await audit({
    actorId: user.userId,
    actorName: user.name,
    action: 'fulfillment.contact',
    entity: 'FulfillmentContact',
    entityId: party,
    detail: email,
  });

  revalidatePath('/admin/fulfillment');
  return { ok: true, message: `${party} orders will go to ${email}.` };
}
