import { TPD, clamp, wrapAngle, q10, FOOD_KINDS } from './constants.js';

const TASKS = ['forage', 'nurse', 'dig', 'clean', 'defend', 'mill'];
const buf = [];

// An individual ant. Behaviour is driven by its own state, local stimuli and colony-level cues,
// never by direct scripting.
export class Ant {
  constructor(id, colony, caste, rng, opts = {}) {
    const sp = colony.species;
    this.id = id;
    this.colony = colony;
    this.colonyId = colony.id;
    this.sp = sp;
    this.caste = caste; // worker | major | queen | gyne | male
    const mul = caste === 'major' ? sp.majorMul : caste === 'queen' ? sp.queenMul : caste === 'gyne' ? sp.queenMul * 0.95
      : caste === 'male' ? 0.85 : 1;
    this.nanitic = !!opts.nanitic;
    this.size = sp.size * mul * (this.nanitic ? 0.8 : 1) * rng.range(0.94, 1.06);
    const s2 = (this.size / sp.size) ** 2;
    this.metScale = caste === 'queen' || caste === 'gyne' ? 2 : s2;
    this.maxEnergy = caste === 'queen' ? sp.founderEnergy : caste === 'gyne' ? sp.founderEnergy : sp.energy * s2;
    this.energy = opts.energy ?? this.maxEnergy * 0.8;
    this.maxHp = sp.hp * s2 * (caste === 'queen' ? 1.5 : 1);
    this.hp = this.maxHp;
    this.attack = sp.attack * s2 * (caste === 'major' ? 1.15 : 1) * (caste === 'male' ? 0.2 : 1);
    this.speedMul = rng.range(0.88, 1.12) * (caste === 'major' ? 0.85 : 1) * (caste === 'queen' ? 0.45 : 1);
    this.carryCap = sp.carry * s2;
    this.cropCap = sp.crop * s2;
    this.age = opts.age ?? 0;
    const [l0, l1] = sp.lifespan;
    this.lifespan = caste === 'queen' ? sp.queenLifespan * TPD * rng.range(0.8, 1.2)
      : caste === 'male' ? 20 * TPD : caste === 'gyne' ? 60 * TPD
      : rng.range(l0, l1) * TPD * (this.nanitic ? 0.6 : 1);
    this.water = 1;
    this.loc = 'nest';
    this.x = colony.x; this.y = colony.y; this.heading = rng.angle();
    this.ux = 0; this.uy = 0; this.uh = 0; this.cur = 0;
    this.path = []; this.dest = null;
    this.task = caste === 'queen' ? 'queen' : caste === 'gyne' || caste === 'male' ? 'alate' : 'rest';
    this.mode = '';
    this.timer = 0;
    this.carry = null;    // {type:'food'|'brood'|'corpse'|'soil', ...}
    this.crop = 0; this.cropP = 0;
    this.soil = 0;
    this.memory = { food: null, foodKind: null, lastFood: -1 };
    this.ignored = [];
    this.th = { forage: 0, nurse: 0, dig: 0, clean: 0, defend: 0, mill: 0 };
    this.target = null;
    this.fightTarget = null;
    this.gait = rng.range(0, 6.28);
    this.trip = 0;
    this.layTrail = false; this.trailQ = 1;
    this.injured = false;
    this.dead = false;
    this.flying = false; this.z = 0;
    this.act = 1;
    this.avoid = rng.chance(0.5) ? 1 : -1;
    this.avoidT = 0;
    this.pause = 0;
    this.eggAcc = rng.next();
    this.onTrail = false;
    this.cause = null;
  }
  get ageDays() { return this.age / TPD; }
  get isAdultWorker() { return this.caste === 'worker' || this.caste === 'major'; }
}

// ---------------------------------------------------------------- task allocation
// Response-threshold model with age polyethism and threshold reinforcement (learning).
export function decideTask(w, a) {
  const col = a.colony, sp = a.sp, rng = w.rng;
  a.mode = ''; a.timer = 0; a.dest = null; a.path.length = 0; a.target = null;
  if (a.caste === 'queen') { a.task = 'queen'; return; }
  if (a.caste === 'gyne' || a.caste === 'male') { a.task = 'alate'; return; }
  if (a.energy < 0.45 * a.maxEnergy && col.stores.c + col.stores.p > 0.05) { a.task = 'eat'; return; }
  if (col.dormant) { a.task = 'hibernate'; return; }
  const st = col.stim;
  const age = clamp(a.age / (sp.lifespan[0] * TPD * 0.3), 0, 1);
  const major = a.caste === 'major';
  const base = {
    forage: 0.85 - 0.6 * age + (major ? 0.2 : 0),
    nurse: 0.12 + 0.75 * age + (major ? 0.4 : 0),
    dig: 0.45,
    clean: 0.5,
    defend: major ? 0.12 : 0.55 - 0.15 * age,
    mill: major ? 0.12 : 0.6,
  };
  let total = 0.18; // resting propensity
  const weights = {};
  for (const t of TASKS) {
    const s = st[t] || 0;
    const th = clamp(base[t] + a.th[t], 0.03, 1.6);
    let p = (s * s) / (s * s + th * th);
    if (t === a.task) p *= 1.5;
    weights[t] = p;
    total += p;
  }
  let r = rng.next() * total;
  let chosen = 'rest';
  for (const t of TASKS) { r -= weights[t]; if (r < 0) { chosen = t; break; } }
  for (const t of TASKS) {
    a.th[t] = clamp(a.th[t] + (t === chosen ? -0.03 : 0.006), -0.3, 0.3);
  }
  a.task = chosen;
}

// ---------------------------------------------------------------- shared helpers
function turnToward(a, ang, rate) {
  const d = wrapAngle(ang - a.heading);
  a.heading += d > rate ? rate : d < -rate ? -rate : d;
}

export function moveSurface(w, a, spd) {
  const c = Math.cos(a.heading), s = Math.sin(a.heading);
  const nx = a.x + c * spd, ny = a.y + s * spd;
  if (!w.blocked(nx, ny)) { a.x = nx; a.y = ny; a.gait += spd; return true; }
  for (let k = 1; k <= 7; k++) {
    const ang = a.heading + a.avoid * k * 0.42;
    const tx = a.x + Math.cos(ang) * spd, ty = a.y + Math.sin(ang) * spd;
    if (!w.blocked(tx, ty)) { a.heading = ang; a.x = tx; a.y = ty; a.gait += spd; a.avoidT = 14; return true; }
  }
  a.avoid = -a.avoid;
  a.heading += Math.PI * 0.6 * a.avoid;
  a.avoidT = 14;
  return false;
}

function homeAngle(a) { return Math.atan2(a.colony.y - a.y, a.colony.x - a.x); }
function homeDist(a) { return Math.hypot(a.colony.y - a.y, a.colony.x - a.x); }

function speedOf(w, a) {
  let s = a.sp.speed * a.speedMul;
  if (a.injured) s *= 0.7;
  const t = a.loc === 'surface' ? w.env.temp : a.colony.nest.byId(a.cur).temp;
  s *= clamp(0.35 + (t - 4) / 22, 0.35, 1.1); // cold ants are sluggish
  if (a.carry && a.carry.type === 'food') s *= 0.8;
  return s;
}

// Steer homeward by path integration (direction to entrance) with noise.
function steerHome(w, a, spd) {
  if (a.avoidT > 0) { a.avoidT--; a.heading += w.rng.normal() * 0.15; }
  else turnToward(a, homeAngle(a) + w.rng.normal() * 0.12, 0.35);
  moveSurface(w, a, spd);
  if (homeDist(a) < 5) { enterNest(w, a); return true; }
  return false;
}

export function enterNest(w, a) {
  a.loc = 'nest';
  a.cur = 0; a.ux = 0; a.uy = 0; a.path.length = 0; a.dest = null;
  a.trip = 0; a.layTrail = false; a.onTrail = false; a.target = null;
  if (a.flying) return;
  if (a.carry && a.carry.type === 'food' || a.crop > 0.001) { a.mode = 'unload'; return; }
  if (a.task === 'haul') a.soil = 0;
  if (a.task === 'forage' && a.colony.stim.forage > 0.15 && a.energy > 0.5 * a.maxEnergy && w.rng.chance(0.85)) {
    a.mode = 'exit'; nestGo(a, 0, 0, 0); return;
  }
  decideTask(w, a);
}

function exitNest(w, a) {
  a.loc = 'surface';
  const col = a.colony;
  a.heading = w.rng.angle();
  a.x = col.x + Math.cos(a.heading) * 4;
  a.y = col.y + Math.sin(a.heading) * 4;
  a.trip = 0; a.timer = 0; a.water = Math.max(a.water, 0.9);
}

// ---------------------------------------------------------------- underground movement
export function nestGo(a, chamberId, x, y) {
  const nest = a.colony.nest;
  a.path = nest.path(a.cur, chamberId);
  const cur = nest.byId(a.cur);
  if (a.path.length && Math.hypot(a.ux - cur.x, a.uy - cur.y) > 3) a.path.unshift(a.cur);
  a.dest = { c: chamberId, x, y };
}
function nestGoPoint(w, a, ch) {
  const p = a.colony.nest.randomPoint(ch, w.rng);
  nestGo(a, ch.id, p.x, p.y);
}
// Returns true once the destination is reached.
function nestMove(w, a) {
  if (!a.dest) return true;
  const nest = a.colony.nest;
  const spd = speedOf(w, a) * 0.6;
  let tx, ty;
  if (a.path.length) { const ch = nest.byId(a.path[0]); tx = ch.x; ty = ch.y; }
  else { tx = a.dest.x; ty = a.dest.y; }
  const dx = tx - a.ux, dy = ty - a.uy, d = Math.hypot(dx, dy);
  a.act = a.carry ? 2.6 : 2;
  if (d <= spd) {
    a.ux = tx; a.uy = ty;
    if (a.path.length) { a.cur = a.path.shift(); return false; }
    a.dest = null;
    return true;
  }
  a.ux += (dx / d) * spd; a.uy += (dy / d) * spd;
  a.uh = Math.atan2(dy, dx);
  a.gait += spd;
  return false;
}

// ---------------------------------------------------------------- per-tick update
export function updateAnt(w, a) {
  const col = a.colony, sp = a.sp, env = w.env;
  const inNest = a.loc === 'nest';
  const chamber = inNest ? col.nest.byId(a.cur) : null;
  const T = inNest ? chamber.temp : env.temp;
  a.age += col.dormant && inNest ? 0.3 : 1;
  // Metabolism (activity level was set by last tick's actions).
  const dormancy = col.dormant && inNest ? 0.3 : 1;
  const cost = (sp.metabolism / TPD) * a.metScale * (inNest ? chamber.q10 : w.q10Surface) * a.act * dormancy;
  a.energy -= cost;
  w.sink('metabolism', cost);
  a.act = 1;
  // Self-feeding from crop contents.
  if (a.energy < 0.3 * a.maxEnergy && a.crop > 0) {
    const take = Math.min(a.crop, a.maxEnergy * 0.5 - a.energy);
    const pf = a.cropP / a.crop;
    a.crop -= take; a.cropP -= take * pf; a.energy += take;
    if (a.crop < 1e-6) { a.energy += a.crop; a.crop = 0; a.cropP = 0; }
  }
  // Water balance: desiccation on hot dry surface, recovery in the humid nest.
  if (!inNest && !a.flying) {
    const dry = (Math.max(0, T - 18) / 12) * (1 - env.moisture * 0.6) * (1 - env.rain);
    a.water -= dry / (TPD * 0.9);
  } else if (a.water < 1) a.water = Math.min(1, a.water + 0.004);
  if (a.hp < a.maxHp && inNest) { a.hp = Math.min(a.maxHp, a.hp + a.maxHp * 0.0004); if (a.hp > a.maxHp * 0.7) a.injured = false; }
  // Mortality.
  if (a.energy <= 0) return w.killAnt(a, 'starvation');
  if (a.water <= 0) return w.killAnt(a, 'dehydration');
  if (a.age >= a.lifespan) return w.killAnt(a, 'old age');
  if ((T > sp.heatLethal || T < sp.coldLethal) && w.rng.chance(1 / 400)) return w.killAnt(a, 'exposure');
  if (a.flying) return updateFlight(w, a);
  if (a.fightTarget) { a.act = 5; return; }
  if (a.pause > 0) { a.pause--; return; }
  if (inNest) nestBehaviour(w, a);
  else surfaceBehaviour(w, a);
}

// ---------------------------------------------------------------- surface behaviour
function surfaceBehaviour(w, a) {
  const col = a.colony;
  a.trip++;
  if (a.task === 'flight') { a.flying = true; a.z = 0; return; }
  if (a.mode === 'flee' || a.mode === 'return' || a.mode === 'home') {
    a.act = a.carry || a.crop > 0 ? 3 : 2;
    if (a.layTrail) col.pher.depositTrail(a.x, a.y, a.sp.trailStrength * a.trailQ);
    steerHome(w, a, speedOf(w, a) * (a.mode === 'flee' ? 1.15 : 1));
    return;
  }
  // Conditions that send any surface ant home.
  const lowEnergy = a.energy < 0.3 * a.maxEnergy && a.crop <= 0;
  if (lowEnergy || a.water < 0.45 || (!col.surfaceOK && a.task !== 'defend') || a.hp < a.maxHp * 0.3) {
    a.mode = 'home'; return;
  }
  if (a.task === 'forage') return forageSurface(w, a);
  if (a.task === 'defend') return defendSurface(w, a);
  if (a.task === 'haul') return haulSurface(w, a);
  a.mode = 'home';
}

function forageSurface(w, a) {
  const col = a.colony, sp = a.sp, rng = w.rng;
  const spd = speedOf(w, a);
  a.act = 2;
  switch (a.mode) {
    case 'hunt': {
      const p = a.target;
      if (!p || p.dead || a.timer++ > 260) { a.mode = 'search'; a.target = null; break; }
      turnToward(a, Math.atan2(p.y - a.y, p.x - a.x), 0.5);
      moveSurface(w, a, spd * 1.1);
      a.act = 3.5;
      if (Math.hypot(p.x - a.x, p.y - a.y) < 6 + p.size * 0.5) {
        p.hp -= a.attack * 0.045 * (0.5 + rng.next());
        p.fleeing = 30;
        if (rng.chance(0.1)) col.pher.depositAlarm(a.x, a.y, 0.4);
        if (p.hp <= 0) w.killPrey(p);
      }
      return;
    }
    case 'approach': {
      const f = a.target;
      if (!f || f.mass <= 0.02 || !w.foodById.has(f.id)) { a.mode = 'search'; a.target = null; break; }
      turnToward(a, Math.atan2(f.y - a.y, f.x - a.x), 0.45);
      moveSurface(w, a, spd);
      if (Math.hypot(f.x - a.x, f.y - a.y) < f.radius + 3) { a.mode = 'collect'; a.timer = 0; }
      return;
    }
    case 'collect': return collectFood(w, a);
    case 'coop': {
      const f = a.target;
      a.act = 3;
      if (!f || f.mass <= 0.02 || !w.foodById.has(f.id)) { a.mode = 'search'; a.target = null; return; }
      if (++a.timer > 320 && !f.moving) { // not enough help arrived: start cutting pieces instead
        f.carriers = f.carriers.filter((c) => c !== a);
        a.mode = 'collect'; a.timer = 0; a.cutting = true;
      }
      return;
    }
    case 'toMemory': {
      const m = a.memory.food;
      if (!m) { a.mode = 'search'; break; }
      if (a.avoidT > 0) { a.avoidT--; a.heading += rng.normal() * 0.2; }
      else turnToward(a, Math.atan2(m.y - a.y, m.x - a.x) + rng.normal() * 0.1, 0.3);
      moveSurface(w, a, spd);
      if (Math.hypot(m.x - a.x, m.y - a.y) < 10) { a.memory.food = null; a.mode = 'search'; a.timer = 0; }
      if (a.trip % 3 === 0) senseFood(w, a);
      return;
    }
    case 'exit': case '':
      a.mode = a.memory.food && rng.chance(0.85) ? 'toMemory' : 'search';
      return;
  }
  // ---- search: correlated random walk, trail following, outward bias
  if (a.trip > 1500) { a.mode = 'return'; return; }
  const hd = homeDist(a);
  const hx = (a.x - col.x) / (hd || 1), hy = (a.y - col.y) / (hd || 1); // outward unit vector
  // Defensive recruitment by alarm pheromone.
  const alarmHere = col.pher.sampleAlarm(a.x, a.y);
  if (alarmHere > 1.5 && sp.aggression > 0.3 && rng.chance(0.02 * sp.aggression)) { a.task = 'defend'; a.mode = ''; a.timer = 0; return; }
  // Trail sensing (three antennal samples).
  const L = 9, sa = 0.55;
  let best = -1, bestV = 0;
  for (let k = -1; k <= 1; k++) {
    const ang = a.heading + k * sa;
    const cx = Math.cos(ang), cy = Math.sin(ang);
    let v = col.pher.sampleTrail(a.x + cx * L, a.y + cy * L);
    if (cx * hx + cy * hy < -0.2) v *= 0.3; // outbound foragers prefer the outward direction
    if (v > bestV) { bestV = v; best = k; }
  }
  a.onTrail = bestV > 0.25;
  if (a.avoidT > 0) { a.avoidT--; a.heading += rng.normal() * 0.2; }
  else if (a.onTrail) {
    a.heading += best * sa * 0.55 + rng.normal() * 0.06;
  } else {
    a.heading += rng.normal() * 0.11;
    if (hd < 60) turnToward(a, Math.atan2(hy, hx), 0.08);
    else if (a.trip < 700) turnToward(a, Math.atan2(hy, hx), 0.012); // outbound search bias
    if (hd > sp.range) turnToward(a, homeAngle(a), 0.15);
  }
  moveSurface(w, a, spd);
  if (a.trip % 3 === 0) senseFood(w, a);
}

export function acceptance(w, a, f) {
  const sp = a.sp, col = a.colony;
  if (f.kind === 'corpse' && f.colonyId === col.id) return 0; // ants do not eat nestmates
  let base = sp.diet[f.kind] || 0;
  if (base <= 0) return 0;
  if (!f.liquid && !f.regen && f.mass > a.carryCap * (f.def.coop ? 10 : 1) && !(f.def.coop || f.kind === 'fruit')) return 0;
  // Nutritional need shifts preference: protein-hungry colonies favour insects and vice versa.
  const pNeed = col.stim.protein || 0;
  base *= f.pFrac > 0.4 ? 1 + pNeed : (1 + (1 - pNeed) * 0.3) * clamp(1.15 - col.stim.full, 0.08, 1);
  return clamp(base, 0, 1);
}

function senseFood(w, a) {
  const near = w.foodHash.near(a.x, a.y, 44, buf);
  let best = null, bd = 1e9;
  for (const f of near) {
    if (f.mass <= 0.02 || a.ignored.includes(f.id)) continue;
    const d = Math.hypot(f.x - a.x, f.y - a.y);
    const smell = f.liquid ? 12 : f.kind === 'seed' ? 4 : 16;
    if (d > f.radius + 10 + smell) continue;
    if (f.carriers.length && f.carriers[0].colony !== a.colony) continue;
    if (d < bd) { bd = d; best = f; }
  }
  if (best) {
    const p = acceptance(w, a, best);
    if (w.rng.next() < p) { a.mode = 'approach'; a.target = best; }
    else { a.ignored.push(best.id); if (a.ignored.length > 6) a.ignored.shift(); }
  }
}

function collectFood(w, a) {
  const f = a.target, col = a.colony, rng = w.rng;
  if (!f || f.mass <= 0.02 || !w.foodById.has(f.id)) { a.mode = 'search'; a.target = null; return; }
  a.act = 2.5;
  a.timer++;
  if (f.liquid) {
    if (a.timer < 28) return;
    const amt = f.take(Math.min(a.cropCap - a.crop, f.mass));
    a.crop += amt; a.cropP += amt * f.pFrac;
    a.water = 1; // liquid food also rehydrates
    finishCollect(w, a, f, amt);
    return;
  }
  // Seed patches on grass: pick up one seed at a time.
  if (f.regen && f.kind === 'seed') {
    if (a.timer < 14) return;
    const amt = f.take(Math.min(a.carryCap, rng.range(1.6, 3.6), f.mass));
    a.carry = { type: 'food', kind: 'seed', mass: amt, pFrac: f.pFrac };
    finishCollect(w, a, f, amt);
    return;
  }
  // Solids: carry whole, cooperate on medium items, or cut pieces from large ones.
  if (f.mass <= a.carryCap) {
    if (a.timer < 10) return;
    w.removeFood(f, false);
    a.carry = { type: 'food', kind: f.kind, mass: f.mass, pFrac: f.pFrac, size: f.size, species: f.species };
    f.mass = 0;
    finishCollect(w, a, f, a.carry.mass);
    return;
  }
  if (!a.cutting && f.def.coop && f.mass <= a.carryCap * 9 && !f.moving && f.carriers.length < 10) {
    if (!f.carriers.includes(a)) f.carriers.push(a);
    a.mode = 'coop'; a.timer = 0;
    return;
  }
  if (a.timer < 45) return; // cutting a piece takes time
  const amt = f.take(a.carryCap);
  a.carry = { type: 'food', kind: f.kind, mass: amt, pFrac: f.pFrac, piece: true };
  a.cutting = false;
  finishCollect(w, a, f, amt);
}

function finishCollect(w, a, f, amt) {
  const sp = a.sp;
  a.mode = 'return';
  // What is left at this source, including nearby items of the same kind (a seed patch, say)?
  let remaining = Math.max(0, f.mass);
  for (const o of w.foodHash.near(f.x, f.y, 34, buf)) if (o !== f && o.kind === f.kind && o.mass > 0.02) remaining += o.mass;
  a.memory.food = remaining > 0.3 ? { x: f.x, y: f.y } : null;
  a.memory.foodKind = f.kind;
  a.memory.lastFood = w.tick;
  // Recruit only if the source is still worth returning to.
  a.layTrail = remaining > Math.max(0.5, amt * 0.5);
  a.trailQ = clamp(0.6 + (sp.diet[f.kind] || 0) * 0.6 + a.colony.stim.forage * 0.4, 0.4, 1.6);
  a.target = null;
  if (amt > 0) w.colonyStat(a.colony, 'trips', 1);
}

function defendSurface(w, a) {
  const col = a.colony, rng = w.rng;
  const spd = speedOf(w, a) * 1.05;
  a.act = 2.5;
  a.timer++;
  const L = 10;
  let best = 0, bestV = 0;
  for (let k = -1; k <= 1; k++) {
    const ang = a.heading + k * 0.6;
    const v = col.pher.sampleAlarm(a.x + Math.cos(ang) * L, a.y + Math.sin(ang) * L);
    if (v > bestV) { bestV = v; best = k; }
  }
  if (a.avoidT > 0) { a.avoidT--; a.heading += rng.normal() * 0.2; }
  else if (bestV > 0.3) a.heading += best * 0.4 + rng.normal() * 0.1;
  else if (col.threat && w.tick - col.threat.tick < 600) turnToward(a, Math.atan2(col.threat.y - a.y, col.threat.x - a.x), 0.2);
  else {
    a.heading += rng.normal() * 0.25;
    const hd = homeDist(a);
    if (hd > 160) turnToward(a, homeAngle(a), 0.2);
  }
  moveSurface(w, a, spd);
  if (a.timer > 700 && col.alarm < 0.2) { a.mode = 'home'; }
}

function haulSurface(w, a) {
  const col = a.colony, rng = w.rng;
  if (a.mode !== 'dump') {
    a.mode = 'dump';
    a.timer = 0;
    a.heading = rng.angle();
  }
  a.act = 2.6;
  a.timer++;
  moveSurface(w, a, speedOf(w, a) * 0.8);
  const r = col.moundRadius();
  if (homeDist(a) > r * rng.range(0.55, 0.95) || a.timer > 120) {
    col.mound += a.soil;
    a.soil = 0;
    a.carry = null;
    a.mode = 'home';
  }
}

function updateFlight(w, a) {
  a.act = 4;
  a.z += 0.18;
  a.x += Math.cos(a.heading) * 2.2;
  a.y += Math.sin(a.heading) * 2.2;
  a.heading += w.rng.normal() * 0.05;
  if (a.z > 30 || a.x < -20 || a.y < -20 || a.x > w.W + 20 || a.y > w.H + 20) w.resolveFlight(a);
}

// ---------------------------------------------------------------- nest behaviour
function nestBehaviour(w, a) {
  const col = a.colony, nest = col.nest, rng = w.rng;
  // Leave flooded chambers.
  const here = nest.byId(a.cur);
  if (here.flooded && !a.dest && a.task !== 'forage') { nestGoPoint(w, a, nest.find('general', rng)); a.mode = 'evacuate'; }
  if (a.mode === 'evacuate') { if (nestMove(w, a)) { a.mode = ''; } return; }
  if (a.mode === 'unload') return unload(w, a);
  if (a.mode === 'exit') {
    if (nestMove(w, a)) { exitNest(w, a); a.mode = ''; }
    return;
  }
  switch (a.task) {
    case 'queen': return queenNest(w, a);
    case 'alate': return alateNest(w, a);
    case 'flight': if (!a.dest) nestGo(a, 0, 0, 0); if (nestMove(w, a)) { exitNest(w, a); a.flying = true; a.z = 0; } return;
    case 'forage': case 'defend':
      if (a.energy < 0.5 * a.maxEnergy && col.stores.c + col.stores.p > 0.05) { a.task = 'eat'; return; }
      if (!col.surfaceOK && a.task === 'forage') { decideTask(w, a); return; }
      a.mode = 'exit'; nestGo(a, 0, 0, 0); return;
    case 'haul':
      if (!a.dest && a.mode !== 'exit') { a.mode = 'exit'; nestGo(a, 0, 0, 0); }
      return;
    case 'eat': return eatNest(w, a);
    case 'nurse': return nurseNest(w, a);
    case 'dig': return digNest(w, a);
    case 'clean': return cleanNest(w, a);
    case 'mill': return millNest(w, a);
    case 'hibernate': return hibernateNest(w, a);
    default: return restNest(w, a);
  }
}

function unload(w, a) {
  const col = a.colony, nest = col.nest;
  if (!a.dest && a.mode === 'unload' && !a.unloading) {
    const target = col.species.storage === 'internal' ? nest.find('general', w.rng) : nest.find('store', w.rng);
    nestGoPoint(w, a, target);
    a.unloading = true;
  }
  if (!nestMove(w, a)) return;
  a.unloading = false;
  if (a.crop > 0) { col.deposit(w, 'liquid', a.crop, a.cropP / a.crop); a.crop = 0; a.cropP = 0; }
  if (a.carry && a.carry.type === 'food') { col.deposit(w, a.carry.kind, a.carry.mass, a.carry.pFrac); a.carry = null; }
  a.mode = '';
  // Successful foragers usually head straight back out.
  if (a.task === 'forage' && col.surfaceOK && col.stim.forage > 0.1 && a.energy > 0.5 * a.maxEnergy && w.rng.chance(0.8)) {
    a.mode = 'exit'; nestGo(a, 0, 0, 0);
  } else decideTask(w, a);
}

function eatNest(w, a) {
  const col = a.colony;
  if (!a.dest && a.mode !== 'eating') {
    const target = col.species.storage === 'internal' ? col.nest.byId(a.cur) : col.nest.find('store', w.rng);
    if (target.type === 'entrance') nestGoPoint(w, a, col.nest.find('general', w.rng));
    else nestGoPoint(w, a, target);
    a.mode = 'going';
  }
  if (a.mode === 'going') { if (nestMove(w, a)) { a.mode = 'eating'; a.timer = 0; } return; }
  if (++a.timer < 20) return;
  col.feedAdult(w, a, a.maxEnergy - a.energy);
  decideTask(w, a);
  if (a.task === 'eat') a.task = 'rest';
}

function restNest(w, a) {
  if (a.mode !== 'resting') {
    if (!a.dest) nestGoPoint(w, a, a.colony.nest.find('general', w.rng));
    if (nestMove(w, a)) { a.mode = 'resting'; a.timer = w.rng.int(120, 360); }
    return;
  }
  if (--a.timer <= 0) decideTask(w, a);
}

function hibernateNest(w, a) {
  const col = a.colony;
  if (!col.dormant) { decideTask(w, a); return; }
  if (a.mode !== 'still') {
    if (!a.dest) nestGoPoint(w, a, col.nest.deepest());
    if (nestMove(w, a)) { a.mode = 'still'; a.timer = w.rng.int(400, 900); }
    return;
  }
  if (--a.timer <= 0) decideTask(w, a);
}

function queenNest(w, a) {
  const nest = a.colony.nest;
  if (!a.dest) {
    if (a.timer-- > 0) return;
    const q = nest.find('queen', null);
    const p = nest.randomPoint(q, w.rng);
    nestGo(a, q.id, p.x, p.y);
    a.timer = w.rng.int(200, 600);
  }
  nestMove(w, a);
}

function alateNest(w, a) {
  const col = a.colony;
  if (a.energy < 0.85 * a.maxEnergy) col.feedAdult(w, a, Math.min(0.01, a.maxEnergy - a.energy));
  if (!a.dest) {
    if (a.timer-- > 0) return;
    nestGoPoint(w, a, col.nest.find(col.dormant ? 'general' : 'general', w.rng));
    a.timer = w.rng.int(200, 500);
  }
  nestMove(w, a);
}

function nurseNest(w, a) {
  const col = a.colony, nest = col.nest, rng = w.rng;
  if (a.carry && a.carry.type === 'brood') {
    if (nestMove(w, a)) {
      const b = a.carry.b;
      const ch = nest.byId(a.cur);
      if (!b.dead) { b.chamber = ch.id; const p = nest.randomPoint(ch, rng); b.x = p.x; b.y = p.y; }
      a.carry = null;
      a.mode = 'working'; a.timer = 60;
    }
    return;
  }
  if (a.mode !== 'working') {
    if (!a.dest) {
      const ch = col.nurseTarget(rng) || nest.find('brood', rng);
      nestGoPoint(w, a, ch);
    }
    if (nestMove(w, a)) { a.mode = 'working'; a.timer = rng.int(240, 420); }
    return;
  }
  a.act = 1.5;
  if (--a.timer <= 0) { decideTask(w, a); return; }
  if (a.timer % 18 !== 0) return;
  // Feed a hungry larva in this chamber, otherwise consider moving brood to a better chamber.
  if (col.feedLarvaIn(w, a.cur)) return;
  const move = col.relocationCandidate(a.cur, rng);
  if (move) {
    a.carry = { type: 'brood', b: move.b };
    move.b.chamber = -1;
    nestGoPoint(w, a, move.to);
  }
}

function digNest(w, a) {
  const col = a.colony, nest = col.nest;
  if (!nest.digSite) { decideTask(w, a); return; }
  if (a.mode !== 'digging') {
    if (!a.dest) {
      const face = nest.digFace();
      nestGo(a, face.parent, face.x, face.y);
    }
    if (nestMove(w, a)) { a.mode = 'digging'; a.timer = 0; }
    return;
  }
  a.act = 4;
  const rate = 0.09 * Math.sqrt(a.metScale);
  const r = nest.dig(rate);
  a.soil += r.soil;
  if (r.done) w.event('build', `${col.name} completed a new ${r.chamber.type} chamber`, col, 'minor');
  // Follow the face as it advances.
  const face = nest.digFace();
  if (face && ++a.timer % 30 === 0) { a.ux = face.x; a.uy = face.y; }
  if (a.soil >= 3 || !nest.digSite) {
    a.task = 'haul';
    a.carry = { type: 'soil' };
    a.mode = 'exit';
    nestGo(a, 0, 0, 0);
  }
}

function cleanNest(w, a) {
  const col = a.colony, nest = col.nest, rng = w.rng;
  if (a.carry && a.carry.type === 'corpse') {
    if (nestMove(w, a)) {
      const c = a.carry.c;
      const ch = nest.byId(a.cur);
      const p = nest.randomPoint(ch, rng);
      c.x = p.x; c.y = p.y; c.chamber = ch.id; c.carried = false;
      a.carry = null;
      decideTask(w, a);
    }
    return;
  }
  if (!a.target) {
    const refuse = nest.find('refuse', null);
    const c = nest.corpses.find((k) => !k.carried && k.chamber !== refuse.id);
    if (!c) { decideTask(w, a); return; }
    a.target = c;
    nestGo(a, c.chamber, c.x, c.y);
  }
  if (nestMove(w, a)) {
    const c = a.target;
    a.target = null;
    if (c.carried) return;
    c.carried = true;
    a.carry = { type: 'corpse', c };
    nestGoPoint(w, a, nest.find('refuse', null));
  }
}

function millNest(w, a) {
  const col = a.colony;
  if (a.mode !== 'milling') {
    if (!a.dest) nestGoPoint(w, a, col.nest.find('store', w.rng));
    if (nestMove(w, a)) { a.mode = 'milling'; a.timer = w.rng.int(250, 400); }
    return;
  }
  a.act = 2.5;
  col.mill(w, 0.006 * a.metScale);
  if (--a.timer <= 0 || col.stores.seed <= 0) decideTask(w, a);
}

export { TASKS };
export const FOOD_LIQUID = (k) => FOOD_KINDS[k].liquid;
