import type { Adjustment, CurvePoints, GradientStop, LevelsChannel, SelectiveColorKey } from '../types/document';
import { boxBlurRGBA } from '../utils/canvas';
import { hexToRgb } from '../utils/color';

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
type LUT = Uint8ClampedArray;
const makeLut = (f: (v: number) => number): LUT => { const l = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) l[i] = f(i); return l; };
const identityLut = makeLut((v) => v);

function applyLuts(d: Uint8ClampedArray, r: LUT, g: LUT, b: LUT) {
  for (let i = 0; i < d.length; i += 4) { d[i] = r[d[i]]; d[i + 1] = g[d[i + 1]]; d[i + 2] = b[d[i + 2]]; }
}

function levelsLut(c: LevelsChannel): LUT {
  const range = Math.max(1, c.inWhite - c.inBlack);
  return makeLut((v) => {
    const t = Math.min(1, Math.max(0, (v - c.inBlack) / range));
    return c.outBlack + (c.outWhite - c.outBlack) * Math.pow(t, 1 / Math.max(0.01, c.gamma));
  });
}
const composeLut = (a: LUT, b: LUT): LUT => makeLut((v) => b[a[v]]);

/** Monotone cubic (Fritsch–Carlson) interpolation of curve points → LUT. */
export function curveLut(points: CurvePoints): LUT {
  const p = [...points].sort((a, b) => a.x - b.x);
  if (p.length < 2) return identityLut;
  const n = p.length, dx: number[] = [], m: number[] = [], t: number[] = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = p[i + 1].x - p[i].x || 1e-6; m[i] = (p[i + 1].y - p[i].y) / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  return makeLut((x) => {
    if (x <= p[0].x) return p[0].y;
    if (x >= p[n - 1].x) return p[n - 1].y;
    let i = 0; while (i < n - 2 && x > p[i + 1].x) i++;
    const h = dx[i], u = (x - p[i].x) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * p[i].y + (u3 - 2 * u2 + u) * h * t[i] + (-2 * u3 + 3 * u2) * p[i + 1].y + (u3 - u2) * h * t[i + 1];
  });
}

const toLin = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
const fromLin = (v: number) => { v = v < 0 ? 0 : v > 1 ? 1 : v; return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); };

function rgb2hsl(r: number, g: number, b: number, out: number[]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6;
  }
  out[0] = h; out[1] = s; out[2] = l;
}
function hue2(p: number, q: number, t: number) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 0.5) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }
function hsl2rgb(h: number, s: number, l: number, out: number[]) {
  if (s === 0) { out[0] = out[1] = out[2] = l * 255; return; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  out[0] = hue2(p, q, h + 1 / 3) * 255; out[1] = hue2(p, q, h) * 255; out[2] = hue2(p, q, h - 1 / 3) * 255;
}

export function gradientLut(stops: GradientStop[], reverse = false): Uint8ClampedArray {
  const s = [...stops].sort((a, b) => a.offset - b.offset).map((x) => ({ ...hexToRgb(x.color), o: x.offset, a: x.opacity }));
  const out = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    let t = i / 255; if (reverse) t = 1 - t;
    let k = 0; while (k < s.length - 2 && t > s[k + 1].o) k++;
    const a = s[k], b = s[Math.min(k + 1, s.length - 1)];
    const f = b.o === a.o ? 0 : Math.min(1, Math.max(0, (t - a.o) / (b.o - a.o)));
    const ff = t <= a.o ? 0 : f;
    out[i * 4] = a.r + (b.r - a.r) * ff; out[i * 4 + 1] = a.g + (b.g - a.g) * ff; out[i * 4 + 2] = a.b + (b.b - a.b) * ff;
    out[i * 4 + 3] = (a.a + (b.a - a.a) * ff) * 255;
  }
  return out;
}

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Applies an adjustment in place to RGBA pixel data. Alpha is preserved. */
export function applyAdjustment(d: Uint8ClampedArray, w: number, h: number, adj: Adjustment) {
  const hsl = [0, 0, 0], rgb = [0, 0, 0];
  switch (adj.kind) {
    case 'brightness-contrast': {
      const c = adj.contrast * 2.55; const f = (259 * (c + 255)) / (255 * (259 - c));
      const lut = makeLut((v) => f * (v + adj.brightness - 128) + 128);
      applyLuts(d, lut, lut, lut); break;
    }
    case 'levels': {
      const base = levelsLut(adj.rgb);
      applyLuts(d, composeLut(base, levelsLut(adj.r)), composeLut(base, levelsLut(adj.g)), composeLut(base, levelsLut(adj.b))); break;
    }
    case 'curves': {
      const base = curveLut(adj.rgb);
      applyLuts(d, composeLut(base, curveLut(adj.r)), composeLut(base, curveLut(adj.g)), composeLut(base, curveLut(adj.b))); break;
    }
    case 'exposure': {
      const k = Math.pow(2, adj.exposure), g = 1 / Math.max(0.01, adj.gamma);
      const lut = makeLut((v) => fromLin(Math.pow(Math.max(0, toLin[v] * k + adj.offset), g)));
      applyLuts(d, lut, lut, lut); break;
    }
    case 'invert': { const lut = makeLut((v) => 255 - v); applyLuts(d, lut, lut, lut); break; }
    case 'posterize': {
      const n = Math.max(2, Math.round(adj.levels));
      const lut = makeLut((v) => Math.round(Math.round((v / 255) * (n - 1)) * (255 / (n - 1))));
      applyLuts(d, lut, lut, lut); break;
    }
    case 'threshold': {
      for (let i = 0; i < d.length; i += 4) { const v = luma(d[i], d[i + 1], d[i + 2]) >= adj.level ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; }
      break;
    }
    case 'hue-saturation': {
      const dh = adj.hue / 360, ds = adj.saturation / 100, dl = adj.lightness / 100;
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        rgb2hsl(d[i], d[i + 1], d[i + 2], hsl);
        let H = hsl[0], S = hsl[1], L = hsl[2];
        if (adj.colorize) { H = ((adj.hue + 360) % 360) / 360; S = Math.max(0, Math.min(1, 0.25 + ds * 0.75)); }
        else { H = (H + dh + 1) % 1; S = ds >= 0 ? (S > 0 ? S + (1 - S) * ds : 0) : S * (1 + ds); S = Math.max(0, Math.min(1, S)); }
        L = dl >= 0 ? L + (1 - L) * dl : L * (1 + dl);
        hsl2rgb(H, S, L, rgb); d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2];
      }
      break;
    }
    case 'vibrance': {
      const vib = adj.vibrance / 100, sat = adj.saturation / 100;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const s = max ? (max - min) / max : 0;
        const amt = sat + vib * (1 - s) * (vib > 0 ? 1.5 : 1);
        const l = luma(r, g, b);
        d[i] = clamp255(l + (r - l) * (1 + amt)); d[i + 1] = clamp255(l + (g - l) * (1 + amt)); d[i + 2] = clamp255(l + (b - l) * (1 + amt));
      }
      break;
    }
    case 'color-balance': {
      const tone = (v: number) => {
        const t = v / 255;
        return [Math.max(0, 1 - t * 2.5) , Math.max(0, 1 - Math.abs(t - 0.5) * 2.6), Math.max(0, (t - 0.6) * 2.5)];
      };
      const luts = [0, 1, 2].map((ch) => makeLut((v) => {
        const [s, m, hh] = tone(v);
        return v + (adj.shadows[ch] * s + adj.midtones[ch] * m + adj.highlights[ch] * hh) * 0.7;
      }));
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        let nr = luts[0][r], ng = luts[1][g], nb = luts[2][b];
        if (adj.preserveLuminosity) { const dl = luma(r, g, b) - luma(nr, ng, nb); nr += dl; ng += dl; nb += dl; }
        d[i] = clamp255(nr); d[i + 1] = clamp255(ng); d[i + 2] = clamp255(nb);
      }
      break;
    }
    case 'black-white': {
      const W = { r: adj.reds / 100, y: adj.yellows / 100, g: adj.greens / 100, c: adj.cyans / 100, b: adj.blues / 100, m: adj.magentas / 100 };
      const tint = adj.tint ? hexToRgb(adj.tintColor) : null;
      let th = 0, ts = 0;
      if (tint) { rgb2hsl(tint.r, tint.g, tint.b, hsl); th = hsl[0]; ts = hsl[1]; }
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        let gray: number;
        const mn = Math.min(r, g, b);
        if (r >= g && r >= b) { // red is max
          const mid = Math.max(g, b);
          gray = mn + (mid - mn) * (g >= b ? W.y : W.m) + (r - mid) * W.r;
        } else if (g >= r && g >= b) {
          const mid = Math.max(r, b);
          gray = mn + (mid - mn) * (r >= b ? W.y : W.c) + (g - mid) * W.g;
        } else {
          const mid = Math.max(r, g);
          gray = mn + (mid - mn) * (r >= g ? W.m : W.c) + (b - mid) * W.b;
        }
        gray = clamp255(gray);
        if (tint) { hsl2rgb(th, ts, gray / 255, rgb); d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; }
        else d[i] = d[i + 1] = d[i + 2] = gray;
      }
      break;
    }
    case 'gradient-map': {
      const lut = gradientLut(adj.stops, adj.reverse);
      for (let i = 0; i < d.length; i += 4) {
        const l = Math.round(luma(d[i], d[i + 1], d[i + 2])) * 4;
        d[i] = lut[l]; d[i + 1] = lut[l + 1]; d[i + 2] = lut[l + 2];
      }
      break;
    }
    case 'selective-color': {
      const cols = adj.colors; const rel = adj.mode === 'relative';
      const keys: SelectiveColorKey[] = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks'];
      const active = keys.filter((k) => { const c = cols[k]; return c.c || c.m || c.y || c.k; });
      if (!active.length) break;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), md = r + g + b - mx - mn;
        const weights: Partial<Record<SelectiveColorKey, number>> = {};
        if (r === mx) weights.reds = (mx - md) / 255; if (g === mx) weights.greens = (mx - md) / 255; if (b === mx) weights.blues = (mx - md) / 255;
        if (b === mn) weights.yellows = (md - mn) / 255; if (r === mn) weights.cyans = (md - mn) / 255; if (g === mn) weights.magentas = (md - mn) / 255;
        weights.whites = mn > 128 ? (mn - 128) / 127 : 0;
        weights.blacks = mx < 128 ? (128 - mx) / 128 : 0;
        weights.neutrals = 1 - (Math.abs(mx - 127.5) + Math.abs(mn - 127.5)) / 255;
        const ch = [r / 255, g / 255, b / 255];
        const out = [ch[0], ch[1], ch[2]];
        for (const k of active) {
          const w = weights[k]; if (!w) continue;
          const a = cols[k];
          const adjs = [a.c / 100, a.m / 100, a.y / 100];
          for (let j = 0; j < 3; j++) {
            const cmy = 1 - ch[j];
            const delta = (adjs[j] + a.k / 100) * (rel ? cmy || 0.02 : 1);
            out[j] -= delta * w;
          }
        }
        d[i] = clamp255(out[0] * 255); d[i + 1] = clamp255(out[1] * 255); d[i + 2] = clamp255(out[2] * 255);
      }
      break;
    }
    case 'develop': developAdjust(d, w, h, adj); break;
  }
}

function developAdjust(d: Uint8ClampedArray, w: number, h: number, a: Extract<Adjustment, { kind: 'develop' }>) {
  // Local-contrast passes first (clarity/sharpness) on a copy.
  if (a.clarity || a.sharpness) {
    if (a.clarity) {
      const blur = new Uint8ClampedArray(d); boxBlurRGBA(blur, w, h, Math.max(4, Math.round(Math.min(w, h) / 60)));
      const amt = a.clarity / 100;
      for (let i = 0; i < d.length; i += 4) {
        const l = luma(d[i], d[i + 1], d[i + 2]) / 255; const mid = 1 - Math.abs(l - 0.5) * 2;
        for (let c = 0; c < 3; c++) d[i + c] = clamp255(d[i + c] + (d[i + c] - blur[i + c]) * amt * mid * 1.2);
      }
    }
    if (a.sharpness) {
      const blur = new Uint8ClampedArray(d); boxBlurRGBA(blur, w, h, 1);
      const amt = a.sharpness / 100 * 1.5;
      for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = clamp255(d[i + c] + (d[i + c] - blur[i + c]) * amt);
    }
  }
  const expK = Math.pow(2, a.exposure);
  const c = a.contrast / 100;
  const gam = 1 / Math.max(0.05, a.gamma);
  const tone = makeLut((v) => {
    let x = toLin[v] * expK; x = fromLin(x) / 255; // exposure in linear light
    x += a.brightness / 200 * (1 - x) * (a.brightness > 0 ? 1 : 0) + (a.brightness < 0 ? a.brightness / 200 * x : 0);
    // blacks / whites move endpoints
    const bl = -a.blacks / 400, wh = 1 - a.whites / 400;
    x = (x - bl) / Math.max(0.05, wh - bl);
    // shadows / highlights
    const sh = a.shadows / 100, hi = a.highlights / 100;
    const sw = Math.pow(Math.max(0, 1 - x), 2), hw = Math.pow(Math.max(0, Math.min(1, x)), 2);
    x += sh * sw * 0.5 * (1 - x) + hi * hw * 0.5 * (hi > 0 ? 1 - x : x);
    // contrast S-curve
    if (c) { const y = x - 0.5; x = 0.5 + y * (1 + c) - (c > 0 ? c * 0.4 * y * (Math.abs(y) * 2) : 0); }
    x = Math.pow(Math.max(0, x), gam);
    return x * 255;
  });
  const temp = a.temperature / 100, tint = a.tint / 100;
  const rM = 1 + temp * 0.25 + tint * 0.08, gM = 1 - tint * 0.2, bM = 1 - temp * 0.25 + tint * 0.08;
  const sat = a.saturation / 100, vib = a.vibrance / 100, hue = a.hue / 360;
  const needColor = sat || vib || hue;
  const hsl = [0, 0, 0], rgb = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    let r = tone[d[i]] * rM, g = tone[d[i + 1]] * gM, b = tone[d[i + 2]] * bM;
    if (needColor) {
      if (hue) { rgb2hsl(clamp255(r), clamp255(g), clamp255(b), hsl); hsl2rgb((hsl[0] + hue + 1) % 1, hsl[1], hsl[2], rgb); r = rgb[0]; g = rgb[1]; b = rgb[2]; }
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b); const s = mx ? (mx - mn) / mx : 0;
      const amt = sat + vib * (1 - s);
      const l = luma(r, g, b);
      r = l + (r - l) * (1 + amt); g = l + (g - l) * (1 + amt); b = l + (b - l) * (1 + amt);
    }
    d[i] = clamp255(r); d[i + 1] = clamp255(g); d[i + 2] = clamp255(b);
  }
}

/** Whether an adjustment is a no-op (lets the compositor skip work). */
export function isNeutral(a: Adjustment): boolean {
  switch (a.kind) {
    case 'brightness-contrast': return !a.brightness && !a.contrast;
    case 'exposure': return !a.exposure && !a.offset && a.gamma === 1;
    case 'hue-saturation': return !a.colorize && !a.hue && !a.saturation && !a.lightness;
    case 'vibrance': return !a.vibrance && !a.saturation;
    case 'color-balance': return [...a.shadows, ...a.midtones, ...a.highlights].every((v) => !v);
    case 'develop': return !a.exposure && !a.brightness && !a.contrast && !a.highlights && !a.shadows && !a.whites && !a.blacks && !a.temperature && !a.tint && !a.vibrance && !a.saturation && !a.hue && a.gamma === 1 && !a.clarity && !a.sharpness;
    default: return false;
  }
}
