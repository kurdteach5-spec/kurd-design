import type { AdjustmentLayer, BlendMode, DocState, Layer, SmartContents, SmartObjectLayer } from '../types/document';
import { filterKernel } from '../filters/kernel';
import { createCanvas, ctx2d } from '../utils/canvas';
import { objId } from '../utils/id';
import { drawText } from './textRender';
import { drawShape } from './shapeRender';
import { hasEffects, maskAlpha, renderWithEffects, vectorMaskAlpha } from './effects';
import { applyAdjustment, isNeutral } from '../adjustments/process';

export interface CompositeOptions {
  /** Replacement layer objects for live previews (painting, transforms, filter previews). */
  overrides?: Map<string, Layer>;
  /** Layers whose pixels change between frames without a new object (skip caches). */
  live?: Set<string>;
  hidden?: Set<string>;
  /** Render only the layers below this id. */
  stopAt?: string;
  /** Disable the low-resolution preview used while adjustment sliders are dragged. */
  fullQuality?: boolean;
  /** Only recomposite this document-space rectangle (used while painting). */
  clip?: { x: number; y: number; w: number; h: number };
}

export const gco = (b: BlendMode): GlobalCompositeOperation => (b === 'normal' || b === 'pass-through' ? 'source-over' : (b as GlobalCompositeOperation));

class Pool {
  private free = new Map<string, HTMLCanvasElement[]>();
  get(w: number, h: number) {
    const k = `${w}x${h}`; const list = this.free.get(k);
    const c = list?.pop() ?? createCanvas(w, h);
    const x = ctx2d(c); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, w, h);
    return c;
  }
  release(c: HTMLCanvasElement) {
    const k = `${c.width}x${c.height}`; const list = this.free.get(k) ?? [];
    if (list.length < 6) list.push(c); this.free.set(k, list);
  }
  clear() { this.free.clear(); }
}

interface Ctx { state: DocState; opts: CompositeOptions; w: number; h: number; stopped: boolean; frame: number }

/** Draws a layer's content (no masks/effects) in doc space. */
export function drawLayerContent(x: CanvasRenderingContext2D, l: Layer, alpha = 1) {
  if (l.type === 'group' || l.type === 'adjustment') return;
  const t = l.transform;
  x.save();
  x.transform(t.a, t.b, t.c, t.d, t.e, t.f);
  x.globalAlpha *= alpha;
  if (l.type === 'raster') { x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(l.canvas, 0, 0); }
  else if (l.type === 'text') drawText(x, l);
  else if (l.type === 'smart') { x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(smartContentCanvas(l), 0, 0); }
  else drawShape(x, l);
  x.restore();
}

export class Compositor {
  private pool = new Pool();
  private bufferCache = new WeakMap<Layer, { w: number; h: number; c: HTMLCanvasElement }>();
  private adjCache = new Map<string, { key: string; c: HTMLCanvasElement }>();
  /** Pixels below an adjustment layer, so dragging its sliders skips the GPU readback. */
  private adjInput = new Map<string, { key: string; data: Uint8ClampedArray }>();
  /** Called when a fast low-resolution preview was drawn and a full-quality pass should follow. */
  onRefine: (() => void) | null = null;
  private frame = 0;

  /** Renders the document into `target` (resized to the document size). */
  render(state: DocState, target: HTMLCanvasElement, opts: CompositeOptions = {}): HTMLCanvasElement {
    if (target.width !== state.width || target.height !== state.height) { target.width = state.width; target.height = state.height; }
    const x = ctx2d(target);
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    const clip = opts.clip;
    if (clip) { x.save(); x.beginPath(); x.rect(clip.x, clip.y, clip.w, clip.h); x.clip(); x.clearRect(clip.x, clip.y, clip.w, clip.h); }
    else x.clearRect(0, 0, state.width, state.height);
    const c: Ctx = { state, opts, w: state.width, h: state.height, stopped: false, frame: ++this.frame };
    this.renderStack(x, state.layers, c, { s: '' });
    if (clip) x.restore();
    return target;
  }

  /** Renders a single layer in isolation (thumbnails, PSD export, sampling). */
  renderLayer(state: DocState, layer: Layer, target?: HTMLCanvasElement, withOpacity = false): HTMLCanvasElement {
    const out = target ?? createCanvas(state.width, state.height);
    if (out.width !== state.width || out.height !== state.height) { out.width = state.width; out.height = state.height; }
    const x = ctx2d(out); x.clearRect(0, 0, out.width, out.height);
    const c: Ctx = { state, opts: {}, w: state.width, h: state.height, stopped: false, frame: ++this.frame };
    if (layer.type === 'group') {
      this.renderStack(x, layer.children, c, { s: '' });
    } else if (layer.type !== 'adjustment') {
      const buf = this.layerBuffer(layer, c);
      x.globalAlpha = withOpacity ? layer.opacity : 1;
      x.drawImage(buf, 0, 0);
      if (!this.isCached(layer, c)) this.pool.release(buf);
    }
    return out;
  }

  clearCaches() { this.adjInput.clear(); this.adjCache.clear(); this.pool.clear(); this.bufferCache = new WeakMap(); }

  private resolve(l: Layer, c: Ctx): Layer { return c.opts.overrides?.get(l.id) ?? l; }
  private isLive(l: Layer, c: Ctx) { return !!(c.opts.live?.has(l.id) || c.opts.overrides?.has(l.id)); }
  private sigOf(l: Layer, c: Ctx): string {
    if (l.type === 'group') return `g${objId(l)}[${l.children.map((ch) => this.sigOf(this.resolve(ch, c), c)).join(',')}]`;
    return this.isLive(l, c) ? `${objId(l)}~${c.frame}` : `${objId(l)}`;
  }

  private renderStack(x: CanvasRenderingContext2D, layers: Layer[], c: Ctx, sig: { s: string }) {
    let i = 0;
    while (i < layers.length) {
      if (c.stopped) return;
      const l = this.resolve(layers[i], c);
      if (c.opts.stopAt === l.id) { c.stopped = true; return; }
      let j = i + 1;
      const clips: Layer[] = [];
      if (l.type !== 'adjustment') {
        while (j < layers.length && layers[j].clipped) { clips.push(this.resolve(layers[j], c)); j++; }
      }
      const hidden = !l.visible || c.opts.hidden?.has(l.id);
      if (hidden) { i = j; continue; }
      if (l.type === 'adjustment') {
        this.applyAdjustmentLayer(x, l, c, sig);
        sig.s += `a${this.sigOf(l, c)};`;
      } else if (clips.some((k) => k.visible && !c.opts.hidden?.has(k.id) && c.opts.stopAt !== k.id)) {
        this.drawClipGroup(x, l, clips, c);
        sig.s += `c${this.sigOf(l, c)}(${clips.map((k) => this.sigOf(k, c)).join(',')});`;
      } else {
        this.drawLayer(x, l, c);
        sig.s += `${this.sigOf(l, c)};`;
      }
      i = j;
    }
  }

  private needsBuffer(l: Layer) {
    return !!((l.mask && l.mask.enabled) || (l.vectorMask && l.vectorMask.enabled) || hasEffects(l.effects));
  }

  private isCached(l: Layer, c: Ctx) { return !this.isLive(l, c) && l.type !== 'group'; }

  /** Layer content with masks & effects applied (fill opacity applied, layer opacity not). */
  private layerBuffer(l: Layer, c: Ctx): HTMLCanvasElement {
    const cacheable = this.isCached(l, c);
    if (cacheable) {
      const hit = this.bufferCache.get(l);
      if (hit && hit.w === c.w && hit.h === c.h) return hit.c;
    }
    let buf = cacheable ? createCanvas(c.w, c.h) : this.pool.get(c.w, c.h);
    const x = ctx2d(buf);
    if (l.type === 'group') this.renderStack(x, l.children, { ...c }, { s: '' });
    else drawLayerContent(x, l, 1);
    this.applyMasks(x, l, c);
    if (hasEffects(l.effects)) {
      const fx = renderWithEffects(buf, l.effects, l.type === 'group' ? 1 : l.fillOpacity);
      if (cacheable) buf = fx; else { x.clearRect(0, 0, c.w, c.h); x.drawImage(fx, 0, 0); }
    } else if (l.fillOpacity < 1 && l.type !== 'group') {
      const tmp = createCanvas(c.w, c.h); const tx = ctx2d(tmp); tx.globalAlpha = l.fillOpacity; tx.drawImage(buf, 0, 0);
      if (cacheable) buf = tmp; else { x.clearRect(0, 0, c.w, c.h); x.drawImage(tmp, 0, 0); }
    }
    if (cacheable) this.bufferCache.set(l, { w: c.w, h: c.h, c: buf });
    return buf;
  }

  private applyMasks(x: CanvasRenderingContext2D, l: Layer, c: Ctx) {
    if (l.mask && l.mask.enabled) {
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'destination-in';
      x.drawImage(maskAlpha(l.mask, c.w, c.h), 0, 0); x.restore();
    }
    if (l.vectorMask && l.vectorMask.enabled) {
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'destination-in';
      x.drawImage(vectorMaskAlpha(l.vectorMask, c.w, c.h), 0, 0); x.restore();
    }
  }

  private drawLayer(x: CanvasRenderingContext2D, l: Layer, c: Ctx) {
    if (l.type === 'group') {
      const inline = l.blendMode === 'pass-through' && l.opacity >= 1 && !this.needsBuffer(l);
      if (inline) { this.renderStack(x, l.children, c, { s: '' }); return; }
      const buf = this.pool.get(c.w, c.h); const bx = ctx2d(buf);
      this.renderStack(bx, l.children, c, { s: '' });
      this.applyMasks(bx, l, c);
      let src = buf;
      if (hasEffects(l.effects)) src = renderWithEffects(buf, l.effects, 1);
      x.save(); x.globalAlpha = l.opacity; x.globalCompositeOperation = gco(l.blendMode); x.drawImage(src, 0, 0); x.restore();
      this.pool.release(buf);
      return;
    }
    if (this.needsBuffer(l) || (l.fillOpacity < 1 && hasEffects(l.effects))) {
      const buf = this.layerBuffer(l, c);
      x.save(); x.globalAlpha = l.opacity; x.globalCompositeOperation = gco(l.blendMode); x.drawImage(buf, 0, 0); x.restore();
      if (!this.isCached(l, c)) this.pool.release(buf);
      return;
    }
    x.save();
    x.globalCompositeOperation = gco(l.blendMode);
    drawLayerContent(x, l, l.opacity * l.fillOpacity);
    x.restore();
  }

  private drawClipGroup(x: CanvasRenderingContext2D, base: Layer, clips: Layer[], c: Ctx) {
    const baseBuf = this.layerBuffer(base, c);
    const group = this.pool.get(c.w, c.h); const gx = ctx2d(group);
    gx.drawImage(baseBuf, 0, 0);
    for (const k of clips) {
      if (!k.visible || c.opts.hidden?.has(k.id)) continue;
      if (c.opts.stopAt === k.id) { c.stopped = true; break; }
      if (k.type === 'adjustment') { this.applyAdjustmentRaw(gx, k, c); continue; }
      const tmp = this.pool.get(c.w, c.h); const tx = ctx2d(tmp);
      this.drawLayer(tx, { ...k, blendMode: 'normal', opacity: 1 } as Layer, c);
      tx.globalCompositeOperation = 'destination-in'; tx.drawImage(baseBuf, 0, 0);
      gx.save(); gx.globalAlpha = k.opacity; gx.globalCompositeOperation = gco(k.blendMode === 'pass-through' ? 'normal' : k.blendMode);
      gx.drawImage(tmp, 0, 0); gx.restore();
      this.pool.release(tmp);
    }
    x.save(); x.globalAlpha = base.opacity; x.globalCompositeOperation = gco(base.blendMode); x.drawImage(group, 0, 0); x.restore();
    this.pool.release(group);
    if (!this.isCached(base, c)) this.pool.release(baseBuf);
  }

  /** Applies an adjustment to everything already drawn in `x` (cached by the content signature). */
  private applyAdjustmentLayer(x: CanvasRenderingContext2D, l: AdjustmentLayer, c: Ctx, sig: { s: string }) {
    if (isNeutral(l.adjustment)) return;
    if (c.opts.clip) { this.applyAdjustmentRaw(x, l, c); return; }
    const key = `${sig.s}|${this.sigOf(l, c)}|${c.w}x${c.h}`;
    const hit = this.adjCache.get(l.id);
    if (hit && hit.key === key) {
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'copy'; x.drawImage(hit.c, 0, 0); x.restore();
      return;
    }
    const inKey = `${sig.s}|${c.w}x${c.h}`;
    const input = this.adjInput.get(l.id);
    let src: Uint8ClampedArray | undefined;
    if (input && input.key === inKey) src = input.data;
    else if (!/~/.test(sig.s)) {
      // stable content below: remember it for the next slider change
      src = x.getImageData(0, 0, c.w, c.h).data;
      if (this.adjInput.size >= 2 && !this.adjInput.has(l.id)) this.adjInput.delete(this.adjInput.keys().next().value!);
      this.adjInput.set(l.id, { key: inKey, data: new Uint8ClampedArray(src) });
    }
    // Rapid edits on big images: preview at reduced resolution, refine when the user pauses.
    // (input cache hit = only this adjustment changed, i.e. the user is editing it)
    const editing = !!(input && input.key === inKey);
    if (editing && src && !c.opts.fullQuality && c.w * c.h > 2_000_000 && l.adjustment.kind !== 'develop') {
      const step = Math.ceil(Math.sqrt((c.w * c.h) / 900_000));
      const sw = Math.ceil(c.w / step), sh = Math.ceil(c.h / step);
      const small = new ImageData(sw, sh); const d = small.data;
      for (let y = 0, o = 0; y < sh; y++) { const row = y * step * c.w; for (let xx = 0; xx < sw; xx++, o += 4) { const i = (row + xx * step) * 4; d[o] = src[i]; d[o + 1] = src[i + 1]; d[o + 2] = src[i + 2]; d[o + 3] = src[i + 3]; } }
      applyAdjustment(d, sw, sh, l.adjustment);
      const sc = this.pool.get(sw, sh); ctx2d(sc).putImageData(small, 0, 0);
      const simple = l.opacity >= 1 && (l.blendMode === 'normal' || l.blendMode === 'pass-through') && !this.needsBuffer(l);
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.imageSmoothingEnabled = true;
      if (simple) { x.globalCompositeOperation = 'copy'; x.drawImage(sc, 0, 0, c.w, c.h); }
      else {
        const tmp = this.pool.get(c.w, c.h); const tx = ctx2d(tmp);
        tx.drawImage(sc, 0, 0, c.w, c.h); this.applyMasks(tx, l, c);
        x.globalAlpha = l.opacity; x.globalCompositeOperation = gco(l.blendMode); x.drawImage(tmp, 0, 0);
        this.pool.release(tmp);
      }
      x.restore();
      this.pool.release(sc);
      this.onRefine?.();
      return;
    }
    this.applyAdjustmentRaw(x, l, c, src);
    const cache = hit?.c && hit.c.width === c.w && hit.c.height === c.h ? hit.c : createCanvas(c.w, c.h);
    const cx = ctx2d(cache); cx.globalCompositeOperation = 'copy'; cx.drawImage(x.canvas, 0, 0); cx.globalCompositeOperation = 'source-over';
    this.adjCache.set(l.id, { key, c: cache });
  }

  private applyAdjustmentRaw(x: CanvasRenderingContext2D, l: AdjustmentLayer, c: Ctx, src?: Uint8ClampedArray) {
    if (isNeutral(l.adjustment)) return;
    const r = c.opts.clip
      ? { x: Math.max(0, Math.floor(c.opts.clip.x)), y: Math.max(0, Math.floor(c.opts.clip.y)), w: 0, h: 0 }
      : { x: 0, y: 0, w: c.w, h: c.h };
    if (c.opts.clip) { r.w = Math.min(c.w, Math.ceil(c.opts.clip.x + c.opts.clip.w)) - r.x; r.h = Math.min(c.h, Math.ceil(c.opts.clip.y + c.opts.clip.h)) - r.y; }
    if (r.w <= 0 || r.h <= 0) return;
    let img: ImageData;
    if (src && !c.opts.clip) { img = new ImageData(new Uint8ClampedArray(src), c.w, c.h); }
    else img = x.getImageData(r.x, r.y, r.w, r.h);
    const simple = l.opacity >= 1 && (l.blendMode === 'normal' || l.blendMode === 'pass-through') && !this.needsBuffer(l);
    applyAdjustment(img.data, r.w, r.h, l.adjustment);
    if (simple) { x.putImageData(img, r.x, r.y); return; }
    const tmp = this.pool.get(c.w, c.h); const tx = ctx2d(tmp);
    tx.putImageData(img, r.x, r.y);
    this.applyMasks(tx, l, c);
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = l.opacity; x.globalCompositeOperation = gco(l.blendMode); x.drawImage(tmp, 0, 0); x.restore();
    this.pool.release(tmp);
  }
}

/** Shared compositor for exports, sampling and thumbnails. */
export const sharedCompositor = new Compositor();

/** Full-document render (applies grayscale color mode). */
export function renderDocument(state: DocState, opts: CompositeOptions = {}): HTMLCanvasElement {
  const out = createCanvas(state.width, state.height);
  sharedCompositor.render(state, out, opts);
  if (state.colorMode === 'grayscale') toGrayscale(out);
  return out;
}

export function toGrayscale(c: HTMLCanvasElement) {
  const x = ctx2d(c); const img = x.getImageData(0, 0, c.width, c.height); const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = v; }
  x.putImageData(img, 0, 0);
}

// ---------------- Smart objects ----------------
const smartBase = new WeakMap<SmartContents, HTMLCanvasElement>();
const smartFiltered = new WeakMap<SmartContents, { key: string; canvas: HTMLCanvasElement }>();
let kernel: ReturnType<typeof filterKernel> | null = null;

/** Renders a smart object's embedded layers at their original resolution (cached per contents). */
export function smartBaseCanvas(contents: SmartContents): HTMLCanvasElement {
  let base = smartBase.get(contents);
  if (!base) {
    const st: DocState = { width: contents.width, height: contents.height, dpi: contents.dpi, colorMode: 'rgb', layers: contents.layers, activeLayerId: null, selectedLayerIds: [], editTarget: 'content', selection: null, guides: [] };
    base = new Compositor().render(st, createCanvas(contents.width, contents.height), { fullQuality: true });
    smartBase.set(contents, base);
  }
  return base;
}

/** Smart object pixels: contents with the enabled smart filters applied (cached until either changes). */
export function smartContentCanvas(l: SmartObjectLayer): HTMLCanvasElement {
  const base = smartBaseCanvas(l.contents);
  const active = l.filtersEnabled ? l.filters.filter((f) => f.enabled) : [];
  if (!active.length) return base;
  const key = JSON.stringify(active.map((f) => (f.kind === 'filter' ? [f.filter, f.params] : [f.adjustment])));
  const hit = smartFiltered.get(l.contents);
  if (hit && hit.key === key) return hit.canvas;
  const w = base.width, h = base.height;
  const img = ctx2d(base, true).getImageData(0, 0, w, h);
  for (const f of active) {
    try {
      if (f.kind === 'filter') { kernel ??= filterKernel(); kernel.run(f.filter, img.data, w, h, f.params, () => {}); }
      else applyAdjustment(img.data, w, h, f.adjustment);
    } catch (e) { console.warn('Smart filter failed', e); }
  }
  const out = createCanvas(w, h); ctx2d(out).putImageData(img, 0, 0);
  smartFiltered.set(l.contents, { key, canvas: out });
  return out;
}
