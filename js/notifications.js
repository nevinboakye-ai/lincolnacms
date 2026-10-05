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
    { key: 'perks', label: 'Discounts & opportunities', singular: 'new perk', plural: 'new perks', href: 'member-perks.html', page: 'member-perks.html', cardId: 'perks-card' },
    { key: 'events', label: 'Events', singular: 'new event', plural: 'new events', href: 'events.html', page: 'events.html', navHref: 'events.html' },
    { key: 'news', label: 'News', singular: 'new post', plural: 'new posts', href: 'news.html', page: 'news.html', navHref: 'news.html' },
    { key: 'motm', label: 'Member of the Month', singular: 'new honouree', plural: 'new honourees', href: 'motm.html', page: 'motm.html', navHref: 'motm.html' },
    { key: 'gallery', label: 'Gallery', singular: 'new photo', plural: 'new photos', href: 'gallery.html', page: 'gallery.html', navHref: 'gallery.html' },
    { key: 'mmg', label: 'Midlands Medics Gala', singular: 'new update', plural: 'new updates', href: 'mmg-hub.html', page: 'mmg-hub.html' },
    { key: 'resources', label: 'LACMS Resources', singular: 'new resource', plural: 'new resources', href: 'member-resources.html', page: 'member-resources.html', cardId: 'resources-card' }
  ];
  var POLL_MS = 60 * 1000;

  var currentPage = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();

  // Pages that show their own "new" markers (e.g. LACMS Resources) need to
  // know when the user LAST looked at this section - which is exactly what
  // gets overwritten the moment this page marks it as seen. This promise
  // resolves (once) to that previous timestamp (ISO string), or to the
  // account's creation time if they've never visited, or null when there's
  // no session / this page isn't a tracked section.
  var resolvePreviousSeen;
  window.lacmsPreviousSeen = new Promise(function (resolve) { resolvePreviousSeen = resolve; });

  // The "What's new for you" summary shown at sign-in (js/guidance.js)
  // needs what was new BEFORE this page marked its own section as seen, so
  // this resolves (once) to a snapshot of get_my_notifications taken first:
  // an array of { key, label, singular, plural, href, page, count, title, at },
  // or null if there's no session / it couldn't be read.
  var resolveSnapshot;
  window.lacmsNotifSnapshot = new Promise(function (resolve) { resolveSnapshot = resolve; });
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

  function takeSnapshot() {
    return supabaseClient.rpc('get_my_notifications').then(function (result) {
      if (result.error) return null;
      var rows = [];
      (result.data || []).forEach(function (row) {
        for (var i = 0; i < SECTIONS.length; i++) {
          if (SECTIONS[i].key === row.section && row.new_count > 0) {
            rows.push({
              key: row.section, label: SECTIONS[i].label, singular: SECTIONS[i].singular, plural: SECTIONS[i].plural,
              href: SECTIONS[i].href, page: SECTIONS[i].page, count: row.new_count, title: row.latest_title, at: row.latest_at
            });
          }
        }
      });
      return rows;
    }, function () { return null; });
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
      toastForIncreases(next);
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
  var CHAT_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.6-.8L3 21l1.9-5.3A8.4 8.4 0 1 1 21 11.5z"/></svg>';
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

    // Direct messages (migration 070, js/chat.js): a chat icon beside the
    // bell with the unread count. Only shown to people who can message.
    var chatLink = document.createElement('a');
    chatLink.className = 'notif-bell chat-nav-btn';
    chatLink.href = 'member-network.html#messages';
    chatLink.hidden = true;
    chatLink.innerHTML = CHAT_SVG + '<span class="notif-badge" aria-hidden="true" hidden></span>';
    anchor.parentNode.insertBefore(chatLink, button);

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
      '<div class="notif-panel-body" data-notif-body></div>' +
      '<div class="notif-panel-foot"><button type="button" class="notif-digest-link" data-notif-digest>What\'s new for you</button></div>';
    document.body.appendChild(panel);

    var live = document.createElement('div');
    live.className = 'visually-hidden';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('role', 'status');
    document.body.appendChild(live);

    els = {
      chat: chatLink,
      chatBadge: chatLink.querySelector('.notif-badge'),
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
    panel.querySelector('[data-notif-digest]').addEventListener('click', function () {
      setPanelOpen(false);
      document.dispatchEvent(new CustomEvent('lacms:open-digest'));
    });
    els.markAll.addEventListener('click', function () {
      epoch++;
      counts = {};
      liveSeen = {};
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

  // ---- Live pop-ups ---------------------------------------------------
  // Anything new that arrives while someone is on the site slides up from
  // the bottom of the screen, whatever page they're on: direct messages
  // (Realtime, migration 070), and new content in any bell section (counted
  // by get_my_notifications - Realtime nudges it to check straight away when
  // migration 071 is run, otherwise the regular poll picks it up). The
  // Network page's own chat shows message pop-ups itself, so those are
  // skipped there to avoid doubling up.
  var TOAST_ICONS = {
    message: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.6-.8L3 21l1.9-5.3A8.4 8.4 0 1 1 21 11.5z"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'
  };
  var MAX_TOASTS = 3;
  var TOAST_MS = 8000;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var toastHost = null;
  var toastsByKey = {};
  var liveSeen = null;          // section -> count at the previous check (null until the first one)
  var liveChannels = [];
  var convInfo = {};            // conversation id -> { name, muted }
  var ownsMessageToasts = !!document.getElementById('network-messages');

  function toastContainer() {
    if (toastHost && document.body.contains(toastHost)) return toastHost;
    toastHost = document.createElement('div');
    toastHost.className = 'live-toasts';
    toastHost.setAttribute('role', 'region');
    toastHost.setAttribute('aria-label', 'Live notifications');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastHost);
    return toastHost;
  }

  function dismissToast(node) {
    if (!node || node.getAttribute('data-leaving')) return;
    node.setAttribute('data-leaving', '1');
    if (node.getAttribute('data-key')) delete toastsByKey[node.getAttribute('data-key')];
    node.classList.remove('is-in');
    setTimeout(function () { node.remove(); }, reduceMotion ? 0 : 260);
  }

  // opts: { key, kind: 'message'|'bell', title, body, href, count }
  function showLiveToast(opts) {
    var host = toastContainer();
    var existing = opts.key && toastsByKey[opts.key];
    var count = opts.count || 1;
    var node = existing;
    if (existing) {
      count = (parseInt(existing.getAttribute('data-count'), 10) || 1) + 1;
    } else {
      node = document.createElement('div');
      node.className = 'live-toast live-toast--' + opts.kind;
      if (opts.key) { node.setAttribute('data-key', opts.key); toastsByKey[opts.key] = node; }
      host.appendChild(node);
      requestAnimationFrame(function () { requestAnimationFrame(function () { node.classList.add('is-in'); }); });
      while (host.children.length > MAX_TOASTS) dismissToast(host.firstElementChild);
    }
    node.setAttribute('data-count', count);
    node.innerHTML =
      '<a class="live-toast-link" href="' + escapeHtml(opts.href) + '">' +
        '<span class="live-toast-icon"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (TOAST_ICONS[opts.kind] || TOAST_ICONS.bell) + '</svg></span>' +
        '<span class="live-toast-main"><span class="live-toast-title">' + escapeHtml(opts.title) +
          (count > 1 && opts.kind === 'message' ? '<span class="live-toast-count">' + count + ' new</span>' : '') + '</span>' +
        '<span class="live-toast-body">' + escapeHtml(opts.body) + '</span></span>' +
      '</a>' +
      '<button type="button" class="live-toast-close" aria-label="Dismiss notification"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></button>' +
      '<span class="live-toast-bar" aria-hidden="true"></span>';
    node.querySelector('.live-toast-close').addEventListener('click', function () { dismissToast(node); });
    node.querySelector('.live-toast-link').addEventListener('click', function () { dismissToast(node); });
    var bar = node.querySelector('.live-toast-bar');
    if (reduceMotion) {
      clearTimeout(node._timer);
      node._timer = setTimeout(function () { dismissToast(node); }, TOAST_MS);
    } else {
      // The bar's CSS animation is the timer: it pauses on hover/focus and
      // dismisses when it finishes.
      bar.style.animationDuration = TOAST_MS + 'ms';
      bar.addEventListener('animationend', function () { dismissToast(node); });
    }
  }

  // New content in a bell section (called with the previous and new counts).
  function toastForIncreases(next) {
    var prev = liveSeen;
    liveSeen = {};
    SECTIONS.forEach(function (s) { liveSeen[s.key] = next[s.key] ? next[s.key].count : 0; });
    if (prev === null) return; // first check on this page: just the baseline
    SECTIONS.forEach(function (s) {
      var now = liveSeen[s.key];
      var before = prev[s.key] || 0;
      if (now <= before) return;
      var added = now - before;
      var latest = next[s.key] && next[s.key].title;
      showLiveToast({
        key: 'section:' + s.key, kind: 'bell', title: s.label,
        body: added === 1 ? (s.singular.charAt(0).toUpperCase() + s.singular.slice(1)) + (latest ? ': ' + latest : '') : added + ' ' + s.plural + (latest ? ' - latest: ' + latest : ''),
        href: s.href
      });
    });
  }

  function loadConvInfo() {
    return supabaseClient.rpc('chat_get_conversations').then(function (res) {
      if (res.error) return;
      (res.data || []).forEach(function (r) { convInfo[r.conversation_id] = { name: r.other_name, muted: !!r.muted }; });
    }, function () {});
  }

  function onLiveMessage(payload) {
    var r = payload && payload.new;
    if (!r || !userId || r.sender_id === userId) return;
    fetchChat();
    if (ownsMessageToasts) return; // the Network page's chat handles its own
    var show = function () {
      var info = convInfo[r.conversation_id];
      // Not in the inbox (e.g. a conversation the person isn't allowed to see): say nothing.
      if (!info || info.muted) return;
      showLiveToast({
        key: 'conv:' + r.conversation_id, kind: 'message', title: info.name,
        body: String(r.body || '').replace(/\s+/g, ' ').slice(0, 110),
        href: 'member-network.html#messages/' + r.conversation_id
      });
    };
    if (convInfo[r.conversation_id]) show();
    else loadConvInfo().then(show);
  }

  var contentTables = ['announcements', 'discounts', 'member_opportunities', 'site_events', 'news_posts', 'motm_winners', 'gallery_photos', 'mmg_updates', 'mmg_attendee_updates', 'mmg_perks'];
  var liveNudgeTimer = null;
  function nudgeRefresh() {
    clearTimeout(liveNudgeTimer);
    liveNudgeTimer = setTimeout(refresh, 900);
  }

  function startLive() {
    if (!supabaseClient.channel || liveChannels.length) return;
    try {
      liveChannels.push(supabaseClient.channel('live-msgs-' + userId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, onLiveMessage)
        .subscribe());
    } catch (e) { /* polling still covers content */ }
    try {
      var ch = supabaseClient.channel('live-content-' + userId);
      contentTables.forEach(function (t) {
        ch = ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: t }, nudgeRefresh);
      });
      liveChannels.push(ch.subscribe());
    } catch (e) { /* ignore */ }
    // Resources on a channel of its own: its link/file columns are
    // restricted (migration 073), and a hiccup there shouldn't take the
    // other content nudges down with it.
    try {
      liveChannels.push(supabaseClient.channel('live-resources-' + userId)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'resources' }, nudgeRefresh)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'resources' }, nudgeRefresh)
        .subscribe());
    } catch (e) { /* ignore */ }
  }
  function stopLive() {
    liveChannels.forEach(function (c) { try { supabaseClient.removeChannel(c); } catch (e) { /* ignore */ } });
    liveChannels = [];
    liveSeen = null;
    toastsByKey = {};
    if (toastHost) { toastHost.remove(); toastHost = null; }
  }

  // ---- Direct messages ------------------------------------------------
  var chatState = { can: false, unread: 0 };
  function renderChat() {
    if (!els || !els.chat) return;
    els.chat.hidden = !chatState.can;
    els.chatBadge.hidden = chatState.unread === 0;
    els.chatBadge.textContent = formatCount(chatState.unread);
    els.chat.classList.toggle('has-new', chatState.unread > 0);
    els.chat.setAttribute('aria-label', chatState.unread ? 'Messages, ' + chatState.unread + ' unread' : 'Messages');
    els.chat.setAttribute('title', 'Messages');
  }
  function fetchChat() {
    return supabaseClient.rpc('chat_status').then(function (result) {
      if (result.error) return; // migration 070 not run yet - no icon
      var row = Array.isArray(result.data) ? result.data[0] : result.data;
      chatState = { can: !!(row && row.can_message), unread: (row && row.unread) || 0 };
      renderChat();
    }, function () { /* keep what we had */ });
  }
  // The Network page's chat tells us the moment its count changes.
  document.addEventListener('lacms:chat-unread', function (e) {
    chatState.unread = (e.detail && e.detail.count) || 0;
    chatState.can = true;
    renderChat();
  });

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
      if (s.cardId) {
        var hubCard = document.getElementById(s.cardId);
        if (hubCard) targets.push(hubCard);
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
    fetchChat();
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
    chatState = { can: false, unread: 0 };
    stopLive();
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (els) {
      els.button.remove();
      if (els.chat) els.chat.remove();
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
    if (!els) { resolveSnapshot(null); return; }

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
    var ready;
    // Snapshot first, THEN mark this page's section as seen.
    var snap = takeSnapshot();
    snap.then(resolveSnapshot);
    if (here2) {
      ready = snap.then(function () { return supabaseClient.from('notification_seen').select('last_seen_at').eq('section', here2.key).maybeSingle().then(function (r) {
        resolvePreviousSeen((r.data && r.data.last_seen_at) || (session.user && session.user.created_at) || null);
      }, function () { resolvePreviousSeen(null); }).then(function () { return markSeen([here2.key]); }); });
    } else {
      resolvePreviousSeen(null);
      ready = snap;
    }
    ready.then(function () { return refresh(); });
    startPolling();
    startLive();
  }

  supabaseClient.auth.getSession().then(function (result) {
    var session = result.data && result.data.session;
    if (session) start(session);
    else { resolvePreviousSeen(null); resolveSnapshot(null); }
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
