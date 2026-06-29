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
    .select('id, name, phone, role, active, created_at')
    .eq('team_id', team.id)
    .order('created_at', { ascending: true });

  return NextResponse.json({ team, reps: reps ?? [] });
}

// Add a rep.
export async function POST(req: NextRequest) {
  const blocked = guard();
  if (blocked) return blocked;

  const { name, phone, role } = await req.json().catch(() => ({}));
  const normalized = normalizePhone(phone);
  if (!normalized || normalized.length < 8) {
    return NextResponse.json({ ok: false, error: 'Enter a full international number, e.g. 447911123456.' }, { status: 400 });
  }

  const db = supabaseAdmin();
  const team = await getOrCreateTeam();
  const { error } = await db.from('users').insert({
    team_id: team.id,
    name: name?.trim() || null,
    phone: normalized,
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
