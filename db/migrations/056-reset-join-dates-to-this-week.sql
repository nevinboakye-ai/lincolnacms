-- One-off reset: makes every existing Network join event look like it
-- happened this week. Accounts were added over several weeks before
-- anyone actually had access, so most of them had aged out of the
-- "just joined the Network" banner/ticker's recent window - this puts
-- everyone back inside it now that people are really getting in.
--
-- Only touches network_join_events.created_at (what the banner, ticker
-- and history read) - members.created_at and
-- network_professionals.created_at are left as the real record of when
-- each row was created. Each event gets a random time within the last
-- 5 days rather than one identical timestamp, so ordering and the
-- "x hours/days ago" labels look natural instead of everyone landing
-- on exactly the same second.
--
-- Safe to run more than once, but each run re-randomises the times.
-- Run once in Supabase: Dashboard -> SQL Editor -> New query, paste, Run.

update public.network_join_events
set created_at = now() - (random() * interval '5 days');
