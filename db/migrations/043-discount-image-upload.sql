-- Lets the president upload a discount's photo directly from the site
-- itself (member-perks.html), as an alternative to pasting an image URL
-- into Table Editor (migration 042's discounts.image_url) - same end
-- result either way, just a second, easier path to it for the one
-- person who'd actually use it day to day.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query,
-- paste, Run. Needs migration 025 (is_president()) and 042
-- (discounts.image_url) already applied.

-- A public bucket - these are partner business photos, not sensitive,
-- and already end up on a page any signed-in committee member can see
-- regardless of bucket visibility. Public read keeps this simple (a
-- plain public URL in discounts.image_url, same as every other image
-- already used across the site); only the president can write to it.
insert into storage.buckets (id, name, public)
values ('discount-images', 'discount-images', true)
on conflict (id) do nothing;

drop policy if exists "Anyone can view discount images" on storage.objects;
create policy "Anyone can view discount images"
  on storage.objects for select
  to public
  using (bucket_id = 'discount-images');

drop policy if exists "President can upload discount images" on storage.objects;
create policy "President can upload discount images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'discount-images' and public.is_president());

drop policy if exists "President can replace discount images" on storage.objects;
create policy "President can replace discount images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'discount-images' and public.is_president());

drop policy if exists "President can remove discount images" on storage.objects;
create policy "President can remove discount images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'discount-images' and public.is_president());

-- The one write the client is allowed to make to discounts itself -
-- just this one column, only the president, so uploading a photo can't
-- be abused as a back door into editing a discount's code/description/
-- link (which stay Table Editor-only, same as before this migration).
create or replace function public.president_set_discount_image(p_discount_id uuid, p_image_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;

  update public.discounts
  set image_url = p_image_url
  where id = p_discount_id;
end;
$$;
