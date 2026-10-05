-- Lets new content reach people the moment it's published, as a pop-up at
-- the bottom of whatever page they're on (js/notifications.js), instead of
-- waiting for the once-a-minute check. Adds the tables behind the bell's
-- sections to the supabase_realtime publication. Nothing leaks: Realtime
-- only sends a person rows their own read policies already let them see,
-- and the site just uses each event as a nudge to re-count.
--
-- Optional: without it the pop-ups still appear, within about a minute.
-- Skips any table that doesn't exist; safe to run more than once.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query, paste, Run.

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array[
      'announcements', 'discounts', 'member_opportunities', 'site_events', 'news_posts',
      'motm_winners', 'gallery_photos', 'mmg_updates', 'mmg_attendee_updates', 'mmg_perks', 'resources'
    ] loop
      if to_regclass('public.' || t) is not null then
        begin
          execute format('alter publication supabase_realtime add table public.%I', t);
        exception when duplicate_object then null;
        end;
      end if;
    end loop;
  end if;
end;
$$;
