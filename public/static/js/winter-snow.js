/**
 * Corporate Winter Snowfall Animation
 * HiDPI canvas rendering soft icy orbs, fine depth dust, and rotating 6-point snow crystals
 * visible cleanly across both the hero forest backdrop and bright ice-white sections.
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

  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeCanvas();

  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(resizeCanvas, 150);
  });

  // Gentle, low-density snowfall (subtle ambient motion & low CPU/GPU usage)
  const count = Math.min(Math.max(Math.floor(width / 42), 18), 34);
  const particles = [];

  for (let i = 0; i < count; i++) {
    const roll = Math.random();
    const kind = roll < 0.20 ? 'crystal' : roll < 0.70 ? 'orb' : 'dust';
    const radius =
      kind === 'crystal'
        ? Math.random() * 2.4 + 3.8
        : kind === 'orb'
          ? Math.random() * 1.8 + 2.0
          : Math.random() * 0.9 + 1.0;

    particles.push({
      kind,
      x: Math.random() * width,
      y: Math.random() * height,
      radius,
      alpha: kind === 'crystal' ? Math.random() * 0.16 + 0.42 : kind === 'orb' ? Math.random() * 0.14 + 0.36 : Math.random() * 0.12 + 0.28,
      speedY: kind === 'dust' ? Math.random() * 0.24 + 0.18 : Math.random() * 0.36 + 0.24,
      speedX: Math.random() * 0.26 - 0.10,
      swayAmp: kind === 'crystal' ? Math.random() * 0.32 + 0.16 : Math.random() * 0.22 + 0.10,
      swayOffset: Math.random() * Math.PI * 2,
      swaySpeed: Math.random() * 0.012 + 0.005,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.008,
    });
  }

  let rafId = null;

  function drawCrystal(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = p.alpha;

    ctx.strokeStyle = 'rgba(116, 174, 224, 0.72)';
    ctx.lineWidth = Math.max(1.0, p.radius * 0.16);
    ctx.lineCap = 'round';

    const r = p.radius;
    const branch = r * 0.42;
    const branchLen = r * 0.32;

    for (let k = 0; k < 6; k++) {
      ctx.rotate(Math.PI / 3);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -r);
      ctx.moveTo(0, -branch);
      ctx.lineTo(-branchLen * 0.7, -branch - branchLen * 0.7);
      ctx.moveTo(0, -branch);
      ctx.lineTo(branchLen * 0.7, -branch - branchLen * 0.7);
      ctx.stroke();
    }

    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(0.8, r * 0.2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawOrb(p) {
    ctx.fillStyle = `rgba(147, 197, 240, ${(p.alpha * 0.55).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius * 1.25, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, p.alpha * 1.15).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius * 0.65, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawDust(p) {
    ctx.fillStyle = `rgba(130, 184, 232, ${p.alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function render() {
    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.swayOffset += p.swaySpeed;
      p.x += Math.sin(p.swayOffset) * p.swayAmp + p.speedX;
      p.y += p.speedY;
      p.rot += p.rotSpeed;

      const pad = p.radius * 2 + 8;
      if (p.y > height + pad) {
        p.y = -pad;
        p.x = Math.random() * width;
      }
      if (p.x > width + pad) p.x = -pad;
      if (p.x < -pad) p.x = width + pad;

      if (p.kind === 'crystal') drawCrystal(p);
      else if (p.kind === 'orb') drawOrb(p);
      else drawDust(p);
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
