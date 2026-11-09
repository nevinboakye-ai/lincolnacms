// Dashboard -> LACMS Wrapped (the president, plus anyone given "Dashboard: LACMS Wrapped" in Hub Access)
//
// Runs the Wrapped vote (wrapped.html): open / close it, reveal the results, watch the tallies come in, change the
// questions and the answers people can pick, export the results, and tidy up afterwards.
// Everything goes through the committee-only database functions in migration 133, which check the same permission.

(function () {
  'use strict';

  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;
  var root = document.getElementById('wrapped-root');
  if (!root) return;
  var countEl = document.getElementById('dash-count-wrapped');

  var D = null, tab = 'overview', loading = false, lastSig = '';
  try { var st = window.sessionStorage.getItem('lacms-wa-tab'); if (st && /^(overview|results|questions)$/.test(st)) tab = st; } catch (e) { /* ignore */ }
  var KINDS = { write_in: 'Type an answer', choice: 'Pick one', multi: 'Pick several', rating: 'Rate 1 to 10' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, el) { return (el || root).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || root).querySelectorAll(sel)); }
  function toLocalInput(iso) { if (!iso) return ''; var d = new Date(iso); if (isNaN(d)) return ''; var p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function note(text, bad) { var el = $('[data-wa-msg]'); if (!el) return; el.textContent = text || ''; el.className = 'ua-msg' + (text ? (bad ? ' is-bad' : ' is-ok') : ''); if (text) window.setTimeout(function () { if (el.textContent === text) { el.textContent = ''; el.className = 'ua-msg'; } }, 6000); }
  function fail(err) { note((err && err.message) || 'Something went wrong. Has migration 133 been run?', true); }
  function field(label, input, wide) { return '<label class="ua-field' + (wide ? ' ua-field--wide' : '') + '"><span>' + esc(label) + '</span>' + input + '</label>'; }
  function sw(key, label, hint, checked) {
    return '<label class="ua-switch"><input type="checkbox" data-wa-set="' + key + '"' + (checked ? ' checked' : '') + '><span class="ua-track"><i></i></span><span class="ua-switch-text"><strong>' + esc(label) + '</strong><small>' + esc(hint) + '</small></span></label>';
  }
  function pageUrl() { try { return new URL('wrapped.html', window.location.href).href; } catch (e) { return 'wrapped.html'; } }

  // ---------------------------------------------------------------------
  function load(quiet) {
    if (loading) return Promise.resolve();
    loading = true;
    return supabaseClient.rpc('wrapped_admin_get').then(function (res) {
      loading = false;
      if (res.error || !res.data || !res.data.ok) {
        if (!D) root.innerHTML = '<div class="ua-card ua-card--warn"><h3>LACMS Wrapped isn\'t set up in the database yet</h3><p class="ua-hint">' + esc(res.error && res.error.message || '') + '</p><p class="ua-hint">In Supabase, open <strong>SQL Editor</strong> and run <code>db/migrations/133-lacms-wrapped.sql</code> (it needs migrations 114 and 116 run first). Then reload this page.</p></div>';
        if (countEl) countEl.textContent = 'Not set up yet';
        return;
      }
      var sig = JSON.stringify(res.data), changed = sig !== lastSig; lastSig = sig;
      D = res.data;
      if (countEl) countEl.textContent = D.ballots.total + ' vote' + (D.ballots.total === 1 ? '' : 's') + ' · ' + (D.campaign.is_open_now ? 'open' : 'closed');
      if (!quiet || (changed && !isEditing())) render();
    }, function () { loading = false; });
  }
  function isEditing() { var a = document.activeElement; return a && root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); }

  function render() {
    var tabs = [['overview', 'Overview'], ['results', 'Results'], ['questions', 'Questions']];
    var c = D.campaign;
    root.innerHTML = '<div class="ua-top"><a class="btn btn-outline" href="wrapped.html" target="_blank" rel="noopener">Open the vote page</a><div class="ua-status"><span class="ua-dot ' + (c.is_open_now ? 'is-on' : '') + '"></span>Voting ' + (c.is_open_now ? 'open' : 'closed') +
      ' <span class="ua-dot ' + (c.show_results ? 'is-on' : '') + '"></span>Results ' + (c.show_results ? 'public' : 'hidden') + '</div></div>' +
      '<div class="ua-tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" class="ua-tab' + (tab === t[0] ? ' is-active' : '') + '" data-wa-tab="' + t[0] + '" aria-selected="' + (tab === t[0]) + '">' + esc(t[1]) + '</button>'; }).join('') + '</div>' +
      '<p class="ua-msg" data-wa-msg role="status"></p><div class="ua-pane">' + ({ overview: overviewHtml, results: resultsHtml, questions: questionsHtml }[tab])() + '</div>';
  }

  // ---------------------------------------------------------------------
  // Overview
  function stat(n, label) { return '<div class="wa-stat"><b>' + n + '</b><span>' + esc(label) + '</span></div>'; }
  function overviewHtml() {
    var c = D.campaign, b = D.ballots;
    var closesNote = c.closes_at && c.open ? (c.is_open_now ? 'It closes by itself at the time below.' : 'It closed by itself at the time below.') : '';
    return '<div class="ua-card"><h3>Votes so far</h3><div class="wa-stats">' + stat(b.total, 'votes in') + stat(b.member, 'members') + stat(b.not_member, 'not members') + stat(b.unsure, 'not sure') + '</div>' +
      '<p class="ua-hint">One vote per email address. Answers are saved without a name or an email, so a vote can\'t be traced back to a person.</p></div>' +
      '<div class="ua-card"><h3>Go live</h3><div class="ua-switches">' +
      sw('open', 'Voting is open', 'People can vote on the Wrapped page. The promo on the welcome screen and homepage shows while this is on. ' + closesNote, c.open) +
      sw('show_results', 'Show results to everyone', 'Leave off while people are voting. Turn on when you are ready to reveal what won.', c.show_results) +
      '</div></div>' +
      '<div class="ua-card"><h3>Details shown on the page</h3><div class="ua-grid">' +
      field('Title', '<input data-wa-f="title" maxlength="60" value="' + esc(c.title) + '">') +
      field('Subtitle (e.g. Semester One)', '<input data-wa-f="subtitle" maxlength="60" value="' + esc(c.subtitle || '') + '">') +
      field('Voting closes automatically at (optional)', '<input type="datetime-local" data-wa-f="closes_at" value="' + esc(toLocalInput(c.closes_at)) + '">') +
      field('Events count from', '<input type="date" data-wa-f="events_from" value="' + esc(c.events_from || '') + '">') +
      field('Events count up to', '<input type="date" data-wa-f="events_to" value="' + esc(c.events_to || '') + '">') +
      field('Welcome message (optional, 300 characters)', '<textarea class="ua-textarea" data-wa-f="intro" maxlength="300" rows="3" placeholder="Shown on the first screen">' + esc(c.intro || '') + '</textarea>', true) +
      '</div><p class="ua-hint">The "favourite event" question lists the events on the website that took place between the two dates above (today at the latest).</p>' +
      '<button type="button" class="btn btn-primary" data-wa-save-campaign>Save details</button></div>' +
      '<div class="ua-card"><h3>Share the link</h3><div class="ua-row"><input class="wa-link" readonly value="' + esc(pageUrl()) + '" aria-label="Link to the vote page"><button type="button" class="btn btn-outline" data-wa-copy>Copy link</button></div></div>' +
      '<div class="ua-card"><h3>Export and tidy up</h3>' +
      '<p class="ua-hint">After voting closes, "Forget emails" removes the scrambled email codes (' + b.with_email + ' still stored). The answers stay: they were never linked to a person. Do this once you have your results.</p>' +
      '<div class="ua-row"><button type="button" class="btn btn-outline" data-wa-csv>Download results (CSV)</button>' +
      '<button type="button" class="btn btn-outline" data-wa-tidy' + (c.is_open_now ? ' disabled title="Close voting first"' : '') + '>Forget emails</button>' +
      '<button type="button" class="btn btn-outline sh-btn-danger" data-wa-reset>Clear all votes (testing)</button></div></div>';
  }

  // ---------------------------------------------------------------------
  // Results
  function resultsHtml() {
    if (!D.ballots.total) return '<div class="ua-card"><h3>No votes yet</h3><p class="ua-hint">Results appear here as people vote. They refresh by themselves every few seconds.</p></div>';
    return D.categories.filter(function (k) { return k.tally; }).map(function (k) {
      var t = k.tally, h = '<div class="ua-card"><h3>' + (k.emoji ? esc(k.emoji) + ' ' : '') + esc(k.title) + (k.active ? '' : ' <span class="ua-pill">hidden from voters</span>') + '</h3><p class="ua-hint">' + esc(k.prompt) + ' · ' + t.answered + ' answered</p>';
      if (k.kind === 'rating') {
        if (t.avg == null) return h + '<p class="ua-hint">No ratings yet.</p></div>';
        var max = 1, i, rows = '';
        for (i = 1; i <= 10; i++) max = Math.max(max, Number((t.dist || {})[i] || 0));
        for (i = 10; i >= 1; i--) { var n = Number((t.dist || {})[i] || 0); rows += '<div class="wa-dist"><span>' + i + '</span><div class="ua-bar"><span style="width:' + Math.round(n / max * 100) + '%"></span><b>' + n + '</b></div></div>'; }
        return h + '<p class="wa-avg"><b>' + Number(t.avg).toFixed(2) + '</b> average out of 10</p>' + rows + '</div>';
      }
      var items = t.items || [];
      if (!items.length) return h + '<p class="ua-hint">No answers yet.</p></div>';
      var top = items[0].votes || 1;
      return h + '<ol class="wa-rank">' + items.map(function (it, n) {
        return '<li><span class="wa-pos">' + (n + 1) + '</span><div class="wa-bar"><div class="wa-bar-top"><strong>' + esc(it.label) + '</strong><b>' + it.votes + '</b></div><div class="ua-bar"><span style="width:' + Math.max(3, Math.round(it.votes / top * 100)) + '%"></span></div></div></li>';
      }).join('') + '</ol>' + (k.kind === 'write_in' || k.allow_other ? '<p class="ua-hint">Typed answers are grouped when they match exactly, ignoring capital letters. Look through the list for the same name spelt two ways and add the votes together.</p>' : '') + '</div>';
    }).join('');
  }

  function csv() {
    var rows = [['Question', 'Answer', 'Votes']];
    D.categories.forEach(function (k) {
      var t = k.tally; if (!t) return;
      if (k.kind === 'rating') { rows.push([k.title, 'Average (out of 10)', t.avg == null ? '' : t.avg]); Object.keys(t.dist || {}).sort(function (a, b) { return a - b; }).forEach(function (r) { rows.push([k.title, 'Rated ' + r, t.dist[r]]); }); }
      else (t.items || []).forEach(function (it) { rows.push([k.title, it.label, it.votes]); });
    });
    rows.push([]); rows.push(['Votes in', D.ballots.total]); rows.push(['Members', D.ballots.member]); rows.push(['Not members', D.ballots.not_member]); rows.push(['Not sure', D.ballots.unsure]);
    var text = rows.map(function (r) { return r.map(function (v) { v = String(v == null ? '' : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = 'lacms-wrapped-results.csv';
    document.body.appendChild(a); a.click(); a.remove(); window.setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  // ---------------------------------------------------------------------
  // Questions
  function questionsHtml() {
    var cards = D.categories.map(function (k) {
      var isList = (k.kind === 'choice' || k.kind === 'multi') && k.option_source === 'list';
      var isEvents = (k.kind === 'choice' || k.kind === 'multi') && k.option_source === 'events';
      var h = '<div class="ua-card wa-q" data-wa-cat="' + esc(k.id) + '"><div class="wa-q-head"><h3>' + (k.emoji ? esc(k.emoji) + ' ' : '') + esc(k.title) + '</h3><span class="ua-pill">' + esc(KINDS[k.kind] || k.kind) + '</span></div>' +
        '<div class="ua-grid">' +
        field('Title', '<input data-wa-q="title" maxlength="60" value="' + esc(k.title) + '">') +
        field('Emoji', '<input data-wa-q="emoji" maxlength="8" value="' + esc(k.emoji || '') + '">') +
        field('The question people see', '<input data-wa-q="prompt" maxlength="200" value="' + esc(k.prompt) + '">', true);
      if (k.kind === 'write_in') h += field('Hint inside the box', '<input data-wa-q="placeholder" maxlength="80" value="' + esc(k.placeholder || '') + '">');
      if (k.kind === 'multi') h += field('Most people can pick', '<input type="number" min="1" max="10" data-wa-q="max_picks" value="' + esc(k.max_picks) + '">');
      h += '</div><div class="ua-switches">' +
        sw('active', 'Show this question', 'Turn off to hide it from the vote without losing its answers.', k.active).replace('data-wa-set', 'data-wa-q') +
        ((k.kind === 'choice' || k.kind === 'multi') ? sw('allow_other', 'Let people type their own answer', 'Adds a "Something else…" option.', k.allow_other).replace('data-wa-set', 'data-wa-q') : '') + '</div>';
      if (isList) {
        h += '<h4>Answers to pick from</h4><ul class="wa-opts">' + k.options.map(function (o) {
          return '<li data-wa-opt="' + esc(o.id) + '"><input data-wa-olabel maxlength="80" value="' + esc(o.label) + '" aria-label="Answer"><label class="wa-chk"><input type="checkbox" data-wa-oactive' + (o.active ? ' checked' : '') + '> shown</label><button type="button" class="btn btn-outline sh-btn-danger" data-wa-odel>Remove</button></li>';
        }).join('') + '</ul><div class="ua-row"><input class="wa-new" data-wa-onew maxlength="80" placeholder="Add an answer" aria-label="New answer"><button type="button" class="btn btn-outline" data-wa-oadd>Add</button></div>';
      } else if (isEvents) {
        h += '<h4>Answers to pick from</h4><p class="ua-hint">These come from the Events on the website that took place in the date range under Overview.</p>' +
          ((k.event_options || []).length ? '<ul class="wa-evs">' + k.event_options.map(function (o) { return '<li>' + esc(o.label) + (o.date ? ' <small>' + esc(o.date) + '</small>' : '') + '</li>'; }).join('') + '</ul>' : '<p class="ua-hint"><strong>No events in that range yet.</strong> Check the dates under Overview and that your events have a start date.</p>');
      }
      h += '<div class="ua-row"><button type="button" class="btn btn-primary" data-wa-qsave>Save question</button><button type="button" class="btn btn-outline sh-btn-danger" data-wa-qdel>Delete question</button></div></div>';
      return h;
    }).join('');
    return cards +
      '<div class="ua-card"><h3>Add a question</h3><div class="ua-grid">' +
      field('Title', '<input data-wa-new-title maxlength="60" placeholder="e.g. Best dressed">') +
      field('Type', '<select data-wa-new-kind>' + Object.keys(KINDS).map(function (k) { return '<option value="' + k + '">' + esc(KINDS[k]) + '</option>'; }).join('') + '</select>') +
      field('The question people see', '<input data-wa-new-prompt maxlength="200" placeholder="e.g. Who was the best dressed at our events?">', true) +
      '</div><p class="ua-hint">After adding a "pick one" or "pick several" question, add its answers in the card that appears.</p><button type="button" class="btn btn-primary" data-wa-qadd>Add question</button></div>';
  }

  // ---------------------------------------------------------------------
  function rpc(fn, args, ok) {
    return supabaseClient.rpc(fn, args).then(function (res) {
      if (res.error) { fail(res.error); return false; }
      if (ok) note(ok);
      return load().then(function () { return true; });
    }, function () { note('Could not reach the server. Try again.', true); return false; });
  }
  function toggled(el) { return !!el.checked; }

  root.addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t || t.disabled) return;
    if (t.hasAttribute('data-wa-tab')) { tab = t.getAttribute('data-wa-tab'); try { window.sessionStorage.setItem('lacms-wa-tab', tab); } catch (x) { /* ignore */ } render(); return; }
    if (t.hasAttribute('data-wa-save-campaign')) {
      var p = {};
      $$('[data-wa-f]').forEach(function (el) {
        var k = el.getAttribute('data-wa-f'), v = el.value;
        if (k === 'closes_at') v = v ? new Date(v).toISOString() : '';
        p[k] = v;
      });
      if (!(p.title || '').trim()) { note('Give it a title.', true); return; }
      rpc('wrapped_admin_save_campaign', { p: p }, 'Saved.'); return;
    }
    if (t.hasAttribute('data-wa-copy')) {
      var inp = $('.wa-link'); if (!inp) return;
      var done = function () { note('Link copied.'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(inp.value).then(done, function () { inp.select(); });
      else { inp.select(); try { document.execCommand('copy'); done(); } catch (x) { /* selected, they can copy it */ } }
      return;
    }
    if (t.hasAttribute('data-wa-csv')) { csv(); return; }
    if (t.hasAttribute('data-wa-tidy')) {
      if (!window.confirm('Remove the scrambled email codes from every vote? The answers stay. After this, nobody can be stopped from voting again, so only do it once voting is closed.')) return;
      supabaseClient.rpc('wrapped_admin_tidy').then(function (res) { if (res.error) { fail(res.error); return; } note('Done. Removed ' + res.data + ' email code' + (res.data === 1 ? '' : 's') + '.'); load(); });
      return;
    }
    if (t.hasAttribute('data-wa-reset')) {
      var typed = window.prompt('This deletes every vote so far and cannot be undone. Use it to clear test votes before going live.\n\nType RESET to confirm.');
      if (typed !== 'RESET') { if (typed != null) note('Nothing was deleted: you needed to type RESET.', true); return; }
      rpc('wrapped_admin_reset', {}, 'All votes cleared.'); return;
    }
    var card = t.closest('[data-wa-cat]'), id = card && card.getAttribute('data-wa-cat');
    if (t.hasAttribute('data-wa-qsave')) {
      var q = {};
      $$('[data-wa-q]', card).forEach(function (el) {
        var k = el.getAttribute('data-wa-q');
        q[k] = el.type === 'checkbox' ? toggled(el) : (k === 'max_picks' ? Number(el.value) || 3 : el.value);
      });
      if (!(q.title || '').trim() || !(q.prompt || '').trim()) { note('Give the question a title and some text.', true); return; }
      rpc('wrapped_admin_save_category', { p_id: id, p: q }, 'Question saved.'); return;
    }
    if (t.hasAttribute('data-wa-qdel')) {
      if (!window.confirm('Delete this question and every answer people gave to it? To keep the answers, turn "Show this question" off instead.')) return;
      rpc('wrapped_admin_delete_category', { p_id: id }, 'Question deleted.'); return;
    }
    if (t.hasAttribute('data-wa-oadd')) {
      var ni = $('[data-wa-onew]', card); var label = ni && ni.value.trim();
      if (!label) { note('Type the answer first.', true); return; }
      rpc('wrapped_admin_save_option', { p_category: id, p_id: null, p_label: label, p_active: true }, 'Answer added.'); return;
    }
    if (t.hasAttribute('data-wa-odel')) {
      if (!window.confirm('Remove this answer? Votes for it are removed too. To keep the votes, untick "shown" instead.')) return;
      rpc('wrapped_admin_delete_option', { p_id: t.closest('[data-wa-opt]').getAttribute('data-wa-opt') }, 'Answer removed.'); return;
    }
    if (t.hasAttribute('data-wa-qadd')) {
      var title = ($('[data-wa-new-title]').value || '').trim(), prompt = ($('[data-wa-new-prompt]').value || '').trim(), kind = $('[data-wa-new-kind]').value;
      if (!title || !prompt) { note('Add a title and the question people will see.', true); return; }
      rpc('wrapped_admin_save_category', { p_id: null, p: { title: title, prompt: prompt, kind: kind } }, 'Question added. Scroll up to see it.'); return;
    }
  });

  root.addEventListener('change', function (e) {
    var t = e.target;
    if (t.hasAttribute('data-wa-set')) {
      var p = {}; p[t.getAttribute('data-wa-set')] = toggled(t);
      rpc('wrapped_admin_save_campaign', { p: p }, 'Saved.'); return;
    }
    var row = t.closest('[data-wa-opt]');
    if (row && (t.hasAttribute('data-wa-olabel') || t.hasAttribute('data-wa-oactive'))) {
      var card = t.closest('[data-wa-cat]');
      var label = $('[data-wa-olabel]', row).value.trim();
      if (!label) { note('An answer can\'t be empty. Use Remove to delete it.', true); load(); return; }
      rpc('wrapped_admin_save_option', { p_category: card.getAttribute('data-wa-cat'), p_id: row.getAttribute('data-wa-opt'), p_label: label, p_active: $('[data-wa-oactive]', row).checked }, 'Saved.');
    }
  });

  // refresh the numbers while the panel is on screen and nobody is typing
  window.setInterval(function () { if (root.offsetParent !== null && !document.hidden) load(true); }, 15000);
  load();
})();
