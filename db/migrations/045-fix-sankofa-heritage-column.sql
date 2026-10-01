-- Fixes "Could not find 'heritage' column of 'sankofa_applications' in
-- schema cache" on the Sankofa mentee application form.
--
-- Migration 006 already added this column back when Sankofa applications
-- first shipped. If you're seeing this error, either 006 was never run
-- on this database, or the column's there but PostgREST's own schema
-- cache (separate from Postgres itself) hasn't noticed yet. This
-- statement is safe either way - "if not exists" makes it a no-op if
-- the column's already there.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query,
-- paste, Run. Afterward, go to Settings -> API -> "Reload schema" to
-- make sure PostgREST picks it up straight away rather than waiting
-- for its cache to refresh on its own.

alter table public.sankofa_applications
  add column if not exists heritage text;

comment on column public.sankofa_applications.heritage is 'Optional — African/Caribbean country of family heritage, "mixed", "other", or "prefer not to say".';
