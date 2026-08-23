-- Lets you say who an announcement is from — e.g. "Nevin Boakye,
-- President" or "LACMS Committee" — shown as a small byline under the
-- post on the members hub feed. Entirely optional: leave it blank and
-- the byline just doesn't render, same as any existing post.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run.

alter table public.announcements
  add column posted_by text;

comment on column public.announcements.posted_by is 'Optional byline, e.g. "Nevin Boakye, President" — shown under the post on the members hub feed. Leave blank to show none.';
