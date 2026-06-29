import { supabaseAdmin } from './supabase';
import { ExtractedActivity, PendingPayload } from './types';

// Maps the names the rep mentioned to existing records, using exact match first
// then pg_trgm similarity (so "Sara" finds "Sarah"). Because confirm-before-commit
// is the safety net, a fuzzy pick is allowed — but it's flagged in the summary
// with "≈" so the rep notices and can correct before anything is written.

const FUZZY_MIN = 0.45;   // below this we treat the name as new
const FUZZY_GAP = 0.10;   // top must beat 2nd by this to avoid ambiguous picks

type MatchRow = { id: string; name: string; score: number; exact: boolean };

function pick(rows: MatchRow[] | null): { row: MatchRow | null; fuzzy: boolean } {
  if (!rows || rows.length === 0) return { row: null, fuzzy: false };
  const top = rows[0];
  if (top.exact) return { row: top, fuzzy: false };
  const gapOk = rows.length === 1 || top.score - rows[1].score >= FUZZY_GAP;
  if (top.score >= FUZZY_MIN && gapOk) return { row: top, fuzzy: true };
  return { row: null, fuzzy: false };
}

export async function resolve(
  teamId: string,
  ext: ExtractedActivity,
): Promise<PendingPayload['resolved']> {
  const db = supabaseAdmin();

  // --- company ---
  let companyId: string | null = null;
  let companyName: string | null = ext.company_name ?? null;
  let createCompany = false;
  let companyFuzzy = false;
  if (ext.company_name) {
    const { data } = await db.rpc('resolve_company', {
      p_team: teamId, p_name: ext.company_name,
    });
    const { row, fuzzy } = pick(data as MatchRow[] | null);
    if (row) { companyId = row.id; companyName = row.name; companyFuzzy = fuzzy; }
    else createCompany = true;
  }

  // --- contact (scoped to the company when we resolved one) ---
  let contactId: string | null = null;
  let contactName = ext.contact_name ?? 'Unknown contact';
  let createContact = false;
  let contactFuzzy = false;
  if (ext.contact_name) {
    const { data } = await db.rpc('resolve_contact', {
      p_team: teamId, p_name: ext.contact_name, p_company: companyId,
    });
    const { row, fuzzy } = pick(data as MatchRow[] | null);
    if (row) { contactId = row.id; contactName = row.name; contactFuzzy = fuzzy; }
    else createContact = true;
  }

  // --- open deal on the resolved contact ---
  let dealId: string | null = null;
  let createDeal = false;
  if (contactId) {
    const { data } = await db
      .from('deals')
      .select('id')
      .eq('team_id', teamId)
      .eq('contact_id', contactId)
      .not('stage', 'in', '(won,lost)')
      .order('updated_at', { ascending: false })
      .limit(1);
    if (data && data.length === 1) dealId = data[0].id;
  }
  if (!dealId && (ext.deal_title || ext.deal_value || ext.stage)) createDeal = true;

  return {
    contact_id: contactId,
    contact_name: contactName,
    company_id: companyId,
    company_name: companyName,
    deal_id: dealId,
    create_contact: createContact,
    create_company: createCompany,
    create_deal: createDeal,
    contact_fuzzy: contactFuzzy,
    company_fuzzy: companyFuzzy,
  };
}

// Human-readable echo the rep confirms before anything is written.
export function summarise(p: PendingPayload): string {
  const e = p.extracted;
  const r = p.resolved;
  const lines: string[] = ['📝 *Ready to log:*'];

  lines.push(`• Contact: ${r.contact_name}${tag(r.create_contact, r.contact_fuzzy)}`);
  if (r.company_name)
    lines.push(`• Company: ${r.company_name}${tag(r.create_company, r.company_fuzzy)}`);
  lines.push(`• Note: ${e.summary}`);
  if (e.sentiment) lines.push(`• Sentiment: ${e.sentiment}`);

  if (e.deal_title || e.deal_value || e.stage || r.create_deal) {
    const val = e.deal_value != null ? ` ${fmtMoney(e.deal_value, e.deal_currency)}` : '';
    const stage = e.stage ? ` → ${e.stage}` : '';
    const title = e.deal_title ?? 'deal';
    lines.push(`• Deal: ${title}${val}${stage}${r.create_deal ? ' _(new)_' : ''}`);
  }
  if (e.follow_up_at)
    lines.push(`• Follow-up: ${fmtDate(e.follow_up_at)}${e.follow_up_note ? ` — ${e.follow_up_note}` : ''}`);

  lines.push('');
  lines.push('Reply *yes* to save, *no* to discard, or just retype to fix.');
  return lines.join('\n');
}

function tag(isNew: boolean, fuzzy: boolean): string {
  if (isNew) return ' _(new)_';
  if (fuzzy) return ' _(≈ matched — say no if wrong)_';
  return '';
}

function fmtMoney(v: number, ccy: string | null): string {
  const c = ccy ?? 'GBP';
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: c }).format(v);
  } catch { return `${c} ${v}`; }
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
