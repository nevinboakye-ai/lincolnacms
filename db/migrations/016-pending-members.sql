-- Pre-add a member's profile before they've signed up.
--
-- `members.id` is the person's Supabase Auth UUID — it can't be filled
-- in until they actually exist as an auth user, which is exactly the
-- "null value in column id violates not-null constraint" error you hit
-- trying to insert a `members` row for someone who hasn't signed up yet.
--
-- This adds a staging table, keyed by email instead of id, that you can
-- fill in first — then claim_member_profile() turns it into a real
-- `members` row automatically the moment that person sets their
-- password and lands on the hub. Same pattern as migration 015's
-- professional accounts.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. See README-members-setup.md for the full walkthrough.

create table public.pending_members (
  email text primary key,
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
  mmg_attendee boolean not null default false,
  mmg_committee boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.pending_members is 'A member''s profile, added by the committee before they''ve signed up. Same fields as `members`, minus id/membership_number, which don''t exist yet. Claimed automatically — moved into `members`, this row deleted — the first time someone with a matching email logs in.';

-- No RLS policies at all — nobody can read or write this table
-- directly, not even a signed-in member. Only the committee (Table
-- Editor, which uses the service role and bypasses RLS) and
-- claim_member_profile() below (SECURITY DEFINER) ever touch it.
alter table public.pending_members enable row level security;

-- Runs the moment a signed-in user with no `members` row yet lands on
-- the members hub (js/members.js calls this before falling back to
-- checking whether they're a professional instead). Matches their auth
-- email to a pending_members row, inserts the real `members` row for
-- them (membership_number fills itself in via the existing trigger),
-- and removes the pending row. Safe to call every time: once a
-- `members` row exists, there's nothing left to match and it's a no-op.
create or replace function public.claim_member_profile()
returns setof public.members
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text;
  pending public.pending_members;
begin
  select email into caller_email from auth.users where id = auth.uid();
  if caller_email is not null then
    select * into pending from public.pending_members where lower(email) = lower(caller_email);
    if found then
      insert into public.members (
        id, full_name, course, year_of_study, membership_status, member_type,
        committee_role, sankofa_eligible, mmg_attendee, mmg_committee
      ) values (
        auth.uid(), pending.full_name, pending.course, pending.year_of_study, pending.membership_status,
        pending.member_type, pending.committee_role, pending.sankofa_eligible, pending.mmg_attendee, pending.mmg_committee
      )
      on conflict (id) do nothing;

      delete from public.pending_members where email = pending.email;
    end if;
  end if;

  return query select * from public.members where id = auth.uid();
end;
$$;
