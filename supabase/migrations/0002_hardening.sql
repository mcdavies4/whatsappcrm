-- ============================================================================
-- 0002 hardening
--   * pg_trgm fuzzy entity resolution (so "Sara" finds "Sarah")
--   * processed_messages for webhook idempotency (Meta retries delivery)
-- ============================================================================

create extension if not exists pg_trgm;

create index if not exists contacts_name_trgm
  on contacts using gin (name gin_trgm_ops);
create index if not exists companies_name_trgm
  on companies using gin (name gin_trgm_ops);

-- Best matches for a name within a team. Exact (case-insensitive) wins, then
-- trigram similarity. Returns up to 3 so the caller can check for ambiguity.
create or replace function resolve_contact(
  p_team uuid, p_name text, p_company uuid default null
)
returns table(id uuid, name text, score real, exact boolean) as $$
  -- word_similarity matches the query against the best-fitting part of the
  -- stored name, so "Sara" matches "Sarah Jones" (a first name alone is the
  -- common rep behaviour). We take the greater of full and word similarity.
  select c.id, c.name,
         greatest(
           similarity(lower(c.name), lower(p_name)),
           word_similarity(lower(p_name), lower(c.name))
         ) as score,
         (lower(c.name) = lower(p_name)) as exact
  from contacts c
  where c.team_id = p_team
    and (p_company is null or c.company_id = p_company)
    and (lower(c.name) = lower(p_name)
         or word_similarity(lower(p_name), lower(c.name)) > 0.4
         or similarity(lower(c.name), lower(p_name)) > 0.3)
  order by exact desc, score desc
  limit 3;
$$ language sql stable;

create or replace function resolve_company(p_team uuid, p_name text)
returns table(id uuid, name text, score real, exact boolean) as $$
  select co.id, co.name,
         greatest(
           similarity(lower(co.name), lower(p_name)),
           word_similarity(lower(p_name), lower(co.name))
         ) as score,
         (lower(co.name) = lower(p_name)) as exact
  from companies co
  where co.team_id = p_team
    and (lower(co.name) = lower(p_name)
         or word_similarity(lower(p_name), lower(co.name)) > 0.4
         or similarity(lower(co.name), lower(p_name)) > 0.3)
  order by exact desc, score desc
  limit 3;
$$ language sql stable;

-- Webhook idempotency: WhatsApp delivers (and retries) by message id. Insert
-- the id once; a duplicate insert (unique violation) means we've seen it.
create table if not exists processed_messages (
  message_id  text primary key,
  created_at  timestamptz not null default now()
);
alter table processed_messages enable row level security;

-- housekeeping: drop dedupe rows older than 7 days (optional, run via pg_cron)
create or replace function prune_processed_messages() returns void as $$
  delete from processed_messages where created_at < now() - interval '7 days';
$$ language sql;
