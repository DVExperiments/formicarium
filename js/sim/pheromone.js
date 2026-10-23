import { CELL, GRID_W, GRID_H } from './constants.js';

export const TRAIL_MAX = 40;
export const ALARM_MAX = 20;

// Per-colony pheromone grids: a recruitment trail channel and an alarm channel.
// Decay is exponential with a configurable half-life, applied in batches with exact compounding
// so the result does not depend on simulation speed.
export class PheromoneField {
  constructor(trailHalfLife, alarmHalfLife = 50) {
    this.trail = new Float32Array(GRID_W * GRID_H);
    this.alarm = new Float32Array(GRID_W * GRID_H);
    this.trailRate = Math.pow(0.5, 1 / trailHalfLife);
    this.alarmRate = Math.pow(0.5, 1 / alarmHalfLife);
    this.alarmActive = false;
  }
  static index(x, y) {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    if (cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H) return -1;
    return cy * GRID_W + cx;
  }
  depositTrail(x, y, amount) {
    const i = PheromoneField.index(x, y);
    if (i < 0) return;
    const v = this.trail[i] + amount;
    this.trail[i] = v > TRAIL_MAX ? TRAIL_MAX : v;
  }
  depositAlarm(x, y, amount) {
    this.alarmActive = true;
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const gx = cx + dx, gy = cy + dy;
        if (gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) continue;
        const i = gy * GRID_W + gx;
        const v = this.alarm[i] + amount * (dx === 0 && dy === 0 ? 1 : 0.5);
        this.alarm[i] = v > ALARM_MAX ? ALARM_MAX : v;
      }
    }
  }
  sampleTrail(x, y) {
    const i = PheromoneField.index(x, y);
    return i < 0 ? 0 : this.trail[i];
  }
  sampleAlarm(x, y) {
    const i = PheromoneField.index(x, y);
    return i < 0 ? 0 : this.alarm[i];
  }
  // Apply n ticks of decay. extraTrail is an additional per-tick multiplier (rain washing).
  decay(n, extraTrail = 1) {
    const ft = Math.pow(this.trailRate * extraTrail, n);
    const fa = Math.pow(this.alarmRate, n);
    const t = this.trail, a = this.alarm;
    for (let i = 0; i < t.length; i++) {
      const v = t[i];
      if (v !== 0) t[i] = v < 0.02 ? 0 : v * ft;
    }
    if (this.alarmActive) {
      let any = false;
      for (let i = 0; i < a.length; i++) {
        const w = a[i];
        if (w !== 0) { if (w < 0.02) a[i] = 0; else { a[i] = w * fa; any = true; } }
      }
      this.alarmActive = any;
    }
  }
  totalTrail() {
    let s = 0;
    for (let i = 0; i < this.trail.length; i++) s += this.trail[i];
    return s;
  }
}
