-- Lets user_ui_state remember one more thing per person: which hub features
-- they've been shown as "New" and which they've opened (key
-- hub_access_seen, used by js/guidance.js to tag pages someone has recently
-- been given access to). Without this the site keeps that in the browser
-- only, so it works either way - this just makes it follow the person
-- across devices.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query, paste,
-- Run. Needs 062.

alter table public.user_ui_state drop constraint if exists user_ui_state_key_check;
alter table public.user_ui_state add constraint user_ui_state_key_check
  check (key in ('tour', 'profile_prompt', 'hub_access_seen'));
