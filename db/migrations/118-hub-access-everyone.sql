-- 118: Hub Access lists EVERY account
--
-- The Hub Access screen (Dashboard -> Hub Access) built its list of people from members plus ACTIVE professionals
-- only. Anyone else with a login (an MMG guest, a professional who isn't marked active, or an account that has no
-- member/professional profile yet) never appeared, so the president couldn't give them access to anything.
--
-- This replaces president_get_hub_access() so that it returns everyone who has a login:
--   member        - any row in members (active, pending or expired)
--   professional  - a Network professional with a login (active or not)
--   guest         - an MMG guest
--   other         - any other login (no profile yet)
-- Each person also comes with their email and account status, so they can be told apart and searched for.
-- Per-person overrides already work for any login (they are keyed on the login id), so nothing else changes.
--
-- Needs 060 and 061. Safe to run more than once.

begin;

drop function if exists public.president_get_hub_access();
create function public.president_get_hub_access()
returns table (
  user_id uuid, full_name text, person_type text, member_type text, committee_role text,
  course text, year_of_study text, feature text, allowed boolean, via text,
  email text, account_status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Only the president can view hub access.';
  end if;

  return query
  with people as (
    select m.id as uid, m.full_name as fname, 'member'::text as ptype, m.member_type as mtype,
           m.committee_role as ptitle, m.course as pcourse, m.year_of_study as pyear, m.membership_status::text as pstatus
    from public.members m
    union all
    select x.user_id, x.full_name, 'professional'::text, null::text, null::text, null::text, null::text,
           case when x.is_active then 'active' else 'inactive' end
    from (
      select distinct on (np.user_id) np.user_id, np.full_name, np.is_active
      from public.network_professionals np
      where np.user_id is not null
      order by np.user_id, np.is_active desc
    ) x
    where not exists (select 1 from public.members mm where mm.id = x.user_id)
    union all
    select g.id, g.full_name, 'guest'::text, null::text, null::text, null::text, null::text, 'active'::text
    from public.mmg_guests g
    where not exists (select 1 from public.members mm where mm.id = g.id)
      and not exists (select 1 from public.network_professionals np where np.user_id = g.id)
    union all
    select u.id, coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email::text, '@', 1)),
           'other'::text, null::text, null::text, null::text, null::text, 'no profile'::text
    from auth.users u
    where not exists (select 1 from public.members mm where mm.id = u.id)
      and not exists (select 1 from public.network_professionals np where np.user_id = u.id)
      and not exists (select 1 from public.mmg_guests g where g.id = u.id)
  )
  select p.uid, coalesce(nullif(btrim(p.fname), ''), split_part(au.email::text, '@', 1)), p.ptype, p.mtype, p.ptitle, p.pcourse, p.pyear,
         r.feature, d.allowed, d.via, au.email::text, p.pstatus
  from people p
  join auth.users au on au.id = p.uid
  cross join public.hub_access_rules r
  cross join lateral public.hub_access_decision(p.uid, r.feature) d
  order by 2, r.feature;
end;
$$;

revoke all on function public.president_get_hub_access() from public, anon;
grant execute on function public.president_get_hub_access() to authenticated;

commit;
