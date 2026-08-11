/**
 * confetti.js — a small canvas particle burst for the leaderboard.
 * Self-contained, no library, cleans itself up when the last piece lands.
 */

const COLORS = ['#29d8f0', '#2dd4bf', '#3ddc97', '#ffc247', '#a78bfa', '#ff3757', '#ffffff'];

let canvas = null;
let ctx = null;
let pieces = [];
let raf = null;

function ensureCanvas() {
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.id = 'confetti-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
  return canvas;
}

function resize() {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function spawn(count, originX, originY) {
  const w = window.innerWidth;
  for (let i = 0; i < count; i += 1) {
    pieces.push({
      x: originX ?? Math.random() * w,
      y: originY ?? -20 - Math.random() * 120,
      vx: (Math.random() - 0.5) * 6,
      vy: Math.random() * 3 + 2,
      size: Math.random() * 8 + 4,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.28,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      life: 1,
      shape: Math.random() < 0.28 ? 'circle' : 'rect',
    });
  }
}

function frame() {
  const h = window.innerHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  pieces = pieces.filter((p) => {
    p.vy += 0.12;              // gravity
    p.vx *= 0.995;             // drag
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    if (p.y > h * 0.72) p.life -= 0.02;
    if (p.life <= 0 || p.y > h + 60) return false;

    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    if (p.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
    }
    ctx.restore();
    return true;
  });

  if (pieces.length) {
    raf = requestAnimationFrame(frame);
  } else {
    cancelAnimationFrame(raf);
    raf = null;
    canvas?.remove();
    window.removeEventListener('resize', resize);
    canvas = null;
    ctx = null;
  }
}

/** Rain confetti from the top. Call again to top it up. */
export function celebrate({ count = 140, burstFrom = null } = {}) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  ensureCanvas();
  if (burstFrom) spawn(count, burstFrom.x, burstFrom.y);
  else spawn(count);
  if (!raf) raf = requestAnimationFrame(frame);
}

/** Three staggered waves — for the moment the winner is announced. */
export function celebrateBig() {
  celebrate({ count: 120 });
  setTimeout(() => celebrate({ count: 90 }), 380);
  setTimeout(() => celebrate({ count: 90 }), 820);
}
