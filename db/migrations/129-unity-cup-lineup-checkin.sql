-- 129: Unity Cup - line-ups on the match page, with a referee check-in
--
-- On the match page (committee, scorer links and referee links) there is now a Line-ups view: each team's players
-- with shirt number, position and captain, and a tick for every player the referee has confirmed is on the pitch.
-- The ticks are saved per match, shared by everyone running that match (two phones show the same ticks within about
-- 5 seconds), and shown on a pitch picture of the confirmed players. Sent-off and sin-binned players are flagged.
-- Ticks are private to the committee and the people with a link; they are not shown on the public page.
--
--   * unity_lineup_checks            one row per (match, player) that has been confirmed
--   * unity_admin_set_lineup         confirm / un-confirm one player
--   * unity_admin_set_lineup_team    confirm / clear a whole team ("Everyone's here")
--   * unity_admin_match              replaced: also returns the confirmed players ("lineup")
--   * unity_match_do                 replaced: scorer and referee links may use the two functions above for their match(es)
--
-- Needs 126, 127 and 128. Safe to run more than once.

begin;

create table if not exists public.unity_lineup_checks (
  fixture_id uuid not null references public.unity_fixtures (id) on delete cascade,
  player_id uuid not null references public.unity_players (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (fixture_id, player_id)
);
alter table public.unity_lineup_checks enable row level security;
revoke all on public.unity_lineup_checks from anon, authenticated;

create or replace function public.unity_admin_set_lineup(p_fixture uuid, p_player uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare f public.unity_fixtures%rowtype; pl public.unity_players%rowtype;
begin
  perform public.unity__require_admin();
  select * into f from public.unity_fixtures where id = p_fixture;
  if not found then raise exception 'That match no longer exists.'; end if;
  select * into pl from public.unity_players where id = p_player and active;
  if not found then raise exception 'That player isn''t on the squad list any more.'; end if;
  if pl.team_id is distinct from f.home_team_id and pl.team_id is distinct from f.away_team_id then raise exception 'That player is not in either team in this match.'; end if;
  if p_on then
    insert into public.unity_lineup_checks (fixture_id, player_id) values (p_fixture, p_player) on conflict do nothing;
  else
    delete from public.unity_lineup_checks where fixture_id = p_fixture and player_id = p_player;
  end if;
end;
$$;
revoke all on function public.unity_admin_set_lineup(uuid, uuid, boolean) from public, anon;
grant execute on function public.unity_admin_set_lineup(uuid, uuid, boolean) to authenticated;

create or replace function public.unity_admin_set_lineup_team(p_fixture uuid, p_team uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare f public.unity_fixtures%rowtype;
begin
  perform public.unity__require_admin();
  select * into f from public.unity_fixtures where id = p_fixture;
  if not found then raise exception 'That match no longer exists.'; end if;
  if p_team is distinct from f.home_team_id and p_team is distinct from f.away_team_id then raise exception 'Pick one of the two teams in this match.'; end if;
  if p_on then
    insert into public.unity_lineup_checks (fixture_id, player_id)
    select p_fixture, p.id from public.unity_players p where p.team_id = p_team and p.active
    on conflict do nothing;
  else
    delete from public.unity_lineup_checks c using public.unity_players p
     where c.fixture_id = p_fixture and c.player_id = p.id and p.team_id = p_team;
  end if;
end;
$$;
revoke all on function public.unity_admin_set_lineup_team(uuid, uuid, boolean) from public, anon;
grant execute on function public.unity_admin_set_lineup_team(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Replaced functions (same as before, plus the line-up)
-- Match page data: adds the confirmed players ("lineup").
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
    'lineup', coalesce((select jsonb_agg(c.player_id) from public.unity_lineup_checks c where c.fixture_id = f.id), '[]'::jsonb),
    'links', coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at) from public.unity_match_links l where l.fixture_id = f.id), '[]'::jsonb),
    'link_expires_at', coalesce(f.kickoff_at + interval '24 hours', (select event_date::timestamptz + interval '2 days' from public.unity_settings where id = 1))
  );
end;
$$;
revoke all on function public.unity_admin_match(uuid) from public, anon;
grant execute on function public.unity_admin_match(uuid) to authenticated;

-- Scorer and referee links: adds the two line-up actions.
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
  if p_action in ('add_goal', 'add_card', 'set_lineup', 'set_lineup_team') then target := (a->>'p_fixture')::uuid;
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
  elsif p_action = 'set_lineup' then
    perform public.unity_admin_set_lineup(target, (a->>'p_player')::uuid, coalesce((a->>'p_on')::boolean, true));
  elsif p_action = 'set_lineup_team' then
    perform public.unity_admin_set_lineup_team(target, (a->>'p_team')::uuid, coalesce((a->>'p_on')::boolean, true));
  end if;
  return jsonb_build_object('ok', true, 'data', null);
end;
$$;
revoke all on function public.unity_match_do(text, text, jsonb) from public;
grant execute on function public.unity_match_do(text, text, jsonb) to anon, authenticated;

commit;
