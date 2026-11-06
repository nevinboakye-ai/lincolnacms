-- 128: Unity Cup - referee links that cover EVERY match
--
-- 127 gave each match its own private scorer link. A tournament has only a couple of referees who move from
-- game to game, so a link can now cover the whole tournament:
--
--   * "Referee link" (all matches): the person opens it, sees the list of matches (live first, then coming up, then
--     finished), taps the game they are about to ref and gets the match control page for it. A "All matches" button takes
--     them back to the list for the next game. Make one per referee (label each: "Ref 1", "Ref 2") so you can see who
--     is using which and switch one off on its own.
--   * A link that is for one match only still works exactly as before (made from that match's page).
--
-- What a referee link can do is the same as a single-match link, for ANY match: goals and scorers, cards, the clock,
-- the score and status. It still cannot publish or hide a match, run or see Man of the Match, edit teams, players or
-- settings, or make links. Every action is checked in the database. All-match links stop working 2 days after the
-- event date (single-match links keep their 24 hours after kick-off) and are cleared by "Clean up old data".
--
-- Needs 127. Safe to run more than once.

begin;

-- fixture_id null = the link covers every match
alter table public.unity_match_links alter column fixture_id drop not null;

-- Is this link usable right now?
-- Returns {ok, scope ('match' | 'all'), fixture_id (null for all), link_id, label, expires_at} or {ok:false, error}.
create or replace function public.unity__match_key(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare l public.unity_match_links%rowtype; f public.unity_fixtures%rowtype; v_end timestamptz; v_event timestamptz;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' then return jsonb_build_object('ok', false, 'error', 'bad_link'); end if;
  select * into l from public.unity_match_links where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'bad_link'); end if;
  if not l.enabled then return jsonb_build_object('ok', false, 'error', 'link_off'); end if;
  select event_date::timestamptz + interval '2 days' into v_event from public.unity_settings where id = 1;
  if l.fixture_id is null then
    v_end := v_event;
  else
    select * into f from public.unity_fixtures where id = l.fixture_id;
    v_end := coalesce(f.kickoff_at + interval '24 hours', v_event);
  end if;
  if v_end is not null and now() >= v_end then return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  return jsonb_build_object('ok', true, 'scope', case when l.fixture_id is null then 'all' else 'match' end,
                            'fixture_id', l.fixture_id, 'link_id', l.id, 'label', l.label, 'expires_at', v_end);
end;
$$;
revoke all on function public.unity__match_key(text) from public, anon, authenticated;

-- Link holder: open the list of matches (referee link, no p_fixture) or one match (p_fixture, or the link's own match).
drop function if exists public.unity_match_open(text);
create or replace function public.unity_match_open(p_key text, p_fixture uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare k jsonb; d jsonb; fid uuid;
begin
  k := public.unity__match_key(p_key);
  if not (k->>'ok')::boolean then return k; end if;
  update public.unity_match_links set last_used_at = now()
   where id = (k->>'link_id')::uuid and (last_used_at is null or last_used_at < now() - interval '30 seconds');
  if (k->>'scope') = 'all' then
    if p_fixture is null then
      -- the list a referee picks their game from
      return jsonb_build_object('ok', true, 'scope', 'all', 'label', k->'label', 'expires_at', k->'expires_at', 'server_now', now(),
        'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'short_name', t.short_name, 'colour', t.colour, 'logo_path', t.logo_path) order by t.sort, t.name)
                             from public.unity_teams t), '[]'::jsonb),
        'fixtures', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'stage', f.stage, 'home_team_id', f.home_team_id, 'away_team_id', f.away_team_id,
                                                                'kickoff_at', f.kickoff_at, 'pitch', f.pitch, 'status', f.status, 'home_score', f.home_score, 'away_score', f.away_score)
                                               order by f.kickoff_at nulls last, f.sort, f.created_at)
                                from public.unity_fixtures f), '[]'::jsonb));
    end if;
    if not exists (select 1 from public.unity_fixtures where id = p_fixture) then return jsonb_build_object('ok', false, 'error', 'no_match'); end if;
    fid := p_fixture;
  else
    fid := (k->>'fixture_id')::uuid;
  end if;
  perform set_config('unity.key_fixture', fid::text, true);
  d := public.unity_admin_match(fid) - 'mom_votes' - 'mom_voters' - 'links' - 'link_expires_at';
  return d || jsonb_build_object('ok', true, 'label', k->'label', 'expires_at', k->'expires_at', 'scope', k->'scope');
end;
$$;
revoke all on function public.unity_match_open(text, uuid) from public;
grant execute on function public.unity_match_open(text, uuid) to anon, authenticated;

-- Link holder: do one thing. p_action is one of add_goal, remove_goal, set_goal_scorer, add_card, remove_card,
-- set_clock, set_score. A single-match link may only act on its own match; a referee link on any match.
create or replace function public.unity_match_do(p_key text, p_action text, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  k jsonb; lk uuid; target uuid; a jsonb := coalesce(p_args, '{}'::jsonb); v_res jsonb;
begin
  k := public.unity__match_key(p_key);
  if not (k->>'ok')::boolean then return k; end if;
  lk := (k->>'fixture_id')::uuid;          -- null for a referee link

  -- which match is this action about?
  if p_action in ('add_goal', 'add_card') then target := (a->>'p_fixture')::uuid;
  elsif p_action in ('set_clock', 'set_score') then target := (a->>'p_id')::uuid;
  elsif p_action in ('remove_goal', 'set_goal_scorer') then select fixture_id into target from public.unity_goals where id = (a->>'p_id')::uuid;
  elsif p_action = 'remove_card' then select fixture_id into target from public.unity_cards where id = (a->>'p_id')::uuid;
  else raise exception 'Unknown action.';
  end if;
  -- taking off a goal or card that is already gone is nothing to do
  if target is null and p_action in ('remove_goal', 'remove_card') then return jsonb_build_object('ok', true, 'data', null); end if;
  if target is null or (lk is not null and target <> lk) then raise exception 'Not allowed.' using errcode = '42501'; end if;

  update public.unity_match_links set uses = uses + 1, last_used_at = now() where id = (k->>'link_id')::uuid;
  perform set_config('unity.key_fixture', target::text, true);

  if p_action = 'add_goal' then
    return jsonb_build_object('ok', true, 'data', to_jsonb(public.unity_admin_add_goal(target, (a->>'p_team')::uuid, nullif(a->>'p_player', '')::uuid, nullif(a->>'p_name', ''), nullif(a->>'p_minute', '')::int, coalesce((a->>'p_bump')::boolean, true))));
  elsif p_action = 'remove_goal' then
    perform public.unity_admin_remove_goal((a->>'p_id')::uuid);
  elsif p_action = 'set_goal_scorer' then
    perform public.unity_admin_set_goal_scorer((a->>'p_id')::uuid, nullif(a->>'p_player', '')::uuid, nullif(a->>'p_name', ''), nullif(a->>'p_minute', '')::int);
  elsif p_action = 'add_card' then
    v_res := public.unity_admin_add_card(target, (a->>'p_team')::uuid, nullif(a->>'p_player', '')::uuid, nullif(a->>'p_name', ''), a->>'p_kind', nullif(a->>'p_minute', '')::int);
    return jsonb_build_object('ok', true, 'data', v_res);
  elsif p_action = 'remove_card' then
    perform public.unity_admin_remove_card((a->>'p_id')::uuid);
  elsif p_action = 'set_clock' then
    perform public.unity_admin_set_clock(target, a->>'p_action');
  elsif p_action = 'set_score' then
    perform public.unity_admin_set_score(target, (a->>'p_home_score')::int, (a->>'p_away_score')::int, a->>'p_status');
  end if;
  return jsonb_build_object('ok', true, 'data', null);
end;
$$;
revoke all on function public.unity_match_do(text, text, jsonb) from public;
grant execute on function public.unity_match_do(text, text, jsonb) to anon, authenticated;

-- Committee: make, rename, switch off / on, replace or remove a link. p_fixture = a match, or null for a referee link
-- that covers every match.
create or replace function public.unity_admin_match_link(p_fixture uuid, p_action text, p_label text default null, p_link uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare l public.unity_match_links%rowtype; v_label text := nullif(left(btrim(coalesce(p_label, '')), 40), '');
begin
  perform public.unity__require_admin();
  if p_fixture is not null and not exists (select 1 from public.unity_fixtures where id = p_fixture) then raise exception 'That match no longer exists.'; end if;
  if p_action = 'create' then
    if (select count(*) from public.unity_match_links where fixture_id is not distinct from p_fixture) >= 10 then
      raise exception 'That already has 10 links. Remove one first.';
    end if;
    insert into public.unity_match_links (fixture_id, token, label) values (p_fixture, public.unity__new_token(), v_label) returning * into l;
    return to_jsonb(l);
  end if;
  select * into l from public.unity_match_links where id = p_link and fixture_id is not distinct from p_fixture;
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

commit;
