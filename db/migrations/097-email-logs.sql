-- 097: keep track of emails sent from the website
--
-- 1. professional_request_emails: like account_request_emails (057/077) for students, a
--    record of every email sent about a healthcare professional's account request
--    (the "request received" note, the approval email, or anything you write), shown
--    on each request's card in Dashboard > Account requests > Healthcare professionals.
-- 2. email_log: a record of every email sent from the new Dashboard > Email section
--    (to any group or person you choose - for example only the students who applied to
--    Sankofa): who it went to, what it said, when, and whether it was sent or failed.
--    Emails sent together share a batch_id so the "Sent" list can group them.
--
-- Both are readable and writable by the president only. Sending itself is done by the
-- send-account-email Edge Function exactly as for the student emails (no redeploy needed).
--
-- Safe to run more than once. Needs 025 and 096.

begin;

create table if not exists public.professional_request_emails (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.professional_requests (id) on delete cascade,
  email_type text not null check (email_type in ('received', 'approved', 'custom')),
  recipient text not null,
  status text not null check (status in ('sent', 'failed')),
  error text,
  subject text,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists professional_request_emails_request_idx
  on public.professional_request_emails (request_id, created_at desc);

alter table public.professional_request_emails enable row level security;

drop policy if exists "President can view professional request emails" on public.professional_request_emails;
create policy "President can view professional request emails"
  on public.professional_request_emails for select to authenticated
  using (public.is_president());

drop policy if exists "President can log professional request emails" on public.professional_request_emails;
create policy "President can log professional request emails"
  on public.professional_request_emails for insert to authenticated
  with check (public.is_president());

-- ---------------------------------------------------------------------
create table if not exists public.email_log (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  recipient_email text not null,
  recipient_name text,
  recipient_kind text,
  audience text,
  subject text not null,
  message text not null,
  status text not null check (status in ('sent', 'failed')),
  error text,
  sent_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists email_log_batch_idx on public.email_log (batch_id, created_at);
create index if not exists email_log_created_idx on public.email_log (created_at desc);
create index if not exists email_log_recipient_idx on public.email_log (lower(recipient_email), created_at desc);

alter table public.email_log enable row level security;

drop policy if exists "President can view the email log" on public.email_log;
create policy "President can view the email log"
  on public.email_log for select to authenticated
  using (public.is_president());

drop policy if exists "President can add to the email log" on public.email_log;
create policy "President can add to the email log"
  on public.email_log for insert to authenticated
  with check (public.is_president());

revoke all on public.professional_request_emails, public.email_log from anon;

commit;
