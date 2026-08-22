-- Shortens membership numbers from 5 digits to 3 (e.g. LACMS-482 instead
-- of LACMS-73412). Safe to run whether or not 004 has already been run —
-- this just replaces the number-generating function and re-backfills.
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query, paste,
-- Run.

create or replace function public.generate_membership_number()
returns trigger as $$
declare
  candidate text;
  attempts int := 0;
begin
  if new.membership_number is not null then
    return new;
  end if;
  loop
    candidate := 'LACMS-' || lpad((floor(random() * 900) + 100)::int::text, 3, '0');
    exit when not exists (select 1 from public.members where membership_number = candidate);
    attempts := attempts + 1;
    if attempts > 20 then
      raise exception 'Could not generate a unique membership number';
    end if;
  end loop;
  new.membership_number := candidate;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Re-randomize every existing member's number down to the new 3-digit
-- format too.
do $$
declare
  r record;
  candidate text;
  attempts int;
begin
  for r in select id from public.members loop
    attempts := 0;
    loop
      candidate := 'LACMS-' || lpad((floor(random() * 900) + 100)::int::text, 3, '0');
      exit when not exists (select 1 from public.members where membership_number = candidate);
      attempts := attempts + 1;
      exit when attempts > 20;
    end loop;
    update public.members set membership_number = candidate where id = r.id;
  end loop;
end $$;
