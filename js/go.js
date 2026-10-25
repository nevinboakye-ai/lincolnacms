// go.html: where a tracked QR code from the committee's QR studio (migration 102) lands.
// Looks up the real destination, lets the database count the scan, then sends the person on.
// Only web addresses are ever followed. Anything else shows a friendly message instead.
(function () {
  'use strict';
  var card = document.getElementById('go-card');
  function say(title, text) {
    card.innerHTML = '<img class="pt-crest" src="Media/ACMS%20Branding/logo.png" alt="" width="56" height="56"><h1>' + title + '</h1><p>' + text + '</p>' +
      '<p><a class="btn btn-primary" href="index.html">Go to the LACMS website</a></p>';
  }
  var code = '';
  try { code = String(new URLSearchParams(window.location.search).get('c') || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20); } catch (e) { /* ignore */ }
  if (!code) { say('This QR code isn’t complete', 'The link is missing its code. Try scanning it again.'); return; }
  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || !supabaseClient) { say('Not connected', 'Please try again in a moment.'); return; }

  var ua = navigator.userAgent || '';
  var device = /iPhone|iPad|iPod/i.test(ua) ? 'ios' : /Android/i.test(ua) ? 'android' : /Mobi/i.test(ua) ? 'other' : 'desktop';

  supabaseClient.rpc('qr_resolve', { p_code: code, p_device: device }).then(function (res) {
    var d = res && res.data;
    if (d && d.ok && /^https?:\/\//i.test(d.url || '')) {
      card.querySelector('p').innerHTML = 'If nothing happens, <a href="' + String(d.url).replace(/"/g, '&quot;') + '" rel="noopener">tap here</a>.';
      window.location.replace(d.url);
      return;
    }
    if (d && d.reason === 'paused') say('This QR code is paused', 'The committee has switched this link off for now.');
    else say('We couldn’t find that QR code', 'It may have been replaced or removed. Please ask whoever shared it.');
  }, function () { say('Couldn’t reach LACMS', 'Check your connection and scan again.'); });
})();
