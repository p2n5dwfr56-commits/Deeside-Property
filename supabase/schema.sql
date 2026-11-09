-- Deeside Property Watch: cloud database set-up. Paste into Supabase > SQL Editor and press Run (safe to run again).
-- Before running, replace YOUR-EMAIL@EXAMPLE.COM at the bottom with the email address you will log in with.

-- The whole tracking history (properties, every change, runs, notifications) in one versioned row.
create table if not exists public.app_state (
  id text primary key,
  data jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

-- The original notification emails, kept as evidence for every recorded change.
create table if not exists public.raw_messages (
  message_id text primary key,
  received_at timestamptz,
  source text,
  subject text,
  from_addr text,
  body_html text,
  body_text text,
  simulated boolean not null default false,
  stored_at timestamptz not null default now()
);

-- Who may open the dashboard. Only people listed here can read or change anything.
create table if not exists public.allowed_users (email text primary key);

alter table public.app_state enable row level security;
alter table public.raw_messages enable row level security;
alter table public.allowed_users enable row level security;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.allowed_users where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

drop policy if exists "owner reads state" on public.app_state;
drop policy if exists "owner updates state" on public.app_state;
drop policy if exists "owner reads emails" on public.raw_messages;
create policy "owner reads state" on public.app_state for select to authenticated using (public.is_owner());
create policy "owner updates state" on public.app_state for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner reads emails" on public.raw_messages for select to authenticated using (public.is_owner());
-- allowed_users has no policies: it can only be changed here in the SQL editor.
-- The scheduled check uses the secret key (kept in GitHub), which bypasses these rules; the website never has it.

insert into public.allowed_users (email) values ('YOUR-EMAIL@EXAMPLE.COM') on conflict do nothing;
