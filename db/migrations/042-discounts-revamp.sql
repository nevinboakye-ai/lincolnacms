-- Discounts page revamp: a background-image field per partner card, and
-- a self-reported "times used" tracker per member per discount.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query,
-- paste, Run. Needs migration 003 (discounts) already applied.

-- =======================================================================
-- 1. A background photo per discount, optional, president-only to set.
-- =======================================================================

alter table public.discounts
  add column image_url text;

comment on column public.discounts.image_url is 'Optional - a background photo for the card, shown as a gradient-masked banner at the top that fades into the card''s normal background (never covers the whole card). President-only to set in practice: paste a public image URL via Table Editor. Leave blank for the plain colour-cycled card look.';

-- =======================================================================
-- 2. Usage tracking.
--
-- A real discount gets redeemed by showing the digital membership card
-- in person - there is no till integration, no way to know for certain
-- it was actually used. What this tracks instead is honest about that:
-- "Reveal code" taps (a real, measurable action) and a deliberate
-- "I used this" button a member can tap themselves after redeeming
-- in-store, entirely self-reported. One row per member per discount.
-- =======================================================================

create table public.discount_usage (
  member_id uuid not null references auth.users(id) on delete cascade,
  discount_id uuid not null references public.discounts(id) on delete cascade,
  reveal_count int not null default 0,
  used_count int not null default 0,
  first_revealed_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (member_id, discount_id)
);

comment on table public.discount_usage is 'Per-member, per-discount counters shown on member-perks.html - reveal_count from "Reveal code" taps, used_count self-reported via an "I used this" button. Not a real redemption record (no till integration exists), just an honest, member-facing engagement tracker. Written only through record_discount_reveal()/record_discount_used() below, never directly, so a member can''t inflate their own or anyone else''s numbers.';

alter table public.discount_usage enable row level security;

create policy "Members can view their own discount usage"
  on public.discount_usage for select
  to authenticated
  using (auth.uid() = member_id);

-- No insert/update policy for the client - both writes only ever happen
-- through the two security-definer RPCs below, which hardcode
-- member_id = auth.uid() themselves rather than trusting a client-
-- supplied value.

create or replace function public.record_discount_reveal(p_discount_id uuid)
returns table (reveal_count int, used_count int)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.discount_usage (member_id, discount_id, reveal_count, first_revealed_at)
  values (auth.uid(), p_discount_id, 1, now())
  on conflict (member_id, discount_id)
  do update set reveal_count = discount_usage.reveal_count + 1,
                first_revealed_at = coalesce(discount_usage.first_revealed_at, now());

  return query
  select du.reveal_count, du.used_count
  from public.discount_usage du
  where du.member_id = auth.uid() and du.discount_id = p_discount_id;
end;
$$;

create or replace function public.record_discount_used(p_discount_id uuid)
returns table (reveal_count int, used_count int)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.discount_usage (member_id, discount_id, used_count, last_used_at)
  values (auth.uid(), p_discount_id, 1, now())
  on conflict (member_id, discount_id)
  do update set used_count = discount_usage.used_count + 1,
                last_used_at = now();

  return query
  select du.reveal_count, du.used_count
  from public.discount_usage du
  where du.member_id = auth.uid() and du.discount_id = p_discount_id;
end;
$$;
