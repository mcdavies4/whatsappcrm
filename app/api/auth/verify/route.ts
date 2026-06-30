import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { attachRepSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('token');
  if (!raw) return NextResponse.redirect(new URL('/signin?error=1', req.nextUrl.origin));

  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const db = supabaseAdmin();

  const { data: token } = await db
    .from('magic_tokens')
    .select('id, user_id, expires_at, used_at')
    .eq('token_hash', hash)
    .single();

  const valid =
    token && !token.used_at && new Date(token.expires_at).getTime() > Date.now();

  if (!valid) {
    return NextResponse.redirect(new URL('/signin?error=expired', req.nextUrl.origin));
  }

  await db.from('magic_tokens').update({ used_at: new Date().toISOString() }).eq('id', token!.id);

  const res = NextResponse.redirect(new URL('/app', req.nextUrl.origin));
  return attachRepSession(res, token!.user_id);
}
