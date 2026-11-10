/**
 * Subtle Corporate Snowfall Animation
 * High-performance, lightweight background canvas with soft winter particles.
 */
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.getElementById('snowCanvas');
  if (!canvas || reduce) return;

  const ctx = canvas.getContext('2d');
  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);

  // Resize handler
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    }, 150);
  });

  // Particle configuration - subtle, calm, corporate
  const count = Math.min(Math.floor(width / 28), 55);
  const particles = [];
  const colors = [
    'rgba(185, 221, 245, 0.45)', // Winter Blue
    'rgba(220, 238, 255, 0.55)', // Frost Blue
    'rgba(245, 250, 255, 0.65)', // Ice White
    'rgba(216, 226, 236, 0.40)'  // Soft Silver
  ];

  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: Math.random() * 1.8 + 0.8,
      color: colors[Math.floor(Math.random() * colors.length)],
      speedY: Math.random() * 0.55 + 0.25,
      speedX: Math.random() * 0.4 - 0.2,
      swayOffset: Math.random() * Math.PI * 2,
      swaySpeed: Math.random() * 0.015 + 0.005
    });
  }

  let isVisible = true;
  document.addEventListener('visibilitychange', () => {
    isVisible = !document.hidden;
  });

  function render() {
    if (isVisible) {
      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Subtle harmonic sway
        p.swayOffset += p.swaySpeed;
        p.x += Math.sin(p.swayOffset) * 0.35 + p.speedX;
        p.y += p.speedY;

        // Wrap around boundaries
        if (p.y > height + 5) {
          p.y = -5;
          p.x = Math.random() * width;
        }
        if (p.x > width + 5) p.x = -5;
        if (p.x < -5) p.x = width + 5;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      }
    }
    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
})();
