// Uniform-grid spatial hash for fast neighbour queries. Rebuilt every tick.
export class SpatialHash {
  constructor(w, h, cell) {
    this.cell = cell;
    this.cols = Math.ceil(w / cell);
    this.rows = Math.ceil(h / cell);
    this.heads = new Int32Array(this.cols * this.rows).fill(-1);
    this.next = new Int32Array(1024);
    this.items = [];
  }
  clear() {
    this.heads.fill(-1);
    this.items.length = 0;
  }
  cellOf(x, y) {
    let cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    if (cx < 0) cx = 0; else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0; else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }
  insert(obj) {
    const idx = this.items.length;
    this.items.push(obj);
    if (idx >= this.next.length) {
      const n = new Int32Array(this.next.length * 2);
      n.set(this.next);
      this.next = n;
    }
    const c = this.cellOf(obj.x, obj.y);
    this.next[idx] = this.heads[c];
    this.heads[c] = idx;
  }
  // Fills `out` with items within radius r of (x, y). Returns out.
  near(x, y, r, out) {
    out.length = 0;
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - r) / c)), x1 = Math.min(this.cols - 1, Math.floor((x + r) / c));
    const y0 = Math.max(0, Math.floor((y - r) / c)), y1 = Math.min(this.rows - 1, Math.floor((y + r) / c));
    const r2 = r * r;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        let i = this.heads[cy * this.cols + cx];
        while (i !== -1) {
          const o = this.items[i];
          const dx = o.x - x, dy = o.y - y;
          if (dx * dx + dy * dy <= r2) out.push(o);
          i = this.next[i];
        }
      }
    }
    return out;
  }
}
