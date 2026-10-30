// Circle manager (Dashboard -> Sankofa Hub): how the president and Executive
// Committee run the Sankofa Hub from the website.
//
//   * A board with one lane per Circle plus an "Unplaced" lane. Drag anyone
//     from one lane to another to move them, at any time (or use the Move
//     menu on a card, which also works on a phone). Every move is logged and
//     can be undone straight away.
//   * "Add people": bring accepted student applicants and professionals into
//     the Hub (their application answers are carried across).
//   * "Suggest matches": scores mentors against mentees on specialty,
//     interests, what they offer / are looking for, communication style and
//     how often they want to meet, then proposes who goes in which Circle and
//     who pairs with which mentor - with the reasons. Apply all of it, or
//     untick anything you disagree with.
//   * Pair a mentee with a mentor, set a Circle lead, edit what the matching
//     uses, pause or remove someone.
//   * Schedule a Circle meeting, an event for everyone, or post an
//     announcement.
//
// Who may do what is enforced in the database (migrations 084 to 087, the
// Hub Access rule "dash_sankofa"); this file is only the interface.
(function () {
  'use strict';

  var S = window.lacmsSankofa;
  if (!S) return;
  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;
  var root = document.getElementById('shm-root');
  if (!root) return;

  var esc = S.esc;
  var rpc = S.rpc;
  var panel = document.getElementById('dash-panel-sankofahub');
  var card = document.querySelector('[data-dash-section="sankofahub"]');

  var data = null;            // sankofa_admin_overview()
  var query = '';
  var roleFilter = 'all';
  var loading = false;
  var lastLoad = 0;
  var COMM_LABEL = { casual: 'Casual chats', structured: 'Structured catch-ups', mix: 'A mix of both' };
  var FREQ_LABEL = { weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly' };
  var MOOD_EMOJI = ['', '😞', '😕', '😐', '🙂', '😄'];
  var DRAG = null;
  var managersTried = false;
  var managers = null;         // president only: who can manage the Circles (null for everyone else)
  var detailRedraw = null;     // redraws an open Circle dialog after the data reloads

  function $(id) { return document.getElementById(id); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function fail(err) { S.toast(err && err.message ? err.message : 'Something went wrong', { type: 'err' }); }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.disabled = true; btn.setAttribute('data-label', btn.textContent); if (label) btn.textContent = label; }
    else { btn.disabled = false; if (btn.getAttribute('data-label')) btn.textContent = btn.getAttribute('data-label'); }
  }

  var ICON = {
    plus: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    dots: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    wand: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 4 1.5 3L20 8.500 16.500 10 15 13l-1.500-3L10 8.500 13.500 7z"/><path d="M4 20 14 10"/></svg>',
    log: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.500 14"/></svg>',
    people: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.870"/><path d="M16 3.130a4 4 0 0 1 0 7.750"/></svg>',
    grip: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>'
  };

  // =======================================================================
  // Loading
  // =======================================================================
  function load(quiet) {
    if (loading) return Promise.resolve();
    loading = true;
    // Guest mentors (migration 106): if it hasn't been run yet, the Hub works exactly as before.
    var guestsCall = rpc('sankofa_admin_guests').then(function (g) { guestsOk = true; return g || []; }, function () { guestsOk = false; return []; });
    // Which Circles are open to their members (migration 109)
    var sharesCall = rpc('sankofa_admin_circle_shares').then(function (ids) { sharesOk = true; return ids || []; }, function () { sharesOk = false; return []; });
    return Promise.all([rpc('sankofa_admin_overview'), guestsCall, sharesCall]).then(function (res) {
      var ov = res[0];
      mergeGuests(ov, res[1]);
      ov.circles.forEach(function (c) { c.shared = res[2].indexOf(c.id) !== -1; });
      data = ov;
      lastLoad = Date.now();
      loading = false;
      var c = $('dash-count-sankofahub');
      if (c) c.textContent = ov.stats.participants ? plural(ov.stats.participants, 'person', 'people') + ' · ' + plural(ov.stats.circles, 'Circle') : 'Not started yet';
      render();
      if (detailRedraw) detailRedraw();
      if (managers === null && !managersTried) { managersTried = true; loadManagers().then(function (m) { if (m) render(); }); }
    }, function (err) {
      loading = false;
      if (!quiet || !data) {
        root.innerHTML = '<p class="auth-error" style="display:block">' + esc(err.message) + '</p>';
        var c = $('dash-count-sankofahub');
        if (c) { c.textContent = 'Couldn\'t load'; c.style.color = 'var(--accent-red)'; }
      }
    });
  }

  // ---- Guest mentors: doctors in a Circle who don't have an account yet ----------------------
  // They are drawn like any other mentor (a dashed seat, a "Guest" tag), but they are name cards:
  // no login, no messages, no one-to-one pairing. Their ids start with "g:".
  var guestsOk = false, sharesOk = false;
  function isGuestId(id) { return String(id).indexOf('g:') === 0; }
  // A mentee can have several mentors (migration 108); older data only has mentor_id.
  function mentorIdsOf(p) { return p.mentor_ids ? p.mentor_ids : (p.mentor_id ? [p.mentor_id] : []); }
  function hasMentor(p, id) { return mentorIdsOf(p).indexOf(id) !== -1; }
  function guestAsPerson(g) {
    return { id: 'g:' + g.id, guest_id: g.id, is_guest: true, name: g.name, role: 'mentor', status: 'active',
      stage: [g.title, g.organisation].filter(Boolean).join(' \u00B7 ') || 'Guest mentor', title: g.title, organisation: g.organisation,
      specialty: g.specialty, email: g.email, note: g.note, gstatus: g.status || 'pending', circle_id: g.circle_id || null, is_lead: false, capacity: null, mentee_ids: [],
      interests: [], offers: [], profile_done: true, joined_at: g.created_at, xp: 0 };
  }
  function mergeGuests(ov, guests) {
    ov.stats.guests = guests.length;
    guests.forEach(function (g) {
      var p = guestAsPerson(g), c = null;
      for (var i = 0; i < ov.circles.length; i++) if (ov.circles[i].id === g.circle_id) c = ov.circles[i];
      if (c) c.members.push(p); else { p.circle_id = null; ov.unplaced.push(p); }
    });
  }
  function moveRpc(id, circleId, note) {
    if (isGuestId(id)) return rpc('sankofa_admin_guest_move', { p_id: id.slice(2), p_circle: circleId || null });
    return rpc('sankofa_admin_move', { p_user: id, p_circle: circleId || null, p_note: note || null });
  }

  function allPeople() {
    var out = data.unplaced.slice();
    data.circles.forEach(function (c) { out = out.concat(c.members); });
    return out;
  }
  function personById(id) {
    var all = allPeople();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  function circleById(id) {
    for (var i = 0; i < data.circles.length; i++) if (data.circles[i].id === id) return data.circles[i];
    return null;
  }
  function activeCircles() { return data.circles.filter(function (c) { return c.status === 'active'; }); }

  // =======================================================================
  // Rendering
  // =======================================================================
  function matches(p) {
    if (roleFilter !== 'all' && p.role !== roleFilter) return false;
    if (!query) return true;
    return [p.name, p.stage, p.specialty, (p.interests || []).join(' '), (p.offers || []).join(' '), p.email].join(' ').toLowerCase().indexOf(query) !== -1;
  }

  var selected = {};          // people ticked in the Unplaced pool

  function selectedIds() { return Object.keys(selected).filter(function (id) { return personById(id); }); }

  function render() {
    var st = data.stats;
    var sel = selectedIds().length;
    var html =
      '<div class="shm-statline" role="list">' +
        stat(st.participants, 'in the Hub') + stat(st.mentors, 'mentors') + (st.guests ? stat(st.guests, 'guest mentors') : '') + stat(st.mentees, 'mentees') +
        stat(st.placed, 'in Circles') + stat(data.unplaced.length, 'unplaced', data.unplaced.length ? 'warn' : '') +
        stat(st.pairings, 'pairings') + stat(st.upcoming, 'meetings soon') + (st.need_help ? stat(st.need_help, 'want a check-in', 'bad') : '') +
      '</div>' +
      '<div class="shm-toolbar">' +
        '<button type="button" class="btn btn-primary" data-shm-add>' + ICON.plus + ' Add people</button>' +
        '<button type="button" class="btn btn-outline" data-shm-addguest>' + ICON.plus + ' Add mentor by name</button>' +
        '<button type="button" class="btn btn-outline" data-shm-newcircle>' + ICON.plus + ' New Circle</button>' +
        '<button type="button" class="btn btn-outline" data-shm-suggest>' + ICON.wand + ' Suggest matches</button>' +
        '<span class="shm-spacer"></span>' +
        '<button type="button" class="btn btn-outline" data-shm-event>Announce</button>' +
        (managers ? '<button type="button" class="btn btn-outline" data-shm-managers>' + ICON.people + ' Who can manage</button>' : '') +
        '<button type="button" class="btn btn-outline" data-shm-history>' + ICON.log + ' Activity</button>' +
      '</div>';

    if (!st.participants && !data.circles.length) {
      html += '<div class="shm-empty"><h3>Let\'s get the Sankofa Circles started</h3><ol><li><strong>Create your Circles</strong> - e.g. "Adowa", "Nkyinkyim" - with a colour and a motto.</li><li><strong>Add people</strong> - bring in accepted applicants and your professionals.</li><li><strong>Suggest matches</strong> to fill the Circles, or tick people and place them yourself.</li></ol>' +
        '<p><button type="button" class="btn btn-primary" data-shm-newcircle>' + ICON.plus + ' Create the first Circle</button></p></div>';
    } else {
      html += '<div class="shm-work">' + poolPanel(sel) + '<div class="shm-circles" id="shm-circles">' +
        (activeCircles().length ? activeCircles().map(circleCard).join('') : '<p class="shm-lane-empty">No Circles yet - create one to start placing people.</p>') + '</div></div>';
      var archived = data.circles.filter(function (c) { return c.status !== 'active'; });
      if (archived.length) {
        html += '<details class="shm-archived"><summary>Archived Circles (' + archived.length + ')</summary><div class="shm-circles">' + archived.map(circleCard).join('') + '</div></details>';
      }
      html += '<p class="sh-fineprint">Tick people in the Unplaced list (or drag them) and place them in a Circle - drag a seat to another Circle to move someone. A <strong>gold ring</strong> marks a mentor. Open a Circle to pair mentors and mentees; a Circle can have as many of each as you like. A <strong>dashed ring</strong> is a guest mentor you added by name who hasn\'t signed up yet. Restricted profiles show by name to you, but anonymously to everyone else.</p>';
    }
    var oldPool = root.querySelector('.shm-pool-list');
    var poolTop = oldPool ? oldPool.scrollTop : 0;
    root.innerHTML = html;
    var newPool = root.querySelector('.shm-pool-list');
    if (newPool && poolTop) newPool.scrollTop = poolTop;
  }

  function stat(n, label, tone) {
    return '<span class="shm-stat' + (tone ? ' is-' + tone : '') + '" role="listitem"><strong>' + n + '</strong> ' + esc(label) + '</span>';
  }

  // ---- The pool of people who still need a Circle ----
  function poolPanel(sel) {
    var list = data.unplaced.filter(matches);
    var shown = list.length;
    return '<aside class="shm-pool" data-lane="" aria-label="Unplaced people">' +
      '<header class="shm-pool-head"><div><h3>Unplaced</h3><p>' + (data.unplaced.length ? plural(data.unplaced.length, 'person', 'people') + ' waiting' : 'Everyone has a Circle 🎉') + '</p></div>' +
        (shown ? '<button type="button" class="link-button" data-shm-selall>' + (sel >= shown && shown ? 'Clear' : 'Select all') + '</button>' : '') + '</header>' +
      '<div class="shm-pool-tools"><input type="search" id="shm-q" placeholder="Search everyone…" aria-label="Search people" value="' + esc(query) + '">' +
        '<div class="sh-seg ui-seg" role="group" aria-label="Show">' + [['all', 'All'], ['mentee', 'Mentees'], ['mentor', 'Mentors']].map(function (r) {
          return '<button type="button" data-shm-role="' + r[0] + '" class="' + (roleFilter === r[0] ? 'is-active' : '') + '">' + r[1] + '</button>';
        }).join('') + '</div></div>' +
      '<div class="shm-pool-list">' + (list.length ? list.map(poolRow).join('') : '<p class="shm-lane-empty">' + (data.unplaced.length ? 'No one matches that.' : 'Drop someone here to take them out of their Circle.') + '</p>') + '</div>' +
      (sel ? '<div class="shm-pool-bar"><strong>' + sel + ' selected</strong><button type="button" class="btn btn-primary btn-sm" data-shm-placesel>Place in a Circle…</button></div>' : '') +
    '</aside>';
  }

  function poolRow(p) {
    var on = !!selected[p.id];
    var d = inactiveDays(p);
    var note = p.is_guest ? 'not on LACMS yet' : p.awaiting_approval ? 'awaiting approval' : p.status !== 'active' ? p.status : (!p.profile_done ? 'no profile yet' : '');
    return '<div class="shm-prow' + (on ? ' is-on' : '') + '" draggable="true" data-pcard="' + esc(p.id) + '">' +
      '<label class="shm-check"><input type="checkbox" data-shm-tick="' + esc(p.id) + '"' + (on ? ' checked' : '') + ' aria-label="Select ' + esc(p.name) + '"></label>' +
      '<span class="shm-prow-av' + (p.role === 'mentor' ? ' is-mentor' : '') + (p.is_guest ? ' is-guest' : '') + '">' + S.avatar(p, 'sm') + '</span>' +
      '<span class="shm-prow-main"><strong>' + esc(p.name) + '</strong><small><b class="shm-role-tag' + (p.role === 'mentor' ? ' is-mentor' : '') + '">' + (p.is_guest ? 'Guest mentor' + (p.gstatus === 'pending' ? ' (pending)' : '') : p.role === 'mentor' ? 'Mentor' : 'Mentee') + '</b>' + (p.stage ? ' · ' + esc(p.stage) : '') + (note ? ' · ' + esc(note) : '') + '</small></span>' +
      '<button type="button" class="shm-place" data-shm-place="' + esc(p.id) + '" aria-label="Place ' + esc(p.name) + ' in a Circle">Place</button>' +
      '<button type="button" class="sh-icon-btn" data-shm-person-menu="' + esc(p.id) + '" aria-label="Options for ' + esc(p.name) + '">' + ICON.dots + '</button></div>';
  }

  // ---- A Circle: a ring of seats ----
  function ringSeats(c) {
    var members = c.members.slice().sort(function (a, b) {
      return (b.role === 'mentor') - (a.role === 'mentor') || (b.is_lead ? 1 : 0) - (a.is_lead ? 1 : 0) || a.name.localeCompare(b.name);
    });
    var total = Math.max(c.capacity, members.length, 1);
    var R = 37;
    var dia = Math.max(9, Math.min(22, (2 * Math.PI * R / total) * 0.86));
    var out = '';
    for (var i = 0; i < total; i++) {
      var ang = (i / total) * 2 * Math.PI - Math.PI / 2;
      var pos = 'left:' + (50 + R * Math.cos(ang)).toFixed(2) + '%;top:' + (50 + R * Math.sin(ang)).toFixed(2) + '%;--d:' + dia.toFixed(1) + ';';
      var m = members[i];
      if (!m) { out += '<span class="shm-seat shm-seat--empty" style="' + pos + '" aria-hidden="true"></span>'; continue; }
      out += '<button type="button" class="shm-seat' + (m.role === 'mentor' ? ' is-mentor' : '') + (m.is_guest ? ' is-guest' : '') + (m.is_lead ? ' is-lead' : '') + (matches(m) ? '' : ' is-dim') + (query && matches(m) ? ' is-hit' : '') +
        '" style="' + pos + '" draggable="true" data-pcard="' + esc(m.id) + '" title="' + esc(m.name + ' · ' + (m.is_guest ? 'Guest mentor' + (m.gstatus === 'pending' ? ' (pending)' : '') : m.role === 'mentor' ? 'Mentor' : 'Mentee') + (m.is_lead ? ' · Lead' : '')) + '" aria-label="' + esc(m.name) + ', ' + (m.role === 'mentor' ? 'mentor' : 'mentee') + '">' + S.avatar(m, 'seat') + '</button>';
    }
    return out;
  }

  function circleCard(c) {
    var mentors = c.members.filter(function (m) { return m.role === 'mentor'; });
    var mentees = c.members.length - mentors.length;
    var over = c.members.length > c.capacity;
    var full = c.members.length >= c.capacity;
    var sel = selectedIds().length;
    var names = c.members.slice().sort(function (a, b) { return (b.role === 'mentor') - (a.role === 'mentor') || a.name.localeCompare(b.name); }).map(function (m) { return S.firstName ? S.firstName(m.name) : m.name.split(' ')[0]; });
    var warn = '';
    if (c.status === 'active') {
      if (c.members.length && !mentors.length) warn = '<p class="shm-warn">No mentor yet</p>';
      // Every mentor in a Circle mentors the whole Circle, so a mentee without a one-to-one pairing is fine.
    }
    return '<section class="shm-circle sh-theme-' + esc(c.theme) + (c.status !== 'active' ? ' is-archived' : '') + '" data-lane="' + esc(c.id) + '" aria-label="' + esc(c.name) + '">' +
      '<header class="shm-circle-head"><span class="shm-swatch" aria-hidden="true"></span><h3>' + esc(c.name) + '</h3>' + (c.shared ? '<span class="shm-open-tag" title="Its members can see this Circle and who is in it">Open to members</span>' : '') +
        '<button type="button" class="sh-icon-btn" data-shm-circle-menu="' + esc(c.id) + '" aria-label="Options for ' + esc(c.name) + '">' + ICON.dots + '</button></header>' +
      '<div class="shm-ring">' + ringSeats(c) + '<button type="button" class="shm-ring-mid" data-shm-open="' + esc(c.id) + '" aria-label="Open ' + esc(c.name) + '"><b class="' + (over ? 'shm-over' : full ? 'shm-full' : '') + '">' + c.members.length + '</b><small>of ' + c.capacity + '</small></button></div>' +
      '<p class="shm-circle-meta">' + plural(mentors.length, 'mentor') + ' · ' + plural(mentees, 'mentee') + (c.next_meeting ? ' · next ' + esc(S.fmtDay(c.next_meeting)) : '') + '</p>' +
      (names.length ? '<p class="shm-circle-names">' + esc(names.join(', ')) + '</p>' : '<p class="shm-circle-names is-empty">Empty - drag people here</p>') + warn +
      '<footer class="shm-circle-foot">' + (sel && c.status === 'active' ? '<button type="button" class="btn btn-primary btn-sm" data-shm-addsel="' + esc(c.id) + '">Add ' + sel + ' here</button>' : '') +
        '<button type="button" class="btn btn-outline btn-sm" data-shm-open="' + esc(c.id) + '">Open Circle</button></footer></section>';
  }

  function inactiveDays(p) {
    if (!p.last_active) return Math.floor((Date.now() - new Date(p.joined_at).getTime()) / 86400000);
    return Math.floor((Date.now() - new Date(p.last_active).getTime()) / 86400000);
  }

  // =======================================================================
  // Moving
  // =======================================================================
  function doMove(userId, circleId, note) {
    var p = personById(userId);
    var from = p ? p.circle_id : null;
    if (from === (circleId || null)) return Promise.resolve();
    var to = circleId ? circleById(circleId) : null;
    if (to && to.status === 'active' && to.members.length >= to.capacity) {
      // Allowed, but the committee should know it is over.
      S.toast(to.name + ' is now over its ' + to.capacity + ' places', {});
    }
    return moveRpc(userId, circleId, note).then(function () {
      var name = p ? p.name : 'Person';
      return load(true).then(function () {
        S.toast(name + ' moved to ' + (to ? to.name : 'Unplaced'), {
          action: { label: 'Undo', fn: function () { moveRpc(userId, from, 'Undo').then(function () { return load(true); }, fail); } }
        });
      });
    }, fail);
  }

  // Move one or many people. One person gets the usual Undo; several go through the plan call.
  function bulkMove(ids, circleId) {
    ids = ids.filter(function (id) { return personById(id); });
    if (!ids.length) return Promise.resolve();
    if (ids.length === 1) { selected = {}; return doMove(ids[0], circleId); }
    var to = circleId ? circleById(circleId) : null;
    var before = ids.map(function (id) { return { id: id, circle: personById(id).circle_id || null }; });
    var changed = before.filter(function (b) { return b.circle !== (circleId || null); });
    if (!changed.length) return Promise.resolve();
    var realMoves = changed.filter(function (b) { return !isGuestId(b.id); });
    var guestMoves = changed.filter(function (b) { return isGuestId(b.id); });
    var calls = guestMoves.map(function (b) { return moveRpc(b.id, circleId); });
    if (realMoves.length) calls.push(rpc('sankofa_admin_apply_plan', { p_plan: { moves: realMoves.map(function (b) { return { user: b.id, circle: circleId || '' }; }), pairings: [] } }));
    return Promise.all(calls).then(function () {
      selected = {};
      return load(true).then(function () {
        var over = to && to.members.length + changed.length > to.capacity;
        S.toast(plural(changed.length, 'person', 'people') + ' moved to ' + (to ? to.name : 'Unplaced') + (over ? ' - now over its ' + to.capacity + ' places' : ''), {
          action: { label: 'Undo', fn: function () {
            var chain = Promise.resolve();
            changed.forEach(function (b) { chain = chain.then(function () { return moveRpc(b.id, b.circle, 'Undo'); }); });
            chain.then(function () { return load(true); }, fail);
          } }
        });
      });
    }, fail);
  }

  // "Place in..." - a big, tappable list of Circles (works the same on a phone)
  function openPlace(ids) {
    ids = ids.filter(function (id) { return personById(id); });
    if (!ids.length) return;
    var who = ids.length === 1 ? personById(ids[0]).name : plural(ids.length, 'person', 'people');
    var anyPlaced = ids.some(function (id) { return personById(id).circle_id; });
    var circles = activeCircles();
    var dlg = S.openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Place in a Circle</span><h2 class="guide-title">' + esc(who) + '</h2>' +
      (circles.length ? '<div class="shm-place-list">' + circles.map(function (c) {
        var after = c.members.length + ids.filter(function (id) { return personById(id).circle_id !== c.id; }).length;
        var mentors = c.members.filter(function (m) { return m.role === 'mentor'; }).length;
        return '<button type="button" class="shm-place-opt sh-theme-' + esc(c.theme) + '" data-to="' + esc(c.id) + '"><span class="shm-swatch" aria-hidden="true"></span>' +
          '<span class="shm-place-main"><strong>' + esc(c.name) + '</strong><small>' + c.members.length + '/' + c.capacity + ' · ' + plural(mentors, 'mentor') + '</small></span>' +
          (after > c.capacity ? '<span class="sh-chip sh-chip--bad">Over</span>' : after === c.capacity ? '<span class="sh-chip">Fills it</span>' : '') + '</button>';
      }).join('') + '</div>' : '<p class="sh-muted">Create a Circle first.</p>') +
      (anyPlaced ? '<p class="shm-place-un"><button type="button" class="link-button" data-to="">Take out of their Circle (Unplaced)</button></p>' : ''));
    dlg.el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-to]');
      if (!b) return;
      var to = b.getAttribute('data-to') || null;
      dlg.close();
      bulkMove(ids, to);
    });
  }

  // A Circle opened up: who is in it, and who mentors whom
  function openCircleDetail(id) {
    var dlg = S.openDialog('', 'shm-dlg-wide');
    var dragId = null;
    dlg.onClose = function () { detailRedraw = null; };
    function draw() {
      var c = circleById(id);
      if (!c) { dlg.close(); return; }
      var mentors = c.members.filter(function (m) { return m.role === 'mentor'; });
      var mentees = c.members.filter(function (m) { return m.role === 'mentee'; });
      var mentorIds = {};
      mentors.forEach(function (m) { mentorIds[m.id] = true; });
      var unpaired = mentees.filter(function (m) { return !mentorIdsOf(m).some(function (id) { return mentorIds[id]; }); });
      var realMentors = mentors.filter(function (m) { return !m.is_guest; });
      function chip(m, removeFrom) {
        var nm = mentorIdsOf(m).length;
        var out = '<span class="shm-pchip" draggable="true" data-dpcard="' + esc(m.id) + '">' + S.avatar(m, 'sm') + '<button type="button" class="shm-pchip-name" data-shm-person-menu="' + esc(m.id) + '">' + esc(m.name) + '</button>' +
          (nm > 1 ? '<span class="shm-multi" title="Has ' + nm + ' mentors">' + nm + '</span>' : '') +
          (removeFrom ? '<button type="button" class="shm-x" data-unpair="' + esc(m.id) + '" data-unpair-mentor="' + esc(removeFrom) + '" aria-label="Remove ' + esc(m.name) + ' from this mentor" title="Remove from this mentor">&times;</button>' : '') + '</span>';
        return out;
      }
      var html = '<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button>' +
        '<div class="shm-detail-head sh-theme-' + esc(c.theme) + '"><span class="shm-swatch" aria-hidden="true"></span><div><span class="guide-eyebrow">Sankofa Circle</span><h2 class="guide-title" style="margin:0">' + esc(c.name) + '</h2>' +
        '<p class="sh-muted" style="margin:2px 0 0">' + (c.shared ? 'Open to its members &middot; ' : '') + c.members.length + '/' + c.capacity + ' places · ' + plural(mentors.length, 'mentor') + ' · ' + plural(mentees.length, 'mentee') + (c.motto ? ' · “' + esc(c.motto) + '”' : '') + '</p></div></div>' +
        '<div class="shm-detail-actions"><button type="button" class="btn btn-outline btn-sm" data-d-auto' + (unpaired.length && realMentors.length ? '' : ' disabled') + '>' + ICON.wand + ' Suggest pairings</button>' +
        '<button type="button" class="btn btn-outline btn-sm" data-d-addguest>' + ICON.plus + ' Add mentor by name</button>' +
        '<button type="button" class="btn btn-outline btn-sm' + (c.shared ? ' is-on' : '') + '" data-d-share>' + (c.shared ? 'Open to members &#10003; (close)' : 'Open to members') + '</button>' +
        '<button type="button" class="btn btn-outline btn-sm" data-d-menu>Meeting, announcement &amp; settings</button></div>';
      html += '<h3 class="sh-dlg-h">Mentors <span class="sh-muted">every mentor here supports the whole Circle. Pairing is optional: drag a mentee onto a mentor for a one-to-one (a mentee can have several).</span></h3>';
      if (!mentors.length) html += '<p class="sh-muted">No mentor in this Circle yet. Place a mentor here from the Unplaced list.</p>';
      html += '<div class="shm-mgroups">' + mentors.map(function (m) {
        if (m.is_guest) {
          return '<div class="shm-mgroup is-guest"><div class="shm-mgroup-head">' + S.avatar(m, 'sm') + '<button type="button" class="shm-pchip-name" data-shm-person-menu="' + esc(m.id) + '"><strong>' + esc(m.name) + '</strong></button>' +
            '<span class="shm-guest-tag">Guest mentor' + (m.gstatus === 'pending' ? ' &middot; pending' : '') + '</span></div><div class="shm-mgroup-body"><span class="shm-lane-empty">' + esc(m.stage) + ' &middot; not on LACMS yet, so mentees can\'t be paired to them one-to-one until they sign up.</span></div></div>';
        }
        var mine = mentees.filter(function (x) { return hasMentor(x, m.id); });
        var cap = m.capacity;
        return '<div class="shm-mgroup" data-mentor-drop="' + esc(m.id) + '"><div class="shm-mgroup-head">' + S.avatar(m, 'sm') + '<button type="button" class="shm-pchip-name" data-shm-person-menu="' + esc(m.id) + '"><strong>' + esc(m.name) + '</strong></button>' +
          '<span class="' + (cap != null && mine.length > cap ? 'shm-over' : '') + ' shm-mgroup-n">' + mine.length + (cap != null ? '/' + cap : '') + '</span></div>' +
          '<div class="shm-mgroup-body">' + (mine.length ? mine.map(function (x) { return chip(x, m.id); }).join('') : '<span class="shm-lane-empty">No mentees yet</span>') + '</div></div>';
      }).join('') + '</div>';
      if (unpaired.length) {
        html += '<h3 class="sh-dlg-h">Not paired one-to-one (' + unpaired.length + ') <span class="sh-muted">' + (mentors.length ? 'still mentored by the whole Circle; pair only if you want a 1:1' : 'add a mentor to the Circle') + '</span></h3><ul class="shm-unpaired">' + unpaired.map(function (m) {
          var otherId = mentorIdsOf(m).filter(function (id) { return !mentorIds[id]; })[0];
          var other = otherId ? personById(otherId) : null;
          return '<li draggable="true" data-dpcard="' + esc(m.id) + '">' + S.avatar(m, 'sm') + '<span class="shm-prow-main"><button type="button" class="shm-pchip-name" data-shm-person-menu="' + esc(m.id) + '"><strong>' + esc(m.name) + '</strong></button><small>' + esc(m.stage || '') + (other ? ' · paired with ' + esc(other.name) + ' (other Circle)' : '') + '</small></span>' +
            (realMentors.length ? '<select data-pair-for="' + esc(m.id) + '" aria-label="Choose a mentor for ' + esc(m.name) + '"><option value="">Choose a mentor…</option>' + realMentors.map(function (mt) {
              var n = mentees.filter(function (x) { return hasMentor(x, mt.id); }).length;
              return '<option value="' + esc(mt.id) + '">' + esc(mt.name) + ' (' + n + (mt.capacity != null ? '/' + mt.capacity : '') + ')</option>';
            }).join('') + '</select>' : '') + '</li>';
        }).join('') + '</ul>';
      } else if (mentees.length) {
        html += '<p class="shm-allpaired">Every mentee has a one-to-one mentor 🎉</p>';
      }
      dlg.el.innerHTML = html;
    }
    draw();
    detailRedraw = function () { if (!dlg.closed) draw(); };
    function after(msg) { return load(true).then(function () { if (msg) S.toast(msg); draw(); }); }
    function pair(menteeId, mentorId) {
      return rpc('sankofa_admin_pair', { p_mentee: menteeId, p_mentor: mentorId, p_note: null }).then(function () { return after('Paired'); }, fail);
    }
    dlg.el.addEventListener('change', function (e) {
      var s = e.target.closest('[data-pair-for]');
      if (s && s.value) pair(s.getAttribute('data-pair-for'), s.value);
    });
    dlg.el.addEventListener('click', function (e) {
      var u = e.target.closest('[data-unpair]');
      if (u) { rpc('sankofa_admin_unpair', { p_mentee: u.getAttribute('data-unpair'), p_mentor: u.getAttribute('data-unpair-mentor') || null }).then(function () { return after('Removed from that mentor'); }, fail); return; }
      var pm = e.target.closest('[data-shm-person-menu]');
      if (pm) { openPersonMenu(pm.getAttribute('data-shm-person-menu')); return; }
      if (e.target.closest('[data-d-menu]')) { openCircleMenu(id); return; }
      if (e.target.closest('[data-d-addguest]')) { openGuestForm(null, id); return; }
      if (e.target.closest('[data-d-share]')) {
        if (!sharesOk) { S.toast('Opening Circles to members needs migration 109 to be run in Supabase (see README-members-setup.md, section 166).', { type: 'err' }); return; }
        var cur = circleById(id), on = !cur.shared;
        rpc('sankofa_admin_circle_set_shared', { p_circle: id, p_shared: on }).then(function () {
          return after(on ? cur.name + ' is open: its members can see who is in it, by name, even before the Hub is open to them' : cur.name + ' is closed to members again');
        }, fail);
        return;
      }
      if (e.target.closest('[data-d-auto]')) {
        var plan = pairingsForCircle(circleById(id));
        if (!plan.length) { S.toast('No pairings to suggest - check mentor capacity'); return; }
        rpc('sankofa_admin_apply_plan', { p_plan: { moves: [], pairings: plan.map(function (x) { return { mentee: x.mentee.id, mentor: x.mentor.id }; }) } }).then(function () {
          return after(plural(plan.length, 'pairing') + ' made - ' + plan.slice(0, 2).map(function (x) { return x.mentee.name.split(' ')[0] + ' → ' + x.mentor.name.split(' ')[0]; }).join(', ') + (plan.length > 2 ? '…' : ''));
        }, fail);
      }
    });
    dlg.el.addEventListener('dragstart', function (e) {
      var d = e.target.closest && e.target.closest('[data-dpcard]');
      if (!d) return;
      dragId = d.getAttribute('data-dpcard');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); } catch (er) { /* fine */ }
    });
    dlg.el.addEventListener('dragover', function (e) {
      var g = e.target.closest && e.target.closest('[data-mentor-drop]');
      if (!g || !dragId) return;
      e.preventDefault();
      g.classList.add('is-over');
    });
    dlg.el.addEventListener('dragleave', function (e) {
      var g = e.target.closest && e.target.closest('[data-mentor-drop]');
      if (g && !g.contains(e.relatedTarget)) g.classList.remove('is-over');
    });
    dlg.el.addEventListener('drop', function (e) {
      var g = e.target.closest && e.target.closest('[data-mentor-drop]');
      if (!g || !dragId) return;
      e.preventDefault();
      var mid = dragId; dragId = null;
      var p = personById(mid);
      if (p && !p.is_guest && p.role === 'mentee' && !hasMentor(p, g.getAttribute('data-mentor-drop'))) pair(mid, g.getAttribute('data-mentor-drop'));
      else draw();
    });
  }

  // Best mentor in the Circle for each mentee who doesn't have one
  function pairingsForCircle(c) {
    var mentors = c.members.filter(function (m) { return m.role === 'mentor' && m.status === 'active' && !m.is_guest; });
    var mentorIds = {};
    mentors.forEach(function (m) { mentorIds[m.id] = true; });
    var mentees = c.members.filter(function (m) { return m.role === 'mentee' && !mentorIdsOf(m).some(function (id) { return mentorIds[id]; }); });
    var load = {};
    mentors.forEach(function (m) { load[m.id] = c.members.filter(function (x) { return hasMentor(x, m.id); }).length; });
    var cands = [];
    mentees.forEach(function (me) { mentors.forEach(function (mt) { cands.push({ mentee: me, mentor: mt, a: affinity(me, mt) }); }); });
    cands.sort(function (x, y) { return y.a.score - x.a.score || (load[x.mentor.id] || 0) - (load[y.mentor.id] || 0); });
    var done = {}, out = [];
    cands.forEach(function (cd) {
      if (done[cd.mentee.id]) return;
      var cap = cd.mentor.capacity == null ? 6 : cd.mentor.capacity;
      if ((load[cd.mentor.id] || 0) >= cap) return;
      done[cd.mentee.id] = true;
      load[cd.mentor.id] = (load[cd.mentor.id] || 0) + 1;
      out.push(cd);
    });
    return out;
  }

  // =======================================================================
  // Dialogs
  // =======================================================================
  function circleOptions(selected, includeNone) {
    return (includeNone ? '<option value=""' + (!selected ? ' selected' : '') + '>Unplaced</option>' : '') + activeCircles().map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (selected === c.id ? ' selected' : '') + '>' + esc(c.name) + ' (' + c.members.length + '/' + c.capacity + ')</option>';
    }).join('');
  }

  function openPersonMenu(id) {
    var p = personById(id);
    if (!p) return;
    if (p.is_guest) { openGuestMenu(p); return; }
    var c = p.circle_id ? circleById(p.circle_id) : null;
    var mentors = allPeople().filter(function (x) { return x.role === 'mentor' && x.status === 'active' && !x.is_guest; });
    var detail = [];
    if (p.email) detail.push(['Email', '<a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a>']);
    if (p.specialty) detail.push([p.role === 'mentor' ? 'Specialty' : 'Interested in', esc(p.specialty)]);
    if (p.interests && p.interests.length) detail.push(['Interests', esc(p.interests.join(', '))]);
    if (p.offers && p.offers.length) detail.push(['Offers', esc(p.offers.join(', '))]);
    if (p.looking_for) detail.push(['Looking for', esc(p.looking_for)]);
    if (p.aspirations) detail.push(['Aspirations', esc(p.aspirations)]);
    if (p.comm_style || p.meeting_freq) detail.push(['Prefers', esc([COMM_LABEL[p.comm_style] || p.comm_style, FREQ_LABEL[p.meeting_freq] || p.meeting_freq].filter(Boolean).join(' · '))]);
    detail.push(['XP', p.xp + (p.last_active ? ' · active ' + S.timeAgo(p.last_active) : ' · no activity yet')]);
    if (p.checkin) detail.push(['Latest check-in', MOOD_EMOJI[p.checkin.mood] + (p.checkin.need_help ? ' wants a check-in' : '') + ' · week of ' + S.fmtDay(p.checkin.week)]);
    var dlg = S.openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button>' +
      '<div class="shm-dlg-head">' + S.avatar(p, 'lg') + '<div><span class="guide-eyebrow">' + (p.role === 'mentor' ? 'Mentor' : 'Mentee') + (p.sixth_form ? ' · Restricted' : '') + '</span><h2 class="guide-title" style="margin:0">' + esc(p.name) + '</h2><p class="sh-muted" style="margin:2px 0 0">' + esc(p.stage || '') + '</p></div></div>' +
      '<dl class="shm-detail">' + detail.map(function (d) { return '<div><dt>' + d[0] + '</dt><dd>' + d[1] + '</dd></div>'; }).join('') + '</dl>' +
      '<div class="guide-form">' +
        '<div class="field"><label for="shm-move">Circle</label><select id="shm-move">' + circleOptions(p.circle_id, true) + '</select></div>' +
        (c ? '<label class="sh-check"><input type="checkbox" id="shm-lead"' + (p.is_lead ? ' checked' : '') + '> <span>Circle lead (shown first, helps run the Circle)</span></label>' : '') +
        (p.role === 'mentee' ? '<fieldset class="field shm-mentors"><legend>One-to-one mentors <span class="guide-optional">(optional, up to 5. Everyone in the Circle is already mentored by all of its mentors.)</span></legend>' + (mentors.length ? mentors.map(function (m) {
          var load = (m.mentee_ids || []).length;
          return '<label class="sh-check"><input type="checkbox" data-mentor-pick value="' + esc(m.id) + '"' + (hasMentor(p, m.id) ? ' checked' : '') + '> <span>' + esc(m.name) + ' <small>(' + load + (m.capacity != null ? '/' + m.capacity : '') + ' mentees)' + (m.circle_id === p.circle_id && p.circle_id ? ' &middot; same Circle' : '') + '</small></span></label>';
        }).join('') : '<p class="sh-muted">No mentors in the Hub yet.</p>') + '</fieldset>' : '') +
        '<div class="field"><label for="shm-status">Status</label><select id="shm-status"><option value="active"' + (p.status === 'active' ? ' selected' : '') + '>Active</option><option value="paused"' + (p.status === 'paused' ? ' selected' : '') + '>Paused (locked out for now)</option><option value="alumni"' + (p.status === 'alumni' ? ' selected' : '') + '>Alumni (finished)</option></select></div>' +
        '<p class="guide-error" hidden></p>' +
        '<div class="guide-actions"><button type="button" class="btn btn-primary" data-save>Save changes</button><button type="button" class="btn btn-outline" data-edit>Edit matching profile</button><button type="button" class="btn btn-outline" data-msg>Message</button></div>' +
        '<div class="guide-actions" style="margin-top:12px"><button type="button" class="btn btn-outline sh-btn-danger" data-remove>Remove from the Hub</button></div>' +
      '</div>');
    var err = dlg.el.querySelector('.guide-error');
    dlg.el.querySelector('[data-msg]').addEventListener('click', function () { S.message({ id: p.id, name: p.name, detail: p.stage }); });
    dlg.el.querySelector('[data-edit]').addEventListener('click', function () { dlg.close(); openProfileEdit(p); });
    dlg.el.querySelector('[data-remove]').addEventListener('click', function () {
      dlg.close();
      S.confirmDialog('Remove ' + p.name + ' from the Hub?', 'They lose access to the Hub and leave their Circle and mentor pairing. Their goals, XP and badges are kept in case you add them back.', 'Remove', true).then(function (yes) {
        if (!yes) return;
        rpc('sankofa_admin_remove_participant', { p_user: p.id }).then(function () { S.toast(p.name + ' removed'); return load(true); }, fail);
      });
    });
    dlg.el.querySelector('[data-save]').addEventListener('click', function (e) {
      var btn = e.currentTarget;
      busy(btn, true, 'Saving…');
      var steps = [];
      var newCircle = $('shm-move').value || null;
      if (newCircle !== (p.circle_id || null)) steps.push(function () { return rpc('sankofa_admin_move', { p_user: p.id, p_circle: newCircle, p_note: null }); });
      var leadEl = $('shm-lead');
      if (leadEl && newCircle === (p.circle_id || null) && leadEl.checked !== p.is_lead) steps.push(function () { return rpc('sankofa_admin_set_lead', { p_user: p.id, p_lead: leadEl.checked }); });
      if (p.role === 'mentee') {
        var picks = Array.prototype.slice.call(dlg.el.querySelectorAll('[data-mentor-pick]'));
        var now = picks.filter(function (x) { return x.checked; }).map(function (x) { return x.value; });
        var was = mentorIdsOf(p);
        if (now.length > 5) { busy(btn, false); err.textContent = 'A mentee can have up to 5 mentors.'; err.hidden = false; return; }
        was.filter(function (id) { return now.indexOf(id) === -1; }).forEach(function (id) { steps.push(function () { return rpc('sankofa_admin_unpair', { p_mentee: p.id, p_mentor: id }); }); });
        now.filter(function (id) { return was.indexOf(id) === -1; }).forEach(function (id) { steps.push(function () { return rpc('sankofa_admin_pair', { p_mentee: p.id, p_mentor: id, p_note: null }); }); });
      }
      if ($('shm-status').value !== p.status) steps.push(function () { return rpc('sankofa_admin_set_status', { p_user: p.id, p_status: $('shm-status').value }); });
      var chain = Promise.resolve();
      steps.forEach(function (s) { chain = chain.then(s); });
      chain.then(function () { dlg.close(); S.toast('Saved'); return load(true); }, function (er) { busy(btn, false); err.textContent = er.message; err.hidden = false; });
    });
  }

  // ---- Guest mentors: add, edit, place, link to an account, remove ---------------------------
  function guestMissing() {
    if (guestsOk) return false;
    S.toast('Adding mentors by name needs migration 106 to be run in Supabase (see README-members-setup.md, section 163).', { type: 'err' });
    return true;
  }
  // prefill: { name, title, organisation, email } for a mentor who applied without an account
  function openGuestForm(g, circleId, prefill) {
    if (guestMissing()) return;
    var v = g || prefill || {};
    var dlg = S.openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">' + (g ? 'Edit mentor' : 'Add a mentor by name') + '</span>' +
      '<h2 class="guide-title">' + (g ? esc(g.name) : 'A mentor who hasn\'t signed up yet') + '</h2>' +
      (g ? '' : '<p class="guide-text">Put a doctor in a Circle straight away. Circle members see their name, role and specialty. Their email and your notes stay private to the committee. When they create an account, use <strong>Link account</strong> to turn this into their real profile.</p>') +
      '<form class="guide-form" novalidate>' +
      '<div class="field"><label for="shg-name">Full name</label><input type="text" id="shg-name" maxlength="80" placeholder="e.g. Dr Naomi Clarke" value="' + esc(v.name || '') + '" required></div>' +
      '<div class="sh-field-row"><div class="field"><label for="shg-title">Role <span class="guide-optional">(optional)</span></label><input type="text" id="shg-title" maxlength="100" placeholder="e.g. Consultant Cardiologist" value="' + esc(v.title || v.job_title || '') + '"></div>' +
      '<div class="field"><label for="shg-org">Organisation <span class="guide-optional">(optional)</span></label><input type="text" id="shg-org" maxlength="100" placeholder="e.g. Lincoln County Hospital" value="' + esc(v.organisation || '') + '"></div></div>' +
      '<div class="field"><label for="shg-spec">Specialty <span class="guide-optional">(optional)</span></label><input type="text" id="shg-spec" maxlength="100" value="' + esc(v.specialty || '') + '"></div>' +
      '<div class="field"><label for="shg-email">Email <span class="guide-optional">(committee only)</span></label><input type="email" id="shg-email" maxlength="200" value="' + esc(v.email || '') + '"></div>' +
      '<div class="field"><label for="shg-note">Notes <span class="guide-optional">(committee only)</span></label><textarea id="shg-note" rows="2" maxlength="500" placeholder="e.g. Met at the careers fair, free on Thursdays">' + esc(v.note || '') + '</textarea></div>' +
      '<div class="sh-field-row"><div class="field"><label for="shg-circle">Circle</label><select id="shg-circle">' + circleOptions(g ? g.circle_id : circleId, true) + '</select></div>' +
      '<div class="field"><label for="shg-status">Status</label><select id="shg-status"><option value="pending"' + ((g ? g.gstatus : 'pending') === 'pending' ? ' selected' : '') + '>Pending (not confirmed yet)</option><option value="confirmed"' + (g && g.gstatus === 'confirmed' ? ' selected' : '') + '>Confirmed</option></select></div></div>' +
      '<p class="sh-hint">Either way, the Circle\'s members see their name. Pending is shown to them as &ldquo;pending&rdquo;.</p>' +
      '<p class="guide-error" hidden></p><div class="guide-actions"><button type="submit" class="btn btn-primary" data-go="close">' + (g ? 'Save' : 'Add mentor') + '</button>' +
      (g ? '' : '<button type="submit" class="btn btn-outline" data-go="again">Add and another</button>') + '<button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div></form>');
    var again = false;
    dlg.el.querySelectorAll('[type=submit]').forEach(function (b) { b.addEventListener('click', function () { again = b.getAttribute('data-go') === 'again'; }); });
    dlg.el.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = dlg.el.querySelector('.guide-error');
      var btn = dlg.el.querySelector('[data-go="' + (again ? 'again' : 'close') + '"]');
      var name = $('shg-name').value.trim();
      if (name.length < 2) { err.textContent = 'Enter the mentor\'s name.'; err.hidden = false; return; }
      var circle = $('shg-circle').value || null;
      busy(btn, true, 'Saving…');
      rpc('sankofa_admin_guest_save', { p_id: g ? g.guest_id : null, p_name: name, p_title: $('shg-title').value, p_organisation: $('shg-org').value, p_specialty: $('shg-spec').value,
        p_email: $('shg-email').value, p_note: $('shg-note').value, p_circle: circle, p_status: $('shg-status').value }).then(function () {
        dlg.close();
        S.toast(g ? 'Saved' : name + ' added' + (circle && circleById(circle) ? ' to ' + circleById(circle).name : ''));
        return load(true).then(function () { if (again) openGuestForm(null, circle); });
      }, function (er) { busy(btn, false); err.textContent = er.message; err.hidden = false; });
    });
    setTimeout(function () { var n = $('shg-name'); if (n) n.focus(); }, 50);
  }

  function openGuestMenu(p) {
    var detail = [];
    if (p.title) detail.push(['Role', esc(p.title)]);
    if (p.organisation) detail.push(['Organisation', esc(p.organisation)]);
    if (p.specialty) detail.push(['Specialty', esc(p.specialty)]);
    if (p.email) detail.push(['Email', '<a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a>']);
    if (p.note) detail.push(['Notes', esc(p.note)]);
    var dlg = S.openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button>' +
      '<div class="shm-dlg-head">' + S.avatar(p, 'lg') + '<div><span class="guide-eyebrow">Guest mentor &middot; ' + (p.gstatus === 'pending' ? 'pending' : 'confirmed') + ' &middot; not on LACMS yet</span><h2 class="guide-title" style="margin:0">' + esc(p.name) + '</h2></div></div>' +
      (detail.length ? '<dl class="shm-detail">' + detail.map(function (d) { return '<div><dt>' + d[0] + '</dt><dd>' + d[1] + '</dd></div>'; }).join('') + '</dl>' : '') +
      '<div class="guide-form"><div class="field"><label for="shm-move">Circle</label><select id="shm-move">' + circleOptions(p.circle_id, true) + '</select></div>' +
      '<p class="guide-error" hidden></p>' +
      '<div class="guide-actions"><button type="button" class="btn btn-primary" data-save>Save changes</button><button type="button" class="btn btn-outline" data-edit>Edit details</button>' +
      (p.gstatus === 'pending' ? '<button type="button" class="btn btn-outline" data-confirm>Mark as confirmed</button>' : '') +
      '<button type="button" class="btn btn-outline" data-link>They\'ve signed up: link account</button></div>' +
      '<div class="shm-linkbox" hidden><div class="field"><label for="shm-linkq">Find their account</label><input type="search" id="shm-linkq" placeholder="Search by name…"></div><div class="shm-linklist" aria-live="polite"></div></div>' +
      '<div class="guide-actions" style="margin-top:12px"><button type="button" class="btn btn-outline sh-btn-danger" data-remove>Remove</button></div></div>');
    var err = dlg.el.querySelector('.guide-error');
    function showErr(er) { err.textContent = er.message; err.hidden = false; }
    dlg.el.querySelector('[data-edit]').addEventListener('click', function () { dlg.close(); openGuestForm(p, p.circle_id); });
    var conf = dlg.el.querySelector('[data-confirm]');
    if (conf) conf.addEventListener('click', function () {
      busy(conf, true, 'Saving…');
      rpc('sankofa_admin_guest_save', { p_id: p.guest_id, p_name: p.name, p_title: p.title || '', p_organisation: p.organisation || '', p_specialty: p.specialty || '', p_email: p.email || '',
        p_note: p.note || '', p_circle: p.circle_id || null, p_status: 'confirmed' }).then(function () { dlg.close(); S.toast(p.name + ' confirmed'); return load(true); }, function (er) { busy(conf, false); showErr(er); });
    });
    dlg.el.querySelector('[data-save]').addEventListener('click', function (e) {
      var btn = e.currentTarget, to = $('shm-move').value || null;
      if (to === (p.circle_id || null)) { dlg.close(); return; }
      busy(btn, true, 'Saving…');
      moveRpc(p.id, to).then(function () { dlg.close(); S.toast('Saved'); return load(true); }, function (er) { busy(btn, false); showErr(er); });
    });
    dlg.el.querySelector('[data-remove]').addEventListener('click', function () {
      dlg.close();
      S.confirmDialog('Remove ' + p.name + '?', 'This deletes their name card. If they sign up later you can add them again.', 'Remove', true).then(function (yes) {
        if (!yes) return;
        rpc('sankofa_admin_guest_delete', { p_id: p.guest_id }).then(function () { S.toast(p.name + ' removed'); return load(true); }, fail);
      });
    });
    var box = dlg.el.querySelector('.shm-linkbox'), list = dlg.el.querySelector('.shm-linklist'), timer = null;
    dlg.el.querySelector('[data-link]').addEventListener('click', function () {
      box.hidden = !box.hidden;
      if (!box.hidden) { var q = $('shm-linkq'); q.value = p.name.replace(/^(dr|prof|professor|mr|mrs|ms|miss)\.?\s+/i, ''); q.focus(); search(); }
    });
    function search() {
      var q = $('shm-linkq').value.trim();
      if (q.length < 2) { list.innerHTML = '<p class="sh-muted">Type at least 2 letters.</p>'; return; }
      rpc('sankofa_admin_search_people', { p_query: q }).then(function (rows) {
        list.innerHTML = rows.length ? '<ul class="shm-pick">' + rows.map(function (r) {
          return '<li><div class="shm-pick-row"><span class="shm-pick-main"><strong>' + esc(r.name) + '</strong><small>' + esc(r.detail || '') + '</small></span><button type="button" class="btn btn-outline btn-sm" data-link-user="' + esc(r.user_id) + '" data-n="' + esc(r.name) + '">Link</button></div></li>';
        }).join('') + '</ul>' : '<p class="sh-muted">No one with an account matches yet. Create their account from Dashboard &rarr; Create account first.</p>';
      }, showErr);
    }
    dlg.el.addEventListener('input', function (e) { if (e.target.id === 'shm-linkq') { clearTimeout(timer); timer = setTimeout(search, 250); } });
    dlg.el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-link-user]');
      if (!b) return;
      busy(b, true, 'Linking…');
      rpc('sankofa_admin_guest_link', { p_id: p.guest_id, p_user: b.getAttribute('data-link-user') }).then(function () {
        dlg.close(); S.toast(b.getAttribute('data-n') + ' is now a Hub mentor' + (p.circle_id ? ' in the same Circle' : '')); return load(true);
      }, function (er) { busy(b, false); showErr(er); });
    });
  }

  function splitTags(v) { return String(v || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 12); }
  function openProfileEdit(p) {
    var mentor = p.role === 'mentor';
    var dlg = S.openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Matching profile</span><h2 class="guide-title">' + esc(p.name) + '</h2>' +
      '<p class="guide-text">These details feed the match suggestions. They started from the application; correct anything that\'s wrong.</p>' +
      '<form class="guide-form" novalidate>' +
      '<div class="field"><label for="shm-e-stage">Stage label <span class="guide-optional">(shown to the Circle - leave blank for the automatic one)</span></label><input type="text" id="shm-e-stage" maxlength="60" value="' + esc(p.stage || '') + '"></div>' +
      '<div class="field"><label for="shm-e-spec">Specialty</label><input type="text" id="shm-e-spec" maxlength="80" value="' + esc(p.specialty || '') + '"></div>' +
      '<div class="field"><label for="shm-e-int">Interests</label><input type="text" id="shm-e-int" value="' + esc((p.interests || []).join(', ')) + '"><small class="sh-hint">Separate with commas</small></div>' +
      (mentor ? '<div class="field"><label for="shm-e-off">What they offer</label><input type="text" id="shm-e-off" value="' + esc((p.offers || []).join(', ')) + '"><small class="sh-hint">Separate with commas</small></div>' +
        '<div class="field"><label for="shm-e-cap">Mentee capacity</label><input type="number" id="shm-e-cap" min="0" max="20" value="' + (p.capacity == null ? '' : p.capacity) + '"></div>' : '') +
      '<div class="sh-field-row"><div class="field"><label for="shm-e-comm">Communication</label><select id="shm-e-comm"><option value="">None</option>' + Object.keys(COMM_LABEL).map(function (k) { return '<option value="' + k + '"' + (p.comm_style === k ? ' selected' : '') + '>' + COMM_LABEL[k] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="shm-e-freq">Catch-ups</label><select id="shm-e-freq"><option value="">None</option>' + Object.keys(FREQ_LABEL).map(function (k) { return '<option value="' + k + '"' + (p.meeting_freq === k ? ' selected' : '') + '>' + FREQ_LABEL[k] + '</option>'; }).join('') + '</select></div></div>' +
      '<p class="guide-error" hidden></p><div class="guide-actions"><button type="submit" class="btn btn-primary">Save</button><button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div></form>');
    dlg.el.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = dlg.el.querySelector('[type=submit]');
      var err = dlg.el.querySelector('.guide-error');
      busy(btn, true, 'Saving…');
      var autoStage = p.stage;
      var stage = $('shm-e-stage').value.trim();
      var patch = { specialty: $('shm-e-spec').value, interests: splitTags($('shm-e-int').value), comm_style: $('shm-e-comm').value, meeting_freq: $('shm-e-freq').value };
      if (stage !== autoStage) patch.stage_label = stage;
      if (mentor) { patch.offers = splitTags($('shm-e-off').value); patch.capacity = $('shm-e-cap').value; }
      rpc('sankofa_admin_update_participant', { p_user: p.id, p_patch: patch }).then(function () { dlg.close(); S.toast('Profile updated'); return load(true); }, function (er) { busy(btn, false); err.textContent = er.message; err.hidden = false; });
    });
  }

  // ---- Circles -------------------------------------------------------------------
  function openCircleForm(c) {
    var dlg = S.openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Circles</span><h2 class="guide-title">' + (c ? 'Edit ' + esc(c.name) : 'New Circle') + '</h2>' +
      '<form class="guide-form" novalidate>' +
      '<div class="field"><label for="shm-c-name">Name</label><input type="text" id="shm-c-name" maxlength="60" required data-autofocus value="' + esc(c ? c.name : '') + '" placeholder="e.g. Adowa"></div>' +
      '<div class="field"><label>Colour</label><div class="shm-swatches" role="radiogroup" aria-label="Circle colour">' + S.THEMES.map(function (t) {
        return '<label class="shm-swatch-opt sh-theme-' + t + '"><input type="radio" name="shm-c-theme" value="' + t + '"' + ((c ? c.theme : S.THEMES[data.circles.length % S.THEMES.length]) === t ? ' checked' : '') + '><span title="' + S.THEME_LABEL[t] + '"></span></label>';
      }).join('') + '</div></div>' +
      '<div class="field"><label for="shm-c-motto">Motto <span class="guide-optional">(optional)</span></label><input type="text" id="shm-c-motto" maxlength="140" value="' + esc(c ? c.motto || '' : '') + '" placeholder="Together we rise"></div>' +
      '<div class="field"><label for="shm-c-desc">Description <span class="guide-optional">(optional)</span></label><textarea id="shm-c-desc" maxlength="600" rows="3">' + esc(c ? c.description || '' : '') + '</textarea></div>' +
      '<div class="field"><label for="shm-c-link">Group chat link <span class="guide-optional">(optional - e.g. a WhatsApp invite)</span></label><input type="text" id="shm-c-link" value="' + esc(c ? c.group_link || '' : '') + '" placeholder="https://chat.whatsapp.com/…"></div>' +
      '<div class="sh-field-row"><div class="field"><label for="shm-c-cap">Places</label><input type="number" id="shm-c-cap" min="2" max="40" value="' + (c ? c.capacity : 8) + '"></div>' +
      '<div class="field"><label for="shm-c-year">Academic year <span class="guide-optional">(optional)</span></label><input type="text" id="shm-c-year" maxlength="20" value="' + esc(c ? c.academic_year || '' : '2026/27') + '"></div></div>' +
      (c ? '<div class="field"><label for="shm-c-status">Status</label><select id="shm-c-status"><option value="active"' + (c.status === 'active' ? ' selected' : '') + '>Active</option><option value="archived"' + (c.status === 'archived' ? ' selected' : '') + '>Archived (hidden from the board)</option></select></div>' : '') +
      '<p class="guide-error" hidden></p><div class="guide-actions"><button type="submit" class="btn btn-primary">' + (c ? 'Save' : 'Create Circle') + '</button><button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div></form>');
    dlg.el.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = dlg.el.querySelector('.guide-error');
      var btn = dlg.el.querySelector('[type=submit]');
      if ($('shm-c-name').value.trim().length < 2) { err.textContent = 'Give the Circle a name.'; err.hidden = false; return; }
      busy(btn, true, 'Saving…');
      rpc('sankofa_admin_save_circle', {
        p_id: c ? c.id : null, p_name: $('shm-c-name').value, p_theme: dlg.el.querySelector('input[name=shm-c-theme]:checked').value,
        p_motto: $('shm-c-motto').value, p_description: $('shm-c-desc').value, p_group_link: $('shm-c-link').value,
        p_capacity: parseInt($('shm-c-cap').value, 10) || 8, p_status: c ? $('shm-c-status').value : 'active', p_academic_year: $('shm-c-year').value
      }).then(function () { dlg.close(); S.toast(c ? 'Circle updated' : 'Circle created'); return load(true); }, function (er) { busy(btn, false); err.textContent = er.message; err.hidden = false; });
    });
  }

  function openCircleMenu(id) {
    var c = circleById(id);
    if (!c) return;
    var dlg = S.openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Circle</span><h2 class="guide-title">' + esc(c.name) + '</h2>' +
      '<div class="guide-actions guide-actions--stack">' +
      '<button type="button" class="btn btn-outline" data-act="meeting">Schedule a meeting</button>' +
      '<button type="button" class="btn btn-outline" data-act="announce">Post an announcement</button>' +
      '<button type="button" class="btn btn-outline" data-act="edit">Edit Circle</button>' +
      '<button type="button" class="btn btn-outline" data-act="archive">' + (c.status === 'active' ? 'Archive this Circle' : 'Restore this Circle') + '</button>' +
      '<button type="button" class="btn btn-outline sh-btn-danger" data-act="delete">Delete (only if empty)</button></div>');
    dlg.el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      dlg.close();
      if (act === 'edit') openCircleForm(c);
      if (act === 'meeting') openMeetingForm(c);
      if (act === 'announce') openAnnounce(c);
      if (act === 'archive') rpc('sankofa_admin_save_circle', { p_id: c.id, p_name: c.name, p_theme: c.theme, p_motto: c.motto, p_description: c.description, p_group_link: c.group_link, p_capacity: c.capacity, p_status: c.status === 'active' ? 'archived' : 'active', p_academic_year: c.academic_year }).then(function () { S.toast(c.status === 'active' ? 'Archived' : 'Restored'); return load(true); }, fail);
      if (act === 'delete') S.confirmDialog('Delete ' + c.name + '?', 'This removes the Circle, its meetings and its board. It only works if nobody is in it.', 'Delete', true).then(function (yes) {
        if (yes) rpc('sankofa_admin_delete_circle', { p_id: c.id }).then(function () { S.toast('Circle deleted'); return load(true); }, fail);
      });
    });
  }

  // ---- Meetings + announcements -----------------------------------------------------------
  function openMeetingForm(c) {
    var start = new Date(Date.now() + 7 * 86400000);
    start.setMinutes(0, 0, 0); start.setHours(18);
    var end = new Date(start.getTime() + 3600000);
    var kinds = c ? [['circle', 'Circle meeting'], ['checkin', 'Check-in'], ['social', 'Social'], ['workshop', 'Workshop']] : [['all', 'Event for everyone'], ['social', 'Social'], ['workshop', 'Workshop']];
    var dlg = S.openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Meetings</span><h2 class="guide-title">' + (c ? 'Schedule a meeting for ' + esc(c.name) : 'Event for everyone in the Hub') + '</h2>' +
      '<form class="guide-form" novalidate><div class="field"><label for="shm-m-title">Title</label><input type="text" id="shm-m-title" maxlength="100" required data-autofocus></div>' +
      '<div class="field"><label for="shm-m-kind">Type</label><select id="shm-m-kind">' + kinds.map(function (k) { return '<option value="' + k[0] + '">' + k[1] + '</option>'; }).join('') + '</select></div>' +
      '<div class="sh-field-row"><div class="field"><label for="shm-m-start">Starts</label><input type="datetime-local" id="shm-m-start" value="' + S.toLocalInput(start.toISOString()) + '"></div><div class="field"><label for="shm-m-end">Ends</label><input type="datetime-local" id="shm-m-end" value="' + S.toLocalInput(end.toISOString()) + '"></div></div>' +
      '<div class="field"><label for="shm-m-loc">Where <span class="guide-optional">(optional)</span></label><input type="text" id="shm-m-loc" maxlength="160"></div>' +
      '<div class="field"><label for="shm-m-link">Online link <span class="guide-optional">(optional)</span></label><input type="text" id="shm-m-link"></div>' +
      '<div class="field"><label for="shm-m-desc">Details <span class="guide-optional">(optional)</span></label><textarea id="shm-m-desc" maxlength="800" rows="3"></textarea></div>' +
      '<p class="guide-error" hidden></p><div class="guide-actions"><button type="submit" class="btn btn-primary">Schedule</button><button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div></form>');
    dlg.el.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = dlg.el.querySelector('.guide-error');
      var btn = dlg.el.querySelector('[type=submit]');
      if (!$('shm-m-title').value.trim()) { err.textContent = 'Give the meeting a title.'; err.hidden = false; return; }
      if (!$('shm-m-start').value) { err.textContent = 'Choose a start time.'; err.hidden = false; return; }
      if ($('shm-m-end').value && new Date($('shm-m-end').value) <= new Date($('shm-m-start').value)) { err.textContent = 'The end has to be after the start.'; err.hidden = false; return; }
      busy(btn, true, 'Scheduling…');
      rpc('sankofa_save_meeting', {
        p_id: null, p_circle: c ? c.id : null, p_pairing: null, p_title: $('shm-m-title').value, p_kind: $('shm-m-kind').value,
        p_starts: S.fromLocalInput($('shm-m-start').value), p_ends: S.fromLocalInput($('shm-m-end').value),
        p_location: $('shm-m-loc').value, p_link: $('shm-m-link').value, p_description: $('shm-m-desc').value
      }).then(function () { dlg.close(); S.toast('Meeting scheduled - everyone invited can see it now'); return load(true); }, function (er) { busy(btn, false); err.textContent = er.message; err.hidden = false; });
    });
  }

  function openAnnounce(c) {
    var dlg = S.openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Announcement</span><h2 class="guide-title">' + (c ? 'To ' + esc(c.name) : 'To everyone in the Hub') + '</h2>' +
      '<form class="guide-form" novalidate><div class="field"><label for="shm-a-text">Message</label><textarea id="shm-a-text" maxlength="1000" rows="5" data-autofocus placeholder="Welcome to Sankofa! Your first Circle meeting is…"></textarea></div>' +
      '<p class="guide-error" hidden></p><div class="guide-actions"><button type="submit" class="btn btn-primary">Post announcement</button><button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div></form>');
    dlg.el.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = dlg.el.querySelector('.guide-error');
      var btn = dlg.el.querySelector('[type=submit]');
      if (!$('shm-a-text').value.trim()) { err.textContent = 'Write something first.'; err.hidden = false; return; }
      busy(btn, true, 'Posting…');
      rpc('sankofa_post', { p_circle: c ? c.id : null, p_kind: 'announcement', p_body: $('shm-a-text').value, p_target: null }).then(function () { dlg.close(); S.toast('Announcement posted'); }, function (er) { busy(btn, false); err.textContent = er.message; err.hidden = false; });
    });
  }

  function openEventChooser() {
    var dlg = S.openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Everyone in the Hub</span><h2 class="guide-title">What would you like to do?</h2>' +
      '<div class="guide-actions guide-actions--stack"><button type="button" class="btn btn-primary" data-act="event">Schedule an event or social</button><button type="button" class="btn btn-outline" data-act="announce">Post an announcement</button></div>');
    dlg.el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      dlg.close();
      if (b.getAttribute('data-act') === 'event') openMeetingForm(null); else openAnnounce(null);
    });
  }

  // ---- Activity log ---------------------------------------------------------------------------
  function openHistory() {
    var dlg = S.openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Activity</span><h2 class="guide-title">Recent moves</h2><p class="guide-text">Loading…</p>');
    rpc('sankofa_admin_history', { p_limit: 60 }).then(function (rows) {
      dlg.el.innerHTML = '<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Activity</span><h2 class="guide-title">Recent moves</h2>' +
        (rows.length ? '<ul class="shm-log">' + rows.map(function (r) {
          return '<li><strong>' + esc(r.person) + '</strong> ' + (r.from ? 'left <em>' + esc(r.from) + '</em> for ' : 'joined ') + '<em>' + esc(r.to || 'Unplaced') + '</em>' +
            '<small>' + esc(S.fmtDateTime(r.at)) + ' · by ' + esc(r.by) + (r.note ? ' · ' + esc(r.note) : '') + '</small></li>';
        }).join('') + '</ul>' : '<p class="guide-text">Nothing has been moved yet.</p>') +
        '<div class="guide-actions"><button type="button" class="btn btn-outline" data-dialog-close>Close</button></div>';
    }, function (err) { dlg.el.innerHTML = '<h2 class="guide-title">Couldn\'t load</h2><p class="guide-text">' + esc(err.message) + '</p>'; });
  }

  // ---- Adding people --------------------------------------------------------------------------------
  function openAdd() {
    var dlg = S.openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Add people</span><h2 class="guide-title">Bring people into the Hub</h2><p class="guide-text">Loading…</p>', 'sh-dialog--wide');
    rpc('sankofa_admin_candidates').then(function (cand) {
      var tab = cand.mentees.length || !cand.mentors.length ? 'mentee' : 'mentor';
      var picked = {};
      var searchRows = [];
      function listFor(kind) {
        var rows = kind === 'mentee' ? cand.mentees : kind === 'mentor' ? cand.mentors : searchRows;
        if (!rows.length) {
          return '<p class="sh-muted">' + (kind === 'search' ? 'Search by name above to find anyone with an account.' : kind === 'mentee' ? 'No student applicants are waiting - everyone who applied is already in the Hub.' : 'No professionals with accounts are waiting.') + '</p>';
        }
        return '<ul class="shm-pick">' + rows.map(function (r) {
          var role = kind === 'search' ? (r.kind === 'professional' ? 'mentor' : 'mentee') : kind;
          var key = r.user_id;
          return '<li><label><input type="checkbox" data-pick="' + esc(key) + '" data-role="' + role + '"' + (picked[key] ? ' checked' : '') + '>' +
            '<span class="shm-pick-main"><strong>' + esc(r.name) + '</strong><small>' + esc(r.detail || '') + (r.specialty ? ' · ' + esc(r.specialty) : '') + (r.applied_at ? ' · applied ' + esc(S.fmtDay(r.applied_at)) : '') + '</small></span>' +
            (r.sixth_form ? '<span class="sh-chip">Restricted</span>' : '') + (r.pending_approval ? '<span class="sh-chip" title="They have a login but the committee hasn\'t approved their professional account yet. They can be placed now; the Hub opens for them once approved.">Awaiting approval</span>' : '') + (r.inactive ? '<span class="sh-chip" title="Their profile is switched off in the Network">Inactive profile</span>' : '') + (kind === 'search' ? '<select data-role-for="' + esc(key) + '" aria-label="Add ' + esc(r.name) + ' as"><option value="mentee"' + (role === 'mentee' ? ' selected' : '') + '>as mentee</option><option value="mentor"' + (role === 'mentor' ? ' selected' : '') + '>as mentor</option></select>' : '') +
            '</label></li>';
        }).join('') + '</ul>';
      }
      function draw() {
        var count = Object.keys(picked).length;
        dlg.el.innerHTML = '<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Add people</span><h2 class="guide-title">Bring people into the Hub</h2>' +
          '<div class="sh-seg ui-seg" role="tablist">' + [['mentee', 'Student applicants (' + cand.mentees.length + ')'], ['mentor', 'Professionals (' + cand.mentors.length + ')'], ['search', 'Find anyone']].map(function (t) {
            return '<button type="button" role="tab" data-tab="' + t[0] + '" class="' + (tab === t[0] ? 'is-active' : '') + '" aria-selected="' + (tab === t[0]) + '">' + t[1] + '</button>';
          }).join('') + '</div>' +
          (tab === 'search' ? '<div class="field" style="margin-top:12px"><input type="search" id="shm-find" placeholder="Search members and professionals by name or email…" aria-label="Search people"></div>' : '') +
          (tab === 'mentee' && cand.mentees.length ? '<p class="sh-muted" style="margin-top:12px"><button type="button" class="link-button" data-all>Select all ' + cand.mentees.length + '</button></p>' : '') +
          '<div class="shm-pick-wrap">' + listFor(tab) + '</div>' +
          (tab === 'mentor' && cand.no_account.length ? '<details class="shm-noacct"><summary>' + plural(cand.no_account.length, 'mentor') + ' applied without an account</summary><p class="sh-muted">They can\'t be added until they have a LACMS account - create one from Dashboard &rarr; Create account, then they\'ll appear in the list above.</p><ul>' + cand.no_account.map(function (n, i) { return '<li><strong>' + esc(n.name) + '</strong> <small>' + esc([n.job_title, n.organisation, n.email].filter(Boolean).join(' · ')) + '</small> <button type="button" class="link-button" data-guest-from="' + i + '">Add as a guest mentor now</button></li>'; }).join('') + '</ul></details>' : '') +
          '<p class="sh-muted shm-preview">Want to see the Hub as a member sees it? <button type="button" class="link-button" data-add-me="mentee">Add me as a mentee</button> or <button type="button" class="link-button" data-add-me="mentor">as a mentor</button> (you can remove yourself from your card afterwards).</p>' +
          '<div class="field" style="margin-top:12px"><label for="shm-addto">Place them in</label><select id="shm-addto"><option value="">No Circle yet (Unplaced)</option>' + circleOptions(null, false) + '</select></div>' +
          '<p class="guide-error" hidden></p><div class="guide-actions"><button type="button" class="btn btn-primary" data-do ' + (count ? '' : 'disabled') + '>Add ' + (count ? plural(count, 'person', 'people') : 'selected') + '</button><button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div>' +
          '<p class="guide-fine">Their application answers are carried across for matching, and a pending application is marked accepted.</p>';
      }
      draw();
      var addTo = '';
      dlg.el.addEventListener('click', function (e) {
        var gf = e.target.closest('[data-guest-from]');
        if (gf) { var n = cand.no_account[Number(gf.getAttribute('data-guest-from'))]; dlg.close(); openGuestForm(null, null, { name: n.name, title: n.job_title, organisation: n.organisation, email: n.email }); return; }
        var t = e.target.closest('[data-tab]');
        if (t) { addTo = $('shm-addto') ? $('shm-addto').value : ''; tab = t.getAttribute('data-tab'); draw(); $('shm-addto').value = addTo; return; }
        if (e.target.closest('[data-all]')) { cand.mentees.forEach(function (r) { picked[r.user_id] = 'mentee'; }); addTo = $('shm-addto').value; draw(); $('shm-addto').value = addTo; return; }
        var me = e.target.closest('[data-add-me]');
        if (me) {
          supabaseClient.auth.getSession().then(function (r) {
            return rpc('sankofa_admin_add_participant', { p_user: r.data.session.user.id, p_role: me.getAttribute('data-add-me'), p_circle: $('shm-addto').value || null });
          }).then(function () { dlg.close(); S.toast('You\'re in the Hub - open the Sankofa Hub page to see it as a member does'); return load(true); }, fail);
          return;
        }
        var go = e.target.closest('[data-do]');
        if (!go) return;
        var people = Object.keys(picked).map(function (id) { return { user: id, role: picked[id] }; });
        if (!people.length) return;
        var circle = $('shm-addto').value;
        var err = dlg.el.querySelector('.guide-error');
        busy(go, true, 'Adding…');
        rpc('sankofa_admin_add_many', { p_people: people }).then(function () {
          return circle ? rpc('sankofa_admin_apply_plan', { p_plan: { moves: people.map(function (p) { return { user: p.user, circle: circle }; }), pairings: [] } }) : null;
        }).then(function () { dlg.close(); S.toast(plural(people.length, 'person', 'people') + ' added to the Hub'); return load(true); }, function (er) { busy(go, false); err.textContent = er.message; err.hidden = false; });
      });
      dlg.el.addEventListener('change', function (e) {
        var cb = e.target.closest('[data-pick]');
        if (cb) {
          var id = cb.getAttribute('data-pick');
          var sel = dlg.el.querySelector('[data-role-for="' + id + '"]');
          if (cb.checked) picked[id] = sel ? sel.value : cb.getAttribute('data-role'); else delete picked[id];
          var n = Object.keys(picked).length, btn = dlg.el.querySelector('[data-do]');
          btn.disabled = !n; btn.textContent = 'Add ' + (n ? plural(n, 'person', 'people') : 'selected');
          return;
        }
        var rs = e.target.closest('[data-role-for]');
        if (rs && picked[rs.getAttribute('data-role-for')]) picked[rs.getAttribute('data-role-for')] = rs.value;
      });
      var timer;
      dlg.el.addEventListener('input', function (e) {
        if (e.target.id !== 'shm-find') return;
        clearTimeout(timer);
        var q = e.target.value;
        timer = setTimeout(function () {
          rpc('sankofa_admin_search_people', { p_query: q }).then(function (rows) {
            searchRows = rows || [];
            dlg.el.querySelector('.shm-pick-wrap').innerHTML = searchRows.length ? listFor('search') : '<p class="sh-muted">' + (q.length < 2 ? 'Type at least two letters.' : 'Nobody found - they may already be in the Hub.') + '</p>';
          }, fail);
        }, 300);
      });
    }, function (err) { dlg.el.innerHTML = '<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><h2 class="guide-title">Couldn\'t load</h2><p class="guide-text">' + esc(err.message) + '</p>'; });
  }

  // =======================================================================
  // Who can manage the Circles (president only)
  // =======================================================================
  // The Executive Committee can SEE the Sankofa Hub; only the people on this list (and the
  // president) can MANAGE it. The list lives in the database (migration 090) and every
  // Circle-manager call is checked against it there, so this dialog is the only control needed.
  function loadManagers() {
    return rpc('president_get_sankofa_managers').then(function (rows) {
      managers = rows || [];
      return managers;
    }, function () { managers = null; return null; });
  }

  function personType(m) {
    if (m.member_type === 'executive_committee') return 'Executive Committee';
    if (m.member_type === 'supporting_committee') return 'Supporting Committee';
    if (m.member_type === 'professional') return 'Professional';
    return 'Member';
  }

  function openManagers() {
    var dlg = S.openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Sankofa Circles</span><h2 class="guide-title">Who can manage the Circles</h2>' +
      '<p class="guide-text">The whole Executive Committee can see the Sankofa Hub. Only you and the people switched on below can <strong>manage</strong> it: place people in Circles, pair mentors, schedule meetings and post announcements. They find it under Dashboard &rarr; Sankofa Hub.</p>' +
      '<div class="shm-mgr-list" id="shm-mgr-list"><p class="sh-muted">Loading…</p></div>' +
      '<div class="shm-mgr-add"><label for="shm-mgr-q" class="shm-mgr-add-label">Add someone else</label>' +
      '<input type="search" id="shm-mgr-q" placeholder="Search anyone with an account by name…" autocomplete="off"><div class="shm-mgr-results" id="shm-mgr-results" aria-live="polite"></div></div>', 'shm-dlg-mgr');
    var found = [];
    function drawList() {
      var box = dlg.el.querySelector('#shm-mgr-list');
      if (!box) return;
      var rows = '<div class="shm-mgr-row is-on is-fixed">' + S.avatar({ name: 'You' }, 'md') + '<span class="shm-mgr-main"><strong>You (President)</strong><small>Always manages the Circles</small></span><span class="shm-mgr-fixed">Always</span></div>';
      if (!managers) {
        box.innerHTML = rows + '<p class="auth-error" style="display:block">Couldn\'t load the list. Has migration 090 been run?</p>';
        return;
      }
      // An older version of migration 090 (no "is_committee" column) still hands out access through Hub Access
      // overrides. Say so, because the newer rules need the current file to be run.
      if (managers.length && managers[0].is_committee === undefined) {
        rows = '<p class="auth-error" style="display:block">The database is on an older version of migration 090. Run the latest <b>090-sankofa-managers.sql</b> in Supabase so managers can open the Circle manager.</p>' + rows;
      }
      rows += managers.map(function (m) {
        return '<label class="shm-mgr-row' + (m.can_manage ? ' is-on' : '') + '">' + S.avatar({ name: m.full_name }, 'md') +
          '<span class="shm-mgr-main"><strong>' + esc(m.full_name) + '</strong><small>' + esc(personType(m)) + (m.course ? ' · ' + esc(m.course) : '') + '</small></span>' +
          '<span class="shm-switch"><input type="checkbox" role="switch" data-mgr="' + esc(m.user_id) + '"' + (m.can_manage ? ' checked' : '') +
          ' aria-label="' + esc(m.full_name) + ' can manage the Circles"><span aria-hidden="true"></span></span></label>';
      }).join('');
      if (!managers.length) rows += '<p class="sh-muted">No other committee members found. Use the search below to add someone.</p>';
      box.innerHTML = rows;
    }
    function drawResults(msg) {
      var box = dlg.el.querySelector('#shm-mgr-results');
      if (!box) return;
      if (msg) { box.innerHTML = '<p class="sh-muted">' + esc(msg) + '</p>'; return; }
      box.innerHTML = found.map(function (r) {
        return '<div class="shm-mgr-row">' + S.avatar({ name: r.full_name }, 'sm') + '<span class="shm-mgr-main"><strong>' + esc(r.full_name) + '</strong><small>' + esc((r.kind === 'professional' ? 'Professional' : 'Member') + (r.detail ? ' · ' + r.detail : '')) + '</small></span>' +
          '<button type="button" class="btn btn-outline btn-sm" data-mgr-add="' + esc(r.user_id) + '">Add</button></div>';
      }).join('');
    }
    function refresh() { return loadManagers().then(drawList); }
    refresh();
    dlg.el.addEventListener('change', function (e) {
      var cb = e.target.closest && e.target.closest('[data-mgr]');
      if (!cb) return;
      var id = cb.getAttribute('data-mgr');
      var m = (managers || []).filter(function (x) { return x.user_id === id; })[0];
      var on = cb.checked;
      var name = m ? m.full_name : 'They';
      cb.disabled = true;
      rpc('president_set_sankofa_manager', { p_user: id, p_on: on }).then(function () {
        S.toast(name + (on ? ' can now manage the Circles' : ' can no longer manage the Circles'));
        return refresh();
      }, function (err) { fail(err); return refresh(); });
    });
    dlg.el.addEventListener('click', function (e) {
      var add = e.target.closest && e.target.closest('[data-mgr-add]');
      if (!add) return;
      var id = add.getAttribute('data-mgr-add');
      var r = found.filter(function (x) { return x.user_id === id; })[0];
      add.disabled = true;
      rpc('president_set_sankofa_manager', { p_user: id, p_on: true }).then(function () {
        S.toast((r ? r.full_name : 'They') + ' can now manage the Circles');
        found = found.filter(function (x) { return x.user_id !== id; });
        drawResults(found.length ? null : 'Added. Search for someone else if you like.');
        return refresh();
      }, function (err) { fail(err); add.disabled = false; });
    });
    var timer;
    dlg.el.addEventListener('input', function (e) {
      if (e.target.id !== 'shm-mgr-q') return;
      clearTimeout(timer);
      var q = e.target.value.trim();
      if (q.length < 2) { found = []; drawResults(''); return; }
      timer = setTimeout(function () {
        rpc('president_search_people_for_manager', { p_query: q }).then(function (rows) {
          found = rows || [];
          drawResults(found.length ? null : 'Nobody found - they may already be on the list.');
        }, function (err) { drawResults(err.message); });
      }, 250);
    });
  }

  // =======================================================================
  // Match suggestions
  // =======================================================================
  function lc(s) { return String(s || '').toLowerCase().trim(); }
  var STOP = { help: 1, with: 1, from: 1, that: 1, this: 1, they: 1, have: 1, been: 1, want: 1, need: 1, more: 1, some: 1, also: 1, would: 1, could: 1, like: 1, lots: 1, your: 1, about: 1, into: 1, become: 1, doctor: 1, guidance: 1 };
  function tokens(s) { return lc(s).split(/[^a-z0-9]+/).filter(function (w) { return w.length > 3 && !STOP[w]; }); }
  function overlapList(a, b) {
    var set = {};
    (a || []).forEach(function (x) { set[lc(x)] = x; });
    var out = [];
    (b || []).forEach(function (y) { if (set[lc(y)]) out.push(set[lc(y)]); });
    return out;
  }
  function sharedTokens(textA, textB) {
    var a = tokens(textA), b = tokens(textB), seen = {}, out = [];
    a.forEach(function (w) { seen[w] = true; });
    b.forEach(function (w) { if (seen[w] && out.indexOf(w) === -1) out.push(w); });
    return out;
  }

  // How well does this mentor suit this mentee? Returns { score, reasons }.
  function affinity(mentee, mentor) {
    var score = 0, reasons = [];
    var ms = lc(mentee.specialty), ps = lc(mentor.specialty);
    if (ms && ps && (ms === ps || ms.indexOf(ps) !== -1 || ps.indexOf(ms) !== -1)) { score += 30; reasons.push('Both interested in ' + (mentor.specialty || mentee.specialty)); }
    else {
      var spec = sharedTokens(mentee.specialty + ' ' + mentee.aspirations, mentor.specialty);
      if (spec.length) { score += 15; reasons.push('Aspirations fit their ' + mentor.specialty); }
    }
    var shared = overlapList(mentee.interests, mentor.interests);
    if (shared.length) { score += Math.min(shared.length * 8, 24); reasons.push('Shared interests: ' + shared.slice(0, 3).join(', ')); }
    var offers = sharedTokens(mentee.looking_for, (mentor.offers || []).join(' '));
    if (offers.length) { score += Math.min(offers.length * 6, 18); reasons.push('Offers what they\'re looking for (' + offers.slice(0, 2).join(', ') + ')'); }
    if (mentee.comm_style && mentee.comm_style === mentor.comm_style) { score += 8; reasons.push('Same communication style'); }
    if (mentee.meeting_freq && mentee.meeting_freq === mentor.meeting_freq) { score += 6; reasons.push('Same meeting rhythm'); }
    if (mentee.heritage && mentor.heritage && lc(mentee.heritage) === lc(mentor.heritage)) { score += 10; reasons.push('Shared heritage'); }
    return { score: score, reasons: reasons };
  }

  function buildPlan() {
    var circles = activeCircles().map(function (c) {
      return { id: c.id, name: c.name, capacity: c.capacity, mentors: c.members.filter(function (m) { return m.role === 'mentor' && m.status === 'active'; }), mentees: c.members.filter(function (m) { return m.role === 'mentee'; }), size: c.members.length };
    });
    var plan = { moves: [], pairings: [], unmatched: [] };
    var unplaced = data.unplaced.filter(function (p) { return p.status === 'active'; });
    var mentors = unplaced.filter(function (p) { return p.role === 'mentor'; });
    var mentees = unplaced.filter(function (p) { return p.role === 'mentee'; });
    if (!circles.length) { unplaced.forEach(function (p) { plan.unmatched.push({ person: p, why: 'There are no active Circles yet - create some first.' }); }); return plan; }

    // 1. Spread mentors across the Circles that have the fewest.
    mentors.sort(function (a, b) { return (b.capacity == null ? 6 : b.capacity) - (a.capacity == null ? 6 : a.capacity); });
    mentors.forEach(function (m) {
      var open = circles.filter(function (c) { return c.size < c.capacity; });
      if (!open.length) { plan.unmatched.push({ person: m, why: 'Every Circle is full.' }); return; }
      open.sort(function (a, b) { return a.mentors.length - b.mentors.length || a.size - b.size; });
      var c = open[0];
      c.mentors.push(m); c.size++;
      plan.moves.push({ person: m, circle: c, score: 0, reasons: [c.mentors.length === 1 ? 'First mentor in ' + c.name : 'Balances mentors across Circles'] });
    });

    // 2. Place mentees where their likely mentors are, best fit first.
    var remaining = mentees.slice();
    var stagesIn = {};
    circles.forEach(function (c) { stagesIn[c.id] = {}; c.mentees.concat(c.mentors).forEach(function (m) { stagesIn[c.id][lc(m.stage)] = true; }); });
    plan.moves.forEach(function (mv) { stagesIn[mv.circle.id][lc(mv.person.stage)] = true; });
    function circleFit(mentee, c) {
      var best = c.mentors.map(function (m) { return affinity(mentee, m); }).sort(function (a, b) { return b.score - a.score; });
      var top = best.slice(0, 2);
      var score = top.reduce(function (s, a) { return s + a.score; }, 0) / Math.max(top.length, 1);
      var reasons = top.length ? top[0].reasons.slice() : [];
      if (!c.mentors.length) score -= 20;
      if (!stagesIn[c.id][lc(mentee.stage)]) { score += 6; reasons.push('Adds a new stage to ' + c.name); }
      score -= c.size * 1.5;
      return { score: score, reasons: reasons };
    }
    while (remaining.length) {
      var best = null;
      remaining.forEach(function (mentee) {
        circles.forEach(function (c) {
          if (c.size >= c.capacity) return;
          var fit = circleFit(mentee, c);
          if (!best || fit.score > best.fit.score) best = { mentee: mentee, circle: c, fit: fit };
        });
      });
      if (!best) break;
      best.circle.mentees.push(best.mentee); best.circle.size++;
      stagesIn[best.circle.id][lc(best.mentee.stage)] = true;
      plan.moves.push({ person: best.mentee, circle: best.circle, score: Math.round(best.fit.score), reasons: best.fit.reasons.length ? best.fit.reasons : ['Best available place'] });
      remaining.splice(remaining.indexOf(best.mentee), 1);
    }
    remaining.forEach(function (m) { plan.unmatched.push({ person: m, why: 'Every Circle is full - add a Circle or raise a capacity.' }); });

    // 3. Pair every mentee who has no mentor with the best mentor in their Circle.
    var load = {};
    allPeople().forEach(function (p) { if (p.role === 'mentor') load[p.id] = (p.mentee_ids || []).length; });
    circles.forEach(function (c) {
      var ms = c.mentees.filter(function (m) { return !mentorIdsOf(m).length; });
      // mentees that were just placed here are plain objects from `unplaced`, so they have no mentor either
      var seen = {};
      ms = ms.filter(function (m) { if (seen[m.id]) return false; seen[m.id] = true; return true; });
      var cands = [];
      ms.forEach(function (mentee) { c.mentors.forEach(function (mentor) { var a = affinity(mentee, mentor); cands.push({ mentee: mentee, mentor: mentor, a: a }); }); });
      cands.sort(function (x, y) { return y.a.score - x.a.score; });
      var done = {};
      cands.forEach(function (cd) {
        if (done[cd.mentee.id]) return;
        var cap = cd.mentor.capacity == null ? 6 : cd.mentor.capacity;
        if ((load[cd.mentor.id] || 0) >= cap) return;
        done[cd.mentee.id] = true;
        load[cd.mentor.id] = (load[cd.mentor.id] || 0) + 1;
        plan.pairings.push({ mentee: cd.mentee, mentor: cd.mentor, circle: c, score: cd.a.score, reasons: cd.a.reasons.length ? cd.a.reasons : ['Same Circle'] });
      });
    });
    return plan;
  }

  function openSuggest() {
    if (!data.unplaced.length && !allPeople().some(function (p) { return p.role === 'mentee' && !mentorIdsOf(p).length && p.circle_id; })) {
      S.toast('Everyone already has a Circle and a mentor - nothing to suggest');
      return;
    }
    var plan = buildPlan();
    var byCircle = {};
    plan.moves.forEach(function (mv, i) { (byCircle[mv.circle.id] = byCircle[mv.circle.id] || { circle: mv.circle, rows: [] }).rows.push({ mv: mv, i: i }); });
    var dlg = S.openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Suggested matches</span><h2 class="guide-title">Review the plan</h2>' +
      '<p class="guide-text">Matched on specialty, interests, what mentors offer and mentees are looking for, communication style and how often they want to meet. Untick anything you\'d rather do differently, then apply.</p>' +
      (plan.moves.length ? Object.keys(byCircle).map(function (k) {
        var g = byCircle[k];
        return '<h3 class="sh-dlg-h">' + esc(g.circle.name) + '</h3><ul class="shm-plan">' + g.rows.map(function (r) {
          return '<li><label><input type="checkbox" data-mv="' + r.i + '" checked><span class="shm-plan-main"><strong>' + esc(r.mv.person.name) + '</strong> <span class="sh-chip sh-chip--role">' + (r.mv.person.role === 'mentor' ? 'Mentor' : 'Mentee') + '</span>' +
            '<small>' + esc(r.mv.reasons.join(' · ')) + '</small></span></label></li>';
        }).join('') + '</ul>';
      }).join('') : '<p class="sh-muted">No one to place.</p>') +
      (plan.pairings.length ? '<h3 class="sh-dlg-h">Mentor pairings</h3><ul class="shm-plan">' + plan.pairings.map(function (pr, i) {
        return '<li><label><input type="checkbox" data-pr="' + i + '" checked><span class="shm-plan-main"><strong>' + esc(pr.mentee.name) + '</strong> &rarr; <strong>' + esc(pr.mentor.name) + '</strong> <span class="sh-chip">' + (pr.score >= 40 ? 'Strong match' : pr.score >= 15 ? 'Good match' : 'Same Circle') + '</span><small>' + esc(pr.reasons.join(' · ')) + '</small></span></label></li>';
      }).join('') + '</ul>' : '') +
      (plan.unmatched.length ? '<h3 class="sh-dlg-h">Couldn\'t place</h3><ul class="shm-plan">' + plan.unmatched.map(function (u) { return '<li class="is-bad"><span class="shm-plan-main"><strong>' + esc(u.person.name) + '</strong><small>' + esc(u.why) + '</small></span></li>'; }).join('') + '</ul>' : '') +
      '<p class="guide-error" hidden></p><div class="guide-actions"><button type="button" class="btn btn-primary" data-apply' + (plan.moves.length || plan.pairings.length ? '' : ' disabled') + '>Apply selected</button><button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div>', 'sh-dialog--wide');
    dlg.el.querySelector('[data-apply]').addEventListener('click', function (e) {
      var btn = e.currentTarget;
      var err = dlg.el.querySelector('.guide-error');
      var moves = [], pairings = [];
      Array.prototype.forEach.call(dlg.el.querySelectorAll('[data-mv]:checked'), function (cb) { var mv = plan.moves[parseInt(cb.getAttribute('data-mv'), 10)]; moves.push({ user: mv.person.id, circle: mv.circle.id }); });
      Array.prototype.forEach.call(dlg.el.querySelectorAll('[data-pr]:checked'), function (cb) { var pr = plan.pairings[parseInt(cb.getAttribute('data-pr'), 10)]; pairings.push({ mentee: pr.mentee.id, mentor: pr.mentor.id }); });
      // A pairing only makes sense if both are in the same Circle after the moves.
      busy(btn, true, 'Applying…');
      rpc('sankofa_admin_apply_plan', { p_plan: { moves: moves, pairings: pairings } }).then(function (r) {
        dlg.close(); S.toast(r.moved + ' placed, ' + r.paired + ' paired'); return load(true);
      }, function (er) { busy(btn, false); err.textContent = er.message; err.hidden = false; });
    });
  }

  // =======================================================================
  // Events
  // =======================================================================
  root.addEventListener('click', function (e) {
    var t = e.target;
    var el;
    if (t.closest('[data-shm-add]')) { openAdd(); return; }
    if (t.closest('[data-shm-addguest]')) { openGuestForm(null, null); return; }
    if (t.closest('[data-shm-newcircle]')) { openCircleForm(null); return; }
    if (t.closest('[data-shm-suggest]')) { openSuggest(); return; }
    if (t.closest('[data-shm-event]')) { openEventChooser(); return; }
    if (t.closest('[data-shm-history]')) { openHistory(); return; }
    if (t.closest('[data-shm-managers]')) { openManagers(); return; }
    if ((el = t.closest('[data-shm-role]'))) { roleFilter = el.getAttribute('data-shm-role'); render(); return; }
    if (t.closest('[data-shm-selall]')) {
      var vis = data.unplaced.filter(matches);
      var all = vis.length && vis.every(function (p) { return selected[p.id]; });
      vis.forEach(function (p) { if (all) delete selected[p.id]; else selected[p.id] = true; });
      render(); return;
    }
    if (t.closest('[data-shm-placesel]')) { openPlace(selectedIds()); return; }
    if ((el = t.closest('[data-shm-addsel]'))) { bulkMove(selectedIds(), el.getAttribute('data-shm-addsel')); return; }
    if ((el = t.closest('[data-shm-place]'))) { openPlace([el.getAttribute('data-shm-place')]); return; }
    if ((el = t.closest('[data-shm-open]'))) { openCircleDetail(el.getAttribute('data-shm-open')); return; }
    if ((el = t.closest('[data-shm-circle-menu]'))) { openCircleMenu(el.getAttribute('data-shm-circle-menu')); return; }
    if ((el = t.closest('[data-shm-person-menu]'))) { openPersonMenu(el.getAttribute('data-shm-person-menu')); return; }
    if (t.closest('.shm-check')) return;
    if ((el = t.closest('.shm-prow'))) {   // tapping a row ticks it
      var id = el.getAttribute('data-pcard');
      if (selected[id]) delete selected[id]; else selected[id] = true;
      render(); return;
    }
    if ((el = t.closest('.shm-seat[data-pcard]'))) { openPersonMenu(el.getAttribute('data-pcard')); return; }
  });
  root.addEventListener('change', function (e) {
    var tick = e.target.closest && e.target.closest('[data-shm-tick]');
    if (tick) {
      var id = tick.getAttribute('data-shm-tick');
      if (tick.checked) selected[id] = true; else delete selected[id];
      render();
    }
  });
  root.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.shm-prow')) { e.preventDefault(); var id = e.target.getAttribute('data-pcard'); if (selected[id]) delete selected[id]; else selected[id] = true; render(); }
  });
  root.addEventListener('input', function (e) {
    if (e.target.id === 'shm-q') {
      query = e.target.value.trim().toLowerCase();
      var pos = e.target.selectionStart;
      render();
      var q = $('shm-q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (er) { /* fine */ } }
    }
  });

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-open-hub-manager]') && card) card.click();
  });

  // ---- Drag and drop ---------------------------------------------------------------------------------
  root.addEventListener('dragstart', function (e) {
    var c = e.target.closest && e.target.closest('[data-pcard]');
    if (!c) return;
    DRAG = c.getAttribute('data-pcard');
    c.classList.add('is-dragging');
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', DRAG); } catch (er) { /* fine */ }
  });
  root.addEventListener('dragend', function () {
    DRAG = null;
    Array.prototype.forEach.call(root.querySelectorAll('.is-dragging, .is-over'), function (n) { n.classList.remove('is-dragging', 'is-over'); });
  });
  root.addEventListener('dragover', function (e) {
    var lane = e.target.closest && e.target.closest('[data-lane]');
    if (!lane || !DRAG) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch (er) { /* fine */ }
    Array.prototype.forEach.call(root.querySelectorAll('[data-lane].is-over'), function (n) { if (n !== lane) n.classList.remove('is-over'); });
    lane.classList.add('is-over');
  });
  root.addEventListener('dragleave', function (e) {
    var lane = e.target.closest && e.target.closest('[data-lane]');
    if (lane && !lane.contains(e.relatedTarget)) lane.classList.remove('is-over');
  });
  root.addEventListener('drop', function (e) {
    var lane = e.target.closest && e.target.closest('[data-lane]');
    if (!lane || !DRAG) return;
    e.preventDefault();
    var id = DRAG;
    DRAG = null;
    lane.classList.remove('is-over');
    var target = lane.getAttribute('data-lane') || null;
    var c = target ? circleById(target) : null;
    if (c && c.status !== 'active') { S.toast('That Circle is archived', { type: 'err' }); return; }
    // Dragging one of several ticked people takes them all along.
    var ids = selected[id] && selectedIds().length > 1 ? selectedIds() : [id];
    bulkMove(ids, target);
  });

  // =======================================================================
  // Boot: load once the committee page is up, refresh when the section opens
  // =======================================================================
  function visible() { return panel && panel.style.display !== 'none'; }
  supabaseClient.auth.getSession().then(function (r) {
    if (!r.data || !r.data.session) return;
    // The dashboard hides this card for anyone without access; the call itself is checked again in the database.
    setTimeout(function () { if (!card || card.style.display !== 'none') load(); }, 600);
  });
  if (panel && window.MutationObserver) {
    new MutationObserver(function () { if (visible() && Date.now() - lastLoad > 15000) load(true); }).observe(panel, { attributes: true, attributeFilter: ['style'] });
  }
  setInterval(function () { if (visible() && document.visibilityState === 'visible' && Date.now() - lastLoad > 60000 && !document.querySelector('.guide-backdrop')) load(true); }, 30000);
})();
