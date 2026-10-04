-- Sixth-form students are only visible to the Executive Committee (and the
-- president). They are young people - everyone else on the site, members
-- and professionals alike, no longer sees them in the Network directory
-- or in the "just joined" feed/banner.
--
-- How someone counts as "sixth form": their course or year of study text
-- mentions sixth form / 6th form, A-levels, Year 12 or Year 13, or
-- "aspiring" (as in "Sixth form / aspiring medic"). That rule lives in
-- one place - is_sixth_form_profile() below - so if your own entries use
-- different wording, adjust the regular expression there and re-run just
-- that function.
--
-- "Executive" = is_dashboard_admin(): the president, or a member whose
-- type is Executive Committee.
--
-- Enforced in the database (the Network directory function and the
-- join-events policy), not just hidden in the page. Everything else is
-- unchanged: executives still see sixth-formers exactly as before, and
-- the president tools / dashboard are president-only anyway.
--
-- Wrapped in a transaction. Run this once in Supabase: Dashboard -> SQL
-- Editor -> New query, paste, Run. Needs 020, 037, 060 and 063.

begin;

create or replace function public.is_sixth_form_profile(p_course text, p_year text)
returns boolean
language sql
immutable
as $$
  select (coalesce(p_course, '') || ' ' || coalesce(p_year, ''))
    ~* '(sixth|6th)[ -]?form|a[- ]?levels?|\myear ?1[23]\M|aspiring';
$$;

-- The Network directory, as in 063, hiding sixth-formers from everyone
-- except executives.
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
    and (not public.is_sixth_form_profile(m.course, m.year_of_study) or public.is_dashboard_admin())
  union all
  select pm.id, pm.full_name, pm.course, pm.year_of_study, pm.member_type, pm.committee_role,
         null::text as linkedin_url, null::text as bio, true as is_pending
  from public.pending_members pm
  where public.has_hub_access('network')
    and (public.is_lacms_member() or public.is_professional() or public.is_president())
    and pm.visible_in_network = true
    and (not public.is_sixth_form_profile(pm.course, pm.year_of_study) or public.is_dashboard_admin())
    and not exists (
      select 1
      from public.members m2
      left join auth.users u2 on u2.id = m2.id
      where lower(btrim(m2.full_name)) = lower(btrim(pm.full_name))
         or lower(u2.email) = lower(pm.email)
    );
$$;

-- "Just joined" feed + hub banner.
drop policy if exists "Members and professionals can view join events" on public.network_join_events;
create policy "Members and professionals can view join events"
  on public.network_join_events for select
  to authenticated
  using (
    is_visible = true
    and (public.is_lacms_member() or public.is_professional())
    and (not public.is_sixth_form_profile(course, year_of_study) or public.is_dashboard_admin())
  );

commit;
