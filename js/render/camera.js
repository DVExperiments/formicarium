// 2D camera with smooth panning and zooming toward a target.
export class Camera {
  constructor(x, y, zoom, minZoom = 0.35, maxZoom = 7) {
    this.x = x; this.y = y; this.zoom = zoom;
    this.tx = x; this.ty = y; this.tzoom = zoom;
    this.minZoom = minZoom; this.maxZoom = maxZoom;
    this.w = 1; this.h = 1;
    this.ox = 0; // screen-space shift of the view centre (e.g. to clear a side panel)
    this.bounds = null;
  }
  resize(w, h) { this.w = w; this.h = h; }
  get cx() { return this.w / 2 - this.ox; }
  get cy() { return this.h / 2 - (this.oyShift || 0); }
  toScreen(wx, wy) { return [(wx - this.x) * this.zoom + this.cx, (wy - this.y) * this.zoom + this.cy]; }
  toWorld(sx, sy) { return [(sx - this.cx) / this.zoom + this.x, (sy - this.cy) / this.zoom + this.y]; }
  panBy(dxScreen, dyScreen) {
    this.tx -= dxScreen / this.zoom; this.ty -= dyScreen / this.zoom;
    this.x = this.tx; this.y = this.ty;
    this.clamp();
  }
  zoomAt(factor, sx, sy) {
    const [wx, wy] = this.toWorld(sx, sy);
    const nz = Math.min(this.maxZoom, Math.max(this.minZoom, this.tzoom * factor));
    this.tzoom = nz;
    // keep the point under the cursor fixed once the zoom settles
    this.tx = wx - (sx - this.cx) / nz;
    this.ty = wy - (sy - this.cy) / nz;
    this.clamp();
  }
  focus(x, y, zoom) { this.tx = x; this.ty = y; if (zoom) this.tzoom = Math.min(this.maxZoom, Math.max(this.minZoom, zoom)); this.clamp(); }
  clamp() {
    if (!this.bounds) return;
    const b = this.bounds;
    this.tx = Math.min(b.x1, Math.max(b.x0, this.tx));
    this.ty = Math.min(b.y1, Math.max(b.y0, this.ty));
  }
  update(dt, reduceMotion) {
    const k = reduceMotion ? 1 : 1 - Math.exp(-dt * 12);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    this.zoom += (this.tzoom - this.zoom) * k;
  }
  // Visible world rectangle with margin.
  view(margin = 20) {
    return { x0: this.x - this.cx / this.zoom - margin, y0: this.y - this.cy / this.zoom - margin,
      x1: this.x + (this.w - this.cx) / this.zoom + margin, y1: this.y + (this.h - this.cy) / this.zoom + margin };
  }
  apply(ctx, dpr) {
    ctx.setTransform(dpr * this.zoom, 0, 0, dpr * this.zoom, dpr * (this.cx - this.x * this.zoom), dpr * (this.cy - this.y * this.zoom));
  }
}
