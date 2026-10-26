-- 104: Customisable feedback forms (the form builder)
--
-- Until now every event used the same fixed feedback form. This lets the committee build their
-- own: sections, questions of several kinds (pick one, pick several, a scale or rating, yes/no,
-- short and long text), live polls, a heading/text block, show-this-only-if rules, and the
-- original questions (overall rating, what went well, what could be better, would you come
-- again, who made the night valuable, anything else, how you heard, an event idea) as pieces
-- that can be kept, reworded, made required or removed.
--
--   * One form for everything (the "default") and, optionally, a different form for any event.
--   * Edits are made on a DRAFT and go live only when published, so a form that people are
--     filling in is never broken halfway. Every published version is kept; any can be brought
--     back as a new draft.
--   * Questions that are removed are remembered (archived) so old answers still make sense.
--   * Who can edit: Hub Access -> "Dashboard: Edit feedback forms" (closed by default, so
--     only the president until you give it to a person or a role). Seeing results stays
--     under "Dashboard: Feedback".
--   * The database checks the form when it is saved AND every answer when it is sent: a
--     question that is required must be answered, a choice must be one of the options, and so
--     on, so nothing the page does can store something the form didn't ask for.
--   * Form settings: members only or everyone, whether anonymous sending and "you may quote
--     this" are offered, an optional closing date, a custom intro and thank-you message.
--   * Polls: a choice question can show everyone how the votes are going once they have
--     answered (only once at least 5 people have, so no one is picked out).
--   * Results for the new questions appear in Dashboard -> Feedback, and a question can be
--     marked "show partners" so it appears on a partner space.
--
-- Safe to run more than once. Needs 100, 101 and 103 (and 060/061 for Hub Access).

begin;

-- ---------------------------------------------------------------------
-- 1. Tables and columns
create table if not exists public.feedback_forms (
  id uuid primary key default gen_random_uuid(),
  event_slug text,                          -- null = the default form
  name text not null default '',
  definition jsonb not null,
  draft jsonb,
  version integer not null default 1,
  is_active boolean not null default true,
  updated_by uuid references auth.users (id) on delete set null,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists feedback_forms_event_uq on public.feedback_forms (event_slug) where event_slug is not null;
create unique index if not exists feedback_forms_default_uq on public.feedback_forms ((true)) where event_slug is null;

create table if not exists public.feedback_form_history (
  id bigint generated always as identity primary key,
  form_id uuid not null references public.feedback_forms (id) on delete cascade,
  version integer not null,
  definition jsonb not null,
  saved_by uuid references auth.users (id) on delete set null,
  saved_at timestamptz not null default now()
);
create index if not exists feedback_form_history_idx on public.feedback_form_history (form_id, version desc);

alter table public.feedback_forms enable row level security;
alter table public.feedback_form_history enable row level security;
revoke all on public.feedback_forms, public.feedback_form_history from anon, authenticated;
-- (no policies on purpose: only the functions below can read or change them)

alter table public.event_feedback add column if not exists answers jsonb not null default '{}'::jsonb;
alter table public.event_feedback add column if not exists form_version integer;
-- A custom form may leave out the overall rating.
alter table public.event_feedback alter column rating drop not null;

-- ---------------------------------------------------------------------
-- 2. Who can edit
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
      'dash_feedback_edit'
    ])
  ) x;
  alter table public.hub_access_rules drop constraint if exists hub_access_rules_feature_check;
  execute 'alter table public.hub_access_rules add constraint hub_access_rules_feature_check check (feature in (' || names || '))';
end;
$$;

-- Closed by default: only the president until you give it to someone.
insert into public.hub_access_rules (feature, allow_members, allow_professionals, member_types, courses, titles, blocked_display)
values ('dash_feedback_edit', false, false, null, null, null, 'hidden')
on conflict (feature) do nothing;

create or replace function public.feedback_forms_can_edit()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_president(), false) or coalesce(public.has_hub_access('dash_feedback_edit'), false);
$$;
revoke all on function public.feedback_forms_can_edit() from public, anon;
grant execute on function public.feedback_forms_can_edit() to authenticated;

-- ---------------------------------------------------------------------
-- 3. Checking and tidying a form definition
create or replace function public.feedback_core_types()
returns text[]
language sql
immutable
as $$ select array['overall', 'liked', 'improve', 'would_return', 'shoutouts', 'comment', 'heard', 'suggestion']::text[]; $$;

create or replace function public.feedback_clean_def(p_def jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  st jsonb := coalesce(p_def -> 'settings', '{}'::jsonb);
  settings jsonb;
  sec jsonb;
  q jsonb;
  opt jsonb;
  sec_out jsonb := '[]'::jsonb;
  qs_out jsonb;
  qo jsonb;
  opts_out jsonb;
  seen text[] := '{}';
  seen_core text[] := '{}';
  opt_ids text[];
  sid text;
  qid text;
  typ text;
  title text;
  total integer := 0;
  oid text;
  olabel text;
  n_opts integer;
  mx integer;
  mn integer;
  si jsonb;
  si_out jsonb;
  op text;
  src_type text;
  sv jsonb;
  closes text;
  core text[] := public.feedback_core_types();
  types text[] := array['overall','liked','improve','would_return','shoutouts','comment','heard','suggestion','single','multi','scale','yesno','text','longtext','info'];
  qtypes jsonb := '{}'::jsonb;     -- id -> type, for show-if rules
begin
  if p_def is null or jsonb_typeof(p_def) <> 'object' then raise exception 'The form is not valid.'; end if;
  if jsonb_typeof(coalesce(p_def -> 'sections', 'null'::jsonb)) <> 'array' then raise exception 'The form needs at least one section.'; end if;
  if jsonb_array_length(p_def -> 'sections') < 1 or jsonb_array_length(p_def -> 'sections') > 10 then
    raise exception 'A form needs between 1 and 10 sections.';
  end if;

  -- Settings
  if jsonb_typeof(st) <> 'object' then st := '{}'::jsonb; end if;
  closes := nullif(btrim(coalesce(st ->> 'closes_on', '')), '');
  if closes is not null and closes !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'The closing date is not a valid date.'; end if;
  if closes is not null then perform closes::date; end if;
  if coalesce(st ->> 'audience', 'everyone') not in ('everyone', 'members') then raise exception 'Unknown audience setting.'; end if;
  settings := jsonb_build_object(
    'title', left(btrim(coalesce(st ->> 'title', '')), 120),
    'intro', left(btrim(coalesce(st ->> 'intro', '')), 600),
    'thank_you', left(btrim(coalesce(st ->> 'thank_you', '')), 600),
    'submit_label', left(btrim(coalesce(st ->> 'submit_label', '')), 30),
    'audience', coalesce(st ->> 'audience', 'everyone'),
    'allow_anonymous', coalesce((st ->> 'allow_anonymous')::boolean, true),
    'ask_quote_consent', coalesce((st ->> 'ask_quote_consent')::boolean, true),
    'guest_pitch', coalesce((st ->> 'guest_pitch')::boolean, true),
    'closes_on', closes);

  for sec in select * from jsonb_array_elements(p_def -> 'sections') loop
    if jsonb_typeof(sec) <> 'object' then raise exception 'A section is not valid.'; end if;
    sid := coalesce(sec ->> 'id', '');
    if sid !~ '^[a-z0-9_]{1,24}$' then raise exception 'A section has an invalid id.'; end if;
    if sid = any (seen) then raise exception 'Two sections share an id.'; end if;
    seen := seen || sid;
    qs_out := '[]'::jsonb;
    if jsonb_typeof(coalesce(sec -> 'questions', 'null'::jsonb)) <> 'array' then raise exception 'A section is missing its questions.'; end if;
    for q in select * from jsonb_array_elements(sec -> 'questions') loop
      if jsonb_typeof(q) <> 'object' then raise exception 'A question is not valid.'; end if;
      total := total + 1;
      if total > 40 then raise exception 'A form can have up to 40 questions.'; end if;
      qid := coalesce(q ->> 'id', '');
      typ := coalesce(q ->> 'type', '');
      if qid !~ '^[a-z0-9_]{1,24}$' then raise exception 'A question has an invalid id.'; end if;
      if qid = any (seen) then raise exception 'Two questions share an id.'; end if;
      if not (typ = any (types)) then raise exception 'Unknown kind of question: %.', typ; end if;
      if typ = any (core) then
        if qid <> typ then raise exception 'The built-in question "%" has the wrong id.', typ; end if;
        if typ = any (seen_core) then raise exception 'The built-in question "%" can only be used once.', typ; end if;
        seen_core := seen_core || typ;
      end if;
      seen := seen || qid;
      title := left(btrim(coalesce(q ->> 'title', '')), 160);
      if typ <> 'info' and title = '' then raise exception 'Every question needs a title.'; end if;
      qo := jsonb_build_object(
        'id', qid, 'type', typ, 'title', title,
        'hint', left(btrim(coalesce(q ->> 'hint', '')), 300),
        'required', coalesce((q ->> 'required')::boolean, false) and typ <> 'info',
        'partner_visible', coalesce((q ->> 'partner_visible')::boolean, false));

      -- Show only if...
      si := q -> 'show_if';
      if si is not null and jsonb_typeof(si) = 'object' and coalesce(si ->> 'q', '') <> '' then
        op := coalesce(si ->> 'op', 'is');
        if op not in ('is', 'is_not', 'answered', 'lte', 'gte') then raise exception 'Unknown show-if rule.'; end if;
        if not (qtypes ? (si ->> 'q')) then raise exception 'A show-if rule must point at an earlier question.'; end if;
        src_type := qtypes ->> (si ->> 'q');
        if src_type in ('text', 'longtext', 'info', 'liked', 'improve', 'shoutouts', 'comment', 'suggestion') then
          raise exception 'A show-if rule can only depend on a choice, scale, rating or yes/no question.';
        end if;
        sv := si -> 'v';
        if op = 'answered' then sv := 'null'::jsonb;
        elsif sv is null or jsonb_typeof(sv) not in ('string', 'number', 'array') then raise exception 'A show-if rule needs a value.';
        elsif jsonb_typeof(sv) = 'array' and (jsonb_array_length(sv) < 1 or jsonb_array_length(sv) > 20) then raise exception 'A show-if rule has too many values.';
        end if;
        qo := qo || jsonb_build_object('show_if', jsonb_build_object('q', si ->> 'q', 'op', op, 'v', sv));
      end if;

      if typ in ('single', 'multi') then
        if jsonb_typeof(coalesce(q -> 'options', 'null'::jsonb)) <> 'array' then raise exception 'A choice question needs options.'; end if;
        n_opts := jsonb_array_length(q -> 'options');
        if n_opts < 2 or n_opts > 20 then raise exception 'A choice question needs between 2 and 20 options ("%").', title; end if;
        opts_out := '[]'::jsonb; opt_ids := '{}';
        for opt in select * from jsonb_array_elements(q -> 'options') loop
          oid := coalesce(opt ->> 'id', ''); olabel := left(btrim(coalesce(opt ->> 'label', '')), 80);
          if oid !~ '^[a-z0-9]{1,8}$' or oid = 'other' then raise exception 'An option has an invalid id.'; end if;
          if oid = any (opt_ids) then raise exception 'Two options share an id.'; end if;
          if olabel = '' then raise exception 'Every option needs a label ("%").', title; end if;
          opt_ids := opt_ids || oid;
          opts_out := opts_out || jsonb_build_array(jsonb_build_object('id', oid, 'label', olabel));
        end loop;
        qo := qo || jsonb_build_object('options', opts_out, 'allow_other', coalesce((q ->> 'allow_other')::boolean, false),
                                       'show_results', coalesce((q ->> 'show_results')::boolean, false));
        if typ = 'single' then
          qo := qo || jsonb_build_object('style', case when q ->> 'style' = 'list' then 'list' else 'pills' end);
        else
          mx := coalesce((q ->> 'max')::integer, n_opts);
          if mx < 1 or mx > n_opts + 1 then raise exception 'The most that can be picked must be between 1 and the number of options ("%").', title; end if;
          qo := qo || jsonb_build_object('max', mx);
        end if;
      elsif typ = 'scale' then
        mn := coalesce((q ->> 'min')::integer, 1); mx := coalesce((q ->> 'max')::integer, 5);
        if mn not in (0, 1) or mx < 2 or mx > 10 or mx <= mn then raise exception 'A scale must run from 0 or 1 up to at most 10 ("%").', title; end if;
        qo := qo || jsonb_build_object('min', mn, 'max', mx,
          'low_label', left(btrim(coalesce(q ->> 'low_label', '')), 40), 'high_label', left(btrim(coalesce(q ->> 'high_label', '')), 40),
          'style', case when q ->> 'style' in ('stars', 'faces') and mx = 5 and mn = 1 then q ->> 'style' else 'numbers' end);
      elsif typ = 'yesno' then
        qo := qo || jsonb_build_object('yes_label', coalesce(nullif(left(btrim(coalesce(q ->> 'yes_label', '')), 20), ''), 'Yes'),
          'no_label', coalesce(nullif(left(btrim(coalesce(q ->> 'no_label', '')), 20), ''), 'No'),
          'show_results', coalesce((q ->> 'show_results')::boolean, false));
      elsif typ = 'text' then
        qo := qo || jsonb_build_object('placeholder', left(btrim(coalesce(q ->> 'placeholder', '')), 120), 'max', least(greatest(coalesce((q ->> 'max')::integer, 200), 20), 300));
      elsif typ = 'longtext' then
        qo := qo || jsonb_build_object('placeholder', left(btrim(coalesce(q ->> 'placeholder', '')), 120), 'max', least(greatest(coalesce((q ->> 'max')::integer, 1000), 50), 2000));
      elsif typ = 'info' then
        qo := qo || jsonb_build_object('body', left(btrim(coalesce(q ->> 'body', '')), 600));
        if title = '' and (qo ->> 'body') = '' then raise exception 'A text block needs a heading or some text.'; end if;
      elsif typ = 'overall' then
        qo := qo || jsonb_build_object('style', case when q ->> 'style' = 'stars' then 'stars' else 'faces' end);
      end if;

      qtypes := qtypes || jsonb_build_object(qid, typ);
      qs_out := qs_out || jsonb_build_array(qo);
    end loop;
    sec_out := sec_out || jsonb_build_array(jsonb_build_object(
      'id', sid, 'title', left(btrim(coalesce(sec ->> 'title', '')), 120), 'description', left(btrim(coalesce(sec ->> 'description', '')), 400),
      'questions', qs_out));
  end loop;
  if total < 1 then raise exception 'A form needs at least one question.'; end if;
  return jsonb_build_object('v', 1, 'settings', settings, 'sections', sec_out);
end;
$$;
revoke all on function public.feedback_clean_def(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Which form applies, and showing it to people
-- The event's own form, else the default form, else nothing (the original fixed form).
create or replace function public.feedback_person_name(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select m.full_name from public.members m where m.id = p_uid),
                  (select np.full_name from public.network_professionals np where np.user_id = p_uid limit 1));
$$;
revoke all on function public.feedback_person_name(uuid) from public, anon, authenticated;

create or replace function public.feedback_effective_form(p_slug text)
returns public.feedback_forms
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f public.feedback_forms;
begin
  select * into f from public.feedback_forms x where x.event_slug = p_slug and x.is_active and x.version > 0;
  if found then return f; end if;
  select * into f from public.feedback_forms x where x.event_slug is null and x.is_active and x.version > 0;
  if found then return f; end if;
  return null;
end;
$$;
revoke all on function public.feedback_effective_form(text) from public, anon, authenticated;

-- What the feedback page asks for. Only the live version, never a draft.
create or replace function public.feedback_form_for(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f public.feedback_forms;
begin
  f := public.feedback_effective_form(btrim(coalesce(p_slug, '')));
  if f.id is null then return jsonb_build_object('source', 'none'); end if;
  return jsonb_build_object('source', case when f.event_slug is null then 'default' else 'event' end, 'version', f.version,
                            'definition', f.definition - 'archived');
end;
$$;
revoke all on function public.feedback_form_for(text) from public;
grant execute on function public.feedback_form_for(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Editing (needs "Edit feedback forms")
create or replace function public.feedback_form_get(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f public.feedback_forms;
  own public.feedback_forms;
  live jsonb;
  ver integer;
begin
  if not public.feedback_forms_can_edit() then raise exception 'Not authorized'; end if;
  p_slug := nullif(btrim(coalesce(p_slug, '')), '');
  select * into own from public.feedback_forms x where x.event_slug is not distinct from p_slug;
  if own.id is not null and own.version > 0 then
    live := own.definition; ver := own.version;
  else
    f := public.feedback_effective_form(coalesce(p_slug, '__none__'));
    live := f.definition; ver := f.version;
  end if;
  return jsonb_build_object(
    'own', own.id is not null and own.version > 0,
    'uses', case when own.id is not null and own.version > 0 then 'own' when live is not null then 'default' else 'standard' end,
    'live', live,
    'live_version', ver,
    'draft', own.draft,
    'updated_by', case when own.id is not null then public.feedback_person_name(own.updated_by) end,
    'updated_at', own.updated_at,
    'responses', (select count(*) from public.event_feedback r where p_slug is not null and r.event_slug = p_slug));
end;
$$;

-- A list for the "Forms" page: the default and every event.
create or replace function public.feedback_forms_overview()
returns table (slug text, name text, starts_on date, has_form boolean, has_draft boolean, version integer, updated_at timestamptz, updated_by_name text, responses bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.feedback_forms_can_edit() then raise exception 'Not authorized'; end if;
  return query
    select null::text, 'Default form (every event without its own)'::text, null::date, (f.id is not null and f.version > 0), f.draft is not null,
           f.version, f.updated_at, public.feedback_person_name(f.updated_by),
           (select count(*) from public.event_feedback r)
    from (select 1) one left join public.feedback_forms f on f.event_slug is null
    union all
    select e.slug, e.name, e.starts_on, (f.id is not null and f.version > 0), f.draft is not null, f.version, f.updated_at,
           public.feedback_person_name(f.updated_by),
           (select count(*) from public.event_feedback r where r.event_slug = e.slug)
    from public.site_events e left join public.feedback_forms f on f.event_slug = e.slug
    where e.is_active
    order by 3 desc nulls first;
end;
$$;

-- Save the working copy (nothing changes for the public).
create or replace function public.feedback_form_save_draft(p_slug text, p_def jsonb, p_base jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean jsonb;
  f public.feedback_forms;
  live jsonb;
begin
  if not public.feedback_forms_can_edit() then raise exception 'Not authorized'; end if;
  p_slug := nullif(btrim(coalesce(p_slug, '')), '');
  clean := public.feedback_clean_def(p_def);
  select * into f from public.feedback_forms x where x.event_slug is not distinct from p_slug;
  if not found then
    -- The form people see now must stay as it is until this is published.
    live := (public.feedback_effective_form(coalesce(p_slug, '__none__'))).definition;
    if live is null then live := public.feedback_clean_def(coalesce(p_base, p_def)); end if;
    insert into public.feedback_forms (event_slug, name, definition, draft, updated_by, version)
    values (p_slug, '', live, clean, auth.uid(), 0)
    returning * into f;
  else
    update public.feedback_forms set draft = clean, updated_by = auth.uid(), updated_at = now() where id = f.id returning * into f;
  end if;
  return jsonb_build_object('ok', true, 'version', f.version);
end;
$$;

-- Put the working copy live. Removed questions are remembered so old answers keep their meaning.
create or replace function public.feedback_form_publish(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.feedback_forms;
  newdef jsonb;
  old_q jsonb;
  archived jsonb;
  qq jsonb;
  new_ids text[];
begin
  if not public.feedback_forms_can_edit() then raise exception 'Not authorized'; end if;
  p_slug := nullif(btrim(coalesce(p_slug, '')), '');
  select * into f from public.feedback_forms x where x.event_slug is not distinct from p_slug for update;
  if not found or f.draft is null then raise exception 'There is nothing to publish.'; end if;
  newdef := f.draft;
  select coalesce(array_agg(q ->> 'id'), '{}') into new_ids
  from jsonb_array_elements(newdef -> 'sections') s, jsonb_array_elements(s -> 'questions') q;
  archived := coalesce(f.definition -> 'archived', '[]'::jsonb);
  for qq in select q from jsonb_array_elements(f.definition -> 'sections') s, jsonb_array_elements(s -> 'questions') q loop
    if not ((qq ->> 'id') = any (new_ids)) and (qq ->> 'type') not in ('info') and not (qq ->> 'type' = any (public.feedback_core_types())) then
      if not exists (select 1 from jsonb_array_elements(archived) a where a ->> 'id' = qq ->> 'id') then
        archived := archived || jsonb_build_array(jsonb_build_object('id', qq ->> 'id', 'type', qq ->> 'type', 'title', qq ->> 'title',
                                                  'options', coalesce(qq -> 'options', '[]'::jsonb), 'min', qq -> 'min', 'max', qq -> 'max',
                                                  'allow_other', qq -> 'allow_other'));
      end if;
    end if;
  end loop;
  if jsonb_array_length(archived) > 80 then archived := (select jsonb_agg(a) from (select a from jsonb_array_elements(archived) a offset jsonb_array_length(archived) - 80) z); end if;
  newdef := newdef || jsonb_build_object('archived', archived);
  update public.feedback_forms set definition = newdef, draft = null, version = version + 1, updated_by = auth.uid(), updated_at = now(), published_at = now()
  where id = f.id returning * into f;
  insert into public.feedback_form_history (form_id, version, definition, saved_by) values (f.id, f.version, newdef, auth.uid());
  delete from public.feedback_form_history h where h.form_id = f.id and h.id not in (select id from public.feedback_form_history where form_id = f.id order by id desc limit 30);
  return jsonb_build_object('ok', true, 'version', f.version);
end;
$$;

create or replace function public.feedback_form_discard_draft(p_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.feedback_forms_can_edit() then raise exception 'Not authorized'; end if;
  update public.feedback_forms set draft = null, updated_at = now() where event_slug is not distinct from nullif(btrim(coalesce(p_slug, '')), '');
  -- an event form that never went live is removed again
  delete from public.feedback_forms where event_slug is not distinct from nullif(btrim(coalesce(p_slug, '')), '') and version = 0 and draft is null;
end;
$$;

-- An event goes back to using the default form.
create or replace function public.feedback_form_reset(p_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.feedback_forms_can_edit() then raise exception 'Not authorized'; end if;
  delete from public.feedback_forms where event_slug is not distinct from nullif(btrim(coalesce(p_slug, '')), '');
end;
$$;

create or replace function public.feedback_form_history_list(p_slug text)
returns table (id bigint, version integer, saved_at timestamptz, saved_by_name text, question_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.feedback_forms_can_edit() then raise exception 'Not authorized'; end if;
  return query
    select h.id, h.version, h.saved_at,
           public.feedback_person_name(h.saved_by),
           (select count(*)::integer from jsonb_array_elements(h.definition -> 'sections') s, jsonb_array_elements(s -> 'questions') q where q ->> 'type' <> 'info')
    from public.feedback_form_history h join public.feedback_forms f on f.id = h.form_id
    where f.event_slug is not distinct from nullif(btrim(coalesce(p_slug, '')), '')
    order by h.id desc;
end;
$$;

-- Bring an old version back as the working copy (review it, then publish).
create or replace function public.feedback_form_restore(p_history_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.feedback_form_history;
  d jsonb;
begin
  if not public.feedback_forms_can_edit() then raise exception 'Not authorized'; end if;
  select * into h from public.feedback_form_history x where x.id = p_history_id;
  if not found then raise exception 'That version no longer exists.'; end if;
  d := public.feedback_clean_def(h.definition);
  update public.feedback_forms set draft = d, updated_by = auth.uid(), updated_at = now() where id = h.form_id;
  return d;
end;
$$;

-- What the preview shows: the working copy if there is one, else the live form.
create or replace function public.feedback_form_preview(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  own public.feedback_forms;
  f public.feedback_forms;
  d jsonb;
begin
  if not public.feedback_forms_can_edit() then raise exception 'Not authorized'; end if;
  p_slug := nullif(btrim(coalesce(p_slug, '')), '');
  select * into own from public.feedback_forms x where x.event_slug is not distinct from p_slug;
  d := coalesce(own.draft, own.definition);
  if d is null then
    f := public.feedback_effective_form(coalesce(p_slug, '__none__'));
    d := f.definition;
  end if;
  if d is null then return jsonb_build_object('source', 'none'); end if;
  return jsonb_build_object('source', 'preview', 'definition', d - 'archived', 'draft', own.draft is not null);
end;
$$;

revoke all on function public.feedback_form_get(text) from public, anon;
revoke all on function public.feedback_forms_overview() from public, anon;
revoke all on function public.feedback_form_save_draft(text, jsonb, jsonb) from public, anon;
revoke all on function public.feedback_form_publish(text) from public, anon;
revoke all on function public.feedback_form_discard_draft(text) from public, anon;
revoke all on function public.feedback_form_reset(text) from public, anon;
revoke all on function public.feedback_form_history_list(text) from public, anon;
revoke all on function public.feedback_form_restore(bigint) from public, anon;
revoke all on function public.feedback_form_preview(text) from public, anon;
grant execute on function public.feedback_form_get(text) to authenticated;
grant execute on function public.feedback_forms_overview() to authenticated;
grant execute on function public.feedback_form_save_draft(text, jsonb, jsonb) to authenticated;
grant execute on function public.feedback_form_publish(text) to authenticated;
grant execute on function public.feedback_form_discard_draft(text) to authenticated;
grant execute on function public.feedback_form_reset(text) to authenticated;
grant execute on function public.feedback_form_history_list(text) to authenticated;
grant execute on function public.feedback_form_restore(bigint) to authenticated;
grant execute on function public.feedback_form_preview(text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Checking the answers to a form
-- Is a "show only if" rule satisfied? answers = the custom answers so far, core = the built-in ones.
create or replace function public.feedback_cond_ok(p_cond jsonb, p_answers jsonb, p_core jsonb, p_visible text[])
returns boolean
language plpgsql
immutable
as $$
declare
  src text := p_cond ->> 'q';
  op text := coalesce(p_cond ->> 'op', 'is');
  val jsonb;
  want jsonb := p_cond -> 'v';
  hit boolean := false;
  x jsonb;
  n numeric;
begin
  if p_cond is null or src is null then return true; end if;
  if src = any (public.feedback_core_types()) then
    val := p_core -> src;
  else
    if not (src = any (p_visible)) then val := null;      -- the source question isn't being shown, so it has no answer
    else val := p_answers -> src -> 'v'; end if;
  end if;
  if val is null or val = 'null'::jsonb or val = '""'::jsonb or val = '[]'::jsonb then
    return false;
  end if;
  if op = 'answered' then return true; end if;
  if op in ('lte', 'gte') then
    begin n := (val #>> '{}')::numeric; exception when others then return false; end;
    return case when op = 'lte' then n <= (want #>> '{}')::numeric else n >= (want #>> '{}')::numeric end;
  end if;
  -- is / is_not: compare against one value or a list
  if jsonb_typeof(want) = 'array' then
    for x in select * from jsonb_array_elements(want) loop
      if jsonb_typeof(val) = 'array' then
        if exists (select 1 from jsonb_array_elements(val) v where v = x or (v #>> '{}') = (x #>> '{}')) then hit := true; end if;
      elsif (val #>> '{}') = (x #>> '{}') then hit := true; end if;
    end loop;
  else
    if jsonb_typeof(val) = 'array' then
      hit := exists (select 1 from jsonb_array_elements(val) v where (v #>> '{}') = (want #>> '{}'));
    else hit := (val #>> '{}') = (want #>> '{}'); end if;
  end if;
  return case when op = 'is' then hit else not hit end;
end;
$$;
revoke all on function public.feedback_cond_ok(jsonb, jsonb, jsonb, text[]) from public, anon, authenticated;

-- Validates the custom answers against the form that is live and returns the tidy version.
-- p_core = the built-in answers sent: { rating, liked_any, improve_any, would_return, shoutouts, comment, heard, suggestion, heard_key }
create or replace function public.feedback_clean_answers(p_def jsonb, p_answers jsonb, p_core jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  q jsonb;
  qid text;
  typ text;
  title text;
  a jsonb;
  v jsonb;
  acc jsonb := '{}'::jsonb;
  visible text[] := '{}';
  vis boolean;
  other text;
  ids text[];
  picked text[];
  x text;
  mx integer;
  mn integer;
  num numeric;
  txt text;
  core_val jsonb;
  have boolean;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then p_answers := '{}'::jsonb; end if;
  for q in select qq from jsonb_array_elements(p_def -> 'sections') s, jsonb_array_elements(s -> 'questions') qq loop
    qid := q ->> 'id'; typ := q ->> 'type'; title := q ->> 'title';
    if typ = 'info' then
      if public.feedback_cond_ok(q -> 'show_if', acc, p_core, visible) then visible := visible || qid; end if;
      continue;
    end if;
    vis := public.feedback_cond_ok(q -> 'show_if', acc, p_core, visible);
    if vis then visible := visible || qid; end if;

    if typ = any (public.feedback_core_types()) then
      core_val := p_core -> (case typ when 'overall' then 'rating' when 'liked' then 'liked_any' when 'improve' then 'improve_any' else typ end);
      have := core_val is not null and core_val <> 'null'::jsonb and core_val <> 'false'::jsonb and core_val <> '""'::jsonb;
      if vis and coalesce((q ->> 'required')::boolean, false) and not have then raise exception 'Please answer: %', title; end if;
      continue;
    end if;

    a := p_answers -> qid;
    if not vis or a is null or jsonb_typeof(a) <> 'object' then
      if vis and coalesce((q ->> 'required')::boolean, false) then raise exception 'Please answer: %', title; end if;
      continue;
    end if;
    v := a -> 'v';

    if typ = 'single' then
      ids := array(select o ->> 'id' from jsonb_array_elements(q -> 'options') o);
      if v is null or v = 'null'::jsonb then
        if coalesce((q ->> 'required')::boolean, false) then raise exception 'Please answer: %', title; end if;
        continue;
      end if;
      if jsonb_typeof(v) <> 'string' then raise exception 'One of the choices for "%" was not recognised.', title; end if;
      x := v #>> '{}';
      if x = 'other' and coalesce((q ->> 'allow_other')::boolean, false) then
        other := nullif(left(btrim(coalesce(a ->> 'other', '')), 150), '');
        if other is null then raise exception 'Please say what "Other" is: %', title; end if;
        acc := acc || jsonb_build_object(qid, jsonb_build_object('v', 'other', 'other', other));
      elsif x = any (ids) then
        acc := acc || jsonb_build_object(qid, jsonb_build_object('v', x));
      else raise exception 'One of the choices for "%" was not recognised.', title;
      end if;
    elsif typ = 'multi' then
      ids := array(select o ->> 'id' from jsonb_array_elements(q -> 'options') o);
      if v is null or v = 'null'::jsonb or v = '[]'::jsonb then
        if coalesce((q ->> 'required')::boolean, false) then raise exception 'Please answer: %', title; end if;
        continue;
      end if;
      if jsonb_typeof(v) <> 'array' then raise exception 'One of the choices for "%" was not recognised.', title; end if;
      picked := '{}';
      for x in select jsonb_array_elements_text(v) loop
        if x = 'other' and coalesce((q ->> 'allow_other')::boolean, false) then null;
        elsif not (x = any (ids)) then raise exception 'One of the choices for "%" was not recognised.', title;
        end if;
        if not (x = any (picked)) then picked := picked || x; end if;
      end loop;
      mx := coalesce((q ->> 'max')::integer, cardinality(ids));
      if cardinality(picked) > mx then raise exception 'Please pick at most % for: %', mx, title; end if;
      other := null;
      if 'other' = any (picked) then
        other := nullif(left(btrim(coalesce(a ->> 'other', '')), 150), '');
        if other is null then raise exception 'Please say what "Other" is: %', title; end if;
      end if;
      acc := acc || jsonb_build_object(qid, jsonb_build_object('v', to_jsonb(picked)) || case when other is not null then jsonb_build_object('other', other) else '{}'::jsonb end);
    elsif typ = 'scale' then
      if v is null or v = 'null'::jsonb then
        if coalesce((q ->> 'required')::boolean, false) then raise exception 'Please answer: %', title; end if;
        continue;
      end if;
      if jsonb_typeof(v) <> 'number' then raise exception 'That answer for "%" is not a number.', title; end if;
      num := (v #>> '{}')::numeric; mn := (q ->> 'min')::integer; mx := (q ->> 'max')::integer;
      if num <> trunc(num) or num < mn or num > mx then raise exception 'That answer for "%" is out of range.', title; end if;
      acc := acc || jsonb_build_object(qid, jsonb_build_object('v', num::integer));
    elsif typ = 'yesno' then
      if v is null or v = 'null'::jsonb then
        if coalesce((q ->> 'required')::boolean, false) then raise exception 'Please answer: %', title; end if;
        continue;
      end if;
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') not in ('yes', 'no') then raise exception 'That answer for "%" was not recognised.', title; end if;
      acc := acc || jsonb_build_object(qid, jsonb_build_object('v', v #>> '{}'));
    else   -- text, longtext
      if v is not null and v <> 'null'::jsonb and jsonb_typeof(v) <> 'string' then raise exception 'That answer for "%" was not recognised.', title; end if;
      txt := case when v is not null and jsonb_typeof(v) = 'string' then nullif(btrim(v #>> '{}'), '') end;
      if txt is null then
        if coalesce((q ->> 'required')::boolean, false) then raise exception 'Please answer: %', title; end if;
        continue;
      end if;
      if char_length(txt) > coalesce((q ->> 'max')::integer, 1000) then raise exception 'Please keep your answer to "%" shorter.', title; end if;
      acc := acc || jsonb_build_object(qid, jsonb_build_object('v', txt));
    end if;
  end loop;
  return acc;
end;
$$;
revoke all on function public.feedback_clean_answers(jsonb, jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Sending feedback: now checked against the live form
drop function if exists public.submit_event_feedback(text, integer, text[], text[], text, text, text, text, boolean, boolean, text, text, text, boolean, text, text, text, text, text);

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
  p_shoutouts text default null,
  p_answers jsonb default null
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
  form public.feedback_forms;
  cfg jsonb := '{}'::jsonb;
  cleaned jsonb := '{}'::jsonb;
  core jsonb;
begin
  -- A hidden field only bots fill in: pretend it worked.
  if btrim(coalesce(p_website, '')) <> '' then
    return jsonb_build_object('ok', true, 'already', false, 'member', false);
  end if;

  p_event_slug := btrim(coalesce(p_event_slug, ''));
  form := public.feedback_effective_form(p_event_slug);
  if form.id is not null then cfg := coalesce(form.definition -> 'settings', '{}'::jsonb); end if;
  if p_rating is not null and (p_rating < 1 or p_rating > 5) then
    raise exception 'Choose a rating from 1 to 5.';
  end if;
  -- The original fixed form always needs a rating; a custom form asks for it only if it includes it.
  if p_rating is null and form.id is null then
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

  -- The form's own rules.
  if form.id is not null then
    if nullif(cfg ->> 'closes_on', '') is not null and (cfg ->> 'closes_on')::date < current_date then
      raise exception 'This feedback form has closed.';
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

  if who = 'guest' and coalesce(cfg ->> 'audience', 'everyone') = 'members' then
    raise exception 'This form is for LACMS members. Please sign in to answer it.';
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

  -- Check the answers against the live form.
  if form.id is not null then
    core := jsonb_build_object(
      'rating', p_rating, 'liked_any', (cardinality(p_liked) > 0 or p_liked_other is not null),
      'improve_any', (cardinality(p_improve) > 0 or p_improve_other is not null),
      'would_return', p_would_return, 'shoutouts', p_shoutouts, 'comment', p_comment, 'heard', p_heard_from, 'suggestion', p_suggestion);
    cleaned := public.feedback_clean_answers(form.definition, p_answers, core);
    if not coalesce((cfg ->> 'allow_anonymous')::boolean, true) then p_anonymous := false; end if;
    if not coalesce((cfg ->> 'ask_quote_consent')::boolean, true) then p_quote_ok := false; end if;
  end if;

  insert into public.event_feedback (
    event_slug, event_name, user_id, respondent, guest_email, guest_name, guest_kind, member_course, member_year,
    rating, liked, improve, comment, would_return, heard_from, suggestion, anonymous, quote_ok, wants_updates, source,
    liked_other, improve_other, shoutouts, answers, form_version
  ) values (
    p_event_slug, ev_name, case when who = 'guest' then null else me end, who, g_email, g_name, p_guest_kind, my_course, my_year,
    p_rating, p_liked, p_improve, p_comment, p_would_return, p_heard_from, p_suggestion,
    coalesce(p_anonymous, false) and who <> 'guest', coalesce(p_quote_ok, false), coalesce(p_wants_updates, false), src,
    p_liked_other, p_improve_other, p_shoutouts, cleaned, case when form.id is not null then form.version end
  )
  on conflict do nothing
  returning id into new_id;

  return jsonb_build_object('ok', true, 'already', new_id is null, 'member', who <> 'guest', 'respondent', who);
end;
$$;

revoke all on function public.submit_event_feedback(text, integer, text[], text[], text, text, text, text, boolean, boolean, text, text, text, boolean, text, text, text, text, text, jsonb) from public;
grant execute on function public.submit_event_feedback(text, integer, text[], text[], text, text, text, text, boolean, boolean, text, text, text, boolean, text, text, text, text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Results for the new questions
-- One entry per question: counts (by option, by scale value, yes/no), typed answers, and the average.
-- p_partner = true: only the questions marked "show partners", and typed answers only from people
-- who said we may quote them (and never a response held back from partners).
create or replace function public.feedback_custom_results(p_slug text, p_partner boolean default false, p_comments text default 'all')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f public.feedback_forms;
  q jsonb;
  qid text;
  typ text;
  res jsonb := '[]'::jsonb;
  item jsonb;
  total integer;
  counts jsonb;
  texts jsonb;
  others jsonb;
  avg_v numeric;
  archived boolean;
begin
  f := public.feedback_effective_form(p_slug);
  if f.id is null then return res; end if;
  for q, archived in
    select qq, false from jsonb_array_elements(f.definition -> 'sections') s, jsonb_array_elements(s -> 'questions') qq
    union all
    select a, true from jsonb_array_elements(coalesce(f.definition -> 'archived', '[]'::jsonb)) a
  loop
    qid := q ->> 'id'; typ := q ->> 'type';
    if typ not in ('single', 'multi', 'scale', 'yesno', 'text', 'longtext') then continue; end if;
    if p_partner and (archived or not coalesce((q ->> 'partner_visible')::boolean, false)) then continue; end if;
    select count(*) into total from public.event_feedback r where r.event_slug = p_slug and r.answers ? qid;
    item := jsonb_build_object('id', qid, 'type', typ, 'title', q ->> 'title', 'archived', archived, 'total', total,
      'options', coalesce(q -> 'options', '[]'::jsonb), 'min', q -> 'min', 'max', q -> 'max', 'allow_other', q -> 'allow_other',
      'low_label', q -> 'low_label', 'high_label', q -> 'high_label', 'yes_label', q -> 'yes_label', 'no_label', q -> 'no_label',
      'show_results', q -> 'show_results');
    if typ in ('single', 'yesno', 'scale') then
      select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into counts from (
        select r.answers -> qid ->> 'v' as k, count(*) as n from public.event_feedback r
        where r.event_slug = p_slug and r.answers ? qid group by 1) z;
      item := item || jsonb_build_object('counts', counts);
      if typ = 'scale' then
        select round(avg((r.answers -> qid ->> 'v')::numeric), 2) into avg_v from public.event_feedback r where r.event_slug = p_slug and r.answers ? qid;
        item := item || jsonb_build_object('avg', avg_v);
      end if;
    elsif typ = 'multi' then
      select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into counts from (
        select e as k, count(*) as n from public.event_feedback r, jsonb_array_elements_text(r.answers -> qid -> 'v') e
        where r.event_slug = p_slug and r.answers ? qid group by 1) z;
      item := item || jsonb_build_object('counts', counts);
    end if;
    -- typed answers ("Other" and text questions)
    if typ in ('text', 'longtext') or coalesce((q ->> 'allow_other')::boolean, false) then
      select coalesce(jsonb_agg(t), '[]'::jsonb) into texts from (
        select case when typ in ('text', 'longtext') then r.answers -> qid ->> 'v' else r.answers -> qid ->> 'other' end as t
        from public.event_feedback r
        where r.event_slug = p_slug and r.answers ? qid
          and (not p_partner or (p_comments <> 'none' and not r.partner_hidden and (p_comments = 'all' or r.quote_ok)))
        order by r.created_at desc limit 60) z where t is not null;
      item := item || jsonb_build_object('texts', texts);
    end if;
    res := res || jsonb_build_array(item);
  end loop;
  return res;
end;
$$;
revoke all on function public.feedback_custom_results(text, boolean, text) from public, anon, authenticated;

-- The committee's view of one event's custom questions.
create or replace function public.feedback_form_results(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.feedback_can_read() or public.feedback_forms_can_edit()) then raise exception 'Not authorized'; end if;
  return public.feedback_custom_results(btrim(coalesce(p_slug, '')), false, 'all');
end;
$$;
revoke all on function public.feedback_form_results(text) from public, anon;
grant execute on function public.feedback_form_results(text) to authenticated;

-- Polls: once someone has answered, they can see how everyone is voting (only counts, and only once
-- at least 5 people have answered that question, so no one is picked out).
create or replace function public.feedback_poll_results(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f public.feedback_forms;
  r jsonb;
  res2 jsonb := '[]'::jsonb;
begin
  p_slug := btrim(coalesce(p_slug, ''));
  f := public.feedback_effective_form(p_slug);
  if f.id is null then return res2; end if;
  for r in select x from jsonb_array_elements(public.feedback_custom_results(p_slug, false, 'none')) x loop
    if coalesce((r ->> 'show_results')::boolean, false) and (r ->> 'archived')::boolean = false and r ->> 'type' in ('single', 'multi', 'yesno') then
      if (r ->> 'total')::integer >= 5 then
        res2 := res2 || jsonb_build_array(jsonb_build_object('id', r ->> 'id', 'type', r ->> 'type', 'title', r ->> 'title', 'options', r -> 'options',
          'yes_label', r -> 'yes_label', 'no_label', r -> 'no_label', 'total', (r ->> 'total')::integer, 'counts', r -> 'counts'));
      else
        res2 := res2 || jsonb_build_array(jsonb_build_object('id', r ->> 'id', 'title', r ->> 'title', 'hidden', true));
      end if;
    end if;
  end loop;
  return res2;
end;
$$;
revoke all on function public.feedback_poll_results(text) from public;
grant execute on function public.feedback_poll_results(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 9. The committee's list of responses now carries the new answers
drop function if exists public.president_get_feedback() cascade;
create function public.president_get_feedback()
returns table (
  id uuid, event_slug text, event_name text, created_at timestamptz, respondent text,
  person_name text, person_email text, course text, year_of_study text, guest_kind text,
  rating integer, liked text[], improve text[], comment text, would_return text, heard_from text,
  suggestion text, anonymous boolean, quote_ok boolean, wants_updates boolean, partner_hidden boolean,
  liked_other text, improve_other text, shoutouts text, answers jsonb
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
           f.liked_other, f.improve_other, f.shoutouts, f.answers
    from public.event_feedback f
    order by f.created_at desc;
end;
$$;
revoke all on function public.president_get_feedback() from public, anon;
grant execute on function public.president_get_feedback() to authenticated;

-- ---------------------------------------------------------------------
-- 10. Partner pages: questions marked "show partners" appear with each event
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
      'stats', public.partner_event_stats(array[e.slug], sp.show_comments, sp.show_ideas, sp.show_heard, sp.show_audience, sp.source_code, sp.show_shoutouts),
      'custom', public.feedback_custom_results(e.slug, true, sp.show_comments)));
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

commit;
