// Shared helpers for the Sankofa Hub (js/sankofa-hub.js, the member page) and
// the Circle manager (js/sankofa-admin.js, the dashboard): HTML escaping,
// RPC calls that fail with a readable message, dialogs, toasts, avatars,
// dates, and the small celebration animation.
//
// Everything real (who can see or change what) is enforced in the database
// (migrations 084-087); these are just conveniences for drawing the pages.
(function () {
  'use strict';

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // A database error as a sentence. "Function ... does not exist" means the
  // migrations haven't been run yet.
  function friendly(err) {
    var m = (err && (err.message || err.details)) || String(err || 'Something went wrong');
    if (/does not exist|could not find the function|schema cache/i.test(m)) {
      return "The Sankofa Hub isn't switched on yet - the database migrations 084 to 087 still need running (see README-members-setup.md, section 137).";
    }
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Couldn't reach the server - check your connection and try again.";
    return m.replace(/^error:\s*/i, '');
  }

  function rpc(fn, args) {
    return supabaseClient.rpc(fn, args || {}).then(function (res) {
      if (res.error) {
        var e = new Error(friendly(res.error));
        e.raw = res.error;
        throw e;
      }
      return res.data;
    }, function (err) {
      throw new Error(friendly(err));
    });
  }

  // ---- Dates -----------------------------------------------------------------
  function d(iso) { return new Date(iso); }
  function fmtDay(iso) { return d(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function fmtLongDay(iso) { return d(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }); }
  function fmtTime(iso) { return d(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
  function fmtDateTime(iso) { return fmtDay(iso) + ', ' + fmtTime(iso); }
  function timeAgo(iso) {
    var t = d(iso);
    if (isNaN(t.getTime())) return '';
    var mins = Math.floor((Date.now() - t.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + ' hr ago';
    var days = Math.floor(hrs / 24);
    if (days < 7) return days + (days === 1 ? ' day ago' : ' days ago');
    return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  // "in 2 days", "in 3 hours", "in 12 min", "now"
  function until(iso) {
    var ms = d(iso).getTime() - Date.now();
    if (ms <= 0) return 'now';
    var mins = Math.round(ms / 60000);
    if (mins < 60) return 'in ' + Math.max(mins, 1) + ' min';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return 'in ' + hrs + (hrs === 1 ? ' hour' : ' hours');
    var days = Math.floor(hrs / 24);
    return 'in ' + days + (days === 1 ? ' day' : ' days');
  }
  function toLocalInput(iso) {
    if (!iso) return '';
    var t = d(iso);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()) + 'T' + p(t.getHours()) + ':' + p(t.getMinutes());
  }
  function fromLocalInput(v) { return v ? new Date(v).toISOString() : null; }

  // ---- People ------------------------------------------------------------------
  function hash(str) {
    var h = 0;
    str = String(str || '');
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  }
  // "Dr Naomi Clarke" -> N (a title isn't a name).
  function initialOf(name) {
    var n = String(name || '?').trim().replace(/^(dr|prof|professor|mr|mrs|ms|miss|mx)\.?\s+/i, '');
    return (n.charAt(0) || '?').toUpperCase();
  }
  function avatar(p, size) {
    p = p || {};
    size = size || 'md';
    var name = p.name || '?';
    if (p.blurred) return '<span class="sh-av sh-av--' + size + ' sh-av--blur" aria-hidden="true">?</span>';
    if (p.photo) return '<span class="sh-av sh-av--' + size + '" aria-hidden="true"><img src="' + esc(p.photo) + '" alt="" loading="lazy"></span>';
    return '<span class="sh-av sh-av--' + size + ' sh-av-' + (hash(name) % 6) + '" aria-hidden="true">' + esc(initialOf(name)) + '</span>';
  }
  var TITLE_RE = /^(dr|prof|professor|mr|mrs|ms|miss|mx)\.?\s+/i;
  // "Dr Naomi Clarke" -> Naomi
  function firstName(name) { return String(name || '').trim().replace(TITLE_RE, '').split(/\s+/)[0] || ''; }
  // How to greet someone: "Dr Clarke" for a doctor, otherwise their first name.
  function greetName(name) {
    var n = String(name || '').trim();
    var m = TITLE_RE.exec(n);
    if (!m) return firstName(n);
    var parts = n.replace(TITLE_RE, '').split(/\s+/);
    var title = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    return title + ' ' + parts[parts.length - 1];
  }

  // The Circle colour themes (kept in step with the CSS .sh-theme-* classes).
  var THEMES = ['gold', 'green', 'red', 'purple', 'blue', 'teal'];
  var THEME_LABEL = { gold: 'Gold', green: 'Green', red: 'Red', purple: 'Purple', blue: 'Blue', teal: 'Teal' };

  var XP_TITLES = ['Seedling', 'Sprout', 'Rooted', 'Branching', 'Canopy', 'Towering', 'Elder tree', 'Baobab'];
  function levelTitle(level) { return XP_TITLES[Math.min(Math.max(level, 1), XP_TITLES.length) - 1]; }

  // ---- Dialogs ------------------------------------------------------------------
  function openDialog(html, extraClass) {
    var previous = document.activeElement;
    var backdrop = document.createElement('div');
    backdrop.className = 'guide-backdrop';
    var dialog = document.createElement('div');
    dialog.className = 'guide-dialog sh-dialog' + (extraClass ? ' ' + extraClass : '');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = html;
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    document.body.classList.add('guide-open');
    requestAnimationFrame(function () {
      backdrop.classList.add('is-in');
      var f = dialog.querySelector('[data-autofocus]') || dialog.querySelector('input:not([type=hidden]), textarea, select, button:not(.guide-close)');
      if (f) f.focus();
    });
    var api = { el: dialog, onClose: null };
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); api.close(); return; }
      if (e.key !== 'Tab') return;
      var f = dialog.querySelectorAll('button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), a[href]');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    api.close = function () {
      if (api.closed) return;
      api.closed = true;
      document.removeEventListener('keydown', onKey, true);
      backdrop.classList.remove('is-in');
      if (!document.querySelector('.guide-backdrop.is-in')) document.body.classList.remove('guide-open');
      setTimeout(function () { backdrop.remove(); }, 200);
      if (previous && previous.focus && document.body.contains(previous)) previous.focus();
      if (api.onClose) api.onClose();
    };
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('mousedown', function (e) { if (e.target === backdrop) api.close(); });
    dialog.addEventListener('click', function (e) { if (e.target.closest('[data-dialog-close]')) api.close(); });
    return api;
  }

  // A yes/no question. Resolves true / false.
  function confirmDialog(title, text, okLabel, danger) {
    return new Promise(function (resolve) {
      var answered = false;
      var dlg = openDialog(
        '<span class="guide-eyebrow">Sankofa</span><h2 class="guide-title">' + esc(title) + '</h2>' +
        (text ? '<p class="guide-text">' + text + '</p>' : '') +
        '<div class="guide-actions"><button type="button" class="btn btn-primary' + (danger ? ' sh-btn-danger' : '') + '" data-sh-yes data-autofocus>' + esc(okLabel || 'Yes') + '</button>' +
        '<button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div>');
      dlg.el.querySelector('[data-sh-yes]').addEventListener('click', function () { answered = true; dlg.close(); resolve(true); });
      dlg.onClose = function () { if (!answered) resolve(false); };
    });
  }

  // ---- Toasts ---------------------------------------------------------------------
  var toastBox = null;
  function toast(message, opts) {
    opts = opts || {};
    if (!toastBox) {
      toastBox = document.createElement('div');
      toastBox.className = 'sh-toasts';
      toastBox.setAttribute('role', 'status');
      toastBox.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastBox);
    }
    var t = document.createElement('div');
    t.className = 'sh-toast' + (opts.type === 'err' ? ' sh-toast--err' : '');
    t.innerHTML = '<span>' + esc(message) + '</span>' + (opts.action ? '<button type="button" class="sh-toast-btn">' + esc(opts.action.label) + '</button>' : '');
    toastBox.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('is-in'); });
    var timer;
    function remove() {
      clearTimeout(timer);
      t.classList.remove('is-in');
      setTimeout(function () { t.remove(); }, 250);
    }
    if (opts.action) {
      t.querySelector('.sh-toast-btn').addEventListener('click', function () { remove(); opts.action.fn(); });
    }
    timer = setTimeout(remove, opts.ms || (opts.action ? 8000 : 3800));
    return remove;
  }

  // ---- Celebration ------------------------------------------------------------------
  function confetti(host) {
    if (reduceMotion) return;
    host = host || document.body;
    var colours = ['#d4a62b', '#1e7a46', '#c1272d', '#e8c767', '#6fcf97', '#b28ff0'];
    var wrap = document.createElement('div');
    wrap.className = 'sh-confetti';
    wrap.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 36; i++) {
      var s = document.createElement('span');
      s.style.left = (Math.random() * 100) + '%';
      s.style.background = colours[i % colours.length];
      s.style.animationDelay = (Math.random() * 0.35) + 's';
      s.style.animationDuration = (1.4 + Math.random() * 1.2) + 's';
      s.style.setProperty('--dx', ((Math.random() - 0.5) * 160) + 'px');
      s.style.transform = 'rotate(' + Math.round(Math.random() * 360) + 'deg)';
      wrap.appendChild(s);
    }
    host.appendChild(wrap);
    setTimeout(function () { wrap.remove(); }, 3200);
  }

  // A meeting as a calendar file (works in Apple / Google / Outlook).
  function icsFor(m) {
    function stamp(iso) { return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
    function clean(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
    var end = m.ends_at || new Date(new Date(m.starts_at).getTime() + 3600000).toISOString();
    var lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LACMS//Sankofa Hub//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
      'UID:' + m.id + '@lacms-sankofa', 'DTSTAMP:' + stamp(new Date().toISOString()),
      'DTSTART:' + stamp(m.starts_at), 'DTEND:' + stamp(end),
      'SUMMARY:' + clean('Sankofa: ' + m.title),
      'DESCRIPTION:' + clean([m.description, m.online_link ? 'Join: ' + m.online_link : ''].filter(Boolean).join('\n')),
      'LOCATION:' + clean(m.location || m.online_link || ''),
      'END:VEVENT', 'END:VCALENDAR'
    ];
    return lines.join('\r\n');
  }
  function downloadIcs(m) {
    var blob = new Blob([icsFor(m)], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sankofa-' + String(m.title || 'meeting').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // Open the existing chat with someone (dock on every page, or the Network
  // page's Messages tab). Falls back to the Network deep link.
  function message(person, draft) {
    if (!person || !person.id) return;
    if (window.lacmsChat && typeof window.lacmsChat.open === 'function') {
      window.lacmsChat.open(person.id, { name: person.name, detail: person.detail || person.stage || '', draft: draft || '' });
      return;
    }
    window.location.href = 'member-network.html?message=' + encodeURIComponent(person.id) + (draft ? '&draft=' + encodeURIComponent(draft) : '') + '#messages';
  }

  window.lacmsSankofa = {
    esc: esc, friendly: friendly, rpc: rpc, openDialog: openDialog, confirmDialog: confirmDialog, toast: toast,
    confetti: confetti, avatar: avatar, firstName: firstName, greetName: greetName, hash: hash,
    fmtDay: fmtDay, fmtLongDay: fmtLongDay, fmtTime: fmtTime, fmtDateTime: fmtDateTime, timeAgo: timeAgo, until: until,
    toLocalInput: toLocalInput, fromLocalInput: fromLocalInput,
    THEMES: THEMES, THEME_LABEL: THEME_LABEL, levelTitle: levelTitle,
    downloadIcs: downloadIcs, message: message, reduceMotion: reduceMotion
  };
})();
