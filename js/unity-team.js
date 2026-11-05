// Unity Cup - the private team page (unity-team.html#<secret>)
//
// A team manager opens the secret link the committee sent them (no account, no sign-in) and enters their
// team's players: name, shirt number and position. The page can only ever see and change THAT team: every call
// carries the secret and the database checks it (migration 116). It saves as you go, shows the line-up on a
// pitch as you build it, and has a "Submit line-up" button so the committee knows you've finished.
//
// The secret lives in the part of the address after the "#", which browsers never send to a server.

(function () {
  'use strict';

  var root = document.getElementById('tm-root');
  if (!root) return;

  var POS = [['Goalkeeper', 'GK'], ['Defender', 'DEF'], ['Midfielder', 'MID'], ['Forward', 'FWD']];
  var ERR = {
    bad_name: 'Please type the player\'s name.', bad_number: 'The shirt number should be 1 to 3 digits.', bad_position: 'Please pick a position from the list.',
    too_many: 'That is the most players one team can have (30).', busy: 'You\'re going quickly! Please wait a moment and try again.',
    not_yours: 'That player isn\'t in your team.', no_players: 'Add at least one player before you submit.',
    closed: 'The committee has closed editing, so changes can\'t be saved any more.', deadline: 'The deadline has passed, so changes can\'t be saved any more.',
    link_off: 'This link has been switched off. Ask the organisers.', bad_link: 'This link is no longer valid. Ask the organisers for a new one.',
    server: 'Something went wrong. Please check your connection and try again.'
  };

  var token = '', S = null, pending = 0, tmpN = 0, sqPos = null, toastTimer = null;

  function $(sel, el) { return (el || document).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function say(t) { var el = document.getElementById('tm-live'); if (el) { el.textContent = ''; window.setTimeout(function () { el.textContent = t; }, 30); } }
  function lineOf(p) { return window.UnityPitch ? UnityPitch.lineOf(p) : null; }
  function numOf(p) { var n = parseInt(p.shirt_no, 10); return isNaN(n) ? 999 : n; }
  function nextNumber(list) { var used = {}; list.forEach(function (p) { var n = parseInt(p.shirt_no, 10); if (!isNaN(n)) used[n] = 1; }); var n = 1; while (used[n]) n++; return n; }
  function lineName(k) { return { gk: 'Goalkeeper', def: 'Defence', mid: 'Midfield', fwd: 'Attack' }[k] || 'No position yet'; }
  function ready() { return typeof supabaseIsConfigured !== 'undefined' && supabaseIsConfigured && typeof supabaseClient !== 'undefined' && supabaseClient; }
  function logo() { return S.team.logo_path ? supabaseClient.storage.from('unity-cup-gallery').getPublicUrl(S.team.logo_path).data.publicUrl : ''; }
  function when(iso) { try { return new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }

  // ---- theme button (this page doesn't load the main site script) ----
  var tbtn = $('[data-tm-theme]');
  if (tbtn) tbtn.addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', cur);
    try { localStorage.setItem('lacms-theme', cur); } catch (e) {}
  });

  // ---------------------------------------------------------------------
  function screen(title, text, extra) {
    root.innerHTML = '<div class="tm-card tm-card--center"><div class="tm-mark" aria-hidden="true">&#9917;</div><h1>' + esc(title) + '</h1><p>' + text + '</p>' + (extra || '') + '</div>';
  }

  function crest() {
    var u = logo(), t = S.team;
    var ini = (t.short_name || t.name || '?').replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 3).toUpperCase();
    return '<span class="uc-crest uc-crest--xl" style="--tc:' + esc(t.colour) + '">' + (u ? '<img src="' + esc(u) + '" alt="">' : '<b>' + esc(ini) + '</b>') + '</span>';
  }

  function load(first) {
    return supabaseClient.rpc('unity_team_open', { p_token: token }).then(function (res) {
      if (res.error || !res.data) { if (first) screen('Can\'t open this page', 'Something went wrong while opening your team. Please check your connection and try again.', '<button type="button" class="uc-btn uc-btn--gold" onclick="location.reload()">Try again</button>'); return false; }
      if (!res.data.ok) {
        var e = res.data.error;
        screen(e === 'link_off' ? 'This link is switched off' : 'This link isn\'t valid', esc(ERR[e] || ERR.bad_link) + ' You can email <a href="mailto:acms@lincolnsu.com">acms@lincolnsu.com</a> for help.');
        return false;
      }
      S = res.data;
      return true;
    }, function () { if (first) screen('You\'re offline', 'We couldn\'t reach the server. Check your connection and try again.', '<button type="button" class="uc-btn uc-btn--gold" onclick="location.reload()">Try again</button>'); return false; });
  }

  // ---------------------------------------------------------------------
  function render() {
    var t = S.team, can = S.editable;
    var list = S.players;
    if (!sqPos) sqPos = list.some(function (p) { return lineOf(p.position) === 'gk'; }) ? 'Defender' : 'Goalkeeper';
    var chips = '<span class="tm-chip">' + list.length + (list.length === 1 ? ' player' : ' players') + '</span>';
    if (S.submitted_at) chips += '<span class="tm-chip is-ok">Submitted ' + esc(when(S.submitted_at)) + '</span>';
    if (S.deadline && can) chips += '<span class="tm-chip is-warn">Closes ' + esc(when(S.deadline)) + '</span>';
    root.innerHTML =
      '<section class="tm-hero" style="--tc:' + esc(t.colour) + '">' + crest() + '<div><span class="uc-kicker">' + esc(S.event_title || 'Unity Cup') + '</span><h1>' + esc(t.name) + '</h1><div class="tm-chips" id="tm-chips">' + chips + '</div></div></section>' +
      '<div id="tm-banner"></div>' +
      (can ? '<ol class="tm-steps"><li><b>1</b><span>Add your players</span></li><li><b>2</b><span>Check the pitch</span></li><li><b>3</b><span>Press Submit</span></li></ol>' : '') +
      '<div class="sq tm-sq" id="tm-body"></div><div id="tm-submit"></div>';
    banner(); body(); submitCard();
  }

  function banner() {
    var b = $('#tm-banner'); if (!b) return;
    var m = '';
    if (!S.editable) {
      m = '<div class="uc-banner"><strong>' + (S.blocked === 'deadline' ? 'The deadline has passed.' : 'Editing is closed.') + '</strong> Your line-up is shown below as the committee has it. If something is wrong, email <a href="mailto:acms@lincolnsu.com">acms@lincolnsu.com</a>.</div>';
    } else if (S.submitted_at) {
      m = '<div class="uc-banner uc-banner--done"><span class="uc-tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span><span><strong>Line-up submitted. Thank you!</strong> You can still make changes until the committee closes editing.</span></div>';
    }
    b.innerHTML = m;
  }

  function body() {
    var el = $('#tm-body'); if (!el) return;
    var t = S.team, can = S.editable;
    el.innerHTML =
      '<div class="sq-main" style="--tc:' + esc(t.colour) + '">' +
        (can ? '<div class="ua-card sq-add-card"><div class="sq-head"><div><h3>Add a player</h3><small class="ua-hint">Type a name and press Enter. The next player is ready straight away.</small></div></div>' +
          '<form class="sq-add" data-tm-add novalidate><div class="sq-add-grid">' +
          '<label class="ua-field sq-name"><span>Player name</span><input name="name" autocomplete="off" autocapitalize="words" maxlength="60" placeholder="e.g. Marcus Tolliver" aria-label="Player name"></label>' +
          '<label class="ua-field sq-num"><span>Shirt no.</span><input name="num" inputmode="numeric" maxlength="3" aria-label="Shirt number"></label>' +
          '<button type="submit" class="btn btn-primary sq-submit">Add player</button></div>' +
          '<fieldset class="sq-pos"><legend>Position</legend>' + POS.map(function (x) { return '<label><input type="radio" name="pos" value="' + x[0] + '"' + (sqPos === x[0] ? ' checked' : '') + '><span>' + x[1] + '<small>' + x[0] + '</small></span></label>'; }).join('') + '<label><input type="radio" name="pos" value=""' + (sqPos === '' ? ' checked' : '') + '><span>&ndash;<small>None</small></span></label></fieldset>' +
          '<p class="sq-hint" data-sq-hint role="status" aria-live="polite">The position puts them in the right place on the pitch.</p></form></div>' : '') +
        '<div id="tm-list"></div></div>' +
      '<aside class="sq-side"><div class="ua-card"><h3>Your line-up</h3><div id="tm-preview"></div></div></aside>';
    var num = $('[name="num"]', el); if (num) num.value = nextNumber(S.players);
    refresh();
  }

  function refresh() {
    var list = S.players, can = S.editable, t = S.team;
    var groups = { gk: [], def: [], mid: [], fwd: [], none: [] };
    list.forEach(function (p) { if (p.active) groups[lineOf(p.position) || 'none'].push(p); });
    var order = ['gk', 'def', 'mid', 'fwd', 'none'], el = $('#tm-list');
    var any = order.some(function (k) { return groups[k].length; });
    el.innerHTML = any ? order.filter(function (k) { return groups[k].length; }).map(function (k) {
      return '<div class="ua-card sq-group"><h4>' + lineName(k) + ' <span>' + groups[k].length + '</span></h4><div class="sq-rows">' + groups[k].sort(function (a, b) { return numOf(a) - numOf(b) || a.name.localeCompare(b.name); }).map(row).join('') + '</div></div>';
    }).join('') : '<div class="ua-card"><p class="ua-hint">' + (can ? 'No players yet. Add your first player above.' : 'No players have been added yet.') + '</p></div>';
    var pv = $('#tm-preview');
    if (pv) pv.innerHTML = window.UnityPitch ? UnityPitch.html(list.filter(function (p) { return p.active; }), { colour: t.colour, canVote: false, title: t.name + ' line-up' }) : '';
    var chips = $('#tm-chips');
    if (chips) { var n = list.filter(function (p) { return p.active; }).length; var first = chips.firstChild; if (first) first.textContent = n + (n === 1 ? ' player' : ' players'); }
  }

  function row(p) {
    var dis = S.editable ? '' : ' disabled';
    var pos = '<option value="">No position</option>' + POS.map(function (x) { return '<option' + (p.position === x[0] ? ' selected' : '') + '>' + x[0] + '</option>'; }).join('') +
      (p.position && !POS.some(function (x) { return x[0] === p.position; }) ? '<option selected>' + esc(p.position) + '</option>' : '');
    return '<div class="sq-row tm-row" data-pid="' + esc(p.id) + '" style="--tc:' + esc(S.team.colour) + '">' +
      '<span class="sq-shirt">' + esc(p.shirt_no || '–') + '</span>' +
      '<input class="sq-in-name" data-sf="name" maxlength="60" value="' + esc(p.name) + '" aria-label="Name"' + dis + '>' +
      '<input class="sq-in-num" data-sf="num" inputmode="numeric" maxlength="3" value="' + esc(p.shirt_no || '') + '" aria-label="Shirt number"' + dis + '>' +
      '<select data-sf="pos" aria-label="Position"' + dis + '>' + pos + '</select>' +
      (S.editable ? '<button type="button" class="sq-del" data-tm-del aria-label="Remove ' + esc(p.name) + '">&times;</button>' : '<span></span>') + '<span class="sq-saved" aria-hidden="true">&#10003;</span></div>';
  }

  function submitCard() {
    var el = $('#tm-submit'); if (!el) return;
    if (!S.editable) { el.innerHTML = ''; return; }
    var done = !!S.submitted_at;
    el.innerHTML = '<div class="ua-card tm-submit"><div><h3>' + (done ? 'Submitted' : 'Finished?') + '</h3><p class="ua-hint">' + (done ? 'The committee can see your line-up. If you change anything, press submit again so they know.' : 'Press submit to tell the committee your line-up is ready. You can still change things afterwards.') + '</p></div>' +
      '<form class="tm-submit-form" data-tm-submit novalidate><label class="ua-field"><span>Your name <span class="ua-opt">(optional)</span></span><input name="by" maxlength="60" autocomplete="name" placeholder="So they know who sent it" value="' + esc(S.submitted_by || '') + '"></label>' +
      '<button type="submit" class="btn btn-primary btn-glow">' + (done ? 'Submit again' : 'Submit line-up') + '</button><p class="sq-hint" data-tm-submit-hint role="status"></p></form></div>';
  }

  // ---------------------------------------------------------------------
  function hint(text, bad) { var h = $('[data-sq-hint]'); if (!h) return; h.textContent = text; h.className = 'sq-hint' + (bad ? ' is-bad' : ' is-ok'); }
  function toast(text, undo) {
    var old = document.getElementById('ua-toast'); if (old) old.remove();
    var el = document.createElement('div'); el.id = 'ua-toast'; el.className = 'ua-toast'; el.setAttribute('role', 'status');
    el.innerHTML = '<span>' + esc(text) + '</span>' + (undo ? '<button type="button">Undo</button>' : '');
    document.body.appendChild(el);
    if (undo) $('button', el).addEventListener('click', function () { el.remove(); undo(); });
    window.clearTimeout(toastTimer); toastTimer = window.setTimeout(function () { el.remove(); }, 6500);
  }
  function errMsg(r) {
    if (r.error && r.error.message && !r.data) return ERR.server;
    var d = r.data || {};
    if (d.error === 'number_taken') return 'Number ' + (d.num || '') + ' is already ' + (d.holder || 'someone') + '\'s. Pick another number.';
    return ERR[d.error] || ERR.server;
  }
  function blockedNow(r) { var e = r.data && r.data.error; return e === 'closed' || e === 'deadline' || e === 'link_off' || e === 'bad_link'; }
  function track(promise) { pending++; return promise.then(function (r) { pending--; return r; }, function (e) { pending--; throw e; }); }
  window.addEventListener('beforeunload', function (e) { if (pending > 0) { e.preventDefault(); e.returnValue = ''; } });

  function add(form) {
    var name = form.elements.name.value.trim(), num = form.elements.num.value.trim().replace(/^#/, ''), pos = (form.querySelector('[name="pos"]:checked') || {}).value || '';
    sqPos = pos;
    if (!name) { hint('Type the player\'s name first.', true); form.elements.name.focus(); return; }
    if (num && !/^\d{1,3}$/.test(num)) { hint(ERR.bad_number, true); form.elements.num.focus(); return; }
    var dup = num && S.players.filter(function (p) { return p.active && String(p.shirt_no) === num; })[0];
    if (dup) { hint('Number ' + num + ' is already ' + dup.name + '\'s. Pick another number.', true); form.elements.num.focus(); form.elements.num.select(); return; }
    var tmp = { id: 'tmp-' + (++tmpN), name: name, shirt_no: num || null, position: pos || null, active: true };
    S.players.push(tmp); refresh();
    form.elements.name.value = ''; form.elements.num.value = nextNumber(S.players); form.elements.name.focus();
    hint('Adding ' + name + '…');
    track(supabaseClient.rpc('unity_team_save_player', { p_token: token, p_id: null, p_name: name, p_shirt: num || null, p_position: pos || null, p_active: true })).then(function (r) {
      if (r.error || !r.data || !r.data.ok) {
        S.players = S.players.filter(function (p) { return p !== tmp; }); refresh(); hint('Couldn\'t add ' + name + ': ' + errMsg(r), true);
        if (blockedNow(r)) load().then(function (ok) { if (ok) render(); });
        return;
      }
      var old = tmp.id; tmp.id = r.data.id; var rowEl = $('[data-pid="' + old + '"]'); if (rowEl) rowEl.setAttribute('data-pid', tmp.id);
      S.last_edit_at = new Date().toISOString(); hint('Added ' + name + '. Next player?'); say(name + ' added.');
    }, function () { S.players = S.players.filter(function (p) { return p !== tmp; }); refresh(); hint('Couldn\'t add ' + name + '. ' + ERR.server, true); });
  }

  function saveRow(rowEl, input) {
    var pid = rowEl.getAttribute('data-pid'), p = S.players.filter(function (x) { return x.id === pid; })[0];
    if (!p || String(pid).indexOf('tmp-') === 0) return;
    var g = function (k) { return $('[data-sf="' + k + '"]', rowEl); };
    var name = g('name').value.trim(), num = g('num').value.trim().replace(/^#/, ''), pos = g('pos').value;
    if (!name) { g('name').value = p.name; return; }
    if (num && !/^\d{1,3}$/.test(num)) { g('num').value = p.shirt_no || ''; toast(ERR.bad_number); return; }
    var dup = num && S.players.filter(function (x) { return x !== p && x.active && String(x.shirt_no) === num; })[0];
    if (dup) { g('num').value = p.shirt_no || ''; toast('Number ' + num + ' is already ' + dup.name + '\'s.'); return; }
    var before = { name: p.name, shirt_no: p.shirt_no, position: p.position };
    p.name = name; p.shirt_no = num || null; p.position = pos || null;
    track(supabaseClient.rpc('unity_team_save_player', { p_token: token, p_id: pid, p_name: name, p_shirt: num || null, p_position: pos || null, p_active: true })).then(function (r) {
      if (r.error || !r.data || !r.data.ok) { Object.assign(p, before); refresh(); toast('Not saved: ' + errMsg(r)); if (blockedNow(r)) load().then(function (ok) { if (ok) render(); }); return; }
      S.last_edit_at = new Date().toISOString();
      rowEl.classList.add('is-saved'); window.setTimeout(function () { rowEl.classList.remove('is-saved'); }, 1400);
      var sh = $('.sq-shirt', rowEl); if (sh) sh.textContent = p.shirt_no || '–';
      if (input && input.getAttribute('data-sf') === 'pos') refresh(); else { var pv = $('#tm-preview'); if (pv) pv.innerHTML = UnityPitch.html(S.players.filter(function (x) { return x.active; }), { colour: S.team.colour, canVote: false, title: S.team.name + ' line-up' }); }
    }, function () { Object.assign(p, before); refresh(); toast('Not saved. ' + ERR.server); });
  }

  function remove(rowEl) {
    var pid = rowEl.getAttribute('data-pid'), p = S.players.filter(function (x) { return x.id === pid; })[0]; if (!p) return;
    var copy = { name: p.name, shirt_no: p.shirt_no, position: p.position };
    track(supabaseClient.rpc('unity_team_delete_player', { p_token: token, p_id: pid })).then(function (r) {
      if (r.error || !r.data || !r.data.ok) { toast('Couldn\'t remove ' + p.name + ': ' + errMsg(r)); return; }
      S.players = S.players.filter(function (x) { return x.id !== pid; }); refresh();
      toast(p.name + ' removed.', function () {
        track(supabaseClient.rpc('unity_team_save_player', { p_token: token, p_id: null, p_name: copy.name, p_shirt: copy.shirt_no, p_position: copy.position, p_active: true })).then(function (r2) {
          if (r2.data && r2.data.ok) { S.players.push({ id: r2.data.id, name: copy.name, shirt_no: copy.shirt_no, position: copy.position, active: true }); refresh(); }
          else toast('Couldn\'t put ' + copy.name + ' back: ' + errMsg(r2));
        });
      });
    });
  }

  function submit(form) {
    var hintEl = $('[data-tm-submit-hint]', form), btn = $('button[type=submit]', form);
    var by = form.elements.by.value.trim();
    btn.disabled = true; hintEl.textContent = 'Sending…'; hintEl.className = 'sq-hint';
    track(supabaseClient.rpc('unity_team_submit', { p_token: token, p_name: by || null })).then(function (r) {
      btn.disabled = false;
      if (r.error || !r.data || !r.data.ok) { hintEl.textContent = errMsg(r); hintEl.className = 'sq-hint is-bad'; return; }
      S.submitted_at = new Date().toISOString(); S.submitted_by = by || null;
      if (window.UnityFx) UnityFx.confetti({ count: 140 });
      say('Line-up submitted. Thank you.');
      var chips = $('#tm-chips'); if (chips && !$('.tm-chip.is-ok', chips)) chips.insertAdjacentHTML('beforeend', '<span class="tm-chip is-ok">Submitted just now</span>');
      banner(); submitCard();
    }, function () { btn.disabled = false; hintEl.textContent = ERR.server; hintEl.className = 'sq-hint is-bad'; });
  }

  // ---------------------------------------------------------------------
  document.addEventListener('submit', function (e) {
    if (e.target.closest('[data-tm-add]')) { e.preventDefault(); add(e.target.closest('[data-tm-add]')); }
    else if (e.target.closest('[data-tm-submit]')) { e.preventDefault(); submit(e.target.closest('[data-tm-submit]')); }
  });
  document.addEventListener('change', function (e) {
    if (e.target.name === 'pos' && e.target.closest('[data-tm-add]')) { sqPos = e.target.value; return; }
    var f = e.target.closest && e.target.closest('[data-sf]'); if (f) saveRow(f.closest('[data-pid]'), f);
  });
  document.addEventListener('click', function (e) { var d = e.target.closest && e.target.closest('[data-tm-del]'); if (d) remove(d.closest('[data-pid]')); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.closest && e.target.closest('.tm-row') && e.target.tagName === 'INPUT') { e.preventDefault(); e.target.blur(); } });
  // coming back to the tab: pick up anything the committee changed (but never while someone is typing)
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || !S || pending) return;
    var a = document.activeElement; if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
    load().then(function (ok) { if (ok) render(); });
  });

  // ---------------------------------------------------------------------
  token = (window.location.hash || '').replace(/^#/, '').trim().toLowerCase();
  if (!token) { var q = new URLSearchParams(window.location.search).get('k'); token = (q || '').trim().toLowerCase(); }
  if (!ready()) { screen('Not available yet', 'This page is getting ready. Please try again soon.'); return; }
  if (!/^[0-9a-f]{36}$/.test(token)) { screen('This link looks incomplete', 'The private link needs to be copied in full, including the long code at the end. Please open the link exactly as it was sent to you, or ask the organisers to send it again.', '<a class="uc-btn uc-btn--ghost" href="mailto:acms@lincolnsu.com">Email the organisers</a>'); return; }
  load(true).then(function (ok) { if (ok) render(); });
})();
