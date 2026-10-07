-- View-only resources: the person who shares a file can switch downloads off
-- (resources.allow_download). Members can still view it - a PDF or image
-- shows in the preview window - but the Download button is gone and the
-- preview doesn't offer a save option.
--
-- Be clear-eyed about what this is: it is a courtesy and a strong default,
-- not DRM. To show a file in the browser the site has to hand the browser the
-- file, so someone determined enough (screenshots, browser developer tools)
-- can still capture it. For anything genuinely sensitive combine it with a PIN
-- (section 123) and only share it with people you trust.
--
-- Only PDFs and images can be view-only (they preview in the page; Word,
-- PowerPoint, Excel and text files can't be shown in the browser, so for
-- those the option isn't offered). The uploader and executives (who review
-- and moderate) can always download. Links are unaffected. Switching it on or
-- off doesn't send a resource back for review.
--
-- Also: downloads of a view-only file are never counted in Insights (there is
-- no download to count).
--
-- Wrapped in a transaction. Run this once in Supabase: Dashboard -> SQL
-- Editor -> New query, paste, Run. Needs 073 (and 074). The Resources page
-- keeps working if this hasn't been run - it just can't switch downloads off.

begin;

alter table public.resources add column if not exists allow_download boolean not null default true;

-- The table's columns are individually granted since 073 (the link/file
-- columns are hidden), so the new one has to be granted too.
grant select (allow_download) on public.resources to authenticated;

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
      if (to_jsonb(new) - 'is_locked' - 'allow_download' - 'updated_at') = (to_jsonb(old) - 'is_locked' - 'allow_download' - 'updated_at') then
        -- Only the lock / download setting changed: review state stays exactly as it was.
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
  if not found or r.status <> 'approved' or r.uploader_id = me then
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

commit;
