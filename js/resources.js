// LACMS Resources (member-resources.html): a members' library of study
// resources, one tile per course. Members share files or links with a
// description, source and optional preview; anything from a non-executive
// member waits for an executive to approve it before anyone else sees it.
//
// All the real rules (who can see/submit/approve, that a submission can't
// approve itself or pose as someone else, which files are allowed) are
// enforced in Postgres and Storage (migration 065) - this file is the
// interface to them. Who can use the page at all is the "resources" Hub
// Access rule; everyone else gets "Coming soon".
//
// "New" markers use the same idea as the notification bell: anything
// approved since the user last opened this page is flagged, with the
// previous visit time supplied by js/notifications.js (lacmsPreviousSeen).
(function () {
  'use strict';

  var appEl = document.getElementById('resources-app');
  if (!appEl) return;
  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;

  var BUCKET = 'lacms-resources';
  var MAX_FILE_BYTES = 25 * 1024 * 1024;
  var MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // One simple line icon per course (24px, stroke).
  var ICONS = {
    Medicine: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/><path d="M6.5 12.5h3l1.5-3 2.5 5 1.5-2h2.5"/>',
    Pharmacy: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
    'Dental Hygiene and Therapy': '<path d="M7 3c-2 0-4 1.5-4 4.5 0 4 2 5.5 2.5 9.5.2 1.5.8 4 2 4 1.5 0 1.5-4 4.5-4s3 4 4.5 4c1.2 0 1.8-2.5 2-4 .5-4 2.5-5.5 2.5-9.5C21 4.5 19 3 17 3c-2 0-3 1-5 1S9 3 7 3z"/>',
    'Diagnostic Radiography': '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
    Nursing: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
    Midwifery: '<path d="M9 12h.01"/><path d="M15 12h.01"/><path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5"/><path d="M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1"/>',
    'Biomedical Science': '<path d="M10 2v7.31"/><path d="M14 9.3V1.99"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/><path d="M5.52 16h12.96"/>',
    'Occupational Therapy': '<path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
    General: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'
  };
  var COURSES = [
    { name: 'Medicine', accent: 'gold' },
    { name: 'Pharmacy', accent: 'green' },
    { name: 'Biomedical Science', accent: 'red' },
    { name: 'Dental Hygiene and Therapy', accent: 'purple' },
    { name: 'Diagnostic Radiography', accent: 'gold' },
    { name: 'Nursing', accent: 'green' },
    { name: 'Midwifery', accent: 'red' },
    { name: 'Occupational Therapy', accent: 'purple' },
    { name: 'General', accent: 'gold', label: 'Other (All courses)' }
  ];
  var TYPES = {
    notes: 'Notes', past_paper: 'Past paper', slides: 'Slides', video: 'Video', website: 'Website / tool',
    textbook: 'Textbook / e-book', flashcards: 'Flashcards', tool: 'App / software', other: 'Other'
  };
  var YEARS = ['Foundation Year', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Masters'];

  // Extensions we accept -> the MIME type the bucket expects (browsers
  // sometimes report an empty type for Office files).
  var FILE_TYPES = {
    pdf: 'application/pdf',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain', csv: 'text/csv'
  };
  var IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

  var session = null;
  var userId = null;
  var isAdmin = false;
  var counts = {};
  var newByCourse = {};
  var newTotal = 0;
  var prevSeen = null;
  var currentCourse = '';
  var urlCache = {}; // storage path -> { url, at }

  // ---- Helpers ------------------------------------------------------------
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function $(id) { return document.getElementById(id); }
  function timeAgo(dateStr) {
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    var mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + ' hr ago';
    var days = Math.floor(hrs / 24);
    if (days < 7) return days + (days === 1 ? ' day ago' : ' days ago');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  var YEAR_ORDER = ['Foundation Year', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Masters'];
  function coursesOf(r) { return (r && r.courses && r.courses.length) ? r.courses : []; }
  function yearsOf(r) { return (r && r.years) ? r.years : []; }
  function coursesLabel(r) { return coursesOf(r).map(courseLabel).join(', '); }
  // "Year 1, Year 2, Year 3" -> "Years 1-3"; otherwise a plain list.
  function yearsLabel(years) {
    var sorted = YEAR_ORDER.filter(function (y) { return years.indexOf(y) !== -1; });
    if (!sorted.length) return '';
    var nums = sorted.map(function (y) { var m = /^Year (\d)$/.exec(y); return m ? parseInt(m[1], 10) : null; });
    if (sorted.length >= 3 && nums.every(function (n, i) { return n !== null && (i === 0 || n === nums[i - 1] + 1); })) return 'Years ' + nums[0] + '-' + nums[nums.length - 1];
    if (sorted.length >= 3 && sorted.length === YEAR_ORDER.length) return 'All years';
    return sorted.join(', ');
  }
  function courseLabel(name) {
    var c = COURSES.filter(function (x) { return x.name === name; })[0];
    return c ? (c.label || c.name) : name;
  }
  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return Math.round(n / 1024) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function extOf(name) {
    var m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }
  function safeFileName(name) {
    var ext = extOf(name);
    var base = String(name || 'file').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'file';
    return ext ? base + '.' + ext : base;
  }
  function parseHttpUrl(raw) {
    var value = String(raw || '').trim();
    if (!value) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = 'https://' + value;
    try {
      var u = new URL(value);
      return /^https?:$/.test(u.protocol) && u.hostname.indexOf('.') !== -1 ? u : null;
    } catch (e) { return null; }
  }
  function youtubeId(url) {
    var u = typeof url === 'string' ? parseHttpUrl(url) : url;
    if (!u) return null;
    var host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
    var id = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else { var m = /^\/(embed|shorts|live)\/([^/?]+)/.exec(u.pathname); if (m) id = m[2]; }
    }
    return id && /^[A-Za-z0-9_-]{6,15}$/.test(id) ? id : null;
  }
  function showToast(message, isError) {
    var t = $('res-toast');
    t.textContent = message;
    t.hidden = false;
    t.classList.remove('is-in');
    void t.offsetWidth;
    t.classList.add('is-in');
    t.classList.toggle('is-error', !!isError);
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () { t.hidden = true; t.classList.remove('is-in'); }, 7000);
  }
  // Number that eases up to its value (skipped for reduced motion).
  function countUp(node, to) {
    if (reduceMotion || to === 0) { node.textContent = to; return; }
    var start = performance.now();
    var dur = 500;
    (function frame(now) {
      var p = Math.min(1, (now - start) / dur);
      node.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(frame);
    })(start);
  }

  // Short-lived signed link for a private file (cached for a few minutes).
  function signedUrl(path, downloadName) {
    var key = path + '|' + (downloadName || '');
    var hit = urlCache[key];
    if (hit && Date.now() - hit.at < 240000) return Promise.resolve(hit.url);
    return supabaseClient.storage.from(BUCKET).createSignedUrl(path, 600, downloadName ? { download: downloadName } : undefined).then(function (r) {
      if (r.error || !r.data) return null;
      urlCache[key] = { url: r.data.signedUrl, at: Date.now() };
      return r.data.signedUrl;
    }, function () { return null; });
  }
  function signedUrls(paths) {
    var need = paths.filter(function (p) { return p && !(urlCache[p + '|'] && Date.now() - urlCache[p + '|'].at < 240000); });
    if (!need.length) return Promise.resolve();
    return supabaseClient.storage.from(BUCKET).createSignedUrls(need, 600).then(function (r) {
      (r.data || []).forEach(function (row) {
        if (row.signedUrl && row.path) urlCache[row.path + '|'] = { url: row.signedUrl, at: Date.now() };
      });
    }, function () { /* thumbnails are optional */ });
  }
  function cachedUrl(path) { var h = urlCache[path + '|']; return h ? h.url : null; }

  // =======================================================================
  // PIN-protected resources (migration 073). The link / file path / preview
  // columns can't be read from the table any more: they come from
  // get_resource_locations(), which only returns them for resources the
  // caller may open (not locked, theirs, an executive, or already unlocked).
  // If the migration hasn't been run, everything falls back to the old
  // behaviour and the lock option simply isn't offered.
  // =======================================================================
  var RES_COLS = 'id, title, description, resource_type, source_type, source_credit, topic, kind, file_name, file_size, file_mime, uploader_id, uploader_name, uploader_detail, status, reviewed_by, reviewed_at, approved_at, reject_reason, created_at, updated_at, courses, years, is_locked';
  var pinsReady = true;
  var chatAvailable = false;
  var LOCK_ICON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
  var UNLOCK_ICON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/></svg>';
  function isLockedOut(r) { return !!(r && r.is_locked && !r.can_open); }

  // Attach url / file_path / preview_path and can_open to each row, in place.
  function hydrateLocations(rows) {
    if (!rows.length) return Promise.resolve(rows);
    return supabaseClient.rpc('get_resource_locations', { p_ids: rows.map(function (r) { return r.id; }) }).then(function (res) {
      var map = {};
      (res.data || []).forEach(function (l) { map[l.resource_id] = l; });
      rows.forEach(function (r) {
        var l = map[r.id];
        r.can_open = l ? !!l.can_open : !r.is_locked;
        r.url = l && l.can_open ? l.url : null;
        r.file_path = l && l.can_open ? l.file_path : null;
        r.preview_path = l && l.can_open ? l.preview_path : null;
      });
      return rows;
    }, function () {
      rows.forEach(function (r) { r.can_open = !r.is_locked; });
      return rows;
    });
  }

  // Read resources (apply() adds the filters/ordering) with their locations.
  function selectResources(apply) {
    return apply(supabaseClient.from('resources').select(pinsReady ? RES_COLS : '*')).then(function (r) {
      if (r.error && pinsReady && /is_locked|column|permission denied/i.test(r.error.message || '')) {
        pinsReady = false; // migration 073 isn't there yet - the old way still works
        return selectResources(apply);
      }
      if (r.error || !pinsReady) return r;
      return hydrateLocations(r.data || []).then(function (rows) { r.data = rows; return r; });
    });
  }

  // =======================================================================
  // Custom dropdown: replaces a native <select> with a styled button + a
  // listbox popover. The native element stays in the DOM (hidden) and
  // keeps the real value, so forms and change listeners work unchanged.
  // Full keyboard support (arrows, Home/End, type-ahead, Enter/Space, Esc)
  // and ARIA (button aria-haspopup=listbox, options role=option).
  // =======================================================================
  var CHEVRON = '<svg class="icon ui-select-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
  var openSelect = null; // the one open instance

  function closeOpenSelect(returnFocus) {
    if (openSelect) openSelect.close(returnFocus);
  }

  function enhanceSelect(select) {
    if (select._ui) return select._ui;
    var wrap = document.createElement('div');
    wrap.className = 'ui-select';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    select.classList.add('ui-select-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ui-select-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    var labelEl = select.id ? document.querySelector('label[for="' + select.id + '"]') : null;
    var labelText = select.getAttribute('aria-label') || (labelEl ? labelEl.textContent.replace(/\s*\(.*?\)\s*$/, '').trim() : 'Choose');
    btn.setAttribute('aria-label', labelText);
    btn.innerHTML = '<span class="ui-select-value"></span>' + CHEVRON;
    wrap.insertBefore(btn, select);
    var valueEl = btn.querySelector('.ui-select-value');

    var menu = null;
    var active = -1;
    var typed = '';
    var typedTimer = null;
    var instance = { sync: sync, close: close, destroy: destroy };

    function opts() { return Array.prototype.slice.call(select.options); }
    function sync() {
      var o = select.options[select.selectedIndex];
      valueEl.textContent = o ? o.textContent : '';
      btn.classList.toggle('is-placeholder', !select.value);
      wrap.classList.toggle('is-active', !!select.value);
    }

    function position() {
      if (!menu) return;
      var r = btn.getBoundingClientRect();
      var vh = window.innerHeight;
      var width = Math.max(r.width, 200);
      menu.style.minWidth = width + 'px';
      menu.style.maxHeight = Math.min(300, vh - 24) + 'px';
      var h = menu.offsetHeight;
      var below = vh - r.bottom - 8;
      var top = below >= Math.min(h, 220) || below >= r.top ? r.bottom + 6 : r.top - h - 6;
      menu.classList.toggle('is-above', top < r.top);
      menu.style.top = Math.max(8, Math.round(top)) + 'px';
      menu.style.left = Math.max(8, Math.min(window.innerWidth - width - 8, Math.round(r.left))) + 'px';
    }

    function setActive(i, scroll) {
      var items = menu.querySelectorAll('.ui-select-opt');
      if (!items.length) return;
      active = Math.max(0, Math.min(items.length - 1, i));
      items.forEach(function (it, idx) { it.classList.toggle('is-active', idx === active); });
      menu.setAttribute('aria-activedescendant', items[active].id);
      if (scroll !== false) items[active].scrollIntoView({ block: 'nearest' });
    }

    function choose(i) {
      select.selectedIndex = i;
      sync();
      select.dispatchEvent(new Event('change', { bubbles: true }));
      close(true);
    }

    function open() {
      if (openSelect && openSelect !== instance) openSelect.close(false);
      if (menu) return;
      menu = document.createElement('div');
      menu.className = 'ui-select-menu';
      menu.setAttribute('role', 'listbox');
      menu.tabIndex = -1;
      menu.setAttribute('aria-label', labelText);
      var uid = 'uso-' + Math.random().toString(36).slice(2, 8);
      menu.innerHTML = opts().map(function (o, i) {
        var sel = i === select.selectedIndex;
        return '<div class="ui-select-opt' + (sel ? ' is-selected' : '') + (o.value === '' ? ' is-placeholder' : '') + '" role="option" id="' + uid + '-' + i + '" aria-selected="' + sel + '" data-i="' + i + '">' +
          '<span class="ui-select-opt-text">' + escapeHtml(o.textContent) + '</span>' +
          '<svg class="icon ui-select-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg></div>';
      }).join('');
      document.body.appendChild(menu);
      btn.setAttribute('aria-expanded', 'true');
      wrap.classList.add('is-open');
      position();
      requestAnimationFrame(function () { if (menu) menu.classList.add('is-in'); });
      setActive(select.selectedIndex, true);
      menu.focus({ preventScroll: true });
      openSelect = instance;

      menu.addEventListener('mousedown', function (e) { e.preventDefault(); });
      menu.addEventListener('click', function (e) {
        var item = e.target.closest('.ui-select-opt');
        if (item) choose(parseInt(item.getAttribute('data-i'), 10));
      });
      menu.addEventListener('mousemove', function (e) {
        var item = e.target.closest('.ui-select-opt');
        if (item) setActive(parseInt(item.getAttribute('data-i'), 10), false);
      });
      menu.addEventListener('keydown', onMenuKey);
    }

    function close(returnFocus) {
      if (!menu) return;
      var m = menu;
      menu = null;
      m.classList.remove('is-in');
      setTimeout(function () { m.remove(); }, reduceMotion ? 0 : 140);
      btn.setAttribute('aria-expanded', 'false');
      wrap.classList.remove('is-open');
      if (openSelect === instance) openSelect = null;
      if (returnFocus) btn.focus();
    }

    function onMenuKey(e) {
      var n = menu.querySelectorAll('.ui-select-opt').length;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
      else if (e.key === 'End') { e.preventDefault(); setActive(n - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'Tab') { close(false); }
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        typed += e.key.toLowerCase();
        clearTimeout(typedTimer);
        typedTimer = setTimeout(function () { typed = ''; }, 600);
        var list = opts();
        for (var k = 0; k < list.length; k++) {
          var idx = (active + 1 + k) % list.length;
          if (list[idx].textContent.toLowerCase().indexOf(typed) === 0) { setActive(idx); break; }
        }
      }
    }

    btn.addEventListener('click', function () { menu ? close(false) : open(); });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!menu) open(); }
    });
    // Clicking the field's <label> focuses the native select - hand that to the button.
    select.addEventListener('focus', function () { btn.focus(); });

    function destroy() { close(false); }
    select._ui = instance;
    sync();
    return instance;
  }

  function syncSelects() {
    Array.prototype.forEach.call(document.querySelectorAll('select.ui-select-native'), function (s) { if (s._ui) s._ui.sync(); });
  }
  document.addEventListener('mousedown', function (e) {
    if (openSelect && !e.target.closest('.ui-select-menu') && !e.target.closest('.ui-select')) closeOpenSelect(false);
  });
  window.addEventListener('resize', function () { closeOpenSelect(false); });
  window.addEventListener('scroll', function (e) {
    if (openSelect && !(e.target && e.target.closest && e.target.closest('.ui-select-menu'))) closeOpenSelect(false);
  }, true);

  // What js/resource-insights.js (views, downloads, likes for the person who
  // shared a resource) needs from this file.
  window.lacmsResourcesApi = {
    openDialog: openDialog, escapeHtml: escapeHtml, countUp: countUp, avatarHtml: avatarHtml, timeAgo: timeAgo,
    courses: COURSES,
    userId: function () { return userId; },
    getResource: function (id) { return rendered[id] || null; }
  };
  function insights() { return window.lacmsResourceInsights || null; }

  // ---- Boot -------------------------------------------------------------------
  var gate = $('auth-gate');
  function showLocked() {
    if (gate) gate.style.display = 'none';
    $('resources-locked').style.display = 'flex';
  }

  supabaseClient.auth.getSession().then(function (result) {
    session = result.data && result.data.session;
    if (!session) { window.location.href = 'member-login.html'; return; }
    userId = session.user.id;

    Promise.all([
      supabaseClient.rpc('is_dashboard_admin'),
      supabaseClient.rpc('get_my_hub_access')
    ]).then(function (res) {
      isAdmin = !res[0].error && res[0].data === true;
      var access = null;
      if (!res[1].error) {
        access = {};
        (res[1].data || []).forEach(function (r) { access[r.feature] = !!r.allowed; });
      }
      // If the Hub Access rules can't be read, fall back to the launch
      // rule: executives only.
      var allowed = access && access.resources !== undefined ? access.resources : isAdmin;
      if (!allowed && !isAdmin) { showLocked(); return; }
      start();
    }, showLocked);
  });

  function skeletonCards(n) {
    var out = '';
    for (var i = 0; i < n; i++) out += '<div class="res-skel res-skel-card" style="--i:' + i + '"></div>';
    return out;
  }

  function start() {
    if (gate) gate.style.display = 'none';
    appEl.style.display = '';
    $('res-course-chips').innerHTML = '<span class="res-skel res-skel-chip"></span><span class="res-skel res-skel-chip"></span><span class="res-skel res-skel-chip"></span><span class="res-skel res-skel-chip"></span>';
    buildFilterOptions();
    ['res-filter-type', 'res-filter-source', 'res-filter-year', 'res-sort'].forEach(function (id) { enhanceSelect($(id)); });
    wireEvents();
    // Whether to offer "Message them for the PIN" (needs the chat, migration 070).
    supabaseClient.rpc('chat_status').then(function (r) {
      var row = !r.error && (Array.isArray(r.data) ? r.data[0] : r.data);
      chatAvailable = !!(row && row.can_message);
    }, function () {});

    var prev = window.lacmsPreviousSeen || Promise.resolve(null);
    prev.then(function (ts) { prevSeen = ts; }).then(function () {
      return Promise.all([loadCounts(), loadNewCounts()]);
    }).then(function () {
      route();
    });
    window.addEventListener('hashchange', route);
  }

  function loadCounts() {
    return supabaseClient.rpc('get_resource_counts').then(function (r) {
      if (r.error) {
        console.error('Resources failed to load (has migration 065 been run?):', r.error.message);
        var err = $('hub-error');
        err.textContent = "Couldn't load LACMS Resources right now - try refreshing.";
        err.style.display = 'block';
        return;
      }
      counts = {};
      var pending = 0;
      (r.data || []).forEach(function (row) {
        if (row.course === '__all') { counts.__all = { approved: row.approved_count, pending: row.pending_count }; pending = row.pending_count; return; }
        counts[row.course] = { approved: row.approved_count, pending: row.pending_count };
      });
      var reviewLink = $('res-review-link');
      reviewLink.hidden = !isAdmin;
      var rc = $('res-review-count');
      rc.hidden = !(isAdmin && pending > 0);
      rc.textContent = pending;
    });
  }

  // Approved since the previous visit (not counting your own).
  function loadNewCounts() {
    newByCourse = {};
    newTotal = 0;
    if (!prevSeen) return Promise.resolve();
    return supabaseClient.from('resources').select('courses, approved_at, uploader_id').eq('status', 'approved').gt('approved_at', prevSeen).then(function (r) {
      (r.data || []).forEach(function (row) {
        if (row.uploader_id === userId) return;
        (row.courses || []).forEach(function (c) { newByCourse[c] = (newByCourse[c] || 0) + 1; });
        newTotal++;
      });
    }, function () { /* markers are a nicety */ });
  }
  function isNew(r) {
    return !!(prevSeen && r.status === 'approved' && r.approved_at && r.uploader_id !== userId && new Date(r.approved_at) > new Date(prevSeen));
  }

  // ---- Routing: everything in one place (optionally #c=<course>), #review, #mine ----
  var allItems = [];
  var loadedAll = false;
  var PAGE_SIZE = 18;
  var shown = PAGE_SIZE;

  function showView(view) {
    ['res-view-home', 'res-view-list'].forEach(function (id) {
      var node = $(id);
      var show = id === view;
      node.hidden = !show;
      if (show) { node.classList.remove('res-view-in'); void node.offsetWidth; node.classList.add('res-view-in'); }
    });
  }
  function route() {
    closeOpenSelect(false);
    var hash = decodeURIComponent((window.location.hash || '').replace(/^#/, ''));
    if (hash === 'review' && isAdmin) { showView('res-view-list'); openSpecial('review'); window.scrollTo({ top: 0 }); return; }
    if (hash === 'mine') { showView('res-view-list'); openSpecial('mine'); window.scrollTo({ top: 0 }); return; }
    var wanted = hash.indexOf('c=') === 0 ? hash.slice(2) : '';
    currentCourse = COURSES.some(function (c) { return c.name === wanted; }) ? wanted : '';
    showView('res-view-home');
    shown = PAGE_SIZE;
    renderChips();
    if (loadedAll) renderBrowse(); else loadAll();
  }
  function go(hash) { window.location.hash = hash; if (!hash) route(); }
  function setCourse(name) {
    var target = name ? 'c=' + encodeURIComponent(name) : '';
    if (decodeURIComponent((window.location.hash || '').replace(/^#/, '')) === (name ? 'c=' + name : '')) return;
    window.location.hash = target;
    if (!name) route();
  }

  // ---- Course filter chips (with counts and "new" dots) ----------------------------
  function renderChips() {
    var wrap = $('res-course-chips');
    wrap.setAttribute('aria-busy', 'false');
    var total = (counts.__all || { approved: 0 }).approved;
    function chip(name, label, count, fresh, iconKey) {
      var active = (name || '') === (currentCourse || '');
      return '<button type="button" class="res-chip' + (active ? ' is-active' : '') + '" data-chip="' + escapeHtml(name) + '" aria-pressed="' + active + '">' +
        (iconKey ? '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[iconKey] + '</svg>' : '') +
        '<span class="res-chip-label">' + escapeHtml(label) + '</span>' +
        '<span class="res-chip-count">' + count + '</span>' +
        (fresh ? '<span class="res-chip-new" title="' + fresh + ' new" aria-label="' + fresh + ' new"></span>' : '') +
        '</button>';
    }
    wrap.innerHTML = chip('', 'All courses', total, newTotal, null) + COURSES.map(function (c) {
      return chip(c.name, c.label || c.name, (counts[c.name] || { approved: 0 }).approved, newByCourse[c.name] || 0, c.name);
    }).join('');
    // On a phone the chip strip scrolls sideways - keep the chosen one in view.
    var activeChip = wrap.querySelector('.is-active');
    if (activeChip && wrap.scrollWidth > wrap.clientWidth) {
      wrap.scrollTo({ left: activeChip.offsetLeft - (wrap.clientWidth - activeChip.offsetWidth) / 2, behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  }

  // ---- Filters ------------------------------------------------------------------
  function buildFilterOptions() {
    $('res-filter-type').innerHTML = '<option value="">All types</option>' + Object.keys(TYPES).map(function (k) { return '<option value="' + k + '">' + TYPES[k] + '</option>'; }).join('');
    $('res-filter-year').innerHTML = '<option value="">All years</option>' + YEARS.map(function (y) { return '<option>' + y + '</option>'; }).join('');
  }
  function resetFilters() {
    $('res-search').value = '';
    $('res-filter-type').value = '';
    $('res-filter-source').value = '';
    $('res-filter-year').value = '';
    $('res-sort').value = 'new';
    syncSelects();
  }

  // ---- The one list -----------------------------------------------------------------
  function loadAll() {
    $('res-browse-list').innerHTML = skeletonCards(3);
    $('res-browse-empty').hidden = true;
    $('res-more-wrap').hidden = true;
    selectResources(function (q) { return q.eq('status', 'approved').order('approved_at', { ascending: false }).limit(500); }).then(function (r) {
      if (r.error) {
        $('res-all-sub').textContent = "Couldn't load the resources: " + r.error.message;
        $('res-browse-list').innerHTML = '';
        return;
      }
      allItems = r.data || [];
      loadedAll = true;
      renderBrowse();
      // Counts for every resource (not just the visible page) so "Most
      // popular" can rank the whole list; re-sort once they arrive.
      loadEngagement(allItems).then(function () {
        if ($('res-sort').value === 'pop' && !$('res-view-home').hidden) renderBrowse();
      });
    });
  }

  function renderBrowse() {
    var q = $('res-search').value.trim().toLowerCase();
    var type = $('res-filter-type').value;
    var source = $('res-filter-source').value;
    var year = $('res-filter-year').value;
    var sort = $('res-sort').value;
    $('res-search-clear').hidden = !q;

    var inCourse = allItems.filter(function (r) { return !currentCourse || coursesOf(r).indexOf(currentCourse) !== -1; });
    var rows = inCourse.filter(function (r) {
      if (type && r.resource_type !== type) return false;
      if (source && r.source_type !== source) return false;
      // A resource with no years listed is for any year, so it matches too.
      if (year && yearsOf(r).length && yearsOf(r).indexOf(year) === -1) return false;
      if (q && [r.title, r.topic, r.uploader_name, r.description, coursesLabel(r)].join(' ').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    rows.sort(function (a, b) {
      if (sort === 'az') return a.title.localeCompare(b.title);
      var da = new Date(a.approved_at || a.created_at).getTime();
      var db = new Date(b.approved_at || b.created_at).getTime();
      if (sort === 'pop') {
        var diff = popularity(b) - popularity(a);
        return diff !== 0 ? diff : db - da; // ties: newest first
      }
      return sort === 'old' ? da - db : db - da;
    });

    var filtered = !!(q || type || source || year);
    $('res-active-filters').hidden = !(filtered || currentCourse);
    if (filtered || currentCourse) {
      $('res-active-text').textContent = 'Showing ' + rows.length + ' of ' + allItems.length + (currentCourse ? ' · ' + courseLabel(currentCourse) : '');
    }

    var freshHere = inCourse.filter(isNew).length;
    $('res-all-sub').textContent = (currentCourse ? courseLabel(currentCourse) + ': ' : '') + inCourse.length + (inCourse.length === 1 ? ' resource' : ' resources') + (freshHere ? ' · ' + freshHere + ' new since your last visit' : '');

    var banner = $('res-whatsnew');
    if (newTotal > 0) {
      banner.hidden = false;
      $('res-whatsnew-text').textContent = newTotal + (newTotal === 1 ? ' new resource' : ' new resources') + ' since your last visit.';
      $('res-whatsnew-jump').textContent = 'See what\'s new';
    } else banner.hidden = true;

    var slice = rows.slice(0, shown);
    renderCards($('res-browse-list'), slice, { mode: 'all' });

    var more = rows.length - slice.length;
    $('res-more-wrap').hidden = more <= 0;
    if (more > 0) $('res-load-more').textContent = 'Show ' + Math.min(PAGE_SIZE, more) + ' more (' + more + ' left)';

    var empty = $('res-browse-empty');
    if (rows.length) { empty.hidden = true; return; }
    empty.hidden = false;
    var narrowed = filtered || currentCourse;
    empty.innerHTML = emptyState(
      allItems.length ? 'No matches' : 'No resources yet',
      allItems.length ? 'Nothing fits those filters - try loosening them.' : 'Be the first to share one.',
      narrowed && allItems.length
        ? '<button type="button" class="btn btn-outline" data-res-clear>Clear filters</button>'
        : '<button type="button" class="btn btn-primary" data-res-share>Share a resource</button>'
    );
  }

  function emptyState(title, text, action) {
    return '<div class="res-empty-card"><span class="res-empty-icon"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></span>' +
      '<strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(text) + '</span>' + (action || '') + '</div>';
  }

  // ---- My submissions / Review queue ---------------------------------------------------
  function openSpecial(kind) {
    var isReview = kind === 'review';
    $('res-crumb-current').textContent = isReview ? 'Review queue' : 'My submissions';
    $('res-list-title').textContent = isReview ? 'Review queue' : 'My submissions';
    $('res-list-sub').textContent = 'Loading…';
    var impact = $('res-insights-summary');
    if (impact) { impact.hidden = true; impact.innerHTML = ''; }
    $('res-list').innerHTML = skeletonCards(2);
    $('res-empty').hidden = true;
    selectResources(function (q) {
      return isReview ? q.eq('status', 'pending').order('created_at', { ascending: true }) : q.eq('uploader_id', userId).order('created_at', { ascending: false });
    }).then(function (r) {
      if (r.error) { $('res-list-sub').textContent = "Couldn't load: " + r.error.message; $('res-list').innerHTML = ''; return; }
      var rows = r.data || [];
      $('res-list-sub').textContent = isReview
        ? (rows.length ? rows.length + ' waiting for review. Nothing here is visible to members until you approve it.' : '')
        : 'Everything you\'ve shared. New or edited resources are reviewed by the executive committee before they appear.';
      renderCards($('res-list'), rows, { mode: isReview ? 'review' : 'mine' });
      if (!isReview && insights()) insights().loadMine(rows);
      var empty = $('res-empty');
      empty.hidden = rows.length > 0;
      if (!rows.length) {
        empty.innerHTML = isReview
          ? emptyState('All caught up', 'Nothing is waiting for review right now.', '')
          : emptyState('Nothing shared yet', 'Share a note, past paper or useful link and it will show up here.', '<button type="button" class="btn btn-primary" data-res-share>Share a resource</button>');
      }
      var mc = $('res-mine-count');
      if (!isReview) { mc.hidden = !rows.length; mc.textContent = rows.length; }
    });
  }

  // ---- Cards ---------------------------------------------------------------------
  var FILE_ICON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  var LINK_ICON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

  function thumbHtml(r) {
    if (isLockedOut(r)) return '<span class="res-thumb-lock">' + LOCK_ICON + '<span>PIN protected</span></span>';
    var ext = extOf(r.file_name);
    if (r.preview_path && cachedUrl(r.preview_path)) return '<img src="' + escapeHtml(cachedUrl(r.preview_path)) + '" alt="" loading="lazy">';
    if (r.kind === 'file' && IMAGE_EXTS.indexOf(ext) !== -1 && cachedUrl(r.file_path)) return '<img src="' + escapeHtml(cachedUrl(r.file_path)) + '" alt="" loading="lazy">';
    if (r.kind === 'link') {
      var u = parseHttpUrl(r.url);
      var yt = youtubeId(u);
      if (yt) return '<img src="https://i.ytimg.com/vi/' + yt + '/hqdefault.jpg" alt="" loading="lazy" referrerpolicy="no-referrer"><span class="res-thumb-play" aria-hidden="true"></span>';
      if (u) return '<span class="res-thumb-fav"><img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(u.hostname) + '&sz=64" alt="" width="32" height="32" loading="lazy" referrerpolicy="no-referrer"><span>' + escapeHtml(u.hostname.replace(/^www\./, '')) + '</span></span>';
      return '<span class="res-thumb-icon">' + LINK_ICON + '</span>';
    }
    return '<span class="res-thumb-icon">' + FILE_ICON + '<span class="res-thumb-ext">' + escapeHtml((ext || 'file').toUpperCase()) + '</span></span>';
  }

  // Up to two course badges, then "+N" (full list on hover).
  function courseBadges(r) {
    var list = coursesOf(r);
    var shown = list.slice(0, 2).map(function (c) { return '<span class="res-badge res-badge--course">' + escapeHtml(courseLabel(c)) + '</span>'; }).join('');
    if (list.length > 2) shown += '<span class="res-badge res-badge--course" title="' + escapeHtml(coursesLabel(r)) + '">+' + (list.length - 2) + '</span>';
    return shown;
  }

  function lockBadge(r) {
    if (!r.is_locked) return '';
    return isLockedOut(r)
      ? '<span class="res-badge res-badge--locked" title="Needs a PIN to open">' + LOCK_ICON + 'PIN protected</span>'
      : '<span class="res-badge res-badge--locked is-open" title="PIN protected - you have access">' + UNLOCK_ICON + 'PIN protected</span>';
  }

  function statusBadge(r) {
    if (r.status === 'pending') return '<span class="res-badge res-badge--pending">Pending review</span>';
    if (r.status === 'rejected') return '<span class="res-badge res-badge--rejected">Not approved</span>';
    return '';
  }

  function cardHtml(r, mode, index) {
    var domain = '';
    if (r.kind === 'link') { var u = parseHttpUrl(r.url); domain = u ? u.hostname.replace(/^www\./, '') : ''; }
    var locked = isLockedOut(r);
    var details = [];
    if (r.source_type === 'external') details.push('Source: ' + escapeHtml(r.source_credit || (domain || 'external')));
    if (r.topic) details.push('Topic: ' + escapeHtml(r.topic));
    if (r.kind === 'file' && r.file_name && !locked) details.push(escapeHtml(r.file_name) + (r.file_size ? ' (' + formatBytes(r.file_size) + ')' : ''));
    else if (domain) details.push(escapeHtml(domain));

    var openLabel = r.kind === 'link' ? 'Open link' : 'Download';
    var actions = '<button type="button" class="btn btn-outline res-btn" data-res-preview>Preview</button>' +
      (locked
        ? '<button type="button" class="btn btn-primary res-btn res-btn--unlock" data-res-unlock>' + LOCK_ICON + 'Unlock</button>'
        : '<button type="button" class="btn btn-primary res-btn" data-res-open>' + openLabel + '</button>');
    if (mode === 'review') {
      actions = '<button type="button" class="btn btn-outline res-btn" data-res-preview>Preview</button>' +
        '<button type="button" class="btn btn-primary res-btn" data-res-approve>Approve</button>' +
        '<button type="button" class="btn btn-outline res-btn res-btn--danger" data-res-reject>Reject…</button>';
    } else if (mode === 'mine') {
      if (r.status === 'approved') actions += '<button type="button" class="btn btn-outline res-btn res-btn--insights" data-ins-open="' + escapeHtml(r.id) + '">Insights</button>';
      actions += '<button type="button" class="btn btn-outline res-btn" data-res-edit>Edit</button>' +
        '<button type="button" class="btn btn-outline res-btn res-btn--danger" data-res-delete>Delete</button>';
    } else if (isAdmin || r.uploader_id === userId) {
      if (r.uploader_id === userId && r.status === 'approved') actions += '<button type="button" class="btn btn-outline res-btn res-btn--insights" data-ins-open="' + escapeHtml(r.id) + '">Insights</button>';
      actions += '<button type="button" class="btn btn-outline res-btn res-btn--danger" data-res-delete>Remove</button>';
    }

    var reject = mode === 'mine' && r.status === 'rejected' && r.reject_reason
      ? '<p class="res-reject">Reason: ' + escapeHtml(r.reject_reason) + '</p>' : '';
    var long = (r.description || '').length > 170;

    return '<article class="res-card res-card--open res-anim-in' + (isNew(r) ? ' is-new' : '') + '" style="--i:' + Math.min(index, 10) + '" data-id="' + escapeHtml(r.id) + '">' +
      '<div class="res-thumb is-loading">' + thumbHtml(r) + '</div>' +
      '<div class="res-body">' +
      '<div class="res-tags">' + (isNew(r) ? '<span class="res-new-pill"><span class="res-new-dot" aria-hidden="true"></span>New</span>' : '') +
      '<span class="res-badge">' + escapeHtml(TYPES[r.resource_type] || 'Other') + '</span>' +
      '<span class="res-badge res-badge--' + r.source_type + '">' + (r.source_type === 'personal' ? 'Personal' : 'External') + '</span>' +
      (yearsOf(r).length ? '<span class="res-badge" title="' + escapeHtml(yearsOf(r).join(', ')) + '">' + escapeHtml(yearsLabel(yearsOf(r))) + '</span>' : '') +
      courseBadges(r) +
      lockBadge(r) +
      statusBadge(r) + '</div>' +
      '<h3 class="res-title"><button type="button" class="res-title-btn" data-res-preview>' + escapeHtml(r.title) + '</button></h3>' +
      bylineHtml(r, 'md') +
      '<p class="res-desc" id="rd-' + escapeHtml(r.id) + '">' + escapeHtml(r.description) + '</p>' +
      (long ? '<button type="button" class="res-more" data-res-more aria-expanded="false" aria-controls="rd-' + escapeHtml(r.id) + '">Read more</button>' : '') +
      (details.length ? '<p class="res-meta res-meta--faint">' + details.join(' · ') + '</p>' : '') +
      (mode === 'mine' && r.status === 'approved' ? '<div class="res-metrics" data-metrics="' + escapeHtml(r.id) + '" aria-label="How it\'s doing"></div>' : '') +
      reject +
      '<div class="res-card-foot">' + (r.status === 'approved' ? socialHtml(r.id) : '<span></span>') +
      '<div class="res-actions">' + actions + '</div></div>' +
      '</div>' +
      '<svg class="icon res-card-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>' +
      '</article>';
  }


  // ---- Who shared it: an avatar with their initial + a prominent name ----
  function initialOf(name) { return (String(name || '?').trim().charAt(0) || '?').toUpperCase(); }
  function avClass(name) {
    var h = 0;
    var str = String(name || '');
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return 'res-av-' + (h % 6);
  }
  function avatarHtml(name, size) {
    return '<span class="res-av res-av--' + (size || 'md') + ' ' + avClass(name) + '" aria-hidden="true">' + escapeHtml(initialOf(name)) + '</span>';
  }
  function bylineHtml(r, size) {
    var when = timeAgo(r.status === 'approved' && r.approved_at ? r.approved_at : r.created_at);
    var detail = [r.uploader_detail, when].filter(Boolean).join(' · ');
    return '<div class="res-by res-by--' + (size || 'md') + '">' + avatarHtml(r.uploader_name, size) +
      '<span class="res-by-text"><strong class="res-by-name">' + escapeHtml(r.uploader_name) + '</strong>' +
      '<span class="res-by-detail">' + escapeHtml(detail) + '</span></span></div>';
  }

  // ---- Likes / comments: counts live here and are painted into every
  // place that shows them (the card and, if open, its preview). ----------
  var engagement = {}; // resource id -> { likes, comments, liked }
  var HEART = '<svg class="icon res-heart" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
  var BUBBLE = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  function engOf(id) { return engagement[id] || { likes: 0, comments: 0, liked: false }; }

  function socialHtml(id) {
    var e = engOf(id);
    return '<div class="res-social" data-social="' + escapeHtml(id) + '">' +
      '<button type="button" class="res-like' + (e.liked ? ' is-liked' : '') + '" data-res-like aria-pressed="' + (e.liked ? 'true' : 'false') + '" aria-label="Like this resource" title="Like - the person who shared it can see who liked it">' +
      '<span class="res-like-icon">' + HEART + '<span class="res-burst" aria-hidden="true"></span></span><span class="res-like-count" data-like-count>' + e.likes + '</span></button>' +
      '<button type="button" class="res-comment-btn" data-res-comments aria-label="View and add comments">' + BUBBLE + '<span data-comment-count>' + e.comments + '</span></button></div>';
  }

  function paintSocial(id, animateLike) {
    var e = engOf(id);
    Array.prototype.forEach.call(document.querySelectorAll('[data-social="' + id + '"]'), function (box) {
      var like = box.querySelector('[data-res-like]');
      var wasLiked = like.classList.contains('is-liked');
      like.classList.toggle('is-liked', e.liked);
      like.setAttribute('aria-pressed', e.liked ? 'true' : 'false');
      box.querySelector('[data-like-count]').textContent = e.likes;
      box.querySelector('[data-comment-count]').textContent = e.comments;
      if (animateLike && e.liked && !wasLiked && !reduceMotion) {
        like.classList.remove('is-popping'); void like.offsetWidth; like.classList.add('is-popping');
      }
    });
  }

  function loadEngagement(rows) {
    var ids = rows.filter(function (r) { return r.status === 'approved'; }).map(function (r) { return r.id; });
    if (!ids.length) return Promise.resolve();
    var chunks = [];
    for (var i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
    return Promise.all(chunks.map(function (chunk) {
      return supabaseClient.rpc('get_resource_engagement', { p_ids: chunk }).then(function (res) {
        if (res.error) { console.warn('Likes/comments unavailable (has migration 066 been run?):', res.error.message); return; }
        (res.data || []).forEach(function (row) {
          engagement[row.resource_id] = { likes: row.like_count, comments: row.comment_count, liked: !!row.liked_by_me };
          paintSocial(row.resource_id, false);
        });
      }, function () { /* engagement is a nicety */ });
    }));
  }
  // "Popular" = likes + comments (a comment is a stronger signal than a like).
  function popularity(r) { var e = engOf(r.id); return e.likes + e.comments * 2; }

  function toggleLike(id) {
    var e = engOf(id);
    var liked = !e.liked;
    engagement[id] = { likes: Math.max(0, e.likes + (liked ? 1 : -1)), comments: e.comments, liked: liked };
    paintSocial(id, true);
    var req = liked
      ? supabaseClient.from('resource_likes').insert({ resource_id: id })
      : supabaseClient.from('resource_likes').delete().eq('resource_id', id).eq('user_id', userId);
    req.then(function (res) {
      // 23505 = already liked in another tab; the end state is what we wanted.
      if (res.error && res.error.code !== '23505') {
        engagement[id] = e;
        paintSocial(id, false);
        showToast("Couldn't update your like: " + res.error.message, true);
      }
    });
  }

  // ---- Comments (inside the preview dialog) ----
  function commentHtml(c) {
    var mine = c.author_id === userId;
    return '<li class="res-comment" data-comment="' + escapeHtml(c.id) + '">' + avatarHtml(c.author_name, 'sm') +
      '<div class="res-comment-body"><div class="res-comment-head"><strong>' + escapeHtml(c.author_name) + '</strong>' +
      '<span>' + escapeHtml(timeAgo(c.created_at)) + '</span>' +
      ((mine || isAdmin) ? '<button type="button" class="res-comment-del" data-comment-del aria-label="Delete comment">Delete</button>' : '') + '</div>' +
      '<p>' + escapeHtml(c.body) + '</p></div></li>';
  }

  function wireComments(dlg, r, focusComments) {
    var d = dlg.dialog;
    var list = d.querySelector('#pv-comments');
    var form = d.querySelector('#pv-comment-form');
    var input = d.querySelector('#pv-comment-input');
    var count = d.querySelector('#pv-comments-title');
    var comments = [];

    function paint() {
      list.innerHTML = comments.length ? comments.map(commentHtml).join('') : '<li class="res-comments-empty">No comments yet - start the conversation.</li>';
      count.textContent = 'Comments' + (comments.length ? ' (' + comments.length + ')' : '');
      var e = engOf(r.id);
      engagement[r.id] = { likes: e.likes, comments: comments.length, liked: e.liked };
      paintSocial(r.id, false);
    }

    supabaseClient.from('resource_comments').select('*').eq('resource_id', r.id).order('created_at', { ascending: true }).then(function (res) {
      if (res.error) { list.innerHTML = '<li class="res-comments-empty">Couldn\'t load comments - they may not be switched on yet.</li>'; form.hidden = true; return; }
      comments = res.data || [];
      paint();
      if (focusComments) {
        d.querySelector('.res-comments').scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
        input.focus({ preventScroll: true });
      }
    });

    input.addEventListener('input', function () {
      d.querySelector('#pv-comment-count').textContent = input.value.length + ' / 1000';
    });
    input.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); }
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = input.value.trim();
      if (!body) { input.focus(); return; }
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      supabaseClient.from('resource_comments').insert({ resource_id: r.id, body: body }).select().single().then(function (res) {
        btn.disabled = false;
        if (res.error || !res.data) { showToast("Couldn't post your comment: " + ((res.error && res.error.message) || 'try again'), true); return; }
        comments.push(res.data);
        input.value = '';
        d.querySelector('#pv-comment-count').textContent = '0 / 1000';
        paint();
        var item = list.lastElementChild;
        if (item) { item.classList.add('is-fresh'); item.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' }); }
      });
    });
    list.addEventListener('click', function (e) {
      var del = e.target.closest('[data-comment-del]');
      if (!del) return;
      var item = del.closest('[data-comment]');
      var cid = item.getAttribute('data-comment');
      if (!window.confirm('Delete this comment?')) return;
      supabaseClient.from('resource_comments').delete().eq('id', cid).then(function (res) {
        if (res.error) { showToast("Couldn't delete that: " + res.error.message, true); return; }
        item.classList.add('is-leaving');
        setTimeout(function () { comments = comments.filter(function (c) { return c.id !== cid; }); paint(); }, reduceMotion ? 0 : 220);
      });
    });
  }

  var press = null; // pointer-down state for the card being pressed: { card, x, y, moved }
  var rendered = {};
  function renderCards(container, rows, opts) {
    rows.forEach(function (r) { rendered[r.id] = r; });
    var paths = [];
    rows.forEach(function (r) {
      if (isLockedOut(r)) return;
      if (r.preview_path) paths.push(r.preview_path);
      else if (r.kind === 'file' && IMAGE_EXTS.indexOf(extOf(r.file_name)) !== -1) paths.push(r.file_path);
    });
    // Signed thumbnails first so images are in the first paint.
    signedUrls(paths).then(function () {
      container.innerHTML = rows.map(function (r, i) { return cardHtml(r, opts.mode, i); }).join('');
      container.setAttribute('data-mode', opts.mode);
      if (opts.mode === 'mine' && insights()) insights().paint();
      // Thumbnails that never need a network fetch are done immediately.
      Array.prototype.forEach.call(container.querySelectorAll('.res-thumb'), function (t) {
        if (!t.querySelector('img')) t.classList.remove('is-loading');
      });
      loadEngagement(rows);
    });
  }
  // Fade thumbnails in as they load (load/error don't bubble, so capture).
  document.addEventListener('load', function (e) {
    var t = e.target && e.target.closest && e.target.closest('.res-thumb');
    if (t) t.classList.remove('is-loading');
  }, true);
  document.addEventListener('error', function (e) {
    var t = e.target && e.target.closest && e.target.closest('.res-thumb');
    if (t) { t.classList.remove('is-loading'); if (e.target.tagName === 'IMG') e.target.style.display = 'none'; }
  }, true);

  // ---- Dialog plumbing -----------------------------------------------------------
  function openDialog(innerHtml, extraClass, fromEl) {
    var previouslyFocused = document.activeElement;
    var backdrop = document.createElement('div');
    backdrop.className = 'guide-backdrop';
    var dialog = document.createElement('div');
    dialog.className = 'guide-dialog res-dialog' + (extraClass ? ' ' + extraClass : '');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = innerHtml;
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    document.body.classList.add('guide-open');
    // Grow out of the card that was clicked: aim the scale-in at it.
    if (fromEl && !reduceMotion) {
      var fr = fromEl.getBoundingClientRect();
      requestAnimationFrame(function () {
        var dr = dialog.getBoundingClientRect();
        var ox = Math.max(0, Math.min(100, ((fr.left + fr.width / 2 - dr.left) / dr.width) * 100));
        var oy = Math.max(0, Math.min(100, ((fr.top + fr.height / 2 - dr.top) / dr.height) * 100));
        dialog.style.transformOrigin = ox + '% ' + oy + '%';
        dialog.classList.add('is-grow');
      });
    }
    requestAnimationFrame(function () {
      backdrop.classList.add('is-in');
      var first = dialog.querySelector('[data-autofocus]') || dialog.querySelector('input, textarea, .ui-select-btn, .res-like, button');
      if (first && !(extraClass || '').match(/preview/)) first.focus();
      else dialog.querySelector('.guide-close').focus();
    });
    var api = { dialog: dialog };
    function close() {
      closeOpenSelect(false);
      document.removeEventListener('keydown', onKey, true);
      backdrop.classList.remove('is-in');
      document.body.classList.remove('guide-open');
      setTimeout(function () { backdrop.remove(); }, 200);
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
    }
    function onKey(e) {
      // An open dropdown handles its own Escape/Tab first.
      if (openSelect) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;
      var focusable = dialog.querySelectorAll('button:not([disabled]), input:not([disabled]):not([aria-hidden="true"]), select:not([disabled]):not([aria-hidden="true"]), textarea:not([disabled]), a[href], iframe');
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey, true);
    dialog.addEventListener('click', function (e) { if (e.target.closest('[data-dialog-close]')) close(); });
    backdrop.addEventListener('mousedown', function (e) { if (e.target === backdrop) close(); });
    api.close = close;
    return api;
  }


  // =======================================================================
  // PDF preview: rendered with PDF.js onto canvases at the container's full
  // width (so a whole page is visible side to side on a phone - the
  // browsers' own embedded viewers start zoomed in on mobile). Pages render
  // lazily as they scroll into view; +/- zoom and "fit width" are provided.
  // Falls back to the browser's embedded viewer if PDF.js can't load.
  // =======================================================================
  var PDFJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (loadPdfJs.p) return loadPdfJs.p;
    loadPdfJs.p = new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = PDFJS_BASE + 'pdf.min.js';
      sc.onload = function () {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      sc.onerror = function () { loadPdfJs.p = null; reject(new Error('PDF.js failed to load')); };
      document.head.appendChild(sc);
    });
    return loadPdfJs.p;
  }

  function renderPdf(slot, url, r) {
    slot.classList.remove('res-embed--loading');
    slot.classList.add('res-embed--pdf');
    slot.innerHTML =
      '<div class="res-pdf-bar"><span class="res-pdf-pages" aria-live="polite">Loading…</span>' +
      '<span class="res-pdf-zoom"><button type="button" data-pdf-out aria-label="Zoom out">&minus;</button>' +
      '<button type="button" data-pdf-fit aria-label="Fit page width">Fit</button>' +
      '<button type="button" data-pdf-in aria-label="Zoom in">+</button></span></div>' +
      '<div class="res-pdf" tabindex="0" aria-label="PDF preview of ' + escapeHtml(r.title) + '"></div>';
    var box = slot.querySelector('.res-pdf');
    var pagesLabel = slot.querySelector('.res-pdf-pages');
    var zoom = 1;
    var pdfDoc = null;
    var wrappers = [];
    var io = null;

    function fallback() {
      slot.classList.remove('res-embed--pdf');
      slot.innerHTML = '<iframe src="' + escapeHtml(url) + '" title="' + escapeHtml(r.title) + '" loading="lazy"></iframe>';
    }

    function pageWidth() { return Math.max(160, box.clientWidth - 16); }

    function sizeWrappers(ratio) {
      var w = pageWidth() * zoom;
      wrappers.forEach(function (wr) {
        var rt = wr._ratio || ratio;
        wr.style.width = w + 'px';
        wr.style.height = Math.round(w * rt) + 'px';
        wr._rendered = false;
      });
    }

    function renderPage(wr) {
      if (wr._rendered || wr._busy || !pdfDoc) return;
      wr._busy = true;
      pdfDoc.getPage(wr._n).then(function (page) {
        var base = page.getViewport({ scale: 1 });
        wr._ratio = base.height / base.width;
        var cssW = pageWidth() * zoom;
        var scale = cssW / base.width;
        var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        var vp = page.getViewport({ scale: scale * dpr });
        var canvas = document.createElement('canvas');
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.style.width = Math.round(cssW) + 'px';
        canvas.style.height = Math.round(cssW * wr._ratio) + 'px';
        wr.style.width = Math.round(cssW) + 'px';
        wr.style.height = Math.round(cssW * wr._ratio) + 'px';
        return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise.then(function () {
          wr.innerHTML = '';
          wr.appendChild(canvas);
          wr._rendered = true;
          wr._busy = false;
        });
      }).catch(function () { wr._busy = false; });
    }

    // Which pages are on screen is worked out from where they are in the
    // window, so it works whether the PDF area scrolls itself (desktop) or
    // just flows inside the pop-up, which scrolls as a whole (phones).
    var dlgEl = slot.closest('.guide-dialog');
    function renderVisible() {
      var vh = window.innerHeight || 800;
      wrappers.forEach(function (wr) {
        var rect = wr.getBoundingClientRect();
        if (rect.bottom > -400 && rect.top < vh + 400) renderPage(wr);
      });
    }

    function updateLabel() {
      var current = 1;
      var probe = Math.max(box.getBoundingClientRect().top, dlgEl ? dlgEl.getBoundingClientRect().top : 0) + 40;
      for (var i = 0; i < wrappers.length; i++) {
        current = i + 1;
        if (wrappers[i].getBoundingClientRect().bottom > probe) break;
      }
      pagesLabel.textContent = 'Page ' + current + ' of ' + wrappers.length;
    }

    function setZoom(z) {
      var next = Math.max(0.6, Math.min(3, z));
      if (next === zoom) return;
      // Keep the same spot in the document in view while resizing.
      var progress = box.scrollHeight ? box.scrollTop / box.scrollHeight : 0;
      zoom = next;
      sizeWrappers();
      box.scrollTop = progress * box.scrollHeight;
      renderVisible();
      updateLabel();
    }

    slot.querySelector('[data-pdf-in]').addEventListener('click', function () { setZoom(zoom + 0.25); });
    slot.querySelector('[data-pdf-out]').addEventListener('click', function () { setZoom(zoom - 0.25); });
    slot.querySelector('[data-pdf-fit]').addEventListener('click', function () { setZoom(1); });
    box.addEventListener('scroll', function () { renderVisible(); updateLabel(); }, { passive: true });
    if (dlgEl) dlgEl.addEventListener('scroll', function () { renderVisible(); updateLabel(); }, { passive: true });
    var resizeTimer = null;
    window.addEventListener('resize', function onResize() {
      if (!document.body.contains(box)) { window.removeEventListener('resize', onResize); return; }
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { sizeWrappers(); renderVisible(); }, 150);
    });

    loadPdfJs().then(function (lib) {
      return lib.getDocument({ url: url }).promise;
    }).then(function (pdf) {
      pdfDoc = pdf;
      return pdf.getPage(1).then(function (first) {
        var base = first.getViewport({ scale: 1 });
        var ratio = base.height / base.width;
        for (var n = 1; n <= pdf.numPages; n++) {
          var wr = document.createElement('div');
          wr.className = 'res-pdf-page';
          wr._n = n;
          wr._ratio = ratio;
          wr.setAttribute('aria-label', 'Page ' + n);
          box.appendChild(wr);
          wrappers.push(wr);
        }
        sizeWrappers(ratio);
        renderVisible();
        updateLabel();
      });
    }).catch(fallback);
  }

  // ---- Unlocking with a PIN ---------------------------------------------------------
  function uploaderFirst(r) { return String(r.uploader_name || 'the person who shared it').trim().split(/\s+/)[0]; }

  function pinPanelHtml(r) {
    var who = escapeHtml(r.uploader_name || 'the person who shared it');
    var canAsk = chatAvailable && r.uploader_id && r.uploader_id !== userId;
    return '<div class="res-pin">' +
      '<span class="res-pin-icon" aria-hidden="true">' + LOCK_ICON + '<span class="res-pin-tick">&#10003;</span></span>' +
      '<h3 class="res-pin-title">Enter the PIN</h3>' +
      '<p class="res-pin-text">' + who + ' locked this resource. Ask them for the PIN if you don\'t have it yet.</p>' +
      '<form class="res-pin-form" novalidate>' +
        '<label class="visually-hidden" for="pin-input-' + escapeHtml(r.id) + '">PIN</label>' +
        '<div class="res-pin-field"><input type="password" id="pin-input-' + escapeHtml(r.id) + '" class="res-pin-input" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="8" placeholder="Enter PIN" data-autofocus>' +
        '<button type="button" class="res-pin-eye" aria-label="Show PIN" aria-pressed="false"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg></button></div>' +
        '<p class="res-pin-error" role="alert" hidden></p>' +
        '<button type="submit" class="btn btn-primary btn-block res-pin-submit">Unlock</button>' +
      '</form>' +
      (canAsk
        ? '<div class="res-pin-ask"><span class="res-pin-or"><span>or</span></span><button type="button" class="btn btn-outline btn-block" data-pin-ask>Message ' + escapeHtml(uploaderFirst(r)) + ' for the PIN</button></div>'
        : '<p class="res-pin-fine">Find ' + who + (r.uploader_detail ? ' (' + escapeHtml(r.uploader_detail) + ')' : '') + ' in the <a href="member-network.html">Network</a> to ask for it.</p>') +
      '</div>';
  }

  function wirePinPanel(panel, r, done) {
    var form = panel.querySelector('.res-pin-form');
    var input = panel.querySelector('.res-pin-input');
    var err = panel.querySelector('.res-pin-error');
    var submit = panel.querySelector('.res-pin-submit');
    var eye = panel.querySelector('.res-pin-eye');
    var ask = panel.querySelector('[data-pin-ask]');
    var timer = null;

    function setError(message, shake) {
      err.textContent = message || '';
      err.hidden = !message;
      if (shake && !reduceMotion) { panel.classList.remove('is-shake'); void panel.offsetWidth; panel.classList.add('is-shake'); }
    }
    function lockout(seconds) {
      clearInterval(timer);
      var until = Date.now() + seconds * 1000;
      input.disabled = true; submit.disabled = true;
      function tick() {
        if (!document.body.contains(panel)) { clearInterval(timer); return; }
        var left = Math.ceil((until - Date.now()) / 1000);
        if (left <= 0) {
          clearInterval(timer);
          input.disabled = false; submit.disabled = false;
          setError('');
          input.focus();
          return;
        }
        setError('Too many wrong tries. You can try again in ' + Math.floor(left / 60) + ':' + ('0' + (left % 60)).slice(-2) + '.');
      }
      tick();
      timer = setInterval(tick, 1000);
    }

    input.addEventListener('input', function () {
      var clean = input.value.replace(/\D/g, '').slice(0, 8);
      if (clean !== input.value) input.value = clean;
      setError('');
    });
    eye.addEventListener('click', function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      eye.setAttribute('aria-pressed', show ? 'true' : 'false');
      eye.setAttribute('aria-label', show ? 'Hide PIN' : 'Show PIN');
      input.focus();
    });
    if (ask) {
      ask.addEventListener('click', function () {
        var draft = 'Hi ' + uploaderFirst(r) + ', could I please have the PIN for your resource "' + r.title + '" on LACMS Resources? Thank you!';
        window.location.href = 'member-network.html?message=' + encodeURIComponent(r.uploader_id) + '&draft=' + encodeURIComponent(draft) + '#messages';
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var pin = input.value.trim();
      if (pin.length < 4) { setError('Enter the PIN - it\'s 4 to 8 digits.', true); input.focus(); return; }
      submit.disabled = true; submit.classList.add('is-busy');
      supabaseClient.rpc('resource_unlock', { p_id: r.id, p_pin: pin }).then(function (res) {
        submit.classList.remove('is-busy');
        if (res.error) { submit.disabled = false; setError(res.error.message || 'Something went wrong - try again.', true); return; }
        var row = Array.isArray(res.data) ? res.data[0] : res.data;
        if (row && row.unlocked) {
          panel.classList.add('is-unlocked');
          input.disabled = true;
          setError('');
          submit.textContent = 'Unlocked';
          setTimeout(done, reduceMotion ? 0 : 750);
          return;
        }
        input.value = '';
        if (row && row.retry_after_seconds > 0) { lockout(row.retry_after_seconds); setError(err.textContent, true); return; }
        submit.disabled = false;
        var left = row ? row.attempts_left : 0;
        setError('That PIN isn\'t right. ' + left + (left === 1 ? ' try' : ' tries') + ' left before a 15 minute pause.', true);
        input.focus();
      }, function () {
        submit.classList.remove('is-busy'); submit.disabled = false;
        setError('Couldn\'t reach the server - check your connection and try again.', true);
      });
    });
  }

  // After a successful unlock: fetch where it lives, then refresh its card.
  function afterUnlock(r) {
    return hydrateLocations([r]).then(function () { rerenderCard(r); });
  }
  function rerenderCard(r) {
    var card = document.querySelector('.res-card[data-id="' + r.id + '"]');
    if (!card) return;
    var container = card.parentNode;
    var mode = (container && container.getAttribute('data-mode')) || 'browse';
    signedUrls([r.preview_path].filter(Boolean)).then(function () {
      var tmp = document.createElement('div');
      tmp.innerHTML = cardHtml(r, mode, 0);
      var fresh = tmp.firstElementChild;
      fresh.classList.remove('res-anim-in');
      card.replaceWith(fresh);
      loadEngagement([r]);
    });
  }

  function openUnlockDialog(r, then) {
    var dlg = openDialog(
      '<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button>' +
      '<span class="guide-eyebrow">PIN protected</span><h2 class="guide-title">' + escapeHtml(r.title) + '</h2>' +
      pinPanelHtml(r), 'res-dialog--pin');
    wirePinPanel(dlg.dialog.querySelector('.res-pin'), r, function () {
      dlg.close();
      afterUnlock(r).then(function () { if (then) then(); });
    });
  }

  // ---- Preview / open ---------------------------------------------------------------
  function openResource(r) {
    if (isLockedOut(r)) { openUnlockDialog(r, function () { openResource(r); }); return; }
    if (insights()) insights().record(r, r.kind === 'link' ? 'click' : 'download');
    if (r.kind === 'link') {
      var u = parseHttpUrl(r.url);
      if (u) window.open(u.href, '_blank', 'noopener,noreferrer');
      return;
    }
    signedUrl(r.file_path, r.file_name).then(function (url) {
      if (!url) { showToast("Couldn't get that file right now - try again in a moment.", true); return; }
      window.open(url, '_blank', 'noopener');
    });
  }

  function previewResource(r, opts) {
    opts = opts || {};
    if (insights()) insights().record(r, 'view');
    var head = '<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button>' +
      '<span class="guide-eyebrow">' + escapeHtml(TYPES[r.resource_type] || 'Resource') + ' · ' + escapeHtml(coursesLabel(r)) + (yearsOf(r).length ? ' · ' + escapeHtml(yearsLabel(yearsOf(r))) : '') + '</span>' +
      '<h2 class="guide-title">' + escapeHtml(r.title) + '</h2>' + bylineHtml(r, 'lg');
    var social = r.status === 'approved'
      ? '<div class="res-pv-social">' + socialHtml(r.id) + '</div>' +
        '<section class="res-comments" aria-labelledby="pv-comments-title"><h3 id="pv-comments-title" class="res-comments-title">Comments</h3>' +
        '<ul class="res-comment-list" id="pv-comments" aria-live="polite"><li class="res-comments-empty">Loading comments…</li></ul>' +
        '<form id="pv-comment-form" class="res-comment-form" novalidate><label class="visually-hidden" for="pv-comment-input">Add a comment</label>' +
        '<textarea id="pv-comment-input" maxlength="1000" rows="2" placeholder="Add a comment… (Ctrl+Enter to post)"></textarea>' +
        '<div class="res-comment-actions"><span class="guide-count" id="pv-comment-count">0 / 1000</span><button type="submit" class="btn btn-primary res-btn">Post comment</button></div></form></section>'
      : '<p class="res-meta res-meta--faint">Likes and comments open once this resource is approved.</p>';
    var foot = '<p class="res-desc res-desc--full">' + escapeHtml(r.description) + '</p>' +
      (r.source_type === 'external' ? '<p class="res-meta res-meta--faint">External resource' + (r.source_credit ? ' - source: ' + escapeHtml(r.source_credit) : '') + '. Not created by LACMS - check it before relying on it.</p>' : '<p class="res-meta res-meta--faint">Created by the member who shared it.</p>') +
      '<div class="guide-actions">' + (isLockedOut(r) ? '' : '<button type="button" class="btn btn-primary" data-pv-open>' + (r.kind === 'link' ? 'Open link' : 'Download') + '</button>') + '<button type="button" class="btn btn-outline" data-dialog-close>Close</button></div>' + social;

    var dlg;
    if (isLockedOut(r)) {
      // The PIN form sits where the preview would be.
      dlg = openDialog(head + '<div class="res-embed res-embed--lock">' + pinPanelHtml(r) + '</div>' + foot, 'res-dialog--preview', opts.from);
      wirePinPanel(dlg.dialog.querySelector('.res-pin'), r, function () {
        dlg.close();
        afterUnlock(r).then(function () { previewResource(r, {}); });
      });
      wirePreviewOpen(dlg, r, opts);
      return;
    }
    if (r.kind === 'link') {
      var u = parseHttpUrl(r.url);
      var yt = youtubeId(u);
      var body = yt
        ? '<div class="res-embed"><iframe src="https://www.youtube-nocookie.com/embed/' + yt + '" title="' + escapeHtml(r.title) + '" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation" referrerpolicy="no-referrer"></iframe></div>'
        : '<div class="res-embed res-embed--card"><div class="res-link-card">' + thumbHtml(r) + '<div><strong>' + escapeHtml(u ? u.hostname.replace(/^www\./, '') : '') + '</strong><span>Opens in a new tab - a website outside LACMS.</span></div></div></div>';
      dlg = openDialog(head + body + foot, 'res-dialog--preview', opts.from);
      wirePreviewOpen(dlg, r, opts);
      return;
    }
    dlg = openDialog(head + '<div class="res-embed res-embed--loading" id="pv-slot"><span class="auth-gate-spinner" aria-hidden="true"></span></div>' + foot, 'res-dialog--preview', opts.from);
    wirePreviewOpen(dlg, r, opts);
    var ext = extOf(r.file_name);
    signedUrl(r.file_path).then(function (url) {
      var slot = dlg.dialog.querySelector('#pv-slot');
      if (!slot) return;
      slot.classList.remove('res-embed--loading');
      var noPreview = '<div class="res-link-card">' + thumbHtml(r) + '<div><strong>' + escapeHtml(r.file_name || '') + (r.file_size ? ' (' + formatBytes(r.file_size) + ')' : '') + '</strong><span>No inline preview for this file type - download to view.</span></div></div>';
      if (!url) { slot.classList.add('res-embed--card'); slot.innerHTML = '<p class="res-meta">Couldn\'t load the preview - you can still download it.</p>'; return; }
      if (ext === 'pdf') renderPdf(slot, url, r);
      else if (IMAGE_EXTS.indexOf(ext) !== -1) { slot.classList.add('res-embed--img'); slot.innerHTML = '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(r.title) + '">'; }
      else if (r.preview_path) {
        signedUrl(r.preview_path).then(function (pu) {
          if (pu) slot.innerHTML = '<img src="' + escapeHtml(pu) + '" alt="">';
          else { slot.classList.add('res-embed--card'); slot.innerHTML = noPreview; }
        });
      } else { slot.classList.add('res-embed--card'); slot.innerHTML = noPreview; }
    });
  }
  function wirePreviewOpen(dlg, r, opts) {
    var openBtn = dlg.dialog.querySelector('[data-pv-open]');
    if (openBtn) openBtn.addEventListener('click', function () { openResource(r); });
    if (r.status === 'approved') {
      wireComments(dlg, r, !!(opts && opts.focusComments));
      var likeBtn = dlg.dialog.querySelector('[data-res-like]');
      if (likeBtn) likeBtn.addEventListener('click', function () { toggleLike(r.id); });
    }
  }

  // ---- Delete / approve / reject ----------------------------------------------------
  // The card slides away first, then the lists reload from the server.
  function withLeave(id, fn) {
    var card = document.querySelector('.res-card[data-id="' + id + '"]');
    if (!card || reduceMotion) { fn(); return; }
    card.classList.add('is-leaving');
    setTimeout(fn, 260);
  }

  function deleteResource(r) {
    var own = r.uploader_id === userId;
    var msg = 'Delete "' + r.title + '"' + (own ? '' : ' (shared by ' + r.uploader_name + ')') + '? This can\'t be undone.';
    if (!window.confirm(msg)) return;
    supabaseClient.from('resources').delete().eq('id', r.id).then(function (res) {
      if (res.error) { showToast("Couldn't delete it: " + res.error.message, true); return; }
      var paths = [r.file_path, r.preview_path].filter(Boolean);
      if (paths.length) supabaseClient.storage.from(BUCKET).remove(paths);
      showToast('Deleted.');
      withLeave(r.id, refreshCurrent);
    });
  }

  function reviewResource(r, status, reason) {
    supabaseClient.from('resources').update({ status: status, reject_reason: status === 'rejected' ? (reason || null) : null }).eq('id', r.id).then(function (res) {
      if (res.error) { showToast("Couldn't update it: " + res.error.message, true); return; }
      showToast(status === 'approved' ? '"' + r.title + '" is approved and now visible to members.' : '"' + r.title + '" was not approved.');
      withLeave(r.id, refreshCurrent);
    });
  }

  function openRejectDialog(r) {
    var dlg = openDialog(
      '<button type="button" class="guide-close" data-dialog-close aria-label="Cancel">&times;</button>' +
      '<span class="guide-eyebrow">Review</span><h2 class="guide-title">Don\'t approve "' + escapeHtml(r.title) + '"?</h2>' +
      '<p class="guide-text">It stays hidden from members. ' + escapeHtml(r.uploader_name) + ' will see your reason (optional) and can edit and resubmit it.</p>' +
      '<form class="guide-form" novalidate><div class="field"><label for="rj-reason">Reason <span class="guide-optional">(optional)</span></label>' +
      '<textarea id="rj-reason" maxlength="500" rows="3" data-autofocus placeholder="e.g. Copyrighted material - please share your own notes or link to the source instead."></textarea></div>' +
      '<div class="guide-actions"><button type="submit" class="btn btn-primary res-btn--danger-fill">Reject</button><button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div></form>'
    );
    dlg.dialog.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var reason = dlg.dialog.querySelector('#rj-reason').value.trim();
      dlg.close();
      reviewResource(r, 'rejected', reason);
    });
  }

  function refreshCurrent() {
    Promise.all([loadCounts(), loadNewCounts()]).then(function () {
      var hash = decodeURIComponent((window.location.hash || '').replace(/^#/, ''));
      if (hash === 'review' && isAdmin) openSpecial('review');
      else if (hash === 'mine') openSpecial('mine');
      else { loadedAll = false; renderChips(); loadAll(); }
    });
  }

  // ---- Share / edit dialog ------------------------------------------------------------
  // Multi-select as toggle pills (real checkboxes underneath, so keyboard
  // and screen readers get native behaviour), with Select all / Clear.
  function chipGroup(name, labelText, hint, items, selected) {
    return '<div class="field res-chipfield" data-chipfield="' + name + '">' +
      '<div class="res-chips-head"><span class="res-label" id="' + name + '-label">' + labelText + (hint ? ' <span class="guide-optional">' + hint + '</span>' : '') + '</span>' +
      '<span class="res-chips-tools"><span class="res-chips-count" data-chips-count aria-live="polite"></span>' +
      '<button type="button" class="res-chips-link" data-chips-all>Select all</button><button type="button" class="res-chips-link" data-chips-none>Clear</button></span></div>' +
      '<div class="ui-chips" role="group" aria-labelledby="' + name + '-label">' + items.map(function (it) {
        return '<label class="ui-chip"><input type="checkbox" name="' + name + '" value="' + escapeHtml(it.value) + '"' + (selected.indexOf(it.value) !== -1 ? ' checked' : '') + '><span>' + escapeHtml(it.label) + '</span></label>';
      }).join('') + '</div></div>';
  }
  function chipValues(root, name) {
    return Array.prototype.map.call(root.querySelectorAll('input[name="' + name + '"]:checked'), function (i) { return i.value; });
  }

  function seg(name, options, current) {
    return '<div class="ui-seg" role="radiogroup">' + options.map(function (o) {
      return '<label class="ui-seg-opt"><input type="radio" name="' + name + '" value="' + o.value + '"' + (o.value === current ? ' checked' : '') + '><span>' + o.label + '</span></label>';
    }).join('') + '</div>';
  }

  function openShareDialog(existing) {
    var editing = !!existing;
    var ex = existing || {};
    var selectedCourses = existing ? coursesOf(existing) : (currentCourse ? [currentCourse] : []);
    var selectedYears = existing ? yearsOf(existing) : [];
    var courseItems = COURSES.map(function (c) { return { value: c.name, label: c.label || c.name }; });
    var yearItems = YEARS.map(function (y) { return { value: y, label: y }; });
    var typeOptions = Object.keys(TYPES).map(function (k) { return '<option value="' + k + '"' + (ex.resource_type === k ? ' selected' : '') + '>' + TYPES[k] + '</option>'; }).join('');
    // PIN protection: the person who shared it sets / changes it; an executive
    // can only take a PIN off someone else's resource.
    var canSetLock = pinsReady && (!editing || ex.uploader_id === userId);
    var canRemoveLock = pinsReady && editing && !canSetLock && isAdmin && !!ex.is_locked;
    var lockHtml = '';
    if (canSetLock || canRemoveLock) {
      lockHtml =
        '<div class="field res-lockfield">' +
        '<label class="res-switch"><input type="checkbox" id="rs-lock" role="switch"' + (ex.is_locked ? ' checked' : '') + '>' +
        '<span class="res-switch-track" aria-hidden="true"><span class="res-switch-thumb"></span></span>' +
        '<span class="res-switch-text"><strong>' + LOCK_ICON + (canRemoveLock ? 'PIN protected' : 'Protect with a PIN') + '</strong>' +
        '<small>' + (canRemoveLock
          ? 'Set by ' + escapeHtml(ex.uploader_name || 'the person who shared it') + '. Turn this off to remove the PIN for everyone.'
          : 'Everyone can see the title and description, but must enter your PIN to open the file or link. They can message you to ask for it. For more protected material.') + '</small></span></label>' +
        (canSetLock
          ? '<div class="res-lock-body" id="rs-lock-body"' + (ex.is_locked ? '' : ' hidden') + '>' +
            '<label for="rs-pin">PIN <span class="guide-optional">(4 to 8 digits)</span></label>' +
            '<div class="res-pin-row"><input type="text" id="rs-pin" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" placeholder="e.g. 482915">' +
            '<button type="button" class="btn btn-outline res-btn" id="rs-pin-gen">Generate</button>' +
            '<button type="button" class="btn btn-outline res-btn" id="rs-pin-copy">Copy</button></div>' +
            '<span class="guide-count" id="rs-pin-note">Only you can see this PIN (it\'s here whenever you edit). Anyone who has it can open the resource, so share it with people you trust. Changing it locks everyone out until they get the new one.</span></div>'
          : '') +
        '</div>';
    }

    var dlg = openDialog(
      '<button type="button" class="guide-close" data-dialog-close aria-label="Cancel">&times;</button>' +
      '<span class="guide-eyebrow">LACMS Resources</span>' +
      '<h2 class="guide-title">' + (editing ? 'Edit your resource' : 'Share a resource') + '</h2>' +
      '<p class="guide-text">' + (isAdmin && !editing
        ? 'As an executive, what you share is published straight away.'
        : 'An executive committee member reviews every resource before it appears for other members' + (editing ? ' - editing sends it back for review.' : '.')) + '</p>' +
      '<form class="guide-form res-form" id="res-form" novalidate>' +
      chipGroup('rs-courses', 'Courses', '(pick every course it helps)', courseItems, selectedCourses) +
      '<div class="field"><label for="rs-title">Title</label><input type="text" id="rs-title" maxlength="140" value="' + escapeHtml(ex.title || '') + '" placeholder="e.g. Cardiovascular physiology - summary notes" data-autofocus></div>' +
      (editing ? '' :
        '<div class="field"><span class="res-label">What are you sharing?</span>' + seg('rs-kind', [{ value: 'file', label: 'Upload a file' }, { value: 'link', label: 'Add a link' }], 'file') + '</div>' +
        '<div class="field" data-rs-kind="file"><label for="rs-file">File <span class="guide-optional">(PDF, Word, PowerPoint, Excel, text or image - max 25 MB)</span></label>' +
        '<div class="res-drop" id="rs-drop"><input type="file" id="rs-file" accept="' + Object.keys(FILE_TYPES).map(function (e) { return '.' + e; }).join(',') + '">' +
        '<svg class="icon res-drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' +
        '<span id="rs-file-label">Choose a file, or drop it here</span></div></div>' +
        '<div class="field" data-rs-kind="link" hidden><label for="rs-url">Link</label><input type="text" id="rs-url" inputmode="url" placeholder="https://..." autocomplete="off"><div class="res-linkpreview" id="rs-linkpreview" hidden></div></div>') +
      (editing && ex.kind === 'link' ? '<div class="field"><label for="rs-url">Link</label><input type="text" id="rs-url" inputmode="url" value="' + escapeHtml(ex.url || '') + '" autocomplete="off"></div>' : '') +
      '<div class="field"><label for="rs-desc">Description</label><textarea id="rs-desc" maxlength="1500" rows="4" placeholder="What is it, who is it useful for, and how should people use it?">' + escapeHtml(ex.description || '') + '</textarea><span class="guide-count" id="rs-count" aria-live="polite">0 / 1500</span></div>' +
      '<div class="field"><label for="rs-type">Type</label><select id="rs-type">' + typeOptions + '</select></div>' +
      chipGroup('rs-years', 'Years of study', '(optional - leave empty if it suits any year)', yearItems, selectedYears) +
      '<div class="field"><label for="rs-topic">Topic / module <span class="guide-optional">(optional)</span></label><input type="text" id="rs-topic" maxlength="120" value="' + escapeHtml(ex.topic || '') + '" placeholder="e.g. Cardiology, Pharmacokinetics"></div>' +
      '<div class="field"><span class="res-label">Where is it from?</span>' + seg('rs-source', [{ value: 'personal', label: 'My own work' }, { value: 'external', label: 'From somewhere else' }], ex.source_type === 'external' ? 'external' : 'personal') + '</div>' +
      '<div class="field" id="rs-credit-field" hidden><label for="rs-credit">Source / author</label><input type="text" id="rs-credit" maxlength="200" value="' + escapeHtml(ex.source_credit || '') + '" placeholder="Who made it or where it\'s from - e.g. Osmosis, BMJ, Prof. Smith (Lincoln)"></div>' +
      (editing ? '' :
        '<div class="field"><label for="rs-preview">Preview image <span class="guide-optional">(optional, max 2 MB)</span></label><input type="file" id="rs-preview" accept="image/png,image/jpeg,image/webp,image/gif"><span class="guide-count">Shown on the card. Videos and images get a preview automatically.</span></div>') +
      lockHtml +
      '<p class="guide-error" id="rs-error" role="alert" hidden></p>' +
      '<div class="res-progress" id="rs-progress" hidden><span></span></div>' +
      '<div class="guide-actions"><button type="submit" class="btn btn-primary" id="rs-submit">' + (editing ? 'Save changes' : (isAdmin ? 'Publish' : 'Submit for review')) + '</button>' +
      '<button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div>' +
      '</form>', 'res-dialog--wide'
    );

    var d = dlg.dialog;
    var form = d.querySelector('#res-form');
    var errorEl = d.querySelector('#rs-error');
    var progress = d.querySelector('#rs-progress');
    enhanceSelect(d.querySelector('#rs-type'));

    // Pill groups: live "N selected" and Select all / Clear.
    Array.prototype.forEach.call(d.querySelectorAll('[data-chipfield]'), function (field) {
      var name = field.getAttribute('data-chipfield');
      var count = field.querySelector('[data-chips-count]');
      function update() { var n = chipValues(field, name).length; count.textContent = n ? n + ' selected' : ''; }
      update();
      field.addEventListener('change', update);
      field.querySelector('[data-chips-all]').addEventListener('click', function () { field.querySelectorAll('input[type="checkbox"]').forEach(function (i) { i.checked = true; }); update(); });
      field.querySelector('[data-chips-none]').addEventListener('click', function () { field.querySelectorAll('input[type="checkbox"]').forEach(function (i) { i.checked = false; }); update(); });
    });

    function val(id) { return d.querySelector('#' + id).value.trim(); }
    function kindVal() { return editing ? ex.kind : form.querySelector('input[name="rs-kind"]:checked').value; }
    function sourceVal() { return form.querySelector('input[name="rs-source"]:checked').value; }
    function showError(m) {
      errorEl.textContent = m;
      errorEl.hidden = false;
      errorEl.classList.remove('is-shake'); void errorEl.offsetWidth; errorEl.classList.add('is-shake');
      errorEl.scrollIntoView({ block: 'nearest' });
    }

    var descEl = d.querySelector('#rs-desc');
    var countEl = d.querySelector('#rs-count');
    function updateCount() {
      countEl.textContent = descEl.value.length + ' / 1500';
      countEl.classList.toggle('is-low', descEl.value.trim().length > 0 && descEl.value.trim().length < 10);
    }
    updateCount();
    descEl.addEventListener('input', updateCount);

    function syncSource() { d.querySelector('#rs-credit-field').hidden = sourceVal() !== 'external'; }
    syncSource();
    function syncKind() {
      d.querySelectorAll('[data-rs-kind]').forEach(function (g) { g.hidden = g.getAttribute('data-rs-kind') !== kindVal(); });
    }
    form.addEventListener('change', function () { if (!editing) syncKind(); syncSource(); });

    // File choice + drag and drop
    var fileInput = d.querySelector('#rs-file');
    var fileLabel = d.querySelector('#rs-file-label');
    var drop = d.querySelector('#rs-drop');
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        var f = fileInput.files[0];
        fileLabel.textContent = f ? f.name + ' (' + formatBytes(f.size) + ')' : 'Choose a file, or drop it here';
        drop.classList.toggle('has-file', !!f);
      });
      ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); }); });
      ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function () { drop.classList.remove('is-over'); }); });
      drop.addEventListener('drop', function (e) {
        e.preventDefault();
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          fileInput.files = e.dataTransfer.files;
          fileInput.dispatchEvent(new Event('change'));
        }
      });
    }

    // Live link preview while typing
    var urlInput = d.querySelector('#rs-url');
    var linkPreview = d.querySelector('#rs-linkpreview');
    if (urlInput && linkPreview) {
      urlInput.addEventListener('input', function () {
        var u = parseHttpUrl(urlInput.value);
        if (!u) { linkPreview.hidden = true; return; }
        var yt = youtubeId(u);
        linkPreview.hidden = false;
        linkPreview.innerHTML = (yt
          ? '<img src="https://i.ytimg.com/vi/' + yt + '/mqdefault.jpg" alt="" referrerpolicy="no-referrer">'
          : '<img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(u.hostname) + '&sz=64" alt="" width="32" height="32" referrerpolicy="no-referrer">') +
          '<span><strong>' + escapeHtml(u.hostname.replace(/^www\./, '')) + '</strong>' + (yt ? ' · YouTube video' : '') + '</span>';
      });
    }
    if (!editing) syncKind();

    // PIN protection controls
    var lockToggle = d.querySelector('#rs-lock');
    var pinInput = d.querySelector('#rs-pin');
    var lockBody = d.querySelector('#rs-lock-body');
    var originalPin = '';
    if (lockToggle) {
      lockToggle.addEventListener('change', function () {
        if (lockBody) {
          lockBody.hidden = !lockToggle.checked;
          if (lockToggle.checked && pinInput && !pinInput.value) pinInput.focus();
        }
      });
    }
    if (pinInput) {
      pinInput.addEventListener('input', function () {
        var clean = pinInput.value.replace(/\D/g, '').slice(0, 8);
        if (clean !== pinInput.value) pinInput.value = clean;
      });
      d.querySelector('#rs-pin-gen').addEventListener('click', function () {
        var n = new Uint32Array(1);
        (window.crypto || window.msCrypto).getRandomValues(n);
        pinInput.value = String(100000 + (n[0] % 900000));
        pinInput.focus();
      });
      d.querySelector('#rs-pin-copy').addEventListener('click', function () {
        if (!pinInput.value) return;
        var btn = d.querySelector('#rs-pin-copy');
        var ok = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(pinInput.value).then(ok, function () {});
        else { pinInput.select(); try { document.execCommand('copy'); ok(); } catch (e) { /* ignore */ } }
      });
      if (editing && ex.is_locked) {
        pinInput.placeholder = 'Loading…';
        supabaseClient.rpc('get_resource_pin', { p_id: ex.id }).then(function (res) {
          pinInput.placeholder = 'e.g. 482915';
          if (!res.error && res.data) { originalPin = String(res.data); if (!pinInput.value) pinInput.value = originalPin; }
        }, function () { pinInput.placeholder = 'e.g. 482915'; });
      }
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errorEl.hidden = true;
      var title = val('rs-title');
      var desc = val('rs-desc');
      var kind = kindVal();
      var pickedCourses = COURSES.map(function (c) { return c.name; }).filter(function (n) { return chipValues(d, 'rs-courses').indexOf(n) !== -1; });
      var pickedYears = YEARS.filter(function (y) { return chipValues(d, 'rs-years').indexOf(y) !== -1; });
      if (!pickedCourses.length) { showError('Pick at least one course this resource is for.'); return; }
      if (title.length < 3) { showError('Give it a title (at least 3 characters).'); return; }
      if (desc.length < 10) { showError('Add a short description (at least 10 characters) so people know what it is.'); return; }
      if (sourceVal() === 'external' && !val('rs-credit')) { showError('Say where it\'s from (the author or website) so it\'s credited properly.'); return; }

      var lockOn = lockToggle ? lockToggle.checked : !!ex.is_locked;
      var pinVal = pinInput ? pinInput.value.trim() : '';
      if (canSetLock && lockOn && !/^[0-9]{4,8}$/.test(pinVal)) { showError('Choose a PIN of 4 to 8 digits (or tap Generate), or turn PIN protection off.'); if (pinInput) pinInput.focus(); return; }

      var url = null;
      if (kind === 'link') {
        var parsed = parseHttpUrl(urlInput.value);
        if (!parsed) { showError('Enter a valid link starting with http:// or https://'); return; }
        url = parsed.href;
      }
      var file = null;
      var previewFile = null;
      if (!editing && kind === 'file') {
        file = fileInput.files[0];
        if (!file) { showError('Choose the file you want to share.'); return; }
        var ext = extOf(file.name);
        if (!FILE_TYPES[ext]) { showError('That file type isn\'t allowed. Use PDF, Word, PowerPoint, Excel, text/CSV or an image.'); return; }
        if (file.size > MAX_FILE_BYTES) { showError('That file is ' + formatBytes(file.size) + ' - the limit is 25 MB.'); return; }
      }
      if (!editing) {
        previewFile = d.querySelector('#rs-preview').files[0] || null;
        if (previewFile && (previewFile.size > MAX_PREVIEW_BYTES || IMAGE_EXTS.indexOf(extOf(previewFile.name)) === -1)) {
          showError('The preview must be an image (PNG, JPG, WebP or GIF) under 2 MB.');
          return;
        }
      }

      var submit = d.querySelector('#rs-submit');
      submit.disabled = true;
      submit.classList.add('is-busy');
      submit.textContent = editing ? 'Saving…' : (file ? 'Uploading…' : 'Submitting…');
      progress.hidden = false;

      var fields = {
        courses: pickedCourses,
        years: pickedYears,
        title: title,
        description: desc,
        resource_type: val('rs-type'),
        source_type: sourceVal(),
        source_credit: sourceVal() === 'external' ? val('rs-credit') : null,
        topic: val('rs-topic') || null
      };
      function fail(message) {
        submit.disabled = false;
        submit.classList.remove('is-busy');
        progress.hidden = true;
        submit.textContent = editing ? 'Save changes' : (isAdmin ? 'Publish' : 'Submit for review');
        showError(message);
      }

      if (editing) {
        if (kind === 'link') fields.url = url;
        supabaseClient.from('resources').update(fields).eq('id', ex.id).then(function (res) {
          if (res.error) { fail("Couldn't save: " + res.error.message); return; }
          var pinCall = null;
          if (lockToggle) {
            if (canSetLock && lockOn && (!ex.is_locked || pinVal !== originalPin)) pinCall = { p_id: ex.id, p_pin: pinVal };
            else if ((canSetLock || canRemoveLock) && !lockOn && ex.is_locked) pinCall = { p_id: ex.id, p_pin: null };
          }
          return (pinCall ? supabaseClient.rpc('set_resource_pin', pinCall) : Promise.resolve({})).then(function (pr) {
            dlg.close();
            if (pr && pr.error) showToast('Saved, but the PIN change didn\'t go through: ' + pr.error.message, true);
            else showToast(isAdmin ? 'Saved.' : 'Saved - if you changed anything besides the PIN, it will be reviewed again before it appears.');
            refreshCurrent();
          });
        });
        return;
      }

      var id = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : null;
      if (!id) { fail('Your browser is too old to upload files - try a current one.'); return; }
      var uploaded = [];
      function cleanup() { if (uploaded.length) supabaseClient.storage.from(BUCKET).remove(uploaded); }

      var steps = Promise.resolve();
      var row = Object.assign({ id: id, kind: kind }, fields);
      // Locked from the moment it exists: until the PIN is saved only the
      // person who shared it (and executives) can open it.
      if (canSetLock && lockOn) row.is_locked = true;
      if (kind === 'link') row.url = url;
      if (file) {
        var path = userId + '/' + id + '/' + safeFileName(file.name);
        steps = steps.then(function () {
          return supabaseClient.storage.from(BUCKET).upload(path, file, { contentType: FILE_TYPES[extOf(file.name)], upsert: false });
        }).then(function (r) {
          if (r.error) throw new Error('Upload failed: ' + r.error.message);
          uploaded.push(path);
          row.file_path = path; row.file_name = file.name.slice(0, 255); row.file_size = file.size; row.file_mime = FILE_TYPES[extOf(file.name)];
        });
      }
      if (previewFile) {
        var ppath = userId + '/' + id + '/preview-' + safeFileName(previewFile.name);
        steps = steps.then(function () {
          return supabaseClient.storage.from(BUCKET).upload(ppath, previewFile, { contentType: FILE_TYPES[extOf(previewFile.name)], upsert: false });
        }).then(function (r) {
          if (r.error) throw new Error('Preview upload failed: ' + r.error.message);
          uploaded.push(ppath);
          row.preview_path = ppath;
        });
      }
      steps.then(function () {
        return supabaseClient.from('resources').insert(row);
      }).then(function (res) {
        if (res.error) throw new Error(res.error.message);
        return (canSetLock && lockOn ? supabaseClient.rpc('set_resource_pin', { p_id: id, p_pin: pinVal }) : Promise.resolve({})).then(function (pr) {
          dlg.close();
          if (pr && pr.error) showToast('Shared, but the PIN wasn\'t saved (' + pr.error.message + '). It stays locked - open Edit in My submissions to set it.', true);
          else showToast(isAdmin ? '"' + title + '" is published' + (lockOn ? ' and PIN protected.' : '.') : 'Thanks! "' + title + '" has been submitted' + (lockOn ? ' with its PIN' : '') + ' - an executive committee member will review it before it appears.');
          refreshCurrent();
        });
      }).catch(function (err) {
        cleanup();
        fail("Couldn't share that: " + (err && err.message ? err.message : err));
      });
    });
  }

  // ---- Events --------------------------------------------------------------------------
  function cardFromEvent(e) {
    var card = e.target.closest('.res-card');
    return card ? rendered[card.getAttribute('data-id')] : null;
  }

  function onListClick(e) {
    // "Read more" expands the description in place; "Show less" folds it back.
    var more = e.target.closest('[data-res-more]');
    if (more) {
      if (press && press.moved) return;
      var desc = document.getElementById(more.getAttribute('aria-controls'));
      if (desc) {
        var open = !desc.classList.contains('is-expanded');
        desc.classList.toggle('is-expanded', open);
        more.setAttribute('aria-expanded', open ? 'true' : 'false');
        more.textContent = open ? 'Show less' : 'Read more';
      }
      return;
    }
    if (press && press.moved) return; // the tail end of a drag isn't a click
    var like = e.target.closest('[data-res-like]');
    if (like) { var lr = cardFromEvent(e); if (lr) toggleLike(lr.id); return; }
    var r = cardFromEvent(e);
    if (!r) return;
    var cardEl = e.target.closest('.res-card');
    if (e.target.closest('[data-res-unlock]')) { openUnlockDialog(r); return; }
    if (e.target.closest('[data-res-comments]')) { previewResource(r, { from: cardEl, focusComments: true }); return; }
    if (e.target.closest('[data-res-preview]')) { previewResource(r, { from: cardEl }); return; }
    // Anywhere else on the card (not a control / link) opens the full preview.
    if (!e.target.closest('button, a, input, select, textarea, .ui-select, .res-more') && window.getSelection().toString() === '') { previewResource(r, { from: cardEl }); return; }
    if (e.target.closest('[data-res-open]')) openResource(r);
    else if (e.target.closest('[data-res-approve]')) reviewResource(r, 'approved');
    else if (e.target.closest('[data-res-reject]')) openRejectDialog(r);
    else if (e.target.closest('[data-res-edit]')) openShareDialog(r);
    else if (e.target.closest('[data-res-delete]')) deleteResource(r);
  }

  function wireEvents() {
    $('res-share-btn').addEventListener('click', function () { openShareDialog(null); });
    $('res-mine-link').addEventListener('click', function () { go('mine'); });
    $('res-review-link').addEventListener('click', function () { go('review'); });
    $('res-back-btn').addEventListener('click', function () { go(''); });
    $('res-whatsnew-jump').addEventListener('click', function () {
      $('res-browse-list').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
    $('res-course-chips').addEventListener('click', function (e) {
      var chip = e.target.closest('[data-chip]');
      if (chip) setCourse(chip.getAttribute('data-chip'));
    });
    function rerender() { shown = PAGE_SIZE; renderBrowse(); }
    ['res-search', 'res-filter-type', 'res-filter-source', 'res-filter-year', 'res-sort'].forEach(function (id) {
      $(id).addEventListener(id === 'res-search' ? 'input' : 'change', rerender);
    });
    $('res-search-clear').addEventListener('click', function () { $('res-search').value = ''; rerender(); $('res-search').focus(); });
    $('res-clear-filters').addEventListener('click', function () { resetFilters(); if (currentCourse) setCourse(''); else rerender(); });
    $('res-load-more').addEventListener('click', function () { shown += PAGE_SIZE; renderBrowse(); });
    $('res-list').addEventListener('click', onListClick);
    $('res-browse-list').addEventListener('click', onListClick);
    // Press / ripple feedback is reserved for a genuine click: it starts on
    // pointer-down but is cancelled the moment the pointer moves more than a
    // few pixels (dragging, text selection, touch scrolling), and the ripple
    // itself only appears when the click actually completes.
    var DRAG_PX = 6;
    function endPress() {
      if (press && press.card) press.card.classList.remove('is-pressed');
    }
    [$('res-list'), $('res-browse-list')].forEach(function (box) {
      box.addEventListener('pointerdown', function (e) {
        if (e.button !== undefined && e.button !== 0) return;
        var card = e.target.closest('.res-card');
        if (!card || e.target.closest('button, a, input, select, textarea')) { press = null; return; }
        press = { card: card, x: e.clientX, y: e.clientY, moved: false };
        if (!reduceMotion) card.classList.add('is-pressed');
      });
      box.addEventListener('click', function (e) {
        var card = e.target.closest('.res-card');
        if (!card || reduceMotion || e.target.closest('button, a, input, select, textarea')) return;
        if (press && press.moved) return;
        var rect = card.getBoundingClientRect();
        var rip = document.createElement('span');
        rip.className = 'res-ripple';
        rip.style.left = (e.clientX - rect.left) + 'px';
        rip.style.top = (e.clientY - rect.top) + 'px';
        card.appendChild(rip);
        setTimeout(function () { rip.remove(); }, 650);
      }, true);
    });
    document.addEventListener('pointermove', function (e) {
      if (!press || press.moved) return;
      if (Math.abs(e.clientX - press.x) > DRAG_PX || Math.abs(e.clientY - press.y) > DRAG_PX) {
        press.moved = true;
        endPress();
      }
    });
    ['pointerup', 'pointercancel', 'dragstart'].forEach(function (type) {
      document.addEventListener(type, function () {
        endPress();
        // Leave `moved` readable for the click that follows pointerup.
        if (press && !press.moved) press = null;
        else if (press) setTimeout(function () { press = null; }, 0);
      }, true);
    });
    [$('res-empty'), $('res-browse-empty')].forEach(function (box) {
      box.addEventListener('click', function (e) {
        if (e.target.closest('[data-res-share]')) openShareDialog(null);
        else if (e.target.closest('[data-res-clear]')) { resetFilters(); if (currentCourse) setCourse(''); else rerender(); }
      });
    });
    // "/" jumps to search while browsing (like most docs sites).
    document.addEventListener('keydown', function (e) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || document.querySelector('.guide-backdrop') || $('res-view-home').hidden) return;
      e.preventDefault();
      $('res-search').focus();
    });
  }
})();
