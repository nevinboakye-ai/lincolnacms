// Event feedback (migration 100): the form on feedback.html.
//
//   event  ->  who (member signs in, guest gives an email)  ->  a short form  ->  thanks
//
// The form is built to take about a minute: a rating, tap-to-pick "what went well" and
// "what could be better" reasons that change with the kind of event, a "would you
// come again", and an optional comment with sentence starters. Nothing is lost if
// someone has to sign in halfway: their answers are kept in this browser and come back.
// Guests need no account; afterwards they are shown what members get and how to join.
//
// Everything that matters is checked in the database (the event is real and has
// happened, one response each, valid answers) - this only draws it.
(function () {
  'use strict';

  var root = document.getElementById('fb-root');
  if (!root) return;
  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) {
    root.innerHTML = '<div class="form-note"><span>Feedback isn’t connected yet. Email <a href="mailto:acms@lincolnsu.com" style="color: var(--color-gold-light);">acms@lincolnsu.com</a> and we’ll listen the old-fashioned way.</span></div>';
    return;
  }

  var LIKED = {
    atmosphere: 'Great atmosphere', organised: 'Well organised', value: 'Good value', people: 'Lovely people',
    welcome: 'Felt welcome', fun: 'Fun activities', food: 'Food & drink', venue: 'Great venue',
    content: 'Interesting content', speakers: 'Brilliant speakers', practical: 'Practical & useful',
    mentor: 'Supportive mentors', cause: 'A cause worth backing', learned: 'Learned something new'
  };
  var IMPROVE = {
    venue: 'Venue or location', timing: 'Date or time', communication: 'Communication beforehand', crowded: 'Too crowded',
    length: 'Length or pacing', cost: 'Cost', food: 'Food & drink', access: 'Accessibility',
    organisation: 'Organisation on the day', content: 'Content or format', av: 'Sound or screens', activities: 'More to do'
  };
  // Which suggestions to show first, by the kind of event (the tag on the event).
  var CHIPS = {
    _default: { liked: ['atmosphere', 'organised', 'people', 'welcome', 'fun', 'value', 'venue', 'food'], improve: ['venue', 'timing', 'communication', 'organisation', 'crowded', 'cost', 'food', 'length'] },
    Social: { liked: ['atmosphere', 'people', 'welcome', 'fun', 'food', 'venue', 'organised', 'value'], improve: ['venue', 'timing', 'communication', 'crowded', 'cost', 'food', 'activities', 'length'] },
    Mentorship: { liked: ['mentor', 'welcome', 'content', 'people', 'practical', 'learned', 'organised', 'atmosphere'], improve: ['timing', 'communication', 'organisation', 'content', 'length', 'venue', 'activities', 'crowded'] },
    Careers: { liked: ['speakers', 'practical', 'learned', 'content', 'organised', 'people', 'value', 'venue'], improve: ['content', 'timing', 'length', 'communication', 'organisation', 'venue', 'av', 'activities'] },
    Academic: { liked: ['speakers', 'learned', 'content', 'practical', 'organised', 'people', 'value', 'venue'], improve: ['content', 'timing', 'length', 'communication', 'organisation', 'venue', 'av', 'activities'] },
    Charity: { liked: ['cause', 'fun', 'atmosphere', 'people', 'organised', 'value', 'welcome', 'venue'], improve: ['communication', 'cost', 'organisation', 'timing', 'venue', 'crowded', 'food', 'activities'] },
    'Flagship Event': { liked: ['atmosphere', 'organised', 'food', 'fun', 'venue', 'people', 'value', 'welcome'], improve: ['cost', 'venue', 'timing', 'food', 'communication', 'crowded', 'organisation', 'av'] }
  };
  var RATINGS = [
    { v: 1, face: '😞', label: 'Poor' }, { v: 2, face: '🙁', label: 'Fair' }, { v: 3, face: '🙂', label: 'Good' },
    { v: 4, face: '😄', label: 'Great' }, { v: 5, face: '🤩', label: 'Brilliant' }
  ];
  var RETURN = [{ v: 'yes', label: 'Yes, definitely' }, { v: 'maybe', label: 'Maybe' }, { v: 'no', label: 'Probably not' }];
  var HEARD = [
    ['instagram', 'Instagram'], ['groupchat', 'A group chat'], ['friend', 'A friend'], ['email', 'Email'],
    ['poster', 'Poster or flyer'], ['committee', 'A committee member'], ['website', 'This website'], ['other', 'Somewhere else']
  ];
  var KINDS = [
    ['lincoln_student', 'Lincoln student'], ['other_student', 'Student elsewhere'], ['professional', 'Healthcare professional'], ['other', 'Something else']
  ];
  var STARTERS = ['I loved…', 'It would be even better if…', 'Next time, please…', 'A shout-out to…'];
  var MAX_LIKED = 5, MAX_IMPROVE = 5;
  var DRAFT_KEY = 'lacms-feedback-draft';
  var GUEST_KEY = 'lacms-feedback-guest';
  var JOIN_URL = 'https://lincolnsu.com/activities/view/acs-medical';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function ls(k, v) {
    try { if (v === undefined) return window.localStorage.getItem(k); if (v === null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch (e) { /* ignore */ }
    return null;
  }
  function ss(k, v) {
    try { if (v === undefined) return window.sessionStorage.getItem(k); window.sessionStorage.setItem(k, v); } catch (e) { /* ignore */ }
    return null;
  }
  function firstName(n) { return String(n || '').replace(/^\s*(dr|prof|professor|mr|mrs|ms|miss)\.?\s+/i, '').trim().split(/\s+/)[0] || ''; }
  function params() { try { return new URLSearchParams(window.location.search); } catch (e) { return { get: function () { return null; } }; } }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function todayKey() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDateText(text) {
    var m = /(\d{1,2})(?:\s*[–-]\s*\d{1,2})?\s+([A-Za-z]+)\s+(\d{4})/.exec(String(text || ''));
    if (!m) return null;
    for (var i = 0; i < 12; i++) if (MONTHS[i].toLowerCase().indexOf(m[2].toLowerCase().slice(0, 3)) === 0) return m[3] + '-' + pad(i + 1) + '-' + pad(+m[1]);
    return null;
  }
  function dayBefore(key, n) { var p = key.split('-'); var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] - n)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function niceDate(key) { if (!key) return ''; var p = key.split('-'); return (+p[2]) + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0]; }
  function inPreview() { return !!(window.lacmsViewAs && window.lacmsViewAs.active && window.lacmsViewAs.active()); }

  // ---- State -------------------------------------------------------------------
  var S = {
    step: 'loading',
    events: [],              // events that can be reviewed, newest first
    done: {},                // slugs this signed-in person has already reviewed
    event: null,             // the chosen event
    me: null,                // { id, name, kind: 'member'|'professional'|'guest', email }
    guest: false,            // chose the guest route
    a: blank()               // the answers
  };
  function blank() {
    return { rating: 0, liked: [], improve: [], would: '', comment: '', heard: '', suggestion: '', anonymous: false, quote: false, updates: false, email: '', name: '', kind: '' };
  }

  // ---- Loading ------------------------------------------------------------------
  function loadEvents() {
    var today = todayKey(), oldest = dayBefore(today, 120);
    return supabaseClient.from('site_events').select('*').eq('is_active', true).then(function (r) {
      if (r.error) return [];
      return (r.data || []).map(function (e) {
        var start = e.starts_on || parseDateText(e.date_text);
        var end = e.ends_on || start;
        return { slug: e.slug, name: e.name, tag: e.tag || '', date: start, end: end, dateText: e.date_text, summary: e.summary };
      }).filter(function (e) {
        if (!e.date) return true;                       // no date known: let the database decide
        return e.date <= today && (e.end || e.date) >= oldest;
      }).sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
    }, function () { return []; });
  }

  function loadMe() {
    return supabaseClient.auth.getSession().then(function (res) {
      var session = res && res.data && res.data.session;
      if (!session) return null;
      var uid = session.user.id, email = session.user.email || '';
      return supabaseClient.from('members').select('full_name').eq('id', uid).maybeSingle().then(function (m) {
        if (m.data) return { id: uid, name: m.data.full_name, kind: 'member', email: email };
        return supabaseClient.from('network_professionals').select('full_name').eq('user_id', uid).limit(1).then(function (p) {
          var row = p.data && p.data[0];
          return row ? { id: uid, name: row.full_name, kind: 'professional', email: email } : { id: uid, name: '', kind: 'guest', email: email };
        }, function () { return { id: uid, name: '', kind: 'guest', email: email }; });
      }, function () { return { id: uid, name: '', kind: 'guest', email: email }; });
    }, function () { return null; });
  }

  function loadDone() {
    if (!S.me || S.me.kind === 'guest') return Promise.resolve({});
    return supabaseClient.rpc('my_feedback_slugs').then(function (r) {
      var map = {};
      (r.data || []).forEach(function (s) { map[s] = true; });
      return map;
    }, function () { return {}; });
  }

  // ---- Draft (kept in this browser, so signing in halfway loses nothing) ---------------
  function saveDraft() {
    if (!S.event) return;
    ls(DRAFT_KEY, JSON.stringify({ slug: S.event.slug, a: S.a, at: Date.now() }));
  }
  function restoreDraft(slug) {
    try {
      var d = JSON.parse(ls(DRAFT_KEY) || 'null');
      if (d && d.slug === slug && Date.now() - d.at < 6 * 3600 * 1000) { S.a = Object.assign(blank(), d.a); return true; }
    } catch (e) { /* ignore */ }
    return false;
  }

  // ---- Small pieces -----------------------------------------------------------------
  function stepsHtml() {
    var order = ['event', 'who', 'form'];
    var labels = { event: 'Event', who: 'You', form: 'Feedback' };
    var at = S.step === 'done' ? 3 : Math.max(0, order.indexOf(S.step));
    return '<ol class="fb-steps-bar" aria-label="Progress">' + order.map(function (k, i) {
      return '<li class="' + (i < at ? 'is-done' : i === at ? 'is-now' : '') + '"' + (i === at ? ' aria-current="step"' : '') + '><span>' + (i < at ? '✓' : (i + 1)) + '</span>' + labels[k] + '</li>';
    }).join('') + '</ol>';
  }
  function eventHead() {
    var e = S.event;
    if (!e) return '';
    return '<div class="fb-event"><div><span class="fb-event-tag">' + esc(e.tag || 'Event') + '</span><h2>' + esc(e.name) + '</h2>' +
      (e.date ? '<p>' + esc(niceDate(e.date)) + '</p>' : (e.dateText ? '<p>' + esc(e.dateText) + '</p>' : '')) + '</div>' +
      '<button type="button" class="guide-linkbtn" data-fb-change-event>Change</button></div>';
  }
  function chipHtml(group, key, label, on, disabled) {
    return '<label class="motm-chip fb-chip' + (on ? ' is-on' : '') + (disabled ? ' is-blocked' : '') + '"><input type="checkbox" data-fb-chip="' + group + '" value="' + key + '"' + (on ? ' checked' : '') + (disabled ? ' disabled' : '') + '><span>' + esc(label) + '</span></label>';
  }
  function chipsFor(group) {
    var set = (CHIPS[S.event && S.event.tag] || CHIPS._default)[group];
    var labels = group === 'liked' ? LIKED : IMPROVE;
    var max = group === 'liked' ? MAX_LIKED : MAX_IMPROVE;
    var chosen = S.a[group];
    // Anything picked earlier (from a draft) stays visible even if it isn't in this event's list.
    var keys = set.slice();
    chosen.forEach(function (k) { if (keys.indexOf(k) === -1 && labels[k]) keys.push(k); });
    return keys.map(function (k) {
      var on = chosen.indexOf(k) !== -1;
      return chipHtml(group, k, labels[k], on, !on && chosen.length >= max);
    }).join('');
  }

  // ---- Steps ------------------------------------------------------------------------
  function render() {
    var html = '';
    if (S.step === 'loading') {
      html = '<div class="fb-wait"><span class="auth-gate-spinner" aria-hidden="true"></span><p>One moment…</p></div>';
    } else if (S.step === 'event') {
      html = stepsHtml() + eventStep();
    } else if (S.step === 'who') {
      html = stepsHtml() + eventHead() + whoStep();
    } else if (S.step === 'form') {
      html = stepsHtml() + eventHead() + formStep();
    } else if (S.step === 'already') {
      html = alreadyStep();
    } else if (S.step === 'done') {
      html = doneStep();
    }
    root.innerHTML = html;
    if (S.step === 'form') wireForm();
    var h = root.querySelector('[data-fb-focus]');
    if (h && S.focusOnRender) { h.focus({ preventScroll: true }); }
    S.focusOnRender = false;
  }
  function go(step, scroll) {
    S.step = step;
    S.focusOnRender = true;
    render();
    if (scroll !== false) {
      var top = root.getBoundingClientRect().top + window.pageYOffset - 90;
      window.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  }

  function eventStep() {
    var list = S.events.map(function (e) {
      var done = S.done[e.slug];
      return '<button type="button" class="fb-event-card' + (done ? ' is-done' : '') + '" data-fb-pick="' + esc(e.slug) + '">' +
        '<span class="fb-event-tag">' + esc(e.tag || 'Event') + '</span>' +
        '<strong>' + esc(e.name) + '</strong>' +
        '<span class="fb-event-date">' + esc(e.date ? niceDate(e.date) : (e.dateText || '')) + '</span>' +
        (done ? '<span class="fb-event-done">✓ You’ve sent feedback</span>' : '') + '</button>';
    }).join('');
    return '<div class="fb-card"><h2 data-fb-focus tabindex="-1">Which event?</h2><p class="fb-sub">Pick the one you were at. If it isn’t here, choose “LACMS in general”.</p>' +
      '<div class="fb-event-list">' + list +
      '<button type="button" class="fb-event-card fb-event-card--general" data-fb-pick="general"><span class="fb-event-tag">Anything</span><strong>LACMS in general</strong><span class="fb-event-date">Not about one event</span></button>' +
      '</div>' + (S.events.length ? '' : '<p class="fb-sub">Events show up here once they’ve happened.</p>') + '</div>';
  }

  function whoStep() {
    if (S.me && S.me.kind !== 'guest') return '';       // handled before this step is shown
    return '<div class="fb-card"><h2 data-fb-focus tabindex="-1">How should we put it down?</h2>' +
      '<p class="fb-sub">Two ways in, both quick.</p>' +
      '<div class="fb-who">' +
      '<button type="button" class="fb-who-card fb-who-card--member" data-fb-who="member">' +
      '<span class="fb-who-icon" aria-hidden="true">★</span><strong>I’m a LACMS member</strong>' +
      '<span>Sign in and your feedback is linked to you (or send it anonymously) and earns XP on your journey.</span><span class="fb-who-go">Sign in →</span></button>' +
      '<button type="button" class="fb-who-card" data-fb-who="guest">' +
      '<span class="fb-who-icon" aria-hidden="true">✉</span><strong>I’m a guest</strong>' +
      '<span>No account needed. We just ask for your email so we can follow up.</span><span class="fb-who-go">Continue as a guest →</span></button>' +
      '</div></div>';
  }

  function formStep() {
    var a = S.a, me = S.me, isGuest = !me || me.kind === 'guest';
    var who = '';
    if (me && me.kind !== 'guest') {
      who = '<div class="fb-as"><span class="fb-as-dot" aria-hidden="true"></span><span>Giving feedback as <strong>' + esc(me.name || 'a LACMS member') + '</strong></span></div>';
    } else {
      var email = a.email || (me && me.email) || ss(GUEST_KEY) || '';
      who = '<div class="fb-card fb-card--tight"><h3>About you</h3>' +
        '<div class="fb-fields"><div class="field"><label for="fb-email">Your email <span class="fb-req">required</span></label>' +
        '<input type="email" id="fb-email" autocomplete="email" inputmode="email" maxlength="254" placeholder="you@example.com" value="' + esc(email) + '"></div>' +
        '<div class="field"><label for="fb-name">First name <span class="guide-optional">(optional)</span></label>' +
        '<input type="text" id="fb-name" autocomplete="given-name" maxlength="80" value="' + esc(a.name) + '"></div></div>' +
        '<span class="field-label">I’m a… <span class="guide-optional">(optional)</span></span><div class="fb-pills" role="radiogroup" aria-label="I am a">' +
        KINDS.map(function (k) { return '<button type="button" class="fb-pill' + (a.kind === k[0] ? ' is-on' : '') + '" role="radio" aria-checked="' + (a.kind === k[0]) + '" data-fb-kind="' + k[0] + '">' + k[1] + '</button>'; }).join('') +
        '</div></div>';
    }
    return who +
      '<form class="fb-form" id="fb-form" novalidate>' +
      // honeypot - people never see it; bots fill it in
      '<div class="fb-hp" aria-hidden="true"><label>Website <input type="text" id="fb-website" tabindex="-1" autocomplete="off"></label></div>' +

      '<fieldset class="fb-card"><legend class="fb-q"><span class="fb-n">1</span> Overall, how was it? <span class="fb-req">required</span></legend>' +
      '<div class="fb-rating" role="radiogroup" aria-label="Overall rating">' + RATINGS.map(function (r) {
        return '<button type="button" class="fb-rate' + (a.rating === r.v ? ' is-on' : '') + '" role="radio" aria-checked="' + (a.rating === r.v) + '" data-fb-rate="' + r.v + '"><span class="fb-face" aria-hidden="true">' + r.face + '</span><span>' + r.label + '</span></button>';
      }).join('') + '</div></fieldset>' +

      '<fieldset class="fb-card"><legend class="fb-q"><span class="fb-n">2</span> What went well? <span class="guide-optional">Tap any (up to ' + MAX_LIKED + ')</span></legend>' +
      '<div class="motm-chips fb-chips" data-fb-group="liked">' + chipsFor('liked') + '</div></fieldset>' +

      '<fieldset class="fb-card"><legend class="fb-q"><span class="fb-n">3</span> What could be better? <span class="guide-optional">Tap any (up to ' + MAX_IMPROVE + ')</span></legend>' +
      '<div class="motm-chips fb-chips" data-fb-group="improve">' + chipsFor('improve') + '</div></fieldset>' +

      '<fieldset class="fb-card"><legend class="fb-q"><span class="fb-n">4</span> Would you come to another one?</legend>' +
      '<div class="fb-pills" role="radiogroup" aria-label="Would you come again">' + RETURN.map(function (r) {
        return '<button type="button" class="fb-pill' + (a.would === r.v ? ' is-on' : '') + '" role="radio" aria-checked="' + (a.would === r.v) + '" data-fb-would="' + r.v + '">' + r.label + '</button>';
      }).join('') + '</div></fieldset>' +

      '<fieldset class="fb-card"><legend class="fb-q"><span class="fb-n">5</span> Anything else? <span class="guide-optional">(optional)</span></legend>' +
      '<div class="fb-starters">' + STARTERS.map(function (t, i) { return '<button type="button" class="fb-starter" data-fb-starter="' + i + '">' + esc(t) + '</button>'; }).join('') + '</div>' +
      '<label class="visually-hidden" for="fb-comment">Your comments</label>' +
      '<textarea id="fb-comment" rows="4" maxlength="1500" placeholder="A sentence or two is plenty.">' + esc(a.comment) + '</textarea>' +
      '<span class="guide-count" data-fb-count>' + a.comment.length + ' / 1500</span>' +
      '<label class="motm-consent"><input type="checkbox" id="fb-quote"' + (a.quote ? ' checked' : '') + '><span><strong>We may quote this (without your name)</strong><small>On social media or when we tell people what our events are like.</small></span></label>' +
      '</fieldset>' +

      '<details class="fb-more"' + (a.heard || a.suggestion ? ' open' : '') + '><summary>A little more, if you like</summary>' +
      '<div class="fb-more-body"><span class="field-label">How did you hear about it?</span><div class="fb-pills">' + HEARD.map(function (h) {
        return '<button type="button" class="fb-pill' + (a.heard === h[0] ? ' is-on' : '') + '" data-fb-heard="' + h[0] + '" aria-pressed="' + (a.heard === h[0]) + '">' + h[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="field" style="margin-top: var(--space-3);"><label for="fb-suggestion">An event you’d love us to run</label><input type="text" id="fb-suggestion" maxlength="500" placeholder="e.g. a revision weekend, a mock OSCE night…" value="' + esc(a.suggestion) + '"></div></div></details>' +

      '<div class="fb-consents">' +
      (isGuest
        ? '<label class="motm-consent"><input type="checkbox" id="fb-updates"' + (a.updates ? ' checked' : '') + '><span><strong>Keep me posted about LACMS events</strong><small>Optional. We’ll use your email to tell you what’s coming up. You can say stop at any time.</small></span></label>'
        : '<label class="motm-consent"><input type="checkbox" id="fb-anon"' + (a.anonymous ? ' checked' : '') + '><span><strong>Send this anonymously</strong><small>The committee will see your answers but not your name, email, course or year.</small></span></label>') +
      '</div>' +

      '<p class="guide-error" data-fb-error role="alert" hidden></p>' +
      '<button type="submit" class="btn btn-primary btn-block btn-glow fb-send">Send feedback</button>' +
      '<p class="guide-fine fb-privacy">' + (isGuest
        ? 'Your email is only seen by the LACMS committee. We use it to follow up on what you tell us and to make sure each person sends one response per event.'
        : 'Only the LACMS committee reads this.') + '</p>' +
      '</form>';
  }

  function alreadyStep() {
    return '<div class="fb-card fb-card--center"><span class="fb-big" aria-hidden="true">✓</span><h2 data-fb-focus tabindex="-1">You’ve already told us about this one</h2>' +
      '<p class="fb-sub">Thank you – we have your feedback on <strong>' + esc(S.event ? S.event.name : 'this event') + '</strong>.</p>' +
      '<div class="fb-actions"><button type="button" class="btn btn-primary" data-fb-another>Give feedback on another event</button>' +
      '<a class="btn btn-outline" href="events.html">Back to events</a></div></div>' +
      (S.me && S.me.kind !== 'guest' ? '' : pitchHtml());
  }

  function otherEventsHtml() {
    var left = S.events.filter(function (e) { return !S.done[e.slug] && (!S.event || e.slug !== S.event.slug); }).slice(0, 4);
    if (!left.length) return '';
    return '<div class="fb-others"><h3>Been to these too?</h3>' + left.map(function (e) {
      return '<button type="button" class="fb-other" data-fb-pick="' + esc(e.slug) + '"><strong>' + esc(e.name) + '</strong><span>' + esc(e.date ? niceDate(e.date) : '') + '</span></button>';
    }).join('') + '</div>';
  }

  function doneStep() {
    var member = S.me && S.me.kind !== 'guest';
    var first = member ? firstName(S.me.name) : firstName(S.a.name);
    var head = '<div class="fb-card fb-card--center"><span class="fb-big fb-big--pop" aria-hidden="true">★</span>' +
      '<h2 data-fb-focus tabindex="-1">Thank you' + (first ? ', ' + esc(first) : '') + '!</h2>' +
      '<p class="fb-sub">Your feedback on <strong>' + esc(S.event ? S.event.name : 'the event') + '</strong> has gone straight to the committee. We read every one and use it to plan what comes next.</p>' +
      (S.me && S.me.kind === 'member' ? '<p class="fb-reward">Thanks for helping shape LACMS. It counts towards your journey too.</p>' : '') +
      '</div>';
    if (member) {
      return head + otherEventsHtml() +
        '<div class="fb-actions fb-actions--center"><a class="btn btn-primary" href="member-hub.html">Back to the Members Hub</a><a class="btn btn-outline" href="events.html">See upcoming events</a></div>';
    }
    return head + pitchHtml() + otherEventsHtml() +
      '<div class="fb-actions fb-actions--center"><a class="btn btn-outline" href="events.html">Back to events</a></div>';
  }

  // What members get, and how to become one (shown to guests once they've given feedback).
  function pitchHtml() {
    var kind = S.a.kind;
    if (kind === 'professional') {
      return '<section class="fb-pitch"><span class="eyebrow">Healthcare professional?</span><h2>Help the next generation</h2>' +
        '<p>Our Network connects students with doctors, pharmacists and other professionals across the Midlands. Mentor in Sankofa Circles, share your story, and meet the students you’re inspiring.</p>' +
        '<div class="fb-actions"><a class="btn btn-primary btn-glow" href="request-professional-account.html">Join the Network</a><a class="btn btn-outline" href="programmes.html">About Sankofa mentoring</a></div></section>';
    }
    var perks = [
      ['🎟️', 'First access to events', 'Free or discounted entry to socials, workshops and the Midlands Medics Gala.'],
      ['🧭', 'A mentor who gets it', 'Priority for Sankofa mentoring, with Circles of students and doctors.'],
      ['🏷️', 'Local discounts', 'Partner offers on food, fitness and more, in one place.'],
      ['📚', 'Resources and opportunities', 'Shared study resources, plus placements and bursaries before anyone else.'],
      ['🤝', 'The Network', 'Every member, and professionals who want to help, a message away.']
    ];
    var elsewhere = kind === 'other_student';
    return '<section class="fb-pitch"><span class="eyebrow">' + (elsewhere ? 'You’re always welcome' : 'Liked what you saw?') + '</span>' +
      '<h2>' + (elsewhere ? 'Come back and bring a friend' : 'Get more from LACMS as a member') + '</h2>' +
      (elsewhere
        ? '<p>Our events are for everyone. Membership is open to students at the University of Lincoln, and this is what it unlocks:</p>'
        : '<p>You’ve seen the events. Members get the whole community behind them.</p>') +
      '<ul class="fb-perks">' + perks.map(function (p) {
        return '<li><span class="fb-perk-icon" aria-hidden="true">' + p[0] + '</span><div><strong>' + p[1] + '</strong><span>' + p[2] + '</span></div></li>';
      }).join('') + '</ul>' +
      '<h3 class="fb-pitch-h3">How to join – three steps</h3>' +
      '<ol class="fb-how">' +
      '<li><span class="fb-how-n">1</span><div><strong>Join through the Students’ Union</strong><span>£7.50 for the year, paid on the University of Lincoln Students’ Union site.</span></div></li>' +
      '<li><span class="fb-how-n">2</span><div><strong>Request your account</strong><span>Takes a minute. The committee sets up your login.</span></div></li>' +
      '<li><span class="fb-how-n">3</span><div><strong>Log in and look around</strong><span>Perks, the Network, resources and your journey, all waiting.</span></div></li>' +
      '</ol>' +
      '<div class="fb-actions"><a class="btn btn-primary btn-glow" href="' + JOIN_URL + '" rel="noopener">Join via the Students’ Union</a>' +
      '<a class="btn btn-outline" href="request-account.html">Already paid? Request your account</a></div>' +
      '<p class="guide-fine"><a href="join.html" style="color: var(--color-gold-light);">See everything members get</a> · Questions? <a href="mailto:acms@lincolnsu.com" style="color: var(--color-gold-light);">acms@lincolnsu.com</a></p></section>';
  }

  // ---- Form behaviour -----------------------------------------------------------------
  function toggle(list, key, max) {
    var i = list.indexOf(key);
    if (i !== -1) list.splice(i, 1); else if (list.length < max) list.push(key);
  }
  function wireForm() {
    var form = document.getElementById('fb-form');
    if (!form) return;
    var comment = document.getElementById('fb-comment');
    comment.addEventListener('input', function () {
      S.a.comment = comment.value;
      form.querySelector('[data-fb-count]').textContent = comment.value.length + ' / 1500';
      saveDraft();
    });
    var q = document.getElementById('fb-quote'); if (q) q.addEventListener('change', function () { S.a.quote = q.checked; saveDraft(); });
    var an = document.getElementById('fb-anon'); if (an) an.addEventListener('change', function () { S.a.anonymous = an.checked; saveDraft(); });
    var up = document.getElementById('fb-updates'); if (up) up.addEventListener('change', function () { S.a.updates = up.checked; saveDraft(); });
    var sg = document.getElementById('fb-suggestion'); if (sg) sg.addEventListener('input', function () { S.a.suggestion = sg.value; saveDraft(); });
    var em = document.getElementById('fb-email'); if (em) em.addEventListener('input', function () { S.a.email = em.value; });
    var nm = document.getElementById('fb-name'); if (nm) nm.addEventListener('input', function () { S.a.name = nm.value; saveDraft(); });
    form.addEventListener('submit', function (e) { e.preventDefault(); send(); });
  }

  // Redraw a group of chips in place (keeps focus and scroll where they were).
  function redrawChips(group) {
    var host = root.querySelector('[data-fb-group="' + group + '"]');
    if (!host) return;
    var focusKey = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-fb-chip') === group ? document.activeElement.value : null;
    host.innerHTML = chipsFor(group);
    if (focusKey) { var el = host.querySelector('input[value="' + focusKey + '"]'); if (el) el.focus({ preventScroll: true }); }
  }
  function setOn(selector, attr, value, aria) {
    Array.prototype.forEach.call(root.querySelectorAll(selector), function (b) {
      var on = b.getAttribute(attr) === String(value);
      b.classList.toggle('is-on', on);
      b.setAttribute(aria || 'aria-checked', String(on));
    });
  }

  root.addEventListener('change', function (e) {
    var t = e.target;
    if (t && t.getAttribute && t.getAttribute('data-fb-chip')) {
      var g = t.getAttribute('data-fb-chip');
      toggle(S.a[g], t.value, g === 'liked' ? MAX_LIKED : MAX_IMPROVE);
      redrawChips(g);
      saveDraft();
    }
  });

  root.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('button') : null;
    if (!t) return;
    var v;
    if ((v = t.getAttribute('data-fb-pick')) !== null) { chooseEvent(v); return; }
    if (t.hasAttribute('data-fb-change-event') || t.hasAttribute('data-fb-another')) { S.event = null; go('event'); return; }
    if ((v = t.getAttribute('data-fb-who')) !== null) {
      if (v === 'member') {
        saveDraft();
        window.location.href = 'member-login.html?next=' + encodeURIComponent('feedback.html?event=' + (S.event ? S.event.slug : ''));
      } else {
        S.guest = true;
        try { window.history.replaceState(null, '', 'feedback.html?event=' + encodeURIComponent(S.event ? S.event.slug : '') + '&as=guest'); } catch (err) { /* ignore */ }
        go('form');
      }
      return;
    }
    if ((v = t.getAttribute('data-fb-rate')) !== null) { S.a.rating = +v; setOn('[data-fb-rate]', 'data-fb-rate', v); saveDraft(); clearError(); return; }
    if ((v = t.getAttribute('data-fb-would')) !== null) { S.a.would = S.a.would === v ? '' : v; setOn('[data-fb-would]', 'data-fb-would', S.a.would); saveDraft(); return; }
    if ((v = t.getAttribute('data-fb-heard')) !== null) { S.a.heard = S.a.heard === v ? '' : v; setOn('[data-fb-heard]', 'data-fb-heard', S.a.heard, 'aria-pressed'); saveDraft(); return; }
    if ((v = t.getAttribute('data-fb-kind')) !== null) { S.a.kind = S.a.kind === v ? '' : v; setOn('[data-fb-kind]', 'data-fb-kind', S.a.kind); saveDraft(); return; }
    if ((v = t.getAttribute('data-fb-starter')) !== null) {
      var ta = document.getElementById('fb-comment');
      var add = STARTERS[+v];
      ta.value = (ta.value && !/\s$/.test(ta.value) ? ta.value + ' ' : ta.value) + add + ' ';
      ta.dispatchEvent(new Event('input'));
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  });

  function showError(msg, el) {
    var box = root.querySelector('[data-fb-error]');
    if (box) { box.textContent = msg; box.hidden = false; }
    if (el && el.focus) el.focus({ preventScroll: false });
  }
  function clearError() { var box = root.querySelector('[data-fb-error]'); if (box) box.hidden = true; }

  function chooseEvent(slug, initial) {
    if (slug === 'general') S.event = { slug: 'general', name: 'LACMS in general', tag: '', date: null, dateText: '' };
    else S.event = S.events.filter(function (e) { return e.slug === slug; })[0] || null;
    if (!S.event) { go('event', !initial); return; }
    S.a = blank();
    restoreDraft(S.event.slug);
    try { window.history.replaceState(null, '', 'feedback.html?event=' + encodeURIComponent(S.event.slug) + (S.guest && !(S.me && S.me.kind !== 'guest') ? '&as=guest' : '')); } catch (e) { /* ignore */ }
    if (S.done[S.event.slug]) { go('already', !initial); return; }
    afterEventChosen(initial);
  }
  function afterEventChosen(initial) {
    var scroll = !initial;
    if (S.me && S.me.kind !== 'guest') { go('form', scroll); return; }
    if (S.guest || S.me) { go('form', scroll); return; }       // a signed-in non-member is treated as a guest
    go('who', scroll);
  }

  function send() {
    var a = S.a;
    clearError();
    var guestMode = !(S.me && S.me.kind !== 'guest');
    if (guestMode) {
      var em = (document.getElementById('fb-email').value || '').trim();
      a.email = em;
      a.name = (document.getElementById('fb-name').value || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { showError('Enter a valid email so we can follow up.', document.getElementById('fb-email')); return; }
    }
    if (!a.rating) { showError('Choose a rating first – how was it overall?', root.querySelector('[data-fb-rate]')); return; }
    if (inPreview()) { showError('You’re previewing someone’s account, so nothing can be sent.'); return; }
    var btn = root.querySelector('.fb-send');
    btn.disabled = true; btn.textContent = 'Sending…';
    supabaseClient.rpc('submit_event_feedback', {
      p_event_slug: S.event.slug, p_rating: a.rating, p_liked: a.liked, p_improve: a.improve,
      p_comment: a.comment.trim() || null, p_would_return: a.would || null, p_heard_from: a.heard || null,
      p_suggestion: a.suggestion.trim() || null, p_anonymous: !!a.anonymous, p_quote_ok: !!a.quote,
      p_guest_email: guestMode ? a.email : null, p_guest_name: guestMode ? (a.name || null) : null,
      p_guest_kind: guestMode ? (a.kind || null) : null, p_wants_updates: guestMode ? !!a.updates : false,
      p_website: (document.getElementById('fb-website') || {}).value || null
    }).then(function (res) {
      if (res.error) {
        btn.disabled = false; btn.textContent = 'Send feedback';
        var msg = res.error.message || 'Something went wrong - try again.';
        if (/Could not find the function|schema cache/i.test(msg)) msg = 'Feedback isn’t switched on yet. Email acms@lincolnsu.com and we’ll sort it.';
        showError(msg);
        return;
      }
      ls(DRAFT_KEY, null);
      if (guestMode) ss(GUEST_KEY, a.email);
      S.done[S.event.slug] = true;
      var already = res.data && res.data.already;
      go(already ? 'already' : 'done');
    }, function () {
      btn.disabled = false; btn.textContent = 'Send feedback';
      showError('We couldn’t reach the server - check your connection and try again.');
    });
  }

  // ---- Start ---------------------------------------------------------------------------
  Promise.all([loadEvents(), loadMe()]).then(function (res) {
    S.events = res[0];
    S.me = res[1];
    return loadDone();
  }).then(function (done) {
    S.done = done || {};
    var p = params();
    if (p.get('as') === 'guest') S.guest = true;
    var wanted = p.get('event');
    if (wanted && (wanted === 'general' || S.events.some(function (e) { return e.slug === wanted; }))) {
      chooseEvent(wanted, true);
    } else {
      S.step = 'event';
      render();
    }
  });
})();
