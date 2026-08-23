-- "So-and-so just joined the LACMS Network" activity feed — fires the
-- moment a real `members` row is created, whether that's the committee
-- adding someone the normal way or a pending_members row getting
-- claimed on first login (migration 016). Both paths are a plain
-- `insert into members`, so one trigger on that table covers both.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. Needs migration 015 already applied (for is_professional()).

-- ---------------------------------------------------------------------
-- Name/course/year/member_type are captured at the moment of joining,
-- not read live from `members`, so the feed still reads correctly even
-- if that member's details change later or they eventually leave.
create table public.network_join_events (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members(id) on delete set null,
  full_name text not null,
  course text,
  year_of_study text,
  member_type text,
  is_visible boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.network_join_events is 'One row per new members insert — powers the "just joined the Network" feed on member-hub.html and the recent-joins banner on member-network.html. Set is_visible to false in Table Editor to quietly hide a specific announcement without deleting the join record itself.';

alter table public.network_join_events enable row level security;

create policy "Members and professionals can view join events"
  on public.network_join_events for select
  to authenticated
  using (is_visible = true and (public.is_lacms_member() or public.is_professional()));

-- ---------------------------------------------------------------------
create or replace function public.log_network_join()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.network_join_events (member_id, full_name, course, year_of_study, member_type)
  values (new.id, new.full_name, new.course, new.year_of_study, new.member_type);
  return new;
end;
$$;

drop trigger if exists members_log_network_join on public.members;

create trigger members_log_network_join
  after insert on public.members
  for each row
  execute function public.log_network_join();
