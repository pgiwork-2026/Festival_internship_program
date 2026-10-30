/* Diwali entrance: "Slaying of Narakasura" - Canvas 2D, no assets. 5 Sudarshana Chakra strikes, then celebration, then the portal is revealed. */
(function () {
  'use strict';
  var de = document.documentElement, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var TAU = Math.PI * 2, done = false, timers = [], raf = 0, root, cv, c;
  var W, H, dpr, cx, cy, S, low, T = 0, last = 0, ready = false, locked = false, win = false, tw = 0, strikes = 0, lastStrike = 0;
  var img = null, sil = null, flash = 0, light = 0, recoil = 0, flights = [], cracks = [], rings = [], P = [], stars = [], puffs = [], embers = [], smokeSpr, sky, bodyP, wf = {}, fbTimer = 0;
  var DS = .78, mx = 0, my = 0, mxSet = false, mvx = 0, mvy = 0, wx = 0, wy = 0, wT = 0, hurt = 0, misses = 0, pops = [], bnd = [0, 0, 0, 0]; /* moving-demon game state */
  var COLS = ['#ffc928', '#ffe27a', '#fb923c', '#fff3bf', '#5fd04a', '#ff4fa3', '#38bdf8', '#ffffff'];
  var R = Math.random, $ = function (s) { return root.querySelector(s); };
  var sm = function (x) { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };

  function finish(reason) {
    if (done) return; done = true;
    timers.forEach(function (t) { clearTimeout(t); }); cancelAnimationFrame(raf);
    removeEventListener('resize', onResize); removeEventListener('keydown', onKey);
    if (root) root.remove(); de.classList.remove('nk-lock');
    document.dispatchEvent(new CustomEvent('diwali:complete', { detail: { reason: reason || 'complete' } }));
  }
  function skip() { if (done) return; root.classList.add('nk-out'); timers.push(setTimeout(function () { finish('skip'); }, 450)); }

  function init() {
    root = document.createElement('div'); root.className = 'nk-root';
    root.setAttribute('role', 'region'); root.setAttribute('aria-label', 'Diwali entrance: help Krishna defeat Narakasura');
    root.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:#02130d;overflow:hidden';
    root.innerHTML = '<canvas class="nk-cv" aria-hidden="true"></canvas><button class="nk-skip" type="button" aria-label="Skip intro and go to website">Skip intro \u2192</button>' +
      '<p class="nk-msg">Narakasura is on the run! Tap him to hurl the Sudarshana Chakra!</p>' +
      '<div class="nk-ui"><div class="nk-prog"><span class="nk-count" aria-hidden="true">0/5</span><span class="nk-dots" aria-hidden="true"><i class="nk-dot"></i><i class="nk-dot"></i><i class="nk-dot"></i><i class="nk-dot"></i><i class="nk-dot"></i></span></div>' +
      '<button class="nk-tap" type="button" aria-label="Strike Narakasura with the Sudarshana Chakra (auto-aim)">TAP TO STRIKE</button></div>' +
      '<p class="nk-win" aria-live="polite"></p><span class="nk-sr" aria-live="polite"></span><footer class="nk-foot">Plant Green Inertia \u2022 Happy Diwali</footer>';
    document.body.insertBefore(root, document.body.firstChild); de.classList.add('nk-lock');
    cv = $('.nk-cv'); c = cv.getContext('2d'); if (!c || !window.Path2D) throw new Error('no canvas');
    buildBody(); mkSmoke(); size();
    var im = new Image(); im.onload = function () { if (im.naturalWidth) { img = im; sil = null; buildBody(); if (!done) size(); } go(); }; im.onerror = go; im.src = 'static/images/narakasura.png'; /* optional transparent cut-out; vector figure used if absent */
    for (var i = 0; i < 50; i++) stars.push({ x: R(), y: R() * .6, r: .5 + R() * 1.1, p: R() * 6 });
    for (i = 0; i < (low ? 10 : 16); i++) puffs.push({ x: R() * W, y: H * (.2 + R() * .85), s: Math.max(W, H * .8) * (.35 + R() * .4), vx: (R() - .5) * 16, vy: -(6 + R() * 10), r: R() * 6, vr: (R() - .5) * .08, a: .5 + R() * .5 });
    for (i = 0; i < (low ? 36 : 70); i++) embers.push(ember(true));
    addEventListener('resize', onResize); addEventListener('keydown', onKey);
    root.addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('.nk-skip')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault(); strike(e.clientX, e.clientY);
    });
    $('.nk-skip').addEventListener('click', skip);
    timers.push(setTimeout(function () { if (!win) finish('watchdog'); }, 90000));
    timers.push(setTimeout(go, 1500));
  }
  var started = false;
  function go() { if (started || done) return; started = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  function size() {
    W = innerWidth; H = innerHeight; low = W < 700 || (navigator.hardwareConcurrency || 8) <= 4;
    dpr = Math.min(devicePixelRatio || 1, low ? 1.5 : 2);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2; S = img ? Math.min(W * .55, H * .235) : Math.min(W * .4, H * .22); cy = H * (img ? .54 : .55);
    if (!mxSet) { mx = cx; my = cy; mxSet = true; } way();
    sky = c.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#010a06'); sky.addColorStop(.55, '#04281a'); sky.addColorStop(1, '#0a5a34');
  }
  function onResize() { if (!done) size(); }
  function way() { /* pick the demon's next waypoint inside the safe play area */
    var s = S * DS, x0 = s * .8 + 8, x1 = W - s * .8 - 8, y0 = Math.max(60, H * .1) + 56 + s * 1.5, y1 = H * .86 - s * 1.25, n = 0;
    if (y1 < y0) y0 = y1 = (y0 + y1) / 2; if (x1 < x0) x0 = x1 = W / 2; bnd = [x0, x1, y0, y1];
    do { wx = x0 + R() * (x1 - x0); wy = y0 + R() * (y1 - y0); } while (Math.hypot(wx - mx, wy - my) < (x1 - x0) * .35 && ++n < 8);
    wT = 1.1 + R() * 1.1;
  }
  function onKey(e) {
    if (e.key === 'Escape') { skip(); return; }
    if ((e.key === ' ' || e.key === 'Enter' || e.code === 'Space') && !e.repeat) {
      if (e.target && e.target.closest && e.target.closest('.nk-skip')) return;
      e.preventDefault(); strike();
    }
  }

  /* ---------- sprites ---------- */
  function mkSmoke() {
    smokeSpr = document.createElement('canvas'); smokeSpr.width = smokeSpr.height = 128; var g = smokeSpr.getContext('2d');
    for (var i = 0; i < 9; i++) {
      var x = 40 + R() * 48, y = 40 + R() * 48, r = 26 + R() * 26, gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(150,190,165,.32)'); gr.addColorStop(1, 'rgba(150,190,165,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    }
  }
  function ember(init) {
    return { x: R() * W, y: init ? R() * H : H + 10, vy: -(14 + R() * 40), vx: (R() - .3) * 18, r: .8 + R() * 2.2, p: R() * 6, a: .4 + R() * .6 };
  }
  function buildBody() {
    var p = new Path2D();
    if (img) {
      var ih = 2.95, iw = ih * img.naturalWidth / img.naturalHeight; if (iw > 2.4) { iw = 2.4; ih = iw * img.naturalHeight / img.naturalWidth; }
      var P0 = [140,130,235,130,245,215,275,255,305,330,300,380,315,480,300,560,70,560,65,480,75,380,75,330,100,255,135,215];
      for (var k = 0; k < P0.length; k += 2) { var px = (P0[k] / 375 - .5) * iw, py = 1.3 - ih + P0[k + 1] / 666 * ih; k ? p.lineTo(px, py) : p.moveTo(px, py); }
      p.closePath(); bodyP = p; return;
    }
    if (img) {
      var b = imgBox(), q = [140, 165, 235, 165, 300, 250, 315, 380, 310, 500, 65, 500, 60, 380, 75, 250];
      for (var i = 0; i < q.length; i += 2) { var x = (q[i] / 375 - .5) * b.w, y = 1.3 - b.h + q[i + 1] / b.ih * b.h; i ? p.lineTo(x, y) : p.moveTo(x, y); }
      p.closePath(); bodyP = p; return;
    }
    p.moveTo(-.3, -.24); p.lineTo(.3, -.24); p.lineTo(.62, -.05); p.lineTo(.5, .5); p.lineTo(.4, .82); p.lineTo(-.4, .82); p.lineTo(-.5, .5); p.lineTo(-.62, -.05); p.closePath();
    p.moveTo(-.27, -.85); p.lineTo(.27, -.85); p.lineTo(.29, -.55); p.lineTo(.2, -.3); p.lineTo(.09, -.22); p.lineTo(-.09, -.22); p.lineTo(-.2, -.3); p.lineTo(-.29, -.55); p.closePath();
    p.rect(-.15, -.3, .3, .1);
    bodyP = p;
  }

  /* ---------- Narakasura silhouette: sharp, angular king-of-demons outline (unit coords x -1.2..1.2, y -1.65..1.3) ---------- */
  function imgBox() { var iw = img.naturalWidth, ih = Math.round(img.naturalHeight * .91), h = 2.95, w = h * iw / ih; if (w > 2.4) { w = 2.4; h = w * ih / iw; } return { iw: iw, ih: ih, w: w, h: h }; } /* bottom 9% cropped (hides the corner watermark) */
  function drawImg(g) { var b = imgBox(); g.drawImage(img, 0, 0, b.iw, b.ih, -b.w / 2, 1.3 - b.h, b.w, b.h); }
  function silShapes(g) {
    if (img) { drawImg(g); return; }
    function poly(a) { g.beginPath(); g.moveTo(a[0], a[1]); for (var k = 2; k < a.length; k += 2) g.lineTo(a[k], a[k + 1]); g.closePath(); g.fill(); }
    function stk(a, w) { g.beginPath(); g.moveTo(a[0], a[1]); for (var k = 2; k < a.length; k += 2) g.lineTo(a[k], a[k + 1]); g.lineWidth = w; g.lineJoin = 'round'; g.lineCap = 'butt'; g.stroke(); }
    var s, i; g.fillStyle = g.strokeStyle = '#000';
    poly([-.12, -.95, -.06, -1.3, 0, -1.56, .06, -1.3, .12, -.95]);
    g.beginPath(); g.moveTo(-.34, -.8); g.lineTo(-.36, -1); g.quadraticCurveTo(-.2, -1.2, 0, -1.22); g.quadraticCurveTo(.2, -1.2, .36, -1); g.lineTo(.34, -.8); g.closePath(); g.fill();
    poly([-.27, -.85, -.29, -.55, -.2, -.3, -.09, -.22, .09, -.22, .2, -.3, .29, -.55, .27, -.85]);
    poly([-.15, -.3, .15, -.3, .15, -.14, -.15, -.14]);
    poly([-.3, -.24, .3, -.24, .62, -.05, .5, .5, .4, .82, -.4, .82, -.5, .5, -.62, -.05]);
    for (s = -1; s <= 1; s += 2) {
      g.save(); g.scale(s, 1);
      poly([.1, -.98, .19, -1.36, .26, -1]); poly([.25, -.98, .38, -1.24, .37, -.9]);
      g.beginPath(); g.moveTo(.3, -.96); g.bezierCurveTo(.66, -1, .9, -1.2, .82, -1.68); g.bezierCurveTo(.7, -1.32, .54, -1.14, .34, -1.12); g.closePath(); g.fill();
      poly([.26, -.7, .46, -.8, .3, -.5]);
      poly([.3, -.22, .55, -.3, .68, -.5, .74, -.3, .88, -.38, .97, -.12, .94, .12, .66, .15, .4, 0]);
      poly([0, .8, .5, .8, .78, .9, 1.02, 1.1, 1.1, 1.3, 0, 1.3]);
      g.restore();
    }
    stk([.8, -.02, 1.08, .34, .74, .74], .26); poly([.64, .66, .86, .62, .9, .84, .7, .88]);
    stk([-.8, -.02, -1.06, .26, -.98, -.3], .24); g.beginPath(); g.arc(-.98, -.34, .13, 0, TAU); g.fill();
    stk([-.98, -.3, -.98, -1.08], .05); g.beginPath(); g.arc(-.98, -1.18, .11, 0, TAU); g.fill();
    for (i = 0; i < 8; i++) { var a = i / 8 * TAU; poly([-.98 + Math.cos(a - .22) * .1, -1.18 + Math.sin(a - .22) * .1, -.98 + Math.cos(a) * .23, -1.18 + Math.sin(a) * .23, -.98 + Math.cos(a + .22) * .1, -1.18 + Math.sin(a + .22) * .1]); }
  }
  var RES = 240, PAD = 6;
  function mkSil() {
    RES = low ? 180 : 240;
    var w = Math.round(2.4 * RES) + PAD * 2, h = Math.round(2.95 * RES) + PAD * 2, a = document.createElement('canvas'), g;
    a.width = w; a.height = h; g = a.getContext('2d'); g.setTransform(RES, 0, 0, RES, PAD + 1.2 * RES, PAD + 1.65 * RES); silShapes(g);
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#020a06'; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-atop'; var lg = g.createLinearGradient(0, 0, 0, h); lg.addColorStop(0, 'rgba(60,140,95,.28)'); lg.addColorStop(.5, 'rgba(20,60,40,.08)'); lg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = lg; g.fillRect(0, 0, w, h);
    var gl = document.createElement('canvas'); gl.width = w; gl.height = h; var q = gl.getContext('2d'); q.drawImage(a, 0, 0); q.globalCompositeOperation = 'source-in'; q.fillStyle = '#ffd27a'; q.fillRect(0, 0, w, h);
    var o = document.createElement('canvas'); o.width = w; o.height = h; var d = o.getContext('2d'), r = RES / 110;
    for (var i = 0; i < 8; i++) d.drawImage(gl, Math.cos(i * .785) * r, Math.sin(i * .785) * r);
    d.drawImage(a, 0, 0); return o;
  }
  function drawSil(e) {
    if (img) { drawImg(c); return; }
    if (img) { var hh = 2.95, ww = hh * img.naturalWidth / img.naturalHeight; if (ww > 2.4) { ww = 2.4; hh = ww * img.naturalHeight / img.naturalWidth; } c.imageSmoothingQuality = 'high'; c.drawImage(img, -ww / 2, 1.3 - hh, ww, hh); return; }
    if (!sil) sil = mkSil();
    c.imageSmoothingQuality = 'high';
    c.drawImage(sil, -(1.2 + PAD / RES), -(1.65 + PAD / RES), sil.width / RES, sil.height / RES);
    if (e > .02 && !img) {
      c.save(); c.globalCompositeOperation = 'lighter';
      for (var s = -1; s <= 1; s += 2) {
        var gr = c.createRadialGradient(s * .12, -.62, 0, s * .12, -.62, .15); gr.addColorStop(0, 'rgba(255,190,60,' + Math.min(1, .75 * e) + ')'); gr.addColorStop(1, 'rgba(255,120,0,0)');
        c.fillStyle = gr; c.fillRect(s * .12 - .15, -.77, .3, .3);
        c.beginPath(); c.moveTo(s * .05, -.56); c.lineTo(s * .21, -.69); c.lineTo(s * .22, -.64); c.lineTo(s * .08, -.54); c.closePath(); c.fillStyle = 'rgba(255,250,215,' + Math.min(1, e) + ')'; c.fill();
      }
      c.restore();
    }
  }

  /* ---------- Sudarshana Chakra ---------- */
  function chakra(x, y, r, rot, a) {
    var i, n = 24, st = TAU / n;
    c.save(); c.translate(x, y); c.globalAlpha = a; c.globalCompositeOperation = 'lighter';
    var g = c.createRadialGradient(0, 0, r * .2, 0, 0, r * 2.2); g.addColorStop(0, 'rgba(255,214,90,.55)'); g.addColorStop(.5, 'rgba(255,150,30,.18)'); g.addColorStop(1, 'rgba(255,120,0,0)');
    c.fillStyle = g; c.fillRect(-r * 2.2, -r * 2.2, r * 4.4, r * 4.4); c.globalCompositeOperation = 'source-over';
    var ca = Math.cos(-rot), sa = Math.sin(-rot), p1 = [-r * ca + r * sa, -r * sa - r * ca], p2 = [r * ca - r * sa, r * sa + r * ca];
    var mg = c.createLinearGradient(p1[0], p1[1], p2[0], p2[1]);
    [[0, '#7a5410'], [.3, '#ffe27a'], [.5, '#b8800f'], [.75, '#fff6c0'], [1, '#8a6012']].forEach(function (s) { mg.addColorStop(s[0], s[1]); });
    c.rotate(rot); c.fillStyle = mg; c.beginPath();
    for (i = 0; i < n; i++) { var a0 = i * st; c.lineTo(Math.cos(a0) * r * .86, Math.sin(a0) * r * .86); c.lineTo(Math.cos(a0 + st * .9) * r, Math.sin(a0 + st * .9) * r); c.lineTo(Math.cos(a0 + st) * r * .86, Math.sin(a0 + st) * r * .86); }
    c.closePath(); c.fill();
    c.beginPath(); c.arc(0, 0, r * .8, 0, TAU); c.arc(0, 0, r * .66, 0, TAU, true); c.fill();
    c.beginPath(); c.arc(0, 0, r * .62, 0, TAU); c.fillStyle = '#3a1604'; c.fill();
    c.strokeStyle = 'rgba(255,200,80,.55)'; c.lineWidth = r * .02;
    for (i = 0; i < 16; i++) { var q = i / 16 * TAU; c.beginPath(); c.moveTo(Math.cos(q) * r * .2, Math.sin(q) * r * .2); c.lineTo(Math.cos(q) * r * .62, Math.sin(q) * r * .62); c.stroke(); }
    c.rotate(-rot * 1.6); c.fillStyle = mg;
    for (i = 0; i < 8; i++) { c.rotate(TAU / 8); c.beginPath(); c.moveTo(r * .18, 0); c.quadraticCurveTo(r * .4, r * .17, r * .58, 0); c.quadraticCurveTo(r * .4, -r * .17, r * .18, 0); c.fill(); }
    g = c.createRadialGradient(0, 0, 0, 0, 0, r * .18); g.addColorStop(0, '#fff'); g.addColorStop(.5, '#ffe27a'); g.addColorStop(1, '#b8800f'); c.fillStyle = g; c.beginPath(); c.arc(0, 0, r * .17, 0, TAU); c.fill();
    c.restore();
    c.save(); c.translate(x, y); c.globalAlpha = a * .6; c.strokeStyle = '#fff'; c.lineWidth = r * .035; c.lineCap = 'round'; c.beginPath(); c.arc(0, 0, r * .93, -2.5, -1.3); c.stroke(); c.restore();
  }
  function bez(f, u) { var m = 1 - u; return [m * m * f.sx + 2 * u * m * f.qx + u * u * f.tx, m * m * f.sy + 2 * u * m * f.qy + u * u * f.ty]; }

  /* ---------- particles ---------- */
  function add(p) { if (P.length < (low ? 650 : 1300)) P.push(p); }
  function sparks(x, y, n, sp, life, g) {
    for (var i = 0; i < n; i++) { var a = R() * TAU, v = sp * (.25 + R() * .75); add({ k: 'e', x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: g, l: life * (.5 + R() * .5), m: life, r: 1 + R() * 2, col: COLS[(R() * 4) | 0], d: 0 }); }
  }
  function burst(x, y) {
    var n = low ? 22 : 34, col = [COLS[(R() * 7) | 0], COLS[(R() * 7) | 0]];
    for (var i = 0; i < n; i++) { var a = i / n * TAU + R() * .1, v = 90 + R() * 170; add({ k: 'f', x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 90, l: .9 + R() * .6, m: 1.5, r: 2, col: col[i & 1], d: 0 }); }
    sparks(x, y, 6, 60, .6, 0);
  }
  function confetti(n) {
    for (var i = 0; i < n; i++) add({ k: 'c', x: R() * W, y: -10 - R() * H * .3, vx: (R() - .5) * 60, vy: 60 + R() * 90, g: 0, l: 99, m: 99, w: 6 + R() * 5, h: 3 + R() * 3, rot: R() * 6, vr: (R() - .5) * 9, ph: R() * 6, col: COLS[(R() * 7) | 0], d: 0 });
  }
  function dcol(d, ow, q) { if (!img) return COLS[(R() * 5) | 0]; var k = (q[1] * ow + q[0]) * 4; return 'rgb(' + (Math.min(255, d[k] * 1.3 + 60) | 0) + ',' + (Math.min(255, d[k + 1] * 1.3 + 40) | 0) + ',' + (Math.min(255, d[k + 2] * 1.3) | 0) + ')'; }
  function dissolve() {
    var ow = 180, oh = Math.round(2.95 * 75), o = document.createElement('canvas'); o.width = ow; o.height = oh;
    var g = o.getContext('2d'); g.setTransform(75, 0, 0, 75, 1.2 * 75, 1.65 * 75); silShapes(g); g.setTransform(1, 0, 0, 1, 0, 0);
    var d = g.getImageData(0, 0, ow, oh).data, pts = [], i, x, y;
    for (y = 0; y < oh; y += 2) for (x = 0; x < ow; x += 2) if (d[(y * ow + x) * 4 + 3] > 140) pts.push([x, y]);
    var N = Math.min(pts.length, low ? 420 : 800), ex = mx, ey = my - S * DS * .1;
    for (i = 0; i < N; i++) {
      var q = pts[(R() * pts.length) | 0], sx = mx + (q[0] / 75 - 1.2) * S * DS, sy = my + (q[1] / 75 - 1.65) * S * DS, dx = sx - ex, dy = sy - ey, L = Math.hypot(dx, dy) || 1, v = 30 + R() * 150;
      add({ k: 'e', x: sx, y: sy, vx: dx / L * v, vy: dy / L * v - 40, g: -15, l: 1.6 + R() * 1.8, m: 3.4, r: 1.2 + R() * 2.4, col: dcol(d, ow, q), d: L / (S * 1.6) * .6 + R() * .15 });
    }
  }

  /* ---------- strike logic ---------- */
  function strike(px, py) {
    if (done || locked || win) return;
    if (!ready) { T = Math.max(T, 1.9); return; }
    var now = performance.now(); if (now - lastStrike < 260) return; lastStrike = now;
    var s = S * DS; if (px == null) { px = mx; py = my - s * .2; } /* keyboard / button: auto-aim at the demon */
    var u = (px - mx) / s, v = (py - my) / s, hit = u * u / .64 + (v + .15) * (v + .15) / 2.1 <= 1, side = (strikes + misses) % 2 ? 1 : -1, isLast = false;
    if (hit) {
      strikes++; isLast = strikes === 5; if (isLast) locked = true;
      $('.nk-count').textContent = strikes + '/5'; $('.nk-sr').textContent = 'Hit! Strike ' + strikes + ' of 5';
      var dots = root.querySelectorAll('.nk-dot'); for (var i = 0; i < strikes; i++) dots[i].classList.add('on');
      if (isLast) root.classList.add('nk-done');
    } else { misses++; $('.nk-sr').textContent = 'Missed'; }
    flights.push({ t: 0, dur: .4, sx: cx + side * W * .06, sy: H + S * .5, qx: cx + side * W * .26, qy: H * .62, tx: px, ty: py, ox: px - mx, oy: py - my, hit: hit, miss: !hit, rot: R() * 6, last: isLast, tr: [] });
  }
  function impact(f) {
    if (f.miss) { sparks(f.tx, f.ty, 10, 150, .5, 120); rings.push({ x: f.tx, y: f.ty, t: .7 }); pops.push({ x: f.tx, y: f.ty - 18, t: 0, s: 'Missed!', c: '#ff9a8a' }); return; }
    hurt = f.last ? 9 : .45; pops.push({ x: f.tx, y: f.ty - 24, t: 0, s: f.last ? 'FINAL BLOW!' : 'Hit! ' + strikes + '/5', c: '#ffe27a' });
    sparks(f.tx, f.ty, low ? 24 : 42, 340, 1, 220);
    rings.push({ x: f.tx, y: f.ty, t: 0 }); flash = Math.max(flash, f.last ? .5 : .26); light = 1; recoil = 1;
    var seg = [], k, a, x, y;
    for (k = 0; k < 3; k++) { a = R() * TAU; x = 0; y = 0; var pts = [[0, 0]]; for (var j = 0; j < 6; j++) { a += (R() - .5) * 1.0; x += Math.cos(a) * S * .09; y += Math.sin(a) * S * .09; pts.push([x, y]); } seg.push(pts); }
    cracks.push({ x: f.tx - mx, y: f.ty - my, seg: seg });
    if (f.last) { win = true; tw = 0; wf = {}; timers.push(setTimeout(function () { finish('complete'); }, 9000)); }
  }

  /* ---------- frame ---------- */
  function frame(now) {
    raf = requestAnimationFrame(frame);
    try { var dt = Math.min((now - last) / 1000, .05); last = now; update(dt); draw(); } catch (e) { finish('error'); }
  }
  function update(dt) {
    var i, p;
    T += dt; flash = Math.max(0, flash - dt * 2.4); light = Math.max(win ? .45 : 0, light - dt * 1.3); recoil = Math.max(0, recoil - dt * 3.2);
    if (!ready && T >= 1.8) { ready = true; root.classList.add('nk-ready'); try { $('.nk-tap').focus({ preventScroll: true }); } catch (e) {} }
    for (i = flights.length - 1; i >= 0; i--) {
      var f = flights[i]; f.t += dt; if (f.hit) { f.tx = mx + f.ox; f.ty = my + f.oy; } var u = Math.min(f.t / f.dur, 1); f.u = Math.pow(u, 1.5);
      var pos = bez(f, f.u); f.x = pos[0]; f.y = pos[1]; if (R() < .8) sparks(f.x, f.y, 1, 70, .5, 80);
      if (u >= 1) { flights.splice(i, 1); impact(f); }
    }
    for (i = rings.length - 1; i >= 0; i--) { rings[i].t += dt * 1.7; if (rings[i].t >= 1) rings.splice(i, 1); }
    for (i = pops.length - 1; i >= 0; i--) { pops[i].t += dt; if (pops[i].t > .9) pops.splice(i, 1); }
    hurt = Math.max(0, hurt - dt);
    if (ready && !win) { /* the demon wanders, faster with every hit */
      wT -= dt; var ddx = wx - mx, ddy = wy - my, dd = Math.hypot(ddx, ddy) || 1; if (dd < 14 || wT <= 0) way();
      var spd = Math.min(W, H * 1.6) * .34 * (1 + strikes * .3) * (1 - Math.min(.3, misses * .04)) * (hurt > 0 ? .25 : 1), k2 = Math.min(1, dt * 4);
      mvx += (ddx / dd * spd - mvx) * k2; mvy += (ddy / dd * spd - mvy) * k2; mx += mvx * dt; my += mvy * dt;
      mx = Math.max(bnd[0], Math.min(bnd[1], mx)); my = Math.max(bnd[2], Math.min(bnd[3], my));
    }
    if (win) {
      tw += dt;
      if (!wf.a && tw > .3) { wf.a = 1; dissolve(); rings.push({ x: mx, y: my, t: 0 }); }
      if (!wf.c1 && tw > .4) { wf.c1 = 1; confetti(low ? 70 : 130); }
      if (!wf.c2 && tw > 1.7) { wf.c2 = 1; confetti(low ? 50 : 90); }
      if (tw > .5 && tw < 4.2 && tw >= (wf.nb || 0)) { burst(W * (.15 + R() * .7), H * (.12 + R() * .5)); wf.nb = tw + .35 + R() * .3; }
      if (!wf.t && tw > 1.1) { wf.t = 1; root.classList.add('nk-won'); $('.nk-win').innerHTML = 'Victory of Light over Darkness<br><small>Happy Diwali</small>'; }
      if (!wf.o && tw > 4.8) { wf.o = 1; root.classList.add('nk-out'); }
      if (tw > 5.8) finish('complete');
    }
    for (i = P.length - 1; i >= 0; i--) {
      p = P[i]; if (p.d > 0) { p.d -= dt; continue; }
      p.l -= dt; if (p.l <= 0 || p.y > H + 30) { P[i] = P[P.length - 1]; P.pop(); continue; }
      if (p.k === 'c') { p.ph += dt * 3; p.x += (p.vx + Math.sin(p.ph) * 40) * dt; p.y += p.vy * dt; p.rot += p.vr * dt; }
      else { var dr = 1 - (p.k === 'f' ? 1.3 : .6) * dt; p.vx *= dr; p.vy = p.vy * dr + p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    }
    for (i = 0; i < embers.length; i++) { p = embers[i]; p.p += dt * 3; p.x += (p.vx + Math.sin(p.p) * 10) * dt; p.y += p.vy * dt; if (p.y < -10) embers[i] = ember(false); }
    for (i = 0; i < puffs.length; i++) { p = puffs[i]; var k = sm((T - .4) / 1.4); p.x += (p.vx + (p.x - cx) * k * .25) * dt; p.y += p.vy * dt; p.r += p.vr * dt; if (p.y < -p.s * .4) { p.y = H + p.s * .4; } }
  }
  function draw() {
    var i, p, figA = sm((T - .5) / 1.2), eyeA = sm((T - 1.5) / .5) * (.88 + .12 * Math.sin(T * 5)), glow = 0;
    if (win) { figA = tw < .35 ? 1 : Math.max(0, 1 - (tw - .35) / .7); glow = Math.min(1, tw / .35); eyeA = 1; }
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.fillStyle = sky; c.fillRect(0, 0, W, H);
    for (i = 0; i < stars.length; i++) { p = stars[i]; c.globalAlpha = (.25 + .35 * Math.sin(T * 1.5 + p.p)) * (1 - .5 * sm((T - .5) / 1.2)); c.fillStyle = '#d8f5d0'; c.fillRect(p.x * W, p.y * H, p.r, p.r); }
    c.globalAlpha = 1; c.globalCompositeOperation = 'lighter';
    var fl = .5 + .5 * Math.sin(T * 7) * Math.sin(T * 3.1), g = c.createRadialGradient(cx, H, 0, cx, H, Math.max(W, H) * .9);
    g.addColorStop(0, 'rgba(255,170,50,' + (.1 + .22 * sm(T / 1.5) + .05 * fl + .3 * light) + ')'); g.addColorStop(1, 'rgba(255,140,30,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
    var ox = mx - cx, oy = my - cy - recoil * S * DS * .015, sc = 1 + recoil * .012;
    g = c.createRadialGradient(mx, my - S * DS * .4, S * DS * .2, mx, my - S * DS * .4, S * DS * 1.9); g.addColorStop(0, 'rgba(255,150,40,' + (.2 * figA + .3 * light + .3 * glow) + ')'); g.addColorStop(1, 'rgba(255,120,20,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'source-over';
    if (figA > .003) {
      c.save(); c.globalAlpha = figA; c.translate(cx + ox, cy + oy); c.scale(S * DS * sc, S * DS * sc); drawSil(Math.min(1, eyeA * (1 + light * .3)));
      c.restore();
      c.save(); c.globalAlpha = figA; c.translate(cx + ox, cy + oy); c.scale(S * DS * sc, S * DS * sc); c.clip(bodyP); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.globalCompositeOperation = 'lighter';
      for (i = 0; i < cracks.length; i++) {
        var cr = cracks[i], gx = cx + ox + cr.x * sc, gy = cy + oy + cr.y * sc;
        g = c.createRadialGradient(gx, gy, 0, gx, gy, S * .7); g.addColorStop(0, 'rgba(255,200,80,' + (.28 + .3 * light + .4 * glow) + ')'); g.addColorStop(1, 'rgba(255,150,30,0)'); c.fillStyle = g; c.fillRect(gx - S, gy - S, S * 2, S * 2);
        c.lineCap = 'round'; c.lineJoin = 'round';
        [[7, 'rgba(255,170,40,.28)'], [2, 'rgba(255,240,180,.95)']].forEach(function (w) {
          c.lineWidth = w[0]; c.strokeStyle = w[1]; c.beginPath();
          cr.seg.forEach(function (s) { c.moveTo(gx + s[0][0], gy + s[0][1]); for (var j = 1; j < s.length; j++) c.lineTo(gx + s[j][0] * sc, gy + s[j][1] * sc); }); c.stroke();
        });
      }
      if (glow > 0) { c.fillStyle = 'rgba(255,190,70,' + glow * .55 + ')'; c.fillRect(0, 0, W, H); }
      c.restore();
    }
    c.globalAlpha = 1; g = c.createLinearGradient(0, H * .84, 0, H * .97); g.addColorStop(0, 'rgba(4,30,18,0)'); g.addColorStop(1, 'rgba(4,36,22,1)'); c.fillStyle = g; c.fillRect(0, H * .84, W, H);
    var dens = (.95 - .8 * sm((T - .4) / 1.4)) * (win ? .6 : 1) + .06;
    for (i = 0; i < puffs.length; i++) { p = puffs[i]; c.globalAlpha = Math.min(1, p.a * dens); c.save(); c.translate(p.x, p.y); c.rotate(p.r); c.drawImage(smokeSpr, -p.s / 2, -p.s / 2, p.s, p.s); c.restore(); }
    c.globalAlpha = 1; c.globalCompositeOperation = 'lighter';
    for (i = 0; i < embers.length; i++) { p = embers[i]; c.globalAlpha = p.a * (.6 + .4 * Math.sin(p.p * 2)); c.fillStyle = '#ffb347'; c.fillRect(p.x, p.y, p.r, p.r); }
    for (i = 0; i < rings.length; i++) { p = rings[i]; c.globalAlpha = (1 - p.t) * .8; c.strokeStyle = '#ffe27a'; c.lineWidth = 3; c.beginPath(); c.arc(p.x, p.y, p.t * S * 1.5 + 4, 0, TAU); c.stroke(); }
    for (i = 0; i < P.length; i++) {
      p = P[i]; if (p.d > 0 || p.k === 'c') continue; c.globalAlpha = Math.max(0, Math.min(1, p.l / (p.m * .6)));
      if (p.k === 'f') { c.strokeStyle = p.col; c.lineWidth = 2; c.beginPath(); c.moveTo(p.x - p.vx * .04, p.y - p.vy * .04); c.lineTo(p.x, p.y); c.stroke(); }
      else { c.fillStyle = p.col; c.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r); }
    }
    c.globalCompositeOperation = 'source-over';
    for (i = 0; i < P.length; i++) { p = P[i]; if (p.k !== 'c') continue; c.globalAlpha = .95; c.fillStyle = p.col; c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.scale(1, Math.cos(p.ph * 2)); c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); c.restore(); }
    for (i = 0; i < flights.length; i++) {
      var f = flights[i], r = S * .46 * (1.25 - .55 * f.u);
      c.globalCompositeOperation = 'lighter';
      for (var k = 5; k >= 1; k--) { var tp = bez(f, Math.max(0, f.u - k * .05)); c.globalAlpha = .12 * (6 - k); c.fillStyle = '#ffb347'; c.beginPath(); c.arc(tp[0], tp[1], r * (.5 - k * .05), 0, TAU); c.fill(); }
      c.globalCompositeOperation = 'source-over'; chakra(f.x, f.y, r, f.rot + f.t * 10, 1);
    }
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    c.textAlign = 'center'; c.font = '900 ' + Math.round(Math.max(18, S * .16)) + 'px "Cinzel Decorative",Georgia,serif'; c.lineWidth = 4; c.strokeStyle = 'rgba(40,18,0,.9)';
    for (i = 0; i < pops.length; i++) { p = pops[i]; c.globalAlpha = 1 - p.t / .9; c.fillStyle = p.c; var py = p.y - p.t * 50; c.strokeText(p.s, p.x, py); c.fillText(p.s, p.x, py); }
    c.globalAlpha = 1;
    if (flash > .005) { c.fillStyle = 'rgba(255,236,170,' + Math.min(flash, .5) + ')'; c.fillRect(0, 0, W, H); }
  }

  try {
    var back = false; try { back = sessionStorage.getItem('fromPortal') === '1'; sessionStorage.removeItem('fromPortal'); } catch (e) {}
    if (reduce || back) { root = document.createElement('div'); root.style.display = 'none'; document.body.insertBefore(root, document.body.firstChild); timers.push(setTimeout(function () { finish((reduce ? 'reduced-motion' : 'returned')); }, 0)); }
    else init();
  } catch (e) { finish('error'); }
  window.DiwaliIntro = { light: strike, strike: strike, skip: skip };
})();