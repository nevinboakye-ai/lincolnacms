// LACMS Wrapped promos (welcome screen card and homepage band).
// Both start hidden. They appear only once the database says the Wrapped vote is open (or its results are being shown),
// so there is never a promo for something that is not there. Fails quietly: no connection, or migration 133 not run
// yet, simply means no promo.
(function () {
  'use strict';
  var els = document.querySelectorAll('[data-wr-promo]');
  if (!els.length || typeof supabaseClient === 'undefined' || !supabaseClient) return;

  function each(sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }
  function when(iso) {
    try {
      var d = new Date(iso), days = Math.ceil((d - new Date()) / 86400000);
      if (days <= 1) return 'Last day';
      if (days <= 7) return days + ' days left';
      return 'Closes ' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    } catch (e) { return 'Vote now'; }
  }

  var call;
  try { call = supabaseClient.rpc('wrapped_status'); } catch (e) { return; }
  call.then(function (res) {
    var d = res && res.data;
    if (!d || !d.ok || (!d.open && !d.show_results)) return;
    var live = !!d.open;
    each('[data-wr-badge]', function (el) { el.textContent = live ? (d.closes_at ? when(d.closes_at) : 'Vote now') : 'Results are in'; });
    each('[data-wr-sub]', function (el) { if (d.subtitle) el.textContent = d.subtitle; });
    if (!live) {
      each('[data-wr-text]', function (el) { el.textContent = 'The votes are in. See what the LACMS community picked for Member of the Semester, favourite event, song of the semester and more.'; });
      each('[data-wr-card-text]', function (el) { el.textContent = 'The votes are in. See what the community picked for the semester.'; });
      each('[data-wr-go]', function (el) { el.innerHTML = 'See results &rarr;'; });
      each('[data-wr-go2]', function (el) { el.innerHTML = 'See the results <span aria-hidden="true">&rarr;</span>'; });
    }
    if (d.ballots >= 20) each('[data-wr-count]', function (el) { el.textContent = d.ballots + ' votes so far'; el.hidden = false; });
    Array.prototype.forEach.call(els, function (el) { el.hidden = false; });
  }, function () { /* offline: the promos just stay hidden */ });
})();
