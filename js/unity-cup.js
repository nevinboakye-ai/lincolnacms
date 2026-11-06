// Unity Cup portal - open to everyone, no account needed.
//
// The portal is an overview page (unity-cup.html) and one page per section:
//   unity-cup-fixtures.html   fixtures, results and group tables
//   unity-cup-teams.html      the squads
//   unity-cup-vote.html       Player of the Tournament vote  (email code, one vote per address, ballots anonymous)
//   unity-cup-raffle.html     charity raffle                 (donation entry, wheel, committee-verified draw)
//   unity-cup-photos.html     share your photos and videos   (reviewed by the committee before they show)
//   unity-cup-essence.html    the ESSENCE party the next night
// This one script runs on all of them. Every render function looks for its own elements and quietly does
// nothing when the page doesn't have them, so a page only ever shows (and updates) its own section.
//
// All data comes from, and goes to, the database functions in db/migrations/114-unity-cup.sql. The emailed
// code is sent by the edge function supabase/functions/unity-cup-code. Nothing here is trusted: the
// database re-checks everything (open/closed, one vote per address, code, amounts).

(function () {
  'use strict';

  var root = document.getElementById('uc-root');
  if (!root) return;

  var PAGE = { fixtures: 'unity-cup-fixtures.html', teams: 'unity-cup-teams.html', vote: 'unity-cup-vote.html', raffle: 'unity-cup-raffle.html', photos: 'unity-cup-photos.html', essence: 'unity-cup-essence.html', hub: 'unity-cup.html' };

  var LS = { voted: 'lacms-unity-voted', ticket: 'lacms-unity-ticket', media: 'lacms-unity-media' };
  var POLL_MS = 15000;
  var MAX_FILES = 8, MAX_BYTES = 50 * 1024 * 1024;
  var ALLOWED_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };

  var ERR = {
    closed: 'That has closed, so it can\'t take anything new.',
    bad_email: 'That email address doesn\'t look right. Please check it.',
    disposable: 'Please use a real email address that you check, not a temporary one.',
    bad_player: 'That player isn\'t available. Please pick again.',
    already_voted: 'This email address has already been used to vote. It\'s one vote each!',
    already_entered: 'This email address has already entered the raffle.',
    no_code: 'Please ask for a code first.',
    code_expired: 'That code has expired. Ask for a new one.',
    too_many_attempts: 'Too many wrong tries. Please ask for a new code.',
    bad_code: 'That code isn\'t right. Check the email and try again.',
    rate_limited: 'You\'ve asked for a few codes already. Please wait a few minutes (and check your spam folder).',
    busy: 'It\'s very busy right now. Please try again in a minute.',
    send_failed: 'We couldn\'t send the email. Please check the address and try again.',
    not_confirmed: 'Please tick the box to confirm.',
    amount_too_low: 'The minimum donation to enter is shown above.',
    bad_name: 'Please enter your name.',
    missing_file: 'That upload didn\'t finish. Please try again.',
    bad_path: 'That file couldn\'t be accepted.',
    server: 'Something went wrong on our side. Please try again in a moment.'
  };

  var S = null;              // latest public state from unity_get_state()
  var selected = null;       // player id picked for the vote
  var wheel = null;
  var knownDraws = null;     // ids of draws already seen, so a new one can be celebrated
  var modalEl = null, lastFocus = null;
  var filterTeam = '';
  var queue = [];            // files waiting to be sent
  var teamsById = {}, fxSig = '', teamSig = '';
  var fxTab = 'fixtures';    // fixtures | table

  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function errText(key) { return ERR[key] || ERR.server; }
  function money(n) { n = Number(n); return '£' + (n % 1 === 0 ? String(n) : n.toFixed(2)); }
  function initials(name) { var p = String(name || '?').trim().split(/\s+/); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
  function say(text) { var el = $('#uc-live'); if (el) { el.textContent = ''; window.setTimeout(function () { el.textContent = text; }, 30); } }
  function validEmail(v) { return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v) && v.length <= 254; }

  var ICON = {
    ball: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><circle cx="32" cy="32" r="28"/><path d="M32 20l10 7.3-3.8 11.7H25.8L22 27.3z" fill="currentColor" fill-opacity=".9"/><path d="M32 20V6M42 27.3l14-4.2M38.2 39l8.6 12M25.8 39l-8.6 12M22 27.3l-14-4.2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>',
    ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>'
  };

  // ---------------------------------------------------------------------
  // Data
  function ready() { return typeof supabaseIsConfigured !== 'undefined' && supabaseIsConfigured && typeof supabaseClient !== 'undefined' && supabaseClient; }

  function loadState(quiet) {
    if (!ready()) return Promise.resolve(false);
    return supabaseClient.rpc('unity_get_state').then(function (res) {
      if (res.error || !res.data) { if (!S) showUnavailable(); return false; }
      var first = !S;
      S = res.data;
      teamsById = {}; (S.teams || []).forEach(function (t) { teamsById[t.id] = t; });
      if (first) {
        knownDraws = {}; (S.draws || []).forEach(function (d) { knownDraws[d.id] = 1; });
        // a link from another page can pre-select a player (?player=) for the vote
        if (selected && !(S.players || []).some(function (p) { return p.id === selected; })) selected = null;
      }
      renderAll(first);
      if (!first) watchDraws();
      return true;
    }, function () { if (!S) showUnavailable(); return false; });
  }

  function showUnavailable() {
    $$('[data-uc-loading]').forEach(function (n) { n.innerHTML = '<p class="uc-empty">The Unity Cup page is getting ready. Please check back very soon.</p>'; });
  }

  // ---------------------------------------------------------------------
  // Rendering
  function renderAll(first) {
    renderHero();
    renderNav();
    renderHub();
    renderFixtures();
    renderTeams();
    renderVote();
    renderRaffle(first);
    renderMedia();
  }

  function dayLabel() {
    if (!S || !S.event_date) return '';
    var d = new Date(S.event_date + 'T00:00:00');
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var diff = Math.round((d - today) / 86400000);
    var nice = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    return { nice: nice, diff: diff };
  }

  function chip(on, onText, offText) {
    return '<span class="uc-pill ' + (on ? 'is-on' : 'is-off') + '"><i aria-hidden="true"></i>' + esc(on ? onText : offText) + '</span>';
  }

  function renderHero() {
    var dl = dayLabel();
    var when = '';
    if (dl) {
      when = '<span class="uc-meta-chip">' + esc(dl.nice) + '</span>';
      if (dl.diff > 1) when += '<span class="uc-meta-chip uc-meta-chip--hot">in ' + dl.diff + ' days</span>';
      else if (dl.diff === 1) when += '<span class="uc-meta-chip uc-meta-chip--hot">tomorrow</span>';
      else if (dl.diff === 0) when += '<span class="uc-meta-chip uc-meta-chip--live"><i aria-hidden="true"></i>Match day</span>';
    }
    if (S.kickoff_text) when += '<span class="uc-meta-chip">' + esc(S.kickoff_text) + '</span>';
    if (S.venue_text) when += '<span class="uc-meta-chip">' + esc(S.venue_text) + '</span>';
    var meta = $('#uc-hero-meta'); if (meta) meta.innerHTML = when;
    var st = $('#uc-hero-status');
    var votePill = chip(S.voting_open, 'Voting open', S.show_results ? 'Voting closed' : 'Voting opens soon');
    var rafflePill = chip(S.raffle_open, 'Raffle open', 'Raffle opens soon');
    var mediaPill = chip(S.media_open, 'Share your moments', 'Uploads closed');
    if (st) st.innerHTML = votePill + rafflePill + mediaPill;
    // the section pages show just the status that belongs to them
    $$('[data-uc-status]').forEach(function (el) {
      var k = el.getAttribute('data-uc-status'), h = '';
      if (k === 'vote') h = votePill;
      else if (k === 'raffle') h = rafflePill + (S.raffle_entries ? '<span class="uc-pill">' + S.raffle_entries + (S.raffle_entries === 1 ? ' entry' : ' entries') + ' so far</span>' : '');
      else if (k === 'photos') h = mediaPill;
      else if (k === 'fixtures') {
        var lv = liveFixtures().length;
        h = lv ? '<span class="uc-pill is-on"><i aria-hidden="true"></i>' + lv + (lv === 1 ? ' match live now' : ' matches live now') + '</span>' : '';
      }
      el.innerHTML = h;
    });
  }

  // ----- Section navigation: live dots on the tabs, and the overview page -----
  var navSig = '';
  function liveFixtures() { return (S.fixtures || []).filter(function (f) { return f.status === 'live' && teamsById[f.home_team_id] && teamsById[f.away_team_id]; }); }
  function renderNav() {
    var dots = { fixtures: liveFixtures().length ? 'a match is live now' : '', vote: S.voting_open ? 'voting is open' : '', raffle: S.raffle_open ? 'the raffle is open' : '' };
    var sig = JSON.stringify(dots);
    if (sig === navSig) return;
    navSig = sig;
    $$('.uc-subnav [data-uc-nav]').forEach(function (a) {
      $$('.uc-navdot, .uc-navtxt', a).forEach(function (n) { n.parentNode.removeChild(n); });
      var k = a.getAttribute('data-uc-nav');
      if (dots[k]) a.insertAdjacentHTML('beforeend', '<i class="uc-navdot" aria-hidden="true"></i><span class="uc-navtxt visually-hidden"> (' + dots[k] + ')</span>');
    });
  }

  function nextUpFixtures(fx) {
    var live = fx.filter(function (f) { return f.status === 'live'; });
    var now = Date.now();
    var upcoming = fx.filter(function (f) { return f.status === 'scheduled' && f.kickoff_at && new Date(f.kickoff_at).getTime() >= now - 20 * 60000; }).sort(function (a, b) { return new Date(a.kickoff_at) - new Date(b.kickoff_at); });
    return { live: live, upcoming: upcoming, feature: live.length ? live : upcoming.slice(0, 1) };
  }

  function hubStatus(key, text, live) {
    var el = $('[data-hub-status="' + key + '"]'); if (!el) return;
    el.className = 'uc-hubcard-status' + (live ? ' is-live' : '');
    el.innerHTML = (live ? '<i aria-hidden="true"></i>' : '') + esc(text);
  }

  function renderHub() {
    var strip = $('#uc-hub-live');
    if (!strip && !$('[data-hub-status]')) return;
    var fx = (S.fixtures || []).filter(function (f) { return teamsById[f.home_team_id] && teamsById[f.away_team_id]; });
    var nu = nextUpFixtures(fx);
    if (strip) {
      strip.innerHTML = nu.feature.length ? '<div class="uc-next"><span class="uc-next-label">' + (nu.live.length ? '<i></i>Live now' : 'Next up') + '</span><ul class="uc-fx-list">' + nu.feature.map(fixtureCard).join('') + '</ul>' +
        '<a class="uc-next-more" href="' + PAGE.fixtures + '">All fixtures &amp; results ' + ICON.arrow + '</a></div>' : '';
    }
    var lv = nu.live[0], up = nu.upcoming[0];
    if (lv) hubStatus('fixtures', 'Live: ' + teamsById[lv.home_team_id].name + ' ' + (lv.home_score == null ? 0 : lv.home_score) + '–' + (lv.away_score == null ? 0 : lv.away_score) + ' ' + teamsById[lv.away_team_id].name + (nu.live.length > 1 ? ' (+' + (nu.live.length - 1) + ' more)' : ''), true);
    else if (up) hubStatus('fixtures', 'Next: ' + teamsById[up.home_team_id].name + ' v ' + teamsById[up.away_team_id].name + ' · ' + timeOf(kickDate(up)));
    else if (fx.length) hubStatus('fixtures', fx.length + (fx.length === 1 ? ' match' : ' matches') + ' · ' + fx.filter(function (f) { return f.status === 'finished'; }).length + ' played');
    else hubStatus('fixtures', 'Fixtures coming soon');
    var tn = (S.teams || []).length, pn = (S.players || []).length;
    hubStatus('teams', tn ? tn + (tn === 1 ? ' team' : ' teams') + (pn ? ' · ' + pn + (pn === 1 ? ' player' : ' players') : '') : 'Teams announced soon');
    if (S.voting_open) hubStatus('vote', lsGet(LS.voted) ? 'Voting open · you\'ve voted' : 'Voting open', true);
    else hubStatus('vote', S.show_results ? 'Voting closed · see the result' : 'Voting opens on the day');
    var en = S.raffle_entries || 0;
    if (S.raffle_open) hubStatus('raffle', (en ? en + (en === 1 ? ' entry' : ' entries') + ' · ' : '') + 'from ' + money(S.min_donation), true);
    else hubStatus('raffle', (S.draws || []).length ? 'Winners drawn' : 'Raffle opens soon');
    var mn = (S.media || []).length;
    hubStatus('photos', mn ? mn + (mn === 1 ? ' photo or video' : ' photos & videos') + (S.media_open ? ' · share yours' : '') : (S.media_open ? 'Be the first to share' : 'Uploads closed'));
  }

  // ----- Vote -----
  function renderVote() {
    var wrap = $('#uc-players'); if (!wrap) return;
    var players = S.players || [];
    var voted = lsGet(LS.voted);
    var banner = $('#uc-vote-banner');
    var results = S.show_results && !S.voting_open;
    var showBars = S.show_results;

    if (banner) {
      var msg = '';
      if (results) msg = '<div class="uc-banner uc-banner--done"><strong>Voting is closed.</strong> Here is how the Player of the Tournament vote finished.</div>';
      else if (!S.voting_open) msg = '<div class="uc-banner"><strong>Voting isn&rsquo;t open yet.</strong> It opens during the tournament, so check back on the day. The players are below.</div>';
      else if (voted) msg = '<div class="uc-banner uc-banner--done"><span class="uc-tick">' + ICON.check + '</span><span><strong>You&rsquo;ve voted. Thank you!</strong> One vote each.</span></div>';
      banner.innerHTML = msg;
    }

    if (!players.length) {
      wrap.innerHTML = '<p class="uc-empty">The players will appear here once the teams are confirmed.</p>';
      $('#uc-team-filter').innerHTML = ''; $('#uc-votebar').hidden = true;
      return;
    }

    // team filter
    var teams = [];
    (S.teams || []).forEach(function (t) { if (players.some(function (p) { return p.team_id === t.id; })) teams.push(t.name); });
    players.forEach(function (p) { if (p.team && teams.indexOf(p.team) < 0) teams.push(p.team); });
    var tf = $('#uc-team-filter');
    if (tf) {
      tf.innerHTML = teams.length > 1 ? ['<button type="button" class="uc-chip' + (filterTeam ? '' : ' is-active') + '" data-team="">All teams</button>'].concat(teams.map(function (t) {
        return '<button type="button" class="uc-chip' + (filterTeam === t ? ' is-active' : '') + '" data-team="' + esc(t) + '">' + esc(t) + '</button>';
      })).join('') : '';
    }
    var list = players.filter(function (p) { return !filterTeam || p.team === filterTeam; });

    if (showBars) {
      var max = Math.max.apply(null, players.map(function (p) { return p.votes || 0; }).concat([1]));
      var total = S.total_votes || 0;
      wrap.className = 'uc-results';
      wrap.innerHTML = (total && window.UnityShare ? '<div class="uc-section-actions"><button type="button" class="uc-share" data-share="winner">' + ICON.share + (results ? 'Share the result' : 'Share the standings') + '</button></div>' : '') + (total ? '<p class="uc-results-total">' + total + (total === 1 ? ' vote' : ' votes') + ' cast</p>' : '') + list.map(function (p, i) {
        var v = p.votes || 0, pct = total ? Math.round(v / total * 100) : 0;
        var lead = results && i === 0 && v > 0;
        var rt = teamsById[p.team_id];
        return '<div class="uc-result' + (lead ? ' is-winner' : '') + '" style="--w:' + Math.round(v / max * 100) + '%; --i:' + i + ';' + (rt ? ' --tc:' + esc(rt.colour) + ';' : '') + '">' +
          '<span class="uc-avatar">' + esc(initials(p.name)) + '</span>' +
          '<div class="uc-result-body"><div class="uc-result-top"><strong>' + esc(p.name) + (lead ? ' <span class="uc-crown" title="Player of the Tournament">&#9733;</span>' : '') + '</strong><span>' + v + ' &middot; ' + pct + '%</span></div>' +
          '<div class="uc-bar"><span></span></div>' +
          (p.team ? '<small>' + esc(p.team) + '</small>' : '') + '</div></div>';
      }).join('');
      $('#uc-votebar').hidden = true;
      return;
    }

    wrap.className = 'uc-players';
    wrap.innerHTML = list.map(function (p) {
      var on = selected === p.id;
      var tm = teamsById[p.team_id];
      return '<button type="button" class="uc-player' + (on ? ' is-selected' : '') + '" data-player="' + esc(p.id) + '" aria-pressed="' + on + '"' + (tm ? ' style="--tc:' + esc(tm.colour) + '"' : '') +
        (!S.voting_open || voted ? ' disabled' : '') + '>' +
        '<span class="uc-avatar">' + esc(initials(p.name)) + (p.shirt_no ? '<b>' + esc(p.shirt_no) + '</b>' : '') + '</span>' +
        '<span class="uc-player-name">' + esc(p.name) + '</span>' + (p.captain ? '<span class="uc-role uc-role--' + (p.captain === 'captain' ? 'c' : 'vc') + '">' + (p.captain === 'captain' ? 'Captain' : 'Vice-captain') + '</span>' : '') +
        (p.team ? '<span class="uc-player-team">' + esc(p.team) + (p.position ? ' &middot; ' + esc(p.position) : '') + '</span>' : (p.position ? '<span class="uc-player-team">' + esc(p.position) + '</span>' : '')) +
        '<span class="uc-player-tick">' + ICON.check + '</span></button>';
    }).join('');
    updateVoteBar();
  }

  function updateVoteBar() {
    var bar = $('#uc-votebar'); if (!bar) return;
    var p = (S.players || []).filter(function (x) { return x.id === selected; })[0];
    var can = S.voting_open && !lsGet(LS.voted) && !S.show_results;
    bar.hidden = !(p && can);
    if (p) $('#uc-votebar-name', bar).textContent = p.name;
  }

  // ----- Raffle -----
  function renderRaffle(first) {
    var open = S.raffle_open;
    var banner = $('#uc-raffle-banner');
    if (banner) banner.innerHTML = open ? '' : '<div class="uc-banner"><strong>The raffle isn&rsquo;t open right now.</strong> ' + ((S.draws || []).length ? 'Winners are shown below.' : 'Check back soon.') + '</div>';
    var entries = S.raffle_entries || 0;
    var elE = $('#uc-stat-entries'); if (elE) elE.textContent = entries;
    var elP = $('#uc-stat-prize'); if (elP) elP.textContent = S.prize_text || '';
    var elM = $('#uc-stat-min'); if (elM) elM.textContent = money(S.min_donation);
    $$('[data-uc-min]').forEach(function (n) { n.textContent = money(S.min_donation); });
    $$('[data-uc-prize]').forEach(function (n) { n.textContent = S.prize_text || 'a prize'; });
    $$('[data-uc-jg]').forEach(function (a) { if (S.justgiving_url) a.href = S.justgiving_url; });
    var enter = $('#uc-enter-btn'); if (enter) enter.disabled = !open;

    var canvas = $('#uc-wheel');
    if (canvas && window.UnityWheel) {
      if (!wheel) wheel = UnityWheel.create(canvas);
      if (!wheel.isSpinning()) wheel.setTickets(S.tickets || []);
    }
    var mine = lsGet(LS.ticket);
    var line = $('#uc-myticket');
    if (line) {
      if (mine) {
        var onWheel = (S.tickets || []).indexOf(Number(mine)) >= 0;
        var won = (S.draws || []).filter(function (d) { return String(d.ticket_no) === String(mine); })[0];
        line.hidden = false;
        line.innerHTML = won ? '<strong>Ticket #' + esc(mine) + ' won ' + esc(won.prize) + '!</strong> Check your email.' :
          'Your ticket: <strong>#' + esc(mine) + '</strong> &middot; ' + (onWheel ? 'it&rsquo;s on the wheel' : 'waiting for the committee to confirm your donation');
      } else line.hidden = true;
    }
    var wl = $('#uc-winners');
    if (wl) {
      var ds = S.draws || [];
      wl.innerHTML = ds.length ? '<h3>Winners</h3><ul>' + ds.map(function (d) {
        return '<li><span class="uc-win-badge">#' + esc(d.ticket_no) + '</span><span><strong>' + esc(d.name) + '</strong> won ' + esc(d.prize) + '</span>' + (window.UnityShare ? '<button type="button" class="uc-share uc-share--icon" data-share-draw="' + esc(d.id) + '" aria-label="Share this winner as a picture" title="Share as a picture">' + ICON.share + '</button>' : '') + '</li>';
      }).join('') + '</ul>' : '<p class="uc-muted">The draw happens live at the tournament. Winners will appear here.</p>';
    }
  }

  function watchDraws() {
    (S.draws || []).slice().reverse().forEach(function (d) {
      if (knownDraws[d.id]) return;
      knownDraws[d.id] = 1;
      celebrateDraw(d);
    });
  }

  // On every page except the raffle, a draw is announced with a small prompt that leads to the wheel
  function drawToast(d) {
    var old = $('#uc-toast'); if (old) old.parentNode.removeChild(old);
    var t = document.createElement('div');
    t.id = 'uc-toast'; t.className = 'uc-toast'; t.setAttribute('role', 'status');
    t.innerHTML = '<span class="uc-toast-ico" aria-hidden="true">&#127881;</span><span class="uc-toast-txt"><strong>The raffle draw is happening!</strong><small>Ticket #' + esc(d.ticket_no) + ' &middot; watch the wheel</small></span>' +
      '<a class="uc-btn uc-btn--gold" href="' + PAGE.raffle + '">Watch</a><button type="button" class="uc-toast-x" data-uc-toast-close aria-label="Dismiss">' + ICON.close + '</button>';
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('is-in'); });
    say('The raffle draw is happening now. Open the raffle page to watch the wheel.');
  }

  function celebrateDraw(d) {
    if (!wheel) { drawToast(d); return; }
    var sec = $('#raffle'); if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var ov = $('#uc-reveal'); if (!ov) return;
    ov.hidden = false; ov.classList.remove('is-shown');
    $('#uc-reveal-text').innerHTML = 'Drawing<span class="uc-dots"></span>';
    say('The raffle draw is happening now.');
    window.setTimeout(function () {
      wheel.spinTo(d.ticket_no).then(function () {
        $('#uc-reveal-text').innerHTML = '<span class="uc-reveal-label">Winning ticket</span><span class="uc-reveal-num">#' + esc(d.ticket_no) + '</span><span class="uc-reveal-name">' + esc(d.name) + '</span><span class="uc-reveal-prize">wins ' + esc(d.prize) + '</span>';
        ov.classList.add('is-shown');
        if (window.UnityFx) UnityFx.confetti({ count: 200 });
        say('Winner: ticket ' + d.ticket_no + ', ' + d.name);
        renderRaffle(false);
      });
    }, 600);
  }

  // ----- Media -----
  function renderMedia() {
    var g = $('#uc-gallery'); if (!g) return;
    var items = S.media || [];
    var up = $('#uc-upload-card');
    if (up) up.classList.toggle('is-closed', !S.media_open);
    var closedNote = $('#uc-media-closed'); if (closedNote) closedNote.hidden = !!S.media_open;
    if (!items.length) { g.innerHTML = '<p class="uc-empty">Photos and videos from the day will appear here once the committee has approved them. Be the first to share one.</p>'; return; }
    g.innerHTML = items.map(function (m, i) {
      var url = publicUrl(m.path);
      var inner = m.kind === 'video'
        ? '<video src="' + esc(url) + '#t=0.1" preload="metadata" muted playsinline></video><span class="uc-play">' + ICON.play + '</span>'
        : '<img src="' + esc(url) + '" alt="' + esc(m.caption || 'Photo from the Unity Cup') + '" loading="lazy">';
      return '<button type="button" class="uc-tile" data-media="' + i + '" aria-label="' + esc(m.caption || (m.kind === 'video' ? 'Play video' : 'Open photo')) + '">' + inner +
        (m.caption || m.credit ? '<span class="uc-tile-cap">' + esc(m.caption || '') + (m.credit ? '<em>' + esc(m.credit) + '</em>' : '') + '</span>' : '') + '</button>';
    }).join('');
  }

  function publicUrl(path) { return supabaseClient.storage.from('unity-cup-gallery').getPublicUrl(path).data.publicUrl; }

  // ---------------------------------------------------------------------
  // Modal
  function openModal(html, opts) {
    opts = opts || {};
    closeModal(true);
    lastFocus = document.activeElement;
    modalEl = document.createElement('div');
    modalEl.className = 'uc-modal' + (opts.wide ? ' uc-modal--wide' : '');
    modalEl.innerHTML = '<div class="uc-modal-backdrop" data-uc-close></div><div class="uc-modal-panel" role="dialog" aria-modal="true" aria-labelledby="uc-modal-title" tabindex="-1">' +
      '<button type="button" class="uc-modal-x" data-uc-close aria-label="Close">' + ICON.close + '</button><div class="uc-modal-body">' + html + '</div></div>';
    document.body.appendChild(modalEl);
    document.body.classList.add('uc-modal-open');
    requestAnimationFrame(function () { modalEl.classList.add('is-open'); var f = $('[autofocus], input:not([type=hidden]):not([data-uc-hp]), button.uc-btn', modalEl); (f || $('.uc-modal-panel', modalEl)).focus(); });
    return modalEl;
  }
  function setModal(html) {
    if (!modalEl) return;
    $('.uc-modal-body', modalEl).innerHTML = html;
    var f = $('[autofocus], input:not([type=hidden]):not([data-uc-hp])', modalEl); if (f) f.focus();
  }
  function closeModal(silent) {
    if (!modalEl) return;
    var m = modalEl; modalEl = null;
    m.classList.remove('is-open');
    document.body.classList.remove('uc-modal-open');
    window.setTimeout(function () { m.remove(); }, silent ? 0 : 220);
    if (!silent && lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function msgBox(text, bad) { return '<p class="uc-msg' + (bad ? ' is-bad' : '') + '" role="' + (bad ? 'alert' : 'status') + '">' + esc(text) + '</p>'; }
  function setMsg(text, bad) { var el = $('[data-uc-msg]', modalEl); if (el) el.innerHTML = text ? msgBox(text, bad) : ''; }
  function busy(btn, on, label) { if (!btn) return; btn.disabled = on; if (label != null) { if (on) { btn.dataset.l = btn.textContent; btn.textContent = label; } else if (btn.dataset.l) btn.textContent = btn.dataset.l; } }

  // ---------------------------------------------------------------------
  // Emailed code (shared by vote and raffle)
  function requestCode(email, purpose) {
    return supabaseClient.functions.invoke('unity-cup-code', { body: { email: email, purpose: purpose } }).then(function (res) {
      if (res.error && !res.data) return { ok: false, error: 'server' };
      return res.data || { ok: false, error: 'server' };
    }, function () { return { ok: false, error: 'server' }; });
  }

  function codeStep(kind, email, extra) {
    return '<h2 id="uc-modal-title" class="uc-modal-title">Check your email</h2>' +
      '<p class="uc-modal-lede">We sent a 6-digit code to <strong>' + esc(email) + '</strong>. It works for 10 minutes. Look in spam or promotions if it doesn&rsquo;t show up.</p>' +
      '<form data-uc-code-form novalidate>' +
      '<label class="uc-label" for="uc-code">6-digit code</label>' +
      '<input class="uc-input uc-code-input" id="uc-code" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" placeholder="000000" autofocus>' +
      '<div data-uc-msg></div>' +
      '<button type="submit" class="uc-btn uc-btn--gold uc-btn--block">' + (kind === 'vote' ? 'Confirm my vote' : 'Confirm my entry') + '</button>' +
      '<div class="uc-modal-links"><button type="button" class="uc-link" data-uc-resend disabled>Send a new code <span data-uc-cool>(30)</span></button><button type="button" class="uc-link" data-uc-back>Use a different email</button></div></form>';
  }

  function cooldown() {
    var btn = $('[data-uc-resend]', modalEl), cool = $('[data-uc-cool]', modalEl);
    if (!btn) return;
    var n = 30; btn.disabled = true;
    var iv = window.setInterval(function () {
      if (!modalEl || !btn.isConnected) { window.clearInterval(iv); return; }
      n--; if (cool) cool.textContent = n > 0 ? '(' + n + ')' : '';
      if (n <= 0) { btn.disabled = false; window.clearInterval(iv); }
    }, 1000);
  }

  // ---------------------------------------------------------------------
  // Vote flow
  var voteCtx = null;
  function startVote() {
    if (!S || !S.voting_open || !selected) return;
    var p = S.players.filter(function (x) { return x.id === selected; })[0];
    if (!p) return;
    voteCtx = { player: p, email: '' };
    openModal(voteForm(p));
    wireVote();
  }
  function voteForm(p) {
    var needCode = S.require_email_code;
    return '<span class="uc-modal-eyebrow">Player of the Tournament</span>' +
      '<h2 id="uc-modal-title" class="uc-modal-title">Your vote</h2>' +
      '<div class="uc-pick"><span class="uc-avatar">' + esc(initials(p.name)) + (p.shirt_no ? '<b>' + esc(p.shirt_no) + '</b>' : '') + '</span><div><strong>' + esc(p.name) + '</strong>' + (p.team ? '<small>' + esc(p.team) + '</small>' : '') + '</div></div>' +
      '<form data-uc-vote-form novalidate>' +
      '<label class="uc-label" for="uc-email">Your email address</label>' +
      '<input class="uc-input" id="uc-email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" autofocus value="' + esc(voteCtx.email) + '">' +
      '<input type="text" name="website" data-uc-hp tabindex="-1" autocomplete="off" aria-hidden="true" class="uc-hp">' +
      '<p class="uc-fine">' + (needCode ? 'We email you a code to check the address is real. ' : '') + 'One vote per email address. We keep only a scrambled version of it to stop double voting, so <strong>nobody can see who voted for whom</strong>. <a href="privacy.html#unity-cup" target="_blank" rel="noopener">How we use it</a>.</p>' +
      '<div data-uc-msg></div>' +
      '<button type="submit" class="uc-btn uc-btn--gold uc-btn--block">' + (needCode ? 'Email me a code' : 'Cast my vote') + '</button></form>';
  }
  function wireVote() {
    var form = $('[data-uc-vote-form]', modalEl); if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('#uc-email', form).value.trim();
      if ($('[data-uc-hp]', form).value) { voteDone(); return; }       // a bot filled the hidden field: pretend it worked
      if (!validEmail(email)) { setMsg(errText('bad_email'), true); return; }
      voteCtx.email = email;
      var btn = $('button[type=submit]', form);
      if (!S.require_email_code) { castVote(''); return; }
      busy(btn, true, 'Sending…');
      requestCode(email, 'vote').then(function (r) {
        busy(btn, false);
        if (!r.ok) { setMsg(errText(r.error), true); return; }
        setModal(codeStep('vote', email)); wireCode('vote'); cooldown();
      });
    });
  }
  function wireCode(kind) {
    var form = $('[data-uc-code-form]', modalEl); if (!form) return;
    var input = $('#uc-code', form);
    input.addEventListener('input', function () { input.value = input.value.replace(/\D/g, '').slice(0, 6); if (input.value.length === 6) form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var code = input.value.trim();
      if (!/^\d{6}$/.test(code)) { setMsg('Enter the 6-digit code from the email.', true); return; }
      if (kind === 'vote') castVote(code); else submitEntry(code);
    });
    $('[data-uc-back]', form).addEventListener('click', function () {
      if (kind === 'vote') { setModal(voteForm(voteCtx.player)); wireVote(); } else { setModal(raffleForm()); wireRaffle(); }
    });
    $('[data-uc-resend]', form).addEventListener('click', function () {
      var ctx = kind === 'vote' ? voteCtx : raffleCtx, b = $('[data-uc-resend]', form);
      b.disabled = true;
      requestCode(ctx.email, kind).then(function (r) { if (!r.ok) setMsg(errText(r.error), true); else { setMsg('A new code is on its way.', false); } cooldown(); });
    });
  }
  function castVote(code) {
    var btn = $('button[type=submit]', modalEl); busy(btn, true, 'Checking…');
    supabaseClient.rpc('unity_cast_vote', { p_email: voteCtx.email, p_code: code, p_player: voteCtx.player.id }).then(function (res) {
      busy(btn, false);
      if (res.error || !res.data) { setMsg(errText('server'), true); return; }
      if (!res.data.ok) {
        if (res.data.error === 'already_voted') lsSet(LS.voted, '1');
        setMsg(errText(res.data.error), true);
        if (res.data.error === 'already_voted') window.setTimeout(function () { renderVote(); }, 0);
        return;
      }
      lsSet(LS.voted, '1');
      voteDone();
    }, function () { busy(btn, false); setMsg(errText('server'), true); });
  }
  function voteDone() {
    var p = voteCtx.player;
    setModal('<div class="uc-success"><div class="uc-success-ring">' + ICON.check + '</div><h2 id="uc-modal-title" class="uc-modal-title">Vote counted!</h2>' +
      '<p class="uc-modal-lede">Thank you for backing <strong>' + esc(p.name) + '</strong>. Tell your friends to vote too, and stay for the raffle and the photos.</p>' +
      '<div class="uc-success-actions"><button type="button" class="uc-btn uc-btn--gold" data-uc-share>Share the Unity Cup</button><button type="button" class="uc-btn uc-btn--ghost" data-uc-close>Done</button></div></div>');
    if (window.UnityFx) UnityFx.confetti();
    say('Your vote has been counted.');
    selected = null;
    loadState(true);
  }

  // ---------------------------------------------------------------------
  // Raffle flow
  var raffleCtx = null;
  function startRaffle() {
    if (!S || !S.raffle_open) return;
    raffleCtx = { email: '', name: '', donor: '', amount: '' };
    openModal(raffleForm());
    wireRaffle();
  }
  function raffleForm() {
    var c = raffleCtx, needCode = S.require_email_code;
    return '<span class="uc-modal-eyebrow">Charity raffle</span>' +
      '<h2 id="uc-modal-title" class="uc-modal-title">Enter the raffle</h2>' +
      '<p class="uc-modal-lede">Donated at least ' + esc(money(S.min_donation)) + ' to our JustGiving page? Pop your details in. If you haven&rsquo;t yet, <a href="' + esc(S.justgiving_url) + '" target="_blank" rel="noopener">donate here first</a>.</p>' +
      '<form data-uc-raffle-form novalidate>' +
      '<div class="uc-field"><label class="uc-label" for="uc-r-name">Your name</label><input class="uc-input" id="uc-r-name" autocomplete="name" maxlength="80" autofocus value="' + esc(c.name) + '"></div>' +
      '<div class="uc-field"><label class="uc-label" for="uc-r-email">Email address</label><input class="uc-input" id="uc-r-email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" value="' + esc(c.email) + '"></div>' +
      '<div class="uc-two"><div class="uc-field"><label class="uc-label" for="uc-r-amount">Amount you donated (£)</label><input class="uc-input" id="uc-r-amount" type="number" inputmode="decimal" min="' + esc(S.min_donation) + '" step="0.01" placeholder="' + esc(Number(S.min_donation).toFixed(2)) + '" value="' + esc(c.amount) + '"></div>' +
      '<div class="uc-field"><label class="uc-label" for="uc-r-donor">Name on the donation <span class="uc-opt">(if different)</span></label><input class="uc-input" id="uc-r-donor" maxlength="80" placeholder="As shown on JustGiving" value="' + esc(c.donor) + '"></div></div>' +
      '<input type="text" name="website" data-uc-hp tabindex="-1" autocomplete="off" aria-hidden="true" class="uc-hp">' +
      '<label class="uc-check"><input type="checkbox" id="uc-r-confirm"><span>I confirm I have donated at least <strong>' + esc(money(S.min_donation)) + '</strong> to the LACMS JustGiving page, and I have read the <a href="#uc-rules" data-uc-rules>raffle rules</a>.</span></label>' +
      '<p class="uc-fine">The committee checks each entry against the JustGiving donations before the draw. We use your name and email only to run the raffle and contact a winner, and delete them after the event. ' + (needCode ? 'We email a code to check the address is real. ' : '') + '<a href="privacy.html#unity-cup" target="_blank" rel="noopener">Privacy</a>.</p>' +
      '<div data-uc-msg></div>' +
      '<button type="submit" class="uc-btn uc-btn--gold uc-btn--block">' + (needCode ? 'Email me a code' : 'Enter the raffle') + '</button></form>';
  }
  function wireRaffle() {
    var form = $('[data-uc-raffle-form]', modalEl); if (!form) return;
    var rules = $('[data-uc-rules]', form);
    if (rules) rules.addEventListener('click', function (e) { e.preventDefault(); closeModal(); var d = $('#uc-rules-box'); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'center' }); } });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var c = raffleCtx;
      c.name = $('#uc-r-name', form).value.trim(); c.email = $('#uc-r-email', form).value.trim();
      c.amount = $('#uc-r-amount', form).value; c.donor = $('#uc-r-donor', form).value.trim();
      if ($('[data-uc-hp]', form).value) { raffleDone(0); return; }
      if (c.name.length < 2) { setMsg(errText('bad_name'), true); return; }
      if (!validEmail(c.email)) { setMsg(errText('bad_email'), true); return; }
      if (!(Number(c.amount) >= Number(S.min_donation))) { setMsg('The minimum donation to enter is ' + money(S.min_donation) + '.', true); return; }
      if (!$('#uc-r-confirm', form).checked) { setMsg(errText('not_confirmed'), true); return; }
      var btn = $('button[type=submit]', form);
      if (!S.require_email_code) { submitEntry(''); return; }
      busy(btn, true, 'Sending…');
      requestCode(c.email, 'raffle').then(function (r) {
        busy(btn, false);
        if (!r.ok) { setMsg(errText(r.error), true); return; }
        setModal(codeStep('raffle', c.email)); wireCode('raffle'); cooldown();
      });
    });
  }
  function submitEntry(code) {
    var c = raffleCtx, btn = $('button[type=submit]', modalEl); busy(btn, true, 'Entering…');
    supabaseClient.rpc('unity_enter_raffle', { p_name: c.name, p_email: c.email, p_code: code, p_donor_name: c.donor || null, p_amount: Number(c.amount), p_confirm: true }).then(function (res) {
      busy(btn, false);
      if (res.error || !res.data) { setMsg(errText('server'), true); return; }
      if (!res.data.ok) { setMsg(errText(res.data.error), true); return; }
      lsSet(LS.ticket, String(res.data.ticket_no));
      raffleDone(res.data.ticket_no);
    }, function () { busy(btn, false); setMsg(errText('server'), true); });
  }
  function raffleDone(ticket) {
    setModal('<div class="uc-success"><div class="uc-ticket"><span>Your ticket</span><b>#' + esc(ticket || '—') + '</b></div><h2 id="uc-modal-title" class="uc-modal-title">You&rsquo;re in!</h2>' +
      '<p class="uc-modal-lede">The committee will check your donation against our JustGiving page, then your ticket joins the wheel. If you win, we&rsquo;ll email you. Good luck!</p>' +
      '<div class="uc-success-actions"><button type="button" class="uc-btn uc-btn--gold" data-uc-close>Back to the wheel</button></div></div>');
    if (window.UnityFx) UnityFx.confetti({ count: 110 });
    say('You have entered the raffle. Your ticket number is ' + ticket + '.');
    loadState(true);
  }

  // ---------------------------------------------------------------------
  // Media upload
  function extOf(name) { var m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
  function uuid() { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); var s = function (n) { var r = ''; while (r.length < n) r += Math.floor(Math.random() * 16).toString(16); return r; }; return s(8) + '-' + s(4) + '-4' + s(3) + '-a' + s(3) + '-' + s(12); }
  function human(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  function addFiles(files) {
    var msg = $('#uc-upload-msg'); msg.textContent = ''; msg.className = 'uc-msg';
    Array.prototype.forEach.call(files, function (f) {
      var ext = extOf(f.name);
      if (!ALLOWED_EXT[ext] && !/^(image|video)\//.test(f.type)) { warn(f.name + ' isn\'t a photo or video we accept.'); return; }
      if (!ALLOWED_EXT[ext]) { ext = /video/.test(f.type) ? 'mp4' : 'jpg'; }
      if (f.size > MAX_BYTES * 1.0 && /^video/.test(ALLOWED_EXT[ext])) { warn(f.name + ' is too big (' + human(f.size) + '). Videos can be up to 50 MB.'); return; }
      if (queue.length >= MAX_FILES) { warn('You can send up to ' + MAX_FILES + ' files at a time.'); return; }
      queue.push({ id: uuid(), file: f, ext: ext, state: 'ready', url: /^image\//.test(f.type) && ext !== 'heic' ? URL.createObjectURL(f) : '' });
    });
    renderQueue();
  }
  function warn(t) { var m = $('#uc-upload-msg'); m.textContent = t; m.className = 'uc-msg is-bad'; }

  function renderQueue() {
    var el = $('#uc-queue'); if (!el) return;
    el.innerHTML = queue.map(function (q, i) {
      var thumb = q.url ? '<img src="' + esc(q.url) + '" alt="">' : '<span class="uc-qthumb-ph">' + (/^video/.test(ALLOWED_EXT[q.ext]) ? ICON.play : ICON.upload) + '</span>';
      var status = q.state === 'done' ? '<span class="uc-qstate is-done">' + ICON.check + 'Sent</span>' : q.state === 'sending' ? '<span class="uc-qstate is-busy">Sending…</span>' : q.state === 'error' ? '<span class="uc-qstate is-bad">Failed</span>' : '<button type="button" class="uc-qx" data-q-remove="' + i + '" aria-label="Remove ' + esc(q.file.name) + '">' + ICON.close + '</button>';
      return '<li class="uc-qitem is-' + q.state + '"><span class="uc-qthumb">' + thumb + '</span><span class="uc-qname"><strong>' + esc(q.file.name) + '</strong><small>' + human(q.file.size) + '</small></span>' + status + '</li>';
    }).join('');
    var send = $('#uc-send'); if (send) send.disabled = !queue.some(function (q) { return q.state === 'ready' || q.state === 'error'; });
  }

  function compress(q) {
    return new Promise(function (resolve) {
      var f = q.file;
      if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { resolve({ blob: f, type: ALLOWED_EXT[q.ext] || f.type, ext: q.ext }); return; }
      var img = new Image(), url = URL.createObjectURL(f);
      img.onload = function () {
        var max = 2400, sc = Math.min(1, max / Math.max(img.width, img.height));
        if (sc === 1 && f.size < 3 * 1048576) { URL.revokeObjectURL(url); resolve({ blob: f, type: f.type, ext: q.ext }); return; }
        var cv = document.createElement('canvas'); cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob(function (b) { URL.revokeObjectURL(url); resolve(b ? { blob: b, type: 'image/jpeg', ext: 'jpg' } : { blob: f, type: f.type, ext: q.ext }); }, 'image/jpeg', 0.86);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve({ blob: f, type: f.type, ext: q.ext }); };
      img.src = url;
    });
  }

  function sendAll() {
    var msg = $('#uc-upload-msg');
    if (!$('#uc-rights').checked) { msg.textContent = 'Please tick the box to confirm you took these or have permission to share them.'; msg.className = 'uc-msg is-bad'; return; }
    if ($('[data-uc-hp-up]').value) { queue = []; renderQueue(); return; }
    var caption = $('#uc-caption').value.trim(), credit = $('#uc-credit').value.trim();
    var todo = queue.filter(function (q) { return q.state === 'ready' || q.state === 'error'; });
    if (!todo.length) return;
    $('#uc-send').disabled = true;
    var okCount = 0;
    var chain = Promise.resolve();
    todo.forEach(function (q) {
      chain = chain.then(function () {
        q.state = 'sending'; renderQueue();
        return compress(q).then(function (c) {
          var path = 'incoming/' + q.id + '.' + c.ext;
          return supabaseClient.storage.from('unity-cup-uploads').upload(path, c.blob, { contentType: c.type, upsert: false }).then(function (up) {
            if (up.error) throw up.error;
            return supabaseClient.rpc('unity_register_media', { p_path: path, p_caption: caption || null, p_credit: credit || null, p_rights: true });
          }).then(function (r) {
            if (r.error || !r.data || !r.data.ok) throw new Error((r.data && r.data.error) || 'server');
            q.state = 'done'; okCount++;
          });
        }).catch(function () { q.state = 'error'; }).then(renderQueue);
      });
    });
    chain.then(function () {
      if (okCount) {
        msg.textContent = okCount + (okCount === 1 ? ' file' : ' files') + ' sent. Thank you! The committee checks everything before it goes on this page.';
        msg.className = 'uc-msg is-ok';
        if (window.UnityFx) UnityFx.confetti({ count: 80, y: window.innerHeight * 0.6 });
        say('Upload complete.');
        window.setTimeout(function () { queue = queue.filter(function (q) { return q.state !== 'done'; }); renderQueue(); }, 2500);
      }
      if (queue.some(function (q) { return q.state === 'error'; })) { msg.textContent = 'Some files didn\'t send. Check your connection and press Send again.'; msg.className = 'uc-msg is-bad'; }
      $('#uc-send').disabled = !queue.some(function (q) { return q.state === 'ready' || q.state === 'error'; });
    });
  }

  // ---------------------------------------------------------------------
  // Lightbox
  var lbIndex = -1;
  function openLightbox(i) {
    var items = S.media || []; if (!items[i]) return;
    lbIndex = i;
    var m = items[i], url = publicUrl(m.path);
    var body = (m.kind === 'video' ? '<video src="' + esc(url) + '" controls autoplay playsinline></video>' : '<img src="' + esc(url) + '" alt="' + esc(m.caption || 'Photo from the Unity Cup') + '">') +
      ((m.caption || m.credit) ? '<p class="uc-lb-cap">' + esc(m.caption || '') + (m.credit ? ' <em>' + esc(m.credit) + '</em>' : '') + '</p>' : '');
    var lb = $('#uc-lightbox');
    $('#uc-lb-body').innerHTML = body;
    if (lb.hidden) { lastFocus = document.activeElement; lb.hidden = false; document.body.classList.add('uc-modal-open'); requestAnimationFrame(function () { lb.classList.add('is-open'); }); }
    $('[data-lb-close]', lb).focus();
  }
  function closeLightbox() {
    var lb = $('#uc-lightbox'); if (!lb || lb.hidden) return;
    $('#uc-lb-body').innerHTML = '';
    lb.classList.remove('is-open'); lb.hidden = true; document.body.classList.remove('uc-modal-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function stepLightbox(d) { var n = (S.media || []).length; if (!n) return; openLightbox((lbIndex + d + n) % n); }


  // ---------------------------------------------------------------------
  // Teams, squads and fixtures
  function logoUrl(t) { return t && t.logo_path ? publicUrl(t.logo_path) : ''; }
  function mono(t) { return esc((t && (t.short_name || t.name) || '?').replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 3).toUpperCase() || '?'); }
  function crest(t, cls) {
    if (!t) return '<span class="uc-crest ' + (cls || '') + '"><b>?</b></span>';
    var u = logoUrl(t);
    return '<span class="uc-crest ' + (cls || '') + '" style="--tc:' + esc(t.colour) + '">' + (u ? '<img src="' + esc(u) + '" alt="" loading="lazy">' : '<b>' + mono(t) + '</b>') + '</span>';
  }
  function kickDate(f) { return f.kickoff_at ? new Date(f.kickoff_at) : null; }
  function dayKey(d) { return d ? d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() : 'tbc'; }
  function dayLabelFor(d) {
    if (!d) return 'Time to be confirmed';
    var t = new Date(); t.setHours(0, 0, 0, 0);
    var x = new Date(d); x.setHours(0, 0, 0, 0);
    var diff = Math.round((x - t) / 86400000);
    var base = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    return diff === 0 ? 'Today · ' + base : diff === 1 ? 'Tomorrow · ' + base : base;
  }
  function timeOf(d) { return d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'TBC'; }

  // Who scored for a team in a match, one entry per player with all their minutes (a goal counts for the team it was
  // given to, so an own goal is listed under the other side). Only goals with a name are sent to the public page.
  function scorerGroups(f, teamId) {
    var order = [], by = {};
    (f.goals || []).forEach(function (g) {
      if (!g || !g.name || g.team_id !== teamId) return;
      var k = (g.player_id || g.name) + (g.own_goal ? '|og' : '');
      if (!by[k]) { by[k] = { name: g.name, og: !!g.own_goal, mins: [] }; order.push(k); }
      if (g.minute != null) by[k].mins.push(g.minute);
    });
    return order.map(function (k) { return by[k]; });
  }
  function scorerText(m) { return m.name + (m.og ? ' (OG)' : '') + (m.mins.length ? ' ' + m.mins.map(function (x) { return x + '\u2032'; }).join(', ') : ''); }

  function fixtureCard(f) {
    var h = teamsById[f.home_team_id], a = teamsById[f.away_team_id];
    if (!h || !a) return '';
    var d = kickDate(f), has = f.home_score != null && f.away_score != null && f.status !== 'scheduled' && f.status !== 'postponed';
    var live = f.status === 'live';
    var state = live ? '<span class="uc-fx-state is-live"><i></i>Live</span>' : f.status === 'finished' ? '<span class="uc-fx-state">Full time</span>' : f.status === 'postponed' ? '<span class="uc-fx-state is-off">Postponed</span>' : '<span class="uc-fx-state is-time">' + esc(timeOf(d)) + '</span>';
    var win = has && f.status === 'finished' ? (f.home_score > f.away_score ? 'h' : f.home_score < f.away_score ? 'a' : '') : '';
    function scorers(t) {
      if (!has) return '';
      var gs = scorerGroups(f, t.id);
      return gs.length ? '<ul class="uc-fx-goals" aria-label="Goals for ' + esc(t.name) + '">' + gs.map(function (m) {
        return '<li>' + ICON.ball + '<span><b>' + esc(m.name) + '</b>' + (m.og ? ' <em>OG</em>' : '') + (m.mins.length ? ' <small>' + m.mins.map(function (x) { return x + '\u2032'; }).join(', ') + '</small>' : '') + '</span></li>';
      }).join('') + '</ul>' : '';
    }
    function line(t, score, isWin) {
      return '<div class="uc-fx-line' + (isWin ? ' is-win' : '') + '"><button type="button" class="uc-fx-team" data-team-open="' + esc(t.id) + '">' + crest(t) + '<span>' + esc(t.name) + '</span></button>' +
        '<b class="uc-fx-sc' + (live ? ' is-live' : '') + '">' + (has ? score : '') + '</b>' + scorers(t) + '</div>';
    }
    return '<li class="uc-fx' + (live ? ' is-live' : '') + (f.status === 'finished' ? ' is-done' : '') + '">' +
      '<div class="uc-fx-top">' + state + '<span class="uc-fx-meta">' + (f.stage ? esc(f.stage) : '') + (f.stage && f.pitch ? ' &middot; ' : '') + (f.pitch ? esc(f.pitch) : '') + '</span>' + (window.UnityShare ? '<button type="button" class="uc-share uc-share--icon" data-share-match="' + esc(f.id) + '" aria-label="Share this match as a picture" title="Share as a picture">' + ICON.share + '</button>' : '') + '</div>' +
      '<div class="uc-fx-lines">' + line(h, f.home_score, win === 'h') + line(a, f.away_score, win === 'a') + '</div>' +
      (f.note ? '<p class="uc-fx-note">' + esc(f.note) + '</p>' : '') + '</li>';
  }

  // Group tables: worked out here from finished fixtures between teams that share a group.
  function standings() {
    var groups = {};
    (S.teams || []).forEach(function (t) { if (t.group_name) { (groups[t.group_name] = groups[t.group_name] || {})[t.id] = { t: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }; } });
    (S.fixtures || []).forEach(function (f) {
      if (f.status !== 'finished' || f.home_score == null || f.away_score == null) return;
      var h = teamsById[f.home_team_id], a = teamsById[f.away_team_id];
      if (!h || !a || !h.group_name || h.group_name !== a.group_name) return;
      var g = groups[h.group_name], H = g[h.id], A = g[a.id];
      H.p++; A.p++; H.gf += f.home_score; H.ga += f.away_score; A.gf += f.away_score; A.ga += f.home_score;
      if (f.home_score > f.away_score) { H.w++; A.l++; H.pts += 3; } else if (f.home_score < f.away_score) { A.w++; H.l++; A.pts += 3; } else { H.d++; A.d++; H.pts++; A.pts++; }
    });
    return Object.keys(groups).sort().map(function (name) {
      var rows = Object.keys(groups[name]).map(function (id) { return groups[name][id]; });
      rows.sort(function (x, y) { return y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.t.name.localeCompare(y.t.name); });
      return { name: name, rows: rows };
    });
  }

  function renderFixtures() {
    var sec = $('#fixtures'); if (!sec) return;
    var sig = JSON.stringify([S.fixtures, S.teams]) + fxTab + Math.floor(Date.now() / 60000);
    if (sig === fxSig) return;
    fxSig = sig;
    var list = $('#uc-fx-list'), tabs = $('#uc-fx-tabs'), next = $('#uc-fx-next');
    var fx = (S.fixtures || []).filter(function (f) { return teamsById[f.home_team_id] && teamsById[f.away_team_id]; });
    var tables = standings();
    var shareBox = $('#uc-fx-share');
    if (shareBox) shareBox.innerHTML = fx.length && window.UnityShare ? '<button type="button" class="uc-share" data-share="' + (fxTab === 'table' ? 'tables' : 'fixtures') + '">' + ICON.share + (fxTab === 'table' ? 'Share the tables' : 'Share fixtures &amp; results') + '</button>' : '';
    tabs.innerHTML = tables.length && fx.length ? '<button type="button" class="uc-chip' + (fxTab === 'fixtures' ? ' is-active' : '') + '" data-fx-tab="fixtures">Fixtures &amp; results</button><button type="button" class="uc-chip' + (fxTab === 'table' ? ' is-active' : '') + '" data-fx-tab="table">Tables</button>' : '';
    if (!tables.length || !fx.length) fxTab = 'fixtures';
    if (!fx.length) { next.innerHTML = ''; list.innerHTML = '<p class="uc-empty">The fixtures will appear here once the committee has set them. Check back soon.</p>'; return; }

    // "Live now" / "Next up"
    var live = fx.filter(function (f) { return f.status === 'live'; });
    var now = Date.now();
    var upcoming = fx.filter(function (f) { return f.status === 'scheduled' && f.kickoff_at && new Date(f.kickoff_at).getTime() >= now - 20 * 60000; }).sort(function (a, b) { return new Date(a.kickoff_at) - new Date(b.kickoff_at); });
    var feature = live.length ? live : upcoming.slice(0, 1);
    next.innerHTML = feature.length ? '<div class="uc-next"><span class="uc-next-label">' + (live.length ? '<i></i>Live now' : 'Next up') + '</span><ul class="uc-fx-list">' + feature.map(fixtureCard).join('') + '</ul></div>' : '';

    if (fxTab === 'table') {
      list.innerHTML = tables.map(function (g) {
        return '<div class="uc-table-card"><h3>' + esc(g.name) + '</h3><div class="uc-table-scroll"><table class="uc-table"><thead><tr><th class="uc-tl">Team</th><th title="Played">P</th><th title="Won">W</th><th title="Drawn">D</th><th title="Lost">L</th><th title="Goal difference">GD</th><th title="Points">Pts</th></tr></thead><tbody>' +
          g.rows.map(function (r, i) { var gd = r.gf - r.ga; return '<tr' + (i === 0 && r.p ? ' class="is-top"' : '') + '><td class="uc-tl"><button type="button" data-team-open="' + esc(r.t.id) + '">' + crest(r.t, 'uc-crest--sm') + '<span>' + esc(r.t.name) + '</span></button></td><td>' + r.p + '</td><td>' + r.w + '</td><td>' + r.d + '</td><td>' + r.l + '</td><td>' + (gd > 0 ? '+' + gd : gd) + '</td><td><b>' + r.pts + '</b></td></tr>'; }).join('') +
          '</tbody></table></div></div>';
      }).join('');
      return;
    }
    var days = [], map = {};
    fx.forEach(function (f) { var d = kickDate(f), k = dayKey(d); if (!map[k]) { map[k] = { label: dayLabelFor(d), items: [] }; days.push(map[k]); } map[k].items.push(f); });
    list.innerHTML = days.map(function (day) { return '<div class="uc-day"><h3>' + esc(day.label) + '</h3><ul class="uc-fx-list">' + day.items.map(fixtureCard).join('') + '</ul></div>'; }).join('');
  }

  function renderTeams() {
    var grid = $('#uc-teams'); if (!grid) return;
    var sig = JSON.stringify([S.teams, S.players && S.players.map(function (p) { return [p.id, p.team_id]; })]);
    if (sig === teamSig) return;
    teamSig = sig;
    var teams = S.teams || [];
    if (!teams.length) { grid.className = 'uc-teams'; grid.innerHTML = '<p class="uc-empty">The teams will be announced here soon.</p>'; return; }
    grid.className = 'uc-teams';
    grid.innerHTML = teams.map(function (t) {
      var n = (S.players || []).filter(function (p) { return p.team_id === t.id; }).length;
      return '<button type="button" class="uc-team" data-team-open="' + esc(t.id) + '" style="--tc:' + esc(t.colour) + '">' + crest(t, 'uc-crest--lg') +
        '<span class="uc-team-name">' + esc(t.name) + '</span>' +
        '<span class="uc-team-sub">' + (t.group_name ? esc(t.group_name) + ' &middot; ' : '') + n + (n === 1 ? ' player' : ' players') + '</span></button>';
    }).join('');
  }

  function openTeam(id) {
    var t = teamsById[id]; if (!t) return;
    var squad = (S.players || []).filter(function (p) { return p.team_id === t.id; }).sort(function (a, b) { return (parseInt(a.shirt_no, 10) || 999) - (parseInt(b.shirt_no, 10) || 999) || a.name.localeCompare(b.name); });
    var canVote = S.voting_open && !lsGet(LS.voted) && !S.show_results;
    var fx = (S.fixtures || []).filter(function (f) { return f.home_team_id === t.id || f.away_team_id === t.id; });
    var html = '<div class="uc-team-head" style="--tc:' + esc(t.colour) + '">' + crest(t, 'uc-crest--xl') + '<div><span class="uc-modal-eyebrow">' + (t.group_name ? esc(t.group_name) : 'Team') + '</span><h2 id="uc-modal-title" class="uc-modal-title">' + esc(t.name) + '</h2></div></div>' +
      (t.description ? '<p class="uc-modal-lede">' + esc(t.description) + '</p>' : '') +
      (window.UnityPitch && squad.length ? '<div class="uc-sub-row"><h3 class="uc-sub">Line-up</h3>' + (window.UnityShare ? '<button type="button" class="uc-share" data-share-lineup="' + esc(t.id) + '">' + ICON.share + 'Share line-up</button>' : '') + '</div>' + UnityPitch.html(squad, { colour: t.colour, canVote: canVote, title: t.name + ' line-up' }) : '') +
      '<h3 class="uc-sub">Squad</h3>' + (squad.length ? '<ul class="uc-squad">' + squad.map(function (p) {
        return '<li><span class="uc-shirt" style="--tc:' + esc(t.colour) + '">' + esc(p.shirt_no || '–') + '</span><span class="uc-squad-name"><strong>' + esc(p.name) + (p.captain ? ' <i class="uc-role uc-role--' + (p.captain === 'captain' ? 'c' : 'vc') + '">' + (p.captain === 'captain' ? 'Captain' : 'Vice-captain') + '</i>' : '') + '</strong>' + (p.position ? '<small>' + esc(p.position) + '</small>' : '') + '</span>' +
          (canVote ? '<button type="button" class="uc-mini" data-vote-player="' + esc(p.id) + '">Vote</button>' : '') + '</li>';
      }).join('') + '</ul>' : '<p class="uc-muted">The squad will be added soon.</p>') +
      (fx.length ? '<h3 class="uc-sub">Fixtures &amp; results</h3><ul class="uc-fx-list uc-fx-list--modal">' + fx.map(fixtureCard).join('') + '</ul>' : '');
    openModal(html, { wide: true });
  }

  // ---------------------------------------------------------------------
  // Share as a picture (js/unity-share.js)
  function shareTeam(t) { return t ? { name: t.name, short_name: t.short_name, colour: t.colour, logo: logoUrl(t) || null } : { name: '?', colour: '#d4a62b' }; }
  function shareFixture(f) {
    var d = kickDate(f), tm = d ? timeOf(d) : 'TBC';
    return { home: shareTeam(teamsById[f.home_team_id]), away: shareTeam(teamsById[f.away_team_id]), hs: f.home_score, as: f.away_score, status: f.status, time: tm, stage: f.stage || '', pitch: f.pitch || '', note: f.note || '',
      goals: { h: scorerGroups(f, f.home_team_id).map(scorerText), a: scorerGroups(f, f.away_team_id).map(scorerText) } };
  }
  // The address a shared picture points people to: the page that matches what is being shared
  function pageUrl(key) { return (window.UnityShare ? UnityShare.SITE.replace(/[^\/]*$/, '') : 'https://lincolnacms.uk/') + PAGE[key || 'hub']; }
  function slug(x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unity-cup'; }

  function shareLineup(id) {
    var t = teamsById[id]; if (!t || !window.UnityShare) return;
    var players = (S.players || []).filter(function (p) { return p.team_id === id; }).map(function (p) { return { id: p.id, name: p.name, shirt_no: p.shirt_no, position: p.position, captain: p.captain, active: true }; });
    UnityShare.open({ kind: 'lineup', url: pageUrl('teams'), heading: t.name + ' line-up', title: t.name + ' line-up', filename: 'lacms-unity-cup-' + slug(t.name) + '-lineup',
      caption: t.name + ' line-up for the LACMS Unity Cup ⚽',
      data: { team: shareTeam(t), group: t.group_name || '', players: players, hasRoles: players.some(function (p) { return !!p.captain; }) } });
  }
  function shareMatch(fid) {
    var f = (S.fixtures || []).filter(function (x) { return x.id === fid; })[0]; if (!f || !window.UnityShare) return;
    var d = shareFixture(f), has = f.home_score != null && f.away_score != null && f.status !== 'scheduled' && f.status !== 'postponed';
    UnityShare.open({ kind: 'match', url: pageUrl('fixtures'), heading: d.home.name + ' v ' + d.away.name, title: 'LACMS Unity Cup', filename: 'lacms-unity-cup-' + slug(d.home.name + '-v-' + d.away.name),
      caption: (f.status === 'finished' ? 'Full time: ' : f.status === 'live' ? 'Live: ' : '') + d.home.name + (has ? ' ' + f.home_score + '-' + f.away_score + ' ' : ' v ') + d.away.name + ' at the LACMS Unity Cup ⚽',
      data: { fixture: d } });
  }
  function shareFixtures() {
    var fx = (S.fixtures || []).filter(function (f) { return teamsById[f.home_team_id] && teamsById[f.away_team_id]; });
    if (!fx.length || !window.UnityShare) return;
    var days = [], map = {}, todayKey = dayKey(new Date());
    fx.forEach(function (f) { var d = kickDate(f), k = dayKey(d); if (!map[k]) { map[k] = { key: k, date: d, items: [] }; days.push(map[k]); } map[k].items.push(f); });
    var variants = days.map(function (dy) {
      var nice = dy.date ? dy.date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Time to be confirmed';
      var short = dy.key === todayKey ? 'Today' : dy.date ? dy.date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : 'TBC';
      var done = dy.items.every(function (f) { return f.status === 'finished'; });
      return { label: short, kind: 'fixtures', caption: 'LACMS Unity Cup ' + (done ? 'results' : 'fixtures') + ' for ' + nice + ' ⚽', data: { title: done ? 'Results' : 'Fixtures', subtitle: nice, fixtures: dy.items.map(shareFixture) } };
    });
    var finished = fx.filter(function (f) { return f.status === 'finished'; });
    if (finished.length && days.length > 1) variants.push({ label: 'All results', kind: 'fixtures', caption: 'LACMS Unity Cup results so far ⚽', data: { title: 'Results', subtitle: 'So far', fixtures: finished.map(shareFixture) } });
    var start = 0, ti = days.findIndex(function (d) { return d.key === todayKey; });
    if (ti >= 0) start = ti; else { var up = days.findIndex(function (d) { return d.items.some(function (f) { return f.status !== 'finished'; }); }); start = up >= 0 ? up : days.length - 1; }
    UnityShare.open({ kind: 'fixtures', url: pageUrl('fixtures'), heading: 'Share fixtures & results', title: 'LACMS Unity Cup', filename: 'lacms-unity-cup-fixtures', variants: variants, start: start });
  }
  function shareTables() {
    if (!window.UnityShare) return;
    var groups = standings().map(function (g) { return { name: g.name, rows: g.rows.map(function (r) { return { t: shareTeam(r.t), p: r.p, w: r.w, d: r.d, l: r.l, gf: r.gf, ga: r.ga, pts: r.pts }; }) }; });
    if (!groups.length) return;
    UnityShare.open({ kind: 'tables', url: pageUrl('fixtures'), heading: 'Share the tables', title: 'LACMS Unity Cup', filename: 'lacms-unity-cup-tables', caption: 'LACMS Unity Cup group tables ⚽',
      data: { title: 'Group tables', subtitle: 'LACMS Unity Cup', groups: groups } });
  }
  function shareWinner() {
    var players = (S.players || []).filter(function (p) { return (p.votes || 0) > 0; }).sort(function (a, b) { return (b.votes || 0) - (a.votes || 0); });
    if (!players.length || !window.UnityShare) return;
    var total = S.total_votes || players.reduce(function (n, p) { return n + (p.votes || 0); }, 0);
    function row(p) { var t = teamsById[p.team_id]; return { name: p.name, team: p.team || '', colour: t ? t.colour : '#d4a62b', votes: p.votes || 0, pct: total ? Math.round((p.votes || 0) / total * 100) : null }; }
    var w = row(players[0]), done = !S.voting_open;
    UnityShare.open({ kind: 'winner', url: pageUrl('vote'), heading: done ? 'Share the result' : 'Share the standings', title: 'LACMS Unity Cup', filename: 'lacms-unity-cup-player-of-the-tournament',
      caption: done ? w.name + ' is the LACMS Unity Cup Player of the Tournament ⭐' : 'Player of the Tournament so far at the LACMS Unity Cup: ' + w.name + ' ⭐',
      data: { winner: w, others: players.slice(1, 6).map(row), total: total } });
  }
  function shareDraw(id) {
    var d = (S.draws || []).filter(function (x) { return x.id === id; })[0]; if (!d || !window.UnityShare) return;
    UnityShare.open({ kind: 'raffle', url: pageUrl('raffle'), heading: 'Share the winner', title: 'LACMS Unity Cup raffle', filename: 'lacms-unity-cup-raffle-winner', caption: 'Ticket #' + d.ticket_no + ' wins ' + d.prize + ' in the LACMS Unity Cup charity raffle! 🎉',
      data: { ticket: d.ticket_no, name: d.name, prize: d.prize } });
  }

  // ---------------------------------------------------------------------
  // Wiring
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest('[data-uc-close]')) { closeModal(); return; }
    var pl = t.closest('[data-player]');
    if (pl && !pl.disabled) { selected = selected === pl.getAttribute('data-player') ? null : pl.getAttribute('data-player'); renderVote(); return; }
    var team = t.closest('[data-team]');
    if (team) { filterTeam = team.getAttribute('data-team'); renderVote(); return; }
    var to = t.closest('[data-team-open]'); if (to) { openTeam(to.getAttribute('data-team-open')); return; }
    var vp = t.closest('[data-vote-player]');
    if (vp) {
      var pid = vp.getAttribute('data-vote-player');
      var vs = document.getElementById('vote');
      if (!vs) { location.href = PAGE.vote + '?player=' + encodeURIComponent(pid); return; }     // the vote has its own page now
      selected = pid; closeModal(true); renderVote(); vs.scrollIntoView({ behavior: 'smooth', block: 'start' }); say('Player selected. Press Vote now.'); return;
    }
    if (t.closest('[data-uc-toast-close]')) { var tt = $('#uc-toast'); if (tt) { tt.classList.remove('is-in'); window.setTimeout(function () { if (tt.parentNode) tt.parentNode.removeChild(tt); }, 250); } return; }
    var ft = t.closest('[data-fx-tab]'); if (ft) { fxTab = ft.getAttribute('data-fx-tab'); fxSig = ''; renderFixtures(); return; }
    var sl = t.closest('[data-share-lineup]'); if (sl) { shareLineup(sl.getAttribute('data-share-lineup')); return; }
    var sm = t.closest('[data-share-match]'); if (sm) { shareMatch(sm.getAttribute('data-share-match')); return; }
    var sd = t.closest('[data-share-draw]'); if (sd) { shareDraw(sd.getAttribute('data-share-draw')); return; }
    var sg = t.closest('[data-share]');
    if (sg) { var kind = sg.getAttribute('data-share'); if (kind === 'fixtures') shareFixtures(); else if (kind === 'tables') shareTables(); else if (kind === 'winner') shareWinner(); return; }
    if (t.closest('#uc-votebar-go')) { startVote(); return; }
    if (t.closest('#uc-enter-btn')) { startRaffle(); return; }
    var tile = t.closest('[data-media]');
    if (tile) { openLightbox(Number(tile.getAttribute('data-media'))); return; }
    if (t.closest('[data-lb-close]') || t.id === 'uc-lightbox') { closeLightbox(); return; }
    if (t.closest('[data-lb-prev]')) { stepLightbox(-1); return; }
    if (t.closest('[data-lb-next]')) { stepLightbox(1); return; }
    var rm = t.closest('[data-q-remove]');
    if (rm) { var q = queue.splice(Number(rm.getAttribute('data-q-remove')), 1)[0]; if (q && q.url) URL.revokeObjectURL(q.url); renderQueue(); return; }
    if (t.closest('[data-uc-share]')) {
      var data = { title: 'LACMS Unity Cup', text: 'Vote for Player of the Tournament and win a prize at the LACMS Unity Cup!', url: location.origin + location.pathname };
      if (navigator.share) navigator.share(data).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(data.url).then(function () { t.closest('[data-uc-share]').textContent = 'Link copied!'; });
      return;
    }
    if (t.closest('#uc-reveal-close')) { var ov = $('#uc-reveal'); ov.hidden = true; ov.classList.remove('is-shown'); return; }
  });

  function lightboxOpen() { var lb = $('#uc-lightbox'); return !!lb && !lb.hidden; }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if (lightboxOpen()) closeLightbox(); else closeModal(); return; }
    if (lightboxOpen()) { if (e.key === 'ArrowRight') stepLightbox(1); if (e.key === 'ArrowLeft') stepLightbox(-1); return; }
    if (e.key === 'Tab' && modalEl) {          // keep focus inside the dialog
      var f = $$('a[href], button:not([disabled]), input:not([type=hidden]):not([data-uc-hp]), select, textarea', modalEl);
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (!modalEl.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  function wireUpload() {
    var dz = $('#uc-drop'), input = $('#uc-file');
    if (!dz || !input) return;
    input.addEventListener('change', function () { addFiles(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('is-over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('is-over'); }); });
    dz.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });
    $('#uc-send').addEventListener('click', sendAll);
  }

  // Scroll reveals and the sticky section nav highlight
  function wireScroll() {
    document.body.classList.add('uc-page');
    var io = null;
    var voteSec = document.getElementById('vote'), bar = document.getElementById('uc-votebar');
    if (voteSec && bar && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { es.forEach(function (en) { bar.classList.toggle('is-away', !en.isIntersecting); }); }, { threshold: 0 }).observe(voteSec);
    }
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (entries) { entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } }); }, { threshold: 0.12 });
      $$('[data-reveal]').forEach(function (n) { io.observe(n); });
    } else $$('[data-reveal]').forEach(function (n) { n.classList.add('is-in'); });
    wireSubnav();
  }

  // On a phone the tabs scroll sideways: bring the current one into view
  function wireSubnav() {
    var nav = $('.uc-subnav'); if (!nav) return;
    var inner = $('.uc-subnav-inner', nav), cur = $('[aria-current="page"]', nav);
    if (inner && cur && inner.scrollWidth > inner.clientWidth) inner.scrollLeft = Math.max(0, cur.offsetLeft - (inner.clientWidth - cur.offsetWidth) / 2);
  }

  // ---------------------------------------------------------------------
  // Start
  var qs = null; try { qs = new URLSearchParams(location.search); } catch (e) {}
  if (qs && qs.get('player') && document.getElementById('vote')) selected = qs.get('player');      // from a squad's "Vote" button on another page
  wireUpload();
  wireScroll();
  if (!ready()) { showUnavailable(); return; }
  loadState().then(function (ok) {
    if (!ok) return;
    if (qs && qs.get('team') && teamsById[qs.get('team')]) openTeam(qs.get('team'));                // ?team= opens a squad
    if (selected) {
      var chosen = $('.uc-player.is-selected');
      if (chosen) window.setTimeout(function () { chosen.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 300);
      if (window.history && history.replaceState) history.replaceState(null, '', location.pathname + location.hash);
    }
    var h = (location.hash || '').replace('#', '');
    if (h && document.getElementById(h)) window.setTimeout(function () { document.getElementById(h).scrollIntoView({ behavior: 'smooth' }); }, 350);
  });
  window.setInterval(function () { if (!document.hidden && !modalEl && !(wheel && wheel.isSpinning())) loadState(true); }, POLL_MS);
})();
