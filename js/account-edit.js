// Edit (or remove) an account's details from anywhere the president sees people:
// Dashboard -> Manage accounts and the Network page. One shared pop-up for the three
// account types (LACMS member, Network professional, MMG guest).
//
// What it can change is decided by the database (the same rules as Manage accounts:
// the president, or anyone given the Manage Accounts tile in Hub Access) - this only
// draws the form. Removing an account deletes the profile row only; the login itself
// can only be deleted in Supabase's Authentication page.
//
//   window.lacmsAccountEdit.open('member' | 'professional' | 'mmg', id, onChange)
(function () {
  'use strict';

  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;
  if (window.lacmsAccountEdit) return;

  function showMessage(el, message) {
    if (!el) return;
    el.textContent = message;
    el.style.display = 'block';
  }
  function hideMessage(el) {
    if (!el) return;
    el.style.display = 'none';
  }
  function notifyChanged() {
    if (typeof changeCallback === 'function') { try { changeCallback(); } catch (e) { /* the caller's refresh must never break the pop-up */ } }
  }

  var YEAR_WORD_TO_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
  function normalizeYearOfStudy(raw) {
    raw = (raw || '').trim();
    if (!raw) return '';
    var lower = raw.toLowerCase();
    var digitMatch = /(\d+)/.exec(lower);
    if (digitMatch) return 'Year ' + parseInt(digitMatch[1], 10);
    var wordMatch = /\b(one|two|three|four|five|six|seven)\b/.exec(lower);
    if (wordMatch) return 'Year ' + YEAR_WORD_TO_NUM[wordMatch[1]];
    return raw;
  }

  // ---- Account edit modal — one shared modal (built once, on first
  // use) covering all three account types, since only one is ever
  // being edited at a time. Deleting here only ever removes the
  // profile row (members/network_professionals/mmg_guests) — the
  // underlying auth.users login can't be deleted from the browser
  // without the service-role admin API, which this page will never
  // have access to (see §59's Create Account for the same boundary).
  // The person just loses their profile, exactly as if their row had
  // been deleted from Table Editor directly. ----
  var currentEditType = null;
  var currentEditId = null;
  var currentEditRow = null;
  var changeCallback = null;

  function buildAccountEditModal() {
    if (document.getElementById('account-edit-modal')) return;
    var modal = document.createElement('div');
    modal.id = 'account-edit-modal';
    modal.className = 'network-modal';
    modal.style.display = 'none';
    modal.innerHTML =
      '<div class="network-modal-backdrop" data-account-edit-close></div>' +
      '<div class="network-modal-panel network-modal-panel--wide">' +
      '<button type="button" class="network-modal-close" data-account-edit-close aria-label="Close">' +
      '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>' +
      '</button>' +
      '<h2 id="account-edit-title" style="margin-top:0;">Edit account</h2>' +
      '<p id="account-edit-subtitle" style="color: var(--color-text-faint); font-size: 0.85rem; margin-top: -10px;">&nbsp;</p>' +
      '<form id="account-edit-form">' +

      '<div class="field"><label for="edit-name">Full name</label><input type="text" id="edit-name" required></div>' +

      '<div data-edit-fields="member" style="display:none;">' +
      '<div class="field"><label for="edit-member-course">Course</label><input type="text" id="edit-member-course" list="edit-course-options"></div>' +
      '<div class="field"><label for="edit-member-year">Year of study</label><input type="text" id="edit-member-year" placeholder="e.g. Year 2, Foundation Doctor"></div>' +
      '<div class="field"><label for="edit-member-student-number">Student number <span style="font-weight:400; color: var(--color-text-faint);">(optional)</span></label><input type="text" id="edit-member-student-number"></div>' +
      '<div class="field"><label for="edit-member-status">Membership status</label><select id="edit-member-status"><option value="active">Active</option><option value="expired">Expired</option><option value="pending">Pending</option></select></div>' +
      '<div class="field"><label for="edit-member-type">Member type</label><select id="edit-member-type">' +
      '<option value="member">Member</option><option value="supporting_committee">Supporting committee</option><option value="executive_committee">Executive committee</option><option value="senior_sankofa_mentor">Senior Sankofa mentor</option><option value="junior_sankofa_mentor">Junior Sankofa mentor</option>' +
      '</select></div>' +
      '<div class="field"><label for="edit-member-role">Committee role <span style="font-weight:400; color: var(--color-text-faint);">(optional)</span></label><input type="text" id="edit-member-role"></div>' +
      '<div class="field">' +
      '<label class="checkbox-option"><input type="checkbox" id="edit-member-sankofa">Sankofa eligible</label>' +
      '<label class="checkbox-option"><input type="checkbox" id="edit-member-mmg-attendee">MMG attendee</label>' +
      '<label class="checkbox-option"><input type="checkbox" id="edit-member-mmg-committee">MMG committee</label>' +
      '</div>' +
      '</div>' +

      '<div data-edit-fields="professional" style="display:none;">' +
      '<div class="field"><label for="edit-pro-email">Email</label><input type="email" id="edit-pro-email"></div>' +
      '<div class="field"><label for="edit-pro-title">Title</label><input type="text" id="edit-pro-title"></div>' +
      '<div class="field"><label for="edit-pro-organisation">Organisation <span style="font-weight:400; color: var(--color-text-faint);">(optional)</span></label><input type="text" id="edit-pro-organisation"></div>' +
      '<div class="field"><label for="edit-pro-category">Category</label><select id="edit-pro-category"><option value="senior_doctor">Senior Doctor / Consultant</option><option value="alumni_doctor">Alumni / Junior Doctor</option><option value="pharmacist">Pharmacist</option><option value="other">Other</option></select></div>' +
      '<div class="field"><label for="edit-pro-bio">Bio <span style="font-weight:400; color: var(--color-text-faint);">(optional)</span></label><textarea id="edit-pro-bio"></textarea></div>' +
      '<div class="field"><label for="edit-pro-linkedin">LinkedIn <span style="font-weight:400; color: var(--color-text-faint);">(optional)</span></label><input type="url" id="edit-pro-linkedin"></div>' +
      '<div class="field"><label class="checkbox-option"><input type="checkbox" id="edit-pro-active">Visible on the Network page</label></div>' +
      '</div>' +

      '<div data-edit-fields="mmg" style="display:none;">' +
      '<div class="field"><label for="edit-mmg-university">University</label><input type="text" id="edit-mmg-university"></div>' +
      '<div class="field"><label for="edit-mmg-access">Access level</label><select id="edit-mmg-access"><option value="pending">Pending review</option><option value="attendee">Attendee</option><option value="committee">Committee</option></select></div>' +
      '</div>' +

      '<datalist id="edit-course-options"><option value="Medicine"><option value="Pharmacy"><option value="Dental Hygiene and Therapy"><option value="Diagnostic Radiography"><option value="Nursing"><option value="Midwifery"><option value="Biomedical Science"><option value="Occupational Therapy"></datalist>' +
    '<button type="submit" class="btn btn-primary btn-block">Save changes</button>' +
      '<p id="account-edit-status" class="auth-error" role="status" style="display:none;"></p>' +
      '</form>' +
      '<button type="button" class="app-card-delete-btn" id="account-edit-delete-btn" style="margin-top: var(--space-4); width: 100%; text-align: center;">Remove this account from LACMS</button>' +
      '</div>';
    document.body.appendChild(modal);

    modal.querySelectorAll('[data-account-edit-close]').forEach(function (el) {
      el.addEventListener('click', closeAccountEditModal);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.style.display !== 'none') closeAccountEditModal();
    });
    document.getElementById('account-edit-form').addEventListener('submit', function (e) {
      e.preventDefault();
      saveAccountEdit();
    });
    document.getElementById('account-edit-delete-btn').addEventListener('click', deleteAccountEdit);
  }

  function closeAccountEditModal() {
    var modal = document.getElementById('account-edit-modal');
    if (modal) modal.style.display = 'none';
  }

  function openAccountEditModal(type, id, onChange) {
    buildAccountEditModal();
    changeCallback = onChange || null;
    currentEditType = type;
    currentEditId = id;
    currentEditRow = null;
    var modal = document.getElementById('account-edit-modal');
    var statusEl = document.getElementById('account-edit-status');
    hideMessage(statusEl);
    document.getElementById('account-edit-title').textContent = 'Loading…';
    document.getElementById('account-edit-subtitle').textContent = ' ';
    document.querySelectorAll('[data-edit-fields]').forEach(function (el) {
      el.style.display = el.getAttribute('data-edit-fields') === type ? '' : 'none';
    });
    modal.style.display = 'flex';

    var table = type === 'member' ? 'members' : type === 'professional' ? 'network_professionals' : 'mmg_guests';
    supabaseClient.from(table).select('*').eq('id', id).single().then(function (result) {
      if (result.error || !result.data) {
        document.getElementById('account-edit-title').textContent = "Couldn't load this account";
        showMessage(statusEl, (result.error && result.error.message) || 'Not found.');
        return;
      }
      currentEditRow = result.data;
      var row = result.data;
      document.getElementById('account-edit-title').textContent = row.full_name || 'Edit account';
      document.getElementById('account-edit-subtitle').textContent = type === 'member' ? 'LACMS member' : type === 'professional' ? 'Network professional' : 'MMG guest';
      document.getElementById('edit-name').value = row.full_name || '';

      if (type === 'member') {
        document.getElementById('edit-member-course').value = row.course || '';
        document.getElementById('edit-member-year').value = row.year_of_study || '';
        document.getElementById('edit-member-student-number').value = row.student_number || '';
        document.getElementById('edit-member-status').value = row.membership_status || 'active';
        document.getElementById('edit-member-type').value = row.member_type || 'member';
        document.getElementById('edit-member-role').value = row.committee_role || '';
        document.getElementById('edit-member-sankofa').checked = !!row.sankofa_eligible;
        document.getElementById('edit-member-mmg-attendee').checked = !!row.mmg_attendee;
        document.getElementById('edit-member-mmg-committee').checked = !!row.mmg_committee;
      } else if (type === 'professional') {
        document.getElementById('edit-pro-email').value = row.email || '';
        document.getElementById('edit-pro-title').value = row.title || '';
        document.getElementById('edit-pro-organisation').value = row.organisation || '';
        document.getElementById('edit-pro-category').value = row.category || 'senior_doctor';
        document.getElementById('edit-pro-bio').value = row.bio || '';
        document.getElementById('edit-pro-linkedin').value = row.linkedin_url || '';
        document.getElementById('edit-pro-active').checked = !!row.is_active;
      } else {
        document.getElementById('edit-mmg-university').value = row.university || '';
        document.getElementById('edit-mmg-access').value = row.access_level || 'pending';
      }
    });
  }

  function saveAccountEdit() {
    var statusEl = document.getElementById('account-edit-status');
    hideMessage(statusEl);
    var name = document.getElementById('edit-name').value.trim();
    if (!name) {
      showMessage(statusEl, 'Name is required.');
      return;
    }

    var table, updates;
    if (currentEditType === 'member') {
      table = 'members';
      updates = {
        full_name: name,
        course: document.getElementById('edit-member-course').value.trim() || null,
        year_of_study: normalizeYearOfStudy(document.getElementById('edit-member-year').value) || null,
        student_number: document.getElementById('edit-member-student-number').value.trim() || null,
        membership_status: document.getElementById('edit-member-status').value,
        member_type: document.getElementById('edit-member-type').value,
        committee_role: document.getElementById('edit-member-role').value.trim() || null,
        sankofa_eligible: document.getElementById('edit-member-sankofa').checked,
        mmg_attendee: document.getElementById('edit-member-mmg-attendee').checked,
        mmg_committee: document.getElementById('edit-member-mmg-committee').checked
      };
    } else if (currentEditType === 'professional') {
      table = 'network_professionals';
      updates = {
        full_name: name,
        email: document.getElementById('edit-pro-email').value.trim() || null,
        title: document.getElementById('edit-pro-title').value.trim() || 'Professional',
        organisation: document.getElementById('edit-pro-organisation').value.trim() || null,
        category: document.getElementById('edit-pro-category').value,
        bio: document.getElementById('edit-pro-bio').value.trim() || null,
        linkedin_url: document.getElementById('edit-pro-linkedin').value.trim() || null,
        is_active: document.getElementById('edit-pro-active').checked
      };
    } else {
      table = 'mmg_guests';
      updates = {
        full_name: name,
        university: document.getElementById('edit-mmg-university').value.trim() || 'Not set',
        access_level: document.getElementById('edit-mmg-access').value
      };
    }

    var btn = document.querySelector('#account-edit-form button[type="submit"]');
    btn.disabled = true;
    supabaseClient.from(table).update(updates).eq('id', currentEditId).then(function (result) {
      btn.disabled = false;
      if (result.error) {
        statusEl.style.color = '#ef8b8f';
        showMessage(statusEl, result.error.message);
        return;
      }
      statusEl.style.color = '#6fcf97';
      showMessage(statusEl, 'Saved.');
      notifyChanged();
      window.setTimeout(closeAccountEditModal, 700);
    });
  }

  function deleteAccountEdit() {
    var name = (currentEditRow && currentEditRow.full_name) || 'this account';
    var recordLabel = currentEditType === 'member' ? 'membership' : currentEditType === 'professional' ? 'professional profile' : 'MMG guest record';
    if (!window.confirm('Remove ' + name + ' from LACMS? This permanently deletes their ' + recordLabel + '. Their login itself isn\'t deleted - only Supabase\'s own Authentication → Users page can do that.')) return;
    var table = currentEditType === 'member' ? 'members' : currentEditType === 'professional' ? 'network_professionals' : 'mmg_guests';
    var deleteBtn = document.getElementById('account-edit-delete-btn');
    deleteBtn.disabled = true;
    supabaseClient.from(table).delete().eq('id', currentEditId).then(function (result) {
      deleteBtn.disabled = false;
      if (result.error) {
        var statusEl = document.getElementById('account-edit-status');
        statusEl.style.color = '#ef8b8f';
        showMessage(statusEl, result.error.message);
        return;
      }
      closeAccountEditModal();
      notifyChanged();
    });
  }

  window.lacmsAccountEdit = { open: openAccountEditModal, normalizeYear: normalizeYearOfStudy };
})();
