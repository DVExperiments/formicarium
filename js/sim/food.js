import { FOOD_KINDS } from './constants.js';

// A physical food resource in the world. Mass is nutrient content; it is depleted as ants take it.
export class Food {
  constructor(id, kind, x, y, mass, opts = {}) {
    this.id = id;
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.mass = mass;
    this.initialMass = mass;
    this.maxMass = opts.maxMass || mass;
    this.regen = opts.regen || 0;         // honeydew regeneration per day
    this.plantId = opts.plantId ?? null;
    this.colonyId = opts.colonyId ?? null; // for ant corpses
    this.species = opts.species || null;
    this.caste = opts.caste || null;
    this.size = opts.size || 0;
    this.heading = opts.heading ?? 0;
    this.variant = opts.variant ?? 0;
    this.age = 0;
    this.carriers = [];
    this.source = opts.source || 'natural';
  }
  get def() { return FOOD_KINDS[this.kind]; }
  get pFrac() { return FOOD_KINDS[this.kind].pFrac; }
  get liquid() { return FOOD_KINDS[this.kind].liquid; }
  // Physical radius used for detection, contact and drawing.
  get radius() {
    const m = Math.max(0, this.mass);
    switch (this.kind) {
      case 'sugar': return 3 + Math.sqrt(m) * 1.1;
      case 'honeydew': return 4 + Math.sqrt(m) * 0.6;
      case 'fruit': return 4 + Math.sqrt(this.initialMass) * 0.9 * (0.55 + 0.45 * m / this.initialMass);
      case 'insect': return 3 + Math.sqrt(m) * 1.3;
      case 'seed': return this.regen ? 5 + Math.sqrt(m) * 0.9 : 1.6 + m * 0.35;
      case 'corpse': return 2 + this.size * 0.45;
      default: return 3;
    }
  }
  take(amount) {
    const a = Math.min(this.mass, Math.max(0, amount));
    this.mass -= a;
    return a;
  }
}
