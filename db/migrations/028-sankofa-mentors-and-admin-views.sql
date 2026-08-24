-- Several features in one migration, all president-dashboard-facing:
--
-- 1. Sankofa applications: a real mentor branch (mentor-appropriate
--    questions, not the mentee questionnaire), open to any signed-in
--    professional — existing or a brand-new self-registered one — with
--    no committee-only gate and no deadline. Mentee applications keep
--    their existing gate untouched, plus a hard deadline (11 October
--    2026) enforced in the database, not just the page.
-- 2. Professionals can now create their own account directly (no
--    committee pre-add needed) specifically to apply as a Sankofa
--    mentor — lands as a pending, not-yet-public row the president
--    reviews and approves.
-- 3. President-only read access to: all Sankofa applications, all MoTM
--    nominations, who's registered for which event, and the gallery
--    submissions storage bucket — all previously either members-only-
--    see-your-own-row, or Table-Editor-only.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. Needs migrations 003, 014, 015 and 025 already applied.

-- =======================================================================
-- 1. Sankofa applications — mentor branch + deadline
-- =======================================================================

alter table public.sankofa_applications
  add column applicant_type text not null default 'mentee'
    check (applicant_type in ('mentee', 'mentor')),
  add column mentor_title text,
  add column mentor_organisation text,
  add column mentor_category text
    check (mentor_category in ('senior_doctor', 'alumni_doctor', 'pharmacist', 'other')),
  add column years_experience text,
  add column mentor_specialty text,
  add column mentor_motivation text,
  add column what_you_offer text[],
  add column mentee_capacity text;

comment on column public.sankofa_applications.applicant_type is 'mentee = the existing student questionnaire. mentor = doctors/pharmacists, a separate question set, no committee-only gate, no deadline.';
comment on column public.sankofa_applications.what_you_offer is 'Mentor-only: what they can offer mentees — career guidance, clinical placements, interview prep, etc.';

-- Mentee applications close 11 October 2026; mentor applications never
-- do. Enforced here (not just hidden in the page) so the deadline can't
-- be bypassed by calling the API directly. Europe/London so the exact
-- moment matches what a UK-based applicant would expect from "closes
-- Sunday 11th October" — the 23:59:59 that day, not UTC midnight.
create or replace function public.enforce_sankofa_mentee_deadline()
returns trigger
language plpgsql
as $$
begin
  if new.applicant_type = 'mentee'
     and now() > '2026-10-11 23:59:59+01'::timestamptz then
    raise exception 'Sankofa mentee applications closed on 11 October 2026.';
  end if;
  return new;
end;
$$;

drop trigger if exists sankofa_mentee_deadline on public.sankofa_applications;
create trigger sankofa_mentee_deadline
  before insert on public.sankofa_applications
  for each row
  execute function public.enforce_sankofa_mentee_deadline();

-- The existing "Members can submit a Sankofa application" insert policy
-- (migration 003) only ever checked auth.uid() = member_id — already
-- broad enough to cover a professional's own auth.uid() too, so mentor
-- submissions don't need a new insert policy. The existing select
-- policy is likewise already fine as "see your own applications only".

-- President-only: every application, both types, with enough context
-- to actually review one (name pulled from whichever table it's
-- actually in — member, professional, or a still-pending professional
-- signup — rather than assuming everyone's in `members`).
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
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  return query
    select
      sa.id, sa.applicant_type,
      coalesce(m.full_name, np.full_name, u.email) as full_name,
      u.email,
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

-- =======================================================================
-- 2. Self-registered professionals — a brand-new doctor/pharmacist who
--    isn't a member and wasn't pre-added by the committee can now
--    create their own account, purely to apply as a Sankofa mentor.
--    Starts pending (is_active = false, hidden from the public Network)
--    until the president approves them.
-- =======================================================================

alter table public.network_professionals
  add column self_registered boolean not null default false;

comment on column public.network_professionals.self_registered is 'true = they created this account themselves (mentor-signup.html), not pre-added by the committee. Starts is_active=false until approved.';

-- WITH CHECK pins is_active to false regardless of what the client
-- sends — a self-signup can never mark itself active/public, only the
-- president's approval RPC below can.
-- auth.jwt() ->> 'email' (the caller's own email, straight from their
-- JWT claims) rather than querying auth.users directly — the
-- authenticated role isn't reliably granted select on that table, but
-- every session already carries its own email in its token.
create policy "A professional can create their own pending profile"
  on public.network_professionals for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and self_registered = true
    and is_active = false
    and lower(email) = lower(auth.jwt() ->> 'email')
  );

create or replace function public.president_get_pending_professionals()
returns table (
  id uuid, full_name text, email text, title text, organisation text, category text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  return query
    select np.id, np.full_name, np.email, np.title, np.organisation, np.category, np.created_at
    from public.network_professionals np
    where np.self_registered = true and np.is_active = false
    order by np.created_at desc;
end;
$$;

create or replace function public.president_approve_professional(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  update public.network_professionals set is_active = true where id = target_id;
end;
$$;

-- =======================================================================
-- 3. MoTM nominations — president can now see all of them, not just
--    their own (the existing select policy was "your own row only").
-- =======================================================================

create or replace function public.president_get_motm_nominations()
returns table (
  id uuid, nominee_name text, reason text, nominator_name text, nominator_email text, created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  return query
    select mn.id, mn.nominee_name, mn.reason,
           coalesce(m.full_name, np.full_name, u.email) as nominator_name,
           u.email as nominator_email,
           mn.created_at
    from public.motm_nominations mn
    left join public.members m on m.id = mn.nominator_id
    left join public.network_professionals np on np.user_id = mn.nominator_id
    left join auth.users u on u.id = mn.nominator_id
    order by mn.created_at desc;
end;
$$;

-- =======================================================================
-- 4. Event registrations — president can see who's registered for what.
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
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  return query
    select er.id, er.event_slug, er.event_name,
           coalesce(m.full_name, np.full_name, u.email) as member_name,
           er.registered_at
    from public.event_registrations er
    left join public.members m on m.id = er.member_id
    left join public.network_professionals np on np.user_id = er.member_id
    left join auth.users u on u.id = er.member_id
    order by er.registered_at desc;
end;
$$;

-- =======================================================================
-- 5. Gallery submissions — president can read the whole private bucket
--    (list + generate download links) instead of needing the Supabase
--    dashboard's own storage browser.
-- =======================================================================

create policy "President can view all gallery submissions"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'gallery-submissions' and public.is_president());

-- Gallery submissions are stored per-uploader as auth.uid()/filename, with
-- no name attached anywhere in storage itself — this turns a batch of
-- folder names (auth ids) back into display names in one call, checking
-- all three account tables the same way every other president_get_*
-- function does, rather than the dashboard needing three separate
-- lookups per uploader.
create or replace function public.president_lookup_names(target_ids uuid[])
returns table (id uuid, full_name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  return query
    select u.id, coalesce(m.full_name, np.full_name, g.full_name, u.email) as full_name
    from auth.users u
    left join public.members m on m.id = u.id
    left join public.network_professionals np on np.user_id = u.id
    left join public.mmg_guests g on g.id = u.id
    where u.id = any(target_ids);
end;
$$;
