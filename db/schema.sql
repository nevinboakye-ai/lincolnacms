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
  membership_number text unique,
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
  sankofa_eligible boolean not null default false,
  created_at timestamptz not null default now()
);

comment on column public.members.committee_role is 'Optional free-text position title, e.g. President, Treasurer. Shown only when set.';
comment on column public.members.sankofa_eligible is 'Committee-set: true for Medicine/Pharmacy members and aspiring medics/sixth formers — controls access to member-sankofa.html.';

comment on table public.members is 'One row per LACMS member, linked 1:1 to a Supabase Auth user. Rows are added manually by the committee via the Table Editor after inviting a member.';

-- Membership numbers are randomly assigned on insert (not sequential),
-- so the number itself can't be used to estimate headcount.
create or replace function public.generate_membership_number()
returns trigger as $$
declare
  candidate text;
  attempts int := 0;
begin
  if new.membership_number is not null then
    return new;
  end if;
  loop
    candidate := 'LACMS-' || lpad((floor(random() * 900) + 100)::int::text, 3, '0');
    exit when not exists (select 1 from public.members where membership_number = candidate);
    attempts := attempts + 1;
    if attempts > 20 then
      raise exception 'Could not generate a unique membership number';
    end if;
  end loop;
  new.membership_number := candidate;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger set_membership_number
  before insert on public.members
  for each row
  execute function public.generate_membership_number();

alter table public.members enable row level security;

-- A logged-in member can read their own row and nothing else. There is no
-- insert/update/delete policy for members themselves — profile data is
-- managed by the committee via the Supabase dashboard (which uses the
-- service role and bypasses RLS), not by members editing their own record.
create policy "Members can view their own profile"
  on public.members for select
  using (auth.uid() = id);
