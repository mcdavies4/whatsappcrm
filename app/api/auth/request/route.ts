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

  // Always log server-side (visible only in your Vercel logs) so you can
  // retrieve the link and see Resend errors if email doesn't arrive.
  console.log('[magic-link]', clean, '->', link);

  const emailed = await sendMagicLink(clean, link);

  // If Resend isn't configured at all, hand the link back so you can still sign
  // in (dev only). If Resend IS configured but the send failed, we do NOT leak
  // the link in the response (security) — check Vercel logs for the link + error.
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ ok: true, devLink: link });
  }
  if (!emailed) {
    console.error('[magic-link] Resend send failed — link is in the log line above');
  }
  return NextResponse.json({ ok: true });
}
