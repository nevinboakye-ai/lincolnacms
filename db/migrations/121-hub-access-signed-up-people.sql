-- 121: Hub Access shows the people who have SIGNED UP, one row each
--
-- Two problems with the Hub Access list after 118 and 119:
--
-- 1. IT WAS TOO BIG. The screen got one database row per person per feature (70+ people x 27 features is close
--    to 2,000 rows). Supabase silently cuts an API response off at a fixed row limit (1,000 by default), so only the
--    first part of the alphabet came through: "only a select few". Now there is ONE ROW PER PERSON, carrying all
--    of their access answers in a single JSON object, so 70+ people is simply 70+ rows however many features exist.
--
-- 2. IT LISTED TOO MUCH. 118 and 119 added every login (test and half-made accounts included), plus people who
--    haven't signed up. The list is back to who it is meant for: people who have signed up as a member, and
--    Network professionals who have a login. (People with no account yet can't use the hub, so there is nothing to
--    grant them; the choices already saved against emails by 119 still apply when they do sign up.)
--
-- president_get_hub_people() is what the screen uses now. The older president_get_hub_access() is kept, with the
-- same narrower list, in case anything still calls it.
--
-- Needs 060, 061, 091 and 119. Safe to run more than once.

begin;

create or replace function public.president_get_hub_people()
returns table (
  user_id uuid, full_name text, person_type text, member_type text, committee_role text,
  course text, year_of_study text, email text, account_status text, cells jsonb
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
  )
  select p.uid,
         coalesce(nullif(btrim(p.fname), ''), split_part(au.email::text, '@', 1), 'Unnamed'),
         p.ptype, p.mtype, p.ptitle, p.pcourse, p.pyear, au.email::text, p.pstatus,
         coalesce((
           select jsonb_object_agg(r.feature, jsonb_build_object('allowed', d.allowed, 'via', d.via))
           from public.hub_access_rules r
           cross join lateral public.hub_access_decision(p.uid, r.feature) d
         ), '{}'::jsonb)
  from people p
  join auth.users au on au.id = p.uid
  order by lower(coalesce(nullif(btrim(p.fname), ''), split_part(au.email::text, '@', 1)));
end;
$$;
revoke all on function public.president_get_hub_people() from public, anon;
grant execute on function public.president_get_hub_people() to authenticated;

-- The older per-feature version, now with the same narrower list.
drop function if exists public.president_get_hub_access();
create function public.president_get_hub_access()
returns table (
  user_id uuid, full_name text, person_type text, member_type text, committee_role text,
  course text, year_of_study text, feature text, allowed boolean, via text,
  email text, account_status text, person_key text, has_account boolean
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
  select h.user_id, h.full_name, h.person_type, h.member_type, h.committee_role, h.course, h.year_of_study,
         c.key, (c.value ->> 'allowed')::boolean, c.value ->> 'via', h.email, h.account_status, h.user_id::text, true
  from public.president_get_hub_people() h
  cross join lateral jsonb_each(h.cells) c
  order by 2, 8;
end;
$$;
revoke all on function public.president_get_hub_access() from public, anon;
grant execute on function public.president_get_hub_access() to authenticated;

commit;
