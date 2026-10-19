-- 094: let the president see anyone's levels, badges and streak in "View the website as"
--
-- Opening the Members Hub normally runs journey_sync(), which works out a person's XP,
-- level, streak and badges and SAVES anything new. That's right for them, but in a
-- preview we must not change anything about them. So:
--
--   * journey__state(user, visit): the same calculation as before (the body of
--     journey_sync), but for any user id instead of only the caller. Internal.
--   * journey_sync(visit): unchanged behaviour for members - it just calls
--     journey__state() for the caller.
--   * president_journey_preview(user): president only. Runs the calculation for
--     that person and then throws away everything it wrote (it is run inside a
--     block that is rolled back), so what the president sees is what that person
--     would see on their next visit - and nothing about them is changed. Visits,
--     first-run intros, new badges and level-ups are not recorded.
--
-- If you ever re-run 088, run this file again afterwards (088 puts back the older
-- one-piece journey_sync, which still works but can't be previewed).
--
-- Safe to run more than once. Needs 088.

begin;

create or replace function public.journey__has(p_user uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select d.allowed from public.hub_access_decision(p_user, p_feature) d), false);
$$;

revoke all on function public.journey__has(uuid, text) from public, anon, authenticated;

create or replace function public.journey__state(p_me uuid, p_visit boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := p_me;
  prefs public.member_game_prefs;
  first_run boolean := false;
  joined timestamptz;
  months integer;
  r record;
  before_xp integer;
  after_xp integer;
  lvl integer;
  prev_level integer;
  level_up integer := null;
  counts jsonb;
  streaks integer[];
  keys text[] := '{}';
  newly jsonb;
  steps jsonb := '[]'::jsonb;
  total_discounts integer := 0;
  this_month text := to_char(now() at time zone 'Europe/London', 'YYYY-MM');
  has_motm_this_month boolean := false;
  areas jsonb;
begin
  if me is null or not public.journey_eligible(me) then
    return jsonb_build_object('eligible', false);
  end if;

  select * into prefs from public.member_game_prefs where user_id = me;
  if not found then
    first_run := true;
    insert into public.member_game_prefs (user_id) values (me) returning * into prefs;
  end if;
  select coalesce(sum(points), 0) into before_xp from public.member_xp where user_id = me;

  select m.created_at into joined from public.members m where m.id = me;
  joined := coalesce(joined, now());

  -- ---- Joining, and each month of membership (up to a year) ----
  perform public.journey__grant(me, 'join', '', 10, joined);
  months := least(12, greatest(0, floor(extract(epoch from (now() - joined)) / 2629800)::integer));
  for r in select g as n from generate_series(1, months) g loop
    perform public.journey__grant(me, 'tenure', r.n::text, 5, joined + (r.n * interval '1 month'));
  end loop;

  -- ---- A visit to the hub (once a day) ----
  if p_visit then
    perform public.journey__grant(me, 'visit', to_char(now() at time zone 'Europe/London', 'YYYY-MM-DD'), 2, now());
  end if;

  -- ---- Profile ----
  for r in select mp.updated_at as at, (char_length(btrim(coalesce(mp.bio, ''))) >= 20) as has_bio, (char_length(btrim(coalesce(mp.linkedin_url, ''))) > 5) as has_li
           from public.member_profiles mp where mp.id = me loop
    if r.has_bio then perform public.journey__grant(me, 'bio', '', 15, r.at); end if;
    if r.has_li then perform public.journey__grant(me, 'linkedin', '', 10, r.at); end if;
  end loop;

  -- ---- Events ----
  for r in select er.event_slug as ref, er.registered_at as at from public.event_registrations er
           where er.member_id = me order by er.registered_at limit 20 loop
    perform public.journey__grant(me, 'event_reg', r.ref, 10, r.at);
  end loop;

  -- ---- Discounts ----
  for r in select du.discount_id::text as ref, coalesce(du.first_revealed_at, du.created_at) as at from public.discount_usage du
           where du.member_id = me and du.reveal_count > 0 order by du.created_at limit 12 loop
    perform public.journey__grant(me, 'disc_reveal', r.ref, 3, r.at);
  end loop;
  for r in select du.discount_id::text as ref, coalesce(du.last_used_at, du.created_at) as at from public.discount_usage du
           where du.member_id = me and du.used_count > 0 order by du.created_at limit 12 loop
    perform public.journey__grant(me, 'disc_used', r.ref, 5, r.at);
  end loop;

  -- ---- Member of the Month ----
  for r in select n.id::text as ref, n.created_at as at from public.motm_nominations n
           where n.nominator_id = me order by n.created_at limit 12 loop
    perform public.journey__grant(me, 'motm_nominate', r.ref, 15, r.at);
  end loop;

  -- ---- News ----
  for r in select l.post_id::text as ref, l.created_at as at from public.news_likes l where l.member_id = me order by l.created_at limit 10 loop
    perform public.journey__grant(me, 'news_like', r.ref, 1, r.at);
  end loop;
  for r in select c.id::text as ref, c.created_at as at from public.news_comments c where c.member_id = me order by c.created_at limit 10 loop
    perform public.journey__grant(me, 'news_comment', r.ref, 2, r.at);
  end loop;

  -- ---- Sankofa ----
  if to_regclass('public.sankofa_applications') is not null then
    for r in select min(a.created_at) as at from public.sankofa_applications a where a.member_id = me having count(*) > 0 loop
      perform public.journey__grant(me, 'sankofa_apply', '', 20, r.at);
    end loop;
  end if;

  -- ---- Resources (migrations 065, 066, 074 - skipped if not run) ----
  if to_regclass('public.resources') is not null then
    for r in select x.id::text as ref, coalesce(x.approved_at, x.created_at) as at from public.resources x
             where x.uploader_id = me and x.status = 'approved' order by x.approved_at limit 20 loop
      perform public.journey__grant(me, 'resource_shared', r.ref, 25, r.at);
    end loop;
  end if;
  if to_regclass('public.resource_likes') is not null then
    for r in select l.resource_id::text as ref, l.created_at as at from public.resource_likes l where l.user_id = me order by l.created_at limit 15 loop
      perform public.journey__grant(me, 'resource_like', r.ref, 1, r.at);
    end loop;
  end if;
  if to_regclass('public.resource_comments') is not null then
    for r in select c.id::text as ref, c.created_at as at from public.resource_comments c where c.author_id = me order by c.created_at limit 15 loop
      perform public.journey__grant(me, 'resource_comment', r.ref, 2, r.at);
    end loop;
  end if;
  if to_regclass('public.resource_events') is not null then
    for r in select e.resource_id::text as ref, min(e.created_at) as at from public.resource_events e
             where e.user_id = me and e.event = 'download' group by e.resource_id order by min(e.created_at) limit 15 loop
      perform public.journey__grant(me, 'resource_download', r.ref, 1, r.at);
    end loop;
  end if;

  -- ---- Messaging (migration 070 - skipped if not run) ----
  if to_regclass('public.chat_messages') is not null then
    for r in select min(m.created_at) as at from public.chat_messages m where m.sender_id = me and m.deleted_at is null having count(*) > 0 loop
      perform public.journey__grant(me, 'chat_first', '', 10, r.at);
    end loop;
  end if;

  -- ---- Counts, level, streak ----
  select coalesce(jsonb_object_agg(k.kind, k.n), '{}'::jsonb) into counts
  from (select kind, count(*) as n from public.member_xp where user_id = me group by kind) k;
  select coalesce(sum(points), 0) into after_xp from public.member_xp where user_id = me;
  lvl := public.journey_level(after_xp);
  streaks := public.journey__streaks(me);

  -- ---- Badges ----
  keys := array_append(keys, 'welcome');
  if (counts ->> 'bio') is not null and (counts ->> 'linkedin') is not null then keys := array_append(keys, 'profile_pro'); end if;
  if coalesce((counts ->> 'disc_reveal')::int, 0) >= 3 then keys := array_append(keys, 'deal_hunter'); end if;
  if coalesce((counts ->> 'disc_used')::int, 0) >= 3 then keys := array_append(keys, 'smart_saver'); end if;
  if coalesce((counts ->> 'event_reg')::int, 0) >= 1 then keys := array_append(keys, 'event_goer'); end if;
  if coalesce((counts ->> 'event_reg')::int, 0) >= 3 then keys := array_append(keys, 'regular_face'); end if;
  if coalesce((counts ->> 'event_reg')::int, 0) >= 6 then keys := array_append(keys, 'social_butterfly'); end if;
  if coalesce((counts ->> 'resource_shared')::int, 0) >= 1 then keys := array_append(keys, 'contributor'); end if;
  if coalesce((counts ->> 'resource_shared')::int, 0) >= 3 then keys := array_append(keys, 'library_builder'); end if;
  if coalesce((counts ->> 'resource_like')::int, 0) >= 5 then keys := array_append(keys, 'supporter'); end if;
  if coalesce((counts ->> 'resource_comment')::int, 0) >= 3 then keys := array_append(keys, 'conversationalist'); end if;
  if coalesce((counts ->> 'motm_nominate')::int, 0) >= 1 then keys := array_append(keys, 'nominator'); end if;
  if (counts ->> 'chat_first') is not null then keys := array_append(keys, 'connector'); end if;
  if (counts ->> 'sankofa_apply') is not null then keys := array_append(keys, 'pathfinder'); end if;
  if streaks[2] >= 4 then keys := array_append(keys, 'consistent'); end if;
  if streaks[2] >= 12 then keys := array_append(keys, 'dedicated'); end if;
  if (counts ->> 'disc_reveal') is not null and (counts ->> 'event_reg') is not null and (counts ->> 'motm_nominate') is not null
     and ((counts ->> 'resource_shared') is not null or (counts ->> 'resource_like') is not null or (counts ->> 'resource_download') is not null)
  then keys := array_append(keys, 'all_rounder'); end if;
  if coalesce((counts ->> 'tenure')::int, 0) >= 6 then keys := array_append(keys, 'old_hand'); end if;
  if lvl >= 5 then keys := array_append(keys, 'champion'); end if;
  if lvl >= 8 then keys := array_append(keys, 'legend'); end if;

  with ins as (
    insert into public.member_badges (user_id, badge_key)
    select me, k from unnest(keys) k
    on conflict do nothing
    returning badge_key
  )
  select coalesce(jsonb_agg(jsonb_build_object('key', d.key, 'name', d.name, 'icon', d.icon, 'description', d.description) order by d.sort_order), '[]'::jsonb)
  into newly
  from ins join public.member_badge_defs d on d.key = ins.badge_key;

  -- ---- Level-up detection (not on the very first run) ----
  prev_level := prefs.last_level;
  if prev_level is not null and lvl > prev_level then level_up := lvl; end if;
  update public.member_game_prefs set last_level = lvl where user_id = me;

  -- ---- Areas (for the little progress lines on each page) ----
  select count(*) into total_discounts from public.discounts d where d.is_active;
  select exists (select 1 from public.motm_nominations n where n.nominator_id = me and to_char(n.created_at at time zone 'Europe/London', 'YYYY-MM') = this_month)
    into has_motm_this_month;
  areas := jsonb_build_object(
    'perks', jsonb_build_object('total', total_discounts, 'revealed', coalesce((counts ->> 'disc_reveal')::int, 0), 'used', coalesce((counts ->> 'disc_used')::int, 0)),
    'events', jsonb_build_object('registered', coalesce((counts ->> 'event_reg')::int, 0)),
    'resources', jsonb_build_object('shared', coalesce((counts ->> 'resource_shared')::int, 0), 'liked', coalesce((counts ->> 'resource_like')::int, 0),
                                    'commented', coalesce((counts ->> 'resource_comment')::int, 0), 'downloaded', coalesce((counts ->> 'resource_download')::int, 0)),
    'motm', jsonb_build_object('nominations', coalesce((counts ->> 'motm_nominate')::int, 0), 'this_month', has_motm_this_month),
    'network', jsonb_build_object('bio', (counts ->> 'bio') is not null, 'linkedin', (counts ->> 'linkedin') is not null, 'messaged', (counts ->> 'chat_first') is not null)
  );

  -- ---- Next steps: up to three things not done yet, only where the member has access ----
  if (counts ->> 'bio') is null then
    steps := steps || jsonb_build_array(jsonb_build_object('key', 'bio', 'title', 'Add a short bio', 'sub', 'Shown on your Network card', 'xp', 15, 'href', 'member-hub.html#network-profile'));
  end if;
  if (counts ->> 'disc_reveal') is null and public.journey__has(me, 'perks') then
    steps := steps || jsonb_build_array(jsonb_build_object('key', 'discount', 'title', 'Try your first member discount', 'sub', 'Partner offers just for LACMS members', 'xp', 8, 'href', 'member-perks.html'));
  end if;
  if (counts ->> 'event_reg') is null then
    steps := steps || jsonb_build_array(jsonb_build_object('key', 'event', 'title', 'Register for an event', 'sub', 'Meet other members in person', 'xp', 10, 'href', 'events.html'));
  end if;
  if (counts ->> 'resource_like') is null and (counts ->> 'resource_shared') is null and public.journey__has(me, 'resources') then
    steps := steps || jsonb_build_array(jsonb_build_object('key', 'resources', 'title', 'Explore LACMS Resources', 'sub', 'Like a resource that helps you', 'xp', 1, 'href', 'member-resources.html'));
  end if;
  if (counts ->> 'resource_shared') is null and public.journey__has(me, 'resources') then
    steps := steps || jsonb_build_array(jsonb_build_object('key', 'share', 'title', 'Share a resource', 'sub', 'Notes, past papers or links that helped you', 'xp', 25, 'href', 'member-resources.html'));
  end if;
  if not has_motm_this_month and public.journey__has(me, 'motm_nominate') then
    steps := steps || jsonb_build_array(jsonb_build_object('key', 'motm', 'title', 'Nominate someone for Member of the Month', 'sub', 'Celebrate someone who has gone above and beyond', 'xp', 15, 'href', 'motm.html#nominate'));
  end if;
  if (counts ->> 'chat_first') is null and public.journey__has(me, 'network') then
    steps := steps || jsonb_build_array(jsonb_build_object('key', 'hello', 'title', 'Say hello in the Network', 'sub', 'Message another member', 'xp', 10, 'href', 'member-network.html'));
  end if;
  steps := coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(steps) e limit 3) s), '[]'::jsonb);

  return jsonb_build_object(
    'eligible', true,
    'hidden', prefs.hidden,
    'first_run', first_run,
    'gained', after_xp - before_xp,
    'level_up', level_up,
    'new_badges', newly,
    'progress', jsonb_build_object(
      'xp', after_xp, 'level', lvl,
      'level_floor', public.journey_level_floor(lvl), 'next_floor', public.journey_level_floor(lvl + 1),
      'streak', streaks[1], 'best_streak', streaks[2],
      'xp_week', coalesce((select sum(points) from public.member_xp where user_id = me and created_at >= public.journey_week_start()::timestamptz), 0),
      'active_this_week', exists (select 1 from public.member_xp x where x.user_id = me and x.kind not in ('join', 'tenure') and x.created_at >= public.journey_week_start()::timestamptz)
    ),
    'badges', coalesce((
      select jsonb_agg(jsonb_build_object('key', d.key, 'name', d.name, 'description', d.description, 'hint', d.hint, 'icon', d.icon,
                                          'earned', b.user_id is not null, 'awarded_at', b.awarded_at) order by d.sort_order)
      from public.member_badge_defs d
      left join public.member_badges b on b.badge_key = d.key and b.user_id = me
    ), '[]'::jsonb),
    'next_steps', steps,
    'areas', areas,
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('kind', x.kind, 'points', x.points, 'at', x.created_at) order by x.created_at desc)
      from (select kind, points, created_at from public.member_xp where user_id = me and kind not in ('tenure') order by created_at desc limit 8) x
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.journey__state(uuid, boolean) from public, anon, authenticated;

-- The same call the site has always made.
create or replace function public.journey_sync(p_visit boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('eligible', false);
  end if;
  return public.journey__state(auth.uid(), p_visit);
end;
$$;

revoke all on function public.journey_sync(boolean) from public, anon;
grant execute on function public.journey_sync(boolean) to authenticated;

-- President only: someone's journey exactly as it would look on their next visit, without
-- recording anything. Everything journey__state() writes is rolled back.
create or replace function public.president_journey_preview(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_president() then
    raise exception 'Only the president can preview someone''s journey.';
  end if;
  if p_user is null then
    return jsonb_build_object('eligible', false);
  end if;
  begin
    result := public.journey__state(p_user, false);
    -- Undo every write made above; the value already in "result" is kept.
    raise exception 'journey_preview_rollback' using errcode = 'P0001';
  exception when raise_exception then
    if sqlerrm is distinct from 'journey_preview_rollback' then
      raise;
    end if;
  end;
  return result;
end;
$$;

revoke all on function public.president_journey_preview(uuid) from public, anon;
grant execute on function public.president_journey_preview(uuid) to authenticated;

commit;
