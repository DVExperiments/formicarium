import { TPD, TPH, SEASON_DAYS, YEAR_DAYS, START_TICK, clamp } from './constants.js';

// Day/night, temperature, rain, soil moisture and seasons.
// Underground temperature follows a lagged, damped version of surface temperature.
export class Environment {
  constructor(rng) {
    this.rng = rng;
    this.tick = 0;
    this.weather = 0;        // slow weather anomaly (°C)
    this.rain = 0;           // current rain intensity 0..1
    this.raining = false;
    this.rainTarget = 0;
    this.moisture = 0.4;     // soil moisture 0..1
    const m = this.seasonalMean(this.dayOfYear);
    this.deep = m - 1;
    this.compute();
    this.surfSmooth = this.temp;
  }
  get abs() { return this.tick + START_TICK; }
  get day() { return Math.floor(this.abs / TPD); }
  get timeOfDay() { return (this.abs % TPD) / TPD; }
  get dayOfYear() { return (this.abs / TPD) % YEAR_DAYS; }
  get season() { return Math.floor(this.dayOfYear / SEASON_DAYS) % 4; }
  get seasonDay() { return Math.floor(this.dayOfYear % SEASON_DAYS) + 1; }
  get year() { return Math.floor(this.abs / TPD / YEAR_DAYS) + 1; }
  get hour() { return this.timeOfDay * 24; }
  get elapsedDays() { return this.tick / TPD; }

  seasonalMean(doy) { return 15 + 9.5 * Math.cos((2 * Math.PI * (doy - 12)) / YEAR_DAYS); }
  dayLength(doy) { return 12 + 3.2 * Math.cos((2 * Math.PI * (doy - 12)) / YEAR_DAYS); }

  compute() {
    const doy = this.dayOfYear, tod = this.timeOfDay;
    const amp = 5 + 2 * Math.cos((2 * Math.PI * (doy - 12)) / YEAR_DAYS);
    this.seasonMean = this.seasonalMean(doy);
    this.temp = this.seasonMean + amp * Math.sin(2 * Math.PI * (tod - 0.375)) + this.weather - this.rain * 3;
    const dl = this.dayLength(doy), h = tod * 24;
    const rise = 12 - dl / 2, set = 12 + dl / 2;
    this.daylight = clamp(Math.min(h - rise + 0.6, set - h + 0.6) / 1.2, 0, 1) * (1 - this.rain * 0.35);
  }

  step() {
    this.tick++;
    if (this.tick % TPH === 0) this.hourly();
    const target = this.raining ? this.rainTarget : 0;
    this.rain += (target - this.rain) * 0.02;
    if (this.rain < 0.002 && !this.raining) this.rain = 0;
    this.compute();
    const evap = (0.00012 + Math.max(0, this.temp - 5) * 0.000012) * this.moisture * (this.raining ? 0.2 : 1);
    this.moisture = clamp(this.moisture + this.rain * 0.0016 - evap, 0, 1);
    this.surfSmooth += (this.temp - this.surfSmooth) / (TPH * 3);
    this.deep += (this.seasonMean - this.deep) / (TPD * 4);
  }

  hourly() {
    const r = this.rng;
    this.weather = clamp(this.weather * 0.96 + r.normal() * 0.45, -6, 6);
    const s = this.season;
    if (!this.raining) {
      if (r.next() < [0.035, 0.02, 0.045, 0.035][s]) {
        this.raining = true;
        this.rainTarget = 0.3 + r.next() * 0.7;
        this.justStartedRain = true;
      }
    } else if (r.next() < 0.18) {
      this.raining = false;
    }
  }

  // Temperature in a nest chamber at a given depth (world units below the surface).
  chamberTemp(depth) {
    return this.deep + (this.surfSmooth - this.deep) * Math.exp(-depth / 75);
  }
}
