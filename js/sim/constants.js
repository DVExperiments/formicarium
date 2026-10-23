// Global simulation constants. Simulation time is measured in ticks.
// One tick is a fixed step; speed controls only how many ticks run per real second.

export const TPD = 2400;              // ticks per simulated day
export const TPH = TPD / 24;          // ticks per simulated hour (100)
export const SEASON_DAYS = 8;         // compressed seasons (see README: time scale)
export const YEAR_DAYS = SEASON_DAYS * 4;
export const TICKS_PER_SECOND_1X = 20;
export const START_DOY = 5;           // simulation starts on spring day 6...
export const START_HOUR = 9;          // ...at 09:00
export const START_TICK = START_DOY * TPD + START_HOUR * TPH;

export const WORLD_W = 1600;
export const WORLD_H = 1200;
export const CELL = 8;                               // pheromone / obstacle grid cell
export const GRID_W = Math.ceil(WORLD_W / CELL);     // 200
export const GRID_H = Math.ceil(WORLD_H / CELL);     // 150
export const PRES_CELL = 40;                         // territory grid cell
export const PRES_W = WORLD_W / PRES_CELL;
export const PRES_H = WORLD_H / PRES_CELL;

export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
export const MAX_COLONIES = 16;       // including extinct colonies
export const MAX_LIVING = 8;
export const PHERO_INTERVAL = 20;     // pheromone decay runs every N ticks (exact compounding)

export const COLONY_COLORS = ['#e3a535', '#58b8c4', '#d9739f', '#a3c64a', '#ef7d45', '#9b8bd1',
  '#e9d75a', '#6aa3e8', '#c9a27a', '#7fd1a8', '#f2a3a3', '#b0b0b0', '#ffcc80', '#80cbc4', '#ce93d8', '#c5e1a5'];

// Food kinds. Mass is in nutrient units; pFrac is the protein share, the rest is carbohydrate.
export const FOOD_KINDS = {
  sugar:    { label: 'Sugar water', pFrac: 0.0,  liquid: true,  decay: 0.03, placeMass: 120, coop: false },
  honeydew: { label: 'Aphid honeydew', pFrac: 0.05, liquid: true, decay: 0.0, placeMass: 0, coop: false },
  fruit:    { label: 'Fruit',       pFrac: 0.04, liquid: true,  decay: 0.10, placeMass: 90,  coop: false },
  insect:   { label: 'Dead insect', pFrac: 0.75, liquid: false, decay: 0.16, placeMass: 22,  coop: true  },
  seed:     { label: 'Seeds',       pFrac: 0.30, liquid: false, decay: 0.025,  placeMass: 2.4, coop: false },
  corpse:   { label: 'Ant corpse',  pFrac: 0.80, liquid: false, decay: 0.22, placeMass: 0,   coop: true  },
};

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
// Metabolic temperature scaling (Q10 = 2, referenced to 25 °C).
export const q10 = (t) => Math.pow(2, (clamp(t, -5, 45) - 25) / 10);
// Brood development rate multiplier from temperature.
export function devFactor(t) {
  if (t <= 9) return 0;
  if (t < 26) return (t - 9) / 17;
  if (t <= 33) return 1;
  if (t < 40) return (40 - t) / 7;
  return 0;
}
export const ticksToDays = (t) => t / TPD;
