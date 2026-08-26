-- Member of the Month becomes data-driven: Nevin edits winner text
-- directly in Table Editor instead of it living in the site's HTML.
-- This is public content (motm.html and the homepage teaser are both
-- public pages), so it's readable by anyone, signed in or not.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run.

create table public.motm_winners (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  course text,
  year_of_study text,
  month_label text not null,
  photo_url text,
  quote text,
  bio text,
  tags text[] not null default '{}',
  is_current boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.motm_winners enable row level security;

create policy "Anyone can view active motm winners"
  on public.motm_winners for select
  to anon, authenticated
  using (is_active = true);

comment on column public.motm_winners.is_current is 'Exactly one row should be true at a time — that''s the one shown in the big hero spot on motm.html and the homepage teaser. Everything else with is_active = true shows in the past-honourees archive.';
comment on column public.motm_winners.tags is 'Short trait words, e.g. {Community,Leadership,Impact} — shown as pills under the bio.';
comment on column public.motm_winners.photo_url is 'A public image URL (e.g. from Supabase Storage or an external host). Leave blank to show the placeholder silhouette.';

-- ---------------------------------------------------------------------
-- Nominating is a LACMS member exclusive — MMG-only guest accounts
-- shouldn't be able to submit nominations even via a direct API call,
-- not just have the form hidden in the UI.
drop policy if exists "Members can submit a nomination" on public.motm_nominations;

create policy "LACMS members can submit a nomination"
  on public.motm_nominations for insert
  to authenticated
  with check (
    auth.uid() = nominator_id
    and exists (select 1 from public.members m where m.id = auth.uid())
  );
