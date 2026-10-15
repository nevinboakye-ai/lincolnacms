// About page: "Meet the team" from the database, editable by the president
// (migration 081).
//
// about.html ships the committee as static cards (the fallback if the table is
// empty or can't be reached). Once committee_members has active rows this swaps
// them in. For the president the section also gets an
// "Edit the team" toolbar and a pencil on every card: change a name, role,
// course line or bio, upload or replace a photo (shrunk in the browser first,
// with a slider to choose which part of the picture shows), reorder people,
// hide someone without deleting them, or add a new member. Saving refreshes the
// page's cards straight away.
//
// Who may change anything is enforced in the database (RLS policies and the
// committee-photos bucket policies), not here.
(function () {
  'use strict';

  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;
  var track = document.querySelector('#committee [data-carousel-track]');
  if (!track) return;

  var BUCKET = 'committee-photos';
  var MAX_PHOTO_BYTES = 12 * 1024 * 1024; // before shrinking
  var ROLE_SUGGESTIONS = ['President', 'Co-Vice President', 'Vice President', 'Treasurer', 'Secretary', 'Event Secretary', 'Social Secretary', 'Charity Secretary', 'Media Officer', 'Sankofa Lead', 'Welfare Officer', 'First Year Representative'];

  var members = [];
  var canEdit = false;
  var toolbar = null;

  function esc(str) {
    return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function initials(name) {
    var p = String(name || '').trim().split(/\s+/);
    return ((p[0] || '').charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase() || '?';
  }
  function slug(name) { return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'member'; }
  function photoSrc(url) {
    var u = String(url || '').trim();
    if (!u) return '';
    if (/^https:\/\//i.test(u)) return u;
    if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.indexOf('//') === 0) return ''; // no javascript:, data:, http: ...
    return encodeURI(u);
  }

  var CHEVRON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  var PENCIL = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

  // Same markup as the static cards in about.html, so it looks and behaves identically.
  function cardHtml(m) {
    var bioId = 'bio-' + slug(m.full_name) + '-' + m.id.slice(0, 4);
    var src = photoSrc(m.photo_url);
    var photo = src
      ? '<img src="' + esc(src) + '" alt="' + esc(m.full_name) + '" loading="lazy" style="object-position: 50% ' + (m.photo_focus == null ? 50 : m.photo_focus) + '%;">'
      : '<div class="person-photo-initials" aria-hidden="true">' + esc(initials(m.full_name)) + '</div>';
    return '<div class="card person-card' + (m.is_active ? '' : ' is-hidden-member') + '" data-expand-row data-member="' + esc(m.id) + '">' +
      '<div class="person-photo">' + photo + '<div class="person-photo-scrim" aria-hidden="true"></div>' +
        '<div class="person-photo-info"><div class="person-name">' + esc(m.full_name) + (m.is_active ? '' : ' <small>(hidden)</small>') + '</div>' +
        '<div class="person-role">' + esc(m.role) + '</div>' +
        (m.course_text ? '<div class="person-course">' + esc(m.course_text) + '</div>' : '') +
        (m.bio ? '<div class="person-card-hint">' + CHEVRON + 'Tap to learn more</div>' : '') + '</div></div>' +
      (canEdit ? '<button type="button" class="cm-edit-btn" data-cm-edit="' + esc(m.id) + '" aria-label="Edit ' + esc(m.full_name) + '">' + PENCIL + '</button>' : '') +
      (m.bio
        ? '<button type="button" class="person-card-toggle-btn" data-expand-btn aria-expanded="false" aria-controls="' + esc(bioId) + '" aria-label="More about ' + esc(m.full_name) + '">' + CHEVRON + '</button>' +
          '<div class="reveal-panel" id="' + esc(bioId) + '"><div class="reveal-panel-inner"><div class="reveal-panel-content"><p class="person-bio">' + esc(m.bio) + '</p></div></div></div>'
        : '') +
      '</div>';
  }

  function render() {
    var shown = members.filter(function (m) { return m.is_active || canEdit; });
    if (!shown.length) return; // keep the built-in cards
    track.innerHTML = shown.map(cardHtml).join('');
    Array.prototype.forEach.call(track.querySelectorAll('[data-expand-row]'), function (row) {
      var btn = row.querySelector('[data-expand-btn]');
      row.addEventListener('click', function (e) {
        if (e.target.closest('a') || e.target.closest('[data-cm-edit]') || !btn) return;
        var open = row.classList.toggle('is-expanded');
        btn.setAttribute('aria-expanded', String(open));
      });
    });
    window.dispatchEvent(new Event('resize')); // carousel arrows re-check their ends
  }

  function load() {
    return supabaseClient.from('committee_members').select('*').order('sort_order', { ascending: true }).then(function (res) {
      if (res.error) { console.warn('Committee: keeping the built-in cards:', res.error.message); return false; }
      members = res.data || [];
      return members.length > 0;
    }, function () { return false; });
  }

  // ---- Toolbar -----------------------------------------------------------------
  function buildToolbar() {
    var head = document.querySelector('#committee .section-head');
    if (!head || toolbar) return;
    toolbar = document.createElement('div');
    toolbar.className = 'cm-toolbar';
    toolbar.innerHTML =
      '<button type="button" class="btn btn-outline cm-btn" data-cm-manage>' + PENCIL + 'Edit the team</button>' +
      '<button type="button" class="btn btn-primary cm-btn" data-cm-add>+ Add a member</button>';
    head.appendChild(toolbar);
    toolbar.addEventListener('click', function (e) {
      if (e.target.closest('[data-cm-add]')) openForm(null);
      else if (e.target.closest('[data-cm-manage]')) openManager();
    });
  }
  track.addEventListener('click', function (e) {
    var b = e.target.closest('[data-cm-edit]');
    if (!b) return;
    e.stopPropagation();
    var m = members.filter(function (x) { return x.id === b.getAttribute('data-cm-edit'); })[0];
    if (m) openForm(m);
  }, true);

  // ---- Dialogs -------------------------------------------------------------------
  function openDialog(html, cls) {
    var previous = document.activeElement;
    var backdrop = document.createElement('div');
    backdrop.className = 'guide-backdrop';
    var dialog = document.createElement('div');
    dialog.className = 'guide-dialog cm-dialog' + (cls ? ' ' + cls : '');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = html;
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    document.body.classList.add('guide-open');
    requestAnimationFrame(function () { backdrop.classList.add('is-in'); setTimeout(function () { backdrop.classList.add('is-in'); }, 30); var f = dialog.querySelector('[data-autofocus]') || dialog.querySelector('input, button'); if (f) f.focus(); });
    var api = {
      el: dialog,
      close: function () {
        document.removeEventListener('keydown', onKey, true);
        backdrop.classList.remove('is-in');
        document.body.classList.remove('guide-open');
        setTimeout(function () { backdrop.remove(); }, 200);
        if (previous && previous.focus && document.body.contains(previous)) previous.focus();
      }
    };
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); api.close(); return; }
      if (e.key !== 'Tab') return;
      var f = dialog.querySelectorAll('button:not([disabled]):not([hidden]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('mousedown', function (e) { if (e.target === backdrop) api.close(); });
    dialog.addEventListener('click', function (e) { if (e.target.closest('[data-dialog-close]')) api.close(); });
    return api;
  }

  function toast(message, isError) {
    var t = document.createElement('div');
    t.className = 'cm-toast' + (isError ? ' is-error' : '');
    t.setAttribute('role', isError ? 'alert' : 'status');
    t.textContent = message;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('is-in'); });
    setTimeout(function () { t.classList.remove('is-in'); setTimeout(function () { t.remove(); }, 250); }, isError ? 7000 : 4000);
  }

  function refresh(message) {
    return load().then(function () { render(); if (message) toast(message); });
  }

  // ---- Manage: order, hide, remove ----------------------------------------------------
  function openManager() {
    var dlg = openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">About page</span><h2 class="guide-title">Edit the team</h2>' +
      '<p class="guide-text">Reorder with the arrows (the first person is shown first). Hide someone to take them off the page without deleting them.</p>' +
      '<ul class="cm-list" data-cm-list></ul>' +
      '<div class="guide-actions"><button type="button" class="btn btn-primary" data-cm-add-from>+ Add a member</button><button type="button" class="btn btn-outline" data-dialog-close>Done</button></div>');
    var ul = dlg.el.querySelector('[data-cm-list]');
    function draw() {
      if (!members.length) { ul.innerHTML = '<li class="cm-empty">Nothing to edit yet - run migration 081 in Supabase first (README-members-setup.md, section 134), then reload this page.</li>'; return; }
      ul.innerHTML = members.map(function (m, i) {
        var src = photoSrc(m.photo_url);
        return '<li data-id="' + esc(m.id) + '"' + (m.is_active ? '' : ' class="is-hidden"') + '>' +
          '<span class="cm-thumb">' + (src ? '<img src="' + esc(src) + '" alt="" style="object-position:50% ' + (m.photo_focus == null ? 50 : m.photo_focus) + '%">' : esc(initials(m.full_name))) + '</span>' +
          '<span class="cm-who"><strong>' + esc(m.full_name) + (m.is_active ? '' : ' <em>(hidden)</em>') + '</strong><small>' + esc(m.role) + '</small></span>' +
          '<span class="cm-row-actions">' +
            '<button type="button" class="cm-icon" data-cm-up aria-label="Move ' + esc(m.full_name) + ' earlier"' + (i === 0 ? ' disabled' : '') + '>&uarr;</button>' +
            '<button type="button" class="cm-icon" data-cm-down aria-label="Move ' + esc(m.full_name) + ' later"' + (i === members.length - 1 ? ' disabled' : '') + '>&darr;</button>' +
            '<button type="button" class="cm-text" data-cm-row-edit>Edit</button>' +
            '<button type="button" class="cm-text" data-cm-row-toggle>' + (m.is_active ? 'Hide' : 'Show') + '</button>' +
            '<button type="button" class="cm-text cm-danger" data-cm-row-delete>Remove</button>' +
          '</span></li>';
      }).join('');
    }
    draw();
    dlg.el.addEventListener('click', function (e) {
      if (e.target.closest('[data-cm-add-from]')) { dlg.close(); setTimeout(function () { openForm(null); }, 220); return; }
      var li = e.target.closest('li[data-id]');
      if (!li) return;
      var id = li.getAttribute('data-id');
      var idx = members.map(function (m) { return m.id; }).indexOf(id);
      var m = members[idx];
      if (e.target.closest('[data-cm-row-edit]')) { dlg.close(); setTimeout(function () { openForm(m); }, 220); return; }
      if (e.target.closest('[data-cm-up]') || e.target.closest('[data-cm-down]')) {
        var other = members[idx + (e.target.closest('[data-cm-up]') ? -1 : 1)];
        if (!other) return;
        // Swap the two sort values (tie-safe: re-number if they happen to be equal).
        var a = m.sort_order, b = other.sort_order;
        if (a === b) { a = (idx + 1) * 10; b = (members.indexOf(other) + 1) * 10; }
        Promise.all([
          supabaseClient.from('committee_members').update({ sort_order: b, updated_at: new Date().toISOString() }).eq('id', m.id),
          supabaseClient.from('committee_members').update({ sort_order: a, updated_at: new Date().toISOString() }).eq('id', other.id)
        ]).then(function (res) {
          var err = res.filter(function (r) { return r.error; })[0];
          if (err) { toast("Couldn't reorder: " + err.error.message, true); return; }
          return refresh().then(draw);
        });
        return;
      }
      if (e.target.closest('[data-cm-row-toggle]')) {
        supabaseClient.from('committee_members').update({ is_active: !m.is_active, updated_at: new Date().toISOString() }).eq('id', m.id).then(function (res) {
          if (res.error) { toast("Couldn't update: " + res.error.message, true); return; }
          return refresh().then(draw);
        });
        return;
      }
      if (e.target.closest('[data-cm-row-delete]')) {
        if (!window.confirm('Remove ' + m.full_name + ' from the team page? (To keep them but take them off the page for now, use Hide instead.)')) return;
        supabaseClient.from('committee_members').delete().eq('id', m.id).then(function (res) {
          if (res.error) { toast("Couldn't remove: " + res.error.message, true); return; }
          removeStoredPhoto(m.photo_url);
          return refresh(m.full_name + ' was removed.').then(draw);
        });
      }
    });
  }

  // ---- Add / edit form -------------------------------------------------------------------
  function storedPath(url) {
    var marker = '/' + BUCKET + '/';
    var i = String(url || '').indexOf(marker);
    return i === -1 ? null : decodeURIComponent(String(url).slice(i + marker.length).split('?')[0]);
  }
  function removeStoredPhoto(url) {
    var p = storedPath(url);
    if (p) supabaseClient.storage.from(BUCKET).remove([p]);
  }

  // Shrink to at most 1200px wide and re-encode as JPEG so uploads are small and consistent.
  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, 1200 / img.naturalWidth);
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error('Couldn\'t process that image.')); }, 'image/jpeg', 0.88);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That doesn\'t look like a picture we can read - try a JPG or PNG.')); };
      img.src = url;
    });
  }

  function openForm(m) {
    var isNew = !m;
    var e0 = m || { full_name: '', role: '', course_text: '', bio: '', photo_url: '', photo_focus: 30, is_active: true };
    var dlg = openDialog('<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button><span class="guide-eyebrow">About page</span><h2 class="guide-title">' + (isNew ? 'Add a team member' : 'Edit ' + esc(e0.full_name)) + '</h2>' +
      '<form class="guide-form cm-form" novalidate>' +
        '<div class="cm-photo-row">' +
          '<div class="cm-photo-preview" data-cm-preview></div>' +
          '<div class="cm-photo-controls">' +
            '<label class="btn btn-outline cm-upload">Choose a photo<input type="file" id="cm-file" accept="image/jpeg,image/png,image/webp" hidden></label>' +
            '<button type="button" class="cm-text cm-danger" data-cm-nophoto>Remove photo</button>' +
            '<label for="cm-focus" class="cm-focus-label">Which part of the photo shows</label>' +
            '<input type="range" id="cm-focus" min="0" max="100" value="' + (e0.photo_focus == null ? 30 : e0.photo_focus) + '" aria-label="Photo position, top to bottom">' +
            '<small>Photos show as portraits - slide until the face sits nicely. Big pictures are shrunk automatically.</small>' +
          '</div>' +
        '</div>' +
        '<div class="ev-form-row"><div class="field"><label for="cm-name">Name</label><input type="text" id="cm-name" maxlength="80" value="' + esc(e0.full_name) + '" data-autofocus></div>' +
        '<div class="field"><label for="cm-role">Role</label><input type="text" id="cm-role" maxlength="60" list="cm-roles" value="' + esc(e0.role) + '" placeholder="e.g. Co-Vice President" autocomplete="off"><datalist id="cm-roles">' + ROLE_SUGGESTIONS.map(function (r) { return '<option value="' + esc(r) + '">'; }).join('') + '</datalist></div></div>' +
        '<div class="field"><label for="cm-course">Course line <span class="guide-optional">(optional)</span></label><input type="text" id="cm-course" maxlength="80" value="' + esc(e0.course_text || '') + '" placeholder="e.g. Medicine, Year 3"></div>' +
        '<div class="field"><label for="cm-bio">Bio <span class="guide-optional">(shown when the card is opened)</span></label><textarea id="cm-bio" rows="5" maxlength="800" placeholder="e.g. Medicine MBBS | Aspiring Surgeon | Treasurer @ACMS">' + esc(e0.bio || '') + '</textarea><span class="guide-count" id="cm-count">0 / 800</span></div>' +
        '<label class="checkbox-option"><input type="checkbox" id="cm-active"' + (e0.is_active ? ' checked' : '') + '>Show on the About page</label>' +
        '<p class="guide-error" id="cm-error" role="alert" hidden></p>' +
        '<div class="guide-actions"><button type="submit" class="btn btn-primary" id="cm-save">' + (isNew ? 'Add to the team' : 'Save changes') + '</button><button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div>' +
      '</form>', 'cm-dialog--wide');
    var d = dlg.el;
    var $ = function (id) { return d.querySelector('#' + id); };
    var state = { url: e0.photo_url || '', blob: null, previewUrl: '' };

    function paintPreview() {
      var src = state.previewUrl || photoSrc(state.url);
      var box = d.querySelector('[data-cm-preview]');
      box.innerHTML = src
        ? '<img src="' + esc(src) + '" alt="" style="object-position:50% ' + $('cm-focus').value + '%">'
        : '<span>' + esc(initials($('cm-name').value || e0.full_name)) + '</span>';
    }
    paintPreview();
    $('cm-focus').addEventListener('input', paintPreview);
    $('cm-name').addEventListener('input', function () { if (!state.previewUrl && !state.url) paintPreview(); });
    function count() { $('cm-count').textContent = $('cm-bio').value.length + ' / 800'; }
    count();
    $('cm-bio').addEventListener('input', count);

    $('cm-file').addEventListener('change', function () {
      var f = $('cm-file').files[0];
      var err = $('cm-error');
      err.hidden = true;
      if (!f) return;
      if (['image/jpeg', 'image/png', 'image/webp'].indexOf(f.type) === -1) { err.textContent = 'Use a JPG, PNG or WebP picture.'; err.hidden = false; return; }
      if (f.size > MAX_PHOTO_BYTES) { err.textContent = 'That picture is over 12 MB - pick a smaller one.'; err.hidden = false; return; }
      shrinkImage(f).then(function (blob) {
        if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
        state.blob = blob;
        state.previewUrl = URL.createObjectURL(blob);
        paintPreview();
      }, function (ex) { err.textContent = ex.message; err.hidden = false; });
    });
    d.querySelector('[data-cm-nophoto]').addEventListener('click', function () {
      state.blob = null; state.url = ''; if (state.previewUrl) URL.revokeObjectURL(state.previewUrl); state.previewUrl = '';
      paintPreview();
    });

    d.querySelector('form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var err = $('cm-error');
      err.hidden = true;
      var name = $('cm-name').value.trim();
      var role = $('cm-role').value.trim();
      if (!name) { err.textContent = 'Add their name.'; err.hidden = false; return; }
      if (!role) { err.textContent = 'Add their role.'; err.hidden = false; return; }
      var save = $('cm-save');
      save.disabled = true; save.textContent = 'Saving…';
      var oldUrl = e0.photo_url || '';
      var uploadStep = state.blob
        ? supabaseClient.storage.from(BUCKET).upload(slug(name) + '/' + Date.now() + '.jpg', state.blob, { contentType: 'image/jpeg', upsert: false }).then(function (r) {
            if (r.error) throw new Error('Photo upload failed: ' + r.error.message);
            return supabaseClient.storage.from(BUCKET).getPublicUrl(r.data.path).data.publicUrl;
          })
        : Promise.resolve(state.url);
      uploadStep.then(function (photoUrl) {
        var payload = {
          full_name: name, role: role, course_text: $('cm-course').value.trim() || null, bio: $('cm-bio').value.trim() || null,
          photo_url: photoUrl || null, photo_focus: parseInt($('cm-focus').value, 10), is_active: $('cm-active').checked,
          updated_at: new Date().toISOString()
        };
        var req;
        if (isNew) {
          payload.sort_order = members.length ? Math.max.apply(null, members.map(function (x) { return x.sort_order; })) + 10 : 10;
          req = supabaseClient.from('committee_members').insert(payload);
        } else req = supabaseClient.from('committee_members').update(payload).eq('id', m.id);
        return req.then(function (res) {
          if (res.error) throw new Error(res.error.message);
          if (oldUrl && oldUrl !== photoUrl) removeStoredPhoto(oldUrl); // tidy up the replaced upload
        });
      }).then(function () {
        if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
        dlg.close();
        return refresh(isNew ? name + ' was added.' : 'Saved.');
      }).catch(function (ex) {
        save.disabled = false; save.textContent = isNew ? 'Add to the team' : 'Save changes';
        var msg = ex && ex.message ? ex.message : String(ex);
        err.textContent = /row-level security|permission|not allowed/i.test(msg) ? 'You don\'t have permission to edit the team.'
          : (/relation .* does not exist|committee_members/i.test(msg) ? 'The database needs updating first - run migration 081 in Supabase (README-members-setup.md, section 134).' : msg);
        err.hidden = false;
      });
    });
  }

  // ---- Start -----------------------------------------------------------------------------
  supabaseClient.auth.getSession().then(function (r) {
    if (!(r.data && r.data.session)) return false;
    return supabaseClient.rpc('is_president').then(function (x) { return !x.error && x.data === true; }, function () { return false; });
  }).then(function (admin) {
    canEdit = !!admin;
    return load();
  }).then(function (has) {
    if (canEdit && !has) {
      // The table isn't there (or is empty): still offer the toolbar so the president sees what to run.
      buildToolbar();
      return;
    }
    if (has) render();
    if (canEdit) buildToolbar();
  });
})();
