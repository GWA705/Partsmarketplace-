'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { submitOrder } from '@/lib/orders';
import { SHIPPING_METHODS } from '@/lib/constants';

export interface CheckoutState {
  error?: string;
}

export async function checkout(_prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const user = await requireUser();

  const shippingMethod = String(formData.get('shippingMethod') ?? '');
  const note = String(formData.get('note') ?? '').trim() || null;
  const jobRef = String(formData.get('jobRef') ?? '').trim() || null;

  if (user.kind === 'DEALER' && !SHIPPING_METHODS.includes(shippingMethod as never)) {
    return { error: 'Choose how you want this shipped.' };
  }

  const cart = await prisma.cartLine.findMany({
    where: { userId: user.userId },
    select: { partId: true, quantity: true },
  });
  if (cart.length === 0) return { error: 'Your cart is empty.' };

  const res = await submitOrder({
    user,
    entries: cart,
    shippingMethod: shippingMethod || null,
    note,
    jobRef,
  });

  if (!res.ok) return { error: res.error ?? 'Could not submit that order.' };

  revalidatePath('/orders');
  redirect(`/orders/${res.orderId}?placed=1`);
}

export async function reorderAction(orderId: string): Promise<void> {
  const user = await requireUser();
  const { reorder } = await import('@/lib/orders');
  await reorder(user.userId, orderId);
  revalidatePath('/cart');
  redirect('/cart');
}
