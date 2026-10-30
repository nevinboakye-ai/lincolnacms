// LACMS privacy and consent
//
// Loaded last on every page. It does four things:
//   1. Cookie / storage choices (PECR): a small banner, the settings on cookies.html, and
//      the "Cookie settings" link in every footer. Only essential storage is used unless the
//      visitor says yes to analytics.
//   2. The anonymous page-view counter. It used to run from main.js whether or not anyone
//      agreed; it now runs only after the visitor has allowed analytics (and never if their
//      browser sends Do Not Track / Global Privacy Control). If analytics is off, the random
//      visitor id is deleted from their device.
//   3. The "Your data rights" form (data-request.html).
//   4. The "My data & privacy" panel on the members hub: download my data, request deletion,
//      email preferences, my requests.
//
// Needs db/migrations/110 for 3 and 4. Without it the pages tell people to email us instead.

(function () {
  'use strict';

  // Bump this whenever privacy.html changes in a way that matters. Members are asked to read the
  // notice again (see the gate in members.js) the next time they sign in.
  var PRIVACY_VERSION = '2026-10-30';
  window.LACMS_PRIVACY_VERSION = PRIVACY_VERSION;

  var CONSENT_KEY = 'lacms-consent';
  var VISITOR_KEY = 'lacms-visitor-id';
  var CONSENT_MAX_AGE = 365 * 24 * 60 * 60 * 1000;   // ask again after 12 months
  var CONTACT = 'acms@lincolnsu.com';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return ''; }
  }
  function hasClient() { return typeof supabaseClient !== 'undefined' && supabaseClient && typeof supabaseIsConfigured !== 'undefined' && supabaseIsConfigured; }

  // =====================================================================
  // 1. Consent
  // =====================================================================
  function browserOptOut() {
    return navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  }
  function readConsent() {
    try {
      var r = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null');
      if (r && typeof r.analytics === 'boolean' && r.at && Date.now() - r.at < CONSENT_MAX_AGE) return r;
    } catch (e) { /* no storage: treated as no choice */ }
    return null;
  }
  function writeConsent(analytics) {
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: 1, analytics: !!analytics, at: Date.now() })); } catch (e) { /* ignore */ }
    if (!analytics) { try { localStorage.removeItem(VISITOR_KEY); } catch (e) { /* ignore */ } }
  }
  function analyticsAllowed() {
    var c = readConsent();
    return !!(c && c.analytics) && !browserOptOut();
  }

  var banner = null;
  function closeBanner() { if (banner && banner.parentNode) banner.parentNode.removeChild(banner); banner = null; }
  function showBanner() {
    if (banner) { var first = $('button', banner); if (first) first.focus(); return; }
    banner = document.createElement('section');
    banner.className = 'consent-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Cookie choices');
    banner.innerHTML =
      '<div class="consent-banner-text"><strong>Your choice about cookies</strong>' +
      '<p>We only use essential storage to keep you signed in and remember your settings. We&rsquo;d also like to count visits to see which pages are useful. It&rsquo;s anonymous and off unless you say yes. ' +
      '<a href="cookies.html">Details</a> &middot; <a href="privacy.html">Privacy notice</a></p></div>' +
      '<div class="consent-banner-actions">' +
      '<button type="button" class="btn btn-primary" data-consent-choice="no">No thanks</button>' +
      '<button type="button" class="btn btn-primary" data-consent-choice="yes">Allow analytics</button></div>';
    document.body.appendChild(banner);
    banner.addEventListener('click', function (e) {
      var b = e.target.closest('[data-consent-choice]');
      if (!b) return;
      var yes = b.getAttribute('data-consent-choice') === 'yes';
      writeConsent(yes);
      closeBanner();
      if (yes) recordPageView();
      syncConsentPanel();
    });
  }

  // The settings on cookies.html
  function syncConsentPanel() {
    var panel = $('[data-consent-panel]');
    if (!panel) return;
    var box = $('[data-consent-analytics]', panel);
    var state = $('[data-consent-state]', panel);
    if (box) box.checked = !!(readConsent() && readConsent().analytics) && !browserOptOut();
    if (box && browserOptOut()) { box.disabled = true; }
    if (state && box) state.textContent = browserOptOut() ? 'Off (your browser asks sites not to track)' : (box.checked ? 'On' : 'Off');
  }
  function initConsentPanel() {
    var panel = $('[data-consent-panel]');
    if (!panel) return;
    var box = $('[data-consent-analytics]', panel);
    var state = $('[data-consent-state]', panel);
    var saved = $('[data-consent-saved]', panel);
    if (box) box.addEventListener('change', function () { if (state) state.textContent = box.checked ? 'On' : 'Off'; });
    var btn = $('[data-consent-save]', panel);
    if (btn) btn.addEventListener('click', function () {
      writeConsent(box && box.checked);
      closeBanner();
      if (box && box.checked) recordPageView();
      if (saved) saved.textContent = 'Saved. You can change this any time.';
    });
    syncConsentPanel();
  }

  // =====================================================================
  // 2. Anonymous page views (only after consent)
  // =====================================================================
  var viewRecorded = false;
  function recordPageView() {
    if (viewRecorded || !analyticsAllowed() || !hasClient()) return;
    viewRecorded = true;
    try {
      var visitorId = localStorage.getItem(VISITOR_KEY);
      if (!visitorId) {
        visitorId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
        localStorage.setItem(VISITOR_KEY, visitorId);
      }
      supabaseClient.from('page_views').insert({
        path: window.location.pathname.split('/').pop() || 'index.html',
        visitor_id: visitorId,
        device: window.innerWidth < 768 ? 'mobile' : 'desktop'
      }).then(function () {}, function () {});
    } catch (e) { /* best effort only */ }
  }

  // =====================================================================
  // 3. The data-rights form
  // =====================================================================
  function initRequestForm() {
    var form = $('#data-request-form');
    if (!form) return;
    var status = $('#dr-status');
    var done = $('#dr-done');
    var params = new URLSearchParams(window.location.search);
    var kind = params.get('kind');
    if (kind && $('#dr-kind option[value="' + kind.replace(/[^a-z_]/g, '') + '"]')) $('#dr-kind').value = kind;
    if (hasClient()) {
      supabaseClient.auth.getSession().then(function (r) {
        var u = r && r.data && r.data.session && r.data.session.user;
        if (u && u.email && !$('#dr-email').value) $('#dr-email').value = u.email;
      });
    }
    function say(msg) { status.textContent = msg; status.style.display = msg ? 'block' : 'none'; }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      say('');
      if ($('#dr-website').value) return;   // a bot filled the hidden field
      var k = $('#dr-kind').value;
      var email = $('#dr-email').value.trim();
      if (!k) { say('Choose what your request is about.'); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { say('Enter a valid email address so we can reply.'); return; }
      if (!hasClient()) { say('The form isn\'t connected right now. Please email ' + CONTACT + ' instead.'); return; }
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Sending…';
      supabaseClient.rpc('submit_compliance_request', {
        p_kind: k, p_name: $('#dr-name').value.trim(), p_email: email, p_details: $('#dr-details').value.trim()
      }).then(function (res) {
        btn.disabled = false; btn.textContent = 'Send';
        if (res.error) {
          var m = String(res.error.message || '');
          say(/function|schema cache|does not exist/i.test(m) ? 'The form isn\'t set up yet. Please email ' + CONTACT + ' and we\'ll deal with it.' : (m || 'Something went wrong. Please email ' + CONTACT + '.'));
          return;
        }
        var d = res.data || {};
        form.style.display = 'none';
        done.style.display = 'block';
        done.innerHTML = '<strong>Thank you &ndash; we&rsquo;ve got it.</strong><p>Your reference is <code>' + esc(String(d.id || '').slice(0, 8)) + '</code>. We&rsquo;ll reply to ' + esc(email) + ' by <strong>' + esc(fmtDate(d.due_at)) +
          '</strong> at the latest. We may ask you to confirm who you are first, to keep your information safe.' +
          (k === 'safeguarding' ? '</p><p><strong>This form isn&rsquo;t monitored around the clock.</strong> If someone is in danger call 999; see <a href="safeguarding.html">Safeguarding</a> for who to contact now.' : '') + '</p>';
        done.setAttribute('tabindex', '-1'); done.focus();
      }, function () { btn.disabled = false; btn.textContent = 'Send'; say('Couldn\'t send that. Please email ' + CONTACT + '.'); });
    });
  }

  // =====================================================================
  // 4. "My data & privacy" on the members hub
  // =====================================================================
  var KIND_LABEL = { access: 'Copy of my data', erasure: 'Delete my data', rectification: 'Correction', restriction: 'Pause use', objection: 'Objection', withdraw_consent: 'Withdraw consent', complaint: 'Complaint', safeguarding: 'Safeguarding', content: 'Report', other: 'Other' };
  var STATUS_LABEL = { received: 'Received', verifying: 'Checking it\'s you', in_progress: 'In progress', completed: 'Done', refused: 'Closed', withdrawn: 'Withdrawn' };

  function initMemberPanel() {
    var panel = $('#my-privacy');
    if (!panel || !hasClient()) return;
    var msg = $('[data-priv-msg]', panel);
    function say(text, bad) { if (!msg) return; msg.textContent = text; msg.className = 'priv-msg' + (bad ? ' is-bad' : ' is-ok'); msg.hidden = !text; }
    function friendly(err) {
      var m = String((err && err.message) || err || '');
      return /function|schema cache|does not exist|not found/i.test(m) ? 'This isn\'t switched on yet. Please email ' + CONTACT + ' and we\'ll help.' : (m || 'Something went wrong.');
    }
    supabaseClient.auth.getSession().then(function (r) {
      var session = r && r.data && r.data.session;
      if (!session) return;
      var email = session.user.email;
      var wrap = document.getElementById('my-privacy-section');
      if (wrap) wrap.style.display = '';

      // download
      var dl = $('[data-priv-download]', panel);
      if (dl) dl.addEventListener('click', function () {
        dl.disabled = true; var label = dl.textContent; dl.textContent = 'Preparing…'; say('');
        supabaseClient.rpc('export_my_data').then(function (res) {
          dl.disabled = false; dl.textContent = label;
          if (res.error) { say(friendly(res.error), true); return; }
          var blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'lacms-my-data-' + new Date().toISOString().slice(0, 10) + '.json';
          document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
          say('Downloaded. The file is on your device only - keep it somewhere safe.');
        }, function (err) { dl.disabled = false; dl.textContent = label; say(friendly(err), true); });
      });

      // deletion
      var delBtn = $('[data-priv-delete]', panel), delBox = $('[data-priv-delete-confirm]', panel);
      if (delBtn && delBox) {
        delBtn.addEventListener('click', function () { delBox.hidden = false; delBtn.hidden = true; var c = $('[data-priv-delete-yes]', delBox); if (c) c.focus(); });
        $('[data-priv-delete-no]', delBox).addEventListener('click', function () { delBox.hidden = true; delBtn.hidden = false; });
        $('[data-priv-delete-yes]', delBox).addEventListener('click', function (e) {
          var b = e.currentTarget; b.disabled = true; say('');
          supabaseClient.rpc('submit_compliance_request', { p_kind: 'erasure', p_name: '', p_email: email, p_details: 'Requested from My data & privacy on the members hub.' }).then(function (res) {
            b.disabled = false;
            if (res.error) { say(friendly(res.error), true); return; }
            delBox.hidden = true; delBtn.hidden = false;
            say('Request sent. We\'ll confirm it\'s you and delete your account and information by ' + fmtDate(res.data && res.data.due_at) + ' at the latest. You\'ll stay signed in until then.');
            loadRequests();
          }, function (err) { b.disabled = false; say(friendly(err), true); });
        });
      }

      // email preferences
      var opt = $('[data-priv-updates]', panel);
      if (opt) {
        supabaseClient.rpc('privacy_get_email_prefs').then(function (res) { if (!res.error && res.data) opt.checked = !res.data.updates_opt_out; });
        opt.addEventListener('change', function () {
          supabaseClient.rpc('privacy_set_email_prefs', { p_updates_opt_out: !opt.checked }).then(function (res) {
            if (res.error) { opt.checked = !opt.checked; say(friendly(res.error), true); return; }
            say(opt.checked ? 'You\'ll get society updates by email.' : 'Done. You won\'t get society updates by email. You\'ll still get essential emails about your account.');
          });
        });
      }

      // Network visibility (opt-in, migration 112): the members hub card and the strip on the Network page
      function wireNetworkBox(box, msgEl, wrap) {
        if (!box) return;
        supabaseClient.rpc('network_get_my_visibility').then(function (res) {
          if (res.error) return;                    // not set up yet: the Network is unchanged
          box.checked = !!(res.data && res.data.visible);
          if (wrap) wrap.style.display = '';
        });
        box.addEventListener('change', function () {
          supabaseClient.rpc('network_set_my_visibility', { p_visible: box.checked }).then(function (res) {
            if (res.error) { box.checked = !box.checked; if (msgEl) { msgEl.textContent = friendly(res.error); } return; }
            var t = box.checked ? 'You\'re now listed in the Network.' : 'You\'re no longer listed in the Network.';
            if (msgEl) { msgEl.textContent = t; msgEl.hidden = false; } else say(t);
          });
        });
      }
      wireNetworkBox($('[data-priv-network]', panel), null, null);

      // my requests
      var list = $('[data-priv-requests]', panel);
      function loadRequests() {
        if (!list) return;
        supabaseClient.rpc('my_compliance_requests').then(function (res) {
          if (res.error || !res.data || !res.data.length) { list.innerHTML = '<p class="sh-muted">You haven\'t made any requests.</p>'; return; }
          list.innerHTML = '<ul class="priv-requests">' + res.data.map(function (q) {
            return '<li><strong>' + esc(KIND_LABEL[q.kind] || q.kind) + '</strong> <span class="priv-chip">' + esc(STATUS_LABEL[q.status] || q.status) + '</span><br><small>Sent ' + esc(fmtDate(q.created_at)) +
              (q.status === 'completed' || q.status === 'refused' || q.status === 'withdrawn' ? '' : ' &middot; we\'ll reply by ' + esc(fmtDate(q.due_at))) + (q.outcome_note ? ' &middot; ' + esc(q.outcome_note) : '') + '</small></li>';
          }).join('') + '</ul>';
        }, function () {});
      }
      loadRequests();
    });
  }

  // The opt-in strip at the top of the Network page
  function initNetworkStrip() {
    var wrap = $('[data-network-optin]');
    if (!wrap || !hasClient()) return;
    var box = $('[data-network-optin-box]', wrap), msg = $('[data-network-optin-msg]', wrap);
    supabaseClient.auth.getSession().then(function (r) {
      if (!r.data || !r.data.session) return;
      supabaseClient.rpc('network_get_my_visibility').then(function (res) {
        if (res.error) return;
        box.checked = !!(res.data && res.data.visible);
        wrap.style.display = '';
      });
      box.addEventListener('change', function () {
        supabaseClient.rpc('network_set_my_visibility', { p_visible: box.checked }).then(function (res) {
          if (res.error) { box.checked = !box.checked; msg.textContent = 'Couldn\'t save that. Please try again.'; return; }
          msg.textContent = box.checked ? 'You\'re now listed. Reload to see yourself in the list.' : 'You\'re no longer listed.';
        });
      });
    });
  }

  // =====================================================================
  // Boot
  // =====================================================================
  function boot() {
    // Footer / links that reopen the choices
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-cookie-settings]');
      if (!t) return;
      if ($('[data-consent-panel]')) { e.preventDefault(); var p = $('[data-consent-panel]'); p.scrollIntoView({ behavior: 'smooth', block: 'center' }); var cb = $('[data-consent-analytics]', p); if (cb) cb.focus(); return; }
      e.preventDefault();
      showBanner();
    });
    initConsentPanel();
    initRequestForm();
    initMemberPanel();
    initNetworkStrip();
    if (browserOptOut()) { try { localStorage.removeItem(VISITOR_KEY); } catch (e) { /* ignore */ } return; }
    var c = readConsent();
    if (!c) { if (!document.querySelector('[data-no-consent-banner]')) showBanner(); }
    else if (c.analytics) recordPageView();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.lacmsPrivacy = { version: PRIVACY_VERSION, analyticsAllowed: analyticsAllowed, openSettings: showBanner };
})();
