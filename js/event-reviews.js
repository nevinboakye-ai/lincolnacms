// What people said about past events, on the public Events page (migration 105).
//
// The committee switches this on event by event (Dashboard -> Feedback -> an event -> "Show on
// website") and chooses what appears. The database decides what may leave: only positive,
// aggregated information, never names or emails, only quotes people agreed to share, and a rating
// only when enough people gave one. This file just draws what it is given, under each event.
//
// window.lacmsEventReviews.html(entry) draws one event's block; the dashboard reuses it for its preview.
(function () {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var LIKED = (window.LACMS_FEEDBACK_LABELS && window.LACMS_FEEDBACK_LABELS.liked) || {};

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function stars(n) { var s = ''; for (var i = 1; i <= 5; i++) s += i <= Math.round(n) ? '★' : '☆'; return s; }
  function month(key) { var p = String(key || '').split('-'); return p.length === 2 && MONTHS[+p[1] - 1] ? MONTHS[+p[1] - 1] + ' ' + p[0] : ''; }

  // entry = { replies, rating: {avg, count}|null, would: {yes_pct, count}|null, liked: [{k, n}], quotes: [{text, who, at}] }
  // collapsed = true (the Events page): just a one-line summary, and the loved-tags and quotes open when it is clicked.
  var uid = 0;
  function html(entry, maxQuotes, collapsed) {
    if (!entry) return '';
    var top = '';
    if (entry.rating) {
      top += '<span class="evr-rating"><span class="evr-stars" aria-hidden="true">' + stars(entry.rating.avg) + '</span><strong>' + Number(entry.rating.avg).toFixed(1) + '</strong>' +
        '<small>' + (collapsed ? '(' + entry.rating.count + ')' : 'from ' + entry.rating.count + ' ratings') + '</small></span>';
    }
    if (entry.would) top += '<span class="evr-pill">' + entry.would.yes_pct + '% would come again</span>';
    var liked = (entry.liked || []).map(function (x) { return '<li>' + esc(LIKED[x.k] || x.k) + '</li>'; }).join('');
    var quotes = (entry.quotes || []).slice(0, maxQuotes || 2).map(function (q) {
      return '<blockquote class="evr-quote"><p>\u201C' + esc(q.text) + '\u201D</p><cite>' + esc(q.who) + (month(q.at) ? ' \u00B7 ' + esc(month(q.at)) : '') + '</cite></blockquote>';
    }).join('');
    if (!top && !liked && !quotes) return '';
    var more = (liked ? '<div class="evr-liked"><span>What people loved</span><ul>' + liked + '</ul></div>' : '') + quotes;
    if (!collapsed) return '<div class="evr">' + (top ? '<div class="evr-top">' + top + '</div>' : '') + more + '</div>';
    if (!more) return '<div class="evr evr--min"><div class="evr-top">' + top + '</div></div>';
    var id = 'evr-' + (++uid);
    return '<div class="evr evr--min"><button type="button" class="evr-toggle" aria-expanded="false" aria-controls="' + id + '">' +
      (top ? '<span class="evr-top">' + top + '</span>' : '') + '<span class="evr-more">' + (top ? 'What people said' : 'See what people said') +
      '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></span></button>' +
      '<div class="evr-body" id="' + id + '" hidden>' + more + '</div></div>';
  }
  window.lacmsEventReviews = { html: html };

  // ---- The Events page ---------------------------------------------------------------------
  var list = document.querySelector('[data-events-from-db]');
  if (!list) return;
  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;

  var data = null, busy = false;

  function place() {
    if (!data || !data.length) return;
    data.forEach(function (entry) {
      var row = document.getElementById(entry.slug);
      if (!row || !row.classList.contains('event-row') || row.querySelector('.evr')) return;
      var block = html(entry, 2, true);
      var col = row.children[1];
      if (!block || !col) return;
      col.insertAdjacentHTML('beforeend', block);
      var box = col.lastElementChild, btn = box.querySelector('.evr-toggle'), body = box.querySelector('.evr-body');
      // clicks in here belong to this block, not to the event row (which opens and closes its own details)
      box.addEventListener('click', function (e) { e.stopPropagation(); });
      if (btn && body) btn.addEventListener('click', function () {
        var open = body.hasAttribute('hidden');
        if (open) body.removeAttribute('hidden'); else body.setAttribute('hidden', '');
        btn.setAttribute('aria-expanded', String(open));
        box.classList.toggle('is-open', open);
      });
    });
  }

  function start() {
    Promise.resolve(supabaseClient.rpc('public_event_feedback')).then(function (res) {
      if (res.error || !res.data) return;
      data = res.data;
      place();
    }, function () { /* the page works fine without it */ });
  }
  start();

  // The list is drawn (and redrawn after edits) by js/members.js, so put the blocks back each time.
  if (window.MutationObserver) {
    new MutationObserver(function () {
      if (busy) return;
      busy = true;
      setTimeout(function () { busy = false; place(); }, 50);
    }).observe(list, { childList: true });
  }
})();
