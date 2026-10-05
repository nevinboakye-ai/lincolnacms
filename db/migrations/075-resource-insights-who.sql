-- Insights, part 2: the person who shared a resource can now see WHO
-- downloaded it or clicked its link (and when, and how many times each),
-- not just how many. Likes, comments and unlocks were already named.
-- Views stay counts-only. Replaces get_resource_insight_detail from 074 and
-- adds an "openers" list plus names on download/click entries in the
-- activity timeline. Sixth-form students still appear anonymously unless the
-- person looking is an executive (resource_person, from 074).
--
-- Members are told: the preview of any resource shared by someone else now
-- says the person who shared it can see who likes, downloads or opens it.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query, paste,
-- Run. Needs 074. Safe to run more than once.

begin;

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
    'openers', (
      select coalesce(jsonb_agg(public.resource_person(x.user_id, reveal) || jsonb_build_object('count', x.n, 'at', x.last_at) order by x.last_at desc), '[]'::jsonb)
      from (
        select e.user_id, count(*)::int as n, max(e.created_at) as last_at
        from public.resource_events e
        where e.resource_id = p_id and e.event in ('download', 'click')
        group by e.user_id
        order by max(e.created_at) desc
        limit 200
      ) x
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
          select e.event,
                 case when e.event in ('download', 'click') then public.resource_person(e.user_id, reveal) ->> 'name' end,
                 e.created_at
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

revoke all on function public.get_resource_insight_detail(uuid, integer) from public, anon;
grant execute on function public.get_resource_insight_detail(uuid, integer) to authenticated;

commit;
