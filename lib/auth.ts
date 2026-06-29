import { cookies } from 'next/headers';
import crypto from 'crypto';

// Validates the v0 dashboard session cookie set by /api/login.
export function isAuthed(): boolean {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return false;
  const secret = process.env.DASHBOARD_COOKIE_SECRET ?? expected;
  const token = crypto.createHmac('sha256', secret).update('authed').digest('hex');
  const cookie = cookies().get('crm_session')?.value;
  if (!cookie) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(token));
  } catch {
    return false;
  }
}
