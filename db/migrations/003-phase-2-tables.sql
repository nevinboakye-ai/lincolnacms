-- Phase 2: discounts, members-first opportunities, Sankofa applications,
-- event registration, MoTM nominations.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run.

-- ---------------------------------------------------------------------
-- Partner discounts — committee adds/edits rows directly via Table Editor.
-- Locked to `authenticated` explicitly: unlike the members table, this
-- policy doesn't check auth.uid() against a row owner, so without
-- `to authenticated` an anonymous request (anyone with the public API
-- key, which is anyone who views the page source) could read it too.
-- ---------------------------------------------------------------------
create table public.discounts (
  id uuid primary key default gen_random_uuid(),
  partner_name text not null,
  description text not null,
  code text,
  link text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.discounts enable row level security;

create policy "Signed-in members can view active discounts"
  on public.discounts for select
  to authenticated
  using (is_active = true);

-- ---------------------------------------------------------------------
-- Members-first opportunities — separate from the public opportunities.html
-- placeholders; committee-managed the same way as discounts.
-- ---------------------------------------------------------------------
create table public.member_opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  link text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.member_opportunities enable row level security;

create policy "Signed-in members can view active member opportunities"
  on public.member_opportunities for select
  to authenticated
  using (is_active = true);

-- ---------------------------------------------------------------------
-- Sankofa mentor/mentee applications.
-- ---------------------------------------------------------------------
create table public.sankofa_applications (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references auth.users (id) on delete cascade,
  role_applied_for text not null check (role_applied_for in ('mentee', 'mentor')),
  statement text not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now()
);

alter table public.sankofa_applications enable row level security;

create policy "Members can view their own Sankofa applications"
  on public.sankofa_applications for select
  using (auth.uid() = member_id);

create policy "Members can submit a Sankofa application"
  on public.sankofa_applications for insert
  with check (auth.uid() = member_id);

-- ---------------------------------------------------------------------
-- Event registration. event_slug matches the id= on each .event-row in
-- events.html (e.g. "midlands-medics-gala") — there's no events table,
-- events stay hardcoded in the page same as before.
-- ---------------------------------------------------------------------
create table public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references auth.users (id) on delete cascade,
  event_slug text not null,
  event_name text not null,
  registered_at timestamptz not null default now(),
  unique (member_id, event_slug)
);

alter table public.event_registrations enable row level security;

create policy "Members can view their own event registrations"
  on public.event_registrations for select
  using (auth.uid() = member_id);

create policy "Members can register themselves for an event"
  on public.event_registrations for insert
  with check (auth.uid() = member_id);

create policy "Members can cancel their own registration"
  on public.event_registrations for delete
  using (auth.uid() = member_id);

-- ---------------------------------------------------------------------
-- MoTM nominations.
-- ---------------------------------------------------------------------
create table public.motm_nominations (
  id uuid primary key default gen_random_uuid(),
  nominator_id uuid not null references auth.users (id) on delete cascade,
  nominee_name text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.motm_nominations enable row level security;

create policy "Members can view their own nominations"
  on public.motm_nominations for select
  using (auth.uid() = nominator_id);

create policy "Members can submit a nomination"
  on public.motm_nominations for insert
  with check (auth.uid() = nominator_id);
