-- Professional accounts — turns "a professional the committee added to
-- network_professionals, then invited via Supabase Auth" into "someone
-- with real hub access" automatically on their first login, instead of
-- needing the committee to also paste a UUID by hand (the way LACMS
-- members are linked today).
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. Needs migration 014 already applied. See README-members-setup.md.

-- ---------------------------------------------------------------------
-- `email` is how a freshly-confirmed professional gets matched to the
-- row the committee already created for them; `user_id` is filled in
-- once, automatically, the first time they land on the members hub
-- after setting their password. Both are new — if you already have
-- professionals in the table, add their email addresses afterwards
-- (Table Editor → network_professionals) so they can claim their row.
alter table public.network_professionals
  add column email text,
  add column user_id uuid unique references auth.users(id) on delete set null;

create unique index network_professionals_email_key on public.network_professionals (lower(email));

comment on column public.network_professionals.email is 'Must match the email the committee invites them with (Authentication → Invite user) — used once, automatically, to link their account.';

-- ---------------------------------------------------------------------
-- Runs the moment a professional lands on the members hub for the first
-- time after setting their password (js/members.js calls this before
-- giving up and showing the "couldn't find your profile" message).
-- Matches their auth email to an unclaimed network_professionals row and
-- links it — SECURITY DEFINER because before claiming, RLS gives them no
-- access to that row at all. Safe to call on every visit: once user_id
-- is set the update matches zero rows and it's a no-op.
create or replace function public.claim_professional_profile()
returns setof public.network_professionals
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text;
begin
  select email into caller_email from auth.users where id = auth.uid();
  if caller_email is not null then
    update public.network_professionals
      set user_id = auth.uid()
      where lower(email) = lower(caller_email) and user_id is null;
  end if;

  return query
    select * from public.network_professionals where user_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------
-- Same shape as is_lacms_member() — lets policies elsewhere (MoTM
-- nominations, the Network directory) grant a professional the same
-- access as a member without querying network_professionals directly.
create or replace function public.is_professional()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.network_professionals
    where user_id = auth.uid() and is_active = true
  );
$$;

-- ---------------------------------------------------------------------
-- Professionals can now browse the professionals list themselves too
-- (previously LACMS members only), including their own card once claimed.
drop policy if exists "LACMS members can view active professionals" on public.network_professionals;

create policy "Members and professionals can view active professionals"
  on public.network_professionals for select
  to authenticated
  using (is_active = true and (public.is_lacms_member() or public.is_professional()));

-- ---------------------------------------------------------------------
-- The member directory (get_network_members(), from migration 014) is
-- now open to professionals too — they're part of the Network.
create or replace function public.get_network_members()
returns table (
  id uuid,
  full_name text,
  course text,
  year_of_study text,
  member_type text,
  committee_role text,
  linkedin_url text,
  bio text
)
language sql
security definer
stable
set search_path = public
as $$
  select m.id, m.full_name, m.course, m.year_of_study, m.member_type, m.committee_role,
         p.linkedin_url, p.bio
  from public.members m
  left join public.member_profiles p on p.id = m.id
  where (public.is_lacms_member() or public.is_professional()) and m.membership_status = 'active';
$$;

-- ---------------------------------------------------------------------
-- Member of the Month nominations — professionals can nominate too now.
drop policy if exists "LACMS members can submit a nomination" on public.motm_nominations;

create policy "Members and professionals can submit a nomination"
  on public.motm_nominations for insert
  to authenticated
  with check (
    auth.uid() = nominator_id
    and (exists (select 1 from public.members m where m.id = auth.uid()) or public.is_professional())
  );

-- ---------------------------------------------------------------------
-- No changes needed for discounts or member_opportunities — discounts
-- is already readable by any authenticated user, and member_opportunities
-- is public. Sankofa applications are deliberately left members-only —
-- professionals see a "coming soon" card on the hub instead, since a
-- dedicated Sankofa platform for them is planned separately.
