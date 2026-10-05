-- Lets user_ui_state remember one more thing per person: when the "What's
-- new for you" summary last appeared at sign-in, and whether they asked not
-- to see it (key welcome_seen, used by js/guidance.js). Without this the
-- site keeps that in the browser only, so it works either way - this just
-- makes it follow the person across devices.
--
-- Wrapped in a transaction. Run this once in Supabase: Dashboard -> SQL
-- Editor -> New query, paste, Run. Needs 062 (and 068, which it extends).

begin;

alter table public.user_ui_state drop constraint if exists user_ui_state_key_check;
alter table public.user_ui_state add constraint user_ui_state_key_check
  check (key in ('tour', 'profile_prompt', 'hub_access_seen', 'welcome_seen'));

commit;
