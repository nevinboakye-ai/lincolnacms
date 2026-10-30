-- 113: Network listing is ON by default, and members can switch themselves off
--
-- Change from 112: every active member with an account is listed in the Network unless they have
-- switched themselves off. Their "Show me in the Network" box is ticked by default (My data & privacy
-- on the members hub, or the strip on the Network page) and unticking it removes them straight away.
-- Only a stored "off" choice hides someone, so new members are listed from the start.
--
-- Because this is not consent-based any more (a pre-ticked box is not valid consent), the privacy
-- notice describes it as part of running the member community, with a clear, easy way to opt out.
-- Same details as before: name, course, year, member type, committee role, and any LinkedIn link or
-- bio the member added. Never an email address. Restricted rows stay redacted. People
-- added by the committee before they have an account are still not listed (they can't opt out).
--
-- Safe to run more than once. Needs 112.

begin;

create or replace function public.network_get_my_visibility()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('visible', coalesce((select v.visible from public.network_visibility v where v.user_id = auth.uid()), true));
$$;

create or replace function public.network_is_visible(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.network_visibility v where v.user_id = p_user and v.visible = false);
$$;

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
    case when x.restricted then 'Restricted profile' else x.full_name end,
    case when x.restricted then 'Restricted' else x.course end,
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
      and not exists (select 1 from public.network_visibility v where v.user_id = m.id and v.visible = false)
  ) x;
$$;
revoke all on function public.get_network_members() from public, anon;
grant execute on function public.get_network_members() to authenticated;

commit;
