-- ============================================================================
-- WhatsApp CRM — initial schema
-- Phone number IS the rep's identity. Reps live in WhatsApp; managers get a
-- read dashboard. Trusted server code (webhook + cron + dashboard) uses the
-- service-role key and bypasses RLS. RLS policies below are defence-in-depth
-- and the intended model once you add Supabase Auth for managers.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- enums ----------------------------------------------------------
do $$ begin
  create type deal_stage as enum
    ('lead','qualified','proposal','negotiation','won','lost');
exception when duplicate_object then null; end $$;

do $$ begin
  create type activity_type as enum
    ('call','meeting','email','note','whatsapp');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sentiment as enum ('positive','neutral','negative');
exception when duplicate_object then null; end $$;

do $$ begin
  create type followup_status as enum ('open','done','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type pending_status as enum ('pending','committed','discarded','expired');
exception when duplicate_object then null; end $$;

-- ---------- core tables ----------------------------------------------------
create table if not exists teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- A rep. The WhatsApp phone (E.164, no +) is the natural key.
create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  phone       text not null unique,          -- e.g. 447911123456
  name        text,
  role        text not null default 'rep',   -- 'rep' | 'manager'
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists companies (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  name        text not null,
  domain      text,
  created_at  timestamptz not null default now()
);
create index if not exists companies_team_idx on companies(team_id);
-- case-insensitive lookup for entity resolution
create index if not exists companies_name_lower_idx on companies(team_id, lower(name));

create table if not exists contacts (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  company_id  uuid references companies(id) on delete set null,
  name        text not null,
  phone       text,
  email       text,
  role        text,
  created_at  timestamptz not null default now()
);
create index if not exists contacts_team_idx on contacts(team_id);
create index if not exists contacts_name_lower_idx on contacts(team_id, lower(name));
create index if not exists contacts_company_idx on contacts(company_id);

create table if not exists deals (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references teams(id) on delete cascade,
  contact_id     uuid references contacts(id) on delete set null,
  company_id     uuid references companies(id) on delete set null,
  owner_id       uuid references users(id) on delete set null,
  title          text not null,
  stage          deal_stage not null default 'lead',
  value          numeric(14,2),
  currency       text not null default 'GBP',
  expected_close date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists deals_team_idx on deals(team_id);
create index if not exists deals_stage_idx on deals(team_id, stage);
create index if not exists deals_contact_idx on deals(contact_id);

-- Append-only log of every interaction. The heart of the product.
create table if not exists activities (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references teams(id) on delete cascade,
  user_id        uuid references users(id) on delete set null,
  contact_id     uuid references contacts(id) on delete set null,
  deal_id        uuid references deals(id) on delete set null,
  type           activity_type not null default 'note',
  body           text not null,
  sentiment      sentiment,
  raw_transcript text,                  -- original voice-note transcript / message
  created_at     timestamptz not null default now()
);
create index if not exists activities_team_idx on activities(team_id, created_at desc);
create index if not exists activities_contact_idx on activities(contact_id, created_at desc);
create index if not exists activities_user_idx on activities(user_id, created_at desc);

create table if not exists follow_ups (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references teams(id) on delete cascade,
  user_id       uuid references users(id) on delete set null,
  contact_id    uuid references contacts(id) on delete set null,
  deal_id       uuid references deals(id) on delete set null,
  due_at        timestamptz not null,
  note          text,
  status        followup_status not null default 'open',
  nudged_at     timestamptz,            -- last time we pinged the rep about it
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index if not exists followups_due_idx on follow_ups(status, due_at);
create index if not exists followups_user_idx on follow_ups(user_id, status, due_at);

-- Confirm-before-commit state. WhatsApp is stateless between messages, so a
-- proposed write is parked here until the rep replies "yes".
create table if not exists pending_writes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  phone       text not null,
  payload     jsonb not null,           -- the structured action awaiting confirmation
  summary     text not null,            -- human-readable echo shown to the rep
  status      pending_status not null default 'pending',
  created_at  timestamptz not null default now()
);
create index if not exists pending_phone_idx on pending_writes(phone, status, created_at desc);

-- keep deals.updated_at fresh
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists deals_touch on deals;
create trigger deals_touch before update on deals
  for each row execute function touch_updated_at();

-- ---------- RLS ------------------------------------------------------------
-- Enabled on all tables. Server code uses the service-role key (bypasses RLS).
-- These policies scope access by team once you add Supabase Auth with a
-- `team_id` claim in the JWT. Until then they simply deny anon/auth clients,
-- which is what you want.
alter table teams           enable row level security;
alter table users           enable row level security;
alter table companies       enable row level security;
alter table contacts        enable row level security;
alter table deals           enable row level security;
alter table activities      enable row level security;
alter table follow_ups      enable row level security;
alter table pending_writes  enable row level security;

-- Helper: read team_id from the JWT (null if not present).
create or replace function jwt_team_id() returns uuid as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'team_id','')::uuid;
$$ language sql stable;

-- Same-team read access for authenticated managers (once Auth is wired up).
do $$
declare t text;
begin
  foreach t in array array['companies','contacts','deals','activities','follow_ups']
  loop
    execute format($f$
      drop policy if exists %1$s_team_read on %1$s;
      create policy %1$s_team_read on %1$s
        for select to authenticated
        using (team_id = jwt_team_id());
    $f$, t);
  end loop;
end $$;

-- teams/users readable to same-team authenticated users
drop policy if exists teams_self_read on teams;
create policy teams_self_read on teams
  for select to authenticated using (id = jwt_team_id());

drop policy if exists users_team_read on users;
create policy users_team_read on users
  for select to authenticated using (team_id = jwt_team_id());

-- ---------- seed helper ----------------------------------------------------
-- Run once to create your team + register yourself as a rep. Replace values.
-- insert into teams (name) values ('The 36th Company') returning id;
-- insert into users (team_id, phone, name, role)
--   values ('<team-id>', '447911123456', 'Chukwuemeka', 'manager');
