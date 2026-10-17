// The Sankofa Hub (member-sankofa-hub.html): where accepted Sankofa students
// and professionals live day to day.
//
//   Home      next meeting (RSVP / check in), this week's quests, your mentor
//             or mentees, level, streak, latest from the board
//   My Circle who is in it, their levels, message them, mentors see how
//             everyone is doing
//   Meetings  upcoming and past, RSVP, add to calendar, schedule (mentors),
//             one-to-ones, attendance, feedback
//   Board     posts, announcements, kudos and reactions, live
//   Growth    weekly check-in and personal goals
//   Rewards   XP, level, streak, badges, the Circle Cup
//   People    everyone in the Hub, with a message button
//
// All of the rules (who is in which Circle, who sees whom, XP and badges,
// the sixth-form protections) live in Postgres - migrations 084 to 087. This
// file asks for data, draws it and sends the person's actions. On
// member-hub.html the same file paints the "Sankofa Hub" tile.
(function () {
  'use strict';

  var S = window.lacmsSankofa;
  if (!S) return;
  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;

  var esc = S.esc;
  var rpc = S.rpc;
  var appEl = document.getElementById('sh-app');
  var tileEl = document.getElementById('sankofa-hub-card');
  if (!appEl && !tileEl) return;

  function $(id) { return document.getElementById(id); }

  // =======================================================================
  // The tile on the Members Hub
  // =======================================================================
  if (!appEl) {
    supabaseClient.auth.getSession().then(function (result) {
      if (!result.data || !result.data.session) return;
      return rpc('sankofa_hub_status').then(function (s) {
        if (!s) return;
        var title = tileEl.querySelector('[data-sh-tile-title]');
        var text = tileEl.querySelector('[data-sh-tile-text]');
        var link = tileEl.querySelector('[data-sh-tile-link]');
        var pill = tileEl.querySelector('[data-sh-tile-pill]');
        if (s.participant) {
          tileEl.setAttribute('href', 'member-sankofa-hub.html');
          var lines = [];
          lines.push(s.circle ? 'Your Circle: ' + s.circle : 'Waiting to be placed in a Circle');
          if (s.next_meeting) lines.push('Next: ' + s.next_meeting.title + ' - ' + S.fmtDateTime(s.next_meeting.starts_at));
          text.textContent = lines.join('. ') + '.';
          var bits = [];
          if (s.checkin_due) bits.push('Weekly check-in due');
          if (s.streak > 0) bits.push(s.streak + '-week streak');
          if (!s.profile_done) bits.unshift('Finish your profile');
          if (bits.length) { pill.textContent = bits.join(' · '); pill.hidden = false; }
          tileEl.style.display = '';
        } else if (s.is_admin) {
          tileEl.setAttribute('href', 'president-dashboard.html#sankofahub');
          title.textContent = 'Manage the Sankofa Hub';
          text.textContent = 'Place people in Circles, move them at any time, match mentors and mentees, and see how everyone is getting on.';
          link.firstChild.nodeValue = 'Open Circle manager ';
          tileEl.style.display = '';
        }
      });
    }).catch(function () { /* migrations not run yet - the tile just stays hidden */ });
    return;
  }

  // =======================================================================
  // The Hub page
  // =======================================================================
  var MOOD_EMOJI = ['', '😞', '😕', '😐', '🙂', '😄'];
  var MOOD_LABEL = ['', 'Rough', 'Low', 'Okay', 'Good', 'Great'];
  var XP_LABEL = {
    profile: 'Completed your profile', rsvp: 'Replied to a meeting', attend: 'Attended a meeting',
    checkin: 'Weekly check-in', goal_done: 'Finished a goal', post: 'Posted on the board',
    kudos: 'Received kudos', host: 'Scheduled a meeting', feedback: 'Gave feedback', hello: 'Said hello'
  };
  var KIND_LABEL = { circle: 'Circle meeting', one_to_one: 'One-to-one', checkin: 'Check-in', social: 'Social', workshop: 'Workshop', all: 'Everyone' };
  var COMM_LABEL = { casual: 'Casual chats', structured: 'Structured catch-ups', mix: 'A mix of both' };
  var FREQ_LABEL = { weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly' };
  var REACTIONS = [['clap', '👏', 'Clap'], ['heart', '❤️', 'Love'], ['fire', '🔥', 'Fire'], ['bulb', '💡', 'Insightful']];
  var TABS = ['home', 'circle', 'meetings', 'board', 'growth', 'rewards', 'people'];

  var st = {
    uid: null, ov: null, tab: 'home',
    feed: null, feedEnd: false,
    upcoming: null, past: null,
    goals: null, hist: null,
    people: null, lb: null,
    peopleFilter: 'all', peopleQuery: '',
    showDone: false,
    lastLevel: null
  };

  var ICON = {
    pin: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-5.6-7-11a7 7 0 0 1 14 0c0 5.4-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    video: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-3v10l-6-3z"/></svg>',
    chat: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    cal: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>',
    flame: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c1 3.5-1.5 5-1.5 7.5 0 1.2.8 2 1.8 2 1.3 0 2.2-1.1 2.2-2.4 2 1.6 3.5 3.9 3.5 6.4A6 6 0 0 1 6 15.5c0-3 1.7-4.6 3-6.5C10.600 7.200 12 5.500 12 2z"/></svg>',
    check: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12.500 10 17.500 19 7.500"/></svg>',
    plus: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    dots: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    lock: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>'
  };

  function isMentor() { return st.ov && st.ov.me && st.ov.me.role === 'mentor'; }
  function isAdmin() { return st.ov && st.ov.is_admin; }
  function themeOf(c) { return 'sh-theme-' + ((c && c.theme) || 'gold'); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function setHtml(id, html) { var el = $(id); if (el) el.innerHTML = html; }
  function linkify(text) {
    return esc(text).replace(/(https?:\/\/[^\s<]+)/g, function (u) {
      var trail = (u.match(/[.,;:!?)]+$/) || [''])[0];
      var url = trail ? u.slice(0, -trail.length) : u;
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>' + trail;
    }).replace(/\n/g, '<br>');
  }
  function showError(msg) {
    var err = $('hub-error');
    if (!err) return;
    err.textContent = msg;
    err.style.display = 'block';
  }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.disabled = true; btn.setAttribute('data-label', btn.textContent); if (label) btn.textContent = label; }
    else { btn.disabled = false; if (btn.getAttribute('data-label')) btn.textContent = btn.getAttribute('data-label'); }
  }
  function fail(err) { S.toast(err && err.message ? err.message : 'Something went wrong', { type: 'err' }); }

  // =======================================================================
  // Boot
  // =======================================================================
  var gate = $('auth-gate');

  function showClosed(html) {
    if (gate) gate.style.display = 'none';
    var box = $('sh-closed');
    box.innerHTML = html;
    box.style.display = '';
  }

  supabaseClient.auth.getSession().then(function (result) {
    var session = result.data && result.data.session;
    if (!session) { window.location.href = 'member-login.html'; return; }
    st.uid = session.user.id;
    load().then(function () { start(); }, function (err) {
      if (gate) gate.style.display = 'none';
      showError(err.message);
    });
  });

  function load() {
    return rpc('sankofa_hub_overview').then(function (ov) {
      st.ov = ov;
    });
  }

  function start() {
    var ov = st.ov;
    if (!ov.participant) {
      showClosed(
        '<span class="sh-closed-icon" aria-hidden="true">' + ICON.lock + '</span>' +
        '<h2>You\'re not in the Sankofa Hub yet</h2>' +
        '<p>The Hub is for people who have been accepted into Sankofa - mentees and mentors. Once the committee adds you, your Circle, mentor and meetings will all appear here.</p>' +
        '<div class="sh-closed-actions"><a class="btn btn-primary" href="member-sankofa.html">About Sankofa &amp; applying</a>' +
        (ov.is_admin ? '<a class="btn btn-outline" href="president-dashboard.html#sankofahub">Open the Circle manager</a>' : '') +
        '<a class="btn btn-outline" href="member-hub.html">Back to the Members Hub</a></div>');
      return;
    }
    if (ov.status !== 'active') {
      showClosed(
        '<span class="sh-closed-icon" aria-hidden="true">' + ICON.lock + '</span>' +
        '<h2>Your Hub access is ' + esc(ov.status === 'paused' ? 'paused' : 'now closed') + '</h2>' +
        '<p>' + (ov.status === 'paused'
          ? 'The committee has paused your place for now. Get in touch at <a href="mailto:acms@lincolnsu.com">acms@lincolnsu.com</a> if you think that\'s a mistake.'
          : 'Thank you for being part of Sankofa. Your progress is saved if you return.') + '</p>' +
        '<div class="sh-closed-actions"><a class="btn btn-outline" href="member-hub.html">Back to the Members Hub</a></div>');
      return;
    }
    if (gate) gate.style.display = 'none';
    appEl.style.display = '';
    try { st.lastLevel = parseInt(localStorage.getItem('sh-level-' + st.uid), 10) || null; } catch (e) { st.lastLevel = null; }
    wireEvents();
    renderAll();
    var initial = (window.location.hash || '').replace('#', '');
    showTab(TABS.indexOf(initial) !== -1 ? initial : 'home', true);
    window.addEventListener('hashchange', function () {
      var h = (window.location.hash || '').replace('#', '');
      if (TABS.indexOf(h) !== -1 && h !== st.tab) showTab(h, true);
    });
    loadFeed(true).then(function () { if (st.tab === 'home') renderHome(); });
    sync(true);
    startRealtime();
    setInterval(tick, 30000);
    if (!ov.me.welcomed) setTimeout(openWelcome, 500);
  }

  // Awards "said hello" XP and badges, then celebrates anything new.
  function sync(silent) {
    return rpc('sankofa_sync').then(function (res) {
      if (!res || !res.progress) return;
      var before = st.ov.progress ? st.ov.progress.xp : res.progress.xp;
      st.ov.progress = res.progress;
      renderTop();
      if (st.tab === 'home') renderHome();
      if (st.tab === 'rewards') renderRewards();
      var gained = res.progress.xp - before;
      if (gained > 0 && !silent) S.toast('+' + gained + ' XP', {});
      var lvl = res.progress.level;
      if (st.lastLevel && lvl > st.lastLevel) celebrateLevel(lvl);
      st.lastLevel = lvl;
      try { localStorage.setItem('sh-level-' + st.uid, String(lvl)); } catch (e) { /* fine */ }
      if (res.new_badges && res.new_badges.length) celebrateBadges(res.new_badges);
    }, function () { /* sync is a bonus - the page works without it */ });
  }

  // Celebrations wait their turn if another dialog is already open.
  function whenFree(fn, tries) {
    if (!document.querySelector('.guide-backdrop') || (tries || 0) > 12) { fn(); return; }
    setTimeout(function () { whenFree(fn, (tries || 0) + 1); }, 1200);
  }

  function celebrateLevel(lvl) {
    whenFree(function () { drawLevelUp(lvl); });
  }
  function drawLevelUp(lvl) {
    var dlg = S.openDialog(
      '<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button>' +
      '<div class="sh-celebrate"><div class="sh-celebrate-ring" aria-hidden="true">' + lvl + '</div>' +
      '<span class="guide-eyebrow">Level up</span><h2 class="guide-title">You\'re now level ' + lvl + ' - ' + esc(S.levelTitle(lvl)) + '</h2>' +
      '<p class="guide-text">Keep showing up for your Circle - every check-in, meeting and goal grows you.</p>' +
      '<div class="guide-actions"><button type="button" class="btn btn-primary" data-dialog-close data-autofocus>Keep going</button></div></div>');
    S.confetti(dlg.el);
  }

  function celebrateBadges(list) {
    whenFree(function () { drawBadges(list); });
  }
  function drawBadges(list) {
    var html = list.map(function (b) {
      return '<li class="sh-celebrate-badge"><span class="sh-badge-ico" aria-hidden="true">' + esc(b.icon) + '</span><span><strong>' + esc(b.name) + '</strong><br><small>' + esc(b.description) + '</small></span></li>';
    }).join('');
    var dlg = S.openDialog(
      '<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button>' +
      '<div class="sh-celebrate"><span class="guide-eyebrow">' + (list.length === 1 ? 'Badge unlocked' : list.length + ' badges unlocked') + '</span>' +
      '<h2 class="guide-title">Nice work!</h2><ul class="sh-celebrate-list">' + html + '</ul>' +
      '<div class="guide-actions"><button type="button" class="btn btn-primary" data-dialog-close data-autofocus>Brilliant</button>' +
      '<button type="button" class="btn btn-outline" data-dialog-close data-sh-goto="rewards">See all badges</button></div></div>');
    S.confetti(dlg.el);
  }

  // =======================================================================
  // Tabs
  // =======================================================================
  function showTab(name, fromHash) {
    if (TABS.indexOf(name) === -1) name = 'home';
    st.tab = name;
    TABS.forEach(function (t) {
      var btn = $('sh-tab-btn-' + t);
      var pane = $('sh-pane-' + t);
      var on = t === name;
      if (btn) { btn.classList.toggle('is-active', on); btn.setAttribute('aria-selected', on ? 'true' : 'false'); btn.tabIndex = on ? 0 : -1; }
      if (pane) pane.hidden = !on;
    });
    if (!fromHash) {
      try { window.history.replaceState(null, '', '#' + name); } catch (e) { /* fine */ }
    }
    var dot = $('sh-dot-' + name);
    if (dot) dot.hidden = true;
    var active = $('sh-tab-btn-' + name);
    if (active && active.scrollIntoView && active.parentNode.scrollWidth > active.parentNode.clientWidth) {
      try { active.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) { /* fine */ }
    }
    if (name === 'home') renderHome();
    if (name === 'circle') renderCircle();
    if (name === 'meetings') loadMeetings();
    if (name === 'board') { renderBoard(); if (st.feed === null) loadFeed(true).then(renderBoard); }
    if (name === 'growth') loadGrowth();
    if (name === 'rewards') loadRewards();
    if (name === 'people') loadPeople();
  }

  function renderAll() {
    renderTop();
    renderHome();
  }

  // =======================================================================
  // Header: who I am, my level
  // =======================================================================
  function ring(p, size) {
    var span = Math.max(p.next_floor - p.level_floor, 1);
    var pct = Math.min(Math.max((p.xp - p.level_floor) / span, 0), 1);
    var r = 26, c = 2 * Math.PI * r;
    return '<span class="sh-ring sh-ring--' + (size || 'md') + '" role="img" aria-label="Level ' + p.level + ', ' + p.xp + ' XP">' +
      '<svg viewBox="0 0 64 64" aria-hidden="true"><circle class="sh-ring-bg" cx="32" cy="32" r="' + r + '"/>' +
      '<circle class="sh-ring-fg" cx="32" cy="32" r="' + r + '" stroke-dasharray="' + (c * pct).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 32 32)"/></svg>' +
      '<span class="sh-ring-num">' + p.level + '</span></span>';
  }

  function renderTop() {
    var ov = st.ov, me = ov.me, p = ov.progress, c = ov.circle;
    var role = me.role === 'mentor' ? 'Mentor' : 'Mentee';
    var sub = [role, me.stage].filter(Boolean).join(' · ');
    var html =
      '<div class="sh-top-main ' + (c ? themeOf(c) : 'sh-theme-gold') + '">' +
        (p ? ring(p) : S.avatar(me, 'lg')) +
        '<div class="sh-top-text">' +
          '<h2 class="sh-hello">' + greeting() + ', ' + esc(S.greetName(me.name)) + '</h2>' +
          '<p class="sh-sub">' + esc(sub) + (c ? ' · <strong>' + esc(c.name) + '</strong>' : '') + '</p>' +
          (p ? '<p class="sh-top-chips"><span class="sh-chip sh-chip--level" title="' + p.xp + ' XP in total">Level ' + p.level + ' · ' + esc(S.levelTitle(p.level)) + '</span>' +
            (p.streak > 0 ? '<span class="sh-chip sh-chip--streak" title="Weeks in a row you\'ve taken part">' + ICON.flame + p.streak + '-week streak</span>' : '') +
            '<span class="sh-chip">' + p.xp + ' XP</span></p>' : '') +
        '</div>' +
      '</div>' +
      '<div class="sh-top-actions">' +
        '<button type="button" class="btn btn-outline" data-sh-edit-profile>' + (me.profile_done ? 'Edit profile' : 'Finish your profile') + '</button>' +
        (ov.is_admin ? '<a class="btn btn-outline" href="president-dashboard.html#sankofahub">Manage Circles</a>' : '') +
      '</div>';
    setHtml('sh-top', html);
  }
  function greeting() {
    var h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }

  // =======================================================================
  // Home
  // =======================================================================
  function nextMeeting() {
    var list = st.ov.upcoming || [];
    for (var i = 0; i < list.length; i++) if (!list[i].cancelled) return list[i];
    return null;
  }

  function renderHome() {
    if (st.tab !== 'home') return;
    var ov = st.ov;
    var left = [], right = [];

    if (!ov.me.profile_done) {
      left.push('<div class="sh-card sh-card--prompt"><div><h3>Introduce yourself</h3><p>Add a headline and a short intro so your Circle gets to know you - and earn <strong>+20 XP</strong>.</p></div>' +
        '<button type="button" class="btn btn-primary" data-sh-edit-profile>Write my intro</button></div>');
    }
    if (!ov.circle) {
      left.push('<div class="sh-card sh-card--wait"><h3>Waiting for your Circle</h3><p>The committee is matching you into a Circle. You\'ll see it here as soon as you\'re placed - we\'ll let you know. In the meantime you can finish your profile, set a goal and browse the mentors in <button type="button" class="link-button" data-sh-goto="people">People</button>.</p></div>');
    }
    left.push(nextCard());
    left.push(questsCard());
    left.push(mentorCard());
    left.push(latestBoardCard());

    right.push(levelCard());
    right.push(badgeStrip());
    right.push(circleSnapshot());

    setHtml('sh-pane-home', '<div class="sh-grid"><div class="sh-col sh-col--main">' + left.join('') + '</div><div class="sh-col sh-col--side">' + right.join('') + '</div></div>');
  }

  function nextCard() {
    var m = nextMeeting();
    var list = (st.ov.upcoming || []).filter(function (x) { return !x.cancelled && (!m || x.id !== m.id); }).slice(0, 2);
    if (!m) {
      return '<div class="sh-card sh-card--empty"><h3>Next meeting</h3><p>Nothing in the diary yet. When your Circle\'s mentors schedule a meeting it\'ll appear here with a countdown.' +
        (isMentor() && st.ov.circle ? ' <button type="button" class="link-button" data-sh-new-meeting>Schedule one now</button>.' : '') + '</p></div>';
    }
    return '<div class="sh-card sh-card--next ' + themeOf(m.circle_id ? m : st.ov.circle) + '">' +
      '<span class="sh-eyebrow">Next up</span>' +
      meetingInner(m, { big: true }) +
      (list.length ? '<div class="sh-then"><span class="sh-then-label">Then</span>' + list.map(function (x) {
        return '<button type="button" class="sh-then-item" data-sh-goto="meetings"><strong>' + esc(x.title) + '</strong><span>' + esc(S.fmtDateTime(x.starts_at)) + '</span></button>';
      }).join('') + '</div>' : '') +
      '</div>';
  }

  function questsCard() {
    var ov = st.ov, w = ov.week;
    var quests = [];
    if (!ov.me.profile_done) quests.push({ done: false, text: 'Write your intro', xp: 20, tab: null, profile: true });
    quests.push({ done: !!w.checkin, text: 'Do your weekly check-in', xp: 15, tab: 'growth' });
    quests.push({ done: w.unanswered === 0, text: w.unanswered > 0 ? 'Reply to ' + plural(w.unanswered, 'meeting') : 'Reply to upcoming meetings', xp: 3, tab: 'meetings' });
    quests.push({ done: w.posts_week > 0, text: 'Say something on the board', xp: 3, tab: 'board' });
    quests.push({ done: w.goals_done_week > 0, text: w.open_goals === 0 && w.goals_done_week === 0 ? 'Set a goal for yourself' : 'Finish a goal', xp: 15, tab: 'growth' });
    var done = quests.filter(function (q) { return q.done; }).length;
    var pct = Math.round(done / quests.length * 100);
    return '<div class="sh-card"><div class="sh-card-head"><h3>This week</h3><span class="sh-muted">' + done + ' of ' + quests.length + ' done</span></div>' +
      '<div class="sh-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><span style="width:' + pct + '%"></span></div>' +
      '<ul class="sh-quests">' + quests.map(function (q) {
        var attr = q.profile ? 'data-sh-edit-profile' : 'data-sh-goto="' + q.tab + '"';
        return '<li class="' + (q.done ? 'is-done' : '') + '"><button type="button" class="sh-quest" ' + attr + (q.done ? ' aria-label="' + esc(q.text) + ' - done"' : '') + '>' +
          '<span class="sh-quest-tick" aria-hidden="true">' + (q.done ? ICON.check : '') + '</span>' +
          '<span class="sh-quest-text">' + esc(q.text) + '</span><span class="sh-quest-xp">+' + q.xp + ' XP</span></button></li>';
      }).join('') + '</ul></div>';
  }

  function personRow(p, extra) {
    return '<div class="sh-person-row">' + S.avatar(p, 'md') +
      '<div class="sh-person-text"><strong>' + esc(p.name) + '</strong><span>' + esc([p.stage, p.specialty].filter(Boolean).join(' · ')) + '</span></div>' +
      (extra || '') + '</div>';
  }
  function msgBtn(p) {
    if (!p.can_message) {
      return '<button type="button" class="btn btn-outline sh-btn-sm" disabled title="' + (p.sixth_form ? 'Sixth-form members can only be messaged by the committee' : 'Messaging isn\'t available with this person') + '">Message</button>';
    }
    return '<button type="button" class="btn btn-outline sh-btn-sm" data-sh-msg="' + esc(p.id) + '">' + ICON.chat + ' Message</button>';
  }

  function mentorCard() {
    var ov = st.ov;
    if (isMentor()) {
      var list = ov.my_mentees || [];
      if (!list.length) {
        return '<div class="sh-card"><h3>My mentees</h3><p class="sh-muted">No one is paired with you one-to-one yet. Your Circle\'s mentees are in <button type="button" class="link-button" data-sh-goto="circle">My Circle</button>.</p></div>';
      }
      return '<div class="sh-card"><div class="sh-card-head"><h3>My mentees</h3><span class="sh-muted">' + plural(list.length, 'mentee') + '</span></div>' +
        list.map(function (m) {
          return '<div class="sh-person-card">' + personRow(m, m.need_help ? '<span class="sh-flag" title="Asked for a check-in">Wants a check-in</span>' : '') +
            '<div class="sh-person-actions">' + msgBtn(m) +
            '<button type="button" class="btn btn-outline sh-btn-sm" data-sh-snapshot="' + esc(m.id) + '">Progress</button>' +
            '<button type="button" class="btn btn-outline sh-btn-sm" data-sh-new-121="' + esc(m.pairing_id) + '" data-name="' + esc(m.name) + '">' + ICON.cal + ' 1:1</button></div></div>';
        }).join('') + '</div>';
    }
    var mentor = ov.my_mentor;
    if (mentor) {
      return '<div class="sh-card"><div class="sh-card-head"><h3>My mentor</h3></div>' +
        '<div class="sh-person-card">' + personRow(mentor) +
        (mentor.headline ? '<p class="sh-quote">&ldquo;' + esc(mentor.headline) + '&rdquo;</p>' : '') +
        ((mentor.offers && mentor.offers.length) ? '<p class="sh-tags">' + mentor.offers.slice(0, 4).map(function (o) { return '<span class="sh-tag">' + esc(o) + '</span>'; }).join('') + '</p>' : '') +
        '<div class="sh-person-actions">' + msgBtn(mentor) +
        '<button type="button" class="btn btn-outline sh-btn-sm" data-sh-new-121="' + esc(mentor.pairing_id) + '" data-name="' + esc(mentor.name) + '">' + ICON.cal + ' Book a 1:1</button></div></div></div>';
    }
    var mentors = (ov.members || []).filter(function (m) { return m.role === 'mentor' && !m.is_me; });
    if (!ov.circle) return '';
    return '<div class="sh-card"><h3>Your mentors</h3>' + (mentors.length
      ? '<p class="sh-muted">You haven\'t been paired one-to-one yet - these are your Circle\'s mentors.</p>' + mentors.map(function (m) {
          return '<div class="sh-person-card">' + personRow(m, msgBtn(m)) + '</div>';
        }).join('')
      : '<p class="sh-muted">Mentors will appear here once your Circle has them.</p>') + '</div>';
  }

  function latestBoardCard() {
    if (!st.ov.circle && !(st.feed && st.feed.length)) return '';
    var posts = (st.feed || []).slice(0, 3);
    return '<div class="sh-card"><div class="sh-card-head"><h3>From the board</h3><button type="button" class="link-button" data-sh-goto="board">Open board</button></div>' +
      (posts.length ? posts.map(function (p) {
        return '<div class="sh-mini-post"><div class="sh-mini-head">' + S.avatar(p.author, 'sm') + '<strong>' + esc(p.author.name) + '</strong>' +
          (p.kind === 'announcement' ? '<span class="sh-chip sh-chip--ann">Announcement</span>' : '') +
          '<span class="sh-muted">' + esc(S.timeAgo(p.created_at)) + '</span></div><p>' + esc(p.body.length > 160 ? p.body.slice(0, 157) + '…' : p.body) + '</p></div>';
      }).join('') : '<p class="sh-muted">Nothing posted yet - be the first to say hello to your Circle.</p>') + '</div>';
  }

  function levelCard() {
    var p = st.ov.progress;
    if (!p) return '';
    var toNext = p.next_floor - p.xp;
    return '<div class="sh-card sh-card--level">' + ring(p, 'lg') +
      '<div><h3>Level ' + p.level + ' · ' + esc(S.levelTitle(p.level)) + '</h3>' +
      '<p class="sh-muted">' + toNext + ' XP to level ' + (p.level + 1) + '</p></div>' +
      '<dl class="sh-stats"><div><dt>This week</dt><dd>+' + (p.xp_week || 0) + ' XP</dd></div>' +
      '<div><dt>Streak</dt><dd>' + (p.streak > 0 ? ICON.flame + ' ' + p.streak + 'w' : '-') + '</dd></div>' +
      '<div><dt>Best</dt><dd>' + (p.best_streak || 0) + 'w</dd></div></dl>' +
      ((p.recent && p.recent.length) ? '<ul class="sh-recent">' + p.recent.slice(0, 4).map(function (r) {
        return '<li><strong>+' + r.points + '</strong><span>' + esc(XP_LABEL[r.kind] || r.kind) + '</span><time>' + esc(S.timeAgo(r.at)) + '</time></li>';
      }).join('') + '</ul>' : '') + '</div>';
  }

  function badgeStrip() {
    var p = st.ov.progress;
    if (!p) return '';
    var earned = p.badges.filter(function (b) { return b.earned; });
    return '<div class="sh-card"><div class="sh-card-head"><h3>Badges</h3><button type="button" class="link-button" data-sh-goto="rewards">' + earned.length + ' of ' + p.badges.length + '</button></div>' +
      (earned.length
        ? '<p class="sh-badge-row">' + earned.slice(-8).reverse().map(function (b) { return '<span class="sh-badge-ico" title="' + esc(b.name + ' - ' + b.description) + '">' + esc(b.icon) + '</span>'; }).join('') + '</p>'
        : '<p class="sh-muted">Take part to earn your first badge - finish your profile for "First steps".</p>') + '</div>';
  }

  function circleSnapshot() {
    var ov = st.ov;
    if (!ov.circle) return '';
    var members = ov.members || [];
    return '<div class="sh-card ' + themeOf(ov.circle) + ' sh-card--circle"><span class="sh-eyebrow">Your Circle</span><h3>' + esc(ov.circle.name) + '</h3>' +
      (ov.circle.motto ? '<p class="sh-quote">&ldquo;' + esc(ov.circle.motto) + '&rdquo;</p>' : '') +
      '<div class="sh-av-stack" aria-label="' + plural(members.length, 'member') + '">' + members.slice(0, 7).map(function (m) { return S.avatar(m, 'sm'); }).join('') +
      (members.length > 7 ? '<span class="sh-av sh-av--sm sh-av--more">+' + (members.length - 7) + '</span>' : '') + '</div>' +
      '<p class="sh-muted">' + plural(members.length, 'member') + '</p>' +
      '<button type="button" class="btn btn-outline sh-btn-sm" data-sh-goto="circle">Meet your Circle</button></div>';
  }

  // =======================================================================
  // Circle
  // =======================================================================
  function renderCircle() {
    if (st.tab !== 'circle') return;
    var ov = st.ov, c = ov.circle;
    if (!c) {
      setHtml('sh-pane-circle', '<div class="sh-card sh-card--wait"><h3>You haven\'t been placed in a Circle yet</h3><p>A Circle is a small group that spans every stage - from sixth-form to senior doctor - who meet termly and look out for each other. The committee places everyone; you\'ll see your Circle here as soon as you\'re in one.</p></div>');
      return;
    }
    var members = ov.members || [];
    var mentors = members.filter(function (m) { return m.role === 'mentor'; });
    var others = members.filter(function (m) { return m.role !== 'mentor'; });
    var needHelp = members.filter(function (m) { return m.care && m.care.need_help; }).length;
    var html = '<div class="sh-circle-banner ' + themeOf(c) + '">' +
      '<div><span class="sh-eyebrow">Your Circle' + (c.academic_year ? ' · ' + esc(c.academic_year) : '') + '</span><h2>' + esc(c.name) + '</h2>' +
      (c.motto ? '<p class="sh-quote">&ldquo;' + esc(c.motto) + '&rdquo;</p>' : '') +
      (c.description ? '<p>' + esc(c.description) + '</p>' : '') + '</div>' +
      '<div class="sh-banner-actions">' +
        (c.group_link ? '<a class="btn btn-primary" href="' + esc(c.group_link) + '" target="_blank" rel="noopener noreferrer">Open Circle group chat</a>' : '') +
        '<button type="button" class="btn btn-outline" data-sh-goto="board">Circle board</button>' +
      '</div></div>';
    if ((isMentor() || isAdmin()) && needHelp) {
      html += '<div class="sh-alert">' + needHelp + (needHelp === 1 ? ' member has' : ' members have') + ' asked for a check-in this month. Reach out - a quick message goes a long way.</div>';
    }
    html += '<h3 class="sh-section-title">Mentors <span class="sh-muted">' + mentors.length + '</span></h3><div class="sh-members">' + (mentors.length ? mentors.map(memberCard).join('') : '<p class="sh-muted">No mentors in this Circle yet.</p>') + '</div>';
    html += '<h3 class="sh-section-title">Mentees <span class="sh-muted">' + others.length + '</span></h3><div class="sh-members">' + (others.length ? others.map(memberCard).join('') : '<p class="sh-muted">No mentees in this Circle yet.</p>') + '</div>';
    html += '<p class="sh-fineprint">Sixth-form members are shown without a name and can only be messaged by the committee - that keeps them safe.</p>';
    setHtml('sh-pane-circle', html);
  }

  function lastActiveText(care) {
    if (!care || !care.last_active) return 'No activity yet';
    return 'Active ' + S.timeAgo(care.last_active);
  }

  function memberCard(m) {
    var care = m.care;
    var moodHtml = care && care.mood ? '<span class="sh-mood" title="Latest check-in: ' + esc(MOOD_LABEL[care.mood]) + '">' + MOOD_EMOJI[care.mood] + '</span>' : '';
    return '<article class="sh-member' + (m.is_me ? ' is-me' : '') + (m.blurred ? ' is-blurred' : '') + '">' +
      '<div class="sh-member-top">' + S.avatar(m, 'lg') +
      '<div class="sh-member-id"><h4>' + esc(m.name) + (m.is_me ? ' <span class="sh-chip">You</span>' : '') + '</h4>' +
      '<p>' + esc(m.stage || '') + '</p>' +
      '<p class="sh-member-chips">' + (m.is_lead ? '<span class="sh-chip sh-chip--lead">Circle lead</span>' : '') +
      '<span class="sh-chip sh-chip--role">' + (m.role === 'mentor' ? 'Mentor' : 'Mentee') + '</span>' +
      (m.level ? '<span class="sh-chip">Lv ' + m.level + '</span>' : '') +
      (m.streak > 0 ? '<span class="sh-chip sh-chip--streak">' + ICON.flame + m.streak + 'w</span>' : '') +
      (care && care.need_help ? '<span class="sh-flag">Wants a check-in</span>' : '') + '</p></div>' + moodHtml + '</div>' +
      (m.headline ? '<p class="sh-quote">&ldquo;' + esc(m.headline) + '&rdquo;</p>' : '') +
      (care ? '<p class="sh-muted sh-member-active">' + esc(lastActiveText(care)) + '</p>' : '') +
      (m.is_me ? '' : '<div class="sh-person-actions">' + msgBtn(m) +
        ((isMentor() || isAdmin()) && m.role !== 'mentor' && !m.blurred ? '<button type="button" class="btn btn-outline sh-btn-sm" data-sh-snapshot="' + esc(m.id) + '">Progress</button>' : '') + '</div>') +
      '</article>';
  }

  function openSnapshot(userId) {
    var dlg = S.openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Progress</span><h2 class="guide-title">Loading…</h2>');
    rpc('sankofa_member_snapshot', { p_user: userId }).then(function (s) {
      var goals = s.goals || [], checks = s.checkins || [];
      dlg.el.innerHTML = '<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button>' +
        '<span class="guide-eyebrow">Progress</span><h2 class="guide-title">' + esc(s.person.name) + '</h2>' +
        '<p class="guide-text">' + esc(s.person.stage || '') + ' · ' + s.xp + ' XP · attended ' + plural(s.attended, 'meeting') + ' · ' + esc(s.last_active ? 'active ' + S.timeAgo(s.last_active) : 'no activity yet') + '</p>' +
        '<h3 class="sh-dlg-h">Weekly check-ins</h3>' + (checks.length ? '<ul class="sh-snap-list">' + checks.map(function (c) {
          return '<li><span class="sh-mood">' + MOOD_EMOJI[c.mood] + '</span><div><strong>Week of ' + esc(S.fmtDay(c.week_start)) + '</strong>' + (c.need_help ? ' <span class="sh-flag">Wants a check-in</span>' : '') +
            (c.win ? '<br><small>Win: ' + esc(c.win) + '</small>' : '') + (c.challenge ? '<br><small>Challenge: ' + esc(c.challenge) + '</small>' : '') + '</div></li>';
        }).join('') + '</ul>' : '<p class="sh-muted">No check-ins yet.</p>') +
        '<h3 class="sh-dlg-h">Goals they\'ve shared</h3>' + (goals.length ? '<ul class="sh-snap-list">' + goals.map(function (g) {
          return '<li><span class="sh-quest-tick' + (g.done ? ' is-on' : '') + '" aria-hidden="true">' + (g.done ? ICON.check : '') + '</span><div><strong>' + esc(g.title) + '</strong>' +
            (g.due_date ? '<br><small>Due ' + esc(S.fmtDay(g.due_date)) + '</small>' : '') + '</div></li>';
        }).join('') + '</ul>' : '<p class="sh-muted">No shared goals.</p>') +
        '<div class="guide-actions"><button type="button" class="btn btn-primary" data-sh-msg-person="' + esc(s.person.id) + '" data-name="' + esc(s.person.name) + '">Message</button><button type="button" class="btn btn-outline" data-dialog-close>Close</button></div>';
    }, function (err) {
      dlg.el.innerHTML = '<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><h2 class="guide-title">Couldn\'t load</h2><p class="guide-text">' + esc(err.message) + '</p>';
    });
  }

  // =======================================================================
  // Meetings
  // =======================================================================
  function kindChip(m) {
    return '<span class="sh-chip">' + esc(KIND_LABEL[m.kind] || 'Meeting') + '</span>' + (m.circle_name && m.kind !== 'one_to_one' ? '<span class="sh-chip sh-chip--circle ' + themeOf(m) + '">' + esc(m.circle_name) + '</span>' : '');
  }

  function meetingInner(m, opts) {
    opts = opts || {};
    var d = new Date(m.starts_at);
    var end = m.ends_at ? '–' + S.fmtTime(m.ends_at) : '';
    var where = m.location ? '<span class="sh-where">' + ICON.pin + esc(m.location) + '</span>' : '';
    var online = m.online_link ? '<a class="sh-where sh-where--link" href="' + esc(m.online_link) + '" target="_blank" rel="noopener noreferrer">' + ICON.video + 'Join online</a>' : '';
    var title = m.kind === 'one_to_one' && m.with_person ? m.title + ' with ' + S.firstName(m.with_person.name) : m.title;
    var rsvp = '';
    if (!m.ended && !m.cancelled) {
      rsvp = '<div class="sh-rsvp" role="group" aria-label="Will you come?">' +
        [['going', 'Going'], ['maybe', 'Maybe'], ['no', 'Can\'t make it']].map(function (o) {
          return '<button type="button" class="sh-rsvp-btn' + (m.my_response === o[0] ? ' is-on is-' + o[0] : '') + '" data-sh-rsvp="' + esc(m.id) + '" data-resp="' + o[0] + '" aria-pressed="' + (m.my_response === o[0]) + '">' + o[1] + '</button>';
        }).join('') + '</div>';
    }
    var actions = [];
    if (m.checkin_open && !m.my_attended) actions.push('<button type="button" class="btn btn-primary sh-btn-sm sh-btn-pulse" data-sh-checkin="' + esc(m.id) + '">I\'m here - check in</button>');
    if (m.my_attended) actions.push('<span class="sh-chip sh-chip--ok">' + ICON.check + ' You were there</span>');
    if (m.ended && !m.cancelled && !m.feedback_given && (m.my_attended || m.my_response === 'going')) actions.push('<button type="button" class="btn btn-outline sh-btn-sm" data-sh-feedback="' + esc(m.id) + '">Rate this meeting</button>');
    if (m.ended && m.feedback_given) actions.push('<span class="sh-chip">Thanks for your feedback</span>');
    if (!m.cancelled && !m.ended) actions.push('<button type="button" class="btn btn-outline sh-btn-sm" data-sh-ics="' + esc(m.id) + '">' + ICON.cal + ' Add to calendar</button>');
    actions.push('<button type="button" class="btn btn-outline sh-btn-sm" data-sh-attendees="' + esc(m.id) + '">Who\'s coming (' + m.going + ')</button>');
    if (m.can_edit) actions.push('<button type="button" class="btn btn-outline sh-btn-sm" data-sh-meet-menu="' + esc(m.id) + '" aria-label="Manage this meeting">' + ICON.dots + '</button>');
    return '<div class="sh-meet' + (opts.big ? ' sh-meet--big' : '') + (m.cancelled ? ' is-cancelled' : '') + '" data-meet="' + esc(m.id) + '">' +
      '<div class="sh-meet-date" aria-hidden="true"><span>' + esc(d.toLocaleDateString('en-GB', { month: 'short' })) + '</span><strong>' + d.getDate() + '</strong></div>' +
      '<div class="sh-meet-body">' +
        '<p class="sh-meet-tags">' + kindChip(m) + (m.cancelled ? '<span class="sh-chip sh-chip--bad">Cancelled</span>' : '') + '</p>' +
        '<h3 class="sh-meet-title">' + esc(title) + '</h3>' +
        '<p class="sh-meet-when">' + esc(S.fmtLongDay(m.starts_at)) + ' · ' + esc(S.fmtTime(m.starts_at)) + end +
          (!m.ended && !m.cancelled ? ' · <span class="sh-until" data-until="' + esc(m.starts_at) + '">' + esc(S.until(m.starts_at)) + '</span>' : '') + '</p>' +
        '<p class="sh-meet-where">' + where + online + '</p>' +
        (m.description ? '<p class="sh-meet-desc">' + linkify(m.description) + '</p>' : '') +
        rsvp +
        '<div class="sh-meet-actions">' + actions.join('') + '</div>' +
      '</div></div>';
  }

  function findMeeting(id) {
    var lists = [st.upcoming, st.past, st.ov.upcoming, st.ov.recent_past];
    for (var i = 0; i < lists.length; i++) {
      var l = lists[i] || [];
      for (var j = 0; j < l.length; j++) if (l[j].id === id) return l[j];
    }
    return null;
  }
  function replaceMeeting(m) {
    [st.upcoming, st.past, st.ov.upcoming, st.ov.recent_past].forEach(function (l) {
      if (!l) return;
      for (var i = 0; i < l.length; i++) if (l[i].id === m.id) l[i] = m;
    });
  }

  function loadMeetings() {
    renderMeetings();
    return Promise.all([rpc('sankofa_meetings', { p_when: 'upcoming', p_limit: 40 })]).then(function (res) {
      st.upcoming = res[0] || [];
      st.ov.upcoming = st.upcoming.filter(function (m) { return !m.cancelled; }).slice(0, 6);
      renderMeetings();
    }, function (err) {
      setHtml('sh-pane-meetings', '<p class="auth-error">' + esc(err.message) + '</p>');
    });
  }

  function renderMeetings() {
    if (st.tab !== 'meetings') return;
    var up = st.upcoming || st.ov.upcoming || [];
    var canSchedule = (isMentor() && st.ov.circle) || false;
    var html = '<div class="sh-bar"><div><h2 class="sh-pane-title">Meetings</h2><p class="sh-muted">Your Circle\'s meetings, one-to-ones and Sankofa events.</p></div>' +
      '<div class="sh-bar-actions">' + (canSchedule ? '<button type="button" class="btn btn-primary" data-sh-new-meeting>' + ICON.plus + ' Schedule a meeting</button>' : '') + '</div></div>';
    html += up.length ? '<div class="sh-meet-list">' + up.map(function (m) { return '<article class="sh-card sh-card--meet ' + themeOf(m.circle_id ? m : st.ov.circle) + '">' + meetingInner(m) + '</article>'; }).join('') + '</div>'
      : '<div class="sh-card sh-card--empty"><h3>No upcoming meetings</h3><p>When one is scheduled it\'ll show here, and you\'ll get a nudge on the Members Hub.</p></div>';
    html += '<div class="sh-past"><button type="button" class="link-button" data-sh-past>' + (st.past ? 'Hide past meetings' : 'Show past meetings') + '</button>' +
      (st.past ? (st.past.length ? '<div class="sh-meet-list sh-meet-list--past">' + st.past.map(function (m) { return '<article class="sh-card sh-card--meet ' + themeOf(m.circle_id ? m : st.ov.circle) + '">' + meetingInner(m) + '</article>'; }).join('') + '</div>' : '<p class="sh-muted">No past meetings yet.</p>') : '') + '</div>';
    setHtml('sh-pane-meetings', html);
  }

  function togglePast() {
    if (st.past) { st.past = null; renderMeetings(); return; }
    rpc('sankofa_meetings', { p_when: 'past', p_limit: 30 }).then(function (list) { st.past = list || []; renderMeetings(); }, fail);
  }

  function afterMeetingChange(m) {
    replaceMeeting(m);
    if (st.tab === 'meetings') renderMeetings();
    if (st.tab === 'home') renderHome();
  }

  function doRsvp(id, resp) {
    var btns = document.querySelectorAll('[data-sh-rsvp="' + id + '"]');
    Array.prototype.forEach.call(btns, function (b) { b.disabled = true; });
    rpc('sankofa_rsvp', { p_meeting: id, p_response: resp }).then(function (m) {
      afterMeetingChange(m);
      S.toast(resp === 'going' ? 'See you there!' : resp === 'maybe' ? 'Marked as maybe' : 'Thanks for letting them know');
      sync();
    }, function (err) { fail(err); Array.prototype.forEach.call(btns, function (b) { b.disabled = false; }); });
  }

  function doCheckIn(id, btn) {
    busy(btn, true, 'Checking in…');
    rpc('sankofa_check_in', { p_meeting: id }).then(function (m) {
      afterMeetingChange(m);
      S.toast('You\'re checked in - thanks for showing up!');
      sync();
    }, function (err) { busy(btn, false); fail(err); });
  }

  function openAttendees(id) {
    var dlg = S.openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Who\'s coming</span><h2 class="guide-title">Loading…</h2>');
    function draw() {
      return rpc('sankofa_meeting_attendees', { p_meeting: id }).then(function (a) {
        var m = findMeeting(id);
        var groups = { going: [], maybe: [], no: [] };
        (a.replies || []).forEach(function (r) { if (groups[r.response]) groups[r.response].push(r); });
        function list(rows, withAttendance) {
          return rows.length ? '<ul class="sh-attendees">' + rows.map(function (r) {
            return '<li>' + S.avatar(r.person, 'sm') + '<span>' + esc(r.person.name) + '</span>' +
              (a.editor && withAttendance && m && (m.ended || m.checkin_open) ? '<label class="sh-attend-toggle"><input type="checkbox" data-sh-attend="' + esc(r.person.id) + '"' + (r.attended ? ' checked' : '') + '> Attended</label>' : '') +
              (a.editor && r.attended && !withAttendance ? '<span class="sh-chip sh-chip--ok">Attended</span>' : '') + '</li>';
          }).join('') + '</ul>' : '<p class="sh-muted">Nobody yet.</p>';
        }
        dlg.el.innerHTML = '<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Who\'s coming</span>' +
          '<h2 class="guide-title">' + esc(m ? m.title : 'Meeting') + '</h2>' +
          '<h3 class="sh-dlg-h">Going (' + groups.going.length + ')</h3>' + list(groups.going, true) +
          '<h3 class="sh-dlg-h">Maybe (' + groups.maybe.length + ')</h3>' + list(groups.maybe, true) +
          (a.editor ? '<h3 class="sh-dlg-h">Can\'t make it (' + groups.no.length + ')</h3>' + list(groups.no, false) +
            '<h3 class="sh-dlg-h">Haven\'t replied (' + (a.pending || []).length + ')</h3>' + ((a.pending || []).length ? '<ul class="sh-attendees">' + a.pending.map(function (p) { return '<li>' + S.avatar(p, 'sm') + '<span>' + esc(p.name) + '</span></li>'; }).join('') + '</ul>' : '<p class="sh-muted">Everyone has replied.</p>') : '') +
          '<div class="guide-actions"><button type="button" class="btn btn-outline" data-dialog-close>Close</button></div>';
        Array.prototype.forEach.call(dlg.el.querySelectorAll('[data-sh-attend]'), function (cb) {
          cb.addEventListener('change', function () {
            cb.disabled = true;
            rpc('sankofa_mark_attendance', { p_meeting: id, p_user: cb.getAttribute('data-sh-attend'), p_attended: cb.checked }).then(function () { cb.disabled = false; }, function (err) { cb.checked = !cb.checked; cb.disabled = false; fail(err); });
          });
        });
      }, function (err) { dlg.el.innerHTML = '<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><h2 class="guide-title">Couldn\'t load</h2><p class="guide-text">' + esc(err.message) + '</p>'; });
    }
    draw();
  }

  function openFeedback(id) {
    var m = findMeeting(id);
    var rating = 0;
    var dlg = S.openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Feedback</span><h2 class="guide-title">How was ' + esc(m ? m.title : 'the meeting') + '?</h2>' +
      '<p class="guide-text">Only the committee sees this - it helps us make Sankofa better. You\'ll earn +5 XP.</p>' +
      '<form class="guide-form" novalidate><div class="sh-stars" role="radiogroup" aria-label="Rating">' + [1, 2, 3, 4, 5].map(function (n) {
        return '<button type="button" class="sh-star" role="radio" aria-checked="false" data-star="' + n + '" aria-label="' + n + ' out of 5">★</button>';
      }).join('') + '</div>' +
      '<div class="field"><label for="sh-fb-text">Anything to add? <span class="guide-optional">(optional)</span></label><textarea id="sh-fb-text" maxlength="600" rows="3"></textarea></div>' +
      '<p class="guide-error" hidden></p><div class="guide-actions"><button type="submit" class="btn btn-primary">Send feedback</button><button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div></form>');
    var stars = dlg.el.querySelectorAll('.sh-star');
    function paint() { Array.prototype.forEach.call(stars, function (s) { var on = parseInt(s.getAttribute('data-star'), 10) <= rating; s.classList.toggle('is-on', on); s.setAttribute('aria-checked', String(parseInt(s.getAttribute('data-star'), 10) === rating)); }); }
    Array.prototype.forEach.call(stars, function (s) { s.addEventListener('click', function () { rating = parseInt(s.getAttribute('data-star'), 10); paint(); }); });
    dlg.el.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = dlg.el.querySelector('.guide-error');
      if (!rating) { err.textContent = 'Pick a star rating first.'; err.hidden = false; return; }
      var btn = dlg.el.querySelector('[type=submit]');
      busy(btn, true, 'Sending…');
      rpc('sankofa_meeting_feedback_submit', { p_meeting: id, p_rating: rating, p_comment: $('sh-fb-text').value }).then(function (updated) {
        dlg.close();
        afterMeetingChange(updated);
        S.toast('Thanks for the feedback!');
        sync();
      }, function (er) { busy(btn, false); err.textContent = er.message; err.hidden = false; });
    });
  }

  // Create / edit a meeting. opts: { meeting, pairingId, withName }
  function openMeetingForm(opts) {
    opts = opts || {};
    var m = opts.meeting || null;
    var circle = st.ov.circle;
    var is121 = !!(opts.pairingId || (m && m.pairing_id));
    var start = m ? new Date(m.starts_at) : new Date(Date.now() + 7 * 86400000);
    if (!m) { start.setMinutes(0, 0, 0); start.setHours(18); }
    var end = m && m.ends_at ? new Date(m.ends_at) : new Date(start.getTime() + 3600000);
    var kinds = is121 ? '' : '<div class="field"><label for="sh-m-kind">Type</label><select id="sh-m-kind">' +
      [['circle', 'Circle meeting'], ['checkin', 'Check-in'], ['social', 'Social'], ['workshop', 'Workshop']].map(function (k) { return '<option value="' + k[0] + '"' + (m && m.kind === k[0] ? ' selected' : '') + '>' + k[1] + '</option>'; }).join('') + '</select></div>';
    var heading = m ? 'Edit meeting' : is121 ? 'Book a one-to-one' + (opts.withName ? ' with ' + esc(S.firstName(opts.withName)) : '') : 'Schedule a meeting' + (circle ? ' for ' + esc(circle.name) : '');
    var dlg = S.openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Meetings</span><h2 class="guide-title">' + heading + '</h2>' +
      '<form class="guide-form" novalidate>' +
        '<div class="field"><label for="sh-m-title">Title</label><input type="text" id="sh-m-title" maxlength="100" required data-autofocus value="' + esc(m ? m.title : (is121 ? 'Catch-up' : '')) + '" placeholder="' + (is121 ? 'e.g. Catch-up' : 'e.g. Term 1 kick-off') + '"></div>' +
        kinds +
        '<div class="sh-field-row"><div class="field"><label for="sh-m-start">Starts</label><input type="datetime-local" id="sh-m-start" required value="' + S.toLocalInput(start.toISOString()) + '"></div>' +
        '<div class="field"><label for="sh-m-end">Ends <span class="guide-optional">(optional)</span></label><input type="datetime-local" id="sh-m-end" value="' + S.toLocalInput(end.toISOString()) + '"></div></div>' +
        '<div class="field"><label for="sh-m-loc">Where <span class="guide-optional">(optional)</span></label><input type="text" id="sh-m-loc" maxlength="160" value="' + esc(m ? m.location || '' : '') + '" placeholder="Room, café, address…"></div>' +
        '<div class="field"><label for="sh-m-link">Online link <span class="guide-optional">(optional)</span></label><input type="text" id="sh-m-link" value="' + esc(m ? m.online_link || '' : '') + '" placeholder="Teams / Zoom / Meet link"></div>' +
        '<div class="field"><label for="sh-m-desc">Details <span class="guide-optional">(optional)</span></label><textarea id="sh-m-desc" maxlength="800" rows="3" placeholder="What will you cover? Anything to bring?">' + esc(m ? m.description || '' : '') + '</textarea></div>' +
        '<p class="guide-error" hidden></p>' +
        '<div class="guide-actions"><button type="submit" class="btn btn-primary">' + (m ? 'Save changes' : 'Schedule') + '</button><button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div>' +
        (!m ? '<p class="guide-fine">Everyone invited can reply going / maybe / can\'t make it, and you earn +10 XP for scheduling.</p>' : '') +
      '</form>');
    dlg.el.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = dlg.el.querySelector('.guide-error');
      var btn = dlg.el.querySelector('[type=submit]');
      var startVal = $('sh-m-start').value, endVal = $('sh-m-end').value;
      if (!$('sh-m-title').value.trim()) { err.textContent = 'Give the meeting a title.'; err.hidden = false; return; }
      if (!startVal) { err.textContent = 'Choose a start time.'; err.hidden = false; return; }
      if (endVal && new Date(endVal) <= new Date(startVal)) { err.textContent = 'The end time has to be after the start.'; err.hidden = false; return; }
      busy(btn, true, 'Saving…');
      var kindEl = $('sh-m-kind');
      rpc('sankofa_save_meeting', {
        p_id: m ? m.id : null,
        p_circle: m ? m.circle_id : (is121 ? null : (circle ? circle.id : null)),
        p_pairing: m ? m.pairing_id : (opts.pairingId || null),
        p_title: $('sh-m-title').value,
        p_kind: kindEl ? kindEl.value : (is121 ? 'one_to_one' : 'circle'),
        p_starts: S.fromLocalInput(startVal),
        p_ends: S.fromLocalInput(endVal),
        p_location: $('sh-m-loc').value,
        p_link: $('sh-m-link').value,
        p_description: $('sh-m-desc').value
      }).then(function () {
        dlg.close();
        S.toast(m ? 'Meeting updated' : 'Meeting scheduled');
        return Promise.all([load(), st.tab === 'meetings' ? loadMeetings() : null]).then(function () { renderAll(); showTab(st.tab, true); sync(); });
      }, function (er) { busy(btn, false); err.textContent = er.message; err.hidden = false; });
    });
  }

  function openMeetMenu(id) {
    var m = findMeeting(id);
    if (!m) return;
    var dlg = S.openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Manage meeting</span><h2 class="guide-title">' + esc(m.title) + '</h2>' +
      '<div class="guide-actions guide-actions--stack">' +
      '<button type="button" class="btn btn-outline" data-act="edit">Edit details</button>' +
      '<button type="button" class="btn btn-outline" data-act="attend">Attendance &amp; replies</button>' +
      '<button type="button" class="btn btn-outline" data-act="cancel">' + (m.cancelled ? 'Restore this meeting' : 'Cancel this meeting') + '</button>' +
      '<button type="button" class="btn btn-outline sh-btn-danger" data-act="delete">Delete permanently</button></div>');
    dlg.el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      dlg.close();
      if (act === 'edit') openMeetingForm({ meeting: m });
      if (act === 'attend') openAttendees(id);
      if (act === 'cancel') {
        rpc('sankofa_cancel_meeting', { p_meeting: id, p_cancelled: !m.cancelled }).then(function (u) { afterMeetingChange(u); S.toast(u.cancelled ? 'Meeting cancelled' : 'Meeting restored'); }, fail);
      }
      if (act === 'delete') {
        S.confirmDialog('Delete this meeting?', 'It disappears for everyone, including replies and attendance. To keep a record, cancel it instead.', 'Delete', true).then(function (yes) {
          if (!yes) return;
          rpc('sankofa_delete_meeting', { p_meeting: id }).then(function () {
            [st.upcoming, st.past, st.ov.upcoming, st.ov.recent_past].forEach(function (l) { if (!l) return; for (var i = l.length - 1; i >= 0; i--) if (l[i].id === id) l.splice(i, 1); });
            if (st.tab === 'meetings') renderMeetings(); if (st.tab === 'home') renderHome();
            S.toast('Meeting deleted');
          }, fail);
        });
      }
    });
  }

  // =======================================================================
  // Board
  // =======================================================================
  function loadFeed(reset) {
    var before = !reset && st.feed && st.feed.length ? st.feed[st.feed.length - 1].created_at : null;
    return rpc('sankofa_feed', { p_circle: null, p_limit: 20, p_before: before }).then(function (rows) {
      rows = rows || [];
      if (reset) st.feed = rows; else {
        var seen = {};
        st.feed.forEach(function (p) { seen[p.id] = true; });
        rows.forEach(function (p) { if (!seen[p.id]) st.feed.push(p); });
      }
      st.feedEnd = rows.length < 20;
    }, function (err) { if (reset) st.feed = []; if (st.tab === 'board') showError(err.message); });
  }

  function renderBoard() {
    if (st.tab !== 'board') return;
    var ov = st.ov, c = ov.circle;
    var html = '<div class="sh-bar"><div><h2 class="sh-pane-title">Board' + (c ? ' · ' + esc(c.name) : '') + '</h2><p class="sh-muted">Your Circle\'s space - share wins, ask questions, cheer each other on.</p></div></div>';
    if (c) {
      var canAnnounce = isMentor() || isAdmin();
      var mates = (ov.members || []).filter(function (m) { return !m.is_me && !m.blurred; });
      html += '<form class="sh-card sh-compose" data-sh-compose novalidate>' +
        '<div class="ui-seg sh-seg" role="group" aria-label="What are you posting?"><button type="button" class="is-active" data-sh-kind="post">Post</button><button type="button" data-sh-kind="shoutout">👏 Kudos</button>' +
        (canAnnounce ? '<button type="button" data-sh-kind="announcement">📣 Announcement</button>' : '') + '</div>' +
        '<div class="sh-kudos-pick" hidden><label for="sh-kudos-to">Who deserves a shout-out?</label><select id="sh-kudos-to">' + mates.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('') + '</select></div>' +
        '<textarea id="sh-compose-text" maxlength="1000" rows="3" placeholder="Share something with your Circle…" aria-label="Write a post"></textarea>' +
        '<div class="sh-compose-foot"><span class="sh-muted" id="sh-compose-count">0 / 1000</span><button type="submit" class="btn btn-primary">Post</button></div></form>';
    } else {
      html += '<div class="sh-card sh-card--wait"><p>You\'ll be able to post once you\'re in a Circle. You can still read announcements from the committee below.</p></div>';
    }
    if (st.feed === null) html += '<div class="sh-skel"></div><div class="sh-skel"></div>';
    else if (!st.feed.length) html += '<div class="sh-card sh-card--empty"><h3>Quiet in here…</h3><p>Be the first to post - introduce yourself or share what you\'re working on.</p></div>';
    else html += '<div class="sh-feed">' + st.feed.map(postHtml).join('') + '</div>' + (st.feedEnd ? '' : '<div class="sh-more"><button type="button" class="btn btn-outline" data-sh-more>Load older posts</button></div>');
    setHtml('sh-pane-board', html);
  }

  function postHtml(p) {
    var a = p.author;
    var isKudos = p.kind === 'shoutout';
    var body = isKudos && p.target
      ? '<p class="sh-post-kudos">👏 <strong>' + esc(a.name) + '</strong> cheered on <strong>' + esc(p.target.name) + '</strong></p><p>' + linkify(p.body) + '</p>'
      : '<p>' + linkify(p.body) + '</p>';
    return '<article class="sh-card sh-post' + (p.pinned ? ' is-pinned' : '') + (p.kind === 'announcement' ? ' is-announcement' : '') + (isKudos ? ' is-kudos' : '') + '" data-post="' + esc(p.id) + '">' +
      '<header class="sh-post-head">' + S.avatar(a, 'md') +
      '<div class="sh-post-who"><strong>' + esc(a.name) + '</strong><span>' + esc([a.role === 'mentor' ? 'Mentor' : (a.role ? 'Mentee' : ''), S.timeAgo(p.created_at)].filter(Boolean).join(' · ')) + '</span></div>' +
      (p.kind === 'announcement' ? '<span class="sh-chip sh-chip--ann">' + (p.circle_id ? 'Announcement' : 'From the committee') + '</span>' : '') +
      (p.pinned ? '<span class="sh-chip">📌 Pinned</span>' : '') +
      ((p.can_delete || p.can_pin) ? '<button type="button" class="sh-icon-btn" data-sh-post-menu="' + esc(p.id) + '" aria-label="Post options">' + ICON.dots + '</button>' : '') + '</header>' +
      body +
      '<footer class="sh-reacts">' + REACTIONS.map(function (r) {
        var n = (p.reactions && p.reactions[r[0]]) || 0;
        var mine = (p.my_reactions || []).indexOf(r[0]) !== -1;
        return '<button type="button" class="sh-react' + (mine ? ' is-on' : '') + '" data-sh-react="' + esc(p.id) + '" data-emoji="' + r[0] + '" aria-pressed="' + mine + '" aria-label="' + r[2] + (n ? ', ' + n : '') + '"><span aria-hidden="true">' + r[1] + '</span>' + (n ? '<b>' + n + '</b>' : '') + '</button>';
      }).join('') + '</footer></article>';
  }

  function replacePost(p) {
    if (!st.feed) return;
    for (var i = 0; i < st.feed.length; i++) if (st.feed[i].id === p.id) st.feed[i] = p;
    if (st.tab === 'board') {
      var el = document.querySelector('[data-post="' + p.id + '"]');
      if (el) { var tmp = document.createElement('div'); tmp.innerHTML = postHtml(p); el.replaceWith(tmp.firstChild); }
    }
  }

  function submitPost(form) {
    var kindBtn = form.querySelector('[data-sh-kind].is-active');
    var kind = kindBtn ? kindBtn.getAttribute('data-sh-kind') : 'post';
    var text = $('sh-compose-text').value;
    if (!text.trim()) { S.toast('Write something first', { type: 'err' }); return; }
    var btn = form.querySelector('[type=submit]');
    busy(btn, true, 'Posting…');
    rpc('sankofa_post', { p_circle: st.ov.circle.id, p_kind: kind, p_body: text, p_target: kind === 'shoutout' ? $('sh-kudos-to').value : null }).then(function (post) {
      st.feed = [post].concat(st.feed || []);
      $('sh-compose-text').value = '';
      renderBoard();
      S.toast(kind === 'shoutout' ? 'Kudos sent!' : 'Posted');
      sync();
    }, function (err) { busy(btn, false); fail(err); });
  }

  function openPostMenu(id) {
    var p = (st.feed || []).filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var dlg = S.openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Post</span><h2 class="guide-title">Post options</h2><div class="guide-actions guide-actions--stack">' +
      (p.can_pin ? '<button type="button" class="btn btn-outline" data-act="pin">' + (p.pinned ? 'Unpin from the top' : 'Pin to the top') + '</button>' : '') +
      (p.can_delete ? '<button type="button" class="btn btn-outline sh-btn-danger" data-act="delete">Delete post</button>' : '') + '</div>');
    dlg.el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      dlg.close();
      if (act === 'pin') rpc('sankofa_pin_post', { p_post: id, p_pinned: !p.pinned }).then(function () { return loadFeed(true); }).then(renderBoard, fail);
      if (act === 'delete') S.confirmDialog('Delete this post?', 'This can\'t be undone.', 'Delete', true).then(function (yes) {
        if (!yes) return;
        rpc('sankofa_delete_post', { p_post: id }).then(function () { st.feed = st.feed.filter(function (x) { return x.id !== id; }); renderBoard(); S.toast('Post deleted'); }, fail);
      });
    });
  }

  // =======================================================================
  // Growth: weekly check-in + goals
  // =======================================================================
  function loadGrowth() {
    renderGrowth();
    return Promise.all([rpc('sankofa_goals_list'), rpc('sankofa_checkin_history', { p_limit: 10 })]).then(function (res) {
      st.goals = res[0] || [];
      st.hist = res[1] || [];
      renderGrowth();
    }, function (err) { setHtml('sh-pane-growth', '<p class="auth-error">' + esc(err.message) + '</p>'); });
  }

  function renderGrowth() {
    if (st.tab !== 'growth') return;
    if (st.goals === null) { setHtml('sh-pane-growth', '<div class="sh-skel"></div><div class="sh-skel"></div>'); return; }
    var ck = st.ov.week.checkin;
    var html = '<div class="sh-grid sh-grid--even"><div class="sh-col">';
    // ---- Check-in
    html += '<div class="sh-card"><div class="sh-card-head"><h3>Weekly check-in</h3><span class="sh-muted">Week of ' + esc(S.fmtDay(st.ov.week.week_start)) + '</span></div>';
    if (ck && !st.editCheckin) {
      html += '<div class="sh-ck-done"><span class="sh-mood sh-mood--lg">' + MOOD_EMOJI[ck.mood] + '</span><div><strong>' + MOOD_LABEL[ck.mood] + ' week</strong>' +
        (ck.win ? '<p><small>Win:</small> ' + esc(ck.win) + '</p>' : '') + (ck.challenge ? '<p><small>Challenge:</small> ' + esc(ck.challenge) + '</p>' : '') +
        (ck.need_help ? '<p><span class="sh-flag">You asked for a check-in</span></p>' : '') + '</div></div>' +
        '<button type="button" class="btn btn-outline sh-btn-sm" data-sh-edit-checkin>Update my check-in</button>';
    } else {
      html += '<form data-sh-checkin-form novalidate><p class="sh-muted">How did this week feel? It takes a minute, earns <strong>+15 XP</strong>, and lets your mentors know how you\'re doing.</p>' +
        '<div class="sh-moods" role="radiogroup" aria-label="How was your week?">' + [1, 2, 3, 4, 5].map(function (n) {
          return '<button type="button" class="sh-mood-btn' + (ck && ck.mood === n ? ' is-on' : '') + '" role="radio" aria-checked="' + !!(ck && ck.mood === n) + '" data-mood="' + n + '"><span aria-hidden="true">' + MOOD_EMOJI[n] + '</span><small>' + MOOD_LABEL[n] + '</small></button>';
        }).join('') + '</div>' +
        '<div class="field"><label for="sh-ck-win">A win this week <span class="guide-optional">(optional)</span></label><textarea id="sh-ck-win" maxlength="400" rows="2" placeholder="Something that went well, big or small">' + esc(ck ? ck.win || '' : '') + '</textarea></div>' +
        '<div class="field"><label for="sh-ck-ch">A challenge <span class="guide-optional">(optional)</span></label><textarea id="sh-ck-ch" maxlength="400" rows="2" placeholder="Anything that\'s been hard?">' + esc(ck ? ck.challenge || '' : '') + '</textarea></div>' +
        '<label class="sh-check"><input type="checkbox" id="sh-ck-help"' + (ck && ck.need_help ? ' checked' : '') + '> <span>I\'d like someone to check in with me</span></label>' +
        '<p class="guide-error" hidden></p><button type="submit" class="btn btn-primary">' + (ck ? 'Update check-in' : 'Submit check-in') + '</button></form>';
    }
    var hist = (st.hist || []).slice().reverse();
    if (hist.length) {
      html += '<div class="sh-moodline" aria-label="Your last weeks">' + hist.map(function (h) {
        return '<span class="sh-moodline-bar" style="--h:' + (h.mood * 18) + '%" title="Week of ' + esc(S.fmtDay(h.week_start)) + ': ' + MOOD_LABEL[h.mood] + '"><i>' + MOOD_EMOJI[h.mood] + '</i></span>';
      }).join('') + '</div>';
    }
    html += '</div></div><div class="sh-col">';
    // ---- Goals
    var open = st.goals.filter(function (g) { return !g.done; });
    var done = st.goals.filter(function (g) { return g.done; });
    html += '<div class="sh-card"><div class="sh-card-head"><h3>My goals</h3><span class="sh-muted">' + open.length + ' open · ' + done.length + ' done</span></div>' +
      '<form class="sh-goal-add" data-sh-goal-add novalidate><input type="text" id="sh-goal-title" maxlength="140" placeholder="Add a goal - e.g. Shadow a cardiology clinic" aria-label="New goal"><button type="submit" class="btn btn-primary sh-btn-sm">' + ICON.plus + ' Add</button></form>' +
      (open.length ? '<ul class="sh-goals">' + open.map(goalHtml).join('') + '</ul>' : '<p class="sh-muted">No open goals. Small, specific goals work best - what do you want to have done by the next time your Circle meets?</p>') +
      (done.length ? '<button type="button" class="link-button sh-done-toggle" data-sh-done-toggle>' + (st.showDone ? 'Hide' : 'Show') + ' completed (' + done.length + ')</button>' + (st.showDone ? '<ul class="sh-goals sh-goals--done">' + done.map(goalHtml).join('') + '</ul>' : '') : '') +
      '<p class="sh-fineprint">Goals marked ' + ICON.lock.replace('class="icon"', 'class="icon sh-icon-inline"') + ' private are only visible to you; shared goals can be seen by your Circle\'s mentors and the committee so they can cheer you on.</p></div>';
    html += '</div></div>';
    setHtml('sh-pane-growth', html);
  }

  function goalHtml(g) {
    var overdue = !g.done && g.due_date && new Date(g.due_date + 'T23:59:59') < new Date();
    return '<li class="sh-goal' + (g.done ? ' is-done' : '') + '" data-goal="' + esc(g.id) + '">' +
      '<button type="button" class="sh-goal-tick' + (g.done ? ' is-on' : '') + '" data-sh-goal-done="' + esc(g.id) + '" aria-label="' + (g.done ? 'Mark not done' : 'Mark done') + ': ' + esc(g.title) + '" aria-pressed="' + g.done + '">' + (g.done ? ICON.check : '') + '</button>' +
      '<div class="sh-goal-text"><strong>' + esc(g.title) + '</strong>' + (g.detail ? '<small>' + esc(g.detail) + '</small>' : '') +
      '<span class="sh-goal-meta">' + (g.due_date ? '<span class="sh-chip' + (overdue ? ' sh-chip--bad' : '') + '">Due ' + esc(S.fmtDay(g.due_date)) + '</span>' : '') +
      (g.shared ? '' : '<span class="sh-chip">' + ICON.lock.replace('class="icon"', 'class="icon sh-icon-inline"') + ' Private</span>') + '</span></div>' +
      '<button type="button" class="sh-icon-btn" data-sh-goal-edit="' + esc(g.id) + '" aria-label="Edit goal">' + ICON.dots + '</button></li>';
  }

  function openGoalForm(g) {
    var dlg = S.openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Goals</span><h2 class="guide-title">Edit goal</h2>' +
      '<form class="guide-form" novalidate><div class="field"><label for="sh-g-title">Goal</label><input type="text" id="sh-g-title" maxlength="140" value="' + esc(g.title) + '" data-autofocus></div>' +
      '<div class="field"><label for="sh-g-detail">Notes <span class="guide-optional">(optional)</span></label><textarea id="sh-g-detail" maxlength="500" rows="3">' + esc(g.detail || '') + '</textarea></div>' +
      '<div class="field"><label for="sh-g-due">Due date <span class="guide-optional">(optional)</span></label><input type="date" id="sh-g-due" value="' + esc(g.due_date || '') + '"></div>' +
      '<label class="sh-check"><input type="checkbox" id="sh-g-shared"' + (g.shared ? ' checked' : '') + '> <span>Share with my Circle\'s mentors</span></label>' +
      '<p class="guide-error" hidden></p><div class="guide-actions"><button type="submit" class="btn btn-primary">Save</button><button type="button" class="btn btn-outline sh-btn-danger" data-sh-g-delete>Delete</button><button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div></form>');
    dlg.el.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = dlg.el.querySelector('.guide-error');
      var btn = dlg.el.querySelector('[type=submit]');
      busy(btn, true, 'Saving…');
      rpc('sankofa_goal_save', { p_id: g.id, p_title: $('sh-g-title').value, p_detail: $('sh-g-detail').value, p_due: $('sh-g-due').value || null, p_shared: $('sh-g-shared').checked }).then(function (list) {
        dlg.close(); st.goals = list; renderGrowth();
      }, function (er) { busy(btn, false); err.textContent = er.message; err.hidden = false; });
    });
    dlg.el.querySelector('[data-sh-g-delete]').addEventListener('click', function () {
      rpc('sankofa_goal_delete', { p_id: g.id }).then(function (list) { dlg.close(); st.goals = list; renderGrowth(); }, fail);
    });
  }

  function submitCheckin(form) {
    var sel = form.querySelector('.sh-mood-btn.is-on');
    var err = form.querySelector('.guide-error');
    if (!sel) { err.textContent = 'Pick how your week felt first.'; err.hidden = false; return; }
    err.hidden = true;
    var btn = form.querySelector('[type=submit]');
    busy(btn, true, 'Saving…');
    var hadCheckin = !!st.ov.week.checkin;
    rpc('sankofa_checkin_submit', { p_mood: parseInt(sel.getAttribute('data-mood'), 10), p_win: $('sh-ck-win').value, p_challenge: $('sh-ck-ch').value, p_need_help: $('sh-ck-help').checked }).then(function (res) {
      st.ov.week.checkin = { mood: res.mood, win: res.win, challenge: res.challenge, need_help: res.need_help };
      st.editCheckin = false;
      return rpc('sankofa_checkin_history', { p_limit: 10 }).then(function (h) { st.hist = h || []; });
    }).then(function () {
      renderGrowth();
      S.toast(hadCheckin ? 'Check-in updated' : 'Check-in saved - thank you!');
      sync();
    }, function (er) { busy(btn, false); err.textContent = er.message; err.hidden = false; });
  }

  // =======================================================================
  // Rewards
  // =======================================================================
  function loadRewards() {
    renderRewards();
    return rpc('sankofa_leaderboard').then(function (lb) { st.lb = lb; renderRewards(); }, function () { st.lb = { cup: [], board: [] }; renderRewards(); });
  }

  function renderRewards() {
    if (st.tab !== 'rewards') return;
    var p = st.ov.progress;
    if (!p) { setHtml('sh-pane-rewards', '<p class="sh-muted">Rewards aren\'t switched on yet.</p>'); return; }
    var earned = p.badges.filter(function (b) { return b.earned; }).length;
    var html = '<div class="sh-grid"><div class="sh-col sh-col--main">';
    html += '<div class="sh-card sh-card--level sh-card--hero">' + ring(p, 'xl') +
      '<div><span class="sh-eyebrow">Your level</span><h2>' + esc(S.levelTitle(p.level)) + ' <span class="sh-muted">· level ' + p.level + '</span></h2>' +
      '<p class="sh-muted">' + p.xp + ' XP in total · ' + (p.next_floor - p.xp) + ' XP to level ' + (p.level + 1) + '</p>' +
      '<p class="sh-top-chips">' + (p.streak > 0 ? '<span class="sh-chip sh-chip--streak">' + ICON.flame + p.streak + '-week streak</span>' : '<span class="sh-chip">No streak yet - do a check-in this week</span>') +
      '<span class="sh-chip">Best: ' + (p.best_streak || 0) + ' weeks</span><span class="sh-chip">' + (p.xp_30d || 0) + ' XP in 30 days</span></p></div></div>';
    html += '<div class="sh-card"><div class="sh-card-head"><h3>Badges</h3><span class="sh-muted">' + earned + ' of ' + p.badges.length + ' earned</span></div><ul class="sh-badges">' + p.badges.map(function (b) {
      return '<li class="sh-badge' + (b.earned ? ' is-earned' : '') + '"><span class="sh-badge-ico" aria-hidden="true">' + esc(b.icon) + '</span><div><strong>' + esc(b.name) + '</strong><small>' + esc(b.description) + '</small>' +
        (b.earned ? '<small class="sh-badge-date">Earned ' + esc(S.fmtDay(b.awarded_at)) + '</small>' : '') + '</div></li>';
    }).join('') + '</ul></div>';
    html += '</div><div class="sh-col sh-col--side">';
    // Circle Cup
    html += '<div class="sh-card"><div class="sh-card-head"><h3>🏆 Circle Cup</h3><span class="sh-muted">last 30 days</span></div>';
    if (!st.lb) html += '<div class="sh-skel sh-skel--sm"></div>';
    else if (!st.lb.cup.length) html += '<p class="sh-muted">The cup starts once Circles are up and running.</p>';
    else {
      var max = Math.max.apply(null, st.lb.cup.map(function (c) { return c.avg; }).concat([1]));
      html += '<ol class="sh-cup">' + st.lb.cup.map(function (c, i) {
        return '<li class="' + themeOf(c) + (c.mine ? ' is-mine' : '') + '"><span class="sh-cup-rank">' + (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1)) + '</span>' +
          '<div class="sh-cup-main"><strong>' + esc(c.name) + (c.mine ? ' <span class="sh-chip">You</span>' : '') + '</strong>' +
          '<span class="sh-cup-bar"><i style="width:' + Math.max(4, Math.round(c.avg / max * 100)) + '%"></i></span></div><span class="sh-cup-score">' + c.avg + '<small>avg XP</small></span></li>';
      }).join('') + '</ol><p class="sh-fineprint">Circles are ranked by the <em>average</em> XP per member, so a small Circle can beat a big one.</p>';
    }
    html += '</div>';
    if (st.lb && st.lb.board && st.lb.board.length) {
      html += '<div class="sh-card"><div class="sh-card-head"><h3>Your Circle this month</h3></div><ol class="sh-board">' + st.lb.board.map(function (b, i) {
        return '<li class="' + (b.is_me ? 'is-mine' : '') + '"><span class="sh-cup-rank">' + (i + 1) + '</span>' + S.avatar(b.person, 'sm') + '<span class="sh-board-name">' + esc(b.person.name) + '</span><span class="sh-cup-score">' + b.xp_30d + '<small>XP</small></span></li>';
      }).join('') + '</ol><label class="sh-check sh-check--small"><input type="checkbox" id="sh-lb-opt"' + (st.ov.me.show_on_leaderboard ? ' checked' : '') + '> <span>Show me on my Circle\'s board</span></label></div>';
    }
    html += '<div class="sh-card"><h3>How to earn XP</h3><ul class="sh-earn">' + [
      ['Finish your profile', '+20'], ['Attend a meeting', '+20'], ['Weekly check-in', '+15'], ['Finish a goal', '+15 (3 a week)'],
      ['Say hello to someone', '+10 each'], ['Schedule a meeting', '+10'], ['Receive kudos', '+5'], ['Give meeting feedback', '+5'], ['Reply to a meeting', '+3'], ['Post on the board', '+3 (3 a day)']
    ].map(function (r) { return '<li><span>' + r[0] + '</span><b>' + r[1] + '</b></li>'; }).join('') + '</ul></div>';
    html += '</div></div>';
    setHtml('sh-pane-rewards', html);
  }

  // =======================================================================
  // People
  // =======================================================================
  function loadPeople() {
    if (st.people) { renderPeople(); return; }
    renderPeople();
    rpc('sankofa_people').then(function (list) { st.people = list || []; renderPeople(); }, function (err) { setHtml('sh-pane-people', '<p class="auth-error">' + esc(err.message) + '</p>'); });
  }

  function renderPeople() {
    if (st.tab !== 'people') return;
    var pane = $('sh-pane-people');
    var keep = document.activeElement && document.activeElement.id === 'sh-people-q';
    if (!pane.querySelector('#sh-people-q')) {
      pane.innerHTML = '<div class="sh-bar"><div><h2 class="sh-pane-title">People</h2><p class="sh-muted">Everyone in the Sankofa Hub. Find a mentor who shares your interests, or say hello to a peer.</p></div></div>' +
        '<div class="sh-people-tools"><input type="search" id="sh-people-q" placeholder="Search by name, specialty or interest…" aria-label="Search people" value="' + esc(st.peopleQuery) + '">' +
        '<div class="ui-seg sh-seg" id="sh-people-filter" role="group" aria-label="Filter"><button type="button" data-sh-pfilter="all">Everyone</button><button type="button" data-sh-pfilter="mentor">Mentors</button><button type="button" data-sh-pfilter="mentee">Mentees</button><button type="button" data-sh-pfilter="circle">My Circle</button></div></div>' +
        '<div id="sh-people-list"></div>';
    }
    Array.prototype.forEach.call(pane.querySelectorAll('[data-sh-pfilter]'), function (b) { b.classList.toggle('is-active', b.getAttribute('data-sh-pfilter') === st.peopleFilter); });
    var list = $('sh-people-list');
    if (!st.people) { list.innerHTML = '<div class="sh-skel"></div><div class="sh-skel"></div>'; return; }
    var q = st.peopleQuery.trim().toLowerCase();
    var rows = st.people.filter(function (p) {
      if (st.peopleFilter === 'mentor' && p.role !== 'mentor') return false;
      if (st.peopleFilter === 'mentee' && p.role !== 'mentee') return false;
      if (st.peopleFilter === 'circle' && !p.same_circle) return false;
      if (!q) return true;
      return [p.name, p.stage, p.detail, p.headline, p.specialty, (p.interests || []).join(' '), (p.offers || []).join(' ')].join(' ').toLowerCase().indexOf(q) !== -1;
    });
    list.innerHTML = rows.length ? '<div class="sh-people">' + rows.map(function (p) {
      return '<article class="sh-card sh-person' + (p.blurred ? ' is-blurred' : '') + '">' +
        '<div class="sh-person-head">' + S.avatar(p, 'lg') + '<div><h4>' + esc(p.name) + '</h4><p>' + esc(p.stage || '') + '</p>' +
        '<p class="sh-member-chips"><span class="sh-chip sh-chip--role">' + (p.role === 'mentor' ? 'Mentor' : 'Mentee') + '</span>' + (p.circle_name ? '<span class="sh-chip">' + esc(p.circle_name) + '</span>' : '') + '</p></div></div>' +
        (p.detail && p.role === 'mentor' ? '<p class="sh-muted">' + esc(p.detail) + '</p>' : '') +
        (p.headline ? '<p class="sh-quote">&ldquo;' + esc(p.headline) + '&rdquo;</p>' : '') +
        (p.specialty ? '<p class="sh-fact"><b>Interested in</b> ' + esc(p.specialty) + '</p>' : '') +
        ((p.offers && p.offers.length) ? '<p class="sh-tags">' + p.offers.slice(0, 5).map(function (o) { return '<span class="sh-tag sh-tag--offer">' + esc(o) + '</span>'; }).join('') + '</p>' : '') +
        ((p.interests && p.interests.length) ? '<p class="sh-tags">' + p.interests.slice(0, 5).map(function (o) { return '<span class="sh-tag">' + esc(o) + '</span>'; }).join('') + '</p>' : '') +
        '<div class="sh-person-actions">' + (p.id === st.uid ? '<span class="sh-chip">You</span>' : msgBtn(p)) + '</div></article>';
    }).join('') + '</div>' : '<div class="sh-card sh-card--empty"><h3>No one found</h3><p>Try a different search or filter.</p></div>';
    if (keep) { var qi = $('sh-people-q'); qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
  }

  // =======================================================================
  // Profile + welcome
  // =======================================================================
  function tagsInput(id, label, values, placeholder) {
    return '<div class="field"><label for="' + id + '">' + label + '</label><input type="text" id="' + id + '" value="' + esc((values || []).join(', ')) + '" placeholder="' + esc(placeholder) + '"><small class="sh-hint">Separate with commas</small></div>';
  }
  function splitTags(v) { return String(v || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 12); }

  function openProfile(afterWelcome) {
    var me = st.ov.me;
    var mentor = me.role === 'mentor';
    var dlg = S.openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">Your profile</span><h2 class="guide-title">' + (me.profile_done ? 'Edit your profile' : 'Introduce yourself') + '</h2>' +
      '<p class="guide-text">This is what your Circle sees. ' + (me.profile_done ? '' : 'Finishing it earns <strong>+20 XP</strong> and the First steps badge.') + '</p>' +
      '<form class="guide-form" novalidate>' +
      '<div class="field"><label for="sh-p-head">Headline</label><input type="text" id="sh-p-head" maxlength="80" value="' + esc(me.headline || '') + '" placeholder="' + (mentor ? 'e.g. Cardiology registrar who loves mentoring' : 'e.g. Year 2 med student, football and cardiology') + '" data-autofocus></div>' +
      '<div class="field"><label for="sh-p-intro">About you</label><textarea id="sh-p-intro" maxlength="500" rows="4" placeholder="' + (mentor ? 'Your journey, what you enjoy, how you like to mentor' : 'A little about you, what you hope to get from your Circle') + '">' + esc(me.intro || '') + '</textarea></div>' +
      '<div class="field"><label for="sh-p-spec">' + (mentor ? 'Specialty' : 'Specialty you\'re interested in') + ' <span class="guide-optional">(optional)</span></label><input type="text" id="sh-p-spec" maxlength="80" value="' + esc(me.specialty || '') + '"></div>' +
      tagsInput('sh-p-int', 'Interests &amp; hobbies', me.interests, 'Football, music, travel') +
      (mentor ? tagsInput('sh-p-off', 'What you can offer', me.offers, 'Interview prep, career guidance, placements') +
        '<div class="field"><label for="sh-p-cap">How many mentees can you take?</label><input type="number" id="sh-p-cap" min="0" max="20" value="' + (me.capacity == null ? '' : me.capacity) + '"></div>' : '') +
      '<div class="sh-field-row"><div class="field"><label for="sh-p-comm">Communication</label><select id="sh-p-comm"><option value="">No preference</option>' + Object.keys(COMM_LABEL).map(function (k) { return '<option value="' + k + '"' + (me.comm_style === k ? ' selected' : '') + '>' + COMM_LABEL[k] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="sh-p-freq">Catch-ups</label><select id="sh-p-freq"><option value="">No preference</option>' + Object.keys(FREQ_LABEL).map(function (k) { return '<option value="' + k + '"' + (me.meeting_freq === k ? ' selected' : '') + '>' + FREQ_LABEL[k] + '</option>'; }).join('') + '</select></div></div>' +
      '<p class="guide-error" hidden></p><div class="guide-actions"><button type="submit" class="btn btn-primary">Save profile</button><button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div></form>');
    dlg.el.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = dlg.el.querySelector('.guide-error');
      var btn = dlg.el.querySelector('[type=submit]');
      var intro = $('sh-p-intro').value.trim(), head = $('sh-p-head').value.trim();
      if (!me.profile_done && (head.length < 3 || intro.length < 20)) { err.textContent = 'Add a headline and at least a couple of sentences about you.'; err.hidden = false; return; }
      busy(btn, true, 'Saving…');
      var patch = { headline: head, intro: intro, specialty: $('sh-p-spec').value, interests: splitTags($('sh-p-int').value), comm_style: $('sh-p-comm').value, meeting_freq: $('sh-p-freq').value };
      if (mentor) { patch.offers = splitTags($('sh-p-off').value); patch.capacity = $('sh-p-cap').value; }
      rpc('sankofa_save_profile', { p_patch: patch }).then(function () {
        dlg.close();
        S.toast('Profile saved');
        return load().then(function () { renderAll(); showTab(st.tab, true); st.people = null; sync(); });
      }, function (er) { busy(btn, false); err.textContent = er.message; err.hidden = false; });
    });
  }

  function openWelcome() {
    var me = st.ov.me;
    var slides = [
      { icon: '🌍', title: 'Welcome to the Sankofa Hub', text: '<strong>Sankofa</strong> means &ldquo;go back and fetch it&rdquo;. This is where our mentors and mentees come together - sixth-formers, medical students, junior doctors and senior doctors, all in one small <strong>Circle</strong>.' },
      { icon: '🗓️', title: 'Everything in one place', text: 'See <strong>who\'s in your Circle</strong>, <strong>when you meet next</strong> (with a countdown and a calendar link), message your mentors and peers, post on your Circle\'s board and keep track of your goals.' },
      { icon: '🔥', title: 'Grow, and get rewarded', text: 'Every check-in, meeting, goal and kind word earns <strong>XP</strong>. Level up, build a weekly <strong>streak</strong>, collect badges and help your Circle win the <strong>Circle Cup</strong>.' }
    ];
    var i = 0;
    var dlg = S.openDialog('<div class="sh-welcome"></div>', 'sh-dialog--welcome');
    var box = dlg.el.querySelector('.sh-welcome');
    function done() {
      dlg.close();
      rpc('sankofa_mark_welcomed').then(function () { st.ov.me.welcomed = true; }, function () {});
    }
    function draw() {
      var s = slides[i], last = i === slides.length - 1;
      box.innerHTML = '<button type="button" class="guide-close" data-sh-skip aria-label="Skip">&times;</button><div class="sh-welcome-ico" aria-hidden="true">' + s.icon + '</div><h2 class="guide-title">' + s.title + '</h2><p class="guide-text">' + s.text + '</p>' +
        '<div class="sh-dots" aria-hidden="true">' + slides.map(function (_, k) { return '<i class="' + (k === i ? 'is-on' : '') + '"></i>'; }).join('') + '</div>' +
        '<div class="guide-actions"><button type="button" class="btn btn-primary" data-sh-next data-autofocus>' + (last ? (me.profile_done ? 'Let\'s go' : 'Set up my profile') : 'Next') + '</button>' + (last ? '' : '<button type="button" class="btn btn-outline" data-sh-skip>Skip</button>') + '</div>';
      var f = box.querySelector('[data-sh-next]'); if (f) f.focus();
    }
    box.addEventListener('click', function (e) {
      if (e.target.closest('[data-sh-skip]')) { done(); return; }
      if (e.target.closest('[data-sh-next]')) {
        if (i < slides.length - 1) { i++; draw(); } else { done(); if (!me.profile_done) setTimeout(openProfile, 250); }
      }
    });
    dlg.onClose = function () { if (!st.ov.me.welcomed) rpc('sankofa_mark_welcomed').then(function () { st.ov.me.welcomed = true; }, function () {}); };
    draw();
  }

  // =======================================================================
  // Events
  // =======================================================================
  function wireEvents() {
    appEl.addEventListener('click', function (e) {
      var t = e.target;
      var el;
      if ((el = t.closest('[data-sh-tab]'))) { showTab(el.getAttribute('data-sh-tab')); return; }
      if ((el = t.closest('[data-sh-goto]'))) { showTab(el.getAttribute('data-sh-goto')); window.scrollTo({ top: appEl.getBoundingClientRect().top + window.pageYOffset - 70, behavior: S.reduceMotion ? 'auto' : 'smooth' }); return; }
      if (t.closest('[data-sh-edit-profile]')) { openProfile(); return; }
      if ((el = t.closest('[data-sh-msg]'))) {
        var id = el.getAttribute('data-sh-msg');
        var person = findPerson(id);
        if (person) S.message(person);
        return;
      }
      if ((el = t.closest('[data-sh-snapshot]'))) { openSnapshot(el.getAttribute('data-sh-snapshot')); return; }
      if ((el = t.closest('[data-sh-rsvp]'))) { doRsvp(el.getAttribute('data-sh-rsvp'), el.getAttribute('data-resp')); return; }
      if ((el = t.closest('[data-sh-checkin]'))) { doCheckIn(el.getAttribute('data-sh-checkin'), el); return; }
      if ((el = t.closest('[data-sh-ics]'))) { var m = findMeeting(el.getAttribute('data-sh-ics')); if (m) S.downloadIcs(m); return; }
      if ((el = t.closest('[data-sh-attendees]'))) { openAttendees(el.getAttribute('data-sh-attendees')); return; }
      if ((el = t.closest('[data-sh-feedback]'))) { openFeedback(el.getAttribute('data-sh-feedback')); return; }
      if ((el = t.closest('[data-sh-meet-menu]'))) { openMeetMenu(el.getAttribute('data-sh-meet-menu')); return; }
      if (t.closest('[data-sh-new-meeting]')) { openMeetingForm({}); return; }
      if ((el = t.closest('[data-sh-new-121]'))) { openMeetingForm({ pairingId: el.getAttribute('data-sh-new-121'), withName: el.getAttribute('data-name') }); return; }
      if (t.closest('[data-sh-past]')) { togglePast(); return; }
      if ((el = t.closest('[data-sh-kind]'))) {
        var seg = el.parentNode;
        Array.prototype.forEach.call(seg.querySelectorAll('[data-sh-kind]'), function (b) { b.classList.toggle('is-active', b === el); });
        var kind = el.getAttribute('data-sh-kind');
        var pick = appEl.querySelector('.sh-kudos-pick');
        if (pick) pick.hidden = kind !== 'shoutout';
        var ta = $('sh-compose-text');
        if (ta) ta.placeholder = kind === 'shoutout' ? 'Say what they did that was great…' : kind === 'announcement' ? 'Announce something to your Circle…' : 'Share something with your Circle…';
        return;
      }
      if (t.closest('[data-sh-more]')) { loadFeed(false).then(renderBoard); return; }
      if ((el = t.closest('[data-sh-post-menu]'))) { openPostMenu(el.getAttribute('data-sh-post-menu')); return; }
      if ((el = t.closest('[data-sh-react]'))) {
        el.disabled = true;
        rpc('sankofa_react', { p_post: el.getAttribute('data-sh-react'), p_emoji: el.getAttribute('data-emoji') }).then(replacePost, function (err) { el.disabled = false; fail(err); });
        return;
      }
      if ((el = t.closest('[data-mood]'))) {
        Array.prototype.forEach.call(appEl.querySelectorAll('.sh-mood-btn'), function (b) { var on = b === el; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); });
        return;
      }
      if (t.closest('[data-sh-edit-checkin]')) { st.editCheckin = true; renderGrowth(); return; }
      if ((el = t.closest('[data-sh-goal-done]'))) {
        var gid = el.getAttribute('data-sh-goal-done');
        var g = (st.goals || []).filter(function (x) { return x.id === gid; })[0];
        if (!g) return;
        var nowDone = !g.done;
        el.disabled = true;
        rpc('sankofa_goal_set_done', { p_id: gid, p_done: nowDone }).then(function (list) {
          st.goals = list; renderGrowth();
          if (nowDone) { S.confetti(); S.toast('Goal done - nice one!'); }
          st.ov.week.goals_done_week += nowDone ? 1 : 0;
          sync();
        }, function (err) { el.disabled = false; fail(err); });
        return;
      }
      if ((el = t.closest('[data-sh-goal-edit]'))) {
        var gg = (st.goals || []).filter(function (x) { return x.id === el.getAttribute('data-sh-goal-edit'); })[0];
        if (gg) openGoalForm(gg);
        return;
      }
      if (t.closest('[data-sh-done-toggle]')) { st.showDone = !st.showDone; renderGrowth(); return; }
      if ((el = t.closest('[data-sh-pfilter]'))) { st.peopleFilter = el.getAttribute('data-sh-pfilter'); renderPeople(); return; }
    });

    appEl.addEventListener('submit', function (e) {
      var f = e.target;
      if (f.matches('[data-sh-compose]')) { e.preventDefault(); submitPost(f); return; }
      if (f.matches('[data-sh-checkin-form]')) { e.preventDefault(); submitCheckin(f); return; }
      if (f.matches('[data-sh-goal-add]')) {
        e.preventDefault();
        var inp = $('sh-goal-title');
        if (!inp.value.trim()) { inp.focus(); return; }
        var btn = f.querySelector('button');
        busy(btn, true);
        rpc('sankofa_goal_save', { p_id: null, p_title: inp.value, p_detail: null, p_due: null, p_shared: true }).then(function (list) {
          st.goals = list; renderGrowth(); S.toast('Goal added'); var n = $('sh-goal-title'); if (n) n.focus();
        }, function (err) { busy(btn, false); fail(err); });
      }
    });

    appEl.addEventListener('input', function (e) {
      if (e.target.id === 'sh-compose-text') { var c = $('sh-compose-count'); if (c) c.textContent = e.target.value.length + ' / 1000'; }
      if (e.target.id === 'sh-people-q') { st.peopleQuery = e.target.value; renderPeople(); }
    });
    appEl.addEventListener('change', function (e) {
      if (e.target.id === 'sh-lb-opt') {
        var on = e.target.checked;
        rpc('sankofa_save_profile', { p_patch: { show_on_leaderboard: on } }).then(function () { st.ov.me.show_on_leaderboard = on; S.toast(on ? 'You\'re on the board' : 'You\'re hidden from the board'); loadRewards(); }, function (err) { e.target.checked = !on; fail(err); });
      }
    });
    // Arrow keys move between tabs.
    $('sh-tabs').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var i = TABS.indexOf(st.tab) + (e.key === 'ArrowRight' ? 1 : -1);
      if (i < 0) i = TABS.length - 1;
      if (i >= TABS.length) i = 0;
      showTab(TABS[i]);
      var b = $('sh-tab-btn-' + TABS[i]); if (b) b.focus();
    });
    // Dialogs live outside #sh-app, so a few buttons are wired globally.
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-sh-msg-person]');
      if (el) S.message({ id: el.getAttribute('data-sh-msg-person'), name: el.getAttribute('data-name') });
      var g = e.target.closest('.sh-dialog [data-sh-goto]');
      if (g) showTab(g.getAttribute('data-sh-goto'));
    });
  }

  function findPerson(id) {
    var pools = [st.ov.members || [], st.people || [], st.ov.my_mentees || [], st.ov.my_mentor ? [st.ov.my_mentor] : []];
    for (var i = 0; i < pools.length; i++) for (var j = 0; j < pools[i].length; j++) if (pools[i][j].id === id) return pools[i][j];
    return null;
  }

  // =======================================================================
  // Live updates + clock
  // =======================================================================
  var refreshTimer = null;
  function refreshSoon() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      load().then(function () {
        renderTop();
        if (st.tab === 'home') renderHome();
        if (st.tab === 'circle') renderCircle();
        if (st.tab === 'meetings') loadMeetings();
      }, function () {});
    }, 800);
  }

  function startRealtime() {
    if (!supabaseClient.channel) return;
    try {
      supabaseClient.channel('sankofa-hub-' + st.uid)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sankofa_posts' }, function (payload) {
          if (payload.new && payload.new.author_id === st.uid) return;
          if (st.tab === 'board') loadFeed(true).then(renderBoard);
          else {
            var dot = $('sh-dot-board'); if (dot) dot.hidden = false;
            st.feed = null;
            loadFeed(true).then(function () { if (st.tab === 'home') renderHome(); });
            S.toast('New post on your board');
          }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sankofa_meetings' }, function () {
          if (st.tab !== 'meetings') { var dot = $('sh-dot-meetings'); if (dot) dot.hidden = false; }
          st.upcoming = null; st.past = null;
          refreshSoon();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sankofa_circle_members' }, function () { refreshSoon(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sankofa_pairings' }, function () { refreshSoon(); })
        .subscribe();
    } catch (e) { /* live updates are a bonus */ }
  }

  // Keeps the "in 3 hours" text and the check-in window honest.
  function tick() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-until]'), function (el) { el.textContent = S.until(el.getAttribute('data-until')); });
    if (document.visibilityState !== 'visible') return;
    var m = nextMeeting();
    if (m && st.tab === 'home') {
      var soon = Math.abs(new Date(m.starts_at).getTime() - Date.now()) < 3 * 3600000;
      if (soon) refreshSoon();
    }
  }
})();
