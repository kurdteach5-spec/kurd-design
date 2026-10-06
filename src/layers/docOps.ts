import type { DocState, Layer } from '../types/document';
import { applyDeltaTransform } from './geometry';
import { multiply, translate, scaleM, type Matrix, type Rect } from '../utils/math';
import { createCanvas, ctx2d } from '../utils/canvas';
import { makeSelection } from '../canvas/selection';
import { mapAllLayers } from './tree';
import { sharedCompositor } from '../canvas/compositor';

function transformAll(s: DocState, m: Matrix, w: number, h: number): DocState {
  const layers = s.layers.map((l) => applyDeltaTransform(l, m, multiply));
  let selection = s.selection;
  if (selection) {
    const c = createCanvas(w, h); const x = ctx2d(c);
    x.setTransform(m.a, m.b, m.c, m.d, m.e, m.f); x.drawImage(selection.mask, 0, 0);
    selection = makeSelection(c);
  }
  return { ...s, width: w, height: h, layers, selection };
}

/** Crops the document. Non-destructive by default: pixels outside stay in their layers. */
export function cropDocument(s: DocState, r: Rect, deletePixels: boolean): DocState {
  const x = Math.round(r.x), y = Math.round(r.y);
  const w = Math.max(1, Math.round(r.w)), h = Math.max(1, Math.round(r.h));
  let next = transformAll(s, translate(-x, -y), w, h);
  next = { ...next, guides: s.guides.map((g) => ({ ...g, pos: g.pos - (g.orientation === 'v' ? x : y) })).filter((g) => g.pos >= 0 && g.pos <= (g.orientation === 'v' ? w : h)) };
  if (deletePixels) {
    next = { ...next, layers: mapAllLayers(next.layers, (l) => {
      if (l.type !== 'raster') return l;
      const c = createCanvas(w, h); const cx = ctx2d(c);
      const t = l.transform; cx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f); cx.drawImage(l.canvas, 0, 0);
      return { ...l, canvas: c, transform: translate(0, 0) };
    }) };
  }
  return next;
}

export type Anchor = 'tl' | 't' | 'tr' | 'l' | 'c' | 'r' | 'bl' | 'b' | 'br';
export function resizeCanvasDoc(s: DocState, w: number, h: number, anchor: Anchor, extendColor: string | null): DocState {
  const ax = anchor.includes('l') ? 0 : anchor.includes('r') ? 1 : 0.5;
  const ay = anchor.startsWith('t') ? 0 : anchor.startsWith('b') ? 1 : 0.5;
  const dx = Math.round((w - s.width) * ax), dy = Math.round((h - s.height) * ay);
  let next = transformAll(s, translate(dx, dy), w, h);
  next = { ...next, guides: s.guides.map((g) => ({ ...g, pos: g.pos + (g.orientation === 'v' ? dx : dy) })) };
  if (extendColor) {
    // extend the bottom "Background" layer with the chosen color
    const bottom = next.layers[0];
    if (bottom && bottom.type === 'raster' && bottom.name === 'Background') {
      const c = createCanvas(w, h); const cx = ctx2d(c); cx.fillStyle = extendColor; cx.fillRect(0, 0, w, h);
      const t = bottom.transform; cx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f); cx.drawImage(bottom.canvas, 0, 0);
      next = { ...next, layers: [{ ...bottom, canvas: c, transform: translate(0, 0) }, ...next.layers.slice(1)] };
    }
  }
  return next;
}

/** Image Size: scales every layer. Pixel layers are resampled; vector layers stay sharp. */
export function resizeImageDoc(s: DocState, w: number, h: number, dpi: number, resample: boolean): DocState {
  const sx = w / s.width, sy = h / s.height;
  let next = transformAll(s, scaleM(sx, sy), w, h);
  next = { ...next, dpi, guides: s.guides.map((g) => ({ ...g, pos: g.pos * (g.orientation === 'v' ? sx : sy) })) };
  if (resample) {
    next = { ...next, layers: mapAllLayers(next.layers, (l) => {
      if (l.type !== 'raster') return l;
      const t = l.transform;
      // resample into a canvas at its new pixel size when the layer is axis-aligned
      if (t.b !== 0 || t.c !== 0 || t.a <= 0 || t.d <= 0) return l;
      const nw = Math.max(1, Math.round(l.canvas.width * t.a)), nh = Math.max(1, Math.round(l.canvas.height * t.d));
      const c = createCanvas(nw, nh); const cx = ctx2d(c); cx.imageSmoothingQuality = 'high'; cx.drawImage(l.canvas, 0, 0, nw, nh);
      return { ...l, canvas: c, transform: translate(t.e, t.f) };
    }) };
  }
  return next;
}

export function rotateDoc(s: DocState, deg: 90 | -90 | 180): DocState {
  const W = s.width, H = s.height;
  let m: Matrix, w = W, h = H;
  if (deg === 90) { m = { a: 0, b: 1, c: -1, d: 0, e: H, f: 0 }; w = H; h = W; }
  else if (deg === -90) { m = { a: 0, b: -1, c: 1, d: 0, e: 0, f: W }; w = H; h = W; }
  else m = { a: -1, b: 0, c: 0, d: -1, e: W, f: H };
  const next = transformAll(s, m, w, h);
  return { ...next, guides: [] };
}

export function flipDoc(s: DocState, horizontal: boolean): DocState {
  const m: Matrix = horizontal ? { a: -1, b: 0, c: 0, d: 1, e: s.width, f: 0 } : { a: 1, b: 0, c: 0, d: -1, e: 0, f: s.height };
  return transformAll(s, m, s.width, s.height);
}

/** Converts any layer to a pixel layer (keeps masks/effects/opacity). */
export function rasterizeLayer(s: DocState, l: Layer): Layer {
  if (l.type === 'raster' || l.type === 'adjustment' || l.type === 'group') return l;
  const c = sharedCompositor.renderLayer(s, { ...l, mask: null, vectorMask: null, effects: { dropShadow: { ...l.effects.dropShadow, enabled: false }, outerGlow: { ...l.effects.outerGlow, enabled: false }, stroke: { ...l.effects.stroke, enabled: false } }, fillOpacity: 1 } as Layer);
  return { id: l.id, name: l.name, visible: l.visible, locked: l.locked, opacity: l.opacity, fillOpacity: l.fillOpacity, blendMode: l.blendMode, clipped: l.clipped, mask: l.mask, vectorMask: l.vectorMask, effects: l.effects, type: 'raster', canvas: c, transform: translate(0, 0) };
}
