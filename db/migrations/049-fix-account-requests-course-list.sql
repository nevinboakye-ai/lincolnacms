-- Two fixes for account_requests (migration 047):
--
-- 1. Fixes "new row violates row-level security policy for table
--    'account_requests'" when submitting a request with the optional
--    "anything else?" note left blank. The insert policy's with check
--    included `char_length(note) <= 2000` unconditionally - but note is
--    nullable, and in SQL, NULL <= 2000 evaluates to NULL rather than
--    true, which makes the whole `and`-chain evaluate to NULL. RLS only
--    ever lets a row through when its check evaluates to true, so a
--    plain NULL silently rejects the row - exactly what happened to
--    every request that left the optional field empty (almost all of
--    them). Fixed by only checking the length when a note was actually
--    given.
--
-- 2. Updates the allowed course list: Paramedic Science is out, Nursing
--    and Midwifery are now two separate courses instead of one combined
--    option, and Biomedical Science and Occupational Therapy are new.
--    Matches the updated dropdowns in request-account.html and the
--    dashboard's Create Account/Manage Accounts course field.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query,
-- paste, Run. Needs 047 already applied.

drop policy if exists "Anyone can submit an account request" on public.account_requests;

create policy "Anyone can submit an account request"
  on public.account_requests for insert
  to anon, authenticated
  with check (
    char_length(full_name) between 1 and 200
    and (note is null or char_length(note) <= 2000)
    and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    and status = 'pending'
    and membership_paid = false
    and reviewed_by is null
    and reviewed_at is null
    and created_member_id is null
  );

alter table public.account_requests drop constraint if exists account_requests_course_check;

-- "not valid" so this can't fail even if a row already exists with one
-- of the old values (e.g. "Paramedic Science", or "Nursing and
-- Midwifery" from before it split in two) - existing rows just aren't
-- rechecked against it, only anything inserted or updated from here on.
alter table public.account_requests add constraint account_requests_course_check check (course in (
  'Medicine', 'Pharmacy', 'Dental Hygiene and Therapy', 'Diagnostic Radiography',
  'Nursing', 'Midwifery', 'Biomedical Science', 'Occupational Therapy'
)) not valid;
