-- 098: give anyone access to any tile of the Platform Activity Dashboard
--
-- Until now only six tiles could be shared (MMG, Sankofa applications, Nominations,
-- Events, Gallery, and the Sankofa Hub Circle manager). Everything else - User
-- Activity, Website Activity, Account Requests, Pending Members, Chat Reports,
-- Site numbers, Create Accounts, Manage Accounts and the new Email tile - was the
-- president's alone, in the database as well as on the page.
--
-- This adds one Hub Access feature per tile, closed to everyone by default (so
-- nothing changes until you choose), and you grant a tile to a person in
-- Dashboard -> Hub Access (click a cell in the person-by-person grid, or open the
-- tile's rule to give it to a whole role). Not shareable, ever: the Hub Access
-- page itself (anyone who could edit access could give themselves anything) and
-- "View site as".
--
--   dash_activity     User Activity (who's online, who needs a nudge)
--   dash_webactivity  Website Activity (traffic)
--   dash_requests     Account Requests (students and professionals)
--   dash_pending      Pending Members
--   dash_chatreports  Chat Reports
--   dash_sitestats    Site numbers (the headline statistics on the homepage)
--   dash_create       Create Accounts
--   dash_manage       Manage Accounts (edit or remove anyone)
--   dash_email        Email (write to chosen people, and see what's been sent)
--
-- The database does the enforcing, not just the page: each tile's functions and
-- table rules are changed from "the president only" to "the president, or whoever
-- has that tile". This is done by rewriting the functions and policies that are
-- actually installed (so it works whatever order earlier migrations ran in). It
-- only touches the ones listed below, and running it again changes nothing. If you
-- ever re-run an old migration that defines one of them (063, 070, 035, ...), run
-- this file again afterwards.
--
-- Also: emailing from the dashboard is allowed for anyone with the Email, Account
-- Requests or Sankofa tile (can_send_dashboard_email), which the send-account-email
-- Edge Function checks - redeploy it (README section 151).
--
-- Safe to run more than once. Needs 060, 061 and the migrations that created the
-- functions and tables named below (any that don't exist are simply skipped).

begin;

-- ---------------------------------------------------------------------
-- 1. The new features, closed by default.
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
      'dash_mmg', 'dash_sankofa', 'dash_motm', 'dash_events', 'dash_gallery',
      'dash_activity', 'dash_webactivity', 'dash_requests', 'dash_pending', 'dash_chatreports',
      'dash_sitestats', 'dash_create', 'dash_manage', 'dash_email'
    ])
  ) x;
  alter table public.hub_access_rules drop constraint if exists hub_access_rules_feature_check;
  execute 'alter table public.hub_access_rules add constraint hub_access_rules_feature_check check (feature in (' || names || '))';
end;
$$;

insert into public.hub_access_rules (feature, allow_members, allow_professionals, member_types, courses, titles, blocked_display)
values
  ('dash_activity',    false, false, null, null, null, 'hidden'),
  ('dash_webactivity', false, false, null, null, null, 'hidden'),
  ('dash_requests',    false, false, null, null, null, 'hidden'),
  ('dash_pending',     false, false, null, null, null, 'hidden'),
  ('dash_chatreports', false, false, null, null, null, 'hidden'),
  ('dash_sitestats',   false, false, null, null, null, 'hidden'),
  ('dash_create',      false, false, null, null, null, 'hidden'),
  ('dash_manage',      false, false, null, null, null, 'hidden'),
  ('dash_email',       false, false, null, null, null, 'hidden')
on conflict (feature) do nothing;

-- ---------------------------------------------------------------------
-- 2. Helpers. The president always passes (has_hub_access() already says so).
create or replace function public.dash_can(p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_president(), false) or coalesce(public.has_hub_access(p_feature), false);
$$;

create or replace function public.dash_can_any(p_features text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_president(), false)
      or exists (select 1 from unnest(p_features) f where coalesce(public.has_hub_access(f), false));
$$;

-- Who may send an email from the dashboard (checked by the send-account-email function).
create or replace function public.can_send_dashboard_email()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.dash_can_any(array['dash_email', 'dash_requests', 'dash_sankofa']);
$$;

-- The page asks this to decide which tiles to show.
create or replace function public.dash_access(p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.dash_can(p_feature);
$$;

revoke all on function public.dash_can(text) from public, anon;
revoke all on function public.dash_can_any(text[]) from public, anon;
revoke all on function public.can_send_dashboard_email() from public, anon;
revoke all on function public.dash_access(text) from public, anon;
grant execute on function public.dash_can(text) to authenticated;
grant execute on function public.dash_can_any(text[]) to authenticated;
grant execute on function public.can_send_dashboard_email() to authenticated;
grant execute on function public.dash_access(text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Site numbers: someone with the tile can change the headline numbers only, never the
-- other site settings (the Network launch switch, the MMG switch...).
drop policy if exists "Site numbers editors can manage the headline numbers" on public.site_settings;
create policy "Site numbers editors can manage the headline numbers"
  on public.site_settings for all to authenticated
  using (
    key in ('active_member_count', 'show_active_member_count', 'stat_mentors', 'stat_events_per_year', 'stat_founded',
            'impact_students', 'impact_disciplines', 'impact_professionals')
    and public.has_hub_access('dash_sitestats')
  )
  with check (
    key in ('active_member_count', 'show_active_member_count', 'stat_mentors', 'stat_events_per_year', 'stat_founded',
            'impact_students', 'impact_disciplines', 'impact_professionals')
    and public.has_hub_access('dash_sitestats')
  );

-- ---------------------------------------------------------------------
-- 4. Rewrite the guards on the installed functions.
-- (function, the guard to replace, the features that now unlock it)
do $$
declare
  guard_pres constant text := '(public\.)?is_president\(\)';
  guard_sk constant text := '(public\.)?has_hub_access\(''dash_sankofa''\)';
  spec record;
  fn record;
  def text;
  newdef text;
  repl text;
begin
  for spec in
    select * from (values
      ('president_get_members',                 guard_pres, array['dash_activity', 'dash_manage', 'dash_email']),
      ('president_get_professionals',           guard_pres, array['dash_activity', 'dash_manage', 'dash_email']),
      ('president_get_pending_members',         guard_pres, array['dash_activity', 'dash_pending', 'dash_manage']),
      ('president_get_pending_members_detailed', guard_pres, array['dash_pending', 'dash_manage']),
      ('president_add_pending_member',          guard_pres, array['dash_pending', 'dash_manage']),
      ('president_delete_pending_member',       guard_pres, array['dash_pending', 'dash_manage']),
      ('president_set_pending_visibility',      guard_pres, array['dash_pending', 'dash_manage']),
      ('president_remove_pending_duplicates',   guard_pres, array['dash_pending', 'dash_manage']),
      ('president_lookup_names',                guard_pres, array['dash_pending', 'dash_manage']),
      ('president_mark_activated',              guard_pres, array['dash_manage']),
      ('president_activity_summary',            guard_pres, array['dash_webactivity']),
      ('president_activity_series',             guard_pres, array['dash_webactivity']),
      ('president_activity_top_pages',          guard_pres, array['dash_webactivity']),
      ('president_get_account_requests',        guard_pres, array['dash_requests', 'dash_email']),
      ('president_set_account_request_paid',    guard_pres, array['dash_requests']),
      ('president_reject_account_request',      guard_pres, array['dash_requests']),
      ('president_delete_account_request',      guard_pres, array['dash_requests']),
      ('president_mark_account_request_approved', guard_pres, array['dash_requests']),
      ('president_get_professional_requests',   guard_pres, array['dash_requests', 'dash_email']),
      ('president_reject_professional_request', guard_pres, array['dash_requests']),
      ('president_delete_professional_request', guard_pres, array['dash_requests']),
      ('president_mark_professional_request_approved', guard_pres, array['dash_requests']),
      ('president_get_chat_reports',            guard_pres, array['dash_chatreports']),
      ('president_resolve_chat_report',         guard_pres, array['dash_chatreports']),
      ('president_set_chat_suspension',         guard_pres, array['dash_chatreports']),
      -- The Email tile reads who it can write to from the Sankofa application lists too.
      ('president_get_sankofa_applications',        guard_sk, array['dash_sankofa', 'dash_email']),
      ('president_get_sankofa_mentor_applications', guard_sk, array['dash_sankofa', 'dash_email']),
      ('president_get_sankofa_application_rounds',  guard_sk, array['dash_sankofa', 'dash_email'])
    ) as t(name, guard, features)
  loop
    select 'public.dash_can_any(array[' || string_agg(quote_literal(f), ', ') || '])' into repl from unnest(spec.features) f;
    for fn in
      select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = spec.name
    loop
      def := pg_get_functiondef(fn.oid);
      newdef := regexp_replace(def, spec.guard, repl, 'g');
      if newdef <> def then
        execute newdef;
      end if;
    end loop;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Rewrite the "president only" table rules the same way.
-- (table, which kind of rule: r = read, a = add, w = change, d = remove, * = all, the features)
do $$
declare
  spec record;
  pol record;
  newq text;
  newwc text;
  repl text;
begin
  for pol in
    select p.polname, c.relname, p.polcmd::text as cmd,
           pg_get_expr(p.polqual, p.polrelid) as q,
           pg_get_expr(p.polwithcheck, p.polrelid) as wc
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~ 'is_president\(\)'
           or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ 'is_president\(\)')
  loop
    select s.features into spec
    from (values
      ('members', 'r', array['dash_activity', 'dash_manage', 'dash_pending', 'dash_requests', 'dash_email']),
      ('members', 'a', array['dash_create', 'dash_requests']),
      ('members', 'w', array['dash_manage']),
      ('members', 'd', array['dash_manage']),
      ('members', '*', array['dash_manage', 'dash_create']),
      ('network_professionals', 'r', array['dash_activity', 'dash_manage', 'dash_requests', 'dash_email']),
      ('network_professionals', 'a', array['dash_create', 'dash_requests']),
      ('network_professionals', 'w', array['dash_manage']),
      ('network_professionals', 'd', array['dash_manage']),
      ('network_professionals', '*', array['dash_manage', 'dash_create']),
      ('mmg_guests', 'r', array['dash_activity', 'dash_manage']),
      ('mmg_guests', 'a', array['dash_create']),
      ('mmg_guests', 'w', array['dash_manage']),
      ('mmg_guests', 'd', array['dash_manage']),
      ('mmg_guests', '*', array['dash_manage', 'dash_create']),
      ('member_presence', 'r', array['dash_activity', 'dash_manage']),
      ('pending_members', '*', array['dash_pending', 'dash_manage']),
      ('pending_members', 'r', array['dash_pending', 'dash_manage', 'dash_activity']),
      ('pending_members', 'a', array['dash_pending', 'dash_manage']),
      ('pending_members', 'w', array['dash_pending', 'dash_manage']),
      ('pending_members', 'd', array['dash_pending', 'dash_manage']),
      ('account_requests', '*', array['dash_requests']),
      ('account_requests', 'r', array['dash_requests', 'dash_email']),
      ('account_requests', 'w', array['dash_requests']),
      ('account_requests', 'd', array['dash_requests']),
      ('account_request_emails', 'r', array['dash_requests', 'dash_email']),
      ('account_request_emails', 'a', array['dash_requests', 'dash_email']),
      ('account_request_emails', '*', array['dash_requests', 'dash_email']),
      ('account_email_templates', '*', array['dash_requests', 'dash_email', 'dash_sankofa']),
      ('professional_request_emails', 'r', array['dash_requests', 'dash_email']),
      ('professional_request_emails', 'a', array['dash_requests', 'dash_email']),
      ('email_log', 'r', array['dash_email']),
      ('email_log', 'a', array['dash_email']),
      ('chat_reports', '*', array['dash_chatreports']),
      ('chat_reports', 'r', array['dash_chatreports']),
      ('chat_reports', 'w', array['dash_chatreports']),
      ('chat_suspensions', '*', array['dash_chatreports']),
      ('chat_suspensions', 'r', array['dash_chatreports']),
      ('chat_suspensions', 'a', array['dash_chatreports']),
      ('chat_suspensions', 'w', array['dash_chatreports']),
      ('chat_suspensions', 'd', array['dash_chatreports'])
    ) as s(tbl, cmd, features)
    where s.tbl = pol.relname and s.cmd = pol.cmd;

    if spec.features is null then
      continue;   -- not one of the tables a tile uses: left exactly as it is
    end if;
    select 'public.dash_can_any(array[' || string_agg(quote_literal(f), ', ') || '])' into repl from unnest(spec.features) f;
    newq := case when pol.q is null then null else regexp_replace(pol.q, '(public\.)?is_president\(\)', repl, 'g') end;
    newwc := case when pol.wc is null then null else regexp_replace(pol.wc, '(public\.)?is_president\(\)', repl, 'g') end;
    execute format('alter policy %I on public.%I%s%s', pol.polname, pol.relname,
      case when newq is not null then ' using (' || newq || ')' else '' end,
      case when newwc is not null then ' with check (' || newwc || ')' else '' end);
  end loop;
end;
$$;

commit;
