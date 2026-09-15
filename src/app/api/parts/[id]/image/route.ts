import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/session';
import { getObject } from '@/lib/storage';

/** Part photos are never on a public URL — they come back through here. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  const part = await prisma.part.findUnique({
    where: { id: params.id },
    select: { imageStorageKey: true, imageMime: true, active: true },
  });
  if (!part?.imageStorageKey) return new NextResponse('Not found', { status: 404 });
  if (user.kind === 'DEALER' && !part.active) return new NextResponse('Not found', { status: 404 });

  const body = await getObject(part.imageStorageKey);
  if (!body) return new NextResponse('Not found', { status: 404 });

  // Buffer -> Uint8Array: Node's Buffer is not in the DOM BodyInit union.
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': part.imageMime ?? 'image/webp',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
