import { NextResponse } from 'next/server';
import { acceptPortalToken } from '@/lib/session';

/**
 * Where the booking portal sends staff: /portal?token=…&to=/staff
 *
 * The portal signs a short-lived token with the shared secret; we verify it,
 * start a normal session here, and drop them where they were headed. One login
 * for the office rather than two user directories drifting apart.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? '';
  const to = url.searchParams.get('to') ?? '/staff';

  const user = await acceptPortalToken(token);
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  // Only ever bounce somewhere inside this app — a token must not be a way to
  // aim a redirect at an arbitrary host.
  const dest = to.startsWith('/') && !to.startsWith('//') ? to : '/staff';
  return NextResponse.redirect(new URL(dest, request.url));
}
