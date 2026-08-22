-- LACMS Members Hub — database schema
--
-- Run this once in your Supabase project: Dashboard → SQL Editor → New query,
-- paste this whole file, and click "Run". It creates one table, one column
-- that auto-generates a membership number, and a security rule that makes
-- sure a logged-in member can only ever read their OWN row — never anyone
-- else's. See README-members-setup.md for the full walkthrough.
--
-- Already ran this once on a live project? Don't re-run it — check
-- db/migrations/ instead for anything added since, and only run files
-- from there that you haven't applied yet.

create table public.members (
  id uuid primary key references auth.users (id) on delete cascade,
  member_seq int generated always as identity,
  membership_number text generated always as ('LACMS-' || lpad(member_seq::text, 4, '0')) stored,
  full_name text not null,
  course text,
  year_of_study text,
  membership_status text not null default 'active'
    check (membership_status in ('active', 'expired', 'pending')),
  member_type text not null default 'member'
    check (member_type in (
      'member',
      'supporting_committee',
      'executive_committee',
      'senior_sankofa_mentor',
      'junior_sankofa_mentor'
    )),
  committee_role text,
  created_at timestamptz not null default now()
);

comment on column public.members.committee_role is 'Optional free-text position title, e.g. President, Treasurer. Shown only when set.';

comment on table public.members is 'One row per LACMS member, linked 1:1 to a Supabase Auth user. Rows are added manually by the committee via the Table Editor after inviting a member.';

alter table public.members enable row level security;

-- A logged-in member can read their own row and nothing else. There is no
-- insert/update/delete policy for members themselves — profile data is
-- managed by the committee via the Supabase dashboard (which uses the
-- service role and bypasses RLS), not by members editing their own record.
create policy "Members can view their own profile"
  on public.members for select
  using (auth.uid() = id);
