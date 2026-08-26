-- Lets the president create a member, professional or MMG guest account
-- directly from the dashboard, instead of the current two-step dance
-- (Table Editor row, then Authentication → Invite user, then copying
-- the UUID back into the row by hand).
--
-- The dashboard still never touches the service-role admin API (the
-- anon key can't, and shouldn't ever be able to leave the browser with
-- that kind of power) — it creates the auth account with a normal
-- signUp() call on a second, non-session-persisting Supabase client (so
-- it can never clobber the president's own logged-in session), then
-- immediately triggers Supabase's own password-reset email so the new
-- person sets their own password, the same way an invited member always
-- has. All this migration adds is the missing piece: permission for the
-- president's own session to insert the profile row for that brand-new
-- account, since until now members/professionals/MMG guests could only
-- ever be inserted via Table Editor (service role, bypasses RLS) or, for
-- professionals and MMG guests, by the account owner inserting their own
-- row. Both of those still work exactly as before — these are additive
-- policies alongside them, not replacements.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. Needs 025 (is_president()) already applied.

create policy "President can add a member directly"
  on public.members for insert
  to authenticated
  with check (public.is_president());

create policy "President can add a professional directly"
  on public.network_professionals for insert
  to authenticated
  with check (public.is_president());

create policy "President can add an MMG guest directly"
  on public.mmg_guests for insert
  to authenticated
  with check (public.is_president());
