// Top-down surface renderer. Reads world state; never modifies it.
import { GRID_W, GRID_H, CELL, PRES_W, PRES_H, PRES_CELL } from '../sim/constants.js';
import { TRAIL_MAX } from '../sim/pheromone.js';
import { renderTerrain } from './terrain.js';
import { drawAnt, drawAntDot, drawFood, drawPrey, drawPlant } from './sprites.js';

const TAU = Math.PI * 2;
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

export class SurfaceRenderer {
  constructor(world) {
    this.world = world;
    this.terrain = renderTerrain(world, 1.5);
    this.pherCanvas = document.createElement('canvas');
    this.pherCanvas.width = GRID_W; this.pherCanvas.height = GRID_H;
    this.pherCtx = this.pherCanvas.getContext('2d');
    this.pherImg = this.pherCtx.createImageData(GRID_W, GRID_H);
    this.frame = 0;
    this.rain = [];
    for (let i = 0; i < 260; i++) this.rain.push({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 0.8 });
  }

  updatePheromones() {
    const d = this.pherImg.data;
    d.fill(0);
    for (const c of this.world.colonies) {
      if (c.extinct && c.pher.totalTrail() === 0) continue;
      const [r, g, b] = hexRgb(c.color);
      const t = c.pher.trail, a = c.pher.alarm;
      for (let i = 0; i < t.length; i++) {
        const v = t[i], w = a[i];
        if (v > 0.05) {
          const al = Math.min(1, Math.sqrt(v / (TRAIL_MAX * 0.35)));
          const k = i * 4;
          if (al * 230 > d[k + 3]) { d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = al * 230; }
        }
        if (w > 0.15) {
          const k = i * 4, al = Math.min(1, w / 6) * 255;
          if (al > d[k + 3] * 0.8) { d[k] = 235; d[k + 1] = 70; d[k + 2] = 50; d[k + 3] = Math.max(d[k + 3], al); }
        }
      }
    }
    this.pherCtx.putImageData(this.pherImg, 0, 0);
  }

  render(ctx, cam, dpr, o) {
    const w = this.world, env = w.env;
    this.frame++;
    const vw = cam.w, vh = cam.h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#2b2116';
    ctx.fillRect(0, 0, vw, vh);
    cam.apply(ctx, dpr);
    const v = cam.view(40);
    const z = cam.zoom;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.terrain.canvas, 0, 0, w.W, w.H);
    // wet soil darkens
    if (env.moisture > 0.3) { ctx.fillStyle = `rgba(30, 20, 12, ${(env.moisture - 0.3) * 0.45})`; ctx.fillRect(0, 0, w.W, w.H); }
    // territory overlay
    if (o.territory) {
      for (let cy = 0; cy < PRES_H; cy++) for (let cx = 0; cx < PRES_W; cx++) {
        const owner = w.territoryOwner[cy * PRES_W + cx];
        if (owner < 0) continue;
        const col = w.colonies[owner];
        ctx.fillStyle = col.color + '33';
        ctx.fillRect(cx * PRES_CELL, cy * PRES_CELL, PRES_CELL, PRES_CELL);
        ctx.strokeStyle = col.color + '55'; ctx.lineWidth = 1 / z;
        ctx.strokeRect(cx * PRES_CELL + 0.5, cy * PRES_CELL + 0.5, PRES_CELL - 1, PRES_CELL - 1);
      }
    }
    if (o.pheromones) {
      if (this.frame % 4 === 0 || this.frame < 3) this.updatePheromones();
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.pherCanvas, 0, 0, GRID_W * CELL, GRID_H * CELL);
      ctx.restore();
    }
    const inView = (x, y, r = 30) => x > v.x0 - r && x < v.x1 + r && y > v.y0 - r && y < v.y1 + r;
    const t = o.time;
    for (const p of w.plants) if (inView(p.x, p.y, 60)) drawPlant(ctx, p, t, 'ground');
    // nests
    for (const c of w.colonies) {
      if (!inView(c.x, c.y, 80)) continue;
      const r = c.moundRadius();
      const g = ctx.createRadialGradient(c.x, c.y, r * 0.15, c.x, c.y, r);
      g.addColorStop(0, c.extinct ? 'rgba(110,100,90,0.9)' : 'rgba(160,128,88,0.95)');
      g.addColorStop(0.7, c.extinct ? 'rgba(100,90,80,0.6)' : 'rgba(140,108,72,0.7)');
      g.addColorStop(1, 'rgba(120,90,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, TAU); ctx.fill();
      // soil crumbs
      ctx.fillStyle = 'rgba(185,150,105,0.7)';
      for (let i = 0; i < Math.min(60, 8 + c.mound / 4); i++) {
        const a = i * 2.39996 + c.id, d = r * (0.25 + ((i * 53) % 70) / 100);
        ctx.beginPath(); ctx.arc(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, 0.9, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = '#140d07';
      ctx.beginPath(); ctx.ellipse(c.x, c.y, 4.2, 3.4, 0, 0, TAU); ctx.fill();
      if (z > 0.45) {
        ctx.strokeStyle = c.color; ctx.lineWidth = 1.6 / z;
        ctx.setLineDash(c.extinct ? [3 / z, 3 / z] : []);
        ctx.beginPath(); ctx.arc(c.x, c.y, r + 4, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    for (const f of w.foods) if (w.foodById.has(f.id) && inView(f.x, f.y)) drawFood(ctx, f, t);
    for (const p of w.prey) if (inView(p.x, p.y)) drawPrey(ctx, p);
    // ants
    const lod = z < 0.9;
    if (lod) {
      ctx.lineCap = 'round';
      const byColor = new Map();
      for (const a of w.ants) {
        if (a.loc !== 'surface' || a.flying || !inView(a.x, a.y, 10)) continue;
        const key = a.sp.colors.body;
        if (!byColor.has(key)) byColor.set(key, []);
        byColor.get(key).push(a);
      }
      for (const [col, list] of byColor) {
        ctx.strokeStyle = 'rgba(235,225,200,0.35)'; ctx.lineWidth = Math.max(3.2 / z, 3.4);
        ctx.beginPath();
        for (const a of list) drawAntDot(ctx, a, a.x, a.y, a.heading);
        ctx.stroke();
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.8 / z, 2.2);
        ctx.beginPath();
        for (const a of list) drawAntDot(ctx, a, a.x, a.y, a.heading);
        ctx.stroke();
      }
    } else {
      for (const a of w.ants) {
        if (a.loc !== 'surface' || a.flying || !inView(a.x, a.y, 10)) continue;
        drawAnt(ctx, a);
        if (a.fightTarget && this.frame % 20 < 10) {
          ctx.strokeStyle = 'rgba(230,80,50,0.8)'; ctx.lineWidth = 0.6;
          ctx.beginPath(); ctx.arc(a.x, a.y, a.size * 0.9, 0, TAU); ctx.stroke();
        }
      }
    }
    for (const p of w.plants) if (p.type === 'shrub' && inView(p.x, p.y, 80)) drawPlant(ctx, p, t, 'canopy');
    // flying alates rise toward the viewer
    for (const a of w.ants) {
      if (!a.flying) continue;
      const k = 1 + a.z / 12;
      ctx.globalAlpha = Math.max(0, 1 - a.z / 32);
      ctx.save(); ctx.translate(a.x, a.y); ctx.scale(k, k); ctx.translate(-a.x, -a.y);
      drawAnt(ctx, a);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    // colony labels
    if (z > 0.55) {
      ctx.font = `${12 / z}px "Atkinson Hyperlegible", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      for (const c of w.colonies) {
        if (!inView(c.x, c.y, 80)) continue;
        const label = c.extinct ? `${c.name} (extinct)` : c.name;
        const y = c.y - c.moundRadius() - 9 / z;
        ctx.fillStyle = 'rgba(20,16,10,0.55)';
        const tw = ctx.measureText(label).width;
        ctx.fillRect(c.x - tw / 2 - 4 / z, y - 11 / z, tw + 8 / z, 15 / z);
        ctx.fillStyle = c.extinct ? '#b9b2a2' : '#f1ecd6';
        ctx.fillText(label, c.x, y);
      }
    }
    // selection
    const sel = o.selected;
    if (sel && sel.type === 'ant' && !sel.ant.dead && sel.ant.loc === 'surface') {
      const a = sel.ant;
      ctx.strokeStyle = '#f3c25a'; ctx.lineWidth = 1.5 / z;
      ctx.beginPath(); ctx.arc(a.x, a.y, a.size * 1.1 + 3 / z, 0, TAU); ctx.stroke();
      if (a.memory.food) {
        ctx.setLineDash([4 / z, 4 / z]); ctx.strokeStyle = 'rgba(243,194,90,0.6)';
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.memory.food.x, a.memory.food.y); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (sel && sel.type === 'colony') {
      const c = sel.colony;
      ctx.strokeStyle = '#f3c25a'; ctx.lineWidth = 2 / z;
      ctx.beginPath(); ctx.arc(c.x, c.y, c.moundRadius() + 8 / z, 0, TAU); ctx.stroke();
      ctx.setLineDash([6 / z, 6 / z]); ctx.strokeStyle = c.color + 'aa'; ctx.lineWidth = 1 / z;
      ctx.beginPath(); ctx.arc(c.x, c.y, c.species.range, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (o.ghost) {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = o.ghost.ok ? '#f3c25a' : '#d7553b'; ctx.lineWidth = 2 / z;
      ctx.beginPath(); ctx.arc(o.ghost.x, o.ghost.y, o.ghost.r, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (o.debug) this.drawDebug(ctx, cam, v);
    // night and rain, in screen space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const night = 1 - env.daylight;
    if (night > 0.01) { ctx.fillStyle = `rgba(14, 22, 52, ${night * 0.52})`; ctx.fillRect(0, 0, vw, vh); }
    if (env.rain > 0.02) {
      ctx.strokeStyle = `rgba(200, 215, 235, ${0.25 + env.rain * 0.35})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const n = Math.floor(this.rain.length * env.rain);
      const fall = o.reduceMotion ? 0 : (t * 0.0012);
      for (let i = 0; i < n; i++) {
        const d = this.rain[i];
        const x = ((d.x + fall * 0.15 * d.s) % 1) * vw, y = ((d.y + fall * d.s) % 1) * vh;
        ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 12 * d.s);
      }
      ctx.stroke();
    }
  }

  drawDebug(ctx, cam, v) {
    const w = this.world, z = cam.zoom;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1 / z;
    ctx.beginPath();
    for (let x = Math.floor(v.x0 / 16) * 16; x < v.x1; x += 16) { ctx.moveTo(x, v.y0); ctx.lineTo(x, v.y1); }
    for (let y = Math.floor(v.y0 / 16) * 16; y < v.y1; y += 16) { ctx.moveTo(v.x0, y); ctx.lineTo(v.x1, y); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,60,60,0.18)';
    for (let gy = Math.max(0, Math.floor(v.y0 / CELL)); gy < Math.min(GRID_H, v.y1 / CELL); gy++)
      for (let gx = Math.max(0, Math.floor(v.x0 / CELL)); gx < Math.min(GRID_W, v.x1 / CELL); gx++)
        if (w.obstacle[gy * GRID_W + gx]) ctx.fillRect(gx * CELL, gy * CELL, CELL, CELL);
    ctx.strokeStyle = 'rgba(120,220,255,0.5)';
    for (const f of w.foods) { ctx.beginPath(); ctx.arc(f.x, f.y, f.radius, 0, TAU); ctx.stroke(); }
    if (z > 1.4) {
      ctx.font = `${8 / z * 1.2}px system-ui`; ctx.textAlign = 'left';
      for (const a of w.ants) {
        if (a.loc !== 'surface' || a.x < v.x0 || a.x > v.x1 || a.y < v.y0 || a.y > v.y1) continue;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText(`${a.task[0]}:${a.mode.slice(0, 4)} ${Math.round(a.energy / a.maxEnergy * 100)}%`, a.x + 4, a.y - 3);
      }
    }
  }
}
