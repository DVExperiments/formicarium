// Pre-renders the static ground (soil, litter, pebbles, stones) into an offscreen canvas.
import { RNG } from '../sim/rng.js';

export function renderTerrain(world, scale = 1.5) {
  const W = world.W, H = world.H;
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
  const ctx = cv.getContext('2d');
  ctx.scale(scale, scale);
  const r = new RNG(world.seedNum ^ 0x5eed);
  const TAU = Math.PI * 2;

  // base soil
  ctx.fillStyle = '#6e5238';
  ctx.fillRect(0, 0, W, H);
  // large soft blotches of lighter/darker earth
  for (let i = 0; i < 260; i++) {
    const x = r.range(-50, W + 50), y = r.range(-50, H + 50), rad = r.range(40, 160);
    const light = r.next() < 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, light ? 'rgba(150, 118, 80, 0.16)' : 'rgba(58, 40, 26, 0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // mossy patches
  for (let i = 0; i < 40; i++) {
    const x = r.range(0, W), y = r.range(0, H), rad = r.range(30, 90);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(96, 112, 56, 0.22)');
    g.addColorStop(1, 'rgba(96, 112, 56, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // fine grain
  for (let i = 0; i < 26000; i++) {
    const x = r.range(0, W), y = r.range(0, H);
    const v = r.next();
    ctx.fillStyle = v < 0.5 ? `rgba(40, 28, 18, ${r.range(0.15, 0.4)})` : `rgba(175, 145, 105, ${r.range(0.1, 0.3)})`;
    ctx.fillRect(x, y, r.range(0.6, 1.6), r.range(0.6, 1.6));
  }
  // pebbles and grit
  for (let i = 0; i < 1600; i++) {
    const x = r.range(0, W), y = r.range(0, H), s = r.range(0.8, 2.4);
    const tone = r.int(105, 160);
    ctx.fillStyle = `rgba(${tone}, ${tone - 14}, ${tone - 34}, 0.7)`;
    ctx.beginPath(); ctx.ellipse(x, y, s, s * r.range(0.6, 0.9), r.angle(), 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.ellipse(x - s * 0.3, y - s * 0.3, s * 0.4, s * 0.25, 0, 0, TAU); ctx.fill();
  }
  // leaf litter and twigs
  for (let i = 0; i < 520; i++) {
    const x = r.range(0, W), y = r.range(0, H), s = r.range(3, 8), a = r.angle();
    const c = r.pick(['#8a6a3a', '#7a5a30', '#9a7a48', '#6a5a2c', '#7c6a38']);
    ctx.fillStyle = c; ctx.globalAlpha = r.range(0.45, 0.8);
    ctx.beginPath(); ctx.ellipse(x, y, s, s * 0.45, a, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(50,35,20,0.5)'; ctx.lineWidth = 0.4;
    ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * s, y - Math.sin(a) * s); ctx.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 70; i++) {
    const x = r.range(0, W), y = r.range(0, H), len = r.range(10, 34), a = r.angle();
    ctx.strokeStyle = r.pick(['#5a4128', '#4d3822', '#6a4c2e']); ctx.lineWidth = r.range(1, 2.2); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a + 0.2) * len * 0.5, y + Math.sin(a + 0.2) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
  }
  // sparse short grass blades
  for (let i = 0; i < 900; i++) {
    const x = r.range(0, W), y = r.range(0, H), len = r.range(3, 8), a = r.angle();
    ctx.strokeStyle = r.pick(['rgba(120,140,70,0.6)', 'rgba(100,125,60,0.55)', 'rgba(140,155,85,0.5)']); ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
  }
  // stones with shading
  for (const s of world.stones) {
    const pts = s.shape.map((k, i) => {
      const a = s.rot + (i / s.shape.length) * TAU;
      return [s.x + Math.cos(a) * s.r * k, s.y + Math.sin(a) * s.r * k * 0.92];
    });
    const path = () => {
      ctx.beginPath();
      for (let i = 0; i <= pts.length; i++) {
        const p = pts[i % pts.length], q = pts[(i + 1) % pts.length];
        const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
        i === 0 ? ctx.moveTo(mx, my) : ctx.quadraticCurveTo(p[0], p[1], mx, my);
      }
      ctx.closePath();
    };
    ctx.save();
    ctx.translate(s.r * 0.18, s.r * 0.24);
    ctx.fillStyle = 'rgba(25, 18, 10, 0.4)';
    path(); ctx.fill();
    ctx.restore();
    const base = Math.round(128 * s.tone);
    const g = ctx.createRadialGradient(s.x - s.r * 0.4, s.y - s.r * 0.45, s.r * 0.1, s.x, s.y, s.r * 1.1);
    g.addColorStop(0, `rgb(${base + 50}, ${base + 44}, ${base + 32})`);
    g.addColorStop(0.7, `rgb(${base}, ${base - 6}, ${base - 18})`);
    g.addColorStop(1, `rgb(${base - 40}, ${base - 46}, ${base - 54})`);
    ctx.fillStyle = g;
    path(); ctx.fill();
    // speckles
    for (let i = 0; i < s.r * 1.5; i++) {
      const a = r.angle(), d = Math.sqrt(r.next()) * s.r * 0.8;
      ctx.fillStyle = r.next() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)';
      ctx.fillRect(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, 1, 1);
    }
  }
  return { canvas: cv, scale };
}

// Static underground soil texture for the nest cross-section.
export function renderSoil(seed, width = 700, height = 560) {
  const cv = document.createElement('canvas');
  cv.width = width * 1.5; cv.height = height * 1.5;
  const ctx = cv.getContext('2d');
  ctx.scale(1.5, 1.5);
  const r = new RNG(seed ^ 0xd17e);
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, '#5b4129');
  g.addColorStop(0.35, '#4f3923');
  g.addColorStop(0.75, '#443020');
  g.addColorStop(1, '#3a2a1c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  // strata
  for (let i = 0; i < 9; i++) {
    const y0 = 30 + i * 60 + r.range(-12, 12);
    ctx.strokeStyle = `rgba(${r.next() < 0.5 ? '25,15,8' : '120,95,65'}, ${r.range(0.12, 0.25)})`;
    ctx.lineWidth = r.range(2, 9);
    ctx.beginPath();
    for (let x = 0; x <= width; x += 20) {
      const y = y0 + Math.sin(x * 0.01 + i) * 6 + Math.sin(x * 0.037 + i * 2) * 3;
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 6000; i++) {
    const x = r.range(0, width), y = r.range(0, height);
    ctx.fillStyle = r.next() < 0.5 ? `rgba(20,12,6,${r.range(0.2, 0.45)})` : `rgba(150,120,85,${r.range(0.1, 0.3)})`;
    ctx.fillRect(x, y, r.range(0.6, 1.8), r.range(0.6, 1.8));
  }
  for (let i = 0; i < 110; i++) {
    const x = r.range(0, width), y = r.range(10, height), s = r.range(1.5, 5);
    const t = r.int(85, 125);
    ctx.fillStyle = `rgba(${t}, ${t - 10}, ${t - 25}, 0.75)`;
    ctx.beginPath(); ctx.ellipse(x, y, s, s * 0.7, r.angle(), 0, Math.PI * 2); ctx.fill();
  }
  // roots
  for (let i = 0; i < 14; i++) {
    let x = r.range(0, width), y = 0;
    ctx.strokeStyle = 'rgba(160, 120, 75, 0.45)';
    ctx.lineWidth = r.range(1, 3);
    ctx.beginPath(); ctx.moveTo(x, y);
    const n = r.int(5, 12);
    for (let k = 0; k < n; k++) { x += r.range(-14, 14); y += r.range(8, 22); ctx.lineTo(x, y); }
    ctx.stroke();
  }
  return { canvas: cv, width, height };
}
