// Procedural vector sprites. All drawing is in world units with the camera transform applied.
import { SPECIES } from '../sim/species.js';

const TAU = Math.PI * 2;

// Top-down ant: gaster, petiole, mesosoma, head, mandibles, antennae and six legs with a tripod gait.
export function drawAnt(ctx, a, opts = {}) {
  const sp = a.sp || SPECIES[a.species];
  const c = sp.colors;
  const s = a.size / 6;
  const x = opts.x ?? a.x, y = opts.y ?? a.y, h = opts.heading ?? a.heading;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(h);
  ctx.scale(s, s);
  const major = a.caste === 'major';
  const queen = a.caste === 'queen' || a.caste === 'gyne';
  const male = a.caste === 'male';
  const dead = opts.dead;
  const phase = dead ? 0 : Math.sin(a.gait * 1.6);
  const headR = major ? 1.25 : queen ? 0.85 : male ? 0.55 : 0.82;
  const gasterRx = queen ? 2.5 : male ? 1.5 : 1.6;
  const gasterRy = queen ? 1.6 : male ? 0.9 : 1.12;
  const thoraxRx = queen ? 1.5 : 1.08;
  const repl = a.crop > 0 && a.cropCap ? Math.min(1, a.crop / a.cropCap) : 0;

  // legs
  ctx.strokeStyle = c.leg;
  ctx.lineWidth = 0.28;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const AX = [0.85, 0.35, -0.1], KX = [0.5, 0.0, -0.45], FX = [1.7, 0.15, -1.9];
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1]) {
      const tri = (i === 1 ? -1 : 1) * side; // alternating tripod gait
      const sw = phase * tri;
      const ax = AX[i];
      ctx.moveTo(ax, side * 0.35);
      if (dead) {
        ctx.lineTo(ax + 0.1, side * 0.95);
        ctx.lineTo(ax + 0.45, side * 0.55);
      } else {
        ctx.lineTo(ax + KX[i] + sw * 0.35, side * 1.35);
        ctx.lineTo(ax + FX[i] + sw * 0.85, side * 2.25);
      }
    }
  }
  ctx.stroke();

  // wings (alates and flying)
  if ((a.caste === 'gyne' || male) && !dead) {
    ctx.fillStyle = 'rgba(235, 240, 255, 0.38)';
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.12;
    const flap = a.flying ? Math.sin(a.gait * 9) * 0.5 : 0;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(-2.2, side * (0.9 + flap), 3.4, 1.0, side * (0.18 + flap * 0.4), 0, TAU);
      ctx.fill(); ctx.stroke();
    }
  }

  // gaster
  ctx.fillStyle = c.gaster;
  ctx.beginPath();
  ctx.ellipse(-2.0 - (queen ? 0.6 : 0), 0, gasterRx * (1 + repl * 0.3), gasterRy * (1 + repl * 0.45), 0, 0, TAU);
  ctx.fill();
  if (repl > 0.15) { // swollen, translucent social stomach
    ctx.fillStyle = `rgba(233, 178, 70, ${0.25 + repl * 0.35})`;
    ctx.beginPath();
    ctx.ellipse(-2.1, 0, gasterRx * 0.85 * (1 + repl * 0.3), gasterRy * 0.7 * (1 + repl * 0.45), 0, 0, TAU);
    ctx.fill();
  }
  // gaster banding sheen
  ctx.strokeStyle = c.sheen;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 0.12;
  ctx.beginPath();
  ctx.arc(-1.3 - (queen ? 0.6 : 0), 0, gasterRy * 0.9, -1.0, 1.0);
  ctx.stroke();
  ctx.globalAlpha = 1;
  // petiole
  ctx.fillStyle = c.body;
  ctx.beginPath();
  ctx.ellipse(-0.55 - (queen ? 0.2 : 0), 0, 0.32, 0.3, 0, 0, TAU);
  ctx.fill();
  // mesosoma
  ctx.beginPath();
  ctx.ellipse(0.35, 0, thoraxRx, queen ? 0.85 : 0.56, 0, 0, TAU);
  ctx.fill();
  // head
  ctx.fillStyle = c.head;
  ctx.beginPath();
  ctx.ellipse(1.75 + headR * 0.3, 0, headR * (major ? 1.05 : 0.95), headR * (major ? 1.1 : 0.85), 0, 0, TAU);
  ctx.fill();
  // mandibles
  ctx.strokeStyle = c.head;
  ctx.lineWidth = 0.22;
  ctx.beginPath();
  const mx = 1.75 + headR * 1.15;
  ctx.moveTo(mx - 0.2, -0.3); ctx.quadraticCurveTo(mx + 0.4, -0.25, mx + 0.45, 0.05);
  ctx.moveTo(mx - 0.2, 0.3); ctx.quadraticCurveTo(mx + 0.4, 0.25, mx + 0.45, -0.05);
  ctx.stroke();
  // antennae (elbowed)
  ctx.strokeStyle = c.leg;
  ctx.lineWidth = 0.18;
  ctx.beginPath();
  const wig = dead ? 0 : Math.sin(a.gait * 2.3 + a.id) * 0.25;
  for (const side of [-1, 1]) {
    const ax = 1.9 + headR * 0.5, ay = side * headR * 0.45;
    const ex = ax + 1.0, ey = ay + side * (0.9 + wig * side);
    ctx.moveTo(ax, ay); ctx.lineTo(ex, ey); ctx.lineTo(ex + 1.1, ey - side * (0.2 - wig));
  }
  ctx.stroke();
  // sheen highlight on head/thorax
  ctx.fillStyle = c.sheen;
  ctx.globalAlpha = 0.28;
  ctx.beginPath();
  ctx.ellipse(1.95, -headR * 0.3, headR * 0.35, headR * 0.18, 0, 0, TAU);
  ctx.ellipse(0.45, -0.25, 0.5, 0.14, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  // carried load at the mandibles
  const load = opts.load ?? a.carry;
  if (load && !dead) drawLoad(ctx, load, 2.0 + headR * 1.4, a);
  ctx.restore();
}

function drawLoad(ctx, load, x, a) {
  if (load.type === 'food') {
    if (load.kind === 'seed') {
      ctx.fillStyle = '#b08850';
      ctx.beginPath(); ctx.ellipse(x + 0.9, 0, 1.3 * Math.sqrt(load.mass), 0.8 * Math.sqrt(load.mass), 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#d7b47a'; ctx.beginPath(); ctx.ellipse(x + 0.7, -0.25, 0.5, 0.2, 0, 0, TAU); ctx.fill();
    } else if (load.kind === 'corpse') {
      ctx.fillStyle = '#4a3a30'; ctx.beginPath(); ctx.ellipse(x + 1.2, 0, 1.6, 0.7, 0.3, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = load.kind === 'insect' ? '#5d6b3a' : '#9b6a3a';
      ctx.beginPath(); ctx.arc(x + 0.8, 0, 0.6 + Math.sqrt(load.mass) * 0.6, 0, TAU); ctx.fill();
    }
  } else if (load.type === 'soil') {
    ctx.fillStyle = '#8a6a48';
    ctx.beginPath(); ctx.arc(x + 0.6, 0, 0.75, 0, TAU); ctx.fill();
  } else if (load.type === 'brood') {
    const b = load.b;
    ctx.fillStyle = b.stage === 'pupa' ? '#d9c39a' : '#f2ecd8';
    ctx.beginPath(); ctx.ellipse(x + 1, 0, b.stage === 'egg' ? 0.5 : 1.2, b.stage === 'egg' ? 0.35 : 0.7, 0, 0, TAU); ctx.fill();
  } else if (load.type === 'corpse') {
    ctx.fillStyle = '#3d3029'; ctx.beginPath(); ctx.ellipse(x + 1.3, 0, 1.8, 0.7, 0.2, 0, TAU); ctx.fill();
  }
}

// Minimal ant for far zoom levels: a short stroke.
export function drawAntDot(ctx, a, x, y, h) {
  const len = a.size * 0.55;
  const cx = Math.cos(h) * len, cy = Math.sin(h) * len;
  ctx.moveTo(x - cx, y - cy);
  ctx.lineTo(x + cx * 0.8, y + cy * 0.8);
}

// ---------------------------------------------------------------- food
export function drawFood(ctx, f, t) {
  const r = f.radius;
  switch (f.kind) {
    case 'sugar': {
      const g = ctx.createRadialGradient(f.x - r * 0.3, f.y - r * 0.3, r * 0.1, f.x, f.y, r);
      g.addColorStop(0, 'rgba(255, 248, 225, 0.75)');
      g.addColorStop(0.55, 'rgba(240, 214, 150, 0.5)');
      g.addColorStop(1, 'rgba(210, 170, 90, 0.18)');
      ctx.fillStyle = g;
      ctx.beginPath();
      for (let i = 0; i <= 32; i++) {
        const a = (i / 32) * TAU, rr = r * (0.88 + 0.08 * Math.sin(a * 3 + f.id) + 0.04 * Math.sin(a * 5 + f.id * 2));
        i ? ctx.lineTo(f.x + Math.cos(a) * rr, f.y + Math.sin(a) * rr * 0.8) : ctx.moveTo(f.x + Math.cos(a) * rr, f.y + Math.sin(a) * rr * 0.8);
      }
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 240, 200, 0.55)'; ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.ellipse(f.x - r * 0.35, f.y - r * 0.3, Math.max(0.8, r * 0.22), Math.max(0.4, r * 0.08), -0.5, 0, TAU); ctx.fill();
      break;
    }
    case 'honeydew': {
      // droplets on the herb, more when abundant
      const n = Math.min(14, Math.round(f.mass / 4));
      for (let i = 0; i < n; i++) {
        const a = i * 2.4 + f.id, d = 3 + (i % 5) * 1.8;
        ctx.fillStyle = 'rgba(236, 214, 120, 0.85)';
        ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, 0.9, 0, TAU); ctx.fill();
      }
      // aphids
      ctx.fillStyle = '#a8c86a';
      for (let i = 0; i < 9; i++) {
        const a = i * 0.7 + f.id * 0.3, d = 4 + (i % 4) * 2.2;
        ctx.beginPath(); ctx.ellipse(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, 0.9, 0.6, a, 0, TAU); ctx.fill();
      }
      break;
    }
    case 'fruit': {
      const hue = f.variant === 0 ? ['#c2412f', '#e5704f'] : f.variant === 1 ? ['#d9952b', '#f0c060'] : ['#6d3a6e', '#9a5a9a'];
      const rot = f.age > 0 ? Math.min(1, f.initialMass ? 1 - f.mass / f.initialMass : 0) : 0;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(f.x + 1.5, f.y + 2, r, r * 0.8, 0, 0, TAU); ctx.fill();
      const g = ctx.createRadialGradient(f.x - r * 0.35, f.y - r * 0.35, r * 0.1, f.x, f.y, r);
      g.addColorStop(0, hue[1]); g.addColorStop(1, hue[0]);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, TAU); ctx.fill();
      // eaten / rotting patches
      ctx.fillStyle = `rgba(90, 60, 30, ${0.25 + rot * 0.5})`;
      ctx.beginPath(); ctx.arc(f.x + r * 0.3, f.y + r * 0.1, r * (0.2 + rot * 0.5), 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.ellipse(f.x - r * 0.4, f.y - r * 0.45, r * 0.25, r * 0.12, -0.6, 0, TAU); ctx.fill();
      break;
    }
    case 'insect': drawDeadInsect(ctx, f, r); break;
    case 'seed': {
      if (f.regen) {
        const n = Math.min(16, Math.ceil(f.mass / 1.6));
        for (let i = 0; i < n; i++) {
          const a = i * 2.39996 + f.id, d = 2 + Math.sqrt(i) * 2.6;
          drawSeed(ctx, f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, 1.4, a * 1.7);
        }
      } else drawSeed(ctx, f.x, f.y, Math.sqrt(f.mass), f.heading);
      break;
    }
    case 'corpse': {
      drawAnt(ctx, { sp: SPECIES[f.species], size: f.size, caste: f.caste, gait: 0, id: f.id, crop: 0 }, { x: f.x, y: f.y, heading: f.heading, dead: true });
      break;
    }
  }
}

function drawSeed(ctx, x, y, s, rot) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = '#9c7444';
  ctx.beginPath(); ctx.ellipse(0, 0, 1.6 * s, 1.0 * s, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#c9a26a';
  ctx.beginPath(); ctx.ellipse(-0.3 * s, -0.3 * s, 0.7 * s, 0.3 * s, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawDeadInsect(ctx, f, r) {
  const cols = [['#2f3a22', '#55663a'], ['#3a2a1f', '#6b4c33'], ['#1f2125', '#45505a']][f.variant % 3];
  const s = Math.max(0.4, r / 7);
  ctx.save();
  ctx.translate(f.x, f.y); ctx.rotate(f.heading); ctx.scale(s, s);
  ctx.strokeStyle = cols[0]; ctx.lineWidth = 0.6; ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 3; i++) for (const side of [-1, 1]) {
    const bx = 1 - i * 1.6;
    ctx.moveTo(bx, side * 1.5);
    ctx.lineTo(bx + (i - 1) * 1.2, side * 4.2);
    ctx.lineTo(bx + (i - 1) * 2.2, side * 5.4);
  }
  ctx.stroke();
  ctx.fillStyle = cols[0];
  ctx.beginPath(); ctx.ellipse(-1.5, 0, 4.2, 2.8, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = cols[1];
  ctx.beginPath(); ctx.ellipse(-1.6, -0.9, 3.4, 0.9, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 0.25;
  ctx.beginPath(); ctx.moveTo(-5.6, 0); ctx.lineTo(2.4, 0); ctx.stroke();
  ctx.fillStyle = cols[0];
  ctx.beginPath(); ctx.ellipse(3.3, 0, 1.6, 1.4, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- living prey
export function drawPrey(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y); ctx.rotate(p.heading);
  const s = p.size / 8;
  ctx.scale(s, s);
  const wig = Math.sin(p.gait * 1.2);
  if (p.kind === 0) { // springtail
    ctx.fillStyle = '#7f8a8f';
    ctx.beginPath(); ctx.ellipse(0, 0, 4, 1.8, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#6a7378'; ctx.lineWidth = 0.4;
    ctx.beginPath(); ctx.moveTo(3.5, -0.6); ctx.lineTo(6, -2 + wig * 0.4); ctx.moveTo(3.5, 0.6); ctx.lineTo(6, 2 - wig * 0.4); ctx.stroke();
  } else if (p.kind === 1) { // caterpillar
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? '#7da04a' : '#8db45a';
      ctx.beginPath(); ctx.arc(2.5 - i * 1.4, Math.sin(p.gait * 0.8 + i) * 0.4, 1.3, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#4c5f2a'; ctx.beginPath(); ctx.arc(3.6, 0, 1.1, 0, TAU); ctx.fill();
  } else { // beetle larva
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = '#e8dcc0';
      ctx.beginPath(); ctx.ellipse(2 - i * 1.5, 0, 0.9, 1.5 - i * 0.12, 0, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#9a6a3a'; ctx.beginPath(); ctx.arc(3, 0, 1, 0, TAU); ctx.fill();
  }
  if (p.hp < p.maxHp) {
    ctx.fillStyle = 'rgba(200,60,40,0.6)';
    ctx.beginPath(); ctx.arc(0, 0, 0.8, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- plants
export function drawPlant(ctx, p, t, layer) {
  const sway = Math.sin(t * 0.0012 + p.seed * 20) * 0.05;
  if (p.type === 'grass' && layer === 'ground') {
    const n = 14;
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + p.seed * 6;
      const len = (10 + ((i * 37) % 9)) * p.size;
      const bend = sway + Math.sin(a * 3) * 0.2;
      ctx.strokeStyle = i % 3 === 0 ? '#8aa356' : i % 3 === 1 ? '#6f8c43' : '#a3b86a';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo(p.x + Math.cos(a) * len * 0.5, p.y + Math.sin(a) * len * 0.5, p.x + Math.cos(a + bend) * len, p.y + Math.sin(a + bend) * len);
      ctx.stroke();
    }
    if (p.seedHead) {
      ctx.fillStyle = '#c9b27a';
      for (let i = 0; i < 5; i++) {
        const a = i * 1.26 + p.seed * 3;
        ctx.beginPath(); ctx.ellipse(p.x + Math.cos(a + sway) * 11 * p.size, p.y + Math.sin(a + sway) * 11 * p.size, 2.2, 1, a, 0, TAU); ctx.fill();
      }
    }
  } else if (p.type === 'herb' && layer === 'ground') {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + p.seed * 4 + sway;
      const len = 11 * p.size;
      ctx.fillStyle = i % 2 ? '#5f8a3e' : '#73a04a';
      ctx.beginPath();
      ctx.ellipse(p.x + Math.cos(a) * len * 0.6, p.y + Math.sin(a) * len * 0.6, len * 0.62, len * 0.28, a, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,60,25,0.5)'; ctx.lineWidth = 0.4;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(a) * len * 1.1, p.y + Math.sin(a) * len * 1.1); ctx.stroke();
    }
  } else if (p.type === 'shrub') {
    if (layer === 'ground') {
      ctx.fillStyle = 'rgba(20, 30, 10, 0.28)';
      ctx.beginPath(); ctx.ellipse(p.x + 8, p.y + 10, 46 * p.size, 38 * p.size, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#4a3020';
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, TAU); ctx.fill();
    } else {
      // translucent canopy drawn above ants
      for (let i = 0; i < 9; i++) {
        const a = i * 2.1 + p.seed * 5, d = (i === 0 ? 0 : 18 + (i % 3) * 8) * p.size;
        const rr = (22 - (i % 3) * 3) * p.size;
        ctx.fillStyle = i % 3 === 0 ? 'rgba(52, 88, 40, 0.62)' : i % 3 === 1 ? 'rgba(66, 104, 48, 0.58)' : 'rgba(80, 118, 56, 0.55)';
        ctx.beginPath(); ctx.arc(p.x + Math.cos(a + sway) * d, p.y + Math.sin(a + sway) * d, rr, 0, TAU); ctx.fill();
      }
    }
  }
}
