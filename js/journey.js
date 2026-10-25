// Your LACMS journey - the calm progress layer across the Members Hub
// (migration 088). One shared script, loaded on the member pages:
//
//   * asks the database for the member's journey (XP is worked out there from
//     what they've really done - nothing is awarded from the browser);
//   * paints the compact card on the Members Hub, the level chip, a one-line
//     progress strip on Perks / Resources / Events / Nominations / Network,
//     and a small "+XP" tag on the hub cards that still have something to try;
//   * after the member does something (registers for an event, likes a
//     resource, reveals a discount...) it notices, re-checks, and shows a
//     small unobtrusive toast - plus a gentle celebration for a new badge or
//     level. No modal pop-ups, no leaderboards.
//
// Anyone can switch it all off from the journey page (member-journey.html);
// then nothing is drawn except a one-line "Show my progress" link.
// Everything is skipped quietly if migration 088 hasn't been run.
(function () {
  'use strict';

  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;
  if (window.lacmsJourney) return;

  // The ranks are capital cities across Africa and the Caribbean - each with a
  // line on why it's special, shown on the journey page.
  var RANKS = [
    { name: 'Accra', meaning: 'Ghana - the first sub-Saharan nation to win independence (1957)' },
    { name: 'Kingston', meaning: 'Jamaica - birthplace of reggae and ska' },
    { name: 'Abuja', meaning: 'Nigeria - home to more people than any other African nation' },
    { name: 'Bridgetown', meaning: 'Barbados - a UNESCO World Heritage historic capital' },
    { name: 'Nairobi', meaning: 'Kenya - the "Green City in the Sun"' },
    { name: 'Port of Spain', meaning: 'Trinidad and Tobago - home of Carnival, calypso and the steelpan' },
    { name: 'Dakar', meaning: 'Senegal - the westernmost city on mainland Africa, known for teranga (hospitality)' },
    { name: 'Addis Ababa', meaning: 'Ethiopia - seat of the African Union' }
  ];
  var KIND_LABEL = {
    join: 'Joined LACMS', visit: 'Visited the Members Hub', bio: 'Added a bio', linkedin: 'Added your LinkedIn',
    event_reg: 'Registered for an event', disc_reveal: 'Tried a discount', disc_used: 'Used a discount',
    motm_nominate: 'Nominated for Member of the Month', motm_kingmaker: 'Your nominee became Member of the Month', event_feedback: 'Gave event feedback', news_like: 'Liked a news post', news_comment: 'Commented on news',
    sankofa_apply: 'Applied for Sankofa', resource_shared: 'Shared a resource', resource_like: 'Liked a resource',
    resource_comment: 'Commented on a resource', resource_download: 'Used a resource', chat_first: 'Sent your first message',
    tenure: 'Another month with LACMS'
  };
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isHub = /member-hub\.html$/.test(window.location.pathname);

  var state = null;
  var userId = null;
  var listeners = [];
  var syncing = false;
  var pending = false;
  var lastSyncAt = 0;
  var pokeTimer = null;
  var toastBox = null;
  var disabled = false;

  // The president previewing someone's account (js/view-as.js): show their levels and badges, but no pop-ups or intros that belong to them.
  function inPreview() { return !!(window.lacmsViewAs && window.lacmsViewAs.active && window.lacmsViewAs.active()); }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function rankName(level) { return RANKS[Math.min(Math.max(level, 1), RANKS.length) - 1].name; }
  function rankMeaning(level) { return RANKS[Math.min(Math.max(level, 1), RANKS.length) - 1].meaning; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* fine */ } }

  var FLAME = '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c1 3.5-1.5 5-1.5 7.5 0 1.2.8 2 1.8 2 1.3 0 2.2-1.1 2.2-2.4 2 1.6 3.5 3.9 3.5 6.4A6 6 0 0 1 6 15.5c0-3 1.7-4.6 3-6.5C10.6 7.2 12 5.5 12 2z"/></svg>';

  // =======================================================================
  // Ring + shared bits
  // =======================================================================
  function ring(p, size) {
    var span = Math.max(p.next_floor - p.level_floor, 1);
    var pct = Math.min(Math.max((p.xp - p.level_floor) / span, 0), 1);
    var r = 26, c = 2 * Math.PI * r;
    return '<span class="jy-ring jy-ring--' + (size || 'md') + '" role="img" aria-label="Level ' + p.level + ', ' + p.xp + ' XP">' +
      '<svg viewBox="0 0 64 64" aria-hidden="true"><circle class="jy-ring-bg" cx="32" cy="32" r="' + r + '"/>' +
      '<circle class="jy-ring-fg" cx="32" cy="32" r="' + r + '" stroke-dasharray="' + (c * pct).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 32 32)"/></svg>' +
      '<span class="jy-ring-num">' + p.level + '</span></span>';
  }
  function levelPct(p) {
    var span = Math.max(p.next_floor - p.level_floor, 1);
    return Math.round(Math.min(Math.max((p.xp - p.level_floor) / span, 0), 1) * 100);
  }

  // =======================================================================
  // Hub card
  // =======================================================================
  function earnedBadges(s) { return s.badges.filter(function (b) { return b.earned; }); }

  var moreOpen = false;

  // One slim row (two on a phone): level, progress, the single best next step,
  // and a "more" toggle for everything else. The full picture lives on the
  // journey page.
  function cardHtml(s) {
    var p = s.progress;
    var earned = earnedBadges(s);
    var steps = s.next_steps || [];
    var top = steps[0];
    var introKey = 'jy-intro-' + userId;
    if (s.first_run && !inPreview()) lsSet(introKey, 'pending');
    var html = '<article class="jy-bar" aria-label="Your LACMS journey">';
    if (lsGet(introKey) === 'pending') {
      html += '<p class="jy-intro jy-intro--line"><span>🎉 You start with <strong>' + p.xp + ' XP</strong> for what you\'ve already done.</span>' +
        '<button type="button" class="jy-intro-ok" data-jy-intro-ok>Got it</button></p>';
    }
    html += '<div class="jy-bar-row">' +
      '<a class="jy-bar-main" href="member-journey.html" aria-label="Open your journey - level ' + p.level + ', ' + esc(rankName(p.level)) + '">' + ring(p, 'sm') +
        '<span class="jy-bar-text"><strong>Level ' + p.level + ' &middot; ' + esc(rankName(p.level)) + '</strong>' +
        '<small>' + p.xp + ' XP' + (p.level < RANKS.length ? ' &middot; ' + Math.max(p.next_floor - p.xp, 0) + ' to ' + esc(rankName(p.level + 1)) : ' &middot; top rank') + (p.streak > 0 ? ' &middot; <span class="jy-bar-streak">' + FLAME + p.streak + 'w</span>' : '') + '</small></span></a>' +
      '<span class="jy-bar-meter" role="progressbar" aria-label="Progress to level ' + (p.level + 1) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + levelPct(p) + '"><i style="width:' + levelPct(p) + '%"></i></span>' +
      (top ? '<a class="jy-bar-next" href="' + esc(top.href) + '"><span class="jy-bar-next-label">Next</span><span class="jy-bar-next-title">' + esc(top.title) + '</span><span class="jy-xp">+' + top.xp + ' XP</span></a>' : '<span class="jy-bar-next jy-bar-next--done">You\'re all caught up</span>') +
      '<button type="button" class="jy-bar-toggle" data-jy-toggle aria-expanded="' + moreOpen + '" aria-controls="jy-more" aria-label="' + (moreOpen ? 'Hide' : 'Show') + ' more of your journey"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button>' +
    '</div>' +
    '<div class="jy-bar-more" id="jy-more"' + (moreOpen ? '' : ' hidden') + '>' +
      (steps.length > 1 ? '<ul class="jy-steps">' + steps.slice(1).map(function (st) {
        return '<li><a class="jy-step" href="' + esc(st.href) + '"><span class="jy-step-text"><strong>' + esc(st.title) + '</strong><small>' + esc(st.sub) + '</small></span><span class="jy-xp">+' + st.xp + ' XP</span></a></li>';
      }).join('') + '</ul>' : '') +
      '<div class="jy-bar-foot">' + (earned.length ? '<span class="jy-badge-row">' + earned.slice(-6).reverse().map(function (b) { return '<span class="jy-badge jy-badge--btn" title="' + esc(b.name + ' - tap for the story') + '"' + (window.lacmsBadgeLore ? window.lacmsBadgeLore.attrs(b, 'member') : '') + '>' + esc(b.icon) + '</span>'; }).join('') + '</span>' : '<span class="jy-muted">Your first badges are a step or two away.</span>') +
        '<a class="jy-link" href="member-journey.html">' + earned.length + ' of ' + s.badges.length + ' badges &middot; see your journey</a></div>' +
    '</div></article>';
    return html;
  }

  function hiddenHtml() {
    return '<p class="jy-hidden-line">Your journey progress is hidden. <button type="button" class="link-button" data-jy-show>Show it</button></p>';
  }

  function renderCard() {
    var slots = document.querySelectorAll('[data-journey-card]');
    if (!slots.length) return;
    Array.prototype.forEach.call(slots, function (slot) {
      var wrap = slot.closest('[data-journey-section]');
      if (!state || state.eligible === false) { slot.innerHTML = ''; if (wrap) wrap.hidden = true; return; }
      slot.innerHTML = state.hidden ? hiddenHtml() : cardHtml(state);
      if (wrap) wrap.hidden = false;
    });
  }

  function renderChip() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-journey-chip]'), function (el) {
      if (!state || state.eligible === false || state.hidden) { el.hidden = true; el.innerHTML = ''; return; }
      var p = state.progress;
      el.innerHTML = '<a class="jy-hero-chip" href="member-journey.html" title="Your LACMS journey"><span class="jy-hero-lv">Lv ' + p.level + '</span> ' + esc(rankName(p.level)) +
        (p.streak > 0 ? ' <span class="jy-hero-streak">' + FLAME + p.streak + 'w</span>' : '') + '</a>';
      el.hidden = false;
    });
  }

  // =======================================================================
  // Strips on each page: one calm line of progress
  // =======================================================================
  function nextThreshold(n, steps) {
    for (var i = 0; i < steps.length; i++) if (n < steps[i]) return steps[i];
    return null;
  }
  function stripFor(area, s) {
    var a = s.areas || {};
    var bar = null;
    var title = '', hint = '', icon = '';
    if (area === 'perks') {
      var pk = a.perks || { total: 0, revealed: 0, used: 0 };
      icon = '🏷️';
      title = pk.total && pk.revealed >= pk.total ? 'You\'ve tried every discount' : 'You\'ve tried ' + pk.revealed + ' of ' + pk.total + ' discounts';
      if (pk.revealed < 3) hint = 'Reveal ' + (3 - pk.revealed) + ' more for the Deal hunter badge';
      else if (pk.used < 3) hint = 'Mark ' + (3 - pk.used) + ' as used for the Smart saver badge';
      else hint = 'Saving money, nicely done';
      bar = pk.total ? pk.revealed / pk.total : 0;
    } else if (area === 'events') {
      var ev = a.events || { registered: 0 };
      icon = '🎟️';
      var nt = nextThreshold(ev.registered, [1, 3, 6]);
      title = ev.registered ? 'You\'re registered for ' + plural(ev.registered, 'event') : 'You haven\'t registered for an event yet';
      hint = nt ? 'Register for ' + (nt - ev.registered) + ' more for ' + ({ 1: 'Out and about', 3: 'Regular face', 6: 'Social butterfly' })[nt] + ' (+10 XP each)' : 'You\'re a regular - see you there';
      bar = nt ? ev.registered / nt : 1;
    } else if (area === 'resources') {
      var rs = a.resources || { shared: 0, liked: 0, commented: 0 };
      icon = '📚';
      title = 'Shared ' + rs.shared + ' · liked ' + rs.liked + ' · commented ' + rs.commented;
      if (!rs.shared) hint = 'Share a resource that helped you for +25 XP';
      else if (rs.liked < 5) hint = 'Like ' + (5 - rs.liked) + ' more resources for the Supporter badge';
      else if (rs.commented < 3) hint = 'Leave ' + (3 - rs.commented) + ' more helpful comments for Conversation starter';
      else hint = 'Thank you for lifting others up';
      bar = Math.min(1, (rs.shared ? 0.4 : 0) + Math.min(rs.liked, 5) / 5 * 0.3 + Math.min(rs.commented, 3) / 3 * 0.3);
    } else if (area === 'motm') {
      var mo = a.motm || { nominations: 0, this_month: false };
      icon = '⭐';
      title = mo.this_month ? 'You\'ve nominated someone this month' : 'You haven\'t nominated anyone this month';
      hint = mo.this_month ? 'Thank you - if they win, you earn +20 XP and a badge' : 'Nominating earns +15 XP';
      bar = mo.this_month ? 1 : 0;
    } else if (area === 'network') {
      var nw = a.network || { bio: false, linkedin: false, messaged: false };
      var done = (nw.bio ? 1 : 0) + (nw.linkedin ? 1 : 0) + (nw.messaged ? 1 : 0);
      icon = '🤝';
      title = done === 3 ? 'Your Network profile is complete' : 'Network: ' + done + ' of 3 done';
      hint = !nw.bio ? 'Add a bio to your profile for +15 XP' : !nw.linkedin ? 'Add your LinkedIn for +10 XP' : !nw.messaged ? 'Say hello to someone for +10 XP' : 'Great connecting';
      bar = done / 3;
    } else {
      return '';
    }
    return '<div class="jy-strip"><span class="jy-strip-ico" aria-hidden="true">' + icon + '</span>' +
      '<div class="jy-strip-main"><strong>' + esc(title) + '</strong><span>' + esc(hint) + '</span></div>' +
      '<div class="jy-meter jy-meter--sm" aria-hidden="true"><i style="width:' + Math.round(Math.min(Math.max(bar, 0), 1) * 100) + '%"></i></div>' +
      '<a class="jy-strip-link" href="member-journey.html">Your journey</a></div>';
  }
  function renderStrips() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-journey-strip]'), function (el) {
      if (!state || state.eligible === false || state.hidden) { el.innerHTML = ''; el.hidden = true; return; }
      var html = stripFor(el.getAttribute('data-journey-strip'), state);
      el.innerHTML = html;
      el.hidden = !html;
    });
  }

  // "+XP" tag on the hub's link cards that still have something to try.
  var STEP_CARD = { discount: '#perks-card', resources: '#resources-card', share: '#resources-card', motm: '#motm-nominate-card', hello: '#network-card', event: '.quick-link-card[href="events.html"]' };
  function renderRewards() {
    Array.prototype.forEach.call(document.querySelectorAll('.jy-reward'), function (n) { n.remove(); });
    if (!state || state.eligible === false || state.hidden) return;
    // Resources: a small "+25 XP" on the Share button until they've shared one.
    var shareBtn = document.getElementById('res-share-btn');
    if (shareBtn && state.areas && state.areas.resources && !state.areas.resources.shared) {
      shareBtn.insertAdjacentHTML('beforeend', '<span class="jy-reward jy-reward--btn" title="Earn XP when your resource is approved">+25 XP</span>');
    }
    if (!isHub) return;
    var seen = {};
    (state.next_steps || []).forEach(function (st) {
      var sel = STEP_CARD[st.key];
      var card = sel && document.querySelector(sel);
      if (!card || seen[sel]) return;
      seen[sel] = true;
      var tag = card.querySelector('.card-tag');
      if (!tag) return;
      var chip = document.createElement('span');
      chip.className = 'jy-reward';
      chip.textContent = '+' + st.xp + ' XP';
      chip.title = st.title;
      tag.parentNode.insertBefore(chip, tag.nextSibling);
    });
  }

  function renderAll() {
    renderCard(); renderChip(); renderStrips(); renderRewards();
    listeners.forEach(function (fn) { try { fn(state); } catch (e) { /* a listener failing mustn't stop the rest */ } });
  }

  // =======================================================================
  // Toasts + gentle celebrations
  // =======================================================================
  function toastRoot() {
    if (!toastBox) {
      toastBox = document.createElement('div');
      toastBox.className = 'jy-toasts';
      toastBox.setAttribute('role', 'status');
      toastBox.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastBox);
    }
    return toastBox;
  }
  function toast(html, opts) {
    opts = opts || {};
    var root = toastRoot();
    while (root.children.length >= 3) root.firstChild.remove();
    var t = document.createElement(opts.href ? 'a' : 'div');
    t.className = 'jy-toast' + (opts.kind ? ' jy-toast--' + opts.kind : '');
    if (opts.href) t.href = opts.href;
    t.innerHTML = html;
    root.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('is-in'); });
    setTimeout(function () { t.classList.remove('is-in'); setTimeout(function () { t.remove(); }, 300); }, opts.ms || 4800);
  }
  function confetti() {
    if (reduceMotion) return;
    var colours = ['#d4a62b', '#1e7a46', '#c1272d', '#e8c767', '#6fcf97', '#b28ff0'];
    var wrap = document.createElement('div');
    wrap.className = 'sh-confetti';
    wrap.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 28; i++) {
      var s = document.createElement('span');
      s.style.left = (Math.random() * 100) + '%';
      s.style.background = colours[i % colours.length];
      s.style.animationDelay = (Math.random() * 0.3) + 's';
      s.style.animationDuration = (1.3 + Math.random() * 1.1) + 's';
      s.style.setProperty('--dx', ((Math.random() - 0.5) * 140) + 'px');
      wrap.appendChild(s);
    }
    document.body.appendChild(wrap);
    setTimeout(function () { wrap.remove(); }, 3000);
  }

  function recentKey(r) { return r.kind + '|' + r.at; }
  // minGain: the daily visit XP isn't worth a toast on its own.
  function celebrate(prev, next, minGain) {
    if (!next || next.hidden || next.eligible === false) return;
    if (next.gained > (minGain || 0)) {
      var known = {};
      ((prev && prev.recent) || []).forEach(function (r) { known[recentKey(r)] = true; });
      var fresh = (next.recent || []).filter(function (r) { return !known[recentKey(r)] && r.kind !== 'tenure' && r.kind !== 'join' && r.kind !== 'visit'; });
      var groups = [], byKind = {};
      fresh.forEach(function (r) {
        if (!byKind[r.kind]) { byKind[r.kind] = { kind: r.kind, n: 0 }; groups.push(byKind[r.kind]); }
        byKind[r.kind].n++;
      });
      var why = groups.slice(0, 2).map(function (g) { return (KIND_LABEL[g.kind] || 'Nice one') + (g.n > 1 ? ' \u00d7' + g.n : ''); }).join(' \u00b7 ');
      if (groups.length > 2) why += ' \u00b7 and more';
      toast('<span class="jy-toast-xp">+' + next.gained + ' XP</span><span class="jy-toast-text">' + esc(why) + '</span>', { href: 'member-journey.html' });
    }
    (next.new_badges || []).forEach(function (b, i) {
      setTimeout(function () {
        toast('<span class="jy-toast-ico" aria-hidden="true">' + esc(b.icon) + '</span><span class="jy-toast-text"><strong>Badge earned: ' + esc(b.name) + '</strong><small>' + esc(b.description) + '</small></span>', { href: 'member-journey.html#badges', kind: 'badge', ms: 6500 });
        confetti();
      }, 500 + i * 900);
    });
    if (next.level_up) {
      setTimeout(function () {
        toast('<span class="jy-toast-ico" aria-hidden="true">⬆️</span><span class="jy-toast-text"><strong>Level ' + next.level_up + ' &middot; ' + esc(rankName(next.level_up)) + '</strong><small>Keep it up - you\'re growing with LACMS</small></span>', { href: 'member-journey.html', kind: 'badge', ms: 6500 });
        confetti();
      }, 400);
    }
  }

  // =======================================================================
  // Talking to the database
  // =======================================================================
  function sync(opts) {
    opts = opts || {};
    if (disabled) return Promise.resolve(state);
    if (syncing) { pending = true; return Promise.resolve(state); }
    syncing = true;
    var prev = state;
    return supabaseClient.rpc('journey_sync', { p_visit: !!opts.visit }).then(function (res) {
      syncing = false;
      lastSyncAt = Date.now();
      if (res.error || !res.data) {
        // Migration 088 not run, or something transient: stay quiet.
        if (res.error && /does not exist|schema cache|could not find/i.test(res.error.message || '')) disabled = true;
        return state;
      }
      state = res.data;
      if (state.eligible === false) { disabled = true; }
      renderAll();
      if (!opts.silent && !state.first_run && !inPreview()) celebrate(prev, state, opts.visit ? 2 : 0);
      if (pending) { pending = false; setTimeout(function () { sync({}); }, 600); }
      return state;
    }, function () { syncing = false; return state; });
  }

  // Called (debounced) after the member does something.
  function poke() {
    if (disabled || !userId || inPreview()) return;
    clearTimeout(pokeTimer);
    pokeTimer = setTimeout(function () {
      var wait = 3000 - (Date.now() - lastSyncAt);
      if (wait > 0) { setTimeout(function () { sync({}); }, wait); } else { sync({}); }
    }, 1300);
  }

  // Notice writes the site already makes (events, likes, comments, discount
  // reveals, nominations, profile, messages, downloads) and re-check shortly after.
  var WATCH_TABLES = { event_registrations: 1, resource_likes: 1, resource_comments: 1, motm_nominations: 1, member_profiles: 1, news_likes: 1, news_comments: 1, sankofa_applications: 1, discount_usage: 1 };
  var WATCH_RPCS = { submit_event_feedback: 1, record_discount_reveal: 1, record_discount_used: 1, record_resource_event: 1, chat_send_message: 1 };
  function watch() {
    try {
      var origFrom = supabaseClient.from.bind(supabaseClient);
      supabaseClient.from = function (table) {
        var qb = origFrom(table);
        if (!WATCH_TABLES[table]) return qb;
        ['insert', 'upsert', 'update', 'delete'].forEach(function (m) {
          var orig = qb[m];
          if (typeof orig !== 'function') return;
          qb[m] = function () {
            var r = orig.apply(qb, arguments);
            if (r && typeof r.then === 'function') {
              var origThen = r.then.bind(r);
              r.then = function (ok, bad) {
                return origThen(function (v) { if (v && !v.error) poke(); return ok ? ok(v) : v; }, bad);
              };
            }
            return r;
          };
        });
        return qb;
      };
      var origRpc = supabaseClient.rpc.bind(supabaseClient);
      supabaseClient.rpc = function (fn) {
        var r = origRpc.apply(supabaseClient, arguments);
        var args = arguments[1] || {};
        var worth = WATCH_RPCS[fn] && (fn !== 'record_resource_event' || args.p_event === 'download') &&
          (fn !== 'chat_send_message' || !(state && state.areas && state.areas.network && state.areas.network.messaged));
        if (worth && r && typeof r.then === 'function') {
          var origThen = r.then.bind(r);
          r.then = function (ok, bad) {
            return origThen(function (v) { if (v && !v.error) poke(); return ok ? ok(v) : v; }, bad);
          };
        }
        return r;
      };
    } catch (e) { /* the layer is a bonus; never break the page */ }
  }

  function setHidden(hidden) {
    return supabaseClient.rpc('journey_set_hidden', { p_hidden: hidden }).then(function (res) {
      if (res.error) throw new Error(res.error.message);
      if (state) state.hidden = hidden;
      renderAll();
    });
  }

  // =======================================================================
  // Events
  // =======================================================================
  document.addEventListener('click', function (e) {
    var tg = e.target.closest('[data-jy-toggle]');
    if (tg) { moreOpen = !moreOpen; renderCard(); var b = document.querySelector('[data-jy-toggle]'); if (b) b.focus(); return; }
    if (e.target.closest('[data-jy-intro-ok]')) { lsSet('jy-intro-' + userId, 'done'); renderCard(); return; }
    if (e.target.closest('[data-jy-show]')) {
      setHidden(false).then(function () { toast('<span class="jy-toast-text">Your journey is back</span>', {}); }, function () {});
      return;
    }
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state && Date.now() - lastSyncAt > 5 * 60 * 1000) sync({});
  });

  // =======================================================================
  // Start
  // =======================================================================
  window.lacmsJourney = {
    state: function () { return state; },
    onState: function (fn) { listeners.push(fn); if (state) fn(state); },
    sync: function (o) { return sync(o); },
    poke: poke,
    setHidden: setHidden,
    rankName: rankName, rankMeaning: rankMeaning,
    kindLabel: function (k) { return KIND_LABEL[k] || k; },
    ring: ring, levelPct: levelPct, esc: esc, plural: plural, flame: FLAME, toast: toast, ranks: RANKS
  };

  supabaseClient.auth.getSession().then(function (result) {
    var session = result.data && result.data.session;
    if (!session) return;
    userId = session.user.id;
    watch();
    var visit = false;
    if (isHub && lsGet('jy-visit-' + userId) !== today()) { visit = true; }
    sync({ visit: visit }).then(function () {
      if (visit && state && state.eligible !== false) lsSet('jy-visit-' + userId, today());
      // A "Add a short bio" step on the hub opens the profile form.
      if (isHub && window.location.hash === '#network-profile') {
        setTimeout(function () {
          var toggle = document.getElementById('network-profile-toggle');
          var form = document.getElementById('network-profile-form');
          var acc = document.getElementById('hub-account'); if (acc) acc.open = true;
          if (toggle && form && form.style.display === 'none') toggle.click();
          if (form) form.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
        }, 1200);
      }
    });
  });
})();
