// More Photoshop tools: Quick Selection, Single Row / Column Marquee, Spot Healing Brush, History Brush,
// Sponge, Rotate View and Ruler.
import type { Tool, ToolPointerEvent } from './types';
import type { Engine } from '../canvas/engine';
import { useTools } from '../state/toolStore';
import { commit, getDoc } from '../state/documentStore';
import { combineSelection, floodMask, maskFromBytes, maskFromDraw } from '../canvas/selection';
import { createCanvas, ctx2d } from '../utils/canvas';
import { activeLayer, drawBrushCursor, getPaintTarget, sampleSource, type PaintTarget } from './helpers';
import { RetouchStroke, Stroke } from './brushEngine';
import { create } from '../state/createStore';
import { toast } from '../state/uiStore';
import type { Point } from '../utils/math';
import type { Selection } from '../types/document';

const modeFor = (e: { shift: boolean; alt: boolean }) => (e.shift && e.alt ? 'intersect' : e.shift ? 'add' : e.alt ? 'subtract' : useTools.getState().options.wand.mode);

// ---------------- Quick Selection ----------------
/** Paint over an area: it grows the selection to the similar pixels around the brush. */
let qs: { data: Uint8ClampedArray; w: number; h: number; acc: Uint8Array; before: Selection | null; last: Point | null; mode: string } | null = null;
function qsDab(p: Point) {
  if (!qs) return;
  const size = useTools.getState().options.quick.size;
  const r = Math.max(2, size / 2), reach = r * 4;
  const cx = Math.round(p.x), cy = Math.round(p.y);
  if (cx < 0 || cy < 0 || cx >= qs.w || cy >= qs.h) return;
  // the colours under the brush set the tolerance: busy areas take more
  let sr = 0, sg = 0, sb = 0, n = 0, varr = 0;
  for (let y = Math.max(0, cy - r); y < Math.min(qs.h, cy + r); y++) for (let x = Math.max(0, cx - r); x < Math.min(qs.w, cx + r); x++) {
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue; const k = (y * qs.w + x) * 4; sr += qs.data[k]; sg += qs.data[k + 1]; sb += qs.data[k + 2]; n++;
  }
  if (!n) return;
  sr /= n; sg /= n; sb /= n;
  for (let y = Math.max(0, cy - r); y < Math.min(qs.h, cy + r); y++) for (let x = Math.max(0, cx - r); x < Math.min(qs.w, cx + r); x++) {
    const k = (y * qs.w + x) * 4; varr += Math.max(Math.abs(qs.data[k] - sr), Math.abs(qs.data[k + 1] - sg), Math.abs(qs.data[k + 2] - sb));
  }
  const tol = Math.max(12, Math.min(70, (varr / n) * 1.6 + 14));
  // flood inside a window around the brush (keeps the growth local, like Photoshop)
  const x0 = Math.max(0, Math.floor(cx - reach)), y0 = Math.max(0, Math.floor(cy - reach)), x1 = Math.min(qs.w, Math.ceil(cx + reach)), y1 = Math.min(qs.h, Math.ceil(cy + reach));
  const ww = x1 - x0, hh = y1 - y0;
  const sub = new Uint8ClampedArray(ww * hh * 4);
  for (let y = 0; y < hh; y++) sub.set(qs.data.subarray(((y + y0) * qs.w + x0) * 4, ((y + y0) * qs.w + x1) * 4), y * ww * 4);
  // seed with the average colour so one odd pixel does not decide
  const sk = ((cy - y0) * ww + (cx - x0)) * 4; sub[sk] = sr; sub[sk + 1] = sg; sub[sk + 2] = sb;
  const m = floodMask(sub, ww, hh, cx - x0, cy - y0, tol, true);
  for (let y = 0; y < hh; y++) for (let x = 0; x < ww; x++) if (m[y * ww + x]) qs.acc[(y + y0) * qs.w + x + x0] = 255;
  // the brush footprint itself is always included
  for (let y = Math.max(0, cy - r); y < Math.min(qs.h, cy + r); y++) for (let x = Math.max(0, cx - r); x < Math.min(qs.w, cx + r); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r * 0.5) qs.acc[y * qs.w + x] = 255;
}
function qsShow(final: boolean) {
  if (!qs) return;
  const mask = maskFromBytes(qs.acc, qs.w, qs.h, true);
  const sel = combineSelection(qs.before, mask, qs.mode as 'new');
  const before = qs.before;
  if (final) { commit((s) => ({ ...s, selection: before }), {}); commit((s) => ({ ...s, selection: sel }), { history: 'Quick Selection' }); }
  else commit((s) => ({ ...s, selection: sel }), {});
}
export const quickSelectTool: Tool = {
  id: 'quick-select', hoverOverlay: true,
  cursor: (engine) => (engine.hoverScreen ? 'none' : 'crosshair'),
  onDown(e, engine) {
    const st = engine.state; if (!st) return;
    const src = sampleSource(st, useTools.getState().options.wand.sampleAll, engine);
    let data: Uint8ClampedArray;
    try { data = ctx2d(src, true).getImageData(0, 0, st.width, st.height).data; } catch { toast('Unable to read pixels for this selection.', 'error'); return; }
    // without Shift/Alt the first stroke starts a new selection, later strokes add (like Photoshop)
    const mode = e.shift || e.alt ? modeFor(e) : st.selection ? 'add' : 'new';
    qs = { data, w: st.width, h: st.height, acc: new Uint8Array(st.width * st.height), before: st.selection, last: e.doc, mode };
    qsDab(e.doc); qsShow(false);
  },
  onMove(e, _engine, dragging) {
    if (!dragging || !qs) return;
    const size = useTools.getState().options.quick.size, step = Math.max(2, size / 3);
    const a = qs.last ?? e.doc; const d = Math.hypot(e.doc.x - a.x, e.doc.y - a.y);
    if (d < step) return;
    const n = Math.ceil(d / step);
    for (let i = 1; i <= n; i++) qsDab({ x: a.x + ((e.doc.x - a.x) * i) / n, y: a.y + ((e.doc.y - a.y) * i) / n });
    qs.last = e.doc; qsShow(false);
  },
  onUp() { qsShow(true); qs = null; },
  drawOverlay(ctx, engine) { drawBrushCursor(ctx, engine, useTools.getState().options.quick.size, (r, p) => { ctx.beginPath(); ctx.moveTo(p.x - r * 0.4, p.y); ctx.lineTo(p.x + r * 0.4, p.y); ctx.moveTo(p.x, p.y - r * 0.4); ctx.lineTo(p.x, p.y + r * 0.4); ctx.stroke(); }); },
};

// ---------------- Single Row / Column Marquee ----------------
function lineMarquee(id: 'marquee-row' | 'marquee-col'): Tool {
  return {
    id, cursor: () => 'crosshair',
    onDown(e, engine) {
      const st = engine.state; if (!st) return;
      const x = Math.floor(e.doc.x), y = Math.floor(e.doc.y);
      const mask = maskFromDraw(st.width, st.height, (c) => { c.fillStyle = '#fff'; if (id === 'marquee-row') c.fillRect(0, y, st.width, 1); else c.fillRect(x, 0, 1, st.height); });
      const sel = combineSelection(st.selection, mask, modeFor(e) as 'new');
      commit((s) => ({ ...s, selection: sel }), { history: id === 'marquee-row' ? 'Single Row Marquee' : 'Single Column Marquee' });
    },
  };
}
export const marqueeRowTool = lineMarquee('marquee-row');
export const marqueeColTool = lineMarquee('marquee-col');

// ---------------- Spot Healing Brush ----------------
/** Fills the painted area from its surroundings (smooth fill from the edges) and adds the texture of a nearby patch. */
export function healRegion(img: ImageData, mask: Uint8Array) {
  const { width: w, height: h, data: d } = img;
  const N = w * h;
  // 1. smooth fill: solve Laplace inside the mask, coarse to fine
  const fill = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) fill[i * 3 + c] = d[i * 4 + c];
  const solve = (F: Float32Array, M: Uint8Array, W: number, H: number, iters: number) => {
    for (let it = 0; it < iters; it++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!M[i]) continue;
      let n = 0; const acc = [0, 0, 0];
      if (x > 0) { const j = i - 1; for (let c = 0; c < 3; c++) acc[c] += F[j * 3 + c]; n++; }
      if (x < W - 1) { const j = i + 1; for (let c = 0; c < 3; c++) acc[c] += F[j * 3 + c]; n++; }
      if (y > 0) { const j = i - W; for (let c = 0; c < 3; c++) acc[c] += F[j * 3 + c]; n++; }
      if (y < H - 1) { const j = i + W; for (let c = 0; c < 3; c++) acc[c] += F[j * 3 + c]; n++; }
      if (n) for (let c = 0; c < 3; c++) F[i * 3 + c] = acc[c] / n;
    }
  };
  const levels: { F: Float32Array; M: Uint8Array; W: number; H: number }[] = [{ F: fill, M: mask, W: w, H: h }];
  while (levels[levels.length - 1].W > 24 && levels[levels.length - 1].H > 24 && levels.length < 7) {
    const p = levels[levels.length - 1]; const W = Math.ceil(p.W / 2), H = Math.ceil(p.H / 2);
    const F = new Float32Array(W * H * 3), M = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let n = 0; const acc = [0, 0, 0]; let any = 0;
      for (let v = 0; v < 2; v++) for (let u = 0; u < 2; u++) {
        const X = x * 2 + u, Y = y * 2 + v; if (X >= p.W || Y >= p.H) continue; const j = Y * p.W + X;
        if (p.M[j]) { any = 1; continue; }
        for (let c = 0; c < 3; c++) acc[c] += p.F[j * 3 + c]; n++;
      }
      const i = y * W + x; M[i] = n ? 0 : any;
      if (n) for (let c = 0; c < 3; c++) F[i * 3 + c] = acc[c] / n;
    }
    levels.push({ F, M, W, H });
  }
  for (let li = levels.length - 1; li >= 0; li--) {
    const L = levels[li];
    if (li < levels.length - 1) {
      const C = levels[li + 1];
      for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) { const i = y * L.W + x; if (!L.M[i]) continue; const j = Math.min(C.H - 1, y >> 1) * C.W + Math.min(C.W - 1, x >> 1); for (let c = 0; c < 3; c++) L.F[i * 3 + c] = C.F[j * 3 + c]; }
    }
    solve(L.F, L.M, L.W, L.H, li === levels.length - 1 ? 200 : 30);
  }
  // 2. texture: the detail (pixel minus its blur) of the best matching patch next to the area
  let bx0 = w, by0 = h, bx1 = 0, by1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
  const ext = Math.max(bx1 - bx0, by1 - by0) + 4;
  const lum = (i: number) => 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  const blurAt = (x: number, y: number) => { let s = 0, n = 0; for (let v = -2; v <= 2; v++) for (let u = -2; u <= 2; u++) { const X = x + u, Y = y + v; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; s += lum(Y * w + X); n++; } return s / n; };
  let best: [number, number] | null = null, bestScore = Infinity;
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2; const dx = Math.round(Math.cos(ang) * ext * 1.2), dy = Math.round(Math.sin(ang) * ext * 1.2);
    let score = 0, ok = true, cnt = 0;
    for (let y = by0; y <= by1 && ok; y += 2) for (let x = bx0; x <= bx1; x += 2) {
      const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h || mask[Y * w + X]) { ok = false; break; }
      const i = y * w + x, j = Y * w + X;
      const target = [fill[i * 3], fill[i * 3 + 1], fill[i * 3 + 2]];
      score += Math.abs(d[j * 4] - target[0]) + Math.abs(d[j * 4 + 1] - target[1]) + Math.abs(d[j * 4 + 2] - target[2]); cnt++;
    }
    if (ok && cnt && score / cnt < bestScore) { bestScore = score / cnt; best = [dx, dy]; }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; const m = mask[i]; if (!m) continue;
    let detail = 0;
    if (best) { const X = x + best[0], Y = y + best[1]; if (X >= 0 && Y >= 0 && X < w && Y < h) detail = lum(Y * w + X) - blurAt(X, Y); }
    const k = m / 255;
    for (let c = 0; c < 3; c++) d[i * 4 + c] = Math.round(d[i * 4 + c] * (1 - k) + Math.max(0, Math.min(255, fill[i * 3 + c] + detail)) * k);
  }
}
let heal: { target: PaintTarget; mask: Uint8Array; last: Point | null } | null = null;
function healDab(p: Point) {
  if (!heal) return;
  const t = heal.target; const size = useTools.getState().options.heal.size; const r = size / 2;
  const lx = p.x - t.ox, ly = p.y - t.oy; const W = t.canvas.width, H = t.canvas.height;
  const pv = ctx2d(t.canvas, true);
  pv.save(); pv.globalCompositeOperation = 'source-over'; pv.fillStyle = 'rgba(20,20,30,0.45)';
  for (let y = Math.max(0, Math.floor(ly - r)); y < Math.min(H, Math.ceil(ly + r)); y++) for (let x = Math.max(0, Math.floor(lx - r)); x < Math.min(W, Math.ceil(lx + r)); x++) {
    const dd = Math.hypot(x + 0.5 - lx, y + 0.5 - ly) / r; if (dd > 1) continue;
    const v = dd < 0.8 ? 255 : Math.round(255 * (1 - (dd - 0.8) / 0.2));
    if (v > heal.mask[y * W + x]) heal.mask[y * W + x] = v;
  }
  pv.beginPath(); pv.arc(lx, ly, r, 0, Math.PI * 2); pv.fill(); pv.restore();
}
export const spotHealTool: Tool = {
  id: 'spot-heal', hoverOverlay: true,
  cursor: (engine) => (engine.hoverScreen ? 'none' : 'crosshair'),
  onDown(e, engine) {
    const st = engine.state; if (!st) return;
    const target = getPaintTarget(st); if (!target) return;
    heal = { target, mask: new Uint8Array(target.canvas.width * target.canvas.height), last: e.doc };
    healDab(e.doc); engine.setOverride(target.preview());
  },
  onMove(e, engine, dragging) {
    if (!dragging || !heal) return;
    const step = Math.max(1, useTools.getState().options.heal.size / 5); const a = heal.last ?? e.doc; const d = Math.hypot(e.doc.x - a.x, e.doc.y - a.y);
    if (d < step) return; const n = Math.ceil(d / step);
    for (let i = 1; i <= n; i++) healDab({ x: a.x + ((e.doc.x - a.x) * i) / n, y: a.y + ((e.doc.y - a.y) * i) / n });
    heal.last = e.doc; engine.setOverride(heal.target.preview());
  },
  onUp(_e, engine) {
    if (!heal) return;
    const { target, mask } = heal; heal = null;
    const W = target.canvas.width, H = target.canvas.height;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (x1 < 0) { engine.clearOverride(); return; }
    const pad = Math.max(16, Math.round(Math.max(x1 - x0, y1 - y0) * 1.6));
    const bx = Math.max(0, x0 - pad), by = Math.max(0, y0 - pad), bw = Math.min(W, x1 + pad + 1) - bx, bh = Math.min(H, y1 + pad + 1) - by;
    const out = ctx2d(target.canvas, true);
    out.clearRect(0, 0, W, H); out.drawImage(target.base, 0, 0);
    const img = out.getImageData(bx, by, bw, bh);
    const sub = new Uint8Array(bw * bh); for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) sub[y * bw + x] = mask[(y + by) * W + x + bx];
    // respect the active selection
    const sel = engine.state?.selection;
    if (sel) { const sd = ctx2d(sel.mask, true).getImageData(0, 0, sel.mask.width, sel.mask.height).data; for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const gx = x + bx + target.ox, gy = y + by + target.oy; const sv = gx >= 0 && gy >= 0 && gx < sel.mask.width && gy < sel.mask.height ? sd[(gy * sel.mask.width + gx) * 4 + 3] : 0; sub[y * bw + x] = Math.round((sub[y * bw + x] * sv) / 255); } }
    healRegion(img, sub);
    out.putImageData(img, bx, by);
    target.commit('Spot Healing Brush');
    engine.clearOverride();
  },
  drawOverlay(ctx, engine) { drawBrushCursor(ctx, engine, useTools.getState().options.heal.size); },
};

// ---------------- History Brush ----------------
/** Which history state the History Brush paints from (per document; default the first, like Photoshop's snapshot). */
export const useHistorySource = create<{ byDoc: Record<string, string> }>(() => ({ byDoc: {} }));
export function historySourceIndex(docId: string): number {
  const d = getDoc(docId); if (!d) return 0;
  const id = useHistorySource.getState().byDoc[docId];
  const i = id ? d.history.findIndex((h) => h.id === id) : -1;
  return i >= 0 ? i : 0;
}
function historyBrushTool(): Tool {
  let stroke: Stroke | null = null; let target: PaintTarget | null = null;
  return {
    id: 'history-brush', hoverOverlay: true,
    cursor: (engine) => (engine.hoverScreen ? 'none' : 'crosshair'),
    onDown(e, engine) {
      const st = engine.state; const doc = engine.doc; if (!st || !doc) return;
      const layer = activeLayer(st); if (!layer) return;
      const srcState = doc.history[historySourceIndex(doc.id)]?.state;
      const old = srcState?.layers.find((l) => l.id === layer.id);
      if (!old || old.type !== 'raster') { toast('This layer did not exist (or was not a pixel layer) in the history state the History Brush paints from.', 'warning'); return; }
      target = getPaintTarget(st); if (!target) return;
      const src = createCanvas(st.width, st.height); const x = ctx2d(src);
      const m = old.transform; x.setTransform(m.a, m.b, m.c, m.d, m.e, m.f); x.drawImage(old.canvas, 0, 0);
      const o = useTools.getState().options.historyBrush;
      stroke = new Stroke(target, st, { size: o.size, hardness: o.hardness, opacity: o.opacity, flow: 1, smoothing: 0.2, spacing: 0.1, color: '#000000', mode: 'clone', cloneSource: src, cloneOffset: { x: 0, y: 0 } });
      stroke.add(e.doc, e.pressure); stroke.render(); engine.setOverride(target.preview());
    },
    onMove(e, engine, dragging) { if (!dragging || !stroke || !target) return; stroke.add(e.doc, e.pressure); engine.setOverride(target.preview(), true, stroke.render()); },
    onUp(e, engine) { if (!stroke || !target) return; stroke.finish(e.doc, e.pressure); stroke.render(true); target.commit('History Brush'); stroke = null; target = null; engine.clearOverride(); },
    drawOverlay(ctx, engine) { drawBrushCursor(ctx, engine, useTools.getState().options.historyBrush.size); },
  };
}
export const historyBrush = historyBrushTool();

// ---------------- Sponge ----------------
export const spongeTool: Tool = (() => {
  let stroke: RetouchStroke | null = null; let target: PaintTarget | null = null;
  return {
    id: 'sponge', hoverOverlay: true,
    cursor: (engine: Engine) => (engine.hoverScreen ? 'none' : 'crosshair'),
    onDown(e: ToolPointerEvent, engine: Engine) {
      const st = engine.state; if (!st) return; target = getPaintTarget(st); if (!target) return;
      const o = useTools.getState().options.sponge;
      stroke = new RetouchStroke(target, st, o.mode === 'saturate' ? 'saturate' : 'desaturate', o.size, o.hardness, o.flow);
      stroke.add(e.doc); engine.setOverride(target.preview());
    },
    onMove(e: ToolPointerEvent, engine: Engine, dragging: boolean) { if (!dragging || !stroke || !target) return; stroke.add(e.doc); engine.setOverride(target.preview(), true, stroke.takeDirty()); },
    onUp(_e: ToolPointerEvent, engine: Engine) { if (!stroke || !target) return; target.commit('Sponge'); stroke = null; target = null; engine.clearOverride(); },
    drawOverlay(ctx: CanvasRenderingContext2D, engine: Engine) { drawBrushCursor(ctx, engine, useTools.getState().options.sponge.size); },
  } as Tool;
})();

// ---------------- Rotate View ----------------
let rv: { a0: number; r0: number } | null = null;
const viewAngle = (engine: Engine, e: ToolPointerEvent) => Math.atan2(e.screen.y - engine.height / 2, e.screen.x - engine.width / 2) * (180 / Math.PI);
export const rotateViewTool: Tool = {
  id: 'rotate-view', cursor: () => 'grab',
  onDown(e, engine) { rv = { a0: viewAngle(engine, e), r0: engine.viewState.rotation || 0 }; },
  onMove(e, engine, dragging) {
    if (!dragging || !rv) return;
    let r = rv.r0 + viewAngle(engine, e) - rv.a0;
    if (e.shift) r = Math.round(r / 15) * 15;
    engine.setView({ rotation: ((r % 360) + 360) % 360 });
  },
  onUp() { rv = null; },
  onDoubleClick(_e, engine) { engine.setView({ rotation: 0 }); },
};

// ---------------- Ruler ----------------
export const useRuler = create<{ a: Point | null; b: Point | null }>(() => ({ a: null, b: null }));
export const rulerTool: Tool = {
  id: 'ruler', cursor: () => 'crosshair',
  onDown(e) { useRuler.setState({ a: e.doc, b: e.doc }); },
  onMove(e, _engine, dragging) {
    if (!dragging) return; const a = useRuler.getState().a; if (!a) return;
    let b = e.doc;
    if (e.shift) { const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4); const l = Math.hypot(b.x - a.x, b.y - a.y); b = { x: a.x + Math.cos(ang) * l, y: a.y + Math.sin(ang) * l }; }
    useRuler.setState({ b });
  },
  drawOverlay(ctx, engine) {
    const { a, b } = useRuler.getState(); if (!a || !b) return;
    const p = engine.docToScreen(a), q = engine.docToScreen(b);
    ctx.save(); ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
    for (const s of [p, q]) { ctx.beginPath(); ctx.moveTo(s.x - 5, s.y); ctx.lineTo(s.x + 5, s.y); ctx.moveTo(s.x, s.y - 5); ctx.lineTo(s.x, s.y + 5); ctx.stroke(); }
    ctx.restore();
  },
  hasSession: () => !!useRuler.getState().a,
  cancel() { useRuler.setState({ a: null, b: null }); },
};
export function rulerInfo() {
  const { a, b } = useRuler.getState(); if (!a || !b) return null;
  const w = b.x - a.x, h = b.y - a.y;
  return { x: a.x, y: a.y, w, h, angle: (-Math.atan2(h, w) * 180) / Math.PI, length: Math.hypot(w, h) };
}
