// Insights for people who share resources (migration 074).
//
// Records what happens to a shared resource - previews opened, files
// downloaded, links clicked - and shows the person who shared it, privately:
//   * a "Your impact" summary and a small metrics row on each card in
//     "My submissions", and
//   * an Insights window per resource: headline numbers, a day-by-day chart
//     (7 / 30 / 90 days), who liked it, who unlocked it (PIN-protected ones),
//     the audience by course, a recent-activity timeline, and a CSV export.
//
// Only the uploader can read any of it - the database checks (see 074).
// Views, downloads and clicks are counts only (nobody is named); names appear
// for likes and unlocks, which people did to their resource on purpose.
// Sixth-form students are shown as "Sixth form student" unless the viewer is
// an executive.
//
// Everything degrades quietly: if migration 074 hasn't been run, nothing is
// recorded and no insights UI appears. This file talks to js/resources.js
// through window.lacmsResourcesApi.
(function () {
  'use strict';

  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;

  var enabled = true;        // flips to false if the migration isn't there
  var byId = {};             // resource id -> headline numbers
  var sent = {};             // "id|event" -> when we last reported it (client-side de-dupe)
  var RANGES = [7, 30, 90];
  var METRICS = [
    { key: 'views', label: 'Views', noun: 'view' },
    { key: 'opens', label: 'Downloads & clicks', noun: 'download or click' },
    { key: 'likes', label: 'Likes', noun: 'like' }
  ];

  function api() { return window.lacmsResourcesApi || null; }
  function esc(s) { var a = api(); return a ? a.escapeHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n(v) { return Number(v) || 0; }
  function fmt(v) { return Number(v).toLocaleString('en-GB'); }
  function plural(count, one, many) { return fmt(count) + ' ' + (count === 1 ? one : many); }
  function missing(error) { return !!(error && (error.code === 'PGRST202' || error.code === '42883' || /could not find the function|does not exist/i.test(error.message || ''))); }

  var ICONS = {
    eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
    comment: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    key: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    users: '<path d="M17 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1"/><circle cx="10" cy="7" r="4"/><path d="M22.5 20v-1a4 4 0 0 0-3-3.87"/><path d="M16.5 3.13a4 4 0 0 1 0 7.75"/>',
    chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    close: '<line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/>'
  };
  function icon(name, cls) {
    return '<svg class="icon ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  // ---- Recording ------------------------------------------------------------
  // event: 'view' | 'download' | 'click'. Fire-and-forget; the database also
  // de-duplicates and ignores the uploader's own activity.
  function record(r, event) {
    var a = api();
    if (!enabled || !a || !r || r.status !== 'approved' || r.uploader_id === a.userId()) return;
    var key = r.id + '|' + event;
    var now = Date.now();
    var window_ms = event === 'view' ? 30 * 60 * 1000 : 10 * 1000;
    if (sent[key] && now - sent[key] < window_ms) return;
    sent[key] = now;
    supabaseClient.rpc('record_resource_event', { p_id: r.id, p_event: event }).then(function (res) {
      if (res.error && missing(res.error)) enabled = false;
    }, function () { /* analytics must never get in the way */ });
  }

  // ---- "My submissions": summary + per-card metrics -----------------------------
  function loadMine(rows) {
    var box = document.getElementById('res-insights-summary');
    if (!enabled || !box) return;
    supabaseClient.rpc('get_my_resource_insights').then(function (res) {
      if (res.error) { if (missing(res.error)) enabled = false; return; }
      byId = {};
      (res.data || []).forEach(function (row) { byId[row.resource_id] = row; });
      renderSummary(box, rows);
      paint();
    }, function () { /* quietly nothing */ });
  }

  function totals() {
    var t = { views: 0, opens: 0, likes: 0, comments: 0, unlocks: 0, count: 0 };
    Object.keys(byId).forEach(function (id) {
      var m = byId[id];
      t.views += n(m.views); t.opens += n(m.downloads) + n(m.clicks); t.likes += n(m.likes); t.comments += n(m.comments); t.unlocks += n(m.unlocks);
      t.count++;
    });
    return t;
  }

  function renderSummary(box, rows) {
    var approved = rows.filter(function (r) { return r.status === 'approved'; });
    if (!approved.length) { box.hidden = true; box.innerHTML = ''; return; }
    var t = totals();
    var top = null;
    approved.forEach(function (r) {
      var m = byId[r.id];
      if (m && (!top || n(m.views) + n(m.likes) * 3 > top.score)) top = { r: r, m: m, score: n(m.views) + n(m.likes) * 3 };
    });
    var tiles = [
      { icon: 'eye', value: t.views, label: 'Views' },
      { icon: 'download', value: t.opens, label: 'Downloads & clicks' },
      { icon: 'heart', value: t.likes, label: 'Likes' },
      { icon: 'comment', value: t.comments, label: 'Comments' }
    ];
    box.innerHTML =
      '<div class="res-ins-summary-head"><span class="res-ins-summary-icon">' + icon('chart') + '</span>' +
      '<div><h3>Your impact</h3><p>Across the ' + plural(approved.length, 'resource', 'resources') + ' you\'ve shared. Only you can see this.</p></div></div>' +
      '<div class="res-ins-tiles">' + tiles.map(function (x) {
        return '<div class="res-ins-tile"><span class="res-ins-tile-icon">' + icon(x.icon) + '</span><strong data-count-to="' + x.value + '">0</strong><span>' + x.label + '</span></div>';
      }).join('') + '</div>' +
      (top && top.score > 0
        ? '<p class="res-ins-top">Most popular: <button type="button" class="res-ins-toplink" data-ins-open="' + esc(top.r.id) + '">' + esc(top.r.title) + '</button> <span>&middot; ' + plural(n(top.m.views), 'view', 'views') + ', ' + plural(n(top.m.likes), 'like', 'likes') + '</span></p>'
        : '<p class="res-ins-top res-ins-top--quiet">Nothing viewed yet - once members open your resources, the numbers show up here.</p>');
    box.hidden = false;
    var a = api();
    Array.prototype.forEach.call(box.querySelectorAll('[data-count-to]'), function (el) {
      var to = n(el.getAttribute('data-count-to'));
      if (a && a.countUp) a.countUp(el, to); else el.textContent = fmt(to);
    });
  }

  function metricsHtml(m, locked, kind) {
    var opens = n(m.downloads) + n(m.clicks);
    var chips = [
      ['eye', n(m.views), 'view', 'views', 'Views'],
      ['download', opens, kind === 'link' ? 'click' : 'download', kind === 'link' ? 'clicks' : 'downloads', kind === 'link' ? 'Link clicks' : 'Downloads'],
      ['heart', n(m.likes), 'like', 'likes', 'Likes'],
      ['comment', n(m.comments), 'comment', 'comments', 'Comments']
    ];
    if (locked) chips.push(['key', n(m.unlocks), 'unlock', 'unlocks', 'People who unlocked it']);
    return chips.map(function (c) {
      return '<span class="res-metric" title="' + esc(c[4]) + '" aria-label="' + esc(plural(c[1], c[2], c[3])) + '">' + icon(c[0]) + '<b>' + fmt(c[1]) + '</b></span>';
    }).join('');
  }

  // Fill the metrics row on every "mine" card that has one.
  function paint() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-metrics]'), function (el) {
      var m = byId[el.getAttribute('data-metrics')];
      if (!m) return;
      el.innerHTML = metricsHtml(m, !!m.is_locked, m.kind);
      el.classList.add('is-ready');
    });
  }

  // ---- The Insights window -----------------------------------------------------
  function niceMax(v) {
    if (v <= 4) return 4;
    var pow = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    var f = v / pow;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  }
  function shortDay(iso) {
    var p = iso.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  function longDay(iso) {
    var p = iso.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  function chartHtml(days, key, metric) {
    var W = 640, H = 200, padL = 34, padR = 6, padT = 12, padB = 26;
    var vals = days.map(function (d) { return n(d[key]); });
    var top = niceMax(Math.max.apply(null, vals.concat([1])));
    var innerW = W - padL - padR, innerH = H - padT - padB;
    var step = innerW / days.length;
    var bw = Math.max(2, step * 0.7);
    var grid = [0, 0.5, 1].map(function (f) {
      var y = padT + innerH - innerH * f;
      return '<line class="res-ins-grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '"/><text class="res-ins-axis" x="' + (padL - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + fmt(Math.round(top * f)) + '</text>';
    }).join('');
    var bars = days.map(function (d, i) {
      var v = vals[i];
      var h = v > 0 ? Math.max(3, (v / top) * innerH) : 0;
      var x = padL + i * step + (step - bw) / 2;
      var label = longDay(d.day) + ': ' + plural(v, metric.noun, metric.noun + 's');
      return '<g class="res-ins-barwrap" tabindex="0" data-i="' + i + '" aria-label="' + esc(label) + '">' +
        '<rect class="res-ins-hit" x="' + (padL + i * step) + '" y="' + padT + '" width="' + step + '" height="' + innerH + '"/>' +
        (h ? '<rect class="res-ins-bar" x="' + x + '" y="' + (padT + innerH - h) + '" width="' + bw + '" height="' + h + '" rx="' + Math.min(3, bw / 2) + '" style="--d:' + Math.min(i, 40) + '"/>' : '<rect class="res-ins-bar is-zero" x="' + x + '" y="' + (padT + innerH - 1.5) + '" width="' + bw + '" height="1.5"/>') +
        '</g>';
    }).join('');
    var ticks = [0, Math.floor((days.length - 1) / 2), days.length - 1].filter(function (v, i, a) { return a.indexOf(v) === i; });
    var xl = ticks.map(function (i) {
      var anchor = i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle';
      var x = i === 0 ? padL : i === days.length - 1 ? W - padR : padL + i * step + step / 2;
      return '<text class="res-ins-axis" x="' + x + '" y="' + (H - 6) + '" text-anchor="' + anchor + '">' + shortDay(days[i].day) + '</text>';
    }).join('');
    return '<svg class="res-ins-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(metric.label + ' per day') + '" preserveAspectRatio="none">' + grid + bars + xl + '</svg>';
  }

  function sum(days, key) { return days.reduce(function (s, d) { return s + n(d[key]); }, 0); }

  function canonCourse(raw) {
    var a = api();
    var lower = String(raw || '').toLowerCase();
    var list = (a && a.courses) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].name !== 'General' && lower.indexOf(list[i].name.toLowerCase()) !== -1) return list[i].label || list[i].name;
    }
    return raw;
  }

  function open(r) {
    var a = api();
    if (!a) return;
    var dlg = a.openDialog(
      '<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button>' +
      '<div data-ins-body><div class="res-ins-loading"><span class="auth-gate-spinner" aria-hidden="true"></span><span>Loading insights…</span></div></div>',
      'res-dialog--insights');
    var body = dlg.dialog.querySelector('[data-ins-body]');
    var state = { range: 30, metric: 'views', data: null, showAllLikes: false };

    function load() {
      return supabaseClient.rpc('get_resource_insight_detail', { p_id: r.id, p_days: 90 }).then(function (res) {
        if (res.error) {
          body.innerHTML = '<p class="res-ins-error">' + esc(missing(res.error) ? 'Insights aren\'t switched on yet (the database update hasn\'t been run).' : res.error.message) + '</p>';
          return;
        }
        state.data = res.data;
        render();
      }, function () { body.innerHTML = '<p class="res-ins-error">Couldn\'t reach the server - check your connection and try again.</p>'; });
    }

    function render() {
      var d = state.data;
      if (!d) return;
      var days = d.daily.slice(-state.range);
      var t = d.totals;
      var isLink = d.resource.kind === 'link';
      var locked = !!d.resource.is_locked;
      var opens = n(t.downloads) + n(t.clicks);
      var kpis = [
        { icon: 'eye', value: n(t.views), label: 'Views', sub: 'Previews opened' },
        { icon: 'users', value: n(t.unique_viewers), label: 'People reached', sub: 'Different members' },
        { icon: 'download', value: opens, label: isLink ? 'Link clicks' : 'Downloads', sub: isLink ? 'Opened your link' : 'Files downloaded' },
        { icon: 'heart', value: n(t.likes), label: 'Likes', sub: 'Members who liked it' },
        { icon: 'comment', value: n(t.comments), label: 'Comments', sub: 'On this resource' }
      ];
      if (locked) kpis.push({ icon: 'key', value: n(t.unlocks), label: 'Unlocked', sub: n(t.failed_pins) ? plural(n(t.failed_pins), 'wrong PIN try', 'wrong PIN tries') : 'Entered your PIN' });

      var metric = METRICS.filter(function (m) { return m.key === state.metric; })[0] || METRICS[0];
      var key = metric.key;
      var rangeTotal = sum(days, key);
      var created = new Date(d.resource.created_at);

      body.innerHTML =
        '<span class="guide-eyebrow">Insights</span>' +
        '<h2 class="guide-title">' + esc(d.resource.title) + '</h2>' +
        '<p class="res-ins-sub">Shared ' + esc(created.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })) + ' &middot; private to you</p>' +
        '<div class="res-ins-kpis">' + kpis.map(function (k) {
          return '<div class="res-ins-kpi"><span class="res-ins-kpi-icon">' + icon(k.icon) + '</span><strong data-count-to="' + k.value + '">0</strong><span class="res-ins-kpi-label">' + esc(k.label) + '</span><small>' + esc(k.sub) + '</small></div>';
        }).join('') + '</div>' +

        '<section class="res-ins-card" aria-labelledby="ins-chart-title">' +
          '<div class="res-ins-card-head"><h3 id="ins-chart-title">Activity</h3>' +
            '<div class="ui-seg res-ins-range" role="radiogroup" aria-label="Time range">' + RANGES.map(function (rg) {
              return '<label class="ui-seg-opt"><input type="radio" name="ins-range" value="' + rg + '"' + (rg === state.range ? ' checked' : '') + '><span>' + rg + ' days</span></label>';
            }).join('') + '</div></div>' +
          '<div class="res-ins-tabs" role="tablist" aria-label="Metric">' + METRICS.map(function (m) {
            return '<button type="button" role="tab" class="res-ins-tab' + (m.key === key ? ' is-active' : '') + '" aria-selected="' + (m.key === key ? 'true' : 'false') + '" data-ins-metric="' + m.key + '">' + esc(m.key === 'opens' ? (isLink ? 'Link clicks' : 'Downloads') : m.label) + '<b>' + fmt(sum(days, m.key)) + '</b></button>';
          }).join('') + '</div>' +
          (rangeTotal === 0
            ? '<p class="res-ins-quiet">No ' + esc(metric.noun) + 's in the last ' + state.range + ' days.</p>'
            : '') +
          '<div class="res-ins-chart" data-ins-chart>' + chartHtml(days, key, { label: key === 'opens' ? (isLink ? 'Link clicks' : 'Downloads') : metric.label, noun: key === 'opens' ? (isLink ? 'click' : 'download') : metric.noun }) +
          '<div class="res-ins-tip" data-ins-tip hidden></div></div>' +
        '</section>' +

        '<div class="res-ins-cols">' +
          '<section class="res-ins-card" aria-labelledby="ins-likes-title"><div class="res-ins-card-head"><h3 id="ins-likes-title">Who liked it</h3><span class="res-ins-count">' + fmt(n(t.likes)) + '</span></div>' + likersHtml(d.likers) + '</section>' +
          '<section class="res-ins-card" aria-labelledby="ins-aud-title"><div class="res-ins-card-head"><h3 id="ins-aud-title">Who it reached</h3></div>' + audienceHtml(d.audience) + '</section>' +
        '</div>' +

        (locked
          ? '<section class="res-ins-card" aria-labelledby="ins-unl-title"><div class="res-ins-card-head"><h3 id="ins-unl-title">Who unlocked it</h3><span class="res-ins-count">' + fmt(n(t.unlocks)) + '</span></div>' +
            peopleList(d.unlockers, 'Nobody has entered your PIN yet.') +
            (n(t.failed_pins) ? '<p class="res-ins-note">' + esc(plural(n(t.failed_pins), 'wrong PIN try', 'wrong PIN tries')) + ' recorded.</p>' : '') +
            '<p class="res-ins-note">Changing the PIN signs everyone out of it until they get the new one.</p></section>'
          : '') +

        '<section class="res-ins-card" aria-labelledby="ins-act-title"><div class="res-ins-card-head"><h3 id="ins-act-title">Recent activity</h3></div>' + activityHtml(d.activity, isLink) + '</section>' +

        '<div class="guide-actions res-ins-actions">' +
          '<button type="button" class="btn btn-outline" data-ins-csv>Download CSV</button>' +
          '<button type="button" class="btn btn-outline" data-ins-refresh>' + icon('refresh') + 'Refresh</button>' +
          '<button type="button" class="btn btn-primary" data-dialog-close>Close</button></div>' +
        '<p class="res-ins-fine">Views, downloads and clicks are counts only - nobody is named. Your own activity isn\'t counted. Likes show who liked it; sixth-form students appear anonymously.</p>';

      Array.prototype.forEach.call(body.querySelectorAll('[data-count-to]'), function (el) {
        var to = n(el.getAttribute('data-count-to'));
        if (a.countUp) a.countUp(el, to); else el.textContent = fmt(to);
      });
    }

    function likersHtml(list) {
      if (!list.length) return '<p class="res-ins-empty">No likes yet. A good description and a clear title help.</p>';
      var shown = state.showAllLikes ? list : list.slice(0, 6);
      return peopleList(shown, '') + (list.length > 6 ? '<button type="button" class="res-ins-more" data-ins-morelikes>' + (state.showAllLikes ? 'Show fewer' : 'Show all ' + list.length) + '</button>' : '');
    }
    function peopleList(list, emptyText) {
      if (!list.length) return '<p class="res-ins-empty">' + esc(emptyText) + '</p>';
      return '<ul class="res-ins-people">' + list.map(function (p) {
        return '<li>' + a.avatarHtml(p.name, 'sm') + '<span class="res-ins-person"><strong>' + esc(p.name) + '</strong>' + (p.detail ? '<small>' + esc(p.detail) + '</small>' : '') + '</span><time datetime="' + esc(p.at) + '">' + esc(a.timeAgo(p.at)) + '</time></li>';
      }).join('') + '</ul>';
    }
    function audienceHtml(list) {
      if (!list.length) return '<p class="res-ins-empty">Nobody has viewed it yet.</p>';
      // Group raw course strings that mean the same course.
      var merged = {};
      list.forEach(function (x) { var k = canonCourse(x.label); merged[k] = (merged[k] || 0) + n(x.count); });
      var rows = Object.keys(merged).map(function (k) { return { label: k, count: merged[k] }; }).sort(function (x, y) { return y.count - x.count; });
      var max = rows[0].count;
      return '<ul class="res-ins-aud">' + rows.map(function (x) {
        return '<li><span class="res-ins-aud-label">' + esc(x.label) + '</span><span class="res-ins-aud-bar"><i style="width:' + Math.max(6, Math.round((x.count / max) * 100)) + '%"></i></span><b>' + fmt(x.count) + '</b></li>';
      }).join('') + '</ul>';
    }
    function activityHtml(list, isLink) {
      if (!list.length) return '<p class="res-ins-empty">Activity will appear here as members view, like and comment.</p>';
      var verbs = { like: 'liked it', comment: 'commented', unlock: 'unlocked it', view: 'viewed it', download: 'downloaded it', click: 'opened your link' };
      var icons = { like: 'heart', comment: 'comment', unlock: 'key', view: 'eye', download: 'download', click: 'link' };
      return '<ol class="res-ins-feed">' + list.slice(0, 15).map(function (x) {
        var who = x.who ? '<strong>' + esc(x.who) + '</strong>' : 'A member';
        return '<li class="res-ins-feed-' + esc(x.type) + '"><span class="res-ins-feed-icon">' + icon(icons[x.type] || 'eye') + '</span><span>' + who + ' ' + esc(verbs[x.type] || x.type) + '</span><time datetime="' + esc(x.at) + '">' + esc(a.timeAgo(x.at)) + '</time></li>';
      }).join('') + '</ol>';
    }

    function csv() {
      var d = state.data;
      if (!d) return;
      function cell(v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
      var lines = [['Resource', d.resource.title].map(cell).join(','), '', ['Date', 'Views', 'Downloads and clicks', 'Likes', 'Comments'].join(',')];
      d.daily.forEach(function (x) { lines.push([x.day, x.views, x.opens, x.likes, x.comments].join(',')); });
      lines.push('', ['Who liked it', 'Detail', 'When'].join(','));
      d.likers.forEach(function (p) { lines.push([p.name, p.detail, p.at].map(cell).join(',')); });
      var blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'insights-' + String(d.resource.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }

    // Chart tooltip (hover or keyboard focus on a day).
    function showTip(group) {
      var tip = body.querySelector('[data-ins-tip]');
      var chart = body.querySelector('[data-ins-chart]');
      if (!tip || !chart || !state.data) return;
      var days = state.data.daily.slice(-state.range);
      var i = +group.getAttribute('data-i');
      var day = days[i];
      var metric = METRICS.filter(function (m) { return m.key === state.metric; })[0];
      var v = n(day[state.metric]);
      tip.innerHTML = '<strong>' + fmt(v) + '</strong> ' + esc(state.metric === 'opens' ? 'downloads & clicks' : metric.label.toLowerCase()) + '<span>' + esc(longDay(day.day)) + '</span>';
      tip.hidden = false;
      var gr = group.getBoundingClientRect();
      var cr = chart.getBoundingClientRect();
      var x = gr.left - cr.left + gr.width / 2;
      tip.style.left = Math.max(60, Math.min(cr.width - 60, x)) + 'px';
    }
    function hideTip() { var tip = body.querySelector('[data-ins-tip]'); if (tip) tip.hidden = true; }

    body.addEventListener('click', function (e) {
      var tab = e.target.closest('[data-ins-metric]');
      if (tab) { state.metric = tab.getAttribute('data-ins-metric'); render(); return; }
      if (e.target.closest('[data-ins-morelikes]')) { state.showAllLikes = !state.showAllLikes; render(); return; }
      if (e.target.closest('[data-ins-csv]')) { csv(); return; }
      if (e.target.closest('[data-ins-refresh]')) {
        body.querySelector('[data-ins-refresh]').disabled = true;
        load();
      }
    });
    body.addEventListener('change', function (e) {
      if (e.target.name === 'ins-range') { state.range = +e.target.value; render(); var c = body.querySelector('input[name="ins-range"]:checked'); if (c) c.focus(); }
    });
    body.addEventListener('mouseover', function (e) { var g = e.target.closest('.res-ins-barwrap'); if (g) showTip(g); });
    body.addEventListener('focusin', function (e) { var g = e.target.closest && e.target.closest('.res-ins-barwrap'); if (g) showTip(g); });
    body.addEventListener('mouseleave', hideTip);
    body.addEventListener('focusout', hideTip);

    load();
  }

  // The "Most popular" link in the summary, and the Insights buttons on cards.
  document.addEventListener('click', function (e) {
    var link = e.target.closest('[data-ins-open]');
    if (!link) return;
    var a = api();
    var r = a && a.getResource(link.getAttribute('data-ins-open'));
    if (r) open(r);
  });

  // If "My submissions" finished rendering before this script arrived, catch up.
  function catchUp() {
    var a = api();
    var list = document.getElementById('res-list');
    if (!a || !list || list.getAttribute('data-mode') !== 'mine') return;
    var rows = Array.prototype.map.call(list.querySelectorAll('.res-card'), function (c) { return a.getResource(c.getAttribute('data-id')); }).filter(Boolean);
    if (rows.length) loadMine(rows);
  }

  window.lacmsResourceInsights = {
    record: record,
    loadMine: loadMine,
    paint: paint,
    open: open,
    isEnabled: function () { return enabled; }
  };
  catchUp();
})();
