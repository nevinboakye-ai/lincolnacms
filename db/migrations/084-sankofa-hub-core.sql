-- Sankofa Hub, part 1 of 4: the foundation.
--
-- The Hub is where accepted Sankofa students and professionals meet: they
-- are placed in a Circle, see who is in it and when it next meets, set
-- goals, check in, cheer each other on, earn XP and badges, and message
-- one another through the existing chat.
--
-- This file creates the tables, the security rules, the helper functions
-- and the chat integration. The next three files add the committee's
-- Circle-management tools (085), the participant-facing functions (086)
-- and XP / badges / leaderboards (087). Run them in order.
--
-- Security model: nobody writes to these tables directly. Every change goes
-- through a function that checks who is asking, so the rules can't be
-- bypassed from the browser. People can READ only what belongs to them or
-- their Circle (this also lets the live "something new" nudges work).
--
-- Sixth-form students: the rule from migrations 064/072 still applies. To
-- anyone but an executive they appear as "Sixth-form member" (no name) and
-- can't be messaged or message anyone but an executive.
--
-- WHO CAN USE THE HUB is a Hub Access rule, "sankofa_hub", created below
-- as president-only: nobody else can see or use any of it until the
-- president opens it up (Dashboard -> Hub Access -> Sankofa Hub), for
-- everyone it should reach or for named people. Being in the Hub is a
-- separate thing (the president / committee adds people to Circles), and
-- both are needed. Losing access locks someone out immediately, and their
-- progress is kept.
--
-- Wrapped in a transaction. Run this once in Supabase: Dashboard -> SQL
-- Editor -> New query, paste, Run. Safe to run again. Needs 003, 014, 028, 029,
-- 060, 061 and 070 (it tells you if any is missing). It no longer depends on
-- 064, 072 or 078.

begin;

-- ---------------------------------------------------------------------
-- Prerequisites. If something older hasn't been run yet, say which, rather
-- than failing halfway.
do $$
declare
  missing text[] := '{}';
begin
  if to_regclass('public.sankofa_applications') is null then missing := missing || 'sankofa applications (003)'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sankofa_applications' and column_name = 'applicant_type') then missing := missing || 'Sankofa mentor fields (028)'; end if;
  if to_regclass('public.sankofa_mentor_applications') is null then missing := missing || 'public mentor applications (029)'; end if;
  if to_regclass('public.network_professionals') is null then missing := missing || 'the Network (014)'; end if;
  if to_regclass('public.hub_access_rules') is null then missing := missing || 'Hub Access (060)'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hub_access_rules' and column_name = 'titles') then missing := missing || 'Hub Access dashboard rules (061)'; end if;
  if to_regclass('public.chat_conversations') is null or to_regclass('public.chat_blocks') is null or to_regclass('public.chat_suspensions') is null then missing := missing || 'messaging (070)'; end if;
  if cardinality(missing) > 0 then
    raise exception 'Run these migrations first, then run this one again: %', array_to_string(missing, ', ');
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Messaging helpers, exactly as in migrations 064 and 072 (so it doesn't
-- matter whether 072 was run first). Safe to repeat. If you run 072 AFTER
-- this file, run this file once more so the Hub's messaging rule is restored.
create or replace function public.is_sixth_form_profile(p_course text, p_year text)
returns boolean
language sql
immutable
as $$
  select (coalesce(p_course, '') || ' ' || coalesce(p_year, ''))
    ~* '(sixth|6th)[ -]?form|a[- ]?levels?|\myear ?1[23]\M|aspiring';
$$;

create or replace function public.chat_is_executive(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user = '22044cd2-6804-4142-96c4-5c475ce9347a'::uuid
      or exists (select 1 from public.members m where m.id = p_user and m.member_type = 'executive_committee');
$$;

create or replace function public.chat_is_sixth_form(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members m
    where m.id = p_user and public.is_sixth_form_profile(m.course, m.year_of_study)
  );
$$;
revoke all on function public.chat_is_executive(uuid) from public, anon, authenticated;
revoke all on function public.chat_is_sixth_form(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- The Hub Access rule: president only to start with.
-- The allowed feature names: everything already in the table, plus the
-- known ones, so the order these migrations are run in never matters.
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
      'dash_mmg', 'dash_sankofa', 'dash_motm', 'dash_events', 'dash_gallery'
    ])
  ) x;
  alter table public.hub_access_rules drop constraint if exists hub_access_rules_feature_check;
  execute 'alter table public.hub_access_rules add constraint hub_access_rules_feature_check check (feature in (' || names || '))';
end;
$$;

-- Who can SEE the Hub: the Executive Committee (the president always can).
-- Who can MANAGE it is separate - see sankofa_managers below.
insert into public.hub_access_rules (feature, allow_members, allow_professionals, member_types, courses, blocked_display)
values ('sankofa_hub', true, false, array['executive_committee'], null, 'hidden')
on conflict (feature) do nothing;

-- ---------------------------------------------------------------------
-- Participants: everyone taking part, as a mentee or a mentor.
create table if not exists public.sankofa_participants (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('mentee', 'mentor')),
  status text not null default 'active' check (status in ('active', 'paused', 'alumni')),
  application_id uuid references public.sankofa_applications (id) on delete set null,
  stage_label text,
  headline text,
  intro text,
  specialty text,
  interests text[] not null default '{}',
  offers text[] not null default '{}',
  capacity smallint check (capacity is null or capacity between 0 and 20),
  comm_style text,
  meeting_freq text,
  heritage text,
  aspirations text,
  looking_for text,
  social smallint,
  fitness smallint,
  study smallint,
  support smallint,
  show_on_leaderboard boolean not null default true,
  profile_done boolean not null default false,
  welcomed_at timestamptz,
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.sankofa_circles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 60),
  theme text not null default 'gold' check (theme in ('gold', 'green', 'red', 'purple', 'blue', 'teal')),
  motto text check (motto is null or char_length(motto) <= 140),
  description text check (description is null or char_length(description) <= 600),
  group_link text,
  capacity smallint not null default 8 check (capacity between 2 and 40),
  status text not null default 'active' check (status in ('active', 'archived')),
  academic_year text,
  sort_order int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- One Circle at a time per person (user_id is the key).
create table if not exists public.sankofa_circle_members (
  user_id uuid primary key references public.sankofa_participants (user_id) on delete cascade,
  circle_id uuid not null references public.sankofa_circles (id) on delete cascade,
  is_lead boolean not null default false,
  joined_at timestamptz not null default now(),
  moved_by uuid references auth.users (id) on delete set null
);
create index if not exists sankofa_circle_members_circle_idx on public.sankofa_circle_members (circle_id);

create table if not exists public.sankofa_circle_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  from_circle uuid references public.sankofa_circles (id) on delete set null,
  to_circle uuid references public.sankofa_circles (id) on delete set null,
  by_user uuid references auth.users (id) on delete set null,
  note text,
  at timestamptz not null default now()
);
create index if not exists sankofa_circle_history_user_idx on public.sankofa_circle_history (user_id, at desc);

-- A mentee's main mentor. One live pairing per mentee.
create table if not exists public.sankofa_pairings (
  id uuid primary key default gen_random_uuid(),
  mentee_id uuid not null references public.sankofa_participants (user_id) on delete cascade,
  mentor_id uuid not null references public.sankofa_participants (user_id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'ended')),
  note text,
  matched_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  check (mentee_id <> mentor_id)
);
create unique index if not exists sankofa_pairings_one_active on public.sankofa_pairings (mentee_id) where status = 'active';
create index if not exists sankofa_pairings_mentor_idx on public.sankofa_pairings (mentor_id) where status = 'active';

-- ---------------------------------------------------------------------
-- Meetings. circle_id null + no pairing = a whole-programme event.
create table if not exists public.sankofa_meetings (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid references public.sankofa_circles (id) on delete cascade,
  pairing_id uuid references public.sankofa_pairings (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 100),
  kind text not null default 'circle' check (kind in ('circle', 'one_to_one', 'checkin', 'social', 'workshop', 'all')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text check (location is null or char_length(location) <= 160),
  online_link text,
  description text check (description is null or char_length(description) <= 800),
  cancelled boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index if not exists sankofa_meetings_start_idx on public.sankofa_meetings (starts_at);
create index if not exists sankofa_meetings_circle_idx on public.sankofa_meetings (circle_id, starts_at);

create table if not exists public.sankofa_meeting_rsvps (
  meeting_id uuid not null references public.sankofa_meetings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  response text not null default 'going' check (response in ('going', 'maybe', 'no')),
  attended boolean,
  checked_in_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (meeting_id, user_id)
);

create table if not exists public.sankofa_meeting_feedback (
  meeting_id uuid not null references public.sankofa_meetings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 600),
  created_at timestamptz not null default now(),
  primary key (meeting_id, user_id)
);

-- ---------------------------------------------------------------------
-- The Circle board: posts, announcements and kudos.
create table if not exists public.sankofa_posts (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid references public.sankofa_circles (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'post' check (kind in ('post', 'announcement', 'shoutout')),
  body text not null check (char_length(body) between 1 and 1000),
  target_id uuid references auth.users (id) on delete set null,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists sankofa_posts_circle_idx on public.sankofa_posts (circle_id, created_at desc);

create table if not exists public.sankofa_post_reactions (
  post_id uuid not null references public.sankofa_posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  emoji text not null check (emoji in ('clap', 'heart', 'fire', 'bulb')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, emoji)
);

-- ---------------------------------------------------------------------
-- Goals and weekly check-ins (private to the person; a goal marked
-- "shared" and every check-in are also visible to their Circle's mentors
-- and the committee, so someone can be supported).
create table if not exists public.sankofa_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 140),
  detail text check (detail is null or char_length(detail) <= 500),
  due_date date,
  shared boolean not null default true,
  done boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sankofa_goals_user_idx on public.sankofa_goals (user_id, done, created_at desc);

create table if not exists public.sankofa_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  mood smallint not null check (mood between 1 and 5),
  win text check (win is null or char_length(win) <= 400),
  challenge text check (challenge is null or char_length(challenge) <= 400),
  need_help boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start)
);

-- ---------------------------------------------------------------------
-- XP and badges.
create table if not exists public.sankofa_xp (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  points integer not null check (points >= 0),
  ref text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, kind, ref)
);
create index if not exists sankofa_xp_user_idx on public.sankofa_xp (user_id, created_at desc);

create table if not exists public.sankofa_badge_defs (
  key text primary key,
  name text not null,
  description text not null,
  icon text not null,
  sort_order int not null default 0
);

create table if not exists public.sankofa_badges (
  user_id uuid not null references auth.users (id) on delete cascade,
  badge_key text not null references public.sankofa_badge_defs (key) on delete cascade,
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge_key)
);

-- ---------------------------------------------------------------------
-- Helper functions (all run as the owner, never trusting the browser).
-- An active participant who is also allowed into the Hub right now.
create or replace function public.sankofa_is_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.sankofa_participants p where p.user_id = p_user and p.status = 'active')
    and coalesce((select d.allowed from public.hub_access_decision(p_user, 'sankofa_hub') d), false);
$$;

-- Is the CALLER an active participant? (Row-level security runs as the
-- caller, so policies use this no-argument version rather than the
-- internal one that can be asked about anyone.)
create or replace function public.sankofa_am_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.sankofa_participants p where p.user_id = auth.uid() and p.status = 'active')
    and coalesce((select d.allowed from public.hub_access_decision(auth.uid(), 'sankofa_hub') d), false);
$$;

-- Who can MANAGE the Hub (place people in Circles, pair mentors, schedule
-- meetings, post announcements): the president, plus the people the president
-- picks in Dashboard > Sankofa Hub > Who can manage. This is deliberately not
-- the same as who can SEE the Hub (the "sankofa_hub" Hub Access rule). Added by
-- 090, which also sets who is on the list to begin with.
create table if not exists public.sankofa_managers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.sankofa_managers enable row level security;
drop policy if exists "President manages Sankofa managers" on public.sankofa_managers;
create policy "President manages Sankofa managers"
  on public.sankofa_managers for all to authenticated
  using (public.is_president()) with check (public.is_president());
revoke all on public.sankofa_managers from anon;

create or replace function public.sankofa_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_president()
      or exists (select 1 from public.sankofa_managers m where m.user_id = auth.uid());
$$;

create or replace function public.sankofa_circle_of(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cm.circle_id from public.sankofa_circle_members cm where cm.user_id = p_user;
$$;

create or replace function public.sankofa_role_of(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role from public.sankofa_participants p where p.user_id = p_user;
$$;

create or replace function public.sankofa_can_see_circle(p_circle uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_circle is not null and (
    public.sankofa_is_admin()
    or (public.sankofa_am_active()
        and exists (select 1 from public.sankofa_circle_members cm where cm.circle_id = p_circle and cm.user_id = auth.uid()))
  );
$$;

-- Is the caller a mentor in this Circle (or the committee)?
create or replace function public.sankofa_is_circle_mentor(p_circle uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_circle is not null and (
    public.sankofa_is_admin()
    or (public.sankofa_am_active() and exists (
      select 1 from public.sankofa_circle_members cm
      join public.sankofa_participants sp on sp.user_id = cm.user_id
      where cm.circle_id = p_circle and cm.user_id = auth.uid() and sp.role = 'mentor' and sp.status = 'active'
    ))
  );
$$;

create or replace function public.sankofa_can_see_meeting(p_meeting uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sankofa_meetings m
    where m.id = p_meeting
      and (
        public.sankofa_is_admin()
        or (m.pairing_id is not null and public.sankofa_am_active() and exists (
              select 1 from public.sankofa_pairings pr
              where pr.id = m.pairing_id and auth.uid() in (pr.mentee_id, pr.mentor_id)))
        or (m.pairing_id is null and m.circle_id is not null and public.sankofa_can_see_circle(m.circle_id))
        or (m.pairing_id is null and m.circle_id is null and public.sankofa_is_active(auth.uid()))
      )
  );
$$;

-- One person as the viewer is allowed to see them. Sixth-form students are
-- shown without a name to anyone who isn't an executive.
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
                 else coalesce(x.mname, x.pname, case when p_user = '22044cd2-6804-4142-96c4-5c475ce9347a'::uuid then 'President' else 'LACMS member' end) end,
    'role', x.prole,
    'stage', x.stage,
    'detail', case when x.blurred then null else x.detail end,
    'photo', case when x.blurred then null else x.photo end,
    'blurred', x.blurred,
    'sixth_form', x.sixth,
    'is_pro', (x.pname is not null and x.mname is null)
  )
  from (
    select
      m.full_name as mname,
      np.full_name as pname,
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
          when s.sixth then 'Aspiring medic'
          else nullif(concat_ws(' · ', m.course, m.year_of_study), '')
        end
      ) as stage,
      case
        when m.id is null and np.id is not null then nullif(concat_ws(' · ', np.title, np.organisation), '')
        else nullif(concat_ws(' · ', m.course, m.year_of_study), '')
      end as detail
    from (select 1) one
    left join public.members m on m.id = p_user
    left join lateral (
      select * from public.network_professionals q where q.user_id = p_user order by q.created_at limit 1
    ) np on true
    left join public.sankofa_participants sp on sp.user_id = p_user
    cross join lateral (select coalesce(public.chat_is_sixth_form(p_user), false) as sixth) s
  ) x;
$$;

-- Serial XP awards. Returns true only if XP was actually granted (not a
-- repeat, not over the cap). Caps stop anything being farmed.
create or replace function public.sankofa_award(
  p_user uuid, p_kind text, p_ref text, p_points integer,
  p_cap integer default null, p_cap_hours integer default 24
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if p_user is null or p_points <= 0 or not public.sankofa_is_active(p_user) then
    return false;
  end if;
  if p_cap is not null and (
    select count(*) from public.sankofa_xp x
    where x.user_id = p_user and x.kind = p_kind and x.created_at > now() - make_interval(hours => p_cap_hours)
  ) >= p_cap then
    return false;
  end if;
  insert into public.sankofa_xp (user_id, kind, points, ref)
  values (p_user, p_kind, p_points, coalesce(p_ref, ''))
  on conflict (user_id, kind, ref) do nothing;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- Internal helpers are not callable from the browser. The policy helpers
-- below have to be, because row-level security runs as the caller.
revoke all on function public.sankofa_is_active(uuid) from public, anon, authenticated;
revoke all on function public.sankofa_circle_of(uuid) from public, anon, authenticated;
revoke all on function public.sankofa_role_of(uuid) from public, anon, authenticated;
revoke all on function public.sankofa_person(uuid, uuid) from public, anon, authenticated;
revoke all on function public.sankofa_award(uuid, text, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.sankofa_am_active() from public, anon;
revoke all on function public.sankofa_is_admin() from public, anon;
revoke all on function public.sankofa_can_see_circle(uuid) from public, anon;
revoke all on function public.sankofa_is_circle_mentor(uuid) from public, anon;
revoke all on function public.sankofa_can_see_meeting(uuid) from public, anon;
grant execute on function public.sankofa_am_active() to authenticated;
grant execute on function public.sankofa_is_admin() to authenticated;
grant execute on function public.sankofa_can_see_circle(uuid) to authenticated;
grant execute on function public.sankofa_is_circle_mentor(uuid) to authenticated;
grant execute on function public.sankofa_can_see_meeting(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Row-level security: read what is yours; nothing is writable directly.
alter table public.sankofa_participants enable row level security;
alter table public.sankofa_circles enable row level security;
alter table public.sankofa_circle_members enable row level security;
alter table public.sankofa_circle_history enable row level security;
alter table public.sankofa_pairings enable row level security;
alter table public.sankofa_meetings enable row level security;
alter table public.sankofa_meeting_rsvps enable row level security;
alter table public.sankofa_meeting_feedback enable row level security;
alter table public.sankofa_posts enable row level security;
alter table public.sankofa_post_reactions enable row level security;
alter table public.sankofa_goals enable row level security;
alter table public.sankofa_checkins enable row level security;
alter table public.sankofa_xp enable row level security;
alter table public.sankofa_badge_defs enable row level security;
alter table public.sankofa_badges enable row level security;

drop policy if exists "Read your own participant row" on public.sankofa_participants;
create policy "Read your own participant row" on public.sankofa_participants for select to authenticated
  using (user_id = auth.uid() or public.sankofa_is_admin());

drop policy if exists "Read your own Circle" on public.sankofa_circles;
create policy "Read your own Circle" on public.sankofa_circles for select to authenticated
  using (public.sankofa_can_see_circle(id));

drop policy if exists "Read your Circle's members" on public.sankofa_circle_members;
create policy "Read your Circle's members" on public.sankofa_circle_members for select to authenticated
  using (public.sankofa_can_see_circle(circle_id));

drop policy if exists "Committee reads Circle history" on public.sankofa_circle_history;
create policy "Committee reads Circle history" on public.sankofa_circle_history for select to authenticated
  using (public.sankofa_is_admin());

drop policy if exists "Read your own pairing" on public.sankofa_pairings;
create policy "Read your own pairing" on public.sankofa_pairings for select to authenticated
  using ((auth.uid() in (mentee_id, mentor_id) and public.sankofa_am_active()) or public.sankofa_is_admin());

drop policy if exists "Read meetings you can attend" on public.sankofa_meetings;
create policy "Read meetings you can attend" on public.sankofa_meetings for select to authenticated
  using (public.sankofa_can_see_meeting(id));

drop policy if exists "Read your own RSVPs" on public.sankofa_meeting_rsvps;
create policy "Read your own RSVPs" on public.sankofa_meeting_rsvps for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Read your own feedback" on public.sankofa_meeting_feedback;
create policy "Read your own feedback" on public.sankofa_meeting_feedback for select to authenticated
  using (user_id = auth.uid() or public.sankofa_is_admin());

drop policy if exists "Read posts in your Circle" on public.sankofa_posts;
create policy "Read posts in your Circle" on public.sankofa_posts for select to authenticated
  using (
    (circle_id is null and (public.sankofa_am_active() or public.sankofa_is_admin()))
    or public.sankofa_can_see_circle(circle_id)
  );

drop policy if exists "Read your own reactions" on public.sankofa_post_reactions;
create policy "Read your own reactions" on public.sankofa_post_reactions for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Read your own goals" on public.sankofa_goals;
create policy "Read your own goals" on public.sankofa_goals for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Read your own check-ins" on public.sankofa_checkins;
create policy "Read your own check-ins" on public.sankofa_checkins for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Read your own XP" on public.sankofa_xp;
create policy "Read your own XP" on public.sankofa_xp for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Everyone signed in can read badge definitions" on public.sankofa_badge_defs;
create policy "Everyone signed in can read badge definitions" on public.sankofa_badge_defs for select to authenticated
  using (true);

drop policy if exists "Read your own badges" on public.sankofa_badges;
create policy "Read your own badges" on public.sankofa_badges for select to authenticated
  using (user_id = auth.uid());

-- No direct writes, ever.
revoke insert, update, delete, truncate on
  public.sankofa_participants, public.sankofa_circles, public.sankofa_circle_members,
  public.sankofa_circle_history, public.sankofa_pairings, public.sankofa_meetings,
  public.sankofa_meeting_rsvps, public.sankofa_meeting_feedback, public.sankofa_posts,
  public.sankofa_post_reactions, public.sankofa_goals, public.sankofa_checkins,
  public.sankofa_xp, public.sankofa_badge_defs, public.sankofa_badges
  from anon, authenticated;
revoke all on
  public.sankofa_participants, public.sankofa_circles, public.sankofa_circle_members,
  public.sankofa_circle_history, public.sankofa_pairings, public.sankofa_meetings,
  public.sankofa_meeting_rsvps, public.sankofa_meeting_feedback, public.sankofa_posts,
  public.sankofa_post_reactions, public.sankofa_goals, public.sankofa_checkins,
  public.sankofa_xp, public.sankofa_badge_defs, public.sankofa_badges
  from anon;

-- ---------------------------------------------------------------------
-- Badges (the rules that award them are in 087).
insert into public.sankofa_badge_defs (key, name, description, icon, sort_order) values
  ('founding',      'Founding Seed',      'Part of the very first Sankofa Hub cohort.',                          '🌱', 1),
  ('first_steps',   'Griot''s Tale',      'Finished your Hub profile - your story is told, griot-style (Mali).',  '🎙️', 2),
  ('ice_breaker',   'First Lime',         'Sent your first message to someone in your Circle - a good lime starts with hello (Trinidad).', '💬', 3),
  ('connector',     'Harambee Hands',     'Said hello to three different people - many hands, harambee (Kenya).', '🤝', 4),
  ('showed_up',     'Pull Up',            'Attended your first meeting (Jamaica).',                              '📍', 5),
  ('regular',       'Sawubona',           'Attended five meetings - "I see you" (South Africa).',                '🏠', 6),
  ('reflective',    'Tales by Moonlight', 'Completed four weekly check-ins - stories shared by moonlight (Nigeria).', '🌙', 7),
  ('goal_getter',   'Piti Piti',          'Completed your first goal - little by little, the bird builds its nest (Haiti).', '🎯', 8),
  ('goal_crusher',  'Lalibela Builder',   'Completed five goals - carved stone by stone, like Lalibela (Ethiopia).', '⛪', 9),
  ('voice',         'Talking Drum',       'Posted five times on your Circle board (Nigeria).',                   '🥁', 10),
  ('cheerleader',   'Calypsonian',        'Sent five kudos to your Circle (Trinidad and Tobago).',               '🎉', 11),
  ('appreciated',   'Irie',               'Received three kudos from your Circle - all good vibes (Jamaica).',   '💛', 12),
  ('on_a_roll',     'Highlife',           'Kept a three-week streak going - good times, Ghana-style.',           '🎶', 13),
  ('unstoppable',   'Maroon Spirit',      'Kept an eight-week streak going - unbowed and unbroken (Jamaica and Suriname).', '✊', 14),
  ('host',          'Teranga Host',       'Hosted three meetings - teranga, Senegalese hospitality.',            '🏡', 15),
  ('feedback',      'Measuring Rod',      'Gave feedback on three meetings - Hwehwemudua, the Akan measuring rod of excellence (Ghana).', '📝', 16),
  ('canopy',        'Nyansapo',           'Reached level 5 - the wisdom knot (Ghana).',                          '🌳', 17),
  ('baobab',        'Sankofa Bird',       'Reached level 8 - you went back to fetch it, and now you pass it on (Ghana).', '🌍', 18)
on conflict (key) do update
  set name = excluded.name, description = excluded.description, icon = excluded.icon, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------
-- Messaging. Participants can use the chat even without Network access,
-- but only with other Sankofa participants and the committee (so this
-- never opens the wider Network to them). Sixth-form rules from 072 still
-- apply on top.
create or replace function public.chat_user_eligible(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null
    and (
      coalesce((select d.allowed from public.hub_access_decision(p_user, 'network') d), false)
      or public.sankofa_is_active(p_user)
    )
    and (
      p_user = '22044cd2-6804-4142-96c4-5c475ce9347a'::uuid
      or exists (select 1 from public.members m where m.id = p_user and m.membership_status = 'active')
      or exists (select 1 from public.network_professionals np where np.user_id = p_user and np.is_active = true)
    )
    and not exists (select 1 from public.chat_suspensions s where s.user_id = p_user);
$$;

create or replace function public.chat_pair_allowed(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- the sixth-form rule, as before
    not (
      (public.chat_is_sixth_form(p_a) and not public.chat_is_executive(p_b))
      or (public.chat_is_sixth_form(p_b) and not public.chat_is_executive(p_a))
    )
    and (
      -- both have Network access (the original rule) ...
      (coalesce((select d.allowed from public.hub_access_decision(p_a, 'network') d), false)
       and coalesce((select d.allowed from public.hub_access_decision(p_b, 'network') d), false))
      -- ... or each is a Sankofa participant or an executive
      or ((public.sankofa_is_active(p_a) or public.chat_is_executive(p_a))
          and (public.sankofa_is_active(p_b) or public.chat_is_executive(p_b)))
    );
$$;

revoke all on function public.chat_user_eligible(uuid) from public, anon, authenticated;
revoke all on function public.chat_pair_allowed(uuid, uuid) from public, anon, authenticated;

-- Starting and sending a message both refuse a blocked or disallowed pair
-- (as in migration 072, so the rule above is really enforced).
create or replace function public.chat_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b)
       or (b.blocker_id = p_b and b.blocked_id = p_a)
  ) or not public.chat_pair_allowed(p_a, p_b);
$$;
revoke all on function public.chat_blocked_between(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Live updates: the board and meetings nudge open pages (Realtime only
-- ever sends a person rows their read policy already lets them see).
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['sankofa_posts', 'sankofa_meetings', 'sankofa_circle_members', 'sankofa_pairings'] loop
      if to_regclass('public.' || t) is not null then
        begin
          execute format('alter publication supabase_realtime add table public.%I', t);
        exception when duplicate_object then null;
        end;
      end if;
    end loop;
  end if;
end;
$$;

commit;
