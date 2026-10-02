-- Fixes "Could not find the 'study_style' column of 'sankofa_applications'
-- in schema cache" (and the same error for other columns) when submitting
-- a Sankofa mentee application.
--
-- 045 already re-added just the heritage column after the same symptom
-- showed up there; now study_style has turned up missing too, which
-- points at the real cause - migration 006 (which added heritage,
-- study_style AND support_style together) most likely never ran on this
-- database at all, rather than one column going missing on its own. This
-- re-adds every column 006 was supposed to add, plus the two slightly
-- earlier ones from 004 for good measure, all with "if not exists" so
-- it's a safe no-op for any of them that are already there - whether or
-- not 045 was ever run doesn't matter.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query,
-- paste, Run. Afterward, go to Settings -> API -> "Reload schema" to
-- make sure PostgREST picks up the change straight away.

alter table public.sankofa_applications
  add column if not exists social_preference smallint check (social_preference between 1 and 5),
  add column if not exists fitness_preference smallint check (fitness_preference between 1 and 5),
  add column if not exists heritage text,
  add column if not exists study_style smallint check (study_style between 1 and 5),
  add column if not exists support_style smallint check (support_style between 1 and 5);

comment on column public.sankofa_applications.heritage is 'Optional — African/Caribbean country of family heritage, "mixed", "other", or "prefer not to say".';
comment on column public.sankofa_applications.study_style is '1 = solo studier, 5 = group studier.';
comment on column public.sankofa_applications.support_style is '1 = academic-focused, 5 = personal/wellbeing-focused.';
