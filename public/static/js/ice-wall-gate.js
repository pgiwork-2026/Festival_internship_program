/**
 * PGI Winter Internship Portal — Ice Wall Entry Gate Controller
 * Handles first-visit sessionStorage gating on / or /index.html, referral preservation,
 * ENABLE_ICE_GATE flag, lazy 3D vs Canvas 2D fallback selection, 5-hit input (left/right click,
 * touch, Enter/Space), crystal HUD updates, optional CC0 audio, and 1.2s portal cross-fade.
 */
(function () {
  'use strict';

  const SEEN_KEY = 'pgi_ice_gate_seen';
  const docEl = document.documentElement;
  const pathName = String(window.location.pathname || '/').toLowerCase();
  const isEntryRoute = pathName === '/' || pathName === '/index.html';
  if (!isEntryRoute) return;

  const params = new URLSearchParams(window.location.search);
  const forcePreview = params.get('icegate') === '1' || params.get('gate') === 'preview';
  if (params.get('gate') === '0') return;
  if (!forcePreview && sessionStorage.getItem(SEEN_KEY) === '1') return;

  // Preserve referral tracking seamlessly across gate interactions
  const refParam = params.get('ref');
  if (refParam) {
    const cleanRef = refParam.trim().slice(0, 50);
    if (cleanRef) {
      sessionStorage.setItem('pgi_referral', cleanRef);
      localStorage.setItem('pgi_referral', cleanRef);
    }
  }

  function hasWebGL() {
    try {
      const c = document.createElement('canvas');
      return Boolean(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch {
      return false;
    }
  }

  function isLowPowerDevice() {
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;
    return cores <= 2 || mem <= 2;
  }

  function buildCrystalSvg(idx) {
    return (
      `<svg class="pgi-crystal-icon" data-crystal="${idx}" viewBox="0 0 24 24" aria-hidden="true">` +
      `<polygon class="pgi-crystal-core" points="12,2 19,8 17,18 12,22 7,18 5,8" />` +
      `<polyline points="12,2 12,22" stroke="currentColor" stroke-width="1" fill="none" opacity="0.55" />` +
      `<polyline points="5,8 19,8" stroke="currentColor" stroke-width="1" fill="none" opacity="0.45" />` +
      `</svg>`
    );
  }

  let rootEl = null;
  let activeGate = null;
  let closed = false;
  let soundOn = false;
  let audioBank = null;

  function loadAudioBank() {
    if (audioBank) return audioBank;
    const mk = src => {
      const a = new Audio(src);
      a.preload = 'auto';
      return a;
    };
    audioBank = {
      thud: mk('/static/audio/impact-thud.mp3'),
      crack: mk('/static/audio/ice-crack.mp3'),
      creak: mk('/static/audio/ice-creak.mp3'),
      shatter: mk('/static/audio/ice-shatter.mp3')
    };
    return audioBank;
  }

  function playHitSound(hitLevel) {
    if (!soundOn) return;
    const bank = loadAudioBank();
    const fire = (baseAudio, volume, rate) => {
      if (!baseAudio) return;
      try {
        const inst = baseAudio.cloneNode();
        inst.volume = Math.min(1, Math.max(0, volume));
        if (rate) inst.playbackRate = rate;
        const p = inst.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {}
    };

    fire(bank.thud, 0.72, 0.95 + hitLevel * 0.06);
    if (hitLevel >= 1 && hitLevel <= 2) {
      fire(bank.crack, 0.56 + hitLevel * 0.18, 0.94 + hitLevel * 0.08);
    }
    if (hitLevel === 2) {
      fire(bank.creak, 0.52, 0.92);
    }
    if (hitLevel >= 3) {
      fire(bank.shatter, 0.88, 1.0);
    }
  }

  function updateCrystals(hits) {
    if (!rootEl) return;
    const group = rootEl.querySelector('.pgi-ice-crystals');
    if (group) {
      group.setAttribute('aria-label', `${hits} of 3 hits on the ice wall`);
    }
    rootEl.querySelectorAll('.pgi-crystal-icon').forEach(el => {
      const n = Number(el.getAttribute('data-crystal') || 0);
      el.classList.toggle('is-filled', n <= hits);
    });
    const sr = rootEl.querySelector('#pgiGateSrStatus');
    if (sr) {
      sr.textContent = hits >= 3
        ? 'Ice wall shattered. Entering PGI Portal.'
        : `Hit ${hits} of 3. ${3 - hits} remaining.`;
    }
  }

  function closeGate(reason) {
    if (closed) return;
    closed = true;
    sessionStorage.setItem(SEEN_KEY, '1');
    docEl.classList.remove('pgi-gate-lock');
    window.removeEventListener('keydown', onGateKey);

    const isShatter = reason === 'shatter';
    const fadeDuration = isShatter ? 1200 : 560;

    if (rootEl) {
      if (isShatter) rootEl.classList.add('is-shattering');
      rootEl.classList.add('is-exiting');
      setTimeout(() => {
        if (activeGate && typeof activeGate.dispose === 'function') {
          try { activeGate.dispose(); } catch {}
          activeGate = null;
        }
        if (rootEl && rootEl.parentNode) {
          rootEl.parentNode.removeChild(rootEl);
        }
        rootEl = null;
      }, fadeDuration);
    } else if (activeGate && typeof activeGate.dispose === 'function') {
      try { activeGate.dispose(); } catch {}
      activeGate = null;
    }

    document.dispatchEvent(new CustomEvent('pgi:icegate:close', { detail: { reason: reason || 'complete' } }));
  }

  function onGateKey(e) {
    if (closed) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeGate('escape');
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ' || e.code === 'Space') && !e.repeat) {
      if (e.target && e.target.closest && e.target.closest('button, a')) return;
      e.preventDefault();
      if (activeGate && typeof activeGate.triggerHit === 'function') {
        activeGate.triggerHit(null, null, { keyboard: true });
      }
    }
  }

  async function initGate() {
    const cfgPromise = (async () => {
      try {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const tid = ctrl ? setTimeout(() => ctrl.abort(), 1800) : 0;
        const res = await fetch('/api/config', ctrl ? { signal: ctrl.signal } : undefined);
        if (tid) clearTimeout(tid);
        if (res.ok) {
          const cfg = await res.json();
          if (cfg && cfg.enableIceGate === false && !forcePreview) return false;
        }
      } catch {}
      return true;
    })();
    cfgPromise.then(ok => { if (!ok && !closed) closeGate('disabled'); });

    rootEl = document.createElement('div');
    rootEl.id = 'pgiIceGate';
    rootEl.className = 'pgi-ice-gate';
    rootEl.setAttribute('role', 'region');
    rootEl.setAttribute('aria-label', 'PGI Portal winter ice wall entrance');
    rootEl.innerHTML =
      `<div class="pgi-ice-progress" id="pgiGateProgress"><div class="pgi-ice-progress-fill" id="pgiGateProgressFill"></div></div>` +
      `<div class="pgi-ice-stage" id="pgiGateStage"></div>` +
      `<div class="pgi-ice-hud">` +
      `  <div class="pgi-ice-top">` +
      `    <div class="pgi-ice-brand-wrap">` +
      `      <span class="pgi-ice-brand"><span class="pgi-ice-brand-dot" aria-hidden="true"></span>Plant Green Inertia</span>` +
      `      <h1 class="pgi-ice-title">PGI Portal</h1>` +
      `      <p class="pgi-ice-hint">Break the wall to enter</p>` +
      `    </div>` +
      `    <div class="pgi-ice-crystals" role="status" aria-label="0 of 3 hits on the ice wall">` +
      `      ${[1, 2, 3].map(buildCrystalSvg).join('')}` +
      `    </div>` +
      `  </div>` +
      `  <div class="pgi-ice-bottom">` +
      `    <button type="button" class="pgi-ice-btn" id="pgiGateSoundBtn" aria-pressed="false" aria-label="Toggle sound effects (currently off)">Sound: Off</button>` +
      `    <button type="button" class="pgi-ice-btn pgi-ice-skip" id="pgiGateSkipBtn" aria-label="Skip the ice wall gate and enter PGI Portal">Skip</button>` +
      `  </div>` +
      `</div>` +
      `<span class="pgi-sr-only" id="pgiGateSrStatus" aria-live="polite"></span>`;

    document.body.insertBefore(rootEl, document.body.firstChild);
    docEl.classList.add('pgi-gate-lock');
    window.addEventListener('keydown', onGateKey);

    const stage = rootEl.querySelector('#pgiGateStage');
    const progBar = rootEl.querySelector('#pgiGateProgress');
    const progFill = rootEl.querySelector('#pgiGateProgressFill');
    const skipBtn = rootEl.querySelector('#pgiGateSkipBtn');
    const soundBtn = rootEl.querySelector('#pgiGateSoundBtn');

    // Support both left-click, right-click, and touch tap on the ice wall stage
    stage.addEventListener('contextmenu', e => {
      e.preventDefault();
    });
    stage.addEventListener('pointerdown', e => {
      if (closed || !activeGate) return;
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      if (typeof activeGate.triggerHit === 'function') {
        activeGate.triggerHit(e.clientX, e.clientY, { pointerType: e.pointerType });
      }
    });

    skipBtn.addEventListener('click', () => closeGate('skip'));
    soundBtn.addEventListener('click', () => {
      soundOn = !soundOn;
      soundBtn.setAttribute('aria-pressed', String(soundOn));
      soundBtn.setAttribute('aria-label', `Toggle sound effects (currently ${soundOn ? 'on' : 'off'})`);
      soundBtn.textContent = soundOn ? 'Sound: On' : 'Sound: Off';
      if (soundOn) loadAudioBank();
      if (activeGate && typeof activeGate.setSoundEnabled === 'function') {
        activeGate.setSoundEnabled(soundOn);
      }
    });

    const onProgress = p => {
      if (!progFill) return;
      const pct = Math.max(8, Math.min(100, Math.round(Number(p || 0) * 100)));
      progFill.style.width = pct + '%';
    };
    const onReady = () => {
      if (progFill) progFill.style.width = '100%';
      if (progBar) progBar.classList.add('is-done');
    };

    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const use3D = !reduceMotion && hasWebGL() && !isLowPowerDevice() && window.IceWallGate3D;

    if (use3D) {
      let backdropFallback = null;
      if (window.IceWallGate) {
        backdropFallback = window.IceWallGate.create({
          stage,
          reducedMotion: true,
          onProgress: function () {},
          onReady: function () {},
          onHitProgress: updateCrystals,
          onComplete: closeGate,
          playSound: playHitSound
        });
      }
      try {
        rootEl.classList.add('is-3d-active');
        activeGate = await window.IceWallGate3D.create({
          stage,
          reducedMotion: reduceMotion,
          onProgress,
          onHitProgress: updateCrystals,
          onComplete: closeGate,
          playSound: playHitSound,
          onReady: () => {
            if (backdropFallback && typeof backdropFallback.dispose === 'function') {
              backdropFallback.dispose();
              backdropFallback = null;
            }
            onReady();
          }
        });
        return;
      } catch (err) {
        console.warn('IceWallGate3D fell back to Canvas 2D:', err && (err.message || err.type || err), err?.target?.src || err?.target?.responseURL || '');
        rootEl.classList.remove('is-3d-active');
        Array.from(stage.querySelectorAll('canvas')).forEach(cv => {
          if (!backdropFallback || cv.style.opacity === '0') cv.remove();
        });
        if (backdropFallback) {
          rootEl.classList.add('is-canvas-fallback');
          activeGate = backdropFallback;
          onReady();
          return;
        }
      }
    }

    if (window.IceWallGate) {
      rootEl.classList.add('is-canvas-fallback');
      activeGate = window.IceWallGate.create({
        stage,
        reducedMotion: reduceMotion,
        onProgress,
        onReady,
        onHitProgress: updateCrystals,
        onComplete: closeGate,
        playSound: playHitSound
      });
    } else {
      closeGate('unavailable');
    }
  }

  if (document.body) {
    initGate();
  } else {
    document.addEventListener('DOMContentLoaded', initGate);
  }
})();
