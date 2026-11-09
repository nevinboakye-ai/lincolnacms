-- 134: LACMS Wrapped gets a "Favourite business partner" question
--
-- Adds a pick-one question (with a "Something else..." box) right after "Favourite event". Its answers start as the
-- businesses currently on the Perks page (the active rows in the discounts table), copied in once so the committee can
-- tidy them: Dashboard -> LACMS Wrapped -> Questions lets you rename, hide, remove or add businesses. Nothing is
-- linked live to the Perks page, and the perk codes themselves are never copied, only the business names.
-- Needs 133. Safe to run more than once (it does nothing if the question already exists).

begin;

do $$
declare c uuid; q uuid;
begin
  select id into c from public.wrapped_campaigns where is_current limit 1;
  if c is null then raise notice 'No current Wrapped found: run migration 133 first.'; return; end if;
  if exists (select 1 from public.wrapped_categories where campaign_id = c and key = 'favourite_partner') then return; end if;

  insert into public.wrapped_categories (campaign_id, key, title, prompt, kind, option_source, allow_other, max_len, emoji, sort)
  values (c, 'favourite_partner', 'Favourite business partner', 'Which of our business partners do you rate most? Pick one, or tell us another.', 'choice', 'list', true, 60, '🤝', 25)
  returning id into q;

  insert into public.wrapped_options (category_id, label, sort)
  select q, left(btrim(x.partner_name), 80), (row_number() over (order by x.first_sort, x.partner_name)) * 10
    from (select partner_name, min(sort_order) as first_sort
            from public.discounts
           where is_active and btrim(coalesce(partner_name, '')) <> ''
           group by partner_name) x;
end $$;

commit;
