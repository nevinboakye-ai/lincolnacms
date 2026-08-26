-- Gives Executive Committee members (members.member_type =
-- 'executive_committee') access to the president dashboard too, but
-- only to five of its eight cards: MMG, Sankofa, Nominations, Events
-- and Gallery. User Activity, Create Account and Manage Accounts stay
-- president-only — those three touch full account rosters and the
-- ability to create/edit/delete anyone's login, which is a materially
-- bigger trust boundary than reviewing applications or curating the
-- public gallery.
--
-- Two new helper functions establish the boundary once, the same way
-- is_president() already does for the president alone:
--   is_executive_committee() - true for any signed-in member whose own
--     members row has member_type = 'executive_committee'.
--   is_dashboard_admin() - true for the president OR an executive
--     committee member. Every RPC/policy behind the five shared cards
--     switches from is_president() to this; everything behind the
--     three restricted cards is untouched and stays is_president()-only.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. Needs 025, 026, 027, 028, 029, 030, 031, 033, 034 already applied
-- (this migration only replaces function bodies and policies they
-- already created — it doesn't create anything new structurally).

-- =======================================================================
-- 1. The two helper functions.
-- =======================================================================

create or replace function public.is_executive_committee()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.members m
    where m.id = auth.uid() and m.member_type = 'executive_committee'
  );
$$;

create or replace function public.is_dashboard_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_president() or public.is_executive_committee();
$$;

-- =======================================================================
-- 2. MMG card.
-- =======================================================================

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
  if not public.is_dashboard_admin() then
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

-- =======================================================================
-- 3. Sankofa card.
-- =======================================================================

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
  if not public.is_dashboard_admin() then
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
  if not public.is_dashboard_admin() then
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
  if not public.is_dashboard_admin() then
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
  if not public.is_dashboard_admin() then
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
  if not public.is_dashboard_admin() then
    raise exception 'Not authorized';
  end if;
  delete from public.sankofa_mentor_applications where id = target_id;
end;
$$;

-- =======================================================================
-- 4. Nominations card.
-- =======================================================================

drop function if exists public.president_get_motm_nominations() cascade;

create function public.president_get_motm_nominations()
returns table (
  id uuid, nominee_name text, reason text, nominator_name text, nominator_email text, created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_dashboard_admin() then
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
  if not public.is_dashboard_admin() then
    raise exception 'Not authorized';
  end if;
  delete from public.motm_nominations where id = target_id;
end;
$$;

-- =======================================================================
-- 5. Events card.
-- =======================================================================

create or replace function public.president_get_event_registrations()
returns table (
  id uuid, event_slug text, event_name text, member_name text, registered_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_dashboard_admin() then
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

-- =======================================================================
-- 6. Gallery card — the name-lookup RPC, plus every gallery-submissions
--    and gallery-photos storage/table policy that was president-only.
-- =======================================================================

create or replace function public.president_lookup_names(target_ids uuid[])
returns table (id uuid, full_name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_dashboard_admin() then
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

drop policy if exists "President can view all gallery submissions" on storage.objects;
create policy "President can view all gallery submissions"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'gallery-submissions' and public.is_dashboard_admin());

drop policy if exists "President can delete gallery submissions" on storage.objects;
create policy "President can delete gallery submissions"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'gallery-submissions' and public.is_dashboard_admin());

drop policy if exists "President can upload gallery photos" on storage.objects;
create policy "President can upload gallery photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'gallery-photos' and public.is_dashboard_admin());

drop policy if exists "President can delete gallery photos" on storage.objects;
create policy "President can delete gallery photos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'gallery-photos' and public.is_dashboard_admin());

drop policy if exists "President can manage gallery photos" on public.gallery_photos;
create policy "President can manage gallery photos"
  on public.gallery_photos for all
  to authenticated
  using (public.is_dashboard_admin())
  with check (public.is_dashboard_admin());
