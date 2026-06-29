'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit() {
    setBusy(true);
    setErr(false);
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) router.push('/dashboard');
    else setErr(true);
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Pipeline</h1>
        <p>The CRM that fills itself from WhatsApp.</p>
        {err && <div className="err">Wrong password. Try again.</div>}
        <input
          type="password"
          placeholder="Dashboard password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          autoFocus
        />
        <button onClick={submit} disabled={busy}>
          {busy ? 'Checking…' : 'Open dashboard'}
        </button>
      </div>
    </div>
  );
}
