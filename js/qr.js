// QR codes made right here in the browser: no outside service, nothing sent anywhere.
//
//   lacmsQR.svg(text, { size: 320, margin: 4, ecc: 'M' })    -> an <svg> string (sharp at any size)
//   lacmsQR.png(text, { size: 640, margin: 4, ecc: 'M' })    -> a PNG data: URL
//   lacmsQR.download(text, 'name', 'png' | 'svg', opts)      -> saves a file
//   lacmsQR.matrix(text, 'M')                                 -> the raw grid of dark/light squares
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
  function svg(text, opts) {
    opts = opts || {};
    var m = matrix(text, opts.ecc), n = m.length, margin = opts.margin == null ? 4 : opts.margin, size = opts.size || 320;
    var dark = opts.dark || '#000000', light = opts.light || '#ffffff', d = '';
    for (var y = 0; y < n; y++) {
      var x = 0;
      while (x < n) {
        if (m[y][x]) { var s = x; while (x < n && m[y][x]) x++; d += 'M' + (s + margin) + ' ' + (y + margin) + 'h' + (x - s) + 'v1h-' + (x - s) + 'z'; } else x++;
      }
    }
    var total = n + margin * 2;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" width="' + size + '" height="' + size + '" shape-rendering="crispEdges" role="img" aria-label="QR code">' +
      '<rect width="' + total + '" height="' + total + '" fill="' + light + '"/><path d="' + d + '" fill="' + dark + '"/></svg>';
  }
  function png(text, opts) {
    opts = opts || {};
    var m = matrix(text, opts.ecc), n = m.length, margin = opts.margin == null ? 4 : opts.margin;
    var total = n + margin * 2, scale = Math.max(1, Math.round((opts.size || 640) / total));
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = total * scale;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = opts.light || '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = opts.dark || '#000000';
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (m[y][x]) ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
    return canvas.toDataURL('image/png');
  }
  function download(text, name, kind, opts) {
    var a = document.createElement('a'), url;
    name = String(name || 'qr-code').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'qr-code';
    if (kind === 'svg') {
      url = URL.createObjectURL(new Blob([svg(text, opts)], { type: 'image/svg+xml' }));
      a.download = name + '.svg';
    } else {
      url = png(text, opts);
      a.download = name + '.png';
    }
    a.href = url;
    document.body.appendChild(a); a.click();
    setTimeout(function () { if (kind === 'svg') URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  var api = { matrix: matrix, svg: svg, png: png, download: download };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.lacmsQR = api;
})(typeof window !== 'undefined' ? window : this);
