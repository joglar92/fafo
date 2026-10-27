// Balón de fútbol de fondo (cinemático) — reutilizable por cualquier página.
(() => {
  'use strict';
  const canvas = document.getElementById('ballbg');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function pentagon(c, x, y, r, rot) {
    c.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = rot + (i / 5) * Math.PI * 2 - Math.PI / 2;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      i === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
    }
    c.closePath();
  }

  function draw(w, h, t) {
    const cx = w * 0.82, cy = h * 0.24;
    const r = Math.min(w, h) * 0.30;
    const rot = t * 0.05;

    const glow = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 1.6);
    glow.addColorStop(0, 'rgba(63,185,80,0.16)');
    glow.addColorStop(0.5, 'rgba(46,160,67,0.08)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);

    const base = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    base.addColorStop(0, '#f4f7f5');
    base.addColorStop(0.45, '#dfe6e2');
    base.addColorStop(0.8, '#9fb0ab');
    base.addColorStop(1, '#5c6f66');
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

    const pr = r * 0.34;
    ctx.fillStyle = '#10151a';
    pentagon(ctx, 0, 0, pr, 0); ctx.fill();
    const d = r * 0.62;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + Math.PI / 2;
      pentagon(ctx, Math.cos(a) * d, Math.sin(a) * d, pr * 0.72, Math.PI + a); ctx.fill();
    }
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      pentagon(ctx, Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92, pr * 0.55, a); ctx.fill();
    }

    const shade = ctx.createRadialGradient(r * 0.4, r * 0.4, r * 0.2, 0, 0, r);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(0.7, 'rgba(0,0,0,0.12)');
    shade.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = shade;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  let w = 0, h = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  }
  window.addEventListener('resize', resize);
  resize();

  const start = performance.now();
  (function loop(now) {
    const t = (now - start) / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    draw(w, h, t);
    requestAnimationFrame(loop);
  })();
})();
