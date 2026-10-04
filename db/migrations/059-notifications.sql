-- "New since you last looked" notifications for signed-in users.
--
-- How it works: every signed-in user has, per content section, a
-- "last seen" time (notification_seen). The bell in the site header (and
-- the little count pills on nav links) show how many items in each
-- section were published AFTER that time. Visiting a section's page
-- stamps it as seen; "Mark all as read" stamps every section.
--
-- A section the user has never visited counts from the moment their
-- account was created, so a brand-new member sees what's been added
-- since they signed up, and visiting each page clears it.
--
-- Counts come from get_my_notifications(), which runs AS THE CALLING
-- USER (security invoker) so every table's own row-level security still
-- applies - e.g. MMG updates only ever count for people with MMG
-- access, and nobody is told about content they couldn't open.
--
-- Sections and what feeds them:
--   announcements - announcements            (member hub feed)
--   perks         - discounts + member_opportunities (member-perks.html)
--   events        - site_events              (events.html)
--   news          - news_posts               (news.html)
--   motm          - motm_winners             (motm.html)
--   gallery       - gallery_photos           (gallery.html)
--   mmg           - mmg_updates, mmg_attendee_updates, mmg_perks (mmg-hub.html)
-- To add a section later: add it to the CHECK below, add a UNION branch
-- in get_my_notifications(), and map its page in js/notifications.js.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query, paste,
-- Run. Needs migrations 008, 003, 058, 013, 011, 029, 009 and 010.

-- ---------------------------------------------------------------------
create table if not exists public.notification_seen (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  section text not null check (section in ('announcements', 'perks', 'events', 'news', 'motm', 'gallery', 'mmg')),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, section)
);

alter table public.notification_seen enable row level security;

drop policy if exists "Users manage their own notification state" on public.notification_seen;
create policy "Users manage their own notification state"
  on public.notification_seen for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- The caller's own account creation time (auth.users isn't readable by
-- ordinary users, hence security definer) - only ever returns the
-- caller's own timestamp, never anyone else's.
create or replace function public.my_account_created_at()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select u.created_at from auth.users u where u.id = auth.uid();
$$;

revoke all on function public.my_account_created_at() from public;
grant execute on function public.my_account_created_at() to authenticated;

-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- Stamps sections as seen using the SERVER clock (not the browser's, so
-- a wrong device clock can't hide or resurrect notifications). Pass
-- null to mark every section as read. Unknown section names are ignored.
create or replace function public.mark_notifications_seen(p_sections text[] default null)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.notification_seen (user_id, section, last_seen_at)
  select auth.uid(), s, now()
  from unnest(
    coalesce(p_sections, array['announcements', 'perks', 'events', 'news', 'motm', 'gallery', 'mmg'])
  ) as s
  where s in ('announcements', 'perks', 'events', 'news', 'motm', 'gallery', 'mmg')
    and auth.uid() is not null
  on conflict (user_id, section) do update set last_seen_at = now();
$$;

grant execute on function public.mark_notifications_seen(text[]) to authenticated;

-- ---------------------------------------------------------------------
-- The eight events seeded by migration 058 were already on the site
-- before this feature existed - they're not "news". Back-dating them
-- keeps everyone from opening the site to "8 new events" on day one;
-- only events you add from now on will notify.
update public.site_events
set created_at = '2020-01-01'
where slug in (
  'welcome-and-launch', 'games-night-1', 'sankofa-circle-session-1',
  'professional-development-programme', 'games-night-2',
  'world-diabetes-day-charity-tournament', 'midlands-medics-gala',
  'winter-charity-fundraiser'
);
