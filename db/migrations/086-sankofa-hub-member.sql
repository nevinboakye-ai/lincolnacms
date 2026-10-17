-- Sankofa Hub, part 3 of 4: what participants use day to day.
--
-- The Hub home (my Circle, my mentor/mentees, my next meeting), meetings
-- with RSVP and check-in, the Circle board with kudos and reactions,
-- personal goals, weekly check-ins, the Hub profile, and the people
-- directory. Each function checks who is asking.
--
-- Mentors (and the committee) can see how their Circle is doing: a
-- mentee's shared goals and weekly check-ins, so nobody quietly struggles.
--
-- Needs 084 and 085. Run 087 straight after (the Hub home asks it for XP
-- and badges).
--
-- Wrapped in a transaction. Run this once in Supabase: Dashboard -> SQL
-- Editor -> New query, paste, Run.

begin;

-- Monday of the current week in UK time (weekly check-ins and streaks).
create or replace function public.sankofa_week_start(p_at timestamptz default now())
returns date
language sql
stable
as $$
  select date_trunc('week', p_at at time zone 'Europe/London')::date;
$$;

-- ---------------------------------------------------------------------
-- A meeting as one person sees it.
create or replace function public.sankofa__meeting_json(p_meeting uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', m.id,
    'circle_id', m.circle_id,
    'circle_name', c.name,
    'theme', c.theme,
    'pairing_id', m.pairing_id,
    'title', m.title,
    'kind', m.kind,
    'starts_at', m.starts_at,
    'ends_at', m.ends_at,
    'location', m.location,
    'online_link', m.online_link,
    'description', m.description,
    'cancelled', m.cancelled,
    'host_name', (public.sankofa_person(auth.uid(), m.created_by)) ->> 'name',
    'going', (select count(*) from public.sankofa_meeting_rsvps r where r.meeting_id = m.id and r.response = 'going'),
    'maybe', (select count(*) from public.sankofa_meeting_rsvps r where r.meeting_id = m.id and r.response = 'maybe'),
    'declined', (select count(*) from public.sankofa_meeting_rsvps r where r.meeting_id = m.id and r.response = 'no'),
    'expected', case
      when m.pairing_id is not null then 2
      when m.circle_id is not null then (select count(*) from public.sankofa_circle_members cm where cm.circle_id = m.circle_id)
      else (select count(*) from public.sankofa_participants p where p.status = 'active')
    end,
    'my_response', me.response,
    'my_attended', me.attended,
    'checkin_open', (
      not m.cancelled
      and now() >= m.starts_at - interval '30 minutes'
      and now() <= coalesce(m.ends_at, m.starts_at + interval '1 hour') + interval '2 hours'
    ),
    'ended', now() > coalesce(m.ends_at, m.starts_at + interval '1 hour'),
    'can_edit', (
      public.sankofa_is_admin()
      or (m.pairing_id is not null and exists (
            select 1 from public.sankofa_pairings pr where pr.id = m.pairing_id and auth.uid() in (pr.mentee_id, pr.mentor_id)))
      or (m.pairing_id is null and m.circle_id is not null and public.sankofa_is_circle_mentor(m.circle_id))
    ),
    'feedback_given', exists (select 1 from public.sankofa_meeting_feedback f where f.meeting_id = m.id and f.user_id = auth.uid()),
    'with_person', case when m.pairing_id is null then null else (
      select public.sankofa_person(auth.uid(), case when pr.mentee_id = auth.uid() then pr.mentor_id else pr.mentee_id end)
      from public.sankofa_pairings pr where pr.id = m.pairing_id
    ) end
  )
  from public.sankofa_meetings m
  left join public.sankofa_circles c on c.id = m.circle_id
  left join public.sankofa_meeting_rsvps me on me.meeting_id = m.id and me.user_id = auth.uid()
  where m.id = p_meeting;
$$;
revoke all on function public.sankofa__meeting_json(uuid) from public, anon, authenticated;

-- Meetings I can see. p_when: 'upcoming' (not finished yet) or 'past'.
create or replace function public.sankofa_meetings(p_when text default 'upcoming', p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lim integer := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  if auth.uid() is null or not (public.sankofa_is_active(auth.uid()) or public.sankofa_is_admin()) then
    raise exception 'The Sankofa Hub isn''t available on your account.';
  end if;
  if p_when = 'past' then
    return coalesce((
      select jsonb_agg(public.sankofa__meeting_json(x.id) order by x.starts_at desc)
      from (
        select m.id, m.starts_at from public.sankofa_meetings m
        where coalesce(m.ends_at, m.starts_at + interval '1 hour') <= now() and public.sankofa_can_see_meeting(m.id)
        order by m.starts_at desc limit lim
      ) x
    ), '[]'::jsonb);
  end if;
  return coalesce((
    select jsonb_agg(public.sankofa__meeting_json(x.id) order by x.starts_at)
    from (
      select m.id, m.starts_at from public.sankofa_meetings m
      where coalesce(m.ends_at, m.starts_at + interval '1 hour') > now() and public.sankofa_can_see_meeting(m.id)
      order by m.starts_at limit lim
    ) x
  ), '[]'::jsonb);
end;
$$;

-- Create or edit a meeting. A Circle's mentors can run their Circle's
-- meetings; a mentor and mentee can set up a one-to-one; only the
-- committee can create programme-wide events.
create or replace function public.sankofa_save_meeting(
  p_id uuid, p_circle uuid, p_pairing uuid, p_title text, p_kind text,
  p_starts timestamptz, p_ends timestamptz, p_location text, p_link text, p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  mid uuid := p_id;
  existing public.sankofa_meetings;
  v_kind text := coalesce(nullif(p_kind, ''), 'circle');
  link text := nullif(trim(coalesce(p_link, '')), '');
  eff_circle uuid := p_circle;
  eff_pairing uuid := p_pairing;
begin
  if me is null then
    raise exception 'Please sign in.';
  end if;

  if mid is not null then
    select * into existing from public.sankofa_meetings where id = mid;
    if not found then
      raise exception 'Meeting not found.';
    end if;
    eff_circle := existing.circle_id;
    eff_pairing := existing.pairing_id;
  end if;

  if eff_pairing is not null then
    if not (public.sankofa_is_admin() or exists (
      select 1 from public.sankofa_pairings pr where pr.id = eff_pairing and pr.status = 'active' and me in (pr.mentee_id, pr.mentor_id)
    )) then
      raise exception 'You can''t schedule this one-to-one.';
    end if;
    v_kind := 'one_to_one';
    eff_circle := null;
  elsif eff_circle is not null then
    if not public.sankofa_is_circle_mentor(eff_circle) then
      raise exception 'Only the Circle''s mentors or the committee can schedule Circle meetings.';
    end if;
    if v_kind in ('one_to_one', 'all') then
      v_kind := 'circle';
    end if;
  else
    if not public.sankofa_is_admin() then
      raise exception 'Only the committee can schedule programme-wide events.';
    end if;
    if v_kind not in ('social', 'workshop', 'all') then
      v_kind := 'all';
    end if;
  end if;

  if char_length(trim(coalesce(p_title, ''))) < 2 then
    raise exception 'Give the meeting a title.';
  end if;
  if p_starts is null then
    raise exception 'Choose a start time.';
  end if;
  if p_ends is not null and p_ends <= p_starts then
    raise exception 'The end time has to be after the start.';
  end if;
  if mid is null and p_starts < now() - interval '1 hour' then
    raise exception 'That start time is in the past.';
  end if;
  if link is not null and link !~* '^https?://' then
    link := 'https://' || link;
  end if;
  if link is not null and link !~* '^https?://[^\s]+$' then
    raise exception 'That meeting link doesn''t look right.';
  end if;

  if mid is null then
    insert into public.sankofa_meetings (circle_id, pairing_id, title, kind, starts_at, ends_at, location, online_link, description, created_by)
    values (eff_circle, eff_pairing, trim(p_title), v_kind, p_starts, p_ends,
            nullif(trim(coalesce(p_location, '')), ''), link, nullif(trim(coalesce(p_description, '')), ''), me)
    returning id into mid;
    perform public.sankofa_award(me, 'host', mid::text, 10, 5, 168);
  else
    update public.sankofa_meetings set
      title = trim(p_title), kind = v_kind, starts_at = p_starts, ends_at = p_ends,
      location = nullif(trim(coalesce(p_location, '')), ''), online_link = link,
      description = nullif(trim(coalesce(p_description, '')), '')
    where id = mid;
  end if;
  return public.sankofa__meeting_json(mid);
end;
$$;

create or replace function public.sankofa_cancel_meeting(p_meeting uuid, p_cancelled boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  j jsonb;
begin
  j := public.sankofa__meeting_json(p_meeting);
  if j is null or not public.sankofa_can_see_meeting(p_meeting) or not coalesce((j ->> 'can_edit')::boolean, false) then
    raise exception 'You can''t change this meeting.';
  end if;
  update public.sankofa_meetings set cancelled = coalesce(p_cancelled, true) where id = p_meeting;
  return public.sankofa__meeting_json(p_meeting);
end;
$$;

create or replace function public.sankofa_delete_meeting(p_meeting uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  j jsonb;
begin
  j := public.sankofa__meeting_json(p_meeting);
  if j is null or not public.sankofa_can_see_meeting(p_meeting) or not coalesce((j ->> 'can_edit')::boolean, false) then
    raise exception 'You can''t delete this meeting.';
  end if;
  delete from public.sankofa_meetings where id = p_meeting;
end;
$$;

create or replace function public.sankofa_rsvp(p_meeting uuid, p_response text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  m public.sankofa_meetings;
begin
  if not public.sankofa_is_active(me) then
    raise exception 'The Sankofa Hub isn''t available on your account.';
  end if;
  if p_response not in ('going', 'maybe', 'no') then
    raise exception 'Choose going, maybe or can''t make it.';
  end if;
  if not public.sankofa_can_see_meeting(p_meeting) then
    raise exception 'Meeting not found.';
  end if;
  select * into m from public.sankofa_meetings where id = p_meeting;
  if m.cancelled then
    raise exception 'This meeting has been cancelled.';
  end if;
  if coalesce(m.ends_at, m.starts_at + interval '1 hour') < now() then
    raise exception 'This meeting has already finished.';
  end if;
  insert into public.sankofa_meeting_rsvps (meeting_id, user_id, response)
  values (p_meeting, me, p_response)
  on conflict (meeting_id, user_id) do update set response = excluded.response, updated_at = now();
  perform public.sankofa_award(me, 'rsvp', p_meeting::text, 3);
  return public.sankofa__meeting_json(p_meeting);
end;
$$;

-- "I'm here": opens 30 minutes before the start and stays open for 2 hours
-- after the end.
create or replace function public.sankofa_check_in(p_meeting uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  m public.sankofa_meetings;
begin
  if not public.sankofa_is_active(me) then
    raise exception 'The Sankofa Hub isn''t available on your account.';
  end if;
  if not public.sankofa_can_see_meeting(p_meeting) then
    raise exception 'Meeting not found.';
  end if;
  select * into m from public.sankofa_meetings where id = p_meeting;
  if m.cancelled then
    raise exception 'This meeting has been cancelled.';
  end if;
  if now() < m.starts_at - interval '30 minutes' then
    raise exception 'Check-in opens 30 minutes before the meeting starts.';
  end if;
  if now() > coalesce(m.ends_at, m.starts_at + interval '1 hour') + interval '2 hours' then
    raise exception 'Check-in for this meeting has closed.';
  end if;
  insert into public.sankofa_meeting_rsvps (meeting_id, user_id, response, attended, checked_in_at)
  values (p_meeting, me, 'going', true, now())
  on conflict (meeting_id, user_id) do update
    set response = 'going', attended = true, checked_in_at = coalesce(public.sankofa_meeting_rsvps.checked_in_at, now()), updated_at = now();
  perform public.sankofa_award(me, 'attend', p_meeting::text, 20);
  return public.sankofa__meeting_json(p_meeting);
end;
$$;

-- Who is coming. Everyone sees who said yes/maybe; the people who can run
-- the meeting also see who hasn't replied and who actually turned up.
create or replace function public.sankofa_meeting_attendees(p_meeting uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  m public.sankofa_meetings;
  editor boolean;
begin
  if not public.sankofa_can_see_meeting(p_meeting) then
    raise exception 'Meeting not found.';
  end if;
  select * into m from public.sankofa_meetings where id = p_meeting;
  editor := coalesce((public.sankofa__meeting_json(p_meeting) ->> 'can_edit')::boolean, false);
  return jsonb_build_object(
    'editor', editor,
    'replies', coalesce((
      select jsonb_agg(
        jsonb_build_object('person', public.sankofa_person(me, r.user_id), 'response', r.response,
                           'attended', case when editor then r.attended else null end)
        order by r.response, r.updated_at)
      from public.sankofa_meeting_rsvps r
      where r.meeting_id = p_meeting and (r.response <> 'no' or editor)
    ), '[]'::jsonb),
    'pending', case when not editor then '[]'::jsonb else coalesce((
      select jsonb_agg(public.sankofa_person(me, e.uid))
      from (
        select cm.user_id as uid from public.sankofa_circle_members cm where m.circle_id is not null and m.pairing_id is null and cm.circle_id = m.circle_id
        union
        select u.uid from public.sankofa_pairings pr cross join lateral (values (pr.mentee_id), (pr.mentor_id)) u(uid) where pr.id = m.pairing_id
        union
        select p.user_id from public.sankofa_participants p where m.circle_id is null and m.pairing_id is null and p.status = 'active'
      ) e
      where not exists (select 1 from public.sankofa_meeting_rsvps r where r.meeting_id = p_meeting and r.user_id = e.uid)
    ), '[]'::jsonb) end
  );
end;
$$;

create or replace function public.sankofa_mark_attendance(p_meeting uuid, p_user uuid, p_attended boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  j jsonb;
begin
  j := public.sankofa__meeting_json(p_meeting);
  if j is null or not public.sankofa_can_see_meeting(p_meeting) or not coalesce((j ->> 'can_edit')::boolean, false) then
    raise exception 'You can''t record attendance for this meeting.';
  end if;
  if p_attended then
    insert into public.sankofa_meeting_rsvps (meeting_id, user_id, response, attended, checked_in_at)
    values (p_meeting, p_user, 'going', true, now())
    on conflict (meeting_id, user_id) do update set attended = true, checked_in_at = coalesce(public.sankofa_meeting_rsvps.checked_in_at, now()), updated_at = now();
    perform public.sankofa_award(p_user, 'attend', p_meeting::text, 20);
  else
    update public.sankofa_meeting_rsvps set attended = false, updated_at = now() where meeting_id = p_meeting and user_id = p_user;
    delete from public.sankofa_xp where user_id = p_user and kind = 'attend' and ref = p_meeting::text;
  end if;
end;
$$;

create or replace function public.sankofa_meeting_feedback_submit(p_meeting uuid, p_rating integer, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  m public.sankofa_meetings;
begin
  if not public.sankofa_is_active(me) or not public.sankofa_can_see_meeting(p_meeting) then
    raise exception 'Meeting not found.';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Choose a rating from 1 to 5.';
  end if;
  select * into m from public.sankofa_meetings where id = p_meeting;
  if coalesce(m.ends_at, m.starts_at + interval '1 hour') > now() then
    raise exception 'You can leave feedback once the meeting has finished.';
  end if;
  insert into public.sankofa_meeting_feedback (meeting_id, user_id, rating, comment)
  values (p_meeting, me, p_rating, nullif(left(trim(coalesce(p_comment, '')), 600), ''))
  on conflict (meeting_id, user_id) do update set rating = excluded.rating, comment = excluded.comment;
  perform public.sankofa_award(me, 'feedback', p_meeting::text, 5);
  return public.sankofa__meeting_json(p_meeting);
end;
$$;

-- ---------------------------------------------------------------------
-- The Circle board.
create or replace function public.sankofa__post_json(p_post uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'circle_id', p.circle_id,
    'kind', p.kind,
    'body', p.body,
    'pinned', p.pinned,
    'created_at', p.created_at,
    'author', public.sankofa_person(auth.uid(), p.author_id),
    'target', case when p.target_id is null then null else public.sankofa_person(auth.uid(), p.target_id) end,
    'mine', p.author_id = auth.uid(),
    'reactions', coalesce((
      select jsonb_object_agg(r.emoji, r.n) from (
        select emoji, count(*) as n from public.sankofa_post_reactions where post_id = p.id group by emoji
      ) r
    ), '{}'::jsonb),
    'my_reactions', coalesce((
      select jsonb_agg(r.emoji) from public.sankofa_post_reactions r where r.post_id = p.id and r.user_id = auth.uid()
    ), '[]'::jsonb),
    'can_delete', (p.author_id = auth.uid() or public.sankofa_is_admin() or public.sankofa_is_circle_mentor(p.circle_id)),
    'can_pin', (public.sankofa_is_admin() or public.sankofa_is_circle_mentor(p.circle_id))
  )
  from public.sankofa_posts p
  where p.id = p_post;
$$;
revoke all on function public.sankofa__post_json(uuid) from public, anon, authenticated;

-- Posts for a Circle (default: mine) plus programme-wide announcements.
create or replace function public.sankofa_feed(p_circle uuid default null, p_limit integer default 30, p_before timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cid uuid := coalesce(p_circle, public.sankofa_circle_of(auth.uid()));
  lim integer := least(greatest(coalesce(p_limit, 30), 1), 60);
begin
  if me is null or not (public.sankofa_is_active(me) or public.sankofa_is_admin()) then
    raise exception 'The Sankofa Hub isn''t available on your account.';
  end if;
  if cid is not null and not public.sankofa_can_see_circle(cid) then
    raise exception 'That Circle isn''t yours.';
  end if;
  return coalesce((
    select jsonb_agg(public.sankofa__post_json(x.id) order by x.pinned desc, x.created_at desc)
    from (
      select p.id, p.pinned, p.created_at from public.sankofa_posts p
      where (p.circle_id is null or p.circle_id = cid)
        and (p_before is null or p.created_at < p_before)
      order by p.created_at desc limit lim
    ) x
  ), '[]'::jsonb);
end;
$$;

-- Posting. kind: post | announcement (mentors / committee) | shoutout (kudos).
create or replace function public.sankofa_post(p_circle uuid, p_kind text, p_body text, p_target uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  v_kind text := coalesce(nullif(p_kind, ''), 'post');
  clean text := regexp_replace(coalesce(p_body, ''), '^\s+|\s+$', '', 'g');
  cid uuid := p_circle;
  pid uuid;
begin
  if me is null or not (public.sankofa_is_active(me) or public.sankofa_is_admin()) then
    raise exception 'The Sankofa Hub isn''t available on your account.';
  end if;
  if v_kind not in ('post', 'announcement', 'shoutout') then
    raise exception 'Invalid post type.';
  end if;
  if char_length(clean) = 0 then
    raise exception 'Write something first.';
  end if;
  if char_length(clean) > 1000 then
    raise exception 'Posts can be up to 1,000 characters.';
  end if;

  if cid is null then
    if not public.sankofa_is_admin() then
      raise exception 'Only the committee can post to everyone.';
    end if;
    v_kind := 'announcement';
  else
    if not public.sankofa_can_see_circle(cid) then
      raise exception 'That Circle isn''t yours.';
    end if;
    if v_kind = 'announcement' and not public.sankofa_is_circle_mentor(cid) then
      raise exception 'Only mentors and the committee can post announcements.';
    end if;
  end if;

  if (select count(*) from public.sankofa_posts x where x.author_id = me and x.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'You''re posting very quickly - wait a little and try again.';
  end if;

  if v_kind = 'shoutout' then
    if p_target is null or p_target = me then
      raise exception 'Choose someone in your Circle to cheer on.';
    end if;
    if not exists (select 1 from public.sankofa_circle_members cm where cm.circle_id = cid and cm.user_id = p_target) then
      raise exception 'They''re not in this Circle.';
    end if;
    if (select count(*) from public.sankofa_posts x where x.author_id = me and x.kind = 'shoutout' and x.created_at > now() - interval '24 hours') >= 3 then
      raise exception 'You can send three kudos a day - save some for tomorrow.';
    end if;
  else
    p_target := null;
  end if;

  insert into public.sankofa_posts (circle_id, author_id, kind, body, target_id)
  values (cid, me, v_kind, clean, p_target)
  returning id into pid;

  if v_kind = 'shoutout' then
    perform public.sankofa_award(p_target, 'kudos', pid::text, 5);
  elsif v_kind = 'post' then
    perform public.sankofa_award(me, 'post', pid::text, 3, 3, 24);
  end if;
  return public.sankofa__post_json(pid);
end;
$$;

create or replace function public.sankofa_delete_post(p_post uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.sankofa_posts;
begin
  select * into p from public.sankofa_posts where id = p_post;
  if not found then
    return;
  end if;
  if not (p.author_id = auth.uid() or public.sankofa_is_admin() or public.sankofa_is_circle_mentor(p.circle_id)) then
    raise exception 'You can''t delete this post.';
  end if;
  delete from public.sankofa_xp where kind = 'kudos' and ref = p_post::text;
  delete from public.sankofa_posts where id = p_post;
end;
$$;

create or replace function public.sankofa_pin_post(p_post uuid, p_pinned boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.sankofa_posts;
begin
  select * into p from public.sankofa_posts where id = p_post;
  if not found then
    raise exception 'Post not found.';
  end if;
  if not (public.sankofa_is_admin() or public.sankofa_is_circle_mentor(p.circle_id)) then
    raise exception 'Only mentors and the committee can pin posts.';
  end if;
  update public.sankofa_posts set pinned = coalesce(p_pinned, false) where id = p_post;
  return public.sankofa__post_json(p_post);
end;
$$;

-- Toggle a reaction on a post I can see.
create or replace function public.sankofa_react(p_post uuid, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  p public.sankofa_posts;
begin
  select * into p from public.sankofa_posts where id = p_post;
  if not found
     or not (public.sankofa_is_active(me) or public.sankofa_is_admin())
     or not (p.circle_id is null or public.sankofa_can_see_circle(p.circle_id)) then
    raise exception 'Post not found.';
  end if;
  if p_emoji not in ('clap', 'heart', 'fire', 'bulb') then
    raise exception 'Invalid reaction.';
  end if;
  if exists (select 1 from public.sankofa_post_reactions where post_id = p_post and user_id = me and emoji = p_emoji) then
    delete from public.sankofa_post_reactions where post_id = p_post and user_id = me and emoji = p_emoji;
  else
    insert into public.sankofa_post_reactions (post_id, user_id, emoji) values (p_post, me, p_emoji);
  end if;
  return public.sankofa__post_json(p_post);
end;
$$;

-- ---------------------------------------------------------------------
-- Goals.
create or replace function public.sankofa_goals_list()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id, 'title', g.title, 'detail', g.detail, 'due_date', g.due_date,
    'shared', g.shared, 'done', g.done, 'done_at', g.done_at, 'created_at', g.created_at
  ) order by g.done, g.due_date nulls last, g.created_at desc), '[]'::jsonb)
  from public.sankofa_goals g
  where g.user_id = auth.uid() and public.sankofa_is_active(auth.uid());
$$;

create or replace function public.sankofa_goal_save(p_id uuid, p_title text, p_detail text, p_due date, p_shared boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  gid uuid := p_id;
begin
  if not public.sankofa_is_active(me) then
    raise exception 'The Sankofa Hub isn''t available on your account.';
  end if;
  if char_length(trim(coalesce(p_title, ''))) < 2 then
    raise exception 'Give your goal a title.';
  end if;
  if gid is null then
    if (select count(*) from public.sankofa_goals where user_id = me and not done) >= 25 then
      raise exception 'That''s plenty of open goals - finish a few first.';
    end if;
    insert into public.sankofa_goals (user_id, title, detail, due_date, shared)
    values (me, trim(p_title), nullif(left(trim(coalesce(p_detail, '')), 500), ''), p_due, coalesce(p_shared, true))
    returning id into gid;
  else
    update public.sankofa_goals set
      title = trim(p_title), detail = nullif(left(trim(coalesce(p_detail, '')), 500), ''),
      due_date = p_due, shared = coalesce(p_shared, shared)
    where id = gid and user_id = me;
    if not found then
      raise exception 'Goal not found.';
    end if;
  end if;
  return public.sankofa_goals_list();
end;
$$;

create or replace function public.sankofa_goal_set_done(p_id uuid, p_done boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  update public.sankofa_goals set done = coalesce(p_done, false), done_at = case when coalesce(p_done, false) then now() else null end
  where id = p_id and user_id = me and public.sankofa_is_active(me);
  if not found then
    raise exception 'Goal not found.';
  end if;
  if coalesce(p_done, false) then
    perform public.sankofa_award(me, 'goal_done', p_id::text, 15, 3, 168);
  end if;
  return public.sankofa_goals_list();
end;
$$;

create or replace function public.sankofa_goal_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.sankofa_goals where id = p_id and user_id = auth.uid();
  return public.sankofa_goals_list();
end;
$$;

-- ---------------------------------------------------------------------
-- Weekly check-in: how was the week, a win, a challenge, need a hand?
create or replace function public.sankofa_checkin_submit(p_mood integer, p_win text, p_challenge text, p_need_help boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  wk date := public.sankofa_week_start();
begin
  if not public.sankofa_is_active(me) then
    raise exception 'The Sankofa Hub isn''t available on your account.';
  end if;
  if p_mood is null or p_mood < 1 or p_mood > 5 then
    raise exception 'Pick how your week felt.';
  end if;
  insert into public.sankofa_checkins (user_id, week_start, mood, win, challenge, need_help)
  values (me, wk, p_mood, nullif(left(trim(coalesce(p_win, '')), 400), ''), nullif(left(trim(coalesce(p_challenge, '')), 400), ''), coalesce(p_need_help, false))
  on conflict (user_id, week_start) do update
    set mood = excluded.mood, win = excluded.win, challenge = excluded.challenge,
        need_help = excluded.need_help, updated_at = now();
  perform public.sankofa_award(me, 'checkin', wk::text, 15);
  return jsonb_build_object('week_start', wk, 'mood', p_mood, 'win', p_win, 'challenge', p_challenge, 'need_help', coalesce(p_need_help, false));
end;
$$;

create or replace function public.sankofa_checkin_history(p_limit integer default 12)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'week_start', c.week_start, 'mood', c.mood, 'win', c.win, 'challenge', c.challenge, 'need_help', c.need_help
  ) order by c.week_start desc), '[]'::jsonb)
  from (
    select * from public.sankofa_checkins where user_id = auth.uid() order by week_start desc
    limit least(greatest(coalesce(p_limit, 12), 1), 52)
  ) c;
$$;

-- What a mentor (or the committee) can see of someone they support:
-- their shared goals and weekly check-ins.
create or replace function public.sankofa_member_snapshot(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  allowed boolean;
begin
  allowed := public.sankofa_is_admin()
    or exists (
      select 1 from public.sankofa_pairings pr
      where pr.status = 'active' and pr.mentor_id = me and pr.mentee_id = p_user
    )
    or exists (
      select 1 from public.sankofa_circle_members mine
      join public.sankofa_circle_members theirs on theirs.circle_id = mine.circle_id
      join public.sankofa_participants sp on sp.user_id = mine.user_id
      where mine.user_id = me and theirs.user_id = p_user and sp.role = 'mentor' and sp.status = 'active'
    );
  if not allowed then
    raise exception 'You can''t view this person''s progress.';
  end if;
  return jsonb_build_object(
    'person', public.sankofa_person(me, p_user),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object('title', g.title, 'detail', g.detail, 'due_date', g.due_date, 'done', g.done, 'done_at', g.done_at)
                       order by g.done, g.due_date nulls last, g.created_at desc)
      from public.sankofa_goals g where g.user_id = p_user and g.shared
    ), '[]'::jsonb),
    'checkins', coalesce((
      select jsonb_agg(jsonb_build_object('week_start', c.week_start, 'mood', c.mood, 'win', c.win, 'challenge', c.challenge, 'need_help', c.need_help)
                       order by c.week_start desc)
      from (select * from public.sankofa_checkins where user_id = p_user order by week_start desc limit 8) c
    ), '[]'::jsonb),
    'attended', (select count(*) from public.sankofa_meeting_rsvps r where r.user_id = p_user and r.attended),
    'xp', coalesce((select sum(points) from public.sankofa_xp where user_id = p_user), 0),
    'last_active', (select max(created_at) from public.sankofa_xp where user_id = p_user)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- My Hub profile.
create or replace function public.sankofa_save_profile(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  sp public.sankofa_participants;
begin
  select * into sp from public.sankofa_participants where user_id = me;
  if not found or sp.status <> 'active' then
    raise exception 'The Sankofa Hub isn''t available on your account.';
  end if;
  update public.sankofa_participants s set
    headline     = case when p_patch ? 'headline'     then nullif(left(trim(p_patch ->> 'headline'), 80), '')   else s.headline end,
    intro        = case when p_patch ? 'intro'        then nullif(left(trim(p_patch ->> 'intro'), 500), '')     else s.intro end,
    specialty    = case when p_patch ? 'specialty'    then nullif(left(trim(p_patch ->> 'specialty'), 80), '')  else s.specialty end,
    comm_style   = case when p_patch ? 'comm_style'   then nullif(left(trim(p_patch ->> 'comm_style'), 60), '') else s.comm_style end,
    meeting_freq = case when p_patch ? 'meeting_freq' then nullif(left(trim(p_patch ->> 'meeting_freq'), 60), '') else s.meeting_freq end,
    capacity     = case when p_patch ? 'capacity' and s.role = 'mentor'
                        then (case when nullif(p_patch ->> 'capacity', '') is null then null else least(20, greatest(0, (p_patch ->> 'capacity')::integer)) end)::smallint
                        else s.capacity end,
    interests    = case when p_patch ? 'interests'    then coalesce(array(select left(trim(v), 40) from jsonb_array_elements_text(p_patch -> 'interests') v where trim(v) <> '' limit 12), '{}'::text[]) else s.interests end,
    offers       = case when p_patch ? 'offers'       then coalesce(array(select left(trim(v), 60) from jsonb_array_elements_text(p_patch -> 'offers') v where trim(v) <> '' limit 12), '{}'::text[]) else s.offers end,
    show_on_leaderboard = case when p_patch ? 'show_on_leaderboard' then (p_patch ->> 'show_on_leaderboard')::boolean else s.show_on_leaderboard end
  where s.user_id = me
  returning * into sp;

  if not sp.profile_done and char_length(coalesce(sp.headline, '')) >= 3 and char_length(coalesce(sp.intro, '')) >= 20 then
    update public.sankofa_participants set profile_done = true where user_id = me;
    perform public.sankofa_award(me, 'profile', '', 20);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.sankofa_mark_welcomed()
returns void
language sql
security definer
set search_path = public
as $$
  update public.sankofa_participants set welcomed_at = coalesce(welcomed_at, now()) where user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- Everyone in the Hub, for browsing mentors and finding peers to message.
create or replace function public.sankofa_people()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null or not (public.sankofa_is_active(me) or public.sankofa_is_admin()) then
    raise exception 'The Sankofa Hub isn''t available on your account.';
  end if;
  return coalesce((
    select jsonb_agg(
      public.sankofa_person(me, sp.user_id) || jsonb_build_object(
        'headline', case when (public.sankofa_person(me, sp.user_id) ->> 'blurred')::boolean then null else sp.headline end,
        'specialty', case when (public.sankofa_person(me, sp.user_id) ->> 'blurred')::boolean then null else sp.specialty end,
        'interests', case when (public.sankofa_person(me, sp.user_id) ->> 'blurred')::boolean then '[]'::jsonb else to_jsonb(sp.interests) end,
        'offers', case when (public.sankofa_person(me, sp.user_id) ->> 'blurred')::boolean then '[]'::jsonb else to_jsonb(sp.offers) end,
        'circle_name', c.name,
        'same_circle', cm.circle_id is not null and cm.circle_id = public.sankofa_circle_of(me),
        'can_message', sp.user_id <> me
                       and public.sankofa_is_active(sp.user_id)
                       and public.chat_user_eligible(me) and public.chat_user_eligible(sp.user_id)
                       and not public.chat_blocked_between(me, sp.user_id)
      )
      order by (sp.role = 'mentor') desc, sp.created_at
    )
    from public.sankofa_participants sp
    left join public.sankofa_circle_members cm on cm.user_id = sp.user_id
    left join public.sankofa_circles c on c.id = cm.circle_id
    where sp.status = 'active'
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- The Hub home in one call.
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
    ),
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

-- A very small version for the Members Hub tile and reminders.
create or replace function public.sankofa_hub_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  sp public.sankofa_participants;
  nm public.sankofa_meetings;
  wk date := public.sankofa_week_start();
begin
  if me is null then
    return jsonb_build_object('participant', false);
  end if;
  select * into sp from public.sankofa_participants where user_id = me;
  if not found or sp.status <> 'active' then
    return jsonb_build_object('participant', false, 'is_admin', public.sankofa_is_admin());
  end if;
  select m.* into nm from public.sankofa_meetings m
  where not m.cancelled and coalesce(m.ends_at, m.starts_at + interval '1 hour') > now() and public.sankofa_can_see_meeting(m.id)
  order by m.starts_at limit 1;
  return jsonb_build_object(
    'participant', true,
    'is_admin', public.sankofa_is_admin(),
    'role', sp.role,
    'circle', (select c.name from public.sankofa_circle_members cm join public.sankofa_circles c on c.id = cm.circle_id where cm.user_id = me),
    'next_meeting', case when nm.id is null then null else jsonb_build_object('id', nm.id, 'title', nm.title, 'starts_at', nm.starts_at) end,
    'checkin_due', not exists (select 1 from public.sankofa_checkins c where c.user_id = me and c.week_start = wk),
    'profile_done', sp.profile_done,
    'streak', public.sankofa_streak(me)
  );
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'sankofa_meetings(text, integer)',
    'sankofa_save_meeting(uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, text, text)',
    'sankofa_cancel_meeting(uuid, boolean)', 'sankofa_delete_meeting(uuid)', 'sankofa_rsvp(uuid, text)',
    'sankofa_check_in(uuid)', 'sankofa_meeting_attendees(uuid)', 'sankofa_mark_attendance(uuid, uuid, boolean)',
    'sankofa_meeting_feedback_submit(uuid, integer, text)',
    'sankofa_feed(uuid, integer, timestamptz)', 'sankofa_post(uuid, text, text, uuid)',
    'sankofa_delete_post(uuid)', 'sankofa_pin_post(uuid, boolean)', 'sankofa_react(uuid, text)',
    'sankofa_goals_list()', 'sankofa_goal_save(uuid, text, text, date, boolean)',
    'sankofa_goal_set_done(uuid, boolean)', 'sankofa_goal_delete(uuid)',
    'sankofa_checkin_submit(integer, text, text, boolean)', 'sankofa_checkin_history(integer)',
    'sankofa_member_snapshot(uuid)', 'sankofa_save_profile(jsonb)', 'sankofa_mark_welcomed()',
    'sankofa_people()', 'sankofa_hub_overview()', 'sankofa_hub_status()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

commit;
