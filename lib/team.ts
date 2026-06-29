import { supabaseAdmin } from './supabase';

// v0 is single-team. This returns the existing team or creates one named by
// DEFAULT_TEAM_NAME. When you go multi-team, replace callers with a real
// team selector tied to the manager's account.
export async function getOrCreateTeam(): Promise<{ id: string; name: string }> {
  const db = supabaseAdmin();
  const { data: existing } = await db
    .from('teams').select('id, name').order('created_at', { ascending: true }).limit(1);
  if (existing && existing.length) return existing[0];

  const name = process.env.DEFAULT_TEAM_NAME ?? 'My Team';
  const { data, error } = await db.from('teams').insert({ name }).select('id, name').single();
  if (error || !data) throw new Error('could not create team: ' + error?.message);
  return data;
}

// Normalise a phone to E.164-without-plus (digits only). Reps must enter full
// international format (e.g. 447911123456); we can't infer a country from a 0.
export function normalizePhone(raw: string): string {
  return (raw || '').replace(/[^\d]/g, '');
}
