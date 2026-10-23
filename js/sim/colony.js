import { TPD, TPH, clamp, devFactor, q10, SEASONS } from './constants.js';
import { Nest } from './nest.js';
import { PheromoneField } from './pheromone.js';
import { Ant, decideTask } from './ant.js';

const MILESTONES = [50, 100, 250, 500, 1000, 2000];

// A colony: queen(s), workers, brood, nutrient stores, nest structure and pheromone network.
export class Colony {
  constructor(w, id, species, x, y, opts = {}) {
    this.id = id;
    this.species = species;
    this.x = x; this.y = y;
    this.color = opts.color;
    this.name = opts.name || `${species.name} colony ${id + 1}`;
    this.rng = w.rng.fork('colony' + id);
    this.nest = new Nest(species, this.rng, !!opts.incipient);
    this.pher = new PheromoneField(species.trailHalfLife);
    this.stores = { c: 0, p: 0, seed: 0 };
    this.brood = [];
    this.ants = [];
    this.queens = [];
    this.founded = w.tick;
    this.founding = !!opts.incipient;
    this.parentId = opts.parentId ?? null;
    this.extinct = false;
    this.extinctTick = null;
    this.dormant = false;
    this.surfaceOK = true;
    this.alarm = 0;
    this.threat = null;
    this.mound = opts.incipient ? 2 : this.nest.excavated * 0.25;
    this.stim = { forage: 0.5, nurse: 0, dig: 0, clean: 0, defend: 0, mill: 0, protein: 0, full: 0 };
    this.counts = { workers: 0, majors: 0, queens: 0, gynes: 0, males: 0, eggs: 0, larvae: 0, pupae: 0,
      foragers: 0, surface: 0, adults: 0, hungryLarvae: 0, avgEnergy: 0, tasks: {} };
    this.stats = { births: 0, deaths: 0, eggsLaid: 0, gathered: 0, gatheredC: 0, gatheredP: 0, gatheredSeed: 0,
      wasted: 0, trips: 0, peak: 0, kills: 0, broodDeaths: 0, causes: {} };
    this.history = { t: [], workers: [], majors: [], queens: [], alates: [], eggs: [], larvae: [], pupae: [],
      storesC: [], storesP: [], seeds: [], gathered: [], births: [], deaths: [], energy: [], foragers: [], territory: [] };
    this.milestones = new Set();
    this.territory = 0;
    this.hungryByChamber = new Map();
    this.storeWarned = 0;
  }

  get alive() { return !this.extinct; }
  get population() { return this.counts.workers + this.counts.majors; }
  moundRadius() { return 9 + Math.sqrt(this.mound) * 0.55; }

  // ---------------------------------------------------------------- capacities and stores
  storeCapacity() {
    const area = this.nest.storeChamberArea();
    const workers = this.counts.workers + this.counts.majors;
    if (this.species.storage === 'internal') return 15 + workers * 1.5 + area * 0.03;
    return 15 + area * 0.12 + workers * 0.3;
  }
  granaryCapacity() { return 10 + this.nest.storeChamberArea() * 0.2; }

  // Deposit food into stores; anything that cannot be stored becomes waste.
  deposit(w, kind, mass, pFrac) {
    if (mass <= 0) return 0;
    let accepted = 0;
    if (kind === 'seed') {
      if (this.species.granary) {
        const space = Math.max(0, this.granaryCapacity() - this.stores.seed);
        accepted = Math.min(mass, space);
        this.stores.seed += accepted;
        this.stats.gatheredSeed += accepted;
        if (mass > accepted) w.sink('waste', mass - accepted);
      } else {
        const husk = mass * 0.25;
        w.sink('waste', husk);
        accepted = this.addNutrients(w, mass - husk, pFrac);
      }
    } else {
      accepted = this.addNutrients(w, mass, pFrac);
    }
    this.stats.gathered += accepted;
    return accepted;
  }
  addNutrients(w, mass, pFrac) {
    const space = Math.max(0, this.storeCapacity() - this.stores.c - this.stores.p);
    const acc = Math.min(mass, space);
    this.stores.c += acc * (1 - pFrac);
    this.stores.p += acc * pFrac;
    this.stats.gatheredC += acc * (1 - pFrac);
    this.stats.gatheredP += acc * pFrac;
    if (mass > acc) { w.sink('waste', mass - acc); this.stats.wasted += mass - acc; }
    return acc;
  }
  // Transfer stored food into an adult (trophallaxis). Carbohydrate first, protein as fallback.
  feedAdult(w, a, amount) {
    if (amount <= 0) return 0;
    let got = Math.min(amount, this.stores.c);
    this.stores.c -= got;
    if (got < amount) {
      const p = Math.min(amount - got, this.stores.p);
      this.stores.p -= p; got += p;
    }
    a.energy += got;
    return got;
  }
  // Granary seeds are milled into edible nutrients; husks are discarded.
  mill(w, amount) {
    const s = Math.min(amount, this.stores.seed);
    if (s <= 0) return;
    this.stores.seed -= s;
    const edible = s * 0.75;
    w.sink('waste', s - edible);
    this.stores.c += edible * 0.7;
    this.stores.p += edible * 0.3;
  }

  // ---------------------------------------------------------------- brood
  layEgg(w, queen) {
    const sp = this.species, cost = sp.eggCost;
    if (queen.energy < cost + queen.maxEnergy * 0.25) return false;
    queen.energy -= cost;
    const ch = this.nest.byId(queen.cur);
    const p = this.nest.randomPoint(ch, this.rng);
    this.brood.push({ id: w.nextId(), stage: 'egg', progress: 0, mass: cost, fedP: 0, fedC: 0, needP: 0, needC: 0,
      caste: 'worker', chamber: ch.id, x: p.x, y: p.y, starve: 0, dead: false, born: w.tick });
    this.stats.eggsLaid++;
    return true;
  }

  decideCaste(w, b) {
    const sp = this.species, c = this.counts, rng = this.rng, season = w.env.season;
    const workers = c.workers + c.majors;
    let caste = 'worker', mul = 1, nanitic = false;
    if (workers < 10 && this.founding) { nanitic = true; mul = 0.6; }
    else if (workers >= sp.maturePop && (season === 1 || (season === 0 && w.env.seasonDay >= 5)) && this.stores.p > 4) {
      const r = rng.next();
      if (r < 0.08) { caste = 'gyne'; mul = 3.4; }
      else if (r < 0.2) { caste = 'male'; mul = 1.8; }
    }
    if (caste === 'worker' && sp.majorFraction > 0 && workers >= 40 && rng.next() < sp.majorFraction) { caste = 'major'; mul = 2.2; }
    b.caste = caste; b.nanitic = nanitic;
    b.needP = sp.larvaNeed.p * mul;
    b.needC = sp.larvaNeed.c * mul;
  }

  feedLarvaIn(w, chamberId) {
    let target = null;
    for (const b of this.brood) {
      if (b.stage === 'larva' && b.chamber === chamberId && b.hungry && (!target || b.starve > target.starve)) target = b;
    }
    if (!target) return false;
    return this.feedLarva(target, 0.12);
  }
  feedLarva(b, amount) {
    const dp = Math.min(b.needP - b.fedP, amount * 0.65, this.stores.p);
    const dc = Math.min(b.needC - b.fedC, amount * 0.35, this.stores.c);
    if (dp <= 0 && dc <= 0) return false;
    if (dp > 0) { this.stores.p -= dp; b.fedP += dp; b.mass += dp; }
    if (dc > 0) { this.stores.c -= dc; b.fedC += dc; b.mass += dc; }
    b.starve = 0;
    return true;
  }
  feedLarvaFromQueen(q, b, amount) {
    const avail = q.energy - q.maxEnergy * 0.2;
    if (avail <= 0) return;
    const dp = Math.min(b.needP - b.fedP, amount * 0.6, avail * 0.6);
    const dc = Math.min(b.needC - b.fedC, amount * 0.4, avail * 0.4);
    const t = Math.max(0, dp) + Math.max(0, dc);
    if (t <= 0) return;
    q.energy -= t;
    if (dp > 0) { b.fedP += dp; b.mass += dp; }
    if (dc > 0) { b.fedC += dc; b.mass += dc; }
    b.starve = 0;
  }

  // Which chamber needs a nurse most.
  nurseTarget(rng) {
    let best = null, bv = 0;
    for (const [cid, n] of this.hungryByChamber) {
      const v = n + rng.next();
      if (v > bv) { bv = v; best = cid; }
    }
    if (best !== null) return this.nest.byId(best);
    if (this.brood.length) {
      const b = this.brood[Math.floor(rng.next() * this.brood.length)];
      if (b.chamber >= 0) return this.nest.byId(b.chamber);
    }
    return null;
  }
  // Brood relocation: out of flooded chambers, larvae/pupae out of a crowded queen chamber,
  // and towards chambers with better temperatures for development.
  relocationCandidate(chamberId, rng) {
    const nest = this.nest;
    const here = nest.byId(chamberId);
    const items = this.brood.filter((b) => b.chamber === chamberId);
    if (!items.length) return null;
    const options = nest.usableChambers().filter((c) => (c.type === 'brood' || c.type === 'queen' || c.type === 'general') && !c.flooded && c.id !== chamberId);
    if (!options.length) return null;
    const score = (c) => -Math.abs(c.temp - 28) - (c.type === 'brood' ? 0 : 1.5);
    let best = options[0];
    for (const c of options) if (score(c) > score(best)) best = c;
    const b = rng.pick(items);
    if (here.flooded) return { b, to: best };
    if (here.type === 'queen' && b.stage !== 'egg' && items.length > 10 && best.type === 'brood') return { b, to: best };
    if (b.stage !== 'egg' && score(best) - score(here) > 3) return { b, to: best };
    return null;
  }

  // ---------------------------------------------------------------- per-tick update
  update(w) {
    if (this.extinct) return;
    const env = w.env, sp = this.species, nest = this.nest;
    const tasks = this.counts.tasks;
    // Queens lay eggs.
    const workers = this.counts.workers + this.counts.majors;
    for (const q of this.queens) {
      if (q.dead || q.loc !== 'nest') continue;
      // Workers feed the queen from stores.
      if (workers > 0 && q.energy < q.maxEnergy * 0.85) {
        const want = Math.min(0.03, q.maxEnergy * 0.85 - q.energy);
        let gp = Math.min(want * 0.5, this.stores.p);
        this.stores.p -= gp;
        let gc = Math.min(want - gp, this.stores.c);
        this.stores.c -= gc;
        q.energy += gp + gc;
      }
      if (this.dormant) continue;
      const T = nest.byId(q.cur).temp;
      const f = devFactor(T);
      if (f <= 0) continue;
      const brood = this.counts.eggs + this.counts.larvae;
      let supply, care;
      if (workers === 0) { supply = 1; care = brood < 12 ? 1 : 0; }
      else {
        // Egg laying tracks protein and overall reserves: hungry colonies raise fewer brood.
        const reserve = this.stores.c + this.stores.p + this.stores.seed * 0.5;
        supply = clamp((this.stores.p + 1.5) / (this.counts.larvae * 0.25 + 3), 0, 1)
          * clamp(reserve / (workers * sp.metabolism * 1.5 + 6), 0.05, 1);
        care = clamp(1.6 - brood / (workers * 1.3 + 6), 0, 1);
      }
      const season = env.season === 2 && sp.dormancy ? 0.4 : env.season === 3 ? (sp.dormancy ? 0 : 0.3) : 1;
      const condition = clamp((q.energy / q.maxEnergy - 0.3) / 0.4, 0, 1);
      q.eggAcc += (sp.eggRate / TPD) * f * supply * care * season * condition;
      if (q.eggAcc >= 1) { q.eggAcc -= 1; this.layEgg(w, q); }
    }
    // Brood development.
    const queenFeeder = workers === 0 ? this.queens.find((q) => !q.dead) : null;
    let anyDead = false;
    for (const b of this.brood) {
      if (b.chamber < 0) continue; // being carried
      const ch = nest.byId(b.chamber);
      const f = devFactor(ch.temp);
      if (ch.flooded && w.rng.chance(1 / (TPD * 0.4))) { this.broodDeath(w, b, 'drowning'); anyDead = true; continue; }
      if ((ch.temp > 40 || ch.temp < -1) && w.rng.chance(1 / TPD)) { this.broodDeath(w, b, 'temperature'); anyDead = true; continue; }
      const paused = this.dormant || f <= 0;
      if (b.stage === 'egg') {
        if (!paused) b.progress += f / (sp.devDays.egg * TPD);
        if (b.progress >= 1) { b.stage = 'larva'; b.progress = 0; this.decideCaste(w, b); }
      } else if (b.stage === 'larva') {
        const allowed = Math.min(b.fedP / b.needP, b.fedC / b.needC);
        b.hungry = b.progress >= allowed - 0.03;
        const durMul = b.caste === 'gyne' ? 1.4 : b.caste === 'major' ? 1.2 : 1;
        if (!paused && b.progress < allowed) b.progress = Math.min(allowed, b.progress + f / (sp.devDays.larva * durMul * TPD));
        if (b.hungry && !paused) {
          b.starve++;
          if (queenFeeder && w.tick % 10 === 0) this.feedLarvaFromQueen(queenFeeder, b, 0.1);
          if (b.starve > TPD * 1.6) { this.broodDeath(w, b, 'starvation'); anyDead = true; continue; }
        }
        if (b.progress >= 1) { b.stage = 'pupa'; b.progress = 0; b.hungry = false; }
      } else if (b.stage === 'pupa') {
        if (!paused) b.progress += f / (sp.devDays.pupa * TPD);
        if (b.progress >= 1) { this.emerge(w, b); anyDead = true; }
      }
    }
    if (anyDead) this.brood = this.brood.filter((b) => !b.dead);
    // Spoilage of stores (every 10 ticks, exact per-tick equivalent).
    if (w.tick % 10 === 0) {
      const T = nest.chambers.length > 1 ? nest.chambers[1].temp : env.temp;
      const fp = (0.06 / TPD) * 10 * q10(T) * 1.5;
      const fc = (0.004 / TPD) * 10;
      const sp_ = this.stores.p * fp, sc = this.stores.c * fc;
      this.stores.p -= sp_; this.stores.c -= sc;
      w.sink('spoilage', sp_ + sc);
    }
    if (w.tick % 50 === (this.id * 7) % 50) this.slowUpdate(w);
  }

  broodDeath(w, b, cause) {
    b.dead = true;
    this.stats.broodDeaths++;
    // Workers recycle part of dead brood (brood cannibalism) when they are present.
    if (this.counts.workers + this.counts.majors > 0) {
      const back = b.mass * 0.6;
      this.stores.p += back * 0.7; this.stores.c += back * 0.3;
      w.sink('broodLoss', b.mass - back);
    } else w.sink('broodLoss', b.mass);
    if (cause === 'starvation' && w.tick - this.storeWarned > TPD && this.brood.length > 5) {
      this.storeWarned = w.tick;
      w.event('shortage', `${this.name}: larvae are starving (protein stores ${this.stores.p.toFixed(1)})`, this, 'warn');
    }
  }

  emerge(w, b) {
    b.dead = true;
    const ant = new Ant(w.nextId(), this, b.caste, this.rng, { nanitic: b.nanitic, energy: 0 });
    const e = Math.min(ant.maxEnergy * 0.6, b.mass * 0.5);
    ant.energy = e;
    w.sink('tissue', b.mass - e);
    const ch = this.nest.byId(b.chamber);
    ant.cur = ch.id; ant.ux = b.x; ant.uy = b.y;
    w.addAnt(ant);
    this.stats.births++;
    if (b.caste === 'worker' || b.caste === 'major') this.founding = false;
    decideTask(w, ant);
  }

  // Combs one cheap pass over ants per 50 ticks: counts, stimuli, dormancy, expansion, extinction.
  slowUpdate(w) {
    const env = w.env, sp = this.species, nest = this.nest, c = this.counts;
    nest.updateConditions(env);
    c.workers = 0; c.majors = 0; c.queens = 0; c.gynes = 0; c.males = 0; c.foragers = 0; c.surface = 0;
    let energy = 0, nE = 0;
    const tasks = {};
    for (const a of this.ants) {
      if (a.dead) continue;
      if (a.caste === 'worker') c.workers++;
      else if (a.caste === 'major') c.majors++;
      else if (a.caste === 'queen') c.queens++;
      else if (a.caste === 'gyne') c.gynes++;
      else if (a.caste === 'male') c.males++;
      if (a.loc === 'surface') { c.surface++; if (a.task === 'forage') c.foragers++; }
      tasks[a.task] = (tasks[a.task] || 0) + 1;
      if (a.isAdultWorker) { energy += a.energy / a.maxEnergy; nE++; }
    }
    c.tasks = tasks;
    c.avgEnergy = nE ? energy / nE : 0;
    c.adults = c.workers + c.majors;
    c.eggs = 0; c.larvae = 0; c.pupae = 0; c.hungryLarvae = 0;
    this.hungryByChamber.clear();
    for (const b of this.brood) {
      if (b.stage === 'egg') c.eggs++;
      else if (b.stage === 'larva') {
        c.larvae++;
        if (b.hungry && b.chamber >= 0) { c.hungryLarvae++; this.hungryByChamber.set(b.chamber, (this.hungryByChamber.get(b.chamber) || 0) + 1); }
      } else c.pupae++;
    }
    const pop = c.adults;
    this.stats.peak = Math.max(this.stats.peak, pop);
    for (const m of MILESTONES) {
      if (pop >= m && !this.milestones.has(m)) {
        this.milestones.add(m);
        w.event('milestone', `${this.name} reached ${m} workers`, this, 'good');
      }
    }

    // Dormancy (temperate species overwinter when the nest is cold).
    const midDepth = nest.chambers.length > 2 ? nest.chambers[2].temp : nest.chambers[nest.chambers.length - 1].temp;
    if (sp.dormancy) {
      const season = env.season;
      if (!this.dormant && (season === 2 || season === 3) && midDepth < sp.dormancyTemp) {
        this.dormant = true;
        w.event('season', `${this.name} entered winter dormancy`, this, 'minor');
      } else if (this.dormant && midDepth > sp.dormancyTemp + 1.5 && (season === 0 || season === 1)) {
        this.dormant = false;
        w.event('season', `${this.name} emerged from dormancy`, this, 'minor');
      }
    }
    // Is the surface suitable for foraging right now?
    const t = env.temp;
    this.surfaceOK = !this.dormant && t >= sp.forageTemp[0] && t <= sp.forageTemp[1] && env.rain < 0.35
      && (sp.nightActive || env.daylight > 0.15);

    // Stimuli for the response-threshold task model.
    const stores = this.stores.c + this.stores.p + this.stores.seed * 0.6;
    const metab = sp.metabolism * Math.max(1, pop) * 1.6 * q10(env.surfSmooth);
    const broodNeed = c.larvae * (sp.larvaNeed.p + sp.larvaNeed.c) * 0.4;
    const days = env.season === 2 ? (sp.dormancy ? 6 : 10) : 4;
    const target = Math.min(this.storeCapacity() * (sp.granary ? 1.5 : 0.9), (metab + broodNeed) * days + 8);
    let forage = clamp((target - stores) / Math.max(1, target), 0, 1);
    const pNeed = clamp((c.hungryLarvae * 0.3 + c.larvae * 0.05 - this.stores.p) / (c.larvae * 0.3 + 2), 0, 1);
    this.stim.protein = pNeed;
    this.stim.full = clamp((this.stores.c + this.stores.p) / Math.max(1, this.storeCapacity()), 0, 1);
    forage = clamp(forage + pNeed * 0.5, 0, 1);
    const foragerFrac = pop ? (tasks.forage || 0) / pop : 0;
    forage = Math.max(forage, 0.12); // a few scouts always explore when conditions allow
    if (!this.surfaceOK) forage = 0;
    this.stim.forage = forage * clamp(1.3 - foragerFrac * 1.1, 0.15, 1);
    const nurses = tasks.nurse || 0;
    this.stim.nurse = clamp((c.hungryLarvae + (c.eggs + c.pupae) * 0.08) / (nurses * 2.5 + 2), 0, 1.2);
    // Expansion when crowded.
    const cap = nest.adultCapacity();
    const crowd = pop / Math.max(1, cap);
    const broodCrowd = this.brood.length / Math.max(1, nest.broodCapacity());
    if (!nest.digSite && !this.extinct && pop >= 4) {
      let type = null;
      if (broodCrowd > 0.9) type = 'brood';
      else if (sp.storage === 'chamber' && (this.stores.c + this.stores.p) > 0.8 * this.storeCapacity() && nest.chambersOfType('store').length < 6) type = 'store';
      else if (sp.granary && this.stores.seed > 0.8 * this.granaryCapacity()) type = 'store';
      else if (crowd > 0.8) type = 'general';
      else if (nest.corpses.length > 25 && nest.chambersOfType('refuse').length < 3) type = 'refuse';
      if (type && !this.dormant) nest.plan(type);
    }
    const diggers = tasks.dig || 0;
    this.stim.dig = nest.digSite && !this.dormant ? clamp(0.3 + (crowd - 0.6) + (broodCrowd - 0.6), 0.2, 1) * clamp(1.3 - diggers / Math.max(3, pop * 0.12), 0, 1) : 0;
    const refuse = nest.find('refuse', null);
    const dirty = nest.corpses.filter((k) => !k.carried && k.chamber !== refuse.id).length;
    this.stim.clean = clamp(dirty * 0.25, 0, 1) * clamp(1.2 - (tasks.clean || 0) / 3, 0, 1);
    this.alarm *= 0.85;
    this.stim.defend = clamp(this.alarm, 0, 1) * clamp(1.3 - (tasks.defend || 0) / Math.max(4, pop * 0.25), 0, 1);
    const cNeed = clamp(1 - this.stores.c / Math.max(2, metab * 2), 0, 1);
    this.stim.mill = sp.granary && this.stores.seed > 0.5 ? clamp(cNeed + 0.15, 0, 1) * clamp(1.2 - (tasks.mill || 0) / Math.max(2, pop * 0.12), 0, 1) : 0;

    // Queen loss and extinction.
    if (c.queens === 0 && !this.queenless && this.queens.length === 0 && pop > 0) {
      this.queenless = true;
    }
    if (pop === 0 && c.queens === 0 && c.pupae === 0) {
      this.goExtinct(w);
    }
  }

  goExtinct(w) {
    if (this.extinct) return;
    this.extinct = true;
    this.extinctTick = w.tick;
    this.dormant = false;
    for (const b of this.brood) { if (!b.dead) { b.dead = true; w.sink('broodLoss', b.mass); } }
    this.brood = [];
    for (const a of this.ants) if (!a.dead) w.killAnt(a, 'colony collapse');
    // Remaining stores rot away inside the abandoned nest.
    w.sink('spoilage', this.stores.c + this.stores.p + this.stores.seed);
    this.stores = { c: 0, p: 0, seed: 0 };
    this.recordHistory(w);
    w.event('extinct', `${this.name} has gone extinct after ${((w.tick - this.founded) / TPD).toFixed(1)} days`, this, 'bad');
  }

  recordHistory(w) {
    const h = this.history, c = this.counts;
    h.t.push(w.tick / TPD);
    h.workers.push(c.workers); h.majors.push(c.majors); h.queens.push(c.queens);
    h.alates.push(c.gynes + c.males);
    h.eggs.push(c.eggs); h.larvae.push(c.larvae); h.pupae.push(c.pupae);
    h.storesC.push(+this.stores.c.toFixed(2)); h.storesP.push(+this.stores.p.toFixed(2)); h.seeds.push(+this.stores.seed.toFixed(2));
    h.gathered.push(+this.stats.gathered.toFixed(1)); h.births.push(this.stats.births); h.deaths.push(this.stats.deaths);
    h.energy.push(+(c.avgEnergy * 100).toFixed(1)); h.foragers.push(c.foragers); h.territory.push(this.territory);
    if (h.t.length > 1600) {
      for (const k of Object.keys(h)) h[k] = h[k].filter((_, i) => i % 2 === 0);
    }
  }

  ageDays(w) { return ((this.extinct ? this.extinctTick : w.tick) - this.founded) / TPD; }
}

export { SEASONS, TPH };
