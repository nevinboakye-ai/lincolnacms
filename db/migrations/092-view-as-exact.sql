-- 092: see the site exactly as a real person (president only)
--
-- "View the website as" a real person now loads the site as THEIR account, so
-- every list, lock, count and profile is what their own login returns, not an
-- approximation. The browser can't do that alone, so a small Edge Function
-- (supabase/functions/view-as) checks that the caller is the president and hands
-- back a one-hour access token for the person chosen. While a preview is open
-- the browser refuses every write, upload and email, and never shows private
-- chat messages (js/view-as.js).
--
-- This migration adds what that function needs:
--   * view_as_log: a record of each time it is used (who was viewed, when),
--     readable only by the president.
--   * view_as_before() / view_as_after(): signing a session in sets the person's
--     "last signed in" time. These save it first and put it back afterwards, so
--     the dashboard's "last seen" and "needs a nudge" lists aren't disturbed by
--     you looking at someone's view.
-- Both functions can only be called by the Edge Function (service role), never
-- from the website.
--
-- Safe to run more than once. Needs 025.

begin;

create table if not exists public.view_as_log (
  id bigint generated always as identity primary key,
  president_id uuid not null,
  target_id uuid not null,
  created_at timestamptz not null default now()
);

alter table public.view_as_log enable row level security;

drop policy if exists "President reads the view-as log" on public.view_as_log;
create policy "President reads the view-as log"
  on public.view_as_log for select to authenticated
  using (public.is_president());

revoke all on public.view_as_log from anon, authenticated;
grant select on public.view_as_log to authenticated;

create or replace function public.view_as_before(p_target uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.last_sign_in_at from auth.users u where u.id = p_target;
$$;

create or replace function public.view_as_after(p_president uuid, p_target uuid, p_prev timestamptz)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  update auth.users set last_sign_in_at = p_prev where id = p_target;
  insert into public.view_as_log (president_id, target_id) values (p_president, p_target);
end;
$$;

revoke all on function public.view_as_before(uuid) from public, anon, authenticated;
revoke all on function public.view_as_after(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.view_as_before(uuid) to service_role;
grant execute on function public.view_as_after(uuid, uuid, timestamptz) to service_role;

commit;
