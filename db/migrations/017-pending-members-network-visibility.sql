-- Lets a pending member (added via migration 016, before they've signed
-- up) show up in the Network directory alongside real members — with a
-- "Pending" badge, grouped under the same course/year as everyone else
-- — plus a per-row toggle to hide one from the Network while still
-- letting them be claimed normally once they do sign up.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. Needs migrations 014, 015 and 016 already applied.

alter table public.pending_members
  add column id uuid not null default gen_random_uuid() unique,
  add column visible_in_network boolean not null default true;

comment on column public.pending_members.visible_in_network is 'Set false in Table Editor to hide this person from the Network directory while they''re still pending — has no effect on claim_member_profile(), they''ll still be claimed normally once they sign up.';

-- get_network_members() now also returns visible pending_members rows,
-- flagged is_pending = true so the front end can badge/style them
-- differently. Changing the column list means the function's return
-- type is changing, which CREATE OR REPLACE can't do — drop it first.
drop function if exists public.get_network_members();

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
  where (public.is_lacms_member() or public.is_professional()) and m.membership_status = 'active'
  union all
  select pm.id, pm.full_name, pm.course, pm.year_of_study, pm.member_type, pm.committee_role,
         null::text as linkedin_url, null::text as bio, true as is_pending
  from public.pending_members pm
  where (public.is_lacms_member() or public.is_professional()) and pm.visible_in_network = true;
$$;
