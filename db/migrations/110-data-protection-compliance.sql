-- 110: Data protection compliance tools (UK GDPR / Data Protection Act 2018 / PECR / Data (Use and Access) Act 2025)
--
-- What this adds:
--   1. compliance_requests - one place for every request about someone's data or a concern:
--      access (a copy of your data), erasure, correction, restriction, objection, withdrawing
--      consent, complaints, safeguarding / content concerns. Anyone can submit one (with or without
--      an account). Each gets a due date one calendar month away, which is the legal time limit for
--      data rights requests. The committee works through them in the dashboard (Dashboard -> Data & Privacy).
--   2. export_my_data() - a signed-in person can download everything the site holds about them
--      (right of access and data portability) as a JSON file, instantly.
--   3. president_erase_user() - erases a person from the site (right to erasure): deletes their
--      login and everything that hangs off it, removes copies kept by email address, and
--      anonymises what has to stay (e.g. anonymous event feedback). It tells the president what
--      still needs checking by hand (public winners wall, uploaded files).
--   4. privacy_purge_expired() - the retention schedule: deletes data that has outlived its use
--      (analytics, logs, rejected requests ...). Run it from the dashboard, or schedule it.
--   5. privacy_inactive_accounts() - lists accounts nobody has signed in to for a long time, so
--      they can be reviewed and erased (storage limitation).
--   6. email_preferences - people can opt out of non-essential updates; the email centre respects it.
--   7. privacy_acknowledgements - records which version of the privacy notice each person has
--      seen, so a changed notice is shown again (members and professionals).
--
-- Nothing here is readable or writable directly: every table is locked and every action goes
-- through a function that checks who is asking.
--
-- Safe to run more than once. Needs 025 (is_president), 047, 070 and 084. Tables from other
-- migrations are skipped if they don't exist, so the order you ran them in doesn't matter.
-- Run once in Supabase: Dashboard -> SQL Editor -> New query, paste, Run.

begin;

-- ---------------------------------------------------------------------
-- 1. Requests
create table if not exists public.compliance_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('access', 'erasure', 'rectification', 'restriction', 'objection', 'withdraw_consent', 'complaint', 'safeguarding', 'content', 'other')),
  name text check (name is null or char_length(name) <= 200),
  email text not null check (char_length(email) between 5 and 254),
  user_id uuid references auth.users (id) on delete set null,
  details text check (details is null or char_length(details) <= 3000),
  status text not null default 'received' check (status in ('received', 'verifying', 'in_progress', 'completed', 'refused', 'withdrawn')),
  due_at timestamptz not null default (now() + interval '1 month'),
  handled_by uuid references auth.users (id) on delete set null,
  handled_at timestamptz,
  outcome_note text check (outcome_note is null or char_length(outcome_note) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists compliance_requests_status_idx on public.compliance_requests (status, due_at);
create index if not exists compliance_requests_user_idx on public.compliance_requests (user_id);
alter table public.compliance_requests enable row level security;
revoke all on public.compliance_requests from anon, authenticated;

-- Anyone may submit one. Limited so the form can't be used to flood the committee.
create or replace function public.submit_compliance_request(p_kind text, p_name text, p_email text, p_details text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  em text := lower(btrim(coalesce(p_email, '')));
  rid uuid;
  due timestamptz;
begin
  if p_kind is null or p_kind not in ('access', 'erasure', 'rectification', 'restriction', 'objection', 'withdraw_consent', 'complaint', 'safeguarding', 'content', 'other') then
    raise exception 'Choose what your request is about.';
  end if;
  if em !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(em) > 254 then
    raise exception 'Enter a valid email address so we can reply to you.';
  end if;
  if char_length(coalesce(p_details, '')) > 3000 or char_length(coalesce(p_name, '')) > 200 then
    raise exception 'That is too long - please shorten it.';
  end if;
  if (select count(*) from public.compliance_requests where lower(email) = em and created_at > now() - interval '1 day') >= 5
     or (select count(*) from public.compliance_requests where created_at > now() - interval '1 hour') >= 100 then
    raise exception 'Too many requests just now. Please email acms@lincolnsu.com instead.';
  end if;
  insert into public.compliance_requests (kind, name, email, user_id, details)
  values (p_kind, nullif(btrim(coalesce(p_name, '')), ''), em, auth.uid(), nullif(btrim(coalesce(p_details, '')), ''))
  returning id, due_at into rid, due;
  return jsonb_build_object('id', rid, 'due_at', due);
end;
$$;

-- A signed-in person's own requests (matched by account or by the email on their login).
create or replace function public.my_compliance_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  em text;
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  select lower(u.email::text) into em from auth.users u where u.id = auth.uid();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'status', r.status, 'due_at', r.due_at, 'created_at', r.created_at, 'outcome_note', r.outcome_note) order by r.created_at desc)
    from public.compliance_requests r where r.user_id = auth.uid() or lower(r.email) = em
  ), '[]'::jsonb);
end;
$$;

-- The president's queue.
create or replace function public.president_list_compliance_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_president() then raise exception 'Not authorized'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'kind', r.kind, 'name', r.name, 'email', r.email, 'user_id', r.user_id, 'details', r.details,
      'status', r.status, 'due_at', r.due_at, 'handled_at', r.handled_at, 'outcome_note', r.outcome_note, 'created_at', r.created_at,
      'account_id', (select u.id from auth.users u where u.id = r.user_id or lower(u.email::text) = lower(r.email) order by (u.id = r.user_id) desc limit 1)
    ) order by (r.status in ('completed', 'refused', 'withdrawn')), r.due_at, r.created_at)
    from public.compliance_requests r
  ), '[]'::jsonb);
end;
$$;

create or replace function public.president_update_compliance_request(p_id uuid, p_status text, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then raise exception 'Not authorized'; end if;
  if p_status not in ('received', 'verifying', 'in_progress', 'completed', 'refused', 'withdrawn') then
    raise exception 'Unknown status.';
  end if;
  update public.compliance_requests
  set status = p_status, outcome_note = nullif(left(btrim(coalesce(p_note, '')), 2000), ''),
      handled_by = auth.uid(), handled_at = now()
  where id = p_id;
  if not found then raise exception 'That request no longer exists.'; end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Download my data
create or replace function public.privacy__rows(p_table text, p_col text, p_val text, p_by_email boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  if to_regclass('public.' || quote_ident(p_table)) is null then
    return null;
  end if;
  begin
    if p_by_email then
      execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t where lower(t.%I::text) = lower($1)', p_table, p_col) into r using p_val;
    else
      execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t where t.%I::text = $1', p_table, p_col) into r using p_val;
    end if;
  exception when undefined_column then
    return null;
  end;
  return r;
end;
$$;
revoke all on function public.privacy__rows(text, text, text, boolean) from public, anon, authenticated;

create or replace function public.privacy__export(p_uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := p_uid;
  em text;
  out jsonb;
  spec text;
  parts text[];
  rows_ jsonb;
begin
  if uid is null then raise exception 'Choose a person.'; end if;
  select u.email::text into em from auth.users u where u.id = uid;
  out := jsonb_build_object(
    'about_this_file', 'Everything the LACMS website holds that is linked to your account or your email address, generated ' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ' UTC. Other people''s messages to you are not included, as they are other people''s data. Questions: acms@lincolnsu.com.',
    'account', (select jsonb_build_object('user_id', u.id, 'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at) from auth.users u where u.id = uid)
  );
  -- table : column that holds the person's id
  foreach spec in array array[
    'members:id', 'member_profiles:id', 'network_professionals:user_id', 'mmg_guests:id',
    'event_registrations:member_id', 'event_feedback:user_id', 'motm_nominations:nominator_id', 'motm_nominations_about_me:nominee_user_id',
    'news_likes:member_id', 'news_comments:member_id', 'resource_likes:user_id', 'resource_comments:author_id', 'resources:uploader_id',
    'resource_unlocks:user_id', 'resource_events:user_id', 'discount_usage:member_id', 'mmg_votes:voter_id', 'member_xp:user_id',
    'member_badges:user_id', 'member_game_prefs:user_id', 'network_join_events:member_id', 'notification_seen:user_id', 'user_ui_state:user_id',
    'hub_access_overrides:user_id', 'sankofa_applications:member_id', 'sankofa_participants:user_id', 'sankofa_circle_members:user_id',
    'sankofa_goals:user_id', 'sankofa_checkins:user_id', 'sankofa_posts:author_id', 'sankofa_post_reactions:user_id',
    'sankofa_meeting_rsvps:user_id', 'sankofa_meeting_feedback:user_id', 'sankofa_xp:user_id', 'sankofa_badges:user_id',
    'chat_messages_i_sent:sender_id', 'chat_reports_i_made:reporter_id', 'chat_blocks:blocker_id', 'member_email_log:user_id',
    'email_preferences:user_id', 'privacy_acknowledgements:user_id', 'compliance_requests:user_id', 'professional_requests:auth_user_id',
    'account_requests:auth_user_id', 'times_a_committee_admin_previewed_the_site_as_you:target_id'
  ] loop
    parts := string_to_array(spec, ':');
    rows_ := public.privacy__rows(
      case parts[1]
        when 'motm_nominations_about_me' then 'motm_nominations'
        when 'chat_messages_i_sent' then 'chat_messages'
        when 'chat_reports_i_made' then 'chat_reports'
        when 'times_a_committee_admin_previewed_the_site_as_you' then 'view_as_log'
        else parts[1] end,
      parts[2], uid::text);
    if rows_ is not null and jsonb_array_length(rows_) > 0 then
      -- never include the other people's data that happens to sit in the same row
      if parts[1] = 'chat_reports_i_made' then
        rows_ := (select coalesce(jsonb_agg(x - 'context' - 'reported_id'), '[]'::jsonb) from jsonb_array_elements(rows_) x);
      end if;
      out := out || jsonb_build_object(parts[1], rows_);
    end if;
  end loop;
  -- Things kept against your email address rather than your account.
  foreach spec in array array[
    'account_requests:email', 'pending_members:email', 'professional_requests:email', 'sankofa_mentor_applications:email',
    'email_log:recipient_email', 'account_request_emails:recipient', 'professional_request_emails:recipient', 'event_feedback:guest_email',
    'sankofa_guest_mentors:email'
  ] loop
    parts := string_to_array(spec, ':');
    rows_ := public.privacy__rows(parts[1], parts[2], em, true);
    if rows_ is not null and jsonb_array_length(rows_) > 0 then
      out := out || jsonb_build_object(parts[1] || '_by_email', rows_);
    end if;
  end loop;
  return out;
end;
$$;
revoke all on function public.privacy__export(uuid) from public, anon, authenticated;

-- A signed-in person downloads their own data.
create or replace function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  return public.privacy__export(auth.uid());
end;
$$;

-- The president fulfils an access request (after checking the person's identity).
create or replace function public.president_export_user_data(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_president() then raise exception 'Not authorized'; end if;
  return public.privacy__export(p_user);
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Erase a person (president only). Returns what was done and what still needs a human.
create or replace function public.president_erase_user(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  em text;
  nm text;
  n bigint;
  deleted jsonb := '{}'::jsonb;
  review jsonb := '[]'::jsonb;
  t text;
begin
  if not public.is_president() then raise exception 'Not authorized'; end if;
  if p_user is null then raise exception 'Choose a person.'; end if;
  if p_user = auth.uid() or p_user = '22044cd2-6804-4142-96c4-5c475ce9347a'::uuid then
    raise exception 'The president''s own account can''t be erased from here.';
  end if;
  select lower(u.email::text) into em from auth.users u where u.id = p_user;
  if em is null then raise exception 'No account found for that person.'; end if;
  nm := coalesce(
    (select m.full_name from public.members m where m.id = p_user),
    (select np.full_name from public.network_professionals np where np.user_id = p_user limit 1),
    (select pr.full_name from public.professional_requests pr where pr.auth_user_id = p_user limit 1));

  -- Copies kept against their email address (not linked to the login).
  foreach t in array array['account_request_emails:recipient', 'professional_request_emails:recipient', 'email_log:recipient_email', 'member_email_log:recipient',
                           'sankofa_mentor_applications:email', 'pending_members:email', 'sankofa_guest_mentors:email'] loop
    if to_regclass('public.' || split_part(t, ':', 1)) is not null then
      execute format('delete from public.%I where lower(%I::text) = $1', split_part(t, ':', 1), split_part(t, ':', 2)) using em;
      get diagnostics n = row_count;
      if n > 0 then deleted := deleted || jsonb_build_object(split_part(t, ':', 1), n); end if;
    end if;
  end loop;
  -- Requests: their account request, professional request and any mentor application hold student number / job details.
  if to_regclass('public.account_requests') is not null then
    delete from public.account_requests where auth_user_id = p_user or lower(email) = em;
    get diagnostics n = row_count; if n > 0 then deleted := deleted || jsonb_build_object('account_requests', n); end if;
  end if;
  if to_regclass('public.professional_requests') is not null then
    delete from public.professional_requests where auth_user_id = p_user or lower(email) = em;
    get diagnostics n = row_count; if n > 0 then deleted := deleted || jsonb_build_object('professional_requests', n); end if;
  end if;
  -- Nominations about them are theirs too (the nominator's own copy goes with the nominator's account).
  if to_regclass('public.motm_nominations') is not null then
    delete from public.motm_nominations where nominee_user_id = p_user;
    get diagnostics n = row_count; if n > 0 then deleted := deleted || jsonb_build_object('nominations_about_them', n); end if;
  end if;
  if to_regclass('public.network_join_events') is not null then
    begin
      delete from public.network_join_events where member_id = p_user or professional_id::text in (select np.id::text from public.network_professionals np where np.user_id = p_user);
    exception when undefined_column then
      delete from public.network_join_events where member_id = p_user;
    end;
  end if;
  -- Their network profile (the link to the login is "set null", so the row would otherwise survive).
  if to_regclass('public.network_professionals') is not null then
    delete from public.network_professionals where user_id = p_user;
    get diagnostics n = row_count; if n > 0 then deleted := deleted || jsonb_build_object('network_profile', n); end if;
  end if;
  -- Anonymous feedback may stay, but without anything that points back to them.
  if to_regclass('public.event_feedback') is not null then
    update public.event_feedback set user_id = null, respondent = null, guest_email = null, guest_name = null, member_course = null, member_year = null
    where user_id = p_user or lower(coalesce(guest_email, '')) = em;
    get diagnostics n = row_count; if n > 0 then deleted := deleted || jsonb_build_object('feedback_made_anonymous', n); end if;
  end if;
  -- Files / contributions they made stay available to others but lose their name.
  if to_regclass('public.resources') is not null then
    select count(*) into n from public.resources where uploader_id = p_user;
    if n > 0 then
      update public.resources set uploader_name = 'Former member', uploader_detail = null where uploader_id = p_user;
      review := review || to_jsonb(n || ' resource(s) they uploaded were kept but their name was removed. If they asked for the files themselves to go, delete them in Dashboard -> Resources (and the file in Supabase Storage).');
    end if;
  end if;
  if to_regclass('public.chat_reports') is not null then
    select count(*) into n from public.chat_reports where reporter_id = p_user or reported_id = p_user;
    if n > 0 then
      review := review || to_jsonb(n || ' chat report(s) involving them were kept without their identity, as safeguarding and moderation records (a legal and legitimate-interest exemption to erasure). Delete them in Dashboard -> Chat reports once resolved if you no longer need them.');
    end if;
  end if;
  -- Public pages that show a name but aren't linked to a login.
  if nm is not null then
    if to_regclass('public.motm_winners') is not null then
      select count(*) into n from public.motm_winners where lower(full_name) = lower(nm);
      if n > 0 then review := review || to_jsonb('"' || nm || '" appears on the Member of the Month winners wall (' || n || ' entry). Remove or edit it in Dashboard -> Member of the Month.'); end if;
    end if;
    if to_regclass('public.committee_members') is not null then
      select count(*) into n from public.committee_members where lower(full_name) = lower(nm);
      if n > 0 then review := review || to_jsonb('"' || nm || '" appears on the public committee page. Remove or edit it in Dashboard -> Committee.'); end if;
    end if;
  end if;
  if to_regclass('public.view_as_log') is not null then
    delete from public.view_as_log where target_id = p_user;
  end if;
  -- Record of the request being fulfilled, without the person's details.
  update public.compliance_requests set user_id = null, name = null, email = 'erased@erased.invalid',
    details = case when details is null then null else '[erased]' end
  where user_id = p_user or lower(email) = em;

  -- The login itself. Everything that references it with "on delete cascade" (membership,
  -- profile, Sankofa Hub records, comments, messages they sent, XP, badges ...) goes with it.
  delete from auth.users where id = p_user;
  deleted := deleted || jsonb_build_object('login_and_linked_records', 1);

  return jsonb_build_object('erased', coalesce(nm, em), 'deleted', deleted, 'still_to_check', review);
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Retention. Each step is independent: if one table isn't there it is skipped.
create or replace function public.privacy_purge_expired()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  res jsonb := '{}'::jsonb;
  n bigint;
  step record;
begin
  -- Called by the president, or by the database's own scheduler (no signed-in user).
  if auth.uid() is not null and not public.is_president() then raise exception 'Not authorized'; end if;
  for step in
    select * from (values
      ('page_views',              'delete from public.page_views where viewed_at < now() - interval ''14 months'''),
      ('qr_scans',                'delete from public.qr_scans where scanned_at < now() - interval ''14 months'''),
      ('resource_pin_attempts',   'delete from public.resource_pin_attempts where created_at < now() - interval ''30 days'''),
      ('resource_events',         'delete from public.resource_events where created_at < now() - interval ''24 months'''),
      ('view_as_log',             'delete from public.view_as_log where created_at < now() - interval ''12 months'''),
      ('email_log',               'delete from public.email_log where created_at < now() - interval ''24 months'''),
      ('member_email_log',        'delete from public.member_email_log where created_at < now() - interval ''24 months'''),
      ('account_request_emails',  'delete from public.account_request_emails where created_at < now() - interval ''24 months'''),
      ('professional_request_emails', 'delete from public.professional_request_emails where created_at < now() - interval ''24 months'''),
      ('sankofa_application_emails', 'delete from public.sankofa_application_emails where created_at < now() - interval ''24 months'''),
      ('account_requests',        'delete from public.account_requests where status <> ''pending'' and coalesce(reviewed_at, created_at) < now() - interval ''12 months'''),
      ('professional_requests',   'delete from public.professional_requests where status <> ''pending'' and coalesce(reviewed_at, created_at) < now() - interval ''12 months'''),
      ('sankofa_mentor_applications', 'delete from public.sankofa_mentor_applications where created_at < now() - interval ''24 months'''),
      ('chat_messages_deleted',   'delete from public.chat_messages where deleted_at is not null and deleted_at < now() - interval ''30 days'''),
      ('chat_reports_closed',     'delete from public.chat_reports where status in (''resolved'', ''dismissed'') and coalesce(resolved_at, created_at) < now() - interval ''24 months'''),
      ('compliance_requests',     'delete from public.compliance_requests where status in (''completed'', ''refused'', ''withdrawn'') and coalesce(handled_at, created_at) < now() - interval ''3 years''')
    ) as v(label, sql)
  loop
    begin
      execute step.sql;
      get diagnostics n = row_count;
      res := res || jsonb_build_object(step.label, n);
    exception when undefined_table or undefined_column then
      res := res || jsonb_build_object(step.label, 'skipped');
    end;
  end loop;
  return res;
end;
$$;

-- Accounts nobody has signed in to for a long time (default 12 months) - for the president to review.
create or replace function public.privacy_inactive_accounts(p_months integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_president() then raise exception 'Not authorized'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', u.id, 'email', u.email,
      'name', coalesce(m.full_name, np.full_name),
      'kind', case when m.id is not null then 'member' when np.id is not null then 'professional' else 'account' end,
      'last_seen', coalesce(u.last_sign_in_at, u.created_at)) order by coalesce(u.last_sign_in_at, u.created_at))
    from auth.users u
    left join public.members m on m.id = u.id
    left join lateral (select * from public.network_professionals q where q.user_id = u.id limit 1) np on true
    where coalesce(u.last_sign_in_at, u.created_at) < now() - make_interval(months => greatest(coalesce(p_months, 12), 1))
      and u.id <> '22044cd2-6804-4142-96c4-5c475ce9347a'::uuid
      and coalesce(m.member_type, '') <> 'executive_committee'
  ), '[]'::jsonb);
end;
$$;

-- Run the clean-up every night at 03:30 if the database's scheduler (pg_cron) is switched on.
-- (Supabase: Database -> Extensions -> pg_cron.) If it isn't, the president can run it from
-- Dashboard -> Data & Privacy -> "Run clean-up now", and should do so at least monthly.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('lacms-privacy-purge');
    exception when others then null;
    end;
    perform cron.schedule('lacms-privacy-purge', '30 3 * * *', 'select public.privacy_purge_expired()');
  end if;
exception when others then
  raise notice 'Could not schedule the nightly clean-up (%): run it from the dashboard instead.', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Email preferences
create table if not exists public.email_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  updates_opt_out boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.email_preferences enable row level security;
revoke all on public.email_preferences from anon, authenticated;

create or replace function public.privacy_get_email_prefs()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('updates_opt_out', coalesce((select p.updates_opt_out from public.email_preferences p where p.user_id = auth.uid()), false));
$$;

create or replace function public.privacy_set_email_prefs(p_updates_opt_out boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  insert into public.email_preferences (user_id, updates_opt_out, updated_at) values (auth.uid(), coalesce(p_updates_opt_out, false), now())
  on conflict (user_id) do update set updates_opt_out = excluded.updates_opt_out, updated_at = now();
end;
$$;

-- For the email centre: the addresses that have opted out of non-essential updates.
create or replace function public.president_email_opt_outs()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_president() then raise exception 'Not authorized'; end if;
  return coalesce((select jsonb_agg(lower(u.email::text)) from public.email_preferences p join auth.users u on u.id = p.user_id where p.updates_opt_out), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Which version of the privacy notice each person has seen
create table if not exists public.privacy_acknowledgements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  version text not null,
  acknowledged_at timestamptz not null default now()
);
alter table public.privacy_acknowledgements enable row level security;
revoke all on public.privacy_acknowledgements from anon, authenticated;

create or replace function public.privacy_ack_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select jsonb_build_object('version', a.version, 'at', a.acknowledged_at) from public.privacy_acknowledgements a where a.user_id = auth.uid()), '{}'::jsonb);
$$;

create or replace function public.privacy_acknowledge(p_version text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  if p_version is null or char_length(p_version) not between 1 and 40 then raise exception 'Unknown version.'; end if;
  insert into public.privacy_acknowledgements (user_id, version, acknowledged_at) values (auth.uid(), p_version, now())
  on conflict (user_id) do update set version = excluded.version, acknowledged_at = now();
end;
$$;

-- ---------------------------------------------------------------------
-- Who can call what
revoke all on function public.submit_compliance_request(text, text, text, text) from public;
revoke all on function public.my_compliance_requests() from public, anon;
revoke all on function public.president_list_compliance_requests() from public, anon;
revoke all on function public.president_update_compliance_request(uuid, text, text) from public, anon;
revoke all on function public.export_my_data() from public, anon;
revoke all on function public.president_erase_user(uuid) from public, anon;
revoke all on function public.president_export_user_data(uuid) from public, anon;
revoke all on function public.privacy_purge_expired() from public, anon;
revoke all on function public.privacy_inactive_accounts(integer) from public, anon;
revoke all on function public.privacy_get_email_prefs() from public, anon;
revoke all on function public.privacy_set_email_prefs(boolean) from public, anon;
revoke all on function public.president_email_opt_outs() from public, anon;
revoke all on function public.privacy_ack_status() from public, anon;
revoke all on function public.privacy_acknowledge(text) from public, anon;

grant execute on function public.submit_compliance_request(text, text, text, text) to anon, authenticated;
grant execute on function public.my_compliance_requests() to authenticated;
grant execute on function public.president_list_compliance_requests() to authenticated;
grant execute on function public.president_update_compliance_request(uuid, text, text) to authenticated;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.president_erase_user(uuid) to authenticated;
grant execute on function public.president_export_user_data(uuid) to authenticated;
grant execute on function public.privacy_purge_expired() to authenticated;
grant execute on function public.privacy_inactive_accounts(integer) to authenticated;
grant execute on function public.privacy_get_email_prefs() to authenticated;
grant execute on function public.privacy_set_email_prefs(boolean) to authenticated;
grant execute on function public.president_email_opt_outs() to authenticated;
grant execute on function public.privacy_ack_status() to authenticated;
grant execute on function public.privacy_acknowledge(text) to authenticated;

commit;
