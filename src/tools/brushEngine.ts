import type { DocState } from '../types/document';
import type { PaintTarget } from './helpers';
import { applySelectionClip, selectionBytes } from './helpers';
import { createCanvas, ctx2d } from '../utils/canvas';
import { hexToRgb } from '../utils/color';
import type { Point } from '../utils/math';

const stampCache = new Map<string, HTMLCanvasElement>();
/** A round brush tip at a given diameter/hardness, white with soft alpha falloff. */
export function brushStamp(diameter: number, hardness: number, aliased = false): HTMLCanvasElement {
  const d = Math.max(1, Math.ceil(diameter));
  const key = `${d}|${hardness.toFixed(2)}|${aliased}`;
  const hit = stampCache.get(key); if (hit) return hit;
  const c = createCanvas(d + 2, d + 2); const x = ctx2d(c);
  const r = diameter / 2, cx = (d + 2) / 2;
  if (aliased) {
    const img = x.createImageData(c.width, c.height);
    for (let j = 0; j < c.height; j++) for (let i = 0; i < c.width; i++) {
      const dx = i + 0.5 - cx, dy = j + 0.5 - cx;
      if (dx * dx + dy * dy <= Math.max(0.25, r * r)) { const k = (j * c.width + i) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = img.data[k + 3] = 255; }
    }
    x.putImageData(img, 0, 0);
  } else {
    const g = x.createRadialGradient(cx, cx, 0, cx, cx, r);
    const h = Math.min(0.99, Math.max(0, hardness));
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(h, 'rgba(255,255,255,1)');
    // smooth falloff
    for (let i = 1; i <= 4; i++) { const t = h + ((1 - h) * i) / 5; const a = 1 - i / 5; g.addColorStop(t, `rgba(255,255,255,${a * a * (3 - 2 * a)})`); }
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cx, Math.max(0.5, r), 0, Math.PI * 2); x.fill();
  }
  if (stampCache.size > 64) stampCache.delete(stampCache.keys().next().value!);
  stampCache.set(key, c);
  return c;
}

const tinted = new Map<string, HTMLCanvasElement>();
function tintStamp(stamp: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const key = `${stampKey(stamp)}|${color}`;
  const hit = tinted.get(key); if (hit) return hit;
  const c = createCanvas(stamp.width, stamp.height); const x = ctx2d(c);
  x.drawImage(stamp, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  if (tinted.size > 64) tinted.delete(tinted.keys().next().value!);
  tinted.set(key, c); return c;
}
const stampIds = new WeakMap<HTMLCanvasElement, number>(); let sid = 0;
function stampKey(c: HTMLCanvasElement) { let k = stampIds.get(c); if (!k) { k = ++sid; stampIds.set(c, k); } return k; }

export type StrokeMode = 'paint' | 'erase' | 'clone';
export interface StrokeSettings {
  size: number; hardness: number; opacity: number; flow: number; spacing: number; smoothing: number;
  color: string; mode: StrokeMode; aliased?: boolean; pressureSize?: boolean; pressureOpacity?: boolean;
  /** Clone source: canvas in doc space and offset (dest - src). */
  cloneSource?: HTMLCanvasElement; cloneOffset?: Point;
}

/** Accumulates dabs into a stroke buffer and composites it onto the target for preview/commit. */
export class Stroke {
  readonly buffer: HTMLCanvasElement;
  private bx: CanvasRenderingContext2D;
  private last: Point | null = null;
  private smooth: Point | null = null;
  private residual = 0;
  private dirty: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private cloneTmp: HTMLCanvasElement | null = null;

  constructor(readonly target: PaintTarget, readonly state: DocState, readonly s: StrokeSettings) {
    this.buffer = createCanvas(target.canvas.width, target.canvas.height);
    this.bx = ctx2d(this.buffer);
  }

  /** Feed a pointer position (doc space). */
  add(p: Point, pressure = 1, final = false) {
    let q = p;
    if (this.s.smoothing > 0 && !final) {
      if (!this.smooth) this.smooth = { ...p };
      const k = 1 - Math.min(0.92, this.s.smoothing * 0.9);
      this.smooth = { x: this.smooth.x + (p.x - this.smooth.x) * k, y: this.smooth.y + (p.y - this.smooth.y) * k };
      q = this.smooth;
    }
    const local = { x: q.x - this.target.ox, y: q.y - this.target.oy };
    const size = Math.max(0.5, this.s.size * (this.s.pressureSize ? 0.25 + pressure * 0.75 : 1));
    const step = Math.max(this.s.aliased ? 0.5 : 1, size * Math.max(0.02, this.s.spacing));
    if (!this.last) { this.dab(local, size, pressure); this.last = local; return; }
    const dx = local.x - this.last.x, dy = local.y - this.last.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-3) return;
    let t = step - this.residual;
    while (t <= dist) {
      this.dab({ x: this.last.x + (dx * t) / dist, y: this.last.y + (dy * t) / dist }, size, pressure);
      t += step;
    }
    this.residual = dist - (t - step);
    this.last = local;
  }

  /** Finishes the smoothed tail so the stroke reaches the pointer-up point. */
  finish(p: Point, pressure = 1) { if (this.smooth) this.add(p, pressure, true); }

  private dab(p: Point, size: number, pressure: number) {
    const stamp = brushStamp(size, this.s.hardness, this.s.aliased);
    const half = stamp.width / 2;
    const x0 = this.s.aliased ? Math.round(p.x - half) : p.x - half, y0 = this.s.aliased ? Math.round(p.y - half) : p.y - half;
    const flow = this.s.flow * (this.s.pressureOpacity ? pressure : 1);
    const bx = this.bx;
    bx.globalAlpha = flow;
    if (this.s.mode === 'clone' && this.s.cloneSource && this.s.cloneOffset) {
      if (!this.cloneTmp || this.cloneTmp.width !== stamp.width) this.cloneTmp = createCanvas(stamp.width, stamp.height);
      const tx = ctx2d(this.cloneTmp);
      tx.globalCompositeOperation = 'copy';
      const sx = x0 + this.target.ox - this.s.cloneOffset.x, sy = y0 + this.target.oy - this.s.cloneOffset.y;
      tx.drawImage(this.s.cloneSource, -sx, -sy);
      tx.globalCompositeOperation = 'destination-in'; tx.drawImage(stamp, 0, 0);
      bx.drawImage(this.cloneTmp, x0, y0);
    } else {
      bx.drawImage(tintStamp(stamp, this.s.mode === 'erase' ? '#000' : this.s.color), x0, y0);
    }
    const d = this.dirty;
    const r = { x0: Math.floor(x0) - 1, y0: Math.floor(y0) - 1, x1: Math.ceil(x0 + stamp.width) + 1, y1: Math.ceil(y0 + stamp.height) + 1 };
    this.dirty = d ? { x0: Math.min(d.x0, r.x0), y0: Math.min(d.y0, r.y0), x1: Math.max(d.x1, r.x1), y1: Math.max(d.y1, r.y1) } : r;
  }

  /** Redraws the preview canvas (base + stroke) in the dirty region; returns that region in doc space. */
  render(full = false): { x: number; y: number; w: number; h: number } | null {
    const t = this.target; const x = ctx2d(t.canvas);
    const W = t.canvas.width, H = t.canvas.height;
    const d = full || !this.dirty ? { x0: 0, y0: 0, x1: W, y1: H } : this.dirty;
    const rx = Math.max(0, d.x0), ry = Math.max(0, d.y0), rw = Math.min(W, d.x1) - rx, rh = Math.min(H, d.y1) - ry;
    if (rw <= 0 || rh <= 0) return null;
    if (this.state.selection && !full) this.clipBuffer();
    x.save();
    x.beginPath(); x.rect(rx, ry, rw, rh); x.clip();
    x.globalCompositeOperation = 'copy'; x.drawImage(t.base, 0, 0);
    x.globalCompositeOperation = this.s.mode === 'erase' ? 'destination-out' : 'source-over';
    x.globalAlpha = this.s.opacity;
    x.drawImage(this.buffer, 0, 0);
    x.restore();
    this.dirty = null;
    return { x: rx + t.ox, y: ry + t.oy, w: rw, h: rh };
  }

  private clipBuffer() { applySelectionClip(this.bx, this.state, this.target.ox, this.target.oy); }
}

/** Pixel-level brush operations (blur, sharpen, smudge, dodge, burn) applied directly to the preview canvas. */
export class RetouchStroke {
  private x: CanvasRenderingContext2D;
  private last: Point | null = null;
  private carried: Float32Array | null = null;
  private sel: Uint8Array | null;
  dirty: { x: number; y: number; w: number; h: number } | null = null;
  /** Returns and resets the doc-space region touched since the last call. */
  takeDirty() { const d = this.dirty; this.dirty = null; return d; }
  constructor(
    readonly target: PaintTarget, readonly state: DocState,
    readonly op: 'blur' | 'sharpen' | 'smudge' | 'dodge' | 'burn',
    readonly size: number, readonly hardness: number, readonly strength: number, readonly range: 'shadows' | 'midtones' | 'highlights' = 'midtones',
  ) {
    this.x = ctx2d(target.canvas, true);
    this.sel = selectionBytes(state);
  }
  add(p: Point) {
    const local = { x: p.x - this.target.ox, y: p.y - this.target.oy };
    const step = Math.max(1, this.size * 0.15);
    if (!this.last) { this.dab(local); this.last = local; return; }
    const dist = Math.hypot(local.x - this.last.x, local.y - this.last.y);
    if (dist < step) return;
    const n = Math.floor(dist / step);
    for (let i = 1; i <= n; i++) this.dab({ x: this.last.x + ((local.x - this.last.x) * i) / n, y: this.last.y + ((local.y - this.last.y) * i) / n });
    this.last = local;
  }
  private dab(c: Point) {
    const r = this.size / 2;
    const x0 = Math.max(0, Math.floor(c.x - r)), y0 = Math.max(0, Math.floor(c.y - r));
    const x1 = Math.min(this.target.canvas.width, Math.ceil(c.x + r)), y1 = Math.min(this.target.canvas.height, Math.ceil(c.y + r));
    const w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    const img = this.x.getImageData(x0, y0, w, h); const d = img.data;
    const weights = new Float32Array(w * h);
    const hard = Math.min(0.99, this.hardness);
    const docW = this.state.width;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const dd = Math.hypot(x0 + i + 0.5 - c.x, y0 + j + 0.5 - c.y) / r;
      let wt = dd >= 1 ? 0 : dd <= hard ? 1 : 1 - (dd - hard) / (1 - hard);
      if (this.sel) {
        const gx = x0 + i + this.target.ox, gy = y0 + j + this.target.oy;
        wt *= gx >= 0 && gy >= 0 && gx < docW && gy < this.state.height ? this.sel[gy * docW + gx] / 255 : 0;
      }
      weights[j * w + i] = wt;
    }
    const s = this.strength;
    if (this.op === 'blur' || this.op === 'sharpen') {
      const src = new Uint8ClampedArray(d);
      const rad = Math.max(1, Math.round(this.size / 24));
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const wt = weights[j * w + i] * s; if (!wt) continue;
        let ar = 0, ag = 0, ab = 0, aa = 0, n = 0;
        for (let v = -rad; v <= rad; v++) for (let u = -rad; u <= rad; u++) {
          const ii = Math.min(w - 1, Math.max(0, i + u)), jj = Math.min(h - 1, Math.max(0, j + v));
          const k = (jj * w + ii) * 4; const a = src[k + 3] / 255;
          ar += src[k] * a; ag += src[k + 1] * a; ab += src[k + 2] * a; aa += src[k + 3]; n++;
        }
        const k = (j * w + i) * 4;
        const ma = aa / n; const inv = ma > 0 ? 255 / aa : 0;
        const br = ar * inv, bg = ag * inv, bb = ab * inv;
        if (this.op === 'blur') {
          d[k] += (br - d[k]) * wt; d[k + 1] += (bg - d[k + 1]) * wt; d[k + 2] += (bb - d[k + 2]) * wt; d[k + 3] += (ma - d[k + 3]) * wt;
        } else {
          const amt = wt * 0.6;
          d[k] = d[k] + (d[k] - br) * amt; d[k + 1] = d[k + 1] + (d[k + 1] - bg) * amt; d[k + 2] = d[k + 2] + (d[k + 2] - bb) * amt;
        }
      }
    } else if (this.op === 'smudge') {
      if (!this.carried || this.carried.length !== d.length) {
        this.carried = new Float32Array(d.length); for (let i = 0; i < d.length; i++) this.carried[i] = d[i];
      } else {
        const car = this.carried;
        for (let p = 0; p < w * h; p++) {
          const wt = weights[p] * s; const k = p * 4;
          for (let ch = 0; ch < 4; ch++) {
            const mixed = d[k + ch] + (car[k + ch] - d[k + ch]) * wt;
            car[k + ch] = car[k + ch] + (d[k + ch] - car[k + ch]) * (1 - s) * 0.5;
            d[k + ch] = mixed;
          }
        }
      }
    } else {
      const ex = s * 0.25;
      for (let p = 0; p < w * h; p++) {
        const wt = weights[p]; if (!wt) continue;
        const k = p * 4;
        const lum = (0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]) / 255;
        const rw = this.range === 'shadows' ? (1 - lum) ** 2 : this.range === 'highlights' ? lum * lum : 1 - Math.abs(lum - 0.5) * 2;
        const f = wt * ex * Math.max(0.05, rw);
        for (let ch = 0; ch < 3; ch++) d[k + ch] = this.op === 'dodge' ? d[k + ch] + (255 - d[k + ch]) * f : d[k + ch] * (1 - f);
      }
    }
    this.x.putImageData(img, x0, y0);
    const nr = { x: x0 + this.target.ox, y: y0 + this.target.oy, w, h }; const pd = this.dirty;
    this.dirty = pd ? { x: Math.min(pd.x, nr.x), y: Math.min(pd.y, nr.y), w: Math.max(pd.x + pd.w, nr.x + nr.w) - Math.min(pd.x, nr.x), h: Math.max(pd.y + pd.h, nr.y + nr.h) - Math.min(pd.y, nr.y) } : nr;
  }
}

export function fillColorRgb(hex: string) { return hexToRgb(hex); }
