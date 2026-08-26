-- Fixes "structure of query does not match function result type /
-- Returned type character varying(255) does not match expected type
-- text in column 3" on every president_get_* function that joins
-- auth.users. Postgres' auth.users.email column is actually
-- `character varying(255)`, not `text` — casting it explicitly in the
-- SELECT (rather than trying to match the RETURNS TABLE declaration to
-- an internal Supabase column type) is the simplest fix and keeps the
-- function's own signature as plain text either way.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. Needs migration 025 already applied.

create or replace function public.president_get_members()
returns table (
  id uuid, full_name text, email text, course text, year_of_study text,
  member_type text, committee_role text, membership_status text,
  mmg_attendee boolean, mmg_committee boolean,
  activated_at timestamptz, last_sign_in_at timestamptz, last_seen_at timestamptz, created_at timestamptz
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
    select m.id, m.full_name, u.email::text, m.course, m.year_of_study, m.member_type, m.committee_role,
           m.membership_status, m.mmg_attendee, m.mmg_committee,
           m.activated_at, u.last_sign_in_at, p.last_seen_at, m.created_at
    from public.members m
    join auth.users u on u.id = m.id
    left join public.member_presence p on p.id = m.id;
end;
$$;

create or replace function public.president_get_professionals()
returns table (
  id uuid, full_name text, email text, title text, organisation text, category text,
  activated_at timestamptz, last_sign_in_at timestamptz, last_seen_at timestamptz, created_at timestamptz
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
    select np.id, np.full_name, u.email::text, np.title, np.organisation, np.category,
           np.activated_at, u.last_sign_in_at, pr.last_seen_at, np.created_at
    from public.network_professionals np
    left join auth.users u on u.id = np.user_id
    left join public.member_presence pr on pr.id = np.user_id;
end;
$$;

create or replace function public.president_get_mmg_guests()
returns table (
  id uuid, full_name text, email text, university text, access_level text,
  activated_at timestamptz, last_sign_in_at timestamptz, last_seen_at timestamptz, created_at timestamptz
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
    select g.id, g.full_name, u.email::text, g.university, g.access_level,
           g.activated_at, u.last_sign_in_at, p.last_seen_at, g.created_at
    from public.mmg_guests g
    join auth.users u on u.id = g.id
    left join public.member_presence p on p.id = g.id;
end;
$$;
