-- Your LACMS journey: a calm layer of progress across the whole Members Hub.
--
-- Members earn XP for things they genuinely do - finish their profile,
-- register for events, use discounts, share and engage with resources,
-- nominate for Member of the Month, say hello in the Network - and see a
-- level, a gentle weekly streak, badges, a few "next steps" and shared
-- community goals. There are NO individual leaderboards.
--
-- How it works: XP is worked out in the database from the tables that
-- already hold those actions (event_registrations, discount_usage,
-- resources, resource_likes, motm_nominations, ...), so nothing in the
-- existing pages has to change, it can't be faked from the browser, and
-- members are credited for what they did BEFORE this existed (with the real
-- dates, so early weeks count towards their streak). Every award is
-- recorded once (a repeat or a deleted-and-redone action can't earn twice),
-- and lifetime caps keep small things like likes from piling up.
--
-- Who gets it is a Hub Access rule, "journey": on for all members, off for
-- professionals, and the president can change that (Dashboard -> Hub Access
-- -> Member journey). Each member can also switch the whole thing off for
-- themselves from their journey page.
--
-- Optional pieces (resources, resource downloads, chat) are skipped cleanly
-- if their migrations haven't been run.
--
-- Wrapped in a transaction. Run this once in Supabase: Dashboard -> SQL
-- Editor -> New query, paste, Run. Safe to run again. Needs 003, 013, 014,
-- 042, 060 and 061.

begin;

-- ---------------------------------------------------------------------
-- Hub Access rule (on for members, off for professionals).
-- The allowed feature names: everything already in the table, plus the
-- known ones, so the order these migrations are run in never matters.
do $$
declare
  names text;
begin
  select string_agg(quote_literal(f), ', ') into names
  from (
    select feature as f from public.hub_access_rules
    union
    select unnest(array[
      'perks', 'sankofa', 'network', 'motm_nominate', 'news_feed', 'resources', 'sankofa_hub', 'journey',
      'dash_mmg', 'dash_sankofa', 'dash_motm', 'dash_events', 'dash_gallery'
    ])
  ) x;
  alter table public.hub_access_rules drop constraint if exists hub_access_rules_feature_check;
  execute 'alter table public.hub_access_rules add constraint hub_access_rules_feature_check check (feature in (' || names || '))';
end;
$$;

insert into public.hub_access_rules (feature, allow_members, allow_professionals, member_types, courses, blocked_display)
values ('journey', true, false, null, null, 'hidden')
on conflict (feature) do nothing;

-- ---------------------------------------------------------------------
create table if not exists public.member_xp (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  points integer not null check (points >= 0),
  ref text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, kind, ref)
);
create index if not exists member_xp_user_idx on public.member_xp (user_id, created_at desc);

create table if not exists public.member_badge_defs (
  key text primary key,
  name text not null,
  description text not null,
  hint text not null,
  icon text not null,
  sort_order int not null default 0
);

create table if not exists public.member_badges (
  user_id uuid not null references auth.users (id) on delete cascade,
  badge_key text not null references public.member_badge_defs (key) on delete cascade,
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge_key)
);

create table if not exists public.member_game_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  hidden boolean not null default false,
  last_level integer,
  created_at timestamptz not null default now()
);

alter table public.member_xp enable row level security;
alter table public.member_badge_defs enable row level security;
alter table public.member_badges enable row level security;
alter table public.member_game_prefs enable row level security;

drop policy if exists "Read your own XP" on public.member_xp;
create policy "Read your own XP" on public.member_xp for select to authenticated using (user_id = auth.uid());
drop policy if exists "Read badge definitions" on public.member_badge_defs;
create policy "Read badge definitions" on public.member_badge_defs for select to authenticated using (true);
drop policy if exists "Read your own badges" on public.member_badges;
create policy "Read your own badges" on public.member_badges for select to authenticated using (user_id = auth.uid());
drop policy if exists "Read your own preferences" on public.member_game_prefs;
create policy "Read your own preferences" on public.member_game_prefs for select to authenticated using (user_id = auth.uid());

revoke insert, update, delete, truncate on public.member_xp, public.member_badge_defs, public.member_badges, public.member_game_prefs from anon, authenticated;
revoke all on public.member_xp, public.member_badge_defs, public.member_badges, public.member_game_prefs from anon;

insert into public.member_badge_defs (key, name, description, hint, icon, sort_order) values
  ('welcome',        'Welcome aboard',     'You joined LACMS.',                                   'Join LACMS',                                         '👋', 1),
  ('profile_pro',    'Profile pro',        'Added a bio and your LinkedIn to your Network card.', 'Add a bio and LinkedIn to your profile',            '🪪', 2),
  ('deal_hunter',    'Deal hunter',        'Revealed three member discounts.',                    'Reveal 3 discounts on the Perks page',               '🏷️', 3),
  ('smart_saver',    'Smart saver',        'Used three member discounts.',                        'Mark 3 discounts as used',                           '💷', 4),
  ('event_goer',     'Out and about',      'Registered for your first event.',                    'Register for an event',                              '🎟️', 5),
  ('regular_face',   'Regular face',       'Registered for three events.',                        'Register for 3 events',                              '🎉', 6),
  ('social_butterfly','Social butterfly',  'Registered for six events.',                          'Register for 6 events',                              '🦋', 7),
  ('contributor',    'Contributor',        'Shared a resource that helped others.',               'Share a resource (once approved)',                   '📚', 8),
  ('library_builder','Library builder',    'Three of your resources are live.',                   'Have 3 resources approved',                          '🏛️', 9),
  ('supporter',      'Supporter',          'Liked five resources.',                               'Like 5 resources',                                   '👍', 10),
  ('conversationalist','Conversation starter','Left three helpful comments.',                      'Comment on 3 resources',                             '💬', 11),
  ('nominator',      'Spotlight finder',   'Nominated someone for Member of the Month.',          'Nominate someone for Member of the Month',           '⭐', 12),
  ('connector',      'Connector',          'Sent your first message in the Network.',             'Message someone in the Network',                     '🤝', 13),
  ('pathfinder',     'Pathfinder',         'Applied for a Sankofa Circle.',                       'Apply for Sankofa',                                  '🧭', 14),
  ('consistent',     'Consistent',         'Kept a four-week streak going.',                      'Be active 4 weeks in a row',                         '🔥', 15),
  ('dedicated',      'Dedicated',          'Kept a twelve-week streak going.',                    'Be active 12 weeks in a row',                        '🚀', 16),
  ('all_rounder',    'All-rounder',        'Tried a bit of everything - perks, events, resources and nominations.', 'Do one thing in perks, events, resources and nominations', '🌟', 17),
  ('old_hand',       'Old hand',           'A member for six months.',                            'Be a member for 6 months',                           '🏅', 18),
  ('champion',       'Champion',           'Reached level 5.',                                    'Reach level 5',                                      '🏆', 19),
  ('legend',         'Legend',             'Reached level 8 - a pillar of LACMS.',                'Reach level 8',                                      '👑', 20)
on conflict (key) do update
  set name = excluded.name, description = excluded.description, hint = excluded.hint,
      icon = excluded.icon, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------
-- Helpers (internal: not callable from the browser).
create or replace function public.journey_eligible(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null
    and (p_user = '22044cd2-6804-4142-96c4-5c475ce9347a'::uuid
         or exists (select 1 from public.members m where m.id = p_user and m.membership_status = 'active'))
    and coalesce((select d.allowed from public.hub_access_decision(p_user, 'journey') d), false);
$$;

create or replace function public.journey_level(p_xp numeric)
returns integer
language sql
immutable
as $$
  select 1 + floor(sqrt(greatest(coalesce(p_xp, 0), 0) / 25.0))::integer;
$$;

create or replace function public.journey_level_floor(p_level integer)
returns integer
language sql
immutable
as $$
  select (25 * power(greatest(p_level, 1) - 1, 2))::integer;
$$;

-- Monday of the week, UK time.
create or replace function public.journey_week_start(p_at timestamptz default now())
returns date
language sql
stable
as $$
  select date_trunc('week', p_at at time zone 'Europe/London')::date;
$$;

create or replace function public.journey__grant(p_user uuid, p_kind text, p_ref text, p_points integer, p_at timestamptz)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.member_xp (user_id, kind, points, ref, created_at)
  values (p_user, p_kind, p_points, coalesce(p_ref, ''), coalesce(p_at, now()))
  on conflict (user_id, kind, ref) do nothing;
$$;

-- Weeks in which the person actually did something (not just joined).
create or replace function public.journey__active_weeks(p_user uuid)
returns date[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct public.journey_week_start(x.created_at) order by public.journey_week_start(x.created_at)), '{}'::date[])
  from public.member_xp x
  where x.user_id = p_user and x.kind not in ('join', 'tenure');
$$;

create or replace function public.journey__streaks(p_user uuid)
returns integer[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  weeks date[] := public.journey__active_weeks(p_user);
  w date := public.journey_week_start();
  cur integer := 0;
  best integer := 0;
  run integer := 0;
  prev date := null;
  x date;
begin
  if cardinality(weeks) = 0 then
    return array[0, 0];
  end if;
  -- The current week doesn't break a streak until it is over.
  if not (w = any (weeks)) then
    w := w - 7;
  end if;
  while w = any (weeks) loop
    cur := cur + 1;
    w := w - 7;
  end loop;
  foreach x in array weeks loop
    if prev is not null and x = prev + 7 then run := run + 1; else run := 1; end if;
    best := greatest(best, run);
    prev := x;
  end loop;
  return array[cur, best];
end;
$$;

revoke all on function public.journey_eligible(uuid) from public, anon, authenticated;
revoke all on function public.journey__grant(uuid, text, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.journey__active_weeks(uuid) from public, anon, authenticated;
revoke all on function public.journey__streaks(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- The one call the site makes: works out any new XP and badges from what
-- the member has done, and returns their whole journey. p_visit = they've
-- just opened the Members Hub (a small daily XP).
create or replace function public.journey_sync(p_visit boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
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
  if (counts ->> 'disc_reveal') is null and public.has_hub_access('perks') then
    steps := steps || jsonb_build_array(jsonb_build_object('key', 'discount', 'title', 'Try your first member discount', 'sub', 'Partner offers just for LACMS members', 'xp', 8, 'href', 'member-perks.html'));
  end if;
  if (counts ->> 'event_reg') is null then
    steps := steps || jsonb_build_array(jsonb_build_object('key', 'event', 'title', 'Register for an event', 'sub', 'Meet other members in person', 'xp', 10, 'href', 'events.html'));
  end if;
  if (counts ->> 'resource_like') is null and (counts ->> 'resource_shared') is null and public.has_hub_access('resources') then
    steps := steps || jsonb_build_array(jsonb_build_object('key', 'resources', 'title', 'Explore LACMS Resources', 'sub', 'Like a resource that helps you', 'xp', 1, 'href', 'member-resources.html'));
  end if;
  if (counts ->> 'resource_shared') is null and public.has_hub_access('resources') then
    steps := steps || jsonb_build_array(jsonb_build_object('key', 'share', 'title', 'Share a resource', 'sub', 'Notes, past papers or links that helped you', 'xp', 25, 'href', 'member-resources.html'));
  end if;
  if not has_motm_this_month and public.has_hub_access('motm_nominate') then
    steps := steps || jsonb_build_array(jsonb_build_object('key', 'motm', 'title', 'Nominate someone for Member of the Month', 'sub', 'Celebrate someone who has gone above and beyond', 'xp', 15, 'href', 'motm.html#nominate'));
  end if;
  if (counts ->> 'chat_first') is null and public.has_hub_access('network') then
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

-- Shared, friendly numbers: what the society is doing together. No names.
create or replace function public.journey_community()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  members_n integer;
  events_n integer;
  res_n integer := 0;
  used_n integer;
begin
  if auth.uid() is null or not public.journey_eligible(auth.uid()) then
    return '{}'::jsonb;
  end if;
  select count(*) into members_n from public.members where membership_status = 'active';
  select count(*) into events_n from public.event_registrations where registered_at > now() - interval '365 days';
  if to_regclass('public.resources') is not null then
    select count(*) into res_n from public.resources where status = 'approved';
  end if;
  select coalesce(sum(used_count), 0) into used_n from public.discount_usage;
  return jsonb_build_object('members', members_n, 'event_places', events_n, 'resources', res_n, 'discounts_used', used_n);
end;
$$;

create or replace function public.journey_set_hidden(p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.journey_eligible(auth.uid()) then
    raise exception 'Not available on your account.';
  end if;
  insert into public.member_game_prefs (user_id, hidden) values (auth.uid(), coalesce(p_hidden, false))
  on conflict (user_id) do update set hidden = coalesce(p_hidden, false);
end;
$$;

revoke all on function public.journey_sync(boolean) from public, anon;
revoke all on function public.journey_community() from public, anon;
revoke all on function public.journey_set_hidden(boolean) from public, anon;
grant execute on function public.journey_sync(boolean) to authenticated;
grant execute on function public.journey_community() to authenticated;
grant execute on function public.journey_set_hidden(boolean) to authenticated;

commit;
