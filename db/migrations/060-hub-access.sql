-- Hub Access: the president decides, from the website, who can see and
-- use each part of the members hub - and can see exactly who currently
-- can. Replaces the access rules that were hard-coded into the page
-- scripts (Perks = any member, Sankofa = Medicine members, Network =
-- president only, ...) with rules stored here.
--
-- A rule (hub_access_rules, one row per feature) says:
--   allow_members        - members (anyone with a members row) may access
--   allow_professionals  - Network professionals may access
--   member_types         - if set, only these member types (member,
--                          executive_committee, supporting_committee,
--                          senior_sankofa_mentor, junior_sankofa_mentor);
--                          null = every type
--   courses              - if set, only members whose course contains one
--                          of these (case-insensitive, so "Medicine" also
--                          matches "Medicine BMBS BMedSci"); null = any
--   blocked_display      - what someone WITHOUT access sees on the hub:
--                          'locked' (a "coming soon" card) or 'hidden'
-- Per-person overrides (hub_access_overrides) force-allow or force-deny
-- one person on one feature, beating the rule. The president always has
-- access to everything.
--
-- Enforced server-side (not just by hiding things in the page) for:
--   perks         - the discounts table
--   news_feed     - the announcements table
--   sankofa       - new Sankofa mentee applications
--   motm_nominate - new Member of the Month nominations
--   network       - the member directory (get_network_members)
-- Everything is also reflected in the hub cards and the feature pages.
-- NOT enforced in the database: the professionals directory and the
-- "just joined" feed on the Network page (page-level only, as before).
--
-- Wrapped in a transaction: if anything below fails, nothing is applied.
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query, paste,
-- Run. Needs migrations 003, 008, 013, 015, 017, 025, 029, 054.

begin;

-- ---------------------------------------------------------------------
create table if not exists public.hub_access_rules (
  feature text primary key
    check (feature in ('perks', 'sankofa', 'network', 'motm_nominate', 'news_feed')),
  allow_members boolean not null default true,
  allow_professionals boolean not null default false,
  member_types text[],
  courses text[],
  blocked_display text not null default 'locked' check (blocked_display in ('locked', 'hidden')),
  updated_at timestamptz not null default now()
);

create table if not exists public.hub_access_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null references public.hub_access_rules(feature) on delete cascade,
  allow boolean not null,
  created_at timestamptz not null default now(),
  primary key (user_id, feature)
);

alter table public.hub_access_rules enable row level security;
alter table public.hub_access_overrides enable row level security;

drop policy if exists "President manages hub access rules" on public.hub_access_rules;
create policy "President manages hub access rules"
  on public.hub_access_rules for all to authenticated
  using (public.is_president()) with check (public.is_president());

drop policy if exists "President manages hub access overrides" on public.hub_access_overrides;
create policy "President manages hub access overrides"
  on public.hub_access_overrides for all to authenticated
  using (public.is_president()) with check (public.is_president());

-- Defaults reproduce how the hub behaved before this migration.
insert into public.hub_access_rules (feature, allow_members, allow_professionals, member_types, courses, blocked_display) values
  ('perks',         true,  false, null, null,                'locked'),
  ('sankofa',       true,  false, null, array['Medicine'],   'hidden'),
  ('network',       false, false, null, null,                'locked'),
  ('motm_nominate', true,  true,  null, null,                'hidden'),
  ('news_feed',     true,  true,  null, null,                'hidden')
on conflict (feature) do nothing;

-- ---------------------------------------------------------------------
-- The one place the rules are evaluated. Works for any user id (the
-- president's overview needs that), so it is internal only - ordinary
-- users reach it through has_hub_access()/get_my_hub_access(), which
-- only ever ask about themselves.
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

  select * into r from public.hub_access_rules where feature = p_feature;
  if not found then
    return query select false, 'rule'::text;
    return;
  end if;

  select * into m from public.members where id = p_user;
  if found then
    if not r.allow_members then
      return query select false, 'rule'::text;
      return;
    end if;
    if r.member_types is not null and not (m.member_type = any (r.member_types)) then
      return query select false, 'rule'::text;
      return;
    end if;
    if r.courses is not null and not exists (
      select 1 from unnest(r.courses) c
      where position(lower(c) in lower(coalesce(m.course, ''))) > 0
    ) then
      return query select false, 'rule'::text;
      return;
    end if;
    return query select true, 'rule'::text;
    return;
  end if;

  if exists (
    select 1 from public.network_professionals np
    where np.user_id = p_user and np.is_active = true
  ) then
    return query select r.allow_professionals, 'rule'::text;
    return;
  end if;

  return query select false, 'rule'::text;
end;
$$;

revoke all on function public.hub_access_decision(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
create or replace function public.has_hub_access(p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select d.allowed from public.hub_access_decision(auth.uid(), p_feature) d), false);
$$;

revoke all on function public.has_hub_access(text) from public, anon;
grant execute on function public.has_hub_access(text) to authenticated;

-- What the signed-in user's own hub should show.
create or replace function public.get_my_hub_access()
returns table (feature text, allowed boolean, blocked_display text)
language sql
stable
security definer
set search_path = public
as $$
  select r.feature,
         coalesce((select d.allowed from public.hub_access_decision(auth.uid(), r.feature) d), false),
         r.blocked_display
  from public.hub_access_rules r
  where auth.uid() is not null;
$$;

revoke all on function public.get_my_hub_access() from public, anon;
grant execute on function public.get_my_hub_access() to authenticated;

-- ---------------------------------------------------------------------
-- President's overview: one row per person per feature.
create or replace function public.president_get_hub_access()
returns table (
  user_id uuid, full_name text, person_type text, member_type text,
  course text, year_of_study text, feature text, allowed boolean, via text
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
           m.course as pcourse, m.year_of_study as pyear
    from public.members m
    union all
    select np.user_id, np.full_name, 'professional'::text, null::text, null::text, null::text
    from public.network_professionals np
    where np.user_id is not null and np.is_active = true
      and not exists (select 1 from public.members mm where mm.id = np.user_id)
  )
  select p.uid, p.fname, p.ptype, p.mtype, p.pcourse, p.pyear, r.feature, d.allowed, d.via
  from people p
  cross join public.hub_access_rules r
  cross join lateral public.hub_access_decision(p.uid, r.feature) d
  order by p.fname, r.feature;
end;
$$;

revoke all on function public.president_get_hub_access() from public, anon;
grant execute on function public.president_get_hub_access() to authenticated;

create or replace function public.president_get_hub_rules()
returns setof public.hub_access_rules
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Only the president can view hub rules.';
  end if;
  return query select * from public.hub_access_rules order by feature;
end;
$$;

revoke all on function public.president_get_hub_rules() from public, anon;
grant execute on function public.president_get_hub_rules() to authenticated;

-- ---------------------------------------------------------------------
create or replace function public.president_set_hub_rule(
  p_feature text,
  p_allow_members boolean,
  p_allow_professionals boolean,
  p_member_types text[],
  p_courses text[],
  p_blocked_display text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Only the president can change hub access.';
  end if;
  if p_blocked_display not in ('locked', 'hidden') then
    raise exception 'Invalid blocked display.';
  end if;
  if p_member_types is not null and not (p_member_types <@ array['member', 'executive_committee', 'supporting_committee', 'senior_sankofa_mentor', 'junior_sankofa_mentor']) then
    raise exception 'Unknown member type.';
  end if;

  update public.hub_access_rules
  set allow_members = coalesce(p_allow_members, false),
      allow_professionals = coalesce(p_allow_professionals, false),
      member_types = case when p_member_types is null or cardinality(p_member_types) = 0 then null else p_member_types end,
      courses = case when p_courses is null or cardinality(p_courses) = 0 then null else p_courses end,
      blocked_display = p_blocked_display,
      updated_at = now()
  where feature = p_feature;

  if not found then
    raise exception 'Unknown feature.';
  end if;
end;
$$;

revoke all on function public.president_set_hub_rule(text, boolean, boolean, text[], text[], text) from public, anon;
grant execute on function public.president_set_hub_rule(text, boolean, boolean, text[], text[], text) to authenticated;

-- mode: 'allow' / 'deny' (force this person) or 'default' (follow the rule).
create or replace function public.president_set_hub_override(p_user uuid, p_feature text, p_mode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Only the president can change hub access.';
  end if;
  if p_mode = 'default' then
    delete from public.hub_access_overrides where user_id = p_user and feature = p_feature;
  elsif p_mode in ('allow', 'deny') then
    insert into public.hub_access_overrides (user_id, feature, allow)
    values (p_user, p_feature, p_mode = 'allow')
    on conflict (user_id, feature) do update set allow = excluded.allow, created_at = now();
  else
    raise exception 'Invalid mode.';
  end if;
end;
$$;

revoke all on function public.president_set_hub_override(uuid, text, text) from public, anon;
grant execute on function public.president_set_hub_override(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Enforcement.

-- Discounts: readable only with Perks access (was: any signed-in user).
drop policy if exists "Signed-in members can view active discounts" on public.discounts;
drop policy if exists "Users with perks access can view active discounts" on public.discounts;
create policy "Users with perks access can view active discounts"
  on public.discounts for select
  to authenticated
  using (is_active = true and public.has_hub_access('perks'));

-- News & updates feed.
drop policy if exists "Signed-in members can view active announcements" on public.announcements;
drop policy if exists "Users with feed access can view active announcements" on public.announcements;
create policy "Users with feed access can view active announcements"
  on public.announcements for select
  to authenticated
  using (is_active = true and public.has_hub_access('news_feed'));

-- Member of the Month nominations.
drop policy if exists "Members and professionals can submit a nomination" on public.motm_nominations;
drop policy if exists "Users with nomination access can submit a nomination" on public.motm_nominations;
create policy "Users with nomination access can submit a nomination"
  on public.motm_nominations for insert
  to authenticated
  with check (
    auth.uid() = nominator_id
    and (exists (select 1 from public.members m where m.id = auth.uid()) or public.is_professional())
    and public.has_hub_access('motm_nominate')
  );

-- Sankofa mentee applications: the Medicine-only check from 054 is now
-- just the default rule for "sankofa" (and, unlike the old exact match on
-- "Medicine", also covers members saved with the full degree title).
-- The deadline stays.
create or replace function public.enforce_sankofa_mentee_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role_applied_for = 'mentee' then
    if now() > '2026-10-11 23:59:59+01'::timestamptz then
      raise exception 'Sankofa mentee applications closed on 11 October 2026.';
    end if;

    if not coalesce((select d.allowed from public.hub_access_decision(new.member_id, 'sankofa') d), false) then
      raise exception 'You do not currently have access to Sankofa Circle applications.';
    end if;
  end if;
  return new;
end;
$$;

-- The Network member directory (definition from 017, plus the access
-- check; returns nothing for anyone without Network access).
create or replace function public.get_network_members()
returns table (
  id uuid,
  full_name text,
  course text,
  year_of_study text,
  member_type text,
  committee_role text,
  linkedin_url text,
  bio text,
  is_pending boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select m.id, m.full_name, m.course, m.year_of_study, m.member_type, m.committee_role,
         p.linkedin_url, p.bio, false as is_pending
  from public.members m
  left join public.member_profiles p on p.id = m.id
  where public.has_hub_access('network')
    and (public.is_lacms_member() or public.is_professional() or public.is_president())
    and m.membership_status = 'active'
  union all
  select pm.id, pm.full_name, pm.course, pm.year_of_study, pm.member_type, pm.committee_role,
         null::text as linkedin_url, null::text as bio, true as is_pending
  from public.pending_members pm
  where public.has_hub_access('network')
    and (public.is_lacms_member() or public.is_professional() or public.is_president())
    and pm.visible_in_network = true;
$$;

commit;
