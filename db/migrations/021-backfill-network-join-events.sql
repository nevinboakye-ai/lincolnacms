-- Backfills network_join_events for every member who already existed
-- before migration 020's trigger was created. Without this, only
-- people who join from now on show up in the "just joined the
-- Network" history — anyone added earlier is invisible to it, and the
-- history looks like it starts the day this feature shipped instead of
-- reflecting when people actually joined.
--
-- Uses each member's own members.created_at, so "5 hours ago" / "5
-- days ago" etc. on the backfilled rows are their real join dates, not
-- the moment this migration ran. Safe to run more than once — the
-- NOT EXISTS check means a member who already has a join event (either
-- logged live by the trigger, or from a previous run of this same
-- migration) is skipped.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. Needs migration 020 already applied.

insert into public.network_join_events (member_id, full_name, course, year_of_study, member_type, created_at)
select m.id, m.full_name, m.course, m.year_of_study, m.member_type, m.created_at
from public.members m
where not exists (
  select 1 from public.network_join_events e where e.member_id = m.id
);
