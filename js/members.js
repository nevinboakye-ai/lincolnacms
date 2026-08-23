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
              university: meta.university || 'Not specified'
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
                if (!fullName) return;
                var firstName = fullName.trim().split(' ')[0];
                memberNavLinks.forEach(function (el) {
                  el.href = 'mmg-hub.html';
                  setNavLinkText(el, 'Hi, ' + firstName, true);
                });
              });
          });
      }
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
  // "you have access" badge — once we've actually confirmed a LACMS
  // membership. Signed out, or an MMG-only guest with no `members` row,
  // both correctly stay on the locked default. ----
  var perksImpactCard = document.getElementById('perks-impact-card');
  if (perksImpactCard) {
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
          perksImpactCard.href = 'member-perks.html';
          var badge = document.getElementById('perks-impact-badge');
          if (badge) {
            badge.className = 'impact-badge impact-badge--green';
            badge.innerHTML = '<span class="impact-badge-dot" aria-hidden="true"></span> You have access';
          }
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
  // Supabase sends, which redirects here with #access_token=...&type=invite
  // (or type=recovery) in the URL — Supabase's client reads that hash on
  // load and establishes a session, so all we do is detect the hash and
  // switch which form is visible.
  var loginForm = document.getElementById('login-form');
  var setPasswordForm = document.getElementById('set-password-form');

  if (loginForm || setPasswordForm) {
    var loginStatus = document.getElementById('login-status');
    var setPasswordStatus = document.getElementById('set-password-status');

    var hash = window.location.hash || '';
    var isRecoveryFlow = hash.indexOf('type=invite') !== -1 || hash.indexOf('type=recovery') !== -1;

    if (isRecoveryFlow && setPasswordForm) {
      if (loginForm) loginForm.classList.remove('is-active');
      setPasswordForm.classList.add('is-active');
    } else if (loginForm) {
      loginForm.classList.add('is-active');
      // Already signed in (e.g. clicked an old "Member login" link or a
      // bookmark) and not here to set a new password — no reason to show
      // the form, just take them straight to the hub.
      supabaseClient.auth.getSession().then(function (result) {
        if (result.data && result.data.session) {
          window.location.href = 'member-hub.html';
        }
      });
    }

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
            window.location.href = 'member-hub.html';
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
      return '<article class="' + classes + '">' +
        '<div class="feed-item-meta">' + pinHtml +
        '<span class="feed-item-tag">' + escapeHtml(meta.label) + '</span>' +
        '<span class="feed-item-date">' + escapeHtml(timeAgo(row.published_at)) + '</span></div>' +
        '<h3 class="feed-item-title">' + escapeHtml(row.title) + '</h3>' +
        '<p class="feed-item-body">' + escapeHtml(row.body) + '</p>' +
        '</article>';
    }

    function loadProfile(session) {
      supabaseClient
        .from('members')
        .select('*')
        .eq('id', session.user.id)
        .single()
        .then(function (result) {
          if (authGate) authGate.style.display = 'none';
          if (result.error || !result.data) {
            showMessage(hubError, "We couldn't find your membership profile yet — the committee may still be setting it up. Email acms@lincolnsu.com if this doesn't resolve soon.");
            return;
          }
          renderProfile(result.data, session);
          hubContent.style.display = '';
          var linksSection = document.getElementById('member-hub-content-links');
          if (linksSection) linksSection.style.display = '';
        });
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
          supabaseClient
            .from('member_profiles')
            .upsert({
              id: session.user.id,
              linkedin_url: linkedinUrl || null,
              bio: bio || null,
              updated_at: new Date().toISOString()
            })
            .then(function (upsertResult) {
              btn.disabled = false;
              if (upsertResult.error) {
                showMessage(statusEl, upsertResult.error.message);
                return;
              }
              statusEl.style.color = 'var(--color-gold-light)';
              showMessage(statusEl, 'Saved — this is what other members see on your Network card.');
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

    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (!session) {
        window.location.href = 'member-login.html';
        return;
      }
      loadPerks();
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
      if (!url) return '';
      return '<a class="card-link" href="' + encodeURI(url) + '" target="_blank" rel="noopener">' + label +
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
              renderOpportunitiesGated(rows, !!memberResult.data);
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
    var isMailto = row.link && row.link.indexOf('mailto:') === 0;
    var linkHtml = row.link
      ? '<a class="btn btn-outline" href="' + encodeURI(row.link) + '"' + (isMailto ? '' : ' target="_blank" rel="noopener"') + '>Learn more</a>'
      : '';
    return '<div class="opp-row is-visible">' +
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
          var name = btn.getAttribute('data-event-name');
          btn.disabled = true;
          supabaseClient
            .from('event_registrations')
            .insert({ member_id: session.user.id, event_slug: slug, event_name: name })
            .then(function (result) {
              if (result.error) {
                btn.disabled = false;
                btn.textContent = 'Try again';
                return;
              }
              markRegistered(btn);
            });
        });
      });

      function markRegistered(btn) {
        btn.disabled = true;
        btn.classList.add('is-registered');
        btn.textContent = "You're registered";
      }
    });
  }

  // ---- MoTM page: nomination form for signed-in LACMS members. Unlike
  // the hub/perks/Sankofa pages, this doesn't redirect anyone away — the
  // page stays fully public, it just swaps the "log in to nominate" note
  // for the real form once a session is confirmed. MMG-only guests (no
  // row in `members`) get a locked message instead of the form — this
  // is a LACMS member exclusive, not open to MMG portal accounts. ----
  var nominateForm = document.getElementById('nominate-form');
  var nominateNotSignedIn = document.getElementById('nominate-not-signed-in');
  var nominateLocked = document.getElementById('nominate-locked');
  var nominateFormWrap = document.getElementById('nominate-form-wrap');
  if (nominateForm && nominateNotSignedIn && nominateFormWrap) {
    var nominateSession = null;

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
          if (memberResult.data) {
            nominateFormWrap.style.display = 'block';
          } else if (nominateLocked) {
            nominateLocked.style.display = 'flex';
          }
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
            showMessage(statusEl, result.error.message);
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
    var photoHtml = row.photo_url
      ? '<img src="' + encodeURI(row.photo_url) + '" alt="' + escapeHtml(row.full_name || '') + '" style="width:100%; height:100%; object-fit:cover;">'
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

  // ---- Sankofa Circle application page ----
  var sankofaFormWrap = document.getElementById('sankofa-form-wrap');
  var sankofaAlreadyApplied = document.getElementById('sankofa-already-applied');
  var sankofaNotEligible = document.getElementById('sankofa-not-eligible');
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
          checkExistingApplication(session);
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

    supabaseClient.auth.getSession().then(function (result) {
      if (result.data && result.data.session) {
        window.location.href = 'mmg-hub.html';
      }
    });

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
    var linkHtml = row.link
      ? '<a class="card-link" href="' + encodeURI(row.link) + '" target="_blank" rel="noopener">Visit partner<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></a>'
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
    return '<article class="' + classes + '">' +
      '<div class="feed-item-meta">' + pinHtml +
      '<span class="feed-item-tag">' + escapeHtml(tagLabel) + '</span>' +
      '<span class="feed-item-date">' + escapeHtml(timeAgo(row.published_at)) + '</span></div>' +
      '<h3 class="feed-item-title">' + escapeHtml(row.title) + '</h3>' +
      '<p class="feed-item-body">' + escapeHtml(row.body) + '</p>' +
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
      var mediaHtml = row.image_url
        ? '<div class="news-post-media"><img src="' + encodeURI(row.image_url) + '" alt="" loading="lazy"></div>'
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
          '<div class="feed-item-meta">' + pinHtml + '<span class="feed-item-tag">News</span><span class="feed-item-date">' + escapeHtml(timeAgo(row.published_at)) + '</span></div>' +
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

    var NETWORK_COURSE_ORDER = ['Medicine', 'Pharmacy', 'Dental Hygiene and Therapy', 'Diagnostic Radiography', 'Nursing & Midwifery', 'Nursing', 'Midwifery', 'Paramedic Science'];
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
    var NETWORK_PROFESSIONAL_CATEGORY_LABELS = {
      senior_doctor: 'Senior Doctor / Consultant',
      alumni_doctor: 'Alumni Doctor',
      pharmacist: 'Pharmacist',
      other: 'Professional'
    };

    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (!session) {
        window.location.href = 'member-login.html';
        return;
      }
      loadNetwork();
    });

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
      });
    }

    function courseSortKey(course) {
      var idx = NETWORK_COURSE_ORDER.indexOf(course);
      return idx === -1 ? 999 : idx;
    }

    function yearSortKey(year) {
      var match = /(\d+)/.exec(year || '');
      return match ? parseInt(match[1], 10) : 999;
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

      wrap.innerHTML = courses.map(function (course, i) {
        var colors = NETWORK_ACCENT_COLORS[NETWORK_ACCENTS[i % NETWORK_ACCENTS.length]];
        var courseMembers = byCourse[course];

        var byYear = {};
        courseMembers.forEach(function (m) {
          var year = (m.year_of_study || '').trim() || 'Year not set';
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
      var roleLabel = m.committee_role || NETWORK_TYPE_LABELS[m.member_type];
      var badgeHtml = roleLabel ? '<span class="network-card-badge">' + escapeHtml(roleLabel) + '</span>' : '';
      var linkedinHtml = m.linkedin_url ? '<span class="network-card-linkedin" aria-hidden="true">' + NETWORK_LINKEDIN_ICON + '</span>' : '';
      return '<button type="button" class="network-card" data-network-type="member" data-network-id="' + m.id + '">' +
        linkedinHtml +
        '<span class="network-card-avatar">' + escapeHtml(networkInitials(m.full_name)) + '</span>' +
        '<span class="network-card-name">' + escapeHtml(m.full_name) + '</span>' +
        '<span class="network-card-meta">' + escapeHtml([m.course, m.year_of_study].filter(Boolean).join(' · ') || '—') + '</span>' +
        badgeHtml +
        '</button>';
    }

    function renderNetworkProfessionals(rows) {
      var gridWrap = document.getElementById('network-professionals-wrap');
      var grid = document.getElementById('network-professionals-grid');
      if (!rows.length) return;
      gridWrap.style.display = '';
      grid.innerHTML = rows.map(renderNetworkProfessionalCard).join('');
    }

    function renderNetworkProfessionalCard(p) {
      var linkedinHtml = p.linkedin_url ? '<span class="network-card-linkedin" aria-hidden="true">' + NETWORK_LINKEDIN_ICON + '</span>' : '';
      var avatarHtml = p.photo_url
        ? '<img src="' + encodeURI(p.photo_url) + '" alt="">'
        : escapeHtml(networkInitials(p.full_name));
      return '<button type="button" class="network-card" data-network-type="professional" data-network-id="' + p.id + '">' +
        linkedinHtml +
        '<span class="network-card-avatar">' + avatarHtml + '</span>' +
        '<span class="network-card-name">' + escapeHtml(p.full_name) + '</span>' +
        '<span class="network-card-meta">' + escapeHtml(p.title) + '</span>' +
        '<span class="network-card-badge">' + escapeHtml(NETWORK_PROFESSIONAL_CATEGORY_LABELS[p.category] || 'Professional') + '</span>' +
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
        return url ? '<a class="network-modal-linkedin" href="' + encodeURI(url) + '" target="_blank" rel="noopener">' + NETWORK_LINKEDIN_ICON + 'View LinkedIn</a>' : '';
      };

      if (type === 'member') {
        var roleLabel = record.committee_role || NETWORK_TYPE_LABELS[record.member_type];
        body.innerHTML =
          '<span class="network-modal-avatar" style="background: var(--color-bg-alt); color: var(--color-gold-light);">' + escapeHtml(networkInitials(record.full_name)) + '</span>' +
          '<h2 class="network-modal-name" id="network-modal-name">' + escapeHtml(record.full_name) + '</h2>' +
          (roleLabel ? '<p class="network-modal-role">' + escapeHtml(roleLabel) + '</p>' : '') +
          '<p class="network-modal-meta">' + escapeHtml([record.course, record.year_of_study].filter(Boolean).join(' · ') || '—') + '</p>' +
          (record.bio
            ? '<p class="network-modal-bio">' + escapeHtml(record.bio) + '</p>'
            : '<p class="network-modal-bio" style="font-style:italic; color: var(--color-text-faint);">No bio added yet.</p>') +
          linkedinBtn(record.linkedin_url);
      } else {
        var avatarHtml = record.photo_url
          ? '<img src="' + encodeURI(record.photo_url) + '" alt="">'
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
})();
