-- 122: Unity Cup - the committee chooses when fixtures go public
--
-- Until now every fixture appeared on the public page the moment it was saved. Now each fixture has a
-- "goes public at" time (publish_at):
--   * empty            -> HIDDEN. Only the committee sees it (Fixtures tab). Nothing about it - not the match,
--                         not the result, not the tables it would feed - reaches the public page.
--   * in the past      -> PUBLIC.
--   * in the future    -> SCHEDULED. It switches itself on at that time; no one has to be there to press a button.
--
-- New fixtures start hidden. Fixtures that already exist stay public (so nothing disappears from the live
-- page when this is run); use "Hide all" in the Fixtures tab if you want to start from a clean slate.
--
-- The check is made in the database (unity_get_state), so it can't be bypassed from the browser, and the
-- public league tables, share pictures and "next match" only ever see published fixtures.
--
-- Needs 115 and 120. Safe to run more than once.

begin;

-- Add the column. Fixtures that already exist were already public, so on the very first run (while the
-- column is new) they keep their place on the page; running this file again changes nothing.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'unity_fixtures' and column_name = 'publish_at') then
    alter table public.unity_fixtures add column publish_at timestamptz;
    update public.unity_fixtures set publish_at = created_at;
  end if;
end $$;

create index if not exists unity_fixtures_publish on public.unity_fixtures (publish_at);

-- Public state: only fixtures whose time has come.
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

-- Committee: hide, publish now, or schedule. p_ids null = every fixture.
--   p_mode 'now'  -> public immediately (fixtures that are already public are left as they are)
--   p_mode 'at'   -> goes public at p_at (must be in the future)
--   p_mode 'hide' -> hidden again (also cancels a schedule)
create or replace function public.unity_admin_set_fixture_visibility(p_ids uuid[], p_mode text, p_at timestamptz default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  perform public.unity__require_admin();
  if p_mode not in ('now', 'at', 'hide') then raise exception 'Unknown option.'; end if;
  if p_mode = 'at' then
    if p_at is null then raise exception 'Pick a date and time.'; end if;
    if p_at <= now() then raise exception 'Pick a time in the future (or choose Publish now).'; end if;
  end if;
  if p_mode = 'now' then
    update public.unity_fixtures set publish_at = now()
     where (p_ids is null or id = any (p_ids)) and (publish_at is null or publish_at > now());
  elsif p_mode = 'at' then
    update public.unity_fixtures set publish_at = p_at
     where (p_ids is null or id = any (p_ids)) and (publish_at is null or publish_at > now());
  else
    update public.unity_fixtures set publish_at = null
     where (p_ids is null or id = any (p_ids)) and publish_at is not null;
  end if;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.unity_admin_set_fixture_visibility(uuid[], text, timestamptz) from public, anon;
grant execute on function public.unity_admin_set_fixture_visibility(uuid[], text, timestamptz) to authenticated;

commit;
