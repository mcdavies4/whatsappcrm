'use client';
import { useEffect, useRef, useState } from 'react';

type Msg = { who: 'rep' | 'agent'; text: string };

export default function Recorder({ repName }: { repName: string }) {
  const [thread, setThread] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [listening, setListening] = useState(false);
  const [sending, setSending] = useState(false);
  const [speechOK, setSpeechOK] = useState(false);
  const recRef = useRef<any>(null);
  const baseRef = useRef('');           // text already in the box before this dictation
  const threadEndRef = useRef<HTMLDivElement>(null);

  // Set up Web Speech API if the browser supports it.
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setSpeechOK(false); return; }
    setSpeechOK(true);
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-GB';
    rec.onresult = (e: any) => {
      let chunk = '';
      for (let i = e.resultIndex; i < e.results.length; i++) chunk += e.results[i][0].transcript;
      const sep = baseRef.current && !baseRef.current.endsWith(' ') ? ' ' : '';
      setDraft((baseRef.current + sep + chunk).trimStart());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    return () => { try { rec.stop(); } catch {} };
  }, []);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread, sending]);

  function toggleMic() {
    const rec = recRef.current;
    if (!rec) return;
    if (listening) { rec.stop(); setListening(false); return; }
    baseRef.current = draft;
    try { rec.start(); setListening(true); } catch {}
  }

  async function send(textOverride?: string) {
    const text = (textOverride ?? draft).trim();
    if (!text || sending) return;
    if (listening) { recRef.current?.stop(); setListening(false); }

    setThread((t) => [...t, { who: 'rep', text }]);
    setDraft('');
    setSending(true);
    try {
      const res = await fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => ({ replies: [] }));
      const replies: string[] = data.replies ?? ['Something went wrong. Try again.'];
      setThread((t) => [...t, ...replies.map((r) => ({ who: 'agent' as const, text: r }))]);
    } catch {
      setThread((t) => [...t, { who: 'agent', text: 'Network error — try again.' }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rec-wrap">
      <header className="rec-top">
        <div>
          <div className="rec-hi">Hi {repName.split(' ')[0]}</div>
          <h1>Log a call</h1>
        </div>
        <a className="signout" href="/api/auth/signout">Sign out</a>
      </header>

      <div className="rec-thread">
        {thread.length === 0 && (
          <div className="rec-empty">
            Tell me about a call — by voice or text. For example:<br />
            <em>“Spoke to Sara at Acme, keen but worried on price, about £50k, follow up Tuesday.”</em>
          </div>
        )}
        {thread.map((m, i) => (
          <div key={i} className={`bubble ${m.who}`}>{m.text}</div>
        ))}
        {sending && <div className="bubble agent typing">…</div>}
        <div ref={threadEndRef} />
      </div>

      <div className="rec-compose">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={speechOK ? 'Hold the mic and talk, or type here…' : 'Type here — or tap the mic on your keyboard to dictate…'}
          rows={2}
        />
        <div className="rec-actions">
          {speechOK && (
            <button
              className={`mic ${listening ? 'on' : ''}`}
              onClick={toggleMic}
              aria-label={listening ? 'Stop' : 'Talk'}
            >
              {listening ? '■ Listening' : '● Talk'}
            </button>
          )}
          <div className="quick">
            <button className="chip" onClick={() => send('yes')}>Yes</button>
            <button className="chip" onClick={() => send('no')}>No</button>
          </div>
          <button className="send" onClick={() => send()} disabled={sending || !draft.trim()}>
            Send
          </button>
        </div>
        {!speechOK && (
          <p className="rec-hint">Voice recording isn’t supported in this browser. On iPhone, tap the text box and use the 🎤 on your keyboard.</p>
        )}
      </div>
    </div>
  );
}
