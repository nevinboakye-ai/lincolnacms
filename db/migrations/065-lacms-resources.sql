-- LACMS Resources: a members' library of study resources, one tile per
-- course. Members share files (notes, past papers, slides...) or links
-- (websites, videos, tools) with a description, a source (their own work
-- or someone else's) and an optional preview. Anything from a
-- non-executive member waits in "pending" - invisible to everyone but its
-- author and the executive committee - until an executive approves it.
-- Executives' own submissions are approved straight away.
--
-- Who can use it is the Hub Access rule "resources" (migration 060): to
-- start with, Executive Committee members only; everyone else sees a
-- "Coming soon" card. Open it up later from the dashboard's Hub Access
-- section - no code change needed.
--
-- Moderation = is_dashboard_admin() (the president, or a member whose type
-- is Executive Committee). Enforced in the database: row-level security on
-- the table and on the private "lacms-resources" storage bucket, plus
-- triggers that stop anyone self-approving or impersonating an uploader.
--
-- Files live in a private bucket (25 MB max, documents/images only - no
-- executables or web pages) at <uploader id>/<resource id>/<file name>;
-- the site shows them through short-lived signed links.
--
-- Also adds "resources" as a section of the notification bell (new
-- approved resources count as new content).
--
-- Wrapped in a transaction. Run this once in Supabase: Dashboard -> SQL
-- Editor -> New query, paste, Run. Needs 037, 059, 060 and 061.

begin;

-- ---------------------------------------------------------------------
-- Hub Access rule (executive committee only for now, others see "coming soon").
alter table public.hub_access_rules drop constraint if exists hub_access_rules_feature_check;
alter table public.hub_access_rules add constraint hub_access_rules_feature_check
  check (feature in (
    'perks', 'sankofa', 'network', 'motm_nominate', 'news_feed', 'resources',
    'dash_mmg', 'dash_sankofa', 'dash_motm', 'dash_events', 'dash_gallery'
  ));

insert into public.hub_access_rules (feature, allow_members, allow_professionals, member_types, courses, blocked_display)
values ('resources', true, false, array['executive_committee'], null, 'locked')
on conflict (feature) do nothing;

-- ---------------------------------------------------------------------
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  course text not null check (course in (
    'Medicine', 'Pharmacy', 'Dental Hygiene and Therapy', 'Diagnostic Radiography',
    'Nursing', 'Midwifery', 'Biomedical Science', 'Occupational Therapy', 'General'
  )),
  title text not null check (char_length(btrim(title)) between 3 and 140),
  description text not null check (char_length(btrim(description)) between 10 and 1500),
  resource_type text not null check (resource_type in (
    'notes', 'past_paper', 'slides', 'video', 'website', 'textbook', 'flashcards', 'tool', 'other'
  )),
  source_type text not null check (source_type in ('personal', 'external')),
  source_credit text check (source_credit is null or char_length(source_credit) <= 200),
  year_of_study text check (year_of_study is null or char_length(year_of_study) <= 40),
  topic text check (topic is null or char_length(topic) <= 120),
  kind text not null check (kind in ('file', 'link')),
  url text check (url is null or (url ~* '^https?://' and char_length(url) <= 2000)),
  file_path text,
  file_name text check (file_name is null or char_length(file_name) <= 255),
  file_size bigint check (file_size is null or file_size <= 26214400),
  file_mime text,
  preview_path text,
  uploader_id uuid references auth.users(id) on delete set null,
  uploader_name text not null,
  uploader_detail text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  approved_at timestamptz,
  reject_reason text check (reject_reason is null or char_length(reject_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resources_kind_fields check (
    (kind = 'link' and url is not null and file_path is null)
    or (kind = 'file' and file_path is not null and url is null)
  )
);

create index if not exists resources_course_status_idx on public.resources (course, status, approved_at desc);
create index if not exists resources_uploader_idx on public.resources (uploader_id, created_at desc);

alter table public.resources enable row level security;

drop policy if exists "Read approved, own and (executives) all resources" on public.resources;
create policy "Read approved, own and (executives) all resources"
  on public.resources for select
  to authenticated
  using (
    (status = 'approved' and public.has_hub_access('resources'))
    or uploader_id = auth.uid()
    or public.is_dashboard_admin()
  );

drop policy if exists "Share a resource" on public.resources;
create policy "Share a resource"
  on public.resources for insert
  to authenticated
  with check (
    uploader_id = auth.uid()
    and (public.has_hub_access('resources') or public.is_dashboard_admin())
  );

drop policy if exists "Edit own resources, executives edit any" on public.resources;
create policy "Edit own resources, executives edit any"
  on public.resources for update
  to authenticated
  using (uploader_id = auth.uid() or public.is_dashboard_admin())
  with check (uploader_id = auth.uid() or public.is_dashboard_admin());

drop policy if exists "Delete own resources, executives delete any" on public.resources;
create policy "Delete own resources, executives delete any"
  on public.resources for delete
  to authenticated
  using (uploader_id = auth.uid() or public.is_dashboard_admin());

-- ---------------------------------------------------------------------
-- Stops self-approval and impersonation. The client may ask for anything;
-- what's stored is decided here.
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
      -- An author editing their own resource: identity and review state are
      -- not theirs to change, and any edit sends it back for review.
      new.uploader_id := old.uploader_id;
      new.uploader_name := old.uploader_name;
      new.uploader_detail := old.uploader_detail;
      new.status := 'pending';
      new.reviewed_by := null;
      new.reviewed_at := null;
      new.approved_at := null;
      new.reject_reason := null;
    elsif auth.uid() is not null and new.status is distinct from old.status then
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
      new.approved_at := case when new.status = 'approved' then now() else null end;
      if new.status <> 'rejected' then new.reject_reason := null; end if;
    end if;
  end if;

  -- A file can only point at the uploader's own folder.
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

drop trigger if exists resources_before_write on public.resources;
create trigger resources_before_write
  before insert or update on public.resources
  for each row
  execute function public.resources_before_write();

-- Tile counts per course (approved for everyone with access; the
-- pending count is only non-zero for executives, who can see them).
create or replace function public.get_resource_counts()
returns table (course text, approved_count int, pending_count int)
language sql
stable
security invoker
set search_path = public
as $$
  select r.course,
         (count(*) filter (where r.status = 'approved'))::int,
         (count(*) filter (where r.status = 'pending' and public.is_dashboard_admin()))::int
  from public.resources r
  group by r.course;
$$;

grant execute on function public.get_resource_counts() to authenticated;

-- ---------------------------------------------------------------------
-- Private storage bucket for the files and optional preview images.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lacms-resources', 'lacms-resources', false, 26214400,
  array[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv'
  ]
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Read approved, own and (executives) all resource files" on storage.objects;
create policy "Read approved, own and (executives) all resource files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'lacms-resources'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_dashboard_admin()
      or (
        public.has_hub_access('resources')
        and exists (
          select 1 from public.resources r
          where r.status = 'approved' and (r.file_path = name or r.preview_path = name)
        )
      )
    )
  );

drop policy if exists "Upload resource files into your own folder" on storage.objects;
create policy "Upload resource files into your own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'lacms-resources'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (public.has_hub_access('resources') or public.is_dashboard_admin())
  );

drop policy if exists "Remove own resource files, executives remove any" on storage.objects;
create policy "Remove own resource files, executives remove any"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'lacms-resources'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_dashboard_admin())
  );

-- ---------------------------------------------------------------------
-- Notification bell: "resources" becomes a section.
alter table public.notification_seen drop constraint if exists notification_seen_section_check;
alter table public.notification_seen add constraint notification_seen_section_check
  check (section in ('announcements', 'perks', 'events', 'news', 'motm', 'gallery', 'mmg', 'resources'));

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
      from public.resources r where r.status = 'approved' and r.approved_at is not null
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

create or replace function public.mark_notifications_seen(p_sections text[] default null)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.notification_seen (user_id, section, last_seen_at)
  select auth.uid(), s, now()
  from unnest(
    coalesce(p_sections, array['announcements', 'perks', 'events', 'news', 'motm', 'gallery', 'mmg', 'resources'])
  ) as s
  where s in ('announcements', 'perks', 'events', 'news', 'motm', 'gallery', 'mmg', 'resources')
    and auth.uid() is not null
  on conflict (user_id, section) do update set last_seen_at = now();
$$;

grant execute on function public.mark_notifications_seen(text[]) to authenticated;

commit;
