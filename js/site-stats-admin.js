// President's "Site Numbers" section on the dashboard.
//
// The headline numbers on the public pages (active members, mentors, events a
// year, founded, the impact card) are read live from the site_settings table
// (see js/members.js). This is the form for changing them, so it never takes
// a code change or a redeploy. Saving upserts the changed rows; clearing a box
// deletes its row, which puts the page back to the wording written in the HTML
// (for the active member count, which has no default, it hides the figure).
//
// Who can change them is enforced in the database (the site_settings policy
// only lets is_president() write); this file just renders and sends.
(function () {
  'use strict';

  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;
  var panel = document.getElementById('dash-panel-sitestats');
  if (!panel) return;

  var fieldsEl = document.getElementById('sitestats-fields');
  var form = document.getElementById('sitestats-form');
  var saveBtn = document.getElementById('sitestats-save');
  var savedEl = document.getElementById('sitestats-saved');
  var statusEl = document.getElementById('sitestats-status');
  var card = document.querySelector('[data-dash-section="sitestats"]');
  var countEl = document.getElementById('dash-count-sitestats');

  // key, label, where it shows, and the wording the page falls back to.
  var STATS = [
    { key: 'active_member_count', label: 'Active members', where: 'Home page and About page', fallback: '', note: 'Hidden on the website until it has a number.', toggle: 'show_active_member_count' },
    { key: 'stat_mentors', label: 'Professional mentors', where: 'Home page and About page', fallback: '30+' },
    { key: 'stat_events_per_year', label: 'Events per year', where: 'Home page and About page', fallback: '10+' },
    { key: 'stat_founded', label: 'Founded', where: 'Home page and About page', fallback: '2026' },
    { key: 'impact_students', label: 'Students (Our Impact card)', where: 'Home page', fallback: '100+' },
    { key: 'impact_disciplines', label: 'Disciplines (Our Impact card)', where: 'Home page', fallback: '7' },
    { key: 'impact_professionals', label: 'Professionals (Our Impact card)', where: 'Home page', fallback: '30+' }
  ];
  var saved = {};   // key -> { value, updated_at }
  var loaded = false;

  function esc(str) {
    return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function showStatus(message) {
    statusEl.textContent = message || '';
    statusEl.style.display = message ? 'block' : 'none';
  }
  function ago(iso) {
    var mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (isNaN(mins)) return '';
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var h = Math.floor(mins / 60);
    if (h < 24) return h + ' hr ago';
    var d = Math.floor(h / 24);
    return d < 30 ? d + (d === 1 ? ' day ago' : ' days ago') : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function render() {
    fieldsEl.innerHTML = STATS.map(function (s) {
      var row = saved[s.key];
      var toggleRow = s.toggle ? saved[s.toggle] : null;
      var showOn = !s.toggle || !toggleRow || String(toggleRow.value).toLowerCase() !== 'false';
      return '<div class="sitestats-row" data-key="' + s.key + '">' +
        '<div class="sitestats-label"><label for="ss-' + s.key + '">' + esc(s.label) + '</label><small>' + esc(s.where) + (s.note ? ' &middot; ' + esc(s.note) : '') + '</small></div>' +
        '<div class="sitestats-input">' +
          '<input type="text" id="ss-' + s.key + '" maxlength="12" autocomplete="off" inputmode="text" value="' + esc(row ? row.value : '') + '" placeholder="' + esc(s.fallback ? 'Default: ' + s.fallback : 'Not set') + '" data-orig="' + esc(row ? row.value : '') + '">' +
          (row ? '<small class="sitestats-meta">Updated ' + esc(ago(row.updated_at)) + '</small>' : '<small class="sitestats-meta">' + (s.fallback ? 'Using the default wording' : 'Not showing') + '</small>') +
        '</div>' +
        (s.toggle ? '<label class="res-switch sitestats-toggle"><input type="checkbox" role="switch" id="ss-' + s.toggle + '"' + (showOn ? ' checked' : '') + ' data-orig="' + (showOn ? '1' : '0') + '"><span class="res-switch-track" aria-hidden="true"><span class="res-switch-thumb"></span></span><span class="res-switch-text"><strong>Show on the website</strong></span></label>' : '') +
        '</div>';
    }).join('');
    updateDirty();
  }

  function dirty() {
    var changed = [];
    STATS.forEach(function (s) {
      var input = document.getElementById('ss-' + s.key);
      if (input && input.value.trim() !== input.getAttribute('data-orig')) changed.push(s.key);
      if (s.toggle) {
        var t = document.getElementById('ss-' + s.toggle);
        if (t && (t.checked ? '1' : '0') !== t.getAttribute('data-orig')) changed.push(s.toggle);
      }
    });
    return changed;
  }
  function updateDirty() { saveBtn.disabled = !loaded || dirty().length === 0; }

  function load() {
    return supabaseClient.from('site_settings').select('key, value, updated_at').then(function (res) {
      if (res.error) { showStatus("Couldn't load the numbers: " + res.error.message); return false; }
      saved = {};
      (res.data || []).forEach(function (row) { saved[row.key] = row; });
      loaded = true;
      showStatus('');
      render();
      var set = STATS.filter(function (s) { return saved[s.key] && String(saved[s.key].value).trim(); }).length;
      if (countEl) countEl.textContent = set + ' of ' + STATS.length + ' customised';
      return true;
    });
  }

  fieldsEl.addEventListener('input', updateDirty);
  fieldsEl.addEventListener('change', updateDirty);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var keys = dirty();
    if (!keys.length) return;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    var upserts = [];
    var deletes = [];
    var now = new Date().toISOString();
    keys.forEach(function (key) {
      var isToggle = STATS.some(function (s) { return s.toggle === key; });
      if (isToggle) {
        var on = document.getElementById('ss-' + key).checked;
        // "On" is the default, so it's stored only when switched off.
        if (on) deletes.push(key); else upserts.push({ key: key, value: 'false', updated_at: now });
        return;
      }
      var v = document.getElementById('ss-' + key).value.trim();
      if (v) upserts.push({ key: key, value: v, updated_at: now }); else deletes.push(key);
    });
    var jobs = [];
    if (upserts.length) jobs.push(supabaseClient.from('site_settings').upsert(upserts, { onConflict: 'key' }));
    if (deletes.length) jobs.push(supabaseClient.from('site_settings').delete().in('key', deletes));
    Promise.all(jobs).then(function (results) {
      saveBtn.textContent = 'Save changes';
      var err = results.filter(function (r) { return r.error; })[0];
      if (err) { showStatus("Couldn't save: " + err.error.message); updateDirty(); return; }
      showStatus('');
      try { localStorage.removeItem('lacms-site-stats'); } catch (e2) { /* ignore */ }
      return load().then(function () {
        savedEl.textContent = 'Saved - the website shows this now.';
        savedEl.hidden = false;
        setTimeout(function () { savedEl.hidden = true; }, 5000);
      });
    }, function () { saveBtn.textContent = 'Save changes'; showStatus("Couldn't reach the server - try again."); updateDirty(); });
  });

  // Load when the card is opened (or the page is opened straight to #sitestats).
  if (card) card.addEventListener('click', function () { if (!loaded) load(); });
  if ((window.location.hash || '') === '#sitestats') load();
})();
