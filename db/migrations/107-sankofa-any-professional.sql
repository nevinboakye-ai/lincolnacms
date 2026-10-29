-- 107: Add any professional to the Sankofa Circles
--
-- Some professionals who had signed up could not be added to a Circle. Two reasons:
--   * They asked for an account (the request page creates their login straight away) but the
--     committee hadn't approved them yet, so they had no professional profile and the Hub treated
--     them as not having an account.
--   * Their professional profile was switched off (inactive) in the Network.
-- Now "Add people" and the name search find every professional who has a login: approved,
-- awaiting approval, or inactive, and you can search by name or by email. Someone who is still
-- awaiting approval is marked "awaiting approval": they sit in their Circle by name straight away
-- and the Hub opens for them once their account is approved (the Hub's own access rules still apply).
--
-- Safe to run more than once. Needs 084, 085 and 096.

begin;

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
      select jsonb_agg(r order by r ->> 'name') from (
        select jsonb_build_object(
          'user_id', np.user_id,
          'name', np.full_name,
          'email', u.email::text,
          'detail', nullif(concat_ws(' · ', np.title, np.organisation), ''),
          'category', np.category,
          'specialty', ma.mentor_specialty,
          'offers', to_jsonb(coalesce(ma.what_you_offer, '{}'::text[])),
          'capacity', ma.mentee_capacity,
          'inactive', not np.is_active
        ) as r
        from public.network_professionals np
        left join auth.users u on u.id = np.user_id
        left join lateral (
          select sa.* from public.sankofa_applications sa
          where sa.member_id = np.user_id and sa.applicant_type = 'mentor'
          order by sa.created_at desc limit 1
        ) ma on true
        where np.user_id is not null
          and not exists (select 1 from public.sankofa_participants p where p.user_id = np.user_id)
        union all
        -- Signed up and waiting for approval: they have a login but no professional profile yet.
        select jsonb_build_object(
          'user_id', pr.auth_user_id,
          'name', pr.full_name,
          'email', u.email::text,
          'detail', nullif(concat_ws(' · ', pr.job_title, pr.organisation), ''),
          'category', pr.category,
          'specialty', pr.specialty,
          'offers', '[]'::jsonb,
          'capacity', null,
          'pending_approval', true
        )
        from public.professional_requests pr
        join auth.users u on u.id = pr.auth_user_id
        where pr.auth_user_id is not null and pr.status <> 'rejected'
          and not exists (select 1 from public.network_professionals np where np.user_id = pr.auth_user_id)
          and not exists (select 1 from public.members m where m.id = pr.auth_user_id)
          and not exists (select 1 from public.sankofa_participants p where p.user_id = pr.auth_user_id)
      ) x
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
        'detail', nullif(concat_ws(' · ', np.title, np.organisation), ''), 'sixth_form', false,
        'inactive', not np.is_active
      )
      from public.network_professionals np
      left join auth.users u on u.id = np.user_id
      where np.user_id is not null and (np.full_name ilike q or u.email::text ilike q)
        and not exists (select 1 from public.members mm where mm.id = np.user_id)
        and not exists (select 1 from public.sankofa_participants p where p.user_id = np.user_id)
      union all
      select jsonb_build_object(
        'user_id', pr.auth_user_id, 'name', pr.full_name, 'kind', 'professional',
        'detail', concat_ws(' · ', nullif(concat_ws(' · ', pr.job_title, pr.organisation), ''), 'awaiting approval'), 'sixth_form', false,
        'pending_approval', true
      )
      from public.professional_requests pr
      join auth.users u on u.id = pr.auth_user_id
      where pr.auth_user_id is not null and pr.status <> 'rejected' and (pr.full_name ilike q or u.email::text ilike q or pr.email ilike q)
        and not exists (select 1 from public.network_professionals np where np.user_id = pr.auth_user_id)
        and not exists (select 1 from public.members mm where mm.id = pr.auth_user_id)
        and not exists (select 1 from public.sankofa_participants p where p.user_id = pr.auth_user_id)
      limit 20
    ) x
  ), '[]'::jsonb);
end;
$$;

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
    or exists (select 1 from public.professional_requests pr where pr.auth_user_id = p_user and pr.status <> 'rejected')
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

create or replace function public.sankofa_person(p_viewer uuid, p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p_user,
    'name', case when x.blurred then 'Sixth-form member'
                 else coalesce(x.mname, x.pname, x.rname, case when p_user = '22044cd2-6804-4142-96c4-5c475ce9347a'::uuid then 'President' else 'LACMS member' end) end,
    'role', x.prole,
    'stage', x.stage,
    'detail', case when x.blurred then null else x.detail end,
    'photo', case when x.blurred then null else x.photo end,
    'blurred', x.blurred,
    'sixth_form', x.sixth,
    'is_pro', ((x.pname is not null or x.rname is not null) and x.mname is null),
    'awaiting_approval', (x.mname is null and x.pname is null and x.rname is not null)
  )
  from (
    select
      m.full_name as mname,
      np.full_name as pname,
      pr.full_name as rname,
      sp.role as prole,
      np.photo_url as photo,
      s.sixth as sixth,
      (s.sixth and p_viewer is distinct from p_user and not public.chat_is_executive(p_viewer)) as blurred,
      coalesce(
        nullif(sp.stage_label, ''),
        case
          when m.id is null and np.id is not null then
            case np.category
              when 'senior_doctor' then 'Senior doctor'
              when 'alumni_doctor' then 'Alumni doctor'
              when 'pharmacist' then 'Pharmacist'
              else 'Professional'
            end
          when m.id is null and np.id is null and pr.id is not null then
            case pr.category
              when 'senior_doctor' then 'Senior doctor'
              when 'alumni_doctor' then 'Alumni doctor'
              when 'pharmacist' then 'Pharmacist'
              else 'Professional'
            end
          when s.sixth then 'Aspiring medic'
          else nullif(concat_ws(' · ', m.course, m.year_of_study), '')
        end
      ) as stage,
      case
        when m.id is null and np.id is not null then nullif(concat_ws(' · ', np.title, np.organisation), '')
        when m.id is null and pr.id is not null then nullif(concat_ws(' · ', pr.job_title, pr.organisation), '')
        else nullif(concat_ws(' · ', m.course, m.year_of_study), '')
      end as detail
    from (select 1) one
    left join public.members m on m.id = p_user
    left join lateral (
      select * from public.network_professionals q where q.user_id = p_user order by q.created_at limit 1
    ) np on true
    left join lateral (
      select * from public.professional_requests q2 where q2.auth_user_id = p_user and q2.status <> 'rejected' order by q2.created_at desc limit 1
    ) pr on true
    left join public.sankofa_participants sp on sp.user_id = p_user
    cross join lateral (select coalesce(public.chat_is_sixth_form(p_user), false) as sixth) s
  ) x;
$$;

commit;
