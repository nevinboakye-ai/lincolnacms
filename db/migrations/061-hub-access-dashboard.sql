-- Hub Access, part 2: the Platform Activity Dashboard.
--
-- Migration 060 let the president control who sees each part of the
-- members hub. This extends the same rules to the dashboard's shared
-- sections - MMG, Sankofa, Nominations, Events and Gallery - so that
-- instead of "every Executive Committee member sees all five", each
-- section has its own rule, including a new "committee title" filter
-- (members.committee_role, e.g. Treasurer, Events Officer) and
-- per-person overrides.
--
-- New rule fields/features:
--   titles          - on any rule: if set, members must hold one of these
--                     committee titles (case-insensitive); null = any
--   dash_mmg, dash_sankofa, dash_motm, dash_events, dash_gallery
--                   - one rule per dashboard section. Defaults reproduce
--                     today: members whose type is executive_committee.
--
-- Enforced in the database: every function behind those five sections
-- (and the gallery storage/table policies) now checks that section's
-- rule instead of "is the president or an Executive Committee member".
-- User Activity, Website Activity, Account Requests, Create/Manage
-- Accounts and Hub Access itself stay president-only - they're not part
-- of these rules.
--
-- Wrapped in a transaction: if anything fails, nothing is applied.
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query, paste,
-- Run. Needs 037 and 060.

begin;

-- ---------------------------------------------------------------------
alter table public.hub_access_rules add column if not exists titles text[];

alter table public.hub_access_rules drop constraint if exists hub_access_rules_feature_check;
alter table public.hub_access_rules add constraint hub_access_rules_feature_check
  check (feature in (
    'perks', 'sankofa', 'network', 'motm_nominate', 'news_feed',
    'dash_mmg', 'dash_sankofa', 'dash_motm', 'dash_events', 'dash_gallery'
  ));

insert into public.hub_access_rules (feature, allow_members, allow_professionals, member_types, courses, blocked_display) values
  ('dash_mmg',     true, false, array['executive_committee'], null, 'hidden'),
  ('dash_sankofa', true, false, array['executive_committee'], null, 'hidden'),
  ('dash_motm',    true, false, array['executive_committee'], null, 'hidden'),
  ('dash_events',  true, false, array['executive_committee'], null, 'hidden'),
  ('dash_gallery', true, false, array['executive_committee'], null, 'hidden')
on conflict (feature) do nothing;

-- ---------------------------------------------------------------------
-- The rule evaluator from 060, plus the committee-title check.
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
    if r.titles is not null and not exists (
      select 1 from unnest(r.titles) t
      where lower(btrim(t)) = lower(btrim(coalesce(m.committee_role, '')))
    ) then
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

-- True if the caller has at least one dashboard section.
create or replace function public.has_any_dashboard_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.hub_access_rules r
    where r.feature in ('dash_mmg', 'dash_sankofa', 'dash_motm', 'dash_events', 'dash_gallery')
      and coalesce((select d.allowed from public.hub_access_decision(auth.uid(), r.feature) d), false)
  );
$$;

revoke all on function public.has_any_dashboard_access() from public, anon;
grant execute on function public.has_any_dashboard_access() to authenticated;

-- ---------------------------------------------------------------------
-- President's overview now also returns each person's committee title.
drop function if exists public.president_get_hub_access();
create function public.president_get_hub_access()
returns table (
  user_id uuid, full_name text, person_type text, member_type text, committee_role text,
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
           m.committee_role as ptitle, m.course as pcourse, m.year_of_study as pyear
    from public.members m
    union all
    select np.user_id, np.full_name, 'professional'::text, null::text, null::text, null::text, null::text
    from public.network_professionals np
    where np.user_id is not null and np.is_active = true
      and not exists (select 1 from public.members mm where mm.id = np.user_id)
  )
  select p.uid, p.fname, p.ptype, p.mtype, p.ptitle, p.pcourse, p.pyear, r.feature, d.allowed, d.via
  from people p
  cross join public.hub_access_rules r
  cross join lateral public.hub_access_decision(p.uid, r.feature) d
  order by p.fname, r.feature;
end;
$$;

revoke all on function public.president_get_hub_access() from public, anon;
grant execute on function public.president_get_hub_access() to authenticated;

-- Saving a rule now takes the committee titles too.
drop function if exists public.president_set_hub_rule(text, boolean, boolean, text[], text[], text);
create function public.president_set_hub_rule(
  p_feature text,
  p_allow_members boolean,
  p_allow_professionals boolean,
  p_member_types text[],
  p_courses text[],
  p_blocked_display text,
  p_titles text[]
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
      titles = case when p_titles is null or cardinality(p_titles) = 0 then null else p_titles end,
      blocked_display = p_blocked_display,
      updated_at = now()
  where feature = p_feature;

  if not found then
    raise exception 'Unknown feature.';
  end if;
end;
$$;

revoke all on function public.president_set_hub_rule(text, boolean, boolean, text[], text[], text, text[]) from public, anon;
grant execute on function public.president_set_hub_rule(text, boolean, boolean, text[], text[], text, text[]) to authenticated;

-- ---------------------------------------------------------------------
-- The dashboard functions from 037, unchanged except that each now
-- checks its own section's rule instead of is_dashboard_admin().
-- (president_lookup_names serves several sections, so it requires
-- access to at least one.)

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
  if not public.has_hub_access('dash_mmg') then
    raise exception 'Not authorized';
  end if;
  return query
    select g.id, g.full_name, u.email::text, g.university, g.access_level,
           g.activated_at, u.last_sign_in_at, p.last_seen_at, g.created_at
    from public.mmg_guests g
    join auth.users u on u.id = g.id
    left join public.member_presence p on p.id = g.id;
end;
$$;

create or replace function public.president_get_sankofa_applications()
returns table (
  id uuid,
  applicant_type text,
  full_name text,
  email text,
  status text,
  created_at timestamptz,
  current_stage text,
  heritage text,
  career_aspirations text,
  specialty_interest text,
  hobbies_interests text[],
  social_preference smallint,
  fitness_preference smallint,
  study_style smallint,
  support_style smallint,
  communication_style text,
  meeting_frequency text,
  looking_for text,
  mentor_title text,
  mentor_organisation text,
  mentor_category text,
  years_experience text,
  mentor_specialty text,
  mentor_motivation text,
  what_you_offer text[],
  mentee_capacity text,
  statement text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_hub_access('dash_sankofa') then
    raise exception 'Not authorized';
  end if;
  return query
    select
      sa.id, sa.applicant_type,
      coalesce(m.full_name, np.full_name, u.email::text) as full_name,
      u.email::text,
      sa.status, sa.created_at,
      sa.current_stage, sa.heritage, sa.career_aspirations, sa.specialty_interest,
      sa.hobbies_interests, sa.social_preference, sa.fitness_preference,
      sa.study_style, sa.support_style, sa.communication_style, sa.meeting_frequency,
      sa.looking_for,
      sa.mentor_title, sa.mentor_organisation, sa.mentor_category, sa.years_experience,
      sa.mentor_specialty, sa.mentor_motivation, sa.what_you_offer, sa.mentee_capacity,
      sa.statement
    from public.sankofa_applications sa
    left join public.members m on m.id = sa.member_id
    left join public.network_professionals np on np.user_id = sa.member_id
    left join auth.users u on u.id = sa.member_id
    order by sa.created_at desc;
end;
$$;

create or replace function public.president_get_sankofa_mentor_applications()
returns table (
  id uuid, full_name text, email text, job_title text, organisation text,
  linkedin_url text, offer_statement text, status text, created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_hub_access('dash_sankofa') then
    raise exception 'Not authorized';
  end if;
  return query
    select sma.id, sma.full_name, sma.email, sma.job_title, sma.organisation,
           sma.linkedin_url, sma.offer_statement, sma.status, sma.created_at
    from public.sankofa_mentor_applications sma
    order by sma.created_at desc;
end;
$$;

create or replace function public.president_set_mentor_application_status(target_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_hub_access('dash_sankofa') then
    raise exception 'Not authorized';
  end if;
  if new_status not in ('new', 'reviewed', 'contacted') then
    raise exception 'Invalid status';
  end if;
  update public.sankofa_mentor_applications set status = new_status where id = target_id;
end;
$$;

create or replace function public.president_delete_sankofa_application(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_hub_access('dash_sankofa') then
    raise exception 'Not authorized';
  end if;
  delete from public.sankofa_applications where id = target_id;
end;
$$;

create or replace function public.president_delete_sankofa_mentor_application(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_hub_access('dash_sankofa') then
    raise exception 'Not authorized';
  end if;
  delete from public.sankofa_mentor_applications where id = target_id;
end;
$$;

create or replace function public.president_get_motm_nominations()
returns table (
  id uuid, nominee_name text, reason text, nominator_name text, nominator_email text, created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_hub_access('dash_motm') then
    raise exception 'Not authorized';
  end if;
  return query
    select mn.id, mn.nominee_name, mn.reason,
           coalesce(m.full_name, np.full_name, u.email::text) as nominator_name,
           u.email::text as nominator_email,
           mn.created_at
    from public.motm_nominations mn
    left join public.members m on m.id = mn.nominator_id
    left join public.network_professionals np on np.user_id = mn.nominator_id
    left join auth.users u on u.id = mn.nominator_id
    order by mn.created_at desc;
end;
$$;

create or replace function public.president_delete_motm_nomination(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_hub_access('dash_motm') then
    raise exception 'Not authorized';
  end if;
  delete from public.motm_nominations where id = target_id;
end;
$$;

create or replace function public.president_get_event_registrations()
returns table (
  id uuid, event_slug text, event_name text, member_name text, registered_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_hub_access('dash_events') then
    raise exception 'Not authorized';
  end if;
  return query
    select er.id, er.event_slug, er.event_name,
           coalesce(m.full_name, np.full_name, u.email::text) as member_name,
           er.registered_at
    from public.event_registrations er
    left join public.members m on m.id = er.member_id
    left join public.network_professionals np on np.user_id = er.member_id
    left join auth.users u on u.id = er.member_id
    order by er.registered_at desc;
end;
$$;

create or replace function public.president_lookup_names(target_ids uuid[])
returns table (id uuid, full_name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_any_dashboard_access() then
    raise exception 'Not authorized';
  end if;
  return query
    select u.id, coalesce(m.full_name, np.full_name, g.full_name, u.email::text) as full_name
    from auth.users u
    left join public.members m on m.id = u.id
    left join public.network_professionals np on np.user_id = u.id
    left join public.mmg_guests g on g.id = u.id
    where u.id = any(target_ids);
end;
$$;

-- Gallery section: storage + table policies.
drop policy if exists "President can view all gallery submissions" on storage.objects;
create policy "President can view all gallery submissions"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'gallery-submissions' and public.has_hub_access('dash_gallery'));

drop policy if exists "President can delete gallery submissions" on storage.objects;
create policy "President can delete gallery submissions"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'gallery-submissions' and public.has_hub_access('dash_gallery'));

drop policy if exists "President can upload gallery photos" on storage.objects;
create policy "President can upload gallery photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'gallery-photos' and public.has_hub_access('dash_gallery'));

drop policy if exists "President can delete gallery photos" on storage.objects;
create policy "President can delete gallery photos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'gallery-photos' and public.has_hub_access('dash_gallery'));

drop policy if exists "President can manage gallery photos" on public.gallery_photos;
create policy "President can manage gallery photos"
  on public.gallery_photos for all
  to authenticated
  using (public.has_hub_access('dash_gallery'))
  with check (public.has_hub_access('dash_gallery'));

commit;
