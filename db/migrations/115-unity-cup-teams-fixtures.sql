-- 115: Unity Cup teams, squads and fixtures
--
-- Adds to the Unity Cup portal (114): teams (name, colour, logo, optional group), players that belong to a
-- team (shirt number and position), and fixtures with kick-off, pitch, live status and scores. All of it is
-- entered by the committee (dashboard -> Unity Cup) and shown on the public page; the public never writes
-- to any of it. Players are the same people the Player of the Tournament vote uses.
--
-- The group table on the page is worked out in the browser from finished fixtures between teams that share
-- a group, so nothing here needs to calculate standings.
--
-- Needs 114. Safe to run more than once.

begin;

create table if not exists public.unity_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  short_name text check (short_name is null or char_length(short_name) <= 5),
  colour text not null default '#d4a62b' check (colour ~ '^#[0-9a-fA-F]{6}$'),
  logo_path text,
  group_name text check (group_name is null or char_length(group_name) <= 20),
  description text check (description is null or char_length(description) <= 200),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.unity_teams enable row level security;
revoke all on public.unity_teams from anon, authenticated;

create table if not exists public.unity_fixtures (
  id uuid primary key default gen_random_uuid(),
  stage text check (stage is null or char_length(stage) <= 40),
  home_team_id uuid not null references public.unity_teams (id) on delete cascade,
  away_team_id uuid not null references public.unity_teams (id) on delete cascade,
  kickoff_at timestamptz,
  pitch text check (pitch is null or char_length(pitch) <= 30),
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'finished', 'postponed')),
  home_score int check (home_score is null or home_score between 0 and 99),
  away_score int check (away_score is null or away_score between 0 and 99),
  note text check (note is null or char_length(note) <= 120),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  check (home_team_id <> away_team_id)
);
create index if not exists unity_fixtures_when on public.unity_fixtures (kickoff_at, sort);
alter table public.unity_fixtures enable row level security;
revoke all on public.unity_fixtures from anon, authenticated;

alter table public.unity_players add column if not exists team_id uuid references public.unity_teams (id) on delete set null;
alter table public.unity_players add column if not exists position text check (position is null or char_length(position) <= 20);

-- Teams typed as plain text in 114 become real teams.
insert into public.unity_teams (name)
select distinct on (lower(btrim(p.team))) btrim(p.team) from public.unity_players p
 where p.team is not null and btrim(p.team) <> ''
   and not exists (select 1 from public.unity_teams t where lower(t.name) = lower(btrim(p.team)))
 order by lower(btrim(p.team));
update public.unity_players p set team_id = t.id
  from public.unity_teams t
 where p.team_id is null and p.team is not null and lower(t.name) = lower(btrim(p.team));

-- ---------------------------------------------------------------------
-- Public state, now with teams, squads and fixtures
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
                                          'home_score', f.home_score, 'away_score', f.away_score, 'note', f.note)
                       order by f.kickoff_at nulls last, f.sort, f.created_at)
        from public.unity_fixtures f), '[]'::jsonb),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', p.name, 'team', coalesce(t.name, p.team), 'team_id', p.team_id, 'shirt_no', p.shirt_no, 'position', p.position,
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

-- ---------------------------------------------------------------------
-- Committee: everything for the panel, now with teams and fixtures
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
    'fixtures', coalesce((select jsonb_agg(to_jsonb(f) order by f.kickoff_at nulls last, f.sort, f.created_at) from public.unity_fixtures f), '[]'::jsonb),
    'players', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort, p.name) from public.unity_players p), '[]'::jsonb),
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

create or replace function public.unity_admin_save_team(
  p_id uuid, p_name text, p_short text, p_colour text, p_group text, p_description text, p_sort int, p_logo_path text, p_keep_logo boolean default true)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid := p_id; v_colour text := coalesce(nullif(btrim(p_colour), ''), '#d4a62b');
begin
  perform public.unity__require_admin();
  if btrim(coalesce(p_name, '')) = '' then raise exception 'A team needs a name.'; end if;
  if v_colour !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Pick a colour.'; end if;
  if v_id is null then
    insert into public.unity_teams (name, short_name, colour, group_name, description, sort, logo_path)
    values (btrim(p_name), nullif(btrim(coalesce(p_short, '')), ''), v_colour, nullif(btrim(coalesce(p_group, '')), ''),
            nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_sort, 0), p_logo_path)
    returning id into v_id;
  else
    update public.unity_teams set name = btrim(p_name), short_name = nullif(btrim(coalesce(p_short, '')), ''), colour = v_colour,
           group_name = nullif(btrim(coalesce(p_group, '')), ''), description = nullif(btrim(coalesce(p_description, '')), ''),
           sort = coalesce(p_sort, sort), logo_path = case when p_keep_logo then logo_path else p_logo_path end
     where id = v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.unity_admin_save_team(uuid, text, text, text, text, text, int, text, boolean) from public, anon;
grant execute on function public.unity_admin_save_team(uuid, text, text, text, text, text, int, text, boolean) to authenticated;

-- Deleting a team removes its fixtures and un-assigns its players. Returns the logo to delete from storage.
create or replace function public.unity_admin_delete_team(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_logo text;
begin
  perform public.unity__require_admin();
  delete from public.unity_teams where id = p_id returning logo_path into v_logo;
  return v_logo;
end;
$$;
revoke all on function public.unity_admin_delete_team(uuid) from public, anon;
grant execute on function public.unity_admin_delete_team(uuid) to authenticated;

-- Players now belong to a team (and have a position). Replaces the 114 version.
drop function if exists public.unity_admin_save_player(uuid, text, text, text, int, boolean);
create or replace function public.unity_admin_save_player(
  p_id uuid, p_name text, p_team_id uuid, p_shirt text, p_position text, p_sort int, p_active boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid := p_id;
begin
  perform public.unity__require_admin();
  if btrim(coalesce(p_name, '')) = '' then raise exception 'A player needs a name.'; end if;
  if v_id is null then
    insert into public.unity_players (name, team_id, shirt_no, position, sort, active)
    values (btrim(p_name), p_team_id, nullif(btrim(coalesce(p_shirt, '')), ''), nullif(btrim(coalesce(p_position, '')), ''), coalesce(p_sort, 0), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.unity_players set name = btrim(p_name), team_id = p_team_id, shirt_no = nullif(btrim(coalesce(p_shirt, '')), ''),
           position = nullif(btrim(coalesce(p_position, '')), ''), sort = coalesce(p_sort, sort), active = coalesce(p_active, active)
     where id = v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.unity_admin_save_player(uuid, text, uuid, text, text, int, boolean) from public, anon;
grant execute on function public.unity_admin_save_player(uuid, text, uuid, text, text, int, boolean) to authenticated;

create or replace function public.unity_admin_save_fixture(
  p_id uuid, p_stage text, p_home uuid, p_away uuid, p_kickoff timestamptz, p_pitch text,
  p_status text, p_home_score int, p_away_score int, p_note text, p_sort int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid := p_id;
begin
  perform public.unity__require_admin();
  if p_home is null or p_away is null then raise exception 'Pick both teams.'; end if;
  if p_home = p_away then raise exception 'A team cannot play itself.'; end if;
  if p_status not in ('scheduled', 'live', 'finished', 'postponed') then raise exception 'Unknown status.'; end if;
  if v_id is null then
    insert into public.unity_fixtures (stage, home_team_id, away_team_id, kickoff_at, pitch, status, home_score, away_score, note, sort)
    values (nullif(btrim(coalesce(p_stage, '')), ''), p_home, p_away, p_kickoff, nullif(btrim(coalesce(p_pitch, '')), ''), p_status,
            p_home_score, p_away_score, nullif(btrim(coalesce(p_note, '')), ''), coalesce(p_sort, 0))
    returning id into v_id;
  else
    update public.unity_fixtures set stage = nullif(btrim(coalesce(p_stage, '')), ''), home_team_id = p_home, away_team_id = p_away,
           kickoff_at = p_kickoff, pitch = nullif(btrim(coalesce(p_pitch, '')), ''), status = p_status,
           home_score = p_home_score, away_score = p_away_score, note = nullif(btrim(coalesce(p_note, '')), ''), sort = coalesce(p_sort, sort)
     where id = v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.unity_admin_save_fixture(uuid, text, uuid, uuid, timestamptz, text, text, int, int, text, int) from public, anon;
grant execute on function public.unity_admin_save_fixture(uuid, text, uuid, uuid, timestamptz, text, text, int, int, text, int) to authenticated;

-- Quick score update from the fixtures list (live scoring on the day).
create or replace function public.unity_admin_set_score(p_id uuid, p_home_score int, p_away_score int, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.unity__require_admin();
  if p_status not in ('scheduled', 'live', 'finished', 'postponed') then raise exception 'Unknown status.'; end if;
  update public.unity_fixtures set home_score = p_home_score, away_score = p_away_score, status = p_status where id = p_id;
end;
$$;
revoke all on function public.unity_admin_set_score(uuid, int, int, text) from public, anon;
grant execute on function public.unity_admin_set_score(uuid, int, int, text) to authenticated;

create or replace function public.unity_admin_delete_fixture(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.unity__require_admin();
  delete from public.unity_fixtures where id = p_id;
end;
$$;
revoke all on function public.unity_admin_delete_fixture(uuid) from public, anon;
grant execute on function public.unity_admin_delete_fixture(uuid) to authenticated;

commit;
