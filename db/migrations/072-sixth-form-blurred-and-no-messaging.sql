-- Sixth-form students: everyone except the Executive Committee (and the
-- president) now sees them on the Network as BLURRED placeholder cards -
-- present, but with no name, course, bio or link - and can't message them
-- or be messaged by them.
--
-- This replaces the "hidden entirely" behaviour from 064 on the Network
-- directory only. The "just joined" ticker and banner stay hidden for them
-- (a blurred name there would be pointless), as set in 064.
--
-- The redaction happens in the database, not just in the page: for a
-- restricted row get_network_members() sends back a placeholder name
-- ("Sixth form student"), no course/year/bio/LinkedIn, and a random id that
-- means nothing - so there's nothing to uncover by inspecting the page.
-- A new is_restricted column tells the page to draw it blurred. Executives
-- see everyone exactly as before.
--
-- Messaging (needs 070): a sixth-form student and anyone who isn't an
-- executive can't start or continue a conversation, in either direction,
-- and such conversations drop out of the inbox and unread counts. The rule
-- lives in chat_pair_allowed(); "sixth form" is still decided by
-- is_sixth_form_profile() from 064.
--
-- Wrapped in a transaction. Run this once in Supabase: Dashboard -> SQL
-- Editor -> New query, paste, Run. Needs 064 and 070.

begin;

-- ---------------------------------------------------------------------
-- Messaging rules
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

-- May these two people message each other? Not if either is a sixth-form
-- student and the other isn't an executive.
create or replace function public.chat_pair_allowed(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not (
    (public.chat_is_sixth_form(p_a) and not public.chat_is_executive(p_b))
    or (public.chat_is_sixth_form(p_b) and not public.chat_is_executive(p_a))
  );
$$;

revoke all on function public.chat_is_executive(uuid) from public, anon, authenticated;
revoke all on function public.chat_is_sixth_form(uuid) from public, anon, authenticated;
revoke all on function public.chat_pair_allowed(uuid, uuid) from public, anon, authenticated;

-- Starting, sending and the "New message" picker all already refuse a
-- blocked pair, so making this also refuse a disallowed pair covers them.
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

-- Unread count: skip conversations the caller isn't allowed to be in.
create or replace function public.chat_status()
returns table (can_message boolean, unread integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    public.chat_user_eligible(auth.uid()),
    coalesce((
      select count(*)::int
      from public.chat_participants me
      join public.chat_conversations c on c.id = me.conversation_id
      join public.chat_messages m on m.conversation_id = me.conversation_id
      where me.user_id = auth.uid()
        and not me.muted
        and m.sender_id <> auth.uid()
        and m.deleted_at is null
        and m.created_at > me.last_read_at
        and (me.cleared_at is null or m.created_at > me.cleared_at)
        and public.chat_pair_allowed(auth.uid(), case when c.user_a = auth.uid() then c.user_b else c.user_a end)
    ), 0);
$$;

-- Inbox: as in 070, minus conversations with someone the caller can't see.
create or replace function public.chat_get_conversations()
returns table (
  conversation_id uuid,
  other_id uuid,
  other_name text,
  other_detail text,
  other_kind text,
  other_role text,
  other_bio text,
  other_linkedin text,
  other_photo text,
  last_message_at timestamptz,
  last_body text,
  last_sender_id uuid,
  last_deleted boolean,
  unread_count integer,
  other_last_read_at timestamptz,
  muted boolean,
  i_blocked boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    o.uid,
    coalesce(m.full_name, np.full_name, 'LACMS member'),
    case when m.id is not null then nullif(concat_ws(' · ', m.course, m.year_of_study), '')
         else nullif(concat_ws(' · ', np.title, np.organisation), '') end,
    case when m.id is null and np.id is not null then 'professional' else 'member' end,
    case when m.id is not null then coalesce(m.committee_role, m.member_type) else np.category end,
    coalesce(mp.bio, np.bio),
    coalesce(mp.linkedin_url, np.linkedin_url),
    np.photo_url,
    lm.created_at,
    case when lm.deleted_at is not null then '' else lm.body end,
    lm.sender_id,
    lm.deleted_at is not null,
    (
      select count(*)::int from public.chat_messages x
      where x.conversation_id = c.id
        and x.sender_id <> auth.uid()
        and x.deleted_at is null
        and x.created_at > me.last_read_at
        and (me.cleared_at is null or x.created_at > me.cleared_at)
    ),
    th.last_read_at,
    me.muted,
    exists (select 1 from public.chat_blocks b where b.blocker_id = auth.uid() and b.blocked_id = o.uid)
  from public.chat_conversations c
  join public.chat_participants me on me.conversation_id = c.id and me.user_id = auth.uid()
  cross join lateral (select case when c.user_a = auth.uid() then c.user_b else c.user_a end as uid) o
  left join public.chat_participants th on th.conversation_id = c.id and th.user_id = o.uid
  left join public.members m on m.id = o.uid
  left join public.member_profiles mp on mp.id = o.uid
  left join lateral (
    select p.* from public.network_professionals p where p.user_id = o.uid order by p.created_at limit 1
  ) np on true
  join lateral (
    select x.created_at, x.body, x.sender_id, x.deleted_at
    from public.chat_messages x
    where x.conversation_id = c.id and (me.cleared_at is null or x.created_at > me.cleared_at)
    order by x.created_at desc
    limit 1
  ) lm on true
  where (c.user_a = auth.uid() or c.user_b = auth.uid())
    and public.chat_pair_allowed(auth.uid(), o.uid)
  order by lm.created_at desc;
$$;

-- ---------------------------------------------------------------------
-- The Network directory: restricted rows are redacted, not removed.
drop function if exists public.get_network_members();

create function public.get_network_members()
returns table (
  id uuid,
  full_name text,
  course text,
  year_of_study text,
  member_type text,
  committee_role text,
  linkedin_url text,
  bio text,
  is_pending boolean,
  is_restricted boolean
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
    x.is_pending,
    x.restricted
  from (
    select m.id, m.full_name, m.course, m.year_of_study, m.member_type, m.committee_role,
           p.linkedin_url, p.bio, false as is_pending,
           (public.is_sixth_form_profile(m.course, m.year_of_study) and not public.is_dashboard_admin()) as restricted
    from public.members m
    left join public.member_profiles p on p.id = m.id
    where public.has_hub_access('network')
      and (public.is_lacms_member() or public.is_professional() or public.is_president())
      and m.membership_status = 'active'
    union all
    select pm.id, pm.full_name, pm.course, pm.year_of_study, pm.member_type, pm.committee_role,
           null::text, null::text, true,
           (public.is_sixth_form_profile(pm.course, pm.year_of_study) and not public.is_dashboard_admin())
    from public.pending_members pm
    where public.has_hub_access('network')
      and (public.is_lacms_member() or public.is_professional() or public.is_president())
      and pm.visible_in_network = true
      and not exists (
        select 1
        from public.members m2
        left join auth.users u2 on u2.id = m2.id
        where lower(btrim(m2.full_name)) = lower(btrim(pm.full_name))
           or lower(u2.email) = lower(pm.email)
      )
  ) x;
$$;

revoke all on function public.get_network_members() from public, anon;
grant execute on function public.get_network_members() to authenticated;

commit;
