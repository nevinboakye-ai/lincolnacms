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

  // Theme toggle — light/dark. The initial [data-theme] attribute on <html>
  // is set by an inline script in <head>, before first paint, so there's no
  // flash of the wrong theme; this just wires up the click handler and keeps
  // the site following the OS setting live for anyone who hasn't made an
  // explicit choice of their own yet.
  var THEME_KEY = 'lacms-theme';
  var themeToggleBtns = document.querySelectorAll('[data-theme-toggle]');
  var systemThemeQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

  var applyThemeLabel = function () {
    var isLight = document.documentElement.getAttribute('data-theme') === 'light';
    themeToggleBtns.forEach(function (btn) {
      btn.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
      btn.setAttribute('aria-pressed', String(isLight));
    });
  };
  applyThemeLabel();

  themeToggleBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* private browsing, etc. */ }
      applyThemeLabel();
    });
  });

  if (systemThemeQuery) {
    var handleSystemThemeChange = function (e) {
      var saved = null;
      try { saved = localStorage.getItem(THEME_KEY); } catch (err) { /* ignore */ }
      if (saved === 'light' || saved === 'dark') return;
      document.documentElement.setAttribute('data-theme', e.matches ? 'light' : 'dark');
      applyThemeLabel();
    };
    if (systemThemeQuery.addEventListener) {
      systemThemeQuery.addEventListener('change', handleSystemThemeChange);
    } else if (systemThemeQuery.addListener) {
      systemThemeQuery.addListener(handleSystemThemeChange);
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

  // Time-of-day greeting on the members/MMG hubs — a small, human touch
  // in place of a flat "Welcome back" every single visit.
  document.querySelectorAll('[data-greeting-word]').forEach(function (el) {
    var hour = new Date().getHours();
    el.textContent = hour < 5 ? 'Good night'
      : hour < 12 ? 'Good morning'
      : hour < 18 ? 'Good afternoon'
      : 'Good evening';
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
    '.mmg-info-card', '.network-history-row', '[data-reveal]',
    '.dash-nav-card', '.dash-stat', '.app-card', '.online-now-chip',
    '.gallery-manage-item', '.gallery-submission-item'
  ].join(',');

  var skipReveal = reduceMotionMQ.matches || !hasIO;
  var revealObserver = skipReveal ? null : new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.01, rootMargin: '0px 0px 15% 0px' });

  function tagReveal(el) {
    if (el.dataset.revealTagged) return;
    el.dataset.revealTagged = '1';
    if (!el.hasAttribute('data-reveal')) el.setAttribute('data-reveal', '');
    var parent = el.parentElement;
    var siblingIndex = parent ? parent.querySelectorAll(':scope > [data-reveal-tagged]').length - 1 : 0;
    el.style.setProperty('--reveal-delay', (Math.min(Math.max(siblingIndex, 0), 5) * 0.045) + 's');
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
  }, { threshold: 0.2, rootMargin: '0px 0px 10% 0px' });

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

  // ---- Digital membership/attendee card: a real, fully-3D flippable
  // card ---------------------------------------------------------------
  // Builds the flip structure at runtime (front face = the card's
  // existing content, back face = LACMS logo + name) so all four card
  // instances across the site — member-hub's two variants, mmg-hub,
  // mmg.html — stay in sync from one place instead of four copies of
  // the same markup. Then wires up, in order of how someone actually
  // discovers it:
  //   1. A one-time idle wiggle once the card is actually on screen,
  //      so the card itself demonstrates it's 3D before anyone has to
  //      guess.
  //   2. A small corner badge that's both a visible hint and a
  //      guaranteed, keyboard-reachable way to see the back — the
  //      wiggle and drag are lovely but neither is accessible alone.
  //   3. Cursor-follow tilt on hover, for anyone with a mouse.
  //   4. Full drag-to-rotate — mouse-drag AND touch-drag through one
  //      Pointer Events implementation — all the way round to the
  //      back, always springing back to front-facing on release so it
  //      never gets left part-way turned or stuck showing the back.
  (function () {
    var cards = document.querySelectorAll('.member-card');
    if (!cards.length) return;

    var fineHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    var reduceMotion = reduceMotionMQ.matches;

    function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

    cards.forEach(function (card) {
      var inner = card.firstElementChild;
      if (!inner) return;

      var flipper = document.createElement('div');
      flipper.className = 'member-card-flipper';

      var front = document.createElement('div');
      front.className = 'member-card-face member-card-face--front';
      front.appendChild(inner); // moves the existing content, doesn't recreate it

      var back = document.createElement('div');
      back.className = 'member-card-face member-card-face--back';
      back.innerHTML =
        '<img class="member-card-back-logo" src="Media/ACMS%20Branding/logo.png" alt="">' +
        '<span class="member-card-back-name">LACMS</span>' +
        '<span class="member-card-back-sub">Lincoln African Caribbean Medical Society</span>';

      flipper.appendChild(front);
      flipper.appendChild(back);
      card.appendChild(flipper);

      // Belt-and-braces alongside the CSS user-drag/user-select
      // reset above — Firefox in particular ignores -webkit-user-drag
      // and only respects the element's own draggable attribute.
      flipper.querySelectorAll('img').forEach(function (img) {
        img.draggable = false;
      });

      var flipBtn = document.createElement('button');
      flipBtn.type = 'button';
      flipBtn.className = 'member-card-flip-hint';
      flipBtn.setAttribute('aria-label', 'Flip the card to see the back');
      flipBtn.title = 'Drag the card, or click here, to see the back';
      flipBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>';
      card.appendChild(flipBtn);

      var rotX = 0, rotY = 0;
      var dragging = false;
      var pointerId = null;
      var axisLocked = null; // null while undecided | 'card' | 'scroll' (touch only)
      var startX = 0, startY = 0, startRotX = 0, startRotY = 0;

      function applyTransform() {
        flipper.style.transform = 'rotateX(' + rotX.toFixed(2) + 'deg) rotateY(' + rotY.toFixed(2) + 'deg)';
      }
      function setActive(on) { flipper.classList.toggle('is-active', on); }
      function updateGlare(clientX, clientY) {
        var rect = card.getBoundingClientRect();
        flipper.style.setProperty('--glare-x', (((clientX - rect.left) / rect.width) * 100) + '%');
        flipper.style.setProperty('--glare-y', (((clientY - rect.top) / rect.height) * 100) + '%');
      }
      function resetTransform() {
        rotX = 0; rotY = 0;
        applyTransform();
      }

      // 1. Idle hint — plays once per browser session (across every
      // card on the site, not once per page), timed from when the
      // card is actually visible on screen rather than a blind delay,
      // since it only exists once the member's Supabase profile has
      // loaded and the hub content is shown.
      if (!reduceMotion && 'IntersectionObserver' in window) {
        var hintSeen = false;
        try { hintSeen = sessionStorage.getItem('lacmsCardHintSeen') === '1'; } catch (e) {}
        if (!hintSeen) {
          var hintObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
              if (!entry.isIntersecting) return;
              hintObserver.unobserve(card);
              try { sessionStorage.setItem('lacmsCardHintSeen', '1'); } catch (e2) {}
              window.setTimeout(function () {
                if (!dragging) flipper.classList.add('is-hint');
              }, 500);
            });
          }, { threshold: 0.4 });
          hintObserver.observe(card);
          flipper.addEventListener('animationend', function () {
            flipper.classList.remove('is-hint');
          });
        }
      }

      // 3. Hover tilt — fine-pointer devices only, and only while not
      // actively dragging.
      if (fineHover && !reduceMotion) {
        card.addEventListener('mousemove', function (e) {
          if (dragging) return;
          flipper.classList.remove('is-hint');
          var rect = card.getBoundingClientRect();
          var px = (e.clientX - rect.left) / rect.width;
          var py = (e.clientY - rect.top) / rect.height;
          rotY = (px - 0.5) * 16;
          rotX = (0.5 - py) * 12;
          applyTransform();
          updateGlare(e.clientX, e.clientY);
          setActive(true);
        });
        card.addEventListener('mouseleave', function () {
          if (dragging) return;
          setActive(false);
          resetTransform();
        });
      }

      // 4. Drag to rotate — mouse and touch are handled through two
      // deliberately separate, simple implementations rather than
      // one unified Pointer Events path, after the unified version
      // turned out unreliable for mouse drags in real browsers even
      // though it checked out in every simulated test here.
      var ROTATE_Y_SENSITIVITY = 0.6;
      var ROTATE_X_SENSITIVITY = 0.25;
      var ROTATE_X_LIMIT = 22;
      var AXIS_LOCK_PX = 8;

      function startDragVisuals() {
        dragging = true;
        flipper.classList.add('is-dragging');
        flipper.classList.remove('is-hint');
        setActive(true);
      }
      function endDragVisuals() {
        dragging = false;
        flipper.classList.remove('is-dragging');
        setActive(false);
        resetTransform(); // never left wherever it was turned to - always springs home
      }

      // Mouse: the plain, classic mousedown-then-track-on-document
      // pattern. Tracking on document (not the card) is what makes
      // this robust — it keeps working even once the cursor drifts
      // off the card mid-drag, without depending on setPointerCapture
      // or any particular Pointer Events behaviour.
      flipper.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault(); // stop the logo/name text starting a native image-drag or selection instead
        var mStartX = e.clientX, mStartY = e.clientY;
        var mStartRotX = rotX, mStartRotY = rotY;
        startDragVisuals();

        function onMouseMove(e2) {
          var dx = e2.clientX - mStartX;
          var dy = e2.clientY - mStartY;
          rotY = clamp(mStartRotY + dx * ROTATE_Y_SENSITIVITY, -180, 180);
          rotX = clamp(mStartRotX - dy * ROTATE_X_SENSITIVITY, -ROTATE_X_LIMIT, ROTATE_X_LIMIT);
          applyTransform();
          updateGlare(e2.clientX, e2.clientY);
        }
        function onMouseUp() {
          endDragVisuals();
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        }
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });

      // Touch: Pointer Events with an axis lock — touch specifically
      // needs to tell "spin the card" apart from "scroll the page",
      // which mouse never has to worry about. Confirmed working as-is.
      flipper.addEventListener('pointerdown', function (e) {
        if (e.pointerType !== 'touch') return;
        pointerId = e.pointerId;
        startX = e.clientX;
        startY = e.clientY;
        startRotX = rotX;
        startRotY = rotY;
        axisLocked = null; // decided on first sufficient movement
      });

      flipper.addEventListener('pointermove', function (e) {
        if (e.pointerId !== pointerId) return;
        var dx = e.clientX - startX;
        var dy = e.clientY - startY;

        if (axisLocked === null) {
          if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
          axisLocked = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'card' : 'scroll';
          if (axisLocked === 'card') {
            startDragVisuals();
            try { flipper.setPointerCapture(pointerId); } catch (e2) {}
          } else {
            pointerId = null; // hand the rest of this gesture to native scroll
            return;
          }
        }

        if (axisLocked !== 'card') return;
        e.preventDefault();
        rotY = clamp(startRotY + dx * ROTATE_Y_SENSITIVITY, -180, 180);
        rotX = clamp(startRotX - dy * ROTATE_X_SENSITIVITY, -ROTATE_X_LIMIT, ROTATE_X_LIMIT);
        applyTransform();
        updateGlare(e.clientX, e.clientY);
      }, { passive: false });

      function endTouchDrag(e) {
        if (pointerId !== null && e.pointerId !== pointerId) return;
        if (dragging) endDragVisuals();
        pointerId = null;
        axisLocked = null;
      }
      flipper.addEventListener('pointerup', endTouchDrag);
      flipper.addEventListener('pointercancel', endTouchDrag);

      // 2. The corner badge itself — click, tap or keyboard (a
      // <button> already gets Enter/Space for free) turns the card
      // all the way to the back, holds a moment, then returns it.
      flipBtn.addEventListener('click', function () {
        if (dragging) return;
        flipper.classList.remove('is-hint');
        rotX = 0;
        rotY = 180;
        applyTransform();
        setActive(true);
        window.setTimeout(function () {
          setActive(false);
          resetTransform();
        }, reduceMotion ? 900 : 1500);
      });
    });
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

  // Whole-card links: click anywhere on an element marked
  // [data-card-link] to navigate to the URL it names, unless the
  // click actually landed on one of the card's own real links (its
  // own CTA buttons keep their individual destinations).
  document.querySelectorAll('[data-card-link]').forEach(function (card) {
    card.style.cursor = 'pointer';
    card.addEventListener('click', function (e) {
      if (e.target.closest('a')) return;
      window.location.href = card.getAttribute('data-card-link');
    });
  });

  // Image lightbox: click (or Enter/Space) any element marked
  // [data-lightbox] to see its image full-size over a dimmed
  // backdrop. Built once per page, only if the page actually needs
  // it — a single shared overlay, not one per image.
  var lightboxTriggers = document.querySelectorAll('[data-lightbox]');
  if (lightboxTriggers.length) {
    var lightbox = document.createElement('div');
    lightbox.className = 'lightbox';
    lightbox.innerHTML =
      '<div class="lightbox-backdrop" data-lightbox-close></div>' +
      '<button type="button" class="lightbox-close" data-lightbox-close aria-label="Close">' +
        '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>' +
      '</button>' +
      '<img class="lightbox-img" src="" alt="">';
    document.body.appendChild(lightbox);
    var lightboxImg = lightbox.querySelector('.lightbox-img');

    function openLightbox(trigger) {
      var src = trigger.getAttribute('data-lightbox-src') || trigger.getAttribute('src');
      if (!src) return;
      lightboxImg.src = src;
      lightboxImg.alt = trigger.getAttribute('alt') || '';
      lightbox.classList.add('is-open');
      document.body.classList.add('lightbox-open');
    }
    function closeLightbox() {
      lightbox.classList.remove('is-open');
      document.body.classList.remove('lightbox-open');
      lightboxImg.src = '';
    }

    lightboxTriggers.forEach(function (trigger) {
      trigger.classList.add('is-lightbox-enabled');
      trigger.addEventListener('click', function () { openLightbox(trigger); });
      trigger.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openLightbox(trigger);
        }
      });
    });

    lightbox.querySelectorAll('[data-lightbox-close]').forEach(function (btn) {
      btn.addEventListener('click', closeLightbox);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && lightbox.classList.contains('is-open')) closeLightbox();
    });
  }

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
        ticketCountdownEl.innerHTML = '<span class="ticket-countdown-live">Tickets are live - check back for the link!</span>';
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

  // "Coming soon" banner on locked programme cards (programmes.html) —
  // days-only, same 30 September 2026 launch date as the homepage
  // countdown. Deliberately coarser than the ticket countdown (no
  // hours/minutes/seconds): this sits as a prominent ribbon across the
  // top of a card someone's just browsing, not a "buy now" moment, so
  // it doesn't need to tick every second to do its job.
  var programmeCountdownDayEls = document.querySelectorAll('[data-programme-countdown-days]');
  if (programmeCountdownDayEls.length) {
    var programmeCountdownTarget = new Date('2026-09-30T00:00:00');
    var tickProgrammeCountdown = function () {
      var diff = programmeCountdownTarget.getTime() - Date.now();
      var daysLeft = Math.max(0, Math.ceil(diff / 86400000));
      programmeCountdownDayEls.forEach(function (el) {
        el.textContent = daysLeft;
      });
    };
    tickProgrammeCountdown();
    setInterval(tickProgrammeCountdown, 3600000); // hourly is plenty for a days-only figure
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
