// Feedback forms: what a form definition looks like, shared by the feedback page, the form builder
// and the results (migration 104).
//
// A form is { v: 1, settings: {...}, sections: [ { id, title, description, questions: [ ... ] } ] }.
// A question is { id, type, title, hint, required, show_if, partner_visible, ...type options }.
//
// Built-in questions (type = id): overall, liked, improve, would_return, shoutouts, comment, heard, suggestion.
// Your own: single, multi, scale, yesno, text, longtext, and "info" (a heading or note, not a question).
//
// The database checks every form when it is saved and every answer when it is sent. Everything here is
// to draw the form and to give helpful messages sooner; it is never the only check.
window.LACMS_FB = (function () {
  'use strict';

  var CORE = ['overall', 'liked', 'improve', 'would_return', 'shoutouts', 'comment', 'heard', 'suggestion'];

  // The kinds of question, for the builder's picker and for labels in results.
  var TYPES = {
    overall:      { label: 'Overall rating', group: 'built-in', icon: '★', desc: 'Faces or stars from poor to brilliant. The main score on your results.' },
    liked:        { label: 'What went well', group: 'built-in', icon: '👍', desc: 'Tap-to-pick reasons that suit the kind of event, plus a typed box.' },
    improve:      { label: 'What could be better', group: 'built-in', icon: '🛠️', desc: 'Tap-to-pick improvements, plus a typed box.' },
    would_return: { label: 'Would you come again?', group: 'built-in', icon: '🔁', desc: 'Yes, maybe or probably not.' },
    shoutouts:    { label: 'Who made the night valuable', group: 'built-in', icon: '👏', desc: 'Names of people or teams to thank.' },
    comment:      { label: 'Anything else', group: 'built-in', icon: '💬', desc: 'A comment box with sentence starters and a "you may quote me" option.' },
    heard:        { label: 'How did you hear?', group: 'built-in', icon: '📣', desc: 'Instagram, a friend, a poster... useful for promotion.' },
    suggestion:   { label: 'An event idea', group: 'built-in', icon: '💡', desc: 'What event would they love you to run?' },
    single:       { label: 'Pick one', group: 'your own', icon: '◉', desc: 'One answer from a list. Can also be a live poll.' },
    multi:        { label: 'Pick several', group: 'your own', icon: '☑', desc: 'Tick as many as apply (you set the limit). Can also be a poll.' },
    scale:        { label: 'Scale or rating', group: 'your own', icon: '▔', desc: '1 to 5 (numbers, stars or faces), or 0 to 10 for a "how likely" score.' },
    yesno:        { label: 'Yes or no', group: 'your own', icon: '✓', desc: 'A quick yes/no. Can also be a poll.' },
    text:         { label: 'Short answer', group: 'your own', icon: '✏️', desc: 'A line of text.' },
    longtext:     { label: 'Long answer', group: 'your own', icon: '📝', desc: 'A few sentences.' },
    info:         { label: 'Heading or note', group: 'your own', icon: 'ℹ️', desc: 'Not a question: a heading and a few words to introduce what comes next.' }
  };

  var CORE_TITLES = {
    overall: 'Overall, how was it?', liked: 'What went well?', improve: 'What could be better?', would_return: 'Would you come to another one?',
    shoutouts: 'Who made the night valuable?', comment: 'Anything else?', heard: 'How did you hear about it?', suggestion: 'An event you’d love us to run'
  };
  var CORE_HINTS = {
    liked: 'Tap any (up to 5)', improve: 'Tap any (up to 5)',
    shoutouts: 'Name anyone or any team you’d like to thank: a person, the welcome desk, a speaker, a volunteer.'
  };

  var DEFAULT_SETTINGS = {
    title: '', intro: '', thank_you: '', submit_label: 'Send feedback', audience: 'everyone',
    allow_anonymous: true, ask_quote_consent: true, guest_pitch: true, closes_on: null
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function rnd(n) { var s = ''; var c = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (var i = 0; i < n; i++) s += c.charAt(Math.floor(Math.random() * c.length)); return s; }
  function uid(prefix) { return (prefix || 'q') + '_' + rnd(6); }
  function core(type, extra) { return Object.assign({ id: type, type: type, title: CORE_TITLES[type], hint: '', required: false, partner_visible: false }, extra || {}); }

  // The form every event has used so far: the starting point for anything you build.
  function standard() {
    return {
      v: 1,
      settings: clone(DEFAULT_SETTINGS),
      sections: [
        { id: 's_main', title: '', description: '', questions: [core('overall', { required: true, style: 'faces' }), core('liked'), core('improve'), core('would_return'), core('shoutouts'), core('comment')] },
        { id: 's_more', title: 'A little more, if you like', description: '', questions: [core('heard'), core('suggestion')] }
      ]
    };
  }

  function flat(def) {
    var out = [];
    ((def && def.sections) || []).forEach(function (s) { (s.questions || []).forEach(function (q) { out.push({ q: q, section: s }); }); });
    return out;
  }
  function findQuestion(def, id) { var f = flat(def).filter(function (x) { return x.q.id === id; })[0]; return f ? f.q : null; }

  // ---- "Show only if" --------------------------------------------------------------------
  // Which questions can another question depend on, and what can it be compared with?
  function canBeSource(q) {
    return ['single', 'multi', 'scale', 'yesno', 'overall', 'would_return', 'heard'].indexOf(q.type) !== -1;
  }
  var HEARD_KEYS = [['instagram', 'Instagram'], ['groupchat', 'A group chat'], ['friend', 'A friend'], ['email', 'Email'], ['poster', 'Poster or flyer'], ['committee', 'A committee member'], ['website', 'This website'], ['other', 'Somewhere else']];
  // The answers a rule can be written against, as [value, label] pairs; null means "a number".
  function sourceChoices(q) {
    if (q.type === 'single' || q.type === 'multi') return (q.options || []).map(function (o) { return [o.id, o.label]; }).concat(q.allow_other ? [['other', 'Other']] : []);
    if (q.type === 'yesno') return [['yes', q.yes_label || 'Yes'], ['no', q.no_label || 'No']];
    if (q.type === 'would_return') return [['yes', 'Yes, definitely'], ['maybe', 'Maybe'], ['no', 'Probably not']];
    if (q.type === 'heard') return HEARD_KEYS;
    return null;
  }
  // Does a rule hold? getVal(id) gives the current answer value (string, number, array or null).
  function ruleHolds(rule, getVal) {
    if (!rule || !rule.q) return true;
    var val = getVal(rule.q);
    var empty = val === null || val === undefined || val === '' || (Array.isArray(val) && !val.length);
    if (empty) return false;
    if (rule.op === 'answered') return true;
    if (rule.op === 'lte') return Number(val) <= Number(rule.v);
    if (rule.op === 'gte') return Number(val) >= Number(rule.v);
    var wants = Array.isArray(rule.v) ? rule.v.map(String) : [String(rule.v)];
    var has = Array.isArray(val) ? val.map(String) : [String(val)];
    var hit = has.some(function (x) { return wants.indexOf(x) !== -1; });
    return rule.op === 'is_not' ? !hit : hit;
  }

  // ---- Friendly checks while building (the database re-checks everything) --------------------
  function problems(def) {
    var errs = [], seen = {}, total = 0, earlier = {};
    if (!def || !def.sections || !def.sections.length) return [{ msg: 'Add at least one section.' }];
    if (def.sections.length > 10) errs.push({ msg: 'A form can have up to 10 sections.' });
    def.sections.forEach(function (s) {
      (s.questions || []).forEach(function (q) {
        total++;
        var tag = { id: q.id };
        if (q.type !== 'info' && !String(q.title || '').trim()) errs.push({ id: q.id, msg: 'A question has no title.' });
        if (q.type === 'info' && !String(q.title || '').trim() && !String(q.body || '').trim()) errs.push({ id: q.id, msg: 'A heading or note is empty.' });
        if (q.type === 'single' || q.type === 'multi') {
          var opts = q.options || [];
          if (opts.length < 2) errs.push({ id: q.id, msg: '“' + (q.title || 'A choice question') + '” needs at least 2 options.' });
          if (opts.some(function (o) { return !String(o.label || '').trim(); })) errs.push({ id: q.id, msg: '“' + (q.title || 'A choice question') + '” has an empty option.' });
          if (opts.length > 20) errs.push({ id: q.id, msg: '“' + q.title + '” has more than 20 options.' });
        }
        if (q.show_if && q.show_if.q) {
          if (!earlier[q.show_if.q]) errs.push({ id: q.id, msg: '“' + (q.title || 'A question') + '” is set to appear based on a question that comes after it (or was removed).' });
          else if (q.show_if.op !== 'answered' && (q.show_if.v === undefined || q.show_if.v === '' || (Array.isArray(q.show_if.v) && !q.show_if.v.length))) errs.push({ id: q.id, msg: 'Finish the “show only if” rule on “' + (q.title || 'a question') + '”.' });
        }
        if (seen[q.id]) errs.push({ id: q.id, msg: 'Two questions share an id.' });
        seen[q.id] = true;
        earlier[q.id] = true;
        void tag;
      });
    });
    if (total > 40) errs.push({ msg: 'A form can have up to 40 questions.' });
    if (total < 1) errs.push({ msg: 'Add at least one question.' });
    return errs;
  }

  // ---- Results for the questions you write yourself (feedback_form_results / feedback_custom_results) ----
  // One bar per answer: [{ label, n }]. Typed "Other" answers are counted under "Other".
  function resultList(it) {
    var c = it.counts || {}, out = [], i;
    if (it.type === 'single' || it.type === 'multi') {
      (it.options || []).forEach(function (o) { out.push({ label: o.label, n: Number(c[o.id] || 0) }); });
      if (it.allow_other && c.other) out.push({ label: 'Other', n: Number(c.other) });
    } else if (it.type === 'yesno') {
      out.push({ label: it.yes_label || 'Yes', n: Number(c.yes || 0) }, { label: it.no_label || 'No', n: Number(c.no || 0) });
    } else if (it.type === 'scale') {
      for (i = Number(it.min); i <= Number(it.max); i++) out.push({ label: String(i), n: Number(c[i] || 0) });
    }
    return out;
  }
  // What someone answered, as plain text (for downloads). def = the question (or the results entry for it).
  function answerText(q, ans) {
    if (!ans || ans.v === undefined || ans.v === null) return '';
    var label = function (id) {
      if (id === 'other') return 'Other' + (ans.other ? ': ' + ans.other : '');
      var o = (q.options || []).filter(function (x) { return x.id === id; })[0];
      return o ? o.label : id;
    };
    if (q.type === 'single') return label(ans.v);
    if (q.type === 'multi') return (ans.v || []).map(label).join('; ');
    if (q.type === 'yesno') return ans.v === 'yes' ? (q.yes_label || 'Yes') : (q.no_label || 'No');
    return String(ans.v);
  }

  return {
    resultList: resultList, answerText: answerText,
    CORE: CORE, TYPES: TYPES, CORE_TITLES: CORE_TITLES, CORE_HINTS: CORE_HINTS, DEFAULT_SETTINGS: DEFAULT_SETTINGS, HEARD_KEYS: HEARD_KEYS,
    standard: standard, core: core, clone: clone, uid: uid, flat: flat, findQuestion: findQuestion,
    canBeSource: canBeSource, sourceChoices: sourceChoices, ruleHolds: ruleHolds, problems: problems
  };
})();
