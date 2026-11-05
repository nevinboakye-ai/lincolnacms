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

  function pitchSvg(vb, spots) {
    var m = 14, i, out = '';
    var far = proj(0, 0), nearL = proj(0, PH), nearR = proj(PW, PH);
    out += '<defs>' +
      '<linearGradient id="up-haze" gradientUnits="userSpaceOnUse" x1="0" y1="' + r1(far.Y) + '" x2="0" y2="' + r1(far.Y + 110) + '"><stop offset="0" stop-color="#0a0d0b" stop-opacity="0.8"/><stop offset="1" stop-color="#0a0d0b" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="up-slab" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#103821"/><stop offset="1" stop-color="#050f09"/></linearGradient>' +
      '<radialGradient id="up-spot"><stop offset="0" stop-color="#000" stop-opacity="0.6"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>' +
      '</defs>';
    // thickness under the near edge
    out += '<polygon class="up-slab" points="' + r1(nearL.X) + ',' + r1(nearL.Y) + ' ' + r1(nearR.X) + ',' + r1(nearR.Y) + ' ' + r1(nearR.X) + ',' + r1(nearR.Y + 15) + ' ' + r1(nearL.X) + ',' + r1(nearL.Y + 15) + '"/>';
    // mown stripes, each a perspective-correct band across the pitch
    var bands = 14;
    for (i = 0; i < bands; i++) {
      out += '<polygon class="up-grass ' + (i % 2 ? 'b' : 'a') + '" points="' + poly([[0, PH * i / bands], [PW, PH * i / bands], [PW, PH * (i + 1) / bands], [0, PH * (i + 1) / bands]]) + '"/>';
    }
    out += '<polygon class="up-haze" points="' + poly([[0, 0], [PW, 0], [PW, PH], [0, PH]]) + '"/>';
    // markings
    var L = '<g class="up-marks">';
    L += seg(m, m, PW - m, m) + seg(PW - m, m, PW - m, PH - m) + seg(PW - m, PH - m, m, PH - m) + seg(m, PH - m, m, m);   // outer lines
    L += seg(m, PH / 2, PW - m, PH / 2);                                                                                  // halfway line
    L += arc(PW / 2, PH / 2, 44, 0, Math.PI * 2, null) + dot(PW / 2, PH / 2, 2.6);                                         // centre circle
    // far end (the goalkeeper's end)
    L += seg(70, m, 70, 94) + seg(70, 94, 230, 94) + seg(230, 94, 230, m) + seg(112, m, 112, 46) + seg(112, 46, 188, 46) + seg(188, 46, 188, m);
    L += dot(PW / 2, 72, 2) + arc(PW / 2, 72, 36, 0, Math.PI, function (p) { return p[1] >= 94; });
    // near end
    L += seg(70, PH - m, 70, PH - 94) + seg(70, PH - 94, 230, PH - 94) + seg(230, PH - 94, 230, PH - m) + seg(112, PH - m, 112, PH - 46) + seg(112, PH - 46, 188, PH - 46) + seg(188, PH - 46, 188, PH - m);
    L += dot(PW / 2, PH - 72, 2) + arc(PW / 2, PH - 72, 36, Math.PI, Math.PI * 2, function (p) { return p[1] <= PH - 94; });
    out += L + '</g>';
    // gold edge round the pitch
    out += '<polygon class="up-rim" points="' + poly([[0, 0], [PW, 0], [PW, PH], [0, PH]]) + '"/>';
    // a soft shadow where each player stands
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

  // players: [{id, name, shirt_no, position}], o: { colour, canVote, title }
  function html(players, o) {
    o = o || {};
    var groups = { gk: [], def: [], mid: [], fwd: [] }, extra = [];
    (players || []).forEach(function (p) { var k = lineOf(p.position); if (k) groups[k].push(p); else extra.push(p); });
    var rows = LINES.filter(function (l) { return groups[l.key].length; });
    var style = o.colour ? ' style="--tc:' + esc(o.colour) + '"' : '';
    var out = '<div class="up"' + style + '>';
    if (rows.length) {
      var spots = arrange(rows, groups);
      // the picture's frame: the pitch plus room above the far players' cards and below the near edge
      var far = proj(0, 0), nearL = proj(0, PH);
      var topY = Math.min(far.Y, Math.min.apply(null, spots.map(function (s) { return s.Y - s.w * 1.36; }))) - 10;
      var vb = { x: -8, y: topY, w: PW + 16, h: (nearL.Y + 15 + 12) - topY };
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

  // Only for browsers that don't know container units (1cqw): keep the cards sized to the pitch's width.
  var cqw = true;
  try { cqw = !!(window.CSS && CSS.supports && CSS.supports('width', '1cqw')); } catch (e) {}
  if (!cqw && typeof ResizeObserver !== 'undefined') {
    var ro = new ResizeObserver(function (es) { es.forEach(function (en) { en.target.style.fontSize = (en.contentRect.width / 100) + 'px'; }); });
    var scan = function () { Array.prototype.forEach.call(document.querySelectorAll('.up-frame:not([data-ro])'), function (el) { el.setAttribute('data-ro', '1'); ro.observe(el); }); };
    if (typeof MutationObserver !== 'undefined') new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
    scan();
  }

  window.UnityPitch = { html: html, lineOf: lineOf };
})();
