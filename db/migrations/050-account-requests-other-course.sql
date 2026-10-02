-- The request form's course dropdown now has an "Other" option that
-- reveals a free-text field when picked, for anyone on a course that
-- isn't yet one of LACMS's usual eight. The fixed allow-list check
-- constraint from 049 can't work alongside that anymore - any custom
-- course typed in would violate it - so it's replaced here with just a
-- sane length bound, the same way full_name is already bounded.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query,
-- paste, Run. Needs 047 and 049 already applied.

alter table public.account_requests drop constraint if exists account_requests_course_check;

alter table public.account_requests add constraint account_requests_course_check
  check (char_length(course) between 1 and 200);
