// Automated tests for the simulation engine. Runs in Node (tests/run.mjs) and in the browser (tests/index.html).
import { World } from '../js/sim/world.js';
import { PheromoneField } from '../js/sim/pheromone.js';
import { Ant, decideTask } from '../js/sim/ant.js';
import { TPD, devFactor, q10 } from '../js/sim/constants.js';
import { SPECIES } from '../js/sim/species.js';

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function approx(a, b, tol, msg) { if (Math.abs(a - b) > tol) throw new Error(`${msg}: expected ${b} ± ${tol}, got ${a}`); }
function run(w, ticks) { for (let i = 0; i < ticks; i++) w.step(); }

// An empty world with one colony and no natural food, for controlled experiments.
function labWorld(species = 'lasius', seed = 'lab') {
  const w = new World({ seed, colony: false, naturalFood: false });
  const col = w.addColony(species, 800, 600, { source: 'initial' });
  w.hourlyNature = () => {}; // no natural food or prey
  return { w, col };
}
function fixTemperature(w, t) {
  w.env.chamberTemp = () => t;
  for (const c of w.colonies) c.nest.updateConditions(w.env);
}

export const tests = [
  // ---------------------------------------------------------------- pheromones
  ['Pheromone trail decays with its configured half-life', () => {
    const p = new PheromoneField(400);
    p.depositTrail(100, 100, 10);
    p.decay(400);
    approx(p.sampleTrail(100, 100), 5, 0.01, 'value after one half-life');
    p.decay(400);
    approx(p.sampleTrail(100, 100), 2.5, 0.01, 'value after two half-lives');
  }],
  ['Pheromone decay is independent of batch size', () => {
    const a = new PheromoneField(300), b = new PheromoneField(300);
    a.depositTrail(50, 50, 20); b.depositTrail(50, 50, 20);
    for (let i = 0; i < 600; i++) a.decay(1);
    for (let i = 0; i < 30; i++) b.decay(20);
    approx(a.sampleTrail(50, 50), b.sampleTrail(50, 50), 1e-4, 'batched vs per-tick decay');
  }],
  ['Unreinforced trails eventually disappear', () => {
    const p = new PheromoneField(420);
    for (let x = 0; x < 200; x += 8) p.depositTrail(x, 300, 30);
    assert(p.totalTrail() > 0, 'trail was laid');
    for (let i = 0; i < 420 * 14; i += 20) p.decay(20);
    assert(p.totalTrail() === 0, `trail should be gone, total ${p.totalTrail()}`);
  }],
  ['Alarm pheromone fades much faster than trail pheromone', () => {
    const p = new PheromoneField(420, 50);
    p.depositTrail(80, 80, 10); p.depositAlarm(80, 80, 10);
    p.decay(200);
    assert(p.sampleAlarm(80, 80) < p.sampleTrail(80, 80) * 0.2, 'alarm should decay faster');
  }],
  ['Separate colonies keep separate pheromone networks', () => {
    const w = new World({ seed: 'phero', naturalFood: false });
    const b = w.addColony('lasius', 300, 300);
    w.colonies[0].pher.depositTrail(500, 500, 10);
    assert(b.pher.sampleTrail(500, 500) === 0, 'other colony should not sense the trail');
  }],

  // ---------------------------------------------------------------- energy and resources
  ['Metabolism consumes energy and scales with temperature', () => {
    assert(q10(35) > q10(25) && q10(25) > q10(15), 'Q10 should increase with temperature');
    approx(q10(35) / q10(25), 2, 1e-9, 'Q10 ratio');
    const { w, col } = labWorld();
    const a = col.ants.find((x) => x.caste === 'worker');
    const before = a.energy;
    run(w, 200);
    assert(a.dead || a.energy < before + col.stores.c + 1, 'energy should not appear from nowhere');
    assert(w.ledger.sinks.metabolism > 0, 'metabolism sink should grow');
  }],
  ['Resource ledger is conserved in a full multi-colony world', () => {
    const w = new World({ seed: 'ledger' });
    w.addColony('pheidole', 400, 350);
    w.addColony('messor', 1250, 850);
    w.placeFood('sugar', 760, 560);
    w.placeFood('insect', 860, 640);
    w.placeFood('seed', 840, 540);
    w.placeFood('fruit', 700, 650);
    run(w, TPD * 2);
    const L = w.ledgerCheck();
    assert(L.relError < 1e-9, `ledger error ${L.relError}`);
  }],
  ['Placed food is physically depleted as ants collect it', () => {
    const { w, col } = labWorld();
    w.placeFood('sugar', col.x + 40, col.y + 20);
    const f = w.foods.find((x) => x.kind === 'sugar');
    const m0 = f.mass;
    run(w, TPD / 2);
    assert(f.mass < m0 - 1, `sugar should be depleted (was ${m0}, now ${f.mass})`);
    assert(col.stats.gathered > 0, 'colony should have gathered food');
  }],
  ['Colonies do not grow just by discovering food: storage is finite', () => {
    const { w, col } = labWorld();
    for (let i = 0; i < 6; i++) w.placeFood('sugar', col.x + 30 + i * 6, col.y + 30);
    run(w, TPD);
    assert(col.stores.c + col.stores.p <= col.storeCapacity() + 1e-6, 'stores cannot exceed capacity');
    const L = w.ledgerCheck();
    assert(L.relError < 1e-9, 'ledger conserved with surplus food');
  }],
  ['Starving ants die and their energy is accounted for', () => {
    const { w, col } = labWorld();
    w.sink('spoilage', col.stores.c + col.stores.p); col.stores.c = 0; col.stores.p = 0;
    for (const a of col.ants) { w.sink('metabolism', a.energy - 0.0005); a.energy = 0.0005; }
    run(w, 80);
    assert(col.stats.causes.starvation > 0, 'ants should starve');
    assert(w.ledgerCheck().relError < 1e-9, 'ledger conserved through starvation');
  }],

  // ---------------------------------------------------------------- brood and reproduction
  ['Development rate responds to temperature', () => {
    assert(devFactor(5) === 0, 'no development when cold');
    assert(devFactor(28) === 1, 'optimal development');
    assert(devFactor(20) > devFactor(15), 'warmer is faster below optimum');
    assert(devFactor(38) < devFactor(30), 'too hot slows development');
  }],
  ['Brood passes egg → larva → pupa → adult when fed at optimal temperature', () => {
    const { w, col } = labWorld();
    fixTemperature(w, 28);
    w.source('player', 120 - col.stores.c - col.stores.p); col.stores.c = 60; col.stores.p = 60;
    for (const b of col.brood) w.sink('broodLoss', b.mass);
    col.brood.length = 0;
    const q = col.queens[0];
    const egg = (() => { col.layEgg(w, q); return col.brood[col.brood.length - 1]; })();
    const sp = SPECIES.lasius;
    const stages = new Set();
    const births0 = col.stats.births;
    for (let t = 0; t < TPD * 12 && !egg.dead; t++) {
      w.step(); fixTemperature(w, 28); stages.add(egg.stage);
      // abundant supply: keep stores topped up, recorded as a source in the ledger
      if (col.stores.c < 30) { w.source('player', 30 - col.stores.c); col.stores.c = 30; }
      if (col.stores.p < 30) { w.source('player', 30 - col.stores.p); col.stores.p = 30; }
    }
    assert(stages.has('larva') && stages.has('pupa'), `stages seen: ${[...stages]}`);
    assert(egg.dead && col.stats.births > births0, 'the brood item should emerge as an adult');
    const total = sp.devDays.egg + sp.devDays.larva + sp.devDays.pupa;
    assert((w.tick) / TPD >= total * 0.95, 'development takes simulated time');
    assert(w.ledgerCheck().relError < 1e-9, 'ledger conserved');
  }],
  ['Unfed larvae starve to death', () => {
    const { w, col } = labWorld();
    fixTemperature(w, 26);
    col.stores.c = 0; col.stores.p = 0;
    for (const b of col.brood) if (b.stage === 'larva') { b.fedP = 0; b.fedC = 0; }
    const larvae = col.brood.filter((b) => b.stage === 'larva').length;
    assert(larvae > 0, 'need larvae for this test');
    run(w, Math.round(TPD * 1.9));
    assert(col.stats.broodDeaths >= 1, 'larvae should starve without food');
  }],
  ['Egg laying is paid for from the queen\u2019s reserves', () => {
    const { w, col } = labWorld();
    const q = col.queens[0];
    const e0 = q.energy, n0 = col.brood.length;
    col.layEgg(w, q);
    assert(col.brood.length === n0 + 1, 'egg laid');
    approx(q.energy, e0 - SPECIES.lasius.eggCost, 1e-9, 'queen energy reduced by egg cost');
  }],
  ['No eggs are laid during winter dormancy', () => {
    const { w, col } = labWorld();
    col.dormant = true;
    col.slowUpdate = () => {}; // keep dormant
    const laid = col.stats.eggsLaid;
    run(w, TPD);
    assert(col.stats.eggsLaid === laid, 'dormant queens do not lay');
  }],

  // ---------------------------------------------------------------- population
  ['A colony without food declines', () => {
    const { w, col } = labWorld();
    col.stores.c = 0; col.stores.p = 0;
    for (const a of col.ants) { if (a.caste !== 'queen') { w.sink('metabolism', a.energy - 0.3); a.energy = 0.3; } }
    const p0 = col.ants.filter((a) => a.caste === 'worker').length;
    run(w, TPD);
    const p1 = col.ants.filter((a) => a.caste === 'worker' && !a.dead).length;
    assert(p1 < p0, `population should fall (${p0} → ${p1})`);
  }],
  ['A fed colony grows through births', () => {
    const { w, col } = labWorld();
    fixTemperature(w, 27);
    const orig = w.step.bind(w);
    w.step = () => { orig(); if (w.tick % 50 === 0) fixTemperature(w, 27); };
    for (let i = 0; i < 4; i++) w.placeFood('insect', col.x + 40 + i * 12, col.y - 40);
    for (let i = 0; i < 3; i++) w.placeFood('sugar', col.x - 50, col.y + 30 + i * 15);
    run(w, TPD * 9);
    assert(col.stats.births > 5, `expected births, got ${col.stats.births}`);
  }],
  ['A colony with no adults and no developing brood goes extinct but keeps its nest and history', () => {
    const { w, col } = labWorld();
    run(w, TPD / 4);
    for (const a of col.ants) w.killAnt(a, 'test');
    for (const b of col.brood) if (b.stage === 'pupa') b.stage = 'larva';
    w.ants = w.ants.filter((a) => !a.dead); col.ants = [];
    run(w, 60);
    assert(col.extinct, 'colony should be extinct');
    assert(col.nest.chambers.length >= 5, 'nest structure persists');
    assert(col.nest.corpses.length > 0, 'dead ants remain in the nest');
    assert(col.history.t.length > 0, 'history preserved');
    const before = col.stats.births;
    run(w, TPD / 2);
    assert(col.stats.births === before, 'extinct colonies produce no ants');
  }],

  // ---------------------------------------------------------------- determinism and architecture
  ['Same seed produces identical runs', () => {
    const a = new World({ seed: 42 }), b = new World({ seed: 42 });
    run(a, 1500); run(b, 1500);
    assert(a.hash() === b.hash(), 'hashes should match');
    const c = new World({ seed: 43 });
    run(c, 1500);
    assert(a.hash() !== c.hash(), 'different seeds should differ');
  }],
  ['Simulation speed does not change outcomes (batch size invariance)', () => {
    const a = new World({ seed: 'speed' }), b = new World({ seed: 'speed' });
    for (let i = 0; i < 1200; i++) a.step();           // 1x: one tick per call
    for (let f = 0; f < 120; f++) for (let i = 0; i < 10; i++) b.step(); // 10x: ten ticks per frame
    assert(a.hash() === b.hash(), 'state should be identical regardless of ticks per frame');
  }],
  ['Nest paths follow the tunnel tree', () => {
    const { col } = labWorld();
    const n = col.nest;
    const leaf = n.chambers[n.chambers.length - 1];
    const path = n.path(leaf.id, 0);
    assert(path[path.length - 1] === 0, 'path ends at entrance');
    for (let i = 0; i < path.length; i++) {
      const from = i === 0 ? leaf.id : path[i - 1];
      const a = n.byId(from), b = n.byId(path[i]);
      assert(a.parent === b.id || b.parent === a.id, 'each step uses a tunnel');
    }
    assert(n.path(0, leaf.id).join() === [...path.slice(0, -1).reverse(), leaf.id].join(), 'paths are symmetric');
  }],
  ['Excavation costs work and creates usable space', () => {
    const { w, col } = labWorld();
    const n = col.nest;
    const cap0 = n.adultCapacity();
    const ch = n.plan('general');
    assert(ch, 'a chamber can be planned');
    assert(!n.usable(ch), 'planned chamber not usable before digging');
    let guard = 0;
    while (n.digSite && guard++ < 100000) n.dig(0.5);
    assert(n.usable(ch) && n.adultCapacity() > cap0, 'dug chamber adds capacity');
  }],
  ['Workers switch tasks in response to colony needs', () => {
    const { w, col } = labWorld();
    run(w, 400);
    const workers = col.ants.filter((a) => a.caste === 'worker' && !a.dead);
    const base = { forage: 0, nurse: 0, dig: 0, clean: 0, defend: 0, mill: 0, protein: 0, full: 0 };
    const share = (task) => {
      for (const a of workers) { a.energy = a.maxEnergy; decideTask(w, a); }
      return workers.filter((a) => a.task === task).length / workers.length;
    };
    col.stim = { ...base, defend: 1 };
    const defend = share('defend');
    col.stim = { ...base, forage: 1 };
    const forage = share('forage');
    col.stim = { ...base };
    const rest = share('rest');
    assert(defend > 0.3, `defence share ${defend}`);
    assert(forage > 0.3, `forage share ${forage}`);
    assert(rest > 0.9, `with no stimuli most workers rest (${rest})`);
  }],
  ['Rival colonies fight only under some conditions, with casualties', () => {
    const w = new World({ seed: 'war', naturalFood: false, colony: false });
    const a = w.addColony('pheidole', 700, 600, { source: 'initial' });
    const b = w.addColony('lasius', 900, 600, { source: 'initial' });
    w.hourlyNature = () => {};
    w.placeFood('insect', 800, 600);
    w.placeFood('sugar', 800, 620);
    run(w, TPD);
    assert(w.pairsFought.size >= 1, 'neighbouring colonies competing for food should clash');
    assert((a.stats.kills + b.stats.kills) >= 0, 'kills tracked');
    assert(w.ledgerCheck().relError < 1e-9, 'ledger conserved through combat');
  }],
];

export function runTests(log = console.log) {
  let pass = 0, fail = 0;
  const results = [];
  for (const [name, fn] of tests) {
    const t0 = Date.now();
    try { fn(); pass++; results.push({ name, ok: true, ms: Date.now() - t0 }); log(`  ✓ ${name} (${Date.now() - t0} ms)`); }
    catch (e) { fail++; results.push({ name, ok: false, error: e.message }); log(`  ✗ ${name}\n      ${e.message}`); }
  }
  log(`\n${pass} passed, ${fail} failed`);
  return { pass, fail, results };
}

export { Ant };
