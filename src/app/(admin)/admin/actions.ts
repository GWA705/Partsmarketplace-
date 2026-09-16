'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { audit } from '@/lib/audit';
import { recomputeDealerPrices } from '@/lib/pricing';
import { hashPassword, passwordProblem } from '@/lib/password';
import { storageReady } from '@/lib/storage';
import { toCents } from '@/lib/money';
import { PART_IMAGE_MIME_TYPES, PART_TAG_KEYS } from '@/lib/constants';
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
      billAttn: String(formData.get('billAttn') ?? '').trim() || null,
      billEmail: String(formData.get('billEmail') ?? '').trim().toLowerCase() || null,
      billLine1: String(formData.get('billLine1') ?? '').trim() || null,
      billCity: String(formData.get('billCity') ?? '').trim() || null,
      billProvince: String(formData.get('billProvince') ?? '').trim() || null,
      billPostal: String(formData.get('billPostal') ?? '').trim() || null,
      gstExempt: formData.get('gstExempt') === 'on',
      provincialExempt: formData.get('provincialExempt') === 'on',
      taxExemptNumber: String(formData.get('taxExemptNumber') ?? '').trim() || null,
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

// ── Part photos ──────────────────────────────────────────────────────────────

/**
 * Attach a photo to a part.
 *
 * Almost nothing in the catalogue has one, and nobody is going to shoot 1,380
 * parts — so this is built for the one-at-a-time case: whoever is looking at a
 * part that keeps getting ordered takes a picture on their phone and drops it
 * here. The upload is normalised and re-encoded on the way in, because a phone
 * photo is several megabytes and rotated by EXIF.
 */
export async function uploadPartImage(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireAdmin();
  const partId = String(formData.get('partId') ?? '');
  const file = formData.get('photo');

  if (!partId) return { error: 'No part given.' };
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a photo first.' };
  if (!PART_IMAGE_MIME_TYPES.includes(file.type)) {
    return { error: 'Photos must be JPEG, PNG or WebP.' };
  }
  if (!storageReady()) {
    return { error: 'Photo storage is not configured yet.' };
  }

  const part = await prisma.part.findUnique({
    where: { id: partId },
    select: { imageStorageKey: true },
  });
  if (!part) return { error: 'That part no longer exists.' };

  const { normalizeImage } = await import('@/lib/image');
  const { newKey, putObject, deleteObject } = await import('@/lib/storage');

  const normalized = await normalizeImage(Buffer.from(await file.arrayBuffer()));
  const key = newKey('parts', '.webp');
  await putObject(key, normalized.buffer, normalized.mime);

  await prisma.part.update({
    where: { id: partId },
    data: {
      imageStorageKey: key,
      imageMime: normalized.mime,
      imageSizeBytes: normalized.bytes,
    },
  });

  // Only bin the old one once the new one is safely stored and pointed at.
  if (part.imageStorageKey) {
    await deleteObject(part.imageStorageKey).catch(() => {});
  }

  await audit({
    actorId: user.userId,
    actorName: user.name,
    action: 'part.photo',
    entity: 'Part',
    entityId: partId,
    detail: `${(normalized.bytes / 1024).toFixed(0)}KB`,
  });

  revalidatePath(`/admin/parts/${partId}`);
  revalidatePath('/catalogue');
  revalidatePath('/staff');
  return { ok: true, message: 'Photo added.' };
}

export async function removePartImage(partId: string): Promise<void> {
  const user = await requireAdmin();
  const part = await prisma.part.findUnique({
    where: { id: partId },
    select: { imageStorageKey: true },
  });

  await prisma.part.update({
    where: { id: partId },
    data: { imageStorageKey: null, imageMime: null, imageSizeBytes: null },
  });

  if (part?.imageStorageKey) {
    const { deleteObject } = await import('@/lib/storage');
    await deleteObject(part.imageStorageKey).catch(() => {});
  }

  await audit({
    actorId: user.userId,
    actorName: user.name,
    action: 'part.photoRemove',
    entity: 'Part',
    entityId: partId,
  });

  revalidatePath(`/admin/parts/${partId}`);
  revalidatePath('/catalogue');
}

/** Save the editable fields on one part. */
export async function savePart(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const partId = String(formData.get('partId') ?? '');
  if (!partId) return { error: 'No part given.' };

  const rawPrice = String(formData.get('dealerPrice') ?? '').trim();
  const dealerCents = rawPrice === '' ? null : toCents(rawPrice);
  if (rawPrice !== '' && dealerCents === null) {
    return { error: 'That price is not a number.' };
  }

  const tags = PART_TAG_KEYS.filter((t) => formData.get(`tag_${t}`) === 'on');
  const fitsSkus = String(formData.get('fitsSkus') ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  return updatePart(partId, {
    categoryId: String(formData.get('categoryId') ?? '') || null,
    fulfilledBy: formData.get('fulfilledBy') === 'SUPPLIER' ? 'SUPPLIER' : 'HEAD_OFFICE',
    dealerCents,
    active: formData.get('active') === 'on',
    tags,
    fitsSkus,
  });
}

// ── Sales tax ────────────────────────────────────────────────────────────────

/**
 * Who we are to the CRA. The rates themselves are not set here — they come
 * from the ship-to province (see saveTaxRegion below and lib/tax.ts).
 */
export async function saveTaxRegistration(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireAdmin();

  const gstNumber = String(formData.get('gstNumber') ?? '').trim() || null;
  const qstNumber = String(formData.get('qstNumber') ?? '').trim() || null;
  const chargeTax = formData.get('chargeTax') === 'on';

  // An invoice that charges tax without showing a registration number is not
  // a valid one, so the switch cannot be turned on without the number.
  if (chargeTax && !gstNumber) {
    return { error: 'Enter your GST/HST number before charging tax — it has to print on the invoice.' };
  }

  await prisma.pricingSettings.upsert({
    where: { id: 'default' },
    update: { chargeTax, gstNumber, qstNumber, updatedById: user.userId },
    create: { id: 'default', chargeTax, gstNumber, qstNumber, updatedById: user.userId },
  });

  await audit({
    actorId: user.userId,
    actorName: user.name,
    action: 'tax.registration',
    entity: 'PricingSettings',
    detail: `chargeTax=${chargeTax}`,
  });

  revalidatePath('/admin/tax');
  revalidatePath('/admin');
  return { ok: true, message: chargeTax ? 'Tax is being charged by ship-to province.' : 'Tax is off — invoices show no tax line.' };
}

/** Correct one province's rates, or say we are registered to collect there. */
export async function saveTaxRegion(
  code: string,
  data: {
    hstThou?: number | null;
    gstThou?: number | null;
    provincialThou?: number | null;
    provincialLabel?: string | null;
    collectProvincial?: boolean;
  },
): Promise<ActionState> {
  const user = await requireAdmin();

  for (const v of [data.hstThou, data.gstThou, data.provincialThou]) {
    if (v !== undefined && v !== null && (!Number.isFinite(v) || v < 0 || v > 100_000)) {
      return { error: 'A rate must be between 0 and 100 percent.' };
    }
  }

  await prisma.taxRegion.update({ where: { code }, data });

  await audit({
    actorId: user.userId,
    actorName: user.name,
    action: 'tax.region',
    entity: 'TaxRegion',
    entityId: code,
    detail: JSON.stringify(data),
  });

  revalidatePath('/admin/tax');
  return { ok: true };
}
