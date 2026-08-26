-- Fixes deleted accounts still showing up in the "X just joined the
-- Network" activity feed (member-hub.html's banner and
-- member-network.html's ticker) — network_join_events captures a
-- member/professional's name at the moment they join and never re-reads
-- it live (deliberately, so the feed stays correct even if someone's
-- details change later), which also meant deleting their account left
-- that captured row behind untouched. The foreign keys were already
-- "on delete set null" rather than cascade (migrations 020/022), so the
-- event row itself just silently kept existing with a null owner —
-- exactly the kind of orphan that's easy to miss until someone notices
-- a deleted person still showing up as "just joined".
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. Needs 020 and 022 already applied.

-- One-time cleanup: remove join events for accounts already deleted
-- before this migration existed (member_id/professional_id already
-- null from the old "on delete set null" behaviour).
delete from public.network_join_events where event_type = 'member' and member_id is null;
delete from public.network_join_events where event_type = 'professional' and professional_id is null;

-- Going forward: deleting a member or professional now takes their
-- join event(s) with them, via a before-delete trigger rather than
-- relying on the foreign key alone — a trigger can actually delete the
-- row, where the FK's own "on delete set null" could only ever null out
-- the reference and leave the (now-anonymous, still-visible) event
-- sitting there. Left the FK's "on delete set null" behaviour in place
-- underneath this — this trigger is what actually acts on it.
create or replace function public.cleanup_join_events_on_member_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.network_join_events where member_id = old.id;
  return old;
end;
$$;

drop trigger if exists members_cleanup_join_events on public.members;
create trigger members_cleanup_join_events
  before delete on public.members
  for each row
  execute function public.cleanup_join_events_on_member_delete();

create or replace function public.cleanup_join_events_on_professional_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.network_join_events where professional_id = old.id;
  return old;
end;
$$;

drop trigger if exists network_professionals_cleanup_join_events on public.network_professionals;
create trigger network_professionals_cleanup_join_events
  before delete on public.network_professionals
  for each row
  execute function public.cleanup_join_events_on_professional_delete();
