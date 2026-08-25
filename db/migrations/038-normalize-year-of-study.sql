-- Fixes a real inconsistency: some members were added with year_of_study
-- written out in words ("Year Three"), others with digits ("Year 3") —
-- both mean the same thing, but a brand-new account stored as "Year 3"
-- landed in its own separate group on the Network page next to
-- everyone else's "Year Three", since the underlying text values never
-- actually matched even though they display the same way once grouped.
--
-- This is a one-time backfill, converting every existing "Year One"
-- through "Year Seven" (case-insensitive, exact match only — this
-- deliberately doesn't touch anything with extra text around it, e.g.
-- "Year Three (transferred)", to avoid silently discarding real detail)
-- to the digit form "Year 1".."Year 7". Digit form was chosen as the
-- one canonical form going forward because it's already what
-- js/members.js's yearGroupLabel() normalises every value to for
-- display/grouping purposes everywhere on the site — this just makes
-- the stored data actually match what already gets shown. New/edited
-- accounts from here on are normalised to this same form client-side
-- (Create Account and Manage Accounts, see js/members.js) before they
-- ever reach the database, so this file should only ever need running
-- once.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. No prior migration required beyond the base schema.

update public.members set year_of_study = 'Year 1' where year_of_study ~* '^year\s+one$';
update public.members set year_of_study = 'Year 2' where year_of_study ~* '^year\s+two$';
update public.members set year_of_study = 'Year 3' where year_of_study ~* '^year\s+three$';
update public.members set year_of_study = 'Year 4' where year_of_study ~* '^year\s+four$';
update public.members set year_of_study = 'Year 5' where year_of_study ~* '^year\s+five$';
update public.members set year_of_study = 'Year 6' where year_of_study ~* '^year\s+six$';
update public.members set year_of_study = 'Year 7' where year_of_study ~* '^year\s+seven$';

update public.pending_members set year_of_study = 'Year 1' where year_of_study ~* '^year\s+one$';
update public.pending_members set year_of_study = 'Year 2' where year_of_study ~* '^year\s+two$';
update public.pending_members set year_of_study = 'Year 3' where year_of_study ~* '^year\s+three$';
update public.pending_members set year_of_study = 'Year 4' where year_of_study ~* '^year\s+four$';
update public.pending_members set year_of_study = 'Year 5' where year_of_study ~* '^year\s+five$';
update public.pending_members set year_of_study = 'Year 6' where year_of_study ~* '^year\s+six$';
update public.pending_members set year_of_study = 'Year 7' where year_of_study ~* '^year\s+seven$';
