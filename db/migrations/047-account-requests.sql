-- Replaces "the committee creates every member's login by hand" with a
-- request-and-approve flow: anyone who's paid their LACMS membership can
-- submit their own details (full name, course, year, anything else worth
-- knowing) from a public page - no login needed, since they don't have
-- one yet - and it shows up as a pending row on the president dashboard's
-- new "Account requests" section. From there the president can mark
-- whether membership payment's been confirmed, nudge someone who hasn't
-- paid yet with a pre-filled email pointing at the Students' Union
-- purchase page, and approve a request straight into a real, working
-- login - the exact same signUp()-then-insert mechanism the dashboard's
-- existing Create Account form already uses (migration 032), just
-- triggered from a request instead of typed in fresh each time.
--
-- Also adds a one-time terms-of-use gate: members.terms_accepted_at,
-- null until a member explicitly agrees (shown as a blocking modal the
-- first time they land on the members hub with it unset - see
-- member-hub.html / js/members.js), and accept_terms() for them to set
-- it themselves.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query,
-- paste, Run. Needs 025 (is_president()), 032 (president can insert
-- members directly) already applied.

-- =======================================================================
-- 1. account_requests table.
-- =======================================================================

create table public.account_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  course text not null check (course in (
    'Medicine', 'Pharmacy', 'Dental Hygiene and Therapy',
    'Diagnostic Radiography', 'Nursing and Midwifery', 'Paramedic Science'
  )),
  year_of_study text not null check (year_of_study in (
    'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6'
  )),
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  membership_paid boolean not null default false,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.account_requests is 'Public, no-account requests for a LACMS member login - reviewed and approved from the president dashboard. Approving one creates the real auth account + members row from the browser (see js/members.js), then this row is updated to record that.';

alter table public.account_requests enable row level security;

-- Anyone can submit, signed in or not - this is the whole point (nobody
-- has a login yet when they fill this in). The with check mirrors the
-- column checks above plus bounds on the free-text fields, and pins
-- every review-only column to its untouched default - a crafted insert
-- can't mark itself pre-approved or pre-paid no matter what the client
-- sends, since the review columns are the president's to set, never the
-- requester's.
create policy "Anyone can submit an account request"
  on public.account_requests for insert
  to anon, authenticated
  with check (
    char_length(full_name) between 1 and 200
    and char_length(note) <= 2000
    and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    and status = 'pending'
    and membership_paid = false
    and reviewed_by is null
    and reviewed_at is null
    and created_member_id is null
  );

-- One pending request per email at a time - a second submission while
-- the first is still awaiting review fails outright (caught client-side
-- and shown as a friendly "already pending" message) rather than
-- quietly piling up duplicates for the same person.
create unique index account_requests_pending_email_idx
  on public.account_requests (lower(email))
  where status = 'pending';

-- No select policy for anon/authenticated: like the mentor applications
-- table, submissions are write-only from the public side, readable only
-- by the president via the RPC below.

create or replace function public.president_get_account_requests()
returns table (
  id uuid, full_name text, email text, course text, year_of_study text,
  note text, status text, membership_paid boolean,
  reviewed_by uuid, reviewed_at timestamptz, created_member_id uuid, created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  return query
    select ar.id, ar.full_name, ar.email, ar.course, ar.year_of_study,
           ar.note, ar.status, ar.membership_paid,
           ar.reviewed_by, ar.reviewed_at, ar.created_member_id, ar.created_at
    from public.account_requests ar
    order by ar.created_at desc;
end;
$$;

create or replace function public.president_set_account_request_paid(target_id uuid, is_paid boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  update public.account_requests set membership_paid = is_paid where id = target_id and status = 'pending';
end;
$$;

create or replace function public.president_reject_account_request(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  update public.account_requests
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
  where id = target_id and status = 'pending';
end;
$$;

-- Called from js/members.js right after it's already created the real
-- login (signUp()) and members row for this request - this just records
-- that it happened. Deliberately doesn't create the account itself:
-- Postgres has no way to call Supabase Auth's signup API, so that part
-- can only ever happen from the browser.
create or replace function public.president_mark_account_request_approved(target_id uuid, new_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  update public.account_requests
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), created_member_id = new_member_id
  where id = target_id and status = 'pending';
end;
$$;

create or replace function public.president_delete_account_request(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  delete from public.account_requests where id = target_id;
end;
$$;

-- =======================================================================
-- 2. One-time terms-of-use gate for members.
-- =======================================================================

alter table public.members add column if not exists terms_accepted_at timestamptz;

comment on column public.members.terms_accepted_at is 'Null until the member agrees to the data-use terms shown as a blocking modal on first visiting the members hub (see member-hub.html). Applies to every member row, not just ones created via account_requests - an existing member who signed up before this existed will also be asked, once.';

create or replace function public.accept_terms()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.members set terms_accepted_at = now() where id = auth.uid();
end;
$$;
