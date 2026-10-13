-- One Sankofa application per person - unless you decide otherwise.
--
-- A member was found with two mentee applications. Before phases (078) nothing
-- in the database stopped a second one: the page checked first, but two
-- browser tabs, two devices, or a double-submit could each slip one through.
-- This closes that off properly:
--   * One application per person, ever, by default. Someone who has already
--     applied can't apply again - in the same phase OR a later one - unless
--     that phase has "Let people who've already applied apply again" switched
--     on (a new switch on each phase, off unless you turn it on, e.g. for a
--     Phase 2 you want past applicants to re-enter).
--   * Race-proof: the check and the save happen under a per-person lock, so
--     two submissions at the same instant can't both get in. And, where the
--     data allows it, a unique index makes the database itself refuse a second
--     application in the same phase.
--   * The dashboard marks anyone with more than one application so you can
--     delete the extras (Dashboard -> Sankofa -> "Delete application").
--     NOTHING is deleted automatically.
--
-- Wrapped in a transaction. Run this once in Supabase: Dashboard -> SQL Editor
-- -> New query, paste, Run. Needs 078. Safe to run more than once.

begin;

alter table public.sankofa_rounds add column if not exists allow_reapply boolean not null default false;

-- ---------------------------------------------------------------------
-- The rule, with the per-person lock.
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
    -- Serialise this person's applications so two at once can't both pass.
    perform pg_advisory_xact_lock(hashtext('sankofa-app-' || new.member_id::text));

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
      where a.member_id = new.member_id and a.role_applied_for = 'mentee' and a.round_id = r.id
    ) then
      raise exception 'You''ve already applied for %.', r.name;
    end if;
    if not r.allow_reapply and exists (
      select 1 from public.sankofa_applications a
      where a.member_id = new.member_id and a.role_applied_for = 'mentee'
    ) then
      raise exception 'You''ve already applied to Sankofa - there''s one application per person.';
    end if;

    new.round_id := r.id;
  end if;
  return new;
end;
$$;

-- The database itself refuses a second application in the same phase. Skipped
-- (with a notice) if someone already has two in one phase - delete the extra
-- from the dashboard, then run this migration again.
do $$
begin
  if exists (
    select 1 from public.sankofa_applications
    where role_applied_for = 'mentee' and round_id is not null
    group by member_id, round_id having count(*) > 1
  ) then
    raise notice 'Not adding the unique index yet: someone has more than one application in the same phase. Delete the extras on the dashboard (Sankofa), then run this again. The rule is enforced regardless.';
  else
    create unique index if not exists sankofa_one_per_phase
      on public.sankofa_applications (member_id, round_id)
      where role_applied_for = 'mentee' and round_id is not null;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- The phase switch, in what the site reads and in what the president saves.
drop function if exists public.get_sankofa_round();
create function public.get_sankofa_round()
returns table (
  id uuid, name text, state text, is_open boolean,
  opens_at timestamptz, closes_at timestamptz, message text,
  created_at timestamptz, server_now timestamptz, allow_reapply boolean
)
language sql
stable
set search_path = public
as $$
  select r.id, r.name, public.sankofa_round_state(r),
         public.sankofa_round_state(r) = 'open',
         r.opens_at, r.closes_at, r.message, r.created_at, now(), r.allow_reapply
  from public.sankofa_rounds r
  order by r.created_at desc
  limit 1;
$$;
grant execute on function public.get_sankofa_round() to anon, authenticated;

drop function if exists public.president_save_sankofa_round(uuid, text, boolean, timestamptz, timestamptz, text);
create function public.president_save_sankofa_round(
  p_id uuid, p_name text, p_is_open boolean, p_opens_at timestamptz, p_closes_at timestamptz, p_message text,
  p_allow_reapply boolean default false
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
      allow_reapply = coalesce(p_allow_reapply, false),
      updated_at = now()
  where id = p_id;
  if not found then
    raise exception 'That phase no longer exists.';
  end if;
end;
$$;

drop function if exists public.president_create_sankofa_round(text, boolean, timestamptz, timestamptz, text);
create function public.president_create_sankofa_round(
  p_name text, p_is_open boolean, p_opens_at timestamptz, p_closes_at timestamptz, p_message text,
  p_allow_reapply boolean default false
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
  update public.sankofa_rounds set is_open = false, updated_at = now() where is_open;
  insert into public.sankofa_rounds (name, is_open, opens_at, closes_at, message, allow_reapply)
  values (btrim(p_name), coalesce(p_is_open, false), p_opens_at, p_closes_at,
          nullif(btrim(coalesce(p_message, '')), ''), coalesce(p_allow_reapply, false))
  returning id into rid;
  return rid;
end;
$$;

-- Which person and phase each mentee application belongs to (the dashboard uses
-- this to label phases and flag anyone who has applied more than once).
drop function if exists public.president_get_sankofa_application_rounds();
create function public.president_get_sankofa_application_rounds()
returns table (application_id uuid, round_id uuid, member_id uuid, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_hub_access('dash_sankofa') then
    raise exception 'Not authorized';
  end if;
  return query
    select a.id, a.round_id, a.member_id, a.created_at
    from public.sankofa_applications a
    where a.role_applied_for = 'mentee';
end;
$$;

revoke all on function public.president_save_sankofa_round(uuid, text, boolean, timestamptz, timestamptz, text, boolean) from public, anon;
revoke all on function public.president_create_sankofa_round(text, boolean, timestamptz, timestamptz, text, boolean) from public, anon;
revoke all on function public.president_get_sankofa_application_rounds() from public, anon;
grant execute on function public.president_save_sankofa_round(uuid, text, boolean, timestamptz, timestamptz, text, boolean) to authenticated;
grant execute on function public.president_create_sankofa_round(text, boolean, timestamptz, timestamptz, text, boolean) to authenticated;
grant execute on function public.president_get_sankofa_application_rounds() to authenticated;

commit;
