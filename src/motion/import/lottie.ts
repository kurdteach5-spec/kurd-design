// Opens After Effects animations exported as Lottie / Bodymovin JSON: compositions, precomps, solids, images,
// nulls, shape layers (rectangles, ellipses, stars, polygons, paths with fill, stroke and trim), text,
// masks, track mattes, parenting, blending modes, 3D layers and every keyframe with its easing and motion path.
import type {
  BlendMode, Composition, Effect, Gradient, Keyframe, Mask, MatteMode, MLayer, MPath, MotionProject, PathVertex, Prop, PropValue, ShapeKind, TextRangeAnimator, Vec2, Vec3,
} from '../types';
import { LINEAR_IN, LINEAR_OUT, prop } from '../anim';
import { newComposition, newEffect, newNull, newShape, newSolid, newText, newPrecompLayer, newMediaLayer, defaultTransform } from '../factory';
import { importAsset } from '../media/assets';
import { FONTS } from '../../utils/fonts';
import { uid } from '../../utils/id';

/* eslint-disable @typescript-eslint/no-explicit-any */
type J = any;

export interface ImportReport { comps: number; layers: number; keyframes: number; missing: string[]; skipped: string[]; expressions?: number }

const BLEND: BlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'add'];
const MATTE: Record<number, MatteMode> = { 1: 'alpha', 2: 'alphaInv', 3: 'luma', 4: 'lumaInv' };

export const isLottie = (j: J) => !!j && typeof j === 'object' && Array.isArray(j.layers) && typeof j.fr === 'number' && typeof j.w === 'number';

const arr = (x: J): number[] => (Array.isArray(x) ? x.map(Number) : [Number(x)]);
const first = (x: J, d = 0): number => (Array.isArray(x) ? Number(x[0] ?? d) : x === undefined ? d : Number(x));
const isKeyed = (p: J) => !!p && (p.a === 1 || (Array.isArray(p.k) && p.k.length > 0 && typeof p.k[0] === 'object' && p.k[0] !== null && 't' in p.k[0]));
const hex2 = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0');
const colorOf = (v: number[]) => `#${hex2(v[0] ?? 0)}${hex2(v[1] ?? 0)}${hex2(v[2] ?? 0)}`;

class Ctx {
  report: ImportReport = { comps: 0, layers: 0, keyframes: 0, missing: [], skipped: [] };
  comps: Record<string, Composition> = {};
  compOrder: string[] = [];
  assets: MotionProject['assets'] = {};
  assetOrder: string[] = [];
  imageAssets = new Map<string, string>(); // lottie asset id → our asset id
  precomps = new Map<string, string>(); // lottie asset id → comp id
  fonts = new Map<string, { family: string; weight: number; italic: boolean }>();
  constructor(public root: J, public files: Map<string, File>) {}
  skip(what: string) { if (!this.report.skipped.includes(what)) this.report.skipped.push(what); }
}

/** a Lottie property (static or keyframed) → our Prop, with times moved into composition seconds */
function P<T extends PropValue>(c: Ctx, p: J, f: (v: number[]) => T, fr: number, st: number, fallback: T): Prop<T> {
  const r = P0(c, p, f, fr, st, fallback);
  if (p && typeof p.x === 'string' && p.x.trim()) { r.x = p.x; c.report.expressions = (c.report.expressions ?? 0) + 1; }
  return r;
}
function P0<T extends PropValue>(c: Ctx, p: J, f: (v: number[]) => T, fr: number, st: number, fallback: T): Prop<T> {
  if (!p) return prop(fallback);
  if (!isKeyed(p)) return prop(f(arr(p.k)));
  const ks: J[] = p.k;
  const keys: Keyframe<T>[] = [];
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i];
    const s = k.s ?? ks[i - 1]?.e;
    if (s === undefined) continue;
    const prev = i > 0 ? ks[i - 1] : null;
    const out: Vec2 = k.o ? [first(k.o.x, 1 / 3), first(k.o.y, 1 / 3)] : [...LINEAR_OUT] as Vec2;
    const inn: Vec2 = prev?.i ? [first(prev.i.x, 2 / 3), first(prev.i.y, 2 / 3)] : [...LINEAR_IN] as Vec2;
    const key: Keyframe<T> = { id: uid('k'), t: (Number(k.t) + st) / fr, v: f(arr(s)), interp: k.h === 1 ? 'hold' : 'bezier', out, in: inn };
    if (Array.isArray(k.to) && k.to.some((x: number) => x)) key.so = [Number(k.to[0]), Number(k.to[1])];
    if (prev && Array.isArray(prev.ti) && prev.ti.some((x: number) => x)) key.si = [Number(prev.ti[0]), Number(prev.ti[1])];
    keys.push(key);
  }
  if (!keys.length) return prop(fallback);
  c.report.keyframes += keys.length;
  if (keys.length === 1) return { v: keys[0].v, k: [] };
  return { v: keys[0].v, k: keys };
}
/** shape path (vertices with in/out tangents) */
function pathOf(k: J): MPath {
  const s = Array.isArray(k) ? k[0] : k;
  if (!s || !Array.isArray(s.v)) return { closed: false, points: [] };
  const points: PathVertex[] = s.v.map((v: number[], i: number) => ({ x: v[0], y: v[1], ix: s.i?.[i]?.[0] ?? 0, iy: s.i?.[i]?.[1] ?? 0, ox: s.o?.[i]?.[0] ?? 0, oy: s.o?.[i]?.[1] ?? 0 }));
  return { closed: !!s.c, points };
}
function PathP(c: Ctx, p: J, fr: number, st: number): Prop<MPath> {
  if (!p) return prop({ closed: false, points: [] });
  if (!isKeyed(p)) return prop(pathOf(p.k));
  const ks: J[] = p.k; const keys: Keyframe<MPath>[] = [];
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i]; const s = k.s ?? ks[i - 1]?.e; if (!s) continue;
    const prev = i > 0 ? ks[i - 1] : null;
    keys.push({ id: uid('k'), t: (Number(k.t) + st) / fr, v: pathOf(s), interp: k.h === 1 ? 'hold' : 'bezier', out: k.o ? [first(k.o.x, 1 / 3), first(k.o.y, 1 / 3)] : [...LINEAR_OUT] as Vec2, in: prev?.i ? [first(prev.i.x, 2 / 3), first(prev.i.y, 2 / 3)] : [...LINEAR_IN] as Vec2 });
  }
  c.report.keyframes += keys.length;
  return keys.length > 1 ? { v: keys[0].v, k: keys } : prop(keys[0]?.v ?? { closed: false, points: [] });
}
const v3 = (d = 0) => (v: number[]): Vec3 => [v[0] ?? d, v[1] ?? d, v[2] ?? (d === 100 ? 100 : 0)];
const n1 = (v: number[]) => v[0] ?? 0;

/** separated X / Y position → one position property (keys at the union of both key times) */
function separatedPosition(c: Ctx, p: J, fr: number, st: number): Prop<Vec3> {
  const px = P(c, p.x, n1, fr, st, 0), py = P(c, p.y, n1, fr, st, 0), pz = P(c, p.z, n1, fr, st, 0);
  const times = [...new Set([...px.k, ...py.k, ...pz.k].map((k) => Math.round(k.t * 1e6) / 1e6))].sort((a, b) => a - b);
  if (!times.length) return prop<Vec3>([px.v, py.v, pz.v]);
  const at = (q: Prop<number>, t: number) => {
    if (!q.k.length) return q.v;
    if (t <= q.k[0].t) return q.k[0].v; const l = q.k[q.k.length - 1]; if (t >= l.t) return l.v;
    for (let i = 0; i < q.k.length - 1; i++) { const a = q.k[i], b = q.k[i + 1]; if (t >= a.t && t <= b.t) return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t || 1); }
    return q.v;
  };
  const ease = (t: number) => px.k.find((k) => Math.abs(k.t - t) < 1e-6) ?? py.k.find((k) => Math.abs(k.t - t) < 1e-6);
  const keys = times.map((t) => { const e = ease(t); return { id: uid('k'), t, v: [at(px, t), at(py, t), at(pz, t)] as Vec3, interp: e?.interp ?? 'bezier', out: e?.out ?? [...LINEAR_OUT] as Vec2, in: e?.in ?? [...LINEAR_IN] as Vec2 } as Keyframe<Vec3>; });
  return keys.length > 1 ? { v: keys[0].v, k: keys } : prop(keys[0].v);
}

function transformOf(c: Ctx, ks: J, fr: number, st: number, three: boolean) {
  const t = defaultTransform();
  if (!ks) return t;
  t.anchor = P(c, ks.a, v3(0), fr, st, [0, 0, 0]);
  t.position = ks.p?.s ? separatedPosition(c, ks.p, fr, st) : P(c, ks.p, v3(0), fr, st, [0, 0, 0]);
  t.scale = P(c, ks.s, v3(100), fr, st, [100, 100, 100]);
  t.rotation = P(c, ks.r ?? ks.rz, n1, fr, st, 0);
  if (three) { t.rotationX = P(c, ks.rx, n1, fr, st, 0); t.rotationY = P(c, ks.ry, n1, fr, st, 0); if (ks.or) c.skip('3D Orientation'); }
  t.opacity = P(c, ks.o, n1, fr, st, 100);
  if (ks.sk && (isKeyed(ks.sk) || first(ks.sk.k) !== 0)) { t.skew = P(c, ks.sk, n1, fr, st, 0); t.skewAxis = P(c, ks.sa, n1, fr, st, 0); }
  return t;
}

function masksOf(c: Ctx, l: J, fr: number, st: number): Mask[] {
  if (!Array.isArray(l.masksProperties)) return [];
  return l.masksProperties.map((m: J, i: number) => ({
    id: uid('mask'), name: m.nm || `Mask ${i + 1}`, mode: m.mode === 's' ? 'subtract' : m.mode === 'i' ? 'intersect' : m.mode === 'n' ? 'none' : 'add', inverted: !!m.inv,
    path: PathP(c, m.pt, fr, st), feather: prop(0), opacity: P(c, m.o, n1, fr, st, 100), expansion: P(c, m.x, n1, fr, st, 0),
  } as Mask));
}

function effectsOf(c: Ctx, l: J, fr: number, st: number): Effect[] {
  if (!Array.isArray(l.ef)) return [];
  const out: Effect[] = [];
  for (const e of l.ef) {
    const mn: string = e.mn ?? '';
    const ps: J[] = Array.isArray(e.ef) ? e.ef : [];
    const pv = (i: number) => ps[i]?.v;
    const num = (i: number, d: number) => P(c, pv(i), n1, fr, st, d) as Prop<number>;
    const col = (i: number) => P(c, pv(i), (v) => colorOf(v), fr, st, '#000000') as Prop<string>;
    let fx: Effect | null = null;
    if (/Gaussian Blur/i.test(mn)) { fx = newEffect('gaussian-blur'); if (fx) fx.params.blurriness = num(0, 10) as Prop<number>; }
    else if (/Drop Shadow/i.test(mn)) { fx = newEffect('drop-shadow'); if (fx) { fx.params.color = col(0); fx.params.opacity = P(c, pv(1), (v) => ((v[0] ?? 128) / 255) * 100, fr, st, 50); fx.params.direction = num(2, 135); fx.params.distance = num(3, 5); fx.params.softness = num(4, 0); } }
    else if (mn === 'ADBE Fill') { fx = newEffect('fill'); if (fx) { fx.params.color = col(2); fx.params.opacity = P(c, pv(6), (v) => (v[0] ?? 1) * 100, fr, st, 100); } }
    else if (mn === 'ADBE Tint') { fx = newEffect('tint'); if (fx) { fx.params.black = col(0); fx.params.white = col(1); fx.params.amount = num(2, 100); } }
    else if (/Glo2|Glow/i.test(mn)) fx = newEffect('glow');
    if (fx) { fx.enabled = e.en !== 0; out.push(fx); } else c.skip(`Effect: ${e.nm || mn || 'unknown'}`);
  }
  return out;
}

/** common layer settings (times, transform, switches) */
function finish(c: Ctx, l: J, layer: MLayer, fr: number): MLayer {
  const st = Number(l.st ?? 0);
  const three = l.ddd === 1;
  const out: MLayer = {
    ...layer,
    name: l.nm ?? layer.name,
    inPoint: Number(l.ip ?? 0) / fr, outPoint: Math.max(Number(l.ip ?? 0) + 1, Number(l.op ?? 1)) / fr,
    start: st / fr,
    visible: l.hd !== true,
    blend: BLEND[Number(l.bm ?? 0)] ?? 'normal',
    threeD: three,
    transform: transformOf(c, l.ks, fr, st, three),
    masks: masksOf(c, l, fr, st),
    effects: effectsOf(c, l, fr, st),
  } as MLayer;
  if (l.ao === 1) out.autoOrient = true;
  if (l.tm && (layer.type === 'precomp' || layer.type === 'video')) out.timeRemap = P(c, l.tm, n1, fr, st, 0);
  else if (l.tm) c.skip('Time Remap on this layer type');
  c.report.layers++;
  return out;
}

async function imageLayer(c: Ctx, comp: Composition, l: J, fr: number): Promise<MLayer | null> {
  const a = (c.root.assets ?? []).find((x: J) => x.id === l.refId);
  if (!a) return null;
  let id = c.imageAssets.get(a.id);
  if (!id) {
    const name: string = a.p ?? 'image.png';
    let blob: Blob | null = null;
    if (typeof a.p === 'string' && a.p.startsWith('data:')) { try { blob = await (await fetch(a.p)).blob(); } catch { blob = null; } }
    else blob = c.files.get(name.toLowerCase()) ?? c.files.get(`${a.u ?? ''}${name}`.toLowerCase()) ?? null;
    if (!blob) { c.report.missing.push(name); return null; }
    const meta = await importAsset(blob, a.nm || (name.startsWith('data:') ? `${a.id}.png` : name));
    meta.width = a.w || meta.width; meta.height = a.h || meta.height;
    c.assets[meta.id] = meta; c.assetOrder.push(meta.id); c.imageAssets.set(a.id, meta.id); id = meta.id;
  }
  const meta = c.assets[id];
  const base = newMediaLayer(comp, meta);
  return finish(c, l, base, fr);
}

function textLayer(c: Ctx, comp: Composition, l: J, fr: number): MLayer {
  const docs: J[] = l.t?.d?.k ?? [];
  const d = docs[0]?.s ?? {};
  if (docs.length > 1) c.skip('Animated Source Text (first value used)');
  const animsJ: J[] = Array.isArray(l.t?.a) ? l.t.a : [];
  const text = String(d.t ?? '').replace(/\r\n?|\u0003/g, '\n');
  const font = c.fonts.get(d.f) ?? { family: 'Inter', weight: 400, italic: false };
  const size = Number(d.s ?? 48);
  const base = newText(comp, text || ' ', 0, { size, color: colorOf(arr(d.fc ?? [1, 1, 1])) });
  const tl = finish(c, l, base, fr) as Extract<MLayer, { type: 'text' }>;
  tl.text = {
    ...tl.text, font: font.family, weight: font.weight, italic: font.italic,
    align: d.j === 1 ? 'right' : d.j === 2 ? 'center' : 'left',
    tracking: prop(((Number(d.tr ?? 0)) / 1000) * size), leading: prop(Number(d.lh ?? size * 1.2)),
    strokeOn: !!d.sc && Number(d.sw ?? 0) > 0, strokeColor: prop(colorOf(arr(d.sc ?? [0, 0, 0]))), strokeWidth: prop(Number(d.sw ?? 0)),
  };
  if (animsJ.length) {
    const st = Number(l.st ?? 0);
    const count = Math.max(1, text.replace(/\n/g, '').length);
    tl.text.animators = animsJ.map((a, i): TextRangeAnimator => {
      const sel = a.s ?? {}; const ap = a.a ?? {};
      const pct = (q: J, d: number) => P(c, q, (v) => (sel.r === 2 ? ((v[0] ?? 0) / count) * 100 : v[0] ?? d), fr, st, d);
      const shapes: TextRangeAnimator['shape'][] = ['square', 'square', 'rampUp', 'rampDown', 'triangle', 'round', 'smooth'];
      if (ap.a || ap.sk || ap.sc || ap.sw || ap.fh || ap.fs || ap.fb) c.skip('Some text animator properties (anchor, skew, stroke, hue)');
      return {
        id: uid('tan'), name: a.nm || `Animator ${i + 1}`,
        basedOn: sel.b === 3 ? 'words' : sel.b === 4 ? 'lines' : 'chars', shape: shapes[Number(sel.sh ?? 1)] ?? 'square',
        start: pct(sel.s, 0), end: pct(sel.e, 100), offset: pct(sel.o, 0), amount: sel.a ? P(c, sel.a, n1, fr, st, 100) : prop(100),
        position: ap.p ? P(c, ap.p, (v) => [v[0] ?? 0, v[1] ?? 0] as Vec2, fr, st, [0, 0]) : null,
        scale: ap.s ? P(c, ap.s, (v) => v[0] ?? 100, fr, st, 100) : null,
        rotation: ap.r || ap.rz ? P(c, ap.r ?? ap.rz, n1, fr, st, 0) : null,
        opacity: ap.o ? P(c, ap.o, n1, fr, st, 100) : null,
        fill: ap.fc ? P(c, ap.fc, colorOf, fr, st, '#ffffff') : null,
        tracking: ap.t ? P(c, ap.t, n1, fr, st, 0) : null,
      };
    });
  }
  if (Array.isArray(d.sz) && Array.isArray(d.ps)) {
    // paragraph (box) text: the first baseline sits one ascent below the top of the box
    const bx = d.ps[0] + (d.j === 2 ? d.sz[0] / 2 : d.j === 1 ? d.sz[0] : 0), by = d.ps[1] + size * 0.8;
    const a = tl.transform.anchor;
    tl.transform = { ...tl.transform, anchor: { v: [a.v[0] - bx, a.v[1] - by, a.v[2]], k: a.k.map((k) => ({ ...k, v: [k.v[0] - bx, k.v[1] - by, k.v[2]] as Vec3 })) } };
  }
  return tl;
}

interface Style { fill?: J; stroke?: J; trim?: J; round?: J; rep?: J }
/** Lottie gradient: colour stops [offset, r, g, b, …] followed by opacity stops [offset, alpha, …] */
function gradOf(c: Ctx, g: J, fr: number, st: number): Gradient {
  const n = Math.max(1, Number(g.g?.p ?? 2));
  const raw = g.g?.k; const flat: number[] = isKeyed(raw) ? arr(raw.k[0]?.s) : arr(raw?.k ?? []);
  if (isKeyed(raw)) c.skip('Animated gradient colours (first value used)');
  const alphas: [number, number][] = [];
  for (let i = n * 4; i + 1 < flat.length; i += 2) alphas.push([flat[i], flat[i + 1]]);
  const alphaAt = (o: number) => {
    if (!alphas.length) return 1;
    if (o <= alphas[0][0]) return alphas[0][1];
    for (let i = 0; i < alphas.length - 1; i++) { const [a0, v0] = alphas[i], [a1, v1] = alphas[i + 1]; if (o <= a1) return v0 + ((v1 - v0) * (o - a0)) / (a1 - a0 || 1); }
    return alphas[alphas.length - 1][1];
  };
  const stops = Array.from({ length: n }, (_, i) => { const o = flat[i * 4] ?? i / Math.max(1, n - 1); return { o, c: colorOf([flat[i * 4 + 1] ?? 1, flat[i * 4 + 2] ?? 1, flat[i * 4 + 3] ?? 1]), a: alphaAt(o) }; });
  return { type: g.t === 2 ? 'radial' : 'linear', start: P(c, g.s, (v) => [v[0] ?? 0, v[1] ?? 0] as Vec2, fr, st, [0, 0]), end: P(c, g.e, (v) => [v[0] ?? 100, v[1] ?? 0] as Vec2, fr, st, [100, 0]), stops };
}
/** a shape layer becomes a null (its transform) with one shape layer per rectangle / ellipse / star / path,
 *  and a null for each transformed group, so the result moves exactly like the original */
function shapeLayers(c: Ctx, comp: Composition, l: J, fr: number): MLayer[] {
  const st = Number(l.st ?? 0);
  const root = finish(c, l, { ...newNull(comp), name: l.nm ?? 'Shape Layer' } as MLayer, fr);
  const out: MLayer[] = [];
  const groupNulls: MLayer[] = [];
  const walk = (items: J[], parentId: string, inherited: Style, groupOpacity: Prop<number> | null) => {
    if (!Array.isArray(items)) return;
    const style: Style = { ...inherited };
    for (const it of items) {
      if (it.hd) continue;
      if (it.ty === 'fl' || it.ty === 'gf') style.fill = it; else if (it.ty === 'st' || it.ty === 'gs') style.stroke = it; else if (it.ty === 'tm') style.trim = it;
      else if (it.ty === 'rd') style.round = it; else if (it.ty === 'rp') style.rep = it; else if (it.ty === 'mm') c.skip('Merge Paths');
    }
    for (const it of items) {
      if (it.hd) continue;
      if (it.ty === 'gr') {
        const tr = (it.it ?? []).find((x: J) => x.ty === 'tr');
        const g = { ...newNull(comp), name: it.nm ?? 'Group', parentId, inPoint: root.inPoint, outPoint: root.outPoint, start: root.start } as MLayer;
        g.transform = transformOf(c, tr, fr, st, false);
        const op = g.transform.opacity; g.transform = { ...g.transform, opacity: prop(100) };
        groupNulls.push(g);
        walk(it.it ?? [], g.id, style, op.k.length || op.v !== 100 ? op : groupOpacity);
        continue;
      }
      const kind: ShapeKind | null = it.ty === 'rc' ? 'rect' : it.ty === 'el' ? 'ellipse' : it.ty === 'sr' ? (Number(it.sy) === 2 ? 'polygon' : 'star') : it.ty === 'sh' ? 'path' : null;
      if (!kind) continue;
      const s = newShape(comp, kind, 0);
      const layer = { ...s, name: it.nm ?? s.name, parentId, inPoint: root.inPoint, outPoint: root.outPoint, start: root.start, transform: defaultTransform() } as Extract<MLayer, { type: 'shape' }>;
      const sh = { ...layer.shape };
      if (kind === 'rect') { sh.size = P(c, it.s, (v) => [v[0] ?? 100, v[1] ?? 100] as Vec2, fr, st, [100, 100]); sh.roundness = P(c, it.r, n1, fr, st, 0); layer.transform.position = P(c, it.p, v3(0), fr, st, [0, 0, 0]); }
      else if (kind === 'ellipse') { sh.size = P(c, it.s, (v) => [v[0] ?? 100, v[1] ?? 100] as Vec2, fr, st, [100, 100]); layer.transform.position = P(c, it.p, v3(0), fr, st, [0, 0, 0]); }
      else if (kind === 'star' || kind === 'polygon') {
        sh.size = P(c, it.or, (v) => [(v[0] ?? 50) * 2, (v[0] ?? 50) * 2] as Vec2, fr, st, [100, 100]);
        sh.sides = Math.max(3, Math.round(first(it.pt?.k, 5)));
        const or = first(it.or?.k, 50), ir = first(it.ir?.k, 25);
        sh.innerRadius = prop(or ? (ir / or) * 100 : 50);
        layer.transform.position = P(c, it.p, v3(0), fr, st, [0, 0, 0]);
        layer.transform.rotation = P(c, it.r, n1, fr, st, 0);
      } else { sh.path = PathP(c, it.ks, fr, st); }
      const f = style.fill, k = style.stroke;
      sh.fillOn = !!f; sh.strokeOn = !!k;
      if (f) { if (f.ty === 'gf') { sh.fillGradient = gradOf(c, f, fr, st); sh.fill = prop(sh.fillGradient.stops[0]?.c ?? '#ffffff'); } else sh.fill = P(c, f.c, colorOf, fr, st, '#ffffff'); }
      if (k) { if (k.ty === 'gs') { sh.strokeGradient = gradOf(c, k, fr, st); sh.stroke = prop(sh.strokeGradient.stops[0]?.c ?? '#ffffff'); } else sh.stroke = P(c, k.c, colorOf, fr, st, '#ffffff'); sh.strokeWidth = P(c, k.w, n1, fr, st, 2); }
      if (style.trim) { sh.trimStart = P(c, style.trim.s, n1, fr, st, 0); sh.trimEnd = P(c, style.trim.e, n1, fr, st, 100); sh.trimOffset = P(c, style.trim.o, n1, fr, st, 0); }
      if (style.round) sh.roundCorners = P(c, style.round.r, n1, fr, st, 0);
      if (style.rep) {
        const r = style.rep, tr = r.tr ?? {};
        sh.repeater = {
          copies: P(c, r.c, n1, fr, st, 3), offset: P(c, r.o, n1, fr, st, 0),
          anchor: P(c, tr.a, (v) => [v[0] ?? 0, v[1] ?? 0] as Vec2, fr, st, [0, 0]), position: P(c, tr.p, (v) => [v[0] ?? 0, v[1] ?? 0] as Vec2, fr, st, [0, 0]),
          scale: P(c, tr.s, (v) => [v[0] ?? 100, v[1] ?? 100] as Vec2, fr, st, [100, 100]), rotation: P(c, tr.r, n1, fr, st, 0),
          startOpacity: P(c, tr.so, n1, fr, st, 100), endOpacity: P(c, tr.eo, n1, fr, st, 100), composite: r.m === 1 ? 'above' : 'below',
        };
      }
      layer.shape = sh;
      // opacity: the fill / stroke opacity and the group's opacity
      const op = f ? P(c, f.o, n1, fr, st, 100) : k ? P(c, k.o, n1, fr, st, 100) : prop(100);
      layer.transform.opacity = op.k.length ? op : groupOpacity && !groupOpacity.k.length ? prop((op.v * groupOpacity.v) / 100) : groupOpacity ?? op;
      out.push(layer);
      c.report.layers++;
    }
  };
  walk(l.shapes ?? [], root.id, {}, null);
  // a null cannot blend or carry effects: the shapes take the layer's blending mode and effects
  for (const g of out) { g.blend = root.blend; if (root.effects.length) g.effects = root.effects.map((e) => ({ ...e, id: uid('fx') })); }
  if (root.masks.length) c.skip('Masks on shape layers');
  root.effects = []; root.masks = [];
  return [...out, ...groupNulls, root];
}

async function buildComp(c: Ctx, name: string, w: number, h: number, fr: number, ip: number, op: number, layersJ: J[]): Promise<Composition> {
  const comp = newComposition({ name, width: Math.round(w) || 1920, height: Math.round(h) || 1080, fps: Math.round(fr * 1000) / 1000 || 30, duration: Math.max(1 / fr, op / fr) });
  comp.workStart = ip / fr; comp.workEnd = comp.duration; comp.motionBlur = false;
  c.comps[comp.id] = comp; c.compOrder.push(comp.id); c.report.comps++;
  const byInd = new Map<number, string>();
  const made: { j: J; layers: MLayer[] }[] = [];
  for (const l of layersJ ?? []) {
    let ls: MLayer[] = [];
    try {
      switch (l.ty) {
        case 0: {
          const a = (c.root.assets ?? []).find((x: J) => x.id === l.refId);
          if (!a) break;
          let sub = c.precomps.get(a.id);
          if (!sub) { const sc = await buildComp(c, a.nm ?? l.nm ?? a.id, l.w ?? a.w ?? comp.width, l.h ?? a.h ?? comp.height, fr, 0, Math.max(Number(l.op ?? 0) - Number(l.st ?? 0), op), a.layers ?? []); sub = sc.id; c.precomps.set(a.id, sub); }
          const p = newPrecompLayer(comp, c.comps[sub]);
          const pl = finish(c, l, p, fr);
          if (l.sr && l.sr !== 1) pl.speed = 1 / Number(l.sr);
          ls = [pl]; break;
        }
        case 1: ls = [finish(c, l, newSolid(comp, l.sc ?? '#000000', 0, Number(l.sw ?? comp.width), Number(l.sh ?? comp.height), l.nm ?? 'Solid'), fr)]; break;
        case 2: { const il = await imageLayer(c, comp, l, fr); if (il) ls = [il]; break; }
        case 3: ls = [finish(c, l, newNull(comp), fr)]; break;
        case 4: ls = shapeLayers(c, comp, l, fr); break;
        case 5: ls = [textLayer(c, comp, l, fr)]; break;
        case 13: c.skip('Camera layers'); break;
        default: c.skip(`Layer type ${l.ty}`);
      }
    } catch (e) { console.warn('Lottie layer failed', l?.nm, e); c.skip(`Layer “${l?.nm ?? '?'}”`); }
    if (!ls.length) continue;
    const main = ls[ls.length - 1];
    if (typeof l.ind === 'number') byInd.set(l.ind, main.id);
    made.push({ j: l, layers: ls });
  }
  // parenting, track mattes, matte layers
  made.forEach((m, i) => {
    const main = m.layers[m.layers.length - 1];
    if (typeof m.j.parent === 'number' && byInd.has(m.j.parent)) main.parentId = byInd.get(m.j.parent)!;
    if (m.j.tt && MATTE[m.j.tt]) {
      const src = typeof m.j.tp === 'number' ? byInd.get(m.j.tp) : made[i - 1]?.layers[made[i - 1].layers.length - 1]?.id;
      if (src) for (const x of m.layers) if (x.type !== 'null') x.matte = { id: src, mode: MATTE[m.j.tt] };
    }
    if (m.j.td === 1) for (const x of m.layers) x.visible = false;
  });
  comp.layers = made.flatMap((m) => m.layers);
  // a shape layer split into several layers: they all share the original matte source (its top-level null cannot be a matte)
  for (const m of made) if (m.j.td === 1 && m.layers.length > 1) {
    const geo = m.layers.find((x) => x.type === 'shape');
    if (geo) for (const l of comp.layers) if (l.matte?.id === m.layers[m.layers.length - 1].id) l.matte = { ...l.matte, id: geo.id };
  }
  return comp;
}

/** Converts a Lottie JSON (Bodymovin export from After Effects) into Motion compositions. */
export async function importLottie(json: J, files: File[] = []): Promise<{ comps: Record<string, Composition>; compOrder: string[]; assets: MotionProject['assets']; assetOrder: string[]; mainId: string; report: ImportReport }> {
  const fileMap = new Map(files.map((f) => [f.name.toLowerCase(), f]));
  const c = new Ctx(json, fileMap);
  for (const f of json.fonts?.list ?? []) {
    const fam = FONTS.find((x) => x.family.toLowerCase() === String(f.fFamily ?? '').toLowerCase())?.family ?? 'Inter';
    const style = String(f.fStyle ?? '');
    c.fonts.set(f.fName, { family: fam, weight: /black|heavy/i.test(style) ? 900 : /extra ?bold/i.test(style) ? 800 : /semi ?bold|demi/i.test(style) ? 600 : /bold/i.test(style) ? 700 : /medium/i.test(style) ? 500 : /light/i.test(style) ? 300 : 400, italic: /italic|oblique/i.test(style) });
  }
  const fr = Number(json.fr) || 30;
  const main = await buildComp(c, json.nm || 'Lottie', json.w, json.h, fr, Number(json.ip ?? 0), Number(json.op ?? fr * 5), json.layers);
  for (const m of json.markers ?? []) main.markers.push({ id: uid('mk'), t: Number(m.tm ?? 0) / fr, label: String(m.cm ?? '') });
  // main comp first in the Project panel
  c.compOrder = [main.id, ...c.compOrder.filter((id) => id !== main.id)];
  return { comps: c.comps, compOrder: c.compOrder, assets: c.assets, assetOrder: c.assetOrder, mainId: main.id, report: c.report };
}
