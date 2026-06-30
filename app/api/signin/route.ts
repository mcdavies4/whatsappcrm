import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime = 'nodejs';

// v0 access gate. Single shared password (DASHBOARD_PASSWORD) -> signed cookie.
// Replace with Supabase Auth + per-manager accounts when you add multiple teams.

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({ password: '' }));
  const expected = process.env.DASHBOARD_PASSWORD;
  const secret = process.env.DASHBOARD_COOKIE_SECRET ?? expected ?? '';

  if (!expected || password !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const token = crypto.createHmac('sha256', secret).update('authed').digest('hex');
  const res = NextResponse.json({ ok: true });
  res.cookies.set('crm_session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
