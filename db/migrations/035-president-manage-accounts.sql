-- Powers a new "Manage Accounts" card on the president dashboard — full
-- edit and delete for any LACMS member, Network professional or MMG
-- guest, directly from the site instead of Table Editor.
--
-- Three additive is_president()-gated policies per table (select,
-- update, delete) — alongside whatever policies already exist for each
-- table (self-registration, the president's own direct-insert policies
-- from migration 032), not replacing them. Deleting a row here only
-- ever removes that profile row, the same as deleting it in Table
-- Editor would — it does not and cannot delete the underlying
-- auth.users login, since that needs the service-role admin API, which
-- must never exist in browser code. Every other table's own foreign
-- keys into a person's account point at auth.users (cascade) rather
-- than at members/network_professionals/mmg_guests directly, except
-- network_join_events (already "on delete set null"), so deleting a
-- profile row here is a clean, unconstrained operation — it won't fail
-- with a foreign-key error, and won't silently take anything else with
-- it either.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. Needs 025 (is_president()) already applied.

create policy "President can view any member"
  on public.members for select
  to authenticated
  using (public.is_president());

create policy "President can update any member"
  on public.members for update
  to authenticated
  using (public.is_president())
  with check (public.is_president());

create policy "President can delete any member"
  on public.members for delete
  to authenticated
  using (public.is_president());

create policy "President can view any professional"
  on public.network_professionals for select
  to authenticated
  using (public.is_president());

create policy "President can update any professional"
  on public.network_professionals for update
  to authenticated
  using (public.is_president())
  with check (public.is_president());

create policy "President can delete any professional"
  on public.network_professionals for delete
  to authenticated
  using (public.is_president());

create policy "President can view any MMG guest"
  on public.mmg_guests for select
  to authenticated
  using (public.is_president());

create policy "President can update any MMG guest"
  on public.mmg_guests for update
  to authenticated
  using (public.is_president())
  with check (public.is_president());

create policy "President can delete any MMG guest"
  on public.mmg_guests for delete
  to authenticated
  using (public.is_president());
