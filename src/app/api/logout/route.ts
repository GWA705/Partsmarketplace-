import { NextResponse } from 'next/server';
import { endSession } from '@/lib/session';

export async function POST(request: Request) {
  endSession();
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
