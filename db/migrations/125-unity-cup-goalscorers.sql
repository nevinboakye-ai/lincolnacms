-- 125: Unity Cup - who scored
--
-- Until now the committee could only type in a score. Now every goal can say who scored it:
--   * In the dashboard (Unity Cup -> Fixtures) tapping + on a team opens a search box listing the players of
--     the two teams in that match. One tap on a name records the goal and moves the score up by one.
--   * Tapping - takes the most recent goal for that team back off (and the score goes down by one).
--   * In the All fixtures list each match has a Goalscorers box, which also fills in scorers for a result
--     that was typed in earlier without changing the score.
--   * A goal can be added without a name and filled in later, a name can be typed for someone who is not on
--     the squad list, and a player picked from the other team is recorded as an own goal (it counts for the
--     team they were playing against).
--   * The public Fixtures page shows the scorers under the score, for fixtures that are public only.
--
-- The score is still the score. Typing a score in by hand still works and never touches the goal list, so
-- a match can have a result with no scorers recorded.
--
-- One new table (unity_goals) and four committee-only functions. unity_get_state and unity_admin_get are
-- replaced with the same contents plus the goals. Needs 115, 116, 120 and 122. Safe to run more than once.

begin;

create table if not exists public.unity_goals (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.unity_fixtures (id) on delete cascade,
  -- the team the goal COUNTS for (for an own goal this is the other team to the scorer's)
  team_id uuid not null references public.unity_teams (id) on delete cascade,
  player_id uuid references public.unity_players (id) on delete set null,
  -- the name as typed, or a copy of the player's name, so the goal still reads right if the player is deleted
  scorer_name text check (scorer_name is null or char_length(scorer_name) <= 60),
  own_goal boolean not null default false,
  minute int check (minute is null or minute between 0 and 150),
  created_at timestamptz not null default now()
);
create index if not exists unity_goals_fixture on public.unity_goals (fixture_id, minute, created_at);
alter table public.unity_goals enable row level security;
revoke all on public.unity_goals from anon, authenticated;

-- Record a goal and move the score up by one. A match that has not started yet goes live.
-- p_player = a player from either team in the match (an own goal is worked out from their team),
-- p_name = a typed name for someone who is not on the list, both empty = "scorer not recorded yet".
-- p_bump = false is for filling in a scorer for a goal that is already in the score (for example a result that
-- was typed in before scorers were recorded): the goal is listed but the score and status are left alone. It is
-- refused if the team has no goal without a scorer left.
create or replace function public.unity_admin_add_goal(p_fixture uuid, p_team uuid, p_player uuid default null, p_name text default null, p_minute int default null, p_bump boolean default true)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.unity_fixtures%rowtype; pl public.unity_players%rowtype;
  v_name text; v_own boolean := false; v_id uuid; v_home boolean;
begin
  perform public.unity__require_admin();
  select * into f from public.unity_fixtures where id = p_fixture for update;
  if not found then raise exception 'That match no longer exists.'; end if;
  if p_team is distinct from f.home_team_id and p_team is distinct from f.away_team_id then raise exception 'Pick one of the two teams in this match.'; end if;
  if p_minute is not null and (p_minute < 0 or p_minute > 150) then raise exception 'The minute must be between 0 and 150.'; end if;
  v_home := p_team = f.home_team_id;
  if p_bump and coalesce(case when v_home then f.home_score else f.away_score end, 0) >= 99 then raise exception 'A score can''t go above 99.'; end if;
  if not p_bump and (select count(*) from public.unity_goals where fixture_id = p_fixture and team_id = p_team) >= coalesce(case when v_home then f.home_score else f.away_score end, 0) then
    raise exception 'Every goal in the score for this team already has a scorer listed.';
  end if;
  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if p_player is not null then
    select * into pl from public.unity_players where id = p_player;
    if not found then raise exception 'That player no longer exists.'; end if;
    if pl.team_id is distinct from f.home_team_id and pl.team_id is distinct from f.away_team_id then raise exception 'That player is not in either team in this match.'; end if;
    v_own := pl.team_id <> p_team;
    v_name := pl.name;
  end if;
  insert into public.unity_goals (fixture_id, team_id, player_id, scorer_name, own_goal, minute)
  values (p_fixture, p_team, p_player, left(v_name, 60), v_own, p_minute) returning id into v_id;
  if p_bump then
    update public.unity_fixtures set
      home_score = coalesce(home_score, 0) + case when v_home then 1 else 0 end,
      away_score = coalesce(away_score, 0) + case when v_home then 0 else 1 end,
      status = case when status = 'scheduled' then 'live' else status end
     where id = p_fixture;
  end if;
  return v_id;
end;
$$;
revoke all on function public.unity_admin_add_goal(uuid, uuid, uuid, text, int, boolean) from public, anon;
grant execute on function public.unity_admin_add_goal(uuid, uuid, uuid, text, int, boolean) to authenticated;

-- Take a goal back off: it is deleted and that team's score goes down by one (never below 0).
create or replace function public.unity_admin_remove_goal(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare g public.unity_goals%rowtype; f public.unity_fixtures%rowtype;
begin
  perform public.unity__require_admin();
  select * into g from public.unity_goals where id = p_id;
  if not found then return; end if;
  select * into f from public.unity_fixtures where id = g.fixture_id for update;
  delete from public.unity_goals where id = p_id;
  if found then
    update public.unity_fixtures set
      home_score = case when g.team_id = f.home_team_id then greatest(coalesce(f.home_score, 0) - 1, 0) else f.home_score end,
      away_score = case when g.team_id = f.away_team_id then greatest(coalesce(f.away_score, 0) - 1, 0) else f.away_score end
     where id = g.fixture_id;
  end if;
end;
$$;
revoke all on function public.unity_admin_remove_goal(uuid) from public, anon;
grant execute on function public.unity_admin_remove_goal(uuid) to authenticated;

-- Change who scored (or the minute) on a goal already recorded. The score is not touched.
-- Leave both p_player and p_name empty to clear the scorer.
create or replace function public.unity_admin_set_goal_scorer(p_id uuid, p_player uuid default null, p_name text default null, p_minute int default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare g public.unity_goals%rowtype; f public.unity_fixtures%rowtype; pl public.unity_players%rowtype; v_name text; v_own boolean := false;
begin
  perform public.unity__require_admin();
  select * into g from public.unity_goals where id = p_id;
  if not found then raise exception 'That goal no longer exists.'; end if;
  select * into f from public.unity_fixtures where id = g.fixture_id;
  if p_minute is not null and (p_minute < 0 or p_minute > 150) then raise exception 'The minute must be between 0 and 150.'; end if;
  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if p_player is not null then
    select * into pl from public.unity_players where id = p_player;
    if not found then raise exception 'That player no longer exists.'; end if;
    if pl.team_id is distinct from f.home_team_id and pl.team_id is distinct from f.away_team_id then raise exception 'That player is not in either team in this match.'; end if;
    v_own := pl.team_id <> g.team_id;
    v_name := pl.name;
  end if;
  update public.unity_goals set player_id = p_player, scorer_name = left(v_name, 60), own_goal = v_own, minute = p_minute where id = p_id;
end;
$$;
revoke all on function public.unity_admin_set_goal_scorer(uuid, uuid, text, int) from public, anon;
grant execute on function public.unity_admin_set_goal_scorer(uuid, uuid, text, int) to authenticated;

-- Public state: same as 122, plus the scorers on each fixture (only goals with a name, only public fixtures).
create or replace function public.unity_get_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.unity_settings%rowtype;
  v_vote_open boolean; v_raffle_open boolean; v_total int;
begin
  select * into s from public.unity_settings where id = 1;
  v_vote_open := s.voting_open and (s.voting_closes_at is null or now() < s.voting_closes_at);
  v_raffle_open := s.raffle_open and (s.raffle_closes_at is null or now() < s.raffle_closes_at);
  select coalesce(sum(votes), 0) into v_total from public.unity_players where active;
  return jsonb_build_object(
    'now', now(),
    'event_title', s.event_title,
    'event_date', s.event_date,
    'kickoff_text', s.kickoff_text,
    'venue_text', s.venue_text,
    'voting_open', v_vote_open,
    'voting_closes_at', s.voting_closes_at,
    'show_results', s.show_results,
    'raffle_open', v_raffle_open,
    'raffle_closes_at', s.raffle_closes_at,
    'media_open', s.media_open,
    'require_email_code', s.require_email_code,
    'min_donation', s.min_donation,
    'prize_text', s.prize_text,
    'justgiving_url', s.justgiving_url,
    'total_votes', case when s.show_results then v_total else null end,
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'short_name', t.short_name, 'colour', t.colour,
                                          'logo_path', t.logo_path, 'group_name', t.group_name, 'description', t.description)
                       order by t.sort, t.name)
        from public.unity_teams t), '[]'::jsonb),
    'fixtures', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'stage', f.stage, 'home_team_id', f.home_team_id, 'away_team_id', f.away_team_id,
                                          'kickoff_at', f.kickoff_at, 'pitch', f.pitch, 'status', f.status,
                                          'home_score', f.home_score, 'away_score', f.away_score, 'note', f.note,
                                          'goals', coalesce((
                                            select jsonb_agg(jsonb_build_object('id', g.id, 'team_id', g.team_id, 'player_id', g.player_id,
                                                                                'name', coalesce(gp.name, g.scorer_name), 'own_goal', g.own_goal, 'minute', g.minute)
                                                             order by g.minute nulls last, g.created_at)
                                              from public.unity_goals g left join public.unity_players gp on gp.id = g.player_id
                                             where g.fixture_id = f.id and coalesce(gp.name, g.scorer_name) is not null), '[]'::jsonb))
                       order by f.kickoff_at nulls last, f.sort, f.created_at)
        from public.unity_fixtures f
       where f.publish_at is not null and f.publish_at <= now()), '[]'::jsonb),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', p.name, 'team', coalesce(t.name, p.team), 'team_id', p.team_id, 'shirt_no', p.shirt_no, 'position', p.position, 'captain', p.captain,
               'votes', case when s.show_results then p.votes else null end)
             order by case when s.show_results then p.votes else 0 end desc, p.sort, p.name)
        from public.unity_players p left join public.unity_teams t on t.id = p.team_id where p.active), '[]'::jsonb),
    'raffle_entries', (select count(*) from public.unity_raffle_entries e where e.status <> 'rejected'),
    'tickets', coalesce((select jsonb_agg(e.ticket_no order by e.ticket_no)
                           from (select ticket_no from public.unity_raffle_entries where status = 'verified' order by ticket_no limit 300) e), '[]'::jsonb),
    'draws', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'ticket_no', d.ticket_no, 'name', d.display_name, 'prize', d.prize, 'drawn_at', d.drawn_at) order by d.drawn_at desc)
                         from public.unity_raffle_draws d where d.voided_at is null), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(jsonb_build_object('path', m.public_path, 'kind', m.kind, 'caption', m.caption, 'credit', m.credit) order by m.approved_at desc)
                         from (select * from public.unity_media where status = 'approved' and public_path is not null order by approved_at desc limit 80) m), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.unity_get_state() from public;
grant execute on function public.unity_get_state() to anon, authenticated;

-- Committee view: same as 116, plus the goals.
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

commit;
