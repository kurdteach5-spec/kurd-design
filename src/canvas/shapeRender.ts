import type { Paint, ShapeGeometry, ShapeLayer, PathNode } from '../types/document';
import { rgba } from '../utils/color';
import { boundsOfPoints, deg2rad, type Point, type Rect } from '../utils/math';

export function polygonPoints(g: ShapeGeometry): Point[] {
  const n = Math.max(3, Math.round(g.sides));
  const pts: Point[] = [];
  const cx = g.width / 2, cy = g.height / 2;
  const count = g.kind === 'star' ? n * 2 : n;
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / count;
    const r = g.kind === 'star' && i % 2 === 1 ? g.innerRatio : 1;
    pts.push({ x: cx + Math.cos(a) * cx * r, y: cy + Math.sin(a) * cy * r });
  }
  return pts;
}

function roundedPoly(p: Path2D, pts: Point[], r: number) {
  if (r <= 0) { pts.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y))); p.closePath(); return; }
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
    const d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y), d2 = Math.hypot(next.x - cur.x, next.y - cur.y);
    const rr = Math.min(r, d1 / 2, d2 / 2);
    const a = { x: cur.x + ((prev.x - cur.x) / d1) * rr, y: cur.y + ((prev.y - cur.y) / d1) * rr };
    const b = { x: cur.x + ((next.x - cur.x) / d2) * rr, y: cur.y + ((next.y - cur.y) / d2) * rr };
    if (i === 0) p.moveTo(a.x, a.y); else p.lineTo(a.x, a.y);
    p.quadraticCurveTo(cur.x, cur.y, b.x, b.y);
  }
  p.closePath();
}

export function nodesPath(nodes: PathNode[], closed: boolean, p = new Path2D()): Path2D {
  if (!nodes.length) return p;
  p.moveTo(nodes[0].x, nodes[0].y);
  const seg = (a: PathNode, b: PathNode) => {
    if (a.outX === a.x && a.outY === a.y && b.inX === b.x && b.inY === b.y) p.lineTo(b.x, b.y);
    else p.bezierCurveTo(a.outX, a.outY, b.inX, b.inY, b.x, b.y);
  };
  for (let i = 1; i < nodes.length; i++) seg(nodes[i - 1], nodes[i]);
  if (closed && nodes.length > 2) { seg(nodes[nodes.length - 1], nodes[0]); p.closePath(); }
  return p;
}

const pathCache = new WeakMap<ShapeGeometry, Path2D>();
export function shapePath(g: ShapeGeometry): Path2D {
  const c = pathCache.get(g); if (c) return c;
  const p = new Path2D();
  const w = g.width, h = g.height;
  switch (g.kind) {
    case 'rect': {
      const r = Math.max(0, Math.min(g.radius, Math.abs(w) / 2, Math.abs(h) / 2));
      if (r <= 0) p.rect(0, 0, w, h);
      else {
        p.moveTo(r, 0); p.lineTo(w - r, 0); p.arcTo(w, 0, w, r, r); p.lineTo(w, h - r); p.arcTo(w, h, w - r, h, r);
        p.lineTo(r, h); p.arcTo(0, h, 0, h - r, r); p.lineTo(0, r); p.arcTo(0, 0, r, 0, r); p.closePath();
      }
      break;
    }
    case 'ellipse': p.ellipse(w / 2, h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2); break;
    case 'polygon': case 'star': roundedPoly(p, polygonPoints(g), g.radius); break;
    case 'line': case 'path': nodesPath(g.nodes, g.kind === 'path' && g.closed, p); break;
  }
  pathCache.set(g, p);
  return p;
}

export function geometryLocalBounds(g: ShapeGeometry, strokeWidth = 0): Rect {
  if (g.kind === 'line' || g.kind === 'path') {
    const pts: Point[] = [];
    for (const n of g.nodes) pts.push({ x: n.x, y: n.y }, { x: n.inX, y: n.inY }, { x: n.outX, y: n.outY });
    const b = boundsOfPoints(pts);
    const pad = g.kind === 'line' ? Math.max(strokeWidth / 2, 1) : 0;
    return { x: b.x - pad, y: b.y - pad, w: Math.max(1, b.w + pad * 2), h: Math.max(1, b.h + pad * 2) };
  }
  return { x: Math.min(0, g.width), y: Math.min(0, g.height), w: Math.max(1, Math.abs(g.width)), h: Math.max(1, Math.abs(g.height)) };
}

export function makePaint(ctx: CanvasRenderingContext2D, paint: Paint, b: Rect): string | CanvasGradient {
  if (paint.type === 'solid') return paint.color;
  const stops = [...paint.stops].sort((a, c) => a.offset - c.offset);
  let g: CanvasGradient;
  if (paint.type === 'radial') {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(b.w, b.h) / 2 || 1);
  } else {
    const a = deg2rad(paint.angle);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const dx = Math.cos(a), dy = -Math.sin(a);
    const half = (Math.abs(b.w * dx) + Math.abs(b.h * dy)) / 2 || 1;
    g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  }
  for (const s of stops) g.addColorStop(Math.min(1, Math.max(0, s.offset)), rgba(s.color, s.opacity));
  return g;
}

function arrowHead(ctx: CanvasRenderingContext2D, tip: Point, from: Point, size: number) {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  ctx.beginPath();
  ctx.moveTo(tip.x + Math.cos(a) * size * 0.2, tip.y + Math.sin(a) * size * 0.2);
  ctx.lineTo(tip.x - Math.cos(a - 0.45) * size, tip.y - Math.sin(a - 0.45) * size);
  ctx.lineTo(tip.x - Math.cos(a + 0.45) * size, tip.y - Math.sin(a + 0.45) * size);
  ctx.closePath(); ctx.fill();
}

/** Draws a shape in layer-local coordinates (caller applies the layer transform). */
export function drawShape(ctx: CanvasRenderingContext2D, layer: ShapeLayer, alpha = 1) {
  const g = layer.geometry;
  const path = shapePath(g);
  const b = geometryLocalBounds(g);
  ctx.save();
  ctx.globalAlpha *= alpha;
  const st = layer.stroke;
  const isLine = g.kind === 'line' || (g.kind === 'path' && !g.closed);
  const dash = st.dash === 'dashed' ? [st.width * 3, st.width * 2] : st.dash === 'dotted' ? [0.01, st.width * 2] : [];
  const setStroke = (w: number) => {
    ctx.strokeStyle = st.color; ctx.lineWidth = w; ctx.setLineDash(dash.map((d) => (d * w) / Math.max(st.width, 0.01)));
    ctx.lineCap = st.dash === 'dotted' || isLine ? 'round' : 'butt'; ctx.lineJoin = 'round';
  };
  const fillOn = layer.fill.type !== 'none' && !(g.kind === 'line');
  const strokeOn = st.enabled && st.width > 0;
  if (strokeOn && st.align === 'outside' && !isLine) { setStroke(st.width * 2); ctx.stroke(path); }
  if (fillOn) { ctx.fillStyle = makePaint(ctx, layer.fill, b); ctx.fill(path); }
  if (strokeOn) {
    if (st.align === 'inside' && !isLine) { ctx.save(); ctx.clip(path); setStroke(st.width * 2); ctx.stroke(path); ctx.restore(); }
    else if (st.align === 'center' || isLine) { setStroke(st.width); ctx.stroke(path); }
    if (isLine && (g.arrowStart || g.arrowEnd) && g.nodes.length >= 2) {
      ctx.fillStyle = st.color; ctx.setLineDash([]);
      const n = g.nodes, size = Math.max(10, st.width * 3.2);
      if (g.arrowEnd) { const a = n[n.length - 1]; const p = n[n.length - 2]; arrowHead(ctx, a, a.inX !== a.x || a.inY !== a.y ? { x: a.inX, y: a.inY } : p, size); }
      if (g.arrowStart) { const a = n[0]; const p = n[1]; arrowHead(ctx, a, a.outX !== a.x || a.outY !== a.y ? { x: a.outX, y: a.outY } : p, size); }
    }
  }
  ctx.restore();
}

export const straightNode = (x: number, y: number): PathNode => ({ x, y, inX: x, inY: y, outX: x, outY: y });
