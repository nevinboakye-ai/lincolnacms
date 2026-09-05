-- page_views (migration 040) only started recording the moment that
-- migration and the updated js/main.js went live - there is no way to
-- know exactly how many people visited the site before then, or on
-- which days, since nothing was ever counted. What this adds instead:
-- an optional, manually-set "how many visits happened before tracking
-- started" estimate, folded into the All-time stat tile only (never
-- the dated chart, since we have no idea *when* those visits happened -
-- putting a lump estimate on a specific day's bar would be more
-- misleading than not showing it at all).
--
-- Leave both values at '0' (the default) if you don't have or want an
-- estimate - the All-time tile will just show exactly what's been
-- tracked, same as every other tile.
--
-- To set an estimate: Table Editor -> site_settings -> edit the value
-- for activity_baseline_views / activity_baseline_visitors. No redeploy
-- needed, the dashboard reads it live next time you open the panel.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query,
-- paste, Run. Needs migration 031 (site_settings) and 040 (page_views,
-- president_activity_summary) already applied.

insert into public.site_settings (key, value) values
  ('activity_baseline_views', '0'),
  ('activity_baseline_visitors', '0')
on conflict (key) do nothing;

-- Re-defined to add the baseline on top of the real, tracked all-time
-- totals. Every other number this function returns (today/week/month/
-- year, live_now) is untouched - a manual pre-tracking estimate has no
-- meaningful "today" or "this week" component, so it only ever applies
-- to the one figure it actually describes.
create or replace function public.president_activity_summary()
returns table (
  today_views bigint, today_visitors bigint,
  week_views bigint, week_visitors bigint,
  month_views bigint, month_visitors bigint,
  year_views bigint, year_visitors bigint,
  alltime_views bigint, alltime_visitors bigint,
  live_now bigint,
  baseline_views bigint, baseline_visitors bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  base_views bigint;
  base_visitors bigint;
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;

  select coalesce(nullif(regexp_replace(value, '[^0-9]', '', 'g'), '')::bigint, 0)
    into base_views
    from public.site_settings where key = 'activity_baseline_views';
  select coalesce(nullif(regexp_replace(value, '[^0-9]', '', 'g'), '')::bigint, 0)
    into base_visitors
    from public.site_settings where key = 'activity_baseline_visitors';
  base_views := coalesce(base_views, 0);
  base_visitors := coalesce(base_visitors, 0);

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
    count(*) + base_views,
    count(distinct visitor_id) + base_visitors,
    count(distinct visitor_id) filter (where viewed_at >= now() - interval '5 minutes'),
    base_views,
    base_visitors
  from public.page_views;
end;
$$;
