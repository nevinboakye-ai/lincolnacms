-- Direct messages between people in the LACMS Network.
--
-- Anyone who can use the Network (Hub Access rule "network", migration 060)
-- can message anyone else who can. One conversation per pair of people.
--
-- What's in it
--   * chat_conversations  - one row per pair (user_a < user_b keeps it unique)
--   * chat_participants   - each person's own state for a conversation: when
--                           they last read it (drives unread counts and the
--                           "Seen" receipt), when they cleared it, muted
--   * chat_messages       - the messages (plain text, 2,000 characters max).
--                           A deleted message keeps its row but loses its text.
--   * chat_blocks         - who has blocked whom
--   * chat_suspensions    - people the president has stopped from messaging
--   * chat_reports        - reports of a message, each with a snapshot of the
--                           last few messages so the president can review it
--
-- Privacy: only the two people in a conversation can read it - not the
-- president, not Supabase staff via the site. The ONLY way anyone else sees
-- a message is if one of the two reports it, and then only that message and
-- the few before it (see chat_report below).
--
-- Everything that changes data goes through the functions below (security
-- definer, each one checks who's calling); the tables themselves can only be
-- READ by the people involved, which is also what lets Supabase Realtime
-- deliver new messages live without leaking anyone else's.
--
-- Wrapped in a transaction. Run this once in Supabase: Dashboard -> SQL
-- Editor -> New query, paste, Run. Needs 060/061 (Hub Access), 025 (is_president)
-- and 063 (members.membership_status).
--
-- Realtime: this adds chat_messages and chat_participants to the
-- supabase_realtime publication. If your project has Realtime switched off
-- the site still works - it just checks for new messages every few seconds.

begin;

-- ---------------------------------------------------------------------
-- Tables
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint chat_conversations_ordered check (user_a < user_b),
  constraint chat_conversations_pair unique (user_a, user_b)
);

create table if not exists public.chat_participants (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  cleared_at timestamptz,
  muted boolean not null default false,
  primary key (conversation_id, user_id)
);
create index if not exists chat_participants_user_idx on public.chat_participants (user_id);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  client_id uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint chat_messages_body_length check (
    deleted_at is not null or char_length(btrim(body)) between 1 and 2000
  ),
  constraint chat_messages_client_unique unique (conversation_id, sender_id, client_id)
);
create index if not exists chat_messages_conversation_idx on public.chat_messages (conversation_id, created_at desc);
create index if not exists chat_messages_sender_idx on public.chat_messages (sender_id, created_at desc);

create table if not exists public.chat_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint chat_blocks_not_self check (blocker_id <> blocked_id)
);

create table if not exists public.chat_suspensions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  suspended_by uuid references auth.users(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  reported_id uuid references auth.users(id) on delete set null,
  conversation_id uuid references public.chat_conversations(id) on delete set null,
  message_id uuid,
  reason text not null check (reason in ('harassment', 'spam', 'inappropriate', 'impersonation', 'other')),
  details text check (details is null or char_length(details) <= 1000),
  context jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 1000),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists chat_reports_status_idx on public.chat_reports (status, created_at desc);

-- ---------------------------------------------------------------------
-- Helpers used by the policies and functions below.

-- Is the caller one of the two people in this conversation? (A function,
-- not an inline sub-select, so the participants policy can use it without
-- recursing into itself.)
create or replace function public.chat_in_conversation(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_participants p
    where p.conversation_id = p_conversation and p.user_id = auth.uid()
  );
$$;

-- Can the caller see a message from this conversation made at this time?
-- (Not if they cleared the conversation after it was sent.)
create or replace function public.chat_can_see_message(p_conversation uuid, p_created timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_participants p
    where p.conversation_id = p_conversation
      and p.user_id = auth.uid()
      and (p.cleared_at is null or p_created > p.cleared_at)
  );
$$;

-- Can this person send and receive messages? They need Network access, an
-- active membership (or an active professional profile), and must not be
-- suspended. The president is always allowed.
create or replace function public.chat_user_eligible(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null
    and coalesce((select d.allowed from public.hub_access_decision(p_user, 'network') d), false)
    and (
      p_user = '22044cd2-6804-4142-96c4-5c475ce9347a'::uuid
      or exists (select 1 from public.members m where m.id = p_user and m.membership_status = 'active')
      or exists (select 1 from public.network_professionals np where np.user_id = p_user and np.is_active = true)
    )
    and not exists (select 1 from public.chat_suspensions s where s.user_id = p_user);
$$;

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
  );
$$;

create or replace function public.chat_display_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select m.full_name from public.members m where m.id = p_user),
    (select np.full_name from public.network_professionals np where np.user_id = p_user limit 1),
    'LACMS member'
  );
$$;

revoke all on function public.chat_user_eligible(uuid) from public, anon, authenticated;
revoke all on function public.chat_blocked_between(uuid, uuid) from public, anon, authenticated;
revoke all on function public.chat_display_name(uuid) from public, anon, authenticated;
revoke all on function public.chat_in_conversation(uuid) from public, anon;
revoke all on function public.chat_can_see_message(uuid, timestamptz) from public, anon;
grant execute on function public.chat_in_conversation(uuid) to authenticated;
grant execute on function public.chat_can_see_message(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- Row-level security: people can READ what they're part of; all changes
-- go through the functions below.
alter table public.chat_conversations enable row level security;
alter table public.chat_participants enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_blocks enable row level security;
alter table public.chat_suspensions enable row level security;
alter table public.chat_reports enable row level security;

drop policy if exists "Read your own conversations" on public.chat_conversations;
create policy "Read your own conversations"
  on public.chat_conversations for select
  to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b);

drop policy if exists "Read both sides of your conversations" on public.chat_participants;
create policy "Read both sides of your conversations"
  on public.chat_participants for select
  to authenticated
  using (public.chat_in_conversation(conversation_id));

drop policy if exists "Read messages in your conversations" on public.chat_messages;
create policy "Read messages in your conversations"
  on public.chat_messages for select
  to authenticated
  using (public.chat_can_see_message(conversation_id, created_at));

drop policy if exists "Read your own blocks" on public.chat_blocks;
create policy "Read your own blocks"
  on public.chat_blocks for select
  to authenticated
  using (blocker_id = auth.uid());

-- chat_suspensions and chat_reports: no policies at all, so nobody can read
-- them directly; only the president's functions below can.

revoke insert, update, delete, truncate on public.chat_conversations from anon, authenticated;
revoke insert, update, delete, truncate on public.chat_participants from anon, authenticated;
revoke insert, update, delete, truncate on public.chat_messages from anon, authenticated;
revoke insert, update, delete, truncate on public.chat_blocks from anon, authenticated;
revoke all on public.chat_suspensions from anon, authenticated;
revoke all on public.chat_reports from anon, authenticated;
revoke all on public.chat_conversations, public.chat_participants, public.chat_messages, public.chat_blocks from anon;

-- ---------------------------------------------------------------------
-- Status for the header icon / Messages tab: can this person message, and
-- how many unread messages do they have (muted conversations don't count)?
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
      join public.chat_messages m on m.conversation_id = me.conversation_id
      where me.user_id = auth.uid()
        and not me.muted
        and m.sender_id <> auth.uid()
        and m.deleted_at is null
        and m.created_at > me.last_read_at
        and (me.cleared_at is null or m.created_at > me.cleared_at)
    ), 0);
$$;

revoke all on function public.chat_status() from public, anon;
grant execute on function public.chat_status() to authenticated;

-- ---------------------------------------------------------------------
-- Everyone the caller can message (for the "New message" picker).
create or replace function public.chat_directory()
returns table (user_id uuid, full_name text, detail text, kind text, role text, photo_url text)
language sql
stable
security definer
set search_path = public
as $$
  select * from (
    select m.id as user_id, m.full_name,
           nullif(concat_ws(' · ', m.course, m.year_of_study), '') as detail,
           'member'::text as kind,
           coalesce(m.committee_role, m.member_type) as role,
           null::text as photo_url
    from public.members m
    where m.id <> auth.uid()
      and m.membership_status = 'active'
      and public.chat_user_eligible(m.id)
      and not public.chat_blocked_between(auth.uid(), m.id)
    union all
    select np.user_id, np.full_name,
           nullif(concat_ws(' · ', np.title, np.organisation), ''),
           'professional'::text,
           np.category,
           np.photo_url
    from public.network_professionals np
    where np.user_id is not null
      and np.user_id <> auth.uid()
      and np.is_active = true
      and not exists (select 1 from public.members mm where mm.id = np.user_id)
      and public.chat_user_eligible(np.user_id)
      and not public.chat_blocked_between(auth.uid(), np.user_id)
  ) people
  where public.chat_user_eligible(auth.uid())
  order by full_name;
$$;

revoke all on function public.chat_directory() from public, anon;
grant execute on function public.chat_directory() to authenticated;

-- ---------------------------------------------------------------------
-- The caller's conversations (newest first), with who's on the other side,
-- the latest visible message, and unread / read-receipt info.
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
  where c.user_a = auth.uid() or c.user_b = auth.uid()
  order by lm.created_at desc;
$$;

revoke all on function public.chat_get_conversations() from public, anon;
grant execute on function public.chat_get_conversations() to authenticated;

-- ---------------------------------------------------------------------
-- Open (or create) the conversation with someone. Returns its id.
create or replace function public.chat_start_conversation(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  a uuid;
  b uuid;
  cid uuid;
begin
  if me is null then
    raise exception 'Please sign in to send messages.';
  end if;
  if p_other is null or p_other = me then
    raise exception 'Choose someone else to message.';
  end if;
  if not public.chat_user_eligible(me) then
    raise exception 'Messaging isn''t available on your account.';
  end if;
  if not public.chat_user_eligible(p_other) or public.chat_blocked_between(me, p_other) then
    raise exception 'You can''t message this person right now.';
  end if;

  if me < p_other then a := me; b := p_other; else a := p_other; b := me; end if;

  select c.id into cid from public.chat_conversations c where c.user_a = a and c.user_b = b;
  if cid is null then
    insert into public.chat_conversations (user_a, user_b) values (a, b)
    on conflict (user_a, user_b) do nothing
    returning id into cid;
    if cid is null then
      select c.id into cid from public.chat_conversations c where c.user_a = a and c.user_b = b;
    end if;
  end if;

  insert into public.chat_participants (conversation_id, user_id) values (cid, a), (cid, b)
  on conflict (conversation_id, user_id) do nothing;

  return cid;
end;
$$;

-- ---------------------------------------------------------------------
-- Send a message. p_client_id makes a retry harmless: sending the same
-- client id twice returns the first message instead of duplicating it.
create or replace function public.chat_send_message(p_conversation uuid, p_body text, p_client_id uuid default null)
returns public.chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  conv public.chat_conversations;
  other uuid;
  msg public.chat_messages;
  clean text;
begin
  if me is null then
    raise exception 'Please sign in to send messages.';
  end if;

  select * into conv from public.chat_conversations c
  where c.id = p_conversation and (c.user_a = me or c.user_b = me);
  if not found then
    raise exception 'That conversation isn''t available.';
  end if;
  other := case when conv.user_a = me then conv.user_b else conv.user_a end;

  if p_client_id is not null then
    select * into msg from public.chat_messages x
    where x.conversation_id = p_conversation and x.sender_id = me and x.client_id = p_client_id;
    if found then
      return msg;
    end if;
  end if;

  clean := regexp_replace(coalesce(p_body, ''), '^\s+|\s+$', '', 'g');
  if char_length(clean) = 0 then
    raise exception 'Write a message first.';
  end if;
  if char_length(clean) > 2000 then
    raise exception 'Messages can be up to 2,000 characters.';
  end if;

  if not public.chat_user_eligible(me) then
    raise exception 'Messaging isn''t available on your account.';
  end if;
  if not public.chat_user_eligible(other) or public.chat_blocked_between(me, other) then
    raise exception 'You can''t message this person right now.';
  end if;

  if (select count(*) from public.chat_messages x
      where x.sender_id = me and x.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'You''re sending messages very quickly - wait a moment and try again.';
  end if;

  begin
    insert into public.chat_messages (conversation_id, sender_id, body, client_id)
    values (p_conversation, me, clean, p_client_id)
    returning * into msg;
  exception when unique_violation then
    select * into msg from public.chat_messages x
    where x.conversation_id = p_conversation and x.sender_id = me and x.client_id = p_client_id;
    return msg;
  end;

  update public.chat_conversations set last_message_at = msg.created_at where id = p_conversation;
  update public.chat_participants set last_read_at = msg.created_at
  where conversation_id = p_conversation and user_id = me;

  return msg;
end;
$$;

-- ---------------------------------------------------------------------
-- Mark a conversation read (server clock). The other person sees "Seen".
create or replace function public.chat_mark_read(p_conversation uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.chat_participants
  set last_read_at = now()
  where conversation_id = p_conversation
    and user_id = auth.uid()
    and last_read_at < now();
$$;

-- Delete one of your own messages (its text is removed for both people).
create or replace function public.chat_delete_message(p_message uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_messages
  set body = '', deleted_at = now()
  where id = p_message and sender_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'That message can''t be deleted.';
  end if;
end;
$$;

-- Clear a conversation from your side only; the other person keeps theirs,
-- and it comes back (with only newer messages) if either of you writes again.
create or replace function public.chat_clear_conversation(p_conversation uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.chat_participants
  set cleared_at = now(), last_read_at = now()
  where conversation_id = p_conversation and user_id = auth.uid();
$$;

create or replace function public.chat_set_muted(p_conversation uuid, p_muted boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.chat_participants
  set muted = coalesce(p_muted, false)
  where conversation_id = p_conversation and user_id = auth.uid();
$$;

create or replace function public.chat_set_blocked(p_user uuid, p_blocked boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_user is null or p_user = auth.uid() then
    raise exception 'That can''t be blocked.';
  end if;
  if coalesce(p_blocked, false) then
    insert into public.chat_blocks (blocker_id, blocked_id) values (auth.uid(), p_user)
    on conflict (blocker_id, blocked_id) do nothing;
  else
    delete from public.chat_blocks where blocker_id = auth.uid() and blocked_id = p_user;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Report someone from a conversation. Takes a snapshot of the reported
-- message (or the latest one) and the nine before it, so the president can
-- review it even if the messages are deleted afterwards. Nothing else from
-- the conversation is shared.
create or replace function public.chat_report(p_conversation uuid, p_message uuid, p_reason text, p_details text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  conv public.chat_conversations;
  other uuid;
  upto timestamptz;
  ctx jsonb;
  rid uuid;
begin
  if me is null then
    raise exception 'Please sign in.';
  end if;
  select * into conv from public.chat_conversations c
  where c.id = p_conversation and (c.user_a = me or c.user_b = me);
  if not found then
    raise exception 'That conversation isn''t available.';
  end if;
  other := case when conv.user_a = me then conv.user_b else conv.user_a end;

  if p_reason is null or p_reason not in ('harassment', 'spam', 'inappropriate', 'impersonation', 'other') then
    raise exception 'Choose a reason for the report.';
  end if;
  if (select count(*) from public.chat_reports r
      where r.reporter_id = me and r.created_at > now() - interval '1 day') >= 10 then
    raise exception 'You''ve sent a lot of reports today - the committee will look at them first.';
  end if;

  select x.created_at into upto from public.chat_messages x
  where x.id = p_message and x.conversation_id = p_conversation;
  if upto is null then
    upto := now();
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'sender_id', t.sender_id,
             'sender', public.chat_display_name(t.sender_id),
             'body', t.body,
             'at', t.created_at,
             'deleted', t.deleted_at is not null,
             'reported', t.id = p_message
           ) order by t.created_at), '[]'::jsonb)
    into ctx
  from (
    select x.* from public.chat_messages x
    where x.conversation_id = p_conversation and x.created_at <= upto
    order by x.created_at desc
    limit 10
  ) t;

  insert into public.chat_reports (reporter_id, reported_id, conversation_id, message_id, reason, details, context)
  values (me, other, p_conversation, p_message, p_reason, nullif(left(btrim(coalesce(p_details, '')), 1000), ''), ctx)
  returning id into rid;

  return rid;
end;
$$;

-- ---------------------------------------------------------------------
-- President: review reports, suspend or restore someone's messaging.
create or replace function public.president_get_chat_reports()
returns table (
  id uuid, status text, reason text, details text, created_at timestamptz,
  reporter_id uuid, reporter_name text, reported_id uuid, reported_name text,
  reported_suspended boolean, context jsonb, resolution_note text, resolved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Only the president can view message reports.';
  end if;
  return query
    select r.id, r.status, r.reason, r.details, r.created_at,
           r.reporter_id, public.chat_display_name(r.reporter_id),
           r.reported_id, public.chat_display_name(r.reported_id),
           exists (select 1 from public.chat_suspensions s where s.user_id = r.reported_id),
           r.context, r.resolution_note, r.resolved_at
    from public.chat_reports r
    order by (r.status = 'open') desc, r.created_at desc;
end;
$$;

create or replace function public.president_resolve_chat_report(p_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Only the president can resolve message reports.';
  end if;
  if p_status not in ('open', 'resolved', 'dismissed') then
    raise exception 'Unknown status.';
  end if;
  update public.chat_reports
  set status = p_status,
      resolution_note = nullif(left(btrim(coalesce(p_note, '')), 1000), ''),
      resolved_by = case when p_status = 'open' then null else auth.uid() end,
      resolved_at = case when p_status = 'open' then null else now() end
  where id = p_id;
end;
$$;

create or replace function public.president_set_chat_suspension(p_user uuid, p_suspended boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Only the president can suspend messaging.';
  end if;
  if p_user is null or p_user = auth.uid() then
    raise exception 'That account can''t be suspended.';
  end if;
  if coalesce(p_suspended, false) then
    insert into public.chat_suspensions (user_id, suspended_by, reason)
    values (p_user, auth.uid(), nullif(left(btrim(coalesce(p_reason, '')), 500), ''))
    on conflict (user_id) do update set suspended_by = excluded.suspended_by, reason = excluded.reason, created_at = now();
  else
    delete from public.chat_suspensions where user_id = p_user;
  end if;
end;
$$;

revoke all on function public.chat_start_conversation(uuid) from public, anon;
revoke all on function public.chat_send_message(uuid, text, uuid) from public, anon;
revoke all on function public.chat_mark_read(uuid) from public, anon;
revoke all on function public.chat_delete_message(uuid) from public, anon;
revoke all on function public.chat_clear_conversation(uuid) from public, anon;
revoke all on function public.chat_set_muted(uuid, boolean) from public, anon;
revoke all on function public.chat_set_blocked(uuid, boolean) from public, anon;
revoke all on function public.chat_report(uuid, uuid, text, text) from public, anon;
revoke all on function public.president_get_chat_reports() from public, anon;
revoke all on function public.president_resolve_chat_report(uuid, text, text) from public, anon;
revoke all on function public.president_set_chat_suspension(uuid, boolean, text) from public, anon;
grant execute on function public.chat_start_conversation(uuid) to authenticated;
grant execute on function public.chat_send_message(uuid, text, uuid) to authenticated;
grant execute on function public.chat_mark_read(uuid) to authenticated;
grant execute on function public.chat_delete_message(uuid) to authenticated;
grant execute on function public.chat_clear_conversation(uuid) to authenticated;
grant execute on function public.chat_set_muted(uuid, boolean) to authenticated;
grant execute on function public.chat_set_blocked(uuid, boolean) to authenticated;
grant execute on function public.chat_report(uuid, uuid, text, text) to authenticated;
grant execute on function public.president_get_chat_reports() to authenticated;
grant execute on function public.president_resolve_chat_report(uuid, text, text) to authenticated;
grant execute on function public.president_set_chat_suspension(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- Live delivery: let Realtime stream new messages and read receipts. Each
-- person only ever receives rows their own read policy lets them see.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.chat_messages;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.chat_participants;
    exception when duplicate_object then null;
    end;
  end if;
end;
$$;

commit;
