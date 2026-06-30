import { NextRequest, NextResponse } from 'next/server';
import { currentRep } from '@/lib/session';
import { processForUser } from '@/lib/agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The web equivalent of an inbound WhatsApp message. The rep is identified by
// their session (not a phone), and the agent's replies are returned as JSON for
// the page to render in a chat thread.
export async function POST(req: NextRequest) {
  const rep = await currentRep();
  if (!rep) return NextResponse.json({ ok: false, error: 'not signed in' }, { status: 401 });

  const { text } = await req.json().catch(() => ({ text: '' }));
  const clean = String(text || '').trim();
  if (!clean) return NextResponse.json({ ok: false, error: 'empty' }, { status: 400 });

  const replies: string[] = [];
  await processForUser(rep, clean, async (m) => { replies.push(m); });

  return NextResponse.json({ ok: true, replies });
}
