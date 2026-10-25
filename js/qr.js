// QR codes made right here in the browser: no outside service, nothing sent anywhere.
//
//   lacmsQR.svg(text, design)                  -> an <svg> string (sharp at any size)
//   lacmsQR.render(text, design)               -> { svg, width, height, modules, ecc, version }
//   lacmsQR.pngBlob(text, design, px)          -> a Promise of a PNG file (Blob)
//   lacmsQR.download(text, 'name', 'png'|'svg', design) -> saves a file
//   lacmsQR.check(text, design)                -> will it scan? advice on contrast, logo size, density
//   lacmsQR.matrix(text, 'M')                  -> the raw grid of dark/light squares
//
// A design can set: ecc, margin, size, fg / fg2 (+ gradient), bg, shape (square | rounded | dots),
// eyeFrame / eyePupil (square | rounded | circle), eyeColor, pupilColor, logo (a data: URL) and
// logoSize, caption, captionPos, captionColor, frame (none | line | band) and frameColor.
//
// Standard QR (ISO 18004) in byte mode, any text (UTF-8), versions 1 to 40, error correction
// L / M / Q / H, with automatic mask choice. The block layout tables were taken from a
// well-known QR library; everything else is written out below. Checked by decoding codes of
// many lengths and levels with an independent reader.
(function (root) {
  'use strict';

  // [version - 1][L, M, Q, H] = flat list of (blocks, codewords per block, data codewords per block)
  var ECB = [[[1,26,19],[1,26,16],[1,26,13],[1,26,9]],[[1,44,34],[1,44,28],[1,44,22],[1,44,16]],[[1,70,55],[1,70,44],[2,35,17],[2,35,13]],[[1,100,80],[2,50,32],[2,50,24],[4,25,9]],[[1,134,108],[2,67,43],[2,33,15,2,34,16],[2,33,11,2,34,12]],[[2,86,68],[4,43,27],[4,43,19],[4,43,15]],[[2,98,78],[4,49,31],[2,32,14,4,33,15],[4,39,13,1,40,14]],[[2,121,97],[2,60,38,2,61,39],[4,40,18,2,41,19],[4,40,14,2,41,15]],[[2,146,116],[3,58,36,2,59,37],[4,36,16,4,37,17],[4,36,12,4,37,13]],[[2,86,68,2,87,69],[4,69,43,1,70,44],[6,43,19,2,44,20],[6,43,15,2,44,16]],[[4,101,81],[1,80,50,4,81,51],[4,50,22,4,51,23],[3,36,12,8,37,13]],[[2,116,92,2,117,93],[6,58,36,2,59,37],[4,46,20,6,47,21],[7,42,14,4,43,15]],[[4,133,107],[8,59,37,1,60,38],[8,44,20,4,45,21],[12,33,11,4,34,12]],[[3,145,115,1,146,116],[4,64,40,5,65,41],[11,36,16,5,37,17],[11,36,12,5,37,13]],[[5,109,87,1,110,88],[5,65,41,5,66,42],[5,54,24,7,55,25],[11,36,12,7,37,13]],[[5,122,98,1,123,99],[7,73,45,3,74,46],[15,43,19,2,44,20],[3,45,15,13,46,16]],[[1,135,107,5,136,108],[10,74,46,1,75,47],[1,50,22,15,51,23],[2,42,14,17,43,15]],[[5,150,120,1,151,121],[9,69,43,4,70,44],[17,50,22,1,51,23],[2,42,14,19,43,15]],[[3,141,113,4,142,114],[3,70,44,11,71,45],[17,47,21,4,48,22],[9,39,13,16,40,14]],[[3,135,107,5,136,108],[3,67,41,13,68,42],[15,54,24,5,55,25],[15,43,15,10,44,16]],[[4,144,116,4,145,117],[17,68,42],[17,50,22,6,51,23],[19,46,16,6,47,17]],[[2,139,111,7,140,112],[17,74,46],[7,54,24,16,55,25],[34,37,13]],[[4,151,121,5,152,122],[4,75,47,14,76,48],[11,54,24,14,55,25],[16,45,15,14,46,16]],[[6,147,117,4,148,118],[6,73,45,14,74,46],[11,54,24,16,55,25],[30,46,16,2,47,17]],[[8,132,106,4,133,107],[8,75,47,13,76,48],[7,54,24,22,55,25],[22,45,15,13,46,16]],[[10,142,114,2,143,115],[19,74,46,4,75,47],[28,50,22,6,51,23],[33,46,16,4,47,17]],[[8,152,122,4,153,123],[22,73,45,3,74,46],[8,53,23,26,54,24],[12,45,15,28,46,16]],[[3,147,117,10,148,118],[3,73,45,23,74,46],[4,54,24,31,55,25],[11,45,15,31,46,16]],[[7,146,116,7,147,117],[21,73,45,7,74,46],[1,53,23,37,54,24],[19,45,15,26,46,16]],[[5,145,115,10,146,116],[19,75,47,10,76,48],[15,54,24,25,55,25],[23,45,15,25,46,16]],[[13,145,115,3,146,116],[2,74,46,29,75,47],[42,54,24,1,55,25],[23,45,15,28,46,16]],[[17,145,115],[10,74,46,23,75,47],[10,54,24,35,55,25],[19,45,15,35,46,16]],[[17,145,115,1,146,116],[14,74,46,21,75,47],[29,54,24,19,55,25],[11,45,15,46,46,16]],[[13,145,115,6,146,116],[14,74,46,23,75,47],[44,54,24,7,55,25],[59,46,16,1,47,17]],[[12,151,121,7,152,122],[12,75,47,26,76,48],[39,54,24,14,55,25],[22,45,15,41,46,16]],[[6,151,121,14,152,122],[6,75,47,34,76,48],[46,54,24,10,55,25],[2,45,15,64,46,16]],[[17,152,122,4,153,123],[29,74,46,14,75,47],[49,54,24,10,55,25],[24,45,15,46,46,16]],[[4,152,122,18,153,123],[13,74,46,32,75,47],[48,54,24,14,55,25],[42,45,15,32,46,16]],[[20,147,117,4,148,118],[40,75,47,7,76,48],[43,54,24,22,55,25],[10,45,15,67,46,16]],[[19,148,118,6,149,119],[18,75,47,31,76,48],[34,54,24,34,55,25],[20,45,15,61,46,16]]];
  // Where the small alignment squares go, by version.
  var ALIGN = [[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]];
  var ECC_BITS = { L: 1, M: 0, Q: 3, H: 2 };
  var ECC_INDEX = { L: 0, M: 1, Q: 2, H: 3 };

  // ---- Reed-Solomon over GF(256) ----------------------------------------------
  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function mul(a, b) { return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]; }
  function generator(deg) {
    var g = [1];
    for (var i = 0; i < deg; i++) {
      var next = new Array(g.length + 1);
      for (var k = 0; k < next.length; k++) next[k] = 0;
      for (var j = 0; j < g.length; j++) {
        next[j] ^= g[j];
        next[j + 1] ^= mul(g[j], EXP[i]);
      }
      g = next;
    }
    return g;                                   // highest power first
  }
  function remainder(data, deg) {
    var gen = generator(deg), res = [];
    for (var i = 0; i < deg; i++) res.push(0);
    for (var d = 0; d < data.length; d++) {
      var factor = data[d] ^ res.shift();
      res.push(0);
      if (factor) for (var j = 0; j < deg; j++) res[j] ^= mul(gen[j + 1], factor);
    }
    return res;
  }

  function utf8(text) {
    var s = unescape(encodeURIComponent(String(text))), out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }
  function blocksFor(version, level) {
    var flat = ECB[version - 1][ECC_INDEX[level]], list = [];
    for (var i = 0; i < flat.length; i += 3) list.push({ count: flat[i], total: flat[i + 1], data: flat[i + 2] });
    return list;
  }
  function dataCapacity(version, level) {
    return blocksFor(version, level).reduce(function (t, b) { return t + b.count * b.data; }, 0);
  }

  // ---- The message as codewords --------------------------------------------------
  function encode(bytes, level) {
    var version = 0;
    for (var v = 1; v <= 40; v++) {
      var bits = 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
      if (bits <= dataCapacity(v, level) * 8) { version = v; break; }
    }
    if (!version) throw new Error('That text is too long for a QR code.');
    var bitBuf = [];
    function put(val, len) { for (var i = len - 1; i >= 0; i--) bitBuf.push((val >>> i) & 1); }
    put(4, 4);                                         // byte mode
    put(bytes.length, version < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    var cap = dataCapacity(version, level) * 8;
    for (var t = 0; t < 4 && bitBuf.length < cap; t++) bitBuf.push(0);
    while (bitBuf.length % 8) bitBuf.push(0);
    var codewords = [];
    for (var i = 0; i < bitBuf.length; i += 8) {
      var byte = 0;
      for (var j = 0; j < 8; j++) byte = (byte << 1) | bitBuf[i + j];
      codewords.push(byte);
    }
    for (var pad = 0xec; codewords.length < cap / 8; pad ^= 0xec ^ 0x11) codewords.push(pad);

    // Split into blocks, add error correction to each, then interleave.
    var blocks = [], pos = 0;
    blocksFor(version, level).forEach(function (spec) {
      for (var n = 0; n < spec.count; n++) {
        var data = codewords.slice(pos, pos + spec.data);
        pos += spec.data;
        blocks.push({ data: data, ec: remainder(data, spec.total - spec.data) });
      }
    });
    var maxData = Math.max.apply(null, blocks.map(function (b) { return b.data.length; }));
    var out = [];
    for (var d = 0; d < maxData; d++) blocks.forEach(function (b) { if (d < b.data.length) out.push(b.data[d]); });
    for (var e = 0; e < blocks[0].ec.length; e++) blocks.forEach(function (b) { out.push(b.ec[e]); });
    return { version: version, codewords: out };
  }

  // ---- The grid ------------------------------------------------------------------------
  function build(version, level, codewords) {
    var size = version * 4 + 17;
    var mod = [], fn = [];
    for (var r = 0; r < size; r++) { mod.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    function setFn(x, y, dark) { mod[y][x] = dark; fn[y][x] = true; }

    // Timing lines, then the three big corner squares.
    for (var i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy)), xx = cx + dx, yy = cy + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, dist !== 2 && dist !== 4);
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    // Alignment squares.
    var al = ALIGN[version - 1], n = al.length;
    for (var a = 0; a < n; a++) for (var b = 0; b < n; b++) {
      if ((a === 0 && b === 0) || (a === 0 && b === n - 1) || (a === n - 1 && b === 0)) continue;
      for (var dy2 = -2; dy2 <= 2; dy2++) for (var dx2 = -2; dx2 <= 2; dx2++) setFn(al[a] + dx2, al[b] + dy2, Math.max(Math.abs(dx2), Math.abs(dy2)) !== 1);
    }
    function formatBits(mask) {
      var data = (ECC_BITS[level] << 3) | mask, rem = data;
      for (var k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      return ((data << 10) | rem) ^ 0x5412;
    }
    function drawFormat(mask) {
      var bits = formatBits(mask);
      function bit(k) { return ((bits >>> k) & 1) === 1; }
      for (var k = 0; k <= 5; k++) setFn(8, k, bit(k));
      setFn(8, 7, bit(6)); setFn(8, 8, bit(7)); setFn(7, 8, bit(8));
      for (var k2 = 9; k2 < 15; k2++) setFn(14 - k2, 8, bit(k2));
      for (var k3 = 0; k3 < 8; k3++) setFn(size - 1 - k3, 8, bit(k3));
      for (var k4 = 8; k4 < 15; k4++) setFn(8, size - 15 + k4, bit(k4));
      setFn(8, size - 8, true);
    }
    drawFormat(0);                                  // reserves the spots; redrawn with the real mask below
    if (version >= 7) {
      var rem = version;
      for (var q = 0; q < 12; q++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      var vbits = (version << 12) | rem;
      for (var m = 0; m < 18; m++) {
        var dark = ((vbits >>> m) & 1) === 1, p = size - 11 + (m % 3), qq = Math.floor(m / 3);
        setFn(p, qq, dark); setFn(qq, p, dark);
      }
    }

    // The message, zig-zagging up and down the columns from the bottom right.
    var idx = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (var j = 0; j < 2; j++) {
        var x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
        if (!fn[y][x] && idx < codewords.length * 8) {
          mod[y][x] = ((codewords[idx >>> 3] >>> (7 - (idx & 7))) & 1) === 1;
          idx++;
        }
      }
    }

    function applyMask(mask) {
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
        var inv;
        switch (mask) {
          case 0: inv = (x + y) % 2 === 0; break;
          case 1: inv = y % 2 === 0; break;
          case 2: inv = x % 3 === 0; break;
          case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: inv = (x * y) % 2 + (x * y) % 3 === 0; break;
          case 6: inv = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
          default: inv = ((x + y) % 2 + (x * y) % 3) % 2 === 0;
        }
        if (inv && !fn[y][x]) mod[y][x] = !mod[y][x];
      }
    }
    function penalty() {
      var score = 0, x, y, run, dark = 0;
      for (var pass = 0; pass < 2; pass++) {
        for (y = 0; y < size; y++) {
          run = 1;
          for (x = 1; x < size; x++) {
            var cur = pass ? mod[x][y] : mod[y][x], prev = pass ? mod[x - 1][y] : mod[y][x - 1];
            if (cur === prev) { run++; if (run === 5) score += 3; else if (run > 5) score++; } else run = 1;
          }
        }
      }
      for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) {
        var c = mod[y][x];
        if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) score += 3;
      }
      var pat = [true, false, true, true, true, false, true, false, false, false, false], rev = pat.slice().reverse();
      for (y = 0; y < size; y++) for (x = 0; x <= size - 11; x++) {
        var h1 = true, h2 = true, v1 = true, v2 = true;
        for (var k = 0; k < 11; k++) {
          if (mod[y][x + k] !== pat[k]) h1 = false;
          if (mod[y][x + k] !== rev[k]) h2 = false;
          if (mod[x + k][y] !== pat[k]) v1 = false;
          if (mod[x + k][y] !== rev[k]) v2 = false;
        }
        score += 40 * ((h1 ? 1 : 0) + (h2 ? 1 : 0) + (v1 ? 1 : 0) + (v2 ? 1 : 0));
      }
      for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (mod[y][x]) dark++;
      score += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
      return score;
    }

    var best = 0, bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      applyMask(mask); drawFormat(mask);
      var sc = penalty();
      if (sc < bestScore) { bestScore = sc; best = mask; }
      applyMask(mask);                               // undo
    }
    applyMask(best); drawFormat(best);
    return mod;
  }

  function matrix(text, level) {
    level = ECC_INDEX[level] !== undefined ? level : 'M';
    var enc = encode(utf8(text), level);
    return build(enc.version, level, enc.codewords);
  }

  // ---- Pictures ----------------------------------------------------------------------------
  var DEFAULTS = {
    ecc: 'M', margin: 4, size: 320,
    fg: '#000000', fg2: '', gradient: 'diagonal', bg: '#ffffff',
    shape: 'square', eyeFrame: 'square', eyePupil: 'square', eyeColor: '', pupilColor: '',
    logo: '', logoSize: 0.2,
    caption: '', captionPos: 'below', captionColor: '', frame: 'none', frameColor: '#000000'
  };
  var uid = 0;
  function merge(o) {
    var d = {}, k;
    for (k in DEFAULTS) d[k] = DEFAULTS[k];
    o = o || {};
    // the older simple options
    if (o.dark && !o.fg) d.fg = o.dark;
    if (o.light && !o.bg) d.bg = o.light;
    for (k in o) if (o[k] !== undefined && o[k] !== null && k !== 'dark' && k !== 'light') d[k] = o[k];
    d.margin = Math.max(0, Math.min(10, +d.margin));
    d.logoSize = Math.max(0.1, Math.min(0.3, +d.logoSize));
    return d;
  }
  function esc(str) { return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function f(n) { return Math.round(n * 1000) / 1000; }
  function rrect(x, y, w, h, tl, tr, br, bl) {
    var p = 'M' + f(x + tl) + ' ' + f(y) + 'H' + f(x + w - tr);
    if (tr) p += 'a' + tr + ' ' + tr + ' 0 0 1 ' + tr + ' ' + tr;
    p += 'V' + f(y + h - br);
    if (br) p += 'a' + br + ' ' + br + ' 0 0 1 ' + (-br) + ' ' + br;
    p += 'H' + f(x + bl);
    if (bl) p += 'a' + bl + ' ' + bl + ' 0 0 1 ' + (-bl) + ' ' + (-bl);
    p += 'V' + f(y + tl);
    if (tl) p += 'a' + tl + ' ' + tl + ' 0 0 1 ' + tl + ' ' + (-tl);
    return p + 'z';
  }
  function circle(cx, cy, r) { return 'M' + f(cx - r) + ' ' + f(cy) + 'a' + r + ' ' + r + ' 0 1 0 ' + 2 * r + ' 0a' + r + ' ' + r + ' 0 1 0 ' + (-2 * r) + ' 0z'; }

  // Which modules a logo takes over (they are left blank; error correction covers the loss).
  function logoBox(n, d) {
    if (!d.logo) return null;
    var side = n * d.logoSize, plate = side + 1.4, c = n / 2;
    return { side: side, plate: plate, x0: c - plate / 2, x1: c + plate / 2 };
  }

  function render(text, opts) {
    var d = merge(opts);
    var ecc = ECC_INDEX[d.ecc] !== undefined ? d.ecc : 'M';
    if (d.logo && (ecc === 'L' || ecc === 'M')) ecc = 'Q';        // a logo needs the stronger levels
    var m = matrix(text, ecc), n = m.length, lb = logoBox(n, d);
    var id = 'lqg' + (++uid);
    function inEye(x, y) { return (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7); }
    function inLogo(x, y) { return lb && x + 1 > lb.x0 && x < lb.x1 && y + 1 > lb.x0 && y < lb.x1; }
    function dark(x, y) { return x >= 0 && y >= 0 && x < n && y < n && m[y][x] && !inEye(x, y) && !inLogo(x, y); }

    // The little squares.
    var path = '', x, y;
    if (d.shape === 'dots') {
      for (y = 0; y < n; y++) for (x = 0; x < n; x++) if (dark(x, y)) path += circle(x + 0.5, y + 0.5, 0.46);
    } else if (d.shape === 'rounded') {
      for (y = 0; y < n; y++) for (x = 0; x < n; x++) if (dark(x, y)) {
        var up = dark(x, y - 1), dn = dark(x, y + 1), lf = dark(x - 1, y), rt = dark(x + 1, y), r = 0.5;
        path += rrect(x, y, 1, 1, !up && !lf ? r : 0, !up && !rt ? r : 0, !dn && !rt ? r : 0, !dn && !lf ? r : 0);
      }
    } else {
      for (y = 0; y < n; y++) {
        x = 0;
        while (x < n) {
          if (dark(x, y)) { var st = x; while (x < n && dark(x, y)) x++; path += 'M' + st + ' ' + y + 'h' + (x - st) + 'v1h-' + (x - st) + 'z'; } else x++;
        }
      }
    }

    // The three big corner squares, drawn on their own so they can be styled.
    var eyeCol = d.eyeColor || d.fg, pupCol = d.pupilColor || d.eyeColor || d.fg, ring = '', pupil = '';
    [[0, 0], [n - 7, 0], [0, n - 7]].forEach(function (e) {
      var ex = e[0], ey = e[1];
      if (d.eyeFrame === 'circle') ring += circle(ex + 3.5, ey + 3.5, 3.5) + circle(ex + 3.5, ey + 3.5, 2.5);
      else if (d.eyeFrame === 'rounded') ring += rrect(ex, ey, 7, 7, 2, 2, 2, 2) + rrect(ex + 1, ey + 1, 5, 5, 1, 1, 1, 1);
      else ring += rrect(ex, ey, 7, 7, 0, 0, 0, 0) + rrect(ex + 1, ey + 1, 5, 5, 0, 0, 0, 0);
      if (d.eyePupil === 'circle') pupil += circle(ex + 3.5, ey + 3.5, 1.5);
      else if (d.eyePupil === 'rounded') pupil += rrect(ex + 2, ey + 2, 3, 3, 0.9, 0.9, 0.9, 0.9);
      else pupil += rrect(ex + 2, ey + 2, 3, 3, 0, 0, 0, 0);
    });

    // Layout: the code with its quiet zone, then (optionally) a caption and a frame around it.
    var qz = n + d.margin * 2;
    var caption = String(d.caption || '').trim().slice(0, 60);
    var framed = d.frame !== 'none';
    var fpad = framed ? Math.max(1.6, qz * 0.045) : 0;
    var capH = caption ? Math.max(5, Math.round(qz * 0.17)) : 0;
    var W = qz + fpad * 2, H = qz + fpad * 2 + capH;
    var top = fpad + (caption && d.captionPos === 'above' ? capH : 0);
    var capY = caption ? (d.captionPos === 'above' ? fpad : fpad + qz) : 0;
    var parts = [], body = '';
    var bgFill = d.bg ? d.bg : 'none';
    var radius = Math.min(W, H) * 0.045;
    if (d.frame === 'band') {
      body += '<rect width="' + f(W) + '" height="' + f(H) + '" rx="' + f(radius * 1.4) + '" fill="' + esc(d.frameColor) + '"/>';
      body += '<rect x="' + f(fpad) + '" y="' + f(top) + '" width="' + f(qz) + '" height="' + f(qz) + '" rx="' + f(radius) + '" fill="' + esc(d.bg || '#ffffff') + '"/>';
    } else {
      if (d.bg) body += '<rect width="' + f(W) + '" height="' + f(H) + '" rx="' + (framed ? f(radius * 1.4) : 0) + '" fill="' + esc(d.bg) + '"/>';
      if (d.frame === 'line') body += '<rect x="' + f(fpad * 0.35) + '" y="' + f(fpad * 0.35) + '" width="' + f(W - fpad * 0.7) + '" height="' + f(H - fpad * 0.7) + '" rx="' + f(radius * 1.2) + '" fill="none" stroke="' + esc(d.frameColor) + '" stroke-width="' + f(Math.max(0.5, fpad * 0.28)) + '"/>';
    }
    var fill = d.fg2 ? 'url(#' + id + ')' : esc(d.fg);
    var defs = '';
    if (d.fg2) {
      var gx = d.gradient === 'vertical' ? [0, 0, 0, n] : d.gradient === 'horizontal' ? [0, 0, n, 0] : [0, 0, n, n];
      defs = '<defs><linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="' + gx[0] + '" y1="' + gx[1] + '" x2="' + gx[2] + '" y2="' + gx[3] + '"><stop offset="0" stop-color="' + esc(d.fg) + '"/><stop offset="1" stop-color="' + esc(d.fg2) + '"/></linearGradient></defs>';
    }
    body += '<g transform="translate(' + f(fpad + d.margin) + ' ' + f(top + d.margin) + ')"' + (d.shape === 'square' ? ' shape-rendering="crispEdges"' : '') + '>' +
      '<path d="' + path + '" fill="' + fill + '"/>' +
      '<path d="' + ring + '" fill="' + esc(eyeCol) + '" fill-rule="evenodd"' + (d.eyeFrame === 'square' ? ' shape-rendering="crispEdges"' : '') + '/>' +
      '<path d="' + pupil + '" fill="' + esc(pupCol) + '"/>';
    if (lb) {
      var pad = (lb.plate - lb.side) / 2;
      body += '<rect x="' + f(lb.x0) + '" y="' + f(lb.x0) + '" width="' + f(lb.plate) + '" height="' + f(lb.plate) + '" rx="' + f(lb.plate * 0.16) + '" fill="' + esc(d.bg || '#ffffff') + '"/>' +
        '<image href="' + esc(d.logo) + '" x="' + f(lb.x0 + pad) + '" y="' + f(lb.x0 + pad) + '" width="' + f(lb.side) + '" height="' + f(lb.side) + '" preserveAspectRatio="xMidYMid meet"/>';
    }
    body += '</g>';
    if (caption) {
      var chars = caption.length, fs = Math.min(capH * 0.52, (qz * 0.92) / (chars * 0.6));
      var tcol = d.captionColor || (d.frame === 'band' ? contrastText(d.frameColor) : d.frame === 'line' ? d.frameColor : d.fg);
      body += '<text x="' + f(W / 2) + '" y="' + f(capY + capH / 2 + fs * 0.35) + '" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="' + f(fs) + '" fill="' + esc(tcol) + '">' + esc(caption) + '</text>';
    }
    var px = Math.max(64, +d.size || 320), hpx = Math.round(px * H / W);
    var svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + f(W) + ' ' + f(H) + '" width="' + px + '" height="' + hpx + '" role="img" aria-label="QR code">' + defs + body + '</svg>';
    return { svg: svgText, width: px, height: hpx, modules: n, ecc: ecc, version: (n - 17) / 4, units: { w: W, h: H } };
  }

  function svg(text, opts) { return render(text, opts).svg; }

  // A PNG file (a Blob) of the code at the width asked for, drawn from the same picture as the SVG.
  function pngBlob(text, opts, px) {
    px = Math.max(128, Math.min(4096, +px || (opts && opts.size) || 1024));
    var r = render(text, Object.assign({}, opts, { size: px }));
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = r.width; canvas.height = r.height;
        canvas.getContext('2d').drawImage(img, 0, 0, r.width, r.height);
        canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('Could not make the image.')); }, 'image/png');
      };
      img.onerror = function () { reject(new Error('Could not draw the code.')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(r.svg);
    });
  }
  function png(text, opts) {                                 // a data: URL, for the simple cases
    opts = opts || {};
    var m = matrix(text, opts.ecc), n = m.length, margin = opts.margin == null ? 4 : opts.margin;
    var total = n + margin * 2, scale = Math.max(1, Math.round((opts.size || 640) / total));
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = total * scale;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = opts.light || opts.bg || '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = opts.dark || opts.fg || '#000000';
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (m[y][x]) ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
    return canvas.toDataURL('image/png');
  }
  function saveBlob(blob, filename) {
    var a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 800);
  }
  function fileName(name) { return String(name || 'qr-code').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'qr-code'; }
  function download(text, name, kind, opts) {
    name = fileName(name);
    if (kind === 'svg') { saveBlob(new Blob([svg(text, opts)], { type: 'image/svg+xml' }), name + '.svg'); return Promise.resolve(); }
    return pngBlob(text, opts, opts && opts.size).then(function (b) { saveBlob(b, name + '.png'); });
  }

  // ---- Will it scan? -----------------------------------------------------------------------------
  function rgb(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function luminance(hex) {
    var c = rgb(hex); if (!c) return null;
    var v = c.map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function contrast(a, b) {
    var la = luminance(a), lb = luminance(b);
    if (la === null || lb === null) return null;
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function contrastText(bg) { var l = luminance(bg); return l !== null && l > 0.45 ? '#111111' : '#ffffff'; }

  // Advice on a design: { level: 'good' | 'warn' | 'bad', notes: [...], modules, printCm }
  function check(text, opts) {
    var d = merge(opts), notes = [], level = 'good';
    function warn(msg, bad) { notes.push(msg); if (bad) level = 'bad'; else if (level === 'good') level = 'warn'; }
    var info;
    try { info = render(text || ' ', Object.assign({}, d, { size: 64 })); } catch (e) { return { level: 'bad', notes: ['That is too long for a QR code. Shorten the text or link.'], modules: 0, printCm: 0 }; }
    var bg = d.bg || '#ffffff', cols = [d.fg].concat(d.fg2 ? [d.fg2] : []).concat(d.eyeColor ? [d.eyeColor] : []).concat(d.pupilColor ? [d.pupilColor] : []);
    var worst = 21;
    cols.forEach(function (c) { var r = contrast(c, bg); if (r !== null && r < worst) worst = r; });
    var lf = luminance(d.fg), lbg = luminance(bg);
    if (lf !== null && lbg !== null && lf > lbg) warn('The code is lighter than its background. Many phone cameras can’t read light-on-dark codes, so keep the code darker than the background.', true);
    else if (worst < 3) warn('Not enough contrast between the code and the background. Use a much darker code or a lighter background.', true);
    else if (worst < 4.5) warn('The contrast is a little low. It may be hard to scan in poor light or when printed small; consider a darker colour.');
    if (!d.bg) warn('Transparent background: it only scans if it sits on a plain light surface.');
    if (d.logo) {
      var share = (d.logoSize * d.logoSize);
      if (d.logoSize > 0.26) warn('The logo is big. Keep it under about a quarter of the code’s width.', true);
      else if (d.logoSize > 0.22) warn('The logo is on the large side. Test that it scans before printing.');
      if (share > 0.07 && info.ecc === 'Q' && d.logoSize > 0.2) warn('For a bigger logo choose the highest error correction.');
    }
    if (info.modules > 61) warn('This code is dense (' + info.modules + ' squares across). Print it larger, or use a shorter link (the tracked option gives a very short code).');
    if (d.shape === 'dots' && d.eyeFrame === 'circle' && d.eyePupil === 'circle') warn('Round everything looks lovely but is a little harder for some scanners. Test it.');
    var printCm = Math.max(2.5, Math.ceil((info.modules + d.margin * 2) * 0.09 * 10) / 10);
    if (!notes.length) notes.push('Looks good. Print it at least ' + printCm + ' cm wide and give it a quick scan with your phone before it goes on a poster.');
    return { level: level, notes: notes, modules: info.modules, printCm: printCm, contrast: Math.round(worst * 10) / 10, version: info.version };
  }

  var api = { matrix: matrix, render: render, svg: svg, png: png, pngBlob: pngBlob, download: download, check: check, contrast: contrast, contrastText: contrastText, defaults: DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.lacmsQR = api;
})(typeof window !== 'undefined' ? window : this);
