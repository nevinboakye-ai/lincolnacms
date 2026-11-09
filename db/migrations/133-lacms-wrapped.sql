-- 133: LACMS Wrapped - everyone votes on what goes into the Semester One Wrapped
--
-- A Wrapped-style look back at the semester. Before it is made, members and non-members vote on what should be in it:
-- Member of the Semester, the favourite event, the moment and song of the semester, what LACMS means to people, what
-- Semester Two should have more of, and a rating. No account is needed.
--
-- How a vote works
--   * One ballot per email address. The address is turned into a scrambled (hashed) code and is never stored in
--     the clear. Answers are saved against the ballot, never against a name or an email, so a vote cannot be traced
--     to a person. Throwaway email domains are refused (same rules as the Unity Cup votes).
--   * Every question is optional; a ballot needs at least one answer. People also say whether they are a member
--     (member / not a member / not sure), so the Wrapped can show both groups.
--   * Votes are hidden from the public. The committee watches the tallies in Dashboard -> LACMS Wrapped and can
--     switch on "show results" when the Wrapped is ready.
--   * The scrambled emails can be removed once voting is over (Dashboard -> LACMS Wrapped -> Tidy up).
--
-- What is in the database
--   wrapped_campaigns   one row per Wrapped (title, open / closed, closing time, show results, the event window)
--   wrapped_categories  the questions: write-in, pick one, pick several, or a 1-10 rating
--   wrapped_options     the answers to pick from (the "favourite event" question builds its list from the Events table)
--   wrapped_ballots     one per voter (scrambled email, member or not)
--   wrapped_answers     what each ballot answered
-- and a Hub Access feature "dash_wrapped" so the committee can be given the Wrapped panel like any other dashboard section.
--
-- Needs 114 (the email checks), 058 and 080 (events) and 060 (Hub Access). Safe to run more than once.

begin;

-- ---------------------------------------------------------------------
-- Tables
create table if not exists public.wrapped_campaigns (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title text not null default 'LACMS Wrapped' check (char_length(title) <= 60),
  subtitle text check (subtitle is null or char_length(subtitle) <= 60),
  intro text check (intro is null or char_length(intro) <= 300),
  is_current boolean not null default false,
  open boolean not null default true,
  closes_at timestamptz,
  show_results boolean not null default false,
  events_from date,
  events_to date,
  created_at timestamptz not null default now()
);
create unique index if not exists wrapped_one_current on public.wrapped_campaigns (is_current) where is_current;

create table if not exists public.wrapped_categories (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.wrapped_campaigns (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]+$'),
  title text not null check (char_length(title) <= 60),
  prompt text not null check (char_length(prompt) <= 200),
  kind text not null check (kind in ('write_in', 'choice', 'multi', 'rating')),
  option_source text not null default 'list' check (option_source in ('list', 'events')),
  allow_other boolean not null default true,
  max_picks int not null default 3 check (max_picks between 1 and 10),
  max_len int not null default 80 check (max_len between 5 and 200),
  placeholder text check (placeholder is null or char_length(placeholder) <= 80),
  emoji text check (emoji is null or char_length(emoji) <= 8),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (campaign_id, key)
);

create table if not exists public.wrapped_options (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.wrapped_categories (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists wrapped_options_category on public.wrapped_options (category_id, sort);

create table if not exists public.wrapped_ballots (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.wrapped_campaigns (id) on delete cascade,
  voter_hash text,                       -- scrambled email; set to null by "Tidy up" once voting is over
  member_status text not null default 'unsure' check (member_status in ('member', 'not_member', 'unsure')),
  created_at timestamptz not null default now(),
  unique (campaign_id, voter_hash)
);
create index if not exists wrapped_ballots_campaign on public.wrapped_ballots (campaign_id, created_at);

create table if not exists public.wrapped_answers (
  id bigserial primary key,
  ballot_id uuid not null references public.wrapped_ballots (id) on delete cascade,
  category_id uuid not null references public.wrapped_categories (id) on delete cascade,
  answer_key text not null,              -- 'o:<option id>', 'e:<event slug>', 't:<typed text, lower case>' or 'r' (a rating)
  text_value text check (text_value is null or char_length(text_value) <= 200),
  rating int check (rating is null or rating between 1 and 10),
  unique (ballot_id, category_id, answer_key)
);
create index if not exists wrapped_answers_category on public.wrapped_answers (category_id, answer_key);

alter table public.wrapped_campaigns enable row level security;
alter table public.wrapped_categories enable row level security;
alter table public.wrapped_options enable row level security;
alter table public.wrapped_ballots enable row level security;
alter table public.wrapped_answers enable row level security;
revoke all on public.wrapped_campaigns, public.wrapped_categories, public.wrapped_options, public.wrapped_ballots, public.wrapped_answers from anon, authenticated;
revoke all on sequence public.wrapped_answers_id_seq from anon, authenticated;

-- ---------------------------------------------------------------------
-- Hub Access: who besides the president may run the Wrapped panel (closed by default)
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
      'dash_feedback_edit', 'dash_feedback_public', 'dash_unity', 'dash_wrapped'
    ])
  ) x;
  alter table public.hub_access_rules drop constraint if exists hub_access_rules_feature_check;
  execute 'alter table public.hub_access_rules add constraint hub_access_rules_feature_check check (feature in (' || names || '))';
end;
$$;

insert into public.hub_access_rules (feature, allow_members, allow_professionals, member_types, courses, titles, blocked_display)
values ('dash_wrapped', false, false, null, null, null, 'hidden')
on conflict (feature) do nothing;

create or replace function public.wrapped_can_manage()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_president(), false) or coalesce(public.has_hub_access('dash_wrapped'), false);
$$;
revoke all on function public.wrapped_can_manage() from public, anon;
grant execute on function public.wrapped_can_manage() to authenticated;

create or replace function public.wrapped__require_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.wrapped_can_manage() then raise exception 'Not allowed.' using errcode = '42501'; end if;
end;
$$;
revoke all on function public.wrapped__require_admin() from public, anon;
grant execute on function public.wrapped__require_admin() to authenticated;

-- ---------------------------------------------------------------------
-- The first Wrapped and its questions (only added if there is no Wrapped yet)
insert into public.wrapped_campaigns (slug, title, subtitle, intro, is_current, open, events_from, events_to)
values ('semester-one-2026', 'LACMS Wrapped', 'Semester One', 'Help us decide what goes into our Semester One Wrapped. It takes about a minute, and every question is optional.', true, true, date '2026-08-01', date '2027-01-31')
on conflict (slug) do nothing;

do $$
declare c uuid; q uuid;
begin
  select id into c from public.wrapped_campaigns where slug = 'semester-one-2026';
  if c is null or exists (select 1 from public.wrapped_categories where campaign_id = c) then return; end if;

  insert into public.wrapped_categories (campaign_id, key, title, prompt, kind, option_source, allow_other, max_len, placeholder, emoji, sort) values
    (c, 'member_of_semester', 'Member of the Semester', 'Who made your semester? Name the member who went above and beyond.', 'write_in', 'list', false, 60, 'A name…', '🌟', 10),
    (c, 'favourite_event',   'Favourite event', 'Which event was your favourite this semester?', 'choice', 'events', true, 60, null, '🎉', 20),
    (c, 'moment',            'Moment of the semester', 'What is the one moment you will remember from Semester One?', 'write_in', 'list', false, 140, 'A moment, a night, a laugh…', '📸', 30),
    (c, 'song',              'Song of the semester', 'What song soundtracked your semester?', 'write_in', 'list', false, 80, 'Song, Artist', '🎵', 40),
    (c, 'one_word',          'One word for LACMS', 'Sum up LACMS this semester in one word.', 'write_in', 'list', false, 24, 'One word', '💬', 50),
    (c, 'best_part',         'What you value most', 'What do you value most about LACMS?', 'choice', 'list', true, 60, null, '💛', 60),
    (c, 'wishlist',          'Semester Two wishlist', 'What should Semester Two have more of? Pick up to three.', 'multi', 'list', true, 60, null, '🔮', 70);
  update public.wrapped_categories set max_picks = 3 where campaign_id = c and key = 'wishlist';
  insert into public.wrapped_categories (campaign_id, key, title, prompt, kind, option_source, allow_other, emoji, sort)
    values (c, 'rating', 'Rate your semester', 'How would you rate your semester with LACMS, from 1 to 10?', 'rating', 'list', false, '⭐', 80);

  select id into q from public.wrapped_categories where campaign_id = c and key = 'best_part';
  insert into public.wrapped_options (category_id, label, sort) values
    (q, 'The community and friendships', 10), (q, 'The events', 20), (q, 'Sankofa mentoring', 30), (q, 'The Network and connections', 40),
    (q, 'The opportunities and perks', 50), (q, 'Feeling represented', 60), (q, 'Meeting new people', 70);

  select id into q from public.wrapped_categories where campaign_id = c and key = 'wishlist';
  insert into public.wrapped_options (category_id, label, sort) values
    (q, 'Social nights', 10), (q, 'Sports and fitness', 20), (q, 'Study sessions and revision', 30), (q, 'Careers talks and panels', 40),
    (q, 'Charity fundraisers', 50), (q, 'Cultural celebrations', 60), (q, 'Mentoring and Sankofa Circles', 70),
    (q, 'Trips and days out', 80), (q, 'Skills workshops (CVs, interviews)', 90), (q, 'Food and cooking events', 100);
end;
$$;

-- ---------------------------------------------------------------------
-- Helpers
-- The answers a person can pick for one question, as JSON: [{key, label, date?}]
create or replace function public.wrapped__options_json(k public.wrapped_categories, c public.wrapped_campaigns)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when k.kind not in ('choice', 'multi') then '[]'::jsonb
    when k.option_source = 'events' then coalesce((
      select jsonb_agg(jsonb_build_object('key', 'e:' || e.slug, 'label', e.name, 'date', e.date_text) order by e.starts_on, e.sort_order)
        from public.site_events e
       where e.is_active and e.starts_on is not null
         and e.starts_on >= coalesce(c.events_from, date '0001-01-01')
         and e.starts_on <= least(coalesce(c.events_to, date '9999-12-31'), current_date)), '[]'::jsonb)
    else coalesce((
      select jsonb_agg(jsonb_build_object('key', 'o:' || o.id, 'label', o.label) order by o.sort, o.created_at)
        from public.wrapped_options o where o.category_id = k.id and o.active), '[]'::jsonb)
  end;
$$;
revoke all on function public.wrapped__options_json(public.wrapped_categories, public.wrapped_campaigns) from public, anon, authenticated;

-- The results for one question: the most popular answers (or the average and spread of a rating)
create or replace function public.wrapped__tally(p_category uuid, p_limit int default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare k public.wrapped_categories%rowtype; v_answered int; v_items jsonb; v_avg numeric; v_dist jsonb;
begin
  select * into k from public.wrapped_categories where id = p_category;
  if not found then return null; end if;
  select count(distinct a.ballot_id) into v_answered from public.wrapped_answers a where a.category_id = p_category;
  if k.kind = 'rating' then
    select round(avg(a.rating)::numeric, 2) into v_avg from public.wrapped_answers a where a.category_id = p_category and a.rating is not null;
    select coalesce(jsonb_object_agg(x.r::text, x.n), '{}'::jsonb) into v_dist
      from (select a.rating as r, count(*) as n from public.wrapped_answers a where a.category_id = p_category and a.rating is not null group by a.rating) x;
    return jsonb_build_object('key', k.key, 'kind', k.kind, 'answered', v_answered, 'avg', v_avg, 'dist', v_dist);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('key', t.answer_key, 'label', t.label, 'votes', t.votes) order by t.votes desc, t.label), '[]'::jsonb) into v_items
    from (
      select a.answer_key,
             case left(a.answer_key, 2)
               when 'o:' then coalesce((select o.label from public.wrapped_options o where o.id = substr(a.answer_key, 3)::uuid), 'A removed option')
               when 'e:' then coalesce((select e.name from public.site_events e where e.slug = substr(a.answer_key, 3)), substr(a.answer_key, 3))
               else (mode() within group (order by a.text_value))
             end as label,
             count(*) as votes
        from public.wrapped_answers a
       where a.category_id = p_category
       group by a.answer_key
       order by count(*) desc, a.answer_key
       limit greatest(1, p_limit)) t;
  return jsonb_build_object('key', k.key, 'kind', k.kind, 'answered', v_answered, 'items', v_items);
end;
$$;
revoke all on function public.wrapped__tally(uuid, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Public: is the Wrapped open? (tiny, for the homepage and welcome screen)
create or replace function public.wrapped_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare c public.wrapped_campaigns%rowtype;
begin
  select * into c from public.wrapped_campaigns where is_current limit 1;
  if not found then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'title', c.title, 'subtitle', c.subtitle,
    'open', c.open and (c.closes_at is null or now() < c.closes_at), 'closes_at', c.closes_at, 'show_results', c.show_results,
    'ballots', (select count(*) from public.wrapped_ballots b where b.campaign_id = c.id));
end;
$$;
revoke all on function public.wrapped_status() from public;
grant execute on function public.wrapped_status() to anon, authenticated;

-- Public: everything the voting page needs (and the results, once the committee has switched them on)
create or replace function public.wrapped_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare c public.wrapped_campaigns%rowtype; v_open boolean;
begin
  select * into c from public.wrapped_campaigns where is_current limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'none'); end if;
  v_open := c.open and (c.closes_at is null or now() < c.closes_at);
  return jsonb_build_object(
    'ok', true, 'now', now(),
    'campaign', jsonb_build_object('title', c.title, 'subtitle', c.subtitle, 'intro', c.intro, 'open', v_open, 'closes_at', c.closes_at,
                                   'show_results', c.show_results, 'ballots', (select count(*) from public.wrapped_ballots b where b.campaign_id = c.id)),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('key', k.key, 'title', k.title, 'prompt', k.prompt, 'kind', k.kind, 'allow_other', k.allow_other,
                                          'max_picks', k.max_picks, 'max_len', k.max_len, 'placeholder', k.placeholder, 'emoji', k.emoji,
                                          'options', public.wrapped__options_json(k, c)) order by k.sort, k.created_at)
        from public.wrapped_categories k where k.campaign_id = c.id and k.active), '[]'::jsonb),
    'results', case when c.show_results then coalesce((
      select jsonb_object_agg(k.key, public.wrapped__tally(k.id, 5))
        from public.wrapped_categories k where k.campaign_id = c.id and k.active), '{}'::jsonb) else null end);
end;
$$;
revoke all on function public.wrapped_get() from public;
grant execute on function public.wrapped_get() to anon, authenticated;

-- Public: send in a ballot. p_answers is {question key: answer}:
--   write-in -> text; pick one -> "o:<option id>", "e:<event slug>" or "other:<text>"; pick several -> a list of those; rating -> 1 to 10.
create or replace function public.wrapped_submit(p_email text, p_member text, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c public.wrapped_campaigns%rowtype; k public.wrapped_categories%rowtype;
  h text; v_ballot uuid; v_n int := 0; v_val jsonb; v_items jsonb; v_item text; v_txt text; v_picks int; v_num int; v_id uuid;
  v_member text := case when p_member in ('member', 'not_member', 'unsure') then p_member else 'unsure' end;
begin
  select * into c from public.wrapped_campaigns where is_current limit 1;
  if not found or not (c.open and (c.closes_at is null or now() < c.closes_at)) then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if not public.unity_email_ok(btrim(coalesce(p_email, ''))) then return jsonb_build_object('ok', false, 'error', 'bad_email'); end if;
  if public.unity_disposable(p_email) then return jsonb_build_object('ok', false, 'error', 'disposable'); end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then return jsonb_build_object('ok', false, 'error', 'empty'); end if;
  if (select count(*) from public.wrapped_ballots where created_at > now() - interval '1 minute') >= 90 then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  h := public.unity_email_hash(p_email);
  begin
    insert into public.wrapped_ballots (campaign_id, voter_hash, member_status) values (c.id, h, v_member) returning id into v_ballot;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already_voted');
  end;

  for k in select * from public.wrapped_categories where campaign_id = c.id and active order by sort loop
    v_val := p_answers -> k.key;
    if v_val is null or v_val = 'null'::jsonb or v_val = '""'::jsonb or v_val = '[]'::jsonb then continue; end if;

    if k.kind = 'write_in' then
      v_txt := left(btrim(regexp_replace(regexp_replace(coalesce(v_val #>> '{}', ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), k.max_len);
      if char_length(v_txt) >= 1 then
        insert into public.wrapped_answers (ballot_id, category_id, answer_key, text_value) values (v_ballot, k.id, 't:' || lower(v_txt), v_txt) on conflict do nothing;
        v_n := v_n + 1;
      end if;

    elsif k.kind = 'rating' then
      begin v_num := (v_val #>> '{}')::int; exception when others then v_num := null; end;
      if v_num between 1 and 10 then
        insert into public.wrapped_answers (ballot_id, category_id, answer_key, rating) values (v_ballot, k.id, 'r', v_num) on conflict do nothing;
        v_n := v_n + 1;
      end if;

    else   -- choice / multi
      v_items := case when jsonb_typeof(v_val) = 'array' then v_val else jsonb_build_array(v_val) end;
      v_picks := 0;
      for v_item in select jsonb_array_elements_text(v_items) loop
        exit when v_picks >= case when k.kind = 'choice' then 1 else k.max_picks end;
        if v_item like 'o:%' and k.option_source = 'list' then
          begin v_id := substr(v_item, 3)::uuid; exception when others then v_id := null; end;
          if v_id is not null and exists (select 1 from public.wrapped_options o where o.id = v_id and o.category_id = k.id and o.active) then
            insert into public.wrapped_answers (ballot_id, category_id, answer_key) values (v_ballot, k.id, 'o:' || v_id) on conflict do nothing;
            v_picks := v_picks + 1; v_n := v_n + 1;
          end if;
        elsif v_item like 'e:%' and k.option_source = 'events' then
          if exists (select 1 from jsonb_array_elements(public.wrapped__options_json(k, c)) x where x ->> 'key' = v_item) then
            insert into public.wrapped_answers (ballot_id, category_id, answer_key) values (v_ballot, k.id, v_item) on conflict do nothing;
            v_picks := v_picks + 1; v_n := v_n + 1;
          end if;
        elsif v_item like 'other:%' and k.allow_other then
          v_txt := left(btrim(regexp_replace(regexp_replace(substr(v_item, 7), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), k.max_len);
          if char_length(v_txt) >= 1 then
            insert into public.wrapped_answers (ballot_id, category_id, answer_key, text_value) values (v_ballot, k.id, 't:' || lower(v_txt), v_txt) on conflict do nothing;
            v_picks := v_picks + 1; v_n := v_n + 1;
          end if;
        end if;
      end loop;
    end if;
  end loop;

  if v_n = 0 then
    delete from public.wrapped_ballots where id = v_ballot;
    return jsonb_build_object('ok', false, 'error', 'empty');
  end if;
  return jsonb_build_object('ok', true, 'answers', v_n);
end;
$$;
revoke all on function public.wrapped_submit(text, text, jsonb) from public;
grant execute on function public.wrapped_submit(text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Committee
create or replace function public.wrapped_admin_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare c public.wrapped_campaigns%rowtype;
begin
  perform public.wrapped__require_admin();
  select * into c from public.wrapped_campaigns where is_current limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'none'); end if;
  return jsonb_build_object(
    'ok', true, 'now', now(),
    'campaign', to_jsonb(c) || jsonb_build_object('is_open_now', c.open and (c.closes_at is null or now() < c.closes_at)),
    'ballots', jsonb_build_object(
      'total', (select count(*) from public.wrapped_ballots b where b.campaign_id = c.id),
      'member', (select count(*) from public.wrapped_ballots b where b.campaign_id = c.id and b.member_status = 'member'),
      'not_member', (select count(*) from public.wrapped_ballots b where b.campaign_id = c.id and b.member_status = 'not_member'),
      'unsure', (select count(*) from public.wrapped_ballots b where b.campaign_id = c.id and b.member_status = 'unsure'),
      'with_email', (select count(*) from public.wrapped_ballots b where b.campaign_id = c.id and b.voter_hash is not null)),
    'categories', coalesce((
      select jsonb_agg(to_jsonb(k) || jsonb_build_object(
               'options', coalesce((select jsonb_agg(to_jsonb(o) order by o.sort, o.created_at) from public.wrapped_options o where o.category_id = k.id), '[]'::jsonb),
               'event_options', case when k.option_source = 'events' then public.wrapped__options_json(k, c) else '[]'::jsonb end,
               'tally', public.wrapped__tally(k.id, 15)) order by k.sort, k.created_at)
        from public.wrapped_categories k where k.campaign_id = c.id), '[]'::jsonb));
end;
$$;
revoke all on function public.wrapped_admin_get() from public, anon;
grant execute on function public.wrapped_admin_get() to authenticated;

create or replace function public.wrapped_admin_save_campaign(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.wrapped__require_admin();
  update public.wrapped_campaigns set
    title = coalesce(nullif(btrim(p ->> 'title'), ''), title),
    subtitle = case when p ? 'subtitle' then nullif(btrim(p ->> 'subtitle'), '') else subtitle end,
    intro = case when p ? 'intro' then nullif(btrim(p ->> 'intro'), '') else intro end,
    open = coalesce((p ->> 'open')::boolean, open),
    closes_at = case when p ? 'closes_at' then nullif(p ->> 'closes_at', '')::timestamptz else closes_at end,
    show_results = coalesce((p ->> 'show_results')::boolean, show_results),
    events_from = case when p ? 'events_from' then nullif(p ->> 'events_from', '')::date else events_from end,
    events_to = case when p ? 'events_to' then nullif(p ->> 'events_to', '')::date else events_to end
   where is_current;
end;
$$;
revoke all on function public.wrapped_admin_save_campaign(jsonb) from public, anon;
grant execute on function public.wrapped_admin_save_campaign(jsonb) to authenticated;

-- Change a question, or add one (p_id null: p needs title, prompt and kind)
create or replace function public.wrapped_admin_save_category(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare c uuid; v_key text; v_id uuid := p_id;
begin
  perform public.wrapped__require_admin();
  if v_id is null then
    select id into c from public.wrapped_campaigns where is_current limit 1;
    if c is null then raise exception 'There is no Wrapped to add a question to.'; end if;
    v_key := left(regexp_replace(lower(btrim(coalesce(p ->> 'title', 'question'))), '[^a-z0-9]+', '_', 'g'), 30);
    v_key := trim(both '_' from v_key); if v_key = '' then v_key := 'question'; end if;
    if exists (select 1 from public.wrapped_categories where campaign_id = c and key = v_key) then v_key := left(v_key, 24) || '_' || substr(md5(random()::text), 1, 5); end if;
    insert into public.wrapped_categories (campaign_id, key, title, prompt, kind, sort)
    values (c, v_key, btrim(p ->> 'title'), btrim(p ->> 'prompt'), p ->> 'kind', coalesce((select max(sort) + 10 from public.wrapped_categories where campaign_id = c), 10))
    returning id into v_id;
  end if;
  update public.wrapped_categories set
    title = coalesce(nullif(btrim(p ->> 'title'), ''), title),
    prompt = coalesce(nullif(btrim(p ->> 'prompt'), ''), prompt),
    emoji = case when p ? 'emoji' then nullif(btrim(p ->> 'emoji'), '') else emoji end,
    placeholder = case when p ? 'placeholder' then nullif(btrim(p ->> 'placeholder'), '') else placeholder end,
    active = coalesce((p ->> 'active')::boolean, active),
    allow_other = coalesce((p ->> 'allow_other')::boolean, allow_other),
    max_picks = coalesce((p ->> 'max_picks')::int, max_picks),
    max_len = coalesce((p ->> 'max_len')::int, max_len),
    option_source = coalesce(nullif(p ->> 'option_source', ''), option_source),
    sort = coalesce((p ->> 'sort')::int, sort)
   where id = v_id;
  return v_id;
end;
$$;
revoke all on function public.wrapped_admin_save_category(uuid, jsonb) from public, anon;
grant execute on function public.wrapped_admin_save_category(uuid, jsonb) to authenticated;

create or replace function public.wrapped_admin_delete_category(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.wrapped__require_admin();
  delete from public.wrapped_categories where id = p_id;
end;
$$;
revoke all on function public.wrapped_admin_delete_category(uuid) from public, anon;
grant execute on function public.wrapped_admin_delete_category(uuid) to authenticated;

create or replace function public.wrapped_admin_save_option(p_category uuid, p_id uuid, p_label text, p_active boolean default true)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid := p_id; v_label text := left(btrim(coalesce(p_label, '')), 80);
begin
  perform public.wrapped__require_admin();
  if char_length(v_label) < 1 then raise exception 'Type the answer first.'; end if;
  if v_id is null then
    insert into public.wrapped_options (category_id, label, sort, active)
    values (p_category, v_label, coalesce((select max(sort) + 10 from public.wrapped_options where category_id = p_category), 10), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.wrapped_options set label = v_label, active = coalesce(p_active, active) where id = v_id and category_id = p_category;
  end if;
  return v_id;
end;
$$;
revoke all on function public.wrapped_admin_save_option(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.wrapped_admin_save_option(uuid, uuid, text, boolean) to authenticated;

create or replace function public.wrapped_admin_delete_option(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.wrapped__require_admin();
  delete from public.wrapped_options where id = p_id;
end;
$$;
revoke all on function public.wrapped_admin_delete_option(uuid) from public, anon;
grant execute on function public.wrapped_admin_delete_option(uuid) to authenticated;

-- Testing: throw away every vote (the questions stay)
create or replace function public.wrapped_admin_reset()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.wrapped__require_admin();
  delete from public.wrapped_ballots b using public.wrapped_campaigns c where c.id = b.campaign_id and c.is_current;
end;
$$;
revoke all on function public.wrapped_admin_reset() from public, anon;
grant execute on function public.wrapped_admin_reset() to authenticated;

-- After voting: forget the scrambled emails (the answers stay, they were never linked to a person)
create or replace function public.wrapped_admin_tidy()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  perform public.wrapped__require_admin();
  update public.wrapped_ballots b set voter_hash = null
    from public.wrapped_campaigns c
   where c.id = b.campaign_id and c.is_current and not (c.open and (c.closes_at is null or now() < c.closes_at)) and b.voter_hash is not null;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.wrapped_admin_tidy() from public, anon;
grant execute on function public.wrapped_admin_tidy() to authenticated;

commit;
