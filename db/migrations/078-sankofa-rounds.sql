-- Sankofa application phases ("rounds"): open and close applications from the
-- dashboard, any time, and run Phase 1, Phase 2 and so on.
--
-- Until now the mentee application closing date (11 October 2026) was written
-- into the code in four places. This replaces all of that with one table the
-- president controls:
--   * sankofa_rounds - one row per phase: its name, an on/off switch, an
--     optional opening date and closing date, and an optional message members
--     see while it's closed (e.g. "Phase 2 opens in January").
--   * The CURRENT phase is the most recently created one. A phase is OPEN when
--     its switch is on AND the date window (if any) includes now - so you can
--     flip it by hand at any moment, or set a closing date and let it close
--     itself. Starting a new phase closes the previous one automatically.
--   * Every mentee application is stamped with the phase it was made in (set
--     by the database, not the browser). Someone who applied in Phase 1 can
--     apply again in Phase 2, but only once per phase.
--   * The same trigger that used to hard-code the deadline now enforces the
--     current phase, so a closed phase really is closed, whatever the page
--     says (and the page asks the server for the time, not the visitor's clock).
--
-- Existing applications are filed under a "Phase 1" that closes at the old
-- deadline (11 October 2026, 23:59 UK), so nothing changes until you use the
-- new controls: Dashboard -> Sankofa -> "Applications" at the top.
--
-- Mentor applications (the public form for doctors) aren't part of phases;
-- they're unchanged.
--
-- Wrapped in a transaction. Run this once in Supabase: Dashboard -> SQL Editor
-- -> New query, paste, Run. Needs 054, 060 and 061 (and 025's is_president()).

begin;

create table if not exists public.sankofa_rounds (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  is_open boolean not null default false,
  opens_at timestamptz,
  closes_at timestamptz,
  message text check (message is null or char_length(message) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sankofa_rounds_window check (opens_at is null or closes_at is null or opens_at < closes_at)
);

alter table public.sankofa_rounds enable row level security;

-- Anyone may read a phase's name and whether it's open (it's shown publicly);
-- only the president's functions below can change anything.
drop policy if exists "Anyone can read Sankofa rounds" on public.sankofa_rounds;
create policy "Anyone can read Sankofa rounds"
  on public.sankofa_rounds for select
  to anon, authenticated
  using (true);
revoke insert, update, delete, truncate on public.sankofa_rounds from anon, authenticated;

alter table public.sankofa_applications
  add column if not exists round_id uuid references public.sankofa_rounds(id) on delete set null;
create index if not exists sankofa_applications_round_idx on public.sankofa_applications (round_id);

-- Phase 1 = the round that was already running, closing at the old deadline.
insert into public.sankofa_rounds (name, is_open, closes_at, message)
select 'Phase 1', true, '2026-10-11 23:59:59+01'::timestamptz, 'Keep an eye on the members hub for the next phase.'
where not exists (select 1 from public.sankofa_rounds);

update public.sankofa_applications
set round_id = (select id from public.sankofa_rounds order by created_at limit 1)
where round_id is null and role_applied_for = 'mentee';

-- ---------------------------------------------------------------------
-- open | closed (switched off) | scheduled (not yet) | ended (deadline passed)
create or replace function public.sankofa_round_state(r public.sankofa_rounds)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when not r.is_open then 'closed'
    when r.opens_at is not null and now() < r.opens_at then 'scheduled'
    when r.closes_at is not null and now() > r.closes_at then 'ended'
    else 'open'
  end;
$$;

-- The phase members see: the most recently created one.
create or replace function public.get_sankofa_round()
returns table (
  id uuid, name text, state text, is_open boolean,
  opens_at timestamptz, closes_at timestamptz, message text,
  created_at timestamptz, server_now timestamptz
)
language sql
stable
set search_path = public
as $$
  select r.id, r.name, public.sankofa_round_state(r),
         public.sankofa_round_state(r) = 'open',
         r.opens_at, r.closes_at, r.message, r.created_at, now()
  from public.sankofa_rounds r
  order by r.created_at desc
  limit 1;
$$;

grant execute on function public.get_sankofa_round() to anon, authenticated;

-- ---------------------------------------------------------------------
-- The rule, enforced when an application is saved (replaces the hard-coded
-- 11 October deadline from 054/060).
create or replace function public.enforce_sankofa_mentee_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.sankofa_rounds;
  st text;
begin
  if new.role_applied_for = 'mentee' then
    select * into r from public.sankofa_rounds order by created_at desc limit 1;
    if not found then
      raise exception 'Sankofa applications aren''t open right now.';
    end if;
    st := public.sankofa_round_state(r);
    if st = 'scheduled' then
      raise exception '% applications haven''t opened yet.', r.name;
    elsif st <> 'open' then
      raise exception '% applications are closed right now.', r.name;
    end if;

    if not coalesce((select d.allowed from public.hub_access_decision(new.member_id, 'sankofa') d), false) then
      raise exception 'You do not currently have access to Sankofa Circle applications.';
    end if;

    if exists (
      select 1 from public.sankofa_applications a
      where a.member_id = new.member_id and a.round_id = r.id and a.role_applied_for = 'mentee'
    ) then
      raise exception 'You''ve already applied for %.', r.name;
    end if;

    new.round_id := r.id;
  end if;
  return new;
end;
$$;

drop trigger if exists sankofa_mentee_deadline on public.sankofa_applications;
drop trigger if exists sankofa_mentee_rules on public.sankofa_applications;
create trigger sankofa_mentee_rules
  before insert on public.sankofa_applications
  for each row
  execute function public.enforce_sankofa_mentee_rules();

-- ---------------------------------------------------------------------
-- President: change a phase, start a new one (everyone can read the phases
-- themselves through the table's read policy above).
create or replace function public.president_save_sankofa_round(
  p_id uuid, p_name text, p_is_open boolean, p_opens_at timestamptz, p_closes_at timestamptz, p_message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Only the president can manage Sankofa phases.';
  end if;
  if p_name is null or char_length(btrim(p_name)) = 0 then
    raise exception 'Give the phase a name.';
  end if;
  if coalesce(p_is_open, false) and p_closes_at is not null and p_closes_at <= now() then
    raise exception 'The closing date has already passed - choose a later date, or remove it.';
  end if;
  update public.sankofa_rounds
  set name = btrim(p_name),
      is_open = coalesce(p_is_open, false),
      opens_at = p_opens_at,
      closes_at = p_closes_at,
      message = nullif(btrim(coalesce(p_message, '')), ''),
      updated_at = now()
  where id = p_id;
  if not found then
    raise exception 'That phase no longer exists.';
  end if;
end;
$$;

create or replace function public.president_create_sankofa_round(
  p_name text, p_is_open boolean, p_opens_at timestamptz, p_closes_at timestamptz, p_message text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
begin
  if not public.is_president() then
    raise exception 'Only the president can manage Sankofa phases.';
  end if;
  if p_name is null or char_length(btrim(p_name)) = 0 then
    raise exception 'Give the phase a name.';
  end if;
  if coalesce(p_is_open, false) and p_closes_at is not null and p_closes_at <= now() then
    raise exception 'The closing date has already passed - choose a later date, or remove it.';
  end if;
  -- One phase at a time: starting a new one closes the old one.
  update public.sankofa_rounds set is_open = false, updated_at = now() where is_open;
  insert into public.sankofa_rounds (name, is_open, opens_at, closes_at, message)
  values (btrim(p_name), coalesce(p_is_open, false), p_opens_at, p_closes_at, nullif(btrim(coalesce(p_message, '')), ''))
  returning id into rid;
  return rid;
end;
$$;

-- Which phase each mentee application was made in (for the dashboard's filter).
create or replace function public.president_get_sankofa_application_rounds()
returns table (application_id uuid, round_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_hub_access('dash_sankofa') then
    raise exception 'Not authorized';
  end if;
  return query select a.id, a.round_id from public.sankofa_applications a where a.round_id is not null;
end;
$$;

revoke all on function public.president_save_sankofa_round(uuid, text, boolean, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.president_create_sankofa_round(text, boolean, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.president_get_sankofa_application_rounds() from public, anon;
grant execute on function public.president_save_sankofa_round(uuid, text, boolean, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.president_create_sankofa_round(text, boolean, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.president_get_sankofa_application_rounds() to authenticated;

commit;
