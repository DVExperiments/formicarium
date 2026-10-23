// Node test runner: `node tests/run.mjs`
import { runTests } from './suite.js';
console.log('Formicarium simulation tests\n');
const t0 = Date.now();
const { fail } = runTests();
console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
