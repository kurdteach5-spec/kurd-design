// Vector drawing for the Motion renderer: bezier paths, shapes (with trim paths), text (with animators).
import type { MPath, ShapeData, TextData, Vec2 } from '../types';
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
export interface ShapeEval {
  kind: ShapeData['kind']; size: Vec2; roundness: number; sides: number; inner: number; path: MPath;
  fillOn: boolean; fill: string; strokeOn: boolean; stroke: string; strokeWidth: number; trimStart: number; trimEnd: number;
}
export function evalShape(s: ShapeData, t: number): ShapeEval {
  return {
    kind: s.kind, size: valueAt(s.size, t), roundness: valueAt(s.roundness, t), sides: s.sides, inner: valueAt(s.innerRadius, t), path: valueAt(s.path, t),
    fillOn: s.fillOn, fill: valueAt(s.fill, t), strokeOn: s.strokeOn, stroke: valueAt(s.stroke, t), strokeWidth: valueAt(s.strokeWidth, t),
    trimStart: valueAt(s.trimStart, t), trimEnd: valueAt(s.trimEnd, t),
  };
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
      return { path: pathToPath2D(e.path), poly: flattenPath(e.path), closed: e.path.closed };
  }
}

export function shapeBounds(e: ShapeEval): { x: number; y: number; w: number; h: number } {
  const g = shapeGeometry(e);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of g.poly) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 1, h: 1 };
  const pad = (e.strokeOn ? e.strokeWidth : 0) + (e.kind === 'arrow' ? e.strokeWidth * 3.5 + 10 : 2);
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

export function drawShape(x: CanvasRenderingContext2D, e: ShapeEval) {
  const g = shapeGeometry(e);
  const trimmed = e.trimStart > 0.001 || e.trimEnd < 99.999;
  if (e.fillOn && g.closed) { x.fillStyle = e.fill; x.fill(g.path); }
  if (e.strokeOn && e.strokeWidth > 0) {
    x.strokeStyle = e.stroke; x.lineWidth = e.strokeWidth; x.lineJoin = 'round'; x.lineCap = g.closed ? 'butt' : 'round';
    if (trimmed) {
      const len = polyLength(g.poly);
      const s = Math.min(e.trimStart, e.trimEnd) / 100, en = Math.max(e.trimStart, e.trimEnd) / 100;
      const vis = (en - s) * len;
      if (vis > 0.01) { x.setLineDash([vis, len * 2 + 10]); x.lineDashOffset = -s * len; x.stroke(g.path); x.setLineDash([]); }
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
}
export function evalText(d: TextData, t: number): TextEval {
  return {
    text: d.text, font: d.font, weight: d.weight, italic: d.italic, size: Math.max(1, valueAt(d.size, t)), color: valueAt(d.color, t), align: d.align,
    tracking: valueAt(d.tracking, t), leading: valueAt(d.leading, t), strokeOn: d.strokeOn, strokeColor: valueAt(d.strokeColor, t), strokeWidth: valueAt(d.strokeWidth, t),
    shadowOn: d.shadowOn, shadowColor: valueAt(d.shadowColor, t), shadowBlur: valueAt(d.shadowBlur, t), shadowDistance: valueAt(d.shadowDistance, t), shadowAngle: d.shadowAngle,
    animType: d.animator.type, progress: valueAt(d.animator.progress, t), offsetY: d.animator.offsetY, fade: d.animator.fade,
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
  const paint = (s: string, px: number, py: number) => {
    if (e.strokeOn && e.strokeWidth > 0) { x.lineJoin = 'round'; x.strokeStyle = e.strokeColor; x.lineWidth = e.strokeWidth * 2; x.strokeText(s, px, py); }
    x.fillStyle = e.color; x.fillText(s, px, py);
  };
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
