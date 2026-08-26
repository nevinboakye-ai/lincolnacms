-- Same "who's this from" byline as migration 023's announcements,
-- extended to the two MMG update feeds — the committee-only planning
-- feed (mmg_updates) and the general attendee feed
-- (mmg_attendee_updates). Both already share one render function in
-- js/members.js (renderMmgFeedItem), so this covers every place either
-- feed shows up — mmg.html, mmg-hub.html, and the MMG sections on
-- member-hub.html — in one change.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run.

alter table public.mmg_updates
  add column posted_by text;

alter table public.mmg_attendee_updates
  add column posted_by text;

comment on column public.mmg_updates.posted_by is 'Optional byline, e.g. "Nevin Boakye, President" — shown under the post. Leave blank to show none.';
comment on column public.mmg_attendee_updates.posted_by is 'Optional byline, e.g. "Nevin Boakye, President" — shown under the post. Leave blank to show none.';
