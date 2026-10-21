-- 096: healthcare professionals can request an account (the committee approves)
--
-- Students already request an account and the president approves it (047). This is
-- the same for healthcare professionals - doctors, pharmacists and other clinicians
-- who want to support LACMS - with the questions that matter for them: who they are,
-- what they do and where, how they're connected to Lincoln, and how they'd like to help.
--
-- Like the student request, they choose their own password when they ask (the page
-- creates their login then), so approving just adds their professional profile to
-- that login - no further emails or password steps. Until approved they can sign in
-- but see nothing: the Network, Sankofa and the rest all check for a real profile.
--
-- People the committee has invited (for example doctors in programmes like Sankofa Circles) use the same
-- form: they pick "I've been invited" and the dashboard marks the request as invited.
--
-- Requests are write-only for the public and readable only by the president (through
-- the RPCs below).
--
-- If you ran an earlier copy that also asked for a regulator and registration number or who invited
-- someone, those columns are simply left empty and unused (drop them whenever you like).
--
-- Safe to run more than once. Needs 014, 015, 025 and 032.

begin;

create table if not exists public.professional_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  auth_user_id uuid references auth.users (id) on delete set null,
  category text not null check (category in ('senior_doctor', 'alumni_doctor', 'pharmacist', 'other')),
  job_title text not null,
  organisation text not null,
  specialty text,
  lincoln_connection text not null check (lincoln_connection in ('lincoln_graduate', 'other_university', 'invited', 'none')),
  graduation_year text,
  ways_to_help text[] not null default '{}',
  linkedin_url text,
  bio text,
  note text,
  consent_network boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_professional_id uuid references public.network_professionals (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.professional_requests enable row level security;

-- Anyone can ask (they have no login yet). Lengths are bounded and every review
-- column is pinned to its starting value, so a crafted request can't mark itself
-- approved.
drop policy if exists "Anyone can submit a professional account request" on public.professional_requests;
create policy "Anyone can submit a professional account request"
  on public.professional_requests for insert
  to anon, authenticated
  with check (
    char_length(btrim(full_name)) between 1 and 200
    and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    and char_length(email) <= 254
    and auth_user_id is not null
    and char_length(btrim(job_title)) between 1 and 150
    and char_length(btrim(organisation)) between 1 and 200
    and (specialty is null or char_length(specialty) <= 150)
    and (graduation_year is null or char_length(graduation_year) <= 20)
    and cardinality(ways_to_help) <= 8
    and (linkedin_url is null or char_length(linkedin_url) <= 300)
    and (bio is null or char_length(bio) <= 1200)
    and (note is null or char_length(note) <= 2000)
    and consent_network = true
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and created_professional_id is null
  );

-- One pending request per email at a time.
create unique index if not exists professional_requests_pending_email_idx
  on public.professional_requests (lower(email))
  where status = 'pending';

-- No select policy for the public: the president reads requests through the RPC.

create or replace function public.president_get_professional_requests()
returns setof public.professional_requests
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  return query select * from public.professional_requests order by created_at desc;
end;
$$;

create or replace function public.president_reject_professional_request(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  update public.professional_requests
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
  where id = target_id and status = 'pending';
end;
$$;

-- Called right after the browser has added the professional's profile for an approved request.
create or replace function public.president_mark_professional_request_approved(target_id uuid, new_professional_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  update public.professional_requests
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), created_professional_id = new_professional_id
  where id = target_id and status = 'pending';
end;
$$;

create or replace function public.president_delete_professional_request(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  delete from public.professional_requests where id = target_id and status <> 'pending';
end;
$$;

revoke all on public.professional_requests from anon, authenticated;
grant insert on public.professional_requests to anon, authenticated;

revoke all on function public.president_get_professional_requests() from public, anon;
revoke all on function public.president_reject_professional_request(uuid) from public, anon;
revoke all on function public.president_mark_professional_request_approved(uuid, uuid) from public, anon;
revoke all on function public.president_delete_professional_request(uuid) from public, anon;
grant execute on function public.president_get_professional_requests() to authenticated;
grant execute on function public.president_reject_professional_request(uuid) to authenticated;
grant execute on function public.president_mark_professional_request_approved(uuid, uuid) to authenticated;
grant execute on function public.president_delete_professional_request(uuid) to authenticated;

commit;
