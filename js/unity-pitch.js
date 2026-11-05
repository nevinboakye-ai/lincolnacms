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

  function card(p, o) {
    var inner = '<span class="up-shirt">' + esc(p.shirt_no || '') + '</span><span class="up-name">' + esc(p.name) + '</span>';
    return o.canVote
      ? '<button type="button" class="up-card up-card--vote" data-vote-player="' + esc(p.id) + '" aria-label="Vote for ' + esc(p.name) + '">' + inner + '</button>'
      : '<div class="up-card">' + inner + '</div>';
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
      out += '<div class="up-pitch" role="group" aria-label="' + esc(o.title || 'Line-up') + '">' +
        '<svg class="up-lines" viewBox="0 0 300 400" preserveAspectRatio="none" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6">' +
        '<rect x="8" y="8" width="284" height="384" rx="3"/><line x1="8" y1="200" x2="292" y2="200"/><circle cx="150" cy="200" r="38"/><circle cx="150" cy="200" r="2.4" fill="currentColor"/>' +
        '<rect x="70" y="8" width="160" height="62"/><rect x="108" y="8" width="84" height="26"/><path d="M118 70a34 34 0 0 0 64 0"/>' +
        '<rect x="70" y="330" width="160" height="62"/><rect x="108" y="366" width="84" height="26"/><path d="M118 330a34 34 0 0 1 64 0"/></svg>' +
        '<div class="up-rows" style="--n:' + rows.length + '">' +
        rows.map(function (l) {
          var list = groups[l.key].slice().sort(byShirt), n = list.length, per = n > 5 ? Math.ceil(n / 2) : n;
          return '<div class="up-row up-row--' + l.key + (n > 5 ? ' is-two' : '') + '" style="--per:' + per + '" data-line="' + l.key + '">' + list.map(function (p) { return card(p, o); }).join('') + '</div>';
        }).join('') + '</div></div>';
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
