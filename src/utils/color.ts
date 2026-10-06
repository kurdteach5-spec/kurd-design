import { clamp } from './math';

export interface RGB { r: number; g: number; b: number }
export interface HSV { h: number; s: number; v: number }
export interface HSL { h: number; s: number; l: number }

export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
export function rgbToHex({ r, g, b }: RGB): string {
  const h = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
export function isValidHex(s: string) { return /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.trim()); }
export function normalizeHex(s: string): string { return rgbToHex(hexToRgb(s)); }

export function rgbToHsv({ r, g, b }: RGB): HSV {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}
export function hsvToRgb({ h, s, v }: HSV): RGB {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
export function rgbToHsl({ r, g, b }: RGB): HSL {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2; let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0); else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}
export function hslToRgb({ h, s, l }: HSL): RGB {
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p;
  };
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q, hh = h / 360;
  return { r: hue(p, q, hh + 1 / 3) * 255, g: hue(p, q, hh) * 255, b: hue(p, q, hh - 1 / 3) * 255 };
}
export function rgba(hex: string, a: number) { const { r, g, b } = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
export function luminance({ r, g, b }: RGB) { return 0.299 * r + 0.587 * g + 0.114 * b; }
export function grayHex(v: number) { const c = clamp(Math.round(v), 0, 255); return rgbToHex({ r: c, g: c, b: c }); }
