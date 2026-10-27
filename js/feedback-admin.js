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

  var FBD = window.LACMS_FB;
  var state = { loaded: false, loading: false, error: '', rows: [], regs: {}, events: [], event: 'all', filter: 'all', qr: null, view: 'results', canEdit: false, noResults: false, custom: {}, pubOk: false, pubManage: false, pubOn: {}, pub: null };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function pct(n, d) { return d ? Math.round(n / d * 100) : 0; }
  // A form can leave out the overall rating, so some replies have none.
  function rated(rows) { return rows.filter(function (r) { return typeof r.rating === 'number'; }); }
  function avg(rows) { var rr = rated(rows); return rr.length ? rr.reduce(function (t, r) { return t + r.rating; }, 0) / rr.length : 0; }
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
      supabaseClient.from('site_events').select('slug, name, starts_on, date_text').order('starts_on', { ascending: false, nullsFirst: false }),
      Promise.resolve(supabaseClient.rpc('feedback_forms_can_edit')).then(function (r) { return r; }, function () { return { error: { message: 'x' } }; }),
      Promise.resolve(supabaseClient.rpc('feedback_public_can_manage')).then(function (r) { return r; }, function () { return { error: { message: 'x' } }; }),
      Promise.resolve(supabaseClient.rpc('feedback_public_list')).then(function (r) { return r; }, function () { return { error: { message: 'x' } }; })
    ]).then(function (res) {
      // Showing feedback on the public Events page (migration 105)
      state.pubOk = !!res[5] && !res[5].error;
      state.pubManage = !!res[4] && res[4].data === true;
      state.pubOn = {};
      if (state.pubOk) (res[5].data || []).forEach(function (r) { state.pubOn[r.event_slug] = !!r.enabled; });
      state.loading = false;
      var ce = res[3] || {};
      // The Forms tab is for people who may edit forms (it also shows if migration 104 isn't run yet, to say so).
      state.canEdit = ce.data === true || !!(ce.error && /Could not find the function|schema cache|does not exist/i.test(ce.error.message || ''));
      if (res[0].error && /Not authorized/i.test(res[0].error.message || '') && state.canEdit) {
        // allowed to edit forms but not to read the results
        state.noResults = true; state.view = 'forms'; state.error = ''; state.rows = []; state.loaded = true; render(); return;
      }
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
  function viewTabs() {
    if (!state.canEdit || state.noResults) return '';
    return '<div class="fbb-tabs fba-viewtabs" role="tablist">' + [['results', 'Results'], ['forms', 'Forms']].map(function (t) {
      return '<button type="button" role="tab" class="fbb-tab' + (state.view === t[0] ? ' is-on' : '') + '" data-fba-view="' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '</div>';
  }
  function render() {
    if (!state.loaded) return;
    if (state.error) { root.innerHTML = '<div class="form-note"><span>' + esc(state.error) + '</span></div>'; return; }
    if (state.view === 'forms' && state.canEdit && window.lacmsFeedbackBuilder) {
      root.innerHTML = viewTabs() + '<div id="fbb-root"></div>';
      window.lacmsFeedbackBuilder.mount(document.getElementById('fbb-root'));
      return;
    }
    var rows = selected();
    rows.forEach(function (r) { if (hasAnswers(r)) loadCustom(r.event_slug); });
    var ev = state.event === 'all' ? null : state.events.filter(function (e) { return e.slug === state.event; })[0];
    var html = viewTabs() + toolbarHtml(ev);
    if (!state.rows.length) {
      html += '<div class="fba-empty"><h3>No feedback yet</h3><p>Share an event’s feedback link (or its QR code) at the end of the night and replies will appear here. People who registered are also nudged on their Members Hub.</p></div>';
      root.innerHTML = html + qrHtml() + pubModalHtml();
      return;
    }
    if (!ev) html += eventsTable();
    html += rows.length ? summaryHtml(rows, ev) + detailHtml(rows) + (ev ? customHtml(ev, rows) : '') + commentsHtml(rows, !ev) : '<div class="fba-empty"><p>No responses for this event yet.</p></div>';
    root.innerHTML = html + qrHtml() + pubModalHtml();
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
            '<button type="button" class="btn btn-outline" data-fba-qr="' + esc(link) + '" data-name="' + esc(ev.name) + '" data-slug="' + esc(ev.slug) + '">QR code</button>' +
            (state.pubOk ? '<button type="button" class="btn btn-outline' + (state.pubOn[ev.slug] ? ' is-on' : '') + '" data-fba-pub="' + esc(ev.slug) + '" data-name="' + esc(ev.name) + '">' + (state.pubOn[ev.slug] ? 'On the website' : 'Show on website') + '</button>' : '') +
            (canEmail ? '<button type="button" class="btn btn-outline" data-fba-ask="' + esc(ev.slug) + '">Ask people who registered</button>' : '') : '') +
      (canEmail ? '<button type="button" class="btn btn-outline" data-fba-guests>Email guests</button>' : '') +
      (state.rows.length ? '<button type="button" class="btn btn-outline" data-fba-csv>Download CSV</button>' : '') +
      '</div></div>' +
      '<p class="fba-status" data-fba-status role="status"></p>';
  }

  function eventsTable() {
    var list = state.events.map(function (e) {
      var rs = state.rows.filter(function (r) { return r.event_slug === e.slug; });
      return { e: e, n: rs.length, avg: avg(rs), nr: rated(rs).length, back: pct(rs.filter(function (r) { return r.would_return === 'yes'; }).length, rs.length), reg: state.regs[e.slug] || 0 };
    }).filter(function (x) { return x.n > 0; });
    if (!list.length) return '';
    return '<div class="fba-card"><h3>By event</h3><div class="fba-table" role="table">' +
      '<div class="fba-tr fba-th" role="row"><span role="columnheader">Event</span><span role="columnheader">Replies</span><span role="columnheader">Rating</span><span role="columnheader">Come again</span></div>' +
      list.map(function (x) {
        return '<button type="button" class="fba-tr" role="row" data-fba-open="' + esc(x.e.slug) + '"><span class="fba-name">' + esc(x.e.name) + '</span>' +
          '<span>' + x.n + (x.reg ? ' <small>of ' + x.reg + '</small>' : '') + '</span><span>' + (x.nr ? '<strong>' + x.avg.toFixed(1) + '</strong> <small class="fba-stars">' + stars(x.avg) + '</small>' : '\u2013') + '</span><span>' + x.back + '%</span></button>';
      }).join('') + '</div></div>';
  }

  // "Ama and the welcome team, Dr Okoye" -> ["Ama", "the welcome team", "Dr Okoye"] (counted case-insensitively).
  function thanked(rows) {
    var map = {};
    rows.forEach(function (r) {
      if (!r.shoutouts) return;
      String(r.shoutouts).split(/\s*(?:,|;|&|\+|\n|\band\b)\s*/i).forEach(function (raw) {
        var name = raw.replace(/^(?:and|the)\s+/i, function (m) { return /^the\s/i.test(m) ? m : ''; }).replace(/[.!]+$/, '').trim();
        if (name.length < 2 || name.length > 60) return;
        var key = name.toLowerCase();
        if (!map[key]) map[key] = { label: name, n: 0 };
        map[key].n++;
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.n - a.n || a.label.localeCompare(b.label); });
  }

  function section(title, sub) { return '<div class="fba-section"><h3>' + esc(title) + '</h3>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div>'; }
  function tile(label, value, note, cls, extra) {
    return '<div class="fba-tile' + (cls ? ' ' + cls : '') + '"><span class="fba-tile-label">' + label + '</span><span class="fba-big">' + value + '</span>' + (extra || '') + (note ? '<small>' + note + '</small>' : '') + '</div>';
  }

  function summaryHtml(rows, ev) {
    var n = rows.length, a = avg(rows), nr = rated(rows).length;
    var dist = [5, 4, 3, 2, 1].map(function (v) { return { v: v, n: rows.filter(function (r) { return r.rating === v; }).length }; });
    var w = { yes: 0, maybe: 0, no: 0 };
    rows.forEach(function (r) { if (r.would_return) w[r.would_return]++; });
    var answered = w.yes + w.maybe + w.no;
    var kinds = { member: 0, professional: 0, guest: 0 };
    rows.forEach(function (r) { kinds[r.respondent] = (kinds[r.respondent] || 0) + 1; });
    var anon = rows.filter(function (r) { return r.anonymous; }).length;
    var reg = ev ? state.regs[ev.slug] : Object.keys(state.regs).reduce(function (t, k) { return t + state.regs[k]; }, 0);
    var low = rows.filter(function (r) { return typeof r.rating === 'number' && r.rating <= 2; }).length;
    var seg = [['member', 'Members', kinds.member], ['professional', 'Professionals', kinds.professional], ['guest', 'Guests', kinds.guest]].filter(function (x) { return x[2] > 0; });
    var tiles = tile('Replies', n, ev && reg ? pct(n, reg) + '% of the ' + reg + ' who registered' : (n === 1 ? 'reply so far' : 'replies so far')) +
      (nr ? tile('Average rating', a.toFixed(1) + '<small> / 5</small>', 'from ' + plural(nr, 'rating', 'ratings'), 'fba-tile--rating', '<span class="fba-stars" aria-hidden="true">' + stars(a) + '</span>') : tile('Average rating', '\u2013', 'This form has no overall rating')) +
      tile('Would come again', answered ? pct(w.yes, answered) + '%' : '\u2013', answered ? pct(w.maybe, answered) + '% maybe \u00B7 ' + pct(w.no, answered) + '% not really' : 'No answers yet') +
      tile('Low ratings', low, low ? '1 or 2 stars: worth a look' : 'None: nice', low ? 'fba-tile--warn' : '');
    var ratedCard = '<div class="fba-card"><h3>How people rated it</h3><ul class="fba-dist">' + dist.map(function (d) {
      return '<li><span>' + d.v + ' \u2605</span><span class="fba-bar"><span style="width:' + pct(d.n, nr) + '%"></span></span><span class="fba-bar-n">' + d.n + '</span></li>';
    }).join('') + '</ul></div>';
    var who = '<div class="fba-card"><h3>Who replied</h3><div class="fba-split" role="img" aria-label="' + esc(seg.map(function (x) { return x[1] + ' ' + x[2]; }).join(', ')) + '">' +
      seg.map(function (x, i) { return '<span class="fba-split-' + (i % 3) + '" style="width:' + pct(x[2], n) + '%"></span>'; }).join('') + '</div>' +
      '<ul class="fba-legend">' + seg.map(function (x, i) { return '<li><i class="fba-split-' + (i % 3) + '"></i>' + esc(x[1]) + ' <strong>' + x[2] + '</strong></li>'; }).join('') + '</ul>' +
      (anon ? '<p class="fba-note">' + plural(anon, 'member chose', 'members chose') + ' to reply anonymously.</p>' : '') +
      (answered ? '<h4>Would they come again?</h4><div class="fba-split"><span class="fba-split-g" style="width:' + pct(w.yes, answered) + '%"></span><span class="fba-split-0" style="width:' + pct(w.maybe, answered) + '%"></span><span class="fba-split-m" style="width:' + pct(w.no, answered) + '%"></span></div>' +
        '<ul class="fba-legend"><li><i class="fba-split-g"></i>Yes <strong>' + w.yes + '</strong></li><li><i class="fba-split-0"></i>Maybe <strong>' + w.maybe + '</strong></li><li><i class="fba-split-m"></i>Probably not <strong>' + w.no + '</strong></li></ul>' : '') + '</div>';
    return section('At a glance', ev ? '' : 'All events') + '<div class="fba-tiles">' + tiles + '</div>' +
      section('How it went') + '<div class="fba-two">' + ratedCard + who + '</div>';
  }

  function detailHtml(rows) {
    var n = rows.length;
    var heard = {}; rows.forEach(function (r) { if (r.heard_from) heard[r.heard_from] = (heard[r.heard_from] || 0) + 1; });
    var heardList = Object.keys(heard).map(function (k) { return { k: k, n: heard[k] }; }).sort(function (a, b) { return b.n - a.n; });
    var ideas = rows.filter(function (r) { return r.suggestion; }).slice(0, 10);
    return section('What people said') + '<div class="fba-two">' +
      '<div class="fba-card"><h3>What went well</h3>' + bars(counts(rows, 'liked'), LIKED, n, 'is-good') + typedList(rows, 'liked_other') + '</div>' +
      '<div class="fba-card"><h3>What could be better</h3>' + bars(counts(rows, 'improve'), IMPROVE, n, 'is-warn') + typedList(rows, 'improve_other') + '</div></div>' +
      thankedCard(rows) +
      (heardList.length || ideas.length ? '<div class="fba-two">' +
        '<div class="fba-card"><h3>How people heard</h3>' + (heardList.length ? bars(heardList, HEARD, heardList.reduce(function (t, x) { return t + x.n; }, 0)) : '<p class="sh-muted">Not answered yet.</p>') + '</div>' +
        '<div class="fba-card"><h3>Events people would love</h3>' + (ideas.length ? '<ul class="fba-ideas">' + ideas.map(function (r) { return '<li>' + esc(r.suggestion) + '</li>'; }).join('') + '</ul>' : '<p class="sh-muted">No ideas yet.</p>') + '</div></div>' : '');
  }

  // ---- The questions you wrote yourself ----------------------------------------------------------
  function hasAnswers(r) { return r.answers && typeof r.answers === 'object' && Object.keys(r.answers).length > 0; }
  function loadCustom(slug) {
    if (state.custom[slug]) return;
    state.custom[slug] = { loading: true, items: [] };
    Promise.resolve(supabaseClient.rpc('feedback_form_results', { p_slug: slug })).then(function (res) {
      state.custom[slug] = res.error ? { error: true, items: [] } : { items: res.data || [] };
      if (state.view === 'results') render();
    }, function () { state.custom[slug] = { error: true, items: [] }; });
  }
  function customCard(it) {
    var list = FBD ? FBD.resultList(it) : [];
    var head = '<h3>' + esc(it.title) + (it.archived ? ' <span class="fba-chip is-warn">Removed from the form</span>' : '') + '</h3><p class="fba-note">' + plural(it.total, 'answer', 'answers') + '</p>';
    var body = '';
    if (it.type === 'scale') {
      body += (it.avg !== null && it.avg !== undefined ? '<p class="fba-avg"><strong>' + Number(it.avg).toFixed(1) + '</strong><small> average, out of ' + it.max + '</small></p>' : '');
    }
    if (list.length) {
      body += '<ul class="fba-bars">' + list.map(function (x) {
        return '<li><span class="fba-bar-label">' + esc(x.label) + '</span><span class="fba-bar"><span style="width:' + (x.n ? Math.max(4, pct(x.n, it.total)) : 0) + '%"></span></span><span class="fba-bar-n">' + x.n + '</span></li>';
      }).join('') + '</ul>';
    }
    var texts = it.texts || [];
    if (texts.length) {
      body += '<h4>' + (it.type === 'text' || it.type === 'longtext' ? 'In their own words' : 'Typed under \u201COther\u201D') + '</h4><ul class="fba-typed">' + texts.slice(0, 12).map(function (t) { return '<li>\u201C' + esc(t) + '\u201D</li>'; }).join('') + '</ul>' +
        (texts.length > 12 ? '<p class="fba-note">And ' + (texts.length - 12) + ' more in the responses below.</p>' : '');
    }
    if (!body) body = '<p class="sh-muted">No answers yet.</p>';
    return '<div class="fba-card">' + head + body + '</div>';
  }
  function customHtml(ev, rows) {
    if (!rows.some(hasAnswers)) return '';
    loadCustom(ev.slug);
    var c = state.custom[ev.slug];
    if (!c || !c.items || !c.items.length) return '';
    var items = c.items.filter(function (it) { return it.total > 0 || !it.archived; });
    if (!items.length) return '';
    return section('Your own questions', 'Questions added to this event\u2019s form') + '<div class="fba-two">' + items.map(customCard).join('') + '</div>';
  }
  // The answers to your own questions inside one response card.
  function customLines(r) {
    if (!hasAnswers(r)) return '';
    var c = state.custom[r.event_slug];
    if (!c || !c.items || !c.items.length) return '';
    var lines = c.items.filter(function (it) { return r.answers[it.id]; }).map(function (it) {
      var t = FBD ? FBD.answerText(it, r.answers[it.id]) : '';
      return t ? '<p class="fba-typed-line"><b>' + esc(it.title) + '</b> ' + esc(t) + '</p>' : '';
    }).join('');
    return lines;
  }

  function typedList(rows, field) {
    var list = rows.filter(function (r) { return r[field]; });
    if (!list.length) return '';
    return '<h4>In their own words</h4><ul class="fba-typed">' + list.slice(0, 12).map(function (r) { return '<li>\u201C' + esc(r[field]) + '\u201D</li>'; }).join('') + '</ul>' +
      (list.length > 12 ? '<p class="fba-note">And ' + (list.length - 12) + ' more in the responses below.</p>' : '');
  }
  function thankedCard(rows) {
    var list = thanked(rows);
    if (!list.length) return '';
    var max = list[0].n;
    return '<div class="fba-card"><h3>Who made the night valuable</h3><ul class="fba-bars">' + list.slice(0, 12).map(function (x) {
      return '<li><span class="fba-bar-label">' + esc(x.label) + '</span><span class="fba-bar is-good"><span style="width:' + Math.max(8, Math.round(x.n / max * 100)) + '%"></span></span><span class="fba-bar-n">' + x.n + '</span></li>';
    }).join('') + '</ul>' + (list.length > 12 ? '<p class="fba-note">And ' + (list.length - 12) + ' more names in the responses below.</p>' : '') +
      '<p class="fba-note">Names are counted as typed (a person or a team). Worth a thank-you.</p></div>';
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
      if (f === 'thanks') return !!r.shoutouts;
      if (f === 'low') return typeof r.rating === 'number' && r.rating <= 2;
      if (f === 'quote') return r.quote_ok && r.comment;
      if (f === 'members') return r.respondent !== 'guest';
      if (f === 'guests') return r.respondent === 'guest';
      return true;
    });
    var tabs = [['all', 'All'], ['comments', 'With comments'], ['thanks', 'Thank-yous'], ['low', 'Low ratings'], ['quote', 'OK to quote'], ['members', 'Members'], ['guests', 'Guests']];
    return section('Every response') + '<div class="fba-card"><div class="fba-card-head"><h3>Responses <small>' + list.length + '</small></h3>' +
      '<div class="fba-tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" class="fba-tab' + (f === t[0] ? ' is-on' : '') + '" data-fba-filter="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div></div>' +
      (list.length ? '<ul class="fba-list">' + list.slice(0, 200).map(function (r) {
        var chips = (r.liked || []).map(function (k) { return '<span class="fba-chip is-good">' + esc(LIKED[k] || k) + '</span>'; }).concat((r.improve || []).map(function (k) { return '<span class="fba-chip is-warn">' + esc(IMPROVE[k] || k) + '</span>'; })).join('');
        var hasRating = typeof r.rating === 'number';
        return '<li class="fba-item"><div class="fba-item-top">' + (hasRating ? '<span class="fba-stars' + (r.rating <= 2 ? ' is-low' : '') + '" aria-label="' + r.rating + ' out of 5">' + stars(r.rating) + '</span>' : '<span class="fba-stars is-none">No rating</span>') +
          '<span class="fba-meta">' + (showEvent ? '<strong>' + esc(r.event_name) + '</strong> · ' : '') + esc(when(r.created_at)) + '</span></div>' +
          '<div class="fba-who">' + who(r) + '</div>' +
          (r.comment ? '<p class="fba-comment">“' + esc(r.comment) + '”' + (r.partner_hidden ? ' <span class="fba-chip is-warn">Hidden from partners</span>' : '') + '</p>' : '') +
          (chips ? '<div class="fba-chips">' + chips + '</div>' : '') +
          (r.liked_other ? '<p class="fba-typed-line"><b>Also went well:</b> ' + esc(r.liked_other) + '</p>' : '') +
          (r.improve_other ? '<p class="fba-typed-line"><b>Could be better:</b> ' + esc(r.improve_other) + '</p>' : '') +
          (r.shoutouts ? '<p class="fba-typed-line fba-thanks"><b>Thanked:</b> ' + esc(r.shoutouts) + '</p>' : '') +
          customLines(r) +
          '<div class="fba-item-foot"><span>' + [r.would_return ? esc(RETURN[r.would_return]) : '', r.quote_ok && r.comment ? 'OK to quote' : '', r.wants_updates ? 'Wants updates' : ''].filter(Boolean).join(' · ') + '</span>' +
          '<span class="fba-item-actions">' + publicButtons(r) + ((r.comment || r.liked_other || r.improve_other || r.shoutouts) ? '<button type="button" class="guide-linkbtn" data-fba-hide="' + esc(r.id) + '" data-hidden="' + (r.partner_hidden ? '1' : '0') + '">' + (r.partner_hidden ? 'Show to partners' : 'Hide from partners') + '</button>' : '') +
          '<button type="button" class="guide-linkbtn" data-fba-delete="' + esc(r.id) + '">Delete</button></span></div></li>';
      }).join('') + '</ul>' + (list.length > 200 ? '<p class="sh-muted">Showing the latest 200 – download the CSV for everything.</p>' : '') : '<p class="sh-muted">Nothing matches that filter.</p>') + '</div>';
  }

  // Featuring a quote on the public Events page (only a comment the person said we may quote).
  function publicButtons(r) {
    if (!state.pubOk || !state.pubManage || !r.comment || !r.quote_ok) return '';
    if (r.public_featured) return '<span class="fba-chip is-good">Featured on website</span><button type="button" class="guide-linkbtn" data-fba-feature="' + esc(r.id) + '" data-mode="clear">Remove</button>';
    if (r.public_hidden) return '<span class="fba-chip">Kept off website</span><button type="button" class="guide-linkbtn" data-fba-feature="' + esc(r.id) + '" data-mode="clear">Undo</button>';
    return '<button type="button" class="guide-linkbtn" data-fba-feature="' + esc(r.id) + '" data-mode="feature">Feature on website</button>' +
      '<button type="button" class="guide-linkbtn" data-fba-feature="' + esc(r.id) + '" data-mode="hide">Keep off website</button>';
  }

  function pubModalHtml() {
    var p = state.pub;
    if (!p) return '';
    var body;
    if (p.loading) body = '<p class="sh-muted">Loading\u2026</p>';
    else if (p.error) body = '<div class="form-note"><span>' + esc(p.error) + '</span></div>';
    else {
      var s = p.draft, can = state.pubManage, dis = can ? '' : ' disabled';
      var preview = window.lacmsEventReviews ? window.lacmsEventReviews.html(p.data.preview, 3) : '';
      var nq = p.data.quotable, nf = p.data.featured;
      body = (can ? '' : '<div class="fba-note-box">You can see how this works, but only people with \u201CDashboard: Publish feedback on the website\u201D (Hub Access) can change it.</div>') +
        '<label class="fba-switch"><input type="checkbox" data-pub-f="enabled"' + (s.enabled ? ' checked' : '') + dis + '><span class="fba-switch-ui" aria-hidden="true"></span><span><strong>Show feedback for this event on the Events page</strong><small>' + (s.enabled ? 'It is live: visitors can see what is ticked below.' : 'Switched off: nothing is public.') + '</small></span></label>' +
        '<div class="fba-pub-grid"><label class="fba-chk"><input type="checkbox" data-pub-f="show_rating"' + (s.show_rating ? ' checked' : '') + dis + '><span>Average rating</span></label>' +
        '<label class="fba-chk"><input type="checkbox" data-pub-f="show_return"' + (s.show_return ? ' checked' : '') + dis + '><span>% who would come again</span></label>' +
        '<label class="fba-chk"><input type="checkbox" data-pub-f="show_liked"' + (s.show_liked ? ' checked' : '') + dis + '><span>What people loved</span></label></div>' +
        '<div class="fba-pub-row"><label>Quotes<select data-pub-f="quotes"' + dis + '><option value="off"' + (s.quotes === 'off' ? ' selected' : '') + '>None</option><option value="picked"' + (s.quotes === 'picked' ? ' selected' : '') + '>Only the ones I feature (' + nf + ' picked)</option><option value="auto"' + (s.quotes === 'auto' ? ' selected' : '') + '>Automatic: 4 and 5 star replies</option></select></label>' +
        '<label>Show the rating only if the average is at least<select data-pub-f="min_avg"' + dis + '>' + ['0', '3.5', '4', '4.5'].map(function (v) { return '<option value="' + v + '"' + (Number(s.min_avg) === Number(v) ? ' selected' : '') + '>' + (v === '0' ? 'Always show it' : Number(v).toFixed(1)) + '</option>'; }).join('') + '</select></label></div>' +
        '<p class="fba-note">Only positive, anonymous information ever leaves LACMS: never names or emails, never \u201Cwhat could be better\u201D. Numbers appear once 5 people have replied, and quotes only from people who agreed to be quoted (' + nq + ' for this event). Pick quotes with \u201CFeature on website\u201D on a response below.</p>' +
        '<h4>What visitors would see' + (s.enabled ? '' : ' (once switched on)') + '</h4>' +
        '<div class="fba-pub-preview">' + (preview || '<p class="sh-muted">Nothing to show yet with these settings (it needs at least 5 replies, or a featured quote).</p>') + '</div>' +
        '<div class="fba-tools" style="justify-content:flex-end;">' + (can ? '<button type="button" class="btn btn-primary" data-fba-pub-save' + (p.saving ? ' disabled' : '') + '>' + (p.saving ? 'Saving\u2026' : 'Save') + '</button>' : '') + '<button type="button" class="btn btn-outline" data-fba-pub-close>Close</button></div>' +
        '<p class="fba-status" role="status">' + esc(p.msg || '') + '</p>';
    }
    return '<div class="fba-qr" data-fba-pub-close><div class="fba-qr-box fba-pub-box" role="dialog" aria-modal="true" aria-label="Show on website">' +
      '<button type="button" class="guide-close" data-fba-pub-close aria-label="Close">&times;</button><h3>' + esc(p.name) + '</h3><p class="fba-pub-sub">On the website</p>' + body + '</div></div>';
  }
  function openPub(slug, name) {
    state.pub = { slug: slug, name: name, loading: true };
    render();
    Promise.resolve(supabaseClient.rpc('feedback_public_get', { p_slug: slug })).then(function (res) {
      if (!state.pub || state.pub.slug !== slug) return;
      if (res.error) { state.pub.loading = false; state.pub.error = /Could not find the function|schema cache|does not exist/i.test(res.error.message || '') ? 'This needs migration 105 to be run in Supabase (see README-members-setup.md, section 161).' : res.error.message; }
      else { state.pub.loading = false; state.pub.data = res.data; state.pub.draft = Object.assign({}, res.data.settings); }
      render();
    }, function () { state.pub.loading = false; state.pub.error = 'Could not load.'; render(); });
  }
  var previewTimer = null;
  function previewNow() {
    // the preview follows what is ticked, without saving
    var p = state.pub; if (!p || !p.data) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      Promise.resolve(supabaseClient.rpc('feedback_public_get', { p_slug: p.slug, p_preview: p.draft })).then(function (res) {
        if (res.error || !state.pub || state.pub !== p) return;
        p.data.preview = res.data.preview;
        var box = root.querySelector('.fba-pub-preview');
        var h = window.lacmsEventReviews ? window.lacmsEventReviews.html(p.data.preview, 3) : '';
        if (box) box.innerHTML = h || '<p class="sh-muted">Nothing to show yet with these settings (it needs at least 5 replies, or a featured quote).</p>';
      });
    }, 250);
  }
  function savePub() {
    var p = state.pub; if (!p || p.saving) return;
    p.saving = true; p.msg = ''; render();
    var d = p.draft;
    Promise.resolve(supabaseClient.rpc('feedback_public_save', { p_slug: p.slug, p_enabled: !!d.enabled, p_show_rating: !!d.show_rating, p_show_return: !!d.show_return, p_show_liked: !!d.show_liked, p_quotes: d.quotes, p_min_avg: Number(d.min_avg) })).then(function (res) {
      p.saving = false;
      if (res.error) { p.msg = 'Couldn\u2019t save: ' + res.error.message; render(); return; }
      state.pubOn[p.slug] = !!d.enabled; p.data.settings = Object.assign({}, d);
      p.msg = d.enabled ? 'Saved. This event\u2019s feedback is now on the Events page.' : 'Saved. Nothing about this event is public.';
      render();
    }, function () { p.saving = false; p.msg = 'Couldn\u2019t reach the server.'; render(); });
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
      '<div class="fba-tools" style="justify-content:center;"><button type="button" class="btn btn-primary" data-fba-qr-save="png">Download PNG</button><button type="button" class="btn btn-outline" data-fba-qr-save="svg">Download SVG</button>' + (window.lacmsQRStudio && (function () { var tl = document.querySelector('[data-dash-section="qr"]'); return tl && tl.style.display !== 'none'; })() ? '<button type="button" class="btn btn-outline" data-fba-qr-studio>Customise &amp; save</button>' : '') + '<button type="button" class="btn btn-outline" data-fba-qr-close>Close</button></div>' +
      '<p class="guide-fine">Made right here in your browser. PNG is for slides, SVG is sharp at any poster size.</p></div></div>';
  }

  // ---- Actions ------------------------------------------------------------------------
  function say(msg) { var el = root.querySelector('[data-fba-status]'); if (el) el.textContent = msg; }

  function csv() {
    var slugs = [];
    selected().forEach(function (r) { if (hasAnswers(r) && slugs.indexOf(r.event_slug) === -1) slugs.push(r.event_slug); });
    var need = slugs.filter(function (sl) { return !state.custom[sl] || state.custom[sl].loading; });
    if (!need.length) { return csvNow(); }
    say('Getting the answers to your own questions\u2026');
    Promise.all(need.map(function (sl) {
      return Promise.resolve(supabaseClient.rpc('feedback_form_results', { p_slug: sl })).then(function (res) { state.custom[sl] = res.error ? { error: true, items: [] } : { items: res.data || [] }; });
    })).then(function () { say(''); csvNow(); }, function () { csvNow(); });
  }
  function csvNow() {
    var customCols = [];            // the questions that got an answer in the selected replies
    selected().forEach(function (r) {
      var c = state.custom[r.event_slug];
      if (!c || !c.items) return;
      c.items.forEach(function (it) {
        if (r.answers && r.answers[it.id] && !customCols.some(function (x) { return x.it.id === it.id && x.slug === r.event_slug; })) customCols.push({ it: it, slug: r.event_slug });
      });
    });
    var multiEvent = state.event === 'all';
    var cols = ['Event', 'Date', 'Who', 'Name', 'Email', 'Course', 'Year', 'Guest type', 'Rating', 'Would come again', 'Went well', 'Could be better', 'Also went well (typed)', 'Could be better (typed)', 'Who made the night valuable', 'Comment', 'How they heard', 'Event idea', 'OK to quote', 'Wants updates', 'Anonymous'].concat(customCols.map(function (x) { return (multiEvent ? x.slug + ': ' : '') + x.it.title; }));
    var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [cols.join(',')].concat(selected().map(function (r) {
      return [r.event_name, r.created_at ? r.created_at.slice(0, 10) : '', r.respondent, r.person_name, r.person_email, r.course, r.year_of_study, r.guest_kind ? KIND[r.guest_kind] : '',
        r.rating, r.would_return, (r.liked || []).map(function (k) { return LIKED[k] || k; }).join('; '), (r.improve || []).map(function (k) { return IMPROVE[k] || k; }).join('; '),
        r.liked_other, r.improve_other, r.shoutouts, r.comment, r.heard_from ? HEARD[r.heard_from] || r.heard_from : '', r.suggestion, r.quote_ok ? 'yes' : '', r.wants_updates ? 'yes' : '', r.anonymous ? 'yes' : ''].concat(customCols.map(function (x) {
          return x.slug === r.event_slug && r.answers && r.answers[x.it.id] && FBD ? FBD.answerText(x.it, r.answers[x.it.id]) : '';
        })).map(q).join(',');
    }));
    var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lacms-feedback-' + (state.event === 'all' ? 'all-events' : state.event) + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  root.addEventListener('change', function (e) {
    var pf = e.target && e.target.getAttribute && e.target.getAttribute('data-pub-f');
    if (pf && state.pub && state.pub.draft) {
      var t0 = e.target;
      state.pub.draft[pf] = t0.type === 'checkbox' ? t0.checked : t0.value;
      if (pf === 'enabled') render(); else previewNow();
      return;
    }
    if (e.target && e.target.hasAttribute('data-fba-event')) { state.event = e.target.value; state.filter = 'all'; render(); }
  });
  root.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('button') : null;
    if (!t) return;
    var v;
    if ((v = t.getAttribute('data-fba-view')) !== null) {
      state.view = v; render();
      if (v === 'forms') { var tb = root.querySelector('.fba-viewtabs'); if (tb && tb.scrollIntoView) tb.scrollIntoView({ block: 'nearest' }); }
      return;
    }
    if ((v = t.getAttribute('data-fba-open')) !== null) { state.event = v; state.filter = 'all'; render(); return; }
    if ((v = t.getAttribute('data-fba-filter')) !== null) { state.filter = v; render(); return; }
    if ((v = t.getAttribute('data-fba-copy')) !== null) {
      (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { say('Link copied: ' + v); }, function () { window.prompt('Copy this link:', v); });
      return;
    }
    if ((v = t.getAttribute('data-fba-pub')) !== null) { openPub(v, t.getAttribute('data-name')); return; }
    if (t.hasAttribute('data-fba-pub-close')) { state.pub = null; render(); return; }
    if (t.hasAttribute('data-fba-pub-save')) { savePub(); return; }
    if ((v = t.getAttribute('data-fba-feature')) !== null) {
      var mode = t.getAttribute('data-mode');
      t.disabled = true;
      Promise.resolve(supabaseClient.rpc('feedback_set_public', { p_id: v, p_featured: mode === 'feature', p_hidden: mode === 'hide' })).then(function (res) {
        if (res.error) { t.disabled = false; say('Couldn\u2019t update: ' + res.error.message); return; }
        state.rows.forEach(function (r) { if (r.id === v) { r.public_featured = mode === 'feature'; r.public_hidden = mode === 'hide'; } });
        render();
      });
      return;
    }
    if ((v = t.getAttribute('data-fba-qr')) !== null) { state.qr = { link: v, name: t.getAttribute('data-name'), slug: t.getAttribute('data-slug') }; render(); return; }
    if (t.hasAttribute('data-fba-qr-studio') && state.qr) {
      var qs = state.qr; state.qr = null; render();
      window.lacmsQRStudio.open({ kind: 'event', eventSlug: qs.slug, name: qs.name + ' feedback', caption: 'Scan to give feedback' });
      return;
    }
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
  root.addEventListener('mousedown', function (e) { if (e.target.hasAttribute && e.target.hasAttribute('data-fba-pub-close') && e.target.classList.contains('fba-qr')) { state.pub = null; render(); return; } if (e.target.hasAttribute && e.target.hasAttribute('data-fba-qr-close') && e.target.classList.contains('fba-qr')) { state.qr = null; render(); } });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.pub) { state.pub = null; render(); }
    else if (e.key === 'Escape' && state.qr) { state.qr = null; render(); }
  });

  // ---- Start: load when the tile is opened (and once at the start for its count) ------------
  var card = document.querySelector('[data-dash-section="feedback"]');
  if (card) {
    card.addEventListener('click', function () { if (!state.loaded && !state.loading) load(); });
    if (card.style.display !== 'none') { setTimeout(function () { if (!state.loaded && !state.loading) load(); }, 1500); }
  }
  if (window.location.hash === '#feedback') setTimeout(function () { if (!state.loaded && !state.loading) load(); }, 800);
  window.lacmsFeedbackAdmin = { reload: function () { state.loaded = false; load(); } };
})();
