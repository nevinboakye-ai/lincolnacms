// Partner space (migration 101): the page a collaborating partner opens from the private link
// the LACMS committee sends them (partner.html#<secret>). Read-only and live: how many people
// replied, the average rating, who'd come again, what went well and what to improve, how people
// heard about it, anonymous comments, plus any headline numbers the committee typed in.
//
// What it shows is decided by the committee and by the database. Names and emails never reach
// this page; comments carry the day only; breakdowns appear once an event has enough replies to
// be anonymous. The link's secret is in the part of the address after the # so it isn't sent to
// the server or passed on as a referrer.
(function () {
  'use strict';

  var root = document.getElementById('pt-root');
  if (!root) return;
  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) {
    root.innerHTML = '<div class="pt-state"><h1>Not connected</h1><p>This page can’t load right now. Please email <a href="mailto:acms@lincolnsu.com">acms@lincolnsu.com</a>.</p></div>';
    return;
  }

  var L = window.LACMS_FEEDBACK_LABELS || { liked: {}, improve: {}, heard: {}, kind: {}, returning: {} };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  var hash = window.location.hash.replace(/^#/, '');
  var token = hash, preview = false;
  if (hash.indexOf('=') !== -1) {
    try { var hp = new URLSearchParams(hash); token = hp.get('t') || ''; preview = hp.get('preview') === '1'; } catch (e) { token = ''; }
  }
  token = String(token || '').replace(/[^a-z0-9]/gi, '');

  var D = null;            // what the database returned
  var view = 'all';        // 'all' or an event slug
  var showAllComments = false;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function pct(n, d) { return d ? Math.round(n / d * 100) : 0; }
  function stars(n) { var s = ''; for (var i = 1; i <= 5; i++) s += i <= Math.round(n) ? '★' : '☆'; return s; }
  function niceDate(key) { if (!key) return ''; var p = String(key).split('-'); return p.length === 3 ? (+p[2]) + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0] : key; }
  function shortDate(key) { var p = String(key).split('-'); return (+p[2]) + ' ' + MONTHS[+p[1] - 1].slice(0, 3); }
  function paragraphs(text) { return String(text || '').split(/\n{2,}/).map(function (t) { return '<p>' + esc(t).replace(/\n/g, '<br>') + '</p>'; }).join(''); }

  // ---- States ---------------------------------------------------------------------------
  function stateHtml(title, text) {
    return '<div class="pt-state"><span class="pt-state-icon" aria-hidden="true">🔒</span><h1>' + esc(title) + '</h1><p>' + text + '</p></div>';
  }
  function showReason(reason) {
    var contact = 'Please get in touch with the LACMS committee at <a href="mailto:acms@lincolnsu.com">acms@lincolnsu.com</a>.';
    if (reason === 'paused') root.innerHTML = stateHtml('This space is paused', 'The committee has paused this link for now. ' + contact);
    else if (reason === 'expired') root.innerHTML = stateHtml('This link has expired', 'Access to this space has ended. ' + contact);
    else root.innerHTML = stateHtml('We couldn’t open this space', 'The link may be incomplete or may have been replaced with a newer one. ' + contact);
  }

  // ---- The numbers for the current view ------------------------------------------------------
  function current() {
    if (view === 'all') return { name: 'All events', stats: D.overall.stats, registered: D.overall.registered, event: null };
    var e = D.events.filter(function (x) { return x.slug === view; })[0];
    return e ? { name: e.name, stats: e.stats, registered: e.registered, event: e } : { name: 'All events', stats: D.overall.stats, registered: D.overall.registered, event: null };
  }
  function feedbackLink(slug) {
    return new URL('feedback.html?event=' + encodeURIComponent(slug) + '&src=' + encodeURIComponent(D.space.source_code), window.location.href.split('#')[0]).href;
  }

  // ---- Drawing --------------------------------------------------------------------------------
  function bars(map, labels, total, cls) {
    var list = Object.keys(map || {}).map(function (k) { return { k: k, n: map[k] }; }).sort(function (a, b) { return b.n - a.n; });
    if (!list.length) return '<p class="pt-muted">Nothing picked yet.</p>';
    return '<ul class="pt-bars">' + list.slice(0, 8).map(function (x) {
      return '<li><span class="pt-bar-label">' + esc(labels[x.k] || x.k) + '</span><span class="pt-bar ' + (cls || '') + '"><span style="width:' + Math.max(4, pct(x.n, total)) + '%"></span></span><span class="pt-bar-n">' + x.n + '</span></li>';
    }).join('') + '</ul>';
  }

  function sparkline(daily) {
    if (!daily || daily.length < 2) return '';
    var w = 560, h = 90, pad = 6;
    var max = Math.max.apply(null, daily.map(function (d) { return d.n; }));
    var step = (w - pad * 2) / (daily.length - 1);
    var pts = daily.map(function (d, i) { return [pad + i * step, h - pad - (d.n / max) * (h - pad * 2)]; });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var area = line + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (h - pad) + ' L' + pts[0][0].toFixed(1) + ' ' + (h - pad) + ' Z';
    return '<div class="pt-card"><h3>Replies over time</h3>' +
      '<svg class="pt-spark" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Replies per day from ' + esc(shortDate(daily[0].d)) + ' to ' + esc(shortDate(daily[daily.length - 1].d)) + '" preserveAspectRatio="none">' +
      '<path d="' + area + '" class="pt-spark-area"/><path d="' + line + '" class="pt-spark-line"/>' +
      pts.map(function (p) { return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" class="pt-spark-dot"/>'; }).join('') + '</svg>' +
      '<div class="pt-spark-axis"><span>' + esc(shortDate(daily[0].d)) + '</span><span>Busiest day: ' + max + ' ' + (max === 1 ? 'reply' : 'replies') + '</span><span>' + esc(shortDate(daily[daily.length - 1].d)) + '</span></div></div>';
  }

  function tilesHtml(c) {
    var s = c.stats, n = s.responses || 0;
    var would = s.would || { yes: 0, maybe: 0, no: 0 };
    var answered = would.yes + would.maybe + would.no;
    var memberReplies = s.respondents ? (s.respondents.member || 0) + (s.respondents.professional || 0) : 0;
    var tiles = '';
    // The numbers the committee typed in, first (they belong to the whole space).
    if (view === 'all' || D.events.length === 1) {
      (D.space.custom_metrics || []).forEach(function (m) {
        tiles += '<div class="pt-tile pt-tile--custom"><span class="pt-big">' + esc(m.value) + '</span><span class="pt-tile-label">' + esc(m.label) + '</span>' + (m.note ? '<small>' + esc(m.note) + '</small>' : '') + '</div>';
      });
    }
    if (c.registered !== null && c.registered !== undefined) {
      tiles += '<div class="pt-tile"><span class="pt-big">' + c.registered + '</span><span class="pt-tile-label">LACMS members registered</span><small>Registrations through the LACMS website</small></div>';
    }
    tiles += '<div class="pt-tile"><span class="pt-big">' + n + '</span><span class="pt-tile-label">' + (n === 1 ? 'feedback reply' : 'feedback replies') + '</span>' +
      (c.registered ? '<small>' + pct(memberReplies, c.registered) + '% of registered members replied</small>' : '') + '</div>';
    if (n) {
      tiles += '<div class="pt-tile pt-tile--rating"><span class="pt-big">' + Number(s.avg_rating).toFixed(1) + '<small> / 5</small></span><span class="pt-stars" aria-hidden="true">' + stars(s.avg_rating) + '</span><span class="pt-tile-label">average rating</span></div>';
      if (answered) tiles += '<div class="pt-tile"><span class="pt-big">' + pct(would.yes, answered) + '%</span><span class="pt-tile-label">would come again</span><small>' + pct(would.maybe, answered) + '% maybe</small></div>';
    }
    if (s.via_partner) tiles += '<div class="pt-tile pt-tile--partner"><span class="pt-big">' + s.via_partner + '</span><span class="pt-tile-label">replies through your link</span><small>' + pct(s.via_partner, n) + '% of all replies</small></div>';
    return '<div class="pt-tiles">' + tiles + '</div>';
  }

  function distHtml(s) {
    var n = s.responses, d = s.rating_dist || [0, 0, 0, 0, 0];
    return '<div class="pt-card"><h3>How people rated it</h3><ul class="pt-dist">' + [5, 4, 3, 2, 1].map(function (v) {
      return '<li><span>' + v + ' ★</span><span class="pt-bar"><span style="width:' + pct(d[v - 1], n) + '%"></span></span><span class="pt-bar-n">' + d[v - 1] + '</span></li>';
    }).join('') + '</ul></div>';
  }

  function audienceHtml(s) {
    var r = s.respondents || {}, n = s.responses;
    var seg = [['member', 'LACMS members', r.member || 0], ['professional', 'Professionals in our network', r.professional || 0], ['guest', 'Guests', r.guest || 0]].filter(function (x) { return x[2] > 0; });
    var html = '<div class="pt-card"><h3>Who replied</h3>' +
      '<div class="pt-split" role="img" aria-label="' + esc(seg.map(function (x) { return x[1] + ' ' + x[2]; }).join(', ')) + '">' + seg.map(function (x, i) { return '<span class="pt-split-' + (i % 3) + '" style="width:' + pct(x[2], n) + '%"></span>'; }).join('') + '</div>' +
      '<ul class="pt-legend">' + seg.map(function (x, i) { return '<li><i class="pt-split-' + (i % 3) + '"></i>' + esc(x[1]) + ' <strong>' + x[2] + '</strong></li>'; }).join('') + '</ul>';
    if (s.guest_kinds && s.guest_kinds.length) {
      html += '<h4>Guests are</h4><ul class="pt-bars">' + s.guest_kinds.map(function (x) {
        return '<li><span class="pt-bar-label">' + esc(L.kind[x.k] || x.k) + '</span><span class="pt-bar"><span style="width:' + Math.max(4, pct(x.n, r.guest || 1)) + '%"></span></span><span class="pt-bar-n">' + x.n + '</span></li>';
      }).join('') + '</ul>';
    }
    if (s.courses && s.courses.length) {
      var mem = (r.member || 0) + (r.professional || 0);
      html += '<h4>Members’ courses</h4><ul class="pt-bars">' + s.courses.map(function (x) {
        return '<li><span class="pt-bar-label">' + esc(x.label) + '</span><span class="pt-bar"><span style="width:' + Math.max(4, pct(x.n, mem || 1)) + '%"></span></span><span class="pt-bar-n">' + x.n + '</span></li>';
      }).join('') + '</ul>';
    } else if (n < 5) {
      html += '<p class="pt-muted">A breakdown by course and type of guest appears once there are 5 replies, so no one can be picked out.</p>';
    }
    return html + '</div>';
  }

  function commentsHtml(s) {
    var list = s.comments || [];
    if (D.space.shows.comments === 'none') return '';
    var mode = D.space.shows.comments === 'all' ? 'All comments, with no names' : 'Comments people were happy for us to quote, with no names';
    if (!list.length) return '<div class="pt-card"><h3>Comments</h3><p class="pt-muted">No comments to show yet.</p></div>';
    var shown = showAllComments ? list : list.slice(0, 6);
    return '<div class="pt-card pt-card--wide"><div class="pt-card-head"><h3>Comments <small>' + list.length + '</small></h3><span class="pt-muted">' + esc(mode) + '</span></div>' +
      '<ul class="pt-comments">' + shown.map(function (c) {
        var who = c.who === 'guest' ? 'Guest' : c.who === 'professional' ? 'Professional' : 'LACMS member';
        return '<li class="pt-comment"><div class="pt-comment-top"><span class="pt-stars" aria-label="' + c.rating + ' out of 5">' + stars(c.rating) + '</span><span class="pt-muted">' + esc(who) + ' · ' + esc(niceDate(c.at)) + '</span></div><p>“' + esc(c.text) + '”</p></li>';
      }).join('') + '</ul>' +
      (list.length > 6 ? '<button type="button" class="pt-link" data-pt-more>' + (showAllComments ? 'Show fewer' : 'Show all ' + list.length) + '</button>' : '') + '</div>';
  }

  function shareHtml() {
    var events = view === 'all' ? D.events : D.events.filter(function (e) { return e.slug === view; });
    return '<div class="pt-card pt-card--wide pt-share"><h3>Help us hear from more people</h3>' +
      '<p>Share the feedback form with your own members or attendees. Replies that come through these links are counted for you above.</p>' +
      '<ul class="pt-links">' + events.map(function (e) {
        var link = feedbackLink(e.slug);
        return '<li><div><strong>' + esc(e.name) + '</strong><span class="pt-link-url">' + esc(link) + '</span></div>' +
          '<div class="pt-link-actions"><button type="button" class="pt-btn" data-pt-copy="' + esc(link) + '">Copy link</button><button type="button" class="pt-btn" data-pt-qr="' + esc(link) + '" data-name="' + esc(e.name) + '">QR code</button></div></li>';
      }).join('') + '</ul><p class="pt-muted" data-pt-status role="status"></p></div>';
  }

  function render() {
    var c = current(), s = c.stats, n = s.responses || 0;
    var sp = D.space;
    var tabs = '';
    if (D.events.length > 1) {
      tabs = '<div class="pt-tabs" role="tablist" aria-label="Choose an event">' + [{ slug: 'all', name: 'All events' }].concat(D.events).map(function (e) {
        return '<button type="button" role="tab" aria-selected="' + (view === e.slug) + '" class="pt-tab' + (view === e.slug ? ' is-on' : '') + '" data-pt-view="' + esc(e.slug) + '">' + esc(e.name) + '</button>';
      }).join('') + '</div>';
    }
    var evCards = '<ul class="pt-events">' + D.events.map(function (e) {
      return '<li><strong>' + esc(e.name) + '</strong><span>' + esc(e.date_text || niceDate(e.starts_on)) + '</span></li>';
    }).join('') + '</ul>';
    var body;
    if (!n) {
      body = tilesHtml(c) + '<div class="pt-card pt-card--wide pt-empty"><h3>No feedback yet</h3><p>Replies will appear here as soon as people send them. You can speed things up by sharing the feedback link below.</p></div>';
    } else {
      body = tilesHtml(c) +
        '<div class="pt-grid">' + distHtml(s) + (s.responses > 0 ? audienceHtml(s) : '') + '</div>' +
        sparkline(s.daily) +
        '<div class="pt-grid"><div class="pt-card"><h3>What went well</h3>' + bars(s.liked, L.liked, n, 'is-good') + '</div>' +
        '<div class="pt-card"><h3>What could be better</h3>' + bars(s.improve, L.improve, n, 'is-warn') + '</div></div>' +
        ((s.heard && Object.keys(s.heard).length) || (s.ideas && s.ideas.length) ? '<div class="pt-grid">' +
          (s.heard && Object.keys(s.heard).length ? '<div class="pt-card"><h3>How people heard about it</h3>' + bars(s.heard, L.heard, Object.keys(s.heard).reduce(function (t, k) { return t + s.heard[k]; }, 0)) + '</div>' : '') +
          (s.ideas && s.ideas.length ? '<div class="pt-card"><h3>Events people would love</h3><ul class="pt-ideas">' + s.ideas.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul></div>' : '') + '</div>' : '') +
        commentsHtml(s);
    }
    root.innerHTML =
      (D.preview ? '<div class="pt-preview">Committee preview: you’re seeing exactly what the partner sees. Views from here aren’t counted.</div>' : '') +
      '<header class="pt-hero"><div class="pt-hero-top"><span class="pt-eyebrow">Partner space' + (sp.partner_name ? ' · ' + esc(sp.partner_name) : '') + '</span>' +
      '<div class="pt-hero-actions"><button type="button" class="pt-btn" data-pt-print>Print or save as PDF</button><button type="button" class="pt-btn" data-pt-csv>Download summary (CSV)</button></div></div>' +
      '<h1>' + esc(sp.name) + '</h1>' + (sp.message ? '<div class="pt-message">' + paragraphs(sp.message) + '</div>' : '') + evCards +
      '<p class="pt-muted pt-live">Live numbers, updated whenever someone replies.' + (sp.expires_on ? ' This link is open until ' + esc(niceDate(sp.expires_on)) + '.' : '') + '</p></header>' +
      tabs + '<div class="pt-view-title"><h2>' + esc(c.name) + '</h2></div>' + body + shareHtml() +
      '<footer class="pt-foot"><p>Names and email addresses are never shown here, and comments carry the day only. Breakdowns appear once an event has at least 5 replies. Questions about this page? <a href="mailto:acms@lincolnsu.com">acms@lincolnsu.com</a></p></footer>' +
      qrHtml();
  }

  // ---- QR code, CSV, copy ----------------------------------------------------------------------------
  var qr = null;
  function qrHtml() {
    if (!qr) return '';
    var img = 'https://api.qrserver.com/v1/create-qr-code/?size=420x420&margin=12&data=' + encodeURIComponent(qr.link);
    return '<div class="pt-qr" data-pt-qr-close><div class="pt-qr-box" role="dialog" aria-modal="true" aria-label="QR code"><button type="button" class="pt-qr-x" data-pt-qr-close aria-label="Close">&times;</button>' +
      '<h3>' + esc(qr.name) + '</h3><img src="' + esc(img) + '" alt="QR code for the feedback form" width="280" height="280"><p>Scanning opens the feedback form for this event.</p>' +
      '<div class="pt-link-actions" style="justify-content:center;"><a class="pt-btn pt-btn--solid" href="' + esc(img) + '" target="_blank" rel="noopener">Open image to save</a><button type="button" class="pt-btn" data-pt-qr-close>Close</button></div></div></div>';
  }
  function csv() {
    var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var rows = [['Event', 'Section', 'Item', 'Value']];
    function add(name, c) {
      var s = c.stats, n = s.responses || 0;
      if (c.registered !== null && c.registered !== undefined) rows.push([name, 'Headline', 'LACMS members registered', c.registered]);
      rows.push([name, 'Headline', 'Feedback replies', n]);
      if (n) {
        rows.push([name, 'Headline', 'Average rating (out of 5)', s.avg_rating]);
        var w = s.would || {}; var a = (w.yes || 0) + (w.maybe || 0) + (w.no || 0);
        if (a) { rows.push([name, 'Headline', 'Would come again (%)', pct(w.yes, a)]); }
        if (s.via_partner) rows.push([name, 'Headline', 'Replies through your link', s.via_partner]);
        (s.rating_dist || []).forEach(function (cnt, i) { rows.push([name, 'Rating', (i + 1) + ' star', cnt]); });
        Object.keys(s.liked || {}).forEach(function (k) { rows.push([name, 'What went well', L.liked[k] || k, s.liked[k]]); });
        Object.keys(s.improve || {}).forEach(function (k) { rows.push([name, 'What could be better', L.improve[k] || k, s.improve[k]]); });
        Object.keys(s.heard || {}).forEach(function (k) { rows.push([name, 'How people heard', L.heard[k] || k, s.heard[k]]); });
        (s.comments || []).forEach(function (cm) { rows.push([name, 'Comment', cm.at + ' | ' + cm.rating + ' stars | ' + cm.who, cm.text]); });
      }
    }
    (D.space.custom_metrics || []).forEach(function (m) { rows.push(['All events', 'Headline', m.label, m.value]); });
    add('All events', { stats: D.overall.stats, registered: D.overall.registered });
    D.events.forEach(function (e) { add(e.name, { stats: e.stats, registered: e.registered }); });
    var blob = new Blob(['﻿' + rows.map(function (r) { return r.map(q).join(','); }).join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lacms-partner-summary.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  root.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('button') : null;
    if (!t) return;
    var v;
    if ((v = t.getAttribute('data-pt-view')) !== null) { view = v; showAllComments = false; render(); return; }
    if (t.hasAttribute('data-pt-more')) { showAllComments = !showAllComments; render(); return; }
    if (t.hasAttribute('data-pt-print')) { window.print(); return; }
    if (t.hasAttribute('data-pt-csv')) { csv(); return; }
    if ((v = t.getAttribute('data-pt-copy')) !== null) {
      var done = function (ok) { var st = root.querySelector('[data-pt-status]'); if (st) st.textContent = ok ? 'Link copied.' : 'Copy this link: ' + v; };
      (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { done(true); }, function () { done(false); });
      return;
    }
    if ((v = t.getAttribute('data-pt-qr')) !== null) { qr = { link: v, name: t.getAttribute('data-name') }; render(); return; }
    if (t.hasAttribute('data-pt-qr-close')) { qr = null; render(); }
  });
  root.addEventListener('mousedown', function (e) { if (e.target.classList && e.target.classList.contains('pt-qr')) { qr = null; render(); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && qr) { qr = null; render(); } });

  // ---- Start -----------------------------------------------------------------------------------------
  if (token.length < 20) { showReason('invalid'); return; }
  supabaseClient.rpc('partner_space_view', { p_token: token, p_preview: preview }).then(function (res) {
    if (res.error || !res.data) {
      if (res.error && /Could not find the function|schema cache/i.test(res.error.message || '')) {
        root.innerHTML = stateHtml('Not switched on yet', 'This feature isn’t ready. Please email <a href="mailto:acms@lincolnsu.com">acms@lincolnsu.com</a>.');
      } else showReason('invalid');
      return;
    }
    if (!res.data.ok) { showReason(res.data.reason); return; }
    D = res.data;
    document.title = D.space.name + ' - LACMS partner space';
    if (D.events.length === 1) view = D.events[0].slug;
    render();
  }, function () { showReason('invalid'); });
})();
