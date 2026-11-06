// Unity Cup - share images.
//
// Lets anyone turn what they're looking at into a good-looking picture they can save or post: a team's line-up on
// the pitch, a day's fixtures and results, one match result, the group tables, the Player of the Tournament result
// and a raffle winner. Each is drawn straight onto a canvas (so it's sharp, works offline once the page has loaded,
// and needs no screenshot library) in two shapes: a feed Post (4:5) and a Story (9:16), at double resolution.
//
//   UnityShare.open({ kind, data, variants, filename, caption, title })
//
// The window it opens has the picture, "Share" (the phone's own share sheet with the image attached, which is the
// way to reach Instagram, WhatsApp, TikTok, Snapchat and so on), "Save image", "Copy image", and quick links for
// WhatsApp, X and Facebook (those links share the caption and the page; websites can't attach a picture to them).
//
// Nothing is uploaded anywhere: the picture is made in the visitor's own browser.

(function () {
  'use strict';

  var SITE = 'https://lincolnacms.uk/unity-cup.html';
  var W = 1080, HQ = 2;                                    // design width in px, and the export multiplier (2160 px wide)
  var SIZES = { post: { h: 1350, label: 'Post', sub: '4:5' }, story: { h: 1920, label: 'Story', sub: '9:16' } };
  var DISPLAY = "Fraunces, Georgia, 'Times New Roman', serif";
  var BODY = "Inter, -apple-system, 'Segoe UI', Arial, sans-serif";
  var GOLD = '#d4a62b', GOLD_HI = '#f1d77f', INK = '#f5f1e6', MUTED = 'rgba(245,241,230,0.68)';
  var PAD = 56;

  // ---------------------------------------------------------------------
  // Small helpers
  function F(weight, px, fam) { return weight + ' ' + Math.round(px) + 'px ' + (fam || BODY); }
  function fonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all(['800 40px Fraunces', '700 40px Fraunces', '800 24px Inter', '700 24px Inter', '600 24px Inter', '500 24px Inter'].map(function (f) { return document.fonts.load(f).catch(function () {}); }));
  }
  var imgCache = {};
  function loadImg(url) {
    if (!url) return Promise.resolve(null);
    if (imgCache[url]) return imgCache[url];
    imgCache[url] = new Promise(function (resolve) {
      var im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = function () { resolve(im); }; im.onerror = function () { resolve(null); };
      im.src = url;
    });
    return imgCache[url];
  }
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function fit(ctx, text, maxW, font, startPx, minPx) {            // the largest size (down to a minimum) at which the text fits
    var px = startPx; ctx.font = font(px);
    while (px > minPx && ctx.measureText(text).width > maxW) { px -= 2; ctx.font = font(px); }
    return px;
  }
  function trunc(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    var t = String(text); while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }
  function txt(ctx, s, x, y, o) {
    o = o || {}; ctx.font = o.font; ctx.fillStyle = o.color || INK; ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'alphabetic';
    if (o.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = o.shadow; }
    ctx.fillText(o.maxW ? trunc(ctx, s, o.maxW) : s, x, y); ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
  }
  function spaced(ctx, s, x, y, font, color, gap, align) {          // letter-spaced capitals for small headings
    ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    var chars = String(s).split(''), w = 0, i; chars.forEach(function (c) { w += ctx.measureText(c).width + gap; }); w -= gap;
    var cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    chars.forEach(function (c) { ctx.fillText(c, cx, y); cx += ctx.measureText(c).width + gap; });
    return w;
  }
  // Draws a team name beside a badge: one line if it fits, otherwise two smaller lines, otherwise cut with an ellipsis.
  function nameBlock(ctx, text, x, cy, maxW, align, px, weight, color) {
    ctx.font = F(weight, px); ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
    if (ctx.measureText(text).width <= maxW) { ctx.fillText(text, x, cy); return; }
    var p2 = Math.round(px * 0.8); ctx.font = F(weight, p2);
    var words = String(text).split(/\s+/), best = null, i;
    for (i = 1; i < words.length; i++) {
      var a = words.slice(0, i).join(' '), b = words.slice(i).join(' '), w = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
      if (!best || w < best.w) best = { a: a, b: b, w: w };
    }
    if (best && best.w <= maxW) { ctx.fillText(best.a, x, cy - p2 * 0.6); ctx.fillText(best.b, x, cy + p2 * 0.6); return; }
    if (best) { ctx.fillText(trunc(ctx, best.a, maxW), x, cy - p2 * 0.6); ctx.fillText(trunc(ctx, best.b, maxW), x, cy + p2 * 0.6); return; }
    ctx.fillText(trunc(ctx, text, maxW), x, cy);
  }
  function initials(t) { return String(t.short_name || t.name || '?').replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 3).toUpperCase() || '?'; }

  // A team's badge: its logo if it has one, otherwise its initials in its colour.
  function crest(ctx, t, cx, cy, r, imgs) {
    var col = (t && t.colour) || GOLD;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = r * 0.3; ctx.shadowOffsetY = r * 0.12;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    var g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r); g.addColorStop(0, col); g.addColorStop(1, shade(col, -0.5)); ctx.fillStyle = g; ctx.fill();
    ctx.restore();
    var im = t && t.logo && imgs ? imgs[t.logo] : null;
    if (im) {
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r - r * 0.06, 0, Math.PI * 2); ctx.clip(); ctx.fillStyle = '#fff'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      var k = Math.min((r * 1.8) / im.width, (r * 1.8) / im.height); ctx.drawImage(im, cx - im.width * k / 2, cy - im.height * k / 2, im.width * k, im.height * k); ctx.restore();
    } else txt(ctx, initials(t || {}), cx, cy + r * 0.02, { font: F(800, r * 0.78, DISPLAY), align: 'center', base: 'middle', shadow: 3 });
    ctx.lineWidth = Math.max(2, r * 0.07); ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  }
  function shade(hex, amt) {
    var n = parseInt(String(hex).replace('#', ''), 16); if (isNaN(n)) return '#222';
    function ch(v) { return Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt))); }
    return 'rgb(' + ch(n >> 16 & 255) + ',' + ch(n >> 8 & 255) + ',' + ch(n & 255) + ')';
  }

  // ---------------------------------------------------------------------
  // The branded frame every picture sits in. Returns where the content may go.
  function frame(ctx, H, o, imgs) {
    var g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0d140f'); g.addColorStop(0.5, '#090b0a'); g.addColorStop(1, '#070908');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    var glow = ctx.createRadialGradient(W / 2, -80, 0, W / 2, -80, W * 0.95); glow.addColorStop(0, 'rgba(241,215,127,0.22)'); glow.addColorStop(1, 'rgba(241,215,127,0)'); ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    var gl2 = ctx.createRadialGradient(W * 0.1, H, 0, W * 0.1, H, W * 0.7); gl2.addColorStop(0, 'rgba(30,122,70,0.22)'); gl2.addColorStop(1, 'rgba(30,122,70,0)'); ctx.fillStyle = gl2; ctx.fillRect(0, 0, W, H);
    // colours of the crest across the top
    var bw = W / 3; ctx.fillStyle = '#c1272d'; ctx.fillRect(0, 0, bw, 12); ctx.fillStyle = '#1e7a46'; ctx.fillRect(bw, 0, bw, 12); ctx.fillStyle = GOLD; ctx.fillRect(bw * 2, 0, bw, 12);
    var top = o.story ? 96 : 56, x = PAD;
    if (imgs.logo) ctx.drawImage(imgs.logo, x, top, 92, 92);
    spaced(ctx, 'LACMS UNITY CUP', x + 116, top + 38, F(800, 24), GOLD_HI, 5);
    txt(ctx, 'Lincoln African Caribbean Medical Society', x + 116, top + 74, { font: F(500, 22), color: MUTED });
    // footer
    var fy = H - (o.story ? 118 : 70);
    ctx.fillStyle = 'rgba(245,241,230,0.18)'; ctx.fillRect(PAD, fy - 34, W - PAD * 2, 2);
    txt(ctx, 'lincolnacms.uk/unity-cup', W / 2, fy + 10, { font: F(700, 30), color: INK, align: 'center' });
    ctx.fillStyle = '#c1272d'; ctx.fillRect(0, H - 12, bw, 12); ctx.fillStyle = '#1e7a46'; ctx.fillRect(bw, H - 12, bw, 12); ctx.fillStyle = GOLD; ctx.fillRect(bw * 2, H - 12, bw, 12);
    return { top: top + 92 + 28, bottom: fy - 50 };
  }
  function title(ctx, area, big, small, o) {              // big heading + small line under it; returns the y after them
    var y = area.top + 6;
    if (small) { spaced(ctx, small.toUpperCase(), PAD, y + 20, F(700, 24), GOLD_HI, 4); y += 46; }
    var px = fit(ctx, big, (o && o.maxW) || W - PAD * 2, function (p) { return F(800, p, DISPLAY); }, (o && o.size) || 92, 44);
    txt(ctx, big, PAD, y + px * 0.86, { font: F(800, px, DISPLAY), color: INK, maxW: (o && o.maxW) || W - PAD * 2, shadow: 6 });
    return y + px + 16;
  }
  function pill(ctx, label, x, y, o) {                    // a small rounded label; returns its width
    o = o || {}; ctx.font = o.font || F(800, 22); var w = ctx.measureText(label).width + 36, h = o.h || 44;
    rr(ctx, o.align === 'center' ? x - w / 2 : x, y, w, h, h / 2); ctx.fillStyle = o.bg || 'rgba(255,255,255,0.1)'; ctx.fill();
    txt(ctx, label, (o.align === 'center' ? x : x + w / 2), y + h / 2 + 1, { font: o.font || F(800, 22), color: o.color || INK, align: 'center', base: 'middle' });
    return w;
  }

  // ---------------------------------------------------------------------
  // The pictures
  var R = {};

  R.lineup = function (ctx, H, d, o, imgs) {
    var a = frame(ctx, H, o, imgs), t = d.team;
    var cr = o.story ? 64 : 54;
    crest(ctx, t, W - PAD - cr, a.top + cr - 6, cr, imgs);
    var y = title(ctx, a, t.name, (d.group ? d.group + ' · ' : '') + 'Line-up', { maxW: W - PAD * 2 - cr * 2 - 24 });
    var avail = a.bottom - y - (d.hasRoles ? 50 : 10), asp = window.UnityPitch ? UnityPitch.aspect(d.players) : 0;
    if (!asp) { txt(ctx, 'No line-up yet', W / 2, y + 120, { font: F(600, 40), color: MUTED, align: 'center' }); return; }
    var pw = Math.min(W - PAD * 2, avail / asp), ph = pw * asp, px = (W - pw) / 2, py = y + Math.max(0, (avail - ph) / 2);
    UnityPitch.draw(ctx, px, py, pw, d.players, { colour: t.colour });
    if (d.hasRoles) {
      var ly = py + ph + 34, gx = W / 2 - 200;
      [['C', 'Captain', GOLD_HI], ['VC', 'Vice-captain', '#d9dde3']].forEach(function (r, i) {
        var cx = gx + i * 220 + 22; ctx.beginPath(); ctx.arc(cx, ly - 8, 20, 0, Math.PI * 2); ctx.fillStyle = r[2]; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
        txt(ctx, r[0], cx, ly - 7, { font: F(800, r[0] === 'C' ? 22 : 17), color: '#17130a', align: 'center', base: 'middle' });
        txt(ctx, r[1], cx + 34, ly, { font: F(600, 24), color: MUTED });
      });
    }
  };

  function statusOf(f) {
    if (f.status === 'live') return { text: 'LIVE', bg: 'rgba(79,209,134,0.22)', color: '#4fd186' };
    if (f.status === 'finished') return { text: 'FULL TIME', bg: 'rgba(255,255,255,0.1)', color: INK };
    if (f.status === 'postponed') return { text: 'POSTPONED', bg: 'rgba(193,39,45,0.25)', color: '#ff8a8e' };
    return { text: f.time || 'TBC', bg: 'rgba(212,166,43,0.2)', color: GOLD_HI };
  }
  function scoreOf(f) { return f.hs != null && f.as != null && f.status !== 'scheduled' && f.status !== 'postponed'; }

  R.fixtures = function (ctx, H, d, o, imgs) {
    var a = frame(ctx, H, o, imgs), y = title(ctx, a, d.title || 'Fixtures', d.subtitle || '');
    var list = d.fixtures || [], maxRows = o.story ? 10 : 6;
    var shown = list.slice(0, maxRows), more = list.length - shown.length;
    var avail = a.bottom - y - (more > 0 ? 44 : 0), gap = 14, rowH = Math.min(o.story ? 190 : 152, (avail - gap * (shown.length - 1)) / Math.max(1, shown.length));
    var k = Math.max(0.85, Math.min(1.25, rowH / 150));
    shown.forEach(function (f, i) {
      var ry = y + 8 + i * (rowH + gap), rx = PAD, rw = W - PAD * 2, cy = ry + rowH / 2, st = statusOf(f), live = f.status === 'live';
      rr(ctx, rx, ry, rw, rowH, 26); ctx.fillStyle = live ? 'rgba(79,209,134,0.1)' : 'rgba(255,255,255,0.06)'; ctx.fill();
      ctx.lineWidth = live ? 3 : 2; ctx.strokeStyle = live ? 'rgba(79,209,134,0.7)' : 'rgba(255,255,255,0.12)'; ctx.stroke();
      var pillY = cy - (f.stage || f.pitch ? 40 : 22);
      pill(ctx, st.text, rx + 28, pillY, { bg: st.bg, color: st.color, font: F(800, 24) });
      var sub = [f.stage, f.pitch].filter(Boolean).join(' · ');
      if (sub) txt(ctx, sub, rx + 30, pillY + 76, { font: F(500, 22), color: MUTED, maxW: 190 });
      var mid = rx + 200 + (rw - 200) / 2, r = Math.min(34 * k, rowH * 0.3);
      var has = scoreOf(f), win = has && f.status === 'finished' ? (f.hs > f.as ? 'h' : f.hs < f.as ? 'a' : '') : '';
      var boxW = 150 * k;
      crest(ctx, f.home, mid - boxW / 2 - 14 - r, cy, r, imgs); crest(ctx, f.away, mid + boxW / 2 + 14 + r, cy, r, imgs);
      var nameW = (rw - 200) / 2 - boxW / 2 - 14 - r * 2 - 22;
      nameBlock(ctx, f.home.name, mid - boxW / 2 - 14 - r * 2 - 14, cy, nameW, 'right', 32 * k, win === 'h' ? 800 : 700, win === 'h' ? GOLD_HI : INK);
      nameBlock(ctx, f.away.name, mid + boxW / 2 + 14 + r * 2 + 14, cy, nameW, 'left', 32 * k, win === 'a' ? 800 : 700, win === 'a' ? GOLD_HI : INK);
      if (has) txt(ctx, f.hs + ' - ' + f.as, mid, cy + 2, { font: F(800, 60 * k, DISPLAY), color: live ? '#4fd186' : INK, align: 'center', base: 'middle' });
      else txt(ctx, 'v', mid, cy, { font: F(700, 36 * k), color: MUTED, align: 'center', base: 'middle' });
    });
    if (more > 0) txt(ctx, '+ ' + more + ' more on the website', W / 2, a.bottom - 6, { font: F(600, 26), color: MUTED, align: 'center' });
    if (!shown.length) txt(ctx, 'No fixtures yet', W / 2, y + 160, { font: F(600, 40), color: MUTED, align: 'center' });
  };

  R.match = function (ctx, H, d, o, imgs) {
    var f = d.fixture, a = frame(ctx, H, o, imgs), st = statusOf(f), has = scoreOf(f);
    var r = o.story ? 150 : 132, sub = [f.stage, f.pitch, f.status === 'scheduled' ? '' : f.time].filter(Boolean).join(' · ');
    // Who scored: up to four names under each team (the rest are summarised)
    var sg = has && f.goals ? f.goals : { h: [], a: [] }, sRows = Math.min(5, Math.max(sg.h.length, sg.a.length)), sH = sRows ? 34 + sRows * 46 : 0;
    var block = 64 + 56 + 70 + r * 2 + 130 + (f.note ? 60 : 0) + sH, top = a.top + Math.max(10, (a.bottom - a.top - block) / 2) - 20;
    var cy = top + 64 + 56 + 70 + r;
    pill(ctx, st.text, W / 2, top, { bg: st.bg, color: st.color, font: F(800, 34), h: 64, align: 'center' });
    if (sub) txt(ctx, sub, W / 2, top + 64 + 50, { font: F(600, 30), color: MUTED, align: 'center', maxW: W - PAD * 2 });
    var lx = PAD + 190, rx = W - PAD - 190;
    crest(ctx, f.home, lx, cy, r, imgs); crest(ctx, f.away, rx, cy, r, imgs);
    nameBlock(ctx, f.home.name, lx, cy + r + 70, 340, 'center', 44, 800, INK);
    nameBlock(ctx, f.away.name, rx, cy + r + 70, 340, 'center', 44, 800, INK);
    if (has) {
      txt(ctx, String(f.hs), W / 2 - 78, cy + 6, { font: F(800, 170, DISPLAY), color: f.status === 'live' ? '#4fd186' : INK, align: 'center', base: 'middle', shadow: 10 });
      txt(ctx, '-', W / 2, cy + 6, { font: F(700, 90, DISPLAY), color: MUTED, align: 'center', base: 'middle' });
      txt(ctx, String(f.as), W / 2 + 78, cy + 6, { font: F(800, 170, DISPLAY), color: f.status === 'live' ? '#4fd186' : INK, align: 'center', base: 'middle', shadow: 10 });
    } else txt(ctx, 'v', W / 2, cy, { font: F(700, 90, DISPLAY), color: MUTED, align: 'center', base: 'middle' });
    if (sRows) {
      var sy = cy + r + 150;
      [[sg.h, lx], [sg.a, rx]].forEach(function (col) {
        var list = col[0].slice(0, sRows);
        if (col[0].length > sRows) list[sRows - 1] = '+ ' + (col[0].length - sRows + 1) + ' more';
        list.forEach(function (line, i) { txt(ctx, line, col[1], sy + i * 46, { font: F(600, 32), color: INK, align: 'center', base: 'middle', maxW: 420 }); });
      });
    }
    if (f.note) txt(ctx, f.note, W / 2, cy + r + 150 + sH, { font: F(600, 30), color: MUTED, align: 'center', maxW: W - PAD * 2 });
  };

  R.tables = function (ctx, H, d, o, imgs) {
    var a = frame(ctx, H, o, imgs), y = title(ctx, a, d.title || 'Group tables', d.subtitle || '');
    var groups = d.groups || [], rowsTotal = groups.reduce(function (n, g) { return n + g.rows.length + 2; }, 0);
    var rowH = Math.max(46, Math.min(o.story ? 104 : 92, (a.bottom - y - 10) / Math.max(1, rowsTotal))), yy = y + 6, k = rowH / 64;
    var cols = [['P', 720], ['W', 780], ['D', 836], ['L', 892], ['GD', 958], ['PTS', 1020]];
    groups.forEach(function (g) {
      txt(ctx, g.name, PAD, yy + rowH * 0.7, { font: F(800, Math.min(44, rowH * 0.7), DISPLAY), color: GOLD_HI });
      yy += rowH * 1.1;
      cols.forEach(function (c) { txt(ctx, c[0], c[1], yy + rowH * 0.45, { font: F(700, 22), color: MUTED, align: 'center', base: 'middle' }); });
      yy += rowH * 0.5;
      g.rows.forEach(function (r, i) {
        rr(ctx, PAD, yy, W - PAD * 2, rowH - 6, 16); ctx.fillStyle = i === 0 && r.p ? 'rgba(212,166,43,0.16)' : 'rgba(255,255,255,0.05)'; ctx.fill();
        var cr = Math.min(30, rowH * 0.32); crest(ctx, r.t, PAD + 24 + cr, yy + (rowH - 6) / 2, cr, imgs);
        txt(ctx, r.t.name, PAD + 24 + cr * 2 + 16, yy + (rowH - 6) / 2, { font: F(700, Math.min(34, rowH * 0.48)), base: 'middle', maxW: 470 });
        var vals = [r.p, r.w, r.d, r.l, (r.gf - r.ga > 0 ? '+' : '') + (r.gf - r.ga), r.pts];
        vals.forEach(function (v, k) { txt(ctx, String(v), cols[k][1], yy + (rowH - 6) / 2, { font: F(k === 5 ? 800 : 600, Math.min(32, rowH * 0.46)), color: k === 5 ? GOLD_HI : INK, align: 'center', base: 'middle' }); });
        yy += rowH;
      });
      yy += rowH * 0.4;
    });
    if (!groups.length) txt(ctx, 'No tables yet', W / 2, y + 160, { font: F(600, 40), color: MUTED, align: 'center' });
  };

  R.winner = function (ctx, H, d, o, imgs) {
    var a = frame(ctx, H, o, imgs), w = d.winner, others = d.others || [];
    spaced(ctx, 'PLAYER OF THE TOURNAMENT', W / 2, a.top + 34, F(800, 28), GOLD_HI, 6, 'center');
    var cy = a.top + (o.story ? 330 : 290), r = o.story ? 190 : 170;
    ctx.save(); var glow = ctx.createRadialGradient(W / 2, cy, r * 0.6, W / 2, cy, r * 2.1); glow.addColorStop(0, 'rgba(241,215,127,0.4)'); glow.addColorStop(1, 'rgba(241,215,127,0)'); ctx.fillStyle = glow; ctx.fillRect(0, cy - r * 2.2, W, r * 4.4); ctx.restore();
    ctx.beginPath(); ctx.arc(W / 2, cy, r + 16, 0, Math.PI * 2); ctx.fillStyle = GOLD; ctx.fill();
    ctx.beginPath(); ctx.arc(W / 2, cy, r, 0, Math.PI * 2); var g = ctx.createLinearGradient(W / 2 - r, cy - r, W / 2 + r, cy + r); g.addColorStop(0, w.colour || GOLD); g.addColorStop(1, shade(w.colour || GOLD, -0.55)); ctx.fillStyle = g; ctx.fill();
    txt(ctx, initials({ name: w.name }), W / 2, cy + 6, { font: F(800, r * 0.9, DISPLAY), align: 'center', base: 'middle', shadow: 8 });
    // star
    ctx.fillStyle = GOLD_HI; ctx.font = F(800, 74); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 8; ctx.fillText('★', W / 2, cy - r - 44); ctx.shadowBlur = 0;
    var ny = cy + r + 90, px = fit(ctx, w.name, W - PAD * 2, function (v) { return F(800, v, DISPLAY); }, 96, 52);
    txt(ctx, w.name, W / 2, ny, { font: F(800, px, DISPLAY), align: 'center', maxW: W - PAD * 2, shadow: 8 });
    if (w.team) txt(ctx, w.team, W / 2, ny + 52, { font: F(600, 34), color: MUTED, align: 'center', maxW: W - PAD * 2 });
    txt(ctx, w.votes + (w.votes === 1 ? ' vote' : ' votes') + (w.pct != null ? '  ·  ' + w.pct + '%' : ''), W / 2, ny + 112, { font: F(800, 40), color: GOLD_HI, align: 'center' });
    var by = ny + 170, rowH = o.story ? 78 : 66, max = Math.max(1, w.votes);
    others.slice(0, o.story ? 5 : 3).forEach(function (p, i) {
      var yy = by + i * rowH; if (yy + rowH > a.bottom + 10) return;
      txt(ctx, (i + 2) + '', PAD + 14, yy + rowH / 2, { font: F(800, 28), color: MUTED, base: 'middle' });
      txt(ctx, p.name, PAD + 64, yy + rowH / 2 - 8, { font: F(700, 30), base: 'middle', maxW: 520 });
      var bw = W - PAD * 2 - 64 - 190, bx = PAD + 64; rr(ctx, bx, yy + rowH / 2 + 8, bw, 12, 6); ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fill();
      rr(ctx, bx, yy + rowH / 2 + 8, Math.max(12, bw * p.votes / max), 12, 6); ctx.fillStyle = p.colour || GOLD; ctx.fill();
      txt(ctx, p.votes + ' · ' + (p.pct != null ? p.pct + '%' : ''), W - PAD - 6, yy + rowH / 2, { font: F(700, 26), color: MUTED, align: 'right', base: 'middle' });
    });
  };

  R.raffle = function (ctx, H, d, o, imgs) {
    var a = frame(ctx, H, o, imgs), cy = a.top + (a.bottom - a.top) * 0.4;
    spaced(ctx, 'CHARITY RAFFLE', W / 2, a.top + 34, F(800, 28), GOLD_HI, 6, 'center');
    txt(ctx, 'We have a winner!', W / 2, a.top + 128, { font: F(800, 84, DISPLAY), align: 'center', shadow: 8 });
    // confetti, the same every time
    var seed = 7, cols = ['#d4a62b', '#f1d77f', '#1e7a46', '#c1272d', '#ffffff'], i;
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    for (i = 0; i < 70; i++) { var x = rnd() * W, yy = a.top + 160 + rnd() * (a.bottom - a.top - 200); ctx.save(); ctx.translate(x, yy); ctx.rotate(rnd() * 6); ctx.fillStyle = cols[i % 5]; ctx.globalAlpha = 0.55; ctx.fillRect(-9, -4, 18, 8); ctx.restore(); }
    // ticket
    var tw = 560, th = 300, tx = (W - tw) / 2, ty = cy - th / 2 + 40;
    ctx.save(); ctx.translate(W / 2, cy + 40); ctx.rotate(-0.04); ctx.translate(-W / 2, -(cy + 40));
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 14;
    rr(ctx, tx, ty, tw, th, 26); var g = ctx.createLinearGradient(tx, ty, tx + tw, ty + th); g.addColorStop(0, GOLD_HI); g.addColorStop(1, GOLD); ctx.fillStyle = g; ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#0a0d0b'; ctx.beginPath(); ctx.arc(tx, ty + th / 2, 30, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(tx + tw, ty + th / 2, 30, 0, Math.PI * 2); ctx.fill();
    spaced(ctx, 'WINNING TICKET', W / 2, ty + 70, F(800, 28), '#17130a', 6, 'center');
    txt(ctx, '#' + d.ticket, W / 2, ty + th / 2 + 52, { font: F(800, 150, DISPLAY), color: '#17130a', align: 'center', base: 'middle' });
    ctx.restore();
    var ny = ty + th + 120, px = fit(ctx, d.name, W - PAD * 2, function (v) { return F(800, v, DISPLAY); }, 100, 54);
    txt(ctx, d.name, W / 2, ny, { font: F(800, px, DISPLAY), align: 'center', maxW: W - PAD * 2, shadow: 8 });
    txt(ctx, 'wins ' + d.prize, W / 2, ny + 64, { font: F(700, 44), color: GOLD_HI, align: 'center', maxW: W - PAD * 2 });
    txt(ctx, 'Thank you to everyone who donated', W / 2, a.bottom - 8, { font: F(600, 28), color: MUTED, align: 'center' });
  };

  // ---------------------------------------------------------------------
  // Making the picture
  function collectLogos(data) {
    var urls = {};
    (function walk(v) { if (!v || typeof v !== 'object') return; if (typeof v.logo === 'string' && v.logo) urls[v.logo] = 1; Object.keys(v).forEach(function (k) { if (k !== 'logo') walk(v[k]); }); })(data);
    return Object.keys(urls);
  }
  function render(kind, data, fmt) {
    var size = SIZES[fmt] || SIZES.post, o = { story: fmt === 'story' }, H = size.h;
    var logos = collectLogos(data);
    return Promise.all([fonts(), loadImg('Media/ACMS%20Branding/logo.png')].concat(logos.map(loadImg))).then(function (res) {
      var imgs = { logo: res[1] }; logos.forEach(function (u, i) { imgs[u] = res[2 + i]; });
      var cv = document.createElement('canvas'); cv.width = W * HQ; cv.height = H * HQ;
      var ctx = cv.getContext('2d'); ctx.scale(HQ, HQ); ctx.textBaseline = 'alphabetic';
      R[kind](ctx, H, data, o, imgs);
      // Two files from one drawing: a lossless PNG to save, and a much smaller high-quality JPEG for sending through
      // the phone's share sheet (chat apps and social sites squash images anyway, so the smaller file uploads faster).
      function enc(type, q) { return new Promise(function (resolve, reject) { cv.toBlob(function (b) { b ? resolve(b) : reject(new Error('Could not make the image')); }, type, q); }); }
      return Promise.all([enc('image/png'), enc('image/jpeg', 0.93)]).then(function (r) { return { png: r[0], jpg: r[1] }; });
    });
  }

  // ---------------------------------------------------------------------
  // The window
  var els = null, state = null, lastFocus = null;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function build() {
    var m = document.createElement('div');
    m.className = 'us-modal'; m.hidden = true;
    m.innerHTML = '<div class="us-backdrop" data-us-close></div><div class="us-panel" role="dialog" aria-modal="true" aria-labelledby="us-title" tabindex="-1">' +
      '<button type="button" class="us-x" data-us-close aria-label="Close">&times;</button>' +
      '<h2 class="us-title" id="us-title">Share</h2>' +
      '<div class="us-chips" data-us-variants role="group" aria-label="What to share"></div>' +
      '<div class="us-stage"><div class="us-busy" data-us-busy><span class="us-spin" aria-hidden="true"></span><span>Making your image&hellip;</span></div><img class="us-img" data-us-img alt="Preview of the image you can share"></div>' +
      '<div class="us-chips us-chips--fmt" role="group" aria-label="Shape"><button type="button" class="us-chip" data-us-fmt="post">Post <small>4:5</small></button><button type="button" class="us-chip" data-us-fmt="story">Story <small>9:16</small></button></div>' +
      '<div class="us-actions"><button type="button" class="uc-btn uc-btn--gold" data-us-share hidden>Share&hellip;</button><button type="button" class="uc-btn uc-btn--gold" data-us-save>Save image</button><button type="button" class="uc-btn uc-btn--ghost" data-us-copy hidden>Copy image</button></div>' +
      '<div class="us-social"><span>Post to</span><a data-us-wa target="_blank" rel="noopener">WhatsApp</a><a data-us-x target="_blank" rel="noopener">X</a><a data-us-fb target="_blank" rel="noopener">Facebook</a><button type="button" data-us-cap>Copy caption</button></div>' +
      '<p class="us-hint" data-us-hint>For Instagram, TikTok or Snapchat: save the image (or press Share on your phone), then add it to your post or story.</p>' +
      '<p class="us-msg" data-us-msg role="status" aria-live="polite"></p></div>';
    document.body.appendChild(m);
    els = { m: m, panel: m.querySelector('.us-panel'), img: m.querySelector('[data-us-img]'), busy: m.querySelector('[data-us-busy]'), variants: m.querySelector('[data-us-variants]'), msg: m.querySelector('[data-us-msg]'), title: m.querySelector('#us-title') };
    m.addEventListener('click', onClick);
    document.addEventListener('keydown', function (e) {
      if (m.hidden) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'Tab') {
        var f = Array.prototype.slice.call(els.panel.querySelectorAll('button:not([disabled]):not([hidden]), a[href]')).filter(function (n) { return n.offsetParent !== null; });
        if (!f.length) return; var first = f[0], last = f[f.length - 1];
        if (!els.panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }
  function say(t, bad) { els.msg.textContent = t || ''; els.msg.className = 'us-msg' + (t ? (bad ? ' is-bad' : ' is-ok') : ''); }
  function file() { return new File([state.jpg], state.filename + '-' + state.fmt + '.jpg', { type: 'image/jpeg' }); }
  function pngName() { return state.filename + '-' + state.fmt + '.png'; }
  function caption() { return state.variant.caption || state.caption || ''; }

  function refresh() {
    var v = state.variants[state.vi]; state.variant = v;
    els.busy.hidden = false; els.img.style.visibility = 'hidden'; say('');
    var token = ++state.token;
    els.m.querySelectorAll('[data-us-fmt]').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-us-fmt') === state.fmt); b.setAttribute('aria-pressed', b.getAttribute('data-us-fmt') === state.fmt); });
    els.m.querySelectorAll('[data-us-vi]').forEach(function (b) { b.classList.toggle('is-on', Number(b.getAttribute('data-us-vi')) === state.vi); b.setAttribute('aria-pressed', Number(b.getAttribute('data-us-vi')) === state.vi); });
    els.img.className = 'us-img us-img--' + state.fmt;
    var cap = caption();
    els.m.querySelector('[data-us-wa]').href = 'https://wa.me/?text=' + encodeURIComponent(cap + ' ' + state.site);
    els.m.querySelector('[data-us-x]').href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(cap) + '&url=' + encodeURIComponent(state.site);
    els.m.querySelector('[data-us-fb]').href = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(state.site) + '&quote=' + encodeURIComponent(cap);
    render(v.kind || state.kind, v.data, state.fmt).then(function (res) {
      if (token !== state.token) return;
      var blob = res.png; state.blob = blob; state.jpg = res.jpg; if (state.url) URL.revokeObjectURL(state.url); state.url = URL.createObjectURL(blob);
      els.img.src = state.url; els.img.onload = function () { els.busy.hidden = true; els.img.style.visibility = 'visible'; };
      var can = !!(navigator.canShare && navigator.canShare({ files: [file()] }));
      els.m.querySelector('[data-us-share]').hidden = !(can || navigator.share);
      els.m.querySelector('[data-us-copy]').hidden = !(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write);
      state.canFiles = can;
    }, function () { if (token === state.token) { els.busy.hidden = true; say('Sorry, the image couldn\'t be made. Please try again.', true); } });
  }

  function onClick(e) {
    var t = e.target;
    if (t.closest('[data-us-close]')) { close(); return; }
    var f = t.closest('[data-us-fmt]'); if (f) { state.fmt = f.getAttribute('data-us-fmt'); try { localStorage.setItem('lacms-share-fmt', state.fmt); } catch (x) {} refresh(); return; }
    var v = t.closest('[data-us-vi]'); if (v) { state.vi = Number(v.getAttribute('data-us-vi')); refresh(); return; }
    if (!state.blob) return;
    if (t.closest('[data-us-save]')) {
      var a = document.createElement('a'); a.href = state.url; a.download = pngName(); document.body.appendChild(a); a.click(); a.remove();
      say('Saved. If nothing downloaded, touch and hold the picture and choose Save image.'); return;
    }
    if (t.closest('[data-us-share]')) {
      var data = state.canFiles ? { files: [file()], title: state.title, text: caption() } : { title: state.title, text: caption(), url: state.site };
      navigator.share(data).then(function () { say(state.canFiles ? 'Shared!' : 'Shared the link. To include the picture, save it and add it to your post.'); }, function (err) { if (err && err.name !== 'AbortError') say('Couldn\'t open sharing. Try Save image instead.', true); });
      return;
    }
    if (t.closest('[data-us-copy]')) {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': state.blob })]).then(function () { say('Image copied. Paste it into a message or post.'); }, function () { say('Couldn\'t copy the image here. Use Save image instead.', true); });
      return;
    }
    if (t.closest('[data-us-cap]')) {
      var text = caption() + ' ' + state.site;
      (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { say('Caption copied.'); }, function () { say('Couldn\'t copy. The caption is: ' + text, true); });
    }
  }

  function open(opts) {
    if (!els) build();
    lastFocus = document.activeElement;
    var variants = opts.variants && opts.variants.length ? opts.variants : [{ label: '', data: opts.data, kind: opts.kind, caption: opts.caption }];
    var fmt = 'post'; try { fmt = localStorage.getItem('lacms-share-fmt') === 'story' ? 'story' : 'post'; } catch (x) {}
    state = { kind: opts.kind, variants: variants, vi: Math.max(0, Math.min(variants.length - 1, opts.start || 0)), fmt: fmt, site: opts.url || SITE, title: opts.title || 'LACMS Unity Cup', filename: opts.filename || 'lacms-unity-cup', caption: opts.caption || '', token: 0, blob: null, url: null };
    els.title.textContent = opts.heading || 'Share this';
    els.variants.innerHTML = variants.length > 1 ? variants.map(function (v, i) { return '<button type="button" class="us-chip" data-us-vi="' + i + '">' + esc(v.label) + '</button>'; }).join('') : '';
    els.variants.hidden = variants.length < 2;
    els.m.hidden = false; document.body.classList.add('uc-modal-open');
    requestAnimationFrame(function () { els.m.classList.add('is-open'); els.panel.focus(); });
    refresh();
  }
  function close() {
    if (!els || els.m.hidden) return;
    els.m.classList.remove('is-open'); document.body.classList.remove('uc-modal-open');
    window.setTimeout(function () { els.m.hidden = true; if (state && state.url) { URL.revokeObjectURL(state.url); state.url = null; } els.img.removeAttribute('src'); }, 200);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    if (state) state.token++;
  }

  window.UnityShare = { open: open, close: close, render: render, SITE: SITE };
})();
