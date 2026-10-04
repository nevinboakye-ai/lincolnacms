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
(function () {
  'use strict';

  var appEl = document.getElementById('resources-app');
  if (!appEl) return;
  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;

  var BUCKET = 'lacms-resources';
  var MAX_FILE_BYTES = 25 * 1024 * 1024;
  var MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

  var COURSES = [
    { name: 'Medicine', accent: 'gold' },
    { name: 'Pharmacy', accent: 'green' },
    { name: 'Dental Hygiene and Therapy', accent: 'red' },
    { name: 'Diagnostic Radiography', accent: 'purple' },
    { name: 'Nursing', accent: 'gold' },
    { name: 'Midwifery', accent: 'green' },
    { name: 'Biomedical Science', accent: 'red' },
    { name: 'Occupational Therapy', accent: 'purple' },
    { name: 'General', accent: 'gold', label: 'General (all courses)' }
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
  var currentCourse = null;
  var courseItems = [];
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
    t.classList.toggle('is-error', !!isError);
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () { t.hidden = true; }, 7000);
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

  function start() {
    if (gate) gate.style.display = 'none';
    appEl.style.display = '';
    buildFilterOptions();
    wireEvents();
    loadCounts().then(function () {
      renderHome();
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
        counts[row.course] = { approved: row.approved_count, pending: row.pending_count };
        pending += row.pending_count;
      });
      var reviewLink = $('res-review-link');
      reviewLink.hidden = !isAdmin;
      var rc = $('res-review-count');
      rc.hidden = !(isAdmin && pending > 0);
      rc.textContent = pending;
    });
  }

  // ---- Routing: #c=<course>, #review, #mine ------------------------------------
  function route() {
    var hash = decodeURIComponent((window.location.hash || '').replace(/^#/, ''));
    $('res-view-home').hidden = true;
    $('res-view-list').hidden = true;
    if (hash.indexOf('c=') === 0) openCourse(hash.slice(2));
    else if (hash === 'review' && isAdmin) openSpecial('review');
    else if (hash === 'mine') openSpecial('mine');
    else { currentCourse = null; $('res-view-home').hidden = false; renderHome(); }
    if (hash) window.scrollTo({ top: 0 });
  }
  function go(hash) { window.location.hash = hash; if (!hash) route(); }

  // ---- Home: course tiles -------------------------------------------------------
  var ICON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
  function renderHome() {
    $('res-course-grid').innerHTML = COURSES.map(function (c) {
      var n = counts[c.name] || { approved: 0, pending: 0 };
      return '<button type="button" class="res-course-tile res-accent-' + c.accent + '" data-course="' + escapeHtml(c.name) + '">' +
        '<span class="res-course-icon">' + ICON + '</span>' +
        '<span class="res-course-name">' + escapeHtml(c.label || c.name) + '</span>' +
        '<span class="res-course-count">' + n.approved + (n.approved === 1 ? ' resource' : ' resources') + '</span>' +
        (isAdmin && n.pending ? '<span class="res-count-pill res-count-pill--alert res-course-pending">' + n.pending + ' to review</span>' : '') +
        '</button>';
    }).join('');
  }

  // ---- Filters ------------------------------------------------------------------
  function buildFilterOptions() {
    $('res-filter-type').innerHTML = '<option value="">All types</option>' + Object.keys(TYPES).map(function (k) { return '<option value="' + k + '">' + TYPES[k] + '</option>'; }).join('');
    $('res-filter-year').innerHTML = '<option value="">All years</option>' + YEARS.map(function (y) { return '<option>' + y + '</option>'; }).join('');
  }

  // ---- Lists --------------------------------------------------------------------
  function selectCols() { return '*'; }

  function openCourse(name) {
    if (!COURSES.some(function (c) { return c.name === name; })) { go(''); return; }
    currentCourse = name;
    $('res-view-list').hidden = false;
    $('res-filters').hidden = false;
    $('res-list-title').textContent = courseLabel(name);
    $('res-list-sub').textContent = 'Loading…';
    $('res-list').innerHTML = '';
    $('res-empty').hidden = true;
    ['res-search', 'res-filter-type', 'res-filter-source', 'res-filter-year'].forEach(function (id) { $(id).value = ''; });

    supabaseClient.from('resources').select(selectCols()).eq('course', name).eq('status', 'approved').order('approved_at', { ascending: false }).then(function (r) {
      if (r.error) { $('res-list-sub').textContent = "Couldn't load these resources: " + r.error.message; return; }
      courseItems = r.data || [];
      renderCourseList();
    });
  }

  function renderCourseList() {
    var q = $('res-search').value.trim().toLowerCase();
    var type = $('res-filter-type').value;
    var source = $('res-filter-source').value;
    var year = $('res-filter-year').value;
    var rows = courseItems.filter(function (r) {
      if (type && r.resource_type !== type) return false;
      if (source && r.source_type !== source) return false;
      if (year && r.year_of_study !== year) return false;
      if (q && [r.title, r.topic, r.uploader_name, r.description].join(' ').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    $('res-list-sub').textContent = courseItems.length + (courseItems.length === 1 ? ' resource' : ' resources') + (rows.length !== courseItems.length ? ' · showing ' + rows.length : '');
    renderCards($('res-list'), rows, { mode: 'browse' });
    var empty = $('res-empty');
    empty.hidden = rows.length > 0;
    empty.textContent = courseItems.length ? 'Nothing matches those filters.' : 'No resources here yet - be the first to share one!';
  }

  function openSpecial(kind) {
    currentCourse = null;
    $('res-view-list').hidden = false;
    $('res-filters').hidden = true;
    $('res-list').innerHTML = '';
    $('res-empty').hidden = true;
    var isReview = kind === 'review';
    $('res-list-title').textContent = isReview ? 'Review queue' : 'My submissions';
    $('res-list-sub').textContent = 'Loading…';
    var q = supabaseClient.from('resources').select(selectCols());
    q = isReview ? q.eq('status', 'pending').order('created_at', { ascending: true }) : q.eq('uploader_id', userId).order('created_at', { ascending: false });
    q.then(function (r) {
      if (r.error) { $('res-list-sub').textContent = "Couldn't load: " + r.error.message; return; }
      var rows = r.data || [];
      $('res-list-sub').textContent = isReview
        ? (rows.length ? rows.length + ' waiting for review. Nothing here is visible to members until you approve it.' : '')
        : 'Everything you\'ve shared. New or edited resources are reviewed by the executive committee before they appear.';
      renderCards($('res-list'), rows, { mode: isReview ? 'review' : 'mine' });
      var empty = $('res-empty');
      empty.hidden = rows.length > 0;
      empty.textContent = isReview ? 'Nothing waiting - you\'re all caught up.' : 'You haven\'t shared anything yet.';
      var mc = $('res-mine-count');
      if (!isReview) { mc.hidden = !rows.length; mc.textContent = rows.length; }
    });
  }

  // ---- Cards ---------------------------------------------------------------------
  var FILE_ICON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  var LINK_ICON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

  function thumbHtml(r) {
    var ext = extOf(r.file_name);
    if (r.preview_path && cachedUrl(r.preview_path)) return '<img src="' + escapeHtml(cachedUrl(r.preview_path)) + '" alt="" loading="lazy">';
    if (r.kind === 'file' && IMAGE_EXTS.indexOf(ext) !== -1 && cachedUrl(r.file_path)) return '<img src="' + escapeHtml(cachedUrl(r.file_path)) + '" alt="" loading="lazy">';
    if (r.kind === 'link') {
      var u = parseHttpUrl(r.url);
      var yt = youtubeId(u);
      if (yt) return '<img src="https://i.ytimg.com/vi/' + yt + '/hqdefault.jpg" alt="" loading="lazy" referrerpolicy="no-referrer">';
      if (u) return '<span class="res-thumb-fav"><img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(u.hostname) + '&sz=64" alt="" width="32" height="32" loading="lazy" referrerpolicy="no-referrer"><span>' + escapeHtml(u.hostname.replace(/^www\./, '')) + '</span></span>';
      return '<span class="res-thumb-icon">' + LINK_ICON + '</span>';
    }
    return '<span class="res-thumb-icon">' + FILE_ICON + '<span class="res-thumb-ext">' + escapeHtml((ext || 'file').toUpperCase()) + '</span></span>';
  }

  function statusBadge(r) {
    if (r.status === 'pending') return '<span class="res-badge res-badge--pending">Pending review</span>';
    if (r.status === 'rejected') return '<span class="res-badge res-badge--rejected">Not approved</span>';
    return '';
  }

  function cardHtml(r, mode) {
    var domain = '';
    if (r.kind === 'link') { var u = parseHttpUrl(r.url); domain = u ? u.hostname.replace(/^www\./, '') : ''; }
    var metaBits = ['Shared by <strong>' + escapeHtml(r.uploader_name) + '</strong>'];
    if (r.uploader_detail) metaBits.push(escapeHtml(r.uploader_detail));
    metaBits.push(escapeHtml(timeAgo(r.status === 'approved' && r.approved_at ? r.approved_at : r.created_at)));
    var details = [];
    if (r.source_type === 'external') details.push('Source: ' + escapeHtml(r.source_credit || (domain || 'external')));
    if (r.topic) details.push('Topic: ' + escapeHtml(r.topic));
    if (r.kind === 'file' && r.file_name) details.push(escapeHtml(r.file_name) + (r.file_size ? ' (' + formatBytes(r.file_size) + ')' : ''));
    else if (domain) details.push(escapeHtml(domain));

    var openLabel = r.kind === 'link' ? 'Open link' : 'Download';
    var actions = '<button type="button" class="btn btn-outline res-btn" data-res-preview>Preview</button>' +
      '<button type="button" class="btn btn-primary res-btn" data-res-open>' + openLabel + '</button>';
    if (mode === 'review') {
      actions = '<button type="button" class="btn btn-outline res-btn" data-res-preview>Preview</button>' +
        '<button type="button" class="btn btn-primary res-btn" data-res-approve>Approve</button>' +
        '<button type="button" class="btn btn-outline res-btn res-btn--danger" data-res-reject>Reject…</button>';
    } else if (mode === 'mine') {
      actions += '<button type="button" class="btn btn-outline res-btn" data-res-edit>Edit</button>' +
        '<button type="button" class="btn btn-outline res-btn res-btn--danger" data-res-delete>Delete</button>';
    } else if (isAdmin || r.uploader_id === userId) {
      actions += '<button type="button" class="btn btn-outline res-btn res-btn--danger" data-res-delete>Remove</button>';
    }

    var reject = mode === 'mine' && r.status === 'rejected' && r.reject_reason
      ? '<p class="res-reject">Reason: ' + escapeHtml(r.reject_reason) + '</p>' : '';

    return '<article class="res-card" data-id="' + escapeHtml(r.id) + '">' +
      '<div class="res-thumb">' + thumbHtml(r) + '</div>' +
      '<div class="res-body">' +
      '<div class="res-tags"><span class="res-badge">' + escapeHtml(TYPES[r.resource_type] || 'Other') + '</span>' +
      '<span class="res-badge res-badge--' + r.source_type + '">' + (r.source_type === 'personal' ? 'Personal' : 'External') + '</span>' +
      (r.year_of_study ? '<span class="res-badge">' + escapeHtml(r.year_of_study) + '</span>' : '') +
      (mode !== 'browse' ? '<span class="res-badge res-badge--course">' + escapeHtml(courseLabel(r.course)) + '</span>' : '') +
      statusBadge(r) + '</div>' +
      '<h3 class="res-title">' + escapeHtml(r.title) + '</h3>' +
      '<p class="res-desc">' + escapeHtml(r.description) + '</p>' +
      '<p class="res-meta">' + metaBits.join(' · ') + '</p>' +
      (details.length ? '<p class="res-meta res-meta--faint">' + details.join(' · ') + '</p>' : '') +
      reject +
      '<div class="res-actions">' + actions + '</div>' +
      '</div></article>';
  }

  var rendered = {};
  function renderCards(container, rows, opts) {
    rendered = {};
    rows.forEach(function (r) { rendered[r.id] = r; });
    var paths = [];
    rows.forEach(function (r) {
      if (r.preview_path) paths.push(r.preview_path);
      else if (r.kind === 'file' && IMAGE_EXTS.indexOf(extOf(r.file_name)) !== -1) paths.push(r.file_path);
    });
    // Signed thumbnails first so images are in the first paint.
    signedUrls(paths).then(function () {
      container.innerHTML = rows.map(function (r) { return cardHtml(r, opts.mode); }).join('');
      container.setAttribute('data-mode', opts.mode);
    });
  }

  // ---- Dialog plumbing -----------------------------------------------------------
  function openDialog(innerHtml, extraClass) {
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
    requestAnimationFrame(function () {
      backdrop.classList.add('is-in');
      var first = dialog.querySelector('[data-autofocus]') || dialog.querySelector('input, select, textarea, button');
      if (first) first.focus();
    });
    var api = { dialog: dialog };
    function close() {
      document.removeEventListener('keydown', onKey, true);
      backdrop.classList.remove('is-in');
      document.body.classList.remove('guide-open');
      setTimeout(function () { backdrop.remove(); }, 200);
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;
      var focusable = dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], iframe');
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

  // ---- Preview / open ---------------------------------------------------------------
  function openResource(r) {
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

  function previewResource(r) {
    var head = '<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button>' +
      '<span class="guide-eyebrow">' + escapeHtml(TYPES[r.resource_type] || 'Resource') + ' · ' + escapeHtml(courseLabel(r.course)) + '</span>' +
      '<h2 class="guide-title">' + escapeHtml(r.title) + '</h2>';
    var foot = '<p class="res-desc res-desc--full">' + escapeHtml(r.description) + '</p>' +
      '<p class="res-meta">Shared by <strong>' + escapeHtml(r.uploader_name) + '</strong>' + (r.uploader_detail ? ' · ' + escapeHtml(r.uploader_detail) : '') + '</p>' +
      (r.source_type === 'external' ? '<p class="res-meta res-meta--faint">External resource' + (r.source_credit ? ' - source: ' + escapeHtml(r.source_credit) : '') + '. Not created by LACMS - check it before relying on it.</p>' : '<p class="res-meta res-meta--faint">Created by the member who shared it.</p>') +
      '<div class="guide-actions"><button type="button" class="btn btn-primary" data-pv-open>' + (r.kind === 'link' ? 'Open link' : 'Download') + '</button><button type="button" class="btn btn-outline" data-dialog-close>Close</button></div>';

    var dlg;
    if (r.kind === 'link') {
      var u = parseHttpUrl(r.url);
      var yt = youtubeId(u);
      var body = yt
        ? '<div class="res-embed"><iframe src="https://www.youtube-nocookie.com/embed/' + yt + '" title="' + escapeHtml(r.title) + '" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation" referrerpolicy="no-referrer"></iframe></div>'
        : '<div class="res-link-card">' + thumbHtml(r) + '<div><strong>' + escapeHtml(u ? u.hostname.replace(/^www\./, '') : '') + '</strong><span>Opens in a new tab - a website outside LACMS.</span></div></div>';
      dlg = openDialog(head + body + foot);
      wirePreviewOpen(dlg, r);
      return;
    }
    dlg = openDialog(head + '<div class="res-embed res-embed--loading" id="pv-slot"><span class="auth-gate-spinner" aria-hidden="true"></span></div>' + foot);
    wirePreviewOpen(dlg, r);
    var ext = extOf(r.file_name);
    signedUrl(r.file_path).then(function (url) {
      var slot = dlg.dialog.querySelector('#pv-slot');
      if (!slot) return;
      slot.classList.remove('res-embed--loading');
      if (!url) { slot.innerHTML = '<p class="res-meta">Couldn\'t load the preview - you can still download it.</p>'; return; }
      if (ext === 'pdf') slot.innerHTML = '<iframe src="' + escapeHtml(url) + '" title="' + escapeHtml(r.title) + '" loading="lazy"></iframe>';
      else if (IMAGE_EXTS.indexOf(ext) !== -1) slot.innerHTML = '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(r.title) + '">';
      else if (r.preview_path) {
        signedUrl(r.preview_path).then(function (pu) {
          slot.innerHTML = pu ? '<img src="' + escapeHtml(pu) + '" alt="">' : '<div class="res-link-card">' + thumbHtml(r) + '<div><strong>' + escapeHtml(r.file_name || '') + '</strong><span>No inline preview for this file type - download to view.</span></div></div>';
        });
      } else slot.innerHTML = '<div class="res-link-card">' + thumbHtml(r) + '<div><strong>' + escapeHtml(r.file_name || '') + (r.file_size ? ' (' + formatBytes(r.file_size) + ')' : '') + '</strong><span>No inline preview for this file type - download to view.</span></div></div>';
    });
  }
  function wirePreviewOpen(dlg, r) {
    dlg.dialog.querySelector('[data-pv-open]').addEventListener('click', function () { openResource(r); });
  }

  // ---- Delete / approve / reject ----------------------------------------------------
  function deleteResource(r) {
    var own = r.uploader_id === userId;
    var msg = 'Delete "' + r.title + '"' + (own ? '' : ' (shared by ' + r.uploader_name + ')') + '? This can\'t be undone.';
    if (!window.confirm(msg)) return;
    supabaseClient.from('resources').delete().eq('id', r.id).then(function (res) {
      if (res.error) { showToast("Couldn't delete it: " + res.error.message, true); return; }
      var paths = [r.file_path, r.preview_path].filter(Boolean);
      if (paths.length) supabaseClient.storage.from(BUCKET).remove(paths);
      showToast('Deleted.');
      refreshCurrent();
    });
  }

  function reviewResource(r, status, reason) {
    supabaseClient.from('resources').update({ status: status, reject_reason: status === 'rejected' ? (reason || null) : null }).eq('id', r.id).then(function (res) {
      if (res.error) { showToast("Couldn't update it: " + res.error.message, true); return; }
      showToast(status === 'approved' ? '"' + r.title + '" is approved and now visible to members.' : '"' + r.title + '" was not approved.');
      refreshCurrent();
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
    loadCounts().then(function () {
      renderHome();
      var hash = decodeURIComponent((window.location.hash || '').replace(/^#/, ''));
      if (hash.indexOf('c=') === 0) openCourse(hash.slice(2));
      else if (hash === 'review' && isAdmin) openSpecial('review');
      else if (hash === 'mine') openSpecial('mine');
    });
  }

  // ---- Share / edit dialog ------------------------------------------------------------
  function openShareDialog(existing) {
    var editing = !!existing;
    var courseOptions = COURSES.map(function (c) {
      var sel = existing ? existing.course === c.name : (currentCourse === c.name);
      return '<option value="' + escapeHtml(c.name) + '"' + (sel ? ' selected' : '') + '>' + escapeHtml(c.label || c.name) + '</option>';
    }).join('');
    var typeOptions = Object.keys(TYPES).map(function (k) { return '<option value="' + k + '"' + (existing && existing.resource_type === k ? ' selected' : '') + '>' + TYPES[k] + '</option>'; }).join('');
    var yearOptions = '<option value="">Any / not specific</option>' + YEARS.map(function (y) { return '<option' + (existing && existing.year_of_study === y ? ' selected' : '') + '>' + y + '</option>'; }).join('');
    var ex = existing || {};

    var dlg = openDialog(
      '<button type="button" class="guide-close" data-dialog-close aria-label="Cancel">&times;</button>' +
      '<span class="guide-eyebrow">LACMS Resources</span>' +
      '<h2 class="guide-title">' + (editing ? 'Edit your resource' : 'Share a resource') + '</h2>' +
      '<p class="guide-text">' + (isAdmin && !editing
        ? 'As an executive, what you share is published straight away.'
        : 'An executive committee member reviews every resource before it appears for other members' + (editing ? ' - editing sends it back for review.' : '.')) + '</p>' +
      '<form class="guide-form res-form" id="res-form" novalidate>' +
      '<div class="field"><label for="rs-course">Course</label><select id="rs-course">' + courseOptions + '</select></div>' +
      '<div class="field"><label for="rs-title">Title</label><input type="text" id="rs-title" maxlength="140" value="' + escapeHtml(ex.title || '') + '" placeholder="e.g. Cardiovascular physiology - summary notes" data-autofocus></div>' +
      (editing ? '' :
        '<fieldset class="network-admin-fieldset"><legend>What are you sharing?</legend>' +
        '<label class="checkbox-option"><input type="radio" name="rs-kind" value="file" checked> A file I\'m uploading (PDF, Word, PowerPoint, image...)</label>' +
        '<label class="checkbox-option"><input type="radio" name="rs-kind" value="link"> A link to a website, video or tool</label></fieldset>' +
        '<div class="field" data-rs-kind="file"><label for="rs-file">File <span class="guide-optional">(max 25 MB)</span></label>' +
        '<div class="res-drop" id="rs-drop"><input type="file" id="rs-file" accept="' + Object.keys(FILE_TYPES).map(function (e) { return '.' + e; }).join(',') + '"><span id="rs-file-label">Choose a file, or drop it here</span></div></div>' +
        '<div class="field" data-rs-kind="link" hidden><label for="rs-url">Link</label><input type="text" id="rs-url" inputmode="url" placeholder="https://..." autocomplete="off"><div class="res-linkpreview" id="rs-linkpreview" hidden></div></div>') +
      (editing && ex.kind === 'link' ? '<div class="field"><label for="rs-url">Link</label><input type="text" id="rs-url" inputmode="url" value="' + escapeHtml(ex.url || '') + '" autocomplete="off"></div>' : '') +
      '<div class="field"><label for="rs-desc">Description</label><textarea id="rs-desc" maxlength="1500" rows="4" placeholder="What is it, who is it useful for, and how should people use it?">' + escapeHtml(ex.description || '') + '</textarea><span class="guide-count" id="rs-count" aria-live="polite">0 / 1500</span></div>' +
      '<div class="res-form-row"><div class="field"><label for="rs-type">Type</label><select id="rs-type">' + typeOptions + '</select></div>' +
      '<div class="field"><label for="rs-year">Year of study <span class="guide-optional">(optional)</span></label><select id="rs-year">' + yearOptions + '</select></div></div>' +
      '<div class="field"><label for="rs-topic">Topic / module <span class="guide-optional">(optional)</span></label><input type="text" id="rs-topic" maxlength="120" value="' + escapeHtml(ex.topic || '') + '" placeholder="e.g. Cardiology, Pharmacokinetics"></div>' +
      '<fieldset class="network-admin-fieldset"><legend>Where is it from?</legend>' +
      '<label class="checkbox-option"><input type="radio" name="rs-source" value="personal"' + (ex.source_type !== 'external' ? ' checked' : '') + '> My own work</label>' +
      '<label class="checkbox-option"><input type="radio" name="rs-source" value="external"' + (ex.source_type === 'external' ? ' checked' : '') + '> From somewhere else</label></fieldset>' +
      '<div class="field" id="rs-credit-field" hidden><label for="rs-credit">Source / author</label><input type="text" id="rs-credit" maxlength="200" value="' + escapeHtml(ex.source_credit || '') + '" placeholder="Who made it or where it\'s from - e.g. Osmosis, BMJ, Prof. Smith (Lincoln)"></div>' +
      (editing ? '' :
        '<div class="field"><label for="rs-preview">Preview image <span class="guide-optional">(optional, max 2 MB)</span></label><input type="file" id="rs-preview" accept="image/png,image/jpeg,image/webp,image/gif"><span class="guide-count">Shown on the card. Videos and images get a preview automatically.</span></div>') +
      '<p class="guide-error" id="rs-error" role="alert" hidden></p>' +
      '<div class="guide-actions"><button type="submit" class="btn btn-primary" id="rs-submit">' + (editing ? 'Save changes' : (isAdmin ? 'Publish' : 'Submit for review')) + '</button>' +
      '<button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div>' +
      '</form>', 'res-dialog--wide'
    );

    var d = dlg.dialog;
    var form = d.querySelector('#res-form');
    var errorEl = d.querySelector('#rs-error');
    function val(id) { return d.querySelector('#' + id).value.trim(); }
    function kindVal() { return editing ? ex.kind : form.querySelector('input[name="rs-kind"]:checked').value; }
    function sourceVal() { return form.querySelector('input[name="rs-source"]:checked').value; }
    function showError(m) { errorEl.textContent = m; errorEl.hidden = false; errorEl.scrollIntoView({ block: 'nearest' }); }

    var descEl = d.querySelector('#rs-desc');
    var countEl = d.querySelector('#rs-count');
    function updateCount() { countEl.textContent = descEl.value.length + ' / 1500'; }
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
    if (editing && urlInput) { /* existing link: no live preview needed */ }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errorEl.hidden = true;
      var title = val('rs-title');
      var desc = val('rs-desc');
      var kind = kindVal();
      if (title.length < 3) { showError('Give it a title (at least 3 characters).'); return; }
      if (desc.length < 10) { showError('Add a short description (at least 10 characters) so people know what it is.'); return; }
      if (sourceVal() === 'external' && !val('rs-credit')) { showError('Say where it\'s from (the author or website) so it\'s credited properly.'); return; }

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
      submit.textContent = editing ? 'Saving…' : (file ? 'Uploading…' : 'Submitting…');

      var fields = {
        course: val('rs-course'),
        title: title,
        description: desc,
        resource_type: val('rs-type'),
        source_type: sourceVal(),
        source_credit: sourceVal() === 'external' ? val('rs-credit') : null,
        year_of_study: d.querySelector('#rs-year').value || null,
        topic: val('rs-topic') || null
      };
      function fail(message) {
        submit.disabled = false;
        submit.textContent = editing ? 'Save changes' : (isAdmin ? 'Publish' : 'Submit for review');
        showError(message);
      }

      if (editing) {
        if (kind === 'link') fields.url = url;
        supabaseClient.from('resources').update(fields).eq('id', ex.id).then(function (res) {
          if (res.error) { fail("Couldn't save: " + res.error.message); return; }
          dlg.close();
          showToast(isAdmin ? 'Saved.' : 'Saved - it will be reviewed again before it appears.');
          refreshCurrent();
        });
        return;
      }

      var id = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : null;
      if (!id) { fail('Your browser is too old to upload files - try a current one.'); return; }
      var uploaded = [];
      function cleanup() { if (uploaded.length) supabaseClient.storage.from(BUCKET).remove(uploaded); }

      var steps = Promise.resolve();
      var row = Object.assign({ id: id, kind: kind }, fields);
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
        dlg.close();
        showToast(isAdmin ? '"' + title + '" is published.' : 'Thanks! "' + title + '" has been submitted - an executive committee member will review it before it appears.');
        refreshCurrent();
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

  function wireEvents() {
    $('res-share-btn').addEventListener('click', function () { openShareDialog(null); });
    $('res-mine-link').addEventListener('click', function () { go('mine'); });
    $('res-review-link').addEventListener('click', function () { go('review'); });
    $('res-back-btn').addEventListener('click', function () { go(''); });
    $('res-course-grid').addEventListener('click', function (e) {
      var tile = e.target.closest('[data-course]');
      if (tile) go('c=' + encodeURIComponent(tile.getAttribute('data-course')));
    });
    ['res-search', 'res-filter-type', 'res-filter-source', 'res-filter-year'].forEach(function (id) {
      $(id).addEventListener(id === 'res-search' ? 'input' : 'change', renderCourseList);
    });
    $('res-list').addEventListener('click', function (e) {
      var r = cardFromEvent(e);
      if (!r) return;
      if (e.target.closest('[data-res-preview]')) previewResource(r);
      else if (e.target.closest('[data-res-open]')) openResource(r);
      else if (e.target.closest('[data-res-approve]')) reviewResource(r, 'approved');
      else if (e.target.closest('[data-res-reject]')) openRejectDialog(r);
      else if (e.target.closest('[data-res-edit]')) openShareDialog(r);
      else if (e.target.closest('[data-res-delete]')) deleteResource(r);
    });
  }
})();
