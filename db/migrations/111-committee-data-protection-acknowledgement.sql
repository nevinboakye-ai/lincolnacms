-- 111: Committee data protection acknowledgement (ULSU Code of Conduct)
--
-- ULSU's Code of Conduct (2026/27), "Data Protection": "Committee members shall receive specific Data
-- Protection Training before being granted access to any personal data related to Students' Union
-- activities."
--
-- The website can't deliver that training or check it was done, but it can make sure every committee
-- member who opens the dashboard is asked, once each academic year, to say whether they have completed
-- ULSU's training, and keep a record. Someone who says they haven't yet can carry on, but sees a
-- reminder on every visit until they confirm. (A hard block would lock the committee out of its own
-- dashboard until ULSU's training is booked, so it records and reminds instead; ask if you would rather
-- have the block.)
--
-- Safe to run more than once. Needs 025 and 098.

begin;

create table if not exists public.committee_acknowledgements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  academic_year text not null check (char_length(academic_year) <= 12),
  training_status text not null check (training_status in ('completed', 'pending')),
  acknowledged_at timestamptz not null default now()
);
alter table public.committee_acknowledgements enable row level security;
revoke all on public.committee_acknowledgements from anon, authenticated;

create or replace function public.committee_ack_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select jsonb_build_object('academic_year', a.academic_year, 'training_status', a.training_status, 'at', a.acknowledged_at)
                   from public.committee_acknowledgements a where a.user_id = auth.uid()), '{}'::jsonb);
$$;

create or replace function public.committee_acknowledge(p_year text, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not (public.is_president() or public.has_any_dashboard_access()) then
    raise exception 'Not authorized';
  end if;
  if p_status not in ('completed', 'pending') then raise exception 'Unknown status.'; end if;
  if p_year is null or char_length(btrim(p_year)) not between 4 and 12 then raise exception 'Unknown academic year.'; end if;
  insert into public.committee_acknowledgements (user_id, academic_year, training_status, acknowledged_at)
  values (auth.uid(), btrim(p_year), p_status, now())
  on conflict (user_id) do update set academic_year = excluded.academic_year, training_status = excluded.training_status, acknowledged_at = now();
end;
$$;

-- The president can see who has confirmed (to chase the rest).
create or replace function public.president_committee_acknowledgements()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_president() then raise exception 'Not authorized'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'name', coalesce(m.full_name, u.email::text), 'academic_year', a.academic_year,
                     'training_status', a.training_status, 'at', a.acknowledged_at) order by a.acknowledged_at desc)
    from public.committee_acknowledgements a
    join auth.users u on u.id = a.user_id
    left join public.members m on m.id = a.user_id), '[]'::jsonb);
end;
$$;

revoke all on function public.committee_ack_status() from public, anon;
revoke all on function public.committee_acknowledge(text, text) from public, anon;
revoke all on function public.president_committee_acknowledgements() from public, anon;
grant execute on function public.committee_ack_status() to authenticated;
grant execute on function public.committee_acknowledge(text, text) to authenticated;
grant execute on function public.president_committee_acknowledgements() to authenticated;

commit;
