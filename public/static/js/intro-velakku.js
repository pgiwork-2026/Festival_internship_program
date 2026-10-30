/* Velakku entrance: drag the matchstick to the wick; a spotlight reveals the page; lamp lights; curtain fades. */
(function () {
  'use strict';
  var de = document.documentElement, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.createElement('div');
  root.className = 'vk-root'; root.setAttribute('role', 'region'); root.setAttribute('aria-label', 'Traditional Velakku entrance');
  root.innerHTML =
    '<div class="vk-curtain"></div><div class="vk-ring"></div><div class="vk-bloom"></div>' +
    '<header class="vk-top"><button class="vk-skip" type="button" aria-label="Skip to website">Skip \u2192</button></header>' +
    '<main class="vk-stage"><div class="vk-lampbox"><div class="vk-glow"></div>' +
    '<img class="vk-img-unlit" src="static/images/velakku/lamp_unlit_clean.png" alt="Traditional brass Kuthu Vilakku">' +
    '<img class="vk-img-lit" src="static/images/velakku/lamp_lit_clean.png" alt="" aria-hidden="true">' +
    '<div class="vk-wick" role="button" tabindex="0" aria-label="Kuthu Vilakku wick - activate to light"><i></i></div></div></main>' +
    '<div class="vk-match" role="button" tabindex="0" aria-label="Drag the matchstick to light the Velakku">' +
    '<div class="vk-grab"></div><div class="vk-aura"></div>' +
    '<div class="vk-body"><div class="vk-fl"><b></b><s></s></div><div class="vk-head"></div><div class="vk-char"></div><div class="vk-stick"></div></div>' +
    '<div class="vk-hint"><span>\uD83D\uDC46 Drag match to light Velakku</span></div></div>' +
    '<footer class="vk-foot">Plant Green Inertia \u2022 2026</footer>';
  document.body.insertBefore(root, document.body.firstChild);
  de.classList.add('vk-lock');

  var $ = function (s) { return root.querySelector(s); };
  var curtain = $('.vk-curtain'), ring = $('.vk-ring'), bloom = $('.vk-bloom'), wick = $('.vk-wick'), match = $('.vk-match');
  var pos = home(), dragging = false, lit = false, done = false, raf = 0, timers = [];

  function home() { var w = innerWidth, h = innerHeight; return { x: Math.max(240, Math.min(w - 180, Math.round(w * .86))), y: Math.max(240, Math.min(h - 150, Math.round(h * .78))) }; }
  function wickC() { var r = wick.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  function render() {
    match.style.transform = 'translate3d(' + pos.x + 'px,' + pos.y + 'px,0)';
    if (lit) return;
    var m = 'radial-gradient(circle 190px at ' + pos.x + 'px ' + pos.y + 'px, transparent 0%, transparent 65px, rgba(0,0,0,.4) 120px, black 185px)';
    curtain.style.webkitMaskImage = curtain.style.maskImage = m;
    ring.style.transform = 'translate(' + (pos.x - 180) + 'px,' + (pos.y - 180) + 'px)';
    var c = wickC(), d = Math.hypot(c.x - pos.x, c.y - pos.y);
    match.classList.toggle('near', d < 145);
    return d;
  }
  function sparks(x, y) {
    if (reduce) return;
    var cols = ['#f59e0b', '#fbbf24', '#fef08a', '#fff', '#eab308'];
    for (var i = 0; i < 36; i++) {
      var s = document.createElement('i'); s.className = 'vk-spark';
      s.style.cssText = 'left:' + x + 'px;top:' + y + 'px;background:' + cols[i % 5];
      root.appendChild(s);
      var a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 140;
      s.animate([{ transform: 'translate(0,0)', opacity: 1 }, { transform: 'translate(' + Math.cos(a) * v + 'px,' + (Math.sin(a) * v + 50) + 'px)', opacity: 0 }], { duration: 900 + Math.random() * 500, easing: 'ease-out' }).onfinish = (function (n) { return function () { n.remove(); }; })(s);
    }
  }
  function ignite() {
    if (lit) return; lit = true; dragging = false;
    var c = wickC(); bloom.style.left = c.x + 'px'; bloom.style.top = c.y + 'px';
    root.classList.add('vk-lit'); sparks(c.x, c.y);
    timers.push(setTimeout(function () { root.classList.add('vk-out'); }, 1800));
    timers.push(setTimeout(finish, 2800));
  }
  function finish(reason) {
    if (done) return; done = true;
    timers.forEach(clearTimeout); cancelAnimationFrame(raf);
    removeEventListener('resize', onResize); removeEventListener('keydown', onKey);
    root.remove(); de.classList.remove('vk-lock');
    document.dispatchEvent(new CustomEvent('velakku:complete', { detail: { reason: reason || 'complete' } }));
  }
  function skip() { if (done) return; root.classList.add('vk-out', 'vk-lit'); timers.push(setTimeout(function () { finish('skip'); }, 450)); }

  function move(e) { if (!dragging || lit) return; pos = { x: e.clientX, y: e.clientY }; if (!raf) raf = requestAnimationFrame(function () { raf = 0; if (render() < 110) ignite(); }); }
  function glideHome(sx, sy) {
    var t = home(), t0 = performance.now();
    (function step(now) {
      if (dragging || lit || done) return;
      var p = Math.min((now - t0) / 450, 1), e = 1 - Math.pow(1 - p, 3);
      pos = { x: Math.round(sx + (t.x - sx) * e), y: Math.round(sy + (t.y - sy) * e) }; render();
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }
  function up(e) { if (!dragging) return; dragging = false; match.classList.remove('drag'); if (!lit) glideHome(e.clientX, e.clientY); }
  match.addEventListener('pointerdown', function (e) {
    if (lit) return; e.preventDefault(); dragging = true; match.classList.add('drag', 'moved');
    try { match.setPointerCapture(e.pointerId); } catch (_) {}
    pos = { x: e.clientX, y: e.clientY }; if (render() < 110) ignite();
  });
  match.addEventListener('pointermove', move);
  match.addEventListener('pointerup', up); match.addEventListener('pointercancel', up);
  wick.addEventListener('click', ignite);
  $('.vk-skip').addEventListener('click', skip);
  function onKey(e) {
    if (e.key === 'Escape') skip();
    else if (!lit && (e.key === ' ' || e.key === 'Enter') && !/^(INPUT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) { e.preventDefault(); ignite(); }
  }
  function onResize() { if (!dragging && !lit) { pos = home(); render(); } }
  addEventListener('keydown', onKey); addEventListener('resize', onResize);
  render();
  timers.push(setTimeout(function () { finish('watchdog'); }, 60000));
  window.VelakkuIntro = { light: ignite, skip: skip };
})();
