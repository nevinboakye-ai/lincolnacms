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

  // ---- Site-wide: keep the "Member login" nav link in sync with whether
  // there's actually a signed-in session, on every single page (not just
  // the login/hub pages). Without this, the link's label and destination
  // were hardcoded per page, so a signed-in member browsing the rest of
  // the site would still see "Member login" everywhere — which looks
  // exactly like being logged out, even though the session was fine the
  // whole time.
  var memberNavLinks = document.querySelectorAll('[data-member-nav-link]');
  var hideWhenSignedInEls = document.querySelectorAll('[data-hide-when-signed-in]');

  if (memberNavLinks.length || hideWhenSignedInEls.length) {
    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      var loggedIn = !!session;

      memberNavLinks.forEach(function (el) {
        el.href = loggedIn ? 'member-hub.html' : 'member-login.html';
        el.classList.toggle('is-signed-in', loggedIn);
        setNavLinkText(el, loggedIn ? 'Members hub' : 'Member login', loggedIn);
      });

      // "Join the society" / "Become a member" buttons are redundant once
      // you're already a member — hide them rather than nag someone who's
      // signed in to join a society they're already part of.
      hideWhenSignedInEls.forEach(function (el) {
        el.style.display = loggedIn ? 'none' : '';
      });

      // Once we know they're signed in, upgrade the label to their first
      // name — a much more obvious "yes, still you, still logged in" cue
      // than a generic label that doesn't change between pages.
      if (loggedIn) {
        supabaseClient
          .from('members')
          .select('full_name')
          .eq('id', session.user.id)
          .single()
          .then(function (result) {
            var fullName = result.data && result.data.full_name;
            if (!fullName) return;
            var firstName = fullName.trim().split(' ')[0];
            memberNavLinks.forEach(function (el) {
              setNavLinkText(el, 'Hi, ' + firstName, true);
            });
          });
      }
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
    });

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
      var codeHtml = row.code
        ? '<div class="discount-code"><span class="discount-code-label">Code</span><span class="discount-code-value">' + escapeHtml(row.code) + '</span></div>'
        : '';
      return '<div class="card discount-card"><span class="discount-card-badge" aria-hidden="true">' + initial + '</span><h3 class="card-title">' +
        escapeHtml(row.partner_name) + '</h3><p>' +
        escapeHtml(row.description) + '</p>' + codeHtml + cardLink(row.link, 'Visit partner') + '</div>';
    }

    function renderOpportunityCard(row) {
      return '<div class="card"><h3 class="card-title">' + escapeHtml(row.title) + '</h3><p>' +
        escapeHtml(row.description) + '</p>' + cardLink(row.link, 'Learn more') + '</div>';
    }
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

  // ---- MoTM page: nomination form for signed-in members. Unlike the hub/
  // perks/Sankofa pages, this doesn't redirect anyone away — the page stays
  // fully public, it just swaps the "log in to nominate" note for the real
  // form once a session is confirmed. ----
  var nominateForm = document.getElementById('nominate-form');
  var nominateNotSignedIn = document.getElementById('nominate-not-signed-in');
  var nominateFormWrap = document.getElementById('nominate-form-wrap');
  if (nominateForm && nominateNotSignedIn && nominateFormWrap) {
    var nominateSession = null;

    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (!session) return;
      nominateSession = session;
      nominateNotSignedIn.style.display = 'none';
      nominateFormWrap.style.display = 'block';
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
})();
