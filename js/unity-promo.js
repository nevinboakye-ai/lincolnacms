// Unity Cup promos (homepage welcome screen and band, events page card).
// Fills in the "when" badge from the date, and quietly hides the promos a fortnight after the event.
(function () {
  'use strict';
  var EVENT = new Date('2026-11-06T00:00:00');
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var diff = Math.round((EVENT - today) / 86400000);
  var label = diff > 1 ? 'Fri 6 Nov' : diff === 1 ? 'Tomorrow' : diff === 0 ? 'Today' : 'Results & photos';
  Array.prototype.forEach.call(document.querySelectorAll('[data-uc-when]'), function (el) { el.textContent = label; });
  Array.prototype.forEach.call(document.querySelectorAll('[data-uc-live]'), function (el) { if (diff === 0) el.classList.add('is-live'); });
  if (diff < -14) Array.prototype.forEach.call(document.querySelectorAll('[data-uc-promo]'), function (el) { el.hidden = true; });
})();
