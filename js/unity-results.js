// Unity Cup: the final results page (unity-cup.html)
//
// Builds the whole page from the saved tournament in js/unity-results-data.js: the champions, the award winners,
// the tournament in numbers, the top scorers, the road to the final, the final group tables and every result.
// Nothing here is typed in by hand except the Player of the Tournament: everything else is worked out from the
// recorded matches, so the numbers always agree with the scores.
//
// Needs no database: it keeps working after the old-data clean-up has removed the live records.

(function () {
  'use strict';

  var R = window.UNITY_RESULTS, body = document.getElementById('ur-body');
  if (!R || !body) return;

  var BASE = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : 'https://ghzmhunwghubmpvqbike.supabase.co') + '/storage/v1/object/public/unity-cup-gallery/';
  var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var ICON = {
    trophy: '<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M20 8h24v18a12 12 0 0 1-24 0z" fill="currentColor"/><path d="M20 12H9v5a11 11 0 0 0 11 11M44 12h11v5a11 11 0 0 1-11 11" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M32 38v10M21 56h22M25 48h14v8H25z" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2 6.3 20.3l1.2-6.4L2.8 9.5l6.4-.8z" fill="currentColor"/></svg>',
    ball: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><circle cx="32" cy="32" r="28"/><path d="M32 20l10 7.3-3.8 11.7H25.8L22 27.3z" fill="currentColor"/><path d="M32 20V6M42 27.3l14-4.2M38.2 39l8.6 12M25.8 39l-8.6 12M22 27.3l-14-4.2"/></svg>',
    boot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 15V6l4 1 2 4h4l8 3v4H3z"/><path d="M7 7l1 3M3 19v-2"/></svg>',
    attack: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4"/></svg>',
    cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.8"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>'
  };

  // ---------------------------------------------------------------------
  // Small helpers
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nice(n) { n = String(n == null ? '' : n).trim().replace(/\s+/g, ' '); return n === n.toLowerCase() ? n.replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }) : n; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  var teams = {}; R.teams.forEach(function (t) { teams[t.id] = t; });
  var players = {}; R.players.forEach(function (p) { players[p.id] = p; });
  function team(id) { return teams[id] || { id: id, name: '?', short: '?', colour: '#d4a62b' }; }
  function logo(t) { return t && t.logo ? BASE + encodeURI(t.logo) : ''; }
  function crest(t, size) {
    return '<span class="uc-crest uc-crest--' + (size || 'sm') + '" style="--tc:' + esc(t.colour || '#d4a62b') + '">' +
      (logo(t) ? '<img src="' + esc(logo(t)) + '" alt="" loading="lazy" decoding="async">' : '<b>' + esc((t.short || t.name || '?').slice(0, 3).toUpperCase()) + '</b>') + '</span>';
  }
  function koTime(f) { return f.ko ? new Date(f.ko).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : ''; }

  // ---------------------------------------------------------------------
  // Working it all out from the matches
  var F = R.fixtures.filter(function (f) { return f.hs != null && f.as != null; });
  var rec = {};   // per team record
  R.teams.forEach(function (t) { rec[t.id] = { t: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, cs: 0, pts: 0, cards: 0 }; });
  var koTeams = {};
  F.forEach(function (f) {
    var isKO = /semi|final/i.test(f.stage || '');
    [[f.home, f.hs, f.as], [f.away, f.as, f.hs]].forEach(function (x) {
      var r = rec[x[0]]; if (!r) return;
      r.p++; r.gf += x[1]; r.ga += x[2]; if (x[2] === 0) r.cs++;
      if (x[1] > x[2]) r.w++; else if (x[1] < x[2]) r.l++; else r.d++;
      if (isKO) koTeams[x[0]] = 1;
    });
    (f.cards || []).forEach(function (c) { if (rec[c.t]) rec[c.t].cards++; });
  });

  var final = F.filter(function (f) { return /^final$/i.test(String(f.stage || '').trim()); })[0] || null;
  var champId = R.awards.champion, runnerId = null;
  if (final) {
    champId = final.hs > final.as ? final.home : final.hs < final.as ? final.away : champId;
    runnerId = champId === final.home ? final.away : final.home;
  }
  var champ = team(champId), champRec = rec[champId] || { p: 0, w: 0, l: 0, gf: 0, ga: 0 };

  // goals by player (grouped by player, not by name: two players can share a name)
  var scorers = {}, hatTricks = [], bestMatch = [];
  F.forEach(function (f, fi) {
    var inMatch = {};
    (f.goals || []).forEach(function (g) {
      if (g.og) return;
      var key = g.p || (g.n + '|' + g.t), s = scorers[key] || (scorers[key] = { key: key, pid: g.p, name: nice(g.n), team: g.t, goals: 0, games: {} });
      s.goals++; s.games[fi] = (s.games[fi] || 0) + 1; inMatch[key] = (inMatch[key] || 0) + 1;
    });
    Object.keys(inMatch).forEach(function (k) { if (inMatch[k] >= 3) hatTricks.push({ s: scorers[k], f: f, n: inMatch[k] }); });
  });
  var scorerList = Object.keys(scorers).map(function (k) { return scorers[k]; }).sort(function (a, b) { return b.goals - a.goals || Object.keys(b.games).length - Object.keys(a.games).length || a.name.localeCompare(b.name); });
  // two players with the same name in the same team: show the shirt number so they can be told apart
  var nameCount = {}; scorerList.forEach(function (s) { var k = s.name + '|' + s.team; nameCount[k] = (nameCount[k] || 0) + 1; });
  scorerList.forEach(function (s) { var p = players[s.pid]; s.label = s.name + (nameCount[s.name + '|' + s.team] > 1 && p && p.no ? ' #' + p.no : ''); });

  var totalGoals = F.reduce(function (n, f) { return n + f.hs + f.as; }, 0);
  var ownGoals = F.reduce(function (n, f) { return n + (f.goals || []).filter(function (g) { return g.og; }).length; }, 0);
  var yellow = 0, red = 0; F.forEach(function (f) { (f.cards || []).forEach(function (c) { if (c.k === 'red') red++; else yellow++; }); });
  var cleanSheets = Object.keys(rec).reduce(function (n, k) { return n + rec[k].cs; }, 0);
  var draws = F.filter(function (f) { return f.hs === f.as; }).length;

  function extreme(fn) { var best = null, out = []; F.forEach(function (f) { var v = fn(f); if (best === null || v > best) { best = v; out = [f]; } else if (v === best) out.push(f); }); return { v: best, fs: out }; }
  var bigWin = extreme(function (f) { return Math.abs(f.hs - f.as); });
  var topGame = extreme(function (f) { return f.hs + f.as; });

  function ranked(fn, dir) {   // teams ranked by fn; returns all teams tied for first
    var list = Object.keys(rec).map(function (k) { return rec[k]; }).filter(function (r) { return r.p > 0; });
    list.sort(function (a, b) { return dir * (fn(b) - fn(a)); });
    var top = fn(list[0]); return list.filter(function (r) { return fn(r) === top; });
  }
  var bestAttack = ranked(function (r) { return r.gf; }, 1);
  var bestDefence = ranked(function (r) { return Math.round(r.ga / r.p * 100); }, -1);   // goals conceded per game

  // Golden Boot: the player with the most recorded goals (or the committee's override)
  var boot = null;
  if (R.awards.goldenBootOverride) boot = { override: R.awards.goldenBootOverride };
  else if (scorerList.length) { var topG = scorerList[0].goals; boot = { list: scorerList.filter(function (s) { return s.goals === topG; }) }; }

  function standings(group) {
    // group tables use group-stage matches only
    var rows = R.teams.filter(function (t) { return t.group === group; }).map(function (t) { return { t: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }; });
    var map = {}; rows.forEach(function (r) { map[r.t.id] = r; });
    F.forEach(function (f) {
      var h = map[f.home], a = map[f.away]; if (!h || !a || /semi|final/i.test(f.stage || '')) return;
      h.p++; a.p++; h.gf += f.hs; h.ga += f.as; a.gf += f.as; a.ga += f.hs;
      if (f.hs > f.as) { h.w++; a.l++; h.pts += 3; } else if (f.hs < f.as) { a.w++; h.l++; a.pts += 3; } else { h.d++; a.d++; h.pts++; a.pts++; }
    });
    return rows.sort(function (x, y) { return y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.t.name.localeCompare(y.t.name); });
  }

  function scorerLines(f, teamId) {
    var order = [], by = {};
    (f.goals || []).forEach(function (g) {
      if (g.t !== teamId) return;
      var k = (g.p || g.n) + (g.og ? '|og' : ''); if (!by[k]) { by[k] = { n: nice(g.n), og: g.og, c: 0 }; order.push(k); } by[k].c++;
    });
    return order.map(function (k) { var x = by[k]; return x.n + (x.og ? ' (OG)' : '') + (x.c > 1 ? ' ×' + x.c : ''); });
  }

  // ---------------------------------------------------------------------
  // The page
  function teamLine(id) { var t = team(id); return crest(t, 'sm') + '<span>' + esc(t.name) + '</span>'; }
  function matchLabel(f) { return esc(team(f.home).short) + ' ' + f.hs + '–' + f.as + ' ' + esc(team(f.away).short); }

  function champsHtml() {
    var sub = champRec.l === 0 && champRec.w === champRec.p && champRec.p ? 'Unbeaten. Won all ' + champRec.p + ' of their matches, scoring ' + champRec.gf + ' and conceding just ' + champRec.ga + '.'
      : champRec.l === 0 ? 'Unbeaten through the tournament.' : champRec.p + ' matches, ' + champRec.w + ' wins, ' + champRec.gf + ' goals scored.';
    var finalHtml = '';
    if (final) {
      var h = team(final.home), a = team(final.away), hw = final.hs > final.as, aw = final.as > final.hs;
      function side(t, win, id) {
        var lines = scorerLines(final, id);
        return '<div class="ur-fside' + (win ? ' is-win' : '') + '">' + crest(t, 'lg') + '<strong>' + esc(t.name) + '</strong>' + (lines.length ? '<small>' + lines.map(esc).join(' · ') + '</small>' : '') + '</div>';
      }
      finalHtml = '<div class="ur-final" aria-label="The final">' +
        '<p class="ur-final-label">The Final' + (koTime(final) ? ' · ' + esc(koTime(final)) : '') + (final.pitch ? ' · ' + esc(final.pitch) : '') + '</p>' +
        '<div class="ur-final-board">' + side(h, hw, final.home) + '<div class="ur-final-score" aria-label="' + esc(h.name + ' ' + final.hs + ', ' + a.name + ' ' + final.as) + '"><b>' + final.hs + '</b><i aria-hidden="true">&ndash;</i><b>' + final.as + '</b></div>' + side(a, aw, final.away) + '</div></div>';
    }
    var squad = R.players.filter(function (p) { return p.team === champId; });
    var pitch = window.UnityPitch && squad.length ? '<details class="ur-squad"><summary>Meet the champions<span aria-hidden="true"></span></summary>' +
      UnityPitch.html(squad.map(function (p) { return { id: p.id, name: nice(p.name), shirt_no: p.no, position: p.pos, captain: p.cap, active: true }; }), { colour: champ.colour, canVote: false, title: champ.name + ' squad' }) + '</details>' : '';
    return '<section class="ur-champs ur-reveal" id="ur-champs" aria-labelledby="ur-champs-h"><span class="ur-glow" aria-hidden="true"></span>' +
      '<div class="ur-trophy" aria-hidden="true">' + ICON.trophy + '</div>' +
      '<p class="ur-eyebrow">Unity Cup champions</p>' +
      '<div class="ur-champ-crest">' + crest(champ, 'xl') + '</div>' +
      '<h2 class="ur-champ-name" id="ur-champs-h">' + esc(champ.name) + '</h2>' +
      '<p class="ur-champs-sub">' + esc(sub) + '</p>' + finalHtml +
      '<div class="ur-actions">' + (final && window.UnityShare ? '<button type="button" class="uc-btn uc-btn--gold" data-ur-share>' + ICON.share + 'Share the final</button>' : '') + '<a class="uc-btn uc-btn--ghost ur-ghost-dark" href="#ur-all">All the results ' + ICON.arrow + '</a></div>' + pitch + '</section>';
  }

  function awardCard(cls, icon, label, mainHtml, sub, crestHtml) {
    return '<li class="ur-award ' + cls + ' ur-reveal"><span class="ur-award-ic">' + icon + '</span><span class="ur-award-label">' + label + '</span>' + (crestHtml || '') + '<strong>' + mainHtml + '</strong><span class="ur-award-sub">' + sub + '</span></li>';
  }
  function teamNames(list) { return list.map(function (r) { return esc(r.t.name); }).join(' &amp; '); }
  function awardsHtml() {
    var cards = '', pot = R.awards.playerOfTournament;
    if (pot) { var pt = team(pot.team); cards += awardCard('ur-award--gold', ICON.star, 'Player of the Tournament', esc(nice(pot.name)), esc(pt.name), crest(pt, 'md')); }
    if (boot && boot.override) {
      var bo = boot.override, bt = team(bo.team); cards += awardCard('', ICON.boot, 'Golden Boot', esc(nice(bo.name)), plural(bo.goals, 'goal') + ' · ' + esc(bt.name), crest(bt, 'md'));
    } else if (boot && boot.list && boot.list.length) {
      var b = boot.list[0], bt2 = team(b.team), games = Object.keys(b.games).length;
      cards += awardCard('', ICON.boot, boot.list.length > 1 ? 'Golden Boot (shared)' : 'Golden Boot',
        boot.list.map(function (x) { return esc(x.label); }).join(' &amp; '),
        plural(b.goals, 'goal') + (boot.list.length === 1 ? ' in ' + plural(games, 'game') : ' each') + ' · ' + boot.list.map(function (x) { return esc(team(x.team).short); }).join(' &amp; '),
        boot.list.length === 1 ? crest(bt2, 'md') : '');
    }
    cards += awardCard('', ICON.attack, 'Best attack', teamNames(bestAttack), plural(bestAttack[0].gf, 'goal') + ' scored', crest(bestAttack[0].t, 'md'));
    cards += awardCard('', ICON.shield, 'Best defence', teamNames(bestDefence), plural(bestDefence[0].ga, 'goal') + ' conceded in ' + plural(bestDefence[0].p, 'game') + ' (' + (bestDefence[0].ga / bestDefence[0].p).toFixed(1) + ' a game)', crest(bestDefence[0].t, 'md'));
    return '<section class="ur-block" aria-labelledby="ur-awards-h"><header class="uc-head ur-reveal"><span class="uc-kicker">The awards</span><h2 id="ur-awards-h">Stars of the tournament</h2></header><ul class="ur-awards">' + cards + '</ul></section>';
  }

  function tile(value, label, sub, dec) {
    return '<li class="ur-tile ur-reveal"><b data-ur-count="' + value + '"' + (dec ? ' data-dec="' + dec + '"' : '') + '>' + (dec ? Number(value).toFixed(dec) : value) + '</b><span>' + esc(label) + '</span>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</li>';
  }
  function recordRow(label, html) { return '<div class="ur-rec ur-reveal"><dt>' + esc(label) + '</dt><dd>' + html + '</dd></div>'; }
  function numbersHtml() {
    var tiles = tile(R.teams.length, 'Teams') + tile(R.players.length, 'Players', 'on the squad lists') + tile(F.length, 'Matches', 'on the day') + tile(totalGoals, 'Goals') +
      tile(F.length ? totalGoals / F.length : 0, 'Goals per match', '', 1) + tile(cleanSheets, 'Clean sheets') + tile(hatTricks.length, hatTricks.length === 1 ? 'Hat-trick' : 'Hat-tricks') +
      tile(yellow + red, 'Cards shown', yellow + ' yellow · ' + red + ' red');
    var recs = '';
    if (bigWin.fs.length) recs += recordRow('Biggest win', bigWin.fs.map(function (f) { return '<strong>' + matchLabel(f) + '</strong>' + (/group/i.test(f.stage || '') ? '' : ' <small>' + esc(f.stage) + '</small>'); }).join('<br>'));
    if (topGame.fs.length) recs += recordRow('Most goals in a match', '<strong>' + plural(topGame.v, 'goal') + '</strong> <small>' + topGame.fs.map(matchLabel).join(' · ') + '</small>');
    if (hatTricks.length) recs += recordRow(hatTricks.length === 1 ? 'Hat-trick' : 'Hat-tricks', hatTricks.map(function (h) { return '<strong>' + esc(h.s.label) + '</strong> <small>' + esc(team(h.s.team).short) + ' in ' + matchLabel(h.f) + '</small>'; }).join('<br>'));
    if (champRec.p) recs += recordRow('Champions’ run', '<strong>' + esc(champ.name) + '</strong> <small>' + champRec.w + ' wins in ' + champRec.p + ' · ' + champRec.gf + ' scored, ' + champRec.ga + ' conceded</small>');
    var tfin = totalGoals && final ? Math.round(final.hs + final.as) : 0;
    if (final) recs += recordRow('The final', '<strong>' + matchLabel(final) + '</strong> <small>' + plural(tfin, 'goal') + ' in the final</small>');
    if (ownGoals === 0 && F.length) recs += recordRow('Own goals', '<strong>None</strong> <small>in ' + F.length + ' matches</small>');
    return '<section class="ur-block" aria-labelledby="ur-num-h"><header class="uc-head ur-reveal"><span class="uc-kicker">By the numbers</span><h2 id="ur-num-h">The tournament in numbers</h2></header>' +
      '<ul class="ur-tiles">' + tiles + '</ul><dl class="ur-records">' + recs + '</dl></section>';
  }

  function scorersHtml() {
    var cut = scorerList.length > 10 ? scorerList[9].goals : 0, list = scorerList.filter(function (s, i) { return i < 10 || s.goals === cut; });
    var max = list.length ? list[0].goals : 1;
    var rows = list.map(function (s, i) {
      var t = team(s.team), lead = s.goals === max;
      return '<li class="ur-scorer' + (lead ? ' is-lead' : '') + ' ur-reveal" style="--w:' + Math.round(s.goals / max * 100) + '%; --i:' + i + '"><span class="ur-rank">' + (i === 0 || list[i - 1].goals !== s.goals ? (scorerList.indexOf(s) + 1) : '') + '</span>' + crest(t, 'sm') +
        '<span class="ur-scorer-who"><strong>' + esc(s.label) + (lead ? ' <i class="ur-boot" title="Golden Boot">' + ICON.boot + '</i>' : '') + '</strong><small>' + esc(t.name) + '</small></span><span class="ur-bar" aria-hidden="true"><i></i></span><b class="ur-scorer-n" aria-label="' + plural(s.goals, 'goal') + '">' + s.goals + '</b></li>';
    }).join('');
    return '<section class="ur-block" aria-labelledby="ur-sc-h"><header class="uc-head ur-reveal"><span class="uc-kicker">Golden Boot race</span><h2 id="ur-sc-h">Top scorers</h2><p>Goals recorded across all ' + F.length + ' matches.</p></header><ol class="ur-scorers">' + rows + '</ol></section>';
  }

  function bmatch(f, isFinal) {
    var h = team(f.home), a = team(f.away), hw = f.hs > f.as, aw = f.as > f.hs;
    function row(t, s, win) { return '<div class="ur-bm-row' + (win ? ' is-win' : '') + '">' + crest(t, 'sm') + '<strong>' + esc(t.name) + '</strong><b>' + s + '</b></div>'; }
    return '<div class="ur-bm' + (isFinal ? ' ur-bm--final' : '') + ' ur-reveal"><p class="ur-bm-top">' + (isFinal ? ICON.trophy : '') + '<span>' + esc(isFinal ? 'Final' : f.stage) + '</span><small>' + esc(koTime(f)) + '</small></p>' + row(h, f.hs, hw) + row(a, f.as, aw) + '</div>';
  }
  function bracketHtml() {
    var semis = F.filter(function (f) { return /semi/i.test(f.stage || ''); });
    if (!semis.length && !final) return '';
    return '<section class="ur-block" aria-labelledby="ur-br-h"><header class="uc-head ur-reveal"><span class="uc-kicker">Knockouts</span><h2 id="ur-br-h">The road to the final</h2><p>The top two in each group went through to the semi-finals.</p></header>' +
      '<div class="ur-bracket"><div class="ur-br-col"><h3>Semi-finals</h3>' + semis.map(function (f) { return bmatch(f, false); }).join('') + '</div>' +
      (final ? '<div class="ur-br-link" aria-hidden="true"></div><div class="ur-br-col ur-br-col--final"><h3>Final</h3>' + bmatch(final, true) + '</div>' : '') + '</div></section>';
  }

  function tablesHtml() {
    var groups = []; R.teams.forEach(function (t) { if (t.group && groups.indexOf(t.group) < 0) groups.push(t.group); }); groups.sort();
    if (!groups.length) return '';
    var cards = groups.map(function (g) {
      var rows = standings(g);
      return '<div class="uc-table-card ur-table ur-reveal"><h3>' + esc(g) + '</h3><div class="uc-table-scroll"><table class="uc-table"><caption class="visually-hidden">' + esc(g) + ' final table</caption><thead><tr><th class="uc-tl" scope="col">Team</th><th scope="col" title="Played">P</th><th scope="col" title="Won">W</th><th scope="col" title="Drawn">D</th><th scope="col" title="Lost">L</th><th scope="col" title="Goals for">GF</th><th scope="col" title="Goals against">GA</th><th scope="col" title="Goal difference">GD</th><th scope="col" title="Points">Pts</th></tr></thead><tbody>' +
        rows.map(function (r) {
          var gd = r.gf - r.ga, q = koTeams[r.t.id];
          return '<tr' + (q ? ' class="is-top"' : '') + '><td class="uc-tl"><span class="ur-tname">' + crest(r.t, 'sm') + '<span class="ur-tn-long">' + esc(r.t.name) + '</span><span class="ur-tn-short" aria-hidden="true">' + esc(r.t.short) + '</span>' + (q ? '<i class="ur-q" title="Went through to the semi-finals">Q</i>' : '') + '</span></td><td>' + r.p + '</td><td>' + r.w + '</td><td>' + r.d + '</td><td>' + r.l + '</td><td>' + r.gf + '</td><td>' + r.ga + '</td><td>' + (gd > 0 ? '+' : '') + gd + '</td><td><b>' + r.pts + '</b></td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }).join('');
    return '<section class="ur-block" aria-labelledby="ur-tb-h"><header class="uc-head ur-reveal"><span class="uc-kicker">Group stage</span><h2 id="ur-tb-h">Final group tables</h2><p><i class="ur-q">Q</i> went through to the semi-finals.</p></header><div class="ur-tables">' + cards + '</div></section>';
  }

  function resultsHtml() {
    var order = []; F.forEach(function (f) { var s = f.stage || 'Matches'; if (order.indexOf(s) < 0) order.push(s); });
    var rank = function (s) { return /^final$/i.test(s) ? 0 : /semi/i.test(s) ? 1 : 2; };
    order.sort(function (a, b) { return rank(a) - rank(b) || a.localeCompare(b); });
    var blocks = order.map(function (stage) {
      var list = F.filter(function (f) { return (f.stage || 'Matches') === stage; });
      var rows = list.map(function (f) {
        var h = team(f.home), a = team(f.away), hw = f.hs > f.as, aw = f.as > f.hs, hl = scorerLines(f, f.home), al = scorerLines(f, f.away);
        return '<li class="ur-m' + (/^final$/i.test(stage) ? ' is-final' : '') + '"><span class="ur-m-time">' + esc(koTime(f)) + '</span>' +
          '<span class="ur-m-team ur-m-team--h' + (hw ? ' is-win' : '') + '"><span>' + esc(h.name) + '</span>' + crest(h, 'sm') + '</span>' +
          '<span class="ur-m-score" aria-label="' + esc(h.name + ' ' + f.hs + ', ' + a.name + ' ' + f.as) + '"><b>' + f.hs + '</b><i aria-hidden="true">&ndash;</i><b>' + f.as + '</b></span>' +
          '<span class="ur-m-team ur-m-team--a' + (aw ? ' is-win' : '') + '">' + crest(a, 'sm') + '<span>' + esc(a.name) + '</span></span>' +
          ((hl.length || al.length) ? '<span class="ur-m-goals"><span class="ur-m-gh">' + hl.map(esc).join(', ') + '</span><span class="ur-m-ga">' + al.map(esc).join(', ') + '</span></span>' : '') + '</li>';
      }).join('');
      var open = rank(stage) < 2;
      return '<details class="ur-stage ur-reveal"' + (open ? ' open' : '') + '><summary><h3>' + esc(stage) + '</h3><small>' + plural(list.length, 'match', 'matches') + '</small></summary><ul class="ur-matches">' + rows + '</ul></details>';
    }).join('');
    return '<section class="ur-block" id="ur-all" aria-labelledby="ur-res-h"><header class="uc-head ur-reveal"><span class="uc-kicker">Every match</span><h2 id="ur-res-h">All the results</h2><p>Scorers are shown under each match.</p></header>' + blocks + '</section>';
  }

  function thanksHtml() {
    return '<section class="ur-block ur-thanks ur-reveal" aria-labelledby="ur-th-h"><h2 id="ur-th-h">Thank you</h2>' +
      '<p>To all ' + R.teams.length + ' teams, every player, the referees and volunteers, and everyone who came to cheer: you made the Unity Cup what it was. Congratulations again to <strong>' + esc(champ.name) + '</strong>.</p>' +
      '<div class="ur-actions"><a class="uc-btn uc-btn--gold" href="unity-cup-photos.html">' + ICON.cam + 'See the photos</a><a class="uc-btn uc-btn--ghost" href="unity-cup-fixtures.html">Fixtures &amp; results</a><a class="uc-btn uc-btn--ghost" href="https://www.instagram.com/lincolnacms/" target="_blank" rel="noopener">Follow LACMS</a></div></section>';
  }

  // ---------------------------------------------------------------------
  // Put it on the page
  body.innerHTML = champsHtml() + awardsHtml() + numbersHtml() + scorersHtml() + bracketHtml() + tablesHtml() + resultsHtml() + thanksHtml();

  // The hero reads from the same numbers
  var lede = document.querySelector('[data-ur-lede]'); if (lede) lede.textContent = champ.name + ' are the Unity Cup champions. Here is how the whole tournament finished: the awards, the top scorers and every result.';
  var meta = document.querySelector('[data-ur-meta]');
  if (meta) meta.innerHTML = '<span class="uc-meta-chip">' + esc(new Date((R.event.date || '2026-11-06') + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) + '</span>' +
    '<span class="uc-meta-chip">' + plural(R.teams.length, 'team') + '</span><span class="uc-meta-chip">' + plural(F.length, 'match', 'matches') + '</span><span class="uc-meta-chip">' + plural(totalGoals, 'goal') + '</span>';

  // Scroll reveals and number count-ups (everything is simply shown when motion is reduced)
  var nodes = Array.prototype.slice.call(body.querySelectorAll('.ur-reveal'));
  function countUp(el) {
    var to = Number(el.getAttribute('data-ur-count')), dec = Number(el.getAttribute('data-dec') || 0);
    if (REDUCED || !isFinite(to)) { el.textContent = dec ? to.toFixed(dec) : String(to); return; }
    var start = null, dur = 1100;
    function step(ts) { if (start === null) start = ts; var k = Math.min(1, (ts - start) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = (to * e).toFixed(dec); if (k < 1) window.requestAnimationFrame(step); else el.textContent = dec ? to.toFixed(dec) : String(to); }
    el.textContent = dec ? (0).toFixed(dec) : '0'; window.requestAnimationFrame(step);
  }
  var confettiDone = false;
  function reveal(el) {
    el.classList.add('is-in');
    $$('[data-ur-count]', el).forEach(countUp);
    if (el.id === 'ur-champs' && !confettiDone) {
      confettiDone = true;
      var seen = false; try { seen = window.sessionStorage.getItem('lacms-ur-confetti') === '1'; window.sessionStorage.setItem('lacms-ur-confetti', '1'); } catch (e) { /* ignore */ }
      if (!REDUCED && !seen && window.UnityFx && UnityFx.confetti) window.setTimeout(function () { UnityFx.confetti({ count: 140 }); }, 350);
    }
  }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  if (REDUCED || !('IntersectionObserver' in window)) nodes.forEach(reveal);
  else {
    var io = new IntersectionObserver(function (entries) { entries.forEach(function (en) { if (en.isIntersecting) { reveal(en.target); io.unobserve(en.target); } }); }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    nodes.forEach(function (n) { io.observe(n); });
  }

  // Share the final as a picture (uses the same share sheet as the match cards)
  body.addEventListener('click', function (e) {
    if (!e.target.closest('[data-ur-share]') || !final || !window.UnityShare) return;
    function st(t) { return { name: t.name, short_name: t.short, colour: t.colour, logo: logo(t) || null }; }
    var h = team(final.home), a = team(final.away);
    var d = { home: st(h), away: st(a), hs: final.hs, as: final.as, status: 'finished', time: koTime(final), stage: 'Final', pitch: final.pitch || '', note: champ.name + ' are the champions', goals: { h: scorerLines(final, final.home), a: scorerLines(final, final.away) } };
    var base = UnityShare.SITE.replace(/[^\/]*$/, '');
    UnityShare.open({ kind: 'match', url: base + 'unity-cup.html', heading: champ.name + ' are champions', title: 'LACMS Unity Cup', filename: 'lacms-unity-cup-final',
      caption: champ.name + ' are the LACMS Unity Cup champions! Final: ' + h.name + ' ' + final.hs + '-' + final.as + ' ' + a.name, data: { fixture: d } });
  });
})();
