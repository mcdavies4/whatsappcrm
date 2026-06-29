import { NextRequest, NextResponse } from 'next/server';
import { verifySignature, downloadMedia, sendText, markRead } from '@/lib/whatsapp';
import { transcribe } from '@/lib/transcribe';
import { handleMessage } from '@/lib/agent';
import { alreadyProcessed } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- GET: Meta webhook verification handshake -------------------------------
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? '', { status: 200 });
  }
  return new NextResponse('forbidden', { status: 403 });
}

// --- POST: inbound messages -------------------------------------------------
export async function POST(req: NextRequest) {
  const raw = await req.text();

  if (!verifySignature(raw, req.headers.get('x-hub-signature-256'))) {
    return new NextResponse('bad signature', { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }

  // Ack Meta fast (they retry slow/failed acks), process in the background.
  processWebhook(body).catch((e) => console.error('webhook processing error', e));
  return NextResponse.json({ ok: true });
}

async function processWebhook(body: any): Promise<void> {
  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const messages = change.value?.messages ?? [];
      for (const msg of messages) {
        // Idempotency: Meta can deliver the same message id more than once.
        if (msg.id && (await alreadyProcessed(msg.id))) continue;

        const from: string = msg.from; // E.164 without '+'
        if (msg.id) markRead(msg.id);   // best-effort, don't await

        try {
          if (msg.type === 'text') {
            await handleMessage(from, msg.text.body);
          } else if (msg.type === 'audio' || msg.type === 'voice') {
            const mediaId = (msg.audio ?? msg.voice)?.id;
            const { buffer, mimeType } = await downloadMedia(mediaId);
            const text = await transcribe(buffer, mimeType);
            if (text) await handleMessage(from, text);
            else await sendText(from, "I couldn't transcribe that — mind typing it instead?");
          } else if (msg.type === 'button' || msg.type === 'interactive') {
            const txt = msg.button?.text
              ?? msg.interactive?.button_reply?.title
              ?? msg.interactive?.list_reply?.title
              ?? '';
            await handleMessage(from, txt);
          } else {
            await sendText(from, 'I can read text and voice notes. Send me a quick note about your call.');
          }
        } catch (e) {
          console.error('message handling failed', e);
          await sendText(from, 'Something went wrong saving that. Try again in a moment.').catch(() => {});
        }
      }
    }
  }
}
