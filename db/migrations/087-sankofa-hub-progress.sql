-- Sankofa Hub, part 4 of 4: levels, streaks, badges and leaderboards.
--
-- XP is granted by the Hub's own functions (RSVP, check-in, goals, posts,
-- kudos...) and by sankofa_sync() below, which also hands out badges.
-- Nothing here can be set from the browser. A level needs 30 x (level-1)^2
-- XP: level 2 at 30, level 5 at 480, level 8 at 1,470.
--
-- A "streak" is the number of weeks in a row with at least one real action
-- (a check-in, attending, finishing a goal, posting, hosting, feedback, or
-- saying hello). The current week doesn't break it until the week is over.
--
-- The Circle Cup ranks Circles by the average XP their members earned in
-- the last 30 days, so a small Circle can beat a big one. Inside a Circle
-- a member can opt out of the board from their profile.
--
-- Needs 084 to 086. Run this straight after 086.
--
-- Wrapped in a transaction. Run this once in Supabase: Dashboard -> SQL
-- Editor -> New query, paste, Run.

begin;

create or replace function public.sankofa_level(p_xp numeric)
returns integer
language sql
immutable
as $$
  select 1 + floor(sqrt(greatest(coalesce(p_xp, 0), 0) / 30.0))::integer;
$$;

create or replace function public.sankofa_level_floor(p_level integer)
returns integer
language sql
immutable
as $$
  select (30 * power(greatest(p_level, 1) - 1, 2))::integer;
$$;

-- Weeks (Mondays, UK time) in which the person did something real.
create or replace function public.sankofa__active_weeks(p_user uuid)
returns date[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct public.sankofa_week_start(x.created_at) order by public.sankofa_week_start(x.created_at)), '{}'::date[])
  from public.sankofa_xp x
  where x.user_id = p_user
    and x.kind in ('checkin', 'attend', 'goal_done', 'post', 'host', 'feedback', 'hello');
$$;
revoke all on function public.sankofa__active_weeks(uuid) from public, anon, authenticated;

create or replace function public.sankofa_streak(p_user uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  weeks date[] := public.sankofa__active_weeks(p_user);
  w date := public.sankofa_week_start();
  n integer := 0;
begin
  if cardinality(weeks) = 0 then
    return 0;
  end if;
  if not (w = any (weeks)) then
    w := w - 7;
  end if;
  while w = any (weeks) loop
    n := n + 1;
    w := w - 7;
  end loop;
  return n;
end;
$$;

create or replace function public.sankofa_best_streak(p_user uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  weeks date[] := public.sankofa__active_weeks(p_user);
  best integer := 0;
  run integer := 0;
  prev date := null;
  w date;
begin
  foreach w in array weeks loop
    if prev is not null and w = prev + 7 then
      run := run + 1;
    else
      run := 1;
    end if;
    best := greatest(best, run);
    prev := w;
  end loop;
  return best;
end;
$$;
revoke all on function public.sankofa_streak(uuid) from public, anon, authenticated;
revoke all on function public.sankofa_best_streak(uuid) from public, anon, authenticated;

-- XP, level, streak and every badge (earned or not) for one person.
create or replace function public.sankofa_progress(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  total integer := coalesce((select sum(points) from public.sankofa_xp where user_id = p_user), 0);
  lvl integer;
begin
  lvl := public.sankofa_level(total);
  return jsonb_build_object(
    'xp', total,
    'level', lvl,
    'level_floor', public.sankofa_level_floor(lvl),
    'next_floor', public.sankofa_level_floor(lvl + 1),
    'xp_30d', coalesce((select sum(points) from public.sankofa_xp where user_id = p_user and created_at > now() - interval '30 days'), 0),
    'xp_week', coalesce((select sum(points) from public.sankofa_xp where user_id = p_user and created_at >= public.sankofa_week_start()::timestamptz), 0),
    'streak', public.sankofa_streak(p_user),
    'best_streak', public.sankofa_best_streak(p_user),
    'badges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', d.key, 'name', d.name, 'description', d.description, 'icon', d.icon,
        'earned', b.user_id is not null, 'awarded_at', b.awarded_at
      ) order by d.sort_order)
      from public.sankofa_badge_defs d
      left join public.sankofa_badges b on b.badge_key = d.key and b.user_id = p_user
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('kind', r.kind, 'points', r.points, 'at', r.created_at) order by r.created_at desc)
      from (select kind, points, created_at from public.sankofa_xp where user_id = p_user order by created_at desc limit 8) r
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.sankofa_progress(uuid) from public, anon, authenticated;

-- Run on every Hub visit: grants "say hello" XP for anyone I've messaged
-- (checked against the real chat), works out which badges I've earned, and
-- returns the newly earned ones so the page can celebrate.
create or replace function public.sankofa_sync()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  r record;
  total integer;
  lvl integer;
  keys text[] := '{}';
  hello integer;
  n_attended integer;
  checkins integer;
  goals_done integer;
  posts integer;
  kudos_sent integer;
  kudos_recv integer;
  hosted integer;
  fb integer;
  streak integer;
  joined timestamptz;
  newly jsonb;
begin
  if me is null or not public.sankofa_is_active(me) then
    return jsonb_build_object('new_badges', '[]'::jsonb);
  end if;

  for r in
    select distinct case when c.user_a = me then c.user_b else c.user_a end as other_id
    from public.chat_conversations c
    join public.chat_messages m on m.conversation_id = c.id
    where (c.user_a = me or c.user_b = me) and m.sender_id = me and m.deleted_at is null
  loop
    if public.sankofa_is_active(r.other_id) then
      perform public.sankofa_award(me, 'hello', r.other_id::text, 10);
    end if;
  end loop;

  select count(*) into hello from public.sankofa_xp where user_id = me and kind = 'hello';
  select count(*) into n_attended from public.sankofa_meeting_rsvps where user_id = me and attended;
  select count(*) into checkins from public.sankofa_checkins where user_id = me;
  select count(*) into goals_done from public.sankofa_goals where user_id = me and done;
  select count(*) into posts from public.sankofa_posts where author_id = me and kind = 'post';
  select count(*) into kudos_sent from public.sankofa_posts where author_id = me and kind = 'shoutout';
  select count(*) into kudos_recv from public.sankofa_posts where target_id = me and kind = 'shoutout';
  select count(*) into hosted from public.sankofa_meetings where created_by = me;
  select count(*) into fb from public.sankofa_meeting_feedback where user_id = me;
  select coalesce(sum(points), 0) into total from public.sankofa_xp where user_id = me;
  lvl := public.sankofa_level(total);
  streak := public.sankofa_best_streak(me);
  select p.created_at into joined from public.sankofa_participants p where p.user_id = me;

  if joined < '2027-01-01'::timestamptz then keys := array_append(keys, 'founding'::text); end if;
  if exists (select 1 from public.sankofa_participants where user_id = me and profile_done) then keys := array_append(keys, 'first_steps'::text); end if;
  if hello >= 1 then keys := array_append(keys, 'ice_breaker'::text); end if;
  if hello >= 3 then keys := array_append(keys, 'connector'::text); end if;
  if n_attended >= 1 then keys := array_append(keys, 'showed_up'::text); end if;
  if n_attended >= 5 then keys := array_append(keys, 'regular'::text); end if;
  if checkins >= 4 then keys := array_append(keys, 'reflective'::text); end if;
  if goals_done >= 1 then keys := array_append(keys, 'goal_getter'::text); end if;
  if goals_done >= 5 then keys := array_append(keys, 'goal_crusher'::text); end if;
  if posts >= 5 then keys := array_append(keys, 'voice'::text); end if;
  if kudos_sent >= 5 then keys := array_append(keys, 'cheerleader'::text); end if;
  if kudos_recv >= 3 then keys := array_append(keys, 'appreciated'::text); end if;
  if streak >= 3 then keys := array_append(keys, 'on_a_roll'::text); end if;
  if streak >= 8 then keys := array_append(keys, 'unstoppable'::text); end if;
  if hosted >= 3 then keys := array_append(keys, 'host'::text); end if;
  if fb >= 3 then keys := array_append(keys, 'feedback'::text); end if;
  if lvl >= 5 then keys := array_append(keys, 'canopy'::text); end if;
  if lvl >= 8 then keys := array_append(keys, 'baobab'::text); end if;

  with ins as (
    insert into public.sankofa_badges (user_id, badge_key)
    select me, k from unnest(keys) k
    on conflict do nothing
    returning badge_key
  )
  select coalesce(jsonb_agg(jsonb_build_object('key', d.key, 'name', d.name, 'icon', d.icon, 'description', d.description) order by d.sort_order), '[]'::jsonb)
  into newly
  from ins join public.sankofa_badge_defs d on d.key = ins.badge_key;

  return jsonb_build_object('new_badges', newly, 'progress', public.sankofa_progress(me));
end;
$$;

-- The Circle Cup and my Circle's board.
create or replace function public.sankofa_leaderboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cid uuid := public.sankofa_circle_of(auth.uid());
begin
  if me is null or not (public.sankofa_is_active(me) or public.sankofa_is_admin()) then
    raise exception 'The Sankofa Hub isn''t available on your account.';
  end if;
  return jsonb_build_object(
    'cup', coalesce((
      select jsonb_agg(jsonb_build_object(
        'circle_id', t.id, 'name', t.name, 'theme', t.theme, 'members', t.members,
        'xp_30d', t.xp, 'avg', t.avg, 'mine', t.id = cid
      ) order by t.avg desc, t.xp desc, t.name)
      from (
        select c.id, c.name, c.theme,
               count(distinct cm.user_id) as members,
               coalesce(sum(x.points), 0) as xp,
               round(coalesce(sum(x.points), 0)::numeric / greatest(count(distinct cm.user_id), 1), 1) as avg
        from public.sankofa_circles c
        join public.sankofa_circle_members cm on cm.circle_id = c.id
        join public.sankofa_participants sp on sp.user_id = cm.user_id and sp.status = 'active'
        left join public.sankofa_xp x on x.user_id = cm.user_id and x.created_at > now() - interval '30 days'
        where c.status = 'active'
        group by c.id, c.name, c.theme
      ) t
    ), '[]'::jsonb),
    'board', case when cid is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'person', public.sankofa_person(me, b.user_id), 'xp_30d', b.xp, 'level', b.level, 'is_me', b.user_id = me
      ) order by b.xp desc, b.name)
      from (
        select cm.user_id,
               coalesce((select sum(x.points) from public.sankofa_xp x where x.user_id = cm.user_id and x.created_at > now() - interval '30 days'), 0) as xp,
               public.sankofa_level((select coalesce(sum(x.points), 0) from public.sankofa_xp x where x.user_id = cm.user_id)) as level,
               (public.sankofa_person(me, cm.user_id) ->> 'name') as name
        from public.sankofa_circle_members cm
        join public.sankofa_participants sp on sp.user_id = cm.user_id and sp.status = 'active'
        where cm.circle_id = cid and (sp.show_on_leaderboard or cm.user_id = me)
      ) b
    ), '[]'::jsonb) end
  );
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['sankofa_sync()', 'sankofa_leaderboard()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

commit;
