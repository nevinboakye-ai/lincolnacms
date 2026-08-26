-- Adds an optional "address" field to discounts — for the partner's real-life
-- building address, a social media handle/link, or a website, whichever is
-- most useful for members to find them. Shown on the card between the
-- partner name and the description.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste, Run.

alter table public.discounts
  add column address text;

comment on column public.discounts.address is 'Optional — physical address, social media handle, or website, shown under the partner name.';
