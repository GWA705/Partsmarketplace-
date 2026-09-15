'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireDealer } from '@/lib/session';

/** Add to cart from the catalogue row. Adding the same part again tops it up. */
export async function addToCart(partId: string, quantity: number): Promise<{ ok: boolean; error?: string }> {
  const user = await requireDealer();
  const qty = Math.max(1, Math.min(9999, Math.floor(quantity || 1)));

  const part = await prisma.part.findUnique({
    where: { id: partId },
    select: { active: true },
  });
  if (!part?.active) return { ok: false, error: 'That part is no longer available.' };

  await prisma.cartLine.upsert({
    where: { userId_partId: { userId: user.userId, partId } },
    update: { quantity: { increment: qty } },
    create: { userId: user.userId, partId, quantity: qty },
  });

  revalidatePath('/catalogue');
  revalidatePath('/cart');
  return { ok: true };
}

export async function setCartQuantity(partId: string, quantity: number): Promise<void> {
  const user = await requireDealer();
  const qty = Math.floor(quantity);

  if (qty <= 0) {
    await prisma.cartLine.deleteMany({ where: { userId: user.userId, partId } });
  } else {
    await prisma.cartLine.upsert({
      where: { userId_partId: { userId: user.userId, partId } },
      update: { quantity: Math.min(9999, qty) },
      create: { userId: user.userId, partId, quantity: Math.min(9999, qty) },
    });
  }
  revalidatePath('/cart');
}

export async function clearCart(): Promise<void> {
  const user = await requireDealer();
  await prisma.cartLine.deleteMany({ where: { userId: user.userId } });
  revalidatePath('/cart');
}
