// Dashboard -> QR codes (migration 102): the committee's own QR code studio.
//
//   * Make a code for a link, an event's feedback form, Wi-Fi, an email, a phone number or text.
//   * Design it: ready-made styles, square / rounded / dotted squares, three corner-square styles,
//     colours and gradients, a logo in the middle (the LACMS crest in one tap), a caption and a frame.
//   * "Will it scan?" advice as you design: contrast, logo size, density, how big to print it.
//   * Two kinds of link code:
//       Trackable - the code holds a short LACMS address (go.html?c=...). You can change where it
//                   goes or pause it after it is printed, and see how many scans it gets.
//       Direct    - the code holds the link itself. Nothing to maintain, no counting.
//   * Download PNG (any size) or SVG, copy the image, print a poster, keep a library of your codes.
// Everything is drawn in the browser by js/qr.js: nothing is sent to an outside service.
(function () {
  'use strict';

  var root = document.getElementById('qr-studio-root');
  if (!root) return;
  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;
  if (!window.lacmsQR) { root.innerHTML = '<div class="form-note"><span>The QR generator didn’t load. Refresh the page.</span></div>'; return; }
  var Q = window.lacmsQR;

  // ---- Ready-made styles ---------------------------------------------------------------
  var PRESETS = [
    { key: 'classic', name: 'Classic', d: { fg: '#000000', bg: '#ffffff', shape: 'square', eyeFrame: 'square', eyePupil: 'square' } },
    { key: 'gold', name: 'LACMS gold', d: { fg: '#17130a', eyeColor: '#8a6512', pupilColor: '#8a6512', bg: '#ffffff', shape: 'rounded', eyeFrame: 'rounded', eyePupil: 'rounded' } },
    { key: 'forest', name: 'Forest', d: { fg: '#0b3d2e', fg2: '#1e7a46', gradient: 'diagonal', bg: '#ffffff', shape: 'rounded', eyeFrame: 'rounded', eyePupil: 'circle', eyeColor: '#0b3d2e', pupilColor: '#0b3d2e' } },
    { key: 'crimson', name: 'Crimson', d: { fg: '#6e1016', fg2: '#c1272d', gradient: 'vertical', bg: '#ffffff', shape: 'dots', eyeFrame: 'circle', eyePupil: 'circle', eyeColor: '#6e1016', pupilColor: '#6e1016' } },
    { key: 'midnight', name: 'Midnight', d: { fg: '#0a0a0c', fg2: '#3b2a7a', gradient: 'diagonal', bg: '#ffffff', shape: 'dots', eyeFrame: 'rounded', eyePupil: 'circle', eyeColor: '#0a0a0c', pupilColor: '#3b2a7a' } },
    { key: 'poster', name: 'Poster', d: { fg: '#17130a', eyeColor: '#17130a', pupilColor: '#8a6512', bg: '#ffffff', shape: 'rounded', eyeFrame: 'rounded', eyePupil: 'rounded', frame: 'band', frameColor: '#8a6512', caption: 'Scan me' } }
  ];
  var BASE = {
    ecc: 'M', margin: 4, fg: '#000000', fg2: '', gradient: 'diagonal', bg: '#ffffff', shape: 'square', eyeFrame: 'square', eyePupil: 'square',
    eyeColor: '', pupilColor: '', logo: '', logoSize: 0.2, caption: '', captionPos: 'below', captionColor: '', frame: 'none', frameColor: '#8a6512'
  };
  function designOf(preset) { return Object.assign({}, BASE, preset.d); }

  var KINDS = [
    ['link', 'Link'], ['event', 'Event feedback'], ['wifi', 'Wi-Fi'], ['email', 'Email'], ['phone', 'Phone'], ['text', 'Text']
  ];
  var STARTS = [
    { label: 'Event feedback', kind: 'event', name: 'Event feedback', caption: 'Scan to give feedback' },
    { label: 'Join LACMS', kind: 'link', link: 'https://lincolnsu.com/activities/view/acs-medical', name: 'Join LACMS', caption: 'Scan to join LACMS' },
    { label: 'Instagram', kind: 'link', link: 'https://www.instagram.com/lincolnacms/', name: 'Instagram', caption: 'Follow @lincolnacms' },
    { label: 'Wi-Fi', kind: 'wifi', name: 'Wi-Fi', caption: 'Scan to join the Wi-Fi' }
  ];

  var S = { loaded: false, loading: false, error: '', list: [], events: [], view: 'list', f: null, stats: {}, statsOpen: '', flash: '', busy: false };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function ago(iso) {
    if (!iso) return 'never';
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000), m = Math.round(s / 60), h = Math.round(s / 3600), d = Math.round(s / 86400);
    if (s < 90) return 'just now';
    if (s < 3600) return m + ' minutes ago';
    if (s < 86400) return h + (h === 1 ? ' hour ago' : ' hours ago');
    return d + (d === 1 ? ' day ago' : ' days ago');
  }
  function shortLink(code) { return new URL('go.html?c=' + encodeURIComponent(code), window.location.href.split('#')[0]).href; }
  function feedbackLink(slug) { return new URL('feedback.html?event=' + encodeURIComponent(slug), window.location.href.split('#')[0]).href; }
  function getPath(o, p) { return p.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function setPath(o, p, v) { var ks = p.split('.'), last = ks.pop(); var t = ks.reduce(function (a, k) { return a[k]; }, o); t[last] = v; }

  // ---- What goes inside the code --------------------------------------------------------
  function normaliseLink(raw) {
    var v = String(raw || '').trim();
    if (!v) return { error: 'Add the link this code should open.' };
    if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = 'https://' + v;
    try {
      var u = new URL(v);
      if (!/^https?:$/.test(u.protocol)) return { error: 'Use a web link starting with http:// or https://.' };
      if (!u.hostname || u.hostname.indexOf('.') === -1) return { error: 'That doesn’t look like a full web address (for example lincolnacms.uk).' };
      return { url: u.href };
    } catch (e) { return { error: 'That doesn’t look like a valid link.' }; }
  }
  function wifiEsc(s) { return String(s).replace(/([\\;,:"])/g, '\\$1'); }

  // The real content (what the person ends up with), or an error to show.
  function payloadOf(f) {
    if (f.kind === 'link') { var l = normaliseLink(f.link); return l.error ? { error: l.error } : { text: l.url }; }
    if (f.kind === 'event') return f.eventSlug ? { text: feedbackLink(f.eventSlug) } : { error: 'Choose the event.' };
    if (f.kind === 'wifi') {
      var w = f.wifi;
      if (!w.ssid.trim()) return { error: 'Add the Wi-Fi network name.' };
      var sec = w.security === 'nopass' ? 'nopass' : w.security;
      return { text: 'WIFI:T:' + sec + ';S:' + wifiEsc(w.ssid.trim()) + ';' + (sec === 'nopass' ? '' : 'P:' + wifiEsc(w.password) + ';') + (w.hidden ? 'H:true;' : '') + ';' };
    }
    if (f.kind === 'email') {
      var e = f.email;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.to.trim())) return { error: 'Add a valid email address.' };
      var q = [];
      if (e.subject.trim()) q.push('subject=' + encodeURIComponent(e.subject.trim()));
      if (e.body.trim()) q.push('body=' + encodeURIComponent(e.body.trim()));
      return { text: 'mailto:' + e.to.trim() + (q.length ? '?' + q.join('&') : '') };
    }
    if (f.kind === 'phone') {
      var p = String(f.phone || '').replace(/[^\d+]/g, '');
      return p.length >= 5 ? { text: 'tel:' + p } : { error: 'Add a phone number.' };
    }
    return String(f.text || '').trim() ? { text: String(f.text).trim() } : { error: 'Add the text for the code.' };
  }
  function canTrack(f) { return f.kind === 'link' || f.kind === 'event'; }
  function isTracked(f) { return canTrack(f) && f.mode === 'tracked'; }
  // What the code actually holds: for a tracked code, the short LACMS address.
  function encoded(f) {
    var p = payloadOf(f);
    if (p.error) return { error: p.error };
    if (isTracked(f)) return { text: shortLink(f.code || 'xxxxxxx'), final: p.text, placeholder: !f.code };
    return { text: p.text, final: p.text };
  }

  // ---- Loading ----------------------------------------------------------------------------
  function load() {
    if (S.loading) return Promise.resolve();
    S.loading = true;
    if (!S.loaded) root.innerHTML = '<p class="sh-muted">Loading…</p>';
    return Promise.all([
      supabaseClient.rpc('qr_list'),
      supabaseClient.from('site_events').select('slug, name, starts_on, date_text').order('starts_on', { ascending: false, nullsFirst: false })
    ]).then(function (res) {
      S.loading = false; S.loaded = true;
      if (res[0].error) {
        S.error = /Could not find the function|schema cache|does not exist/i.test(res[0].error.message || '')
          ? 'The QR studio needs migration 102 to be run in Supabase (see README-members-setup.md, section 158).' : res[0].error.message;
        render(); return;
      }
      S.error = '';
      S.list = res[0].data || [];
      S.events = (res[1].data || []).map(function (e) { return { slug: e.slug, name: e.name, text: e.date_text || e.starts_on || '' }; });
      var scans = S.list.reduce(function (t, c) { return t + (c.scan_count || 0); }, 0);
      var el = document.getElementById('dash-count-qr');
      if (el) el.textContent = S.list.length ? plural(S.list.length, 'code', 'codes') + ' · ' + plural(scans, 'scan', 'scans') : 'None yet';
      render();
    }, function () { S.loading = false; S.loaded = true; S.error = 'Could not load your QR codes.'; render(); });
  }

  // ---- Forms ---------------------------------------------------------------------------------
  function blankForm(kind) {
    return {
      id: null, code: null, name: '', kind: kind || 'link', mode: 'tracked', link: '', eventSlug: '',
      wifi: { ssid: '', password: '', security: 'WPA', hidden: false }, email: { to: '', subject: '', body: '' }, phone: '', text: '',
      design: designOf(PRESETS[1])
    };
  }
  function formFrom(c) {
    var f = blankForm(c.kind);
    var dg = clone(c.design || {});
    var fields = dg.fields || {};
    delete dg.fields;
    f.id = c.id; f.code = c.code; f.name = c.name; f.kind = c.kind; f.mode = c.mode;
    f.design = Object.assign({}, BASE, dg);
    if (f.kind === 'link') f.link = c.payload;
    else if (f.kind === 'event') { try { f.eventSlug = new URL(c.payload).searchParams.get('event') || ''; } catch (e) { f.eventSlug = ''; } }
    else Object.keys(fields).forEach(function (k) { f[k] = fields[k]; });
    if (f.kind === 'event' && !f.eventSlug) { f.kind = 'link'; f.link = c.payload; }
    return f;
  }
  function openForm(f) { S.f = f; S.view = 'edit'; S.flash = ''; render(); window.scrollTo({ top: 0 }); }
  function fieldsToSave(f) {
    if (f.kind === 'wifi') return { wifi: f.wifi };
    if (f.kind === 'email') return { email: f.email };
    if (f.kind === 'phone') return { phone: f.phone };
    if (f.kind === 'text') return { text: f.text };
    return {};
  }

  // ---- The library ------------------------------------------------------------------------------
  function thumb(c) {
    var dg = clone(c.design || {}); delete dg.fields;
    var text = c.mode === 'tracked' && c.code ? shortLink(c.code) : c.payload;
    try { return Q.svg(text, Object.assign({}, BASE, dg, { size: 120 })); } catch (e) { return ''; }
  }
  function kindLabel(k) { return (KINDS.filter(function (x) { return x[0] === k; })[0] || [0, k])[1]; }

  function statsHtml(id) {
    var st = S.stats[id];
    if (!st) return '<div class="qs-stats"><p class="sh-muted">Loading…</p></div>';
    if (st.error) return '<div class="qs-stats"><p class="sh-muted">' + esc(st.error) + '</p></div>';
    var days = {}, i, d;
    (st.daily || []).forEach(function (x) { days[x.d] = x.n; });
    var cols = [], max = 1, now = new Date();
    for (i = 59; i >= 0; i--) {
      d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      var k = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
      cols.push({ k: k, n: days[k] || 0 });
      if ((days[k] || 0) > max) max = days[k];
    }
    var total = Object.keys(st.devices || {}).reduce(function (t, key) { return t + st.devices[key]; }, 0);
    var names = { ios: 'iPhone / iPad', android: 'Android', desktop: 'Computer', other: 'Other' };
    return '<div class="qs-stats"><div class="qs-spark" role="img" aria-label="Scans per day, last 60 days">' + cols.map(function (c) {
      return '<span title="' + esc(c.k) + ': ' + c.n + '"><i style="height:' + (c.n ? Math.max(8, Math.round(c.n / max * 100)) : 2) + '%"></i></span>';
    }).join('') + '</div><div class="qs-spark-axis"><span>60 days ago</span><span>today</span></div>' +
      (total ? '<ul class="qs-devices">' + Object.keys(st.devices).sort(function (a, b) { return st.devices[b] - st.devices[a]; }).map(function (key) {
        return '<li><span>' + esc(names[key] || key) + '</span><span class="qs-dev-bar"><i style="width:' + Math.round(st.devices[key] / total * 100) + '%"></i></span><b>' + st.devices[key] + '</b></li>';
      }).join('') + '</ul>' : '<p class="sh-muted">No scans yet.</p>') +
      (st.first_scan ? '<p class="sh-muted">First scan ' + esc(ago(st.first_scan)) + '.</p>' : '') + '</div>';
  }

  function listHtml() {
    var starts = '<div class="qs-starts"><span class="qs-starts-label">Start from</span>' + STARTS.map(function (s, i) {
      return '<button type="button" class="qs-start" data-qs-start="' + i + '">' + esc(s.label) + '</button>';
    }).join('') + '</div>';
    var intro = '<div class="qs-intro"><div><h3>Make a QR code, your way</h3><p>Design it, put any link behind it, and keep it here. Everything is made on your own website, so no outside service ever sees your links. <strong>Trackable</strong> codes can be pointed somewhere new later and count their scans.</p></div>' +
      '<button type="button" class="btn btn-primary" data-qs-new>New QR code</button></div>' + starts;
    if (!S.list.length) return intro + '<div class="qs-empty"><h3>Your library is empty</h3><p>Pick a starting point above, or make a new code. You’ll find it here afterwards, ready to download again.</p></div>';
    return intro + '<ul class="qs-grid">' + S.list.map(function (c) {
      var tracked = c.mode === 'tracked', link = tracked ? shortLink(c.code) : null;
      var meta = tracked
        ? plural(c.scan_count, 'scan', 'scans') + (c.scan_count ? ' · last ' + ago(c.last_scan_at) : '')
        : 'Direct code (not counted)';
      return '<li class="qs-card' + (c.is_active ? '' : ' is-paused') + '">' +
        '<div class="qs-thumb">' + thumb(c) + '</div><div class="qs-card-body">' +
        '<div class="qs-card-top"><h3>' + esc(c.name) + '</h3>' + (tracked ? '<span class="qs-pill qs-pill--' + (c.is_active ? 'live' : 'paused') + '">' + (c.is_active ? 'Live' : 'Paused') + '</span>' : '') + '</div>' +
        '<p class="qs-sub">' + esc(kindLabel(c.kind)) + ' · ' + (tracked ? 'Trackable' : 'Direct') + '</p>' +
        '<p class="qs-dest" title="' + esc(c.payload) + '">' + esc(c.kind === 'wifi' ? 'Wi-Fi details' : c.kind === 'email' ? c.payload.replace(/^mailto:/, '').split('?')[0] : c.payload.length > 70 ? c.payload.slice(0, 68) + '…' : c.payload) + '</p>' +
        '<p class="qs-meta">' + esc(meta) + '</p>' +
        '<div class="qs-actions"><button type="button" class="btn btn-outline" data-qs-edit="' + esc(c.id) + '">Edit</button>' +
        '<button type="button" class="btn btn-outline" data-qs-dl="' + esc(c.id) + '">PNG</button>' +
        '<button type="button" class="btn btn-outline" data-qs-dl-svg="' + esc(c.id) + '">SVG</button>' +
        (tracked ? '<button type="button" class="btn btn-outline" data-qs-stats="' + esc(c.id) + '">' + (S.statsOpen === c.id ? 'Hide scans' : 'Scans') + '</button>' : '') + '</div>' +
        '<div class="qs-more">' + (tracked ? '<button type="button" class="guide-linkbtn" data-qs-copy="' + esc(link) + '">Copy short link</button><button type="button" class="guide-linkbtn" data-qs-toggle="' + esc(c.id) + '">' + (c.is_active ? 'Pause' : 'Resume') + '</button>' : '') +
        '<button type="button" class="guide-linkbtn" data-qs-dup="' + esc(c.id) + '">Duplicate</button><button type="button" class="guide-linkbtn" data-qs-del="' + esc(c.id) + '">Delete</button></div>' +
        (S.statsOpen === c.id ? statsHtml(c.id) : '') + '</div></li>';
    }).join('') + '</ul>';
  }

  // ---- The editor ------------------------------------------------------------------------------------
  function colorField(label, path, opts) {
    opts = opts || {};
    var v = getPath(S.f, path) || opts.fallback || '#000000';
    return '<label class="qs-color"><span>' + esc(label) + '</span><input type="color" data-qs="' + path + '" value="' + esc(v) + '" aria-label="' + esc(label) + '">' +
      (opts.clearable && getPath(S.f, path) ? '<button type="button" class="qs-clear" data-qs-clear="' + path + '" aria-label="Use the main colour">&times;</button>' : '') + '</label>';
  }
  function seg(label, path, options) {
    var cur = getPath(S.f, path);
    return '<div class="qs-seg-wrap"><span class="field-label">' + esc(label) + '</span><div class="qs-seg" role="radiogroup" aria-label="' + esc(label) + '">' + options.map(function (o) {
      return '<button type="button" role="radio" aria-checked="' + (cur === o[0]) + '" class="qs-seg-btn' + (cur === o[0] ? ' is-on' : '') + '" data-qs-set="' + path + '" data-v="' + o[0] + '">' + o[1] + '</button>';
    }).join('') + '</div></div>';
  }

  function contentFields(f) {
    if (f.kind === 'link') {
      return '<div class="field"><label for="qs-link">Where should it go?</label><input type="url" id="qs-link" data-qs="link" inputmode="url" placeholder="https://lincolnacms.uk/events.html" value="' + esc(f.link) + '" autocomplete="off"></div>';
    }
    if (f.kind === 'event') {
      return '<div class="field"><label for="qs-event">Which event’s feedback form?</label><select id="qs-event" data-qs="eventSlug"><option value="">Choose an event…</option>' +
        S.events.map(function (e) { return '<option value="' + esc(e.slug) + '"' + (f.eventSlug === e.slug ? ' selected' : '') + '>' + esc(e.name) + (e.text ? ' (' + esc(e.text) + ')' : '') + '</option>'; }).join('') + '</select>' +
        '<span class="hint">Scanning opens that event’s feedback form straight away, with no need to pick the event.</span></div>';
    }
    if (f.kind === 'wifi') {
      return '<div class="qs-two"><div class="field"><label for="qs-ssid">Network name</label><input type="text" id="qs-ssid" data-qs="wifi.ssid" maxlength="64" value="' + esc(f.wifi.ssid) + '" autocomplete="off"></div>' +
        '<div class="field"><label for="qs-sec">Security</label><select id="qs-sec" data-qs="wifi.security"><option value="WPA"' + (f.wifi.security === 'WPA' ? ' selected' : '') + '>WPA / WPA2 / WPA3</option><option value="WEP"' + (f.wifi.security === 'WEP' ? ' selected' : '') + '>WEP</option><option value="nopass"' + (f.wifi.security === 'nopass' ? ' selected' : '') + '>No password</option></select></div></div>' +
        (f.wifi.security === 'nopass' ? '' : '<div class="field"><label for="qs-wpw">Password</label><input type="text" id="qs-wpw" data-qs="wifi.password" maxlength="64" value="' + esc(f.wifi.password) + '" autocomplete="off"></div>') +
        '<label class="qs-check"><input type="checkbox" data-qs="wifi.hidden"' + (f.wifi.hidden ? ' checked' : '') + '><span>Hidden network</span></label>' +
        '<p class="qs-hint">Anyone who scans this can join the network, so only put it where you want people to have access.</p>';
    }
    if (f.kind === 'email') {
      return '<div class="field"><label for="qs-to">Send to</label><input type="email" id="qs-to" data-qs="email.to" placeholder="acms@lincolnsu.com" value="' + esc(f.email.to) + '"></div>' +
        '<div class="field"><label for="qs-sub">Subject <span class="guide-optional">(optional)</span></label><input type="text" id="qs-sub" data-qs="email.subject" maxlength="150" value="' + esc(f.email.subject) + '"></div>' +
        '<div class="field"><label for="qs-body">Message <span class="guide-optional">(optional)</span></label><textarea id="qs-body" rows="3" data-qs="email.body" maxlength="500">' + esc(f.email.body) + '</textarea></div>';
    }
    if (f.kind === 'phone') {
      return '<div class="field"><label for="qs-phone">Phone number</label><input type="tel" id="qs-phone" data-qs="phone" placeholder="+44 7700 900123" value="' + esc(f.phone) + '"></div>';
    }
    return '<div class="field"><label for="qs-text">Text</label><textarea id="qs-text" rows="3" data-qs="text" maxlength="1000">' + esc(f.text) + '</textarea></div>';
  }

  function presetThumbs() {
    return '<div class="qs-presets" role="group" aria-label="Ready-made styles">' + PRESETS.map(function (p) {
      var d = Object.assign({}, designOf(p), { size: 64, caption: '', frame: 'none' });
      return '<button type="button" class="qs-preset" data-qs-preset="' + p.key + '"><span>' + Q.svg('LACMS', d) + '</span>' + esc(p.name) + '</button>';
    }).join('') + '</div>';
  }

  function editorHtml() {
    var f = S.f, dg = f.design, track = canTrack(f);
    return '<div class="qs-editor"><div class="qs-back"><button type="button" class="guide-linkbtn" data-qs-cancel>&larr; Your QR codes</button></div>' +
      '<div class="qs-layout"><div class="qs-controls">' +

      '<section class="qs-panel"><h3><span class="qs-n">1</span> What is it for?</h3>' +
      '<div class="qs-kinds" role="tablist">' + KINDS.map(function (k) { return '<button type="button" role="tab" aria-selected="' + (f.kind === k[0]) + '" class="qs-kind' + (f.kind === k[0] ? ' is-on' : '') + '" data-qs-kind="' + k[0] + '">' + k[1] + '</button>'; }).join('') + '</div>' +
      contentFields(f) +
      (track ? '<div class="qs-modes" role="radiogroup" aria-label="How the code works">' +
        '<label class="qs-mode' + (f.mode === 'tracked' ? ' is-on' : '') + '"><input type="radio" name="qs-mode" data-qs="mode" value="tracked"' + (f.mode === 'tracked' ? ' checked' : '') + (f.id && f.mode === 'direct' ? '' : '') + '><span><strong>Trackable</strong> <em>recommended</em><small>The code holds a short LACMS address. Change where it goes later, pause it, and see how many scans it gets. Needs the website to stay online.</small></span></label>' +
        '<label class="qs-mode' + (f.mode === 'direct' ? ' is-on' : '') + (f.id && f.mode === 'tracked' ? ' is-disabled' : '') + '"><input type="radio" name="qs-mode" data-qs="mode" value="direct"' + (f.mode === 'direct' ? ' checked' : '') + (f.id && f.mode === 'tracked' ? ' disabled' : '') + '><span><strong>Direct</strong><small>The code holds the link itself. It works forever and nothing is counted. The link can’t be changed after printing.</small></span></label></div>' : '<p class="qs-hint">This kind of code holds its content directly, so it can’t be counted or changed after printing.</p>') +
      '<div class="field"><label for="qs-name">Name <span class="guide-optional">(only you see this, in your library)</span></label><input type="text" id="qs-name" data-qs="name" maxlength="80" placeholder="e.g. Games Night poster" value="' + esc(f.name) + '"></div></section>' +

      '<section class="qs-panel"><h3><span class="qs-n">2</span> Style</h3>' + presetThumbs() +
      seg('Squares', 'design.shape', [['square', 'Square'], ['rounded', 'Rounded'], ['dots', 'Dots']]) +
      '<div class="qs-two">' + seg('Corner frames', 'design.eyeFrame', [['square', 'Square'], ['rounded', 'Rounded'], ['circle', 'Circle']]) + seg('Corner centres', 'design.eyePupil', [['square', 'Square'], ['rounded', 'Rounded'], ['circle', 'Circle']]) + '</div>' +
      '<div class="qs-colors">' + colorField('Code colour', 'design.fg') +
      '<label class="qs-check"><input type="checkbox" data-qs-gradient' + (dg.fg2 ? ' checked' : '') + '><span>Fade to a second colour</span></label>' +
      (dg.fg2 ? colorField('Second colour', 'design.fg2') + seg('Direction', 'design.gradient', [['diagonal', 'Diagonal'], ['vertical', 'Down'], ['horizontal', 'Across']]) : '') +
      colorField('Corner colour', 'design.eyeColor', { fallback: dg.fg, clearable: true }) + colorField('Centre colour', 'design.pupilColor', { fallback: dg.eyeColor || dg.fg, clearable: true }) +
      '<div class="qs-bg">' + (dg.bg ? colorField('Background', 'design.bg', { fallback: '#ffffff' }) : '<span class="qs-bg-off">Transparent background</span>') +
      '<label class="qs-check"><input type="checkbox" data-qs-transparent' + (dg.bg ? '' : ' checked') + '><span>Transparent</span></label></div></div>' +
      '<div class="field"><label for="qs-margin">Space around the code: <b>' + dg.margin + '</b></label><input type="range" id="qs-margin" data-qs="design.margin" min="1" max="8" step="1" value="' + dg.margin + '"></div></section>' +

      '<section class="qs-panel"><h3><span class="qs-n">3</span> Logo</h3>' +
      '<div class="qs-logo-row">' + (dg.logo ? '<img class="qs-logo-prev" src="' + esc(dg.logo) + '" alt="Your logo">' : '<span class="qs-logo-none">No logo</span>') +
      '<div class="qs-logo-btns"><label class="btn btn-outline qs-file">Upload a logo<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" data-qs-logo-file></label>' +
      '<button type="button" class="btn btn-outline" data-qs-crest>Use the LACMS crest</button>' + (dg.logo ? '<button type="button" class="guide-linkbtn" data-qs-logo-clear>Remove logo</button>' : '') + '</div></div>' +
      (dg.logo ? '<div class="field"><label for="qs-logosize">Logo size: <b>' + Math.round(dg.logoSize * 100) + '%</b> of the width</label><input type="range" id="qs-logosize" data-qs="design.logoSize" min="0.12" max="0.28" step="0.01" value="' + dg.logoSize + '"></div><p class="qs-hint">A logo hides some squares, so the code automatically uses stronger error correction.</p>' : '<p class="qs-hint">Optional. A PNG with a transparent background looks best.</p>') + '</section>' +

      '<section class="qs-panel"><h3><span class="qs-n">4</span> Words and frame</h3>' +
      '<div class="field"><label for="qs-caption">Caption <span class="guide-optional">(optional, up to 60 characters)</span></label><input type="text" id="qs-caption" data-qs="design.caption" maxlength="60" placeholder="e.g. Scan to give feedback" value="' + esc(dg.caption) + '"></div>' +
      '<div class="qs-two">' + seg('Caption goes', 'design.captionPos', [['below', 'Below'], ['above', 'Above']]) + seg('Frame', 'design.frame', [['none', 'None'], ['line', 'Outline'], ['band', 'Solid']]) + '</div>' +
      (dg.frame !== 'none' ? '<div class="qs-colors">' + colorField('Frame colour', 'design.frameColor') + '</div>' : '') + '</section>' +

      '<section class="qs-panel"><h3><span class="qs-n">5</span> Advanced</h3>' +
      '<div class="field"><label for="qs-ecc">Error correction</label><select id="qs-ecc" data-qs="design.ecc">' + [['L', 'Low (smallest code)'], ['M', 'Medium (default)'], ['Q', 'Quartile'], ['H', 'High (survives the most damage)']].map(function (o) {
        return '<option value="' + o[0] + '"' + (dg.ecc === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '<span class="hint">Higher levels still scan when a poster is creased, dirty or partly covered, but make a denser code.</span></div></section>' +
      '</div>' +

      '<aside class="qs-side"><div class="qs-preview-card"><div class="qs-preview" data-qs-preview></div>' +
      '<div class="qs-check-box" data-qs-checkbox></div>' +
      '<div class="qs-dl"><label class="qs-size"><span>PNG size</span><select data-qs-size><option value="512">512 px (web)</option><option value="1024" selected>1024 px (slides)</option><option value="2048">2048 px (print)</option><option value="4096">4096 px (large poster)</option></select></label>' +
      '<div class="qs-dl-btns"><button type="button" class="btn btn-primary" data-qs-act="png">Download PNG</button><button type="button" class="btn btn-outline" data-qs-act="svg">Download SVG</button>' +
      '<button type="button" class="btn btn-outline" data-qs-act="copy">Copy image</button><button type="button" class="btn btn-outline" data-qs-act="print">Print</button></div>' +
      '<p class="qs-dl-note" data-qs-dlnote></p></div>' +
      '<div class="qs-save"><button type="button" class="btn btn-primary btn-block qs-save-btn" data-qs-act="save">' + (f.id ? 'Save changes' : 'Save to my library') + '</button>' +
      '<p class="guide-error" data-qs-error role="alert" hidden></p><p class="qs-flash" data-qs-flash role="status">' + esc(S.flash) + '</p></div></div></aside></div></div>';
  }

  // ---- Live preview ------------------------------------------------------------------------------------
  function updatePreview() {
    var host = root.querySelector('[data-qs-preview]');
    if (!host || !S.f) return;
    var f = S.f, enc = encoded(f), box = root.querySelector('[data-qs-checkbox]'), note = root.querySelector('[data-qs-dlnote]');
    var tracked = isTracked(f), blocked = tracked && !f.code;
    if (enc.error) {
      host.innerHTML = '<div class="qs-placeholder"><span aria-hidden="true">▦</span><p>' + esc(enc.error) + '</p></div>';
      box.innerHTML = '';
      if (note) note.textContent = '';
      return;
    }
    var out;
    try { out = Q.render(enc.text, Object.assign({}, f.design, { size: 320 })); } catch (e) { host.innerHTML = '<div class="qs-placeholder"><p>That’s too much for one QR code. Shorten it.</p></div>'; box.innerHTML = ''; return; }
    host.innerHTML = '<div class="qs-art' + (f.design.bg ? '' : ' is-transparent') + '">' + out.svg + '</div>' +
      (enc.placeholder ? '<p class="qs-placeholder-note">This is a preview. Your code gets its own short address when you save it.</p>' : '');
    var chk = Q.check(enc.text, f.design);
    var labels = { good: 'Should scan well', warn: 'Check before printing', bad: 'May not scan' };
    box.innerHTML = '<div class="qs-verdict qs-verdict--' + chk.level + '"><strong>' + labels[chk.level] + '</strong><span>' + chk.modules + ' squares across · print at least ' + chk.printCm + ' cm wide</span></div>' +
      '<ul class="qs-notes">' + chk.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' +
      (out.ecc !== f.design.ecc ? '<p class="qs-hint">Error correction raised to ' + out.ecc + ' for the logo.</p>' : '');
    if (note) note.textContent = blocked ? 'Save it first. Trackable codes can only be downloaded once they have their own short address.' : '';
    Array.prototype.forEach.call(root.querySelectorAll('[data-qs-act="png"],[data-qs-act="svg"],[data-qs-act="copy"],[data-qs-act="print"]'), function (b) { b.disabled = blocked; });
  }

  // ---- Logo --------------------------------------------------------------------------------------------
  function processLogo(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var max = 256, w = img.naturalWidth || img.width || max, h = img.naturalHeight || img.height || max, k = Math.min(1, max / Math.max(w, h));
        if (!(w > 0)) { w = max; h = max; k = 1; }
        var cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
        if (!img.naturalWidth) { cw = ch = max; }
        var c = document.createElement('canvas'); c.width = cw; c.height = ch;
        c.getContext('2d').drawImage(img, 0, 0, cw, ch);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = function () { reject(new Error('That image couldn’t be read.')); };
      img.src = src;
    });
  }
  function setLogo(src) {
    return processLogo(src).then(function (url) { S.f.design.logo = url; if (S.f.design.ecc === 'L' || S.f.design.ecc === 'M') S.f.design.ecc = 'Q'; render(); },
      function (e) { showError(e.message); });
  }

  // ---- Actions ----------------------------------------------------------------------------------------------
  function showError(msg) { var el = root.querySelector('[data-qs-error]'); if (el) { el.textContent = msg; el.hidden = false; } else window.alert(msg); }
  function clearError() { var el = root.querySelector('[data-qs-error]'); if (el) el.hidden = true; }
  function fileBase(name) { return 'qr-' + String(name || 'code'); }

  function sizeValue() { var s = root.querySelector('[data-qs-size]'); return s ? +s.value : 1024; }

  function copyImage(text, design) {
    if (!(navigator.clipboard && window.ClipboardItem)) { return Promise.reject(new Error('Your browser can’t copy images. Use Download PNG instead.')); }
    return Q.pngBlob(text, design, 1024).then(function (b) { return navigator.clipboard.write([new window.ClipboardItem({ 'image/png': b })]); });
  }

  function printCode(text, design, title, line) {
    var svg = Q.svg(text, Object.assign({}, design, { size: 900 }));
    var html = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>@page{size:A4;margin:16mm}html,body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#111;text-align:center}.c{max-width:160mm;margin:8mm auto 0}svg{width:100%;height:auto;display:block}h1{font-size:24pt;margin:0 0 8mm}p{font-size:11pt;color:#444;word-break:break-all;margin:6mm 0 0}</style></head><body><div class="c"><h1>' + esc(title) + '</h1>' + svg + (line ? '<p>' + esc(line) + '</p>' : '') + '</div></body></html>';
    var fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(fr);
    var doc = fr.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
    setTimeout(function () { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(function () { fr.remove(); }, 2000); }, 300);
  }

  function save() {
    var f = S.f; clearError();
    var p = payloadOf(f);
    if (!f.name.trim()) { showError('Give the code a name so you can find it later.'); var n = root.querySelector('#qs-name'); if (n) n.focus(); return; }
    if (p.error) { showError(p.error); return; }
    var design = clone(f.design); design.fields = fieldsToSave(f);
    var btn = root.querySelector('.qs-save-btn'); if (btn) btn.disabled = true;
    supabaseClient.rpc('qr_save', { p_id: f.id, p_data: { name: f.name.trim(), kind: f.kind, mode: canTrack(f) ? f.mode : 'direct', payload: p.text, design: design } }).then(function (res) {
      if (btn) btn.disabled = false;
      if (res.error) { showError(res.error.message); return; }
      f.id = res.data.id; f.code = res.data.code;
      if (!canTrack(f)) f.mode = 'direct';
      S.flash = 'Saved to your library.' + (isTracked(f) ? ' This code is live: you can print it now.' : '');
      S.loaded = false; S.loading = false;
      load().then(function () { S.view = 'edit'; render(); });
    });
  }

  root.addEventListener('input', function (e) {
    var t = e.target;
    if (!S.f || !t.hasAttribute || !t.hasAttribute('data-qs')) return;
    if (t.type === 'radio' || t.type === 'checkbox' || t.tagName === 'SELECT') return;
    var path = t.getAttribute('data-qs'), v = t.value;
    if (t.type === 'range') {
      v = +v;
      var lab = t.parentNode.querySelector('b');
      if (lab) lab.textContent = path === 'design.logoSize' ? Math.round(v * 100) + '%' : v;
    }
    setPath(S.f, path, v);
    updatePreview();
  });

  root.addEventListener('change', function (e) {
    var t = e.target;
    if (!S.f) return;
    if (t.hasAttribute('data-qs-gradient')) { S.f.design.fg2 = t.checked ? (S.f.design.fg2 || '#7a1f1f') : ''; render(); return; }
    if (t.hasAttribute('data-qs-transparent')) { S.f.design.bg = t.checked ? '' : '#ffffff'; render(); return; }
    if (t.hasAttribute('data-qs-logo-file')) {
      var file = t.files && t.files[0]; if (!file) return;
      if (file.size > 3 * 1024 * 1024) { showError('Choose an image under 3 MB.'); return; }
      var fr = new FileReader(); fr.onload = function () { setLogo(fr.result); }; fr.readAsDataURL(file);
      return;
    }
    if (!t.hasAttribute('data-qs')) return;
    var path = t.getAttribute('data-qs'), v = t.type === 'checkbox' ? t.checked : t.value;
    if (t.type === 'radio') { if (!t.checked) return; }
    setPath(S.f, path, v);
    if (path === 'mode' || path === 'wifi.security') { render(); return; }
    updatePreview();
  });

  root.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('button') : null;
    if (!t) return;
    var v, f = S.f;
    if (t.hasAttribute('data-qs-new')) { openForm(blankForm()); return; }
    if ((v = t.getAttribute('data-qs-start')) !== null) {
      var st = STARTS[+v], nf = blankForm(st.kind);
      nf.name = st.name; if (st.link) nf.link = st.link; nf.design.caption = st.caption; nf.design.frame = 'band';
      openForm(nf); return;
    }
    if (t.hasAttribute('data-qs-cancel')) { S.view = 'list'; S.f = null; render(); return; }
    if ((v = t.getAttribute('data-qs-edit')) !== null) { var c = byId(v); if (c) openForm(formFrom(c)); return; }
    if ((v = t.getAttribute('data-qs-dup')) !== null) {
      var src = byId(v); if (!src) return;
      var df = formFrom(src); df.id = null; df.code = null; df.name = src.name + ' (copy)'; if (canTrack(df)) df.mode = 'tracked';
      openForm(df); return;
    }
    if ((v = t.getAttribute('data-qs-dl')) !== null || (v = t.getAttribute('data-qs-dl-svg')) !== null) {
      var row = byId(v); if (!row) return;
      var dg = clone(row.design || {}); delete dg.fields;
      var text = row.mode === 'tracked' ? shortLink(row.code) : row.payload;
      Q.download(text, fileBase(row.name), t.hasAttribute('data-qs-dl-svg') ? 'svg' : 'png', Object.assign({}, BASE, dg, { size: 2048 }));
      return;
    }
    if ((v = t.getAttribute('data-qs-copy')) !== null) {
      (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { t.textContent = 'Copied'; setTimeout(function () { t.textContent = 'Copy short link'; }, 1500); }, function () { window.prompt('Copy this link:', v); });
      return;
    }
    if ((v = t.getAttribute('data-qs-toggle')) !== null) {
      var cc = byId(v);
      supabaseClient.rpc('qr_set_active', { p_id: v, p_active: !cc.is_active }).then(function (r) { if (r.error) { window.alert(r.error.message); return; } S.loaded = false; S.loading = false; load(); });
      return;
    }
    if ((v = t.getAttribute('data-qs-del')) !== null) {
      var dd = byId(v);
      if (!window.confirm('Delete “' + dd.name + '”?' + (dd.mode === 'tracked' ? ' Any printed copies will stop working and its scan history is deleted.' : ''))) return;
      supabaseClient.rpc('qr_delete', { p_id: v }).then(function (r) { if (r.error) { window.alert(r.error.message); return; } S.loaded = false; S.loading = false; load(); });
      return;
    }
    if ((v = t.getAttribute('data-qs-stats')) !== null) {
      if (S.statsOpen === v) { S.statsOpen = ''; render(); return; }
      S.statsOpen = v; render();
      supabaseClient.rpc('qr_stats', { p_id: v }).then(function (r) { S.stats[v] = r.error ? { error: r.error.message } : r.data; render(); });
      return;
    }
    if (!f) return;
    if ((v = t.getAttribute('data-qs-kind')) !== null) { f.kind = v; if (!canTrack(f)) f.mode = 'direct'; else if (!f.id) f.mode = 'tracked'; render(); return; }
    if ((v = t.getAttribute('data-qs-set')) !== null) { setPath(f, v, t.getAttribute('data-v')); render(); return; }
    if ((v = t.getAttribute('data-qs-preset')) !== null) {
      var p = PRESETS.filter(function (x) { return x.key === v; })[0], keep = { logo: f.design.logo, logoSize: f.design.logoSize, caption: f.design.caption, captionPos: f.design.captionPos, margin: f.design.margin, ecc: f.design.ecc };
      f.design = Object.assign({}, designOf(p), keep);
      if (p.d.frame && !keep.caption) f.design.caption = p.d.caption || '';
      if (!p.d.frame) f.design.frame = 'none';
      render(); return;
    }
    if ((v = t.getAttribute('data-qs-clear')) !== null) { setPath(f, v, ''); render(); return; }
    if (t.hasAttribute('data-qs-logo-clear')) { f.design.logo = ''; render(); return; }
    if (t.hasAttribute('data-qs-crest')) {
      t.disabled = true;
      fetch('Media/ACMS%20Branding/logo.png').then(function (r) { return r.blob(); }).then(function (b) {
        return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.readAsDataURL(b); });
      }).then(setLogo).then(null, function () { t.disabled = false; showError('Couldn’t load the crest.'); });
      return;
    }
    if ((v = t.getAttribute('data-qs-act')) !== null) {
      var enc = encoded(f);
      if (v === 'save') { save(); return; }
      if (enc.error) { showError(enc.error); return; }
      clearError();
      if (v === 'png') Q.download(enc.text, fileBase(f.name || 'code'), 'png', Object.assign({}, f.design, { size: sizeValue() })).then(null, function (er) { showError(er.message); });
      else if (v === 'svg') Q.download(enc.text, fileBase(f.name || 'code'), 'svg', Object.assign({}, f.design, { size: 1024 }));
      else if (v === 'copy') copyImage(enc.text, f.design).then(function () { var fl = root.querySelector('[data-qs-flash]'); if (fl) fl.textContent = 'Image copied.'; }, function (er) { showError(er.message); });
      else if (v === 'print') printCode(enc.text, f.design, f.name || (f.design.caption || 'QR code'), enc.final && f.kind !== 'wifi' ? enc.final : '');
    }
  });

  function byId(id) { return S.list.filter(function (c) { return c.id === id; })[0]; }

  function render() {
    if (!S.loaded) return;
    if (S.error) { root.innerHTML = '<div class="form-note"><span>' + esc(S.error) + '</span></div>'; return; }
    root.innerHTML = (S.flash && S.view === 'list' ? '<p class="qs-flash qs-flash--top" role="status">' + esc(S.flash) + '</p>' : '') + (S.view === 'edit' && S.f ? editorHtml() : listHtml());
    if (S.view === 'edit') updatePreview();
  }

  // ---- Start: load when the tile is opened --------------------------------------------------------------------
  var card = document.querySelector('[data-dash-section="qr"]');
  if (card) {
    card.addEventListener('click', function () { if (!S.loaded && !S.loading) load(); });
    if (card.style.display !== 'none') setTimeout(function () { if (!S.loaded && !S.loading) load(); }, 2000);
  }
  if (window.location.hash === '#qr') setTimeout(function () { if (!S.loaded && !S.loading) load(); }, 900);

  // Other parts of the dashboard can open the studio with a code started for them.
  window.lacmsQRStudio = {
    open: function (opts) {
      opts = opts || {};
      var go = function () {
        var f = blankForm(opts.kind || 'link');
        if (opts.eventSlug) f.eventSlug = opts.eventSlug;
        if (opts.link) f.link = opts.link;
        if (opts.name) f.name = opts.name;
        if (opts.caption) { f.design.caption = opts.caption; f.design.frame = 'band'; }
        openForm(f);
      };
      var tile = document.querySelector('[data-dash-section="qr"]'); if (tile) tile.click();
      if (S.loaded) go(); else load().then(go);
    }
  };
})();
