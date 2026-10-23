// Presentation layer: main loop, input, camera, panels. The simulation itself lives in js/sim.
import { World } from '../sim/world.js';
import { SPECIES, SPECIES_LIST } from '../sim/species.js';
import { TPD, TICKS_PER_SECOND_1X, SEASONS, FOOD_KINDS } from '../sim/constants.js';
import { Camera } from '../render/camera.js';
import { SurfaceRenderer } from '../render/surface.js';
import { UndergroundRenderer, LABELS } from '../render/underground.js';
import { drawChart } from '../render/charts.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
const n1 = (v) => (Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(1));

const METRICS = {
  workers: { label: 'Workers', get: (h, i) => h.workers[i] + h.majors[i] },
  brood: { label: 'Brood (eggs, larvae, pupae)', get: (h, i) => h.eggs[i] + h.larvae[i] + h.pupae[i] },
  stores: { label: 'Food stores', get: (h, i) => h.storesC[i] + h.storesP[i] + h.seeds[i] },
  gathered: { label: 'Food gathered (total)', get: (h, i) => h.gathered[i] },
  births: { label: 'Births (total)', get: (h, i) => h.births[i] },
  deaths: { label: 'Deaths (total)', get: (h, i) => h.deaths[i] },
  energy: { label: 'Average worker energy (%)', get: (h, i) => h.energy[i] },
  foragers: { label: 'Ants foraging on the surface', get: (h, i) => h.foragers[i] },
  territory: { label: 'Territory (% of map)', get: (h, i) => h.territory[i] },
  reproductives: { label: 'Queens and winged alates', get: (h, i) => h.queens[i] + h.alates[i] },
};
const CASTE = { worker: 'Worker', major: 'Major worker (soldier)', queen: 'Queen', gyne: 'Winged queen (gyne)', male: 'Winged male' };

export class App {
  constructor() {
    const params = new URLSearchParams(location.search);
    this.seed = params.get('seed') || String(Math.floor(Math.random() * 1e6));
    this.startSpecies = SPECIES[params.get('species')] ? params.get('species') : 'lasius';
    this.canvas = $('#world');
    this.ctx = this.canvas.getContext('2d');
    this.speed = 1; this.paused = false;
    this.tool = 'inspect';
    this.placeSpecies = null;
    this.overlays = { pheromones: false, territory: false, debug: false };
    this.view = 'surface';
    this.sel = null; this.follow = false;
    this.tab = 'inspect';
    this.reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.perf = { tps: 0, ticks: 0, ms: 0, msPerTick: 0, fps: 0, frames: 0, last: performance.now() };
    this.newWorld();
    this.bindUI();
    this.resize();
    addEventListener('resize', () => this.resize());
    this.last = performance.now(); this.acc = 0; this.lastUI = 0;
    requestAnimationFrame((t) => this.frame(t));
    this.toast('Welcome. Drag food from the toolbar onto the ground, or click a nest to look inside.', 6000);
  }

  // ---------------------------------------------------------------- world lifecycle
  newWorld() {
    const t0 = performance.now();
    this.world = new World({ seed: this.seed, species: this.startSpecies });
    this.surface = new SurfaceRenderer(this.world);
    this.under = new UndergroundRenderer(this.world);
    this.cam = new Camera(this.world.W / 2, this.world.H / 2, 2.2, 0.35, 7);
    this.cam.bounds = { x0: 0, y0: 0, x1: this.world.W, y1: this.world.H };
    this.ucam = new Camera(0, 170, 1.4, 0.5, 8);
    this.ucam.bounds = { x0: -330, y0: -80, x1: 330, y1: 480 };
    this.nestColony = this.world.colonies[0] || null;
    this.sel = null; this.follow = false; this.view = 'surface'; this.fittedNest = null;
    this.acc = 0;
    if (this.canvas.clientWidth) this.resize();
    this.lastEventCount = -1;
    console.info(`World built in ${(performance.now() - t0).toFixed(0)} ms (seed ${this.seed})`);
  }
  reset() {
    this.newWorld();
    this.setView('surface');
    this.updateUI(true);
    this.toast(`Simulation reset (seed ${this.seed})`);
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    const w = innerWidth, h = innerHeight;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.cam.resize(w, h); this.ucam.resize(w, h);
    this.updateOffsets();
  }

  // Shift the view centre so the focus point sits in the middle of the uncovered area.
  updateOffsets() {
    const wide = innerWidth > 860;
    const panelOpen = !$('#panel').classList.contains('collapsed');
    const ox = wide ? ((panelOpen ? $('#panel').offsetWidth : 0) - 100) / 2 : 0;
    const oy = !wide && panelOpen ? innerHeight * 0.23 : 0;
    for (const c of [this.cam, this.ucam]) { c.ox = ox; c.oyShift = oy; }
  }
  // Frame the whole nest of a colony in the underground view.
  fitNest(col) {
    const ch = col.nest.chambers;
    let x0 = -60, x1 = 60, y0 = -40, y1 = 60;
    for (const c of ch) { x0 = Math.min(x0, c.x - c.rx); x1 = Math.max(x1, c.x + c.rx); y1 = Math.max(y1, c.y + c.ry); }
    const wide = innerWidth > 860;
    const availW = wide ? innerWidth - (this.$panelW() + 120) : innerWidth;
    const availH = (wide ? innerHeight - 130 : innerHeight * 0.45);
    const z = Math.min(availW / (x1 - x0 + 80), availH / (y1 - y0 + 80));
    this.ucam.focus((x0 + x1) / 2, (y0 + y1) / 2, Math.max(0.8, Math.min(5, z)));
    this.ucam.x = this.ucam.tx; this.ucam.y = this.ucam.ty; this.ucam.zoom = this.ucam.tzoom;
    this.fittedNest = col;
  }
  $panelW() { return $('#panel').classList.contains('collapsed') ? 0 : $('#panel').offsetWidth; }

  // ---------------------------------------------------------------- main loop
  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.paused) {
      this.acc += dt * TICKS_PER_SECOND_1X * this.speed;
      const t0 = performance.now();
      let n = 0;
      while (this.acc >= 1) {
        this.world.step();
        this.acc -= 1; n++;
        if ((n & 3) === 0 && performance.now() - t0 > 13) break;
      }
      // If the device can't keep up, drop the backlog: the simulation slows down instead of skipping ticks.
      if (this.acc > TICKS_PER_SECOND_1X * this.speed * 0.3) this.acc = 0;
      this.perf.ticks += n; this.perf.ms += performance.now() - t0;
    }
    this.perf.frames++;
    if (now - this.perf.last > 1000) {
      const s = (now - this.perf.last) / 1000;
      this.perf.tps = this.perf.ticks / s; this.perf.fps = this.perf.frames / s;
      this.perf.msPerTick = this.perf.ticks ? this.perf.ms / this.perf.ticks : 0;
      this.perf.ticks = 0; this.perf.ms = 0; this.perf.frames = 0; this.perf.last = now;
    }
    this.updateFollow();
    const cam = this.view === 'surface' ? this.cam : this.ucam;
    cam.update(dt, this.reduceMotion);
    try {
      if (this.view === 'surface') {
        this.surface.render(this.ctx, this.cam, this.dpr, { ...this.overlays, selected: this.sel, time: now, ghost: this.ghost, reduceMotion: this.reduceMotion });
      } else if (this.nestColony) {
        this.under.render(this.ctx, this.ucam, this.dpr, this.nestColony, { selected: this.sel, time: now, hoverChamber: this.hoverChamber });
      }
    } catch (e) { console.error(e); }
    if (now - this.lastUI > 300) { this.lastUI = now; this.updateUI(); }
    requestAnimationFrame((t) => this.frame(t));
  }

  updateFollow() {
    if (!this.follow || !this.sel || this.sel.type !== 'ant') return;
    const a = this.sel.ant;
    if (a.dead) { this.follow = false; return; }
    if (a.loc === 'surface' && !a.flying) {
      if (this.view !== 'surface') { this.setView('surface'); this.cam.tzoom = Math.max(this.cam.tzoom, 3.5); }
      this.cam.focus(a.x, a.y);
    } else if (a.loc === 'nest') {
      if (this.view !== 'nest' || this.nestColony !== a.colony) { this.nestColony = a.colony; this.setView('nest'); this.ucam.tzoom = 4; }
      this.ucam.focus(a.ux, a.uy);
    }
  }

  // ---------------------------------------------------------------- input
  bindUI() {
    $('#btnPlay').addEventListener('click', () => this.togglePause());
    $$('.speeds button').forEach((b) => b.addEventListener('click', () => this.setSpeed(+b.dataset.speed)));
    $('#btnReset').addEventListener('click', () => this.reset());
    $('#btnPanel').addEventListener('click', () => this.togglePanel());
    $$('.tabs button').forEach((b) => b.addEventListener('click', () => this.setTab(b.dataset.tab)));
    $$('.toggle').forEach((b) => b.addEventListener('click', () => this.toggleOverlay(b.dataset.overlay)));
    $('#viewSurface').addEventListener('click', () => this.setView('surface'));
    $('#viewNest').addEventListener('click', () => this.setView('nest'));
    $('#nestSelect').addEventListener('change', (e) => {
      const c = this.world.colonies[+e.target.value];
      if (c) { this.nestColony = c; this.fittedNest = null; this.setView('nest'); }
    });
    // species picker
    $('#speciesList').innerHTML = SPECIES_LIST.map((s) => `<button class="species-opt" data-species="${s.id}"><strong>${esc(s.name)}</strong><em>${esc(s.latin)}</em><small>${esc(s.blurb)}</small></button>`).join('');
    $$('.species-opt').forEach((b) => b.addEventListener('click', () => {
      this.placeSpecies = b.dataset.species;
      $$('.species-opt').forEach((x) => x.classList.toggle('on', x === b));
      $('#speciesPicker').hidden = true;
      this.setTool('colony', true);
      this.toast(`Click the ground to found a ${SPECIES[this.placeSpecies].name.toLowerCase()} colony`);
    }));
    // tools: click selects, drag places food
    $$('.tool').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        const tool = b.dataset.tool;
        if (!FOOD_KINDS[tool]) return;
        e.preventDefault();
        this.drag = { kind: tool, x0: e.clientX, y0: e.clientY, moved: false, icon: b.querySelector('svg').outerHTML };
      });
      b.addEventListener('click', () => {
        const tool = b.dataset.tool;
        if (this.dragJustEnded) return;
        if (tool === 'colony') { this.openSpeciesPicker(b); return; }
        this.setTool(tool);
      });
    });
    addEventListener('pointermove', (e) => this.onGlobalMove(e));
    addEventListener('pointerup', (e) => this.onGlobalUp(e));
    // canvas
    const c = this.canvas;
    this.pointers = new Map();
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => { this.pointers.delete(e.pointerId); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const cam = this.view === 'surface' ? this.cam : this.ucam;
      cam.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    }, { passive: false });
    c.addEventListener('dblclick', (e) => {
      if (this.view !== 'surface') return;
      const [wx, wy] = this.cam.toWorld(e.clientX, e.clientY);
      const col = this.world.colonyAt(wx, wy);
      if (col) { this.nestColony = col; this.setView('nest'); }
    });
    // panel actions (delegated)
    $('#panel').addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      this.action(el.dataset.action, el.dataset);
    });
    $('#panel').addEventListener('change', (e) => {
      if (e.target.id === 'graphMetric' || e.target.id === 'graphColony') this.renderGraphs();
      if (e.target.id === 'evMinor') this.renderEvents(true);
    });
    $('#graphMetric').innerHTML = Object.entries(METRICS).map(([k, m]) => `<option value="${k}">${esc(m.label)}</option>`).join('');
    $('#eventList').addEventListener('click', (e) => {
      const li = e.target.closest('li[data-colony]');
      if (li) this.selectColony(this.world.colonies[+li.dataset.colony], true);
    });
    addEventListener('keydown', (e) => this.onKey(e));
    document.body.classList.add('panel-open');
    if (innerWidth <= 860) this.togglePanel(); // start with more of the world visible on phones
  }

  onKey(e) {
    if (e.target.matches('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    const cam = this.view === 'surface' ? this.cam : this.ucam;
    const step = 60;
    if (k === ' ') { e.preventDefault(); this.togglePause(); }
    else if (k === '1') this.setSpeed(1); else if (k === '2') this.setSpeed(2); else if (k === '3') this.setSpeed(5); else if (k === '4') this.setSpeed(10);
    else if (k === 'p') this.toggleOverlay('pheromones');
    else if (k === 't') this.toggleOverlay('territory');
    else if (k === 'd') this.toggleOverlay('debug');
    else if (k === 'i' || k === 'escape') { this.setTool('inspect'); $('#speciesPicker').hidden = true; if (k === 'escape') this.follow = false; }
    else if (k === 'c') this.openSpeciesPicker($('[data-tool="colony"]'));
    else if (k === 'u') this.setView(this.view === 'surface' ? 'nest' : 'surface');
    else if (k === 'f' && this.sel?.type === 'ant') this.follow = !this.follow;
    else if (k === '+' || k === '=') cam.zoomAt(1.25, cam.w / 2, cam.h / 2);
    else if (k === '-') cam.zoomAt(0.8, cam.w / 2, cam.h / 2);
    else if (k === 'arrowleft' || k === 'a') { this.follow = false; cam.tx -= step / cam.zoom; cam.clamp(); }
    else if (k === 'arrowright') { this.follow = false; cam.tx += step / cam.zoom; cam.clamp(); }
    else if (k === 'arrowup' || k === 'w') { this.follow = false; cam.ty -= step / cam.zoom; cam.clamp(); }
    else if (k === 'arrowdown' || k === 's') { this.follow = false; cam.ty += step / cam.zoom; cam.clamp(); }
  }

  onGlobalMove(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 6) {
      d.moved = true;
      const g = $('#ghost'); g.innerHTML = d.icon; g.hidden = false;
    }
    if (d.moved) {
      const g = $('#ghost'); g.style.left = e.clientX + 'px'; g.style.top = e.clientY + 'px';
      const over = document.elementFromPoint(e.clientX, e.clientY) === this.canvas;
      if (over && this.view === 'surface') {
        const [wx, wy] = this.cam.toWorld(e.clientX, e.clientY);
        this.ghost = { x: wx, y: wy, r: 10, ok: !this.world.blocked(wx, wy) };
      } else this.ghost = null;
    }
  }
  onGlobalUp(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null; this.ghost = null;
    $('#ghost').hidden = true;
    if (!d.moved) return;
    this.dragJustEnded = true; setTimeout(() => (this.dragJustEnded = false), 50);
    if (document.elementFromPoint(e.clientX, e.clientY) !== this.canvas) return;
    this.placeFoodAt(d.kind, e.clientX, e.clientY);
  }

  placeFoodAt(kind, sx, sy) {
    if (this.view !== 'surface') { this.toast('Switch to the surface view to place food', 3000, true); return; }
    const [wx, wy] = this.cam.toWorld(sx, sy);
    if (this.world.placeFood(kind, wx, wy)) this.toast(`Placed ${FOOD_KINDS[kind].label.toLowerCase()}`);
    else this.toast('Food can’t go on a stone or off the map', 2500, true);
  }

  onDown(e) {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    this.panMoved = false;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }
  onMove(e) {
    const p = this.pointers.get(e.pointerId);
    const cam = this.view === 'surface' ? this.cam : this.ucam;
    if (!p) { this.hover(e); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch) cam.zoomAt(d / this.pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
      this.pinch = d; this.panMoved = true;
      return;
    }
    if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 5) {
      this.panMoved = true; this.follow = false;
      this.canvas.classList.add('panning');
      cam.panBy(dx, dy);
    }
  }
  onUp(e) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    this.canvas.classList.remove('panning');
    if (this.pointers.size < 2) this.pinch = null;
    if (!p || this.panMoved) return;
    this.click(e.clientX, e.clientY);
  }

  hover(e) {
    if (this.tool !== 'inspect') { this.canvas.className = 'placing'; return; }
    let hit = false;
    if (this.view === 'surface') {
      const [wx, wy] = this.cam.toWorld(e.clientX, e.clientY);
      hit = !!(this.world.antAt(wx, wy, 8 / Math.min(1, this.cam.zoom)) || this.world.colonyAt(wx, wy));
      if (this.overlays.colony) this.ghost = null;
    } else if (this.nestColony) {
      const [wx, wy] = this.ucam.toWorld(e.clientX, e.clientY);
      hit = !!this.under.antAt(this.nestColony, wx, wy);
      this.hoverChamber = this.under.chamberAt(this.nestColony, wx, wy);
      hit = hit || !!this.hoverChamber;
    }
    this.canvas.className = hit ? 'pointing' : '';
  }

  click(sx, sy) {
    const w = this.world;
    if (this.view === 'surface') {
      const [wx, wy] = this.cam.toWorld(sx, sy);
      if (FOOD_KINDS[this.tool]) { this.placeFoodAt(this.tool, sx, sy); return; }
      if (this.tool === 'colony') {
        const res = w.addColony(this.placeSpecies || 'lasius', wx, wy);
        if (typeof res === 'string') { this.toast(res, 3000, true); return; }
        this.toast(`Founded ${res.name}`);
        this.selectColony(res);
        this.setTool('inspect');
        this.refreshNestSelect();
        return;
      }
      const ant = w.antAt(wx, wy, 8 / Math.min(1, this.cam.zoom));
      if (ant) { this.selectAnt(ant); return; }
      const col = w.colonyAt(wx, wy);
      if (col) { this.selectColony(col); return; }
      this.sel = null; this.follow = false; this.updateUI(true);
    } else if (this.nestColony) {
      const [wx, wy] = this.ucam.toWorld(sx, sy);
      const ant = this.under.antAt(this.nestColony, wx, wy);
      if (ant) { this.selectAnt(ant); return; }
      const ch = this.under.chamberAt(this.nestColony, wx, wy);
      this.sel = ch ? { type: 'chamber', colony: this.nestColony, chamber: ch } : null;
      if (!ch) this.selectColony(this.nestColony);
      this.setTab('inspect'); this.updateUI(true);
    }
  }

  selectAnt(a) { this.sel = { type: 'ant', ant: a }; this.follow = false; this.setTab('inspect'); this.updateUI(true); }
  selectColony(c, focus) {
    if (!c) return;
    this.sel = { type: 'colony', colony: c }; this.follow = false;
    if (focus) {
      if (this.view === 'surface') this.cam.focus(c.x, c.y, Math.max(this.cam.tzoom, 1.4));
      else { this.nestColony = c; this.refreshNestSelect(); }
    }
    this.setTab('inspect'); this.updateUI(true);
  }

  action(name, data) {
    const w = this.world;
    if (name === 'follow') { this.follow = !this.follow; this.updateUI(true); }
    else if (name === 'enter') { const c = w.colonies[+data.colony]; if (c) { this.nestColony = c; this.setView('nest'); } }
    else if (name === 'focus') { const c = w.colonies[+data.colony]; this.setView('surface'); this.selectColony(c, true); }
    else if (name === 'colony') this.selectColony(w.colonies[+data.colony], true);
    else if (name === 'ant-colony') this.selectColony(this.sel.ant.colony, true);
    else if (name === 'reseed') {
      const v = ($('#seedInput')?.value || '').trim();
      this.seed = v || String(Math.floor(Math.random() * 1e6));
      this.startSpecies = $('#speciesInput')?.value || this.startSpecies;
      history.replaceState(null, '', `?seed=${encodeURIComponent(this.seed)}&species=${this.startSpecies}`);
      this.reset();
    } else if (name === 'random-seed') {
      this.seed = String(Math.floor(Math.random() * 1e6));
      this.startSpecies = $('#speciesInput')?.value || this.startSpecies;
      history.replaceState(null, '', `?seed=${encodeURIComponent(this.seed)}&species=${this.startSpecies}`);
      this.reset();
    }
  }

  // ---------------------------------------------------------------- controls
  togglePause() {
    this.paused = !this.paused;
    document.body.classList.toggle('paused', this.paused);
    $('#btnPlay').setAttribute('aria-label', this.paused ? 'Resume' : 'Pause');
  }
  setSpeed(s) {
    this.speed = s;
    $$('.speeds button').forEach((b) => b.classList.toggle('on', +b.dataset.speed === s));
    if (this.paused) this.togglePause();
  }
  setTool(t, keep) {
    this.tool = t;
    if (t !== 'colony' && !keep) this.placeSpecies = this.placeSpecies;
    $$('.tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    this.canvas.className = t === 'inspect' ? '' : 'placing';
    if (FOOD_KINDS[t]) this.toast(`Click the ground to place ${FOOD_KINDS[t].label.toLowerCase()}. Press Esc to stop.`);
  }
  openSpeciesPicker(btn) {
    const p = $('#speciesPicker');
    p.hidden = !p.hidden;
    if (!p.hidden && innerWidth > 860) { const r = btn.getBoundingClientRect(); p.style.top = Math.min(innerHeight - 380, r.top) + 'px'; }
  }
  toggleOverlay(k) {
    this.overlays[k] = !this.overlays[k];
    $(`.toggle[data-overlay="${k}"]`).setAttribute('aria-pressed', String(this.overlays[k]));
    $('#hud').hidden = !this.overlays.debug;
  }
  togglePanel() {
    const p = $('#panel');
    p.classList.toggle('collapsed');
    const open = !p.classList.contains('collapsed');
    document.body.classList.toggle('panel-open', open);
    $('#btnPanel').textContent = open ? (innerWidth <= 860 ? 'Hide' : 'Hide panel') : (innerWidth <= 860 ? 'Panel' : 'Show panel');
    $('#btnPanel').setAttribute('aria-expanded', String(open));
    this.updateOffsets();
  }
  setTab(t) {
    this.tab = t;
    $$('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    $$('.tab').forEach((s) => (s.hidden = s.id !== 'tab-' + t));
    const p = $('#panel');
    if (p.classList.contains('collapsed')) this.togglePanel();
    this.updateUI(true);
  }
  setView(v) {
    if (v === 'nest' && !this.nestColony) {
      this.nestColony = this.sel?.colony || this.sel?.ant?.colony || this.world.colonies[0];
      if (!this.nestColony) return;
    }
    const changed = v === 'nest' && (this.view !== 'nest' || this.fittedNest !== this.nestColony);
    this.view = v;
    if (changed) this.fitNest(this.nestColony);
    $('#viewSurface').classList.toggle('on', v === 'surface');
    $('#viewNest').classList.toggle('on', v === 'nest');
    this.refreshNestSelect();
  }
  refreshNestSelect() {
    const s = $('#nestSelect');
    const cols = this.world.colonies;
    const html = cols.map((c) => `<option value="${c.id}">${esc(c.name)}${c.extinct ? ' (extinct)' : ''}</option>`).join('');
    if (s.dataset.sig !== html) { s.innerHTML = html; s.dataset.sig = html; }
    if (this.nestColony) s.value = String(this.nestColony.id);
  }

  toast(msg, ms = 2600, error = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('error', error);
    t.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ---------------------------------------------------------------- UI rendering
  updateUI(force) {
    const w = this.world, env = w.env;
    const hh = Math.floor(env.hour), mm = Math.floor((env.hour % 1) * 60);
    $('#clock').innerHTML = `<b>${SEASONS[env.season]}</b>, day ${env.seasonDay} of year ${env.year} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`.replace(' · ', '&ensp;');
    const sky = env.rain > 0.5 ? 'Heavy rain' : env.rain > 0.08 ? 'Rain' : env.daylight < 0.1 ? 'Night' : env.daylight < 0.9 ? 'Twilight' : 'Clear';
    $('#weather').textContent = `${env.temp.toFixed(1)} °C, ${sky.toLowerCase()}, soil ${pct(env.moisture)} wet`;
    const eff = this.perf.tps / TICKS_PER_SECOND_1X;
    const lag = !this.paused && this.speed > 1 && eff < this.speed * 0.85 && this.perf.tps > 0;
    $('#lag').hidden = !lag;
    if (lag) $('#lag').textContent = `Running at ${eff.toFixed(1)}× (device limit)`;
    if (this.overlays.debug) this.renderHud();
    this.refreshNestSelect();
    if (this.tab === 'inspect') this.renderInspect();
    else if (this.tab === 'colonies') this.renderColonies();
    else if (this.tab === 'graphs') this.renderGraphs(force);
    else if (this.tab === 'events') this.renderEvents(force);
    else if (this.tab === 'world') this.renderWorld(force);
  }

  renderHud() {
    const w = this.world, L = w.ledgerCheck();
    const surface = w.ants.filter((a) => a.loc === 'surface').length;
    $('#hud').textContent = `fps ${this.perf.fps.toFixed(0)}   ticks/s ${this.perf.tps.toFixed(0)}   ${this.perf.msPerTick.toFixed(3)} ms/tick\n` +
      `tick ${w.tick}   ants ${w.ants.length} (${surface} on surface)   food items ${w.foods.length}   prey ${w.prey.length}\n` +
      `ledger: sources ${L.sources.toFixed(1)}  sinks ${L.sinks.toFixed(1)}  stock ${L.stock.toFixed(1)}  error ${L.relError.toExponential(1)}`;
  }

  describeAnt(a) {
    const kind = (k) => (FOOD_KINDS[k]?.label || k).toLowerCase();
    if (a.dead) return `Dead (${a.cause})`;
    if (a.flying) return 'On its nuptial flight';
    if (a.fightTarget) return `Fighting an ant from ${a.fightTarget.colony.name}`;
    if (a.mode === 'flee') return 'Retreating, injured';
    const loaded = a.carry?.type === 'food' ? kind(a.carry.kind) : a.crop > 0.05 ? (a.memory.foodKind ? kind(a.memory.foodKind) : 'liquid food') : null;
    switch (a.task) {
      case 'queen': return a.colony.dormant ? 'Resting through winter' : 'Laying eggs, tended by workers';
      case 'alate': return 'Waiting in the nest for a nuptial flight';
      case 'flight': return 'Leaving for a nuptial flight';
      case 'hibernate': return 'Overwintering in the deepest chamber';
      case 'eat': return 'Feeding from the colony’s stores';
      case 'rest': return 'Resting';
      case 'nurse': return a.carry?.type === 'brood' ? `Moving a ${a.carry.b.stage} to a better chamber` : 'Caring for brood and feeding larvae';
      case 'dig': return 'Excavating a new chamber';
      case 'haul': return a.loc === 'surface' ? 'Dumping excavated soil on the mound' : 'Carrying soil out of the nest';
      case 'clean': return a.carry?.type === 'corpse' ? 'Carrying a dead nestmate to the refuse chamber' : 'Looking for dead nestmates to remove';
      case 'mill': return 'Milling stored seeds into food';
      case 'defend': return a.loc === 'surface' ? 'Patrolling and defending the colony' : 'Heading out to defend the colony';
    }
    if (a.mode === 'unload') return `Storing ${loaded || 'food'} in the nest`;
    if (a.loc === 'nest') return 'Heading out to forage';
    switch (a.mode) {
      case 'search': return a.onTrail ? 'Following a scent trail' : 'Searching for food';
      case 'toMemory': return 'Heading back to a remembered food source';
      case 'approach': return 'Approaching food';
      case 'collect': return a.target?.liquid ? 'Drinking' : 'Cutting or picking up food';
      case 'coop': return 'Helping to carry a large item';
      case 'hunt': return 'Hunting a small insect';
      case 'return': return loaded ? `Carrying ${loaded} home${a.layTrail ? ', laying a trail' : ''}` : 'Returning home empty-handed';
      case 'home': return 'Returning home (tired, thirsty or bad weather)';
    }
    return 'Foraging';
  }

  colonyStatus(c) {
    if (c.extinct) return ['Extinct', 'bad'];
    if (c.dormant) return ['Dormant', 'cold'];
    if (c.counts.queens === 0) return ['Queenless', 'bad'];
    if (c.founding) return ['Founding', 'good'];
    return ['Active', 'good'];
  }

  renderInspect() {
    const el = $('#tab-inspect'), s = this.sel, w = this.world;
    if (!s) {
      el.innerHTML = `<div class="empty"><h2>Nothing selected</h2>
        <p>Click an ant to follow its life, or click a nest mound to see the colony. Double-click a nest to look underground.</p>
        <p>The colony runs by itself. You can drag food onto the ground, found new colonies, and watch what happens over the seasons.</p>
        <p class="note">Tip: turn on Trails to see the scent network the foragers build.</p></div>`;
      return;
    }
    if (s.type === 'ant') {
      const a = s.ant, c = a.colony, sp = a.sp;
      const where = a.loc === 'surface' ? (a.flying ? 'In the air' : 'On the surface') : `Underground, ${(LABELS[c.nest.byId(a.cur)?.type] || 'chamber').toLowerCase()}`;
      const carrying = a.carry?.type === 'food' ? `${(FOOD_KINDS[a.carry.kind]?.label || '').toLowerCase()} (${a.carry.mass.toFixed(1)} units)`
        : a.carry?.type === 'brood' ? `a ${a.carry.b.stage}` : a.carry?.type === 'soil' ? 'a soil pellet' : a.carry?.type === 'corpse' ? 'a dead nestmate' : a.crop > 0.05 ? `${a.crop.toFixed(1)} units in its crop` : 'nothing';
      el.innerHTML = `<h2>${CASTE[a.caste]} #${a.id}</h2>
        <p class="sub"><span class="chip" style="background:${c.color}"></span>${esc(c.name)}, <em>${sp.latin}</em></p>
        <p class="doing">${esc(this.describeAnt(a))}</p>
        ${bar('Energy', a.energy / a.maxEnergy, 'e')}
        ${bar('Water', a.water, 'w')}
        ${bar('Health', a.hp / a.maxHp, 'h')}
        ${bar('Age', a.age / a.lifespan, '', `${a.ageDays.toFixed(1)} of ~${(a.lifespan / TPD).toFixed(0)} days`)}
        <dl class="stats">
          <dt>Where</dt><dd>${where}</dd>
          <dt>Carrying</dt><dd>${carrying}</dd>
          <dt>Body length</dt><dd>${(a.size / 1.5).toFixed(1)} mm</dd>
          <dt>Load capacity</dt><dd>${a.carryCap.toFixed(1)} units</dd>
          ${a.nanitic ? '<dt>Note</dt><dd>Small first-generation worker</dd>' : ''}
          ${a.injured ? '<dt>Condition</dt><dd class="warnc">Injured</dd>' : ''}
          <dt>Remembers food</dt><dd>${a.memory.food ? `${(FOOD_KINDS[a.memory.foodKind]?.label || 'yes')}` : 'no'}</dd>
        </dl>
        ${a.isAdultWorker ? `<h3>Learned task preferences</h3><div class="tasks">${Object.entries(a.th).map(([k, v]) => `<span>${taskName(k)}</span>${bar0(0.5 - v * 1.6)}<span></span>`).join('')}</div><p class="note">Workers grow keener on tasks they perform often (response-threshold learning).</p>` : ''}
        <div class="actions">
          <button class="btn primary" data-action="follow">${this.follow ? 'Stop following' : 'Follow'}</button>
          <button class="btn" data-action="ant-colony">Show colony</button>
        </div>`;
      return;
    }
    if (s.type === 'chamber') {
      const ch = s.chamber, c = s.colony;
      const brood = c.brood.filter((b) => b.chamber === ch.id);
      const ants = c.ants.filter((a) => a.loc === 'nest' && a.cur === ch.id).length;
      el.innerHTML = `<h2>${LABELS[ch.type] || 'Chamber'}</h2>
        <p class="sub"><span class="chip" style="background:${c.color}"></span>${esc(c.name)}</p>
        <dl class="stats">
          <dt>Depth</dt><dd>${(ch.y / 15).toFixed(1)} cm</dd>
          <dt>Temperature</dt><dd>${ch.temp.toFixed(1)} °C</dd>
          <dt>Excavated</dt><dd>${pct(ch.dug)}</dd>
          <dt>Flooded</dt><dd>${ch.flooded ? '<span class="warnc">yes</span>' : 'no'}</dd>
          <dt>Ants here</dt><dd>${ants}</dd>
          <dt>Eggs, larvae, pupae</dt><dd>${brood.filter((b) => b.stage === 'egg').length}, ${brood.filter((b) => b.stage === 'larva').length}, ${brood.filter((b) => b.stage === 'pupa').length}</dd>
          <dt>Dead ants</dt><dd>${c.nest.corpses.filter((k) => k.chamber === ch.id && !k.carried).length}</dd>
        </dl>
        <p class="note">Nurses move brood towards chambers near 28 °C and out of flooded ones. Shallow chambers warm up during the day.</p>
        <div class="actions"><button class="btn" data-action="colony" data-colony="${c.id}">Show colony</button></div>`;
      return;
    }
    const c = s.colony, k = c.counts, sp = c.species;
    const [status, tone] = this.colonyStatus(c);
    const cap = c.storeCapacity();
    const tasks = Object.entries(k.tasks).filter(([t]) => t !== 'queen').sort((a, b) => b[1] - a[1]);
    const totalTasks = tasks.reduce((s2, [, v]) => s2 + v, 0) || 1;
    const causes = Object.entries(c.stats.causes).sort((a, b) => b[1] - a[1]).map(([kk, v]) => `${kk} ${v}`).join(', ') || 'none yet';
    el.innerHTML = `<h2><span class="chip" style="background:${c.color}"></span>${esc(c.name)}</h2>
      <p class="sub">${esc(sp.name)}, <em>${sp.latin}</em>&ensp;<span class="status ${tone}">${status}</span></p>
      <dl class="stats">
        <dt>Age</dt><dd>${c.ageDays(w).toFixed(1)} days</dd>
        <dt>Workers</dt><dd>${k.workers}${k.majors ? ` + ${k.majors} majors` : ''}</dd>
        <dt>Queens</dt><dd>${k.queens}</dd>
        <dt>Winged reproductives</dt><dd>${k.gynes} queens, ${k.males} males</dd>
        <dt>Eggs, larvae, pupae</dt><dd>${k.eggs}, ${k.larvae}, ${k.pupae}</dd>
        <dt>Hungry larvae</dt><dd>${k.hungryLarvae}</dd>
        <dt>On the surface</dt><dd>${k.surface} (${k.foragers} foraging)</dd>
        <dt>Average energy</dt><dd>${pct(k.avgEnergy)}</dd>
        <dt>Territory</dt><dd>${c.territory}% of map</dd>
      </dl>
      <h3>Stores</h3>
      ${bar('Carbohydrate', c.stores.c / cap, '', `${n1(c.stores.c)} units`)}
      ${bar('Protein', c.stores.p / cap, 'p', `${n1(c.stores.p)} units`)}
      ${sp.granary ? bar('Seeds in granary', c.stores.seed / c.granaryCapacity(), 's', `${n1(c.stores.seed)} units`) : ''}
      <p class="note">Storage capacity ${n1(cap)} units (${sp.storage === 'internal' ? 'carried in workers’ crops, so it grows with the workforce' : 'held in store chambers'}).</p>
      <h3>What the workers are doing</h3>
      <div class="tasks">${tasks.map(([t, v]) => `<span>${taskName(t)}</span>${bar0(v / totalTasks)}<span>${v}</span>`).join('') || '<span class="note">No workers</span>'}</div>
      <h3>History</h3>
      <dl class="stats">
        <dt>Food gathered</dt><dd>${n1(c.stats.gathered)} units</dd>
        <dt>Food wasted (no room)</dt><dd>${n1(c.stats.wasted)}</dd>
        <dt>Eggs laid</dt><dd>${c.stats.eggsLaid}</dd>
        <dt>Births / deaths</dt><dd>${c.stats.births} / ${c.stats.deaths}</dd>
        <dt>Brood lost</dt><dd>${c.stats.broodDeaths}</dd>
        <dt>Enemies killed</dt><dd>${c.stats.kills}</dd>
        <dt>Peak workforce</dt><dd>${c.stats.peak}</dd>
        <dt>Chambers</dt><dd>${c.nest.chambers.length - 1}${c.nest.digSite ? ' (one being dug)' : ''}</dd>
      </dl>
      <p class="note">Causes of death: ${esc(causes)}</p>
      <div class="actions">
        <button class="btn primary" data-action="enter" data-colony="${c.id}">Look underground</button>
        <button class="btn" data-action="focus" data-colony="${c.id}">Find on map</button>
      </div>`;
  }

  renderColonies() {
    const w = this.world;
    $('#tab-colonies').innerHTML = `<h2>Colonies</h2><p class="sub">${w.colonies.filter((c) => c.alive).length} living, ${w.colonies.filter((c) => c.extinct).length} extinct</p>` +
      w.colonies.map((c) => {
        const [status, tone] = this.colonyStatus(c);
        const k = c.counts;
        return `<button class="colony-card ${c.extinct ? 'extinct' : ''}" data-action="colony" data-colony="${c.id}">
          <div class="top"><strong><span class="chip" style="background:${c.color}"></span>${esc(c.name)}</strong><span class="status ${tone}">${status}</span></div>
          <div class="meta">${c.extinct ? `Lasted ${c.ageDays(w).toFixed(1)} days, peak ${c.stats.peak} workers` : `${k.workers + k.majors} workers, ${k.eggs + k.larvae + k.pupae} brood, ${n1(c.stores.c + c.stores.p + c.stores.seed)} food, ${c.ageDays(w).toFixed(1)} days old`}</div>
        </button>`;
      }).join('') + '<p class="note">Use the Colony tool to found another colony. Mature colonies also release winged queens in summer, and a few of them found colonies of their own.</p>';
  }

  renderGraphs() {
    const w = this.world;
    const gc = $('#graphColony');
    const opts = '<option value="all">All colonies</option>' + w.colonies.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    if (gc.dataset.sig !== opts) { const v = gc.value; gc.innerHTML = opts; gc.dataset.sig = opts; gc.value = v || 'all'; }
    const metric = $('#graphMetric').value || 'workers';
    const which = gc.value || 'all';
    const cols = which === 'all' ? w.colonies : [w.colonies[+which]].filter(Boolean);
    const series = [];
    if (cols.length === 1 && metric === 'brood') {
      const h = cols[0].history;
      series.push({ name: 'Eggs', color: '#f4f0e2', t: h.t, v: h.eggs }, { name: 'Larvae', color: '#e3a535', t: h.t, v: h.larvae }, { name: 'Pupae', color: '#b8664a', t: h.t, v: h.pupae });
    } else if (cols.length === 1 && metric === 'stores') {
      const h = cols[0].history;
      series.push({ name: 'Carbohydrate', color: '#e3a535', t: h.t, v: h.storesC }, { name: 'Protein', color: '#b8664a', t: h.t, v: h.storesP });
      if (cols[0].species.granary) series.push({ name: 'Seeds', color: '#c9a26a', t: h.t, v: h.seeds });
    } else {
      for (const c of cols) {
        const h = c.history;
        series.push({ name: c.name, color: c.color, t: h.t, v: h.t.map((_, i) => METRICS[metric].get(h, i)), dash: c.extinct ? [4, 3] : [] });
      }
    }
    drawChart($('#chart'), series);
    $('#chartLegend').innerHTML = series.map((s) => `<span><span class="chip" style="background:${s.color}"></span>${esc(s.name)}</span>`).join('');
  }

  renderEvents(force) {
    const w = this.world, showMinor = $('#evMinor').checked;
    const sig = w.events.length + ':' + showMinor + ':' + (w.events[w.events.length - 1]?.tick || 0);
    if (!force && sig === this.lastEventSig) return;
    this.lastEventSig = sig;
    const list = w.events.filter((e) => showMinor || (e.tone !== 'minor')).slice(-200).reverse();
    $('#eventList').innerHTML = list.length ? list.map((e) => `<li class="${e.tone}" ${e.colonyId !== null ? `data-colony="${e.colonyId}"` : ''}><time>Day ${(e.tick / TPD + 1).toFixed(1)}</time>${esc(e.text)}</li>`).join('')
      : '<li>Nothing notable yet. Seasons, milestones, shortages, battles and deaths of queens will appear here.</li>';
  }

  renderWorld(force) {
    const w = this.world, env = w.env, L = w.ledgerCheck();
    const el = $('#tab-world');
    const formFocused = el.contains(document.activeElement) && document.activeElement.matches('input, select');
    const staticPart = el.querySelector('#worldForm');
    const live = `<h2>World</h2>
      <h3>Conditions</h3>
      <dl class="stats">
        <dt>Air temperature</dt><dd>${env.temp.toFixed(1)} °C</dd>
        <dt>Deep soil temperature</dt><dd>${env.deep.toFixed(1)} °C</dd>
        <dt>Rain</dt><dd>${env.rain > 0.02 ? pct(env.rain) : 'none'}</dd>
        <dt>Soil moisture</dt><dd>${pct(env.moisture)}</dd>
        <dt>Daylight</dt><dd>${pct(env.daylight)}</dd>
        <dt>Simulated time</dt><dd>${env.elapsedDays.toFixed(1)} days</dd>
        <dt>Food items on the ground</dt><dd>${w.foods.length}</dd>
        <dt>Living insects</dt><dd>${w.prey.length}</dd>
      </dl>
      <h3>Resource ledger</h3>
      <p class="note">Every unit of food entering the world is tracked until it is eaten, stored, wasted or rots.</p>
      <dl class="stats">
        ${Object.entries(w.ledger.sources).map(([k, v]) => `<dt>In: ${k}</dt><dd>${n1(v)}</dd>`).join('')}
        ${Object.entries(w.ledger.sinks).map(([k, v]) => `<dt>Out: ${k}</dt><dd>${n1(v)}</dd>`).join('')}
        <dt>Currently held</dt><dd>${n1(L.stock)}</dd>
        <dt>Balance error</dt><dd class="${L.relError < 1e-8 ? 'ok' : 'warnc'}">${L.relError.toExponential(1)}</dd>
      </dl>
      <h3>Performance</h3>
      <dl class="stats"><dt>Frame rate</dt><dd>${this.perf.fps.toFixed(0)} fps</dd><dt>Simulation</dt><dd>${this.perf.tps.toFixed(0)} ticks/s, ${this.perf.msPerTick.toFixed(2)} ms each</dd><dt>Living ants</dt><dd>${w.ants.length}</dd></dl>`;
    if (!staticPart || force) {
      el.innerHTML = `<div id="worldLive">${live}</div>
      <div id="worldForm">
        <h3>New experiment</h3>
        <p class="note">The same seed always produces the same world and the same run, so experiments can be repeated.</p>
        <div class="row">
          <label>Seed <input type="text" id="seedInput" value="${esc(this.seed)}" size="12"></label>
          <label>Starting species <select id="speciesInput">${SPECIES_LIST.map((s) => `<option value="${s.id}" ${s.id === this.startSpecies ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        </div>
        <div class="actions"><button class="btn primary" data-action="reseed">Start with this seed</button><button class="btn" data-action="random-seed">Random seed</button></div>
        <h3>Keyboard</h3>
        <div class="kbd"><kbd>Space</kbd><span>Pause or resume</span><kbd>1–4</kbd><span>Speed 1×, 2×, 5×, 10×</span><kbd>Arrows</kbd><span>Pan</span><kbd>+ −</kbd><span>Zoom</span>
        <kbd>U</kbd><span>Surface or underground</span><kbd>F</kbd><span>Follow selected ant</span><kbd>P T D</kbd><span>Trails, territory, debug</span><kbd>C</kbd><span>Found a colony</span><kbd>Esc</kbd><span>Back to inspect</span></div>
        <h3>Time scale</h3>
        <p class="note">At 1× a day lasts two minutes and each season lasts eight days, so a year passes in about an hour (six minutes at 10×). Biology is compressed to the same scale: brood takes about a week to develop and workers live one to three seasons.</p>
      </div>`;
    } else if (!formFocused || true) {
      el.querySelector('#worldLive').innerHTML = live;
    }
  }
}

function taskName(t) {
  return { forage: 'Foraging', nurse: 'Nursing', dig: 'Digging', clean: 'Cleaning', defend: 'Defending', mill: 'Milling seeds', rest: 'Resting',
    eat: 'Feeding', hibernate: 'Overwintering', haul: 'Hauling soil', alate: 'Waiting to fly', flight: 'Flying', queen: 'Queen' }[t] || t;
}
function bar(label, v, cls = '', right) {
  return `<div class="barlabel"><span>${label}</span><span>${right ?? pct(v)}</span></div><div class="bar ${cls}"><i style="width:${pct(v)}"></i></div>`;
}
function bar0(v) { return `<div class="bar"><i style="width:${pct(v)}"></i></div>`; }
