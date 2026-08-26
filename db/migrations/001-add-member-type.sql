-- Adds a member_type column (Member / Supporting Committee / Executive
-- Committee) so it can be shown on the digital membership card.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. Safe to run even though the members table already has rows —
-- every existing row gets 'member' as its default.

alter table public.members
  add column member_type text not null default 'member'
    check (member_type in ('member', 'supporting_committee', 'executive_committee'));

comment on column public.members.member_type is 'member / supporting_committee / executive_committee — shown on the digital membership card.';
