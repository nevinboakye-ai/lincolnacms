-- Fixes the "shows as logged in but they told me they couldn't" bug.
--
-- Migration 025's backfill set activated_at = last_sign_in_at for
-- anyone who had ever signed in at all — but last_sign_in_at gets set
-- the instant an invite link is opened, before a password is ever
-- chosen (the exact original bug this whole feature was built to
-- surface). That backfill accidentally credited "opened the invite"
-- as "finished setting up" for every affected account, which is
-- precisely backwards.
--
-- There's no reliable way to tell "opened it and got stuck" apart from
-- "opened it and finished" using only what auth.users exposes — both
-- look identical from the outside. So instead of guessing again with a
-- smarter heuristic that could just as easily be wrong the other way,
-- this reverts the incorrect guess and adds a one-click manual
-- override on the dashboard for you to confirm the ones you actually
-- know about (yourself, Roberta, anyone else who's told you it worked).
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. Needs migration 025 already applied.

-- ---------------------------------------------------------------------
-- Only reverts rows the flawed backfill actually touched — identified
-- by activated_at being an exact match for last_sign_in_at, which only
-- ever happens as a result of that backfill (the real activation path,
-- mark_account_activated(), always stamps a distinctly later "now()").
-- Anyone activated for real, by that function, is untouched.
update public.members m
  set activated_at = null
  from auth.users u
  where u.id = m.id and m.activated_at = u.last_sign_in_at;

update public.network_professionals np
  set activated_at = null
  from auth.users u
  where u.id = np.user_id and np.activated_at = u.last_sign_in_at;

update public.mmg_guests g
  set activated_at = null
  from auth.users u
  where u.id = g.id and g.activated_at = u.last_sign_in_at;

-- ---------------------------------------------------------------------
-- One-click manual override — for the accounts you have direct
-- confirmation actually work (starting with your own), rather than
-- editing Table Editor by hand. Deliberately narrow: only ever touches
-- activated_at, on one row, for one of the three known account types.
create or replace function public.president_mark_activated(target_id uuid, target_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;

  if target_type = 'member' then
    update public.members set activated_at = coalesce(activated_at, now()) where id = target_id;
  elsif target_type = 'professional' then
    update public.network_professionals set activated_at = coalesce(activated_at, now()) where id = target_id;
  elsif target_type = 'mmg' then
    update public.mmg_guests set activated_at = coalesce(activated_at, now()) where id = target_id;
  end if;
end;
$$;
