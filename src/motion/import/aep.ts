// Reads After Effects project files (.aep, binary RIFX, and .aepx, its XML form).
// What is read: the folders, compositions (name, size, frame rate, duration), the layers of every
// composition in order (name, kind, times, parent, static transform values, the text of text layers)
// and the footage file each layer uses, which is linked to the files you open together with the project.
// The .aep format is not documented by Adobe, so every number is checked before it is used; anything
// that does not look right falls back to a safe default and is listed in the import report.
import type { Composition, Keyframe, MLayer, MotionProject, Prop, Vec2, Vec3 } from '../types';
import { uid } from '../../utils/id';
import { prop } from '../anim';
import { newComposition, newNull, newSolid, newText, newPrecompLayer, newMediaLayer, newCamera, newShape } from '../factory';
import { importAsset, kindOf } from '../media/assets';
import type { ImportReport } from './lottie';

export interface Chunk { id: string; list?: string; data?: Uint8Array; text?: string; kids?: Chunk[] }

const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
const u16 = (b: Uint8Array, o: number) => (o + 2 <= b.length ? (b[o] << 8) | b[o + 1] : NaN);
const u32 = (b: Uint8Array, o: number) => (o + 4 <= b.length ? ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3] : NaN);
const s32 = (b: Uint8Array, o: number) => (o + 4 <= b.length ? (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3] : NaN);
const f64 = (b: Uint8Array, o: number) => (o + 8 <= b.length ? new DataView(b.buffer, b.byteOffset + o, 8).getFloat64(0, false) : NaN);
const f32 = (b: Uint8Array, o: number) => (o + 4 <= b.length ? new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0, false) : NaN);
const utf8 = (b: Uint8Array) => new TextDecoder('utf-8').decode(b);

/** RIFX (big-endian RIFF) chunk tree of a binary .aep */
export function parseRifx(buf: ArrayBuffer): Chunk {
  const b = new Uint8Array(buf);
  if (b.length < 12 || ascii(b, 0, 4) !== 'RIFX') throw new Error('This is not an After Effects project (.aep) file.');
  const read = (start: number, end: number): Chunk[] => {
    const out: Chunk[] = [];
    let o = start;
    while (o + 8 <= end) {
      const id = ascii(b, o, 4); const size = u32(b, o + 4);
      const ds = o + 8, de = Math.min(end, ds + size);
      if (id === 'LIST' && size >= 4) {
        const list = ascii(b, ds, 4);
        // a few LISTs hold raw bytes (the text document), not chunks
        if (list === 'btdk') out.push({ id: 'LIST', list, data: b.subarray(ds + 4, de) });
        else out.push({ id: 'LIST', list, kids: read(ds + 4, de) });
      } else if (id === 'Utf8') out.push({ id, text: utf8(b.subarray(ds, de)), data: b.subarray(ds, de) });
      else out.push({ id, data: b.subarray(ds, de) });
      o = ds + size + (size & 1);
    }
    return out;
  };
  return { id: 'RIFX', list: ascii(b, 8, 4), kids: read(12, Math.min(b.length, 8 + u32(b, 4))) };
}

/** .aepx: the same chunks written as XML (data chunks carry their bytes as hex in bdata) */
export function parseAepx(xml: string): Chunk {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('This .aepx file could not be read (XML error).');
  const hex = (s: string) => { const c = s.replace(/[^0-9a-f]/gi, ''); const a = new Uint8Array(c.length >> 1); for (let i = 0; i < a.length; i++) a[i] = parseInt(c.substr(i * 2, 2), 16); return a; };
  const conv = (el: Element): Chunk => {
    const tag = el.localName;
    if (tag === 'string') return { id: 'Utf8', text: el.textContent ?? '' };
    const bd = el.getAttribute('bdata');
    if (bd !== null) return tag === 'btdk' ? { id: 'LIST', list: 'btdk', data: hex(bd) } : { id: tag, data: hex(bd) };
    return { id: 'LIST', list: tag, kids: [...el.children].map(conv) };
  };
  return conv(doc.documentElement);
}

const lists = (c: Chunk | undefined, type: string) => (c?.kids ?? []).filter((k) => k.id === 'LIST' && k.list?.trim() === type.trim());
const child = (c: Chunk | undefined, id: string) => (c?.kids ?? []).find((k) => k.id === id);
const nameOf = (c: Chunk) => (c.kids ?? []).find((k) => k.id === 'Utf8')?.text ?? '';
function allItems(c: Chunk, out: Chunk[] = []): Chunk[] {
  for (const k of c.kids ?? []) { if (k.id === 'LIST' && k.list === 'Item') out.push(k); if (k.kids) allItems(k, out); }
  return out;
}

interface AeItem { chunk: Chunk; type: number; id: number; name: string }
interface Footage { path: string; file: string; solid?: { color: string; w: number; h: number } }

function compInfo(cd: Uint8Array | undefined, report: ImportReport) {
  const r = { w: 1920, h: 1080, fps: 30, dur: 10, bg: '#000000' };
  if (!cd) { report.skipped.push('Composition settings (defaults used)'); return r; }
  const w = u16(cd, 140), h = u16(cd, 142);
  if (w >= 4 && w <= 30000 && h >= 4 && h <= 30000) { r.w = w; r.h = h; } else report.skipped.push('Composition size (default 1920×1080 used)');
  const fpsWhole = u16(cd, 156);
  const fd = u32(cd, 5), fn = u32(cd, 9);
  const cands = [fpsWhole, fd && fn ? fd / fn : NaN, fd && fn ? fn / fd : NaN];
  const fps = cands.find((v) => Number.isFinite(v) && v >= 1 && v <= 240);
  if (fps) r.fps = Math.round(fps * 1000) / 1000;
  const sd = u32(cd, 44), sv = u32(cd, 48);
  const dur = sv ? sd / sv : NaN;
  if (Number.isFinite(dur) && dur > 0 && dur <= 86400) r.dur = dur;
  const bg = cd.subarray(52, 55);
  if (bg.length === 3) r.bg = `#${[...bg].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
  return r;
}

/** start, in and out times: three (dividend, divisor) pairs inside the layer header; found by checking where they make sense */
function layerTimes(ld: Uint8Array | undefined, dur: number): { start: number; inP: number; outP: number } | null {
  if (!ld) return null;
  for (let o = 6; o <= 40; o++) {
    const v = [0, 1, 2].map((i) => { const d = s32(ld, o + i * 8), q = u32(ld, o + i * 8 + 4); return q > 0 && q < 1e8 ? d / q : NaN; });
    if (v.some((x) => !Number.isFinite(x))) continue;
    const [st, a, b] = v;
    if (Math.abs(st) > dur * 20 + 60) continue;
    for (const [i0, o0] of [[a, b], [st + a, st + b]]) if (i0 >= -1e-6 && o0 > i0 && o0 <= dur * 4 + 1) return { start: st, inP: Math.max(0, i0), outP: Math.min(dur, o0) };
  }
  return null;
}

function walkProps(g: Chunk | undefined, fn: (match: string, prop: Chunk) => void) {
  const kids = g?.kids ?? [];
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (k.id === 'tdmn' && k.data) {
      const match = ascii(k.data, 0, k.data.length).replace(/\0[\s\S]*$/, '');
      const next = kids[i + 1];
      if (next) { fn(match, next); if (next.kids) walkProps(next, fn); }
    } else if (k.id === 'LIST' && k.kids && k.list !== 'tdbs') walkProps(k, fn);
  }
}
const doubles = (p: Chunk) => { const c = child(p, 'cdat'); if (!c?.data) return null; const n = Math.floor(c.data.length / 8); return Array.from({ length: n }, (_, i) => f64(c.data!, i * 8)); };
const keyed = (p: Chunk) => (p.kids ?? []).some((k) => k.id === 'LIST' && k.list === 'list');

/**
 * Keyframes of a property: LIST 'list' holds 'lhd3' (count and record size) and 'ldat' (the records).
 * Each record: 8-byte header (time, interpolation) then values with speed / influence for the easing.
 * The layout is only trusted when the record size matches one we know and every number is sane.
 */
type RawKey = Omit<Keyframe, 'v'> & { v: number[] };
function aeKeys(p: Chunk, dims: number, fps: number, lo: number, hi: number, start: number): RawKey[] | null {
  const list = (p.kids ?? []).find((k) => k.id === 'LIST' && k.list === 'list');
  const hd = child(list, 'lhd3')?.data, dat = child(list, 'ldat')?.data;
  if (!hd || !dat) return null;
  const n = u16(hd, 10), len = u16(hd, 18);
  if (!(n >= 1 && n < 100000 && len >= 16 && dat.length >= n * len)) return null;
  // spatial (position): 8 hdr + 8 + 4 speeds/influences + value, tangent in, tangent out (dims each)
  const spatialLen = 8 + 8 + 32 + 24 * dims, multiLen = 8 + 40 * dims;
  const spatial = len === spatialLen; const multi = len === multiLen;
  if (!spatial && !multi) return null;
  const raw = Array.from({ length: n }, (_, i) => {
    const r = dat.subarray(i * len, i * len + len);
    const time = u16(r, 1), interp = r[5];
    const rd = (o: number, k: number) => Array.from({ length: k }, (_, j) => f64(r, o + j * 8));
    if (spatial) return { time, interp, inSpeed: [f64(r, 16)], inInf: [f64(r, 24)], outSpeed: [f64(r, 32)], outInf: [f64(r, 40)], v: rd(48, dims), ti: rd(48 + dims * 8, dims), to: rd(48 + dims * 16, dims) };
    return { time, interp, v: rd(8, dims), inSpeed: rd(8 + dims * 8, dims), inInf: rd(8 + dims * 16, dims), outSpeed: rd(8 + dims * 24, dims), outInf: rd(8 + dims * 32, dims), ti: null, to: null };
  });
  const sane = raw.every((k, i) => k.v.every(Number.isFinite) && k.v.every((x) => Math.abs(x) < 1e7) && [...k.inInf, ...k.outInf].every((x) => Number.isFinite(x) && x >= 0 && x <= 100.0001) && [...k.inSpeed, ...k.outSpeed].every((x) => Number.isFinite(x) && Math.abs(x) < 1e9) && (i === 0 || k.time >= raw[i - 1].time) && [1, 2, 3].includes(k.interp));
  if (!sane) return null;
  // time unit: frames of the composition from the layer start (the usual case), checked against the layer's span
  const fit = (div: number, off: number) => raw.every((k) => { const t = off + k.time / div; return t >= lo - 1 && t <= hi + 1; });
  const cands: [number, number][] = [[fps, start], [fps, 0], [1, start], [fps * 2, start]];
  const pick = cands.find(([d, o]) => fit(d, o));
  if (!pick) return null;
  const [div, off] = pick;
  const keys = raw.map((k) => ({ id: uid('k'), t: off + k.time / div, v: k.v, interp: (k.interp === 3 ? 'hold' : k.interp === 1 ? 'linear' : 'bezier') as Keyframe['interp'], out: [1 / 3, 1 / 3] as Vec2, in: [2 / 3, 2 / 3] as Vec2, so: undefined as Vec2 | undefined, si: undefined as Vec2 | undefined }));
  // After Effects speed / influence → bezier handles of each segment
  for (let i = 0; i < keys.length - 1; i++) {
    const a = raw[i], b = raw[i + 1], ka = keys[i], kb = keys[i + 1];
    const dt = kb.t - ka.t; if (dt <= 0) continue;
    const dv = spatial ? Math.hypot(...b.v.map((x, d) => x - a.v[d])) : b.v[0] - a.v[0];
    const xo = Math.max(0.01, Math.min(1, a.outInf[0] / 100)), xi = Math.max(0.01, Math.min(1, b.inInf[0] / 100));
    const yo = Math.abs(dv) > 1e-9 ? (a.outSpeed[0] * xo * dt) / dv : 0, yi = Math.abs(dv) > 1e-9 ? 1 - (b.inSpeed[0] * xi * dt) / dv : 1;
    if (ka.interp === 'bezier' || kb.interp === 'bezier') { ka.out = [xo, yo]; kb.in = [1 - xi, yi]; if (ka.interp === 'linear') ka.interp = 'bezier'; }
    if (spatial && a.to && b.ti) { if (a.to.some((x) => Math.abs(x) > 1e-6)) ka.so = [a.to[0], a.to[1]]; if (b.ti.some((x) => Math.abs(x) > 1e-6)) kb.si = [b.ti[0], b.ti[1]]; }
  }
  return keys as RawKey[];
}

/** colour stored as four 0–1 (or 0–255) numbers; alpha first or last */
function aeColor(v: number[] | null): string | null {
  if (!v || v.length < 3 || v.some((x) => !Number.isFinite(x))) return null;
  const k = v.some((x) => x > 1.0001) ? 1 / 255 : 1;
  const c = v.length >= 4 && Math.abs(v[0] * k - 1) < 1e-6 && Math.abs(v[3] * k - 1) > 1e-6 ? v.slice(1, 4) : v.slice(0, 3);
  const h = (x: number) => Math.round(Math.max(0, Math.min(1, x * k)) * 255).toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}
/** the first rectangle / ellipse / polygon of a shape layer, with its fill and stroke (static values) */
function shapeFromAe(comp: Composition, props: Chunk | undefined, skip: (s: string) => void): MLayer {
  let kind: 'rect' | 'ellipse' | 'polygon' | 'star' | 'path' | null = null;
  const vals: Record<string, number[] | null> = {};
  let count = 0;
  walkProps(props, (m, p) => {
    if (/^ADBE Vector Shape - (Rect|Ellipse|Star)$/.test(m) || m === 'ADBE Vector Shape - Group') { count++; if (!kind) kind = m.endsWith('Rect') ? 'rect' : m.endsWith('Ellipse') ? 'ellipse' : m.endsWith('Star') ? 'star' : 'path'; }
    if (p.list === 'tdbs' && !(m in vals)) vals[m] = doubles(p);
  });
  const l = newShape(comp, kind === 'path' || !kind ? 'rect' : kind, 0);
  const sz = vals['ADBE Vector Rect Size'] ?? vals['ADBE Vector Ellipse Size'];
  if (sz && sz.length >= 2 && sz.every((x) => Number.isFinite(x) && x >= 0 && x < 1e5)) l.shape.size = prop<Vec2>([sz[0], sz[1]]);
  const r = vals['ADBE Vector Star Outer Radius']; if (r && Number.isFinite(r[0]) && r[0] > 0) l.shape.size = prop<Vec2>([r[0] * 2, r[0] * 2]);
  const pts = vals['ADBE Vector Star Points']; if (pts && pts[0] >= 3 && pts[0] < 200) l.shape.sides = Math.round(pts[0]);
  const rr = vals['ADBE Vector Rect Roundness']; if (rr && rr[0] >= 0 && rr[0] < 1e5) l.shape.roundness = prop(rr[0]);
  const fill = aeColor(vals['ADBE Vector Fill Color']); if (fill) l.shape.fill = prop(fill);
  const stroke = aeColor(vals['ADBE Vector Stroke Color']);
  l.shape.strokeOn = !!stroke && !!vals['ADBE Vector Stroke Width']; if (stroke) l.shape.stroke = prop(stroke);
  const sw = vals['ADBE Vector Stroke Width']; if (sw && sw[0] >= 0 && sw[0] < 1e4) l.shape.strokeWidth = prop(sw[0]);
  if (kind === 'path') skip('Shape paths drawn with the Pen (a rectangle stands in; export Lottie JSON for the real shapes)');
  if (count > 1) skip('Shape layers with several shapes (the first one is used; export Lottie JSON for all of them)');
  return l;
}

/** the text of a text layer: UTF-16 strings stored inside the text document */
function textOf(layer: Chunk): string | null {
  let found: string | null = null;
  const visit = (c: Chunk) => {
    if (found !== null) return;
    if (c.id === 'LIST' && c.list === 'btdk' && c.data) {
      const b = c.data;
      for (let i = 0; i + 3 < b.length; i++) {
        if (b[i] === 0x28 && b[i + 1] === 0xfe && b[i + 2] === 0xff) {
          const bytes: number[] = []; let j = i + 3;
          for (; j < b.length; j++) { if (b[j] === 0x5c && j + 1 < b.length) { bytes.push(b[++j]); continue; } if (b[j] === 0x29 && bytes.length % 2 === 0) break; bytes.push(b[j]); }
          const s = new TextDecoder('utf-16be').decode(new Uint8Array(bytes)).replace(/\r\n?|\u0003/g, '\n').replace(/\n$/, '');
          if (s.trim()) { found = s; return; }
          i = j;
        }
      }
    }
    for (const k of c.kids ?? []) visit(k);
  };
  visit(layer);
  return found;
}

export async function importAep(root: Chunk, files: File[]): Promise<{ comps: Record<string, Composition>; compOrder: string[]; assets: MotionProject['assets']; assetOrder: string[]; mainId: string; report: ImportReport }> {
  const report: ImportReport = { comps: 0, layers: 0, keyframes: 0, missing: [], skipped: [] };
  const skip = (s: string) => { if (!report.skipped.includes(s)) report.skipped.push(s); };
  const fileMap = new Map(files.map((f) => [f.name.toLowerCase(), f]));
  const items: AeItem[] = allItems(root).map((chunk) => {
    const id = child(chunk, 'idta')?.data;
    return { chunk, type: id ? u16(id, 0) : 0, id: id ? u32(id, 16) : NaN, name: nameOf(chunk) };
  });
  const byId = new Map(items.filter((i) => Number.isFinite(i.id)).map((i) => [i.id, i]));
  // footage: file path (alas holds JSON with the full path) or a solid
  const footage = new Map<number, Footage>();
  for (const it of items) {
    if (it.type !== 7) continue;
    const pin = lists(it.chunk, 'Pin ')[0];
    let path = '';
    const walk = (c: Chunk | undefined) => { for (const k of c?.kids ?? []) { if (k.id === 'alas' && k.data) { try { const j = JSON.parse(utf8(k.data).replace(/\0+$/, '')); if (j.fullpath) path = j.fullpath; } catch { /* not JSON */ } } if (k.kids) walk(k); } };
    walk(pin ?? it.chunk);
    const opti = child(pin, 'opti')?.data;
    let solid: Footage['solid'];
    if (opti && ascii(opti, 0, 4) === 'Soli') {
      const [a, r, g, b] = [6, 10, 14, 18].map((o) => f32(opti, o));
      const ok = [a, r, g, b].every((x) => Number.isFinite(x) && x >= 0 && x <= 1.0001);
      const hx = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
      solid = { color: ok ? `#${hx(r)}${hx(g)}${hx(b)}` : '#808080', w: 0, h: 0 };
    }
    const sspc = child(pin, 'sspc')?.data;
    if (solid && sspc) {
      for (const o of [32, 36, 30, 34, 28]) { const w = u16(sspc, o), h = u16(sspc, o + 4 - (o % 4 ? 2 : 0)); if (w >= 1 && w <= 30000 && h >= 1 && h <= 30000) { solid.w = w; solid.h = h; break; } }
    }
    footage.set(it.id, { path, file: path.split(/[\\/]/).pop() ?? '', solid });
  }
  const assets: MotionProject['assets'] = {}; const assetOrder: string[] = [];
  const assetFor = new Map<number, string>();
  const getAsset = async (id: number): Promise<string | null> => {
    if (assetFor.has(id)) return assetFor.get(id)!;
    const f = footage.get(id); if (!f?.file) return null;
    const file = fileMap.get(f.file.toLowerCase());
    if (!file) { if (!report.missing.includes(f.file)) report.missing.push(f.file); return null; }
    if (!kindOf(file)) { skip(`Footage type: ${f.file}`); return null; }
    const meta = await importAsset(file, file.name);
    assets[meta.id] = meta; assetOrder.push(meta.id); assetFor.set(id, meta.id); return meta.id;
  };

  // compositions (empty first, so precomp layers can point at any of them)
  const comps: Record<string, Composition> = {}; const compOrder: string[] = [];
  const compFor = new Map<number, string>();
  const compItems = items.filter((i) => i.type === 4);
  for (const it of compItems) {
    const info = compInfo(child(it.chunk, 'cdta')?.data, report);
    const c = newComposition({ name: it.name || 'Comp', width: info.w, height: info.h, fps: info.fps, duration: info.dur, background: info.bg });
    c.motionBlur = false;
    comps[c.id] = c; compOrder.push(c.id); compFor.set(it.id, c.id); report.comps++;
  }
  let animated = 0, effects = 0, decodedKeys = 0, failedKeys = 0;
  for (const it of compItems) {
    const comp = comps[compFor.get(it.id)!];
    const layers: MLayer[] = [];
    for (const lc of lists(it.chunk, 'Layr')) {
      const ld = child(lc, 'ldta')?.data;
      const name = nameOf(lc) || 'Layer';
      const props = lists(lc, 'tdgp')[0];
      const matches = new Set<string>();
      walkProps(props, (m, p) => { matches.add(m); if (p.list === 'tdbs' && keyed(p)) animated++; });
      if (matches.has('ADBE Effect Parade')) effects++;
      const srcId = ld ? u32(ld, 40) : NaN;
      const src = byId.get(srcId);
      let layer: MLayer;
      if (matches.has('ADBE Text Properties')) layer = newText(comp, textOf(lc) ?? name, 0);
      else if (matches.has('ADBE Root Vectors Group')) layer = shapeFromAe(comp, props, skip);
      else if (matches.has('ADBE Camera Options Group')) layer = newCamera(comp, '3d', 0);
      else if (matches.has('ADBE Light Options Group')) { skip('Light layers'); continue; }
      else if (src?.type === 4 && compFor.has(src.id)) layer = newPrecompLayer(comp, comps[compFor.get(src.id)!], 0);
      else if (src?.type === 7) {
        const f = footage.get(src.id);
        if (f?.solid) layer = /^null/i.test(src.name) || /^null/i.test(name) ? newNull(comp, 0) : newSolid(comp, f.solid.color, 0, f.solid.w || comp.width, f.solid.h || comp.height, name);
        else {
          const aid = await getAsset(src.id);
          layer = aid ? newMediaLayer(comp, assets[aid], 0) : newSolid(comp, '#3a3a58', 0, comp.width, comp.height, `${name} (missing: ${f?.file || 'footage'})`);
        }
      } else layer = newNull(comp, 0);
      layer.name = layer.name.includes('(missing') ? layer.name : name;
      const tm = layerTimes(ld, comp.duration);
      if (tm) { layer.inPoint = tm.inP; layer.outPoint = Math.max(tm.inP + 1 / comp.fps, tm.outP); layer.start = tm.start; }
      else { layer.inPoint = 0; layer.outPoint = comp.duration; }
      // static transform values
      const tr = { ...layer.transform };
      const p3 = (v: number[] | null, ok: (x: number[]) => boolean): Prop<Vec3> | null => (v && v.length >= 2 && ok(v) ? prop<Vec3>([v[0], v[1], v[2] ?? 0]) : null);
      walkProps(props, (m, p) => {
        if (p.list !== 'tdbs') return;
        if (keyed(p)) {
          const dims = m === 'ADBE Anchor Point' || m === 'ADBE Position' || m === 'ADBE Scale' ? 3 : m === 'ADBE Rotate Z' || m === 'ADBE Opacity' ? 1 : 0;
          if (!dims) return;
          let ks = aeKeys(p, dims, comp.fps, layer.inPoint, layer.outPoint, layer.start);
          if (!ks && dims === 3) ks = aeKeys(p, 2, comp.fps, layer.inPoint, layer.outPoint, layer.start);
          if (!ks) { failedKeys++; return; }
          decodedKeys += ks.length;
          const asVec = (k: RawKey[], mulBy = 1) => k.map((x) => ({ ...x, v: [x.v[0] * mulBy, (x.v[1] ?? 0) * mulBy, x.v.length > 2 ? x.v[2] * mulBy : m === 'ADBE Scale' ? 100 : 0] as Vec3 }));
          if (m === 'ADBE Anchor Point') tr.anchor = { v: asVec(ks)[0].v, k: asVec(ks) };
          else if (m === 'ADBE Position') tr.position = { v: asVec(ks)[0].v, k: asVec(ks) };
          else if (m === 'ADBE Scale') { const f = ks.every((k) => k.v.every((x) => Math.abs(x) <= 1.5)) ? 100 : 1; const vv = asVec(ks, f); tr.scale = { v: vv[0].v, k: vv }; }
          else { const one = ks.map((x) => ({ ...x, v: x.v[0], so: undefined, si: undefined })); if (m === 'ADBE Rotate Z') tr.rotation = { v: one[0].v, k: one }; else tr.opacity = { v: one[0].v, k: one }; }
          return;
        }
        const v = doubles(p); if (!v || v.some((x) => !Number.isFinite(x))) return;
        const big = (x: number[]) => x.every((n) => Math.abs(n) < 1e6);
        if (m === 'ADBE Anchor Point') tr.anchor = p3(v, big) ?? tr.anchor;
        else if (m === 'ADBE Position') tr.position = p3(v, big) ?? tr.position;
        else if (m === 'ADBE Scale') tr.scale = p3(v.map((x) => (Math.abs(x) <= 100 && v.every((y) => Math.abs(y) <= 100) && v.some((y) => Math.abs(y) > 0 && Math.abs(y) <= 1.5) ? x * 100 : x)), (x) => x.every((n) => Math.abs(n) < 1e5)) ?? tr.scale;
        else if (m === 'ADBE Rotate Z' && Math.abs(v[0]) < 1e5) tr.rotation = prop(v[0]);
        else if (m === 'ADBE Opacity' && v[0] >= 0 && v[0] <= 100) tr.opacity = prop(v[0]);
      });
      layer.transform = tr;
      layers.push(layer); report.layers++;
    }
    comp.layers = layers;
  }
  report.keyframes += decodedKeys;
  if (failedKeys) report.skipped.push(`${failedKeys} of ${animated} animated properties could not be read from this .aep (export Lottie JSON with Bodymovin to bring every animation)`);
  else if (animated > decodedKeys && !decodedKeys) report.skipped.push(`${animated} animated properties outside the transform (effects, shapes, text)`);
  if (effects) report.skipped.push(`Effects on ${effects} layers`);
  report.skipped.push('Parenting, masks and blending modes from .aep');
  if (!compOrder.length) throw new Error('No compositions were found in this After Effects project.');
  // the main composition: the one not used inside another, with the most layers
  const used = new Set(Object.values(comps).flatMap((c) => c.layers.filter((l) => l.type === 'precomp').map((l) => (l as Extract<MLayer, { type: 'precomp' }>).compId)));
  const mainId = [...compOrder].sort((a, b) => Number(used.has(a)) - Number(used.has(b)) || comps[b].layers.length - comps[a].layers.length)[0];
  return { comps, compOrder, assets, assetOrder, mainId, report };
}
