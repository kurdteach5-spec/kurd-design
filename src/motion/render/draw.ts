// Vector drawing for the Motion renderer: bezier paths, shapes (with trim paths), text (with animators).
import type { Gradient, GradientStop, MPath, ShapeData, TextData, TextRangeAnimator, Vec2 } from '../types';
import { hexToRgb, rgbToHex } from '../../utils/color';
import { valueAt } from '../anim';
import { fontStack, ensureFont } from '../../utils/fonts';
import { rgba } from '../../utils/color';

export function pathToPath2D(p: MPath, dx = 0, dy = 0): Path2D {
  const out = new Path2D();
  const pts = p.points; if (!pts.length) return out;
  out.moveTo(pts[0].x + dx, pts[0].y + dy);
  const seg = (a: typeof pts[0], b: typeof pts[0]) => {
    if (!a.ox && !a.oy && !b.ix && !b.iy) out.lineTo(b.x + dx, b.y + dy);
    else out.bezierCurveTo(a.x + a.ox + dx, a.y + a.oy + dy, b.x + b.ix + dx, b.y + b.iy + dy, b.x + dx, b.y + dy);
  };
  for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i]);
  if (p.closed && pts.length > 2) { seg(pts[pts.length - 1], pts[0]); out.closePath(); }
  return out;
}

/** Polyline approximation (for lengths and hit tests). */
export function flattenPath(p: MPath, steps = 16): { x: number; y: number }[] {
  const pts = p.points; const out: { x: number; y: number }[] = [];
  if (!pts.length) return out;
  out.push({ x: pts[0].x, y: pts[0].y });
  const seg = (a: typeof pts[0], b: typeof pts[0]) => {
    for (let i = 1; i <= steps; i++) {
      const u = i / steps, m = 1 - u;
      const x = m * m * m * a.x + 3 * m * m * u * (a.x + a.ox) + 3 * m * u * u * (b.x + b.ix) + u * u * u * b.x;
      const y = m * m * m * a.y + 3 * m * m * u * (a.y + a.oy) + 3 * m * u * u * (b.y + b.iy) + u * u * u * b.y;
      out.push({ x, y });
    }
  };
  for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i]);
  if (p.closed && pts.length > 2) seg(pts[pts.length - 1], pts[0]);
  return out;
}
export function polyLength(pts: { x: number; y: number }[]) { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return l; }

// ---------- shapes ----------
export interface GradEval { type: 'linear' | 'radial'; start: Vec2; end: Vec2; stops: GradientStop[] }
export interface RepEval { copies: number; offset: number; anchor: Vec2; position: Vec2; scale: Vec2; rotation: number; startOpacity: number; endOpacity: number; composite: 'above' | 'below' }
export interface ShapeEval {
  kind: ShapeData['kind']; size: Vec2; roundness: number; sides: number; inner: number; path: MPath;
  fillOn: boolean; fill: string; strokeOn: boolean; stroke: string; strokeWidth: number; trimStart: number; trimEnd: number;
  trimOffset: number; roundCorners: number; fillGrad: GradEval | null; strokeGrad: GradEval | null; repeater: RepEval | null;
}
const evalGrad = (g: Gradient | null | undefined, t: number): GradEval | null => (g ? { type: g.type, start: valueAt(g.start, t), end: valueAt(g.end, t), stops: g.stops } : null);
export function evalShape(s: ShapeData, t: number): ShapeEval {
  const r = s.repeater;
  return {
    kind: s.kind, size: valueAt(s.size, t), roundness: valueAt(s.roundness, t), sides: s.sides, inner: valueAt(s.innerRadius, t), path: valueAt(s.path, t),
    fillOn: s.fillOn, fill: valueAt(s.fill, t), strokeOn: s.strokeOn, stroke: valueAt(s.stroke, t), strokeWidth: valueAt(s.strokeWidth, t),
    trimStart: valueAt(s.trimStart, t), trimEnd: valueAt(s.trimEnd, t),
    trimOffset: s.trimOffset ? valueAt(s.trimOffset, t) : 0, roundCorners: s.roundCorners ? valueAt(s.roundCorners, t) : 0,
    fillGrad: evalGrad(s.fillGradient, t), strokeGrad: evalGrad(s.strokeGradient, t),
    repeater: r ? { copies: valueAt(r.copies, t), offset: valueAt(r.offset, t), anchor: valueAt(r.anchor, t), position: valueAt(r.position, t), scale: valueAt(r.scale, t), rotation: valueAt(r.rotation, t), startOpacity: valueAt(r.startOpacity, t), endOpacity: valueAt(r.endOpacity, t), composite: r.composite } : null,
  };
}

/** a polygon with rounded corners (Round Corners) */
function roundedPoly(pts: { x: number; y: number }[], closed: boolean, r: number, P: Path2D) {
  const n = pts.length; if (n < 2) return;
  const corner = (i: number) => {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const la = Math.hypot(a.x - p.x, a.y - p.y), lb = Math.hypot(b.x - p.x, b.y - p.y);
    const rr = Math.min(r, la / 2, lb / 2);
    return { p, a: { x: p.x + ((a.x - p.x) / (la || 1)) * rr, y: p.y + ((a.y - p.y) / (la || 1)) * rr }, b: { x: p.x + ((b.x - p.x) / (lb || 1)) * rr, y: p.y + ((b.y - p.y) / (lb || 1)) * rr } };
  };
  if (closed) {
    const c0 = corner(0); P.moveTo(c0.b.x, c0.b.y);
    for (let i = 1; i <= n; i++) { const c = corner(i % n); P.lineTo(c.a.x, c.a.y); P.quadraticCurveTo(c.p.x, c.p.y, c.b.x, c.b.y); }
    P.closePath();
  } else {
    P.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < n - 1; i++) { const c = corner(i); P.lineTo(c.a.x, c.a.y); P.quadraticCurveTo(c.p.x, c.p.y, c.b.x, c.b.y); }
    P.lineTo(pts[n - 1].x, pts[n - 1].y);
  }
}

/** Geometry of a shape in layer space (centered on 0,0). */
export function shapeGeometry(e: ShapeEval): { path: Path2D; poly: { x: number; y: number }[]; closed: boolean; arrowHead?: Path2D } {
  const [w, h] = e.size;
  const P = new Path2D();
  const poly: { x: number; y: number }[] = [];
  switch (e.kind) {
    case 'rect': {
      const r = Math.max(0, Math.min(e.roundness, Math.abs(w) / 2, Math.abs(h) / 2));
      if (r > 0 && 'roundRect' in P) (P as Path2D & { roundRect: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect(-w / 2, -h / 2, w, h, r);
      else P.rect(-w / 2, -h / 2, w, h);
      poly.push({ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }, { x: -w / 2, y: -h / 2 });
      return { path: P, poly, closed: true };
    }
    case 'ellipse': {
      P.ellipse(0, 0, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
      for (let i = 0; i <= 64; i++) { const a = (i / 64) * Math.PI * 2 - Math.PI / 2; poly.push({ x: (Math.cos(a) * w) / 2, y: (Math.sin(a) * h) / 2 }); }
      return { path: P, poly, closed: true };
    }
    case 'polygon':
    case 'star': {
      if (e.roundCorners > 0) {
        const n = Math.max(3, Math.round(e.sides)); const count = e.kind === 'star' ? n * 2 : n;
        for (let i = 0; i < count; i++) { const a = (i / count) * Math.PI * 2 - Math.PI / 2; const k = e.kind === 'star' && i % 2 ? Math.max(0.01, e.inner / 100) : 1; poly.push({ x: (Math.cos(a) * w * k) / 2, y: (Math.sin(a) * h * k) / 2 }); }
        roundedPoly(poly, true, e.roundCorners, P); poly.push({ ...poly[0] });
        return { path: P, poly, closed: true };
      }
      const n = Math.max(3, Math.round(e.sides));
      const count = e.kind === 'star' ? n * 2 : n;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 - Math.PI / 2;
        const k = e.kind === 'star' && i % 2 ? Math.max(0.01, e.inner / 100) : 1;
        poly.push({ x: (Math.cos(a) * w * k) / 2, y: (Math.sin(a) * h * k) / 2 });
      }
      poly.forEach((p, i) => (i ? P.lineTo(p.x, p.y) : P.moveTo(p.x, p.y)));
      P.closePath(); poly.push({ ...poly[0] });
      return { path: P, poly, closed: true };
    }
    case 'line':
    case 'arrow': {
      P.moveTo(-w / 2, 0); P.lineTo(w / 2, 0);
      poly.push({ x: -w / 2, y: 0 }, { x: w / 2, y: 0 });
      let arrowHead: Path2D | undefined;
      if (e.kind === 'arrow') {
        const s = Math.max(10, e.strokeWidth * 3.2);
        arrowHead = new Path2D(); arrowHead.moveTo(w / 2 + s * 0.35, 0); arrowHead.lineTo(w / 2 - s * 0.8, -s * 0.6); arrowHead.lineTo(w / 2 - s * 0.8, s * 0.6); arrowHead.closePath();
      }
      return { path: P, poly, closed: false, arrowHead };
    }
    case 'path':
    default:
      if (e.roundCorners > 0 && e.path.points.every((v) => !v.ix && !v.iy && !v.ox && !v.oy)) {
        roundedPoly(e.path.points, e.path.closed, e.roundCorners, P);
        return { path: P, poly: flattenPath(e.path), closed: e.path.closed };
      }
      return { path: pathToPath2D(e.path), poly: flattenPath(e.path), closed: e.path.closed };
  }
}

/** transform of repeater copy i (applied i times), as a 2D matrix */
function repMatrix(r: RepEval, idx: number): DOMMatrix {
  const step = new DOMMatrix().translate(r.position[0], r.position[1]).translate(r.anchor[0], r.anchor[1]).rotate(r.rotation).scale(r.scale[0] / 100, r.scale[1] / 100).translate(-r.anchor[0], -r.anchor[1]);
  let m = new DOMMatrix();
  const n = Math.abs(idx), whole = Math.floor(n);
  const stepI = idx < 0 ? step.inverse() : step;
  for (let i = 0; i < whole; i++) m = m.multiply(stepI);
  const frac = n - whole;
  if (frac > 1e-6) {
    const part = new DOMMatrix().translate(r.position[0] * frac * Math.sign(idx), r.position[1] * frac * Math.sign(idx)).translate(r.anchor[0], r.anchor[1]).rotate(r.rotation * frac * Math.sign(idx))
      .scale(Math.pow(r.scale[0] / 100 || 1e-6, frac * Math.sign(idx)), Math.pow(r.scale[1] / 100 || 1e-6, frac * Math.sign(idx))).translate(-r.anchor[0], -r.anchor[1]);
    m = m.multiply(part);
  }
  return m;
}
function repCopies(r: RepEval): { m: DOMMatrix; alpha: number }[] {
  const n = Math.max(0, Math.min(500, Math.round(r.copies)));
  const out = Array.from({ length: n }, (_, i) => ({ m: repMatrix(r, i + r.offset), alpha: Math.max(0, Math.min(1, (n > 1 ? r.startOpacity + ((r.endOpacity - r.startOpacity) * i) / (n - 1) : r.startOpacity) / 100)) }));
  return r.composite === 'above' ? out : out.reverse();
}

export function shapeBounds(e: ShapeEval): { x: number; y: number; w: number; h: number } {
  const g = shapeGeometry(e);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const pts = e.repeater ? repCopies(e.repeater).flatMap(({ m }) => g.poly.map((p) => { const q = m.transformPoint(new DOMPoint(p.x, p.y)); return { x: q.x, y: q.y }; })) : g.poly;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 1, h: 1 };
  const pad = (e.strokeOn ? e.strokeWidth : 0) + (e.kind === 'arrow' ? e.strokeWidth * 3.5 + 10 : 2);
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

function paintOf(x: CanvasRenderingContext2D, flat: string, g: GradEval | null): string | CanvasGradient {
  if (!g || g.stops.length < 1) return flat;
  const gr = g.type === 'radial'
    ? x.createRadialGradient(g.start[0], g.start[1], 0, g.start[0], g.start[1], Math.max(0.01, Math.hypot(g.end[0] - g.start[0], g.end[1] - g.start[1])))
    : x.createLinearGradient(g.start[0], g.start[1], g.end[0], g.end[1]);
  for (const st of [...g.stops].sort((a, b) => a.o - b.o)) { try { gr.addColorStop(Math.max(0, Math.min(1, st.o)), rgba(st.c, st.a)); } catch { /* bad colour */ } }
  return gr;
}
export function drawShape(x: CanvasRenderingContext2D, e: ShapeEval) {
  if (e.repeater) {
    const copies = repCopies(e.repeater);
    const one = { ...e, repeater: null };
    for (const c of copies) { x.save(); x.transform(c.m.a, c.m.b, c.m.c, c.m.d, c.m.e, c.m.f); x.globalAlpha *= c.alpha; drawShape(x, one); x.restore(); }
    return;
  }
  const g = shapeGeometry(e);
  // trim with offset: the visible part may wrap past the end of the path
  const off = e.trimOffset / 360;
  let s0 = Math.min(e.trimStart, e.trimEnd) / 100 + off, s1 = Math.max(e.trimStart, e.trimEnd) / 100 + off;
  const trimmed = e.trimStart > 0.001 || e.trimEnd < 99.999;
  if (e.fillOn && g.closed) { x.fillStyle = paintOf(x, e.fill, e.fillGrad); x.fill(g.path); }
  if (e.strokeOn && e.strokeWidth > 0) {
    x.strokeStyle = paintOf(x, e.stroke, e.strokeGrad); x.lineWidth = e.strokeWidth; x.lineJoin = 'round'; x.lineCap = g.closed ? 'butt' : 'round';
    if (trimmed) {
      const len = polyLength(g.poly);
      const shift = Math.floor(s0); s0 -= shift; s1 -= shift;
      const parts: [number, number][] = s1 <= 1 ? [[s0, s1]] : [[s0, 1], [0, s1 - 1]];
      for (const [a, b] of parts) {
        const vis = (b - a) * len;
        if (vis > 0.01) { x.setLineDash([vis, len * 2 + 10]); x.lineDashOffset = -a * len; x.stroke(g.path); x.setLineDash([]); }
      }
    } else x.stroke(g.path);
    if (g.arrowHead && (!trimmed || e.trimEnd >= 99.9)) { x.fillStyle = e.stroke; x.fill(g.arrowHead); }
  }
}

// ---------- text ----------
export interface TextEval {
  text: string; font: string; weight: number; italic: boolean; size: number; color: string; align: TextData['align'];
  tracking: number; leading: number; strokeOn: boolean; strokeColor: string; strokeWidth: number;
  shadowOn: boolean; shadowColor: string; shadowBlur: number; shadowDistance: number; shadowAngle: number;
  animType: TextData['animator']['type']; progress: number; offsetY: number; fade: boolean;
  anims: AnimEval[];
}
interface AnimEval { basedOn: TextRangeAnimator['basedOn']; shape: TextRangeAnimator['shape']; s: number; e: number; amount: number; pos: Vec2 | null; scale: number | null; rot: number | null; op: number | null; fill: string | null; track: number | null }
export function evalText(d: TextData, t: number): TextEval {
  return {
    text: d.text, font: d.font, weight: d.weight, italic: d.italic, size: Math.max(1, valueAt(d.size, t)), color: valueAt(d.color, t), align: d.align,
    tracking: valueAt(d.tracking, t), leading: valueAt(d.leading, t), strokeOn: d.strokeOn, strokeColor: valueAt(d.strokeColor, t), strokeWidth: valueAt(d.strokeWidth, t),
    shadowOn: d.shadowOn, shadowColor: valueAt(d.shadowColor, t), shadowBlur: valueAt(d.shadowBlur, t), shadowDistance: valueAt(d.shadowDistance, t), shadowAngle: d.shadowAngle,
    animType: d.animator.type, progress: valueAt(d.animator.progress, t), offsetY: d.animator.offsetY, fade: d.animator.fade,
    anims: (d.animators ?? []).map((a) => {
      const off = valueAt(a.offset, t);
      return {
        basedOn: a.basedOn, shape: a.shape, s: valueAt(a.start, t) + off, e: valueAt(a.end, t) + off, amount: a.amount ? valueAt(a.amount, t) / 100 : 1,
        pos: a.position ? valueAt(a.position, t) : null, scale: a.scale ? valueAt(a.scale, t) : null, rot: a.rotation ? valueAt(a.rotation, t) : null,
        op: a.opacity ? valueAt(a.opacity, t) : null, fill: a.fill ? valueAt(a.fill, t) : null, track: a.tracking ? valueAt(a.tracking, t) : null,
      };
    }),
  };
}

let mctx: CanvasRenderingContext2D | null = null;
const measureCtx = () => (mctx ??= document.createElement('canvas').getContext('2d')!);
const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const fontOf = (e: TextEval) => `${e.italic ? 'italic ' : ''}${e.weight} ${e.size}px ${fontStack(e.font)}`;

interface Line { text: string; width: number; x: number; y: number; rtl: boolean }
export function layoutText(e: TextEval): { lines: Line[]; bounds: { x: number; y: number; w: number; h: number }; font: string } {
  ensureFont(e.font, e.weight, e.italic, e.text.slice(0, 200));
  const x = measureCtx(); const font = fontOf(e); x.font = font;
  const ls = x as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in ls) ls.letterSpacing = `${e.tracking}px`;
  const asc = e.size * 0.8, desc = e.size * 0.25;
  const lines: Line[] = e.text.split('\n').map((t, i) => {
    const w = t ? x.measureText(t).width : 0;
    const lx = e.align === 'center' ? -w / 2 : e.align === 'right' ? -w : 0;
    return { text: t, width: w, x: lx, y: i * e.leading, rtl: RTL.test(t) };
  });
  if ('letterSpacing' in ls) ls.letterSpacing = '0px';
  let x0 = 0, x1 = 0;
  for (const l of lines) { x0 = Math.min(x0, l.x); x1 = Math.max(x1, l.x + l.width); }
  const pad = (e.strokeOn ? e.strokeWidth : 0) + 4 + (e.animType === 'charReveal' || e.animType === 'wordReveal' ? Math.abs(e.offsetY) : 0);
  const sh = e.shadowOn ? e.shadowDistance + e.shadowBlur * 2 : 0;
  const top = -asc - pad - sh, bottom = (lines.length - 1) * e.leading + desc + pad + sh;
  return { lines, font, bounds: { x: x0 - pad - sh, y: top, w: x1 - x0 + (pad + sh) * 2, h: bottom - top } };
}

/** how much a range selector picks unit i of n (0..1), like After Effects' Range Selector */
function selectAmount(a: AnimEval, i: number, n: number): number {
  const s = Math.min(a.s, a.e) / 100, e = Math.max(a.s, a.e) / 100;
  const u0 = i / n, u1 = (i + 1) / n;
  if (a.shape === 'square') return Math.max(0, Math.min(u1, e) - Math.max(u0, s)) * n * a.amount;
  // smooth shapes: value at the unit centre across the selected range
  const c = (u0 + u1) / 2; const w = e - s; if (w <= 0) return 0;
  const p = (c - s) / w; if (p < 0 || p > 1) return 0;
  const v = a.shape === 'rampUp' ? p : a.shape === 'rampDown' ? 1 - p : a.shape === 'triangle' ? 1 - Math.abs(p * 2 - 1) : a.shape === 'round' ? Math.sqrt(Math.max(0, 1 - (p * 2 - 1) ** 2)) : 0.5 - Math.cos(p * Math.PI * 2) / 2;
  return v * a.amount;
}
const mixHex = (a: string, b: string, k: number) => { try { const p = hexToRgb(a), q = hexToRgb(b); const m = (x: number, y: number) => Math.round(x + (y - x) * k); return rgbToHex({ r: m(p.r, q.r), g: m(p.g, q.g), b: m(p.b, q.b) }); } catch { return a; } };

/** text with range-selector animators: every character (or word / line) is placed and drawn on its own */
function drawAnimatedText(x: CanvasRenderingContext2D, e: TextEval, L: ReturnType<typeof layoutText>, paint: (s: string, px: number, py: number, color: string) => void) {
  const lines = L.lines;
  const allChars = lines.reduce((n, l) => n + [...l.text].length, 0);
  const allWords = lines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);
  let ci = 0, wi = 0;
  lines.forEach((line, li) => {
    // right-to-left scripts stay joined: their words move as units
    const units: { s: string; char: number; word: number }[] = [];
    if (line.rtl) { for (const w of line.text.split(/(\s+)/)) { if (!w) continue; units.push({ s: w, char: ci, word: wi }); ci += [...w].length; if (w.trim()) wi++; } }
    else { let inWord = false; for (const ch of [...line.text]) { const sp = !ch.trim(); if (!sp && !inWord) inWord = true; if (sp && inWord) { inWord = false; wi++; } units.push({ s: ch, char: ci, word: Math.max(0, wi) }); ci++; } if (inWord) wi++; }
    let extra = 0; // tracking added by animators shifts the following units
    let prefix = '';
    const widths = units.map((u) => x.measureText(u.s).width);
    units.forEach((u, k) => {
      const base = line.rtl ? line.x + line.width - x.measureText(prefix + u.s).width : line.x + x.measureText(prefix).width;
      prefix += u.s;
      let dx = 0, dy = 0, sc = 1, rot = 0, op = 1, color = e.color, track = 0;
      for (const a of e.anims) {
        const amt = a.basedOn === 'lines' ? selectAmount(a, li, lines.length) : a.basedOn === 'words' ? selectAmount(a, u.word, Math.max(1, allWords)) : selectAmount(a, u.char, Math.max(1, allChars));
        if (amt <= 0) continue;
        if (a.pos) { dx += a.pos[0] * amt; dy += a.pos[1] * amt; }
        if (a.scale !== null) sc *= 1 + (a.scale / 100 - 1) * amt;
        if (a.rot !== null) rot += a.rot * amt;
        if (a.op !== null) op *= 1 + (a.op / 100 - 1) * amt;
        if (a.fill) color = mixHex(color, a.fill, Math.min(1, amt));
        if (a.track !== null) track += a.track * amt;
      }
      const px = base + extra * (line.rtl ? -1 : 1);
      extra += track;
      if (!u.s.trim() || op <= 0.001) return;
      const cx = px + widths[k] / 2;
      x.save();
      x.globalAlpha *= Math.max(0, Math.min(1, op));
      x.translate(cx + dx, line.y + dy); if (rot) x.rotate((rot * Math.PI) / 180); if (sc !== 1) x.scale(sc, sc);
      paint(u.s, -widths[k] / 2, 0, color);
      x.restore();
    });
  });
}

export function drawText(x: CanvasRenderingContext2D, e: TextEval) {
  const L = layoutText(e);
  x.font = L.font; x.textBaseline = 'alphabetic'; x.textAlign = 'left';
  const ls = x as CanvasRenderingContext2D & { letterSpacing?: string };
  const hasLS = 'letterSpacing' in ls;
  if (hasLS) ls.letterSpacing = `${e.tracking}px`;
  if (e.shadowOn) {
    const a = ((e.shadowAngle - 90) * Math.PI) / 180;
    const k = Math.hypot(x.getTransform().a, x.getTransform().b) || 1;
    x.shadowColor = rgba(e.shadowColor, 0.85); x.shadowBlur = e.shadowBlur * k;
    x.shadowOffsetX = Math.cos(a) * e.shadowDistance * k; x.shadowOffsetY = Math.sin(a) * e.shadowDistance * k;
  }
  const total = e.text.replace(/\n/g, '').length;
  const p = Math.max(0, Math.min(100, e.progress)) / 100;
  const paint = (s: string, px: number, py: number, color = e.color) => {
    if (e.strokeOn && e.strokeWidth > 0) { x.lineJoin = 'round'; x.strokeStyle = e.strokeColor; x.lineWidth = e.strokeWidth * 2; x.strokeText(s, px, py); }
    x.fillStyle = color; x.fillText(s, px, py);
  };
  if (e.anims.length && total) {
    drawAnimatedText(x, e, L, paint);
    if (hasLS) ls.letterSpacing = '0px';
    x.shadowColor = 'transparent'; x.direction = 'ltr';
    return;
  }
  let idx = 0;
  for (const line of L.lines) {
    x.direction = line.rtl ? 'rtl' : 'ltr';
    if (e.animType === 'none' || !total) { paint(line.text, line.x, line.y); idx += line.text.length; continue; }
    if (e.animType === 'typewriter' || line.rtl) {
      // characters appear one by one (also used for right-to-left scripts, which must stay joined)
      const show = Math.floor(p * total + 1e-6) - idx;
      if (show > 0) {
        const s = line.text.slice(0, Math.min(line.text.length, show));
        const px = line.rtl ? line.x + line.width - x.measureText(s).width : line.x;
        paint(s, px, line.y);
      }
      idx += line.text.length; continue;
    }
    // per-character or per-word reveal: each unit fades / rises in turn
    const units = e.animType === 'wordReveal' ? line.text.split(/(\s+)/) : [...line.text];
    const count = e.animType === 'wordReveal' ? Math.max(1, e.text.split(/\s+/).filter(Boolean).length) : total;
    const soft = e.animType === 'wordReveal' ? 1 : 4;
    let prefix = '';
    let unitIdx = e.animType === 'wordReveal' ? 0 : idx;
    if (e.animType === 'wordReveal') unitIdx = wordCountBefore(L.lines, line);
    for (const u of units) {
      const ux = line.x + (prefix ? x.measureText(prefix).width : 0);
      prefix += u;
      if (!u.trim()) { if (e.animType !== 'wordReveal') unitIdx++; continue; }
      const f = Math.max(0, Math.min(1, p * (count + soft) - unitIdx));
      unitIdx++;
      if (f <= 0) continue;
      const ease = 1 - (1 - f) * (1 - f);
      x.save();
      if (e.fade) x.globalAlpha *= ease;
      paint(u, ux, line.y + (1 - ease) * e.offsetY);
      x.restore();
    }
    idx += line.text.length;
  }
  if (hasLS) ls.letterSpacing = '0px';
  x.shadowColor = 'transparent'; x.direction = 'ltr';
}
function wordCountBefore(lines: Line[], line: Line) { let n = 0; for (const l of lines) { if (l === line) break; n += l.text.split(/\s+/).filter(Boolean).length; } return n; }
