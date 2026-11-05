// Dashboard -> Unity Cup (president only)
//
// Runs the Unity Cup portal (unity-cup.html): switches for voting / raffle / uploads, the player list and
// live vote counts, raffle entries (check each donation against JustGiving, then mark it verified), the live
// draw with the wheel, and the review queue for photos and videos people send in.
//
// Everything goes through the committee-only database functions in migration 114.

(function () {
  'use strict';

  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;
  var root = document.getElementById('unity-root');
  if (!root) return;
  var countEl = document.getElementById('dash-count-unity');

  var D = null;               // last unity_admin_get() result
  var tab = 'setup';
  var timer = null;
  var loading = false;
  var wheel = null, overlay = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, el) { return (el || root).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || root).querySelectorAll(sel)); }
  function when(iso) { try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function toLocalInput(iso) { if (!iso) return ''; var d = new Date(iso); if (isNaN(d)) return ''; var p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function note(text, bad) { var el = $('[data-ua-msg]'); if (!el) return; el.textContent = text || ''; el.className = 'ua-msg' + (text ? (bad ? ' is-bad' : ' is-ok') : ''); if (text) window.setTimeout(function () { if (el.textContent === text) { el.textContent = ''; el.className = 'ua-msg'; } }, 6000); }
  function fail(err) { note((err && err.message) || 'Something went wrong. Is migration 114 run?', true); }
  function mediaUrl(bucket, path) { return supabaseClient.storage.from(bucket).getPublicUrl(path).data.publicUrl; }

  // ---------------------------------------------------------------------
  function load(quiet) {
    if (loading) return Promise.resolve();
    loading = true;
    return supabaseClient.rpc('unity_admin_get').then(function (res) {
      loading = false;
      if (res.error || !res.data) {
        if (!D) root.innerHTML = '<p class="ua-msg is-bad">Couldn\'t load the Unity Cup panel. ' + esc(res.error && res.error.message || '') + ' Run <code>db/migrations/114-unity-cup.sql</code> if you haven\'t yet.</p>';
        return;
      }
      D = res.data;
      var votes = (D.players || []).reduce(function (n, p) { return n + (p.votes || 0); }, 0);
      var pending = (D.entries || []).filter(function (e) { return e.status === 'pending'; }).length + (D.media || []).filter(function (m) { return m.status === 'pending'; }).length;
      if (countEl) countEl.textContent = votes + ' votes · ' + (D.entries || []).length + ' raffle entries' + (pending ? ' · ' + pending + ' to check' : '');
      if (!quiet || !isEditing()) render();
    }, function () { loading = false; });
  }
  function isEditing() { var a = document.activeElement; return a && root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); }

  function render() {
    var pend = { raffle: (D.entries || []).filter(function (e) { return e.status === 'pending'; }).length, media: (D.media || []).filter(function (m) { return m.status === 'pending'; }).length };
    var tabs = [['setup', 'Settings'], ['players', 'Players & votes'], ['raffle', 'Raffle' + (pend.raffle ? ' (' + pend.raffle + ')' : '')], ['media', 'Photos & videos' + (pend.media ? ' (' + pend.media + ')' : '')]];
    root.innerHTML = '<div class="ua-top"><a class="btn btn-outline" href="unity-cup.html" target="_blank" rel="noopener">Open the public page</a><div class="ua-live">' + liveLine() + '</div></div>' +
      '<div class="ua-tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" class="ua-tab' + (tab === t[0] ? ' is-active' : '') + '" data-ua-tab="' + t[0] + '" aria-selected="' + (tab === t[0]) + '">' + esc(t[1]) + '</button>'; }).join('') + '</div>' +
      '<p class="ua-msg" data-ua-msg role="status"></p><div class="ua-pane">' + ({ setup: setupHtml, players: playersHtml, raffle: raffleHtml, media: mediaHtml }[tab])() + '</div>';
    if (tab === 'media') loadThumbs();
  }

  function liveLine() {
    var s = D.settings;
    return '<span class="ua-dot ' + (s.voting_open ? 'is-on' : '') + '"></span>Voting ' + (s.voting_open ? 'open' : 'closed') + ' <span class="ua-dot ' + (s.raffle_open ? 'is-on' : '') + '"></span>Raffle ' + (s.raffle_open ? 'open' : 'closed') + ' <span class="ua-dot ' + (s.media_open ? 'is-on' : '') + '"></span>Uploads ' + (s.media_open ? 'open' : 'closed');
  }

  // ---------------------------------------------------------------------
  // Settings
  function sw(key, label, hint, checked) {
    return '<label class="ua-switch"><input type="checkbox" data-ua-set="' + key + '"' + (checked ? ' checked' : '') + '><span class="ua-track"><i></i></span><span class="ua-switch-text"><strong>' + esc(label) + '</strong><small>' + esc(hint) + '</small></span></label>';
  }
  function setupHtml() {
    var s = D.settings;
    return '<div class="ua-card"><h3>Go live</h3><div class="ua-switches">' +
      sw('voting_open', 'Voting is open', 'People can vote for Player of the Tournament.', s.voting_open) +
      sw('show_results', 'Show results to everyone', 'Turn on at the end to reveal the winner. Leave off while voting.', s.show_results) +
      sw('raffle_open', 'Raffle entries are open', 'People can enter the raffle after donating.', s.raffle_open) +
      sw('media_open', 'Photo and video uploads are open', 'Everything is reviewed by you before it shows publicly.', s.media_open) +
      '</div></div>' +
      '<div class="ua-card"><h3>Details shown on the page</h3><div class="ua-grid">' +
      field('Event date', '<input type="date" data-ua-f="event_date" value="' + esc(s.event_date) + '">') +
      field('Kick-off / time (optional)', '<input data-ua-f="kickoff_text" maxlength="60" placeholder="e.g. Kick-off 12:00" value="' + esc(s.kickoff_text || '') + '">') +
      field('Venue (optional)', '<input data-ua-f="venue_text" maxlength="60" placeholder="e.g. Lincoln Sports Centre" value="' + esc(s.venue_text || '') + '">') +
      field('Voting closes automatically at (optional)', '<input type="datetime-local" data-ua-f="voting_closes_at" value="' + esc(toLocalInput(s.voting_closes_at)) + '">') +
      field('Raffle closes automatically at (optional)', '<input type="datetime-local" data-ua-f="raffle_closes_at" value="' + esc(toLocalInput(s.raffle_closes_at)) + '">') +
      field('Prize', '<input data-ua-f="prize_text" maxlength="60" value="' + esc(s.prize_text) + '">') +
      field('Minimum donation (£)', '<input type="number" step="0.01" min="0" data-ua-f="min_donation" value="' + esc(s.min_donation) + '">') +
      field('JustGiving link', '<input type="url" data-ua-f="justgiving_url" value="' + esc(s.justgiving_url) + '">') +
      '</div><button type="button" class="btn btn-primary" data-ua-save-settings>Save details</button></div>' +
      '<div class="ua-card ua-card--warn"><h3>Email check</h3>' +
      sw('require_email_code', 'Email a code before voting or entering', 'Keeps voting fair. Only switch this off if the emails stop arriving: one vote per address still applies, but fake addresses become possible.', s.require_email_code) +
      '</div>' +
      '<div class="ua-card"><h3>Tidy up</h3><p class="ua-hint">After the event: delete raffle names and emails and the "who voted" list (kept to stop double voting), and old unreviewed uploads. Done automatically 30 days after the event date if you run it then.</p>' +
      '<div class="ua-row"><button type="button" class="btn btn-outline" data-ua-purge>Clean up old data</button><button type="button" class="btn btn-outline sh-btn-danger" data-ua-reset>Clear all votes (testing)</button></div></div>';
  }
  function field(label, input) { return '<label class="ua-field"><span>' + esc(label) + '</span>' + input + '</label>'; }

  function saveSettings(patch) {
    return supabaseClient.rpc('unity_admin_save_settings', { p: patch }).then(function (res) {
      if (res.error) { fail(res.error); return false; }
      note('Saved.'); return load();
    });
  }

  // ---------------------------------------------------------------------
  // Players
  function playersHtml() {
    var ps = D.players || [], total = ps.reduce(function (n, p) { return n + (p.votes || 0); }, 0), max = Math.max.apply(null, ps.map(function (p) { return p.votes || 0; }).concat([1]));
    return '<div class="ua-card"><h3>Votes so far: <span class="ua-big">' + total + '</span> <small>(' + D.voters + ' people voted)</small></h3>' +
      (ps.length ? '<div class="ua-players">' + ps.map(function (p) {
        return '<div class="ua-player' + (p.active ? '' : ' is-off') + '" data-pid="' + esc(p.id) + '"><div class="ua-player-edit">' +
          '<input data-pf="name" maxlength="60" value="' + esc(p.name) + '" aria-label="Name"><input data-pf="team" maxlength="60" placeholder="Team" value="' + esc(p.team || '') + '" aria-label="Team"><input data-pf="shirt" maxlength="6" placeholder="#" value="' + esc(p.shirt_no || '') + '" aria-label="Shirt number">' +
          '<label class="ua-chk"><input type="checkbox" data-pf="active"' + (p.active ? ' checked' : '') + '> Shown</label>' +
          '<button type="button" class="btn btn-outline" data-ua-save-player>Save</button><button type="button" class="btn btn-outline sh-btn-danger" data-ua-del-player>Remove</button></div>' +
          '<div class="ua-bar"><span style="width:' + Math.round((p.votes || 0) / max * 100) + '%"></span><b>' + (p.votes || 0) + '</b></div></div>';
      }).join('') + '</div>' : '<p class="ua-hint">No players yet. Add them below.</p>') + '</div>' +
      '<div class="ua-card"><h3>Add players</h3><p class="ua-hint">One per line: <code>Name, Team, Shirt number</code> (team and number are optional).</p>' +
      '<textarea class="ua-textarea" data-ua-bulk rows="6" placeholder="Marcus Tolliver, Red Wolves, 7&#10;Daniel Okafor, Blue Hawks, 10"></textarea>' +
      '<button type="button" class="btn btn-primary" data-ua-add-players>Add these players</button></div>';
  }
  function savePlayer(id, name, team, shirt, sort, active) {
    return supabaseClient.rpc('unity_admin_save_player', { p_id: id, p_name: name, p_team: team, p_shirt: shirt, p_sort: sort, p_active: active });
  }

  // ---------------------------------------------------------------------
  // Raffle
  function raffleHtml() {
    var es = D.entries || [], ver = es.filter(function (e) { return e.status === 'verified'; }).length, pend = es.filter(function (e) { return e.status === 'pending'; }).length;
    var drawable = es.filter(function (e) { return e.status === 'verified' && !e.won; }).length;
    var draws = (D.draws || []).filter(function (d) { return !d.voided_at; });
    return '<div class="ua-card"><h3>Draw</h3><p class="ua-hint"><strong>' + ver + '</strong> verified (' + drawable + ' still eligible), <strong>' + pend + '</strong> waiting for you to check. Only verified entries go in the draw.</p>' +
      '<div class="ua-row"><button type="button" class="btn btn-primary btn-glow" data-ua-draw' + (drawable ? '' : ' disabled') + '>Open the live draw</button><a class="ua-link" href="' + esc(D.settings.justgiving_url) + '" target="_blank" rel="noopener">Open JustGiving donations</a></div>' +
      (draws.length ? '<h4>Winners</h4><ul class="ua-winners">' + draws.map(function (d) {
        var e = es.filter(function (x) { return x.id === d.entry_id; })[0] || {};
        return '<li><span class="ua-ticket">#' + esc(d.ticket_no) + '</span><span><strong>' + esc(e.name || d.display_name) + '</strong> ' + (e.email ? '<a href="mailto:' + esc(e.email) + '">' + esc(e.email) + '</a>' : '') + '<small> ' + esc(d.prize) + ' · ' + when(d.drawn_at) + '</small></span><button type="button" class="btn btn-outline" data-ua-void="' + esc(d.id) + '">Void</button></li>';
      }).join('') + '</ul>' : '') + '</div>' +
      '<div class="ua-card"><h3>Entries</h3>' + (es.length ? '<p class="ua-hint">Check each against the JustGiving donation list (name, amount), then verify or reject.</p><div class="ua-table-wrap"><table class="ua-table"><thead><tr><th>#</th><th>Name / email</th><th>Donated as</th><th>Said</th><th>Status</th><th></th></tr></thead><tbody>' + es.map(function (e) {
        return '<tr class="is-' + esc(e.status) + '" data-eid="' + esc(e.id) + '"><td><span class="ua-ticket">#' + esc(e.ticket_no) + '</span></td><td><strong>' + esc(e.name) + '</strong><br><a href="mailto:' + esc(e.email) + '">' + esc(e.email) + '</a></td><td>' + esc(e.donor_name || '—') + '</td><td>£' + esc(Number(e.amount).toFixed(2)) + '</td><td>' + esc(e.won ? 'won' : e.status) + '</td>' +
          '<td><div class="ua-actions"><button type="button" class="btn btn-outline" data-ua-entry="verified"' + (e.status === 'verified' ? ' disabled' : '') + '>Verify</button><button type="button" class="btn btn-outline sh-btn-danger" data-ua-entry="rejected"' + (e.status === 'rejected' ? ' disabled' : '') + '>Reject</button></div></td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="ua-hint">No entries yet.</p>') + '</div>';
  }

  // The live draw: a full-screen wheel. The result is picked by the database; the wheel just shows it.
  function openDraw() {
    var tickets = (D.entries || []).filter(function (e) { return e.status === 'verified' && !e.won; }).map(function (e) { return e.ticket_no; });
    if (!tickets.length) return;
    overlay = document.createElement('div');
    overlay.className = 'ua-draw';
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', 'Live raffle draw');
    overlay.innerHTML = '<button type="button" class="ua-draw-x" data-ua-draw-close aria-label="Close">&times;</button>' +
      '<div class="ua-draw-inner"><p class="ua-draw-kicker">Unity Cup raffle</p><h2 class="ua-draw-title">' + esc(D.settings.prize_text) + '</h2>' +
      '<div class="uc-wheel-wrap ua-draw-wheel"><div class="uc-wheel-lights" aria-hidden="true"></div><div class="uc-pointer" aria-hidden="true"></div><canvas id="ua-wheel" class="uc-wheel"></canvas></div>' +
      '<div class="ua-draw-result" id="ua-draw-result" aria-live="polite"></div>' +
      '<div class="ua-draw-actions"><button type="button" class="uc-btn uc-btn--gold" id="ua-spin">Spin the wheel</button><button type="button" class="uc-btn uc-btn--ghost" id="ua-void" hidden>Void this winner and draw again</button></div></div>';
    document.body.appendChild(overlay);
    document.body.classList.add('uc-modal-open');
    wheel = UnityWheel.create($('#ua-wheel', overlay));
    wheel.setTickets(tickets);
    var current = null;
    $('#ua-spin', overlay).addEventListener('click', function () {
      var btn = this; btn.disabled = true; $('#ua-draw-result', overlay).innerHTML = '';
      $('#ua-void', overlay).hidden = true;
      supabaseClient.rpc('unity_admin_draw').then(function (res) {
        if (res.error || !res.data || !res.data.ok) { $('#ua-draw-result', overlay).textContent = res.data && res.data.error === 'no_entries' ? 'No verified entries left to draw.' : ((res.error && res.error.message) || 'The draw failed.'); btn.disabled = false; return; }
        current = res.data;
        return wheel.spinTo(current.ticket_no, 7000).then(function () {
          $('#ua-draw-result', overlay).innerHTML = '<div class="ua-win"><span>Winning ticket</span><b>#' + esc(current.ticket_no) + '</b><strong>' + esc(current.name) + '</strong><a href="mailto:' + esc(current.email) + '">' + esc(current.email) + '</a></div>';
          if (window.UnityFx) UnityFx.confetti({ z: 11000, count: 220 });
          btn.disabled = false; btn.textContent = 'Draw another winner';
          $('#ua-void', overlay).hidden = false;
          // drop the winner from the wheel for the next draw
          tickets = tickets.filter(function (t) { return t !== current.ticket_no; });
          if (!tickets.length) btn.disabled = true;
        });
      });
    });
    $('#ua-void', overlay).addEventListener('click', function () {
      if (!current) return;
      supabaseClient.rpc('unity_admin_void_draw', { p_id: current.draw_id }).then(function () {
        tickets.push(current.ticket_no); tickets.sort(function (a, b) { return a - b; }); wheel.setTickets(tickets);
        $('#ua-draw-result', overlay).textContent = 'Winner voided. Spin again.'; $('#ua-void', overlay).hidden = true; $('#ua-spin', overlay).disabled = false; $('#ua-spin', overlay).textContent = 'Spin the wheel'; current = null;
      });
    });
  }
  function closeDraw() {
    if (!overlay) return;
    overlay.remove(); overlay = null; wheel = null; document.body.classList.remove('uc-modal-open');
    load();
  }

  // ---------------------------------------------------------------------
  // Media
  function mediaHtml() {
    var ms = D.media || [], pend = ms.filter(function (m) { return m.status === 'pending'; }), appr = ms.filter(function (m) { return m.status === 'approved'; });
    return '<div class="ua-card"><h3>To review (' + pend.length + ')</h3>' + (pend.length ? '<div class="ua-media">' + pend.map(mediaCard).join('') + '</div>' : '<p class="ua-hint">Nothing waiting. New uploads show up here.</p>') + '</div>' +
      '<div class="ua-card"><h3>On the public page (' + appr.length + ')</h3>' + (appr.length ? '<div class="ua-media">' + appr.map(mediaCard).join('') + '</div>' : '<p class="ua-hint">Approved photos and videos appear on the Unity Cup page.</p>') + '</div>';
  }
  function mediaCard(m) {
    var isVideo = m.kind === 'video';
    return '<div class="ua-mcard" data-mid="' + esc(m.id) + '" data-status="' + esc(m.status) + '"><div class="ua-thumb" data-thumb="' + esc(m.status === 'approved' ? m.public_path : m.storage_path) + '" data-bucket="' + (m.status === 'approved' ? 'unity-cup-gallery' : 'unity-cup-uploads') + '" data-kind="' + esc(m.kind) + '">' + (isVideo ? '<span>Video</span>' : '<span>Loading…</span>') + '</div>' +
      '<div class="ua-mmeta">' + (m.caption ? '<p>' + esc(m.caption) + '</p>' : '') + (m.credit ? '<small>' + esc(m.credit) + '</small>' : '') + '<small>' + when(m.created_at) + '</small></div>' +
      '<div class="ua-actions">' + (m.status === 'pending' ? '<button type="button" class="btn btn-primary" data-ua-approve>Approve</button><button type="button" class="btn btn-outline sh-btn-danger" data-ua-reject>Reject</button>' : '<button type="button" class="btn btn-outline sh-btn-danger" data-ua-unpublish>Remove</button>') + '</div></div>';
  }
  function loadThumbs() {
    $$('.ua-thumb').forEach(function (el) {
      var path = el.getAttribute('data-thumb'), bucket = el.getAttribute('data-bucket'), kind = el.getAttribute('data-kind');
      if (!path) return;
      var p = bucket === 'unity-cup-gallery' ? Promise.resolve({ data: { signedUrl: mediaUrl(bucket, path) } }) : supabaseClient.storage.from(bucket).createSignedUrl(path, 3600);
      p.then(function (r) {
        var url = r.data && r.data.signedUrl; if (!url) return;
        el.innerHTML = kind === 'video' ? '<video src="' + esc(url) + '#t=0.1" controls preload="metadata" playsinline></video>' : '<a href="' + esc(url) + '" target="_blank" rel="noopener"><img src="' + esc(url) + '" alt="" loading="lazy"></a>';
      });
    });
  }
  function approve(id, btn) {
    var m = (D.media || []).filter(function (x) { return x.id === id; })[0]; if (!m) return;
    btn.disabled = true; btn.textContent = 'Publishing…';
    var ext = (m.storage_path.match(/\.([a-z0-9]+)$/i) || [, 'jpg'])[1].toLowerCase(), dest = m.id + '.' + ext;
    supabaseClient.storage.from('unity-cup-uploads').download(m.storage_path).then(function (dl) {
      if (dl.error) throw dl.error;
      return supabaseClient.storage.from('unity-cup-gallery').upload(dest, dl.data, { contentType: dl.data.type, upsert: true });
    }).then(function (up) {
      if (up.error) throw up.error;
      return supabaseClient.rpc('unity_admin_set_media', { p_id: id, p_status: 'approved', p_public_path: dest });
    }).then(function (r) {
      if (r.error) throw r.error;
      supabaseClient.storage.from('unity-cup-uploads').remove([m.storage_path]);
      note('Published.'); return load();
    }).catch(function (e) { btn.disabled = false; btn.textContent = 'Approve'; fail(e); });
  }
  function dropMedia(id, alsoGallery) {
    return supabaseClient.rpc('unity_admin_delete_media', { p_id: id }).then(function (r) {
      if (r.error) throw r.error;
      var u = r.data && r.data.uploads, g = r.data && r.data.gallery;
      if (u) supabaseClient.storage.from('unity-cup-uploads').remove([u]);
      if (g) supabaseClient.storage.from('unity-cup-gallery').remove([g]);
      return load();
    }).catch(fail);
  }

  // ---------------------------------------------------------------------
  root.addEventListener('click', function (e) {
    var t = e.target;
    var tb = t.closest('[data-ua-tab]'); if (tb) { tab = tb.getAttribute('data-ua-tab'); render(); return; }
    if (t.closest('[data-ua-save-settings]')) {
      var p = {};
      $$('[data-ua-f]').forEach(function (el) {
        var k = el.getAttribute('data-ua-f'), v = el.value;
        if (k === 'voting_closes_at' || k === 'raffle_closes_at') p[k] = v ? new Date(v).toISOString() : '';
        else if (k === 'min_donation') p[k] = Number(v);
        else p[k] = v;
      });
      saveSettings(p); return;
    }
    if (t.closest('[data-ua-add-players]')) {
      var lines = ($('[data-ua-bulk]').value || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      if (!lines.length) return;
      var base = (D.players || []).length;
      Promise.all(lines.map(function (l, i) { var parts = l.split(',').map(function (x) { return x.trim(); }); return savePlayer(null, parts[0], parts[1] || null, (parts[2] || '').replace(/^#/, '') || null, base + i, true); })).then(function (rs) {
        var bad = rs.filter(function (r) { return r.error; })[0];
        if (bad) fail(bad.error); else note(lines.length + (lines.length === 1 ? ' player' : ' players') + ' added.');
        load();
      });
      return;
    }
    var sp = t.closest('[data-ua-save-player]');
    if (sp) {
      var row = sp.closest('[data-pid]'), get = function (k) { return $('[data-pf="' + k + '"]', row); };
      savePlayer(row.getAttribute('data-pid'), get('name').value, get('team').value, get('shirt').value, null, get('active').checked).then(function (r) { if (r.error) fail(r.error); else { note('Saved.'); load(); } });
      return;
    }
    var dp = t.closest('[data-ua-del-player]');
    if (dp) {
      var prow = dp.closest('[data-pid]'), pname = $('[data-pf="name"]', prow).value;
      if (!window.confirm('Remove ' + pname + '? If they already have votes they are hidden instead, so the count is kept.')) return;
      supabaseClient.rpc('unity_admin_delete_player', { p_id: prow.getAttribute('data-pid') }).then(function (r) { if (r.error) fail(r.error); else { note(r.data === 'hidden' ? 'Hidden (they have votes).' : 'Removed.'); load(); } });
      return;
    }
    var en = t.closest('[data-ua-entry]');
    if (en) {
      var er = en.closest('[data-eid]'), st = en.getAttribute('data-ua-entry'), nt = null;
      if (st === 'rejected') { nt = window.prompt('Why? (kept with the entry, e.g. "no donation found")', 'No matching donation found'); if (nt === null) return; }
      supabaseClient.rpc('unity_admin_set_entry', { p_id: er.getAttribute('data-eid'), p_status: st, p_note: nt }).then(function (r) { if (r.error) fail(r.error); else load(); });
      return;
    }
    if (t.closest('[data-ua-draw]')) { openDraw(); return; }
    var vd = t.closest('[data-ua-void]');
    if (vd) { if (!window.confirm('Void this winner? They go back into the draw pool.')) return; supabaseClient.rpc('unity_admin_void_draw', { p_id: vd.getAttribute('data-ua-void') }).then(function () { load(); }); return; }
    var ap = t.closest('[data-ua-approve]'); if (ap) { approve(ap.closest('[data-mid]').getAttribute('data-mid'), ap); return; }
    var rj = t.closest('[data-ua-reject]'); if (rj) { if (window.confirm('Reject and delete this upload?')) dropMedia(rj.closest('[data-mid]').getAttribute('data-mid')); return; }
    var up = t.closest('[data-ua-unpublish]'); if (up) { if (window.confirm('Remove this from the public page and delete it?')) dropMedia(up.closest('[data-mid]').getAttribute('data-mid')); return; }
    if (t.closest('[data-ua-purge]')) {
      var force = window.confirm('Clean up now?\n\nThis deletes old codes and old unreviewed uploads.\n\nPress OK, and you will then be asked whether to also delete ALL raffle entries and the voted-list (only do that once the raffle is finished and the winner has been contacted).');
      if (!force) return;
      var all = window.confirm('Also delete ALL raffle entries (names and emails) and the voted-list now?\n\nOK = delete them. Cancel = keep them (they are cleared automatically 30 days after the event if you run this again then).');
      supabaseClient.rpc('unity_purge', { p_force: all }).then(function (r) {
        if (r.error) { fail(r.error); return; }
        var files = (r.data && r.data.files) || []; if (files.length) supabaseClient.storage.from('unity-cup-uploads').remove(files);
        note('Cleaned up' + (all ? ' (entries and voter list deleted).' : '.')); load();
      });
      return;
    }
    if (t.closest('[data-ua-reset]')) {
      var word = window.prompt('This sets every player to 0 votes and forgets who has voted. Type RESET to confirm.');
      if (word !== 'RESET') return;
      supabaseClient.rpc('unity_admin_reset_votes').then(function (r) { if (r.error) fail(r.error); else { note('All votes cleared.'); load(); } });
    }
  });

  root.addEventListener('change', function (e) {
    var sw = e.target.closest('[data-ua-set]');
    if (!sw) return;
    var key = sw.getAttribute('data-ua-set'), p = {}; p[key] = sw.checked;
    if (key === 'require_email_code' && !sw.checked && !window.confirm('Switch OFF the emailed code? Anyone can then vote with any made-up address (still one vote per address). Only do this if emails are not arriving.')) { sw.checked = true; return; }
    if (key === 'show_results' && sw.checked && D.settings.voting_open && !window.confirm('Voting is still open. Show the results to everyone now?')) { sw.checked = false; return; }
    saveSettings(p);
  });

  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-ua-draw-close]')) closeDraw(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && overlay) closeDraw(); });

  // load when the card is opened, then refresh the numbers every 10 seconds while the panel is showing
  var panel = document.getElementById('dash-panel-unity');
  function visible() { return panel && panel.style.display !== 'none'; }
  var card = document.querySelector('[data-dash-section="unity"]');
  if (card) card.addEventListener('click', function () { load(); });
  supabaseClient.auth.getSession().then(function (r) {
    if (!r.data || !r.data.session) return;
    supabaseClient.rpc('is_president').then(function (p) {
      if (p.error || p.data !== true) { if (card) card.style.display = 'none'; return; }
      load(true);
    });
  });
  timer = window.setInterval(function () { if (visible() && !overlay && !document.hidden) load(true); }, 10000);
})();
