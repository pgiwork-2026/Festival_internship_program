/*! Lamp-lighting intro — isolated, dependency-free component.
 *
 * Include static/css/intro-lamp.css in <head> and this script as the FIRST
 * child of <body> (so the overlay exists before the page first paints).
 * It builds its own overlay, runs the lamp + curtain sequence, then removes
 * the overlay and every listener / timer / frame it created.
 *
 * API:  LampIntro.start(options) -> controller | null
 *       controller.light()  programmatically light the lamp
 *       controller.skip()   dismiss immediately
 * Event: document "lampintro:complete" (detail.reason: complete|skip|watchdog|error)
 * Opt out of auto-start with:  window.INTRO_LAMP_AUTOSTART = false  (before this script)
 */
(function () {
  'use strict';
  if (window.LampIntro) return;

  const DEFAULTS = {
    igniteMs: 400,       // flame established ("lit") this long after the click
    waitMs: 1100,        // pause between "lit" and the curtains starting to open
    openMs: 2600,        // curtain travel time (mirrored in CSS via --il-open)
    tailMs: 250,         // extra time for the glow to fade before cleanup
    watchdogMs: 12000,   // hard stop after ignition: overlay is ALWAYS removed by then
    allowSkip: true,     // small "Skip intro" button (keyboard / assistive-tech friendly)
    text: {
      title: 'Light the Lamp to Begin',
      hintMouse: 'Move the matchstick to the wick and click.',
      hintTouch: 'Tap the glowing wick to light the lamp.',
      lit: 'The Lamp is Lit',
      alt: 'Tap to Light the Lamp',
      skip: 'Skip intro'
    }
  };

  // ---- markup --------------------------------------------------------------
  const LAMP_SVG = `
<svg class="il-lamp-svg" viewBox="0 0 320 700" aria-hidden="true" focusable="false">
 <defs>
  <linearGradient id="il-brass" x1="0" y1="0" x2="1" y2="0">
   <stop offset="0" stop-color="#4d3006"/><stop offset=".14" stop-color="#8c5f12"/><stop offset=".3" stop-color="#d6a431"/>
   <stop offset=".42" stop-color="#fbe39a"/><stop offset=".52" stop-color="#e8b83f"/><stop offset=".7" stop-color="#a8741a"/>
   <stop offset=".88" stop-color="#5f3d0a"/><stop offset="1" stop-color="#3a2304"/>
  </linearGradient>
  <radialGradient id="il-oil" cx=".5" cy=".5" r=".6"><stop offset="0" stop-color="#7a5316"/><stop offset="1" stop-color="#241505"/></radialGradient>
  <linearGradient id="il-cotton" x1="0" y1="0" x2="1" y2="0">
   <stop offset="0" stop-color="#c9b78d"/><stop offset=".45" stop-color="#fff7e2"/><stop offset=".8" stop-color="#d9c79b"/><stop offset="1" stop-color="#b8a373"/>
  </linearGradient>
  <linearGradient id="il-emberg" x1="0" y1="0" x2="0" y2="1">
   <stop offset="0" stop-color="#ffe08a"/><stop offset=".4" stop-color="#ff8a2b"/><stop offset="1" stop-color="#ff6414" stop-opacity="0"/>
  </linearGradient>
  <radialGradient id="il-warmg" gradientUnits="userSpaceOnUse" cx="160" cy="150" r="340">
   <stop offset="0" stop-color="#ffbe50" stop-opacity=".95"/><stop offset=".35" stop-color="#ff8c28" stop-opacity=".5"/><stop offset="1" stop-color="#ff7814" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="il-fo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9d2e"/><stop offset="1" stop-color="#ff6a00"/></linearGradient>
  <linearGradient id="il-fm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd24d"/><stop offset="1" stop-color="#ffb21f"/></linearGradient>
  <linearGradient id="il-fc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffbe0"/><stop offset="1" stop-color="#ffe9a0"/></linearGradient>
  <filter id="il-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7"/></filter>
  <g id="il-shapes">
   <path d="M34 672C34 690 100 697 160 697S286 690 286 672L277 652H43Z"/>
   <path d="M62 653C62 628 112 616 160 616S258 628 258 653Z"/>
   <path d="M160 618C147 630 147 645 160 652C173 645 173 630 160 618Z" transform="rotate(-34 160 652)"/>
   <path d="M160 618C147 630 147 645 160 652C173 645 173 630 160 618Z" transform="rotate(-17 160 652)"/>
   <path d="M160 618C147 630 147 645 160 652C173 645 173 630 160 618Z" transform="rotate(17 160 652)"/>
   <path d="M160 618C147 630 147 645 160 652C173 645 173 630 160 618Z" transform="rotate(34 160 652)"/>
   <rect x="94" y="598" width="132" height="22" rx="9"/>
   <path d="M112 600C54 590 60 516 122 503H198C260 516 266 590 208 600Z"/>
   <path d="M116 505H204L214 487H106Z"/>
   <path d="M126 489H194L186 470H134Z"/>
   <rect x="148" y="266" width="24" height="206"/>
   <ellipse cx="160" cy="430" rx="25" ry="11"/><ellipse cx="160" cy="372" rx="18" ry="9"/><ellipse cx="160" cy="320" rx="25" ry="11"/>
   <path d="M147 268H173C177 248 202 240 228 224H92C118 240 143 248 147 268Z"/>
   <path d="M70 214C70 244 124 253 160 253S250 244 250 214Z"/>
   <ellipse cx="160" cy="214" rx="91" ry="14"/>
  </g>
  <mask id="il-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="320" height="700"><use href="#il-shapes" fill="#fff"/></mask>
 </defs>
 <use href="#il-shapes" fill="url(#il-brass)" stroke="rgba(58,34,4,.75)" stroke-width="1.2" stroke-linejoin="round"/>
 <g fill="none" stroke-linecap="round" stroke="#fff3c4">
  <path d="M153 468V270" stroke-opacity=".55" stroke-width="2"/>
  <path d="M96 556C86 538 92 522 112 512" stroke-opacity=".5" stroke-width="3"/>
  <path d="M70 666C82 678 118 684 160 684" stroke-opacity=".4" stroke-width="2"/>
  <path d="M84 224C90 238 110 247 132 250" stroke-opacity=".5" stroke-width="2.4"/>
  <path d="M138 424C142 428 150 429 156 429M142 316C146 319 150 320 156 320" stroke-opacity=".5" stroke-width="2"/>
 </g>
 <g fill="#4a2f06" fill-opacity=".55">
  <circle cx="96" cy="556" r="2.2"/><circle cx="112" cy="560" r="2.2"/><circle cx="128" cy="562" r="2.2"/><circle cx="144" cy="563" r="2.2"/>
  <circle cx="160" cy="563" r="2.2"/><circle cx="176" cy="563" r="2.2"/><circle cx="192" cy="562" r="2.2"/><circle cx="208" cy="560" r="2.2"/><circle cx="224" cy="556" r="2.2"/>
 </g>
 <rect class="il-warm-ov" width="320" height="700" fill="url(#il-warmg)" mask="url(#il-mask)"/>
 <ellipse cx="160" cy="214" rx="79" ry="10" fill="url(#il-oil)"/>
 <ellipse cx="138" cy="212" rx="16" ry="2.4" fill="#fff3c4" fill-opacity=".18"/>
 <path d="M150 214L154 152Q160 143 166 152L170 214Z" fill="url(#il-cotton)" stroke="#8d7a4c" stroke-width="1"/>
 <path d="M150 214L151 198H169L170 214Z" fill="#8a6b2e" fill-opacity=".55"/>
 <path d="M152 205L168 198M153 192L167 185M154 179L166 172M155 166L165 160" stroke="#a99468" stroke-opacity=".75" stroke-width="1.2" fill="none"/>
 <path class="il-ember" d="M154 152Q160 143 166 152L167 166H153Z" fill="url(#il-emberg)"/>
 <g class="il-flame">
  <g class="il-flick">
   <ellipse cx="160" cy="130" rx="26" ry="42" fill="#ff9a2a" opacity=".55" filter="url(#il-blur)"/>
   <path d="M160 84C167 104 175 117 175 134C175 148 168 156 160 156C152 156 145 148 145 134C145 117 153 104 160 84Z" fill="url(#il-fo)" opacity=".95"/>
   <path d="M160 104C164 118 169 125 169 136C169 146 165 153 160 153C155 153 151 146 151 136C151 125 156 118 160 104Z" fill="url(#il-fm)"/>
   <path d="M160 126C162.5 133 165 137 165 142C165 148 163 152 160 152C157 152 155 148 155 142C155 137 157.5 133 160 126Z" fill="url(#il-fc)"/>
   <ellipse cx="160" cy="150" rx="4.5" ry="6" fill="#6f9bff" opacity=".5"/>
  </g>
 </g>
</svg>`;

  const KOLAM_SVG = `
<svg class="il-kolam" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
 <g fill="none" stroke="#f6dc8a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M100 10L190 100L100 190L10 100Z"/><path d="M100 34L166 100L100 166L34 100Z"/>
  <path d="M100 34C128 56 128 84 100 100C72 84 72 56 100 34Z"/>
  <path d="M100 34C128 56 128 84 100 100C72 84 72 56 100 34Z" transform="rotate(90 100 100)"/>
  <path d="M100 34C128 56 128 84 100 100C72 84 72 56 100 34Z" transform="rotate(180 100 100)"/>
  <path d="M100 34C128 56 128 84 100 100C72 84 72 56 100 34Z" transform="rotate(270 100 100)"/>
  <circle cx="100" cy="100" r="9"/>
 </g>
 <g fill="#f6dc8a">
  <circle cx="100" cy="10" r="2.6"/><circle cx="190" cy="100" r="2.6"/><circle cx="100" cy="190" r="2.6"/><circle cx="10" cy="100" r="2.6"/>
  <circle cx="55" cy="55" r="2.2"/><circle cx="145" cy="55" r="2.2"/><circle cx="145" cy="145" r="2.2"/><circle cx="55" cy="145" r="2.2"/><circle cx="100" cy="100" r="2.2"/>
 </g>
</svg>`;

  const MATCH_SVG = `
<svg class="il-match-body" viewBox="0 0 170 62" aria-hidden="true" focusable="false">
 <defs>
  <linearGradient id="il-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3d9a4"/><stop offset=".55" stop-color="#d9a860"/><stop offset="1" stop-color="#a8723a"/></linearGradient>
  <radialGradient id="il-head" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ff8a78"/><stop offset=".35" stop-color="#e02b2b"/><stop offset=".75" stop-color="#a00e18"/><stop offset="1" stop-color="#5e060d"/></radialGradient>
 </defs>
 <rect x="30" y="26" width="136" height="10" rx="5" fill="url(#il-wood)" stroke="#7a4d20" stroke-opacity=".5" stroke-width=".8"/>
 <path d="M34 28.5H162" stroke="#fff4d0" stroke-opacity=".55" stroke-width="1.6" stroke-linecap="round"/>
 <path d="M52 31.5H88M104 33.5H140M120 29.5H156" stroke="#8a5a28" stroke-opacity=".45" stroke-width=".8"/>
 <path d="M12 31C12 21 20 17 29 18C38 19 44 24 44 31C44 38 38 44 29 45C20 45 12 41 12 31Z" fill="url(#il-head)"/>
 <ellipse cx="24" cy="25" rx="5" ry="3" fill="#fff" fill-opacity=".45" transform="rotate(-25 24 25)"/>
</svg>
<svg class="il-mflame" viewBox="0 0 30 52" aria-hidden="true" focusable="false">
 <g class="il-flick">
  <path d="M15 2C19 14 26 22 26 34C26 44 21 50 15 50C9 50 4 44 4 34C4 22 11 14 15 2Z" fill="#ff8a1c"/>
  <path d="M15 20C18 28 21 32 21 38C21 44 18 48 15 48C12 48 9 44 9 38C9 32 12 28 15 20Z" fill="#ffd24d"/>
  <path d="M15 34C16.5 38 18 40 18 43C18 46 16.5 48 15 48C13.5 48 12 46 12 43C12 40 13.5 38 15 34Z" fill="#fffbe0"/>
 </g>
</svg>`;

  function markup(o) {
    const t = o.text;
    return `
<div class="il-glow"></div>
<div class="il-curtain il-curtain--l"><div class="il-valance"></div><div class="il-trim"></div><div class="il-fringe"></div></div>
<div class="il-curtain il-curtain--r"><div class="il-valance"></div><div class="il-trim"></div><div class="il-fringe"></div></div>
<div class="il-stage">
 <div class="il-vignette"></div><div class="il-warm"></div><div class="il-frame"></div><div class="il-particles"></div>
 <div class="il-text"><h1 class="il-title">${t.title}</h1><p class="il-hint">${t.hintMouse}</p></div>
 <div class="il-lampwrap"><div class="il-lamp">
  <div class="il-floor"></div>${KOLAM_SVG}
  <div class="il-bloom"><div class="il-bloom-in"></div></div>
  ${LAMP_SVG}
  <div class="il-flash"></div><div class="il-sparks"></div>
  <button type="button" class="il-wick" data-il-wick aria-label="Light the lamp"><span class="il-ring"></span></button>
 </div></div>
 <div class="il-foot"><button type="button" class="il-alt" data-il-ui>${t.alt}</button></div>
 ${o.allowSkip ? `<button type="button" class="il-skip" data-il-ui>${t.skip}</button>` : ''}
</div>
<div class="il-match"><div class="il-bob"><div class="il-match-in">${MATCH_SVG}</div></div></div>
<p class="il-sr" role="status" aria-live="polite"></p>`;
  }

  // ---- controller ----------------------------------------------------------
  let instance = null;

  function start(userOpts) {
    if (instance) return instance.api;
    const doc = document, html = doc.documentElement;
    if (!doc.body) { doc.addEventListener('DOMContentLoaded', () => start(userOpts), { once: true }); return null; }

    const o = Object.assign({}, DEFAULTS, userOpts || {});
    o.text = Object.assign({}, DEFAULTS.text, (userOpts && userOpts.text) || {});
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const T = reduce ? { wait: 500, open: 0, tail: 80, flame: 0 } : { wait: o.waitMs, open: o.openMs, tail: o.tailMs, flame: 160 };

    const root = doc.createElement('div');
    root.className = 'il-root' + (reduce ? ' il-reduce' : '');
    root.id = 'intro-lamp';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Opening ceremony: light the lamp to begin');
    root.tabIndex = -1;
    root.style.setProperty('--il-open', T.open + 'ms');
    root.innerHTML = markup(o);
    doc.body.insertBefore(root, doc.body.firstChild);

    // If the stylesheet is missing the overlay would be unstyled: bail out cleanly.
    if (getComputedStyle(root).position !== 'fixed') { root.remove(); return null; }

    const $ = (s) => root.querySelector(s);
    const lamp = $('.il-lamp'), wick = $('[data-il-wick]'), alt = $('.il-alt'), skip = $('.il-skip');
    const title = $('.il-title'), hint = $('.il-hint'), sparks = $('.il-sparks'), say = $('.il-sr');
    const match = $('.il-match'), matchBody = $('.il-match-body'), particles = $('.il-particles');

    const ac = new AbortController();
    const on = (el, ev, fn, opt) => el.addEventListener(ev, fn, Object.assign({ signal: ac.signal }, opt || {}));
    const timers = [];
    const later = (fn, ms) => { timers.push(setTimeout(() => { try { fn(); } catch (e) { finish('error'); } }, ms)); };

    let state = 'idle';   // idle -> igniting -> lit -> opening -> done   (or skipping)
    let mode = matchMedia('(hover: none), (pointer: coarse)').matches ? 'touch' : 'mouse';
    let moved = false, raf = 0, last = 0, mx = -200, my = -200, tilt = 0;
    const target = { x: -200, y: -200 };
    const inerted = [];

    // lock page (compensate the scrollbar so layout does not jump) + make page content inert
    const sbw = window.innerWidth - html.clientWidth;
    if (sbw > 0) html.style.setProperty('--il-sbw', sbw + 'px');
    html.classList.add('il-lock');
    const inertPage = () => Array.from(doc.body.children).forEach((el) => {
      if (el === root || inerted.includes(el) || /^(SCRIPT|STYLE|LINK|NOSCRIPT)$/.test(el.tagName) || el.hasAttribute('inert')) return;
      el.setAttribute('inert', ''); inerted.push(el);
    });
    inertPage();
    if (doc.readyState === 'loading') on(doc, 'DOMContentLoaded', inertPage);

    // decorative particles
    if (!reduce) {
      const n = innerWidth < 600 ? 14 : 26;
      for (let i = 0; i < n; i++) {
        const p = doc.createElement('i'), s = 2 + Math.random() * 4;
        p.style.cssText = `left:${Math.random() * 100}%;width:${s}px;height:${s}px;--il-dx:${(Math.random() * 60 - 30).toFixed(0)}px;` +
          `animation-duration:${(7 + Math.random() * 9).toFixed(1)}s;animation-delay:${(-Math.random() * 12).toFixed(1)}s`;
        particles.appendChild(p);
      }
    }

    // ---- geometry + matchstick tracking -------------------------------------
    function wickPoint() {           // wick tip, in viewport coordinates
      const r = lamp.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height * (150 / 700), w: r.width, h: r.height };
    }
    function rest() {                // idle resting spot: lower-right of the wick
      const p = wickPoint();
      const sc = innerWidth <= 600 ? 0.78 : 1;            // keep the whole stick on screen
      return { x: Math.min(p.x + Math.max(60, p.w * 0.55), innerWidth - 150 * sc), y: p.y + Math.max(70, p.h * 0.16) };
    }
    function frame(t) {
      const dt = Math.min(48, t - (last || t - 16)); last = t;
      const k = reduce ? 1 : 1 - Math.exp(-dt / 55);
      const dx = (target.x - mx) * k;
      mx += dx; my += (target.y - my) * k;
      tilt += ((reduce ? 0 : Math.max(-14, Math.min(14, dx * 1.2))) - tilt) * 0.2;
      match.style.transform = `translate3d(${mx.toFixed(1)}px,${my.toFixed(1)}px,0)`;
      matchBody.style.transform = `rotate(${(34 + tilt).toFixed(2)}deg)`;
      if (Math.abs(target.x - mx) > 0.15 || Math.abs(target.y - my) > 0.15 || Math.abs(tilt) > 0.05) raf = requestAnimationFrame(frame);
      else raf = 0;
    }
    const kick = () => { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } };
    function placeRest(snap) {
      if (moved && mode === 'mouse') return;
      const r = rest(); target.x = r.x; target.y = r.y;
      if (snap) { mx = r.x; my = r.y; }
      kick();
    }
    function setMode(m) {
      if (m === mode) return;
      mode = m; moved = false;
      root.classList.toggle('il-mode-touch', m === 'touch');
      root.classList.toggle('il-mode-mouse', m === 'mouse');
      hint.textContent = m === 'touch' ? o.text.hintTouch : o.text.hintMouse;
      match.classList.remove('il-off');
      placeRest(false);
    }
    root.classList.add(mode === 'touch' ? 'il-mode-touch' : 'il-mode-mouse');
    if (mode === 'touch') hint.textContent = o.text.hintTouch;
    placeRest(true);
    match.style.transform = `translate3d(${mx}px,${my}px,0)`;

    // ---- interaction ----------------------------------------------------------
    on(doc, 'pointermove', (e) => {
      if (state !== 'idle') return;
      if (e.pointerType === 'touch') { setMode('touch'); return; }
      setMode('mouse');
      moved = true; target.x = e.clientX; target.y = e.clientY;
      match.classList.toggle('il-off', !!(e.target.closest && e.target.closest('[data-il-ui]')));
      kick();
    });
    on(doc, 'pointerdown', (e) => { if (state === 'idle' && e.pointerType === 'touch') setMode('touch'); });
    on(html, 'mouseleave', () => { if (state === 'idle') match.classList.add('il-off'); });
    on(window, 'resize', () => { if (state === 'idle') placeRest(false); });

    on(wick, 'pointerenter', (e) => { if (e.pointerType !== 'touch' && state === 'idle') root.classList.add('il-over-wick'); });
    on(wick, 'pointerleave', () => root.classList.remove('il-over-wick'));
    on(wick, 'click', () => ignite());                 // ignition ONLY from the wick's interaction area
    on(alt, 'click', () => ignite());                  // touch tap-to-light alternative
    if (skip) on(skip, 'click', () => dismiss());
    on(root, 'click', (e) => {                         // a miss: gentle nudge, nothing else
      if (state !== 'idle' || e.target.closest('[data-il-wick],[data-il-ui]')) return;
      hint.classList.remove('il-nudge'); void hint.offsetWidth; hint.classList.add('il-nudge');
    });

    // ---- sequence --------------------------------------------------------------
    function burst() {
      if (reduce) return;
      for (let i = 0; i < 16; i++) {
        const s = doc.createElement('i'), a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 90;
        s.style.setProperty('--dx', (Math.cos(a) * d).toFixed(0) + 'px');
        s.style.setProperty('--dy', (Math.sin(a) * d * 0.8 - 30).toFixed(0) + 'px');
        s.style.setProperty('--sz', (3 + Math.random() * 4).toFixed(1) + 'px');
        s.style.animationDelay = (Math.random() * 120).toFixed(0) + 'ms';
        sparks.appendChild(s);
      }
      later(() => { sparks.textContent = ''; }, 1600);
    }

    function ignite() {
      if (state !== 'idle') return;                     // blocks repeat clicks
      state = 'igniting';
      root.classList.remove('il-over-wick');
      root.classList.add('il-igniting');
      wick.disabled = true; alt.disabled = true;
      const p = wickPoint();                            // match touches the wick tip
      moved = true; target.x = p.x; target.y = p.y + 4; kick();
      later(() => {
        if (state !== 'igniting') return;
        root.classList.add('il-lit'); burst();
        title.textContent = o.text.lit; say.textContent = 'The lamp is lit.';
      }, T.flame);
      later(() => { if (state === 'igniting') { state = 'lit'; match.classList.add('il-gone'); } }, o.igniteMs);
      later(openCurtains, o.igniteMs + T.wait);         // curtains only after a successful ignition
      later(() => finish('watchdog'), o.watchdogMs);    // never stay blocked
    }

    function openCurtains() {
      if (state !== 'lit') return;
      state = 'opening';
      root.classList.add('il-open');
      say.textContent = 'Opening the landing page.';
      later(() => finish('complete'), T.open + T.tail);
    }

    function dismiss() {
      if (state === 'done' || state === 'skipping') return;
      state = 'skipping';
      root.classList.add('il-skipping');
      later(() => finish('skip'), reduce ? 0 : 350);
    }

    function finish(reason) {
      if (state === 'done') return;
      state = 'done';
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      ac.abort();                                       // removes every intro listener
      inerted.forEach((el) => el.removeAttribute('inert'));
      root.remove();
      html.classList.remove('il-lock'); html.style.removeProperty('--il-sbw');
      instance = null; delete window.LampIntro._active;
      doc.dispatchEvent(new CustomEvent('lampintro:complete', { detail: { reason } }));
    }

    try { root.focus({ preventScroll: true }); } catch (e) { /* ignore */ }

    const api = { light: ignite, skip: dismiss, get state() { return state; } };
    instance = { api };
    window.LampIntro._active = api;
    return api;
  }

  window.LampIntro = { start, _active: null };
  if (window.INTRO_LAMP_AUTOSTART !== false) {
    try { start(); } catch (e) {
      // Never leave the page blocked if setup fails.
      const el = document.getElementById('intro-lamp'); if (el) el.remove();
      document.documentElement.classList.remove('il-lock');
    }
  }
})();
