/* LACMS Wrapped (wrapped.html)
   One question at a time, full screen. Everything is optional; a ballot needs at least one answer and an email address
   (one ballot per email, stored only as a scrambled code). Database: wrapped_get / wrapped_submit (migration 133). */
(function () {
  'use strict';

  var DRAFT_KEY = 'lacms-wrapped-draft';
  var VOTED_KEY = 'lacms-wrapped-voted';
  var THEMES = [
    ['#d4a62b', '#5b1013', '#1e7a46'],   // gold on maroon
    ['#2fbf71', '#0b3b25', '#d4a62b'],   // emerald
    ['#e0414a', '#4a0b12', '#d4a62b'],   // crimson
    ['#8b6cf0', '#241055', '#e0414a'],   // violet
    ['#f08a3c', '#4d1e08', '#d4a62b'],   // ember
    ['#27b5c9', '#08303a', '#2fbf71']    // lagoon
  ];
  var FACES = ['', '😬', '😕', '🙁', '😐', '🙂', '😊', '😄', '🤩', '🔥', '🏆'];

  var $screen = document.getElementById('wr-screen');
  var $stage = document.getElementById('wr-stage');
  var $nav = document.getElementById('wr-nav');
  var $progress = document.getElementById('wr-progress');
  var $live = document.getElementById('wr-live');

  var SNAP_KEY = 'lacms-wrapped-snapshot';
  var S = { data: null, steps: [], i: 0, ans: {}, oth: {}, why: {}, name: '', email: '', member: '', sending: false, err: '', stale: false, locked: false };

  // ---------------------------------------------------------------------
  // Small helpers
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* private window: fine */ } }
  function say(t) { if ($live) { $live.textContent = ''; window.setTimeout(function () { $live.textContent = t; }, 40); } }
  function fmtDate(iso) { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }); } catch (e) { return ''; } }
  function reduced() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  // App helpers live in wrapped-app.js; if that file did not load, these quietly do nothing.
  function buzz(p) { if (window.WrappedApp) window.WrappedApp.buzz(p); }
  function app(kind) { return window.WrappedApp ? window.WrappedApp.slot(kind) : ''; }
  function appSync() { if (window.WrappedApp) window.WrappedApp.sync(); }

  var ICON = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12.5 10 17.5 19 7"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 5 8 12 15 19"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>'
  };

  // A database call that gives up after 20 seconds instead of leaving a button stuck for ever.
  function rpcT(fn, args) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = window.setTimeout(function () { finish({ data: null, error: { message: 'timeout' }, timeout: true }); }, 20000);
      function finish(v) { if (done) return; done = true; window.clearTimeout(timer); resolve(v); }
      if (typeof supabaseClient === 'undefined' || !supabaseClient) { finish({ data: null, error: { message: 'unconfigured' }, network: true }); return; }
      // supabase-js reports a dead connection as a normal { error } result rather than throwing, so look for it there too.
      function dead(err) { return navigator.onLine === false || /fetch|network|load failed/i.test(String((err && err.message) || '')); }
      try { supabaseClient.rpc(fn, args || {}).then(function (r) { if (r && r.error && dead(r.error)) r.network = true; finish(r); }, function () { finish({ data: null, error: { message: 'network' }, network: true }); }); }
      catch (e) { finish({ data: null, error: { message: 'server' } }); }
    });
  }

  // ---------------------------------------------------------------------
  // Answers
  function cats() { return S.data ? S.data.categories : []; }
  function optKeys(c) { return (c.options || []).map(function (o) { return o.key; }); }
  function answered(c) {
    var v = S.ans[c.key];
    if (c.kind === 'write_in') return typeof v === 'string' && v.trim().length > 0;
    if (c.kind === 'rating') return typeof v === 'number';
    if (c.kind === 'choice') return v === 'other' ? (S.oth[c.key] || '').trim().length > 0 : typeof v === 'string' && v !== '';
    var a = Array.isArray(v) ? v : [];
    return a.some(function (k) { return k === 'other' ? (S.oth[c.key] || '').trim().length > 0 : true; });
  }
  function answeredCount() { return cats().filter(answered).length; }

  // Required questions and "why" boxes
  var WHY_MIN = 10, WHY_MAX = 500;
  function whyOk(c) { return (S.why[c.key] || '').trim().length >= WHY_MIN; }
  function unanswerable(c) { return (c.kind === 'choice' || c.kind === 'multi') && !(c.options || []).length && !c.allow_other; }
  // What stops someone moving on from this question: '' (nothing), 'answer' (required and empty) or 'why' (answered, but the explanation is missing)
  function need(c) {
    if (answered(c)) return c.ask_reason && !whyOk(c) ? 'why' : '';
    return c.required && !unanswerable(c) ? 'answer' : '';
  }
  function missingCats() { return cats().filter(function (c) { return need(c); }); }
  function canSend() { return answeredCount() > 0 && !missingCats().length; }
  function reasons() {
    var o = {};
    cats().forEach(function (c) { if (c.ask_reason && answered(c) && whyOk(c)) o[c.key] = (S.why[c.key] || '').trim().slice(0, WHY_MAX); });
    return o;
  }
  var LETTER = (function () { try { return new RegExp('\\p{L}', 'u'); } catch (e) { return /[A-Za-z]/; } })();
  function nameOk(v) { v = (v || '').trim(); return v.length >= 2 && LETTER.test(v); }

  function payload() {
    var out = {};
    cats().forEach(function (c) {
      if (!answered(c)) return;
      var v = S.ans[c.key];
      function conv(k) { return k === 'other' ? 'other:' + (S.oth[c.key] || '').trim() : k; }
      if (c.kind === 'write_in') out[c.key] = v.trim();
      else if (c.kind === 'rating') out[c.key] = v;
      else if (c.kind === 'choice') out[c.key] = conv(v);
      else out[c.key] = v.filter(function (k) { return k !== 'other' || (S.oth[c.key] || '').trim(); }).map(conv);
    });
    return out;
  }

  // The last questions we fetched, kept for ten days, so the app still opens (and can be filled in) with no signal.
  function saveSnap(d) {
    if (!d || !d.ok || !d.campaign || !d.campaign.open) return;
    lsSet(SNAP_KEY, JSON.stringify({ t: Date.now(), d: { ok: true, campaign: d.campaign, categories: d.categories } }));
  }
  function loadSnap() {
    var raw = lsGet(SNAP_KEY); if (!raw) return null;
    try {
      var o = JSON.parse(raw);
      if (!o || !o.d || !o.d.campaign || !o.d.campaign.open || !Array.isArray(o.d.categories) || Date.now() - o.t > 10 * 86400000) return null;
      return o.d;
    } catch (e) { return null; }
  }

  function saveDraft() {
    lsSet(DRAFT_KEY, JSON.stringify({ ans: S.ans, oth: S.oth, why: S.why, name: S.name, email: S.email, member: S.member }));
  }
  function loadDraft() {
    var raw = lsGet(DRAFT_KEY); if (!raw) return;
    var d; try { d = JSON.parse(raw); } catch (e) { return; }
    if (!d || typeof d !== 'object') return;
    cats().forEach(function (c) {
      var v = d.ans && d.ans[c.key]; if (v == null) return;
      var keys = optKeys(c);
      function okKey(k) { return k === 'other' ? c.allow_other : keys.indexOf(k) > -1; }
      if (c.kind === 'write_in' && typeof v === 'string') S.ans[c.key] = v.slice(0, c.max_len);
      else if (c.kind === 'rating' && typeof v === 'number' && v >= 1 && v <= 10) S.ans[c.key] = v;
      else if (c.kind === 'choice' && typeof v === 'string' && okKey(v)) S.ans[c.key] = v;
      else if (c.kind === 'multi' && Array.isArray(v)) S.ans[c.key] = v.filter(okKey).slice(0, c.max_picks);
      if (d.oth && typeof d.oth[c.key] === 'string') S.oth[c.key] = d.oth[c.key].slice(0, c.max_len);
      if (c.ask_reason && d.why && typeof d.why[c.key] === 'string') S.why[c.key] = d.why[c.key].slice(0, WHY_MAX);
    });
    if (typeof d.name === 'string') S.name = d.name.slice(0, 80);
    if (typeof d.email === 'string') S.email = d.email.slice(0, 200);
    if (['member', 'not_member', 'unsure'].indexOf(d.member) > -1) S.member = d.member;
  }

  // ---------------------------------------------------------------------
  // Chrome: progress, theme, navigation
  function theme(i) {
    var t = THEMES[i % THEMES.length], b = document.body.style;
    b.setProperty('--wr-1', t[0]); b.setProperty('--wr-2', t[1]); b.setProperty('--wr-3', t[2]);
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t[1]);
  }
  function drawProgress() {
    var n = S.steps.filter(function (s) { return s.t !== 'done' && s.t !== 'msg'; }).length;
    if (!n || S.steps[S.i].t === 'done' || S.steps[S.i].t === 'msg') { $progress.innerHTML = ''; $progress.hidden = true; return; }
    $progress.hidden = false;
    var h = '';
    for (var k = 0; k < n; k++) h += '<li class="' + (k < S.i ? 'is-done' : k === S.i ? 'is-now' : '') + '"></li>';
    $progress.innerHTML = h;
  }
  function navLabel() {
    var s = S.steps[S.i];
    if (s.t !== 'cat') return 'Next';
    return answered(s.c) || need(s.c) ? 'Next' : 'Skip';
  }
  function drawNav() {
    var s = S.steps[S.i];
    if (s.t === 'send') {
      $nav.hidden = false;
      $nav.innerHTML =
        '<button type="button" class="wr-btn wr-btn--ghost wr-btn--icon" data-act="back" aria-label="Back to the questions">' + ICON.back + '</button>' +
        '<button type="button" class="wr-btn wr-btn--main" id="wr-send" data-act="send"' + (canSend() ? '' : ' disabled') + '>' + ICON.send + 'Send my votes</button>';
      return;
    }
    if (s.t !== 'cat') { $nav.hidden = true; $nav.innerHTML = ''; return; }
    $nav.hidden = false;
    var blocked = !!need(s.c), skip = !blocked && !answered(s.c);
    $nav.innerHTML =
      '<button type="button" class="wr-btn wr-btn--ghost wr-btn--icon" data-act="back" aria-label="Previous question">' + ICON.back + '</button>' +
      '<button type="button" class="wr-btn wr-btn--main' + (skip ? ' is-skip' : '') + (blocked ? ' is-blocked' : '') + '" data-act="next"' + (blocked ? ' aria-disabled="true"' : '') + '>' + navLabel() + ICON.next + '</button>';
  }
  function refreshNavLabel() {
    var b = $nav.querySelector('[data-act="next"]'); if (!b) return;
    var s = S.steps[S.i]; var blocked = !!need(s.c), skip = !blocked && !answered(s.c);
    b.classList.toggle('is-skip', skip);
    b.classList.toggle('is-blocked', blocked);
    if (blocked) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
    b.innerHTML = navLabel() + ICON.next;
    var n = document.getElementById('wr-need'); if (n && !blocked) n.hidden = true;
  }

  // The phone's back button (or edge swipe) walks back through the questions instead of closing the app. Each forward step
  // adds a history entry; going back from the screen's own Back button uses the same route so the two never disagree.
  function hist(i, replace) {
    try { if (replace) history.replaceState({ wr: i }, ''); else history.pushState({ wr: i }, ''); } catch (e) { /* ignore */ }
  }
  function go(i, back, fromHistory) {
    if (i < 0 || i >= S.steps.length) return;
    S.i = i; S.err = '';
    if (!back && !fromHistory) hist(i);
    render(!!back);
  }
  function stepBack() {
    if (S.i > 0 && history.state && history.state.wr === S.i) { history.back(); return; }
    go(S.i - 1, true);
  }
  window.addEventListener('popstate', function (e) {
    if (!S.steps.length) return;
    if (S.locked) { history.back(); return; }     // after the thank-you (or on a results/closed screen), back leaves
    var j = e.state && typeof e.state.wr === 'number' ? e.state.wr : 0;
    if (j === S.i) return;
    if (S.sending) { hist(S.i); return; }
    go(Math.min(j, S.steps.length - 1), j < S.i, true);
  });
  function render(back) {
    var s = S.steps[S.i];
    S.locked = s.t === 'done' || s.t === 'msg';
    theme(S.i);
    drawProgress();
    var html = '';
    if (s.t === 'intro') html = introHtml();
    else if (s.t === 'cat') html = catHtml(s.c, S.i);
    else if (s.t === 'send') html = sendHtml();
    else if (s.t === 'done') html = doneHtml();
    else html = s.html;
    $screen.className = 'wr-screen' + (back ? ' is-back' : '');
    $screen.innerHTML = html;
    // stagger the entrance of each block
    Array.prototype.forEach.call($screen.children, function (el, n) { el.style.setProperty('--n', n); });
    drawNav(); appSync();
    $stage.scrollTop = 0;
    var h = $screen.querySelector('[data-focus]');
    if (h) { h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); } }
    if (s.t === 'cat') say('Question ' + S.i + ' of ' + cats().length + '. ' + s.c.title + '. ' + s.c.prompt);
    else if (s.t === 'send') say('Last step. Add your email to send your votes.');
    else if (s.t === 'done') say('Your votes are in. Thank you.');
  }

  // ---------------------------------------------------------------------
  // Screens
  function introHtml() {
    var c = S.data.campaign, n = cats().length;
    var chips = '<span class="wr-chip"><i></i>Voting is open</span>';
    if (c.closes_at) chips += '<span class="wr-chip">Closes ' + esc(fmtDate(c.closes_at)) + '</span>';
    var total = cats().length, req = cats().filter(function (k) { return k.required && !unanswerable(k); }).length;
    chips += '<span class="wr-chip">' + (req ? 'A couple of minutes' : 'About a minute') + '</span>';
    if (S.stale) chips += '<span class="wr-chip">Saved copy</span>';
    var title = esc(c.title || 'LACMS Wrapped');
    var parts = title.replace(/^LACMS\s+/i, '');
    var big = /^LACMS\s+/i.test(c.title || '') ? '<span>LACMS</span>' + parts : title;
    return '<p class="wr-kicker">Have your say</p>' +
      '<h1 class="wr-title-big" data-focus>' + big + (c.subtitle ? '<em>' + esc(c.subtitle) + '</em>' : '') + '</h1>' +
      '<p class="wr-sub">' + esc(c.intro || 'We are making a look back at the semester. Tell us what should be in it: who made it, what you loved and what to do next. Everyone can vote, member or not.') + '</p>' +
      '<div class="wr-chips">' + chips + '</div>' +
      '<p class="wr-sub">' + (req && req >= total ? n + ' quick questions, and each one needs an answer. ' : req ? n + ' quick questions. ' + req + ' of them need an answer; skip the rest if you like. ' : n + ' quick questions. Every one is optional, so skip anything you like. ') +
        'You&rsquo;ll give your name at the end. No account needed.</p>' +
      '<div class="wr-actions"><button type="button" class="wr-btn wr-btn--main wr-btn--block" data-act="next">Let&rsquo;s go' + ICON.next + '</button></div>' + app('pill');
  }

  function catHtml(c, idx) {
    var head = '<p class="wr-kicker">' + idx + ' / ' + cats().length + (c.required && !unanswerable(c) ? '<span class="wr-req">Required</span>' : '') + '</p>' +
      (c.emoji ? '<div class="wr-emoji" aria-hidden="true">' + esc(c.emoji) + '</div>' : '') +
      '<h1 class="wr-q" data-focus id="wr-h">' + esc(c.title) + '</h1>' +
      '<p class="wr-sub">' + esc(c.prompt) + '</p>';
    var body = '';
    if (c.kind === 'write_in') {
      var v = S.ans[c.key] || '';
      body = '<div><input class="wr-input" type="text" data-input="write" maxlength="' + c.max_len + '" autocomplete="off" autocapitalize="sentences" enterkeyhint="next" aria-labelledby="wr-h" placeholder="' + esc(c.placeholder || 'Type your answer…') + '" value="' + esc(v) + '"></div>' +
        '<p class="wr-count" aria-hidden="true"><span id="wr-n">' + v.length + '</span> / ' + c.max_len + '</p>';
    } else if (c.kind === 'rating') {
      var r = S.ans[c.key], b = '';
      for (var n = 1; n <= 10; n++) b += '<li><button type="button" data-rate="' + n + '" class="' + (r === n ? 'is-on' : '') + '" aria-pressed="' + (r === n) + '" aria-label="' + n + ' out of 10">' + n + '</button></li>';
      body = '<ul class="wr-rate">' + b + '</ul><p class="wr-rate-scale"><span>Not for me</span><span>Unforgettable</span></p><p class="wr-rate-face" id="wr-face" aria-hidden="true">' + (r ? FACES[r] : '') + '</p>';
    } else {
      var multi = c.kind === 'multi';
      var cur = multi ? (Array.isArray(S.ans[c.key]) ? S.ans[c.key] : []) : (S.ans[c.key] ? [S.ans[c.key]] : []);
      var opts = (c.options || []).map(function (o) { return optBtn(o.key, o.label, o.date, cur.indexOf(o.key) > -1); }).join('');
      if (c.allow_other) opts += optBtn('other', 'Something else…', '', cur.indexOf('other') > -1);
      var empty = !(c.options || []).length && !c.allow_other;
      body = (multi ? '<p class="wr-picks" id="wr-picks" aria-live="polite">' + picksText(c, cur.length) + '</p>' : '') +
        (empty ? '<p class="wr-sub">Nothing to pick from yet, so this one is skipped.</p>' : '<ul class="wr-opts' + (multi ? ' wr-opts--multi' : '') + '" role="group" aria-labelledby="wr-h">' + opts + '</ul>') +
        (c.allow_other ? '<div class="wr-other" id="wr-other"' + (cur.indexOf('other') > -1 ? '' : ' hidden') + '><input class="wr-input" type="text" data-input="other" maxlength="' + c.max_len + '" autocomplete="off" enterkeyhint="next" aria-label="Your answer" placeholder="Type your answer…" value="' + esc(S.oth[c.key] || '') + '"></div>' : '');
    }
    var why = '';
    if (c.ask_reason) {
      var w = S.why[c.key] || '';
      why = '<div class="wr-why"><label class="wr-why-l" for="wr-why">' + esc(c.reason_label || 'Why did you choose this?') + '</label>' +
        '<textarea class="wr-input wr-input--area" id="wr-why" data-input="why" rows="3" maxlength="' + WHY_MAX + '" autocomplete="off" autocapitalize="sentences" placeholder="A sentence or two is plenty…">' + esc(w) + '</textarea>' +
        '<p class="wr-count" aria-hidden="true"><span id="wr-wn">' + w.length + '</span> / ' + WHY_MAX + ' &middot; at least ' + WHY_MIN + ' characters</p></div>';
    }
    return head + body + why + '<p class="wr-msg" id="wr-need" role="alert" hidden></p>';
  }
  function optBtn(key, label, sub, on) {
    return '<li><button type="button" class="wr-opt' + (on ? ' is-on' : '') + '" data-opt="' + esc(key) + '" aria-pressed="' + on + '">' +
      '<span class="wr-opt-mark">' + ICON.check + '</span><span>' + esc(label) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span></button></li>';
  }
  function picksText(c, n) { return n + ' of ' + c.max_picks + ' picked'; }

  function sendHtml() {
    var n = answeredCount(), total = cats().length;
    var chips = cats().filter(answered).map(function (c) { return '<span>' + (c.emoji ? esc(c.emoji) + ' ' : '') + esc(c.title) + '</span>'; }).join('');
    var seg = [['member', 'I&rsquo;m a LACMS member'], ['not_member', 'Not a member'], ['unsure', 'Not sure']].map(function (m) {
      return '<label><input type="radio" name="wr-member" value="' + m[0] + '"' + (S.member === m[0] ? ' checked' : '') + '>' + m[1] + '</label>';
    }).join('');
    var miss = missingCats().map(function (c) {
      var at = -1; S.steps.forEach(function (st, k) { if (st.c === c) at = k; });
      return '<li><button type="button" class="wr-link" data-goto="' + at + '">' + (c.emoji ? esc(c.emoji) + ' ' : '') + esc(c.title) + (need(c) === 'why' ? ' (add your reason)' : '') + '</button></li>';
    }).join('');
    return '<p class="wr-kicker">Last step</p>' +
      '<h1 class="wr-q" data-focus>Send in your votes</h1>' +
      (miss ? '<div class="wr-missing" role="alert"><p>These still need an answer before you can send:</p><ul>' + miss + '</ul></div>' : '') +
      (n ? '<p class="wr-sub">You answered ' + n + ' of ' + total + '.</p><div class="wr-summary">' + chips + '</div>' :
        '<p class="wr-sub">You have not answered anything yet. Go back and pick at least one question to answer.</p>') +
      '<div class="wr-field"><label for="wr-name">Your full name</label>' +
      '<input class="wr-input" id="wr-name" type="text" autocomplete="name" autocapitalize="words" spellcheck="false" maxlength="80" enterkeyhint="next" placeholder="First and last name" value="' + esc(S.name) + '" data-input="name"></div>' +
      '<div class="wr-field"><label for="wr-email">Your email</label>' +
      '<input class="wr-input" id="wr-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="200" placeholder="you@example.com" value="' + esc(S.email) + '" data-input="email"></div>' +
      '<fieldset class="wr-seg"><legend>Are you a member?</legend>' + seg + '</fieldset>' +
      '<div class="wr-hp" aria-hidden="true"><label>Leave this empty<input type="text" id="wr-hp" tabindex="-1" autocomplete="off"></label></div>' +
      '<p class="wr-msg" id="wr-err" role="alert"' + (S.err ? '' : ' hidden') + '>' + esc(S.err) + '</p>' +
      '<p class="wr-fine">One vote per email, to keep it fair. We ask for your name so the committee can check that votes are genuine. It is stored with your vote, only the committee can see it, and it is never shown publicly. Your email is turned into a scrambled code so it can&rsquo;t be read back. See the <a href="privacy.html" target="_blank" rel="noopener">privacy notice</a>.</p>';
  }

  function doneHtml() {
    var c = S.data.campaign;
    var results = c.show_results && S.data.results ? '<div class="wr-actions"><button type="button" class="wr-btn wr-btn--ghost" data-act="results">See the results</button></div>' : '';
    return '<div class="wr-done-ring">' + ICON.check + '</div>' +
      '<p class="wr-kicker">Votes received</p>' +
      '<h1 class="wr-q" data-focus>You&rsquo;re in. Thank you!</h1>' +
      '<p class="wr-sub">Your votes will help shape the ' + esc(c.title || 'LACMS Wrapped') + '. Know someone who should have a say? Send them the link.</p>' +
      '<div class="wr-actions"><button type="button" class="wr-btn wr-btn--main" data-act="share">' + ICON.share + 'Share with friends</button>' +
      '<a class="wr-btn wr-btn--ghost" href="index.html">Back to the website</a></div>' + results + app('card') +
      '<p class="wr-fine" id="wr-shared" role="status"></p>';
  }

  function msgScreen(kicker, title, text, extra, tail) {
    return { t: 'msg', html: '<p class="wr-kicker">' + esc(kicker) + '</p><h1 class="wr-q" data-focus>' + esc(title) + '</h1><p class="wr-sub">' + esc(text) + '</p>' +
      '<div class="wr-actions">' + (extra || '') + '<a class="wr-btn wr-btn--ghost" href="index.html">Back to the website</a></div>' + (tail || '') };
  }

  function resultsHtml() {
    var R = S.data.results || {}, h = '';
    cats().forEach(function (c) {
      var r = R[c.key]; if (!r) return;
      if (c.kind === 'rating') {
        if (r.avg == null) return;
        h += '<li class="wr-res"><h3>' + esc(c.title) + '</h3><div class="wr-res-avg"><b>' + Number(r.avg).toFixed(1) + '</b><span>out of 10, from ' + r.answered + ' vote' + (r.answered === 1 ? '' : 's') + '</span></div></li>';
        return;
      }
      var items = (r.items || []); if (!items.length) return;
      var top = items[0].votes || 1;
      h += '<li class="wr-res"><h3>' + (c.emoji ? esc(c.emoji) + ' ' : '') + esc(c.title) + '</h3><ol>' +
        items.map(function (it) { return '<li><strong>' + esc(it.label) + '</strong><b>' + it.votes + '</b><i style="--w:' + Math.max(4, Math.round(it.votes / top * 100)) + '%"></i></li>'; }).join('') + '</ol></li>';
    });
    return '<p class="wr-kicker">' + (S.data.campaign.open ? 'So far' : 'Final tally') + '</p><h1 class="wr-q" data-focus>The results</h1>' +
      '<p class="wr-sub">' + S.data.campaign.ballots + ' people voted. Here is what ' + (S.data.campaign.open ? 'is leading' : 'came out on top') + '.</p>' +
      (h ? '<ul class="wr-results">' + h + '</ul>' : '<p class="wr-sub">No votes to show yet.</p>') +
      '<div class="wr-actions"><a class="wr-btn wr-btn--main" href="index.html">Back to the website</a></div>';
  }

  // ---------------------------------------------------------------------
  // Interaction
  function cur() { return S.steps[S.i]; }

  function pick(btn) {
    var c = cur().c, key = btn.getAttribute('data-opt');
    var multi = c.kind === 'multi';
    var list = btn.closest('.wr-opts');
    function setOn(b, on) { b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); }
    if (multi) {
      var a = Array.isArray(S.ans[c.key]) ? S.ans[c.key].slice() : [];
      var at = a.indexOf(key);
      if (at > -1) a.splice(at, 1);
      else {
        if (a.length >= c.max_picks) { say('You can pick up to ' + c.max_picks + '. Tap one to swap it.'); flashPicks(); return; }
        a.push(key);
      }
      S.ans[c.key] = a; setOn(btn, at === -1);
      var p = document.getElementById('wr-picks'); if (p) p.textContent = picksText(c, a.length);
      showOther(a.indexOf('other') > -1);
    } else {
      var on = S.ans[c.key] !== key;
      S.ans[c.key] = on ? key : '';
      Array.prototype.forEach.call(list.querySelectorAll('.wr-opt'), function (b) { setOn(b, on && b === btn); });
      showOther(on && key === 'other');
    }
    buzz(8); saveDraft(); refreshNavLabel();
  }
  function flashPicks() {
    var p = document.getElementById('wr-picks'); if (!p || reduced()) return;
    p.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 260 });
  }
  function showOther(on) {
    var o = document.getElementById('wr-other'); if (!o) return;
    o.hidden = !on;
    if (on) { var i = o.querySelector('input'); if (i) window.setTimeout(function () { try { i.focus({ preventScroll: false }); } catch (e) { i.focus(); } }, 30); }
  }

  // Someone tried to move on from a question that still needs something: say what, and nudge the box to fill in.
  function nudge(kind) {
    var n = document.getElementById('wr-need'); if (!n) return;
    var text = kind === 'why' ? 'Tell us why in a sentence or two (at least ' + WHY_MIN + ' characters) to continue.' : 'This question needs an answer before you can continue.';
    n.textContent = text; n.hidden = false; say(text); buzz([25, 40, 25]);
    if (!reduced()) n.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 260 });
    n.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
    if (kind === 'why') { var w = document.getElementById('wr-why'); if (w) try { w.focus({ preventScroll: true }); } catch (e) { w.focus(); } }
  }

  function next() {
    var s = cur();
    if (s.t === 'cat') { var nd = need(s.c); if (nd) { nudge(nd); return; } }
    if (s.t === 'cat' && s.c.kind === 'multi' && !answered(s.c) && (S.ans[s.c.key] || []).indexOf('other') > -1) { /* an empty "something else" counts as skipped */ }
    if (S.i < S.steps.length - 1) go(S.i + 1);
  }

  function errText(code) {
    switch (code) {
      case 'closed': return 'Voting has just closed, so we could not take this one. Thank you for having a go.';
      case 'bad_email': return 'That email address does not look right. Please check it.';
      case 'disposable': return 'Please use your own email address, not a throw-away one.';
      case 'empty': return 'Please answer at least one question before sending.';
      case 'bad_name': return 'Please enter your name (at least two letters).';
      case 'missing': return 'Some questions still need an answer. Go back and check the ones marked Required.';
      case 'busy': return 'A lot of people are voting right now. Give it a minute and try again.';
      case 'already_voted': return 'That email address has already voted, thank you. Each email can vote once.';
      case 'timeout': return 'That took too long. Check your connection and press Send again.';
      case 'network': return 'We could not reach the server. Check your connection and press Send again.';
      default: return 'Something went wrong on our side. Please try again in a moment.';
    }
  }
  function showErr(t) {
    S.err = t; if (t) buzz([25, 40, 25]);
    var e = document.getElementById('wr-err');
    if (e) { e.textContent = t; e.hidden = !t; if (t) e.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); }
  }
  function busy(on) {
    var b = document.getElementById('wr-send'); if (!b) return;
    b.disabled = on || !canSend(); S.sending = on;
    b.innerHTML = on ? '<span class="wr-spin" style="width:20px;height:20px;border-width:2.5px"></span>Sending…' : ICON.send + 'Send my votes';
    if (on) b.setAttribute('aria-busy', 'true'); else b.removeAttribute('aria-busy');
  }

  function send() {
    if (S.sending) return;
    var nm = document.getElementById('wr-name'); S.name = (nm ? nm.value : S.name).trim();
    var em = document.getElementById('wr-email'); S.email = (em ? em.value : S.email).trim();
    var mem = document.querySelector('input[name="wr-member"]:checked'); S.member = mem ? mem.value : S.member;
    saveDraft();
    if (!answeredCount()) { showErr(errText('empty')); return; }
    if (missingCats().length) { showErr(errText('missing')); return; }
    if (!nameOk(S.name)) { showErr(errText('bad_name')); if (nm) nm.focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(S.email)) { showErr(errText('bad_email')); if (em) em.focus(); return; }
    var hp = document.getElementById('wr-hp');
    if (hp && hp.value) { finishOk(); return; }   // a bot filled the hidden box: pretend it worked, send nothing
    showErr(''); busy(true);
    rpcT('wrapped_submit', { p_email: S.email, p_member: S.member || 'unsure', p_answers: payload(), p_name: S.name, p_reasons: reasons() }).then(function (res) {
      busy(false);
      if (res.error) { showErr(errText(res.timeout ? 'timeout' : res.network ? 'network' : 'server')); return; }
      var d = res.data || {};
      if (d.ok) { finishOk(); return; }
      if (d.error === 'already_voted') { lsSet(VOTED_KEY, '1'); }
      showErr(errText(d.error));
    });
  }
  function finishOk() {
    lsSet(VOTED_KEY, '1');
    try { window.localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
    S.ans = {}; S.oth = {}; S.why = {}; S.name = '';
    go(S.steps.length - 1); buzz([12, 50, 18]);
    if (window.UnityFx) window.UnityFx.confetti({ count: 190 });
  }

  function share() {
    var url = location.origin && location.origin !== 'null' ? location.origin + location.pathname : location.href;
    var data = { title: (S.data.campaign.title || 'LACMS Wrapped'), text: 'Have your say in the LACMS Wrapped. It takes about a minute.', url: url };
    var note = document.getElementById('wr-shared');
    function copied() { if (note) note.textContent = 'Link copied. Paste it anywhere.'; say('Link copied.'); }
    function fallback() {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(copied, function () { if (note) note.textContent = url; });
      else if (note) note.textContent = url;
    }
    if (navigator.share) navigator.share(data).catch(function (e) { if (e && e.name !== 'AbortError') fallback(); });
    else fallback();
  }

  // ---------------------------------------------------------------------
  // Events (delegated; the screens are re-rendered but these stay)
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act],[data-opt],[data-rate],[data-goto]'); if (!t) return;
    if (t.hasAttribute('data-goto')) { var gi = Number(t.getAttribute('data-goto')); if (gi >= 0) go(gi); return; }
    if (t.hasAttribute('data-opt')) { pick(t); return; }
    if (t.hasAttribute('data-rate')) {
      var c = cur().c, n = Number(t.getAttribute('data-rate')), same = S.ans[c.key] === n;
      S.ans[c.key] = same ? undefined : n;
      Array.prototype.forEach.call($screen.querySelectorAll('[data-rate]'), function (b) { var on = !same && Number(b.getAttribute('data-rate')) === n; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
      var f = document.getElementById('wr-face'); if (f) f.textContent = same ? '' : FACES[n];
      buzz(8); saveDraft(); refreshNavLabel(); return;
    }
    var act = t.getAttribute('data-act');
    if (act === 'next') next();
    else if (act === 'back') stepBack();
    else if (act === 'send') send();
    else if (act === 'share') share();
    else if (act === 'retry') load();
    else if (act === 'results') { S.steps = [{ t: 'msg', html: resultsHtml() }]; S.i = 0; render(false); }
  });

  document.addEventListener('input', function (e) {
    var t = e.target; var k = t.getAttribute && t.getAttribute('data-input'); if (!k) return;
    if (k === 'email') { S.email = t.value; saveDraft(); return; }
    if (k === 'name') { S.name = t.value; saveDraft(); return; }
    var c = cur().c; if (!c) return;
    if (k === 'why') { S.why[c.key] = t.value; var wn = document.getElementById('wr-wn'); if (wn) wn.textContent = t.value.length; }
    else if (k === 'write') { S.ans[c.key] = t.value; var n = document.getElementById('wr-n'); if (n) n.textContent = t.value.length; }
    else if (k === 'other') S.oth[c.key] = t.value;
    saveDraft(); refreshNavLabel();
  });
  document.addEventListener('change', function (e) {
    if (e.target && e.target.name === 'wr-member') { S.member = e.target.value; saveDraft(); }
  });
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (e.key === 'Enter' && t && t.matches && t.matches('input[data-input]')) {
      e.preventDefault();
      var ik = t.getAttribute('data-input');
      if (ik === 'email') send();
      else if (ik === 'name') { var ee = document.getElementById('wr-email'); if (ee) ee.focus(); }
      else if (ik === 'write' && cur().c && cur().c.ask_reason && document.getElementById('wr-why')) document.getElementById('wr-why').focus();
      else next();
    }
  });

  // Swipe left for the next question, right to go back. Never from the very edges of the screen (those belong to the
  // phone's own back gesture), never on a text field, and only for a clear, quick, mostly sideways flick.
  (function () {
    var x0 = 0, y0 = 0, t0 = 0, ok = false;
    $stage.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      ok = e.touches.length === 1 && t.clientX > 28 && t.clientX < window.innerWidth - 28 && !(e.target.closest && e.target.closest('input, textarea, select'));
      x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
    }, { passive: true });
    $stage.addEventListener('touchend', function (e) {
      if (!ok) return; ok = false;
      var t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
      if (Date.now() - t0 > 600 || Math.abs(dx) < 90 || Math.abs(dy) > Math.abs(dx) * 0.5) return;
      var s = cur(); if (!s || S.sending) return;
      if (dx < 0 && (s.t === 'intro' || s.t === 'cat')) next();
      else if (dx > 0 && (s.t === 'cat' || s.t === 'send')) stepBack();
    }, { passive: true });
  })();

  // ---------------------------------------------------------------------
  // Start
  function buildSteps() {
    var d = S.data, c = d.campaign, hasCats = cats().length > 0;
    if (!c.open) {
      if (c.show_results && d.results) { S.steps = [{ t: 'msg', html: resultsHtml() }]; return; }
      S.steps = [msgScreen('Voting is closed', 'Thanks for voting!', 'Voting for the ' + (c.title || 'LACMS Wrapped') + ' has closed. The Wrapped is on its way, so keep an eye on our Instagram.')];
      return;
    }
    if (lsGet(VOTED_KEY) === '1') {
      var extra = c.show_results && d.results ? '<button type="button" class="wr-btn wr-btn--main" data-act="results">See the results</button>' : '';
      S.steps = [msgScreen('Already voted', 'You’ve already voted. Thank you!', 'Each email address can vote once. Want to help more? Send the link to a friend.', '<button type="button" class="wr-btn wr-btn--main" data-act="share">' + ICON.share + 'Share with friends</button>' + extra, app('card'))];
      return;
    }
    if (!hasCats) { S.steps = [msgScreen('Coming soon', 'Not quite ready', 'The questions are still being set up. Please check back soon.')]; return; }
    S.steps = [{ t: 'intro' }];
    cats().forEach(function (k) { S.steps.push({ t: 'cat', c: k }); });
    S.steps.push({ t: 'send' }, { t: 'done' });
  }

  function load() {
    S.stale = false;
    $nav.hidden = true; $progress.hidden = true;
    $screen.className = 'wr-screen';
    $screen.innerHTML = '<div class="wr-loading"><span class="wr-spin" aria-hidden="true"></span><p>Getting your Wrapped ready&hellip;</p></div>';
    rpcT('wrapped_get').then(function (res) {
      var d = res.data;
      if ((res.error || !d) && (res.network || res.timeout)) {
        var snap = loadSnap();
        if (snap) {
          S.data = snap; S.stale = true;
          document.title = (snap.campaign.title || 'LACMS Wrapped') + ': have your say - LACMS';
          loadDraft(); buildSteps(); S.i = 0; hist(0, true); render(false); return;
        }
      }
      if (res.error || !d) {
        S.steps = [msgScreen(res.network || res.timeout ? 'Offline?' : 'Not available', res.network || res.timeout ? 'We could not load it' : 'Wrapped is not open yet', res.network || res.timeout ? 'Check your connection and try again.' : 'Come back soon: voting for the LACMS Wrapped will open shortly.', '<button type="button" class="wr-btn wr-btn--main" data-act="retry">Try again</button>')];
        S.i = 0; render(false); return;
      }
      if (!d.ok) {
        S.steps = [msgScreen('Coming soon', 'Wrapped is not open yet', 'Voting for the LACMS Wrapped will open soon. Check back shortly.')];
        S.i = 0; render(false); return;
      }
      S.data = d; document.title = (d.campaign.title || 'LACMS Wrapped') + ': have your say - LACMS';
      saveSnap(d);
      loadDraft(); buildSteps(); S.i = 0; hist(0, true); render(false);
    });
  }
  // Opened with no signal and showing the saved copy? Pick up the live questions as soon as we are back online.
  window.addEventListener('online', function () { if (S.stale && S.i === 0 && !S.sending) load(); });
  load();
})();
