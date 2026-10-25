// Dashboard -> Feedback (migration 100): what people said about each event.
//
//   * pick an event (or all of them): how many replied (and out of how many who registered),
//     the average rating and how the ratings split, who would come again, what went well and
//     what to improve (counted from the tap-to-pick reasons), how people heard about it,
//     events people would love, and every comment;
//   * the feedback link for each event, with a QR code to put on a slide or poster;
//   * shortcuts: ask the people who registered for feedback, or write to guests who left
//     their email (both open the Email section with that group chosen);
//   * download everything as a CSV file, or delete a response.
// Anonymous members arrive from the database with no name, email, course or year.
(function () {
  'use strict';

  var root = document.getElementById('feedback-admin-root');
  if (!root) return;
  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;

  var L = window.LACMS_FEEDBACK_LABELS || { liked: {}, improve: {}, heard: {}, kind: {}, returning: {} };
  var LIKED = L.liked, IMPROVE = L.improve, HEARD = L.heard, KIND = L.kind, RETURN = L.returning;

  var state = { loaded: false, loading: false, error: '', rows: [], regs: {}, events: [], event: 'all', filter: 'all', qr: null };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function pct(n, d) { return d ? Math.round(n / d * 100) : 0; }
  function avg(rows) { return rows.length ? rows.reduce(function (t, r) { return t + r.rating; }, 0) / rows.length : 0; }
  function when(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function stars(n) { var s = ''; for (var i = 1; i <= 5; i++) s += i <= Math.round(n) ? '★' : '☆'; return s; }

  // ---- Loading ------------------------------------------------------------------
  function load() {
    if (state.loading) return;
    state.loading = true;
    root.innerHTML = '<p class="sh-muted">Loading…</p>';
    Promise.all([
      supabaseClient.rpc('president_get_feedback'),
      supabaseClient.rpc('president_feedback_registrations'),
      supabaseClient.from('site_events').select('slug, name, starts_on, date_text').order('starts_on', { ascending: false, nullsFirst: false })
    ]).then(function (res) {
      state.loading = false;
      if (res[0].error) {
        state.error = /Could not find the function|schema cache|does not exist/i.test(res[0].error.message || '')
          ? 'Feedback needs migration 100 to be run in Supabase (see README-members-setup.md, section 155).'
          : res[0].error.message;
        state.loaded = true; render(); return;
      }
      state.error = '';
      state.rows = res[0].data || [];
      state.regs = {};
      (res[1].data || []).forEach(function (r) { state.regs[r.event_slug] = Number(r.registered); });
      state.events = (res[2].data || []).map(function (e) { return { slug: e.slug, name: e.name, date: e.starts_on || '' }; });
      // An event that has feedback but is no longer in the list (renamed or deleted) still shows.
      state.rows.forEach(function (r) {
        if (!state.events.some(function (e) { return e.slug === r.event_slug; })) state.events.push({ slug: r.event_slug, name: r.event_name, date: '' });
      });
      state.loaded = true;
      updateCount();
      render();
    }, function () { state.loading = false; state.error = 'Could not load feedback.'; state.loaded = true; render(); });
  }
  function updateCount() {
    var el = document.getElementById('dash-count-feedback');
    if (el) el.textContent = state.rows.length ? plural(state.rows.length, 'response', 'responses') : 'No feedback yet';
  }

  // ---- Numbers ---------------------------------------------------------------------
  function selected() {
    return state.event === 'all' ? state.rows : state.rows.filter(function (r) { return r.event_slug === state.event; });
  }
  function counts(rows, field) {
    var map = {};
    rows.forEach(function (r) { (r[field] || []).forEach(function (k) { map[k] = (map[k] || 0) + 1; }); });
    return Object.keys(map).map(function (k) { return { k: k, n: map[k] }; }).sort(function (a, b) { return b.n - a.n; });
  }
  function bars(list, labels, total, cls) {
    if (!list.length) return '<p class="sh-muted">Nothing picked yet.</p>';
    return '<ul class="fba-bars">' + list.slice(0, 8).map(function (x) {
      return '<li><span class="fba-bar-label">' + esc(labels[x.k] || x.k) + '</span><span class="fba-bar ' + (cls || '') + '"><span style="width:' + Math.max(4, pct(x.n, total)) + '%"></span></span><span class="fba-bar-n">' + x.n + '</span></li>';
    }).join('') + '</ul>';
  }

  // ---- Drawing ------------------------------------------------------------------------
  function render() {
    if (!state.loaded) return;
    if (state.error) { root.innerHTML = '<div class="form-note"><span>' + esc(state.error) + '</span></div>'; return; }
    var rows = selected();
    var ev = state.event === 'all' ? null : state.events.filter(function (e) { return e.slug === state.event; })[0];
    var html = toolbarHtml(ev);
    if (!state.rows.length) {
      html += '<div class="fba-empty"><h3>No feedback yet</h3><p>Share an event’s feedback link (or its QR code) at the end of the night and replies will appear here. People who registered are also nudged on their Members Hub.</p></div>';
      root.innerHTML = html + qrHtml();
      return;
    }
    if (!ev) html += eventsTable();
    html += rows.length ? summaryHtml(rows, ev) + detailHtml(rows) + commentsHtml(rows, !ev) : '<div class="fba-empty"><p>No responses for this event yet.</p></div>';
    root.innerHTML = html + qrHtml();
  }

  function toolbarHtml(ev) {
    var opts = '<option value="all">All events (' + state.rows.length + ')</option>' + state.events.map(function (e) {
      var n = state.rows.filter(function (r) { return r.event_slug === e.slug; }).length;
      return '<option value="' + esc(e.slug) + '"' + (state.event === e.slug ? ' selected' : '') + '>' + esc(e.name) + ' (' + n + ')</option>';
    }).join('');
    var emailCard = document.querySelector('[data-dash-section="email"]');
    var canEmail = !!emailCard && emailCard.style.display !== 'none' && !!window.lacmsEmailCentre;
    var link = ev ? new URL('feedback.html?event=' + encodeURIComponent(ev.slug), window.location.href).href : '';
    return '<div class="fba-toolbar">' +
      '<label class="fba-select"><span class="visually-hidden">Event</span><select data-fba-event>' + opts + '</select></label>' +
      '<div class="fba-tools">' +
      (ev ? '<button type="button" class="btn btn-outline" data-fba-copy="' + esc(link) + '">Copy feedback link</button>' +
            '<button type="button" class="btn btn-outline" data-fba-qr="' + esc(link) + '" data-name="' + esc(ev.name) + '">QR code</button>' +
            (canEmail ? '<button type="button" class="btn btn-outline" data-fba-ask="' + esc(ev.slug) + '">Ask people who registered</button>' : '') : '') +
      (canEmail ? '<button type="button" class="btn btn-outline" data-fba-guests>Email guests</button>' : '') +
      (state.rows.length ? '<button type="button" class="btn btn-outline" data-fba-csv>Download CSV</button>' : '') +
      '</div></div>' +
      '<p class="fba-status" data-fba-status role="status"></p>';
  }

  function eventsTable() {
    var list = state.events.map(function (e) {
      var rs = state.rows.filter(function (r) { return r.event_slug === e.slug; });
      return { e: e, n: rs.length, avg: avg(rs), back: pct(rs.filter(function (r) { return r.would_return === 'yes'; }).length, rs.length), reg: state.regs[e.slug] || 0 };
    }).filter(function (x) { return x.n > 0; });
    if (!list.length) return '';
    return '<div class="fba-card"><h3>By event</h3><div class="fba-table" role="table">' +
      '<div class="fba-tr fba-th" role="row"><span role="columnheader">Event</span><span role="columnheader">Replies</span><span role="columnheader">Rating</span><span role="columnheader">Come again</span></div>' +
      list.map(function (x) {
        return '<button type="button" class="fba-tr" role="row" data-fba-open="' + esc(x.e.slug) + '"><span class="fba-name">' + esc(x.e.name) + '</span>' +
          '<span>' + x.n + (x.reg ? ' <small>of ' + x.reg + '</small>' : '') + '</span><span><strong>' + x.avg.toFixed(1) + '</strong> <small class="fba-stars">' + stars(x.avg) + '</small></span><span>' + x.back + '%</span></button>';
      }).join('') + '</div></div>';
  }

  function summaryHtml(rows, ev) {
    var n = rows.length, a = avg(rows);
    var dist = [5, 4, 3, 2, 1].map(function (v) { return { v: v, n: rows.filter(function (r) { return r.rating === v; }).length }; });
    var yes = rows.filter(function (r) { return r.would_return === 'yes'; }).length;
    var answered = rows.filter(function (r) { return r.would_return; }).length;
    var members = rows.filter(function (r) { return r.respondent !== 'guest'; }).length;
    var anon = rows.filter(function (r) { return r.anonymous; }).length;
    var reg = ev ? state.regs[ev.slug] : Object.keys(state.regs).reduce(function (t, k) { return t + state.regs[k]; }, 0);
    var low = rows.filter(function (r) { return r.rating <= 2; }).length;
    return '<div class="fba-tiles">' +
      '<div class="fba-tile"><span class="fba-big">' + n + '</span><span>' + (n === 1 ? 'response' : 'responses') + '</span>' +
      (ev && reg ? '<small>' + pct(n, reg) + '% of the ' + reg + ' who registered</small>' : '<small>' + members + ' members · ' + (n - members) + ' guests' + (anon ? ' · ' + anon + ' anonymous' : '') + '</small>') + '</div>' +
      '<div class="fba-tile"><span class="fba-big">' + a.toFixed(1) + '</span><span class="fba-stars">' + stars(a) + '</span>' +
      '<ul class="fba-dist">' + dist.map(function (d) { return '<li><span>' + d.v + '★</span><span class="fba-bar"><span style="width:' + pct(d.n, n) + '%"></span></span><span>' + d.n + '</span></li>'; }).join('') + '</ul></div>' +
      '<div class="fba-tile"><span class="fba-big">' + pct(yes, answered) + '%</span><span>would come again</span><small>' + answered + ' answered' + (low ? ' · ' + plural(low, 'low rating', 'low ratings') : '') + '</small></div>' +
      '</div>';
  }

  function detailHtml(rows) {
    var n = rows.length;
    var heard = {}; rows.forEach(function (r) { if (r.heard_from) heard[r.heard_from] = (heard[r.heard_from] || 0) + 1; });
    var heardList = Object.keys(heard).map(function (k) { return { k: k, n: heard[k] }; }).sort(function (a, b) { return b.n - a.n; });
    var ideas = rows.filter(function (r) { return r.suggestion; }).slice(0, 10);
    return '<div class="fba-two">' +
      '<div class="fba-card"><h3>What went well</h3>' + bars(counts(rows, 'liked'), LIKED, n, 'is-good') + '</div>' +
      '<div class="fba-card"><h3>What could be better</h3>' + bars(counts(rows, 'improve'), IMPROVE, n, 'is-warn') + '</div></div>' +
      (heardList.length || ideas.length ? '<div class="fba-two">' +
        '<div class="fba-card"><h3>How people heard</h3>' + (heardList.length ? bars(heardList, HEARD, heardList.reduce(function (t, x) { return t + x.n; }, 0)) : '<p class="sh-muted">Not answered yet.</p>') + '</div>' +
        '<div class="fba-card"><h3>Events people would love</h3>' + (ideas.length ? '<ul class="fba-ideas">' + ideas.map(function (r) { return '<li>' + esc(r.suggestion) + '</li>'; }).join('') + '</ul>' : '<p class="sh-muted">No ideas yet.</p>') + '</div></div>' : '');
  }

  function who(r) {
    if (r.respondent === 'guest') {
      return 'Guest' + (r.person_name ? ' · ' + esc(r.person_name) : '') + (r.person_email ? ' · <a href="mailto:' + esc(r.person_email) + '">' + esc(r.person_email) + '</a>' : '') + (r.guest_kind ? ' · ' + esc(KIND[r.guest_kind] || r.guest_kind) : '');
    }
    if (r.anonymous) return (r.respondent === 'professional' ? 'Professional' : 'Member') + ' · anonymous';
    return (r.respondent === 'professional' ? 'Professional' : 'Member') + ' · ' + esc(r.person_name || 'Unknown') + (r.course ? ' · ' + esc(r.course) + (r.year_of_study ? ', ' + esc(r.year_of_study) : '') : '');
  }

  function commentsHtml(rows, showEvent) {
    var f = state.filter;
    var list = rows.filter(function (r) {
      if (f === 'comments') return !!r.comment;
      if (f === 'low') return r.rating <= 2;
      if (f === 'quote') return r.quote_ok && r.comment;
      if (f === 'members') return r.respondent !== 'guest';
      if (f === 'guests') return r.respondent === 'guest';
      return true;
    });
    var tabs = [['all', 'All'], ['comments', 'With comments'], ['low', 'Low ratings'], ['quote', 'OK to quote'], ['members', 'Members'], ['guests', 'Guests']];
    return '<div class="fba-card"><div class="fba-card-head"><h3>Responses <small>' + list.length + '</small></h3>' +
      '<div class="fba-tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" class="fba-tab' + (f === t[0] ? ' is-on' : '') + '" data-fba-filter="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div></div>' +
      (list.length ? '<ul class="fba-list">' + list.slice(0, 200).map(function (r) {
        var chips = (r.liked || []).map(function (k) { return '<span class="fba-chip is-good">' + esc(LIKED[k] || k) + '</span>'; }).concat((r.improve || []).map(function (k) { return '<span class="fba-chip is-warn">' + esc(IMPROVE[k] || k) + '</span>'; })).join('');
        return '<li class="fba-item"><div class="fba-item-top"><span class="fba-stars' + (r.rating <= 2 ? ' is-low' : '') + '" aria-label="' + r.rating + ' out of 5">' + stars(r.rating) + '</span>' +
          '<span class="fba-meta">' + (showEvent ? '<strong>' + esc(r.event_name) + '</strong> · ' : '') + esc(when(r.created_at)) + '</span></div>' +
          '<div class="fba-who">' + who(r) + '</div>' +
          (r.comment ? '<p class="fba-comment">“' + esc(r.comment) + '”' + (r.partner_hidden ? ' <span class="fba-chip is-warn">Hidden from partners</span>' : '') + '</p>' : '') +
          (chips ? '<div class="fba-chips">' + chips + '</div>' : '') +
          '<div class="fba-item-foot"><span>' + [r.would_return ? esc(RETURN[r.would_return]) : '', r.quote_ok && r.comment ? 'OK to quote' : '', r.wants_updates ? 'Wants updates' : ''].filter(Boolean).join(' · ') + '</span>' +
          '<span class="fba-item-actions">' + (r.comment ? '<button type="button" class="guide-linkbtn" data-fba-hide="' + esc(r.id) + '" data-hidden="' + (r.partner_hidden ? '1' : '0') + '">' + (r.partner_hidden ? 'Show to partners' : 'Hide from partners') + '</button>' : '') +
          '<button type="button" class="guide-linkbtn" data-fba-delete="' + esc(r.id) + '">Delete</button></span></div></li>';
      }).join('') + '</ul>' + (list.length > 200 ? '<p class="sh-muted">Showing the latest 200 – download the CSV for everything.</p>' : '') : '<p class="sh-muted">Nothing matches that filter.</p>') + '</div>';
  }

  function qrHtml() {
    if (!state.qr) return '';
    var code = '';
    try { code = window.lacmsQR.svg(state.qr.link, { size: 300, ecc: 'M' }); } catch (e) { code = '<p class="sh-muted">Couldn\u2019t make the code.</p>'; }
    return '<div class="fba-qr" data-fba-qr-close><div class="fba-qr-box" role="dialog" aria-modal="true" aria-label="QR code">' +
      '<button type="button" class="guide-close" data-fba-qr-close aria-label="Close">&times;</button>' +
      '<h3>' + esc(state.qr.name) + '</h3><div class="fba-qr-img">' + code + '</div>' +
      '<p>Show it on the last slide or print it on a poster. Scanning opens the feedback form for this event.</p>' +
      '<p class="fba-link">' + esc(state.qr.link) + '</p>' +
      '<div class="fba-tools" style="justify-content:center;"><button type="button" class="btn btn-primary" data-fba-qr-save="png">Download PNG</button><button type="button" class="btn btn-outline" data-fba-qr-save="svg">Download SVG</button><button type="button" class="btn btn-outline" data-fba-qr-close>Close</button></div>' +
      '<p class="guide-fine">Made right here in your browser. PNG is for slides, SVG is sharp at any poster size.</p></div></div>';
  }

  // ---- Actions ------------------------------------------------------------------------
  function say(msg) { var el = root.querySelector('[data-fba-status]'); if (el) el.textContent = msg; }

  function csv() {
    var cols = ['Event', 'Date', 'Who', 'Name', 'Email', 'Course', 'Year', 'Guest type', 'Rating', 'Would come again', 'Went well', 'Could be better', 'Comment', 'How they heard', 'Event idea', 'OK to quote', 'Wants updates', 'Anonymous'];
    var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [cols.join(',')].concat(selected().map(function (r) {
      return [r.event_name, r.created_at ? r.created_at.slice(0, 10) : '', r.respondent, r.person_name, r.person_email, r.course, r.year_of_study, r.guest_kind ? KIND[r.guest_kind] : '',
        r.rating, r.would_return, (r.liked || []).map(function (k) { return LIKED[k] || k; }).join('; '), (r.improve || []).map(function (k) { return IMPROVE[k] || k; }).join('; '),
        r.comment, r.heard_from ? HEARD[r.heard_from] || r.heard_from : '', r.suggestion, r.quote_ok ? 'yes' : '', r.wants_updates ? 'yes' : '', r.anonymous ? 'yes' : ''].map(q).join(',');
    }));
    var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lacms-feedback-' + (state.event === 'all' ? 'all-events' : state.event) + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  root.addEventListener('change', function (e) {
    if (e.target && e.target.hasAttribute('data-fba-event')) { state.event = e.target.value; state.filter = 'all'; render(); }
  });
  root.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('button') : null;
    if (!t) return;
    var v;
    if ((v = t.getAttribute('data-fba-open')) !== null) { state.event = v; state.filter = 'all'; render(); return; }
    if ((v = t.getAttribute('data-fba-filter')) !== null) { state.filter = v; render(); return; }
    if ((v = t.getAttribute('data-fba-copy')) !== null) {
      (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { say('Link copied: ' + v); }, function () { window.prompt('Copy this link:', v); });
      return;
    }
    if ((v = t.getAttribute('data-fba-qr')) !== null) { state.qr = { link: v, name: t.getAttribute('data-name') }; render(); return; }
    if ((v = t.getAttribute('data-fba-qr-save')) !== null && state.qr) { window.lacmsQR.download(state.qr.link, 'feedback-qr-' + state.qr.name, v, { size: 1024 }); return; }
    if (t.hasAttribute('data-fba-qr-close')) { state.qr = null; render(); return; }
    if (t.hasAttribute('data-fba-csv')) { csv(); return; }
    if ((v = t.getAttribute('data-fba-ask')) !== null) {
      if (window.lacmsEmailCentre) window.lacmsEmailCentre.open('ev_registrants', { event: v, template: 'fb-request' });
      return;
    }
    if (t.hasAttribute('data-fba-guests')) { if (window.lacmsEmailCentre) window.lacmsEmailCentre.open('fb_guests'); return; }
    if ((v = t.getAttribute('data-fba-hide')) !== null) {
      var hide = t.getAttribute('data-hidden') !== '1';
      t.disabled = true;
      supabaseClient.rpc('feedback_set_partner_hidden', { p_id: v, p_hidden: hide }).then(function (res) {
        if (res.error) { t.disabled = false; say('Couldn\u2019t update: ' + res.error.message); return; }
        state.rows.forEach(function (r) { if (r.id === v) r.partner_hidden = hide; });
        render();
      });
      return;
    }
    if ((v = t.getAttribute('data-fba-delete')) !== null) {
      if (!window.confirm('Delete this response? This can’t be undone (the person can then send feedback again).')) return;
      t.disabled = true;
      supabaseClient.rpc('president_delete_feedback', { p_id: v }).then(function (res) {
        if (res.error) { t.disabled = false; say('Couldn’t delete: ' + res.error.message); return; }
        state.rows = state.rows.filter(function (r) { return r.id !== v; });
        updateCount(); render();
      });
    }
  });
  root.addEventListener('mousedown', function (e) { if (e.target.hasAttribute && e.target.hasAttribute('data-fba-qr-close') && e.target.classList.contains('fba-qr')) { state.qr = null; render(); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.qr) { state.qr = null; render(); } });

  // ---- Start: load when the tile is opened (and once at the start for its count) ------------
  var card = document.querySelector('[data-dash-section="feedback"]');
  if (card) {
    card.addEventListener('click', function () { if (!state.loaded && !state.loading) load(); });
    if (card.style.display !== 'none') { setTimeout(function () { if (!state.loaded && !state.loading) load(); }, 1500); }
  }
  if (window.location.hash === '#feedback') setTimeout(function () { if (!state.loaded && !state.loading) load(); }, 800);
  window.lacmsFeedbackAdmin = { reload: function () { state.loaded = false; load(); } };
})();
