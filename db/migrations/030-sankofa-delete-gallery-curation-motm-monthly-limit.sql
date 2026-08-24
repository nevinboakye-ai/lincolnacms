-- Three unrelated fixes bundled together, all from the same round of
-- feedback on the president dashboard and public site:
--
-- 1. Sankofa applications (both mentee and mentor) can now be deleted
--    from the dashboard — there was previously no way to clear out an
--    application that had been seen and wasn't being taken forward.
-- 2. The gallery drops its hardcoded photo list entirely. Every photo
--    already in Media/ACMS Gallery/ becomes a real row in
--    gallery_photos (added in 029), toggleable on/off from the
--    dashboard exactly like a freshly uploaded one — "forget the
--    hardcoded images, let me select and unselect every single photo."
-- 3. MoTM nominations open to every LACMS member and Network
--    professional (matching the DB policy from 015 — the dashboard's
--    own client-side gate had wrongly restricted this to committee-only,
--    contradicting motm.html's own "no committee role required" copy),
--    capped at one nomination per person per calendar month.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. Needs 025 (president_get_* / is_president()), 029
-- (sankofa_mentor_applications, gallery_photos) already applied.

-- =======================================================================
-- 1. Delete a Sankofa application (either table) — president-only.
-- =======================================================================

create or replace function public.president_delete_sankofa_application(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  delete from public.sankofa_applications where id = target_id;
end;
$$;

create or replace function public.president_delete_sankofa_mentor_application(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  delete from public.sankofa_mentor_applications where id = target_id;
end;
$$;

-- =======================================================================
-- 2. Gallery — every existing photo becomes a real, toggleable row.
--    is_static_asset marks a row whose storage_path is a plain
--    site-relative path under Media/ (used directly as an <img src>)
--    rather than an object inside the gallery-photos storage bucket —
--    the dashboard and gallery.html both need to know which one so they
--    resolve the right kind of URL, and so Delete never tries to call
--    Storage on a file that was never actually in that bucket.
-- =======================================================================

alter table public.gallery_photos add column if not exists is_static_asset boolean not null default false;
comment on column public.gallery_photos.is_static_asset is 'true = storage_path is a site-relative path to an existing file under Media/ (used directly as an <img src>), not an object in the gallery-photos storage bucket. Delete removes the row only, never the file, for these.';

insert into public.gallery_photos (storage_path, is_static_asset, display_order) values
  ('Media/ACMS Gallery/IMG_0027.JPG', true, 0),
  ('Media/ACMS Gallery/IMG_0028.JPG', true, 1),
  ('Media/ACMS Gallery/IMG_0029.JPG', true, 2),
  ('Media/ACMS Gallery/IMG_1164 2.JPG', true, 3),
  ('Media/ACMS Gallery/IMG_1165.JPG', true, 4),
  ('Media/ACMS Gallery/IMG_1166.JPG', true, 5),
  ('Media/ACMS Gallery/IMG_1167.JPG', true, 6),
  ('Media/ACMS Gallery/IMG_1168.JPG', true, 7),
  ('Media/ACMS Gallery/IMG_1178.JPG', true, 8),
  ('Media/ACMS Gallery/IMG_1179.JPG', true, 9),
  ('Media/ACMS Gallery/IMG_1180.JPG', true, 10),
  ('Media/ACMS Gallery/IMG_1181.JPG', true, 11),
  ('Media/ACMS Gallery/IMG_1185.JPG', true, 12),
  ('Media/ACMS Gallery/IMG_1196.JPG', true, 13),
  ('Media/ACMS Gallery/IMG_1205.JPG', true, 14),
  ('Media/ACMS Gallery/IMG_1206.JPG', true, 15),
  ('Media/ACMS Gallery/IMG_1227.JPG', true, 16),
  ('Media/ACMS Gallery/IMG_1228.JPG', true, 17),
  ('Media/ACMS Gallery/IMG_4053.JPG', true, 18),
  ('Media/ACMS Gallery/IMG_4996.JPG', true, 19),
  ('Media/ACMS Gallery/IMG_5017.JPG', true, 20),
  ('Media/ACMS Gallery/IMG_5019.JPG', true, 21),
  ('Media/ACMS Gallery/IMG_8822.JPEG', true, 22),
  ('Media/ACMS Gallery/Medball-NSG.JPG', true, 23),
  ('Media/ACMS Gallery/356B96A6-9FEE-429D-A4DF-B45A6695DCFC.PNG', true, 24),
  ('Media/ACMS Gallery/hero.jpg', true, 25),
  ('Media/ACMS Gallery/sankofa-mentorship.jpg', true, 26);

-- =======================================================================
-- 3. MoTM nominations — one per person per calendar month.
--    nomination_month (e.g. '2026-08') is stamped by the trigger below
--    at insert time rather than computed from created_at at query time,
--    so the unique constraint can key on it directly without an
--    expression index's timezone-immutability headaches.
-- =======================================================================

alter table public.motm_nominations add column if not exists nomination_month text;

create or replace function public.motm_set_nomination_month()
returns trigger
language plpgsql
as $$
begin
  new.nomination_month := to_char(now(), 'YYYY-MM');
  return new;
end;
$$;

drop trigger if exists motm_nominations_set_month on public.motm_nominations;
create trigger motm_nominations_set_month
  before insert on public.motm_nominations
  for each row
  execute function public.motm_set_nomination_month();

update public.motm_nominations set nomination_month = to_char(created_at, 'YYYY-MM') where nomination_month is null;
alter table public.motm_nominations alter column nomination_month set not null;

alter table public.motm_nominations drop constraint if exists motm_one_nomination_per_month;
alter table public.motm_nominations add constraint motm_one_nomination_per_month unique (nominator_id, nomination_month);
