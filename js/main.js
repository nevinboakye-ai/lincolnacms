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

  // Join form has no backend yet — prevent a raw page reload and explain next steps
  var joinForm = document.getElementById('join-form');
  if (joinForm) {
    joinForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = document.getElementById('join-form-status');
      if (status) {
        status.textContent = 'This form isn\'t connected yet. Please email acms@lincolnsu.com instead — see the note above.';
        status.style.color = 'var(--color-gold-light)';
      }
    });
  }

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
      var slide = track.querySelector('.carousel-slide');
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

  // Scroll-reveal: elements marked [data-reveal] fade/slide in once they
  // enter the viewport (e.g. the Opportunities list). Reduced-motion users
  // and browsers without IntersectionObserver just see everything visible.
  var revealEls = document.querySelectorAll('[data-reveal]');
  if (revealEls.length) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
      revealEls.forEach(function (el) { el.classList.add('is-visible'); });
    } else {
      var revealObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            revealObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
      revealEls.forEach(function (el) { revealObserver.observe(el); });
    }
  }

  // Briefly highlight an event row when arriving via a same-page-type anchor
  var hash = window.location.hash;
  if (hash) {
    var target = document.querySelector(hash);
    if (target && target.classList.contains('event-row')) {
      target.classList.add('is-highlighted');
    }
  }
})();
