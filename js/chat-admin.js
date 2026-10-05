// President's "Message Reports" section on the dashboard (migration 070).
//
// Messages are private to the two people in a conversation; the only way
// anyone else sees one is when a participant reports it. Each report carries
// a snapshot of the reported message and the few before it, so it can still
// be reviewed if they're deleted afterwards. From here the president can
// mark a report resolved or dismissed (with an optional note), reopen it, and
// pause or restore the reported person's messaging.
//
// Everything is gated in the database (is_president()), so this file only
// renders what those functions return. It only does anything for the president.
(function () {
  'use strict';

  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;
  var panel = document.getElementById('dash-panel-chatreports');
  if (!panel) return;

  var list = document.getElementById('chatreports-list');
  var empty = document.getElementById('chatreports-empty');
  var countLine = document.getElementById('chatreports-count-line');
  var statusEl = document.getElementById('chatreports-status');
  var card = document.querySelector('[data-dash-section="chatreports"]');
  var countEl = document.getElementById('dash-count-chatreports');

  var REASONS = {
    harassment: 'Harassment or bullying', inappropriate: 'Inappropriate or offensive content',
    spam: 'Spam or unwanted promotion', impersonation: 'Pretending to be someone else', other: 'Something else'
  };
  var reports = [];
  var filter = 'open';
  var isPresident = false;
  var loaded = false;

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function when(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function showStatus(message) {
    statusEl.textContent = message || '';
    statusEl.style.display = message ? 'block' : 'none';
  }

  function render() {
    var open = reports.filter(function (r) { return r.status === 'open'; });
    if (card) card.style.display = isPresident ? '' : 'none';
    if (countEl) countEl.textContent = open.length ? open.length + ' open' : 'None open';
    countLine.textContent = open.length + ' open · ' + (reports.length - open.length) + ' closed';

    var rows = reports.filter(function (r) { return filter === 'open' ? r.status === 'open' : r.status !== 'open'; });
    empty.style.display = rows.length ? 'none' : 'block';
    empty.textContent = filter === 'open' ? 'No open reports - nothing needs your attention.' : 'No closed reports yet.';
    list.innerHTML = rows.map(function (r) {
      var ctx = Array.isArray(r.context) ? r.context : [];
      var status = r.status === 'open' ? '' : '<span class="chatrep-status chatrep-status--' + r.status + '">' + (r.status === 'resolved' ? 'Resolved' : 'Dismissed') + '</span>';
      return '<article class="chatrep" data-id="' + esc(r.id) + '">' +
        '<header class="chatrep-head"><div><strong>' + esc(r.reporter_name || 'A member') + '</strong> reported <strong>' + esc(r.reported_name || 'a member') + '</strong>' +
          '<span class="chatrep-when">' + esc(when(r.created_at)) + '</span></div>' + status + '</header>' +
        '<p class="chatrep-reason"><span>' + esc(REASONS[r.reason] || r.reason) + '</span>' +
          (r.reported_suspended ? '<span class="chatrep-flag">Messaging paused</span>' : '') + '</p>' +
        (r.details ? '<p class="chatrep-details">&ldquo;' + esc(r.details) + '&rdquo;</p>' : '') +
        '<div class="chatrep-context" aria-label="Reported messages">' + (ctx.length ? ctx.map(function (m) {
          return '<div class="chatrep-msg' + (m.reported ? ' is-reported' : '') + '"><span class="chatrep-who">' + esc(m.sender || '') + '</span>' +
            '<span class="chatrep-body">' + (m.deleted ? '<em>deleted</em>' : esc(m.body)) + '</span>' +
            '<span class="chatrep-at">' + esc(when(m.at)) + '</span></div>';
        }).join('') : '<p class="chatrep-none">No messages were in the conversation when this was reported.</p>') + '</div>' +
        (r.resolution_note ? '<p class="chatrep-note"><strong>Note:</strong> ' + esc(r.resolution_note) + '</p>' : '') +
        '<div class="chatrep-actions">' +
          (r.status === 'open'
            ? '<input type="text" class="chatrep-note-input" maxlength="500" placeholder="Add a note (optional)" aria-label="Note for this report">' +
              '<button type="button" class="btn btn-primary" data-act="resolved">Mark resolved</button>' +
              '<button type="button" class="btn btn-outline" data-act="dismissed">Dismiss</button>'
            : '<button type="button" class="btn btn-outline" data-act="open">Reopen</button>') +
          '<button type="button" class="btn btn-outline" data-act="suspend" data-suspended="' + (r.reported_suspended ? '1' : '0') + '">' +
            (r.reported_suspended ? 'Restore ' : 'Pause messaging for ') + esc((r.reported_name || 'them').split(' ')[0]) + '</button>' +
        '</div></article>';
    }).join('');
  }

  function load() {
    return supabaseClient.rpc('president_get_chat_reports').then(function (res) {
      if (res.error) {
        // Not the president, or migration 070 not run: say nothing unless asked for.
        if (loaded || !/president/i.test(res.error.message || '')) showStatus('Couldn\'t load message reports - has migration 070 been run? (' + res.error.message + ')');
        return;
      }
      loaded = true;
      isPresident = true;
      showStatus('');
      reports = res.data || [];
      render();
    });
  }

  panel.addEventListener('click', function (e) {
    var tab = e.target.closest('[data-chatreports-filter]');
    if (tab) {
      filter = tab.getAttribute('data-chatreports-filter');
      Array.prototype.forEach.call(panel.querySelectorAll('[data-chatreports-filter]'), function (t) { t.classList.toggle('is-active', t === tab); });
      render();
      return;
    }
    var btn = e.target.closest('[data-act]');
    var art = e.target.closest('.chatrep');
    if (!btn || !art) return;
    var id = art.getAttribute('data-id');
    var report = reports.filter(function (r) { return r.id === id; })[0];
    if (!report) return;
    var act = btn.getAttribute('data-act');
    btn.disabled = true;

    var call;
    if (act === 'suspend') {
      var suspend = btn.getAttribute('data-suspended') !== '1';
      call = supabaseClient.rpc('president_set_chat_suspension', { p_user: report.reported_id, p_suspended: suspend, p_reason: 'Reported message' });
    } else {
      var noteInput = art.querySelector('.chatrep-note-input');
      call = supabaseClient.rpc('president_resolve_chat_report', { p_id: id, p_status: act, p_note: noteInput ? noteInput.value.trim() || null : null });
    }
    call.then(function (res) {
      if (res.error) { showStatus(res.error.message); btn.disabled = false; return; }
      showStatus('');
      return load();
    }, function () { showStatus('Couldn\'t reach the server - try again.'); btn.disabled = false; });
  });

  // Load when the card is opened (or the page is opened straight to it), and
  // once quietly at the start so the card can show how many are open.
  if (card) card.addEventListener('click', function () { load(); });
  supabaseClient.auth.getSession().then(function (result) {
    if (!result.data || !result.data.session) return;
    supabaseClient.rpc('is_president').then(function (r) {
      if (r.error || r.data !== true) { if (card) card.style.display = 'none'; return; }
      load();
    }, function () { /* leave it */ });
  });
})();
