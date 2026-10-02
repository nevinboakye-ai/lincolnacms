-- Updates the allowed year-of-study list: Year 6 is out, Foundation Year
-- and Masters are new. Matches the updated dropdown in
-- request-account.html.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query,
-- paste, Run. Needs 047 already applied.

alter table public.account_requests drop constraint if exists account_requests_year_of_study_check;

-- "not valid" so this can't fail even if a row already exists with
-- "Year 6" from before it was replaced with Foundation Year/Masters -
-- existing rows just aren't rechecked, only anything inserted or
-- updated from here on.
alter table public.account_requests add constraint account_requests_year_of_study_check check (year_of_study in (
  'Foundation Year', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Masters'
)) not valid;
