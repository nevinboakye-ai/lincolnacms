-- 102: The committee's QR code studio (Dashboard -> QR codes)
--
-- Design a QR code (colours, shapes, a logo in the middle, a caption), point it at any
-- link, and keep it in a library. Two kinds:
--   * "direct"  - the code holds the link itself. Nothing to maintain; no scan count.
--   * "tracked" - the code holds a short LACMS address (go.html?c=xxxxxxx). The page looks
--                 the real destination up here, counts the scan and sends the person on.
--                 You can change where it points (or pause it) after it's printed, and see
--                 how many scans it gets and when.
-- Only the committee can create, change or read codes. Scanning (qr_resolve) is open to
-- everyone because the person scanning has no account.
--
-- Privacy and safety:
--   * A scan stores the time and a rough device type (iPhone / Android / computer / other).
--     Nothing that identifies a person.
--   * A tracked code can only point to http(s) links, never to javascript: or similar.
--   * Paused or deleted tracked codes stop redirecting immediately.
--
-- Who can use it: Hub Access -> "Dashboard: QR codes" (the Executive Committee by default;
-- the president can share it or take it away).
--
-- Safe to run more than once. Needs 060 and 061.

begin;

-- ---------------------------------------------------------------------
-- 1. Tables
create table if not exists public.qr_codes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  kind text not null default 'link' check (kind in ('link', 'event', 'wifi', 'email', 'phone', 'text')),
  mode text not null default 'tracked' check (mode in ('direct', 'tracked')),
  code text unique,
  payload text not null check (char_length(payload) between 1 and 2000),
  design jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  scan_count integer not null default 0,
  last_scan_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qr_codes_design_size check (pg_column_size(design) < 400000),
  constraint qr_codes_tracked_has_code check (mode = 'direct' or code is not null)
);

create table if not exists public.qr_scans (
  id bigint generated always as identity primary key,
  qr_id uuid not null references public.qr_codes (id) on delete cascade,
  scanned_at timestamptz not null default now(),
  device text not null default 'other' check (device in ('ios', 'android', 'desktop', 'other'))
);
create index if not exists qr_scans_qr_idx on public.qr_scans (qr_id, scanned_at desc);

alter table public.qr_codes enable row level security;
alter table public.qr_scans enable row level security;
revoke all on public.qr_codes, public.qr_scans from anon, authenticated;
-- (no policies on purpose: only the functions below can read or change them)

-- ---------------------------------------------------------------------
-- 2. Who manages them
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
      'dash_sitestats', 'dash_create', 'dash_manage', 'dash_email', 'dash_feedback', 'dash_partners', 'dash_qr'
    ])
  ) x;
  alter table public.hub_access_rules drop constraint if exists hub_access_rules_feature_check;
  execute 'alter table public.hub_access_rules add constraint hub_access_rules_feature_check check (feature in (' || names || '))';
end;
$$;

insert into public.hub_access_rules (feature, allow_members, allow_professionals, member_types, courses, titles, blocked_display)
values ('dash_qr', true, false, array['executive_committee'], null, null, 'hidden')
on conflict (feature) do nothing;

create or replace function public.qr_can_manage()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_president(), false) or coalesce(public.has_hub_access('dash_qr'), false);
$$;
revoke all on function public.qr_can_manage() from public, anon;
grant execute on function public.qr_can_manage() to authenticated;

-- ---------------------------------------------------------------------
-- 3. Scanning (open to everyone)
create or replace function public.qr_resolve(p_code text, p_device text default 'other')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.qr_codes;
  dev text := case when p_device in ('ios', 'android', 'desktop') then p_device else 'other' end;
begin
  select * into q from public.qr_codes c where c.code = btrim(coalesce(p_code, '')) and c.mode = 'tracked';
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  if not q.is_active then return jsonb_build_object('ok', false, 'reason', 'paused'); end if;
  if q.payload !~* '^https?://' then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  insert into public.qr_scans (qr_id, device) values (q.id, dev);
  update public.qr_codes set scan_count = scan_count + 1, last_scan_at = now() where id = q.id;
  return jsonb_build_object('ok', true, 'url', q.payload);
end;
$$;
revoke all on function public.qr_resolve(text, text) from public;
grant execute on function public.qr_resolve(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. The committee's library
create or replace function public.qr_list()
returns table (
  id uuid, name text, kind text, mode text, code text, payload text, design jsonb, is_active boolean,
  scan_count integer, last_scan_at timestamptz, created_at timestamptz, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.qr_can_manage() then raise exception 'Not authorized'; end if;
  return query
    select c.id, c.name, c.kind, c.mode, c.code, c.payload, c.design, c.is_active,
           c.scan_count, c.last_scan_at, c.created_at, c.updated_at
    from public.qr_codes c order by c.created_at desc;
end;
$$;

create or replace function public.qr_save(p_id uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  nm text := btrim(coalesce(p_data ->> 'name', ''));
  kd text := coalesce(p_data ->> 'kind', 'link');
  md text := coalesce(p_data ->> 'mode', 'tracked');
  pl text := btrim(coalesce(p_data ->> 'payload', ''));
  dg jsonb := coalesce(p_data -> 'design', '{}'::jsonb);
  c text;
  tries integer := 0;
  new_id uuid := p_id;
  existing public.qr_codes;
begin
  if not public.qr_can_manage() then raise exception 'Not authorized'; end if;
  if nm = '' or char_length(nm) > 80 then raise exception 'Give the QR code a name (up to 80 characters).'; end if;
  if kd not in ('link', 'event', 'wifi', 'email', 'phone', 'text') then raise exception 'Unknown kind of code.'; end if;
  if md not in ('direct', 'tracked') then raise exception 'Unknown mode.'; end if;
  if pl = '' or char_length(pl) > 2000 then raise exception 'Add what the code should contain (up to 2000 characters).'; end if;
  if jsonb_typeof(dg) <> 'object' then raise exception 'The design is not valid.'; end if;
  if pg_column_size(dg) >= 400000 then raise exception 'The design is too large - use a smaller logo image.'; end if;
  -- A tracked code redirects people, so it may only go to a web address.
  if md = 'tracked' and pl !~* '^https?://[^\s]+$' then
    raise exception 'A tracked code needs a link starting with http:// or https://.';
  end if;

  if p_id is null then
    if md = 'tracked' then
      loop
        c := substr(md5(random()::text || clock_timestamp()::text), 1, 7);
        exit when not exists (select 1 from public.qr_codes x where x.code = c);
        tries := tries + 1;
        if tries > 20 then raise exception 'Could not make a short code - try again.'; end if;
      end loop;
    end if;
    insert into public.qr_codes (name, kind, mode, code, payload, design, created_by)
    values (nm, kd, md, c, pl, dg, auth.uid())
    returning id into new_id;
  else
    select * into existing from public.qr_codes x where x.id = p_id;
    if not found then raise exception 'That QR code no longer exists.'; end if;
    -- A code that has been printed keeps its short address, so changing the mode isn't allowed
    -- for a tracked code (the printed one would stop working).
    if existing.mode = 'tracked' and md <> 'tracked' then
      raise exception 'A tracked code can not become a direct one - make a new code instead.';
    end if;
    if existing.mode = 'direct' and md = 'tracked' then
      loop
        c := substr(md5(random()::text || clock_timestamp()::text), 1, 7);
        exit when not exists (select 1 from public.qr_codes x where x.code = c);
      end loop;
    else
      c := existing.code;
    end if;
    update public.qr_codes set name = nm, kind = kd, mode = md, code = c, payload = pl, design = dg, updated_at = now() where id = p_id;
  end if;
  return jsonb_build_object('id', new_id, 'code', (select q.code from public.qr_codes q where q.id = new_id));
end;
$$;

create or replace function public.qr_set_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.qr_can_manage() then raise exception 'Not authorized'; end if;
  update public.qr_codes set is_active = coalesce(p_active, false), updated_at = now() where id = p_id;
end;
$$;

create or replace function public.qr_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.qr_can_manage() then raise exception 'Not authorized'; end if;
  delete from public.qr_codes where id = p_id;
end;
$$;

-- Scans for one code: per day for the last 60 days, and by device.
create or replace function public.qr_stats(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.qr_can_manage() then raise exception 'Not authorized'; end if;
  return jsonb_build_object(
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('d', x.d, 'n', x.n) order by x.d) from (
        select to_char(s.scanned_at at time zone 'Europe/London', 'YYYY-MM-DD') as d, count(*) as n
        from public.qr_scans s
        where s.qr_id = p_id and s.scanned_at > now() - interval '60 days'
        group by 1) x), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_object_agg(y.device, y.n) from (
        select s.device, count(*) as n from public.qr_scans s where s.qr_id = p_id group by s.device) y), '{}'::jsonb),
    'first_scan', (select min(s.scanned_at) from public.qr_scans s where s.qr_id = p_id)
  );
end;
$$;

revoke all on function public.qr_list() from public, anon;
revoke all on function public.qr_save(uuid, jsonb) from public, anon;
revoke all on function public.qr_set_active(uuid, boolean) from public, anon;
revoke all on function public.qr_delete(uuid) from public, anon;
revoke all on function public.qr_stats(uuid) from public, anon;
grant execute on function public.qr_list() to authenticated;
grant execute on function public.qr_save(uuid, jsonb) to authenticated;
grant execute on function public.qr_set_active(uuid, boolean) to authenticated;
grant execute on function public.qr_delete(uuid) to authenticated;
grant execute on function public.qr_stats(uuid) to authenticated;

commit;
