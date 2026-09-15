import 'server-only';
import { cache } from 'react';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import type { UserKind, StaffRole } from '@prisma/client';

/**
 * Sessions.
 *
 * Same signed-cookie approach as the booking portal, deliberately NOT the same
 * code: porting the portal's session would drag in its Role enum, which is
 * about who may dispatch a lead. Nothing here should have an opinion about
 * leads, and a dealer must never be expressible in that enum.
 *
 * Two ways in:
 *   · password — dealers, and any staff who want one
 *   · portal token — staff arriving from the booking portal, which signs a
 *     short-lived token with a shared secret so the office has one login
 *     rather than two user directories to keep in step
 */

const COOKIE_NAME = 'gwa_parts_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12;
/** Portal tokens are for one hop, so they live just long enough to make it. */
const PORTAL_TOKEN_TTL_SECONDS = 5 * 60;

export interface SessionUser {
  userId: string;
  email: string;
  name: string;
  kind: UserKind;
  staffRole: StaffRole;
  dealerId: string | null;
  dealerName: string | null;
  dealerTier: string;
}

function secret(name: 'SESSION_SECRET' | 'PARTS_LINK_SECRET'): Uint8Array {
  const s = process.env[name];
  if (!s || s.length < 32) {
    throw new Error(`${name} must be set and at least 32 characters.`);
  }
  return new TextEncoder().encode(s);
}

async function sign(payload: JWTPayload, ttl: number, key: Uint8Array): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttl)
    .sign(key);
}

export async function startSession(userId: string): Promise<void> {
  const token = await sign({ sub: userId }, SESSION_TTL_SECONDS, secret('SESSION_SECRET'));
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
}

export function endSession(): void {
  cookies().delete(COOKIE_NAME);
}

/**
 * The signed-in user, or null. Cached per request so a page that checks
 * permission in five places still costs one query.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;

  let sub: string;
  try {
    const { payload } = await jwtVerify(token, secret('SESSION_SECRET'));
    sub = String(payload.sub ?? '');
  } catch {
    return null;
  }
  if (!sub) return null;

  const user = await prisma.user.findUnique({
    where: { id: sub },
    select: {
      id: true,
      email: true,
      name: true,
      kind: true,
      staffRole: true,
      active: true,
      dealerId: true,
      dealer: { select: { name: true, tier: true, active: true } },
    },
  });
  if (!user || !user.active) return null;
  // A deactivated dealer takes its people with it.
  if (user.kind === 'DEALER' && !user.dealer?.active) return null;

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    kind: user.kind,
    staffRole: user.staffRole,
    dealerId: user.dealerId,
    dealerName: user.dealer?.name ?? null,
    dealerTier: user.dealer?.tier ?? 'STANDARD',
  };
});

/** Any signed-in user, or bounced to the login page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

/** A dealer. Staff hitting a dealer route go to their own side instead. */
export async function requireDealer(): Promise<SessionUser & { dealerId: string }> {
  const user = await requireUser();
  if (user.kind !== 'DEALER' || !user.dealerId) redirect('/staff');
  return user as SessionUser & { dealerId: string };
}

export async function requireStaff(minimum: StaffRole = 'VIEWER'): Promise<SessionUser> {
  const user = await requireUser();
  if (user.kind !== 'STAFF') redirect('/catalogue');
  const rank: Record<StaffRole, number> = { VIEWER: 0, ORDERER: 1, ADMIN: 2 };
  if (rank[user.staffRole] < rank[minimum]) redirect('/staff');
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  return requireStaff('ADMIN');
}

// ── Portal hand-off ──────────────────────────────────────────────────────────

export interface PortalClaim {
  email: string;
  name: string;
  /** What the portal says this person may do here. */
  staffRole: StaffRole;
}

/**
 * Mint a token the booking portal can hand someone. Lives here so both sides
 * share one definition of the payload; the portal imports the equivalent.
 */
export async function signPortalToken(claim: PortalClaim): Promise<string> {
  return sign(
    { email: claim.email, name: claim.name, staffRole: claim.staffRole, scope: 'STAFF' },
    PORTAL_TOKEN_TTL_SECONDS,
    secret('PARTS_LINK_SECRET'),
  );
}

/**
 * Verify a portal token and return the staff user it names, creating them on
 * first arrival. The portal is the authority on who works for us, so a new
 * name in a valid token is a new colleague, not an error.
 */
export async function acceptPortalToken(token: string): Promise<SessionUser | null> {
  let claim: PortalClaim;
  try {
    const { payload } = await jwtVerify(token, secret('PARTS_LINK_SECRET'));
    if (payload.scope !== 'STAFF') return null;
    claim = {
      email: String(payload.email ?? '').toLowerCase(),
      name: String(payload.name ?? ''),
      staffRole: (payload.staffRole as StaffRole) ?? 'VIEWER',
    };
  } catch {
    return null;
  }
  if (!claim.email) return null;

  const user = await prisma.user.upsert({
    where: { email: claim.email },
    update: { name: claim.name, staffRole: claim.staffRole, active: true },
    create: {
      email: claim.email,
      name: claim.name || claim.email,
      kind: 'STAFF',
      staffRole: claim.staffRole,
    },
    select: { id: true, email: true, name: true, kind: true, staffRole: true },
  });

  await startSession(user.id);
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    kind: user.kind,
    staffRole: user.staffRole,
    dealerId: null,
    dealerName: null,
    dealerTier: 'STANDARD',
  };
}
