// Direct messages for the LACMS Network page (migration 070).
//
// Anyone who can use the Network can message anyone else who can: click
// the message icon on a card, or "Send a message" in someone's profile, or
// open the Messages tab and start a new one. Everything is one-to-one and
// private - only the two people in a conversation can read it.
//
// How it hangs together
//   * All writes go through database functions (chat_send_message, etc.) that
//     check who's calling; the tables are read-only to the browser, so row-
//     level security decides who can see what, including for live delivery.
//   * New messages arrive live over Supabase Realtime. If Realtime isn't
//     connected the page quietly polls every few seconds instead, so
//     messages still arrive - just a little later.
//   * Sending is optimistic: your message appears immediately as "Sending..."
//     and settles to "Sent" / "Seen" (or "Not sent - Retry"). Each send has a
//     client id, so a retry can never create a duplicate.
//   * Typing indicators use Realtime broadcast (nothing stored).
//   * Unread counts feed the Messages tab, the page title, the header
//     message icon (js/notifications.js) and the sign-in summary
//     (js/guidance.js) via the "lacms:chat-unread" event.
//
// Two ways to show it, one engine:
//   * On the Network page it's the Messages tab (#network-messages).
//   * On every other page it's a floating dock: a round Messages button in
//     the corner (with the unread count) that opens a small chat panel over
//     the page - a full-screen sheet on phones - so people can read and reply
//     without leaving what they're doing. It stays open as they move between
//     pages, and the header icon, live pop-ups and "Message them" buttons
//     elsewhere on the site open it.
// Only runs for signed-in people the server says can message, and does
// nothing if migration 070 hasn't been run yet.
(function () {
  'use strict';

  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;
  var pageRoot = document.getElementById('network-messages');
  var DOCK = !pageRoot;
  var thisPage = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
  if (DOCK && ['member-login.html', 'login.html', 'request-account.html', 'join.html', 'mmg-login.html'].indexOf(thisPage) !== -1) return;
  var root = pageRoot;       // in dock mode: the panel's inner element, created by buildDock()

  var PAGE_SIZE = 40;
  var MAX_LEN = 2000;
  var GROUP_GAP_MS = 5 * 60 * 1000;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  var baseTitle = document.title;

  var SELF = null;
  var convs = [];            // normalised conversations, newest first
  var threads = {};          // conversation id -> { items, loaded, loading, hasMore, oldestRaw }
  var activeId = null;
  var directory = null;      // cached chat_directory() rows
  var pickerOpen = false;
  var typingFrom = {};       // conversation id -> timeout handle (they're typing)
  var typingOut = {};        // other user id -> { channel, ready }
  var lastTypingSent = 0;
  var openActionsId = null;  // message whose action row is open (touch)
  var pendingOpen = null;    // a lacms:chat-open that arrived before we were ready
  var pendingDraft = null;   // text to pre-fill (not send) in the next conversation opened
  var ready = false;
  var dockOpen = false;
  var dock = null;           // { launcher, badge, panel }
  var convsLoaded = false;
  var statusUnread = 0;      // unread count from chat_status, until the conversations are loaded
  var els = {};
  var rt = { channel: null, typing: null, status: '' };
  var pollTicks = 0;
  var markReadTimer = null;
  var refreshing = null;

  var ROLE_LABELS = {
    executive_committee: 'Executive Committee', supporting_committee: 'Supporting Committee',
    senior_sankofa_mentor: 'Senior Sankofa Mentor', junior_sankofa_mentor: 'Junior Sankofa Mentor',
    senior_doctor: 'Senior doctor', alumni_doctor: 'Alumni doctor', pharmacist: 'Pharmacist', other: 'Professional', member: 'Member'
  };

  var ICON = {
    compose: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    back: '<polyline points="15 18 9 12 15 6"/>',
    more: '<circle cx="12" cy="5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="19" r="1.3" fill="currentColor"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.6-.8L3 21l1.9-5.3A8.4 8.4 0 1 1 21 11.5z"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    flag: '<path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    bellOff: '<path d="M13.7 21a2 2 0 0 1-3.4 0"/><path d="M18.6 13A17.9 17.9 0 0 1 18 8"/><path d="M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14"/><line x1="2" y1="2" x2="22" y2="22"/>',
    block: '<circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/>',
    clear: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>',
    close: '<line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/>',
    lock: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    down: '<polyline points="6 9 12 15 18 9"/>',
    linkedin: ''
  };
  function svg(name, cls) {
    return '<svg class="icon ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + '</svg>';
  }

  // ---- Helpers -----------------------------------------------------------
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    var b = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/);
    if (!parts[0]) return '?';
    return (parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
  }
  function hue(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h % 4;
  }
  function firstName(name) { return String(name || '').trim().split(/\s+/)[0] || 'them'; }
  function roleLabel(role) {
    if (!role) return '';
    return ROLE_LABELS[role] || role;
  }
  function safeHttpUrl(url) {
    return /^https?:\/\//i.test(url || '') ? url : '';
  }
  function avatarHtml(c, size) {
    var photo = safeHttpUrl(c.photo);
    return '<span class="chat-av chat-av--' + hue(c.name || '') + (size ? ' chat-av--' + size : '') + '" aria-hidden="true">' +
      (photo ? '<img src="' + esc(photo) + '" alt="">' : esc(initials(c.name))) + '</span>';
  }
  // Escape first, then turn http(s) links into anchors - nothing the sender
  // typed ever reaches the page as markup.
  function linkify(text) {
    var out = '', last = 0, re = /https?:\/\/[^\s<]+/gi, m;
    while ((m = re.exec(text))) {
      var url = m[0], trail = '';
      var t = /[.,;:!?\]'"]+$/.exec(url);
      if (t) { trail = t[0]; url = url.slice(0, url.length - trail.length); }
      // A closing bracket belongs to the link only if it has an opening one.
      while (url.charAt(url.length - 1) === ')' && url.split(')').length > url.split('(').length) {
        trail = ')' + trail; url = url.slice(0, -1);
        var t2 = /[.,;:!?\]'"]+$/.exec(url);
        if (t2) { trail = t2[0] + trail; url = url.slice(0, url.length - t2[0].length); }
      }
      out += esc(text.slice(last, m.index)) +
        '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(url) + '</a>' + esc(trail);
      last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function clock(ms) { var d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function dayKey(ms) { var d = new Date(ms); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function dayLabel(ms) {
    var now = new Date();
    var d = new Date(ms);
    var diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return d.toLocaleDateString('en-GB', { weekday: 'long' });
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }
  function listTime(ms) {
    if (!ms) return '';
    var now = new Date(), d = new Date(ms);
    var diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    if (diff === 0) return clock(ms);
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' });
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function draftKey(id) { return 'lacms-chat-draft:' + SELF + ':' + id; }
  function readDraft(id) { try { return window.localStorage.getItem(draftKey(id)) || ''; } catch (e) { return ''; } }
  function writeDraft(id, text) {
    try { if (text) window.localStorage.setItem(draftKey(id), text); else window.localStorage.removeItem(draftKey(id)); } catch (e) { /* ignore */ }
  }
  function friendly(error) {
    var m = (error && error.message) || '';
    if (!m || /failed to fetch|networkerror|load failed/i.test(m)) return 'Couldn\'t reach the server - check your connection.';
    return m;
  }

  // ---- Model -------------------------------------------------------------
  function normalizeConv(r) {
    return {
      id: r.conversation_id, otherId: r.other_id, name: r.other_name || 'LACMS member', detail: r.other_detail || '',
      kind: r.other_kind, role: r.other_role || '', bio: r.other_bio || '', linkedin: r.other_linkedin || '', photo: r.other_photo || '',
      lastAt: r.last_message_at ? Date.parse(r.last_message_at) : 0, lastBody: r.last_body || '', lastSender: r.last_sender_id,
      lastDeleted: !!r.last_deleted, unread: r.unread_count || 0,
      otherReadAt: r.other_last_read_at ? Date.parse(r.other_last_read_at) : 0,
      muted: !!r.muted, iBlocked: !!r.i_blocked, draft: false, sendChain: Promise.resolve()
    };
  }
  function convById(id) { for (var i = 0; i < convs.length; i++) if (convs[i].id === id) return convs[i]; return null; }
  function convByUser(uid) { for (var i = 0; i < convs.length; i++) if (convs[i].otherId === uid && !convs[i].draft) return convs[i]; return null; }
  function sortConvs() { convs.sort(function (a, b) { return (b.lastAt || Infinity) - (a.lastAt || Infinity); }); }
  function rowToMsg(r) {
    return {
      id: r.id, clientId: r.client_id || null, mine: r.sender_id === SELF, body: r.deleted_at ? '' : (r.body || ''),
      at: Date.parse(r.created_at), raw: r.created_at, deleted: !!r.deleted_at, status: 'sent'
    };
  }
  function threadFor(id) {
    if (!threads[id]) threads[id] = { items: [], loaded: false, loading: false, hasMore: true, oldestRaw: null };
    return threads[id];
  }
  function mergeMessage(th, msg) {
    for (var i = 0; i < th.items.length; i++) {
      var it = th.items[i];
      if (it.id === msg.id || (msg.clientId && it.clientId === msg.clientId && it.mine)) {
        th.items[i] = msg;
        return false;
      }
    }
    th.items.push(msg);
    return true;
  }
  function sortItems(th) {
    th.items.sort(function (a, b) { return a.at - b.at || (a.id < b.id ? -1 : 1); });
  }
  function totalUnread() {
    if (DOCK && !convsLoaded) return statusUnread;
    return convs.reduce(function (n, c) { return n + (c.muted ? 0 : c.unread); }, 0);
  }
  function viewing() {
    if (DOCK) return dockOpen && !document.hidden;
    return !root.hidden && !document.hidden;
  }

  // ---- Shell -------------------------------------------------------------
  function buildShell() {
    root.innerHTML =
      '<div class="chat-shell" data-view="list">' +
        '<aside class="chat-side" aria-label="Conversations">' +
          '<div class="chat-side-head"><h2 class="chat-side-title">Messages</h2>' +
            '<button type="button" class="chat-compose-btn" data-chat-compose>' + svg('compose') + '<span>New message</span></button></div>' +
          '<div class="chat-search">' + svg('search') + '<input type="search" placeholder="Search conversations" aria-label="Search conversations" data-chat-search autocomplete="off"></div>' +
          '<div class="chat-side-body" data-chat-list></div>' +
        '</aside>' +
        '<section class="chat-main" aria-label="Conversation">' +
          '<div class="chat-placeholder" data-chat-placeholder></div>' +
          '<div class="chat-thread" data-chat-thread hidden>' +
            '<header class="chat-thread-head">' +
              '<button type="button" class="chat-icon-btn chat-back" data-chat-back aria-label="Back to conversations">' + svg('back') + '</button>' +
              '<button type="button" class="chat-who" data-chat-who aria-expanded="false" aria-controls="chat-profile"></button>' +
              '<div class="chat-menu-wrap">' +
                '<button type="button" class="chat-icon-btn" data-chat-menu-btn aria-haspopup="menu" aria-expanded="false" aria-label="Conversation options">' + svg('more') + '</button>' +
                '<div class="chat-menu" role="menu" data-chat-menu hidden></div>' +
              '</div>' +
            '</header>' +
            '<div class="chat-profile" id="chat-profile" data-chat-profile hidden></div>' +
            '<div class="chat-log-wrap">' +
              '<div class="chat-log" data-chat-log tabindex="0" role="log" aria-label="Messages"></div>' +
              '<button type="button" class="chat-jump" data-chat-jump hidden>' + svg('down') + '<span>New messages</span></button>' +
            '</div>' +
            '<div class="chat-typing" data-chat-typing hidden><span class="chat-dots" aria-hidden="true"><i></i><i></i><i></i></span><span data-chat-typing-text></span></div>' +
            '<form class="chat-composer" data-chat-composer novalidate>' +
              '<label class="visually-hidden" for="chat-input">Write a message</label>' +
              '<textarea id="chat-input" class="chat-input" rows="1" maxlength="4000" placeholder="Write a message" data-chat-input></textarea>' +
              '<span class="chat-count" data-chat-count hidden></span>' +
              '<button type="submit" class="chat-send" data-chat-send aria-label="Send message" disabled>' + svg('send') + '</button>' +
            '</form>' +
            '<div class="chat-blocked" data-chat-blocked hidden></div>' +
          '</div>' +
        '</section>' +
      '</div>' +
      '';

    var q = function (sel) { return root.querySelector(sel); };
    els = {
      shell: q('.chat-shell'), list: q('[data-chat-list]'), search: q('[data-chat-search]'),
      placeholder: q('[data-chat-placeholder]'), thread: q('[data-chat-thread]'),
      who: q('[data-chat-who]'), menuBtn: q('[data-chat-menu-btn]'), menu: q('[data-chat-menu]'),
      profile: q('[data-chat-profile]'), log: q('[data-chat-log]'), jump: q('[data-chat-jump]'),
      typing: q('[data-chat-typing]'), typingText: q('[data-chat-typing-text]'),
      composer: q('[data-chat-composer]'), input: q('[data-chat-input]'), count: q('[data-chat-count]'),
      send: q('[data-chat-send]'), blocked: q('[data-chat-blocked]')
    };
    // Toasts and the screen-reader announcer live on <body>, so they still
    // work while the People tab is showing.
    els.toasts = document.createElement('div');
    els.toasts.className = 'chat-toasts';
    els.live = document.createElement('div');
    els.live.className = 'visually-hidden';
    els.live.setAttribute('role', 'status');
    els.live.setAttribute('aria-live', 'polite');
    document.body.appendChild(els.toasts);
    document.body.appendChild(els.live);
    renderPlaceholder();
  }

  function renderPlaceholder() {
    els.placeholder.innerHTML =
      '<div class="chat-placeholder-inner">' +
        '<span class="chat-placeholder-icon">' + svg('chat') + '</span>' +
        '<h3>Your messages</h3>' +
        '<p>Pick a conversation, or start a new one with anyone in the Network.</p>' +
        '<button type="button" class="btn btn-primary" data-chat-compose>New message</button>' +
        '<p class="chat-privacy">' + svg('lock') + '<span>Messages are private between you and the other person. LACMS only sees a conversation if someone reports it.</span></p>' +
      '</div>';
  }

  // ---- Conversation list / picker ---------------------------------------
  function previewFor(c) {
    if (typingFrom[c.id]) return '<span class="chat-item-typing">typing…</span>';
    if (c.draft) return '<span class="chat-item-draft">Say hello</span>';
    if (c.lastDeleted) return '<em>Message deleted</em>';
    var mine = c.lastSender === SELF;
    return (mine ? '<span class="chat-item-you">You: </span>' : '') + esc(c.lastBody.replace(/\s+/g, ' ').slice(0, 90));
  }

  function renderList() {
    if (!els.list) return;
    if (pickerOpen) { renderPicker(); return; }
    if (DOCK && !convsLoaded) { els.list.innerHTML = '<p class="chat-empty-note">Loading your messages…</p>'; return; }
    var q = (els.search.value || '').trim().toLowerCase();
    var visible = convs.filter(function (c) {
      if (c.draft && c.id !== activeId) return false;
      if (!q) return true;
      return c.name.toLowerCase().indexOf(q) !== -1 || (c.lastBody || '').toLowerCase().indexOf(q) !== -1;
    });
    if (!visible.length) {
      els.list.innerHTML = q
        ? '<p class="chat-empty-note">No conversations match "' + esc(q) + '".</p>'
        : '<div class="chat-empty-list"><span class="chat-placeholder-icon">' + svg('chat') + '</span><strong>No conversations yet</strong>' +
          '<span>Message someone from the People tab, or start one here.</span>' +
          '<button type="button" class="btn btn-primary" data-chat-compose>New message</button></div>';
      return;
    }
    els.list.innerHTML = '<ul class="chat-items" role="list">' + visible.map(function (c) {
      var unread = c.unread > 0;
      return '<li><button type="button" class="chat-item' + (c.id === activeId ? ' is-active' : '') + (unread ? ' has-unread' : '') + '" data-conv="' + esc(c.id) + '"' + (c.id === activeId ? ' aria-current="true"' : '') + '>' +
        avatarHtml(c) +
        '<span class="chat-item-main">' +
          '<span class="chat-item-top"><span class="chat-item-name">' + esc(c.name) + '</span><span class="chat-item-time">' + esc(listTime(c.lastAt)) + '</span></span>' +
          '<span class="chat-item-bottom"><span class="chat-item-preview">' + previewFor(c) + '</span>' +
            (c.muted ? '<span class="chat-item-muted" title="Muted">' + svg('bellOff') + '</span>' : '') +
            (unread ? '<span class="chat-item-badge' + (c.muted ? ' is-muted' : '') + '" aria-label="' + c.unread + ' unread">' + (c.unread > 99 ? '99+' : c.unread) + '</span>' : '') +
          '</span>' +
        '</span></button></li>';
    }).join('') + '</ul>';
  }

  function renderPicker() {
    var existing = els.list.querySelector('[data-picker-input]');
    var query = existing ? existing.value : '';
    var focusIn = existing && document.activeElement === existing;
    var pos = existing ? existing.selectionStart : 0;
    var body;
    if (!directory) {
      body = '<p class="chat-empty-note">Loading people…</p>';
    } else if (directory.error) {
      body = '<p class="chat-empty-note">' + esc(directory.error) + '</p>';
    } else {
      var q = query.trim().toLowerCase();
      var rows = directory.rows.filter(function (p) {
        return !q || (p.full_name || '').toLowerCase().indexOf(q) !== -1 || (p.detail || '').toLowerCase().indexOf(q) !== -1;
      }).slice(0, 80);
      body = rows.length ? '<ul class="chat-items" role="list">' + rows.map(function (p) {
        var c = { name: p.full_name, photo: p.photo_url };
        var role = roleLabel(p.role);
        return '<li><button type="button" class="chat-item" data-person="' + esc(p.user_id) + '">' + avatarHtml(c) +
          '<span class="chat-item-main"><span class="chat-item-top"><span class="chat-item-name">' + esc(p.full_name) + '</span></span>' +
          '<span class="chat-item-bottom"><span class="chat-item-preview">' + esc([p.detail, role && p.kind === 'professional' ? role : ''].filter(Boolean).join(' · ') || role || 'LACMS member') + '</span></span></span></button></li>';
      }).join('') + '</ul>' : '<p class="chat-empty-note">No one matches that.</p>';
    }
    els.list.innerHTML =
      '<div class="chat-picker-head"><button type="button" class="chat-icon-btn" data-chat-picker-close aria-label="Back to conversations">' + svg('back') + '</button><strong>New message</strong></div>' +
      '<div class="chat-picker-search">' + svg('search') + '<input type="search" placeholder="Search people by name or course" aria-label="Search people" data-picker-input autocomplete="off" value="' + esc(query) + '"></div>' +
      body;
    var input = els.list.querySelector('[data-picker-input]');
    if (input && (focusIn || !existing)) { input.focus(); try { input.setSelectionRange(pos || query.length, pos || query.length); } catch (e) { /* ignore */ } }
  }

  function openPicker() {
    pickerOpen = true;
    els.shell.setAttribute('data-view', 'list');
    renderPicker();
    if (!directory) {
      supabaseClient.rpc('chat_directory').then(function (res) {
        if (res.error) { toast(friendly(res.error), 'error'); pickerOpen = false; }
        else directory = { rows: res.data || [] };
        renderList();
      }, function () { toast('Couldn\'t load people - check your connection.', 'error'); pickerOpen = false; renderList(); });
    }
  }
  function closePicker() { pickerOpen = false; renderList(); }

  // ---- Thread ------------------------------------------------------------
  function renderThreadHeader(c) {
    var sub = [roleLabel(c.role) && c.kind === 'member' && c.role !== 'member' ? roleLabel(c.role) : '', c.detail].filter(Boolean).join(' · ');
    els.who.innerHTML = avatarHtml(c, 'sm') +
      '<span class="chat-who-text"><span class="chat-who-name">' + esc(c.name) + '</span>' +
      (sub ? '<span class="chat-who-sub">' + esc(sub) + '</span>' : '') + '</span>';
    var lines = [];
    var pr = roleLabel(c.role);
    if (pr) lines.push('<span class="chat-profile-badge">' + esc(pr) + '</span>');
    if (c.detail) lines.push('<p class="chat-profile-detail">' + esc(c.detail) + '</p>');
    lines.push(c.bio ? '<p class="chat-profile-bio">' + esc(c.bio) + '</p>' : '<p class="chat-profile-bio is-empty">No bio added yet.</p>');
    var li = safeHttpUrl(c.linkedin);
    if (li) lines.push('<a class="chat-profile-link" href="' + esc(li) + '" target="_blank" rel="noopener noreferrer">View LinkedIn</a>');
    els.profile.innerHTML = lines.join('');
    els.menu.innerHTML =
      '<button type="button" role="menuitem" data-menu="mute">' + svg(c.muted ? 'bell' : 'bellOff') + (c.muted ? 'Unmute notifications' : 'Mute notifications') + '</button>' +
      '<button type="button" role="menuitem" data-menu="report">' + svg('flag') + 'Report this person…</button>' +
      '<button type="button" role="menuitem" data-menu="block">' + svg('block') + (c.iBlocked ? 'Unblock ' : 'Block ') + esc(firstName(c.name)) + '</button>' +
      (c.draft ? '' : '<button type="button" role="menuitem" class="is-danger" data-menu="clear">' + svg('clear') + 'Clear conversation</button>');
  }

  function renderComposerState(c) {
    var blocked = c.iBlocked;
    els.composer.hidden = blocked;
    els.blocked.hidden = !blocked;
    if (blocked) {
      els.blocked.innerHTML = '<span>You\'ve blocked ' + esc(firstName(c.name)) + '. They can\'t message you and you can\'t message them.</span><button type="button" class="btn btn-outline" data-unblock>Unblock</button>';
    }
  }

  function seenFor(c, items) {
    // The newest message of mine that's actually delivered.
    for (var i = items.length - 1; i >= 0; i--) {
      var m = items[i];
      if (m.mine && m.status === 'sent' && !m.deleted) return { id: m.id, seen: c.otherReadAt >= m.at };
    }
    return null;
  }

  function renderLog(opts) {
    opts = opts || {};
    var c = convById(activeId);
    if (!c) return;
    var th = threadFor(c.id);
    var log = els.log;
    var prevHeight = log.scrollHeight;
    var wasAtBottom = atBottom();
    var items = th.items;
    var last = seenFor(c, items);
    var html = '';
    if (th.loaded && !th.hasMore) {
      html += '<div class="chat-start"><span class="chat-start-icon">' + svg('lock') + '</span><strong>Your conversation with ' + esc(c.name) + '</strong>' +
        '<span>Private between the two of you. Be kind - you can report anything that isn\'t okay.</span></div>';
    } else if (th.loading && items.length) {
      html += '<div class="chat-older">Loading earlier messages…</div>';
    }
    if (th.loaded && !items.length) {
      html += '<div class="chat-hello"><span class="chat-placeholder-icon">' + svg('chat') + '</span><strong>Say hello to ' + esc(firstName(c.name)) + '</strong>' +
        '<span>Introduce yourself - mention your course or why you\'re getting in touch.</span></div>';
    }
    var prev = null;
    var lastDay = '';
    items.forEach(function (m, i) {
      var day = dayKey(m.at);
      if (day !== lastDay) {
        html += '<div class="chat-day"><span>' + esc(dayLabel(m.at)) + '</span></div>';
        lastDay = day;
        prev = null;
      }
      var next = items[i + 1];
      var start = !prev || prev.mine !== m.mine || m.at - prev.at > GROUP_GAP_MS;
      var end = !next || next.mine !== m.mine || dayKey(next.at) !== day || next.at - m.at > GROUP_GAP_MS;
      html += messageHtml(m, start, end, last, c);
      prev = m;
    });
    log.innerHTML = html;

    if (opts.keepTopOffset) {
      log.scrollTop = log.scrollHeight - prevHeight + opts.keepTopOffset;
    } else if (opts.toBottom || wasAtBottom) {
      log.scrollTop = log.scrollHeight;
    }
    if (opts.toBottom || wasAtBottom) els.jump.hidden = true;
  }

  function messageHtml(m, start, end, last, c) {
    var who = m.mine ? 'You' : c.name;
    var classes = 'chat-msg' + (m.mine ? ' is-mine' : '') + (start ? ' is-start' : '') + (end ? ' is-end' : '') +
      (m.deleted ? ' is-deleted' : '') + (m.status === 'failed' ? ' is-failed' : '') + (m.status === 'sending' ? ' is-sending' : '') +
      (openActionsId === m.id ? ' is-open' : '');
    var body = m.deleted
      ? '<span class="chat-text"><em>This message was deleted</em></span>'
      : '<span class="chat-text">' + linkify(m.body) + '</span>';
    var actions = '';
    if (!m.deleted && m.status === 'sent') {
      actions = '<div class="chat-actions">' +
        '<button type="button" class="chat-act" data-act="copy" aria-label="Copy message" title="Copy">' + svg('copy') + '</button>' +
        (m.mine
          ? '<button type="button" class="chat-act" data-act="delete" aria-label="Delete message" title="Delete">' + svg('trash') + '</button>'
          : '<button type="button" class="chat-act" data-act="report" aria-label="Report message" title="Report">' + svg('flag') + '</button>') +
        '</div>';
    }
    var meta = '';
    if (m.status === 'failed') {
      meta = '<div class="chat-meta is-error"><span>Not sent' + (m.error ? ' - ' + esc(m.error) : '') + '</span><button type="button" data-act="retry">Retry</button><button type="button" data-act="discard">Remove</button></div>';
    } else if (end) {
      var status = '';
      if (m.mine && m.status === 'sending') status = 'Sending…';
      else if (m.mine && last && last.id === m.id) status = last.seen ? 'Seen' : 'Sent';
      meta = '<div class="chat-meta"><span>' + esc(clock(m.at)) + '</span>' + (status ? '<span class="chat-status' + (status === 'Seen' ? ' is-seen' : '') + '">' + status + '</span>' : '') + '</div>';
    }
    return '<div class="' + classes + '" data-mid="' + esc(m.id) + '">' +
      '<div class="chat-bubble" tabindex="0"><span class="visually-hidden">' + esc(who) + ': </span>' + body + '</div>' + actions + meta + '</div>';
  }

  function atBottom() {
    var log = els.log;
    return !log || log.scrollHeight - log.scrollTop - log.clientHeight < 90;
  }

  function renderTyping() {
    var c = convById(activeId);
    var on = !!(c && typingFrom[c.id]);
    els.typing.hidden = !on;
    if (on) els.typingText.textContent = firstName(c.name) + ' is typing…';
  }

  // ---- Opening conversations --------------------------------------------
  function openConversation(id) {
    var c = convById(id);
    if (!c) return false;
    var changed = activeId !== id;
    activeId = id;
    pickerOpen = false;
    openActionsId = null;
    els.shell.setAttribute('data-view', 'thread');
    els.placeholder.hidden = true;
    els.thread.hidden = false;
    els.profile.hidden = true;
    els.who.setAttribute('aria-expanded', 'false');
    closeMenu();
    renderThreadHeader(c);
    renderComposerState(c);
    if (changed) {
      els.input.value = readDraft(id);
      autosize();
      updateSendState();
      els.jump.hidden = true;
    }
    if (pendingDraft && !c.iBlocked) {
      // Arrived from a link such as "Message them for the PIN": pre-filled, never auto-sent.
      els.input.value = pendingDraft;
      writeDraft(id, pendingDraft);
      pendingDraft = null;
      autosize();
      updateSendState();
    }
    renderList();
    renderTyping();
    prepTypingChannel(c);

    var th = threadFor(id);
    if (!th.loaded) {
      th.loading = true;
      els.log.innerHTML = '<div class="chat-older">Loading messages…</div>';
      loadMessages(id, false).then(function () {
        if (activeId === id) { renderLog({ toBottom: true }); maybeMarkRead(); }
      });
    } else {
      renderLog({ toBottom: true });
      maybeMarkRead();
      syncActive();
    }
    if (!coarsePointer && !c.iBlocked) setTimeout(function () { els.input.focus(); }, 0);
    persistDock();
    return true;
  }

  function closeConversation() {
    activeId = null;
    els.shell.setAttribute('data-view', 'list');
    els.thread.hidden = true;
    els.placeholder.hidden = false;
    renderList();
    persistDock();
  }

  function loadMessages(id, older) {
    var th = threadFor(id);
    var q = supabaseClient.from('chat_messages')
      .select('id, conversation_id, sender_id, body, client_id, created_at, deleted_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);
    if (older && th.oldestRaw) q = q.lt('created_at', th.oldestRaw);
    return q.then(function (res) {
      th.loading = false;
      if (res.error) { toast(friendly(res.error), 'error'); return; }
      var rows = res.data || [];
      rows.forEach(function (r) { mergeMessage(th, rowToMsg(r)); });
      sortItems(th);
      if (rows.length) th.oldestRaw = rows[rows.length - 1].created_at;
      if (rows.length < PAGE_SIZE) th.hasMore = false;
      th.loaded = true;
    }, function (err) { th.loading = false; toast(friendly(err), 'error'); });
  }

  function loadOlder() {
    var c = convById(activeId);
    if (!c) return;
    var th = threadFor(c.id);
    if (th.loading || !th.hasMore || !th.loaded) return;
    th.loading = true;
    var id = c.id;
    var before = els.log.scrollHeight;
    loadMessages(id, true).then(function () {
      if (activeId !== id) return;
      var log = els.log;
      var top = log.scrollTop;
      renderLog({});
      log.scrollTop = log.scrollHeight - before + top;
    });
  }

  // Fetch the newest page and merge (picks up anything missed while offline
  // and any deletions).
  function syncActive() {
    var c = convById(activeId);
    if (!c) return Promise.resolve();
    var id = c.id;
    var th = threadFor(id);
    if (!th.loaded) return Promise.resolve();
    return supabaseClient.from('chat_messages')
      .select('id, conversation_id, sender_id, body, client_id, created_at, deleted_at')
      .eq('conversation_id', id).order('created_at', { ascending: false }).limit(PAGE_SIZE)
      .then(function (res) {
        if (res.error || !res.data) return;
        var added = false;
        res.data.forEach(function (r) { if (mergeMessage(th, rowToMsg(r))) added = true; });
        sortItems(th);
        if (activeId === id) {
          var stick = atBottom();
          renderLog({});
          if (added && !stick) els.jump.hidden = false;
          maybeMarkRead();
        }
      }, function () { /* offline - next tick */ });
  }

  // ---- Reading -----------------------------------------------------------
  function maybeMarkRead() {
    clearTimeout(markReadTimer);
    markReadTimer = setTimeout(function () {
      var c = convById(activeId);
      if (!c || c.draft || !viewing() || !atBottom() || c.unread === 0) return;
      c.unread = 0;
      renderList();
      emitUnread();
      supabaseClient.rpc('chat_mark_read', { p_conversation: c.id }).then(function () {}, function () {});
    }, 300);
  }

  function emitUnread() {
    var n = totalUnread();
    var badge = document.querySelector('[data-chat-tab-badge]');
    if (badge) { badge.hidden = n === 0; badge.textContent = n > 99 ? '99+' : n; }
    if (dock) {
      var had = !dock.badge.hidden;
      dock.badge.hidden = n === 0;
      dock.badge.textContent = n > 99 ? '99+' : n;
      dock.launcher.setAttribute('aria-label', n ? 'Messages, ' + n + ' unread' : 'Messages');
      dock.launcher.classList.toggle('has-new', n > 0);
      if (n > 0 && !dockOpen && !reduceMotion && (!had || dock.lastCount < n)) {
        dock.launcher.classList.remove('is-ping'); void dock.launcher.offsetWidth; dock.launcher.classList.add('is-ping');
      }
      dock.lastCount = n;
    }
    document.title = (n > 0 ? '(' + n + ') ' : '') + baseTitle;
    document.dispatchEvent(new CustomEvent('lacms:chat-unread', { detail: { count: n } }));
  }

  // ---- Sending -----------------------------------------------------------
  function updateSendState() {
    var len = els.input.value.length;
    var trimmed = els.input.value.trim();
    els.send.disabled = !trimmed || len > MAX_LEN;
    els.count.hidden = len < MAX_LEN - 300;
    els.count.textContent = len + ' / ' + MAX_LEN;
    els.count.classList.toggle('is-over', len > MAX_LEN);
  }
  function autosize() {
    // Not laid out yet (hidden, or mid-animation)? Leave it to CSS and retry later.
    if (els.input.clientWidth < 80) { els.input.style.height = ''; return; }
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, 168) + 'px';
  }

  function sendCurrent() {
    var c = convById(activeId);
    if (!c || c.iBlocked) return;
    var text = els.input.value.replace(/^\s+|\s+$/g, '');
    if (!text || text.length > MAX_LEN) return;
    var th = threadFor(c.id);
    var msg = { id: 'local-' + uuid(), clientId: uuid(), mine: true, body: text, at: Date.now(), raw: null, deleted: false, status: 'sending' };
    th.items.push(msg);
    els.input.value = '';
    writeDraft(c.id, '');
    autosize();
    updateSendState();
    sendTypingState(c, false);
    renderLog({ toBottom: true });
    if (!coarsePointer) els.input.focus();
    queueSend(c, msg);
  }

  function queueSend(c, msg) {
    c.sendChain = c.sendChain.then(function () { return deliver(c, msg); });
  }

  function deliver(c, msg) {
    msg.status = 'sending';
    msg.error = null;
    return supabaseClient.rpc('chat_send_message', { p_conversation: c.id, p_body: msg.body, p_client_id: msg.clientId }).then(function (res) {
      if (res.error || !res.data) {
        msg.status = 'failed';
        msg.error = friendly(res.error);
      } else {
        var th = threadFor(c.id);
        var real = rowToMsg(res.data);
        // The live echo may have already added the real row.
        th.items = th.items.filter(function (x) { return x !== msg && x.id !== real.id; });
        th.items.push(real);
        sortItems(th);
        c.draft = false;
        c.lastAt = real.at; c.lastBody = real.body; c.lastSender = SELF; c.lastDeleted = false;
        sortConvs();
      }
      renderList();
      if (activeId === c.id) renderLog({ toBottom: true });
    }, function (err) {
      msg.status = 'failed';
      msg.error = friendly(err);
      if (activeId === c.id) renderLog({ toBottom: true });
    });
  }

  // ---- Typing ------------------------------------------------------------
  function prepTypingChannel(c) {
    if (!c) return;
    if (!supabaseClient.channel || typingOut[c.otherId]) return;
    var entry = { ready: false, channel: null };
    try {
      entry.channel = supabaseClient.channel('chat-typing:' + c.otherId, { config: { broadcast: { self: false } } });
      entry.channel.subscribe(function (status) { entry.ready = status === 'SUBSCRIBED'; });
      typingOut[c.otherId] = entry;
    } catch (e) { /* typing is a nicety */ }
  }
  function sendTypingState(c, on) {
    var entry = typingOut[c.otherId];
    if (!entry || !entry.ready) return;
    try {
      entry.channel.send({ type: 'broadcast', event: 'typing', payload: { conv: c.id, from: SELF, on: on } });
    } catch (e) { /* ignore */ }
  }
  function onTypingInput() {
    var c = convById(activeId);
    if (!c) return;
    var now = Date.now();
    if (els.input.value.trim() && now - lastTypingSent > 2500) {
      lastTypingSent = now;
      sendTypingState(c, true);
    }
  }
  function onTypingBroadcast(msg) {
    var p = msg && msg.payload;
    if (!p || !p.conv || p.from === SELF) return;
    var c = convById(p.conv);
    if (!c || c.otherId !== p.from) return;
    clearTimeout(typingFrom[p.conv]);
    delete typingFrom[p.conv];
    if (p.on !== false) typingFrom[p.conv] = setTimeout(function () { delete typingFrom[p.conv]; renderList(); renderTyping(); }, 4500);
    renderList();
    renderTyping();
  }

  // ---- Realtime + polling -----------------------------------------------
  function startRealtime() {
    if (!supabaseClient.channel) return;
    try {
      rt.channel = supabaseClient.channel('chat-inbox-' + SELF)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, onMessageInsert)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages' }, onMessageUpdate)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_participants' }, onParticipantUpdate)
        .subscribe(function (status) { rt.status = status; });
      rt.typing = supabaseClient.channel('chat-typing:' + SELF, { config: { broadcast: { self: false } } })
        .on('broadcast', { event: 'typing' }, onTypingBroadcast)
        .subscribe();
    } catch (e) { rt.status = 'ERROR'; }
    setInterval(function () {
      pollTicks++;
      if (document.hidden) return;
      // Live: just a slow safety net. Not live: poll briskly.
      if (rt.status !== 'SUBSCRIBED' || pollTicks % 8 === 0) sync();
    }, 8000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { sync(); maybeMarkRead(); } });
    window.addEventListener('online', sync);
    window.addEventListener('focus', maybeMarkRead);
  }

  function refreshStatus() {
    return supabaseClient.rpc('chat_status').then(function (res) {
      var row = !res.error && (Array.isArray(res.data) ? res.data[0] : res.data);
      if (row) { statusUnread = row.unread || 0; if (!convsLoaded) emitUnread(); }
    }, function () {});
  }
  function sync() {
    // A closed dock that hasn't loaded anything just keeps its count fresh.
    if (DOCK && !dockOpen && !convsLoaded) return refreshStatus();
    return refreshConversations().then(syncActive);
  }

  function onMessageInsert(payload) {
    var r = payload && payload.new;
    if (!r) return;
    var c = convById(r.conversation_id);
    var mine = r.sender_id === SELF;
    if (!c) {
      refreshConversations().then(function () {
        var nc = convById(r.conversation_id);
        if (nc && !mine && !nc.muted) notifyIncoming(nc, r.body);
      });
      return;
    }
    var msg = rowToMsg(r);
    var th = threads[c.id];
    var isActive = c.id === activeId;
    var stick = isActive && atBottom();
    var added = false;
    if (th && th.loaded) { added = mergeMessage(th, msg); sortItems(th); }
    c.draft = false;
    c.lastAt = msg.at; c.lastBody = msg.body; c.lastSender = r.sender_id; c.lastDeleted = false;
    if (!mine) {
      clearTimeout(typingFrom[c.id]); delete typingFrom[c.id];
      if (isActive && viewing()) {
        c.unread++;
        if (stick) maybeMarkRead(); else { els.jump.hidden = false; }
      } else {
        c.unread++;
        if (!c.muted) notifyIncoming(c, r.body);
      }
    }
    sortConvs();
    renderList();
    if (isActive) {
      if (added || mine) renderLog({});
      renderTyping();
      if (!mine && stick) els.log.scrollTop = els.log.scrollHeight;
    }
    emitUnread();
  }

  function onMessageUpdate(payload) {
    var r = payload && payload.new;
    if (!r || !r.deleted_at) return;
    var th = threads[r.conversation_id];
    if (th && th.loaded) { mergeMessage(th, rowToMsg(r)); }
    if (r.conversation_id === activeId) renderLog({});
    refreshConversations();
  }

  function onParticipantUpdate(payload) {
    var r = payload && payload.new;
    if (!r) return;
    var c = convById(r.conversation_id);
    if (!c) return;
    if (r.user_id === SELF) {
      if (r.muted !== undefined) c.muted = !!r.muted;
      var readAt = Date.parse(r.last_read_at);
      if (readAt >= c.lastAt && c.unread) { c.unread = 0; emitUnread(); }
    } else {
      c.otherReadAt = Date.parse(r.last_read_at);
      if (c.id === activeId) renderLog({});
    }
    renderList();
  }

  function notifyIncoming(c, body) {
    var visibleHere = viewing() && c.id === activeId;
    // In dock mode the site-wide pop-ups (js/notifications.js) announce it.
    if (!visibleHere && !DOCK) {
      toast('<strong>' + esc(c.name) + '</strong><span>' + esc(String(body || '').replace(/\s+/g, ' ').slice(0, 80)) + '</span>', 'message', c.id);
    }
    els.live.textContent = 'New message from ' + c.name;
  }

  function refreshConversations() {
    if (refreshing) return refreshing;
    refreshing = supabaseClient.rpc('chat_get_conversations').then(function (res) {
      refreshing = null;
      if (res.error) return;
      convsLoaded = true;
      var fresh = (res.data || []).map(normalizeConv);
      var byId = {};
      convs.forEach(function (c) { byId[c.id] = c; });
      fresh.forEach(function (n) {
        var old = byId[n.id];
        if (old) {
          n.sendChain = old.sendChain;
          // Don't let a stale response resurrect unread on the thread you're reading.
          if (n.id === activeId && viewing() && atBottom()) n.unread = 0;
        }
      });
      // Keep a just-started (still empty) conversation until it has a message.
      convs.forEach(function (c) {
        if (c.draft && !fresh.some(function (n) { return n.id === c.id; })) fresh.push(c);
      });
      convs = fresh;
      sortConvs();
      renderList();
      var a = convById(activeId);
      if (a && !els.thread.hidden) {
        renderThreadHeader(a);
        renderComposerState(a);
        if (threads[a.id] && threads[a.id].loaded) renderLog({});
      }
      emitUnread();
    }, function () { refreshing = null; });
    return refreshing;
  }

  // ---- Menu, profile, actions --------------------------------------------
  function closeMenu() {
    els.menu.hidden = true;
    els.menuBtn.setAttribute('aria-expanded', 'false');
  }
  function toggleMenu() {
    var open = els.menu.hidden;
    els.menu.hidden = !open;
    els.menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { var first = els.menu.querySelector('button'); if (first) first.focus(); }
  }

  function setMuted(c, muted) {
    if (c.draft) { c.muted = muted; renderThreadHeader(c); return; }
    c.muted = muted;
    renderThreadHeader(c); renderList(); emitUnread();
    supabaseClient.rpc('chat_set_muted', { p_conversation: c.id, p_muted: muted }).then(function (res) {
      if (res.error) { c.muted = !muted; renderThreadHeader(c); renderList(); emitUnread(); toast(friendly(res.error), 'error'); }
      else toast(muted ? 'Notifications muted for this conversation.' : 'Notifications back on.');
    });
  }

  function setBlocked(c, blocked) {
    supabaseClient.rpc('chat_set_blocked', { p_user: c.otherId, p_blocked: blocked }).then(function (res) {
      if (res.error) { toast(friendly(res.error), 'error'); return; }
      c.iBlocked = blocked;
      renderThreadHeader(c); renderComposerState(c);
      toast(blocked ? firstName(c.name) + ' is blocked.' : firstName(c.name) + ' is unblocked.');
      directory = null;
    });
  }

  function clearConversation(c) {
    supabaseClient.rpc('chat_clear_conversation', { p_conversation: c.id }).then(function (res) {
      if (res.error) { toast(friendly(res.error), 'error'); return; }
      convs = convs.filter(function (x) { return x.id !== c.id; });
      delete threads[c.id];
      writeDraft(c.id, '');
      closeConversation();
      navList();
      emitUnread();
      toast('Conversation cleared. ' + firstName(c.name) + ' still has their copy.');
    });
  }

  function deleteMessage(c, mid) {
    var th = threadFor(c.id);
    var m = th.items.filter(function (x) { return x.id === mid; })[0];
    if (!m) return;
    supabaseClient.rpc('chat_delete_message', { p_message: mid }).then(function (res) {
      if (res.error) { toast(friendly(res.error), 'error'); return; }
      m.deleted = true; m.body = '';
      renderLog({});
      refreshConversations();
    });
  }

  function copyText(text) {
    var done = function () { toast('Copied.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { toast('Couldn\'t copy.', 'error'); });
    else {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('Couldn\'t copy.', 'error'); }
      ta.remove();
    }
  }

  // ---- Dialogs -----------------------------------------------------------
  function openDialog(innerHtml, cls) {
    var previous = document.activeElement;
    var backdrop = document.createElement('div');
    backdrop.className = 'guide-backdrop';
    var dialog = document.createElement('div');
    dialog.className = 'guide-dialog chat-dialog' + (cls ? ' ' + cls : '');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = innerHtml;
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    document.body.classList.add('guide-open');
    requestAnimationFrame(function () {
      backdrop.classList.add('is-in');
      var f = dialog.querySelector('[data-autofocus]') || dialog.querySelector('button, input, select, textarea');
      if (f) f.focus();
    });
    var api = {
      el: dialog,
      close: function () {
        document.removeEventListener('keydown', onKey, true);
        backdrop.classList.remove('is-in');
        document.body.classList.remove('guide-open');
        setTimeout(function () { backdrop.remove(); }, reduceMotion ? 0 : 200);
        if (previous && previous.focus && document.body.contains(previous)) previous.focus();
      }
    };
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); api.close(); return; }
      if (e.key !== 'Tab') return;
      var f = dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]');
      if (!f.length) return;
      var first = f[0], lastEl = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('mousedown', function (e) { if (e.target === backdrop) api.close(); });
    dialog.addEventListener('click', function (e) { if (e.target.closest('[data-dialog-close]')) api.close(); });
    return api;
  }

  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      var d = openDialog(
        '<h2 class="guide-title">' + esc(opts.title) + '</h2>' +
        '<p class="guide-text">' + esc(opts.text) + '</p>' +
        '<div class="guide-actions"><button type="button" class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" data-ok data-autofocus>' + esc(opts.confirm) + '</button>' +
        '<button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div>');
      var settled = false;
      d.el.querySelector('[data-ok]').addEventListener('click', function () { settled = true; d.close(); resolve(true); });
      var origClose = d.close;
      d.close = function () { origClose(); if (!settled) { settled = true; resolve(false); } };
    });
  }

  function openReport(c, messageId) {
    var d = openDialog(
      '<span class="guide-eyebrow">Report</span>' +
      '<h2 class="guide-title">Report ' + esc(firstName(c.name)) + '</h2>' +
      '<p class="guide-text">' + (messageId ? 'This message and the few before it' : 'The latest messages in this conversation') + ' will be sent to the LACMS president to review. Nothing else from your chat is shared, and ' + esc(firstName(c.name)) + ' isn\'t told it was you.</p>' +
      '<form class="guide-form" data-report-form novalidate>' +
        '<div class="field"><label for="chat-report-reason">What\'s wrong?</label>' +
        '<select id="chat-report-reason" data-autofocus>' +
          '<option value="">Choose a reason…</option><option value="harassment">Harassment or bullying</option><option value="inappropriate">Inappropriate or offensive content</option>' +
          '<option value="spam">Spam or unwanted promotion</option><option value="impersonation">Pretending to be someone else</option><option value="other">Something else</option></select></div>' +
        '<div class="field"><label for="chat-report-details">Anything else we should know? <span class="guide-optional">(optional)</span></label>' +
        '<textarea id="chat-report-details" maxlength="1000" placeholder="Add any context that helps"></textarea></div>' +
        '<p class="guide-error" data-report-error hidden></p>' +
        '<div class="guide-actions"><button type="submit" class="btn btn-primary">Send report</button><button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div>' +
      '</form>');
    var form = d.el.querySelector('[data-report-form]');
    var err = d.el.querySelector('[data-report-error]');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var reason = d.el.querySelector('#chat-report-reason').value;
      if (!reason) { err.textContent = 'Please choose a reason.'; err.hidden = false; return; }
      var btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      supabaseClient.rpc('chat_report', {
        p_conversation: c.id, p_message: messageId || null, p_reason: reason,
        p_details: d.el.querySelector('#chat-report-details').value.trim() || null
      }).then(function (res) {
        if (res.error) { err.textContent = friendly(res.error); err.hidden = false; btn.disabled = false; return; }
        d.el.innerHTML = '<div class="guide-done"><span class="guide-done-tick">&#10003;</span><h2 class="guide-title">Thanks for letting us know</h2>' +
          '<p class="guide-text">The president will take a look. You can also block ' + esc(firstName(c.name)) + ' from the menu at the top of the conversation.</p>' +
          '<div class="guide-actions guide-actions--stack"><button type="button" class="btn btn-primary btn-block" data-dialog-close data-autofocus>Close</button></div></div>';
        var f = d.el.querySelector('[data-autofocus]'); if (f) f.focus();
      }, function () { err.textContent = 'Couldn\'t reach the server - try again.'; err.hidden = false; btn.disabled = false; });
    });
  }

  // ---- Toasts ------------------------------------------------------------
  function toast(html, kind, convId) {
    var t = document.createElement('div');
    t.className = 'chat-toast' + (kind ? ' is-' + kind : '');
    t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    t.innerHTML = kind === 'message' ? html : '<span>' + esc(html) + '</span>';
    if (convId) { t.tabIndex = 0; t.setAttribute('data-conv', convId); t.style.cursor = 'pointer'; }
    els.toasts.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('is-in'); });
    var timer = setTimeout(remove, kind === 'error' ? 7000 : 5000);
    function remove() { clearTimeout(timer); t.classList.remove('is-in'); setTimeout(function () { t.remove(); }, 200); }
    t.addEventListener('click', function () { remove(); if (convId) navConv(convId); });
  }

  // ---- Tabs + routing ----------------------------------------------------
  function showTab(name) {
    var tabs = document.querySelectorAll('[data-net-tab]');
    Array.prototype.forEach.call(tabs, function (t) {
      var on = t.getAttribute('data-net-tab') === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
    var people = document.getElementById('network-people-panel');
    if (people) people.hidden = name !== 'people';
    root.hidden = name !== 'messages';
    if (name === 'messages') { maybeMarkRead(); }
  }

  function goHash(hash) {
    if (window.location.hash === hash) route(); else window.location.hash = hash;
  }

  // Where "open this conversation / go back to the list" lead: the URL on the
  // Network page, the dock panel everywhere else.
  function navConv(id) {
    if (!DOCK) { goHash('#messages/' + id); return; }
    openDock();
    if (!openConversation(id)) {
      refreshConversations().then(function () {
        if (!openConversation(id)) toast('That conversation isn\'t available.', 'error');
      });
    }
  }
  function navList() {
    if (!DOCK) { goHash('#messages'); return; }
    closeConversation();
  }
  function showMessages() {
    if (DOCK) openDock(); else showTab('messages');
  }

  function route() {
    var h = window.location.hash || '';
    var m = /^#messages(?:\/([0-9a-f-]{36}))?$/i.exec(h);
    if (!m) { showTab('people'); return; }
    showTab('messages');
    if (m[1]) {
      var c = convById(m[1]);
      if (c) { openConversation(m[1]); return; }
      refreshConversations().then(function () {
        if (!openConversation(m[1])) {
          if (activeId) closeConversation();
          window.history.replaceState(null, '', window.location.pathname + window.location.search + '#messages');
          toast('That conversation isn\'t available.', 'error');
        }
      });
    } else if (activeId) {
      closeConversation();
    } else {
      els.shell.setAttribute('data-view', 'list');
    }
  }

  // ---- Starting a conversation ------------------------------------------
  function openWith(userId, info) {
    if (!ready) { pendingOpen = { userId: userId, info: info }; return; }
    if (!userId || userId === SELF) return;
    if (info && info.draft) pendingDraft = String(info.draft).slice(0, MAX_LEN);
    var existing = convByUser(userId);
    if (existing) { navConv(existing.id); return; }
    supabaseClient.rpc('chat_start_conversation', { p_other: userId }).then(function (res) {
      if (res.error || !res.data) {
        pendingDraft = null;
        showMessages();
        toast(friendly(res.error), 'error');
        return;
      }
      var id = res.data;
      var c = convById(id);
      if (!c) {
        var p = directory && directory.rows ? directory.rows.filter(function (x) { return x.user_id === userId; })[0] : null;
        info = info || {};
        c = {
          id: id, otherId: userId, name: info.name || (p && p.full_name) || 'LACMS member', detail: info.detail || (p && p.detail) || '',
          kind: (p && p.kind) || 'member', role: (p && p.role) || '', bio: '', linkedin: '', photo: (p && p.photo_url) || '',
          lastAt: 0, lastBody: '', lastSender: null, lastDeleted: false, unread: 0, otherReadAt: 0, muted: false, iBlocked: false,
          draft: true, sendChain: Promise.resolve()
        };
        convs.push(c);
        sortConvs();
        // Fill in the rest (bio, LinkedIn...) quietly once we have it.
        refreshConversations();
      }
      navConv(id);
    }, function (err) { toast(friendly(err), 'error'); });
  }

  // ---- Wiring ------------------------------------------------------------
  function wire() {
    if (!DOCK) {
      document.addEventListener('click', function (e) {
        var tab = e.target.closest('[data-net-tab]');
        if (tab) {
          if (tab.getAttribute('data-net-tab') === 'messages') goHash('#messages');
          else { if (window.location.hash) window.history.pushState(null, '', window.location.pathname + window.location.search); route(); }
        }
      });
      document.querySelector('.network-tabs').addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-net-tab]'));
        var i = tabs.indexOf(document.activeElement);
        if (i === -1) return;
        var next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
        next.focus(); next.click();
      });
      window.addEventListener('hashchange', route);
    }

    root.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('[data-chat-compose]')) { openPicker(); return; }
      if (t.closest('[data-chat-picker-close]')) { closePicker(); return; }
      var person = t.closest('[data-person]');
      if (person) {
        var id = person.getAttribute('data-person');
        var p = directory && directory.rows ? directory.rows.filter(function (x) { return x.user_id === id; })[0] : null;
        pickerOpen = false;
        openWith(id, p ? { name: p.full_name, detail: p.detail } : null);
        return;
      }
      var item = t.closest('[data-conv]');
      if (item && item.classList.contains('chat-item')) { navConv(item.getAttribute('data-conv')); return; }
      var toastEl = t.closest('.chat-toast');
      if (toastEl) return;
      if (t.closest('[data-chat-back]')) { navList(); return; }
      if (t.closest('[data-chat-who]')) {
        var open = els.profile.hidden;
        els.profile.hidden = !open;
        els.who.setAttribute('aria-expanded', open ? 'true' : 'false');
        return;
      }
      if (t.closest('[data-chat-menu-btn]')) { toggleMenu(); return; }
      var menuItem = t.closest('[data-menu]');
      if (menuItem) { closeMenu(); onMenu(menuItem.getAttribute('data-menu')); return; }
      if (t.closest('[data-unblock]')) { var cu = convById(activeId); if (cu) setBlocked(cu, false); return; }
      if (t.closest('[data-chat-jump]')) { els.log.scrollTop = els.log.scrollHeight; els.jump.hidden = true; maybeMarkRead(); return; }

      var act = t.closest('[data-act]');
      var msgEl = t.closest('.chat-msg');
      var c = convById(activeId);
      if (act && msgEl && c) {
        var mid = msgEl.getAttribute('data-mid');
        var th = threadFor(c.id);
        var m = th.items.filter(function (x) { return x.id === mid; })[0];
        var kind = act.getAttribute('data-act');
        if (kind === 'copy' && m) copyText(m.body);
        else if (kind === 'delete' && m) {
          confirmDialog({ title: 'Delete this message?', text: 'It will be removed for both of you. This can\'t be undone.', confirm: 'Delete', danger: true }).then(function (ok) { if (ok) deleteMessage(c, mid); });
        } else if (kind === 'report' && m) openReport(c, mid);
        else if (kind === 'retry' && m) { m.status = 'sending'; m.error = null; renderLog({ toBottom: true }); queueSend(c, m); }
        else if (kind === 'discard') { th.items = th.items.filter(function (x) { return x.id !== mid; }); renderLog({}); }
        return;
      }
      // Tap a bubble on touch screens to reveal its actions.
      var bubble = t.closest('.chat-bubble');
      if (bubble && msgEl && coarsePointer && !t.closest('a')) {
        var id2 = msgEl.getAttribute('data-mid');
        openActionsId = openActionsId === id2 ? null : id2;
        Array.prototype.forEach.call(els.log.querySelectorAll('.chat-msg.is-open'), function (n) { n.classList.remove('is-open'); });
        if (openActionsId) msgEl.classList.add('is-open');
      }
    });

    document.addEventListener('click', function (e) {
      if (!els.menu.hidden && !e.target.closest('.chat-menu-wrap')) closeMenu();
    });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !els.menu.hidden) { closeMenu(); els.menuBtn.focus(); }
    });

    els.search.addEventListener('input', function () { if (pickerOpen) pickerOpen = false; renderList(); });
    els.list.addEventListener('input', function (e) { if (e.target.matches('[data-picker-input]')) renderPicker(); });

    els.input.addEventListener('input', function () {
      autosize(); updateSendState(); onTypingInput();
      var c = convById(activeId);
      if (c) writeDraft(c.id, els.input.value);
    });
    els.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !coarsePointer) {
        e.preventDefault();
        sendCurrent();
      }
    });
    els.input.addEventListener('blur', function () { var c = convById(activeId); if (c) sendTypingState(c, false); });
    els.composer.addEventListener('submit', function (e) { e.preventDefault(); sendCurrent(); });

    els.log.addEventListener('scroll', function () {
      if (els.log.scrollTop < 60) loadOlder();
      if (atBottom()) { els.jump.hidden = true; maybeMarkRead(); }
    }, { passive: true });
  }

  function onMenu(which) {
    var c = convById(activeId);
    if (!c) return;
    if (which === 'mute') setMuted(c, !c.muted);
    else if (which === 'report') openReport(c, null);
    else if (which === 'block') {
      if (c.iBlocked) setBlocked(c, false);
      else confirmDialog({ title: 'Block ' + c.name + '?', text: 'They won\'t be able to message you, and you won\'t be able to message them, until you unblock them. They aren\'t told.', confirm: 'Block', danger: true }).then(function (ok) { if (ok) setBlocked(c, true); });
    } else if (which === 'clear') {
      confirmDialog({ title: 'Clear this conversation?', text: 'It\'s removed from your side only - ' + firstName(c.name) + ' keeps their copy. If either of you writes again it comes back with the new messages.', confirm: 'Clear', danger: true }).then(function (ok) { if (ok) clearConversation(c); });
    }
  }

  // ---- The floating dock ---------------------------------------------------
  var DOCK_KEY = 'lacms-chat-dock';
  function persistDock() {
    if (!DOCK) return;
    try { window.sessionStorage.setItem(DOCK_KEY, JSON.stringify({ open: dockOpen, conv: dockOpen ? activeId : null })); } catch (e) { /* ignore */ }
  }

  function buildDock() {
    var launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'chat-launcher';
    launcher.setAttribute('aria-label', 'Messages');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-controls', 'chat-dock');
    launcher.innerHTML = svg('chat') + '<span class="chat-launcher-badge" aria-hidden="true" hidden></span>';

    var panel = document.createElement('section');
    panel.className = 'chat-dock';
    panel.id = 'chat-dock';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Messages');
    panel.hidden = true;
    panel.innerHTML =
      '<div class="chat-dock-bar"><strong>Messages</strong>' +
      '<a class="chat-icon-btn" href="member-network.html#messages" title="Open the full Messages page" aria-label="Open the full Messages page">' +
        '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></a>' +
      '<button type="button" class="chat-icon-btn" data-dock-close aria-label="Close messages">' + svg('close') + '</button></div>' +
      '<div class="chat chat--dock" data-dock-root></div>';
    document.body.appendChild(panel);
    document.body.appendChild(launcher);
    document.body.classList.add('has-chat-dock');
    root = panel.querySelector('[data-dock-root]');
    dock = { launcher: launcher, badge: launcher.querySelector('.chat-launcher-badge'), panel: panel, lastCount: 0 };

    launcher.addEventListener('click', function () { if (dockOpen) closeDock(); else openDock(); });
    panel.querySelector('[data-dock-close]').addEventListener('click', closeDock);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !dockOpen) return;
      if (document.querySelector('.guide-backdrop') || (els.menu && !els.menu.hidden)) return;
      closeDock();
    });
  }

  function openDock() {
    if (!DOCK || !dock) return;
    if (!dockOpen) {
      dockOpen = true;
      dock.panel.hidden = false;
      // (rAF alone never fires in a background tab, so a timer backs it up.)
      var show = function () { dock.panel.classList.add('is-open'); };
      requestAnimationFrame(show);
      setTimeout(show, 30);
      setTimeout(autosize, 300);
      dock.launcher.setAttribute('aria-expanded', 'true');
      dock.launcher.classList.remove('is-ping');
      document.body.classList.add('chat-dock-open');
      if (!convsLoaded) { renderList(); refreshConversations().then(function () { if (activeId) renderList(); }); }
      else { renderList(); refreshConversations(); }
      maybeMarkRead();
    }
    persistDock();
  }

  function closeDock() {
    if (!dockOpen) return;
    dockOpen = false;
    dock.panel.classList.remove('is-open');
    setTimeout(function () { if (!dockOpen) dock.panel.hidden = true; }, reduceMotion ? 0 : 220);
    dock.launcher.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('chat-dock-open');
    persistDock();
    dock.launcher.focus();
  }

  // ---- Start -------------------------------------------------------------
  function init(session) {
    SELF = session.user.id;
    supabaseClient.rpc('chat_status').then(function (res) {
      if (res.error) { console.warn('Messaging unavailable (has migration 070 been run?):', res.error.message); return; }
      var row = Array.isArray(res.data) ? res.data[0] : res.data;
      if (!row || !row.can_message) return;

      statusUnread = row.unread || 0;
      if (DOCK) buildDock();
      buildShell();
      wire();
      if (!DOCK) {
        var tabs = document.getElementById('network-tabs');
        if (tabs) tabs.hidden = false;
        var people = document.getElementById('network-content');
        if (people) people.classList.add('chat-on');
      }
      ready = true;
      if (DOCK) {
        // Nothing but the unread count is fetched until the dock is opened
        // (or a message arrives), so every other page stays light.
        emitUnread();
        var saved = null;
        try { saved = JSON.parse(window.sessionStorage.getItem(DOCK_KEY) || 'null'); } catch (e) { saved = null; }
        if (pendingOpen) { var po = pendingOpen; pendingOpen = null; openWith(po.userId, po.info); }
        else if (saved && saved.open) {
          openDock();
          if (saved.conv) refreshConversations().then(function () { openConversation(saved.conv); });
        }
        startRealtime();
        return;
      }
      refreshConversations().then(function () {
        // member-network.html?message=<user id>&draft=<text> opens a chat with
        // that person (e.g. from a PIN-protected resource asking for its PIN).
        var params = new URLSearchParams(window.location.search);
        var target = params.get('message');
        if (target && /^[0-9a-f-]{36}$/i.test(target)) {
          pendingDraft = (params.get('draft') || '').slice(0, MAX_LEN) || null;
          window.history.replaceState(null, '', window.location.pathname + '#messages');
          route();
          openWith(target, null);
          return;
        }
        route();
        if (pendingOpen) { var p = pendingOpen; pendingOpen = null; openWith(p.userId, p.info); }
      });
      startRealtime();
    }, function () { /* offline - leave the page as it was */ });
  }

  // Message buttons on the People tab / profile pop-up (js/members.js).
  document.addEventListener('lacms:chat-open', function (e) {
    var d = (e && e.detail) || {};
    if (d.userId) openWith(d.userId, { name: d.name, detail: d.detail, draft: d.draft });
  });

  window.lacmsChat = {
    open: function (userId, info) { openWith(userId, info); },
    openConversation: function (id) { if (ready) navConv(id); },
    toggle: function () { if (!DOCK || !ready) return; if (dockOpen) closeDock(); else openDock(); },
    isDock: function () { return DOCK; },
    isReady: function () { return ready; },
    // True while that conversation is on screen, so pop-ups stay quiet for it.
    isViewing: function (id) { return !!(ready && viewing() && activeId === id); }
  };

  supabaseClient.auth.getSession().then(function (result) {
    var session = result.data && result.data.session;
    if (session) init(session);
  });
})();
