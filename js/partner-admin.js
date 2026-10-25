// Dashboard -> Partners (migration 101): private spaces for collaborating partners.
//
// A space is a secret link (partner.html#...) that shows the feedback and numbers for the events
// you choose, live, with no account needed. Here the committee can create one, choose what it
// shows (comments: none, only those people said we may quote, or all, always without names; event
// ideas; how people heard; breakdowns; registrations), type in headline numbers (attendance, money
// raised...), set an expiry, copy / email the link, preview it exactly as the partner sees it,
// pause it, replace the link (the old one stops working at once) or delete it.
// All of it is enforced in the database; the partner page can only ever receive what is allowed.
(function () {
  'use strict';

  var root = document.getElementById('partner-admin-root');
  if (!root) return;
  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;

  var state = { loaded: false, loading: false, error: '', spaces: [], events: [], editing: null, form: null, flash: '', share: null };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function ago(iso) {
    if (!iso) return 'never';
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 90) return 'just now';
    var m = Math.round(s / 60), h = Math.round(s / 3600), d = Math.round(s / 86400);
    if (s < 3600) return m + ' minutes ago';
    if (s < 86400) return h + (h === 1 ? ' hour ago' : ' hours ago');
    return d + (d === 1 ? ' day ago' : ' days ago');
  }
  function niceDate(key) {
    if (!key) return '';
    var d = new Date(key + 'T00:00:00');
    return isNaN(d) ? key : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function todayKey() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function linkFor(sp, preview) {
    return new URL('partner.html#' + (preview ? 't=' + sp.token + '&preview=1' : sp.token), window.location.href.split('#')[0]).href;
  }
  function statusOf(sp) {
    if (!sp.is_active) return { k: 'paused', label: 'Paused' };
    if (sp.expires_on && sp.expires_on < todayKey()) return { k: 'expired', label: 'Expired' };
    return { k: 'live', label: 'Live' };
  }
  function say(msg) { state.flash = msg; var el = root.querySelector('[data-pa-flash]'); if (el) el.textContent = msg; }

  // ---- Loading ---------------------------------------------------------------------
  function load() {
    if (state.loading) return;
    state.loading = true;
    root.innerHTML = '<p class="sh-muted">Loading…</p>';
    Promise.all([
      supabaseClient.rpc('partner_spaces_list'),
      supabaseClient.from('site_events').select('slug, name, starts_on, date_text').order('starts_on', { ascending: false, nullsFirst: false })
    ]).then(function (res) {
      state.loading = false; state.loaded = true;
      if (res[0].error) {
        state.error = /Could not find the function|schema cache|does not exist/i.test(res[0].error.message || '')
          ? 'Partner spaces need migration 101 to be run in Supabase (see README-members-setup.md, section 156).' : res[0].error.message;
        render(); return;
      }
      state.error = '';
      state.spaces = res[0].data || [];
      state.events = (res[1].data || []).map(function (e) { return { slug: e.slug, name: e.name, date: e.starts_on || '', text: e.date_text || '' }; });
      var el = document.getElementById('dash-count-partners');
      if (el) el.textContent = state.spaces.length ? plural(state.spaces.length, 'space', 'spaces') : 'None yet';
      render();
    }, function () { state.loading = false; state.loaded = true; state.error = 'Could not load partner spaces.'; render(); });
  }

  // ---- The list ------------------------------------------------------------------------
  function eventName(slug) { var e = state.events.filter(function (x) { return x.slug === slug; })[0]; return e ? e.name : slug; }

  function listHtml() {
    var intro = '<div class="pa-intro"><div><h3>Share a space with a partner</h3><p>For events you run with another society, charity, trust or sponsor. They get a private link showing live feedback and numbers for just those events. No account, never any names or emails, and you can pause or replace the link whenever you like.</p></div>' +
      '<button type="button" class="btn btn-primary" data-pa-new>New partner space</button></div>';
    if (!state.spaces.length) {
      return intro + '<div class="pa-empty"><h3>No partner spaces yet</h3><p>Create one, choose the events you ran together, and send the link. It takes a minute.</p></div>';
    }
    return intro + '<ul class="pa-list">' + state.spaces.map(function (sp) {
      var st = statusOf(sp);
      return '<li class="pa-card pa-card--' + st.k + '">' +
        '<div class="pa-card-top"><div><h3>' + esc(sp.name) + '</h3><span class="pa-partner">' + (sp.partner_name ? 'with ' + esc(sp.partner_name) : 'No partner name') + '</span></div>' +
        '<span class="pa-pill pa-pill--' + st.k + '">' + st.label + '</span></div>' +
        '<div class="pa-events">' + sp.event_slugs.map(function (s) { return '<span class="pa-chip">' + esc(eventName(s)) + '</span>'; }).join('') + '</div>' +
        '<p class="pa-meta">' + plural(Number(sp.responses), 'feedback reply', 'feedback replies') + ' · viewed ' + plural(sp.view_count, 'time', 'times') + (sp.view_count ? ' (last ' + esc(ago(sp.last_viewed_at)) + ')' : '') +
        (sp.expires_on ? ' · ' + (st.k === 'expired' ? 'expired ' : 'open until ') + esc(niceDate(sp.expires_on)) : '') + '</p>' +
        '<p class="pa-shows">Shows: ' + [sp.show_registrations ? 'registrations' : '', 'ratings', sp.show_heard ? 'how people heard' : '', sp.show_audience ? 'audience' : '', sp.show_ideas ? 'event ideas' : '',
          sp.show_comments === 'all' ? 'all comments' : sp.show_comments === 'quotable' ? 'quotable comments' : 'no comments', sp.custom_metrics.length ? plural(sp.custom_metrics.length, 'headline number', 'headline numbers') : ''].filter(Boolean).join(', ') + '</p>' +
        '<div class="pa-actions">' +
        '<button type="button" class="btn btn-primary" data-pa-share="' + esc(sp.id) + '">Share link</button>' +
        '<a class="btn btn-outline" href="' + esc(linkFor(sp, true)) + '" target="_blank" rel="noopener">Preview</a>' +
        '<button type="button" class="btn btn-outline" data-pa-edit="' + esc(sp.id) + '">Edit</button>' +
        '<button type="button" class="btn btn-outline" data-pa-toggle="' + esc(sp.id) + '">' + (sp.is_active ? 'Pause' : 'Resume') + '</button>' +
        '</div><div class="pa-more"><button type="button" class="guide-linkbtn" data-pa-regen="' + esc(sp.id) + '">New link</button><button type="button" class="guide-linkbtn" data-pa-delete="' + esc(sp.id) + '">Delete</button></div></li>';
    }).join('') + '</ul>';
  }

  // ---- The form ----------------------------------------------------------------------------
  function blankForm() {
    return { id: null, name: '', partner_name: '', message: '', event_slugs: [], show_comments: 'quotable', show_ideas: false, show_heard: true, show_audience: true, show_registrations: true, custom_metrics: [{ label: '', value: '', note: '' }], expires_on: '' };
  }
  function formFrom(sp) {
    return { id: sp.id, name: sp.name, partner_name: sp.partner_name, message: sp.message, event_slugs: sp.event_slugs.slice(), show_comments: sp.show_comments, show_ideas: sp.show_ideas,
      show_heard: sp.show_heard, show_audience: sp.show_audience, show_registrations: sp.show_registrations,
      custom_metrics: (sp.custom_metrics || []).map(function (m) { return { label: m.label, value: m.value, note: m.note || '' }; }).concat((sp.custom_metrics || []).length ? [] : [{ label: '', value: '', note: '' }]), expires_on: sp.expires_on || '' };
  }

  function formHtml() {
    var f = state.form;
    var evs = state.events.map(function (e) {
      return '<label class="pa-event"><input type="checkbox" data-pa-event value="' + esc(e.slug) + '"' + (f.event_slugs.indexOf(e.slug) !== -1 ? ' checked' : '') + '><span><strong>' + esc(e.name) + '</strong><small>' + esc(e.text || niceDate(e.date)) + '</small></span></label>';
    }).join('');
    var metrics = f.custom_metrics.map(function (m, i) {
      return '<div class="pa-metric"><input type="text" data-pa-m="label" data-i="' + i + '" maxlength="40" placeholder="Label, e.g. Attendance" value="' + esc(m.label) + '" aria-label="Number label">' +
        '<input type="text" data-pa-m="value" data-i="' + i + '" maxlength="40" placeholder="Value, e.g. 84" value="' + esc(m.value) + '" aria-label="Number value">' +
        '<input type="text" data-pa-m="note" data-i="' + i + '" maxlength="120" placeholder="Small note (optional)" value="' + esc(m.note) + '" aria-label="Small note">' +
        '<button type="button" class="pa-x" data-pa-m-del="' + i + '" aria-label="Remove this number">&times;</button></div>';
    }).join('');
    return '<form class="pa-form" id="pa-form" novalidate>' +
      '<div class="pa-form-head"><h3>' + (f.id ? 'Edit partner space' : 'New partner space') + '</h3><button type="button" class="guide-linkbtn" data-pa-cancel>Cancel</button></div>' +
      '<div class="pa-grid2"><div class="field"><label for="pa-name">Name of the space</label><input type="text" id="pa-name" maxlength="120" placeholder="e.g. Winter Charity Fundraiser with Lincoln Dental Society" value="' + esc(f.name) + '"></div>' +
      '<div class="field"><label for="pa-partner">Partner <span class="guide-optional">(shown on the page)</span></label><input type="text" id="pa-partner" maxlength="120" placeholder="e.g. Lincoln Dental Society" value="' + esc(f.partner_name) + '"></div></div>' +
      '<div class="field"><label for="pa-message">Welcome message <span class="guide-optional">(optional)</span></label><textarea id="pa-message" rows="4" maxlength="1200" placeholder="A few lines to your partner: thank them, say what they’ll find here.">' + esc(f.message) + '</textarea>' +
      '<button type="button" class="guide-linkbtn" data-pa-starter>Use a starter message</button></div>' +

      '<fieldset class="pa-fieldset"><legend>Events it covers</legend>' +
      (state.events.length ? '<div class="pa-events-pick">' + evs + '</div>' : '<p class="sh-muted">No events found.</p>') + '</fieldset>' +

      '<fieldset class="pa-fieldset"><legend>What partners see</legend>' +
      '<label class="pa-check"><input type="checkbox" data-pa-flag="show_registrations"' + (f.show_registrations ? ' checked' : '') + '><span><strong>How many LACMS members registered</strong><small>And the share of them who replied. Members only; we don’t hold your own registrations.</small></span></label>' +
      '<label class="pa-check"><input type="checkbox" data-pa-flag="show_heard"' + (f.show_heard ? ' checked' : '') + '><span><strong>How people heard about it</strong><small>Instagram, a friend, a poster… useful for their own promotion.</small></span></label>' +
      '<label class="pa-check"><input type="checkbox" data-pa-flag="show_audience"' + (f.show_audience ? ' checked' : '') + '><span><strong>Who replied</strong><small>Members, guests and courses. Only once an event has 5 replies; small groups are folded into “Other”.</small></span></label>' +
      '<label class="pa-check"><input type="checkbox" data-pa-flag="show_ideas"' + (f.show_ideas ? ' checked' : '') + '><span><strong>Event ideas people suggested</strong><small>Off by default: these can be about LACMS rather than the partnership.</small></span></label>' +
      '<div class="pa-radios" role="radiogroup" aria-label="Comments">' +
      [['quotable', 'Comments people said we may quote', 'Recommended. Without names.'], ['all', 'All comments', 'Without names. You can hide single comments in Dashboard → Feedback.'], ['none', 'No comments', 'Numbers only.']].map(function (o) {
        return '<label class="pa-check"><input type="radio" name="pa-comments" data-pa-comments value="' + o[0] + '"' + (f.show_comments === o[0] ? ' checked' : '') + '><span><strong>' + o[1] + '</strong><small>' + o[2] + '</small></span></label>';
      }).join('') + '</div></fieldset>' +

      '<fieldset class="pa-fieldset"><legend>Headline numbers you type in <span class="guide-optional">(optional)</span></legend>' +
      '<p class="sh-muted">Things only you know: attendance on the night, money raised, tickets sold. They appear as tiles at the top.</p>' +
      '<div class="pa-metrics">' + metrics + '</div>' +
      (f.custom_metrics.length < 8 ? '<button type="button" class="guide-linkbtn" data-pa-m-add>+ Add another number</button>' : '') + '</fieldset>' +

      '<div class="pa-grid2"><div class="field"><label for="pa-expires">Link works until <span class="guide-optional">(optional)</span></label><input type="date" id="pa-expires" min="' + todayKey() + '" value="' + esc(f.expires_on) + '"><span class="hint">Leave empty for no end date. You can always pause it.</span></div></div>' +
      '<p class="guide-error" data-pa-error role="alert" hidden></p>' +
      '<div class="pa-form-actions"><button type="submit" class="btn btn-primary">' + (f.id ? 'Save changes' : 'Create space') + '</button><button type="button" class="btn btn-outline" data-pa-cancel>Cancel</button></div>' +
      '</form>';
  }

  function readForm() {
    var f = state.form;
    f.name = document.getElementById('pa-name').value;
    f.partner_name = document.getElementById('pa-partner').value;
    f.message = document.getElementById('pa-message').value;
    f.expires_on = document.getElementById('pa-expires').value;
  }

  // ---- Sharing -------------------------------------------------------------------------------
  function shareHtml() {
    var sp = state.share;
    if (!sp) return '';
    var link = linkFor(sp, false);
    var subject = 'Your private partner space: ' + sp.name;
    var body = 'Hi' + (sp.partner_name ? ' ' + sp.partner_name + ' team' : '') + ',\n\nThank you for working with us. Here is your private space for ' + sp.name + ', showing live feedback and numbers from the event:\n\n' + link +
      '\n\nNo account is needed. The page never shows anyone\'s name or email, and you can print it or download a summary. It also has a feedback link you can share with your own members.\n\nAny questions, just email acms@lincolnsu.com.\n\nThe LACMS Committee';
    return '<div class="pa-modal" data-pa-close><div class="pa-modal-box" role="dialog" aria-modal="true" aria-label="Share this space">' +
      '<button type="button" class="guide-close" data-pa-close aria-label="Close">&times;</button>' +
      '<h3>Share “' + esc(sp.name) + '”</h3>' +
      '<p>Anyone with this link can view the space. Send it only to your partner. If it gets passed on, use <strong>New link</strong> and the old one stops working at once.</p>' +
      '<input type="text" class="pa-link-input" readonly value="' + esc(link) + '" onfocus="this.select()" aria-label="Partner space link">' +
      '<div class="pa-actions"><button type="button" class="btn btn-primary" data-pa-copy="' + esc(link) + '">Copy link</button>' +
      '<a class="btn btn-outline" href="mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body) + '">Email it</a>' +
      '<a class="btn btn-outline" href="' + esc(linkFor(sp, true)) + '" target="_blank" rel="noopener">Preview</a></div>' +
      '<p class="pa-flash" data-pa-flash role="status"></p></div></div>';
  }

  // ---- Drawing ---------------------------------------------------------------------------------
  function render() {
    if (!state.loaded) return;
    if (state.error) { root.innerHTML = '<div class="form-note"><span>' + esc(state.error) + '</span></div>'; return; }
    root.innerHTML = (state.flash && !state.share ? '<p class="pa-flash" data-pa-flash role="status">' + esc(state.flash) + '</p>' : '') +
      (state.form ? formHtml() : listHtml()) + shareHtml();
  }

  function open(form) { state.form = form; state.flash = ''; render(); var n = document.getElementById('pa-name'); if (n) n.focus(); }

  // ---- Events ---------------------------------------------------------------------------------------
  root.addEventListener('input', function (e) {
    var t = e.target;
    if (t.hasAttribute('data-pa-m')) { state.form.custom_metrics[+t.getAttribute('data-i')][t.getAttribute('data-pa-m')] = t.value; }
  });
  root.addEventListener('change', function (e) {
    var t = e.target;
    if (!state.form) return;
    if (t.hasAttribute('data-pa-event')) {
      var list = state.form.event_slugs, i = list.indexOf(t.value);
      if (t.checked && i === -1) list.push(t.value); else if (!t.checked && i !== -1) list.splice(i, 1);
    } else if (t.hasAttribute('data-pa-flag')) { state.form[t.getAttribute('data-pa-flag')] = t.checked; }
    else if (t.hasAttribute('data-pa-comments')) { state.form.show_comments = t.value; }
  });

  function byId(id) { return state.spaces.filter(function (s) { return s.id === id; })[0]; }
  function rpc(name, args, ok) {
    return supabaseClient.rpc(name, args).then(function (res) {
      if (res.error) { window.alert('That didn’t work: ' + res.error.message); return; }
      if (ok) ok(res.data);
    });
  }

  root.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('button, a') : null;
    var closer = e.target.closest ? e.target.closest('[data-pa-close]') : null;
    if (closer && (closer === e.target || closer.tagName === 'BUTTON')) { state.share = null; render(); return; }
    if (!t) return;
    var v;
    if (t.hasAttribute('data-pa-new')) { open(blankForm()); return; }
    if (t.hasAttribute('data-pa-cancel')) { state.form = null; render(); return; }
    if ((v = t.getAttribute('data-pa-edit')) !== null) { open(formFrom(byId(v))); return; }
    if ((v = t.getAttribute('data-pa-share')) !== null) { state.share = byId(v); render(); return; }
    if ((v = t.getAttribute('data-pa-copy')) !== null) {
      (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { say('Link copied.'); }, function () { say('Select the link above and copy it.'); });
      return;
    }
    if ((v = t.getAttribute('data-pa-toggle')) !== null) {
      var sp = byId(v);
      rpc('partner_space_set_active', { p_id: v, p_active: !sp.is_active }, function () { state.flash = sp.is_active ? 'Paused. The link shows a “paused” message until you resume it.' : 'Resumed. The link works again.'; state.loaded = false; state.loading = false; load(); });
      return;
    }
    if ((v = t.getAttribute('data-pa-regen')) !== null) {
      if (!window.confirm('Make a new link? The current link will stop working straight away, so you will need to send the new one.')) return;
      rpc('partner_space_regenerate', { p_id: v }, function () { state.flash = 'New link made. The old one no longer works.'; state.loaded = false; state.loading = false; load(); });
      return;
    }
    if ((v = t.getAttribute('data-pa-delete')) !== null) {
      if (!window.confirm('Delete this partner space? Its link stops working for good. The feedback itself is not deleted.')) return;
      rpc('partner_space_delete', { p_id: v }, function () { state.flash = 'Deleted.'; state.loaded = false; state.loading = false; load(); });
      return;
    }
    if (t.hasAttribute('data-pa-m-add')) { readForm(); state.form.custom_metrics.push({ label: '', value: '', note: '' }); render(); return; }
    if ((v = t.getAttribute('data-pa-m-del')) !== null) { readForm(); state.form.custom_metrics.splice(+v, 1); if (!state.form.custom_metrics.length) state.form.custom_metrics.push({ label: '', value: '', note: '' }); render(); return; }
    if (t.hasAttribute('data-pa-starter')) {
      var ta = document.getElementById('pa-message');
      var partner = (document.getElementById('pa-partner').value || '').trim();
      ta.value = 'Thank you for partnering with us' + (partner ? ', ' + partner : '') + '! This is your private space for the event: live feedback from the people who came, plus the numbers. It updates whenever someone replies, and you can print it or download a summary.\n\nThere is also a feedback link at the bottom of the page you can share with your own members.';
      return;
    }
  });
  root.addEventListener('submit', function (e) {
    if (e.target.id !== 'pa-form') return;
    e.preventDefault();
    readForm();
    var f = state.form, err = root.querySelector('[data-pa-error]');
    function fail(msg) { err.textContent = msg; err.hidden = false; err.scrollIntoView({ block: 'center' }); }
    if (!f.name.trim()) { fail('Give the space a name.'); return; }
    if (!f.event_slugs.length) { fail('Choose at least one event.'); return; }
    var btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
    var payload = {
      name: f.name.trim(), partner_name: f.partner_name.trim(), message: f.message.trim(), event_slugs: f.event_slugs, show_comments: f.show_comments,
      show_ideas: f.show_ideas, show_heard: f.show_heard, show_audience: f.show_audience, show_registrations: f.show_registrations,
      custom_metrics: f.custom_metrics.filter(function (m) { return m.label.trim() || m.value.trim(); }), expires_on: f.expires_on || null
    };
    supabaseClient.rpc('partner_space_save', { p_id: f.id, p_data: payload }).then(function (res) {
      btn.disabled = false;
      if (res.error) { fail(res.error.message); return; }
      var wasNew = !f.id, newId = res.data;
      state.form = null; state.loaded = false; state.loading = false;
      state.flash = wasNew ? 'Created. Share the link below.' : 'Saved.';
      supabaseClient.rpc('partner_spaces_list').then(function (r2) {
        state.spaces = r2.data || state.spaces; state.loaded = true;
        if (wasNew) state.share = byId(newId) || null;
        var el = document.getElementById('dash-count-partners'); if (el) el.textContent = plural(state.spaces.length, 'space', 'spaces');
        render();
      });
    });
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && state.share) { state.share = null; render(); } });

  // ---- Start: load when the tile is opened ------------------------------------------------------------
  var card = document.querySelector('[data-dash-section="partners"]');
  if (card) {
    card.addEventListener('click', function () { if (!state.loaded && !state.loading) load(); });
    if (card.style.display !== 'none') { setTimeout(function () { if (!state.loaded && !state.loading) load(); }, 1800); }
  }
  if (window.location.hash === '#partners') setTimeout(function () { if (!state.loaded && !state.loading) load(); }, 800);
})();
