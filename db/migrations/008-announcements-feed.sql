-- Members-only news/announcements feed shown on the members hub. The
-- committee posts via Table Editor; every signed-in member can read active
-- posts, newest (and pinned) first.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste, Run.

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  category text not null default 'announcement' check (category in ('announcement', 'news', 'update', 'urgent')),
  pinned boolean not null default false,
  is_active boolean not null default true,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.announcements enable row level security;

create policy "Signed-in members can view active announcements"
  on public.announcements for select
  to authenticated
  using (is_active = true);

comment on column public.announcements.category is 'announcement (gold), news (purple), update (green), or urgent (red) — controls the coloured tag on the feed.';
comment on column public.announcements.pinned is 'Pinned posts always show at the top of the feed, above non-pinned posts, with a highlighted background.';
comment on column public.announcements.published_at is 'Used for sorting and the displayed date — defaults to now(), but can be backdated or scheduled.';
