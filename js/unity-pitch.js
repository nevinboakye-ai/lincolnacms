// Unity Cup - the line-up pitch.
//
// Turns a team's players into a football-pitch picture in 3D perspective: the pitch recedes into the
// distance (goalkeeper and defenders far away, attackers close to the viewer) and each player stands upright
// on it as a shirt over a name plate.
//
// Players are placed by their "position" (Goalkeeper, Defender, Midfielder, Forward and common short forms).
// Players whose position isn't recognised (or is blank) are listed under the pitch instead.
//
// HOW THE 3D WORKS (and why it is built this way): there is no CSS 3D here at all. CSS 3D (preserve-3d,
// perspective, rotateX) is handled differently from browser to browser and is easily flattened by ancestors
// (overflow, filters, containment), which breaks the effect. Instead this file does the perspective maths
// itself: the pitch is a flat rectangle tilted back by a fixed angle and seen through a pinhole camera, every
// corner / line / player position is projected to the screen with the same formula, and the result is drawn
// as one SVG (grass, stripes, markings, shadows) with the player cards placed on top at the projected
// positions. Plain 2D layout means it looks the same everywhere and scales cleanly with its container.
//
// Used by the public page (team pop-up) and the committee panel (line-up preview).

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Positions
  var LINES = [
    { key: 'gk', label: 'Goalkeeper', re: /\b(gk|goalie|goalkeeper|keeper|goal keeper|goalminder)\b/ },
    { key: 'def', label: 'Defence', re: /\b(def|defence|defense|defender|cb|lb|rb|lwb|rwb|centre[- ]?back|center[- ]?back|full[- ]?back|wing[- ]?back|left[- ]?back|right[- ]?back|back|sweeper)\b/ },
    { key: 'mid', label: 'Midfield', re: /\b(mid|midfield|midfielder|cm|cdm|cam|dm|am|lm|rm|centre[- ]?mid|center[- ]?mid|playmaker)\b/ },
    { key: 'fwd', label: 'Attack', re: /\b(fwd|fw|forward|striker|st|cf|winger|wing|lw|rw|attacker|attack|ss|number ?9)\b/ }
  ];
  var ABBR = { gk: 'GK', def: 'DEF', mid: 'MID', fwd: 'FWD' };

  function lineOf(position) {
    var p = String(position || '').toLowerCase().replace(/[.,/]/g, ' ').trim();
    if (!p) return null;
    for (var i = 0; i < LINES.length; i++) if (LINES[i].re.test(p)) return LINES[i].key;
    return null;
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function shirtNum(p) { var n = parseInt(p.shirt_no, 10); return isNaN(n) ? 999 : n; }
  function byShirt(a, b) { return shirtNum(a) - shirtNum(b) || String(a.name).localeCompare(String(b.name)); }
  function r1(n) { return Math.round(n * 10) / 10; }

  // ---------------------------------------------------------------------
  // The camera. The pitch is PW x PH "pitch units" (far end at y = 0, near end at y = PH), tilted back by TILT
  // about its near edge and viewed from distance DIST. proj() returns where a pitch point lands in the picture
  // (X across, Y measured up from the near edge, so negative) and the perspective scale s at that point.
  var PW = 300, PH = 600, TILT = 36 * Math.PI / 180, DIST = 470;
  var COS = Math.cos(TILT), SIN = Math.sin(TILT);

  function proj(x, y) {
    var dx = x - PW / 2, dy = y - PH, z = dy * SIN, s = DIST / (DIST - z);
    return { X: PW / 2 + dx * s, Y: dy * COS * s, s: s };
  }
  // The opposite: which pitch depth lands at picture height Y (used to space the rows evenly on screen).
  function depthFor(Y) { var dy = (Y * DIST) / (DIST * COS + Y * SIN); return PH + dy; }

  function pt(x, y) { var q = proj(x, y); return r1(q.X) + ',' + r1(q.Y); }
  function poly(pts) { return pts.map(function (p) { return pt(p[0], p[1]); }).join(' '); }
  // A line on the pitch, drawn thicker when nearer so the markings keep their perspective.
  function seg(x1, y1, x2, y2, w) {
    var a = proj(x1, y1), b = proj(x2, y2), s = (a.s + b.s) / 2;
    return '<line x1="' + r1(a.X) + '" y1="' + r1(a.Y) + '" x2="' + r1(b.X) + '" y2="' + r1(b.Y) + '" stroke-width="' + r1((w || 2.2) * s) + '"/>';
  }
  function arc(cx, cy, r, from, to, keep, w) {
    var out = '', n = Math.max(8, Math.round(Math.abs(to - from) * 14)), prev = null, i;
    for (i = 0; i <= n; i++) {
      var t = from + (to - from) * (i / n), p = [cx + r * Math.cos(t), cy + r * Math.sin(t)];
      if (prev && (!keep || (keep(prev) && keep(p)))) out += seg(prev[0], prev[1], p[0], p[1], w);
      prev = p;
    }
    return out;
  }
  function dot(x, y, r) { var q = proj(x, y), rx = r * q.s; return '<ellipse cx="' + r1(q.X) + '" cy="' + r1(q.Y) + '" rx="' + r1(rx) + '" ry="' + r1(rx * COS) + '" class="up-dot"/>'; }

  // The pitch markings as plain data (line segments and spots), so the on-screen SVG and the shareable image
  // draw exactly the same lines.
  function marking() {
    var m = 14, segs = [], dots = [];
    function S(x1, y1, x2, y2) { segs.push([x1, y1, x2, y2]); }
    function A(cx, cy, r, from, to, keep) {
      var n = Math.max(8, Math.round(Math.abs(to - from) * 14)), prev = null, i;
      for (i = 0; i <= n; i++) {
        var t = from + (to - from) * (i / n), p = [cx + r * Math.cos(t), cy + r * Math.sin(t)];
        if (prev && (!keep || (keep(prev) && keep(p)))) S(prev[0], prev[1], p[0], p[1]);
        prev = p;
      }
    }
    S(m, m, PW - m, m); S(PW - m, m, PW - m, PH - m); S(PW - m, PH - m, m, PH - m); S(m, PH - m, m, m);   // outer lines
    S(m, PH / 2, PW - m, PH / 2);                                                                         // halfway line
    A(PW / 2, PH / 2, 44, 0, Math.PI * 2, null); dots.push([PW / 2, PH / 2, 2.6]);                          // centre circle
    S(70, m, 70, 94); S(70, 94, 230, 94); S(230, 94, 230, m); S(112, m, 112, 46); S(112, 46, 188, 46); S(188, 46, 188, m);   // far end
    dots.push([PW / 2, 72, 2]); A(PW / 2, 72, 36, 0, Math.PI, function (p) { return p[1] >= 94; });
    S(70, PH - m, 70, PH - 94); S(70, PH - 94, 230, PH - 94); S(230, PH - 94, 230, PH - m); S(112, PH - m, 112, PH - 46); S(112, PH - 46, 188, PH - 46); S(188, PH - 46, 188, PH - m);   // near end
    dots.push([PW / 2, PH - 72, 2]); A(PW / 2, PH - 72, 36, Math.PI, Math.PI * 2, function (p) { return p[1] <= PH - 94; });
    return { segs: segs, dots: dots };
  }

  function pitchSvg(vb, spots) {
    var i, out = '';
    var far = proj(0, 0), nearL = proj(0, PH), nearR = proj(PW, PH);
    out += '<defs>' +
      '<linearGradient id="up-haze" gradientUnits="userSpaceOnUse" x1="0" y1="' + r1(far.Y) + '" x2="0" y2="' + r1(far.Y + 110) + '"><stop offset="0" stop-color="#0a0d0b" stop-opacity="0.8"/><stop offset="1" stop-color="#0a0d0b" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="up-slab" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#103821"/><stop offset="1" stop-color="#050f09"/></linearGradient>' +
      '<radialGradient id="up-spot"><stop offset="0" stop-color="#000" stop-opacity="0.6"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>' +
      '</defs>';
    out += '<polygon class="up-slab" points="' + r1(nearL.X) + ',' + r1(nearL.Y) + ' ' + r1(nearR.X) + ',' + r1(nearR.Y) + ' ' + r1(nearR.X) + ',' + r1(nearR.Y + 15) + ' ' + r1(nearL.X) + ',' + r1(nearL.Y + 15) + '"/>';
    var bands = 14;
    for (i = 0; i < bands; i++) {
      out += '<polygon class="up-grass ' + (i % 2 ? 'b' : 'a') + '" points="' + poly([[0, PH * i / bands], [PW, PH * i / bands], [PW, PH * (i + 1) / bands], [0, PH * (i + 1) / bands]]) + '"/>';
    }
    out += '<polygon class="up-haze" points="' + poly([[0, 0], [PW, 0], [PW, PH], [0, PH]]) + '"/>';
    var mk = marking();
    out += '<g class="up-marks">' + mk.segs.map(function (q) { return seg(q[0], q[1], q[2], q[3]); }).join('') + mk.dots.map(function (d) { return dot(d[0], d[1], d[2]); }).join('') + '</g>';
    out += '<polygon class="up-rim" points="' + poly([[0, 0], [PW, 0], [PW, PH], [0, PH]]) + '"/>';
    spots.forEach(function (s) { out += '<ellipse cx="' + r1(s.X) + '" cy="' + r1(s.Y) + '" rx="' + r1(s.w * 0.42) + '" ry="' + r1(s.w * 0.15) + '" fill="url(#up-spot)"/>'; });
    return '<svg class="up-svg" viewBox="' + r1(vb.x) + ' ' + r1(vb.y) + ' ' + r1(vb.w) + ' ' + r1(vb.h) + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">' + out + '</svg>';
  }

  // ---------------------------------------------------------------------
  // Players
  // A little shirt in the team colour. A captain's has an armband on the sleeve (gold for the captain, silver for the vice).
  function jersey(role) {
    return '<svg class="up-jersey" viewBox="0 0 64 56" aria-hidden="true"><path class="up-jersey-body" d="M21 3 8 9 1 24l11 5 4-6v31h32V23l4 6 11-5-7-15-13-6c-2 7-20 7-22 0z"/><path class="up-jersey-collar" d="M21 3c2 7 20 7 22 0-3 4-19 4-22 0z"/>' +
      (role ? '<path class="up-band up-band--' + (role === 'captain' ? 'c' : 'vc') + '" d="M3.4 19.6l9.2 4.1-1.7 3.6-9.4-4.2z"/>' : '') + '</svg>';
  }
  var ROLE_LABEL = { captain: 'Captain', vice: 'Vice-captain' };

  function card(p, o, key) {
    var role = p.captain === 'captain' || p.captain === 'vice' ? p.captain : null;
    var inner = '<span class="up-kit">' + jersey(role) + '<b class="up-num">' + esc(p.shirt_no || '') + '</b>' +
      (role ? '<i class="up-cap up-cap--' + (role === 'captain' ? 'c' : 'vc') + '" title="' + ROLE_LABEL[role] + '">' + (role === 'captain' ? 'C' : 'VC') + '</i>' : '') + '</span>' +
      '<span class="up-plate"><span class="up-pname">' + esc(p.name) + '</span><span class="up-ppos">' + esc(ABBR[key] || '') + '</span></span>';
    var label = (o.canVote ? 'Vote for ' : '') + p.name + (role ? ', ' + ROLE_LABEL[role].toLowerCase() : '');
    return o.canVote
      ? '<button type="button" class="up-card up-card--vote" data-vote-player="' + esc(p.id) + '" aria-label="' + esc(label) + '">' + inner + '</button>'
      : '<div class="up-card"' + (role ? ' role="group" aria-label="' + esc(label) + '"' : '') + '>' + inner + '</div>';
  }

  // Works out where every player stands: which pitch depth, which side, and how big their card is.
  function arrange(rows, groups) {
    // each line of players is a slot; a crowded line (more than four) is split over two slots
    var slots = [];
    rows.forEach(function (l, i) {
      var list = groups[l.key].slice().sort(byShirt), k = list.length;
      var parts = k > 4 ? [list.slice(0, Math.ceil(k / 2)), list.slice(Math.ceil(k / 2))] : [list];
      parts.forEach(function (sub) { slots.push({ key: l.key, row: i, list: sub }); });
    });
    var n = slots.length;
    var farY = proj(PW / 2, 78).Y, nearY = proj(PW / 2, PH - 48).Y;       // first row stands in the far penalty area, last row near the viewer
    var crowd = n <= 4 ? 1 : Math.max(0.68, 4.2 / n);                      // many rows: slightly smaller cards so none overlap
    var out = [];
    slots.forEach(function (sl, i) {
      var Yfoot = n === 1 ? proj(PW / 2, PH * 0.66).Y : farY + (nearY - farY) * (i / (n - 1));   // rows are spaced evenly ON SCREEN
      var py = depthFor(Yfoot), s = proj(PW / 2, py).s, k = sl.list.length;
      var maxW = 46 * (0.55 + 0.45 * s) * crowd;                              // distant cards are a touch smaller
      var w = Math.min(maxW, 0.9 * (250 * s) / k);                            // never wider than the gap to the neighbour
      sl.list.forEach(function (p, pi) {
        var px = PW / 2 + ((pi + 0.5) / k - 0.5) * 250, q = proj(px, py);
        out.push({ p: p, key: sl.key, row: sl.row, X: q.X, Y: q.Y, w: w, order: i });
      });
    });
    return out;
  }

  // The picture's frame: the pitch plus room above the far players' cards and below the near edge.
  function frameOf(spots) {
    var far = proj(0, 0), nearL = proj(0, PH);
    var topY = Math.min(far.Y, Math.min.apply(null, spots.map(function (s) { return s.Y - s.w * 1.36; }))) - 10;
    return { x: -8, y: topY, w: PW + 16, h: (nearL.Y + 15 + 12) - topY };
  }

  // players: [{id, name, shirt_no, position}], o: { colour, canVote, title }
  function html(players, o) {
    o = o || {};
    var groups = { gk: [], def: [], mid: [], fwd: [] }, extra = [];
    (players || []).forEach(function (p) { var k = lineOf(p.position); if (k) groups[k].push(p); else extra.push(p); });
    var rows = LINES.filter(function (l) { return groups[l.key].length; });
    var style = o.colour ? ' style="--tc:' + esc(o.colour) + '"' : '';
    var out = '<div class="up"' + style + '>';
    if (rows.length) {
      var spots = arrange(rows, groups), vb = frameOf(spots);
      out += '<div class="up-stage" style="padding-bottom:' + r1(vb.h / vb.w * 100) + '%"><div class="up-frame" role="group" aria-label="' + esc(o.title || 'Line-up') + '">' +
        pitchSvg(vb, spots);
      spots.slice().sort(function (a, b) { return a.Y - b.Y; }).forEach(function (s, i) {       // far players first, so near ones overlap them
        var pw = s.w / vb.w * 100;
        out += '<div class="up-pl" style="left:' + r1((s.X - vb.x) / vb.w * 100) + '%;top:' + r1((s.Y - vb.y) / vb.h * 100) + '%;width:' + r1(pw) + '%;font-size:' + r1(pw * 0.158) + 'em;--d:' + (s.order * 0.09 + i * 0.012).toFixed(2) + 's">' + card(s.p, o, s.key) + '</div>';
      });
      out += '</div></div>';
      if ((players || []).some(function (p) { return p.captain && p.active !== false; })) {
        out += '<p class="up-legend"><span><i class="up-cap up-cap--c">C</i> Captain</span><span><i class="up-cap up-cap--vc">VC</i> Vice-captain</span></p>';
      }
    } else {
      out += '<p class="uc-muted up-empty">Add each player\'s position (for example Goalkeeper, Defender, Midfielder, Forward) and the line-up appears here.</p>';
    }
    if (extra.length) {
      out += '<div class="up-extra"><h4>' + (rows.length ? 'Also in the squad' : 'Squad') + '</h4><ul>' + extra.sort(byShirt).map(function (p) {
        return '<li>' + (o.canVote ? '<button type="button" class="up-chip up-chip--vote" data-vote-player="' + esc(p.id) + '">' : '<span class="up-chip">') + '<b>' + esc(p.shirt_no || '–') + '</b>' + esc(p.name) + (o.canVote ? '</button>' : '</span>') + '</li>';
      }).join('') + '</ul></div>';
    }
    return out + '</div>';
  }

  // ---------------------------------------------------------------------
  // Drawing the same scene onto a canvas (for the shareable images). draw() paints the pitch and players with the
  // top-left corner at (x, y) and the given width, and returns the height it used (0 if there is nothing to draw).
  var JERSEY_D = 'M21 3 8 9 1 24l11 5 4-6v31h32V23l4 6 11-5-7-15-13-6c-2 7-20 7-22 0z';
  var COLLAR_D = 'M21 3c2 7 20 7 22 0-3 4-19 4-22 0z';
  var BAND_D = 'M3.4 19.6l9.2 4.1-1.7 3.6-9.4-4.2z';
  var FONT = "Inter, -apple-system, 'Segoe UI', Arial, sans-serif";

  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function wrapLines(ctx, text, maxW, maxLines) {
    var words = String(text).split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      while (ctx.measureText(w).width > maxW && w.length > 1) {          // a single very long word: break it
        var k = w.length; while (k > 1 && ctx.measureText(w.slice(0, k)).width > maxW) k--;
        if (cur) { lines.push(cur); cur = ''; }
        lines.push(w.slice(0, k)); w = w.slice(k);
      }
      var t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width <= maxW) cur = t; else { if (cur) lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); var l = lines[maxLines - 1]; while (l.length > 1 && ctx.measureText(l + '…').width > maxW) l = l.slice(0, -1); lines[maxLines - 1] = l + '…'; }
    return lines;
  }

  function drawPlayer(ctx, cx, footY, wpx, p, key, colour) {
    var em = wpx * 0.158 / 1;               // the card's text size, the same proportion as the on-screen cards
    var role = p.captain === 'captain' || p.captain === 'vice' ? p.captain : null;
    var jw = 4.2 * em, jh = jw * 56 / 64;
    ctx.font = '800 ' + em + 'px ' + FONT;
    var lines = wrapLines(ctx, String(p.name || '').toUpperCase(), wpx - 0.8 * em, 3);
    var nameH = lines.length * 1.15 * em + 0.7 * em, posH = 0.78 * em * 1.1 + 0.4 * em + 0.2 * em, plateH = nameH + posH;
    var plateTop = footY - plateH, kitTop = plateTop - 0.3 * em - jh;
    // plate
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 0.8 * em; ctx.shadowOffsetY = 0.5 * em;
    rrect(ctx, cx - wpx / 2, plateTop, wpx, plateH, 0.3 * em); ctx.fillStyle = '#15120b'; ctx.fill();
    ctx.restore();
    ctx.save(); rrect(ctx, cx - wpx / 2, plateTop, wpx, plateH, 0.3 * em); ctx.clip();
    ctx.fillStyle = '#f5f1e6'; ctx.fillRect(cx - wpx / 2, plateTop + nameH, wpx, posH);
    ctx.fillStyle = '#d4a62b'; ctx.fillRect(cx - wpx / 2, footY - 0.2 * em, wpx, 0.2 * em);
    ctx.restore();
    ctx.fillStyle = '#ffffff'; ctx.font = '800 ' + em + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach(function (l, i) { ctx.fillText(l, cx, plateTop + 0.35 * em + (i + 0.5) * 1.15 * em); });
    ctx.fillStyle = '#17130a'; ctx.font = '800 ' + (0.78 * em) + 'px ' + FONT;
    ctx.fillText(ABBR[key] || '', cx, plateTop + nameH + (posH - 0.2 * em) / 2);
    // shirt
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 0.3 * em; ctx.shadowOffsetY = 0.3 * em;
    ctx.translate(cx - jw / 2, kitTop); ctx.scale(jw / 64, jw / 64);
    var body = new Path2D(JERSEY_D); ctx.fillStyle = colour || '#d4a62b'; ctx.fill(body);
    ctx.shadowColor = 'transparent'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.stroke(body);
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill(new Path2D(COLLAR_D));
    if (role) { var b = new Path2D(BAND_D); ctx.fillStyle = role === 'captain' ? '#f1d77f' : '#d9dde3'; ctx.fill(b); ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.stroke(b); }
    ctx.restore();
    // number
    ctx.save(); ctx.fillStyle = '#ffffff'; ctx.font = '800 ' + (1.65 * em) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 0.25 * em; ctx.fillText(String(p.shirt_no || ''), cx, kitTop + jh * 0.62); ctx.restore();
    // captain's badge
    if (role) {
      var bx = cx + (role === 'captain' ? 2.35 : 2.3) * em, by = kitTop + (role === 'captain' ? 0.55 : 0.45) * em, br = (role === 'captain' ? 1.05 : 1.0) * em;
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 0.5 * em; ctx.shadowOffsetY = 0.2 * em;
      ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fillStyle = role === 'captain' ? '#f1d77f' : '#d9dde3'; ctx.fill(); ctx.restore();
      ctx.lineWidth = 0.14 * em; ctx.strokeStyle = '#ffffff'; ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#17130a'; ctx.font = '800 ' + (role === 'captain' ? 1 : 0.78) * em + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(role === 'captain' ? 'C' : 'VC', bx, by + 0.05 * em);
    }
  }

  function draw(ctx, x, y, W, players, o) {
    o = o || {};
    var groups = { gk: [], def: [], mid: [], fwd: [] };
    (players || []).forEach(function (p) { if (p.active === false) return; var k = lineOf(p.position); if (k) groups[k].push(p); });
    var rows = LINES.filter(function (l) { return groups[l.key].length; });
    if (!rows.length) return 0;
    var spots = arrange(rows, groups), vb = frameOf(spots), scale = W / vb.w, H = vb.h * scale;
    function X(v) { return x + (v - vb.x) * scale; }
    function Y(v) { return y + (v - vb.y) * scale; }
    function path(pts) { ctx.beginPath(); pts.forEach(function (p, i) { var q = proj(p[0], p[1]); if (i) ctx.lineTo(X(q.X), Y(q.Y)); else ctx.moveTo(X(q.X), Y(q.Y)); }); ctx.closePath(); }
    var full = [[0, 0], [PW, 0], [PW, PH], [0, PH]], i;
    ctx.save();
    rrect(ctx, x, y, W, H, W * 0.03); ctx.clip();
    var bg = ctx.createLinearGradient(0, y, 0, y + H); bg.addColorStop(0, '#0a0d0b'); bg.addColorStop(0.55, '#101611'); bg.addColorStop(1, '#0b0f0c'); ctx.fillStyle = bg; ctx.fillRect(x, y, W, H);
    var glow = ctx.createRadialGradient(x + W / 2, y, 0, x + W / 2, y, W * 0.7); glow.addColorStop(0, 'rgba(241,215,127,0.16)'); glow.addColorStop(1, 'rgba(241,215,127,0)'); ctx.fillStyle = glow; ctx.fillRect(x, y, W, H);
    // thickness under the near edge
    var nl = proj(0, PH), nr = proj(PW, PH);
    var slab = ctx.createLinearGradient(0, Y(nl.Y), 0, Y(nl.Y + 15)); slab.addColorStop(0, '#103821'); slab.addColorStop(1, '#050f09');
    ctx.fillStyle = slab; ctx.fillRect(X(nl.X), Y(nl.Y), X(nr.X) - X(nl.X), 15 * scale);
    // stripes
    for (i = 0; i < 14; i++) { path([[0, PH * i / 14], [PW, PH * i / 14], [PW, PH * (i + 1) / 14], [0, PH * (i + 1) / 14]]); ctx.fillStyle = i % 2 ? '#17512f' : '#0f3d24'; ctx.fill(); }
    var far = proj(0, 0), haze = ctx.createLinearGradient(0, Y(far.Y), 0, Y(far.Y + 110)); haze.addColorStop(0, 'rgba(10,13,11,0.8)'); haze.addColorStop(1, 'rgba(10,13,11,0)');
    path(full); ctx.fillStyle = haze; ctx.fill();
    // markings
    var mk = marking(); ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(245,241,230,0.7)';
    mk.segs.forEach(function (q) { var a = proj(q[0], q[1]), b = proj(q[2], q[3]); ctx.lineWidth = 2.2 * (a.s + b.s) / 2 * scale; ctx.beginPath(); ctx.moveTo(X(a.X), Y(a.Y)); ctx.lineTo(X(b.X), Y(b.Y)); ctx.stroke(); });
    ctx.fillStyle = 'rgba(245,241,230,0.7)';
    mk.dots.forEach(function (d) { var q = proj(d[0], d[1]), rx = d[2] * q.s * scale; ctx.beginPath(); ctx.ellipse(X(q.X), Y(q.Y), rx, rx * COS, 0, 0, Math.PI * 2); ctx.fill(); });
    path(full); ctx.lineJoin = 'round'; ctx.lineWidth = 2.4 * scale; ctx.strokeStyle = 'rgba(212,166,43,0.85)'; ctx.stroke();
    // shadows, then players far to near
    spots.forEach(function (s) {
      var cx = X(s.X), cy = Y(s.Y), rx = s.w * 0.42 * scale, g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
      g.addColorStop(0, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save(); ctx.translate(cx, cy); ctx.scale(1, 0.36); ctx.translate(-cx, -cy); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rx, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    });
    spots.slice().sort(function (a, b) { return a.Y - b.Y; }).forEach(function (s) { drawPlayer(ctx, X(s.X), Y(s.Y), s.w * scale, s.p, s.key, o.colour); });
    ctx.restore();
    return H;
  }

  // Only for browsers that don't know container units (1cqw): keep the cards sized to the pitch's width.
  var cqw = true;
  try { cqw = !!(window.CSS && CSS.supports && CSS.supports('width', '1cqw')); } catch (e) {}
  if (!cqw && typeof ResizeObserver !== 'undefined') {
    var ro = new ResizeObserver(function (es) { es.forEach(function (en) { en.target.style.fontSize = (en.contentRect.width / 100) + 'px'; }); });
    var scan = function () { Array.prototype.forEach.call(document.querySelectorAll('.up-frame:not([data-ro])'), function (el) { el.setAttribute('data-ro', '1'); ro.observe(el); }); };
    if (typeof MutationObserver !== 'undefined') new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
    scan();
  }

  // Height divided by width of the picture draw() would make, so a caller can lay things out first (0 = nothing to draw).
  function aspect(players) {
    var groups = { gk: [], def: [], mid: [], fwd: [] };
    (players || []).forEach(function (p) { if (p.active === false) return; var k = lineOf(p.position); if (k) groups[k].push(p); });
    var rows = LINES.filter(function (l) { return groups[l.key].length; });
    if (!rows.length) return 0;
    var vb = frameOf(arrange(rows, groups));
    return vb.h / vb.w;
  }

  window.UnityPitch = { html: html, lineOf: lineOf, draw: draw, aspect: aspect };
})();
