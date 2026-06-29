import { NextRequest, NextResponse } from 'next/server';
import { handleMessage } from '@/lib/agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// DEV ONLY. Lets you exercise the full agent loop (extract → resolve → confirm
// → commit) without WhatsApp wired up. It writes to your real Supabase but
// captures the agent's replies and returns them instead of sending over WA.
//
// Enable by setting ALLOW_DEV_SIMULATE=true. Turn it OFF in production.
//
//   curl -X POST https://localhost:3000/api/dev/simulate \
//        -H 'Content-Type: application/json' \
//        -d '{"phone":"447911123456","text":"Spoke to Sara at Acme, keen, ~£50k, follow up Tuesday"}'
//
// Send the same phone "yes" as a second call to commit the parked write.

export async function POST(req: NextRequest) {
  if (process.env.ALLOW_DEV_SIMULATE !== 'true') {
    return NextResponse.json({ ok: false, error: 'disabled' }, { status: 403 });
  }

  const { phone, text } = await req.json().catch(() => ({}));
  if (!phone || !text) {
    return NextResponse.json({ ok: false, error: 'phone and text required' }, { status: 400 });
  }

  const replies: string[] = [];
  await handleMessage(String(phone), String(text), async (m) => { replies.push(m); });

  return NextResponse.json({ ok: true, replies });
}
