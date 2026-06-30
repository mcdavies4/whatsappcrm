# Pipeline — a WhatsApp-first CRM agent

Reps log calls by sending a WhatsApp message or voice note. The agent transcribes,
extracts structured fields with Claude, resolves the contact/company/deal,
**shows the rep exactly what it's about to save and waits for "yes"**, then writes
it. Managers get a read-only web dashboard. Follow-ups nudge the rep automatically.

```
WhatsApp ⇄ /api/whatsapp (webhook)
                │
                ├─ voice? → transcribe (Whisper)
                ├─ extract intent + fields (Claude)
                ├─ resolve "Sarah at Acme" → records
                ├─ park proposed write, echo it back ──► rep replies "yes"
                └─ commit → Supabase (contacts / deals / activities / follow_ups)

Vercel Cron (hourly) → /api/cron/nudge → "Follow-up due: Sarah" → rep
Manager → /dashboard (password) → pipeline + overdue + activity stream
```

**Stack:** Next.js 14 (App Router, TypeScript), Supabase, Meta WhatsApp Cloud API,
Anthropic API, OpenAI Whisper (transcription), Vercel + Vercel Cron.

---

## What you need before starting

- A **Supabase** project
- A **Meta** app with the **WhatsApp** product added (Business / Cloud API)
- An **Anthropic** API key
- An **OpenAI** API key (only for voice notes — text-only works without it)
- A **Vercel** account
- Node 18+ on your machine

---

## 1. Get it running locally (Windows / PowerShell)

```powershell
cd path\to\whatsapp-crm
npm install
Copy-Item .env.example .env.local
notepad .env.local   # fill in the values as you get them below
npm run build        # first sanity check — should compile clean
npm run dev          # http://localhost:3000
```

---

## 2. Supabase: create the schema

1. Create a project at supabase.com.
2. In the project: **SQL Editor → New query**, run **both** migrations in order:
   `supabase/migrations/0001_init.sql`, then `supabase/migrations/0002_hardening.sql`.
   (Or, with the Supabase CLI: `supabase db push`.)
   0002 adds pg_trgm fuzzy name-matching and the webhook dedupe table.
3. **Project Settings → API** — copy these into `.env.local`:
   - Project URL → `SUPABASE_URL`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` *(server-only, never ship to the browser)*

### Register reps

No SQL needed. Once deployed (or running locally), open **`/admin`**, sign in with
`DASHBOARD_PASSWORD`, and add reps by name + WhatsApp number (full international
format, no `+`, e.g. `447911123456`). The first rep you add auto-creates your team.
Add yourself as a `manager`. Unknown numbers are ignored by the agent, and you can
deactivate a rep anytime from the same screen.

---

## 3. Anthropic + OpenAI keys

- `ANTHROPIC_API_KEY` from console.anthropic.com. Default model `claude-sonnet-4-6`
  is set in `.env.example`.
- `OPENAI_API_KEY` from platform.openai.com (used only to transcribe voice notes).
  Leave it blank to ship text-only — voice notes will get a "please type it" reply.

---

## 4. Meta WhatsApp Cloud API

1. developers.facebook.com → **Create App** → Business → add the **WhatsApp** product.
2. **WhatsApp → API Setup**: note the **Phone number ID** → `WHATSAPP_PHONE_ID`.
   The test number works for development; add your own number for production.
3. **Permanent token:** Business Settings → System Users → create a system user,
   assign the app, generate a token with `whatsapp_business_messaging` +
   `whatsapp_business_management`. → `WHATSAPP_TOKEN`.
   *(The 24-hour token under API Setup is fine for first tests, but it expires.)*
4. **App Secret:** App Dashboard → Settings → Basic → **App Secret** →
   `WHATSAPP_APP_SECRET` (turns on request-signature verification).
5. Invent any string for `WHATSAPP_VERIFY_TOKEN` — you'll paste the same value
   into the webhook config in step 6.

> Webhook setup needs a public HTTPS URL, so finish the Vercel deploy first,
> then come back to point Meta at it.

---

## 5. Deploy to Vercel

```powershell
npm i -g vercel
vercel            # link/create the project
vercel --prod
```

Or push to GitHub and import the repo in the Vercel dashboard.

**Add every variable from `.env.local`** in Vercel → Project → Settings →
Environment Variables (Production). Redeploy after adding them.

The hourly follow-up nudge is wired by `vercel.json` (`/api/cron/nudge`). Vercel
sends `Authorization: Bearer $CRON_SECRET` automatically — just make sure
`CRON_SECRET` is set in the env.

Your webhook URL is: `https://YOUR-APP.vercel.app/api/whatsapp`

---

## 6. Point Meta at the webhook

1. **WhatsApp → Configuration → Webhook → Edit**:
   - Callback URL: `https://YOUR-APP.vercel.app/api/whatsapp`
   - Verify token: the exact `WHATSAPP_VERIFY_TOKEN` value
   - Click **Verify and save** (this hits the `GET` handler).
2. **Subscribe** the webhook to the **`messages`** field.
3. Send a WhatsApp message from your registered number to the business number.

---

## 7. Try it

Send (text or voice note):

> Just spoke to Sarah at Acme, keen but worried about price, deal's around £50k,
> follow up next Tuesday.

The agent replies with a structured summary. Reply **yes** and it's saved.
Open `https://YOUR-APP.vercel.app/dashboard`, enter `DASHBOARD_PASSWORD`, and
you'll see it in the pipeline + activity stream.

Other things reps can say:
- "who haven't I touched in two weeks?"
- "show my pipeline" · "my follow-ups"
- "done with the Sarah follow-up"
- "help"

---

## Test the agent without WhatsApp (recommended first)

Wiring Meta takes a few approval steps. To flesh out the agent logic immediately,
use the dev simulator — it runs the full loop (extract → resolve → confirm →
commit) against your real Supabase and returns the agent's replies as JSON.

1. Set `ALLOW_DEV_SIMULATE=true` (locally, or temporarily in Vercel).
2. Add yourself in `/admin` so your number is a known rep.
3. Send a message, then confirm:

```powershell
# propose a write
curl -X POST http://localhost:3000/api/dev/simulate `
  -H "Content-Type: application/json" `
  -d '{"phone":"447911123456","text":"Spoke to Sara at Acme, keen but worried on price, ~£50k, follow up Tuesday"}'

# you'll get back the structured summary in "replies". Now confirm:
curl -X POST http://localhost:3000/api/dev/simulate `
  -H "Content-Type: application/json" `
  -d '{"phone":"447911123456","text":"yes"}'
```

Watch `/dashboard` update. **Set `ALLOW_DEV_SIMULATE=false` in production.**

## WhatsApp follow-up nudges: the 24-hour window

Replies the agent sends *in response to* a rep are always inside WhatsApp's
24-hour window, so they're free-form and just work. But the **cron nudge** can
fire when a rep hasn't messaged in over 24h — there, Meta only allows an
**approved template**, not free text.

To enable production nudges:
1. Meta → WhatsApp Manager → **Message Templates → Create**. Category **Utility**.
2. Body with two placeholders, e.g.:
   `Your follow-up with {{1}} is due. {{2}} Reply DONE when it's handled.`
3. After it's approved, set `WHATSAPP_NUDGE_TEMPLATE` to the template name and
   `WHATSAPP_TEMPLATE_LANG` to its language (e.g. `en`).

If `WHATSAPP_NUDGE_TEMPLATE` is unset, nudges fall back to plain text — fine for
testing, but they'll fail to deliver to anyone outside the 24h window.

## How the safety rails work

- **Confirm-before-commit.** Every write is parked in `pending_writes` and echoed
  back; nothing touches the CRM until the rep replies *yes*. Any other reply is
  treated as a correction and re-processed. This is the single most important
  thing protecting data quality — don't remove it.
- **Conservative entity resolution.** `lib/resolve.ts` only auto-matches on an
  unambiguous case-insensitive hit within the rep's team. Two matches → it asks
  rather than guesses. New names are flagged `(new)` in the confirmation.
- **Signature verification.** Inbound requests are checked against
  `WHATSAPP_APP_SECRET`. (If unset, the check is skipped — set it in production.)
- **Webhook deduplication.** Meta retries delivery; each message id is recorded
  in `processed_messages` and processed once, so a retry never double-logs.

---

## File map

```
supabase/migrations/0001_init.sql   schema, enums, RLS, indexes
lib/whatsapp.ts                     send text, download media, verify signature
lib/transcribe.ts                   voice → text (Whisper, pluggable)
lib/extract.ts                      Claude: message → intent + fields (JSON)
lib/resolve.ts                      name → record, + the confirmation summary
lib/agent.ts                        state machine: confirm / log / query / followup
lib/supabase.ts                     service-role client (server only)
lib/auth.ts                         dashboard password gate
app/api/whatsapp/route.ts           webhook: GET verify + POST receive
app/api/cron/nudge/route.ts         hourly follow-up nudges
app/dashboard/page.tsx              manager dashboard (server component)
app/login/page.tsx                  password login
app/admin/page.tsx + RepsManager    add / deactivate reps (no SQL)
app/api/admin/reps/route.ts         reps list / add / toggle
app/api/dev/simulate/route.ts       DEV: run the agent loop without WhatsApp
supabase/migrations/0002_*.sql      pg_trgm fuzzy match + dedupe table
```

---

## Known v0 limits (deliberate — next steps, not bugs)

- **Dashboard/admin auth is a shared password.** Fine for one team. For multiple
  managers/teams, swap `lib/auth.ts` + `/api/login` for Supabase Auth and rely on
  the team-scoped RLS policies already in the migration. `getOrCreateTeam()` is
  the single-team shim to replace when you do.
- **Nudges run hourly and once per follow-up** (`nudged_at`). Tune the schedule
  in `vercel.json`; add escalation if you want repeat pings.
- **Alternative to Vercel Cron:** Supabase `pg_cron` + `pg_net` can `POST` to
  `/api/cron/nudge` instead — handy if you'd rather keep scheduling in the DB.

Already handled in this build: fuzzy name matching (pg_trgm), webhook
deduplication, a pending-write TTL (`PENDING_TTL_MINUTES`), the 24-hour template
path for nudges, and a no-SQL admin screen for reps.

---

## Cost note

WhatsApp Cloud API bills per conversation, and each message runs a Claude call
(plus a Whisper call for voice). That's fine here — a logged call is worth real
money — but it's why this model only makes sense for high-value tasks, not
trivial ones.

---

## Web recorder app (no Meta, no WhatsApp)

A second front door to the *same agent* — reps log calls from a webpage by voice
or text. Nothing about the agent changes; only the channel does. Use this to get
a working product without touching Meta.

**Run the new migration:** `supabase/migrations/0003_web_access.sql` (adds email
login + magic-link tokens; makes phone optional so a rep can be web-only).

**New env vars:** `REP_SESSION_SECRET` (required), and `RESEND_API_KEY` +
`RESEND_FROM` for the magic-link email. If Resend isn't set, the sign-in link is
returned on screen so you can still log in while testing.

**How a rep uses it:**
1. Admin adds the rep in `/admin` with an **email** (phone optional now).
2. Rep opens **`/signin`**, enters their email, gets a magic link.
3. The link signs them in and drops them on **`/app`** — the recorder.
4. They hold **Talk** (or type, or use the iPhone keyboard mic) to describe a
   call, hit **Send**, the agent replies with the structured summary, they tap
   **Yes** to save. Same confirm-before-commit as WhatsApp.
5. Manager sees it on `/dashboard` exactly as before.

**Install to phone home screen:** open `/app` in the browser → Share → Add to
Home Screen. It runs full-screen like an app (PWA manifest + icons included).

**Voice note:** the recorder uses the browser's built-in speech-to-text (Web
Speech API). It works in Chrome/Android and desktop; on some iPhones the in-page
mic isn't supported, so the app falls back to the text box — where the iPhone
keyboard's own 🎤 dictation works fine.

Both channels share `processForUser()` in `lib/agent.ts`, so the WhatsApp path
and the web path can run side by side off one brain.
