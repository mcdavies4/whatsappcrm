import { ExtractionResult } from './types';

// Turns a rep's natural-language message into structured intent + fields using
// Claude. The same Anthropic API you used for Ledgr's receipt scanner.

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

function systemPrompt(nowISO: string): string {
  return `You convert a salesperson's casual message into structured CRM data.
The current date/time is ${nowISO}. Resolve relative dates ("next Tuesday",
"in two weeks") into absolute ISO 8601 timestamps in this same timezone offset.

Classify the message into exactly one intent:
- "log_activity": they are recording something that happened (a call, meeting, note).
- "query": they are asking about their pipeline (e.g. who they haven't contacted, open follow-ups, a pipeline summary).
- "complete_followup": they are saying a follow-up is done.
- "help": they ask what they can do / how this works.
- "unknown": none of the above / unclear.

Return ONLY a JSON object, no prose, no markdown fences, matching:
{
  "intent": "...",
  "activity": {                         // present only for log_activity
    "contact_name": string|null,
    "company_name": string|null,
    "summary": string,                  // concise cleaned note of what happened
    "sentiment": "positive"|"neutral"|"negative"|null,
    "deal_title": string|null,
    "deal_value": number|null,          // numeric only, no currency symbols
    "deal_currency": string|null,       // ISO 4217 e.g. "GBP","USD","NGN"
    "stage": "lead"|"qualified"|"proposal"|"negotiation"|"won"|"lost"|null,
    "follow_up_at": string|null,        // ISO 8601 if a next step has a date
    "follow_up_note": string|null
  },
  "query_kind": "stale_contacts"|"open_followups"|"pipeline_summary"|"other"|null,
  "followup_target": string|null        // contact/company for complete_followup
}

Rules:
- Infer currency from cues: £->GBP, $->USD, ₦ or "naira"->NGN. Default null if unclear.
- "50k" means 50000. "1.2m" means 1200000.
- Only set "stage" if the rep clearly signals movement (e.g. "sent the proposal" -> proposal, "they signed" -> won, "they passed" -> lost).
- Keep "summary" faithful; do not invent facts.`;
}

export async function extract(
  message: string,
  nowISO: string,
): Promise<ExtractionResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('Missing ANTHROPIC_API_KEY');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt(nowISO),
      messages: [{ role: 'user', content: message }],
    }),
  });

  if (!res.ok) {
    console.error('Extraction failed', res.status, await res.text());
    return { intent: 'unknown' };
  }

  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text =
    data.content?.filter((b) => b.type === 'text').map((b) => b.text).join('') ?? '';

  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned) as ExtractionResult;
  } catch {
    console.error('Could not parse extraction JSON:', text);
    return { intent: 'unknown' };
  }
}
