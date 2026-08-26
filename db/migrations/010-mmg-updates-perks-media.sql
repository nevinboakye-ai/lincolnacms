-- Rounds out the MMG portal: a general update feed for every attendee
-- (separate from the committee-only planning feed), night-exclusive
-- perks/vouchers, and a private media-upload bucket so attendees can
-- share photos/videos for the after-gala gallery and highlight video.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. Requires 009-mmg-portal.sql to already be applied (uses its
-- mmg_has_attendee_access() / mmg_has_committee_access() functions).

-- ---------------------------------------------------------------------
-- General MMG updates — visible to anyone with attendee-or-committee
-- access (unlike mmg_updates, which stays committee-only planning info).
create table public.mmg_attendee_updates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  pinned boolean not null default false,
  is_active boolean not null default true,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.mmg_attendee_updates enable row level security;

create policy "MMG attendees can view active general updates"
  on public.mmg_attendee_updates for select
  to authenticated
  using (is_active = true and public.mmg_has_attendee_access());

-- ---------------------------------------------------------------------
-- Night-exclusive perks/vouchers — same shape as the LACMS `discounts`
-- table, scoped to attendee-or-committee access instead of membership.
create table public.mmg_perks (
  id uuid primary key default gen_random_uuid(),
  partner_name text not null,
  description text not null,
  code text,
  address text,
  link text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.mmg_perks enable row level security;

create policy "MMG attendees can view active night perks"
  on public.mmg_perks for select
  to authenticated
  using (is_active = true and public.mmg_has_attendee_access());

-- ---------------------------------------------------------------------
-- Media uploads — a private bucket for attendee-submitted photos/videos.
-- Nobody can read/list it via the site (no select policy); the
-- committee reviews submissions in the Supabase dashboard, which uses
-- the service role and bypasses storage policies entirely.
insert into storage.buckets (id, name, public)
values ('mmg-media', 'mmg-media', false)
on conflict (id) do nothing;

create policy "MMG attendees can upload their own media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'mmg-media'
    and public.mmg_has_attendee_access()
    and (storage.foldername(name))[1] = auth.uid()::text
  );
