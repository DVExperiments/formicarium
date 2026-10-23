// Side-on cross-section of one colony's nest, drawn from the same live simulation state.
import { renderSoil } from './terrain.js';
import { drawAnt } from './sprites.js';
import { SPECIES } from '../sim/species.js';

const TAU = Math.PI * 2;
export const SOIL_X0 = -350, SOIL_W = 700, SOIL_H = 560;
const LABELS = { entrance: 'Entrance', queen: 'Queen chamber', brood: 'Brood chamber', store: 'Food store', refuse: 'Refuse', general: 'Chamber' };

export class UndergroundRenderer {
  constructor(world) {
    this.world = world;
    this.soil = renderSoil(world.seedNum, SOIL_W, SOIL_H);
  }
  chamberAt(col, x, y) {
    for (const ch of col.nest.chambers) {
      if (ch.dug <= 0) continue;
      const dx = (x - ch.x) / Math.max(4, ch.rx), dy = (y - ch.y) / Math.max(4, ch.ry);
      if (dx * dx + dy * dy <= 1.1) return ch;
    }
    return null;
  }
  antAt(col, x, y, r = 7) {
    let best = null, bd = r;
    for (const a of col.ants) {
      if (a.dead || a.loc !== 'nest') continue;
      const d = Math.hypot(a.ux - x, a.uy - y);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  render(ctx, cam, dpr, col, o) {
    const w = this.world, env = w.env, nest = col.nest;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1d150e';
    ctx.fillRect(0, 0, cam.w, cam.h);
    cam.apply(ctx, dpr);
    const z = cam.zoom;
    // sky and surface strip
    const day = env.daylight;
    const sky = ctx.createLinearGradient(0, -120, 0, 0);
    sky.addColorStop(0, `rgb(${40 + 100 * day}, ${55 + 120 * day}, ${90 + 130 * day})`);
    sky.addColorStop(1, `rgb(${70 + 110 * day}, ${80 + 110 * day}, ${95 + 100 * day})`);
    ctx.fillStyle = sky;
    ctx.fillRect(SOIL_X0, -140, SOIL_W, 140);
    ctx.drawImage(this.soil.canvas, SOIL_X0, 0, SOIL_W, SOIL_H);
    // moisture darkening from the top down
    if (env.moisture > 0.2) {
      const g = ctx.createLinearGradient(0, 0, 0, 200);
      g.addColorStop(0, `rgba(10,8,20,${env.moisture * 0.45})`);
      g.addColorStop(1, 'rgba(10,8,20,0)');
      ctx.fillStyle = g; ctx.fillRect(SOIL_X0, 0, SOIL_W, 200);
    }
    // mound
    const mr = col.moundRadius() * 1.4, mh = Math.min(26, 4 + Math.sqrt(col.mound) * 0.35);
    ctx.fillStyle = '#7a5a3a';
    ctx.beginPath(); ctx.moveTo(-mr, 0); ctx.quadraticCurveTo(0, -mh * 2, mr, 0); ctx.closePath(); ctx.fill();
    // grass line
    ctx.strokeStyle = '#6f8c43'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let x = SOIL_X0; x < SOIL_X0 + SOIL_W; x += 3) {
      if (Math.abs(x) < mr) continue;
      const h = 4 + ((x * 7919) % 7 + 7) % 7;
      ctx.moveTo(x, 0); ctx.lineTo(x + 1.5, -h);
    }
    ctx.stroke();
    if (env.rain > 0.05) {
      ctx.strokeStyle = 'rgba(200,215,235,0.4)'; ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let i = 0; i < 80 * env.rain; i++) {
        const x = SOIL_X0 + ((i * 97 + o.time * 0.2) % SOIL_W), y = -130 + ((i * 53 + o.time * 0.5) % 125);
        ctx.moveTo(x, y); ctx.lineTo(x - 2, y + 7);
      }
      ctx.stroke();
    }
    // tunnels
    for (const ch of nest.chambers) {
      if (ch.parent === null) continue;
      const p = nest.byId(ch.parent);
      const t = ch.tunnelDug;
      if (t <= 0) {
        ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(240,220,180,0.18)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(ch.x, ch.y); ctx.stroke(); ctx.setLineDash([]);
        continue;
      }
      const ex = p.x + (ch.x - p.x) * t, ey = p.y + (ch.y - p.y) * t;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(15,9,4,0.6)'; ctx.lineWidth = 10;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.strokeStyle = '#2c1d11'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(ex, ey); ctx.stroke();
      if (t < 1) { ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(240,220,180,0.18)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ch.x, ch.y); ctx.stroke(); ctx.setLineDash([]); }
    }
    // entrance shaft to the surface
    ctx.strokeStyle = '#2c1d11'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(0, -mh * 0.9); ctx.lineTo(0, 2); ctx.stroke();
    // chambers
    for (const ch of nest.chambers) {
      if (ch.type === 'entrance') continue;
      const k = Math.sqrt(Math.max(0, ch.dug));
      if (k <= 0.02) {
        ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(240,220,180,0.22)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(ch.x, ch.y, ch.rx, ch.ry, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        continue;
      }
      ctx.fillStyle = 'rgba(15,9,4,0.55)';
      ctx.beginPath(); ctx.ellipse(ch.x, ch.y + 1, ch.rx * k + 2.5, ch.ry * k + 2.5, 0, 0, TAU); ctx.fill();
      const g = ctx.createLinearGradient(0, ch.y - ch.ry, 0, ch.y + ch.ry);
      g.addColorStop(0, '#22160c'); g.addColorStop(1, ch.type === 'refuse' ? '#3a2c1c' : '#3d2a18');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(ch.x, ch.y, ch.rx * k, ch.ry * k, 0, 0, TAU); ctx.fill();
      if (ch.dug < 1) {
        ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(240,220,180,0.22)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(ch.x, ch.y, ch.rx, ch.ry, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      }
      if (ch.flooded) {
        ctx.save();
        ctx.beginPath(); ctx.ellipse(ch.x, ch.y, ch.rx * k, ch.ry * k, 0, 0, TAU); ctx.clip();
        ctx.fillStyle = 'rgba(80, 130, 180, 0.55)';
        ctx.fillRect(ch.x - ch.rx, ch.y - ch.ry * 0.3, ch.rx * 2, ch.ry * 2);
        ctx.restore();
      }
    }
    // dig face crumbs
    const face = nest.digSite ? nest.digFace() : null;
    if (face) {
      ctx.fillStyle = '#a07a50';
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(face.x + Math.sin(o.time * 0.01 + i) * 3, face.y + Math.cos(i * 2) * 3, 0.9, 0, TAU); ctx.fill(); }
    }
    this.drawStores(ctx, col);
    // refuse debris and corpses
    for (const k of nest.corpses) {
      if (k.carried) continue;
      drawAnt(ctx, { sp: SPECIES[k.species], size: k.size, caste: k.caste, gait: 0, id: k.tick, crop: 0 }, { x: k.x, y: k.y, heading: k.heading, dead: true });
    }
    this.drawBrood(ctx, col);
    // ants
    for (const a of col.ants) {
      if (a.dead || a.loc !== 'nest') continue;
      drawAnt(ctx, a, { x: a.ux, y: a.uy, heading: a.uh });
    }
    // labels
    if (z > 0.75) {
      ctx.font = `${10.5 / z}px "Atkinson Hyperlegible", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      for (const ch of nest.chambers) {
        if (ch.type === 'entrance' || ch.dug <= 0.02) continue;
        ctx.fillStyle = 'rgba(241,236,214,0.7)';
        const lab = (LABELS[ch.type] || ch.type) + (ch.dug < 1 ? ` (${Math.round(ch.dug * 100)}%)` : '') + (ch.flooded ? ', flooded' : '');
        ctx.fillText(lab, ch.x, ch.y - ch.ry - 4 / z);
      }
    }
    const sel = o.selected;
    if (sel && sel.type === 'ant' && sel.ant.loc === 'nest' && sel.ant.colony === col && !sel.ant.dead) {
      ctx.strokeStyle = '#f3c25a'; ctx.lineWidth = 1.5 / z;
      ctx.beginPath(); ctx.arc(sel.ant.ux, sel.ant.uy, sel.ant.size + 3 / z, 0, TAU); ctx.stroke();
    }
    if (o.hoverChamber) {
      const ch = o.hoverChamber;
      ctx.strokeStyle = 'rgba(243,194,90,0.6)'; ctx.lineWidth = 1.2 / z;
      ctx.beginPath(); ctx.ellipse(ch.x, ch.y, ch.rx + 3, ch.ry + 3, 0, 0, TAU); ctx.stroke();
    }
    if (col.extinct) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = 'rgba(30, 28, 26, 0.35)';
      ctx.fillRect(0, 0, cam.w, cam.h);
    }
  }

  drawStores(ctx, col) {
    const nest = col.nest;
    let rooms = nest.chambers.filter((c) => c.type === 'store' && nest.usable(c));
    if (!rooms.length) rooms = nest.chambers.filter((c) => c.type !== 'entrance' && nest.usable(c)).slice(0, 1);
    if (!rooms.length) return;
    const s = col.stores;
    const items = [];
    for (let i = 0; i < Math.min(60, Math.round(s.c / 2)); i++) items.push('c');
    for (let i = 0; i < Math.min(40, Math.round(s.p / 2)); i++) items.push('p');
    for (let i = 0; i < Math.min(60, Math.round(s.seed / 2)); i++) items.push('s');
    items.forEach((kind, i) => {
      const ch = rooms[i % rooms.length];
      const j = Math.floor(i / rooms.length);
      const a = j * 2.39996, d = Math.sqrt(j / 60);
      const x = ch.x + Math.cos(a) * ch.rx * 0.75 * d, y = ch.y + ch.ry * 0.55 - Math.abs(Math.sin(a)) * ch.ry * 0.5 * d;
      if (kind === 'c') { ctx.fillStyle = 'rgba(231,178,72,0.9)'; ctx.beginPath(); ctx.arc(x, y, 1.6, 0, TAU); ctx.fill(); }
      else if (kind === 'p') { ctx.fillStyle = '#8a4a34'; ctx.beginPath(); ctx.arc(x, y, 1.5, 0, TAU); ctx.fill(); }
      else { ctx.fillStyle = '#a77d4a'; ctx.beginPath(); ctx.ellipse(x, y, 1.8, 1.1, a, 0, TAU); ctx.fill(); }
    });
  }

  drawBrood(ctx, col) {
    const naked = col.species.id === 'pheidole';
    for (const b of col.brood) {
      if (b.chamber < 0 || b.dead) continue;
      ctx.save(); ctx.translate(b.x, b.y);
      if (b.stage === 'egg') {
        ctx.fillStyle = '#f4f0e2';
        ctx.beginPath(); ctx.ellipse(0, 0, 0.9, 0.6, 0.4, 0, TAU); ctx.fill();
      } else if (b.stage === 'larva') {
        const s = 0.8 + Math.min(1, b.progress) * 1.6 * (b.caste === 'gyne' ? 1.5 : b.caste === 'major' ? 1.25 : 1);
        ctx.fillStyle = b.hungry ? '#e6ddc6' : '#f6efdc';
        ctx.strokeStyle = 'rgba(120,100,70,0.4)'; ctx.lineWidth = 0.2;
        ctx.beginPath(); ctx.arc(0, 0, s, 0.5, 5.6); ctx.arc(0, 0, s * 0.45, 5.6, 0.5, true); ctx.closePath();
        ctx.fill(); ctx.stroke();
      } else {
        const big = b.caste === 'gyne' ? 1.6 : b.caste === 'major' || b.caste === 'male' ? 1.25 : 1;
        ctx.fillStyle = naked ? '#efe6d4' : '#d6bf92';
        ctx.beginPath(); ctx.ellipse(0, 0, 2.6 * big, 1.3 * big, 0.2, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(80,60,40,0.35)';
        ctx.beginPath(); ctx.arc(2.0 * big, 0.2, 0.5 * big, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
  }
}
export { LABELS };
