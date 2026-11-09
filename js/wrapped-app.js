/* LACMS Wrapped as an app (wrapped.html).
   Everything that makes the page behave like an installed phone app, kept apart from the vote itself (wrapped.js):
     - registers the service worker (sw-wrapped.js) so the app opens instantly and works on a weak signal;
     - the "Add to home screen" flow: the real install prompt on Android/Chrome, and a step-by-step sheet on iPhone
       (iOS has no prompt) and in in-app browsers such as Instagram's, which cannot install anything;
     - an offline notice, a small toast, and light haptics where the phone supports them.
   wrapped.js talks to this through window.WrappedApp. If this file ever fails to load, the vote still works. */
(function () {
  'use strict';

  var ua = navigator.userAgent || '';
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/i.test(ua);
  var inAppBrowser = /Instagram|FBAN|FBAV|FB_IAB|TikTok|musical_ly|BytedanceWebview|Snapchat|Twitter|LinkedInApp|MicroMessenger|Line\//i.test(ua);
  var isIOSChrome = /CriOS|FxiOS|EdgiOS/.test(ua);
  var root = document.documentElement;
  var deferred = null;      // the browser's install prompt, when it offers one
  var installed = false;    // set when the browser reports the app was added

  function mq(q) { try { return window.matchMedia && window.matchMedia(q).matches; } catch (e) { return false; } }
  function reduced() { return mq('(prefers-reduced-motion: reduce)'); }
  function standalone() {
    return navigator.standalone === true || mq('(display-mode: standalone)') || mq('(display-mode: fullscreen)') || mq('(display-mode: minimal-ui)');
  }
  function paintMode() { root.classList.toggle('is-app', standalone()); }
  paintMode();

  // ---------------------------------------------------------------------
  // Little helpers: toast, haptics
  var toastEl, toastTimer;
  function toast(text) {
    if (!toastEl) {
      toastEl = document.createElement('p');
      toastEl.className = 'wr-toast'; toastEl.setAttribute('role', 'status'); toastEl.hidden = true;
      document.body.appendChild(toastEl);
    }
    window.clearTimeout(toastTimer);
    toastEl.textContent = text; toastEl.hidden = false;
    void toastEl.offsetWidth;
    toastEl.classList.add('is-on');
    toastTimer = window.setTimeout(function () {
      toastEl.classList.remove('is-on');
      window.setTimeout(function () { toastEl.hidden = true; }, 260);
    }, 2800);
  }
  function buzz(pattern) {
    try { if (navigator.vibrate && !reduced()) navigator.vibrate(pattern); } catch (e) { /* not supported: fine */ }
  }

  // ---------------------------------------------------------------------
  // Offline notice
  function netNotice() {
    var b = document.getElementById('wr-offline'); if (!b) return;
    b.hidden = navigator.onLine !== false;
  }
  window.addEventListener('offline', netNotice);
  window.addEventListener('online', function () { netNotice(); toast('Back online'); });
  netNotice();

  // ---------------------------------------------------------------------
  // Service worker
  function warmCache() {
    navigator.serviceWorker.ready.then(function (reg) {
      var sw = reg && reg.active; if (!sw) return;
      var fonts = (document.fonts && document.fonts.ready) || Promise.resolve();
      fonts.then(function () {
        window.setTimeout(function () {
          var urls = [];
          try { performance.getEntriesByType('resource').forEach(function (r) { if (r.name.indexOf(location.origin) === 0) urls.push(r.name); }); } catch (e) { /* ignore */ }
          try { sw.postMessage({ type: 'wr-cache', urls: urls }); } catch (e) { /* ignore */ }
        }, 1200);
      });
    }, function () { /* no service worker: the page still works online */ });
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw-wrapped.js', { scope: './wrapped.html' }).then(warmCache, function () { /* private window etc.: fine */ });
    });
  }

  // ---------------------------------------------------------------------
  // Install
  var ICON = {
    add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><line x1="12" y1="8.5" x2="12" y2="15.5"/><line x1="8.5" y1="12" x2="15.5" y2="12"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3.5"/><path d="M8 7.2 12 3.2l4 4"/><path d="M7.5 10.5H6.4A1.9 1.9 0 0 0 4.5 12.4v6.2a1.9 1.9 0 0 0 1.9 1.9h11.2a1.9 1.9 0 0 0 1.9-1.9v-6.2a1.9 1.9 0 0 0-1.9-1.9h-1.1"/></svg>',
    dots: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12.5 10 17.5 19 7"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><line x1="20" y1="4" x2="11" y2="13"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>'
  };

  function canInstall() {
    if (installed || standalone()) return false;
    if (deferred) return mq('(pointer: coarse)');
    return isIOS || isAndroid;
  }
  function sync() {
    var on = canInstall();
    Array.prototype.forEach.call(document.querySelectorAll('[data-install-slot]'), function (el) { el.hidden = !on; });
  }
  function slot(kind) {
    if (kind === 'card') {
      return '<div class="wr-install-slot" data-install-slot hidden><div class="wr-install-card">' +
        '<img src="Media/wrapped-app/icon-192.png" alt="" width="52" height="52">' +
        '<div><b>Keep Wrapped on your home screen</b><span>It opens full screen, like an app, so the results are one tap away.</span></div>' +
        '<button type="button" class="wr-install wr-install--sm" data-install>Add</button></div></div>';
    }
    return '<div class="wr-install-slot" data-install-slot hidden><button type="button" class="wr-install" data-install>' + ICON.add + '<span>Add to home screen</span></button></div>';
  }

  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; sync(); });
  window.addEventListener('appinstalled', function () {
    deferred = null; installed = true; sync(); closeSheet();
    toast('Added to your home screen');
    buzz([12, 50, 18]);
  });
  try {
    var dm = window.matchMedia('(display-mode: standalone)');
    var onDm = function () { paintMode(); sync(); };
    if (dm.addEventListener) dm.addEventListener('change', onDm); else if (dm.addListener) dm.addListener(onDm);
  } catch (e) { /* ignore */ }

  function install() {
    if (deferred) {
      var d = deferred; deferred = null; sync();
      try {
        d.prompt();
        if (d.userChoice) d.userChoice.then(function (c) { if (c && c.outcome === 'dismissed') sync(); }, function () { /* ignore */ });
      } catch (e) { openSheet(); }
      return;
    }
    openSheet();
  }

  // ---------------------------------------------------------------------
  // "How to add it" sheet
  var sheet, card, lastFocus;
  function steps() {
    var li = function (icon, head, text) { return '<li><span class="wr-step-ico">' + icon + '</span><span><b>' + head + '</b>' + (text ? '<small>' + text + '</small>' : '') + '</span></li>'; };
    if (inAppBrowser) {
      return { title: 'Open it in your browser first', lead: 'You are viewing this inside another app, and those can&rsquo;t add things to your home screen.', list:
        li(ICON.dots, 'Tap the &ldquo;&hellip;&rdquo; or share button', 'Usually in a top or bottom corner.') +
        li(ICON.out, 'Choose &ldquo;Open in browser&rdquo;', isIOS ? 'Or &ldquo;Open in Safari&rdquo;.' : 'Or &ldquo;Open in Chrome&rdquo;.') +
        li(ICON.add, 'Then tap &ldquo;Add to home screen&rdquo;', 'You&rsquo;ll find this button again on the first screen.') };
    }
    if (isIOS) {
      return { title: 'Add Wrapped to your home screen', lead: 'It opens full screen, like an app.', list:
        li(ICON.share, 'Tap the Share button', isIOSChrome ? 'The square with an arrow, next to the address bar.' : 'The square with an arrow in Safari&rsquo;s toolbar. If you only see &ldquo;&hellip;&rdquo;, tap that, then Share.') +
        li(ICON.add, 'Tap &ldquo;Add to Home Screen&rdquo;', 'You may need to scroll down the list to find it.') +
        li(ICON.check, 'Tap &ldquo;Add&rdquo;', 'Wrapped now sits on your home screen.') };
    }
    return { title: 'Add Wrapped to your home screen', lead: 'It opens full screen, like an app.', list:
      li(ICON.dots, 'Open your browser menu', 'The three dots in the corner.') +
      li(ICON.add, 'Tap &ldquo;Install app&rdquo; or &ldquo;Add to Home screen&rdquo;', 'The wording depends on your browser.') +
      li(ICON.check, 'Confirm', 'Wrapped now sits on your home screen.') };
  }
  function buildSheet() {
    sheet = document.createElement('div');
    sheet.className = 'wr-sheet'; sheet.hidden = true;
    sheet.innerHTML =
      '<div class="wr-sheet-back" data-sheet-close></div>' +
      '<div class="wr-sheet-card" role="dialog" aria-modal="true" aria-labelledby="wr-sheet-t" tabindex="-1">' +
        '<div class="wr-sheet-drag" data-sheet-drag><span class="wr-sheet-grab" aria-hidden="true"></span>' +
          '<div class="wr-sheet-head"><img src="Media/wrapped-app/icon-192.png" alt="" width="56" height="56"><div><h2 id="wr-sheet-t"></h2><p id="wr-sheet-l"></p></div></div></div>' +
        '<ol class="wr-steps" id="wr-sheet-s"></ol>' +
        '<button type="button" class="wr-btn wr-btn--main wr-btn--block" data-sheet-close>Got it</button>' +
      '</div>';
    document.body.appendChild(sheet);
    card = sheet.querySelector('.wr-sheet-card');

    sheet.addEventListener('click', function (e) { if (e.target.closest('[data-sheet-close]')) closeSheet(); });
    sheet.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
      if (e.key !== 'Tab') return;
      var f = sheet.querySelectorAll('button'); if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === card)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    // Drag the top of the sheet down to dismiss it, like a native bottom sheet.
    var y0 = null, dy = 0;
    card.addEventListener('pointerdown', function (e) {
      if (!e.target.closest('[data-sheet-drag]')) return;
      y0 = e.clientY; dy = 0; card.style.transition = 'none';
      try { card.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    });
    card.addEventListener('pointermove', function (e) {
      if (y0 === null) return;
      dy = Math.max(0, e.clientY - y0); card.style.transform = 'translateY(' + dy + 'px)';
    });
    function drop() {
      if (y0 === null) return;
      var far = dy > 90; y0 = null; dy = 0; card.style.transition = '';
      if (far) closeSheet();
      card.style.transform = '';
    }
    card.addEventListener('pointerup', drop);
    card.addEventListener('pointercancel', drop);
  }
  function setBackground(inert) {
    Array.prototype.forEach.call(document.querySelectorAll('.wr-shell'), function (el) { if ('inert' in el) el.inert = inert; });
  }
  function openSheet() {
    if (!sheet) buildSheet();
    var s = steps();
    sheet.querySelector('#wr-sheet-t').innerHTML = s.title;
    sheet.querySelector('#wr-sheet-l').innerHTML = s.lead;
    sheet.querySelector('#wr-sheet-s').innerHTML = s.list;
    lastFocus = document.activeElement;
    sheet.hidden = false; void sheet.offsetWidth;
    sheet.classList.add('is-open'); setBackground(true);
    window.setTimeout(function () { try { card.focus({ preventScroll: true }); } catch (e) { card.focus(); } }, 30);
  }
  function closeSheet() {
    if (!sheet || sheet.hidden) return;
    sheet.classList.remove('is-open'); setBackground(false);
    window.setTimeout(function () { sheet.hidden = true; }, reduced() ? 0 : 280);
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-install]'); if (!b) return;
    e.preventDefault(); install();
  });

  window.WrappedApp = { slot: slot, sync: sync, buzz: buzz, toast: toast, isApp: standalone };
  sync();
})();
