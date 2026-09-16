import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { prisma } from '@/lib/db';
import { searchParts } from '@/lib/search';
import { dealerPartSelect } from '@/lib/partSelect';

/**
 * Read API for the booking portal.
 *
 * The portal calls this when it wants parts data server-side rather than in an
 * iframe — putting the parts that fit a customer's equipment onto a printed job
 * sheet, say. Authenticated with the shared link secret, not a session.
 *
 *   GET /api/parts?fits=WHCCF,UV12          Authorization: Bearer <token>
 *
 * Deliberately uses dealerPartSelect: this crosses a network boundary, so
 * neither cost nor the supplier's name leaves the building on a response that
 * something else renders. Whoever needs those looks them up in the staff
 * catalogue, where they live.
 */
export async function GET(request: Request) {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const secret = process.env.PARTS_LINK_SECRET;

  if (!secret || secret.length < 32) {
    return NextResponse.json({ error: 'Not configured.' }, { status: 503 });
  }
  try {
    await jwtVerify(token, new TextEncoder().encode(secret));
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const fits = (url.searchParams.get('fits') ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const q = url.searchParams.get('q') ?? undefined;

  if (!fits.length && !q) {
    return NextResponse.json({ error: 'Pass fits= or q=.' }, { status: 400 });
  }

  const result = await searchParts({
    q,
    fitsSkus: fits.length ? fits : undefined,
    pageSize: Math.min(100, Number(url.searchParams.get('limit') ?? 25)),
  });

  const parts = await prisma.part.findMany({
    where: { id: { in: result.ids } },
    select: dealerPartSelect,
  });
  const byId = new Map(parts.map((p) => [p.id, p]));

  return NextResponse.json({
    total: result.total,
    parts: result.ids
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({
        id: p.id,
        code: p.code,
        name: p.catalogueName || p.name,
        unit: p.unit,
        fitsSkus: p.fitsSkus,
      })),
  });
}
