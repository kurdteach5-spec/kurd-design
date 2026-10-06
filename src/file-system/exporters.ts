import type { DocState, Layer, ShapeLayer, TextLayer } from '../types/document';
import { renderDocument, sharedCompositor } from '../canvas/compositor';
import { canvasToBlob, createCanvas, ctx2d } from '../utils/canvas';
import { allLayers } from '../layers/tree';
import { shapePath, geometryLocalBounds, polygonPoints } from '../canvas/shapeRender';
import { layoutText, transformText } from '../canvas/textRender';
import { fontStack } from '../utils/fonts';
import { deg2rad } from '../utils/math';

export type ExportFormat = 'png' | 'jpg' | 'webp' | 'svg' | 'pdf' | 'psd';
export interface ExportOptions { format: ExportFormat; quality: number; width: number; height: number; dpi: number; transparent: boolean; background: string }

/** Final flattened image at the requested size. */
export function flatten(state: DocState, o: Pick<ExportOptions, 'width' | 'height' | 'transparent' | 'background'>): HTMLCanvasElement {
  const full = renderDocument(state);
  const out = createCanvas(o.width, o.height); const x = ctx2d(out);
  if (!o.transparent) { x.fillStyle = o.background; x.fillRect(0, 0, o.width, o.height); }
  x.imageSmoothingQuality = 'high';
  if (o.width < full.width / 2 || o.height < full.height / 2) {
    // step down for quality when shrinking a lot
    let src: HTMLCanvasElement = full;
    while (src.width / 2 > o.width && src.height / 2 > o.height) {
      const half = createCanvas(Math.ceil(src.width / 2), Math.ceil(src.height / 2)); const hx = ctx2d(half); hx.imageSmoothingQuality = 'high'; hx.drawImage(src, 0, 0, half.width, half.height); src = half;
    }
    x.drawImage(src, 0, 0, o.width, o.height);
  } else x.drawImage(full, 0, 0, o.width, o.height);
  return out;
}

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** Writes the resolution into PNG (pHYs) / JPEG (JFIF density) metadata. */
async function withDpi(blob: Blob, format: string, dpi: number): Promise<Blob> {
  try {
    const b = new Uint8Array(await blob.arrayBuffer());
    if (format === 'png') {
      const ppm = Math.round(dpi / 0.0254);
      const chunk = new Uint8Array(21); const dv = new DataView(chunk.buffer);
      dv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4); dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
      dv.setUint32(17, crc32(chunk.subarray(4, 17)));
      const ihdrEnd = 8 + 25;
      return new Blob([b.subarray(0, ihdrEnd), chunk, b.subarray(ihdrEnd)], { type: 'image/png' });
    }
    if (format === 'jpg' && b[2] === 0xff && b[3] === 0xe0 && String.fromCharCode(b[6], b[7], b[8], b[9]) === 'JFIF') {
      b[13] = 1; b[14] = dpi >> 8; b[15] = dpi & 255; b[16] = dpi >> 8; b[17] = dpi & 255;
      return new Blob([b], { type: 'image/jpeg' });
    }
  } catch { /* metadata is best effort */ }
  return blob;
}

export async function exportRaster(state: DocState, o: ExportOptions): Promise<Blob> {
  const mime = o.format === 'jpg' ? 'image/jpeg' : o.format === 'webp' ? 'image/webp' : 'image/png';
  const c = flatten(state, { ...o, transparent: o.format === 'jpg' ? false : o.transparent });
  const blob = await canvasToBlob(c, mime, o.quality);
  if (o.format === 'webp' && blob.type !== 'image/webp') throw new Error('This browser cannot encode WEBP images.');
  return withDpi(blob, o.format, o.dpi);
}

// ---------------- PDF ----------------
export async function exportPdf(state: DocState, o: ExportOptions): Promise<Blob> {
  const c = flatten(state, { ...o, transparent: false });
  const jpeg = new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', Math.max(0.5, o.quality))).arrayBuffer());
  const wPt = (state.width / state.dpi) * 72, hPt = (state.height / state.dpi) * 72;
  const enc = new TextEncoder();
  const parts: Uint8Array[] = []; const offsets: number[] = []; let len = 0;
  const push = (s: string | Uint8Array) => { const b = typeof s === 'string' ? enc.encode(s) : s; parts.push(b); len += b.length; };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const obj = (n: number, body: string | (() => void)) => { offsets[n] = len; push(`${n} 0 obj\n`); if (typeof body === 'string') push(body); else body(); push('\nendobj\n'); };
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt.toFixed(2)} ${hPt.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, () => { push(`<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`); push(jpeg); push('\nendstream'); });
  const content = `q ${wPt.toFixed(2)} 0 0 ${hPt.toFixed(2)} 0 0 cm /Im0 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = len;
  let x = `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) x += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(x + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}

// ---------------- SVG ----------------
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mat = (m: { a: number; b: number; c: number; d: number; e: number; f: number }) => `matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].map((v) => +v.toFixed(5)).join(' ')})`;

function pathData(l: ShapeLayer): string {
  const g = l.geometry;
  const n = (v: number) => +v.toFixed(3);
  if (g.kind === 'rect') {
    const r = Math.min(g.radius, g.width / 2, g.height / 2), w = g.width, h = g.height;
    if (r <= 0) return `M0 0H${n(w)}V${n(h)}H0Z`;
    return `M${n(r)} 0H${n(w - r)}A${n(r)} ${n(r)} 0 0 1 ${n(w)} ${n(r)}V${n(h - r)}A${n(r)} ${n(r)} 0 0 1 ${n(w - r)} ${n(h)}H${n(r)}A${n(r)} ${n(r)} 0 0 1 0 ${n(h - r)}V${n(r)}A${n(r)} ${n(r)} 0 0 1 ${n(r)} 0Z`;
  }
  if (g.kind === 'ellipse') { const rx = g.width / 2, ry = g.height / 2; return `M0 ${n(ry)}A${n(rx)} ${n(ry)} 0 1 0 ${n(g.width)} ${n(ry)}A${n(rx)} ${n(ry)} 0 1 0 0 ${n(ry)}Z`; }
  if (g.kind === 'polygon' || g.kind === 'star') return polygonPoints(g).map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join('') + 'Z';
  let d = '';
  g.nodes.forEach((p, i) => {
    if (!i) { d += `M${n(p.x)} ${n(p.y)}`; return; }
    const a = g.nodes[i - 1]; d += `C${n(a.outX)} ${n(a.outY)} ${n(p.inX)} ${n(p.inY)} ${n(p.x)} ${n(p.y)}`;
  });
  if (g.kind === 'path' && g.closed && g.nodes.length > 2) { const a = g.nodes[g.nodes.length - 1], p = g.nodes[0]; d += `C${n(a.outX)} ${n(a.outY)} ${n(p.inX)} ${n(p.inY)} ${n(p.x)} ${n(p.y)}Z`; }
  return d;
}

function canBeVector(l: Layer) {
  const fx = l.effects.dropShadow.enabled || l.effects.outerGlow.enabled || l.effects.stroke.enabled;
  return !l.mask && !l.vectorMask && !fx && !l.clipped;
}

/** Exports vector layers as SVG elements; pixel content is embedded as PNG images. */
export async function exportSvg(state: DocState, o: ExportOptions): Promise<Blob> {
  const defs: string[] = []; const body: string[] = [];
  const W = state.width, H = state.height;
  const dataUrl = async (c: HTMLCanvasElement) => { const b = await canvasToBlob(c, 'image/png'); return await new Promise<string>((r) => { const f = new FileReader(); f.onload = () => r(String(f.result)); f.readAsDataURL(b); }); };
  // anything up to the topmost adjustment layer must be flattened (adjustments affect pixels below)
  const flat = allLayers(state.layers);
  const lastAdj = state.layers.map((l) => l.type === 'adjustment' || (l.type === 'group' && allLayers(l.children).some((c) => c.type === 'adjustment'))).lastIndexOf(true);
  if (lastAdj >= 0) {
    const below = { ...state, layers: state.layers.slice(0, lastAdj + 1) };
    body.push(`<image width="${W}" height="${H}" href="${await dataUrl(renderDocument(below))}"/>`);
  }
  let gid = 0;
  const emit = async (layers: Layer[], out: string[]) => {
    for (const l of layers) {
      if (!l.visible || l.type === 'adjustment') continue;
      const style = `${l.opacity < 1 ? ` opacity="${+l.opacity.toFixed(3)}"` : ''}${l.blendMode !== 'normal' && l.blendMode !== 'pass-through' ? ` style="mix-blend-mode:${l.blendMode}"` : ''}`;
      if (l.type === 'group') { const inner: string[] = []; await emit(l.children, inner); out.push(`<g id="${esc(l.name)}"${style}>${inner.join('')}</g>`); continue; }
      if (!canBeVector(l) || l.type === 'raster') {
        const c = sharedCompositor.renderLayer(state, l);
        out.push(`<image id="${esc(l.name)}" width="${W}" height="${H}" href="${await dataUrl(c)}"${style}/>`);
        continue;
      }
      if (l.type === 'shape') {
        let fill = 'none';
        const f = l.fill;
        if (f.type === 'solid') fill = f.color;
        else if (f.type === 'linear' || f.type === 'radial') {
          const id = `g${gid++}`; const b = geometryLocalBounds(l.geometry);
          const stops = f.stops.map((s) => `<stop offset="${s.offset}" stop-color="${s.color}" stop-opacity="${s.opacity}"/>`).join('');
          if (f.type === 'radial') defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${b.x + b.w / 2}" cy="${b.y + b.h / 2}" r="${Math.max(b.w, b.h) / 2}">${stops}</radialGradient>`);
          else { const a = deg2rad(f.angle); const cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = Math.cos(a), dy = -Math.sin(a); const half = (Math.abs(b.w * dx) + Math.abs(b.h * dy)) / 2; defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${cx - dx * half}" y1="${cy - dy * half}" x2="${cx + dx * half}" y2="${cy + dy * half}">${stops}</linearGradient>`); }
          fill = `url(#${id})`;
        }
        if (l.geometry.kind === 'line') fill = 'none';
        const s = l.stroke;
        const stroke = s.enabled ? ` stroke="${s.color}" stroke-width="${s.width}" stroke-linejoin="round"${s.dash === 'dashed' ? ` stroke-dasharray="${s.width * 3} ${s.width * 2}"` : s.dash === 'dotted' ? ` stroke-dasharray="0.01 ${s.width * 2}" stroke-linecap="round"` : ''}` : '';
        out.push(`<path id="${esc(l.name)}" transform="${mat(l.transform)}" d="${pathData(l)}" fill="${fill}"${l.fillOpacity < 1 ? ` fill-opacity="${l.fillOpacity}"` : ''}${stroke}${style}/>`);
        void shapePath;
        continue;
      }
      const t = l as TextLayer; const st = t.style; const L = layoutText(t);
      const anchor = st.align === 'center' ? 'middle' : st.align === 'right' ? 'end' : 'start';
      const tx = st.align === 'center' ? L.width / 2 : st.align === 'right' ? L.width : 0;
      const tspans = L.lines.map((ln) => `<tspan x="${tx}" y="${+ln.baseline.toFixed(2)}">${esc(ln.text)}</tspan>`).join('');
      const deco = [st.underline && 'underline', st.strikethrough && 'line-through'].filter(Boolean).join(' ');
      out.push(`<text id="${esc(t.name)}" transform="${mat(t.transform)}" font-family='${esc(fontStack(st.fontFamily))}' font-size="${st.fontSize}" font-weight="${st.fontWeight}"${st.italic ? ' font-style="italic"' : ''} fill="${st.color}"${st.textOpacity < 1 ? ` fill-opacity="${st.textOpacity}"` : ''} text-anchor="${anchor}"${st.letterSpacing ? ` letter-spacing="${st.letterSpacing}"` : ''}${deco ? ` text-decoration="${deco}"` : ''}${st.stroke.enabled ? ` stroke="${st.stroke.color}" stroke-width="${st.stroke.width * 2}" paint-order="stroke"` : ''}${style}>${tspans}</text>`);
      void transformText;
    }
  };
  await emit(lastAdj >= 0 ? state.layers.slice(lastAdj + 1) : state.layers, body);
  void flat;
  const bg = !o.transparent ? `<rect width="${W}" height="${H}" fill="${o.background}"/>` : '';
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${o.width}" height="${o.height}" viewBox="0 0 ${W} ${H}">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${bg}${body.join('')}</svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

type DownloadsNs = { save: (r: { filename: string; data: Blob }) => Promise<{ status: string }> };
type HostClaude = { use?: (name: string) => Promise<unknown> };

/**
 * Saves a blob through the browser's download flow. When the editor runs inside a
 * host that blocks direct downloads but offers a save capability (an embedded
 * claude.ai artifact), the host's confirmed save is used instead.
 */
export async function saveBlob(blob: Blob, filename: string): Promise<boolean> {
  const host = (window as unknown as { claude?: HostClaude }).claude;
  if (host?.use) {
    let downloads: DownloadsNs | null = null;
    try { downloads = (await host.use('downloads')) as DownloadsNs | null; } catch { downloads = null; }
    if (downloads) {
      try { await downloads.save({ filename, data: blob }); return true; }
      catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === 'declined') return false;
        if (code === 'rejected_extension' || code === 'extension_not_enabled') throw new Error(`.${filename.split('.').pop()} files can't be saved here. Use the full app to export this format.`);
        if (code === 'rate_limited') throw new Error('A save is already waiting for confirmation.');
        throw new Error('Saving files is unavailable here.');
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
