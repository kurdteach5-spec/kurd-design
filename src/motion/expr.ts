// After Effects-style expressions: a short script on a property that computes its value from time,
// the keyframed value and helper functions (wiggle, loopOut, linear, ease, random…). Lottie files from
// Bodymovin carry expressions in this form too ($bm_rt, $bm_sum…), so they play the same way here.
import type { Keyframe, Prop, PropValue } from './types';
import { hexToRgb, rgbToHex } from '../utils/color';

type Num = number | number[];
type Raw = (p: Prop, t: number) => PropValue;

/** composition values the expressions can read (set by the renderer for the composition being drawn) */
export const exprComp = { width: 1920, height: 1080, duration: 10, frameDuration: 1 / 30, name: 'Comp 1' };
export function setExprComp(c: { width: number; height: number; duration: number; fps: number; name: string }) {
  exprComp.width = c.width; exprComp.height = c.height; exprComp.duration = c.duration; exprComp.frameDuration = 1 / (c.fps || 30); exprComp.name = c.name;
}

const errors = new Map<string, string>();
/** last error of an expression (shown under the expression in the UI) */
export const exprError = (src: string) => errors.get(src) ?? null;

// ---------- math helpers ----------
const isArr = Array.isArray;
const zip = (a: Num, b: Num, f: (x: number, y: number) => number): Num => {
  if (isArr(a) && isArr(b)) return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => f(a[i] ?? 0, b[i] ?? 0));
  if (isArr(a)) return a.map((x) => f(x, b as number));
  if (isArr(b)) return b.map((y) => f(a as number, y));
  return f(a, b);
};
const add = (a: Num, b: Num) => zip(a, b, (x, y) => x + y);
const sub = (a: Num, b: Num) => zip(a, b, (x, y) => x - y);
const mul = (a: Num, b: Num) => zip(a, b, (x, y) => x * y);
const div = (a: Num, b: Num) => zip(a, b, (x, y) => x / y);
const clamp = (v: Num, lo: Num, hi: Num) => zip(zip(v, lo, Math.max), hi, Math.min);
const length = (a: Num, b?: Num) => { const d = b === undefined ? a : sub(a, b); return isArr(d) ? Math.hypot(...d) : Math.abs(d); };
const normalize = (a: Num) => { const l = length(a) || 1; return div(a, l); };
const lerpN = (a: Num, b: Num, s: number) => zip(a, b, (x, y) => x + (y - x) * s);
function mapRange(curve: (u: number) => number, args: unknown[]): Num {
  // linear(t, v1, v2) or linear(t, tMin, tMax, v1, v2)
  let t = args[0] as number, t0 = 0, t1 = 1, v1: Num, v2: Num;
  if (args.length >= 5) { t0 = args[1] as number; t1 = args[2] as number; v1 = args[3] as Num; v2 = args[4] as Num; }
  else { v1 = args[1] as Num; v2 = args[2] as Num; }
  if (t1 < t0) { [t0, t1] = [t1, t0]; [v1, v2] = [v2, v1]; t = t0 + t1 - t; }
  const u = t1 === t0 ? (t >= t1 ? 1 : 0) : Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
  return lerpN(v1, v2, curve(u));
}
const smooth = (u: number) => u * u * (3 - 2 * u);

// ---------- noise / random ----------
function hash(n: number): number { let x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; x -= Math.floor(x); return x * 2 - 1; }
function noise1(x: number, seed: number): number {
  const i = Math.floor(x), f = x - i; const u = f * f * f * (f * (f * 6 - 15) + 10);
  const g0 = hash(i * 1.37 + seed), g1 = hash((i + 1) * 1.37 + seed);
  return g0 + (g1 - g0) * u;
}
const strHash = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (Math.abs(h) % 9973) / 7.3; };

// ---------- compile ----------
const NAMES = [
  'time', 'value', 'thisComp', 'thisProperty', 'numKeys', 'key', 'nearestKey', 'valueAtTime', 'velocity', 'speed', 'velocityAtTime', 'speedAtTime',
  'wiggle', 'loopOut', 'loopIn', 'loopOutDuration', 'loopInDuration', 'linear', 'ease', 'easeIn', 'easeOut', 'clamp', 'length', 'normalize',
  'add', 'sub', 'mul', 'div', 'random', 'gaussRandom', 'seedRandom', 'noise', 'degreesToRadians', 'radiansToDegrees', 'timeToFrames', 'framesToTime',
  'hexToRgb', 'rgbToHsl', 'hslToRgb', 'posterizeTime', 'inPoint', 'outPoint', 'index', 'width', 'height',
  '$bm_sum', '$bm_sub', '$bm_mul', '$bm_div', '$bm_mod', '$bm_neg', 'sum', '$bm_isInstanceOfArray', 'createPath',
  // shadowed so expressions from files cannot reach the page
  'window', 'document', 'globalThis', 'self', 'top', 'parent', 'frames', 'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'navigator', 'location', 'history', 'importScripts', 'Worker', 'opener', 'open', 'alert', 'confirm', 'prompt', 'postMessage', 'setTimeout', 'setInterval',
];
type Fn = (...a: unknown[]) => unknown;
const cache = new Map<string, Fn | null>();

/** the expression becomes a function that returns the value of its last statement (or $bm_rt) */
function compile(src: string): Fn | null {
  if (cache.has(src)) return cache.get(src)!;
  let fn: Fn | null = null;
  const body = src.trim();
  const tries: string[] = [];
  if (/\$bm_rt\s*=/.test(body)) tries.push(`var $bm_rt;\n${body}\n;return $bm_rt;`);
  tries.push(`var $bm_rt;\nreturn (${body}\n);`);
  // last top-level statement is the result
  const cut = lastStatement(body);
  if (cut > 0) tries.push(`var $bm_rt;\n${body.slice(0, cut)}\n;return (${body.slice(cut).replace(/;\s*$/, '')}\n);`);
  for (const b of tries) { try { fn = new Function(...NAMES, b) as Fn; break; } catch { /* try next form */ } }
  if (!fn) errors.set(src, 'Syntax error');
  cache.set(src, fn);
  return fn;
}
function lastStatement(s: string): number {
  let depth = 0, q: string | null = null, last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') q = c;
    else if (c === '/' && s[i + 1] === '/') { const e = s.indexOf('\n', i); if (e < 0) break; i = e; last = e + 1; }
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { depth--; if (depth === 0 && c === '}') last = i + 1; }
    else if ((c === ';' || c === '\n') && depth === 0 && s.slice(i + 1).trim()) last = i + 1;
  }
  return last;
}

const toNum = (v: PropValue): Num | null => {
  if (typeof v === 'number') return v;
  if (isArr(v)) return v as number[];
  if (typeof v === 'string' && v.startsWith('#')) { const c = hexToRgb(v); return [c.r / 255, c.g / 255, c.b / 255, 1]; }
  return null;
};
function fromNum(r: unknown, base: PropValue): PropValue {
  if (typeof base === 'string') {
    if (isArr(r) && r.length >= 3) { const c = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255); return rgbToHex({ r: c(r[0]), g: c(r[1]), b: c(r[2]) }); }
    return typeof r === 'string' ? r : base;
  }
  if (typeof base === 'number') { const n = isArr(r) ? Number(r[0]) : Number(r); return Number.isFinite(n) ? n : base; }
  if (isArr(base)) {
    if (isArr(r)) return base.map((b, i) => (Number.isFinite(Number(r[i])) ? Number(r[i]) : b)) as PropValue;
    const n = Number(r); return Number.isFinite(n) ? (base.map(() => n) as PropValue) : base;
  }
  return base;
}

/** Runs the property's expression at time t. `raw` gives the keyframed value at any time. */
export function evalExpression(p: Prop, t: number, raw: Raw, ctx?: { inPoint?: number; outPoint?: number; index?: number }): PropValue {
  const base = raw(p, t);
  const src = p.x!;
  const fn = compile(src);
  if (!fn) return base;
  const value = toNum(base) ?? base;
  const k = p.k as Keyframe[];
  const at = (tt: number) => toNum(raw(p, tt)) ?? 0;
  const seed0 = strHash(src);
  let seed = seed0, timeless = false, rng = 0;
  const fr = exprComp.frameDuration;
  const loop = (out: boolean, type = 'cycle', n = 0, dur = 0): Num => {
    if (k.length < 2) return value as Num;
    const first = k[0].t, last = k[k.length - 1].t;
    let a: number, b: number;
    if (out) { b = last; a = dur > 0 ? Math.max(first, last - dur) : k[Math.max(0, n > 0 ? k.length - 1 - n : 0)].t; if (t <= b) return value as Num; }
    else { a = first; b = dur > 0 ? Math.min(last, first + dur) : k[Math.min(k.length - 1, n > 0 ? n : k.length - 1)].t; if (t >= a) return value as Num; }
    const per = b - a; if (per <= 0) return value as Num;
    const d = out ? t - b : a - t;
    const cycles = Math.floor(d / per), rem = d - cycles * per;
    switch (type) {
      case 'pingpong': { const even = cycles % 2 === 0; const tt = out ? (even ? b - rem : a + rem) : (even ? a + rem : b - rem); return at(tt); }
      case 'offset': { const delta = sub(at(b), at(a)); const tt = out ? a + rem : b - rem; return out ? add(at(tt), mul(delta, cycles + 1)) : sub(at(tt), mul(delta, cycles + 1)); }
      case 'continue': { const e = out ? b : a; const v = div(sub(at(e), at(e + (out ? -fr : fr))), out ? fr : -fr); return add(at(e), mul(v, out ? t - b : t - a)); }
      default: { const tt = out ? a + rem : b - rem; return at(tt); }
    }
  };
  const vel = (tt: number) => div(sub(at(tt + fr / 2), at(tt - fr / 2)), fr);
  const helpers: Record<string, unknown> = {
    time: t, value, thisComp: { ...exprComp, layer: () => { throw new Error('thisComp.layer() is not supported'); } },
    thisProperty: { value, numKeys: k.length, key: (i: number) => ({ time: k[i - 1]?.t ?? 0, value: toNum(k[i - 1]?.v ?? base) }), valueAtTime: at },
    numKeys: k.length,
    key: (i: number) => { const kk = k[Math.max(0, Math.min(k.length - 1, i - 1))]; return kk ? { time: kk.t, value: toNum(kk.v), index: i } : { time: 0, value, index: 0 }; },
    nearestKey: (tt: number) => { let best = 0; k.forEach((kk, i) => { if (Math.abs(kk.t - tt) < Math.abs(k[best].t - tt)) best = i; }); const kk = k[best]; return kk ? { time: kk.t, value: toNum(kk.v), index: best + 1 } : { time: 0, value, index: 0 }; },
    valueAtTime: at, velocity: vel(t), speed: length(vel(t)), velocityAtTime: vel, speedAtTime: (tt: number) => length(vel(tt)),
    wiggle: (freq: number, amp: number, octaves = 1, ampMult = 0.5, tt = t) => {
      const v = value as Num; const dims = isArr(v) ? v.length : 1;
      const w = Array.from({ length: dims }, (_, d) => { let s = 0, a = 1, f = freq; for (let o = 0; o < Math.max(1, Math.floor(octaves)); o++) { s += noise1(tt * f, seed0 + d * 17.1 + o * 3.3) * a; a *= ampMult; f *= 2; } return s * amp; });
      return isArr(v) ? v.map((x, d) => x + w[d]) : (v as number) + w[0];
    },
    loopOut: (type = 'cycle', n = 0) => loop(true, type, n), loopIn: (type = 'cycle', n = 0) => loop(false, type, n),
    loopOutDuration: (type = 'cycle', dur = 0) => loop(true, type, 0, dur), loopInDuration: (type = 'cycle', dur = 0) => loop(false, type, 0, dur),
    linear: (...a: unknown[]) => mapRange((u) => u, a), ease: (...a: unknown[]) => mapRange(smooth, a),
    easeIn: (...a: unknown[]) => mapRange((u) => u * u, a), easeOut: (...a: unknown[]) => mapRange((u) => 1 - (1 - u) * (1 - u), a),
    clamp, length, normalize, add, sub, mul, div,
    random: (a?: Num, b?: Num) => {
      const r = () => { rng++; return (hash(seed * 7.7 + rng * 1.13 + (timeless ? 0 : Math.round(t / fr) * 0.371)) + 1) / 2; };
      if (a === undefined) return r();
      if (b === undefined) return isArr(a) ? a.map((x) => x * r()) : (a as number) * r();
      return zip(a, b, (x, y) => x + (y - x) * r());
    },
    gaussRandom: (a?: number, b?: number) => { rng++; const u = (hash(seed + rng) + 1) / 2 || 1e-6, v = (hash(seed * 3 + rng) + 1) / 2; const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) / 6 + 0.5; return a === undefined ? g : b === undefined ? a * g : a + (b - a) * g; },
    seedRandom: (n: number, tl = false) => { seed = seed0 + n * 13.37; timeless = tl; rng = 0; },
    noise: (x: Num) => noise1(isArr(x) ? x[0] + (x[1] ?? 0) * 7.1 : x, 1.7),
    degreesToRadians: (d: number) => (d * Math.PI) / 180, radiansToDegrees: (r: number) => (r * 180) / Math.PI,
    timeToFrames: (tt = t) => Math.round(tt / fr), framesToTime: (f: number) => f * fr,
    hexToRgb: (h: string) => { const c = hexToRgb(h); return [c.r / 255, c.g / 255, c.b / 255, 1]; },
    rgbToHsl: (c: number[]) => { const [r, g, b] = c; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); const l = (mx + mn) / 2; if (mx === mn) return [0, 0, l, c[3] ?? 1]; const d = mx - mn; const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [h / 6, s, l, c[3] ?? 1]; },
    hslToRgb: (c: number[]) => { const [h, s, l] = c; if (!s) return [l, l, l, c[3] ?? 1]; const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p2 = 2 * l - q; const f = (tt: number) => { tt = (tt + 1) % 1; return tt < 1 / 6 ? p2 + (q - p2) * 6 * tt : tt < 1 / 2 ? q : tt < 2 / 3 ? p2 + (q - p2) * (2 / 3 - tt) * 6 : p2; }; return [f(h + 1 / 3), f(h), f(h - 1 / 3), c[3] ?? 1]; },
    posterizeTime: () => { /* frame rate posterizing is not applied */ },
    inPoint: ctx?.inPoint ?? 0, outPoint: ctx?.outPoint ?? exprComp.duration, index: ctx?.index ?? 1, width: exprComp.width, height: exprComp.height,
    $bm_sum: add, sum: add, $bm_sub: sub, $bm_mul: mul, $bm_div: div, $bm_mod: (a: Num, b: Num) => zip(a, b, (x, y) => x % y), $bm_neg: (a: Num) => mul(a, -1),
    $bm_isInstanceOfArray: isArr, createPath: () => base,
  };
  try {
    const r = fn(...NAMES.map((n) => helpers[n]));
    errors.delete(src);
    return r === undefined ? base : fromNum(r, base);
  } catch (e) {
    errors.set(src, (e as Error).message || 'Error');
    return base;
  }
}
