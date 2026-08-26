-- Midlands Medics Gala (MMG) portal — a members-only info hub for the
-- flagship gala, plus a separate, lightweight account system for
-- attendees and partner-committee members from the 7 other universities
-- involved (who aren't University of Lincoln students and can't become
-- full LACMS members via the Students' Union).
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. See README-members-setup.md for the full walkthrough.

-- ---------------------------------------------------------------------
-- Existing Lincoln members: not everyone is automatically an MMG
-- attendee or on the MMG planning committee, so these are separate,
-- committee-set flags rather than being tied to membership itself.
alter table public.members
  add column mmg_attendee boolean not null default false,
  add column mmg_committee boolean not null default false;

comment on column public.members.mmg_attendee is 'Set true to unlock the exclusive MMG portal content (location, programme, voting) for this member.';
comment on column public.members.mmg_committee is 'Set true to also unlock the MMG planning-updates feed for this member.';

-- ---------------------------------------------------------------------
-- External MMG accounts — attendees and partner-committee members from
-- the other 7 universities. They self-register on mmg-login.html; the
-- row starts as 'pending' with zero exclusive access until the
-- committee reviews it and sets access_level via Table Editor.
create table public.mmg_guests (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  university text not null,
  access_level text not null default 'pending' check (access_level in ('pending', 'attendee', 'committee')),
  created_at timestamptz not null default now()
);

alter table public.mmg_guests enable row level security;

create policy "A guest can create their own MMG account"
  on public.mmg_guests for insert
  to authenticated
  with check (auth.uid() = id);

create policy "A guest can read their own MMG account"
  on public.mmg_guests for select
  to authenticated
  using (auth.uid() = id);

comment on column public.mmg_guests.access_level is 'pending (default, no exclusive access) / attendee / committee — set by the committee via Table Editor after reviewing the signup.';

-- ---------------------------------------------------------------------
-- Shared access-check helpers, used by every MMG RLS policy below so the
-- "is this person a Lincoln member OR an external guest with enough
-- access" logic lives in one place instead of being repeated.
create or replace function public.mmg_has_attendee_access()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    exists (select 1 from public.members m where m.id = auth.uid() and (m.mmg_attendee or m.mmg_committee))
    or exists (select 1 from public.mmg_guests g where g.id = auth.uid() and g.access_level in ('attendee', 'committee'));
$$;

create or replace function public.mmg_has_committee_access()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    exists (select 1 from public.members m where m.id = auth.uid() and m.mmg_committee)
    or exists (select 1 from public.mmg_guests g where g.id = auth.uid() and g.access_level = 'committee');
$$;

-- ---------------------------------------------------------------------
-- Planning updates — committee-only feed (Lincoln + partner-university
-- committee members) for sharing planning progress and key details.
create table public.mmg_updates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  pinned boolean not null default false,
  is_active boolean not null default true,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.mmg_updates enable row level security;

create policy "MMG committee can view active planning updates"
  on public.mmg_updates for select
  to authenticated
  using (is_active = true and public.mmg_has_committee_access());

-- ---------------------------------------------------------------------
-- Awards voting — write-in, one vote per category per person (upsertable
-- so a voter can change their mind while voting is open), viewable by
-- anyone with at least attendee-level access.
create table public.mmg_award_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  voting_open boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.mmg_award_categories enable row level security;

create policy "MMG attendees can view active award categories"
  on public.mmg_award_categories for select
  to authenticated
  using (is_active = true and public.mmg_has_attendee_access());

create table public.mmg_votes (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.mmg_award_categories(id) on delete cascade,
  voter_id uuid not null references auth.users(id) on delete cascade,
  nominee_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, voter_id)
);

alter table public.mmg_votes enable row level security;

create policy "A voter can view their own votes"
  on public.mmg_votes for select
  to authenticated
  using (voter_id = auth.uid());

create policy "A voter can cast their own vote"
  on public.mmg_votes for insert
  to authenticated
  with check (
    voter_id = auth.uid()
    and public.mmg_has_attendee_access()
    and exists (select 1 from public.mmg_award_categories c where c.id = category_id and c.voting_open = true)
  );

create policy "A voter can change their own vote while voting is open"
  on public.mmg_votes for update
  to authenticated
  using (voter_id = auth.uid())
  with check (
    voter_id = auth.uid()
    and public.mmg_has_attendee_access()
    and exists (select 1 from public.mmg_award_categories c where c.id = category_id and c.voting_open = true)
  );
