-- Updates the "Active members" stat shown on index.html and about.html
-- to 63. This is the same site_settings.active_member_count row from
-- migration 031 - this just gives it a fresh value rather than adding
-- anything new. It's also editable any time straight from Supabase's
-- Table Editor (site_settings -> active_member_count -> value), no
-- migration needed for future updates - this file is just the one-off
-- SQL route for this particular change.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query,
-- paste, Run. Needs migration 031 (site_settings) already applied.

insert into public.site_settings (key, value)
values ('active_member_count', '63')
on conflict (key) do update set value = excluded.value, updated_at = now();
