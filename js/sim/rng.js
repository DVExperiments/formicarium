// Seeded, deterministic pseudo-random generator (mulberry32).
// Every random decision in the simulation flows through an RNG instance so runs are repeatable.

export function hashSeed(input) {
  const s = String(input);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1;
}

export class RNG {
  constructor(seed) {
    this.state = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0;
    this.spare = null;
  }
  next() {
    let a = (this.state = (this.state + 0x6d2b79f5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  angle() { return this.next() * Math.PI * 2; }
  normal() {
    if (this.spare !== null) { const s = this.spare; this.spare = null; return s; }
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    v = this.next();
    const m = Math.sqrt(-2 * Math.log(u));
    this.spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  }
  fork(label) { return new RNG(hashSeed(this.state + ':' + label)); }
}
