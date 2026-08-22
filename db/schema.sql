-- LACMS Members Hub — database schema
--
-- Run this once in your Supabase project: Dashboard → SQL Editor → New query,
-- paste this whole file, and click "Run". It creates one table, one column
-- that auto-generates a membership number, and a security rule that makes
-- sure a logged-in member can only ever read their OWN row — never anyone
-- else's. See README-members-setup.md for the full walkthrough.

create table public.members (
  id uuid primary key references auth.users (id) on delete cascade,
  member_seq int generated always as identity,
  membership_number text generated always as ('LACMS-' || lpad(member_seq::text, 4, '0')) stored,
  full_name text not null,
  course text,
  year_of_study text,
  membership_status text not null default 'active'
    check (membership_status in ('active', 'expired', 'pending')),
  created_at timestamptz not null default now()
);

comment on table public.members is 'One row per LACMS member, linked 1:1 to a Supabase Auth user. Rows are added manually by the committee via the Table Editor after inviting a member.';

alter table public.members enable row level security;

-- A logged-in member can read their own row and nothing else. There is no
-- insert/update/delete policy for members themselves — profile data is
-- managed by the committee via the Supabase dashboard (which uses the
-- service role and bypasses RLS), not by members editing their own record.
create policy "Members can view their own profile"
  on public.members for select
  using (auth.uid() = id);
