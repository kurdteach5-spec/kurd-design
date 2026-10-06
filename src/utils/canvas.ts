import type { Rect } from './math';

export type Canvas = HTMLCanvasElement;
export const MAX_DIMENSION = 16384;
export const MAX_PIXELS = 16384 * 16384 / 2; // ~134 MP keeps memory sane across browsers

export function createCanvas(w: number, h: number): Canvas {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: Canvas, readFrequently = false): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', readFrequently ? { willReadFrequently: true } : undefined);
  if (!ctx) throw new Error('Canvas 2D context unavailable (out of memory?)');
  return ctx;
}

export function cloneCanvas(src: Canvas): Canvas {
  const c = createCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

export function filledCanvas(w: number, h: number, color: string): Canvas {
  const c = createCanvas(w, h);
  const x = ctx2d(c); x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  return c;
}

export function checkSize(w: number, h: number): string | null {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return 'Dimensions must be at least 1 pixel.';
  if (w > MAX_DIMENSION || h > MAX_DIMENSION) return `Maximum dimension is ${MAX_DIMENSION} px.`;
  if (w * h > MAX_PIXELS) return 'This image is too large to edit in the browser.';
  return null;
}

const boundsCache = new WeakMap<Canvas, Rect | null>();
/** Bounding box of non-transparent pixels (cached; canvases are treated as immutable once committed). */
export function contentBounds(c: Canvas, useCache = true): Rect | null {
  if (useCache && boundsCache.has(c)) return boundsCache.get(c)!;
  const { width: w, height: h } = c;
  let data: Uint8ClampedArray;
  try { data = ctx2d(c, true).getImageData(0, 0, w, h).data; } catch { return { x: 0, y: 0, w, h }; }
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    let first = -1, last = -1;
    for (let x = 0; x < w; x++) if (data[row + x * 4 + 3]) { first = x; break; }
    if (first < 0) continue;
    for (let x = w - 1; x >= first; x--) if (data[row + x * 4 + 3]) { last = x; break; }
    if (y < y0) y0 = y; y1 = y;
    if (first < x0) x0 = first; if (last > x1) x1 = last;
  }
  const r = x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  if (useCache) boundsCache.set(c, r);
  return r;
}

let filterSupport: boolean | null = null;
export function supportsCtxFilter(): boolean {
  if (filterSupport !== null) return filterSupport;
  try {
    const c = createCanvas(4, 4); const x = ctx2d(c);
    x.filter = 'blur(1px)';
    filterSupport = x.filter === 'blur(1px)';
  } catch { filterSupport = false; }
  return filterSupport;
}

/** Gaussian-ish blur of a canvas (returns new canvas). Uses GPU ctx.filter when available. */
export function blurCanvas(src: Canvas, radius: number): Canvas {
  const out = createCanvas(src.width, src.height);
  const x = ctx2d(out);
  if (radius <= 0) { x.drawImage(src, 0, 0); return out; }
  if (supportsCtxFilter()) {
    x.filter = `blur(${radius / 2}px)`;
    x.drawImage(src, 0, 0);
    x.filter = 'none';
    return out;
  }
  x.drawImage(src, 0, 0);
  const img = x.getImageData(0, 0, out.width, out.height);
  boxBlurRGBA(img.data, out.width, out.height, Math.max(1, Math.round(radius / 2)));
  x.putImageData(img, 0, 0);
  return out;
}

/** 3-pass box blur approximating gaussian, premultiplied to avoid dark halos. */
export function boxBlurRGBA(d: Uint8ClampedArray, w: number, h: number, r: number) {
  const n = w * h; const f = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3] / 255;
    f[i * 4] = d[i * 4] * a; f[i * 4 + 1] = d[i * 4 + 1] * a; f[i * 4 + 2] = d[i * 4 + 2] * a; f[i * 4 + 3] = d[i * 4 + 3];
  }
  const tmp = new Float32Array(n * 4);
  for (let pass = 0; pass < 3; pass++) { blurH(f, tmp, w, h, r); blurV(tmp, f, w, h, r); }
  for (let i = 0; i < n; i++) {
    const a = f[i * 4 + 3]; const k = a > 0 ? 255 / a : 0;
    d[i * 4] = f[i * 4] * k; d[i * 4 + 1] = f[i * 4 + 1] * k; d[i * 4 + 2] = f[i * 4 + 2] * k; d[i * 4 + 3] = a;
  }
}
function blurH(s: Float32Array, t: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    for (let ch = 0; ch < 4; ch++) {
      const row = y * w;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += s[(row + Math.min(w - 1, Math.max(0, k))) * 4 + ch];
      for (let x = 0; x < w; x++) {
        t[(row + x) * 4 + ch] = acc * iarr;
        const add = Math.min(w - 1, x + r + 1), sub = Math.max(0, x - r);
        acc += s[(row + add) * 4 + ch] - s[(row + sub) * 4 + ch];
      }
    }
  }
}
function blurV(s: Float32Array, t: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) {
    for (let ch = 0; ch < 4; ch++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += s[(Math.min(h - 1, Math.max(0, k)) * w + x) * 4 + ch];
      for (let y = 0; y < h; y++) {
        t[(y * w + x) * 4 + ch] = acc * iarr;
        const add = Math.min(h - 1, y + r + 1), sub = Math.max(0, y - r);
        acc += s[(add * w + x) * 4 + ch] - s[(sub * w + x) * 4 + ch];
      }
    }
  }
}

export function canvasToBlob(c: Canvas, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed'))), type, quality);
    } catch (e) { reject(e); }
  });
}

export async function blobToCanvas(blob: Blob): Promise<Canvas> {
  let bmp: ImageBitmap | null = null;
  try { bmp = await createImageBitmap(blob); } catch { bmp = null; }
  if (bmp) {
    const c = createCanvas(bmp.width, bmp.height);
    ctx2d(c).drawImage(bmp, 0, 0); bmp.close?.();
    return c;
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const c = createCanvas(img.naturalWidth || 300, img.naturalHeight || 150);
    ctx2d(c).drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unable to decode image'));
    img.src = src;
  });
}

export const canvasBytes = (c: Canvas) => c.width * c.height * 4;

/** Draws a checkerboard pattern for transparency. */
let checkerPattern: { pattern: CanvasPattern; ctx: CanvasRenderingContext2D } | null = null;
export function checker(ctx: CanvasRenderingContext2D): CanvasPattern | string {
  if (checkerPattern && checkerPattern.ctx === ctx) return checkerPattern.pattern;
  const c = createCanvas(16, 16); const x = ctx2d(c);
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 16, 16);
  x.fillStyle = '#d6d9de'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
  const p = ctx.createPattern(c, 'repeat');
  if (!p) return '#ffffff';
  checkerPattern = { pattern: p, ctx };
  return p;
}
