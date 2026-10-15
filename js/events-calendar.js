// Events page: calendar view + in-page editing for the Executive Committee.
//
// Adds a List | Calendar switch above the events list. The calendar is a
// month grid (Monday first, UK dates) with every event on its day - multi-day
// events run across the days - a month agenda underneath (tap a day to see just
// that day), a "dates to be confirmed" list for events without a date yet, and
// "Add to calendar" (Google Calendar link or an .ics file for Apple / Outlook,
// per event or for the whole programme). Phones get a compact grid with dots;
// tap a day and its events appear below.
//
// For people with the Events dashboard section in Hub Access (president and
// Executive Committee by default) the same page becomes the editor: an "Add
// event" button, a "+" on each day to add an event on that date, and Edit /
// Hide / Delete on every event. Dates, times and venue are entered with real
// pickers; the wording shown in the list (date_text, time_note) is built from
// them for you. Saving refreshes the list and the calendar straight away.
// All of it is enforced in the database (migration 080 policies), not here.
//
// Events from before migration 080 have no real date column; their date is
// read out of the old text ("21 November 2026") so the calendar works
// immediately, and the editor says what to run if it can't save.
(function () {
  'use strict';

  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;
  var list = document.querySelector('[data-events-from-db]');
  if (!list) return;

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var DEFAULT_TAGS = ['Social', 'Mentorship', 'Careers', 'Charity', 'Academic', 'Flagship Event'];
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var VIEW_KEY = 'lacms-events-view';

  var events = [];
  var canEdit = false;
  var signedIn = false;
  var view = 'list';
  var cursor = null;        // { y, m } month being shown
  var selected = null;      // 'YYYY-MM-DD' the day picked in the grid
  var wrap = null;          // the calendar container
  var toolbar = null;
  var loaded = false;

  function esc(str) {
    return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---- Dates ("YYYY-MM-DD" strings, done in UTC so daylight saving never shifts a day) ----
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function key(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function parseKey(k) { var p = k.split('-'); return { y: +p[0], m: +p[1] - 1, d: +p[2] }; }
  function utc(k) { var p = parseKey(k); return Date.UTC(p.y, p.m, p.d); }
  function fromUtc(ms) { var d = new Date(ms); return key(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
  function addDays(k, n) { return fromUtc(utc(k) + n * 86400000); }
  function daysBetween(a, b) { return Math.round((utc(b) - utc(a)) / 86400000); }
  function todayKey() { var d = new Date(); return key(d.getFullYear(), d.getMonth(), d.getDate()); }
  function weekdayIndex(k) { return (new Date(utc(k)).getUTCDay() + 6) % 7; } // Monday = 0
  function longDate(k) { var p = parseKey(k); return WEEKDAYS_LONG[weekdayIndex(k)] + ' ' + p.d + ' ' + MONTHS[p.m] + ' ' + p.y; }
  function shortDate(k) { var p = parseKey(k); return p.d + ' ' + MONTHS[p.m].slice(0, 3); }
  function timeText(t) {
    if (!t) return '';
    var p = t.split(':'); var h = +p[0]; var m = +p[1];
    var ap = h >= 12 ? 'pm' : 'am';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + (m ? ':' + pad(m) : '') + ap;
  }
  function trimTime(t) { return t ? String(t).slice(0, 5) : null; } // "19:00:00" -> "19:00"

  // Older events only have text like "21 November 2026".
  function parseDateText(text) {
    var m = /(\d{1,2})(?:\s*[\u2013-]\s*\d{1,2})?\s+([A-Za-z]+)\s+(\d{4})/.exec(String(text || ''));
    if (!m) return null;
    var mi = -1;
    for (var i = 0; i < 12; i++) { if (MONTHS[i].toLowerCase().indexOf(m[2].toLowerCase().slice(0, 3)) === 0) { mi = i; break; } }
    return mi === -1 ? null : key(+m[3], mi, +m[1]);
  }

  function normalise(r) {
    var start = r.starts_on || parseDateText(r.date_text);
    return {
      id: r.id, slug: r.slug, name: r.name, summary: r.summary || '', details: r.details || '',
      tag: r.tag || '', tagGold: !!r.tag_is_gold, flagship: !!r.is_flagship, active: r.is_active !== false,
      start: start, end: r.ends_on && start && r.ends_on >= start ? r.ends_on : start,
      startTime: trimTime(r.start_time), endTime: trimTime(r.end_time), venue: r.venue || '',
      dateText: r.date_text || '', timeNote: r.time_note || '',
      titleUrl: r.title_url || '', linkUrl: r.link_url || '', linkLabel: r.link_label || '', buttonUrl: r.button_url || '', buttonLabel: r.button_label || '',
      sortOrder: r.sort_order || 0, hasRealDate: !!r.starts_on
    };
  }
  function category(ev) {
    if (ev.flagship || ev.tagGold) return 'flagship';
    var t = ev.tag.toLowerCase();
    if (t.indexOf('social') !== -1) return 'social';
    if (t.indexOf('mentor') !== -1) return 'mentorship';
    if (t.indexOf('career') !== -1 || t.indexOf('professional') !== -1) return 'careers';
    if (t.indexOf('charity') !== -1) return 'charity';
    if (t.indexOf('academic') !== -1) return 'academic';
    return 'other';
  }
  function safeUrl(url) {
    var u = String(url || '').trim();
    if (!u) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return /^(https?:|mailto:|tel:)/i.test(u) ? encodeURI(u) : '';
    if (u.indexOf('//') === 0) return '';
    return encodeURI(u);
  }

  // The words shown in the list, built from the pickers.
  function buildDateText(start, end) {
    if (!start) return 'Date TBC';
    var a = parseKey(start);
    if (!end || end === start) return a.d + ' ' + MONTHS[a.m] + ' ' + a.y;
    var b = parseKey(end);
    if (a.y === b.y && a.m === b.m) return a.d + '\u2013' + b.d + ' ' + MONTHS[a.m] + ' ' + a.y;
    if (a.y === b.y) return a.d + ' ' + MONTHS[a.m].slice(0, 3) + ' \u2013 ' + b.d + ' ' + MONTHS[b.m].slice(0, 3) + ' ' + a.y;
    return a.d + ' ' + MONTHS[a.m].slice(0, 3) + ' ' + a.y + ' \u2013 ' + b.d + ' ' + MONTHS[b.m].slice(0, 3) + ' ' + b.y;
  }
  function buildTimeNote(startTime, endTime, venue) {
    var parts = [];
    if (startTime) parts.push(timeText(startTime) + (endTime ? ' \u2013 ' + timeText(endTime) : ''));
    if (venue) parts.push(venue);
    return parts.length ? parts.join(' \u00b7 ') : 'Time & venue TBC';
  }
  function whenText(ev) {
    var date = ev.start ? (ev.end && ev.end !== ev.start ? longDate(ev.start) + ' \u2013 ' + longDate(ev.end) : longDate(ev.start)) : (ev.dateText || 'Date to be confirmed');
    return date;
  }
  function timeVenueText(ev) {
    if (ev.startTime || ev.venue) return buildTimeNote(ev.startTime, ev.endTime, ev.venue);
    return ev.timeNote || 'Time & venue TBC';
  }

  // ---- Add to calendar -------------------------------------------------------
  function icsEscape(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function icsFold(line) {
    var out = [];
    while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); }
    out.push(line);
    return out.join('\r\n');
  }
  function compact(k) { return k.replace(/-/g, ''); }
  function stamp(k, t) { return compact(k) + 'T' + t.replace(':', '') + '00'; }
  function endPoint(ev) {
    // Timed events default to two hours when no end time is set.
    if (ev.startTime) {
      var endDay = ev.end || ev.start;
      var endT = ev.endTime;
      if (!endT) {
        var h = +ev.startTime.slice(0, 2) + 2;
        if (h >= 24) { endDay = addDays(endDay, 1); h -= 24; }
        endT = pad(h) + ':' + ev.startTime.slice(3, 5);
      }
      return { day: endDay, time: endT };
    }
    return { day: addDays(ev.end || ev.start, 1), time: null };
  }
  function veventLines(ev) {
    var lines = ['BEGIN:VEVENT', 'UID:' + ev.slug + '@lincolnacms.uk', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')];
    var e = endPoint(ev);
    if (ev.startTime) { lines.push('DTSTART:' + stamp(ev.start, ev.startTime)); lines.push('DTEND:' + stamp(e.day, e.time)); }
    else { lines.push('DTSTART;VALUE=DATE:' + compact(ev.start)); lines.push('DTEND;VALUE=DATE:' + compact(e.day)); }
    lines.push('SUMMARY:' + icsEscape(ev.name));
    if (ev.summary) lines.push('DESCRIPTION:' + icsEscape(ev.summary + ' \u2014 https://lincolnacms.uk/events.html#' + ev.slug));
    if (ev.venue) lines.push('LOCATION:' + icsEscape(ev.venue));
    lines.push('URL:https://lincolnacms.uk/events.html#' + ev.slug, 'END:VEVENT');
    return lines;
  }
  function downloadIcs(evs, filename) {
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LACMS//Events//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:LACMS events'];
    evs.forEach(function (ev) { lines = lines.concat(veventLines(ev)); });
    lines.push('END:VCALENDAR');
    var blob = new Blob([lines.map(icsFold).join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  function googleUrl(ev) {
    var e = endPoint(ev);
    var dates = ev.startTime ? stamp(ev.start, ev.startTime) + '/' + stamp(e.day, e.time) : compact(ev.start) + '/' + compact(e.day);
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(ev.name) +
      '&dates=' + dates + '&ctz=Europe%2FLondon&details=' + encodeURIComponent((ev.summary || '') + '\nhttps://lincolnacms.uk/events.html#' + ev.slug) +
      (ev.venue ? '&location=' + encodeURIComponent(ev.venue) : '');
  }

  // ---- Data --------------------------------------------------------------------
  function load() {
    return supabaseClient.from('site_events').select('*').order('sort_order', { ascending: true }).then(function (res) {
      if (res.error) { console.warn('Events calendar: couldn\'t load events:', res.error.message); return false; }
      var rows = res.data || [];
      events = rows.map(normalise).filter(function (ev) { return ev.active || canEdit; });
      loaded = true;
      return true;
    }, function () { return false; });
  }

  // ---- Layout: toolbar + calendar container ------------------------------------
  function buildShell() {
    toolbar = document.createElement('div');
    toolbar.className = 'ev-toolbar';
    toolbar.innerHTML =
      '<div class="ui-seg ev-viewseg" role="radiogroup" aria-label="Events view">' +
        '<label class="ui-seg-opt"><input type="radio" name="ev-view" value="list"><span>' + icon('list') + 'List</span></label>' +
        '<label class="ui-seg-opt"><input type="radio" name="ev-view" value="calendar"><span>' + icon('cal') + 'Calendar</span></label>' +
      '</div>' +
      '<div class="ev-toolbar-actions">' +
        '<button type="button" class="btn btn-outline ev-btn" data-ev-addall hidden>' + icon('download') + 'Add all to my calendar</button>' +
        '<button type="button" class="btn btn-primary ev-btn" data-ev-add hidden>' + icon('plus') + 'Add event</button>' +
      '</div>';
    list.parentNode.insertBefore(toolbar, list);
    wrap = document.createElement('div');
    wrap.className = 'ev-cal';
    wrap.id = 'ev-calendar';
    wrap.hidden = true;
    list.parentNode.insertBefore(wrap, list.nextSibling);

    toolbar.addEventListener('change', function (e) {
      if (e.target.name === 'ev-view') setView(e.target.value);
    });
    toolbar.addEventListener('click', function (e) {
      if (e.target.closest('[data-ev-add]')) openEditor(null, selected);
      else if (e.target.closest('[data-ev-addall]')) {
        var dated = events.filter(function (ev) { return ev.active && ev.start; });
        if (dated.length) downloadIcs(dated, 'lacms-events.ics');
      }
    });
    wrap.addEventListener('click', onCalClick);
    wrap.addEventListener('keydown', onCalKey);
  }

  var ICONS = {
    list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    prev: '<polyline points="15 18 9 12 15 6"/>',
    next: '<polyline points="9 18 15 12 9 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
    pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    eyeoff: '<path d="M17.9 17.9A10.1 10.1 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.1-5.9"/><path d="M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2"/><line x1="1" y1="1" x2="23" y2="23"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'
  };
  function icon(name) {
    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  function setView(next, quiet) {
    view = next === 'calendar' ? 'calendar' : 'list';
    list.hidden = view === 'calendar';
    wrap.hidden = view !== 'calendar';
    var radio = toolbar.querySelector('input[value="' + view + '"]');
    if (radio) radio.checked = true;
    toolbar.querySelector('[data-ev-addall]').hidden = view !== 'calendar' || !events.some(function (ev) { return ev.active && ev.start; });
    try { localStorage.setItem(VIEW_KEY, view); } catch (e) { /* ignore */ }
    if (!quiet) {
      var base = window.location.pathname + window.location.search;
      try { window.history.replaceState(null, '', view === 'calendar' ? base + '#calendar' : base); } catch (e2) { /* ignore */ }
    }
    if (view === 'calendar') renderCalendar();
  }

  // ---- Calendar rendering ----------------------------------------------------------
  function eventsByDay() {
    var map = {};
    events.forEach(function (ev) {
      if (!ev.start) return;
      var span = Math.min(daysBetween(ev.start, ev.end || ev.start), 60);
      for (var i = 0; i <= span; i++) {
        var k = addDays(ev.start, i);
        (map[k] = map[k] || []).push({ ev: ev, first: i === 0, last: i === span });
      }
    });
    Object.keys(map).forEach(function (k) {
      map[k].sort(function (a, b) {
        var ta = a.ev.startTime || '00:00', tb = b.ev.startTime || '00:00';
        return ta === tb ? a.ev.name.localeCompare(b.ev.name) : (ta < tb ? -1 : 1);
      });
    });
    return map;
  }

  function monthKey(c) { return key(c.y, c.m, 1); }

  function renderCalendar() {
    if (!wrap || view !== 'calendar') return;
    if (!cursor) {
      var t = parseKey(todayKey());
      // Start on the month of the next event if this month has none.
      cursor = { y: t.y, m: t.m };
      var upcoming = events.filter(function (ev) { return ev.active && ev.start && (ev.end || ev.start) >= todayKey(); }).sort(function (a, b) { return a.start < b.start ? -1 : 1; })[0];
      var hasThis = events.some(function (ev) { return ev.start && ev.start.slice(0, 7) === key(t.y, t.m, 1).slice(0, 7); });
      if (!hasThis && upcoming) { var u = parseKey(upcoming.start); cursor = { y: u.y, m: u.m }; }
    }
    var map = eventsByDay();
    var first = monthKey(cursor);
    var offset = weekdayIndex(first);
    var dim = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
    var weeks = Math.ceil((offset + dim) / 7);
    var today = todayKey();
    var gridStart = addDays(first, -offset);

    var cells = '';
    for (var i = 0; i < weeks * 7; i++) {
      var k = addDays(gridStart, i);
      var p = parseKey(k);
      var inMonth = p.m === cursor.m;
      var items = map[k] || [];
      var shown = items.slice(0, 3);
      var more = items.length - shown.length;
      var label = longDate(k) + (items.length ? ', ' + items.length + (items.length === 1 ? ' event' : ' events') : ', no events');
      cells += '<div class="ev-day' + (inMonth ? '' : ' is-other') + (k === today ? ' is-today' : '') + (k < today ? ' is-past' : '') + (k === selected ? ' is-selected' : '') + (items.length ? ' has-events' : '') + '" role="gridcell" data-day="' + k + '" tabindex="' + (k === (selected || (inMonth && p.d === 1 ? k : '')) ? '0' : '-1') + '" aria-label="' + esc(label) + '"' + (k === selected ? ' aria-selected="true"' : '') + '>' +
        '<span class="ev-day-num">' + p.d + '</span>' +
        (canEdit ? '<button type="button" class="ev-day-add" data-ev-add-on="' + k + '" aria-label="Add an event on ' + esc(longDate(k)) + '" tabindex="-1">' + icon('plus') + '</button>' : '') +
        '<div class="ev-day-events">' +
          shown.map(function (it) { return chipHtml(it); }).join('') +
          (more > 0 ? '<button type="button" class="ev-more" data-ev-day="' + k + '">+' + more + ' more</button>' : '') +
        '</div>' +
        (items.length ? '<span class="ev-dots" aria-hidden="true">' + items.slice(0, 4).map(function (it) { return '<i class="ev-dot ev-dot--' + category(it.ev) + '"></i>'; }).join('') + '</span>' : '') +
      '</div>';
    }

    var tags = {};
    events.forEach(function (ev) { if (ev.start && ev.active) tags[category(ev)] = ev.tag || (category(ev) === 'flagship' ? 'Flagship' : 'Event'); });
    var legend = Object.keys(tags).map(function (c) { return '<span class="ev-legend-item"><i class="ev-dot ev-dot--' + c + '"></i>' + esc(tags[c]) + '</span>'; }).join('');

    wrap.innerHTML =
      '<div class="ev-cal-head">' +
        '<div class="ev-cal-nav">' +
          '<button type="button" class="ev-nav-btn" data-ev-prev aria-label="Previous month">' + icon('prev') + '</button>' +
          '<h2 class="ev-cal-title" aria-live="polite">' + MONTHS[cursor.m] + ' ' + cursor.y + '</h2>' +
          '<button type="button" class="ev-nav-btn" data-ev-next aria-label="Next month">' + icon('next') + '</button>' +
        '</div>' +
        '<button type="button" class="btn btn-outline ev-today" data-ev-today>Today</button>' +
      '</div>' +
      '<div class="ev-grid" role="grid" aria-label="' + MONTHS[cursor.m] + ' ' + cursor.y + '">' +
        '<div class="ev-weekdays" role="row">' + WEEKDAYS.map(function (d, i) { return '<span role="columnheader" aria-label="' + WEEKDAYS_LONG[i] + '">' + d + '</span>'; }).join('') + '</div>' +
        '<div class="ev-days" style="--ev-weeks:' + weeks + ';">' + cells + '</div>' +
      '</div>' +
      (legend ? '<div class="ev-legend">' + legend + '</div>' : '') +
      '<section class="ev-agenda" aria-label="Events list for this view">' + agendaHtml(map) + '</section>' +
      undatedHtml();
  }

  function chipHtml(it) {
    var ev = it.ev;
    var timed = it.first && ev.startTime ? '<span class="ev-chip-time">' + esc(timeText(ev.startTime)) + '</span>' : '';
    return '<button type="button" class="ev-chip ev-chip--' + category(ev) + (it.first ? '' : ' is-cont') + (it.last ? '' : ' is-open') + (ev.active ? '' : ' is-hidden') + '" data-ev-open="' + esc(ev.slug) + '" title="' + esc(ev.name) + '">' +
      timed + '<span class="ev-chip-name">' + esc(ev.name) + '</span></button>';
  }

  function agendaHtml(map) {
    var first = monthKey(cursor);
    var dim = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
    var rows = [];
    var title;
    if (selected && selected.slice(0, 7) === first.slice(0, 7)) {
      title = longDate(selected);
      (map[selected] || []).forEach(function (it) { rows.push({ day: selected, ev: it.ev }); });
    } else {
      title = 'Events in ' + MONTHS[cursor.m] + ' ' + cursor.y;
      var seen = {};
      for (var d = 1; d <= dim; d++) {
        (map[key(cursor.y, cursor.m, d)] || []).forEach(function (it) { if (!seen[it.ev.slug]) { seen[it.ev.slug] = 1; rows.push({ day: key(cursor.y, cursor.m, d), ev: it.ev }); } });
      }
      // multi-day events that began earlier but run into this month
      Object.keys(map).forEach(function (k) {
        if (k.slice(0, 7) === first.slice(0, 7) && k === first) map[k].forEach(function (it) { if (!seen[it.ev.slug]) { seen[it.ev.slug] = 1; rows.unshift({ day: k, ev: it.ev }); } });
      });
    }
    var head = '<div class="ev-agenda-head"><h3>' + esc(title) + '</h3>' +
      (selected ? '<button type="button" class="ev-link" data-ev-clear>Show the whole month</button>' : '') + '</div>';
    if (!rows.length) {
      return head + '<p class="ev-empty">' + (selected ? 'Nothing on this day.' : 'Nothing scheduled this month.') +
        (canEdit ? ' <button type="button" class="ev-link" data-ev-add-on="' + (selected || first) + '">Add an event</button>' : '') + '</p>';
    }
    return head + '<ul class="ev-agenda-list">' + rows.map(function (r) {
      var ev = r.ev;
      var p = parseKey(ev.start);
      return '<li><button type="button" class="ev-agenda-item ev-agenda-item--' + category(ev) + (ev.active ? '' : ' is-hidden') + '" data-ev-open="' + esc(ev.slug) + '">' +
        '<span class="ev-agenda-date"><b>' + p.d + '</b><small>' + WEEKDAYS[weekdayIndex(ev.start)] + '</small></span>' +
        '<span class="ev-agenda-main"><strong>' + esc(ev.name) + (ev.active ? '' : ' <em>(hidden)</em>') + '</strong>' +
        '<span>' + esc(timeVenueText(ev)) + (ev.end && ev.end !== ev.start ? ' &middot; until ' + esc(shortDate(ev.end)) : '') + '</span></span>' +
        (ev.tag ? '<span class="card-tag' + (ev.tagGold ? ' card-tag--gold' : '') + '">' + esc(ev.tag) + '</span>' : '') +
      '</button></li>';
    }).join('') + '</ul>';
  }

  function undatedHtml() {
    var und = events.filter(function (ev) { return !ev.start && (ev.active || canEdit); });
    if (!und.length) return '';
    return '<section class="ev-undated"><h3>Dates to be confirmed</h3><ul>' + und.map(function (ev) {
      return '<li><button type="button" class="ev-link" data-ev-open="' + esc(ev.slug) + '">' + esc(ev.name) + '</button><span>' + esc(ev.dateText || 'Date TBC') + '</span></li>';
    }).join('') + '</ul></section>';
  }

  // ---- Interaction ------------------------------------------------------------------
  function shiftMonth(n) {
    cursor = { y: cursor.y + Math.floor((cursor.m + n) / 12), m: ((cursor.m + n) % 12 + 12) % 12 };
    selected = null;
    renderCalendar();
  }
  function focusDay(k) {
    var el = wrap.querySelector('[data-day="' + k + '"]');
    if (el) { Array.prototype.forEach.call(wrap.querySelectorAll('.ev-day[tabindex="0"]'), function (n) { n.tabIndex = -1; }); el.tabIndex = 0; el.focus(); }
  }

  function onCalClick(e) {
    if (e.target.closest('[data-ev-prev]')) { shiftMonth(-1); return; }
    if (e.target.closest('[data-ev-next]')) { shiftMonth(1); return; }
    if (e.target.closest('[data-ev-today]')) { var t = parseKey(todayKey()); cursor = { y: t.y, m: t.m }; selected = todayKey(); renderCalendar(); focusDay(selected); return; }
    if (e.target.closest('[data-ev-clear]')) { selected = null; renderCalendar(); return; }
    var addOn = e.target.closest('[data-ev-add-on]');
    if (addOn) { e.stopPropagation(); openEditor(null, addOn.getAttribute('data-ev-add-on')); return; }
    var openBtn = e.target.closest('[data-ev-open]');
    if (openBtn) { e.stopPropagation(); openDetail(openBtn.getAttribute('data-ev-open')); return; }
    var more = e.target.closest('[data-ev-day]');
    if (more) { selected = more.getAttribute('data-ev-day'); renderCalendar(); focusDay(selected); var ag = wrap.querySelector('.ev-agenda'); if (ag) ag.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' }); return; }
    var day = e.target.closest('[data-day]');
    if (day) {
      var k = day.getAttribute('data-day');
      selected = selected === k ? null : k;
      var p = parseKey(k);
      if (p.m !== cursor.m) cursor = { y: p.y, m: p.m };
      renderCalendar();
      if (selected) { focusDay(selected); var a2 = wrap.querySelector('.ev-agenda'); if (a2 && window.innerWidth < 760) a2.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' }); }
    }
  }

  function onCalKey(e) {
    var day = e.target.closest && e.target.closest('.ev-day');
    if (!day || e.target !== day) return;
    var k = day.getAttribute('data-day');
    var next = null;
    if (e.key === 'ArrowRight') next = addDays(k, 1);
    else if (e.key === 'ArrowLeft') next = addDays(k, -1);
    else if (e.key === 'ArrowDown') next = addDays(k, 7);
    else if (e.key === 'ArrowUp') next = addDays(k, -7);
    else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      var p = parseKey(k);
      var dir = e.key === 'PageDown' ? 1 : -1;
      var nm = new Date(Date.UTC(p.y, p.m + dir, 1));
      var target = key(nm.getUTCFullYear(), nm.getUTCMonth(), Math.min(p.d, new Date(Date.UTC(nm.getUTCFullYear(), nm.getUTCMonth() + 1, 0)).getUTCDate()));
      cursor = { y: nm.getUTCFullYear(), m: nm.getUTCMonth() }; selected = target; renderCalendar(); focusDay(target);
      return;
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); day.click(); return; }
    if (next) {
      e.preventDefault();
      var np = parseKey(next);
      if (np.m !== cursor.m || np.y !== cursor.y) { cursor = { y: np.y, m: np.m }; selected = next; renderCalendar(); }
      focusDay(next);
    }
  }

  // ---- Dialogs ----------------------------------------------------------------------
  function openDialog(html, cls) {
    var previous = document.activeElement;
    var backdrop = document.createElement('div');
    backdrop.className = 'guide-backdrop';
    var dialog = document.createElement('div');
    dialog.className = 'guide-dialog ev-dialog' + (cls ? ' ' + cls : '');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = html;
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    document.body.classList.add('guide-open');
    requestAnimationFrame(function () { backdrop.classList.add('is-in'); setTimeout(function () { backdrop.classList.add('is-in'); }, 30); var f = dialog.querySelector('[data-autofocus]') || dialog.querySelector('button, input'); if (f) f.focus(); });
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

  function paragraphs(text) {
    return String(text || '').split(/\n{2,}/).filter(function (p) { return p.trim(); }).map(function (p) { return '<p>' + esc(p.trim()).replace(/\n/g, '<br>') + '</p>'; }).join('');
  }

  function openDetail(slug) {
    var ev = events.filter(function (x) { return x.slug === slug; })[0];
    if (!ev) return;
    var rowBtn = document.querySelector('#' + CSS.escape(slug) + ' .member-register-btn');
    var canRegister = signedIn && rowBtn;
    var titleUrl = safeUrl(ev.titleUrl), linkUrl = safeUrl(ev.linkUrl), buttonUrl = safeUrl(ev.buttonUrl);
    var dlg = openDialog(
      '<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button>' +
      (ev.tag ? '<span class="card-tag' + (ev.tagGold ? ' card-tag--gold' : '') + '">' + esc(ev.tag) + '</span>' : '') +
      '<h2 class="guide-title ev-detail-title">' + (titleUrl ? '<a href="' + esc(titleUrl) + '">' + esc(ev.name) + '</a>' : esc(ev.name)) + (ev.active ? '' : ' <em>(hidden)</em>') + '</h2>' +
      '<ul class="ev-facts"><li>' + icon('cal') + '<span>' + esc(whenText(ev)) + '</span></li>' +
        '<li>' + icon('clock') + '<span>' + esc(timeVenueText(ev).split(' \u00b7 ')[0]) + '</span></li>' +
        (ev.venue ? '<li>' + icon('pin') + '<span>' + esc(ev.venue) + '</span></li>' : '') + '</ul>' +
      (ev.summary ? '<p class="guide-text">' + esc(ev.summary) + '</p>' : '') +
      (ev.details ? '<div class="ev-detail-body">' + paragraphs(ev.details) + '</div>' : '') +
      '<div class="guide-actions ev-detail-actions">' +
        (buttonUrl && ev.buttonLabel ? '<a class="btn btn-primary btn-glow" href="' + esc(buttonUrl) + '">' + esc(ev.buttonLabel) + '</a>' : '') +
        (canRegister ? '<button type="button" class="btn btn-primary" data-ev-register>' + esc(rowBtn.textContent.trim() || 'Register') + '</button>' : '') +
        (!signedIn ? '<a class="btn btn-outline" href="join.html">RSVP</a>' : '') +
        (linkUrl && ev.linkLabel ? '<a class="btn btn-outline" href="' + esc(linkUrl) + '">' + esc(ev.linkLabel) + '</a>' : '') +
      '</div>' +
      (ev.start ? '<div class="ev-addcal"><span>Add to calendar</span>' +
        '<a class="btn btn-outline ev-btn" href="' + esc(googleUrl(ev)) + '" target="_blank" rel="noopener">Google</a>' +
        '<button type="button" class="btn btn-outline ev-btn" data-ev-ics>Apple / Outlook (.ics)</button></div>' : '') +
      (canEdit ? '<div class="ev-admin-actions"><button type="button" class="btn btn-outline ev-btn" data-ev-edit>' + icon('edit') + 'Edit</button>' +
        '<button type="button" class="btn btn-outline ev-btn" data-ev-toggle>' + icon('eyeoff') + (ev.active ? 'Hide from the website' : 'Show on the website') + '</button>' +
        '<button type="button" class="btn btn-outline ev-btn ev-danger" data-ev-delete>' + icon('trash') + 'Delete</button></div>' : ''));
    var d = dlg.el;
    var reg = d.querySelector('[data-ev-register]');
    if (reg) reg.addEventListener('click', function () {
      rowBtn.click();
      setTimeout(function () { reg.textContent = rowBtn.textContent.trim() || 'Register'; }, 700);
    });
    var ics = d.querySelector('[data-ev-ics]');
    if (ics) ics.addEventListener('click', function () { downloadIcs([ev], ev.slug + '.ics'); });
    var ed = d.querySelector('[data-ev-edit]');
    if (ed) ed.addEventListener('click', function () { dlg.close(); setTimeout(function () { openEditor(ev); }, 220); });
    var tg = d.querySelector('[data-ev-toggle]');
    if (tg) tg.addEventListener('click', function () {
      supabaseClient.from('site_events').update({ is_active: !ev.active }).eq('id', ev.id).then(function (res) {
        if (res.error) { toast("Couldn't update it: " + res.error.message, true); return; }
        dlg.close(); changed(ev.active ? '"' + ev.name + '" is hidden.' : '"' + ev.name + '" is showing on the website.');
      });
    });
    var del = d.querySelector('[data-ev-delete]');
    if (del) del.addEventListener('click', function () {
      if (!window.confirm('Delete "' + ev.name + '"? This can\'t be undone (to just take it off the website for now, use Hide instead). Anyone already registered keeps their record, but it will no longer match an event.')) return;
      supabaseClient.from('site_events').delete().eq('id', ev.id).then(function (res) {
        if (res.error) { toast("Couldn't delete it: " + res.error.message, true); return; }
        dlg.close(); changed('"' + ev.name + '" was deleted.');
      });
    });
  }

  function slugify(name) {
    var s = String(name).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return s || 'event';
  }
  function uniqueSlug(name) {
    var base = slugify(name), s = base, i = 2;
    while (events.some(function (e) { return e.slug === s; })) { s = base + '-' + i; i++; }
    return s;
  }

  function openEditor(ev, presetDay) {
    var isNew = !ev;
    var e0 = ev || { name: '', summary: '', details: '', tag: '', start: presetDay || '', end: '', startTime: '', endTime: '', venue: '', active: true, flagship: false, tagGold: false, titleUrl: '', linkUrl: '', linkLabel: '', buttonUrl: '', buttonLabel: '', dateText: '' };
    var tagSet = DEFAULT_TAGS.slice();
    events.forEach(function (x) { if (x.tag && tagSet.indexOf(x.tag) === -1) tagSet.push(x.tag); });
    if (e0.tag && tagSet.indexOf(e0.tag) === -1) tagSet.push(e0.tag);
    var hasDate = !!e0.start;
    var dlg = openDialog(
      '<button type="button" class="guide-close" data-dialog-close aria-label="Close">&times;</button>' +
      '<span class="guide-eyebrow">Events</span><h2 class="guide-title">' + (isNew ? 'Add an event' : 'Edit event') + '</h2>' +
      '<form class="guide-form ev-form" novalidate>' +
        '<div class="field"><label for="evf-name">Event name</label><input type="text" id="evf-name" maxlength="120" value="' + esc(e0.name) + '" placeholder="e.g. ACMS Games Night 3" data-autofocus></div>' +
        '<div class="ev-form-row"><div class="field"><label for="evf-start">Date</label><input type="date" id="evf-start" value="' + esc(e0.start || '') + '"></div>' +
        '<div class="field"><label for="evf-end">Ends on <span class="guide-optional">(multi-day, optional)</span></label><input type="date" id="evf-end" value="' + esc(e0.end && e0.end !== e0.start ? e0.end : '') + '"></div></div>' +
        '<div class="field" id="evf-label-field"' + (hasDate ? ' hidden' : '') + '><label for="evf-label">No date yet? What should it say</label><input type="text" id="evf-label" maxlength="60" value="' + esc(!hasDate ? (e0.dateText || '') : '') + '" placeholder="e.g. Spring 2027 (leave empty for \u201cDate TBC\u201d)"></div>' +
        '<div class="ev-form-row"><div class="field"><label for="evf-from">Starts at <span class="guide-optional">(optional)</span></label><input type="time" id="evf-from" value="' + esc(e0.startTime || '') + '"></div>' +
        '<div class="field"><label for="evf-to">Ends at <span class="guide-optional">(optional)</span></label><input type="time" id="evf-to" value="' + esc(e0.endTime || '') + '"></div></div>' +
        '<div class="field"><label for="evf-venue">Venue <span class="guide-optional">(optional)</span></label><input type="text" id="evf-venue" maxlength="200" value="' + esc(e0.venue || '') + '" placeholder="e.g. Students\' Union, Main Hall"></div>' +
        '<div class="field"><label for="evf-summary">Short description</label><textarea id="evf-summary" rows="2" maxlength="300" placeholder="One or two lines shown on the event row">' + esc(e0.summary) + '</textarea></div>' +
        '<div class="field"><label for="evf-details">More details <span class="guide-optional">(shown when the event is opened - optional)</span></label><textarea id="evf-details" rows="4" maxlength="3000">' + esc(e0.details) + '</textarea></div>' +
        '<div class="ev-form-row"><div class="field"><label for="evf-tag">Category</label><select id="evf-tag"><option value="">None</option>' + tagSet.map(function (t) { return '<option value="' + esc(t) + '"' + (t === e0.tag ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '<option value="__new">New category\u2026</option></select>' +
        '<input type="text" id="evf-newtag" maxlength="30" placeholder="Category name" hidden></div>' +
        '<div class="field ev-checks"><label class="checkbox-option"><input type="checkbox" id="evf-flagship"' + (e0.flagship ? ' checked' : '') + '>Flagship event (gold)</label>' +
        '<label class="checkbox-option"><input type="checkbox" id="evf-active"' + (e0.active ? ' checked' : '') + '>Show on the website</label></div></div>' +
        '<details class="ev-links-more"' + (e0.titleUrl || e0.linkUrl || e0.buttonUrl ? ' open' : '') + '><summary>Links (optional)</summary>' +
          '<div class="field"><label for="evf-titleurl">Make the title a link to</label><input type="text" id="evf-titleurl" value="' + esc(e0.titleUrl) + '" placeholder="e.g. mmg.html"></div>' +
          '<div class="ev-form-row"><div class="field"><label for="evf-btnlabel">Button text</label><input type="text" id="evf-btnlabel" maxlength="40" value="' + esc(e0.buttonLabel) + '" placeholder="e.g. MMG Portal"></div>' +
          '<div class="field"><label for="evf-btnurl">Button link</label><input type="text" id="evf-btnurl" value="' + esc(e0.buttonUrl) + '"></div></div>' +
          '<div class="ev-form-row"><div class="field"><label for="evf-linklabel">Extra link text</label><input type="text" id="evf-linklabel" maxlength="80" value="' + esc(e0.linkLabel) + '"></div>' +
          '<div class="field"><label for="evf-linkurl">Extra link</label><input type="text" id="evf-linkurl" value="' + esc(e0.linkUrl) + '"></div></div>' +
        '</details>' +
        '<p class="ev-preview" id="evf-preview" aria-live="polite"></p>' +
        '<p class="guide-error" id="evf-error" role="alert" hidden></p>' +
        '<div class="guide-actions"><button type="submit" class="btn btn-primary" id="evf-save">' + (isNew ? 'Add event' : 'Save changes') + '</button><button type="button" class="btn btn-outline" data-dialog-close>Cancel</button></div>' +
      '</form>', 'ev-dialog--wide');
    var d = dlg.el;
    var $ = function (id) { return d.querySelector('#' + id); };
    function preview() {
      var s = $('evf-start').value, en = $('evf-end').value;
      $('evf-label-field').hidden = !!s;
      $('evf-preview').innerHTML = 'Shows as: <strong>' + esc(s ? buildDateText(s, en) : ($('evf-label').value.trim() || 'Date TBC')) + '</strong> &middot; ' + esc(buildTimeNote($('evf-from').value, $('evf-to').value, $('evf-venue').value.trim()));
    }
    ['evf-start', 'evf-end', 'evf-label', 'evf-from', 'evf-to', 'evf-venue'].forEach(function (id) { $(id).addEventListener('input', preview); });
    $('evf-tag').addEventListener('change', function () { var nw = $('evf-tag').value === '__new'; $('evf-newtag').hidden = !nw; if (nw) $('evf-newtag').focus(); });
    preview();

    d.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = $('evf-error');
      err.hidden = true;
      function fail(m) { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'nearest' }); }
      var name = $('evf-name').value.trim();
      var summary = $('evf-summary').value.trim();
      var start = $('evf-start').value || null;
      var end = $('evf-end').value || null;
      var from = $('evf-from').value || null;
      var to = $('evf-to').value || null;
      if (name.length < 3) { fail('Give the event a name.'); return; }
      if (summary.length < 10) { fail('Add a short description (at least 10 characters).'); return; }
      if (end && !start) { fail('Pick the start date as well as the end date.'); return; }
      if (end && end < start) { fail('The end date can\'t be before the start date.'); return; }
      if (to && !from) { fail('Add a start time as well as the end time.'); return; }
      if (from && to && (!end || end === start) && to <= from) { fail('The end time has to be after the start time.'); return; }
      var tag = $('evf-tag').value === '__new' ? $('evf-newtag').value.trim() : $('evf-tag').value;
      var flagship = $('evf-flagship').checked;
      var venue = $('evf-venue').value.trim();
      var payload = {
        name: name, summary: summary, details: $('evf-details').value.trim() || null,
        tag: tag || null, tag_is_gold: flagship || (tag === 'Flagship Event'), is_flagship: flagship, is_active: $('evf-active').checked,
        starts_on: start, ends_on: end && end !== start ? end : null, start_time: from, end_time: to, venue: venue || null,
        date_text: start ? buildDateText(start, end) : ($('evf-label').value.trim() || 'Date TBC'),
        time_note: buildTimeNote(from, to, venue),
        title_url: $('evf-titleurl').value.trim() || null,
        button_label: $('evf-btnlabel').value.trim() || null, button_url: $('evf-btnurl').value.trim() || null,
        link_label: $('evf-linklabel').value.trim() || null, link_url: $('evf-linkurl').value.trim() || null,
        sort_order: start ? Math.round(utc(start) / 86400000) : 99999
      };
      var save = $('evf-save');
      save.disabled = true; save.textContent = 'Saving\u2026';
      var req;
      if (isNew) { payload.slug = uniqueSlug(name); req = supabaseClient.from('site_events').insert(payload); }
      else req = supabaseClient.from('site_events').update(payload).eq('id', ev.id);
      req.then(function (res) {
        if (res.error) {
          save.disabled = false; save.textContent = isNew ? 'Add event' : 'Save changes';
          var m = res.error.message || '';
          fail(/starts_on|ends_on|start_time|end_time|venue|column/i.test(m)
            ? 'The database needs updating before events can be edited here - run migration 080 in Supabase (README-members-setup.md, section 133).'
            : (/row-level security|permission/i.test(m) ? 'You don\'t have permission to change events.' : "Couldn't save: " + m));
          return;
        }
        dlg.close();
        if (start) { var p = parseKey(start); cursor = { y: p.y, m: p.m }; selected = null; }
        changed(isNew ? '"' + name + '" was added.' : 'Saved.');
      }, function () { save.disabled = false; save.textContent = isNew ? 'Add event' : 'Save changes'; fail('Couldn\'t reach the server - try again.'); });
    });
  }

  function changed(message) {
    load().then(function () {
      document.dispatchEvent(new CustomEvent('lacms:events-changed'));
      renderCalendar();
      if (toolbar) toolbar.querySelector('[data-ev-addall]').hidden = view !== 'calendar' || !events.some(function (ev) { return ev.active && ev.start; });
      toast(message);
    });
  }
  function toast(message, isError) {
    var t = document.createElement('div');
    t.className = 'ev-toast' + (isError ? ' is-error' : '');
    t.setAttribute('role', isError ? 'alert' : 'status');
    t.textContent = message;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('is-in'); });
    setTimeout(function () { t.classList.remove('is-in'); setTimeout(function () { t.remove(); }, 250); }, isError ? 7000 : 4000);
  }

  // ---- Start --------------------------------------------------------------------------
  function start() {
    supabaseClient.auth.getSession().then(function (r) {
      signedIn = !!(r.data && r.data.session);
      return signedIn ? supabaseClient.rpc('get_my_hub_access') : { data: null, error: true };
    }).then(function (res) {
      if (res && !res.error && res.data) canEdit = res.data.some(function (x) { return x.feature === 'dash_events' && x.allowed; });
      return load();
    }).then(function (ok) {
      if (!ok && !events.length) return; // nothing to show a calendar of
      buildShell();
      toolbar.querySelector('[data-ev-add]').hidden = !canEdit;
      var saved = null;
      try { saved = localStorage.getItem(VIEW_KEY); } catch (e) { /* ignore */ }
      var want = window.location.hash === '#calendar' ? 'calendar' : (window.location.hash && window.location.hash.length > 1 ? 'list' : (saved || 'list'));
      setView(want, true);
      window.addEventListener('hashchange', function () { if (window.location.hash === '#calendar') setView('calendar', true); });
      // The "Register" buttons appear after the list wires them up; keep the calendar in step.
      document.addEventListener('lacms:events-changed', function () { /* list reload is handled by members.js */ });
    });
  }
  start();
})();
