// "New since you last looked" notifications for signed-in users.
//
// A bell in the site header shows a count of content published since the
// user last visited each section (announcements, perks, events, news,
// MoTM, gallery, MMG). Opening it lists what's new with a link to each;
// visiting a section's own page marks it as seen. The same counts also
// appear as small pills on the matching nav links.
//
// All counting happens in Postgres (get_my_notifications, migration 059)
// and runs as the signed-in user, so row-level security decides what
// each person is ever told about. This file only renders and reports
// "seen" back (mark_notifications_seen) - the server clock decides what
// "seen" means, never the browser's.
//
// Degrades silently: no session -> nothing is added to the page; if the
// migration hasn't been run or the request fails, no bell is shown (a
// cached count from earlier in the session is kept if there is one).
(function () {
  'use strict';

  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;

  // Display order = order in the panel. `page` is the page that, when
  // visited, marks the section as seen; `navHref` is the nav link that
  // gets a count pill (if any).
  var SECTIONS = [
    { key: 'announcements', label: 'Announcements', singular: 'announcement', plural: 'announcements', href: 'member-hub.html', page: 'member-hub.html' },
    { key: 'perks', label: 'Discounts & opportunities', singular: 'new perk', plural: 'new perks', href: 'member-perks.html', page: 'member-perks.html' },
    { key: 'events', label: 'Events', singular: 'new event', plural: 'new events', href: 'events.html', page: 'events.html', navHref: 'events.html' },
    { key: 'news', label: 'News', singular: 'new post', plural: 'new posts', href: 'news.html', page: 'news.html', navHref: 'news.html' },
    { key: 'motm', label: 'Member of the Month', singular: 'new honouree', plural: 'new honourees', href: 'motm.html', page: 'motm.html', navHref: 'motm.html' },
    { key: 'gallery', label: 'Gallery', singular: 'new photo', plural: 'new photos', href: 'gallery.html', page: 'gallery.html', navHref: 'gallery.html' },
    { key: 'mmg', label: 'Midlands Medics Gala', singular: 'new update', plural: 'new updates', href: 'mmg-hub.html', page: 'mmg-hub.html' },
    { key: 'resources', label: 'LACMS Resources', singular: 'new resource', plural: 'new resources', href: 'member-resources.html', page: 'member-resources.html' }
  ];
  var POLL_MS = 60 * 1000;

  var currentPage = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
  var userId = null;
  var counts = null; // { sectionKey: { count, title, at } } - null until first successful load
  var announcedTotal = null;
  var els = null;
  var pollTimer = null;
  var panelOpen = false;
  var epoch = 0; // bumped on every local change so an older in-flight response can't overwrite it

  function cacheKey() { return 'lacms-notifs:' + userId; }

  function readCache() {
    try {
      var raw = window.sessionStorage.getItem(cacheKey());
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function writeCache() {
    try { window.sessionStorage.setItem(cacheKey(), JSON.stringify(counts)); } catch (e) { /* storage unavailable - fine */ }
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function timeAgo(dateStr) {
    var date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    var mins = Math.floor((Date.now() - date.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.floor(hrs / 24);
    if (days < 7) return days + 'd ago';
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  function formatCount(n) { return n > 99 ? '99+' : String(n); }

  function totalCount() {
    if (!counts) return 0;
    return SECTIONS.reduce(function (sum, s) { return sum + (counts[s.key] ? counts[s.key].count : 0); }, 0);
  }

  // ---- Server calls --------------------------------------------------
  function markSeen(sectionKeys) {
    return supabaseClient.rpc('mark_notifications_seen', { p_sections: sectionKeys }).then(function (result) {
      if (result.error) console.error('Could not mark notifications as seen:', result.error.message);
      return !result.error;
    });
  }

  function fetchCounts() {
    var startedAtEpoch = epoch;
    return supabaseClient.rpc('get_my_notifications').then(function (result) {
      if (startedAtEpoch !== epoch) return false;
      if (result.error) {
        console.error('Notifications failed to load (has migration 059 been run?):', result.error.message);
        return false;
      }
      var next = {};
      (result.data || []).forEach(function (row) {
        next[row.section] = { count: row.new_count, title: row.latest_title, at: row.latest_at };
      });
      // The section being viewed right now is by definition seen.
      var here = sectionForPage();
      if (here) delete next[here.key];
      counts = next;
      writeCache();
      return true;
    });
  }

  function sectionForPage() {
    for (var i = 0; i < SECTIONS.length; i++) {
      if (SECTIONS[i].page === currentPage) return SECTIONS[i];
    }
    return null;
  }

  // ---- DOM ------------------------------------------------------------
  var BELL_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';

  function build() {
    if (els) return;
    var anchor = document.querySelector('.nav-primary .theme-toggle');
    if (!anchor) return;

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'notif-bell';
    button.setAttribute('aria-haspopup', 'true');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'notif-panel');
    button.hidden = true;
    button.innerHTML = BELL_SVG + '<span class="notif-badge" aria-hidden="true" hidden></span>';
    anchor.parentNode.insertBefore(button, anchor);

    // Lives on <body>, not inside the header: the header has a
    // backdrop-filter, which would turn position:fixed into
    // "fixed relative to the header" and clip/misplace the panel.
    var panel = document.createElement('div');
    panel.className = 'notif-panel';
    panel.id = 'notif-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Notifications');
    panel.hidden = true;
    panel.innerHTML =
      '<div class="notif-panel-head"><h2 class="notif-panel-title">Notifications</h2>' +
      '<button type="button" class="notif-markall" data-notif-markall>Mark all as read</button></div>' +
      '<div class="notif-panel-body" data-notif-body></div>';
    document.body.appendChild(panel);

    var live = document.createElement('div');
    live.className = 'visually-hidden';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('role', 'status');
    document.body.appendChild(live);

    els = {
      button: button,
      badge: button.querySelector('.notif-badge'),
      panel: panel,
      body: panel.querySelector('[data-notif-body]'),
      markAll: panel.querySelector('[data-notif-markall]'),
      live: live
    };

    button.addEventListener('click', function (e) {
      e.stopPropagation();
      setPanelOpen(!panelOpen);
    });
    els.markAll.addEventListener('click', function () {
      epoch++;
      counts = {};
      writeCache();
      render();
      markSeen(null);
    });
    document.addEventListener('click', function (e) {
      if (!panelOpen) return;
      if (els.panel.contains(e.target) || els.button.contains(e.target)) return;
      setPanelOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panelOpen) {
        setPanelOpen(false);
        els.button.focus();
      }
    });
    window.addEventListener('resize', function () { if (panelOpen) positionPanel(); });
  }

  function positionPanel() {
    var rect = els.button.getBoundingClientRect();
    els.panel.style.top = Math.round(rect.bottom + 10) + 'px';
    els.panel.style.right = Math.max(12, Math.round(window.innerWidth - rect.right)) + 'px';
  }

  function setPanelOpen(open) {
    panelOpen = open;
    els.button.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      positionPanel();
      els.panel.hidden = false;
      // Counts may have changed since the last poll - refresh quietly
      // while it's open so the list is never stale when someone looks.
      refresh();
    } else {
      els.panel.hidden = true;
    }
  }

  function render() {
    if (!els) return;
    var total = totalCount();
    var loaded = counts !== null;

    els.button.hidden = !loaded;
    els.badge.hidden = total === 0;
    els.badge.textContent = formatCount(total);
    els.button.setAttribute('aria-label', total
      ? 'Notifications, ' + total + ' new'
      : 'Notifications, none new');
    els.button.classList.toggle('has-new', total > 0);

    // Screen-reader announcement only when something genuinely new
    // arrives while the page is open - not on every page load.
    if (announcedTotal !== null && total > announcedTotal) {
      els.live.textContent = (total - announcedTotal) + ' new ' + (total - announcedTotal === 1 ? 'notification' : 'notifications');
    }
    announcedTotal = total;

    var rows = SECTIONS.filter(function (s) { return counts && counts[s.key] && counts[s.key].count > 0; });
    els.markAll.hidden = rows.length === 0;
    if (!rows.length) {
      els.body.innerHTML = '<p class="notif-empty"><strong>You\'re all caught up.</strong><span>New content will show up here.</span></p>';
    } else {
      els.body.innerHTML = rows.map(function (s) {
        var c = counts[s.key];
        return '<a class="notif-item" href="' + s.href + '">' +
          '<span class="notif-item-main">' +
          '<span class="notif-item-label">' + escapeHtml(s.label) + '</span>' +
          '<span class="notif-item-sub">' + escapeHtml(c.count + ' ' + (c.count === 1 ? s.singular : s.plural)) +
          (c.title ? ' &middot; Latest: ' + escapeHtml(c.title) : '') + '</span>' +
          '</span>' +
          '<span class="notif-item-meta"><span class="notif-item-time">' + escapeHtml(timeAgo(c.at)) + '</span>' +
          '<span class="notif-item-count">' + formatCount(c.count) + '</span></span>' +
          '</a>';
      }).join('');
    }

    renderPills();
  }

  // Small count pills on the matching nav links (desktop nav, mobile
  // drawer) and the member hub's perks card.
  function renderPills() {
    document.querySelectorAll('.notif-pill').forEach(function (el) { el.remove(); });
    if (!counts) return;

    SECTIONS.forEach(function (s) {
      var c = counts[s.key];
      if (!c || !c.count) return;
      var targets = [];
      if (s.navHref) {
        document.querySelectorAll('.nav-links a[href="' + s.navHref + '"]').forEach(function (a) { targets.push(a); });
      }
      if (s.key === 'perks') {
        var perksCard = document.getElementById('perks-card');
        if (perksCard) targets.push(perksCard);
      }
      targets.forEach(function (a) {
        var pill = document.createElement('span');
        pill.className = 'notif-pill';
        pill.setAttribute('aria-label', c.count + ' ' + (c.count === 1 ? s.singular : s.plural));
        pill.textContent = formatCount(c.count);
        a.appendChild(pill);
      });
    });
  }

  // ---- Lifecycle ------------------------------------------------------
  var refreshing = false;
  function refresh() {
    if (refreshing || !userId) return Promise.resolve();
    refreshing = true;
    return fetchCounts().then(function (ok) {
      refreshing = false;
      if (ok) render();
    }, function () { refreshing = false; });
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
  }

  function teardown() {
    userId = null;
    counts = null;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (els) {
      els.button.remove();
      els.panel.remove();
      els.live.remove();
      els = null;
    }
    document.querySelectorAll('.notif-pill').forEach(function (el) { el.remove(); });
    panelOpen = false;
  }

  function start(session) {
    userId = session.user.id;
    build();
    if (!els) return;

    // Paint straight away from this session's last known counts so the
    // badge doesn't pop in late on every page navigation.
    var cached = readCache();
    if (cached) {
      var here = sectionForPage();
      if (here) delete cached[here.key];
      counts = cached;
      render();
    }

    var here2 = sectionForPage();
    var ready = here2 ? markSeen([here2.key]) : Promise.resolve(true);
    ready.then(function () { return refresh(); });
    startPolling();
  }

  supabaseClient.auth.getSession().then(function (result) {
    var session = result.data && result.data.session;
    if (session) start(session);
  });

  supabaseClient.auth.onAuthStateChange(function (event, session) {
    if (event === 'SIGNED_OUT') teardown();
    else if (event === 'SIGNED_IN' && session && !userId) start(session);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') refresh();
  });
  // Back/forward navigation can restore a page from memory without
  // re-running this script - re-check so the badge isn't stale.
  window.addEventListener('pageshow', function (e) { if (e.persisted) refresh(); });
  // Another tab marked things as read / got new counts.
  window.addEventListener('storage', function (e) {
    if (!userId || e.key !== cacheKey() || !e.newValue) return;
    try { counts = JSON.parse(e.newValue); render(); } catch (err) { /* ignore malformed */ }
  });
})();
