-- 123: LACMS Resources - make a resource public or private
--
-- Each resource now has a public / private switch:
--   * PUBLIC  (the default)  - in the library for everyone who has access to Resources, as before.
--   * PRIVATE (is_hidden)    - taken out of the library. Only the person who shared it and the executive
--                              committee can see it, find it (My submissions / the committee's "Private" list) and
--                              open its file or link. Nothing is deleted: its likes, comments and PIN are kept, and
--                              making it public again puts it straight back, without another review.
--
-- Who can switch it: the person who shared it, and the executive committee. If the COMMITTEE makes a resource
-- private, only the committee can make it public again (the author can't undo that). The database records who made it
-- private and when, and enforces all of this (row-level security, the file-storage rule, counts, the notification bell
-- and the comment / like / view rules), so a private resource can't be reached from the browser.
--
-- Needs 065, 066, 073, 074 and 076. Safe to run more than once.

begin;

alter table public.resources add column if not exists is_hidden boolean not null default false;
alter table public.resources add column if not exists hidden_by uuid references auth.users (id) on delete set null;
alter table public.resources add column if not exists hidden_at timestamptz;
create index if not exists resources_hidden_idx on public.resources (hidden_at desc) where is_hidden;

-- Columns are granted one by one since 073.
grant select (is_hidden, hidden_by, hidden_at) on public.resources to authenticated;

-- Who can see the row: the library only shows PUBLIC approved resources; authors and the committee still see theirs.
drop policy if exists "Read approved, own and (executives) all resources" on public.resources;
create policy "Read approved, own and (executives) all resources"
  on public.resources for select
  to authenticated
  using (
    (status = 'approved' and not is_hidden and public.has_hub_access('resources'))
    or uploader_id = auth.uid()
    or public.is_dashboard_admin()
  );

create or replace function public.can_see_resource(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.resources r
    where r.id = p_id
      and (
        (r.status = 'approved' and not r.is_hidden and public.has_hub_access('resources'))
        or r.uploader_id = auth.uid()
        or public.is_dashboard_admin()
      )
  );
$$;

-- No new likes or comments on a private resource.
create or replace function public.can_interact_resource(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.resources r
    where r.id = p_id
      and r.status = 'approved'
      and not r.is_hidden
      and (public.has_hub_access('resources') or public.is_dashboard_admin())
  );
$$;

-- Files and previews: a private resource's file is no longer readable by other members.
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
      and not r.is_hidden
      and public.has_hub_access('resources')
      and public.resource_can_open(r.id)
  );
$$;

-- Tile counts: only public resources count (the committee's "waiting for review" count is unchanged).
create or replace function public.get_resource_counts()
returns table (course text, approved_count int, pending_count int)
language sql
stable
security invoker
set search_path = public
as $$
  select c.course,
         (count(*) filter (where r.status = 'approved' and not r.is_hidden))::int,
         (count(*) filter (where r.status = 'pending' and public.is_dashboard_admin()))::int
  from public.resources r
  cross join lateral unnest(r.courses) as c(course)
  group by c.course
  union all
  select '__all',
         (count(*) filter (where r.status = 'approved' and not r.is_hidden))::int,
         (count(*) filter (where r.status = 'pending' and public.is_dashboard_admin()))::int
  from public.resources r;
$$;
grant execute on function public.get_resource_counts() to authenticated;

-- A private resource is not "new content" for the notification bell.
create or replace function public.get_my_notifications()
returns table (section text, new_count int, latest_title text, latest_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  with items as (
    select 'announcements'::text as section, a.title as title, a.published_at as at
      from public.announcements a where a.is_active and a.published_at <= now()
    union all
    select 'perks', d.partner_name, d.created_at
      from public.discounts d where d.is_active
    union all
    select 'perks', o.title, o.created_at
      from public.member_opportunities o where o.is_active
    union all
    select 'events', e.name, e.created_at
      from public.site_events e where e.is_active
    union all
    select 'news', n.title, n.published_at
      from public.news_posts n where n.is_active and n.published_at <= now()
    union all
    select 'motm', coalesce(m.full_name, m.month_label), m.created_at
      from public.motm_winners m where m.is_active
    union all
    select 'gallery', coalesce(g.caption, 'New photo'), g.created_at
      from public.gallery_photos g where g.is_active
    union all
    select 'mmg', u.title, u.published_at
      from public.mmg_updates u where u.is_active and u.published_at <= now()
    union all
    select 'mmg', u.title, u.published_at
      from public.mmg_attendee_updates u where u.is_active and u.published_at <= now()
    union all
    select 'mmg', p.partner_name, p.created_at
      from public.mmg_perks p where p.is_active
    union all
    select 'resources', r.title, r.approved_at
      from public.resources r where r.status = 'approved' and not r.is_hidden and r.approved_at is not null
  )
  select i.section,
         count(*)::int,
         (array_agg(i.title order by i.at desc))[1],
         max(i.at)
  from items i
  left join public.notification_seen s
    on s.user_id = auth.uid() and s.section = i.section
  where i.at > coalesce(s.last_seen_at, public.my_account_created_at())
  group by i.section;
$$;
grant execute on function public.get_my_notifications() to authenticated;

-- Views / downloads of a private resource aren't counted.
create or replace function public.record_resource_event(p_id uuid, p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  r public.resources;
begin
  if me is null or p_event not in ('view', 'download', 'click') then
    return;
  end if;
  select * into r from public.resources x where x.id = p_id;
  if not found or r.status <> 'approved' or r.is_hidden or r.uploader_id = me then
    return;
  end if;
  if not public.can_see_resource(p_id) then
    return;
  end if;

  if p_event = 'download' and (r.kind <> 'file' or not r.allow_download or not public.resource_can_open(p_id)) then
    return;
  end if;
  if p_event = 'click' and (r.kind <> 'link' or not public.resource_can_open(p_id)) then
    return;
  end if;

  if exists (
    select 1 from public.resource_events e
    where e.resource_id = p_id and e.user_id = me and e.event = p_event
      and e.created_at > now() - case when p_event = 'view' then interval '30 minutes' else interval '10 seconds' end
  ) then
    return;
  end if;

  insert into public.resource_events (resource_id, user_id, event) values (p_id, me, p_event);
end;
$$;
revoke all on function public.record_resource_event(uuid, text) from public, anon;
grant execute on function public.record_resource_event(uuid, text) to authenticated;

-- Who hid it and when is set by this trigger, and the "committee made it private" rule lives here too.
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
      if (to_jsonb(new) - 'is_locked' - 'allow_download' - 'is_hidden' - 'hidden_by' - 'hidden_at' - 'updated_at') = (to_jsonb(old) - 'is_locked' - 'allow_download' - 'is_hidden' - 'hidden_by' - 'hidden_at' - 'updated_at') then
        -- Only the lock / download / public-private setting changed: review state stays exactly as it was.
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

  -- Public / private. Who hid it and when is recorded here, never taken from the browser.
  if tg_op = 'INSERT' then
    if new.is_hidden then
      new.hidden_by := auth.uid();
      new.hidden_at := now();
    else
      new.hidden_by := null;
      new.hidden_at := null;
    end if;
  elsif new.is_hidden is distinct from old.is_hidden then
    if auth.uid() is not null and not admin and old.is_hidden and old.hidden_by is distinct from old.uploader_id then
      raise exception 'The committee made this private, so only the committee can make it public again.';
    end if;
    if new.is_hidden then
      new.hidden_by := auth.uid();
      new.hidden_at := now();
    else
      new.hidden_by := null;
      new.hidden_at := null;
    end if;
  else
    new.hidden_by := old.hidden_by;
    new.hidden_at := old.hidden_at;
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

commit;
