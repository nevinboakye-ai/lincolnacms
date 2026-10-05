-- Insights for people who share resources: how many times each one has been
-- viewed, downloaded or clicked through, who liked it, who unlocked it
-- (for PIN-protected ones), and how that's changed over time.
--
-- What's recorded (resource_events): a "view" when someone opens a
-- resource's preview, a "download" when they download a file, and a "click"
-- when they open a link. One row per event, with who did it. It's written
-- only by record_resource_event(), which:
--   * ignores the uploader's own activity (your own views don't count),
--   * only counts approved resources the person can actually see, and only
--     downloads / clicks they're really allowed to make (a locked resource
--     can't be "downloaded" without its PIN),
--   * de-duplicates: one view per person per resource per 30 minutes, and
--     downloads / clicks at most once every 10 seconds, so refreshing or
--     double-clicking can't inflate the numbers.
--
-- Who sees what: ONLY the person who shared a resource can read its
-- insights (get_my_resource_insights, get_resource_insight_detail - both
-- check). They see NAMES for people who liked it and, if it's PIN
-- protected, who unlocked it - those are things people did to their
-- resource on purpose. Views, downloads and clicks are counts only, with
-- an anonymous "audience by course" breakdown and an activity timeline that
-- doesn't name anyone for those. Sixth-form students are never named to
-- anyone but the Executive Committee (migration 064) - they appear as
-- "Sixth form student". Nobody else, executives included, can read another
-- member's insights, and the event table has no read policy at all.
--
-- Note for members: likes used to be anonymous (just a count). From now on
-- the person who shared a resource can see who liked it; the like button's
-- tooltip says so.
--
-- Wrapped in a transaction. Run this once in Supabase: Dashboard -> SQL
-- Editor -> New query, paste, Run. Needs 064, 065, 066 and 073. The
-- Resources page works without it - it just doesn't show insights.

begin;

create table if not exists public.resource_events (
  id bigint generated always as identity primary key,
  resource_id uuid not null references public.resources(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  event text not null check (event in ('view', 'download', 'click')),
  created_at timestamptz not null default now()
);
create index if not exists resource_events_resource_idx on public.resource_events (resource_id, event, created_at desc);
create index if not exists resource_events_user_idx on public.resource_events (user_id, resource_id, event, created_at desc);

alter table public.resource_events enable row level security;
revoke all on public.resource_events from anon, authenticated;

-- ---------------------------------------------------------------------
-- Record one event (called by the page, fire-and-forget).
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

  if p_event = 'download' and (r.kind <> 'file' or not public.resource_can_open(p_id)) then
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

-- ---------------------------------------------------------------------
-- A person's name + detail line as the uploader may see it: sixth-form
-- students stay anonymous unless the uploader is an executive.
create or replace function public.resource_person(p_user uuid, p_reveal_sixth boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when m.id is not null and public.is_sixth_form_profile(m.course, m.year_of_study) and not p_reveal_sixth
      then jsonb_build_object('name', 'Sixth form student', 'detail', null)
    when m.id is not null
      then jsonb_build_object('name', m.full_name, 'detail', nullif(concat_ws(' · ', m.course, m.year_of_study), ''))
    when np.id is not null
      then jsonb_build_object('name', np.full_name, 'detail', nullif(concat_ws(' · ', np.title, np.organisation), ''))
    else jsonb_build_object('name', 'LACMS member', 'detail', null)
  end
  from (select 1) one
  left join public.members m on m.id = p_user
  left join lateral (
    select p.* from public.network_professionals p where p.user_id = p_user order by p.created_at limit 1
  ) np on true;
$$;

revoke all on function public.resource_person(uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- One row of headline numbers per resource the caller shared.
create or replace function public.get_my_resource_insights()
returns table (
  resource_id uuid, title text, status text, is_locked boolean, kind text, created_at timestamptz,
  views integer, unique_viewers integer, downloads integer, clicks integer,
  unlocks integer, likes integer, comments integer, last_activity timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.title, r.status, r.is_locked, r.kind, r.created_at,
         (select count(*) from public.resource_events e where e.resource_id = r.id and e.event = 'view')::int,
         (select count(distinct e.user_id) from public.resource_events e where e.resource_id = r.id)::int,
         (select count(*) from public.resource_events e where e.resource_id = r.id and e.event = 'download')::int,
         (select count(*) from public.resource_events e where e.resource_id = r.id and e.event = 'click')::int,
         (select count(*) from public.resource_unlocks u where u.resource_id = r.id)::int,
         (select count(*) from public.resource_likes l where l.resource_id = r.id)::int,
         (select count(*) from public.resource_comments c where c.resource_id = r.id)::int,
         greatest(
           (select max(e.created_at) from public.resource_events e where e.resource_id = r.id),
           (select max(l.created_at) from public.resource_likes l where l.resource_id = r.id),
           (select max(c.created_at) from public.resource_comments c where c.resource_id = r.id)
         )
  from public.resources r
  where r.uploader_id = auth.uid()
  order by r.created_at desc;
$$;

-- ---------------------------------------------------------------------
-- Everything for one resource's Insights window, as one JSON document:
-- totals, a per-day series for the last p_days days (UK days), who liked
-- it, who unlocked it, the audience by course, and recent activity.
create or replace function public.get_resource_insight_detail(p_id uuid, p_days integer default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  r public.resources;
  reveal boolean := public.is_dashboard_admin();
  days integer := least(greatest(coalesce(p_days, 90), 7), 365);
  today date := (now() at time zone 'Europe/London')::date;
  result jsonb;
begin
  select * into r from public.resources x where x.id = p_id and x.uploader_id = me;
  if not found then
    raise exception 'You can only see insights for resources you shared.';
  end if;

  select jsonb_build_object(
    'resource', jsonb_build_object('id', r.id, 'title', r.title, 'status', r.status, 'is_locked', r.is_locked, 'kind', r.kind, 'created_at', r.created_at),
    'totals', jsonb_build_object(
      'views', (select count(*) from public.resource_events e where e.resource_id = p_id and e.event = 'view'),
      'unique_viewers', (select count(distinct e.user_id) from public.resource_events e where e.resource_id = p_id),
      'downloads', (select count(*) from public.resource_events e where e.resource_id = p_id and e.event = 'download'),
      'clicks', (select count(*) from public.resource_events e where e.resource_id = p_id and e.event = 'click'),
      'likes', (select count(*) from public.resource_likes l where l.resource_id = p_id),
      'comments', (select count(*) from public.resource_comments c where c.resource_id = p_id),
      'unlocks', (select count(*) from public.resource_unlocks u where u.resource_id = p_id),
      'failed_pins', (select count(*) from public.resource_pin_attempts a where a.resource_id = p_id)
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'day', to_char(d.day, 'YYYY-MM-DD'),
               'views', (select count(*) from public.resource_events e where e.resource_id = p_id and e.event = 'view' and (e.created_at at time zone 'Europe/London')::date = d.day),
               'opens', (select count(*) from public.resource_events e where e.resource_id = p_id and e.event in ('download', 'click') and (e.created_at at time zone 'Europe/London')::date = d.day),
               'likes', (select count(*) from public.resource_likes l where l.resource_id = p_id and (l.created_at at time zone 'Europe/London')::date = d.day),
               'comments', (select count(*) from public.resource_comments c where c.resource_id = p_id and (c.created_at at time zone 'Europe/London')::date = d.day)
             ) order by d.day), '[]'::jsonb)
      from generate_series(0, days - 1) as g(i)
      cross join lateral (select (today - (days - 1) + g.i) as day) d
    ),
    'likers', (
      select coalesce(jsonb_agg(public.resource_person(x.user_id, reveal) || jsonb_build_object('at', x.created_at) order by x.created_at desc), '[]'::jsonb)
      from (select l.user_id, l.created_at from public.resource_likes l where l.resource_id = p_id order by l.created_at desc limit 200) x
    ),
    'unlockers', (
      select coalesce(jsonb_agg(public.resource_person(x.user_id, reveal) || jsonb_build_object('at', x.unlocked_at) order by x.unlocked_at desc), '[]'::jsonb)
      from (select u.user_id, u.unlocked_at from public.resource_unlocks u where u.resource_id = p_id order by u.unlocked_at desc limit 200) x
    ),
    'audience', (
      select coalesce(jsonb_agg(jsonb_build_object('label', a.label, 'count', a.n) order by a.n desc, a.label), '[]'::jsonb)
      from (
        select coalesce(nullif(btrim(m.course), ''), case when np.id is not null then 'Healthcare professionals' else 'Other' end) as label,
               count(*)::int as n
        from (select distinct e.user_id from public.resource_events e where e.resource_id = p_id and e.user_id is not null) v
        left join public.members m on m.id = v.user_id
        left join lateral (select p.id from public.network_professionals p where p.user_id = v.user_id limit 1) np on true
        group by 1
        order by 2 desc
        limit 8
      ) a
    ),
    'activity', (
      select coalesce(jsonb_agg(jsonb_build_object('type', t.kind, 'who', t.who, 'at', t.happened) order by t.happened desc), '[]'::jsonb)
      from (
        select * from (
          select 'like'::text as kind, public.resource_person(l.user_id, reveal) ->> 'name' as who, l.created_at as happened
            from public.resource_likes l where l.resource_id = p_id
          union all
          select 'comment', public.resource_person(c.author_id, reveal) ->> 'name', c.created_at
            from public.resource_comments c where c.resource_id = p_id
          union all
          select 'unlock', public.resource_person(u.user_id, reveal) ->> 'name', u.unlocked_at
            from public.resource_unlocks u where u.resource_id = p_id
          union all
          select e.event, null, e.created_at
            from public.resource_events e where e.resource_id = p_id
        ) all_events
        order by happened desc
        limit 40
      ) t
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.record_resource_event(uuid, text) from public, anon;
revoke all on function public.get_my_resource_insights() from public, anon;
revoke all on function public.get_resource_insight_detail(uuid, integer) from public, anon;
grant execute on function public.record_resource_event(uuid, text) to authenticated;
grant execute on function public.get_my_resource_insights() to authenticated;
grant execute on function public.get_resource_insight_detail(uuid, integer) to authenticated;

commit;
