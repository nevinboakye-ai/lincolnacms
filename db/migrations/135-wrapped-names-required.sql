-- LACMS Wrapped: names, required questions, "why" boxes (run once in the Supabase SQL Editor, after 133 and 134)
--
-- What this changes:
--   1. Every voter must give their name. It is stored with the vote (only the committee can see it, never the public)
--      so the committee can check votes are genuine and spot the same person voting twice with different emails.
--   2. Each question gets a "Required" switch. A required question must be answered before someone can move on, and the
--      database refuses a vote that is missing one. Dashboard -> LACMS Wrapped -> Questions has the switch for each
--      question, plus buttons to require / un-require every question of one type at once.
--   3. A question can ask people to explain their answer ("Why did you pick them?"). It is switched on for
--      Member of the Semester (at least 10 characters).
--   4. "Song of the semester" is removed (hidden instead, if anyone already answered it), and every other question is
--      made required. Those two steps only happen the first time this is run; running it again changes none of your
--      later settings.
--   5. New committee screens: a Voters list (names, with a flag when the same name is used more than once) and every
--      "why" explanation. "Forget emails" now removes the names as well.
--
-- Replaces wrapped_submit with a version that needs a name (the old one is dropped so nobody can skip the name).
-- Needs 133. Safe to run more than once.

begin;

do $$
declare fresh boolean; c uuid;
begin
  fresh := not exists (select 1 from information_schema.columns
                        where table_schema = 'public' and table_name = 'wrapped_categories' and column_name = 'required');

  alter table public.wrapped_categories add column if not exists required boolean not null default false;
  alter table public.wrapped_categories add column if not exists ask_reason boolean not null default false;
  alter table public.wrapped_categories add column if not exists reason_label text check (reason_label is null or char_length(reason_label) <= 120);
  alter table public.wrapped_ballots add column if not exists voter_name text check (voter_name is null or char_length(voter_name) <= 80);
  alter table public.wrapped_answers add column if not exists reason text check (reason is null or char_length(reason) <= 500);

  if fresh then
    select id into c from public.wrapped_campaigns where is_current limit 1;
    if c is not null then
      -- Song of the semester goes. If people already answered it, keep those answers and just hide the question.
      if exists (select 1 from public.wrapped_answers a join public.wrapped_categories k on k.id = a.category_id where k.campaign_id = c and k.key = 'song') then
        update public.wrapped_categories set active = false where campaign_id = c and key = 'song';
      else
        delete from public.wrapped_categories where campaign_id = c and key = 'song';
      end if;

      update public.wrapped_categories set required = true where campaign_id = c and active;

      update public.wrapped_categories
         set ask_reason = true, reason_label = 'Why did you choose them? Tell us what they did.'
       where campaign_id = c and key = 'member_of_semester';

      update public.wrapped_campaigns
         set intro = 'Help us decide what goes into our Semester One Wrapped. It takes a couple of minutes. Every question needs an answer, and we ask for your name so the committee can check votes are genuine.'
       where id = c and intro = 'Help us decide what goes into our Semester One Wrapped. It takes about a minute, and every question is optional.';
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Public: the voting page also needs to know which questions are required and which ask "why"
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
                                          'required', k.required, 'ask_reason', k.ask_reason, 'reason_label', k.reason_label,
                                          'options', public.wrapped__options_json(k, c)) order by k.sort, k.created_at)
        from public.wrapped_categories k where k.campaign_id = c.id and k.active), '[]'::jsonb),
    'results', case when c.show_results then coalesce((
      select jsonb_object_agg(k.key, public.wrapped__tally(k.id, 5))
        from public.wrapped_categories k where k.campaign_id = c.id and k.active), '{}'::jsonb) else null end);
end;
$$;
revoke all on function public.wrapped_get() from public;
grant execute on function public.wrapped_get() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Public: send in a ballot. p_answers is {question key: answer}:
--   write-in -> text; pick one -> "o:<option id>", "e:<event slug>" or "other:<text>"; pick several -> a list of those; rating -> 1 to 10.
-- p_name is the voter's name (required). p_reasons is {question key: why} for questions that ask for one.
-- A vote missing a required answer (or a required "why") is refused and nothing is saved.
drop function if exists public.wrapped_submit(text, text, jsonb);

create or replace function public.wrapped_submit(p_email text, p_member text, p_answers jsonb, p_name text default null, p_reasons jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c public.wrapped_campaigns%rowtype; k public.wrapped_categories%rowtype;
  h text; v_ballot uuid; v_n int := 0; v_before int; v_cat int; v_val jsonb; v_items jsonb; v_item text; v_txt text; v_picks int; v_num int; v_id uuid;
  v_name text; v_reason text; v_missing text[] := '{}';
  v_member text := case when p_member in ('member', 'not_member', 'unsure') then p_member else 'unsure' end;
begin
  select * into c from public.wrapped_campaigns where is_current limit 1;
  if not found or not (c.open and (c.closes_at is null or now() < c.closes_at)) then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if not public.unity_email_ok(btrim(coalesce(p_email, ''))) then return jsonb_build_object('ok', false, 'error', 'bad_email'); end if;
  if public.unity_disposable(p_email) then return jsonb_build_object('ok', false, 'error', 'disposable'); end if;
  v_name := left(btrim(regexp_replace(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), 80);
  if char_length(v_name) < 2 or v_name !~ '[[:alpha:]]' then return jsonb_build_object('ok', false, 'error', 'bad_name'); end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then return jsonb_build_object('ok', false, 'error', 'empty'); end if;
  if p_reasons is null or jsonb_typeof(p_reasons) <> 'object' then p_reasons := '{}'::jsonb; end if;
  if (select count(*) from public.wrapped_ballots where created_at > now() - interval '1 minute') >= 90 then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  h := public.unity_email_hash(p_email);
  begin
    insert into public.wrapped_ballots (campaign_id, voter_hash, voter_name, member_status) values (c.id, h, v_name, v_member) returning id into v_ballot;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already_voted');
  end;

  for k in select * from public.wrapped_categories where campaign_id = c.id and active order by sort loop
    v_before := v_n;
    v_val := p_answers -> k.key;
    if not (v_val is null or v_val = 'null'::jsonb or v_val = '""'::jsonb or v_val = '[]'::jsonb) then

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
    end if;

    v_cat := v_n - v_before;
    if v_cat > 0 and k.ask_reason then
      v_reason := left(btrim(regexp_replace(regexp_replace(coalesce(p_reasons ->> k.key, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), 500);
      if char_length(v_reason) >= 10 then
        update public.wrapped_answers set reason = v_reason
         where id = (select min(a.id) from public.wrapped_answers a where a.ballot_id = v_ballot and a.category_id = k.id);
      else
        v_missing := v_missing || k.key;
      end if;
    end if;
    -- a required question must be answered, unless there is genuinely nothing to pick from
    if v_cat = 0 and k.required
       and not (k.kind in ('choice', 'multi') and not k.allow_other and jsonb_array_length(public.wrapped__options_json(k, c)) = 0) then
      v_missing := v_missing || k.key;
    end if;
  end loop;

  if array_length(v_missing, 1) > 0 then
    delete from public.wrapped_ballots where id = v_ballot;
    return jsonb_build_object('ok', false, 'error', 'missing', 'missing', to_jsonb(v_missing));
  end if;
  if v_n = 0 then
    delete from public.wrapped_ballots where id = v_ballot;
    return jsonb_build_object('ok', false, 'error', 'empty');
  end if;
  return jsonb_build_object('ok', true, 'answers', v_n);
end;
$$;
revoke all on function public.wrapped_submit(text, text, jsonb, text, jsonb) from public;
grant execute on function public.wrapped_submit(text, text, jsonb, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Committee
-- The overview also counts how many votes have a name
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
      'with_email', (select count(*) from public.wrapped_ballots b where b.campaign_id = c.id and b.voter_hash is not null),
      'with_name', (select count(*) from public.wrapped_ballots b where b.campaign_id = c.id and b.voter_name is not null)),
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
    required = coalesce((p ->> 'required')::boolean, required),
    ask_reason = coalesce((p ->> 'ask_reason')::boolean, ask_reason),
    reason_label = case when p ? 'reason_label' then left(nullif(btrim(p ->> 'reason_label'), ''), 120) else reason_label end,
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

-- Require (or stop requiring) every shown question of one type at once.
-- p_kind: 'write_in', 'choice', 'multi', 'rating', or 'all'. Returns how many questions it changed.
create or replace function public.wrapped_admin_set_required(p_kind text, p_required boolean)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  perform public.wrapped__require_admin();
  if p_kind is null or p_kind not in ('all', 'write_in', 'choice', 'multi', 'rating') then raise exception 'Unknown question type.'; end if;
  update public.wrapped_categories k set required = coalesce(p_required, false)
    from public.wrapped_campaigns c
   where c.id = k.campaign_id and c.is_current and k.active and (p_kind = 'all' or k.kind = p_kind);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.wrapped_admin_set_required(text, boolean) from public, anon;
grant execute on function public.wrapped_admin_set_required(text, boolean) to authenticated;

-- Who voted (names), and every "why" explanation with the name beside it. Committee only.
create or replace function public.wrapped_admin_voters()
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
    'ok', true,
    'voters', coalesce((
      select jsonb_agg(jsonb_build_object('name', b.voter_name, 'status', b.member_status, 'at', b.created_at,
                                          'same_name', case when b.voter_name is null then 0 else
                                            (select count(*) from public.wrapped_ballots x where x.campaign_id = c.id and lower(x.voter_name) = lower(b.voter_name)) end)
                       order by b.created_at desc)
        from (select * from public.wrapped_ballots where campaign_id = c.id order by created_at desc limit 1000) b), '[]'::jsonb),
    'reasons', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', k.key, 'title', k.title, 'voter', b.voter_name, 'status', b.member_status, 'at', b.created_at, 'reason', a.reason,
               'answer', case left(a.answer_key, 2)
                           when 'o:' then coalesce((select o.label from public.wrapped_options o where o.id = substr(a.answer_key, 3)::uuid), 'A removed option')
                           when 'e:' then coalesce((select e.name from public.site_events e where e.slug = substr(a.answer_key, 3)), substr(a.answer_key, 3))
                           else a.text_value end)
             order by k.sort, b.created_at desc)
        from public.wrapped_answers a
        join public.wrapped_ballots b on b.id = a.ballot_id
        join public.wrapped_categories k on k.id = a.category_id
       where k.campaign_id = c.id and a.reason is not null), '[]'::jsonb));
end;
$$;
revoke all on function public.wrapped_admin_voters() from public, anon;
grant execute on function public.wrapped_admin_voters() to authenticated;

-- After voting: forget the scrambled emails and the names (the answers stay, with nothing to link them to a person)
create or replace function public.wrapped_admin_tidy()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  perform public.wrapped__require_admin();
  update public.wrapped_ballots b set voter_hash = null, voter_name = null
    from public.wrapped_campaigns c
   where c.id = b.campaign_id and c.is_current and not (c.open and (c.closes_at is null or now() < c.closes_at))
     and (b.voter_hash is not null or b.voter_name is not null);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.wrapped_admin_tidy() from public, anon;
grant execute on function public.wrapped_admin_tidy() to authenticated;

commit;
