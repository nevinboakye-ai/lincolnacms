// Dashboard -> Data & Privacy (president only)
//
// Works through data requests and concerns that came in from data-request.html or the members hub
// (access, erasure, correction, objection, complaints, safeguarding...), each with its one-month
// deadline; downloads a person's data to answer an access request; erases a person; runs the
// retention clean-up; and lists accounts nobody has used for a long time.
//
// Everything here goes through president-only database functions (migration 110).

(function () {
  'use strict';

  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;
  var root = document.getElementById('privacy-root');
  if (!root) return;
  var card = document.querySelector('[data-dash-section="privacy"]');
  var countEl = document.getElementById('dash-count-privacy');

  var KIND = { access: 'Copy of data', erasure: 'Delete data', rectification: 'Correction', restriction: 'Pause use', objection: 'Objection', withdraw_consent: 'Withdraw consent', complaint: 'Complaint', safeguarding: 'Safeguarding', content: 'Content report', other: 'Other' };
  var STATUS = [['received', 'Received'], ['verifying', 'Checking identity'], ['in_progress', 'In progress'], ['completed', 'Completed'], ['refused', 'Closed - can\'t do it (explain)'], ['withdrawn', 'Withdrawn']];
  var CLOSED = { completed: 1, refused: 1, withdrawn: 1 };

  var rows = null;
  var acks = null;          // committee data protection confirmations (migration 111)
  var filter = 'open';
  var loading = false;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function day(iso) { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } }
  function daysLeft(iso) { return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000); }
  function say(el, text, bad) { if (!el) return; el.textContent = text || ''; el.className = 'priv-msg' + (bad ? ' is-bad' : ' is-ok'); el.hidden = !text; }
  function fail(el, err) { say(el, (err && err.message) || 'Something went wrong', true); }
  function download(name, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function slug(s) { return String(s || 'person').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'person'; }

  function load(quiet) {
    if (loading) return Promise.resolve();
    loading = true;
    return supabaseClient.rpc('president_list_compliance_requests').then(function (res) {
      loading = false;
      if (res.error) {
        if (!quiet) root.innerHTML = '<p class="auth-error" style="display:block">' + esc(/function|schema cache/i.test(res.error.message) ? 'Run migration 110-data-protection-compliance.sql in Supabase to switch this on.' : res.error.message) + '</p>';
        if (countEl) { countEl.textContent = 'Not set up'; }
        return;
      }
      rows = res.data || [];
      supabaseClient.rpc('president_committee_acknowledgements').then(function (a) { acks = a.error ? null : (a.data || []); if (rows) render(); }, function () {});
      var open = rows.filter(function (r) { return !CLOSED[r.status]; });
      var overdue = open.filter(function (r) { return daysLeft(r.due_at) < 0; }).length;
      if (countEl) { countEl.textContent = open.length ? open.length + ' open' + (overdue ? ' · ' + overdue + ' overdue' : '') : 'None open'; countEl.style.color = overdue ? 'var(--accent-red)' : ''; }
      render();
    }, function () { loading = false; });
  }

  function dueChip(r) {
    if (CLOSED[r.status]) return '<span class="priv-chip">Closed ' + esc(day(r.handled_at)) + '</span>';
    var d = daysLeft(r.due_at);
    if (d < 0) return '<span class="priv-chip priv-chip--bad">Overdue by ' + (-d) + ' day' + (d === -1 ? '' : 's') + '</span>';
    if (d <= 7) return '<span class="priv-chip priv-chip--warn">Due in ' + d + ' day' + (d === 1 ? '' : 's') + '</span>';
    return '<span class="priv-chip">Due ' + esc(day(r.due_at)) + '</span>';
  }

  function reqCard(r) {
    var statusOpts = STATUS.map(function (s) { return '<option value="' + s[0] + '"' + (r.status === s[0] ? ' selected' : '') + '>' + esc(s[1]) + '</option>'; }).join('');
    var tools = '';
    if (r.account_id && !CLOSED[r.status]) {
      tools = '<div class="privreq-tools">' +
        '<button type="button" class="btn btn-outline btn-sm" data-pa-export="' + esc(r.account_id) + '" data-name="' + esc(r.name || r.email) + '">Download their data</button>' +
        (r.kind === 'erasure' ? '<button type="button" class="btn btn-outline btn-sm sh-btn-danger" data-pa-erase="' + esc(r.account_id) + '" data-name="' + esc(r.name || r.email) + '" data-req="' + esc(r.id) + '">Erase their data&hellip;</button>' : '') +
        '</div>';
    } else if (!r.account_id && (r.kind === 'access' || r.kind === 'erasure')) {
      tools = '<p class="sh-muted">No account matches this email. Check Pending members and the requests lists, and the Supabase tables, by hand.</p>';
    }
    return '<article class="privreq' + (r.kind === 'safeguarding' ? ' privreq--safeguarding' : '') + '" data-req-id="' + esc(r.id) + '">' +
      '<header><span class="priv-chip priv-chip--kind">' + esc(KIND[r.kind] || r.kind) + '</span> ' + dueChip(r) + '</header>' +
      '<p class="privreq-who"><strong>' + esc(r.name || '(no name)') + '</strong> &middot; <a href="mailto:' + esc(r.email) + '">' + esc(r.email) + '</a> <small>&middot; received ' + esc(day(r.created_at)) + '</small></p>' +
      (r.details ? '<p class="privreq-details">' + esc(r.details) + '</p>' : '') +
      (r.kind === 'safeguarding' ? '<p class="privreq-flag">Safeguarding concern: don\'t investigate it yourselves. Consider passing it to ULSU\'s Safeguarding Officers straight away (see the Safeguarding page).</p>' : '') +
      tools +
      '<div class="privreq-handle"><label>Status <select data-pa-status>' + statusOpts + '</select></label>' +
      '<label class="privreq-note">Note (shown to them if they\'re signed in) <input type="text" maxlength="2000" data-pa-note value="' + esc(r.outcome_note || '') + '"></label>' +
      '<button type="button" class="btn btn-primary btn-sm" data-pa-save="' + esc(r.id) + '">Save</button></div>' +
      '<p class="priv-msg" data-pa-msg hidden role="status"></p></article>';
  }

  function render() {
    var open = rows.filter(function (r) { return !CLOSED[r.status]; });
    var closed = rows.filter(function (r) { return CLOSED[r.status]; });
    var list = filter === 'open' ? open : closed;
    root.innerHTML =
      '<p class="sh-muted" style="max-width:70ch">Every request has a legal deadline of <strong>one calendar month</strong>. Before giving anyone a copy of data, or deleting an account, confirm they are who they say they are (for example by replying to the email on the account). Keep the Note short and don\'t put personal data in it.</p>' +
      '<div class="dash-filter-tabs" role="group" aria-label="Show requests">' +
        '<button type="button" class="dash-filter-tab' + (filter === 'open' ? ' is-active' : '') + '" data-pa-filter="open">Open (' + open.length + ')</button>' +
        '<button type="button" class="dash-filter-tab' + (filter === 'closed' ? ' is-active' : '') + '" data-pa-filter="closed">Closed (' + closed.length + ')</button></div>' +
      '<div class="privreq-list">' + (list.length ? list.map(reqCard).join('') : '<p class="sh-muted">' + (filter === 'open' ? 'No open requests. 🎉' : 'Nothing closed yet.') + '</p>') + '</div>' +
      '<h3 class="privreq-h">Tools</h3>' +
      '<div class="priv-grid">' +
        '<div class="priv-card"><h3>Retention clean-up</h3><p>Deletes data that has outlived its use: analytics older than 14 months, email logs older than 24 months, old rejected requests and so on (the schedule is in the privacy notice). Run it at least monthly unless the nightly job is switched on.</p>' +
          '<button type="button" class="btn btn-outline" data-pa-purge>Run clean-up now</button><div class="priv-msg" data-pa-purge-msg hidden role="status"></div></div>' +
        '<div class="priv-card"><h3>Inactive accounts</h3><p>People who haven\'t signed in for a long time. We say in the privacy notice that we review accounts unused for 12 months and delete them.</p>' +
          '<label>Not signed in for <select data-pa-months><option value="12" selected>12+ months</option><option value="18">18+ months</option><option value="24">24+ months</option></select></label>' +
          '<button type="button" class="btn btn-outline" data-pa-inactive>Show them</button></div></div>' +
      '<div data-pa-inactive-list></div>' +
      (acks ? '<h3 class="privreq-h">Committee data protection training</h3><p class="sh-muted" style="max-width:70ch">ULSU\'s Code of Conduct says committee members complete the Students\' Union\'s data protection training before accessing personal data. Each person is asked once a year when they open the dashboard.</p>' +
        (acks.length ? '<div class="legal-table-wrap"><table class="legal-table"><thead><tr><th scope="col">Person</th><th scope="col">Year</th><th scope="col">Training</th><th scope="col">Confirmed</th></tr></thead><tbody>' + acks.map(function (a) {
          return '<tr><th scope="row">' + esc(a.name) + '</th><td>' + esc(a.academic_year) + '</td><td>' + (a.training_status === 'completed' ? 'Completed' : '<strong>Not yet</strong>') + '</td><td>' + esc(day(a.at)) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="sh-muted">No one has confirmed yet.</p>') : '') +
      '<p class="priv-msg" data-pa-erase-msg hidden role="status"></p>';
  }

  function eraseUser(userId, name, reqId, msgEl) {
    var typed = window.prompt('This permanently deletes ' + name + '\'s login and everything linked to it (profile, messages they sent, Sankofa records, activity). It cannot be undone.\n\nType ERASE to continue.');
    if (typed !== 'ERASE') return;
    supabaseClient.rpc('president_erase_user', { p_user: userId }).then(function (res) {
      if (res.error) { fail(msgEl, res.error); return; }
      var d = res.data || {};
      var lines = ['Erased ' + (d.erased || name) + '.'];
      var del = d.deleted || {};
      var bits = Object.keys(del).map(function (k) { return k.replace(/_/g, ' ') + ': ' + del[k]; });
      if (bits.length) lines.push('Removed - ' + bits.join('; ') + '.');
      (d.still_to_check || []).forEach(function (t) { lines.push('Still to check: ' + t); });
      var box = root.querySelector('[data-pa-erase-msg]');
      say(box, lines.join('\n'));
      if (box) box.style.whiteSpace = 'pre-line';
      var done = reqId ? supabaseClient.rpc('president_update_compliance_request', { p_id: reqId, p_status: 'completed', p_note: 'Data erased.' }) : Promise.resolve();
      return Promise.resolve(done).then(function () { return load(true); }).then(function () {
        var b2 = root.querySelector('[data-pa-erase-msg]');
        say(b2, lines.join('\n')); if (b2) { b2.style.whiteSpace = 'pre-line'; b2.scrollIntoView({ block: 'center' }); }
      });
    }, function (err) { fail(msgEl, err); });
  }

  root.addEventListener('click', function (e) {
    var t = e.target, el;
    if ((el = t.closest('[data-pa-filter]'))) { filter = el.getAttribute('data-pa-filter'); render(); return; }
    if ((el = t.closest('[data-pa-save]'))) {
      var art = el.closest('.privreq'), msg = art.querySelector('[data-pa-msg]');
      el.disabled = true;
      supabaseClient.rpc('president_update_compliance_request', { p_id: el.getAttribute('data-pa-save'), p_status: art.querySelector('[data-pa-status]').value, p_note: art.querySelector('[data-pa-note]').value }).then(function (res) {
        el.disabled = false;
        if (res.error) { fail(msg, res.error); return; }
        load(true);
      }, function (err) { el.disabled = false; fail(msg, err); });
      return;
    }
    if ((el = t.closest('[data-pa-export]'))) {
      var m1 = el.closest('.privreq').querySelector('[data-pa-msg]');
      el.disabled = true;
      supabaseClient.rpc('president_export_user_data', { p_user: el.getAttribute('data-pa-export') }).then(function (res) {
        el.disabled = false;
        if (res.error) { fail(m1, res.error); return; }
        download('lacms-data-' + slug(el.getAttribute('data-name')) + '-' + new Date().toISOString().slice(0, 10) + '.json', res.data);
        say(m1, 'Downloaded. Send it to them securely, only after confirming who they are, then delete your copy.');
      }, function (err) { el.disabled = false; fail(m1, err); });
      return;
    }
    if ((el = t.closest('[data-pa-erase]'))) {
      var ownCard = el.closest('.privreq');
      eraseUser(el.getAttribute('data-pa-erase'), el.getAttribute('data-name'), el.getAttribute('data-req'), ownCard ? ownCard.querySelector('[data-pa-msg]') : root.querySelector('[data-pa-erase-msg]'));
      return;
    }
    if (t.closest('[data-pa-purge]')) {
      var box = root.querySelector('[data-pa-purge-msg]');
      supabaseClient.rpc('privacy_purge_expired').then(function (res) {
        if (res.error) { fail(box, res.error); return; }
        var d = res.data || {};
        var parts = Object.keys(d).map(function (k) { return k.replace(/_/g, ' ') + ': ' + d[k]; });
        say(box, 'Done. ' + parts.join('; '));
      }, function (err) { fail(box, err); });
      return;
    }
    if (t.closest('[data-pa-inactive]')) {
      var holder = root.querySelector('[data-pa-inactive-list]');
      var months = parseInt(root.querySelector('[data-pa-months]').value, 10) || 12;
      holder.innerHTML = '<p class="sh-muted">Loading&hellip;</p>';
      supabaseClient.rpc('privacy_inactive_accounts', { p_months: months }).then(function (res) {
        if (res.error) { holder.innerHTML = '<p class="auth-error" style="display:block">' + esc(res.error.message) + '</p>'; return; }
        var d = res.data || [];
        holder.innerHTML = d.length ? '<div class="legal-table-wrap"><table class="legal-table"><thead><tr><th scope="col">Person</th><th scope="col">Type</th><th scope="col">Last signed in</th><th scope="col"></th></tr></thead><tbody>' +
          d.map(function (u) {
            return '<tr><th scope="row">' + esc(u.name || '(no name)') + '<br><small>' + esc(u.email) + '</small></th><td>' + esc(u.kind) + '</td><td>' + esc(day(u.last_seen)) + '</td><td><button type="button" class="btn btn-outline btn-sm sh-btn-danger" data-pa-erase="' + esc(u.user_id) + '" data-name="' + esc(u.name || u.email) + '">Erase&hellip;</button></td></tr>';
          }).join('') + '</tbody></table></div>' : '<p class="sh-muted">No one has been inactive that long.</p>';
      }, function (err) { holder.innerHTML = '<p class="auth-error" style="display:block">' + esc(err.message) + '</p>'; });
      return;
    }
  });

  if (card) card.addEventListener('click', function () { load(); });
  supabaseClient.auth.getSession().then(function (r) {
    if (!r.data || !r.data.session) return;
    supabaseClient.rpc('is_president').then(function (p) {
      if (p.error || p.data !== true) { if (card) card.style.display = 'none'; return; }
      load(true);
    });
  });
  setInterval(function () { var panel = document.getElementById('dash-panel-privacy'); if (panel && panel.style.display !== 'none' && document.visibilityState === 'visible') load(true); }, 60000);
})();
