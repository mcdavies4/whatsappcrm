import { NextRequest, NextResponse } from 'next/server';
import { isAuthed } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getOrCreateTeam, normalizePhone } from '@/lib/team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function guard(): NextResponse | null {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  return null;
}

// List reps + the team they belong to.
export async function GET() {
  const blocked = guard();
  if (blocked) return blocked;

  const db = supabaseAdmin();
  const team = await getOrCreateTeam();
  const { data: reps } = await db
    .from('users')
    .select('id, name, phone, email, role, active, created_at')
    .eq('team_id', team.id)
    .order('created_at', { ascending: true });

  return NextResponse.json({ team, reps: reps ?? [] });
}

// Add a rep.
export async function POST(req: NextRequest) {
  const blocked = guard();
  if (blocked) return blocked;

  const { name, phone, email, role } = await req.json().catch(() => ({}));
  const normalized = normalizePhone(phone);
  const cleanEmail = String(email || '').trim().toLowerCase() || null;

  // A rep needs at least one identity: a WhatsApp number, an email, or both.
  if ((!normalized || normalized.length < 8) && !cleanEmail) {
    return NextResponse.json({ ok: false, error: 'Add a WhatsApp number or an email (or both).' }, { status: 400 });
  }
  if (cleanEmail && !cleanEmail.includes('@')) {
    return NextResponse.json({ ok: false, error: 'That email looks invalid.' }, { status: 400 });
  }

  const db = supabaseAdmin();
  const team = await getOrCreateTeam();
  const { error } = await db.from('users').insert({
    team_id: team.id,
    name: name?.trim() || null,
    phone: normalized && normalized.length >= 8 ? normalized : null,
    email: cleanEmail,
    role: role === 'manager' ? 'manager' : 'rep',
  });

  if (error) {
    const dupe = error.code === '23505';
    return NextResponse.json(
      { ok: false, error: dupe ? 'That number is already registered.' : error.message },
      { status: dupe ? 409 : 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

// Activate / deactivate a rep.
export async function PATCH(req: NextRequest) {
  const blocked = guard();
  if (blocked) return blocked;

  const { id, active } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ ok: false }, { status: 400 });

  const db = supabaseAdmin();
  await db.from('users').update({ active: !!active }).eq('id', id);
  return NextResponse.json({ ok: true });
}
