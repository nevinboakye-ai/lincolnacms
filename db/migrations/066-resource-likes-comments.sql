-- Likes and comments on LACMS Resources.
--
-- Anyone who can open an approved resource (the "resources" Hub Access
-- rule, or an executive) can like it and comment on it. Executives can
-- delete any comment; everyone can delete their own. Nothing here touches
-- the resources table itself - counts are computed on demand by
-- get_resource_engagement() - so liking can never interfere with a
-- resource's review status.
--
-- Privacy: who liked what isn't readable by other members (each person
-- can only read their own like rows); the counts come from the security-
-- definer function below. Comments are public to anyone who can see the
-- resource, with the author's name stamped by the database (it can't be
-- faked from the browser).
--
-- Wrapped in a transaction. Run this once in Supabase: Dashboard -> SQL
-- Editor -> New query, paste, Run. Needs 060 and 065.

begin;

-- Can the caller see this resource at all (same rule as the resources
-- table's own read policy)? / interact with it (approved + access)?
create or replace function public.can_see_resource(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.resources r
    where r.id = p_id
      and (
        (r.status = 'approved' and public.has_hub_access('resources'))
        or r.uploader_id = auth.uid()
        or public.is_dashboard_admin()
      )
  );
$$;

create or replace function public.can_interact_resource(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.resources r
    where r.id = p_id
      and r.status = 'approved'
      and (public.has_hub_access('resources') or public.is_dashboard_admin())
  );
$$;

revoke all on function public.can_see_resource(uuid) from public, anon;
revoke all on function public.can_interact_resource(uuid) from public, anon;
grant execute on function public.can_see_resource(uuid) to authenticated;
grant execute on function public.can_interact_resource(uuid) to authenticated;

-- ---------------------------------------------------------------------
create table if not exists public.resource_likes (
  resource_id uuid not null references public.resources(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (resource_id, user_id)
);

alter table public.resource_likes enable row level security;

drop policy if exists "Read your own likes" on public.resource_likes;
create policy "Read your own likes"
  on public.resource_likes for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Like a resource" on public.resource_likes;
create policy "Like a resource"
  on public.resource_likes for insert
  to authenticated
  with check (user_id = auth.uid() and public.can_interact_resource(resource_id));

drop policy if exists "Remove your own like" on public.resource_likes;
create policy "Remove your own like"
  on public.resource_likes for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
create table if not exists public.resource_comments (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete cascade,
  author_id uuid default auth.uid() references auth.users(id) on delete set null,
  author_name text not null default 'LACMS member',
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists resource_comments_resource_idx on public.resource_comments (resource_id, created_at);

alter table public.resource_comments enable row level security;

drop policy if exists "Read comments on resources you can see" on public.resource_comments;
create policy "Read comments on resources you can see"
  on public.resource_comments for select
  to authenticated
  using (public.can_see_resource(resource_id));

drop policy if exists "Comment on an approved resource" on public.resource_comments;
create policy "Comment on an approved resource"
  on public.resource_comments for insert
  to authenticated
  with check (author_id = auth.uid() and public.can_interact_resource(resource_id));

drop policy if exists "Delete your own comment, executives delete any" on public.resource_comments;
create policy "Delete your own comment, executives delete any"
  on public.resource_comments for delete
  to authenticated
  using (author_id = auth.uid() or public.is_dashboard_admin());

-- The name on a comment is stamped here, not taken from the browser.
create or replace function public.resource_comments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  nm text;
begin
  if auth.uid() is not null then
    new.author_id := auth.uid();
    select m.full_name into nm from public.members m where m.id = auth.uid();
    if nm is null then
      select np.full_name into nm from public.network_professionals np where np.user_id = auth.uid();
    end if;
    new.author_name := coalesce(nm, 'LACMS member');
  end if;
  new.body := btrim(new.body);
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists resource_comments_before_insert on public.resource_comments;
create trigger resource_comments_before_insert
  before insert on public.resource_comments
  for each row
  execute function public.resource_comments_before_insert();

-- ---------------------------------------------------------------------
-- Counts and "have I liked it" for a batch of resources (only for the
-- ones the caller may see).
create or replace function public.get_resource_engagement(p_ids uuid[])
returns table (resource_id uuid, like_count integer, comment_count integer, liked_by_me boolean)
language sql
stable
security definer
set search_path = public
as $$
  select r.id,
         (select count(*) from public.resource_likes l where l.resource_id = r.id)::int,
         (select count(*) from public.resource_comments c where c.resource_id = r.id)::int,
         exists (select 1 from public.resource_likes l where l.resource_id = r.id and l.user_id = auth.uid())
  from unnest(p_ids) as t(id)
  join public.resources r on r.id = t.id
  where public.can_see_resource(r.id);
$$;

revoke all on function public.get_resource_engagement(uuid[]) from public, anon;
grant execute on function public.get_resource_engagement(uuid[]) to authenticated;

commit;
