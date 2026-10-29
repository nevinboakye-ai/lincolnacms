-- 109: Open a Circle to its members
--
-- The full Sankofa Hub needs Hub Access, and people are only counted as in it once their
-- account is fully set up. So a Circle full of mentors and mentees who are still pending could
-- not be seen by any of them. Now the committee can OPEN a Circle to its members: everyone placed
-- in it (with a login) can see the Circle and everyone in it BY NAME, with role and title, even if
-- the Hub itself isn't open to them yet and even if some mentors are still pending (a guest mentor
-- with no account, or a professional awaiting approval).
--
-- It's a read-only roster: names, roles, titles and the Circle's motto. No emails, no messages, no
-- progress. Sixth-form members still show without a name to anyone but the Executive Committee.
--
-- Closed by default. Open or close a Circle from Dashboard -> Sankofa Hub -> open the Circle.
-- Safe to run more than once. Needs 084, 085, 086 and 106.

begin;

alter table public.sankofa_circles add column if not exists shared boolean not null default false;

create or replace function public.sankofa_admin_circle_shares()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.sankofa_is_admin() then raise exception 'Not authorized'; end if;
  return coalesce((select jsonb_agg(c.id) from public.sankofa_circles c where c.shared), '[]'::jsonb);
end;
$$;

create or replace function public.sankofa_admin_circle_set_shared(p_circle uuid, p_shared boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.sankofa_is_admin() then raise exception 'Not authorized'; end if;
  update public.sankofa_circles set shared = coalesce(p_shared, false) where id = p_circle;
  if not found then raise exception 'That Circle no longer exists.'; end if;
end;
$$;

-- What a member sees of their own Circle when it has been opened to them.
create or replace function public.sankofa_shared_circle()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.sankofa_circles;
begin
  if me is null then return null; end if;
  select ci.* into c from public.sankofa_circle_members cm join public.sankofa_circles ci on ci.id = cm.circle_id
  where cm.user_id = me and ci.shared and ci.status = 'active';
  if not found then return null; end if;
  return jsonb_build_object(
    'circle', jsonb_build_object('id', c.id, 'name', c.name, 'theme', c.theme, 'motto', c.motto, 'description', c.description, 'academic_year', c.academic_year),
    'people', coalesce((
      select jsonb_agg(x.p order by x.rank, x.nm) from (
        select public.sankofa_person(me, cm2.user_id) || jsonb_build_object('is_me', cm2.user_id = me, 'is_lead', cm2.is_lead) as p,
               (sp.role = 'mentor')::int * -1 as rank,
               lower(coalesce(public.sankofa_person(me, cm2.user_id) ->> 'name', '')) as nm
        from public.sankofa_circle_members cm2
        join public.sankofa_participants sp on sp.user_id = cm2.user_id and sp.status = 'active'
        where cm2.circle_id = c.id
        union all
        select jsonb_build_object('id', 'g:' || g.id, 'name', g.name, 'role', 'mentor', 'stage', coalesce(nullif(concat_ws(' · ', g.title, g.organisation), ''), 'Guest mentor'),
                 'specialty', g.specialty, 'is_guest', true, 'pending', g.status = 'pending', 'is_me', false, 'is_lead', false),
               -1, lower(g.name)
        from public.sankofa_guest_mentors g where g.circle_id = c.id
      ) x
    ), '[]'::jsonb));
end;
$$;

revoke all on function public.sankofa_admin_circle_shares() from public, anon;
revoke all on function public.sankofa_admin_circle_set_shared(uuid, boolean) from public, anon;
revoke all on function public.sankofa_shared_circle() from public, anon;
grant execute on function public.sankofa_admin_circle_shares() to authenticated;
grant execute on function public.sankofa_admin_circle_set_shared(uuid, boolean) to authenticated;
grant execute on function public.sankofa_shared_circle() to authenticated;

-- The Members Hub tile asks this; with no Hub access it now also says if their Circle is open.
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
  if me is null or not public.has_hub_access('sankofa_hub') then
    -- No Hub access, but their Circle may have been opened to its members (see sankofa_shared_circle).
    return jsonb_build_object('participant', false,
      'shared_circle', (select c.name from public.sankofa_circle_members cm join public.sankofa_circles c on c.id = cm.circle_id
                        where cm.user_id = me and c.shared and c.status = 'active'));
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

commit;
