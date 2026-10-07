import type { DocState, Layer, LayerMask, RasterLayer } from '../types/document';
import { commit, getDocState } from '../state/documentStore';
import { findLayer, updateLayer, allLayers, insertLayers } from '../layers/tree';
import { createEmptyRaster } from '../layers/factory';
import { createCanvas, ctx2d } from '../utils/canvas';
import { isIntegerTranslation, transformRect, translate, unionRect, type Point, type Rect } from '../utils/math';
import { toast, openDialog, type DialogDescriptor } from '../state/uiStore';
import { renderDocument, sharedCompositor } from '../canvas/compositor';
import { selectionAlpha } from '../canvas/selection';
import { luminance, hexToRgb, grayHex } from '../utils/color';
import { useUI } from '../state/uiStore';
import type { Engine } from '../canvas/engine';
import { docBounds } from '../layers/geometry';

export const activeLayer = (s: DocState | null): Layer | null => (s ? findLayer(s.layers, s.activeLayerId) : null);

/**
 * A pixel surface a tool paints into: a working copy of a raster layer or layer mask.
 * Local pixel = doc pixel - (ox, oy).
 */
export interface PaintTarget {
  kind: 'raster' | 'mask';
  layerId: string;
  base: HTMLCanvasElement; // working copy before the stroke (never committed)
  canvas: HTMLCanvasElement; // preview / result canvas
  ox: number;
  oy: number;
  /** Builds the override layer showing `canvas`. */
  preview(): Layer;
  /** Commits `canvas` into the document as a new history step. */
  commit(label: string): void;
  /** Mask targets convert colors to grayscale. */
  color(hex: string): string;
}

function bakeCanvas(src: HTMLCanvasElement, m: import('../utils/math').Matrix, docW: number, docH: number, bg: string | null): { canvas: HTMLCanvasElement; ox: number; oy: number } {
  const lb = transformRect(m, { x: 0, y: 0, w: src.width, h: src.height });
  const docR: Rect = { x: 0, y: 0, w: docW, h: docH };
  const u = bg ? docR : unionRect(docR, lb)!; // masks only need doc area
  const ox = Math.floor(u.x), oy = Math.floor(u.y);
  const w = Math.ceil(u.x + u.w) - ox, h = Math.ceil(u.y + u.h) - oy;
  const c = createCanvas(w, h); const x = ctx2d(c, true);
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
  x.setTransform(m.a, m.b, m.c, m.d, m.e - ox, m.f - oy);
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0);
  return { canvas: c, ox, oy };
}

function readableCopy(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = createCanvas(src.width, src.height); ctx2d(c, true).drawImage(src, 0, 0); return c;
}

/** Resolves where pixel tools should paint for the active layer, or explains why they can't. */
/** Brush-type tools on a text/shape layer paint on a new pixel layer above it, keeping the original editable. */
function paintOnNewLayer(state: DocState, above: Layer): PaintTarget | null {
  const used = new Set(allLayers(state.layers).map((l) => l.name));
  let i = 1; while (used.has(`Layer ${i}`)) i++;
  const layer = createEmptyRaster(`Layer ${i}`, state.width, state.height);
  commit((s) => ({ ...s, layers: insertLayers(s.layers, [layer], above.id, 'above'), activeLayerId: layer.id, selectedLayerIds: [layer.id], editTarget: 'content' }), { history: 'New Layer' });
  toast(above.type === 'smart' ? 'Smart objects stay editable, so you\'re painting on a new layer.' : `${above.type === 'text' ? 'Text' : 'Shape'} layers stay editable, so you're painting on a new layer.`, 'info', 3500);
  const next = getDocState();
  return next ? getPaintTarget(next, { quiet: true }) : null;
}

export function getPaintTarget(state: DocState, opts: { quiet?: boolean; newLayer?: boolean; next?: DialogDescriptor } = {}): PaintTarget | null {
  const layer = activeLayer(state);
  const say = (m: string) => { if (!opts.quiet) toast(m, 'warning'); return null; };
  if (!layer) return say('Select a layer to paint on.');
  if (layer.locked) return say('This layer is locked.');
  if (!layer.visible) return say('This layer is hidden. Show it to paint on it.');
  const W = state.width, H = state.height;

  if ((state.editTarget === 'mask' && layer.mask) || (layer.type === 'adjustment' && layer.mask) || (layer.type === 'group' && layer.mask && state.editTarget === 'mask')) {
    const mask = layer.mask!;
    let canvas: HTMLCanvasElement, ox: number, oy: number;
    const covers = isIntegerTranslation(mask.transform) && mask.transform.e <= 0 && mask.transform.f <= 0 && mask.transform.e + mask.canvas.width >= W && mask.transform.f + mask.canvas.height >= H;
    if (covers) { canvas = readableCopy(mask.canvas); ox = mask.transform.e; oy = mask.transform.f; }
    else { const b = bakeCanvas(mask.canvas, mask.transform, W, H, grayHex(mask.background)); canvas = b.canvas; ox = b.ox; oy = b.oy; }
    const base = readableCopy(canvas);
    const id = layer.id;
    return {
      kind: 'mask', layerId: id, base, canvas, ox, oy,
      preview: () => ({ ...layer, mask: { ...mask, canvas, transform: translate(ox, oy) } }),
      commit: (label) => commit((s) => ({ ...s, layers: updateLayer(s.layers, id, (l) => ({ ...l, mask: { ...(l.mask as LayerMask), canvas: readableCopyFinal(canvas), transform: translate(ox, oy) } })) }), { history: label }),
      color: (hex) => grayHex(luminance(hexToRgb(hex))),
    };
  }
  if (layer.type !== 'raster') {
    if ((layer.type === 'text' || layer.type === 'shape' || layer.type === 'smart') && !opts.quiet) {
      if (opts.newLayer) return paintOnNewLayer(state, layer);
      openDialog({ type: 'confirm-rasterize', layerId: layer.id, next: opts.next });
      return null;
    }
    return say(layer.type === 'group' ? 'This works on pixel layers. Select a layer inside the group.' : 'This works on pixel layers.');
  }
  const t = layer.transform;
  let canvas: HTMLCanvasElement, ox: number, oy: number;
  const covers = isIntegerTranslation(t) && t.e <= 0 && t.f <= 0 && t.e + layer.canvas.width >= W && t.f + layer.canvas.height >= H;
  if (covers) { canvas = readableCopy(layer.canvas); ox = t.e; oy = t.f; }
  else { const b = bakeCanvas(layer.canvas, t, W, H, null); canvas = b.canvas; ox = b.ox; oy = b.oy; }
  const base = readableCopy(canvas);
  const id = layer.id;
  return {
    kind: 'raster', layerId: id, base, canvas, ox, oy,
    preview: () => ({ ...layer, canvas, transform: translate(ox, oy) } as RasterLayer),
    commit: (label) => commit((s) => ({ ...s, layers: updateLayer(s.layers, id, (l) => ({ ...l, canvas: readableCopyFinal(canvas), transform: translate(ox, oy) } as Layer)) }), { history: label }),
    color: (hex) => hex,
  };
}

/** Committed canvases are fresh copies so the working canvas can be discarded/reused safely. */
function readableCopyFinal(c: HTMLCanvasElement) { const o = createCanvas(c.width, c.height); ctx2d(o).drawImage(c, 0, 0); return o; }

/** Selection alpha clipped into a target's local space (or null when there's no selection). */
export function applySelectionClip(x: CanvasRenderingContext2D, state: DocState, ox: number, oy: number) {
  if (!state.selection) return;
  x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'destination-in';
  x.drawImage(state.selection.mask, -ox, -oy); x.restore();
}

const selAlphaCache = new WeakMap<HTMLCanvasElement, Uint8Array>();
export function selectionBytes(state: DocState): Uint8Array | null {
  if (!state.selection) return null;
  const hit = selAlphaCache.get(state.selection.mask); if (hit) return hit;
  const b = selectionAlpha(state.selection); selAlphaCache.set(state.selection.mask, b); return b;
}

/** Samples pixels from the composite or the active layer in document space. */
export function sampleSource(state: DocState, all: boolean, engine?: Engine | null): HTMLCanvasElement {
  if (all) return engine?.composite && engine.composite.width === state.width && engine.composite.height === state.height ? engine.composite : renderDocument(state);
  const l = activeLayer(state);
  if (!l) return createCanvas(state.width, state.height);
  return sharedCompositor.renderLayer(state, l);
}

export function samplePixel(src: HTMLCanvasElement, p: Point, size = 1): { r: number; g: number; b: number; a: number } | null {
  const x = Math.floor(p.x), y = Math.floor(p.y);
  if (x < 0 || y < 0 || x >= src.width || y >= src.height) return null;
  const h = Math.floor(size / 2);
  const x0 = Math.max(0, x - h), y0 = Math.max(0, y - h);
  const w = Math.min(src.width, x + h + 1) - x0, hh = Math.min(src.height, y + h + 1) - y0;
  const d = ctx2d(src, true).getImageData(x0, y0, w, hh).data;
  let r = 0, g = 0, b = 0, a = 0; const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3]; }
  return { r: r / n, g: g / n, b: b / n, a: a / n };
}

/** Collects snap candidates (doc edges/center, guides, other layers' bounds). */
export function snapLines(state: DocState, excludeIds: Set<string>): { v: number[]; h: number[] } {
  const v = [0, state.width / 2, state.width], h = [0, state.height / 2, state.height];
  if (useUI.getState().showGuides) for (const g of state.guides) (g.orientation === 'v' ? v : h).push(g.pos);
  const walk = (ls: Layer[]) => {
    for (const l of ls) {
      if (excludeIds.has(l.id) || !l.visible) continue;
      if (l.type === 'group') { walk(l.children); continue; }
      const b = docBounds(l); if (!b) continue;
      v.push(b.x, b.x + b.w / 2, b.x + b.w); h.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
  };
  walk(state.layers);
  return { v, h };
}

export function snapValue(values: number[], candidates: number[], threshold: number): { delta: number; line: number | null } {
  let best = threshold + 1, delta = 0, line: number | null = null;
  for (const val of values) for (const c of candidates) {
    const d = c - val;
    if (Math.abs(d) < Math.abs(best) && Math.abs(d) <= threshold) { best = d; delta = d; line = c; }
  }
  return { delta, line };
}

export const snappingOn = () => useUI.getState().snap;

export function requireDoc(): DocState | null { return getDocState(); }

/** Common brush-circle cursor overlay. */
export function drawBrushCursor(ctx: CanvasRenderingContext2D, engine: Engine, size: number, extra?: (r: number, p: Point) => void) {
  if (!engine.hoverScreen || engine.spaceHeld) return;
  const p = engine.hoverScreen; const r = Math.max(1, (size / 2) * engine.zoom);
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(p.x, p.y, r + 1, 0, Math.PI * 2); ctx.stroke();
  if (r < 4) { ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(p.x - 6, p.y); ctx.lineTo(p.x + 6, p.y); ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x, p.y + 6); ctx.stroke(); }
  extra?.(r, p);
  ctx.restore();
}

export const CROSSHAIR = 'crosshair';
export function svgCursor(svg: string, hx: number, hy: number, fallback = 'crosshair') {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hx} ${hy}, ${fallback}`;
}
