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

  function isCommitteeMember(member) {
    return !!member && (member.member_type === 'executive_committee' || member.member_type === 'supporting_committee');
  }

  // Perks, Sankofa applications and MoTM nominations are committee-only
  // for now — "coming soon" for everyone else, including professionals
  // (who are never committee, so this only ever needs to check
  // `members`). Shared by the hub, perks, MoTM and Sankofa pages.
  function checkIsCommittee(session) {
    return supabaseClient
      .from('members')
      .select('member_type')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(function (result) { return isCommitteeMember(result.data); });
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
    }
  });

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
        '<strong>Mentee</strong><span>Sixth-former, medical or pharmacy student — LACMS membership required</span>' +
        '</button>' +
        '<button type="button" class="sankofa-apply-choice-btn" data-sankofa-apply-choice="mentor">' +
        '<strong>Mentor</strong><span>Doctor, pharmacist or healthcare professional — no account needed</span>' +
        '</button>' +
        '</div></div>' +

        '<div data-sankofa-apply-step="mentee" style="display:none;">' +
        '<h2 style="margin-top:0;">Mentee applications</h2>' +
        '<p>Open to LACMS members — sixth-formers exploring medicine, and Medicine or Pharmacy students. Applications close Sunday 11 October 2026.</p>' +
        '<a class="btn btn-primary btn-block" id="sankofa-apply-mentee-cta" href="join.html">Continue</a>' +
        '</div>' +

        '<div data-sankofa-apply-step="mentor" style="display:none;">' +
        '<h2 style="margin-top:0;">Apply to mentor</h2>' +
        '<p>Takes under a minute — no account needed, we\'ll reach out by email.</p>' +
        '<form id="sankofa-mentor-quick-form">' +
        '<div class="field"><label for="sqf-name">Full name</label><input type="text" id="sqf-name" autocomplete="name" required></div>' +
        '<div class="field"><label for="sqf-email">Email</label><input type="email" id="sqf-email" autocomplete="email" required></div>' +
        '<div class="field"><label for="sqf-title">Job title</label><input type="text" id="sqf-title" placeholder="e.g. Consultant Cardiologist, F1 Doctor, Community Pharmacist" required></div>' +
        '<div class="field"><label for="sqf-org">Organisation <span style="font-weight:400; color: var(--color-text-faint);">(optional)</span></label><input type="text" id="sqf-org" placeholder="e.g. Nottingham University Hospitals NHS Trust"></div>' +
        '<div class="field"><label for="sqf-linkedin">LinkedIn <span style="font-weight:400; color: var(--color-text-faint);">(optional)</span></label><input type="url" id="sqf-linkedin" placeholder="https://linkedin.com/in/…"></div>' +
        '<div class="field"><label for="sqf-offer">Why do you want to mentor, or what can you offer?</label><textarea id="sqf-offer" maxlength="600" placeholder="A sentence or two is plenty — specialty, what you could help with, why it matters to you." required></textarea></div>' +
        '<button type="submit" class="btn btn-primary btn-block">Submit application</button>' +
        '<p id="sqf-status" class="auth-error" role="status" style="display:none;"></p>' +
        '</form></div>' +

        '<div data-sankofa-apply-step="success" style="display:none;">' +
        '<h2 style="margin-top:0;">Thank you</h2>' +
        '<p>We\'ve received your mentor application — the committee will be in touch by email.</p>' +
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
              showMessage(statusEl, result.error.message || 'Something went wrong — try again, or email acms@lincolnsu.com.');
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
  // "you have access" badge — for committee members, since the perks
  // page itself is committee-only for now ("coming soon" for everyone
  // else). Signed out, non-committee members and professionals all
  // correctly stay on the locked default. ----
  var perksImpactCard = document.getElementById('perks-impact-card');
  if (perksImpactCard) {
    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (!session) return;
      checkIsCommittee(session).then(function (isCommittee) {
        if (!isCommittee) return;
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
  // Members arrive at the set-password form via the invite/reset email link
  // Supabase sends. Older/implicit-flow projects redirect here with
  // #access_token=...&type=invite (or type=recovery) in the URL hash;
  // newer projects (PKCE flow — this one included, per its publishable-key
  // format) redirect with ?code=... in the query string instead, often with
  // no `type` param at all. Checking only the hash meant every invite link
  // silently fell through to the plain login form instead — this site has
  // no other flow (no OAuth, no magic links) that ever produces a `code`
  // param, so treating its mere presence as "set a password" is safe here.
  var loginForm = document.getElementById('login-form');
  var setPasswordForm = document.getElementById('set-password-form');

  if (loginForm || setPasswordForm) {
    var loginStatus = document.getElementById('login-status');
    var setPasswordStatus = document.getElementById('set-password-status');

    var hash = window.location.hash || '';
    var search = window.location.search || '';
    var isRecoveryFlow = hash.indexOf('type=invite') !== -1
      || hash.indexOf('type=recovery') !== -1
      || search.indexOf('type=invite') !== -1
      || search.indexOf('type=recovery') !== -1
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
        supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname })
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
            showMessage(forgotPasswordStatus, "Check your email for a reset link — it may take a minute to arrive.");
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
          showMessage(setPasswordStatus, "Passwords don't match — try again.");
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

    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (!session) {
        window.location.href = 'member-login.html';
        return;
      }
      loadProfile(session);
      loadFeed();
      loadRecentJoins();

      // The president-only dashboard card — hidden from literally
      // everyone else, not just styled as locked. See PRESIDENT_UID.
      if (session.user.id === PRESIDENT_UID) {
        var presidentCard = document.getElementById('president-dashboard-card');
        if (presidentCard) presidentCard.style.display = '';
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

      supabaseClient
        .from('announcements')
        .select('*')
        .order('pinned', { ascending: false })
        .order('published_at', { ascending: false })
        .then(function (result) {
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
        ? '<p class="feed-item-from">— ' + escapeHtml(row.posted_by) + '</p>'
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
    function loadRecentJoins() {
      var banner = document.getElementById('network-recent-joins');
      var bannerText = document.getElementById('network-recent-joins-text');
      if (!banner || !bannerText) return;

      var since = new Date();
      since.setDate(since.getDate() - 14);
      var sinceIso = since.toISOString();

      supabaseClient
        .from('network_join_events')
        .select('full_name')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .then(function (result) {
          // Deduped first (see dedupeJoinEventsByName) so a re-added
          // account within the window can't inflate the count or push
          // a real second person out of the first three names shown.
          var deduped = dedupeJoinEventsByName(result.data || []);
          var total = deduped.length;
          var rows = deduped.slice(0, 3);
          if (!rows.length) return;

          var names = rows.map(function (r) { return '<strong>' + escapeHtml(r.full_name) + '</strong>'; });
          var extra = total - names.length;
          var text;
          if (names.length === 1) {
            text = names[0] + ' just joined the Network.';
          } else if (extra <= 0) {
            text = names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] + ' just joined the Network.';
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
            showHubContent(isCommitteeMember(result.data));
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
              showHubContent(isCommitteeMember(claimedRow));
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
            showMessage(hubError, "We couldn't find your membership profile yet — the committee may still be setting it up. Email acms@lincolnsu.com if this doesn't resolve soon.");
            return;
          }
          renderProfessionalProfile(proRow, session);
          // Professionals are never committee members.
          showHubContent(false);
        });
      });
    }

    // Shared by both profile types — reveals the hub content/links grid,
    // and toggles the locked/live variant of each not-yet-launched card
    // (Perks, Sankofa, MoTM nominations): only committee members see the
    // real thing right now, everyone else sees a locked "coming soon"
    // card in its place. MoTM nomination is the one exception — it's
    // open to every member and professional (not committee-only, see
    // motm.html's own nomination form), so its card always shows
    // unlocked here rather than following the isCommittee gate.
    function showHubContent(isCommittee) {
      hubContent.style.display = '';
      var linksSection = document.getElementById('member-hub-content-links');
      if (linksSection) linksSection.style.display = '';
      togglePair('perks-card', 'perks-locked-card', isCommittee);
      togglePair('sankofa-apply-card', 'sankofa-coming-soon-card', isCommittee);
      togglePair('motm-nominate-card', 'motm-locked-card', true);
    }

    function togglePair(liveId, lockedId, isCommittee) {
      var live = document.getElementById(liveId);
      var locked = document.getElementById(lockedId);
      if (live) live.style.display = isCommittee ? '' : 'none';
      if (locked) locked.style.display = isCommittee ? 'none' : '';
    }

    var MEMBER_TYPE_LABELS = {
      member: 'Member',
      supporting_committee: 'Supporting Committee Member',
      executive_committee: 'Executive Committee Member',
      senior_sankofa_mentor: 'Senior Sankofa Mentor',
      junior_sankofa_mentor: 'Junior Sankofa Mentor'
    };

    function renderProfile(member, session) {
      var courseYear = [member.course, member.year_of_study].filter(Boolean).join(' · ');
      var typeLabel = MEMBER_TYPE_LABELS[member.member_type] || MEMBER_TYPE_LABELS.member;

      setText('member-full-name', member.full_name);
      setText('member-course-year', courseYear);
      setText('member-course-year-2', courseYear);
      setText('member-number', member.membership_number);
      setText('member-number-2', member.membership_number);
      setText('member-email', session.user.email);
      setText('member-type-badge', typeLabel);
      setText('member-type-2', typeLabel);

      // committee_role (e.g. "President") is optional free text — only
      // show it, on the card and in the details list, when it's set.
      var positionEl = document.getElementById('member-position');
      var roleRow = document.getElementById('member-role-row');
      if (member.committee_role) {
        if (positionEl) {
          positionEl.textContent = member.committee_role;
          positionEl.style.display = '';
        }
        if (roleRow) {
          roleRow.style.display = '';
          setText('member-role-2', member.committee_role);
        }
      } else {
        if (positionEl) positionEl.style.display = 'none';
        if (roleRow) roleRow.style.display = 'none';
      }

      var statusEl = document.getElementById('member-status');
      if (statusEl) {
        var status = member.membership_status || 'active';
        var label = status.charAt(0).toUpperCase() + status.slice(1);
        statusEl.className = 'member-status-badge member-status-badge--' + status;
        statusEl.innerHTML = '<span class="member-status-badge-dot" aria-hidden="true"></span>' + label;
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

    function setText(id, value) {
      var el = document.getElementById(id);
      if (el) el.textContent = value || '—';
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
              showMessage(statusEl, 'Saved — this is what other members see on your Network card.');
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
          showMessage(statusEl, "Passwords don't match — try again.");
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

    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (!session) {
        window.location.href = 'member-login.html';
        return;
      }
      checkIsCommittee(session).then(function (isCommittee) {
        if (!isCommittee) {
          if (perksAuthGate) perksAuthGate.style.display = 'none';
          if (perksLocked) perksLocked.style.display = 'flex';
          return;
        }
        loadPerks();
      });
    });

    function loadPerks() {
      Promise.all([
        supabaseClient.from('discounts').select('*').order('sort_order', { ascending: true }),
        supabaseClient.from('member_opportunities').select('*').order('sort_order', { ascending: true })
      ]).then(function (results) {
        if (perksAuthGate) perksAuthGate.style.display = 'none';
        perksContent.style.display = '';

        renderPerkList(results[0].data, document.getElementById('discounts-list'), document.getElementById('discounts-empty'), renderDiscountCard);
        renderPerkList(results[1].data, document.getElementById('member-opportunities-list'), document.getElementById('member-opportunities-empty'), renderOpportunityCard);
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

    function cardLink(url, label) {
      var safe = safeUrl(url);
      if (!safe) return '';
      return '<a class="card-link" href="' + safe + '" target="_blank" rel="noopener">' + label +
        '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></a>';
    }

    function renderDiscountCard(row) {
      var initial = escapeHtml((row.partner_name || '?').trim().charAt(0).toUpperCase());
      var isLounge11 = /lounge\s*11/i.test(row.partner_name || '');
      var cardClass = 'card discount-card' + (isLounge11 ? ' discount-card--pink' : '');
      var addressHtml = row.address
        ? '<p class="discount-address"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.6"/></svg><span>' + escapeHtml(row.address) + '</span></p>'
        : '';
      var codeHtml = renderCodeReveal(row.code);
      return '<div class="' + cardClass + '"><span class="discount-card-badge" aria-hidden="true">' + initial + '</span><h3 class="card-title">' +
        escapeHtml(row.partner_name) + '</h3>' + addressHtml + '<p>' +
        escapeHtml(row.description) + '</p>' + codeHtml + cardLink(row.link, 'Visit partner') + '</div>';
    }

    function renderOpportunityCard(row) {
      var tagHtml = row.category ? '<span class="card-tag">' + escapeHtml(row.category) + '</span>' : '';
      return '<div class="card">' + tagHtml + '<h3 class="card-title"' + (row.category ? ' style="margin-top: var(--space-2);"' : '') + '>' + escapeHtml(row.title) + '</h3><p>' +
        escapeHtml(row.description) + '</p>' + cardLink(row.link, 'Learn more') + '</div>';
    }
  }

  // ---- Opportunities page: public preview, gated. Signed-out visitors
  // (and MMG-only guests) see the first couple of rows, with the rest
  // rendered behind a blurred gradient and a "sign in" card. Any signed-
  // in LACMS member sees the full list. Same member_opportunities table
  // as the members hub's "Members-first opportunities" section — one
  // source of truth, just shown differently depending on who's looking.
  var OPPORTUNITIES_PREVIEW_COUNT = 2;
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

        supabaseClient.auth.getSession().then(function (sessionResult) {
          var session = sessionResult.data && sessionResult.data.session;
          if (!session) {
            renderOpportunitiesGated(rows, false);
            return;
          }
          supabaseClient
            .from('members')
            .select('id')
            .eq('id', session.user.id)
            .maybeSingle()
            .then(function (memberResult) {
              if (memberResult.data) {
                renderOpportunitiesGated(rows, true);
                return;
              }
              getProfessionalRow(session).then(function (proRow) {
                renderOpportunitiesGated(rows, !!proRow);
              });
            });
        });
      });
  }

  function renderOpportunitiesGated(rows, isMember) {
    var visibleRows = isMember ? rows : rows.slice(0, OPPORTUNITIES_PREVIEW_COUNT);
    var lockedRows = isMember ? [] : rows.slice(OPPORTUNITIES_PREVIEW_COUNT);

    oppListEl.innerHTML = visibleRows.map(renderOpportunityRow).join('');

    if (lockedRows.length) {
      var lockWrap = document.getElementById('opportunities-locked-wrap');
      var lockedRowsEl = document.getElementById('opportunities-locked-rows');
      if (lockWrap && lockedRowsEl) {
        lockedRowsEl.innerHTML = lockedRows.map(renderOpportunityRow).join('');
        lockWrap.style.display = '';
      }
    }
  }

  function renderOpportunityRow(row) {
    var tagHtml = row.category ? '<span class="card-tag">' + escapeHtml(row.category) + '</span>' : '';
    var safeLink = safeUrl(row.link);
    var isMailto = safeLink.indexOf('mailto:') === 0;
    var linkHtml = safeLink
      ? '<a class="btn btn-outline" href="' + safeLink + '"' + (isMailto ? '' : ' target="_blank" rel="noopener"') + '>Learn more</a>'
      : '';
    return '<div class="opp-row">' +
      '<div>' + tagHtml + '<h2 class="card-title" style="margin-top: var(--space-2);">' + escapeHtml(row.title) + '</h2><p>' + escapeHtml(row.description) + '</p></div>' +
      '<div class="opp-row-actions">' + linkHtml + '</div>' +
      '</div>';
  }

  // ---- Events page: member registration (alongside the existing RSVP
  // mailto link, which stays available to everyone including logged-out
  // visitors) ----
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
        btn.textContent = "You're registered — cancel?";
      }
    });
  }

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
              ? "You've already used this month's nomination — it resets on the 1st."
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
      photoLabel.textContent = 'Photo — ' + winner.full_name;
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
  // dashboard.) Committee-gated, sankofa_eligible-gated, and closes 11
  // October 2026 — enforced again in the DB by migration 029's trigger,
  // this client-side check just gives a friendlier message. ----
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

      checkIsCommittee(session).then(function (isCommittee) {
        if (!isCommittee) {
          if (sankofaAuthGate) sankofaAuthGate.style.display = 'none';
          var comingSoonNote = document.getElementById('sankofa-coming-soon-note');
          if (comingSoonNote) comingSoonNote.style.display = 'flex';
          return;
        }
        supabaseClient
          .from('members')
          .select('sankofa_eligible')
          .eq('id', session.user.id)
          .single()
          .then(function (result) {
            if (sankofaAuthGate) sankofaAuthGate.style.display = 'none';
            if (result.error || !result.data || !result.data.sankofa_eligible) {
              if (sankofaNotEligible) sankofaNotEligible.style.display = 'flex';
              return;
            }
            if (Date.now() > SANKOFA_MENTEE_DEADLINE) {
              var deadlineNote = document.getElementById('sankofa-mentee-deadline-passed');
              if (deadlineNote) deadlineNote.style.display = 'flex';
              return;
            }
            checkExistingApplication(session);
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
    var mmgHash = window.location.hash || '';
    var mmgSearch = window.location.search || '';
    var mmgIsRecoveryFlow = mmgHash.indexOf('type=recovery') !== -1
      || mmgSearch.indexOf('type=recovery') !== -1
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
          showMessage(statusEl, "Passwords don't match — try again.");
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
        supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname })
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
            showMessage(mmgForgotPasswordStatus, "Check your email for a reset link — it may take a minute to arrive.");
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
          showMessage(statusEl, "Passwords don't match — try again.");
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
    if (welcomeText) welcomeText.textContent = 'Welcome back, ' + firstName + ' — you’re attending MMG.';

    setMmgCardText('mmg-card-name', identity.fullName);
    setMmgCardText('mmg-card-university', identity.university);
    setMmgCardText('mmg-card-access', tierLabel);
    setMmgCardText('mmg-card-tier', 'MMG · ' + tierLabel);
  }

  function setMmgCardText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value || '—';
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
      ? '<p class="feed-item-from">— ' + escapeHtml(row.posted_by) + '</p>'
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
        showMessage(statusEl, 'One or more files are over 200MB — try a smaller file or a compressed video.');
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
            showMessage(statusEl, 'Some files failed to upload — try again, or email acms@lincolnsu.com.');
            return;
          }
          statusEl.style.color = 'var(--color-gold-light)';
          showMessage(statusEl, 'Thank you — your media has been uploaded.');
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
            showMessage(mmgHubError, "We couldn't find your MMG account yet — try logging out and back in, or email acms@lincolnsu.com if this doesn't resolve soon.");
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
      if (el) el.textContent = value || '—';
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
          showMessage(statusEl, "Passwords don't match — try again.");
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
            listEl.innerHTML = '<p class="news-comments-empty">No comments yet — be the first.</p>';
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
    var NETWORK_COURSE_ORDER = ['Medicine', 'Pharmacy', 'Dental Hygiene and Therapy', 'Diagnostic Radiography', 'Nursing and Midwifery', 'Paramedic Science'];
    var NETWORK_ACCENTS = ['gold', 'green', 'red', 'purple'];
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
      loadNetwork();
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
        detail = [row.course, row.year_of_study].filter(Boolean).join(' · ');
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
        : [row.course, row.year_of_study].filter(Boolean).join(' · ');
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
          showMessage(networkHubError, "We couldn't load the Network right now — try refreshing, or email acms@lincolnsu.com if this doesn't resolve soon.");
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
      members.forEach(function (m) {
        var course = (m.course || '').trim() || 'Course not set';
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
      var roleLabel = m.is_pending ? 'Pending' : (m.committee_role || NETWORK_TYPE_LABELS[m.member_type]);
      var badgeHtml = roleLabel ? '<span class="network-card-badge">' + escapeHtml(roleLabel) + '</span>' : '';
      var linkedinHtml = safeUrl(m.linkedin_url) ? '<span class="network-card-linkedin" aria-hidden="true">' + NETWORK_LINKEDIN_ICON + '</span>' : '';
      var isCommittee = !m.is_pending && (m.member_type === 'executive_committee' || m.member_type === 'supporting_committee');
      var cardClass = 'network-card' + (isCommittee ? ' network-card--committee' : '') + (m.is_pending ? ' network-card--pending' : '');
      return '<button type="button" class="' + cardClass + '" data-network-type="member" data-network-id="' + m.id + '">' +
        linkedinHtml +
        '<span class="network-card-avatar">' + escapeHtml(networkInitials(m.full_name)) + '</span>' +
        '<span class="network-card-name">' + escapeHtml(m.full_name) + '</span>' +
        '<span class="network-card-meta">' + escapeHtml([m.course, m.year_of_study ? yearGroupLabel(m.year_of_study) : ''].filter(Boolean).join(' · ') || '—') + '</span>' +
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
        var roleLabel = record.is_pending ? 'Pending' : (record.committee_role || NETWORK_TYPE_LABELS[record.member_type]);
        var bioHtml = record.is_pending
          ? '<p class="network-modal-bio" style="font-style:italic; color: var(--color-text-faint);">Still finishing sign-up — their full profile will appear here once they\'ve joined LACMS.</p>'
          : (record.bio
              ? '<p class="network-modal-bio">' + escapeHtml(record.bio) + '</p>'
              : '<p class="network-modal-bio" style="font-style:italic; color: var(--color-text-faint);">No bio added yet.</p>');
        body.innerHTML =
          '<span class="network-modal-avatar" style="background: var(--color-bg-alt); color: var(--color-gold-light);">' + escapeHtml(networkInitials(record.full_name)) + '</span>' +
          '<h2 class="network-modal-name" id="network-modal-name">' + escapeHtml(record.full_name) + '</h2>' +
          (roleLabel ? '<p class="network-modal-role">' + escapeHtml(roleLabel) + '</p>' : '') +
          '<p class="network-modal-meta">' + escapeHtml([record.course, record.year_of_study ? yearGroupLabel(record.year_of_study) : ''].filter(Boolean).join(' · ') || '—') + '</p>' +
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

  // ---- President's activity dashboard — client-side check here is only
  // ever a UX shortcut (redirect away, don't bother rendering). The real
  // security boundary is is_president() inside every president_get_*
  // RPC, which raises for anyone else regardless of what this page does. ----
  var presidentContent = document.getElementById('president-content');
  if (presidentContent) {
    var presidentAuthGate = document.getElementById('auth-gate');
    var presidentHubError = document.getElementById('hub-error');
    var ONLINE_WINDOW_MS = 5 * 60 * 1000;
    var presidentUserId = null;

    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (!session) {
        window.location.href = 'member-login.html';
        return;
      }
      if (session.user.id !== PRESIDENT_UID) {
        window.location.href = 'member-hub.html';
        return;
      }
      presidentUserId = session.user.id;
      initDashNav();
      loadPresidentDashboard();
      // Keeps "online now" honest without needing a manual reload —
      // only while the tab is actually visible, so it isn't polling
      // Supabase in the background for a tab nobody's looking at.
      setInterval(function () {
        if (document.visibilityState === 'visible') loadPresidentDashboard();
      }, 45000);
    });

    // ---- Landing grid of section cards, replacing one long scroll —
    // click a card to see just that section, "All sections" to go back.
    // Data for every section still loads together up front (cheap — a
    // handful of indexed RPC calls), only the *display* is split by
    // section; #<section> in the URL deep-links straight to one. ----
    var DASH_SECTIONS = ['activity', 'mmg', 'sankofa', 'motm', 'events', 'gallery', 'create'];
    var dashLanding = document.getElementById('dash-landing');
    function showDashSection(section) {
      if (DASH_SECTIONS.indexOf(section) === -1) section = null;
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
        });
      });
      document.querySelectorAll('[data-dash-back]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          showDashSection(null);
          window.history.replaceState(null, '', window.location.pathname);
        });
      });
      var initialSection = (window.location.hash || '').replace('#', '');
      if (DASH_SECTIONS.indexOf(initialSection) !== -1) showDashSection(initialSection);
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
        // This page is president-only, so the raw Postgres/PostgREST
        // error is safe (and far more useful than a generic message) to
        // show right here — no need to dig through devtools to diagnose
        // a migration that hasn't run yet or a broken RPC.
        emptyEl.textContent = "Couldn't load this section" + (errorMessage ? ': ' + errorMessage : '') + " — try refreshing, or email acms@lincolnsu.com if this doesn't resolve soon.";
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

      beatOwnPresence.then(function () {
        return Promise.all([
          supabaseClient.rpc('president_get_members'),
          supabaseClient.rpc('president_get_pending_members'),
          supabaseClient.rpc('president_get_professionals'),
          supabaseClient.rpc('president_get_mmg_guests'),
          supabaseClient.rpc('president_get_sankofa_applications'),
          supabaseClient.rpc('president_get_sankofa_mentor_applications'),
          supabaseClient.rpc('president_get_motm_nominations'),
          supabaseClient.rpc('president_get_event_registrations')
        ]);
      }).then(function (results) {
        if (presidentAuthGate) presidentAuthGate.style.display = 'none';

        if (results[0].error || results[1].error || results[2].error || results[3].error) {
          showMessage(presidentHubError, "Couldn't load the dashboard right now — try refreshing, or email acms@lincolnsu.com if this doesn't resolve soon.");
          return;
        }

        presidentContent.style.display = '';

        var members = results[0].data || [];
        var pendingMembers = results[1].data || [];
        var professionals = results[2].data || [];
        var mmgGuests = results[3].data || [];
        var courseAccent = buildCourseAccentMap(members);

        renderOnlineNow(members, professionals, mmgGuests, courseAccent);
        renderStats(members, pendingMembers, professionals, mmgGuests);
        renderAttentionList(members, pendingMembers, professionals, mmgGuests);
        renderPeopleSection(members, professionals, courseAccent);
        renderMmgSection(mmgGuests);
        var activityTotal = members.length + professionals.length + mmgGuests.length + pendingMembers.length;
        setDashCount('activity', activityTotal + (activityTotal === 1 ? ' account' : ' accounts'));
        setDashCount('mmg', mmgGuests.length + (mmgGuests.length === 1 ? ' guest' : ' guests'));

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
        if (results[4].error && results[5].error) {
          showSectionLoadError('sankofa-applications-list', 'sankofa-applications-empty', 'sankofa', results[4].error.message);
        } else {
          renderSankofaApplications(sankofaMerged);
          setDashCount('sankofa', sankofaMerged.length + (sankofaMerged.length === 1 ? ' application' : ' applications') + (results[4].error || results[5].error ? ' (partial — see console)' : ''));
        }

        if (results[6].error) {
          console.error('MoTM nominations failed to load:', results[6].error.message);
          showSectionLoadError('motm-nominations-list', 'motm-nominations-empty', 'motm', results[6].error.message);
        } else {
          var motmList = results[6].data || [];
          renderMotmNominations(motmList);
          setDashCount('motm', motmList.length + (motmList.length === 1 ? ' nomination' : ' nominations'));
        }
        if (results[7].error) {
          console.error('Event registrations failed to load:', results[7].error.message);
          showSectionLoadError('event-registrations-sections', 'event-registrations-empty', 'events', results[7].error.message);
        } else {
          var eventsList = results[7].data || [];
          renderEventRegistrations(eventsList);
          setDashCount('events', eventsList.length + (eventsList.length === 1 ? ' registration' : ' registrations'));
        }
        loadGallerySubmissions();
        loadGalleryManage();

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

    // Someone who's only ever clicked an invite link (but never finished
    // setting a password) already has a live Supabase session — that's
    // enough for the site-wide heartbeat to ping member_presence for
    // them, even though they can't actually sign back in yet. Requiring
    // activated_at here is what keeps them showing as "invite opened,
    // not finished" instead of wrongly appearing online.
    // The single source of truth for "how recently was this person
    // active" — a fresh sign-in counts even a beat or two before their
    // first heartbeat has had a chance to land, so this never
    // contradicts itself the way checking last_seen_at alone did
    // (which could show "Active · Just now" from a fresh login while
    // simultaneously not counting toward "online" at all).
    function presidentLastActivity(row) {
      return row.last_seen_at || row.last_sign_in_at || null;
    }

    function presidentIsOnline(row) {
      if (!row.activated_at) return false;
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

    // Four states, ordered by what actually needs attention: someone
    // who opened their invite but never finished setting a password
    // (exactly the bug fixed earlier this session) is far more
    // actionable than someone who's simply never opened it yet.
    function presidentStatus(row) {
      if (presidentIsOnline(row)) {
        return { label: 'Online now', cls: 'online' };
      }
      if (row.activated_at) {
        var lastActivity = presidentLastActivity(row);
        return { label: lastActivity ? 'Active · ' + timeAgo(lastActivity) : 'Active', cls: 'active' };
      }
      if (row.last_sign_in_at) {
        return { label: 'Invite opened, not finished', cls: 'stuck' };
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
      var activatedLabel = row.activated_at ? timeAgo(row.activated_at) : '—';
      var loginLabel = row.last_sign_in_at ? timeAgo(row.last_sign_in_at) : '—';
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
        { num: totalCount, label: 'Total accounts', cls: '' },
        { num: onlineCount, label: 'Online now', cls: 'online' },
        { num: activatedCount, label: 'Fully set up', cls: '' },
        { num: needsAttentionCount, label: 'Needs a nudge', cls: 'pending' }
      ];
      document.getElementById('dash-stats').innerHTML = stats.map(function (s) {
        return '<div class="dash-stat dash-stat--' + s.cls + '"><div class="dash-stat-num">' + s.num + '</div><div class="dash-stat-label">' + escapeHtml(s.label) + '</div></div>';
      }).join('');
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
            '<span class="roster-time" data-label="Set up">—</span><span class="roster-time" data-label="Last login">—</span>' +
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
    var DASH_COURSE_ORDER = ['Medicine', 'Pharmacy', 'Dental Hygiene and Therapy', 'Diagnostic Radiography', 'Nursing and Midwifery', 'Paramedic Science'];
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
      if (countEl) countEl.textContent = list.length + ' total — ' + mentees + ' mentee' + (mentees === 1 ? '' : 's') + ', ' + mentors + ' mentor' + (mentors === 1 ? '' : 's');
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
            showMessage(statusEl, 'Some photos failed to upload — try again.');
          } else {
            statusEl.style.color = '#6fcf97';
            showMessage(statusEl, 'Added to the public gallery.');
          }
          galleryLiveUploadForm.reset();
          loadGalleryManage();
        });
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
    // is_president()-gated insert policies from migration 032), and a
    // password-reset email sends the new person to set their own
    // password — no service-role admin API involved anywhere, since
    // that key must never exist in browser code. ----
    var createAccountForm = document.getElementById('create-account-form');
    if (createAccountForm) {
      var createAccountTypeTabs = document.getElementById('create-account-type-tabs');
      var currentAccountType = 'member';
      var createAccountClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });

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

        createAccountClient.auth.signUp({ email: email, password: randomPassword() }).then(function (signUpResult) {
          if (signUpResult.error || !signUpResult.data || !signUpResult.data.user) {
            btn.disabled = false;
            statusEl.style.color = '#ef8b8f';
            showMessage(statusEl, (signUpResult.error && signUpResult.error.message) || "Couldn't create the account — the email may already be in use.");
            return;
          }
          var newUserId = signUpResult.data.user.id;

          var profileInsert;
          if (currentAccountType === 'member') {
            profileInsert = supabaseClient.from('members').insert({
              id: newUserId,
              full_name: name,
              course: document.getElementById('create-member-course').value.trim() || null,
              year_of_study: document.getElementById('create-member-year').value.trim() || null,
              member_type: document.getElementById('create-member-type').value,
              committee_role: document.getElementById('create-member-role').value.trim() || null,
              sankofa_eligible: document.getElementById('create-member-sankofa').checked,
              mmg_attendee: document.getElementById('create-member-mmg-attendee').checked,
              mmg_committee: document.getElementById('create-member-mmg-committee').checked
            });
          } else if (currentAccountType === 'professional') {
            profileInsert = supabaseClient.from('network_professionals').insert({
              user_id: newUserId,
              email: email,
              full_name: name,
              title: document.getElementById('create-pro-title').value.trim() || 'Professional',
              organisation: document.getElementById('create-pro-organisation').value.trim() || null,
              category: document.getElementById('create-pro-category').value,
              linkedin_url: document.getElementById('create-pro-linkedin').value.trim() || null
            });
          } else {
            profileInsert = supabaseClient.from('mmg_guests').insert({
              id: newUserId,
              full_name: name,
              university: document.getElementById('create-mmg-university').value.trim() || 'Not set',
              access_level: document.getElementById('create-mmg-access').value
            });
          }

          profileInsert.then(function (profileResult) {
            if (profileResult.error) {
              btn.disabled = false;
              statusEl.style.color = '#ef8b8f';
              showMessage(statusEl, "The login was created, but saving their profile failed (" + profileResult.error.message + "). Finish it from Table Editor using this account id: " + newUserId);
              return;
            }
            var loginPage = currentAccountType === 'mmg' ? 'mmg-login.html' : 'member-login.html';
            createAccountClient.auth.resetPasswordForEmail(email, {
              redirectTo: window.location.origin + '/' + loginPage
            }).then(function () {
              btn.disabled = false;
              statusEl.style.color = '#6fcf97';
              showMessage(statusEl, name + "'s account is live — they've been emailed to set their password.");
              createAccountForm.reset();
              showAccountTypeFields(currentAccountType);
              loadPresidentDashboard();
            });
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
        if (!window.confirm("Delete this nomination? They'll be able to submit a new one straight away — this month's slot frees up as soon as this is deleted.")) return;
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
              // there forever after being actioned.
              supabaseClient.storage.from('gallery-submissions').remove([pubPath]).then(function () {
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
  }
})();
