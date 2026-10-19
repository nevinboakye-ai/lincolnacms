-- 091: "View the website as…" for the president
--
-- The president can pick an account type (a Pharmacy Year 2 member, an Executive
-- Committee member, an alumni doctor, a logged-out visitor, or a real person)
-- and browse the site exactly as that account would see it, without needing a
-- spare login for each. The pages decide what to show from the Hub Access rules,
-- so this adds a way to ask "what would these rules give an account like this?"
-- for someone who doesn't exist.
--
-- 1. hub_access_rule_allows(): the rule check from hub_access_decision() pulled
--    into one function (member type, committee title, course, professional or
--    not). hub_access_decision() now calls it, so the real check and the preview
--    can never drift apart. Behaviour of hub_access_decision() is unchanged:
--    the president is always allowed, then a person's own override, then the rule.
-- 2. president_preview_hub_access(): president only. Returns the same columns as
--    get_my_hub_access() for an imagined account (type + course + title), or for
--    a real person (p_user) including their individual overrides.
--
-- Nothing is written anywhere. Safe to run more than once. Needs 060 and 061.

begin;

-- ---------------------------------------------------------------------
-- p_kind: 'member' or 'professional'. Anything else (a guest, a visitor) has
-- no Hub Access.
create or replace function public.hub_access_rule_allows(
  r public.hub_access_rules,
  p_kind text,
  p_member_type text,
  p_course text,
  p_committee_role text
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_kind = 'professional' then
    return coalesce(r.allow_professionals, false);
  end if;
  if p_kind is distinct from 'member' then
    return false;
  end if;

  if not coalesce(r.allow_members, false) then
    return false;
  end if;
  if r.member_types is not null and not (p_member_type = any (r.member_types)) then
    return false;
  end if;
  if r.titles is not null and not exists (
    select 1 from unnest(r.titles) t
    where lower(btrim(t)) = lower(btrim(coalesce(p_committee_role, '')))
  ) then
    return false;
  end if;
  if r.courses is not null and not exists (
    select 1 from unnest(r.courses) c
    where position(lower(c) in lower(coalesce(p_course, ''))) > 0
  ) then
    return false;
  end if;
  return true;
end;
$$;

revoke all on function public.hub_access_rule_allows(public.hub_access_rules, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Same behaviour as 061; the rule part now lives in hub_access_rule_allows().
create or replace function public.hub_access_decision(p_user uuid, p_feature text)
returns table (allowed boolean, via text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.hub_access_rules;
  m public.members;
  ov boolean;
begin
  if p_user is null then
    return query select false, 'rule'::text;
    return;
  end if;

  if p_user = '22044cd2-6804-4142-96c4-5c475ce9347a'::uuid then
    return query select true, 'president'::text;
    return;
  end if;

  select o.allow into ov
  from public.hub_access_overrides o
  where o.user_id = p_user and o.feature = p_feature;
  if found then
    return query select ov, case when ov then 'override_allow' else 'override_deny' end;
    return;
  end if;

  select * into r from public.hub_access_rules where feature = p_feature;
  if not found then
    return query select false, 'rule'::text;
    return;
  end if;

  select * into m from public.members where id = p_user;
  if found then
    return query select public.hub_access_rule_allows(r, 'member', m.member_type, m.course, m.committee_role), 'rule'::text;
    return;
  end if;

  if exists (
    select 1 from public.network_professionals np
    where np.user_id = p_user and np.is_active = true
  ) then
    return query select public.hub_access_rule_allows(r, 'professional', null, null, null), 'rule'::text;
    return;
  end if;

  return query select false, 'rule'::text;
end;
$$;

revoke all on function public.hub_access_decision(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
create or replace function public.president_preview_hub_access(
  p_kind text,
  p_member_type text default null,
  p_course text default null,
  p_committee_role text default null,
  p_user uuid default null
)
returns table (feature text, allowed boolean, blocked_display text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_president() then
    raise exception 'Only the president can view the site as someone else.';
  end if;

  if p_user is not null then
    -- A real person: exactly what their own account gets, overrides included.
    return query
    select r.feature,
           coalesce((select d.allowed from public.hub_access_decision(p_user, r.feature) d), false),
           r.blocked_display
    from public.hub_access_rules r
    order by r.feature;
    return;
  end if;

  return query
  select r.feature,
         public.hub_access_rule_allows(r, p_kind, coalesce(p_member_type, 'member'), p_course, p_committee_role),
         r.blocked_display
  from public.hub_access_rules r
  order by r.feature;
end;
$$;

revoke all on function public.president_preview_hub_access(text, text, text, text, uuid) from public, anon;
grant execute on function public.president_preview_hub_access(text, text, text, text, uuid) to authenticated;

commit;
