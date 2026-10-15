-- Events calendar: real dates for events, and in-site editing for the
-- Executive Committee.
--
-- Until now an event's date was only free text ("30 September 2026"), which a
-- calendar can't use. This adds proper date and time columns alongside it:
--   starts_on / ends_on  - the day (and, for multi-day events, the last day)
--   start_time / end_time - optional times (UK local time)
--   venue                - optional place
-- date_text and time_note stay as the text shown in the list (the editor on the
-- Events page fills them in from the dates, times and venue for you), and an
-- event with no date (TBC) is still allowed - it simply isn't on the calendar.
-- Events that already exist get their dates filled in below (and the page can
-- read a date out of the old text if this hasn't been run yet).
--
-- Who can edit: anyone with the "Events" dashboard section in Hub Access
-- (the president and Executive Committee by default) can add, change, hide and
-- delete events straight from the Events page - no Table Editor needed.
-- Everyone else can only read active events, as before. An event's slug
-- (its permanent id - registrations are keyed on it) can't be changed once it
-- exists.
--
-- Wrapped in a transaction. Run this once in Supabase: Dashboard -> SQL Editor
-- -> New query, paste, Run. Needs 058 and 061. Safe to run again.

begin;

alter table public.site_events add column if not exists starts_on date;
alter table public.site_events add column if not exists ends_on date;
alter table public.site_events add column if not exists start_time time;
alter table public.site_events add column if not exists end_time time;
alter table public.site_events add column if not exists venue text;

alter table public.site_events drop constraint if exists site_events_dates_ok;
alter table public.site_events add constraint site_events_dates_ok
  check (ends_on is null or starts_on is null or ends_on >= starts_on);
alter table public.site_events drop constraint if exists site_events_venue_len;
alter table public.site_events add constraint site_events_venue_len
  check (venue is null or char_length(venue) <= 200);

-- Dates for the events that were already there (only where not set yet).
update public.site_events set starts_on = v.d
from (values
  ('welcome-and-launch', date '2026-09-30'),
  ('games-night-1', date '2026-10-08'),
  ('sankofa-circle-session-1', date '2026-10-14'),
  ('professional-development-programme', date '2026-10-21'),
  ('games-night-2', date '2026-11-11'),
  ('world-diabetes-day-charity-tournament', date '2026-11-14'),
  ('midlands-medics-gala', date '2026-11-21'),
  ('winter-charity-fundraiser', date '2026-12-03')
) as v(slug, d)
where site_events.slug = v.slug and site_events.starts_on is null;

-- Executives (Hub Access "Events" dashboard section) manage events.
drop policy if exists "Executives view all events" on public.site_events;
create policy "Executives view all events"
  on public.site_events for select
  to authenticated
  using (public.has_hub_access('dash_events'));

drop policy if exists "Executives add events" on public.site_events;
create policy "Executives add events"
  on public.site_events for insert
  to authenticated
  with check (public.has_hub_access('dash_events'));

drop policy if exists "Executives change events" on public.site_events;
create policy "Executives change events"
  on public.site_events for update
  to authenticated
  using (public.has_hub_access('dash_events'))
  with check (public.has_hub_access('dash_events'));

drop policy if exists "Executives delete events" on public.site_events;
create policy "Executives delete events"
  on public.site_events for delete
  to authenticated
  using (public.has_hub_access('dash_events'));

-- Registrations are keyed on the slug, so it can never change.
create or replace function public.site_events_keep_slug()
returns trigger
language plpgsql
as $$
begin
  if new.slug is distinct from old.slug then
    raise exception 'An event''s slug can''t be changed (registrations are keyed on it).';
  end if;
  return new;
end;
$$;

drop trigger if exists site_events_keep_slug on public.site_events;
create trigger site_events_keep_slug
  before update on public.site_events
  for each row
  execute function public.site_events_keep_slug();

commit;
