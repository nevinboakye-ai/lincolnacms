-- 132: Member of the Month becomes Member of the Semester (the words stored in the database)
--
-- The website, emails and dashboard now say "Member of the Semester". A few places keep their own copy of the old name
-- inside the database, so this updates those too:
--   * the badge texts (e.g. "Griot's Praise": "Nominated someone for Member of the Month...") in member_badge_defs
--   * the Member Journey step titles, which are written inside the journey__state functions
--   * the data-protection check that tells the committee where a person appears ("... winners wall ... Dashboard ->")
-- Nothing is renamed: the tables, functions, column names (motm_nominations, motm_winners, month_label, nomination_month)
-- and the motm.html address all stay as they are, so nothing breaks and old links keep working.
--
-- How the functions are changed: each function in the public schema whose source mentions the old name is read back from
-- the database (pg_get_functiondef), the phrase is swapped, and it is re-created. That way the latest version of each
-- function is the one that is updated, whatever migrations came before. Safe to run more than once (a second run finds
-- nothing left to change). Needs 088 and 099.

begin;

update public.member_badge_defs set
  name        = replace(replace(name,        'Member of the Month', 'Member of the Semester'), 'member of the month', 'member of the semester'),
  description = replace(replace(description, 'Member of the Month', 'Member of the Semester'), 'member of the month', 'member of the semester'),
  hint        = replace(replace(hint,        'Member of the Month', 'Member of the Semester'), 'member of the month', 'member of the semester')
 where name ilike '%member of the month%' or description ilike '%member of the month%' or hint ilike '%member of the month%';

do $$
declare r record; def text; n int := 0;
begin
  for r in
    select p.oid
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prokind = 'f'
       and (p.prosrc ilike '%member of the month%')
  loop
    def := pg_get_functiondef(r.oid);
    execute replace(replace(def, 'Member of the Month', 'Member of the Semester'), 'member of the month', 'member of the semester');
    n := n + 1;
  end loop;
  raise notice 'Member of the Semester: % function(s) updated.', n;
end $$;

commit;
