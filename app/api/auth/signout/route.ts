import { NextRequest, NextResponse } from 'next/server';
import { detachRepSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/signin', req.nextUrl.origin));
  return detachRepSession(res);
}
