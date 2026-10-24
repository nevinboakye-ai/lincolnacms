// Dashboard > Email (the president, or anyone given the Email tile): write an email from the website and send it to exactly
// the people you choose - for example only the students who applied to Sankofa, only one
// phase, only those already placed in a Circle, one named person, or a mix - and keep a record
// of everything that was sent.
//
// How it works:
//   * Who can receive: built in the browser from what the dashboard already gets through the
//     president-only RPCs (members, professionals, Sankofa applications and phases, the Hub's
//     Circles, pending account requests). Nothing about anyone is sent anywhere until you press
//     send.
//   * Sending: one email per person through the same send-account-email Edge Function the
//     account-request emails use (type "custom"), so each person gets their own personalised
//     message ({first_name}, {name}, {email}, {phase}, {circle}) and each email tells people to write to the committee
//     address (acms@lincolnsu.com) rather than reply. There is no "reply all" and nobody sees anyone else's address.
//   * Record: every send is written to email_log (migration 097), grouped into a batch, and shown
//     under "Sent" with who it went to, when, and whether it worked. Failed ones can be retried.
(function () {
  'use strict';

  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;
  var root = document.getElementById('email-centre-root');
  if (!root) return;
  var panel = document.getElementById('dash-panel-email');

  var MAX_PER_BATCH = 200;
  var SEND_GAP_MS = 450;          // a gentle pace so the email service never rate-limits a batch
  var DRAFT_KEY = 'lacms-email-draft';

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function lc(s) { return String(s || '').trim().toLowerCase(); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function timeAgo(iso) {
    var t = new Date(iso); if (isNaN(t.getTime())) return '';
    var m = Math.floor((Date.now() - t.getTime()) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' hr ago';
    var d = Math.floor(h / 24);
    if (d < 14) return d + (d === 1 ? ' day ago' : ' days ago');
    return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function when(iso) {
    return new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  // "Dr Ada Okoye" -> "Dr Okoye", anyone else by first name.
  function greetName(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length > 1 && /^(dr|prof|professor)\.?$/i.test(parts[0])) return parts[0] + ' ' + parts[parts.length - 1];
    return parts[0] || 'there';
  }
  function merge(text, p) {
    return String(text || '')
      .replace(/\{first_name\}/gi, greetName(p.name))
      .replace(/\{name\}/gi, p.name || '')
      .replace(/\{email\}/gi, p.email || '')
      .replace(/\{phase\}/gi, p.phase || 'this phase')
      .replace(/\{circle\}/gi, p.circle || 'your Circle');
  }
  // Same rules as the Edge Function's textToHtml, so the preview matches what is sent.
  function previewHtml(text) {
    return String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/).filter(function (para) { return para.trim(); }).map(function (para) {
      var html = esc(para.trim()).replace(/https?:\/\/[^\s<]+/g, function (m) {
        var trail = (/[.,;:!?)\]]+$/.exec(m) || [''])[0];
        var url = trail ? m.slice(0, m.length - trail.length) : m;
        return '<a href="' + url + '" target="_blank" rel="noopener">' + url + '</a>' + trail;
      });
      return '<p>' + html.replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }
  function describeError(error) {
    if (error && error.context && typeof error.context.json === 'function') {
      return error.context.json().then(
        function (body) { return (body && body.error) || error.message || 'Failed to send the email'; },
        function () { return error.message || 'Failed to send the email'; }
      );
    }
    return Promise.resolve((error && error.message) || 'Failed to send the email');
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  var state = {
    tab: 'write',
    loaded: false,
    loading: false,
    loadErrors: [],
    people: {},              // lower(email) -> person
    rounds: [],              // [{ id, name }]
    circles: [],             // [{ id, name }]
    audience: '',            // chosen group id
    refine: { phase: 'all', status: 'all', course: 'all', placed: 'all', circle: 'all' },
    manual: {},              // lower(email) -> true: people added by search
    excluded: {},            // lower(email) -> true: unticked in the list
    search: '',
    subject: '',
    message: '',
    template: '',
    saved: null,             // saved templates (account_email_templates), null until loaded
    log: [],                 // recent email_log rows, newest first
    logLoaded: false,
    logError: '',
    openBatch: '',
    sending: null,           // { done, total, sent, failed, cancelled, batch }
    result: null,            // summary after a batch
    myEmail: '',
    motmUnavailable: true,   // true until the Member of the Month lists (migration 099) have loaded
    motmNominators: {}       // lower(email) -> true: has nominated this month
  };

  // ---------------------------------------------------------------------
  // Built-in templates
  // ---------------------------------------------------------------------
  var TEMPLATES = [
    {
      id: 'sk-launch', name: 'Sankofa launch - meeting link',
      subject: 'Sankofa Circles launches soon - join us',
      message: 'Hi {first_name},\n\nSankofa Circles is officially launching and we would love you to be there.\n\nWhen: [date and time]\nWhere: [location or meeting link]\n\nWe will introduce the Circles, how mentoring works and what happens next. If you cannot make it, just email us at acms@lincolnsu.com and let us know.\n\nThe LACMS Committee'
    },
    {
      id: 'sk-welcome', name: 'Sankofa - welcome to your Circle',
      subject: 'Welcome to Sankofa - your Circle is ready',
      message: 'Hi {first_name},\n\nYou have been placed in {circle}. Log in to the Sankofa Hub to meet your Circle, see upcoming meetings and set your first goal.\n\nhttps://lincolnacms.uk/member-sankofa-hub.html\n\nWe are glad you are part of it.\n\nThe LACMS Committee'
    },
    {
      id: 'sk-update', name: 'Sankofa - an update',
      subject: 'An update on Sankofa Circles',
      message: 'Hi {first_name},\n\nA quick update on Sankofa Circles: [your update here].\n\nIf you have any questions, just email us at acms@lincolnsu.com.\n\nThe LACMS Committee'
    },
    {
      id: 'motm-nudge', name: 'Member of the Month - who stood out?',
      subject: 'Who stood out for you lately?',
      message: 'Hi {first_name},\n\nIs there someone who made a difference to you recently? Maybe they helped you revise, made you feel welcome, or showed up when it counted.\n\nNominating them for Member of the Month takes about ten seconds: tick a few reasons that fit and you are done. They will hear that someone thinks they are making a difference.\n\nhttps://lincolnacms.uk/motm.html#nominate\n\nThe LACMS Committee'
    },
    {
      id: 'motm-close', name: 'Member of the Month - nominations close soon',
      subject: 'Member of the Month nominations close soon',
      message: 'Hi {first_name},\n\nNominations for this month\'s Member of the Month close on [date]. If someone deserves a thank you, there is still time.\n\nWe are [number] nominations away from [the goal and what it unlocks].\n\nhttps://lincolnacms.uk/motm.html#nominate\n\nThe LACMS Committee'
    },
    {
      id: 'motm-thanks', name: 'Member of the Month - thank you for nominating',
      subject: 'Thank you for nominating',
      message: 'Hi {first_name},\n\nThank you for nominating someone for Member of the Month. Recognising the people around us is what makes this community what it is.\n\nThe LACMS Committee'
    },
    {
      id: 'general', name: 'General message',
      subject: '',
      message: 'Hi {first_name},\n\n[your message]\n\nThe LACMS Committee'
    },
    { id: 'blank', name: 'Blank message', subject: '', message: '' }
  ];

  // ---------------------------------------------------------------------
  // Loading everything the audiences are built from
  // ---------------------------------------------------------------------
  function rpcSafe(name, args, label) {
    return supabaseClient.rpc(name, args || {}).then(function (res) {
      if (res.error) { state.loadErrors.push(label + ': ' + res.error.message); return []; }
      return res.data || [];
    }, function (err) { state.loadErrors.push(label + ': ' + ((err && err.message) || 'failed')); return []; });
  }
  function personFor(email, name) {
    var k = lc(email);
    if (!k || k.indexOf('@') === -1) return null;
    var p = state.people[k];
    if (!p) p = state.people[k] = { key: k, email: String(email).trim(), name: name || '', kinds: {} };
    if (name && !p.name) p.name = name;
    return p;
  }

  function loadAll() {
    if (state.loading) return Promise.resolve();
    state.loading = true;
    state.loadErrors = [];
    return Promise.all([
      rpcSafe('president_get_members', {}, 'Members'),
      rpcSafe('president_get_professionals', {}, 'Professionals'),
      rpcSafe('president_get_sankofa_applications', {}, 'Sankofa applications'),
      rpcSafe('president_get_sankofa_application_rounds', {}, 'Sankofa phases'),
      supabaseClient.from('sankofa_rounds').select('id, name, created_at').order('created_at', { ascending: true }).then(function (r) { return r.error ? [] : (r.data || []); }, function () { return []; }),
      rpcSafe('president_get_sankofa_mentor_applications', {}, 'Mentor applications'),
      supabaseClient.rpc('sankofa_admin_overview').then(function (r) { return r.error ? null : r.data; }, function () { return null; }),
      rpcSafe('president_get_account_requests', {}, 'Student requests'),
      supabaseClient.rpc('president_get_professional_requests').then(function (r) { return r.error ? [] : (r.data || []); }, function () { return []; }),
      supabaseClient.auth.getSession().then(function (r) { return r && r.data && r.data.session ? r.data.session.user.email : ''; }, function () { return ''; }),
      supabaseClient.rpc('email_motm_nominators').then(function (r) { return r.error ? null : (r.data || []); }, function () { return null; })
    ]).then(function (res) {
      state.people = {};
      var members = res[0], pros = res[1], apps = res[2], appRounds = res[3], rounds = res[4], mentorForms = res[5], overview = res[6], studentReqs = res[7], proReqs = res[8];
      state.myEmail = res[9] || '';
      state.motmUnavailable = res[10] === null;
      state.motmNominators = {};
      (res[10] || []).forEach(function (x) { if (x && x.email) state.motmNominators[lc(x.email)] = true; });
      state.rounds = rounds.map(function (r) { return { id: r.id, name: r.name }; });
      var roundName = {}; state.rounds.forEach(function (r) { roundName[r.id] = r.name; });
      var roundOfApp = {}; appRounds.forEach(function (x) { roundOfApp[x.application_id] = x.round_id; });

      members.forEach(function (m) {
        var p = personFor(m.email, m.full_name); if (!p) return;
        p.kinds.member = true; p.member_type = m.member_type; p.course = m.course; p.year = m.year_of_study; p.committee_role = m.committee_role; p.user_id = m.id;
      });
      pros.forEach(function (m) {
        var p = personFor(m.email, m.full_name); if (!p) return;
        p.kinds.professional = true; p.pro_category = m.category; p.job_title = m.title;
      });
      apps.forEach(function (a) {
        var p = personFor(a.email, a.full_name); if (!p) return;
        if (a.applicant_type === 'mentor') p.mentorApp = { status: a.status, source: 'account' };
        else p.menteeApp = { status: a.status, round_id: roundOfApp[a.id] || null, phase: roundName[roundOfApp[a.id]] || '' };
      });
      mentorForms.forEach(function (a) {
        var p = personFor(a.email, a.full_name); if (!p) return;
        p.kinds.mentor_form = true;
        if (!p.mentorApp) p.mentorApp = { status: a.status, source: 'form' };
      });
      state.circles = [];
      if (overview) {
        (overview.circles || []).forEach(function (c) { state.circles.push({ id: c.id, name: c.name }); });
        var circleName = {}; state.circles.forEach(function (c) { circleName[c.id] = c.name; });
        var all = (overview.unplaced || []).slice();
        (overview.circles || []).forEach(function (c) { all = all.concat(c.members || []); });
        all.forEach(function (x) {
          var p = personFor(x.email, x.name); if (!p) return;
          p.hubRole = x.role; p.hubStatus = x.status;
          if (x.circle_id) { p.circleId = x.circle_id; p.circle = circleName[x.circle_id] || ''; }
        });
      }
      Object.keys(state.people).forEach(function (k) { state.people[k].nominatedThisMonth = !!state.motmNominators[k]; });
      studentReqs.forEach(function (r) { if (r.status !== 'pending') return; var p = personFor(r.email, r.full_name); if (p) p.reqStudent = true; });
      proReqs.forEach(function (r) { if (r.status !== 'pending') return; var p = personFor(r.email, r.full_name); if (p) p.reqPro = true; });
      Object.keys(state.people).forEach(function (k) {
        var p = state.people[k];
        if (p.menteeApp) p.phase = p.menteeApp.phase;
      });
      state.loaded = true;
      state.loading = false;
      return loadLog();
    }).then(function () { render(); }, function () { state.loading = false; render(); });
  }

  function loadLog() {
    return supabaseClient.from('email_log').select('*').order('created_at', { ascending: false }).limit(2000).then(function (r) {
      if (r.error) {
        state.logError = /does not exist|schema cache|could not find/i.test(r.error.message || '') ? 'The email record needs migration 097 to be run in Supabase (see README-members-setup.md, section 149).' : r.error.message;
        state.log = []; state.logLoaded = true; return;
      }
      state.logError = '';
      state.log = r.data || [];
      state.logLoaded = true;
      var countEl = document.getElementById('dash-count-email');
      if (countEl) { var nb = batches().length; countEl.textContent = nb ? plural(nb, 'email batch', 'email batches') + ' sent' : 'Nothing sent yet'; }
      var last = {};
      state.log.forEach(function (row) { var k = lc(row.recipient_email); if (!last[k] && row.status === 'sent') last[k] = row; });
      Object.keys(state.people).forEach(function (k) { state.people[k].lastEmail = last[k] || null; });
    }, function (err) { state.logError = (err && err.message) || 'Could not load the email record'; state.logLoaded = true; });
  }

  function loadTemplates() {
    if (state.saved !== null) return Promise.resolve();
    return supabaseClient.from('account_email_templates').select('*').order('name').then(function (r) {
      state.saved = r.error ? [] : (r.data || []);
    }, function () { state.saved = []; });
  }

  // ---------------------------------------------------------------------
  // Audiences
  // ---------------------------------------------------------------------
  var AUDIENCES = [
    { id: 'sk_mentee_apps', group: 'Sankofa', label: 'Students who applied to Sankofa', refine: ['phase', 'status', 'course', 'placed'],
      match: function (p) { return !!p.menteeApp; } },
    { id: 'sk_mentor_apps', group: 'Sankofa', label: 'Mentors who applied to Sankofa', refine: ['placed'],
      match: function (p) { return !!p.mentorApp; } },
    { id: 'sk_hub_mentees', group: 'Sankofa', label: 'Mentees in the Sankofa Hub', refine: ['circle'],
      match: function (p) { return p.hubRole === 'mentee'; } },
    { id: 'sk_hub_mentors', group: 'Sankofa', label: 'Mentors in the Sankofa Hub', refine: ['circle'],
      match: function (p) { return p.hubRole === 'mentor'; } },
    { id: 'motm_not_yet', group: 'Member of the Month', label: 'Members who haven\'t nominated this month', refine: [], needs: 'motm',
      match: function (p) { return !!p.kinds.member && !p.nominatedThisMonth; } },
    { id: 'motm_done', group: 'Member of the Month', label: 'Members who nominated this month', refine: [], needs: 'motm',
      match: function (p) { return !!p.kinds.member && !!p.nominatedThisMonth; } },
    { id: 'exec', group: 'People', label: 'Executive Committee', refine: [],
      match: function (p) { return p.member_type === 'executive_committee'; } },
    { id: 'supp', group: 'People', label: 'Supporting Committee', refine: [],
      match: function (p) { return p.member_type === 'supporting_committee'; } },
    { id: 'pros', group: 'People', label: 'Healthcare professionals (approved)', refine: [],
      match: function (p) { return !!p.kinds.professional; } },
    { id: 'req_students', group: 'Requests', label: 'Student account requests waiting', refine: [],
      match: function (p) { return !!p.reqStudent; } },
    { id: 'req_pros', group: 'Requests', label: 'Professional account requests waiting', refine: [],
      match: function (p) { return !!p.reqPro; } },
    { id: 'all_members', group: 'Everyone', label: 'Every member (use with care)', refine: [], big: true,
      match: function (p) { return !!p.kinds.member; } }
  ];
  function audienceById(id) { for (var i = 0; i < AUDIENCES.length; i++) if (AUDIENCES[i].id === id) return AUDIENCES[i]; return null; }
  function isMedicine(p) { return /medicine/i.test(p.course || ''); }

  function audiencePeople() {
    var a = audienceById(state.audience);
    if (!a) return [];
    var rf = state.refine;
    return Object.keys(state.people).map(function (k) { return state.people[k]; }).filter(function (p) {
      if (!a.match(p)) return false;
      if (a.refine.indexOf('phase') !== -1 && rf.phase !== 'all' && (!p.menteeApp || p.menteeApp.round_id !== rf.phase)) return false;
      if (a.refine.indexOf('status') !== -1 && rf.status !== 'all' && (!p.menteeApp || p.menteeApp.status !== rf.status)) return false;
      if (a.refine.indexOf('course') !== -1) {
        if (rf.course === 'medicine' && !isMedicine(p)) return false;
        if (rf.course === 'other' && isMedicine(p)) return false;
      }
      if (a.refine.indexOf('placed') !== -1) {
        if (rf.placed === 'placed' && !p.circleId) return false;
        if (rf.placed === 'unplaced' && p.circleId) return false;
      }
      if (a.refine.indexOf('circle') !== -1 && rf.circle !== 'all' && p.circleId !== rf.circle) return false;
      return true;
    });
  }
  // Everyone who could be emailed right now: the chosen group plus anyone added by search.
  function candidates() {
    var seen = {}, out = [];
    audiencePeople().forEach(function (p) { if (!seen[p.key]) { seen[p.key] = true; out.push(p); } });
    Object.keys(state.manual).forEach(function (k) { var p = state.people[k]; if (p && !seen[k]) { seen[k] = true; out.push(p); } });
    out.sort(function (a, b) { return (a.name || a.email).localeCompare(b.name || b.email); });
    return out;
  }
  function recipients() { return candidates().filter(function (p) { return !state.excluded[p.key]; }); }
  // A short description of who a batch went to, saved with it: "Students who applied to Sankofa · Phase 2 · Medicine only".
  function audienceLabel() {
    var a = audienceById(state.audience), rf = state.refine, bits = [];
    if (a) {
      bits.push(a.label);
      if (a.refine.indexOf('phase') !== -1 && rf.phase !== 'all') bits.push((state.rounds.filter(function (r) { return r.id === rf.phase; })[0] || {}).name || 'one phase');
      if (a.refine.indexOf('status') !== -1 && rf.status !== 'all') bits.push(rf.status);
      if (a.refine.indexOf('course') !== -1 && rf.course !== 'all') bits.push(rf.course === 'medicine' ? 'Medicine only' : 'not Medicine');
      if (a.refine.indexOf('placed') !== -1 && rf.placed !== 'all') bits.push(rf.placed === 'placed' ? 'placed in a Circle' : 'not placed yet');
      if (a.refine.indexOf('circle') !== -1 && rf.circle !== 'all') bits.push((state.circles.filter(function (c) { return c.id === rf.circle; })[0] || {}).name || 'one Circle');
    }
    var extra = Object.keys(state.manual).length;
    if (extra) bits.push((a ? '+ ' : '') + plural(extra, 'person chosen by name', 'people chosen by name'));
    return bits.join(' · ');
  }

  function kindLabel(p) {
    var bits = [];
    if (p.kinds.professional) bits.push('Professional');
    if (p.member_type === 'executive_committee') bits.push('Executive');
    else if (p.member_type === 'supporting_committee') bits.push('Supporting');
    if (p.menteeApp) bits.push('Applied' + (p.menteeApp.phase ? ' · ' + p.menteeApp.phase : '') + (p.menteeApp.status && p.menteeApp.status !== 'pending' ? ' · ' + p.menteeApp.status : ''));
    if (p.mentorApp) bits.push('Mentor applicant');
    if (p.hubRole) bits.push((p.hubRole === 'mentor' ? 'Mentor' : 'Mentee') + (p.circle ? ' · ' + p.circle : ' · unplaced'));
    if (p.reqStudent) bits.push('Account request');
    if (p.reqPro) bits.push('Professional request');
    if (p.course && p.kinds.member) bits.push(p.course + (p.year ? ' ' + p.year : ''));
    return bits.join(' · ');
  }

  // ---------------------------------------------------------------------
  // Draft (kept in this browser so a refresh doesn't lose a half-written email)
  // ---------------------------------------------------------------------
  function saveDraft() {
    if (!state.subject && !state.message) { lsDel(DRAFT_KEY); return; }
    lsSet(DRAFT_KEY, JSON.stringify({ subject: state.subject, message: state.message }));
  }
  (function restoreDraft() {
    try {
      var d = JSON.parse(lsGet(DRAFT_KEY) || 'null');
      if (d) { state.subject = String(d.subject || ''); state.message = String(d.message || ''); }
    } catch (e) { /* ignore */ }
  })();

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  function render() {
    var html = '<div class="ec-tabs" role="tablist">' +
      '<button type="button" role="tab" class="' + (state.tab === 'write' ? 'is-active' : '') + '" aria-selected="' + (state.tab === 'write') + '" data-ec-tab="write">Write an email</button>' +
      '<button type="button" role="tab" class="' + (state.tab === 'sent' ? 'is-active' : '') + '" aria-selected="' + (state.tab === 'sent') + '" data-ec-tab="sent">Sent' + (state.log.length ? ' <span class="ec-count">' + batches().length + '</span>' : '') + '</button></div>';
    if (state.loading && !state.loaded) html += '<p class="sh-muted">Loading who you can email…</p>';
    else html += state.tab === 'write' ? writeHtml() : sentHtml();
    var keepFocus = document.activeElement && document.activeElement.id;
    var sel = null;
    if (keepFocus && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) sel = [document.activeElement.selectionStart, document.activeElement.selectionEnd];
    var scroll = root.querySelector('.ec-recipient-list');
    var scrollTop = scroll ? scroll.scrollTop : 0;
    root.innerHTML = html;
    var nl = root.querySelector('.ec-recipient-list'); if (nl && scrollTop) nl.scrollTop = scrollTop;
    if (keepFocus) {
      var el = document.getElementById(keepFocus);
      if (el) { el.focus(); if (sel && el.setSelectionRange) { try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* ignore */ } } }
    }
  }

  function selectOptions(opts, current) {
    return opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(current) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
  }

  function audienceHtml() {
    var groups = {};
    AUDIENCES.forEach(function (a) {
      if (a.needs === 'motm' && state.motmUnavailable) return;   // migration 099 not run yet
      (groups[a.group] = groups[a.group] || []).push(a);
    });
    var html = '<div class="ec-card"><h3><span class="ec-step">1</span> Who is it for?</h3><div class="ec-aud">';
    Object.keys(groups).forEach(function (g) {
      html += '<div class="ec-aud-group"><span class="ec-label">' + esc(g) + '</span><div class="ec-chips">' + groups[g].map(function (a) {
        var n = Object.keys(state.people).filter(function (k) { return a.match(state.people[k]); }).length;
        return '<button type="button" class="ec-chip' + (state.audience === a.id ? ' is-on' : '') + '" data-ec-aud="' + a.id + '" aria-pressed="' + (state.audience === a.id) + '">' + esc(a.label) + ' <b>' + n + '</b></button>';
      }).join('') + '</div></div>';
    });
    html += '</div>';
    var a = audienceById(state.audience);
    if (a && a.refine.length) {
      var rf = state.refine;
      html += '<div class="ec-refine">';
      if (a.refine.indexOf('phase') !== -1) html += '<label class="ec-field"><span>Application phase</span><select data-ec-refine="phase">' + selectOptions([['all', 'Every phase']].concat(state.rounds.map(function (r) { return [r.id, r.name]; })), rf.phase) + '</select></label>';
      if (a.refine.indexOf('status') !== -1) html += '<label class="ec-field"><span>Application status</span><select data-ec-refine="status">' + selectOptions([['all', 'Any'], ['pending', 'Pending'], ['accepted', 'Accepted'], ['declined', 'Declined']], rf.status) + '</select></label>';
      if (a.refine.indexOf('course') !== -1) html += '<label class="ec-field"><span>Course</span><select data-ec-refine="course">' + selectOptions([['all', 'Any course'], ['medicine', 'Medicine only'], ['other', 'Not medicine']], rf.course) + '</select></label>';
      if (a.refine.indexOf('placed') !== -1) html += '<label class="ec-field"><span>In a Circle</span><select data-ec-refine="placed">' + selectOptions([['all', 'Either'], ['placed', 'Placed in a Circle'], ['unplaced', 'Not placed yet']], rf.placed) + '</select></label>';
      if (a.refine.indexOf('circle') !== -1) html += '<label class="ec-field"><span>Circle</span><select data-ec-refine="circle">' + selectOptions([['all', 'Every Circle']].concat(state.circles.map(function (c) { return [c.id, c.name]; })), rf.circle) + '</select></label>';
      html += '</div>';
    }
    // Add anyone by name
    html += '<div class="ec-add"><label class="ec-label" for="ec-search">Add a specific person</label><input type="search" id="ec-search" placeholder="Search by name or email…" value="' + esc(state.search) + '" autocomplete="off">';
    var q = lc(state.search);
    if (q.length >= 2) {
      var hits = Object.keys(state.people).map(function (k) { return state.people[k]; }).filter(function (p) {
        return !state.manual[p.key] && (lc(p.name).indexOf(q) !== -1 || p.key.indexOf(q) !== -1);
      }).slice(0, 8);
      html += '<div class="ec-hits">' + (hits.length ? hits.map(function (p) {
        return '<div class="ec-hit"><span class="ec-hit-main"><strong>' + esc(p.name || p.email) + '</strong><small>' + esc(p.email) + (kindLabel(p) ? ' · ' + esc(kindLabel(p)) : '') + '</small></span><button type="button" class="btn btn-outline btn-sm" data-ec-add="' + esc(p.key) + '">Add</button></div>';
      }).join('') : '<p class="sh-muted">Nobody found.</p>') + '</div>';
    }
    html += '</div>';

    // The list
    var list = candidates();
    var chosen = list.filter(function (p) { return !state.excluded[p.key]; }).length;
    html += '<div class="ec-recipients"><div class="ec-recipients-head"><strong>' + (state.audience || list.length ? plural(chosen, 'person', 'people') + ' selected' : 'No one chosen yet') + (list.length !== chosen ? ' <span class="sh-muted">of ' + list.length + '</span>' : '') + '</strong>' +
      (list.length ? '<span class="ec-recipients-tools"><button type="button" class="link-button" data-ec-all="1">Select all</button><button type="button" class="link-button" data-ec-all="0">None</button></span>' : '') + '</div>';
    if (!list.length) {
      html += '<p class="sh-muted">Pick a group above, or add people by name.</p>';
    } else {
      html += '<div class="ec-recipient-list">' + list.map(function (p) {
        var on = !state.excluded[p.key];
        return '<label class="ec-recipient' + (on ? '' : ' is-off') + '"><input type="checkbox" data-ec-tick="' + esc(p.key) + '"' + (on ? ' checked' : '') + '>' +
          '<span class="ec-recipient-main"><strong>' + esc(p.name || p.email) + '</strong><small>' + esc(p.email) + (kindLabel(p) ? ' · ' + esc(kindLabel(p)) : '') + '</small>' +
          (p.lastEmail ? '<small class="ec-last">Last emailed ' + esc(timeAgo(p.lastEmail.created_at)) + ': ' + esc(p.lastEmail.subject) + '</small>' : '') + '</span>' +
          (state.manual[p.key] ? '<button type="button" class="ec-x" data-ec-unadd="' + esc(p.key) + '" aria-label="Remove ' + esc(p.name || p.email) + '">&times;</button>' : '') + '</label>';
      }).join('') + '</div>';
    }
    html += '</div></div>';
    return html;
  }

  function messageHtml() {
    var tpl = '<option value="">Start from scratch</option><optgroup label="Built in">' + TEMPLATES.map(function (t) { return '<option value="b:' + t.id + '"' + (state.template === 'b:' + t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</optgroup>';
    if (state.saved && state.saved.length) tpl += '<optgroup label="Your saved templates">' + state.saved.map(function (t) { return '<option value="s:' + esc(t.id) + '"' + (state.template === 's:' + t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</optgroup>';
    var first = recipients()[0];
    var html = '<div class="ec-card"><h3><span class="ec-step">2</span> What do you want to say?</h3>' +
      '<label class="ec-field"><span>Start from</span><select id="ec-template">' + tpl + '</select></label>' +
      '<label class="ec-field"><span>Subject</span><input type="text" id="ec-subject" maxlength="150" value="' + esc(state.subject) + '" autocomplete="off"></label>' +
      '<label class="ec-field"><span>Message</span><textarea id="ec-message" rows="10" maxlength="5000">' + esc(state.message) + '</textarea></label>' +
      '<div class="ec-tools"><span class="ec-insert">Insert: <button type="button" data-ec-insert="{first_name}">first name</button><button type="button" data-ec-insert="{name}">full name</button><button type="button" data-ec-insert="{phase}">phase</button><button type="button" data-ec-insert="{circle}">their Circle</button></span><span class="ec-counter">' + state.message.length + ' / 5000</span></div>' +
      '<details class="ec-preview" open><summary>Preview' + (first ? ' for ' + esc(greetName(first.name)) : '') + '</summary><div class="ec-preview-box">' +
      (first ? '<strong>' + esc(merge(state.subject, first) || '(no subject yet)') + '</strong>' + (state.message.trim() ? previewHtml(merge(state.message, first)) : '<p class="ce-empty">Your message appears here.</p>') : '<p class="sh-muted">Choose who it is for to see a preview.</p>') +
      '</div></details>' +
      '<div class="ec-actions"><button type="button" class="btn btn-outline" data-ec-save-template>Save as template…</button>' +
      '<button type="button" class="btn btn-outline" data-ec-test' + (state.myEmail && first ? '' : ' disabled') + '>Send me a test</button></div>' +
      '<div class="ec-save" id="ec-save-row" hidden><input type="text" id="ec-save-name" maxlength="80" placeholder="Template name" aria-label="Template name"><button type="button" class="btn btn-primary btn-sm" data-ec-save-confirm>Save</button></div></div>';
    return html;
  }

  function sendHtml() {
    var n = recipients().length;
    if (state.sending) {
      var s = state.sending;
      var pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
      return '<div class="ec-card"><h3><span class="ec-step">3</span> Sending…</h3><div class="ec-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><span style="width:' + pct + '%"></span></div>' +
        '<p>' + s.done + ' of ' + s.total + ' done · ' + s.sent + ' sent' + (s.failed ? ' · <span class="ec-bad">' + s.failed + ' failed</span>' : '') + '</p>' +
        '<button type="button" class="btn btn-outline" data-ec-cancel>' + (s.cancelled ? 'Stopping…' : 'Stop after this one') + '</button></div>';
    }
    var res = state.result;
    var html = '';
    if (res) {
      html += '<div class="ec-card ec-result' + (res.failed ? ' has-failed' : '') + '"><h3>' + (res.cancelled ? 'Stopped' : 'Done') + '</h3><p><strong>' + res.sent + '</strong> sent' + (res.failed ? ', <strong class="ec-bad">' + res.failed + ' failed</strong>' : '') + (res.cancelled ? ', ' + res.skipped + ' not sent' : '') + '. It is saved under <button type="button" class="link-button" data-ec-tab="sent">Sent</button>.</p>' +
        (res.failed ? '<ul class="ec-failures">' + res.failures.slice(0, 8).map(function (f) { return '<li><strong>' + esc(f.name) + '</strong> (' + esc(f.email) + '): ' + esc(f.error) + '</li>'; }).join('') + '</ul>' : '') +
        '<button type="button" class="btn btn-outline btn-sm" data-ec-dismiss-result>Dismiss</button></div>';
    }
    var a = audienceById(state.audience);
    html += '<div class="ec-card ec-send"><h3><span class="ec-step">3</span> Send</h3>' +
      '<p class="sh-muted">Each person gets their own email, from the LACMS address, with their name filled in. Nobody sees anyone else. The email tells them to write to acms@lincolnsu.com, not to reply.</p>' +
      '<button type="button" class="btn btn-primary ec-send-btn" data-ec-send' + (n ? '' : ' disabled') + '>' + (n ? 'Send to ' + plural(n, 'person', 'people') : 'Choose who to send to') + '</button>' +
      (n > MAX_PER_BATCH ? '<p class="ec-bad">That is more than ' + MAX_PER_BATCH + ' people - untick some, or send in more than one go.</p>' : '') +
      (a && a.big ? '<p class="ec-warn">This group is everyone with a member account.</p>' : '') + '</div>';
    return html;
  }

  function writeHtml() {
    var html = '';
    if (state.loadErrors.length) html += '<p class="ec-warn">Some lists couldn\'t be loaded, so they may be missing: ' + esc(state.loadErrors.join(' · ')) + '</p>';
    if (state.logError) html += '<p class="ec-warn">' + esc(state.logError) + ' Emails will still send, but won\'t be recorded.</p>';
    return html + audienceHtml() + messageHtml() + sendHtml();
  }

  // ---- Sent ----
  function batches() {
    var map = {}, order = [];
    state.log.forEach(function (row) {
      var b = map[row.batch_id];
      if (!b) { b = map[row.batch_id] = { id: row.batch_id, subject: row.subject, message: row.message, audience: row.audience, at: row.created_at, rows: [], sent: 0, failed: 0 }; order.push(b); }
      b.rows.push(row);
      if (row.status === 'sent') b.sent++; else b.failed++;
      if (row.created_at < b.at) b.at = row.created_at;
    });
    return order;
  }
  function sentHtml() {
    if (state.logError) return '<p class="ec-warn">' + esc(state.logError) + '</p>';
    var list = batches();
    if (!list.length) return '<p class="sh-muted">Nothing sent from here yet. Emails you send from the Write tab are recorded here.</p>';
    return '<div class="ec-batches">' + list.map(function (b) {
      var open = state.openBatch === b.id;
      var html = '<article class="ec-batch' + (open ? ' is-open' : '') + '"><button type="button" class="ec-batch-head" data-ec-batch="' + esc(b.id) + '" aria-expanded="' + open + '">' +
        '<span class="ec-batch-main"><strong>' + esc(b.subject) + '</strong><small>' + esc(when(b.at)) + (b.audience ? ' · ' + esc(b.audience) : '') + '</small></span>' +
        '<span class="ec-batch-count"><b>' + b.sent + '</b> sent' + (b.failed ? ' · <b class="ec-bad">' + b.failed + '</b> failed' : '') + '</span></button>';
      if (open) {
        html += '<div class="ec-batch-body"><div class="ec-batch-msg">' + previewHtml(b.message) + '</div><ul class="ec-batch-rows">' + b.rows.slice().sort(function (x, y) { return (x.recipient_name || x.recipient_email).localeCompare(y.recipient_name || y.recipient_email); }).map(function (r) {
          return '<li class="' + (r.status === 'failed' ? 'is-failed' : '') + '"><span>' + esc(r.recipient_name || r.recipient_email) + ' <small>' + esc(r.recipient_email) + '</small></span><span>' + (r.status === 'sent' ? 'Sent' : 'Failed' + (r.error ? ': ' + esc(r.error) : '')) + '</span></li>';
        }).join('') + '</ul><div class="ec-actions"><button type="button" class="btn btn-outline btn-sm" data-ec-reuse="' + esc(b.id) + '">Use this message again</button>' +
          (b.failed ? '<button type="button" class="btn btn-primary btn-sm" data-ec-retry="' + esc(b.id) + '">Retry the ' + b.failed + ' that failed</button>' : '') + '</div></div>';
      }
      return html + '</article>';
    }).join('') + '</div>';
  }

  // ---------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------
  function sendOne(p, subject, message) {
    var body = { type: 'custom', email: p.email, full_name: p.name || p.email, subject: merge(subject, p), message: merge(message, p) };
    return supabaseClient.functions.invoke('send-account-email', { body: body }).then(function (r) {
      return r.error ? describeError(r.error) : null;
    }, function (e) { return (e && e.message) || 'Failed to send the email'; }).then(function (err) {
      return { error: err, subject: body.subject, message: body.message };
    });
  }
  function logRows(rows) {
    if (!rows.length) return Promise.resolve();
    return supabaseClient.from('email_log').insert(rows).select().then(function (r) {
      if (r.error) { console.error('Recording the emails failed (has migration 097 been run?):', r.error.message); return; }
      state.log = (r.data || []).concat(state.log);
    }, function () { /* the emails already went */ });
  }

  function startSend(list, opts) {
    opts = opts || {};
    var subject = state.subject.trim(), message = state.message.trim();
    var batch = uuid();
    var audience = opts.audienceLabel || audienceLabel();
    state.result = null;
    state.sending = { done: 0, total: list.length, sent: 0, failed: 0, cancelled: false, batch: batch };
    var failures = [];
    var pendingLog = [];
    render();
    var i = 0;
    function next() {
      var s = state.sending;
      if (!s || s.cancelled || i >= list.length) return finish();
      var p = list[i++];
      return sendOne(p, subject, message).then(function (res) {
        s.done++;
        if (res.error) { s.failed++; failures.push({ name: p.name || p.email, email: p.email, error: res.error }); } else s.sent++;
        pendingLog.push({
          batch_id: batch, recipient_email: p.email, recipient_name: p.name || null, recipient_kind: p.kinds && p.kinds.professional ? 'professional' : (p.kinds && p.kinds.member ? 'member' : (p.menteeApp || p.mentorApp ? 'applicant' : 'other')),
          audience: audience || null, subject: res.subject, message: res.message, status: res.error ? 'failed' : 'sent', error: res.error ? String(res.error).slice(0, 1000) : null
        });
        if (pendingLog.length >= 5) { var chunk = pendingLog.splice(0, pendingLog.length); logRows(chunk); }
        render();
        return sleep(SEND_GAP_MS).then(next);
      });
    }
    function finish() {
      var s = state.sending;
      var chunk = pendingLog.splice(0, pendingLog.length);
      return logRows(chunk).then(function () {
        state.result = { sent: s.sent, failed: s.failed, cancelled: s.cancelled, skipped: list.length - s.done, failures: failures };
        state.sending = null;
        if (!s.failed) { state.subject = ''; state.message = ''; state.template = ''; lsDel(DRAFT_KEY); }
        return loadLog();
      }).then(render);
    }
    return next();
  }

  function confirmAndSend() {
    var list = recipients();
    if (!list.length) return;
    var subject = state.subject.trim(), message = state.message.trim();
    if (!subject || !message) { window.alert('Add a subject and a message first.'); return; }
    if (list.length > MAX_PER_BATCH) { window.alert('That is more than ' + MAX_PER_BATCH + ' people. Untick some, or send in more than one go.'); return; }
    var leftover = (subject + ' ' + message).match(/\[[^\]\n]{2,60}\]/g);
    if (leftover && !window.confirm('Your email still has text in [square brackets] that looks like something to fill in:\n\n' + leftover.slice(0, 4).join('\n') + '\n\nSend it anyway?')) return;
    var a = audienceById(state.audience);
    var first = list[0];
    var msg = 'Send "' + subject + '" to ' + plural(list.length, 'person', 'people') + '?\n\n' +
      (list.length <= 6 ? list.map(function (p) { return '• ' + (p.name || p.email); }).join('\n') + '\n\n' : 'Starting with ' + (first.name || first.email) + '.\n\n') +
      'It goes out straight away and cannot be unsent.';
    if (a && a.big && !window.confirm('This is going to every member (' + list.length + ' people). Are you sure?')) return;
    if (!window.confirm(msg)) return;
    startSend(list);
  }

  function sendTest() {
    var first = recipients()[0];
    if (!first || !state.myEmail) return;
    var subject = state.subject.trim(), message = state.message.trim();
    if (!subject || !message) { window.alert('Add a subject and a message first.'); return; }
    var me = { email: state.myEmail, name: first.name, phase: first.phase, circle: first.circle, kinds: {} };
    var btn = root.querySelector('[data-ec-test]');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    sendOne(me, '[Test] ' + subject, message).then(function (res) {
      if (btn) { btn.disabled = false; btn.textContent = 'Send me a test'; }
      window.alert(res.error ? 'Couldn\'t send the test: ' + res.error : 'A test went to ' + state.myEmail + ', filled in as if for ' + (first.name || first.email) + '. It isn\'t recorded in Sent.');
    });
  }

  // ---------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------
  function applyTemplate(v) {
    state.template = v;
    var t = null;
    if (v.indexOf('b:') === 0) t = TEMPLATES.filter(function (x) { return x.id === v.slice(2); })[0];
    else if (v.indexOf('s:') === 0) t = (state.saved || []).filter(function (x) { return x.id === v.slice(2); })[0];
    if (t) { state.subject = t.subject; state.message = t.message; saveDraft(); }
  }

  root.addEventListener('click', function (e) {
    var el;
    if ((el = e.target.closest('[data-ec-tab]'))) { state.tab = el.getAttribute('data-ec-tab'); render(); return; }
    if ((el = e.target.closest('[data-ec-aud]'))) {
      var id = el.getAttribute('data-ec-aud');
      state.audience = state.audience === id ? '' : id;
      state.refine = { phase: 'all', status: 'all', course: 'all', placed: 'all', circle: 'all' };
      state.excluded = {};
      render(); return;
    }
    if ((el = e.target.closest('[data-ec-add]'))) { state.manual[el.getAttribute('data-ec-add')] = true; state.search = ''; render(); return; }
    if ((el = e.target.closest('[data-ec-unadd]'))) { e.preventDefault(); delete state.manual[el.getAttribute('data-ec-unadd')]; render(); return; }
    if ((el = e.target.closest('[data-ec-all]'))) {
      var on = el.getAttribute('data-ec-all') === '1';
      candidates().forEach(function (p) { if (on) delete state.excluded[p.key]; else state.excluded[p.key] = true; });
      render(); return;
    }
    if ((el = e.target.closest('[data-ec-insert]'))) {
      var ta = document.getElementById('ec-message'); if (!ta) return;
      var tok = el.getAttribute('data-ec-insert'), s = ta.selectionStart, en = ta.selectionEnd;
      state.message = ta.value.slice(0, s) + tok + ta.value.slice(en);
      saveDraft(); render();
      var nt = document.getElementById('ec-message'); if (nt) { nt.focus(); nt.setSelectionRange(s + tok.length, s + tok.length); }
      return;
    }
    if (e.target.closest('[data-ec-send]')) { confirmAndSend(); return; }
    if (e.target.closest('[data-ec-test]')) { sendTest(); return; }
    if (e.target.closest('[data-ec-cancel]')) { if (state.sending) { state.sending.cancelled = true; render(); } return; }
    if (e.target.closest('[data-ec-dismiss-result]')) { state.result = null; render(); return; }
    if (e.target.closest('[data-ec-save-template]')) {
      var row = document.getElementById('ec-save-row'); if (row) { row.hidden = false; var inp = document.getElementById('ec-save-name'); if (inp) inp.focus(); }
      return;
    }
    if (e.target.closest('[data-ec-save-confirm]')) {
      var nameEl = document.getElementById('ec-save-name'); var nm = nameEl ? nameEl.value.trim() : '';
      if (!nm || !state.subject.trim() || !state.message.trim()) { window.alert('Give the template a name, and write a subject and message first.'); return; }
      supabaseClient.from('account_email_templates').insert({ name: nm, subject: state.subject.trim(), message: state.message.trim() }).select().single().then(function (r) {
        if (r.error) { window.alert('Couldn\'t save it: ' + r.error.message); return; }
        state.saved = (state.saved || []).concat([r.data]); state.template = 's:' + r.data.id; render();
      });
      return;
    }
    if ((el = e.target.closest('[data-ec-batch]'))) { var bid = el.getAttribute('data-ec-batch'); state.openBatch = state.openBatch === bid ? '' : bid; render(); return; }
    if ((el = e.target.closest('[data-ec-reuse]'))) {
      var b = batches().filter(function (x) { return x.id === el.getAttribute('data-ec-reuse'); })[0];
      if (b) { state.subject = b.subject; state.message = b.message; state.template = ''; state.tab = 'write'; saveDraft(); render(); }
      return;
    }
    if ((el = e.target.closest('[data-ec-retry]'))) {
      var rb = batches().filter(function (x) { return x.id === el.getAttribute('data-ec-retry'); })[0];
      if (!rb) return;
      var failed = rb.rows.filter(function (r) { return r.status === 'failed'; }).map(function (r) {
        var p = state.people[lc(r.recipient_email)] || { key: lc(r.recipient_email), email: r.recipient_email, name: r.recipient_name || '', kinds: {} };
        return p;
      });
      if (!failed.length || !window.confirm('Send "' + rb.subject + '" again to the ' + failed.length + ' that failed?')) return;
      state.subject = rb.subject; state.message = rb.message; state.tab = 'write';
      startSend(failed, { audienceLabel: 'Retry' });
      return;
    }
  });

  root.addEventListener('change', function (e) {
    var el;
    if ((el = e.target.closest('[data-ec-refine]'))) { state.refine[el.getAttribute('data-ec-refine')] = el.value; state.excluded = {}; render(); return; }
    if ((el = e.target.closest('[data-ec-tick]'))) {
      var k = el.getAttribute('data-ec-tick');
      if (el.checked) delete state.excluded[k]; else state.excluded[k] = true;
      render(); return;
    }
    if (e.target.id === 'ec-template') { applyTemplate(e.target.value); render(); return; }
  });

  root.addEventListener('input', function (e) {
    if (e.target.id === 'ec-search') { state.search = e.target.value; render(); return; }
    if (e.target.id === 'ec-subject') { state.subject = e.target.value; saveDraft(); updatePreviewOnly(); return; }
    if (e.target.id === 'ec-message') { state.message = e.target.value; saveDraft(); updatePreviewOnly(); return; }
  });

  // Typing shouldn't rebuild the whole page (it would lose the cursor); just refresh the preview and counter.
  function updatePreviewOnly() {
    var first = recipients()[0];
    var box = root.querySelector('.ec-preview-box');
    if (box) {
      box.innerHTML = first
        ? '<strong>' + esc(merge(state.subject, first) || '(no subject yet)') + '</strong>' + (state.message.trim() ? previewHtml(merge(state.message, first)) : '<p class="ce-empty">Your message appears here.</p>')
        : '<p class="sh-muted">Choose who it is for to see a preview.</p>';
    }
    var c = root.querySelector('.ec-counter'); if (c) c.textContent = state.message.length + ' / 5000';
  }

  // ---------------------------------------------------------------------
  // Boot: load when the section is opened
  // ---------------------------------------------------------------------
  function visible() { return panel && panel.style.display !== 'none'; }
  function ensureLoaded() {
    if (state.loaded || state.loading) return;
    render();
    Promise.all([loadAll(), loadTemplates()]).then(render);
  }
  if (panel && window.MutationObserver) {
    new MutationObserver(function () { if (visible()) ensureLoaded(); }).observe(panel, { attributes: true, attributeFilter: ['style'] });
  }
  if (visible()) ensureLoaded();

  // Shortcut on the Sankofa applications page: "Email applicants" opens this section with that group chosen.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-email-sankofa]') : null;
    if (!btn) return;
    window.lacmsEmailCentre.open('sk_mentee_apps');
  });
  var emailCard = document.querySelector('[data-dash-section="email"]');
  if (emailCard && emailCard.style.display === 'none') {
    Array.prototype.forEach.call(document.querySelectorAll('[data-email-sankofa-wrap]'), function (el) { el.parentNode.removeChild(el); });
  }

  window.lacmsEmailCentre = {
    // Opens the Email section with a group already chosen (used by shortcuts elsewhere on the dashboard).
    open: function (audienceId) {
      if (audienceById(audienceId)) { state.audience = audienceId; state.tab = 'write'; state.excluded = {}; state.refine = { phase: 'all', status: 'all', course: 'all', placed: 'all', circle: 'all' }; }
      var card = document.querySelector('[data-dash-section="email"]');
      if (card) card.click();
      if (state.loaded) render();
    }
  };
})();
