-- The Midlands Medics Gala's date isn't confirmed yet: show "Date TBC" on the
-- Events page instead of 21 November 2026, and take it off the events calendar
-- until a date is set. (The Executive Committee can set the real date again
-- from the Events page: Edit -> choose a date.)
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query, paste, Run.
-- Needs 058 and 080. Safe to run again.

update public.site_events
set date_text = 'Date TBC', starts_on = null, ends_on = null
where slug = 'midlands-medics-gala';
