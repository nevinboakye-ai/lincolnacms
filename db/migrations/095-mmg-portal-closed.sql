-- 095: MMG portal sign-ups closed (for now)
--
-- The Midlands Medics Gala portal is switched off: nobody can create an MMG
-- account, and the "MMG portal login" is gone from the site (login page, the Gala
-- page and mmg-login.html now say the portal is closed).
--
-- This closes the door in the database too, not just on the page: until the
-- setting below is 'true', a new MMG guest account can't be added by anyone but
-- the president (who can still add guests from the dashboard). Existing guests
-- and Lincoln members marked as MMG attendees are not touched.
--
-- To reopen it later: set the site setting mmg_portal_open to 'true' (Table Editor
-- -> site_settings) and put the login card back on login.html / mmg.html.
--
-- Safe to run more than once. Needs 009 and 031.

begin;

insert into public.site_settings (key, value) values ('mmg_portal_open', 'false')
on conflict (key) do nothing;

create or replace function public.mmg_portal_open()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select lower(btrim(s.value)) = 'true' from public.site_settings s where s.key = 'mmg_portal_open'), false);
$$;

revoke all on function public.mmg_portal_open() from public;
grant execute on function public.mmg_portal_open() to anon, authenticated;

drop policy if exists "A guest can create their own MMG account" on public.mmg_guests;
create policy "A guest can create their own MMG account"
  on public.mmg_guests for insert
  to authenticated
  with check (auth.uid() = id and public.mmg_portal_open());

commit;
