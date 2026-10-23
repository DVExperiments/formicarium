// Lightweight line chart for the statistics panel.
export function drawChart(canvas, series, opts = {}) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--ink').trim() || '#e8e6cf';
  const muted = css.getPropertyValue('--muted').trim() || '#9aa37f';
  const pad = { l: 40, r: 10, t: 10, b: 24 };
  let tmin = Infinity, tmax = -Infinity, vmax = 0;
  for (const s of series) for (let i = 0; i < s.t.length; i++) {
    tmin = Math.min(tmin, s.t[i]); tmax = Math.max(tmax, s.t[i]); vmax = Math.max(vmax, s.v[i]);
  }
  ctx.font = '11px "Atkinson Hyperlegible", system-ui, sans-serif';
  if (!isFinite(tmin) || tmax <= tmin) {
    ctx.fillStyle = muted; ctx.textAlign = 'center';
    ctx.fillText('Collecting data — check back in a few simulated hours.', W / 2, H / 2);
    return;
  }
  vmax = niceMax(vmax || 1);
  const x = (t) => pad.l + ((t - tmin) / (tmax - tmin)) * (W - pad.l - pad.r);
  const y = (v) => H - pad.b - (v / vmax) * (H - pad.t - pad.b);
  ctx.strokeStyle = 'rgba(200,200,170,0.12)'; ctx.lineWidth = 1;
  ctx.fillStyle = muted; ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const v = (vmax * i) / 4, yy = Math.round(y(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(W - pad.r, yy); ctx.stroke();
    ctx.fillText(fmt(v), pad.l - 6, yy + 4);
  }
  ctx.textAlign = 'center';
  const span = tmax - tmin, step = niceStep(span / 5);
  for (let t = Math.ceil(tmin / step) * step; t <= tmax; t += step) ctx.fillText(`Day ${Math.round(t)}`, x(t), H - 6);
  for (const s of series) {
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.8; ctx.setLineDash(s.dash || []);
    ctx.beginPath();
    for (let i = 0; i < s.t.length; i++) i ? ctx.lineTo(x(s.t[i]), y(s.v[i])) : ctx.moveTo(x(s.t[i]), y(s.v[i]));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  void ink;
}
function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p; return 10 * p; }
function niceStep(v) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 0.1)))); for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p; return 10 * p; }
function fmt(v) { return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v % 1 ? v.toFixed(1) : String(v); }
