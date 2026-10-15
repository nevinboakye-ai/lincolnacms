-- The committee ("Meet the team" on the About page) becomes editable from the
-- website: names, roles, course lines, bios and photos, in any order, with
-- members you can add, hide or remove - no code or Table Editor needed.
--
-- about.html still contains the original six cards as static HTML (the fallback
-- if this table is empty or unreachable); once the table has active rows the
-- page shows those instead. Seeded below from the current page, with Martin Oti
-- and Jemimah Omotola as Co-Vice Presidents (Martin first).
--
-- Who can edit: the president and Executive Committee (is_dashboard_admin()).
-- Everyone can read the active members. Photos live in a PUBLIC storage bucket,
-- committee-photos (JPG / PNG / WebP, up to 3 MB; the editor shrinks big
-- photos for you), writable only by those same people.
--
-- Wrapped in a transaction. Run this once in Supabase: Dashboard -> SQL Editor
-- -> New query, paste, Run. Needs 037 (is_dashboard_admin). Safe to run again.

begin;

create table if not exists public.committee_members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(btrim(full_name)) between 1 and 80),
  role text not null check (char_length(btrim(role)) between 1 and 60),
  course_text text check (course_text is null or char_length(course_text) <= 80),
  bio text check (bio is null or char_length(bio) <= 800),
  photo_url text check (photo_url is null or char_length(photo_url) <= 600),
  photo_focus smallint not null default 50 check (photo_focus between 0 and 100),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.committee_members enable row level security;

drop policy if exists "Anyone can view active committee members" on public.committee_members;
create policy "Anyone can view active committee members"
  on public.committee_members for select
  to anon, authenticated
  using (is_active = true);

drop policy if exists "Executives view all committee members" on public.committee_members;
create policy "Executives view all committee members"
  on public.committee_members for select
  to authenticated
  using (public.is_dashboard_admin());

drop policy if exists "Executives add committee members" on public.committee_members;
create policy "Executives add committee members"
  on public.committee_members for insert
  to authenticated
  with check (public.is_dashboard_admin());

drop policy if exists "Executives change committee members" on public.committee_members;
create policy "Executives change committee members"
  on public.committee_members for update
  to authenticated
  using (public.is_dashboard_admin())
  with check (public.is_dashboard_admin());

drop policy if exists "Executives remove committee members" on public.committee_members;
create policy "Executives remove committee members"
  on public.committee_members for delete
  to authenticated
  using (public.is_dashboard_admin());

-- The six people already on the page (only if the table is empty).
insert into public.committee_members (full_name, role, course_text, bio, photo_url, sort_order)
select * from (values
  ($q$Nevin Boakye$q$, $q$President$q$, $q$Medicine, Year 3$q$, $q$TOP 150 Future Leaders '26 | Medicine MBBS | Aspiring Orthopaedic Surgeon | 1st Class Medical Science BSc | Corporate Finance at CBS | President @ACMS | Vice President @INSPIRE$q$, $q$Media/Committee Members/nevinlinkedin.png$q$, 10),
  ($q$Martin Oti$q$, $q$Co-Vice President$q$, $q$Medicine, Year 3$q$, $q$Medicine MBBS @ University of Lincoln | Aspiring Surgeon | Co-Vice President @ ACMS | Medical Education | Gym, Reading & Anki | Lover of Travel & Good Food$q$, $q$Media/Committee Members/martinlinkedin.png$q$, 20),
  ($q$Jemimah Omotola$q$, $q$Co-Vice President$q$, $q$Medicine, Year 2$q$, $q$Top 150 Future Leaders '26 | Medicine MBBS | Aspiring Anaesthetist/OBGYN | Co-Vice President @ ACMS | Founder of For Her Health Initiative | Medics&Me Regional Lead | Academic Tutor | Nail Technician | Lover of Travel, Reading & Fashion$q$, $q$Media/Committee Members/jemimahlinkedin.png$q$, 30),
  ($q$Stephen Archer Jr$q$, $q$Treasurer$q$, $q$Medicine, Year 3$q$, $q$Medicine MBBS | Aspiring Sports Medicine Doctor | Treasurer @ACMS | Co-Founder @Closur | Interests in MSK | Running & Football$q$, $q$Media/Committee Members/stephenlinkedin.png$q$, 40),
  ($q$Roberta Arthur$q$, $q$Event Secretary$q$, $q$Medicine, Year 3$q$, $q$TOP 150 Future Leaders '26 | Medicine MBBS | Event Secretary @ACMS | Aspiring Gastroenterologist | TAMS communications officer | Tutor. Lover of photography and crocheting :)$q$, $q$Media/Committee Members/robertalinkedin.png$q$, 50),
  ($q$Gloria Ndarigumije$q$, $q$Charity Secretary$q$, $q$Medicine, Year 3$q$, $q$Medicine MBBS | GSK Mentor @Zero Gravity | Aspiring Paediatrician | Interest in Public Health & MedTech$q$, $q$Media/Committee Members/glorialinkedin.png$q$, 60)
) as v(full_name, role, course_text, bio, photo_url, sort_order)
where not exists (select 1 from public.committee_members);

-- Photos: a public bucket, writable by executives only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('committee-photos', 'committee-photos', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Executives upload committee photos" on storage.objects;
create policy "Executives upload committee photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'committee-photos' and public.is_dashboard_admin());

drop policy if exists "Executives replace committee photos" on storage.objects;
create policy "Executives replace committee photos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'committee-photos' and public.is_dashboard_admin());

drop policy if exists "Executives remove committee photos" on storage.objects;
create policy "Executives remove committee photos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'committee-photos' and public.is_dashboard_admin());

commit;
