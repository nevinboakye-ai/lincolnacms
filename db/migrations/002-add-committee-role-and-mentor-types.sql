-- Adds:
--  1. committee_role — a free-text position title (e.g. "President",
--     "Treasurer"), shown on the card and in Your Details only when set.
--  2. Two new member_type tiers: senior_sankofa_mentor, junior_sankofa_mentor.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. Safe on a table that already has rows.

alter table public.members
  add column committee_role text;

comment on column public.members.committee_role is 'Optional free-text position title, e.g. President, Treasurer. Shown only when set.';

-- Widen the member_type check constraint to allow the two mentor tiers.
-- Looked up dynamically rather than dropped by a guessed name, since the
-- exact auto-generated constraint name can vary.
do $$
declare
  con_name text;
begin
  select conname into con_name
  from pg_constraint
  where conrelid = 'public.members'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%member_type%';

  if con_name is not null then
    execute format('alter table public.members drop constraint %I', con_name);
  end if;
end $$;

alter table public.members
  add constraint members_member_type_check
    check (member_type in (
      'member',
      'supporting_committee',
      'executive_committee',
      'senior_sankofa_mentor',
      'junior_sankofa_mentor'
    ));
