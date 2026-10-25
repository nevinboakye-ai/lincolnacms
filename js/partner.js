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
  function section(title, sub) {
    return '<div class="pt-section-title"><h2>' + esc(title) + '</h2>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div>';
  }

  // Replies per day: a few days read best as columns, a long run as a line.
  function timeCard(daily) {
    if (!daily || daily.length < 2) return '';
    var max = Math.max.apply(null, daily.map(function (d) { return d.n; }));
    var body;
    if (daily.length <= 14) {
      body = '<div class="pt-cols" role="img" aria-label="Replies per day">' + daily.map(function (d) {
        return '<div class="pt-col"><span class="pt-col-n">' + d.n + '</span><span class="pt-col-bar"><span style="height:' + Math.max(6, Math.round(d.n / max * 100)) + '%"></span></span><span class="pt-col-d">' + esc(shortDate(d.d)) + '</span></div>';
      }).join('') + '</div>';
    } else {
      var w = 560, h = 90, pad = 6;
      var step = (w - pad * 2) / (daily.length - 1);
      var pts = daily.map(function (d, i) { return [pad + i * step, h - pad - (d.n / max) * (h - pad * 2)]; });
      var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
      var area = line + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (h - pad) + ' L' + pts[0][0].toFixed(1) + ' ' + (h - pad) + ' Z';
      body = '<svg class="pt-spark" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Replies per day" preserveAspectRatio="none"><path d="' + area + '" class="pt-spark-area"/><path d="' + line + '" class="pt-spark-line"/></svg>' +
        '<div class="pt-spark-axis"><span>' + esc(shortDate(daily[0].d)) + '</span><span>Busiest day: ' + max + '</span><span>' + esc(shortDate(daily[daily.length - 1].d)) + '</span></div>';
    }
    return '<div class="pt-card pt-card--wide"><h3>Replies over time</h3>' + body + '</div>';
  }

  function tile(label, value, note, cls, extra) {
    return '<div class="pt-tile' + (cls ? ' ' + cls : '') + '"><span class="pt-tile-label">' + label + '</span><span class="pt-big">' + value + '</span>' + (extra || '') + (note ? '<small>' + note + '</small>' : '') + '</div>';
  }

  function tilesHtml(c) {
    var s = c.stats, n = s.responses || 0;
    var would = s.would || { yes: 0, maybe: 0, no: 0 };
    var answered = would.yes + would.maybe + would.no;
    var memberReplies = s.respondents ? (s.respondents.member || 0) + (s.respondents.professional || 0) : 0;
    var html = '';
    var custom = (view === 'all' || D.events.length === 1) ? (D.space.custom_metrics || []) : [];
    if (custom.length) {
      html += section('From the event') + '<div class="pt-tiles pt-tiles--custom">' + custom.map(function (m) {
        return tile(esc(m.label), esc(m.value), m.note ? esc(m.note) : '', 'pt-tile--custom');
      }).join('') + '</div>';
    }
    var glance = '';
    if (c.registered !== null && c.registered !== undefined) glance += tile('Members registered', c.registered, 'LACMS members who registered on the website');
    glance += tile('Feedback replies', n, c.registered ? pct(memberReplies, c.registered) + '% of registered members replied' : (n === 1 ? 'reply so far' : 'replies so far'));
    if (n) {
      glance += tile('Average rating', Number(s.avg_rating).toFixed(1) + '<small> / 5</small>', n === 1 ? 'from 1 reply' : 'from ' + n + ' replies', 'pt-tile--rating', '<span class="pt-stars" aria-hidden="true">' + stars(s.avg_rating) + '</span>');
      if (answered) glance += tile('Would come again', pct(would.yes, answered) + '%', pct(would.maybe, answered) + '% maybe · ' + pct(would.no, answered) + '% not really');
    }
    html += section('At a glance', c.name === 'All events' && D.events.length > 1 ? 'Across ' + D.events.length + ' events' : '') + '<div class="pt-tiles">' + glance + '</div>';
    if (s.via_partner) {
      html += '<div class="pt-via"><span class="pt-via-n">' + s.via_partner + '</span><span><strong>' + (s.via_partner === 1 ? 'reply' : 'replies') + ' came through your feedback link</strong> – ' + pct(s.via_partner, n) + '% of all replies. Thank you for sharing it.</span></div>';
    }
    return html;
  }

  function distHtml(s) {
    var n = s.responses, d = s.rating_dist || [0, 0, 0, 0, 0];
    var w = s.would || { yes: 0, maybe: 0, no: 0 };
    var a = w.yes + w.maybe + w.no;
    var again = a ? '<h4>Would they come again?</h4>' +
      '<div class="pt-split" role="img" aria-label="Yes ' + w.yes + ', maybe ' + w.maybe + ', no ' + w.no + '"><span class="pt-split-g" style="width:' + pct(w.yes, a) + '%"></span><span class="pt-split-0" style="width:' + pct(w.maybe, a) + '%"></span><span class="pt-split-m" style="width:' + pct(w.no, a) + '%"></span></div>' +
      '<ul class="pt-legend"><li><i class="pt-split-g"></i>Yes <strong>' + w.yes + '</strong></li><li><i class="pt-split-0"></i>Maybe <strong>' + w.maybe + '</strong></li><li><i class="pt-split-m"></i>Probably not <strong>' + w.no + '</strong></li></ul>' : '';
    return '<div class="pt-card"><h3>How people rated it</h3><ul class="pt-dist">' + [5, 4, 3, 2, 1].map(function (v) {
      return '<li><span>' + v + ' ★</span><span class="pt-bar"><span style="width:' + pct(d[v - 1], n) + '%"></span></span><span class="pt-bar-n">' + d[v - 1] + '</span></li>';
    }).join('') + '</ul>' + again + '</div>';
  }

  function audienceHtml(s) {
    var r = s.respondents || {}, n = s.responses;
    var seg = [['member', 'LACMS members', r.member || 0], ['professional', 'Professionals', r.professional || 0], ['guest', 'Guests', r.guest || 0]].filter(function (x) { return x[2] > 0; });
    var html = '<div class="pt-card"><h3>Who replied</h3>' +
      '<div class="pt-split" role="img" aria-label="' + esc(seg.map(function (x) { return x[1] + ' ' + x[2]; }).join(', ')) + '">' + seg.map(function (x, i) { return '<span class="pt-split-' + (i % 3) + '" style="width:' + pct(x[2], n) + '%"></span>'; }).join('') + '</div>' +
      '<ul class="pt-legend">' + seg.map(function (x, i) { return '<li><i class="pt-split-' + (i % 3) + '"></i>' + esc(x[1]) + ' <strong>' + x[2] + '</strong></li>'; }).join('') + '</ul>';
    if (s.guest_kinds && s.guest_kinds.length) {
      html += '<h4>Guests are</h4>' + barList(s.guest_kinds.map(function (x) { return { label: L.kind[x.k] || x.k, n: x.n }; }), r.guest || 1, '');
    }
    if (s.courses && s.courses.length) {
      html += '<h4>Members’ courses</h4>' + barList(s.courses.map(function (x) { return { label: x.label, n: x.n }; }), (r.member || 0) + (r.professional || 0) || 1, '');
    } else if (n < 5) {
      html += '<p class="pt-note">A breakdown by course and type of guest appears once there are 5 replies, so no one can be picked out.</p>';
    }
    return html + '</div>';
  }

  function barList(list, total, cls) {
    return '<ul class="pt-bars">' + list.slice(0, 8).map(function (x) {
      return '<li><span class="pt-bar-label">' + esc(x.label) + '</span><span class="pt-bar ' + (cls || '') + '"><span style="width:' + Math.max(4, pct(x.n, total)) + '%"></span></span><span class="pt-bar-n">' + x.n + '</span></li>';
    }).join('') + '</ul>';
  }
  function bars(map, labels, total, cls) {
    var list = Object.keys(map || {}).map(function (k) { return { label: labels[k] || k, n: map[k] }; }).sort(function (a, b) { return b.n - a.n; });
    return list.length ? barList(list, total, cls) : '<p class="pt-note">Nothing picked yet.</p>';
  }

  function commentsHtml(s) {
    var list = s.comments || [];
    if (D.space.shows.comments === 'none') return '';
    var mode = D.space.shows.comments === 'all' ? 'All comments, shown without names' : 'Comments people were happy for us to quote, shown without names';
    var head = '<div class="pt-card-head"><h3>Comments <small>' + list.length + '</small></h3><span class="pt-muted">' + esc(mode) + '</span></div>';
    if (!list.length) return '<div class="pt-card pt-card--wide">' + head + '<p class="pt-note">No comments to show yet.</p></div>';
    var shown = showAllComments ? list : list.slice(0, 6);
    return '<div class="pt-card pt-card--wide">' + head +
      '<ul class="pt-comments">' + shown.map(function (c) {
        var who = c.who === 'guest' ? 'Guest' : c.who === 'professional' ? 'Professional' : 'LACMS member';
        return '<li class="pt-comment"><div class="pt-comment-top"><span class="pt-stars" aria-label="' + c.rating + ' out of 5">' + stars(c.rating) + '</span><time class="pt-muted">' + esc(niceDate(c.at)) + '</time></div>' +
          '<p>“' + esc(c.text) + '”</p><span class="pt-comment-who">' + esc(who) + '</span></li>';
      }).join('') + '</ul>' +
      (list.length > 6 ? '<div class="pt-more"><button type="button" class="pt-btn" data-pt-more>' + (showAllComments ? 'Show fewer' : 'Show all ' + list.length + ' comments') + '</button></div>' : '') + '</div>';
  }

  function shareHtml() {
    var events = view === 'all' ? D.events : D.events.filter(function (e) { return e.slug === view; });
    return section('Help us hear from more people') + '<div class="pt-card pt-card--wide pt-share">' +
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
      var heard = s.heard && Object.keys(s.heard).length;
      var ideas = s.ideas && s.ideas.length;
      body = tilesHtml(c) +
        section('How it went') + '<div class="pt-grid">' + distHtml(s) + audienceHtml(s) + '</div>' + timeCard(s.daily) +
        section('What people said') +
        '<div class="pt-grid"><div class="pt-card"><h3>What went well</h3>' + bars(s.liked, L.liked, n, 'is-good') + '</div>' +
        '<div class="pt-card"><h3>What could be better</h3>' + bars(s.improve, L.improve, n, 'is-warn') + '</div></div>' +
        (heard || ideas ? '<div class="pt-grid">' +
          (heard ? '<div class="pt-card"><h3>How people heard about it</h3>' + bars(s.heard, L.heard, Object.keys(s.heard).reduce(function (t, k) { return t + s.heard[k]; }, 0)) + '</div>' : '') +
          (ideas ? '<div class="pt-card"><h3>Events people would love</h3><ul class="pt-ideas">' + s.ideas.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul></div>' : '') + '</div>' : '') +
        commentsHtml(s);
    }
    var viewSub = view === 'all' ? (D.events.length > 1 ? 'Combined across ' + D.events.length + ' events' : '') : (c.event ? (c.event.date_text || niceDate(c.event.starts_on)) : '');
    root.innerHTML =
      (D.preview ? '<div class="pt-preview">Committee preview: you’re seeing exactly what the partner sees. Views from here aren’t counted.</div>' : '') +
      '<header class="pt-hero"><div class="pt-hero-top"><span class="pt-eyebrow">Partner space' + (sp.partner_name ? ' · ' + esc(sp.partner_name) : '') + '</span>' +
      '<div class="pt-hero-actions"><button type="button" class="pt-btn" data-pt-print>Print or save as PDF</button><button type="button" class="pt-btn" data-pt-csv>Download summary (CSV)</button></div></div>' +
      '<h1>' + esc(sp.name) + '</h1>' + (sp.message ? '<div class="pt-message">' + paragraphs(sp.message) + '</div>' : '') + evCards +
      '<p class="pt-muted pt-live">Live numbers, updated whenever someone replies.' + (sp.expires_on ? ' This link is open until ' + esc(niceDate(sp.expires_on)) + '.' : '') + '</p></header>' +
      '<div class="pt-viewbar">' + tabs + '<div class="pt-view-title"><h2>' + esc(c.name) + '</h2>' + (viewSub ? '<span>' + esc(viewSub) + '</span>' : '') + '</div></div>' +
      body + shareHtml() +
      '<footer class="pt-foot"><p>Names and email addresses are never shown here, and comments carry the day only. Breakdowns appear once an event has at least 5 replies. Questions about this page? <a href="mailto:acms@lincolnsu.com">acms@lincolnsu.com</a></p></footer>' +
      qrHtml();
  }

  // ---- QR code, CSV, copy ----------------------------------------------------------------------------
  var qr = null;
  function qrHtml() {
    if (!qr) return '';
    var code = '';
    try { code = window.lacmsQR.svg(qr.link, { size: 280, ecc: 'M' }); } catch (e) { code = ''; }
    return '<div class="pt-qr" data-pt-qr-close><div class="pt-qr-box" role="dialog" aria-modal="true" aria-label="QR code"><button type="button" class="pt-qr-x" data-pt-qr-close aria-label="Close">&times;</button>' +
      '<h3>' + esc(qr.name) + '</h3><div class="pt-qr-img">' + code + '</div><p>Scanning opens the feedback form for this event.</p>' +
      '<div class="pt-link-actions" style="justify-content:center;"><button type="button" class="pt-btn pt-btn--solid" data-pt-qr-save="png">Download PNG</button><button type="button" class="pt-btn" data-pt-qr-save="svg">Download SVG</button><button type="button" class="pt-btn" data-pt-qr-close>Close</button></div></div></div>';
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
    if ((v = t.getAttribute('data-pt-qr-save')) !== null && qr) { window.lacmsQR.download(qr.link, 'feedback-qr-' + qr.name, v, { size: 1024 }); return; }
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
