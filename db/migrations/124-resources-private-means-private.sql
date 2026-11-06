-- 124: LACMS Resources - private means private (not even the committee can see it)
--
-- Replaces the rule from 123. A PRIVATE resource is now visible to the person who shared it, and to NO ONE else -
-- the executive committee included. It isn't in the library, the review queue or any list, its file and preview
-- can't be opened by anyone else, and the committee can't edit or delete it either (they can't see it to do so).
--
--   * Only the person who shared a resource can make it private or public (the committee can no longer do it
--     for someone else, so the "committee made it private" rule from 123 is gone).
--   * Making it public again puts it back in the library without another review (nothing about its approval
--     changes). Any edit still sends it back for review first, private or not, so a resource can't be changed
--     in secret and then slipped back into the library.
--   * Anything the committee had made private under 123 stays private, and now belongs to its author to manage.
--
-- Needs 123. Safe to run more than once.

begin;

-- Resources that someone other than the author made private (only possible under 123): the author now owns that choice.
-- (The write trigger is paused for this one correction, because it otherwise keeps hidden_by as it was.)
alter table public.resources disable trigger resources_before_write;
update public.resources set hidden_by = uploader_id where is_hidden and uploader_id is not null and hidden_by is distinct from uploader_id;
alter table public.resources enable trigger resources_before_write;

-- Who can see the row: the library shows public approved resources; the author sees their own; the committee
-- sees everything EXCEPT private resources.
drop policy if exists "Read approved, own and (executives) all resources" on public.resources;
create policy "Read approved, own and (executives) all resources"
  on public.resources for select
  to authenticated
  using (
    (status = 'approved' and not is_hidden and public.has_hub_access('resources'))
    or uploader_id = auth.uid()
    or (public.is_dashboard_admin() and not is_hidden)
  );

drop policy if exists "Edit own resources, executives edit any" on public.resources;
create policy "Edit own resources, executives edit any"
  on public.resources for update
  to authenticated
  using (uploader_id = auth.uid() or (public.is_dashboard_admin() and not is_hidden))
  with check (uploader_id = auth.uid() or (public.is_dashboard_admin() and not is_hidden));

drop policy if exists "Delete own resources, executives delete any" on public.resources;
create policy "Delete own resources, executives delete any"
  on public.resources for delete
  to authenticated
  using (uploader_id = auth.uid() or (public.is_dashboard_admin() and not is_hidden));

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
        or (public.is_dashboard_admin() and not r.is_hidden)
      )
  );
$$;

-- Files: the committee could read every file in the bucket; not any more for a private resource's file or preview.
create or replace function public.resource_file_is_private(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.resources r
    where (r.file_path = p_name or r.preview_path = p_name) and r.is_hidden
  );
$$;
revoke all on function public.resource_file_is_private(text) from public, anon;
grant execute on function public.resource_file_is_private(text) to authenticated;

drop policy if exists "Read approved, own and (executives) all resource files" on storage.objects;
create policy "Read approved, own and (executives) all resource files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'lacms-resources'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (public.is_dashboard_admin() and not public.resource_file_is_private(name))
      or public.resource_file_readable(name)
    )
  );

-- Only the author can switch it; who/when is recorded by the trigger.
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
    if auth.uid() is not null and auth.uid() is distinct from old.uploader_id then
      raise exception 'Only the person who shared a resource can make it private or public.';
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
