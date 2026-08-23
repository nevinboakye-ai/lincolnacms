-- Professionals joining/being added to the Network now also show up in
-- the "just joined" activity feed (hub banner + Network ticker),
-- alongside members. network_join_events becomes polymorphic: a new
-- event_type column distinguishes a member join (course/year_of_study/
-- member_type filled in) from a professional join (title/organisation/
-- category filled in instead) — the read side (js/members.js) already
-- queries this one table for both surfaces, so this keeps that single
-- source of truth rather than needing a second table + a UNION.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. Needs migration 020 already applied.

alter table public.network_join_events
  add column event_type text not null default 'member' check (event_type in ('member', 'professional')),
  add column professional_id uuid references public.network_professionals(id) on delete set null,
  add column title text,
  add column organisation text,
  add column category text;

-- Explicit event_type on the member-join trigger too, rather than
-- relying on the column default, so this stays correct even if the
-- default is ever changed.
create or replace function public.log_network_join()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.network_join_events (event_type, member_id, full_name, course, year_of_study, member_type)
  values ('member', new.id, new.full_name, new.course, new.year_of_study, new.member_type);
  return new;
end;
$$;

create or replace function public.log_professional_join()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.network_join_events (event_type, professional_id, full_name, title, organisation, category)
  values ('professional', new.id, new.full_name, new.title, new.organisation, new.category);
  return new;
end;
$$;

drop trigger if exists network_professionals_log_join on public.network_professionals;

create trigger network_professionals_log_join
  after insert on public.network_professionals
  for each row
  execute function public.log_professional_join();

-- Backfill professionals added before this migration, same pattern as
-- migration 021's member backfill — uses their own created_at so
-- relative times ("5 days ago") are accurate, and is safe to run more
-- than once (the NOT EXISTS check skips anyone already logged).
insert into public.network_join_events (event_type, professional_id, full_name, title, organisation, category, created_at)
select 'professional', p.id, p.full_name, p.title, p.organisation, p.category, p.created_at
from public.network_professionals p
where not exists (
  select 1 from public.network_join_events e where e.professional_id = p.id
);
