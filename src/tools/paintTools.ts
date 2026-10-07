import type { Tool, ToolPointerEvent } from './types';
import type { Engine } from '../canvas/engine';
import { useTools, setForeground, setBackground, type ToolId } from '../state/toolStore';
import { commit } from '../state/documentStore';
import { activeLayer, applySelectionClip, drawBrushCursor, getPaintTarget, sampleSource, samplePixel, type PaintTarget } from './helpers';
import { RetouchStroke, Stroke } from './brushEngine';
import { floodMask, maskFromBytes } from '../canvas/selection';
import { createCanvas, ctx2d } from '../utils/canvas';
import { hexToRgb, rgbToHex, rgba } from '../utils/color';
import { updateLayer } from '../layers/tree';
import { solidPaint } from '../layers/factory';
import type { Layer } from '../types/document';
import type { Point } from '../utils/math';
import { toast } from '../state/uiStore';
import { gradientLut } from '../adjustments/process';

function pickColor(engine: Engine, p: Point, toBackground: boolean) {
  const st = engine.state; if (!st) return;
  const o = useTools.getState().options.eyedropper;
  const src = sampleSource(st, o.sample === 'all', engine);
  const c = samplePixel(src, p, o.size);
  if (!c || c.a === 0) return;
  const hex = rgbToHex(c);
  if (toBackground) setBackground(hex); else setForeground(hex);
}

// ---------------- Brush-like tools ----------------
type BrushKind = 'brush' | 'pencil' | 'eraser' | 'clone-stamp';
let cloneSource: Point | null = null;
let cloneOffset: Point | null = null;

function brushSettings(kind: BrushKind) {
  const s = useTools.getState(); const o = s.options;
  switch (kind) {
    case 'brush': return { ...o.brush, aliased: false };
    case 'pencil': return { size: o.pencil.size, hardness: 1, opacity: o.pencil.opacity, flow: 1, smoothing: 0, spacing: 0.1, aliased: true, pressureSize: false, pressureOpacity: false };
    case 'eraser': return o.eraser.mode === 'pencil'
      ? { size: o.eraser.size, hardness: 1, opacity: o.eraser.opacity, flow: 1, smoothing: 0, spacing: 0.1, aliased: true, pressureSize: false, pressureOpacity: false }
      : { size: o.eraser.size, hardness: o.eraser.hardness, opacity: o.eraser.opacity, flow: o.eraser.flow, smoothing: 0.2, spacing: 0.1, aliased: false, pressureSize: true, pressureOpacity: false };
    case 'clone-stamp': return { size: o.clone.size, hardness: o.clone.hardness, opacity: o.clone.opacity, flow: o.clone.flow, smoothing: 0.1, spacing: 0.1, aliased: false, pressureSize: false, pressureOpacity: false };
  }
}

function brushTool(id: ToolId, kind: BrushKind): Tool {
  let stroke: Stroke | null = null;
  let target: PaintTarget | null = null;
  let lastPoint: Point | null = null;
  const label = { brush: 'Brush', pencil: 'Pencil', eraser: 'Eraser', 'clone-stamp': 'Clone Stamp' }[kind];
  const begin = (e: ToolPointerEvent, engine: Engine, from?: Point) => {
    const st = engine.state; if (!st) return;
    target = getPaintTarget(st, { newLayer: kind === 'brush' || kind === 'pencil' || kind === 'clone-stamp' }); if (!target) return;
    const s = useTools.getState();
    const set = brushSettings(kind);
    let color = target.color(s.foreground);
    let mode: 'paint' | 'erase' | 'clone' = 'paint';
    if (kind === 'eraser') { if (target.kind === 'mask') color = target.color(s.background); else mode = 'erase'; }
    let src: HTMLCanvasElement | undefined, off: Point | undefined;
    if (kind === 'clone-stamp') {
      if (!cloneSource) { toast('Alt-click (Option-click) to set the clone source first.', 'info'); target = null; return; }
      if (!cloneOffset || !s.options.clone.aligned) cloneOffset = { x: e.doc.x - cloneSource.x, y: e.doc.y - cloneSource.y };
      src = sampleSource(st, s.options.clone.sampleAll, engine);
      // copy so painting doesn't feed back into the source
      const c = createCanvas(src.width, src.height); ctx2d(c).drawImage(src, 0, 0); src = c; off = cloneOffset;
      mode = 'clone';
    }
    stroke = new Stroke(target, st, { ...set, color, mode, cloneSource: src, cloneOffset: off });
    if (from) stroke.add(from, e.pressure);
    stroke.add(e.doc, e.pressure);
    stroke.render();
    engine.setOverride(target.preview());
  };
  return {
    id,
    hoverOverlay: true,
    cursor: (engine) => (engine.hoverScreen ? 'none' : 'crosshair'),
    onDown(e, engine) {
      if (e.alt && kind === 'clone-stamp') { cloneSource = e.doc; cloneOffset = null; toast('Clone source set.', 'info', 1600); return; }
      if (e.alt && (kind === 'brush' || kind === 'pencil')) { pickColor(engine, e.doc, false); return; }
      // shift-click draws a straight line from the last point
      begin(e, engine, e.shift && lastPoint ? lastPoint : undefined);
    },
    onMove(e, engine, dragging) {
      if (!dragging || !stroke || !target) return;
      stroke.add(e.doc, e.pressure);
      engine.setOverride(target.preview(), true, stroke.render());
    },
    onUp(e, engine) {
      if (!stroke || !target) return;
      stroke.finish(e.doc, e.pressure);
      stroke.render(true);
      lastPoint = e.doc;
      target.commit(label);
      stroke = null; target = null;
      engine.clearOverride();
    },
    drawOverlay(ctx, engine) {
      const size = brushSettings(kind).size;
      drawBrushCursor(ctx, engine, size, kind === 'clone-stamp' && cloneSource ? () => {
        const s = engine.docToScreen(cloneOffset && engine.hover ? { x: engine.hover.x - cloneOffset.x, y: engine.hover.y - cloneOffset.y } : cloneSource!);
        ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(s.x - 7, s.y); ctx.lineTo(s.x + 7, s.y); ctx.moveTo(s.x, s.y - 7); ctx.lineTo(s.x, s.y + 7); ctx.stroke();
      } : undefined);
    },
  };
}

export const brushTool_ = brushTool('brush', 'brush');
export const pencilTool = brushTool('pencil', 'pencil');
export const eraserTool = brushTool('eraser', 'eraser');
export const cloneStampTool = brushTool('clone-stamp', 'clone-stamp');

// ---------------- Retouch tools ----------------
function retouchTool(id: ToolId, op: 'blur' | 'sharpen' | 'smudge' | 'dodge' | 'burn'): Tool {
  let stroke: RetouchStroke | null = null; let target: PaintTarget | null = null;
  const label = { blur: 'Blur Tool', sharpen: 'Sharpen Tool', smudge: 'Smudge Tool', dodge: 'Dodge', burn: 'Burn' }[op];
  const size = () => (op === 'dodge' || op === 'burn' ? useTools.getState().options.tone.size : useTools.getState().options.retouch.size);
  return {
    id, hoverOverlay: true,
    cursor: (engine) => (engine.hoverScreen ? 'none' : 'crosshair'),
    onDown(e, engine) {
      const st = engine.state; if (!st) return;
      target = getPaintTarget(st); if (!target) return;
      const o = useTools.getState().options;
      if (op === 'dodge' || op === 'burn') stroke = new RetouchStroke(target, st, op, o.tone.size, o.tone.hardness, o.tone.exposure, o.tone.range);
      else stroke = new RetouchStroke(target, st, op, o.retouch.size, o.retouch.hardness, o.retouch.strength);
      stroke.add(e.doc); engine.setOverride(target.preview());
    },
    onMove(e, engine, dragging) { if (!dragging || !stroke || !target) return; stroke.add(e.doc); engine.setOverride(target.preview(), true, stroke.takeDirty()); },
    onUp(_e, engine) { if (!stroke || !target) return; target.commit(label); stroke = null; target = null; engine.clearOverride(); },
    drawOverlay(ctx, engine) { drawBrushCursor(ctx, engine, size()); },
  };
}
export const blurTool = retouchTool('blur', 'blur');
export const sharpenTool = retouchTool('sharpen', 'sharpen');
export const smudgeTool = retouchTool('smudge', 'smudge');
export const dodgeTool = retouchTool('dodge', 'dodge');
export const burnTool = retouchTool('burn', 'burn');

// ---------------- Eyedropper ----------------
export const eyedropperTool: Tool = {
  id: 'eyedropper',
  cursor: () => 'crosshair',
  onDown(e, engine) { pickColor(engine, e.doc, e.alt); },
  onMove(e, engine, dragging) { if (dragging) pickColor(engine, e.doc, e.alt); },
};

// ---------------- Paint bucket ----------------
export const paintBucketTool: Tool = {
  id: 'paint-bucket',
  cursor: () => 'crosshair',
  onDown(e, engine) {
    const st = engine.state; if (!st) return;
    const layer = activeLayer(st);
    const fg = useTools.getState().foreground;
    if (e.alt) { pickColor(engine, e.doc, false); return; }
    if (layer && layer.type === 'shape' && !layer.locked && st.editTarget === 'content') {
      commit((s) => ({ ...s, layers: updateLayer(s.layers, layer.id, (l) => ({ ...l, fill: solidPaint(fg) } as Layer)) }), { history: 'Fill Shape' }); return;
    }
    if (layer && layer.type === 'text' && !layer.locked && st.editTarget === 'content') {
      commit((s) => ({ ...s, layers: updateLayer(s.layers, layer.id, (l) => ({ ...l, style: { ...(l as typeof layer).style, color: fg } } as Layer)) }), { history: 'Text Color' }); return;
    }
    const target = getPaintTarget(st); if (!target) return;
    const o = useTools.getState().options.bucket;
    const x = Math.floor(e.doc.x), y = Math.floor(e.doc.y);
    if (x < 0 || y < 0 || x >= st.width || y >= st.height) return;
    const src = o.sampleAll ? sampleSource(st, true, engine) : (() => { const c = createCanvas(st.width, st.height); ctx2d(c).drawImage(target.base, target.ox, target.oy); return c; })();
    const data = ctx2d(src, true).getImageData(0, 0, st.width, st.height).data;
    const bytes = floodMask(data, st.width, st.height, x, y, o.tolerance, o.contiguous);
    const region = maskFromBytes(bytes, st.width, st.height, o.antiAlias);
    const fill = createCanvas(st.width, st.height); const fx = ctx2d(fill);
    fx.fillStyle = target.color(fg); fx.fillRect(0, 0, st.width, st.height);
    fx.globalCompositeOperation = 'destination-in'; fx.drawImage(region, 0, 0);
    if (st.selection) fx.drawImage(st.selection.mask, 0, 0);
    const tx = ctx2d(target.canvas); tx.globalAlpha = o.opacity; tx.drawImage(fill, target.ox * -1 + 0, -target.oy);
    target.commit('Paint Bucket');
  },
};

// ---------------- Gradient ----------------
let gStart: Point | null = null, gEnd: Point | null = null; let gTarget: PaintTarget | null = null;

function gradientStops() {
  const s = useTools.getState(); const o = s.options.gradient;
  let stops: { offset: number; color: string; opacity: number }[];
  if (o.preset === 'fg-transparent') stops = [{ offset: 0, color: s.foreground, opacity: 1 }, { offset: 1, color: s.foreground, opacity: 0 }];
  else if (o.preset === 'bw') stops = [{ offset: 0, color: '#000000', opacity: 1 }, { offset: 1, color: '#ffffff', opacity: 1 }];
  else if (o.preset === 'spectrum') stops = ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'].map((c, i) => ({ offset: i / 6, color: c, opacity: 1 }));
  else stops = [{ offset: 0, color: s.foreground, opacity: 1 }, { offset: 1, color: s.background, opacity: 1 }];
  if (o.reverse) stops = stops.map((x) => ({ ...x, offset: 1 - x.offset })).reverse();
  return stops;
}

export function renderGradient(w: number, h: number, a: Point, b: Point, type: string, stops: { offset: number; color: string; opacity: number }[], ox = 0, oy = 0): HTMLCanvasElement {
  const c = createCanvas(w, h); const x = ctx2d(c);
  const A = { x: a.x - ox, y: a.y - oy }, B = { x: b.x - ox, y: b.y - oy };
  const len = Math.max(1, Math.hypot(B.x - A.x, B.y - A.y));
  const add = (g: CanvasGradient, map = (t: number) => t) => { for (const s of stops) g.addColorStop(Math.min(1, Math.max(0, map(s.offset))), rgba(s.color, s.opacity)); };
  if (type === 'linear') { const g = x.createLinearGradient(A.x, A.y, B.x, B.y); add(g); x.fillStyle = g; x.fillRect(0, 0, w, h); return c; }
  if (type === 'radial') { const g = x.createRadialGradient(A.x, A.y, 0, A.x, A.y, len); add(g); x.fillStyle = g; x.fillRect(0, 0, w, h); return c; }
  if (type === 'reflected') {
    const g = x.createLinearGradient(2 * A.x - B.x, 2 * A.y - B.y, B.x, B.y);
    for (const s of stops) { g.addColorStop(0.5 + s.offset / 2, rgba(s.color, s.opacity)); g.addColorStop(0.5 - s.offset / 2, rgba(s.color, s.opacity)); }
    x.fillStyle = g; x.fillRect(0, 0, w, h); return c;
  }
  if (type === 'angle' && 'createConicGradient' in x) {
    const g = (x as CanvasRenderingContext2D & { createConicGradient: (a: number, x: number, y: number) => CanvasGradient }).createConicGradient(Math.atan2(B.y - A.y, B.x - A.x), A.x, A.y);
    add(g); x.fillStyle = g; x.fillRect(0, 0, w, h); return c;
  }
  // diamond (and conic fallback) computed per pixel
  const lut = gradientLut(stops);
  const img = x.createImageData(w, h); const d = img.data;
  const ux = (B.x - A.x) / len, uy = (B.y - A.y) / len;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const dx = i + 0.5 - A.x, dy = j + 0.5 - A.y;
    let t: number;
    if (type === 'angle') t = ((Math.atan2(dy, dx) - Math.atan2(uy, ux)) / (Math.PI * 2) + 1) % 1;
    else t = (Math.abs(dx * ux + dy * uy) + Math.abs(-dx * uy + dy * ux)) / len;
    const k = Math.min(255, Math.max(0, Math.round(t * 255))) * 4, p = (j * w + i) * 4;
    d[p] = lut[k]; d[p + 1] = lut[k + 1]; d[p + 2] = lut[k + 2]; d[p + 3] = lut[k + 3];
  }
  x.putImageData(img, 0, 0);
  return c;
}

function gradientPreview(engine: Engine, final = false) {
  const st = engine.state; if (!st || !gStart || !gEnd || !gTarget) return;
  const o = useTools.getState().options.gradient;
  const t = gTarget;
  const W = t.canvas.width, H = t.canvas.height;
  const fast = !final && (o.type === 'diamond' || (o.type === 'angle' && !('createConicGradient' in CanvasRenderingContext2D.prototype)));
  const scale = fast ? 0.25 : 1;
  let grad = renderGradient(Math.max(1, Math.round(W * scale)), Math.max(1, Math.round(H * scale)), { x: gStart.x * scale, y: gStart.y * scale }, { x: gEnd.x * scale, y: gEnd.y * scale }, o.type, gradientStops(), t.ox * scale, t.oy * scale);
  if (fast) { const g2 = createCanvas(W, H); const gx = ctx2d(g2); gx.drawImage(grad, 0, 0, W, H); grad = g2; }
  if (t.kind === 'mask') { // grayscale for masks
    const gx = ctx2d(grad); gx.globalCompositeOperation = 'saturation'; gx.fillStyle = '#808080'; gx.fillRect(0, 0, W, H);
  }
  const gx = ctx2d(grad); applySelectionClip(gx, st, t.ox, t.oy);
  const x = ctx2d(t.canvas);
  x.globalCompositeOperation = 'copy'; x.globalAlpha = 1; x.drawImage(t.base, 0, 0);
  x.globalCompositeOperation = 'source-over'; x.globalAlpha = o.opacity; x.drawImage(grad, 0, 0); x.globalAlpha = 1;
  engine.setOverride(t.preview());
}

export const gradientTool: Tool = {
  id: 'gradient',
  cursor: () => 'crosshair',
  onDown(e, engine) {
    const st = engine.state; if (!st) return;
    gTarget = getPaintTarget(st, { newLayer: true }); if (!gTarget) return;
    gStart = e.doc; gEnd = e.doc;
  },
  onMove(e, engine, dragging) {
    if (!dragging || !gStart) return;
    let p = e.doc;
    if (e.shift) { const a = Math.atan2(p.y - gStart.y, p.x - gStart.x); const s = Math.round(a / (Math.PI / 4)) * (Math.PI / 4); const d = Math.hypot(p.x - gStart.x, p.y - gStart.y); p = { x: gStart.x + Math.cos(s) * d, y: gStart.y + Math.sin(s) * d }; }
    gEnd = p; gradientPreview(engine);
  },
  onUp(_e, engine) {
    if (gTarget && gStart && gEnd && Math.hypot(gEnd.x - gStart.x, gEnd.y - gStart.y) > 1) { gradientPreview(engine, true); gTarget.commit('Gradient'); }
    gStart = gEnd = null; gTarget = null; engine.clearOverride();
  },
  drawOverlay(ctx, engine) {
    if (!gStart || !gEnd) return;
    const a = engine.docToScreen(gStart), b = engine.docToScreen(gEnd);
    ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke();
    for (const p of [a, b]) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  },
};

export const fgRgb = () => hexToRgb(useTools.getState().foreground);
