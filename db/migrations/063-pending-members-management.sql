-- Pending members: see, add, hide and remove people who've been added to
-- the Network before they have an account - from the president dashboard
-- (new "Pending Members" section) - and stop them showing up twice.
--
-- Why duplicates happened: a pending_members row is only turned into a
-- real member (and removed) when someone with that exact email logs in
-- and has no members row yet. People who requested an account on the
-- site (or were created from the dashboard) already had a members row by
-- then, so their pending row was never claimed or removed - they showed
-- on the Network twice, once as the real member and once as "Pending".
--
-- What this does:
--   1. A trigger removes a pending row automatically whenever a member
--      with the same account email is created from now on.
--   2. A one-off clean-up removes pending rows that already match an
--      existing account's email (certain duplicates).
--   3. The Network directory no longer lists a pending row if a member
--      with the same email or the same name already exists (so duplicates
--      with different emails disappear from the Network straight away).
--   4. Dashboard functions to list (flagging likely duplicates), add,
--      show/hide on the Network, and remove pending members.
--
-- The pending_members table itself is unchanged and still editable in
-- Supabase's Table Editor as before.
--
-- Wrapped in a transaction. Run this once in Supabase: Dashboard -> SQL
-- Editor -> New query, paste, Run. Needs 016, 017, 025 and 060.

begin;

-- 1. Auto-remove a pending row when the same person gets an account.
create or replace function public.remove_pending_on_member_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.pending_members pm
  where lower(pm.email) = (select lower(u.email) from auth.users u where u.id = new.id);
  return new;
end;
$$;

drop trigger if exists members_remove_pending on public.members;
create trigger members_remove_pending
  after insert on public.members
  for each row
  execute function public.remove_pending_on_member_created();

-- 2. One-off: pending rows whose email already belongs to a member.
delete from public.pending_members pm
where exists (
  select 1
  from auth.users u
  join public.members m on m.id = u.id
  where lower(u.email) = lower(pm.email)
);

-- 3. The Network directory, as in 060, minus pending rows that duplicate
--    an existing member (same email, or same name ignoring case/spacing).
create or replace function public.get_network_members()
returns table (
  id uuid,
  full_name text,
  course text,
  year_of_study text,
  member_type text,
  committee_role text,
  linkedin_url text,
  bio text,
  is_pending boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select m.id, m.full_name, m.course, m.year_of_study, m.member_type, m.committee_role,
         p.linkedin_url, p.bio, false as is_pending
  from public.members m
  left join public.member_profiles p on p.id = m.id
  where public.has_hub_access('network')
    and (public.is_lacms_member() or public.is_professional() or public.is_president())
    and m.membership_status = 'active'
  union all
  select pm.id, pm.full_name, pm.course, pm.year_of_study, pm.member_type, pm.committee_role,
         null::text as linkedin_url, null::text as bio, true as is_pending
  from public.pending_members pm
  where public.has_hub_access('network')
    and (public.is_lacms_member() or public.is_professional() or public.is_president())
    and pm.visible_in_network = true
    and not exists (
      select 1
      from public.members m2
      left join auth.users u2 on u2.id = m2.id
      where lower(btrim(m2.full_name)) = lower(btrim(pm.full_name))
         or lower(u2.email) = lower(pm.email)
    );
$$;

-- 4. Dashboard functions (president only).
create or replace function public.president_get_pending_members_detailed()
returns table (
  id uuid, email text, full_name text, course text, year_of_study text,
  member_type text, committee_role text, visible_in_network boolean,
  created_at timestamptz, dup_kind text, dup_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;

  return query
  select pm.id, pm.email, pm.full_name, pm.course, pm.year_of_study,
         pm.member_type, pm.committee_role, pm.visible_in_network, pm.created_at,
         case
           when acct.full_name is not null then 'account'
           when nm.full_name is not null then 'name'
           else null
         end,
         coalesce(acct.full_name, nm.full_name)
  from public.pending_members pm
  left join lateral (
    select m.full_name
    from auth.users u
    join public.members m on m.id = u.id
    where lower(u.email) = lower(pm.email)
    limit 1
  ) acct on true
  left join lateral (
    select m.full_name
    from public.members m
    where lower(btrim(m.full_name)) = lower(btrim(pm.full_name))
    limit 1
  ) nm on true
  order by pm.full_name;
end;
$$;

revoke all on function public.president_get_pending_members_detailed() from public, anon;
grant execute on function public.president_get_pending_members_detailed() to authenticated;

create or replace function public.president_add_pending_member(
  p_email text, p_full_name text, p_course text, p_year_of_study text, p_member_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  if clean_email = '' or position('@' in clean_email) = 0 then
    raise exception 'Enter a valid email address.';
  end if;
  if btrim(coalesce(p_full_name, '')) = '' then
    raise exception 'Enter their full name.';
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = clean_email) then
    raise exception 'That email already has an account - they don''t need to be added as pending.';
  end if;
  if exists (select 1 from public.pending_members pm where lower(pm.email) = clean_email) then
    raise exception 'That email is already in the pending list.';
  end if;

  insert into public.pending_members (email, full_name, course, year_of_study, member_type)
  values (
    clean_email,
    btrim(p_full_name),
    nullif(btrim(coalesce(p_course, '')), ''),
    nullif(btrim(coalesce(p_year_of_study, '')), ''),
    coalesce(nullif(p_member_type, ''), 'member')
  );
end;
$$;

revoke all on function public.president_add_pending_member(text, text, text, text, text) from public, anon;
grant execute on function public.president_add_pending_member(text, text, text, text, text) to authenticated;

create or replace function public.president_delete_pending_member(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  delete from public.pending_members where id = p_id;
end;
$$;

revoke all on function public.president_delete_pending_member(uuid) from public, anon;
grant execute on function public.president_delete_pending_member(uuid) to authenticated;

create or replace function public.president_set_pending_visibility(p_id uuid, p_visible boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  update public.pending_members set visible_in_network = coalesce(p_visible, true) where id = p_id;
end;
$$;

revoke all on function public.president_set_pending_visibility(uuid, boolean) from public, anon;
grant execute on function public.president_set_pending_visibility(uuid, boolean) to authenticated;

-- Removes every pending row whose email already has a member account
-- (certain duplicates only - same-name matches are left for you to check).
create or replace function public.president_remove_pending_duplicates()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  with gone as (
    delete from public.pending_members pm
    where exists (
      select 1 from auth.users u
      join public.members m on m.id = u.id
      where lower(u.email) = lower(pm.email)
    )
    returning 1
  )
  select count(*) into removed from gone;
  return removed;
end;
$$;

revoke all on function public.president_remove_pending_duplicates() from public, anon;
grant execute on function public.president_remove_pending_duplicates() to authenticated;

commit;
