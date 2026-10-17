// member-journey.html: the full picture of a member's journey (migration 088).
// Level and streak, next steps, the badge collection, recent activity, shared
// community goals, how XP works - and the switch that turns the whole
// journey layer off (or back on) across the Members Hub.
//
// The data comes from js/journey.js, which asks the database; nothing here
// awards anything.
(function () {
  'use strict';

  var root = document.getElementById('jy-page');
  if (!root) return;
  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;

  var J = window.lacmsJourney;
  var gate = document.getElementById('auth-gate');
  var community = null;
  var badgeFilter = null;   // null = choose a sensible default (earned, once there is something earned)
  var wide = window.matchMedia ? window.matchMedia('(min-width: 900px)').matches : true;
  var folds = {};           // panel id -> open (remembers what the member opened)

  function esc(s) { return J.esc(s); }
  function fmtDay(iso) { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function timeAgo(iso) {
    var mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + ' hr ago';
    var days = Math.floor(hrs / 24);
    if (days < 7) return days + (days === 1 ? ' day ago' : ' days ago');
    return fmtDay(iso);
  }

  var EARN = [
    ['Join LACMS', '+10'], ['Each month as a member (first year)', '+5'], ['Visit the Members Hub (once a day)', '+2'],
    ['Add a bio to your profile', '+15'], ['Add your LinkedIn', '+10'], ['Register for an event', '+10 each'],
    ['Reveal a member discount', '+3 each'], ['Use a member discount', '+5 each'], ['Share a resource (once approved)', '+25 each'],
    ['Like, comment on or use a resource', '+1 / +2 / +1'], ['Nominate for Member of the Month', '+15 each'], ['Like or comment on news', '+1 / +2'],
    ['Apply for Sankofa', '+20'], ['Send your first message in the Network', '+10']
  ];

  function milestone(n, step) { return { prev: Math.floor(n / step) * step, next: (Math.floor(n / step) + 1) * step }; }
  function goalHtml(label, n, step, noun) {
    var m = milestone(n, step);
    var pct = Math.round((n - m.prev) / (m.next - m.prev) * 100);
    return '<li class="jy-goal"><div class="jy-goal-head"><strong>' + esc(label) + '</strong><span>' + n + ' so far</span></div>' +
      '<div class="jy-meter"><i style="width:' + pct + '%"></i></div>' +
      '<p>' + (m.next - n) + ' more ' + esc(noun) + ' to reach ' + m.next + ' together</p></li>';
  }


  // A panel that folds away. Reference-style panels are closed (or closed on a phone) so the page stays short.
  function fold(id, title, bodyHtml, openByDefault) {
    var open = folds[id] !== undefined ? folds[id] : openByDefault;
    return '<details class="jy-panel jy-fold" data-fold="' + id + '"' + (open ? ' open' : '') + '><summary class="jy-fold-summary"><h2>' + title + '</h2></summary><div class="jy-fold-body">' + bodyHtml + '</div></details>';
  }

  function draw(s) {
    if (gate) gate.style.display = 'none';
    root.style.display = '';
    if (!s || s.eligible === false) {
      root.innerHTML = '<div class="sh-closed"><h2>Your journey isn\'t available on this account</h2><p>It\'s for LACMS members. If you think that\'s wrong, email <a href="mailto:acms@lincolnsu.com">acms@lincolnsu.com</a>.</p><div class="sh-closed-actions"><a class="btn btn-outline" href="member-hub.html">Back to the Members Hub</a></div></div>';
      return;
    }
    var switchHtml = '<section class="jy-panel jy-settings" aria-labelledby="jy-set-h"><div><h2 id="jy-set-h">Show my progress</h2>' +
      '<p>Turn this off and the level, badges, progress lines and pop-ups disappear from the Members Hub. We\'ll keep counting quietly, so nothing is lost if you switch it back on.</p></div>' +
      '<label class="res-switch"><input type="checkbox" id="jy-show"' + (s.hidden ? '' : ' checked') + '><span class="res-switch-track" aria-hidden="true"><span class="res-switch-thumb"></span></span><span class="res-switch-text"><strong>' + (s.hidden ? 'Hidden' : 'Showing') + '</strong></span></label></section>';
    if (s.hidden) {
      root.innerHTML = '<div class="jy-panel"><p class="jy-muted">Your progress is hidden across the Members Hub. Switch it back on below whenever you like.</p></div>' + switchHtml;
      wire();
      return;
    }
    var p = s.progress;
    var earned = s.badges.filter(function (b) { return b.earned; });
    var filter = badgeFilter || (earned.length ? 'earned' : 'all');
    var html = '';

    // ---- Summary
    html += '<section class="jy-panel jy-summary">' + J.ring(p, 'xl') +
      '<div class="jy-summary-text"><span class="jy-eyebrow">Where you are</span><h2>' + esc(J.rankName(p.level)) + ' <span class="jy-muted">&middot; level ' + p.level + '</span></h2>' +
      '<p class="jy-muted">' + p.xp + ' XP in total &middot; ' + (p.next_floor - p.xp) + ' to level ' + (p.level + 1) + ' (' + esc(J.rankName(p.level + 1)) + ')</p>' +
      '<div class="jy-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + J.levelPct(p) + '"><i style="width:' + J.levelPct(p) + '%"></i></div>' +
      '<p class="jy-chips">' + (p.streak > 0 ? '<span class="jy-chip jy-chip--streak">' + J.flame + p.streak + '-week streak</span>' : '<span class="jy-chip">No streak yet - do one thing this week</span>') +
      '<span class="jy-chip">Best: ' + (p.best_streak || 0) + ' ' + ((p.best_streak || 0) === 1 ? 'week' : 'weeks') + '</span><span class="jy-chip">+' + (p.xp_week || 0) + ' XP this week</span></p></div>' +
      '<ol class="jy-ranks" aria-label="Ranks">' + J.ranks.map(function (r, i) {
        var lvl = i + 1, floor = Math.round(25 * Math.pow(lvl - 1, 2));
        return '<li class="' + (lvl === p.level ? 'is-now' : lvl < p.level ? 'is-done' : '') + '"><span>' + esc(r) + '</span><small>' + floor + ' XP</small></li>';
      }).join('') + '</ol></section>';

    // ---- Next steps
    html += '<section class="jy-panel" aria-labelledby="jy-steps-h"><h2 id="jy-steps-h">Next steps</h2>' + ((s.next_steps || []).length
      ? '<ul class="jy-steps jy-steps--page">' + s.next_steps.map(function (st) {
          return '<li><a class="jy-step" href="' + esc(st.href) + '"><span class="jy-step-text"><strong>' + esc(st.title) + '</strong><small>' + esc(st.sub) + '</small></span><span class="jy-xp">+' + st.xp + ' XP</span></a></li>';
        }).join('') + '</ul>'
      : '<p class="jy-muted">You\'re all caught up - lovely. New ideas appear here as things come up.</p>') + '</section>';

    // ---- Badges
    html += '<section class="jy-panel" id="badges" aria-labelledby="jy-badges-h"><div class="jy-panel-head"><h2 id="jy-badges-h">Badges <span class="jy-muted">' + earned.length + ' of ' + s.badges.length + '</span></h2>' +
      '<div class="sh-seg ui-seg" role="group" aria-label="Show badges"><button type="button" data-jy-filter="earned" class="' + (filter === 'earned' ? 'is-active' : '') + '">Earned</button><button type="button" data-jy-filter="todo" class="' + (filter === 'todo' ? 'is-active' : '') + '">To earn</button><button type="button" data-jy-filter="all" class="' + (filter === 'all' ? 'is-active' : '') + '">All</button></div></div>' +
      '<ul class="jy-badges">' + s.badges.filter(function (b) { return filter === 'all' || (filter === 'earned' ? b.earned : !b.earned); }).map(function (b) {
        return '<li class="jy-badge-card' + (b.earned ? ' is-earned' : '') + '"><span class="jy-badge jy-badge--lg" aria-hidden="true">' + esc(b.icon) + '</span><div><strong>' + esc(b.name) + '</strong>' +
          '<small>' + esc(b.earned ? b.description : b.hint) + '</small>' + (b.earned ? '<small class="jy-earned">Earned ' + esc(fmtDay(b.awarded_at)) + '</small>' : '') + '</div></li>';
      }).join('') + '</ul></section>';

    // ---- Recent activity
    html += fold('recent', 'Recent activity', ((s.recent || []).length
      ? '<ul class="jy-recent">' + s.recent.slice(0, 6).map(function (r) { return '<li><strong>+' + r.points + '</strong><span>' + esc(J.kindLabel(r.kind)) + '</span><time>' + esc(timeAgo(r.at)) + '</time></li>'; }).join('') + '</ul>'
      : '<p class="jy-muted">Nothing yet - your first step will show up here.</p>'), wide);

    // ---- Community
    if (community && community.members) {
      html += fold('community', 'What we\'re doing together',
        '<p class="jy-muted">Shared goals for all ' + community.members + ' of us - nobody is ranked, everyone helps.</p><ul class="jy-goals">' +
        goalHtml('Resources shared', community.resources, 25, 'resources') +
        goalHtml('Event places booked this year', community.event_places, 25, 'places') +
        goalHtml('Member discounts used', community.discounts_used, 50, 'uses') + '</ul>', wide);
    }

    // ---- How it works
    html += fold('how', 'How XP works', '<p class="jy-muted">XP comes from things you really do on the site - it\'s counted by the database, so it can\'t be gamed, and what you did before this existed counts too. Each thing counts once, and small ones (likes, comments) stop after a while. A level needs 25 &times; (level &minus; 1)&sup2; XP.</p>' +
      '<ul class="jy-earn">' + EARN.map(function (e) { return '<li><span>' + esc(e[0]) + '</span><b>' + esc(e[1]) + '</b></li>'; }).join('') + '</ul>', false);

    root.innerHTML = html + switchHtml;
    wire();
  }

  function wire() {
    var sw = document.getElementById('jy-show');
    if (sw) sw.addEventListener('change', function () {
      var show = sw.checked;
      sw.disabled = true;
      J.setHidden(!show).then(function () { sw.disabled = false; draw(J.state()); J.toast('<span class="jy-toast-text">' + (show ? 'Your journey is showing' : 'Your journey is hidden') + '</span>', {}); },
        function () { sw.checked = !show; sw.disabled = false; });
    });
  }

  root.addEventListener('toggle', function (e) {
    var d = e.target;
    if (d && d.getAttribute && d.getAttribute('data-fold')) folds[d.getAttribute('data-fold')] = d.open;
  }, true);

  root.addEventListener('click', function (e) {
    var f = e.target.closest('[data-jy-filter]');
    if (f) { badgeFilter = f.getAttribute('data-jy-filter'); draw(J.state()); var b = document.getElementById('badges'); if (b) b.scrollIntoView({ block: 'nearest' }); }
  });

  // Wait for the first answer from the database.
  var loaded = false;
  J.onState(function (s) {
    if (!loaded) {
      loaded = true;
      supabaseClient.rpc('journey_community').then(function (r) { community = !r.error && r.data && r.data.members ? r.data : null; draw(J.state()); }, function () { draw(J.state()); });
      if (!s || s.eligible === false) draw(s);
      return;
    }
    draw(s);
  });
  // If the journey layer isn't switched on (migration not run) or nobody is signed in.
  supabaseClient.auth.getSession().then(function (r) {
    if (!r.data || !r.data.session) { window.location.href = 'member-login.html'; return; }
    setTimeout(function () {
      if (!loaded) {
        if (gate) gate.style.display = 'none';
        root.style.display = '';
        root.innerHTML = '<div class="sh-closed"><h2>Your journey isn\'t switched on yet</h2><p>This part of the Members Hub is still being set up. Check back soon.</p><div class="sh-closed-actions"><a class="btn btn-outline" href="member-hub.html">Back to the Members Hub</a></div></div>';
      }
    }, 6000);
  });
})();
