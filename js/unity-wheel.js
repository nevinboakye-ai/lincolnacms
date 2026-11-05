// Unity Cup - the raffle wheel and the confetti. Shared by the public portal (unity-cup.html) and the
// committee's live draw in the dashboard (js/unity-admin.js).
//
// The wheel only DISPLAYS a result. The winner is chosen in the database (unity_admin_draw, secure random);
// spinTo(ticket) then turns the wheel so that ticket lands under the pointer.

(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var PALETTE = ['#d4a62b', '#1e7a46', '#c1272d', '#1a1a1f'];
  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  function create(canvas, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d');
    var slices = [];          // { ticket: number|null }
    var angle = 0;            // current rotation in degrees (what the CSS transform says)
    var spinning = false;
    var size = 0;

    function resize() {
      var rect = canvas.getBoundingClientRect();
      var s = Math.max(180, Math.round(rect.width || canvas.width));
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (size === s && canvas.width === Math.round(s * dpr)) return;
      size = s;
      canvas.width = Math.round(s * dpr);
      canvas.height = Math.round(s * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    }

    function setTickets(list) {
      var t = (list || []).slice();
      slices = t.map(function (n) { return { ticket: n }; });
      // Too few tickets look sparse, so pad with "?" slices that can never win.
      var minSlices = 8;
      if (slices.length < minSlices) {
        var out = [], fillers = minSlices - slices.length, i, gap = Math.max(1, Math.floor(minSlices / Math.max(1, slices.length)));
        for (i = 0; i < minSlices; i++) out.push({ ticket: null });
        // spread the real tickets around the wheel
        slices.forEach(function (s, idx) { out[(idx * gap) % minSlices] = s; });
        slices = out;
      }
      draw();
    }

    function draw() {
      if (!size) return;
      var r = size / 2, n = slices.length || 1, step = TAU / n, i;
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.translate(r, r);
      for (i = 0; i < n; i++) {
        var a0 = -Math.PI / 2 + i * step, a1 = a0 + step;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, r - 2, a0, a1);
        ctx.closePath();
        var col = PALETTE[i % PALETTE.length];
        if (n % PALETTE.length === 1 && i === n - 1) col = PALETTE[1];   // never put two same colours side by side at the seam
        ctx.fillStyle = col;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.stroke();
        // label
        if (n <= 40) {
          ctx.save();
          ctx.rotate(a0 + step / 2);
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          var light = col === '#d4a62b';
          ctx.fillStyle = light ? '#1a1500' : '#ffffff';
          var fs = Math.max(10, Math.min(20, (r * 0.9 * step) / 2.2));
          ctx.font = '700 ' + fs + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
          var s = slices[i];
          ctx.fillText(s && s.ticket != null ? '#' + s.ticket : '?', r - 18, 0);
          ctx.restore();
        }
      }
      // hub
      var g = ctx.createRadialGradient(0, 0, 4, 0, 0, r * 0.2);
      g.addColorStop(0, '#f6e7ae'); g.addColorStop(1, '#b8891a');
      ctx.beginPath(); ctx.arc(0, 0, r * 0.2, 0, TAU); ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.stroke();
      ctx.restore();
    }

    // Turns the wheel so that `ticket` stops under the pointer at the top. Resolves when it has stopped.
    function spinTo(ticket, ms) {
      return new Promise(function (resolve) {
        var idx = -1, i;
        for (i = 0; i < slices.length; i++) if (slices[i].ticket === ticket) { idx = i; break; }
        if (idx < 0) { resolve(false); return; }
        var n = slices.length, stepDeg = 360 / n;
        var centre = (idx + 0.5) * stepDeg;
        var jitter = (Math.random() - 0.5) * stepDeg * 0.6;              // land somewhere inside the slice, not dead centre
        var base = Math.ceil(angle / 360) * 360;
        var target = base + (reduced ? 0 : 360 * (5 + Math.floor(Math.random() * 3))) + (360 - (centre + jitter));
        while (target <= angle + 90) target += 360;
        var dur = reduced ? 700 : (ms || 6500);
        spinning = true;
        canvas.style.transition = 'transform ' + dur + 'ms cubic-bezier(0.1, 0.62, 0.08, 1)';
        // force a style flush so the transition always runs
        void canvas.offsetWidth;
        canvas.style.transform = 'rotate(' + target + 'deg)';
        angle = target;
        var done = false;
        function finish() { if (done) return; done = true; spinning = false; canvas.removeEventListener('transitionend', onEnd); resolve(true); }
        function onEnd(e) { if (e.target === canvas) finish(); }
        canvas.addEventListener('transitionend', onEnd);
        window.setTimeout(finish, dur + 400);
      });
    }

    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(canvas);
    else window.addEventListener('resize', resize);
    resize();
    return { setTickets: setTickets, spinTo: spinTo, redraw: draw, isSpinning: function () { return spinning; } };
  }

  // ---------------------------------------------------------------------
  // Confetti: a short burst of brand-coloured pieces drawn on a throw-away full-screen canvas.
  function confetti(opts) {
    if (reduced) return;
    opts = opts || {};
    var cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:' + (opts.z || 10000) + ';';
    document.body.appendChild(cv);
    var w = cv.width = window.innerWidth, h = cv.height = window.innerHeight, c = cv.getContext('2d');
    var colors = ['#d4a62b', '#e8c767', '#1e7a46', '#c1272d', '#ffffff'];
    var count = opts.count || 150, parts = [], i;
    var ox = opts.x != null ? opts.x : w / 2, oy = opts.y != null ? opts.y : h * 0.35;
    for (i = 0; i < count; i++) {
      var a = Math.random() * TAU, sp = 4 + Math.random() * 9;
      parts.push({ x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 5, s: 5 + Math.random() * 7, r: Math.random() * TAU, vr: (Math.random() - 0.5) * 0.4, col: colors[i % colors.length], life: 0 });
    }
    var start = null;
    function tick(ts) {
      if (!start) start = ts;
      var t = ts - start;
      c.clearRect(0, 0, w, h);
      parts.forEach(function (p) {
        p.vy += 0.22; p.vx *= 0.992; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        c.save(); c.translate(p.x, p.y); c.rotate(p.r);
        c.globalAlpha = Math.max(0, 1 - t / 3200);
        c.fillStyle = p.col; c.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.6);
        c.restore();
      });
      if (t < 3400) requestAnimationFrame(tick); else cv.remove();
    }
    requestAnimationFrame(tick);
  }

  window.UnityWheel = { create: create };
  window.UnityFx = { confetti: confetti };
})();
