-- Sankofa Hub, part 2 of 4: the committee's Circle-management tools.
--
-- Everything the president and Executive Committee use to run the Hub from
-- the dashboard: see every Circle and who is in it, bring accepted students
-- and professionals into the Hub, move anyone between Circles at any time,
-- pair a mentee with a mentor, and apply a whole suggested plan in one go.
--
-- Who counts as "the committee" is the Hub Access rule dash_sankofa (the
-- president plus the Executive Committee by default), checked inside every
-- function. Needs 084.
--
-- Wrapped in a transaction. Run this once in Supabase: Dashboard -> SQL
-- Editor -> New query, paste, Run.

begin;

-- ---------------------------------------------------------------------
-- One participant with everything the committee needs to place them:
-- profile, Circle, mentor / mentees, XP and the latest check-in.
create or replace function public.sankofa_admin_person(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.sankofa_person(p_user, p_user) || jsonb_build_object(
    'email', u.email::text,
    'status', sp.status,
    'headline', sp.headline,
    'intro', sp.intro,
    'specialty', sp.specialty,
    'interests', to_jsonb(sp.interests),
    'offers', to_jsonb(sp.offers),
    'capacity', sp.capacity,
    'comm_style', sp.comm_style,
    'meeting_freq', sp.meeting_freq,
    'heritage', sp.heritage,
    'aspirations', sp.aspirations,
    'looking_for', sp.looking_for,
    'social', sp.social, 'fitness', sp.fitness, 'study', sp.study, 'support', sp.support,
    'profile_done', sp.profile_done,
    'welcomed', sp.welcomed_at is not null,
    'joined_at', sp.created_at,
    'circle_id', cm.circle_id,
    'is_lead', coalesce(cm.is_lead, false),
    'mentor_id', (select pr.mentor_id from public.sankofa_pairings pr where pr.mentee_id = p_user and pr.status = 'active'),
    'mentee_ids', coalesce((select jsonb_agg(pr.mentee_id) from public.sankofa_pairings pr where pr.mentor_id = p_user and pr.status = 'active'), '[]'::jsonb),
    'xp', coalesce((select sum(x.points) from public.sankofa_xp x where x.user_id = p_user), 0),
    'last_active', (select max(x.created_at) from public.sankofa_xp x where x.user_id = p_user),
    'checkin', (
      select jsonb_build_object('mood', c.mood, 'need_help', c.need_help, 'week', c.week_start, 'at', c.updated_at)
      from public.sankofa_checkins c where c.user_id = p_user order by c.week_start desc limit 1
    )
  )
  from public.sankofa_participants sp
  left join public.sankofa_circle_members cm on cm.user_id = sp.user_id
  left join auth.users u on u.id = sp.user_id
  where sp.user_id = p_user;
$$;
revoke all on function public.sankofa_admin_person(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- The whole board in one call.
create or replace function public.sankofa_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.sankofa_is_admin() then
    raise exception 'Not authorized';
  end if;
  return jsonb_build_object(
    'circles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'theme', c.theme, 'motto', c.motto, 'description', c.description,
        'group_link', c.group_link, 'capacity', c.capacity, 'status', c.status,
        'academic_year', c.academic_year, 'sort_order', c.sort_order,
        'next_meeting', (
          select m.starts_at from public.sankofa_meetings m
          where m.circle_id = c.id and m.pairing_id is null and not m.cancelled and m.starts_at > now()
          order by m.starts_at limit 1
        ),
        'members', coalesce((
          select jsonb_agg(public.sankofa_admin_person(mm.user_id) order by mm.is_mentor desc, mm.is_lead desc, mm.joined_at)
          from (
            select cm.user_id, cm.is_lead, cm.joined_at, (sp.role = 'mentor') as is_mentor
            from public.sankofa_circle_members cm
            join public.sankofa_participants sp on sp.user_id = cm.user_id
            where cm.circle_id = c.id
          ) mm
        ), '[]'::jsonb)
      ) order by c.status, c.sort_order, c.created_at)
      from public.sankofa_circles c
    ), '[]'::jsonb),
    'unplaced', coalesce((
      select jsonb_agg(public.sankofa_admin_person(sp.user_id) order by sp.role, sp.created_at)
      from public.sankofa_participants sp
      where not exists (select 1 from public.sankofa_circle_members cm where cm.user_id = sp.user_id)
    ), '[]'::jsonb),
    'stats', jsonb_build_object(
      'participants', (select count(*) from public.sankofa_participants),
      'mentees', (select count(*) from public.sankofa_participants where role = 'mentee'),
      'mentors', (select count(*) from public.sankofa_participants where role = 'mentor'),
      'placed', (select count(*) from public.sankofa_circle_members),
      'circles', (select count(*) from public.sankofa_circles where status = 'active'),
      'pairings', (select count(*) from public.sankofa_pairings where status = 'active'),
      'upcoming', (select count(*) from public.sankofa_meetings where not cancelled and starts_at > now() and starts_at < now() + interval '14 days'),
      'need_help', (
        select count(*) from public.sankofa_checkins c
        where c.need_help and c.week_start >= (date_trunc('week', now()) - interval '14 days')::date
          and c.week_start = (select max(c2.week_start) from public.sankofa_checkins c2 where c2.user_id = c.user_id)
      )
    )
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Who could be brought in: accepted/pending student applicants and
-- professionals with an account who aren't in the Hub yet.
create or replace function public.sankofa_admin_candidates()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.sankofa_is_admin() then
    raise exception 'Not authorized';
  end if;
  return jsonb_build_object(
    'mentees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', a.member_id,
        'application_id', a.id,
        'name', coalesce(m.full_name, u.email::text),
        'email', u.email::text,
        'detail', nullif(concat_ws(' · ', m.course, m.year_of_study), ''),
        'status', a.status,
        'applied_at', a.created_at,
        'sixth_form', coalesce(public.chat_is_sixth_form(a.member_id), false),
        'specialty', a.specialty_interest,
        'interests', to_jsonb(coalesce(a.hobbies_interests, '{}'::text[])),
        'comm_style', a.communication_style,
        'meeting_freq', a.meeting_frequency,
        'aspirations', a.career_aspirations,
        'looking_for', a.looking_for
      ) order by a.created_at)
      from (
        select distinct on (sa.member_id) sa.*
        from public.sankofa_applications sa
        where sa.applicant_type = 'mentee' and sa.status <> 'declined'
        order by sa.member_id, sa.created_at desc
      ) a
      left join public.members m on m.id = a.member_id
      left join auth.users u on u.id = a.member_id
      where not exists (select 1 from public.sankofa_participants p where p.user_id = a.member_id)
    ), '[]'::jsonb),
    'mentors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', np.user_id,
        'name', np.full_name,
        'email', u.email::text,
        'detail', nullif(concat_ws(' · ', np.title, np.organisation), ''),
        'category', np.category,
        'specialty', ma.mentor_specialty,
        'offers', to_jsonb(coalesce(ma.what_you_offer, '{}'::text[])),
        'capacity', ma.mentee_capacity
      ) order by np.full_name)
      from public.network_professionals np
      left join auth.users u on u.id = np.user_id
      left join lateral (
        select sa.* from public.sankofa_applications sa
        where sa.member_id = np.user_id and sa.applicant_type = 'mentor'
        order by sa.created_at desc limit 1
      ) ma on true
      where np.user_id is not null and np.is_active
        and not exists (select 1 from public.sankofa_participants p where p.user_id = np.user_id)
    ), '[]'::jsonb),
    -- Mentors who applied on the public form but have no account yet: they
    -- can't be added until the committee creates an account for them.
    'no_account', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', sma.full_name, 'email', sma.email, 'job_title', sma.job_title,
        'organisation', sma.organisation, 'applied_at', sma.created_at
      ) order by sma.created_at)
      from public.sankofa_mentor_applications sma
      where not exists (
        select 1 from auth.users au join public.sankofa_participants p on p.user_id = au.id
        where lower(au.email::text) = lower(sma.email)
      )
    ), '[]'::jsonb)
  );
end;
$$;

-- Find anyone with an account by name (to add someone who didn't apply).
create or replace function public.sankofa_admin_search_people(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q text := '%' || regexp_replace(coalesce(p_query, ''), '[%_\\]', '', 'g') || '%';
begin
  if not public.sankofa_is_admin() then
    raise exception 'Not authorized';
  end if;
  if char_length(coalesce(p_query, '')) < 2 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(r order by r->>'name') from (
      select jsonb_build_object(
        'user_id', m.id, 'name', m.full_name, 'kind', 'member',
        'detail', nullif(concat_ws(' · ', m.course, m.year_of_study), ''),
        'sixth_form', public.is_sixth_form_profile(m.course, m.year_of_study)
      ) as r
      from public.members m
      where m.membership_status = 'active' and m.full_name ilike q
        and not exists (select 1 from public.sankofa_participants p where p.user_id = m.id)
      union all
      select jsonb_build_object(
        'user_id', np.user_id, 'name', np.full_name, 'kind', 'professional',
        'detail', nullif(concat_ws(' · ', np.title, np.organisation), ''), 'sixth_form', false
      )
      from public.network_professionals np
      where np.user_id is not null and np.is_active and np.full_name ilike q
        and not exists (select 1 from public.members mm where mm.id = np.user_id)
        and not exists (select 1 from public.sankofa_participants p where p.user_id = np.user_id)
      limit 20
    ) x
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- Moving people. The internal function does the work for both a single
-- move and a whole plan; every move is recorded in the history.
create or replace function public.sankofa__move(p_user uuid, p_circle uuid, p_by uuid, p_note text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  cur uuid;
begin
  if not exists (select 1 from public.sankofa_participants where user_id = p_user) then
    raise exception 'That person isn''t in the Hub yet.';
  end if;
  if p_circle is not null and not exists (select 1 from public.sankofa_circles where id = p_circle and status = 'active') then
    raise exception 'That Circle isn''t available.';
  end if;

  select circle_id into cur from public.sankofa_circle_members where user_id = p_user;
  if cur is not distinct from p_circle then
    return false;
  end if;

  if p_circle is null then
    delete from public.sankofa_circle_members where user_id = p_user;
  else
    insert into public.sankofa_circle_members (user_id, circle_id, is_lead, joined_at, moved_by)
    values (p_user, p_circle, false, now(), p_by)
    on conflict (user_id) do update
      set circle_id = excluded.circle_id, is_lead = false, joined_at = now(), moved_by = excluded.moved_by;
  end if;

  insert into public.sankofa_circle_history (user_id, from_circle, to_circle, by_user, note)
  values (p_user, cur, p_circle, p_by, nullif(left(coalesce(p_note, ''), 300), ''));
  return true;
end;
$$;
revoke all on function public.sankofa__move(uuid, uuid, uuid, text) from public, anon, authenticated;

create or replace function public.sankofa_admin_move(p_user uuid, p_circle uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.sankofa_is_admin() then
    raise exception 'Not authorized';
  end if;
  perform public.sankofa__move(p_user, p_circle, auth.uid(), p_note);
  return public.sankofa_admin_person(p_user);
end;
$$;

create or replace function public.sankofa_admin_set_lead(p_user uuid, p_lead boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
begin
  if not public.sankofa_is_admin() then
    raise exception 'Not authorized';
  end if;
  select circle_id into cid from public.sankofa_circle_members where user_id = p_user;
  if cid is null then
    raise exception 'Place them in a Circle first.';
  end if;
  update public.sankofa_circle_members set is_lead = p_lead where user_id = p_user;
end;
$$;

-- ---------------------------------------------------------------------
-- Pairing a mentee with a mentor.
create or replace function public.sankofa_admin_pair(p_mentee uuid, p_mentor uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.sankofa_is_admin() then
    raise exception 'Not authorized';
  end if;
  if coalesce(public.sankofa_role_of(p_mentee), '') <> 'mentee' or coalesce(public.sankofa_role_of(p_mentor), '') <> 'mentor' then
    raise exception 'Pair a mentee with a mentor.';
  end if;
  update public.sankofa_pairings set status = 'ended', ended_at = now()
  where mentee_id = p_mentee and status = 'active' and mentor_id <> p_mentor;
  if not exists (select 1 from public.sankofa_pairings where mentee_id = p_mentee and mentor_id = p_mentor and status = 'active') then
    insert into public.sankofa_pairings (mentee_id, mentor_id, note, matched_by)
    values (p_mentee, p_mentor, nullif(left(coalesce(p_note, ''), 300), ''), auth.uid());
  end if;
end;
$$;

create or replace function public.sankofa_admin_unpair(p_mentee uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.sankofa_is_admin() then
    raise exception 'Not authorized';
  end if;
  update public.sankofa_pairings set status = 'ended', ended_at = now()
  where mentee_id = p_mentee and status = 'active';
end;
$$;

-- Apply a whole suggested plan at once:
--   { "moves":    [ { "user": uuid, "circle": uuid|null }, ... ],
--     "pairings": [ { "mentee": uuid, "mentor": uuid }, ... ] }
-- All or nothing: if any step is invalid, none are applied.
create or replace function public.sankofa_admin_apply_plan(p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  mv jsonb;
  pr jsonb;
  moved integer := 0;
  paired integer := 0;
begin
  if not public.sankofa_is_admin() then
    raise exception 'Not authorized';
  end if;
  for mv in select * from jsonb_array_elements(coalesce(p_plan -> 'moves', '[]'::jsonb)) loop
    if public.sankofa__move((mv ->> 'user')::uuid, nullif(mv ->> 'circle', '')::uuid, auth.uid(), 'Applied from a suggested plan') then
      moved := moved + 1;
    end if;
  end loop;
  for pr in select * from jsonb_array_elements(coalesce(p_plan -> 'pairings', '[]'::jsonb)) loop
    perform public.sankofa_admin_pair((pr ->> 'mentee')::uuid, (pr ->> 'mentor')::uuid, 'Applied from a suggested plan');
    paired := paired + 1;
  end loop;
  return jsonb_build_object('moved', moved, 'paired', paired);
end;
$$;

-- ---------------------------------------------------------------------
-- Bringing people into the Hub. Their answers on the application are
-- carried over so there is something to match on from day one.
create or replace function public.sankofa__add_participant(p_user uuid, p_role text, p_by uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  app public.sankofa_applications;
  cap integer;
begin
  if p_role not in ('mentee', 'mentor') then
    raise exception 'Choose mentee or mentor.';
  end if;
  if not (
    exists (select 1 from public.members m where m.id = p_user)
    or exists (select 1 from public.network_professionals np where np.user_id = p_user)
    or p_user = '22044cd2-6804-4142-96c4-5c475ce9347a'::uuid
  ) then
    raise exception 'That person doesn''t have a LACMS account.';
  end if;

  select * into app from public.sankofa_applications sa
  where sa.member_id = p_user and sa.applicant_type = p_role and sa.status <> 'declined'
  order by sa.created_at desc limit 1;

  if p_role = 'mentor' and app.id is not null then
    cap := nullif(substring(coalesce(app.mentee_capacity, '') from '\d+'), '')::integer;
    if cap is not null then
      cap := least(20, cap);
    end if;
  end if;

  insert into public.sankofa_participants (
    user_id, role, application_id, specialty, interests, offers, capacity, comm_style, meeting_freq,
    heritage, aspirations, looking_for, social, fitness, study, support, added_by
  ) values (
    p_user, p_role, app.id,
    case when p_role = 'mentor' then app.mentor_specialty else app.specialty_interest end,
    coalesce(app.hobbies_interests, '{}'::text[]),
    coalesce(app.what_you_offer, '{}'::text[]),
    cap,
    app.communication_style, app.meeting_frequency,
    app.heritage, app.career_aspirations, app.looking_for,
    app.social_preference, app.fitness_preference, app.study_style, app.support_style,
    p_by
  )
  on conflict (user_id) do update set status = 'active';

  if app.id is not null and app.status = 'pending' then
    update public.sankofa_applications set status = 'accepted' where id = app.id;
  end if;
end;
$$;
revoke all on function public.sankofa__add_participant(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.sankofa_admin_add_participant(p_user uuid, p_role text, p_circle uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.sankofa_is_admin() then
    raise exception 'Not authorized';
  end if;
  perform public.sankofa__add_participant(p_user, p_role, auth.uid());
  if p_circle is not null then
    perform public.sankofa__move(p_user, p_circle, auth.uid(), 'Added to the Hub');
  end if;
  return public.sankofa_admin_person(p_user);
end;
$$;

-- p_people: [ { "user": uuid, "role": "mentee"|"mentor" }, ... ]
create or replace function public.sankofa_admin_add_many(p_people jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  x jsonb;
  n integer := 0;
begin
  if not public.sankofa_is_admin() then
    raise exception 'Not authorized';
  end if;
  for x in select * from jsonb_array_elements(coalesce(p_people, '[]'::jsonb)) loop
    perform public.sankofa__add_participant((x ->> 'user')::uuid, x ->> 'role', auth.uid());
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.sankofa_admin_set_status(p_user uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.sankofa_is_admin() then
    raise exception 'Not authorized';
  end if;
  if p_status not in ('active', 'paused', 'alumni') then
    raise exception 'Invalid status';
  end if;
  update public.sankofa_participants set status = p_status where user_id = p_user;
end;
$$;

-- Taking someone out of the Hub (their goals, XP and badges are kept in
-- case they return).
create or replace function public.sankofa_admin_remove_participant(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.sankofa_is_admin() then
    raise exception 'Not authorized';
  end if;
  update public.sankofa_pairings set status = 'ended', ended_at = now()
  where status = 'active' and p_user in (mentee_id, mentor_id);
  delete from public.sankofa_participants where user_id = p_user;
end;
$$;

-- Fix up what the matching uses (stage label, specialty, interests, ...).
create or replace function public.sankofa_admin_update_participant(p_user uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.sankofa_is_admin() then
    raise exception 'Not authorized';
  end if;
  update public.sankofa_participants sp set
    stage_label  = case when p_patch ? 'stage_label'  then nullif(left(p_patch ->> 'stage_label', 60), '')  else sp.stage_label end,
    specialty    = case when p_patch ? 'specialty'    then nullif(left(p_patch ->> 'specialty', 80), '')    else sp.specialty end,
    comm_style   = case when p_patch ? 'comm_style'   then nullif(left(p_patch ->> 'comm_style', 60), '')   else sp.comm_style end,
    meeting_freq = case when p_patch ? 'meeting_freq' then nullif(left(p_patch ->> 'meeting_freq', 60), '') else sp.meeting_freq end,
    capacity     = case when p_patch ? 'capacity'     then (case when nullif(p_patch ->> 'capacity', '') is null then null else least(20, greatest(0, (p_patch ->> 'capacity')::integer)) end)::smallint else sp.capacity end,
    interests    = case when p_patch ? 'interests'    then coalesce(array(select left(trim(v), 40) from jsonb_array_elements_text(p_patch -> 'interests') v where trim(v) <> '' limit 12), '{}'::text[]) else sp.interests end,
    offers       = case when p_patch ? 'offers'       then coalesce(array(select left(trim(v), 60) from jsonb_array_elements_text(p_patch -> 'offers') v where trim(v) <> '' limit 12), '{}'::text[]) else sp.offers end
  where sp.user_id = p_user;
  return public.sankofa_admin_person(p_user);
end;
$$;

-- ---------------------------------------------------------------------
-- Circles themselves.
create or replace function public.sankofa_admin_save_circle(
  p_id uuid, p_name text, p_theme text, p_motto text, p_description text,
  p_group_link text, p_capacity integer, p_status text, p_academic_year text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid := p_id;
  link text := nullif(trim(coalesce(p_group_link, '')), '');
begin
  if not public.sankofa_is_admin() then
    raise exception 'Not authorized';
  end if;
  if link is not null and link !~* '^https?://' then
    link := 'https://' || link;
  end if;
  if link is not null and link !~* '^https?://[^\s]+$' then
    raise exception 'That group link doesn''t look right.';
  end if;

  if cid is null then
    insert into public.sankofa_circles (name, theme, motto, description, group_link, capacity, status, academic_year, sort_order, created_by)
    values (
      trim(p_name), coalesce(nullif(p_theme, ''), 'gold'), nullif(trim(coalesce(p_motto, '')), ''),
      nullif(trim(coalesce(p_description, '')), ''), link, coalesce(p_capacity, 8),
      coalesce(nullif(p_status, ''), 'active'), nullif(trim(coalesce(p_academic_year, '')), ''),
      coalesce((select max(sort_order) + 1 from public.sankofa_circles), 0), auth.uid()
    ) returning id into cid;
  else
    update public.sankofa_circles set
      name = trim(p_name), theme = coalesce(nullif(p_theme, ''), theme),
      motto = nullif(trim(coalesce(p_motto, '')), ''), description = nullif(trim(coalesce(p_description, '')), ''),
      group_link = link, capacity = coalesce(p_capacity, capacity),
      status = coalesce(nullif(p_status, ''), status),
      academic_year = nullif(trim(coalesce(p_academic_year, '')), '')
    where id = cid;
    if not found then
      raise exception 'Circle not found.';
    end if;
  end if;
  return cid;
end;
$$;

-- Only an empty Circle can be deleted; otherwise archive it.
create or replace function public.sankofa_admin_delete_circle(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.sankofa_is_admin() then
    raise exception 'Not authorized';
  end if;
  if exists (select 1 from public.sankofa_circle_members where circle_id = p_id) then
    raise exception 'Move everyone out of this Circle first (or archive it instead).';
  end if;
  delete from public.sankofa_circles where id = p_id;
end;
$$;

-- Recent moves, newest first, for the activity log.
create or replace function public.sankofa_admin_history(p_limit integer default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.sankofa_is_admin() then
    raise exception 'Not authorized';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'at', h.at,
      'person', coalesce(m.full_name, np.full_name, 'Someone'),
      'from', fc.name, 'to', tc.name,
      'by', coalesce(bm.full_name, bnp.full_name, case when h.by_user = '22044cd2-6804-4142-96c4-5c475ce9347a'::uuid then 'President' else 'Committee' end),
      'note', h.note
    ) order by h.at desc)
    from (select * from public.sankofa_circle_history order by at desc limit least(greatest(coalesce(p_limit, 40), 1), 200)) h
    left join public.members m on m.id = h.user_id
    left join lateral (select q.full_name from public.network_professionals q where q.user_id = h.user_id limit 1) np on true
    left join public.sankofa_circles fc on fc.id = h.from_circle
    left join public.sankofa_circles tc on tc.id = h.to_circle
    left join public.members bm on bm.id = h.by_user
    left join lateral (select q.full_name from public.network_professionals q where q.user_id = h.by_user limit 1) bnp on true
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- Let the signed-in committee call the tools; each one re-checks the rule.
do $$
declare
  f text;
begin
  foreach f in array array[
    'sankofa_admin_overview()', 'sankofa_admin_candidates()', 'sankofa_admin_search_people(text)',
    'sankofa_admin_move(uuid, uuid, text)', 'sankofa_admin_set_lead(uuid, boolean)',
    'sankofa_admin_pair(uuid, uuid, text)', 'sankofa_admin_unpair(uuid)', 'sankofa_admin_apply_plan(jsonb)',
    'sankofa_admin_add_participant(uuid, text, uuid)', 'sankofa_admin_add_many(jsonb)',
    'sankofa_admin_set_status(uuid, text)', 'sankofa_admin_remove_participant(uuid)',
    'sankofa_admin_update_participant(uuid, jsonb)',
    'sankofa_admin_save_circle(uuid, text, text, text, text, text, integer, text, text)',
    'sankofa_admin_delete_circle(uuid)', 'sankofa_admin_history(integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

commit;
