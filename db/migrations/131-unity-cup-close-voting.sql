-- 131: Unity Cup is over: close Man of the Match and Player of the Tournament voting
--
-- The website now shows the final results and hides voting on its own (js/unity-results-data.js says the tournament is
-- over), but the database would still accept a vote sent straight to it. This switches voting off there too:
--   * Man of the Match voting is closed for every match (the winners were never revealed, so nothing is shown publicly)
--   * Player of the Tournament voting is closed
-- The raffle and photo uploads are NOT touched: close or leave them in Dashboard -> Unity Cup -> Settings.
-- Safe to run more than once. Needs 126.

begin;
update public.unity_fixtures set mom_open = false where mom_open;
update public.unity_settings set voting_open = false where id = 1;
commit;
