-- A resource can now belong to several courses and several years of study
-- (e.g. a pharmacology deck useful to Medicine and Pharmacy, Years 2-3).
--
-- resources.course / resources.year_of_study (one value each) become
-- resources.courses / resources.years (lists). Existing resources are
-- carried across: their one course becomes a one-item list, and their year
-- (if any) a one-item list; an empty years list means "any year".
-- get_resource_counts() now counts a resource under each of its courses and
-- adds one extra row, course = '__all', with the true number of distinct
-- resources (so a resource in two courses isn't counted twice there).
--
-- Wrapped in a transaction. Run this once in Supabase: Dashboard -> SQL
-- Editor -> New query, paste, Run. Needs 065.

begin;

alter table public.resources add column if not exists courses text[];
alter table public.resources add column if not exists years text[];

update public.resources
set courses = array[course],
    years = case when year_of_study is null or btrim(year_of_study) = '' then '{}'::text[] else array[year_of_study] end
where courses is null;

alter table public.resources alter column courses set not null;
alter table public.resources alter column years set not null;
alter table public.resources alter column years set default '{}';

alter table public.resources drop constraint if exists resources_courses_valid;
alter table public.resources add constraint resources_courses_valid check (
  cardinality(courses) between 1 and 9
  and courses <@ array[
    'Medicine', 'Pharmacy', 'Dental Hygiene and Therapy', 'Diagnostic Radiography',
    'Nursing', 'Midwifery', 'Biomedical Science', 'Occupational Therapy', 'General'
  ]::text[]
);

alter table public.resources drop constraint if exists resources_years_valid;
alter table public.resources add constraint resources_years_valid check (
  cardinality(years) <= 7
  and years <@ array['Foundation Year', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Masters']::text[]
);

drop index if exists public.resources_course_status_idx;
alter table public.resources drop column if exists course;
alter table public.resources drop column if exists year_of_study;
create index if not exists resources_courses_idx on public.resources using gin (courses);
create index if not exists resources_status_approved_idx on public.resources (status, approved_at desc);

create or replace function public.get_resource_counts()
returns table (course text, approved_count int, pending_count int)
language sql
stable
security invoker
set search_path = public
as $$
  select c.course,
         (count(*) filter (where r.status = 'approved'))::int,
         (count(*) filter (where r.status = 'pending' and public.is_dashboard_admin()))::int
  from public.resources r
  cross join lateral unnest(r.courses) as c(course)
  group by c.course
  union all
  select '__all',
         (count(*) filter (where r.status = 'approved'))::int,
         (count(*) filter (where r.status = 'pending' and public.is_dashboard_admin()))::int
  from public.resources r;
$$;

grant execute on function public.get_resource_counts() to authenticated;

commit;
