-- Narrows Sankofa Circle mentee applications to Medicine members only
-- (previously Medicine and Pharmacy, plus aspiring medics/sixth formers
-- via the manual "Sankofa eligible" checkbox) - enforced both in
-- js/members.js (which now hides the feature entirely on the hub and
-- the application page for anyone whose course isn't Medicine, rather
-- than showing a locked/"coming soon" state) and here, so the rule
-- can't be bypassed by calling the API directly instead of going
-- through the site.
--
-- Replaces 029's deadline-only trigger with one that checks both rules
-- together - same trigger slot, just doing more than it used to.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query,
-- paste, Run. Needs 029 already applied.

create or replace function public.enforce_sankofa_mentee_rules()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  applicant_course text;
begin
  if new.role_applied_for = 'mentee' then
    if now() > '2026-10-11 23:59:59+01'::timestamptz then
      raise exception 'Sankofa mentee applications closed on 11 October 2026.';
    end if;

    select course into applicant_course from public.members where id = new.member_id;
    if applicant_course is distinct from 'Medicine' then
      raise exception 'Sankofa Circle mentee applications are open to Medicine members only.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sankofa_mentee_deadline on public.sankofa_applications;
drop trigger if exists sankofa_mentee_rules on public.sankofa_applications;
create trigger sankofa_mentee_rules
  before insert on public.sankofa_applications
  for each row
  execute function public.enforce_sankofa_mentee_rules();
