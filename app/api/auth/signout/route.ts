import { NextRequest, NextResponse } from 'next/server';
import { clearRepSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  clearRepSession();
  return NextResponse.redirect(new URL('/signin', req.nextUrl.origin));
}
