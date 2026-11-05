-- 119: Hub Access also lists people who have NO LOGIN yet
--
-- The Network shows people the committee added before they had an account (pending members), and professionals
-- who have not signed up yet. Hub Access only listed people with a login (118 added everyone who has one), so
-- these people were missing and could not be given access.
--
-- Now they are listed too, marked "No account yet", showing what the rules will give them when they sign up, and
-- you can force access on or off for them. Because they have no login id yet, those choices are stored against
-- their EMAIL (hub_access_email_overrides) and apply automatically the moment someone signs up with that email.
--
-- Needs 060, 061, 091 and 118. Safe to run more than once.

begin;

create table if not exists public.hub_access_email_overrides (
  email text not null check (email = lower(btrim(email))),
  feature text not null references public.hub_access_rules (feature) on delete cascade,
  allow boolean not null,
  created_at timestamptz not null default now(),
  primary key (email, feature)
);
alter table public.hub_access_email_overrides enable row level security;
drop policy if exists "President manages hub access email overrides" on public.hub_access_email_overrides;
create policy "President manages hub access email overrides"
  on public.hub_access_email_overrides for all to authenticated
  using (public.is_president()) with check (public.is_president());

-- Same as 091's decision, plus: a choice made against someone's email counts as their override.
create or replace function public.hub_access_decision(p_user uuid, p_feature text)
returns table (allowed boolean, via text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.hub_access_rules;
  m public.members;
  ov boolean;
  v_email text;
begin
  if p_user is null then
    return query select false, 'rule'::text;
    return;
  end if;

  if p_user = '22044cd2-6804-4142-96c4-5c475ce9347a'::uuid then
    return query select true, 'president'::text;
    return;
  end if;

  select o.allow into ov
  from public.hub_access_overrides o
  where o.user_id = p_user and o.feature = p_feature;
  if found then
    return query select ov, case when ov then 'override_allow' else 'override_deny' end;
    return;
  end if;

  select lower(btrim(u.email::text)) into v_email from auth.users u where u.id = p_user;
  if v_email is not null then
    select eo.allow into ov
    from public.hub_access_email_overrides eo
    where eo.email = v_email and eo.feature = p_feature;
    if found then
      return query select ov, case when ov then 'override_allow' else 'override_deny' end;
      return;
    end if;
  end if;

  select * into r from public.hub_access_rules where feature = p_feature;
  if not found then
    return query select false, 'rule'::text;
    return;
  end if;

  select * into m from public.members where id = p_user;
  if found then
    return query select public.hub_access_rule_allows(r, 'member', m.member_type, m.course, m.committee_role), 'rule'::text;
    return;
  end if;

  if exists (
    select 1 from public.network_professionals np
    where np.user_id = p_user and np.is_active = true
  ) then
    return query select public.hub_access_rule_allows(r, 'professional', null, null, null), 'rule'::text;
    return;
  end if;

  return query select false, 'rule'::text;
end;
$$;
revoke all on function public.hub_access_decision(uuid, text) from public, anon, authenticated;

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
  with logins as (
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
  -- people with a login: the normal decision
  select p.uid, coalesce(nullif(btrim(p.fname), ''), split_part(au.email::text, '@', 1)), p.ptype, p.mtype, p.ptitle, p.pcourse, p.pyear,
         r.feature, d.allowed, d.via, au.email::text, p.pstatus, p.uid::text, true
  from logins p
  join auth.users au on au.id = p.uid
  cross join public.hub_access_rules r
  cross join lateral public.hub_access_decision(p.uid, r.feature) d

  union all

  -- committee-added members who haven't signed up yet: what the rules will give them, unless forced for their email
  select null::uuid, pm.full_name, 'member'::text, pm.member_type, pm.committee_role, pm.course, pm.year_of_study,
         r.feature,
         coalesce(eo.allow, public.hub_access_rule_allows(r, 'member', pm.member_type, pm.course, pm.committee_role)),
         case when eo.allow is true then 'override_allow' when eo.allow is false then 'override_deny' else 'rule' end,
         lower(btrim(pm.email)), 'no account yet'::text, 'email:' || lower(btrim(pm.email)), false
  from public.pending_members pm
  cross join public.hub_access_rules r
  left join public.hub_access_email_overrides eo on eo.email = lower(btrim(pm.email)) and eo.feature = r.feature
  where not exists (select 1 from auth.users u where lower(u.email::text) = lower(btrim(pm.email)))

  union all

  -- Network professionals who haven't signed up yet
  select null::uuid, np.full_name, 'professional'::text, null::text, null::text, null::text, null::text,
         r.feature,
         coalesce(eo.allow, np.is_active and public.hub_access_rule_allows(r, 'professional', null, null, null)),
         case when eo.allow is true then 'override_allow' when eo.allow is false then 'override_deny' else 'rule' end,
         lower(btrim(np.email)), 'no account yet'::text, 'email:' || lower(btrim(np.email)), false
  from public.network_professionals np
  cross join public.hub_access_rules r
  left join public.hub_access_email_overrides eo on eo.email = lower(btrim(np.email)) and eo.feature = r.feature
  where np.user_id is null and np.email is not null and btrim(np.email) <> ''
    and not exists (select 1 from auth.users u where lower(u.email::text) = lower(btrim(np.email)))
    and not exists (select 1 from public.pending_members pm where lower(btrim(pm.email)) = lower(btrim(np.email)))

  order by 2, 8;
end;
$$;
revoke all on function public.president_get_hub_access() from public, anon;
grant execute on function public.president_get_hub_access() to authenticated;

create or replace function public.president_set_hub_email_override(p_email text, p_feature text, p_mode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not public.is_president() then
    raise exception 'Only the president can change hub access.';
  end if;
  if v_email = '' or position('@' in v_email) < 2 then raise exception 'That person has no email on file.'; end if;
  if p_mode = 'default' then
    delete from public.hub_access_email_overrides where email = v_email and feature = p_feature;
  elsif p_mode in ('allow', 'deny') then
    insert into public.hub_access_email_overrides (email, feature, allow) values (v_email, p_feature, p_mode = 'allow')
    on conflict (email, feature) do update set allow = excluded.allow, created_at = now();
  else
    raise exception 'Invalid mode.';
  end if;
end;
$$;
revoke all on function public.president_set_hub_email_override(text, text, text) from public, anon;
grant execute on function public.president_set_hub_email_override(text, text, text) to authenticated;

commit;
