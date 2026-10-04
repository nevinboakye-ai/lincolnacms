(function () {
  'use strict';

  // Show/hide the "not configured yet" notices that live on the login and
  // hub pages. If the Supabase keys in js/supabase-client.js are still the
  // placeholder values, there's nothing else this script can safely do.
  var notConfiguredEls = document.querySelectorAll('[data-supabase-not-configured]');
  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured) {
    notConfiguredEls.forEach(function (el) { el.style.display = ''; });
    var pendingAuthGate = document.getElementById('auth-gate');
    if (pendingAuthGate) pendingAuthGate.style.display = 'none';
    return;
  }
  notConfiguredEls.forEach(function (el) { el.style.display = 'none'; });

  // ---- Site-wide: cap "stay signed in" at about a month -----------------
  // persistSession + autoRefreshToken (js/supabase-client.js) already keep
  // someone signed in across page loads and browser restarts — Supabase's
  // refresh tokens don't expire on a fixed schedule by default, which on
  // its own means "indefinitely", not "about a month". This adds an
  // explicit, enforced cap on top: the moment of an actual sign-in gets
  // stamped locally, and once that stamp is more than 30 days old the
  // session is ended automatically next time they're back on the site —
  // the same effect as logging out themselves, just on a timer.
  (function () {
    var STAMP_KEY = 'lacmsSessionStartedAt';
    var MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

    supabaseClient.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_IN') {
        try {
          if (!localStorage.getItem(STAMP_KEY)) {
            localStorage.setItem(STAMP_KEY, String(Date.now()));
          }
        } catch (e) {}
      } else if (event === 'SIGNED_OUT') {
        try { localStorage.removeItem(STAMP_KEY); } catch (e) {}
      }
    });

    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (!session) return;
      var stamp;
      try { stamp = localStorage.getItem(STAMP_KEY); } catch (e) { stamp = null; }
      if (!stamp) {
        // First time this code has seen this session on this device
        // (e.g. someone already signed in from before this existed) —
        // start the clock now rather than treating it as already stale.
        try { localStorage.setItem(STAMP_KEY, String(Date.now())); } catch (e) {}
        return;
      }
      if (Date.now() - parseInt(stamp, 10) > MAX_AGE_MS) {
        try { localStorage.removeItem(STAMP_KEY); } catch (e) {}
        supabaseClient.auth.signOut();
      }
    });
  })();

  // The one account allowed onto the president-only activity dashboard —
  // client-side use of this is purely a UX shortcut (hiding the card/
  // redirecting early); the actual security boundary is is_president()
  // on the database side, which every president_get_* RPC checks itself.
  var PRESIDENT_UID = '22044cd2-6804-4142-96c4-5c475ce9347a';

  // Any password-setting link this site emails to someone who isn't
  // provably the same person, same browser, right now (an account the
  // president creates on their behalf, or just someone who checks their
  // email on their phone after requesting a reset on their laptop)
  // needs to be self-contained, not tied to this browser's own storage.
  // The site's main client defaults to the PKCE flow, where the emailed
  // ?code= only ever redeems successfully in the exact browser that
  // requested it, since the matching verifier lives only in that
  // browser's storage — fine for "click forgot password, then click the
  // link in the same tab a minute later," broken for anything else.
  // Every signUp()/resetPasswordForEmail() call built from this instead
  // forces the older #access_token=...&type=... link format, which is
  // fully self-contained and needs no stored verifier — it works from
  // any device, which is exactly what these calls actually need.
  function createImplicitFlowClient() {
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'implicit' }
    });
  }

  // A brand new signUp() account occasionally isn't visible yet to the
  // very next query that references it by foreign key (members.id,
  // mmg_guests.id -> auth.users.id) - an eventual-consistency gap, not a
  // real failure, that shows up as "violates foreign key constraint
  // ..._id_fkey" on the profile insert that immediately follows signUp()
  // everywhere this site creates an account (Create Account, and
  // approving an account request). Retries a few times with backoff
  // specifically for that one Postgres error code (23503, foreign_key_
  // violation) before giving up for real - it almost always resolves
  // within a second or two. insertFn is a thunk (not an already-started
  // request) so each retry is a genuinely new attempt, not a reused,
  // already-settled promise.
  function insertWithFkRetry(insertFn, attempt) {
    attempt = attempt || 1;
    return insertFn().then(function (result) {
      if (result.error && result.error.code === '23503' && attempt < 5) {
        return new Promise(function (resolve) {
          setTimeout(function () { resolve(insertWithFkRetry(insertFn, attempt + 1)); }, 500 * attempt);
        });
      }
      return result;
    });
  }

  // Fisher-Yates, in place on a shallow copy — used by the discounts
  // page to show partners in a different order on every load, so the
  // same few names at the top don't quietly become the only ones anyone
  // actually sees.
  function shuffleArray(arr) {
    var copy = arr.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function showMessage(el, message) {
    if (!el) return;
    el.textContent = message;
    el.style.display = 'block';
  }
  function hideMessage(el) {
    if (!el) return;
    el.style.display = 'none';
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Every href/src built from a database field (a discount link, a
  // profile's LinkedIn URL, a photo) goes through this before it's ever
  // written into HTML. Some of those fields are edited by members
  // themselves (e.g. a professional's own LinkedIn URL), not just
  // committee — so a plain encodeURI() isn't enough, since it happily
  // passes through a "javascript:" URL unchanged. Only http(s)/mailto/tel
  // make it through; anything else (or anything that fails to parse) is
  // dropped rather than rendered.
  function safeUrl(url) {
    if (!url) return '';
    var trimmed = String(url).trim();
    if (!/^(https?:|mailto:|tel:)/i.test(trimmed)) return '';
    try {
      return encodeURI(trimmed);
    } catch (e) {
      return '';
    }
  }

  // Shared by the members hub (professional profile card) and the
  // Network page (professional cards + modal) — one place to edit the
  // wording for each category.
  var PROFESSIONAL_CATEGORY_LABELS = {
    senior_doctor: 'Senior Doctor / Consultant',
    alumni_doctor: 'Alumni Doctor',
    pharmacist: 'Pharmacist',
    other: 'Professional'
  };

  var MEMBER_TYPE_LABELS = {
    member: 'Member',
    supporting_committee: 'Supporting Committee Member',
    executive_committee: 'Executive Committee Member',
    senior_sankofa_mentor: 'Senior Sankofa Mentor',
    junior_sankofa_mentor: 'Junior Sankofa Mentor'
  };

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value || '-';
  }

  // Populates just the digital membership card's own fields (not the
  // "Your details" panel below it on the hub page) — shared by anywhere
  // .member-card markup with these same element ids is embedded, so the
  // card itself never has two different implementations to keep in sync
  // (same spirit as js/main.js's shared card-flip builder, just for the
  // data instead of the 3D behaviour).
  function renderMemberCardFields(member) {
    var courseYear = [member.course, member.year_of_study].filter(Boolean).join(' · ');
    var typeLabel = MEMBER_TYPE_LABELS[member.member_type] || MEMBER_TYPE_LABELS.member;

    setText('member-full-name', member.full_name);
    setText('member-course-year', courseYear);
    setText('member-number', member.membership_number);
    setText('member-type-badge', typeLabel);

    // committee_role (e.g. "President") is optional free text — only
    // show it on the card when it's set.
    var positionEl = document.getElementById('member-position');
    if (positionEl) {
      if (member.committee_role) {
        positionEl.textContent = member.committee_role;
        positionEl.style.display = '';
      } else {
        positionEl.style.display = 'none';
      }
    }

    var statusEl = document.getElementById('member-status');
    if (statusEl) {
      var status = member.membership_status || 'active';
      var label = status.charAt(0).toUpperCase() + status.slice(1);
      statusEl.className = 'member-status-badge member-status-badge--' + status;
      statusEl.innerHTML = '<span class="member-status-badge-dot" aria-hidden="true"></span>' + label;
    }
  }

  // Shared by request-account.html's dropdowns and the Account Requests
  // dashboard section (migration 047) — one source of truth for "what
  // are LACMS's actual courses/years", rather than free text that could
  // drift (a typo'd course name would never match anything elsewhere on
  // the site that groups or filters by course).
  var LACMS_COURSES = ['Medicine', 'Pharmacy', 'Dental Hygiene and Therapy', 'Diagnostic Radiography', 'Nursing', 'Midwifery', 'Biomedical Science', 'Occupational Therapy'];
  var LACMS_YEARS = ['Foundation Year', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Masters'];

  // ---- Request-account page (request-account.html): public, no login
  // needed — replaces the committee creating every member's login by
  // hand with a request the president reviews and approves from the
  // dashboard (migration 047's account_requests table). ----
  var requestAccountForm = document.getElementById('request-account-form');
  if (requestAccountForm) {
    var requestCourseSelect = document.getElementById('request-course');
    var requestYearSelect = document.getElementById('request-year');
    var requestCourseOtherWrap = document.getElementById('request-course-other-wrap');
    var requestCourseOtherInput = document.getElementById('request-course-other');
    LACMS_COURSES.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      requestCourseSelect.appendChild(opt);
    });
    // "Other" is deliberately not part of the shared LACMS_COURSES list
    // (that one also feeds the Network page's course grouping and the
    // dashboard's course field, where a literal "Other" entry wouldn't
    // mean anything) - it only exists here, as an escape hatch for a
    // course that isn't one of LACMS's usual ones yet.
    var otherOpt = document.createElement('option');
    otherOpt.value = 'Other';
    otherOpt.textContent = 'Other';
    requestCourseSelect.appendChild(otherOpt);
    LACMS_YEARS.forEach(function (y) {
      var opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      requestYearSelect.appendChild(opt);
    });

    requestCourseSelect.addEventListener('change', function () {
      var isOther = requestCourseSelect.value === 'Other';
      requestCourseOtherWrap.style.display = isOther ? '' : 'none';
      requestCourseOtherInput.required = isOther;
      if (!isOther) requestCourseOtherInput.value = '';
    });

    requestAccountForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var statusEl = document.getElementById('request-account-status');
      hideMessage(statusEl);

      var name = document.getElementById('request-name').value.trim();
      var email = document.getElementById('request-email').value.trim();
      var password = document.getElementById('request-password').value;
      var passwordConfirm = document.getElementById('request-password-confirm').value;
      var studentNumber = document.getElementById('request-student-number').value.trim();
      var course = requestCourseSelect.value === 'Other'
        ? requestCourseOtherInput.value.trim()
        : requestCourseSelect.value;
      var year = requestYearSelect.value;
      var note = document.getElementById('request-note').value.trim();

      if (!name || !email || !password || !studentNumber || !course || !year) {
        showMessage(statusEl, requestCourseSelect.value === 'Other' && !course
          ? 'Tell us what course you\'re on.'
          : 'Fill in your name, email, password, student number, course and year.');
        return;
      }
      if (password.length < 8) {
        showMessage(statusEl, 'Your password needs to be at least 8 characters.');
        return;
      }
      if (password !== passwordConfirm) {
        showMessage(statusEl, "Those passwords don't match.");
        return;
      }

      var btn = requestAccountForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      statusEl.style.color = 'var(--color-text-muted)';
      showMessage(statusEl, 'Sending…');

      // The password is set here, for real, rather than at approval time
      // - so this is a genuine signUp() (on an isolated, non-session-
      // persisting client, so this browser never ends up holding a live
      // session for an account that isn't approved yet), not the
      // random-password-then-email-a-link dance the dashboard's Create
      // Account form still uses. Approving later just has to attach a
      // members row to this same auth id - no further signUp() call, no
      // second email needed to get them logged in.
      var requestSignupClient = createImplicitFlowClient();
      // emailRedirectTo matters even though no password step happens on
      // the other end of it any more - if this project has "Confirm
      // email" switched on, signUp() still sends its own confirmation
      // email regardless of anything here, and without this it would
      // fall back to the project's generic Site URL instead of landing
      // them somewhere that actually makes sense once confirmed.
      var requestSignupRedirect = window.location.origin + '/member-login.html';
      requestSignupClient.auth.signUp({ email: email, password: password, options: { emailRedirectTo: requestSignupRedirect } }).then(function (signUpResult) {
        if (signUpResult.error || !signUpResult.data || !signUpResult.data.user) {
          btn.disabled = false;
          statusEl.style.color = '#ef8b8f';
          showMessage(statusEl, (signUpResult.error && signUpResult.error.message) || "Couldn't create your login - the email may already be in use.");
          return;
        }
        var authUserId = signUpResult.data.user.id;

        supabaseClient
          .from('account_requests')
          .insert({
            full_name: name, email: email, auth_user_id: authUserId, student_number: studentNumber,
            course: course, year_of_study: year, note: note || null
          })
          .then(function (result) {
            if (result.error) {
              btn.disabled = false;
              statusEl.style.color = '#ef8b8f';
              // Postgres' unique-violation code, from the one-pending-
              // request-per-email index — worth catching and
              // rephrasing, since the raw constraint-violation message
              // means nothing to someone filling in a form (and in this
              // specific case genuinely can't happen on a first-ever
              // submission, since signUp() above would already have
              // rejected a second attempt with the same email first).
              // Every other error shows as-is.
              showMessage(statusEl, result.error.code === '23505'
                ? "You've already got a request pending review - the committee will get to it soon."
                : (result.error.message || "Your login was created, but saving your request failed - email acms@lincolnsu.com so the committee can finish this for you."));
              return;
            }
            document.getElementById('request-account-sent-email').textContent = email;
            document.getElementById('request-account-form-wrap').style.display = 'none';
            document.getElementById('request-account-success').style.display = '';
          });
      });
    });
  }

  // A professional has no row in `members` — this is how every gate
  // that already checks the `members` table (nav, homepage perks card,
  // the members hub itself, opportunities, MoTM nominations) also
  // recognises a signed-in professional. Returns the full row, or null.
  function getProfessionalRow(session) {
    return supabaseClient
      .from('network_professionals')
      .select('*')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(function (result) { return result.data || null; });
  }

  // Perks and Sankofa applications used to be committee-only "coming
  // soon" previews; now open to any signed-in LACMS member (not
  // professionals, not MMG guests — this only ever checks `members`),
  // now that real member accounts actually exist via request-account.html
  // rather than everyone still waiting on a feature with nobody able to
  // use it yet. Sankofa itself still has its own separate
  // sankofa_eligible gate on top of this, set per-member by the
  // committee — this only ever controls whether someone can reach the
  // page/section at all. Shared by the homepage impact card, the hub,
  // and the Perks and Sankofa pages themselves.
  function checkIsMember(session) {
    return supabaseClient
      .from('members')
      .select('id')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(function (result) { return !!result.data; });
  }

  // Hub Access (migration 060): what the signed-in user is allowed to use
  // is decided by rules the president edits on the dashboard, evaluated
  // in Postgres. This asks once per page for the caller's own result:
  // { feature: { allowed, blockedDisplay } }, or null if it couldn't be
  // loaded (e.g. the migration hasn't been run) - every caller then falls
  // back to the rule it used before this existed, so nothing breaks.
  var hubAccessPromise = null;
  function getHubAccess() {
    if (!hubAccessPromise) {
      hubAccessPromise = supabaseClient.rpc('get_my_hub_access').then(function (result) {
        if (result.error) {
          console.warn('Hub access unavailable, using built-in rules:', result.error.message);
          return null;
        }
        var map = {};
        (result.data || []).forEach(function (r) {
          map[r.feature] = { allowed: !!r.allowed, blockedDisplay: r.blocked_display };
        });
        return map;
      }, function () { return null; });
    }
    return hubAccessPromise;
  }
  var DASHBOARD_FEATURES = ['dash_mmg', 'dash_sankofa', 'dash_motm', 'dash_events', 'dash_gallery'];
  function hubFeatureAllowed(access, feature, fallbackAllowed) {
    return access && access[feature] ? access[feature].allowed : fallbackAllowed;
  }

  // ---- Site-wide: "Active members" stat (index.html, about.html) —
  // hidden until 30 September 2026 (launch), then reads live from
  // site_settings.active_member_count instead of a hardcoded number —
  // editable straight from Supabase's Table Editor, no code change or
  // redeploy needed to update it. Public data, no session required;
  // stays hidden (not "0" or a stale number) if the reveal date hasn't
  // passed, the fetch fails, or the row doesn't exist yet. ----
  var activeMemberCountEls = document.querySelectorAll('[data-active-member-count]');
  if (activeMemberCountEls.length) {
    var ACTIVE_MEMBER_COUNT_REVEAL = new Date('2026-09-30T00:00:00+01:00').getTime();
    if (Date.now() >= ACTIVE_MEMBER_COUNT_REVEAL) {
      supabaseClient
        .from('site_settings')
        .select('value')
        .eq('key', 'active_member_count')
        .maybeSingle()
        .then(function (result) {
          if (result.error || !result.data) return;
          activeMemberCountEls.forEach(function (el) { el.textContent = result.data.value; });
          document.querySelectorAll('[data-active-member-count-item]').forEach(function (el) {
            el.style.display = '';
          });
        });
    }
  }

  // ---- Site-wide presence heartbeat: powers the president's "currently
  // online" view. Not a live socket — just a timestamp upserted every
  // 30 seconds for whoever's signed in, on whichever page they happen to
  // be on (member, professional, or MMG guest alike). The dashboard
  // treats "seen in the last 5 minutes" as online — with a 30-second
  // beat that's ten missed beats of headroom before someone actually
  // using the site would ever wrongly drop out of "online". ----
  supabaseClient.auth.getSession().then(function (result) {
    var session = result.data && result.data.session;
    if (!session) return;

    function beat() {
      supabaseClient
        .from('member_presence')
        .upsert({ id: session.user.id, last_seen_at: new Date().toISOString() })
        .then(function (result) {
          if (result.error) console.error('Presence heartbeat failed:', result.error.message);
        });
    }

    beat();
    setInterval(beat, 30000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') beat();
    });
  });

  // Professionals are stored as "Dr Andrew Smith" — a plain
  // split(' ')[0] greets them "Hi, Dr", dropping their actual name.
  // This keeps a recognised title attached to the first real name
  // instead ("Dr Andrew"). Falls back to a plain first name otherwise.
  var NAME_TITLES = { dr: 1, mr: 1, mrs: 1, ms: 1, miss: 1, prof: 1, professor: 1 };
  function greetingName(fullName) {
    var parts = (fullName || '').trim().split(/\s+/);
    if (!parts.length || !parts[0]) return '';
    if (parts.length > 1 && NAME_TITLES[parts[0].toLowerCase().replace(/\.$/, '')]) {
      return parts[0] + ' ' + parts[1];
    }
    return parts[0];
  }

  // Shared by the members-hub feed and the MMG portal feeds.
  function timeAgo(dateStr) {
    var date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    var diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return diffMin + (diffMin === 1 ? ' minute ago' : ' minutes ago');
    var diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + (diffHr === 1 ? ' hour ago' : ' hours ago');
    var diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return diffDay + (diffDay === 1 ? ' day ago' : ' days ago');
    var diffWeek = Math.floor(diffDay / 7);
    if (diffWeek < 5) return diffWeek + (diffWeek === 1 ? ' week ago' : ' weeks ago');
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // A small "New" badge for anything posted in the last 48 hours —
  // shared by the members feed, news posts and MMG updates, so
  // checking back in after a couple of days actually feels rewarded
  // instead of every post looking identical regardless of age.
  function newBadgeHtml(dateStr) {
    var date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    var hoursOld = (Date.now() - date.getTime()) / 3600000;
    return hoursOld >= 0 && hoursOld < 48
      ? '<span class="new-badge">New</span>'
      : '';
  }

  // Shared by every network_join_events reader (the hub banner, the
  // Network ticker, and its full-history modal) — if someone's account
  // ever gets recreated (e.g. after getting stuck on a broken invite
  // and being re-added), their old and new join events would otherwise
  // both show up as if two different people joined. Keeps only the
  // most recent event per name; assumes rows arrive newest-first, so
  // keeping the first occurrence of each name is enough.
  function dedupeJoinEventsByName(rows) {
    var seen = {};
    var result = [];
    rows.forEach(function (row) {
      var key = (row.full_name || '').trim().toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      result.push(row);
    });
    return result;
  }

  // A small, deliberately safe "rich text" renderer for discount/
  // opportunity descriptions, written by the committee via Table Editor.
  // Everything is HTML-escaped first, then a small fixed set of
  // markdown-style patterns is re-introduced as real tags on top of the
  // already-escaped text — so there's no way for stored text to smuggle
  // in arbitrary HTML, only the handful of tags this function itself
  // chooses to emit. Blank lines become paragraph breaks, single line
  // breaks become <br>, **bold**/*italic*/_italic_ work inline, and a
  // block where every line starts with "- " or "* " becomes a bullet list.
  function formatInlineRichText(str) {
    var escaped = escapeHtml(str);
    escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/\*(.+?)\*/g, '<em>$1</em>');
    escaped = escaped.replace(/_(.+?)_/g, '<em>$1</em>');
    return escaped;
  }
  function renderRichText(text) {
    if (!text) return '';
    var paragraphs = String(text).split(/\n\s*\n/);
    return paragraphs.map(function (para) {
      var lines = para.split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l.length; });
      if (!lines.length) return '';
      var isList = lines.every(function (l) { return /^[-*]\s+/.test(l); });
      if (isList) {
        var items = lines.map(function (l) {
          return '<li>' + formatInlineRichText(l.replace(/^[-*]\s+/, '')) + '</li>';
        }).join('');
        return '<ul class="rich-text-list">' + items + '</ul>';
      }
      return '<p>' + lines.map(formatInlineRichText).join('<br>') + '</p>';
    }).join('');
  }

  // A small confetti pop centred on the just-revealed code chip — plain
  // DOM spans animated with a CSS keyframe (.discount-confetti-piece),
  // removed once the animation finishes. Skipped outright for
  // prefers-reduced-motion rather than firing an instant version of it.
  var DISCOUNT_CONFETTI_COLORS = ['#d4a62b', '#e8c767', '#6fcf97', '#b28ff0', '#ef8bc4', '#7ab2f0'];
  function celebrateDiscountReveal(cardEl) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var codeEl = cardEl.querySelector('.discount-code');
    if (!codeEl) return;
    var cardRect = cardEl.getBoundingClientRect();
    var codeRect = codeEl.getBoundingClientRect();
    var burst = document.createElement('div');
    burst.className = 'discount-confetti-burst';
    burst.style.left = (codeRect.left - cardRect.left + codeRect.width / 2) + 'px';
    burst.style.top = (codeRect.top - cardRect.top + codeRect.height / 2) + 'px';
    for (var i = 0; i < 14; i++) {
      var piece = document.createElement('span');
      piece.className = 'discount-confetti-piece';
      var angle = Math.random() * Math.PI * 2;
      var distance = 36 + Math.random() * 54;
      piece.style.setProperty('--x', (Math.cos(angle) * distance) + 'px');
      piece.style.setProperty('--y', (Math.sin(angle) * distance - 20) + 'px');
      piece.style.setProperty('--rot', (Math.random() * 540 - 270) + 'deg');
      piece.style.background = DISCOUNT_CONFETTI_COLORS[Math.floor(Math.random() * DISCOUNT_CONFETTI_COLORS.length)];
      piece.style.animationDelay = (Math.random() * 0.08) + 's';
      burst.appendChild(piece);
    }
    cardEl.appendChild(burst);
    setTimeout(function () { burst.remove(); }, 1000);
  }

  function discountUsageLabelHtml(usedCount) {
    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' +
      (usedCount === 0 ? "Haven't used this yet" : usedCount === 1 ? 'Used once' : 'Used ' + usedCount + ' times');
  }

  // Shared by every discount/perk card (LACMS discounts and MMG night
  // perks alike) — the code stays blurred behind a "Reveal code" button
  // until clicked, then a "Copy" button appears. Click handling for both
  // buttons is delegated site-wide, below, so this only needs to emit
  // the markup.
  function renderCodeReveal(code) {
    if (!code) return '';
    return '<div class="discount-code">' +
      '<span class="discount-code-label">Code</span>' +
      '<span class="discount-code-scratch">' +
        '<span class="discount-code-value">' + escapeHtml(code) + '</span>' +
        '<button type="button" class="discount-code-reveal-btn"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>Reveal code</button>' +
      '</span>' +
      '<button type="button" class="discount-code-copy-btn"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>Copy</button>' +
    '</div>';
  }

  // Site-wide delegated handling for the two buttons above — delegated
  // because discount/perk cards are always inserted after page load, so
  // binding directly to them at parse time would miss every one.
  document.addEventListener('click', function (e) {
    var revealBtn = e.target.closest('.discount-code-reveal-btn');
    if (revealBtn) {
      var revealWrap = revealBtn.closest('.discount-code');
      if (revealWrap) revealWrap.classList.add('is-revealed');

      // The celebration + reveal-count RPC only apply to the LACMS
      // discounts page — mmg-hub.html's perk cards share this exact
      // button/markup via renderCodeReveal() too, but their row ids
      // belong to mmg_perks, not public.discounts, so calling the RPC
      // for them would just fail a foreign key check for no reason.
      var discountCard = revealBtn.closest('#discounts-list .discount-card');
      if (discountCard) {
        celebrateDiscountReveal(discountCard);
        var discountId = discountCard.getAttribute('data-discount-id');
        if (discountId && window.supabaseClient) {
          supabaseClient.rpc('record_discount_reveal', { p_discount_id: discountId }).then(function (result) {
            if (result.error) console.error('Recording discount reveal failed:', result.error.message);
          });
        }
      }
      return;
    }
    var copyBtn = e.target.closest('.discount-code-copy-btn');
    if (copyBtn) {
      var copyWrap = copyBtn.closest('.discount-code');
      var valueEl = copyWrap && copyWrap.querySelector('.discount-code-value');
      if (!valueEl || !navigator.clipboard) return;
      navigator.clipboard.writeText(valueEl.textContent).then(function () {
        var original = copyBtn.innerHTML;
        copyBtn.textContent = 'Copied!';
        setTimeout(function () { copyBtn.innerHTML = original; }, 1500);
      });
      return;
    }
    var usageBtn = e.target.closest('[data-discount-usage-btn]');
    if (usageBtn) {
      var usageDiscountId = usageBtn.getAttribute('data-discount-id');
      if (!usageDiscountId || !window.supabaseClient || usageBtn.disabled) return;

      // While this button reads "Undo", tapping it means exactly that -
      // covers both "realised the mistake a few seconds later" and "the
      // accidental tap right after the first one", which a plain
      // confirm-before-counting dialog wouldn't catch on its own.
      if (usageBtn.classList.contains('is-undo')) {
        usageBtn.disabled = true;
        supabaseClient.rpc('undo_discount_used', { p_discount_id: usageDiscountId }).then(function (result) {
          usageBtn.disabled = false;
          if (result.error) { console.error('Undoing discount usage failed:', result.error.message); return; }
          var row = (result.data && result.data[0]) || {};
          updateDiscountUsageLabel(usageBtn, row.used_count || 0);
          endDiscountUsageUndoWindow(usageBtn);
        });
        return;
      }

      usageBtn.disabled = true;
      supabaseClient.rpc('record_discount_used', { p_discount_id: usageDiscountId }).then(function (result) {
        usageBtn.disabled = false;
        if (result.error) { console.error('Marking discount as used failed:', result.error.message); return; }
        var row = (result.data && result.data[0]) || {};
        updateDiscountUsageLabel(usageBtn, row.used_count || 0);
        startDiscountUsageUndoWindow(usageBtn);
      });
    }
  });

  function updateDiscountUsageLabel(usageBtn, usedCount) {
    var wrap = usageBtn.closest('[data-discount-usage]');
    var labelEl = wrap && wrap.querySelector('[data-discount-usage-label]');
    if (labelEl) {
      labelEl.innerHTML = discountUsageLabelHtml(usedCount);
      labelEl.classList.toggle('is-used', usedCount > 0);
      labelEl.classList.remove('discount-usage-bump');
      void labelEl.offsetWidth; // restart the bump animation even on repeat clicks
      labelEl.classList.add('discount-usage-bump');
    }
  }

  // A brief, counted-down "Undo" window right after tapping "I used
  // this" - the fix for "tapped it by accident, no way back". Turns the
  // same button into "Undo (N)" for a few seconds rather than adding a
  // confirm() dialog in front of every tap, which would get in the way
  // of the common case (genuinely using a discount again) just to catch
  // the rare one. Reverts to the normal button on its own once the
  // window closes, so a real re-use later still works the same as always.
  var DISCOUNT_USAGE_UNDO_SECONDS = 8;
  function startDiscountUsageUndoWindow(usageBtn) {
    var secondsLeft = DISCOUNT_USAGE_UNDO_SECONDS;
    usageBtn.classList.add('is-undo');
    usageBtn.textContent = 'Undo (' + secondsLeft + ')';
    usageBtn._discountUndoTimer = setTimeout(function tick() {
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        endDiscountUsageUndoWindow(usageBtn);
        return;
      }
      usageBtn.textContent = 'Undo (' + secondsLeft + ')';
      usageBtn._discountUndoTimer = setTimeout(tick, 1000);
    }, 1000);
  }
  function endDiscountUsageUndoWindow(usageBtn) {
    clearTimeout(usageBtn._discountUndoTimer);
    usageBtn._discountUndoTimer = null;
    usageBtn.classList.remove('is-undo');
    usageBtn.textContent = 'I used this';
  }

  // MMG portal: makes sure a self-registered external guest ends up with a
  // row in mmg_guests. Called after both sign-up and sign-in, since with
  // email confirmation on, signUp() doesn't return a live session — the
  // row can only actually be created once they have one, i.e. on their
  // first real sign-in after confirming. full_name/university survive
  // that gap because signUp() stores them in the user's own metadata.
  // No-ops for full Lincoln members (they already have a members row).
  function ensureMmgGuestProfile(session) {
    return supabaseClient
      .from('members')
      .select('id')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(function (memberResult) {
        if (memberResult.data) return;
        return supabaseClient
          .from('mmg_guests')
          .select('id')
          .eq('id', session.user.id)
          .maybeSingle()
          .then(function (guestResult) {
            if (guestResult.data) return;
            var meta = session.user.user_metadata || {};
            return supabaseClient.from('mmg_guests').insert({
              id: session.user.id,
              full_name: meta.full_name || session.user.email,
              university: meta.university || 'Not specified',
              activated_at: new Date().toISOString()
            });
          });
      });
  }

  // ---- Site-wide: keep the "Member login" nav link in sync with whether
  // there's actually a signed-in session, on every single page (not just
  // the login/hub pages). Without this, the link's label and destination
  // were hardcoded per page, so a signed-in member browsing the rest of
  // the site would still see "Member login" everywhere — which looks
  // exactly like being logged out, even though the session was fine the
  // whole time.
  var memberNavLinks = document.querySelectorAll('[data-member-nav-link]');
  var hideWhenSignedInEls = document.querySelectorAll('[data-hide-when-signed-in]');
  var showWhenSignedInEls = document.querySelectorAll('[data-show-when-signed-in]');

  if (memberNavLinks.length || hideWhenSignedInEls.length || showWhenSignedInEls.length) {
    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      var loggedIn = !!session;

      memberNavLinks.forEach(function (el) {
        el.href = loggedIn ? 'member-hub.html' : 'login.html';
        el.classList.toggle('is-signed-in', loggedIn);
        setNavLinkText(el, loggedIn ? 'Members hub' : 'Member login', loggedIn);
      });

      // "Join the society" / "Become a member" buttons are redundant once
      // you're already a member — hide them rather than nag someone who's
      // signed in to join a society they're already part of.
      hideWhenSignedInEls.forEach(function (el) {
        el.style.display = loggedIn ? 'none' : '';
      });

      // "Log out" only makes sense once there's actually a session to end.
      showWhenSignedInEls.forEach(function (el) {
        el.style.display = loggedIn ? '' : 'none';
      });

      // "Apply to be a mentee or mentor" (programmes.html, sankofa.html)
      // now opens a choice modal instead of linking straight to
      // join.html: mentee applications still need LACMS membership (the
      // modal routes to member-sankofa.html if already signed in, or
      // join.html to become a member first, exactly as before), but
      // mentor applications are a genuinely public short form right
      // inside the modal — no account needed at all.
      initSankofaApplyModal(loggedIn);

      // Once we know they're signed in, upgrade the label to their first
      // name — a much more obvious "yes, still you, still logged in" cue
      // than a generic label that doesn't change between pages. Also
      // figure out which hub they actually belong to: a full LACMS member
      // goes to member-hub.html as before, but an MMG-only guest has no
      // row in `members` at all — sending them there would just hit a
      // "couldn't find your profile" error, so point them at their own
      // mmg-hub.html instead.
      if (loggedIn) {
        supabaseClient
          .from('members')
          .select('full_name')
          .eq('id', session.user.id)
          .maybeSingle()
          .then(function (memberResult) {
            if (memberResult.data && memberResult.data.full_name) {
              var firstName = memberResult.data.full_name.trim().split(' ')[0];
              memberNavLinks.forEach(function (el) {
                setNavLinkText(el, 'Hi, ' + firstName, true);
              });
              return;
            }
            supabaseClient
              .from('mmg_guests')
              .select('full_name')
              .eq('id', session.user.id)
              .maybeSingle()
              .then(function (guestResult) {
                var fullName = guestResult.data && guestResult.data.full_name;
                if (fullName) {
                  var firstName = fullName.trim().split(' ')[0];
                  memberNavLinks.forEach(function (el) {
                    el.href = 'mmg-hub.html';
                    setNavLinkText(el, 'Hi, ' + firstName, true);
                  });
                  return;
                }
                // Not a member, not an MMG guest — check whether they're a
                // signed-in professional instead (they belong on the
                // members hub too, just with a different profile there).
                getProfessionalRow(session).then(function (proRow) {
                  if (!proRow || !proRow.full_name) return;
                  memberNavLinks.forEach(function (el) {
                    setNavLinkText(el, 'Hi, ' + greetingName(proRow.full_name), true);
                  });
                });
              });
          });
      }
    });
  }

  // ---- Sankofa apply modal (sankofa.html, programmes.html) — asks
  // mentee or mentor first, since the two have completely different
  // requirements: a mentee needs LACMS membership, a mentor doesn't need
  // an account at all, just a short public form submitted straight into
  // sankofa_mentor_applications (migration 029). One shared modal, built
  // once per page and reused for every [data-sankofa-apply] trigger on
  // it (there are two: the programme card and the page's own CTA).
  function initSankofaApplyModal(loggedIn) {
    var triggers = document.querySelectorAll('[data-sankofa-apply]');
    if (!triggers.length) return;

    var modal = document.getElementById('sankofa-apply-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'sankofa-apply-modal';
      modal.className = 'sankofa-apply-modal';
      modal.innerHTML =
        '<div class="sankofa-apply-modal-backdrop" data-sankofa-apply-close></div>' +
        '<div class="sankofa-apply-modal-panel" role="dialog" aria-modal="true" aria-labelledby="sankofa-apply-modal-title">' +
        '<button type="button" class="sankofa-apply-modal-close" data-sankofa-apply-close aria-label="Close">' +
        '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>' +
        '</button>' +

        '<div data-sankofa-apply-step="choice">' +
        '<h2 id="sankofa-apply-modal-title" style="margin-top:0;">Apply to Sankofa</h2>' +
        '<p>Are you applying as a mentee or a mentor?</p>' +
        '<div class="sankofa-apply-choice-grid">' +
        '<button type="button" class="sankofa-apply-choice-btn" data-sankofa-apply-choice="mentee">' +
        '<strong>Mentee</strong><span>Medicine student - LACMS membership required</span>' +
        '</button>' +
        '<button type="button" class="sankofa-apply-choice-btn" data-sankofa-apply-choice="mentor">' +
        '<strong>Mentor</strong><span>Doctor or healthcare professional - no account needed</span>' +
        '</button>' +
        '</div></div>' +

        '<div data-sankofa-apply-step="mentee" style="display:none;">' +
        '<h2 style="margin-top:0;">Mentee applications</h2>' +
        '<p>Open to LACMS members - Medicine students. Applications close Sunday 11 October 2026.</p>' +
        '<a class="btn btn-primary btn-block" id="sankofa-apply-mentee-cta" href="join.html">Continue</a>' +
        '</div>' +

        '<div data-sankofa-apply-step="mentor" style="display:none;">' +
        '<h2 style="margin-top:0;">Apply to mentor</h2>' +
        '<p>Takes under a minute - no account needed, we\'ll reach out by email.</p>' +
        '<form id="sankofa-mentor-quick-form">' +
        '<div class="field"><label for="sqf-name">Full name</label><input type="text" id="sqf-name" autocomplete="name" required></div>' +
        '<div class="field"><label for="sqf-email">Email</label><input type="email" id="sqf-email" autocomplete="email" required></div>' +
        '<div class="field"><label for="sqf-title">Job title</label><input type="text" id="sqf-title" placeholder="e.g. Consultant Cardiologist, F1 Doctor, GP" required></div>' +
        '<div class="field"><label for="sqf-org">Organisation <span style="font-weight:400; color: var(--color-text-faint);">(optional)</span></label><input type="text" id="sqf-org" placeholder="e.g. Nottingham University Hospitals NHS Trust"></div>' +
        '<div class="field"><label for="sqf-linkedin">LinkedIn <span style="font-weight:400; color: var(--color-text-faint);">(optional)</span></label><input type="url" id="sqf-linkedin" placeholder="https://linkedin.com/in/…"></div>' +
        '<div class="field"><label for="sqf-offer">Why do you want to mentor, or what can you offer?</label><textarea id="sqf-offer" maxlength="600" placeholder="A sentence or two is plenty - specialty, what you could help with, why it matters to you." required></textarea></div>' +
        '<button type="submit" class="btn btn-primary btn-block">Submit application</button>' +
        '<p id="sqf-status" class="auth-error" role="status" style="display:none;"></p>' +
        '</form></div>' +

        '<div data-sankofa-apply-step="success" style="display:none;">' +
        '<h2 style="margin-top:0;">Thank you</h2>' +
        '<p>We\'ve received your mentor application - the committee will be in touch by email.</p>' +
        '<button type="button" class="btn btn-outline" data-sankofa-apply-close>Close</button>' +
        '</div>' +

        '</div>';
      document.body.appendChild(modal);

      function showStep(step) {
        modal.querySelectorAll('[data-sankofa-apply-step]').forEach(function (el) {
          el.style.display = el.getAttribute('data-sankofa-apply-step') === step ? '' : 'none';
        });
      }
      function openModal() {
        showStep('choice');
        modal.classList.add('is-open');
        document.body.classList.add('lightbox-open');
      }
      function closeModal() {
        modal.classList.remove('is-open');
        document.body.classList.remove('lightbox-open');
      }
      modal._sankofaOpen = openModal;

      modal.querySelectorAll('[data-sankofa-apply-close]').forEach(function (el) {
        el.addEventListener('click', closeModal);
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && modal.classList.contains('is-open')) closeModal();
      });
      modal.querySelectorAll('[data-sankofa-apply-choice]').forEach(function (btn) {
        btn.addEventListener('click', function () { showStep(btn.getAttribute('data-sankofa-apply-choice')); });
      });

      var mentorQuickForm = modal.querySelector('#sankofa-mentor-quick-form');
      mentorQuickForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var statusEl = modal.querySelector('#sqf-status');
        hideMessage(statusEl);

        var name = modal.querySelector('#sqf-name').value.trim();
        var email = modal.querySelector('#sqf-email').value.trim();
        var title = modal.querySelector('#sqf-title').value.trim();
        var org = modal.querySelector('#sqf-org').value.trim();
        var linkedin = modal.querySelector('#sqf-linkedin').value.trim();
        var offer = modal.querySelector('#sqf-offer').value.trim();

        if (!name || !email || !title || !offer) {
          showMessage(statusEl, 'Fill in the required fields before submitting.');
          return;
        }

        var btn = mentorQuickForm.querySelector('button[type="submit"]');
        btn.disabled = true;

        supabaseClient
          .from('sankofa_mentor_applications')
          .insert({
            full_name: name,
            email: email,
            job_title: title,
            organisation: org || null,
            linkedin_url: linkedin || null,
            offer_statement: offer
          })
          .then(function (result) {
            btn.disabled = false;
            if (result.error) {
              showMessage(statusEl, result.error.message || 'Something went wrong - try again, or email acms@lincolnsu.com.');
              return;
            }
            mentorQuickForm.reset();
            showStep('success');
          });
      });
    }

    // Mentee CTA routes the same way the old href-rewrite used to:
    // straight to the real form if already signed in (either account
    // type), otherwise to join.html to become a member first.
    var menteeCta = modal.querySelector('#sankofa-apply-mentee-cta');
    if (menteeCta) menteeCta.href = loggedIn ? 'member-sankofa.html' : 'join.html';

    triggers.forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        modal._sankofaOpen();
      });
    });
  }

  // ---- Site-wide: "Log out" buttons in the header and mobile drawer ----
  var signOutButtons = document.querySelectorAll('[data-signout-btn]');
  signOutButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      btn.disabled = true;
      supabaseClient.auth.signOut().then(function () {
        window.location.href = 'index.html';
      });
    });
  });

  // ---- Homepage: the "Discounts & Opportunities" impact card starts
  // locked (pointing at member-login.html) and only unlocks — new href,
  // "you have access" badge — for signed-in LACMS members. Signed out,
  // professionals and MMG guests all correctly stay on the locked
  // default. ----
  var perksImpactCard = document.getElementById('perks-impact-card');
  if (perksImpactCard) {
    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (!session) return;
      checkIsMember(session).then(function (isMember) {
        if (!isMember) return;
        perksImpactCard.href = 'member-perks.html';
        var badge = document.getElementById('perks-impact-badge');
        if (badge) {
          badge.className = 'impact-badge impact-badge--green';
          badge.innerHTML = '<span class="impact-badge-dot" aria-hidden="true"></span> You have access';
        }
      });
    });
  }

  // ---- Homepage: the "Discover the LACMS Network" impact card — starts
  // locked the same way, but unlocks for any confirmed LACMS member OR
  // professional, since the Network itself (unlike Perks) isn't
  // committee-only. ----
  var networkImpactCard = document.getElementById('network-impact-card');
  if (networkImpactCard) {
    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (!session) return;
      function unlockNetworkCard() {
        networkImpactCard.href = 'member-network.html';
        var badge = document.getElementById('network-impact-badge');
        if (badge) {
          badge.className = 'impact-badge impact-badge--green';
          badge.innerHTML = '<span class="impact-badge-dot" aria-hidden="true"></span> You have access';
        }
      }
      supabaseClient
        .from('members')
        .select('id')
        .eq('id', session.user.id)
        .maybeSingle()
        .then(function (memberResult) {
          if (memberResult.data) {
            unlockNetworkCard();
            return;
          }
          getProfessionalRow(session).then(function (proRow) {
            if (proRow) unlockNetworkCard();
          });
        });
    });
  }

  function setNavLinkText(el, text, signedIn) {
    var label = el.querySelector('[data-member-nav-label]');
    var target = label || el;
    target.innerHTML = signedIn
      ? '<span class="member-nav-dot" aria-hidden="true"></span>' + text
      : text;
  }

  // ---- Login page: sign-in form + first-time "set your password" form ----
  // Members arrive at the set-password form via the invite/reset/signup
  // email link Supabase sends. This site's own createImplicitFlowClient()
  // calls (see the top of this file) deliberately force the older,
  // self-contained link format — #access_token=...&type=invite (or
  // recovery, or signup) in the URL hash — over this project's own PKCE
  // default, since a PKCE link only ever redeems in the exact browser
  // that requested it, and every one of these links is opened by someone
  // other than (or some device other than) whoever requested it. type=
  // signup is the one Supabase's own signUp() confirmation link carries —
  // easy to miss since it's neither "invite" nor "recovery," but it's
  // exactly the case the dashboard's Create Account panel produces
  // whenever the project has "Confirm email" switched on, and it needs
  // the same "let them set a password" treatment as the other two, not
  // silently falling through to a plain "you're signed in" redirect that
  // leaves them stuck on a password they were never shown. The ?code=
  // check stays as a catch-all for anything that still arrives via the
  // project's PKCE default (this site has no other flow — no OAuth, no
  // magic links — that ever produces a `code` param, so treating its
  // mere presence as "set a password" is safe here).
  var loginForm = document.getElementById('login-form');
  var setPasswordForm = document.getElementById('set-password-form');

  if (loginForm || setPasswordForm) {
    var loginStatus = document.getElementById('login-status');
    var setPasswordStatus = document.getElementById('set-password-status');

    var hash = window.location.hash || '';
    var search = window.location.search || '';
    var isRecoveryFlow = hash.indexOf('type=invite') !== -1
      || hash.indexOf('type=recovery') !== -1
      || hash.indexOf('type=signup') !== -1
      || search.indexOf('type=invite') !== -1
      || search.indexOf('type=recovery') !== -1
      || search.indexOf('type=signup') !== -1
      || /[?&]code=/.test(search);

    var recoveryFormShown = false;
    function showSetPasswordForm() {
      if (recoveryFormShown || !setPasswordForm) return;
      recoveryFormShown = true;
      if (loginForm) loginForm.classList.remove('is-active');
      setPasswordForm.classList.add('is-active');
    }

    if (isRecoveryFlow && setPasswordForm) {
      showSetPasswordForm();
    } else if (loginForm) {
      loginForm.classList.add('is-active');
    }

    // Supabase's client library auto-detects the invite/recovery
    // token in the URL and can strip it (history.replaceState) before
    // this script's isRecoveryFlow check above even runs — a race that
    // let "forgot password" links silently sign someone in and skip
    // straight to the hub without ever asking for a new password.
    // onAuthStateChange's PASSWORD_RECOVERY event is Supabase's own
    // race-free signal for exactly this case, so it's the final say:
    // it can show the set-password form even if the URL check above
    // missed it, and the "already signed in, go straight to the hub"
    // redirect below only fires once we're sure this ISN'T that case.
    var initialAuthHandled = false;
    supabaseClient.auth.onAuthStateChange(function (event, session) {
      if (event === 'PASSWORD_RECOVERY') {
        initialAuthHandled = true;
        showSetPasswordForm();
        return;
      }
      if (initialAuthHandled || recoveryFormShown) return;
      initialAuthHandled = true;
      if (session && loginForm && !isRecoveryFlow) {
        window.location.href = 'member-hub.html';
      }
    });

    if (loginForm) {
      loginForm.addEventListener('submit', function (e) {
        e.preventDefault();
        hideMessage(loginStatus);
        var email = document.getElementById('login-email').value.trim();
        var password = document.getElementById('login-password').value;
        var btn = loginForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        supabaseClient.auth.signInWithPassword({ email: email, password: password })
          .then(function (result) {
            if (result.error) {
              showMessage(loginStatus, result.error.message);
              btn.disabled = false;
              return;
            }
            window.location.href = 'member-hub.html';
          });
      });
    }

    // "Forgot your password?" — swaps in a small email-only form that
    // triggers Supabase's own reset email. The link it sends back lands
    // on this exact page with type=recovery in the URL, which the
    // isRecoveryFlow check above already treats identically to a fresh
    // invite — same set-password form, same flow, no separate handling
    // needed for the reset case itself.
    var forgotPasswordForm = document.getElementById('forgot-password-form');
    var forgotPasswordToggle = document.getElementById('forgot-password-toggle');
    var forgotPasswordBack = document.getElementById('forgot-password-back');
    if (forgotPasswordForm && forgotPasswordToggle) {
      var forgotPasswordStatus = document.getElementById('forgot-password-status');

      forgotPasswordToggle.addEventListener('click', function () {
        if (loginForm) loginForm.classList.remove('is-active');
        forgotPasswordForm.classList.add('is-active');
      });
      if (forgotPasswordBack) {
        forgotPasswordBack.addEventListener('click', function () {
          forgotPasswordForm.classList.remove('is-active');
          if (loginForm) loginForm.classList.add('is-active');
        });
      }

      forgotPasswordForm.addEventListener('submit', function (e) {
        e.preventDefault();
        hideMessage(forgotPasswordStatus);
        var email = document.getElementById('forgot-password-email').value.trim();
        var btn = forgotPasswordForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        // createImplicitFlowClient(), not supabaseClient directly — this
        // link is very often opened on a different device than the one
        // that requested it (check email on a phone after asking for a
        // reset on a laptop), which the site's default PKCE flow can't
        // support at all.
        createImplicitFlowClient().auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname })
          .then(function (result) {
            btn.disabled = false;
            if (result.error) {
              showMessage(forgotPasswordStatus, result.error.message);
              return;
            }
            forgotPasswordStatus.className = 'auth-error';
            forgotPasswordStatus.style.color = '#6fcf97';
            forgotPasswordStatus.style.borderColor = 'rgba(111, 207, 151, 0.35)';
            forgotPasswordStatus.style.background = 'rgba(30, 122, 70, 0.1)';
            showMessage(forgotPasswordStatus, "Check your email for a reset link - it may take a minute to arrive.");
          });
      });
    }

    if (setPasswordForm) {
      setPasswordForm.addEventListener('submit', function (e) {
        e.preventDefault();
        hideMessage(setPasswordStatus);
        var password = document.getElementById('set-password-password').value;
        var confirmPassword = document.getElementById('set-password-confirm').value;

        if (password.length < 8) {
          showMessage(setPasswordStatus, 'Password must be at least 8 characters.');
          return;
        }
        if (password !== confirmPassword) {
          showMessage(setPasswordStatus, "Passwords don't match - try again.");
          return;
        }

        var btn = setPasswordForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        supabaseClient.auth.updateUser({ password: password })
          .then(function (result) {
            if (result.error) {
              showMessage(setPasswordStatus, result.error.message);
              btn.disabled = false;
              return;
            }
            // Marks this account "fully set up" for the president's
            // dashboard — awaited before navigating away so the request
            // isn't cut off mid-flight by the redirect.
            supabaseClient.rpc('mark_account_activated').then(function () {
              window.location.href = 'member-hub.html';
            });
          });
      });
    }
  }

  // ---- Member hub page: auth gate + profile + digital membership card ----
  var hubContent = document.getElementById('member-hub-content');
  if (hubContent) {
    var authGate = document.getElementById('auth-gate');
    var hubError = document.getElementById('hub-error');
    var hubSessionUserId = null;

    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (!session) {
        window.location.href = 'member-login.html';
        return;
      }
      hubSessionUserId = session.user.id;
      loadProfile(session);
      loadFeed();
      loadRecentJoins();

      // The dashboard quick-link card — hidden from everyone except the
      // president and Executive Committee members, not just styled as
      // locked. Matches the same two-role check the dashboard page
      // itself enforces for real (via is_president()/is_dashboard_admin()
      // in the RPCs behind it) — this is only ever the UX shortcut.
      var presidentCard = document.getElementById('president-dashboard-card');
      if (session.user.id === PRESIDENT_UID) {
        if (presidentCard) presidentCard.style.display = '';
      } else if (presidentCard) {
        // Anyone the Hub Access rules give at least one dashboard section
        // (by default: Executive Committee members). If the rules can't
        // be loaded, the original Executive-Committee-only check.
        getHubAccess().then(function (access) {
          if (access) {
            if (DASHBOARD_FEATURES.some(function (f) { return access[f] && access[f].allowed; })) presidentCard.style.display = '';
            return;
          }
          supabaseClient
            .from('members')
            .select('member_type')
            .eq('id', session.user.id)
            .maybeSingle()
            .then(function (memberResult) {
              if (memberResult.data && memberResult.data.member_type === 'executive_committee') {
                presidentCard.style.display = '';
              }
            });
        });
      }

    });

    var FEED_CATEGORY = {
      announcement: { label: 'Announcement', accent: 'gold' },
      news: { label: 'News', accent: 'purple' },
      update: { label: 'Update', accent: 'green' },
      urgent: { label: 'Urgent', accent: 'red' }
    };

    function loadFeed() {
      var feedList = document.getElementById('feed-list');
      if (!feedList) return;
      var feedSection = document.getElementById('member-feed-section');
      var feedEmpty = document.getElementById('feed-empty');

      getHubAccess().then(function (access) {
        // No access to the feed (Hub Access rules): leave the section
        // hidden rather than showing an empty "No news yet".
        if (!hubFeatureAllowed(access, 'news_feed', true)) return null;
        return supabaseClient
          .from('announcements')
          .select('*')
          .order('pinned', { ascending: false })
          .order('published_at', { ascending: false });
      }).then(function (result) {
          if (!result) return;
          if (feedSection) feedSection.style.display = '';
          var rows = result.data || [];
          if (!rows.length) {
            if (feedEmpty) feedEmpty.style.display = 'block';
            return;
          }
          feedList.innerHTML = rows.map(renderFeedItem).join('');
        });
    }

    function renderFeedItem(row) {
      var meta = FEED_CATEGORY[row.category] || FEED_CATEGORY.announcement;
      var pinHtml = row.pinned
        ? '<span class="feed-item-pin" title="Pinned"><svg class="icon" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2a1 1 0 0 1 1 1v6.5l3.4 3.9a1 1 0 0 1-.75 1.6H13v6a1 1 0 1 1-2 0v-6H6.35a1 1 0 0 1-.75-1.6L9 9.5V3a1 1 0 0 1 1-1h2Z"/></svg></span>'
        : '';
      var classes = 'feed-item feed-item--' + meta.accent + (row.pinned ? ' feed-item--pinned' : '');
      var fromHtml = row.posted_by
        ? '<p class="feed-item-from">- ' + escapeHtml(row.posted_by) + '</p>'
        : '';
      return '<article class="' + classes + '">' +
        '<div class="feed-item-meta">' + pinHtml + newBadgeHtml(row.published_at) +
        '<span class="feed-item-tag">' + escapeHtml(meta.label) + '</span>' +
        '<span class="feed-item-date">' + escapeHtml(timeAgo(row.published_at)) + '</span></div>' +
        '<h3 class="feed-item-title">' + escapeHtml(row.title) + '</h3>' +
        '<p class="feed-item-body">' + escapeHtml(row.body) + '</p>' +
        fromHtml +
        '</article>';
    }

    // A compact "N people just joined" banner, fed by network_join_events
    // (migration 020) — only surfaced here if someone's actually joined
    // recently, so it never sits around claiming to be "recent" forever.
    // 30 days rather than a tighter window — this is a small, pre-launch
    // society where new accounts get added in occasional bursts (a
    // committee session, not a steady daily trickle), so a short window
    // was going quiet between bursts and making the banner look broken
    // even though nothing was actually wrong.
    function loadRecentJoins() {
      var banner = document.getElementById('network-recent-joins');
      var bannerText = document.getElementById('network-recent-joins-text');
      if (!banner || !bannerText) return;

      var since = new Date();
      since.setDate(since.getDate() - 30);
      var sinceIso = since.toISOString();

      getHubAccess().then(function (access) {
        // Names of who joined the Network - only for people the Hub
        // Access rules let into the Network.
        if (!hubFeatureAllowed(access, 'network', true)) return null;
        return supabaseClient
          .from('network_join_events')
          .select('full_name, event_type')
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: false });
      }).then(function (result) {
          if (!result) return;
          // A failed query used to just render nothing here — no banner,
          // no error, indistinguishable from "no one's joined recently"
          // from the outside. Logging it means a real problem (RLS,
          // a renamed column, whatever) is at least visible in the
          // console instead of silently looking like the feature
          // vanished.
          if (result.error) {
            console.error('Recent joins banner failed to load:', result.error.message);
            return;
          }
          // Deduped first (see dedupeJoinEventsByName) so a re-added
          // account within the window can't inflate the count or push
          // a real second person out of the first three names shown.
          var deduped = dedupeJoinEventsByName(result.data || []);
          if (!deduped.length) return;

          // Only professionals are named here - students who joined are
          // folded into the "and N others" count instead (the Network
          // page's own ticker/history still lists everyone by name).
          var professionals = deduped.filter(function (r) { return r.event_type === 'professional'; });
          var shown = professionals.slice(0, 3);
          var names = shown.map(function (r) { return '<strong>' + escapeHtml(r.full_name) + '</strong>'; });
          var extra = deduped.length - names.length;
          var text;
          if (!names.length) {
            text = deduped.length + (deduped.length === 1 ? ' new member' : ' new members') + ' just joined the Network.';
          } else if (extra <= 0) {
            text = names.length === 1
              ? names[0] + ' just joined the Network.'
              : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] + ' just joined the Network.';
          } else {
            text = names.join(', ') + ' and ' + extra + (extra === 1 ? ' other' : ' others') + ' just joined the Network.';
          }
          bannerText.innerHTML = text;
          banner.style.display = 'flex';
        });
    }

    function loadProfile(session) {
      supabaseClient
        .from('members')
        .select('*')
        .eq('id', session.user.id)
        .single()
        .then(function (result) {
          if (result.data) {
            if (authGate) authGate.style.display = 'none';
            renderProfile(result.data, session);
            // Perks is open to every LACMS member now, not just
            // committee; Sankofa is Medicine-only — showHubContent reads
            // the row itself to work out which cards to show.
            showHubContent(result.data);
            return;
          }
          // No members row yet — they might be a member the committee
          // pre-added before they signed up (a pending_members row,
          // matched and claimed by email), or a professional. Try both
          // before giving up.
          supabaseClient.rpc('claim_member_profile').then(function (claimResult) {
            var claimedRow = claimResult.data && claimResult.data[0];
            if (claimedRow) {
              if (authGate) authGate.style.display = 'none';
              renderProfile(claimedRow, session);
              showHubContent(claimedRow);
              return;
            }
            loadProfessionalProfile(session);
          });
        });
    }

    // A signed-in user with no `members` row might be a professional
    // instead — e.g. a doctor or pharmacist the committee added to the
    // Network. claim_professional_profile() links their auth account to
    // the network_professionals row the committee already created for
    // them (matched by email) the first time they land here; it's a
    // no-op on every visit after that. Only if that finds nothing either
    // do we fall back to the original "not set up yet" error.
    function loadProfessionalProfile(session) {
      supabaseClient.rpc('claim_professional_profile').then(function () {
        getProfessionalRow(session).then(function (proRow) {
          if (authGate) authGate.style.display = 'none';
          if (!proRow) {
            showMessage(hubError, "We couldn't find your membership profile yet - the committee may still be setting it up. Email acms@lincolnsu.com if this doesn't resolve soon.");
            return;
          }
          renderProfessionalProfile(proRow, session);
          // Professionals have no members row, so no course to check —
          // every one of these cards stays locked/hidden for them.
          showHubContent(null);
        });
      });
    }

    // Shared by both profile types — reveals the hub content/links grid,
    // toggles the locked/live Perks card (open to any LACMS member),
    // and shows the Sankofa card only for Medicine members specifically
    // — not a locked/"coming soon" state, just not shown at all for
    // anyone else, since it's a real, live feature that simply isn't
    // for them rather than something not built yet. MoTM nomination is
    // open to every member and professional alike (not gated at all,
    // see motm.html's own nomination form), so its card always shows
    // unlocked here regardless. `member` is the signed-in member's own
    // row, or null for a professional (who gets every one of these
    // locked/hidden, same as before).
    function showHubContent(member) {
      getHubAccess().then(function (access) {
        hubContent.style.display = '';
        var linksSection = document.getElementById('member-hub-content-links');
        if (linksSection) linksSection.style.display = '';

        // Which cards someone sees comes from the Hub Access rules; if
        // those can't be loaded, the rules these cards used before.
        var isPresident = !!(hubSessionUserId && hubSessionUserId === PRESIDENT_UID);
        applyHubCard(access, 'perks', 'perks-card', 'perks-locked-card', !!member);
        applyHubCard(access, 'sankofa', 'sankofa-apply-card', null, !!(member && /medicine/i.test(member.course || '')));
        applyHubCard(access, 'network', 'network-card', 'network-locked-card', isPresident);
        applyHubCard(access, 'motm_nominate', 'motm-nominate-card', 'motm-locked-card', true);
      });
    }

    // Shows the live card when allowed; otherwise a locked "coming soon"
    // card or nothing, per the rule's "without access" setting (and only
    // where a locked variant of that card actually exists).
    function applyHubCard(access, feature, liveId, lockedId, fallbackAllowed) {
      var allowed = hubFeatureAllowed(access, feature, fallbackAllowed);
      var display = access && access[feature] ? access[feature].blockedDisplay : 'locked';
      var live = document.getElementById(liveId);
      var locked = lockedId ? document.getElementById(lockedId) : null;
      if (live) live.style.display = allowed ? '' : 'none';
      if (locked) locked.style.display = (!allowed && display === 'locked') ? '' : 'none';
    }

    function togglePair(liveId, lockedId, isCommittee) {
      var live = document.getElementById(liveId);
      var locked = document.getElementById(lockedId);
      if (live) live.style.display = isCommittee ? '' : 'none';
      if (locked) locked.style.display = isCommittee ? 'none' : '';
    }

    function renderProfile(member, session) {
      checkTermsGate(member);
      renderMemberCardFields(member);
      var courseYear = [member.course, member.year_of_study].filter(Boolean).join(' · ');
      var typeLabel = MEMBER_TYPE_LABELS[member.member_type] || MEMBER_TYPE_LABELS.member;

      setText('member-course-year-2', courseYear);
      setText('member-number-2', member.membership_number);
      setText('member-email', session.user.email);
      setText('member-type-2', typeLabel);

      // committee_role (e.g. "President") is optional free text — only
      // show it in the details list when it's set (the card's own copy
      // is handled by renderMemberCardFields above).
      var roleRow = document.getElementById('member-role-row');
      if (member.committee_role) {
        if (roleRow) {
          roleRow.style.display = '';
          setText('member-role-2', member.committee_role);
        }
      } else if (roleRow) {
        roleRow.style.display = 'none';
      }

      document.querySelectorAll('[data-member-name-inline]').forEach(function (el) {
        el.textContent = member.full_name;
      });

      // Being a LACMS member doesn't automatically mean being an MMG
      // attendee — only show the MMG section (and the right feed inside
      // it) once the committee has actually flagged this member.
      if (member.mmg_attendee || member.mmg_committee) {
        var mmgSection = document.getElementById('member-hub-mmg-section');
        if (mmgSection) mmgSection.style.display = '';
        loadMmgFeed('mmg_attendee_updates', 'member-hub-mmg-updates-list', 'member-hub-mmg-updates-empty', 'MMG update', 'gold');
      }
      if (member.mmg_committee) {
        var mmgCommitteeSection = document.getElementById('member-hub-mmg-committee-section');
        if (mmgCommitteeSection) mmgCommitteeSection.style.display = '';
        loadMmgFeed('mmg_updates', 'member-hub-mmg-committee-list', 'member-hub-mmg-committee-empty', 'Planning update', 'purple');
      }
    }

    // ---- One-time terms-of-use gate (migration 047) — blocks the hub
    // behind a modal, no close button and no backdrop-dismiss, until a
    // member explicitly agrees. Checked here rather than once at
    // sign-in, since terms_accepted_at applies to every member row, not
    // just ones created via the new account-request flow - an existing
    // member logging in for the first time after this shipped needs to
    // see it too, exactly as if their account were brand new. Built
    // once, reused on every subsequent load (same pattern as the
    // account-edit modal on the dashboard). ----
    function buildTermsGateModal() {
      if (document.getElementById('terms-gate-modal')) return;
      var modal = document.createElement('div');
      modal.id = 'terms-gate-modal';
      modal.className = 'network-modal';
      modal.style.display = 'none';
      modal.innerHTML =
        '<div class="network-modal-backdrop"></div>' +
        '<div class="network-modal-panel">' +
        '<h2 style="margin-top:0;">Welcome to LACMS</h2>' +
        '<p style="color: var(--color-text-muted); line-height: 1.6;">Before you carry on, here\'s how we use your information - we think it\'s only fair you know, and agree to it, before you use the hub.</p>' +
        '<p style="color: var(--color-text-muted); line-height: 1.6;">LACMS uses the details in your profile - your name, course, year of study, and how you use this platform - to actually run the society for you: matching Sankofa mentors and mentees, sharing discounts, opportunities and events relevant to you, keeping your digital membership card and place in the Network working, and letting the committee reach you when it matters. We don\'t sell it, and we don\'t share it with anyone outside LACMS and the University of Lincoln Students\' Union. It\'s used to support your membership - nothing else.</p>' +
        '<label class="checkbox-option" style="margin: var(--space-4) 0;"><input type="checkbox" id="terms-gate-checkbox"> I understand and agree to how my information is used, as described above.</label>' +
        '<button type="button" class="btn btn-primary btn-block" id="terms-gate-accept-btn" disabled>I agree &amp; continue</button>' +
        '<p id="terms-gate-status" class="auth-error" role="status" style="display:none; margin-top: var(--space-3);"></p>' +
        '<p style="margin-top: var(--space-4); margin-bottom: 0; text-align: center;"><button type="button" class="link-button" id="terms-gate-decline-btn" style="color: var(--color-text-faint); font-size: 0.85rem;">I don\'t agree - sign me out</button></p>' +
        '</div>';
      document.body.appendChild(modal);

      var checkbox = document.getElementById('terms-gate-checkbox');
      var acceptBtn = document.getElementById('terms-gate-accept-btn');
      checkbox.addEventListener('change', function () { acceptBtn.disabled = !checkbox.checked; });

      acceptBtn.addEventListener('click', function () {
        var statusEl = document.getElementById('terms-gate-status');
        hideMessage(statusEl);
        acceptBtn.disabled = true;
        acceptBtn.textContent = 'Saving…';
        supabaseClient.rpc('accept_terms').then(function (result) {
          if (result.error) {
            acceptBtn.disabled = false;
            acceptBtn.textContent = 'I agree & continue';
            showMessage(statusEl, "Couldn't save that - try again, or email acms@lincolnsu.com if it keeps happening.");
            return;
          }
          modal.style.display = 'none';
        });
      });

      document.getElementById('terms-gate-decline-btn').addEventListener('click', function () {
        supabaseClient.auth.signOut().then(function () {
          window.location.href = 'member-login.html';
        });
      });
    }

    function checkTermsGate(member) {
      if (member.terms_accepted_at) return;
      buildTermsGateModal();
      document.getElementById('terms-gate-modal').style.display = 'flex';
    }

    // Professionals get their own card/details variant — title and
    // organisation instead of course/year and membership number, since
    // those fields don't mean anything for a doctor or pharmacist. The
    // shared actions below (Network, edit profile, change password, log
    // out) work exactly the same for both, so those markup blocks aren't
    // duplicated.
    function renderProfessionalProfile(pro, session) {
      var categoryLabel = PROFESSIONAL_CATEGORY_LABELS[pro.category] || PROFESSIONAL_CATEGORY_LABELS.other;

      setText('professional-full-name', pro.full_name);
      setText('professional-title', pro.title);
      setText('professional-organisation', pro.organisation);
      setText('professional-email', session.user.email);
      setText('professional-category-badge', categoryLabel);
      setText('professional-category-2', categoryLabel);
      setText('professional-title-2', pro.title);
      setText('professional-organisation-2', pro.organisation);

      document.querySelectorAll('[data-member-name-inline]').forEach(function (el) {
        el.textContent = pro.full_name;
      });

      var memberCard = document.getElementById('member-card-member');
      var proCard = document.getElementById('member-card-professional');
      if (memberCard) memberCard.style.display = 'none';
      if (proCard) proCard.style.display = '';

      var memberDetails = document.getElementById('member-details-member');
      var proDetails = document.getElementById('member-details-professional');
      if (memberDetails) memberDetails.style.display = 'none';
      if (proDetails) proDetails.style.display = '';
    }

    var logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        supabaseClient.auth.signOut().then(function () {
          window.location.href = 'member-login.html';
        });
      });
    }

    var networkProfileToggle = document.getElementById('network-profile-toggle');
    var networkProfileForm = document.getElementById('network-profile-form');
    if (networkProfileToggle && networkProfileForm) {
      var networkProfileLoaded = false;

      networkProfileToggle.addEventListener('click', function () {
        var isOpen = networkProfileForm.style.display !== 'none';
        networkProfileForm.style.display = isOpen ? 'none' : 'block';
        if (!isOpen && !networkProfileLoaded) {
          networkProfileLoaded = true;
          supabaseClient.auth.getSession().then(function (result) {
            var session = result.data && result.data.session;
            if (!session) return;
            // A professional's LinkedIn/bio lives on their own
            // network_professionals row, not member_profiles.
            getProfessionalRow(session).then(function (proRow) {
              if (proRow) {
                document.getElementById('network-linkedin').value = proRow.linkedin_url || '';
                document.getElementById('network-bio').value = proRow.bio || '';
                return;
              }
              supabaseClient
                .from('member_profiles')
                .select('linkedin_url, bio')
                .eq('id', session.user.id)
                .maybeSingle()
                .then(function (profileResult) {
                  if (!profileResult.data) return;
                  document.getElementById('network-linkedin').value = profileResult.data.linkedin_url || '';
                  document.getElementById('network-bio').value = profileResult.data.bio || '';
                });
            });
          });
        }
      });

      networkProfileForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var statusEl = document.getElementById('network-profile-status');
        hideMessage(statusEl);
        var linkedinUrl = document.getElementById('network-linkedin').value.trim();
        var bio = document.getElementById('network-bio').value.trim();

        supabaseClient.auth.getSession().then(function (result) {
          var session = result.data && result.data.session;
          if (!session) return;

          var btn = networkProfileForm.querySelector('button[type="submit"]');
          btn.disabled = true;

          // A professional's LinkedIn/bio lives on their own
          // network_professionals row — updated through a narrow RPC
          // rather than a direct table update, so they can only ever
          // touch those two fields, not their committee-set title,
          // category or is_active.
          getProfessionalRow(session).then(function (proRow) {
            var savePromise = proRow
              ? supabaseClient.rpc('update_professional_profile', {
                  p_linkedin_url: linkedinUrl || null,
                  p_bio: bio || null
                })
              : supabaseClient.from('member_profiles').upsert({
                  id: session.user.id,
                  linkedin_url: linkedinUrl || null,
                  bio: bio || null,
                  updated_at: new Date().toISOString()
                });

            savePromise.then(function (saveResult) {
              btn.disabled = false;
              if (saveResult.error) {
                showMessage(statusEl, saveResult.error.message);
                return;
              }
              statusEl.style.color = 'var(--color-gold-light)';
              showMessage(statusEl, 'Saved - this is what other members see on your Network card.');
            });
          });
        });
      });
    }

    var changePasswordToggle = document.getElementById('change-password-toggle');
    var changePasswordForm = document.getElementById('change-password-form');
    if (changePasswordToggle && changePasswordForm) {
      changePasswordToggle.addEventListener('click', function () {
        var isOpen = changePasswordForm.style.display !== 'none';
        changePasswordForm.style.display = isOpen ? 'none' : 'block';
      });

      changePasswordForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var statusEl = document.getElementById('change-password-status');
        hideMessage(statusEl);
        var password = document.getElementById('new-password').value;
        var confirmPassword = document.getElementById('new-password-confirm').value;

        if (password.length < 8) {
          showMessage(statusEl, 'Password must be at least 8 characters.');
          return;
        }
        if (password !== confirmPassword) {
          showMessage(statusEl, "Passwords don't match - try again.");
          return;
        }

        var btn = changePasswordForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        supabaseClient.auth.updateUser({ password: password }).then(function (result) {
          btn.disabled = false;
          if (result.error) {
            showMessage(statusEl, result.error.message);
            return;
          }
          changePasswordForm.reset();
          statusEl.className = 'auth-error';
          statusEl.style.color = '#6fcf97';
          statusEl.style.borderColor = 'rgba(111, 207, 151, 0.35)';
          statusEl.style.background = 'rgba(30, 122, 70, 0.1)';
          showMessage(statusEl, 'Password updated.');
        });
      });
    }
  }

  // ---- Members Perks page: discounts + members-first opportunities ----
  var perksContent = document.getElementById('member-perks-content');
  if (perksContent) {
    var perksAuthGate = document.getElementById('auth-gate');
    var perksLocked = document.getElementById('perks-locked');
    var isPresidentViewer = false;

    // Reposition button icon (feather "move") / its "Done" state (a
    // checkmark) - swapped via innerHTML rather than keeping two hidden
    // SVGs around, since only one is ever shown at a time.
    var REPOSITION_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>';
    var REPOSITION_DONE_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    // At most one card is ever being repositioned at a time; both reset
    // to null whenever loadPerks() re-renders the list from scratch, so
    // stale references never point at detached DOM nodes.
    var repositioningCard = null;
    var repositionDrag = null;

    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (!session) {
        window.location.href = 'member-login.html';
        return;
      }
      isPresidentViewer = session.user.id === PRESIDENT_UID;
      Promise.all([checkIsMember(session), getHubAccess()]).then(function (gate) {
        var isMember = gate[0];
        if (!hubFeatureAllowed(gate[1], 'perks', isMember)) {
          if (perksAuthGate) perksAuthGate.style.display = 'none';
          if (perksLocked) perksLocked.style.display = 'flex';
          return;
        }
        // The member's own digital card at the top of the page — same
        // card as member-hub.html (renderMemberCardFields), just this
        // page's own copy of the markup. checkIsMember above only
        // selected id, so this fetches the full row; a members row is
        // guaranteed to exist by this point (that's what checkIsMember
        // just confirmed), never a professional.
        supabaseClient.from('members').select('*').eq('id', session.user.id).maybeSingle().then(function (result) {
          if (result.data) renderMemberCardFields(result.data);
        });
        loadPerks();
      });
    });

    function loadPerks() {
      repositioningCard = null;
      repositionDrag = null;
      var monthLabel = document.getElementById('discounts-month-label');
      if (monthLabel) monthLabel.textContent = new Date().toLocaleDateString('en-GB', { month: 'long' }) + "'s";

      Promise.all([
        supabaseClient.from('discounts').select('*').order('sort_order', { ascending: true }),
        supabaseClient.from('member_opportunities').select('*').order('sort_order', { ascending: true }),
        // The signed-in member's own reveal/used counters (migration
        // 042) — RLS only ever returns their own rows, so this is safe
        // to fetch unfiltered; folded into each discount card below so
        // "Used 3 times" survives a reload instead of resetting to zero.
        supabaseClient.from('discount_usage').select('discount_id, reveal_count, used_count')
      ]).then(function (results) {
        if (perksAuthGate) perksAuthGate.style.display = 'none';
        perksContent.style.display = '';

        var usageByDiscountId = {};
        (results[2].data || []).forEach(function (u) {
          usageByDiscountId[u.discount_id] = u;
        });
        if (results[2].error) console.error('Loading discount usage failed:', results[2].error.message);

        // Shuffled fresh on every load (not just once per session) so
        // the same handful of partners at the top doesn't quietly become
        // the only ones anyone actually scrolls to - sort_order above
        // still matters for literally everything else that reads this
        // table (the dashboard, Table Editor), this only reorders the
        // member-facing list itself.
        var discounts = shuffleArray(results[0].data || []);
        renderPerkList(discounts, document.getElementById('discounts-list'), document.getElementById('discounts-empty'), function (row) {
          return renderDiscountCard(row, usageByDiscountId[row.id], isPresidentViewer);
        });
        var countLine = document.getElementById('discounts-count-line');
        if (countLine) countLine.textContent = discounts.length ? (discounts.length === 1 ? '1 partner live right now' : discounts.length + ' partners live right now') : '';

        renderOpportunitiesTeaser(results[1].data || []);
      });
    }

    function renderPerkList(rows, listEl, emptyEl, cardFn) {
      if (!listEl) return;
      rows = rows || [];
      if (!rows.length) {
        if (emptyEl) emptyEl.style.display = 'block';
        return;
      }
      listEl.innerHTML = rows.map(cardFn).join('');
    }

    // Members-first opportunities get a "coming soon" tease rather than
    // being shown in full — real titles/descriptions still render (so
    // there's something genuine behind the blur, not placeholder text),
    // just behind the same blur + gradient + floating-card treatment
    // opportunities.html already uses for its own signed-out preview.
    function renderOpportunitiesTeaser(rows) {
      var wrap = document.getElementById('member-opportunities-wrap');
      var listEl = document.getElementById('member-opportunities-list');
      var emptyEl = document.getElementById('member-opportunities-empty');
      if (!wrap || !listEl) return;
      if (!rows.length) {
        wrap.style.display = 'none';
        if (emptyEl) emptyEl.style.display = 'block';
        return;
      }
      if (emptyEl) emptyEl.style.display = 'none';
      listEl.innerHTML = rows.map(renderOpportunityCard).join('');
      wrap.style.display = '';
    }

    function cardLink(url, label) {
      var safe = safeUrl(url);
      if (!safe) return '';
      return '<a class="card-link" href="' + safe + '" target="_blank" rel="noopener">' + label +
        '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></a>';
    }

    function renderDiscountCard(row, usage, isPresidentViewer) {
      usage = usage || { reveal_count: 0, used_count: 0 };
      var initial = escapeHtml((row.partner_name || '?').trim().charAt(0).toUpperCase());
      var isLounge11 = /lounge\s*11/i.test(row.partner_name || '');
      var imageUrl = safeUrl(row.image_url);
      // Validated strictly (NN% NN%) before going into an inline style
      // attribute - image_position is free text in the database, and
      // while only the president can write it (migration 044's RPC
      // already validates server-side), this is cheap insurance against
      // a malformed/stale value breaking the attribute on render.
      var imagePos = (row.image_position && /^\d{1,3}% \d{1,3}%$/.test(row.image_position)) ? row.image_position : '50% 50%';
      var cardClass = 'card discount-card' +
        (isLounge11 ? ' discount-card--pink' : '') +
        (imageUrl ? ' discount-card--has-image' : '');
      var styleAttr = imageUrl ? ' style="--card-bg-image: url(\'' + escapeHtml(imageUrl) + '\'); --card-bg-pos: ' + imagePos + ';"' : '';

      var isNew = row.created_at && (Date.now() - new Date(row.created_at).getTime()) < 14 * 24 * 60 * 60 * 1000;
      var topHtml = '<div class="discount-card-top"><span class="discount-card-badge" aria-hidden="true">' + initial + '</span>' +
        (isNew ? '<span class="new-badge">New</span>' : '') + '</div>';

      // President-only — a small corner control to upload a photo for
      // this specific card directly, as an alternative to pasting an
      // image URL into Table Editor (migration 042). Fixed dark/white
      // styling rather than theme tokens, deliberately: this sits on
      // top of six different card colours in both themes, and needs to
      // stay legible against all of them rather than needing a separate
      // override for every combination (same reasoning as the on-photo
      // controls elsewhere on the site, e.g. the committee card toggle).
      // Reposition toggle (migration 044) only makes sense once a card
      // already has a photo to drag around - rendered next to the
      // upload button, not instead of it, since re-uploading is still
      // how the president replaces the photo itself.
      var repositionHtml = isPresidentViewer && imageUrl
        ? '<button type="button" class="discount-image-reposition-btn" data-discount-reposition-btn data-discount-id="' + escapeHtml(row.id) + '" title="Reposition photo (president only)">' +
          REPOSITION_ICON_SVG +
          '</button>'
        : '';
      var uploadHtml = isPresidentViewer
        ? repositionHtml +
          '<label class="discount-image-upload-btn" title="Upload a photo for this card (president only)">' +
          '<input type="file" accept="image/*" data-discount-image-input data-discount-id="' + escapeHtml(row.id) + '">' +
          '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z"/><circle cx="12" cy="13" r="4"/></svg>' +
          '</label>' +
          '<span class="discount-image-upload-status" data-discount-image-status></span>'
        : '';

      var addressHtml = row.address
        ? '<p class="discount-address"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.6"/></svg><span>' + escapeHtml(row.address) + '</span></p>'
        : '';
      var codeHtml = renderCodeReveal(row.code);
      var usageHtml = row.code
        ? '<div class="discount-usage" data-discount-usage>' +
          '<span class="discount-usage-label' + (usage.used_count > 0 ? ' is-used' : '') + '" data-discount-usage-label>' + discountUsageLabelHtml(usage.used_count || 0) + '</span>' +
          '<button type="button" class="discount-usage-btn" data-discount-usage-btn data-discount-id="' + escapeHtml(row.id) + '">I used this</button>' +
          '</div>'
        : '';

      // Collapsed by default (just this button's own content - badge,
      // name, chevron) until tapped — reuses the site's reveal-panel
      // toggle pattern (css/styles.css's "Expandable reveal panels"),
      // wired up by the delegated click listener below rather than
      // js/main.js's generic version of it, since this card doesn't
      // exist yet when that one runs.
      var toggleHtml = '<button type="button" class="discount-card-toggle" data-expand-btn aria-expanded="false" aria-label="Show details for ' + escapeHtml(row.partner_name) + '">' +
        topHtml +
        '<div class="discount-card-title-row"><h3 class="card-title">' + escapeHtml(row.partner_name) + '</h3>' +
        '<svg class="discount-card-chevron icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></div>' +
        '</button>';
      var detailsHtml = '<div class="reveal-panel"><div class="reveal-panel-inner"><div class="reveal-panel-content">' +
        addressHtml +
        '<div class="discount-description">' + renderRichText(row.description) + '</div>' +
        codeHtml + usageHtml + cardLink(row.link, 'Visit partner') +
        '</div></div></div>';

      return '<div class="' + cardClass + '" data-expand-row' + styleAttr + ' data-discount-id="' + escapeHtml(row.id) + '">' +
        uploadHtml + toggleHtml + detailsHtml + '</div>';
    }

    function renderOpportunityCard(row) {
      var tagHtml = row.category ? '<span class="card-tag">' + escapeHtml(row.category) + '</span>' : '';
      return '<div class="card">' + tagHtml + '<h3 class="card-title"' + (row.category ? ' style="margin-top: var(--space-2);"' : '') + '>' + escapeHtml(row.title) + '</h3>' +
        '<div class="discount-description">' + renderRichText(row.description) + '</div>' + cardLink(row.link, 'Learn more') + '</div>';
    }

    // President-only discount photo upload — straight to Storage, then
    // one tightly-scoped RPC (president_set_discount_image, migration
    // 043) writes just the image_url column, never anything else on the
    // row. Delegated 'change' listener since every card (and its file
    // input) is only ever inserted after this script has already run.
    var MAX_DISCOUNT_IMAGE_BYTES = 8 * 1024 * 1024;
    document.addEventListener('change', function (e) {
      var input = e.target.closest('[data-discount-image-input]');
      if (!input || !perksContent || !perksContent.contains(input)) return;
      var file = input.files && input.files[0];
      if (!file) return;
      var discountId = input.getAttribute('data-discount-id');
      var statusEl = input.closest('.discount-card').querySelector('[data-discount-image-status]');

      function setStatus(text, cls) {
        if (!statusEl) return;
        statusEl.textContent = text;
        statusEl.className = 'discount-image-upload-status is-visible' + (cls ? ' ' + cls : '');
      }

      if (!/^image\//.test(file.type)) {
        setStatus('Please choose an image file.', 'is-error');
        input.value = '';
        return;
      }
      if (file.size > MAX_DISCOUNT_IMAGE_BYTES) {
        setStatus('Image is too large (max 8MB).', 'is-error');
        input.value = '';
        return;
      }

      setStatus('Uploading…');
      supabaseClient.storage
        .from('discount-images')
        .upload(discountId, file, { upsert: true, contentType: file.type, cacheControl: '3600' })
        .then(function (uploadResult) {
          if (uploadResult.error) {
            setStatus("Couldn't upload: " + uploadResult.error.message, 'is-error');
            return null;
          }
          var publicUrlResult = supabaseClient.storage.from('discount-images').getPublicUrl(discountId);
          var publicUrl = publicUrlResult.data && publicUrlResult.data.publicUrl;
          // Cache-busted so the new photo shows immediately even if the
          // old one at this same path was already cached by the browser.
          var bustedUrl = publicUrl ? publicUrl + '?v=' + Date.now() : null;
          return supabaseClient.rpc('president_set_discount_image', { p_discount_id: discountId, p_image_url: bustedUrl });
        })
        .then(function (rpcResult) {
          if (!rpcResult) return; // the upload itself already failed and reported its own error above
          if (rpcResult.error) {
            setStatus("Couldn't save: " + rpcResult.error.message, 'is-error');
            return;
          }
          setStatus('Photo updated', 'is-success');
          input.value = '';
          setTimeout(loadPerks, 700); // re-render so the card picks up its new photo properly
        });
    });

    // President-only photo repositioning (migration 044) — drag anywhere
    // on a has-image card, while its reposition button is toggled on, to
    // pan the photo; the button becomes "Done" and saves the final
    // position via president_set_discount_image_position. Pixel deltas
    // are converted to background-position percent as a simple fraction
    // of the card's own box — not a strict inverse of how `cover`
    // actually overflows the image, but close enough to feel direct
    // without needing the image's natural dimensions.
    function clampPercent(n) { return Math.min(100, Math.max(0, n)); }

    function parseCardBgPos(cardEl) {
      var raw = (cardEl.style.getPropertyValue('--card-bg-pos') || '50% 50%').trim();
      var m = raw.match(/^(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
      return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 50, y: 50 };
    }

    function exitRepositionMode(cardEl) {
      if (!cardEl) return;
      cardEl.classList.remove('is-repositioning', 'is-dragging');
      var btn = cardEl.querySelector('[data-discount-reposition-btn]');
      if (btn) {
        btn.innerHTML = REPOSITION_ICON_SVG;
        btn.title = 'Reposition photo (president only)';
        btn.classList.remove('is-active');
      }
      if (repositioningCard === cardEl) repositioningCard = null;
      repositionDrag = null;
    }

    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-discount-reposition-btn]');
      if (!btn || !perksContent || !perksContent.contains(btn)) return;
      e.preventDefault();
      var cardEl = btn.closest('.discount-card');
      var discountId = btn.getAttribute('data-discount-id');
      var statusEl = cardEl.querySelector('[data-discount-image-status]');

      if (cardEl.classList.contains('is-repositioning')) {
        var pos = parseCardBgPos(cardEl);
        var posStr = Math.round(pos.x) + '% ' + Math.round(pos.y) + '%';
        exitRepositionMode(cardEl);
        if (statusEl) {
          statusEl.textContent = 'Saving position…';
          statusEl.className = 'discount-image-upload-status is-visible';
        }
        supabaseClient.rpc('president_set_discount_image_position', { p_discount_id: discountId, p_position: posStr }).then(function (result) {
          if (!statusEl) return;
          if (result.error) {
            statusEl.textContent = "Couldn't save position: " + result.error.message;
            statusEl.className = 'discount-image-upload-status is-visible is-error';
            return;
          }
          statusEl.textContent = 'Position saved';
          statusEl.className = 'discount-image-upload-status is-visible is-success';
          setTimeout(function () { statusEl.className = 'discount-image-upload-status'; }, 2000);
        });
        return;
      }

      // Only one card can be in reposition mode at a time — starting on
      // another cancels the first (without saving whatever it's mid-drag).
      if (repositioningCard && repositioningCard !== cardEl) exitRepositionMode(repositioningCard);
      repositioningCard = cardEl;
      cardEl.classList.add('is-repositioning');
      btn.innerHTML = REPOSITION_DONE_ICON_SVG;
      btn.title = 'Save this position';
      btn.classList.add('is-active');
      if (statusEl) {
        statusEl.textContent = 'Drag the photo, then tap the check to save';
        statusEl.className = 'discount-image-upload-status is-visible';
      }
    });

    document.addEventListener('pointerdown', function (e) {
      var cardEl = e.target.closest('.discount-card.is-repositioning');
      if (!cardEl || !perksContent || !perksContent.contains(cardEl)) return;
      if (e.target.closest('a, button, input, label')) return; // let normal controls work even mid-reposition
      e.preventDefault();
      var pos = parseCardBgPos(cardEl);
      var rect = cardEl.getBoundingClientRect();
      repositionDrag = { cardEl: cardEl, startX: e.clientX, startY: e.clientY, x: pos.x, y: pos.y, width: rect.width, height: rect.height };
      cardEl.classList.add('is-dragging');
      if (cardEl.setPointerCapture) cardEl.setPointerCapture(e.pointerId);
    });

    document.addEventListener('pointermove', function (e) {
      if (!repositionDrag) return;
      var dx = e.clientX - repositionDrag.startX;
      var dy = e.clientY - repositionDrag.startY;
      // Dragging the photo right/down should reveal more of its
      // left/top (like panning a map with a hand tool), which means the
      // background-position percentage moves the opposite way.
      var xPct = clampPercent(repositionDrag.x - (dx / repositionDrag.width) * 100);
      var yPct = clampPercent(repositionDrag.y - (dy / repositionDrag.height) * 100);
      repositionDrag.cardEl.style.setProperty('--card-bg-pos', xPct.toFixed(1) + '% ' + yPct.toFixed(1) + '%');
    });

    function endRepositionDrag() {
      if (!repositionDrag) return;
      repositionDrag.cardEl.classList.remove('is-dragging');
      repositionDrag = null;
    }
    document.addEventListener('pointerup', endRepositionDrag);
    document.addEventListener('pointercancel', endRepositionDrag);

    // Collapsed-by-default discount cards — same [data-expand-row]/
    // [data-expand-btn]/is-expanded pattern as committee bios and event
    // rows (see css/styles.css's "Expandable reveal panels"), just
    // wired up locally: js/main.js's own generic version of this only
    // runs once at page load, long before these cards exist (they're
    // rendered after the discounts fetch resolves), so it would never
    // find them. Ignores clicks on a real link, and on anything other
    // than the toggle button itself while the card is mid-reposition-
    // drag, so the upload/reposition/code/usage/link controls all keep
    // working normally instead of also toggling the card.
    document.addEventListener('click', function (e) {
      var row = e.target.closest('[data-expand-row]');
      if (!row || !perksContent || !perksContent.contains(row)) return;
      if (row.classList.contains('is-repositioning')) return;
      var expandBtn = e.target.closest('[data-expand-btn]');
      if (!expandBtn && e.target.closest('a, button, input, label')) return;
      var open = row.classList.toggle('is-expanded');
      var btn = expandBtn || row.querySelector('[data-expand-btn]');
      if (btn) btn.setAttribute('aria-expanded', String(open));
    });
  }

  // ---- Opportunities page: public preview, gated. Signed-out visitors
  // (and MMG-only guests) see the first couple of rows, with the rest
  // rendered behind a blurred gradient and a "sign in" card. Any signed-
  // in LACMS member sees the full list. Same member_opportunities table
  // as the members hub's "Members-first opportunities" section — one
  // source of truth, just shown differently depending on who's looking.
  //
  // "Learn more" here is a deliberate gate, not a real external link
  // (that's what member-perks.html's own "Members-first opportunities"
  // section, and renderOpportunityCard below, are for): signed out, it
  // sends someone to log in first; signed in, the detailed view this
  // button will eventually open isn't built yet, so it says so plainly
  // instead of linking to nothing (or to whatever happens to be in the
  // row's own link field, which was never meant to be public-facing).
  // The public opportunities page is fully locked for now — real titles
  // still render behind the blur (so there's something genuine there,
  // not placeholder text), but nobody gets a plain, un-gated view of
  // any of it yet, signed in or not. Was previously gated per-visitor
  // (signed-out saw 2 free rows + the rest locked; any signed-in member
  // or professional saw the full list) — simplified back down to one
  // state for everyone until this is actually ready to launch.
  var oppListEl = document.getElementById('opportunities-list');
  if (oppListEl) {
    supabaseClient
      .from('member_opportunities')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .then(function (result) {
        var rows = result.data || [];
        if (!rows.length) return;
        renderOpportunitiesGated(rows);
      });
  }

  function renderOpportunitiesGated(rows) {
    var lockWrap = document.getElementById('opportunities-locked-wrap');
    var lockedRowsEl = document.getElementById('opportunities-locked-rows');
    if (lockWrap && lockedRowsEl) {
      lockedRowsEl.innerHTML = rows.map(renderOpportunityRow).join('');
      lockWrap.style.display = '';
    }
  }

  function renderOpportunityRow(row) {
    var tagHtml = row.category ? '<span class="card-tag">' + escapeHtml(row.category) + '</span>' : '';
    return '<div class="opp-row">' +
      '<div>' + tagHtml + '<h2 class="card-title" style="margin-top: var(--space-2);">' + escapeHtml(row.title) + '</h2><p>' + escapeHtml(row.description) + '</p></div>' +
      '<div class="opp-row-actions"><button type="button" class="btn btn-outline" data-opportunity-learn-more>Learn more</button></div>' +
      '</div>';
  }

  // ---- Events page content from Supabase (site_events, migration 058).
  // events.html ships the same events as static HTML - the fallback if
  // the table's empty or can't be reached - and this swaps in the live
  // rows (editable in Table Editor) once they load. The swapped-in rows
  // need the same behaviours the static ones got at page load (expand/
  // collapse, the signed-in Register button, hiding "RSVP" for signed-in
  // visitors), so those are re-wired here. ----
  function safeEventUrl(url) {
    var u = String(url || '').trim();
    if (!u) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return /^(https?:|mailto:|tel:)/i.test(u) ? encodeURI(u) : '';
    if (u.indexOf('//') === 0) return '';
    return encodeURI(u);
  }

  function renderSiteEventRow(row) {
    var chevron = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    var titleUrl = safeEventUrl(row.title_url);
    var titleHtml = titleUrl ? '<a href="' + escapeHtml(titleUrl) + '">' + escapeHtml(row.name) + '</a>' : escapeHtml(row.name);
    var tagHtml = row.tag ? '<span class="card-tag' + (row.tag_is_gold ? ' card-tag--gold' : '') + '">' + escapeHtml(row.tag) + '</span>' : '';
    var linkUrl = safeEventUrl(row.link_url);
    var linkHtml = linkUrl && row.link_label
      ? '<a class="card-link" href="' + escapeHtml(linkUrl) + '" style="margin-top: var(--space-2);">' + escapeHtml(row.link_label) +
        '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></a>'
      : '';
    var buttonUrl = safeEventUrl(row.button_url);
    var buttonHtml = buttonUrl && row.button_label
      ? '<a class="btn btn-primary btn-glow" href="' + escapeHtml(buttonUrl) + '">' + escapeHtml(row.button_label) + '</a>'
      : '';
    var detailsId = 'details-' + row.slug;
    var detailsHtml = row.details
      ? '<div class="reveal-panel event-row-details" id="' + escapeHtml(detailsId) + '"><div class="reveal-panel-inner"><div class="reveal-panel-content">' + renderRichText(row.details) + '</div></div></div>'
      : '';
    return '<article class="event-row' + (row.is_flagship ? ' event-row--flagship' : '') + '" id="' + escapeHtml(row.slug) + '" data-expand-row>' +
      '<div class="event-row-date">' + escapeHtml(row.date_text) + (row.time_note ? '<br><span class="event-row-date-note">' + escapeHtml(row.time_note) + '</span>' : '') + '</div>' +
      '<div><h2 class="event-row-title">' + titleHtml + '</h2><p>' + escapeHtml(row.summary) + '</p>' + tagHtml + linkHtml + '</div>' +
      '<div class="event-row-actions">' + buttonHtml +
      '<a class="btn btn-outline" href="join.html" data-hide-when-signed-in>RSVP</a>' +
      '<button type="button" class="btn btn-outline member-register-btn" data-event-slug="' + escapeHtml(row.slug) + '" data-event-name="' + escapeHtml(row.name) + '" style="display:none;">Register</button>' +
      (detailsHtml ? '<button type="button" class="chevron-toggle-btn" data-expand-btn aria-expanded="false" aria-controls="' + escapeHtml(detailsId) + '" aria-label="More about ' + escapeHtml(row.name) + '">' + chevron + '</button>' : '') +
      '</div>' + detailsHtml + '</article>';
  }

  var dbEventList = document.querySelector('[data-events-from-db]');
  if (dbEventList) {
    supabaseClient
      .from('site_events')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .then(function (result) {
        if (result.error) {
          console.error('Events failed to load from Supabase, keeping the built-in list:', result.error.message);
          return;
        }
        var rows = result.data || [];
        if (!rows.length) return;
        dbEventList.innerHTML = rows.map(renderSiteEventRow).join('');

        // Same expand/collapse behaviour js/main.js gives static rows at load.
        dbEventList.querySelectorAll('[data-expand-row]').forEach(function (row) {
          var btn = row.querySelector('[data-expand-btn]');
          row.addEventListener('click', function (e) {
            if (e.target.closest('a')) return;
            var open = row.classList.toggle('is-expanded');
            if (btn) btn.setAttribute('aria-expanded', String(open));
          });
        });

        wireEventRegisterButtons();
        supabaseClient.auth.getSession().then(function (sessionResult) {
          if (!(sessionResult.data && sessionResult.data.session)) return;
          dbEventList.querySelectorAll('[data-hide-when-signed-in]').forEach(function (el) { el.style.display = 'none'; });
        });

        var hashTarget = window.location.hash && document.getElementById(window.location.hash.slice(1));
        if (hashTarget) hashTarget.scrollIntoView();
      });
  }

  // ---- Events page: member registration. Each event card carries two
  // buttons: a plain "RSVP" link to join.html (data-hide-when-signed-in,
  // so it only ever shows to a signed-out visitor — prompting them to
  // join first) and this real, backend-connected one, hidden by default
  // and only revealed here once a session is confirmed. Previously the
  // RSVP link had no such gate and stayed visible to everyone including
  // signed-in members, sending them to "buy a membership" even though
  // they already had one — this is what actually fixes that. Works for
  // any signed-in account, member or professional alike, since neither
  // this check nor the event_registrations RLS policies distinguish
  // between the two. ----
  function wireEventRegisterButtons() {
  var registerButtons = document.querySelectorAll('.member-register-btn');
  if (registerButtons.length) {
    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (!session) return;

      registerButtons.forEach(function (btn) { btn.style.display = ''; });

      supabaseClient
        .from('event_registrations')
        .select('event_slug')
        .eq('member_id', session.user.id)
        .then(function (result) {
          var registeredSlugs = (result.data || []).map(function (r) { return r.event_slug; });
          registerButtons.forEach(function (btn) {
            if (registeredSlugs.indexOf(btn.getAttribute('data-event-slug')) !== -1) {
              markRegistered(btn);
            }
          });
        });

      registerButtons.forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (btn.disabled) return;
          var slug = btn.getAttribute('data-event-slug');

          if (btn.classList.contains('is-registered')) {
            if (!window.confirm('Cancel your registration for ' + btn.getAttribute('data-event-name') + '?')) return;
            btn.disabled = true;
            supabaseClient
              .from('event_registrations')
              .delete()
              .eq('member_id', session.user.id)
              .eq('event_slug', slug)
              .then(function (result) {
                btn.disabled = false;
                if (result.error) return;
                markUnregistered(btn);
              });
            return;
          }

          var name = btn.getAttribute('data-event-name');
          btn.disabled = true;
          supabaseClient
            .from('event_registrations')
            .insert({ member_id: session.user.id, event_slug: slug, event_name: name })
            .then(function (result) {
              btn.disabled = false;
              if (result.error) {
                btn.textContent = 'Try again';
                return;
              }
              markRegistered(btn);
            });
        });
      });

      function markUnregistered(btn) {
        btn.classList.remove('is-registered');
        btn.textContent = 'Register';
      }

      function markRegistered(btn) {
        btn.classList.add('is-registered');
        btn.textContent = "You're registered - cancel?";
      }
    });
  }
  }
  wireEventRegisterButtons();

  // ---- MoTM page: nomination form for any signed-in LACMS member or
  // Network professional (matches the DB insert policy from migration
  // 015 — this used to be wrongly restricted to committee-only client-
  // side, contradicting the page's own "no committee role required"
  // copy just above it). MMG-only guests (neither a member nor a
  // professional) get a locked message instead of the form. One
  // nomination per person per calendar month — checked here for a
  // friendly message, enforced for real by the unique constraint added
  // in migration 030 (nominator_id, nomination_month), which a fresh
  // month automatically lifts since the month it's keyed on changes. ----
  var nominateForm = document.getElementById('nominate-form');
  var nominateNotSignedIn = document.getElementById('nominate-not-signed-in');
  var nominateLocked = document.getElementById('nominate-locked');
  var nominateAlreadyUsed = document.getElementById('nominate-already-used');
  var nominateFormWrap = document.getElementById('nominate-form-wrap');
  if (nominateForm && nominateNotSignedIn && nominateFormWrap) {
    var nominateSession = null;
    var currentNominationMonth = new Date().toISOString().slice(0, 7);

    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (!session) return;
      nominateSession = session;
      nominateNotSignedIn.style.display = 'none';

      supabaseClient
        .from('members')
        .select('id')
        .eq('id', session.user.id)
        .maybeSingle()
        .then(function (memberResult) {
          if (memberResult.data) return true;
          return getProfessionalRow(session).then(function (proRow) { return !!proRow; });
        })
        .then(function (isEligible) {
          return getHubAccess().then(function (access) {
            return hubFeatureAllowed(access, 'motm_nominate', true) ? isEligible : false;
          });
        })
        .then(function (isEligible) {
          if (!isEligible) {
            if (nominateLocked) nominateLocked.style.display = 'flex';
            return;
          }
          supabaseClient
            .from('motm_nominations')
            .select('id')
            .eq('nominator_id', session.user.id)
            .eq('nomination_month', currentNominationMonth)
            .maybeSingle()
            .then(function (existingResult) {
              if (existingResult.data) {
                if (nominateAlreadyUsed) nominateAlreadyUsed.style.display = 'flex';
                return;
              }
              nominateFormWrap.style.display = 'block';
            });
        });
    });

    nominateForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var statusEl = document.getElementById('nominate-status');
      hideMessage(statusEl);

      var name = document.getElementById('nominate-name').value.trim();
      var reason = document.getElementById('nominate-reason').value.trim();
      if (!name || !reason) {
        showMessage(statusEl, 'Fill in both fields before submitting.');
        return;
      }

      var btn = nominateForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      supabaseClient
        .from('motm_nominations')
        .insert({ nominator_id: nominateSession.user.id, nominee_name: name, reason: reason })
        .then(function (result) {
          btn.disabled = false;
          if (result.error) {
            // 23505 = unique_violation — the monthly-limit constraint,
            // most likely from a second tab or a double-click racing
            // past the friendly pre-check above.
            var msg = result.error.code === '23505'
              ? "You've already used this month's nomination - it resets on the 1st."
              : result.error.message;
            showMessage(statusEl, msg);
            return;
          }
          nominateFormWrap.style.display = 'none';
          document.getElementById('nominate-confirmation').style.display = 'block';
        });
    });
  }

  // ---- MoTM page: data-driven current winner + past-honourees archive.
  // The HTML already carries "coming soon" fallback copy, so if there's
  // no current winner (or the table's empty) we simply don't touch the
  // DOM at all and that fallback stands. ----
  var motmNameEl = document.getElementById('motm-name');
  if (motmNameEl) {
    supabaseClient
      .from('motm_winners')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: false })
      .then(function (result) {
        var rows = result.data || [];
        var current = rows.filter(function (r) { return r.is_current; })[0];
        var archive = rows.filter(function (r) { return !r.is_current; });
        renderMotmHero(current);
        renderMotmArchive(archive);
      });
  }

  function renderMotmHero(winner) {
    if (!winner || !winner.full_name) return;

    var nameEl = document.getElementById('motm-name');
    var roleEl = document.getElementById('motm-role');
    var bioEl = document.getElementById('motm-bio');
    var monthBadge = document.getElementById('motm-month-badge');
    var photoPlaceholder = document.getElementById('motm-photo-placeholder');
    var photoLabel = document.getElementById('motm-photo-label');
    var photoImg = document.getElementById('motm-photo-img');
    var quoteBlock = document.getElementById('motm-quote-block');
    var quoteText = document.getElementById('motm-quote-text');
    var tagsEl = document.getElementById('motm-tags');

    if (nameEl) nameEl.textContent = winner.full_name;

    var courseYear = [winner.course, winner.year_of_study].filter(Boolean).join(' · ');
    if (roleEl && courseYear) {
      roleEl.textContent = courseYear;
      roleEl.style.display = '';
    }

    if (bioEl && winner.bio) bioEl.textContent = winner.bio;
    if (monthBadge) monthBadge.textContent = winner.month_label || 'This month';

    if (winner.photo_url && photoImg && photoPlaceholder) {
      photoImg.src = winner.photo_url;
      photoImg.alt = winner.full_name;
      photoImg.style.display = '';
      photoPlaceholder.style.display = 'none';
    } else if (photoLabel) {
      photoLabel.textContent = 'Photo - ' + winner.full_name;
    }

    if (winner.quote && quoteBlock && quoteText) {
      quoteText.textContent = winner.quote;
      quoteBlock.style.display = '';
    }

    if (winner.tags && winner.tags.length && tagsEl) {
      tagsEl.innerHTML = winner.tags.map(function (t) {
        return '<span class="motm-tag"><span class="motm-tag-dot motm-tag-dot--gold" aria-hidden="true"></span>' + escapeHtml(t) + '</span>';
      }).join('');
      tagsEl.style.display = '';
    }
  }

  function renderMotmArchive(rows) {
    var track = document.getElementById('motm-archive-track');
    var emptyEl = document.getElementById('motm-archive-empty');
    if (!track) return;
    if (!rows.length) {
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }
    track.innerHTML = rows.map(renderMotmArchiveCard).join('');
  }

  function renderMotmArchiveCard(row) {
    var courseYear = [row.course, row.year_of_study].filter(Boolean).join(' · ');
    var motmSafePhoto = safeUrl(row.photo_url);
    var photoHtml = motmSafePhoto
      ? '<img src="' + motmSafePhoto + '" alt="' + escapeHtml(row.full_name || '') + '" style="width:100%; height:100%; object-fit:cover;">'
      : '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>';
    return '<div class="card motm-archive-card">' +
      '<div class="motm-archive-photo' + (row.photo_url ? '' : ' img-placeholder') + '">' + photoHtml +
      '<span class="motm-month-badge motm-month-badge--sm">' + escapeHtml(row.month_label || '') + '</span></div>' +
      '<div class="motm-archive-name">' + escapeHtml(row.full_name || 'To be announced') + '</div>' +
      '<div class="motm-archive-course">' + escapeHtml(courseYear) + '</div>' +
      '</div>';
  }

  // ---- Homepage: MoTM teaser card, same data source as motm.html's
  // hero, but only the compact fields the teaser actually shows ----
  var homeMotmNameEl = document.getElementById('home-motm-name');
  if (homeMotmNameEl) {
    supabaseClient
      .from('motm_winners')
      .select('*')
      .eq('is_active', true)
      .eq('is_current', true)
      .limit(1)
      .then(function (result) {
        var winner = result.data && result.data[0];
        if (!winner || !winner.full_name) return;

        var eyebrowEl = document.getElementById('home-motm-eyebrow');
        var roleEl = document.getElementById('home-motm-role');
        var photoPlaceholder = document.getElementById('home-motm-photo-placeholder');
        var photoImg = document.getElementById('home-motm-photo-img');

        homeMotmNameEl.textContent = winner.full_name;
        if (eyebrowEl) eyebrowEl.textContent = 'ACMS Member of the Month · ' + (winner.month_label || 'This month');

        var courseYear = [winner.course, winner.year_of_study].filter(Boolean).join(' · ');
        if (roleEl && courseYear) {
          roleEl.textContent = courseYear;
          roleEl.style.display = '';
        }

        if (winner.photo_url && photoImg && photoPlaceholder) {
          photoImg.src = winner.photo_url;
          photoImg.alt = winner.full_name;
          photoImg.style.display = '';
          photoPlaceholder.style.display = 'none';
        }
      });
  }

  // ---- Sankofa Circle application page — mentee applications only.
  // (Mentor applications moved off this page entirely — see sankofa.html's
  // apply modal, which is a public, no-account short form submitting
  // straight into sankofa_mentor_applications, reviewed on the president
  // dashboard.) Medicine members only now (not Pharmacy, not the old
  // manual "Sankofa eligible" checkbox) — automatic, based on the
  // member's own course, not something the committee has to flag
  // per-person. Also closes 11 October 2026 — both rules enforced again
  // in the DB by migration 054's trigger, this client-side check just
  // gives a friendlier message. ----
  var sankofaFormWrap = document.getElementById('sankofa-form-wrap');
  var sankofaAlreadyApplied = document.getElementById('sankofa-already-applied');
  var sankofaNotEligible = document.getElementById('sankofa-not-eligible');
  var SANKOFA_MENTEE_DEADLINE = new Date('2026-10-11T23:59:59+01:00').getTime();
  if (sankofaFormWrap || sankofaAlreadyApplied) {
    var sankofaAuthGate = document.getElementById('auth-gate');
    var sankofaSession = null;

    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (!session) {
        window.location.href = 'member-login.html';
        return;
      }
      sankofaSession = session;

      Promise.all([checkIsMember(session), getHubAccess()]).then(function (gate) {
        var isMember = gate[0];
        var access = gate[1];
        // The application is saved against a members row, so it needs a
        // real member on top of whatever the access rules say.
        if (!isMember) {
          if (sankofaAuthGate) sankofaAuthGate.style.display = 'none';
          var comingSoonNote = document.getElementById('sankofa-coming-soon-note');
          if (comingSoonNote) comingSoonNote.style.display = 'flex';
          return;
        }

        function proceed(allowed) {
          if (sankofaAuthGate) sankofaAuthGate.style.display = 'none';
          if (!allowed) {
            if (sankofaNotEligible) sankofaNotEligible.style.display = 'flex';
            return;
          }
          if (Date.now() > SANKOFA_MENTEE_DEADLINE) {
            var deadlineNote = document.getElementById('sankofa-mentee-deadline-passed');
            if (deadlineNote) deadlineNote.style.display = 'flex';
            return;
          }
          checkExistingApplication(session);
        }

        if (access && access.sankofa) {
          proceed(access.sankofa.allowed);
          return;
        }
        // Hub access unavailable - the original Medicine-only rule.
        supabaseClient
          .from('members')
          .select('course')
          .eq('id', session.user.id)
          .single()
          .then(function (result) {
            proceed(!result.error && !!result.data && /medicine/i.test(result.data.course || ''));
          });
      });
    });

    function checkExistingApplication(session) {
      supabaseClient
        .from('sankofa_applications')
        .select('created_at')
        .eq('member_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .then(function (result) {
          var existing = result.data && result.data[0];
          if (existing) {
            showAlreadyApplied(existing);
          } else if (sankofaFormWrap) {
            sankofaFormWrap.style.display = 'block';
          }
        });
    }

    function showAlreadyApplied(row) {
      if (!sankofaAlreadyApplied) return;
      document.getElementById('sankofa-applied-date').textContent = new Date(row.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      sankofaAlreadyApplied.style.display = 'block';
    }

    var sankofaForm = document.getElementById('sankofa-form');
    if (sankofaForm) {
      sankofaForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var statusEl = document.getElementById('sankofa-status');
        hideMessage(statusEl);

        var stage = document.getElementById('sankofa-stage').value;
        var heritage = document.getElementById('sankofa-heritage').value;
        var aspirations = document.getElementById('sankofa-aspirations').value.trim();
        var specialty = document.getElementById('sankofa-specialty').value.trim();
        var hobbies = Array.from(sankofaForm.querySelectorAll('input[name="hobby"]:checked')).map(function (el) { return el.value; });
        var hobbyOther = document.getElementById('sankofa-hobby-other').value.trim();
        if (hobbyOther) hobbies.push(hobbyOther);
        var social = parseInt(document.getElementById('sankofa-social').value, 10);
        var fitness = parseInt(document.getElementById('sankofa-fitness').value, 10);
        var studyStyle = parseInt(document.getElementById('sankofa-study').value, 10);
        var supportStyle = parseInt(document.getElementById('sankofa-support').value, 10);
        var communication = sankofaForm.querySelector('input[name="sankofa-communication"]:checked');
        var frequency = sankofaForm.querySelector('input[name="sankofa-frequency"]:checked');
        var lookingFor = document.getElementById('sankofa-looking-for').value.trim();
        var statement = document.getElementById('sankofa-statement').value.trim();

        if (!stage || !aspirations || !specialty || !communication || !frequency || !lookingFor) {
          showMessage(statusEl, 'Fill in the required fields before submitting.');
          return;
        }

        var btn = sankofaForm.querySelector('button[type="submit"]');
        btn.disabled = true;

        supabaseClient
          .from('sankofa_applications')
          .insert({
            member_id: sankofaSession.user.id,
            current_stage: stage,
            heritage: heritage || null,
            career_aspirations: aspirations,
            specialty_interest: specialty || null,
            hobbies_interests: hobbies.length ? hobbies : null,
            social_preference: social,
            fitness_preference: fitness,
            study_style: studyStyle,
            support_style: supportStyle,
            communication_style: communication.value,
            meeting_frequency: frequency.value,
            looking_for: lookingFor,
            statement: statement || null
          })
          .then(function (result) {
            btn.disabled = false;
            if (result.error) {
              showMessage(statusEl, result.error.message);
              return;
            }
            sankofaFormWrap.style.display = 'none';
            showAlreadyApplied({ created_at: new Date().toISOString() });
          });
      });
    }
  }

  // ---- MMG portal login/signup page ----
  var mmgSigninForm = document.getElementById('mmg-signin-form');
  var mmgSignupForm = document.getElementById('mmg-signup-form');
  if (mmgSigninForm || mmgSignupForm) {
    var mmgTabSignin = document.getElementById('mmg-tab-signin');
    var mmgTabSignup = document.getElementById('mmg-tab-signup');
    var mmgSignupConfirmation = document.getElementById('mmg-signup-confirmation');
    var mmgSetPasswordForm = document.getElementById('mmg-set-password-form');
    var mmgAuthTabs = document.querySelector('.mmg-auth-tabs');

    // Same detection as member-login.html — a password-reset link also
    // establishes a live session immediately, same as an invite link
    // does, so without this check the "already signed in" redirect
    // below would fire first and bounce a reset visitor straight to
    // the hub before they ever get to actually choose a new password.
    // type=signup is the one an MMG guest account created via the
    // dashboard's Create Account panel arrives with (Supabase's own
    // signUp() confirmation link, forced into this self-contained
    // #access_token=... format by createImplicitFlowClient() rather
    // than this project's PKCE default, since the account owner is
    // never the same browser that created it) — needs the same
    // "let them set a password" treatment as an actual recovery link.
    var mmgHash = window.location.hash || '';
    var mmgSearch = window.location.search || '';
    var mmgIsRecoveryFlow = mmgHash.indexOf('type=recovery') !== -1
      || mmgHash.indexOf('type=signup') !== -1
      || mmgSearch.indexOf('type=recovery') !== -1
      || mmgSearch.indexOf('type=signup') !== -1
      || /[?&]code=/.test(mmgSearch);

    var mmgRecoveryFormShown = false;
    function showMmgSetPasswordForm() {
      if (mmgRecoveryFormShown || !mmgSetPasswordForm) return;
      mmgRecoveryFormShown = true;
      if (mmgAuthTabs) mmgAuthTabs.style.display = 'none';
      if (mmgSigninForm) mmgSigninForm.classList.remove('is-active');
      if (mmgSignupForm) mmgSignupForm.classList.remove('is-active');
      mmgSetPasswordForm.classList.add('is-active');
    }

    if (mmgIsRecoveryFlow && mmgSetPasswordForm) {
      showMmgSetPasswordForm();
    }

    // Same race as member-login.html: Supabase's client can strip the
    // recovery token from the URL before the mmgIsRecoveryFlow check
    // above runs, so PASSWORD_RECOVERY is the final, race-free say on
    // whether this session came from a reset link.
    var mmgInitialAuthHandled = false;
    supabaseClient.auth.onAuthStateChange(function (event, session) {
      if (event === 'PASSWORD_RECOVERY') {
        mmgInitialAuthHandled = true;
        showMmgSetPasswordForm();
        return;
      }
      if (mmgInitialAuthHandled || mmgRecoveryFormShown) return;
      mmgInitialAuthHandled = true;
      if (session && !mmgIsRecoveryFlow) {
        window.location.href = 'mmg-hub.html';
      }
    });

    if (mmgSetPasswordForm) {
      mmgSetPasswordForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var statusEl = document.getElementById('mmg-set-password-status');
        hideMessage(statusEl);
        var password = document.getElementById('mmg-set-password-password').value;
        var confirmPassword = document.getElementById('mmg-set-password-confirm').value;

        if (password.length < 8) {
          showMessage(statusEl, 'Password must be at least 8 characters.');
          return;
        }
        if (password !== confirmPassword) {
          showMessage(statusEl, "Passwords don't match - try again.");
          return;
        }

        var btn = mmgSetPasswordForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        supabaseClient.auth.updateUser({ password: password }).then(function (result) {
          if (result.error) {
            showMessage(statusEl, result.error.message);
            btn.disabled = false;
            return;
          }
          ensureMmgGuestProfile(result.data.session).then(function () {
            window.location.href = 'mmg-hub.html';
          });
        });
      });
    }

    // "Forgot your password?" — same pattern as member-login.html: an
    // email-only form that triggers Supabase's reset email, which lands
    // back on this exact page with type=recovery, handled above.
    var mmgForgotPasswordForm = document.getElementById('mmg-forgot-password-form');
    var mmgForgotPasswordToggle = document.getElementById('mmg-forgot-password-toggle');
    var mmgForgotPasswordBack = document.getElementById('mmg-forgot-password-back');
    if (mmgForgotPasswordForm && mmgForgotPasswordToggle) {
      var mmgForgotPasswordStatus = document.getElementById('mmg-forgot-password-status');

      mmgForgotPasswordToggle.addEventListener('click', function () {
        if (mmgSigninForm) mmgSigninForm.classList.remove('is-active');
        mmgForgotPasswordForm.classList.add('is-active');
      });
      if (mmgForgotPasswordBack) {
        mmgForgotPasswordBack.addEventListener('click', function () {
          mmgForgotPasswordForm.classList.remove('is-active');
          if (mmgSigninForm) mmgSigninForm.classList.add('is-active');
        });
      }

      mmgForgotPasswordForm.addEventListener('submit', function (e) {
        e.preventDefault();
        hideMessage(mmgForgotPasswordStatus);
        var email = document.getElementById('mmg-forgot-password-email').value.trim();
        var btn = mmgForgotPasswordForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        // createImplicitFlowClient(), not supabaseClient directly - see
        // its own comment for why: the site's default PKCE flow can't
        // support a link opened on a different device than the one that
        // requested it.
        createImplicitFlowClient().auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname })
          .then(function (result) {
            btn.disabled = false;
            if (result.error) {
              showMessage(mmgForgotPasswordStatus, result.error.message);
              return;
            }
            mmgForgotPasswordStatus.className = 'auth-error';
            mmgForgotPasswordStatus.style.color = '#6fcf97';
            mmgForgotPasswordStatus.style.borderColor = 'rgba(111, 207, 151, 0.35)';
            mmgForgotPasswordStatus.style.background = 'rgba(30, 122, 70, 0.1)';
            showMessage(mmgForgotPasswordStatus, "Check your email for a reset link - it may take a minute to arrive.");
          });
      });
    }

    function switchMmgTab(tab) {
      var showSignup = tab === 'signup';
      mmgSigninForm.classList.toggle('is-active', !showSignup);
      mmgSignupForm.classList.toggle('is-active', showSignup);
      mmgSignupConfirmation.classList.remove('is-active');
      mmgTabSignin.classList.toggle('is-active', !showSignup);
      mmgTabSignin.setAttribute('aria-selected', String(!showSignup));
      mmgTabSignup.classList.toggle('is-active', showSignup);
      mmgTabSignup.setAttribute('aria-selected', String(showSignup));
    }
    if (mmgTabSignin) mmgTabSignin.addEventListener('click', function () { switchMmgTab('signin'); });
    if (mmgTabSignup) mmgTabSignup.addEventListener('click', function () { switchMmgTab('signup'); });

    if (mmgSigninForm) {
      mmgSigninForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var statusEl = document.getElementById('mmg-signin-status');
        hideMessage(statusEl);
        var email = document.getElementById('mmg-signin-email').value.trim();
        var password = document.getElementById('mmg-signin-password').value;
        var btn = mmgSigninForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        supabaseClient.auth.signInWithPassword({ email: email, password: password }).then(function (result) {
          if (result.error) {
            showMessage(statusEl, result.error.message);
            btn.disabled = false;
            return;
          }
          ensureMmgGuestProfile(result.data.session).then(function () {
            window.location.href = 'mmg-hub.html';
          });
        });
      });
    }

    if (mmgSignupForm) {
      mmgSignupForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var statusEl = document.getElementById('mmg-signup-status');
        hideMessage(statusEl);
        var name = document.getElementById('mmg-signup-name').value.trim();
        var university = document.getElementById('mmg-signup-university').value.trim();
        var email = document.getElementById('mmg-signup-email').value.trim();
        var password = document.getElementById('mmg-signup-password').value;
        var confirmPassword = document.getElementById('mmg-signup-confirm').value;

        if (password.length < 8) {
          showMessage(statusEl, 'Password must be at least 8 characters.');
          return;
        }
        if (password !== confirmPassword) {
          showMessage(statusEl, "Passwords don't match - try again.");
          return;
        }

        var btn = mmgSignupForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        supabaseClient.auth.signUp({
          email: email,
          password: password,
          options: { data: { full_name: name, university: university } }
        }).then(function (result) {
          btn.disabled = false;
          if (result.error) {
            showMessage(statusEl, result.error.message);
            return;
          }
          var session = result.data && result.data.session;
          if (session) {
            ensureMmgGuestProfile(session).then(function () {
              window.location.href = 'mmg-hub.html';
            });
            return;
          }
          mmgSigninForm.classList.remove('is-active');
          mmgSignupForm.classList.remove('is-active');
          mmgSignupConfirmation.classList.add('is-active');
        });
      });
    }
  }

  // ---- MMG portal page: tier resolution, exclusive content, voting,
  // committee planning feed ----
  var mmgAuthGate = document.getElementById('mmg-auth-gate');
  if (mmgAuthGate) {
    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (!session) {
        mmgAuthGate.style.display = 'none';
        var signedOutEl = document.getElementById('mmg-signed-out');
        if (signedOutEl) signedOutEl.style.display = '';
        return;
      }
      ensureMmgGuestProfile(session).then(function () {
        return resolveMmgIdentity(session);
      }).then(function (identity) {
        mmgAuthGate.style.display = 'none';
        if (identity.tier === 'none') {
          var pendingEl = document.getElementById('mmg-pending');
          if (pendingEl) pendingEl.style.display = 'flex';
          return;
        }
        renderMmgIdentity(identity);
        var exclusiveEl = document.getElementById('mmg-exclusive');
        if (exclusiveEl) exclusiveEl.style.display = '';
        loadMmgVoting(session);
        loadMmgPerks();
        loadMmgFeed('mmg_attendee_updates', 'mmg-general-updates-list', 'mmg-general-updates-empty', 'MMG update', 'gold');
        if (identity.tier === 'committee') {
          var committeeEl = document.getElementById('mmg-committee-section');
          if (committeeEl) committeeEl.style.display = '';
          loadMmgFeed('mmg_updates', 'mmg-updates-list', 'mmg-updates-empty', 'Planning update', 'purple');
        }
      });
    });
  }

  function resolveMmgIdentity(session) {
    return supabaseClient
      .from('members')
      .select('full_name, mmg_attendee, mmg_committee')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(function (result) {
        if (result.data) {
          var tier = result.data.mmg_committee ? 'committee' : (result.data.mmg_attendee ? 'attendee' : 'none');
          return { tier: tier, fullName: result.data.full_name, university: 'University of Lincoln' };
        }
        return supabaseClient
          .from('mmg_guests')
          .select('full_name, university, access_level')
          .eq('id', session.user.id)
          .maybeSingle()
          .then(function (guestResult) {
            var level = guestResult.data && guestResult.data.access_level;
            var tier = (level === 'committee' || level === 'attendee') ? level : 'none';
            var meta = session.user.user_metadata || {};
            return {
              tier: tier,
              fullName: (guestResult.data && guestResult.data.full_name) || meta.full_name || session.user.email,
              university: (guestResult.data && guestResult.data.university) || meta.university || ''
            };
          });
      });
  }

  function renderMmgIdentity(identity) {
    var firstName = (identity.fullName || '').trim().split(' ')[0] || 'there';
    var tierLabel = identity.tier === 'committee' ? 'Committee' : 'Attendee';

    var welcomeText = document.getElementById('mmg-welcome-text');
    if (welcomeText) welcomeText.textContent = 'Welcome back, ' + firstName + ' - you’re attending MMG.';

    setMmgCardText('mmg-card-name', identity.fullName);
    setMmgCardText('mmg-card-university', identity.university);
    setMmgCardText('mmg-card-access', tierLabel);
    setMmgCardText('mmg-card-tier', 'MMG · ' + tierLabel);
  }

  function setMmgCardText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value || '-';
  }

  function loadMmgVoting(session) {
    var list = document.getElementById('mmg-vote-list');
    if (!list) return;
    Promise.all([
      supabaseClient.from('mmg_award_categories').select('*').order('sort_order', { ascending: true }),
      supabaseClient.from('mmg_votes').select('category_id, nominee_name').eq('voter_id', session.user.id)
    ]).then(function (results) {
      var categories = results[0].data || [];
      var myVotes = {};
      (results[1].data || []).forEach(function (v) { myVotes[v.category_id] = v.nominee_name; });

      if (!categories.length) {
        var emptyEl = document.getElementById('mmg-vote-empty');
        if (emptyEl) emptyEl.style.display = 'block';
        return;
      }

      list.innerHTML = categories.map(function (cat) {
        return renderVoteCard(cat, myVotes[cat.id]);
      }).join('');

      list.querySelectorAll('.vote-form').forEach(function (form) {
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          submitMmgVote(form, session);
        });
      });
    });
  }

  function renderVoteCard(cat, myVote) {
    var closed = !cat.voting_open;
    var currentHtml = myVote
      ? '<p class="vote-current">You voted: <strong>' + escapeHtml(myVote) + '</strong></p>'
      : '';
    var bodyHtml = closed
      ? '<p class="vote-closed-note">Voting is closed for this category.</p>'
      : '<form class="vote-form" data-category-id="' + cat.id + '">' +
          '<input type="text" name="nominee" placeholder="Type a name" value="' + escapeHtml(myVote || '') + '" required>' +
          '<button type="submit" class="btn btn-outline">' + (myVote ? 'Change vote' : 'Submit vote') + '</button>' +
          '<span class="vote-form-status" role="status"></span>' +
        '</form>';
    return '<div class="card vote-card' + (closed ? ' vote-card--closed' : '') + '">' +
      '<span class="vote-card-icon" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4a1 1 0 0 0-1 1c0 2.5 1.5 4 4 4M17 6h3a1 1 0 0 1 1 1c0 2.5-1.5 4-4 4"/></svg></span>' +
      '<h3 class="card-title">' + escapeHtml(cat.name) + '</h3>' +
      currentHtml + bodyHtml +
      '</div>';
  }

  function submitMmgVote(form, session) {
    var categoryId = form.getAttribute('data-category-id');
    var input = form.querySelector('input[name="nominee"]');
    var btn = form.querySelector('button[type="submit"]');
    var statusEl = form.querySelector('.vote-form-status');
    var nominee = input.value.trim();
    if (!nominee) return;

    btn.disabled = true;
    supabaseClient
      .from('mmg_votes')
      .upsert({
        category_id: categoryId,
        voter_id: session.user.id,
        nominee_name: nominee,
        updated_at: new Date().toISOString()
      }, { onConflict: 'category_id,voter_id' })
      .then(function (result) {
        btn.disabled = false;
        if (result.error) {
          statusEl.textContent = result.error.message;
          statusEl.classList.add('vote-form-status--error');
          return;
        }
        btn.textContent = 'Change vote';
        statusEl.classList.remove('vote-form-status--error');
        statusEl.textContent = 'Vote saved.';
      });
  }

  // Night-exclusive perks/vouchers — same card treatment as the LACMS
  // discount cards, just sourced from mmg_perks instead of discounts.
  function loadMmgPerks() {
    var list = document.getElementById('mmg-perks-list');
    if (!list) return;
    supabaseClient
      .from('mmg_perks')
      .select('*')
      .order('sort_order', { ascending: true })
      .then(function (result) {
        var rows = result.data || [];
        if (!rows.length) {
          var emptyEl = document.getElementById('mmg-perks-empty');
          if (emptyEl) emptyEl.style.display = 'block';
          return;
        }
        list.innerHTML = rows.map(renderMmgPerkCard).join('');
      });
  }

  function renderMmgPerkCard(row) {
    var initial = escapeHtml((row.partner_name || '?').trim().charAt(0).toUpperCase());
    var addressHtml = row.address
      ? '<p class="discount-address"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.6"/></svg><span>' + escapeHtml(row.address) + '</span></p>'
      : '';
    var codeHtml = renderCodeReveal(row.code);
    var perkSafeLink = safeUrl(row.link);
    var linkHtml = perkSafeLink
      ? '<a class="card-link" href="' + perkSafeLink + '" target="_blank" rel="noopener">Visit partner<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></a>'
      : '';
    return '<div class="card discount-card"><span class="discount-card-badge" aria-hidden="true">' + initial + '</span><h3 class="card-title">' +
      escapeHtml(row.partner_name) + '</h3>' + addressHtml + '<p>' +
      escapeHtml(row.description) + '</p>' + codeHtml + linkHtml + '</div>';
  }

  // Generic update-feed loader/renderer, shared by the committee-only
  // planning feed (mmg_updates) and the general attendee feed
  // (mmg_attendee_updates) — same shape, different table, audience and
  // accent colour, reused across mmg.html, mmg-hub.html and
  // member-hub.html so there's one implementation to maintain.
  function loadMmgFeed(tableName, listId, emptyId, tagLabel, accentClass) {
    var list = document.getElementById(listId);
    if (!list) return;
    supabaseClient
      .from(tableName)
      .select('*')
      .order('pinned', { ascending: false })
      .order('published_at', { ascending: false })
      .then(function (result) {
        var rows = result.data || [];
        if (!rows.length) {
          var emptyEl = document.getElementById(emptyId);
          if (emptyEl) emptyEl.style.display = 'block';
          return;
        }
        list.innerHTML = rows.map(function (row) {
          return renderMmgFeedItem(row, tagLabel, accentClass);
        }).join('');
      });
  }

  function renderMmgFeedItem(row, tagLabel, accentClass) {
    var pinHtml = row.pinned
      ? '<span class="feed-item-pin" title="Pinned"><svg class="icon" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2a1 1 0 0 1 1 1v6.5l3.4 3.9a1 1 0 0 1-.75 1.6H13v6a1 1 0 1 1-2 0v-6H6.35a1 1 0 0 1-.75-1.6L9 9.5V3a1 1 0 0 1 1-1h2Z"/></svg></span>'
      : '';
    var classes = 'feed-item feed-item--' + accentClass + (row.pinned ? ' feed-item--pinned' : '');
    var fromHtml = row.posted_by
      ? '<p class="feed-item-from">- ' + escapeHtml(row.posted_by) + '</p>'
      : '';
    return '<article class="' + classes + '">' +
      '<div class="feed-item-meta">' + pinHtml + newBadgeHtml(row.published_at) +
      '<span class="feed-item-tag">' + escapeHtml(tagLabel) + '</span>' +
      '<span class="feed-item-date">' + escapeHtml(timeAgo(row.published_at)) + '</span></div>' +
      '<h3 class="feed-item-title">' + escapeHtml(row.title) + '</h3>' +
      '<p class="feed-item-body">' + escapeHtml(row.body) + '</p>' +
      fromHtml +
      '</article>';
  }

  // ---- Shared: media-submission forms that upload straight to a
  // private Supabase Storage bucket, under the uploader's own folder.
  // Used by the MMG portal (after-gala photos/videos) and the gallery
  // page (member submissions for the committee to review) alike — same
  // flow, different bucket and status copy.
  var MEDIA_UPLOAD_MAX_BYTES = 200 * 1024 * 1024;

  function bindMediaUploadForm(formId, fileInputId, statusId, bucketName) {
    var form = document.getElementById(formId);
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var statusEl = document.getElementById(statusId);
      var fileInput = document.getElementById(fileInputId);
      var files = fileInput.files;
      hideMessage(statusEl);
      if (!files.length) return;

      var oversized = Array.prototype.some.call(files, function (f) { return f.size > MEDIA_UPLOAD_MAX_BYTES; });
      if (oversized) {
        statusEl.style.color = '#ef8b8f';
        showMessage(statusEl, 'One or more files are over 200MB - try a smaller file or a compressed video.');
        return;
      }

      supabaseClient.auth.getSession().then(function (result) {
        var session = result.data && result.data.session;
        if (!session) return;

        var btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        statusEl.style.color = 'var(--color-text-muted)';
        showMessage(statusEl, 'Uploading ' + files.length + ' file' + (files.length > 1 ? 's' : '') + '…');

        var uploads = Array.prototype.map.call(files, function (file) {
          var safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
          var path = session.user.id + '/' + Date.now() + '-' + safeName;
          return supabaseClient.storage.from(bucketName).upload(path, file);
        });

        Promise.all(uploads).then(function (results) {
          btn.disabled = false;
          var failed = results.filter(function (r) { return r.error; });
          if (failed.length) {
            statusEl.style.color = '#ef8b8f';
            showMessage(statusEl, 'Some files failed to upload - try again, or email acms@lincolnsu.com.');
            return;
          }
          statusEl.style.color = 'var(--color-gold-light)';
          showMessage(statusEl, 'Thank you - your media has been uploaded.');
          form.reset();
        });
      });
    });
  }

  bindMediaUploadForm('mmg-media-form', 'mmg-media-file', 'mmg-media-status', 'mmg-media');
  bindMediaUploadForm('gallery-media-form', 'gallery-media-file', 'gallery-media-status', 'gallery-submissions');

  // ---- Gallery page: submission form is LACMS-member gated — swap the
  // "log in" note for the real form once membership is confirmed ----
  var gallerySignedOut = document.getElementById('gallery-submit-signed-out');
  var galleryFormWrap = document.getElementById('gallery-submit-form-wrap');
  if (gallerySignedOut && galleryFormWrap) {
    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (!session) return;
      supabaseClient
        .from('members')
        .select('id')
        .eq('id', session.user.id)
        .maybeSingle()
        .then(function (memberResult) {
          if (!memberResult.data) return;
          gallerySignedOut.style.display = 'none';
          galleryFormWrap.style.display = 'block';
        });
    });
  }

  // ---- MMG hub page: the equivalent of member-hub.html for MMG-only
  // guests (attendees/committee from the 7 partner universities), who
  // have no row in `members` and would otherwise hit a "couldn't find
  // your profile" error if sent to the real members hub ----
  var mmgHubContent = document.getElementById('mmg-hub-content');
  if (mmgHubContent) {
    var mmgHubAuthGate = document.getElementById('mmg-hub-auth-gate');
    var mmgHubError = document.getElementById('mmg-hub-error');

    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (!session) {
        window.location.href = 'mmg-login.html';
        return;
      }
      // A full Lincoln member landing here (e.g. an old bookmark) belongs
      // on the real members hub instead.
      supabaseClient
        .from('members')
        .select('id')
        .eq('id', session.user.id)
        .maybeSingle()
        .then(function (memberResult) {
          if (memberResult.data) {
            window.location.href = 'member-hub.html';
            return;
          }
          loadMmgHubProfile(session);
        });
    });

    function loadMmgHubProfile(session) {
      ensureMmgGuestProfile(session)
        .then(function () {
          return supabaseClient.from('mmg_guests').select('*').eq('id', session.user.id).maybeSingle();
        })
        .then(function (result) {
          if (mmgHubAuthGate) mmgHubAuthGate.style.display = 'none';
          if (result.error || !result.data) {
            showMessage(mmgHubError, "We couldn't find your MMG account yet - try logging out and back in, or email acms@lincolnsu.com if this doesn't resolve soon.");
            return;
          }
          renderMmgHubProfile(result.data, session);
          mmgHubContent.style.display = '';
        });
    }

    function renderMmgHubProfile(guest, session) {
      var isPending = guest.access_level === 'pending';
      var tierLabel = guest.access_level === 'committee' ? 'Committee' : (guest.access_level === 'attendee' ? 'Attendee' : 'Pending review');

      document.querySelectorAll('[data-mmg-name-inline]').forEach(function (el) {
        el.textContent = guest.full_name;
      });

      setMmgCardText('mmg-hub-card-name', guest.full_name);
      setMmgCardText('mmg-hub-card-university', guest.university);
      setMmgCardText('mmg-hub-card-access', tierLabel);
      setMmgCardText('mmg-hub-card-tier', isPending ? 'MMG · Pending' : 'MMG · ' + tierLabel);

      var statusBadge = document.getElementById('mmg-hub-card-status-badge');
      if (statusBadge) {
        statusBadge.className = 'member-status-badge ' + (isPending ? 'member-status-badge--pending' : 'member-status-badge--active');
        statusBadge.innerHTML = '<span class="member-status-badge-dot" aria-hidden="true"></span>' + (isPending ? 'Pending' : 'Confirmed');
      }

      setHubText('mmg-hub-university', guest.university);
      setHubText('mmg-hub-email', session.user.email);
      setHubText('mmg-hub-status', tierLabel);

      var pendingNote = document.getElementById('mmg-hub-pending-note');
      if (pendingNote) pendingNote.style.display = isPending ? 'flex' : 'none';

      if (guest.access_level === 'attendee' || guest.access_level === 'committee') {
        var generalUpdatesSection = document.getElementById('mmg-hub-general-updates');
        if (generalUpdatesSection) generalUpdatesSection.style.display = '';
        loadMmgFeed('mmg_attendee_updates', 'mmg-hub-general-updates-list', 'mmg-hub-general-updates-empty', 'MMG update', 'gold');
      }
      if (guest.access_level === 'committee') {
        var committeeSection = document.getElementById('mmg-hub-committee-section');
        if (committeeSection) committeeSection.style.display = '';
        loadMmgFeed('mmg_updates', 'mmg-hub-updates-list', 'mmg-hub-updates-empty', 'Planning update', 'purple');
      }
    }

    function setHubText(id, value) {
      var el = document.getElementById(id);
      if (el) el.textContent = value || '-';
    }

    var mmgHubChangePasswordToggle = document.getElementById('mmg-hub-change-password-toggle');
    var mmgHubChangePasswordForm = document.getElementById('mmg-hub-change-password-form');
    if (mmgHubChangePasswordToggle && mmgHubChangePasswordForm) {
      mmgHubChangePasswordToggle.addEventListener('click', function () {
        var isOpen = mmgHubChangePasswordForm.style.display !== 'none';
        mmgHubChangePasswordForm.style.display = isOpen ? 'none' : 'block';
      });

      mmgHubChangePasswordForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var statusEl = document.getElementById('mmg-hub-change-password-status');
        hideMessage(statusEl);
        var password = document.getElementById('mmg-hub-new-password').value;
        var confirmPassword = document.getElementById('mmg-hub-new-password-confirm').value;

        if (password.length < 8) {
          showMessage(statusEl, 'Password must be at least 8 characters.');
          return;
        }
        if (password !== confirmPassword) {
          showMessage(statusEl, "Passwords don't match - try again.");
          return;
        }

        var btn = mmgHubChangePasswordForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        supabaseClient.auth.updateUser({ password: password }).then(function (result) {
          btn.disabled = false;
          if (result.error) {
            showMessage(statusEl, result.error.message);
            return;
          }
          statusEl.style.color = 'var(--color-gold-light)';
          showMessage(statusEl, 'Password updated.');
        });
      });
    }
  }

  // ---- LACMS News page: public feed, member-only likes and comments.
  // Guests see posts and live like/comment counts (kept in sync by DB
  // triggers) but can't interact; a signed-in LACMS member gets a
  // working like button and a comment thread. MMG-only guests are
  // treated the same as signed-out visitors here — this is a LACMS
  // member feature specifically. ----
  var newsFeedListEl = document.getElementById('news-feed-list');
  if (newsFeedListEl) {
    var newsSession = null;
    var newsIsMember = false;
    var newsAuthorName = '';

    supabaseClient
      .from('news_posts')
      .select('*')
      .eq('is_active', true)
      .order('pinned', { ascending: false })
      .order('published_at', { ascending: false })
      .then(function (result) {
        var rows = result.data || [];
        if (!rows.length) {
          var emptyEl = document.getElementById('news-feed-empty');
          if (emptyEl) emptyEl.style.display = 'block';
          return;
        }

        supabaseClient.auth.getSession().then(function (sessionResult) {
          newsSession = sessionResult.data && sessionResult.data.session;
          if (!newsSession) {
            renderNewsFeed(rows, []);
            return;
          }
          supabaseClient
            .from('members')
            .select('full_name')
            .eq('id', newsSession.user.id)
            .maybeSingle()
            .then(function (memberResult) {
              if (!memberResult.data) {
                renderNewsFeed(rows, []);
                return;
              }
              newsIsMember = true;
              newsAuthorName = memberResult.data.full_name;

              var postIds = rows.map(function (r) { return r.id; });
              supabaseClient
                .from('news_likes')
                .select('post_id')
                .eq('member_id', newsSession.user.id)
                .in('post_id', postIds)
                .then(function (likesResult) {
                  var likedIds = (likesResult.data || []).map(function (l) { return l.post_id; });
                  renderNewsFeed(rows, likedIds);
                });
            });
        });
      });

    function renderNewsFeed(rows, likedIds) {
      newsFeedListEl.innerHTML = rows.map(function (row) {
        return renderNewsPost(row, likedIds.indexOf(row.id) !== -1);
      }).join('');
    }

    function renderNewsPost(row, isLiked) {
      var pinHtml = row.pinned
        ? '<span class="feed-item-pin" title="Pinned"><svg class="icon" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2a1 1 0 0 1 1 1v6.5l3.4 3.9a1 1 0 0 1-.75 1.6H13v6a1 1 0 1 1-2 0v-6H6.35a1 1 0 0 1-.75-1.6L9 9.5V3a1 1 0 0 1 1-1h2Z"/></svg></span>'
        : '';
      var newsSafeImage = safeUrl(row.image_url);
      var mediaHtml = newsSafeImage
        ? '<div class="news-post-media"><img src="' + newsSafeImage + '" alt="" loading="lazy"></div>'
        : '';
      var commentsInner = newsIsMember
        ? '<div class="news-comments-list" id="news-comments-list-' + row.id + '"></div>' +
          '<form class="news-comment-form" data-post-id="' + row.id + '">' +
            '<input type="text" class="news-comment-input" maxlength="500" placeholder="Write a comment…" required>' +
            '<button type="submit" class="btn btn-outline">Post</button>' +
          '</form>'
        : '<p class="news-locked-note"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><span><a href="login.html">Log in</a> as a LACMS member to see and join the conversation.</span></p>';

      return '<article class="news-post' + (row.pinned ? ' news-post--pinned' : '') + '" data-post-id="' + row.id + '">' +
        mediaHtml +
        '<div class="news-post-body">' +
          '<div class="feed-item-meta">' + pinHtml + newBadgeHtml(row.published_at) + '<span class="feed-item-tag">News</span><span class="feed-item-date">' + escapeHtml(timeAgo(row.published_at)) + '</span></div>' +
          '<h2 class="news-post-title">' + escapeHtml(row.title) + '</h2>' +
          '<p class="news-post-text">' + escapeHtml(row.body) + '</p>' +
          '<div class="news-post-actions">' +
            '<button type="button" class="news-like-btn' + (isLiked ? ' is-liked' : '') + '" data-post-id="' + row.id + '" data-liked="' + (isLiked ? '1' : '0') + '">' +
              '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 8.6a4.6 4.6 0 0 0-7.9-3.2L12 6.3l-.9-.9a4.6 4.6 0 1 0-6.5 6.5L12 19.5l7.4-7.6a4.6 4.6 0 0 0 1.4-3.3z"/></svg>' +
              '<span class="news-like-count">' + row.like_count + '</span>' +
            '</button>' +
            '<button type="button" class="news-comment-toggle-btn" data-post-id="' + row.id + '">' +
              '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
              '<span class="news-comment-count">' + row.comment_count + '</span> Comments' +
            '</button>' +
          '</div>' +
          '<div class="news-comments-panel" id="news-comments-' + row.id + '" style="display:none;">' + commentsInner + '</div>' +
        '</div>' +
      '</article>';
    }

    function renderNewsComment(row) {
      return '<div class="news-comment">' +
        '<div class="news-comment-meta"><span class="news-comment-author">' + escapeHtml(row.author_name) + '</span><span class="news-comment-date">' + escapeHtml(timeAgo(row.created_at)) + '</span></div>' +
        '<p class="news-comment-body">' + escapeHtml(row.body) + '</p>' +
      '</div>';
    }

    var newsLoadedComments = {};

    newsFeedListEl.addEventListener('click', function (e) {
      var likeBtn = e.target.closest('.news-like-btn');
      if (likeBtn) {
        if (!newsIsMember) {
          window.location.href = 'login.html';
          return;
        }
        var postId = likeBtn.getAttribute('data-post-id');
        var countEl = likeBtn.querySelector('.news-like-count');
        var wasLiked = likeBtn.getAttribute('data-liked') === '1';
        var newCount = parseInt(countEl.textContent, 10) + (wasLiked ? -1 : 1);
        likeBtn.setAttribute('data-liked', wasLiked ? '0' : '1');
        likeBtn.classList.toggle('is-liked', !wasLiked);
        countEl.textContent = newCount;
        if (!wasLiked) {
          likeBtn.classList.add('is-liked-anim');
          setTimeout(function () { likeBtn.classList.remove('is-liked-anim'); }, 400);
        }

        var request = wasLiked
          ? supabaseClient.from('news_likes').delete().eq('post_id', postId).eq('member_id', newsSession.user.id)
          : supabaseClient.from('news_likes').insert({ post_id: postId, member_id: newsSession.user.id });

        request.then(function (result) {
          if (result.error) {
            // Roll back the optimistic update on failure
            likeBtn.setAttribute('data-liked', wasLiked ? '1' : '0');
            likeBtn.classList.toggle('is-liked', wasLiked);
            countEl.textContent = parseInt(countEl.textContent, 10) + (wasLiked ? 1 : -1);
          }
        });
        return;
      }

      var toggleBtn = e.target.closest('.news-comment-toggle-btn');
      if (toggleBtn) {
        var pid = toggleBtn.getAttribute('data-post-id');
        var panel = document.getElementById('news-comments-' + pid);
        if (!panel) return;
        var isOpen = panel.style.display !== 'none';
        panel.style.display = isOpen ? 'none' : 'block';
        if (!isOpen && newsIsMember && !newsLoadedComments[pid]) {
          newsLoadedComments[pid] = true;
          loadNewsComments(pid);
        }
      }
    });

    newsFeedListEl.addEventListener('submit', function (e) {
      var form = e.target.closest('.news-comment-form');
      if (!form) return;
      e.preventDefault();
      var postId = form.getAttribute('data-post-id');
      var input = form.querySelector('.news-comment-input');
      var body = input.value.trim();
      if (!body) return;

      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      supabaseClient
        .from('news_comments')
        .insert({ post_id: postId, member_id: newsSession.user.id, author_name: newsAuthorName, body: body })
        .select()
        .single()
        .then(function (result) {
          btn.disabled = false;
          if (result.error) return;
          input.value = '';
          var listEl = document.getElementById('news-comments-list-' + postId);
          if (listEl) {
            var emptyNote = listEl.querySelector('.news-comments-empty');
            if (emptyNote) emptyNote.remove();
            listEl.insertAdjacentHTML('beforeend', renderNewsComment(result.data));
          }
          var post = newsFeedListEl.querySelector('.news-post[data-post-id="' + postId + '"]');
          var countEl = post && post.querySelector('.news-comment-count');
          if (countEl) countEl.textContent = parseInt(countEl.textContent, 10) + 1;
        });
    });

    function loadNewsComments(postId) {
      var listEl = document.getElementById('news-comments-list-' + postId);
      if (!listEl) return;
      supabaseClient
        .from('news_comments')
        .select('*')
        .eq('post_id', postId)
        .order('created_at', { ascending: true })
        .then(function (result) {
          var rows = result.data || [];
          if (!rows.length) {
            listEl.innerHTML = '<p class="news-comments-empty">No comments yet - be the first.</p>';
            return;
          }
          listEl.innerHTML = rows.map(renderNewsComment).join('');
        });
    }
  }

  // ---- LACMS Network page: every active member (via the
  // get_network_members() RPC, since `members` itself only allows
  // reading your own row), grouped by course then year, plus a
  // committee-curated professionals section. Auth-gated like the rest
  // of the members hub. ----
  var NETWORK_LINKEDIN_ICON = '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M6.94 5a1.94 1.94 0 1 1-3.88 0 1.94 1.94 0 0 1 3.88 0zM3.5 8.5h3.4V21H3.5V8.5zm6.1 0h3.26v1.7h.05c.45-.86 1.56-1.77 3.21-1.77 3.43 0 4.06 2.26 4.06 5.2V21h-3.4v-5.7c0-1.36-.03-3.1-1.89-3.1-1.9 0-2.19 1.48-2.19 3v5.8h-3.4V8.5z"/></svg>';

  var networkContent = document.getElementById('network-content');
  if (networkContent) {
    var networkAuthGate = document.getElementById('auth-gate');
    var networkHubError = document.getElementById('hub-error');
    var networkAllMembers = [];
    var networkAllProfessionals = [];
    // Populated by renderNetworkMembers() — course name -> the exact
    // accent colours its section is currently using, so the ticker can
    // colour a member's join event to match their real card instead of
    // recomputing a cycle that could drift out of sync with it.
    var networkCourseAccents = {};

    // Matched as a substring, not an exact string — course is always
    // saved with the full degree title attached (e.g. "Medicine BMBS
    // BMedSci", "Nursing and Midwifery BSc (Hons)"), so an exact-match
    // lookup against these plain names would never hit and everything
    // would fall through to alphabetical order instead.
    var NETWORK_COURSE_ORDER = ['Medicine', 'Pharmacy', 'Dental Hygiene and Therapy', 'Diagnostic Radiography', 'Nursing', 'Midwifery', 'Biomedical Science', 'Occupational Therapy'];
    var NETWORK_ACCENTS = ['gold', 'green', 'red', 'purple'];

    // The same course turns up under different names - older accounts
    // were saved with the full degree title ("Medicine BMBS BMedSci"),
    // newer ones from the request form with the short name ("Medicine") -
    // which used to land in separate sections. Every raw course string is
    // mapped to one display name per course: a fixed preferred full title
    // where we know it, otherwise the longest (most complete) variant
    // actually in use. The old combined "Nursing and Midwifery ..." title
    // is deliberately left on its own, since it can't be split between the
    // two courses that replaced it.
    var NETWORK_PREFERRED_COURSE_NAMES = { 'medicine': 'Medicine BMBS BMedSci' };
    var networkCourseCanon = {};
    function networkCourseBase(raw) {
      var lower = (raw || '').toLowerCase();
      if (lower.indexOf('nursing') !== -1 && lower.indexOf('midwifery') !== -1) return null;
      for (var i = 0; i < NETWORK_COURSE_ORDER.length; i++) {
        if (lower.indexOf(NETWORK_COURSE_ORDER[i].toLowerCase()) !== -1) return NETWORK_COURSE_ORDER[i].toLowerCase();
      }
      return null;
    }
    function buildNetworkCourseCanon(members) {
      var rawsByBase = {};
      networkCourseCanon = {};
      members.forEach(function (m) {
        var raw = (m.course || '').trim();
        if (!raw) return;
        var base = networkCourseBase(raw);
        if (!base) { networkCourseCanon[raw] = raw; return; }
        if (!rawsByBase[base]) rawsByBase[base] = [];
        if (rawsByBase[base].indexOf(raw) === -1) rawsByBase[base].push(raw);
      });
      Object.keys(rawsByBase).forEach(function (base) {
        var raws = rawsByBase[base];
        var display = NETWORK_PREFERRED_COURSE_NAMES[base] || raws.slice().sort(function (a, b) { return b.length - a.length; })[0];
        raws.forEach(function (raw) { networkCourseCanon[raw] = display; });
      });
    }
    function networkCourseLabel(raw) {
      var trimmed = (raw || '').trim();
      if (!trimmed) return raw;
      if (networkCourseCanon[trimmed]) return networkCourseCanon[trimmed];
      var base = networkCourseBase(trimmed);
      return (base && NETWORK_PREFERRED_COURSE_NAMES[base]) || raw;
    }
    var NETWORK_ACCENT_COLORS = {
      gold: { accent: 'var(--color-gold)', light: 'var(--color-gold-light)', bg: 'rgba(212, 166, 43, 0.18)' },
      green: { accent: '#6fcf97', light: '#6fcf97', bg: 'rgba(30, 122, 70, 0.2)' },
      red: { accent: '#ef8b8f', light: '#ef8b8f', bg: 'rgba(193, 39, 45, 0.2)' },
      purple: { accent: '#b28ff0', light: '#b28ff0', bg: 'rgba(107, 70, 193, 0.22)' }
    };
    var NETWORK_TYPE_LABELS = {
      supporting_committee: 'Supporting Committee',
      executive_committee: 'Executive Committee',
      senior_sankofa_mentor: 'Senior Sankofa Mentor',
      junior_sankofa_mentor: 'Junior Sankofa Mentor'
    };

    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (!session) {
        window.location.href = 'member-login.html';
        return;
      }
      // Who can open the Network is decided by the Hub Access rules (the
      // president edits them on the dashboard). If those can't be loaded,
      // fall back to the original rule: president only. Anyone without
      // access sees a "coming soon" note in place of the real page.
      getHubAccess().then(function (access) {
        if (!hubFeatureAllowed(access, 'network', session.user.id === PRESIDENT_UID)) {
          if (networkAuthGate) networkAuthGate.style.display = 'none';
          var networkLocked = document.getElementById('network-locked');
          if (networkLocked) networkLocked.style.display = 'flex';
          return;
        }
        loadNetwork();
      });
    });

    // "So-and-so just joined the LACMS Network" — one row per new
    // `members` insert, logged automatically by a database trigger
    // (migration 020), so this covers both a member the committee adds
    // directly and a pending_members row getting claimed on first
    // login. A compact single-item ticker (not a stacked feed) so it
    // stays visible without taking up real estate — anyone who missed
    // activity while they were away sees it all here, one at a time.
    function loadNetworkActivity() {
      var ticker = document.getElementById('network-ticker');
      var track = document.getElementById('network-ticker-track');
      if (!ticker || !track) return;

      supabaseClient
        .from('network_join_events')
        .select('*')
        .order('created_at', { ascending: false })
        .then(function (result) {
          if (result.error) return;
          // No .limit() on the query itself — deduping first, then
          // slicing to 12, means a re-added account (see
          // dedupeJoinEventsByName) can never crowd out a real person
          // from the ticker.
          var rows = dedupeJoinEventsByName(result.data || []).slice(0, 12);
          if (!rows.length) return;
          track.innerHTML = rows.map(renderNetworkTickerItem).join('');
          ticker.style.display = 'flex';
          initNetworkTicker(ticker, rows.length);
        });
    }

    // Each slide carries the same accent its person's real Network card
    // uses — a course's live colour for a member (falling back to gold
    // if that course currently has no section, e.g. it's since gone
    // quiet), a fixed green for a professional, and committee's gold +
    // glow overriding either. Stashed as data-attributes so switching
    // slides is just reading them back, not recomputing a lookup.
    function renderNetworkTickerItem(row) {
      var isProfessional = row.event_type === 'professional';
      var detail, colors, isCommittee;

      if (isProfessional) {
        detail = row.title || '';
        colors = NETWORK_ACCENT_COLORS.green;
        isCommittee = false;
      } else {
        detail = [networkCourseLabel(row.course), row.year_of_study].filter(Boolean).join(' · ');
        var courseKey = (row.course || '').trim() || 'Course not set';
        colors = networkCourseAccents[courseKey] || NETWORK_ACCENT_COLORS.gold;
        isCommittee = row.member_type === 'executive_committee' || row.member_type === 'supporting_committee';
      }
      if (isCommittee) colors = NETWORK_ACCENT_COLORS.gold;

      return '<div class="network-ticker-item" data-accent="' + colors.accent + '" data-accent-light="' + colors.light + '" data-accent-bg="' + colors.bg + '" data-committee="' + (isCommittee ? '1' : '0') + '">' +
        '<span class="network-ticker-item-title">' + escapeHtml(row.full_name) + ' just joined the Network</span>' +
        '<span class="network-ticker-item-time">' + escapeHtml(timeAgo(row.created_at)) + '</span>' +
        (detail ? '<span class="network-ticker-item-meta">' + escapeHtml(detail) + '</span>' : '') +
        '</div>';
    }

    function initNetworkTicker(ticker, count) {
      var track = document.getElementById('network-ticker-track');
      var prevBtn = document.getElementById('network-ticker-prev');
      var nextBtn = document.getElementById('network-ticker-next');
      var counter = document.getElementById('network-ticker-counter');
      var viewport = ticker.querySelector('.network-ticker-viewport');
      var index = 0;
      var timer = null;

      function render() {
        track.style.transform = 'translateX(-' + (index * 100) + '%)';
        if (counter) counter.textContent = (index + 1) + ' / ' + count;
        var current = track.children[index];
        if (current) {
          ticker.style.setProperty('--ticker-item-accent', current.getAttribute('data-accent'));
          ticker.style.setProperty('--ticker-item-accent-light', current.getAttribute('data-accent-light'));
          ticker.style.setProperty('--ticker-item-accent-bg', current.getAttribute('data-accent-bg'));
          ticker.classList.toggle('is-committee', current.getAttribute('data-committee') === '1');
        }
      }

      function go(delta) {
        index = (index + delta + count) % count;
        render();
      }

      function stopAuto() {
        if (timer) clearInterval(timer);
        timer = null;
      }

      function startAuto() {
        stopAuto();
        if (count < 2) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        timer = setInterval(function () { go(1); }, 6000);
      }

      if (count < 2) {
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';
        if (counter) counter.style.display = 'none';
      } else {
        if (prevBtn) prevBtn.addEventListener('click', function () { go(-1); startAuto(); });
        if (nextBtn) nextBtn.addEventListener('click', function () { go(1); startAuto(); });
        ticker.addEventListener('mouseenter', stopAuto);
        ticker.addEventListener('mouseleave', startAuto);
        ticker.addEventListener('focusin', stopAuto);
        ticker.addEventListener('focusout', startAuto);

        var touchStartX = null;
        if (viewport) {
          viewport.addEventListener('touchstart', function (e) {
            touchStartX = e.touches[0].clientX;
            stopAuto();
          }, { passive: true });
          viewport.addEventListener('touchend', function (e) {
            if (touchStartX === null) return;
            var dx = e.changedTouches[0].clientX - touchStartX;
            if (dx > 40) go(-1);
            else if (dx < -40) go(1);
            touchStartX = null;
            startAuto();
          }, { passive: true });
        }
      }

      render();
      startAuto();
    }

    // The ticker only ever shows the 12 most recent joins — "View all"
    // opens the full, permanent history (every member who's ever
    // joined, oldest activity never pruned) in a scrollable modal,
    // reusing the same modal shell as the Network's own profile popup.
    var networkHistoryLoaded = false;
    var networkTickerViewAll = document.getElementById('network-ticker-viewall');
    if (networkTickerViewAll) {
      networkTickerViewAll.addEventListener('click', openNetworkHistoryModal);
    }
    document.querySelectorAll('[data-network-history-close]').forEach(function (el) {
      el.addEventListener('click', closeNetworkHistoryModal);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeNetworkHistoryModal();
    });

    function openNetworkHistoryModal() {
      var modal = document.getElementById('network-history-modal');
      if (!modal) return;
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      if (!networkHistoryLoaded) {
        networkHistoryLoaded = true;
        loadNetworkHistory();
      }
    }

    function closeNetworkHistoryModal() {
      var modal = document.getElementById('network-history-modal');
      if (!modal || modal.style.display === 'none') return;
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }

    function loadNetworkHistory() {
      var list = document.getElementById('network-history-list');
      var countEl = document.getElementById('network-history-count');
      if (!list) return;

      supabaseClient
        .from('network_join_events')
        .select('*')
        .order('created_at', { ascending: false })
        .then(function (result) {
          var rows = dedupeJoinEventsByName(result.data || []);
          if (countEl) {
            countEl.textContent = rows.length
              ? rows.length + (rows.length === 1 ? ' member, all time' : ' members, all time')
              : '';
          }
          if (!rows.length) {
            list.innerHTML = '<p style="color: var(--color-text-faint); margin-top: var(--space-2);">No join history yet.</p>';
            return;
          }
          list.innerHTML = rows.map(renderNetworkHistoryRow).join('');
        });
    }

    function renderNetworkHistoryRow(row) {
      var subtitle = row.event_type === 'professional'
        ? [row.title, row.organisation].filter(Boolean).join(' · ')
        : [networkCourseLabel(row.course), row.year_of_study].filter(Boolean).join(' · ');
      return '<div class="network-history-row">' +
        '<div class="network-history-info">' +
        '<div class="network-history-name">' + escapeHtml(row.full_name) + '</div>' +
        (subtitle ? '<div class="network-history-course">' + escapeHtml(subtitle) + '</div>' : '') +
        '</div>' +
        '<div class="network-history-time">' + escapeHtml(timeAgo(row.created_at)) + '</div>' +
        '</div>';
    }

    function loadNetwork() {
      Promise.all([
        supabaseClient.rpc('get_network_members'),
        supabaseClient.from('network_professionals').select('*').order('sort_order', { ascending: true })
      ]).then(function (results) {
        if (networkAuthGate) networkAuthGate.style.display = 'none';

        if (results[0].error) {
          showMessage(networkHubError, "We couldn't load the Network right now - try refreshing, or email acms@lincolnsu.com if this doesn't resolve soon.");
          return;
        }

        networkAllMembers = results[0].data || [];
        networkAllProfessionals = (results[1] && results[1].data) || [];

        if (!networkAllMembers.length && !networkAllProfessionals.length) {
          document.getElementById('network-empty').style.display = 'block';
          return;
        }

        networkContent.style.display = '';
        renderNetworkMembers(networkAllMembers);
        renderNetworkProfessionals(networkAllProfessionals);
        updateNetworkCount(networkAllMembers.length + networkAllProfessionals.length);
        wireNetworkInteractions();
        // Runs after renderNetworkMembers() so networkCourseAccents is
        // already populated — the ticker's colours depend on it.
        loadNetworkActivity();
        // js/guidance.js listens for this to ask people to fill in their
        // Network profile (first open, then now and then until they do).
        document.dispatchEvent(new CustomEvent('lacms:network-opened'));
      });
    }

    function courseSortKey(course) {
      var lower = (course || '').toLowerCase();
      for (var i = 0; i < NETWORK_COURSE_ORDER.length; i++) {
        if (lower.indexOf(NETWORK_COURSE_ORDER[i].toLowerCase()) !== -1) return i;
      }
      return 999;
    }

    function yearSortKey(year) {
      var match = /(\d+)/.exec(year || '');
      return match ? parseInt(match[1], 10) : 999;
    }

    // Pending and confirmed members are added by whoever's adding them,
    // at different times, and free-text year_of_study drifts as a
    // result — "Year 2", "2nd year" and "Year Two" all mean the same
    // thing but would otherwise land in three separate groups. This
    // folds any of those into one canonical "Year N" bucket so a
    // pending and a confirmed member in the same academic year always
    // show up in the same row. Genuinely non-numeric labels (e.g.
    // "Foundation Doctor") are left as their own group, unchanged.
    var YEAR_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
    function yearGroupLabel(year) {
      var raw = (year || '').trim();
      if (!raw) return 'Year not set';
      var lower = raw.toLowerCase();
      var digitMatch = /(\d+)/.exec(lower);
      if (digitMatch) return 'Year ' + parseInt(digitMatch[1], 10);
      var wordMatch = /\b(one|two|three|four|five|six|seven)\b/.exec(lower);
      if (wordMatch) return 'Year ' + YEAR_WORDS[wordMatch[1]];
      return raw;
    }

    function networkInitials(name) {
      var parts = (name || '').trim().split(/\s+/);
      if (!parts.length || !parts[0]) return '?';
      var first = parts[0].charAt(0);
      var last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
      return (first + last).toUpperCase();
    }

    function updateNetworkCount(n) {
      var el = document.getElementById('network-count');
      if (el) el.textContent = n + (n === 1 ? ' person' : ' people') + ' in the network';
    }

    function renderNetworkMembers(members) {
      var wrap = document.getElementById('network-members-sections');
      var byCourse = {};
      buildNetworkCourseCanon(members);
      members.forEach(function (m) {
        var course = networkCourseLabel((m.course || '').trim()) || 'Course not set';
        if (!byCourse[course]) byCourse[course] = [];
        byCourse[course].push(m);
      });

      var courses = Object.keys(byCourse).sort(function (a, b) {
        var diff = courseSortKey(a) - courseSortKey(b);
        return diff !== 0 ? diff : a.localeCompare(b);
      });

      networkCourseAccents = {};
      wrap.innerHTML = courses.map(function (course, i) {
        var colors = NETWORK_ACCENT_COLORS[NETWORK_ACCENTS[i % NETWORK_ACCENTS.length]];
        networkCourseAccents[course] = colors;
        Object.keys(networkCourseCanon).forEach(function (raw) {
          if (networkCourseCanon[raw] === course) networkCourseAccents[raw] = colors;
        });
        var courseMembers = byCourse[course];

        var byYear = {};
        courseMembers.forEach(function (m) {
          var year = yearGroupLabel(m.year_of_study);
          if (!byYear[year]) byYear[year] = [];
          byYear[year].push(m);
        });
        var years = Object.keys(byYear).sort(function (a, b) {
          var diff = yearSortKey(a) - yearSortKey(b);
          return diff !== 0 ? diff : a.localeCompare(b);
        });

        var yearGroupsHtml = years.map(function (year) {
          var yearMembers = byYear[year].slice().sort(function (a, b) {
            return (a.full_name || '').localeCompare(b.full_name || '');
          });
          return '<div class="network-year-group">' +
            '<h3 class="network-year-label">' + escapeHtml(year) + '</h3>' +
            '<div class="network-grid">' + yearMembers.map(renderNetworkMemberCard).join('') + '</div>' +
            '</div>';
        }).join('');

        return '<div class="network-course-section" style="--network-accent:' + colors.accent + '; --network-accent-light:' + colors.light + '; --network-accent-bg:' + colors.bg + ';">' +
          '<div class="network-course-head"><h2>' + escapeHtml(course) + '</h2><span class="network-course-count">' + courseMembers.length + (courseMembers.length === 1 ? ' member' : ' members') + '</span></div>' +
          yearGroupsHtml +
          '</div>';
      }).join('');
    }

    function renderNetworkMemberCard(m) {
      // A pending row (added before they've signed up) always shows a
      // plain "Pending" badge — even if they're destined to be
      // committee once they join, they aren't yet, so the committee
      // gold treatment is reserved for confirmed members.
      var roleLabel = m.is_pending ? 'Pending' : (m.committee_role || NETWORK_TYPE_LABELS[m.member_type] || 'Member');
      var badgeHtml = roleLabel ? '<span class="network-card-badge">' + escapeHtml(roleLabel) + '</span>' : '';
      var linkedinHtml = safeUrl(m.linkedin_url) ? '<span class="network-card-linkedin" aria-hidden="true">' + NETWORK_LINKEDIN_ICON + '</span>' : '';
      var isCommittee = !m.is_pending && (m.member_type === 'executive_committee' || m.member_type === 'supporting_committee');
      var cardClass = 'network-card' + (isCommittee ? ' network-card--committee' : '') + (m.is_pending ? ' network-card--pending' : '');
      return '<button type="button" class="' + cardClass + '" data-network-type="member" data-network-id="' + m.id + '">' +
        linkedinHtml +
        '<span class="network-card-avatar">' + escapeHtml(networkInitials(m.full_name)) + '</span>' +
        '<span class="network-card-name">' + escapeHtml(m.full_name) + '</span>' +
        '<span class="network-card-meta">' + escapeHtml([networkCourseLabel(m.course), m.year_of_study ? yearGroupLabel(m.year_of_study) : ''].filter(Boolean).join(' · ') || '-') + '</span>' +
        badgeHtml +
        '</button>';
    }

    function renderNetworkProfessionals(rows) {
      var gridWrap = document.getElementById('network-professionals-wrap');
      var grid = document.getElementById('network-professionals-grid');
      if (!rows.length) return;
      gridWrap.style.display = '';
      var sorted = rows.slice().sort(function (a, b) {
        return (a.full_name || '').localeCompare(b.full_name || '');
      });
      grid.innerHTML = sorted.map(renderNetworkProfessionalCard).join('');
    }

    function renderNetworkProfessionalCard(p) {
      var linkedinHtml = safeUrl(p.linkedin_url) ? '<span class="network-card-linkedin" aria-hidden="true">' + NETWORK_LINKEDIN_ICON + '</span>' : '';
      var proSafePhoto = safeUrl(p.photo_url);
      var avatarHtml = proSafePhoto
        ? '<img src="' + proSafePhoto + '" alt="">'
        : escapeHtml(networkInitials(p.full_name));
      return '<button type="button" class="network-card network-card--professional" data-network-type="professional" data-network-id="' + p.id + '">' +
        linkedinHtml +
        '<span class="network-card-avatar">' + avatarHtml + '</span>' +
        '<span class="network-card-name">' + escapeHtml(p.full_name) + '</span>' +
        '<span class="network-card-meta">' + escapeHtml(p.title) + '</span>' +
        '<span class="network-card-badge">' + escapeHtml(PROFESSIONAL_CATEGORY_LABELS[p.category] || 'Professional') + '</span>' +
        '</button>';
    }

    function wireNetworkInteractions() {
      networkContent.addEventListener('click', function (e) {
        var card = e.target.closest('.network-card');
        if (!card) return;
        openNetworkModal(card.getAttribute('data-network-id'), card.getAttribute('data-network-type'));
      });

      document.querySelectorAll('[data-network-modal-close]').forEach(function (el) {
        el.addEventListener('click', closeNetworkModal);
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeNetworkModal();
      });

      var searchInput = document.getElementById('network-search-input');
      if (searchInput) {
        searchInput.addEventListener('input', function () {
          var query = searchInput.value.trim().toLowerCase();
          var anyVisible = false;

          document.querySelectorAll('.network-card').forEach(function (card) {
            var name = card.querySelector('.network-card-name').textContent.toLowerCase();
            var match = !query || name.indexOf(query) !== -1;
            card.classList.toggle('is-hidden-by-search', !match);
            if (match) anyVisible = true;
          });
          document.querySelectorAll('.network-year-group').forEach(function (group) {
            group.classList.toggle('is-hidden-by-search', !group.querySelector('.network-card:not(.is-hidden-by-search)'));
          });
          document.querySelectorAll('.network-course-section').forEach(function (section) {
            section.classList.toggle('is-hidden-by-search', !section.querySelector('.network-card:not(.is-hidden-by-search)'));
          });
          var profWrap = document.getElementById('network-professionals-wrap');
          if (networkAllProfessionals.length) {
            profWrap.classList.toggle('is-hidden-by-search', !profWrap.querySelector('.network-card:not(.is-hidden-by-search)'));
          }

          document.getElementById('network-search-empty').style.display = anyVisible ? 'none' : 'block';
          updateNetworkCount(document.querySelectorAll('.network-card:not(.is-hidden-by-search)').length);
        });
      }
    }

    function openNetworkModal(id, type) {
      var record = type === 'member'
        ? networkAllMembers.filter(function (m) { return m.id === id; })[0]
        : networkAllProfessionals.filter(function (p) { return String(p.id) === id; })[0];
      if (!record) return;

      var modal = document.getElementById('network-modal');
      var body = document.getElementById('network-modal-body');
      var linkedinBtn = function (url) {
        var safe = safeUrl(url);
        return safe ? '<a class="network-modal-linkedin" href="' + safe + '" target="_blank" rel="noopener">' + NETWORK_LINKEDIN_ICON + 'View LinkedIn</a>' : '';
      };

      if (type === 'member') {
        var roleLabel = record.is_pending ? 'Pending' : (record.committee_role || NETWORK_TYPE_LABELS[record.member_type] || 'Member');
        var bioHtml = record.is_pending
          ? '<p class="network-modal-bio" style="font-style:italic; color: var(--color-text-faint);">Still finishing sign-up - their full profile will appear here once they\'ve joined LACMS.</p>'
          : (record.bio
              ? '<p class="network-modal-bio">' + escapeHtml(record.bio) + '</p>'
              : '<p class="network-modal-bio" style="font-style:italic; color: var(--color-text-faint);">No bio added yet.</p>');
        body.innerHTML =
          '<span class="network-modal-avatar" style="background: var(--color-bg-alt); color: var(--color-gold-light);">' + escapeHtml(networkInitials(record.full_name)) + '</span>' +
          '<h2 class="network-modal-name" id="network-modal-name">' + escapeHtml(record.full_name) + '</h2>' +
          (roleLabel ? '<p class="network-modal-role">' + escapeHtml(roleLabel) + '</p>' : '') +
          '<p class="network-modal-meta">' + escapeHtml([networkCourseLabel(record.course), record.year_of_study ? yearGroupLabel(record.year_of_study) : ''].filter(Boolean).join(' · ') || '-') + '</p>' +
          bioHtml +
          linkedinBtn(record.linkedin_url);
      } else {
        var modalSafePhoto = safeUrl(record.photo_url);
        var avatarHtml = modalSafePhoto
          ? '<img src="' + modalSafePhoto + '" alt="">'
          : escapeHtml(networkInitials(record.full_name));
        body.innerHTML =
          '<span class="network-modal-avatar" style="background: var(--color-bg-alt); color: var(--color-gold-light);">' + avatarHtml + '</span>' +
          '<h2 class="network-modal-name" id="network-modal-name">' + escapeHtml(record.full_name) + '</h2>' +
          '<p class="network-modal-role">' + escapeHtml(record.title) + '</p>' +
          (record.organisation ? '<p class="network-modal-meta">' + escapeHtml(record.organisation) + '</p>' : '') +
          (record.bio ? '<p class="network-modal-bio">' + escapeHtml(record.bio) + '</p>' : '') +
          linkedinBtn(record.linkedin_url);
      }

      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }

    function closeNetworkModal() {
      var modal = document.getElementById('network-modal');
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }
  }

  // ---- Platform activity dashboard — client-side checks here are only
  // ever a UX shortcut (redirect away / hide a card, don't bother
  // rendering). The real security boundary is is_dashboard_admin() (or,
  // for the three president-only cards, is_president() specifically)
  // inside every RPC and RLS policy behind this page, which raises/
  // denies for anyone else regardless of what this page does.
  //
  // Two roles can land here: the president (full access, all eight
  // cards) and an Executive Committee member (member_type =
  // 'executive_committee' on their own members row) — restricted to
  // MMG, Sankofa, Nominations, Events and Gallery. User Activity,
  // Create Account and Manage Accounts stay president-only, since
  // those touch full account rosters and the ability to create/edit/
  // delete anyone's login — a materially bigger trust boundary than
  // reviewing applications or curating the gallery. ----
  var presidentContent = document.getElementById('president-content');
  if (presidentContent) {
    var presidentAuthGate = document.getElementById('auth-gate');
    var presidentHubError = document.getElementById('hub-error');
    var ONLINE_WINDOW_MS = 5 * 60 * 1000;
    var presidentUserId = null;
    var dashboardRole = null;
    // The five sections non-presidents can be given (by Hub Access rules),
    // and which rule feature controls each.
    var DASH_SHARED_SECTIONS = ['mmg', 'sankofa', 'motm', 'events', 'gallery'];
    var DASH_FEATURE_FOR = { mmg: 'dash_mmg', sankofa: 'dash_sankofa', motm: 'dash_motm', events: 'dash_events', gallery: 'dash_gallery' };
    var dashAllowed = {};
    // President: everything. Anyone else: only the shared sections the
    // rules allow - never the president-only ones (accounts, activity,
    // requests, hub access).
    function dashCan(section) {
      if (dashboardRole === 'president') return true;
      return DASH_SHARED_SECTIONS.indexOf(section) !== -1 && !!dashAllowed[section];
    }
    var PRESIDENT_ONLY_SECTIONS = ['activity', 'webactivity', 'requests', 'access', 'create', 'manage'];

    function enterDashboard(session, role) {
      presidentUserId = session.user.id;
      dashboardRole = role;
      if (role !== 'president') {
        PRESIDENT_ONLY_SECTIONS.concat(DASH_SHARED_SECTIONS).forEach(function (section) {
          if (dashCan(section)) return;
          var card = document.querySelector('[data-dash-section="' + section + '"]');
          if (card) card.style.display = 'none';
        });
      }
      initDashNav();
      loadPresidentDashboard();
      // Keeps "online now" honest without needing a manual reload —
      // only while the tab is actually visible, so it isn't polling
      // Supabase in the background for a tab nobody's looking at.
      setInterval(function () {
        if (document.visibilityState !== 'visible') return;
        loadPresidentDashboard();
        // Website Activity has its own independent load (a different
        // shape of data, fetched by range rather than all at once) - if
        // it's the section currently open, keep its "live now" count and
        // today's numbers fresh too, same 45s cadence as everything else.
        if (currentOpenSection === 'webactivity') loadWebActivity();
      }, 45000);
    }

    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (!session) {
        window.location.href = 'member-login.html';
        return;
      }
      if (session.user.id === PRESIDENT_UID) {
        enterDashboard(session, 'president');
        return;
      }
      // Anyone else gets exactly the dashboard sections the Hub Access
      // rules give them (default: Executive Committee, all five). If the
      // rules can't be loaded, the original rule: Executive Committee
      // members get all five.
      getHubAccess().then(function (access) {
        if (access) {
          DASH_SHARED_SECTIONS.forEach(function (sec) {
            dashAllowed[sec] = !!(access[DASH_FEATURE_FOR[sec]] && access[DASH_FEATURE_FOR[sec]].allowed);
          });
          if (DASH_SHARED_SECTIONS.some(function (sec) { return dashAllowed[sec]; })) {
            enterDashboard(session, 'exec_committee');
          } else {
            window.location.href = 'member-hub.html';
          }
          return;
        }
        supabaseClient
          .from('members')
          .select('member_type')
          .eq('id', session.user.id)
          .maybeSingle()
          .then(function (memberResult) {
            if (memberResult.data && memberResult.data.member_type === 'executive_committee') {
              DASH_SHARED_SECTIONS.forEach(function (sec) { dashAllowed[sec] = true; });
              enterDashboard(session, 'exec_committee');
              return;
            }
            window.location.href = 'member-hub.html';
          });
      });
    });

    // ---- Landing grid of section cards, replacing one long scroll —
    // click a card to see just that section, "All sections" to go back.
    // Data for every section still loads together up front (cheap — a
    // handful of indexed RPC calls), only the *display* is split by
    // section; #<section> in the URL deep-links straight to one. ----
    var DASH_SECTIONS = ['activity', 'webactivity', 'mmg', 'sankofa', 'motm', 'events', 'gallery', 'requests', 'access', 'create', 'manage'];
    var dashLanding = document.getElementById('dash-landing');
    var currentOpenSection = null;
    function showDashSection(section) {
      if (DASH_SECTIONS.indexOf(section) === -1) section = null;
      // Defensive, not the real gate — a stale bookmark or shared link
      // pointing at a president-only section (e.g. #manage) for an
      // Executive Committee member falls back to the landing grid
      // instead of opening an empty, error-filled panel; the RPCs
      // behind it would refuse the data either way.
      if (section && !dashCan(section)) {
        section = null;
      }
      currentOpenSection = section;
      if (dashLanding) dashLanding.style.display = section ? 'none' : '';
      DASH_SECTIONS.forEach(function (s) {
        var panel = document.getElementById('dash-panel-' + s);
        if (panel) panel.style.display = s === section ? '' : 'none';
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function initDashNav() {
      document.querySelectorAll('[data-dash-section]').forEach(function (card) {
        card.addEventListener('click', function () {
          var section = card.getAttribute('data-dash-section');
          showDashSection(section);
          window.history.replaceState(null, '', '#' + section);
          if (section === 'webactivity') loadWebActivity();
          if (section === 'access' && dashboardRole === 'president') loadHubAccess();
        });
      });
      document.querySelectorAll('[data-dash-back]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          showDashSection(null);
          window.history.replaceState(null, '', window.location.pathname);
        });
      });
      document.querySelectorAll('#activity-range-tabs [data-activity-range]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          loadWebActivityRange(btn.getAttribute('data-activity-range'));
        });
      });
      var initialSection = (window.location.hash || '').replace('#', '');
      if (DASH_SECTIONS.indexOf(initialSection) !== -1) {
        showDashSection(initialSection);
        if (initialSection === 'webactivity') loadWebActivity();
        if (initialSection === 'access' && dashboardRole === 'president') loadHubAccess();
      }
    }
    function setDashCount(section, text) {
      var el = document.getElementById('dash-count-' + section);
      if (el) el.textContent = text;
    }

    // A failed RPC used to just render nothing — no list, no "nothing
    // here yet" message, no error — which looks exactly like "this
    // feature has no data" from the outside, when the real story is
    // "the load failed." This puts an actual, visible error in the
    // section's own empty-state slot instead, and reddens the card
    // count so it's obvious from the landing grid too.
    function showSectionLoadError(listId, emptyId, countSection, errorMessage) {
      var listEl = document.getElementById(listId);
      var emptyEl = document.getElementById(emptyId);
      if (listEl) listEl.innerHTML = '';
      if (emptyEl) {
        // This page is president/Executive Committee only, so the raw
        // Postgres/PostgREST error is safe (and far more useful than a
        // generic message) to show right here — no need to dig through
        // devtools to diagnose a migration that hasn't run yet or a
        // broken RPC.
        emptyEl.textContent = "Couldn't load this section" + (errorMessage ? ': ' + errorMessage : '') + " - try refreshing, or email acms@lincolnsu.com if this doesn't resolve soon.";
        emptyEl.style.color = '#ef8b8f';
        emptyEl.style.display = 'block';
      }
      if (countSection) setDashCount(countSection, 'Failed to load');
    }

    function loadPresidentDashboard() {
      // Re-beats the president's own presence every single time this
      // runs (initial load, the 45s auto-refresh, and manual refresh
      // alike) rather than relying on the separate site-wide heartbeat's
      // own independent timing — whoever is looking at this page right
      // now is, by definition, using the site right now, so their own
      // row should never be able to go stale while they're on it.
      var beatOwnPresence = presidentUserId
        ? supabaseClient.from('member_presence').upsert({ id: presidentUserId, last_seen_at: new Date().toISOString() })
        : Promise.resolve();

      // The three president-only RPCs behind User Activity/Manage
      // Accounts are simply never called for an Executive Committee
      // session — they'd raise "Not authorized" anyway (migration 037
      // kept them is_president()-only), so there's no reason to fire a
      // request that can only fail. Placeholder empty results keep the
      // results array the same shape either way, so every index below
      // still lines up regardless of role.
      var isPresident = dashboardRole === 'president';
      beatOwnPresence.then(function () {
        return Promise.all([
          isPresident ? supabaseClient.rpc('president_get_members') : Promise.resolve({ data: [], error: null }),
          isPresident ? supabaseClient.rpc('president_get_pending_members') : Promise.resolve({ data: [], error: null }),
          isPresident ? supabaseClient.rpc('president_get_professionals') : Promise.resolve({ data: [], error: null }),
          dashCan('mmg') ? supabaseClient.rpc('president_get_mmg_guests') : Promise.resolve({ data: [], error: null }),
          dashCan('sankofa') ? supabaseClient.rpc('president_get_sankofa_applications') : Promise.resolve({ data: [], error: null }),
          dashCan('sankofa') ? supabaseClient.rpc('president_get_sankofa_mentor_applications') : Promise.resolve({ data: [], error: null }),
          dashCan('motm') ? supabaseClient.rpc('president_get_motm_nominations') : Promise.resolve({ data: [], error: null }),
          dashCan('events') ? supabaseClient.rpc('president_get_event_registrations') : Promise.resolve({ data: [], error: null }),
          isPresident ? supabaseClient.rpc('president_get_account_requests') : Promise.resolve({ data: [], error: null }),
          isPresident
            ? supabaseClient.from('account_request_emails').select('*').order('created_at', { ascending: false })
            : Promise.resolve({ data: [], error: null })
        ]);
      }).then(function (results) {
        if (presidentAuthGate) presidentAuthGate.style.display = 'none';

        if ((isPresident && (results[0].error || results[1].error || results[2].error)) || (dashCan('mmg') && results[3].error)) {
          showMessage(presidentHubError, "Couldn't load the dashboard right now - try refreshing, or email acms@lincolnsu.com if this doesn't resolve soon.");
          return;
        }

        presidentContent.style.display = '';

        var mmgGuests = results[3].data || [];

        if (isPresident) {
          var members = results[0].data || [];
          var pendingMembers = results[1].data || [];
          var professionals = results[2].data || [];
          var courseAccent = buildCourseAccentMap(members);

          renderOnlineNow(members, professionals, mmgGuests, courseAccent);
          renderStats(members, pendingMembers, professionals, mmgGuests);
          renderAttentionList(members, pendingMembers, professionals, mmgGuests);
          renderPeopleSection(members, professionals, courseAccent);
          var activityTotal = members.length + professionals.length + mmgGuests.length + pendingMembers.length;
          setDashCount('activity', activityTotal + (activityTotal === 1 ? ' account' : ' accounts'));
          renderManageAccountsList(members, professionals, mmgGuests);
          setDashCount('manage', activityTotal + (activityTotal === 1 ? ' account' : ' accounts'));
        }

        if (dashCan('mmg')) {
          renderMmgSection(mmgGuests);
          setDashCount('mmg', mmgGuests.length + (mmgGuests.length === 1 ? ' guest' : ' guests'));
        }

        // Sankofa mentee applications (migration 028) and mentor
        // applications (migration 029, a separate public no-account
        // table) are two different shapes fetched from two different
        // RPCs — normalised into one list here so the dashboard can show
        // and filter them together. Whatever succeeds still renders even
        // if the other RPC errors (e.g. a migration hasn't been run yet
        // on this database) — a missing newer feature shouldn't take
        // down the older one. Either error is still surfaced, though —
        // silently showing "no applications" when the real story is "the
        // load failed" is exactly the kind of thing that looks like a
        // missing submission but isn't.
        if (results[4].error) console.error('Sankofa mentee applications failed to load:', results[4].error.message);
        if (results[5].error) console.error('Sankofa mentor applications failed to load:', results[5].error.message);
        var mentees = results[4].error ? [] : (results[4].data || []);
        var mentors = results[5].error ? [] : (results[5].data || []).map(function (m) {
          return {
            id: m.id,
            applicant_type: 'mentor',
            full_name: m.full_name,
            email: m.email,
            created_at: m.created_at,
            job_title: m.job_title,
            organisation: m.organisation,
            linkedin_url: m.linkedin_url,
            offer_statement: m.offer_statement,
            status: m.status
          };
        });
        var sankofaMerged = mentees.concat(mentors).sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
        if (!dashCan('sankofa')) {
          // not shown to this person - nothing to render
        } else if (results[4].error && results[5].error) {
          showSectionLoadError('sankofa-applications-list', 'sankofa-applications-empty', 'sankofa', results[4].error.message);
        } else {
          renderSankofaApplications(sankofaMerged);
          setDashCount('sankofa', sankofaMerged.length + (sankofaMerged.length === 1 ? ' application' : ' applications') + (results[4].error || results[5].error ? ' (partial - see console)' : ''));
        }

        if (!dashCan('motm')) {
          // not shown to this person
        } else if (results[6].error) {
          console.error('MoTM nominations failed to load:', results[6].error.message);
          showSectionLoadError('motm-nominations-list', 'motm-nominations-empty', 'motm', results[6].error.message);
        } else {
          var motmList = results[6].data || [];
          renderMotmNominations(motmList);
          setDashCount('motm', motmList.length + (motmList.length === 1 ? ' nomination' : ' nominations'));
        }
        if (!dashCan('events')) {
          // not shown to this person
        } else if (results[7].error) {
          console.error('Event registrations failed to load:', results[7].error.message);
          showSectionLoadError('event-registrations-sections', 'event-registrations-empty', 'events', results[7].error.message);
        } else {
          var eventsList = results[7].data || [];
          renderEventRegistrations(eventsList);
          setDashCount('events', eventsList.length + (eventsList.length === 1 ? ' registration' : ' registrations'));
        }
        if (isPresident) {
          if (results[8].error) {
            console.error('Account requests failed to load:', results[8].error.message);
            showSectionLoadError('account-requests-list', 'account-requests-empty', 'requests', results[8].error.message);
          } else {
            var accountRequestsList = results[8].data || [];
            if (results[9].error) console.warn('Account request email log failed to load (has migration 057 been run?):', results[9].error.message);
            accountRequestEmailsAll = results[9].error ? [] : (results[9].data || []);
            renderAccountRequests(accountRequestsList);
            var pendingCount = accountRequestsList.filter(function (r) { return r.status === 'pending'; }).length;
            setDashCount('requests', pendingCount + ' pending');
          }
        }
        if (dashCan('gallery')) {
          loadGallerySubmissions();
          loadGalleryManage();
        }

        dashLastLoaded = new Date();
        var updatedLabel = document.getElementById('dash-updated-label');
        if (updatedLabel) updatedLabel.textContent = 'Updated just now';

        // Search filters this freshly-rendered DOM immediately, so
        // switching between an auto-refresh and an active search term
        // never shows a stale, unfiltered flash.
        if (dashSearchInput && dashSearchInput.value.trim()) {
          dashSearchInput.dispatchEvent(new Event('input'));
        }
      });
    }

    // The single source of truth for "how recently was this person
    // active" — genuinely the more recent of the two signals available,
    // not just whichever field happens to be non-null. last_seen_at is
    // the client-side 30-second heartbeat; last_sign_in_at is Supabase's
    // own server-side timestamp, set the instant a sign-in succeeds, no
    // JS execution required afterward. Comparing both and taking
    // whichever is actually newer means neither can mask a more recent
    // one from the other (this used to just prefer last_seen_at
    // unconditionally, which could show a stale sign-in from days ago
    // over a real one from an hour ago whenever that one visit's
    // heartbeat hadn't landed — a closed tab, a phone locked before the
    // first beat fires, a flaky connection).
    function presidentLastActivity(row) {
      var seenAt = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
      var signedInAt = row.last_sign_in_at ? new Date(row.last_sign_in_at).getTime() : 0;
      if (!seenAt && !signedInAt) return null;
      return seenAt >= signedInAt ? row.last_seen_at : row.last_sign_in_at;
    }

    // Online/active status now reads purely from real activity evidence
    // (the function above) — it no longer requires activated_at to be
    // set first. That gate used to hide genuine, recent usage the
    // moment activated_at itself was wrong for any reason (this
    // project's own history has a documented case of exactly that, see
    // migration 027) — someone could be demonstrably signing in and
    // using the site today and still show "hasn't opened invite"
    // because a separate bookkeeping flag never got set. A real
    // timestamp — a heartbeat, or Supabase's own sign-in record — is
    // direct proof of use and shouldn't need a second flag to agree
    // with it before it's trusted. activated_at still matters
    // elsewhere: the "Needs a nudge" list and the "Mark active" button
    // are unaffected by this and keep tracking it exactly as before, so
    // nothing about *that* tracking is lost — this only changes what
    // the status pill itself is willing to believe.
    function presidentIsOnline(row) {
      var lastActivity = presidentLastActivity(row);
      if (!lastActivity) return false;
      return (Date.now() - new Date(lastActivity).getTime()) < ONLINE_WINDOW_MS;
    }

    // Most-recently-active first, across every roster on the page —
    // whoever's using the site right now (or most recently did) always
    // rises to the top, rather than being buried inside a course/year
    // group. Anyone with no activity at all (never signed in) sorts to
    // the bottom, alphabetically among themselves.
    function dashByActivity(a, b) {
      var ta = presidentLastActivity(a);
      var tb = presidentLastActivity(b);
      var na = ta ? new Date(ta).getTime() : -1;
      var nb = tb ? new Date(tb).getTime() : -1;
      if (na !== nb) return nb - na;
      return (a.full_name || '').localeCompare(b.full_name || '');
    }

    // Real activity evidence always wins first — "Online now" if it's
    // within the last five minutes, otherwise "Active · X ago" with
    // whatever timestamp that evidence actually is (their most recent
    // sign-in, even from the invite link itself, is still real
    // evidence of when they last touched the account). activated_at
    // only comes into play once there's no activity evidence at all: a
    // plain "Active" for someone the president has manually confirmed
    // with "Mark active" but who has no tracked timestamp yet, and
    // "Hasn't opened invite" for genuinely nothing at all.
    function presidentStatus(row) {
      var lastActivity = presidentLastActivity(row);
      if (lastActivity) {
        if ((Date.now() - new Date(lastActivity).getTime()) < ONLINE_WINDOW_MS) {
          return { label: 'Online now', cls: 'online' };
        }
        return { label: 'Active · ' + timeAgo(lastActivity), cls: 'active' };
      }
      if (row.activated_at) {
        return { label: 'Active', cls: 'active' };
      }
      return { label: "Hasn't opened invite", cls: 'unopened' };
    }

    function presidentInitials(name) {
      var parts = (name || '').trim().split(/\s+/);
      if (!parts.length || !parts[0]) return '?';
      var first = parts[0].charAt(0);
      var last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
      return (first + last).toUpperCase();
    }

    function renderRosterRow(name, detail, row, type, accent) {
      var status = presidentStatus(row);
      var activatedLabel = row.activated_at ? timeAgo(row.activated_at) : '-';
      var loginLabel = row.last_sign_in_at ? timeAgo(row.last_sign_in_at) : '-';
      // Whether someone genuinely finished setting up can't always be
      // told apart from "only ever opened the invite" using the data
      // available — this is the manual override for when you actually
      // know, from talking to them, that they did.
      var markActiveBtn = (!row.activated_at && row.id)
        ? '<button type="button" class="roster-mark-active" data-mark-active data-id="' + escapeHtml(row.id) + '" data-type="' + escapeHtml(type || 'member') + '">Mark active</button>'
        : '';
      // A member's avatar carries their course's Network colour; a
      // professional/MMG guest keeps their fixed type colour from the
      // roster-avatar--{type} class instead (no accent passed for those).
      var avatarStyle = accent && DASH_ACCENT_COLORS[accent]
        ? ' style="background:' + DASH_ACCENT_COLORS[accent].bg + '; color:' + DASH_ACCENT_COLORS[accent].fg + ';"'
        : '';
      return '<div class="roster-row" data-name="' + escapeHtml((name || '').toLowerCase()) + '">' +
        '<div class="roster-main">' +
        '<span class="roster-avatar roster-avatar--' + (type || 'member') + '"' + avatarStyle + '>' + escapeHtml(presidentInitials(name)) + '</span>' +
        '<div class="roster-info"><div class="roster-name">' + escapeHtml(name || 'Unnamed') + '</div>' +
        (detail ? '<div class="roster-detail">' + escapeHtml(detail) + '</div>' : '') +
        '</div></div>' +
        '<span class="roster-status roster-status--' + status.cls + '">' + escapeHtml(status.label) + '</span>' +
        '<span class="roster-time" data-label="Set up">' + escapeHtml(activatedLabel) + '</span>' +
        '<span class="roster-time" data-label="Last login">' + escapeHtml(loginLabel) + '</span>' +
        markActiveBtn +
        '</div>';
    }

    function renderStats(members, pendingMembers, professionals, mmgGuests) {
      var real = members.concat(professionals).concat(mmgGuests);
      var onlineCount = real.filter(presidentIsOnline).length;
      var activatedCount = real.filter(function (r) { return !!r.activated_at; }).length;
      var needsAttentionCount = real.filter(function (r) { return !r.activated_at; }).length + pendingMembers.length;
      var totalCount = real.length + pendingMembers.length;

      var stats = [
        { num: totalCount, label: 'Total accounts', cls: 'total' },
        { num: onlineCount, label: 'Online now', cls: 'online' },
        { num: activatedCount, label: 'Fully set up', cls: 'setup' },
        { num: needsAttentionCount, label: 'Needs a nudge', cls: 'pending' }
      ];
      document.getElementById('dash-stats').innerHTML = stats.map(function (s) {
        return '<div class="dash-stat dash-stat--' + s.cls + '"><div class="dash-stat-num">' + s.num + '</div><div class="dash-stat-label">' + escapeHtml(s.label) + '</div></div>';
      }).join('');
    }

    // ---------------------------------------------------------------
    // Website Activity (president-only) — real page-view traffic across
    // the whole public site, from db/migrations/040's page_views table.
    // Loaded independently of the main Promise.all above (it's a
    // different data shape, fetched by range rather than all at once):
    // once when the panel first opens or a #webactivity link is
    // followed, again on every range-tab click, and folded into the
    // existing 45s auto-refresh while this panel is the one on screen.
    // ---------------------------------------------------------------
    var PAGE_FRIENDLY_NAMES = {
      'index.html': 'Homepage',
      'about.html': 'About us',
      'events.html': 'Events',
      'programmes.html': 'Programmes',
      'opportunities.html': 'Opportunities',
      'motm.html': 'Member of the Month',
      'news.html': 'News',
      'gallery.html': 'Gallery',
      'join.html': 'Join LACMS',
      'login.html': 'Login (choose account type)',
      'member-login.html': 'Member login',
      'member-hub.html': 'Member hub',
      'member-network.html': 'Network',
      'member-perks.html': 'Perks & discounts',
      'member-sankofa.html': 'Sankofa application',
      'sankofa.html': 'Sankofa Mentorship',
      'mmg.html': 'MMG (public page)',
      'mmg-login.html': 'MMG login',
      'mmg-hub.html': 'MMG hub',
      'president-dashboard.html': 'President dashboard'
    };
    function friendlyPageName(path) { return PAGE_FRIENDLY_NAMES[path] || path; }
    function formatCount(n) { return (n || 0).toLocaleString('en-GB'); }
    function pluralise(n, noun) { return n + ' ' + noun + (n === 1 ? '' : 's'); }

    function formatBucketLabel(d, rangeKey) {
      if (rangeKey === 'today') {
        var h = d.getHours();
        if (h === 0) return '12am';
        if (h === 12) return '12pm';
        return h < 12 ? (h + 'am') : ((h - 12) + 'pm');
      }
      if (rangeKey === '7d') return d.toLocaleDateString('en-GB', { weekday: 'short' });
      if (rangeKey === '1y' || rangeKey === 'all') {
        return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
      }
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    }
    function formatBucketTooltipDate(d, rangeKey) {
      if (rangeKey === 'today') {
        return 'Today, ' + formatBucketLabel(d, 'today') + '–' + formatBucketLabel(new Date(d.getTime() + 3600000), 'today');
      }
      if (rangeKey === '1y' || rangeKey === 'all') {
        return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      }
      if (rangeKey === '90d') {
        return 'Week of ' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
      }
      return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    }
    // Showing a label under every single bar gets unreadable past ~12
    // bars (today's 24 hours, 30 days) — this thins them out to roughly
    // 8-10 evenly-spaced labels while always keeping the first and last,
    // so the chart's start/end are never ambiguous.
    function shouldShowBucketLabel(index, total) {
      if (total <= 12) return true;
      if (index === 0 || index === total - 1) return true;
      var step = Math.ceil(total / 9);
      return index % step === 0;
    }

    function renderActivitySummary(s) {
      // baseline_views/baseline_visitors (migration 041) is an optional,
      // manually-set estimate of visits before tracking existed at all -
      // site_settings.activity_baseline_views/visitors, left at 0 unless
      // the president has set one via Table Editor. It's already folded
      // into alltime_views/alltime_visitors by the RPC; this just adds a
      // one-line note so the All-time tile is honest about where the
      // extra count comes from, rather than presenting an estimate as if
      // it were exactly-tracked data.
      var baselineViews = Number(s.baseline_views) || 0;
      var alltimeSub = pluralise(s.alltime_visitors || 0, 'visitor');
      if (baselineViews > 0) {
        alltimeSub += ' · incl. ~' + formatCount(baselineViews) + ' est. before tracking';
      }
      var stats = [
        { num: s.today_views, label: 'Today', sub: pluralise(s.today_visitors || 0, 'visitor'), cls: 'today' },
        { num: s.week_views, label: 'Past 7 days', sub: pluralise(s.week_visitors || 0, 'visitor'), cls: 'week' },
        { num: s.month_views, label: 'Past 30 days', sub: pluralise(s.month_visitors || 0, 'visitor'), cls: 'month' },
        { num: s.year_views, label: 'Past year', sub: pluralise(s.year_visitors || 0, 'visitor'), cls: 'year' },
        { num: s.alltime_views, label: 'All time', sub: alltimeSub, cls: 'alltime' }
      ];
      var statsEl = document.getElementById('activity-summary-stats');
      if (!statsEl) return;
      statsEl.innerHTML = stats.map(function (st) {
        return '<div class="dash-stat dash-stat--' + st.cls + '">' +
          '<div class="dash-stat-num">' + formatCount(st.num) + '</div>' +
          '<div class="dash-stat-label">' + escapeHtml(st.label) + '</div>' +
          '<div class="dash-stat-sub">' + escapeHtml(st.sub) + '</div>' +
          '</div>';
      }).join('');
    }

    function renderActivityLive(liveCount) {
      var countEl = document.getElementById('activity-live-count');
      var wrapEl = document.getElementById('activity-live');
      if (countEl) countEl.textContent = formatCount(liveCount);
      if (wrapEl) {
        wrapEl.classList.toggle('is-empty', !liveCount);
        wrapEl.querySelector('.activity-live-label').textContent = liveCount === 1 ? 'person on the site right now' : 'people on the site right now';
      }
    }

    function renderActivityChart(rows, rangeKey) {
      var chartEl = document.getElementById('activity-chart');
      var emptyEl = document.getElementById('activity-chart-empty');
      if (!chartEl) return;
      var totalViews = rows.reduce(function (sum, r) { return sum + Number(r.views); }, 0);
      if (!rows.length || !totalViews) {
        chartEl.innerHTML = '';
        if (emptyEl) { emptyEl.style.color = ''; emptyEl.style.display = 'block'; emptyEl.textContent = 'No activity recorded yet for this range.'; }
        renderActivityBaselineNote(rangeKey);
        return;
      }
      if (emptyEl) emptyEl.style.display = 'none';
      var maxViews = Math.max.apply(null, rows.map(function (r) { return Number(r.views); }).concat([1]));
      var bars = '';
      var labels = '';
      rows.forEach(function (r, i) {
        var d = new Date(r.bucket_start);
        var pct = Math.round((Number(r.views) / maxViews) * 100);
        var tooltip = formatBucketTooltipDate(d, rangeKey) + ' · ' + pluralise(Number(r.views), 'view') + ' · ' + pluralise(Number(r.visitors), 'visitor');
        bars += '<div class="activity-bar" data-tooltip="' + escapeHtml(tooltip) + '">' +
          '<div class="activity-bar-fill" style="height:' + Math.max(pct, 2) + '%;"></div>' +
          '</div>';
        labels += '<span>' + (shouldShowBucketLabel(i, rows.length) ? escapeHtml(formatBucketLabel(d, rangeKey)) : '') + '</span>';
      });
      chartEl.innerHTML = '<div class="activity-chart-bars">' + bars + '</div><div class="activity-chart-labels">' + labels + '</div>';
      renderActivityBaselineNote(rangeKey);
    }

    // The All-time stat tile can include a manual pre-tracking estimate
    // (migration 041) that this chart never draws, since there's no way
    // to know which day(s) it belongs on - only relevant on the 'all'
    // range, where someone could otherwise notice the chart's bars add
    // up to less than the All-time tile and wonder if something's broken.
    function renderActivityBaselineNote(rangeKey) {
      var noteEl = document.getElementById('activity-chart-baseline-note');
      if (!noteEl) return;
      if (rangeKey === 'all' && activityBaselineViews > 0) {
        noteEl.textContent = 'The All-time tile above also includes an estimated ' + formatCount(activityBaselineViews) + ' visit' + (activityBaselineViews === 1 ? '' : 's') + ' from before tracking started - this chart only ever shows what was actually tracked.';
        noteEl.style.display = 'block';
      } else {
        noteEl.style.display = 'none';
      }
    }

    function renderTopPages(rows) {
      var listEl = document.getElementById('activity-top-pages');
      var emptyEl = document.getElementById('activity-top-pages-empty');
      if (!listEl) return;
      if (!rows.length) {
        listEl.innerHTML = '';
        if (emptyEl) emptyEl.style.display = 'block';
        return;
      }
      if (emptyEl) emptyEl.style.display = 'none';
      var maxViews = Math.max.apply(null, rows.map(function (r) { return Number(r.views); }).concat([1]));
      listEl.innerHTML = rows.map(function (r) {
        var pct = Math.round((Number(r.views) / maxViews) * 100);
        return '<div class="activity-page-row">' +
          '<span class="activity-page-name">' + escapeHtml(friendlyPageName(r.path)) + '</span>' +
          '<div class="activity-page-bar-track"><div class="activity-page-bar-fill" style="width:' + pct + '%;"></div></div>' +
          '<span class="activity-page-count">' + formatCount(r.views) + '</span>' +
          '</div>';
      }).join('');
    }

    var activityCurrentRange = 'today';
    var activityLoadToken = 0;
    var activityBaselineViews = 0;

    function loadWebActivitySummaryAndLive() {
      supabaseClient.rpc('president_activity_summary').then(function (result) {
        if (result.error) { console.error('Website activity summary failed to load:', result.error.message); return; }
        var row = (result.data && result.data[0]) || {};
        activityBaselineViews = Number(row.baseline_views) || 0;
        renderActivitySummary(row);
        renderActivityLive(row.live_now || 0);
        renderActivityBaselineNote(activityCurrentRange);
        setDashCount('webactivity', pluralise(row.today_views || 0, 'view') + ' today');
      });
    }

    function loadWebActivityRange(rangeKey) {
      activityCurrentRange = rangeKey;
      document.querySelectorAll('#activity-range-tabs [data-activity-range]').forEach(function (btn) {
        btn.classList.toggle('is-active', btn.getAttribute('data-activity-range') === rangeKey);
      });
      var thisLoad = ++activityLoadToken;
      Promise.all([
        supabaseClient.rpc('president_activity_series', { range_key: rangeKey }),
        supabaseClient.rpc('president_activity_top_pages', { range_key: rangeKey, limit_n: 8 })
      ]).then(function (results) {
        if (thisLoad !== activityLoadToken) return; // a newer range was picked before this one came back
        var seriesResult = results[0];
        var topPagesResult = results[1];
        if (seriesResult.error || topPagesResult.error) {
          var err = seriesResult.error || topPagesResult.error;
          console.error('Website activity range failed to load:', err.message);
          showSectionLoadError('activity-top-pages', 'activity-chart-empty', 'webactivity', err.message);
          var chartEl = document.getElementById('activity-chart');
          if (chartEl) chartEl.innerHTML = '';
          return;
        }
        renderActivityChart(seriesResult.data || [], rangeKey);
        renderTopPages(topPagesResult.data || []);
      });
    }

    function loadWebActivity() {
      loadWebActivitySummaryAndLive();
      loadWebActivityRange(activityCurrentRange);
    }

    function renderAttentionList(members, pendingMembers, professionals, mmgGuests) {
      var table = document.getElementById('attention-table');
      var emptyEl = document.getElementById('attention-empty');
      var items = [];

      members.forEach(function (m) {
        if (m.activated_at) return;
        items.push({ name: m.full_name, detail: [m.course, m.year_of_study].filter(Boolean).join(' · ') || 'LACMS member', row: m, type: 'member' });
      });
      professionals.forEach(function (p) {
        if (p.activated_at) return;
        items.push({ name: p.full_name, detail: p.title || 'Professional', row: p, type: 'professional' });
      });
      mmgGuests.forEach(function (g) {
        if (g.activated_at) return;
        items.push({ name: g.full_name, detail: g.university || 'MMG guest', row: g, type: 'mmg' });
      });
      pendingMembers.forEach(function (pm) {
        items.push({
          name: pm.full_name,
          detail: [pm.course, pm.year_of_study].filter(Boolean).join(' · ') || 'Not yet invited',
          row: {},
          type: 'member',
          isPending: true
        });
      });

      if (!items.length) {
        emptyEl.style.display = 'block';
        table.innerHTML = '';
        return;
      }
      emptyEl.style.display = 'none';
      table.innerHTML = items.map(function (it) {
        if (it.isPending) {
          return '<div class="roster-row" data-name="' + escapeHtml((it.name || '').toLowerCase()) + '">' +
            '<div class="roster-main">' +
            '<span class="roster-avatar roster-avatar--' + it.type + '">' + escapeHtml(presidentInitials(it.name)) + '</span>' +
            '<div class="roster-info"><div class="roster-name">' + escapeHtml(it.name) + '</div><div class="roster-detail">' + escapeHtml(it.detail) + '</div></div>' +
            '</div>' +
            '<span class="roster-status roster-status--unopened">Not yet invited</span>' +
            '<span class="roster-time" data-label="Set up">-</span><span class="roster-time" data-label="Last login">-</span>' +
            '</div>';
        }
        return renderRosterRow(it.name, it.detail, it.row, it.type);
      }).join('');
    }

    // Same substring-matching approach and colour cycle as the Network
    // page (course is always saved with the full degree title attached,
    // and this is the same accent language used there — Medicine gold,
    // then green/red/purple for whichever courses follow it) — dupli-
    // cated locally rather than shared since this page's script scope
    // is entirely separate from member-network.html's.
    var DASH_COURSE_ORDER = ['Medicine', 'Pharmacy', 'Dental Hygiene and Therapy', 'Diagnostic Radiography', 'Nursing', 'Midwifery', 'Biomedical Science', 'Occupational Therapy'];
    var DASH_ACCENTS = ['gold', 'green', 'red', 'purple'];
    var DASH_ACCENT_COLORS = {
      gold: { bg: 'rgba(212, 166, 43, 0.22)', fg: 'var(--color-gold-light)' },
      green: { bg: 'rgba(30, 122, 70, 0.22)', fg: '#6fcf97' },
      red: { bg: 'rgba(193, 39, 45, 0.22)', fg: '#ef8b8f' },
      purple: { bg: 'rgba(107, 70, 193, 0.24)', fg: '#b28ff0' }
    };
    function dashCourseSortKey(course) {
      var lower = (course || '').toLowerCase();
      for (var i = 0; i < DASH_COURSE_ORDER.length; i++) {
        if (lower.indexOf(DASH_COURSE_ORDER[i].toLowerCase()) !== -1) return i;
      }
      return 999;
    }

    // members are no longer visually grouped by course (sorted by
    // activity instead — see dashByActivity), but each course still
    // gets a consistent colour so it's recognisable at a glance, same
    // as a course's section colour on the Network page.
    function buildCourseAccentMap(members) {
      var courses = [];
      members.forEach(function (m) {
        var course = (m.course || '').trim() || 'Course not set';
        if (courses.indexOf(course) === -1) courses.push(course);
      });
      courses.sort(function (a, b) {
        var diff = dashCourseSortKey(a) - dashCourseSortKey(b);
        return diff !== 0 ? diff : a.localeCompare(b);
      });
      var map = {};
      courses.forEach(function (course, i) { map[course] = DASH_ACCENTS[i % DASH_ACCENTS.length]; });
      return map;
    }

    // Members and professionals share one flat roster, sorted by who's
    // been active most recently — not grouped by course/year, and not
    // segregated by account type either, so anyone active rises straight
    // to the top regardless of what they study or whether they're a
    // student or a supporting professional. A member's avatar still
    // keeps its course colour (via courseAccent, built once in
    // loadPresidentDashboard so it's identical to whatever
    // renderOnlineNow is using); a professional's stays the fixed
    // Network green from its roster-avatar--professional class.
    function renderPeopleSection(members, professionals, courseAccent) {
      var wrap = document.getElementById('people-sections');
      var total = members.length + professionals.length;
      document.getElementById('people-count-line').textContent = total + (total === 1 ? ' person' : ' people') + ' total, most recently active first';
      if (!total) {
        wrap.innerHTML = '<p style="color: var(--color-text-faint);">No members or professionals yet.</p>';
        return;
      }

      var people = members.map(function (m) { return { row: m, type: 'member' }; })
        .concat(professionals.map(function (p) { return { row: p, type: 'professional' }; }))
        .sort(function (a, b) { return dashByActivity(a.row, b.row); });

      wrap.innerHTML = '<div class="roster-table" id="people-table">' + people.map(function (person) {
        var m = person.row;
        if (person.type === 'member') {
          var courseYear = [m.course, m.year_of_study].filter(Boolean).join(' · ');
          var detail = [courseYear, m.committee_role, (m.mmg_attendee || m.mmg_committee) ? 'MMG' : null].filter(Boolean).join(' · ');
          var course = (m.course || '').trim() || 'Course not set';
          return renderRosterRow(m.full_name, detail, m, 'member', courseAccent[course]);
        }
        var proDetail = [m.title, m.organisation].filter(Boolean).join(' · ');
        return renderRosterRow(m.full_name, proDetail, m, 'professional');
      }).join('') + '</div>';
    }

    var MMG_ACCESS_LABELS = { committee: 'Committee', attendee: 'Attendee', pending: 'Pending review' };
    var MMG_ACCESS_ORDER = ['committee', 'attendee', 'pending'];
    function renderMmgSection(mmgGuests) {
      var wrap = document.getElementById('mmg-sections');
      document.getElementById('mmg-count-line').textContent = mmgGuests.length + (mmgGuests.length === 1 ? ' guest' : ' guests') + ' total';
      if (!mmgGuests.length) {
        wrap.innerHTML = '<p style="color: var(--color-text-faint);">No MMG guest accounts yet.</p>';
        return;
      }

      var byLevel = {};
      mmgGuests.forEach(function (g) {
        var level = g.access_level || 'pending';
        if (!byLevel[level]) byLevel[level] = [];
        byLevel[level].push(g);
      });
      var levels = Object.keys(byLevel).sort(function (a, b) {
        return MMG_ACCESS_ORDER.indexOf(a) - MMG_ACCESS_ORDER.indexOf(b);
      });

      wrap.innerHTML = levels.map(function (level) {
        var levelGuests = byLevel[level].slice().sort(dashByActivity);
        var rowsHtml = levelGuests.map(function (g) {
          return renderRosterRow(g.full_name, g.university, g, 'mmg');
        }).join('');
        return '<div class="dash-course-section"><h2 class="dash-course-title">' + escapeHtml(MMG_ACCESS_LABELS[level] || level) + '</h2><div class="roster-table">' + rowsHtml + '</div></div>';
      }).join('');
    }

    // ---- Manage Accounts — every member, professional and MMG guest in
    // one searchable, filterable list; click any row to edit or delete
    // it. Reuses the exact three lists already fetched for the Activity
    // and MMG cards rather than fetching again. ----
    var manageAccountsData = { member: [], professional: [], mmg: [] };
    var manageCurrentFilter = 'all';
    var manageCurrentSearch = '';
    function renderManageAccountRow(row, type) {
      var status = presidentStatus(row);
      var typeLabel = type === 'member' ? 'Member' : type === 'professional' ? 'Professional' : 'MMG guest';
      var detail;
      if (type === 'member') {
        detail = [row.course, row.year_of_study].filter(Boolean).join(' · ') || 'LACMS member';
      } else if (type === 'professional') {
        detail = [row.title, row.organisation].filter(Boolean).join(' · ') || 'Professional';
      } else {
        detail = row.university || 'MMG guest';
      }
      return '<div class="roster-row" data-manage-edit data-type="' + type + '" data-id="' + escapeHtml(row.id) + '" data-name="' + escapeHtml((row.full_name || '').toLowerCase()) + '" style="cursor:pointer;">' +
        '<div class="roster-main">' +
        '<span class="roster-avatar roster-avatar--' + type + '">' + escapeHtml(presidentInitials(row.full_name)) + '</span>' +
        '<div class="roster-info"><div class="roster-name">' + escapeHtml(row.full_name || 'Unnamed') + '</div>' +
        '<div class="roster-detail">' + escapeHtml(detail) + '</div>' +
        '</div></div>' +
        '<span class="roster-status roster-status--' + status.cls + '">' + escapeHtml(status.label) + '</span>' +
        '<span class="roster-time" data-label="Type">' + typeLabel + '</span>' +
        '<span class="roster-time" data-label="Action">Edit &rarr;</span>' +
        '</div>';
    }
    function renderManageAccountsList(members, professionals, mmgGuests) {
      manageAccountsData = { member: members, professional: professionals, mmg: mmgGuests };
      renderManageAccountsFiltered(manageCurrentFilter, manageCurrentSearch);
    }
    function renderManageAccountsFiltered(filter, search) {
      manageCurrentFilter = filter;
      manageCurrentSearch = search;
      var listEl = document.getElementById('manage-accounts-list');
      var emptyEl = document.getElementById('manage-accounts-empty');
      if (!listEl) return;
      var items = [];
      if (filter === 'all' || filter === 'member') items = items.concat(manageAccountsData.member.map(function (r) { return { row: r, type: 'member' }; }));
      if (filter === 'all' || filter === 'professional') items = items.concat(manageAccountsData.professional.map(function (r) { return { row: r, type: 'professional' }; }));
      if (filter === 'all' || filter === 'mmg') items = items.concat(manageAccountsData.mmg.map(function (r) { return { row: r, type: 'mmg' }; }));
      var q = (search || '').trim().toLowerCase();
      if (q) items = items.filter(function (it) { return (it.row.full_name || '').toLowerCase().indexOf(q) !== -1; });
      items.sort(function (a, b) { return (a.row.full_name || '').localeCompare(b.row.full_name || ''); });
      if (!items.length) {
        if (emptyEl) emptyEl.style.display = 'block';
        listEl.innerHTML = '';
        return;
      }
      if (emptyEl) emptyEl.style.display = 'none';
      listEl.innerHTML = items.map(function (it) { return renderManageAccountRow(it.row, it.type); }).join('');
    }

    // "Online right now" — its own prominent panel above everything
    // else, fed by the same three account lists as renderStats(). Member
    // chips carry the same course colour as their roster row/Network
    // card (courseAccent, built once per load in loadPresidentDashboard).
    function renderOnlineNow(members, professionals, mmgGuests, courseAccent) {
      var list = document.getElementById('online-now-list');
      var emptyEl = document.getElementById('online-now-empty');
      var countEl = document.getElementById('online-now-count');

      var online = []
        .concat(members.filter(presidentIsOnline).map(function (m) {
          var course = (m.course || '').trim() || 'Course not set';
          return { name: m.full_name, type: 'member', accent: courseAccent[course] };
        }))
        .concat(professionals.filter(presidentIsOnline).map(function (p) { return { name: p.full_name, type: 'professional' }; }))
        .concat(mmgGuests.filter(presidentIsOnline).map(function (g) { return { name: g.full_name, type: 'mmg' }; }))
        .sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });

      countEl.textContent = online.length;

      if (!online.length) {
        emptyEl.style.display = 'block';
        list.innerHTML = '';
        return;
      }
      emptyEl.style.display = 'none';
      list.innerHTML = online.map(function (person) {
        var avatarStyle = person.accent && DASH_ACCENT_COLORS[person.accent]
          ? ' style="background:' + DASH_ACCENT_COLORS[person.accent].bg + '; color:' + DASH_ACCENT_COLORS[person.accent].fg + ';"'
          : '';
        return '<div class="online-now-chip" data-name="' + escapeHtml((person.name || '').toLowerCase()) + '">' +
          '<span class="online-now-chip-avatar online-now-chip-avatar--' + person.type + '"' + avatarStyle + '>' + escapeHtml(presidentInitials(person.name)) + '</span>' +
          '<span><span class="online-now-chip-name">' + escapeHtml(person.name) + '</span> ' +
          '<span class="online-now-chip-type">' + (person.type === 'mmg' ? 'MMG' : person.type) + '</span></span>' +
          '</div>';
      }).join('');
    }

    // Search filters every roster row and online chip on the page by
    // name, cascading up to hide any course/year group that's left with
    // nothing visible inside it — the same pattern the Network page
    // uses, applied across all four sections plus the online panel at
    // once rather than per-section.
    var dashSearchInput = document.getElementById('dash-search-input');
    if (dashSearchInput) {
      dashSearchInput.addEventListener('input', function () {
        var query = dashSearchInput.value.trim().toLowerCase();
        var anyVisible = false;

        document.querySelectorAll('#president-content .roster-row, #president-content .online-now-chip').forEach(function (el) {
          var matches = !query || (el.getAttribute('data-name') || '').indexOf(query) !== -1;
          el.classList.toggle('is-hidden-by-search', !matches);
          if (matches) anyVisible = true;
        });

        document.querySelectorAll('#mmg-sections .dash-course-section').forEach(function (section) {
          var hasVisible = !!section.querySelector('.roster-row:not(.is-hidden-by-search)');
          section.classList.toggle('is-hidden-by-search', !hasVisible);
        });
        ['attention-table', 'people-table'].forEach(function (id) {
          var table = document.getElementById(id);
          if (!table) return;
          var hasVisible = !!table.querySelector('.roster-row:not(.is-hidden-by-search)');
          table.classList.toggle('is-hidden-by-search', !hasVisible && !!query);
        });

        var searchEmpty = document.getElementById('dash-search-empty');
        if (searchEmpty) searchEmpty.style.display = query && !anyVisible ? 'block' : 'none';
      });
    }

    // Live "Updated Xs ago" label + manual refresh, so the auto-refresh
    // this page already does every 45s feels visible and trustworthy
    // rather than invisible and easy to distrust.
    var dashLastLoaded = null;
    var dashRefreshBtn = document.getElementById('dash-refresh-btn');
    if (dashRefreshBtn) {
      dashRefreshBtn.addEventListener('click', function () {
        dashRefreshBtn.classList.add('is-spinning');
        loadPresidentDashboard();
        setTimeout(function () { dashRefreshBtn.classList.remove('is-spinning'); }, 600);
      });
    }
    setInterval(function () {
      var label = document.getElementById('dash-updated-label');
      if (!label || !dashLastLoaded) return;
      label.textContent = 'Updated ' + timeAgo(dashLastLoaded);
    }, 1000);

    // ---- Sankofa applications — mentees and mentors share one list,
    // filterable by the tabs above it; each card carries every field
    // from president_get_sankofa_applications() relevant to its type,
    // collapsed until clicked open. ----
    var sankofaAllApplications = [];
    var sankofaCurrentFilter = 'all';
    function appCardField(label, value) {
      if (!value) return '';
      return '<div class="app-card-field"><div class="app-card-field-label">' + escapeHtml(label) + '</div><div class="app-card-field-value">' + escapeHtml(value) + '</div></div>';
    }
    function renderSankofaApplications(list) {
      sankofaAllApplications = list;
      var countEl = document.getElementById('sankofa-count-line');
      var mentees = list.filter(function (a) { return a.applicant_type === 'mentee'; }).length;
      var mentors = list.filter(function (a) { return a.applicant_type === 'mentor'; }).length;
      if (countEl) countEl.textContent = list.length + ' total - ' + mentees + ' mentee' + (mentees === 1 ? '' : 's') + ', ' + mentors + ' mentor' + (mentors === 1 ? '' : 's');
      renderSankofaApplicationsFiltered(sankofaCurrentFilter);
    }
    function renderSankofaApplicationsFiltered(filter) {
      sankofaCurrentFilter = filter;
      var listEl = document.getElementById('sankofa-applications-list');
      var emptyEl = document.getElementById('sankofa-applications-empty');
      if (!listEl) return;
      var filtered = filter === 'all' ? sankofaAllApplications : sankofaAllApplications.filter(function (a) { return a.applicant_type === filter; });
      if (!filtered.length) {
        if (emptyEl) emptyEl.style.display = 'block';
        listEl.innerHTML = '';
        return;
      }
      if (emptyEl) emptyEl.style.display = 'none';
      listEl.innerHTML = filtered.map(renderSankofaAppCard).join('');
    }
    var MENTOR_STATUS_LABELS = { new: 'New', reviewed: 'Reviewed', contacted: 'Contacted' };
    function renderSankofaAppCard(a) {
      var isMentor = a.applicant_type === 'mentor';
      var meta = isMentor
        ? [a.job_title, a.organisation].filter(Boolean).join(' · ')
        : [a.current_stage, a.specialty_interest].filter(Boolean).join(' · ');
      var body = isMentor
        ? appCardField('Job title', a.job_title) +
          appCardField('Organisation', a.organisation) +
          appCardField('LinkedIn', a.linkedin_url) +
          appCardField('Why they want to mentor / what they offer', a.offer_statement) +
          '<div class="app-card-field"><div class="app-card-field-label">Status</div>' +
          '<div class="dash-filter-tabs" style="margin-top:0;">' +
          ['new', 'reviewed', 'contacted'].map(function (s) {
            return '<button type="button" class="dash-filter-tab' + (a.status === s ? ' is-active' : '') + '" data-mentor-status data-id="' + escapeHtml(a.id) + '" data-status="' + s + '">' + MENTOR_STATUS_LABELS[s] + '</button>';
          }).join('') +
          '</div></div>'
        : appCardField('Current stage', a.current_stage) +
          appCardField('Heritage', a.heritage) +
          appCardField('Career aspirations', a.career_aspirations) +
          appCardField('Specialty interest', a.specialty_interest) +
          appCardField('Hobbies & interests', (a.hobbies_interests || []).join(', ')) +
          appCardField('Homebody ↔ always out (1–5)', a.social_preference != null ? String(a.social_preference) : '') +
          appCardField('Fitness (1–5)', a.fitness_preference != null ? String(a.fitness_preference) : '') +
          appCardField('Solo ↔ group studier (1–5)', a.study_style != null ? String(a.study_style) : '') +
          appCardField('Academic ↔ personal support (1–5)', a.support_style != null ? String(a.support_style) : '') +
          appCardField('Communication style', a.communication_style) +
          appCardField('Meeting frequency', a.meeting_frequency) +
          appCardField('Looking for', a.looking_for) +
          appCardField('Statement', a.statement);
      return '<div class="app-card">' +
        '<div class="app-card-head" data-app-card-toggle>' +
        '<div class="app-card-head-main">' +
        '<span class="app-badge app-badge--' + (isMentor ? 'mentor' : 'mentee') + '">' + (isMentor ? 'Mentor' : 'Mentee') + '</span>' +
        '<span class="app-card-name">' + escapeHtml(a.full_name || 'Unnamed') + '</span>' +
        '<span class="app-card-meta">' + escapeHtml(meta) + (meta ? ' · ' : '') + escapeHtml(timeAgo(a.created_at)) + '</span>' +
        '</div>' +
        '<svg class="icon app-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polyline points="6 9 12 15 18 9"/></svg>' +
        '</div>' +
        '<div class="app-card-body">' + appCardField('Email', a.email) + body +
        '<button type="button" class="app-card-delete-btn" data-sankofa-delete data-id="' + escapeHtml(a.id) + '" data-type="' + (isMentor ? 'mentor' : 'mentee') + '">Delete application</button>' +
        '</div>' +
        '</div>';
    }

    // ---- MoTM nominations ----
    function renderMotmNominations(list) {
      var listEl = document.getElementById('motm-nominations-list');
      var emptyEl = document.getElementById('motm-nominations-empty');
      var countEl = document.getElementById('motm-count-line');
      if (!listEl) return;
      if (countEl) countEl.textContent = list.length + (list.length === 1 ? ' nomination' : ' nominations');
      if (!list.length) {
        if (emptyEl) emptyEl.style.display = 'block';
        listEl.innerHTML = '';
        return;
      }
      if (emptyEl) emptyEl.style.display = 'none';
      listEl.innerHTML = list.map(function (n) {
        return '<div class="app-card">' +
          '<div class="app-card-head" data-app-card-toggle>' +
          '<div class="app-card-head-main">' +
          '<span class="app-card-name">' + escapeHtml(n.nominee_name || 'Unnamed') + '</span>' +
          '<span class="app-card-meta">Nominated by ' + escapeHtml(n.nominator_name || 'someone') + ' · ' + escapeHtml(timeAgo(n.created_at)) + '</span>' +
          '</div>' +
          '<svg class="icon app-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polyline points="6 9 12 15 18 9"/></svg>' +
          '</div>' +
          '<div class="app-card-body">' + appCardField('Reason', n.reason) + appCardField('Nominator email', n.nominator_email) +
          '<button type="button" class="app-card-delete-btn" data-motm-delete data-id="' + escapeHtml(n.id) + '">Delete &amp; let them nominate again</button>' +
          '</div>' +
          '</div>';
      }).join('');
    }

    // ---- Event registrations, grouped by event ----
    function renderEventRegistrations(list) {
      var wrap = document.getElementById('event-registrations-sections');
      var emptyEl = document.getElementById('event-registrations-empty');
      var countEl = document.getElementById('event-regs-count-line');
      if (!wrap) return;
      if (countEl) countEl.textContent = list.length + (list.length === 1 ? ' registration' : ' registrations') + ' total';
      if (!list.length) {
        if (emptyEl) emptyEl.style.display = 'block';
        wrap.innerHTML = '';
        return;
      }
      if (emptyEl) emptyEl.style.display = 'none';
      var byEvent = {};
      list.forEach(function (r) {
        var key = r.event_name || r.event_slug || 'Unknown event';
        if (!byEvent[key]) byEvent[key] = [];
        byEvent[key].push(r);
      });
      var eventNames = Object.keys(byEvent).sort();
      wrap.innerHTML = eventNames.map(function (name) {
        var regs = byEvent[name].slice().sort(function (a, b) { return new Date(b.registered_at) - new Date(a.registered_at); });
        var rows = regs.map(function (r) {
          return '<div class="roster-row" data-name="' + escapeHtml((r.member_name || '').toLowerCase()) + '">' +
            '<div class="roster-main"><span class="roster-avatar">' + escapeHtml(presidentInitials(r.member_name)) + '</span>' +
            '<div class="roster-info"><div class="roster-name">' + escapeHtml(r.member_name || 'Unnamed') + '</div></div></div>' +
            '<span class="roster-time" data-label="Registered">' + escapeHtml(timeAgo(r.registered_at)) + '</span>' +
            '</div>';
        }).join('');
        return '<div class="dash-course-section"><h2 class="dash-course-title">' + escapeHtml(name) + ' (' + regs.length + ')</h2><div class="roster-table">' + rows + '</div></div>';
      }).join('');
    }

    // ---- Account requests (migration 047) — replaces the committee
    // creating every login by hand: a public, no-account form
    // (request-account.html) feeds this list, filterable by status,
    // defaulting to Pending since that's the actionable queue. Approving
    // one runs the same signUp()-then-insert mechanism as the Create
    // Account form below, just sourced from the request's own data
    // instead of typed in fresh (see approveAccountRequest). ----
    var accountRequestsAll = [];
    var accountRequestsFilter = 'pending';
    var accountRequestEmailsAll = [];
    function renderAccountRequests(list) {
      accountRequestsAll = list;
      renderAccountRequestsFiltered(accountRequestsFilter);
    }
    function renderAccountRequestsFiltered(filter) {
      accountRequestsFilter = filter;
      var listEl = document.getElementById('account-requests-list');
      var emptyEl = document.getElementById('account-requests-empty');
      var countEl = document.getElementById('account-requests-count-line');
      if (!listEl) return;
      var pendingTotal = accountRequestsAll.filter(function (r) { return r.status === 'pending'; }).length;
      if (countEl) countEl.textContent = accountRequestsAll.length + ' total - ' + pendingTotal + ' pending';
      var filtered = filter === 'all' ? accountRequestsAll : accountRequestsAll.filter(function (r) { return r.status === filter; });
      if (!filtered.length) {
        if (emptyEl) {
          emptyEl.style.display = 'block';
          emptyEl.textContent = filter === 'pending' ? "No pending requests right now - you're all caught up." : 'Nothing here.';
        }
        listEl.innerHTML = '';
        return;
      }
      if (emptyEl) emptyEl.style.display = 'none';
      listEl.innerHTML = renderBulkApprovalBar() + filtered.map(renderAccountRequestCard).join('');
    }

    // Approved requests that have no successful approval email logged -
    // e.g. approved while sending was misconfigured, or before the email
    // log existed. One click sends all of them (see the bulk handler).
    function requestsMissingApprovalEmail() {
      return accountRequestsAll.filter(function (r) {
        return r.status === 'approved' && !accountRequestEmailsAll.some(function (m) {
          return m.request_id === r.id && m.email_type === 'approved' && m.status === 'sent';
        });
      });
    }
    function renderBulkApprovalBar() {
      var missing = requestsMissingApprovalEmail();
      if (!missing.length) return '';
      return '<div class="app-card" style="padding: var(--space-3); display:flex; align-items:center; justify-content:space-between; gap: var(--space-2); flex-wrap:wrap;">' +
        '<span style="font-size:0.88rem;">' + missing.length + (missing.length === 1 ? ' approved account has' : ' approved accounts have') + ' no approval email sent yet.</span>' +
        '<button type="button" class="btn btn-primary request-email-btn" data-request-email-bulk>Send approval email to ' + (missing.length === 1 ? 'them' : 'all ' + missing.length) + '</button>' +
        '</div>';
    }
    var ACCOUNT_REQUEST_STATUS_KEY = { pending: 'pending', approved: 'active', rejected: 'expired' };
    function renderAccountRequestCard(r) {
      var statusLabel = r.status.charAt(0).toUpperCase() + r.status.slice(1);
      var meta = [r.course, r.year_of_study].filter(Boolean).join(' · ') + ' · ' + timeAgo(r.created_at);
      var paidBadge = r.membership_paid
        ? '<span class="member-status-badge member-status-badge--active"><span class="member-status-badge-dot" aria-hidden="true"></span>Membership paid</span>'
        : '<span class="member-status-badge member-status-badge--pending"><span class="member-status-badge-dot" aria-hidden="true"></span>Payment not confirmed</span>';

      var actionsHtml = '';
      if (r.status === 'pending') {
        actionsHtml =
          '<div class="app-card-field">' +
          '<label class="checkbox-option"><input type="checkbox" data-request-paid-toggle data-id="' + escapeHtml(r.id) + '"' + (r.membership_paid ? ' checked' : '') + '> Membership payment confirmed</label>' +
          '</div>' +
          '<div style="display:flex; gap: var(--space-2); flex-wrap: wrap; margin-top: var(--space-3);">' +
          '<button type="button" class="btn btn-primary" data-request-approve data-id="' + escapeHtml(r.id) + '">Approve &amp; create login</button>' +
          '<button type="button" class="btn btn-outline" data-request-reject data-id="' + escapeHtml(r.id) + '" style="color: #ef8b8f; border-color: #ef8b8f;">Reject</button>' +
          '</div>';
      }

      return '<div class="app-card">' +
        '<div class="app-card-head" data-app-card-toggle>' +
        '<div class="app-card-head-main">' +
        '<span class="member-status-badge member-status-badge--' + ACCOUNT_REQUEST_STATUS_KEY[r.status] + '"><span class="member-status-badge-dot" aria-hidden="true"></span>' + statusLabel + '</span>' +
        '<span class="app-card-name">' + escapeHtml(r.full_name || 'Unnamed') + '</span>' +
        '<span class="app-card-meta">' + escapeHtml(meta) + '</span>' +
        '</div>' +
        '<svg class="icon app-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polyline points="6 9 12 15 18 9"/></svg>' +
        '</div>' +
        '<div class="app-card-body">' +
        appCardField('Email', r.email) +
        appCardField('Student number', r.student_number) +
        appCardField('Course', r.course) +
        appCardField('Year of study', r.year_of_study) +
        appCardField('Anything else', r.note) +
        '<div class="app-card-field">' + paidBadge + '</div>' +
        '<div class="app-card-field" data-request-emails data-id="' + escapeHtml(r.id) + '">' + renderRequestEmailsInner(r) + '</div>' +
        actionsHtml +
        (r.status !== 'pending' ? '<button type="button" class="app-card-delete-btn" data-request-delete data-id="' + escapeHtml(r.id) + '">Remove this request</button>' : '') +
        '</div>' +
        '</div>';
    }

    // Sends one of the two automatic emails behind this section - "your
    // account is live" on approval, or a payment reminder - through the
    // send-account-email Supabase Edge Function (see
    // supabase/functions/send-account-email/index.ts), which does the
    // actual sending via Resend. This is the one place on the whole site
    // that sends an email with nobody clicking "send" themselves -
    // everywhere else, "contact this person" is a mailto: link, since
    // there's no other email infrastructure here at all. Fails clearly
    // (rather than silently) if the function hasn't been deployed yet or
    // Resend isn't configured, since that's exactly the kind of thing
    // worth knowing about immediately rather than assuming it worked.
    function sendAccountEmail(type, request, onDone) {
      supabaseClient.functions.invoke('send-account-email', {
        body: { type: type, email: request.email, full_name: request.full_name }
      }).then(function (result) {
        return result.error ? describeEmailError(result.error) : null;
      }).then(function (errorMessage) {
        // Logged (migration 057) whether it worked or not, so the card's
        // Emails section shows what was sent and why a send failed.
        supabaseClient.from('account_request_emails').insert({
          request_id: request.id,
          email_type: type,
          recipient: request.email,
          status: errorMessage ? 'failed' : 'sent',
          error: errorMessage ? String(errorMessage).slice(0, 1000) : null
        }).select().single().then(function (logResult) {
          if (logResult.error) console.error('Logging the email failed:', logResult.error.message);
          else accountRequestEmailsAll.unshift(logResult.data);
          onDone(errorMessage);
        });
      });
    }

    // supabase-js hides the Edge Function's own error text behind a
    // generic "non-2xx status code" message - the real reason (e.g.
    // Resend rejecting the recipient) is in the response body.
    function describeEmailError(error) {
      if (error && error.context && typeof error.context.json === 'function') {
        return error.context.json().then(
          function (body) { return (body && body.error) || error.message || 'Failed to send the email'; },
          function () { return error.message || 'Failed to send the email'; }
        );
      }
      return Promise.resolve((error && error.message) || 'Failed to send the email');
    }

    var REQUEST_EMAIL_CATEGORIES = [
      { type: 'approved', label: 'Approval email', eligibleStatus: 'approved', sendLabel: 'Send', resendLabel: 'Resend' },
      { type: 'payment_reminder', label: 'Payment reminder', eligibleStatus: 'pending', sendLabel: 'Send reminder', resendLabel: 'Resend reminder' }
    ];
    function renderRequestEmailsInner(r) {
      var rows = REQUEST_EMAIL_CATEGORIES.map(function (cat) {
        var history = accountRequestEmailsAll.filter(function (m) { return m.request_id === r.id && m.email_type === cat.type; });
        var canSend = r.status === cat.eligibleStatus;
        if (!history.length && !canSend) return '';
        var latest = history[0];
        var statusHtml;
        if (!latest) {
          statusHtml = '<span class="request-email-status">Not sent yet</span>';
        } else if (latest.status === 'sent') {
          statusHtml = '<span class="request-email-status is-sent">Sent ' + escapeHtml(timeAgo(latest.created_at)) + '</span>';
        } else {
          statusHtml = '<span class="request-email-status is-failed">Failed ' + escapeHtml(timeAgo(latest.created_at)) + '</span>';
        }
        var historyHtml = history.length > 1 || (latest && latest.status === 'failed')
          ? '<div class="request-email-history">' + history.slice(0, 5).map(function (m) {
              return '<div>' + (m.status === 'sent' ? 'Sent' : 'Failed') + ' - ' +
                escapeHtml(new Date(m.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) +
                (m.status === 'failed' && m.error ? ' - ' + escapeHtml(m.error) : '') + '</div>';
            }).join('') + '</div>'
          : '';
        var btnHtml = canSend
          ? '<button type="button" class="btn btn-outline request-email-btn" data-request-email-send data-type="' + cat.type + '" data-id="' + escapeHtml(r.id) + '">' + (history.length ? cat.resendLabel : cat.sendLabel) + '</button>'
          : '';
        return '<div class="request-email-row"><div class="request-email-info"><strong>' + cat.label + '</strong>' + statusHtml + '</div>' + btnHtml + '</div>' + historyHtml;
      }).join('');
      return '<div class="app-card-field-label">Emails</div>' + (rows || '<div class="app-card-field-value">Nothing sent.</div>');
    }
    function refreshRequestEmails(requestId) {
      var r = accountRequestsAll.filter(function (x) { return x.id === requestId; })[0];
      if (!r) return;
      document.querySelectorAll('[data-request-emails][data-id="' + requestId + '"]').forEach(function (el) {
        el.innerHTML = renderRequestEmailsInner(r);
      });
    }

    // The requester already chose and confirmed their own password back
    // on request-account.html, so their login already fully exists
    // (r.auth_user_id) - approving just has to attach a real members row
    // to that same account. No signUp() here at all, and so no password-
    // setup email either (the old flow needed one because the dashboard
    // had just invented a random password nobody could ever use).
    function approveAccountRequest(r, onDone) {
      if (!r.auth_user_id) {
        onDone("This request has no account attached to it (it predates the switch to setting a password at request time) - create their login from Create Account instead, then delete this request.");
        return;
      }

      insertWithFkRetry(function () {
        return supabaseClient.from('members').insert({
          id: r.auth_user_id,
          full_name: r.full_name,
          course: r.course,
          year_of_study: r.year_of_study,
          student_number: r.student_number,
          member_type: 'member',
          membership_status: 'active'
        });
      }).then(function (insertResult) {
        if (insertResult.error) {
          onDone("Their login already exists, but saving their profile failed (" + insertResult.error.message + "). Finish it from Table Editor using this account id: " + r.auth_user_id);
          return;
        }

        supabaseClient.rpc('president_mark_account_request_approved', { target_id: r.id, new_member_id: r.auth_user_id }).then(function () {
          // The account is already fully live by this point regardless of
          // whether this send succeeds, so a failed email isn't an approval
          // failure - it's reported back separately (second argument) and
          // can be resent from the request's Emails section.
          sendAccountEmail('approved', r, function (emailError) {
            if (emailError) console.error('Welcome email failed to send:', emailError);
            onDone(null, emailError);
          });
        });
      });
    }


    // ---- Hub Access (president only): rules for who can use each part
    // of the members hub (hub_access_rules), plus a person-by-person grid
    // showing the resulting access and letting the president force one
    // person on/off (hub_access_overrides). All evaluation happens in
    // Postgres (migration 060) - this only edits rules and displays the
    // computed result, so what's shown here is what's really enforced. ----
    var HUB_FEATURES = [
      { key: 'perks', label: 'Discounts & opportunities', short: 'Perks', desc: 'Partner discount codes and members-first opportunities.', canLock: true },
      { key: 'sankofa', label: 'Sankofa Circle application', short: 'Sankofa', desc: 'Applying for a Sankofa mentorship Circle.', canLock: false },
      { key: 'network', label: 'The LACMS Network', short: 'Network', desc: 'The member and professional directory.', canLock: true },
      { key: 'motm_nominate', label: 'Member of the Month nominations', short: 'MoTM', desc: 'Nominating someone for Member of the Month.', canLock: false },
      { key: 'news_feed', label: 'News & updates feed', short: 'News', desc: 'The announcements feed on the hub.', canLock: false },
      { key: 'dash_mmg', label: 'Dashboard: MMG', short: 'MMG', desc: 'The MMG guests section of the Platform Activity Dashboard.', dash: true },
      { key: 'dash_sankofa', label: 'Dashboard: Sankofa', short: 'Sankofa', desc: 'Sankofa mentee and mentor applications on the dashboard.', dash: true },
      { key: 'dash_motm', label: 'Dashboard: Nominations', short: 'Nominations', desc: 'Member of the Month nominations on the dashboard.', dash: true },
      { key: 'dash_events', label: 'Dashboard: Events', short: 'Events', desc: 'Who has registered for which event.', dash: true },
      { key: 'dash_gallery', label: 'Dashboard: Gallery', short: 'Gallery', desc: 'Member gallery submissions and the live gallery.', dash: true }
    ];
    var HUB_ROLE_ORDER = ['member', 'executive_committee', 'supporting_committee', 'senior_sankofa_mentor', 'junior_sankofa_mentor'];
    var hubRules = [];
    var hubPeople = [];
    var hubTypeFilter = 'all';
    var hubSearchText = '';
    var hubMenuEl = null;

    function showHubStatus(message, kind) {
      var el = document.getElementById('hub-access-status');
      if (!el) return;
      if (!message) { el.style.display = 'none'; return; }
      el.textContent = message;
      el.style.display = 'block';
      el.classList.toggle('is-success', kind === 'success');
    }

    function loadHubAccess() {
      return Promise.all([
        supabaseClient.rpc('president_get_hub_rules'),
        supabaseClient.rpc('president_get_hub_access')
      ]).then(function (res) {
        if (res[0].error || res[1].error) {
          var msg = (res[0].error || res[1].error).message;
          console.error('Hub access failed to load:', msg);
          showHubStatus("Couldn't load hub access - has migration 060 been run? (" + msg + ')');
          return;
        }
        showHubStatus('');
        hubRules = res[0].data || [];
        var byUser = {};
        (res[1].data || []).forEach(function (row) {
          var p = byUser[row.user_id];
          if (!p) {
            p = byUser[row.user_id] = { id: row.user_id, name: row.full_name || 'Unnamed', type: row.person_type, memberType: row.member_type, title: row.committee_role, course: row.course, year: row.year_of_study, cells: {} };
          }
          p.cells[row.feature] = { allowed: row.allowed, via: row.via };
        });
        hubPeople = Object.keys(byUser).map(function (k) { return byUser[k]; })
          .sort(function (a, b) { return a.name.localeCompare(b.name); });
        renderHubRules();
        renderHubMatrix();
      });
    }

    function hubCheckbox(attrs, label, checked) {
      return '<label class="checkbox-option"><input type="checkbox" ' + attrs + (checked ? ' checked' : '') + '> ' + escapeHtml(label) + '</label>';
    }

    function renderHubRules() {
      var wrap = document.getElementById('hub-access-rules');
      if (!wrap) return;
      // Cards with unsaved edits are kept as they are (only their "N of M
      // people" count is refreshed), so saving or forcing one thing never
      // throws away what's half-edited in another card.
      var dirty = {};
      wrap.querySelectorAll('[data-hub-rule].is-dirty').forEach(function (c) { dirty[c.getAttribute('data-hub-rule')] = c; });

      var html = HUB_FEATURES.map(function (f) {
        var rule = hubRules.filter(function (r) { return r.feature === f.key; })[0];
        if (!rule) return '';
        var withAccess = hubPeople.filter(function (p) { return p.cells[f.key] && p.cells[f.key].allowed; }).length;
        var courseOptions = LACMS_COURSES.slice();
        (rule.courses || []).forEach(function (c) { if (courseOptions.indexOf(c) === -1) courseOptions.push(c); });
        var titleOptions = [];
        hubPeople.forEach(function (p) { if (p.title && titleOptions.indexOf(p.title) === -1) titleOptions.push(p.title); });
        (rule.titles || []).forEach(function (t) { if (titleOptions.indexOf(t) === -1) titleOptions.push(t); });
        titleOptions.sort(function (a, b) { return a.localeCompare(b); });
        var titles = titleOptions.length
          ? titleOptions.map(function (t) { return hubCheckbox('data-hub-title="' + escapeHtml(t) + '"', t, rule.titles && rule.titles.indexOf(t) !== -1); }).join('')
          : '<span class="hub-rule-desc">No one has a committee title set yet - add titles in Manage Accounts.</span>';

        var roles = HUB_ROLE_ORDER.map(function (t) {
          return hubCheckbox('data-hub-role="' + t + '"', MEMBER_TYPE_LABELS[t] || t, rule.member_types && rule.member_types.indexOf(t) !== -1);
        }).join('');
        var courses = courseOptions.map(function (c) {
          return hubCheckbox('data-hub-course="' + escapeHtml(c) + '"', c, rule.courses && rule.courses.indexOf(c) !== -1);
        }).join('');
        var blockedHtml = f.canLock
          ? '<div class="hub-rule-group"><span class="hub-rule-label">Without access, the hub shows</span>' +
            '<label class="checkbox-option"><input type="radio" name="hub-blocked-' + f.key + '" value="locked"' + (rule.blocked_display === 'locked' ? ' checked' : '') + '> A locked "coming soon" card</label>' +
            '<label class="checkbox-option"><input type="radio" name="hub-blocked-' + f.key + '" value="hidden"' + (rule.blocked_display === 'hidden' ? ' checked' : '') + '> Nothing at all</label></div>'
          : '<input type="hidden" data-hub-blocked value="hidden">';

        var who = [];
        if (rule.allow_members) who.push('Members');
        if (rule.allow_professionals) who.push('Professionals');
        var summaryParts = [who.length ? who.join(' + ') : 'Nobody (just you)'];
        if (rule.allow_members && rule.member_types && rule.member_types.length) {
          summaryParts.push(rule.member_types.map(function (t) { return MEMBER_TYPE_LABELS[t] || t; }).join(', '));
        }
        if (rule.allow_members && rule.titles && rule.titles.length) summaryParts.push(rule.titles.join(', '));
        if (rule.allow_members && rule.courses && rule.courses.length) summaryParts.push(rule.courses.join(', '));

        return '<details class="hub-rule-card" data-hub-rule="' + f.key + '">' +
          '<summary class="hub-rule-head"><div class="hub-rule-headtext"><h3 class="hub-rule-title">' + escapeHtml(f.label) + '</h3>' +
          '<p class="hub-rule-desc">' + escapeHtml(summaryParts.join(' · ')) + '</p></div>' +
          '<div class="hub-rule-count"><strong>' + withAccess + '</strong> of ' + hubPeople.length + ' have access</div>' +
          '<svg class="icon hub-rule-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></summary>' +
          '<div class="hub-rule-body">' +
          '<p class="hub-rule-desc">' + escapeHtml(f.desc) + '</p>' +
          '<div class="hub-rule-fields">' +
          '<div class="hub-rule-group"><span class="hub-rule-label">Who</span>' +
          hubCheckbox('data-hub-allow-members', 'Members', rule.allow_members) +
          hubCheckbox('data-hub-allow-pros', 'Professionals', rule.allow_professionals) + '</div>' +
          '<div class="hub-rule-group"><span class="hub-rule-label">Only these member roles <small>(none ticked = every role)</small></span><div class="hub-rule-chips">' + roles + '</div></div>' +
          '<div class="hub-rule-group"><span class="hub-rule-label">Only these committee titles <small>(none ticked = every title)</small></span><div class="hub-rule-chips">' + titles + '</div></div>' +
          (f.dash ? '' : '<div class="hub-rule-group"><span class="hub-rule-label">Only these courses <small>(none ticked = every course)</small></span><div class="hub-rule-chips">' + courses + '</div></div>') +
          blockedHtml +
          '</div>' +
          '<div class="hub-rule-actions"><button type="button" class="btn btn-primary" data-hub-save disabled>Save changes</button></div>' +
          '</div></details>';
      }).join('');

      var fresh = document.createElement('div');
      fresh.innerHTML = html;
      var dashKeys = HUB_FEATURES.filter(function (f) { return f.dash; }).map(function (f) { return f.key; });
      var nodes = [];
      var addedHubHeading = false;
      var addedDashHeading = false;
      Array.from(fresh.children).forEach(function (card) {
        var key = card.getAttribute('data-hub-rule');
        var isDash = dashKeys.indexOf(key) !== -1;
        if (!isDash && !addedHubHeading) {
          addedHubHeading = true;
          nodes.push(hubGroupHeading('Members hub', 'Which parts of the hub each person sees.'));
        }
        if (isDash && !addedDashHeading) {
          addedDashHeading = true;
          nodes.push(hubGroupHeading('Platform Activity Dashboard', 'Which dashboard sections each committee member sees. Only the president ever sees Activity, Account Requests, Create/Manage Accounts and this page.'));
        }
        nodes.push(hubKeepOrNew(card, key, dirty));
      });
      wrap.replaceChildren.apply(wrap, nodes);
    }

    function hubGroupHeading(title, sub) {
      var h = document.createElement('div');
      h.className = 'hub-group-title';
      h.innerHTML = '<h3>' + escapeHtml(title) + '</h3><p>' + escapeHtml(sub) + '</p>';
      return h;
    }

    function hubKeepOrNew(card, key, dirty) {
      var kept = dirty[key];
      if (!kept) return card;
      var keptCount = kept.querySelector('.hub-rule-count');
      var newCount = card.querySelector('.hub-rule-count');
      if (keptCount && newCount) keptCount.innerHTML = newCount.innerHTML;
      kept.open = true;
      return kept;
    }

    function renderHubMatrix() {
      var table = document.getElementById('hub-access-matrix');
      var emptyEl = document.getElementById('hub-access-empty');
      if (!table) return;
      var q = hubSearchText.trim().toLowerCase();
      var features = HUB_FEATURES.filter(function (f) { return hubRules.some(function (r) { return r.feature === f.key; }); });

      var rows = hubPeople.filter(function (p) {
        if (q && p.name.toLowerCase().indexOf(q) === -1) return false;
        if (hubTypeFilter === 'member' || hubTypeFilter === 'professional') return p.type === hubTypeFilter;
        if (hubTypeFilter === 'forced') {
          return features.some(function (f) { var c = p.cells[f.key]; return c && (c.via === 'override_allow' || c.via === 'override_deny'); });
        }
        return true;
      });

      if (emptyEl) emptyEl.style.display = rows.length ? 'none' : 'block';
      table.style.display = rows.length ? '' : 'none';

      var hubCols = features.filter(function (f) { return !f.dash; });
      var dashCols = features.filter(function (f) { return f.dash; });
      var head = '<thead>' +
        '<tr class="hub-matrix-groups"><th class="hub-matrix-person"></th>' +
        (hubCols.length ? '<th colspan="' + hubCols.length + '">Members hub</th>' : '') +
        (dashCols.length ? '<th colspan="' + dashCols.length + '" class="hub-matrix-group-dash">Dashboard</th>' : '') +
        '</tr><tr><th class="hub-matrix-person">Person</th>' +
        features.map(function (f) { return '<th title="' + escapeHtml(f.label) + '"' + (f.dash ? ' class="hub-matrix-group-dash"' : '') + '>' + escapeHtml(f.short) + '</th>'; }).join('') + '</tr></thead>';

      var body = '<tbody>' + rows.map(function (p) {
        var sub = p.type === 'professional'
          ? 'Professional'
          : [MEMBER_TYPE_LABELS[p.memberType] || 'Member', p.title, p.course, p.year].filter(Boolean).join(' · ');
        var cells = features.map(function (f) {
          var c = p.cells[f.key] || { allowed: false, via: 'rule' };
          var cls = 'hub-cell ' + (c.allowed ? 'hub-cell--yes' : 'hub-cell--no');
          var label;
          if (c.via === 'president') { cls += ' hub-cell--president'; label = 'Always has access (president)'; }
          else if (c.via === 'override_allow') { cls += ' hub-cell--forced'; label = 'Forced on for this person'; }
          else if (c.via === 'override_deny') { cls += ' hub-cell--forced'; label = 'Forced off for this person'; }
          else label = c.allowed ? 'Has access by the rule' : 'No access by the rule';
          var disabled = c.via === 'president' ? ' disabled' : '';
          return '<td' + (f.dash ? ' class="hub-matrix-group-dash"' : '') + '><button type="button" class="' + cls + '" data-hub-cell data-uid="' + escapeHtml(p.id) + '" data-feature="' + f.key + '"' + disabled +
            ' aria-label="' + escapeHtml(p.name + ', ' + f.label + ': ' + label) + '" title="' + escapeHtml(label) + '">' +
            (c.via === 'president' ? '&#9733;' : (c.allowed ? '&#10003;' : '&#10005;')) + '</button></td>';
        }).join('');
        return '<tr data-hub-row><th scope="row" class="hub-matrix-person"><span class="hub-matrix-name">' + escapeHtml(p.name) + '</span><span class="hub-matrix-sub">' + escapeHtml(sub) + '</span></th>' + cells + '</tr>';
      }).join('') + '</tbody>';

      table.innerHTML = head + body;
    }

    function closeHubMenu() {
      if (hubMenuEl) { hubMenuEl.remove(); hubMenuEl = null; }
    }

    function openHubMenu(btn) {
      closeHubMenu();
      var uid = btn.getAttribute('data-uid');
      var feature = btn.getAttribute('data-feature');
      var person = hubPeople.filter(function (p) { return p.id === uid; })[0];
      var meta = HUB_FEATURES.filter(function (f) { return f.key === feature; })[0];
      if (!person || !meta) return;
      var via = person.cells[feature] ? person.cells[feature].via : 'rule';
      var current = via === 'override_allow' ? 'allow' : (via === 'override_deny' ? 'deny' : 'default');
      var options = [
        { mode: 'default', label: 'Follow the rule' },
        { mode: 'allow', label: 'Always allow' },
        { mode: 'deny', label: 'Always block' }
      ];
      var menu = document.createElement('div');
      menu.className = 'hub-cell-menu';
      menu.setAttribute('role', 'menu');
      menu.innerHTML = '<div class="hub-cell-menu-title">' + escapeHtml(person.name) + '<span>' + escapeHtml(meta.label) + '</span></div>' +
        options.map(function (o) {
          return '<button type="button" role="menuitemradio" aria-checked="' + (o.mode === current) + '" class="hub-cell-menu-item' + (o.mode === current ? ' is-current' : '') + '" data-hub-mode="' + o.mode + '" data-uid="' + escapeHtml(uid) + '" data-feature="' + feature + '">' + o.label + '</button>';
        }).join('');
      document.body.appendChild(menu);
      hubMenuEl = menu;
      var rect = btn.getBoundingClientRect();
      var left = Math.min(Math.max(8, rect.left + rect.width / 2 - menu.offsetWidth / 2), window.innerWidth - menu.offsetWidth - 8);
      menu.style.left = left + window.scrollX + 'px';
      menu.style.top = (rect.bottom + window.scrollY + 6) + 'px';
      var first = menu.querySelector('.is-current') || menu.querySelector('button');
      if (first) first.focus();
    }

    function saveHubRule(card) {
      var feature = card.getAttribute('data-hub-rule');
      var roles = Array.from(card.querySelectorAll('[data-hub-role]:checked')).map(function (el) { return el.getAttribute('data-hub-role'); });
      var courses = Array.from(card.querySelectorAll('[data-hub-course]:checked')).map(function (el) { return el.getAttribute('data-hub-course'); });
      var titles = Array.from(card.querySelectorAll('[data-hub-title]:checked')).map(function (el) { return el.getAttribute('data-hub-title'); });
      var blockedRadio = card.querySelector('input[type="radio"]:checked');
      var blockedHidden = card.querySelector('[data-hub-blocked]');
      var allowMembers = card.querySelector('[data-hub-allow-members]').checked;
      var allowPros = card.querySelector('[data-hub-allow-pros]').checked;
      var saveBtn = card.querySelector('[data-hub-save]');

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      supabaseClient.rpc('president_set_hub_rule', {
        p_feature: feature,
        p_allow_members: allowMembers,
        p_allow_professionals: allowPros,
        p_member_types: roles.length ? roles : null,
        p_courses: courses.length ? courses : null,
        p_titles: titles.length ? titles : null,
        p_blocked_display: blockedRadio ? blockedRadio.value : (blockedHidden ? blockedHidden.value : 'hidden')
      }).then(function (result) {
        if (result.error) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save changes';
          showHubStatus("Couldn't save: " + result.error.message);
          return;
        }
        card.classList.remove('is-dirty');
        var meta = HUB_FEATURES.filter(function (f) { return f.key === feature; })[0];
        loadHubAccess().then(function () { showHubStatus('Saved - ' + (meta ? meta.label : feature) + ' access updated.', 'success'); });
      });
    }

    var hubAccessPanel = document.getElementById('dash-panel-access');
    if (hubAccessPanel) {
      hubAccessPanel.addEventListener('change', function (e) {
        var card = e.target.closest('[data-hub-rule]');
        if (!card) return;
        card.classList.add('is-dirty');
        var btn = card.querySelector('[data-hub-save]');
        if (btn) btn.disabled = false;
      });
      hubAccessPanel.addEventListener('click', function (e) {
        var saveBtn = e.target.closest('[data-hub-save]');
        if (saveBtn) { saveHubRule(saveBtn.closest('[data-hub-rule]')); return; }
        var cell = e.target.closest('[data-hub-cell]');
        if (cell && !cell.disabled) { e.stopPropagation(); openHubMenu(cell); return; }
        var filterTab = e.target.closest('[data-hub-filter]');
        if (filterTab) {
          filterTab.parentElement.querySelectorAll('[data-hub-filter]').forEach(function (t) { t.classList.remove('is-active'); });
          filterTab.classList.add('is-active');
          hubTypeFilter = filterTab.getAttribute('data-hub-filter');
          renderHubMatrix();
        }
      });
      var hubSearchInput = document.getElementById('hub-access-search');
      if (hubSearchInput) {
        hubSearchInput.addEventListener('input', function () { hubSearchText = hubSearchInput.value; renderHubMatrix(); });
      }
      document.addEventListener('click', function (e) {
        if (!hubMenuEl) return;
        var item = e.target.closest('[data-hub-mode]');
        if (item && hubMenuEl.contains(item)) {
          var uid = item.getAttribute('data-uid');
          var feature = item.getAttribute('data-feature');
          closeHubMenu();
          supabaseClient.rpc('president_set_hub_override', { p_user: uid, p_feature: feature, p_mode: item.getAttribute('data-hub-mode') }).then(function (result) {
            if (result.error) { showHubStatus("Couldn't change that: " + result.error.message); return; }
            loadHubAccess();
          });
          return;
        }
        if (!hubMenuEl.contains(e.target) && !e.target.closest('[data-hub-cell]')) closeHubMenu();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && hubMenuEl) closeHubMenu();
      });
    }

    // ---- Gallery submissions browser — the storage bucket has no name
    // attached to any file, just the uploader's auth id as the folder
    // name (see bindMediaUploadForm), so this lists two levels (folders,
    // then files within each) and resolves folder names to display
    // names in one batched president_lookup_names() call rather than
    // one lookup per file. Runs on its own, separately from the RPC
    // Promise.all above — a slow or failed storage listing shouldn't
    // hold up or break the rest of the dashboard. ----
    function loadGallerySubmissions() {
      var grid = document.getElementById('gallery-submissions-grid');
      var emptyEl = document.getElementById('gallery-submissions-empty');
      var countEl = document.getElementById('gallery-submissions-count-line');
      if (!grid) return;

      function showEmpty() {
        if (countEl) countEl.textContent = '0 files';
        if (emptyEl) emptyEl.style.display = 'block';
        grid.innerHTML = '';
        setDashCount('gallery', '0 to review');
      }

      supabaseClient.storage.from('gallery-submissions').list('', { limit: 500, sortBy: { column: 'name', order: 'desc' } }).then(function (folderResult) {
        var folders = (folderResult.data || []).map(function (f) { return f.name; }).filter(Boolean);
        if (folderResult.error || !folders.length) {
          showEmpty();
          return;
        }
        Promise.all(folders.map(function (folder) {
          return supabaseClient.storage.from('gallery-submissions').list(folder, { limit: 200, sortBy: { column: 'name', order: 'desc' } })
            .then(function (fileResult) {
              return (fileResult.data || []).map(function (f) { return { folder: folder, name: f.name, path: folder + '/' + f.name }; });
            });
        })).then(function (nested) {
          var files = [].concat.apply([], nested);
          if (!files.length) {
            showEmpty();
            return;
          }
          if (emptyEl) emptyEl.style.display = 'none';
          if (countEl) countEl.textContent = files.length + (files.length === 1 ? ' file' : ' files') + ' from ' + folders.length + (folders.length === 1 ? ' member' : ' members');
          setDashCount('gallery', files.length + (files.length === 1 ? ' submission to review' : ' submissions to review'));

          supabaseClient.rpc('president_lookup_names', { target_ids: folders }).then(function (nameResult) {
            var nameMap = {};
            (nameResult.data || []).forEach(function (row) { nameMap[row.id] = row.full_name; });

            Promise.all(files.map(function (f) {
              return supabaseClient.storage.from('gallery-submissions').createSignedUrl(f.path, 3600).then(function (signedResult) {
                f.url = signedResult.data && signedResult.data.signedUrl;
                return f;
              });
            })).then(function (filesWithUrls) {
              grid.innerHTML = filesWithUrls.map(function (f) {
                var uploaderName = nameMap[f.folder] || 'Unknown member';
                var isImage = /\.(jpe?g|png|gif|webp|heic)$/i.test(f.name);
                var thumb = isImage && f.url
                  ? '<img class="gallery-submission-thumb" src="' + escapeHtml(f.url) + '" alt="" loading="lazy">'
                  : '<div class="gallery-submission-thumb gallery-submission-thumb--file"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="32" height="32"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>';
                // Video submissions can be reviewed and rejected the
                // same way, but there's nowhere for them to go yet —
                // gallery.html's slideshow is images only — so "Add to
                // gallery" only ever shows for an image file.
                return '<div class="gallery-submission-item">' + thumb +
                  '<div class="gallery-submission-info">' +
                  '<div class="gallery-submission-name">' + escapeHtml(uploaderName) + '</div>' +
                  '<div class="gallery-submission-actions">' +
                  (f.url ? '<a class="gallery-submission-link" href="' + escapeHtml(f.url) + '" target="_blank" rel="noopener">Open</a>' : '<span class="gallery-submission-link" style="color:var(--color-text-faint);">Unavailable</span>') +
                  (isImage ? '<button type="button" class="gallery-manage-btn gallery-manage-btn--active" data-submission-publish data-path="' + escapeHtml(f.path) + '" data-filename="' + escapeHtml(f.name) + '">Add to gallery</button>' : '') +
                  '<button type="button" class="gallery-manage-btn gallery-manage-btn--danger" data-submission-reject data-path="' + escapeHtml(f.path) + '">Reject</button>' +
                  '</div></div></div>';
              }).join('');
            });
          });
        });
      });
    }

    // ---- Live public gallery management — what actually shows on
    // gallery.html, driven by the gallery_photos table + the public
    // gallery-photos bucket (migration 029) instead of a hand-edited
    // FILES array. Upload goes live immediately (bucket is public, no
    // signed URLs needed); "Hide"/"Show" flips is_active without
    // deleting the file, so a photo can be pulled without losing it. ----
    function loadGalleryManage() {
      var grid = document.getElementById('gallery-manage-grid');
      var emptyEl = document.getElementById('gallery-manage-empty');
      if (!grid) return;
      supabaseClient
        .from('gallery_photos')
        .select('*')
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: false })
        .then(function (result) {
          var photos = result.data || [];
          if (result.error || !photos.length) {
            if (emptyEl) emptyEl.style.display = 'block';
            grid.innerHTML = '';
            return;
          }
          if (emptyEl) emptyEl.style.display = 'none';
          grid.innerHTML = photos.map(function (p, i) {
            var url = p.is_static_asset
              ? encodeURI(p.storage_path)
              : supabaseClient.storage.from('gallery-photos').getPublicUrl(p.storage_path).data.publicUrl;
            var prevOrder = i > 0 ? photos[i - 1].display_order - 1 : p.display_order;
            var nextOrder = i < photos.length - 1 ? photos[i + 1].display_order + 1 : p.display_order;
            return '<div class="gallery-manage-item' + (p.is_active ? '' : ' is-inactive') + '">' +
              '<img class="gallery-manage-thumb" src="' + escapeHtml(url) + '" alt="" loading="lazy">' +
              '<div class="gallery-manage-actions">' +
              '<button type="button" class="gallery-manage-btn' + (p.is_active ? ' gallery-manage-btn--active' : '') + '" data-gallery-toggle-active data-id="' + escapeHtml(p.id) + '" data-active="' + (p.is_active ? 'true' : 'false') + '">' + (p.is_active ? 'Selected' : 'Not selected') + '</button>' +
              (i > 0 ? '<button type="button" class="gallery-manage-btn" data-gallery-move data-id="' + escapeHtml(p.id) + '" data-new-order="' + prevOrder + '" aria-label="Move earlier">&larr;</button>' : '') +
              (i < photos.length - 1 ? '<button type="button" class="gallery-manage-btn" data-gallery-move data-id="' + escapeHtml(p.id) + '" data-new-order="' + nextOrder + '" aria-label="Move later">&rarr;</button>' : '') +
              '<button type="button" class="gallery-manage-btn gallery-manage-btn--danger" data-gallery-delete data-id="' + escapeHtml(p.id) + '" data-path="' + escapeHtml(p.storage_path) + '" data-static="' + (p.is_static_asset ? 'true' : 'false') + '">Delete</button>' +
              '</div></div>';
          }).join('');
        });
    }

    var galleryLiveUploadForm = document.getElementById('gallery-live-upload-form');
    if (galleryLiveUploadForm) {
      galleryLiveUploadForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var statusEl = document.getElementById('gallery-live-upload-status');
        var fileInput = document.getElementById('gallery-live-upload-file');
        var files = fileInput.files;
        hideMessage(statusEl);
        if (!files.length) return;

        var btn = galleryLiveUploadForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        statusEl.style.color = 'var(--color-text-muted)';
        showMessage(statusEl, 'Uploading ' + files.length + (files.length === 1 ? ' photo…' : ' photos…'));

        var uploads = Array.prototype.map.call(files, function (file) {
          var safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
          var path = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + safeName;
          return supabaseClient.storage.from('gallery-photos').upload(path, file).then(function (uploadResult) {
            if (uploadResult.error) return uploadResult;
            return supabaseClient.from('gallery_photos').insert({ storage_path: path });
          });
        });

        Promise.all(uploads).then(function (results) {
          btn.disabled = false;
          var failed = results.filter(function (r) { return r.error; });
          if (failed.length) {
            statusEl.style.color = '#ef8b8f';
            showMessage(statusEl, 'Some photos failed to upload - try again.');
          } else {
            statusEl.style.color = '#6fcf97';
            showMessage(statusEl, 'Added to the public gallery.');
          }
          galleryLiveUploadForm.reset();
          loadGalleryManage();
        });
      });
    }

    var manageSearchInput = document.getElementById('manage-search-input');
    if (manageSearchInput) {
      manageSearchInput.addEventListener('input', function () {
        renderManageAccountsFiltered(manageCurrentFilter, manageSearchInput.value);
      });
    }
    var manageTypeTabs = document.getElementById('manage-type-tabs');
    if (manageTypeTabs) {
      manageTypeTabs.addEventListener('click', function (e) {
        var tab = e.target.closest('[data-manage-filter]');
        if (!tab) return;
        manageTypeTabs.querySelectorAll('.dash-filter-tab').forEach(function (t) { t.classList.remove('is-active'); });
        tab.classList.add('is-active');
        renderManageAccountsFiltered(tab.getAttribute('data-manage-filter'), manageSearchInput ? manageSearchInput.value : '');
      });
    }

    // Typing "Year Three" here and "Year 3" for someone else means the
    // same thing to a person, but not to a plain string comparison —
    // the Network page's own grouping already folds both into one
    // "Year 3" bucket for display (see member-network.html's
    // yearGroupLabel(), a separate copy of this exact same logic — that
    // page's script scope has no access to this one), but the two
    // *stored* values still don't match, which is confusing the moment
    // anyone looks at the raw data. This normalises at the point of
    // entry instead, so what's actually stored is already the one
    // canonical form: digit, not word ("Year 3", never "Year Three") —
    // chosen because that's already what every display on the site
    // normalises *to*, so this just makes the data agree with itself.
    // Genuinely non-numeric entries ("Foundation Doctor", "Alumni") are
    // left exactly as typed.
    var YEAR_WORD_TO_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
    function normalizeYearOfStudy(raw) {
      raw = (raw || '').trim();
      if (!raw) return '';
      var lower = raw.toLowerCase();
      var digitMatch = /(\d+)/.exec(lower);
      if (digitMatch) return 'Year ' + parseInt(digitMatch[1], 10);
      var wordMatch = /\b(one|two|three|four|five|six|seven)\b/.exec(lower);
      if (wordMatch) return 'Year ' + YEAR_WORD_TO_NUM[wordMatch[1]];
      return raw;
    }

    // ---- Account edit modal — one shared modal (built once, on first
    // use) covering all three account types, since only one is ever
    // being edited at a time. Deleting here only ever removes the
    // profile row (members/network_professionals/mmg_guests) — the
    // underlying auth.users login can't be deleted from the browser
    // without the service-role admin API, which this page will never
    // have access to (see §59's Create Account for the same boundary).
    // The person just loses their profile, exactly as if their row had
    // been deleted from Table Editor directly. ----
    var currentEditType = null;
    var currentEditId = null;
    var currentEditRow = null;

    function buildAccountEditModal() {
      if (document.getElementById('account-edit-modal')) return;
      var modal = document.createElement('div');
      modal.id = 'account-edit-modal';
      modal.className = 'network-modal';
      modal.style.display = 'none';
      modal.innerHTML =
        '<div class="network-modal-backdrop" data-account-edit-close></div>' +
        '<div class="network-modal-panel network-modal-panel--wide">' +
        '<button type="button" class="network-modal-close" data-account-edit-close aria-label="Close">' +
        '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>' +
        '</button>' +
        '<h2 id="account-edit-title" style="margin-top:0;">Edit account</h2>' +
        '<p id="account-edit-subtitle" style="color: var(--color-text-faint); font-size: 0.85rem; margin-top: -10px;">&nbsp;</p>' +
        '<form id="account-edit-form">' +

        '<div class="field"><label for="edit-name">Full name</label><input type="text" id="edit-name" required></div>' +

        '<div data-edit-fields="member" style="display:none;">' +
        '<div class="field"><label for="edit-member-course">Course</label><input type="text" id="edit-member-course" list="create-course-options"></div>' +
        '<div class="field"><label for="edit-member-year">Year of study</label><input type="text" id="edit-member-year" placeholder="e.g. Year 2, Foundation Doctor"></div>' +
        '<div class="field"><label for="edit-member-student-number">Student number <span style="font-weight:400; color: var(--color-text-faint);">(optional)</span></label><input type="text" id="edit-member-student-number"></div>' +
        '<div class="field"><label for="edit-member-status">Membership status</label><select id="edit-member-status"><option value="active">Active</option><option value="expired">Expired</option><option value="pending">Pending</option></select></div>' +
        '<div class="field"><label for="edit-member-type">Member type</label><select id="edit-member-type">' +
        '<option value="member">Member</option><option value="supporting_committee">Supporting committee</option><option value="executive_committee">Executive committee</option><option value="senior_sankofa_mentor">Senior Sankofa mentor</option><option value="junior_sankofa_mentor">Junior Sankofa mentor</option>' +
        '</select></div>' +
        '<div class="field"><label for="edit-member-role">Committee role <span style="font-weight:400; color: var(--color-text-faint);">(optional)</span></label><input type="text" id="edit-member-role"></div>' +
        '<div class="field">' +
        '<label class="checkbox-option"><input type="checkbox" id="edit-member-sankofa">Sankofa eligible</label>' +
        '<label class="checkbox-option"><input type="checkbox" id="edit-member-mmg-attendee">MMG attendee</label>' +
        '<label class="checkbox-option"><input type="checkbox" id="edit-member-mmg-committee">MMG committee</label>' +
        '</div>' +
        '</div>' +

        '<div data-edit-fields="professional" style="display:none;">' +
        '<div class="field"><label for="edit-pro-email">Email</label><input type="email" id="edit-pro-email"></div>' +
        '<div class="field"><label for="edit-pro-title">Title</label><input type="text" id="edit-pro-title"></div>' +
        '<div class="field"><label for="edit-pro-organisation">Organisation <span style="font-weight:400; color: var(--color-text-faint);">(optional)</span></label><input type="text" id="edit-pro-organisation"></div>' +
        '<div class="field"><label for="edit-pro-category">Category</label><select id="edit-pro-category"><option value="senior_doctor">Senior Doctor / Consultant</option><option value="alumni_doctor">Alumni / Junior Doctor</option><option value="pharmacist">Pharmacist</option><option value="other">Other</option></select></div>' +
        '<div class="field"><label for="edit-pro-bio">Bio <span style="font-weight:400; color: var(--color-text-faint);">(optional)</span></label><textarea id="edit-pro-bio"></textarea></div>' +
        '<div class="field"><label for="edit-pro-linkedin">LinkedIn <span style="font-weight:400; color: var(--color-text-faint);">(optional)</span></label><input type="url" id="edit-pro-linkedin"></div>' +
        '<div class="field"><label class="checkbox-option"><input type="checkbox" id="edit-pro-active">Visible on the Network page</label></div>' +
        '</div>' +

        '<div data-edit-fields="mmg" style="display:none;">' +
        '<div class="field"><label for="edit-mmg-university">University</label><input type="text" id="edit-mmg-university"></div>' +
        '<div class="field"><label for="edit-mmg-access">Access level</label><select id="edit-mmg-access"><option value="pending">Pending review</option><option value="attendee">Attendee</option><option value="committee">Committee</option></select></div>' +
        '</div>' +

        '<button type="submit" class="btn btn-primary btn-block">Save changes</button>' +
        '<p id="account-edit-status" class="auth-error" role="status" style="display:none;"></p>' +
        '</form>' +
        '<button type="button" class="app-card-delete-btn" id="account-edit-delete-btn" style="margin-top: var(--space-4); width: 100%; text-align: center;">Remove this account from LACMS</button>' +
        '</div>';
      document.body.appendChild(modal);

      modal.querySelectorAll('[data-account-edit-close]').forEach(function (el) {
        el.addEventListener('click', closeAccountEditModal);
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && modal.style.display !== 'none') closeAccountEditModal();
      });
      document.getElementById('account-edit-form').addEventListener('submit', function (e) {
        e.preventDefault();
        saveAccountEdit();
      });
      document.getElementById('account-edit-delete-btn').addEventListener('click', deleteAccountEdit);
    }

    function closeAccountEditModal() {
      var modal = document.getElementById('account-edit-modal');
      if (modal) modal.style.display = 'none';
    }

    function openAccountEditModal(type, id) {
      buildAccountEditModal();
      currentEditType = type;
      currentEditId = id;
      currentEditRow = null;
      var modal = document.getElementById('account-edit-modal');
      var statusEl = document.getElementById('account-edit-status');
      hideMessage(statusEl);
      document.getElementById('account-edit-title').textContent = 'Loading…';
      document.getElementById('account-edit-subtitle').textContent = ' ';
      document.querySelectorAll('[data-edit-fields]').forEach(function (el) {
        el.style.display = el.getAttribute('data-edit-fields') === type ? '' : 'none';
      });
      modal.style.display = 'flex';

      var table = type === 'member' ? 'members' : type === 'professional' ? 'network_professionals' : 'mmg_guests';
      supabaseClient.from(table).select('*').eq('id', id).single().then(function (result) {
        if (result.error || !result.data) {
          document.getElementById('account-edit-title').textContent = "Couldn't load this account";
          showMessage(statusEl, (result.error && result.error.message) || 'Not found.');
          return;
        }
        currentEditRow = result.data;
        var row = result.data;
        document.getElementById('account-edit-title').textContent = row.full_name || 'Edit account';
        document.getElementById('account-edit-subtitle').textContent = type === 'member' ? 'LACMS member' : type === 'professional' ? 'Network professional' : 'MMG guest';
        document.getElementById('edit-name').value = row.full_name || '';

        if (type === 'member') {
          document.getElementById('edit-member-course').value = row.course || '';
          document.getElementById('edit-member-year').value = row.year_of_study || '';
          document.getElementById('edit-member-student-number').value = row.student_number || '';
          document.getElementById('edit-member-status').value = row.membership_status || 'active';
          document.getElementById('edit-member-type').value = row.member_type || 'member';
          document.getElementById('edit-member-role').value = row.committee_role || '';
          document.getElementById('edit-member-sankofa').checked = !!row.sankofa_eligible;
          document.getElementById('edit-member-mmg-attendee').checked = !!row.mmg_attendee;
          document.getElementById('edit-member-mmg-committee').checked = !!row.mmg_committee;
        } else if (type === 'professional') {
          document.getElementById('edit-pro-email').value = row.email || '';
          document.getElementById('edit-pro-title').value = row.title || '';
          document.getElementById('edit-pro-organisation').value = row.organisation || '';
          document.getElementById('edit-pro-category').value = row.category || 'senior_doctor';
          document.getElementById('edit-pro-bio').value = row.bio || '';
          document.getElementById('edit-pro-linkedin').value = row.linkedin_url || '';
          document.getElementById('edit-pro-active').checked = !!row.is_active;
        } else {
          document.getElementById('edit-mmg-university').value = row.university || '';
          document.getElementById('edit-mmg-access').value = row.access_level || 'pending';
        }
      });
    }

    function saveAccountEdit() {
      var statusEl = document.getElementById('account-edit-status');
      hideMessage(statusEl);
      var name = document.getElementById('edit-name').value.trim();
      if (!name) {
        showMessage(statusEl, 'Name is required.');
        return;
      }

      var table, updates;
      if (currentEditType === 'member') {
        table = 'members';
        updates = {
          full_name: name,
          course: document.getElementById('edit-member-course').value.trim() || null,
          year_of_study: normalizeYearOfStudy(document.getElementById('edit-member-year').value) || null,
          student_number: document.getElementById('edit-member-student-number').value.trim() || null,
          membership_status: document.getElementById('edit-member-status').value,
          member_type: document.getElementById('edit-member-type').value,
          committee_role: document.getElementById('edit-member-role').value.trim() || null,
          sankofa_eligible: document.getElementById('edit-member-sankofa').checked,
          mmg_attendee: document.getElementById('edit-member-mmg-attendee').checked,
          mmg_committee: document.getElementById('edit-member-mmg-committee').checked
        };
      } else if (currentEditType === 'professional') {
        table = 'network_professionals';
        updates = {
          full_name: name,
          email: document.getElementById('edit-pro-email').value.trim() || null,
          title: document.getElementById('edit-pro-title').value.trim() || 'Professional',
          organisation: document.getElementById('edit-pro-organisation').value.trim() || null,
          category: document.getElementById('edit-pro-category').value,
          bio: document.getElementById('edit-pro-bio').value.trim() || null,
          linkedin_url: document.getElementById('edit-pro-linkedin').value.trim() || null,
          is_active: document.getElementById('edit-pro-active').checked
        };
      } else {
        table = 'mmg_guests';
        updates = {
          full_name: name,
          university: document.getElementById('edit-mmg-university').value.trim() || 'Not set',
          access_level: document.getElementById('edit-mmg-access').value
        };
      }

      var btn = document.querySelector('#account-edit-form button[type="submit"]');
      btn.disabled = true;
      supabaseClient.from(table).update(updates).eq('id', currentEditId).then(function (result) {
        btn.disabled = false;
        if (result.error) {
          statusEl.style.color = '#ef8b8f';
          showMessage(statusEl, result.error.message);
          return;
        }
        statusEl.style.color = '#6fcf97';
        showMessage(statusEl, 'Saved.');
        loadPresidentDashboard();
        window.setTimeout(closeAccountEditModal, 700);
      });
    }

    function deleteAccountEdit() {
      var name = (currentEditRow && currentEditRow.full_name) || 'this account';
      var recordLabel = currentEditType === 'member' ? 'membership' : currentEditType === 'professional' ? 'professional profile' : 'MMG guest record';
      if (!window.confirm('Remove ' + name + ' from LACMS? This permanently deletes their ' + recordLabel + '. Their login itself isn\'t deleted - only Supabase\'s own Authentication → Users page can do that.')) return;
      var table = currentEditType === 'member' ? 'members' : currentEditType === 'professional' ? 'network_professionals' : 'mmg_guests';
      var deleteBtn = document.getElementById('account-edit-delete-btn');
      deleteBtn.disabled = true;
      supabaseClient.from(table).delete().eq('id', currentEditId).then(function (result) {
        deleteBtn.disabled = false;
        if (result.error) {
          var statusEl = document.getElementById('account-edit-status');
          statusEl.style.color = '#ef8b8f';
          showMessage(statusEl, result.error.message);
          return;
        }
        closeAccountEditModal();
        loadPresidentDashboard();
      });
    }

    var sankofaFilterTabs = document.getElementById('sankofa-filter-tabs');
    if (sankofaFilterTabs) {
      sankofaFilterTabs.addEventListener('click', function (e) {
        var tab = e.target.closest('[data-sankofa-filter]');
        if (!tab) return;
        sankofaFilterTabs.querySelectorAll('.dash-filter-tab').forEach(function (t) { t.classList.remove('is-active'); });
        tab.classList.add('is-active');
        renderSankofaApplicationsFiltered(tab.getAttribute('data-sankofa-filter'));
      });
    }

    // ---- Create account panel — type tabs + form. Creates the login
    // via a second, isolated Supabase client (persistSession: false),
    // so it can never clobber the president's own logged-in session on
    // this same page (a plain signUp() on the main client would replace
    // the active session with the brand-new account's the moment it
    // succeeds — this keeps the two completely separate). The profile
    // row is then inserted using the president's own real session (the
    // is_president()-gated insert policies from migration 032). Exactly
    // one email then sends the new person to set their own password —
    // either the project's own signup-confirmation email (if "Confirm
    // email" is on) or a follow-up password-reset email (if it's off,
    // since signUp() sends nothing on its own in that case) — never
    // both, and never a link that leads nowhere. No service-role admin
    // API involved anywhere, since that key must never exist in browser
    // code.
    //
    // Uses createImplicitFlowClient() (see above) rather than a plain
    // client — the president's browser is requesting this link, but a
    // completely different person on a completely different device is
    // the one who has to redeem it, which the site's default PKCE flow
    // can never support (no browser on earth has both halves it needs). ----
    var createAccountForm = document.getElementById('create-account-form');
    if (createAccountForm) {
      var createAccountTypeTabs = document.getElementById('create-account-type-tabs');
      var currentAccountType = 'member';
      var createAccountClient = createImplicitFlowClient();

      function showAccountTypeFields(type) {
        currentAccountType = type;
        document.querySelectorAll('[data-account-type-fields]').forEach(function (el) {
          el.style.display = el.getAttribute('data-account-type-fields') === type ? '' : 'none';
        });
      }

      if (createAccountTypeTabs) {
        createAccountTypeTabs.addEventListener('click', function (e) {
          var tab = e.target.closest('[data-account-type]');
          if (!tab) return;
          createAccountTypeTabs.querySelectorAll('.dash-filter-tab').forEach(function (t) { t.classList.remove('is-active'); });
          tab.classList.add('is-active');
          showAccountTypeFields(tab.getAttribute('data-account-type'));
        });
      }

      // Never shown to anyone, never communicated — the very next step
      // sends a password-reset email so the new person sets their own.
      // This only exists because signUp() requires some password.
      function randomPassword() {
        var bytes = new Uint8Array(24);
        window.crypto.getRandomValues(bytes);
        return Array.from(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      }

      createAccountForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var statusEl = document.getElementById('create-account-status');
        hideMessage(statusEl);

        var name = document.getElementById('create-account-name').value.trim();
        var email = document.getElementById('create-account-email').value.trim();
        if (!name || !email) {
          showMessage(statusEl, 'Fill in their name and email.');
          return;
        }

        var btn = createAccountForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        statusEl.style.color = 'var(--color-text-muted)';
        showMessage(statusEl, 'Creating account…');

        // Passed into signUp() itself, not just the later resetPasswordForEmail
        // call - if this Supabase project has "Confirm email" turned on,
        // signUp() sends its own confirmation email immediately, using
        // whatever redirect this call gives it. Leaving it unset meant that
        // email fell back to the project's generic Site URL instead of a
        // page that actually knows how to show a "set your password" form -
        // so clicking it just confirmed the address and stranded them on
        // member-login.html with no way to ever choose a password.
        var loginPage = currentAccountType === 'mmg' ? 'mmg-login.html' : 'member-login.html';
        var loginPageUrl = window.location.origin + '/' + loginPage;

        createAccountClient.auth.signUp({
          email: email,
          password: randomPassword(),
          options: { emailRedirectTo: loginPageUrl }
        }).then(function (signUpResult) {
          if (signUpResult.error || !signUpResult.data || !signUpResult.data.user) {
            btn.disabled = false;
            statusEl.style.color = '#ef8b8f';
            showMessage(statusEl, (signUpResult.error && signUpResult.error.message) || "Couldn't create the account - the email may already be in use.");
            return;
          }
          var newUserId = signUpResult.data.user.id;
          // If "Confirm email" is on, signUp() above just sent its own
          // confirmation email already (now correctly routed to
          // loginPageUrl, in a self-contained format any device can
          // redeem) and data.session comes back null — sending a second,
          // separate password-reset email on top of that would leave
          // them with two emails and no clear reason to pick one over
          // the other. So a session existing is exactly the condition
          // for needing one: it means "Confirm email" is off and
          // signUp() above sent nothing of its own, making the reset
          // email below the only way they'd ever get a working link at
          // all. (This was previously inverted — !session instead of
          // !!session — which is exactly why two emails went out and
          // one of them never worked: the reset email fired in the one
          // case it shouldn't have, and skipped the one case it should.)
          var needsPasswordEmail = !!signUpResult.data.session;

          var profileInsertFn;
          if (currentAccountType === 'member') {
            profileInsertFn = function () {
              return supabaseClient.from('members').insert({
                id: newUserId,
                full_name: name,
                course: document.getElementById('create-member-course').value.trim() || null,
                year_of_study: normalizeYearOfStudy(document.getElementById('create-member-year').value) || null,
                student_number: document.getElementById('create-member-student-number').value.trim() || null,
                member_type: document.getElementById('create-member-type').value,
                committee_role: document.getElementById('create-member-role').value.trim() || null,
                sankofa_eligible: document.getElementById('create-member-sankofa').checked,
                mmg_attendee: document.getElementById('create-member-mmg-attendee').checked,
                mmg_committee: document.getElementById('create-member-mmg-committee').checked
              });
            };
          } else if (currentAccountType === 'professional') {
            profileInsertFn = function () {
              return supabaseClient.from('network_professionals').insert({
                user_id: newUserId,
                email: email,
                full_name: name,
                title: document.getElementById('create-pro-title').value.trim() || 'Professional',
                organisation: document.getElementById('create-pro-organisation').value.trim() || null,
                category: document.getElementById('create-pro-category').value,
                linkedin_url: document.getElementById('create-pro-linkedin').value.trim() || null
              });
            };
          } else {
            profileInsertFn = function () {
              return supabaseClient.from('mmg_guests').insert({
                id: newUserId,
                full_name: name,
                university: document.getElementById('create-mmg-university').value.trim() || 'Not set',
                access_level: document.getElementById('create-mmg-access').value
              });
            };
          }

          insertWithFkRetry(profileInsertFn).then(function (profileResult) {
            if (profileResult.error) {
              btn.disabled = false;
              statusEl.style.color = '#ef8b8f';
              showMessage(statusEl, "The login was created, but saving their profile failed (" + profileResult.error.message + "). Finish it from Table Editor using this account id: " + newUserId);
              return;
            }

            function finish() {
              btn.disabled = false;
              statusEl.style.color = '#6fcf97';
              showMessage(statusEl, name + "'s account is live - they've been emailed to set their password.");
              createAccountForm.reset();
              showAccountTypeFields(currentAccountType);
              loadPresidentDashboard();
            }

            if (needsPasswordEmail) {
              createAccountClient.auth.resetPasswordForEmail(email, { redirectTo: loginPageUrl }).then(finish);
            } else {
              // signUp() already sent its own confirmation email above,
              // correctly redirecting to loginPageUrl - sending a second
              // one here would just be a confusing duplicate.
              finish();
            }
          });
        });
      });
    }

    // Delegated since every "Mark active"/"Approve" button and expandable
    // card is injected dynamically on every reload — a direct listener
    // would only ever catch the first render's elements.
    presidentContent.addEventListener('click', function (e) {
      var markBtn = e.target.closest('[data-mark-active]');
      if (markBtn) {
        markBtn.disabled = true;
        markBtn.textContent = 'Marking…';
        supabaseClient
          .rpc('president_mark_activated', { target_id: markBtn.getAttribute('data-id'), target_type: markBtn.getAttribute('data-type') })
          .then(function (result) {
            if (result.error) {
              markBtn.disabled = false;
              markBtn.textContent = 'Mark active';
              console.error('Mark active failed:', result.error.message);
              return;
            }
            loadPresidentDashboard();
          });
        return;
      }

      var motmDeleteBtn = e.target.closest('[data-motm-delete]');
      if (motmDeleteBtn) {
        if (!window.confirm("Delete this nomination? They'll be able to submit a new one straight away - this month's slot frees up as soon as this is deleted.")) return;
        motmDeleteBtn.disabled = true;
        supabaseClient
          .rpc('president_delete_motm_nomination', { target_id: motmDeleteBtn.getAttribute('data-id') })
          .then(function (result) {
            if (result.error) {
              motmDeleteBtn.disabled = false;
              console.error('Delete nomination failed:', result.error.message);
              return;
            }
            loadPresidentDashboard();
          });
        return;
      }

      var manageEditRow = e.target.closest('[data-manage-edit]');
      if (manageEditRow) {
        openAccountEditModal(manageEditRow.getAttribute('data-type'), manageEditRow.getAttribute('data-id'));
        return;
      }

      var sankofaDeleteBtn = e.target.closest('[data-sankofa-delete]');
      if (sankofaDeleteBtn) {
        if (!window.confirm("Delete this application? This can't be undone.")) return;
        sankofaDeleteBtn.disabled = true;
        var deleteRpc = sankofaDeleteBtn.getAttribute('data-type') === 'mentor'
          ? 'president_delete_sankofa_mentor_application'
          : 'president_delete_sankofa_application';
        supabaseClient
          .rpc(deleteRpc, { target_id: sankofaDeleteBtn.getAttribute('data-id') })
          .then(function (result) {
            if (result.error) {
              sankofaDeleteBtn.disabled = false;
              console.error('Delete application failed:', result.error.message);
              return;
            }
            loadPresidentDashboard();
          });
        return;
      }

      var mentorStatusBtn = e.target.closest('[data-mentor-status]');
      if (mentorStatusBtn) {
        var tabs = mentorStatusBtn.parentElement.querySelectorAll('[data-mentor-status]');
        tabs.forEach(function (t) { t.disabled = true; });
        supabaseClient
          .rpc('president_set_mentor_application_status', { target_id: mentorStatusBtn.getAttribute('data-id'), new_status: mentorStatusBtn.getAttribute('data-status') })
          .then(function (result) {
            tabs.forEach(function (t) { t.disabled = false; });
            if (result.error) {
              console.error('Update mentor status failed:', result.error.message);
              return;
            }
            tabs.forEach(function (t) { t.classList.toggle('is-active', t === mentorStatusBtn); });
          });
        return;
      }

      var requestsFilterTab = e.target.closest('[data-requests-filter]');
      if (requestsFilterTab) {
        requestsFilterTab.parentElement.querySelectorAll('[data-requests-filter]').forEach(function (t) { t.classList.remove('is-active'); });
        requestsFilterTab.classList.add('is-active');
        renderAccountRequestsFiltered(requestsFilterTab.getAttribute('data-requests-filter'));
        return;
      }

      var emailBulkBtn = e.target.closest('[data-request-email-bulk]');
      if (emailBulkBtn) {
        var queue = requestsMissingApprovalEmail();
        if (!queue.length) return;
        if (!window.confirm('Send the approval email to ' + queue.length + (queue.length === 1 ? ' person' : ' people') + '?')) return;
        emailBulkBtn.disabled = true;
        var done = 0;
        var failures = [];
        // One at a time with a short gap - Resend rate-limits to a couple
        // of requests per second, and a burst would get rejected.
        (function next() {
          if (done >= queue.length) {
            renderAccountRequestsFiltered(accountRequestsFilter);
            window.alert((queue.length - failures.length) + ' of ' + queue.length + ' sent.' +
              (failures.length ? '\n\nFailed:\n' + failures.slice(0, 5).join('\n') + (failures.length > 5 ? '\n...and ' + (failures.length - 5) + ' more (see each request\'s Emails section).' : '') : ''));
            return;
          }
          var req = queue[done];
          emailBulkBtn.textContent = 'Sending ' + (done + 1) + ' of ' + queue.length + '…';
          sendAccountEmail('approved', req, function (emailError) {
            if (emailError) failures.push(req.full_name + ': ' + emailError);
            done += 1;
            setTimeout(next, 700);
          });
        })();
        return;
      }

      var emailSendBtn = e.target.closest('[data-request-email-send]');
      if (emailSendBtn) {
        var emailReqId = emailSendBtn.getAttribute('data-id');
        var emailType = emailSendBtn.getAttribute('data-type');
        var emailRequest = accountRequestsAll.filter(function (r) { return r.id === emailReqId; })[0];
        if (!emailRequest) return;
        var alreadySent = accountRequestEmailsAll.some(function (m) { return m.request_id === emailReqId && m.email_type === emailType && m.status === 'sent'; });
        if (alreadySent && !window.confirm('This email has already been sent to ' + emailRequest.email + '. Send it again?')) return;
        emailSendBtn.disabled = true;
        emailSendBtn.textContent = 'Sending…';
        sendAccountEmail(emailType, emailRequest, function (emailError) {
          refreshRequestEmails(emailReqId);
          if (emailError) window.alert("Couldn't send that email: " + emailError);
        });
        return;
      }

      var requestApproveBtn = e.target.closest('[data-request-approve]');
      if (requestApproveBtn) {
        var approveId = requestApproveBtn.getAttribute('data-id');
        var approveRequest = accountRequestsAll.filter(function (r) { return r.id === approveId; })[0];
        if (!approveRequest) return;
        if (!approveRequest.membership_paid && !window.confirm("This person hasn't been marked as having confirmed their membership payment yet. Approve and create their login anyway?")) {
          return;
        }
        requestApproveBtn.disabled = true;
        requestApproveBtn.textContent = 'Creating account…';
        approveAccountRequest(approveRequest, function (errorMessage, emailError) {
          if (errorMessage) {
            requestApproveBtn.disabled = false;
            requestApproveBtn.textContent = 'Approve & create login';
            window.alert("Couldn't approve this request: " + errorMessage);
            return;
          }
          if (emailError) {
            window.alert("Approved - but the welcome email failed to send: " + emailError + "\n\nYou can resend it from this request's Emails section.");
          }
          loadPresidentDashboard();
        });
        return;
      }

      var requestRejectBtn = e.target.closest('[data-request-reject]');
      if (requestRejectBtn) {
        if (!window.confirm("Reject this request? They'll need to submit a new one if they want to try again.")) return;
        requestRejectBtn.disabled = true;
        supabaseClient.rpc('president_reject_account_request', { target_id: requestRejectBtn.getAttribute('data-id') }).then(function (result) {
          if (result.error) {
            requestRejectBtn.disabled = false;
            console.error('Reject account request failed:', result.error.message);
            window.alert("Couldn't reject this request: " + result.error.message);
            return;
          }
          loadPresidentDashboard();
        });
        return;
      }

      var requestDeleteBtn = e.target.closest('[data-request-delete]');
      if (requestDeleteBtn) {
        if (!window.confirm("Remove this request? This can't be undone.")) return;
        requestDeleteBtn.disabled = true;
        supabaseClient.rpc('president_delete_account_request', { target_id: requestDeleteBtn.getAttribute('data-id') }).then(function (result) {
          if (result.error) {
            requestDeleteBtn.disabled = false;
            console.error('Delete account request failed:', result.error.message);
            return;
          }
          loadPresidentDashboard();
        });
        return;
      }

      var galleryToggleBtn = e.target.closest('[data-gallery-toggle-active]');
      if (galleryToggleBtn) {
        galleryToggleBtn.disabled = true;
        supabaseClient
          .from('gallery_photos')
          .update({ is_active: galleryToggleBtn.getAttribute('data-active') !== 'true' })
          .eq('id', galleryToggleBtn.getAttribute('data-id'))
          .then(function (result) {
            if (result.error) {
              galleryToggleBtn.disabled = false;
              console.error('Toggle gallery photo failed:', result.error.message);
              return;
            }
            loadGalleryManage();
          });
        return;
      }

      var galleryDeleteBtn = e.target.closest('[data-gallery-delete]');
      if (galleryDeleteBtn) {
        var isStaticAsset = galleryDeleteBtn.getAttribute('data-static') === 'true';
        if (!window.confirm(isStaticAsset ? 'Remove this photo from the gallery selection?' : 'Remove this photo from the public gallery? This deletes the uploaded file too.')) return;
        galleryDeleteBtn.disabled = true;
        var deletePath = galleryDeleteBtn.getAttribute('data-path');
        var deleteId = galleryDeleteBtn.getAttribute('data-id');
        // A static asset's "file" is a real, committed site file under
        // Media/ — nothing to remove from Storage, and nothing this
        // page should ever try to delete from disk. Only an uploaded
        // photo actually lives in the gallery-photos bucket.
        var removeFromStorage = isStaticAsset ? Promise.resolve() : supabaseClient.storage.from('gallery-photos').remove([deletePath]);
        removeFromStorage.then(function () {
          return supabaseClient.from('gallery_photos').delete().eq('id', deleteId);
        }).then(function (result) {
          if (result.error) {
            galleryDeleteBtn.disabled = false;
            console.error('Delete gallery photo failed:', result.error.message);
            return;
          }
          loadGalleryManage();
        });
        return;
      }

      var galleryMoveBtn = e.target.closest('[data-gallery-move]');
      if (galleryMoveBtn) {
        galleryMoveBtn.disabled = true;
        supabaseClient
          .from('gallery_photos')
          .update({ display_order: parseInt(galleryMoveBtn.getAttribute('data-new-order'), 10) })
          .eq('id', galleryMoveBtn.getAttribute('data-id'))
          .then(function () {
            loadGalleryManage();
          });
        return;
      }

      var submissionPublishBtn = e.target.closest('[data-submission-publish]');
      if (submissionPublishBtn) {
        submissionPublishBtn.disabled = true;
        submissionPublishBtn.textContent = 'Adding…';
        var pubPath = submissionPublishBtn.getAttribute('data-path');
        var pubFilename = submissionPublishBtn.getAttribute('data-filename');
        // Storage has no cross-bucket copy in the client SDK, so this
        // downloads the bytes out of the private gallery-submissions
        // bucket and re-uploads them into the public gallery-photos
        // bucket — two round trips, but it works entirely from the
        // browser with no server-side code needed.
        supabaseClient.storage.from('gallery-submissions').download(pubPath).then(function (downloadResult) {
          if (downloadResult.error) {
            submissionPublishBtn.disabled = false;
            submissionPublishBtn.textContent = 'Add to gallery';
            console.error('Download submission failed:', downloadResult.error.message);
            return;
          }
          var safeName = pubFilename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
          var newPath = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + safeName;
          supabaseClient.storage.from('gallery-photos').upload(newPath, downloadResult.data, { contentType: downloadResult.data.type }).then(function (uploadResult) {
            if (uploadResult.error) {
              submissionPublishBtn.disabled = false;
              submissionPublishBtn.textContent = 'Add to gallery';
              console.error('Upload to public gallery failed:', uploadResult.error.message);
              return;
            }
            supabaseClient.from('gallery_photos').insert({ storage_path: uploadResult.data.path }).then(function (insertResult) {
              if (insertResult.error) {
                submissionPublishBtn.disabled = false;
                submissionPublishBtn.textContent = 'Add to gallery';
                console.error('Add gallery photo row failed:', insertResult.error.message);
                return;
              }
              // Removes it from the submissions bucket now that it's
              // live — keeps the review queue showing only what still
              // needs a decision, rather than the same file sitting
              // there forever after being actioned. It's already live
              // in the public gallery at this point regardless of
              // whether this step succeeds, so a failure here is
              // flagged but doesn't roll anything back.
              supabaseClient.storage.from('gallery-submissions').remove([pubPath]).then(function (removeResult) {
                if (removeResult.error) {
                  console.error('Remove original submission failed:', removeResult.error.message);
                  window.alert("Added to the gallery, but couldn't clear the original submission from the review queue (" + removeResult.error.message + ") - it may show up here again after a refresh.");
                }
                loadGallerySubmissions();
                loadGalleryManage();
              });
            });
          });
        });
        return;
      }

      var submissionRejectBtn = e.target.closest('[data-submission-reject]');
      if (submissionRejectBtn) {
        if (!window.confirm('Reject this submission? This permanently deletes the file.')) return;
        submissionRejectBtn.disabled = true;
        supabaseClient.storage.from('gallery-submissions').remove([submissionRejectBtn.getAttribute('data-path')]).then(function (result) {
          if (result.error) {
            submissionRejectBtn.disabled = false;
            console.error('Reject submission failed:', result.error.message);
            window.alert("Couldn't reject this submission: " + result.error.message);
            return;
          }
          loadGallerySubmissions();
        });
        return;
      }

      var cardToggle = e.target.closest('[data-app-card-toggle]');
      if (cardToggle) {
        cardToggle.closest('.app-card').classList.toggle('is-expanded');
      }
    });

    // Separate from the click delegation above since a checkbox's state
    // is only reliably known on 'change', not 'click' (which fires
    // before the box's checked state has actually settled in some
    // browsers/input methods).
    presidentContent.addEventListener('change', function (e) {
      var paidToggle = e.target.closest('[data-request-paid-toggle]');
      if (!paidToggle) return;
      var checked = paidToggle.checked;
      paidToggle.disabled = true;
      supabaseClient.rpc('president_set_account_request_paid', { target_id: paidToggle.getAttribute('data-id'), is_paid: checked }).then(function (result) {
        paidToggle.disabled = false;
        if (result.error) {
          paidToggle.checked = !checked;
          console.error('Update membership-paid flag failed:', result.error.message);
          window.alert("Couldn't update that: " + result.error.message);
          return;
        }
        var request = accountRequestsAll.filter(function (r) { return r.id === paidToggle.getAttribute('data-id'); })[0];
        if (request) request.membership_paid = checked;
        var badge = paidToggle.closest('.app-card-body').querySelector('.member-status-badge');
        if (badge) {
          badge.className = 'member-status-badge member-status-badge--' + (checked ? 'active' : 'pending');
          badge.innerHTML = '<span class="member-status-badge-dot" aria-hidden="true"></span>' + (checked ? 'Membership paid' : 'Payment not confirmed');
        }
      });
    });
  }
})();
