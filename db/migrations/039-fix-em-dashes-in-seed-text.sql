-- The opportunities and news seed text (migrations 012 and 013) used
-- em dashes ("—") in a few spots. The site's own style is a plain
-- hyphen ("-"), so this updates the already-seeded rows to match -
-- editing those old migration files wouldn't touch data they already
-- inserted. Matched by title, so this is safe to run even if you've
-- since edited or deleted any of these rows in Table Editor (it just
-- won't match, and updates nothing).
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query,
-- paste, Run.

update public.member_opportunities
  set title = 'Clinical Shadowing - Lincoln County Hospital'
  where title = 'Clinical Shadowing — Lincoln County Hospital';

update public.member_opportunities
  set description = 'A one-week placement shadowing doctors across two or three departments - a good early taste of clinical practice for pre-clinical students. Spaces are limited and offered on a first-come basis.'
  where title in ('Clinical Shadowing - Lincoln County Hospital', 'Clinical Shadowing — Lincoln County Hospital');

update public.member_opportunities
  set description = 'Volunteer with a local charity delivering health education workshops to underserved communities in Lincoln. No clinical experience required - training is provided before your first session.'
  where title = 'Community Health Champions';

update public.news_posts
  set body = 'This is where we''ll share updates, announcements and stories throughout the year. Committee members can edit this feed directly from Table Editor - see README-members-setup.md for the full guide. Members can like and comment on any post once signed in.'
  where title = 'Welcome to LACMS News';

update public.news_posts
  set body = 'Congratulations to our new committee - we''re excited for the year ahead. Full introductions are on the About page.'
  where title = 'New committee elected for 2026/27';

update public.news_posts
  set body = 'Mark your calendars - our official launch event kicks off the year. Head to the Events page for the full calendar.'
  where title = 'LACMS officially launches 30 September';
