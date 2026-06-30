-- ============================================================================
-- 0003 web access: email identity + magic-link login for the web recorder
--   Reps on the web app are identified by email (no phone needed). The phone
--   column becomes optional so a rep can exist on web only, WhatsApp only,
--   or both.
-- ============================================================================

-- phone is no longer required (web-only reps have none)
alter table users alter column phone drop not null;

-- email identity (nullable + unique when present)
alter table users add column if not exists email text;
create unique index if not exists users_email_unique
  on users (lower(email)) where email is not null;

-- Magic-link tokens. We store only a SHA-256 hash of the token; the raw token
-- lives only in the emailed link. Single-use, short-lived.
create table if not exists magic_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists magic_tokens_hash_idx on magic_tokens (token_hash);
alter table magic_tokens enable row level security;

-- housekeeping helper (optional, run via pg_cron if you like)
create or replace function prune_magic_tokens() returns void as $$
  delete from magic_tokens where expires_at < now() - interval '1 day';
$$ language sql;
