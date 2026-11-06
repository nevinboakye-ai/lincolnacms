-- 127: Unity Cup - private scorer links for a match
--
-- The committee can make a private link for any match and send it to anyone (a volunteer, a team captain, a
-- friend with a phone). They don't need an account or to be on the committee: they open the link and get the
-- match control page (unity-match.html) for THAT match only, to keep the score, goals and scorers, yellow and
-- red cards, the clock and the status.
--
--   * A match can have several links (give each a label, e.g. "Sam, pitch 1"), and each can be switched off,
--     replaced with a new one or removed on its own. Replacing or removing a link stops the old one at once.
--   * A link can ONLY do things for its own match: goals, scorers, cards, the clock, the score and status. It cannot
--     publish or hide the match, run Man of the Match, see the Man of the Match votes, or touch any other match,
--     team, player, raffle entry or setting. It is checked in the database on every action, not just in the page.
--   * Links stop working by themselves 24 hours after kick-off (or 2 days after the event date if the match has no
--     kick-off time), and are cleared with the other old data (Settings -> Clean up old data).
--   * The link is the password: it is shown only to the committee, opens through "#" (so it is not sent to the
--     web server or to other sites), and the page is kept out of search engines.
--
-- How it works under the hood: a link holder calls unity_match_open / unity_match_do. They check the link, then run
-- the same committee functions as the match page (unity_admin_add_goal and so on) with a one-transaction marker that
-- names the one match the link is for, and refuse anything that isn't for that match. unity__require_admin() now
-- also accepts that marker. Nothing else can set the marker, and the committee functions are still not callable by
-- visitors directly.
--
-- Needs 114, 116 and 126. Safe to run more than once.

begin;

create table if not exists public.unity_match_links (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.unity_fixtures (id) on delete cascade,
  token text not null unique check (token ~ '^[0-9a-f]{36}$'),
  label text check (label is null or char_length(label) <= 40),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  uses int not null default 0
);
create index if not exists unity_match_links_fixture on public.unity_match_links (fixture_id);
alter table public.unity_match_links enable row level security;
revoke all on public.unity_match_links from anon, authenticated;

-- Replaces 116's committee check (president, or Hub Access to "Dashboard: Unity Cup"). It also lets through a scorer link's one-transaction marker (set only inside unity_match_open /
-- unity_match_do after the link has been checked).
create or replace function public.unity__require_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.unity_can_manage() then return; end if;
  if nullif(current_setting('unity.key_fixture', true), '') is not null then return; end if;
  raise exception 'Not allowed.' using errcode = '42501';
end;
$$;
revoke all on function public.unity__require_admin() from public, anon;
grant execute on function public.unity__require_admin() to authenticated;

-- Is this link usable right now? Returns {ok, fixture_id, link_id, label, expires_at} or {ok:false, error}.
create or replace function public.unity__match_key(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare l public.unity_match_links%rowtype; f public.unity_fixtures%rowtype; v_end timestamptz;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' then return jsonb_build_object('ok', false, 'error', 'bad_link'); end if;
  select * into l from public.unity_match_links where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'bad_link'); end if;
  if not l.enabled then return jsonb_build_object('ok', false, 'error', 'link_off'); end if;
  select * into f from public.unity_fixtures where id = l.fixture_id;
  v_end := coalesce(f.kickoff_at + interval '24 hours', (select event_date::timestamptz + interval '2 days' from public.unity_settings where id = 1));
  if v_end is not null and now() >= v_end then return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  return jsonb_build_object('ok', true, 'fixture_id', l.fixture_id, 'link_id', l.id, 'label', l.label, 'expires_at', v_end);
end;
$$;
revoke all on function public.unity__match_key(text) from public, anon, authenticated;

-- Link holder: everything the match page needs (the same as the committee's, without Man of the Match votes or links).
create or replace function public.unity_match_open(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare k jsonb; d jsonb;
begin
  k := public.unity__match_key(p_key);
  if not (k->>'ok')::boolean then return k; end if;
  update public.unity_match_links set last_used_at = now()
   where id = (k->>'link_id')::uuid and (last_used_at is null or last_used_at < now() - interval '30 seconds');
  perform set_config('unity.key_fixture', k->>'fixture_id', true);
  d := public.unity_admin_match((k->>'fixture_id')::uuid) - 'mom_votes' - 'mom_voters' - 'links' - 'link_expires_at';
  return d || jsonb_build_object('ok', true, 'label', k->'label', 'expires_at', k->'expires_at');
end;
$$;
revoke all on function public.unity_match_open(text) from public;
grant execute on function public.unity_match_open(text) to anon, authenticated;

-- Link holder: do one thing, for this link's match only. p_action is one of add_goal, remove_goal, set_goal_scorer,
-- add_card, remove_card, set_clock, set_score; p_args uses the same names as the committee functions.
create or replace function public.unity_match_do(p_key text, p_action text, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  k jsonb; fid uuid; a jsonb := coalesce(p_args, '{}'::jsonb);
  g public.unity_goals%rowtype; c public.unity_cards%rowtype; v_res jsonb;
begin
  k := public.unity__match_key(p_key);
  if not (k->>'ok')::boolean then return k; end if;
  fid := (k->>'fixture_id')::uuid;
  update public.unity_match_links set uses = uses + 1, last_used_at = now() where id = (k->>'link_id')::uuid;
  perform set_config('unity.key_fixture', fid::text, true);

  if p_action = 'add_goal' then
    if (a->>'p_fixture')::uuid is distinct from fid then raise exception 'Not allowed.' using errcode = '42501'; end if;
    return jsonb_build_object('ok', true, 'data', to_jsonb(public.unity_admin_add_goal(fid, (a->>'p_team')::uuid, nullif(a->>'p_player', '')::uuid, nullif(a->>'p_name', ''), nullif(a->>'p_minute', '')::int, coalesce((a->>'p_bump')::boolean, true))));
  elsif p_action = 'remove_goal' then
    select * into g from public.unity_goals where id = (a->>'p_id')::uuid;
    if found and g.fixture_id <> fid then raise exception 'Not allowed.' using errcode = '42501'; end if;
    perform public.unity_admin_remove_goal((a->>'p_id')::uuid);
  elsif p_action = 'set_goal_scorer' then
    select * into g from public.unity_goals where id = (a->>'p_id')::uuid;
    if not found or g.fixture_id <> fid then raise exception 'Not allowed.' using errcode = '42501'; end if;
    perform public.unity_admin_set_goal_scorer((a->>'p_id')::uuid, nullif(a->>'p_player', '')::uuid, nullif(a->>'p_name', ''), nullif(a->>'p_minute', '')::int);
  elsif p_action = 'add_card' then
    if (a->>'p_fixture')::uuid is distinct from fid then raise exception 'Not allowed.' using errcode = '42501'; end if;
    v_res := public.unity_admin_add_card(fid, (a->>'p_team')::uuid, nullif(a->>'p_player', '')::uuid, nullif(a->>'p_name', ''), a->>'p_kind', nullif(a->>'p_minute', '')::int);
    return jsonb_build_object('ok', true, 'data', v_res);
  elsif p_action = 'remove_card' then
    select * into c from public.unity_cards where id = (a->>'p_id')::uuid;
    if found and c.fixture_id <> fid then raise exception 'Not allowed.' using errcode = '42501'; end if;
    perform public.unity_admin_remove_card((a->>'p_id')::uuid);
  elsif p_action = 'set_clock' then
    if (a->>'p_id')::uuid is distinct from fid then raise exception 'Not allowed.' using errcode = '42501'; end if;
    perform public.unity_admin_set_clock(fid, a->>'p_action');
  elsif p_action = 'set_score' then
    if (a->>'p_id')::uuid is distinct from fid then raise exception 'Not allowed.' using errcode = '42501'; end if;
    perform public.unity_admin_set_score(fid, (a->>'p_home_score')::int, (a->>'p_away_score')::int, a->>'p_status');
  else
    raise exception 'Unknown action.';
  end if;
  return jsonb_build_object('ok', true, 'data', null);
end;
$$;
revoke all on function public.unity_match_do(text, text, jsonb) from public;
grant execute on function public.unity_match_do(text, text, jsonb) to anon, authenticated;

-- Committee: make, rename, switch off / on, replace or remove a link.
create or replace function public.unity_admin_match_link(p_fixture uuid, p_action text, p_label text default null, p_link uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare l public.unity_match_links%rowtype; v_label text := nullif(left(btrim(coalesce(p_label, '')), 40), '');
begin
  perform public.unity__require_admin();
  if not exists (select 1 from public.unity_fixtures where id = p_fixture) then raise exception 'That match no longer exists.'; end if;
  if p_action = 'create' then
    if (select count(*) from public.unity_match_links where fixture_id = p_fixture) >= 10 then raise exception 'That match already has 10 links. Remove one first.'; end if;
    insert into public.unity_match_links (fixture_id, token, label) values (p_fixture, public.unity__new_token(), v_label) returning * into l;
    return to_jsonb(l);
  end if;
  select * into l from public.unity_match_links where id = p_link and fixture_id = p_fixture;
  if not found then raise exception 'That link no longer exists.'; end if;
  if p_action = 'rename' then
    update public.unity_match_links set label = v_label where id = l.id returning * into l;
  elsif p_action = 'enable' or p_action = 'disable' then
    update public.unity_match_links set enabled = (p_action = 'enable') where id = l.id returning * into l;
  elsif p_action = 'regenerate' then
    update public.unity_match_links set token = public.unity__new_token(), enabled = true, last_used_at = null, uses = 0 where id = l.id returning * into l;
  elsif p_action = 'remove' then
    delete from public.unity_match_links where id = l.id;
    return jsonb_build_object('removed', true);
  else
    raise exception 'Unknown action.';
  end if;
  return to_jsonb(l);
end;
$$;
revoke all on function public.unity_admin_match_link(uuid, text, text, uuid) from public, anon;
grant execute on function public.unity_admin_match_link(uuid, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Replaced functions (same as 126, plus the links)
-- Committee match page data: adds this match's links and when they stop working.
create or replace function public.unity_admin_match(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare f public.unity_fixtures%rowtype;
begin
  perform public.unity__require_admin();
  select * into f from public.unity_fixtures where id = p_id;
  if not found then return jsonb_build_object('missing', true, 'server_now', now()); end if;
  return jsonb_build_object(
    'server_now', now(),
    'fixture', to_jsonb(f),
    'teams', coalesce((select jsonb_agg(to_jsonb(t) order by (t.id = f.home_team_id) desc) from public.unity_teams t where t.id in (f.home_team_id, f.away_team_id)), '[]'::jsonb),
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'team_id', p.team_id, 'shirt_no', p.shirt_no, 'position', p.position, 'captain', p.captain)
                                          order by p.sort, p.name)
                           from public.unity_players p where p.active and p.team_id in (f.home_team_id, f.away_team_id)), '[]'::jsonb),
    'goals', coalesce((select jsonb_agg(to_jsonb(g) order by g.minute nulls last, g.created_at) from public.unity_goals g where g.fixture_id = f.id), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from public.unity_cards c where c.fixture_id = f.id), '[]'::jsonb),
    'mom_votes', coalesce((select jsonb_agg(jsonb_build_object('player_id', t.player_id, 'votes', t.votes) order by t.votes desc) from public.unity_mom_tally t where t.fixture_id = f.id), '[]'::jsonb),
    'mom_voters', (select count(*) from public.unity_mom_ballots b where b.fixture_id = f.id),
    'links', coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at) from public.unity_match_links l where l.fixture_id = f.id), '[]'::jsonb),
    'link_expires_at', coalesce(f.kickoff_at + interval '24 hours', (select event_date::timestamptz + interval '2 days' from public.unity_settings where id = 1))
  );
end;
$$;
revoke all on function public.unity_admin_match(uuid) from public, anon;
grant execute on function public.unity_admin_match(uuid) to authenticated;

-- Committee view of everything: adds all the match links.
create or replace function public.unity_admin_get()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare s public.unity_settings%rowtype;
begin
  perform public.unity__require_admin();
  select * into s from public.unity_settings where id = 1;
  return jsonb_build_object(
    'settings', to_jsonb(s) - 'salt',
    'teams', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort, t.name) from public.unity_teams t), '[]'::jsonb),
    'team_links', coalesce((select jsonb_agg(to_jsonb(l)) from public.unity_team_links l), '[]'::jsonb),
    'team_edits', coalesce((select jsonb_agg(to_jsonb(e) order by e.at desc) from (select * from public.unity_team_edits order by at desc limit 60) e), '[]'::jsonb),
    'fixtures', coalesce((select jsonb_agg(to_jsonb(f) order by f.kickoff_at nulls last, f.sort, f.created_at) from public.unity_fixtures f), '[]'::jsonb),
    'players', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort, p.name) from public.unity_players p), '[]'::jsonb),
    'goals', coalesce((select jsonb_agg(to_jsonb(g) order by g.minute nulls last, g.created_at) from public.unity_goals g), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(to_jsonb(c) order by c.minute nulls last, c.created_at) from public.unity_cards c), '[]'::jsonb),
    'mom_votes', coalesce((select jsonb_agg(jsonb_build_object('fixture_id', t.fixture_id, 'player_id', t.player_id, 'votes', t.votes)) from public.unity_mom_tally t), '[]'::jsonb),
    'match_links', coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at) from public.unity_match_links l), '[]'::jsonb),
    'server_now', now(),
    'voters', (select count(*) from public.unity_voters),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'ticket_no', e.ticket_no, 'name', e.name, 'email', e.email, 'donor_name', e.donor_name,
                'amount', e.amount, 'status', e.status, 'note', e.note, 'created_at', e.created_at,
                'won', exists (select 1 from public.unity_raffle_draws d where d.entry_id = e.id and d.voided_at is null)) order by e.ticket_no)
                from public.unity_raffle_entries e), '[]'::jsonb),
    'draws', coalesce((select jsonb_agg(to_jsonb(d) order by d.drawn_at desc) from public.unity_raffle_draws d), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc) from public.unity_media m where m.status <> 'rejected'), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.unity_admin_get() from public, anon;
grant execute on function public.unity_admin_get() to authenticated;

create or replace function public.unity_purge(p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.unity_settings%rowtype;
  v_limit timestamptz; v_files jsonb;
begin
  if auth.uid() is not null then perform public.unity__require_admin(); end if;
  select * into s from public.unity_settings where id = 1;
  v_limit := (s.event_date + 30)::timestamptz;
  delete from public.unity_codes where created_at < now() - interval '1 day';
  if now() >= v_limit or p_force then
    delete from public.unity_voters where true;
    delete from public.unity_match_links where true;   -- scorer links stop working long before this anyway
    delete from public.unity_mom_voters where true;   -- also clears their sign-in tokens and who-voted-in-which-match
    delete from public.unity_raffle_entries where true;
    delete from public.unity_team_edits where true;
  end if;
  if now() >= (s.event_date + 90)::timestamptz then
    delete from public.unity_team_links where true;
    delete from public.unity_players where true;
  end if;
  select coalesce(jsonb_agg(m.storage_path), '[]'::jsonb) into v_files
    from public.unity_media m where m.status <> 'approved' and m.created_at < now() - interval '30 days';
  delete from public.unity_media m where m.status <> 'approved' and m.created_at < now() - interval '30 days';
  return jsonb_build_object('ok', true, 'files', v_files, 'entries_cleared', (now() >= v_limit or p_force));
end;
$$;
revoke all on function public.unity_purge(boolean) from public, anon;
grant execute on function public.unity_purge(boolean) to authenticated;

commit;
