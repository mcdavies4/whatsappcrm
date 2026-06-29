import { supabaseAdmin } from './supabase';
import { sendText } from './whatsapp';
import { extract } from './extract';
import { resolve, summarise } from './resolve';
import { AppUser, PendingPayload } from './types';

// Orchestrates one inbound message from a rep.
//   1. identify rep by phone (unknown numbers are turned away)
//   2. if a (non-expired) pending confirmation exists: yes / no / correction
//   3. otherwise classify the message and act (log / query / followup / help)
//
// `reply` is injectable so the dev simulator can capture the agent's responses
// instead of sending them over WhatsApp. Defaults to a real WhatsApp send.

type Reply = (msg: string) => Promise<void>;

const AFFIRM = /^(y|ye|yes|yeah|yep|ok|okay|confirm|save|👍|✅)\b/i;
const DENY = /^(n|no|nope|cancel|discard|stop|❌)\b/i;

const PENDING_TTL_MIN = Number(process.env.PENDING_TTL_MINUTES ?? '120');

export async function handleMessage(
  phone: string,
  text: string,
  reply: Reply = (msg) => sendText(phone, msg),
): Promise<void> {
  const db = supabaseAdmin();

  const { data: user } = await db
    .from('users')
    .select('id, team_id, phone, name, role')
    .eq('phone', phone)
    .eq('active', true)
    .single();

  if (!user) {
    await reply("You're not set up on this CRM yet. Ask your admin to add your number.");
    return;
  }
  const u = user as AppUser;

  // --- pending confirmation? (ignore ones older than the TTL) ----------------
  const cutoff = new Date(Date.now() - PENDING_TTL_MIN * 60_000).toISOString();
  const { data: pendingRows } = await db
    .from('pending_writes')
    .select('id, payload, summary')
    .eq('phone', phone)
    .eq('status', 'pending')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1);

  const pending = pendingRows?.[0];

  if (pending) {
    if (AFFIRM.test(text.trim())) {
      await commit(u, pending.payload as PendingPayload);
      await db.from('pending_writes').update({ status: 'committed' }).eq('id', pending.id);
      await reply('✅ Saved.');
      return;
    }
    if (DENY.test(text.trim())) {
      await db.from('pending_writes').update({ status: 'discarded' }).eq('id', pending.id);
      await reply('Discarded — nothing saved.');
      return;
    }
    // Anything else = a correction: drop the old proposal, re-process fresh.
    await db.from('pending_writes').update({ status: 'discarded' }).eq('id', pending.id);
  }

  // --- classify --------------------------------------------------------------
  const nowISO = new Date().toISOString();
  const result = await extract(text, nowISO);

  switch (result.intent) {
    case 'log_activity': {
      if (!result.activity) {
        await reply("I couldn't pick out what to log. Try: \"Spoke to Sarah at Acme, keen but worried about price, follow up Tuesday.\"");
        return;
      }
      const resolved = await resolve(u.team_id, result.activity);
      const payload: PendingPayload = { kind: 'log_activity', resolved, extracted: result.activity };
      const summary = summarise(payload);
      await db.from('pending_writes').insert({
        user_id: u.id, phone, payload, summary, status: 'pending',
      });
      await reply(summary);
      return;
    }
    case 'query':
      await reply(await runQuery(u, result.query_kind ?? 'other'));
      return;
    case 'complete_followup':
      await reply(await completeFollowup(u, result.followup_target ?? null));
      return;
    case 'help':
      await reply(helpText());
      return;
    default:
      await reply("Not sure what to do with that. Send a quick note about a call, ask about your pipeline, or say \"help\".");
  }
}

// --- commit: the only place that writes CRM records --------------------------
async function commit(u: AppUser, p: PendingPayload): Promise<void> {
  const db = supabaseAdmin();
  const e = p.extracted;
  const r = p.resolved;

  let companyId = r.company_id;
  if (!companyId && r.create_company && r.company_name) {
    const { data } = await db.from('companies')
      .insert({ team_id: u.team_id, name: r.company_name })
      .select('id').single();
    companyId = data?.id ?? null;
  }

  let contactId = r.contact_id;
  if (!contactId && r.create_contact) {
    const { data } = await db.from('contacts')
      .insert({ team_id: u.team_id, name: r.contact_name, company_id: companyId })
      .select('id').single();
    contactId = data?.id ?? null;
  }

  let dealId = r.deal_id;
  if (!dealId && r.create_deal) {
    const { data } = await db.from('deals').insert({
      team_id: u.team_id,
      contact_id: contactId,
      company_id: companyId,
      owner_id: u.id,
      title: e.deal_title ?? `${r.contact_name} deal`,
      stage: e.stage ?? 'lead',
      value: e.deal_value,
      currency: e.deal_currency ?? 'GBP',
    }).select('id').single();
    dealId = data?.id ?? null;
  } else if (dealId && (e.stage || e.deal_value != null)) {
    const patch: Record<string, unknown> = {};
    if (e.stage) patch.stage = e.stage;
    if (e.deal_value != null) patch.value = e.deal_value;
    if (e.deal_currency) patch.currency = e.deal_currency;
    if (Object.keys(patch).length) await db.from('deals').update(patch).eq('id', dealId);
  }

  await db.from('activities').insert({
    team_id: u.team_id,
    user_id: u.id,
    contact_id: contactId,
    deal_id: dealId,
    type: 'whatsapp',
    body: e.summary,
    sentiment: e.sentiment,
    raw_transcript: e.summary,
  });

  if (e.follow_up_at) {
    await db.from('follow_ups').insert({
      team_id: u.team_id,
      user_id: u.id,
      contact_id: contactId,
      deal_id: dealId,
      due_at: e.follow_up_at,
      note: e.follow_up_note ?? e.summary,
      status: 'open',
    });
  }
}

// --- read-side helpers -------------------------------------------------------
async function runQuery(u: AppUser, kind: string): Promise<string> {
  const db = supabaseAdmin();

  if (kind === 'open_followups') {
    const { data } = await db.from('follow_ups')
      .select('due_at, note, contacts(name)')
      .eq('user_id', u.id).eq('status', 'open')
      .order('due_at', { ascending: true }).limit(10);
    if (!data?.length) return 'No open follow-ups. 🎉';
    return '⏰ *Your follow-ups:*\n' + data.map((f: any) =>
      `• ${f.contacts?.name ?? 'someone'} — ${fmtDay(f.due_at)}${f.note ? ` (${f.note})` : ''}`,
    ).join('\n');
  }

  if (kind === 'pipeline_summary') {
    const { data } = await db.from('deals')
      .select('stage, value').eq('owner_id', u.id).not('stage', 'in', '(won,lost)');
    if (!data?.length) return 'No open deals in your pipeline yet.';
    const byStage: Record<string, number> = {};
    let total = 0;
    for (const d of data as any[]) {
      byStage[d.stage] = (byStage[d.stage] ?? 0) + 1;
      total += Number(d.value ?? 0);
    }
    const rows = Object.entries(byStage).map(([s, n]) => `• ${s}: ${n}`).join('\n');
    return `📊 *Open pipeline:*\n${rows}\n\nTotal value: ~£${Math.round(total).toLocaleString('en-GB')}`;
  }

  // default: stale contacts — not touched in 14 days
  const cutoff = new Date(Date.now() - 14 * 864e5).toISOString();
  const { data: recent } = await db.from('activities')
    .select('contact_id').eq('user_id', u.id).gte('created_at', cutoff);
  const touched = new Set((recent ?? []).map((a: any) => a.contact_id).filter(Boolean));
  const { data: contacts } = await db.from('contacts')
    .select('id, name').eq('team_id', u.team_id).limit(200);
  const stale = (contacts ?? []).filter((c: any) => !touched.has(c.id)).slice(0, 10);
  if (!stale.length) return "You're on top of everyone in the last two weeks. 👏";
  return '🕸️ *Not touched in 14 days:*\n' + stale.map((c: any) => `• ${c.name}`).join('\n');
}

async function completeFollowup(u: AppUser, target: string | null): Promise<string> {
  const db = supabaseAdmin();
  const { data } = await db.from('follow_ups')
    .select('id, contacts(name)')
    .eq('user_id', u.id).eq('status', 'open')
    .order('due_at', { ascending: true }).limit(20);
  if (!data?.length) return 'No open follow-ups to close.';

  let row: any = data[0];
  if (target) {
    const match = (data as any[]).find((f) =>
      f.contacts?.name?.toLowerCase().includes(target.toLowerCase()));
    if (match) row = match;
  }
  await db.from('follow_ups')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', row.id);
  return `✅ Closed the follow-up${row.contacts?.name ? ` with ${row.contacts.name}` : ''}.`;
}

function helpText(): string {
  return [
    '👋 *Here\'s what I can do:*',
    '',
    '• *Log a call* — just tell me what happened. Voice notes welcome.',
    '   _"Spoke to Sarah at Acme, keen but worried on price, ~£50k, follow up Tuesday."_',
    '• *Ask your pipeline* — _"who haven\'t I touched in two weeks?"_, _"show my pipeline"_, _"my follow-ups"_',
    '• *Close a task* — _"done with the Sarah follow-up"_',
    '',
    'I\'ll always show you what I\'m about to save and wait for *yes*.',
  ].join('\n');
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
