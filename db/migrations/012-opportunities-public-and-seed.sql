-- Opportunities become data-driven from the same member_opportunities
-- table already used on member-perks.html's "Members-first opportunities"
-- section — one source of truth, managed from Table Editor.
--
-- The public opportunities.html page shows a preview (first couple) to
-- signed-out visitors, with the rest behind a "sign in" gradient lock,
-- and the full list once someone's confirmed as a LACMS member. That
-- preview requires public (anon) read access — these are recruitment
-- postings, not sensitive data, so the "members only" framing is a
-- product choice (encouraging sign-up) rather than a real security
-- boundary.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run.

alter table public.member_opportunities
  add column category text;

comment on column public.member_opportunities.category is 'Short tag shown on the card, e.g. "Work experience", "Scholarship", "Volunteering".';

drop policy if exists "Signed-in members can view active member opportunities" on public.member_opportunities;

create policy "Anyone can view active member opportunities"
  on public.member_opportunities for select
  to anon, authenticated
  using (is_active = true);

insert into public.member_opportunities (title, description, category, link, sort_order) values
('Clinical Shadowing — Lincoln County Hospital', 'A one-week placement shadowing doctors across two or three departments — a good early taste of clinical practice for pre-clinical students. Spaces are limited and offered on a first-come basis.', 'Work experience', 'mailto:acms@lincolnsu.com?subject=Clinical%20Shadowing%20interest', 1),
('Diversity in Medicine Bursary', 'A bursary aimed at Black and mixed-heritage students in medicine and healthcare degrees, covering course costs. Details on amount, eligibility and how to apply to follow once confirmed with the funding partner.', 'Scholarship', 'mailto:acms@lincolnsu.com?subject=Bursary%20info%20request', 2),
('Community Health Champions', 'Volunteer with a local charity delivering health education workshops to underserved communities in Lincoln. No clinical experience required — training is provided before your first session.', 'Volunteering', 'mailto:acms@lincolnsu.com?subject=Volunteering%20interest', 3),
('Widening Access Mentor', 'Support LACMS''s schools outreach programme by mentoring a sixth-form student applying to medicine. A one-to-one commitment across the academic year, supporting their UCAS application and interview prep. Full guidance provided.', 'Outreach', 'programmes.html#widening-access', 4),
('NHS Summer Internship Programme', 'A paid, six-week summer placement with an NHS partner trust, open through an external NHS partner for penultimate-year students. Application window and eligibility criteria to be confirmed closer to the time.', 'Careers', 'mailto:acms@lincolnsu.com?subject=Internship%20info%20request', 5);
