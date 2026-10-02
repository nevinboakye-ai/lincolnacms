-- Lets a member undo their own "I used this" tap - there was previously
-- no way back from an accidental one, since record_discount_used()
-- (migration 042) only ever increments. Mirrors it exactly: same
-- member_id = auth.uid() scoping (never trusts a client-supplied id),
-- same return shape, so js/members.js can treat the two interchangeably.
-- Floors at 0 rather than going negative, in case it's ever called with
-- nothing to undo.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query,
-- paste, Run. Needs migration 042 already applied.

create or replace function public.undo_discount_used(p_discount_id uuid)
returns table (reveal_count int, used_count int)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.discount_usage
  set used_count = greatest(used_count - 1, 0)
  where member_id = auth.uid() and discount_id = p_discount_id;

  return query
  select du.reveal_count, du.used_count
  from public.discount_usage du
  where du.member_id = auth.uid() and du.discount_id = p_discount_id;
end;
$$;
