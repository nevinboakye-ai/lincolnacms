-- 093: the Network's pre-launch state (president switches the full Network on)
--
-- The Network can be opened to everyone (Dashboard > Hub Access > Network) BEFORE
-- it is fully launched. Until the president presses "Launch the Network" on that
-- page, anyone who isn't on the Executive Committee sees:
--   * the real members (as now), with sixth formers redacted exactly as before
--     (migration 072), and
--   * the professionals as blurred, locked cards: just their category and a lock.
--     No name, job, organisation, photo, LinkedIn or bio is sent to the browser,
--     so there is nothing hidden behind the blur.
-- The president and the Executive Committee always see everything. A professional
-- always sees their own card.
--
-- This is enforced in the database, not only on the page:
--   * the professionals table can only be read by others once launched;
--   * "X just joined" entries about professionals are hidden until launch;
--   * the message directory and new chats leave professionals out until launch
--     (Sankofa mentors and mentees can still message each other as before).
-- The blurred cards are real people, one per active professional, so the numbers
-- shown are true. Nothing is invented.
--
-- Launching is one switch on the Hub Access page (and it can be switched back).
-- Note: this redefines chat_pair_allowed() from 084. If you ever re-run 084,
-- run this file again afterwards.
--
-- Safe to run more than once. Needs 014, 015, 022, 031, 035, 037, 060, 064 and 084.

begin;

-- ---------------------------------------------------------------------
-- The switch. Not launched until the president says so.
insert into public.site_settings (key, value) values ('network_launched', 'false')
on conflict (key) do nothing;

create or replace function public.network_is_launched()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select lower(btrim(s.value)) = 'true' from public.site_settings s where s.key = 'network_launched'), false);
$$;

-- May the caller see professionals' real details?
create or replace function public.network_can_see_professionals()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.network_is_launched() or public.is_dashboard_admin();
$$;

revoke all on function public.network_is_launched() from public, anon;
revoke all on function public.network_can_see_professionals() from public, anon;
grant execute on function public.network_is_launched() to authenticated;
grant execute on function public.network_can_see_professionals() to authenticated;

-- What the Network page needs to know.
create or replace function public.network_launch_state()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('launched', public.network_is_launched(), 'can_see_professionals', public.network_can_see_professionals());
$$;

revoke all on function public.network_launch_state() from public, anon;
grant execute on function public.network_launch_state() to authenticated;

-- President only: launch (true) or go back to pre-launch (false).
create or replace function public.president_set_network_launched(p_launched boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Only the president can launch the Network.';
  end if;
  insert into public.site_settings (key, value, updated_at)
  values ('network_launched', case when coalesce(p_launched, false) then 'true' else 'false' end, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

revoke all on function public.president_set_network_launched(boolean) from public, anon;
grant execute on function public.president_set_network_launched(boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Professionals: others can read them only once launched (or if they are on the
-- committee). Everyone can still read their own row.
drop policy if exists "Members and professionals can view active professionals" on public.network_professionals;
create policy "Members and professionals can view active professionals"
  on public.network_professionals for select
  to authenticated
  using (
    is_active = true
    and (public.is_lacms_member() or public.is_professional())
    and (public.network_can_see_professionals() or user_id = auth.uid())
  );

-- The blurred cards: one per active professional the caller can't see yet, with
-- only their category. Nothing that identifies anyone.
create or replace function public.get_network_professional_placeholders()
returns table (idx integer, category text)
language sql
stable
security definer
set search_path = public
as $$
  select (row_number() over (order by np.category, np.id))::integer, np.category
  from public.network_professionals np
  where np.is_active = true
    and not public.network_can_see_professionals()
    and (public.is_lacms_member() or public.is_professional())
    and public.has_hub_access('network')
    and np.user_id is distinct from auth.uid();
$$;

revoke all on function public.get_network_professional_placeholders() from public, anon;
grant execute on function public.get_network_professional_placeholders() to authenticated;

-- ---------------------------------------------------------------------
-- "Just joined": nothing about professionals until launch (members as before).
drop policy if exists "Members and professionals can view join events" on public.network_join_events;
create policy "Members and professionals can view join events"
  on public.network_join_events for select
  to authenticated
  using (
    is_visible = true
    and (public.is_lacms_member() or public.is_professional())
    and (not public.is_sixth_form_profile(course, year_of_study) or public.is_dashboard_admin())
    and (event_type is distinct from 'professional' or public.network_can_see_professionals())
  );

-- ---------------------------------------------------------------------
-- Messaging: until launch, a chat between two people who both just have Network
-- access can't involve a professional unless the other person is on the
-- Executive Committee. Sankofa participants keep messaging each other.
create or replace function public.chat_is_professional_only(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.network_professionals np where np.user_id = p_user and np.is_active = true)
     and not exists (select 1 from public.members m where m.id = p_user);
$$;

revoke all on function public.chat_is_professional_only(uuid) from public, anon, authenticated;

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
      -- both have Network access (the original rule), and the Network is launched
      -- or no professional is involved (an executive may always talk to one) ...
      (coalesce((select d.allowed from public.hub_access_decision(p_a, 'network') d), false)
       and coalesce((select d.allowed from public.hub_access_decision(p_b, 'network') d), false)
       and (
         public.network_is_launched()
         or not (public.chat_is_professional_only(p_a) or public.chat_is_professional_only(p_b))
         or public.chat_is_executive(p_a) or public.chat_is_executive(p_b)
       ))
      -- ... or each is a Sankofa participant or an executive
      or ((public.sankofa_is_active(p_a) or public.chat_is_executive(p_a))
          and (public.sankofa_is_active(p_b) or public.chat_is_executive(p_b)))
    );
$$;

revoke all on function public.chat_pair_allowed(uuid, uuid) from public, anon, authenticated;

commit;
