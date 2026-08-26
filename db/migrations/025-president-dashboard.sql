-- President's activity dashboard — a president-only view of every
-- account on the site (LACMS members, professionals, and MMG/partner-
-- university guests): whether they've finished setting up (accepted
-- their invite and set a password), when they last signed in, and
-- whether they're on the site right now.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. Needs migrations 015, 016 and 009 already applied.

-- ---------------------------------------------------------------------
-- Gate — hardcoded to one specific Supabase Auth user (not a role like
-- committee_role = 'President'), so this can never follow a data edit
-- or a future committee change without a deliberate code update.
-- Replace the UUID below if this ever needs to move to a different
-- account.
create or replace function public.is_president()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select auth.uid() = '22044cd2-6804-4142-96c4-5c475ce9347a'::uuid;
$$;

-- ---------------------------------------------------------------------
-- "Fully set up" is tracked explicitly rather than inferred from
-- auth.users — last_sign_in_at gets set the moment an invite link is
-- opened, before a password is ever chosen, so it can't reliably tell
-- "clicked the link" apart from "actually finished". activated_at is
-- set once, by the app itself, the moment updateUser({password})
-- actually succeeds (or, for MMG guests, the moment their self-signup
-- completes — there's no separate password step for them).
alter table public.members add column activated_at timestamptz;
alter table public.network_professionals add column activated_at timestamptz;
alter table public.mmg_guests add column activated_at timestamptz;

comment on column public.members.activated_at is 'Set once, automatically, the moment this person actually finishes setting their password — not just clicking the invite link. Null means invited but never completed setup.';
comment on column public.network_professionals.activated_at is 'Same as members.activated_at — set once they finish setting their password.';
comment on column public.mmg_guests.activated_at is 'Set automatically the moment a self-registered guest completes signup (no separate password step for this account type).';

-- Runs from the client the moment updateUser({password}) succeeds —
-- safe to call every time (only ever sets the timestamp once).
create or replace function public.mark_account_activated()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.members set activated_at = coalesce(activated_at, now()) where id = auth.uid();
  update public.network_professionals set activated_at = coalesce(activated_at, now()) where user_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------
-- Presence — a lightweight heartbeat, not a live socket. Every signed-
-- in page (any account type) upserts its own row every couple of
-- minutes; the dashboard treats "seen in the last 5 minutes" as
-- online. No SELECT policy for regular users — nobody needs to read
-- this except the president's own RPCs below, which bypass RLS anyway.
create table public.member_presence (
  id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

alter table public.member_presence enable row level security;

create policy "A user can upsert their own presence"
  on public.member_presence for insert
  to authenticated
  with check (id = auth.uid());

create policy "A user can update their own presence"
  on public.member_presence for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------
-- One RPC per account type — simpler and easier to reason about than a
-- single UNION across four differently-shaped tables, and matches how
-- the Network page already combines multiple sources client-side.
-- Every one of these raises if the caller isn't the president; none of
-- this data is otherwise readable by anyone (including the members
-- themselves — email and login timestamps are always private).
create or replace function public.president_get_members()
returns table (
  id uuid, full_name text, email text, course text, year_of_study text,
  member_type text, committee_role text, membership_status text,
  mmg_attendee boolean, mmg_committee boolean,
  activated_at timestamptz, last_sign_in_at timestamptz, last_seen_at timestamptz, created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  return query
    select m.id, m.full_name, u.email, m.course, m.year_of_study, m.member_type, m.committee_role,
           m.membership_status, m.mmg_attendee, m.mmg_committee,
           m.activated_at, u.last_sign_in_at, p.last_seen_at, m.created_at
    from public.members m
    join auth.users u on u.id = m.id
    left join public.member_presence p on p.id = m.id;
end;
$$;

create or replace function public.president_get_pending_members()
returns table (
  email text, full_name text, course text, year_of_study text, member_type text, created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  return query
    select pm.email, pm.full_name, pm.course, pm.year_of_study, pm.member_type, pm.created_at
    from public.pending_members pm;
end;
$$;

create or replace function public.president_get_professionals()
returns table (
  id uuid, full_name text, email text, title text, organisation text, category text,
  activated_at timestamptz, last_sign_in_at timestamptz, last_seen_at timestamptz, created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  return query
    select np.id, np.full_name, u.email, np.title, np.organisation, np.category,
           np.activated_at, u.last_sign_in_at, pr.last_seen_at, np.created_at
    from public.network_professionals np
    left join auth.users u on u.id = np.user_id
    left join public.member_presence pr on pr.id = np.user_id;
end;
$$;

create or replace function public.president_get_mmg_guests()
returns table (
  id uuid, full_name text, email text, university text, access_level text,
  activated_at timestamptz, last_sign_in_at timestamptz, last_seen_at timestamptz, created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  return query
    select g.id, g.full_name, u.email, g.university, g.access_level,
           g.activated_at, u.last_sign_in_at, p.last_seen_at, g.created_at
    from public.mmg_guests g
    join auth.users u on u.id = g.id
    left join public.member_presence p on p.id = g.id;
end;
$$;

-- ---------------------------------------------------------------------
-- Backfill — activated_at starts null for absolutely everyone, but
-- anyone who already has a login on record clearly already finished
-- setting up, whenever that was. Without this, every existing account
-- would wrongly show as "needs a nudge" on day one. last_sign_in_at is
-- the closest available estimate of when that happened (not exact, but
-- far better than leaving it blank).
update public.members m
  set activated_at = u.last_sign_in_at
  from auth.users u
  where u.id = m.id and m.activated_at is null and u.last_sign_in_at is not null;

update public.network_professionals np
  set activated_at = u.last_sign_in_at
  from auth.users u
  where u.id = np.user_id and np.activated_at is null and u.last_sign_in_at is not null;

update public.mmg_guests g
  set activated_at = u.last_sign_in_at
  from auth.users u
  where u.id = g.id and g.activated_at is null and u.last_sign_in_at is not null;
