-- 117: Unity Cup - put the teams in the order you want
--
-- Teams were listed by when they were made, then by name, with no way to change it. The committee panel now has
-- "Move to top" and up/down buttons on each team, which call this. The new order is used everywhere teams are
-- listed (the public Teams section, the vote's team filter, the Squads tab and the fixture pickers).
--
-- Needs 115 and 116. Safe to run more than once.

begin;

create or replace function public.unity_admin_reorder_teams(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.unity__require_admin();
  -- the teams named, in the order given, come first; anything not named keeps its place after them
  update public.unity_teams t set sort = x.n - 1
    from unnest(coalesce(p_ids, '{}'::uuid[])) with ordinality as x(id, n)
   where t.id = x.id;
  update public.unity_teams t set sort = coalesce(array_length(p_ids, 1), 0) + r.rn
    from (select id, row_number() over (order by sort, name) as rn from public.unity_teams where id <> all (coalesce(p_ids, '{}'::uuid[]))) r
   where t.id = r.id;
end;
$$;
revoke all on function public.unity_admin_reorder_teams(uuid[]) from public, anon;
grant execute on function public.unity_admin_reorder_teams(uuid[]) to authenticated;

commit;
