// Dashboard -> Feedback -> Forms (migration 104): build and change the feedback forms.
//
//   * a list of the default form and every event, with its status;
//   * an editor: sections, questions (rating, pick one, pick several, yes/no, short and long answers,
//     headings), polls, "show only if" rules, a "show on the partner page" switch per question,
//     drag or tap to reorder, duplicate, delete with undo;
//   * ready-made whole forms, sections and questions, and copying another event's form;
//   * settings: page text, who can answer, closing date, privacy and extras;
//   * a draft that nobody sees until it is published, a live preview, and a history to go back to.
// The database checks everything again when a form is saved; the checks here are to help sooner.
(function () {
  'use strict';

  var FB = window.LACMS_FB, TPL = window.LACMS_FB_TEMPLATES;
  if (!FB || !TPL) return;
  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;

  var S = {
    view: 'list', list: null, listError: '', search: '',
    slug: null, name: '', date: '', info: null, def: null, saved: '', hasDraft: false,
    tab: 'questions', open: null, bulk: null, modal: null, hist: null, busy: '', status: '', statusKind: '',
    undo: null, backup: null, drag: null, device: 'phone', added: 0
  };
  var root = null, toastTimer = null, backupTimer = null, focusSel = null;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function when(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function slugKey(slug) { return slug == null ? '' : slug; }
  function previewSlug() { return S.slug == null ? 'general' : S.slug; }
  function find(id) { return FB.flat(S.def).filter(function (x) { return x.q.id === id; })[0] || null; }
  function sec(id) { return S.def.sections.filter(function (s) { return s.id === id; })[0] || null; }
  function countQuestions(def) { return FB.flat(def).filter(function (x) { return x.q.type !== 'info'; }).length; }
  function dirty() { return !!S.def && JSON.stringify(S.def) !== S.saved; }
  function isMigrationError(msg) { return /Could not find the function|schema cache|does not exist/i.test(msg || ''); }
  function nice(msg) {
    msg = String(msg || '');
    if (isMigrationError(msg)) return 'The form builder needs migration 104 to be run in Supabase (see README-members-setup.md, section 160).';
    if (/Not authorized/i.test(msg)) return 'You don’t have permission to edit the feedback forms.';
    return msg;
  }

  // ---- Start / list ------------------------------------------------------------------
  function mount(el) {
    root = el;
    if (!root.__fbbBound) { bind(root); root.__fbbBound = true; }
    if (S.view === 'list' && !S.list) loadList(); else render();
  }

  function loadList() {
    S.list = null; S.listError = '';
    root.innerHTML = '<p class="sh-muted">Loading the forms…</p>';
    supabaseClient.rpc('feedback_forms_overview').then(function (res) {
      if (res.error) { S.listError = nice(res.error.message); S.list = []; }
      else S.list = res.data || [];
      render();
    }, function () { S.listError = 'Could not load the forms.'; S.list = []; render(); });
  }

  function openForm(slug, name, date) {
    S.busy = 'open'; render();
    supabaseClient.rpc('feedback_form_get', { p_slug: slug }).then(function (res) {
      S.busy = '';
      if (res.error) { S.listError = nice(res.error.message); S.view = 'list'; render(); return; }
      var info = res.data || {};
      var def = FB.clone(info.draft || info.live || FB.standard());
      delete def.archived;
      def.settings = Object.assign({}, FB.DEFAULT_SETTINGS, def.settings || {});
      S.slug = slug; S.name = name; S.date = date || ''; S.info = info; S.def = def;
      S.saved = JSON.stringify(def); S.hasDraft = !!info.draft;
      S.view = 'edit'; S.tab = 'questions'; S.open = null; S.modal = null; S.hist = null; S.bulk = null; S.status = ''; S.statusKind = '';
      S.backup = readBackup(slug, S.saved);
      render();
      window.scrollTo(0, Math.max(0, (root.getBoundingClientRect().top + window.pageYOffset) - 90));
    }, function () { S.busy = ''; S.listError = 'Could not open that form.'; S.view = 'list'; render(); });
  }

  // ---- A copy of unsaved work, kept in this browser -----------------------------------------
  function bkKey(slug) { return 'lacms-fbb-' + slugKey(slug); }
  function readBackup(slug, savedJson) {
    try {
      var raw = window.localStorage.getItem(bkKey(slug));
      if (!raw) return null;
      var b = JSON.parse(raw);
      if (!b || !b.def || JSON.stringify(b.def) === savedJson) { window.localStorage.removeItem(bkKey(slug)); return null; }
      return b;
    } catch (e) { return null; }
  }
  function writeBackup() {
    clearTimeout(backupTimer);
    backupTimer = setTimeout(function () {
      try {
        if (dirty()) window.localStorage.setItem(bkKey(S.slug), JSON.stringify({ at: new Date().toISOString(), def: S.def }));
        else window.localStorage.removeItem(bkKey(S.slug));
      } catch (e) { /* storage unavailable: fine */ }
    }, 600);
  }
  function clearBackup() { try { window.localStorage.removeItem(bkKey(S.slug)); } catch (e) { /* ignore */ } S.backup = null; }

  // ---- Drawing -------------------------------------------------------------------------------
  function render() {
    if (!root) return;
    var y = window.pageYOffset;
    var html;
    if (S.busy === 'open') html = '<p class="sh-muted">Opening the form…</p>';
    else if (S.view === 'list' && S.list === null) html = '<p class="sh-muted">Loading the forms\u2026</p>';
    else if (S.view === 'list') html = listHtml();
    else html = editorHtml();
    root.innerHTML = html + modalHtml() + toastHtml();
    if (S.view === 'edit' && S.busy !== 'open') window.scrollTo(0, y);
    if (focusSel) {
      var f = root.querySelector(focusSel);
      focusSel = null;
      if (f) { try { f.focus({ preventScroll: false }); if (f.select && f.tagName === 'INPUT') f.select(); } catch (e) { /* ignore */ } }
    }
  }
  function refreshBar() {
    var bar = root && root.querySelector('[data-fbb-bar]');
    if (bar) bar.innerHTML = barInner();
    var dock = root && root.querySelector('[data-fbb-dock]');
    if (dock) dock.innerHTML = dockInner();
    var st = root && root.querySelector('[data-fbb-status]');
    if (st) st.outerHTML = statusHtml();
  }

  // The list of forms
  function listHtml() {
    if (S.listError && !(S.list && S.list.length)) return '<div class="form-note"><span>' + esc(S.listError) + '</span></div>';
    var q = S.search.trim().toLowerCase();
    var rows = (S.list || []).filter(function (r) { return r.slug === null || !q || String(r.name).toLowerCase().indexOf(q) !== -1; });
    var def = rows.filter(function (r) { return r.slug === null; })[0];
    var events = rows.filter(function (r) { return r.slug !== null; });
    var canAccess = (function () { var c = document.querySelector('[data-dash-section="access"]'); return !!c && c.style.display !== 'none'; })();
    return (S.listError ? '<div class="form-note"><span>' + esc(S.listError) + '</span></div>' : '') +
      '<div class="fbb-hero"><div><h3>Customise your feedback forms</h3>' +
      '<p>Every event uses the <strong>default form</strong> unless you give it one of its own. Add sections, questions and polls, start from a ready-made template, preview it on a phone, then publish when you’re happy. Nothing changes for the public until you publish.</p></div>' +
      (canAccess ? '<div class="fbb-hero-side"><span>Who can edit forms?</span><button type="button" class="btn btn-outline" data-a="access">Choose in Hub Access</button><small>Find “Dashboard: Edit feedback forms” and tick the roles or people.</small></div>' : '') + '</div>' +
      (def ? '<h4 class="fbb-h4">Default form</h4><div class="fbb-rows">' + rowHtml(def) + '</div>' : '') +
      '<div class="fbb-list-head"><h4 class="fbb-h4">Events</h4><label class="fbb-search"><span class="visually-hidden">Search events</span><input type="search" class="fbb-input" placeholder="Search events" value="' + esc(S.search) + '" data-fbb-search></label></div>' +
      (events.length ? '<div class="fbb-rows">' + events.map(rowHtml).join('') + '</div>' : '<p class="sh-muted">' + (q ? 'No events match.' : 'No events yet.') + '</p>');
  }
  function rowHtml(r) {
    var chips = [];
    if (r.has_draft) chips.push('<span class="fbb-chip is-draft">Draft in progress</span>');
    if (r.slug === null) chips.push(r.has_form ? '<span class="fbb-chip is-live">Custom · v' + r.version + '</span>' : '<span class="fbb-chip">Original form</span>');
    else chips.push(r.has_form ? '<span class="fbb-chip is-live">Own form · v' + r.version + '</span>' : '<span class="fbb-chip">Uses the default</span>');
    var meta = [r.starts_on ? when(r.starts_on) : '', plural(Number(r.responses || 0), 'response', 'responses'), r.updated_at && (r.has_form || r.has_draft) ? 'edited ' + when(r.updated_at) + (r.updated_by_name ? ' by ' + esc(r.updated_by_name) : '') : ''].filter(Boolean).join(' · ');
    return '<div class="fbb-row"><div class="fbb-row-main"><strong>' + esc(r.name) + '</strong><span>' + meta + '</span></div>' +
      '<div class="fbb-row-chips">' + chips.join('') + '</div>' +
      '<button type="button" class="btn ' + (r.has_form || r.has_draft ? 'btn-primary' : 'btn-outline') + '" data-a="edit" data-slug="' + esc(r.slug == null ? '' : r.slug) + '" data-default="' + (r.slug === null ? '1' : '') + '" data-name="' + esc(r.name) + '" data-date="' + esc(r.starts_on || '') + '">' + (r.has_form || r.has_draft ? 'Edit' : (r.slug === null ? 'Customise' : 'Give it its own form')) + '</button></div>';
  }

  // The editor
  function statusInfo() {
    if (dirty()) return ['is-warn', 'Unsaved changes'];
    if (S.hasDraft) return ['is-draft', 'Draft saved · not live yet'];
    if (S.info && S.info.own) return ['is-live', 'Live · version ' + S.info.live_version];
    if (S.info && S.info.uses === 'default') return ['', 'Using the default form'];
    return ['', 'The original form'];
  }
  function barInner() {
    var st = statusInfo(), d = dirty();
    var canPublish = d || S.hasDraft || !(S.info && S.info.own);
    return '<button type="button" class="fbb-back" data-a="back"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>All forms</button>' +
      '<div class="fbb-bar-title"><strong>' + esc(S.name) + '</strong><span class="fbb-chip ' + st[0] + '">' + esc(st[1]) + '</span></div>' +
      '<div class="fbb-bar-actions">' +
      '<button type="button" class="btn btn-outline" data-a="templates">Templates</button>' +
      '<button type="button" class="btn btn-outline" data-a="preview"' + (S.busy ? ' disabled' : '') + '>Preview</button>' +
      '<button type="button" class="btn btn-outline" data-a="save"' + (!d || S.busy ? ' disabled' : '') + '>' + (S.busy === 'save' ? 'Saving…' : 'Save draft') + '</button>' +
      '<button type="button" class="btn btn-primary" data-a="publish"' + (!canPublish || S.busy ? ' disabled' : '') + '>' + (S.busy === 'publish' ? 'Publishing…' : 'Publish') + '</button></div>';
  }
  // A small bar pinned to the bottom of the screen while there is something to save or publish.
  function dockInner() {
    if (S.view !== 'edit' || !S.def) return '';
    var d = dirty(), st = statusInfo();
    var canPublish = d || S.hasDraft || !(S.info && S.info.own);
    if (!d && !S.hasDraft) return '';
    return '<span class="fbb-chip ' + st[0] + '">' + esc(st[1]) + '</span>' +
      '<button type="button" class="btn btn-outline" data-a="save"' + (!d || S.busy ? ' disabled' : '') + '>' + (S.busy === 'save' ? 'Saving\u2026' : 'Save draft') + '</button>' +
      '<button type="button" class="btn btn-primary" data-a="publish"' + (!canPublish || S.busy ? ' disabled' : '') + '>Publish</button>';
  }
  function statusHtml() {
    return '<p class="fbb-status' + (S.statusKind ? ' ' + S.statusKind : '') + '" data-fbb-status role="status">' + esc(S.status) + '</p>';
  }
  function editorHtml() {
    var tabs = [['questions', 'Questions'], ['settings', 'Settings'], ['history', 'History']];
    var body = S.tab === 'settings' ? settingsHtml() : S.tab === 'history' ? historyHtml() : questionsHtml();
    return '<div class="fbb-bar" data-fbb-bar>' + barInner() + '</div><div class="fbb-dock" data-fbb-dock>' + dockInner() + '</div>' + statusHtml() +
      (S.backup ? '<div class="fbb-note is-warn"><span>You have unsaved changes from ' + esc(when(S.backup.at)) + ' kept in this browser.</span><span><button type="button" class="btn btn-outline" data-a="restore-backup">Restore them</button> <button type="button" class="guide-linkbtn" data-a="drop-backup">Discard</button></span></div>' : '') +
      '<div class="fbb-tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" class="fbb-tab' + (S.tab === t[0] ? ' is-on' : '') + '" data-a="tab" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' + body;
  }

  function questionsHtml() {
    var probs = FB.problems(S.def), bad = {};
    probs.forEach(function (p) { if (p.id) bad[p.id] = true; });
    var n = 0;
    var resp = S.info ? Number(S.info.responses || 0) : 0;
    var html = '';
    if (probs.length) html += '<div class="fbb-note is-bad"><strong>Fix before publishing</strong><ul>' + probs.slice(0, 6).map(function (p) { return '<li>' + esc(p.msg) + '</li>'; }).join('') + '</ul></div>';
    if (resp) html += '<div class="fbb-note"><span>' + plural(resp, 'person has', 'people have') + ' already replied. Changing the form never changes their answers, and removed questions stay in your results.</span></div>';
    html += '<div class="fbb-sections">' + S.def.sections.map(function (s, si) {
      var qs = s.questions.map(function (q, qi) {
        if (q.type !== 'info') n++;
        return questionHtml(q, q.type === 'info' ? 0 : n, bad[q.id]);
      }).join('');
      return '<section class="fbb-sec" data-sid="' + esc(s.id) + '">' +
        '<div class="fbb-sec-head"><span class="fbb-drag" draggable="true" data-drag="sec" data-id="' + esc(s.id) + '" title="Drag to reorder" aria-hidden="true">' + gripSvg() + '</span>' +
        '<span class="fbb-sec-n">Section ' + (si + 1) + '</span>' +
        '<span class="fbb-sec-btns">' + iconBtn('sec-up', 'Move section up', '↑', 'data-sid="' + esc(s.id) + '"', si === 0) + iconBtn('sec-down', 'Move section down', '↓', 'data-sid="' + esc(s.id) + '"', si === S.def.sections.length - 1) +
        iconBtn('del-sec', 'Remove section', '×', 'data-sid="' + esc(s.id) + '"', S.def.sections.length < 2) + '</span></div>' +
        '<div class="fbb-sec-fields"><input class="fbb-input fbb-sec-title" maxlength="120" placeholder="Section title (optional)" aria-label="Section title" value="' + esc(s.title) + '" data-sid="' + esc(s.id) + '" data-sf="title">' +
        '<input class="fbb-input" maxlength="400" placeholder="A line of explanation (optional)" aria-label="Section description" value="' + esc(s.description) + '" data-sid="' + esc(s.id) + '" data-sf="description"></div>' +
        '<div class="fbb-qs" data-drop-sid="' + esc(s.id) + '">' + (qs || '<p class="fbb-empty-sec">No questions yet. Add one below.</p>') + '</div>' +
        '<div class="fbb-add"><button type="button" class="btn btn-outline" data-a="add-q" data-sid="' + esc(s.id) + '" data-tab="types">+ Add a question</button>' +
        '<button type="button" class="btn btn-outline" data-a="add-q" data-sid="' + esc(s.id) + '" data-tab="ready">+ Ready-made question</button></div></section>';
    }).join('') + '</div>' +
      '<div class="fbb-add fbb-add-sec"><button type="button" class="btn btn-outline" data-a="add-sec" data-blank="1">+ Add a section</button><button type="button" class="btn btn-outline" data-a="add-sec">+ Ready-made section</button></div>' +
      '<p class="fbb-count">' + plural(countQuestions(S.def), 'question', 'questions') + ' in ' + plural(S.def.sections.length, 'section', 'sections') + '. Up to 40 questions and 10 sections.</p>';
    return html;
  }

  function gripSvg() { return '<svg viewBox="0 0 12 18" width="12" height="18" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.4"/><circle cx="9" cy="3" r="1.4"/><circle cx="3" cy="9" r="1.4"/><circle cx="9" cy="9" r="1.4"/><circle cx="3" cy="15" r="1.4"/><circle cx="9" cy="15" r="1.4"/></svg>'; }
  function iconBtn(act, label, glyph, attrs, disabled) {
    return '<button type="button" class="fbb-ib" data-a="' + act + '" ' + attrs + ' title="' + esc(label) + '" aria-label="' + esc(label) + '"' + (disabled ? ' disabled' : '') + '>' + glyph + '</button>';
  }

  function badgesFor(q) {
    var b = [];
    if (q.required) b.push('<span class="fbb-badge is-req">Required</span>');
    if (q.show_results && (q.type === 'single' || q.type === 'multi' || q.type === 'yesno')) b.push('<span class="fbb-badge is-poll">Poll</span>');
    if (q.partner_visible) b.push('<span class="fbb-badge is-partner">Partners</span>');
    if (q.show_if && q.show_if.q) b.push('<span class="fbb-badge">Conditional</span>');
    return b.join('');
  }
  function subFor(q) {
    var t = FB.TYPES[q.type] || { label: q.type };
    var extra = (q.type === 'single' || q.type === 'multi') ? ' · ' + plural((q.options || []).length, 'option', 'options') : q.type === 'scale' ? ' · ' + q.min + ' to ' + q.max : '';
    return esc(t.label + extra);
  }
  function questionHtml(q, num, bad) {
    var t = FB.TYPES[q.type] || { icon: '?', label: q.type };
    var open = S.open === q.id;
    var attrs = 'data-qid="' + esc(q.id) + '"';
    var title = q.type === 'info' ? (q.title || 'Heading or note') : (q.title || 'Untitled question');
    return '<div class="fbb-q' + (open ? ' is-open' : '') + (bad ? ' has-problem' : '') + (q.type === 'info' ? ' is-info' : '') + '" ' + attrs + '>' +
      '<div class="fbb-q-head" data-a="toggle" ' + attrs + ' tabindex="0" role="button" aria-expanded="' + (open ? 'true' : 'false') + '">' +
      '<span class="fbb-drag" draggable="true" data-drag="q" data-id="' + esc(q.id) + '" title="Drag to reorder" aria-hidden="true">' + gripSvg() + '</span>' +
      '<span class="fbb-q-icon" aria-hidden="true">' + (q.type === 'info' ? t.icon : (num || '')) + '</span>' +
      '<span class="fbb-q-main"><strong class="fbb-q-title" data-title-for="' + esc(q.id) + '">' + esc(title) + '</strong><span class="fbb-q-sub">' + subFor(q) + badgesFor(q) + '</span></span>' +
      '<span class="fbb-q-btns">' + iconBtn('up', 'Move up', '↑', attrs) + iconBtn('down', 'Move down', '↓', attrs) + '</span>' +
      '<svg class="fbb-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></div>' +
      (open ? questionBody(q) : '') + '</div>';
  }

  function field(label, inner, note) { return '<div class="fbb-field"><label class="fbb-label">' + label + '</label>' + inner + (note ? '<small class="fbb-note-s">' + note + '</small>' : '') + '</div>'; }
  function input(q, f, v, extra) { return '<input class="fbb-input" data-qid="' + esc(q.id) + '" data-qf="' + f + '" value="' + esc(v) + '" ' + (extra || '') + '>'; }
  function toggle(q, f, label, note, on) {
    return '<label class="fbb-switch"><input type="checkbox" data-qid="' + esc(q.id) + '" data-qf="' + f + '" data-kind="b"' + (on ? ' checked' : '') + '><span class="fbb-switch-ui" aria-hidden="true"></span><span class="fbb-switch-text"><strong>' + label + '</strong>' + (note ? '<small>' + note + '</small>' : '') + '</span></label>';
  }
  function select(q, f, opts, val, kind) {
    return '<select class="fbb-input" data-qid="' + esc(q.id) + '" data-qf="' + f + '"' + (kind ? ' data-kind="' + kind + '"' : '') + '>' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
  }

  function questionBody(q) {
    var core = FB.CORE.indexOf(q.type) !== -1;
    var h = '<div class="fbb-q-body">';
    if (q.type === 'info') {
      h += field('Heading', input(q, 'title', q.title, 'maxlength="160" placeholder="e.g. A few quick questions"')) +
        field('Text (optional)', '<textarea class="fbb-input" rows="3" maxlength="600" data-qid="' + esc(q.id) + '" data-qf="body" placeholder="A sentence or two">' + esc(q.body || '') + '</textarea>');
    } else {
      h += field('Question', input(q, 'title', q.title, 'maxlength="160" placeholder="What do you want to ask?"')) +
        field('Helper text <span>(optional)</span>', input(q, 'hint', q.hint || '', 'maxlength="300" placeholder="A short line under the question"'));
      if (core) h += '<p class="fbb-core-note">' + esc((FB.TYPES[q.type] || {}).desc || '') + ' The answer choices for this built-in question are fixed.</p>';
    }
    if (q.type === 'single' || q.type === 'multi') h += optionsHtml(q);
    if (q.type === 'scale') h += scaleHtml(q);
    if (q.type === 'overall') h += field('Look', select(q, 'style', [['faces', 'Faces'], ['stars', 'Stars']], q.style || 'faces'));
    if (q.type === 'yesno') h += '<div class="fbb-two">' + field('“Yes” button says', input(q, 'yes_label', q.yes_label || 'Yes', 'maxlength="20"')) + field('“No” button says', input(q, 'no_label', q.no_label || 'No', 'maxlength="20"')) + '</div>';
    if (q.type === 'text') h += '<div class="fbb-two">' + field('Placeholder', input(q, 'placeholder', q.placeholder || '', 'maxlength="120"')) + field('Longest answer', input(q, 'max', q.max || 200, 'type="number" min="20" max="300" data-kind="n"')) + '</div>';
    if (q.type === 'longtext') h += '<div class="fbb-two">' + field('Placeholder', input(q, 'placeholder', q.placeholder || '', 'maxlength="120"')) + field('Longest answer', input(q, 'max', q.max || 1000, 'type="number" min="50" max="2000" data-kind="n"')) + '</div>';

    if (q.type !== 'info') {
      h += '<div class="fbb-switches">' + toggle(q, 'required', 'Required', 'People must answer before they can send.', q.required);
      if (q.type === 'single' || q.type === 'multi' || q.type === 'yesno') h += toggle(q, 'show_results', 'Make it a live poll', 'After answering, people see how everyone is voting (shown once 5 people have answered).', q.show_results);
      h += toggle(q, 'partner_visible', 'Show on the partner page', 'Collaborating partners can see the results for this question.', q.partner_visible) + '</div>';
      h += ruleHtml(q);
    } else {
      h += ruleHtml(q);
    }
    h += '<div class="fbb-q-foot">' + sectionMover(q) +
      '<span class="fbb-q-foot-btns">' + (core ? '' : '<button type="button" class="btn btn-outline" data-a="dup-q" data-qid="' + esc(q.id) + '">Duplicate</button>') +
      '<button type="button" class="btn btn-outline fbb-danger" data-a="del-q" data-qid="' + esc(q.id) + '">Remove</button></span></div></div>';
    return h;
  }

  function sectionMover(q) {
    if (S.def.sections.length < 2) return '<span></span>';
    var cur = find(q.id);
    return '<label class="fbb-move"><span>Move to</span><select class="fbb-input" data-a-change="move-q" data-qid="' + esc(q.id) + '">' + S.def.sections.map(function (s, i) {
      return '<option value="' + esc(s.id) + '"' + (cur && cur.section.id === s.id ? ' selected' : '') + '>' + esc(s.title || 'Section ' + (i + 1)) + '</option>';
    }).join('') + '</select></label>';
  }

  function optionsHtml(q) {
    var opts = q.options || [];
    var h = '<div class="fbb-field"><label class="fbb-label">Options</label><ol class="fbb-optlist">' + opts.map(function (o, i) {
      return '<li class="fbb-opt"><span class="fbb-opt-n">' + (i + 1) + '</span><input class="fbb-input" maxlength="80" placeholder="Option ' + (i + 1) + '" value="' + esc(o.label) + '" data-oq="' + esc(q.id) + '" data-oi="' + i + '" aria-label="Option ' + (i + 1) + '">' +
        iconBtn('opt-up', 'Move option up', '↑', 'data-qid="' + esc(q.id) + '" data-i="' + i + '"', i === 0) + iconBtn('opt-down', 'Move option down', '↓', 'data-qid="' + esc(q.id) + '" data-i="' + i + '"', i === opts.length - 1) +
        iconBtn('opt-del', 'Remove option', '×', 'data-qid="' + esc(q.id) + '" data-i="' + i + '"', opts.length <= 2) + '</li>';
    }).join('') + '</ol><div class="fbb-opt-actions">' +
      (opts.length < 20 ? '<button type="button" class="btn btn-outline" data-a="opt-add" data-qid="' + esc(q.id) + '">+ Add option</button><button type="button" class="btn btn-outline" data-a="opt-bulk" data-qid="' + esc(q.id) + '">Paste a list</button>' : '<small class="fbb-note-s">20 options is the most.</small>') + '</div>' +
      (S.bulk === q.id ? '<div class="fbb-bulk"><textarea class="fbb-input" rows="5" data-bulk placeholder="One option per line"></textarea><button type="button" class="btn btn-primary" data-a="opt-bulk-add" data-qid="' + esc(q.id) + '">Add these</button></div>' : '') + '</div>';
    h += '<div class="fbb-switches">' + toggle(q, 'allow_other', 'Let people type their own answer', 'Adds an “Other” choice with a text box.', q.allow_other) + '</div>';
    if (q.type === 'single') h += field('Look', select(q, 'style', [['pills', 'Buttons side by side'], ['list', 'A list, one per line']], q.style || 'pills'));
    if (q.type === 'multi') {
      var mx = [];
      for (var i = 1; i <= opts.length + (q.allow_other ? 1 : 0); i++) mx.push([i, i === 1 ? 'Only one' : 'Up to ' + i]);
      h += field('How many can they pick?', select(q, 'max', mx, Math.min(q.max || opts.length, opts.length + 1), 'n'));
    }
    return h;
  }

  function scaleHtml(q) {
    var maxs = []; for (var i = 2; i <= 10; i++) maxs.push([i, String(i)]);
    var starsOk = q.min === 1 && q.max === 5;
    var style = starsOk ? (q.style || 'numbers') : 'numbers';
    var prev = ''; for (var v = q.min; v <= q.max; v++) prev += '<span class="fbb-pv">' + (style === 'stars' ? '★' : v) + '</span>';
    return '<div class="fbb-two">' + field('Starts at', select(q, 'min', [[1, '1'], [0, '0']], q.min, 'n')) + field('Goes up to', select(q, 'max', maxs, q.max, 'n')) + '</div>' +
      '<div class="fbb-two">' + field('Label for the low end', input(q, 'low_label', q.low_label || '', 'maxlength="40" placeholder="e.g. Not at all"')) + field('Label for the high end', input(q, 'high_label', q.high_label || '', 'maxlength="40" placeholder="e.g. Extremely"')) + '</div>' +
      field('Look', select(q, 'style', starsOk ? [['numbers', 'Numbers'], ['stars', 'Stars'], ['faces', 'Faces']] : [['numbers', 'Numbers']], style), starsOk ? '' : 'Stars and faces are for 1 to 5 scales.') +
      '<div class="fbb-scale-prev" aria-hidden="true">' + (q.low_label ? '<small>' + esc(q.low_label) + '</small>' : '') + '<span class="fbb-pvs">' + prev + '</span>' + (q.high_label ? '<small>' + esc(q.high_label) + '</small>' : '') + '</div>';
  }

  // "Show only if..."
  function ruleSources(q) {
    var out = [];
    var all = FB.flat(S.def);
    for (var i = 0; i < all.length; i++) { if (all[i].q.id === q.id) break; if (FB.canBeSource(all[i].q)) out.push(all[i].q); }
    return out;
  }
  function numericRange(src) {
    if (src.type === 'overall') return [1, 5];
    if (src.type === 'scale') return [src.min, src.max];
    return null;
  }
  function ruleHtml(q) {
    var r = q.show_if && q.show_if.q ? q.show_if : null;
    var srcs = ruleSources(q);
    if (!r) {
      if (!srcs.length) return '<div class="fbb-rule is-off"><small>To show this question only for some answers, add a pick-one, scale, rating or yes/no question before it.</small></div>';
      return '<div class="fbb-rule is-off"><button type="button" class="guide-linkbtn" data-a="rule-add" data-qid="' + esc(q.id) + '">+ Only show this question if…</button></div>';
    }
    var src = FB.findQuestion(S.def, r.q);
    var h = '<div class="fbb-rule"><div class="fbb-rule-head"><strong>Only show this question if</strong><button type="button" class="guide-linkbtn" data-a="rule-del" data-qid="' + esc(q.id) + '">Remove condition</button></div><div class="fbb-rule-row">';
    h += '<select class="fbb-input" data-qid="' + esc(q.id) + '" data-rf="q" aria-label="Question to check">' + (src && srcs.indexOf(src) === -1 ? '<option selected value="' + esc(r.q) + '">(unavailable)</option>' : '') +
      srcs.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === r.q ? ' selected' : '') + '>' + esc((s.title || 'Untitled').slice(0, 60)) + '</option>'; }).join('') + '</select>';
    if (src) {
      var choices = FB.sourceChoices(src), range = numericRange(src);
      var ops = choices ? [['is', 'is any of'], ['is_not', 'is none of'], ['answered', 'has been answered']] : [['lte', 'is at most'], ['gte', 'is at least'], ['answered', 'has been answered']];
      h += '<select class="fbb-input" data-qid="' + esc(q.id) + '" data-rf="op" aria-label="Condition">' + ops.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === r.op ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>';
      if (r.op !== 'answered') {
        if (choices) {
          var have = Array.isArray(r.v) ? r.v.map(String) : (r.v === undefined || r.v === null || r.v === '' ? [] : [String(r.v)]);
          h += '<div class="fbb-rule-chips">' + choices.map(function (c) {
            return '<label class="fbb-chk"><input type="checkbox" data-qid="' + esc(q.id) + '" data-rf="vv" value="' + esc(c[0]) + '"' + (have.indexOf(String(c[0])) !== -1 ? ' checked' : '') + '><span>' + esc(c[1]) + '</span></label>';
          }).join('') + '</div>';
        } else if (range) {
          var os = []; for (var i = range[0]; i <= range[1]; i++) os.push(i);
          h += '<select class="fbb-input" data-qid="' + esc(q.id) + '" data-rf="v" aria-label="Value">' + os.map(function (n) { return '<option value="' + n + '"' + (Number(r.v) === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select>';
        }
      }
    }
    return h + '</div></div>';
  }
  function defaultRule(src) {
    var choices = FB.sourceChoices(src), range = numericRange(src);
    if (choices) return { q: src.id, op: 'is', v: [choices[0][0]] };
    if (range) return { q: src.id, op: 'lte', v: Math.max(range[0], Math.round(range[1] / 2)) };
    return { q: src.id, op: 'answered', v: null };
  }

  // Settings
  function settingsHtml() {
    var st = S.def.settings;
    function tx(f, label, ph, max, note, area) {
      var ctl = area ? '<textarea class="fbb-input" rows="3" maxlength="' + max + '" data-set="' + f + '" placeholder="' + esc(ph) + '">' + esc(st[f] || '') + '</textarea>'
        : '<input class="fbb-input" maxlength="' + max + '" data-set="' + f + '" placeholder="' + esc(ph) + '" value="' + esc(st[f] || '') + '">';
      return field(label, ctl, note);
    }
    function sw(f, label, note) {
      return '<label class="fbb-switch"><input type="checkbox" data-set="' + f + '" data-kind="b"' + (st[f] ? ' checked' : '') + '><span class="fbb-switch-ui" aria-hidden="true"></span><span class="fbb-switch-text"><strong>' + label + '</strong><small>' + note + '</small></span></label>';
    }
    return '<div class="fbb-cards">' +
      '<div class="fbb-card"><h4>What people read</h4>' +
      tx('title', 'Form heading', 'e.g. How was Games Night?', 120, 'Leave blank to use the event’s name.') +
      tx('intro', 'Welcome message', 'e.g. Two minutes, and it really helps us plan the next one.', 600, '', true) +
      tx('thank_you', 'Thank-you message', 'e.g. See you at the next one!', 600, 'Shown after they send it.', true) +
      tx('submit_label', 'Send button says', 'Send feedback', 30, '') + '</div>' +
      '<div class="fbb-card"><h4>Who can answer</h4>' +
      '<div class="fbb-radios" role="radiogroup" aria-label="Who can answer">' +
      radio('audience', 'everyone', 'Everyone', 'Members, professionals and guests. Guests are shown how to join LACMS afterwards.', st.audience !== 'members') +
      radio('audience', 'members', 'LACMS members only', 'People must sign in first. Good for Sankofa and member-only nights.', st.audience === 'members') + '</div>' +
      field('Closes on <span>(optional)</span>', '<div class="fbb-date"><input type="date" class="fbb-input" data-set="closes_on" value="' + esc(st.closes_on || '') + '">' + (st.closes_on ? '<button type="button" class="guide-linkbtn" data-a="clear-close">Clear</button>' : '') + '</div>', 'After this date the form tells people it has closed.') + '</div>' +
      '<div class="fbb-card"><h4>Privacy and extras</h4><div class="fbb-switches">' +
      sw('allow_anonymous', 'Let members reply anonymously', 'Their name and details are hidden from the committee.') +
      sw('ask_quote_consent', 'Ask permission to quote comments', 'Adds “you may quote me” under the comment box. Only those comments can appear on partner pages.') +
      sw('guest_pitch', 'Invite guests to join LACMS', 'After sending, guests see how to become a member (Student Union, Gold Card).') + '</div></div></div>';
  }
  function radio(name, val, label, note, on) {
    return '<label class="fbb-radio' + (on ? ' is-on' : '') + '"><input type="radio" name="fbb-' + name + '" data-set="' + name + '" value="' + val + '"' + (on ? ' checked' : '') + '><span><strong>' + label + '</strong><small>' + note + '</small></span></label>';
  }

  // History
  function historyHtml() {
    var h = '';
    if (S.hist === null) { loadHistory(); h += '<p class="sh-muted">Loading the history…</p>'; }
    else if (S.hist.error) h += '<div class="form-note"><span>' + esc(S.hist.error) + '</span></div>';
    else if (!S.hist.rows.length) h += '<div class="fbb-empty"><h4>Nothing published yet</h4><p>Every time you publish, that version is kept here for 30 versions so you can go back.</p></div>';
    else h += '<div class="fbb-card"><h4>Published versions</h4><ul class="fbb-hist">' + S.hist.rows.map(function (r, i) {
      return '<li><div><strong>Version ' + r.version + '</strong>' + (i === 0 ? ' <span class="fbb-chip is-live">Live</span>' : '') + '<span>' + esc(when(r.saved_at)) + (r.saved_by_name ? ' · ' + esc(r.saved_by_name) : '') + ' · ' + plural(r.question_count, 'question', 'questions') + '</span></div>' +
        '<button type="button" class="btn btn-outline" data-a="hist-restore" data-id="' + esc(r.id) + '">Restore as my draft</button></li>';
    }).join('') + '</ul><p class="fbb-note-s">Restoring puts that version in your draft to review. Nothing changes for the public until you publish.</p></div>';
    h += '<div class="fbb-card"><h4>Start over</h4><div class="fbb-danger-zone">';
    if (S.hasDraft) h += '<div><strong>Throw away my draft</strong><small>Goes back to the live form.</small></div><button type="button" class="btn btn-outline fbb-danger" data-a="discard">Discard draft</button>';
    if (S.info && S.info.own) h += '<div><strong>' + (S.slug === null ? 'Go back to the original form' : 'Use the default form again') + '</strong><small>' + (S.slug === null ? 'Removes your customised default form. Past answers are kept.' : 'This event stops having its own form. Past answers are kept.') + '</small></div><button type="button" class="btn btn-outline fbb-danger" data-a="reset">' + (S.slug === null ? 'Reset' : 'Use default') + '</button>';
    if (!S.hasDraft && !(S.info && S.info.own)) h += '<p class="sh-muted">Nothing to undo: this form hasn’t been customised.</p>';
    return h + '</div></div>';
  }
  function loadHistory() {
    S.hist = { rows: [], loading: true };
    supabaseClient.rpc('feedback_form_history_list', { p_slug: S.slug }).then(function (res) {
      S.hist = res.error ? { error: nice(res.error.message), rows: [] } : { rows: res.data || [] };
      if (S.view === 'edit' && S.tab === 'history') render();
    }, function () { S.hist = { error: 'Could not load the history.', rows: [] }; if (S.tab === 'history') render(); });
  }

  // Modals
  function modalHtml() {
    var m = S.modal;
    if (!m) return '';
    var title = '', body = '', wide = '';
    if (m.kind === 'addq') {
      title = 'Add a question';
      var tabs = [['types', 'Question types'], ['ready', 'Ready-made']];
      body = '<div class="fbb-tabs fbb-tabs-s">' + tabs.map(function (t) { return '<button type="button" class="fbb-tab' + (m.tab === t[0] ? ' is-on' : '') + '" data-a="modal-tab" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' + (m.tab === 'ready' ? readyQuestions() : typePicker());
    } else if (m.kind === 'addsec') {
      title = 'Add a section';
      body = '<div class="fbb-picks"><button type="button" class="fbb-pick" data-a="pick-sec" data-i="blank"><span class="fbb-pick-i">+</span><span><strong>Blank section</strong><small>Start empty and add your own questions.</small></span></button>' +
        TPL.sections.map(function (s, i) { return '<button type="button" class="fbb-pick" data-a="pick-sec" data-i="' + i + '"><span class="fbb-pick-i">▤</span><span><strong>' + esc(s.name) + '</strong><small>' + esc(s.desc) + '</small></span></button>'; }).join('') + '</div>';
    } else if (m.kind === 'forms') {
      title = 'Templates'; wide = ' is-wide';
      body = '<div class="fbb-tabs fbb-tabs-s"><button type="button" class="fbb-tab' + (m.tab !== 'copy' ? ' is-on' : '') + '" data-a="modal-tab" data-tab="forms">Ready-made forms</button><button type="button" class="fbb-tab' + (m.tab === 'copy' ? ' is-on' : '') + '" data-a="modal-tab" data-tab="copy">Copy another event’s form</button></div>' + (m.tab === 'copy' ? copyList() : formTemplates());
    } else if (m.kind === 'publish') {
      title = 'Publish this form?';
      body = publishBody();
    } else if (m.kind === 'preview') {
      title = 'Preview'; wide = ' is-preview';
      var url = 'feedback.html?event=' + encodeURIComponent(previewSlug()) + '&preview=1&as=guest&embed=1&t=' + m.t;
      body = '<div class="fbb-pv-bar"><div class="fbb-seg"><button type="button" class="' + (S.device === 'phone' ? 'is-on' : '') + '" data-a="device" data-d="phone">Phone</button><button type="button" class="' + (S.device === 'desktop' ? 'is-on' : '') + '" data-a="device" data-d="desktop">Computer</button></div>' +
        '<a class="btn btn-outline" href="' + esc(url.replace('&embed=1', '')) + '" target="_blank" rel="noopener">Open in a new tab</a></div>' +
        '<div class="fbb-frame fbb-frame--' + S.device + '"><iframe title="Form preview" src="' + esc(url) + '"></iframe></div>' +
        '<p class="fbb-note-s">This is your saved draft. You can fill it in to test it; nothing is sent.</p>';
    }
    return '<div class="fbb-modal" data-a="modal-bg"><div class="fbb-modal-box' + wide + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<div class="fbb-modal-head"><h3>' + esc(title) + '</h3><button type="button" class="guide-close" data-a="close-modal" aria-label="Close">&times;</button></div>' +
      '<div class="fbb-modal-body">' + body + '</div></div></div>';
  }
  function typePicker() {
    var used = {}; FB.flat(S.def).forEach(function (x) { used[x.q.type] = true; });
    var own = ['single', 'multi', 'scale', 'yesno', 'text', 'longtext', 'info'];
    var core = FB.CORE.filter(function (c) { return !used[c]; });
    function pick(t) { var d = FB.TYPES[t]; return '<button type="button" class="fbb-pick" data-a="pick-type" data-type="' + t + '"><span class="fbb-pick-i">' + d.icon + '</span><span><strong>' + esc(d.label) + '</strong><small>' + esc(d.desc) + '</small></span></button>'; }
    return '<div class="fbb-picks">' + own.map(pick).join('') + '</div>' +
      (core.length ? '<h4 class="fbb-h4">Built-in questions you’re not using</h4><div class="fbb-picks">' + core.map(pick).join('') + '</div>' : '');
  }
  function readyQuestions() {
    return '<p class="fbb-note-s">Tap to add. You can change the wording and options afterwards.' + (S.added ? ' <strong>' + plural(S.added, 'question', 'questions') + ' added.</strong>' : '') + '</p>' +
      TPL.questions.map(function (g, gi) {
        return '<h4 class="fbb-h4">' + esc(g.group) + '</h4><div class="fbb-tags">' + g.items.map(function (it, ii) { return '<button type="button" class="fbb-tag" data-a="pick-qt" data-g="' + gi + '" data-i="' + ii + '">+ ' + esc(it.label) + '</button>'; }).join('') + '</div>';
      }).join('') + '<div class="fbb-modal-foot"><button type="button" class="btn btn-primary" data-a="close-modal">Done</button></div>';
  }
  function formTemplates() {
    return '<p class="fbb-note-s">Pick one to start from. It replaces the questions you have now (you can undo straight after).</p><div class="fbb-picks fbb-picks-2">' +
      TPL.forms.map(function (f, i) {
        return '<button type="button" class="fbb-pick fbb-pick-form" data-a="use-form" data-i="' + i + '"><span class="fbb-pick-i">' + f.emoji + '</span><span><strong>' + esc(f.name) + '</strong><small>' + esc(f.desc) + '</small><em>About ' + esc(f.time) + ' to fill in</em></span></button>';
      }).join('') + '</div>';
  }
  function copyList() {
    if (!S.list) return '<p class="sh-muted">Loading…</p>';
    var rows = S.list.filter(function (r) { return r.has_form && slugKey(r.slug) !== slugKey(S.slug); });
    if (!rows.length) return '<p class="sh-muted">No other event has its own form yet. Customise the default form or another event first.</p>';
    return '<p class="fbb-note-s">Copies the live questions and settings. It replaces what you have now (you can undo).</p><ul class="fbb-hist">' + rows.map(function (r) {
      return '<li><div><strong>' + esc(r.name) + '</strong><span>Version ' + r.version + (r.starts_on ? ' · ' + esc(when(r.starts_on)) : '') + '</span></div><button type="button" class="btn btn-outline" data-a="copy-from" data-slug="' + esc(r.slug == null ? '' : r.slug) + '" data-default="' + (r.slug === null ? '1' : '') + '">Copy</button></li>';
    }).join('') + '</ul>';
  }
  function publishBody() {
    var live = S.info && S.info.own ? S.info.live : null;
    var before = {}, after = {}, added = 0, removed = 0;
    if (live) FB.flat(live).forEach(function (x) { if (x.q.type !== 'info') before[x.q.id] = true; });
    FB.flat(S.def).forEach(function (x) { if (x.q.type !== 'info') after[x.q.id] = true; });
    Object.keys(after).forEach(function (k) { if (!before[k]) added++; });
    Object.keys(before).forEach(function (k) { if (!after[k]) removed++; });
    var resp = S.info ? Number(S.info.responses || 0) : 0;
    var lines = [];
    lines.push('The form has ' + plural(countQuestions(S.def), 'question', 'questions') + '.');
    if (live) lines.push((added ? plural(added, 'question', 'questions') + ' added. ' : '') + (removed ? plural(removed, 'question', 'questions') + ' removed (their past answers stay in your results). ' : '') + (!added && !removed ? 'The same questions as before, with your edits.' : ''));
    else lines.push(S.slug === null ? 'This becomes the form every event without its own will use.' : 'This event will use its own form from now on.');
    if (resp) lines.push(plural(resp, 'person has', 'people have') + ' already replied. Their answers are not changed.');
    return '<ul class="fbb-bullets">' + lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul><p class="fbb-note-s">People see the new version straight away.</p>' +
      '<div class="fbb-modal-foot"><button type="button" class="btn btn-outline" data-a="close-modal">Not yet</button><button type="button" class="btn btn-primary" data-a="publish-go"' + (S.busy ? ' disabled' : '') + '>' + (S.busy === 'publish' ? 'Publishing…' : 'Publish now') + '</button></div>';
  }
  function toastHtml() {
    if (!S.toast) return '';
    return '<div class="fbb-toast" role="status"><span>' + esc(S.toast) + '</span>' + (S.undo ? '<button type="button" data-a="undo">Undo</button>' : '') + '</div>';
  }
  function toast(msg, undoable) {
    S.toast = msg;
    if (!undoable) S.undo = null;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { S.toast = ''; S.undo = null; var t = root && root.querySelector('.fbb-toast'); if (t) t.remove(); }, undoable ? 9000 : 3500);
    var old = root && root.querySelector('.fbb-toast');
    if (old) old.remove();
    if (root) root.insertAdjacentHTML('beforeend', toastHtml());
  }
  function snapshot() {
    S.undo = JSON.stringify(S.def); S.toast = '';
    var old = root && root.querySelector('.fbb-toast'); if (old) old.remove();
  }

  // ---- Changing the form -------------------------------------------------------------------
  function touch() { writeBackup(); refreshBar(); }
  function uniqueOptId(q) {
    var max = 0; (q.options || []).forEach(function (o) { var m = /^o(\d+)$/.exec(o.id); if (m) max = Math.max(max, Number(m[1])); });
    return 'o' + (max + 1);
  }
  function takenCore() { var t = {}; FB.flat(S.def).forEach(function (x) { if (FB.CORE.indexOf(x.q.type) !== -1) t[x.q.type] = true; }); return t; }
  // A copy of a template section without built-in questions that are already on the form.
  function dedupe(sectionObj, taken) {
    sectionObj.questions = sectionObj.questions.filter(function (q) { if (FB.CORE.indexOf(q.type) === -1) return true; if (taken[q.type]) return false; taken[q.type] = true; return true; });
    return sectionObj;
  }
  function room(n) {
    if (countQuestions(S.def) + n > 40) { toast('A form can have up to 40 questions.'); return false; }
    return true;
  }

  function newQuestion(type) {
    if (FB.CORE.indexOf(type) !== -1) return FB.core(type, type === 'overall' ? { style: 'faces' } : {});
    var M = TPL.make;
    switch (type) {
      case 'single': return M.single('', ['Option 1', 'Option 2'], {});
      case 'multi': return M.multi('', ['Option 1', 'Option 2', 'Option 3'], { max: 3 });
      case 'scale': return M.scale('', {});
      case 'yesno': return M.yesno('', {});
      case 'text': return M.text('', {});
      case 'longtext': return M.longtext('', {});
      default: return M.info('', '');
    }
  }
  function addQuestion(sid, q) {
    var s = sec(sid) || S.def.sections[S.def.sections.length - 1];
    s.questions.push(q);
    S.open = q.id;
    return q;
  }
  function removeQuestion(id) {
    S.def.sections.forEach(function (s) { s.questions = s.questions.filter(function (q) { return q.id !== id; }); });
    // rules that pointed at it can no longer work
    FB.flat(S.def).forEach(function (x) { if (x.q.show_if && x.q.show_if.q === id) delete x.q.show_if; });
  }
  function moveQuestion(id, toSid, index) {
    var cur = find(id); if (!cur) return;
    var q = cur.q;
    cur.section.questions.splice(cur.section.questions.indexOf(q), 1);
    var to = sec(toSid) || cur.section;
    if (index === undefined || index > to.questions.length) index = to.questions.length;
    to.questions.splice(index, 0, q);
  }
  function step(id, dir) {
    var cur = find(id); if (!cur) return;
    var secs = S.def.sections, si = secs.indexOf(cur.section), qi = cur.section.questions.indexOf(cur.q);
    if (dir < 0) {
      if (qi > 0) moveQuestion(id, cur.section.id, qi - 1);
      else if (si > 0) moveQuestion(id, secs[si - 1].id);
    } else {
      if (qi < cur.section.questions.length - 1) moveQuestion(id, cur.section.id, qi + 1);
      else if (si < secs.length - 1) moveQuestion(id, secs[si + 1].id, 0);
    }
  }
  function moveSection(sid, to) {
    var secs = S.def.sections, i = secs.map(function (s) { return s.id; }).indexOf(sid);
    if (i < 0) return;
    to = Math.max(0, Math.min(secs.length - 1, to));
    var s = secs.splice(i, 1)[0]; secs.splice(to, 0, s);
  }
  function replaceDef(next, msg) {
    snapshot();
    next.settings = Object.assign({}, FB.DEFAULT_SETTINGS, next.settings || {});
    delete next.archived;
    S.def = next; S.open = null; S.bulk = null; S.modal = null;
    writeBackup();
    render();
    toast(msg, true);
  }

  // ---- Saving, publishing, previewing ---------------------------------------------------------
  function setStatus(msg, kind) { S.status = msg || ''; S.statusKind = kind || ''; var st = root && root.querySelector('[data-fbb-status]'); if (st) st.outerHTML = statusHtml(); }

  function save(thenDo) {
    if (S.busy) return;
    S.busy = 'save'; refreshBar(); setStatus('');
    var snap = JSON.stringify(S.def);
    supabaseClient.rpc('feedback_form_save_draft', { p_slug: S.slug, p_def: S.def, p_base: FB.standard() }).then(function (res) {
      S.busy = '';
      if (res.error) { refreshBar(); setStatus('Couldn’t save: ' + nice(res.error.message), 'is-bad'); return; }
      S.saved = snap; S.hasDraft = true; clearBackup();
      refreshBar();
      setStatus('Draft saved. The public still sees the live form.', 'is-ok');
      if (thenDo) thenDo();
    }, function () { S.busy = ''; refreshBar(); setStatus('Couldn’t reach the server. Your changes are kept in this browser.', 'is-bad'); });
  }

  function publishStart() {
    var probs = FB.problems(S.def);
    if (probs.length) { S.tab = 'questions'; render(); setStatus('Fix these first: ' + probs[0].msg, 'is-bad'); return; }
    S.modal = { kind: 'publish' }; render();
  }
  function publishGo() {
    if (S.busy) return;
    S.busy = 'publish'; render();
    var needSave = dirty() || !S.hasDraft;
    var snap = JSON.stringify(S.def);
    var fail = function (msg) { S.busy = ''; S.modal = null; render(); setStatus(msg, 'is-bad'); };
    var saving = needSave ? supabaseClient.rpc('feedback_form_save_draft', { p_slug: S.slug, p_def: S.def, p_base: FB.standard() }) : Promise.resolve({});
    Promise.resolve(saving).then(function (res) {
      if (res && res.error) { fail('Couldn\u2019t save: ' + nice(res.error.message)); return; }
      if (needSave) { S.saved = snap; S.hasDraft = true; }
      return Promise.resolve(supabaseClient.rpc('feedback_form_publish', { p_slug: S.slug })).then(function (pub) {
        if (pub.error) { fail('Couldn\u2019t publish: ' + nice(pub.error.message)); return; }
        S.busy = ''; S.modal = null; S.list = null; S.hist = null; clearBackup();
        return Promise.resolve(supabaseClient.rpc('feedback_form_get', { p_slug: S.slug })).then(function (g) {
          if (!g.error && g.data) { S.info = g.data; S.hasDraft = !!g.data.draft; }
          else { S.hasDraft = false; if (S.info) S.info.own = true; }
          S.saved = snap;
          render(); setStatus('Published. People now see this version.', 'is-ok'); toast('Published');
        });
      });
    }, function () { fail('Couldn\u2019t reach the server.'); });
  }

  function previewStart() {
    var probs = FB.problems(S.def);
    if (probs.length) { setStatus('Finish these before previewing: ' + probs[0].msg, 'is-bad'); return; }
    var show = function () { S.modal = { kind: 'preview', t: Date.now() }; render(); };
    // the preview reads the saved draft, so unsaved edits are saved first
    if (dirty()) save(show); else show();
  }

  function reloadCurrent(msg) {
    var slug = S.slug, name = S.name, date = S.date;
    S.list = null;
    supabaseClient.rpc('feedback_forms_overview').then(function (r) { if (!r.error) S.list = r.data || []; });
    openForm(slug, name, date);
    if (msg) setTimeout(function () { setStatus(msg, 'is-ok'); }, 400);
  }

  // ---- Events ----------------------------------------------------------------------------------
  function bind(el) {
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('fbb-q-head')) { e.preventDefault(); onClick(e); return; }
      if (e.key === 'Enter' && e.target.hasAttribute && e.target.hasAttribute('data-oq')) {
        e.preventDefault();
        var q = find(e.target.getAttribute('data-oq')); if (!q) return;
        var i = Number(e.target.getAttribute('data-oi'));
        if (q.q.options.length >= 20) return;
        q.q.options.splice(i + 1, 0, { id: uniqueOptId(q.q), label: '' });
        focusSel = '[data-oq="' + q.q.id + '"][data-oi="' + (i + 1) + '"]'; touch(); render();
      }
    });
    el.addEventListener('input', onInput);
    el.addEventListener('change', onChange);
    el.addEventListener('dragstart', onDragStart);
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('drop', onDrop);
    el.addEventListener('dragend', clearDrag);
    el.addEventListener('dragleave', function (e) { if (!el.contains(e.relatedTarget)) clearMarks(); });
  }

  document.addEventListener('keydown', function (e) {
    if (!root || !document.body.contains(root) || !root.offsetParent) return;
    if (e.key === 'Escape' && S.modal) { S.modal = null; render(); }
    if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S') && S.view === 'edit') { e.preventDefault(); if (dirty()) save(); }
  });
  window.addEventListener('beforeunload', function (e) { if (S.view === 'edit' && dirty()) { e.preventDefault(); e.returnValue = ''; } });

  function onInput(e) {
    var t = e.target;
    if (t.hasAttribute('data-fbb-search')) { S.search = t.value; var pos = t.selectionStart; render(); var s = root.querySelector('[data-fbb-search]'); if (s) { s.focus(); try { s.setSelectionRange(pos, pos); } catch (x) { /* ignore */ } } return; }
    if (!S.def) return;
    var qid = t.getAttribute('data-qid'), f = t.getAttribute('data-qf'), q;
    if (qid && f && t.type !== 'checkbox' && t.tagName !== 'SELECT') {
      q = find(qid); if (!q) return; q = q.q;
      q[f] = t.getAttribute('data-kind') === 'n' ? (t.value === '' ? '' : Number(t.value)) : t.value;
      if (f === 'title') {
        var h = root.querySelector('[data-title-for="' + qid + '"]');
        if (h) h.textContent = t.value || (q.type === 'info' ? 'Heading or note' : 'Untitled question');
      }
      touch(); return;
    }
    var sid = t.getAttribute('data-sid'), sf = t.getAttribute('data-sf');
    if (sid && sf) { var s2 = sec(sid); if (s2) { s2[sf] = t.value; touch(); } return; }
    if (t.hasAttribute('data-oq')) {
      var oq = find(t.getAttribute('data-oq')); if (!oq) return;
      var o = oq.q.options[Number(t.getAttribute('data-oi'))]; if (o) { o.label = t.value; touch(); }
      return;
    }
    var set = t.getAttribute('data-set');
    if (set && t.type !== 'checkbox' && t.type !== 'radio' && t.type !== 'date') { S.def.settings[set] = t.value; touch(); }
  }

  function onChange(e) {
    var t = e.target;
    if (!S.def) return;
    var set = t.getAttribute('data-set');
    if (set) {
      // typed text is picked up as it is typed (no redraw, so a click on another button is never lost)
      if (t.type === 'checkbox') S.def.settings[set] = t.checked;
      else if (t.type === 'radio') { if (t.checked) S.def.settings[set] = t.value; }
      else if (t.type === 'date') S.def.settings[set] = t.value || null;
      else return;
      touch(); render(); return;
    }
    var mv = t.getAttribute('data-a-change');
    if (mv === 'move-q') { snapshot(); moveQuestion(t.getAttribute('data-qid'), t.value); touch(); render(); return; }
    var qid = t.getAttribute('data-qid'), f = t.getAttribute('data-qf'), rf = t.getAttribute('data-rf'), cur, q;
    if (qid && rf) {
      cur = find(qid); if (!cur) return; q = cur.q;
      var r = q.show_if || {};
      if (rf === 'q') {
        var src = FB.findQuestion(S.def, t.value);
        q.show_if = src ? defaultRule(src) : r;
      } else if (rf === 'op') {
        var s0 = FB.findQuestion(S.def, r.q);
        r.op = t.value;
        if (t.value === 'answered') r.v = null;
        else if (FB.sourceChoices(s0)) r.v = Array.isArray(r.v) ? r.v : [];
        else { var rg = numericRange(s0); r.v = rg ? (Number(r.v) >= rg[0] && Number(r.v) <= rg[1] ? Number(r.v) : rg[0]) : 0; }
      } else if (rf === 'v') r.v = Number(t.value);
      else if (rf === 'vv') {
        var vals = Array.isArray(r.v) ? r.v.slice() : [];
        var at = vals.indexOf(t.value);
        if (t.checked && at === -1) vals.push(t.value);
        if (!t.checked && at !== -1) vals.splice(at, 1);
        r.v = vals;
      }
      touch(); render(); return;
    }
    if (qid && f) {
      cur = find(qid); if (!cur) return; q = cur.q;
      var kind = t.getAttribute('data-kind');
      if (t.tagName !== 'SELECT' && t.type !== 'checkbox') {
        // typed text was already picked up; just keep a length limit inside its range, without a redraw
        if (kind === 'n' && (q.type === 'text' || q.type === 'longtext') && f === 'max') {
          var lo = q.type === 'text' ? 20 : 50, hi = q.type === 'text' ? 300 : 2000;
          q[f] = Math.min(hi, Math.max(lo, Number(t.value) || lo)); t.value = q[f]; touch();
        }
        return;
      }
      if (t.type === 'checkbox') q[f] = t.checked;
      else if (kind === 'n') q[f] = Number(t.value);
      else q[f] = t.value;
      if (q.type === 'scale') {
        if (q.max <= q.min) q.max = q.min + 1;
        if (!(q.min === 1 && q.max === 5) && q.style !== 'numbers') q.style = 'numbers';
      }
      if (q.type === 'multi' && f === 'allow_other' || q.type === 'multi' && f === 'max') q.max = Math.min(q.max || q.options.length, q.options.length + (q.allow_other ? 1 : 0));
      touch(); render();
    }
  }

  function onClick(e) {
    var t = e.target.closest ? e.target.closest('[data-a]') : null;
    if (!t || !root.contains(t)) return;
    var a = t.getAttribute('data-a');
    if (a === 'modal-bg') { if (e.target === t && S.modal && S.modal.kind !== 'preview') { S.modal = null; render(); } return; }
    // a click on a button inside the clickable question header is the button's, not a toggle
    if (a === 'toggle' && e.target.closest && e.target.closest('button,.fbb-drag,select,input')) return;
    var id = t.getAttribute('data-qid'), sid = t.getAttribute('data-sid'), q, cur;

    switch (a) {
      case 'edit': openForm(t.getAttribute('data-default') ? null : t.getAttribute('data-slug'), t.getAttribute('data-name'), t.getAttribute('data-date')); return;
      case 'access': var c = document.querySelector('[data-dash-section="access"]'); if (c) c.click(); return;
      case 'back':
        if (dirty() && !window.confirm('Leave this form? Your unsaved changes are kept in this browser, and you can restore them when you come back.')) return;
        S.view = 'list'; S.def = null; S.list = null; loadList(); return;
      case 'tab': S.tab = t.getAttribute('data-tab'); if (S.tab === 'history') S.hist = null; render(); return;
      case 'toggle': S.open = S.open === id ? null : id; S.bulk = null; render(); return;
      case 'up': snapshot(); step(id, -1); touch(); render(); return;
      case 'down': snapshot(); step(id, 1); touch(); render(); return;
      case 'sec-up': snapshot(); moveSection(sid, S.def.sections.map(function (s) { return s.id; }).indexOf(sid) - 1); touch(); render(); return;
      case 'sec-down': snapshot(); moveSection(sid, S.def.sections.map(function (s) { return s.id; }).indexOf(sid) + 1); touch(); render(); return;
      case 'del-sec':
        if (S.def.sections.length < 2) return;
        snapshot(); S.def.sections = S.def.sections.filter(function (s) { return s.id !== sid; });
        FB.flat(S.def).forEach(function (x) { if (x.q.show_if && !FB.findQuestion(S.def, x.q.show_if.q)) delete x.q.show_if; });
        touch(); render(); toast('Section removed', true); return;
      case 'del-q': snapshot(); removeQuestion(id); S.open = null; touch(); render(); toast('Question removed. Past answers stay in your results.', true); return;
      case 'dup-q':
        if (!room(1)) return;
        cur = find(id); if (!cur) return; snapshot();
        q = FB.clone(cur.q); q.id = FB.uid('q'); q.title = (q.title || '') + (q.title ? ' (copy)' : ''); delete q.show_if;
        cur.section.questions.splice(cur.section.questions.indexOf(cur.q) + 1, 0, q);
        S.open = q.id; touch(); render(); return;
      case 'add-q': S.modal = { kind: 'addq', sid: sid, tab: t.getAttribute('data-tab') || 'types' }; S.added = 0; render(); return;
      case 'modal-tab':
        if (!S.modal) return;
        S.modal.tab = t.getAttribute('data-tab'); S.added = 0;
        if (S.modal.kind === 'forms' && S.modal.tab === 'copy' && !S.list) { supabaseClient.rpc('feedback_forms_overview').then(function (r) { if (!r.error) S.list = r.data || []; render(); }); }
        render(); return;
      case 'close-modal': S.modal = null; render(); return;
      case 'add-sec':
        if (S.def.sections.length >= 10) { toast('A form can have up to 10 sections.'); return; }
        if (t.getAttribute('data-blank')) {
          snapshot(); S.def.sections.push({ id: FB.uid('s'), title: '', description: '', questions: [] });
          touch(); render(); focusSel = '[data-sid="' + S.def.sections[S.def.sections.length - 1].id + '"][data-sf="title"]'; render(); return;
        }
        S.modal = { kind: 'addsec' }; render(); return;
      case 'pick-type':
        if (!room(1)) return;
        snapshot(); q = addQuestion(S.modal.sid, newQuestion(t.getAttribute('data-type')));
        S.modal = null; touch(); render();
        focusSel = '[data-qid="' + q.id + '"][data-qf="title"]'; render();
        scrollToQ(q.id); return;
      case 'pick-qt':
        var item = TPL.questions[Number(t.getAttribute('data-g'))].items[Number(t.getAttribute('data-i'))];
        if (!room(1)) return;
        snapshot(); q = addQuestion(S.modal.sid, item.build()); S.added++; touch(); render(); return;
      case 'pick-sec':
        var which = t.getAttribute('data-i'), nsec;
        if (which === 'blank') nsec = { id: FB.uid('s'), title: '', description: '', questions: [] };
        else nsec = dedupe(TPL.sections[Number(which)].build(), takenCore());
        if (!room(nsec.questions.length)) return;
        snapshot(); S.def.sections.push(nsec); S.modal = null; S.open = null; touch(); render(); toast('Section added', true); return;
      case 'templates': S.modal = { kind: 'forms', tab: 'forms' }; render(); return;
      case 'use-form': replaceDef(TPL.forms[Number(t.getAttribute('data-i'))].build(), 'Template applied'); return;
      case 'copy-from':
        var other = t.getAttribute('data-default') ? null : t.getAttribute('data-slug');
        supabaseClient.rpc('feedback_form_get', { p_slug: other }).then(function (r) {
          if (r.error || !r.data || !r.data.live) { toast('Couldn’t copy that form.'); return; }
          replaceDef(FB.clone(r.data.live), 'Form copied');
        });
        return;
      case 'opt-add':
        cur = find(id); if (!cur || cur.q.options.length >= 20) return; snapshot();
        cur.q.options.push({ id: uniqueOptId(cur.q), label: '' });
        focusSel = '[data-oq="' + id + '"][data-oi="' + (cur.q.options.length - 1) + '"]'; touch(); render(); return;
      case 'opt-del':
        cur = find(id); if (!cur || cur.q.options.length <= 2) return; snapshot();
        var gone = cur.q.options.splice(Number(t.getAttribute('data-i')), 1)[0];
        // a condition that used this option no longer makes sense
        FB.flat(S.def).forEach(function (x) { var r = x.q.show_if; if (r && r.q === id && Array.isArray(r.v)) { r.v = r.v.filter(function (v) { return v !== gone.id; }); } });
        if (cur.q.type === 'multi') cur.q.max = Math.min(cur.q.max, cur.q.options.length + (cur.q.allow_other ? 1 : 0));
        touch(); render(); return;
      case 'opt-up': case 'opt-down':
        cur = find(id); if (!cur) return;
        var i = Number(t.getAttribute('data-i')), j = a === 'opt-up' ? i - 1 : i + 1;
        if (j < 0 || j >= cur.q.options.length) return;
        var tmp = cur.q.options[i]; cur.q.options[i] = cur.q.options[j]; cur.q.options[j] = tmp; touch(); render(); return;
      case 'opt-bulk': S.bulk = S.bulk === id ? null : id; render(); if (S.bulk) { var ta = root.querySelector('[data-bulk]'); if (ta) ta.focus(); } return;
      case 'opt-bulk-add':
        cur = find(id); var ta2 = root.querySelector('[data-bulk]'); if (!cur || !ta2) return;
        var lines = ta2.value.split(/\n+/).map(function (l) { return l.replace(/^[\s\-•*\d.)]+/, '').trim().slice(0, 80); }).filter(Boolean);
        if (!lines.length) return;
        snapshot();
        // a fresh question's two placeholder options are replaced rather than kept
        var untouched = cur.q.options.every(function (o) { return /^Option \d+$/.test(o.label) || !o.label; });
        if (untouched) cur.q.options = [];
        lines.forEach(function (l) { if (cur.q.options.length < 20) cur.q.options.push({ id: uniqueOptId(cur.q), label: l }); });
        while (cur.q.options.length < 2) cur.q.options.push({ id: uniqueOptId(cur.q), label: '' });
        S.bulk = null; touch(); render(); return;
      case 'rule-add':
        cur = find(id); var srcs = cur ? ruleSources(cur.q) : [];
        if (!srcs.length) return;
        cur.q.show_if = defaultRule(srcs[srcs.length - 1]); touch(); render(); return;
      case 'rule-del': cur = find(id); if (cur) { delete cur.q.show_if; touch(); render(); } return;
      case 'clear-close': S.def.settings.closes_on = null; touch(); render(); return;
      case 'save': save(); return;
      case 'publish': publishStart(); return;
      case 'publish-go': publishGo(); return;
      case 'preview': previewStart(); return;
      case 'device': S.device = t.getAttribute('data-d'); render(); return;
      case 'undo':
        if (S.undo) { S.def = JSON.parse(S.undo); S.undo = null; S.toast = ''; S.open = null; touch(); render(); }
        return;
      case 'restore-backup':
        if (S.backup) { snapshot(); S.def = FB.clone(S.backup.def); S.backup = null; touch(); render(); toast('Restored', true); }
        return;
      case 'drop-backup': clearBackup(); render(); return;
      case 'hist-restore':
        if (!window.confirm('Put this version in your draft? Your current draft will be replaced. Nothing goes live until you publish.')) return;
        supabaseClient.rpc('feedback_form_restore', { p_history_id: Number(t.getAttribute('data-id')) }).then(function (r) {
          if (r.error) { setStatus('Couldn’t restore: ' + nice(r.error.message), 'is-bad'); return; }
          var d = FB.clone(r.data); delete d.archived; d.settings = Object.assign({}, FB.DEFAULT_SETTINGS, d.settings || {});
          S.def = d; S.saved = JSON.stringify(d); S.hasDraft = true; S.tab = 'questions'; clearBackup(); render(); setStatus('Restored as your draft. Review it, then publish.', 'is-ok');
        });
        return;
      case 'discard':
        if (!window.confirm('Throw away your draft and go back to the live form?')) return;
        supabaseClient.rpc('feedback_form_discard_draft', { p_slug: S.slug }).then(function (r) {
          if (r.error) { setStatus('Couldn’t discard: ' + nice(r.error.message), 'is-bad'); return; }
          clearBackup(); reloadCurrent('Draft discarded.');
        });
        return;
      case 'reset':
        if (!window.confirm(S.slug === null ? 'Go back to the original built-in form? Past answers are kept.' : 'Make this event use the default form again? Past answers are kept.')) return;
        supabaseClient.rpc('feedback_form_reset', { p_slug: S.slug }).then(function (r) {
          if (r.error) { setStatus('Couldn’t reset: ' + nice(r.error.message), 'is-bad'); return; }
          clearBackup(); reloadCurrent('Done.');
        });
        return;
    }
  }

  function scrollToQ(id) {
    setTimeout(function () { var el = root && root.querySelector('.fbb-q[data-qid="' + id + '"]'); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
  }

  // ---- Drag and drop ------------------------------------------------------------------------------
  function onDragStart(e) {
    var h = e.target.closest ? e.target.closest('.fbb-drag') : null;
    if (!h) return;
    S.drag = { kind: h.getAttribute('data-drag'), id: h.getAttribute('data-id') };
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', S.drag.id);
      var card = h.closest(S.drag.kind === 'q' ? '.fbb-q' : '.fbb-sec');
      if (card && e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(card, 24, 20);
      if (card) setTimeout(function () { card.classList.add('is-dragging'); }, 0);
    } catch (x) { /* ignore */ }
  }
  function clearMarks() {
    Array.prototype.forEach.call(root.querySelectorAll('.drop-before,.drop-after,.drop-into'), function (n) { n.classList.remove('drop-before', 'drop-after', 'drop-into'); });
  }
  function clearDrag() { S.drag = null; if (root) { clearMarks(); Array.prototype.forEach.call(root.querySelectorAll('.is-dragging'), function (n) { n.classList.remove('is-dragging'); }); } }
  function dropTarget(e) {
    var d = S.drag; if (!d) return null;
    var y = e.clientY, el;
    if (d.kind === 'q') {
      el = e.target.closest ? e.target.closest('.fbb-q') : null;
      if (el && el.getAttribute('data-qid') !== d.id) {
        var r = el.getBoundingClientRect();
        return { el: el, before: y < r.top + r.height / 2, qid: el.getAttribute('data-qid') };
      }
      var box = e.target.closest ? e.target.closest('[data-drop-sid]') : null;
      if (box && !box.querySelector('.fbb-q:not(.is-dragging)')) return { el: box, into: true, sid: box.getAttribute('data-drop-sid') };
      var card = e.target.closest ? e.target.closest('.fbb-sec') : null;
      if (card) return { el: card, into: true, end: true, sid: card.getAttribute('data-sid') };
      return null;
    }
    el = e.target.closest ? e.target.closest('.fbb-sec') : null;
    if (el && el.getAttribute('data-sid') !== d.id) {
      var rr = el.getBoundingClientRect();
      return { el: el, before: y < rr.top + rr.height / 2, sid: el.getAttribute('data-sid') };
    }
    return null;
  }
  function onDragOver(e) {
    if (!S.drag) return;
    var tg = dropTarget(e);
    if (!tg) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch (x) { /* ignore */ }
    clearMarks();
    tg.el.classList.add(tg.into ? 'drop-into' : tg.before ? 'drop-before' : 'drop-after');
  }
  function onDrop(e) {
    var d = S.drag; if (!d) return;
    var tg = dropTarget(e);
    clearDrag();
    if (!tg) return;
    e.preventDefault();
    snapshot();
    if (d.kind === 'q') {
      if (tg.into) moveQuestion(d.id, tg.sid, tg.end ? undefined : 0);
      else {
        var dst = find(tg.qid); if (!dst) return;
        var ds = dst.section, at = ds.questions.indexOf(dst.q) + (tg.before ? 0 : 1);
        var from = find(d.id);
        if (from && from.section === ds && ds.questions.indexOf(from.q) < at) at--;
        moveQuestion(d.id, ds.id, at);
      }
    } else {
      var idx = S.def.sections.map(function (s) { return s.id; }).indexOf(tg.sid);
      var fromIdx = S.def.sections.map(function (s) { return s.id; }).indexOf(d.id);
      var to = idx + (tg.before ? 0 : 1); if (fromIdx < to) to--;
      moveSection(d.id, to);
    }
    touch(); render();
  }

  window.lacmsFeedbackBuilder = {
    mount: mount,
    isDirty: function () { return S.view === 'edit' && dirty(); }
  };
})();
