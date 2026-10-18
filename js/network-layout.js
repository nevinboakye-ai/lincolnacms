// The Network page, rebuilt to be short to scroll and part of the journey.
// js/members.js still draws the people (and the search, profile pop-ups,
// admin tools); this file only organises what it draws:
//
//   * course chips along the top (tap one to show just that course);
//   * each course folds like an accordion - your own course starts open,
//     the others closed, and searching opens everything that matches;
//   * a "Say hello" panel suggests a few people to message - same course and
//     year first - and shows the +XP the first hello earns.
//
// Nothing here changes who can see or message whom; it works from the cards
// the page already shows (so the sixth-form protections are untouched).
(function () {
  'use strict';

  var content = document.getElementById('network-content');
  var sections = document.getElementById('network-members-sections');
  if (!content || !sections) return;
  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;

  var chipsEl = document.getElementById('net-chips');
  var helloEl = document.getElementById('net-hello');
  var proWrap = document.getElementById('network-professionals-wrap');
  var searchInput = document.getElementById('network-search-input');
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var me = { name: '', course: '', year: '' };
  var meLoaded = false;
  var active = 'all';        // 'all' | 'pros' | a course name
  var signature = '';
  var seed = 0;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function low(s) { return String(s || '').toLowerCase(); }
  function firstWord(s) { return low(s).split(/[^a-z]+/).filter(Boolean)[0] || ''; }
  function yearOf(s) { var m = /(\d+)/.exec(String(s || '')); return m ? 'year ' + parseInt(m[1], 10) : ''; }
  function hash(str) { var h = 0; for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return h; }

  // ---- Who am I (for "your course" and the hello draft) ---------------------
  supabaseClient.auth.getSession().then(function (r) {
    var session = r.data && r.data.session;
    if (!session) return;
    return supabaseClient.from('members').select('full_name, course, year_of_study').eq('id', session.user.id).maybeSingle().then(function (res) {
      if (res && res.data) me = { name: res.data.full_name || '', course: res.data.course || '', year: res.data.year_of_study || '' };
    });
  }).then(function () { meLoaded = true; enhance(true); }, function () { meLoaded = true; enhance(true); });

  // ---- Course sections: accordion + "your course" ------------------------------
  function sectionName(sec) { var h = sec.querySelector('.network-course-head h2'); return h ? h.textContent.trim() : ''; }
  function isMine(name) { return me.course && firstWord(name) && firstWord(name) === firstWord(me.course); }

  function enhanceSections(reset) {
    var secs = sections.querySelectorAll('.network-course-section');
    var anyMine = Array.prototype.some.call(secs, function (s) { return isMine(sectionName(s)); });
    Array.prototype.forEach.call(secs, function (sec, i) {
      var head = sec.querySelector('.network-course-head');
      if (!head) return;
      var name = sectionName(sec);
      if (!sec.getAttribute('data-net-acc')) {
        sec.setAttribute('data-net-acc', '1');
        sec.classList.add('net-acc');
        head.setAttribute('role', 'button');
        head.setAttribute('tabindex', '0');
        head.insertAdjacentHTML('beforeend', '<span class="net-acc-chev" aria-hidden="true"></span>');
        reset = true;
      }
      var mine = isMine(name);
      sec.classList.toggle('is-mine', mine);
      var tag = head.querySelector('.net-mine-tag');
      if (mine && !tag) head.querySelector('h2').insertAdjacentHTML('afterend', '<span class="net-mine-tag">Your course</span>');
      if (!mine && tag) tag.remove();
      if (reset && !sec.getAttribute('data-net-touched')) {
        var open = mine || (!anyMine && i === 0);
        sec.classList.toggle('is-collapsed', !open);
      }
      head.setAttribute('aria-expanded', sec.classList.contains('is-collapsed') ? 'false' : 'true');
      capSection(sec);
    });
  }

  // Show the first few people in a course, with a button for the rest.
  var CAP = 8;
  function capSection(sec) {
    var cards = sec.querySelectorAll('.network-card');
    var btn = sec.querySelector('.net-more-btn');
    if (cards.length <= CAP) { if (btn) btn.remove(); return; }
    var all = sec.getAttribute('data-net-all') === '1';
    Array.prototype.forEach.call(cards, function (c, i) { c.classList.toggle('net-capped', !all && i >= CAP); });
    Array.prototype.forEach.call(sec.querySelectorAll('.network-year-group'), function (g) {
      var cs = g.querySelectorAll('.network-card');
      g.classList.toggle('net-capped', !all && cs.length > 0 && Array.prototype.every.call(cs, function (c) { return c.classList.contains('net-capped'); }));
    });
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-outline net-more-btn';
      sec.appendChild(btn);
    }
    btn.textContent = all ? 'Show fewer' : 'Show all ' + cards.length + ' people';
    btn.setAttribute('aria-expanded', String(all));
  }
  sections.addEventListener('click', function (e) {
    var b = e.target.closest('.net-more-btn');
    if (!b) return;
    var sec = b.closest('.network-course-section');
    sec.setAttribute('data-net-all', sec.getAttribute('data-net-all') === '1' ? '0' : '1');
    capSection(sec);
  });

  function toggleSection(head) {
    var sec = head.closest('.network-course-section');
    if (!sec) return;
    sec.setAttribute('data-net-touched', '1');
    sec.classList.toggle('is-collapsed');
    head.setAttribute('aria-expanded', sec.classList.contains('is-collapsed') ? 'false' : 'true');
  }
  sections.addEventListener('click', function (e) {
    var head = e.target.closest('.network-course-head');
    if (head && sections.contains(head)) toggleSection(head);
  });
  sections.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('network-course-head')) { e.preventDefault(); toggleSection(e.target); }
  });

  // ---- Chips ---------------------------------------------------------------------------
  function enhanceChips() {
    var secs = sections.querySelectorAll('.network-course-section');
    var proShown = proWrap && proWrap.style.display !== 'none' && proWrap.querySelector('.network-card');
    var items = Array.prototype.map.call(secs, function (s) {
      var c = s.querySelector('.network-course-count');
      var cs = s.style;
      return { key: sectionName(s), label: sectionName(s), count: c ? parseInt(c.textContent, 10) || 0 : 0,
        accent: cs.getPropertyValue('--network-accent').trim(), light: cs.getPropertyValue('--network-accent-light').trim(), bg: cs.getPropertyValue('--network-accent-bg').trim() };
    });
    var sig = items.map(function (i) { return i.key + ':' + i.count + ':' + i.accent; }).join('|') + '|' + (proShown ? 'p' : '') + '|' + me.course;
    if (sig === signature) return;
    signature = sig;
    if (!items.length && !proShown) { chipsEl.hidden = true; return; }
    var total = items.reduce(function (n, i) { return n + i.count; }, 0);
    var html = '<button type="button" class="net-chip" data-net-chip="all" aria-pressed="' + (active === 'all') + '">All<b>' + total + '</b></button>';
    items.sort(function (a, b) { return (isMine(b.key) ? 1 : 0) - (isMine(a.key) ? 1 : 0); });
    items.forEach(function (i) {
      html += '<button type="button" class="net-chip' + (isMine(i.key) ? ' is-mine' : '') + '" data-net-chip="' + esc(i.key) + '" aria-pressed="' + (active === i.key) + '"' + (i.accent ? ' style="--chip-accent:' + esc(i.accent) + ';--chip-light:' + esc(i.light || i.accent) + ';--chip-bg:' + esc(i.bg) + ';"' : '') + '>' + esc(i.label) + '<b>' + i.count + '</b></button>';
    });
    if (proShown) html += '<button type="button" class="net-chip net-chip--pro" data-net-chip="pros" aria-pressed="' + (active === 'pros') + '">Professionals<b>' + proWrap.querySelectorAll('.network-card').length + '</b></button>';
    chipsEl.innerHTML = html;
    chipsEl.hidden = false;
  }

  function applyFilter() {
    Array.prototype.forEach.call(sections.querySelectorAll('.network-course-section'), function (sec) {
      var show = active === 'all' || active === sectionName(sec);
      sec.classList.toggle('net-hidden', !show);
      if (active !== 'all' && show) { sec.classList.remove('is-collapsed'); sec.setAttribute('data-net-touched', '1'); var h = sec.querySelector('.network-course-head'); if (h) h.setAttribute('aria-expanded', 'true'); }
    });
    if (proWrap) proWrap.classList.toggle('net-hidden', !(active === 'all' || active === 'pros'));
    Array.prototype.forEach.call(chipsEl.querySelectorAll('.net-chip'), function (c) { c.setAttribute('aria-pressed', String(c.getAttribute('data-net-chip') === active)); });
  }
  chipsEl.addEventListener('click', function (e) {
    var c = e.target.closest('[data-net-chip]');
    if (!c) return;
    active = c.getAttribute('data-net-chip');
    applyFilter();
    var first = active === 'all' ? null : (active === 'pros' ? proWrap : sections.querySelector('.network-course-section:not(.net-hidden)'));
    if (first && first.scrollIntoView) first.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  });

  // ---- Search opens everything that matches ---------------------------------------------
  if (searchInput) searchInput.addEventListener('input', function () { content.classList.toggle('is-searching', searchInput.value.trim().length > 0); });

  // ---- Say hello ------------------------------------------------------------------------------
  function people() {
    var out = [];
    Array.prototype.forEach.call(content.querySelectorAll('.network-card .network-card-msg[data-chat-user]'), function (msg) {
      var card = msg.closest('.network-card');
      if (!card || card.closest('#net-hello')) return;
      var uid = msg.getAttribute('data-chat-user');
      var nameEl = card.querySelector('.network-card-name'), metaEl = card.querySelector('.network-card-meta');
      var name = nameEl ? nameEl.textContent.trim() : '', meta = metaEl ? metaEl.textContent.trim() : '';
      if (!uid || !name) return;
      var s = 0, m = low(meta);
      var sameCourse = me.course && m.indexOf(firstWord(me.course)) !== -1;
      var sameYear = me.year && yearOf(me.year) && m.indexOf(yearOf(me.year)) !== -1;
      if (sameCourse && sameYear) s = 3; else if (sameCourse) s = 2;
      if (card.classList.contains('network-card--committee')) s += 0.8;
      if (card.classList.contains('network-card--professional')) s += 0.6;
      out.push({ uid: uid, name: name, meta: meta, score: s + (hash(uid + '|' + seed + '|' + new Date().toDateString()) % 1000) / 1000 });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }
  function initials(name) { var p = name.trim().split(/\s+/); return ((p[0] || '').charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase(); }
  function messaged() {
    var J = window.lacmsJourney, st = J && J.state && J.state();
    return !!(st && st.areas && st.areas.network && st.areas.network.messaged);
  }
  function enhanceHello() {
    if (!helloEl) return;
    var list = people();
    if (!list.length) { helloEl.hidden = true; return; }
    var many = window.matchMedia && window.matchMedia('(max-width: 640px)').matches ? 3 : 4;
    var picks = list.slice(0, many);
    var xp = (window.lacmsJourney && window.lacmsJourney.state() && !window.lacmsJourney.state().hidden && !messaged()) ? '<span class="jy-xp">+10 XP</span>' : '';
    helloEl.innerHTML = '<div class="net-hello-head"><h2>Say hello</h2>' + xp + '</div>' +
      '<p class="jy-muted">A friendly message is the best way to start' + (me.course ? ' - starting with people on your course' : '') + '.</p>' +
      '<ul class="net-hello-list">' + picks.map(function (p) {
        return '<li><span class="net-av" aria-hidden="true">' + esc(initials(p.name)) + '</span><span class="net-hello-text"><strong>' + esc(p.name) + '</strong><small>' + esc(p.meta) + '</small></span>' +
          '<button type="button" class="btn btn-outline sh-btn-sm" data-net-hello="' + esc(p.uid) + '" data-name="' + esc(p.name) + '" data-meta="' + esc(p.meta) + '">Say hello</button></li>';
      }).join('') + '</ul>' +
      (list.length > many ? '<button type="button" class="link-button net-hello-more" data-net-shuffle>Show others</button>' : '');
    helloEl.hidden = false;
  }
  helloEl.addEventListener('click', function (e) {
    var sh = e.target.closest('[data-net-shuffle]');
    if (sh) { seed++; enhanceHello(); return; }
    var b = e.target.closest('[data-net-hello]');
    if (!b) return;
    var first = (b.getAttribute('data-name') || '').replace(/^(dr|prof|mr|mrs|ms)\.?\s+/i, '').split(/\s+/)[0];
    var draft = 'Hi ' + first + '! ' + (me.name ? "I'm " + me.name.split(/\s+/)[0] + ' - ' : '') + "lovely to connect through LACMS. How's your term going?";
    if (window.lacmsChat && typeof window.lacmsChat.open === 'function') {
      window.lacmsChat.open(b.getAttribute('data-hello') || b.getAttribute('data-net-hello'), { name: b.getAttribute('data-name'), detail: b.getAttribute('data-meta'), draft: draft });
    } else {
      window.location.href = 'member-network.html?message=' + encodeURIComponent(b.getAttribute('data-net-hello')) + '&draft=' + encodeURIComponent(draft) + '#messages';
    }
  });

  // ---- Keep it all in step with what members.js draws -------------------------------------
  var timer = null;
  function enhance(reset) {
    enhanceSections(reset === true);
    enhanceChips();
    applyFilter();
    enhanceHello();
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(function () { enhance(false); }, 120); }
  new MutationObserver(schedule).observe(sections, { childList: true });
  if (proWrap) new MutationObserver(schedule).observe(proWrap, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  if (window.lacmsJourney) window.lacmsJourney.onState(function () { if (meLoaded) enhanceHello(); });
  schedule();
})();
