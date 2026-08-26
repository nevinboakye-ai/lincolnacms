-- Lets a professional's "Edit network profile" save actually reach
-- their own Network card. The form always wrote to member_profiles,
-- which only the LACMS-member side of the directory (get_network_
-- members(), joined against member_profiles) ever reads. A
-- professional's own card comes straight from network_professionals
-- instead, so a saved bio/LinkedIn never showed up there.
--
-- A plain UPDATE policy isn't used here because network_professionals
-- mixes committee-controlled fields (title, category, organisation,
-- is_active, sort_order) with these two self-editable ones in the same
-- row — a SECURITY DEFINER function that only ever touches bio and
-- linkedin_url keeps a professional from being able to rewrite their
-- own title/category via a crafted API call, same reasoning that kept
-- member_profiles a separate table from members in the first place.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query,
-- paste, Run. Needs migration 015 already applied.
create or replace function public.update_professional_profile(p_linkedin_url text, p_bio text)
returns setof public.network_professionals
language sql
security definer
set search_path = public
as $$
  update public.network_professionals
    set linkedin_url = p_linkedin_url, bio = p_bio
    where user_id = auth.uid()
  returning *;
$$;
