'use client';
import { useState } from 'react';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email.includes('@')) return;
    setBusy(true);
    const res = await fetch('/api/auth/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setSent(true);
    if (data.devLink) setDevLink(data.devLink);
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Sign in</h1>
        <p>Log your calls by voice. Enter your email and we'll send a sign-in link.</p>

        {!sent && (
          <>
            <input
              type="email" placeholder="you@company.com" value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()} autoFocus
            />
            <button onClick={submit} disabled={busy}>
              {busy ? 'Sending…' : 'Send me a link'}
            </button>
          </>
        )}

        {sent && !devLink && (
          <p style={{ marginBottom: 0 }}>
            Check your email — if that address is registered, a sign-in link is on its way.
            It expires in 15 minutes.
          </p>
        )}

        {sent && devLink && (
          <p style={{ marginBottom: 0 }}>
            Dev mode (no email configured) — <a href={devLink}>tap here to sign in</a>.
          </p>
        )}
      </div>
    </div>
  );
}
