/**
 * Winter Season Snowfall Animation
 * HiDPI multi-layer canvas rendering dendritic 6-point snow crystals, frosted bokeh orbs,
 * twinkling frost dust, and organic winter wind gusts across dark hero & light sections.
 */
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.getElementById('snowCanvas');
  if (!canvas || reduce) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let dpr = 1;
  const particles = [];

  function targetFlakeCount() {
    // Lush winter capacity scaled cleanly to viewport area (65 on mobile up to 115 on desktop)
    return Math.min(Math.max(Math.floor((width * height) / 14500), 65), 115);
  }

  function createParticle(randomY = false) {
    const roll = Math.random();
    const kind = roll < 0.22 ? 'crystal' : roll < 0.70 ? 'orb' : 'dust';
    const depth = kind === 'crystal' ? 2 : kind === 'orb' ? (Math.random() < 0.55 ? 1 : 2) : 0;

    const radius =
      kind === 'crystal'
        ? Math.random() * 3.4 + 5.2
        : kind === 'orb'
          ? Math.random() * 2.5 + 2.3
          : Math.random() * 1.1 + 1.05;

    const baseAlpha =
      kind === 'crystal'
        ? Math.random() * 0.22 + 0.58
        : kind === 'orb'
          ? Math.random() * 0.20 + 0.48
          : Math.random() * 0.20 + 0.34;

    const depthScale = depth === 2 ? 1.25 : depth === 1 ? 0.85 : 0.55;

    return {
      kind,
      depth,
      x: Math.random() * width,
      y: randomY ? Math.random() * height : -(radius * 2 + Math.random() * 40),
      radius,
      baseAlpha,
      twinklePhase: Math.random() * Math.PI * 2,
      twinkleSpeed: Math.random() * 0.025 + 0.012,
      speedY: (Math.random() * 0.45 + 0.38) * depthScale,
      speedX: (Math.random() * 0.28 - 0.06) * depthScale,
      swayAmp: (kind === 'crystal' ? Math.random() * 0.36 + 0.18 : Math.random() * 0.28 + 0.12) * depthScale,
      swayOffset: Math.random() * Math.PI * 2,
      swaySpeed: Math.random() * 0.014 + 0.006,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.012
    };
  }

  function syncPool() {
    const desired = targetFlakeCount();
    while (particles.length < desired) {
      particles.push(createParticle(true));
    }
    if (particles.length > desired) {
      particles.length = desired;
    }
  }

  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    syncPool();
  }
  resizeCanvas();

  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(resizeCanvas, 150);
  });

  function drawCrystal(p, alpha) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = alpha;

    const r = p.radius;
    const midBranch = r * 0.48;
    const tipBranch = r * 0.78;

    // Soft cool glow rim so crystal stays crisp against bright ice surfaces
    ctx.strokeStyle = 'rgba(108, 174, 228, 0.86)';
    ctx.lineWidth = Math.max(1.15, r * 0.16);
    ctx.lineCap = 'round';

    for (let k = 0; k < 6; k++) {
      ctx.rotate(Math.PI / 3);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -r);

      // Inner dendritic V-branches
      ctx.moveTo(0, -midBranch);
      ctx.lineTo(-r * 0.28, -midBranch - r * 0.24);
      ctx.moveTo(0, -midBranch);
      ctx.lineTo(r * 0.28, -midBranch - r * 0.24);

      // Outer facet tips
      ctx.moveTo(0, -tipBranch);
      ctx.lineTo(-r * 0.16, -tipBranch - r * 0.14);
      ctx.moveTo(0, -tipBranch);
      ctx.lineTo(r * 0.16, -tipBranch - r * 0.14);
      ctx.stroke();
    }

    // Crisp luminous white core
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1.0, r * 0.22), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawOrb(p, alpha) {
    // Soft winter aura + radiant frosted core
    ctx.fillStyle = `rgba(147, 197, 240, ${(alpha * 0.48).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius * 1.45, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.95, alpha * 1.18).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius * 0.72, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawDust(p, alpha) {
    ctx.fillStyle = `rgba(205, 232, 252, ${alpha.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  let rafId = null;

  function render(now = performance.now()) {
    ctx.clearRect(0, 0, width, height);

    // Subtle evolving winter breeze gust across all depth planes
    const windBase = Math.sin(now * 0.00045) * 0.30 + Math.sin(now * 0.0011) * 0.12;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.swayOffset += p.swaySpeed;
      p.twinklePhase += p.twinkleSpeed;
      p.rot += p.rotSpeed;

      const depthWind = windBase * (p.depth === 2 ? 1.15 : p.depth === 1 ? 0.78 : 0.42);
      p.x += Math.sin(p.swayOffset) * p.swayAmp + p.speedX + depthWind;
      p.y += p.speedY;

      const pad = p.radius * 2 + 12;
      if (p.y > height + pad) {
        p.y = -pad;
        p.x = Math.random() * width;
      }
      if (p.x > width + pad) p.x = -pad;
      if (p.x < -pad) p.x = width + pad;

      const twinkle = 0.84 + 0.16 * Math.sin(p.twinklePhase);
      const alpha = Math.min(0.95, p.baseAlpha * twinkle);

      if (p.kind === 'crystal') drawCrystal(p, alpha);
      else if (p.kind === 'orb') drawOrb(p, alpha);
      else drawDust(p, alpha);
    }

    rafId = requestAnimationFrame(render);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    } else if (rafId === null) {
      rafId = requestAnimationFrame(render);
    }
  });

  if (!document.hidden) {
    rafId = requestAnimationFrame(render);
  }
})();
