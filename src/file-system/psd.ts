import type { BlendMode, DocState, GroupLayer, Layer, LayerMask, TextLayer } from '../types/document';
import { createCanvas, ctx2d, contentBounds } from '../utils/canvas';
import { createGroup, createMask, createRasterLayer, createTextLayer, defaultTextStyle } from '../layers/factory';
import { emptyState } from '../state/documentStore';
import { renderDocument, sharedCompositor } from '../canvas/compositor';
import { translate } from '../utils/math';
import { allLayers } from '../layers/tree';
import { maskAlpha } from '../canvas/effects';
import { rgbToHex } from '../utils/color';

const BLEND_TO_KEY: Record<string, string> = {
  'normal': 'norm', 'multiply': 'mul ', 'screen': 'scrn', 'overlay': 'over', 'soft-light': 'sLit', 'hard-light': 'hLit',
  'darken': 'dark', 'lighten': 'lite', 'color-dodge': 'div ', 'color-burn': 'idiv', 'difference': 'diff', 'exclusion': 'smud',
  'hue': 'hue ', 'saturation': 'sat ', 'color': 'colr', 'luminosity': 'lum ', 'pass-through': 'pass',
};
const KEY_TO_BLEND: Record<string, BlendMode> = Object.fromEntries(Object.entries(BLEND_TO_KEY).map(([k, v]) => [v, k as BlendMode]));

// =====================================================================
// Reader
// =====================================================================
class Reader {
  o = 0;
  dv: DataView; u8: Uint8Array;
  constructor(readonly buf: ArrayBuffer) { this.dv = new DataView(buf); this.u8 = new Uint8Array(buf); }
  u8r() { return this.dv.getUint8(this.o++); }
  i16() { const v = this.dv.getInt16(this.o); this.o += 2; return v; }
  u16() { const v = this.dv.getUint16(this.o); this.o += 2; return v; }
  i32() { const v = this.dv.getInt32(this.o); this.o += 4; return v; }
  u32() { const v = this.dv.getUint32(this.o); this.o += 4; return v; }
  f64() { const v = this.dv.getFloat64(this.o); this.o += 8; return v; }
  sig() { let s = ''; for (let i = 0; i < 4; i++) s += String.fromCharCode(this.u8r()); return s; }
  bytes(n: number) { const b = this.u8.subarray(this.o, this.o + n); this.o += n; return b; }
  pascal(pad: number) { const n = this.u8r(); let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8r()); let total = n + 1; while (total % pad) { this.o++; total++; } return s; }
  unicode() { const n = this.u32(); let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.u16()); return s.replace(/\0+$/, ''); }
}

interface LayerRecord {
  top: number; left: number; bottom: number; right: number;
  channels: { id: number; length: number }[];
  blend: string; opacity: number; clipping: number; flags: number;
  name: string; sectionType: number; sectionBlend?: string;
  mask?: { top: number; left: number; bottom: number; right: number; defaultColor: number; flags: number };
  text?: { text: string; size: number; color: string; font: string; tx: number; ty: number; scale: number };
  data: Map<number, Uint8Array>;
}

function readDescriptor(r: Reader): Record<string, unknown> {
  r.unicode(); // name
  const idLen = r.u32(); if (idLen) r.bytes(idLen); else r.sig();
  const count = r.u32(); const out: Record<string, unknown> = {};
  for (let i = 0; i < count; i++) {
    const kl = r.u32(); const key = kl ? String.fromCharCode(...r.bytes(kl)) : r.sig();
    out[key.trim()] = readItem(r);
  }
  return out;
}
function readItem(r: Reader): unknown {
  const type = r.sig();
  switch (type) {
    case 'TEXT': return r.unicode();
    case 'long': return r.i32();
    case 'doub': return r.f64();
    case 'bool': return !!r.u8r();
    case 'UntF': r.sig(); return r.f64();
    case 'enum': { const l1 = r.u32(); if (l1) r.bytes(l1); else r.sig(); const l2 = r.u32(); return l2 ? String.fromCharCode(...r.bytes(l2)) : r.sig(); }
    case 'Objc': case 'GlbO': return readDescriptor(r);
    case 'VlLs': { const n = r.u32(); const list: unknown[] = []; for (let i = 0; i < n; i++) list.push(readItem(r)); return list; }
    case 'tdta': { const n = r.u32(); return r.bytes(n); }
    default: throw new Error(`Unsupported descriptor type ${type}`);
  }
}

function parseEngineData(bytes: Uint8Array) {
  let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  const size = Number(/\/FontSize ([\d.]+)/.exec(s)?.[1] ?? 24);
  const vals = /\/FillColor\s*<<\s*\/Type 1\s*\/Values \[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(s);
  const color = vals ? rgbToHex({ r: Number(vals[2]) * 255, g: Number(vals[3]) * 255, b: Number(vals[4]) * 255 }) : '#000000';
  let font = 'Arial';
  const nm = /\/Name \(\xfe\xff((?:[\s\S](?!\)))*[\s\S])\)/.exec(s);
  if (nm) { const raw = nm[1]; let f = ''; for (let i = 0; i + 1 < raw.length; i += 2) f += String.fromCharCode((raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1)); font = f.replace(/[-_](Regular|Bold|Italic|Light|Medium|Black|SemiBold|MT).*$/i, '').replace(/MT$/, '') || 'Arial'; }
  return { size, color, font };
}

function readLayerRecord(r: Reader): LayerRecord {
  const top = r.i32(), left = r.i32(), bottom = r.i32(), right = r.i32();
  const nch = r.u16(); const channels = [];
  for (let i = 0; i < nch; i++) channels.push({ id: r.i16(), length: r.u32() });
  if (r.sig() !== '8BIM') throw new Error('Corrupt layer record');
  const blend = r.sig(); const opacity = r.u8r(); const clipping = r.u8r(); const flags = r.u8r(); r.u8r();
  const extraLen = r.u32(); const extraEnd = r.o + extraLen;
  const rec: LayerRecord = { top, left, bottom, right, channels, blend, opacity, clipping, flags, name: '', sectionType: 0, data: new Map() };
  const maskLen = r.u32(); const maskEnd = r.o + maskLen;
  if (maskLen >= 18) rec.mask = { top: r.i32(), left: r.i32(), bottom: r.i32(), right: r.i32(), defaultColor: r.u8r(), flags: r.u8r() };
  r.o = maskEnd;
  const rangesLen = r.u32(); r.o += rangesLen;
  rec.name = r.pascal(4);
  while (r.o + 12 <= extraEnd) {
    const sig = r.sig(); if (sig !== '8BIM' && sig !== '8B64') break;
    const key = r.sig(); const len = r.u32(); const start = r.o;
    try {
      if (key === 'luni') rec.name = r.unicode();
      else if (key === 'lsct' || key === 'lsdk') { rec.sectionType = r.u32(); if (len >= 12) { r.sig(); rec.sectionBlend = r.sig(); } }
      else if (key === 'TySh') {
        r.u16(); const xx = r.f64(); r.f64(); r.f64(); const yy = r.f64(); const tx = r.f64(); const ty = r.f64();
        r.u16(); r.u32();
        const desc = readDescriptor(r);
        const ed = desc['EngineData'] instanceof Uint8Array ? parseEngineData(desc['EngineData'] as Uint8Array) : { size: 24, color: '#000000', font: 'Arial' };
        const text = String(desc['Txt'] ?? '').replace(/\r/g, '\n');
        rec.text = { text, size: ed.size, color: ed.color, font: ed.font, tx, ty, scale: Math.abs(yy || xx || 1) };
      }
    } catch { /* ignore malformed additional info */ }
    r.o = start + len + (len % 2 && key !== 'luni' ? 0 : 0);
    r.o = start + len;
  }
  r.o = extraEnd;
  return rec;
}

function readChannelData(r: Reader, w: number, h: number, length: number): Uint8Array {
  const start = r.o;
  const comp = r.u16();
  let out = new Uint8Array(w * h);
  if (w * h === 0) { r.o = start + length; return out; }
  if (comp === 0) out = new Uint8Array(r.bytes(w * h));
  else if (comp === 1) {
    const counts: number[] = []; for (let i = 0; i < h; i++) counts.push(r.u16());
    let o = 0;
    for (let row = 0; row < h; row++) {
      const end = r.o + counts[row];
      while (r.o < end && o < (row + 1) * w) {
        const n = (r.u8r() << 24) >> 24;
        if (n >= 0) { for (let k = 0; k <= n; k++) out[o++] = r.u8r(); }
        else if (n !== -128) { const v = r.u8r(); for (let k = 0; k < 1 - n; k++) out[o++] = v; }
      }
      r.o = end; o = (row + 1) * w;
    }
  }
  r.o = start + length;
  return out;
}

function planesToCanvas(w: number, h: number, planes: Map<number, Uint8Array>, gray = false): HTMLCanvasElement {
  const c = createCanvas(w, h); const x = ctx2d(c);
  if (!w || !h) return c;
  const img = x.createImageData(w, h); const d = img.data;
  const R = planes.get(0), G = planes.get(1) ?? R, B = planes.get(2) ?? R, A = planes.get(-1);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = R?.[i] ?? 0; d[i * 4 + 1] = (gray ? R : G)?.[i] ?? 0; d[i * 4 + 2] = (gray ? R : B)?.[i] ?? 0; d[i * 4 + 3] = A ? A[i] : 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}

export async function readPsd(buf: ArrayBuffer): Promise<{ state: DocState; warnings: string[] }> {
  const r = new Reader(buf);
  const warnings: string[] = [];
  if (r.sig() !== '8BPS') throw new Error('Not a PSD file');
  const version = r.u16(); if (version !== 1) throw new Error('Large documents (PSB) are not supported');
  r.o += 6;
  const channels = r.u16(); const height = r.u32(); const width = r.u32(); const depth = r.u16(); const mode = r.u16();
  if (depth !== 8) throw new Error(`Only 8-bit PSD files are supported (this file is ${depth}-bit)`);
  if (mode !== 3 && mode !== 1) throw new Error('Only RGB and Grayscale PSD files are supported');
  const gray = mode === 1;
  const cmLen = r.u32(); r.o += cmLen; // color mode data
  // image resources: read resolution if present
  let dpi = 72;
  const resLen = r.u32(); const resEnd = r.o + resLen;
  while (r.o < resEnd - 12) {
    if (r.sig() !== '8BIM') break;
    const id = r.u16(); r.pascal(2); const len = r.u32(); const st = r.o;
    if (id === 1005) dpi = Math.round(r.u32() / 65536) || 72;
    r.o = st + len + (len % 2);
  }
  r.o = resEnd;
  const state = emptyState(width, height, dpi, gray ? 'grayscale' : 'rgb');
  const lmLen = r.u32(); const lmEnd = r.o + lmLen;
  const records: LayerRecord[] = [];
  if (lmLen > 0) {
    const liLen = r.u32(); const liEnd = r.o + liLen;
    if (liLen > 0) {
      const count = Math.abs(r.i16());
      for (let i = 0; i < count; i++) records.push(readLayerRecord(r));
      for (const rec of records) {
        const w = rec.right - rec.left, h = rec.bottom - rec.top;
        for (const ch of rec.channels) {
          if (ch.id === -2 && rec.mask) {
            const mw = rec.mask.right - rec.mask.left, mh = rec.mask.bottom - rec.mask.top;
            rec.data.set(-2, readChannelData(r, mw, mh, ch.length));
          } else rec.data.set(ch.id, readChannelData(r, w, h, ch.length));
        }
      }
    }
    r.o = liEnd;
  }
  r.o = lmEnd;

  // Build the layer tree (records are bottom → top).
  const root: Layer[] = [];
  const stack: Layer[][] = [root];
  for (const rec of records) {
    const cur = stack[stack.length - 1];
    if (rec.sectionType === 3) { stack.push([]); continue; } // group end marker (bottom)
    const visible = !(rec.flags & 2);
    const blend = KEY_TO_BLEND[rec.sectionBlend ?? rec.blend] ?? 'normal';
    const common = { name: rec.name || 'Layer', visible, opacity: rec.opacity / 255, blendMode: blend, clipped: rec.clipping === 1 };
    if (rec.sectionType === 1 || rec.sectionType === 2) {
      const children = stack.length > 1 ? stack.pop()! : [];
      const g: GroupLayer = { ...createGroup(rec.name || 'Group', children), ...common, expanded: rec.sectionType === 1 };
      g.mask = buildMask(rec, width, height);
      stack[stack.length - 1].push(g);
      continue;
    }
    const w = rec.right - rec.left, h = rec.bottom - rec.top;
    let layer: Layer;
    if (rec.text && rec.text.text) {
      const t = rec.text;
      const style = { ...defaultTextStyle(), fontFamily: t.font, fontSize: Math.max(1, Math.round(t.size * t.scale * 10) / 10), color: t.color };
      const tl: TextLayer = createTextLayer(t.text, rec.left, rec.top, style);
      layer = { ...tl, ...common };
    } else {
      const canvas = planesToCanvas(w, h, rec.data, gray);
      layer = { ...createRasterLayer(rec.name || 'Layer', canvas, translate(rec.left, rec.top)), ...common };
    }
    layer.mask = buildMask(rec, width, height);
    cur.push(layer);
  }
  while (stack.length > 1) { const orphan = stack.pop()!; stack[stack.length - 1].push(...orphan); }
  state.layers = root;
  if (!root.length) {
    // no layer info: use the merged image
    const comp = r.u16(); const planes = new Map<number, Uint8Array>();
    const n = Math.min(channels, gray ? 2 : 4);
    if (comp === 1) {
      const counts: number[] = []; for (let i = 0; i < channels * height; i++) counts.push(r.u16());
      for (let c = 0; c < channels; c++) {
        const out = new Uint8Array(width * height); let o = 0;
        for (let row = 0; row < height; row++) {
          const end = r.o + counts[c * height + row];
          while (r.o < end) { const k = (r.u8r() << 24) >> 24; if (k >= 0) for (let q = 0; q <= k; q++) out[o++] = r.u8r(); else if (k !== -128) { const v = r.u8r(); for (let q = 0; q < 1 - k; q++) out[o++] = v; } }
        }
        if (c < n) planes.set(gray ? (c === 0 ? 0 : -1) : c === 3 ? -1 : c, out);
      }
    } else for (let c = 0; c < channels; c++) { const out = new Uint8Array(r.bytes(width * height)); if (c < n) planes.set(gray ? (c === 0 ? 0 : -1) : c === 3 ? -1 : c, out); }
    state.layers = [createRasterLayer('Background', planesToCanvas(width, height, planes, gray))];
    warnings.push('This PSD has no layer data; the merged image was opened.');
  }
  const flat = allLayers(state.layers);
  state.activeLayerId = flat.length ? flat[flat.length - 1].id : null;
  return { state, warnings };
}

function buildMask(rec: LayerRecord, W: number, H: number): LayerMask | null {
  const m = rec.mask; const data = rec.data.get(-2);
  if (!m || !data) return null;
  const mw = m.right - m.left, mh = m.bottom - m.top;
  const mask = createMask(Math.max(1, mw), Math.max(1, mh), m.defaultColor, translate(m.left, m.top));
  if (mw > 0 && mh > 0) {
    const x = ctx2d(mask.canvas); const img = x.createImageData(mw, mh);
    for (let i = 0; i < mw * mh; i++) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = data[i]; img.data[i * 4 + 3] = 255; }
    x.putImageData(img, 0, 0);
  }
  mask.enabled = !(m.flags & 2);
  mask.linked = !(m.flags & 1);
  void W; void H;
  return mask;
}

// =====================================================================
// Writer
// =====================================================================
class Writer {
  buf = new Uint8Array(1 << 20); o = 0;
  private ensure(n: number) { if (this.o + n > this.buf.length) { let s = this.buf.length * 2; while (s < this.o + n) s *= 2; const nb = new Uint8Array(s); nb.set(this.buf.subarray(0, this.o)); this.buf = nb; } }
  u8(v: number) { this.ensure(1); this.buf[this.o++] = v & 255; }
  u16(v: number) { this.u8(v >> 8); this.u8(v); }
  i16(v: number) { this.u16(v & 0xffff); }
  u32(v: number) { this.u8(v >>> 24); this.u8(v >>> 16); this.u8(v >>> 8); this.u8(v); }
  i32(v: number) { this.u32(v >>> 0); }
  sig(s: string) { for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i)); }
  bytes(b: Uint8Array) { this.ensure(b.length); this.buf.set(b, this.o); this.o += b.length; }
  /** Reserve a u32 length and return a function that patches it. */
  len(): () => void { const at = this.o; this.u32(0); return () => { const n = this.o - at - 4; const save = this.o; this.o = at; this.u32(n); this.o = save; }; }
  pad(mult: number, from: number) { while ((this.o - from) % mult) this.u8(0); }
  result() { return this.buf.slice(0, this.o); }
}

function packRow(src: Uint8Array, start: number, len: number, out: number[]) {
  let i = 0;
  while (i < len) {
    let run = 1;
    while (i + run < len && run < 128 && src[start + i + run] === src[start + i]) run++;
    if (run > 1) { out.push((1 - run) & 255, src[start + i]); i += run; continue; }
    let lit = 1;
    while (i + lit < len && lit < 128 && !(i + lit + 1 < len && src[start + i + lit] === src[start + i + lit + 1])) lit++;
    out.push(lit - 1); for (let k = 0; k < lit; k++) out.push(src[start + i + k]);
    i += lit;
  }
}
function rle(plane: Uint8Array, w: number, h: number): Uint8Array {
  const counts: number[] = []; const data: number[] = [];
  for (let y = 0; y < h; y++) { const before = data.length; packRow(plane, y * w, w, data); counts.push(data.length - before); }
  const out = new Uint8Array(2 + h * 2 + data.length);
  out[0] = 0; out[1] = 1;
  counts.forEach((c, i) => { out[2 + i * 2] = c >> 8; out[3 + i * 2] = c & 255; });
  out.set(data, 2 + h * 2);
  return out;
}

interface OutLayer { name: string; top: number; left: number; w: number; h: number; channels: Map<number, Uint8Array>; blend: string; opacity: number; clipped: boolean; visible: boolean; section?: number; mask?: { top: number; left: number; w: number; h: number; data: Uint8Array; defaultColor: number; disabled: boolean } }

function canvasPlanes(c: HTMLCanvasElement, x0: number, y0: number, w: number, h: number) {
  const planes = new Map<number, Uint8Array>();
  if (w <= 0 || h <= 0) { [0, 1, 2, -1].forEach((k) => planes.set(k, new Uint8Array(0))); return planes; }
  const d = ctx2d(c, true).getImageData(x0, y0, w, h).data;
  const R = new Uint8Array(w * h), G = new Uint8Array(w * h), B = new Uint8Array(w * h), A = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { R[i] = d[i * 4]; G[i] = d[i * 4 + 1]; B[i] = d[i * 4 + 2]; A[i] = d[i * 4 + 3]; }
  planes.set(-1, A); planes.set(0, R); planes.set(1, G); planes.set(2, B);
  return planes;
}

export function writePsd(state: DocState): { data: Uint8Array; warnings: string[] } {
  const warnings = new Set<string>();
  const out: OutLayer[] = [];
  const W = state.width, H = state.height;
  const walk = (layers: Layer[]) => {
    for (const l of layers) {
      if (l.type === 'adjustment') { warnings.add('Adjustment layers are included in the merged image only.'); continue; }
      const base = { name: l.name, blend: BLEND_TO_KEY[l.blendMode] ?? 'norm', opacity: Math.round(l.opacity * 255), clipped: l.clipped, visible: l.visible };
      let mask: OutLayer['mask'];
      if (l.mask) {
        const alpha = maskAlpha({ ...l.mask, density: 1, feather: 0 }, W, H);
        const d = ctx2d(alpha, true).getImageData(0, 0, W, H).data; const plane = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i++) plane[i] = d[i * 4 + 3];
        mask = { top: 0, left: 0, w: W, h: H, data: plane, defaultColor: l.mask.background, disabled: !l.mask.enabled };
      }
      if (l.type === 'group') {
        out.push({ ...base, name: '</Layer group>', top: 0, left: 0, w: 0, h: 0, channels: canvasPlanes(createCanvas(1, 1), 0, 0, 0, 0), section: 3, blend: 'norm', opacity: 255, clipped: false, visible: true });
        walk(l.children);
        out.push({ ...base, top: 0, left: 0, w: 0, h: 0, channels: canvasPlanes(createCanvas(1, 1), 0, 0, 0, 0), section: l.expanded ? 1 : 2, mask });
        continue;
      }
      if (l.type === 'text') warnings.add('Text layers are saved as pixels (names and positions are kept).');
      if (l.vectorMask) warnings.add('Vector masks are applied to the layer pixels.');
      const px = sharedCompositor.renderLayer(state, { ...l, mask: null, opacity: 1 } as Layer);
      const b = contentBounds(px, false) ?? { x: 0, y: 0, w: 0, h: 0 };
      out.push({ ...base, top: b.y, left: b.x, w: b.w, h: b.h, channels: canvasPlanes(px, b.x, b.y, b.w, b.h), mask });
    }
  };
  walk(state.layers);

  const w = new Writer();
  // header
  w.sig('8BPS'); w.u16(1); for (let i = 0; i < 6; i++) w.u8(0);
  w.u16(4); w.u32(H); w.u32(W); w.u16(8); w.u16(3);
  w.u32(0); // color mode data
  // image resources: resolution
  const res = w.len();
  w.sig('8BIM'); w.u16(1005); w.u16(0); w.u32(16);
  w.u32(state.dpi * 65536); w.u16(1); w.u16(1); w.u32(state.dpi * 65536); w.u16(1); w.u16(1);
  res();
  // layer & mask info
  const lm = w.len();
  const li = w.len();
  w.i16(-out.length);
  const encoded: Uint8Array[][] = [];
  for (const L of out) {
    const chans: [number, Uint8Array][] = [];
    for (const id of [-1, 0, 1, 2]) chans.push([id, L.w && L.h ? rle(L.channels.get(id)!, L.w, L.h) : new Uint8Array([0, 0])]);
    if (L.mask) chans.push([-2, rle(L.mask.data, L.mask.w, L.mask.h)]);
    encoded.push(chans.map((c) => c[1]));
    w.i32(L.top); w.i32(L.left); w.i32(L.top + L.h); w.i32(L.left + L.w);
    w.u16(chans.length);
    for (const [id, data] of chans) { w.i16(id); w.u32(data.length); }
    w.sig('8BIM'); w.sig(L.section === 1 || L.section === 2 ? 'norm' : L.blend);
    w.u8(L.opacity); w.u8(L.clipped ? 1 : 0);
    w.u8((L.visible ? 0 : 2) | 8 | (L.section === 3 ? 16 : 0)); w.u8(0);
    const extra = w.len();
    if (L.mask) { w.u32(20); w.i32(L.mask.top); w.i32(L.mask.left); w.i32(L.mask.top + L.mask.h); w.i32(L.mask.left + L.mask.w); w.u8(L.mask.defaultColor); w.u8(L.mask.disabled ? 2 : 0); w.u16(0); }
    else w.u32(0);
    w.u32(0); // blending ranges
    const ascii = L.name.replace(/[^\x20-\x7e]/g, '?').slice(0, 255);
    const start = w.o; w.u8(ascii.length); for (let i = 0; i < ascii.length; i++) w.u8(ascii.charCodeAt(i)); w.pad(4, start);
    // unicode name
    w.sig('8BIM'); w.sig('luni'); const ul = w.len(); w.u32(L.name.length); for (let i = 0; i < L.name.length; i++) w.u16(L.name.charCodeAt(i)); if (L.name.length % 2) w.u16(0); ul();
    if (L.section) { w.sig('8BIM'); w.sig('lsct'); w.u32(L.section === 3 ? 4 : 12); w.u32(L.section); if (L.section !== 3) { w.sig('8BIM'); w.sig(L.blend); } }
    extra();
  }
  for (const chans of encoded) for (const c of chans) w.bytes(c);
  if ((w.o) % 2) w.u8(0);
  li();
  w.u32(0); // global mask info
  lm();
  // merged image (RLE)
  const comp = renderDocument(state);
  const planes = canvasPlanes(comp, 0, 0, W, H);
  w.u16(1);
  const enc = [0, 1, 2, -1].map((id) => rle(planes.get(id)!, W, H));
  for (const e of enc) w.bytes(e.subarray(2, 2 + H * 2));
  for (const e of enc) w.bytes(e.subarray(2 + H * 2));
  return { data: w.result(), warnings: [...warnings] };
}
