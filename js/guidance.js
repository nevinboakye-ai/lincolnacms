// Guidance for signed-in users: gentle reminders to nominate for Member of
// the Month / apply for Sankofa, a "complete your Network profile" prompt,
// and an optional guided tour of the members hub and the rest of the site.
//
// Everything here is optional and dismissible, and none of it runs for
// signed-out visitors. What's been seen/answered is remembered per user
// (user_ui_state, migration 062) so it follows them across devices; if
// that table isn't there yet it quietly falls back to this browser's
// localStorage, so nothing breaks before the migration is run.
(function () {
  'use strict';

  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;

  var SANKOFA_DEADLINE = new Date('2026-10-11T23:59:59+01:00').getTime();
  var page = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var session = null;
  var userId = null;
  var uiState = {};
  var uiStateServerOk = false;
  var tourRunning = false;
  var overlayOpen = false; // a modal (offer / profile prompt / tour) is on screen

  // ---- Small helpers ----------------------------------------------------
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function daysFromNow(n) { return new Date(Date.now() + n * 86400000).toISOString(); }
  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  }
  function isVisible(node) {
    if (!node) return false;
    var r = node.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    var style = window.getComputedStyle(node);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }
  function sget(key) { try { return window.sessionStorage.getItem(key); } catch (e) { return null; } }
  function sset(key, value) { try { window.sessionStorage.setItem(key, value); } catch (e) { /* ignore */ } }
  function sdel(key) { try { window.sessionStorage.removeItem(key); } catch (e) { /* ignore */ } }

  // ---- Per-user remembered state ---------------------------------------
  function localKey(key) { return 'lacms-ui:' + userId + ':' + key; }
  function readLocal(key) {
    try { var raw = window.localStorage.getItem(localKey(key)); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function writeLocal(key, value) {
    try { window.localStorage.setItem(localKey(key), JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  function loadState() {
    return supabaseClient.from('user_ui_state').select('key, value').then(function (result) {
      if (result.error) {
        console.warn('Saved guidance state unavailable, using this browser only:', result.error.message);
        return;
      }
      uiStateServerOk = true;
      (result.data || []).forEach(function (row) { uiState[row.key] = row.value; });
    }, function () { /* offline etc. - fall back to local */ });
  }
  function getState(key) {
    return uiState[key] !== undefined ? uiState[key] : readLocal(key);
  }
  function setState(key, value) {
    uiState[key] = value;
    writeLocal(key, value);
    if (!uiStateServerOk) return Promise.resolve();
    return supabaseClient.from('user_ui_state').upsert({
      user_id: userId, key: key, value: value, updated_at: new Date().toISOString()
    }).then(function (result) {
      if (result.error) console.warn('Could not save guidance state:', result.error.message);
    });
  }

  // ---- What the user can do (drives the reminders) ----------------------
  var ctxPromise = null;
  function getContext() {
    if (ctxPromise) return ctxPromise;
    var month = new Date().toISOString().slice(0, 7);
    ctxPromise = Promise.all([
      supabaseClient.rpc('get_my_hub_access'),
      supabaseClient.from('members').select('id, full_name, course').eq('id', userId).maybeSingle(),
      supabaseClient.from('motm_nominations').select('id').eq('nominator_id', userId).eq('nomination_month', month).maybeSingle(),
      supabaseClient.from('sankofa_applications').select('id').eq('member_id', userId).limit(1)
    ]).then(function (res) {
      var access = null;
      if (!res[0].error) {
        access = {};
        (res[0].data || []).forEach(function (r) { access[r.feature] = !!r.allowed; });
      }
      var member = res[1].data || null;
      var nominated = !!res[2].data;
      var applied = !!(res[3].data && res[3].data.length);
      // If the Hub Access rules can't be read, fall back to the original
      // rules: any member can nominate; Medicine members can apply.
      var motmAllowed = access && access.motm_nominate !== undefined ? access.motm_nominate : !!member;
      var sankofaAllowed = access && access.sankofa !== undefined ? access.sankofa : !!(member && /medicine/i.test(member.course || ''));
      return {
        access: access,
        member: member,
        nudges: {
          motm: !!(motmAllowed && !nominated),
          sankofa: !!(sankofaAllowed && member && !applied && Date.now() <= SANKOFA_DEADLINE)
        }
      };
    }, function () { return { access: null, member: null, nudges: { motm: false, sankofa: false } }; });
    return ctxPromise;
  }

  // =======================================================================
  // 1. Reminders: pulsing hub cards + a small dismissible pill elsewhere.
  // =======================================================================
  var NUDGES = [
    // Sankofa first - it's the one with a deadline.
    { key: 'sankofa', cardId: 'sankofa-apply-card', badge: 'Apply now', href: 'member-sankofa.html', hidePages: ['member-sankofa.html'], text: 'Applications for a Sankofa Circle are open - apply today' },
    { key: 'motm', cardId: 'motm-nominate-card', badge: 'Prizes to win', href: 'motm.html#nominate', hidePages: ['motm.html'], text: 'Nominate someone for Member of the Month - the winner and runners-up win LACMS prizes' }
  ];
  var QUIET_PAGES = ['member-login.html', 'login.html', 'request-account.html', 'join.html', 'mmg-login.html', 'president-dashboard.html', 'member-hub.html'];

  function startNudges() {
    getContext().then(function (ctx) {
      if (page === 'member-hub.html') applyCardNudges(ctx);
      else showPill(ctx);
    });
  }

  function applyCardNudges(ctx) {
    var tries = 0;
    (function attempt() {
      var linksSection = document.getElementById('member-hub-content-links');
      // The hub reveals its cards only once it knows what you can access;
      // wait for that so a card that's about to be hidden never flashes.
      if (!linksSection || linksSection.style.display === 'none') {
        if (++tries < 60) { setTimeout(attempt, 200); }
        return;
      }
      NUDGES.forEach(function (n) {
        var card = document.getElementById(n.cardId);
        if (!card || card.style.display === 'none' || !ctx.nudges[n.key] || card.querySelector('.nudge-badge')) return;
        card.classList.add('is-nudging');
        var badge = el('span', 'nudge-badge', '<span class="nudge-badge-dot" aria-hidden="true"></span>' + escapeHtml(n.badge));
        card.appendChild(badge);
      });
    })();
  }

  function showPill(ctx) {
    if (QUIET_PAGES.indexOf(page) !== -1) return;
    var active = NUDGES.filter(function (n) {
      return ctx.nudges[n.key] && n.hidePages.indexOf(page) === -1 && sget('lacms-nudge-dismissed:' + n.key) !== '1';
    });
    if (!active.length) return;
    var nudge = active[0];

    setTimeout(function () {
      if (overlayOpen || tourRunning || document.querySelector('.nudge-pill')) return;
      var pill = el('div', 'nudge-pill');
      pill.setAttribute('role', 'complementary');
      pill.setAttribute('aria-label', 'Reminder');
      pill.innerHTML =
        '<a class="nudge-pill-link" href="' + nudge.href + '"><span class="nudge-pill-dot" aria-hidden="true"></span>' +
        '<span class="nudge-pill-text">' + escapeHtml(nudge.text) + '</span></a>' +
        '<button type="button" class="nudge-pill-close" aria-label="Dismiss reminder">&times;</button>';
      document.body.appendChild(pill);
      requestAnimationFrame(function () { pill.classList.add('is-in'); });
      pill.querySelector('.nudge-pill-close').addEventListener('click', function () {
        // Gone for this browser session; it comes back next visit until done.
        sset('lacms-nudge-dismissed:' + nudge.key, '1');
        pill.classList.remove('is-in');
        setTimeout(function () { pill.remove(); }, 250);
      });
    }, 3500);
  }

  // =======================================================================
  // 2. "Complete your Network profile" prompt.
  // =======================================================================
  // After a "Not now" the next ask comes after 3, then 7, 14 and 30 days.
  var PROFILE_BACKOFF_DAYS = [3, 7, 14, 30];

  function loadOwnProfile() {
    return supabaseClient.from('network_professionals').select('bio, linkedin_url').eq('user_id', userId).maybeSingle().then(function (proResult) {
      if (proResult.data) return { isPro: true, bio: proResult.data.bio || '', linkedin: proResult.data.linkedin_url || '' };
      return supabaseClient.from('member_profiles').select('bio, linkedin_url').eq('id', userId).maybeSingle().then(function (r) {
        return { isPro: false, bio: (r.data && r.data.bio) || '', linkedin: (r.data && r.data.linkedin_url) || '' };
      });
    });
  }

  function maybePromptProfile() {
    var st = getState('profile_prompt') || {};
    if (st.done || st.never) return;
    if (st.next_due_at && Date.now() < new Date(st.next_due_at).getTime()) return;

    loadOwnProfile().then(function (profile) {
      if (profile.bio && profile.linkedin) {
        setState('profile_prompt', Object.assign({}, st, { done: true }));
        return;
      }
      setTimeout(function () {
        if (overlayOpen || tourRunning) return;
        openProfilePrompt(profile, st);
      }, 1600);
    }, function () { /* can't read the profile - don't nag */ });
  }

  function openProfilePrompt(profile, st) {
    var firstTime = !(st.shown > 0);
    var dismissals = st.dismissals || 0;
    overlayOpen = true;
    var previouslyFocused = document.activeElement;

    var backdrop = el('div', 'guide-backdrop');
    var dialog = el('div', 'guide-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'profile-prompt-title');
    dialog.innerHTML =
      '<button type="button" class="guide-close" data-pp-later aria-label="Close">&times;</button>' +
      '<span class="guide-eyebrow">LACMS Network</span>' +
      '<h2 class="guide-title" id="profile-prompt-title">' + (firstTime ? 'Welcome to the Network - tell people about you' : 'Finish your Network profile') + '</h2>' +
      '<p class="guide-text">Your profile is what other members and professionals see on your Network card. A couple of lines and a LinkedIn link makes it much easier for people to connect with you.</p>' +
      '<form class="guide-form" novalidate>' +
      '<div class="field"><label for="pp-bio">About you</label>' +
      '<textarea id="pp-bio" maxlength="280" rows="4" placeholder="Interests, the specialty you\'re drawn to, what you\'re working towards - whatever you\'d want a fellow member to know."></textarea>' +
      '<span class="guide-count" id="pp-count" aria-live="polite">0 / 280</span></div>' +
      '<div class="field"><label for="pp-linkedin">LinkedIn <span class="guide-optional">(optional)</span></label>' +
      '<input type="url" id="pp-linkedin" placeholder="https://www.linkedin.com/in/yourname" autocomplete="url"></div>' +
      '<p class="guide-error" id="pp-error" role="alert" hidden></p>' +
      '<div class="guide-actions"><button type="submit" class="btn btn-primary">Save my profile</button>' +
      '<button type="button" class="btn btn-outline" data-pp-later>Not now</button></div>' +
      (dismissals >= 2 ? '<button type="button" class="guide-linkbtn" data-pp-never>Don\'t ask me again</button>' : '') +
      '</form>';
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    document.body.classList.add('guide-open');

    var bio = dialog.querySelector('#pp-bio');
    var linkedin = dialog.querySelector('#pp-linkedin');
    var count = dialog.querySelector('#pp-count');
    var errorEl = dialog.querySelector('#pp-error');
    bio.value = profile.bio;
    linkedin.value = profile.linkedin;
    function updateCount() { count.textContent = bio.value.length + ' / 280'; }
    updateCount();
    bio.addEventListener('input', updateCount);
    requestAnimationFrame(function () { backdrop.classList.add('is-in'); bio.focus(); });

    // Counts as "shown" the moment it appears, so closing the tab
    // without answering still spaces out the next ask.
    setState('profile_prompt', Object.assign({}, st, {
      shown: (st.shown || 0) + 1,
      last_shown_at: new Date().toISOString()
    }));

    function close(next) {
      document.removeEventListener('keydown', onKey, true);
      backdrop.classList.remove('is-in');
      document.body.classList.remove('guide-open');
      overlayOpen = false;
      setTimeout(function () { backdrop.remove(); }, reduceMotion ? 0 : 200);
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
      if (next) setState('profile_prompt', Object.assign({}, getState('profile_prompt') || {}, next));
    }
    var saved = false;
    function snooze() {
      if (saved) { close(null); return; }
      var n = dismissals;
      var days = PROFILE_BACKOFF_DAYS[Math.min(n, PROFILE_BACKOFF_DAYS.length - 1)];
      close({ dismissals: n + 1, next_due_at: daysFromNow(days) });
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); snooze(); return; }
      if (e.key === 'Tab') trapFocus(e, dialog);
    }
    document.addEventListener('keydown', onKey, true);

    dialog.addEventListener('click', function (e) {
      if (e.target.closest('[data-pp-later]')) snooze();
      else if (e.target.closest('[data-pp-never]')) close({ never: true });
    });

    dialog.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var bioValue = bio.value.trim();
      var linkValue = linkedin.value.trim();
      errorEl.hidden = true;

      if (!bioValue && !linkValue) {
        errorEl.textContent = 'Add a line about yourself or a LinkedIn link - or choose "Not now".';
        errorEl.hidden = false;
        return;
      }
      if (linkValue) {
        var parsed = null;
        try { parsed = new URL(linkValue); } catch (err) { parsed = null; }
        if (!parsed || !/^https?:$/.test(parsed.protocol) || !/(^|\.)linkedin\.com$/i.test(parsed.hostname)) {
          errorEl.textContent = 'That doesn\'t look like a LinkedIn link - it should start with https://www.linkedin.com/in/';
          errorEl.hidden = false;
          return;
        }
      }

      var submit = dialog.querySelector('button[type="submit"]');
      submit.disabled = true;
      submit.textContent = 'Saving…';
      var save = profile.isPro
        ? supabaseClient.rpc('update_professional_profile', { p_linkedin_url: linkValue || null, p_bio: bioValue || null })
        : supabaseClient.from('member_profiles').upsert({ id: userId, linkedin_url: linkValue || null, bio: bioValue || null, updated_at: new Date().toISOString() });
      save.then(function (result) {
        if (result.error) {
          submit.disabled = false;
          submit.textContent = 'Save my profile';
          errorEl.textContent = "Couldn't save that: " + result.error.message;
          errorEl.hidden = false;
          return;
        }
        saved = true;
        var complete = !!(bioValue && linkValue);
        setState('profile_prompt', Object.assign({}, getState('profile_prompt') || {}, complete ? { done: true } : { next_due_at: daysFromNow(14) }));
        dialog.innerHTML = '<div class="guide-done"><span class="guide-done-tick" aria-hidden="true">&#10003;</span><h2 class="guide-title">Saved</h2><p class="guide-text">' +
          (complete ? 'Your Network profile is all set.' : 'Thanks - you can add the rest any time from your Members Hub.') + '</p></div>';
        setTimeout(function () { close(null); }, 1500);
      });
    });
  }

  // =======================================================================
  // 3. Guided tour.
  // =======================================================================
  // Each step: where it happens (page), what it points at (target: first
  // visible selector wins; null = centred card), and what to say. A step
  // marked optional is skipped when its target isn't on screen (e.g. a
  // card hidden for this person by Hub Access).
  var HUB = 'member-hub.html';
  var STEPS = [
    { page: HUB, target: null, title: 'Welcome to LACMS', body: 'This short tour shows you around the Members Hub first, then the rest of the site. It takes about two minutes, and you can leave at any time.' },
    { page: HUB, target: ['#member-card-member', '#member-card-professional'], title: 'Your membership card', body: 'Your digital membership card, with your name and membership number. Keep it handy - it\'s how you show you\'re a member.' },
    { page: HUB, target: ['[data-tour="details"]'], title: 'Your details', body: 'Your account at a glance. From here you can edit your Network profile (a short bio and your LinkedIn), change your password, or log out.', optional: true },
    { page: HUB, target: ['#member-feed-section'], title: 'News & updates', body: 'Announcements from the committee appear here, newest first.', optional: true },
    { page: HUB, target: ['#perks-card'], title: 'Discounts & opportunities', body: 'Partner discount codes and opportunities shared with members before anyone else.', optional: true },
    { page: HUB, target: ['#resources-card', '#resources-locked-card'], title: 'LACMS Resources', body: 'A library of study resources - notes, past papers, websites and more - shared by members and organised by course. Members can add their own too.', optional: true },
    { page: HUB, target: ['#sankofa-apply-card'], title: 'Sankofa Circles', body: 'Our mentorship programme. Medicine members can apply here to be matched into a Circle of mentors and mentees.', optional: true },
    { page: HUB, target: ['#network-card', '#network-locked-card'], title: 'The LACMS Network', body: 'A directory of members and the professionals supporting us. It\'s being built right now and opens up soon.', optional: true },
    { page: HUB, target: ['a.quick-link-card[href="events.html"]'], title: 'Events', body: 'See what\'s coming up and register for events straight from your account.', optional: true },
    { page: HUB, target: ['#motm-nominate-card'], title: 'Member of the Month', body: 'Nominate someone who\'s gone above and beyond - the winner and runners-up win exciting LACMS prizes.', optional: true },
    { page: HUB, target: ['#member-hub-mmg-section'], title: 'Midlands Medics Gala', body: 'If you\'re part of the Gala, your updates from the committee show up here.', optional: true },
    { page: HUB, target: ['#president-dashboard-card'], title: 'Platform dashboard', body: 'The committee\'s tools for running LACMS - you only see this because you\'ve been given access.', optional: true },
    { page: HUB, target: ['.notif-bell'], title: 'Notifications', body: 'The bell shows how much new content has appeared since you last looked - discounts, events, news and more. Open it to jump straight there.', optional: true },
    { page: HUB, target: ['[data-theme-toggle]'], title: 'Light or dark', body: 'Switch between light and dark mode any time.', optional: true },
    { page: HUB, target: ['.nav-links', '.nav-toggle'], title: 'Finding your way around', body: 'The menu takes you to every page on the site. Now let\'s look at some of them.', optional: true },

    { page: 'member-perks.html', target: ['#discounts-list'], title: 'Partner discounts', body: 'Tap a card to see the details and your code. Use "I used this" to keep track of what you\'ve redeemed - there\'s a few seconds to undo a mis-tap.', optional: true },
    { page: 'events.html', target: ['.event-list'], title: 'Events', body: 'Open any event for the details, and use Register to reserve your place. You can cancel a registration from here too.' },
    { page: 'programmes.html', target: ['.programme-card'], title: 'Programmes', body: 'What LACMS runs beyond events - mentorship, study skills, widening access and more.', optional: true },
    { page: 'opportunities.html', target: ['#opportunities-list', '#opportunities-locked-wrap'], title: 'Opportunities', body: 'Work experience, bursaries and volunteering shared by the society.', optional: true },
    { page: 'motm.html', target: ['#nominate'], title: 'Nominate for Member of the Month', body: 'Tell us who deserves recognition and why. The winner and runners-up win exciting LACMS prizes - and you can nominate once a month.' },
    { page: 'news.html', target: ['#news-feed-list', '#main .section'], title: 'News', body: 'Stories from the society. Members can like and comment on posts.' },
    { page: 'gallery.html', target: ['#gallery-submit-form-wrap', '#main .section'], title: 'Gallery', body: 'Photos from our events - and you can send in your own for the committee to feature.', optional: true },
    { page: 'about.html', target: ['#committee'], title: 'Meet the committee', body: 'The people who run LACMS. Tap a card to read their story.' },
    { page: HUB, target: null, title: 'You\'re all set', body: 'That\'s the tour. You can replay it any time with "Take the tour" at the top of your Members Hub. Enjoy LACMS!', last: true }
  ];

  var tourDom = null;
  var tourIndex = 0;
  var tourDirection = 1;
  var tourRaf = null;
  var tourShownOnThisPage = false;

  function tourSaved() {
    var raw = sget('lacms-tour');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function tourSave(i) { sset('lacms-tour', JSON.stringify({ i: i })); }

  function startTour() {
    tourSave(0);
    if (page !== STEPS[0].page) {
      sset('lacms-tour-nav', STEPS[0].page);
      window.location.href = STEPS[0].page;
      return;
    }
    tourDirection = 1;
    resumeTour(0);
  }

  function resumeTour(i) {
    tourRunning = true;
    overlayOpen = true;
    tourIndex = i;
    buildTourDom();
    showTourStep(i, tourDirection);
  }

  function endTour(status) {
    tourRunning = false;
    overlayOpen = false;
    sdel('lacms-tour');
    sdel('lacms-tour-nav');
    if (tourRaf) cancelAnimationFrame(tourRaf);
    document.removeEventListener('keydown', onTourKey, true);
    window.removeEventListener('resize', scheduleReposition);
    window.removeEventListener('scroll', scheduleReposition, true);
    if (tourDom) {
      var dom = tourDom;
      tourDom = null;
      dom.root.classList.remove('is-in');
      setTimeout(function () { dom.root.remove(); }, reduceMotion ? 0 : 200);
    }
    if (status) setState('tour', { status: status, at: new Date().toISOString(), step: tourIndex });
  }

  function buildTourDom() {
    if (tourDom) return;
    var root = el('div', 'tour-root');
    var blocker = el('div', 'tour-blocker');
    var spot = el('div', 'tour-spot');
    var card = el('div', 'tour-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'tour-title');
    card.innerHTML =
      '<button type="button" class="guide-close" data-tour-skip aria-label="End tour">&times;</button>' +
      '<div class="tour-progress" aria-hidden="true"><span class="tour-progress-bar"></span></div>' +
      '<span class="guide-eyebrow" id="tour-step-label"></span>' +
      '<h2 class="guide-title" id="tour-title"></h2>' +
      '<p class="guide-text" id="tour-body"></p>' +
      '<div class="tour-nav"><button type="button" class="guide-linkbtn" data-tour-skip>Skip tour</button>' +
      '<div class="tour-nav-btns"><button type="button" class="btn btn-outline" data-tour-back>Back</button>' +
      '<button type="button" class="btn btn-primary" data-tour-next>Next</button></div></div>' +
      '<div class="visually-hidden" aria-live="polite" id="tour-live"></div>';
    root.appendChild(blocker);
    root.appendChild(spot);
    root.appendChild(card);
    document.body.appendChild(root);
    tourDom = { root: root, spot: spot, card: card, target: null };

    card.addEventListener('click', function (e) {
      if (e.target.closest('[data-tour-next]')) tourNext();
      else if (e.target.closest('[data-tour-back]')) tourBack();
      else if (e.target.closest('[data-tour-skip]')) endTour('skipped');
    });
    document.addEventListener('keydown', onTourKey, true);
    window.addEventListener('resize', scheduleReposition);
    window.addEventListener('scroll', scheduleReposition, true);
    requestAnimationFrame(function () { root.classList.add('is-in'); });
  }

  function onTourKey(e) {
    if (!tourRunning) return;
    if (e.key === 'Escape') { e.preventDefault(); endTour('skipped'); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); tourNext(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); tourBack(); }
    else if (e.key === 'Tab' && tourDom) trapFocus(e, tourDom.card);
  }

  function findTarget(step) {
    if (!step.target) return null;
    for (var i = 0; i < step.target.length; i++) {
      var found = document.querySelector(step.target[i]);
      if (found && isVisible(found)) return found;
    }
    return null;
  }

  function goToStep(i) {
    var step = STEPS[i];
    tourIndex = i;
    tourSave(i);
    if (step.page !== page) {
      sset('lacms-tour-nav', step.page);
      tourDom && tourDom.card.classList.add('is-loading');
      window.location.href = step.page;
      return;
    }
    showTourStep(i, tourDirection);
  }
  function tourNext() {
    if (tourIndex >= STEPS.length - 1) { endTour('completed'); return; }
    tourDirection = 1;
    goToStep(tourIndex + 1);
  }
  function tourBack() {
    if (tourIndex <= 0) return;
    tourDirection = -1;
    goToStep(tourIndex - 1);
  }

  // Shows a step once its target has appeared (cards and lists fill in
  // after the page's own data loads), skipping optional steps whose
  // target never does.
  function showTourStep(i, direction) {
    var step = STEPS[i];
    var started = Date.now();
    var token = {};
    showTourStep.token = token;
    // The first step after a page loads gets a few seconds for its
    // content to arrive; later steps on the same page are already
    // there, so a missing optional target is skipped almost at once.
    var maxWait = tourShownOnThisPage ? 600 : 5000;

    (function wait() {
      if (showTourStep.token !== token || !tourRunning) return;
      var target = findTarget(step);
      if (target || !step.target || Date.now() - started > maxWait) {
        if (!target && step.target && step.optional) {
          // Not available to this person / not on screen - move along.
          var next = i + direction;
          if (next < 0) { next = i + 1; direction = 1; }
          if (next >= STEPS.length) { endTour('completed'); return; }
          tourDirection = direction;
          goToStep(next);
          return;
        }
        tourShownOnThisPage = true;
        renderTourStep(i, target);
        return;
      }
      setTimeout(wait, 100);
    })();
  }

  function renderTourStep(i, target) {
    var step = STEPS[i];
    tourDom.target = target;
    var card = tourDom.card;
    card.classList.remove('is-loading');
    card.querySelector('#tour-step-label').textContent = 'Step ' + (i + 1) + ' of ' + STEPS.length;
    card.querySelector('#tour-title').textContent = step.title;
    card.querySelector('#tour-body').textContent = step.body;
    card.querySelector('.tour-progress-bar').style.width = Math.round(((i + 1) / STEPS.length) * 100) + '%';
    card.querySelector('[data-tour-back]').disabled = i === 0;
    card.querySelector('[data-tour-next]').textContent = step.last || i === STEPS.length - 1 ? 'Finish' : (STEPS[i + 1] && STEPS[i + 1].page !== step.page ? 'Next page' : 'Next');
    card.querySelector('#tour-live').textContent = step.title;

    tourToken = {};
    if (target) ensureVisible(target, 0, tourToken);
    positionTour();
    setTimeout(positionTour, reduceMotion ? 50 : 450);
    var nextBtn = card.querySelector('[data-tour-next]');
    if (nextBtn) nextBtn.focus({ preventScroll: true });
  }

  // Brings the target on screen (clear of the sticky header and, on
  // phones, of the bottom sheet). Smooth first, then - since content
  // above can still be shifting as the page settles - re-checks and
  // jumps if it hasn't landed.
  var tourToken = null;
  function ensureVisible(target, attempt, token) {
    if (!tourRunning || tourToken !== token || !document.body.contains(target)) return;
    var vh = window.innerHeight;
    var narrow = window.innerWidth < 640;
    var r = target.getBoundingClientRect();
    var bottomLimit = vh - (narrow ? 230 : 24);
    var tooTall = r.height > (bottomLimit - 70);
    var ok = tooTall ? (r.top >= 50 && r.top <= vh * 0.45) : (r.top >= 70 && r.bottom <= bottomLimit);
    if (ok) { positionTour(); return; }
    var y = tooTall
      ? r.top + window.pageYOffset - 80
      : r.top + window.pageYOffset - Math.max(80, (bottomLimit - r.height) / 2);
    window.scrollTo({ top: Math.max(0, y), behavior: (attempt === 0 && !reduceMotion) ? 'smooth' : 'auto' });
    if (attempt < 4) setTimeout(function () { ensureVisible(target, attempt + 1, token); }, attempt === 0 ? 500 : 200);
    else positionTour();
  }

  function scheduleReposition() {
    if (tourRaf) return;
    tourRaf = requestAnimationFrame(function () { tourRaf = null; positionTour(); });
  }

  function positionTour() {
    if (!tourDom) return;
    var spot = tourDom.spot;
    var card = tourDom.card;
    var target = tourDom.target;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var pad = 8;
    var narrow = vw < 640;

    if (!target || !document.body.contains(target)) {
      spot.classList.add('is-hidden');
      card.classList.add('is-centered');
      card.style.top = '';
      card.style.left = '';
      return;
    }
    card.classList.remove('is-centered');
    spot.classList.remove('is-hidden');

    var r = target.getBoundingClientRect();
    // Clip to the viewport so a very tall target highlights what's visible.
    var top = Math.max(r.top - pad, 4);
    var bottom = Math.min(r.bottom + pad, vh - 4);
    var left = Math.max(r.left - pad, 4);
    var right = Math.min(r.right + pad, vw - 4);
    // A very tall target (a whole list) only has its top highlighted, so
    // there's always room for the card beside/below it.
    var maxSpot = narrow ? vh * 0.34 : vh * 0.5;
    if (bottom - top > maxSpot) bottom = top + maxSpot;
    if (bottom <= top || right <= left) {
      spot.classList.add('is-hidden');
    }
    spot.style.top = top + 'px';
    spot.style.left = left + 'px';
    spot.style.width = (right - left) + 'px';
    spot.style.height = Math.max(0, bottom - top) + 'px';

    if (narrow) {
      // Bottom sheet on phones.
      card.style.top = '';
      card.style.left = '';
      return;
    }
    var cw = card.offsetWidth;
    var ch = card.offsetHeight;
    var spaceBelow = vh - bottom;
    var spaceAbove = top;
    var y;
    if (spaceBelow >= ch + 16) y = bottom + 12;
    else if (spaceAbove >= ch + 16) y = top - ch - 12;
    else if (vh - ch - 28 - top >= 120) {
      // Neither side has room: shrink the highlight so the card fits below it.
      bottom = vh - ch - 28;
      spot.style.height = (bottom - top) + 'px';
      y = bottom + 12;
    } else y = Math.max(12, Math.min(vh - ch - 12, vh / 2 - ch / 2));
    var x = Math.max(12, Math.min(vw - cw - 12, (left + right) / 2 - cw / 2));
    card.style.top = Math.round(y) + 'px';
    card.style.left = Math.round(x) + 'px';
  }

  function trapFocus(e, container) {
    var focusable = container.querySelectorAll('button:not([disabled]), a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!container.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  }

  // ---- The one-time offer, on the hub -----------------------------------
  function maybeOfferTour(ctx) {
    var st = getState('tour');
    if (st) return; // offered before - it's a one-time offer
    var tries = 0;
    (function attempt() {
      var content = document.getElementById('member-hub-content');
      // A brand-new member first has to accept the terms (its own modal
      // on the hub) - the offer waits until that's out of the way rather
      // than stacking a second dialog on top.
      var terms = document.getElementById('terms-gate-modal');
      var termsOpen = terms && window.getComputedStyle(terms).display !== 'none';
      if (!content || content.style.display === 'none' || termsOpen) {
        if (++tries < 900) setTimeout(attempt, 400);
        return;
      }
      setTimeout(function () {
        if (overlayOpen || tourRunning || getState('tour')) return;
        var stillTerms = document.getElementById('terms-gate-modal');
        if (stillTerms && window.getComputedStyle(stillTerms).display !== 'none') { attempt(); return; }
        openTourOffer(ctx);
      }, 1200);
    })();
  }

  function openTourOffer(ctx) {
    overlayOpen = true;
    var previouslyFocused = document.activeElement;
    var nameEl = document.querySelector('[data-member-name-inline]');
    var first = (nameEl && nameEl.textContent && nameEl.textContent !== 'member' ? nameEl.textContent : (ctx.member && ctx.member.full_name) || '').trim().split(/\s+/)[0];

    var backdrop = el('div', 'guide-backdrop');
    var dialog = el('div', 'guide-dialog guide-dialog--offer');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'tour-offer-title');
    dialog.innerHTML =
      '<span class="guide-eyebrow">Welcome</span>' +
      '<h2 class="guide-title" id="tour-offer-title">' + (first ? 'Welcome to LACMS, ' + escapeHtml(first) + '!' : 'Welcome to LACMS!') + '</h2>' +
      '<p class="guide-text">Would you like a quick tour? We\'ll walk you through everything on your Members Hub, then the rest of the site. It takes about two minutes.</p>' +
      '<div class="guide-actions guide-actions--stack"><button type="button" class="btn btn-primary btn-block" data-offer-yes>Show me around</button>' +
      '<button type="button" class="btn btn-outline btn-block" data-offer-later>Maybe later</button></div>' +
      '<p class="guide-fine">You can start the tour whenever you like from "Take the tour" at the top of this page.</p>';
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    document.body.classList.add('guide-open');
    requestAnimationFrame(function () { backdrop.classList.add('is-in'); dialog.querySelector('[data-offer-yes]').focus(); });
    setState('tour', { status: 'offered', at: new Date().toISOString() });

    function close(status, thenStart) {
      document.removeEventListener('keydown', onKey, true);
      backdrop.classList.remove('is-in');
      document.body.classList.remove('guide-open');
      overlayOpen = false;
      setTimeout(function () { backdrop.remove(); }, reduceMotion ? 0 : 200);
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
      if (status) setState('tour', { status: status, at: new Date().toISOString() });
      if (thenStart) startTour();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close('later'); }
      else if (e.key === 'Tab') trapFocus(e, dialog);
    }
    document.addEventListener('keydown', onKey, true);
    dialog.addEventListener('click', function (e) {
      if (e.target.closest('[data-offer-yes]')) close('started', true);
      else if (e.target.closest('[data-offer-later]')) close('later');
    });
  }


  // =======================================================================
  // 4. "New" tags on pages someone has recently been given access to.
  // =======================================================================
  // Access is decided by the Hub Access rules (and per-person overrides), so
  // there's no per-user "granted on" date in the database. Instead this
  // remembers, per person (user_ui_state key hub_access_seen), when each
  // feature FIRST showed up as allowed for them. The first time it runs it
  // records everything they already have as "baseline" (not new); after
  // that, any feature that becomes allowed is tagged "New" until they open
  // it or 14 days pass. Losing access and getting it back counts as new.
  var NEW_ACCESS_DAYS = 14;
  var ACCESS_PAGES = { 'member-perks.html': 'perks', 'member-sankofa.html': 'sankofa', 'member-network.html': 'network', 'member-resources.html': 'resources' };
  var HUB_ACCESS_CARDS = { perks: 'perks-card', sankofa: 'sankofa-apply-card', network: 'network-card', resources: 'resources-card', motm_nominate: 'motm-nominate-card' };
  var DASH_SECTION_FOR = { dash_mmg: 'mmg', dash_sankofa: 'sankofa', dash_motm: 'motm', dash_events: 'events', dash_gallery: 'gallery' };
  var accessSeen = null;

  function saveAccessSeen() { return setState('hub_access_seen', accessSeen); }

  function trackAccess(ctx) {
    var st = getState('hub_access_seen') || {};
    accessSeen = { baselined: !!st.baselined, first: st.first || {}, opened: st.opened || {}, announced: st.announced || {} };
    if (!ctx.access) return;
    var now = new Date().toISOString();
    var changed = false;
    Object.keys(ctx.access).forEach(function (f) {
      if (ctx.access[f]) {
        if (!accessSeen.first[f]) { accessSeen.first[f] = accessSeen.baselined ? now : 'baseline'; changed = true; }
      } else if (accessSeen.first[f]) {
        delete accessSeen.first[f];
        delete accessSeen.opened[f];
        delete accessSeen.announced[f];
        changed = true;
      }
    });
    if (!accessSeen.baselined) { accessSeen.baselined = true; changed = true; }
    // Landing on the feature's own page counts as opening it.
    var here = ACCESS_PAGES[page];
    if (here && accessSeen.first[here] && accessSeen.first[here] !== 'baseline' && !accessSeen.opened[here]) {
      accessSeen.opened[here] = now;
      changed = true;
    }
    if (changed) saveAccessSeen();
  }

  function isNewAccess(f) {
    var t = accessSeen && accessSeen.first[f];
    if (!t || t === 'baseline' || accessSeen.opened[f]) return false;
    return Date.now() - new Date(t).getTime() < NEW_ACCESS_DAYS * 86400000;
  }
  function anyNewDash() {
    return Object.keys(DASH_SECTION_FOR).some(isNewAccess) && !(accessSeen.opened.dash_card);
  }

  function waitFor(test, then) {
    var tries = 0;
    (function attempt() {
      var ok = false;
      try { ok = test(); } catch (e) { ok = false; }
      if (ok) { then(); return; }
      if (++tries < 80) setTimeout(attempt, 250);
    })();
  }

  function addNewTag(host, key, where) {
    if (!host || host.querySelector('.new-access-tag')) return;
    var tag = el('span', 'new-access-tag', '<span class="new-access-dot" aria-hidden="true"></span>New');
    tag.setAttribute('title', 'You were recently given access to this');
    host.setAttribute('data-new-feature', key);
    if (where) where(tag); else host.insertBefore(tag, host.firstChild);
  }

  function tagNewAccess() {
    if (!accessSeen) return;
    if (page === HUB) {
      waitFor(function () { var l = document.getElementById('member-hub-content-links'); return l && l.style.display !== 'none'; }, function () {
        Object.keys(HUB_ACCESS_CARDS).forEach(function (f) {
          if (!isNewAccess(f)) return;
          var card = document.getElementById(HUB_ACCESS_CARDS[f]);
          if (!card || card.style.display === 'none') return;
          var firstTag = card.querySelector('.card-tag');
          addNewTag(card, f, function (tag) { if (firstTag) firstTag.parentNode.insertBefore(tag, firstTag.nextSibling); else card.insertBefore(tag, card.firstChild); });
        });
        var dashCard = document.getElementById('president-dashboard-card');
        if (dashCard && dashCard.style.display !== 'none' && anyNewDash()) {
          var dTag = dashCard.querySelector('.card-tag');
          addNewTag(dashCard, 'dash_card', function (tag) { if (dTag) dTag.parentNode.insertBefore(tag, dTag.nextSibling); else dashCard.insertBefore(tag, dashCard.firstChild); });
        }
      });
    } else if (page === 'president-dashboard.html') {
      waitFor(function () { var c = document.getElementById('president-content'); return c && c.style.display !== 'none'; }, function () {
        Object.keys(DASH_SECTION_FOR).forEach(function (f) {
          if (!isNewAccess(f)) return;
          var card = document.querySelector('[data-dash-section="' + DASH_SECTION_FOR[f] + '"]');
          if (!card || card.style.display === 'none') return;
          var title = card.querySelector('.dash-nav-card-title');
          addNewTag(card, f, function (tag) { if (title) title.appendChild(tag); else card.insertBefore(tag, card.firstChild); });
        });
      });
    }
  }

  // Clicking a tagged card counts as opening it (saved locally straight
  // away, since the page is about to navigate).
  document.addEventListener('click', function (e) {
    var host = e.target.closest && e.target.closest('[data-new-feature]');
    if (!host || !accessSeen) return;
    var key = host.getAttribute('data-new-feature');
    accessSeen.opened[key] = new Date().toISOString();
    var tag = host.querySelector('.new-access-tag');
    if (tag) tag.remove();
    host.removeAttribute('data-new-feature');
    saveAccessSeen();
  }, true);


  // =======================================================================
  // 5. "What's new for you" - a short summary when someone signs in.
  // =======================================================================
  // Pulls three things together: pages they've just been given access to
  // (section 4), things waiting on them (a nomination or application they
  // haven't made, a resource they shared that's been reviewed, and for
  // reviewers the queue of resources / account requests), and content
  // published since they were last here (the bell's counts, snapshotted by
  // js/notifications.js before the page marks its own section as seen).
  //
  // It appears once per sign-in (or once per browser session when they
  // return to a still-signed-in browser, and not within 3 hours of the last
  // time), only when there's something to say, never over the welcome
  // tour, the terms gate or another dialog, and can be switched off from the
  // dialog itself. The bell's "What's new for you" link reopens it any time.
  // What's remembered: user_ui_state key welcome_seen (migration 069) =
  // { at: when it last appeared, off: they asked not to see it }.
  var DIGEST_GAP_MS = 3 * 3600 * 1000;
  var DIGEST_SKIP_PAGES = ['member-login.html', 'login.html', 'request-account.html', 'join.html', 'mmg-login.html'];
  var ACCESS_COPY = {
    perks: { title: 'Discounts & opportunities', sub: 'Member discounts, offers and opportunities', href: 'member-perks.html' },
    sankofa: { title: 'Sankofa', sub: 'Apply to join a Sankofa Circle', href: 'member-sankofa.html' },
    network: { title: 'The Network', sub: 'Connect with LACMS members and professionals', href: 'member-network.html' },
    motm_nominate: { title: 'Member of the Month nominations', sub: 'Nominate someone - the winner and runners-up win prizes', href: 'motm.html#nominate' },
    resources: { title: 'LACMS Resources', sub: 'Study resources shared by LACMS members', href: 'member-resources.html' }
  };
  var DASH_LABELS = { dash_mmg: 'Midlands Medics Gala', dash_sankofa: 'Sankofa', dash_motm: 'Member of the Month', dash_events: 'Events', dash_gallery: 'Gallery' };
  var ICONS = {
    spark: '<path d="M12 3l2.1 5.4L20 10l-5.9 1.6L12 17l-2.1-5.4L4 10l5.9-1.6z"/><path d="M19 17v4M17 19h4"/>',
    todo: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4.5M12 16h.01"/>',
    inbox: '<path d="M3 13l2.5-7.5A2 2 0 0 1 7.4 4h9.2a2 2 0 0 1 1.9 1.5L21 13"/><path d="M3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5h-5l-1.5 2h-5L8 13z"/>'
  };
  var digestBusy = false;

  // A fresh sign-in always gets its summary, even in a browser that's
  // shown one recently - flagged here, then picked up on the page they land on.
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f && (f.id === 'login-form' || f.id === 'mmg-signin-form')) sset('lacms-signed-in-now', '1');
  }, true);

  function iconSvg(name) {
    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.bell) + '</svg>';
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function agoText(ms) {
    var mins = Math.floor((Date.now() - ms) / 60000);
    if (mins < 60) return 'less than an hour ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return plural(hrs, 'hour', 'hours') + ' ago';
    var days = Math.floor(hrs / 24);
    if (days === 1) return 'yesterday';
    if (days < 14) return days + ' days ago';
    return plural(Math.floor(days / 7), 'week', 'weeks') + ' ago';
  }
  function withTimeout(promise, ms, fallback) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(fallback); } }, ms);
      promise.then(function (v) { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
        function () { if (!done) { done = true; clearTimeout(timer); resolve(fallback); } });
    });
  }
  function termsGateOpen() {
    var terms = document.getElementById('terms-gate-modal');
    return !!(terms && window.getComputedStyle(terms).display !== 'none');
  }

  // Each loader answers "nothing" rather than throwing, so one missing
  // table or a failed request never blocks the rest of the summary.
  function loadReviewedResources(sinceMs) {
    return supabaseClient.from('resources')
      .select('id, title, status, reviewed_by, reviewed_at, reject_reason')
      .eq('uploader_id', userId).in('status', ['approved', 'rejected'])
      .gt('reviewed_at', new Date(sinceMs).toISOString())
      .order('reviewed_at', { ascending: false }).limit(20)
      .then(function (r) {
        // Executives' own uploads are approved on the spot - not news.
        return r.error ? [] : (r.data || []).filter(function (x) { return x.reviewed_by !== userId; });
      }, function () { return []; });
  }
  function loadReviewQueue() {
    return supabaseClient.rpc('get_resource_counts').then(function (r) {
      if (r.error) return 0;
      return (r.data || []).reduce(function (sum, row) { return sum + (row.pending_count || 0); }, 0);
    }, function () { return 0; });
  }
  function loadPendingRequests() {
    return supabaseClient.rpc('is_president').then(function (r) {
      if (r.error || r.data !== true) return 0;
      return supabaseClient.rpc('president_get_account_requests').then(function (rows) {
        if (rows.error) return 0;
        return (rows.data || []).filter(function (x) { return x.status === 'pending'; }).length;
      });
    }, function () { return 0; });
  }

  // Returns { groups: [{ title, items: [...] }], total, newAccess: [features] }.
  function buildDigest(ctx, manual) {
    var st = getState('welcome_seen') || {};
    var sinceMs = st.at ? Math.max(new Date(st.at).getTime(), Date.now() - 30 * 86400000) : Date.now() - 14 * 86400000;

    return Promise.all([
      withTimeout(window.lacmsNotifSnapshot || Promise.resolve(null), 6000, null),
      withTimeout(loadReviewedResources(sinceMs), 6000, []),
      withTimeout(loadReviewQueue(), 6000, 0),
      withTimeout(loadPendingRequests(), 6000, 0)
    ]).then(function (res) {
      var snapshot = res[0] || [];
      var reviewed = res[1];
      var queue = res[2];
      var requests = res[3];
      var groups = [];
      var announce = [];

      // -- New access
      var access = [];
      Object.keys(ACCESS_COPY).forEach(function (f) {
        if (!isNewAccess(f) || (!manual && accessSeen.announced[f])) return;
        var c = ACCESS_COPY[f];
        access.push({ icon: 'spark', title: c.title, sub: c.sub, href: c.href, tag: 'New', features: [f] });
        announce.push(f);
      });
      var dash = Object.keys(DASH_LABELS).filter(function (f) { return isNewAccess(f) && (manual || !accessSeen.announced[f]); });
      if (dash.length) {
        access.push({
          icon: 'spark', title: 'Dashboard access',
          sub: 'You can now manage: ' + dash.map(function (f) { return DASH_LABELS[f]; }).join(', '),
          href: 'president-dashboard.html' + (dash.length === 1 ? '#' + DASH_SECTION_FOR[dash[0]] : ''),
          tag: 'New', features: dash.concat(['dash_card'])
        });
        announce = announce.concat(dash);
      }
      if (access.length) groups.push({ title: 'You\'ve been given access', items: access });

      // -- Waiting for you
      var waiting = [];
      if (requests > 0) waiting.push({ icon: 'todo', title: plural(requests, 'account request', 'account requests') + ' waiting', sub: 'Review and approve new members', href: 'president-dashboard.html#requests', count: requests });
      if (queue > 0) waiting.push({ icon: 'todo', title: plural(queue, 'resource', 'resources') + ' waiting for review', sub: 'Shared by members, hidden until you approve them', href: 'member-resources.html', count: queue });
      reviewed.slice(0, 3).forEach(function (x) {
        var ok = x.status === 'approved';
        waiting.push({
          icon: ok ? 'check' : 'alert',
          title: ok ? 'Your resource was approved' : 'Your resource wasn\'t approved',
          sub: ok ? '"' + x.title + '" is now live for everyone' : (x.reject_reason ? '"' + x.title + '" - ' + x.reject_reason : '"' + x.title + '" - see the reviewer\'s note'),
          href: 'member-resources.html'
        });
      });
      if (reviewed.length > 3) waiting.push({ icon: 'bell', title: 'And ' + (reviewed.length - 3) + ' more of your resources were reviewed', sub: 'See them in "My submissions"', href: 'member-resources.html' });
      if (ctx.nudges.sankofa) {
        var left = Math.ceil((SANKOFA_DEADLINE - Date.now()) / 86400000);
        waiting.push({
          icon: 'todo',
          title: left <= 1 ? 'Sankofa applications close today' : 'Sankofa applications close in ' + left + ' days',
          sub: 'You haven\'t applied yet - don\'t miss out', href: 'member-sankofa.html'
        });
      }
      if (ctx.nudges.motm) waiting.push({ icon: 'todo', title: 'Nominate someone for Member of the Month', sub: 'You haven\'t nominated this month - the winner and runners-up win prizes', href: 'motm.html#nominate' });
      if (waiting.length) groups.push({ title: 'Waiting for you', items: waiting });

      // -- Since you were last here
      var content = snapshot.filter(function (row) { return row.page !== page; }).map(function (row) {
        return {
          icon: 'bell', title: row.label,
          sub: plural(row.count, row.singular, row.plural) + (row.title ? ' · Latest: ' + row.title : ''),
          href: row.href, count: row.count
        };
      });
      if (content.length) groups.push({ title: 'New since you last looked', items: content });

      var total = groups.reduce(function (n, g) { return n + g.items.length; }, 0);
      return { groups: groups, total: total, announce: announce, lastAt: st.at || null, off: !!st.off };
    });
  }

  function firstNameFor(ctx) {
    var nameEl = document.querySelector('[data-member-name-inline]');
    var name = (nameEl && nameEl.textContent && nameEl.textContent !== 'member' ? nameEl.textContent : (ctx.member && ctx.member.full_name) || '').trim();
    return name.split(/\s+/)[0] || '';
  }

  function openDigest(ctx, model, manual) {
    overlayOpen = true;
    digestBusy = true;
    var previouslyFocused = document.activeElement;
    var first = firstNameFor(ctx);
    var off = model.off;

    var itemIndex = 0;
    var body = model.groups.map(function (g) {
      return '<section class="digest-group"><h3 class="digest-group-title">' + escapeHtml(g.title) + '</h3><div class="digest-list">' +
        g.items.map(function (it) {
          var attrs = it.features ? ' data-digest-open="' + escapeHtml(it.features.join(',')) + '"' : '';
          return '<a class="digest-item digest-item--' + it.icon + '" href="' + escapeHtml(it.href) + '"' + attrs + ' style="--i:' + (itemIndex++) + '">' +
            '<span class="digest-icon">' + iconSvg(it.icon) + '</span>' +
            '<span class="digest-item-main"><span class="digest-item-title">' + escapeHtml(it.title) +
            (it.tag ? ' <span class="new-access-tag"><span class="new-access-dot" aria-hidden="true"></span>' + escapeHtml(it.tag) + '</span>' : '') +
            '</span><span class="digest-item-sub">' + escapeHtml(it.sub) + '</span></span>' +
            '<span class="digest-item-end">' + (it.count ? '<span class="digest-count">' + (it.count > 99 ? '99+' : it.count) + '</span>' : '') +
            '<svg class="digest-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></span>' +
            '</a>';
        }).join('') + '</div></section>';
    }).join('');
    if (!model.total) {
      body = '<div class="digest-empty"><span class="digest-icon digest-icon--lg">' + iconSvg('inbox') + '</span>' +
        '<strong>You\'re all caught up</strong><span>Nothing new right now - new content and anything waiting on you will show up here.</span></div>';
    }

    var intro = model.total
      ? (model.lastAt ? 'You were last here ' + agoText(new Date(model.lastAt).getTime()) + '. Here\'s what\'s new for you.' : 'Here\'s what\'s new for you.')
      : 'Here\'s where things stand.';

    var backdrop = el('div', 'guide-backdrop');
    var dialog = el('div', 'guide-dialog guide-dialog--digest');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'digest-title');
    dialog.innerHTML =
      '<div class="digest-head"><span class="guide-eyebrow">' + (manual ? 'What\'s new' : 'Welcome back') + '</span>' +
      '<h2 class="guide-title" id="digest-title">' + (first && !manual ? 'Hi ' + escapeHtml(first) + ', here\'s what\'s new' : (model.total ? 'What\'s new for you' : 'What\'s new for you')) + '</h2>' +
      '<p class="guide-text">' + escapeHtml(intro) + '</p>' +
      '<button type="button" class="guide-close" data-digest-close aria-label="Close">&times;</button></div>' +
      '<div class="digest-body">' + body + '</div>' +
      '<div class="digest-foot"><button type="button" class="btn btn-primary" data-digest-close>' + (model.total ? 'Got it' : 'Close') + '</button>' +
      '<button type="button" class="guide-linkbtn" data-digest-off aria-pressed="' + (off ? 'true' : 'false') + '">' + (off ? 'Show this when I sign in' : 'Don\'t show this when I sign in') + '</button></div>';
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    document.body.classList.add('guide-open');
    requestAnimationFrame(function () { backdrop.classList.add('is-in'); var b = dialog.querySelector('.digest-foot .btn'); if (b) b.focus(); });

    if (!manual) {
      // Count it as shown now (not on close), so a refresh doesn't repeat it.
      var st = getState('welcome_seen') || {};
      setState('welcome_seen', { at: new Date().toISOString(), off: !!st.off });
      if (model.announce.length) {
        var nowIso = new Date().toISOString();
        model.announce.forEach(function (f) { accessSeen.announced[f] = nowIso; });
        saveAccessSeen();
      }
    }

    function close() {
      document.removeEventListener('keydown', onKey, true);
      backdrop.classList.remove('is-in');
      document.body.classList.remove('guide-open');
      overlayOpen = false;
      digestBusy = false;
      setTimeout(function () { backdrop.remove(); }, reduceMotion ? 0 : 200);
      if (previouslyFocused && previouslyFocused.focus && document.body.contains(previouslyFocused)) previouslyFocused.focus();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') trapFocus(e, dialog);
    }
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
    dialog.addEventListener('click', function (e) {
      if (e.target.closest('[data-digest-close]')) { close(); return; }
      var offBtn = e.target.closest('[data-digest-off]');
      if (offBtn) {
        off = !off;
        var cur = getState('welcome_seen') || {};
        setState('welcome_seen', { at: cur.at || new Date().toISOString(), off: off });
        offBtn.setAttribute('aria-pressed', off ? 'true' : 'false');
        offBtn.textContent = off ? 'Show this when I sign in' : 'Don\'t show this when I sign in';
        return;
      }
      var link = e.target.closest('a.digest-item');
      if (link) {
        // Following a "new access" row counts as opening that page.
        var keys = (link.getAttribute('data-digest-open') || '').split(',').filter(Boolean);
        if (keys.length && accessSeen) {
          var t = new Date().toISOString();
          keys.forEach(function (f) { if (accessSeen.first[f] || f === 'dash_card') accessSeen.opened[f] = t; });
          saveAccessSeen();
        }
        // Same page (e.g. #nominate on the page they're already on)? Just close.
        var url = new URL(link.href, window.location.href);
        if (url.pathname === window.location.pathname) close();
      }
    });
  }

  // Waits until nothing else is asking for their attention.
  function whenQuiet(then) {
    var tries = 0;
    (function attempt() {
      var content = page === HUB ? document.getElementById('member-hub-content') : null;
      var hubReady = page !== HUB || (content && content.style.display !== 'none');
      if (!overlayOpen && !tourRunning && !digestBusy && !termsGateOpen() && hubReady && !sget('lacms-tour')) { then(); return; }
      if (++tries < 75) setTimeout(attempt, 400);
    })();
  }

  function maybeShowDigest(ctx) {
    if (DIGEST_SKIP_PAGES.indexOf(page) !== -1) return;
    var forced = sget('lacms-signed-in-now') === '1';
    var shownKey = 'lacms-digest-shown:' + userId;
    var st = getState('welcome_seen') || {};
    sdel('lacms-signed-in-now');
    if (st.off) return;
    if (!forced) {
      if (sget(shownKey) === '1') return;
      if (st.at && Date.now() - new Date(st.at).getTime() < DIGEST_GAP_MS) { sset(shownKey, '1'); return; }
    }
    // A brand-new member gets the welcome tour offer first; this starts from their next visit.
    if (ctx.member && !getState('tour')) return;
    if (/[?&]tour=1\b/.test(window.location.search)) return;
    sset(shownKey, '1');

    buildDigest(ctx, false).then(function (model) {
      if (!model.total) return;
      whenQuiet(function () { openDigest(ctx, model, false); });
    }, function () { /* never block the page over a summary */ });
  }

  // The bell's "What's new for you" link.
  document.addEventListener('lacms:open-digest', function () {
    if (!userId || !accessSeen || overlayOpen || tourRunning || digestBusy) return;
    digestBusy = true;
    getContext().then(function (ctx) {
      return buildDigest(ctx, true).then(function (model) {
        digestBusy = false;
        openDigest(ctx, model, true);
      });
    }).then(null, function () { digestBusy = false; });
  });

  // ---- Wiring -------------------------------------------------------------
  function revealTourLinks() {
    document.querySelectorAll('[data-start-tour]').forEach(function (b) { b.hidden = false; });
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-start-tour]')) {
      e.preventDefault();
      if (!tourRunning && !overlayOpen) startTour();
    }
  });
  document.addEventListener('lacms:network-opened', function () { if (userId) maybePromptProfile(); });

  function init(sess) {
    session = sess;
    userId = sess.user.id;
    revealTourLinks();

    loadState().then(function () {
      getContext().then(function (ctx) { trackAccess(ctx); tagNewAccess(); maybeShowDigest(ctx); });
      // Resume a tour that's mid-way (we navigated here as part of it).
      var saved = tourSaved();
      var navFlag = sget('lacms-tour-nav');
      if (saved && typeof saved.i === 'number' && STEPS[saved.i]) {
        if (navFlag === page || STEPS[saved.i].page === page && navFlag === null) {
          sdel('lacms-tour-nav');
          if (STEPS[saved.i].page === page) {
            resumeTour(saved.i);
            return;
          }
        }
        // They wandered off mid-tour: it's over rather than yanking them back.
        sdel('lacms-tour');
        sdel('lacms-tour-nav');
      }

      if (/[?&]tour=1\b/.test(window.location.search)) {
        window.history.replaceState(null, '', window.location.pathname + window.location.hash);
        startTour();
        return;
      }

      getContext().then(function (ctx) {
        if (page === HUB) maybeOfferTour(ctx);
      });
      startNudges();
    });
  }

  supabaseClient.auth.getSession().then(function (result) {
    var sess = result.data && result.data.session;
    if (sess) init(sess);
  });
})();
