import type { DocState } from '../types/document';
import { blobToCanvas, checkSize, createCanvas, ctx2d, loadImage, MAX_DIMENSION, MAX_PIXELS } from '../utils/canvas';
import { decodeTiff } from './tiff';
import { readPsd } from './psd';
import { deserializeProject, type ProjectFile } from './project';

export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'tif', 'tiff', 'avif', 'ico'];
export const OPEN_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.tif,.tiff,.avif,.ico,.psd,.dps,image/*';

export const ext = (name: string) => (name.split('.').pop() || '').toLowerCase();
export const baseName = (name: string) => name.replace(/\.[^.]+$/, '') || 'Untitled';

export type Imported =
  | { kind: 'image'; name: string; canvas: HTMLCanvasElement; warning?: string }
  | { kind: 'document'; name: string; state: DocState; warnings: string[]; projectId?: string };

function sniff(bytes: Uint8Array): string | null {
  const s = (o: number, n: number) => String.fromCharCode(...bytes.subarray(o, o + n));
  if (bytes[0] === 0x89 && s(1, 3) === 'PNG') return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'webp';
  if (s(0, 3) === 'GIF') return 'gif';
  if (s(0, 2) === 'BM') return 'bmp';
  if (s(0, 4) === '8BPS') return 'psd';
  if ((bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4d && bytes[1] === 0x4d)) return 'tiff';
  if (s(0, 1) === '{') return 'dps';
  if (/<svg|<\?xml/i.test(s(0, Math.min(256, bytes.length)))) return 'svg';
  return null;
}

/** Downscales images that exceed the editor's limits, returning a warning. */
function fitLimits(c: HTMLCanvasElement): { canvas: HTMLCanvasElement; warning?: string } {
  const k = Math.min(1, MAX_DIMENSION / c.width, MAX_DIMENSION / c.height, Math.sqrt(MAX_PIXELS / (c.width * c.height)));
  if (k >= 1) return { canvas: c };
  const out = createCanvas(Math.floor(c.width * k), Math.floor(c.height * k));
  const x = ctx2d(out); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, out.width, out.height);
  return { canvas: out, warning: `Image was larger than ${MAX_DIMENSION}px and was scaled to ${out.width}×${out.height}.` };
}

async function svgToCanvas(text: string): Promise<HTMLCanvasElement> {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== 'svg') throw new Error('Invalid SVG file.');
  let w = parseFloat(svg.getAttribute('width') || ''), h = parseFloat(svg.getAttribute('height') || '');
  const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  if ((!w || !h) && vb.length === 4) { w = w || vb[2]; h = h || vb[3]; }
  if (!w || !h) { w = 1024; h = 1024; }
  // rasterize crisply: at least 1024px on the long side
  const scale = Math.max(1, 1024 / Math.max(w, h));
  svg.setAttribute('width', String(w * scale)); svg.setAttribute('height', String(h * scale));
  if (vb.length !== 4) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const c = createCanvas(Math.round(w * scale), Math.round(h * scale));
    ctx2d(c).drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

/** Reads any supported file. Throws user-readable errors. */
export async function readFile(file: File): Promise<Imported> {
  if (file.size === 0) throw new Error(`"${file.name}" is empty.`);
  if (file.size > 1024 * 1024 * 1024) throw new Error(`"${file.name}" is too large to open in the browser.`);
  let buf: ArrayBuffer;
  try { buf = await file.arrayBuffer(); } catch { throw new Error(`Unable to read "${file.name}".`); }
  const bytes = new Uint8Array(buf);
  const kind = sniff(bytes) ?? ext(file.name);
  const name = baseName(file.name);
  try {
    if (kind === 'psd') { const r = await readPsd(buf); return { kind: 'document', name, state: r.state, warnings: r.warnings }; }
    if (kind === 'dps' || ext(file.name) === 'dps') {
      const json = JSON.parse(new TextDecoder().decode(bytes)) as ProjectFile;
      const r = await deserializeProject(json);
      return { kind: 'document', name: json.name || name, state: r, warnings: [] };
    }
    if (kind === 'tiff' || kind === 'tif') {
      const img = await decodeTiff(buf);
      const c = createCanvas(img.width, img.height); ctx2d(c).putImageData(img, 0, 0);
      return { kind: 'image', name, ...fitLimits(c) };
    }
    if (kind === 'svg') return { kind: 'image', name, ...fitLimits(await svgToCanvas(new TextDecoder().decode(bytes))) };
    if (!['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'ico'].includes(kind)) throw new Error('Unsupported file format.');
    const c = await blobToCanvas(new Blob([buf], { type: file.type || `image/${kind}` }));
    const res = fitLimits(c);
    const err = checkSize(res.canvas.width, res.canvas.height);
    if (err) throw new Error(err);
    return { kind: 'image', name, ...res, warning: res.warning ?? (kind === 'gif' ? 'Animated GIFs open as their first frame.' : undefined) };
  } catch (e) {
    console.warn(`Import failed for ${file.name}:`, e);
    const msg = e instanceof Error ? e.message : String(e);
    if (/unsupported|not supported|too large|empty/i.test(msg)) throw new Error(msg);
    throw new Error(`Unable to open "${file.name}". The file may be corrupted or in an unsupported format.`);
  }
}

export function isImportable(file: File) {
  const e = ext(file.name);
  return IMAGE_EXT.includes(e) || e === 'psd' || e === 'dps' || file.type.startsWith('image/');
}
