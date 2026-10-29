-- 108: A mentee can have more than one mentor
--
-- Until now a mentee had exactly one mentor: pairing them with a second mentor ended the first
-- pairing. Now a mentee can be mentored by several doctors in their Circle at once (up to 5):
-- pairing adds a mentor, and you can remove one mentor without touching the others. Each
-- mentor-mentee pair still has its own one-to-one meetings and messages.
--
-- Safe to run more than once. Needs 084, 085 and 086.

begin;

-- One live pairing per mentee AND mentor (the old rule was one per mentee).
drop index if exists public.sankofa_pairings_one_active;
create unique index if not exists sankofa_pairings_one_per_pair on public.sankofa_pairings (mentee_id, mentor_id) where status = 'active';

-- Pairing now ADDS a mentor.
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
  if exists (select 1 from public.sankofa_pairings where mentee_id = p_mentee and mentor_id = p_mentor and status = 'active') then
    return;
  end if;
  if (select count(*) from public.sankofa_pairings where mentee_id = p_mentee and status = 'active') >= 5 then
    raise exception 'A mentee can have up to 5 mentors.';
  end if;
  insert into public.sankofa_pairings (mentee_id, mentor_id, note, matched_by)
  values (p_mentee, p_mentor, nullif(left(coalesce(p_note, ''), 300), ''), auth.uid());
end;
$$;

-- Unpair one mentor (p_mentor) or, with no mentor given, all of a mentee's mentors.
drop function if exists public.sankofa_admin_unpair(uuid);
create or replace function public.sankofa_admin_unpair(p_mentee uuid, p_mentor uuid default null)
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
  where mentee_id = p_mentee and status = 'active' and (p_mentor is null or mentor_id = p_mentor);
end;
$$;
revoke all on function public.sankofa_admin_pair(uuid, uuid, text) from public, anon;
revoke all on function public.sankofa_admin_unpair(uuid, uuid) from public, anon;
grant execute on function public.sankofa_admin_pair(uuid, uuid, text) to authenticated;
grant execute on function public.sankofa_admin_unpair(uuid, uuid) to authenticated;

-- The committee's view of a person: all of a mentee's mentors (mentor_id stays as the first one).
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
    'mentor_id', (select pr.mentor_id from public.sankofa_pairings pr where pr.mentee_id = p_user and pr.status = 'active' order by pr.created_at limit 1),
    'mentor_ids', coalesce((select jsonb_agg(pr.mentor_id order by pr.created_at) from public.sankofa_pairings pr where pr.mentee_id = p_user and pr.status = 'active'), '[]'::jsonb),
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

-- The member's Hub home: all of a mentee's mentors (my_mentor stays as the first one).
create or replace function public.sankofa_hub_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  sp public.sankofa_participants;
  cid uuid;
  circ public.sankofa_circles;
  wk date := public.sankofa_week_start();
  is_mentor boolean;
  admin boolean := public.sankofa_is_admin();
begin
  if me is null then
    raise exception 'Please sign in.';
  end if;
  -- Not opened to this person (Hub Access rule "sankofa_hub").
  if not public.has_hub_access('sankofa_hub') then
    return jsonb_build_object('participant', false, 'is_admin', false, 'hub_closed', true);
  end if;
  select * into sp from public.sankofa_participants where user_id = me;
  if not found then
    return jsonb_build_object('participant', false, 'is_admin', admin);
  end if;
  if sp.status <> 'active' then
    return jsonb_build_object('participant', true, 'status', sp.status, 'is_admin', admin, 'me', public.sankofa_person(me, me));
  end if;

  cid := public.sankofa_circle_of(me);
  is_mentor := sp.role = 'mentor';
  if cid is not null then
    select * into circ from public.sankofa_circles where id = cid;
  end if;

  return jsonb_build_object(
    'participant', true,
    'status', 'active',
    'is_admin', admin,
    'me', public.sankofa_person(me, me) || jsonb_build_object(
      'headline', sp.headline, 'intro', sp.intro, 'specialty', sp.specialty,
      'interests', to_jsonb(sp.interests), 'offers', to_jsonb(sp.offers), 'capacity', sp.capacity,
      'comm_style', sp.comm_style, 'meeting_freq', sp.meeting_freq,
      'show_on_leaderboard', sp.show_on_leaderboard, 'profile_done', sp.profile_done,
      'welcomed', sp.welcomed_at is not null, 'joined_at', sp.created_at
    ),
    'circle', case when circ.id is null then null else jsonb_build_object(
      'id', circ.id, 'name', circ.name, 'theme', circ.theme, 'motto', circ.motto,
      'description', circ.description, 'group_link', circ.group_link, 'capacity', circ.capacity,
      'academic_year', circ.academic_year,
      'joined_at', (select cm.joined_at from public.sankofa_circle_members cm where cm.user_id = me)
    ) end,
    'members', case when cid is null then '[]'::jsonb else coalesce((
      select jsonb_agg(
        public.sankofa_person(me, cm.user_id) || jsonb_build_object(
          'is_lead', cm.is_lead,
          'is_me', cm.user_id = me,
          'level', case when sp2.show_on_leaderboard or cm.user_id = me then public.sankofa_level((select coalesce(sum(x.points), 0) from public.sankofa_xp x where x.user_id = cm.user_id)) else null end,
          'streak', case when sp2.show_on_leaderboard or cm.user_id = me then public.sankofa_streak(cm.user_id) else null end,
          'headline', case when (public.sankofa_person(me, cm.user_id) ->> 'blurred')::boolean then null else sp2.headline end,
          'can_message', cm.user_id <> me
                         and public.chat_user_eligible(me) and public.chat_user_eligible(cm.user_id)
                         and not public.chat_blocked_between(me, cm.user_id),
          'care', case when is_mentor or admin then jsonb_build_object(
              'mood', (select c.mood from public.sankofa_checkins c where c.user_id = cm.user_id order by c.week_start desc limit 1),
              'need_help', coalesce((select c.need_help and c.week_start >= wk - 14 from public.sankofa_checkins c where c.user_id = cm.user_id order by c.week_start desc limit 1), false),
              'last_active', (select max(x.created_at) from public.sankofa_xp x where x.user_id = cm.user_id)
            ) else null end
        )
        order by (sp2.role = 'mentor') desc, cm.is_lead desc, cm.joined_at
      )
      from public.sankofa_circle_members cm
      join public.sankofa_participants sp2 on sp2.user_id = cm.user_id and sp2.status = 'active'
      where cm.circle_id = cid
    ), '[]'::jsonb) end,
    'my_mentor', (
      select public.sankofa_person(me, pr.mentor_id) || jsonb_build_object(
        'headline', m2.headline, 'specialty', m2.specialty, 'offers', to_jsonb(m2.offers),
        'can_message', public.chat_user_eligible(me) and public.chat_user_eligible(pr.mentor_id) and not public.chat_blocked_between(me, pr.mentor_id),
        'pairing_id', pr.id
      )
      from public.sankofa_pairings pr join public.sankofa_participants m2 on m2.user_id = pr.mentor_id
      where pr.mentee_id = me and pr.status = 'active'
      order by pr.created_at limit 1
    ),
    'my_mentors', coalesce((
      select jsonb_agg(public.sankofa_person(me, pr.mentor_id) || jsonb_build_object(
        'headline', m2.headline, 'specialty', m2.specialty, 'offers', to_jsonb(m2.offers),
        'can_message', public.chat_user_eligible(me) and public.chat_user_eligible(pr.mentor_id) and not public.chat_blocked_between(me, pr.mentor_id),
        'pairing_id', pr.id
      ) order by pr.created_at)
      from public.sankofa_pairings pr join public.sankofa_participants m2 on m2.user_id = pr.mentor_id
      where pr.mentee_id = me and pr.status = 'active'
    ), '[]'::jsonb),
    'my_mentees', coalesce((
      select jsonb_agg(public.sankofa_person(me, pr.mentee_id) || jsonb_build_object(
        'pairing_id', pr.id,
        'can_message', public.chat_user_eligible(me) and public.chat_user_eligible(pr.mentee_id) and not public.chat_blocked_between(me, pr.mentee_id),
        'need_help', coalesce((select c.need_help and c.week_start >= wk - 14 from public.sankofa_checkins c where c.user_id = pr.mentee_id order by c.week_start desc limit 1), false)
      ) order by pr.created_at)
      from public.sankofa_pairings pr where pr.mentor_id = me and pr.status = 'active'
    ), '[]'::jsonb),
    'upcoming', coalesce((
      select jsonb_agg(public.sankofa__meeting_json(x.id) order by x.starts_at)
      from (
        select m.id, m.starts_at from public.sankofa_meetings m
        where coalesce(m.ends_at, m.starts_at + interval '1 hour') > now() and not m.cancelled and public.sankofa_can_see_meeting(m.id)
        order by m.starts_at limit 6
      ) x
    ), '[]'::jsonb),
    'recent_past', coalesce((
      select jsonb_agg(public.sankofa__meeting_json(x.id) order by x.starts_at desc)
      from (
        select m.id, m.starts_at from public.sankofa_meetings m
        where coalesce(m.ends_at, m.starts_at + interval '1 hour') <= now() and not m.cancelled
          and m.starts_at > now() - interval '14 days' and public.sankofa_can_see_meeting(m.id)
        order by m.starts_at desc limit 3
      ) x
    ), '[]'::jsonb),
    'week', jsonb_build_object(
      'week_start', wk,
      'checkin', (select jsonb_build_object('mood', c.mood, 'win', c.win, 'challenge', c.challenge, 'need_help', c.need_help)
                  from public.sankofa_checkins c where c.user_id = me and c.week_start = wk),
      'open_goals', (select count(*) from public.sankofa_goals g where g.user_id = me and not g.done),
      'goals_done_week', (select count(*) from public.sankofa_goals g where g.user_id = me and g.done and g.done_at >= wk::timestamptz),
      'posts_week', (select count(*) from public.sankofa_posts p where p.author_id = me and p.created_at >= wk::timestamptz),
      'unanswered', (
        select count(*) from public.sankofa_meetings m
        where not m.cancelled and m.starts_at > now() and m.starts_at < now() + interval '14 days'
          and public.sankofa_can_see_meeting(m.id)
          and not exists (select 1 from public.sankofa_meeting_rsvps r where r.meeting_id = m.id and r.user_id = me)
      )
    ),
    'progress', public.sankofa_progress(me)
  );
end;
$$;

commit;
