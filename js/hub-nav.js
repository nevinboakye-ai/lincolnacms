// One shared navigation for the Members Hub pages, so a member can go
// sideways - Hub, Perks, Resources, Network, Events, Sankofa, Journey -
// without going back to the hub first. It sits on the same row as the Back
// button, scrolls sideways on a phone, marks where you are, and only offers
// what your Hub Access rules let you use. The Journey item shows your level
// once the journey layer has loaded.
(function () {
  'use strict';

  if (typeof supabaseIsConfigured === 'undefined' || !supabaseIsConfigured || typeof supabaseClient === 'undefined' || !supabaseClient) return;
  var holder = document.querySelector('.back-nav');
  if (!holder || holder.querySelector('.hub-nav')) return;

  var page = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();

  var ICON = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
    perks: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
    resources: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    network: '<path d="M17 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1"/><circle cx="10" cy="8" r="3.5"/><path d="M21 20v-1a4 4 0 0 0-3-3.9"/><path d="M16 4.2a3.5 3.5 0 0 1 0 6.6"/>',
    events: '<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>',
    sankofa: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="8" r="2"/><circle cx="8" cy="15" r="2"/><circle cx="16" cy="15" r="2"/>',
    journey: '<path d="M12 21V11"/><path d="M12 11c0-3 2-5 5-5 0 3-2 5-5 5z"/><path d="M12 14c0-2.500-1.700-4-4.500-4 0 2.500 1.700 4 4.500 4z"/>'
  };

  function item(key, href, label, matches) {
    return { key: key, href: href, label: label, active: matches.indexOf(page) !== -1 };
  }

  function build(access) {
    function allowed(feature, fallback) {
      if (!access) return fallback;
      return access[feature] === undefined ? fallback : !!access[feature];
    }
    var items = [item('home', 'member-hub.html', 'Hub', ['member-hub.html'])];
    if (allowed('perks', true)) items.push(item('perks', 'member-perks.html', 'Perks', ['member-perks.html']));
    if (allowed('resources', true)) items.push(item('resources', 'member-resources.html', 'Resources', ['member-resources.html']));
    if (allowed('network', false)) items.push(item('network', 'member-network.html', 'Network', ['member-network.html']));
    items.push(item('events', 'events.html', 'Events', ['events.html']));
    if (allowed('sankofa_hub', false)) items.push(item('sankofa', 'member-sankofa-hub.html', 'Sankofa', ['member-sankofa-hub.html', 'member-sankofa.html']));
    else if (allowed('sankofa', false)) items.push(item('sankofa', 'member-sankofa.html', 'Sankofa', ['member-sankofa.html']));
    if (allowed('journey', true)) items.push(item('journey', 'member-journey.html', 'Journey', ['member-journey.html']));

    var nav = document.createElement('nav');
    nav.className = 'hub-nav';
    nav.setAttribute('aria-label', 'Members Hub');
    nav.innerHTML = items.map(function (it) {
      return '<a class="hub-nav-link' + (it.active ? ' is-active' : '') + '" href="' + it.href + '"' + (it.active ? ' aria-current="page"' : '') + ' data-hub-nav="' + it.key + '">' +
        '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[it.key] + '</svg>' +
        '<span>' + it.label + '</span>' + (it.key === 'journey' ? '<b class="hub-nav-lv" hidden></b>' : '') + '</a>';
    }).join('');
    holder.appendChild(nav);
    holder.classList.add('has-hub-nav');
    // keep the current page in view on a phone
    var cur = nav.querySelector('.is-active');
    if (cur && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = Math.max(0, cur.offsetLeft - 16);

    // Level badge on the Journey item, once the journey layer knows it.
    function paintLevel(s) {
      var el = nav.querySelector('.hub-nav-lv');
      if (!el) return;
      if (s && s.eligible !== false && !s.hidden && s.progress) { el.textContent = s.progress.level; el.hidden = false; el.title = 'Level ' + s.progress.level; }
      else el.hidden = true;
    }
    if (window.lacmsJourney) window.lacmsJourney.onState(paintLevel);
  }

  supabaseClient.rpc('get_my_hub_access').then(function (res) {
    var access = null;
    if (!res.error && res.data && res.data.length) {
      access = {};
      res.data.forEach(function (r) { access[r.feature] = !!r.allowed; });
    }
    build(access);
  }, function () { build(null); });
})();
