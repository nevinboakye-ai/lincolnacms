-- Fixes "Couldn't load this section: structure of query does not match
-- function result type" on the president dashboard's Nominations card.
-- That's a genuine Postgres runtime error from RETURN QUERY finding a
-- different column count/order/type than the function's own declared
-- RETURNS TABLE — which shouldn't be possible from 028's SQL as written,
-- so the most likely explanation is the function actually deployed on
-- this database has drifted from that file somehow (a stray manual
-- edit, an earlier partial run, or a second overload with a different
-- signature confusing which one gets called). Rather than guess which,
-- this drops every version of the function outright and recreates it
-- fresh from known-correct SQL — the safe, idempotent way to guarantee
-- a clean, singular function regardless of how it drifted.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run. Needs 025 (is_president()) already applied. If the error somehow
-- persists after running this, try Settings → API → "Reload schema" —
-- PostgREST caches function signatures separately from Postgres itself
-- and occasionally needs a manual nudge to notice a function changed.

drop function if exists public.president_get_motm_nominations() cascade;

create function public.president_get_motm_nominations()
returns table (
  id uuid, nominee_name text, reason text, nominator_name text, nominator_email text, created_at timestamptz
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
    select mn.id, mn.nominee_name, mn.reason,
           coalesce(m.full_name, np.full_name, u.email::text) as nominator_name,
           u.email::text as nominator_email,
           mn.created_at
    from public.motm_nominations mn
    left join public.members m on m.id = mn.nominator_id
    left join public.network_professionals np on np.user_id = mn.nominator_id
    left join auth.users u on u.id = mn.nominator_id
    order by mn.created_at desc;
end;
$$;
