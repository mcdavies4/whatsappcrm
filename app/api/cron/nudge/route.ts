import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendText, sendTemplate } from '@/lib/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Hit hourly by Vercel Cron. Pings the owning rep about due follow-ups, once
// each (nudged_at guards repeats).
//
// IMPORTANT — the 24-hour window: a rep who hasn't messaged in 24h can only be
// reached with an APPROVED TEMPLATE, not free-form text. So we send a template
// when WHATSAPP_NUDGE_TEMPLATE is set (recommended for production), and fall
// back to plain text only as a dev convenience.
//
// Template (Utility category) should have a body with two {{ }} params, e.g.:
//   "Your follow-up with {{1}} is due. {{2}} Reply DONE when it's handled."

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('unauthorized', { status: 401 });
  }

  const db = supabaseAdmin();
  const nowISO = new Date().toISOString();
  const tmpl = process.env.WHATSAPP_NUDGE_TEMPLATE;
  const lang = process.env.WHATSAPP_TEMPLATE_LANG ?? 'en';

  const { data: due } = await db
    .from('follow_ups')
    .select('id, note, due_at, contacts(name), users(phone)')
    .eq('status', 'open')
    .lte('due_at', nowISO)
    .is('nudged_at', null)
    .limit(100);

  let sent = 0;
  for (const f of (due ?? []) as any[]) {
    const phone = f.users?.phone;
    if (!phone) continue;
    const who = f.contacts?.name ?? 'a contact';
    const note = f.note ? `Note: ${f.note}.` : '';

    const ok = tmpl
      ? await sendTemplate(phone, tmpl, lang, [who, note || '-'])
      : (await sendText(phone, `⏰ Follow-up due: *${who}*${note ? ` — ${f.note}` : ''}\n\nReply "done" when it's handled.`), true);

    if (ok) {
      await db.from('follow_ups').update({ nudged_at: nowISO }).eq('id', f.id);
      sent++;
    }
  }

  return NextResponse.json({ ok: true, nudged: sent, mode: tmpl ? 'template' : 'text' });
}
