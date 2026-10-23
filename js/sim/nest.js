import { clamp, q10 } from './constants.js';

// Underground nest as a tree of chambers connected by tunnels.
// Coordinates are a side-on cross-section: x across, y = depth below the surface (0 at the entrance).
export const NEST_HALF_WIDTH = 300;
export const NEST_MAX_DEPTH = 460;

export class Nest {
  constructor(species, rng, incipient) {
    this.sp = species;
    this.rng = rng;
    this.chambers = [];
    this.byIdMap = new Map();
    this.corpses = [];        // dead ants inside the nest {x, y, chamber, caste, size, tick}
    this.digSite = null;      // chamber currently being excavated
    this.excavated = 0;       // total soil volume excavated
    this.nextId = 0;
    const d = species.nest.depth, c = species.nest.chamber, j = () => rng.range(-8, 8);
    this.add('entrance', 0, 0, 7, 5, null, 1);
    if (incipient) {
      this.add('queen', j(), 38 + j() * 0.5, 13 * c, 8 * c, 0, 1);
    } else {
      const g = this.add('general', 16 + j(), 52 * d + j(), 25 * c, 12 * c, 0, 1);
      this.add('queen', -24 + j(), 120 * d + j(), 22 * c, 11 * c, g.id, 1);
      const b = this.add('brood', 44 + j(), 98 * d + j(), 26 * c, 13 * c, g.id, 1);
      this.add('store', -58 + j(), 72 * d + j(), 24 * c, 12 * c, g.id, 1);
      this.add('refuse', 76 + j(), 150 * d + j(), 17 * c, 10 * c, b.id, 1);
    }
    this.excavated = this.chambers.reduce((s, ch) => s + this.chamberWork(ch) + this.tunnelLen(ch), 0);
  }

  add(type, x, y, rx, ry, parent, dug) {
    const ch = { id: this.nextId++, type, x, y, rx, ry, parent, dug, tunnelDug: parent === null ? 1 : dug,
      temp: 15, q10: 0.7, flooded: false, children: [] };
    this.chambers.push(ch);
    this.byIdMap.set(ch.id, ch);
    if (parent !== null) this.byIdMap.get(parent).children.push(ch.id);
    return ch;
  }
  byId(id) { return this.byIdMap.get(id); }
  tunnelLen(ch) {
    if (ch.parent === null) return 0;
    const p = this.byId(ch.parent);
    return Math.hypot(ch.x - p.x, ch.y - p.y);
  }
  chamberWork(ch) { return ch.rx * ch.ry * 0.25; }
  area(ch) { return Math.PI * ch.rx * ch.ry; }
  usable(ch) { return ch.parent === null || (ch.tunnelDug >= 1 && ch.dug >= 0.35); }
  usableChambers() { return this.chambers.filter((c) => this.usable(c)); }

  // Path of chamber ids from one chamber to another through the tunnel tree (excluding `from`).
  path(from, to) {
    if (from === to) return [];
    const up = [];
    let n = from;
    const seenFrom = new Map();
    while (n !== null && n !== undefined) { seenFrom.set(n, up.length); up.push(n); n = this.byId(n).parent; }
    const down = [];
    n = to;
    while (!seenFrom.has(n)) { down.push(n); n = this.byId(n).parent; }
    const meet = n;
    const res = up.slice(1, seenFrom.get(meet) + 1);
    down.reverse();
    return res.concat(down);
  }

  chambersOfType(type) { return this.chambers.filter((c) => c.type === type && this.usable(c) && !c.flooded); }
  // Find the best chamber of a type with sensible fallbacks.
  find(type, rng) {
    const order = {
      store: ['store', 'general', 'queen', 'brood'],
      brood: ['brood', 'queen', 'general'],
      refuse: ['refuse', 'general', 'store', 'queen'],
      general: ['general', 'brood', 'store', 'queen'],
      queen: ['queen', 'brood', 'general'],
    }[type] || [type, 'general', 'queen'];
    for (const t of order) {
      const list = this.chambersOfType(t);
      if (list.length) return rng ? rng.pick(list) : list[0];
    }
    const any = this.usableChambers().filter((c) => c.type !== 'entrance' && !c.flooded);
    if (any.length) return rng ? rng.pick(any) : any[0];
    return this.chambers[0];
  }
  deepest() {
    let best = this.chambers[0];
    for (const c of this.chambers) if (this.usable(c) && c.y > best.y && !c.flooded) best = c;
    return best;
  }
  randomPoint(ch, rng) {
    if (ch.type === 'entrance') return { x: ch.x + rng.range(-2, 2), y: ch.y + rng.range(0, 3) };
    const a = rng.angle(), r = Math.sqrt(rng.next()) * 0.72;
    const dug = clamp(ch.dug, 0.35, 1);
    return { x: ch.x + Math.cos(a) * ch.rx * r * dug, y: ch.y + Math.abs(Math.sin(a)) * ch.ry * r * 0.6 * dug + ch.ry * 0.1 };
  }

  // Capacities scale with excavated area.
  adultCapacity() {
    let s = 0;
    for (const c of this.chambers) if (c.type !== 'entrance' && this.usable(c)) s += (this.area(c) * c.dug) / 55;
    return s;
  }
  broodCapacity() {
    let s = 0;
    for (const c of this.chambers) if ((c.type === 'brood' || c.type === 'queen') && this.usable(c)) s += (this.area(c) * c.dug) / 14;
    return s;
  }
  storeChamberArea() {
    let s = 0;
    for (const c of this.chambers) if (c.type === 'store' && this.usable(c)) s += this.area(c) * c.dug;
    return s;
  }

  updateConditions(env) {
    const floodDepth = env.moisture > 0.8 ? (env.moisture - 0.8) * 420 : 0;
    for (const c of this.chambers) {
      c.temp = env.chamberTemp(c.y);
      c.q10 = q10(c.temp);
      c.flooded = c.type !== 'entrance' && c.y < floodDepth;
    }
  }

  // Plan a new chamber branching from an existing one. Returns the planned chamber or null.
  plan(type) {
    if (this.digSite) return null;
    const rng = this.rng, sp = this.sp;
    const parents = this.usableChambers().filter((c) => c.type !== 'refuse');
    const c = sp.nest.chamber, d = sp.nest.depth, spread = sp.nest.spread;
    for (let attempt = 0; attempt < 40; attempt++) {
      const p = rng.pick(parents);
      const downBias = type === 'store' || type === 'general' ? 0.35 : 0.6;
      const ang = Math.PI / 2 + rng.range(-1.35, 1.35) * spread * (1 - downBias * 0.3);
      const len = rng.range(48, 88) * (0.8 + 0.2 * spread);
      const x = p.x + Math.cos(ang) * len * spread;
      const y = p.y + Math.abs(Math.sin(ang)) * len * (0.55 + 0.45 * d);
      const rx = rng.range(18, 30) * c * (type === 'refuse' ? 0.75 : 1);
      const ry = rx * rng.range(0.42, 0.55);
      if (Math.abs(x) > NEST_HALF_WIDTH - rx || y > NEST_MAX_DEPTH * Math.min(1.1, d) || y < 30 + ry) continue;
      let ok = true;
      for (const o of this.chambers) {
        const gap = Math.hypot((x - o.x) / (rx + o.rx + 14), (y - o.y) / (ry + o.ry + 14));
        if (gap < 1) { ok = false; break; }
        // keep the new tunnel's midpoint clear of other chambers
        const mx = (x + p.x) / 2, my = (y + p.y) / 2;
        if (o.id !== p.id && Math.hypot((mx - o.x) / (o.rx + 6), (my - o.y) / (o.ry + 6)) < 1) { ok = false; break; }
      }
      if (!ok) continue;
      const ch = this.add(type, x, y, rx, ry, p.id, 0);
      ch.tunnelDug = 0;
      this.digSite = ch;
      return ch;
    }
    return null;
  }

  // Where diggers stand: the current excavation face.
  digFace() {
    const s = this.digSite;
    if (!s) return null;
    const p = this.byId(s.parent);
    if (s.tunnelDug < 1) {
      const t = s.tunnelDug;
      return { x: p.x + (s.x - p.x) * t, y: p.y + (s.y - p.y) * t, parent: p.id };
    }
    return { x: s.x + this.rng.range(-0.5, 0.5) * s.rx * s.dug, y: s.y + this.rng.range(-0.2, 0.3) * s.ry * s.dug, parent: p.id };
  }

  // Apply excavation work. Returns soil volume removed and whether the site completed.
  dig(work) {
    const s = this.digSite;
    if (!s) return { soil: 0, done: false };
    let done = false;
    if (s.tunnelDug < 1) {
      const len = Math.max(1, this.tunnelLen(s));
      s.tunnelDug = Math.min(1, s.tunnelDug + work / len);
    } else {
      s.dug = Math.min(1, s.dug + work / this.chamberWork(s));
      if (s.dug >= 1) { this.digSite = null; done = true; }
    }
    this.excavated += work;
    return { soil: work, done, chamber: s };
  }
}
