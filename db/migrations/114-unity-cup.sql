-- 114: Unity Cup portal - Player of the Tournament vote, charity raffle, shared media
--
-- A public (no account needed) portal for the Unity Cup football tournament. Everything the public
-- does goes through the functions below; none of these tables can be read or written directly.
--
-- 1. PLAYER OF THE TOURNAMENT VOTE. One vote per email address. The voter's email is only ever kept as
--    a salted one-way hash in unity_voters, and the ballot is just a counter on the player, so there is
--    NO record anywhere of who voted for whom. Spam is limited by: a 6-digit code emailed to the address
--    (proves it is a real inbox they can read; can be switched off in an emergency), one vote per
--    address (Gmail dots and +tags are ignored so aliases do not give extra votes), throwaway email
--    domains refused, per-address and site-wide request limits, and attempt limits on codes.
--
-- 2. CHARITY RAFFLE. People who have donated the minimum on the society's JustGiving page enter their
--    name and email (code-verified) and say what name the donation was made under. The committee checks
--    each entry against the JustGiving donation list, marks it verified, and draws a winner at random
--    from verified entries only. The site cannot see JustGiving donations itself, so that check is manual.
--
-- 3. MEDIA. Anyone can send photos and videos from the day. They go to a private bucket and are only shown
--    on the portal after a committee member approves them.
--
-- Data kept is deliberately small and is cleared by unity_purge() (see the privacy notice). Needs 037
-- (is_dashboard_admin). Safe to run more than once.

begin;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Settings (one row)
create table if not exists public.unity_settings (
  id int primary key default 1 check (id = 1),
  event_title text not null default 'LACMS Unity Cup',
  event_date date not null default date '2026-11-06',
  kickoff_text text,
  venue_text text,
  voting_open boolean not null default false,
  voting_closes_at timestamptz,
  show_results boolean not null default false,
  raffle_open boolean not null default false,
  raffle_closes_at timestamptz,
  media_open boolean not null default true,
  require_email_code boolean not null default true,
  min_donation numeric(6,2) not null default 2.50,
  prize_text text not null default '£25 gift card',
  justgiving_url text not null default 'https://www.justgiving.com/page/lincoln-african-caribbean-society-1?utm_medium=FA&utm_source=CL',
  salt text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  updated_at timestamptz not null default now()
);
insert into public.unity_settings (id) values (1) on conflict (id) do nothing;
alter table public.unity_settings enable row level security;
revoke all on public.unity_settings from anon, authenticated;

create table if not exists public.unity_players (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  team text check (team is null or char_length(team) <= 60),
  shirt_no text check (shirt_no is null or char_length(shirt_no) <= 6),
  sort int not null default 0,
  active boolean not null default true,
  votes int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.unity_players enable row level security;
revoke all on public.unity_players from anon, authenticated;

-- Who has voted (hash only, no choice) and the emailed codes (hash only).
create table if not exists public.unity_voters (
  email_hash text primary key,
  created_at timestamptz not null default date_trunc('hour', now())
);
alter table public.unity_voters enable row level security;
revoke all on public.unity_voters from anon, authenticated;

create table if not exists public.unity_codes (
  id bigserial primary key,
  email_hash text not null,
  purpose text not null check (purpose in ('vote', 'raffle')),
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  used boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists unity_codes_lookup on public.unity_codes (email_hash, purpose, created_at desc);
alter table public.unity_codes enable row level security;
revoke all on public.unity_codes from anon, authenticated;

create table if not exists public.unity_raffle_entries (
  id uuid primary key default gen_random_uuid(),
  ticket_no int generated always as identity,
  name text not null check (char_length(name) between 2 and 80),
  email text not null,
  email_hash text not null unique,
  donor_name text check (donor_name is null or char_length(donor_name) <= 80),
  amount numeric(8,2) not null,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  note text,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
alter table public.unity_raffle_entries enable row level security;
revoke all on public.unity_raffle_entries from anon, authenticated;

create table if not exists public.unity_raffle_draws (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid references public.unity_raffle_entries (id) on delete set null,
  ticket_no int not null,
  display_name text not null,
  prize text not null,
  drawn_at timestamptz not null default now(),
  voided_at timestamptz
);
alter table public.unity_raffle_draws enable row level security;
revoke all on public.unity_raffle_draws from anon, authenticated;

create table if not exists public.unity_media (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  kind text not null check (kind in ('image', 'video')),
  caption text check (caption is null or char_length(caption) <= 200),
  credit text check (credit is null or char_length(credit) <= 60),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  public_path text,
  created_at timestamptz not null default now(),
  approved_at timestamptz
);
create index if not exists unity_media_status on public.unity_media (status, created_at desc);
alter table public.unity_media enable row level security;
revoke all on public.unity_media from anon, authenticated;

-- ---------------------------------------------------------------------
-- Helpers (not callable by the public)
create or replace function public.unity_norm_email(p_email text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := lower(btrim(coalesce(p_email, '')));
  loc text; dom text;
begin
  if v = '' or position('@' in v) < 2 then return v; end if;
  loc := split_part(v, '@', 1);
  dom := substr(v, position('@' in v) + 1);
  if position('+' in loc) > 0 then loc := split_part(loc, '+', 1); end if;
  if dom in ('gmail.com', 'googlemail.com') then
    loc := replace(loc, '.', '');
    dom := 'gmail.com';
  end if;
  return loc || '@' || dom;
end;
$$;

create or replace function public.unity_email_ok(p_email text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_email is not null
     and char_length(p_email) <= 254
     and p_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$';
$$;

create or replace function public.unity_disposable(p_email text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select split_part(lower(btrim(coalesce(p_email, ''))), '@', 2) = any (array[
    'mailinator.com','guerrillamail.com','guerrillamail.net','guerrillamail.org','sharklasers.com','10minutemail.com',
    '10minutemail.net','tempmail.com','temp-mail.org','temp-mail.io','throwawaymail.com','yopmail.com','yopmail.fr',
    'trashmail.com','trashmail.net','getnada.com','nada.email','maildrop.cc','dispostable.com','fakeinbox.com',
    'mailnesia.com','mintemail.com','moakt.com','spamgourmet.com','tempinbox.com','tempail.com','emailondeck.com',
    'burnermail.io','mohmal.com','mytemp.email','inboxkitten.com','discard.email','grr.la','mailcatch.com'
  ]);
$$;

create or replace function public.unity_email_hash(p_email text)
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select encode(extensions.digest(public.unity_norm_email(p_email) || (select s.salt from public.unity_settings s where s.id = 1), 'sha256'), 'hex');
$$;

create or replace function public.unity_code_hash(p_email_hash text, p_code text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest(p_email_hash || ':' || coalesce(p_code, ''), 'sha256'), 'hex');
$$;

revoke all on function public.unity_norm_email(text) from public, anon, authenticated;
revoke all on function public.unity_email_ok(text) from public, anon, authenticated;
revoke all on function public.unity_disposable(text) from public, anon, authenticated;
revoke all on function public.unity_email_hash(text) from public, anon, authenticated;
revoke all on function public.unity_code_hash(text, text) from public, anon, authenticated;

-- Checks (and uses up) an emailed code. Returns null when fine, otherwise an error key. Attempts are
-- counted by returning normally (never by raising), so a wrong guess cannot be rolled back.
create or replace function public.unity_check_code(p_email_hash text, p_purpose text, p_code text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare c public.unity_codes%rowtype;
begin
  if p_code is null or p_code !~ '^[0-9]{6}$' then return 'bad_code'; end if;
  select * into c from public.unity_codes
   where email_hash = p_email_hash and purpose = p_purpose and used = false
   order by created_at desc limit 1
   for update;
  if not found then return 'no_code'; end if;
  if c.expires_at < now() then return 'code_expired'; end if;
  if c.attempts >= 5 then return 'too_many_attempts'; end if;
  if c.code_hash <> public.unity_code_hash(p_email_hash, p_code) then
    update public.unity_codes set attempts = attempts + 1 where id = c.id;
    return 'bad_code';
  end if;
  update public.unity_codes set used = true where id = c.id;
  return null;
end;
$$;
revoke all on function public.unity_check_code(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Public: everything the portal shows, in one call
create or replace function public.unity_get_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.unity_settings%rowtype;
  v_vote_open boolean; v_raffle_open boolean; v_total int;
begin
  select * into s from public.unity_settings where id = 1;
  v_vote_open := s.voting_open and (s.voting_closes_at is null or now() < s.voting_closes_at);
  v_raffle_open := s.raffle_open and (s.raffle_closes_at is null or now() < s.raffle_closes_at);
  select coalesce(sum(votes), 0) into v_total from public.unity_players where active;
  return jsonb_build_object(
    'now', now(),
    'event_title', s.event_title,
    'event_date', s.event_date,
    'kickoff_text', s.kickoff_text,
    'venue_text', s.venue_text,
    'voting_open', v_vote_open,
    'voting_closes_at', s.voting_closes_at,
    'show_results', s.show_results,
    'raffle_open', v_raffle_open,
    'raffle_closes_at', s.raffle_closes_at,
    'media_open', s.media_open,
    'require_email_code', s.require_email_code,
    'min_donation', s.min_donation,
    'prize_text', s.prize_text,
    'justgiving_url', s.justgiving_url,
    'total_votes', case when s.show_results then v_total else null end,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', p.name, 'team', p.team, 'shirt_no', p.shirt_no,
               'votes', case when s.show_results then p.votes else null end)
             order by case when s.show_results then p.votes else 0 end desc, p.sort, p.name)
        from public.unity_players p where p.active), '[]'::jsonb),
    'raffle_entries', (select count(*) from public.unity_raffle_entries e where e.status <> 'rejected'),
    'tickets', coalesce((select jsonb_agg(e.ticket_no order by e.ticket_no)
                           from (select ticket_no from public.unity_raffle_entries where status = 'verified' order by ticket_no limit 300) e), '[]'::jsonb),
    'draws', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'ticket_no', d.ticket_no, 'name', d.display_name, 'prize', d.prize, 'drawn_at', d.drawn_at) order by d.drawn_at desc)
                         from public.unity_raffle_draws d where d.voided_at is null), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(jsonb_build_object('path', m.public_path, 'kind', m.kind, 'caption', m.caption, 'credit', m.credit) order by m.approved_at desc)
                         from (select * from public.unity_media where status = 'approved' and public_path is not null order by approved_at desc limit 80) m), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.unity_get_state() from public;
grant execute on function public.unity_get_state() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Edge function only (service role): issue an emailed code. Never returns to the browser.
create or replace function public.unity_request_code(p_email text, p_purpose text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.unity_settings%rowtype;
  h text; v_code text; v_open boolean;
begin
  if p_purpose not in ('vote', 'raffle') then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  if not public.unity_email_ok(btrim(p_email)) then return jsonb_build_object('ok', false, 'error', 'bad_email'); end if;
  if public.unity_disposable(p_email) then return jsonb_build_object('ok', false, 'error', 'disposable'); end if;
  select * into s from public.unity_settings where id = 1;
  if p_purpose = 'vote' then
    v_open := s.voting_open and (s.voting_closes_at is null or now() < s.voting_closes_at);
  else
    v_open := s.raffle_open and (s.raffle_closes_at is null or now() < s.raffle_closes_at);
  end if;
  if not v_open then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  h := public.unity_email_hash(p_email);
  if p_purpose = 'vote' and exists (select 1 from public.unity_voters where email_hash = h) then
    return jsonb_build_object('ok', false, 'error', 'already_voted');
  end if;
  if p_purpose = 'raffle' and exists (select 1 from public.unity_raffle_entries where email_hash = h) then
    return jsonb_build_object('ok', false, 'error', 'already_entered');
  end if;
  if (select count(*) from public.unity_codes where email_hash = h and created_at > now() - interval '15 minutes') >= 3 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  if (select count(*) from public.unity_codes where created_at > now() - interval '10 minutes') >= 600 then
    return jsonb_build_object('ok', false, 'error', 'busy');
  end if;
  v_code := lpad((mod(('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint, 1000000))::text, 6, '0');
  insert into public.unity_codes (email_hash, purpose, code_hash, expires_at)
  values (h, p_purpose, public.unity_code_hash(h, v_code), now() + interval '10 minutes');
  return jsonb_build_object('ok', true, 'code', v_code);
end;
$$;
revoke all on function public.unity_request_code(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Public: cast a vote
create or replace function public.unity_cast_vote(p_email text, p_code text, p_player uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.unity_settings%rowtype;
  h text; v_err text; v_open boolean;
begin
  select * into s from public.unity_settings where id = 1;
  v_open := s.voting_open and (s.voting_closes_at is null or now() < s.voting_closes_at);
  if not v_open then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if not public.unity_email_ok(btrim(p_email)) then return jsonb_build_object('ok', false, 'error', 'bad_email'); end if;
  if public.unity_disposable(p_email) then return jsonb_build_object('ok', false, 'error', 'disposable'); end if;
  if not exists (select 1 from public.unity_players where id = p_player and active) then
    return jsonb_build_object('ok', false, 'error', 'bad_player');
  end if;
  h := public.unity_email_hash(p_email);
  if exists (select 1 from public.unity_voters where email_hash = h) then
    return jsonb_build_object('ok', false, 'error', 'already_voted');
  end if;
  if s.require_email_code then
    v_err := public.unity_check_code(h, 'vote', p_code);
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
  end if;
  begin
    insert into public.unity_voters (email_hash) values (h);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already_voted');
  end;
  update public.unity_players set votes = votes + 1 where id = p_player;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.unity_cast_vote(text, text, uuid) from public;
grant execute on function public.unity_cast_vote(text, text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Public: enter the raffle
create or replace function public.unity_enter_raffle(p_name text, p_email text, p_code text, p_donor_name text, p_amount numeric, p_confirm boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.unity_settings%rowtype;
  h text; v_err text; v_open boolean; v_ticket int; v_name text := btrim(coalesce(p_name, ''));
begin
  select * into s from public.unity_settings where id = 1;
  v_open := s.raffle_open and (s.raffle_closes_at is null or now() < s.raffle_closes_at);
  if not v_open then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then return jsonb_build_object('ok', false, 'error', 'bad_name'); end if;
  if not public.unity_email_ok(btrim(p_email)) then return jsonb_build_object('ok', false, 'error', 'bad_email'); end if;
  if public.unity_disposable(p_email) then return jsonb_build_object('ok', false, 'error', 'disposable'); end if;
  if p_confirm is not true then return jsonb_build_object('ok', false, 'error', 'not_confirmed'); end if;
  if p_amount is null or p_amount < s.min_donation or p_amount > 100000 then return jsonb_build_object('ok', false, 'error', 'amount_too_low'); end if;
  if (select count(*) from public.unity_raffle_entries where created_at > now() - interval '1 minute') >= 60 then
    return jsonb_build_object('ok', false, 'error', 'busy');
  end if;
  h := public.unity_email_hash(p_email);
  if exists (select 1 from public.unity_raffle_entries where email_hash = h) then
    return jsonb_build_object('ok', false, 'error', 'already_entered');
  end if;
  if s.require_email_code then
    v_err := public.unity_check_code(h, 'raffle', p_code);
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
  end if;
  begin
    insert into public.unity_raffle_entries (name, email, email_hash, donor_name, amount)
    values (v_name, lower(btrim(p_email)), h, nullif(left(btrim(coalesce(p_donor_name, '')), 80), ''), round(p_amount, 2))
    returning ticket_no into v_ticket;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already_entered');
  end;
  return jsonb_build_object('ok', true, 'ticket_no', v_ticket);
end;
$$;
revoke all on function public.unity_enter_raffle(text, text, text, text, numeric, boolean) from public;
grant execute on function public.unity_enter_raffle(text, text, text, text, numeric, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Media: private upload bucket (anyone can drop a file in; nobody can list or read it), a public bucket
-- for approved items, and a register step that records an upload for review.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('unity-cup-uploads', 'unity-cup-uploads', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('unity-cup-gallery', 'unity-cup-gallery', true, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can drop a Unity Cup upload" on storage.objects;
create policy "Anyone can drop a Unity Cup upload"
  on storage.objects for insert
  to anon, authenticated
  with check (
    bucket_id = 'unity-cup-uploads'
    and name ~ '^incoming/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|gif|heic|mp4|mov|webm)$'
  );

drop policy if exists "Committee can read Unity Cup uploads" on storage.objects;
create policy "Committee can read Unity Cup uploads"
  on storage.objects for select
  to authenticated
  using (bucket_id in ('unity-cup-uploads', 'unity-cup-gallery') and public.is_dashboard_admin());

drop policy if exists "Committee can remove Unity Cup uploads" on storage.objects;
create policy "Committee can remove Unity Cup uploads"
  on storage.objects for delete
  to authenticated
  using (bucket_id in ('unity-cup-uploads', 'unity-cup-gallery') and public.is_dashboard_admin());

drop policy if exists "Committee can publish Unity Cup media" on storage.objects;
create policy "Committee can publish Unity Cup media"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'unity-cup-gallery' and public.is_dashboard_admin());

create or replace function public.unity_register_media(p_path text, p_caption text, p_credit text, p_rights boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.unity_settings%rowtype; v_kind text;
begin
  select * into s from public.unity_settings where id = 1;
  if not s.media_open then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if p_rights is not true then return jsonb_build_object('ok', false, 'error', 'not_confirmed'); end if;
  if p_path is null or p_path !~ '^incoming/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|gif|heic|mp4|mov|webm)$' then
    return jsonb_build_object('ok', false, 'error', 'bad_path');
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'unity-cup-uploads' and o.name = p_path) then
    return jsonb_build_object('ok', false, 'error', 'missing_file');
  end if;
  if (select count(*) from public.unity_media where created_at > now() - interval '10 minutes') >= 300 then
    return jsonb_build_object('ok', false, 'error', 'busy');
  end if;
  v_kind := case when p_path ~ '\.(mp4|mov|webm)$' then 'video' else 'image' end;
  insert into public.unity_media (storage_path, kind, caption, credit)
  values (p_path, v_kind, nullif(left(btrim(coalesce(p_caption, '')), 200), ''), nullif(left(btrim(coalesce(p_credit, '')), 60), ''))
  on conflict (storage_path) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.unity_register_media(text, text, text, boolean) from public;
grant execute on function public.unity_register_media(text, text, text, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Committee functions (president or Executive Committee)
create or replace function public.unity__require_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_dashboard_admin() then raise exception 'Not allowed.' using errcode = '42501'; end if;
end;
$$;
revoke all on function public.unity__require_admin() from public, anon;
grant execute on function public.unity__require_admin() to authenticated;

create or replace function public.unity_admin_get()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare s public.unity_settings%rowtype;
begin
  perform public.unity__require_admin();
  select * into s from public.unity_settings where id = 1;
  return jsonb_build_object(
    'settings', to_jsonb(s) - 'salt',
    'players', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort, p.name) from public.unity_players p), '[]'::jsonb),
    'voters', (select count(*) from public.unity_voters),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'ticket_no', e.ticket_no, 'name', e.name, 'email', e.email, 'donor_name', e.donor_name,
                'amount', e.amount, 'status', e.status, 'note', e.note, 'created_at', e.created_at,
                'won', exists (select 1 from public.unity_raffle_draws d where d.entry_id = e.id and d.voided_at is null)) order by e.ticket_no)
                from public.unity_raffle_entries e), '[]'::jsonb),
    'draws', coalesce((select jsonb_agg(to_jsonb(d) order by d.drawn_at desc) from public.unity_raffle_draws d), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc) from public.unity_media m where m.status <> 'rejected'), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.unity_admin_get() from public, anon;
grant execute on function public.unity_admin_get() to authenticated;

create or replace function public.unity_admin_save_settings(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.unity__require_admin();
  update public.unity_settings set
    event_title = coalesce(nullif(btrim(p->>'event_title'), ''), event_title),
    event_date = coalesce((p->>'event_date')::date, event_date),
    kickoff_text = case when p ? 'kickoff_text' then nullif(btrim(p->>'kickoff_text'), '') else kickoff_text end,
    venue_text = case when p ? 'venue_text' then nullif(btrim(p->>'venue_text'), '') else venue_text end,
    voting_open = coalesce((p->>'voting_open')::boolean, voting_open),
    voting_closes_at = case when p ? 'voting_closes_at' then nullif(p->>'voting_closes_at', '')::timestamptz else voting_closes_at end,
    show_results = coalesce((p->>'show_results')::boolean, show_results),
    raffle_open = coalesce((p->>'raffle_open')::boolean, raffle_open),
    raffle_closes_at = case when p ? 'raffle_closes_at' then nullif(p->>'raffle_closes_at', '')::timestamptz else raffle_closes_at end,
    media_open = coalesce((p->>'media_open')::boolean, media_open),
    require_email_code = coalesce((p->>'require_email_code')::boolean, require_email_code),
    min_donation = coalesce((p->>'min_donation')::numeric, min_donation),
    prize_text = coalesce(nullif(btrim(p->>'prize_text'), ''), prize_text),
    justgiving_url = coalesce(nullif(btrim(p->>'justgiving_url'), ''), justgiving_url),
    updated_at = now()
  where id = 1;
end;
$$;
revoke all on function public.unity_admin_save_settings(jsonb) from public, anon;
grant execute on function public.unity_admin_save_settings(jsonb) to authenticated;

create or replace function public.unity_admin_save_player(p_id uuid, p_name text, p_team text, p_shirt text, p_sort int, p_active boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid := p_id;
begin
  perform public.unity__require_admin();
  if btrim(coalesce(p_name, '')) = '' then raise exception 'A player needs a name.'; end if;
  if v_id is null then
    insert into public.unity_players (name, team, shirt_no, sort, active)
    values (btrim(p_name), nullif(btrim(coalesce(p_team, '')), ''), nullif(btrim(coalesce(p_shirt, '')), ''), coalesce(p_sort, 0), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.unity_players set name = btrim(p_name), team = nullif(btrim(coalesce(p_team, '')), ''),
           shirt_no = nullif(btrim(coalesce(p_shirt, '')), ''), sort = coalesce(p_sort, sort), active = coalesce(p_active, active)
     where id = v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.unity_admin_save_player(uuid, text, text, text, int, boolean) from public, anon;
grant execute on function public.unity_admin_save_player(uuid, text, text, text, int, boolean) to authenticated;

-- Players with votes are hidden instead of deleted, so the count is never lost by accident.
create or replace function public.unity_admin_delete_player(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_votes int;
begin
  perform public.unity__require_admin();
  select votes into v_votes from public.unity_players where id = p_id;
  if v_votes is null then return 'gone'; end if;
  if v_votes > 0 then update public.unity_players set active = false where id = p_id; return 'hidden'; end if;
  delete from public.unity_players where id = p_id;
  return 'deleted';
end;
$$;
revoke all on function public.unity_admin_delete_player(uuid) from public, anon;
grant execute on function public.unity_admin_delete_player(uuid) to authenticated;

create or replace function public.unity_admin_set_entry(p_id uuid, p_status text, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.unity__require_admin();
  if p_status not in ('pending', 'verified', 'rejected') then raise exception 'Unknown status.'; end if;
  update public.unity_raffle_entries
     set status = p_status, note = nullif(btrim(coalesce(p_note, '')), ''),
         verified_at = case when p_status = 'verified' then now() else null end
   where id = p_id;
end;
$$;
revoke all on function public.unity_admin_set_entry(uuid, text, text) from public, anon;
grant execute on function public.unity_admin_set_entry(uuid, text, text) to authenticated;

-- The draw: a random verified entry that has not already won. The pick is made in the database (secure
-- random), never in the browser, so the wheel on screen only displays a result that was already decided.
create or replace function public.unity_admin_draw()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.unity_settings%rowtype;
  n int; pick int; e public.unity_raffle_entries%rowtype; d public.unity_raffle_draws%rowtype; v_display text;
begin
  perform public.unity__require_admin();
  select * into s from public.unity_settings where id = 1;
  select count(*) into n from public.unity_raffle_entries x
   where x.status = 'verified' and not exists (select 1 from public.unity_raffle_draws w where w.entry_id = x.id and w.voided_at is null);
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'no_entries'); end if;
  pick := mod(('x' || encode(extensions.gen_random_bytes(8), 'hex'))::bit(64)::bigint & 9223372036854775807, n)::int;
  select x.* into e from public.unity_raffle_entries x
   where x.status = 'verified' and not exists (select 1 from public.unity_raffle_draws w where w.entry_id = x.id and w.voided_at is null)
   order by x.ticket_no offset pick limit 1;
  v_display := split_part(e.name, ' ', 1) || case when position(' ' in btrim(e.name)) > 0 then ' ' || upper(left(split_part(btrim(e.name), ' ', 2), 1)) || '.' else '' end;
  insert into public.unity_raffle_draws (entry_id, ticket_no, display_name, prize)
  values (e.id, e.ticket_no, v_display, s.prize_text) returning * into d;
  return jsonb_build_object('ok', true, 'draw_id', d.id, 'ticket_no', e.ticket_no, 'name', e.name, 'email', e.email, 'display_name', v_display, 'prize', s.prize_text);
end;
$$;
revoke all on function public.unity_admin_draw() from public, anon;
grant execute on function public.unity_admin_draw() to authenticated;

create or replace function public.unity_admin_void_draw(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.unity__require_admin();
  update public.unity_raffle_draws set voided_at = now() where id = p_id and voided_at is null;
end;
$$;
revoke all on function public.unity_admin_void_draw(uuid) from public, anon;
grant execute on function public.unity_admin_void_draw(uuid) to authenticated;

create or replace function public.unity_admin_set_media(p_id uuid, p_status text, p_public_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.unity__require_admin();
  if p_status not in ('pending', 'approved', 'rejected') then raise exception 'Unknown status.'; end if;
  update public.unity_media
     set status = p_status,
         public_path = case when p_status = 'approved' then coalesce(p_public_path, public_path) else null end,
         approved_at = case when p_status = 'approved' then now() else null end
   where id = p_id;
end;
$$;
revoke all on function public.unity_admin_set_media(uuid, text, text) from public, anon;
grant execute on function public.unity_admin_set_media(uuid, text, text) to authenticated;

-- Removes media rows (the browser then removes the files themselves).
create or replace function public.unity_admin_delete_media(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare m public.unity_media%rowtype;
begin
  perform public.unity__require_admin();
  delete from public.unity_media where id = p_id returning * into m;
  return jsonb_build_object('uploads', m.storage_path, 'gallery', m.public_path);
end;
$$;
revoke all on function public.unity_admin_delete_media(uuid) from public, anon;
grant execute on function public.unity_admin_delete_media(uuid) to authenticated;

-- Wipes votes and voters, for clearing out test votes before the real thing.
create or replace function public.unity_admin_reset_votes()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.unity__require_admin();
  delete from public.unity_voters where true;
  delete from public.unity_codes where purpose = 'vote';
  update public.unity_players set votes = 0 where true;
end;
$$;
revoke all on function public.unity_admin_reset_votes() from public, anon;
grant execute on function public.unity_admin_reset_votes() to authenticated;

-- Clear-up. Codes after a day; voters' hashes and raffle entries 30 days after the event; unreviewed or
-- rejected media after 30 days. Returns the media files the browser should also remove from storage.
create or replace function public.unity_purge(p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.unity_settings%rowtype;
  v_limit timestamptz; v_files jsonb;
begin
  if auth.uid() is not null then perform public.unity__require_admin(); end if;
  select * into s from public.unity_settings where id = 1;
  v_limit := (s.event_date + 30)::timestamptz;
  delete from public.unity_codes where created_at < now() - interval '1 day';
  if now() >= v_limit or p_force then
    delete from public.unity_voters where true;
    delete from public.unity_raffle_entries where true;
  end if;
  select coalesce(jsonb_agg(m.storage_path), '[]'::jsonb) into v_files
    from public.unity_media m where m.status <> 'approved' and m.created_at < now() - interval '30 days';
  delete from public.unity_media m where m.status <> 'approved' and m.created_at < now() - interval '30 days';
  return jsonb_build_object('ok', true, 'files', v_files, 'entries_cleared', (now() >= v_limit or p_force));
end;
$$;
revoke all on function public.unity_purge(boolean) from public, anon;
grant execute on function public.unity_purge(boolean) to authenticated;

commit;
