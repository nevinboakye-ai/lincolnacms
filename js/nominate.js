// Member of the Month, made easy (migration 099). One shared script that:
//
//   * opens a one-tap "Nominate <person>" dialog from anywhere on the site - any
//     element with data-nominate-user="<account id>" data-nominate-name="<name>"
//     (Network cards, a shared resource...) - with reason chips instead of a
//     blank page, and clear choices about what the nominee and the wall may see;
//   * runs the nomination form on motm.html (the same chips and choices);
//   * paints the community goal meter ("14 of 20 nominations - hit it and we
//     unlock ..."), the nominee's own "someone thinks you're making a difference"
//     card, and the shout-out wall of approved kind words, wherever the page has
//     [data-motm-meter], [data-motm-praise] or [data-motm-wall].
//
// Everything that matters is checked in the database (who can nominate, no
// nominating yourself, what the nominee may see) - this only draws it. If
// migration 099 hasn't been run, the dialog still works with plain nominations
// and the extras stay hidden.
(function () {
  'use strict';

  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;
  if (window.lacmsNominate) return;

  var REASONS = [
    ['welcoming', 'Made me feel welcome'],
    ['helped_study', 'Helped me with my studies'],
    ['showed_up', 'Always shows up'],
    ['led', 'Led from the front'],
    ['listened', 'Listened when I needed it'],
    ['energy', 'Brought great energy'],
    ['went_extra', 'Went above and beyond'],
    ['mentor', 'A mentor to others']
  ];
  var MAX_REASONS = 3;
  var MAX_WORDS = 1000;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function reasonLabel(key) {
    for (var i = 0; i < REASONS.length; i++) if (REASONS[i][0] === key) return REASONS[i][1];
    return '';
  }
  function firstName(name) {
    var n = String(name || '').replace(/^\s*(dr|prof|professor|mr|mrs|ms|miss)\.?\s+/i, '').trim();
    return n.split(/\s+/)[0] || 'them';
  }
  function inPreview() { return !!(window.lacmsViewAs && window.lacmsViewAs.active && window.lacmsViewAs.active()); }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  // ---- Who is signed in, what they may do, the goal -------------------------------
  var mePromise = null;
  function getMe() {
    if (!mePromise) {
      mePromise = supabaseClient.auth.getSession().then(function (r) {
        var s = r && r.data && r.data.session;
        return s ? s.user.id : null;
      }, function () { return null; });
    }
    return mePromise;
  }

  var accessPromise = null;
  function canNominate() {
    if (!accessPromise) {
      accessPromise = supabaseClient.rpc('get_my_hub_access').then(function (r) {
        if (r.error || !r.data) return true;           // unknown: let the database decide
        var row = null;
        r.data.forEach(function (x) { if (x.feature === 'motm_nominate') row = x; });
        return row ? !!row.allowed : true;
      }, function () { return true; });
    }
    return accessPromise;
  }

  var goalCache = null;
  var goalAt = 0;
  function loadGoal(force) {
    if (!force && goalCache && Date.now() - goalAt < 15000) return goalCache;
    goalAt = Date.now();
    goalCache = supabaseClient.rpc('motm_community_goal').then(function (r) {
      return r.error ? null : r.data;
    }, function () { return null; });
    return goalCache;
  }

  // ---- The goal meter ------------------------------------------------------------
  function meterHtml(g) {
    if (!g || !g.enabled || !(g.target > 0)) return '';
    var count = Math.max(0, g.count || 0);
    var pct = Math.min(100, Math.round((count / g.target) * 100));
    var left = Math.max(0, g.target - count);
    var reward = g.reward ? esc(g.reward) : '';
    var flag = g.unlocked ? 'Goal reached' : left + ' to go';
    var line;
    if (g.unlocked) {
      line = reward ? '<strong>Unlocked:</strong> ' + reward : 'You did it - thank you, everyone.';
    } else if (reward) {
      line = 'Reach ' + g.target + ' and we unlock: <strong>' + reward + '</strong>';
    } else {
      line = 'Every nomination counts towards ' + g.target + ' this month.';
    }
    return '<div class="motm-meter' + (g.unlocked ? ' is-unlocked' : '') + '">' +
      '<div class="motm-meter-top"><span class="motm-meter-count"><strong>' + count + '</strong> of ' + g.target + ' nominations this month</span>' +
      '<span class="motm-meter-flag">' + esc(flag) + '</span></div>' +
      '<div class="motm-meter-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + g.target + '" aria-valuenow="' + Math.min(count, g.target) + '" aria-label="Nominations this month"><span style="width:' + pct + '%"></span></div>' +
      '<p class="motm-meter-reward">' + line + '</p>' +
      '</div>';
  }

  function revealHub(el) {
    var wrap = el.closest ? el.closest('[data-motm-hub]') : null;
    if (wrap) wrap.hidden = false;
  }

  function renderMeters() {
    var hosts = document.querySelectorAll('[data-motm-meter]');
    if (!hosts.length) return;
    Promise.all([getMe(), canNominate(), loadGoal(true)]).then(function (res) {
      var me = res[0], allowed = res[1], g = res[2];
      Array.prototype.forEach.call(hosts, function (host) {
        var html = me && allowed ? meterHtml(g) : '';
        if (!html) { host.hidden = true; host.innerHTML = ''; return; }
        var cta = '';
        if (host.getAttribute('data-cta') !== 'false') {
          cta = g.i_nominated
            ? '<p class="motm-meter-done">You’ve nominated this month - thank you.</p>'
            : '<a class="btn btn-primary motm-meter-btn" href="motm.html#nominate">Nominate someone</a>';
        }
        host.innerHTML = html + cta;
        host.hidden = false;
        revealHub(host);
      });
    });
  }

  // ---- The nominee's own card ----------------------------------------------------
  var DISMISSED_KEY = 'lacms-motm-praise-dismissed';
  function dismissedIds() {
    try { return JSON.parse(lsGet(DISMISSED_KEY) || '[]'); } catch (e) { return []; }
  }

  function renderPraise() {
    var hosts = document.querySelectorAll('[data-motm-praise]');
    if (!hosts.length) return;
    getMe().then(function (me) {
      if (!me) return null;
      return supabaseClient.rpc('motm_my_praise');
    }).then(function (r) {
      if (!r || r.error) return;
      var gone = dismissedIds();
      var items = (r.data || []).filter(function (p) {
        // Not yet acknowledged; and not re-shown just because its words are still waiting for the committee.
        return !p.seen && !(gone.indexOf(p.id) !== -1 && !p.words);
      });
      Array.prototype.forEach.call(hosts, function (host) {
        if (!items.length) { host.hidden = true; host.innerHTML = ''; return; }
        var tags = [];
        items.forEach(function (p) {
          (p.reason_tags || []).forEach(function (t) { if (tags.indexOf(t) === -1) tags.push(t); });
        });
        var quotes = items.filter(function (p) { return p.words; }).map(function (p) {
          return '<blockquote class="motm-praise-quote">“' + esc(p.words) + '”' +
            (p.nominator_name ? '<cite>- ' + esc(p.nominator_name) + '</cite>' : '') + '</blockquote>';
        }).join('');
        var named = items.filter(function (p) { return p.nominator_name && !p.words; }).map(function (p) { return esc(p.nominator_name); });
        var n = items.length;
        host.innerHTML =
          '<div class="motm-praise">' +
          '<span class="motm-praise-star" aria-hidden="true">★</span>' +
          '<div class="motm-praise-body">' +
          '<h3>Someone thinks you’ve been making a difference</h3>' +
          '<p>' + (n === 1 ? 'A member has' : n + ' members have') + ' nominated you for Member of the Month' +
          (named.length ? ' (' + named.join(', ') + ' wanted you to know)' : '') + '. Here’s what stood out:</p>' +
          (tags.length ? '<ul class="motm-praise-tags">' + tags.map(function (t) { return '<li>' + esc(reasonLabel(t)) + '</li>'; }).join('') + '</ul>' : '') +
          quotes +
          (inPreview() ? '' : '<button type="button" class="btn btn-outline motm-praise-ok" data-motm-praise-ok>Thank you</button>') +
          '</div></div>';
        host.hidden = false;
        revealHub(host);
        var ok = host.querySelector('[data-motm-praise-ok]');
        if (ok) ok.addEventListener('click', function () {
          ok.disabled = true;
          lsSet(DISMISSED_KEY, JSON.stringify(gone.concat(items.map(function (p) { return p.id; })).slice(-60)));
          supabaseClient.rpc('motm_praise_seen').then(function () {
            host.hidden = true; host.innerHTML = '';
          }, function () { host.hidden = true; });
        });
      });
    }, function () { /* quiet */ });
  }

  // ---- The shout-out wall --------------------------------------------------------
  function renderWall() {
    var hosts = document.querySelectorAll('[data-motm-wall]');
    if (!hosts.length) return;
    getMe().then(function (me) {
      if (!me) return null;
      return supabaseClient.rpc('motm_wall', { p_limit: 12 });
    }).then(function (r) {
      if (!r || r.error) return;
      var rows = r.data || [];
      Array.prototype.forEach.call(hosts, function (host) {
        if (!rows.length) { host.hidden = true; host.innerHTML = ''; return; }
        var cards = rows.map(function (w, i) {
          var tags = (w.reason_tags || []).map(function (t) { return '<li>' + esc(reasonLabel(t)) + '</li>'; }).join('');
          return '<li class="motm-wall-card"' + (i >= 6 ? ' data-wall-more hidden' : '') + '>' +
            (w.words ? '<blockquote>“' + esc(w.words) + '”</blockquote>' : '') +
            '<span class="motm-wall-about">About ' + esc(w.nominee_first) + '</span>' +
            (tags ? '<ul class="motm-wall-tags">' + tags + '</ul>' : '') +
            '</li>';
        }).join('');
        host.innerHTML =
          '<div class="motm-wall">' +
          '<div class="motm-wall-head"><h3>Kind words</h3><p>What members have said about each other lately.</p></div>' +
          '<ul class="motm-wall-list">' + cards + '</ul>' +
          (rows.length > 6 ? '<button type="button" class="guide-linkbtn motm-wall-more" data-wall-more-btn>Show more</button>' : '') +
          '</div>';
        host.hidden = false;
        revealHub(host);
        var more = host.querySelector('[data-wall-more-btn]');
        if (more) more.addEventListener('click', function () {
          Array.prototype.forEach.call(host.querySelectorAll('[data-wall-more]'), function (li) { li.hidden = false; });
          more.remove();
        });
      });
    }, function () { /* quiet */ });
  }

  // ---- The form fields (shared by the dialog and the motm.html form) --------------
  function chipsHtml() {
    return '<div class="motm-chips" role="group" aria-label="What stood out? Pick up to three">' +
      REASONS.map(function (r) {
        return '<label class="motm-chip"><input type="checkbox" name="motm-reason" value="' + r[0] + '"><span>' + esc(r[1]) + '</span></label>';
      }).join('') + '</div><p class="motm-chips-note" aria-live="polite"></p>';
  }
  function consentsHtml(first, namedPerson) {
    var who = namedPerson ? esc(first) : 'them';
    return '<label class="motm-consent"><input type="checkbox" name="motm-show-name"><span><strong>Let ' + who + ' know it was me</strong>' +
      '<small>Otherwise they just hear that someone thinks they’re making a difference.</small></span></label>' +
      '<label class="motm-consent"><input type="checkbox" name="motm-wall"><span><strong>Share my words on the Kind words wall</strong>' +
      '<small>After the committee has read them. Never with my name.</small></span></label>';
  }
  function wireChips(root) {
    var note = root.querySelector('.motm-chips-note');
    function sync() {
      var boxes = root.querySelectorAll('input[name="motm-reason"]');
      var on = 0;
      Array.prototype.forEach.call(boxes, function (b) { if (b.checked) on++; });
      Array.prototype.forEach.call(boxes, function (b) {
        b.parentNode.classList.toggle('is-on', b.checked);
        var block = !b.checked && on >= MAX_REASONS;
        b.disabled = block;
        b.parentNode.classList.toggle('is-blocked', block);
      });
      if (note) note.textContent = on >= MAX_REASONS ? 'That’s three - untick one to swap.' : '';
    }
    root.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'motm-reason') sync();
    });
    sync();
  }
  function readFields(root) {
    var tags = [];
    Array.prototype.forEach.call(root.querySelectorAll('input[name="motm-reason"]:checked'), function (b) { tags.push(b.value); });
    var showName = root.querySelector('input[name="motm-show-name"]');
    var wall = root.querySelector('input[name="motm-wall"]');
    return { tags: tags, showName: !!(showName && showName.checked), wall: !!(wall && wall.checked) };
  }

  // ---- Sending a nomination -------------------------------------------------------
  function submitNomination(me, p) {
    var row = {
      nominator_id: me,
      nominee_name: p.name,
      reason: p.words,
      reason_tags: p.tags,
      nominee_user_id: p.userId || null,
      show_name_to_nominee: p.showName,
      wall_ok: p.wall
    };
    function plain() {
      return supabaseClient.from('motm_nominations')
        .insert({ nominator_id: me, nominee_name: p.name, reason: p.words || p.tags.map(reasonLabel).join(' · ') })
        .select('id').single();
    }
    return supabaseClient.from('motm_nominations').insert(row).select('id, nominee_user_id').single().then(function (r) {
      // Migration 099 not run yet: send it the old way so nominating never breaks.
      if (r.error && (r.error.code === 'PGRST204' || /reason_tags|nominee_user_id|show_name_to_nominee|wall_ok/.test(r.error.message || ''))) return plain();
      return r;
    });
  }
  function friendlyError(err) {
    var msg = (err && err.message) || '';
    if (err && err.code === '23505') return 'You’ve already used this month’s nomination - it resets on the 1st.';
    if (/row-level security|permission denied/i.test(msg)) return 'Nominating isn’t open to your account. If you think that’s a mistake, email acms@lincolnsu.com.';
    if (/read-only|preview/i.test(msg)) return 'You’re previewing someone’s account, so nothing can be sent.';
    return msg || 'Something went wrong - try again.';
  }
  function sendConfirmation(id) {
    if (!id || !supabaseClient.functions) return;
    supabaseClient.functions.invoke('send-member-email', { body: { type: 'motm_nomination', ref_id: id } }).then(function () {}, function () {});
  }
  function afterNominated(detail) {
    goalCache = null;
    document.dispatchEvent(new CustomEvent('lacms:nominated', { detail: detail || {} }));
    renderMeters();
  }

  // ---- The dialog ------------------------------------------------------------------
  var openDlg = null;

  function openDialog(opts) {
    opts = opts || {};
    if (openDlg) return;
    var userId = opts.userId || null;
    var name = String(opts.name || '').trim();
    var first = firstName(name);
    var prevFocus = document.activeElement;

    var backdrop = document.createElement('div');
    backdrop.className = 'guide-backdrop motm-nom-backdrop';
    var dlg = document.createElement('div');
    dlg.className = 'guide-dialog motm-nom-dialog';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', 'motm-nom-title');
    backdrop.appendChild(dlg);
    document.body.appendChild(backdrop);
    document.body.classList.add('guide-open');
    requestAnimationFrame(function () { backdrop.classList.add('is-in'); });
    openDlg = backdrop;

    function close() {
      window.removeEventListener('keydown', onKey, true);
      backdrop.classList.remove('is-in');
      setTimeout(function () { backdrop.remove(); }, reduceMotion ? 0 : 200);
      if (!document.querySelector('.guide-backdrop:not(.motm-nom-backdrop)')) document.body.classList.remove('guide-open');
      openDlg = null;
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      var f = dlg.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea, a[href]');
      if (!f.length) return;
      var first_ = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first_) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first_.focus(); }
    }
    // On window (capture) so it runs before the page's own Escape handlers, e.g. a resource preview underneath.
    window.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('mousedown', function (e) { if (e.target === backdrop) close(); });

    var closeBtn = '<button type="button" class="guide-close" data-nom-close aria-label="Close">&times;</button>';
    dlg.addEventListener('click', function (e) { if (e.target.closest('[data-nom-close]')) close(); });

    function shell(inner) { dlg.innerHTML = closeBtn + inner; }
    function message(title, text, extra) {
      shell('<span class="guide-eyebrow">Member of the Month</span><h2 class="guide-title" id="motm-nom-title">' + title + '</h2>' +
        '<p class="guide-text">' + text + '</p>' + (extra || '') +
        '<div class="guide-actions"><button type="button" class="btn btn-outline" data-nom-close>Close</button></div>');
      var b = dlg.querySelector('[data-nom-close].btn'); if (b) b.focus();
    }

    shell('<span class="guide-eyebrow">Member of the Month</span><h2 class="guide-title" id="motm-nom-title">One moment…</h2>' +
      '<div class="motm-nom-wait"><span class="auth-gate-spinner" aria-hidden="true"></span></div>');

    Promise.all([getMe(), canNominate(), loadGoal(true)]).then(function (res) {
      var me = res[0], allowed = res[1], goal = res[2];
      if (!me) {
        message('Log in to nominate', 'Nominating is for LACMS members and Network professionals.',
          '<p class="guide-text"><a class="btn btn-primary" href="member-login.html">Log in</a></p>');
        return;
      }
      if (inPreview()) { message('Preview mode', 'You’re looking at someone else’s account, so nominating is switched off.'); return; }
      if (!allowed) {
        message('Nominating isn’t open to your account', 'If you think that’s a mistake, email <a href="mailto:acms@lincolnsu.com" style="color: var(--color-gold-light);">acms@lincolnsu.com</a>.');
        return;
      }
      if (goal && goal.i_nominated) {
        message('You’ve used this month’s nomination', 'Thank you - everyone gets one a month, and yours comes back on the 1st.', meterHtml(goal));
        return;
      }
      showForm(me, goal);
    }, function () { message('Couldn’t open that', 'Try again in a moment.'); });

    function showForm(me, goal) {
      var title = name ? 'Nominate ' + esc(name) : 'Nominate someone';
      shell(
        '<span class="guide-eyebrow">Member of the Month</span>' +
        '<h2 class="guide-title" id="motm-nom-title">' + title + '</h2>' +
        '<p class="guide-text">' + (name ? 'What stood out about ' + esc(first) + '?' : 'Who, and what stood out?') + ' Pick up to three – it takes ten seconds.</p>' +
        '<form class="guide-form motm-nom-form" novalidate>' +
        (name ? '' : '<div class="field"><label for="motm-nom-who">Who are you nominating?</label><input type="text" id="motm-nom-who" maxlength="120" placeholder="Full name" autocomplete="off"></div>') +
        chipsHtml() +
        '<button type="button" class="motm-words-toggle" data-words-toggle aria-expanded="false">+ Add a few words <span class="guide-optional">(optional)</span></button>' +
        '<div class="field motm-words" hidden><label class="visually-hidden" for="motm-nom-words">Add a few words</label>' +
        '<textarea id="motm-nom-words" maxlength="' + MAX_WORDS + '" rows="3" placeholder="What did ' + (name ? esc(first) : 'they') + ' do?"></textarea>' +
        '<span class="guide-count" data-words-count>0 / ' + MAX_WORDS + '</span></div>' +
        '<div class="motm-consents">' + consentsHtml(first, !!name) + '</div>' +
        (meterHtml(goal) ? '<div class="motm-nom-meter">' + meterHtml(goal) + '</div>' : '') +
        '<p class="guide-error" data-nom-error role="alert" hidden></p>' +
        '<div class="guide-actions"><button type="submit" class="btn btn-primary">' + (name ? 'Nominate ' + esc(first) : 'Nominate') + '</button>' +
        '<button type="button" class="btn btn-outline" data-nom-close>Cancel</button></div>' +
        '<p class="guide-fine">One nomination a month. The committee reads every one.</p>' +
        '</form>');
      var form = dlg.querySelector('form');
      wireChips(form);
      var toggle = form.querySelector('[data-words-toggle]');
      var wordsWrap = form.querySelector('.motm-words');
      var words = form.querySelector('#motm-nom-words');
      toggle.addEventListener('click', function () {
        var open = wordsWrap.hidden;
        wordsWrap.hidden = !open;
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) words.focus();
      });
      words.addEventListener('input', function () { form.querySelector('[data-words-count]').textContent = words.value.length + ' / ' + MAX_WORDS; });
      var firstChip = form.querySelector('input[name="motm-reason"]');
      var who = form.querySelector('#motm-nom-who');
      (who || firstChip).focus();

      var errEl = form.querySelector('[data-nom-error]');
      function fail(msg) { errEl.textContent = msg; errEl.hidden = false; }
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        errEl.hidden = true;
        var f = readFields(form);
        var nm = name || (who ? who.value.trim() : '');
        var txt = words.value.trim();
        if (!nm) { fail('Say who you are nominating.'); who && who.focus(); return; }
        if (!f.tags.length && !txt) { fail('Pick a reason or write a few words.'); return; }
        var btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        submitNomination(me, { name: nm, userId: userId, words: txt, tags: f.tags, showName: f.showName, wall: f.wall }).then(function (r) {
          if (r.error) { btn.disabled = false; fail(friendlyError(r.error)); return; }
          sendConfirmation(r.data && r.data.id);
          var linked = !!(userId || (r.data && r.data.nominee_user_id));
          afterNominated({ id: r.data && r.data.id });
          loadGoal(true).then(function (g2) { showDone(nm, linked, g2); });
        }, function (err) { btn.disabled = false; fail(friendlyError(err)); });
      });
    }

    function showDone(nm, linked, goal) {
      var f = firstName(nm);
      var unlockedNow = goal && goal.enabled && goal.unlocked && goal.count === goal.target;
      shell(
        '<div class="motm-nom-done">' +
        '<span class="motm-nom-tick" aria-hidden="true">★</span>' +
        '<h2 class="guide-title" id="motm-nom-title">' + esc(f) + ' has been nominated</h2>' +
        '<p class="guide-text">' + (linked
          ? 'They’ll be told that someone thinks they’re making a difference. The committee reads every nomination when choosing the next Member of the Month.'
          : 'The committee reads every nomination when choosing the next Member of the Month. (We couldn’t match that name to an account, so they haven’t been notified.)') + '</p>' +
        (unlockedNow ? '<p class="motm-nom-unlock">Your nomination just hit the goal' + (goal.reward ? ' – ' + esc(goal.reward) + ' is unlocked!' : '!') + '</p>' : '') +
        (meterHtml(goal) ? '<div class="motm-nom-meter">' + meterHtml(goal) + '</div>' : '') +
        '<div class="guide-actions" style="justify-content:center;"><button type="button" class="btn btn-primary" data-nom-close>Done</button></div>' +
        '</div>');
      var b = dlg.querySelector('[data-nom-close].btn'); if (b) b.focus();
    }
  }

  // ---- The nomination form on motm.html -------------------------------------------
  function mountPageForm() {
    var form = document.getElementById('nominate-form');
    if (!form || form.getAttribute('data-nominate-mounted')) return;
    var chips = form.querySelector('[data-nominate-chips]');
    var consents = form.querySelector('[data-nominate-consents]');
    if (!chips || !consents) return;                 // old markup: leave the form to members.js
    form.setAttribute('data-nominate-mounted', '1');
    chips.innerHTML = chipsHtml();
    consents.innerHTML = consentsHtml('them', false);
    wireChips(form);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var statusEl = document.getElementById('nominate-status');
      function fail(msg) { if (statusEl) { statusEl.textContent = msg; statusEl.style.display = 'block'; } }
      if (statusEl) statusEl.style.display = 'none';
      var f = readFields(form);
      var nm = document.getElementById('nominate-name').value.trim();
      var txt = document.getElementById('nominate-reason').value.trim();
      if (!nm) { fail('Say who you are nominating.'); return; }
      if (!f.tags.length && !txt) { fail('Pick a reason or write a few words.'); return; }
      if (inPreview()) { fail('You’re previewing someone’s account, so nothing can be sent.'); return; }
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      getMe().then(function (me) {
        if (!me) { btn.disabled = false; fail('Log in to nominate.'); return; }
        return submitNomination(me, { name: nm, userId: null, words: txt, tags: f.tags, showName: f.showName, wall: f.wall }).then(function (r) {
          btn.disabled = false;
          if (r.error) { fail(friendlyError(r.error)); return; }
          sendConfirmation(r.data && r.data.id);
          var wrap = document.getElementById('nominate-form-wrap');
          var conf = document.getElementById('nominate-confirmation');
          if (wrap) wrap.style.display = 'none';
          if (conf) {
            var linked = !!(r.data && r.data.nominee_user_id);
            var msg = conf.querySelector('[data-nominate-linked]');
            if (msg) msg.textContent = linked
              ? firstName(nm) + ' will be told that someone thinks they’re making a difference.'
              : 'We couldn’t match that name to an account, so they haven’t been notified - the committee will still see it.';
            conf.style.display = 'block';
            if (conf.scrollIntoView) conf.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
          }
          afterNominated({ id: r.data && r.data.id });
        });
      }).then(null, function (err) { btn.disabled = false; fail(friendlyError(err)); });
    });
  }

  // ---- Wiring ----------------------------------------------------------------------
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-nominate-user]') : null;
    if (!t) return;
    e.preventDefault();
    openDialog({ userId: t.getAttribute('data-nominate-user'), name: t.getAttribute('data-nominate-name') });
  });
  document.addEventListener('lacms:nominate-open', function (e) { openDialog(e.detail || {}); });

  window.lacmsNominate = {
    open: openDialog,
    allowed: function () {
      return Promise.all([getMe(), canNominate()]).then(function (r) { return !!r[0] && r[1] && !inPreview(); });
    },
    goal: function () { return loadGoal(true); },
    refresh: function () { renderMeters(); renderPraise(); renderWall(); },
    reasons: REASONS
  };

  function start() {
    mountPageForm();
    renderMeters();
    renderPraise();
    renderWall();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
