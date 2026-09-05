-- A new, president-only "Website Activity" dashboard card: real page-view
-- traffic across the whole public site (every page, signed in or not),
-- shown as a range-switchable chart (Today by hour, then 7/30/90 days,
-- then 1 year or all-time by week/month), five headline stat tiles, a
-- live "on the site right now" count, and a top-pages leaderboard.
--
-- This is a different thing from the existing "User Activity" card,
-- which is about signed-in *accounts* (member_presence + last_sign_in_at).
-- This one is about the *site* - anonymous, every visitor, every page,
-- nothing tied to who anyone is.
--
-- Privacy design: page_views.visitor_id is a random id generated
-- client-side (js/main.js) and kept in localStorage - never an account
-- id, IP address, or anything else identifying. There is no SELECT
-- policy on this table at all, for anyone - the only way to read it back
-- is through the is_president()-gated RPCs below, same trust boundary as
-- the existing User Activity / Create Account / Manage Accounts cards.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query,
-- paste, Run. Needs migration 025 already applied (is_president()).

-- =======================================================================
-- 1. The table.
-- =======================================================================

create table if not exists public.page_views (
  id bigint generated always as identity primary key,
  path text not null,
  visitor_id text not null,
  device text,
  viewed_at timestamptz not null default now()
);

comment on table public.page_views is 'One row per page load, fully anonymous - visitor_id is a random id generated client-side and stored in localStorage, never tied to any account or personal data. Powers the president-only Website Activity dashboard card; there is no public SELECT policy, only is_president()-gated RPCs below.';
comment on column public.page_views.path is 'The page filename, e.g. "index.html" or "events.html" - see js/main.js for how it is captured.';
comment on column public.page_views.visitor_id is 'Random per-browser id from localStorage (js/main.js) - lets the dashboard count unique visitors without anything personally identifying.';
comment on column public.page_views.device is '"mobile" or "desktop", inferred client-side from viewport width at load time. Nullable, e.g. if the check failed for some reason.';

create index if not exists page_views_viewed_at_idx on public.page_views (viewed_at);
create index if not exists page_views_path_idx on public.page_views (path);
create index if not exists page_views_visitor_id_idx on public.page_views (visitor_id);

alter table public.page_views enable row level security;

drop policy if exists "Anyone can record a page view" on public.page_views;
create policy "Anyone can record a page view"
  on public.page_views for insert
  to anon, authenticated
  with check (
    length(path) between 1 and 200
    and length(visitor_id) between 1 and 100
    and (device is null or device in ('mobile', 'desktop'))
  );

-- =======================================================================
-- 2. RPCs - all is_president()-only, same boundary as User Activity.
-- =======================================================================

-- Five headline numbers plus a live count, in one round trip.
create or replace function public.president_activity_summary()
returns table (
  today_views bigint, today_visitors bigint,
  week_views bigint, week_visitors bigint,
  month_views bigint, month_visitors bigint,
  year_views bigint, year_visitors bigint,
  alltime_views bigint, alltime_visitors bigint,
  live_now bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;

  return query
  select
    count(*) filter (where viewed_at >= date_trunc('day', now())),
    count(distinct visitor_id) filter (where viewed_at >= date_trunc('day', now())),
    count(*) filter (where viewed_at >= now() - interval '7 days'),
    count(distinct visitor_id) filter (where viewed_at >= now() - interval '7 days'),
    count(*) filter (where viewed_at >= now() - interval '30 days'),
    count(distinct visitor_id) filter (where viewed_at >= now() - interval '30 days'),
    count(*) filter (where viewed_at >= now() - interval '365 days'),
    count(distinct visitor_id) filter (where viewed_at >= now() - interval '365 days'),
    count(*),
    count(distinct visitor_id),
    count(distinct visitor_id) filter (where viewed_at >= now() - interval '5 minutes')
  from public.page_views;
end;
$$;

-- The chart data. One function handles every range the dashboard offers
-- ('today', '7d', '30d', '90d', '1y', 'all') by picking the bucket size
-- that actually reads well at that span - hourly for a single day, daily
-- out to 30 days, weekly for 90 days, monthly for a year or more - and
-- zero-fills every bucket via generate_series so a quiet hour or day
-- still draws as a real (empty) bar instead of a gap in the x-axis.
create or replace function public.president_activity_series(range_key text)
returns table (bucket_start timestamptz, views bigint, visitors bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  trunc_unit text;
  num_buckets int;
  range_from timestamptz;
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;

  if range_key = 'today' then
    trunc_unit := 'hour'; num_buckets := 24; range_from := date_trunc('day', now());
  elsif range_key = '7d' then
    trunc_unit := 'day'; num_buckets := 7; range_from := date_trunc('day', now()) - interval '6 days';
  elsif range_key = '30d' then
    trunc_unit := 'day'; num_buckets := 30; range_from := date_trunc('day', now()) - interval '29 days';
  elsif range_key = '90d' then
    trunc_unit := 'week'; num_buckets := 13; range_from := date_trunc('week', now()) - interval '12 weeks';
  elsif range_key = '1y' then
    trunc_unit := 'month'; num_buckets := 12; range_from := date_trunc('month', now()) - interval '11 months';
  elsif range_key = 'all' then
    trunc_unit := 'month';
    select date_trunc('month', min(viewed_at)) into range_from from public.page_views;
    if range_from is null then range_from := date_trunc('month', now()); end if;
    num_buckets := (extract(year from age(date_trunc('month', now()), range_from)) * 12
                     + extract(month from age(date_trunc('month', now()), range_from)))::int + 1;
    if num_buckets < 1 then num_buckets := 1; end if;
    -- Sane cap so a very old dataset can't ask the chart to draw an
    -- unbounded number of bars - keeps the most recent 5 years, not the
    -- oldest, if this site is ever somehow still running that long.
    if num_buckets > 60 then
      num_buckets := 60;
      range_from := date_trunc('month', now()) - interval '59 months';
    end if;
  else
    raise exception 'Unknown range_key: %', range_key;
  end if;

  return query
  with buckets as (
    select generate_series(
      range_from,
      range_from + (num_buckets - 1) * (('1 ' || trunc_unit)::interval),
      ('1 ' || trunc_unit)::interval
    ) as bucket_start
  ),
  agg as (
    select date_trunc(trunc_unit, pv.viewed_at) as bucket_start,
           count(*) as views,
           count(distinct pv.visitor_id) as visitors
    from public.page_views pv
    where pv.viewed_at >= range_from
    group by 1
  )
  select b.bucket_start, coalesce(a.views, 0), coalesce(a.visitors, 0)
  from buckets b
  left join agg a using (bucket_start)
  order by b.bucket_start;
end;
$$;

-- Top pages within the same range vocabulary as the chart above.
create or replace function public.president_activity_top_pages(range_key text, limit_n int default 8)
returns table (path text, views bigint, visitors bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  range_from timestamptz;
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;

  if range_key = 'today' then
    range_from := date_trunc('day', now());
  elsif range_key = '7d' then
    range_from := date_trunc('day', now()) - interval '6 days';
  elsif range_key = '30d' then
    range_from := date_trunc('day', now()) - interval '29 days';
  elsif range_key = '90d' then
    range_from := date_trunc('week', now()) - interval '12 weeks';
  elsif range_key = '1y' then
    range_from := date_trunc('month', now()) - interval '11 months';
  elsif range_key = 'all' then
    range_from := '-infinity'::timestamptz;
  else
    raise exception 'Unknown range_key: %', range_key;
  end if;

  return query
  select pv.path, count(*) as views, count(distinct pv.visitor_id) as visitors
  from public.page_views pv
  where pv.viewed_at >= range_from
  group by pv.path
  order by views desc, pv.path asc
  limit limit_n;
end;
$$;
