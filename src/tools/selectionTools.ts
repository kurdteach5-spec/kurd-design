import type { Tool, ToolPointerEvent } from './types';
import type { Engine } from '../canvas/engine';
import type { SelectionMode, ToolId } from '../state/toolStore';
import { useTools } from '../state/toolStore';
import { commit } from '../state/documentStore';
import { combineSelection, floodMask, makeSelection, maskFromBytes, maskFromDraw } from '../canvas/selection';
import { createCanvas, ctx2d } from '../utils/canvas';
import { sampleSource } from './helpers';
import type { Point } from '../utils/math';
import { toast } from '../state/uiStore';

function modeFor(e: { shift: boolean; alt: boolean }, base: SelectionMode): SelectionMode {
  if (e.shift && e.alt) return 'intersect';
  if (e.shift) return 'add';
  if (e.alt) return 'subtract';
  return base;
}
const MODE_LABEL: Record<SelectionMode, string> = { new: 'Select', add: 'Add to Selection', subtract: 'Subtract from Selection', intersect: 'Intersect Selection' };

function inSelection(engine: Engine, p: Point) {
  const sel = engine.state?.selection; if (!sel) return false;
  const x = Math.floor(p.x), y = Math.floor(p.y);
  if (x < 0 || y < 0 || x >= sel.mask.width || y >= sel.mask.height) return false;
  return ctx2d(sel.mask, true).getImageData(x, y, 1, 1).data[3] > 127;
}

const modeCursor = (e: ToolPointerEvent | null | undefined, base: SelectionMode) => {
  const m = e ? modeFor(e, base) : base;
  return m === 'add' ? 'copy' : m === 'subtract' ? 'crosshair' : 'crosshair';
};

/** Moving an existing selection outline by dragging inside it. */
let movingSel: { start: Point; mask: HTMLCanvasElement; dx: number; dy: number } | null = null;
function startMoveSel(engine: Engine, e: ToolPointerEvent, mode: SelectionMode) {
  if (mode !== 'new' || e.shift || e.alt || !engine.state?.selection || !inSelection(engine, e.doc)) return false;
  movingSel = { start: e.doc, mask: engine.state.selection.mask, dx: 0, dy: 0 };
  return true;
}
function moveSel(e: ToolPointerEvent) { if (!movingSel) return false; movingSel.dx = Math.round(e.doc.x - movingSel.start.x); movingSel.dy = Math.round(e.doc.y - movingSel.start.y); return true; }
function endMoveSel(engine: Engine) {
  if (!movingSel) return false;
  const m = movingSel; movingSel = null;
  if (m.dx || m.dy) {
    const st = engine.state!; const c = createCanvas(st.width, st.height); ctx2d(c).drawImage(m.mask, m.dx, m.dy);
    commit((s) => ({ ...s, selection: makeSelection(c) }), { history: 'Move Selection' });
  }
  return true;
}
function drawMovingSel(ctx: CanvasRenderingContext2D, engine: Engine) {
  if (!movingSel || !engine.state?.selection) return;
  const b = engine.state.selection.bounds;
  const a = engine.docToScreen({ x: b.x + movingSel.dx, y: b.y + movingSel.dy });
  const c = engine.docToScreen({ x: b.x + b.w + movingSel.dx, y: b.y + b.h + movingSel.dy });
  ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = '#fff'; ctx.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y); ctx.restore();
}

// ---------------- Marquee ----------------
function marquee(id: ToolId, shape: 'rect' | 'ellipse'): Tool {
  let start: Point | null = null, end: Point | null = null, mode: SelectionMode = 'new';
  let alt = false, shift = false;
  const rectFor = () => {
    if (!start || !end) return null;
    const o = useTools.getState().options.marquee;
    let w = end.x - start.x, h = end.y - start.y;
    if (o.style === 'ratio') { const r = o.ratioH / Math.max(0.001, o.ratioW); h = Math.sign(h || 1) * Math.abs(w) * r; }
    else if (o.style === 'fixed') { w = Math.sign(w || 1) * o.ratioW; h = Math.sign(h || 1) * o.ratioH; }
    else if (shift && mode === 'new') { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; }
    let x = start.x, y = start.y;
    if (alt && mode === 'new') { x -= w; y -= h; w *= 2; h *= 2; }
    const rx = Math.round(Math.min(x, x + w)), ry = Math.round(Math.min(y, y + h));
    return { x: rx, y: ry, w: Math.round(Math.max(x, x + w)) - rx, h: Math.round(Math.max(y, y + h)) - ry };
  };
  return {
    id,
    cursor: (_e, ev) => modeCursor(ev, useTools.getState().options.marquee.mode),
    onDown(e, engine) {
      mode = modeFor(e, useTools.getState().options.marquee.mode);
      if (startMoveSel(engine, e, mode)) return;
      start = e.doc; end = e.doc; alt = false; shift = false;
    },
    onMove(e, _engine, dragging) {
      if (!dragging) return;
      if (moveSel(e)) return;
      if (!start) return;
      end = e.doc; shift = e.shift; alt = e.alt;
    },
    onUp(_e, engine) {
      if (endMoveSel(engine)) return;
      const st = engine.state; const r = rectFor(); start = end = null;
      if (!st || !r) return;
      if (r.w < 1 || r.h < 1) {
        if (mode === 'new' && st.selection) commit((s) => ({ ...s, selection: null }), { history: 'Deselect' });
        return;
      }
      const o = useTools.getState().options.marquee;
      const mask = maskFromDraw(st.width, st.height, (x) => {
        x.beginPath();
        if (shape === 'rect') x.rect(r.x, r.y, r.w, r.h); else x.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
        x.fill();
      }, o.feather);
      const sel = combineSelection(st.selection, mask, mode);
      commit((s) => ({ ...s, selection: sel }), { history: shape === 'rect' ? `Rectangular ${MODE_LABEL[mode]}` : `Elliptical ${MODE_LABEL[mode]}` });
    },
    drawOverlay(ctx, engine) {
      drawMovingSel(ctx, engine);
      const r = rectFor(); if (!r) return;
      const vm = engine.viewMatrix();
      ctx.save(); ctx.transform(vm.a, vm.b, vm.c, vm.d, vm.e, vm.f);
      ctx.lineWidth = 1 / engine.zoom; ctx.setLineDash([4 / engine.zoom, 4 / engine.zoom]);
      ctx.beginPath();
      if (shape === 'rect') ctx.rect(r.x, r.y, r.w, r.h); else ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      ctx.strokeStyle = '#000'; ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineDashOffset = 4 / engine.zoom; ctx.stroke();
      ctx.restore();
      // size readout
      const p = engine.docToScreen({ x: r.x + r.w, y: r.y + r.h });
      ctx.save(); ctx.font = '11px Inter, sans-serif'; const label = `W ${r.w}  H ${r.h}`;
      const w = ctx.measureText(label).width + 10; ctx.fillStyle = 'rgba(20,22,26,0.9)'; ctx.fillRect(p.x + 10, p.y + 10, w, 20);
      ctx.fillStyle = '#e8eaed'; ctx.fillText(label, p.x + 15, p.y + 24); ctx.restore();
    },
  };
}

export const marqueeRectTool = marquee('marquee-rect', 'rect');
export const marqueeEllipseTool = marquee('marquee-ellipse', 'ellipse');

// ---------------- Lasso ----------------
function finishPolygon(engine: Engine, pts: Point[], mode: SelectionMode, label: string) {
  const st = engine.state; if (!st || pts.length < 3) return;
  const o = useTools.getState().options.lasso;
  const mask = maskFromDraw(st.width, st.height, (x) => { x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath(); x.fill(); }, o.feather);
  const sel = combineSelection(st.selection, mask, mode);
  commit((s) => ({ ...s, selection: sel }), { history: `${label} ${MODE_LABEL[mode]}` });
}
function drawPolyline(ctx: CanvasRenderingContext2D, engine: Engine, pts: Point[], extra?: Point | null, closed = false) {
  if (!pts.length) return;
  ctx.save(); ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
  ctx.beginPath();
  pts.forEach((p, i) => { const s = engine.docToScreen(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
  if (extra) { const s = engine.docToScreen(extra); ctx.lineTo(s.x, s.y); }
  if (closed) ctx.closePath();
  ctx.strokeStyle = '#000'; ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineDashOffset = 4; ctx.stroke();
  ctx.restore();
}

let lassoPts: Point[] = []; let lassoMode: SelectionMode = 'new';
export const lassoTool: Tool = {
  id: 'lasso',
  cursor: (_e, ev) => modeCursor(ev, useTools.getState().options.lasso.mode),
  onDown(e, engine) { lassoMode = modeFor(e, useTools.getState().options.lasso.mode); if (startMoveSel(engine, e, lassoMode)) return; lassoPts = [e.doc]; },
  onMove(e, _en, dragging) {
    if (!dragging) return;
    if (moveSel(e)) return;
    const last = lassoPts[lassoPts.length - 1];
    if (last && Math.hypot(e.doc.x - last.x, e.doc.y - last.y) > 0.75) lassoPts.push(e.doc);
  },
  onUp(_e, engine) {
    if (endMoveSel(engine)) return;
    const pts = lassoPts; lassoPts = [];
    if (pts.length < 3) { if (lassoMode === 'new' && engine.state?.selection) commit((s) => ({ ...s, selection: null }), { history: 'Deselect' }); return; }
    finishPolygon(engine, pts, lassoMode, 'Lasso');
  },
  drawOverlay(ctx, engine) { drawMovingSel(ctx, engine); drawPolyline(ctx, engine, lassoPts, null, false); },
};

// ---------------- Polygonal lasso ----------------
let polyPts: Point[] = []; let polyMode: SelectionMode = 'new';
const closePoly = (engine: Engine) => { const pts = polyPts; polyPts = []; finishPolygon(engine, pts, polyMode, 'Polygonal Lasso'); engine.invalidateView(); };
export const polygonLassoTool: Tool = {
  id: 'lasso-polygon',
  hoverOverlay: true,
  cursor: (_e, ev) => modeCursor(ev, useTools.getState().options.lasso.mode),
  hasSession: () => polyPts.length > 0,
  commit: (engine) => closePoly(engine),
  cancel: (engine) => { polyPts = []; engine.invalidateView(); },
  onDown(e, engine) {
    if (!polyPts.length) { polyMode = modeFor(e, useTools.getState().options.lasso.mode); polyPts = [e.doc]; return; }
    const first = engine.docToScreen(polyPts[0]);
    if (polyPts.length > 2 && Math.hypot(first.x - e.screen.x, first.y - e.screen.y) < 8) { closePoly(engine); return; }
    let p = e.doc;
    if (e.shift) {
      const last = polyPts[polyPts.length - 1]; const a = Math.atan2(p.y - last.y, p.x - last.x);
      const sn = Math.round(a / (Math.PI / 4)) * (Math.PI / 4); const d = Math.hypot(p.x - last.x, p.y - last.y);
      p = { x: last.x + Math.cos(sn) * d, y: last.y + Math.sin(sn) * d };
    }
    polyPts.push(p);
  },
  onDoubleClick(_e, engine) { if (polyPts.length > 2) closePoly(engine); },
  onKeyDown(e, engine) {
    if (!polyPts.length) return false;
    if (e.key === 'Enter') { closePoly(engine); return true; }
    if (e.key === 'Escape') { polyPts = []; engine.invalidateView(); return true; }
    if (e.key === 'Backspace' || e.key === 'Delete') { polyPts.pop(); engine.invalidateView(); return true; }
    return false;
  },
  drawOverlay(ctx, engine) {
    drawPolyline(ctx, engine, polyPts, engine.hover, false);
    if (polyPts.length > 2 && engine.hoverScreen) {
      const f = engine.docToScreen(polyPts[0]);
      if (Math.hypot(f.x - engine.hoverScreen.x, f.y - engine.hoverScreen.y) < 8) { ctx.save(); ctx.strokeStyle = '#4f8cff'; ctx.beginPath(); ctx.arc(f.x, f.y, 6, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
    }
  },
};

// ---------------- Magic wand ----------------
export const magicWandTool: Tool = {
  id: 'magic-wand',
  cursor: (_e, ev) => modeCursor(ev, useTools.getState().options.wand.mode),
  onDown(e, engine) {
    const st = engine.state; if (!st) return;
    const o = useTools.getState().options.wand;
    const mode = modeFor(e, o.mode);
    const x = Math.floor(e.doc.x), y = Math.floor(e.doc.y);
    if (x < 0 || y < 0 || x >= st.width || y >= st.height) { if (mode === 'new') commit((s) => ({ ...s, selection: null }), { history: 'Deselect' }); return; }
    const src = sampleSource(st, o.sampleAll, engine);
    let data: Uint8ClampedArray;
    try { data = ctx2d(src, true).getImageData(0, 0, st.width, st.height).data; } catch { toast('Unable to read pixels for this selection.', 'error'); return; }
    const bytes = floodMask(data, st.width, st.height, x, y, o.tolerance, o.contiguous);
    const mask = maskFromBytes(bytes, st.width, st.height, o.antiAlias);
    const sel = combineSelection(st.selection, mask, mode);
    commit((s) => ({ ...s, selection: sel }), { history: `Magic Wand ${MODE_LABEL[mode]}` });
  },
};

/** Select > Color Range style selection (by foreground color across the image). */
export function selectColorRange(engine: Engine, color: { r: number; g: number; b: number }, tolerance: number) {
  const st = engine.state; if (!st) return;
  const src = sampleSource(st, true, engine);
  const d = ctx2d(src, true).getImageData(0, 0, st.width, st.height).data;
  const out = new Uint8Array(st.width * st.height);
  for (let i = 0; i < out.length; i++) {
    const k = i * 4;
    const diff = Math.max(Math.abs(d[k] - color.r), Math.abs(d[k + 1] - color.g), Math.abs(d[k + 2] - color.b));
    out[i] = diff <= tolerance ? 255 : diff <= tolerance * 1.5 ? Math.round(255 * (1 - (diff - tolerance) / (tolerance * 0.5 || 1))) : 0;
    if (!d[k + 3]) out[i] = 0;
  }
  const sel = makeSelection(maskFromBytes(out, st.width, st.height, false));
  commit((s) => ({ ...s, selection: sel }), { history: 'Color Range' });
  if (!sel) toast('No pixels matched that color.', 'info');
}
