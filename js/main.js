(function () {
  'use strict';

  // Keep --header-h in sync with the real rendered height of the banner +
  // header stack, since the draft banner can wrap onto 1-3 lines depending
  // on viewport width. The mobile drawer and anchor scroll offset both key
  // off this variable.
  var topbar = document.querySelector('.site-topbar');
  if (topbar) {
    var syncHeaderHeight = function () {
      document.documentElement.style.setProperty('--header-h', topbar.offsetHeight + 'px');
    };
    syncHeaderHeight();
    window.addEventListener('resize', syncHeaderHeight);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(syncHeaderHeight);
    }
  }

  // Mobile nav toggle
  var toggle = document.querySelector('.nav-toggle');
  var drawer = document.querySelector('.mobile-drawer');

  if (toggle && drawer) {
    toggle.addEventListener('click', function () {
      var isOpen = drawer.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
      document.body.classList.toggle('nav-open', isOpen);
    });

    drawer.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        drawer.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('nav-open');
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && drawer.classList.contains('is-open')) {
        drawer.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('nav-open');
        toggle.focus();
      }
    });
  }

  // Logo fallback: if Media/logo.png hasn't been added yet, show the
  // text monogram instead of a broken image icon. The image may have
  // already failed by the time this script runs, so check both cases.
  document.querySelectorAll('.brand').forEach(function (brand) {
    var img = brand.querySelector('.brand-mark');
    if (!img) return;
    var showFallback = function () { brand.classList.add('logo-missing'); };
    if (img.complete && img.naturalWidth === 0) {
      showFallback();
    } else {
      img.addEventListener('error', showFallback, { once: true });
    }
  });

  // Mark the current page's nav link as active
  var current = (window.location.pathname.split('/').pop() || 'index.html');
  document.querySelectorAll('.nav-links a[href]').forEach(function (link) {
    var href = link.getAttribute('href').split('#')[0];
    if (href === current || (href === 'index.html' && current === '')) {
      link.setAttribute('aria-current', 'page');
    }
  });

  // Footer year
  document.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  // Homepage intro splash — plays once per browser session, skips entirely
  // for prefers-reduced-motion, and stays on screen until the visitor
  // actively dismisses it (click/tap anywhere, a swipe, or any keypress).
  // There is deliberately no auto-dismiss timer. The splash markup only
  // exists on index.html, so this is a no-op elsewhere.
  var splash = document.getElementById('intro-splash');
  if (splash) {
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var alreadySeen = false;
    try { alreadySeen = sessionStorage.getItem('lacmsIntroSeen') === '1'; } catch (e) {}

    if (alreadySeen || reduceMotion) {
      splash.remove();
    } else {
      try { sessionStorage.setItem('lacmsIntroSeen', '1'); } catch (e) {}

      document.body.classList.add('intro-active');
      splash.classList.add('is-visible');

      var dismissed = false;

      function dismissIntro() {
        if (dismissed) return;
        dismissed = true;
        splash.classList.add('is-leaving');
        document.body.classList.remove('intro-active');
        document.removeEventListener('keydown', dismissIntro);
        window.setTimeout(function () { splash.remove(); }, 500);
      }

      splash.addEventListener('click', dismissIntro);
      document.addEventListener('keydown', dismissIntro);

      // Swipe detection (a deliberate drag doesn't always register as a
      // simple tap/click on touch devices)
      var touchStartX = 0, touchStartY = 0;
      splash.addEventListener('touchstart', function (e) {
        var t = e.changedTouches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
      }, { passive: true });
      splash.addEventListener('touchend', function (e) {
        var t = e.changedTouches[0];
        var dx = t.clientX - touchStartX;
        var dy = t.clientY - touchStartY;
        if (Math.abs(dx) > 24 || Math.abs(dy) > 24) dismissIntro();
      }, { passive: true });
    }
  }

  // Carousels (e.g. the homepage Events carousel) — draggable with the
  // mouse on desktop (native touch/trackpad swipe already works via
  // overflow-x + scroll-snap), plus prev/next buttons that disable at
  // either end. Dragging past a small threshold suppresses the slide's
  // click-through so a drag doesn't accidentally navigate.
  document.querySelectorAll('[data-carousel-track]').forEach(function (track) {
    var section = track.closest('section');
    var prevBtn = section ? section.querySelector('[data-carousel-prev]') : null;
    var nextBtn = section ? section.querySelector('[data-carousel-next]') : null;

    function step() {
      var slide = track.firstElementChild;
      return slide ? slide.getBoundingClientRect().width + 16 : track.clientWidth;
    }

    function updateButtons() {
      if (!prevBtn || !nextBtn) return;
      var maxScroll = track.scrollWidth - track.clientWidth - 2;
      prevBtn.disabled = track.scrollLeft <= 0;
      nextBtn.disabled = track.scrollLeft >= maxScroll;
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        track.scrollBy({ left: -step(), behavior: 'smooth' });
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        track.scrollBy({ left: step(), behavior: 'smooth' });
      });
    }
    track.addEventListener('scroll', updateButtons, { passive: true });
    window.addEventListener('resize', updateButtons);
    updateButtons();

    // Click-and-drag scrolling for mouse/trackpad users
    var isDown = false;
    var dragged = false;
    var startX = 0;
    var startScroll = 0;

    track.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') return; // native touch scrolling handles this
      isDown = true;
      dragged = false;
      startX = e.clientX;
      startScroll = track.scrollLeft;
      track.classList.add('is-dragging');
      track.setPointerCapture(e.pointerId);
    });

    track.addEventListener('pointermove', function (e) {
      if (!isDown) return;
      var dx = e.clientX - startX;
      if (Math.abs(dx) > 4) dragged = true;
      track.scrollLeft = startScroll - dx;
    });

    function endDrag() {
      isDown = false;
      track.classList.remove('is-dragging');
    }
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);

    // Suppress the click-through on slide links immediately after a drag
    track.addEventListener('click', function (e) {
      if (dragged) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  });

  // ---- Scroll motion --------------------------------------------------
  // Everything below is what makes the page feel alive as you scroll,
  // instead of every section just sitting there fully rendered from the
  // first frame: cards/rows/list items fade and lift into place as they
  // enter the viewport, the header tightens up once you've scrolled past
  // it, hero images drift at a different speed than the page (parallax),
  // a slim progress bar tracks how far down the page you are, and a
  // back-to-top button appears once there's somewhere to go back to.
  //
  // The reveal system auto-detects the site's own card/row/list classes
  // rather than requiring every page's HTML to be hand-annotated — a
  // single shared MutationObserver also picks up anything js/members.js
  // renders later from Supabase (network cards, feed items, roster rows,
  // ticker items…), so newly-added content animates in correctly too.
  // Everything here backs off completely for prefers-reduced-motion,
  // not just "less" — reduced-motion users see the finished page
  // immediately, no fading, no parallax, no auto-playing motion.
  var reduceMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  var hasIO = 'IntersectionObserver' in window;

  var REVEAL_SELECTOR = [
    '.section-head', '.page-hero-title', '.page-hero-lede',
    '.hero-heading', '.hero-copy', '.hero-actions', '.hero-courses',
    '.card', '.opp-row', '.event-row', '.network-card', '.feed-item',
    '.news-post', '.person-card', '.quick-link-card', '.roster-row',
    '.mmg-timeline-item', '.login-choice-card',
    '.value-item', '.programme-card', '.impact-card',
    '.mmg-info-card', '.network-history-row', '[data-reveal]'
  ].join(',');

  var skipReveal = reduceMotionMQ.matches || !hasIO;
  var revealObserver = skipReveal ? null : new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

  function tagReveal(el) {
    if (el.dataset.revealTagged) return;
    el.dataset.revealTagged = '1';
    if (!el.hasAttribute('data-reveal')) el.setAttribute('data-reveal', '');
    var parent = el.parentElement;
    var siblingIndex = parent ? parent.querySelectorAll(':scope > [data-reveal-tagged]').length - 1 : 0;
    el.style.setProperty('--reveal-delay', (Math.min(Math.max(siblingIndex, 0), 7) * 0.06) + 's');
    if (skipReveal) {
      el.classList.add('is-visible');
    } else {
      revealObserver.observe(el);
    }
  }

  // Number spans (homepage impact stats, the president dashboard's stat
  // tiles) count up from 0 the first time they scroll into view instead
  // of just appearing — same MutationObserver picks up the dashboard's
  // async-rendered numbers, same reduced-motion opt-out.
  var countUpObserver = skipReveal ? null : new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      countUpObserver.unobserve(entry.target);
      animateCountUp(entry.target);
    });
  }, { threshold: 0.6 });

  function animateCountUp(el) {
    var match = el.textContent.trim().match(/^(\d+)(.*)$/);
    if (!match || !parseInt(match[1], 10)) return;
    var target = parseInt(match[1], 10);
    var suffix = match[2] || '';
    var duration = 900;
    var start = null;
    function step(ts) {
      if (start === null) start = ts;
      var progress = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(eased * target) + suffix;
      if (progress < 1) window.requestAnimationFrame(step);
    }
    window.requestAnimationFrame(step);
  }

  function tagCountUp(el) {
    if (el.dataset.countTagged) return;
    el.dataset.countTagged = '1';
    if (skipReveal) return; // leave the static number as-is
    countUpObserver.observe(el);
  }

  var COUNT_SELECTOR = '.impact-stat-num, .dash-stat-num';

  function scanForMotion(root) {
    if (root.nodeType === 1) {
      if (root.matches(REVEAL_SELECTOR)) tagReveal(root);
      if (root.matches(COUNT_SELECTOR)) tagCountUp(root);
    }
    if (root.querySelectorAll) {
      root.querySelectorAll(REVEAL_SELECTOR).forEach(tagReveal);
      root.querySelectorAll(COUNT_SELECTOR).forEach(tagCountUp);
    }
  }

  scanForMotion(document);

  var motionObserver = new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      m.addedNodes.forEach(function (node) {
        if (node.nodeType === 1) scanForMotion(node);
      });
    });
  });
  motionObserver.observe(document.body, { childList: true, subtree: true });

  // Header shrink-on-scroll
  (function headerScroll() {
    var topbarEl = document.querySelector('.site-topbar');
    if (!topbarEl) return;
    var ticking = false;
    function update() {
      ticking = false;
      topbarEl.classList.toggle('is-scrolled', window.scrollY > 24);
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    update();
  })();

  // Hero background parallax (homepage, and any page that reuses .hero)
  if (!reduceMotionMQ.matches) {
    (function heroParallax() {
      var heroEl = document.querySelector('.hero');
      var heroBg = heroEl ? heroEl.querySelector('.hero-bg') : null;
      if (!heroEl || !heroBg) return;
      var ticking = false;
      function update() {
        ticking = false;
        var heroHeight = heroEl.offsetHeight;
        var y = window.scrollY;
        if (y > heroHeight) return;
        heroBg.style.transform = 'translate3d(0,' + Math.round(y * 0.18) + 'px,0) scale(1.08)';
      }
      function onScroll() {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(update);
      }
      window.addEventListener('scroll', onScroll, { passive: true });
      update();
    })();
  }

  // Scroll-progress bar
  (function scrollProgress() {
    var bar = document.createElement('div');
    bar.className = 'scroll-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
    var ticking = false;
    function update() {
      ticking = false;
      var doc = document.documentElement;
      var scrollable = doc.scrollHeight - doc.clientHeight;
      var pct = scrollable > 0 ? (doc.scrollTop / scrollable) * 100 : 0;
      bar.style.width = pct + '%';
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  })();

  // Back-to-top button
  (function backToTop() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'back-to-top';
    btn.setAttribute('aria-label', 'Back to top');
    btn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
    document.body.appendChild(btn);

    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reduceMotionMQ.matches ? 'auto' : 'smooth' });
    });

    var ticking = false;
    function update() {
      ticking = false;
      btn.classList.toggle('is-visible', window.scrollY > 500);
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    update();
  })();

  // Expandable rows/cards: click anywhere on an element marked [data-expand-row]
  // to reveal more detail (events, committee bios). Clicks that land on a real
  // link inside the row (RSVP, "Part of the Sankofa Mentorship programme") are
  // ignored so they still navigate normally instead of just toggling. The
  // dedicated [data-expand-btn] inside each row also carries aria-expanded so
  // keyboard/screen-reader users get the same toggle via Tab + Enter/Space.
  document.querySelectorAll('[data-expand-row]').forEach(function (row) {
    var btn = row.querySelector('[data-expand-btn]');
    function toggle() {
      var open = row.classList.toggle('is-expanded');
      if (btn) btn.setAttribute('aria-expanded', String(open));
    }
    row.addEventListener('click', function (e) {
      if (e.target.closest('a')) return;
      toggle();
    });
  });

  // Homepage launch countdown — live days/hours/minutes/seconds until the
  // official 30 September 2026 launch, ticking every second.
  var countdownEl = document.getElementById('launch-countdown');
  if (countdownEl) {
    var countdownTarget = new Date('2026-09-30T00:00:00');
    var countdownDays = document.getElementById('countdown-days');
    var countdownHours = document.getElementById('countdown-hours');
    var countdownMinutes = document.getElementById('countdown-minutes');
    var countdownSeconds = document.getElementById('countdown-seconds');
    var countdownTimer;

    var pad2 = function (n) { return n < 10 ? '0' + n : String(n); };

    var tickCountdown = function () {
      var diff = countdownTarget.getTime() - Date.now();
      if (diff <= 0) {
        countdownEl.innerHTML = '<span class="launch-countdown-live">We’re officially live!</span>';
        if (countdownTimer) clearInterval(countdownTimer);
        return;
      }
      var totalSeconds = Math.floor(diff / 1000);
      countdownDays.textContent = pad2(Math.floor(totalSeconds / 86400));
      countdownHours.textContent = pad2(Math.floor((totalSeconds % 86400) / 3600));
      countdownMinutes.textContent = pad2(Math.floor((totalSeconds % 3600) / 60));
      countdownSeconds.textContent = pad2(totalSeconds % 60);
    };

    tickCountdown();
    countdownTimer = setInterval(tickCountdown, 1000);
  }

  // MMG ticket countdown — stands in for the "Get your ticket" button
  // until tickets actually go on sale, 12 October 2026.
  var ticketCountdownEl = document.getElementById('ticket-countdown');
  if (ticketCountdownEl) {
    var ticketTarget = new Date('2026-10-12T00:00:00');
    var ticketDays = document.getElementById('ticket-countdown-days');
    var ticketHours = document.getElementById('ticket-countdown-hours');
    var ticketMinutes = document.getElementById('ticket-countdown-minutes');
    var ticketSeconds = document.getElementById('ticket-countdown-seconds');
    var ticketTimer;

    var ticketPad2 = function (n) { return n < 10 ? '0' + n : String(n); };

    var tickTicketCountdown = function () {
      var diff = ticketTarget.getTime() - Date.now();
      if (diff <= 0) {
        ticketCountdownEl.innerHTML = '<span class="ticket-countdown-live">Tickets are live — check back for the link!</span>';
        if (ticketTimer) clearInterval(ticketTimer);
        return;
      }
      var totalSeconds = Math.floor(diff / 1000);
      ticketDays.textContent = ticketPad2(Math.floor(totalSeconds / 86400));
      ticketHours.textContent = ticketPad2(Math.floor((totalSeconds % 86400) / 3600));
      ticketMinutes.textContent = ticketPad2(Math.floor((totalSeconds % 3600) / 60));
      ticketSeconds.textContent = ticketPad2(totalSeconds % 60);
    };

    tickTicketCountdown();
    ticketTimer = setInterval(tickTicketCountdown, 1000);
  }

  // Briefly highlight an event row when arriving via a same-page-type anchor
  var hash = window.location.hash;
  if (hash) {
    var target = document.querySelector(hash);
    if (target && target.classList.contains('event-row')) {
      target.classList.add('is-highlighted');
    }
  }

  // Site-wide "Back" button, present at the top of every page. Prefers
  // real browser history — but only when we actually arrived from
  // somewhere else on this site — so someone who opened the page
  // directly (a bookmark, a shared link, a fresh tab) doesn't get sent
  // out of the site entirely or land on a dead click; they land on the
  // homepage instead.
  document.querySelectorAll('[data-back-button]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var cameFromSite = document.referrer && document.referrer.indexOf(window.location.origin) === 0;
      if (cameFromSite && window.history.length > 1) {
        window.history.back();
      } else {
        window.location.href = 'index.html';
      }
    });
  });
})();
