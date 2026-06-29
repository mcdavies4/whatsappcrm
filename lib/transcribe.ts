// Voice-note transcription. WhatsApp voice notes arrive as OGG/Opus.
// Default provider is OpenAI Whisper because it accepts OGG directly and is
// cheap/reliable. Swap freely — the rest of the app only calls transcribe().
//
// If TRANSCRIBE_PROVIDER is unset or no key is present, we return null and the
// agent falls back to asking the rep to type it.

export async function transcribe(
  audio: Buffer,
  mimeType: string,
): Promise<string | null> {
  const provider = process.env.TRANSCRIBE_PROVIDER ?? 'openai';
  if (provider === 'openai') return transcribeOpenAI(audio, mimeType);
  console.warn(`Unknown TRANSCRIBE_PROVIDER: ${provider}`);
  return null;
}

async function transcribeOpenAI(
  audio: Buffer,
  mimeType: string,
): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.warn('OPENAI_API_KEY not set — skipping transcription');
    return null;
  }

  const ext = mimeType.includes('ogg') ? 'ogg' : 'm4a';
  const form = new FormData();
  form.append('model', process.env.TRANSCRIBE_MODEL ?? 'whisper-1');
  form.append(
    'file',
    new Blob([new Uint8Array(audio)], { type: mimeType }),
    `voice.${ext}`,
  );

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });

  if (!res.ok) {
    console.error('Transcription failed', res.status, await res.text());
    return null;
  }
  const data = (await res.json()) as { text?: string };
  return data.text?.trim() || null;
}
