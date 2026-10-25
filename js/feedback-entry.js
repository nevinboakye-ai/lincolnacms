// Gentle doors into event feedback (migration 100, feedback.html):
//   * events.html: the "Been to an event? Tell us how it went" box. Signed-in people go
//     straight to the form; everyone else picks "member" (signs in, then comes back) or "guest".
//   * member-hub.html: "How was <event>?" for events the member registered for that have
//     happened and that they haven't reviewed yet.
(function () {
  'use strict';

  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function inPreview() { return !!(window.lacmsViewAs && window.lacmsViewAs.active && window.lacmsViewAs.active()); }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function niceDate(key) { if (!key) return ''; var p = key.split('-'); return (+p[2]) + ' ' + MONTHS[+p[1] - 1]; }

  // ---- events.html -------------------------------------------------------------
  var box = document.querySelector('[data-fb-entry-section]');
  if (box) {
    supabaseClient.auth.getSession().then(function (res) {
      var session = res && res.data && res.data.session;
      if (!session) return;
      var member = box.querySelector('[data-fb-member]');
      var guest = box.querySelector('[data-fb-guest]');
      if (member) { member.href = 'feedback.html'; member.textContent = 'Give feedback'; }
      if (guest) guest.style.display = 'none';
    });
  }

  // ---- member-hub.html ---------------------------------------------------------------
  var host = document.querySelector('[data-feedback-prompt]');
  if (host) {
    var DISMISS = 'lacms-feedback-dismissed';
    var dismissed = [];
    try { dismissed = JSON.parse(lsGet(DISMISS) || '[]'); } catch (e) { dismissed = []; }

    supabaseClient.auth.getSession().then(function (res) {
      var session = res && res.data && res.data.session;
      if (!session) return null;
      var uid = session.user.id;
      var today = new Date().toISOString().slice(0, 10);
      var oldest = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
      return Promise.all([
        supabaseClient.from('event_registrations').select('event_slug').eq('member_id', uid),
        supabaseClient.rpc('my_feedback_slugs'),
        supabaseClient.from('site_events').select('slug, name, starts_on, ends_on').eq('is_active', true)
      ]).then(function (r) {
        if (r[1].error || r[2].error) return [];             // migration 100 not run yet
        var registered = (r[0].data || []).map(function (x) { return x.event_slug; });
        var done = r[1].data || [];
        return (r[2].data || []).filter(function (e) {
          var end = e.ends_on || e.starts_on;
          return registered.indexOf(e.slug) !== -1 && done.indexOf(e.slug) === -1 && dismissed.indexOf(e.slug) === -1 &&
            e.starts_on && e.starts_on <= today && end >= oldest;
        }).sort(function (a, b) { return String(b.starts_on).localeCompare(String(a.starts_on)); }).slice(0, 2);
      });
    }).then(function (events) {
      if (!events || !events.length) return;
      host.innerHTML = '<div class="fb-prompt">' +
        '<span class="fb-prompt-icon" aria-hidden="true">💬</span>' +
        '<div class="fb-prompt-body"><h3>' + (events.length === 1 ? 'How was ' + esc(events[0].name) + '?' : 'How did these go?') + '</h3>' +
        '<p>You registered, so we’d love to hear how it went. It takes about a minute and earns XP on your journey.</p>' +
        '<div class="fb-prompt-actions">' + events.map(function (e) {
          return '<a class="btn btn-primary" href="feedback.html?event=' + encodeURIComponent(e.slug) + '">' + (events.length === 1 ? 'Give feedback' : esc(e.name)) + '</a>';
        }).join('') +
        (inPreview() ? '' : '<button type="button" class="guide-linkbtn" data-fb-prompt-hide>Not now</button>') + '</div></div></div>';
      host.hidden = false;
      var wrap = host.closest('[data-motm-hub]'); if (wrap) wrap.hidden = false;
      var hide = host.querySelector('[data-fb-prompt-hide]');
      if (hide) hide.addEventListener('click', function () {
        lsSet(DISMISS, JSON.stringify(dismissed.concat(events.map(function (e) { return e.slug; })).slice(-40)));
        host.hidden = true; host.innerHTML = '';
      });
    }, function () { /* quiet */ });
  }
})();
