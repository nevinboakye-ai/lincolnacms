-- 106: Sankofa guest mentors - doctors who are in a Circle before they have a LACMS account
--
-- Until now only people with an account could be added to the Sankofa Hub, so a doctor who agreed
-- to mentor but hasn't signed up couldn't be put in a Circle. The committee can now add a mentor
-- by name (title, organisation, specialty, optional email and private notes) and put them in any
-- Circle. A Circle can hold as many mentors and mentees as you like, with or without accounts.
--
-- A guest mentor is either "pending" (hasn't confirmed yet) or "confirmed". Either way the Circle's
-- members see them by name, with a "pending" tag so no one is misled.
--
-- What a guest mentor is:
--   * A name card, not an account. They can't log in, message, earn XP or be paired one-to-one.
--   * Visible to the Circle's own members (name, title, organisation, specialty). Their email
--     and your private notes are for the committee only.
--   * When they sign up, "Link account" turns the card into a real mentor in the same Circle.
--
-- Who can use it: the same people who manage the Circles (the president and Sankofa managers).
-- Safe to run more than once. Needs 084, 085 and 090.

begin;

create table if not exists public.sankofa_guest_mentors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  title text check (title is null or char_length(title) <= 100),
  organisation text check (organisation is null or char_length(organisation) <= 100),
  specialty text check (specialty is null or char_length(specialty) <= 100),
  email text check (email is null or char_length(email) <= 200),
  note text check (note is null or char_length(note) <= 500),
  circle_id uuid references public.sankofa_circles (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- pending = the doctor hasn't confirmed yet (students still see them by name, marked "pending");
-- confirmed = they've agreed to mentor.
alter table public.sankofa_guest_mentors add column if not exists status text not null default 'pending';
alter table public.sankofa_guest_mentors drop constraint if exists sankofa_guest_mentors_status_check;
alter table public.sankofa_guest_mentors add constraint sankofa_guest_mentors_status_check check (status in ('pending', 'confirmed'));
create index if not exists sankofa_guest_mentors_circle_idx on public.sankofa_guest_mentors (circle_id);
alter table public.sankofa_guest_mentors enable row level security;
revoke all on public.sankofa_guest_mentors from anon, authenticated;

-- ---------------------------------------------------------------------
-- The committee
create or replace function public.sankofa_admin_guests()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.sankofa_is_admin() then raise exception 'Not authorized'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', g.id, 'name', g.name, 'title', g.title, 'organisation', g.organisation, 'specialty', g.specialty,
      'email', g.email, 'note', g.note, 'circle_id', g.circle_id, 'status', g.status, 'created_at', g.created_at) order by g.created_at)
    from public.sankofa_guest_mentors g), '[]'::jsonb);
end;
$$;

drop function if exists public.sankofa_admin_guest_save(uuid, text, text, text, text, text, text, uuid);
create or replace function public.sankofa_admin_guest_save(
  p_id uuid, p_name text, p_title text, p_organisation text, p_specialty text, p_email text, p_note text, p_circle uuid,
  p_status text default 'pending')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  nm text := btrim(coalesce(p_name, ''));
  new_id uuid;
  stat text := coalesce(nullif(btrim(p_status), ''), 'pending');
begin
  if not public.sankofa_is_admin() then raise exception 'Not authorized'; end if;
  if char_length(nm) < 2 then raise exception 'Enter the mentor''s name.'; end if;
  if stat not in ('pending', 'confirmed') then raise exception 'Status must be pending or confirmed.'; end if;
  if p_circle is not null and not exists (select 1 from public.sankofa_circles c where c.id = p_circle and c.status = 'active') then
    raise exception 'That Circle isn''t available.';
  end if;
  if p_id is null then
    insert into public.sankofa_guest_mentors (name, title, organisation, specialty, email, note, circle_id, status, created_by)
    values (left(nm, 80), nullif(left(btrim(coalesce(p_title, '')), 100), ''), nullif(left(btrim(coalesce(p_organisation, '')), 100), ''),
            nullif(left(btrim(coalesce(p_specialty, '')), 100), ''), nullif(left(btrim(coalesce(p_email, '')), 200), ''),
            nullif(left(btrim(coalesce(p_note, '')), 500), ''), p_circle, stat, auth.uid())
    returning id into new_id;
    return new_id;
  end if;
  update public.sankofa_guest_mentors set
    name = left(nm, 80), title = nullif(left(btrim(coalesce(p_title, '')), 100), ''), organisation = nullif(left(btrim(coalesce(p_organisation, '')), 100), ''),
    specialty = nullif(left(btrim(coalesce(p_specialty, '')), 100), ''), email = nullif(left(btrim(coalesce(p_email, '')), 200), ''),
    note = nullif(left(btrim(coalesce(p_note, '')), 500), ''), circle_id = p_circle, status = stat, updated_at = now()
  where id = p_id;
  if not found then raise exception 'That mentor no longer exists.'; end if;
  return p_id;
end;
$$;

create or replace function public.sankofa_admin_guest_move(p_id uuid, p_circle uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.sankofa_is_admin() then raise exception 'Not authorized'; end if;
  if p_circle is not null and not exists (select 1 from public.sankofa_circles c where c.id = p_circle and c.status = 'active') then
    raise exception 'That Circle isn''t available.';
  end if;
  update public.sankofa_guest_mentors set circle_id = p_circle, updated_at = now() where id = p_id;
  if not found then raise exception 'That mentor no longer exists.'; end if;
end;
$$;

create or replace function public.sankofa_admin_guest_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.sankofa_is_admin() then raise exception 'Not authorized'; end if;
  delete from public.sankofa_guest_mentors where id = p_id;
end;
$$;

-- They have signed up: make them a real mentor in the same Circle and retire the name card.
create or replace function public.sankofa_admin_guest_link(p_id uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.sankofa_guest_mentors;
begin
  if not public.sankofa_is_admin() then raise exception 'Not authorized'; end if;
  select * into g from public.sankofa_guest_mentors where id = p_id;
  if not found then raise exception 'That mentor no longer exists.'; end if;
  perform public.sankofa__add_participant(p_user, 'mentor', auth.uid());
  update public.sankofa_participants set specialty = coalesce(nullif(specialty, ''), g.specialty) where user_id = p_user;
  if g.circle_id is not null and exists (select 1 from public.sankofa_circles c where c.id = g.circle_id and c.status = 'active') then
    perform public.sankofa__move(p_user, g.circle_id, auth.uid(), 'Linked from a guest mentor');
  end if;
  delete from public.sankofa_guest_mentors where id = p_id;
  return public.sankofa_admin_person(p_user);
end;
$$;

-- A Circle that still has guest mentors can't be deleted (archive it, or move them first).
create or replace function public.sankofa_admin_delete_circle(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.sankofa_is_admin() then
    raise exception 'Not authorized';
  end if;
  if exists (select 1 from public.sankofa_circle_members where circle_id = p_id)
     or exists (select 1 from public.sankofa_guest_mentors where circle_id = p_id) then
    raise exception 'Move everyone out of this Circle first (or archive it instead).';
  end if;
  delete from public.sankofa_circles where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- The Circle's own members see the guest mentors (never their email or the committee's notes)
create or replace function public.sankofa_circle_guests()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cid uuid;
begin
  if auth.uid() is null or not (public.sankofa_am_active() or public.sankofa_is_admin()) then
    raise exception 'The Sankofa Hub isn''t available on your account.';
  end if;
  cid := public.sankofa_circle_of(auth.uid());
  if cid is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'title', g.title, 'organisation', g.organisation, 'specialty', g.specialty, 'status', g.status) order by g.created_at)
    from public.sankofa_guest_mentors g where g.circle_id = cid), '[]'::jsonb);
end;
$$;

revoke all on function public.sankofa_admin_guests() from public, anon;
revoke all on function public.sankofa_admin_guest_save(uuid, text, text, text, text, text, text, uuid, text) from public, anon;
revoke all on function public.sankofa_admin_guest_move(uuid, uuid) from public, anon;
revoke all on function public.sankofa_admin_guest_delete(uuid) from public, anon;
revoke all on function public.sankofa_admin_guest_link(uuid, uuid) from public, anon;
revoke all on function public.sankofa_admin_delete_circle(uuid) from public, anon;
revoke all on function public.sankofa_circle_guests() from public, anon;
grant execute on function public.sankofa_admin_guests() to authenticated;
grant execute on function public.sankofa_admin_guest_save(uuid, text, text, text, text, text, text, uuid, text) to authenticated;
grant execute on function public.sankofa_admin_guest_move(uuid, uuid) to authenticated;
grant execute on function public.sankofa_admin_guest_delete(uuid) to authenticated;
grant execute on function public.sankofa_admin_guest_link(uuid, uuid) to authenticated;
grant execute on function public.sankofa_admin_delete_circle(uuid) to authenticated;
grant execute on function public.sankofa_circle_guests() to authenticated;

commit;
