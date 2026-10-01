-- Lets the president drag a discount's photo around within its card to
-- reposition it, on top of the direct-upload feature from migration 043.
-- Same scoping pattern as everything else here: one column write, gated
-- to the president, nothing else on the discounts row touchable from the
-- client.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query,
-- paste, Run. Needs migration 043 (discount-images bucket, is_president())
-- already applied.

alter table public.discounts
  add column if not exists image_position text not null default '50% 50%';

create or replace function public.president_set_discount_image_position(p_discount_id uuid, p_position text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Not authorized';
  end if;

  if p_position !~ '^[0-9]{1,3}% [0-9]{1,3}%$' then
    raise exception 'Invalid position format';
  end if;

  update public.discounts
  set image_position = p_position
  where id = p_discount_id;
end;
$$;

-- Redefines 043's function to also reset image_position back to centred -
-- whatever framing suited the old photo (if any) rarely still suits a
-- brand new one, so a fresh upload shouldn't inherit a stale position.
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
  set image_url = p_image_url, image_position = '50% 50%'
  where id = p_discount_id;
end;
$$;
