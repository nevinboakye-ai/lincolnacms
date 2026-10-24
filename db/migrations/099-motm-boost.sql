-- 099: Member of the Month - make nominating easy, visible and rewarding
--
-- What this adds (all of it enforced here, not just on the page):
--
--   1. One-tap nominations. A nomination can now carry up to three "reason chips"
--      (Always shows up, Made me feel welcome...) instead of, or as well as, a
--      written reason, and can point at a real account (nominee_user_id) when it's
--      made from a Network card or a resource. Typing a name still works: if it
--      matches exactly one member or professional the link is made for you.
--      Nominating yourself is refused.
--   2. A community goal. The president (or anyone with the Nominations tile) sets
--      a monthly target and a reward ("20 nominations and we host a free pizza
--      night"). motm_community_goal() gives everyone the count so far this month,
--      never who nominated whom.
--   3. The nominee hears about it. motm_my_praise() gives a person the nominations
--      made about them: the chips straight away, the written words only once the
--      committee has approved them, and the nominator's name only if the nominator
--      chose to share it. Nobody else can read these.
--   4. A shout-out wall. A nominator can tick "you may show this (without my
--      name)". Once the committee approves it, motm_wall() shows the nominee's
--      first name and the words. Sixth formers are never shown or named.
--   5. Rewards for nominating: 20 XP and the "Ohemaa's Choice" badge when someone
--      you nominated becomes Member of the Month, and the "Oríkì Singer" badge for
--      nominating in three different months. (journey__state is patched, not
--      replaced, so it keeps everything from 088/094.)
--   6. email_motm_nominators(): who has nominated this month, for the Email tile's
--      "members who haven't nominated yet" audience.
--
-- Nominations stay one per person per calendar month (migration 030).
--
-- Safe to run more than once. Needs 003, 011, 030, 060, 061, 064, 088, 094 and
-- (for the Email audience) 098. If you ever re-run 094, run this file again.

begin;

-- ---------------------------------------------------------------------
-- 1. The nomination itself
alter table public.motm_nominations add column if not exists nominee_user_id uuid references auth.users (id) on delete set null;
alter table public.motm_nominations add column if not exists reason_tags text[] not null default '{}';
alter table public.motm_nominations add column if not exists reason_custom boolean not null default true;
alter table public.motm_nominations add column if not exists show_name_to_nominee boolean not null default false;
alter table public.motm_nominations add column if not exists wall_ok boolean not null default false;
alter table public.motm_nominations add column if not exists share_status text not null default 'pending';
alter table public.motm_nominations add column if not exists praise_seen_at timestamptz;

alter table public.motm_nominations drop constraint if exists motm_nominations_share_status_check;
alter table public.motm_nominations add constraint motm_nominations_share_status_check
  check (share_status in ('pending', 'approved', 'hidden'));

create index if not exists motm_nominations_nominee_idx on public.motm_nominations (nominee_user_id) where nominee_user_id is not null;
create index if not exists motm_nominations_month_idx on public.motm_nominations (nomination_month);

comment on column public.motm_nominations.nominee_user_id is 'The account being nominated, when known (one-tap nominations, or an exact unique name match). The nominee is told about the nomination.';
comment on column public.motm_nominations.reason_tags is 'Up to three reason chips (keys from motm_tag_label()).';
comment on column public.motm_nominations.reason_custom is 'false when the nominator wrote nothing and "reason" was filled in from the chips.';
comment on column public.motm_nominations.show_name_to_nominee is 'The nominator agreed to the nominee seeing who nominated them.';
comment on column public.motm_nominations.wall_ok is 'The nominator agreed to the words being shown on the shout-out wall (first name of the nominee only, no nominator name).';
comment on column public.motm_nominations.share_status is 'The committee check: pending, approved (the words may be shown to the nominee and, if wall_ok, on the wall) or hidden.';

-- The chips, in one place.
create or replace function public.motm_tag_label(p_key text)
returns text
language sql
immutable
as $$
  select case p_key
    when 'welcoming'   then 'Made me feel welcome'
    when 'helped_study' then 'Helped me with my studies'
    when 'showed_up'   then 'Always shows up'
    when 'led'         then 'Led from the front'
    when 'listened'    then 'Listened when I needed it'
    when 'energy'      then 'Brought great energy'
    when 'went_extra'  then 'Went above and beyond'
    when 'mentor'      then 'A mentor to others'
    else null end;
$$;

-- Checks and tidying on every new nomination, whoever sends it.
create or replace function public.motm_nominations_prepare()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
  clean text[];
  found_name text;
  found_course text;
  found_year text;
  matches uuid[];
  nominator_name text;
begin
  -- Reason chips: only known ones, no repeats, at most three.
  clean := coalesce(array(
    select u.t from unnest(coalesce(new.reason_tags, '{}'::text[])) with ordinality as u(t, i)
    group by u.t order by min(u.i)
  ), '{}'::text[]);
  foreach t in array clean loop
    if public.motm_tag_label(t) is null then
      raise exception 'That is not one of the reasons you can pick.';
    end if;
  end loop;
  if cardinality(clean) > 3 then
    raise exception 'Pick up to three reasons.';
  end if;
  new.reason_tags := clean;

  new.nominee_name := btrim(coalesce(new.nominee_name, ''));

  -- A named account: it must exist, and its own name is used.
  if new.nominee_user_id is not null then
    select m.full_name, m.course, m.year_of_study into found_name, found_course, found_year
    from public.members m where m.id = new.nominee_user_id;
    if not found then
      select np.full_name into found_name
      from public.network_professionals np where np.user_id = new.nominee_user_id and np.is_active = true limit 1;
      if found_name is null then
        raise exception 'We could not find that person.';
      end if;
    end if;
    new.nominee_name := btrim(found_name);
  end if;

  if new.nominee_name = '' then
    raise exception 'Say who you are nominating.';
  end if;

  -- No nominating yourself, by account or by name.
  if new.nominee_user_id = new.nominator_id then
    raise exception 'You cannot nominate yourself - but we like the confidence.';
  end if;
  select coalesce((select m.full_name from public.members m where m.id = new.nominator_id),
                  (select np.full_name from public.network_professionals np where np.user_id = new.nominator_id limit 1))
    into nominator_name;
  if nominator_name is not null and lower(btrim(nominator_name)) = lower(new.nominee_name) then
    raise exception 'You cannot nominate yourself - but we like the confidence.';
  end if;

  -- Typed a name: link it to an account when exactly one person has that name.
  if new.nominee_user_id is null then
    select array_agg(x.id) into matches from (
      select m.id from public.members m
      where m.membership_status = 'active' and lower(btrim(m.full_name)) = lower(new.nominee_name)
      union
      select np.user_id from public.network_professionals np
      where np.user_id is not null and np.is_active = true and lower(btrim(np.full_name)) = lower(new.nominee_name)
    ) x;
    if matches is not null and cardinality(matches) = 1 then
      new.nominee_user_id := matches[1];
      select m.course, m.year_of_study into found_course, found_year from public.members m where m.id = matches[1];
    end if;
  end if;

  -- Sixth formers: nothing that names the nominator, and (in motm_wall) never shown.
  if new.nominee_user_id is not null and found_course is not null
     and public.is_sixth_form_profile(found_course, found_year) then
    new.show_name_to_nominee := false;
  end if;

  -- The reason: chips can stand in for words.
  new.reason := btrim(coalesce(new.reason, ''));
  if char_length(new.reason) > 1000 then
    raise exception 'Keep the reason under 1000 characters.';
  end if;
  if new.reason = '' then
    if cardinality(new.reason_tags) = 0 then
      raise exception 'Pick a reason or write a few words.';
    end if;
    new.reason := (select string_agg(public.motm_tag_label(k), ' · ' order by o) from unnest(new.reason_tags) with ordinality as z(k, o));
    new.reason_custom := false;
  else
    new.reason_custom := true;
  end if;

  -- Things only the committee decides (or the nominee does) start fresh.
  new.share_status := 'pending';
  new.praise_seen_at := null;
  new.wall_ok := coalesce(new.wall_ok, false);
  new.show_name_to_nominee := coalesce(new.show_name_to_nominee, false);
  return new;
end;
$$;

drop trigger if exists motm_nominations_prepare on public.motm_nominations;
create trigger motm_nominations_prepare
  before insert on public.motm_nominations
  for each row execute function public.motm_nominations_prepare();

-- ---------------------------------------------------------------------
-- 2. The community goal
insert into public.site_settings (key, value) values ('motm_goal_enabled', 'false') on conflict (key) do nothing;
insert into public.site_settings (key, value) values ('motm_goal_target', '20') on conflict (key) do nothing;
insert into public.site_settings (key, value) values ('motm_goal_reward', '') on conflict (key) do nothing;

create or replace function public.motm_community_goal()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  this_month text := to_char(now(), 'YYYY-MM');
  enabled boolean;
  target integer;
  reward text;
  total integer;
begin
  if auth.uid() is null then
    return jsonb_build_object('enabled', false);
  end if;
  select coalesce((select lower(btrim(s.value)) = 'true' from public.site_settings s where s.key = 'motm_goal_enabled'), false) into enabled;
  select least(greatest(coalesce((select nullif(regexp_replace(s.value, '[^0-9]', '', 'g'), '')::integer from public.site_settings s where s.key = 'motm_goal_target'), 0), 0), 1000) into target;
  select btrim(coalesce((select s.value from public.site_settings s where s.key = 'motm_goal_reward'), '')) into reward;
  select count(*) into total from public.motm_nominations n where n.nomination_month = this_month;
  return jsonb_build_object(
    'enabled', enabled and target > 0,
    'target', target,
    'reward', reward,
    'count', total,
    'unlocked', target > 0 and total >= target,
    'month', this_month,
    'i_nominated', exists (select 1 from public.motm_nominations n where n.nominator_id = auth.uid() and n.nomination_month = this_month)
  );
end;
$$;

-- The committee sets the goal (President, or anyone given the Nominations tile).
create or replace function public.motm_set_goal(p_enabled boolean, p_target integer, p_reward text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (coalesce(public.is_president(), false) or coalesce(public.has_hub_access('dash_motm'), false)) then
    raise exception 'Not authorized';
  end if;
  insert into public.site_settings (key, value, updated_at) values
    ('motm_goal_enabled', case when coalesce(p_enabled, false) then 'true' else 'false' end, now()),
    ('motm_goal_target', least(greatest(coalesce(p_target, 0), 0), 1000)::text, now()),
    ('motm_goal_reward', left(btrim(coalesce(p_reward, '')), 160), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------
-- 3. The nominee hears about it
create or replace function public.motm_my_praise()
returns table (
  id uuid, created_at timestamptz, nomination_month text, reason_tags text[], words text,
  nominator_name text, seen boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.created_at, n.nomination_month, n.reason_tags,
         case when n.share_status = 'approved' and n.reason_custom then n.reason else null end,
         case when n.show_name_to_nominee
              then coalesce((select m.full_name from public.members m where m.id = n.nominator_id),
                            (select np.full_name from public.network_professionals np where np.user_id = n.nominator_id limit 1))
              else null end,
         n.praise_seen_at is not null
  from public.motm_nominations n
  where n.nominee_user_id = auth.uid()
    and auth.uid() is not null
    and n.share_status <> 'hidden'
    and n.created_at > now() - interval '120 days'
  order by n.created_at desc
  limit 20;
$$;

create or replace function public.motm_praise_seen()
returns void
language sql
security definer
set search_path = public
as $$
  -- Words still waiting for the committee stay "new", so the nominee sees them
  -- once they are approved.
  update public.motm_nominations set praise_seen_at = now()
  where nominee_user_id = auth.uid() and praise_seen_at is null
    and not (reason_custom and share_status = 'pending');
$$;

-- ---------------------------------------------------------------------
-- 4. The shout-out wall (approved, consented words; the nominee's first name only)
create or replace function public.motm_wall(p_limit integer default 12)
returns table (id uuid, nominee_first text, words text, reason_tags text[], created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select n.id,
         split_part(regexp_replace(btrim(n.nominee_name), '^(dr|prof|professor|mr|mrs|ms|miss)\.?\s+', '', 'i'), ' ', 1),
         case when n.reason_custom then n.reason else null end,
         n.reason_tags,
         n.created_at
  from public.motm_nominations n
  where auth.uid() is not null
    and (public.is_lacms_member() or public.is_professional())
    and n.wall_ok and n.share_status = 'approved'
    and n.created_at > now() - interval '120 days'
    and not exists (
      select 1 from public.members m
      where m.id = n.nominee_user_id and public.is_sixth_form_profile(m.course, m.year_of_study)
    )
  order by n.created_at desc
  limit least(greatest(coalesce(p_limit, 12), 1), 30);
$$;

-- ---------------------------------------------------------------------
-- The dashboard's view of nominations (adds the chips and the sharing state).
drop function if exists public.president_get_motm_nominations() cascade;
create function public.president_get_motm_nominations()
returns table (
  id uuid, nominee_name text, reason text, nominator_name text, nominator_email text, created_at timestamptz,
  nomination_month text, reason_tags text[], reason_custom boolean, show_name_to_nominee boolean,
  wall_ok boolean, share_status text, nominee_matched boolean, praise_seen boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (coalesce(public.is_president(), false) or coalesce(public.has_hub_access('dash_motm'), false)) then
    raise exception 'Not authorized';
  end if;
  return query
    select mn.id, mn.nominee_name, mn.reason,
           coalesce(m.full_name, np.full_name, u.email::text) as nominator_name,
           u.email::text as nominator_email,
           mn.created_at,
           mn.nomination_month, mn.reason_tags, mn.reason_custom, mn.show_name_to_nominee,
           mn.wall_ok, mn.share_status, (mn.nominee_user_id is not null), (mn.praise_seen_at is not null)
    from public.motm_nominations mn
    left join public.members m on m.id = mn.nominator_id
    left join public.network_professionals np on np.user_id = mn.nominator_id
    left join auth.users u on u.id = mn.nominator_id
    order by mn.created_at desc;
end;
$$;

-- Approve (or hide, or reset) the words on one or more nominations.
create or replace function public.president_set_motm_share(p_ids uuid[], p_status text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer;
begin
  if not (coalesce(public.is_president(), false) or coalesce(public.has_hub_access('dash_motm'), false)) then
    raise exception 'Not authorized';
  end if;
  if p_status not in ('pending', 'approved', 'hidden') then
    raise exception 'Unknown status';
  end if;
  update public.motm_nominations set share_status = p_status where id = any (coalesce(p_ids, '{}'::uuid[]));
  get diagnostics changed = row_count;
  return changed;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Who has nominated this month (for the Email tile)
create or replace function public.email_motm_nominators(p_month text default null)
returns table (email text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  mth text := coalesce(nullif(btrim(p_month), ''), to_char(now(), 'YYYY-MM'));
begin
  if not (coalesce(public.is_president(), false)
          or coalesce(public.has_hub_access('dash_motm'), false)
          or coalesce(public.has_hub_access('dash_email'), false)) then
    raise exception 'Not authorized';
  end if;
  return query
    select distinct lower(u.email::text)
    from public.motm_nominations n
    join auth.users u on u.id = n.nominator_id
    where n.nomination_month = mth and u.email is not null;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Rewards: the journey (XP and badges)
insert into public.member_badge_defs (key, name, description, hint, icon, sort_order) values
  ('kingmaker',     'Ohemaa''s Choice', 'Someone you nominated became Member of the Month. In Asante tradition the Queen Mother, the Ohemaa, names the next king (Ghana).', 'Nominate someone who goes on to be Member of the Month', '🪑', 21),
  ('praise_streak', 'Oríkì Singer',     'Nominated in three different months. Oríkì are Yoruba praise poems that celebrate a person''s character (Nigeria).', 'Nominate someone in 3 different months', '🎤', 22)
on conflict (key) do update
  set name = excluded.name, description = excluded.description, hint = excluded.hint,
      icon = excluded.icon, sort_order = excluded.sort_order;

do $$
declare
  def text;
  patched text;
  a1 constant text := E'  -- ---- News ----';
  a2 constant text := E'  if coalesce((counts ->> ''motm_nominate'')::int, 0) >= 1 then keys := array_append(keys, ''nominator''); end if;';
  b1 constant text := E'  -- ---- Member of the Month: a nominee won ----
  for r in select w.id::text as ref, w.created_at as at
           from public.motm_winners w
           where w.is_active and btrim(coalesce(w.full_name, '''')) <> ''''
             and exists (
               select 1 from public.motm_nominations n
               where n.nominator_id = me
                 and lower(btrim(n.nominee_name)) = lower(btrim(w.full_name))
                 and n.created_at between w.created_at - interval ''75 days'' and w.created_at + interval ''3 days'')
           order by w.created_at limit 12 loop
    perform public.journey__grant(me, ''motm_kingmaker'', r.ref, 20, r.at);
  end loop;

';
  b2 constant text := E'
  if coalesce((counts ->> ''motm_kingmaker'')::int, 0) >= 1 then keys := array_append(keys, ''kingmaker''); end if;
  if (select count(distinct n.nomination_month) from public.motm_nominations n where n.nominator_id = me) >= 3 then keys := array_append(keys, ''praise_streak''); end if;';
begin
  select pg_get_functiondef('public.journey__state(uuid, boolean)'::regprocedure) into def;
  if def is null then
    raise exception 'journey__state(uuid, boolean) not found - run 094 first.';
  end if;
  if position('motm_kingmaker' in def) > 0 then
    raise notice 'journey__state already has the Member of the Month rewards.';
    return;
  end if;
  if position(a1 in def) = 0 or position(a2 in def) = 0 then
    raise exception 'journey__state is not in the expected shape - cannot add the Member of the Month rewards.';
  end if;
  patched := replace(def, a1, b1 || a1);
  patched := replace(patched, a2, a2 || b2);
  execute patched;
end;
$$;

-- ---------------------------------------------------------------------
-- Who may call what
revoke all on function public.motm_nominations_prepare() from public, anon, authenticated;
revoke all on function public.motm_community_goal() from public, anon;
revoke all on function public.motm_set_goal(boolean, integer, text) from public, anon;
revoke all on function public.motm_my_praise() from public, anon;
revoke all on function public.motm_praise_seen() from public, anon;
revoke all on function public.motm_wall(integer) from public, anon;
revoke all on function public.president_get_motm_nominations() from public, anon;
revoke all on function public.president_set_motm_share(uuid[], text) from public, anon;
revoke all on function public.email_motm_nominators(text) from public, anon;
grant execute on function public.motm_community_goal() to authenticated;
grant execute on function public.motm_set_goal(boolean, integer, text) to authenticated;
grant execute on function public.motm_my_praise() to authenticated;
grant execute on function public.motm_praise_seen() to authenticated;
grant execute on function public.motm_wall(integer) to authenticated;
grant execute on function public.president_get_motm_nominations() to authenticated;
grant execute on function public.president_set_motm_share(uuid[], text) to authenticated;
grant execute on function public.email_motm_nominators(text) to authenticated;
grant execute on function public.motm_tag_label(text) to authenticated;

commit;
