import { TPD, TPH, WORLD_W, WORLD_H, CELL, GRID_W, GRID_H, PRES_CELL, PRES_W, PRES_H, PHERO_INTERVAL,
  MAX_COLONIES, MAX_LIVING, COLONY_COLORS, FOOD_KINDS, SEASONS, clamp, q10 } from './constants.js';
import { RNG, hashSeed } from './rng.js';
import { Environment } from './environment.js';
import { SpatialHash } from './spatial.js';
import { Food } from './food.js';
import { Colony } from './colony.js';
import { Ant, updateAnt, decideTask, enterNest, nestGo } from './ant.js';
import { SPECIES } from './species.js';

const buf = [];

// The persistent world state plus the simulation engine that advances it.
// Nothing in here touches the DOM, so it runs identically in the browser, in Node and in tests.
export class World {
  constructor(opts = {}) {
    this.seed = opts.seed ?? 'formicarium';
    this.seedNum = typeof this.seed === 'number' ? this.seed : hashSeed(this.seed);
    this.rng = new RNG(this.seedNum);
    this.W = WORLD_W; this.H = WORLD_H;
    this.tick = 0;
    this.idCounter = 1;
    this.env = new Environment(this.rng.fork('env'));
    this.colonies = [];
    this.ants = [];
    this.foods = [];
    this.foodById = new Map();
    this.prey = [];
    this.events = [];
    this.ledger = { sources: { initial: 0, natural: 0, player: 0, carcass: 0 },
      sinks: { metabolism: 0, decay: 0, spoilage: 0, waste: 0, tissue: 0, broodLoss: 0, mortality: 0, dispersal: 0 } };
    this.antHash = new SpatialHash(WORLD_W, WORLD_H, 16);
    this.foodHash = new SpatialHash(WORLD_W, WORLD_H, 32);
    this.obstacle = new Uint8Array(GRID_W * GRID_H);
    this.presence = [];
    this.territoryOwner = new Int8Array(PRES_W * PRES_H).fill(-1);
    this.deadCount = 0;
    this.pairsFought = new Set();
    this.battleTally = new Map();
    this.flightsToday = new Set();
    this.lastFlightDay = -1;
    this.q10Surface = 1;
    this.generateTerrain();
    const species = SPECIES[opts.species || 'lasius'];
    if (opts.colony !== false) this.addColony(species.id, WORLD_W / 2, WORLD_H / 2, { source: 'initial', name: opts.colonyName });
    if (opts.naturalFood !== false) this.seedNaturalFood();
  }

  nextId() { return this.idCounter++; }
  sink(kind, amount) { this.ledger.sinks[kind] += amount; }
  source(kind, amount) { this.ledger.sources[kind] += amount; }

  // ---------------------------------------------------------------- terrain
  generateTerrain() {
    const r = this.rng.fork('terrain');
    this.stones = [];
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    const clusters = 7;
    for (let k = 0; k < clusters; k++) {
      const gx = r.range(80, WORLD_W - 80), gy = r.range(80, WORLD_H - 80);
      const n = r.int(2, 6);
      for (let i = 0; i < n; i++) this.tryStone(r, gx + r.normal() * 40, gy + r.normal() * 40, r.range(6, 22), cx, cy);
    }
    for (let i = 0; i < 22; i++) this.tryStone(r, r.range(30, WORLD_W - 30), r.range(30, WORLD_H - 30), r.range(4, 14), cx, cy);
    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        const x = (gx + 0.5) * CELL, y = (gy + 0.5) * CELL;
        for (const s of this.stones) {
          if (Math.hypot(x - s.x, y - s.y) < s.r * 0.92) { this.obstacle[gy * GRID_W + gx] = 1; break; }
        }
      }
    }
    // Vegetation: grass tufts (seed sources), aphid-hosting herbs (honeydew), shrubs (fruit).
    this.plants = [];
    const place = (type, n, rmin, rmax = 1e9) => {
      for (let i = 0; i < n; i++) {
        for (let t = 0; t < 60; t++) {
          const x = r.range(40, WORLD_W - 40), y = r.range(40, WORLD_H - 40);
          const dc = Math.hypot(x - cx, y - cy);
          if (dc < rmin || dc > rmax || this.blocked(x, y)) continue;
          if (this.plants.some((p) => Math.hypot(p.x - x, p.y - y) < 30)) continue;
          this.plants.push({ id: this.plants.length, type, x, y, size: r.range(0.8, 1.3), seed: r.next(), seedHead: type === 'grass' && r.next() < 0.5 });
          break;
        }
      }
    };
    place('herb', 3, 110, 300);
    place('herb', 5, 160);
    place('shrub', 4, 220);
    place('grass', 34, 70);
  }
  tryStone(r, x, y, rad, cx, cy) {
    if (x < 20 || y < 20 || x > WORLD_W - 20 || y > WORLD_H - 20) return;
    if (Math.hypot(x - cx, y - cy) < 90 + rad) return;
    const pts = [];
    const n = 9;
    for (let i = 0; i < n; i++) pts.push(r.range(0.82, 1.1));
    this.stones.push({ x, y, r: rad, shape: pts, tone: r.range(0.75, 1.1), rot: r.angle() });
  }
  blocked(x, y) {
    if (x < 3 || y < 3 || x > WORLD_W - 3 || y > WORLD_H - 3) return true;
    return this.obstacle[Math.floor(y / CELL) * GRID_W + Math.floor(x / CELL)] === 1;
  }
  seedNaturalFood() {
    const r = this.rng;
    for (const p of this.plants) {
      if (p.type === 'herb') {
        const f = this.makeFood('honeydew', p.x + r.range(-4, 4), p.y + r.range(-4, 4), 20, 'initial', { maxMass: 55, regen: 32, plantId: p.id });
        p.food = f;
      }
    }
    for (let i = 0; i < 4; i++) {
      const pt = this.randomFreePoint(r, i < 2 ? 0 : 120);
      this.makeFood('insect', pt.x, pt.y, r.range(6, 18), 'initial', { variant: r.int(0, 2), heading: r.angle() });
    }
    for (const p of this.plants.filter((q) => q.type === 'grass')) {
      if (p.seedHead) p.food = this.makeFood('seed', p.x, p.y, r.range(6, 14), 'initial', { maxMass: 26, regen: 9, plantId: p.id });
      const n = r.int(0, 2);
      for (let i = 0; i < n; i++) {
        const x = p.x + r.normal() * 12, y = p.y + r.normal() * 12;
        if (!this.blocked(x, y)) this.makeFood('seed', x, y, r.range(1.0, 3.0), 'initial', { heading: r.angle() });
      }
    }
  }
  randomFreePoint(r, minFromCenter = 0) {
    for (let t = 0; t < 100; t++) {
      const x = r.range(30, WORLD_W - 30), y = r.range(30, WORLD_H - 30);
      if (this.blocked(x, y)) continue;
      if (minFromCenter && this.colonies.some((c) => Math.hypot(c.x - x, c.y - y) < minFromCenter)) continue;
      return { x, y };
    }
    return { x: WORLD_W / 2 + 50, y: WORLD_H / 2 };
  }

  // ---------------------------------------------------------------- food
  makeFood(kind, x, y, mass, source, opts = {}) {
    const f = new Food(this.nextId(), kind, x, y, mass, { ...opts, source });
    this.foods.push(f);
    this.foodById.set(f.id, f);
    this.source(source, mass);
    return f;
  }
  // Remove a food item. If sinkRemainder, any mass left is accounted as decay.
  removeFood(f, sinkRemainder = true) {
    if (!this.foodById.has(f.id)) return;
    this.foodById.delete(f.id);
    if (sinkRemainder && f.mass > 0) { this.sink('decay', f.mass); f.mass = 0; }
    for (const c of f.carriers) if (c.target === f && c.mode === 'coop') { c.mode = 'search'; c.target = null; }
    f.carriers.length = 0;
    this.foodDirty = true;
  }
  // Player action: place food. Returns true on success.
  placeFood(kind, x, y) {
    if (!FOOD_KINDS[kind] || kind === 'honeydew' || kind === 'corpse') return false;
    if (this.blocked(x, y)) return false;
    const r = this.rng;
    if (kind === 'seed') {
      for (let i = 0; i < 8; i++) {
        const sx = x + r.normal() * 7, sy = y + r.normal() * 7;
        if (!this.blocked(sx, sy)) this.makeFood('seed', sx, sy, r.range(1.0, 3.4), 'player', { heading: r.angle() });
      }
    } else if (kind === 'insect') {
      this.makeFood('insect', x, y, r.range(14, 30), 'player', { variant: r.int(0, 2), heading: r.angle() });
    } else {
      this.makeFood(kind, x, y, FOOD_KINDS[kind].placeMass, 'player', { heading: r.angle(), variant: r.int(0, 2) });
    }
    this.event('player', `Placed ${FOOD_KINDS[kind].label.toLowerCase()}`, null, 'minor');
    return true;
  }

  // ---------------------------------------------------------------- colonies and ants
  canPlaceColony(x, y) {
    if (this.blocked(x, y) || x < 40 || y < 40 || x > WORLD_W - 40 || y > WORLD_H - 40) return 'Too close to the edge or a stone';
    if (this.colonies.length >= MAX_COLONIES) return `The world can hold at most ${MAX_COLONIES} colonies, living or extinct`;
    if (this.colonies.filter((c) => c.alive).length >= MAX_LIVING) return `At most ${MAX_LIVING} living colonies are supported`;
    for (const c of this.colonies) if (Math.hypot(c.x - x, c.y - y) < 150) return 'Too close to another nest (keep at least 150 units apart)';
    return null;
  }
  addColony(speciesId, x, y, opts = {}) {
    const sp = SPECIES[speciesId];
    const err = opts.force ? null : this.canPlaceColony(x, y);
    if (err) return err;
    const id = this.colonies.length;
    const col = new Colony(this, id, sp, x, y, { color: COLONY_COLORS[id % COLONY_COLORS.length], incipient: opts.incipient,
      name: opts.name, parentId: opts.parentId });
    this.colonies.push(col);
    this.presence.push(new Float32Array(PRES_W * PRES_H));
    const src = opts.source || 'player';
    if (opts.incipient) {
      const q = opts.queen;
      q.colony = col; q.colonyId = col.id; q.caste = 'queen'; q.task = 'queen'; q.flying = false; q.z = 0;
      q.loc = 'nest'; q.cur = 1; const qc = col.nest.byId(1); q.ux = qc.x; q.uy = qc.y; q.dest = null; q.path = [];
      q.lifespan = sp.queenLifespan * TPD * this.rng.range(0.8, 1.2); q.age = 0;
      q.speedMul = 0.45; q.maxHp = sp.hp * 1.5 * (q.size / sp.size) ** 2; q.hp = q.maxHp;
      col.queens.push(q); col.ants.push(q);
      this.event('founding', `A ${sp.name.toLowerCase()} queen founded ${col.name}`, col, 'good');
    } else {
      // A starter colony: queen(s), workers, brood and small reserves.
      const r = col.rng;
      for (let i = 0; i < sp.queens; i++) {
        const q = new Ant(this.nextId(), col, 'queen', r, { energy: sp.founderEnergy * 0.7, age: r.range(30, 60) * TPD });
        this.source(src, q.energy);
        this.placeInChamber(col, q, 'queen');
        this.addAnt(q);
      }
      for (let i = 0; i < sp.startWorkers; i++) {
        const caste = sp.majorFraction > 0 && r.next() < sp.majorFraction * 0.7 ? 'major' : 'worker';
        const a = new Ant(this.nextId(), col, caste, r, { age: r.range(2, 30) * TPD });
        a.energy = a.maxEnergy * r.range(0.6, 0.9);
        this.source(src, a.energy);
        this.placeInChamber(col, a, r.pick(['general', 'brood', 'store', 'queen']));
        this.addAnt(a);
        decideTask(this, a);
      }
      const qch = col.nest.find('brood', null);
      for (let i = 0; i < sp.startBrood; i++) {
        const stage = i % 3 === 0 ? 'egg' : i % 3 === 1 ? 'larva' : 'pupa';
        const p = col.nest.randomPoint(qch, r);
        const b = { id: this.nextId(), stage, progress: r.range(0, 0.6), mass: sp.eggCost, fedP: 0, fedC: 0, needP: 0, needC: 0,
          caste: 'worker', chamber: qch.id, x: p.x, y: p.y, starve: 0, dead: false, born: this.tick };
        if (stage !== 'egg') { col.decideCaste(this, b); b.caste = 'worker'; b.needP = sp.larvaNeed.p; b.needC = sp.larvaNeed.c;
          b.fedP = stage === 'pupa' ? b.needP : b.needP * b.progress; b.fedC = stage === 'pupa' ? b.needC : b.needC * b.progress; b.mass += b.fedP + b.fedC; }
        this.source(src, b.mass);
        col.brood.push(b);
      }
      col.stores.c = 24; col.stores.p = 10;
      if (sp.granary) col.stores.seed = 40;
      this.source(src, col.stores.c + col.stores.p + col.stores.seed);
      if (src === 'player') this.event('colony', `Introduced ${col.name}`, col, 'good');
    }
    col.slowUpdate(this);
    return col;
  }
  placeInChamber(col, a, type) {
    const ch = col.nest.find(type, col.rng);
    const p = col.nest.randomPoint(ch, col.rng);
    a.cur = ch.id; a.ux = p.x; a.uy = p.y; a.loc = 'nest';
  }
  addAnt(a) {
    this.ants.push(a);
    a.colony.ants.push(a);
    if (a.caste === 'queen' && !a.colony.queens.includes(a)) a.colony.queens.push(a);
  }

  killAnt(a, cause) {
    if (a.dead) return;
    a.dead = true;
    a.cause = cause;
    this.deadCount++;
    const col = a.colony;
    col.stats.deaths++;
    col.stats.causes[cause] = (col.stats.causes[cause] || 0) + 1;
    this.sink('mortality', a.energy + a.crop);
    a.energy = 0; a.crop = 0; a.cropP = 0;
    if (a.carry && a.carry.type === 'food') {
      // Dropped food stays in the world and can be picked up (or stolen) by others.
      const x = a.loc === 'surface' ? a.x : col.x, y = a.loc === 'surface' ? a.y : col.y;
      const f = new Food(this.nextId(), a.carry.kind, x, y, a.carry.mass, { heading: a.heading, size: a.carry.size, species: a.carry.species });
      if (a.loc === 'surface') { this.foods.push(f); this.foodById.set(f.id, f); }
      else col.deposit(this, a.carry.kind, a.carry.mass, a.carry.pFrac);
    }
    if (a.carry && a.carry.type === 'brood') {
      const b = a.carry.b;
      if (!b.dead) { b.chamber = a.cur; b.x = a.ux; b.y = a.uy; }
    }
    if (a.carry && a.carry.type === 'corpse') { a.carry.c.carried = false; a.carry.c.chamber = a.cur; a.carry.c.x = a.ux; a.carry.c.y = a.uy; }
    a.carry = null;
    if (a.target && a.target.carriers) a.target.carriers = a.target.carriers.filter((c) => c !== a);
    if (a.flying) return;
    if (a.loc === 'surface') {
      const mass = 0.1 * a.size;
      this.makeFood('corpse', a.x, a.y, mass, 'carcass', { colonyId: col.id, species: a.sp.id, caste: a.caste, size: a.size, heading: a.heading });
    } else {
      col.nest.corpses.push({ x: a.ux, y: a.uy, chamber: a.cur, caste: a.caste, size: a.size, species: a.sp.id, tick: this.tick, heading: this.rng.angle(), carried: false });
      if (col.nest.corpses.length > 400) col.nest.corpses.shift();
    }
    if (a.caste === 'queen') {
      col.queens = col.queens.filter((q) => q !== a);
      const left = col.queens.length;
      this.event('queen', `A queen of ${col.name} died (${cause})${left ? `; ${left} remain` : '; the colony is now queenless'}`, col, 'bad');
    }
  }

  // ---------------------------------------------------------------- prey (living insects)
  spawnPrey() {
    const r = this.rng;
    const side = r.int(0, 3);
    const x = side === 0 ? 5 : side === 1 ? WORLD_W - 5 : r.range(10, WORLD_W - 10);
    const y = side === 2 ? 5 : side === 3 ? WORLD_H - 5 : r.range(10, WORLD_H - 10);
    const size = r.range(5, 11);
    this.prey.push({ id: this.nextId(), x, y, heading: Math.atan2(WORLD_H / 2 - y, WORLD_W / 2 - x) + r.normal() * 0.6,
      size, hp: size * 1.6, maxHp: size * 1.6, life: r.range(1, 3) * TPD, age: 0, fleeing: 0, dead: false, kind: r.int(0, 2), gait: 0 });
  }
  updatePrey() {
    const r = this.rng;
    for (const p of this.prey) {
      p.age++;
      const spd = p.fleeing > 0 ? 1.1 : 0.45;
      if (p.fleeing > 0) p.fleeing--;
      p.heading += r.normal() * 0.15;
      const nx = p.x + Math.cos(p.heading) * spd, ny = p.y + Math.sin(p.heading) * spd;
      if (this.blocked(nx, ny)) p.heading += Math.PI * 0.7; else { p.x = nx; p.y = ny; p.gait += spd; }
      if (p.age > p.life) this.killPrey(p);
      if (p.x < -10 || p.y < -10 || p.x > WORLD_W + 10 || p.y > WORLD_H + 10) p.dead = true;
    }
    if (this.prey.some((p) => p.dead)) this.prey = this.prey.filter((p) => !p.dead);
  }
  killPrey(p) {
    if (p.dead) return;
    p.dead = true;
    if (!this.blocked(p.x, p.y)) this.makeFood('insect', p.x, p.y, p.size * 1.3, 'natural', { variant: p.kind, heading: p.heading });
  }

  // ---------------------------------------------------------------- natural resources
  hourlyNature() {
    const env = this.env, r = this.rng, s = env.season;
    const warm = clamp((env.temp - 6) / 14, 0, 1);
    const sf = [0.75, 1, 0.65, 0.08][s] * (0.4 + 0.6 * warm);
    const natural = this.foods.filter((f) => f.source !== 'player').length;
    if (natural < 110) {
      if (r.next() < 0.28 * sf) {
        const pt = this.randomFreePoint(r);
        this.makeFood('insect', pt.x, pt.y, r.range(5, 26), 'natural', { variant: r.int(0, 2), heading: r.angle() });
      }
      for (const p of this.plants) {
        if (p.type === 'grass' && s !== 3 && r.next() < (s === 0 ? 0.02 : 0.05)) {
          const n = r.int(1, 3);
          for (let i = 0; i < n; i++) {
            const x = p.x + r.normal() * 12, y = p.y + r.normal() * 12;
            if (!this.blocked(x, y)) this.makeFood('seed', x, y, r.range(1.0, 3.2), 'natural', { heading: r.angle() });
          }
        }
        if (p.type === 'shrub' && ((s === 1 && env.seasonDay > 4) || s === 2) && r.next() < 0.02) {
          const x = p.x + r.normal() * 16, y = p.y + r.normal() * 16;
          if (!this.blocked(x, y)) this.makeFood('fruit', x, y, r.range(50, 110), 'natural', { heading: r.angle(), variant: r.int(0, 2) });
        }
      }
    }
    if (this.prey.length < 9 && env.temp > 11 && r.next() < 0.3 * sf) this.spawnPrey();
  }
  updateFood() {
    const env = this.env;
    const n = 10;
    const doTick = this.tick % n === 0;
    const herbGrowth = env.season !== 3 && !(env.season === 2 && env.seasonDay > 5) && env.temp > 12;
    const seedGrowth = env.season === 1 || env.season === 2 || (env.season === 0 && env.seasonDay > 3);
    for (const f of this.foods) {
      if (f.regen) {
        if ((f.kind === 'seed' ? seedGrowth : herbGrowth) && f.mass < f.maxMass) {
          const tf = f.kind === 'seed' ? clamp((env.temp - 6) / 12, 0.2, 1) : clamp((env.temp - 12) / 10, 0, 1.2);
          const add = Math.min(f.maxMass - f.mass, (f.regen / TPD) * tf);
          f.mass += add; this.source('natural', add);
        }
        continue;
      }
      if (!doTick) continue;
      f.age += n;
      const d = f.def.decay;
      if (d > 0) {
        let rate = (d / TPD) * n * q10(env.temp) * 1.6;
        if (f.kind === 'sugar') rate *= 1 + env.rain * 6; // rain dilutes and washes sugar away
        const loss = f.mass * rate + (f.mass < 0.3 ? 0.003 : 0);
        const l = Math.min(f.mass, loss);
        f.mass -= l; this.sink('decay', l);
      }
      if (f.mass <= 0.02 && !f.carriers.length) this.removeFood(f, true);
    }
    if (this.foodDirty || this.tick % 25 === 0) {
      this.foods = this.foods.filter((f) => this.foodById.has(f.id));
      this.foodDirty = false;
    }
  }
  // Cooperative transport of medium-sized items.
  updateCoop() {
    for (const f of this.foods) {
      if (!f.carriers.length) { f.moving = false; continue; }
      f.carriers = f.carriers.filter((a) => !a.dead && a.mode === 'coop' && a.target === f && a.loc === 'surface');
      if (!f.carriers.length) { f.moving = false; continue; }
      const col = f.carriers[0].colony;
      let cap = 0;
      for (const a of f.carriers) cap += a.carryCap;
      const n = f.carriers.length;
      if (cap >= f.mass * 0.85) {
        f.moving = true;
        const dx = col.x - f.x, dy = col.y - f.y, d = Math.hypot(dx, dy);
        const spd = 0.32 * Math.min(1.25, cap / f.mass) * f.carriers[0].sp.speed;
        let nx = f.x + (dx / d) * spd, ny = f.y + (dy / d) * spd;
        if (this.blocked(nx, ny)) {
          const side = (f.id % 2 ? 1 : -1);
          nx = f.x + (-dy / d) * spd * side; ny = f.y + (dx / d) * spd * side;
          if (this.blocked(nx, ny)) { nx = f.x; ny = f.y; }
        }
        f.x = nx; f.y = ny; f.heading = Math.atan2(dy, dx);
        for (let i = 0; i < n; i++) {
          const a = f.carriers[i];
          const ang = (i / n) * Math.PI * 2 + f.id;
          a.x = f.x + Math.cos(ang) * (f.radius + 2); a.y = f.y + Math.sin(ang) * (f.radius + 2);
          a.heading = Math.atan2(f.y - a.y, f.x - a.x);
          a.gait += spd; a.act = 3.5;
          if (i < 2) col.pher.depositTrail(f.x, f.y, a.sp.trailStrength * 0.6);
        }
        if (d < 6) {
          const carriers = f.carriers.slice();
          col.deposit(this, f.kind, f.mass, f.pFrac);
          this.colonyStat(col, 'trips', carriers.length);
          f.mass = 0;
          this.removeFood(f, false);
          for (const a of carriers) { a.target = null; a.mode = ''; a.memory.food = null; enterNest(this, a); }
        }
      } else f.moving = false;
    }
  }

  colonyStat(col, key, v) { col.stats[key] += v; }

  // ---------------------------------------------------------------- combat
  encounters() {
    const t = this.tick, r = this.rng;
    const multi = this.colonies.filter((c) => c.alive).length > 1;
    for (const a of this.ants) {
      if (a.dead || a.loc !== 'surface' || a.flying || a.fightTarget) continue;
      if ((a.id + t) % 3 !== 0) continue;
      if (a.caste === 'queen' || a.caste === 'gyne' || a.caste === 'male' || a.mode === 'flee') continue;
      // Predation on living insects.
      if (this.prey.length && a.task === 'forage' && a.mode === 'search' && !a.carry && a.crop < 0.05) {
        for (const p of this.prey) {
          if (Math.abs(p.x - a.x) < 12 && Math.abs(p.y - a.y) < 12 && r.next() < a.sp.hunts * 0.3) {
            a.mode = 'hunt'; a.target = p; a.timer = 0; break;
          }
        }
      }
      if (!multi) continue;
      const near = this.antHash.near(a.x, a.y, 10, buf);
      let enemy = null, ed = 1e9, mates = 0, enemies = 0;
      for (const n of near) {
        if (n === a || n.dead || n.flying) continue;
        if (n.colony === a.colony) { mates++; continue; }
        enemies++;
        if (n.mode === 'flee' || n.loc !== 'surface') continue; // retreating ants are left alone
        const d = Math.hypot(n.x - a.x, n.y - a.y);
        if (d < ed) { ed = d; enemy = n; }
      }
      if (!enemy) continue;
      const col = a.colony, sp = a.sp;
      const dOwn = Math.hypot(col.x - a.x, col.y - a.y);
      const dTheirs = Math.hypot(enemy.colony.x - a.x, enemy.colony.y - a.y);
      let terr = dOwn < dTheirs ? 1.4 : 0.75;
      if (dOwn < 120) terr = 2;
      const alarm = col.pher.sampleAlarm(a.x, a.y);
      let agg = sp.aggression * terr * (1 + 0.5 * Math.log((mates + 1) / (enemies + 1)))
        * (a.task === 'defend' ? 2 : 1) * (a.carry || a.crop > 0.05 ? 0.55 : 1)
        * (1 + 0.6 * col.stim.forage) * (1 + Math.min(alarm, 4) * 0.25)
        * (enemy.carry && enemy.carry.type === 'food' ? 1.4 : 1)
        * Math.sqrt(a.size / enemy.size) * (a.injured ? 0.5 : 1);
      if (enemy.colony.species === col.species) agg *= 1.15; // intraspecific territoriality
      const pFight = Math.max(0, agg - 0.45) * 0.3;
      const roll = r.next();
      if (roll < pFight) this.startFight(a, enemy);
      else if (agg < 0.55) { a.heading = Math.atan2(a.y - enemy.y, a.x - enemy.x) + r.normal() * 0.4; a.avoidT = 18; }
      else if (a.pause === 0 && roll < 0.5) { a.pause = 8; col.pher.depositAlarm(a.x, a.y, 0.25); }
    }
  }
  startFight(a, b) {
    a.fightTarget = b;
    if (!b.fightTarget) b.fightTarget = a;
    for (const x of [a, b]) {
      if (x.mode === 'coop' && x.target) { x.target.carriers = x.target.carriers.filter((c) => c !== x); x.mode = 'search'; x.target = null; }
      if (x.carry && x.carry.type === 'food') {
        // Dropping the load during a fight makes theft possible.
        const f = new Food(this.nextId(), x.carry.kind, x.x, x.y, x.carry.mass, { heading: x.heading, size: x.carry.size, species: x.carry.species });
        this.foods.push(f); this.foodById.set(f.id, f);
        x.carry = null; x.layTrail = false;
        if (x.mode === 'return') x.mode = 'search';
      }
    }
    const key = Math.min(a.colonyId, b.colonyId) + ':' + Math.max(a.colonyId, b.colonyId);
    if (!this.pairsFought.has(key)) {
      this.pairsFought.add(key);
      this.event('conflict', `First clash between ${a.colony.name} and ${b.colony.name}`, a.colony, 'warn');
    }
  }
  processFights() {
    const r = this.rng;
    for (const a of this.ants) {
      const b = a.fightTarget;
      if (!b || a.dead) continue;
      if (b.dead || b.loc !== 'surface' || a.loc !== 'surface' || Math.hypot(b.x - a.x, b.y - a.y) > 16) { a.fightTarget = null; continue; }
      a.act = 5;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d > 5) { a.x += ((b.x - a.x) / d) * 0.6; a.y += ((b.y - a.y) / d) * 0.6; }
      a.heading = Math.atan2(b.y - a.y, b.x - a.x);
      a.gait += 0.4;
      b.hp -= a.attack * 0.022 * (0.5 + r.next()) * (a.injured ? 0.7 : 1);
      if (b.hp < b.maxHp * 0.5) b.injured = true;
      if (this.tick % 8 === a.id % 8) {
        a.colony.pher.depositAlarm(a.x, a.y, 1.2);
        for (const c of [a.colony, b.colony]) {
          if (Math.hypot(c.x - a.x, c.y - a.y) < 240) { c.alarm = Math.min(1.5, c.alarm + 0.04); c.threat = { x: a.x, y: a.y, tick: this.tick }; }
        }
      }
      if (b.hp <= 0) {
        this.killAnt(b, 'combat');
        a.colony.stats.kills++;
        a.fightTarget = null;
        const key = a.colonyId + ':' + b.colonyId;
        this.battleTally.set(key, (this.battleTally.get(key) || 0) + 1);
        continue;
      }
      if (a.hp < a.maxHp * 0.4 && r.next() < 0.04) {
        a.fightTarget = null; a.mode = 'flee'; a.injured = true;
        if (b.fightTarget === a) b.fightTarget = null;
      }
    }
  }

  // ---------------------------------------------------------------- reproduction: nuptial flights
  checkFlights() {
    const env = this.env;
    if (env.day !== this.lastFlightDay) { this.flightsToday.clear(); this.lastFlightDay = env.day; }
    const h = env.hour;
    if (env.season !== 1 || h < 13 || h > 19 || env.temp < 20 || env.raining || env.moisture < 0.25) return;
    for (const sp of Object.values(SPECIES)) {
      if (this.flightsToday.has(sp.id)) continue;
      const cols = this.colonies.filter((c) => c.alive && c.species === sp && c.counts.gynes + c.counts.males > 0);
      if (!cols.length || this.rng.next() > 0.3) continue;
      this.flightsToday.add(sp.id);
      let n = 0;
      for (const c of cols) {
        for (const a of c.ants) {
          if (a.dead || (a.caste !== 'gyne' && a.caste !== 'male') || a.energy < a.maxEnergy * 0.5) continue;
          if (a.caste === 'gyne' && sp.adoptsQueens && c.queens.length < 8 && this.rng.next() < 0.3) {
            // Secondary polygyny: some daughter queens are re-adopted by their own colony.
            a.caste = 'queen'; a.task = 'queen'; a.lifespan = sp.queenLifespan * TPD * this.rng.range(0.6, 1); a.age = 0;
            a.speedMul = 0.45; c.queens.push(a);
            continue;
          }
          a.task = 'flight'; a.mode = ''; a.dest = null; a.path = [];
          n++;
        }
      }
      if (n) this.event('flight', `Nuptial flight: ${n} ${sp.name.toLowerCase()} alates took to the air`, cols[0], 'good');
    }
  }
  resolveFlight(a) {
    const sp = a.sp, r = this.rng;
    a.dead = true; a.cause = 'dispersal';
    this.deadCount++;
    const col = a.colony;
    if (a.caste === 'gyne' && r.next() < 0.07) {
      for (let t = 0; t < 25; t++) {
        const x = r.range(60, WORLD_W - 60), y = r.range(60, WORLD_H - 60);
        if (this.canPlaceColony(x, y)) continue;
        if (this.colonies.some((c) => Math.hypot(c.x - x, c.y - y) < 130)) continue;
        a.dead = false; this.deadCount--;
        const newCol = this.addColony(sp.id, x, y, { incipient: true, queen: a, parentId: col.id, force: true });
        col.ants = col.ants.filter((k) => k !== a);
        return;
      }
    }
    this.sink('dispersal', a.energy + a.crop);
    a.energy = 0;
  }

  // ---------------------------------------------------------------- territory
  updatePresence() {
    const t = this.tick;
    if (t % 10 === 0) {
      for (const a of this.ants) {
        if (a.dead || a.loc !== 'surface' || a.flying) continue;
        const cx = Math.floor(a.x / PRES_CELL), cy = Math.floor(a.y / PRES_CELL);
        if (cx < 0 || cy < 0 || cx >= PRES_W || cy >= PRES_H) continue;
        this.presence[a.colonyId][cy * PRES_W + cx] += 1;
      }
    }
    if (t % 100 === 0) {
      const counts = new Array(this.colonies.length).fill(0);
      for (let i = 0; i < PRES_W * PRES_H; i++) {
        let best = -1, bv = 2.5;
        for (let c = 0; c < this.presence.length; c++) {
          const p = this.presence[c];
          p[i] *= 0.93;
          if (p[i] > bv) { bv = p[i]; best = c; }
        }
        this.territoryOwner[i] = best;
        if (best >= 0) counts[best]++;
      }
      for (const c of this.colonies) c.territory = +(counts[c.id] * PRES_CELL * PRES_CELL / (WORLD_W * WORLD_H) * 100).toFixed(1);
    }
  }

  // ---------------------------------------------------------------- main step
  step() {
    this.tick++;
    const env = this.env;
    const wasRaining = env.raining, season = env.season;
    env.step();
    this.q10Surface = q10(env.temp);
    if (env.raining && !wasRaining && env.rainTarget > 0.6) this.event('weather', 'Heavy rain begins', null, 'minor');
    if (env.season !== season) this.event('season', `${SEASONS[env.season]} begins (year ${env.year})`, null, 'season');
    if (this.tick % PHERO_INTERVAL === 0) {
      const wash = 1 - env.rain * 0.006;
      for (const c of this.colonies) c.pher.decay(PHERO_INTERVAL, wash);
    }
    // spatial indices
    this.foodHash.clear();
    for (const f of this.foods) if (this.foodById.has(f.id)) this.foodHash.insert(f);
    this.antHash.clear();
    for (const a of this.ants) if (a.loc === 'surface' && !a.dead && !a.flying) this.antHash.insert(a);

    if (this.tick % TPH === 0) { this.hourlyNature(); this.checkFlights(); this.battleReport(); }
    this.updateFood();
    this.updatePrey();
    for (const c of this.colonies) c.update(this);
    const n = this.ants.length;
    for (let i = 0; i < n; i++) {
      const a = this.ants[i];
      if (!a.dead) updateAnt(this, a);
    }
    this.updateCoop();
    this.encounters();
    this.processFights();
    if (this.deadCount > 0) {
      this.ants = this.ants.filter((a) => !a.dead);
      for (const c of this.colonies) if (c.ants.some((a) => a.dead)) c.ants = c.ants.filter((a) => !a.dead);
      this.deadCount = 0;
    }
    this.updatePresence();
    if (this.tick % (TPH * 2) === 0) for (const c of this.colonies) if (c.alive) c.recordHistory(this);
  }
  battleReport() {
    for (const [key, n] of this.battleTally) {
      if (n >= 8) {
        const [ai, bi] = key.split(':').map(Number);
        this.event('battle', `Battle: ${this.colonies[ai].name} killed ${n} ants of ${this.colonies[bi].name} in the last hour`, this.colonies[ai], 'warn');
      }
    }
    this.battleTally.clear();
  }

  event(type, text, colony, tone = 'minor') {
    this.events.push({ tick: this.tick, type, text, colonyId: colony ? colony.id : null, tone });
    if (this.events.length > 600) this.events.shift();
  }

  // ---------------------------------------------------------------- inspection helpers
  antAt(x, y, r = 8) {
    let best = null, bd = r;
    for (const a of this.ants) {
      if (a.dead || a.loc !== 'surface') continue;
      const d = Math.hypot(a.x - x, a.y - y);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
  colonyAt(x, y, r = 22) {
    let best = null, bd = r;
    for (const c of this.colonies) {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < Math.max(bd, c.moundRadius()) && d < (best ? bd : 1e9)) { bd = d; best = c; }
    }
    return best;
  }

  // ---------------------------------------------------------------- resource accounting
  stockTotal() {
    let s = 0;
    for (const f of this.foods) if (this.foodById.has(f.id)) s += f.mass;
    for (const a of this.ants) {
      if (a.dead) continue;
      s += a.energy + a.crop;
      if (a.carry && a.carry.type === 'food') s += a.carry.mass;
    }
    for (const c of this.colonies) {
      s += c.stores.c + c.stores.p + c.stores.seed;
      for (const b of c.brood) if (!b.dead) s += b.mass;
    }
    return s;
  }
  ledgerCheck() {
    const src = Object.values(this.ledger.sources).reduce((a, b) => a + b, 0);
    const snk = Object.values(this.ledger.sinks).reduce((a, b) => a + b, 0);
    const stock = this.stockTotal();
    return { sources: src, sinks: snk, stock, error: src - snk - stock, relError: Math.abs(src - snk - stock) / Math.max(1, src) };
  }
  // Compact fingerprint of the state for determinism checks.
  hash() {
    let h = 2166136261 >>> 0;
    const mix = (v) => { h ^= Math.round(v * 1000) | 0; h = Math.imul(h, 16777619) >>> 0; };
    mix(this.tick); mix(this.ants.length); mix(this.foods.length);
    for (const a of this.ants) { mix(a.id); mix(a.x); mix(a.y); mix(a.energy); mix(a.ux); }
    for (const c of this.colonies) { mix(c.stores.c); mix(c.stores.p); mix(c.brood.length); }
    return h.toString(16);
  }
}

export { SPECIES };
