'use server';

import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { startSession } from '@/lib/session';
import { audit } from '@/lib/audit';

export interface LoginState {
  error?: string;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) return { error: 'Enter your email and password.' };

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true, passwordHash: true, active: true, kind: true,
      dealer: { select: { active: true } },
    },
  });

  // One message for every failure. Telling an attacker which half was wrong
  // turns the login form into a list of who has an account here.
  const generic = { error: 'That email and password do not match.' };

  if (!user || !user.passwordHash || !user.active) return generic;
  if (user.kind === 'DEALER' && !user.dealer?.active) return generic;
  if (!(await verifyPassword(password, user.passwordHash))) return generic;

  await startSession(user.id);
  await audit({ actorId: user.id, action: 'auth.login', entity: 'User', entityId: user.id });

  redirect(user.kind === 'DEALER' ? '/catalogue' : '/staff');
}
