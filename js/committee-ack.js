// Dashboard: yearly committee data protection acknowledgement (migration 111)
//
// ULSU's Code of Conduct says committee members must complete data protection training before
// they are given access to personal data. Once each academic year, anyone who opens the committee
// dashboard is asked whether they have completed ULSU's training. "Yes" is recorded. "Not yet" is
// recorded too and they can carry on, but a reminder stays at the top of the dashboard until they
// confirm. If migration 111 hasn't been run, nothing is shown.

(function () {
  'use strict';
  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;
  if (!document.getElementById('dash-landing') && !document.getElementById('privacy-root')) return;

  function academicYear() {
    var d = new Date(), y = d.getFullYear();
    var start = d.getMonth() >= 8 ? y : y - 1;     // academic year starts 1 September
    return start + '/' + String((start + 1) % 100).padStart(2, '0');
  }
  var YEAR = academicYear();

  function save(status, done) {
    supabaseClient.rpc('committee_acknowledge', { p_year: YEAR, p_status: status }).then(function (r) { done(r && r.error ? r.error : null); }, function (e) { done(e); });
  }

  function reminder() {
    if (document.getElementById('cack-reminder')) return;
    var host = document.getElementById('dash-landing') || document.querySelector('main');
    if (!host) return;
    var b = document.createElement('div');
    b.id = 'cack-reminder'; b.className = 'legal-summary legal-summary--alert'; b.setAttribute('role', 'note');
    b.innerHTML = '<strong>Data protection training outstanding.</strong><p>ULSU\'s Code of Conduct says committee members should complete the Students\' Union\'s data protection training before accessing personal data. Please ask ULSU about it, and then confirm below.</p>' +
      '<p><button type="button" class="btn btn-outline btn-sm" data-cack-done>I\'ve now completed it</button></p>';
    host.parentNode.insertBefore(b, host);
    b.querySelector('[data-cack-done]').addEventListener('click', function () {
      save('completed', function (err) { if (!err) b.remove(); });
    });
  }

  function ask() {
    var m = document.createElement('div');
    m.className = 'network-modal'; m.style.display = 'flex';
    m.innerHTML = '<div class="network-modal-backdrop"></div><div class="network-modal-panel" role="dialog" aria-modal="true" aria-labelledby="cack-title" style="max-height: 90vh; overflow-y: auto;">' +
      '<h2 id="cack-title" style="margin-top:0;">Looking after members\' data (' + YEAR + ')</h2>' +
      '<p style="color: var(--color-text-muted); line-height: 1.6;">The dashboard shows members\' personal information. ULSU\'s Code of Conduct says committee members must complete the Students\' Union\'s <strong>data protection training</strong> before they are given access to personal data. Once a year we ask each committee member to confirm.</p>' +
      '<ul style="color: var(--color-text-muted); line-height: 1.6; padding-left: 1.2rem; list-style: disc;"><li>Use members\' data only to run LACMS.</li><li>Keep it confidential: don\'t share, copy or export it except as needed.</li><li>Tell the committee straight away about anything that looks like a data breach.</li></ul>' +
      '<fieldset style="border:0; padding:0; margin: var(--space-4) 0;"><legend style="position:absolute; left:-9999px;">Training</legend>' +
      '<label class="checkbox-option" style="display:flex; gap:8px; margin-bottom:8px;"><input type="radio" name="cack" value="completed"> I have completed ULSU\'s data protection training for committee members.</label>' +
      '<label class="checkbox-option" style="display:flex; gap:8px;"><input type="radio" name="cack" value="pending"> I haven\'t yet. I\'ll ask ULSU for it. (You can carry on, but you\'ll see a reminder until you\'ve done it.)</label></fieldset>' +
      '<button type="button" class="btn btn-primary btn-block" data-cack-go disabled>Continue</button>' +
      '<p class="auth-error" role="status" data-cack-err style="display:none; margin-top: var(--space-3);"></p></div>';
    document.body.appendChild(m);
    var go = m.querySelector('[data-cack-go]');
    m.addEventListener('change', function () { go.disabled = !m.querySelector('input[name=cack]:checked'); });
    go.addEventListener('click', function () {
      var status = m.querySelector('input[name=cack]:checked').value;
      go.disabled = true;
      save(status, function (err) {
        if (err) { go.disabled = false; var e = m.querySelector('[data-cack-err]'); e.textContent = err.message || 'Couldn\'t save that. Try again.'; e.style.display = 'block'; return; }
        m.remove();
        if (status === 'pending') reminder();
      });
    });
    go.focus();
  }

  supabaseClient.auth.getSession().then(function (r) {
    if (!r.data || !r.data.session) return;
    supabaseClient.rpc('committee_ack_status').then(function (res) {
      if (res.error) return;                          // migration 111 not run yet
      var d = res.data || {};
      if (d.academic_year !== YEAR) { setTimeout(ask, 1500); return; }
      if (d.training_status === 'pending') reminder();
    }, function () {});
  });
})();
