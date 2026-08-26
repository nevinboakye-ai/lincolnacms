-- Fixes: editing someone's name (or course/year/type, or a
-- professional's title/organisation/category) via the dashboard's
-- Manage Accounts card — or anywhere else, Table Editor included —
-- left the old value sitting in network_join_events, since that table
-- deliberately captures a snapshot at the moment someone joins (see
-- migration 020's comment) rather than reading live. That's the right
-- call for someone who's since left, but wrong for a simple typo fix or
-- correction: "Odiri Oteri" edited to "Dr Odiri Oteri" updated the
-- Network directory immediately (that reads live) but the "just joined"
-- banner and ticker kept showing the old name, since nothing told that
-- snapshot to update.
--
-- Two `after update` triggers make the snapshot self-healing from here
-- on — any future edit to a captured field, through any path, updates
-- the matching network_join_events row(s) automatically. Plus a
-- one-time backfill that resyncs every existing row right now, which is
-- what actually fixes the Odiri Oteri case (and anything else that's
-- already drifted) the moment this migration runs.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. Needs 020 and 022 already applied.

create or replace function public.sync_member_join_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.full_name is distinct from old.full_name
     or new.course is distinct from old.course
     or new.year_of_study is distinct from old.year_of_study
     or new.member_type is distinct from old.member_type then
    update public.network_join_events
    set full_name = new.full_name,
        course = new.course,
        year_of_study = new.year_of_study,
        member_type = new.member_type
    where member_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists members_sync_join_event on public.members;
create trigger members_sync_join_event
  after update on public.members
  for each row
  execute function public.sync_member_join_event();

create or replace function public.sync_professional_join_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.full_name is distinct from old.full_name
     or new.title is distinct from old.title
     or new.organisation is distinct from old.organisation
     or new.category is distinct from old.category then
    update public.network_join_events
    set full_name = new.full_name,
        title = new.title,
        organisation = new.organisation,
        category = new.category
    where professional_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists network_professionals_sync_join_event on public.network_professionals;
create trigger network_professionals_sync_join_event
  after update on public.network_professionals
  for each row
  execute function public.sync_professional_join_event();

-- One-time resync — fixes every row already sitting stale right now,
-- Odiri Oteri included. Safe to run more than once; it just re-writes
-- the same values if nothing's actually out of sync.
update public.network_join_events e
set full_name = m.full_name,
    course = m.course,
    year_of_study = m.year_of_study,
    member_type = m.member_type
from public.members m
where e.event_type = 'member' and e.member_id = m.id;

update public.network_join_events e
set full_name = p.full_name,
    title = p.title,
    organisation = p.organisation,
    category = p.category
from public.network_professionals p
where e.event_type = 'professional' and e.professional_id = p.id;
