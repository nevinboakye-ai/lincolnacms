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
    grip: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>'
  };

  // =======================================================================
  // Loading
  // =======================================================================
  function load(quiet) {
    if (loading) return Promise.resolve();
    loading = true;
    return rpc('sankofa_admin_overview').then(function (ov) {
      data = ov;
      lastLoad = Date.now();
      loading = false;
      var c = $('dash-count-sankofahub');
      if (c) c.textContent = ov.stats.participants ? plural(ov.stats.participants, 'person', 'people') + ' · ' + plural(ov.stats.circles, 'Circle') : 'Not started yet';
      render();
    }, function (err) {
      loading = false;
      if (!quiet || !data) {
        root.innerHTML = '<p class="auth-error" style="display:block">' + esc(err.message) + '</p>';
        var c = $('dash-count-sankofahub');
        if (c) { c.textContent = 'Couldn\'t load'; c.style.color = 'var(--accent-red)'; }
      }
    });
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

  function render() {
    var st = data.stats;
    var html =
      '<div class="shm-stats">' +
        stat(st.participants, 'In the Hub') + stat(st.mentees, 'Mentees') + stat(st.mentors, 'Mentors') +
        stat(st.placed, 'In Circles') + stat(data.unplaced.length, 'Unplaced', data.unplaced.length ? 'warn' : '') +
        stat(st.pairings, 'Mentor pairings') + stat(st.upcoming, 'Meetings, next 14 days') + stat(st.need_help, 'Asked for a check-in', st.need_help ? 'bad' : '') +
      '</div>' +
      '<div class="shm-toolbar">' +
        '<button type="button" class="btn btn-primary" data-shm-add>' + ICON.plus + ' Add people</button>' +
        '<button type="button" class="btn btn-outline" data-shm-newcircle>' + ICON.plus + ' New Circle</button>' +
        '<button type="button" class="btn btn-outline" data-shm-suggest>' + ICON.wand + ' Suggest matches</button>' +
        '<button type="button" class="btn btn-outline" data-shm-event>Event or announcement for everyone</button>' +
        '<button type="button" class="btn btn-outline" data-shm-history>' + ICON.log + ' Activity</button>' +
        '<span class="shm-spacer"></span>' +
        '<input type="search" id="shm-q" placeholder="Search people…" aria-label="Search people" value="' + esc(query) + '">' +
        '<div class="sh-seg ui-seg" role="group" aria-label="Show">' + [['all', 'All'], ['mentee', 'Mentees'], ['mentor', 'Mentors']].map(function (r) {
          return '<button type="button" data-shm-role="' + r[0] + '" class="' + (roleFilter === r[0] ? 'is-active' : '') + '">' + r[1] + '</button>';
        }).join('') + '</div>' +
      '</div>';

    if (!st.participants && !data.circles.length) {
      html += '<div class="shm-empty"><h3>Let\'s get the Hub started</h3><ol><li><strong>Create your Circles</strong> - e.g. "Adowa", "Nkyinkyim" - with a colour and a motto.</li><li><strong>Add people</strong> - bring in accepted applicants and your professionals.</li><li><strong>Suggest matches</strong> to fill the Circles, or drag people in yourself.</li></ol>' +
        '<p><button type="button" class="btn btn-primary" data-shm-newcircle>' + ICON.plus + ' Create the first Circle</button></p></div>';
    } else {
      html += '<div class="shm-board" id="shm-board">' + unplacedLane() + activeCircles().map(circleLane).join('') + '</div>';
      var archived = data.circles.filter(function (c) { return c.status !== 'active'; });
      if (archived.length) {
        html += '<details class="shm-archived"><summary>Archived Circles (' + archived.length + ')</summary><div class="shm-board">' + archived.map(circleLane).join('') + '</div></details>';
      }
      html += '<p class="sh-fineprint">Drag a card onto another lane to move that person - or use ' + ICON.dots.replace('class="icon"', 'class="icon sh-icon-inline"') + ' on the card (works on phones too). Sixth-form members are shown by name to you, but appear anonymously to everyone else in the Hub and can only be messaged by the committee.</p>';
    }
    root.innerHTML = html;
    var q = $('shm-q');
    if (q && document.activeElement === document.body && query) { /* keep as is */ }
  }

  function stat(n, label, tone) {
    return '<div class="shm-stat' + (tone ? ' is-' + tone : '') + '"><strong>' + n + '</strong><span>' + esc(label) + '</span></div>';
  }

  function unplacedLane() {
    var list = data.unplaced;
    return '<section class="shm-lane shm-lane--unplaced" data-lane="" aria-label="Unplaced people">' +
      '<header class="shm-lane-head"><div><h3>Unplaced</h3><p>' + (list.length ? plural(list.length, 'person', 'people') + ' waiting for a Circle' : 'Everyone has a Circle 🎉') + '</p></div></header>' +
      '<div class="shm-lane-body" data-drop="">' + (list.length ? list.map(personCard).join('') : '<p class="shm-lane-empty">Drop someone here to take them out of their Circle.</p>') + '</div></section>';
  }

  function circleLane(c) {
    var mentors = c.members.filter(function (m) { return m.role === 'mentor'; }).length;
    var mentees = c.members.length - mentors;
    var over = c.members.length > c.capacity;
    var full = c.members.length >= c.capacity;
    return '<section class="shm-lane sh-theme-' + esc(c.theme) + (c.status !== 'active' ? ' is-archived' : '') + '" data-lane="' + esc(c.id) + '" aria-label="' + esc(c.name) + '">' +
      '<header class="shm-lane-head"><div class="shm-lane-title"><span class="shm-swatch" aria-hidden="true"></span><div><h3>' + esc(c.name) + '</h3>' +
      '<p><span class="' + (over ? 'shm-over' : full ? 'shm-full' : '') + '">' + c.members.length + '/' + c.capacity + '</span> · ' + plural(mentors, 'mentor') + ' · ' + plural(mentees, 'mentee') +
      (c.next_meeting ? ' · next ' + esc(S.fmtDay(c.next_meeting)) : '') + '</p></div></div>' +
      '<button type="button" class="sh-icon-btn" data-shm-circle-menu="' + esc(c.id) + '" aria-label="Options for ' + esc(c.name) + '">' + ICON.dots + '</button></header>' +
      (mentors === 0 && c.members.length ? '<p class="shm-warn">No mentor in this Circle yet</p>' : '') +
      '<div class="shm-lane-body" data-drop="' + esc(c.id) + '">' + (c.members.length ? c.members.map(personCard).join('') : '<p class="shm-lane-empty">Drag people here</p>') + '</div></section>';
  }

  function inactiveDays(p) {
    if (!p.last_active) return Math.floor((Date.now() - new Date(p.joined_at).getTime()) / 86400000);
    return Math.floor((Date.now() - new Date(p.last_active).getTime()) / 86400000);
  }

  function personCard(p) {
    var dim = !matches(p);
    var flags = [];
    if (p.checkin && p.checkin.need_help && (Date.now() - new Date(p.checkin.at).getTime()) < 21 * 86400000) flags.push('<span class="sh-flag" title="Asked for a check-in">Wants a check-in</span>');
    if (p.status !== 'active') flags.push('<span class="sh-chip sh-chip--bad">' + esc(p.status) + '</span>');
    var d = inactiveDays(p);
    if (p.status === 'active' && d >= 21 && (Date.now() - new Date(p.joined_at).getTime()) > 21 * 86400000) flags.push('<span class="sh-chip" title="No activity for ' + d + ' days">Quiet ' + d + 'd</span>');
    if (!p.profile_done) flags.push('<span class="sh-chip" title="Hasn\'t finished their Hub profile">No profile</span>');
    var pairing = '';
    if (p.role === 'mentee') {
      var mentor = p.mentor_id ? personById(p.mentor_id) : null;
      pairing = mentor ? '<span class="shm-pair">Mentor: ' + esc(mentor.name) + '</span>' : '<span class="shm-pair is-none">No mentor paired</span>';
    } else {
      var n = (p.mentee_ids || []).length;
      pairing = '<span class="shm-pair">' + n + (p.capacity != null ? '/' + p.capacity : '') + ' mentee' + (n === 1 ? '' : 's') + '</span>';
    }
    return '<article class="shm-card' + (dim ? ' is-dim' : '') + '" draggable="true" data-pcard="' + esc(p.id) + '" tabindex="0" aria-label="' + esc(p.name) + ', ' + (p.role === 'mentor' ? 'mentor' : 'mentee') + '">' +
      '<span class="shm-grip" aria-hidden="true">' + ICON.grip + '</span>' + S.avatar(p, 'md') +
      '<div class="shm-card-main"><strong>' + esc(p.name) + '</strong>' +
      '<span class="shm-card-sub">' + esc(p.stage || '') + '</span>' +
      '<span class="shm-card-chips"><span class="sh-chip sh-chip--role">' + (p.role === 'mentor' ? 'Mentor' : 'Mentee') + '</span>' + (p.is_lead ? '<span class="sh-chip sh-chip--lead">Lead</span>' : '') +
      (p.sixth_form ? '<span class="sh-chip" title="Shown anonymously to everyone except the committee">Sixth form</span>' : '') + pairing + flags.join('') + '</span></div>' +
      '<button type="button" class="sh-icon-btn" data-shm-person-menu="' + esc(p.id) + '" aria-label="Options for ' + esc(p.name) + '">' + ICON.dots + '</button></article>';
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
    return rpc('sankofa_admin_move', { p_user: userId, p_circle: circleId || null, p_note: note || null }).then(function () {
      var name = p ? p.name : 'Person';
      return load(true).then(function () {
        S.toast(name + ' moved to ' + (to ? to.name : 'Unplaced'), {
          action: { label: 'Undo', fn: function () { rpc('sankofa_admin_move', { p_user: userId, p_circle: from, p_note: 'Undo' }).then(function () { return load(true); }, fail); } }
        });
      });
    }, fail);
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
    var c = p.circle_id ? circleById(p.circle_id) : null;
    var mentors = allPeople().filter(function (x) { return x.role === 'mentor' && x.status === 'active'; });
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
      '<div class="shm-dlg-head">' + S.avatar(p, 'lg') + '<div><span class="guide-eyebrow">' + (p.role === 'mentor' ? 'Mentor' : 'Mentee') + (p.sixth_form ? ' · Sixth form' : '') + '</span><h2 class="guide-title" style="margin:0">' + esc(p.name) + '</h2><p class="sh-muted" style="margin:2px 0 0">' + esc(p.stage || '') + '</p></div></div>' +
      '<dl class="shm-detail">' + detail.map(function (d) { return '<div><dt>' + d[0] + '</dt><dd>' + d[1] + '</dd></div>'; }).join('') + '</dl>' +
      '<div class="guide-form">' +
        '<div class="field"><label for="shm-move">Circle</label><select id="shm-move">' + circleOptions(p.circle_id, true) + '</select></div>' +
        (c ? '<label class="sh-check"><input type="checkbox" id="shm-lead"' + (p.is_lead ? ' checked' : '') + '> <span>Circle lead (shown first, helps run the Circle)</span></label>' : '') +
        (p.role === 'mentee' ? '<div class="field"><label for="shm-mentor">Mentor</label><select id="shm-mentor"><option value="">No mentor paired</option>' + mentors.map(function (m) {
          var load = (m.mentee_ids || []).length;
          return '<option value="' + esc(m.id) + '"' + (p.mentor_id === m.id ? ' selected' : '') + '>' + esc(m.name) + ' (' + load + (m.capacity != null ? '/' + m.capacity : '') + ')' + (m.circle_id === p.circle_id && p.circle_id ? ' - same Circle' : '') + '</option>';
        }).join('') + '</select></div>' : '') +
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
      var mentorEl = $('shm-mentor');
      if (mentorEl && (mentorEl.value || null) !== (p.mentor_id || null)) {
        steps.push(function () { return mentorEl.value ? rpc('sankofa_admin_pair', { p_mentee: p.id, p_mentor: mentorEl.value, p_note: null }) : rpc('sankofa_admin_unpair', { p_mentee: p.id }); });
      }
      if ($('shm-status').value !== p.status) steps.push(function () { return rpc('sankofa_admin_set_status', { p_user: p.id, p_status: $('shm-status').value }); });
      var chain = Promise.resolve();
      steps.forEach(function (s) { chain = chain.then(s); });
      chain.then(function () { dlg.close(); S.toast('Saved'); return load(true); }, function (er) { busy(btn, false); err.textContent = er.message; err.hidden = false; });
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
            (r.sixth_form ? '<span class="sh-chip">Sixth form</span>' : '') + (kind === 'search' ? '<select data-role-for="' + esc(key) + '" aria-label="Add ' + esc(r.name) + ' as"><option value="mentee"' + (role === 'mentee' ? ' selected' : '') + '>as mentee</option><option value="mentor"' + (role === 'mentor' ? ' selected' : '') + '>as mentor</option></select>' : '') +
            '</label></li>';
        }).join('') + '</ul>';
      }
      function draw() {
        var count = Object.keys(picked).length;
        dlg.el.innerHTML = '<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Add people</span><h2 class="guide-title">Bring people into the Hub</h2>' +
          '<div class="sh-seg ui-seg" role="tablist">' + [['mentee', 'Student applicants (' + cand.mentees.length + ')'], ['mentor', 'Professionals (' + cand.mentors.length + ')'], ['search', 'Find anyone']].map(function (t) {
            return '<button type="button" role="tab" data-tab="' + t[0] + '" class="' + (tab === t[0] ? 'is-active' : '') + '" aria-selected="' + (tab === t[0]) + '">' + t[1] + '</button>';
          }).join('') + '</div>' +
          (tab === 'search' ? '<div class="field" style="margin-top:12px"><input type="search" id="shm-find" placeholder="Search members and professionals by name…" aria-label="Search people"></div>' : '') +
          (tab === 'mentee' && cand.mentees.length ? '<p class="sh-muted" style="margin-top:12px"><button type="button" class="link-button" data-all>Select all ' + cand.mentees.length + '</button></p>' : '') +
          '<div class="shm-pick-wrap">' + listFor(tab) + '</div>' +
          (tab === 'mentor' && cand.no_account.length ? '<details class="shm-noacct"><summary>' + plural(cand.no_account.length, 'mentor') + ' applied without an account</summary><p class="sh-muted">They can\'t be added until they have a LACMS account - create one from Dashboard &rarr; Create account, then they\'ll appear in the list above.</p><ul>' + cand.no_account.map(function (n) { return '<li><strong>' + esc(n.name) + '</strong> <small>' + esc([n.job_title, n.organisation, n.email].filter(Boolean).join(' · ')) + '</small></li>'; }).join('') + '</ul></details>' : '') +
          '<p class="sh-muted shm-preview">Want to see the Hub as a member sees it? <button type="button" class="link-button" data-add-me="mentee">Add me as a mentee</button> or <button type="button" class="link-button" data-add-me="mentor">as a mentor</button> (you can remove yourself from your card afterwards).</p>' +
          '<div class="field" style="margin-top:12px"><label for="shm-addto">Place them in</label><select id="shm-addto"><option value="">No Circle yet (Unplaced)</option>' + circleOptions(null, false) + '</select></div>' +
          '<p class="guide-error" hidden></p><div class="guide-actions"><button type="button" class="btn btn-primary" data-do ' + (count ? '' : 'disabled') + '>Add ' + (count ? plural(count, 'person', 'people') : 'selected') + '</button><button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div>' +
          '<p class="guide-fine">Their application answers are carried across for matching, and a pending application is marked accepted.</p>';
      }
      draw();
      var addTo = '';
      dlg.el.addEventListener('click', function (e) {
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
      var ms = c.mentees.filter(function (m) { return !m.mentor_id; });
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
    if (!data.unplaced.length && !allPeople().some(function (p) { return p.role === 'mentee' && !p.mentor_id && p.circle_id; })) {
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
    if (t.closest('[data-shm-newcircle]')) { openCircleForm(null); return; }
    if (t.closest('[data-shm-suggest]')) { openSuggest(); return; }
    if (t.closest('[data-shm-event]')) { openEventChooser(); return; }
    if (t.closest('[data-shm-history]')) { openHistory(); return; }
    if ((el = t.closest('[data-shm-role]'))) { roleFilter = el.getAttribute('data-shm-role'); render(); return; }
    if ((el = t.closest('[data-shm-circle-menu]'))) { openCircleMenu(el.getAttribute('data-shm-circle-menu')); return; }
    if ((el = t.closest('[data-shm-person-menu]'))) { openPersonMenu(el.getAttribute('data-shm-person-menu')); return; }
    if ((el = t.closest('[data-pcard]'))) { openPersonMenu(el.getAttribute('data-pcard')); return; }
  });
  root.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-pcard]')) { e.preventDefault(); openPersonMenu(e.target.getAttribute('data-pcard')); }
  });
  root.addEventListener('input', function (e) {
    if (e.target.id === 'shm-q') {
      query = e.target.value.trim().toLowerCase();
      var pos = e.target.selectionStart;
      render();
      var q = $('shm-q'); q.focus(); try { q.setSelectionRange(pos, pos); } catch (er) { /* fine */ }
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
    Array.prototype.forEach.call(root.querySelectorAll('.shm-lane.is-over'), function (n) { if (n !== lane) n.classList.remove('is-over'); });
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
    var p = personById(id);
    if (p && (p.circle_id || null) !== target) {
      var c = target ? circleById(target) : null;
      if (c && c.status !== 'active') { S.toast('That Circle is archived', { type: 'err' }); return; }
      doMove(id, target);
    }
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
