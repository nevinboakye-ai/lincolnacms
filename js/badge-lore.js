// Badge stories: click any badge (Journey page, Members Hub bar, Sankofa Hub)
// to read its full text and a little of the culture or history behind its name.
// Renderers add the data attributes with lacmsBadgeLore.attrs(badge, kind);
// one click handler on the document opens the pop-up.
(function () {
  'use strict';
  if (window.lacmsBadgeLore) return;

  var LORE = {
    member: {
      welcome: 'Akwaaba is "welcome" in Twi, the Akan language of Ghana. You will see it painted on shop fronts and airport signs: in Ghanaian culture a guest is greeted warmly before anything else is discussed.',
      profile_pro: 'Adire is indigo-dyed cloth made by Yoruba women in south-west Nigeria, especially around Abeokuta. Patterns are drawn in cassava paste, or tied and stitched, before dyeing - and many patterns have their own names and meanings.',
      deal_hunter: 'A souk is a traditional North African and Arab market. The souks of Marrakech, in Morocco\'s old medina, are a maze of stalls where friendly haggling is an expected art.',
      smart_saver: 'Ajo is the Yoruba name for a rotating savings club: everyone pays in regularly and takes turns receiving the pot. The same idea runs across the diaspora - it is called susu in Ghana and the Caribbean, and sou-sou in Trinidad and Tobago.',
      event_goer: 'In Trinidad and Tobago a fête is a party - especially in the build-up to Carnival, where soca music, dancing and community sit at the centre of everything.',
      regular_face: 'Junkanoo is the Bahamas\' street parade, held on Boxing Day and New Year\'s Day, with huge handmade costumes, cowbells, goatskin drums and brass. It grew out of the celebrations of enslaved Africans, who were given a few days off at Christmas.',
      social_butterfly: 'Crop Over is Barbados\' summer festival. It began in the 1780s as a celebration at the end of the sugar-cane harvest, and today it builds up to Grand Kadooment and the crowning of the calypso monarch.',
      contributor: 'Ubuntu comes from the Nguni languages of southern Africa: "umuntu ngumuntu ngabantu" - a person is a person through other people. It became a guiding idea in post-apartheid South Africa.',
      library_builder: 'From the 13th to the 16th century Timbuktu, in Mali, was a centre of Islamic scholarship, with libraries and universities such as Sankore. Huge collections of manuscripts survive, many still looked after by local families.',
      supporter: '"Big up" is Jamaican Patois for giving someone respect and praise. It spread through reggae and dancehall, and from there into British slang.',
      conversationalist: 'A kgotla is the traditional community meeting place of the Tswana people of Botswana, where a chief and elders hear everyone and anyone may speak. It is often named as one root of Botswana\'s tradition of open discussion.',
      nominator: 'Griots (jeli in Mandinka) are West African storytellers, praise-singers and historians who keep family histories and great epics alive in song, often with the kora. To be praised by a griot was a real honour.',
      kingmaker: 'Among the Asante of Ghana, the Queen Mother (Ohemaa) holds a very real power: she nominates the candidate for the stool, and the kingmakers then confirm the choice. Choosing well is one of the oldest forms of leadership.',
      praise_streak: 'Or\u00ECk\u00EC are Yoruba praise poems from Nigeria, sung about a person\'s character, family and deeds. Every Yoruba person has them, and hearing yours recited is a moment of pride.',
      feedback_giver: 'The palaver tree is a large shade tree at the heart of many West African villages. Under it, elders and neighbours gather to settle disputes, share news and hear everyone\'s view before a decision is made. \u201CPalaver\u201D itself comes from a Portuguese word for talk.',
      connector: 'Jambo is a Swahili greeting, widely heard in Kenya and Tanzania. Swahili is spoken right across East Africa and is an official language of the African Union.',
      pathfinder: 'Sankofa comes from the Akan people of Ghana: "se wo were fi na wosankofa a yenkyi" - it is not wrong to go back and fetch what you forgot. It is shown as a bird looking backwards with an egg in its beak, and it gave our mentoring programme its name.',
      consistent: 'The djembe is a goblet-shaped drum from the Mandinka people of West Africa, traditionally Guinea and Mali. Its name is often explained by a saying, "anke djé, anke bé" - everyone gather together in peace.',
      dedicated: 'Great Zimbabwe was a medieval stone city built between the 11th and 15th centuries by the ancestors of the Shona. Its dry-stone walls, laid without mortar, still stand - and the country is named after it.',
      all_rounder: 'Jollof rice is the one-pot rice dish of West Africa, and which country cooks it best - Ghana, Nigeria or Senegal - is a famous, friendly rivalry. Its roots are traced to the Wolof people of Senegambia.',
      old_hand: 'New yam festivals mark the end of the farming season - in Igbo communities in Nigeria it is Iri Ji, and Akan and Ewe communities in Ghana have their own. The first yams are offered in thanks before anyone eats.',
      champion: 'Tallawah is Jamaican Patois for strong, determined and not easily beaten. "Likkle but tallawah" - small but mighty - is a proudly Jamaican saying.',
      legend: 'Nelson Mandela, known by his clan name Madiba, spent 27 years in prison before becoming South Africa\'s first democratically elected president in 1994. He is remembered above all for reconciliation.'
    },
    sankofa: {
      founding: 'The baobab, "the tree of life", grows from a small seed and can live for thousands of years. You were part of the very first seeds of the Sankofa Hub.',
      first_steps: 'Griots keep a community\'s stories - births, journeys, victories - and tell them aloud. Finishing your profile is your own first telling.',
      ice_breaker: 'To "lime" in Trinidad and Tobago, and across the eastern Caribbean, is to hang out - chatting and laughing with no agenda. Every good lime starts with a hello.',
      connector: 'Harambee is Swahili for "all pull together". Kenya\'s first president, Jomo Kenyatta, made it a national motto, and communities still use harambee to raise money for schools and clinics.',
      showed_up: '"Pull up" is Jamaican dancehall slang for turning up where you are wanted - arriving, and being counted.',
      regular: 'Sawubona is Zulu for "I see you", answered with "Sikhona" - "I am here". The greeting is about truly seeing a person, not just saying hello.',
      reflective: 'Across West Africa, stories - including the Anansi tales - were traditionally told in the evening, often under the moon, to pass wisdom down the generations.',
      goal_getter: '"Piti piti zwazo fè nich li" is a Haitian Creole proverb: little by little, the bird builds its nest. Big things are built one small piece at a time.',
      goal_crusher: 'Lalibela, in northern Ethiopia, has eleven churches carved downwards out of solid rock around the 12th and 13th centuries. It is a UNESCO World Heritage Site and still a place of pilgrimage.',
      voice: 'The talking drum (dùndún) of the Yoruba is an hourglass drum whose pitch changes as the cords are squeezed, so it can imitate the tones of speech and carry messages.',
      cheerleader: 'Calypso grew in Trinidad and Tobago from West African storytelling and the songs of enslaved people. Calypsonians use wit and praise to comment on life, and a Calypso Monarch is crowned each Carnival.',
      appreciated: 'Irie is Jamaican Patois, made famous by reggae and Rastafari, meaning "all good" - fine, happy, at peace.',
      on_a_roll: 'Highlife is a music style from Ghana and Nigeria, born in the early 20th century by mixing Akan rhythms with brass bands and guitars. E. T. Mensah is known as the "King of Highlife".',
      unstoppable: 'Maroons were people who escaped slavery and built free communities in the mountains and forests of Jamaica, Suriname and elsewhere. Nanny of the Maroons is a National Hero of Jamaica.',
      host: 'Teranga is the Wolof word for hospitality, and a core value in Senegal. The national football team is nicknamed the Lions of Teranga.',
      feedback: 'Hwehwemudua, "the measuring rod", is an Adinkra symbol of the Akan people of Ghana. It stands for examination, quality and the pursuit of excellence.',
      canopy: 'Nyansapo, "the wisdom knot", is an Adinkra symbol of the Akan people. It stands for wisdom, ingenuity, intelligence and patience.',
      baobab: 'The Sankofa bird walks forward while looking backward, with an egg - the future - in its beak. The idea: learn from the past to move ahead, and then pass it on.'
    }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // data attributes for a clickable badge element
  function attrs(b, kind) {
    return ' data-bl-kind="' + esc(kind || 'member') + '" data-bl-key="' + esc(b.key) + '" data-bl-name="' + esc(b.name) + '" data-bl-icon="' + esc(b.icon) +
      '" data-bl-desc="' + esc(b.description) + '" data-bl-hint="' + esc(b.hint || '') + '" data-bl-earned="' + (b.earned ? '1' : '0') +
      '" data-bl-date="' + esc(b.awarded_at || '') + '" role="button" tabindex="0" aria-haspopup="dialog"';
  }

  var lastFocus = null;
  function close() {
    var el = document.getElementById('bl-backdrop');
    if (el) el.parentNode.removeChild(el);
    document.removeEventListener('keydown', onKey, true);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }

  function open(el) {
    var d = el.dataset, kind = d.blKind || 'member';
    var lore = (LORE[kind] || {})[d.blKey] || '';
    var earned = d.blEarned === '1';
    var when = '';
    if (earned && d.blDate) { var t = new Date(d.blDate); if (!isNaN(t)) when = t.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }
    lastFocus = el;
    close();
    var b = document.createElement('div');
    b.id = 'bl-backdrop'; b.className = 'bl-backdrop';
    b.innerHTML = '<div class="bl-dialog' + (earned ? ' is-earned' : '') + '" role="dialog" aria-modal="true" aria-labelledby="bl-title">' +
      '<button type="button" class="bl-close" data-bl-close aria-label="Close">&times;</button>' +
      '<span class="bl-icon" aria-hidden="true">' + esc(d.blIcon) + '</span>' +
      '<h2 id="bl-title">' + esc(d.blName) + '</h2>' +
      '<p class="bl-status">' + (earned ? 'Earned' + (when ? ' ' + esc(when) : '') : 'Not earned yet') + '</p>' +
      '<p class="bl-desc">' + esc(d.blDesc) + '</p>' +
      (!earned && d.blHint ? '<p class="bl-how"><strong>How to earn it:</strong> ' + esc(d.blHint) + '</p>' : '') +
      (lore ? '<div class="bl-story"><span class="bl-story-label">The story behind the name</span><p>' + esc(lore) + '</p></div>' : '') +
      '</div>';
    b.addEventListener('click', function (e) { if (e.target === b || e.target.closest('[data-bl-close]')) close(); });
    document.body.appendChild(b);
    document.addEventListener('keydown', onKey, true);
    var c = b.querySelector('[data-bl-close]'); if (c) c.focus();
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-bl-key]') : null;
    if (!el) return;
    e.preventDefault();
    open(el);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var el = e.target.closest ? e.target.closest('[data-bl-key]') : null;
    if (!el || document.getElementById('bl-backdrop')) return;
    e.preventDefault();
    open(el);
  });

  window.lacmsBadgeLore = { attrs: attrs, open: open, lore: LORE };
})();
