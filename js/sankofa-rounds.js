// Sankofa application phases on the dashboard (migration 078).
//
// At the top of Dashboard -> Sankofa: the CURRENT phase with a big open/close
// button, an Edit button (name, opening and closing dates, the message members
// see while it's closed), and "Start a new phase" for Phase 2, 3 and so on.
// Below it, every phase so far with its application count, and a filter that
// narrows the applications list to one phase.
//
// Everything is enforced in the database: only the president can change a
// phase (president_save_sankofa_round / president_create_sankofa_round), a
// phase is OPEN only while its switch is on AND the date window includes now,
// and the application form refuses anything outside an open phase. This file
// renders and sends; people with Sankofa dashboard access but who aren't the
// president see the status read-only.
(function () {
  'use strict';

  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;
  var box = document.getElementById('sankofa-rounds');
  if (!box) return;
  var list = document.getElementById('sankofa-applications-list');
  var card = document.querySelector('[data-dash-section="sankofa"]');

  var isPresident = false;
  var rounds = [];          // newest first
  var appRounds = {};       // application id -> round id
  var offset = 0;           // server clock minus this device's clock
  var loaded = false;
  var filter = 'all';

  function esc(str) {
    return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function now() { return Date.now() + offset; }
  function stateOf(r) {
    if (!r.is_open) return 'closed';
    if (r.opens_at && now() < new Date(r.opens_at).getTime()) return 'scheduled';
    if (r.closes_at && now() > new Date(r.closes_at).getTime()) return 'ended';
    return 'open';
  }
  function dt(iso) {
    return new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function countFor(id) {
    var n = 0;
    Object.keys(appRounds).forEach(function (k) { if (appRounds[k] === id) n++; });
    return n;
  }
  function untilText(iso) {
    var ms = new Date(iso).getTime() - now();
    if (ms <= 0) return '';
    var d = Math.floor(ms / 86400000);
    if (d >= 1) return d + (d === 1 ? ' day' : ' days') + ' left';
    var h = Math.floor(ms / 3600000);
    return h >= 1 ? h + (h === 1 ? ' hour' : ' hours') + ' left' : 'closing very soon';
  }
  // <input type="datetime-local"> wants local "YYYY-MM-DDTHH:MM".
  function toLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fromLocalInput(v) { return v ? new Date(v).toISOString() : null; }

  var STATE_LABEL = { open: 'Open', closed: 'Closed', scheduled: 'Opens soon', ended: 'Closed (deadline passed)' };

  // ---- Loading ---------------------------------------------------------------
  function load() {
    return Promise.all([
      supabaseClient.rpc('get_sankofa_round'),
      supabaseClient.from('sankofa_rounds').select('*').order('created_at', { ascending: false }),
      supabaseClient.rpc('is_president'),
      supabaseClient.rpc('president_get_sankofa_application_rounds')
    ]).then(function (res) {
      if (res[1].error) {
        box.hidden = false;
        box.innerHTML = '<p class="sk-note">Application phases aren\'t switched on yet - run migration 078 in Supabase (see README-members-setup.md, section 131).</p>';
        return;
      }
      var cur = Array.isArray(res[0].data) ? res[0].data[0] : res[0].data;
      if (cur && cur.server_now) offset = new Date(cur.server_now).getTime() - Date.now();
      rounds = res[1].data || [];
      isPresident = !res[2].error && res[2].data === true;
      appRounds = {};
      (res[3].data || []).forEach(function (row) { appRounds[row.application_id] = row.round_id; });
      loaded = true;
      render();
      applyFilter();
    });
  }

  // ---- Rendering ---------------------------------------------------------------
  function render() {
    box.hidden = false;
    var cur = rounds[0];
    if (!cur) {
      box.innerHTML = '<div class="sk-current sk-state-closed"><div class="sk-current-main"><span class="sk-eyebrow">Application phases</span><h3>No phase yet</h3><p>Applications are closed.</p></div>' +
        (isPresident ? '<div class="sk-actions"><button type="button" class="btn btn-primary" data-sk-new>Start Phase 1</button></div>' : '') + '</div>';
      return;
    }
    var st = stateOf(cur);
    var detail = '';
    if (st === 'open') detail = cur.closes_at ? 'Closes ' + dt(cur.closes_at) + ' (' + untilText(cur.closes_at) + ')' : 'Open until you close it';
    else if (st === 'scheduled') detail = 'Opens ' + dt(cur.opens_at);
    else if (st === 'ended') detail = 'Closed automatically on ' + dt(cur.closes_at);
    else detail = 'Switched off - members see that applications are closed';

    var toggleLabel = st === 'open' || st === 'scheduled' ? 'Close applications' : 'Open applications';
    box.innerHTML =
      '<div class="sk-current sk-state-' + st + '">' +
        '<div class="sk-current-main">' +
          '<span class="sk-eyebrow">Current phase</span>' +
          '<h3>' + esc(cur.name) + ' <span class="sk-pill sk-pill--' + st + '">' + esc(STATE_LABEL[st]) + '</span></h3>' +
          '<p>' + esc(detail) + '</p>' +
          '<p class="sk-count">' + countFor(cur.id) + ' mentee application' + (countFor(cur.id) === 1 ? '' : 's') + ' in this phase</p>' +
          (cur.message ? '<p class="sk-msg">Message to members while it\'s closed: &ldquo;' + esc(cur.message) + '&rdquo;</p>' : '') +
        '</div>' +
        (isPresident
          ? '<div class="sk-actions">' +
              '<button type="button" class="btn ' + (toggleLabel === 'Close applications' ? 'btn-outline sk-btn-close' : 'btn-primary') + '" data-sk-toggle>' + toggleLabel + '</button>' +
              '<button type="button" class="btn btn-outline" data-sk-edit="' + esc(cur.id) + '">Edit phase</button>' +
              '<button type="button" class="btn btn-outline" data-sk-new>Start a new phase…</button>' +
            '</div>'
          : '<p class="sk-note">Only the president can open or close applications.</p>') +
      '</div>' +
      '<div class="sk-history">' +
        '<div class="sk-history-head"><h4>All phases</h4>' +
        '<label class="sk-filter">Show applications from <select id="sk-round-filter">' +
          '<option value="all">All phases</option>' +
          rounds.map(function (r) { return '<option value="' + esc(r.id) + '"' + (filter === r.id ? ' selected' : '') + '>' + esc(r.name) + ' (' + countFor(r.id) + ')</option>'; }).join('') +
        '</select></label></div>' +
        '<ul class="sk-rounds">' + rounds.map(function (r, i) {
          var s = stateOf(r);
          var when = r.opens_at || r.closes_at
            ? [r.opens_at ? 'opens ' + dt(r.opens_at) : '', r.closes_at ? 'closes ' + dt(r.closes_at) : ''].filter(Boolean).join(' · ')
            : 'no dates set';
          return '<li><span class="sk-round-name">' + esc(r.name) + (i === 0 ? ' <small>current</small>' : '') + '</span>' +
            '<span class="sk-pill sk-pill--' + s + '">' + esc(STATE_LABEL[s]) + '</span>' +
            '<span class="sk-round-when">' + esc(when) + '</span>' +
            '<span class="sk-round-count">' + countFor(r.id) + ' applied</span>' +
            (isPresident && i !== 0 ? '<button type="button" class="sk-link" data-sk-edit="' + esc(r.id) + '">Edit</button>' : '') + '</li>';
        }).join('') + '</ul>' +
        '<p class="sk-note">Mentor applications (from doctors) aren\'t split by phase, so they show only under "All phases".</p>' +
      '</div>';
  }

  // Narrow the applications list to one phase, and label each mentee card with its phase.
  function applyFilter() {
    if (!list || !loaded) return;
    var byId = {};
    rounds.forEach(function (r) { byId[r.id] = r; });
    Array.prototype.forEach.call(list.querySelectorAll('.app-card'), function (c) {
      var del = c.querySelector('[data-sankofa-delete]');
      if (!del) return;
      var id = del.getAttribute('data-id');
      var isMentee = del.getAttribute('data-type') === 'mentee';
      var rid = appRounds[id];
      if (isMentee && rid && byId[rid]) {
        var head = c.querySelector('.app-card-head-main');
        if (head && !head.querySelector('.sk-card-round')) {
          var badge = document.createElement('span');
          badge.className = 'app-badge sk-card-round';
          badge.textContent = byId[rid].name;
          var first = head.querySelector('.app-badge');
          if (first && first.nextSibling) head.insertBefore(badge, first.nextSibling); else head.appendChild(badge);
        }
      }
      var show = filter === 'all' || (isMentee && rid === filter);
      c.style.display = show ? '' : 'none';
    });
  }

  // ---- Dialogs ---------------------------------------------------------------
  function openDialog(html) {
    var previous = document.activeElement;
    var backdrop = document.createElement('div');
    backdrop.className = 'guide-backdrop';
    var dialog = document.createElement('div');
    dialog.className = 'guide-dialog sk-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = html;
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    document.body.classList.add('guide-open');
    requestAnimationFrame(function () { backdrop.classList.add('is-in'); var f = dialog.querySelector('[data-autofocus]') || dialog.querySelector('input, button'); if (f) f.focus(); });
    var api = {
      el: dialog,
      close: function () {
        document.removeEventListener('keydown', onKey, true);
        backdrop.classList.remove('is-in');
        document.body.classList.remove('guide-open');
        setTimeout(function () { backdrop.remove(); }, 200);
        if (previous && previous.focus && document.body.contains(previous)) previous.focus();
      }
    };
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); api.close(); return; }
      if (e.key !== 'Tab') return;
      var f = dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('mousedown', function (e) { if (e.target === backdrop) api.close(); });
    dialog.addEventListener('click', function (e) { if (e.target.closest('[data-dialog-close]')) api.close(); });
    return api;
  }

  function call(fn, args) {
    return supabaseClient.rpc(fn, args).then(function (res) {
      if (res.error) throw new Error(res.error.message);
      return res.data;
    });
  }

  // Form fields shared by "edit" and "new phase".
  function fieldsHtml(r, opts) {
    return '<div class="field"><label for="sk-name">Phase name</label><input type="text" id="sk-name" maxlength="60" value="' + esc(r.name || '') + '" data-autofocus></div>' +
      (opts.openSwitch
        ? '<div class="field"><label class="res-switch"><input type="checkbox" id="sk-open" role="switch"' + (r.is_open ? ' checked' : '') + '><span class="res-switch-track" aria-hidden="true"><span class="res-switch-thumb"></span></span>' +
          '<span class="res-switch-text"><strong>' + (opts.newPhase ? 'Open applications straight away' : 'Applications open') + '</strong><small>' + (opts.newPhase ? 'Off = create it closed and open it later.' : 'Off = closed, whatever the dates say.') + '</small></span></label></div>'
        : '') +
      '<div class="sk-dates"><div class="field"><label for="sk-opens">Opens automatically <span class="guide-optional">(optional)</span></label><input type="datetime-local" id="sk-opens" value="' + esc(toLocalInput(r.opens_at)) + '"></div>' +
      '<div class="field"><label for="sk-closes">Closes automatically <span class="guide-optional">(optional)</span></label><input type="datetime-local" id="sk-closes" value="' + esc(toLocalInput(r.closes_at)) + '"></div></div>' +
      '<div class="field"><label for="sk-msg">Message for members while it\'s closed <span class="guide-optional">(optional)</span></label>' +
      '<textarea id="sk-msg" rows="2" maxlength="300" placeholder="e.g. Phase 2 opens in January - keep an eye on the hub.">' + esc(r.message || '') + '</textarea></div>' +
      '<p class="guide-error" id="sk-error" role="alert" hidden></p>';
  }
  function readFields(d) {
    var open = d.querySelector('#sk-open');
    return {
      name: d.querySelector('#sk-name').value.trim(),
      is_open: open ? open.checked : true,
      opens_at: fromLocalInput(d.querySelector('#sk-opens').value),
      closes_at: fromLocalInput(d.querySelector('#sk-closes').value),
      message: d.querySelector('#sk-msg').value.trim() || null
    };
  }
  function bindForm(dlg, submit, label) {
    var form = dlg.el.querySelector('form');
    var err = dlg.el.querySelector('#sk-error');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = readFields(dlg.el);
      err.hidden = true;
      if (!v.name) { err.textContent = 'Give the phase a name.'; err.hidden = false; return; }
      if (v.opens_at && v.closes_at && new Date(v.opens_at) >= new Date(v.closes_at)) { err.textContent = 'It has to open before it closes.'; err.hidden = false; return; }
      var btn = form.querySelector('[type="submit"]');
      btn.disabled = true; btn.textContent = 'Saving…';
      submit(v).then(function () { dlg.close(); return load(); }).then(function () { toast(label); }).catch(function (ex) {
        btn.disabled = false; btn.textContent = 'Save';
        err.textContent = ex.message; err.hidden = false;
      });
    });
  }

  function editRound(id) {
    var r = rounds.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    var dlg = openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Sankofa</span><h2 class="guide-title">Edit ' + esc(r.name) + '</h2>' +
      '<form class="guide-form" novalidate>' + fieldsHtml(r, { openSwitch: true }) +
      '<div class="guide-actions"><button type="submit" class="btn btn-primary">Save</button><button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div></form>');
    bindForm(dlg, function (v) {
      return call('president_save_sankofa_round', { p_id: id, p_name: v.name, p_is_open: v.is_open, p_opens_at: v.opens_at, p_closes_at: v.closes_at, p_message: v.message });
    }, 'Saved.');
  }

  function newRound() {
    var n = rounds.length + 1;
    var dlg = openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Sankofa</span><h2 class="guide-title">Start a new phase</h2>' +
      '<p class="guide-text">This becomes the phase members apply to' + (rounds[0] ? ', and closes ' + esc(rounds[0].name) + ' if it\'s still open' : '') + '. Anyone who applied before can apply again.</p>' +
      '<form class="guide-form" novalidate>' + fieldsHtml({ name: 'Phase ' + n, is_open: true }, { openSwitch: true, newPhase: true }) +
      '<div class="guide-actions"><button type="submit" class="btn btn-primary">Start phase</button><button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div></form>');
    bindForm(dlg, function (v) {
      return call('president_create_sankofa_round', { p_name: v.name, p_is_open: v.is_open, p_opens_at: v.opens_at, p_closes_at: v.closes_at, p_message: v.message });
    }, 'New phase started.');
  }

  // Open / close the current phase with one click.
  function toggle() {
    var cur = rounds[0];
    if (!cur) return;
    var st = stateOf(cur);
    if (st === 'open' || st === 'scheduled') {
      var dlg = openDialog('<span class="guide-eyebrow">Sankofa</span><h2 class="guide-title">Close ' + esc(cur.name) + ' applications?</h2>' +
        '<p class="guide-text">Members will see that applications are closed (with your message, if you set one). Nothing already submitted is affected, and you can reopen it any time.</p>' +
        '<p class="guide-error" id="sk-error" role="alert" hidden></p>' +
        '<div class="guide-actions"><button type="button" class="btn btn-primary sk-btn-danger" data-sk-confirm data-autofocus>Close applications</button><button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div>');
      dlg.el.querySelector('[data-sk-confirm]').addEventListener('click', function () {
        call('president_save_sankofa_round', { p_id: cur.id, p_name: cur.name, p_is_open: false, p_opens_at: cur.opens_at, p_closes_at: cur.closes_at, p_message: cur.message })
          .then(function () { dlg.close(); return load(); }).then(function () { toast(cur.name + ' applications are closed.'); })
          .catch(function (ex) { var e = dlg.el.querySelector('#sk-error'); e.textContent = ex.message; e.hidden = false; });
      });
      return;
    }
    // Opening: if the old closing date has passed, ask for a new one (or none).
    var stale = cur.closes_at && new Date(cur.closes_at).getTime() <= now();
    var dlg2 = openDialog('<span class="guide-eyebrow">Sankofa</span><h2 class="guide-title">Open ' + esc(cur.name) + ' applications?</h2>' +
      '<p class="guide-text">Eligible members can apply straight away.' + (stale ? ' The closing date (' + esc(dt(cur.closes_at)) + ') has passed, so choose a new one - or leave it empty to keep it open until you close it.' : '') + '</p>' +
      '<form class="guide-form" novalidate><div class="field"><label for="sk-closes">Closes automatically <span class="guide-optional">(optional)</span></label>' +
      '<input type="datetime-local" id="sk-closes" value="' + esc(stale ? '' : toLocalInput(cur.closes_at)) + '" data-autofocus></div>' +
      '<p class="guide-error" id="sk-error" role="alert" hidden></p>' +
      '<div class="guide-actions"><button type="submit" class="btn btn-primary">Open applications</button><button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div></form>');
    dlg2.el.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var closes = fromLocalInput(dlg2.el.querySelector('#sk-closes').value);
      var errEl = dlg2.el.querySelector('#sk-error');
      call('president_save_sankofa_round', { p_id: cur.id, p_name: cur.name, p_is_open: true, p_opens_at: null, p_closes_at: closes, p_message: cur.message })
        .then(function () { dlg2.close(); return load(); }).then(function () { toast(cur.name + ' applications are open.'); })
        .catch(function (ex) { errEl.textContent = ex.message; errEl.hidden = false; });
    });
  }

  function toast(message) {
    var t = document.createElement('div');
    t.className = 'sk-toast';
    t.setAttribute('role', 'status');
    t.textContent = message;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('is-in'); });
    setTimeout(function () { t.classList.remove('is-in'); setTimeout(function () { t.remove(); }, 250); }, 4500);
  }

  // ---- Wiring ------------------------------------------------------------------
  box.addEventListener('click', function (e) {
    if (e.target.closest('[data-sk-toggle]')) { toggle(); return; }
    if (e.target.closest('[data-sk-new]')) { newRound(); return; }
    var edit = e.target.closest('[data-sk-edit]');
    if (edit) editRound(edit.getAttribute('data-sk-edit'));
  });
  box.addEventListener('change', function (e) {
    if (e.target.id === 'sk-round-filter') { filter = e.target.value; applyFilter(); }
  });

  // The applications list is rebuilt by js/members.js (on load and when the
  // tabs change) - re-apply the phase filter and labels whenever it is.
  if (list && window.MutationObserver) {
    var pending = false;
    new MutationObserver(function () {
      if (pending) return;
      pending = true;
      setTimeout(function () { pending = false; applyFilter(); }, 0);
    }).observe(list, { childList: true });
  }

  // Load when the Sankofa card is opened (always fresh), or the page is opened straight to #sankofa.
  if (card) card.addEventListener('click', load);
  if (window.location.hash === '#sankofa') supabaseClient.auth.getSession().then(function (r) { if (r.data && r.data.session) load(); });
})();
