-- 120: Unity Cup - captains and vice-captains
--
-- Each team can have one CAPTAIN and one VICE-CAPTAIN, chosen by the committee (Squads tab) or by the team's
-- manager through their private link. They show on the public page: an armband and a "C" / "VC" badge on the
-- pitch line-up, and a tag in the squad list.
--
-- The database keeps it tidy: only one captain and one vice-captain per team (choosing a new one replaces the old,
-- and a player can't be both); only an active player of that team can be chosen; and a player who is hidden or
-- moved to another team stops being captain.
--
-- Needs 115 and 116. Safe to run more than once.

begin;

alter table public.unity_players add column if not exists captain text check (captain in ('captain', 'vice'));
create unique index if not exists unity_players_one_captain on public.unity_players (team_id) where captain = 'captain';
create unique index if not exists unity_players_one_vice on public.unity_players (team_id) where captain = 'vice';

create or replace function public.unity__players_captain_guard()
returns trigger
language plpgsql
as $$
begin
  if new.captain is not null and (new.active is not true or new.team_id is null or new.team_id is distinct from old.team_id) then
    new.captain := null;
  end if;
  return new;
end;
$$;
drop trigger if exists unity_players_captain_guard on public.unity_players;
create trigger unity_players_captain_guard before update on public.unity_players
  for each row execute function public.unity__players_captain_guard();

-- Gives a player a role (or clears it with null), taking it off whoever held it in that team.
create or replace function public.unity__set_captain(p_player uuid, p_role text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare p public.unity_players%rowtype;
begin
  if p_role is not null and p_role not in ('captain', 'vice') then return 'bad_role'; end if;
  select * into p from public.unity_players where id = p_player;
  if not found then return 'not_found'; end if;
  if p_role is null then
    update public.unity_players set captain = null, updated_at = now() where id = p.id;
    return null;
  end if;
  if p.team_id is null then return 'no_team'; end if;
  if not p.active then return 'hidden'; end if;
  update public.unity_players set captain = null, updated_at = now() where team_id = p.team_id and captain = p_role and id <> p.id;
  update public.unity_players set captain = p_role, updated_at = now() where id = p.id;
  return null;
end;
$$;
revoke all on function public.unity__set_captain(uuid, text) from public, anon, authenticated;

create or replace function public.unity_admin_set_captain(p_player uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_err text;
begin
  perform public.unity__require_admin();
  v_err := public.unity__set_captain(p_player, nullif(btrim(coalesce(p_role, '')), ''));
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.unity_admin_set_captain(uuid, text) from public, anon;
grant execute on function public.unity_admin_set_captain(uuid, text) to authenticated;

-- The team manager's version: only their own team's players.
create or replace function public.unity_team_set_captain(p_token text, p_player uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare l public.unity_team_links%rowtype; v_block text; v_err text; v_name text; v_role text := nullif(btrim(coalesce(p_role, '')), '');
begin
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' then return jsonb_build_object('ok', false, 'error', 'bad_link'); end if;
  select * into l from public.unity_team_links where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'bad_link'); end if;
  v_block := public.unity__team_editable(l.enabled);
  if v_block is not null then return jsonb_build_object('ok', false, 'error', v_block); end if;
  select name into v_name from public.unity_players where id = p_player and team_id = l.team_id;
  if v_name is null then return jsonb_build_object('ok', false, 'error', 'not_yours'); end if;
  v_err := public.unity__set_captain(p_player, v_role);
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
  update public.unity_team_links set last_edit_at = now() where id = l.id;
  insert into public.unity_team_edits (team_id, action, detail)
  values (l.team_id, 'captain', v_name || case v_role when 'captain' then ' made captain' when 'vice' then ' made vice-captain' else ' no longer captain' end);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.unity_team_set_captain(text, uuid, text) from public;
grant execute on function public.unity_team_set_captain(text, uuid, text) to anon, authenticated;

-- The public page and the team page now include the captain.
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

create or replace function public.unity__team_state(l public.unity_team_links)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare t public.unity_teams%rowtype; s public.unity_settings%rowtype; v_block text;
begin
  select * into t from public.unity_teams where id = l.team_id;
  select * into s from public.unity_settings where id = 1;
  v_block := public.unity__team_editable(l.enabled);
  return jsonb_build_object(
    'ok', true,
    'team', jsonb_build_object('id', t.id, 'name', t.name, 'short_name', t.short_name, 'colour', t.colour, 'logo_path', t.logo_path, 'group_name', t.group_name),
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'shirt_no', p.shirt_no, 'position', p.position, 'active', p.active, 'captain', p.captain)
                                      order by coalesce(nullif(regexp_replace(p.shirt_no, '\D', '', 'g'), '')::int, 999), p.name)
                           from public.unity_players p where p.team_id = t.id), '[]'::jsonb),
    'editable', v_block is null,
    'blocked', v_block,
    'deadline', s.team_links_deadline,
    'submitted_at', l.submitted_at,
    'submitted_by', l.submitted_by,
    'last_edit_at', l.last_edit_at,
    'event_title', s.event_title,
    'event_date', s.event_date,
    'max_players', 30
  );
end;
$$;
revoke all on function public.unity__team_state(public.unity_team_links) from public, anon, authenticated;
revoke all on function public.unity__team_state(public.unity_team_links) from public, anon, authenticated;

commit;
