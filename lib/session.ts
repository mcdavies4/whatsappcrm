import { cookies } from 'next/headers';
import crypto from 'crypto';
import { supabaseAdmin } from './supabase';
import { AppUser } from './types';

// Signed session for web reps. The cookie holds the user id plus an HMAC so it
// can't be forged. Separate from the manager dashboard gate in lib/auth.ts.

const COOKIE = 'rep_session';

function secret(): string {
  return process.env.REP_SESSION_SECRET ?? process.env.DASHBOARD_COOKIE_SECRET ?? 'dev-secret';
}

function sign(userId: string): string {
  const mac = crypto.createHmac('sha256', secret()).update(userId).digest('hex');
  return `${userId}.${mac}`;
}

export function setRepSession(userId: string): void {
  cookies().set(COOKIE, sign(userId), {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearRepSession(): void {
  cookies().delete(COOKIE);
}

function readUserId(): string | null {
  const raw = cookies().get(COOKIE)?.value;
  if (!raw) return null;
  const [userId, mac] = raw.split('.');
  if (!userId || !mac) return null;
  const expected = crypto.createHmac('sha256', secret()).update(userId).digest('hex');
  try {
    if (crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return userId;
  } catch { /* fallthrough */ }
  return null;
}

// Resolve the current web rep from the session cookie, or null.
export async function currentRep(): Promise<AppUser | null> {
  const userId = readUserId();
  if (!userId) return null;
  const db = supabaseAdmin();
  const { data } = await db
    .from('users')
    .select('id, team_id, phone, email, name, role')
    .eq('id', userId)
    .eq('active', true)
    .single();
  return (data as AppUser) ?? null;
}
