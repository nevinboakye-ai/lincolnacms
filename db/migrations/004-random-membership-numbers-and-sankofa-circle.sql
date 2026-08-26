-- 1. Membership numbers: random instead of sequential, so the number
--    itself can't be used to estimate how many members LACMS has.
-- 2. Sankofa eligibility flag on members (committee-controlled).
-- 3. Sankofa Circle application: replaces the old mentor/mentee choice
--    with a fuller questionnaire used to pair members across years.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. Safe on tables that already have rows.

-- ---------------------------------------------------------------------
-- 1. Random membership numbers
-- ---------------------------------------------------------------------

-- Converts the column from a generated (sequential) one to a plain,
-- directly-settable one. Existing values are kept as-is by this step —
-- they get overwritten by the random backfill further down.
alter table public.members alter column membership_number drop expression if exists;
alter table public.members add constraint members_membership_number_key unique (membership_number);

create or replace function public.generate_membership_number()
returns trigger as $$
declare
  candidate text;
  attempts int := 0;
begin
  if new.membership_number is not null then
    return new;
  end if;
  loop
    candidate := 'LACMS-' || lpad((floor(random() * 90000) + 10000)::int::text, 5, '0');
    exit when not exists (select 1 from public.members where membership_number = candidate);
    attempts := attempts + 1;
    if attempts > 20 then
      raise exception 'Could not generate a unique membership number';
    end if;
  end loop;
  new.membership_number := candidate;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists set_membership_number on public.members;
create trigger set_membership_number
  before insert on public.members
  for each row
  execute function public.generate_membership_number();

-- Re-randomize every existing member's number too — the whole point is
-- that the number shouldn't hint at join order or headcount.
do $$
declare
  r record;
  candidate text;
  attempts int;
begin
  for r in select id from public.members loop
    attempts := 0;
    loop
      candidate := 'LACMS-' || lpad((floor(random() * 90000) + 10000)::int::text, 5, '0');
      exit when not exists (select 1 from public.members where membership_number = candidate);
      attempts := attempts + 1;
      exit when attempts > 20;
    end loop;
    update public.members set membership_number = candidate where id = r.id;
  end loop;
end $$;

-- member_seq (the old identity column the sequential number was built
-- from) is no longer used for anything member-facing and can stay —
-- it's never selected or displayed anywhere.

-- ---------------------------------------------------------------------
-- 2. Sankofa eligibility — committee sets this true for Medicine and
--    Pharmacy members, and aspiring medics/sixth formers. Everyone else
--    (e.g. other healthcare courses) sees a "not open to you yet" note
--    instead of the application form.
-- ---------------------------------------------------------------------
alter table public.members
  add column sankofa_eligible boolean not null default false;

comment on column public.members.sankofa_eligible is 'Committee-set: true for Medicine/Pharmacy members and aspiring medics/sixth formers — controls access to member-sankofa.html.';

-- ---------------------------------------------------------------------
-- 3. Sankofa Circle application — fuller questionnaire for pairing.
--    role_applied_for and statement are kept (now optional) for
--    backwards compatibility with any applications already submitted
--    under the old mentor/mentee form.
-- ---------------------------------------------------------------------
alter table public.sankofa_applications
  alter column role_applied_for drop not null,
  alter column statement drop not null,
  add column current_stage text,
  add column career_aspirations text,
  add column specialty_interest text,
  add column hobbies_interests text[],
  add column social_preference smallint check (social_preference between 1 and 5),
  add column fitness_preference smallint check (fitness_preference between 1 and 5),
  add column communication_style text check (communication_style in ('casual', 'structured', 'mix')),
  add column meeting_frequency text check (meeting_frequency in ('weekly', 'fortnightly', 'monthly')),
  add column looking_for text;
