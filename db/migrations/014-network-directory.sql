-- LACMS Network — a member directory in the members hub: every active
-- LACMS member (grouped by course, then year), plus a separate section
-- for external healthcare professionals supporting Sankofa mentorship.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. See README-members-setup.md for the full walkthrough.

-- ---------------------------------------------------------------------
-- The `members` table's only existing RLS policy is "a member can read
-- their own row and nothing else" (by design, from Phase 1). The
-- Network needs every member to browse everyone else's basic details —
-- rather than loosening that policy (which would also expose email and
-- membership_number to any member who queried the table directly), this
-- function returns only the safe subset of columns a directory actually
-- needs, and is SECURITY DEFINER so it can read the whole table
-- internally while still gating on "the caller must be a member
-- themselves" via is_lacms_member(). Also joins in member_profiles
-- (below) for the optional LinkedIn/bio a member has added themselves.
create or replace function public.get_network_members()
returns table (
  id uuid,
  full_name text,
  course text,
  year_of_study text,
  member_type text,
  committee_role text,
  linkedin_url text,
  bio text
)
language sql
security definer
stable
set search_path = public
as $$
  select m.id, m.full_name, m.course, m.year_of_study, m.member_type, m.committee_role,
         p.linkedin_url, p.bio
  from public.members m
  left join public.member_profiles p on p.id = m.id
  where public.is_lacms_member() and m.membership_status = 'active';
$$;

-- ---------------------------------------------------------------------
-- Member profiles — the optional extras a member adds about themself
-- (LinkedIn, short bio) from their own hub. Kept separate from `members`
-- entirely, rather than adding self-editable columns to it, so there's
-- no risk of a member ever being able to touch committee-controlled
-- fields like membership_status or member_type.
create table public.member_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  linkedin_url text,
  bio text,
  updated_at timestamptz not null default now()
);

alter table public.member_profiles enable row level security;

create policy "A member can view their own profile extras"
  on public.member_profiles for select
  to authenticated
  using (id = auth.uid());

create policy "A member can create their own profile extras"
  on public.member_profiles for insert
  to authenticated
  with check (id = auth.uid() and public.is_lacms_member());

create policy "A member can update their own profile extras"
  on public.member_profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

comment on column public.member_profiles.bio is 'Optional — shown on the member''s Network profile card. Plain text, no formatting.';

-- ---------------------------------------------------------------------
-- Professionals — senior doctors, consultants, alumni doctors, pharmacists
-- and others supporting Sankofa mentorship who aren't LACMS members
-- themselves. No self-service signup for this group (small, curated,
-- recruited directly by the committee) — added and edited from Table
-- Editor, same pattern as discounts/opportunities.
create table public.network_professionals (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  title text not null,
  organisation text,
  category text not null default 'senior_doctor'
    check (category in ('senior_doctor', 'alumni_doctor', 'pharmacist', 'other')),
  bio text,
  linkedin_url text,
  photo_url text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.network_professionals enable row level security;

create policy "LACMS members can view active professionals"
  on public.network_professionals for select
  to authenticated
  using (is_active = true and public.is_lacms_member());

comment on column public.network_professionals.title is 'e.g. "Consultant Cardiologist", "Community Pharmacist".';
comment on column public.network_professionals.category is 'senior_doctor / alumni_doctor / pharmacist / other — controls which sub-group they appear under.';
