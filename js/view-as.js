// "View the website as…" - the president can browse the site as a real person
// (exactly as they see it), or as a generic kind of account (a Pharmacy Year 2
// member, an Executive Committee member, an alumni doctor, an MMG guest, a
// logged-out visitor), without making spare logins.
//
// A REAL PERSON (exact)
//   The "view-as" Edge Function (supabase/functions/view-as) checks the caller
//   is the president and returns a one-hour access token for that person. From
//   then on every request the page makes carries THEIR token, so each list,
//   lock, count and profile is what their own login returns. The president's own
//   session is untouched and is used only to ask for a fresh token before the
//   hour is up. No refresh token is ever handed out.
//   The browser refuses every write, upload and email while a preview is open,
//   never shows private chat (messages, conversations, live channels) and
//   skips the quiet background writes (presence, analytics, "seen" markers), so
//   looking at someone's view changes nothing about them.
//
// A GENERIC ACCOUNT TYPE (approximate)
//   There is no real login to borrow, so the president stays signed in as
//   themselves and, in the browser:
//     1. WHO THE PAGE THINKS YOU ARE. auth.getSession() reports a stand-in user
//        id, and requests asking for "my" profile (members / network_professionals
//        / mmg_guests where the id is the stand-in) are answered here with a
//        profile built from the chosen account type. Tables that hold only
//        personal state (tours seen, discounts used...) come back empty, so the
//        account looks brand new, as a new member's would.
//     2. WHAT THEY CAN USE. get_my_hub_access is answered by
//        president_preview_hub_access() (migration 091), which runs the real Hub
//        Access rules for that kind of account, so menus, locks and hidden
//        sections match what that account gets.
//     3. NOTHING IS CHANGED. Every write (database, storage, emails) is refused
//        and is never sent; a few quiet background writes (presence, analytics)
//        are swallowed silently. Reads that aren't personal pass straight through.
//   Content comes from the live site as the president sees it, so lists the real
//   account might not be allowed to read can show more. The bar says so.
//
// All real security stays in the database. This only switches on for the
// president's own session, and a forged stored value gives a non-president no
// extra access: the Edge Function and every privileged call check the caller's
// real token again.
(function () {
  'use strict';
  if (window.lacmsViewAs) return;

  var PRESIDENT_UID = '22044cd2-6804-4142-96c4-5c475ce9347a';
  var FAKE_ID = '00000000-0000-4000-a000-0000000000a1';   // the stand-in user id pages see
  var FAKE_EMAIL = 'preview@lacms.invalid';
  var KEY = 'lacms-view-as';
  var NOTICE_KEY = 'lacms-view-as-notice';   // a one-line message to show after a preview ends by itself
  var MAX_AGE_MS = 6 * 60 * 60 * 1000;
  var REFRESH_MARGIN_MS = 3 * 60 * 1000;     // ask for a new token this long before the old one runs out

  var COURSES = ['Medicine', 'Pharmacy', 'Dental Hygiene and Therapy', 'Diagnostic Radiography', 'Nursing', 'Midwifery', 'Biomedical Science', 'Occupational Therapy'];
  var SIXTH = 'Sixth form / aspiring medic';
  var YEARS = ['Foundation Year', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Masters'];
  var MEMBER_TYPES = {
    member: 'Member',
    supporting_committee: 'Supporting Committee',
    executive_committee: 'Executive Committee',
    senior_sankofa_mentor: 'Senior Sankofa Mentor',
    junior_sankofa_mentor: 'Junior Sankofa Mentor'
  };
  var PRO_CATEGORIES = { alumni_doctor: 'Alumni doctor', senior_doctor: 'Senior doctor', pharmacist: 'Pharmacist', other: 'Other professional' };
  var FEATURE_LABEL = {
    perks: 'Perks', sankofa: 'Sankofa applications', network: 'Network', motm_nominate: 'Member of the Month', news_feed: 'News feed',
    resources: 'Resources', sankofa_hub: 'Sankofa Hub', journey: 'Journey',
    dash_mmg: 'Dashboard: MMG', dash_sankofa: 'Dashboard: Sankofa', dash_motm: 'Dashboard: MoTM', dash_events: 'Dashboard: Events', dash_gallery: 'Dashboard: Gallery'
  };

  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  var persona = null;
  var realGetSession = null;      // the untouched auth.getSession()
  var client = null;
  var lastToast = 0;

  // ---------------------------------------------------------------------
  // The chosen account type, kept for this browser tab only.
  // ---------------------------------------------------------------------
  function readStored() {
    try {
      var p = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (!p || p.v !== 1 || !p.kind || !p.label) return null;
      if (!p.at || Date.now() - p.at > MAX_AGE_MS) { sessionStorage.removeItem(KEY); return null; }
      if (p.exact && !(p.session && p.session.access_token && p.session.user && p.session.user.id)) { sessionStorage.removeItem(KEY); return null; }
      return p;
    } catch (e) { return null; }
  }
  function store(p) { try { sessionStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* private mode: preview just won't survive a reload */ } }
  function clearStored() { try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

  persona = readStored();
  if (persona) document.documentElement.classList.add('va-on');

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function isStudentKind(p) { return p && (p.kind === 'member' || (p.kind === 'person' && p.personKind === 'member')); }
  function isProfessionalKind(p) { return p && (p.kind === 'professional' || (p.kind === 'person' && p.personKind === 'professional')); }

  // ---------------------------------------------------------------------
  // Building a persona from the picker's choices
  // ---------------------------------------------------------------------
  function describeMember(m) {
    var bits = [];
    var type = MEMBER_TYPES[m.member_type] || 'Member';
    if (m.member_type === 'executive_committee' || m.member_type === 'supporting_committee') bits.push(type);
    else if (m.member_type !== 'member') bits.push(type);
    var cy = [m.course, m.year_of_study].filter(Boolean).join(' · ');
    if (cy) bits.push(cy); else if (m.member_type === 'member') bits.push('Member');
    return bits.join(' · ');
  }
  function eligibleFor(course) { return /medicine|sixth/i.test(course || ''); }

  function memberPersona(opts) {
    var m = {
      member_type: opts.member_type || 'member',
      course: opts.course || null,
      year_of_study: opts.year_of_study || null,
      committee_role: opts.committee_role || null,
      sankofa_eligible: opts.sankofa_eligible != null ? !!opts.sankofa_eligible : eligibleFor(opts.course)
    };
    return { v: 1, kind: 'member', label: describeMember(m), member: m };
  }
  function professionalPersona(opts) {
    var cat = opts.category || 'alumni_doctor';
    return { v: 1, kind: 'professional', label: (PRO_CATEGORIES[cat] || 'Professional') + (opts.title ? ' · ' + opts.title : ''),
      professional: { category: cat, title: opts.title || null, organisation: opts.organisation || null } };
  }
  function simplePersona(kind) {
    return { v: 1, kind: kind, label: kind === 'mmg' ? 'MMG guest' : 'Logged-out visitor' };
  }
  // A real person. With `minted` (the session from the Edge Function) this is the exact view;
  // without it, the approximate fallback built from their profile and access rules.
  function personPersona(row, personKind, minted) {
    var name = row.full_name || 'Someone';
    var p = { v: 1, kind: 'person', personKind: personKind, userId: row.id || row.user_id,
      label: minted ? name : name + ' (approximate)',
      member: personKind === 'member' ? { member_type: row.member_type || 'member', course: row.course || null, year_of_study: row.year_of_study || null, committee_role: row.committee_role || null } : null };
    if (minted) {
      p.exact = true;
      p.session = { access_token: minted.access_token, expires_at: minted.expires_at, expires_in: minted.expires_in, user: minted.user };
    }
    return p;
  }

  var PRESETS = [
    { id: 'med1', label: 'Medicine · Year 1', make: function () { return memberPersona({ course: 'Medicine', year_of_study: 'Year 1' }); } },
    { id: 'pharm2', label: 'Pharmacy · Year 2', make: function () { return memberPersona({ course: 'Pharmacy', year_of_study: 'Year 2' }); } },
    { id: 'mid1', label: 'Midwifery · Year 1', make: function () { return memberPersona({ course: 'Midwifery', year_of_study: 'Year 1' }); } },
    { id: 'nurse2', label: 'Nursing · Year 2', make: function () { return memberPersona({ course: 'Nursing', year_of_study: 'Year 2' }); } },
    { id: 'sixth', label: 'Sixth former', make: function () { return memberPersona({ course: SIXTH, year_of_study: null }); } },
    { id: 'exec', label: 'Executive Committee', make: function () { return memberPersona({ member_type: 'executive_committee', course: 'Medicine', year_of_study: 'Year 5', committee_role: 'Treasurer' }); } },
    { id: 'supp', label: 'Supporting Committee', make: function () { return memberPersona({ member_type: 'supporting_committee', course: 'Pharmacy', year_of_study: 'Year 3' }); } },
    { id: 'mentor', label: 'Senior Sankofa mentor', make: function () { return memberPersona({ member_type: 'senior_sankofa_mentor', course: 'Medicine', year_of_study: 'Year 5' }); } },
    { id: 'doc', label: 'Alumni doctor', make: function () { return professionalPersona({ category: 'alumni_doctor', title: 'Foundation doctor' }); } },
    { id: 'pharmacist', label: 'Pharmacist', make: function () { return professionalPersona({ category: 'pharmacist', title: 'Pharmacist' }); } },
    { id: 'mmg', label: 'MMG guest', make: function () { return simplePersona('mmg'); } },
    { id: 'visitor', label: 'Logged out', make: function () { return simplePersona('visitor'); } }
  ];

  // The arguments president_preview_hub_access() needs for a persona.
  function previewArgs(p) {
    if (p.kind === 'person') return { p_kind: p.personKind, p_member_type: null, p_course: null, p_committee_role: null, p_user: p.userId };
    if (p.kind === 'member') return { p_kind: 'member', p_member_type: p.member.member_type, p_course: p.member.course, p_committee_role: p.member.committee_role, p_user: null };
    if (p.kind === 'professional') return { p_kind: 'professional', p_member_type: null, p_course: null, p_committee_role: null, p_user: null };
    return { p_kind: p.kind, p_member_type: null, p_course: null, p_committee_role: null, p_user: null };
  }

  // ---------------------------------------------------------------------
  // Synthetic responses
  // ---------------------------------------------------------------------
  function jsonResponse(status, body, extra) {
    var headers = { 'Content-Type': 'application/json' };
    if (extra) Object.keys(extra).forEach(function (k) { headers[k] = extra[k]; });
    return new Response(status === 204 ? null : JSON.stringify(body), { status: status, headers: headers });
  }
  function rowsResponse(rows, accept, method) {
    var single = /vnd\.pgrst\.object/.test(accept || '');
    if (single) {
      if (rows.length === 1) return jsonResponse(200, rows[0]);
      return jsonResponse(406, { code: 'PGRST116', details: 'The result contains ' + rows.length + ' rows', hint: null, message: 'JSON object requested, multiple (or no) rows returned' });
    }
    var range = rows.length ? '0-' + (rows.length - 1) + '/' + rows.length : '*/0';
    if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Range': range } });
    return jsonResponse(200, rows, { 'Content-Range': range });
  }
  function blocked() {
    toast('Preview only: that action is switched off, so nothing was saved or sent.');
    return jsonResponse(403, { code: '42501', message: 'Preview only: nothing you do while viewing as someone else is saved or sent.', details: null, hint: null });
  }
  function refusedQuietly() { return jsonResponse(403, { code: '42501', message: 'Preview only.', details: null, hint: null }); }
  function swallowed() { return new Response(null, { status: 204 }); }

  // ---------------------------------------------------------------------
  // Which requests are allowed through while previewing
  // ---------------------------------------------------------------------
  // Tables that only hold one person's own state. As the president's rows would
  // otherwise leak in (RLS scopes them to the real token), they come back empty.
  var EMPTY_TABLES = { user_ui_state: 1, notification_seen: 1, discount_usage: 1 };
  // Background writes the site makes by itself - swallowed without a warning.
  var QUIET_WRITE_TABLES = { member_presence: 1, page_views: 1, user_ui_state: 1, notification_seen: 1, site_visits: 1, site_events_views: 1 };
  // RPCs that only read. Everything else (every RPC that writes) is refused.
  var READ_RPC_EXACT = {
    journey_sync: 1, journey_community: 1, resource_unlock: 1, has_any_dashboard_access: 1, is_president: 1, is_dashboard_admin: 1, sankofa_can_manage: 1,
    sankofa_hub_status: 1, sankofa_hub_overview: 1, sankofa_people: 1, sankofa_meetings: 1, sankofa_feed: 1, sankofa_goals_list: 1,
    sankofa_leaderboard: 1, sankofa_checkin_history: 1, sankofa_member_snapshot: 1, sankofa_meeting_attendees: 1,
    sankofa_admin_overview: 1, sankofa_admin_candidates: 1, sankofa_admin_history: 1, sankofa_admin_search_people: 1
  };
  // Background calls the site makes by itself (chat polling, analytics): refused without a warning.
  // journey_sync is allowed for a generic account (it only works out the president's own
  // progress) but never as a real person: it would record visits and badges for them.
  var QUIET_RPC = /^(chat_|record_|mark_notifications_seen$|sankofa_mark_welcomed$|sankofa_sync$|journey_)/;
  // Private messages are never shown in a preview (as a real person or otherwise).
  var CHAT_TABLE = /^chat_/;
  function isReadRpc(name) {
    return READ_RPC_EXACT[name] === 1 || /^(get_|president_get_)/.test(name);
  }

  function supabaseOrigin() {
    try { return typeof SUPABASE_URL !== 'undefined' ? new URL(SUPABASE_URL).origin : null; } catch (e) { return null; }
  }

  // ---------------------------------------------------------------------
  // The stand-in profile
  // ---------------------------------------------------------------------
  var baseMemberPromise = null;
  function authHeaders(headers) {
    var h = {};
    ['apikey', 'authorization'].forEach(function (k) { var v = headers.get(k); if (v) h[k] = v; });
    h.accept = 'application/json';
    return h;
  }
  function fetchOne(origin, path, headers) {
    return nativeFetch(origin + path, { headers: authHeaders(headers) }).then(function (r) { return r.ok ? r.json() : []; }, function () { return []; })
      .then(function (rows) { return Array.isArray(rows) && rows.length ? rows[0] : null; });
  }
  // The president's own members row, if there is one: used only for the name.
  function baseMember(origin, headers) {
    if (!baseMemberPromise) baseMemberPromise = fetchOne(origin, '/rest/v1/members?select=*&id=eq.' + PRESIDENT_UID, headers);
    return baseMemberPromise;
  }

  function memberRow(origin, headers) {
    var now = new Date().toISOString();
    if (persona.kind === 'person') {
      return fetchOne(origin, '/rest/v1/members?select=*&id=eq.' + persona.userId, headers).then(function (real) {
        if (!real) return null;
        var row = Object.assign({}, real, { id: FAKE_ID });
        if (!row.terms_accepted_at) row.terms_accepted_at = now;
        return row;
      });
    }
    return baseMember(origin, headers).then(function (base) {
      var m = persona.member;
      var row = {};
      if (base) Object.keys(base).forEach(function (k) { row[k] = null; });
      row.id = FAKE_ID;
      row.full_name = (base && base.full_name) || 'Preview account';
      row.course = m.course;
      row.year_of_study = m.year_of_study;
      row.member_type = m.member_type;
      row.committee_role = m.committee_role;
      row.sankofa_eligible = m.sankofa_eligible;
      row.membership_status = 'active';
      row.created_at = now;
      row.activated_at = now;
      row.terms_accepted_at = now;     // accepting is a write, which preview refuses - don't dead-end on the prompt
      return row;
    });
  }
  function professionalRow(origin, headers) {
    var now = new Date().toISOString();
    if (persona.kind === 'person') {
      return fetchOne(origin, '/rest/v1/network_professionals?select=*&user_id=eq.' + persona.userId, headers).then(function (real) {
        return real ? Object.assign({}, real, { id: FAKE_ID, user_id: FAKE_ID }) : null;
      });
    }
    return baseMember(origin, headers).then(function (base) {
      var p = persona.professional;
      return {
        id: FAKE_ID, user_id: FAKE_ID, full_name: (base && base.full_name) || 'Preview account', title: p.title, organisation: p.organisation || 'Preview organisation',
        category: p.category, is_active: true, email: FAKE_EMAIL, linkedin_url: null, bio: null, photo_url: null, created_at: now, terms_accepted_at: now, activated_at: now
      };
    });
  }
  function guestRow(origin, headers) {
    var now = new Date().toISOString();
    return baseMember(origin, headers).then(function (base) {
      return { id: FAKE_ID, full_name: (base && base.full_name) || 'Preview guest', university: 'Preview university', email: FAKE_EMAIL, is_active: true, created_at: now, terms_accepted_at: now, activated_at: now };
    });
  }

  function ownRows(table, origin, headers) {
    if (table === 'members' && isStudentKind(persona)) return memberRow(origin, headers).then(function (r) { return r ? [r] : []; });
    if (table === 'network_professionals' && isProfessionalKind(persona)) return professionalRow(origin, headers).then(function (r) { return r ? [r] : []; });
    if (table === 'mmg_guests' && (persona.kind === 'mmg' || (persona.kind === 'person' && persona.personKind === 'mmg'))) return guestRow(origin, headers).then(function (r) { return r ? [r] : []; });
    return Promise.resolve([]);
  }

  // ---------------------------------------------------------------------
  // The fetch wrapper (installed as the Supabase client's fetch)
  // ---------------------------------------------------------------------
  function mentionsStandIn(url) {
    var found = false;
    url.searchParams.forEach(function (v) { if (v.indexOf(FAKE_ID) !== -1) found = true; });
    return found;
  }

  function route(url, method, headers, body, input, init) {
    var origin = supabaseOrigin();
    var path = url.pathname;
    var passthrough = function () { return nativeFetch(input, init); };
    if (!origin || url.origin !== origin) return passthrough();

    if (path.indexOf('/auth/v1/') === 0) {
      // Only what keeps the president's own session alive (refreshing its token) and harmless reads.
      // Anything else - changing a password, sending a reset or sign-in email, signing in as someone
      // else, signing out - could affect a real account, so it is refused while previewing.
      var authOk = (method === 'POST' && path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') ||
        (method === 'GET' && (path === '/auth/v1/user' || path === '/auth/v1/settings'));
      return authOk ? passthrough() : Promise.resolve(blocked());
    }

    if (path.indexOf('/functions/v1/') === 0) return Promise.resolve(blocked());   // emails etc.

    if (path.indexOf('/storage/v1/') === 0) {
      var readOnly = method === 'GET' || method === 'HEAD' || /^\/storage\/v1\/object\/(sign|list|info)\//.test(path);
      return readOnly ? passthrough() : Promise.resolve(blocked());
    }

    var exact = !!persona.exact;

    if (path.indexOf('/rest/v1/rpc/') === 0) {
      var name = decodeURIComponent(path.slice('/rest/v1/rpc/'.length));
      if (/^chat_/.test(name)) return Promise.resolve(refusedQuietly());
      if (exact) {
        // Their own login answers everything (hub access, notifications, who they are...).
        if (name === 'journey_sync' || name === 'journey_set_hidden') return Promise.resolve(refusedQuietly());
        if (isReadRpc(name)) return passthrough();
        return Promise.resolve(QUIET_RPC.test(name) ? refusedQuietly() : blocked());
      }
      if (name === 'get_my_hub_access') {
        var args = previewArgs(persona);
        var h = new Headers(headers);
        h.set('Content-Type', 'application/json');
        return nativeFetch(origin + '/rest/v1/rpc/president_preview_hub_access', { method: 'POST', headers: h, body: JSON.stringify(args) });
      }
      if (name === 'is_president') return Promise.resolve(jsonResponse(200, false));
      if (name === 'is_dashboard_admin') return Promise.resolve(jsonResponse(200, !!(persona.member && persona.member.member_type === 'executive_committee' && persona.kind === 'member')));
      if (name === 'get_my_notifications') return Promise.resolve(jsonResponse(200, []));
      if (isReadRpc(name)) return passthrough();
      return Promise.resolve(QUIET_RPC.test(name) ? refusedQuietly() : blocked());
    }

    if (path.indexOf('/rest/v1/') === 0) {
      var table = decodeURIComponent(path.slice('/rest/v1/'.length));
      if (method === 'GET' || method === 'HEAD') {
        var accept = headers.get('accept') || '';
        if (CHAT_TABLE.test(table)) return Promise.resolve(rowsResponse([], accept, method));
        if (exact) return passthrough();
        if (EMPTY_TABLES[table]) return Promise.resolve(rowsResponse([], accept, method));
        if (mentionsStandIn(url)) {
          return ownRows(table, origin, headers).then(function (rows) { return rowsResponse(rows, accept, method); });
        }
        return passthrough();
      }
      return Promise.resolve(QUIET_WRITE_TABLES[table] ? swallowed() : blocked());
    }

    return passthrough();
  }

  function viewAsFetch(input, init) {
    if (!persona || !nativeFetch) return (nativeFetch || window.fetch)(input, init);
    try {
      var url, method, headers, body = null;
      if (typeof input === 'string' || (typeof URL !== 'undefined' && input instanceof URL)) {
        url = new URL(String(input), window.location.href);
        method = ((init && init.method) || 'GET').toUpperCase();
        headers = new Headers((init && init.headers) || {});
        body = init && init.body;
      } else {   // a Request object
        url = new URL(input.url);
        method = (input.method || 'GET').toUpperCase();
        headers = input.headers;
      }
      return route(url, method, headers, body, input, init);
    } catch (e) {
      // If anything about the preview misbehaves, fail closed: never send a write.
      return Promise.resolve(blocked());
    }
  }

  // ---------------------------------------------------------------------
  // Hooks on the Supabase client (called from js/supabase-client.js)
  // ---------------------------------------------------------------------
  // ---- a real person's token (exact preview) ----
  var minting = null;
  // Asks the Edge Function for a one-hour token for this person, using the president's own session.
  function mint(userId) {
    return realGetSession().then(function (res) {
      var s = res && res.data && res.data.session;
      if (!s || !s.user || s.user.id !== PRESIDENT_UID) throw viewError('You need to be signed in as the president.', 'auth');
      return nativeFetch(SUPABASE_URL + '/functions/v1/view-as', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + s.access_token },
        body: JSON.stringify({ user_id: userId })
      }).catch(function () { throw viewError('Couldn\'t reach the server - check your connection and try again.', 'network'); });
    }).then(function (r) {
      return r.text().then(function (txt) {
        var body = {};
        try { body = JSON.parse(txt); } catch (e) { /* not JSON */ }
        if (r.status === 404 && !body.error) throw viewError('The view-as function isn\'t deployed yet.', 'missing');
        if (!r.ok) throw viewError(body.error || body.message || 'Something went wrong - try again.', r.status === 409 ? 'not-set-up' : 'failed');
        if (!body.access_token || !body.user) throw viewError('Something went wrong - try again.', 'failed');
        return body;
      });
    });
  }
  function viewError(message, code) { var e = new Error(message); e.code = code; return e; }

  function sessionFromStored(s) {
    return { access_token: s.access_token, token_type: 'bearer', expires_in: s.expires_in || 3600, expires_at: s.expires_at, refresh_token: '', user: s.user };
  }
  // The token for the person being viewed, renewed shortly before it runs out.
  function ensureExactSession() {
    var s = persona.session;
    if (s.expires_at * 1000 - Date.now() > REFRESH_MARGIN_MS) return Promise.resolve(sessionFromStored(s));
    if (!minting) {
      minting = mint(persona.userId).then(function (fresh) {
        persona.session = { access_token: fresh.access_token, expires_at: fresh.expires_at, expires_in: fresh.expires_in, user: fresh.user };
        store(persona);
        return sessionFromStored(persona.session);
      }).then(function (x) { minting = null; return x; }, function (e) {
        minting = null;
        // Can't renew: end the preview rather than leave pages talking to a dead token.
        try { sessionStorage.setItem(NOTICE_KEY, 'The preview ended: ' + e.message); } catch (er) { /* ignore */ }
        exit();
        return null;
      });
    }
    return minting;
  }

  // ---- an approximate account's stand-in session ----
  var fakeSessionCache = { token: null, session: null };
  function fakeSession(session) {
    if (fakeSessionCache.token === session.access_token && fakeSessionCache.session) return fakeSessionCache.session;
    var user = Object.assign({}, session.user, { id: FAKE_ID, email: FAKE_EMAIL, phone: '', user_metadata: {}, app_metadata: {}, identities: [] });
    var s = Object.assign({}, session, { user: user });
    fakeSessionCache = { token: session.access_token, session: s };
    return s;
  }

  // What a page should see as "the current session", given the president's real one.
  // Synchronous version (used where we can't wait): an exact preview hands back the token it already holds.
  function viewSession(session) {
    if (!persona || !session) return session;
    if (session.user && session.user.id !== PRESIDENT_UID) { exit(true); return session; }   // only ever for the president
    if (persona.kind === 'visitor') return null;
    if (persona.exact) return sessionFromStored(persona.session);
    return fakeSession(session);
  }

  // Realtime channels would deliver a real person's live messages and notifications; none are opened in a preview.
  function inertChannel() {
    var ch = {
      state: 'closed',
      on: function () { return ch; },
      subscribe: function () { return ch; },
      unsubscribe: function () { return Promise.resolve('ok'); },
      send: function () { return Promise.resolve('ok'); },
      track: function () { return Promise.resolve('ok'); },
      untrack: function () { return Promise.resolve('ok'); },
      presenceState: function () { return {}; }
    };
    return ch;
  }

  function attach(c) {
    client = c;
    var auth = c.auth;
    realGetSession = auth.getSession.bind(auth);
    var realGetUser = auth.getUser ? auth.getUser.bind(auth) : null;
    var realOnChange = auth.onAuthStateChange.bind(auth);

    auth.getSession = function () {
      return realGetSession().then(function (res) {
        if (!persona || !res || !res.data) return res;
        var real = res.data.session;
        if (!real) return res;
        if (real.user && real.user.id !== PRESIDENT_UID) { exit(true); return res; }
        if (persona.exact && persona.kind !== 'visitor') {
          return ensureExactSession().then(function (s) { return { data: { session: s }, error: null }; });
        }
        return { data: { session: viewSession(real) }, error: res.error || null };
      });
    };
    if (realGetUser) {
      auth.getUser = function (jwt) {
        if (!persona || jwt) return realGetUser(jwt);
        return auth.getSession().then(function (res) {
          var s = res && res.data && res.data.session;
          return { data: { user: s ? s.user : null }, error: null };
        });
      };
    }
    auth.onAuthStateChange = function (cb) {
      return realOnChange(function (event, session) { return cb(event, persona ? viewSession(session) : session); });
    };
    var realSignOut = auth.signOut.bind(auth);
    auth.signOut = function (opts) {
      // "Log out" while previewing means "stop previewing"; it must never end the president's real session.
      if (persona) { exit(); return Promise.resolve({ error: null }); }
      return realSignOut(opts);
    };

    if (persona) {
      c.channel = function () { return inertChannel(); };
      c.removeChannel = function () { return Promise.resolve('ok'); };
      c.removeAllChannels = function () { return Promise.resolve([]); };
      if (c.getChannels) c.getChannels = function () { return []; };
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  }

  // ---------------------------------------------------------------------
  // Starting and stopping
  // ---------------------------------------------------------------------
  function homeFor(p) {
    if (p.kind === 'mmg' || (p.kind === 'person' && p.personKind === 'mmg')) return 'mmg-hub.html';
    if (p.kind === 'visitor') return 'index.html';
    return 'member-hub.html';
  }
  function returnPath() {
    var page = (window.location.pathname.split('/').pop() || 'index.html');
    return page + window.location.search + window.location.hash;
  }
  function start(p) {
    p.at = Date.now();
    if (!p.returnTo) p.returnTo = /member-login|mmg-login/.test(returnPath()) ? 'president-dashboard.html' : returnPath();
    store(p);
    window.location.href = homeFor(p);
  }
  function switchTo(p) {
    var keep = persona && persona.returnTo;
    p.at = Date.now();
    p.returnTo = keep || 'president-dashboard.html';
    store(p);
    window.location.href = homeFor(p);
  }
  function exit(stay) {
    var back = persona && persona.returnTo;
    persona = null;
    clearStored();
    document.documentElement.classList.remove('va-on');
    if (stay) return;
    window.location.href = (back && /^[a-z0-9._-]+\.html/i.test(back)) ? back : 'president-dashboard.html';
  }

  // ---------------------------------------------------------------------
  // The interface: a launcher pill, the picker, and the bar shown while previewing
  // ---------------------------------------------------------------------
  var ICON_EYE = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';

  function toast(msg) {
    var now = Date.now();
    if (now - lastToast < 2500) return;
    lastToast = now;
    var t = document.createElement('div');
    t.className = 'va-toast';
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('is-out'); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300); }, 3200);
  }

  function renderBar() {
    if (document.getElementById('va-bar')) return;
    var bar = document.createElement('div');
    bar.id = 'va-bar';
    bar.className = 'va-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Viewing the website as another account');
    bar.innerHTML = '<span class="va-bar-eye">' + ICON_EYE + '</span>' +
      '<span class="va-bar-text"><span class="va-bar-line">Viewing as <strong>' + esc(persona.label) + '</strong></span>' +
      '<span class="va-bar-sub">' + (persona.exact
        ? 'Exactly what they see. Read-only: nothing is saved or sent, and private messages stay hidden.'
        : 'Approximate preview - lists may show more than this account could see. Nothing is saved or sent.') + '</span></span>' +
      '<span class="va-bar-actions"><button type="button" class="va-btn" data-va-switch>Switch</button><button type="button" class="va-btn va-btn--primary" data-va-exit>Exit</button></span>';
    document.body.appendChild(bar);
    bar.querySelector('[data-va-exit]').addEventListener('click', function () { exit(); });
    bar.querySelector('[data-va-switch]').addEventListener('click', function () { openPicker(); });
  }

  function renderPill() {
    if (document.getElementById('va-pill') || /president-dashboard/.test(window.location.pathname)) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.id = 'va-pill';
    b.className = 'va-pill';
    b.setAttribute('aria-label', 'View the website as another account');
    b.innerHTML = ICON_EYE + '<span>View as</span>';
    b.addEventListener('click', openPicker);
    document.body.appendChild(b);
  }

  function init() {
    try {
      var notice = sessionStorage.getItem(NOTICE_KEY);
      if (notice) { sessionStorage.removeItem(NOTICE_KEY); toast(notice); }
    } catch (e) { /* ignore */ }
    if (persona) { renderBar(); return; }
    if (!realGetSession) return;
    realGetSession().then(function (res) {
      var s = res && res.data && res.data.session;
      var isPresident = !!(s && s.user && s.user.id === PRESIDENT_UID);
      // Everything that opens "View as" is hidden by default and only shown to the president's own session.
      Array.prototype.forEach.call(document.querySelectorAll('[data-open-view-as]'), function (el) {
        if (isPresident) { el.style.display = ''; el.addEventListener('click', openPicker); }
        else el.parentNode && el.parentNode.removeChild(el);
      });
      if (isPresident) renderPill();
    }, function () {
      Array.prototype.forEach.call(document.querySelectorAll('[data-open-view-as]'), function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
    });
  }

  // ---- the picker ----
  var pickerEl = null;
  var pickerOpening = false;
  var pickerPrev = null;

  function closePicker() {
    if (!pickerEl) return;
    document.removeEventListener('keydown', onPickerKey, true);
    if (pickerEl.parentNode) pickerEl.parentNode.removeChild(pickerEl);
    pickerEl = null;
    document.documentElement.classList.remove('va-modal');
    if (pickerPrev && pickerPrev.focus) { try { pickerPrev.focus(); } catch (e) { /* ignore */ } }
  }
  function onPickerKey(e) {
    if (!pickerEl) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePicker(); return; }
    if (e.key !== 'Tab') return;
    var f = pickerEl.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function options(list, selected, blank) {
    return (blank ? '<option value="">' + esc(blank) + '</option>' : '') + list.map(function (v) {
      var val = Array.isArray(v) ? v[0] : v, lab = Array.isArray(v) ? v[1] : v;
      return '<option value="' + esc(val) + '"' + (val === selected ? ' selected' : '') + '>' + esc(lab) + '</option>';
    }).join('');
  }

  var GROUPS = [
    ['all', 'Everyone'], ['student', 'Students'], ['committee', 'Committee'], ['mentor', 'Mentors'], ['professional', 'Professionals'], ['mmg', 'MMG guests']
  ];
  function groupOf(row) {
    if (row.personKind === 'professional') return 'professional';
    if (row.personKind === 'mmg') return 'mmg';
    if (row.member_type === 'executive_committee' || row.member_type === 'supporting_committee') return 'committee';
    if (row.member_type === 'senior_sankofa_mentor' || row.member_type === 'junior_sankofa_mentor') return 'mentor';
    return 'student';
  }
  function personSub(p) {
    if (p.personKind === 'member') return [p.member_type !== 'member' ? MEMBER_TYPES[p.member_type] : '', p.course, p.year_of_study].filter(Boolean).join(' · ') || 'Member';
    if (p.personKind === 'professional') return [PRO_CATEGORIES[p.category] || 'Professional', p.title].filter(Boolean).join(' · ');
    return 'Midlands Medics Gala guest';
  }

  // Opens the picker for the president only (the real session is checked again here, whatever called this).
  function openPicker() {
    if (!client || !realGetSession || pickerEl || pickerOpening) return;
    pickerPrev = document.activeElement;
    pickerOpening = true;
    realGetSession().then(function (res) {
      var s = res && res.data && res.data.session;
      if (s && s.user && s.user.id === PRESIDENT_UID) buildPicker();
    }, function () {}).then(function () { pickerOpening = false; });
  }

  function buildPicker() {
    if (pickerEl) return;
    var form = { kind: 'member', course: 'Medicine', year: 'Year 1', member_type: 'member', committee_role: '', category: 'alumni_doctor', title: '' };
    var tab = 'person';
    var people = null;          // everyone with a login, loaded when the dialog opens
    var peopleError = '';
    var q = '';
    var group = 'all';
    var opening = null;         // { name } while a person's view is being prepared
    var failure = null;         // { row, error } if it couldn't be
    var accessTimer = null;
    var accessSeq = 0;

    var back = document.createElement('div');
    back.className = 'va-backdrop';
    var dlg = document.createElement('div');
    dlg.className = 'va-dialog';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', 'va-title');
    back.appendChild(dlg);
    document.body.appendChild(back);
    document.documentElement.classList.add('va-modal');
    pickerEl = back;
    document.addEventListener('keydown', onPickerKey, true);
    back.addEventListener('mousedown', function (e) { if (e.target === back && !opening) closePicker(); });

    function currentPersona() {
      var f = form;
      if (f.kind === 'member') return memberPersona({ course: f.course, year_of_study: f.year || null });
      if (f.kind === 'committee') return memberPersona({ member_type: f.member_type, course: f.course, year_of_study: f.year || null, committee_role: f.committee_role.trim() || null });
      if (f.kind === 'mentor') return memberPersona({ member_type: f.member_type, course: f.course, year_of_study: f.year || null });
      if (f.kind === 'professional') return professionalPersona({ category: f.category, title: f.title.trim() || null });
      return simplePersona(f.kind);
    }
    function go(p) { closePicker(); (persona ? switchTo : start)(p); }

    var KINDS = [
      ['member', 'Student member', 'A course and a year'],
      ['committee', 'Committee member', 'Executive or Supporting'],
      ['mentor', 'Sankofa mentor', 'Senior or junior'],
      ['professional', 'Professional', 'Doctor, pharmacist...'],
      ['mmg', 'MMG guest', 'Midlands Medics Gala'],
      ['visitor', 'Logged out', 'A first-time visitor']
    ];

    function fieldsHtml() {
      var k = form.kind, out = '';
      var courseList = COURSES.concat([SIXTH]);
      if (k === 'member' || k === 'committee' || k === 'mentor') {
        if (k === 'committee') out += '<label class="va-field"><span>Committee</span><select data-f="member_type">' + options([['executive_committee', 'Executive Committee'], ['supporting_committee', 'Supporting Committee']], form.member_type) + '</select></label>';
        if (k === 'mentor') out += '<label class="va-field"><span>Mentor level</span><select data-f="member_type">' + options([['senior_sankofa_mentor', 'Senior Sankofa Mentor'], ['junior_sankofa_mentor', 'Junior Sankofa Mentor']], form.member_type) + '</select></label>';
        out += '<label class="va-field"><span>Course</span><select data-f="course">' + options(courseList, form.course) + '</select></label>';
        out += '<label class="va-field"><span>Year</span><select data-f="year">' + options(YEARS, form.year, 'Not set') + '</select></label>';
        if (k === 'committee') out += '<label class="va-field va-field--wide"><span>Committee title <small>(optional - some features are limited to titles like Treasurer)</small></span><input type="text" data-f="committee_role" maxlength="60" value="' + esc(form.committee_role) + '" placeholder="e.g. Treasurer"></label>';
      } else if (k === 'professional') {
        out += '<label class="va-field"><span>Kind of professional</span><select data-f="category">' + options(Object.keys(PRO_CATEGORIES).map(function (c) { return [c, PRO_CATEGORIES[c]]; }), form.category) + '</select></label>';
        out += '<label class="va-field"><span>Job title <small>(optional)</small></span><input type="text" data-f="title" maxlength="60" value="' + esc(form.title) + '" placeholder="e.g. Registrar"></label>';
      } else if (k === 'mmg') {
        out += '<p class="va-note va-field--wide">Guests from partner universities only see the Midlands Medics Gala area.</p>';
      } else {
        out += '<p class="va-note va-field--wide">The public site exactly as someone who isn\'t signed in sees it. Pages that need a login send you to the login page, as they would for them.</p>';
      }
      return out;
    }

    function peopleHtml() {
      if (peopleError) return '<p class="va-error">' + esc(peopleError) + '</p>';
      if (!people) return '<p class="va-muted">Loading everyone…</p>';
      var term = q.trim().toLowerCase();
      var list = people.filter(function (p) {
        return (group === 'all' || groupOf(p) === group) && (!term || (p.full_name || '').toLowerCase().indexOf(term) !== -1);
      });
      if (!list.length) return '<p class="va-muted">Nobody matches that.</p>';
      return list.slice(0, 80).map(function (p) {
        return '<button type="button" class="va-person" data-person="' + esc(p.key) + '">' +
          '<span class="va-person-av" aria-hidden="true">' + esc((p.full_name || '?').charAt(0).toUpperCase()) + '</span>' +
          '<span class="va-person-main"><strong>' + esc(p.full_name) + '</strong><small>' + esc(personSub(p)) + '</small></span></button>';
      }).join('') + (list.length > 80 ? '<p class="va-muted">Showing the first 80 - type a name to narrow it down.</p>' : '');
    }

    function chipsHtml() {
      var counts = { all: people ? people.length : 0 };
      (people || []).forEach(function (p) { var g = groupOf(p); counts[g] = (counts[g] || 0) + 1; });
      return GROUPS.filter(function (g) { return g[0] === 'all' || counts[g[0]]; }).map(function (g) {
        return '<button type="button" class="va-chip' + (group === g[0] ? ' is-on' : '') + '" data-group="' + g[0] + '" aria-pressed="' + (group === g[0]) + '">' + g[1] + (people ? ' <b>' + (counts[g[0]] || 0) + '</b>' : '') + '</button>';
      }).join('');
    }

    function statusHtml() {
      if (opening) {
        return '<div class="va-status" role="status"><span class="va-spinner" aria-hidden="true"></span><div><strong>Opening ' + esc(opening.name) + '\'s view…</strong><small>This takes a couple of seconds.</small></div></div>';
      }
      if (failure) {
        var e = failure.error;
        var help = e.code === 'missing'
          ? '<p class="va-note">The exact view needs a small Supabase Edge Function called <b>view-as</b> and migration 092. The steps are at the top of <code>supabase/functions/view-as/index.ts</code>. Until then you can see an approximate view of ' + esc(failure.row.full_name) + ' (their course, year and access rules, but your data).</p>'
          : '';
        return '<div class="va-status va-status--error" role="alert"><div><strong>Couldn\'t open ' + esc(failure.row.full_name) + '\'s view</strong><small>' + esc(e.message) + '</small>' + help +
          '<div class="va-status-actions">' + (e.code === 'missing' ? '<button type="button" class="va-btn" data-approx>Show the approximate view</button>' : '') + '<button type="button" class="va-btn" data-dismiss-failure>Back to the list</button></div></div></div>';
      }
      return '';
    }

    function draw() {
      // Header and tabs stay put, the middle scrolls, and the buttons stay at the bottom.
      var head = '<div class="va-head"><div><span class="va-eyebrow">President tools</span><h2 id="va-title">View the website as&hellip;</h2></div>' +
        '<button type="button" class="va-x" data-va-close aria-label="Close"' + (opening ? ' disabled' : '') + '>&times;</button></div>' +
        '<div class="va-tabs" role="tablist"><button type="button" role="tab" class="' + (tab === 'person' ? 'is-active' : '') + '" aria-selected="' + (tab === 'person') + '" data-tab="person">A real person <small>exact</small></button>' +
        '<button type="button" role="tab" class="' + (tab === 'type' ? 'is-active' : '') + '" aria-selected="' + (tab === 'type') + '" data-tab="type">An account type <small>approximate</small></button></div>';
      var lede = '<p class="va-lede">Browse the site as someone else sees it. It\'s read-only - nothing you click is saved or sent - and you stay signed in as yourself.</p>';
      var body, foot;
      if (tab === 'person') {
        body = lede + statusHtml();
        if (!opening && !failure) {
          body += '<div class="va-section"><label class="va-field va-field--wide"><span>Find someone</span><input type="search" id="va-q" placeholder="Search by name…" value="' + esc(q) + '" autocomplete="off"></label>' +
            '<div class="va-chips" id="va-chips">' + chipsHtml() + '</div>' +
            '<div class="va-people" id="va-people">' + peopleHtml() + '</div>' +
            '<p class="va-note">You see their account exactly as they do - their lists, locks, counts and anything personal to them. Their private messages stay hidden, and each use is logged.</p></div>';
        }
        foot = '<button type="button" class="va-btn" data-va-close' + (opening ? ' disabled' : '') + '>Cancel</button>';
      } else {
        body = lede + '<p class="va-note va-approx">A generic account of this kind. It uses your own data with that account\'s profile and access rules, so a list the real account couldn\'t read may show more. For an exact view, pick a real person.</p>' +
          '<div class="va-section"><span class="va-label">Quick pick</span><div class="va-presets">' + PRESETS.map(function (p) { return '<button type="button" class="va-chip" data-preset="' + p.id + '">' + esc(p.label) + '</button>'; }).join('') + '</div></div>' +
          '<div class="va-section"><span class="va-label">Or build one</span><div class="va-kinds" role="radiogroup" aria-label="Account type">' + KINDS.map(function (k) {
            return '<button type="button" role="radio" aria-checked="' + (form.kind === k[0]) + '" class="va-kind' + (form.kind === k[0] ? ' is-on' : '') + '" data-kind="' + k[0] + '"><strong>' + k[1] + '</strong><small>' + k[2] + '</small></button>';
          }).join('') + '</div><div class="va-fields">' + fieldsHtml() + '</div></div>' +
          '<div class="va-section"><span class="va-label">What this account can use</span><div class="va-access" id="va-access" aria-live="polite"><span class="va-muted">Checking…</span></div></div>';
        foot = '<button type="button" class="va-btn" data-va-close>Cancel</button><button type="button" class="va-btn va-btn--primary" data-start id="va-start">Start viewing</button>';
      }
      var hadFocus = document.activeElement && document.activeElement.id;
      var scrollTop = dlg.querySelector('.va-body') ? dlg.querySelector('.va-body').scrollTop : 0;
      dlg.innerHTML = head + '<div class="va-body">' + body + '</div><div class="va-foot">' + foot + '</div>';
      var nb = dlg.querySelector('.va-body');
      if (nb && scrollTop) nb.scrollTop = scrollTop;
      if (tab === 'type') refreshAccess();
      if (hadFocus && document.getElementById(hadFocus)) document.getElementById(hadFocus).focus();
    }

    function redrawPeople() {
      var box = dlg.querySelector('#va-people'), chips = dlg.querySelector('#va-chips');
      if (box) box.innerHTML = peopleHtml();
      if (chips) chips.innerHTML = chipsHtml();
    }

    // Everyone with a login: members, professionals and MMG guests (the president's own account left out).
    function loadPeople() {
      if (people || peopleError) return;
      function safe(promise) { return promise.then(function (r) { return r; }, function (e) { return { data: null, error: e }; }); }
      Promise.all([
        safe(client.from('members').select('id, full_name, course, year_of_study, member_type, committee_role').order('full_name', { ascending: true }).limit(3000)),
        safe(client.from('network_professionals').select('user_id, full_name, title, category, is_active').not('user_id', 'is', null).eq('is_active', true).order('full_name', { ascending: true }).limit(2000)),
        safe(client.from('mmg_guests').select('id, full_name').order('full_name', { ascending: true }).limit(1000))
      ]).then(function (res) {
        if (res[0].error) throw res[0].error;
        var list = [];
        (res[0].data || []).forEach(function (m) {
          if (m.id === PRESIDENT_UID) return;
          list.push({ key: 'm:' + m.id, personKind: 'member', id: m.id, full_name: m.full_name, course: m.course, year_of_study: m.year_of_study, member_type: m.member_type, committee_role: m.committee_role });
        });
        ((res[1] && res[1].data) || []).forEach(function (p) {
          list.push({ key: 'p:' + p.user_id, personKind: 'professional', id: p.user_id, full_name: p.full_name, title: p.title, category: p.category });
        });
        ((res[2] && res[2].data) || []).forEach(function (g) {
          list.push({ key: 'g:' + g.id, personKind: 'mmg', id: g.id, full_name: g.full_name });
        });
        list.sort(function (a, b) { return (a.full_name || '').localeCompare(b.full_name || ''); });
        people = list;
      }).catch(function (e) { peopleError = 'Couldn\'t load people: ' + (e && e.message ? e.message : 'try again'); }).then(redrawPeople);
    }

    // Asks the database what a generic account gets, and shows it.
    function refreshAccess() {
      var box = dlg.querySelector('#va-access');
      var start = dlg.querySelector('#va-start');
      if (!box) return;
      var p = currentPersona();
      var seq = ++accessSeq;
      clearTimeout(accessTimer);
      accessTimer = setTimeout(function () {
        client.rpc('president_preview_hub_access', previewArgs(p)).then(function (res) {
          if (seq !== accessSeq) return;
          var b = dlg.querySelector('#va-access');
          if (!b) return;
          if (res.error) {
            var missing = /does not exist|could not find|schema cache/i.test(res.error.message || '');
            b.innerHTML = '<p class="va-error">' + (missing ? 'Migration 091 hasn\'t been run yet - run db/migrations/091-view-as.sql in Supabase, then try again.' : esc(res.error.message)) + '</p>';
            if (start) start.disabled = true;
            return;
          }
          if (start) start.disabled = false;
          var rows = (res.data || []).slice().sort(function (x, y) { return (FEATURE_LABEL[x.feature] || x.feature).localeCompare(FEATURE_LABEL[y.feature] || y.feature); });
          if (p.kind === 'visitor' || p.kind === 'mmg') {
            b.innerHTML = '<span class="va-muted">' + (p.kind === 'mmg' ? 'The Midlands Medics Gala area only.' : 'Public pages only.') + '</span>';
            return;
          }
          var on = rows.filter(function (r) { return r.allowed; }), off = rows.filter(function (r) { return !r.allowed; });
          b.innerHTML = (on.length ? on.map(function (r) { return '<span class="va-tag is-on">' + esc(FEATURE_LABEL[r.feature] || r.feature) + '</span>'; }).join('') : '<span class="va-muted">Nothing beyond the basics.</span>') +
            (off.length ? '<details class="va-more"><summary>' + off.length + ' not available</summary>' + off.map(function (r) { return '<span class="va-tag">' + esc(FEATURE_LABEL[r.feature] || r.feature) + (r.blocked_display === 'locked' ? ' <em>locked</em>' : ' <em>hidden</em>') + '</span>'; }).join('') + '</details>' : '');
        }, function () { /* the message above covers it */ });
      }, 120);
    }

    function openPerson(row) {
      failure = null;
      opening = { name: row.full_name };
      draw();
      mint(row.id).then(function (minted) {
        opening = null;
        go(personPersona(row, row.personKind, minted));
      }, function (err) {
        opening = null;
        failure = { row: row, error: err };
        if (pickerEl) draw();
      });
    }

    dlg.addEventListener('click', function (e) {
      if (opening) return;
      if (e.target.closest('[data-va-close]')) { closePicker(); return; }
      if (e.target.closest('[data-dismiss-failure]')) { failure = null; draw(); return; }
      if (e.target.closest('[data-approx]')) { var r = failure.row; go(personPersona(r, r.personKind, null)); return; }
      var t = e.target.closest('[data-tab]');
      if (t) {
        tab = t.getAttribute('data-tab'); failure = null; draw();
        if (tab === 'person') { loadPeople(); var qi = dlg.querySelector('#va-q'); if (qi) qi.focus(); }
        return;
      }
      var grp = e.target.closest('[data-group]');
      if (grp) { group = grp.getAttribute('data-group'); redrawPeople(); return; }
      var pre = e.target.closest('[data-preset]');
      if (pre) {
        var preset = PRESETS.filter(function (p) { return p.id === pre.getAttribute('data-preset'); })[0];
        if (preset) go(preset.make());
        return;
      }
      var kind = e.target.closest('[data-kind]');
      if (kind) {
        form.kind = kind.getAttribute('data-kind');
        if (form.kind === 'committee') form.member_type = 'executive_committee';
        else if (form.kind === 'mentor') form.member_type = 'senior_sankofa_mentor';
        else form.member_type = 'member';
        draw();
        return;
      }
      if (e.target.closest('[data-start]')) { go(currentPersona()); return; }
      var per = e.target.closest('[data-person]');
      if (per) {
        var row = (people || []).filter(function (x) { return x.key === per.getAttribute('data-person'); })[0];
        if (row) openPerson(row);
      }
    });
    dlg.addEventListener('change', function (e) {
      var f = e.target.getAttribute && e.target.getAttribute('data-f');
      if (!f) return;
      form[f] = e.target.value;
      refreshAccess();
    });
    dlg.addEventListener('input', function (e) {
      var f = e.target.getAttribute && e.target.getAttribute('data-f');
      if (f) { form[f] = e.target.value; refreshAccess(); return; }
      if (e.target.id === 'va-q') { q = e.target.value; redrawPeople(); }
    });

    draw();
    loadPeople();
    var first = dlg.querySelector('#va-q') || dlg.querySelector('button');
    if (first) first.focus();
  }

  window.lacmsViewAs = {
    fetch: viewAsFetch,
    attach: attach,
    active: function () { return !!persona; },
    persona: function () { return persona; },
    open: openPicker,
    exit: exit
  };
})();
