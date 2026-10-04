-- Events page content becomes editable in Supabase: Dashboard -> Table
-- Editor -> site_events. events.html still contains the original events
-- as static HTML (a fallback if this table is empty or unreachable); once
-- this table has active rows, the page shows those instead.
--
-- Columns, in Table Editor terms:
--   slug          - the event's permanent id. Registrations
--                   (event_registrations) are keyed on it, so DON'T change
--                   it on an event that people have registered for.
--   name          - event title (also what's saved with each registration).
--   date_text     - shown as-is, e.g. "30 September 2026" (free text, so
--                   "TBC" or "Spring 2027" both work).
--   time_note     - small line under the date, e.g. "Time & venue TBC" -
--                   put the real time/venue here once confirmed.
--   summary       - the short blurb always visible on the row.
--   tag           - small label, e.g. "Social", "Charity". tag_is_gold
--                   gives it the gold flagship styling.
--   details       - the longer text revealed when the row is expanded.
--   title_url     - optional: makes the title a link (e.g. mmg.html).
--   link_label / link_url - optional extra link line under the tag.
--   button_label / button_url - optional extra primary button.
--   is_flagship   - highlights the row as the flagship event.
--   is_active     - untick to hide an event without deleting it.
--   sort_order    - lowest first; the page shows events in this order.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query, paste,
-- Run. Safe to run again (existing rows are left alone).

create table if not exists public.site_events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  date_text text not null,
  time_note text,
  summary text not null,
  tag text,
  tag_is_gold boolean not null default false,
  details text,
  title_url text,
  link_url text,
  link_label text,
  button_url text,
  button_label text,
  is_flagship boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.site_events enable row level security;

drop policy if exists "Anyone can view active site events" on public.site_events;
create policy "Anyone can view active site events"
  on public.site_events for select
  to anon, authenticated
  using (is_active = true);

insert into public.site_events
  (slug, name, date_text, time_note, summary, tag, tag_is_gold, details, title_url, link_url, link_label, button_url, button_label, is_flagship, sort_order)
values
('welcome-and-launch', 'ACMS Welcome and Launch', '30 September 2026', 'Time & venue TBC', 'Kick off the year and meet the LACMS community - new and returning members all welcome.', 'Social', false, 'Kick things off in style - grab a drink, meet the committee and get the first look at everything LACMS has planned this year. No experience or prior involvement needed, just come along and say hello.', null, null, null, null, null, false, 10),
('games-night-1', 'ACMS Games Night 1', '8 October 2026', 'Time & venue TBC', 'Board games, video games and good company - a relaxed social to unwind and meet fellow members.', 'Social', false, 'Bring a friend or fly solo - board games, console games and snacks are all sorted. The perfect low-key way to unwind and meet fellow members mid-term.', null, null, null, null, null, false, 20),
('sankofa-circle-session-1', 'ACMS Sankofa Circle Session 1', '14 October 2026', 'Time & venue TBC', 'The first Sankofa Circle of the year, part of our ongoing mentorship programme pairing students with mentors.', 'Mentorship', false, 'The Sankofa Circles kick off their first session of the year - mentors and mentees meeting in small groups for real, guided conversation. Expect a supportive, informal space, not a lecture.', null, 'sankofa.html', 'Part of the Sankofa Mentorship programme', null, null, false, 30),
('professional-development-programme', 'ACMS Professional Development Programme', '21 October 2026', 'Time & venue TBC', 'Workshops and guidance to support your journey through medical school and beyond.', 'Careers', false, 'A hands-on session covering CV writing, interview technique and personal statements, with real insight from senior students and professional mentors who''ve been exactly where you are.', null, null, null, null, null, false, 40),
('games-night-2', 'ACMS Games Night 2', '11 November 2026', 'Time & venue TBC', 'Back by popular demand - another relaxed games night for members.', 'Social', false, 'Games Night is back by popular demand - same relaxed vibe as before, with a few new games thrown into the mix. A great excuse to catch up with friends before the exam-season stretch.', null, null, null, null, null, false, 50),
('world-diabetes-day-charity-tournament', 'World Diabetes Day Charity Tournament', '14 November 2026', 'Time & venue TBC', 'A charity sports tournament marking World Diabetes Day, raising awareness and funds for the cause.', 'Charity', false, 'Lace up for a five-a-side tournament open to every skill level - bring your competitive streak, because entry proceeds go straight to a diabetes charity. Teams of 5-7, sign up via RSVP.', null, null, null, null, null, false, 60),
('midlands-medics-gala', 'The ACMS Midlands Medics Gala', '21 November 2026', 'Time & venue TBC', 'Our flagship end-of-year formal, celebrating LACMS members'' achievements alongside societies from across the Midlands.', 'Flagship Event', true, 'A black-tie evening of awards, dinner and dancing, in collaboration with 7 universities including Nottingham, Birmingham and Leicester. Use the MMG Portal button for full details, and to log in for exclusive attendee and committee content.', 'mmg.html', null, null, 'mmg.html', 'MMG Portal', true, 70),
('winter-charity-fundraiser', 'ACMS Winter Charity Fundraiser', '3 December 2026', 'Time & venue TBC', 'Closing out the term by giving back - a charity fundraiser to end the year on a meaningful note.', 'Charity', false, 'A festive send-off to the term, with proceeds supporting a local winter-appeal charity - the perfect way to celebrate everything we''ve achieved while giving back. Format details to follow.', null, null, null, null, null, false, 80)
on conflict (slug) do nothing;
