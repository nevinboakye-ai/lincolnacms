-- Adds a student number field, collected on the account request form
-- and carried through to the real members row once approved - mainly
-- useful for cross-checking a request against the Students' Union's own
-- membership records, which is keyed by student number as much as by
-- name or email.
--
-- Required on new requests going forward (account_requests.student_number
-- is not null); nullable on members, since existing members obviously
-- don't have one on file yet and there's no way to backfill it from
-- here. Also addable any time from the dashboard's Create Account form
-- or an existing member's Edit Account modal, for anyone who wants it
-- recorded outside the request flow too.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query,
-- paste, Run. Needs 047 already applied.

alter table public.members add column if not exists student_number text;

alter table public.account_requests add column if not exists student_number text;

-- Existing pending rows (there shouldn't be more than a handful) won't
-- have one - backfill with a placeholder so the not-null constraint
-- below doesn't fail on them. Anyone actually mid-review should just
-- have the real requester re-submit if this matters for their case.
update public.account_requests set student_number = 'not provided' where student_number is null;

alter table public.account_requests alter column student_number set not null;

drop policy if exists "Anyone can submit an account request" on public.account_requests;

create policy "Anyone can submit an account request"
  on public.account_requests for insert
  to anon, authenticated
  with check (
    char_length(full_name) between 1 and 200
    and char_length(student_number) between 1 and 50
    and (note is null or char_length(note) <= 2000)
    and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    and status = 'pending'
    and membership_paid = false
    and reviewed_by is null
    and reviewed_at is null
    and created_member_id is null
  );

create or replace function public.president_get_account_requests()
returns table (
  id uuid, full_name text, email text, student_number text, course text, year_of_study text,
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
    select ar.id, ar.full_name, ar.email, ar.student_number, ar.course, ar.year_of_study,
           ar.note, ar.status, ar.membership_paid,
           ar.reviewed_by, ar.reviewed_at, ar.created_member_id, ar.created_at
    from public.account_requests ar
    order by ar.created_at desc;
end;
$$;
