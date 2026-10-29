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

  var FB = window.LACMS_FB;
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
  // This page's address for an event, keeping the partner's link code (?src=) if there was one.
  function pageUrl(slug, guest) {
    return 'feedback.html?event=' + encodeURIComponent(slug) + (guest ? '&as=guest' : '') + (S.src ? '&src=' + encodeURIComponent(S.src) : '');
  }
  function inPreview() { return !!(window.lacmsViewAs && window.lacmsViewAs.active && window.lacmsViewAs.active()); }

  // ---- State -------------------------------------------------------------------
  var S = {
    step: 'loading',
    events: [],              // events that can be reviewed, newest first
    done: {},                // slugs this signed-in person has already reviewed
    event: null,             // the chosen event
    me: null,                // { id, name, kind: 'member'|'professional'|'guest', email }
    guest: false,            // chose the guest route
    src: '',                 // a partner's link code, if they came from a partner's link
    def: null,               // the form being filled in (see js/feedback-defs.js)
    preview: false,          // the committee previewing a draft: nothing is sent
    polls: [],               // live poll results to show after sending
    a: blank()               // the answers
  };
  function blank() {
    return { custom: {}, rating: 0, liked: [], improve: [], likedOther: '', improveOther: '', shoutouts: '', would: '', comment: '', heard: '', suggestion: '', anonymous: false, quote: false, updates: false, email: '', name: '', kind: '' };
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

  // The form to show: the event's own, else the default, else the original standard form.
  function loadForm(slug) {
    var fn = S.preview ? 'feedback_form_preview' : 'feedback_form_for';
    return supabaseClient.rpc(fn, { p_slug: slug }).then(function (r) {
      var d = r && r.data;
      S.def = !r.error && d && d.definition ? d.definition : FB.standard();
    }, function () { S.def = FB.standard(); });
  }
  function settings() { return Object.assign({}, FB.DEFAULT_SETTINGS, (S.def && S.def.settings) || {}); }
  function loadPolls(slug) {
    return supabaseClient.rpc('feedback_poll_results', { p_slug: slug }).then(function (r) {
      S.polls = (r && !r.error && r.data) || [];
    }, function () { S.polls = []; });
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
  // "Something else?": a few typed words to go with the tap-to-pick reasons.
  function otherBox(key, id, label, placeholder) {
    var val = S.a[key] || '';
    return '<div class="fb-other-box"><button type="button" class="motm-words-toggle" data-fb-other-toggle="' + key + '" aria-expanded="' + (val ? 'true' : 'false') + '">+ ' + label + ' <span class="guide-optional">(optional)</span></button>' +
      '<div class="field fb-other-field"' + (val ? '' : ' hidden') + '><label class="visually-hidden" for="' + id + '">' + label + '</label>' +
      '<textarea id="' + id + '" data-fb-other="' + key + '" rows="2" maxlength="300" placeholder="' + esc(placeholder) + '">' + esc(val) + '</textarea>' +
      '<span class="guide-count" data-fb-other-count="' + key + '">' + val.length + ' / 300</span></div></div>';
  }

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
    } else if (S.step === 'unavailable') {
      html = unavailableStep();
    } else if (S.step === 'already') {
      html = alreadyStep();
    } else if (S.step === 'done') {
      html = doneStep();
    }
    if (S.preview) html = '<div class="fb-preview-banner"><strong>Preview</strong> of the form you are editing (the draft). You can fill it in to test it, but nothing is sent.</div>' + html;
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

  // A link or QR code for one event, opened before it has happened (or long after): say so,
  // rather than asking which event they meant.
  function unavailableStep() {
    var e = S.event, why = S.why;
    var title = why === 'soon' ? 'Feedback opens when the event starts' : why === 'members' ? 'This form is for LACMS members' : 'Feedback for this event has closed';
    var text = why === 'soon'
      ? 'Come back on <strong>' + esc(niceDate(e.date)) + '</strong> (or after the event) and tell us how it went.'
      : why === 'members'
        ? 'You\u2019re signed in, but not as a LACMS member. Questions? Email <a href="mailto:acms@lincolnsu.com" style="color: var(--color-gold-light);">acms@lincolnsu.com</a>.'
        : why === 'formclosed'
          ? 'This feedback form has stopped taking answers for <strong>' + esc(e.name) + '</strong>. Thank you for your interest.'
          : 'We stopped collecting feedback for <strong>' + esc(e.name) + '</strong> a few months after it happened. You can still tell us about LACMS in general.';
    return '<div class="fb-card fb-card--center"><span class="fb-big" aria-hidden="true">' + (why === 'soon' ? '\u23F3' : why === 'members' ? '\uD83D\uDD12' : '\u2713') + '</span>' +
      '<h2 data-fb-focus tabindex="-1">' + title + '</h2>' +
      '<p class="fb-sub"><strong>' + esc(e.name) + '</strong>' + (e.date ? ' \u00B7 ' + esc(niceDate(e.date)) : '') + '</p><p class="fb-sub">' + text + '</p>' +
      '<div class="fb-actions"><a class="btn btn-primary" href="events.html">See events</a>' +
      '<button type="button" class="btn btn-outline" data-fb-pick="general">Feedback about LACMS in general</button></div></div>';
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
    return (S.notice ? '<div class="form-note fb-notice"><span>' + esc(S.notice) + '</span></div>' : '') +
      '<div class="fb-card"><h2 data-fb-focus tabindex="-1">Which event?</h2><p class="fb-sub">Pick the one you were at. If it isn’t here, choose “LACMS in general”.</p>' +
      '<div class="fb-event-list">' + list +
      '<button type="button" class="fb-event-card fb-event-card--general" data-fb-pick="general"><span class="fb-event-tag">Anything</span><strong>LACMS in general</strong><span class="fb-event-date">Not about one event</span></button>' +
      '</div>' + (S.events.length ? '' : '<p class="fb-sub">Events show up here once they’ve happened.</p>') + '</div>';
  }

  function whoStep() {
    if (S.me && S.me.kind !== 'guest') return '';       // handled before this step is shown
    var membersOnly = settings().audience === 'members';
    return '<div class="fb-card"><h2 data-fb-focus tabindex="-1">' + (membersOnly ? 'This form is for LACMS members' : 'How should we put it down?') + '</h2>' +
      '<p class="fb-sub">' + (membersOnly ? 'Sign in to answer it.' : 'Two ways in, both quick.') + '</p>' +
      '<div class="fb-who' + (membersOnly ? ' fb-who--one' : '') + '">' +
      '<button type="button" class="fb-who-card fb-who-card--member" data-fb-who="member">' +
      '<span class="fb-who-icon" aria-hidden="true">★</span><strong>I’m a LACMS member</strong>' +
      '<span>Sign in and your feedback is linked to you (or send it anonymously) and earns XP on your journey.</span><span class="fb-who-go">Sign in →</span></button>' +
      (membersOnly ? '' : '<button type="button" class="fb-who-card" data-fb-who="guest">' +
      '<span class="fb-who-icon" aria-hidden="true">✉</span><strong>I’m a guest</strong>' +
      '<span>No account needed. We just ask for your email so we can follow up.</span><span class="fb-who-go">Continue as a guest →</span></button>') +
      '</div></div>';
  }

  // ---- The form, drawn from its definition ---------------------------------------------
  function qList() { return FB.flat(S.def).map(function (x) { return x.q; }); }

  // The current answer to a question, in the shape the "show only if" rules compare against.
  function getVal(id) {
    if (id === 'overall') return S.a.rating || null;
    if (id === 'would_return') return S.a.would || null;
    if (id === 'heard') return S.a.heard || null;
    var a = S.a.custom[id];
    return a && a.v !== undefined ? a.v : null;
  }
  function visibleNow(q) { return FB.ruleHolds(q.show_if, getVal); }

  function requiredMark(q) { return q.required ? ' <span class="fb-req">required</span>' : ''; }
  function legendHint(q) {
    var h = q.hint || '';
    if (q.type === 'shoutouts') h = '';                      // shown as a paragraph instead
    if (!h && (q.type === 'liked' || q.type === 'improve')) h = FB.CORE_HINTS[q.type];
    if (!h && !q.required && q.type !== 'overall' && q.type !== 'liked' && q.type !== 'improve') h = '(optional)';
    if (q.type === 'multi' && !q.hint) h = 'Tap any' + (q.max && q.max < (q.options || []).length ? ' (up to ' + q.max + ')' : '') + (q.required ? '' : '');
    if (q.type === 'multi' && !q.required && !q.hint) h += '';
    return h ? ' <span class="guide-optional">' + esc(h) + '</span>' : '';
  }

  function scaleButtons(q) {
    var out = '', i, cur = (S.a.custom[q.id] || {}).v;
    var faces = ['😞', '🙁', '🙂', '😄', '🤩'];
    for (i = q.min; i <= q.max; i++) {
      var on = cur === i;
      var inner = q.style === 'faces' && q.max === 5 && q.min === 1 ? '<span class="fb-face" aria-hidden="true">' + faces[i - 1] + '</span><span>' + i + '</span>'
        : q.style === 'stars' && q.max === 5 && q.min === 1 ? '<span class="fb-star" aria-hidden="true">' + (cur && i <= cur ? '★' : '☆') + '</span><span class="visually-hidden">' + i + '</span>'
        : '<span>' + i + '</span>';
      out += '<button type="button" class="fb-scale-btn fb-scale-btn--' + (q.style || 'numbers') + (on || (q.style === 'stars' && cur && i <= cur) ? ' is-on' : '') + '" role="radio" aria-checked="' + on + '" aria-label="' + i + (i === q.min && q.low_label ? ', ' + esc(q.low_label) : i === q.max && q.high_label ? ', ' + esc(q.high_label) : '') + '" data-fb-scale="' + esc(q.id) + '" data-v="' + i + '">' + inner + '</button>';
    }
    return '<div class="fb-scale fb-scale--' + (q.style || 'numbers') + '" role="radiogroup" aria-label="' + esc(q.title) + '" style="--fb-scale-n:' + (q.max - q.min + 1) + '">' + out + '</div>' +
      (q.low_label || q.high_label ? '<div class="fb-scale-ends"><span>' + esc(q.low_label || '') + '</span><span>' + esc(q.high_label || '') + '</span></div>' : '');
  }

  function multiChips(q) {
    var chosen = (S.a.custom[q.id] || {}).v || [];
    var max = q.max || (q.options || []).length;
    var opts = (q.options || []).concat(q.allow_other ? [{ id: 'other', label: 'Other' }] : []);
    return opts.map(function (o) {
      var on = chosen.indexOf(o.id) !== -1;
      return '<label class="motm-chip fb-chip' + (on ? ' is-on' : '') + (!on && chosen.length >= max ? ' is-blocked' : '') + '"><input type="checkbox" data-fb-multi="' + esc(q.id) + '" value="' + esc(o.id) + '"' + (on ? ' checked' : '') + (!on && chosen.length >= max ? ' disabled' : '') + '><span>' + esc(o.label) + '</span></label>';
    }).join('');
  }
  function otherText(q, show) {
    var a = S.a.custom[q.id] || {};
    return '<div class="field fb-other-text" data-fb-other-wrap="' + esc(q.id) + '"' + (show ? '' : ' hidden') + '><label class="visually-hidden" for="fb-ot-' + esc(q.id) + '">Please say what</label>' +
      '<input type="text" id="fb-ot-' + esc(q.id) + '" data-fb-other-text="' + esc(q.id) + '" maxlength="150" placeholder="Please say what" value="' + esc(a.other || '') + '"></div>';
  }

  function cardBody(q) {
    var a = S.a, c = S.a.custom[q.id] || {}, i;
    switch (q.type) {
      case 'overall':
        return '<div class="fb-rating fb-rating--' + (q.style || 'faces') + '" role="radiogroup" aria-label="Overall rating">' + RATINGS.map(function (r) {
          var on = a.rating === r.v, lit = q.style === 'stars' && a.rating && r.v <= a.rating;
          return '<button type="button" class="fb-rate' + (on || lit ? ' is-on' : '') + '" role="radio" aria-checked="' + on + '" data-fb-rate="' + r.v + '"><span class="fb-face" aria-hidden="true">' + (q.style === 'stars' ? (lit ? '★' : '☆') : r.face) + '</span><span>' + r.label + '</span></button>';
        }).join('') + '</div>';
      case 'liked':
        return '<div class="motm-chips fb-chips" data-fb-group="liked">' + chipsFor('liked') + '</div>' +
          otherBox('likedOther', 'fb-liked-other', 'Something else that went well?', 'e.g. the quiz round, the music, the way the room was set up');
      case 'improve':
        return '<div class="motm-chips fb-chips" data-fb-group="improve">' + chipsFor('improve') + '</div>' +
          otherBox('improveOther', 'fb-improve-other', 'Something else we could improve?', 'e.g. more seating, a clearer start time, quieter music');
      case 'would_return':
        return '<div class="fb-pills" role="radiogroup" aria-label="' + esc(q.title) + '">' + RETURN.map(function (r) {
          return '<button type="button" class="fb-pill' + (a.would === r.v ? ' is-on' : '') + '" role="radio" aria-checked="' + (a.would === r.v) + '" data-fb-would="' + r.v + '">' + r.label + '</button>';
        }).join('') + '</div>';
      case 'shoutouts':
        return '<p class="fb-q-help">' + esc(q.hint || FB.CORE_HINTS.shoutouts) + '</p>' +
          '<div class="field fb-comment-field"><label class="visually-hidden" for="fb-shoutouts">' + esc(q.title) + '</label>' +
          '<input type="text" id="fb-shoutouts" maxlength="300" placeholder="e.g. Ama, the welcome team, Dr Okoye" value="' + esc(a.shoutouts) + '" autocomplete="off"></div>';
      case 'comment':
        return '<div class="fb-starters">' + STARTERS.map(function (t, k) { return '<button type="button" class="fb-starter" data-fb-starter="' + k + '">' + esc(t) + '</button>'; }).join('') + '</div>' +
          '<div class="field fb-comment-field"><label class="visually-hidden" for="fb-comment">' + esc(q.title) + '</label>' +
          '<textarea id="fb-comment" rows="4" maxlength="1500" placeholder="A sentence or two is plenty.">' + esc(a.comment) + '</textarea>' +
          '<span class="guide-count" data-fb-count>' + a.comment.length + ' / 1500</span></div>' +
          (settings().ask_quote_consent ? '<label class="motm-consent"><input type="checkbox" id="fb-quote"' + (a.quote ? ' checked' : '') + '><span><strong>We may quote this (without your name)</strong><small>On social media or when we tell people what our events are like.</small></span></label>' : '');
      case 'heard':
        return '<div class="fb-pills">' + HEARD.map(function (h) {
          return '<button type="button" class="fb-pill' + (a.heard === h[0] ? ' is-on' : '') + '" data-fb-heard="' + h[0] + '" aria-pressed="' + (a.heard === h[0]) + '">' + h[1] + '</button>';
        }).join('') + '</div>';
      case 'suggestion':
        return '<div class="field"><label class="visually-hidden" for="fb-suggestion">' + esc(q.title) + '</label><input type="text" id="fb-suggestion" maxlength="500" placeholder="e.g. a revision weekend, a mock OSCE night…" value="' + esc(a.suggestion) + '"></div>';
      case 'single':
        return '<div class="fb-' + (q.style === 'list' ? 'choices' : 'pills') + '" role="radiogroup" aria-label="' + esc(q.title) + '">' +
          (q.options || []).concat(q.allow_other ? [{ id: 'other', label: 'Other' }] : []).map(function (o) {
            var on = c.v === o.id;
            return '<button type="button" class="fb-' + (q.style === 'list' ? 'choice' : 'pill') + (on ? ' is-on' : '') + '" role="radio" aria-checked="' + on + '" data-fb-single="' + esc(q.id) + '" data-v="' + esc(o.id) + '">' + esc(o.label) + '</button>';
          }).join('') + '</div>' + (q.allow_other ? otherText(q, c.v === 'other') : '');
      case 'multi':
        return '<div class="motm-chips fb-chips" data-fb-multi-group="' + esc(q.id) + '">' + multiChips(q) + '</div>' + (q.allow_other ? otherText(q, (c.v || []).indexOf('other') !== -1) : '');
      case 'scale':
        return scaleButtons(q);
      case 'yesno':
        return '<div class="fb-pills" role="radiogroup" aria-label="' + esc(q.title) + '">' + [['yes', q.yes_label || 'Yes'], ['no', q.no_label || 'No']].map(function (o) {
          return '<button type="button" class="fb-pill' + (c.v === o[0] ? ' is-on' : '') + '" role="radio" aria-checked="' + (c.v === o[0]) + '" data-fb-yn="' + esc(q.id) + '" data-v="' + o[0] + '">' + esc(o[1]) + '</button>';
        }).join('') + '</div>';
      case 'text':
        return '<div class="field fb-comment-field"><label class="visually-hidden" for="fb-t-' + esc(q.id) + '">' + esc(q.title) + '</label><input type="text" id="fb-t-' + esc(q.id) + '" data-fb-text="' + esc(q.id) + '" maxlength="' + (q.max || 200) + '" placeholder="' + esc(q.placeholder || '') + '" value="' + esc(c.v || '') + '" autocomplete="off"></div>';
      case 'longtext':
        return '<div class="field fb-comment-field"><label class="visually-hidden" for="fb-t-' + esc(q.id) + '">' + esc(q.title) + '</label><textarea id="fb-t-' + esc(q.id) + '" data-fb-text="' + esc(q.id) + '" rows="4" maxlength="' + (q.max || 1000) + '" placeholder="' + esc(q.placeholder || '') + '">' + esc(c.v || '') + '</textarea>' +
          '<span class="guide-count" data-fb-tcount="' + esc(q.id) + '">' + String(c.v || '').length + ' / ' + (q.max || 1000) + '</span></div>';
    }
    return '';
  }

  function questionHtml(q, num) {
    var vis = visibleNow(q);
    if (q.type === 'info') {
      return '<div class="fb-info" data-fb-q="' + esc(q.id) + '"' + (vis ? '' : ' hidden') + '>' + (q.title ? '<h3>' + esc(q.title) + '</h3>' : '') +
        (q.body ? String(q.body).split(/\n+/).map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('') : '') + '</div>';
    }
    return '<fieldset class="fb-card" data-fb-q="' + esc(q.id) + '"' + (vis ? '' : ' hidden') + '><legend class="fb-q"><span class="fb-n">' + num + '</span> ' + esc(q.title) + requiredMark(q) + legendHint(q) + '</legend>' +
      '<div data-fb-body>' + cardBody(q) + '</div></fieldset>';
  }

  function formStep() {
    var a = S.a, me = S.me, isGuest = !me || me.kind === 'guest', st = settings();
    var who = '';
    if (me && me.kind !== 'guest') {
      who = '<div class="fb-as"><span class="fb-as-dot" aria-hidden="true"></span><span>Giving feedback as <strong>' + esc(me.name || 'a LACMS member') + '</strong></span></div>';
    } else {
      var email = a.email || (me && me.email) || ss(GUEST_KEY) || '';
      who = '<div class="fb-card fb-card--tight"><h3>About you</h3>' +
        '<div class="fb-fields"><div class="field"><label for="fb-email">Your email <span class="fb-req">required</span></label>' +
        '<input type="email" id="fb-email" autocomplete="email" inputmode="email" maxlength="254" placeholder="you@example.com" value="' + esc(email) + '"><span class="hint">We use your email only to avoid duplicate replies and to contact you if you ask us to. <a href="privacy.html" target="_blank" rel="noopener">Privacy notice</a></span></div>' +
        '<div class="field"><label for="fb-name">First name <span class="guide-optional">(optional)</span></label>' +
        '<input type="text" id="fb-name" autocomplete="given-name" maxlength="80" value="' + esc(a.name) + '"></div></div>' +
        '<span class="field-label">I’m a… <span class="guide-optional">(optional)</span></span><div class="fb-pills" role="radiogroup" aria-label="I am a">' +
        KINDS.map(function (k) { return '<button type="button" class="fb-pill' + (a.kind === k[0] ? ' is-on' : '') + '" role="radio" aria-checked="' + (a.kind === k[0]) + '" data-fb-kind="' + k[0] + '">' + k[1] + '</button>'; }).join('') +
        '</div></div>';
    }
    var n = 0, body = '';
    S.def.sections.forEach(function (sec) {
      var any = (sec.questions || []).some(function (q) { return visibleNow(q); });
      if (sec.title || sec.description) {
        body += '<div class="fb-section-head" data-fb-sec="' + esc(sec.id) + '"' + (any ? '' : ' hidden') + '>' + (sec.title ? '<h3>' + esc(sec.title) + '</h3>' : '') + (sec.description ? '<p>' + esc(sec.description) + '</p>' : '') + '</div>';
      }
      (sec.questions || []).forEach(function (q) {
        if (q.type !== 'info' && visibleNow(q)) n++;
        body += questionHtml(q, q.type === 'info' ? 0 : n);
      });
    });
    return who +
      (st.title ? '<h2 class="fb-form-title">' + esc(st.title) + '</h2>' : '') +
      (st.intro ? '<div class="fb-form-intro">' + st.intro.split(/\n+/).map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('') + '</div>' : '') +
      '<form class="fb-form" id="fb-form" novalidate>' +
      '<div class="fb-hp" aria-hidden="true"><label>Website <input type="text" id="fb-website" tabindex="-1" autocomplete="off"></label></div>' +
      body +
      '<div class="fb-consents">' +
      (isGuest
        ? '<label class="motm-consent"><input type="checkbox" id="fb-updates"' + (a.updates ? ' checked' : '') + '><span><strong>Keep me posted about LACMS events</strong><small>Optional. We’ll use your email to tell you what’s coming up. You can say stop at any time.</small></span></label>'
        : (st.allow_anonymous ? '<label class="motm-consent"><input type="checkbox" id="fb-anon"' + (a.anonymous ? ' checked' : '') + '><span><strong>Send this anonymously</strong><small>The committee will see your answers but not your name, email, course or year.</small></span></label>' : '')) +
      '</div>' +
      '<p class="guide-error" data-fb-error role="alert" hidden></p>' +
      '<button type="submit" class="btn btn-primary btn-block btn-glow fb-send">' + esc(st.submit_label || 'Send feedback') + '</button>' +
      '<p class="guide-fine fb-privacy">' + (S.preview ? 'Preview: nothing you enter here is sent.' : (isGuest
        ? 'Your email is only seen by the LACMS committee. We use it to follow up on what you tell us and to make sure each person sends one response per event.'
        : 'Only the LACMS committee reads this.')) + '</p>' +
      '</form>';
  }

  // Show or hide questions as answers change; renumber what is showing; clear answers that were hidden.
  function applyConditions() {
    var n = 0;
    S.def.sections.forEach(function (sec) {
      var any = false;
      (sec.questions || []).forEach(function (q) {
        var el = root.querySelector('[data-fb-q="' + q.id + '"]');
        var vis = visibleNow(q);
        if (!vis) clearAnswer(q);
        if (el) {
          el.hidden = !vis;
          if (vis && q.type !== 'info') { n++; var nn = el.querySelector('.fb-n'); if (nn) nn.textContent = n; }
        }
        if (vis && q.type !== 'info') any = true;
        if (vis && q.type === 'info') any = any || false;
      });
      var head = root.querySelector('[data-fb-sec="' + sec.id + '"]');
      if (head) head.hidden = !any && !(sec.questions || []).some(function (q) { return q.type === 'info' && visibleNow(q); });
    });
  }
  function clearAnswer(q) {
    var a = S.a, had = false;
    if (q.type === 'overall') { had = !!a.rating; a.rating = 0; }
    else if (q.type === 'liked') { had = a.liked.length || a.likedOther; a.liked = []; a.likedOther = ''; }
    else if (q.type === 'improve') { had = a.improve.length || a.improveOther; a.improve = []; a.improveOther = ''; }
    else if (q.type === 'would_return') { had = !!a.would; a.would = ''; }
    else if (q.type === 'shoutouts') { had = !!a.shoutouts; a.shoutouts = ''; }
    else if (q.type === 'comment') { had = !!a.comment; a.comment = ''; }
    else if (q.type === 'heard') { had = !!a.heard; a.heard = ''; }
    else if (q.type === 'suggestion') { had = !!a.suggestion; a.suggestion = ''; }
    else if (S.a.custom[q.id]) { had = true; delete S.a.custom[q.id]; }
    if (had) {
      var el = root.querySelector('[data-fb-q="' + q.id + '"] [data-fb-body]');
      if (el) el.innerHTML = cardBody(q);
    }
  }

  function alreadyStep() {
    return '<div class="fb-card fb-card--center"><span class="fb-big" aria-hidden="true">✓</span><h2 data-fb-focus tabindex="-1">You’ve already told us about this one</h2>' +
      '<p class="fb-sub">Thank you – we have your feedback on <strong>' + esc(S.event ? S.event.name : 'this event') + '</strong>.</p>' +
      '<div class="fb-actions"><button type="button" class="btn btn-primary" data-fb-another>Give feedback on another event</button>' +
      '<a class="btn btn-outline" href="events.html">Back to events</a></div></div>' +
      (S.me && S.me.kind !== 'guest' || !settings().guest_pitch ? '' : pitchHtml());
  }

  function otherEventsHtml() {
    var left = S.events.filter(function (e) { return !S.done[e.slug] && (!S.event || e.slug !== S.event.slug); }).slice(0, 4);
    if (!left.length) return '';
    return '<div class="fb-others"><h3>Been to these too?</h3>' + left.map(function (e) {
      return '<button type="button" class="fb-other" data-fb-pick="' + esc(e.slug) + '"><strong>' + esc(e.name) + '</strong><span>' + esc(e.date ? niceDate(e.date) : '') + '</span></button>';
    }).join('') + '</div>';
  }

  // Live poll results, shown once someone has answered (the database only sends counts once enough people have).
  function pollsHtml() {
    var shown = (S.polls || []).filter(function (p) { return !p.hidden && p.counts; });
    if (!shown.length) return '';
    return '<div class="fb-polls"><h3>How everyone is voting</h3>' + shown.map(function (p) {
      var opts = p.type === 'yesno' ? [{ id: 'yes', label: p.yes_label || 'Yes' }, { id: 'no', label: p.no_label || 'No' }] : (p.options || []).slice();
      if (p.counts.other) opts.push({ id: 'other', label: 'Other' });
      return '<div class="fb-poll"><strong>' + esc(p.title) + '</strong><ul class="fb-poll-bars">' + opts.map(function (o) {
        var n = p.counts[o.id] || 0, pc = p.total ? Math.round(n / p.total * 100) : 0;
        return '<li><span class="fb-poll-label">' + esc(o.label) + '</span><span class="fb-bar"><span style="width:' + pc + '%"></span></span><span class="fb-poll-n">' + pc + '%</span></li>';
      }).join('') + '</ul><small>' + p.total + ' answers so far</small></div>';
    }).join('') + '</div>';
  }

  function doneStep() {
    var member = S.me && S.me.kind !== 'guest';
    var first = member ? firstName(S.me.name) : firstName(S.a.name);
    var note = settings().thank_you;
    var head = '<div class="fb-card fb-card--center"><span class="fb-big fb-big--pop" aria-hidden="true">★</span>' +
      '<h2 data-fb-focus tabindex="-1">Thank you' + (first ? ', ' + esc(first) : '') + '!</h2>' +
      '<p class="fb-sub">Your feedback on <strong>' + esc(S.event ? S.event.name : 'the event') + '</strong> has gone straight to the committee. We read every one and use it to plan what comes next.</p>' +
      (note ? '<div class="fb-thanks-note">' + note.split(/\n+/).map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('') + '</div>' : '') +
      (S.me && S.me.kind === 'member' ? '<p class="fb-reward">Thanks for helping shape LACMS. It counts towards your journey too.</p>' : '') +
      '</div>' + pollsHtml();
    if (member) {
      return head + otherEventsHtml() +
        '<div class="fb-actions fb-actions--center"><a class="btn btn-primary" href="member-hub.html">Back to the Members Hub</a><a class="btn btn-outline" href="events.html">See upcoming events</a></div>';
    }
    return head + (settings().guest_pitch ? pitchHtml() : '') + otherEventsHtml() +
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
    function on(id, evt, fn) { var el = document.getElementById(id); if (el) el.addEventListener(evt, function () { fn(el); }); }
    on('fb-comment', 'input', function (el) {
      S.a.comment = el.value;
      var cnt = form.querySelector('[data-fb-count]'); if (cnt) cnt.textContent = el.value.length + ' / 1500';
      afterAnswer();
    });
    on('fb-quote', 'change', function (el) { S.a.quote = el.checked; saveDraft(); });
    on('fb-anon', 'change', function (el) { S.a.anonymous = el.checked; saveDraft(); });
    on('fb-updates', 'change', function (el) { S.a.updates = el.checked; saveDraft(); });
    on('fb-shoutouts', 'input', function (el) { S.a.shoutouts = el.value; afterAnswer(); });
    on('fb-suggestion', 'input', function (el) { S.a.suggestion = el.value; afterAnswer(); });
    on('fb-email', 'input', function (el) { S.a.email = el.value; });
    on('fb-name', 'input', function (el) { S.a.name = el.value; saveDraft(); });
    Array.prototype.forEach.call(form.querySelectorAll('[data-fb-other]'), function (ta) {
      ta.addEventListener('input', function () {
        var key = ta.getAttribute('data-fb-other');
        S.a[key] = ta.value;
        var cnt = form.querySelector('[data-fb-other-count="' + key + '"]'); if (cnt) cnt.textContent = ta.value.length + ' / 300';
        afterAnswer();
      });
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); send(); });
  }

  // Everything that follows an answer changing.
  function afterAnswer() {
    applyConditions();
    saveDraft();
    Array.prototype.forEach.call(root.querySelectorAll('.fb-card.is-missing'), function (c) {
      var q = FB.findQuestion(S.def, c.getAttribute('data-fb-q'));
      if (q && isAnswered(q)) c.classList.remove('is-missing');
    });
  }
  function questionById(id) { return FB.findQuestion(S.def, id); }
  function redrawBody(id) {
    var q = questionById(id), host = root.querySelector('[data-fb-q="' + id + '"] [data-fb-body]');
    if (!q || !host) return;
    var focus = document.activeElement && document.activeElement.getAttribute ? (document.activeElement.getAttribute('data-fb-single') || document.activeElement.getAttribute('data-fb-scale') || document.activeElement.getAttribute('data-fb-yn') ? document.activeElement : null) : null;
    var sel = focus ? '[' + (focus.getAttribute('data-fb-single') ? 'data-fb-single' : focus.getAttribute('data-fb-scale') ? 'data-fb-scale' : 'data-fb-yn') + '="' + id + '"][data-v="' + focus.getAttribute('data-v') + '"]' : null;
    host.innerHTML = cardBody(q);
    if (sel) { var el = host.querySelector(sel); if (el) el.focus({ preventScroll: true }); }
  }

  // Has this question been answered (as far as the form needs)?
  function isAnswered(q) {
    var a = S.a, c = a.custom[q.id];
    switch (q.type) {
      case 'overall': return !!a.rating;
      case 'liked': return a.liked.length > 0 || !!a.likedOther.trim();
      case 'improve': return a.improve.length > 0 || !!a.improveOther.trim();
      case 'would_return': return !!a.would;
      case 'shoutouts': return !!a.shoutouts.trim();
      case 'comment': return !!a.comment.trim();
      case 'heard': return !!a.heard;
      case 'suggestion': return !!a.suggestion.trim();
      case 'single': return !!(c && c.v && (c.v !== 'other' || String(c.other || '').trim()));
      case 'multi': return !!(c && c.v && c.v.length && (c.v.indexOf('other') === -1 || String(c.other || '').trim()));
      case 'scale': return !!(c && typeof c.v === 'number');
      case 'yesno': return !!(c && c.v);
      case 'text': case 'longtext': return !!(c && String(c.v || '').trim());
    }
    return true;
  }
  // The first visible question that must be answered (or has an unfinished "Other").
  function firstProblem() {
    var qs = qList();
    for (var i = 0; i < qs.length; i++) {
      var q = qs[i];
      if (q.type === 'info' || !visibleNow(q)) continue;
      var c = S.a.custom[q.id];
      var otherEmpty = c && ((c.v === 'other') || (Array.isArray(c.v) && c.v.indexOf('other') !== -1)) && !String(c.other || '').trim();
      if (otherEmpty) return { q: q, msg: 'Please say what \u201COther\u201D is for: ' + q.title };
      if (q.required && !isAnswered(q)) return { q: q, msg: 'Please answer: ' + q.title };
    }
    return null;
  }
  // The custom answers worth sending: visible questions only, tidy.
  function answersToSend() {
    var out = {};
    qList().forEach(function (q) {
      var c = S.a.custom[q.id];
      if (!c || !visibleNow(q) || !isAnswered(q)) return;
      if (q.type === 'single') out[q.id] = c.v === 'other' ? { v: 'other', other: String(c.other).trim() } : { v: c.v };
      else if (q.type === 'multi') out[q.id] = Object.assign({ v: c.v }, c.v.indexOf('other') !== -1 ? { other: String(c.other).trim() } : {});
      else if (q.type === 'scale') out[q.id] = { v: c.v };
      else if (q.type === 'yesno') out[q.id] = { v: c.v };
      else if (q.type === 'text' || q.type === 'longtext') out[q.id] = { v: String(c.v).trim() };
    });
    return out;
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
      afterAnswer();
    } else if (t && t.getAttribute && t.getAttribute('data-fb-multi')) {
      var qid = t.getAttribute('data-fb-multi'), mq = questionById(qid), cur = S.a.custom[qid] || { v: [] };
      var max = mq.max || (mq.options || []).length + 1;
      toggle(cur.v, t.value, max);
      if (cur.v.length) S.a.custom[qid] = cur; else delete S.a.custom[qid];
      var chosen = S.a.custom[qid] || { v: [] };
      var host = root.querySelector('[data-fb-multi-group="' + qid + '"]');
      var focusVal = t.value;
      host.innerHTML = multiChips(mq);
      var again = host.querySelector('input[value="' + focusVal + '"]'); if (again) again.focus({ preventScroll: true });
      var wrap = root.querySelector('[data-fb-other-wrap="' + qid + '"]'); if (wrap) wrap.hidden = chosen.v.indexOf('other') === -1;
      afterAnswer();
    }
  });

  root.addEventListener('input', function (e) {
    var t = e.target, id;
    if (!t.getAttribute) return;
    if ((id = t.getAttribute('data-fb-text')) !== null) {
      var val = t.value;
      if (val.trim()) S.a.custom[id] = { v: val }; else delete S.a.custom[id];
      var cnt = root.querySelector('[data-fb-tcount="' + id + '"]'); if (cnt) cnt.textContent = val.length + ' / ' + (t.maxLength > 0 ? t.maxLength : 1000);
      afterAnswer();
    } else if ((id = t.getAttribute('data-fb-other-text')) !== null) {
      if (S.a.custom[id]) S.a.custom[id].other = t.value;
      afterAnswer();
    }
  });

  root.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('button') : null;
    if (!t) return;
    var v;
    if ((v = t.getAttribute('data-fb-pick')) !== null) { S.notice = ''; chooseEvent(v); return; }
    if (t.hasAttribute('data-fb-change-event') || t.hasAttribute('data-fb-another')) { S.event = null; go('event'); return; }
    if ((v = t.getAttribute('data-fb-who')) !== null) {
      if (v === 'member') {
        saveDraft();
        window.location.href = 'member-login.html?next=' + encodeURIComponent(pageUrl(S.event ? S.event.slug : '', false));
      } else {
        S.guest = true;
        try { window.history.replaceState(null, '', pageUrl(S.event ? S.event.slug : '', true)); } catch (err) { /* ignore */ }
        go('form');
      }
      return;
    }
    if ((v = t.getAttribute('data-fb-rate')) !== null) { S.a.rating = +v; var rq = questionById('overall'); if (rq && rq.style === 'stars') redrawBody('overall'); else setOn('[data-fb-rate]', 'data-fb-rate', v); afterAnswer(); clearError(); return; }
    if ((v = t.getAttribute('data-fb-would')) !== null) { S.a.would = S.a.would === v ? '' : v; setOn('[data-fb-would]', 'data-fb-would', S.a.would); afterAnswer(); return; }
    if ((v = t.getAttribute('data-fb-heard')) !== null) { S.a.heard = S.a.heard === v ? '' : v; setOn('[data-fb-heard]', 'data-fb-heard', S.a.heard, 'aria-pressed'); afterAnswer(); return; }
    if ((v = t.getAttribute('data-fb-kind')) !== null) { S.a.kind = S.a.kind === v ? '' : v; setOn('[data-fb-kind]', 'data-fb-kind', S.a.kind); saveDraft(); return; }
    if ((v = t.getAttribute('data-fb-single')) !== null) {
      var sv = t.getAttribute('data-v'), sc = S.a.custom[v];
      if (sc && sc.v === sv) delete S.a.custom[v]; else S.a.custom[v] = { v: sv, other: sc && sv === 'other' ? sc.other : '' };
      redrawBody(v); afterAnswer();
      var ow = root.querySelector('[data-fb-other-wrap="' + v + '"]'); if (ow && !ow.hidden) { var oi = ow.querySelector('input'); if (oi) oi.focus(); }
      return;
    }
    if ((v = t.getAttribute('data-fb-scale')) !== null) {
      var nv = +t.getAttribute('data-v'), cs = S.a.custom[v];
      if (cs && cs.v === nv) delete S.a.custom[v]; else S.a.custom[v] = { v: nv };
      redrawBody(v); afterAnswer(); return;
    }
    if ((v = t.getAttribute('data-fb-yn')) !== null) {
      var yv = t.getAttribute('data-v'), cy = S.a.custom[v];
      if (cy && cy.v === yv) delete S.a.custom[v]; else S.a.custom[v] = { v: yv };
      redrawBody(v); afterAnswer(); return;
    }
    if ((v = t.getAttribute('data-fb-other-toggle')) !== null) {
      var box = t.parentNode.querySelector('.fb-other-field'), opening = box.hidden;
      box.hidden = !opening;
      t.setAttribute('aria-expanded', opening ? 'true' : 'false');
      if (opening) box.querySelector('textarea').focus();
      return;
    }
    if ((v = t.getAttribute('data-fb-starter')) !== null) {
      var ta = document.getElementById('fb-comment');
      var add = STARTERS[+v];
      if (ta.value.indexOf(add) !== -1) { ta.focus(); return; }       // already started that sentence
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
    if (!S.event) { go('event', !initial); return Promise.resolve(); }
    S.a = blank();
    if (!S.preview) restoreDraft(S.event.slug);
    try { if (!S.preview) window.history.replaceState(null, '', pageUrl(S.event.slug, S.guest && !(S.me && S.me.kind !== 'guest'))); } catch (e) { /* ignore */ }
    if (!S.preview && S.done[S.event.slug]) { go('already', !initial); return Promise.resolve(); }
    // The form for this event (its own, the default, or the standard one).
    return loadForm(S.event.slug).then(function () {
      var st = settings();
      if (!S.preview && st.closes_on && st.closes_on < todayKey()) { S.why = 'formclosed'; go('unavailable', !initial); return; }
      afterEventChosen(initial);
    });
  }
  function afterEventChosen(initial) {
    var scroll = !initial;
    if (S.preview) { S.guest = true; go('form', scroll); return; }
    var membersOnly = settings().audience === 'members';
    if (S.me && S.me.kind !== 'guest') { go('form', scroll); return; }
    if (membersOnly) {
      if (S.me) { S.why = 'members'; go('unavailable', scroll); return; }       // signed in, but not a member
      go('who', scroll); return;
    }
    if (S.guest || S.me) { go('form', scroll); return; }       // a signed-in non-member is treated as a guest
    go('who', scroll);
  }

  function send() {
    var a = S.a;
    clearError();
    var guestMode = !(S.me && S.me.kind !== 'guest');
    if (guestMode && !S.preview) {
      var em = (document.getElementById('fb-email').value || '').trim();
      a.email = em;
      a.name = (document.getElementById('fb-name').value || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { showError('Enter a valid email so we can follow up.', document.getElementById('fb-email')); return; }
    }
    var prob = firstProblem();
    if (prob) {
      var card = root.querySelector('[data-fb-q="' + prob.q.id + '"]');
      if (card) { card.classList.add('is-missing'); card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' }); }
      showError(prob.msg);
      return;
    }
    if (S.preview) { showError('Looks good. This is a preview, so nothing was sent.'); var eb = root.querySelector('[data-fb-error]'); if (eb) eb.classList.add('is-ok'); return; }
    if (inPreview()) { showError('You’re previewing someone’s account, so nothing can be sent.'); return; }
    var btn = root.querySelector('.fb-send');
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Sending…';
    var params = {
      p_event_slug: S.event.slug, p_rating: a.rating || null, p_liked: a.liked, p_improve: a.improve,
      p_comment: a.comment.trim() || null, p_would_return: a.would || null, p_heard_from: a.heard || null,
      p_suggestion: a.suggestion.trim() || null, p_anonymous: !!a.anonymous && settings().allow_anonymous, p_quote_ok: !!a.quote && settings().ask_quote_consent,
      p_guest_email: guestMode ? a.email : null, p_guest_name: guestMode ? (a.name || null) : null,
      p_guest_kind: guestMode ? (a.kind || null) : null, p_wants_updates: guestMode ? !!a.updates : false,
      p_website: (document.getElementById('fb-website') || {}).value || null,
      p_source: S.src || null
    };
    // The typed answers and the custom answers are only sent when there is something to send.
    var typed = {};
    if (a.likedOther.trim()) typed.p_liked_other = a.likedOther.trim();
    if (a.improveOther.trim()) typed.p_improve_other = a.improveOther.trim();
    if (a.shoutouts.trim()) typed.p_shoutouts = a.shoutouts.trim();
    var answers = answersToSend(), extra = {};
    if (Object.keys(answers).length) extra.p_answers = answers;
    var missing = /Could not find the function|schema cache/i;
    // Newer databases understand more; older ones are sent what they know so nothing breaks.
    supabaseClient.rpc('submit_event_feedback', Object.assign({}, params, typed, extra)).then(function (res) {
      if (res.error && Object.keys(extra).length && missing.test(res.error.message || '')) {
        return supabaseClient.rpc('submit_event_feedback', Object.assign({}, params, typed));
      }
      return res;
    }).then(function (res) {
      if (res.error && Object.keys(typed).length && missing.test(res.error.message || '')) {
        return supabaseClient.rpc('submit_event_feedback', params);
      }
      return res;
    }).then(function (res) {
      if (res.error) {
        btn.disabled = false; btn.textContent = label;
        var msg = res.error.message || 'Something went wrong - try again.';
        if (missing.test(msg)) msg = 'Feedback isn’t switched on yet. Email acms@lincolnsu.com and we’ll sort it.';
        showError(msg);
        return;
      }
      ls(DRAFT_KEY, null);
      if (guestMode) ss(GUEST_KEY, a.email);
      S.done[S.event.slug] = true;
      var already = res.data && res.data.already;
      if (already) { go('already'); return; }
      loadPolls(S.event.slug).then(function () { go('done'); });
    }, function () {
      btn.disabled = false; btn.textContent = label;
      showError('We couldn’t reach the server - check your connection and try again.');
    });
  }

  // ---- Start ---------------------------------------------------------------------------
  try { if (params().get('embed') === '1') document.documentElement.classList.add('fb-embed'); } catch (e) { /* ignore */ }
  Promise.all([loadEvents(), loadMe()]).then(function (res) {
    S.events = res[0];
    S.me = res[1];
    return loadDone();
  }).then(function (done) {
    S.done = done || {};
    var p = params();
    if (p.get('as') === 'guest') S.guest = true;
    var src = String(p.get('src') || '').toLowerCase();
    if (/^[a-z0-9]{4,16}$/.test(src)) S.src = src;
    var wanted = p.get('event');

    // The committee previewing a form they are editing: any event, any date, nothing is sent.
    if (p.get('preview') === '1' && wanted) {
      S.preview = true;
      if (wanted === 'general') { chooseEvent('general', true); return; }
      return supabaseClient.from('site_events').select('slug, name, tag, starts_on, date_text').eq('slug', wanted).maybeSingle().then(function (r) {
        var e = r && r.data;
        S.event = e ? { slug: e.slug, name: e.name, tag: e.tag || '', date: e.starts_on, dateText: e.date_text } : { slug: wanted, name: wanted, tag: '', date: null, dateText: '' };
        S.events.unshift(S.event);
        return chooseEvent(S.event.slug, true);
      });
    }

    if (wanted && (wanted === 'general' || S.events.some(function (e) { return e.slug === wanted; }))) {
      return chooseEvent(wanted, true);
    }
    if (!wanted) { S.step = 'event'; render(); return; }
    // A link for one event that isn't in the "open" list: find out why instead of asking which event.
    return supabaseClient.from('site_events').select('slug, name, tag, starts_on, ends_on, date_text').eq('slug', wanted).eq('is_active', true).maybeSingle().then(function (r) {
      var e = r && r.data;
      if (!e) { S.notice = 'We couldn\u2019t find that event \u2013 choose it below.'; S.step = 'event'; render(); return; }
      var start = e.starts_on || parseDateText(e.date_text), end = e.ends_on || start, today = todayKey();
      S.event = { slug: e.slug, name: e.name, tag: e.tag || '', date: start, dateText: e.date_text };
      if (start && start > today) { S.why = 'soon'; S.step = 'unavailable'; render(); return; }
      if (end && end < dayBefore(today, 120)) { S.why = 'closed'; S.step = 'unavailable'; render(); return; }
      S.events.unshift(S.event);                       // open after all (e.g. no date on file)
      return chooseEvent(wanted, true);
    }, function () { S.step = 'event'; render(); });
  });
})();
