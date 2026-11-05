// Dashboard -> Unity Cup (the president, plus anyone given "Dashboard: Unity Cup" in Hub Access)
//
// Runs the Unity Cup portal (unity-cup.html): switches for voting / raffle / uploads, the player list and
// live vote counts, raffle entries (check each donation against JustGiving, then mark it verified), the live
// draw with the wheel, and the review queue for photos and videos people send in.
//
// Everything goes through the committee-only database functions (migrations 114 to 116), which check the
// same permission: the president, or a member with Hub Access to "Dashboard: Unity Cup".

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
  var wheel = null, overlay = null, lastSig = '';

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
      var sig = JSON.stringify(res.data), changed = sig !== lastSig; lastSig = sig;
      D = res.data;
      var votes = (D.players || []).reduce(function (n, p) { return n + (p.votes || 0); }, 0);
      var pending = (D.entries || []).filter(function (e) { return e.status === 'pending'; }).length + (D.media || []).filter(function (m) { return m.status === 'pending'; }).length;
      if (countEl) countEl.textContent = votes + ' votes · ' + (D.entries || []).length + ' raffle entries' + (pending ? ' · ' + pending + ' to check' : '');
      if (!quiet || (changed && !isEditing())) render();
    }, function () { loading = false; });
  }
  function isEditing() { var a = document.activeElement; return a && root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); }

  function render() {
    var pend = { raffle: (D.entries || []).filter(function (e) { return e.status === 'pending'; }).length, media: (D.media || []).filter(function (m) { return m.status === 'pending'; }).length };
    var tabs = [['setup', 'Settings'], ['teams', 'Teams'], ['players', 'Squads'], ['fixtures', 'Fixtures'], ['raffle', 'Raffle' + (pend.raffle ? ' (' + pend.raffle + ')' : '')], ['media', 'Photos & videos' + (pend.media ? ' (' + pend.media + ')' : '')]];
    root.innerHTML = '<div class="ua-top"><a class="btn btn-outline" href="unity-cup.html" target="_blank" rel="noopener">Open the public page</a><div class="ua-status">' + liveLine() + '</div></div>' +
      '<div class="ua-tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" class="ua-tab' + (tab === t[0] ? ' is-active' : '') + '" data-ua-tab="' + t[0] + '" aria-selected="' + (tab === t[0]) + '">' + esc(t[1]) + '</button>'; }).join('') + '</div>' +
      '<p class="ua-msg" data-ua-msg role="status"></p><div class="ua-pane">' + ({ setup: setupHtml, teams: teamsHtml, players: playersHtml, fixtures: fixturesHtml, raffle: raffleHtml, media: mediaHtml }[tab])() + '</div>';
    if (tab === 'media') loadThumbs();
    if (tab === 'players') sqBody();
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
  // Teams
  function teamById(id) { return (D.teams || []).filter(function (t) { return t.id === id; })[0]; }
  function teamOptions(sel, withNone) {
    return (withNone ? '<option value="">(no team)</option>' : '<option value="">Choose a team…</option>') + (D.teams || []).map(function (t) { return '<option value="' + esc(t.id) + '"' + (sel === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('');
  }
  function crestHtml(t) {
    var col = (t && t.colour) || '#d4a62b';
    return '<span class="uc-crest uc-crest--lg" style="--tc:' + esc(col) + '">' + (t && t.logo_path ? '<img src="' + esc(mediaUrl('unity-cup-gallery', t.logo_path)) + '" alt="">' : '<b>' + esc(((t && (t.short_name || t.name)) || '?').slice(0, 3).toUpperCase()) + '</b>') + '</span>';
  }
  function teamForm(t) {
    var isNew = !t, id = t ? t.id : 'new', n = t ? (D.players || []).filter(function (p) { return p.team_id === t.id; }).length : 0;
    return '<div class="ua-team" data-tid="' + esc(id) + '">' +
      '<div class="ua-team-logo">' + crestHtml(t) + '<label class="ua-file"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-tf-logo><span>' + (t && t.logo_path ? 'Change logo' : 'Add logo') + '</span></label>' +
      (t && t.logo_path ? '<label class="ua-chk"><input type="checkbox" data-tf-clear> Remove logo</label>' : '') + '</div>' +
      '<div class="ua-team-fields">' +
      '<label class="ua-field"><span>Team name</span><input data-tf="name" maxlength="40" value="' + esc(t ? t.name : '') + '" placeholder="e.g. Red Wolves"></label>' +
      '<label class="ua-field ua-field--s"><span>Short name</span><input data-tf="short" maxlength="5" value="' + esc(t && t.short_name || '') + '" placeholder="RWF"></label>' +
      '<label class="ua-field ua-field--s"><span>Colour</span><input type="color" data-tf="colour" value="' + esc(t ? t.colour : '#d4a62b') + '"></label>' +
      '<label class="ua-field ua-field--s"><span>Group (optional)</span><input data-tf="group" maxlength="20" list="ua-groups" value="' + esc(t && t.group_name || '') + '" placeholder="Group A"></label>' +
      '<label class="ua-field ua-field--wide"><span>About the team (optional)</span><input data-tf="desc" maxlength="200" value="' + esc(t && t.description || '') + '" placeholder="A line or two for the team page"></label>' +
      '</div>' + (t ? teamLinkBlock(t) : '') + (t && window.UnityPitch ? '<details class="ua-preview"><summary>Preview the line-up</summary>' + UnityPitch.html((D.players || []).filter(function (p) { return p.team_id === t.id && p.active; }), { colour: t.colour, canVote: false, title: t.name + ' line-up' }) + '<p class="ua-hint">Players are placed by their position (Goalkeeper, Defender, Midfielder, Forward). Set it in the Players tab.</p></details>' : '') + '<div class="ua-team-actions">' + (isNew ? '<button type="button" class="btn btn-primary" data-ua-save-team>Add team</button>' : '<span class="ua-hint">' + n + (n === 1 ? ' player' : ' players') + '</span><button type="button" class="btn btn-outline" data-ua-save-team>Save</button><button type="button" class="btn btn-outline sh-btn-danger" data-ua-del-team>Delete</button>') + '</div></div>';
  }
  // ---------------------------------------------------------------------
  // Private team links: a secret link per team lets its manager enter players with no account (migration 116)
  function linkFor(teamId) { return (D.team_links || []).filter(function (l) { return l.team_id === teamId; })[0]; }
  function linkUrl(l) { return new URL('unity-team.html', window.location.href).href + '#' + l.token; }
  function shareText(t, l) {
    return 'Hi! Here is your private link to enter the ' + t.name + ' line-up for the LACMS Unity Cup:\n' + linkUrl(l) +
      '\n\nAdd each player\'s name, shirt number and position, then press "Submit line-up" when you\'re done. You can come back and change things until we close it. Please don\'t share the link outside your team.';
  }
  function ago(iso) {
    if (!iso) return '';
    var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : when(iso);
  }
  function linkStatus(t, l) {
    if (!l.enabled) return '<span class="ua-pill is-off">Switched off</span>';
    var chips = [];
    var edited = l.last_edit_at && (!l.submitted_at || new Date(l.last_edit_at) > new Date(l.submitted_at));
    if (l.submitted_at && !edited) chips.push('<span class="ua-pill is-done">Submitted ' + esc(ago(l.submitted_at)) + (l.submitted_by ? ' by ' + esc(l.submitted_by) : '') + '</span>');
    else if (l.submitted_at && edited) chips.push('<span class="ua-pill is-warn">Changed after submitting ' + esc(ago(l.last_edit_at)) + '</span>');
    else if (l.last_edit_at) chips.push('<span class="ua-pill is-live">Entering players · last change ' + esc(ago(l.last_edit_at)) + '</span>');
    else if (l.last_opened_at) chips.push('<span class="ua-pill">Opened ' + esc(ago(l.last_opened_at)) + ', nothing entered yet</span>');
    else chips.push('<span class="ua-pill">Not opened yet</span>');
    return chips.join('');
  }
  function teamLinkBlock(t) {
    var l = linkFor(t.id), edits = (D.team_edits || []).filter(function (e) { return e.team_id === t.id; }).slice(0, 8);
    if (!l) return '<div class="ua-link-box" data-tid-link="' + esc(t.id) + '"><div><strong>Private team link</strong><p class="ua-hint">Let this team\'s manager enter their own players, with no login. You get a secret link to send them.</p></div><button type="button" class="btn btn-outline" data-ua-link="create">Create private link</button></div>';
    return '<div class="ua-link-box is-made" data-tid-link="' + esc(t.id) + '"><div class="ua-link-head"><strong>Private team link</strong><span class="ua-link-status">' + linkStatus(t, l) + '</span></div>' +
      '<div class="ua-link-url"><input readonly value="' + esc(linkUrl(l)) + '" aria-label="Private link for ' + esc(t.name) + '" data-ua-url><button type="button" class="btn btn-primary" data-ua-link="copy">Copy link</button></div>' +
      '<div class="ua-actions"><button type="button" class="btn btn-outline" data-ua-link="copytext">Copy a message to send</button><a class="btn btn-outline" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(shareText(t, l)) + '">WhatsApp</a>' +
      '<a class="btn btn-outline" target="_blank" rel="noopener" href="' + esc(linkUrl(l)) + '">Open it</a><button type="button" class="btn btn-outline" data-ua-link="' + (l.enabled ? 'disable' : 'enable') + '">' + (l.enabled ? 'Switch off' : 'Switch on') + '</button>' +
      '<button type="button" class="btn btn-outline sh-btn-danger" data-ua-link="regenerate">Make a new link</button></div>' +
      '<p class="ua-hint">Anyone with this link can edit this team\'s players, so send it only to the team manager. "Make a new link" stops the old one working straight away.</p>' +
      (edits.length ? '<details class="ua-changes"><summary>What the team has changed (' + edits.length + ')</summary><ul>' + edits.map(function (e) { return '<li><b>' + esc(e.action) + '</b> ' + esc(e.detail || '') + ' <small>' + esc(ago(e.at)) + '</small></li>'; }).join('') + '</ul></details>' : '') + '</div>';
  }
  function linksCard() {
    var s = D.settings, ts = D.teams || [], made = ts.filter(function (t) { return linkFor(t.id); }).length, submitted = (D.team_links || []).filter(function (l) { return l.submitted_at; }).length;
    return '<div class="ua-card"><h3>Team links</h3><p class="ua-hint">Give each team its own private link so a team manager can enter their players\' names, numbers and positions themselves, with no account or login. Create a link inside each team below (or all at once here), send it, and watch the status. <strong>' + made + ' of ' + ts.length + '</strong> teams have a link, <strong>' + submitted + '</strong> have submitted.</p>' +
      '<div class="ua-switches">' + sw('team_links_open', 'Teams can edit through their links', 'Switch off to freeze every team\'s line-up (the links then show it read-only).', s.team_links_open) + '</div>' +
      '<div class="ua-row"><label class="ua-field ua-field--s"><span>Lock all team links at (optional)</span><input type="datetime-local" data-ua-deadline value="' + esc(toLocalInput(s.team_links_deadline)) + '"></label><button type="button" class="btn btn-outline" data-ua-save-deadline>Save</button></div>' +
      '<div class="ua-actions"><button type="button" class="btn btn-outline" data-ua-link-all="create"' + (ts.length ? '' : ' disabled') + '>Create links for every team</button><button type="button" class="btn btn-outline" data-ua-link-all="copy"' + (made ? '' : ' disabled') + '>Copy every team\'s link (one message)</button></div></div>';
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? resolve() : reject(); } catch (e) { reject(e); } ta.remove();
    });
  }
  function linkAction(teamId, action, btn) {
    var t = teamById(teamId), l = linkFor(teamId);
    if (action === 'copy' || action === 'copytext') { if (!l) return; copyText(action === 'copy' ? linkUrl(l) : shareText(t, l)).then(function () { toast(action === 'copy' ? 'Link copied.' : 'Message copied. Paste it into WhatsApp or an email.'); }, function () { var inp = $('[data-ua-url]', btn.closest('[data-tid-link]')); if (inp) { inp.focus(); inp.select(); } toast('Select the link and copy it.'); }); return; }
    if (action === 'regenerate' && !window.confirm('Make a new link for ' + t.name + '? The old link stops working immediately, so you must send the new one.')) return;
    if (action === 'disable' && !window.confirm('Switch off ' + t.name + '\'s link? Whoever has it can no longer open it until you switch it back on.')) return;
    btn.disabled = true;
    supabaseClient.rpc('unity_admin_team_link', { p_team_id: teamId, p_action: action }).then(function (r) {
      btn.disabled = false;
      if (r.error) { fail(r.error); return; }
      lastSig = ''; note(action === 'create' ? 'Link created.' : action === 'regenerate' ? 'New link made. The old one no longer works.' : 'Done.'); load();
    });
  }
  function allLinks(action, btn) {
    var ts = D.teams || [];
    if (action === 'copy') {
      var text = 'LACMS Unity Cup: private team links\n\n' + ts.filter(function (t) { return linkFor(t.id); }).map(function (t) { return t.name + ': ' + linkUrl(linkFor(t.id)); }).join('\n') + '\n\nEach link is only for that team\'s manager. Please don\'t share them around.';
      copyText(text).then(function () { toast('All the links are copied.'); }); return;
    }
    btn.disabled = true;
    var chain = Promise.resolve();
    ts.forEach(function (t) { if (!linkFor(t.id)) chain = chain.then(function () { return supabaseClient.rpc('unity_admin_team_link', { p_team_id: t.id, p_action: 'create' }); }); });
    chain.then(function () { btn.disabled = false; lastSig = ''; note('Links created for every team.'); load(); });
  }

  function groupList() {
    var g = []; (D.teams || []).forEach(function (t) { if (t.group_name && g.indexOf(t.group_name) < 0) g.push(t.group_name); });
    return '<datalist id="ua-groups">' + g.concat(['Group A', 'Group B', 'Group C', 'Group D']).filter(function (x, i, a) { return a.indexOf(x) === i; }).map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>';
  }
  function teamsHtml() {
    var ts = D.teams || [];
    return groupList() + (ts.length ? linksCard() : '') + '<div class="ua-card"><h3>Add a team</h3><p class="ua-hint">Give it a name and a colour. A logo is optional: without one the page shows the team\'s initials in its colour. Put teams that play each other in the same group to get a table.</p>' + teamForm(null) + '</div>' +
      '<div class="ua-card"><h3>Teams (' + ts.length + ')</h3>' + (ts.length ? '<div class="ua-teams">' + ts.map(teamForm).join('') + '</div>' : '<p class="ua-hint">No teams yet.</p>') + '</div>';
  }
  // Logos are shrunk in the browser first (the biggest side to 512px) so pages stay fast.
  function shrinkLogo(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var sc = Math.min(1, 512 / Math.max(img.width, img.height)), cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * sc)); cv.height = Math.max(1, Math.round(img.height * sc));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        var jpeg = file.type === 'image/jpeg';
        cv.toBlob(function (b) { URL.revokeObjectURL(url); if (!b) { reject(new Error('Could not read that image.')); return; } resolve({ blob: b, ext: jpeg ? 'jpg' : 'png', type: jpeg ? 'image/jpeg' : 'image/png' }); }, jpeg ? 'image/jpeg' : 'image/png', 0.9);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file is not an image we can use.')); };
      img.src = url;
    });
  }
  function saveTeam(row, btn) {
    var id = row.getAttribute('data-tid') === 'new' ? null : row.getAttribute('data-tid'), old = id ? teamById(id) : null;
    var g = function (k) { return $('[data-tf="' + k + '"]', row).value; };
    var file = $('[data-tf-logo]', row).files[0], clear = $('[data-tf-clear]', row) && $('[data-tf-clear]', row).checked;
    if (!g('name').trim()) { note('A team needs a name.', true); return; }
    btn.disabled = true;
    var teamId;
    supabaseClient.rpc('unity_admin_save_team', { p_id: id, p_name: g('name'), p_short: g('short'), p_colour: g('colour'), p_group: g('group'), p_description: g('desc'), p_sort: id ? null : (D.teams || []).length, p_logo_path: null, p_keep_logo: true }).then(function (r) {
      if (r.error) throw r.error;
      teamId = r.data;
      if (file) {
        return shrinkLogo(file).then(function (c) {
          var path = 'teams/' + teamId + '-' + Date.now() + '.' + c.ext;
          return supabaseClient.storage.from('unity-cup-gallery').upload(path, c.blob, { contentType: c.type, upsert: false }).then(function (up) {
            if (up.error) throw up.error;
            return supabaseClient.rpc('unity_admin_save_team', { p_id: teamId, p_name: g('name'), p_short: g('short'), p_colour: g('colour'), p_group: g('group'), p_description: g('desc'), p_sort: null, p_logo_path: path, p_keep_logo: false });
          });
        }).then(function (r2) { if (r2.error) throw r2.error; if (old && old.logo_path) supabaseClient.storage.from('unity-cup-gallery').remove([old.logo_path]); });
      }
      if (clear && old && old.logo_path) {
        return supabaseClient.rpc('unity_admin_save_team', { p_id: teamId, p_name: g('name'), p_short: g('short'), p_colour: g('colour'), p_group: g('group'), p_description: g('desc'), p_sort: null, p_logo_path: null, p_keep_logo: false }).then(function (r3) { if (r3.error) throw r3.error; supabaseClient.storage.from('unity-cup-gallery').remove([old.logo_path]); });
      }
    }).then(function () { note(id ? 'Team saved.' : 'Team added.'); return load(); }).catch(function (e) { btn.disabled = false; fail(e); });
  }

  // ---------------------------------------------------------------------
  // Squads: pick a team, add players one after another, edit them in place
  var POS = [['Goalkeeper', 'GK'], ['Defender', 'DEF'], ['Midfielder', 'MID'], ['Forward', 'FWD']];
  var sqTeam = null, sqPos = null, tmpN = 0, toastTimer = null;

  function sqList(teamId) { return (D.players || []).filter(function (p) { return teamId === 'none' ? !p.team_id : p.team_id === teamId; }); }
  function nextNumber(list) { var used = {}; list.forEach(function (p) { var n = parseInt(p.shirt_no, 10); if (!isNaN(n)) used[n] = 1; }); var n = 1; while (used[n]) n++; return n; }
  function lineName(key) { return { gk: 'Goalkeeper', def: 'Defence', mid: 'Midfield', fwd: 'Attack' }[key] || 'No position yet'; }
  function sqCrest(t) { return t ? crestHtml(t).replace('uc-crest--lg', 'uc-crest--sm') : '<span class="uc-crest uc-crest--sm"><b>?</b></span>'; }

  function posOptions(cur) {
    var std = POS.map(function (x) { return x[0]; }), out = '<option value="">No position</option>';
    out += std.map(function (v) { return '<option' + (cur === v ? ' selected' : '') + '>' + v + '</option>'; }).join('');
    if (cur && std.indexOf(cur) < 0) out += '<option selected>' + esc(cur) + '</option>';
    return out;
  }

  function playersHtml() {
    var teams = D.teams || [];
    if (!teams.length) return '<div class="ua-card"><h3>Squads</h3><p class="ua-hint">Add a team first (Teams tab), then come back to add its players.</p></div>';
    if (sqTeam !== 'none' && !teamById(sqTeam)) sqTeam = teams[0].id;
    var loose = sqList('none').length;
    var chips = teams.map(function (t) {
      var n = sqList(t.id).length;
      return '<button type="button" class="sq-chip' + (sqTeam === t.id ? ' is-active' : '') + '" data-sq-team="' + esc(t.id) + '" style="--tc:' + esc(t.colour) + '">' + sqCrest(t) + '<span>' + esc(t.name) + '</span><b>' + n + '</b></button>';
    }).join('') + (loose ? '<button type="button" class="sq-chip' + (sqTeam === 'none' ? ' is-active' : '') + '" data-sq-team="none"><span class="uc-crest uc-crest--sm"><b>?</b></span><span>No team</span><b>' + loose + '</b></button>' : '');
    var votes = (D.players || []).reduce(function (n, p) { return n + (p.votes || 0); }, 0);
    return '<datalist id="ua-positions"></datalist><div class="sq-top"><div class="sq-chips" role="tablist" aria-label="Choose a team">' + chips + '</div><p class="ua-hint sq-total"><strong>' + votes + '</strong> votes from <strong>' + D.voters + '</strong> people so far</p></div>' +
      '<div class="sq" id="sq-body"></div>';
  }

  function sqBody() {
    var body = $('#sq-body'); if (!body) return;
    var t = sqTeam === 'none' ? null : teamById(sqTeam), list = sqList(sqTeam);
    if (!sqPos) sqPos = list.some(function (p) { return UnityPitch.lineOf(p.position) === 'gk'; }) ? 'Defender' : 'Goalkeeper';
    var colour = t ? t.colour : '#d4a62b';
    body.innerHTML =
      '<div class="sq-main" style="--tc:' + esc(colour) + '">' +
        '<div class="ua-card sq-add-card"><div class="sq-head">' + sqCrest(t) + '<div><h3>' + esc(t ? t.name : 'Players without a team') + '</h3><small class="ua-hint" id="sq-count"></small></div></div>' +
        (t ? '<form class="sq-add" data-sq-add novalidate><div class="sq-add-grid">' +
          '<label class="ua-field sq-name"><span>Player name</span><input name="name" autocomplete="off" autocapitalize="words" maxlength="60" placeholder="e.g. Marcus Tolliver" aria-label="Player name"></label>' +
          '<label class="ua-field sq-num"><span>Shirt no.</span><input name="num" inputmode="numeric" maxlength="3" aria-label="Shirt number"></label>' +
          '<button type="submit" class="btn btn-primary sq-submit">Add player</button></div>' +
          '<fieldset class="sq-pos"><legend>Position</legend>' + POS.map(function (x) { return '<label><input type="radio" name="pos" value="' + x[0] + '"' + (sqPos === x[0] ? ' checked' : '') + '><span>' + x[1] + '<small>' + x[0] + '</small></span></label>'; }).join('') + '<label><input type="radio" name="pos" value=""' + (sqPos === '' ? ' checked' : '') + '><span>–<small>None</small></span></label></fieldset>' +
          '<p class="sq-hint" data-sq-hint role="status" aria-live="polite">Type a name and press Enter. The next player is ready straight away.</p></form>' : '<p class="ua-hint">These players have no team. Use "Move to" on a row to give them one.</p>') + '</div>' +
        '<div id="sq-list"></div>' +
        (t ? '<details class="ua-preview sq-paste"><summary>Paste a whole list instead</summary><p class="ua-hint">One player per line: <code>Name, Number, Position</code> (number and position optional, any order after the name).</p><textarea class="ua-textarea" data-sq-bulk rows="5" placeholder="Marcus Tolliver, 7, Forward&#10;Daniel Okafor, 10, Midfielder"></textarea><button type="button" class="btn btn-outline" data-sq-paste>Add these players</button></details>' : '') +
      '</div>' +
      '<aside class="sq-side"><div class="ua-card"><h3>Line-up preview</h3><div id="sq-preview"></div></div></aside>';
    var num = $('[name="num"]', body); if (num) num.value = nextNumber(list);
    sqRefresh();
  }

  // Redraws only the list, the count and the pitch (never the add form, so what you're typing is safe).
  function sqRefresh() {
    var t = sqTeam === 'none' ? null : teamById(sqTeam), list = sqList(sqTeam);
    var cnt = $('#sq-count'); if (cnt) cnt.textContent = list.length + (list.length === 1 ? ' player' : ' players');
    $$('.sq-chip').forEach(function (c) { var id = c.getAttribute('data-sq-team'); $('b', c).textContent = sqList(id).length; });
    var groups = { gk: [], def: [], mid: [], fwd: [], none: [] };
    list.forEach(function (p) { groups[UnityPitch.lineOf(p.position) || 'none'].push(p); });
    var order = ['gk', 'def', 'mid', 'fwd', 'none'];
    var el = $('#sq-list');
    el.innerHTML = list.length ? order.filter(function (k) { return groups[k].length; }).map(function (k) {
      return '<div class="ua-card sq-group"><h4>' + lineName(k) + ' <span>' + groups[k].length + '</span></h4><div class="sq-rows">' + groups[k].sort(function (a, b) { return (parseInt(a.shirt_no, 10) || 999) - (parseInt(b.shirt_no, 10) || 999) || a.name.localeCompare(b.name); }).map(sqRow).join('') + '</div></div>';
    }).join('') : '<div class="ua-card"><p class="ua-hint">No players yet. Add the first one above.</p></div>';
    var pv = $('#sq-preview');
    if (pv) pv.innerHTML = t ? UnityPitch.html(list.filter(function (p) { return p.active; }), { colour: t.colour, canVote: false, title: t.name + ' line-up' }) : '<p class="ua-hint">Pick a team to see its line-up.</p>';
  }

  function sqRow(p) {
    var t = teamById(p.team_id), moveTo = '<select class="sq-move" data-sf="move" aria-label="Move ' + esc(p.name) + ' to another team"><option value="">Move…</option>' + (D.teams || []).filter(function (x) { return x.id !== p.team_id; }).map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>'; }).join('') + (p.team_id ? '<option value="__none">No team</option>' : '') + '</select>';
    return '<div class="sq-row' + (p.active ? '' : ' is-off') + '" data-pid="' + esc(p.id) + '" style="--tc:' + esc(t ? t.colour : '#888') + '">' +
      '<span class="sq-shirt">' + esc(p.shirt_no || '–') + '</span>' +
      '<input class="sq-in-name" data-sf="name" maxlength="60" value="' + esc(p.name) + '" aria-label="Name">' +
      '<input class="sq-in-num" data-sf="num" inputmode="numeric" maxlength="3" value="' + esc(p.shirt_no || '') + '" aria-label="Shirt number">' +
      '<select data-sf="pos" aria-label="Position">' + posOptions(p.position) + '</select>' + moveTo +
      '<label class="ua-chk sq-shown" title="Untick to hide from the public page"><input type="checkbox" data-sf="active"' + (p.active ? ' checked' : '') + '> Shown</label>' +
      '<span class="sq-votes" title="Votes">' + (p.votes || 0) + '<small> votes</small>' + (p.source === 'team' ? '<i class="sq-src" title="Added by the team through its private link">team</i>' : '') + '</span>' +
      '<button type="button" class="sq-del" data-sq-del aria-label="Remove ' + esc(p.name) + '">&times;</button><span class="sq-saved" aria-hidden="true">&#10003;</span></div>';
  }

  function hint(text, bad) { var h = $('[data-sq-hint]'); if (!h) return; h.textContent = text; h.className = 'sq-hint' + (bad ? ' is-bad' : ' is-ok'); }
  function toast(text, undo) {
    var old = document.getElementById('ua-toast'); if (old) old.remove();
    var el = document.createElement('div'); el.id = 'ua-toast'; el.className = 'ua-toast'; el.setAttribute('role', 'status');
    el.innerHTML = '<span>' + esc(text) + '</span>' + (undo ? '<button type="button">Undo</button>' : '');
    document.body.appendChild(el);
    if (undo) $('button', el).addEventListener('click', function () { el.remove(); undo(); });
    window.clearTimeout(toastTimer); toastTimer = window.setTimeout(function () { el.remove(); }, 6500);
  }
  function savePlayer(id, name, teamId, shirt, position, sort, active) {
    return supabaseClient.rpc('unity_admin_save_player', { p_id: id, p_name: name, p_team_id: teamId || null, p_shirt: shirt || null, p_position: position || null, p_sort: sort, p_active: active });
  }

  function sqAdd(form) {
    var name = form.elements.name.value.trim(), num = form.elements.num.value.trim().replace(/^#/, ''), pos = (form.querySelector('[name="pos"]:checked') || {}).value || '';
    sqPos = pos;
    if (!name) { hint('Type the player\'s name first.', true); form.elements.name.focus(); return; }
    var list = sqList(sqTeam), dup = num && list.filter(function (p) { return String(p.shirt_no) === num; })[0];
    if (dup && !window.confirm('Number ' + num + ' is already ' + dup.name + '\'s. Use it anyway?')) { form.elements.num.focus(); form.elements.num.select(); return; }
    var tmp = { id: 'tmp-' + (++tmpN), name: name, team_id: sqTeam, shirt_no: num || null, position: pos || null, votes: 0, active: true };
    D.players.push(tmp);
    sqRefresh();
    form.elements.name.value = '';
    form.elements.num.value = nextNumber(sqList(sqTeam));
    form.elements.name.focus();
    hint('Adding ' + name + '…');
    savePlayer(null, name, sqTeam, num, pos, list.length, true).then(function (r) {
      if (r.error) { D.players = D.players.filter(function (p) { return p !== tmp; }); sqRefresh(); hint('Couldn\'t add ' + name + ': ' + r.error.message, true); return; }
      var oldId = tmp.id; tmp.id = r.data; lastSig = ''; var rowEl = $('[data-pid="' + oldId + '"]'); if (rowEl) rowEl.setAttribute('data-pid', r.data); hint('Added ' + name + '. Next player?');
    }, function () { D.players = D.players.filter(function (p) { return p !== tmp; }); sqRefresh(); hint('Couldn\'t add ' + name + '. Check your connection.', true); });
  }

  function sqSaveRow(row, input) {
    var pid = row.getAttribute('data-pid'), p = (D.players || []).filter(function (x) { return x.id === pid; })[0]; if (!p || String(pid).indexOf('tmp-') === 0) return;
    var get = function (k) { return $('[data-sf="' + k + '"]', row); };
    var name = get('name').value.trim(); if (!name) { get('name').value = p.name; return; }
    var before = JSON.parse(JSON.stringify(p));
    p.name = name; p.shirt_no = get('num').value.trim().replace(/^#/, '') || null; p.position = get('pos').value || null; p.active = get('active').checked;
    var mv = get('move').value, moved = mv !== '';
    if (moved) p.team_id = mv === '__none' ? null : mv;
    var teamName = moved && p.team_id ? (teamById(p.team_id) || {}).name : '';
    savePlayer(pid, p.name, p.team_id, p.shirt_no, p.position, null, p.active).then(function (r) {
      if (r.error) { Object.assign(p, before); sqRefresh(); note(r.error.message, true); return; }
      lastSig = '';
      if (moved) { toast(p.name + (teamName ? ' moved to ' + teamName : ' now has no team')); sqRefresh(); return; }
      row.classList.add('is-saved'); window.setTimeout(function () { row.classList.remove('is-saved'); }, 1400);
      var pv = $('#sq-preview'), t = teamById(sqTeam); if (pv && t) pv.innerHTML = UnityPitch.html(sqList(sqTeam).filter(function (x) { return x.active; }), { colour: t.colour, canVote: false, title: t.name + ' line-up' });
      var sh = $('.sq-shirt', row); if (sh) sh.textContent = p.shirt_no || '–';
      if (input && (input.getAttribute('data-sf') === 'pos' || input.getAttribute('data-sf') === 'active')) sqRefresh();
    });
  }

  function sqDelete(row) {
    var pid = row.getAttribute('data-pid'), p = (D.players || []).filter(function (x) { return x.id === pid; })[0]; if (!p) return;
    if (p.votes > 0 && !window.confirm(p.name + ' has ' + p.votes + ' votes. They will be hidden (not deleted) so the count is kept. Continue?')) return;
    var copy = JSON.parse(JSON.stringify(p));
    supabaseClient.rpc('unity_admin_delete_player', { p_id: pid }).then(function (r) {
      if (r.error) { note(r.error.message, true); return; }
      lastSig = '';
      if (r.data === 'hidden') { p.active = false; sqRefresh(); toast(p.name + ' hidden (they have votes).'); return; }
      D.players = D.players.filter(function (x) { return x.id !== pid; }); sqRefresh();
      toast(p.name + ' removed.', function () {
        savePlayer(null, copy.name, copy.team_id, copy.shirt_no, copy.position, 0, copy.active).then(function (r2) { if (r2.error) note(r2.error.message, true); else load(); });
      });
    });
  }

  function sqPaste() {
    var ta = $('[data-sq-bulk]'), lines = (ta.value || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) return;
    var list = sqList(sqTeam).slice(), btn = $('[data-sq-paste]'); btn.disabled = true;
    var rows = lines.map(function (l) {
      var parts = l.split(/[,\t]/).map(function (x) { return x.trim(); }), r = { name: parts[0], num: '', pos: '' };
      parts.slice(1).forEach(function (x) { if (/^#?\d{1,3}$/.test(x)) r.num = x.replace('#', ''); else if (x) r.pos = (POS.filter(function (q) { return UnityPitch.lineOf(x) === UnityPitch.lineOf(q[0]); })[0] || [x])[0]; });
      if (!r.num) { r.num = String(nextNumber(list)); list.push({ shirt_no: r.num }); } else list.push({ shirt_no: r.num });
      return r;
    });
    var chain = Promise.resolve();
    rows.forEach(function (r, i) { chain = chain.then(function () { return savePlayer(null, r.name, sqTeam, r.num, r.pos, sqList(sqTeam).length + i, true).then(function (res) { if (res.error) throw res.error; }); }); });
    chain.then(function () { ta.value = ''; btn.disabled = false; toast(rows.length + (rows.length === 1 ? ' player added.' : ' players added.')); return load(); }).then(function () { sqBody(); }).catch(function (e) { btn.disabled = false; fail(e); load(); });
  }

  // ---------------------------------------------------------------------
  // Fixtures
  var STATUS = [['scheduled', 'Scheduled'], ['live', 'Live'], ['finished', 'Full time'], ['postponed', 'Postponed']];
  function fixtureForm(f) {
    var isNew = !f, id = f ? f.id : 'new';
    var stages = []; (D.fixtures || []).forEach(function (x) { if (x.stage && stages.indexOf(x.stage) < 0) stages.push(x.stage); });
    var sc = function (v) { return v == null ? '' : v; };
    return '<div class="ua-fx" data-fid="' + esc(id) + '"><div class="ua-fx-grid">' +
      '<label class="ua-field"><span>Home team</span><select data-ff="home">' + teamOptions(f && f.home_team_id) + '</select></label>' +
      '<label class="ua-field"><span>Away team</span><select data-ff="away">' + teamOptions(f && f.away_team_id) + '</select></label>' +
      '<label class="ua-field"><span>Round / stage</span><input data-ff="stage" maxlength="40" list="ua-stages" value="' + esc(f && f.stage || '') + '" placeholder="Group A, Semi-final…"></label>' +
      '<label class="ua-field"><span>Kick-off</span><input type="datetime-local" data-ff="kickoff" value="' + esc(toLocalInput(f && f.kickoff_at)) + '"></label>' +
      '<label class="ua-field"><span>Pitch</span><input data-ff="pitch" maxlength="30" value="' + esc(f && f.pitch || '') + '" placeholder="Pitch 1"></label>' +
      '<label class="ua-field"><span>Status</span><select data-ff="status">' + STATUS.map(function (x) { return '<option value="' + x[0] + '"' + ((f ? f.status : 'scheduled') === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>' +
      '<label class="ua-field ua-field--score"><span>Home score</span><input type="number" min="0" max="99" inputmode="numeric" data-ff="hs" value="' + esc(sc(f && f.home_score)) + '"></label>' +
      '<label class="ua-field ua-field--score"><span>Away score</span><input type="number" min="0" max="99" inputmode="numeric" data-ff="as" value="' + esc(sc(f && f.away_score)) + '"></label>' +
      '<label class="ua-field ua-field--wide"><span>Note (optional)</span><input data-ff="note" maxlength="120" value="' + esc(f && f.note || '') + '" placeholder="e.g. Won on penalties"></label></div>' +
      '<div class="ua-actions">' + (isNew ? '<button type="button" class="btn btn-primary" data-ua-save-fx>Add fixture</button>' : '<button type="button" class="btn btn-outline" data-ua-save-fx>Save</button><button type="button" class="btn btn-outline sh-btn-danger" data-ua-del-fx>Delete</button>') + '</div></div>';
  }
  function liveScoring() {
    var now = new Date(), startDay = new Date(now); startDay.setHours(0, 0, 0, 0); var endDay = new Date(startDay); endDay.setDate(endDay.getDate() + 1);
    var list = (D.fixtures || []).filter(function (f) { return f.status === 'live' || (f.status === 'scheduled' && f.kickoff_at && new Date(f.kickoff_at) >= startDay && new Date(f.kickoff_at) < endDay); });
    if (!list.length) return '';
    return '<div class="ua-card ua-card--live"><h3>Live scoring</h3><p class="ua-hint">Tap + when a goal goes in. It shows on the public page within about 15 seconds.</p><div class="ua-live-list">' + list.map(function (f) {
      var h = teamById(f.home_team_id), a = teamById(f.away_team_id); if (!h || !a) return '';
      var hs = f.home_score == null ? 0 : f.home_score, as = f.away_score == null ? 0 : f.away_score;
      function side(t, v, k) { return '<div class="ua-side">' + crestHtml(t).replace('uc-crest--lg', 'uc-crest--sm') + '<strong>' + esc(t.name) + '</strong><div class="ua-step"><button type="button" data-ua-goal="' + k + '" data-d="-1" aria-label="Minus one for ' + esc(t.name) + '">&minus;</button><b>' + v + '</b><button type="button" data-ua-goal="' + k + '" data-d="1" aria-label="Plus one for ' + esc(t.name) + '">+</button></div></div>'; }
      return '<div class="ua-live" data-fid="' + esc(f.id) + '" data-hs="' + hs + '" data-as="' + as + '"><div class="ua-live-top"><span class="ua-pill is-' + esc(f.status) + '">' + esc((STATUS.filter(function (x) { return x[0] === f.status; })[0] || [0, f.status])[1]) + '</span><small>' + esc([f.stage, f.pitch, f.kickoff_at ? new Date(f.kickoff_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''].filter(Boolean).join(' · ')) + '</small></div>' +
        '<div class="ua-live-sides">' + side(h, hs, 'h') + side(a, as, 'a') + '</div>' +
        '<div class="ua-actions">' + (f.status !== 'live' ? '<button type="button" class="btn btn-primary" data-ua-status="live">Kick off (go live)</button>' : '') + (f.status === 'live' ? '<button type="button" class="btn btn-primary" data-ua-status="finished">Full time</button>' : '') + '</div></div>';
    }).join('') + '</div></div>';
  }
  function fixturesHtml() {
    var fs = D.fixtures || [], stages = []; fs.forEach(function (x) { if (x.stage && stages.indexOf(x.stage) < 0) stages.push(x.stage); });
    var dl = '<datalist id="ua-stages">' + stages.concat(['Group A', 'Group B', 'Quarter-final', 'Semi-final', 'Final', '3rd place']).filter(function (x, i, a) { return a.indexOf(x) === i; }).map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>';
    if ((D.teams || []).length < 2) return '<div class="ua-card"><h3>Fixtures</h3><p class="ua-hint">Add at least two teams (Teams tab) first.</p></div>';
    return dl + liveScoring() + '<div class="ua-card"><h3>Add a fixture</h3>' + fixtureForm(null) + '</div>' +
      '<div class="ua-card"><h3>All fixtures (' + fs.length + ')</h3>' + (fs.length ? '<div class="ua-fx-list">' + fs.map(fixtureForm).join('') + '</div>' : '<p class="ua-hint">No fixtures yet.</p>') + '</div>';
  }
  function readFixture(row) {
    var g = function (k) { return $('[data-ff="' + k + '"]', row); }, num = function (v) { return v === '' || v == null ? null : Number(v); };
    return { stage: g('stage').value, home: g('home').value || null, away: g('away').value || null, kickoff: g('kickoff').value ? new Date(g('kickoff').value).toISOString() : null, pitch: g('pitch').value, status: g('status').value, hs: num(g('hs').value), as: num(g('as').value), note: g('note').value };
  }
  function saveFixture(row, btn) {
    var id = row.getAttribute('data-fid') === 'new' ? null : row.getAttribute('data-fid'), v = readFixture(row);
    if (!v.home || !v.away) { note('Pick both teams.', true); return; }
    if (v.home === v.away) { note('A team can\'t play itself.', true); return; }
    btn.disabled = true;
    supabaseClient.rpc('unity_admin_save_fixture', { p_id: id, p_stage: v.stage, p_home: v.home, p_away: v.away, p_kickoff: v.kickoff, p_pitch: v.pitch, p_status: v.status, p_home_score: v.hs, p_away_score: v.as, p_note: v.note, p_sort: id ? null : (D.fixtures || []).length }).then(function (r) {
      btn.disabled = false; if (r.error) { fail(r.error); return; } note(id ? 'Fixture saved.' : 'Fixture added.'); load();
    });
  }
  function setScore(fid, hs, as, status) {
    var f = (D.fixtures || []).filter(function (x) { return x.id === fid; })[0]; if (f) { f.home_score = hs; f.away_score = as; f.status = status; render(); }   // show it at once
    return supabaseClient.rpc('unity_admin_set_score', { p_id: fid, p_home_score: hs, p_away_score: as, p_status: status }).then(function (r) { if (r.error) { fail(r.error); } return load(); });
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
    var sc = t.closest('[data-sq-team]'); if (sc) { sqTeam = sc.getAttribute('data-sq-team'); $$('.sq-chip').forEach(function (c) { c.classList.toggle('is-active', c === sc); }); sqPos = null; sqBody(); return; }
    if (t.closest('[data-sq-del]')) { sqDelete(t.closest('[data-pid]')); return; }
    if (t.closest('[data-sq-paste]')) { sqPaste(); return; }
    var la = t.closest('[data-ua-link]'); if (la) { linkAction(la.closest('[data-tid-link]').getAttribute('data-tid-link'), la.getAttribute('data-ua-link'), la); return; }
    var lall = t.closest('[data-ua-link-all]'); if (lall) { allLinks(lall.getAttribute('data-ua-link-all'), lall); return; }
    if (t.closest('[data-ua-save-deadline]')) { var dv = $('[data-ua-deadline]').value; saveSettings({ team_links_deadline: dv ? new Date(dv).toISOString() : '' }); return; }
    var st = t.closest('[data-ua-save-team]'); if (st) { saveTeam(st.closest('[data-tid]'), st); return; }
    var dt = t.closest('[data-ua-del-team]');
    if (dt) {
      var trow = dt.closest('[data-tid]'), tm = teamById(trow.getAttribute('data-tid')), nfx = (D.fixtures || []).filter(function (f) { return f.home_team_id === tm.id || f.away_team_id === tm.id; }).length;
      if (!window.confirm('Delete ' + tm.name + '? ' + (nfx ? 'Its ' + nfx + (nfx === 1 ? ' fixture is' : ' fixtures are') + ' deleted too. ' : '') + 'Its players stay (without a team) so any votes are kept.')) return;
      supabaseClient.rpc('unity_admin_delete_team', { p_id: tm.id }).then(function (r) { if (r.error) { fail(r.error); return; } if (r.data) supabaseClient.storage.from('unity-cup-gallery').remove([r.data]); note('Team deleted.'); load(); });
      return;
    }
    var sf = t.closest('[data-ua-save-fx]'); if (sf) { saveFixture(sf.closest('[data-fid]'), sf); return; }
    var df = t.closest('[data-ua-del-fx]'); if (df) { if (window.confirm('Delete this fixture?')) supabaseClient.rpc('unity_admin_delete_fixture', { p_id: df.closest('[data-fid]').getAttribute('data-fid') }).then(function (r) { if (r.error) fail(r.error); else { note('Fixture deleted.'); load(); } }); return; }
    var gl = t.closest('[data-ua-goal]');
    if (gl) { var lv = gl.closest('[data-fid]'), hs = Number(lv.getAttribute('data-hs')), as = Number(lv.getAttribute('data-as')), d = Number(gl.getAttribute('data-d')); if (gl.getAttribute('data-ua-goal') === 'h') hs = Math.max(0, Math.min(99, hs + d)); else as = Math.max(0, Math.min(99, as + d)); var fx0 = (D.fixtures || []).filter(function (x) { return x.id === lv.getAttribute('data-fid'); })[0]; setScore(lv.getAttribute('data-fid'), hs, as, fx0 && fx0.status === 'scheduled' ? 'live' : (fx0 ? fx0.status : 'live')); return; }
    var ss = t.closest('[data-ua-status]');
    if (ss) { var lv2 = ss.closest('[data-fid]'); setScore(lv2.getAttribute('data-fid'), Number(lv2.getAttribute('data-hs')), Number(lv2.getAttribute('data-as')), ss.getAttribute('data-ua-status')); return; }
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

  root.addEventListener('submit', function (e) { if (e.target.closest('[data-sq-add]')) { e.preventDefault(); sqAdd(e.target.closest('[data-sq-add]')); } });
  root.addEventListener('change', function (e) {
    if (e.target.name === 'pos' && e.target.closest('[data-sq-add]')) { sqPos = e.target.value; return; }
    var f = e.target.closest('[data-sf]'); if (!f) return;
    sqSaveRow(f.closest('[data-pid]'), f);
  });
  root.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.closest('.sq-row') && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') { e.preventDefault(); e.target.blur(); } });
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-ua-draw-close]')) closeDraw(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && overlay) closeDraw(); });

  // load when the card is opened, then refresh the numbers every 10 seconds while the panel is showing
  var panel = document.getElementById('dash-panel-unity');
  function visible() { return panel && panel.style.display !== 'none'; }
  var card = document.querySelector('[data-dash-section="unity"]');
  if (card) card.addEventListener('click', function () { load(); });
  supabaseClient.auth.getSession().then(function (r) {
    if (!r.data || !r.data.session) return;
    supabaseClient.rpc('unity_can_manage').then(function (p) {
      if (p.error || p.data !== true) { if (card) card.style.display = 'none'; return; }
      load(true);
    });
  });
  timer = window.setInterval(function () { if (visible() && !overlay && !document.hidden) load(true); }, 10000);
})();
