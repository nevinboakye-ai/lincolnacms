-- Remembers small per-user "have they seen / answered this?" facts for the
-- guidance features in js/guidance.js, so they follow a person across
-- devices instead of living in one browser:
--   tour           - whether the welcome tour was offered/taken/skipped
--   profile_prompt - how many times the "complete your Network profile"
--                    prompt has appeared, when it's next due, and whether
--                    they finished it or asked not to be asked again
-- Each person can only read and write their own rows. If this table
-- doesn't exist yet the site falls back to remembering these in the
-- browser, so nothing breaks before this is run.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query, paste,
-- Run.

create table if not exists public.user_ui_state (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null check (key in ('tour', 'profile_prompt')),
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.user_ui_state enable row level security;

drop policy if exists "Users manage their own UI state" on public.user_ui_state;
create policy "Users manage their own UI state"
  on public.user_ui_state for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
