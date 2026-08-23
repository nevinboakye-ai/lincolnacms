-- Fixes "new row violates row-level security policy for table
-- member_profiles" when a professional tries to save their LinkedIn/bio
-- from the members hub's "Edit network profile" form.
--
-- The insert policy from migration 014 only ever checked
-- is_lacms_member() — professionals aren't LACMS members, so they could
-- never create their first member_profiles row (the select/update
-- policies never had this problem, only insert). This just adds the
-- same is_professional() check migration 015 already uses everywhere
-- else a professional needs member-equivalent access.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query,
-- paste, Run. Needs migration 015 already applied (for is_professional()).

drop policy if exists "A member can create their own profile extras" on public.member_profiles;

create policy "A member or professional can create their own profile extras"
  on public.member_profiles for insert
  to authenticated
  with check (id = auth.uid() and (public.is_lacms_member() or public.is_professional()));
