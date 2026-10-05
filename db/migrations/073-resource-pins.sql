-- PIN-protected resources.
--
-- Whoever shares a resource can lock it behind a PIN (4-8 digits). Everyone
-- with access to LACMS Resources still sees the card - title, description,
-- who shared it, likes and comments - but the file or link itself stays
-- locked until they enter the PIN, which they can get by messaging the
-- person who shared it. Meant for more protected material.
--
-- This is enforced in the database, not just hidden in the page:
--   * The columns that hold the link / file path / preview image
--     (url, file_path, preview_path) can no longer be read directly from the
--     resources table by anyone. The page asks get_resource_locations(),
--     which only hands them back for resources you may open: not locked, or
--     you shared it, or you're an executive (who need to review it), or you
--     have already unlocked it.
--   * The private storage bucket's read policy checks the same thing, so a
--     locked file can't be fetched by guessing its path either.
--   * PINs live in resource_pins, which nobody can read directly. Only the
--     person who shared a resource can see or change its PIN
--     (get_resource_pin / set_resource_pin). Changing the PIN signs everyone
--     out of it (they'd need the new one); removing it unlocks it for all.
--   * Trying PINs is rate-limited server-side: 5 wrong guesses on a resource
--     locks that person out of it for 15 minutes; 20 wrong guesses an hour
--     across all resources, or 60 an hour on one resource from everyone,
--     pauses attempts for 10 minutes. A correct PIN is remembered for that
--     person (on every device) until the PIN is changed.
--   * Locking or unlocking a resource doesn't send it back for review.
--
-- Anyone can still read the title and description, so don't put anything
-- secret in those. Executives can open any resource without a PIN (they
-- review and moderate everything).
--
-- Wrapped in a transaction. Run this once in Supabase: Dashboard -> SQL
-- Editor -> New query, paste, Run. Needs 065, 066 and 067. The Resources
-- page keeps working if this hasn't been run yet - it just can't lock.

begin;

alter table public.resources add column if not exists is_locked boolean not null default false;

-- ---------------------------------------------------------------------
create table if not exists public.resource_pins (
  resource_id uuid primary key references public.resources(id) on delete cascade,
  pin text not null check (pin ~ '^[0-9]{4,8}$'),
  updated_at timestamptz not null default now()
);

create table if not exists public.resource_unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_id uuid not null references public.resources(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, resource_id)
);

create table if not exists public.resource_pin_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_id uuid not null references public.resources(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists resource_pin_attempts_user_idx on public.resource_pin_attempts (user_id, resource_id, created_at desc);
create index if not exists resource_pin_attempts_resource_idx on public.resource_pin_attempts (resource_id, created_at desc);

-- No policies at all: nobody reads or writes these directly; only the
-- functions below (which check who's calling) do.
alter table public.resource_pins enable row level security;
alter table public.resource_unlocks enable row level security;
alter table public.resource_pin_attempts enable row level security;
revoke all on public.resource_pins from anon, authenticated;
revoke all on public.resource_unlocks from anon, authenticated;
revoke all on public.resource_pin_attempts from anon, authenticated;

-- ---------------------------------------------------------------------
-- Locking or unlocking on its own doesn't send a resource back for review;
-- any other edit by a non-executive still does (as in 065).
create or replace function public.resources_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  nm text;
  detail text;
  admin boolean := public.is_dashboard_admin();
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.uploader_id := auth.uid();
      select m.full_name, nullif(concat_ws(' · ', m.course, m.year_of_study), '')
        into nm, detail from public.members m where m.id = auth.uid();
      if nm is null then
        select np.full_name, np.title into nm, detail
        from public.network_professionals np where np.user_id = auth.uid();
      end if;
      new.uploader_name := coalesce(nm, 'LACMS member');
      new.uploader_detail := detail;

      if admin then
        new.status := 'approved';
        new.reviewed_by := auth.uid();
        new.reviewed_at := now();
        new.approved_at := now();
      else
        new.status := 'pending';
        new.reviewed_by := null;
        new.reviewed_at := null;
        new.approved_at := null;
      end if;
      new.reject_reason := null;
    end if;
    new.created_at := now();
  else
    if auth.uid() is not null and not admin then
      new.uploader_id := old.uploader_id;
      new.uploader_name := old.uploader_name;
      new.uploader_detail := old.uploader_detail;
      if (to_jsonb(new) - 'is_locked' - 'updated_at') = (to_jsonb(old) - 'is_locked' - 'updated_at') then
        -- Only the lock changed: review state stays exactly as it was.
        new.status := old.status;
        new.reviewed_by := old.reviewed_by;
        new.reviewed_at := old.reviewed_at;
        new.approved_at := old.approved_at;
        new.reject_reason := old.reject_reason;
      else
        -- An author editing their own resource: any edit sends it back for review.
        new.status := 'pending';
        new.reviewed_by := null;
        new.reviewed_at := null;
        new.approved_at := null;
        new.reject_reason := null;
      end if;
    elsif auth.uid() is not null and new.status is distinct from old.status then
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
      new.approved_at := case when new.status = 'approved' then now() else null end;
      if new.status <> 'rejected' then new.reject_reason := null; end if;
    end if;
  end if;

  if new.file_path is not null and new.uploader_id is not null
     and new.file_path not like new.uploader_id::text || '/%' then
    raise exception 'That file is not in your upload folder.';
  end if;
  if new.preview_path is not null and new.uploader_id is not null
     and new.preview_path not like new.uploader_id::text || '/%' then
    raise exception 'That preview image is not in your upload folder.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- May the caller open this resource's file / link right now?
create or replace function public.resource_can_open(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.resources r
    where r.id = p_id
      and public.can_see_resource(r.id)
      and (
        not r.is_locked
        or r.uploader_id = auth.uid()
        or public.is_dashboard_admin()
        or (
          exists (select 1 from public.resource_pins p where p.resource_id = r.id)
          and exists (select 1 from public.resource_unlocks u where u.resource_id = r.id and u.user_id = auth.uid())
        )
      )
  );
$$;

revoke all on function public.resource_can_open(uuid) from public, anon;
grant execute on function public.resource_can_open(uuid) to authenticated;

-- The storage policy's version of the same question, by file path.
create or replace function public.resource_file_readable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.resources r
    where (r.file_path = p_name or r.preview_path = p_name)
      and r.status = 'approved'
      and public.has_hub_access('resources')
      and public.resource_can_open(r.id)
  );
$$;

revoke all on function public.resource_file_readable(text) from public, anon;
grant execute on function public.resource_file_readable(text) to authenticated;

drop policy if exists "Read approved, own and (executives) all resource files" on storage.objects;
create policy "Read approved, own and (executives) all resource files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'lacms-resources'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_dashboard_admin()
      or public.resource_file_readable(name)
    )
  );

-- ---------------------------------------------------------------------
-- Where a batch of resources live. Locked ones you can't open come back
-- with is_locked = true and nothing else.
create or replace function public.get_resource_locations(p_ids uuid[])
returns table (resource_id uuid, is_locked boolean, can_open boolean, url text, file_path text, preview_path text)
language sql
stable
security definer
set search_path = public
as $$
  select r.id,
         r.is_locked,
         o.ok,
         case when o.ok then r.url end,
         case when o.ok then r.file_path end,
         case when o.ok then r.preview_path end
  from unnest(p_ids) as t(id)
  join public.resources r on r.id = t.id
  cross join lateral (select public.resource_can_open(r.id) as ok) o
  where public.can_see_resource(r.id);
$$;

revoke all on function public.get_resource_locations(uuid[]) from public, anon;
grant execute on function public.get_resource_locations(uuid[]) to authenticated;

-- The link/file/preview columns are no longer readable straight from the
-- table (everything else is, as before).
revoke select on public.resources from anon, authenticated;
grant select (
  id, title, description, resource_type, source_type, source_credit, topic, kind,
  file_name, file_size, file_mime, uploader_id, uploader_name, uploader_detail,
  status, reviewed_by, reviewed_at, approved_at, reject_reason, created_at, updated_at,
  courses, years, is_locked
) on public.resources to authenticated;

-- ---------------------------------------------------------------------
-- Enter a PIN. Returns whether it unlocked, how many tries are left, and
-- (when locked out) how many seconds until the next try.
create or replace function public.resource_unlock(p_id uuid, p_pin text)
returns table (unlocked boolean, attempts_left integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  r public.resources;
  real_pin text;
  recent integer;
  newest timestamptz;
  hourly integer;
  on_resource integer;
begin
  if me is null then
    raise exception 'Please sign in.';
  end if;
  if not public.can_see_resource(p_id) then
    raise exception 'That resource isn''t available.';
  end if;
  select * into r from public.resources where id = p_id;

  -- Nothing to unlock, or it's yours / you're an executive.
  if not r.is_locked or r.uploader_id = me or public.is_dashboard_admin() then
    return query select true, 5, 0;
    return;
  end if;
  if public.resource_can_open(p_id) then
    return query select true, 5, 0;
    return;
  end if;

  select p.pin into real_pin from public.resource_pins p where p.resource_id = p_id;
  if real_pin is null then
    raise exception 'The person who shared this hasn''t set a PIN yet - message them to ask.';
  end if;

  select count(*), max(a.created_at) into recent, newest
  from public.resource_pin_attempts a
  where a.user_id = me and a.resource_id = p_id and a.created_at > now() - interval '15 minutes';
  if recent >= 5 then
    return query select false, 0, greatest(1, ceil(extract(epoch from (newest + interval '15 minutes' - now())))::integer);
    return;
  end if;

  select count(*) into hourly from public.resource_pin_attempts a
  where a.user_id = me and a.created_at > now() - interval '1 hour';
  select count(*) into on_resource from public.resource_pin_attempts a
  where a.resource_id = p_id and a.created_at > now() - interval '1 hour';
  if hourly >= 20 or on_resource >= 60 then
    return query select false, 0, 600;
    return;
  end if;

  if regexp_replace(coalesce(p_pin, ''), '\s', '', 'g') = real_pin then
    insert into public.resource_unlocks (user_id, resource_id) values (me, p_id)
    on conflict (user_id, resource_id) do update set unlocked_at = now();
    delete from public.resource_pin_attempts where user_id = me and resource_id = p_id;
    return query select true, 5, 0;
    return;
  end if;

  insert into public.resource_pin_attempts (user_id, resource_id) values (me, p_id);
  return query select false, greatest(0, 5 - (recent + 1)), case when recent + 1 >= 5 then 900 else 0 end;
end;
$$;

-- ---------------------------------------------------------------------
-- The person who shared a resource sets, changes or removes its PIN.
-- p_pin = null (or empty) removes it and unlocks the resource for everyone.
-- Executives may remove a PIN (moderation) but never set or see one.
create or replace function public.set_resource_pin(p_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  owner_id uuid;
  clean text := regexp_replace(coalesce(p_pin, ''), '\s', '', 'g');
begin
  if me is null then
    raise exception 'Please sign in.';
  end if;
  select r.uploader_id into owner_id from public.resources r where r.id = p_id;
  if not found then
    raise exception 'That resource isn''t available.';
  end if;

  if clean = '' then
    if owner_id is distinct from me and not public.is_dashboard_admin() then
      raise exception 'Only the person who shared it can change its PIN.';
    end if;
    delete from public.resource_pins where resource_id = p_id;
    delete from public.resource_unlocks where resource_id = p_id;
    delete from public.resource_pin_attempts where resource_id = p_id;
    update public.resources set is_locked = false where id = p_id;
    return;
  end if;

  if owner_id is distinct from me then
    raise exception 'Only the person who shared it can set its PIN.';
  end if;
  if clean !~ '^[0-9]{4,8}$' then
    raise exception 'A PIN is 4 to 8 digits.';
  end if;

  insert into public.resource_pins (resource_id, pin) values (p_id, clean)
  on conflict (resource_id) do update set pin = excluded.pin, updated_at = now();
  -- A new PIN means everyone who had the old one needs the new one.
  delete from public.resource_unlocks where resource_id = p_id;
  delete from public.resource_pin_attempts where resource_id = p_id;
  update public.resources set is_locked = true where id = p_id;
end;
$$;

create or replace function public.get_resource_pin(p_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.pin
  from public.resource_pins p
  join public.resources r on r.id = p.resource_id
  where p.resource_id = p_id and r.uploader_id = auth.uid();
$$;

revoke all on function public.resource_unlock(uuid, text) from public, anon;
revoke all on function public.set_resource_pin(uuid, text) from public, anon;
revoke all on function public.get_resource_pin(uuid) from public, anon;
grant execute on function public.resource_unlock(uuid, text) to authenticated;
grant execute on function public.set_resource_pin(uuid, text) to authenticated;
grant execute on function public.get_resource_pin(uuid) to authenticated;

commit;
