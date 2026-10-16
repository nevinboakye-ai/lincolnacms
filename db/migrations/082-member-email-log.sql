-- A log of the automatic confirmation emails members get after they apply to
-- Sankofa or nominate someone for Member of the Month (the send-member-email
-- Edge Function). It does two jobs:
--   * Safety: a unique key on (kind, ref_id) for emails that are sending or
--     sent means the same application / nomination can never produce two
--     emails, however many times the page or a retry calls the function. A
--     failed send is recorded as 'failed' and can be tried again.
--   * Visibility: the president can read it (who was emailed, when, and why a
--     send failed) from the dashboard's SQL / Table Editor.
-- Written only by the function (with its service key); members can't read or
-- write it.
--
-- Wrapped in a transaction. Run this once in Supabase: Dashboard -> SQL Editor
-- -> New query, paste, Run. Needs 025 (is_president). Safe to run again.

begin;

create table if not exists public.member_email_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('sankofa_application', 'motm_nomination')),
  ref_id uuid not null,
  user_id uuid references auth.users(id) on delete cascade,
  recipient text not null,
  status text not null check (status in ('sending', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

create unique index if not exists member_email_log_once
  on public.member_email_log (kind, ref_id)
  where status in ('sending', 'sent');

alter table public.member_email_log enable row level security;

drop policy if exists "President can read the member email log" on public.member_email_log;
create policy "President can read the member email log"
  on public.member_email_log for select
  to authenticated
  using (public.is_president());

commit;
