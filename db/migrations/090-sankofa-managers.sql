-- 090: choose which committee members can manage the Sankofa Circles
--
-- The Circle manager (Dashboard > Sankofa Hub) is open to whoever the Hub
-- Access rules let into both "dash_sankofa" and "sankofa_hub" (see
-- sankofa_is_admin() in 084). Until now that meant the president only.
--
-- This lets the president hand the whole manager to specific committee
-- members with one switch, and take it back again with another:
--   * Granting sets a per-person "allow" on those two features (the same
--     overrides you can see in Dashboard > Hub Access), after remembering
--     what that person had before.
--   * Revoking puts each of the two back exactly as it was.
-- Nothing else about their account changes, and every Circle-manager call is
-- still checked in the database by sankofa_is_admin(), so there is no new way
-- in. Only the president can grant or revoke.
--
-- Safe to run more than once. Needs 060, 061 and 084.

begin;

create table if not exists public.sankofa_managers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  prev_hub text not null default 'none' check (prev_hub in ('none', 'allow', 'deny')),
  prev_dash text not null default 'none' check (prev_dash in ('none', 'allow', 'deny'))
);

alter table public.sankofa_managers enable row level security;

drop policy if exists "President manages Sankofa managers" on public.sankofa_managers;
create policy "President manages Sankofa managers"
  on public.sankofa_managers for all to authenticated
  using (public.is_president()) with check (public.is_president());

revoke all on public.sankofa_managers from anon;

-- ---------------------------------------------------------------------
-- Who could be a manager, and who is. Committee members, plus anyone already
-- granted. "can_manage" is the real answer (both features allowed right now);
-- "granted" says it was switched on from here rather than by the rules.
create or replace function public.president_get_sankofa_managers()
returns table (
  user_id uuid, full_name text, member_type text, course text, year_of_study text,
  can_manage boolean, granted boolean
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
         coalesce((select d.allowed from public.hub_access_decision(m.id, 'sankofa_hub') d), false)
           and coalesce((select d.allowed from public.hub_access_decision(m.id, 'dash_sankofa') d), false),
         exists (select 1 from public.sankofa_managers sm where sm.user_id = m.id)
  from public.members m
  where m.id <> '22044cd2-6804-4142-96c4-5c475ce9347a'::uuid
    and (m.member_type in ('executive_committee', 'supporting_committee')
         or exists (select 1 from public.sankofa_managers sm where sm.user_id = m.id))
  order by (m.member_type = 'executive_committee') desc, m.full_name;
end;
$$;

revoke all on function public.president_get_sankofa_managers() from public, anon;
grant execute on function public.president_get_sankofa_managers() to authenticated;

-- ---------------------------------------------------------------------
create or replace function public.sankofa__override_state(p_user uuid, p_feature text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select case when o.allow then 'allow' else 'deny' end
                   from public.hub_access_overrides o
                   where o.user_id = p_user and o.feature = p_feature), 'none');
$$;

revoke all on function public.sankofa__override_state(uuid, text) from public, anon, authenticated;

create or replace function public.sankofa__restore_override(p_user uuid, p_feature text, p_state text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_state = 'none' then
    delete from public.hub_access_overrides where user_id = p_user and feature = p_feature;
  else
    insert into public.hub_access_overrides (user_id, feature, allow)
    values (p_user, p_feature, p_state = 'allow')
    on conflict (user_id, feature) do update set allow = excluded.allow, created_at = now();
  end if;
end;
$$;

revoke all on function public.sankofa__restore_override(uuid, text, text) from public, anon, authenticated;

create or replace function public.president_set_sankofa_manager(p_user uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sm public.sankofa_managers;
  m public.members;
begin
  if not public.is_president() then
    raise exception 'Only the president can change who manages the Circles.';
  end if;
  if p_user is null or p_user = '22044cd2-6804-4142-96c4-5c475ce9347a'::uuid then
    raise exception 'Choose a committee member.';
  end if;

  select * into sm from public.sankofa_managers where user_id = p_user;

  if coalesce(p_on, false) then
    if found then
      return;   -- already a manager
    end if;
    select * into m from public.members where id = p_user;
    if not found or m.member_type not in ('executive_committee', 'supporting_committee') then
      raise exception 'Only Executive or Supporting Committee members can manage the Circles.';
    end if;

    insert into public.sankofa_managers (user_id, added_by, prev_hub, prev_dash)
    values (p_user, auth.uid(),
            public.sankofa__override_state(p_user, 'sankofa_hub'),
            public.sankofa__override_state(p_user, 'dash_sankofa'));

    perform public.sankofa__restore_override(p_user, 'sankofa_hub', 'allow');
    perform public.sankofa__restore_override(p_user, 'dash_sankofa', 'allow');
  else
    if not found then
      return;   -- nothing to take back
    end if;
    perform public.sankofa__restore_override(p_user, 'sankofa_hub', sm.prev_hub);
    perform public.sankofa__restore_override(p_user, 'dash_sankofa', sm.prev_dash);
    delete from public.sankofa_managers where user_id = p_user;
  end if;
end;
$$;

revoke all on function public.president_set_sankofa_manager(uuid, boolean) from public, anon;
grant execute on function public.president_set_sankofa_manager(uuid, boolean) to authenticated;

commit;
