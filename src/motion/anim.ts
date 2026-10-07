// Keyframe animation engine: evaluates properties at a time and edits keyframes.
import type { Interp, Keyframe, MPath, Prop, PropValue, Vec2 } from './types';
import { hexToRgb, rgbToHex } from '../utils/color';
import { uid } from '../utils/id';

export const LINEAR_OUT: Vec2 = [1 / 3, 1 / 3];
export const LINEAR_IN: Vec2 = [2 / 3, 2 / 3];
/** "Easy ease": 33% influence, zero speed at the key */
export const EASE_OUT: Vec2 = [0.33, 0];
export const EASE_IN: Vec2 = [0.67, 1];

export const prop = <T extends PropValue>(v: T): Prop<T> => ({ v, k: [] });
export const isAnimated = (p: Prop | undefined | null): boolean => !!p && p.k.length > 0;

// ---------- easing ----------
/** cubic-bezier(x1, y1, x2, y2) evaluated at progress u (like CSS); y may overshoot for elastic curves */
export function bezierEase(x1: number, y1: number, x2: number, y2: number, u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  if (x1 === y1 && x2 === y2) return u; // linear handles
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sy = (s: number) => ((ay * s + by) * s + cy) * s;
  const dsx = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  let s = u;
  for (let i = 0; i < 8; i++) {
    const e = sx(s) - u; if (Math.abs(e) < 1e-6) return sy(s);
    const d = dsx(s); if (Math.abs(d) < 1e-6) break;
    s -= e / d;
  }
  let lo = 0, hi = 1; s = u;
  for (let i = 0; i < 30; i++) { const x = sx(s); if (Math.abs(x - u) < 1e-6) break; if (x < u) lo = s; else hi = s; s = (lo + hi) / 2; }
  return sy(s);
}

// ---------- value interpolation ----------
function lerpValue(a: PropValue, b: PropValue, s: number): PropValue {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * s;
  if (typeof a === 'string' && typeof b === 'string') {
    if (!a.startsWith('#') || !b.startsWith('#')) return s < 1 ? a : b;
    const p = hexToRgb(a), q = hexToRgb(b);
    const c = (x: number, y: number) => Math.max(0, Math.min(255, Math.round(x + (y - x) * s)));
    return rgbToHex({ r: c(p.r, q.r), g: c(p.g, q.g), b: c(p.b, q.b) });
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => x + ((b[i] ?? x) - x) * s) as PropValue;
  if (isPath(a) && isPath(b)) return lerpPath(a, b, s);
  return s < 1 ? a : b;
}

export const isPath = (v: unknown): v is MPath => !!v && typeof v === 'object' && Array.isArray((v as MPath).points);

export function lerpPath(a: MPath, b: MPath, s: number): MPath {
  if (a.points.length !== b.points.length) return s < 1 ? a : b;
  const l = (x: number, y: number) => x + (y - x) * s;
  return {
    closed: s < 0.5 ? a.closed : b.closed,
    points: a.points.map((p, i) => { const q = b.points[i]; return { x: l(p.x, q.x), y: l(p.y, q.y), ix: l(p.ix, q.ix), iy: l(p.iy, q.iy), ox: l(p.ox, q.ox), oy: l(p.oy, q.oy) }; }),
  };
}

// spatial (motion path) interpolation along a cubic bezier with constant speed
const lutCache = new WeakMap<object, number[]>();
function spatial(k0: Keyframe, k1: Keyframe, s: number): PropValue {
  const a = k0.v as number[], b = k1.v as number[];
  const so = k0.so ?? [0, 0], si = k1.si ?? [0, 0];
  const n = a.length;
  const P = (u: number) => {
    const out: number[] = [];
    for (let d = 0; d < n; d++) {
      const p0 = a[d], p3 = b[d];
      const p1 = p0 + (d < 2 ? so[d] : 0), p2 = p3 + (d < 2 ? si[d] : 0);
      const m = 1 - u;
      out.push(m * m * m * p0 + 3 * m * m * u * p1 + 3 * m * u * u * p2 + u * u * u * p3);
    }
    return out;
  };
  // arc length lookup table, cached per segment
  let lut = lutCache.get(k0);
  const sig = `${a}|${b}|${so}|${si}`;
  if (!lut || (lut as unknown as { sig?: string }).sig !== sig) {
    lut = [0]; let prev = P(0), total = 0;
    for (let i = 1; i <= 40; i++) { const cur = P(i / 40); total += Math.hypot(cur[0] - prev[0], cur[1] - prev[1], (cur[2] ?? 0) - (prev[2] ?? 0)); lut.push(total); prev = cur; }
    (lut as unknown as { sig?: string }).sig = sig;
    lutCache.set(k0, lut);
  }
  const total = lut[lut.length - 1];
  if (total < 1e-6) return lerpValue(a as PropValue, b as PropValue, s);
  const target = s * total;
  let i = 1; while (i < lut.length - 1 && lut[i] < target) i++;
  const seg = lut[i] - lut[i - 1];
  const u = (i - 1 + (seg > 0 ? (target - lut[i - 1]) / seg : 0)) / 40;
  return P(Math.max(0, Math.min(1, u))) as PropValue;
}
const hasSpatial = (k0: Keyframe, k1: Keyframe) => !!((k0.so && (k0.so[0] || k0.so[1])) || (k1.si && (k1.si[0] || k1.si[1])));

/** Eased progress of the segment k0 → k1 at time t (0..1, may overshoot with custom curves). */
export function segmentProgress(k0: Keyframe, k1: Keyframe, t: number): number {
  const d = k1.t - k0.t; if (d <= 0) return 1;
  const u = (t - k0.t) / d;
  if (k0.interp === 'hold') return 0;
  if (k0.interp === 'linear' && isLinearIn(k1)) return u;
  const o = k0.interp === 'linear' ? LINEAR_OUT : k0.out;
  const i = isLinearIn(k1) && k1.interp === 'linear' ? LINEAR_IN : k1.in;
  return bezierEase(o[0], o[1], i[0], i[1], u);
}
const isLinearIn = (k: Keyframe) => k.in[0] === LINEAR_IN[0] && k.in[1] === LINEAR_IN[1];

/** Value of a property at time t. */
export function valueAt<T extends PropValue>(p: Prop<T>, t: number): T {
  const k = p.k;
  if (!k.length) return p.v;
  if (t <= k[0].t) return k[0].v;
  const last = k[k.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  // binary search for the segment
  let lo = 0, hi = k.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (k[m].t <= t) { i = m; lo = m + 1; } else hi = m - 1; }
  const k0 = k[i], k1 = k[i + 1];
  if (k0.interp === 'hold') return k0.v;
  const s = segmentProgress(k0, k1, t);
  if (Array.isArray(k0.v) && hasSpatial(k0, k1)) return spatial(k0, k1, s) as T;
  return lerpValue(k0.v, k1.v, s) as T;
}

export const num = (p: Prop<number>, t: number) => valueAt(p, t);

// ---------- editing ----------
export function makeKey<T extends PropValue>(t: number, v: T, interp: Interp = 'linear'): Keyframe<T> {
  return { id: uid('k'), t, v, interp, out: [...LINEAR_OUT] as Vec2, in: [...LINEAR_IN] as Vec2 };
}

const sortKeys = <T extends PropValue>(k: Keyframe<T>[]) => [...k].sort((a, b) => a.t - b.t);
export const sameTime = (a: number, b: number, fps: number) => Math.abs(a - b) < 0.5 / fps;

/** Sets the value at time t: updates/creates a keyframe when animated, else the static value. */
export function setAt<T extends PropValue>(p: Prop<T>, t: number, v: T, fps: number): Prop<T> {
  if (!p.k.length) return { ...p, v };
  const i = p.k.findIndex((k) => sameTime(k.t, t, fps));
  if (i >= 0) return { ...p, k: p.k.map((k, j) => (j === i ? { ...k, v } : k)) };
  const prev = [...p.k].reverse().find((k) => k.t < t);
  const key = makeKey(t, v, prev?.interp === 'hold' ? 'hold' : 'linear');
  return { ...p, k: sortKeys([...p.k, key]) };
}

/** Stopwatch: turns animation on (adds a key at t with the current value) or off (keeps the value at t). */
export function toggleAnimated<T extends PropValue>(p: Prop<T>, t: number): Prop<T> {
  if (p.k.length) return { v: valueAt(p, t), k: [] };
  return { v: p.v, k: [makeKey(t, p.v)] };
}

/** Adds a keyframe at t with the current animated value (or removes the one already there). */
export function toggleKeyAt<T extends PropValue>(p: Prop<T>, t: number, fps: number): Prop<T> {
  const i = p.k.findIndex((k) => sameTime(k.t, t, fps));
  if (i >= 0) {
    const k = p.k.filter((_, j) => j !== i);
    return k.length ? { ...p, k } : { v: p.k[i].v, k: [] };
  }
  return { ...p, k: sortKeys([...p.k, makeKey(t, valueAt(p, t))]) };
}

export function removeKeys<T extends PropValue>(p: Prop<T>, ids: Set<string>, t: number): Prop<T> {
  const k = p.k.filter((x) => !ids.has(x.id));
  if (k.length === p.k.length) return p;
  return k.length ? { ...p, k } : { v: valueAt(p, t), k: [] };
}

export function shiftKeys<T extends PropValue>(p: Prop<T>, ids: Set<string>, dt: number, fps: number): Prop<T> {
  if (!p.k.some((k) => ids.has(k.id))) return p;
  const snap = (t: number) => Math.round(t * fps) / fps;
  const moved = p.k.map((k) => (ids.has(k.id) ? { ...k, t: Math.max(0, snap(k.t + dt)) } : k));
  // a moved key replaces an unmoved key landing on the same frame
  const kept = moved.filter((k) => ids.has(k.id) || !moved.some((m) => ids.has(m.id) && sameTime(m.t, k.t, fps)));
  return { ...p, k: sortKeys(kept) };
}

export function mapKeys<T extends PropValue>(p: Prop<T>, ids: Set<string>, fn: (k: Keyframe<T>) => Keyframe<T>): Prop<T> {
  if (!p.k.some((k) => ids.has(k.id))) return p;
  return { ...p, k: p.k.map((k) => (ids.has(k.id) ? fn(k) : k)) };
}

export type EasePreset = 'linear' | 'hold' | 'easeIn' | 'easeOut' | 'easeInOut' | 'bezier';
export function applyEase<T extends PropValue>(k: Keyframe<T>, e: EasePreset): Keyframe<T> {
  switch (e) {
    case 'linear': return { ...k, interp: 'linear', out: [...LINEAR_OUT] as Vec2, in: [...LINEAR_IN] as Vec2 };
    case 'hold': return { ...k, interp: 'hold' };
    case 'easeIn': return { ...k, interp: 'bezier', in: [...EASE_IN] as Vec2 };
    case 'easeOut': return { ...k, interp: 'bezier', out: [...EASE_OUT] as Vec2 };
    case 'easeInOut': return { ...k, interp: 'bezier', in: [...EASE_IN] as Vec2, out: [...EASE_OUT] as Vec2 };
    case 'bezier': return { ...k, interp: 'bezier' };
  }
}

/** Builds an animated prop from [time, value] pairs (used by presets). */
export function animate<T extends PropValue>(base: Prop<T>, keys: [number, T, EasePreset?][]): Prop<T> {
  const k = keys.map(([t, v, e]) => applyEase(makeKey(t, v), e ?? 'linear'));
  return { v: base.v, k: sortKeys(k) };
}

/** Frame-snapped time. */
export const snapTime = (t: number, fps: number) => Math.round(t * fps) / fps;

export function formatTimecode(t: number, fps: number): string {
  const f = Math.round(t * fps);
  const ff = f % Math.round(fps), s = Math.floor(f / Math.round(fps));
  const ss = s % 60, mm = Math.floor(s / 60) % 60, hh = Math.floor(s / 3600);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(hh)}:${p(mm)}:${p(ss)}:${p(ff)}`;
}

export function parseTimecode(s: string, fps: number): number | null {
  const parts = s.trim().split(/[:;.]/).map(Number);
  if (parts.some((x) => !Number.isFinite(x))) return null;
  if (parts.length === 1) return parts[0] / fps; // frames
  const [ff, ss = 0, mm = 0, hh = 0] = [...parts].reverse();
  return hh * 3600 + mm * 60 + ss + ff / fps;
}
