-- 116: Unity Cup - who can run it, and private links for team managers
--
-- 1. WHO CAN RUN THE UNITY CUP. Until now only the president (and executive committee) could use the
--    Unity Cup panel. It is now a Hub Access feature, "dash_unity", like the QR codes or Email tools: the
--    president picks who gets it in Dashboard -> Hub Access (by member type, committee title or course, or
--    person by person). It starts CLOSED to everyone except the president, because the panel shows raffle
--    entrants' emails. Every committee function in 114 and 115 already goes through unity__require_admin(),
--    so changing that one function changes the whole rule; the storage rules for uploaded media follow too.
--
-- 2. PRIVATE LINKS FOR TEAMS. The president can make a secret link for each team. Anyone holding the link can
--    add and edit THAT team's players (name, shirt number, position) and press "Submit line-up", with no
--    account and no login. The link is a long random token (144 bits) that can't be guessed. It can be
--    switched off, regenerated (which kills the old link), or the whole feature can be closed (or given a
--    deadline) from the panel. A team manager can only ever touch players of their own team; they cannot see
--    votes, other teams' links or anything else. Every change is logged so the committee can see what changed.
--
-- Needs 060/061 (hub access), 114 and 115. Safe to run more than once.

begin;

-- ---------------------------------------------------------------------
-- 1. Hub Access feature
do $$
declare names text;
begin
  select string_agg(quote_literal(f), ', ') into names
  from (
    select feature as f from public.hub_access_rules
    union
    select unnest(array[
      'perks', 'sankofa', 'network', 'motm_nominate', 'news_feed', 'resources', 'sankofa_hub', 'journey',
      'dash_mmg', 'dash_sankofa', 'dash_motm', 'dash_events', 'dash_gallery',
      'dash_activity', 'dash_webactivity', 'dash_requests', 'dash_pending', 'dash_chatreports',
      'dash_sitestats', 'dash_create', 'dash_manage', 'dash_email', 'dash_feedback', 'dash_partners', 'dash_qr',
      'dash_feedback_edit', 'dash_feedback_public', 'dash_unity'
    ])
  ) x;
  alter table public.hub_access_rules drop constraint if exists hub_access_rules_feature_check;
  execute 'alter table public.hub_access_rules add constraint hub_access_rules_feature_check check (feature in (' || names || '))';
end;
$$;

insert into public.hub_access_rules (feature, allow_members, allow_professionals, member_types, courses, titles, blocked_display)
values ('dash_unity', false, false, null, null, null, 'hidden')
on conflict (feature) do nothing;

create or replace function public.unity_can_manage()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_president(), false) or coalesce(public.has_hub_access('dash_unity'), false);
$$;
revoke all on function public.unity_can_manage() from public, anon;
grant execute on function public.unity_can_manage() to authenticated;

create or replace function public.unity__require_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.unity_can_manage() then raise exception 'Not allowed.' using errcode = '42501'; end if;
end;
$$;
revoke all on function public.unity__require_admin() from public, anon;
grant execute on function public.unity__require_admin() to authenticated;

drop policy if exists "Committee can read Unity Cup uploads" on storage.objects;
create policy "Committee can read Unity Cup uploads"
  on storage.objects for select to authenticated
  using (bucket_id in ('unity-cup-uploads', 'unity-cup-gallery') and public.unity_can_manage());
drop policy if exists "Committee can remove Unity Cup uploads" on storage.objects;
create policy "Committee can remove Unity Cup uploads"
  on storage.objects for delete to authenticated
  using (bucket_id in ('unity-cup-uploads', 'unity-cup-gallery') and public.unity_can_manage());
drop policy if exists "Committee can publish Unity Cup media" on storage.objects;
create policy "Committee can publish Unity Cup media"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'unity-cup-gallery' and public.unity_can_manage());

-- ---------------------------------------------------------------------
-- 2. Team links
alter table public.unity_settings add column if not exists team_links_open boolean not null default true;
alter table public.unity_settings add column if not exists team_links_deadline timestamptz;

alter table public.unity_players add column if not exists source text not null default 'committee' check (source in ('committee', 'team'));
alter table public.unity_players add column if not exists updated_at timestamptz not null default now();

create table if not exists public.unity_team_links (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null unique references public.unity_teams (id) on delete cascade,
  token text not null unique check (token ~ '^[0-9a-f]{36}$'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  regenerated_at timestamptz,
  last_opened_at timestamptz,
  last_edit_at timestamptz,
  submitted_at timestamptz,
  submitted_by text check (submitted_by is null or char_length(submitted_by) <= 60)
);
alter table public.unity_team_links enable row level security;
revoke all on public.unity_team_links from anon, authenticated;

create table if not exists public.unity_team_edits (
  id bigserial primary key,
  team_id uuid not null references public.unity_teams (id) on delete cascade,
  at timestamptz not null default now(),
  action text not null,
  detail text
);
create index if not exists unity_team_edits_team on public.unity_team_edits (team_id, at desc);
alter table public.unity_team_edits enable row level security;
revoke all on public.unity_team_edits from anon, authenticated;

create or replace function public.unity__new_token()
returns text
language sql
volatile
set search_path = public, extensions
as $$ select encode(extensions.gen_random_bytes(18), 'hex'); $$;
revoke all on function public.unity__new_token() from public, anon, authenticated;

-- Which links are usable right now, and why not.
create or replace function public.unity__team_editable(p_enabled boolean)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not p_enabled then 'link_off'
    when not s.team_links_open then 'closed'
    when s.team_links_deadline is not null and now() >= s.team_links_deadline then 'deadline'
    else null end
  from public.unity_settings s where s.id = 1;
$$;
revoke all on function public.unity__team_editable(boolean) from public, anon, authenticated;

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
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'shirt_no', p.shirt_no, 'position', p.position, 'active', p.active)
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

-- Opens a team's page. Anyone can call this, but only a correct, switched-on token returns anything.
create or replace function public.unity_team_open(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare l public.unity_team_links%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' then return jsonb_build_object('ok', false, 'error', 'bad_link'); end if;
  select * into l from public.unity_team_links where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'bad_link'); end if;
  if not l.enabled then return jsonb_build_object('ok', false, 'error', 'link_off'); end if;
  update public.unity_team_links set last_opened_at = now() where id = l.id;
  return public.unity__team_state(l);
end;
$$;
revoke all on function public.unity_team_open(text) from public;
grant execute on function public.unity_team_open(text) to anon, authenticated;

create or replace function public.unity_team_save_player(p_token text, p_id uuid, p_name text, p_shirt text, p_position text, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.unity_team_links%rowtype; v_block text; v_name text := btrim(coalesce(p_name, ''));
  v_shirt text := nullif(btrim(coalesce(p_shirt, '')), ''); v_pos text := nullif(btrim(coalesce(p_position, '')), '');
  v_id uuid := p_id; v_other text; v_count int; v_action text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' then return jsonb_build_object('ok', false, 'error', 'bad_link'); end if;
  select * into l from public.unity_team_links where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'bad_link'); end if;
  v_block := public.unity__team_editable(l.enabled);
  if v_block is not null then return jsonb_build_object('ok', false, 'error', v_block); end if;
  if char_length(v_name) < 1 or char_length(v_name) > 60 then return jsonb_build_object('ok', false, 'error', 'bad_name'); end if;
  if v_shirt is not null and v_shirt !~ '^[0-9]{1,3}$' then return jsonb_build_object('ok', false, 'error', 'bad_number'); end if;
  -- only the four standard positions, except that a player the committee typed in with another wording keeps it
  if v_pos is not null and v_pos not in ('Goalkeeper', 'Defender', 'Midfielder', 'Forward')
     and not exists (select 1 from public.unity_players where id = p_id and team_id = l.team_id and position = v_pos) then
    return jsonb_build_object('ok', false, 'error', 'bad_position');
  end if;
  if (select count(*) from public.unity_team_edits where team_id = l.team_id and at > now() - interval '10 minutes') >= 150 then
    return jsonb_build_object('ok', false, 'error', 'busy');
  end if;
  if v_shirt is not null then
    select p.name into v_other from public.unity_players p
     where p.team_id = l.team_id and p.shirt_no = v_shirt and p.id is distinct from v_id and p.active limit 1;
    if v_other is not null then return jsonb_build_object('ok', false, 'error', 'number_taken', 'holder', v_other, 'num', v_shirt); end if;
  end if;
  if v_id is null then
    select count(*) into v_count from public.unity_players where team_id = l.team_id;
    if v_count >= 30 then return jsonb_build_object('ok', false, 'error', 'too_many'); end if;
    insert into public.unity_players (name, team_id, shirt_no, position, sort, active, source)
    values (v_name, l.team_id, v_shirt, v_pos, v_count, true, 'team') returning id into v_id;
    v_action := 'added';
  else
    if not exists (select 1 from public.unity_players where id = v_id and team_id = l.team_id) then
      return jsonb_build_object('ok', false, 'error', 'not_yours');
    end if;
    update public.unity_players set name = v_name, shirt_no = v_shirt, position = v_pos, active = coalesce(p_active, active), updated_at = now() where id = v_id;
    v_action := 'changed';
  end if;
  update public.unity_team_links set last_edit_at = now() where id = l.id;
  insert into public.unity_team_edits (team_id, action, detail)
  values (l.team_id, v_action, v_name || coalesce(' #' || v_shirt, '') || coalesce(', ' || v_pos, ''));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
revoke all on function public.unity_team_save_player(text, uuid, text, text, text, boolean) from public;
grant execute on function public.unity_team_save_player(text, uuid, text, text, text, boolean) to anon, authenticated;

-- Players who already have votes are hidden instead of deleted, so the count is never lost.
create or replace function public.unity_team_delete_player(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare l public.unity_team_links%rowtype; v_block text; p public.unity_players%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' then return jsonb_build_object('ok', false, 'error', 'bad_link'); end if;
  select * into l from public.unity_team_links where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'bad_link'); end if;
  v_block := public.unity__team_editable(l.enabled);
  if v_block is not null then return jsonb_build_object('ok', false, 'error', v_block); end if;
  select * into p from public.unity_players where id = p_id and team_id = l.team_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_yours'); end if;
  if p.votes > 0 then
    update public.unity_players set active = false, updated_at = now() where id = p.id;
  else
    delete from public.unity_players where id = p.id;
  end if;
  update public.unity_team_links set last_edit_at = now() where id = l.id;
  insert into public.unity_team_edits (team_id, action, detail) values (l.team_id, 'removed', p.name);
  return jsonb_build_object('ok', true, 'hidden', p.votes > 0);
end;
$$;
revoke all on function public.unity_team_delete_player(text, uuid) from public;
grant execute on function public.unity_team_delete_player(text, uuid) to anon, authenticated;

create or replace function public.unity_team_submit(p_token text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare l public.unity_team_links%rowtype; v_block text; v_by text := nullif(left(btrim(coalesce(p_name, '')), 60), '');
begin
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' then return jsonb_build_object('ok', false, 'error', 'bad_link'); end if;
  select * into l from public.unity_team_links where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'bad_link'); end if;
  v_block := public.unity__team_editable(l.enabled);
  if v_block is not null then return jsonb_build_object('ok', false, 'error', v_block); end if;
  if not exists (select 1 from public.unity_players where team_id = l.team_id and active) then
    return jsonb_build_object('ok', false, 'error', 'no_players');
  end if;
  update public.unity_team_links set submitted_at = now(), submitted_by = v_by where id = l.id;
  insert into public.unity_team_edits (team_id, action, detail) values (l.team_id, 'submitted', coalesce(v_by, 'team manager'));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.unity_team_submit(text, text) from public;
grant execute on function public.unity_team_submit(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Committee: manage the links
create or replace function public.unity_admin_team_link(p_team_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare l public.unity_team_links%rowtype;
begin
  perform public.unity__require_admin();
  if not exists (select 1 from public.unity_teams where id = p_team_id) then raise exception 'No such team.'; end if;
  select * into l from public.unity_team_links where team_id = p_team_id;
  if p_action = 'create' then
    if not found then insert into public.unity_team_links (team_id, token) values (p_team_id, public.unity__new_token()) returning * into l; end if;
  elsif p_action = 'regenerate' then
    if not found then insert into public.unity_team_links (team_id, token) values (p_team_id, public.unity__new_token()) returning * into l;
    else update public.unity_team_links set token = public.unity__new_token(), enabled = true, regenerated_at = now(), submitted_at = null, submitted_by = null, last_opened_at = null where id = l.id returning * into l; end if;
  elsif p_action = 'enable' or p_action = 'disable' then
    if not found then raise exception 'Make the link first.'; end if;
    update public.unity_team_links set enabled = (p_action = 'enable') where id = l.id returning * into l;
  elsif p_action = 'remove' then
    delete from public.unity_team_links where team_id = p_team_id;
    return jsonb_build_object('removed', true);
  else raise exception 'Unknown action.'; end if;
  return to_jsonb(l);
end;
$$;
revoke all on function public.unity_admin_team_link(uuid, text) from public, anon;
grant execute on function public.unity_admin_team_link(uuid, text) to authenticated;

-- Replaces 115's version: adds the team links and the latest changes the teams made.
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

-- Replaces 114's version: adds the two team-link settings.
create or replace function public.unity_admin_save_settings(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.unity__require_admin();
  update public.unity_settings set
    event_title = coalesce(nullif(btrim(p->>'event_title'), ''), event_title),
    event_date = coalesce((p->>'event_date')::date, event_date),
    kickoff_text = case when p ? 'kickoff_text' then nullif(btrim(p->>'kickoff_text'), '') else kickoff_text end,
    venue_text = case when p ? 'venue_text' then nullif(btrim(p->>'venue_text'), '') else venue_text end,
    voting_open = coalesce((p->>'voting_open')::boolean, voting_open),
    voting_closes_at = case when p ? 'voting_closes_at' then nullif(p->>'voting_closes_at', '')::timestamptz else voting_closes_at end,
    show_results = coalesce((p->>'show_results')::boolean, show_results),
    raffle_open = coalesce((p->>'raffle_open')::boolean, raffle_open),
    raffle_closes_at = case when p ? 'raffle_closes_at' then nullif(p->>'raffle_closes_at', '')::timestamptz else raffle_closes_at end,
    media_open = coalesce((p->>'media_open')::boolean, media_open),
    require_email_code = coalesce((p->>'require_email_code')::boolean, require_email_code),
    min_donation = coalesce((p->>'min_donation')::numeric, min_donation),
    prize_text = coalesce(nullif(btrim(p->>'prize_text'), ''), prize_text),
    justgiving_url = coalesce(nullif(btrim(p->>'justgiving_url'), ''), justgiving_url),
    team_links_open = coalesce((p->>'team_links_open')::boolean, team_links_open),
    team_links_deadline = case when p ? 'team_links_deadline' then nullif(p->>'team_links_deadline', '')::timestamptz else team_links_deadline end,
    updated_at = now()
  where id = 1;
end;
$$;
revoke all on function public.unity_admin_save_settings(jsonb) from public, anon;
grant execute on function public.unity_admin_save_settings(jsonb) to authenticated;

-- Replaces 114's version: players (and the team-edit log and links) are removed 90 days after the event.
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
