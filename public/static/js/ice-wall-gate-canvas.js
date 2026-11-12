/**
 * IceWallGate (Canvas 2D Low-Power / Reduced-Motion / No-WebGL Fallback)
 * Full 5-hit progressive breaking sequence + keyboard/touch support.
 */
(function (global) {
  'use strict';

  function createIceWallGate(opts) {
    const stage = opts.stage;
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
    const onReady = typeof opts.onReady === 'function' ? opts.onReady : function () {};
    const onHitProgress = typeof opts.onHitProgress === 'function' ? opts.onHitProgress : function () {};
    const onComplete = typeof opts.onComplete === 'function' ? opts.onComplete : function () {};
    const playSound = typeof opts.playSound === 'function' ? opts.playSound : function () {};

    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    stage.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    let rafId = 0;
    let disposed = false;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let startTs = performance.now();
    let hits = 0;
    let lockUntil = 0;
    let completed = false;
    let flickerPulse = 0;
    let fadeProgress = 0;

    const reduceMotion = Boolean(opts.reducedMotion);
    const cracks = [];
    const chips = [];

    const stars = Array.from({ length: 48 }, (_, idx) => ({
      x: ((idx * 197) % 997) / 997,
      y: ((idx * 313) % 613) / 1000,
      r: 0.7 + (idx % 3) * 0.45,
      phase: idx * 0.8
    }));
    const bubbles = Array.from({ length: 42 }, (_, idx) => ({
      x: 0.14 + (((idx * 251) % 720) / 1000),
      y: 0.14 + (((idx * 419) % 740) / 1000),
      r: 2 + (idx % 5) * 1.8,
      depth: 0.4 + (idx % 4) * 0.15
    }));
    const flakes = Array.from({ length: reduceMotion ? 0 : 40 }, (_, idx) => ({
      x: ((idx * 173) % 1000) / 1000,
      y: ((idx * 509) % 1000) / 1000,
      r: 1.2 + (idx % 3) * 0.9,
      vy: 0.045 + (idx % 5) * 0.018,
      drift: (idx % 2 === 0 ? 1 : -1) * (0.008 + (idx % 3) * 0.004)
    }));

    function getWallBounds() {
      const marginX = Math.max(18, width * 0.06);
      const marginY = Math.max(78, height * 0.14);
      const wallW = width - marginX * 2;
      const wallH = height - marginY - Math.max(66, height * 0.1);
      return { marginX, marginY, wallW, wallH };
    }

    function addCrackNetwork(nx, ny, hitLevel) {
      const branchCount = 6 + hitLevel * 3;
      const arms = [];
      for (let i = 0; i < branchCount; i++) {
        const baseAng = (i / branchCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
        const len = (0.08 + hitLevel * 0.055) * (0.7 + Math.random() * 0.6);
        const pts = [{ x: nx, y: ny }];
        let cx = nx;
        let cy = ny;
        const segs = 4;
        for (let s = 1; s <= segs; s++) {
          const jitter = (Math.random() - 0.5) * 0.35;
          cx += Math.cos(baseAng + jitter) * (len / segs);
          cy += Math.sin(baseAng + jitter) * (len / segs);
          pts.push({ x: cx, y: cy });
        }
        arms.push(pts);
      }
      cracks.push({ nx, ny, arms, hitLevel, born: performance.now() });

      if (!reduceMotion) {
        const count = hitLevel === 5 ? 36 : 12 + hitLevel * 4;
        for (let i = 0; i < count; i++) {
          const ang = Math.random() * Math.PI * 2;
          const spd = 80 + Math.random() * (hitLevel === 5 ? 420 : 220);
          chips.push({
            x: nx * width,
            y: ny * height,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd - 60,
            sz: 3 + Math.random() * 6,
            alpha: 1
          });
        }
      }
    }

    function triggerHit(clientX, clientY) {
      if (disposed || completed) return false;
      const now = performance.now();
      if (now < lockUntil) return false;

      const b = getWallBounds();
      let px = typeof clientX === 'number' ? clientX : width * 0.5;
      let py = typeof clientY === 'number' ? clientY : height * 0.52;

      // Only count clicks landing inside the wall bounds
      if (typeof clientX === 'number' && typeof clientY === 'number') {
        if (px < b.marginX || px > b.marginX + b.wallW || py < b.marginY || py > b.marginY + b.wallH) {
          return false;
        }
      }

      lockUntil = now + (reduceMotion ? 160 : 420);
      hits = Math.min(3, hits + 1);
      flickerPulse = 1;
      addCrackNetwork(px / Math.max(1, width), py / Math.max(1, height), hits === 3 ? 5 : hits * 2);
      playSound(hits);
      onHitProgress(hits);

      if (hits >= 3) {
        completed = true;
        fadeProgress = 0.001;
        setTimeout(() => {
          if (!disposed) onComplete('shatter');
        }, reduceMotion ? 320 : 1200);
      }
      return true;
    }

    function resize() {
      if (disposed) return;
      width = stage.clientWidth || window.innerWidth;
      height = stage.clientHeight || window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function drawFrame(now) {
      if (disposed || !ctx) return;
      const t = reduceMotion ? 0 : (now - startTs) * 0.001;
      flickerPulse = Math.max(0, flickerPulse - 0.035);
      if (fadeProgress > 0) fadeProgress = Math.min(1, fadeProgress + 0.022);

      // Night sky background
      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, '#091120');
      sky.addColorStop(0.55, '#101D35');
      sky.addColorStop(1, '#1A3458');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const a = 0.35 + 0.35 * Math.sin(t * 1.4 + s.phase);
        ctx.fillStyle = `rgba(245, 250, 255, ${a.toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(s.x * width, s.y * height * 0.52, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      const glowAlpha = Math.min(1, 0.7 + hits * 0.08 + flickerPulse * 0.25);
      const portalGlow = ctx.createRadialGradient(
        width * 0.5,
        height * 0.52,
        Math.min(width, height) * 0.04,
        width * 0.5,
        height * 0.52,
        Math.max(width, height) * (0.44 + hits * 0.05)
      );
      portalGlow.addColorStop(0, `rgba(255, 250, 236, ${glowAlpha.toFixed(2)})`);
      portalGlow.addColorStop(0.28, 'rgba(185, 221, 245, 0.44)');
      portalGlow.addColorStop(0.65, 'rgba(42, 102, 54, 0.16)');
      portalGlow.addColorStop(1, 'rgba(16, 29, 53, 0)');
      ctx.fillStyle = portalGlow;
      ctx.fillRect(0, 0, width, height);

      const { marginX, marginY, wallW, wallH } = getWallBounds();
      const wallAlpha = 1 - fadeProgress;

      if (wallAlpha > 0.02) {
        ctx.save();
        ctx.globalAlpha = wallAlpha;

        const iceGrad = ctx.createLinearGradient(0, marginY, 0, marginY + wallH);
        iceGrad.addColorStop(0, 'rgba(245, 250, 255, 0.90)');
        iceGrad.addColorStop(0.38, 'rgba(185, 221, 245, 0.80)');
        iceGrad.addColorStop(0.82, 'rgba(84, 150, 206, 0.86)');
        iceGrad.addColorStop(1, 'rgba(26, 60, 106, 0.94)');

        ctx.beginPath();
        ctx.moveTo(marginX + 14, marginY + 10);
        ctx.lineTo(marginX + wallW * 0.25, marginY);
        ctx.lineTo(marginX + wallW * 0.52, marginY + 12);
        ctx.lineTo(marginX + wallW * 0.78, marginY + 2);
        ctx.lineTo(marginX + wallW - 10, marginY + 14);
        ctx.lineTo(marginX + wallW, marginY + wallH);
        ctx.lineTo(marginX, marginY + wallH);
        ctx.closePath();
        ctx.fillStyle = iceGrad;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(245, 250, 255, 0.55)';
        ctx.stroke();

        ctx.clip();
        for (let i = 0; i < bubbles.length; i++) {
          const b = bubbles[i];
          ctx.fillStyle = `rgba(245, 250, 255, ${(0.22 + b.depth * 0.35).toFixed(2)})`;
          ctx.beginPath();
          ctx.ellipse(marginX + b.x * wallW, marginY + b.y * wallH, b.r * 0.65, b.r * 1.15, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        // Progressive cracks radiating from impact points
        for (let cIdx = 0; cIdx < cracks.length; cIdx++) {
          const cr = cracks[cIdx];
          const grow = reduceMotion ? 1 : Math.min(1, (now - cr.born) / 380);
          ctx.strokeStyle = cr.hitLevel >= 3 ? 'rgba(255, 250, 236, 0.92)' : 'rgba(245, 250, 255, 0.85)';
          ctx.lineWidth = 1.4 + cr.hitLevel * 0.55;
          for (let aIdx = 0; aIdx < cr.arms.length; aIdx++) {
            const pts = cr.arms[aIdx];
            ctx.beginPath();
            ctx.moveTo(pts[0].x * width, pts[0].y * height);
            const limit = Math.max(1, Math.floor((pts.length - 1) * grow));
            for (let p = 1; p <= limit; p++) {
              ctx.lineTo(pts[p].x * width, pts[p].y * height);
            }
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      // Flying ice chips
      for (let i = chips.length - 1; i >= 0; i--) {
        const ch = chips[i];
        ch.vy += 12;
        ch.x += ch.vx * 0.016;
        ch.y += ch.vy * 0.016;
        ch.alpha -= 0.024;
        if (ch.alpha <= 0) {
          chips.splice(i, 1);
          continue;
        }
        ctx.fillStyle = `rgba(245, 250, 255, ${ch.alpha.toFixed(2)})`;
        ctx.fillRect(ch.x, ch.y, ch.sz, ch.sz * 0.7);
      }

      for (let i = 0; i < flakes.length; i++) {
        const f = flakes[i];
        const fx = ((f.x + Math.sin(t * 0.7 + i) * 0.015 + t * f.drift + 10) % 1) * width;
        const fy = ((f.y + t * f.vy) % 1) * height;
        ctx.fillStyle = 'rgba(245, 250, 255, 0.72)';
        ctx.beginPath();
        ctx.arc(fx, fy, f.r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reduceMotion || chips.length > 0 || fadeProgress > 0) {
        rafId = requestAnimationFrame(drawFrame);
      } else {
        rafId = 0;
      }
    }

    function ensureAnimating() {
      if (!rafId && !disposed) {
        rafId = requestAnimationFrame(drawFrame);
      }
    }

    resize();
    window.addEventListener('resize', resize);
    onProgress(1);
    drawFrame(performance.now());
    onReady();

    return {
      mode: 'canvas',
      setSoundEnabled: function () {},
      triggerHit: function (x, y) {
        const ok = triggerHit(x, y);
        if (ok) ensureAnimating();
        return ok;
      },
      dispose: function () {
        if (disposed) return;
        disposed = true;
        cancelAnimationFrame(rafId);
        window.removeEventListener('resize', resize);
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      }
    };
  }

  global.IceWallGate = { create: createIceWallGate };
})(window);
