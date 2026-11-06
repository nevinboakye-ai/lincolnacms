-- 126: Unity Cup - match control page, yellow / red cards, match clock, and Man of the Match voting
--
-- 1. The committee gets one page per match (unity-match.html) built for a phone: goals with the scorer, yellow
--    cards (a 2 minute timer), red cards (off for the rest of the game), a match clock, the score and the
--    Man of the Match controls. Behind it:
--      * unity_cards        every yellow / red card (a yellow carries the time it ends: now + 2 minutes)
--      * unity_fixtures     gains clock_started_at / clock_elapsed_s (the clock) and mom_open / mom_show
--    and committee-only functions unity_admin_match, unity_admin_add_card, unity_admin_remove_card,
--    unity_admin_set_clock and unity_admin_set_mom.
--
-- 2. Anyone can vote for Man of the Match in each game on the public page, once per game:
--      * you verify your email ONCE (the same emailed code as the other votes) and your browser is given a private
--        sign-in token, so you can vote in every game without another code;
--      * like the Player of the Tournament vote it is anonymous: we store a scrambled email, which games it has
--        voted in, and a total per player per game, and never who voted for whom;
--      * a game is open for voting while it is live or finished, public, and the committee has not closed it. The
--        committee closes it and reveals the winner from the match page. Results stay hidden until then.
--    The emailed-code edge function (supabase/functions/unity-cup-code) must be re-deployed once so it accepts the
--    new purpose "mom" - paste the updated file in again (see the notes in README-members-setup.md, section 179).
--
-- Replaces unity_get_state, unity_admin_get, unity_request_code and unity_purge with the same contents plus the
-- above. Needs 114 to 116, 120, 122 and 125. Safe to run more than once.

begin;

-- ---------------------------------------------------------------------
-- Fixtures: the match clock and the Man of the Match switches
alter table public.unity_fixtures add column if not exists clock_started_at timestamptz;
alter table public.unity_fixtures add column if not exists clock_elapsed_s int not null default 0;
alter table public.unity_fixtures add column if not exists mom_open boolean not null default true;
alter table public.unity_fixtures add column if not exists mom_show boolean not null default false;

-- ---------------------------------------------------------------------
-- Cards
create table if not exists public.unity_cards (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.unity_fixtures (id) on delete cascade,
  team_id uuid not null references public.unity_teams (id) on delete cascade,
  player_id uuid references public.unity_players (id) on delete set null,
  player_name text check (player_name is null or char_length(player_name) <= 60),
  kind text not null check (kind in ('yellow', 'red')),
  minute int check (minute is null or minute between 0 and 150),
  until_at timestamptz,                     -- yellow only: when the 2 minutes are up
  created_at timestamptz not null default now()
);
create index if not exists unity_cards_fixture on public.unity_cards (fixture_id, created_at);
alter table public.unity_cards enable row level security;
revoke all on public.unity_cards from anon, authenticated;

-- ---------------------------------------------------------------------
-- Man of the Match: who may vote (scrambled email), their private sign-in tokens, which games each has voted in
-- (no choice stored) and the running total per player per game.
create table if not exists public.unity_mom_voters (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null unique,
  created_at timestamptz not null default date_trunc('hour', now())
);
create table if not exists public.unity_mom_tokens (
  token_hash text primary key,
  voter_id uuid not null references public.unity_mom_voters (id) on delete cascade,
  seq bigserial,
  created_at timestamptz not null default date_trunc('hour', now())
);
create table if not exists public.unity_mom_ballots (
  fixture_id uuid not null references public.unity_fixtures (id) on delete cascade,
  voter_id uuid not null references public.unity_mom_voters (id) on delete cascade,
  created_at timestamptz not null default date_trunc('hour', now()),
  primary key (fixture_id, voter_id)
);
create table if not exists public.unity_mom_tally (
  fixture_id uuid not null references public.unity_fixtures (id) on delete cascade,
  player_id uuid not null references public.unity_players (id) on delete cascade,
  votes int not null default 0,
  primary key (fixture_id, player_id)
);
alter table public.unity_mom_voters enable row level security;
alter table public.unity_mom_tokens enable row level security;
alter table public.unity_mom_ballots enable row level security;
alter table public.unity_mom_tally enable row level security;
revoke all on public.unity_mom_voters, public.unity_mom_tokens, public.unity_mom_ballots, public.unity_mom_tally from anon, authenticated;

-- The emailed codes gain a third purpose.
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.unity_codes'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%purpose%' loop
    execute format('alter table public.unity_codes drop constraint %I', c);
  end loop;
  alter table public.unity_codes add constraint unity_codes_purpose_check check (purpose in ('vote', 'raffle', 'mom'));
end $$;

-- Is this game taking Man of the Match votes right now?
create or replace function public.unity_fixture_mom_open(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.unity_fixtures f
                  where f.id = p_id and f.publish_at is not null and f.publish_at <= now()
                    and f.status in ('live', 'finished') and f.mom_open and not f.mom_show);
$$;
revoke all on function public.unity_fixture_mom_open(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Public: sign in to vote (once). Checks the emailed code (unless the committee has switched the check off), and
-- gives back a private token that stays in the visitor's browser.
create or replace function public.unity_mom_verify(p_email text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.unity_settings%rowtype;
  h text; v_err text; v_voter uuid; v_token text;
begin
  select * into s from public.unity_settings where id = 1;
  if not public.unity_email_ok(btrim(p_email)) then return jsonb_build_object('ok', false, 'error', 'bad_email'); end if;
  if public.unity_disposable(p_email) then return jsonb_build_object('ok', false, 'error', 'disposable'); end if;
  h := public.unity_email_hash(p_email);
  if s.require_email_code then
    v_err := public.unity_check_code(h, 'mom', p_code);
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
  end if;
  insert into public.unity_mom_voters (email_hash) values (h) on conflict (email_hash) do nothing;
  select id into v_voter from public.unity_mom_voters where email_hash = h;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.unity_mom_tokens (token_hash, voter_id) values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_voter);
  -- keep the five newest sign-ins per person
  delete from public.unity_mom_tokens
   where voter_id = v_voter
     and token_hash not in (select token_hash from public.unity_mom_tokens where voter_id = v_voter order by seq desc limit 5);
  return jsonb_build_object('ok', true, 'token', v_token,
    'voted', coalesce((select jsonb_agg(b.fixture_id) from public.unity_mom_ballots b where b.voter_id = v_voter), '[]'::jsonb));
end;
$$;
revoke all on function public.unity_mom_verify(text, text) from public;
grant execute on function public.unity_mom_verify(text, text) to anon, authenticated;

-- Public: cast one Man of the Match vote for one game.
create or replace function public.unity_mom_vote(p_token text, p_fixture uuid, p_player uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_voter uuid; f public.unity_fixtures%rowtype; pl public.unity_players%rowtype;
begin
  if p_token is null or char_length(p_token) < 20 then return jsonb_build_object('ok', false, 'error', 'bad_token'); end if;
  select voter_id into v_voter from public.unity_mom_tokens where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if not found then return jsonb_build_object('ok', false, 'error', 'bad_token'); end if;
  select * into f from public.unity_fixtures where id = p_fixture;
  if not found or not public.unity_fixture_mom_open(p_fixture) then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  select * into pl from public.unity_players where id = p_player and active;
  if not found or (pl.team_id is distinct from f.home_team_id and pl.team_id is distinct from f.away_team_id) then
    return jsonb_build_object('ok', false, 'error', 'bad_player');
  end if;
  begin
    insert into public.unity_mom_ballots (fixture_id, voter_id) values (p_fixture, v_voter);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already_voted');
  end;
  insert into public.unity_mom_tally (fixture_id, player_id, votes) values (p_fixture, p_player, 1)
  on conflict (fixture_id, player_id) do update set votes = public.unity_mom_tally.votes + 1;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.unity_mom_vote(text, uuid, uuid) from public;
grant execute on function public.unity_mom_vote(text, uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Committee: everything the match page needs, for one match, in one call.
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
    'mom_voters', (select count(*) from public.unity_mom_ballots b where b.fixture_id = f.id)
  );
end;
$$;
revoke all on function public.unity_admin_match(uuid) from public, anon;
grant execute on function public.unity_admin_match(uuid) to authenticated;

-- Give a yellow or red card. The card goes to the player's own team. A yellow starts a 2 minute timer (until_at);
-- a red is off for the rest of the game. A player already sent off cannot be carded again. A match that has not
-- started goes live.
create or replace function public.unity_admin_add_card(p_fixture uuid, p_team uuid, p_player uuid, p_name text, p_kind text, p_minute int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.unity_fixtures%rowtype; pl public.unity_players%rowtype;
  v_team uuid; v_name text; v_until timestamptz; v_id uuid;
begin
  perform public.unity__require_admin();
  if p_kind not in ('yellow', 'red') then raise exception 'Unknown card.'; end if;
  select * into f from public.unity_fixtures where id = p_fixture for update;
  if not found then raise exception 'That match no longer exists.'; end if;
  if p_minute is not null and (p_minute < 0 or p_minute > 150) then raise exception 'The minute must be between 0 and 150.'; end if;
  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if p_player is not null then
    select * into pl from public.unity_players where id = p_player;
    if not found then raise exception 'That player no longer exists.'; end if;
    if pl.team_id is distinct from f.home_team_id and pl.team_id is distinct from f.away_team_id then raise exception 'That player is not in either team in this match.'; end if;
    v_team := pl.team_id; v_name := pl.name;
  else
    v_team := p_team;
    if v_team is distinct from f.home_team_id and v_team is distinct from f.away_team_id then raise exception 'Pick one of the two teams in this match.'; end if;
    if v_name is null then raise exception 'Pick a player or type a name.'; end if;
  end if;
  if exists (select 1 from public.unity_cards c
              where c.fixture_id = p_fixture and c.kind = 'red' and c.team_id = v_team
                and ((p_player is not null and c.player_id = p_player) or (p_player is null and c.player_id is null and lower(c.player_name) = lower(v_name)))) then
    raise exception 'That player has already been sent off.';
  end if;
  v_until := case when p_kind = 'yellow' then now() + interval '2 minutes' else null end;
  insert into public.unity_cards (fixture_id, team_id, player_id, player_name, kind, minute, until_at)
  values (p_fixture, v_team, p_player, left(v_name, 60), p_kind, p_minute, v_until) returning id into v_id;
  if f.status = 'scheduled' then update public.unity_fixtures set status = 'live' where id = p_fixture; end if;
  return jsonb_build_object('id', v_id, 'until_at', v_until);
end;
$$;
revoke all on function public.unity_admin_add_card(uuid, uuid, uuid, text, text, int) from public, anon;
grant execute on function public.unity_admin_add_card(uuid, uuid, uuid, text, text, int) to authenticated;

create or replace function public.unity_admin_remove_card(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.unity__require_admin();
  delete from public.unity_cards where id = p_id;
end;
$$;
revoke all on function public.unity_admin_remove_card(uuid) from public, anon;
grant execute on function public.unity_admin_remove_card(uuid) to authenticated;

-- The match clock. start = run (a match that has not started goes live), pause = stop and keep the time, reset = back to 0:00.
create or replace function public.unity_admin_set_clock(p_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare f public.unity_fixtures%rowtype;
begin
  perform public.unity__require_admin();
  if p_action not in ('start', 'pause', 'reset') then raise exception 'Unknown clock action.'; end if;
  select * into f from public.unity_fixtures where id = p_id for update;
  if not found then raise exception 'That match no longer exists.'; end if;
  if p_action = 'start' then
    if f.clock_started_at is null then
      update public.unity_fixtures set clock_started_at = now(), status = case when status = 'scheduled' then 'live' else status end where id = p_id;
    end if;
  elsif p_action = 'pause' then
    if f.clock_started_at is not null then
      update public.unity_fixtures
         set clock_elapsed_s = least(86400, clock_elapsed_s + greatest(0, floor(extract(epoch from (now() - f.clock_started_at)))::int)), clock_started_at = null
       where id = p_id;
    end if;
  else
    update public.unity_fixtures set clock_started_at = null, clock_elapsed_s = 0 where id = p_id;
  end if;
end;
$$;
revoke all on function public.unity_admin_set_clock(uuid, text) from public, anon;
grant execute on function public.unity_admin_set_clock(uuid, text) to authenticated;

-- Man of the Match for one game: open (take votes), close (stop, keep results private), reveal (stop and show the
-- winner publicly), hide (take the winner off the public page again; voting stays closed).
create or replace function public.unity_admin_set_mom(p_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.unity__require_admin();
  if p_action = 'open' then update public.unity_fixtures set mom_open = true, mom_show = false where id = p_id;
  elsif p_action = 'close' then update public.unity_fixtures set mom_open = false where id = p_id;
  elsif p_action = 'reveal' then update public.unity_fixtures set mom_open = false, mom_show = true where id = p_id;
  elsif p_action = 'hide' then update public.unity_fixtures set mom_show = false, mom_open = false where id = p_id;
  else raise exception 'Unknown option.'; end if;
end;
$$;
revoke all on function public.unity_admin_set_mom(uuid, text) from public, anon;
grant execute on function public.unity_admin_set_mom(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Replaced functions (same as before, plus the above)
-- Emailed codes: the new purpose "mom" (match voting). Needs a public match that is open for votes.
create or replace function public.unity_request_code(p_email text, p_purpose text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.unity_settings%rowtype;
  h text; v_code text; v_open boolean;
begin
  if p_purpose not in ('vote', 'raffle', 'mom') then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  if not public.unity_email_ok(btrim(p_email)) then return jsonb_build_object('ok', false, 'error', 'bad_email'); end if;
  if public.unity_disposable(p_email) then return jsonb_build_object('ok', false, 'error', 'disposable'); end if;
  select * into s from public.unity_settings where id = 1;
  if p_purpose = 'vote' then
    v_open := s.voting_open and (s.voting_closes_at is null or now() < s.voting_closes_at);
  elsif p_purpose = 'mom' then
    -- match voting: needs at least one public match that is open for it
    v_open := exists (select 1 from public.unity_fixtures f where f.publish_at is not null and f.publish_at <= now() and f.status in ('live', 'finished') and f.mom_open and not f.mom_show);
  else
    v_open := s.raffle_open and (s.raffle_closes_at is null or now() < s.raffle_closes_at);
  end if;
  if not v_open then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  h := public.unity_email_hash(p_email);
  if p_purpose = 'vote' and exists (select 1 from public.unity_voters where email_hash = h) then
    return jsonb_build_object('ok', false, 'error', 'already_voted');
  end if;
  if p_purpose = 'raffle' and exists (select 1 from public.unity_raffle_entries where email_hash = h) then
    return jsonb_build_object('ok', false, 'error', 'already_entered');
  end if;
  if (select count(*) from public.unity_codes where email_hash = h and created_at > now() - interval '15 minutes') >= 3 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  if (select count(*) from public.unity_codes where created_at > now() - interval '10 minutes') >= 600 then
    return jsonb_build_object('ok', false, 'error', 'busy');
  end if;
  v_code := lpad((mod(('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint, 1000000))::text, 6, '0');
  insert into public.unity_codes (email_hash, purpose, code_hash, expires_at)
  values (h, p_purpose, public.unity_code_hash(h, v_code), now() + interval '10 minutes');
  return jsonb_build_object('ok', true, 'code', v_code);
end;
$$;
revoke all on function public.unity_request_code(text, text) from public, anon, authenticated;

-- Public state: as 125, plus each fixture's cards, whether Man of the Match voting is open, and (once revealed) the winner.
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
                                             where g.fixture_id = f.id and coalesce(gp.name, g.scorer_name) is not null), '[]'::jsonb),
                                          'cards', coalesce((
                                            select jsonb_agg(jsonb_build_object('id', c.id, 'team_id', c.team_id, 'player_id', c.player_id,
                                                                                'name', coalesce(cp.name, c.player_name), 'kind', c.kind, 'minute', c.minute)
                                                             order by c.minute nulls last, c.created_at)
                                              from public.unity_cards c left join public.unity_players cp on cp.id = c.player_id
                                             where c.fixture_id = f.id and coalesce(cp.name, c.player_name) is not null), '[]'::jsonb),
                                          'mom_open', (f.status in ('live', 'finished') and f.mom_open and not f.mom_show),
                                          'mom_show', f.mom_show,
                                          'mom', case when f.mom_show then jsonb_build_object(
                                            'total', coalesce((select sum(t.votes) from public.unity_mom_tally t where t.fixture_id = f.id), 0),
                                            'top', coalesce((select jsonb_agg(jsonb_build_object('player_id', x.player_id, 'name', x.name, 'team_id', x.team_id, 'votes', x.votes) order by x.votes desc, x.name)
                                                               from (select t.player_id, p2.name, p2.team_id, t.votes
                                                                       from public.unity_mom_tally t join public.unity_players p2 on p2.id = t.player_id
                                                                      where t.fixture_id = f.id and t.votes > 0
                                                                      order by t.votes desc, p2.name limit 3) x), '[]'::jsonb)) else null end)
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

-- Committee view: as 125, plus cards, Man of the Match totals and the server clock.
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
