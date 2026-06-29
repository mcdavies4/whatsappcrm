import crypto from 'crypto';

// Thin wrapper over the Meta WhatsApp Cloud API (Graph v21.0).
// Mirrors the setup you used in Relink: WHATSAPP_TOKEN + WHATSAPP_PHONE_ID.

const GRAPH = 'https://graph.facebook.com/v21.0';

function token(): string {
  const t = process.env.WHATSAPP_TOKEN;
  if (!t) throw new Error('Missing WHATSAPP_TOKEN');
  return t;
}

function phoneId(): string {
  const p = process.env.WHATSAPP_PHONE_ID;
  if (!p) throw new Error('Missing WHATSAPP_PHONE_ID');
  return p;
}

// Send a plain text WhatsApp message to an E.164 number (no leading +).
export async function sendText(to: string, body: string): Promise<void> {
  const res = await fetch(`${GRAPH}/${phoneId()}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: body.slice(0, 4096), preview_url: false },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error('WhatsApp sendText failed', res.status, txt);
  }
}

// Resolve a media id to a temporary download URL, then fetch the bytes.
export async function downloadMedia(
  mediaId: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const metaRes = await fetch(`${GRAPH}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!metaRes.ok) throw new Error(`media meta lookup failed: ${metaRes.status}`);
  const meta = (await metaRes.json()) as { url: string; mime_type: string };

  const binRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!binRes.ok) throw new Error(`media download failed: ${binRes.status}`);
  const arr = await binRes.arrayBuffer();
  return { buffer: Buffer.from(arr), mimeType: meta.mime_type };
}

// Verify Meta's X-Hub-Signature-256 against the raw request body.
export function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true; // not configured -> skip (dev). Set it in prod.
  if (!signature) return false;
  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// Send an approved template message. Required to reach a rep OUTSIDE the 24-hour
// customer-service window (e.g. the cron follow-up nudge) — free-form text is
// rejected by Meta there. bodyParams fill the template's {{1}}, {{2}}, ...
export async function sendTemplate(
  to: string,
  templateName: string,
  lang: string,
  bodyParams: string[],
): Promise<boolean> {
  const components = bodyParams.length
    ? [{
        type: 'body',
        parameters: bodyParams.map((t) => ({ type: 'text', text: t || '-' })),
      }]
    : [];

  const res = await fetch(`${GRAPH}/${phoneId()}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: templateName, language: { code: lang }, components },
    }),
  });
  if (!res.ok) {
    console.error('WhatsApp sendTemplate failed', res.status, await res.text());
    return false;
  }
  return true;
}

// Best-effort read receipt so the rep sees a blue tick while we process.
export async function markRead(messageId: string): Promise<void> {
  try {
    await fetch(`${GRAPH}/${phoneId()}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    });
  } catch { /* non-critical */ }
}
