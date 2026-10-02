-- Moves password creation from "a random password the dashboard invents,
-- then an email with a link to replace it" (approval time) to "the
-- requester sets and confirms their own, for real" (request time) -
-- fixes approved accounts not being able to log in, since the old flow
-- depended on that password-reset email actually working and getting
-- clicked, and apparently wasn't reliably landing them somewhere that
-- worked.
--
-- request-account.html now runs signUp() itself, immediately, with
-- whatever password the requester chose - account_requests just needs a
-- column linking its row to that already-created login, so approving
-- later can attach a members row to it directly instead of creating the
-- account all over again.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query,
-- paste, Run. Needs 047 and 052 already applied.

alter table public.account_requests add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

drop policy if exists "Anyone can submit an account request" on public.account_requests;

create policy "Anyone can submit an account request"
  on public.account_requests for insert
  to anon, authenticated
  with check (
    char_length(full_name) between 1 and 200
    and char_length(student_number) between 1 and 50
    and (note is null or char_length(note) <= 2000)
    and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    and auth_user_id is not null
    and status = 'pending'
    and membership_paid = false
    and reviewed_by is null
    and reviewed_at is null
    and created_member_id is null
  );

-- Postgres won't let create or replace change a function's column list
-- (only its body), so adding auth_user_id here means this one has to be
-- dropped and recreated rather than just replaced - same thing 052 hit
-- adding student_number.
drop function if exists public.president_get_account_requests();

create function public.president_get_account_requests()
returns table (
  id uuid, full_name text, email text, auth_user_id uuid, student_number text, course text, year_of_study text,
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
    select ar.id, ar.full_name, ar.email, ar.auth_user_id, ar.student_number, ar.course, ar.year_of_study,
           ar.note, ar.status, ar.membership_paid,
           ar.reviewed_by, ar.reviewed_at, ar.created_member_id, ar.created_at
    from public.account_requests ar
    order by ar.created_at desc;
end;
$$;
