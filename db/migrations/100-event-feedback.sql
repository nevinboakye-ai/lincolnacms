-- 100: Event feedback, built into the website (replaces the Google Forms)
--
-- Anyone who has been to an event can give feedback on feedback.html:
--   * LACMS members and professionals sign in; their feedback is attached to
--     them (or sent anonymously - the committee then sees no name, email,
--     course or year).
--   * Guests need no account: just an email, so we can follow up and so the
--     same person can't send the same event twice.
-- The form is short: a 1-5 rating, a few tap-to-pick "what went well" and
-- "what could be better" reasons, would you come again, and an optional
-- comment. Everything is checked here, not only on the page.
--
--   * event_feedback        - the answers. Nobody can read this table directly;
--                             the committee reads it through the functions below.
--   * submit_event_feedback - the one way in (guests and signed-in people).
--                             Checks the event is real, has started and isn't
--                             long over; one response per person per event; a
--                             cap on guest submissions per hour; a hidden
--                             "website" field that only bots fill in.
--   * my_feedback_slugs     - which events the caller has already reviewed.
--   * president_get_feedback / president_feedback_registrations /
--     president_delete_feedback - the dashboard's Feedback section. Needs the
--     Hub Access feature dash_feedback (the Executive Committee by default; the
--     president can share or take it away on the Hub Access page).
--   * email_event_registrants / email_feedback_guests - audiences for the Email
--     section ("everyone who registered for Games Night" and "guests who asked for
--     updates"), for asking for feedback and inviting guests to join.
--   * Members earn 10 XP per event they review, and the "Palaver Tree" badge for
--     three (journey__state is patched, not replaced).
--
-- Safe to run more than once. Needs 003, 058, 060, 061, 080, 088, 094 (and 098/099
-- for the Email section and the journey patch).

begin;

-- ---------------------------------------------------------------------
-- 1. The answers
create table if not exists public.event_feedback (
  id uuid primary key default gen_random_uuid(),
  event_slug text not null,
  event_name text not null,
  user_id uuid references auth.users (id) on delete set null,
  respondent text not null check (respondent in ('member', 'professional', 'guest')),
  guest_email text,
  guest_name text,
  guest_kind text check (guest_kind is null or guest_kind in ('lincoln_student', 'other_student', 'professional', 'other')),
  member_course text,
  member_year text,
  rating smallint not null check (rating between 1 and 5),
  liked text[] not null default '{}',
  improve text[] not null default '{}',
  comment text check (comment is null or char_length(comment) <= 1500),
  would_return text check (would_return is null or would_return in ('yes', 'maybe', 'no')),
  heard_from text,
  suggestion text check (suggestion is null or char_length(suggestion) <= 500),
  anonymous boolean not null default false,
  quote_ok boolean not null default false,
  wants_updates boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists event_feedback_one_per_user on public.event_feedback (event_slug, user_id) where user_id is not null;
create unique index if not exists event_feedback_one_per_guest on public.event_feedback (event_slug, lower(guest_email)) where guest_email is not null;
create index if not exists event_feedback_event_idx on public.event_feedback (event_slug, created_at desc);

alter table public.event_feedback enable row level security;
revoke all on public.event_feedback from anon, authenticated;
-- (no policies on purpose: the functions below are the only way in or out)

-- The tap-to-pick answers. One list for the whole table, so the page can offer
-- different ones for a social, a careers session or a charity event.
create or replace function public.feedback_valid_liked(p text[])
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(k = any (array['atmosphere','organised','value','people','welcome','fun','food','venue','content','speakers','practical','mentor','cause','learned'])), true)
  from unnest(coalesce(p, '{}'::text[])) k;
$$;

create or replace function public.feedback_valid_improve(p text[])
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(k = any (array['venue','timing','communication','crowded','length','cost','food','access','organisation','content','av','activities'])), true)
  from unnest(coalesce(p, '{}'::text[])) k;
$$;

-- ---------------------------------------------------------------------
-- 2. Sending feedback (guests and signed-in people)
create or replace function public.submit_event_feedback(
  p_event_slug text,
  p_rating integer,
  p_liked text[] default '{}',
  p_improve text[] default '{}',
  p_comment text default null,
  p_would_return text default null,
  p_heard_from text default null,
  p_suggestion text default null,
  p_anonymous boolean default false,
  p_quote_ok boolean default false,
  p_guest_email text default null,
  p_guest_name text default null,
  p_guest_kind text default null,
  p_wants_updates boolean default false,
  p_website text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  ev record;
  ev_name text;
  ev_start date;
  ev_end date;
  who text := 'guest';
  my_email text;
  my_course text;
  my_year text;
  g_email text;
  g_name text;
  new_id uuid;
begin
  -- A hidden field only bots fill in: pretend it worked.
  if btrim(coalesce(p_website, '')) <> '' then
    return jsonb_build_object('ok', true, 'already', false, 'member', false);
  end if;

  p_event_slug := btrim(coalesce(p_event_slug, ''));
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Choose a rating from 1 to 5.';
  end if;
  p_liked := coalesce(p_liked, '{}'::text[]);
  p_improve := coalesce(p_improve, '{}'::text[]);
  if cardinality(p_liked) > 6 or cardinality(p_improve) > 6
     or not public.feedback_valid_liked(p_liked) or not public.feedback_valid_improve(p_improve) then
    raise exception 'One of the choices was not recognised - refresh the page and try again.';
  end if;
  p_comment := nullif(btrim(coalesce(p_comment, '')), '');
  p_suggestion := nullif(btrim(coalesce(p_suggestion, '')), '');
  if char_length(coalesce(p_comment, '')) > 1500 then raise exception 'Please keep the comment under 1500 characters.'; end if;
  if char_length(coalesce(p_suggestion, '')) > 500 then raise exception 'Please keep the suggestion under 500 characters.'; end if;
  if p_would_return is not null and p_would_return not in ('yes', 'maybe', 'no') then p_would_return := null; end if;
  p_heard_from := nullif(left(btrim(coalesce(p_heard_from, '')), 40), '');

  -- The event: a real one that has started and isn't long over, or "general".
  if p_event_slug = 'general' then
    ev_name := 'LACMS in general';
  else
    select * into ev from public.site_events e where e.slug = p_event_slug and e.is_active;
    if not found then raise exception 'We could not find that event.'; end if;
    ev_name := ev.name;
    ev_start := ev.starts_on;
    ev_end := coalesce(ev.ends_on, ev.starts_on);
    if ev_start is not null and ev_start > current_date then
      raise exception 'That event has not happened yet - come back afterwards.';
    end if;
    if ev_end is not null and ev_end < current_date - 120 then
      raise exception 'Feedback for that event has closed.';
    end if;
  end if;

  -- Who is sending it.
  if me is not null then
    select m.course, m.year_of_study into my_course, my_year from public.members m where m.id = me;
    if found then
      who := 'member';
    elsif exists (select 1 from public.network_professionals np where np.user_id = me) then
      who := 'professional';
    end if;
    select lower(u.email::text) into my_email from auth.users u where u.id = me;
  end if;

  if who = 'guest' then
    g_email := lower(btrim(coalesce(p_guest_email, my_email, '')));
    if g_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(g_email) > 254 then
      raise exception 'Enter a valid email address so we can follow up.';
    end if;
    g_name := nullif(left(btrim(coalesce(p_guest_name, '')), 80), '');
    if p_guest_kind is not null and p_guest_kind not in ('lincoln_student', 'other_student', 'professional', 'other') then p_guest_kind := null; end if;
    -- Not a flood.
    if (select count(*) from public.event_feedback f where f.event_slug = p_event_slug and f.respondent = 'guest' and f.created_at > now() - interval '1 hour') >= 120 then
      raise exception 'Lots of people are sending feedback right now - please try again in a few minutes.';
    end if;
  else
    g_email := null; g_name := null; p_guest_kind := null; p_wants_updates := false;
  end if;

  insert into public.event_feedback (
    event_slug, event_name, user_id, respondent, guest_email, guest_name, guest_kind, member_course, member_year,
    rating, liked, improve, comment, would_return, heard_from, suggestion, anonymous, quote_ok, wants_updates
  ) values (
    p_event_slug, ev_name, case when who = 'guest' then null else me end, who, g_email, g_name, p_guest_kind, my_course, my_year,
    p_rating, p_liked, p_improve, p_comment, p_would_return, p_heard_from, p_suggestion,
    coalesce(p_anonymous, false) and who <> 'guest', coalesce(p_quote_ok, false), coalesce(p_wants_updates, false)
  )
  on conflict do nothing
  returning id into new_id;

  return jsonb_build_object('ok', true, 'already', new_id is null, 'member', who <> 'guest', 'respondent', who);
end;
$$;

create or replace function public.my_feedback_slugs()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select f.event_slug from public.event_feedback f where f.user_id = auth.uid() and auth.uid() is not null;
$$;

revoke all on function public.submit_event_feedback(text, integer, text[], text[], text, text, text, text, boolean, boolean, text, text, text, boolean, text) from public;
revoke all on function public.my_feedback_slugs() from public, anon;
grant execute on function public.submit_event_feedback(text, integer, text[], text[], text, text, text, text, boolean, boolean, text, text, text, boolean, text) to anon, authenticated;
grant execute on function public.my_feedback_slugs() to authenticated;

-- ---------------------------------------------------------------------
-- 3. The dashboard's Feedback section
do $$
declare
  names text;
begin
  select string_agg(quote_literal(f), ', ') into names
  from (
    select feature as f from public.hub_access_rules
    union
    select unnest(array[
      'perks', 'sankofa', 'network', 'motm_nominate', 'news_feed', 'resources', 'sankofa_hub', 'journey',
      'dash_mmg', 'dash_sankofa', 'dash_motm', 'dash_events', 'dash_gallery',
      'dash_activity', 'dash_webactivity', 'dash_requests', 'dash_pending', 'dash_chatreports',
      'dash_sitestats', 'dash_create', 'dash_manage', 'dash_email', 'dash_feedback'
    ])
  ) x;
  alter table public.hub_access_rules drop constraint if exists hub_access_rules_feature_check;
  execute 'alter table public.hub_access_rules add constraint hub_access_rules_feature_check check (feature in (' || names || '))';
end;
$$;

-- Executive Committee by default, like the Events section.
insert into public.hub_access_rules (feature, allow_members, allow_professionals, member_types, courses, titles, blocked_display)
values ('dash_feedback', true, false, array['executive_committee'], null, null, 'hidden')
on conflict (feature) do nothing;

create or replace function public.feedback_can_read()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_president(), false) or coalesce(public.has_hub_access('dash_feedback'), false);
$$;
revoke all on function public.feedback_can_read() from public, anon;
grant execute on function public.feedback_can_read() to authenticated;

-- Every response. Anonymous members show no name, email, course or year.
create or replace function public.president_get_feedback()
returns table (
  id uuid, event_slug text, event_name text, created_at timestamptz, respondent text,
  person_name text, person_email text, course text, year_of_study text, guest_kind text,
  rating integer, liked text[], improve text[], comment text, would_return text, heard_from text,
  suggestion text, anonymous boolean, quote_ok boolean, wants_updates boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.feedback_can_read() then
    raise exception 'Not authorized';
  end if;
  return query
    select f.id, f.event_slug, f.event_name, f.created_at, f.respondent,
           case when f.anonymous then null
                else coalesce(f.guest_name, (select m.full_name from public.members m where m.id = f.user_id),
                                            (select np.full_name from public.network_professionals np where np.user_id = f.user_id limit 1)) end,
           case when f.anonymous then null
                else coalesce(f.guest_email, (select lower(u.email::text) from auth.users u where u.id = f.user_id)) end,
           case when f.anonymous then null else f.member_course end,
           case when f.anonymous then null else f.member_year end,
           f.guest_kind, f.rating::integer, f.liked, f.improve, f.comment, f.would_return, f.heard_from,
           f.suggestion, f.anonymous, f.quote_ok, f.wants_updates
    from public.event_feedback f
    order by f.created_at desc;
end;
$$;

-- How many people registered for each event (to show how many have replied).
create or replace function public.president_feedback_registrations()
returns table (event_slug text, registered bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.feedback_can_read() then
    raise exception 'Not authorized';
  end if;
  return query select r.event_slug, count(*) from public.event_registrations r group by r.event_slug;
end;
$$;

create or replace function public.president_delete_feedback(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.feedback_can_read() then
    raise exception 'Not authorized';
  end if;
  delete from public.event_feedback where id = p_id;
end;
$$;

revoke all on function public.president_get_feedback() from public, anon;
revoke all on function public.president_feedback_registrations() from public, anon;
revoke all on function public.president_delete_feedback(uuid) from public, anon;
grant execute on function public.president_get_feedback() to authenticated;
grant execute on function public.president_feedback_registrations() to authenticated;
grant execute on function public.president_delete_feedback(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Audiences for the Email section
-- Everyone registered for any event (the page narrows to one event).
create or replace function public.email_event_registrants()
returns table (event_slug text, email text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.feedback_can_read()
          or coalesce(public.has_hub_access('dash_email'), false)
          or coalesce(public.has_hub_access('dash_events'), false)) then
    raise exception 'Not authorized';
  end if;
  return query
    select r.event_slug, lower(u.email::text)
    from public.event_registrations r
    join auth.users u on u.id = r.member_id
    where u.email is not null;
end;
$$;

-- Guests who left feedback (only those who ticked "keep me posted" are marked).
create or replace function public.email_feedback_guests()
returns table (email text, full_name text, wants_updates boolean, event_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.feedback_can_read() or coalesce(public.has_hub_access('dash_email'), false)) then
    raise exception 'Not authorized';
  end if;
  return query
    select f.guest_email, f.guest_name, f.wants_updates, f.event_name
    from public.event_feedback f
    where f.respondent = 'guest' and f.guest_email is not null
    order by f.created_at desc;
end;
$$;

revoke all on function public.email_event_registrants() from public, anon;
revoke all on function public.email_feedback_guests() from public, anon;
grant execute on function public.email_event_registrants() to authenticated;
grant execute on function public.email_feedback_guests() to authenticated;

-- ---------------------------------------------------------------------
-- 5. Rewards for members: 10 XP per event reviewed, a badge for three
insert into public.member_badge_defs (key, name, description, hint, icon, sort_order) values
  ('feedback_giver', 'Palaver Tree', 'Gave feedback on three events. In many West African villages people gather under the palaver tree to talk things through and be heard.', 'Give feedback on 3 events', '🌳', 23)
on conflict (key) do update
  set name = excluded.name, description = excluded.description, hint = excluded.hint,
      icon = excluded.icon, sort_order = excluded.sort_order;

do $$
declare
  def text;
  patched text;
  a1 constant text := E'  -- ---- News ----';
  a2 constant text := E'  if (counts ->> ''chat_first'') is not null then keys := array_append(keys, ''connector''); end if;';
  b1 constant text := E'  -- ---- Event feedback ----
  for r in select f.event_slug as ref, f.created_at as at from public.event_feedback f
           where f.user_id = me order by f.created_at limit 12 loop
    perform public.journey__grant(me, ''event_feedback'', r.ref, 10, r.at);
  end loop;

';
  b2 constant text := E'
  if coalesce((counts ->> ''event_feedback'')::int, 0) >= 3 then keys := array_append(keys, ''feedback_giver''); end if;';
begin
  select pg_get_functiondef('public.journey__state(uuid, boolean)'::regprocedure) into def;
  if def is null then
    raise notice 'journey__state not found - skipping the feedback rewards (run 088 and 094, then this file again).';
    return;
  end if;
  if position('event_feedback' in def) > 0 then
    raise notice 'journey__state already has the feedback rewards.';
    return;
  end if;
  if position(a1 in def) = 0 or position(a2 in def) = 0 then
    raise exception 'journey__state is not in the expected shape - cannot add the feedback rewards.';
  end if;
  patched := replace(def, a1, b1 || a1);
  patched := replace(patched, a2, a2 || b2);
  execute patched;
end;
$$;

commit;
