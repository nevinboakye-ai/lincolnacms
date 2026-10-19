-- 090: who can SEE the Sankofa Hub, and who can MANAGE it
--
--   SEE    - the Executive Committee (and the president). The "sankofa_hub" Hub
--            Access rule is set to Executive Committee only, hidden from everyone
--            else. You can still change it later in Dashboard > Hub Access.
--   MANAGE - the president, Martin Oti, and anyone else the president picks in
--            Dashboard > Sankofa Hub > Who can manage. Managing means placing
--            people in Circles, pairing mentors, scheduling meetings, posting
--            announcements and seeing the whole programme. Being on the Executive
--            Committee no longer gives that on its own.
--
-- Under the hood the manager list is the table sankofa_managers, and
-- sankofa_is_admin() (used by every Circle-manager function and policy) now
-- means "the president, or someone in that table". It no longer depends on the
-- Hub Access rules, so changing who can SEE the Hub can't change who manages it.
--
-- If an earlier version of this migration was run (it handed out managing
-- through per-person Hub Access overrides), those overrides are put back as
-- they were and the people stay on the manager list.
--
-- Note: anyone who isn't on the Executive Committee (for example student
-- participants or mentors added to the Hub earlier) will no longer see the
-- member-side Sankofa Hub until you open the rule up again.
--
-- Safe to run more than once. Needs 025, 060, 061 and 084.

begin;

-- ---------------------------------------------------------------------
-- Who can see the Hub.
insert into public.hub_access_rules (feature, allow_members, allow_professionals, member_types, courses, titles, blocked_display)
values ('sankofa_hub', true, false, array['executive_committee'], null, null, 'hidden')
on conflict (feature) do update
  set allow_members = true,
      allow_professionals = false,
      member_types = array['executive_committee'],
      courses = null,
      titles = null,
      blocked_display = 'hidden',
      updated_at = now();

-- ---------------------------------------------------------------------
-- The manager list (084 creates it on a fresh install; this makes sure it
-- exists either way).
create table if not exists public.sankofa_managers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.sankofa_managers enable row level security;

drop policy if exists "President manages Sankofa managers" on public.sankofa_managers;
create policy "President manages Sankofa managers"
  on public.sankofa_managers for all to authenticated
  using (public.is_president()) with check (public.is_president());

revoke all on public.sankofa_managers from anon;

-- Undo what an earlier version of this migration did through Hub Access
-- overrides, then drop its bookkeeping.
do $$
declare
  r record;
  f text;
  st text;
begin
  for r in select * from public.sankofa_managers loop
    foreach f in array array['sankofa_hub', 'dash_sankofa'] loop
      st := to_jsonb(r) ->> (case when f = 'sankofa_hub' then 'prev_hub' else 'prev_dash' end);
      if st is null then
        continue;   -- added by the new version: nothing to put back
      elsif st = 'none' then
        delete from public.hub_access_overrides where user_id = r.user_id and feature = f;
      else
        insert into public.hub_access_overrides (user_id, feature, allow)
        values (r.user_id, f, st = 'allow')
        on conflict (user_id, feature) do update set allow = excluded.allow;
      end if;
    end loop;
  end loop;
end;
$$;

alter table public.sankofa_managers drop column if exists prev_hub;
alter table public.sankofa_managers drop column if exists prev_dash;
drop function if exists public.sankofa__override_state(uuid, text);
drop function if exists public.sankofa__restore_override(uuid, text, text);

-- ---------------------------------------------------------------------
-- The one definition of "can manage" (same as 084; repeated here so the order
-- the migrations are run in never matters).
create or replace function public.sankofa_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_president()
      or exists (select 1 from public.sankofa_managers m where m.user_id = auth.uid());
$$;

-- The dashboard asks this to decide whether to show the Circle manager.
create or replace function public.sankofa_can_manage()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.sankofa_is_admin();
$$;

revoke all on function public.sankofa_can_manage() from public, anon;
grant execute on function public.sankofa_can_manage() to authenticated;

-- ---------------------------------------------------------------------
-- President only: the people who could be managers (the committee) plus anyone
-- already on the list, and whether each can manage right now.
drop function if exists public.president_get_sankofa_managers();
create or replace function public.president_get_sankofa_managers()
returns table (
  user_id uuid, full_name text, member_type text, course text, year_of_study text,
  can_manage boolean, is_committee boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Only the president can see who manages the Circles.';
  end if;

  return query
  select m.id,
         m.full_name,
         m.member_type,
         m.course,
         m.year_of_study,
         exists (select 1 from public.sankofa_managers sm where sm.user_id = m.id),
         m.member_type in ('executive_committee', 'supporting_committee')
  from public.members m
  where m.id <> '22044cd2-6804-4142-96c4-5c475ce9347a'::uuid
    and (m.member_type in ('executive_committee', 'supporting_committee')
         or exists (select 1 from public.sankofa_managers sm where sm.user_id = m.id))
  union all
  -- Professionals on the list (they have no members row).
  select np.user_id, np.full_name, 'professional'::text, null::text, null::text, true, false
  from public.network_professionals np
  where np.user_id is not null
    and not exists (select 1 from public.members mm where mm.id = np.user_id)
    and exists (select 1 from public.sankofa_managers sm where sm.user_id = np.user_id)
  order by 6 desc, 7 desc, 2;
end;
$$;

revoke all on function public.president_get_sankofa_managers() from public, anon;
grant execute on function public.president_get_sankofa_managers() to authenticated;

-- President only: put someone on or take them off the manager list.
-- Anyone with a LACMS login can be added (member or professional), except sixth
-- formers, who can't manage a programme they take part in.
drop function if exists public.president_set_sankofa_manager(uuid, boolean);
create or replace function public.president_set_sankofa_manager(p_user uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.members;
begin
  if not public.is_president() then
    raise exception 'Only the president can change who manages the Circles.';
  end if;
  if p_user is null or p_user = '22044cd2-6804-4142-96c4-5c475ce9347a'::uuid then
    raise exception 'Choose someone other than yourself - you always manage the Circles.';
  end if;

  if coalesce(p_on, false) then
    select * into m from public.members where id = p_user;
    if found then
      if lower(coalesce(m.course, '')) like '%sixth%' then
        raise exception 'Sixth-form students can''t manage the Circles.';
      end if;
    elsif not exists (select 1 from public.network_professionals np where np.user_id = p_user) then
      raise exception 'That person doesn''t have a LACMS account.';
    end if;

    insert into public.sankofa_managers (user_id, added_by)
    values (p_user, auth.uid())
    on conflict (user_id) do nothing;
  else
    delete from public.sankofa_managers where user_id = p_user;
  end if;
end;
$$;

revoke all on function public.president_set_sankofa_manager(uuid, boolean) from public, anon;
grant execute on function public.president_set_sankofa_manager(uuid, boolean) to authenticated;

-- President only: find anyone with a login by name, to add as a manager.
-- (Not the Sankofa "add people" search, which only finds people who aren't in the
-- Hub yet.)
create or replace function public.president_search_people_for_manager(p_query text)
returns table (user_id uuid, full_name text, kind text, detail text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q text := '%' || regexp_replace(coalesce(p_query, ''), '[%_\\]', '', 'g') || '%';
begin
  if not public.is_president() then
    raise exception 'Only the president can search for managers.';
  end if;
  if char_length(btrim(coalesce(p_query, ''))) < 2 then
    return;
  end if;
  return query
  select * from (
    select m.id, m.full_name, 'member'::text, nullif(concat_ws(' · ', m.course, m.year_of_study), '')
    from public.members m
    where m.full_name ilike q
      and m.id <> '22044cd2-6804-4142-96c4-5c475ce9347a'::uuid
      and lower(coalesce(m.course, '')) not like '%sixth%'
      and not exists (select 1 from public.sankofa_managers sm where sm.user_id = m.id)
    union all
    select np.user_id, np.full_name, 'professional'::text, nullif(concat_ws(' · ', np.title, np.organisation), '')
    from public.network_professionals np
    where np.user_id is not null and np.is_active and np.full_name ilike q
      and not exists (select 1 from public.members mm where mm.id = np.user_id)
      and not exists (select 1 from public.sankofa_managers sm where sm.user_id = np.user_id)
  ) x
  order by 2
  limit 12;
end;
$$;

revoke all on function public.president_search_people_for_manager(text) from public, anon;
grant execute on function public.president_search_people_for_manager(text) to authenticated;

-- ---------------------------------------------------------------------
-- Martin Oti (Co-Vice President) manages alongside the president from day one.
do $$
declare
  n integer;
begin
  insert into public.sankofa_managers (user_id, added_by)
  select m.id, '22044cd2-6804-4142-96c4-5c475ce9347a'::uuid
  from public.members m
  where lower(btrim(m.full_name)) like 'martin oti%'
    and lower(coalesce(m.course, '')) not like '%sixth%'
  on conflict (user_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 and not exists (
    select 1 from public.sankofa_managers sm join public.members m on m.id = sm.user_id
    where lower(btrim(m.full_name)) like 'martin oti%'
  ) then
    raise notice 'Martin Oti has no member account yet - add him from Dashboard > Sankofa Hub > Who can manage once he does.';
  end if;
end;
$$;

commit;
