-- Two additions:
--
-- 1. The president can now clear a MoTM nomination from the dashboard —
--    e.g. someone wants to change who/why they nominated. Deleting it
--    frees up their monthly slot automatically (the one-per-month
--    constraint from 030 only blocks while a row exists), so there's
--    no separate "give the slot back" step needed.
-- 2. A small, reusable key/value settings table, editable straight from
--    Supabase's own Table Editor with no code change and no redeploy —
--    starting with active_member_count, which the homepage and about
--    page now read live instead of a hardcoded "6", and don't show at
--    all until 30 September 2026.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. Needs 025 (is_president()) already applied.

-- =======================================================================
-- 1. Delete a MoTM nomination — president-only.
-- =======================================================================

create or replace function public.president_delete_motm_nomination(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  delete from public.motm_nominations where id = target_id;
end;
$$;

-- =======================================================================
-- 2. Site settings — generic key/value store, hand-editable from
--    Table Editor. Public read (the homepage/about page fetch this with
--    no one signed in), president-only write via RLS for anyone editing
--    it some other way later; Table Editor itself uses the service role
--    and bypasses RLS entirely either way.
-- =======================================================================

create table public.site_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

comment on table public.site_settings is 'Small hand-editable settings, e.g. from Table Editor — no code change or redeploy needed to update a value the site reads live.';

alter table public.site_settings enable row level security;

create policy "Anyone can read site settings"
  on public.site_settings for select
  to anon, authenticated
  using (true);

create policy "President can manage site settings"
  on public.site_settings for all
  to authenticated
  using (public.is_president())
  with check (public.is_president());

insert into public.site_settings (key, value) values
  ('active_member_count', '6');
