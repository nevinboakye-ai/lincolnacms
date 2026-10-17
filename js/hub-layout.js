// Members Hub: the small bits of behaviour that keep the page short.
//   * the Account & profile area is open on a wide screen and folded on a phone;
//   * the news feed shows the latest few posts with a "Show all" button, and a
//     tap on a post opens its full text.
// Everything still works without this file; the page is just longer.
(function () {
  'use strict';

  var wide = window.matchMedia ? window.matchMedia('(min-width: 900px)').matches : true;

  // ---- Account area -------------------------------------------------------
  var acc = document.getElementById('hub-account');
  if (acc) {
    var openByLink = window.location.hash === '#network-profile';
    acc.open = wide || openByLink;
  }

  // ---- News feed ------------------------------------------------------------
  var list = document.getElementById('feed-list');
  if (!list) return;
  var LIMIT = window.matchMedia && window.matchMedia('(max-width: 640px)').matches ? 2 : 3;
  list.setAttribute('data-limit', String(LIMIT));
  var btnWrap = null;
  var showingAll = false;

  function items() { return list.querySelectorAll('.feed-item'); }

  function update() {
    var n = items().length;
    if (btnWrap) { btnWrap.remove(); btnWrap = null; }
    if (n <= LIMIT) { list.classList.remove('is-compact'); return; }
    list.classList.toggle('is-compact', !showingAll);
    btnWrap = document.createElement('div');
    btnWrap.className = 'hub-feed-more';
    btnWrap.innerHTML = '<button type="button" class="btn btn-outline" aria-expanded="' + showingAll + '">' + (showingAll ? 'Show fewer' : 'Show all ' + n + ' updates') + '</button>';
    list.parentNode.insertBefore(btnWrap, list.nextSibling);
    btnWrap.querySelector('button').addEventListener('click', function () { showingAll = !showingAll; update(); });
  }

  list.addEventListener('click', function (e) {
    var item = e.target.closest('.feed-item');
    if (!item || e.target.closest('a, button')) return;
    if (list.classList.contains('is-compact') || item.classList.contains('is-open')) item.classList.toggle('is-open');
  });

  var obs = new MutationObserver(function () { obs.disconnect(); update(); obs.observe(list, { childList: true }); });
  obs.observe(list, { childList: true });
  update();
})();
