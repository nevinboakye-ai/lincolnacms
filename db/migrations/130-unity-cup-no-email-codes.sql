-- 130: Unity Cup - no emailed codes: voting and the raffle just accept the entry
--
-- Until now voting, the raffle and Man of the Match asked people to type a 6-digit code emailed to them first. That
-- needed the "unity-cup-code" email function to be deployed, and when it wasn't (or the email service was slow)
-- the entry form sat on "Sending..." and nobody could enter. The code step is gone:
--
--   * Raffle: name, email, donation amount and the tick box are enough. The entry is saved straight away and the
--     person gets their ticket number. The committee still checks every entry against the JustGiving donations
--     before the draw (Dashboard -> Unity Cup -> Raffle), so an entry that isn't backed by a real donation never wins.
--   * Player of the Tournament vote and Man of the Match: still one vote per email address (and one per game for
--     Man of the Match), still anonymous (we never store who voted for whom), still no throwaway email domains.
--     Without a code, nothing proves someone owns the address they typed, so a determined person could vote more than
--     once with made-up addresses. That is the trade-off of removing the check.
--   * Kept as before: the one-entry-per-email rule, the "at most 60 raffle entries a minute" cap, the donation minimum,
--     the confirm tick and the hidden spam trap field on the form.
--
-- The three functions below ignore the old "Email a code" setting for good (it is switched off in the database and the
-- switch is gone from the dashboard). The old code functions are removed, so the "unity-cup-code" edge function in
-- Supabase is no longer used and can be deleted. Needs 114, 116 and 126. Safe to run more than once.

begin;

update public.unity_settings set require_email_code = false where id = 1;
alter table public.unity_settings alter column require_email_code set default false;

-- Public: cast a vote (no code)
create or replace function public.unity_cast_vote(p_email text, p_code text, p_player uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.unity_settings%rowtype;
  h text; v_err text; v_open boolean;
begin
  select * into s from public.unity_settings where id = 1;
  v_open := s.voting_open and (s.voting_closes_at is null or now() < s.voting_closes_at);
  if not v_open then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if not public.unity_email_ok(btrim(p_email)) then return jsonb_build_object('ok', false, 'error', 'bad_email'); end if;
  if public.unity_disposable(p_email) then return jsonb_build_object('ok', false, 'error', 'disposable'); end if;
  if not exists (select 1 from public.unity_players where id = p_player and active) then
    return jsonb_build_object('ok', false, 'error', 'bad_player');
  end if;
  h := public.unity_email_hash(p_email);
  if exists (select 1 from public.unity_voters where email_hash = h) then
    return jsonb_build_object('ok', false, 'error', 'already_voted');
  end if;
  begin
    insert into public.unity_voters (email_hash) values (h);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already_voted');
  end;
  update public.unity_players set votes = votes + 1 where id = p_player;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.unity_cast_vote(text, text, uuid) from public;
grant execute on function public.unity_cast_vote(text, text, uuid) to anon, authenticated;

-- Public: enter the raffle (no code)
create or replace function public.unity_enter_raffle(p_name text, p_email text, p_code text, p_donor_name text, p_amount numeric, p_confirm boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.unity_settings%rowtype;
  h text; v_err text; v_open boolean; v_ticket int; v_name text := btrim(coalesce(p_name, ''));
begin
  select * into s from public.unity_settings where id = 1;
  v_open := s.raffle_open and (s.raffle_closes_at is null or now() < s.raffle_closes_at);
  if not v_open then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then return jsonb_build_object('ok', false, 'error', 'bad_name'); end if;
  if not public.unity_email_ok(btrim(p_email)) then return jsonb_build_object('ok', false, 'error', 'bad_email'); end if;
  if public.unity_disposable(p_email) then return jsonb_build_object('ok', false, 'error', 'disposable'); end if;
  if p_confirm is not true then return jsonb_build_object('ok', false, 'error', 'not_confirmed'); end if;
  if p_amount is null or p_amount < s.min_donation or p_amount > 100000 then return jsonb_build_object('ok', false, 'error', 'amount_too_low'); end if;
  if (select count(*) from public.unity_raffle_entries where created_at > now() - interval '1 minute') >= 60 then
    return jsonb_build_object('ok', false, 'error', 'busy');
  end if;
  h := public.unity_email_hash(p_email);
  if exists (select 1 from public.unity_raffle_entries where email_hash = h) then
    return jsonb_build_object('ok', false, 'error', 'already_entered');
  end if;
  begin
    insert into public.unity_raffle_entries (name, email, email_hash, donor_name, amount)
    values (v_name, lower(btrim(p_email)), h, nullif(left(btrim(coalesce(p_donor_name, '')), 80), ''), round(p_amount, 2))
    returning ticket_no into v_ticket;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already_entered');
  end;
  return jsonb_build_object('ok', true, 'ticket_no', v_ticket);
end;
$$;
revoke all on function public.unity_enter_raffle(text, text, text, text, numeric, boolean) from public;
grant execute on function public.unity_enter_raffle(text, text, text, text, numeric, boolean) to anon, authenticated;

-- Public: sign in once to vote for Man of the Match (no code)
create or replace function public.unity_mom_verify(p_email text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.unity_settings%rowtype;
  h text; v_err text; v_voter uuid; v_token text;
begin
  select * into s from public.unity_settings where id = 1;
  if not public.unity_email_ok(btrim(p_email)) then return jsonb_build_object('ok', false, 'error', 'bad_email'); end if;
  if public.unity_disposable(p_email) then return jsonb_build_object('ok', false, 'error', 'disposable'); end if;
  h := public.unity_email_hash(p_email);
  insert into public.unity_mom_voters (email_hash) values (h) on conflict (email_hash) do nothing;
  select id into v_voter from public.unity_mom_voters where email_hash = h;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.unity_mom_tokens (token_hash, voter_id) values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_voter);
  -- keep the five newest sign-ins per person
  delete from public.unity_mom_tokens
   where voter_id = v_voter
     and token_hash not in (select token_hash from public.unity_mom_tokens where voter_id = v_voter order by seq desc limit 5);
  return jsonb_build_object('ok', true, 'token', v_token,
    'voted', coalesce((select jsonb_agg(b.fixture_id) from public.unity_mom_ballots b where b.voter_id = v_voter), '[]'::jsonb));
end;
$$;
revoke all on function public.unity_mom_verify(text, text) from public;
grant execute on function public.unity_mom_verify(text, text) to anon, authenticated;

-- The emailed-code functions are not needed any more.
drop function if exists public.unity_request_code(text, text);
drop function if exists public.unity_check_code(text, text, text);

commit;
