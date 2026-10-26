// Ready-made pieces for the feedback form builder: whole forms, sections and single questions.
// Everything here just produces ordinary form definitions (see js/feedback-defs.js); once added to a
// form it can be edited like anything else.
(function () {
  'use strict';
  var FB = window.LACMS_FB;
  if (!FB) return;

  // ---- Small builders -----------------------------------------------------------------------------
  function base(type, title, o) {
    return Object.assign({ id: FB.uid('q'), type: type, title: title, hint: '', required: false, partner_visible: false }, o || {});
  }
  function options(labels) { return labels.map(function (l, i) { return { id: 'o' + (i + 1), label: l }; }); }
  function single(title, labels, o) { return base('single', title, Object.assign({ options: options(labels), allow_other: false, show_results: false, style: 'pills' }, o)); }
  function multi(title, labels, o) { return base('multi', title, Object.assign({ options: options(labels), allow_other: false, show_results: false, max: labels.length }, o)); }
  function scale(title, o) { return base('scale', title, Object.assign({ min: 1, max: 5, low_label: '', high_label: '', style: 'numbers' }, o)); }
  function agree(title, o) { return scale(title, Object.assign({ low_label: 'Strongly disagree', high_label: 'Strongly agree' }, o)); }
  function yesno(title, o) { return base('yesno', title, Object.assign({ yes_label: 'Yes', no_label: 'No', show_results: false }, o)); }
  function text(title, o) { return base('text', title, Object.assign({ placeholder: '', max: 200 }, o)); }
  function longtext(title, o) { return base('longtext', title, Object.assign({ placeholder: '', max: 1000 }, o)); }
  function info(title, body) { return base('info', title, { body: body || '' }); }
  function core(type, o) { return FB.core(type, o); }
  function section(title, description, questions) { return { id: FB.uid('s'), title: title, description: description || '', questions: questions }; }
  function form(settings, sections) { return { v: 1, settings: Object.assign({}, FB.DEFAULT_SETTINGS, settings || {}), sections: sections }; }

  // ---- Whole forms ----------------------------------------------------------------------------------------
  var FORMS = [
    {
      id: 'standard', name: 'Standard feedback', emoji: '⭐', time: '1 min',
      desc: 'The form every event has used so far: rating, what went well, what to improve, would you come again, thank-yous and a comment.',
      build: function () { return FB.standard(); }
    },
    {
      id: 'pulse', name: 'Quick pulse', emoji: '⚡', time: '20 sec',
      desc: 'Just a rating and one open question. Best for busy nights and big crowds.',
      build: function () {
        return form({ submit_label: 'Send' }, [section('', '', [
          core('overall', { required: true, title: 'How was it?' }),
          text('One thing we should keep or change?', { placeholder: 'A few words is plenty' })
        ])]);
      }
    },
    {
      id: 'social', name: 'Social night', emoji: '🎉', time: '1 min',
      desc: 'Atmosphere, a poll for next time, and an easy way to say who made it special.',
      build: function () {
        return form({}, [
          section('', '', [
            core('overall', { required: true }),
            core('liked'), core('improve'),
            single('What should we do more of?', ['Games', 'Music', 'Food and drink', 'Quizzes', 'Meeting new people'], { allow_other: true, show_results: true }),
            core('would_return'), core('shoutouts'), core('comment')
          ]),
          section('A little more, if you like', '', [core('heard'), core('suggestion')])
        ]);
      }
    },
    {
      id: 'workshop', name: 'Workshop or talk', emoji: '🎓', time: '1 min',
      desc: 'How useful it was, the speakers and the content, and what topic to cover next.',
      build: function () {
        return form({}, [
          section('The session', '', [
            core('overall', { required: true, title: 'Overall, how useful was it?' }),
            agree('The content was relevant to me'),
            agree('The speakers were clear and engaging'),
            yesno('Will you use something you learned?', { show_results: false }),
            core('liked', { title: 'What was most useful?' }),
            core('improve')
          ]),
          section('Looking ahead', '', [
            multi('Which topics would you like next?', ['CV and personal statements', 'Interview practice', 'Research and audit', 'Placements and electives', 'Wellbeing and burnout'], { allow_other: true, max: 3, show_results: true }),
            core('comment', { title: 'Anything else you would like us to know?' })
          ])
        ]);
      }
    },
    {
      id: 'mentoring', name: 'Mentoring session', emoji: '🧭', time: '1 min',
      desc: 'For Sankofa Circles and mentoring meetings: connection, usefulness and what to do next time.',
      build: function () {
        return form({ audience: 'members' }, [section('', '', [
          core('overall', { required: true, title: 'How was your session?' }),
          agree('I felt comfortable speaking openly'),
          agree('I left with something I can act on'),
          single('How did the session run?', ['Too short', 'About right', 'Too long']),
          core('liked', { title: 'What worked well?' }),
          longtext('What would make the next session even better?', { placeholder: 'Anything at all' }),
          yesno('Would you like a follow-up conversation with the committee?')
        ])]);
      }
    },
    {
      id: 'charity', name: 'Charity or fundraiser', emoji: '💛', time: '1 min',
      desc: 'Whether the cause was clear, whether people would give again, and how they heard.',
      build: function () {
        return form({}, [section('', '', [
          core('overall', { required: true }),
          agree('It was clear where the money was going'),
          single('Would you take part in another fundraiser?', ['Definitely', 'Probably', 'Not sure', 'Probably not']),
          core('liked'), core('improve'),
          core('heard', { title: 'How did you hear about it?' }),
          core('shoutouts'),
          core('comment')
        ])]);
      }
    },
    {
      id: 'collab', name: 'Collaboration with a partner', emoji: '🤝', time: '1 min',
      desc: 'For events run with another society or organisation. Questions about the partnership are marked to show on partner pages.',
      build: function () {
        return form({}, [
          section('The event', '', [core('overall', { required: true, partner_visible: false }), core('liked'), core('improve'), core('would_return')]),
          section('Working together', 'Optional, but it helps both societies.', [
            agree('It was a good idea to run this event together', { partner_visible: true }),
            single('Did you know the partner society before tonight?', ['No', 'A little', 'Yes, we are members'], { partner_visible: true, show_results: false }),
            yesno('Would you like more joint events like this?', { partner_visible: true, show_results: true }),
            text('What would make a joint event even better?', { partner_visible: true, placeholder: 'A few words' })
          ]),
          section('', '', [core('shoutouts'), core('comment')])
        ]);
      }
    },
    {
      id: 'nps', name: 'Would you recommend us? (NPS)', emoji: '📈', time: '30 sec',
      desc: 'The classic 0 to 10 "how likely are you to recommend" score, with a follow-up on why.',
      build: function () {
        return form({}, [section('', '', [
          scale('How likely are you to recommend LACMS events to a friend?', { min: 0, max: 10, required: true, low_label: 'Not at all likely', high_label: 'Extremely likely' }),
          longtext('What is the main reason for your score?', { placeholder: 'Tell us in your own words' })
        ])]);
      }
    }
  ];

  // ---- Sections ---------------------------------------------------------------------------------------------
  var SECTIONS = [
    {
      id: 'venue', name: 'The venue and organisation', desc: 'Four quick ratings.',
      build: function () { return section('The venue and organisation', '', [agree('The venue was easy to find and comfortable'), agree('The event was well organised'), agree('It started and finished when I expected'), agree('It was good value')]); }
    },
    {
      id: 'speakers', name: 'The speakers', desc: 'Ratings and a favourite moment.',
      build: function () { return section('The speakers', '', [agree('The speakers were clear and engaging'), agree('I learned something new'), text('Your favourite moment?', { placeholder: 'A few words' })]); }
    },
    {
      id: 'ahead', name: 'Looking ahead', desc: 'A poll and a free idea box.',
      build: function () {
        return section('Looking ahead', 'Help us plan what comes next.', [
          multi('What would you like to see more of?', ['Socials', 'Careers sessions', 'Mentoring', 'Charity events', 'Study support'], { max: 3, allow_other: true, show_results: true }),
          single('Which day suits you best?', ['Weekday evening', 'Weekend afternoon', 'Weekend evening', 'Lunchtime'], { show_results: true }),
          core('suggestion')
        ]);
      }
    },
    {
      id: 'about', name: 'About you', desc: 'Optional questions to understand who is coming.',
      build: function () {
        return section('About you', 'Optional. It helps us make events that work for everyone.', [
          single('What year are you in?', ['Foundation', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Postgraduate', 'Not a student']),
          single('Is this your first LACMS event?', ['Yes, my first', 'No, I have been before'])
        ]);
      }
    },
    {
      id: 'followup', name: 'Follow-up', desc: 'Ask if we can get in touch.',
      build: function () {
        return section('Stay in touch', '', [
          yesno('Can we contact you about your feedback?'),
          yesno('Would you like to help organise the next one?')
        ]);
      }
    }
  ];

  // ---- Single questions, grouped ---------------------------------------------------------------------------------
  var QUESTIONS = [
    {
      group: 'Ratings', items: [
        { label: 'Venue', build: function () { return agree('The venue was easy to find and comfortable'); } },
        { label: 'Organisation', build: function () { return agree('The event was well organised'); } },
        { label: 'Content or activities', build: function () { return agree('The content / activities were interesting'); } },
        { label: 'Value for money', build: function () { return agree('It was good value'); } },
        { label: 'Food and drink', build: function () { return scale('How was the food and drink?', { style: 'stars', low_label: 'Poor', high_label: 'Excellent' }); } },
        { label: 'Communication before the event', build: function () { return agree('I had all the information I needed beforehand'); } },
        { label: 'Likelihood to recommend (0 to 10)', build: function () { return scale('How likely are you to recommend this to a friend?', { min: 0, max: 10, low_label: 'Not likely', high_label: 'Very likely' }); } },
        { label: 'Star rating', build: function () { return scale('How would you rate it?', { style: 'stars' }); } }
      ]
    },
    {
      group: 'Polls and choices', items: [
        { label: 'Poll: next event theme', build: function () { return single('What should our next event be?', ['A social night', 'A careers workshop', 'A charity event', 'A mentoring evening'], { show_results: true, allow_other: true }); } },
        { label: 'Poll: best day and time', build: function () { return single('When suits you best?', ['Weekday evening', 'Weekend afternoon', 'Weekend evening', 'Lunchtime'], { show_results: true }); } },
        { label: 'Pick several: topics', build: function () { return multi('Which topics interest you?', ['Careers', 'Wellbeing', 'Study skills', 'Research', 'Placements'], { max: 3, allow_other: true }); } },
        { label: 'How long was it?', build: function () { return single('How did you find the length?', ['Too short', 'About right', 'Too long']); } },
        { label: 'First time?', build: function () { return single('Is this your first LACMS event?', ['Yes, my first', 'No, I have been before'], { show_results: false }); } },
        { label: 'Year of study', build: function () { return single('What year are you in?', ['Foundation', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Postgraduate', 'Not a student']); } }
      ]
    },
    {
      group: 'Yes or no', items: [
        { label: 'Would you recommend it?', build: function () { return yesno('Would you recommend this event to a friend?'); } },
        { label: 'Would you volunteer?', build: function () { return yesno('Would you help run a future event?'); } },
        { label: 'Can we follow up?', build: function () { return yesno('Can we contact you about your feedback?'); } },
        { label: 'Learned something?', build: function () { return yesno('Did you learn something useful?'); } },
        { label: 'Accessibility', build: function () { return yesno('Was everything accessible to you?'); } }
      ]
    },
    {
      group: 'In their own words', items: [
        { label: 'Favourite moment', build: function () { return text('What was your favourite moment?', { placeholder: 'A few words' }); } },
        { label: 'One thing to change', build: function () { return longtext('If you could change one thing, what would it be?', { placeholder: 'Be as honest as you like' }); } },
        { label: 'Topic you want covered', build: function () { return text('What topic would you like us to cover next?', { placeholder: 'e.g. interview practice' }); } },
        { label: 'Words to describe it', build: function () { return text('Describe the night in three words', { placeholder: 'e.g. fun, friendly, loud', max: 80 }); } },
        { label: 'Anything accessibility-related', build: function () { return longtext('Is there anything that would make our events easier for you to attend?', { placeholder: 'Optional' }); } }
      ]
    },
    {
      group: 'Text on the page', items: [
        { label: 'Heading and note', build: function () { return info('A few quick questions', 'This takes about a minute.'); } },
        { label: 'Thank-you note', build: function () { return info('Thank you for coming', 'Everything you tell us is read by the committee.'); } }
      ]
    }
  ];

  window.LACMS_FB_TEMPLATES = { forms: FORMS, sections: SECTIONS, questions: QUESTIONS, make: { single: single, multi: multi, scale: scale, yesno: yesno, text: text, longtext: longtext, info: info, section: section, core: core } };
})();
