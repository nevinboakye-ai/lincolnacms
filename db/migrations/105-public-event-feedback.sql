-- 105: Show feedback from past events on the public Events page
--
-- The committee chooses, event by event, whether anything is shown on the website and exactly
-- what: the average rating, how many would come again, what people liked, and a few quotes.
-- Nothing is public until you switch an event on (Dashboard -> Feedback -> pick an event ->
-- "Show on website").
--
-- What the public can ever see (enforced here, not in the page):
--   * Only events you switched on, and only the parts you ticked.
--   * Only positive, aggregated information: "what went well" (never "what could be better"),
--     never a name, email, course or year.
--   * The rating only once at least 5 people have given one AND the average is at least the
--     minimum you set (4.0 by default), so a poor night is never advertised by accident.
--     "Would come again" shows once 5 people answered and at least half said yes.
--   * Quotes only from people who ticked "we may quote this", never one you hid or held back
--     from partners. "Picked" mode (the default) shows only quotes you feature; "automatic"
--     shows quotes from 4 and 5 star replies. Each is shown as "LACMS member", "Guest" or
--     "Professional", with the month, nothing more.
--
-- Who can use it: Hub Access -> "Dashboard: Publish feedback on the website" (closed by default,
-- because it puts information outside LACMS). The president always can.
--
-- Safe to run more than once. Needs 100, 101 and 104.

begin;

-- ---------------------------------------------------------------------
-- 1. Settings per event, and which replies to feature
create table if not exists public.event_feedback_public (
  event_slug text primary key,
  enabled boolean not null default false,
  show_rating boolean not null default true,
  show_return boolean not null default true,
  show_liked boolean not null default true,
  quotes text not null default 'picked' check (quotes in ('off', 'picked', 'auto')),
  min_avg numeric(2, 1) not null default 4.0 check (min_avg between 0 and 5),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.event_feedback_public enable row level security;
revoke all on public.event_feedback_public from anon, authenticated;

alter table public.event_feedback add column if not exists public_featured boolean not null default false;
alter table public.event_feedback add column if not exists public_hidden boolean not null default false;

-- ---------------------------------------------------------------------
-- 2. Who can publish
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
      'dash_sitestats', 'dash_create', 'dash_manage', 'dash_email', 'dash_feedback', 'dash_partners', 'dash_qr',
      'dash_feedback_edit', 'dash_feedback_public'
    ])
  ) x;
  alter table public.hub_access_rules drop constraint if exists hub_access_rules_feature_check;
  execute 'alter table public.hub_access_rules add constraint hub_access_rules_feature_check check (feature in (' || names || '))';
end;
$$;

insert into public.hub_access_rules (feature, allow_members, allow_professionals, member_types, courses, titles, blocked_display)
values ('dash_feedback_public', false, false, null, null, null, 'hidden')
on conflict (feature) do nothing;

create or replace function public.feedback_public_can_manage()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_president(), false) or coalesce(public.has_hub_access('dash_feedback_public'), false);
$$;
revoke all on function public.feedback_public_can_manage() from public, anon;
grant execute on function public.feedback_public_can_manage() to authenticated;

-- ---------------------------------------------------------------------
-- 3. What the public may see for one event
create or replace function public.feedback_public_build(p_slug text, s public.event_feedback_public)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  n integer;
  nr integer;
  avg_r numeric;
  answered integer;
  yes_n integer;
  rating jsonb := null;
  would jsonb := null;
  liked jsonb := '[]'::jsonb;
  quotes_out jsonb := '[]'::jsonb;
begin
  select count(*), count(r.rating), avg(r.rating),
         count(r.would_return), count(*) filter (where r.would_return = 'yes')
    into n, nr, avg_r, answered, yes_n
  from public.event_feedback r where r.event_slug = p_slug;

  if n >= 5 then
    if s.show_rating and nr >= 5 and avg_r >= s.min_avg then
      rating := jsonb_build_object('avg', round(avg_r, 1), 'count', nr);
    end if;
    if s.show_return and answered >= 5 and yes_n * 2 >= answered then
      would := jsonb_build_object('yes_pct', round(yes_n * 100.0 / answered), 'count', answered);
    end if;
    if s.show_liked then
      select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', c) order by c desc, k), '[]'::jsonb) into liked
      from (select k, count(*) as c from public.event_feedback r, unnest(r.liked) k
            where r.event_slug = p_slug group by k having count(*) >= 2 order by count(*) desc, k limit 4) z;
    end if;
  end if;

  if s.quotes <> 'off' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'text', case when char_length(t) > 300 then left(t, 297) || '...' else t end,
             'who', case w when 'member' then 'LACMS member' when 'professional' then 'Professional' else 'Guest' end,
             'at', to_char(d, 'YYYY-MM')) order by d desc), '[]'::jsonb) into quotes_out
    from (
      select btrim(r.comment) as t, r.respondent as w, r.created_at as d
      from public.event_feedback r
      where r.event_slug = p_slug and r.quote_ok and not r.public_hidden and not r.partner_hidden
        and r.comment is not null and char_length(btrim(r.comment)) >= 8
        and ((s.quotes = 'picked' and r.public_featured) or (s.quotes = 'auto' and r.rating >= 4))
      order by r.created_at desc limit 3) z;
  end if;

  return jsonb_build_object('slug', p_slug, 'replies', case when n >= 5 then n end,
                            'rating', rating, 'would', would, 'liked', liked, 'quotes', quotes_out);
end;
$$;
revoke all on function public.feedback_public_build(text, public.event_feedback_public) from public, anon, authenticated;

-- The website: every switched-on event that has something worth showing.
create or replace function public.public_event_feedback()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.event_feedback_public;
  b jsonb;
  res jsonb := '[]'::jsonb;
begin
  for s in select * from public.event_feedback_public x where x.enabled loop
    b := public.feedback_public_build(s.event_slug, s);
    if b -> 'rating' <> 'null'::jsonb or b -> 'would' <> 'null'::jsonb or jsonb_array_length(b -> 'liked') > 0 or jsonb_array_length(b -> 'quotes') > 0 then
      res := res || jsonb_build_array(b);
    end if;
  end loop;
  return res;
end;
$$;
revoke all on function public.public_event_feedback() from public;
grant execute on function public.public_event_feedback() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. The committee's controls
-- Settings, a live preview of what the public would see (even while switched off), and some counts.
create or replace function public.feedback_public_get(p_slug text, p_preview jsonb default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.event_feedback_public;
  saved jsonb;
begin
  if not (public.feedback_public_can_manage() or public.feedback_can_read()) then raise exception 'Not authorized'; end if;
  p_slug := btrim(coalesce(p_slug, ''));
  select * into s from public.event_feedback_public x where x.event_slug = p_slug;
  if not found then
    s.event_slug := p_slug; s.enabled := false; s.show_rating := true; s.show_return := true; s.show_liked := true; s.quotes := 'picked'; s.min_avg := 4.0;
  end if;
  saved := jsonb_build_object('enabled', s.enabled, 'show_rating', s.show_rating, 'show_return', s.show_return, 'show_liked', s.show_liked, 'quotes', s.quotes, 'min_avg', s.min_avg);
  -- Try settings out before saving them: the preview follows what is ticked.
  if p_preview is not null and jsonb_typeof(p_preview) = 'object' then
    s.show_rating := coalesce((p_preview ->> 'show_rating')::boolean, s.show_rating);
    s.show_return := coalesce((p_preview ->> 'show_return')::boolean, s.show_return);
    s.show_liked := coalesce((p_preview ->> 'show_liked')::boolean, s.show_liked);
    if p_preview ->> 'quotes' in ('off', 'picked', 'auto') then s.quotes := p_preview ->> 'quotes'; end if;
    if (p_preview ->> 'min_avg') ~ '^[0-5](\.\d)?$' then s.min_avg := (p_preview ->> 'min_avg')::numeric; end if;
  end if;
  return jsonb_build_object(
    'can_manage', public.feedback_public_can_manage(),
    'settings', saved,
    'preview', public.feedback_public_build(p_slug, s),
    'responses', (select count(*) from public.event_feedback r where r.event_slug = p_slug),
    'quotable', (select count(*) from public.event_feedback r where r.event_slug = p_slug and r.quote_ok and r.comment is not null and not r.partner_hidden),
    'featured', (select count(*) from public.event_feedback r where r.event_slug = p_slug and r.public_featured and not r.public_hidden));
end;
$$;
drop function if exists public.feedback_public_get(text);
revoke all on function public.feedback_public_get(text, jsonb) from public, anon;
grant execute on function public.feedback_public_get(text, jsonb) to authenticated;

-- Which events are switched on (for badges on the dashboard).
create or replace function public.feedback_public_list()
returns table (event_slug text, enabled boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.feedback_public_can_manage() or public.feedback_can_read()) then raise exception 'Not authorized'; end if;
  return query select x.event_slug, x.enabled from public.event_feedback_public x;
end;
$$;
revoke all on function public.feedback_public_list() from public, anon;
grant execute on function public.feedback_public_list() to authenticated;

create or replace function public.feedback_public_save(
  p_slug text, p_enabled boolean, p_show_rating boolean, p_show_return boolean, p_show_liked boolean, p_quotes text, p_min_avg numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.feedback_public_can_manage() then raise exception 'Not authorized'; end if;
  p_slug := btrim(coalesce(p_slug, ''));
  if p_slug = '' then raise exception 'Choose an event.'; end if;
  if coalesce(p_quotes, '') not in ('off', 'picked', 'auto') then raise exception 'Unknown quotes setting.'; end if;
  if p_min_avg is null or p_min_avg < 0 or p_min_avg > 5 then raise exception 'The minimum average must be between 0 and 5.'; end if;
  insert into public.event_feedback_public (event_slug, enabled, show_rating, show_return, show_liked, quotes, min_avg, updated_by, updated_at)
  values (p_slug, coalesce(p_enabled, false), coalesce(p_show_rating, true), coalesce(p_show_return, true), coalesce(p_show_liked, true), p_quotes, round(p_min_avg, 1), auth.uid(), now())
  on conflict (event_slug) do update set enabled = excluded.enabled, show_rating = excluded.show_rating, show_return = excluded.show_return,
    show_liked = excluded.show_liked, quotes = excluded.quotes, min_avg = excluded.min_avg, updated_by = excluded.updated_by, updated_at = now();
end;
$$;
revoke all on function public.feedback_public_save(text, boolean, boolean, boolean, boolean, text, numeric) from public, anon;
grant execute on function public.feedback_public_save(text, boolean, boolean, boolean, boolean, text, numeric) to authenticated;

-- Feature a reply on the website (needs its "may quote" tick), or keep one off even in automatic mode.
create or replace function public.feedback_set_public(p_id uuid, p_featured boolean, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.feedback_public_can_manage() then raise exception 'Not authorized'; end if;
  if coalesce(p_featured, false) and not exists (select 1 from public.event_feedback r where r.id = p_id and r.quote_ok and r.comment is not null) then
    raise exception 'Only a comment the person said we may quote can be featured.';
  end if;
  update public.event_feedback set public_featured = coalesce(p_featured, false), public_hidden = coalesce(p_hidden, false) where id = p_id;
end;
$$;
revoke all on function public.feedback_set_public(uuid, boolean, boolean) from public, anon;
grant execute on function public.feedback_set_public(uuid, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 5. The committee's list of responses also says which ones are featured or kept off the website
drop function if exists public.president_get_feedback() cascade;
create function public.president_get_feedback()
returns table (
  id uuid, event_slug text, event_name text, created_at timestamptz, respondent text,
  person_name text, person_email text, course text, year_of_study text, guest_kind text,
  rating integer, liked text[], improve text[], comment text, would_return text, heard_from text,
  suggestion text, anonymous boolean, quote_ok boolean, wants_updates boolean, partner_hidden boolean,
  liked_other text, improve_other text, shoutouts text, answers jsonb, public_featured boolean, public_hidden boolean
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
           f.liked_other, f.improve_other, f.shoutouts, f.answers, f.public_featured, f.public_hidden
    from public.event_feedback f
    order by f.created_at desc;
end;
$$;
revoke all on function public.president_get_feedback() from public, anon;
grant execute on function public.president_get_feedback() to authenticated;

commit;
