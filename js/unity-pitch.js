// Unity Cup - the line-up pitch.
//
// Turns a team's players into a football-pitch picture: name cards laid out in lines (goalkeeper at the top,
// then defence, midfield and attack), worked out from each player's "position". Nothing is placed by hand:
// when the committee enters a player and a position, they appear in the right line. Players whose position
// isn't recognised (or is blank) are listed under the pitch instead.
//
// Used by the public page (team pop-up) and the committee panel (line-up preview).

(function () {
  'use strict';

  // Which line a position belongs to. Matches whole words/abbreviations in lowercase, so "Left back",
  // "CB", "centre-mid", "Striker" and "ST" all land where you'd expect.
  var LINES = [
    { key: 'gk', label: 'Goalkeeper', re: /\b(gk|goalie|goalkeeper|keeper|goal keeper|goalminder)\b/ },
    { key: 'def', label: 'Defence', re: /\b(def|defence|defense|defender|cb|lb|rb|lwb|rwb|centre[- ]?back|center[- ]?back|full[- ]?back|wing[- ]?back|left[- ]?back|right[- ]?back|back|sweeper)\b/ },
    { key: 'mid', label: 'Midfield', re: /\b(mid|midfield|midfielder|cm|cdm|cam|dm|am|lm|rm|centre[- ]?mid|center[- ]?mid|playmaker)\b/ },
    { key: 'fwd', label: 'Attack', re: /\b(fwd|fw|forward|striker|st|cf|winger|wing|lw|rw|attacker|attack|ss|number ?9)\b/ }
  ];

  function lineOf(position) {
    var p = String(position || '').toLowerCase().replace(/[.,/]/g, ' ').trim();
    if (!p) return null;
    for (var i = 0; i < LINES.length; i++) if (LINES[i].re.test(p)) return LINES[i].key;
    return null;
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function shirtNum(p) { var n = parseInt(p.shirt_no, 10); return isNaN(n) ? 999 : n; }
  function byShirt(a, b) { return shirtNum(a) - shirtNum(b) || String(a.name).localeCompare(String(b.name)); }

  var ABBR = { gk: 'GK', def: 'DEF', mid: 'MID', fwd: 'FWD' };

  // A little shirt in the team colour with the number on it.
  var JERSEY = '<svg class="up-jersey" viewBox="0 0 64 56" aria-hidden="true"><path class="up-jersey-body" d="M21 3 8 9 1 24l11 5 4-6v31h32V23l4 6 11-5-7-15-13-6c-2 7-20 7-22 0z"/><path class="up-jersey-collar" d="M21 3c2 7 20 7 22 0-3 4-19 4-22 0z"/></svg>';

  // One player standing on the pitch: shirt, then a dark name plate with the position underneath.
  function card(p, o, key) {
    var inner = '<span class="up-kit">' + JERSEY + '<b class="up-num">' + esc(p.shirt_no || '') + '</b></span>' +
      '<span class="up-plate"><span class="up-pname">' + esc(p.name) + '</span><span class="up-ppos">' + esc(ABBR[key] || '') + '</span></span>';
    return o.canVote
      ? '<button type="button" class="up-card up-card--vote" data-vote-player="' + esc(p.id) + '" aria-label="Vote for ' + esc(p.name) + '">' + inner + '</button>'
      : '<div class="up-card">' + inner + '</div>';
  }

  // Where each player stands, as percentages of the flat pitch (0,0 = far left corner behind the goalkeeper).
  function layout(rows, groups) {
    // Every line of players is a "slot"; a crowded line (more than four) is split over two slots.
    var slots = [];
    rows.forEach(function (l, i) {
      var list = groups[l.key].slice().sort(byShirt), k = list.length;
      var parts = k > 4 ? [list.slice(0, Math.ceil(k / 2)), list.slice(Math.ceil(k / 2))] : [list];
      parts.forEach(function (sub) { slots.push({ key: l.key, row: i, list: sub }); });
    });
    var n = slots.length, top = n === 1 ? 64 : 17, bottom = 87;
    var m = n <= 4 ? 1 : Math.max(0.66, 4.2 / n);            // crowded pitch: slightly smaller cards so rows don't collide
    var out = [];
    slots.forEach(function (sl, i) {
      var f = n === 1 ? 0.7 : i / (n - 1);                    // 0 = far end of the pitch, 1 = the near end
      var y = n === 1 ? top : top + i * ((bottom - top) / (n - 1));
      var s = 1.06 - 0.12 * f;                                // distant players are drawn a touch bigger so names stay readable
      var cw = Math.min(16.5 * m, 70 / (sl.list.length * s));  // never wider than the gap between neighbours
      sl.list.forEach(function (p, pi) {
        out.push({ p: p, key: sl.key, x: 10 + (pi + 0.5) * (80 / sl.list.length), y: y, row: sl.row, s: s, cw: cw });
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
      var spots = layout(rows, groups);
      out += '<div class="up-stage"><div class="up-plane" role="group" aria-label="' + esc(o.title || 'Line-up') + '">' +
        '<svg class="up-lines" viewBox="0 0 300 400" preserveAspectRatio="none" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8">' +
        '<rect x="8" y="8" width="284" height="384" rx="2"/><line x1="8" y1="200" x2="292" y2="200"/><circle cx="150" cy="200" r="38"/><circle cx="150" cy="200" r="2.6" fill="currentColor"/>' +
        '<rect x="70" y="8" width="160" height="62"/><rect x="108" y="8" width="84" height="26"/><path d="M118 70a34 34 0 0 0 64 0"/><circle cx="150" cy="52" r="1.8" fill="currentColor"/>' +
        '<rect x="70" y="330" width="160" height="62"/><rect x="108" y="366" width="84" height="26"/><path d="M118 330a34 34 0 0 1 64 0"/><circle cx="150" cy="348" r="1.8" fill="currentColor"/></svg>' +
        '<span class="up-haze" aria-hidden="true"></span><span class="up-side" aria-hidden="true"></span>' +
        spots.map(function (s) { return '<span class="up-spot" style="left:' + s.x.toFixed(2) + '%;top:' + s.y.toFixed(2) + '%" aria-hidden="true"></span>'; }).join('') +
        spots.map(function (s, i) { return '<div class="up-pl" style="left:' + s.x.toFixed(2) + '%;top:' + s.y.toFixed(2) + '%;--d:' + (s.row * 0.09 + i * 0.015).toFixed(2) + 's;--s:' + s.s.toFixed(3) + ';--cw:' + s.cw.toFixed(2) + '">' + card(s.p, o, s.key) + '</div>'; }).join('') +
        '</div></div>';
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

  window.UnityPitch = { html: html, lineOf: lineOf };
})();
