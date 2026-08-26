-- Adds a heritage field (African/Caribbean country, optional) and two
-- more matching sliders to the Sankofa application: study style and
-- what kind of support the applicant is looking for.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run.

alter table public.sankofa_applications
  add column heritage text,
  add column study_style smallint check (study_style between 1 and 5),
  add column support_style smallint check (support_style between 1 and 5);

comment on column public.sankofa_applications.heritage is 'Optional — African/Caribbean country of family heritage, "mixed", "other", or "prefer not to say".';
comment on column public.sankofa_applications.study_style is '1 = solo studier, 5 = group studier.';
comment on column public.sankofa_applications.support_style is '1 = academic-focused, 5 = personal/wellbeing-focused.';
