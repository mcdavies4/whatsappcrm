import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as const;
const STAGE_COLOR: Record<string, string> = {
  lead: 'var(--s-lead)', qualified: 'var(--s-qualified)', proposal: 'var(--s-proposal)',
  negotiation: 'var(--s-negotiation)', won: 'var(--s-won)', lost: 'var(--s-lost)',
};

function money(v: number, ccy = 'GBP') {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency', currency: ccy, maximumFractionDigits: 0,
    }).format(v);
  } catch { return `£${Math.round(v).toLocaleString('en-GB')}`; }
}
function ago(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
function day(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default async function Dashboard() {
  if (!isAuthed()) redirect('/login');
  const db = supabaseAdmin();

  const [{ data: deals }, { data: overdue }, { data: activities }] = await Promise.all([
    db.from('deals').select('stage, value, currency'),
    db.from('follow_ups')
      .select('due_at, note, contacts(name), users(name)')
      .eq('status', 'open').lte('due_at', new Date().toISOString())
      .order('due_at', { ascending: true }).limit(8),
    db.from('activities')
      .select('body, sentiment, created_at, contacts(name), users(name)')
      .order('created_at', { ascending: false }).limit(10),
  ]);

  const counts: Record<string, { n: number; v: number }> = {};
  for (const s of STAGES) counts[s] = { n: 0, v: 0 };
  let openValue = 0;
  for (const d of (deals ?? []) as any[]) {
    const c = counts[d.stage] ?? (counts[d.stage] = { n: 0, v: 0 });
    c.n++; c.v += Number(d.value ?? 0);
    if (d.stage !== 'won' && d.stage !== 'lost') openValue += Number(d.value ?? 0);
  }

  return (
    <div className="wrap">
      <header className="masthead">
        <div>
          <h1>Pipeline</h1>
          <div className="sub">Open value ~{money(openValue)} · updated live from WhatsApp</div>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <a className="navlink" href="/admin">Reps</a>
          <a className="signout" href="/login">Sign out</a>
        </div>
      </header>

      <div className="eyebrow">Stages</div>
      <div className="pipeline">
        {STAGES.map((s) => (
          <div className="stage" key={s}>
            <div className="top"><span className="dot" style={{ background: STAGE_COLOR[s] }} />{s}</div>
            <div>
              <div className="count">{counts[s].n}</div>
              <div className="val">{counts[s].v ? money(counts[s].v) : '—'}</div>
            </div>
            <div className="bar" style={{ background: STAGE_COLOR[s] }} />
          </div>
        ))}
      </div>

      <div className="grid">
        <div>
          <div className="eyebrow">Overdue follow-ups</div>
          <div className="card">
            {(overdue ?? []).length === 0 && <div className="empty">Nothing overdue. The team is on top of it.</div>}
            {(overdue ?? []).map((f: any, i: number) => (
              <div className="row" key={i}>
                <div>
                  <div className="who">{f.contacts?.name ?? 'Unknown'}</div>
                  <div className="meta">{f.note ?? 'Follow up'} · {f.users?.name ?? 'unassigned'}</div>
                </div>
                <time><span className="pill warn">due {day(f.due_at)}</span></time>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="eyebrow">Latest from the field</div>
          <div className="card stream">
            {(activities ?? []).length === 0 && <div className="empty">No activity logged yet. Send your first voice note.</div>}
            {(activities ?? []).map((a: any, i: number) => (
              <div className="row" key={i}>
                <div>
                  <div className="who">{a.body}</div>
                  <div className="meta">
                    {a.contacts?.name ?? '—'} · {a.users?.name ?? 'rep'}
                    {a.sentiment && <> · <span className={`pill ${a.sentiment === 'positive' ? 'pos' : a.sentiment === 'negative' ? 'neg' : 'neu'}`}>{a.sentiment}</span></>}
                  </div>
                </div>
                <time>{ago(a.created_at)}</time>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
