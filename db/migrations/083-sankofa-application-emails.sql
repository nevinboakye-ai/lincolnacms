-- A log of the emails the president sends to Sankofa applicants from the
-- dashboard (Dashboard -> Sankofa -> an application -> "Emails"): the one-click
-- "send / resend confirmation" and any email written from the composer. Shown
-- under each application so you can see what each person has been sent, when,
-- and why a send failed. Applications are in two tables (members' mentee
-- applications and doctors' mentor applications), so application_id is just the
-- id, with applicant_type saying which; deleting an application doesn't need to
-- delete its log.
--
-- Wrapped in a transaction. Run this once in Supabase: Dashboard -> SQL Editor
-- -> New query, paste, Run. Needs 025 (is_president). Safe to run again.
-- (Sending the emails needs nothing new: it uses the send-account-email
-- function you already have deployed, with its custom-email support, section 129.)

begin;

create table if not exists public.sankofa_application_emails (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  applicant_type text not null check (applicant_type in ('mentee', 'mentor')),
  recipient text not null,
  status text not null check (status in ('sent', 'failed')),
  error text,
  subject text,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists sankofa_application_emails_app_idx
  on public.sankofa_application_emails (application_id, created_at desc);

alter table public.sankofa_application_emails enable row level security;

drop policy if exists "President manages Sankofa application emails" on public.sankofa_application_emails;
create policy "President manages Sankofa application emails"
  on public.sankofa_application_emails for all
  to authenticated
  using (public.is_president())
  with check (public.is_president());

commit;
