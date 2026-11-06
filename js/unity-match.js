// Committee: run ONE Unity Cup match from a phone (unity-match.html?id=<fixture id>)
//
// One screen for the whole match: the score and match clock, a big Goal / Yellow card / Red card button for each
// team, the sin bin (a yellow card is a 2 minute timer), who has been sent off, the list of what has happened,
// the score/status fix-ups and the Man of the Match controls. Tapping Goal or a card opens a sheet with a search
// over the players, and one tap on a name records it.
//
// Everything goes through the committee-only database functions (migrations 115, 122, 125 and 126). The page
// checks the same permission as the dashboard (the president, or "Dashboard: Unity Cup" in Hub Access); the
// database enforces it again on every call.
//
// PRIVATE SCORER LINK (migration 127): the committee can send anyone a link like unity-match.html#<code>. That
// person needs no account: they get this same page for THAT match only (goals, scorers, cards, clock, score and
// status). They cannot publish the match, see or run Man of the Match, or touch anything else. Every action goes
// through unity_match_open / unity_match_do, which check the link in the database each time.

(function () {
  'use strict';

  var root = document.getElementById('um-root');
  if (!root) return;
  var liveEl = document.getElementById('um-live');
  var FID = '', KEY = '', BADHASH = false;
  try {
    FID = new URLSearchParams(window.location.search).get('id') || '';
    var hm = /^#([0-9a-f]{36})$/.exec(window.location.hash || '');
    if (hm) KEY = hm[1]; else if ((window.location.hash || '').length > 1 && !FID) BADHASH = true;
  } catch (e) { /* none */ }
  var KEYMODE = !!KEY;         // opened with a private scorer link (no sign-in)
  var dead = false;            // the link stopped working: stop talking to the database

  var POLL_MS = 5000;
  var SIN_BIN_MS = 2 * 60 * 1000;
  var STATUS_TEXT = { scheduled: 'Not started', live: 'Live', finished: 'Full time', postponed: 'Postponed' };

  var M = null;                 // last unity_admin_match() result
  var offset = 0;               // server time minus this device's time, so timers match on every phone
  var busyN = 0, lastSig = '', loading = false;
  var sheet = null;             // the open player sheet, or null
  var armed = null;             // a button waiting for a second tap to confirm
  var toastEl = null, toastTimer = null;
  var gone = {};                // sin-bin cards we have already announced as finished
  var lastFocus = null;

  var ICON = {
    ball: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><circle cx="32" cy="32" r="28"/><path d="M32 20l10 7.3-3.8 11.7H25.8L22 27.3z" fill="currentColor" fill-opacity=".9"/><path d="M32 20V6M42 27.3l14-4.2M38.2 39l8.6 12M25.8 39l-8.6 12M22 27.3l-14-4.2"/></svg>',
    card: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="2.5" width="13" height="19" rx="2.4" fill="currentColor"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4.5" width="4.2" height="15" rx="1.2" fill="currentColor"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2" fill="currentColor"/></svg>',
    flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2 6.3 20.3l1.2-6.4L2.8 9.5l6.4-.8z" fill="currentColor"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1 0l2.8-2.8a5 5 0 0 0-7.1-7.1l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.1 0L4.1 13.8a5 5 0 0 0 7.1 7.1l1.5-1.5"/></svg>',
    ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>'
  };

  // ---------------------------------------------------------------------
  // Small helpers
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  function nowMs() { return Date.now() + offset; }
  function say(t) { if (liveEl) { liveEl.textContent = ''; window.setTimeout(function () { liveEl.textContent = t; }, 40); } }
  function mmss(sec) { sec = Math.max(0, Math.floor(sec)); var m = Math.floor(sec / 60), s = sec % 60; return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s; }
  function minuteText(m) { return m == null ? '' : m + '′'; }
  function parseMinute(v) { v = String(v == null ? '' : v).trim(); if (v === '') return null; var n = Number(v); return isFinite(n) && n >= 0 && n <= 150 && Math.floor(n) === n ? n : false; }
  function isTmp(id) { return /^tmp-/.test(String(id)); }
  function ready() { return typeof supabaseIsConfigured !== 'undefined' && supabaseIsConfigured && typeof supabaseClient !== 'undefined' && supabaseClient; }
  function mediaUrl(path) { try { return supabaseClient.storage.from('unity-cup-gallery').getPublicUrl(path).data.publicUrl; } catch (e) { return ''; } }
  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* not supported */ } }

  function F() { return M.fixture; }
  function teamById(id) { return (M.teams || []).filter(function (t) { return t.id === id; })[0]; }
  function playerById(id) { return (M.players || []).filter(function (p) { return p.id === id; })[0]; }
  function homeT() { return teamById(F().home_team_id) || {}; }
  function awayT() { return teamById(F().away_team_id) || {}; }
  function otherId(team) { return team === F().home_team_id ? F().away_team_id : F().home_team_id; }
  function scoreOf(team) { return (team === F().home_team_id ? F().home_score : F().away_score) || 0; }
  function goalsOf() { return (M.goals || []).slice().sort(goalOrder); }
  function goalOrder(a, b) { var am = a.minute == null ? 1e9 : a.minute, bm = b.minute == null ? 1e9 : b.minute; return am - bm || String(a.created_at).localeCompare(String(b.created_at)); }
  function goalsFor(team) { return goalsOf().filter(function (g) { return g.team_id === team; }); }
  function latestGoal(team) { return goalsFor(team).sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); })[0]; }
  function scorerName(g) { var p = g.player_id && playerById(g.player_id); return (p && p.name) || g.scorer_name || ''; }
  function cardName(c) { var p = c.player_id && playerById(c.player_id); return (p && p.name) || c.player_name || 'A player'; }
  function crestHtml(t, size) {
    var col = (t && t.colour) || '#d4a62b';
    return '<span class="uc-crest uc-crest--' + (size || 'sm') + '" style="--tc:' + esc(col) + '">' + (t && t.logo_path ? '<img src="' + esc(mediaUrl(t.logo_path)) + '" alt="">' : '<b>' + esc(((t && (t.short_name || t.name)) || '?').slice(0, 3).toUpperCase()) + '</b>') + '</span>';
  }

  // The match clock (server time based, so every phone shows the same time and a reload loses nothing)
  function elapsedS() { var f = F(), e = f.clock_elapsed_s || 0; if (f.clock_started_at) e += Math.max(0, (nowMs() - Date.parse(f.clock_started_at)) / 1000); return e; }
  function clockRunning() { return !!F().clock_started_at; }
  function curMinute() { var f = F(); if (!f.clock_started_at && !f.clock_elapsed_s) return null; return Math.floor(elapsedS() / 60) + 1; }
  function isPublic() { var p = F().publish_at; return !!p && Date.parse(p) <= nowMs(); }

  // Who is off? A red card is out for the whole game; a yellow is a sin bin until its timer ends.
  function sentOffKeys() {
    var k = {};
    (M.cards || []).forEach(function (c) { if (c.kind === 'red') k[c.player_id || ('n:' + norm(c.player_name))] = true; });
    return k;
  }
  function isSentOff(p) { return !!sentOffKeys()[p.id]; }
  function sinBinFor(pid) {
    var now = nowMs(), off = sentOffKeys();
    return (M.cards || []).filter(function (c) { return c.kind === 'yellow' && c.until_at && Date.parse(c.until_at) > now && c.player_id === pid && !off[pid]; })[0];
  }
  function yellowsFor(pid) { return (M.cards || []).filter(function (c) { return c.kind === 'yellow' && c.player_id === pid; }).length; }

  // ---------------------------------------------------------------------
  // Talking to the database. The committee calls the committee functions directly. A private link goes through
  // unity_match_open / unity_match_do, which check the link and only allow this one match.
  var KEYERR = {
    bad_link: 'This link doesn\u2019t look right. Check you copied all of it, or ask for a new one.',
    link_off: 'The committee has switched this link off. Ask them for a new one if you\u2019re still keeping score.',
    expired: 'This link has expired. Scorer links stop working 24 hours after kick-off.'
  };
  var KEYMAP = { unity_admin_add_goal: 'add_goal', unity_admin_remove_goal: 'remove_goal', unity_admin_set_goal_scorer: 'set_goal_scorer', unity_admin_add_card: 'add_card', unity_admin_remove_card: 'remove_card', unity_admin_set_clock: 'set_clock', unity_admin_set_score: 'set_score' };
  function unwrapKey(r) {
    if (r.error) return r;
    var d = r.data;
    if (d && d.ok === false) return { data: null, error: { message: KEYERR[d.error] || KEYERR.bad_link, keyError: d.error || 'bad_link' } };
    if (d && d.ok === true && Object.prototype.hasOwnProperty.call(d, 'data') && !d.fixture) return { data: d.data, error: null };
    return r;
  }
  function api(fn, args) {
    if (!KEYMODE) return supabaseClient.rpc(fn, args);
    if (fn === 'unity_admin_match') return supabaseClient.rpc('unity_match_open', { p_key: KEY }).then(unwrapKey);
    var act = KEYMAP[fn];
    if (!act) return Promise.resolve({ data: null, error: { message: 'A private link can\u2019t do that.' } });
    return supabaseClient.rpc('unity_match_do', { p_key: KEY, p_action: act, p_args: args }).then(unwrapKey);
  }

  // ---------------------------------------------------------------------
  // Messages shown instead of the match
  function showPlain(html) { root.innerHTML = '<div class="um-plain">' + html + '</div>'; }
  function showKeyError(code) {
    dead = true;
    var title = code === 'expired' ? 'This link has expired' : code === 'link_off' ? 'This link has been switched off' : 'This link doesn\u2019t work';
    showPlain('<h1>' + title + '</h1><p>' + esc(KEYERR[code] || KEYERR.bad_link) + '</p><p class="um-fine">Anything you already entered has been saved.</p>');
    if (toastEl) hideToast();
    if (sheet) closeSheet(true);
  }
  function showSignIn() {
    var next = 'unity-match.html' + (FID ? '?id=' + encodeURIComponent(FID) : '');
    showPlain('<h1>Sign in to run this match</h1><p>This page is for the committee. Sign in with your members account and you’ll come straight back here.</p><a class="btn btn-primary" href="login.html?next=' + encodeURIComponent(next) + '">Sign in</a>');
  }
  function showNoAccess() { showPlain('<h1>This page is for the committee</h1><p>Your account doesn’t have <strong>Dashboard: Unity Cup</strong> access. Ask the president to add it in Hub Access.</p><a class="btn btn-outline" href="member-hub.html">Back to the hub</a>'); }
  function showNoId() { showPlain('<h1>Pick a match first</h1><p>Open the dashboard, go to <strong>Unity Cup &rarr; Fixtures</strong> and tap a match.</p><a class="btn btn-primary" href="president-dashboard.html#unity">Go to the fixtures</a>'); }
  function showMissing() { showPlain('<h1>We can’t find that match</h1><p>It may have been deleted.</p><a class="btn btn-primary" href="president-dashboard.html#unity">Go to the fixtures</a>'); }
  function showSetup(msg) {
    showPlain('<h1>One more step</h1><p>Run <code>126-unity-cup-match-control.sql</code> (from the <code>db/migrations</code> folder) in the Supabase SQL Editor, then reload this page.</p>' + (msg ? '<p class="um-fine">' + esc(msg) + '</p>' : '') + '<a class="btn btn-outline" href="president-dashboard.html#unity">Back to the fixtures</a>');
  }

  // ---------------------------------------------------------------------
  // Loading
  function load(force) {
    if (dead || loading || (!force && busyN > 0)) return Promise.resolve();
    loading = true;
    return api('unity_admin_match', { p_id: FID }).then(function (res) {
      loading = false;
      if (res.error) {
        var msg = res.error.message || '';
        if (res.error.keyError) { showKeyError(res.error.keyError); return; }
        if (!M) { if (/schema cache|could not find the function|does not exist/i.test(msg)) showSetup(msg); else showPlain('<h1>Couldn’t open the match</h1><p>' + esc(msg || 'Please check your connection and try again.') + '</p><button type="button" class="btn btn-primary" data-um-reload>Try again</button>'); }
        return;
      }
      var d = res.data || {};
      if (d.server_now) offset = Date.parse(d.server_now) - Date.now();
      if (d.missing) { showMissing(); return; }
      var sig = JSON.stringify([d.fixture, d.teams, d.players, d.goals, d.cards, d.mom_votes, d.mom_voters, d.links, d.link_expires_at, d.label]);
      var first = !M, changed = sig !== lastSig;
      M = d; lastSig = sig;
      if (first || (changed && !isTyping())) { render(); }
    }, function () { loading = false; });
  }
  function refresh() { lastSig = ''; if (loading) return new Promise(function (r) { window.setTimeout(r, 200); }).then(function () { return refresh(); }); return load(true); }
  function isTyping() { var a = document.activeElement; return !!a && root.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName); }

  // One database call: counts as busy (so the 5-second refresh waits) and never throws
  function call(fn, args) {
    busyN++;
    return api(fn, args).then(function (r) { busyN--; if (r.error && r.error.keyError) showKeyError(r.error.keyError); return r; }, function () { busyN--; return { error: { message: 'No connection. Please check your signal and try again.' } }; });
  }
  function failMsg(err) {
    var m = (err && err.message) || '';
    return /schema cache|could not find the function/i.test(m) ? 'Run migration 126-unity-cup-match-control.sql in Supabase first.' : (m || 'That didn’t save. Please try again.');
  }

  // ---------------------------------------------------------------------
  // Toast (with Undo)
  function hideToast() { if (toastEl) { toastEl.className = 'um-toast'; toastEl._undo = null; } }
  function toast(text, undo, bad) {
    if (!toastEl) {
      toastEl = document.createElement('div'); toastEl.className = 'um-toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
      toastEl.addEventListener('click', function (e) {
        if (e.target.closest('[data-um-toast-undo]') && toastEl._undo) { var fn = toastEl._undo; hideToast(); fn(); }
        else if (e.target.closest('[data-um-toast-x]')) hideToast();
      });
    }
    toastEl._undo = undo || null;
    toastEl.className = 'um-toast is-in' + (bad ? ' is-bad' : '');
    toastEl.innerHTML = '<span>' + esc(text) + '</span>' + (undo ? '<button type="button" data-um-toast-undo>Undo</button>' : '') + '<button type="button" class="um-toast-x" data-um-toast-x aria-label="Dismiss">' + ICON.close + '</button>';
    window.clearTimeout(toastTimer); toastTimer = window.setTimeout(hideToast, undo ? 10000 : bad ? 9000 : 4500);
    say(text);
  }

  // A button that needs a second tap ("Full time", "Reveal"), so a stray thumb can't do something big
  function disarm() { if (!armed) return; window.clearTimeout(armed.t); if (armed.el.isConnected) { armed.el.innerHTML = armed.html; armed.el.classList.remove('is-armed'); } armed = null; }
  function arm(el, label) {
    if (armed && armed.el === el) { disarm(); return true; }
    disarm();
    armed = { el: el, html: el.innerHTML, t: window.setTimeout(disarm, 4000) };
    el.classList.add('is-armed'); el.textContent = label; say(label);
    return false;
  }

  // ---------------------------------------------------------------------
  // The page
  function render() {
    if (!M) return;
    var f = F(), h = homeT(), a = awayT();
    document.title = (h.name || 'Home') + ' v ' + (a.name || 'Away') + ' - Match control';
    root.innerHTML = '<div class="um-a">' + keyBarHtml() + boardHtml() + visHtml() + controlsHtml() + '</div><div class="um-b">' + benchHtml() + eventsHtml() + momHtml() + linksHtml() + fixHtml() + footHtml() + '</div>';
    tick();
  }

  function statusPill() { var f = F(); return '<span class="um-pill is-' + esc(f.status) + '">' + (f.status === 'live' ? '<i></i>' : '') + esc(STATUS_TEXT[f.status] || f.status) + '</span>'; }

  function boardHtml() {
    var f = F(), h = homeT(), a = awayT(), hs = f.home_score == null ? 0 : f.home_score, as = f.away_score == null ? 0 : f.away_score;
    var when = f.kickoff_at ? new Date(f.kickoff_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    var meta = [f.stage, f.pitch, when].filter(Boolean).join(' · ');
    var running = clockRunning(), el = elapsedS(), started = el > 0 || running;
    var main;
    if (f.status === 'finished') {
      main = '<p class="um-state">Full time. Anything you add now still changes the result.</p><div class="um-row"><button type="button" class="um-btn um-btn--ghost" data-um-status="live">Re-open the match</button></div>';
    } else if (f.status === 'postponed') {
      main = '<p class="um-state">Postponed.</p><div class="um-row"><button type="button" class="um-btn um-btn--gold" data-um-kick>Kick off</button></div>';
    } else if (!started && f.status === 'scheduled') {
      main = '<div class="um-row"><button type="button" class="um-btn um-btn--gold um-btn--lg" data-um-kick>' + ICON.play + '<span>Kick off</span></button></div>';
    } else {
      main = '<div class="um-row um-row--2">' +
        (running ? '<button type="button" class="um-btn um-btn--ghost um-btn--lg" data-um-clock="pause">' + ICON.pause + '<span>Pause</span></button>'
                 : '<button type="button" class="um-btn um-btn--gold um-btn--lg" data-um-clock="start">' + ICON.play + '<span>' + (started ? 'Resume' : 'Start clock') + '</span></button>') +
        '<button type="button" class="um-btn um-btn--ghost um-btn--lg" data-um-fulltime>' + ICON.flag + '<span>Full time</span></button></div>';
    }
    return '<section class="um-board" aria-label="Scoreboard">' +
      '<div class="um-board-top">' + statusPill() + '<span class="um-meta">' + esc(meta) + '</span></div>' +
      '<div class="um-teams">' +
        '<div class="um-tm" style="--tc:' + esc(h.colour || '#d4a62b') + '">' + crestHtml(h, 'lg') + '<strong>' + esc(h.name || 'Home') + '</strong></div>' +
        '<div class="um-score" role="group" aria-label="Score"><b>' + hs + '</b><i aria-hidden="true">&ndash;</i><b>' + as + '</b></div>' +
        '<div class="um-tm" style="--tc:' + esc(a.colour || '#d4a62b') + '">' + crestHtml(a, 'lg') + '<strong>' + esc(a.name || 'Away') + '</strong></div>' +
      '</div>' +
      '<div class="um-clock' + (running ? ' is-running' : '') + '"><span class="um-clock-label">Match clock</span><b data-um-clock-text>' + mmss(el) + '</b><span class="um-clock-state">' + (running ? 'running' : started ? 'paused' : 'not started') + '</span></div>' +
      main + '</section>';
  }

  // Shown to someone who opened a private scorer link
  function keyBarHtml() {
    if (!KEYMODE) return '';
    var exp = M.expires_at ? new Date(M.expires_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    return '<section class="um-note um-note--key"><p><strong>You\u2019re keeping score with a private link</strong>' + (M.label ? ' (' + esc(M.label) + ')' : '') + '. It only works for this match' + (exp ? ' and stops on ' + esc(exp) : '') + '. Please don\u2019t share it.</p></section>';
  }
  function visHtml() {
    var f = F();
    if (isPublic()) return '';
    if (KEYMODE) return '<section class="um-note"><p><strong>This match isn\u2019t public yet.</strong> The committee publishes it. Everything you enter is saved, and visitors will see it once it\u2019s published.</p></section>';
    var sched = f.publish_at && Date.parse(f.publish_at) > nowMs();
    return '<section class="um-note um-note--warn"><p><strong>' + (sched ? 'Not public yet.' : 'Hidden from the public.') + '</strong> Visitors can’t see this match, its score or its scorers, and Man of the Match voting stays closed' + (sched ? ' until it goes public at ' + esc(new Date(f.publish_at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })) : '') + '.</p>' +
      '<button type="button" class="um-btn um-btn--gold" data-um-publish>Publish now</button></section>';
  }

  function controlsHtml() {
    function col(t, id) {
      var n = (M.cards || []).filter(function (c) { return c.team_id === id && c.kind === 'yellow'; }).length, r = (M.cards || []).filter(function (c) { return c.team_id === id && c.kind === 'red'; }).length;
      var lg = latestGoal(id);
      return '<div class="um-col" style="--tc:' + esc(t.colour || '#d4a62b') + '" data-team="' + esc(id) + '">' +
        '<h2>' + crestHtml(t, 'sm') + '<span>' + esc(t.name || '') + '</span></h2>' +
        '<button type="button" class="um-act um-act--goal" data-um-act="goal">' + ICON.ball + '<span>Goal</span></button>' +
        '<button type="button" class="um-act um-act--yellow" data-um-act="yellow">' + ICON.card + '<span>Yellow card</span><small>2 min sin bin</small></button>' +
        '<button type="button" class="um-act um-act--red" data-um-act="red">' + ICON.card + '<span>Red card</span><small>off for the game</small></button>' +
        '<button type="button" class="um-undo" data-um-undo' + (lg || scoreOf(id) > 0 ? '' : ' disabled') + '>' + ICON.undo + '<span>' + (lg ? 'Take off last goal' : 'Score minus 1') + '</span></button>' +
        (n || r ? '<p class="um-tally">' + (n ? n + ' yellow' + (n === 1 ? '' : 's') : '') + (n && r ? ' · ' : '') + (r ? r + ' red' : '') + '</p>' : '') + '</div>';
    }
    return '<section class="um-controls" aria-label="Record what happens">' + col(homeT(), F().home_team_id) + col(awayT(), F().away_team_id) + '</section>';
  }

  // Sin bin (timers) and sent off
  function benchHtml() {
    var now = nowMs(), off = sentOffKeys(), sin = [], offList = [];
    (M.cards || []).forEach(function (c) {
      if (c.kind === 'red') { offList.push(c); return; }
      if (!c.until_at || (c.player_id && off[c.player_id])) return;
      var left = Date.parse(c.until_at) - now;
      if (left > 0 || left > -12000) sin.push(c);   // keep "back on" visible for a few seconds
    });
    if (!sin.length && !offList.length) return '<section class="um-bench" data-um-bench hidden></section>';
    function rowSin(c) {
      var t = teamById(c.team_id) || {}, left = Date.parse(c.until_at) - now;
      return '<li class="um-sin' + (left <= 0 ? ' is-back' : '') + '" data-until="' + esc(c.until_at) + '" data-cid="' + esc(c.id) + '">' +
        '<i class="um-dot" style="background:' + esc(t.colour || '#d4a62b') + '" aria-hidden="true"></i>' +
        '<span class="um-sin-who"><strong>' + esc(cardName(c)) + '</strong><small>' + esc(t.name || '') + '</small></span>' +
        '<b class="um-sin-time" data-um-sin-time>' + (left > 0 ? mmss(left / 1000) : 'Back on') + '</b>' +
        '<span class="um-sin-bar" aria-hidden="true"><i data-um-sin-bar style="width:' + Math.max(0, Math.min(100, left / SIN_BIN_MS * 100)) + '%"></i></span></li>';
    }
    function rowOff(c) {
      var t = teamById(c.team_id) || {};
      return '<li class="um-off"><i class="um-sq um-sq--red" aria-hidden="true"></i><span class="um-sin-who"><strong>' + esc(cardName(c)) + '</strong><small>' + esc(t.name || '') + ' · off for the rest of the game</small></span>' + (c.minute != null ? '<b class="um-min">' + esc(minuteText(c.minute)) + '</b>' : '') + '</li>';
    }
    return '<section class="um-bench" data-um-bench aria-label="Sin bin and sent off">' +
      (sin.length ? '<h2><i class="um-sq um-sq--yellow" aria-hidden="true"></i>In the sin bin</h2><ul class="um-list">' + sin.map(rowSin).join('') + '</ul>' : '') +
      (offList.length ? '<h2><i class="um-sq um-sq--red" aria-hidden="true"></i>Sent off</h2><ul class="um-list">' + offList.map(rowOff).join('') + '</ul>' : '') + '</section>';
  }

  // What has happened, newest first
  function eventsHtml() {
    var ev = [];
    (M.goals || []).forEach(function (g) { ev.push({ t: 'goal', g: g, at: g.created_at }); });
    (M.cards || []).forEach(function (c) { ev.push({ t: c.kind, c: c, at: c.created_at }); });
    ev.sort(function (x, y) { return String(y.at).localeCompare(String(x.at)); });
    var f = F(), hints = [];
    [[f.home_team_id, homeT()], [f.away_team_id, awayT()]].forEach(function (p) {
      var un = Math.max(0, scoreOf(p[0]) - goalsFor(p[0]).length);
      if (un) hints.push('<li class="um-hint"><span>' + un + (un === 1 ? ' goal' : ' goals') + ' for <strong>' + esc(p[1].name || '') + '</strong> ' + (un === 1 ? 'has' : 'have') + ' no scorer listed.</span><button type="button" class="um-chip" data-um-fill data-team="' + esc(p[0]) + '">Add scorer</button></li>');
    });
    var over = [[f.home_team_id, homeT()], [f.away_team_id, awayT()]].filter(function (p) { return goalsFor(p[0]).length > scoreOf(p[0]); });
    over.forEach(function (p) { hints.push('<li class="um-hint is-warn"><span>More goals are listed for <strong>' + esc(p[1].name || '') + '</strong> than the score shows. Remove one, or fix the score below.</span></li>'); });
    var rows = ev.map(function (e) {
      if (e.t === 'goal') {
        var g = e.g, t = teamById(g.team_id) || {}, nm = scorerName(g);
        return '<li class="um-ev" data-gid="' + esc(g.id) + '"><span class="um-ev-ico um-ev-ico--goal">' + ICON.ball + '</span>' +
          '<span class="um-ev-text"><strong>' + (nm ? esc(nm) : '<em>Scorer not recorded</em>') + '</strong>' + (g.own_goal ? ' <span class="um-og">own goal</span>' : '') + '<small>Goal · ' + esc(t.name || '') + '</small></span>' +
          (g.minute != null ? '<b class="um-min">' + esc(minuteText(g.minute)) + '</b>' : '') +
          '<span class="um-ev-acts"><button type="button" class="um-chip' + (nm ? '' : ' is-gold') + '" data-um-goal-edit aria-label="' + (nm ? 'Change who scored' : 'Add the scorer') + ' for this goal">' + (nm ? 'Edit' : 'Add scorer') + '</button>' +
          '<button type="button" class="um-chip um-chip--x" data-um-goal-del aria-label="Remove this goal. The score goes down by one." title="Remove this goal (the score goes down by one)">' + ICON.close + '</button></span></li>';
      }
      var c = e.c, tm = teamById(c.team_id) || {}, y = c.kind === 'yellow' ? yellowsFor(c.player_id) : 0;
      return '<li class="um-ev" data-cid="' + esc(c.id) + '"><span class="um-ev-ico"><i class="um-sq um-sq--' + esc(c.kind) + '"></i></span>' +
        '<span class="um-ev-text"><strong>' + esc(cardName(c)) + '</strong><small>' + (c.kind === 'yellow' ? 'Yellow card' + (y > 1 ? ' · ' + y + ' yellows' : '') : 'Red card · sent off') + ' · ' + esc(tm.name || '') + '</small></span>' +
        (c.minute != null ? '<b class="um-min">' + esc(minuteText(c.minute)) + '</b>' : '') +
        '<span class="um-ev-acts"><button type="button" class="um-chip um-chip--x" data-um-card-del aria-label="Remove this card" title="Remove this card">' + ICON.close + '</button></span></li>';
    }).join('');
    return '<section class="um-card" aria-label="What has happened"><h2>What has happened</h2>' +
      (hints.length ? '<ul class="um-list um-hints">' + hints.join('') + '</ul>' : '') +
      (rows ? '<ol class="um-list um-events">' + rows + '</ol>' : '<p class="um-empty">Nothing yet. Goals and cards you record show up here.</p>') + '</section>';
  }

  // Man of the Match
  function momHtml() {
    if (KEYMODE) return '';
    var f = F(), votes = M.mom_votes || [], total = votes.reduce(function (n, v) { return n + v.votes; }, 0), voters = M.mom_voters || 0;
    var openNow = isPublic() && (f.status === 'live' || f.status === 'finished') && f.mom_open && !f.mom_show;
    var head, body = '', acts = '';
    if (f.mom_show) {
      head = '<span class="um-pill is-finished">Winner shown publicly</span>';
      acts = '<button type="button" class="um-btn um-btn--ghost" data-um-mom="hide">Hide the winner</button>';
    } else if (openNow) {
      head = '<span class="um-pill is-live"><i></i>Voting open</span>';
      body = '<p>Visitors can vote on the public Fixtures page. Results stay private until you reveal them.</p>';
      acts = '<button type="button" class="um-btn um-btn--ghost" data-um-mom="close">Close voting</button><button type="button" class="um-btn um-btn--gold" data-um-mom="reveal" data-um-arm="Tap again to show the winner">Close and reveal winner</button>';
    } else if (!f.mom_open) {
      head = '<span class="um-pill is-scheduled">Voting closed</span>';
      body = '<p>Results are private until you reveal the winner.</p>';
      acts = '<button type="button" class="um-btn um-btn--gold" data-um-mom="reveal" data-um-arm="Tap again to show the winner">Reveal the winner</button><button type="button" class="um-btn um-btn--ghost" data-um-mom="open">Re-open voting</button>';
    } else {
      head = '<span class="um-pill is-scheduled">Waiting</span>';
      body = '<p>Voting opens by itself once the match is public and live. You can also close it early.</p>';
      acts = '<button type="button" class="um-btn um-btn--ghost" data-um-mom="close">Switch voting off for this match</button>';
    }
    var pl = (M.players || []).map(function (p) { var v = votes.filter(function (x) { return x.player_id === p.id; })[0]; return { p: p, v: v ? v.votes : 0 }; }).filter(function (x) { return x.v > 0; }).sort(function (a, b) { return b.v - a.v; });
    var top = pl.length ? pl[0].v : 0;
    var board = pl.length ? '<ol class="um-mom-board">' + pl.slice(0, 6).map(function (x, i) {
      var t = teamById(x.p.team_id) || {};
      return '<li' + (i === 0 ? ' class="is-top"' : '') + '><span class="um-mom-name"><strong>' + esc(x.p.name) + '</strong><small>' + esc(t.name || '') + '</small></span><b>' + x.v + '</b><span class="um-mom-bar"><i style="width:' + Math.round(x.v / top * 100) + '%"></i></span></li>';
    }).join('') + '</ol>' : '<p class="um-empty">No votes yet.</p>';
    return '<section class="um-card um-mom" aria-label="Man of the Match"><div class="um-card-head"><h2>' + ICON.star + 'Man of the Match</h2>' + head + '</div>' + body +
      '<p class="um-mom-count"><b>' + voters + '</b> ' + (voters === 1 ? 'person has' : 'people have') + ' voted' + (total !== voters ? ' (' + total + ' votes)' : '') + '. Only the committee sees this live.</p>' + board +
      '<div class="um-row um-row--wrap">' + acts + '</div></section>';
  }

  // Private scorer links (committee only)
  function linkUrl(l) { return new URL('unity-match.html', window.location.href).href + '#' + l.token; }
  function expiresText() { return M.link_expires_at ? new Date(M.link_expires_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; }
  function agoText(iso) {
    if (!iso) return '';
    var s = Math.max(0, (nowMs() - Date.parse(iso)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  }
  function linkMessage(l) {
    var f = F(), when = f.kickoff_at ? new Date(f.kickoff_at).toLocaleString('en-GB', { weekday: 'long', hour: '2-digit', minute: '2-digit' }) : '';
    return 'Hi' + (l.label ? ' ' + l.label : '') + '! Here\u2019s your private link to keep score for ' + (homeT().name || 'Home') + ' v ' + (awayT().name || 'Away') + ' at the LACMS Unity Cup' + (when ? ' (' + when + (f.pitch ? ', ' + f.pitch : '') + ')' : '') + ':\n' + linkUrl(l) +
      '\n\nOpen it on your phone. Tap Goal or a card for the right team, pick the player, and it\u2019s saved straight away (there\u2019s an Undo if you slip). You can also run the match clock. Please don\u2019t share the link' + (expiresText() ? ' \u2014 it stops working on ' + expiresText() : '') + '. Thank you!';
  }
  function linksHtml() {
    if (KEYMODE) return '';
    if (M.links === undefined) return '<section class="um-note um-note--warn"><p><strong>One more step for scorer links.</strong> Run <code>127-unity-cup-scorer-links.sql</code> in the Supabase SQL Editor, then reload.</p></section>';
    var links = M.links || [];
    return '<section class="um-card um-links" aria-label="Private scorer links"><div class="um-card-head"><h2>' + ICON.link + 'Scorer links</h2></div>' +
      '<p class="um-fine">Send a private link to anyone who\u2019ll keep score for this match. They don\u2019t need an account or to be on the committee: they open it and get this page for <strong>this match only</strong> (goals, scorers, cards, the clock and the score). They can\u2019t publish it or see Man of the Match.</p>' +
      (links.length ? '<ul class="um-list">' + links.map(function (l, i) {
        var url = linkUrl(l);
        return '<li class="um-link' + (l.enabled ? '' : ' is-off') + '" data-lid="' + esc(l.id) + '"><div class="um-link-top"><strong>' + esc(l.label || 'Link ' + (i + 1)) + '</strong><span class="um-pill ' + (l.enabled ? 'is-live' : 'is-scheduled') + '">' + (l.enabled ? 'On' : 'Off') + '</span></div>' +
          '<small>' + (l.last_used_at ? 'Last used ' + esc(agoText(l.last_used_at)) + ' \u00b7 ' + (l.uses || 0) + (l.uses === 1 ? ' action' : ' actions') : 'Not opened yet') + '</small>' +
          '<input class="um-url" readonly value="' + esc(url) + '" data-um-url aria-label="Private link' + (l.label ? ' for ' + esc(l.label) : '') + '">' +
          '<div class="um-row um-row--wrap">' + (navigator.share ? '<button type="button" class="um-btn um-btn--gold um-btn--sm" data-um-link="share">Send\u2026</button>' : '') +
          '<button type="button" class="um-btn um-btn--ghost um-btn--sm" data-um-link="copy">Copy link</button><button type="button" class="um-btn um-btn--ghost um-btn--sm" data-um-link="copymsg">Copy message</button>' +
          '<button type="button" class="um-btn um-btn--ghost um-btn--sm" data-um-link="' + (l.enabled ? 'disable' : 'enable') + '">' + (l.enabled ? 'Turn off' : 'Turn on') + '</button>' +
          '<button type="button" class="um-btn um-btn--ghost um-btn--sm" data-um-link="regenerate" data-um-arm="Tap again: old link stops">New link</button>' +
          '<button type="button" class="um-btn um-btn--ghost um-btn--sm um-btn--danger" data-um-link="remove" data-um-arm="Tap again to remove">Remove</button></div></li>';
      }).join('') + '</ul>' : '<p class="um-empty">No links yet.</p>') +
      '<form class="um-newlink" data-um-newlink><label><span class="visually-hidden">Who is the link for?</span><input type="text" maxlength="40" placeholder="Who is it for? (optional, e.g. Sam)" data-um-newlabel autocomplete="off"></label><button type="submit" class="um-btn um-btn--gold">Make a link</button></form>' +
      (expiresText() ? '<p class="um-fine">Links stop working by themselves on ' + esc(expiresText()) + ' (24 hours after kick-off). Turn one off or remove it any time and it stops straight away.</p>' : '') + '</section>';
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
      document.body.removeChild(ta); if (ok) resolve(); else reject();
    });
  }
  function linkAct(lid, action) {
    var l = (M.links || []).filter(function (x) { return x.id === lid; })[0]; if (!l) return;
    if (action === 'copy' || action === 'copymsg') {
      copyText(action === 'copy' ? linkUrl(l) : linkMessage(l)).then(function () { toast(action === 'copy' ? 'Link copied.' : 'Message copied. Paste it into WhatsApp or a text.'); }, function () { var inp = $('[data-um-url]', $('[data-lid="' + lid + '"]', root)); if (inp) { inp.focus(); inp.select(); } toast('Press and hold the link to copy it.'); });
      return;
    }
    if (action === 'share') {
      navigator.share({ title: 'Keep score: ' + (homeT().name || '') + ' v ' + (awayT().name || ''), text: linkMessage(l) }).catch(function () { /* cancelled */ });
      return;
    }
    return call('unity_admin_match_link', { p_fixture: F().id, p_action: action, p_label: null, p_link: lid }).then(function (r) {
      if (r.error) { toast(failMsg(r.error), null, true); return refresh(); }
      toast({ enable: 'Link turned on.', disable: 'Link turned off. It stops working now.', regenerate: 'New link made. The old one stops working now, so send the new one.', remove: 'Link removed. It stops working now.' }[action] || 'Saved.');
      return refresh();
    });
  }
  function makeLink(label) {
    return call('unity_admin_match_link', { p_fixture: F().id, p_action: 'create', p_label: label || null, p_link: null }).then(function (r) {
      if (r.error) { toast(/schema cache|could not find the function|does not exist/i.test(r.error.message || '') ? 'Run migration 127-unity-cup-scorer-links.sql in Supabase first.' : failMsg(r.error), null, true); return refresh(); }
      toast('Link made. Send it to the person keeping score.');
      return refresh();
    });
  }

  // Fix the score / status by hand
  function fixHtml() {
    var f = F();
    return '<details class="um-card um-fix"><summary><h2>Fix the score, status or clock</h2></summary>' +
      '<p class="um-fine">Typing a score here doesn’t change the list of goals. Use the Goal button to record who scored.</p>' +
      '<div class="um-fix-grid"><label><span>' + esc(homeT().name || 'Home') + '</span><input type="number" min="0" max="99" inputmode="numeric" data-um-hs value="' + (f.home_score == null ? '' : f.home_score) + '"></label>' +
      '<label><span>' + esc(awayT().name || 'Away') + '</span><input type="number" min="0" max="99" inputmode="numeric" data-um-as value="' + (f.away_score == null ? '' : f.away_score) + '"></label>' +
      '<label class="um-fix-wide"><span>Status</span><select data-um-st>' + ['scheduled', 'live', 'finished', 'postponed'].map(function (s) { return '<option value="' + s + '"' + (f.status === s ? ' selected' : '') + '>' + STATUS_TEXT[s] + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="um-row um-row--wrap"><button type="button" class="um-btn um-btn--gold" data-um-save-fix>Save</button><button type="button" class="um-btn um-btn--ghost" data-um-clock="reset" data-um-arm="Tap again to reset the clock">Reset the clock to 00:00</button></div></details>';
  }

  function footHtml() {
    if (KEYMODE) return '<p class="um-foot"><a href="unity-cup-fixtures.html" target="_blank" rel="noopener">See it on the public page ' + ICON.ext + '</a></p>';
    return '<p class="um-foot"><a href="unity-cup-fixtures.html" target="_blank" rel="noopener">See it on the public page ' + ICON.ext + '</a><a href="president-dashboard.html#unity">Edit teams, time or pitch</a></p>';
  }

  // ---------------------------------------------------------------------
  // Timers (updated in place every quarter second, not by redrawing the page)
  function tick() {
    var el = $('[data-um-clock-text]', root); if (el && M) el.textContent = mmss(elapsedS());
    var now = nowMs();
    $$('.um-sin', root).forEach(function (li) {
      var left = Date.parse(li.getAttribute('data-until')) - now, cid = li.getAttribute('data-cid');
      var t = $('[data-um-sin-time]', li), bar = $('[data-um-sin-bar]', li);
      if (left > 0) {
        if (t) t.textContent = mmss(Math.ceil(left / 1000));
        if (bar) bar.style.width = Math.max(0, Math.min(100, left / SIN_BIN_MS * 100)) + '%';
        li.classList.toggle('is-low', left <= 15000);
      } else {
        if (t) t.textContent = 'Back on';
        if (bar) bar.style.width = '0%';
        li.classList.remove('is-low'); li.classList.add('is-back');
        if (!gone[cid]) {
          gone[cid] = true;
          if (left > -4000) { var c = (M.cards || []).filter(function (x) { return x.id === cid; })[0]; if (c) { vibrate([220, 90, 220]); toast(cardName(c) + ' is back on.'); } }
        }
        if (left < -12000 && li.parentNode) li.parentNode.removeChild(li);
      }
    });
    var bench = $('[data-um-bench]', root);
    if (bench && !bench.hidden && !$('.um-sin, .um-off', bench)) bench.hidden = true;
  }

  // ---------------------------------------------------------------------
  // The player sheet
  function openSheet(kind, team, opts) {
    opts = opts || {};
    lastFocus = document.activeElement;
    var min = opts.minute !== undefined ? opts.minute : curMinute();
    sheet = { kind: kind, team: team, mode: opts.mode || 'add', goalId: opts.goalId || null, bump: opts.bump !== false, q: '', minute: min == null ? '' : String(min), active: -1, el: null };
    var el = document.createElement('div');
    el.className = 'um-sheet';
    el.innerHTML = '<div class="um-sheet-back" data-um-sheet-close></div><div class="um-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="um-sheet-title" tabindex="-1">' + sheetInner() + '</div>';
    document.body.appendChild(el); document.body.classList.add('um-sheet-open');
    sheet.el = el;
    fillList();
    window.requestAnimationFrame(function () {
      el.classList.add('is-open');
      var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      var q = $('[data-um-q]', el); if (q && !coarse) q.focus({ preventScroll: true }); else $('.um-sheet-panel', el).focus({ preventScroll: true });
    });
  }
  function closeSheet(silent) {
    if (!sheet) return;
    var el = sheet.el; sheet = null;
    document.body.classList.remove('um-sheet-open');
    el.classList.remove('is-open');
    window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, silent ? 0 : 200);
    if (!silent && lastFocus && lastFocus.focus && lastFocus.isConnected) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }
  function sheetTitle() {
    var t = teamById(sheet.team) || {};
    if (sheet.kind === 'goal') return sheet.mode === 'edit' ? 'Who scored for ' + t.name + '?' : 'Goal for ' + t.name;
    return (sheet.kind === 'yellow' ? 'Yellow card' : 'Red card') + ' for ' + t.name;
  }
  function sheetHelp() {
    var t = teamById(sheet.team) || {};
    if (sheet.kind === 'goal') return sheet.mode === 'edit' ? 'Pick the right name. The score stays as it is.' : sheet.bump ? 'Pick the scorer. The score for ' + t.name + ' goes up by one.' : 'This goal is already in the score, so the score stays as it is.';
    if (sheet.kind === 'yellow') return 'A 2 minute sin bin timer starts as soon as you pick the player.';
    return 'They’re off for the rest of the game, so ' + t.name + ' plays a player down.';
  }
  function sheetInner() {
    var none = sheet.kind === 'goal' ? (sheet.mode === 'edit' ? (function () { var g = goalById(sheet.goalId); return g && scorerName(g) ? 'Remove the scorer (keep the goal)' : ''; })() : 'Record the goal without a name') : '';
    return '<div class="um-sheet-head"><div><h2 id="um-sheet-title">' + esc(sheetTitle()) + '</h2><p>' + esc(sheetHelp()) + '</p></div><button type="button" class="um-x" data-um-sheet-close aria-label="Close">' + ICON.close + '</button></div>' +
      '<div class="um-sheet-find"><label><span class="visually-hidden">Search players</span><input type="search" data-um-q placeholder="' + (sheet.kind === 'goal' ? 'Search both teams…' : 'Search players…') + '" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="done" role="combobox" aria-expanded="true" aria-controls="um-list" aria-autocomplete="list"></label>' +
      '<label><span class="visually-hidden">Minute (optional)</span><input type="number" data-um-min min="0" max="150" inputmode="numeric" placeholder="Min" value="' + esc(sheet.minute) + '"></label></div>' +
      '<div class="um-sheet-list" id="um-list" role="listbox" aria-label="Players" data-um-list></div><p class="visually-hidden" role="status" data-um-count></p>' +
      '<div class="um-sheet-foot">' + (none ? '<button type="button" class="um-btn um-btn--ghost" data-um-none>' + esc(none) + '</button>' : '') + '<button type="button" class="um-btn um-btn--ghost" data-um-sheet-close>Cancel</button></div>';
  }
  function goalById(id) { return (M.goals || []).filter(function (g) { return g.id === id; })[0]; }

  function sheetModel() {
    var s = sheet, toks = norm(s.q).split(/\s+/).filter(Boolean), groups = [], flat = [];
    var order = s.kind === 'goal' ? [[s.team, false], [otherId(s.team), true]] : [[s.team, false]];
    order.forEach(function (pair) {
      var rows = (M.players || []).filter(function (p) { return p.team_id === pair[0]; }), hits = [];
      rows.forEach(function (p) {
        var n = norm(p.name), sh = norm(p.shirt_no), rank = 0;
        if (toks.length) {
          if (!toks.every(function (tk) { return n.indexOf(tk) >= 0 || (sh && /^\d+$/.test(tk) && sh === tk); })) return;
          rank = (n.split(/\s+/).some(function (w) { return w.indexOf(toks[0]) === 0; }) || sh === toks[0]) ? 0 : 1;
        }
        hits.push({ p: p, rank: rank });
      });
      if (toks.length) hits.sort(function (a, b) { return a.rank - b.rank; });
      groups.push({ team: teamById(pair[0]) || {}, own: pair[1], total: rows.length, rows: hits.map(function (x) { return x.p; }) });
    });
    groups.forEach(function (g) { g.rows.forEach(function (p) { flat.push({ player: p, own: g.own }); }); });
    var q = String(s.q || '').trim(), guest = null;
    if (q.length >= 2 && !flat.some(function (it) { return norm(it.player.name) === norm(q); })) { guest = q.slice(0, 60); flat.push({ guest: guest }); }
    return { groups: groups, flat: flat, guest: guest, q: q };
  }
  function listHtml() {
    var s = sheet, m = sheetModel(), i = 0, cred = teamById(s.team) || {};
    if (s.active == null || s.active >= m.flat.length) s.active = m.q && m.flat.length ? 0 : -1;
    function row(no, name, tag, cls, disabled) {
      var idx = i++;
      return '<button type="button" role="option" id="um-o' + idx + '" class="um-pk' + (cls || '') + (idx === s.active ? ' is-active' : '') + '" aria-selected="' + (idx === s.active) + '"' + (disabled ? ' aria-disabled="true"' : '') + ' data-um-pick="' + idx + '">' +
        '<span class="um-pk-no">' + esc(no) + '</span><span class="um-pk-txt"><span class="um-pk-name">' + name + '</span>' + (tag ? '<span class="um-pk-tag">' + tag + '</span>' : '') + '</span></button>';
    }
    var html = m.groups.map(function (g) {
      if (!g.rows.length && g.total) return '';
      var head = '<div class="um-pk-group' + (g.own ? ' is-own' : '') + '" role="presentation"><i style="background:' + esc(g.team.colour || '#d4a62b') + '"></i><span>' + esc(g.team.name || '') + '</span>' + (g.own ? '<small>own goal for ' + esc(cred.name || '') + '</small>' : '') + '</div>';
      if (!g.total) return head + '<p class="um-pk-none">No players added for ' + esc(g.team.name || 'this team') + ' yet. You can still type a name below.</p>';
      return head + g.rows.map(function (p) {
        var off = isSentOff(p), sb = !off && sinBinFor(p.id), y = yellowsFor(p.id), tags = [];
        if (p.position) tags.push(esc(p.position));
        if (p.captain) tags.push('Captain');
        if (off) tags.push('<b class="um-tg um-tg--red">Sent off</b>');
        else if (sb) tags.push('<b class="um-tg um-tg--yellow">In the sin bin</b>');
        else if (y) tags.push('<b class="um-tg um-tg--yellow">' + y + ' yellow' + (y > 1 ? 's' : '') + '</b>');
        return row(p.shirt_no || '–', esc(p.name), tags.join(' · '), (g.own ? ' is-own' : '') + (off ? ' is-off' : ''), off);
      }).join('');
    }).join('');
    if (m.q && !m.flat.some(function (it) { return it.player; })) html += '<p class="um-pk-none">No one on the squad list matches “' + esc(m.q) + '”.</p>';
    if (m.guest) html += '<div class="um-pk-group" role="presentation"><span>Not on the list?</span></div>' + row('+', 'Use “' + esc(m.guest) + '”', 'type-in player', ' um-pk-guest');
    return html;
  }
  function fillList() {
    var l = $('[data-um-list]', sheet.el); if (!l) return;
    sheet.active = sheetModel().flat.length && sheet.q.trim() ? 0 : -1;
    l.innerHTML = listHtml();
    var n = $$('.um-pk', l).length, c = $('[data-um-count]', sheet.el); if (c) c.textContent = n + (n === 1 ? ' result' : ' results');
    var qi = $('[data-um-q]', sheet.el); if (qi) { if (sheet.active >= 0) qi.setAttribute('aria-activedescendant', 'um-o' + sheet.active); else qi.removeAttribute('aria-activedescendant'); }
  }
  function moveActive(d) {
    var rows = $$('.um-pk', sheet.el); if (!rows.length) return;
    var n = sheet.active < 0 ? (d > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, sheet.active + d));
    sheet.active = n;
    rows.forEach(function (r, i) { r.classList.toggle('is-active', i === n); r.setAttribute('aria-selected', i === n ? 'true' : 'false'); });
    rows[n].scrollIntoView({ block: 'nearest' });
    var qi = $('[data-um-q]', sheet.el); if (qi) qi.setAttribute('aria-activedescendant', 'um-o' + n);
  }
  function choose(idx) {
    var s = sheet; if (!s) return;
    var it = sheetModel().flat[idx]; if (!it) return;
    var minute = parseMinute(s.minute);
    if (minute === false) { toast('The minute must be a whole number from 0 to 150 (or leave it empty).', null, true); return; }
    if (it.player && isSentOff(it.player)) { toast(it.player.name + ' has been sent off, so they can’t be picked.', null, true); return; }
    var sh = { kind: s.kind, team: s.team, mode: s.mode, goalId: s.goalId, bump: s.bump };
    closeSheet(true);
    if (sh.kind === 'goal') {
      if (sh.mode === 'edit') setScorer(sh.goalId, it.player || null, it.guest || null, minute);
      else recordGoal({ team: sh.team, player: it.player || null, name: it.guest || null, minute: minute, bump: sh.bump });
    } else {
      recordCard({ kind: sh.kind, team: it.player ? it.player.team_id : sh.team, player: it.player || null, name: it.guest || null, minute: minute });
    }
  }
  function chooseNone() {
    var s = sheet; if (!s) return;
    var minute = parseMinute(s.minute);
    if (minute === false) { toast('The minute must be a whole number from 0 to 150 (or leave it empty).', null, true); return; }
    var sh = { team: s.team, mode: s.mode, goalId: s.goalId, bump: s.bump };
    closeSheet(true);
    if (sh.mode === 'edit') setScorer(sh.goalId, null, null, minute);
    else recordGoal({ team: sh.team, player: null, name: null, minute: minute, bump: sh.bump });
  }

  // ---------------------------------------------------------------------
  // Saving. Each change shows on the screen at once, then is confirmed with the database.
  function bumpLocal(team, d) {
    var f = F(); if (f.home_score == null) f.home_score = 0; if (f.away_score == null) f.away_score = 0;
    if (team === f.home_team_id) f.home_score = Math.max(0, f.home_score + d); else f.away_score = Math.max(0, f.away_score + d);
  }
  function recordGoal(o) {
    var f = F(), pl = o.player, t = teamById(o.team) || {};
    (M.goals = M.goals || []).push({ id: 'tmp-' + Date.now(), fixture_id: f.id, team_id: o.team, player_id: pl ? pl.id : null, scorer_name: pl ? pl.name : (o.name || null), own_goal: !!(pl && pl.team_id !== o.team), minute: o.minute, created_at: new Date().toISOString() });
    if (o.bump) { bumpLocal(o.team, 1); if (f.status === 'scheduled') f.status = 'live'; }
    render();
    return call('unity_admin_add_goal', { p_fixture: f.id, p_team: o.team, p_player: pl ? pl.id : null, p_name: pl ? null : (o.name || null), p_minute: o.minute, p_bump: !!o.bump }).then(function (r) {
      if (r.error) { toast(failMsg(r.error), null, true); return refresh(); }
      var nm = pl ? pl.name : (o.name || ''), own = !!(pl && pl.team_id !== o.team), gid = r.data;
      toast(o.bump ? 'Goal for ' + (t.name || 'the team') + (nm ? ': ' + nm + (own ? ' (own goal)' : '') : ' (scorer not recorded)') : 'Scorer saved: ' + nm + (own ? ' (own goal)' : ''),
        o.bump && gid ? function () { removeGoal(gid, true); } : null);
      return refresh();
    });
  }
  function removeGoal(gid, quiet) {
    if (isTmp(gid)) return;
    var g = goalById(gid); if (!g) return;
    var t = teamById(g.team_id) || {}, pl = g.player_id ? playerById(g.player_id) : null, nm = scorerName(g);
    M.goals = (M.goals || []).filter(function (x) { return x.id !== gid; });
    bumpLocal(g.team_id, -1); render();
    return call('unity_admin_remove_goal', { p_id: gid }).then(function (r) {
      if (r.error) { toast(failMsg(r.error), null, true); return refresh(); }
      toast(quiet ? 'Goal taken off.' : 'Took off ' + (nm ? nm + '’s goal' : 'a goal') + ' for ' + (t.name || 'the team') + '.',
        quiet ? null : function () { recordGoal({ team: g.team_id, player: pl || null, name: pl ? null : (nm || null), minute: g.minute, bump: true }); });
      return refresh();
    });
  }
  function setScorer(gid, pl, name, minute) {
    if (isTmp(gid)) return;
    var g = goalById(gid); if (!g) return;
    g.player_id = pl ? pl.id : null; g.scorer_name = pl ? pl.name : (name || null); g.own_goal = !!(pl && pl.team_id !== g.team_id); g.minute = minute; render();
    return call('unity_admin_set_goal_scorer', { p_id: gid, p_player: pl ? pl.id : null, p_name: pl ? null : (name || null), p_minute: minute }).then(function (r) {
      if (r.error) { toast(failMsg(r.error), null, true); return refresh(); }
      var nm = pl ? pl.name : (name || '');
      toast(nm ? 'Scorer saved: ' + nm + (g.own_goal ? ' (own goal)' : '') : 'Scorer removed. The goal is still in the score.');
      return refresh();
    });
  }
  function recordCard(o) {
    var f = F(), t = teamById(o.team) || {}, pl = o.player, nm = pl ? pl.name : (o.name || '');
    var tmp = { id: 'tmp-' + Date.now(), fixture_id: f.id, team_id: o.team, player_id: pl ? pl.id : null, player_name: pl ? null : nm, kind: o.kind, minute: o.minute, until_at: o.kind === 'yellow' ? new Date(nowMs() + SIN_BIN_MS).toISOString() : null, created_at: new Date().toISOString() };
    (M.cards = M.cards || []).push(tmp); if (f.status === 'scheduled') f.status = 'live'; render();
    return call('unity_admin_add_card', { p_fixture: f.id, p_team: o.team, p_player: pl ? pl.id : null, p_name: pl ? null : (o.name || null), p_kind: o.kind, p_minute: o.minute }).then(function (r) {
      if (r.error) { toast(failMsg(r.error), null, true); return refresh(); }
      var cid = r.data && r.data.id;
      vibrate(o.kind === 'red' ? [120, 60, 120] : 60);
      toast(o.kind === 'yellow' ? 'Yellow card: ' + nm + '. 2 minute sin bin started.' : 'Red card: ' + nm + ' is off for the rest of the game.', cid ? function () { removeCard(cid, true); } : null);
      return refresh();
    });
  }
  function removeCard(cid, quiet) {
    if (isTmp(cid)) return;
    var c = (M.cards || []).filter(function (x) { return x.id === cid; })[0]; if (!c) return;
    var pl = c.player_id ? playerById(c.player_id) : null;
    M.cards = M.cards.filter(function (x) { return x.id !== cid; }); render();
    return call('unity_admin_remove_card', { p_id: cid }).then(function (r) {
      if (r.error) { toast(failMsg(r.error), null, true); return refresh(); }
      toast(quiet ? 'Card taken off.' : 'Removed the ' + c.kind + ' card for ' + cardName(c) + '.',
        quiet ? null : function () { recordCard({ kind: c.kind, team: c.team_id, player: pl || null, name: pl ? null : c.player_name, minute: c.minute }); });
      return refresh();
    });
  }
  function undoLast(team) {
    var lg = latestGoal(team);
    if (lg) { removeGoal(lg.id); return; }
    var f = F(); if (scoreOf(team) <= 0) return;
    var hs = f.home_score || 0, as = f.away_score || 0;
    if (team === f.home_team_id) hs--; else as--;
    setScoreStatus(hs, as, f.status, 'Score updated.');
  }
  function setScoreStatus(hs, as, status, msg) {
    var f = F(); f.home_score = hs; f.away_score = as; f.status = status; render();
    return call('unity_admin_set_score', { p_id: f.id, p_home_score: hs, p_away_score: as, p_status: status }).then(function (r) {
      if (r.error) { toast(failMsg(r.error), null, true); return refresh(); }
      if (msg) toast(msg);
      return refresh();
    });
  }
  function clockAct(action, msg) {
    var f = F(), now = new Date(nowMs()).toISOString();
    if (action === 'start') { f.clock_started_at = now; if (f.status === 'scheduled') f.status = 'live'; }
    else if (action === 'pause') { f.clock_elapsed_s = Math.floor(elapsedS()); f.clock_started_at = null; }
    else { f.clock_elapsed_s = 0; f.clock_started_at = null; }
    render();
    return call('unity_admin_set_clock', { p_id: f.id, p_action: action }).then(function (r) {
      if (r.error) { toast(failMsg(r.error), null, true); return refresh(); }
      if (msg) toast(msg);
      return refresh();
    });
  }
  function fullTime() {
    var f = F();
    if (clockRunning()) { f.clock_elapsed_s = Math.floor(elapsedS()); f.clock_started_at = null; }
    f.status = 'finished'; render();
    return call('unity_admin_set_clock', { p_id: f.id, p_action: 'pause' }).then(function () {
      return call('unity_admin_set_score', { p_id: f.id, p_home_score: f.home_score || 0, p_away_score: f.away_score || 0, p_status: 'finished' });
    }).then(function (r) {
      if (r.error) { toast(failMsg(r.error), null, true); return refresh(); }
      toast('Full time: ' + (homeT().name || '') + ' ' + (f.home_score || 0) + '–' + (f.away_score || 0) + ' ' + (awayT().name || '') + '.', function () { setScoreStatus(f.home_score || 0, f.away_score || 0, 'live', 'Match re-opened.'); });
      return refresh();
    });
  }
  function momAct(action) {
    var f = F();
    return call('unity_admin_set_mom', { p_id: f.id, p_action: action }).then(function (r) {
      if (r.error) { toast(failMsg(r.error), null, true); return refresh(); }
      toast({ open: 'Man of the Match voting is open.', close: 'Man of the Match voting is closed.', reveal: 'The winner is now public.', hide: 'The winner is hidden again.' }[action] || 'Saved.');
      return refresh();
    });
  }
  function publishNow() {
    return call('unity_admin_set_fixture_visibility', { p_ids: [F().id], p_mode: 'now', p_at: null }).then(function (r) {
      if (r.error) { toast(/schema cache|could not find the function/i.test(r.error.message || '') ? 'Run migration 122-unity-cup-publish-fixtures.sql in Supabase first.' : failMsg(r.error), null, true); return refresh(); }
      toast('This match is now public.'); return refresh();
    });
  }

  // ---------------------------------------------------------------------
  // Events
  root.addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest('[data-um-reload]')) { window.location.reload(); return; }
    var act = t.closest('[data-um-act]');
    if (act) { openSheet(act.getAttribute('data-um-act'), act.closest('[data-team]').getAttribute('data-team')); return; }
    if (t.closest('[data-um-undo]')) { var ub = t.closest('[data-um-undo]'); if (!ub.disabled) undoLast(ub.closest('[data-team]').getAttribute('data-team')); return; }
    if (t.closest('[data-um-kick]')) { clockAct('start', 'Kick off! The clock is running.'); return; }
    var ck = t.closest('[data-um-clock]');
    if (ck) {
      var a = ck.getAttribute('data-um-clock');
      if (ck.hasAttribute('data-um-arm') && !arm(ck, ck.getAttribute('data-um-arm'))) return;
      clockAct(a, a === 'reset' ? 'Clock reset.' : a === 'pause' ? 'Clock paused.' : 'Clock running.'); return;
    }
    var ft = t.closest('[data-um-fulltime]'); if (ft) { if (arm(ft, 'Tap again for full time')) fullTime(); return; }
    var st = t.closest('[data-um-status]'); if (st) { setScoreStatus(F().home_score || 0, F().away_score || 0, st.getAttribute('data-um-status'), 'Match re-opened.'); return; }
    if (t.closest('[data-um-publish]')) { publishNow(); return; }
    var fill = t.closest('[data-um-fill]'); if (fill) { openSheet('goal', fill.getAttribute('data-team'), { bump: false }); return; }
    var ge = t.closest('[data-um-goal-edit]');
    if (ge) { var g = goalById(ge.closest('[data-gid]').getAttribute('data-gid')); if (g && !isTmp(g.id)) openSheet('goal', g.team_id, { mode: 'edit', goalId: g.id, minute: g.minute == null ? null : g.minute }); return; }
    var gd = t.closest('[data-um-goal-del]'); if (gd) { removeGoal(gd.closest('[data-gid]').getAttribute('data-gid')); return; }
    var cd = t.closest('[data-um-card-del]'); if (cd) { removeCard(cd.closest('[data-cid]').getAttribute('data-cid')); return; }
    var lk = t.closest('[data-um-link]');
    if (lk) {
      if (lk.hasAttribute('data-um-arm') && !arm(lk, lk.getAttribute('data-um-arm'))) return;
      linkAct(lk.closest('[data-lid]').getAttribute('data-lid'), lk.getAttribute('data-um-link')); return;
    }
    var urlIn = t.closest('[data-um-url]'); if (urlIn) { urlIn.select(); return; }
    var mo = t.closest('[data-um-mom]');
    if (mo) { if (mo.hasAttribute('data-um-arm') && !arm(mo, mo.getAttribute('data-um-arm'))) return; momAct(mo.getAttribute('data-um-mom')); return; }
    if (t.closest('[data-um-save-fix]')) {
      var hs = $('[data-um-hs]', root).value, as = $('[data-um-as]', root).value, s = $('[data-um-st]', root).value;
      var h = hs === '' ? 0 : Number(hs), a2 = as === '' ? 0 : Number(as);
      if (!isFinite(h) || !isFinite(a2) || h < 0 || a2 < 0 || h > 99 || a2 > 99 || Math.floor(h) !== h || Math.floor(a2) !== a2) { toast('Scores must be whole numbers from 0 to 99.', null, true); return; }
      setScoreStatus(h, a2, s, 'Saved.'); return;
    }
    disarm();
  });

  root.addEventListener('submit', function (e) {
    var f = e.target.closest && e.target.closest('[data-um-newlink]'); if (!f) return;
    e.preventDefault();
    var inp = $('[data-um-newlabel]', f), btn = $('button[type=submit]', f); btn.disabled = true;
    makeLink(inp.value.trim()).then(function () { btn.disabled = false; });
  });

  document.addEventListener('click', function (e) {
    if (!sheet) return;
    var t = e.target;
    if (t.closest('[data-um-sheet-close]')) { closeSheet(); return; }
    var p = t.closest('[data-um-pick]'); if (p) { choose(Number(p.getAttribute('data-um-pick'))); return; }
    if (t.closest('[data-um-none]')) { chooseNone(); }
  });
  document.addEventListener('input', function (e) {
    if (!sheet || !e.target.closest) return;
    if (e.target.closest('[data-um-q]')) { sheet.q = e.target.value; fillList(); }
    else if (e.target.closest('[data-um-min]')) sheet.minute = e.target.value;
  });
  document.addEventListener('keydown', function (e) {
    if (!sheet) return;
    var qi = e.target.closest && e.target.closest('[data-um-q]');
    if (e.key === 'Escape') { e.preventDefault(); if (qi && sheet.q) { sheet.q = ''; qi.value = ''; fillList(); } else closeSheet(); return; }
    if (qi) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (sheet.active >= 0) choose(sheet.active); }
    } else if (e.key === 'Enter' && e.target.closest && e.target.closest('[data-um-min]')) { e.preventDefault(); var q2 = $('[data-um-q]', sheet.el); if (q2) q2.focus(); }
    else if (e.key === 'Tab') {   // keep the keyboard inside the sheet
      var f = $$('button:not([disabled]), input, [tabindex="0"]', sheet.el).filter(function (x) { return x.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || !sheet.el.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  var themeBtn = document.querySelector('[data-um-theme]');
  if (themeBtn) themeBtn.addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark', next = cur === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('lacms-theme', next); } catch (e) { /* ignore */ }
  });

  // ---------------------------------------------------------------------
  // Start: sign-in and permission check, then show the match and keep it fresh
  function start() {
    if (KEYMODE) {
      var back = $('.um-back'); if (back) { var brand = document.createElement('span'); brand.className = 'um-brand'; brand.textContent = 'LACMS Unity Cup'; back.parentNode.replaceChild(brand, back); }
      var tt = $('.um-top-title'); if (tt) tt.textContent = 'Scorer';
    }
    load(true);
    window.setInterval(tick, 250);
    window.setInterval(function () { if (!document.hidden && !sheet) load(false); }, POLL_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { load(false); tick(); } });
  }
  if (!ready()) { showPlain('<h1>The page can’t reach the database</h1><p>Please check your connection and reload.</p>'); return; }
  if (KEYMODE) { start(); return; }                // a private link needs no sign-in
  if (BADHASH) { showKeyError('bad_link'); return; }
  if (!FID) { showNoId(); return; }
  supabaseClient.auth.getSession().then(function (r) {
    if (!r.data || !r.data.session) { showSignIn(); return; }
    return supabaseClient.rpc('unity_can_manage').then(function (p) {
      if (!p.error) return p.data === true;
      return supabaseClient.rpc('is_president').then(function (q) { return !q.error && q.data === true; });
    }).then(function (ok) { if (!ok) { showNoAccess(); return; } start(); });
  }, function () { showSignIn(); });
})();
