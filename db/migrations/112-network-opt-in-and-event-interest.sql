-- 112: Network is opt-in, and events can be provisional with "register interest"
--
-- 1. THE NETWORK IS NOW OPT-IN FOR MEMBERS. Until now every active member was listed to everyone with
--    Network access. Now a member appears only after choosing "Show me in the Network" (My data &
--    privacy on the members hub, or the Network page), and can take themselves off again at any time.
--    Nothing is shown by default. People added by the committee before they have an account can't have
--    chosen, so they are no longer listed. Healthcare professionals are listed separately, on the
--    consent they give when they request an account. Email addresses are never shown in the Network.
--
-- 2. EVENTS CAN BE PROVISIONAL. ULSU must approve an event (and any external speaker) before it is
--    publicised or opened for registration. A committee member can now mark an event "Provisional":
--    it shows a "Provisional" badge and members can "Register interest" instead of registering. When
--    ULSU has approved it, switch it to Confirmed and registration opens. Interest is kept separate
--    from registrations in the committee's lists.
--
-- Safe to run more than once. Needs 060, 072 and 003 (and 080 for site_events).

begin;

-- ---------------------------------------------------------------------
-- 1. Network opt-in
create table if not exists public.network_visibility (
  user_id uuid primary key references auth.users (id) on delete cascade,
  visible boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.network_visibility enable row level security;
revoke all on public.network_visibility from anon, authenticated;

create or replace function public.network_get_my_visibility()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('visible', coalesce((select v.visible from public.network_visibility v where v.user_id = auth.uid()), false));
$$;

create or replace function public.network_set_my_visibility(p_visible boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  insert into public.network_visibility (user_id, visible, updated_at) values (auth.uid(), coalesce(p_visible, false), now())
  on conflict (user_id) do update set visible = excluded.visible, updated_at = now();
end;
$$;

-- The directory (as in 072: restricted rows are redacted), now only listing members who opted in.
-- People added before they had an account are no longer listed (they can't have chosen).
drop function if exists public.get_network_members();
create function public.get_network_members()
returns table (
  id uuid, full_name text, course text, year_of_study text, member_type text, committee_role text,
  linkedin_url text, bio text, is_pending boolean, is_restricted boolean
)
language sql
security definer
volatile
set search_path = public
as $$
  select
    case when x.restricted then gen_random_uuid() else x.id end,
    case when x.restricted then 'Sixth form student' else x.full_name end,
    case when x.restricted then 'Sixth form' else x.course end,
    case when x.restricted then 'Executive Committee only' else x.year_of_study end,
    case when x.restricted then null else x.member_type end,
    case when x.restricted then null else x.committee_role end,
    case when x.restricted then null else x.linkedin_url end,
    case when x.restricted then null else x.bio end,
    false,
    x.restricted
  from (
    select m.id, m.full_name, m.course, m.year_of_study, m.member_type, m.committee_role,
           p.linkedin_url, p.bio,
           (public.is_sixth_form_profile(m.course, m.year_of_study) and not public.is_dashboard_admin()) as restricted
    from public.members m
    left join public.member_profiles p on p.id = m.id
    where public.has_hub_access('network')
      and (public.is_lacms_member() or public.is_professional() or public.is_president())
      and m.membership_status = 'active'
      and exists (select 1 from public.network_visibility v where v.user_id = m.id and v.visible)
  ) x;
$$;
revoke all on function public.get_network_members() from public, anon;
grant execute on function public.get_network_members() to authenticated;

-- Row-level-security policies run as the signed-in person, who has no access to network_visibility,
-- so the policy asks this helper (which runs as the owner) instead.
create or replace function public.network_is_visible(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.network_visibility v where v.user_id = p_user and v.visible);
$$;
revoke all on function public.network_is_visible(uuid) from public, anon;
grant execute on function public.network_is_visible(uuid) to authenticated;

-- The "just joined" feed only mentions members who opted in.
drop policy if exists "Members and professionals can view join events" on public.network_join_events;
create policy "Members and professionals can view join events"
  on public.network_join_events for select
  to authenticated
  using (
    is_visible = true
    and (public.is_lacms_member() or public.is_professional())
    and (not public.is_sixth_form_profile(course, year_of_study) or public.is_dashboard_admin())
    and (member_id is null or public.network_is_visible(member_id))
  );

revoke all on function public.network_get_my_visibility() from public, anon;
revoke all on function public.network_set_my_visibility(boolean) from public, anon;
grant execute on function public.network_get_my_visibility() to authenticated;
grant execute on function public.network_set_my_visibility(boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Provisional events and "register interest"
do $$
begin
  if to_regclass('public.site_events') is not null then
    alter table public.site_events add column if not exists status text not null default 'confirmed';
    alter table public.site_events drop constraint if exists site_events_status_check;
    alter table public.site_events add constraint site_events_status_check check (status in ('confirmed', 'provisional'));
  end if;
end;
$$;

alter table public.event_registrations add column if not exists is_interest boolean not null default false;

-- Register (or register interest). Registering fully later upgrades an interest; interest never
-- downgrades a full registration.
create or replace function public.event_register(p_slug text, p_name text, p_interest boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not (public.is_lacms_member() or public.is_professional()) then
    raise exception 'Please sign in with your LACMS account.';
  end if;
  if p_slug is null or char_length(p_slug) not between 1 and 120 or p_name is null or char_length(p_name) not between 1 and 200 then
    raise exception 'Unknown event.';
  end if;
  insert into public.event_registrations (member_id, event_slug, event_name, is_interest)
  values (auth.uid(), p_slug, p_name, coalesce(p_interest, false))
  on conflict (member_id, event_slug) do update
    set is_interest = public.event_registrations.is_interest and excluded.is_interest;
end;
$$;
revoke all on function public.event_register(text, text, boolean) from public, anon;
grant execute on function public.event_register(text, text, boolean) to authenticated;

-- The committee's list now says which are interest only.
drop function if exists public.president_get_event_registrations();
create function public.president_get_event_registrations()
returns table (id uuid, event_slug text, event_name text, member_name text, registered_at timestamptz, is_interest boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_hub_access('dash_events') then
    raise exception 'Not authorized';
  end if;
  return query
    select er.id, er.event_slug, er.event_name,
           coalesce(m.full_name, np.full_name, u.email::text) as member_name,
           er.registered_at, er.is_interest
    from public.event_registrations er
    left join public.members m on m.id = er.member_id
    left join public.network_professionals np on np.user_id = er.member_id
    left join auth.users u on u.id = er.member_id
    order by er.registered_at desc;
end;
$$;
revoke all on function public.president_get_event_registrations() from public, anon;
grant execute on function public.president_get_event_registrations() to authenticated;

commit;
