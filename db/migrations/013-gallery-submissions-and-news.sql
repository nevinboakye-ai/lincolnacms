-- Two features:
--  1. Gallery submissions — LACMS members can upload photos/videos for the
--     committee to review before adding them to the public gallery.
--  2. LACMS News — a data-driven news/updates feed (like motm_winners and
--     the announcements feeds), with member-only likes and comments.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. See README-members-setup.md for the full walkthrough.

-- ---------------------------------------------------------------------
-- Shared helper — used by every "LACMS members only" RLS policy below,
-- so the logic lives in one place instead of being repeated per policy.
create or replace function public.is_lacms_member()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.members m where m.id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- Gallery submissions — a private bucket, same pattern as mmg-media:
-- members upload into their own folder, nobody can read/list via the
-- site (no select policy), the committee reviews from the Supabase
-- dashboard (service role, bypasses storage policies) and adds
-- approved photos/videos to Media/ACMS Gallery/ + the gallery.html
-- FILES list by hand.
insert into storage.buckets (id, name, public)
values ('gallery-submissions', 'gallery-submissions', false)
on conflict (id) do nothing;

create policy "LACMS members can upload gallery submissions"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'gallery-submissions'
    and public.is_lacms_member()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------
-- News posts — public content (anyone can read), committee-managed via
-- Table Editor. like_count/comment_count are denormalised counters kept
-- in sync by triggers below, so the public post list can show live
-- engagement numbers without exposing who liked/commented what.
create table public.news_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  image_url text,
  pinned boolean not null default false,
  is_active boolean not null default true,
  like_count int not null default 0,
  comment_count int not null default 0,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.news_posts enable row level security;

create policy "Anyone can view active news posts"
  on public.news_posts for select
  to anon, authenticated
  using (is_active = true);

comment on column public.news_posts.image_url is 'Optional — a public image URL shown at the top of the post.';
comment on column public.news_posts.like_count is 'Kept in sync automatically by a trigger on news_likes — do not edit by hand.';
comment on column public.news_posts.comment_count is 'Kept in sync automatically by a trigger on news_comments — do not edit by hand.';

-- ---------------------------------------------------------------------
-- Likes — LACMS members only, one like per member per post. Individual
-- rows stay private (a member can only see their own), but the count
-- on news_posts is public.
create table public.news_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.news_posts(id) on delete cascade,
  member_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, member_id)
);

alter table public.news_likes enable row level security;

create policy "Members can view their own likes"
  on public.news_likes for select
  to authenticated
  using (member_id = auth.uid());

create policy "Members can like a post"
  on public.news_likes for insert
  to authenticated
  with check (member_id = auth.uid() and public.is_lacms_member());

create policy "Members can remove their own like"
  on public.news_likes for delete
  to authenticated
  using (member_id = auth.uid());

create or replace function public.news_update_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.news_posts set like_count = like_count + 1 where id = new.post_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.news_posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger news_likes_count_trigger
after insert or delete on public.news_likes
for each row execute function public.news_update_like_count();

-- ---------------------------------------------------------------------
-- Comments — LACMS members only, both to post and to read. author_name
-- is captured at post time (from the commenter's own profile, which
-- they can always read) rather than joined at read time, since the
-- members table's RLS only lets someone read their own row — there's
-- no way to fetch another member's name from the client otherwise.
create table public.news_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.news_posts(id) on delete cascade,
  member_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.news_comments enable row level security;

create policy "Members can view comments"
  on public.news_comments for select
  to authenticated
  using (public.is_lacms_member());

create policy "Members can post a comment"
  on public.news_comments for insert
  to authenticated
  with check (member_id = auth.uid() and public.is_lacms_member());

create policy "Members can delete their own comment"
  on public.news_comments for delete
  to authenticated
  using (member_id = auth.uid());

create or replace function public.news_update_comment_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.news_posts set comment_count = comment_count + 1 where id = new.post_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.news_posts set comment_count = greatest(comment_count - 1, 0) where id = old.post_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger news_comments_count_trigger
after insert or delete on public.news_comments
for each row execute function public.news_update_comment_count();

-- ---------------------------------------------------------------------
-- Placeholder posts so the feed isn't empty on first load — edit or
-- delete these from Table Editor whenever you're ready to replace them.
insert into public.news_posts (title, body, pinned, published_at) values
('Welcome to LACMS News', 'This is where we''ll share updates, announcements and stories throughout the year. Committee members can edit this feed directly from Table Editor - see README-members-setup.md for the full guide. Members can like and comment on any post once signed in.', true, now()),
('New committee elected for 2026/27', 'Congratulations to our new committee - we''re excited for the year ahead. Full introductions are on the About page.', false, now() - interval '2 days'),
('LACMS officially launches 30 September', 'Mark your calendars - our official launch event kicks off the year. Head to the Events page for the full calendar.', false, now() - interval '4 days');
