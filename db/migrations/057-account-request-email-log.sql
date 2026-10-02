-- A log of every automatic email sent (or attempted) from the Account
-- Requests dashboard section - approval emails and payment reminders -
-- so the president can see what each person has been sent, whether it
-- actually went out, and why not if it didn't (the error text Resend
-- returned is stored too). Written by the dashboard right after each
-- send attempt (js/members.js, sendAccountEmail), not by the Edge
-- Function, so the function itself needs no redeploy.
--
-- Deleting a request deletes its email log with it (on delete cascade).
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query,
-- paste, Run. Needs migrations 025 (is_president()) and 047.

create table if not exists public.account_request_emails (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.account_requests(id) on delete cascade,
  email_type text not null check (email_type in ('approved', 'payment_reminder')),
  recipient text not null,
  status text not null check (status in ('sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists account_request_emails_request_idx
  on public.account_request_emails (request_id, created_at desc);

alter table public.account_request_emails enable row level security;

drop policy if exists "President can view account request emails" on public.account_request_emails;
create policy "President can view account request emails"
  on public.account_request_emails for select
  to authenticated
  using (public.is_president());

drop policy if exists "President can log account request emails" on public.account_request_emails;
create policy "President can log account request emails"
  on public.account_request_emails for insert
  to authenticated
  with check (public.is_president());
