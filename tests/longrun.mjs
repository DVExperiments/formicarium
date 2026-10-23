// Long-duration unattended simulation test.
// Usage: node tests/longrun.mjs [days=64] [seed=longrun] [--colonies]
// Checks invariants every simulated day and prints a one-line summary per colony.
import { World } from '../js/sim/world.js';
import { TPD, SEASONS } from '../js/sim/constants.js';

const args = process.argv.slice(2);
const days = +(args.find((a) => /^\d+$/.test(a)) || 64);
const seed = args.find((a) => !/^\d+$/.test(a) && !a.startsWith('--')) || 'longrun';
const w = new World({ seed });
if (args.includes('--colonies')) {
  w.addColony('pheidole', 380, 340);
  w.addColony('messor', 1250, 860);
}
let problems = 0;
const t0 = Date.now();
for (let d = 1; d <= days; d++) {
  for (let i = 0; i < TPD; i++) w.step();
  const L = w.ledgerCheck();
  if (!(L.relError < 1e-8)) { problems++; console.log(`  ! ledger error ${L.relError}`); }
  for (const a of w.ants) {
    if (!Number.isFinite(a.x + a.y + a.energy + a.ux + a.uy)) { problems++; console.log(`  ! non-finite ant state #${a.id}`); break; }
  }
  for (const c of w.colonies) {
    if (c.stores.c < -1e-9 || c.stores.p < -1e-9 || c.stores.seed < -1e-9) { problems++; console.log(`  ! negative stores in ${c.name}`); }
  }
  const env = w.env;
  const cols = w.colonies.map((c) => c.extinct ? `${c.species.id}#${c.id}: extinct`
    : `${c.species.id}#${c.id}: ${c.counts.workers + c.counts.majors}w ${c.counts.queens}q ${c.counts.eggs}/${c.counts.larvae}/${c.counts.pupae} brood ${(c.stores.c + c.stores.p).toFixed(0)} food${c.dormant ? ' (dormant)' : ''}`).join(' | ');
  console.log(`Day ${String(d).padStart(3)} ${SEASONS[env.season].padEnd(6)} ${env.temp.toFixed(1).padStart(5)}°C ants ${String(w.ants.length).padStart(4)} | ${cols}`);
}
const secs = (Date.now() - t0) / 1000;
console.log(`\n${days} simulated days in ${secs.toFixed(1)} s (${(days * TPD / secs).toFixed(0)} ticks/s)`);
console.log('Recent events:\n' + w.events.filter((e) => e.type !== 'weather').slice(-25).map((e) => `  day ${(e.tick / TPD).toFixed(1)}: ${e.text}`).join('\n'));
console.log(problems ? `\n${problems} invariant problems found` : '\nAll invariants held.');
process.exit(problems ? 1 : 0);
