-- Two changes, both replacing something that used to require going
-- through Claude to change:
--
-- 1. Sankofa mentor applications become genuinely public — no account,
--    no password, just a short form (name, email, job title, LinkedIn,
--    a short "why/what you offer"). This supersedes 028's account-based
--    mentor branch (the mentor_* columns on sankofa_applications, and
--    the self-registered-professional mechanism) — that schema is left
--    in place untouched (harmless if unused) rather than risk altering
--    something that may already be applied; the client simply no longer
--    uses it. sankofa_applications goes back to being mentee-only.
-- 2. A live, president-editable public gallery — upload/remove/reorder
--    photos straight from the dashboard, instead of hand-editing the
--    FILES array in gallery.html every time a photo changes.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. Needs 003, 014, 015 and 025 already applied (028 does not need
-- to have been run first — this migration doesn't depend on it).

-- =======================================================================
-- 1. Sankofa mentor applications — public, no sign-in required.
-- =======================================================================

create table public.sankofa_mentor_applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  job_title text not null,
  organisation text,
  linkedin_url text,
  offer_statement text not null,
  status text not null default 'new' check (status in ('new', 'reviewed', 'contacted')),
  created_at timestamptz not null default now()
);

comment on table public.sankofa_mentor_applications is 'Public, no-account short-form mentor applications — submitted directly from sankofa.html''s apply modal. See 028 for the older account-based mentor mechanism this replaces.';
comment on column public.sankofa_mentor_applications.status is 'President-only triage: new (default) -> reviewed -> contacted. Purely for the dashboard''s own bookkeeping.';

alter table public.sankofa_mentor_applications enable row level security;

-- Anyone can submit, signed in or not — this is a public contact-style
-- form, same pattern as the site's other anon-writable tables (see
-- news_posts/motm_winners/opportunities' "to anon, authenticated" select
-- policies elsewhere) just extended to insert. Deliberately no select
-- policy for anon/authenticated: submissions are write-only from the
-- public side, readable only by the president via the RPC below.
create policy "Anyone can submit a mentor application"
  on public.sankofa_mentor_applications for insert
  to anon, authenticated
  with check (
    char_length(full_name) between 1 and 200
    and char_length(job_title) between 1 and 200
    and char_length(offer_statement) between 1 and 2000
    and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  );

create or replace function public.president_get_sankofa_mentor_applications()
returns table (
  id uuid, full_name text, email text, job_title text, organisation text,
  linkedin_url text, offer_statement text, status text, created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  return query
    select sma.id, sma.full_name, sma.email, sma.job_title, sma.organisation,
           sma.linkedin_url, sma.offer_statement, sma.status, sma.created_at
    from public.sankofa_mentor_applications sma
    order by sma.created_at desc;
end;
$$;

create or replace function public.president_set_mentor_application_status(target_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;
  if new_status not in ('new', 'reviewed', 'contacted') then
    raise exception 'Invalid status';
  end if;
  update public.sankofa_mentor_applications set status = new_status where id = target_id;
end;
$$;

-- Mentee deadline (closes 11 October 2026) — sankofa_applications is
-- mentee-only again from the client's perspective, so this version
-- checks every insert unconditionally rather than branching on
-- applicant_type like 028's version did.
create or replace function public.enforce_sankofa_mentee_deadline()
returns trigger
language plpgsql
as $$
begin
  if now() > '2026-10-11 23:59:59+01'::timestamptz then
    raise exception 'Sankofa mentee applications closed on 11 October 2026.';
  end if;
  return new;
end;
$$;

drop trigger if exists sankofa_mentee_deadline on public.sankofa_applications;
create trigger sankofa_mentee_deadline
  before insert on public.sankofa_applications
  for each row
  execute function public.enforce_sankofa_mentee_deadline();

-- =======================================================================
-- 2. Public gallery — a real table + a public storage bucket, so
--    gallery.html can be driven by data instead of a hardcoded file
--    list, and the president dashboard can manage it live.
-- =======================================================================

insert into storage.buckets (id, name, public)
values ('gallery-photos', 'gallery-photos', true)
on conflict (id) do nothing;

-- Bucket is public (serves files via a public URL with no auth needed —
-- that's what gallery.html itself will load), but write access is
-- still fully gated: only the president can add or remove files.
create policy "President can upload gallery photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'gallery-photos' and public.is_president());

create policy "President can delete gallery photos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'gallery-photos' and public.is_president());

create table public.gallery_photos (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  caption text,
  display_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on column public.gallery_photos.storage_path is 'Path within the gallery-photos bucket — combined with the project URL client-side to build the public image URL.';
comment on column public.gallery_photos.is_active is 'Unchecking this on the dashboard pulls a photo from the public gallery without deleting the file itself.';
comment on column public.gallery_photos.display_order is 'Lower shows first. Ties break by created_at desc (newest first) on the client.';

alter table public.gallery_photos enable row level security;

create policy "Anyone can view active gallery photos"
  on public.gallery_photos for select
  to anon, authenticated
  using (is_active = true);

create policy "President can manage gallery photos"
  on public.gallery_photos for all
  to authenticated
  using (public.is_president())
  with check (public.is_president());
