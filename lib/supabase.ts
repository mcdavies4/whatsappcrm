import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Service-role client. SERVER-ONLY — never import this into a client component.
// It bypasses RLS, which is correct for the trusted webhook, cron and the
// password-gated dashboard, all of which run on the server.

let _admin: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}

// Webhook idempotency. Returns true if this message id has already been seen
// (so the caller should skip it). Inserts the id on first sight.
export async function alreadyProcessed(messageId: string): Promise<boolean> {
  const db = supabaseAdmin();
  const { error } = await db.from('processed_messages').insert({ message_id: messageId });
  if (!error) return false;          // first time we've seen it
  if (error.code === '23505') return true; // unique violation -> duplicate
  console.error('dedupe insert error', error);
  return false;                      // on unknown error, process rather than drop
}
