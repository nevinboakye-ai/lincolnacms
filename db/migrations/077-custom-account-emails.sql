-- Custom emails to people who've requested an account.
--
-- In the dashboard's Account Requests section the president can now write
-- their own email to any requester (for example "please sign up with your
-- University of Lincoln email instead of a personal one"), starting from a
-- built-in or saved template, with {first_name} / {name} / {email} filled in
-- for each person. This migration:
--   * lets the email log (account_request_emails, 057) record those emails -
--     email_type 'custom', plus the subject and message that went out - so
--     each request's card shows what was sent and when;
--   * adds account_email_templates, the president's saved templates (only the
--     president can see or change them).
-- Sending itself is done by the send-account-email Edge Function, which has to
-- be redeployed with its latest code (see README-members-setup.md, section 129).
--
-- Wrapped in a transaction. Run this once in Supabase: Dashboard -> SQL Editor
-- -> New query, paste, Run. Needs 047, 057 and 025 (is_president()). The
-- composer still works without it - it just can't save templates or log the
-- custom emails.

begin;

alter table public.account_request_emails drop constraint if exists account_request_emails_email_type_check;
alter table public.account_request_emails add constraint account_request_emails_email_type_check
  check (email_type in ('approved', 'payment_reminder', 'custom'));
alter table public.account_request_emails add column if not exists subject text;
alter table public.account_request_emails add column if not exists message text;

create table if not exists public.account_email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  subject text not null check (char_length(subject) between 1 and 150),
  message text not null check (char_length(message) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.account_email_templates enable row level security;

drop policy if exists "President manages email templates" on public.account_email_templates;
create policy "President manages email templates"
  on public.account_email_templates for all
  to authenticated
  using (public.is_president())
  with check (public.is_president());

commit;
