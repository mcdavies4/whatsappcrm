import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { sendMagicLink } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TTL_MIN = 15;

export async function POST(req: NextRequest) {
  const { email } = await req.json().catch(() => ({ email: '' }));
  const clean = String(email || '').trim().toLowerCase();
  if (!clean || !clean.includes('@')) {
    return NextResponse.json({ ok: false, error: 'Enter a valid email.' }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: user } = await db
    .from('users').select('id').ilike('email', clean).eq('active', true).single();

  // Always respond ok (don't reveal whether an email is registered).
  if (!user) return NextResponse.json({ ok: true });

  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const expires = new Date(Date.now() + TTL_MIN * 60_000).toISOString();

  await db.from('magic_tokens').insert({
    user_id: user.id, token_hash: hash, expires_at: expires,
  });

  const link = `${req.nextUrl.origin}/api/auth/verify?token=${raw}`;
  const emailed = await sendMagicLink(clean, link);

  // Dev convenience: if Resend isn't configured, hand the link back so you can
  // still sign in. Don't rely on this in production.
  if (!emailed && process.env.RESEND_API_KEY == null) {
    return NextResponse.json({ ok: true, devLink: link });
  }
  return NextResponse.json({ ok: true });
}
