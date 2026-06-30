'use client';
import { useEffect, useState } from 'react';

type Rep = {
  id: string; name: string | null; phone: string | null;
  email: string | null; role: string; active: boolean;
};

export default function RepsManager() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [team, setTeam] = useState<string>('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('rep');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch('/api/admin/reps');
    if (res.ok) {
      const data = await res.json();
      setReps(data.reps);
      setTeam(data.team?.name ?? '');
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    setErr('');
    const res = await fetch('/api/admin/reps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, email, role }),
    });
    if (res.ok) { setName(''); setPhone(''); setEmail(''); setRole('rep'); load(); }
    else { const d = await res.json().catch(() => ({})); setErr(d.error ?? 'Could not add rep.'); }
  }

  async function toggle(id: string, active: boolean) {
    await fetch('/api/admin/reps', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, active: !active }),
    });
    load();
  }

  return (
    <>
      <div className="eyebrow">Add a rep{team ? ` · ${team}` : ''}</div>
      <div className="card">
        {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="addrow">
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="WhatsApp number (optional)"
                 value={phone} onChange={(e) => setPhone(e.target.value)} />
          <input placeholder="Email (for web app login)"
                 value={email} onChange={(e) => setEmail(e.target.value)}
                 onKeyDown={(e) => e.key === 'Enter' && add()} />
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="rep">Rep</option>
            <option value="manager">Manager</option>
          </select>
          <button onClick={add}>Add</button>
        </div>
        <p className="hint">Full international format, no “+”. This number becomes the rep’s login to the agent.</p>
      </div>

      <div className="eyebrow">Team</div>
      <div className="card">
        {loading && <div className="empty">Loading…</div>}
        {!loading && reps.length === 0 && <div className="empty">No reps yet. Add yourself above.</div>}
        {reps.map((r) => (
          <div className="row" key={r.id}>
            <div>
              <div className="who">{r.name || r.email || r.phone}</div>
              <div className="meta">{[r.phone, r.email].filter(Boolean).join(' · ') || '—'} · {r.role}</div>
            </div>
            <time>
              <button className={`toggle ${r.active ? 'on' : 'off'}`} onClick={() => toggle(r.id, r.active)}>
                {r.active ? 'Active' : 'Inactive'}
              </button>
            </time>
          </div>
        ))}
      </div>
    </>
  );
}
