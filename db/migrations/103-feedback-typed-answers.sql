-- 103: Typed answers on the feedback form, and "who made the night valuable?"
--
-- On the feedback form, "What went well?" and "What could be better?" keep their tap-to-pick
-- reasons and now also take a few typed words ("Something else?"). A new optional question
-- asks who made the night valuable (names of people or teams).
--
--   * event_feedback.liked_other / improve_other / shoutouts (each up to 300 characters)
--   * The committee's Feedback section shows them (and counts the most-thanked names).
--   * Partner spaces: typed answers appear with the comments, under the same rules (only what
--     people were happy to have quoted unless every comment is shown; never a response held back
--     from partners). The thank-you names appear only if the space has "Shout-outs" switched on
--     (off by default, because they name individuals).
--   * submit_event_feedback() is replaced by a version that takes the three new answers.
--
-- Safe to run more than once. Needs 100 and 101.

begin;

alter table public.event_feedback add column if not exists liked_other text check (liked_other is null or char_length(liked_other) <= 300);
alter table public.event_feedback add column if not exists improve_other text check (improve_other is null or char_length(improve_other) <= 300);
alter table public.event_feedback add column if not exists shoutouts text check (shoutouts is null or char_length(shoutouts) <= 300);
alter table public.partner_spaces add column if not exists show_shoutouts boolean not null default false;

drop function if exists public.submit_event_feedback(text, integer, text[], text[], text, text, text, text, boolean, boolean, text, text, text, boolean, text, text);

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
  p_website text default null,
  p_source text default null,
  p_liked_other text default null,
  p_improve_other text default null,
  p_shoutouts text default null
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
  src text;
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
  p_liked_other := nullif(btrim(coalesce(p_liked_other, '')), '');
  p_improve_other := nullif(btrim(coalesce(p_improve_other, '')), '');
  p_shoutouts := nullif(btrim(coalesce(p_shoutouts, '')), '');
  if char_length(coalesce(p_liked_other, '')) > 300 or char_length(coalesce(p_improve_other, '')) > 300 or char_length(coalesce(p_shoutouts, '')) > 300 then
    raise exception 'Please keep each typed answer under 300 characters.';
  end if;

  -- Only a real partner's code is kept.
  src := lower(btrim(coalesce(p_source, '')));
  if src !~ '^[a-z0-9]{4,16}$' or not exists (select 1 from public.partner_spaces ps where ps.source_code = src) then
    src := null;
  end if;

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
    rating, liked, improve, comment, would_return, heard_from, suggestion, anonymous, quote_ok, wants_updates, source,
    liked_other, improve_other, shoutouts
  ) values (
    p_event_slug, ev_name, case when who = 'guest' then null else me end, who, g_email, g_name, p_guest_kind, my_course, my_year,
    p_rating, p_liked, p_improve, p_comment, p_would_return, p_heard_from, p_suggestion,
    coalesce(p_anonymous, false) and who <> 'guest', coalesce(p_quote_ok, false), coalesce(p_wants_updates, false), src,
    p_liked_other, p_improve_other, p_shoutouts
  )
  on conflict do nothing
  returning id into new_id;

  return jsonb_build_object('ok', true, 'already', new_id is null, 'member', who <> 'guest', 'respondent', who);
end;
$$;

revoke all on function public.submit_event_feedback(text, integer, text[], text[], text, text, text, text, boolean, boolean, text, text, text, boolean, text, text, text, text, text) from public;
grant execute on function public.submit_event_feedback(text, integer, text[], text[], text, text, text, text, boolean, boolean, text, text, text, boolean, text, text, text, text, text) to anon, authenticated;

drop function if exists public.president_get_feedback() cascade;
create function public.president_get_feedback()
returns table (
  id uuid, event_slug text, event_name text, created_at timestamptz, respondent text,
  person_name text, person_email text, course text, year_of_study text, guest_kind text,
  rating integer, liked text[], improve text[], comment text, would_return text, heard_from text,
  suggestion text, anonymous boolean, quote_ok boolean, wants_updates boolean, partner_hidden boolean,
  liked_other text, improve_other text, shoutouts text
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
           f.suggestion, f.anonymous, f.quote_ok, f.wants_updates, f.partner_hidden,
           f.liked_other, f.improve_other, f.shoutouts
    from public.event_feedback f
    order by f.created_at desc;
end;
$$;
revoke all on function public.president_get_feedback() from public, anon;
grant execute on function public.president_get_feedback() to authenticated;

-- Partner pages: typed answers and (optionally) thank-you names.
drop function if exists public.partner_event_stats(text[], text, boolean, boolean, boolean, text);
create or replace function public.partner_event_stats(
  p_slugs text[], p_comments text, p_ideas boolean, p_heard boolean, p_audience boolean, p_source text, p_shoutouts boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  n integer;
  res jsonb;
begin
  select count(*) into n from public.event_feedback f where f.event_slug = any (p_slugs);
  res := jsonb_build_object('responses', n);
  if n = 0 then
    return res || jsonb_build_object('rating_dist', jsonb_build_array(0, 0, 0, 0, 0));
  end if;

  res := res || jsonb_build_object(
    'avg_rating', (select round(avg(f.rating)::numeric, 2) from public.event_feedback f where f.event_slug = any (p_slugs)),
    'rating_dist', (
      select jsonb_agg(coalesce(c.n, 0) order by g.v)
      from generate_series(1, 5) g(v)
      left join (select f.rating, count(*)::int as n from public.event_feedback f where f.event_slug = any (p_slugs) group by f.rating) c on c.rating = g.v),
    'would', (
      select jsonb_build_object(
        'yes', count(*) filter (where f.would_return = 'yes'),
        'maybe', count(*) filter (where f.would_return = 'maybe'),
        'no', count(*) filter (where f.would_return = 'no'))
      from public.event_feedback f where f.event_slug = any (p_slugs)),
    'respondents', (
      select jsonb_build_object(
        'member', count(*) filter (where f.respondent = 'member'),
        'professional', count(*) filter (where f.respondent = 'professional'),
        'guest', count(*) filter (where f.respondent = 'guest'))
      from public.event_feedback f where f.event_slug = any (p_slugs)),
    'liked', coalesce((
      select jsonb_object_agg(x.k, x.c) from (
        select k, count(*) as c from public.event_feedback f, unnest(f.liked) k where f.event_slug = any (p_slugs) group by k) x), '{}'::jsonb),
    'improve', coalesce((
      select jsonb_object_agg(x.k, x.c) from (
        select k, count(*) as c from public.event_feedback f, unnest(f.improve) k where f.event_slug = any (p_slugs) group by k) x), '{}'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('d', x.d, 'n', x.c) order by x.d) from (
        select to_char(f.created_at at time zone 'Europe/London', 'YYYY-MM-DD') as d, count(*) as c
        from public.event_feedback f where f.event_slug = any (p_slugs) group by 1) x), '[]'::jsonb),
    'via_partner', (select count(*) from public.event_feedback f where f.event_slug = any (p_slugs) and p_source is not null and f.source = p_source)
  );

  if p_heard then
    res := res || jsonb_build_object('heard', coalesce((
      select jsonb_object_agg(x.k, x.c) from (
        select f.heard_from as k, count(*) as c from public.event_feedback f
        where f.event_slug = any (p_slugs) and f.heard_from is not null group by 1) x), '{}'::jsonb));
  end if;

  if p_ideas then
    res := res || jsonb_build_object('ideas', coalesce((
      select jsonb_agg(x.suggestion) from (
        select f.suggestion from public.event_feedback f
        where f.event_slug = any (p_slugs) and f.suggestion is not null and not f.partner_hidden
        order by f.created_at desc limit 20) x), '[]'::jsonb));
  end if;

  -- Breakdowns only once there are enough replies to be anonymous.
  if p_audience and n >= 5 then
    res := res || jsonb_build_object(
      'guest_kinds', coalesce((
        select jsonb_agg(jsonb_build_object('k', y.k, 'n', y.c) order by y.c desc) from (
          select case when x.c >= 3 then x.k else 'other' end as k, sum(x.c)::int as c from (
            select coalesce(f.guest_kind, 'other') as k, count(*) as c from public.event_feedback f
            where f.event_slug = any (p_slugs) and f.respondent = 'guest' group by 1) x
          group by 1) y), '[]'::jsonb),
      'courses', coalesce((
        select jsonb_agg(jsonb_build_object('label', y.label, 'n', y.c) order by (y.label = 'Other'), y.c desc) from (
          select case when x.c >= 3 then x.label else 'Other' end as label, sum(x.c)::int as c from (
            select case when f.anonymous or f.member_course is null or public.is_sixth_form_profile(f.member_course, f.member_year)
                        then 'Other' else btrim(f.member_course) end as label, count(*) as c
            from public.event_feedback f
            where f.event_slug = any (p_slugs) and f.respondent in ('member', 'professional') group by 1) x
          group by 1) y), '[]'::jsonb));
  end if;

  if p_comments <> 'none' then
    res := res || jsonb_build_object('comments', coalesce((
      select jsonb_agg(jsonb_build_object('rating', x.rating, 'text', x.comment, 'at', x.d, 'who', x.respondent) order by x.created_at desc)
      from (
        select f.rating, f.comment, f.respondent, f.created_at, to_char(f.created_at at time zone 'Europe/London', 'YYYY-MM-DD') as d
        from public.event_feedback f
        where f.event_slug = any (p_slugs) and f.comment is not null and not f.partner_hidden
          and (p_comments = 'all' or f.quote_ok)
        order by f.created_at desc limit 200) x), '[]'::jsonb));
  end if;

  -- Typed answers and thank-yous follow the same rules as comments: only what people were happy
  -- to have quoted (unless every comment is shown), and never a response held back from partners.
  if p_comments <> 'none' then
    res := res || jsonb_build_object(
      'typed_liked', coalesce((
        select jsonb_agg(x.t) from (
          select f.liked_other as t from public.event_feedback f
          where f.event_slug = any (p_slugs) and f.liked_other is not null and not f.partner_hidden and (p_comments = 'all' or f.quote_ok)
          order by f.created_at desc limit 50) x), '[]'::jsonb),
      'typed_improve', coalesce((
        select jsonb_agg(x.t) from (
          select f.improve_other as t from public.event_feedback f
          where f.event_slug = any (p_slugs) and f.improve_other is not null and not f.partner_hidden and (p_comments = 'all' or f.quote_ok)
          order by f.created_at desc limit 50) x), '[]'::jsonb));
    if p_shoutouts then
      res := res || jsonb_build_object('shoutouts', coalesce((
        select jsonb_agg(x.t) from (
          select f.shoutouts as t from public.event_feedback f
          where f.event_slug = any (p_slugs) and f.shoutouts is not null and not f.partner_hidden and (p_comments = 'all' or f.quote_ok)
          order by f.created_at desc limit 50) x), '[]'::jsonb));
    end if;
  end if;
  return res;
end;
$$;
revoke all on function public.partner_event_stats(text[], text, boolean, boolean, boolean, text, boolean) from public, anon, authenticated;

create or replace function public.partner_space_view(p_token text, p_preview boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sp public.partner_spaces;
  ev jsonb := '[]'::jsonb;
  e record;
  reg bigint;
  total_reg bigint := 0;
  slugs text[];
begin
  select * into sp from public.partner_spaces s where s.token = btrim(coalesce(p_token, ''));
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  -- Someone from the committee previewing a space can see it paused or expired, and isn't counted.
  if not (coalesce(p_preview, false) and public.partner_can_manage()) then
    if not sp.is_active then return jsonb_build_object('ok', false, 'reason', 'paused'); end if;
    if sp.expires_on is not null and sp.expires_on < current_date then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
    update public.partner_spaces set view_count = view_count + 1, last_viewed_at = now() where id = sp.id;
  end if;

  slugs := sp.event_slugs;
  for e in
    select se.slug, se.name, se.date_text, se.starts_on, se.ends_on, se.tag
    from public.site_events se
    where se.slug = any (slugs)
    order by se.starts_on nulls last, se.name
  loop
    reg := case when sp.show_registrations then (select count(*) from public.event_registrations r where r.event_slug = e.slug) else null end;
    total_reg := total_reg + coalesce(reg, 0);
    ev := ev || jsonb_build_array(jsonb_build_object(
      'slug', e.slug, 'name', e.name, 'date_text', e.date_text, 'starts_on', e.starts_on, 'ends_on', e.ends_on, 'tag', e.tag,
      'registered', reg,
      'stats', public.partner_event_stats(array[e.slug], sp.show_comments, sp.show_ideas, sp.show_heard, sp.show_audience, sp.source_code, sp.show_shoutouts)));
  end loop;

  return jsonb_build_object(
    'ok', true,
    'space', jsonb_build_object(
      'name', sp.name, 'partner_name', sp.partner_name, 'message', sp.message, 'expires_on', sp.expires_on,
      'custom_metrics', sp.custom_metrics, 'source_code', sp.source_code,
      'shows', jsonb_build_object('comments', sp.show_comments, 'ideas', sp.show_ideas, 'heard', sp.show_heard, 'shoutouts', sp.show_shoutouts,
                                  'audience', sp.show_audience, 'registrations', sp.show_registrations)),
    'events', ev,
    'overall', jsonb_build_object(
      'registered', case when sp.show_registrations then total_reg else null end,
      'stats', public.partner_event_stats(slugs, sp.show_comments, sp.show_ideas, sp.show_heard, sp.show_audience, sp.source_code, sp.show_shoutouts)),
    'preview', coalesce(p_preview, false) and public.partner_can_manage()
  );
end;
$$;

drop function if exists public.partner_spaces_list();
create or replace function public.partner_spaces_list()
returns table (
  id uuid, name text, partner_name text, message text, event_slugs text[], show_comments text,
  show_ideas boolean, show_heard boolean, show_audience boolean, show_registrations boolean, show_shoutouts boolean,
  custom_metrics jsonb, is_active boolean, expires_on date, token text, source_code text,
  view_count integer, last_viewed_at timestamptz, created_at timestamptz, responses bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.partner_can_manage() then raise exception 'Not authorized'; end if;
  return query
    select s.id, s.name, s.partner_name, s.message, s.event_slugs, s.show_comments,
           s.show_ideas, s.show_heard, s.show_audience, s.show_registrations, s.show_shoutouts,
           s.custom_metrics, s.is_active, s.expires_on, s.token, s.source_code,
           s.view_count, s.last_viewed_at, s.created_at,
           (select count(*) from public.event_feedback f where f.event_slug = any (s.event_slugs))
    from public.partner_spaces s
    order by s.created_at desc;
end;
$$;
revoke all on function public.partner_spaces_list() from public, anon;
grant execute on function public.partner_spaces_list() to authenticated;

create or replace function public.partner_space_save(p_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  nm text := btrim(coalesce(p_data ->> 'name', ''));
  pn text := btrim(coalesce(p_data ->> 'partner_name', ''));
  msg text := btrim(coalesce(p_data ->> 'message', ''));
  slugs text[];
  bad text;
  sc text := coalesce(p_data ->> 'show_comments', 'quotable');
  metrics jsonb := '[]'::jsonb;
  m jsonb;
  lbl text;
  val text;
  exp date;
  new_id uuid := p_id;
begin
  if not public.partner_can_manage() then raise exception 'Not authorized'; end if;
  if nm = '' or char_length(nm) > 120 then raise exception 'Give the space a name (up to 120 characters).'; end if;
  if char_length(pn) > 120 then raise exception 'The partner name is too long.'; end if;
  if char_length(msg) > 1200 then raise exception 'The welcome message is too long (1200 characters at most).'; end if;
  if sc not in ('none', 'quotable', 'all') then raise exception 'Unknown comments setting.'; end if;

  select coalesce(array_agg(distinct x), '{}'::text[]) into slugs
  from jsonb_array_elements_text(coalesce(p_data -> 'event_slugs', '[]'::jsonb)) x;
  if cardinality(slugs) = 0 then raise exception 'Choose at least one event.'; end if;
  if cardinality(slugs) > 12 then raise exception 'A space can cover up to 12 events.'; end if;
  select x into bad from unnest(slugs) x where not exists (select 1 from public.site_events e where e.slug = x) limit 1;
  if bad is not null then raise exception 'We could not find the event "%".', bad; end if;

  -- Headline numbers typed in by the committee (attendance, money raised...).
  if jsonb_typeof(coalesce(p_data -> 'custom_metrics', '[]'::jsonb)) <> 'array' then raise exception 'The numbers list is not valid.'; end if;
  if jsonb_array_length(coalesce(p_data -> 'custom_metrics', '[]'::jsonb)) > 8 then raise exception 'Up to 8 headline numbers.'; end if;
  for m in select * from jsonb_array_elements(coalesce(p_data -> 'custom_metrics', '[]'::jsonb)) loop
    lbl := btrim(coalesce(m ->> 'label', ''));
    val := btrim(coalesce(m ->> 'value', ''));
    if lbl = '' and val = '' then continue; end if;
    if lbl = '' or val = '' then raise exception 'Each headline number needs a label and a value.'; end if;
    if char_length(lbl) > 40 or char_length(val) > 40 then raise exception 'Keep headline labels and values under 40 characters.'; end if;
    metrics := metrics || jsonb_build_array(jsonb_build_object('label', lbl, 'value', val, 'note', left(btrim(coalesce(m ->> 'note', '')), 120)));
  end loop;

  exp := nullif(btrim(coalesce(p_data ->> 'expires_on', '')), '')::date;

  if p_id is null then
    insert into public.partner_spaces (name, partner_name, message, event_slugs, show_comments, show_ideas, show_heard, show_audience, show_registrations, show_shoutouts, custom_metrics, expires_on, created_by)
    values (nm, pn, msg, slugs, sc,
            coalesce((p_data ->> 'show_ideas')::boolean, false), coalesce((p_data ->> 'show_heard')::boolean, true),
            coalesce((p_data ->> 'show_audience')::boolean, true), coalesce((p_data ->> 'show_registrations')::boolean, true),
            coalesce((p_data ->> 'show_shoutouts')::boolean, false), metrics, exp, auth.uid())
    returning id into new_id;
  else
    update public.partner_spaces set
      name = nm, partner_name = pn, message = msg, event_slugs = slugs, show_comments = sc,
      show_ideas = coalesce((p_data ->> 'show_ideas')::boolean, false), show_heard = coalesce((p_data ->> 'show_heard')::boolean, true),
      show_audience = coalesce((p_data ->> 'show_audience')::boolean, true), show_registrations = coalesce((p_data ->> 'show_registrations')::boolean, true),
      show_shoutouts = coalesce((p_data ->> 'show_shoutouts')::boolean, false), custom_metrics = metrics, expires_on = exp, updated_at = now()
    where id = p_id;
    if not found then raise exception 'That space no longer exists.'; end if;
  end if;
  return new_id;
end;
$$;

commit;
