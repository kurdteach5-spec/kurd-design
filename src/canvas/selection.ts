import type { Selection } from '../types/document';
import type { SelectionMode } from '../state/toolStore';
import { blurCanvas, contentBounds, createCanvas, ctx2d } from '../utils/canvas';
import { dilate } from './effects';
import type { Rect } from '../utils/math';

/** Builds a selection mask by drawing a path filled with opaque black. */
export function maskFromDraw(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void, feather = 0): HTMLCanvasElement {
  let c = createCanvas(w, h); const x = ctx2d(c);
  x.fillStyle = '#000'; draw(x);
  if (feather > 0) c = blurCanvas(c, feather);
  return c;
}

export function makeSelection(mask: HTMLCanvasElement): Selection | null {
  const b = contentBounds(mask);
  if (!b) return null;
  return { mask, bounds: b };
}

export function combineSelection(prev: Selection | null, mask: HTMLCanvasElement, mode: SelectionMode): Selection | null {
  if (!prev) return mode === 'subtract' || mode === 'intersect' ? null : makeSelection(mask);
  if (mode === 'new') return makeSelection(mask);
  const out = createCanvas(mask.width, mask.height); const x = ctx2d(out);
  x.drawImage(prev.mask, 0, 0);
  x.globalCompositeOperation = mode === 'add' ? 'source-over' : mode === 'subtract' ? 'destination-out' : 'destination-in';
  x.drawImage(mask, 0, 0);
  return makeSelection(out);
}

export function selectAll(w: number, h: number): Selection {
  return { mask: maskFromDraw(w, h, (x) => x.fillRect(0, 0, w, h)), bounds: { x: 0, y: 0, w, h } };
}

export function invertSelection(sel: Selection | null, w: number, h: number): Selection | null {
  const c = createCanvas(w, h); const x = ctx2d(c);
  x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
  if (sel) { x.globalCompositeOperation = 'destination-out'; x.drawImage(sel.mask, 0, 0); }
  return makeSelection(c);
}

export function featherSelection(sel: Selection, r: number): Selection | null { return makeSelection(blurCanvas(sel.mask, r)); }

export function expandSelection(sel: Selection, r: number): Selection | null { return makeSelection(dilate(sel.mask, r)); }

export function contractSelection(sel: Selection, r: number, w: number, h: number): Selection | null {
  const inv = invertSelection(sel, w, h);
  if (!inv) return sel;
  const grown = dilate(inv.mask, r);
  // also contract from document edges
  const gx = ctx2d(grown); gx.fillStyle = '#000';
  gx.fillRect(0, 0, w, r); gx.fillRect(0, h - r, w, r); gx.fillRect(0, 0, r, h); gx.fillRect(w - r, 0, r, h);
  const out = createCanvas(w, h); const x = ctx2d(out);
  x.drawImage(sel.mask, 0, 0); x.globalCompositeOperation = 'destination-out'; x.drawImage(grown, 0, 0);
  return makeSelection(out);
}

export function borderSelection(sel: Selection, r: number, w: number, h: number): Selection | null {
  const outer = dilate(sel.mask, r / 2);
  const inner = contractSelection(sel, Math.max(1, r / 2), w, h);
  const x = ctx2d(outer);
  if (inner) { x.globalCompositeOperation = 'destination-out'; x.drawImage(inner.mask, 0, 0); }
  return makeSelection(outer);
}

/** Transforms the selection mask by a document-space matrix. */
export function transformSelection(sel: Selection, m: DOMMatrix2DInit, w: number, h: number): Selection | null {
  const c = createCanvas(w, h); const x = ctx2d(c);
  x.setTransform(m.a!, m.b!, m.c!, m.d!, m.e!, m.f!); x.drawImage(sel.mask, 0, 0);
  return makeSelection(c);
}

export function selectionFromAlpha(src: HTMLCanvasElement, transform: DOMMatrix2DInit, w: number, h: number): Selection | null {
  const c = createCanvas(w, h); const x = ctx2d(c);
  x.setTransform(transform.a!, transform.b!, transform.c!, transform.d!, transform.e!, transform.f!);
  x.drawImage(src, 0, 0);
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'source-in'; x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
  return makeSelection(c);
}

/** Selection alpha as a byte array (0..255) for pixel operations. */
export function selectionAlpha(sel: Selection): Uint8Array {
  const d = ctx2d(sel.mask, true).getImageData(0, 0, sel.mask.width, sel.mask.height).data;
  const out = new Uint8Array(d.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3];
  return out;
}

const outlineCache = new WeakMap<HTMLCanvasElement, Path2D>();
/** Pixel-edge outline of a selection mask (for marching ants). */
export function selectionOutline(sel: Selection): Path2D {
  const hit = outlineCache.get(sel.mask); if (hit) return hit;
  const { mask, bounds: b } = sel;
  const W = mask.width, H = mask.height;
  const x0 = Math.max(0, Math.floor(b.x) - 1), y0 = Math.max(0, Math.floor(b.y) - 1);
  const x1 = Math.min(W, Math.ceil(b.x + b.w) + 1), y1 = Math.min(H, Math.ceil(b.y + b.h) + 1);
  const bw = x1 - x0, bh = y1 - y0;
  // downsample very large masks so outline generation stays fast
  const step = Math.max(1, Math.ceil(Math.sqrt((bw * bh) / 4_000_000)));
  const d = ctx2d(mask, true).getImageData(x0, y0, bw, bh).data;
  const cols = Math.ceil(bw / step), rows = Math.ceil(bh / step);
  const inside = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) inside[r * cols + q] = d[((r * step) * bw + q * step) * 4 + 3] >= 128 ? 1 : 0;
  const at = (q: number, r: number) => (q < 0 || r < 0 || q >= cols || r >= rows ? 0 : inside[r * cols + q]);
  const p = new Path2D();
  // horizontal edges
  for (let r = 0; r <= rows; r++) {
    let start = -1;
    for (let q = 0; q <= cols; q++) {
      const edge = q < cols && at(q, r) !== at(q, r - 1);
      if (edge && start < 0) start = q;
      if (!edge && start >= 0) { p.moveTo(x0 + start * step, y0 + r * step); p.lineTo(x0 + q * step, y0 + r * step); start = -1; }
    }
  }
  for (let q = 0; q <= cols; q++) {
    let start = -1;
    for (let r = 0; r <= rows; r++) {
      const edge = r < rows && at(q, r) !== at(q - 1, r);
      if (edge && start < 0) start = r;
      if (!edge && start >= 0) { p.moveTo(x0 + q * step, y0 + start * step); p.lineTo(x0 + q * step, y0 + r * step); start = -1; }
    }
  }
  outlineCache.set(sel.mask, p);
  return p;
}

/** Scanline flood fill; returns a 0/255 mask of matching pixels. */
export function floodMask(data: Uint8ClampedArray, w: number, h: number, sx: number, sy: number, tolerance: number, contiguous: boolean): Uint8Array {
  const out = new Uint8Array(w * h);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return out;
  const i0 = (sy * w + sx) * 4;
  const r0 = data[i0], g0 = data[i0 + 1], b0 = data[i0 + 2], a0 = data[i0 + 3];
  const tol = tolerance;
  const match = (p: number) => {
    const i = p * 4;
    if (a0 === 0 && data[i + 3] === 0) return true;
    return Math.abs(data[i] - r0) <= tol && Math.abs(data[i + 1] - g0) <= tol && Math.abs(data[i + 2] - b0) <= tol && Math.abs(data[i + 3] - a0) <= tol;
  };
  if (!contiguous) { for (let p = 0; p < w * h; p++) if (match(p)) out[p] = 255; return out; }
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!, x = stack.pop()!;
    if (out[y * w + x] || !match(y * w + x)) continue;
    let lx = x; while (lx > 0 && !out[y * w + lx - 1] && match(y * w + lx - 1)) lx--;
    let rx = x; while (rx < w - 1 && !out[y * w + rx + 1] && match(y * w + rx + 1)) rx++;
    for (let i = lx; i <= rx; i++) out[y * w + i] = 255;
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= h) continue;
      let i = lx;
      while (i <= rx) {
        while (i <= rx && (out[ny * w + i] || !match(ny * w + i))) i++;
        if (i > rx) break;
        stack.push(i, ny);
        while (i <= rx && !out[ny * w + i] && match(ny * w + i)) i++;
      }
    }
  }
  return out;
}

export function maskFromBytes(bytes: Uint8Array, w: number, h: number, antiAlias: boolean): HTMLCanvasElement {
  const c = createCanvas(w, h); const x = ctx2d(c);
  const img = x.createImageData(w, h); const d = img.data;
  for (let i = 0; i < bytes.length; i++) d[i * 4 + 3] = bytes[i];
  x.putImageData(img, 0, 0);
  if (antiAlias) {
    const s = createCanvas(w, h); const sx = ctx2d(s);
    if ('filter' in sx) { sx.filter = 'blur(0.5px)'; sx.drawImage(c, 0, 0); sx.filter = 'none'; return s; }
  }
  return c;
}

export function boundsIntersectsDoc(b: Rect, w: number, h: number) { return b.x < w && b.y < h && b.x + b.w > 0 && b.y + b.h > 0; }
