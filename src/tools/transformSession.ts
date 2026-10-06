import type { DocState, Layer, RasterLayer } from '../types/document';
import { findLayer, updateLayer } from '../layers/tree';
import { applyDeltaTransform, docBounds, isTransformable, localBounds } from '../layers/geometry';
import {
  apply, frameFromCorners, invert, multiply, rad2deg, rectCorners, boundsOfPoints, squareToQuad, projectUnit, translate,
  type Matrix, type Point, type Rect, clamp,
} from '../utils/math';
import { createCanvas, ctx2d } from '../utils/canvas';
import { commit } from '../state/documentStore';
import { sharedCompositor } from '../canvas/compositor';
import { createRasterLayer } from '../layers/factory';
import type { Engine } from '../canvas/engine';
import { snapLines, snapValue, snappingOn } from './helpers';

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate' | 'inside';
export type TransformMode = 'free' | 'skew' | 'distort' | 'perspective';

const HANDLE_UNIT: Record<string, [number, number]> = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5],
};
const CORNER_INDEX: Record<string, number> = { nw: 0, ne: 1, se: 2, sw: 3 };

const unitToQuad = (c: Point[], u: number, v: number): Point => {
  // bilinear (exact for parallelograms)
  const top = { x: c[0].x + (c[1].x - c[0].x) * u, y: c[0].y + (c[1].y - c[0].y) * u };
  const bot = { x: c[3].x + (c[2].x - c[3].x) * u, y: c[3].y + (c[2].y - c[3].y) * u };
  return { x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v };
};

/**
 * A transform interaction over one or more layers. Corners describe the box
 * (nw, ne, se, sw) in document space. Affine boxes are applied non-destructively
 * to layer matrices; distorted boxes are baked into pixels on commit.
 */
export class TransformSession {
  readonly ids: string[];
  readonly originals: Layer[];
  readonly start: Point[]; // original corners
  corners: Point[];
  mode: TransformMode = 'free';
  private drag: { handle: Handle; p0: Point; corners0: Point[]; frame0: Matrix } | null = null;
  snapGuides: { v: number | null; h: number | null } = { v: null, h: null };

  private constructor(ids: string[], originals: Layer[], corners: Point[]) {
    this.ids = ids; this.originals = originals; this.start = corners.map((p) => ({ ...p })); this.corners = corners;
  }

  static fromCorners(ids: string[], originals: Layer[], corners: Point[]) { return new TransformSession(ids, originals, corners); }

  static create(state: DocState, ids: string[]): TransformSession | null {
    const layers = ids.map((id) => findLayer(state.layers, id)).filter((l): l is Layer => !!l && !l.locked);
    if (!layers.length) return null;
    let corners: Point[] | null = null;
    if (layers.length === 1 && isTransformable(layers[0])) {
      const l = layers[0]; const b = localBounds(l);
      if (b) corners = rectCorners(b).map((p) => apply(l.transform, p));
    } else {
      const b = layers.reduce<Rect | null>((acc, l) => { const r = docBounds(l); if (!r) return acc; if (!acc) return r; const x = Math.min(acc.x, r.x), y = Math.min(acc.y, r.y); return { x, y, w: Math.max(acc.x + acc.w, r.x + r.w) - x, h: Math.max(acc.y + acc.h, r.y + r.h) - y }; }, null);
      if (b) corners = rectCorners(b);
    }
    if (!corners) return null;
    return new TransformSession(layers.map((l) => l.id), layers, corners);
  }

  get isAffine() {
    const c = this.corners;
    return Math.hypot(c[0].x + c[2].x - c[1].x - c[3].x, c[0].y + c[2].y - c[1].y - c[3].y) < 0.01;
  }
  get changed() { return this.corners.some((p, i) => Math.abs(p.x - this.start[i].x) > 1e-6 || Math.abs(p.y - this.start[i].y) > 1e-6); }

  /** Affine delta mapping the original box onto the current box. */
  delta(): Matrix {
    const F0 = frameFromCorners(this.start[0], this.start[1], this.start[3]);
    const F1 = frameFromCorners(this.corners[0], this.corners[1], this.corners[3]);
    return multiply(F1, invert(F0));
  }

  info() {
    const c = this.corners;
    const w = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y), h = Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y);
    const angle = rad2deg(Math.atan2(c[1].y - c[0].y, c[1].x - c[0].x));
    const sw = Math.hypot(this.start[1].x - this.start[0].x, this.start[1].y - this.start[0].y) || 1;
    const sh = Math.hypot(this.start[3].x - this.start[0].x, this.start[3].y - this.start[0].y) || 1;
    return { x: c[0].x, y: c[0].y, w, h, angle, scaleX: (w / sw) * 100, scaleY: (h / sh) * 100 };
  }

  center(): Point { const c = this.corners; return { x: (c[0].x + c[1].x + c[2].x + c[3].x) / 4, y: (c[0].y + c[1].y + c[2].y + c[3].y) / 4 }; }

  handlePositions(): { id: Handle; p: Point }[] {
    return (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((id) => ({ id, p: unitToQuad(this.corners, ...HANDLE_UNIT[id]) }));
  }

  hitTest(engine: Engine, screen: Point): Handle | null {
    const tol = 7;
    for (const h of this.handlePositions()) {
      const s = engine.docToScreen(h.p);
      if (Math.abs(s.x - screen.x) <= tol && Math.abs(s.y - screen.y) <= tol) return h.id;
    }
    const quad = this.corners.map((p) => engine.docToScreen(p));
    const inside = pointInQuad(screen, quad);
    if (inside) return 'inside';
    // rotation zone just outside corners
    for (const q of quad) if (Math.hypot(q.x - screen.x, q.y - screen.y) < 26) return 'rotate';
    return null;
  }

  cursorFor(h: Handle | null, engine: Engine): string {
    if (!h) return 'default';
    if (h === 'inside') return 'move';
    if (h === 'rotate') return 'alias';
    const [u, v] = HANDLE_UNIT[h];
    const a = engine.docToScreen(unitToQuad(this.corners, 0.5, 0.5));
    const b = engine.docToScreen(unitToQuad(this.corners, u, v));
    const ang = ((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 360) % 180;
    if (ang < 22.5 || ang >= 157.5) return 'ew-resize';
    if (ang < 67.5) return 'nwse-resize';
    if (ang < 112.5) return 'ns-resize';
    return 'nesw-resize';
  }

  beginDrag(handle: Handle, p: Point) {
    this.drag = { handle, p0: p, corners0: this.corners.map((q) => ({ ...q })), frame0: frameFromCorners(this.corners[0], this.corners[1], this.corners[3]) };
  }
  get dragging() { return !!this.drag; }
  endDrag() { this.drag = null; this.snapGuides = { v: null, h: null }; }

  dragTo(p: Point, mods: { shift: boolean; alt: boolean; ctrl: boolean }, state: DocState, engine: Engine) {
    const d = this.drag; if (!d) return;
    const c0 = d.corners0;
    const dx = p.x - d.p0.x, dy = p.y - d.p0.y;
    this.snapGuides = { v: null, h: null };
    if (d.handle === 'inside') {
      let mx = dx, my = dy;
      if (mods.shift) { if (Math.abs(mx) > Math.abs(my)) my = 0; else mx = 0; }
      if (snappingOn() && !mods.ctrl) {
        const moved = c0.map((q) => ({ x: q.x + mx, y: q.y + my }));
        const b = boundsOfPoints(moved);
        const lines = snapLines(state, new Set(this.ids));
        const th = 6 / engine.zoom;
        const sx = snapValue([b.x, b.x + b.w / 2, b.x + b.w], lines.v, th);
        const sy = snapValue([b.y, b.y + b.h / 2, b.y + b.h], lines.h, th);
        mx += sx.delta; my += sy.delta; this.snapGuides = { v: sx.line, h: sy.line };
      }
      this.corners = c0.map((q) => ({ x: q.x + mx, y: q.y + my }));
      return;
    }
    if (d.handle === 'rotate') {
      const piv = { x: (c0[0].x + c0[2].x) / 2, y: (c0[0].y + c0[2].y) / 2 };
      let a = Math.atan2(p.y - piv.y, p.x - piv.x) - Math.atan2(d.p0.y - piv.y, d.p0.x - piv.x);
      if (mods.shift) {
        const base = Math.atan2(c0[1].y - c0[0].y, c0[1].x - c0[0].x);
        const step = Math.PI / 12;
        a = Math.round((base + a) / step) * step - base;
      }
      const cos = Math.cos(a), sin = Math.sin(a);
      this.corners = c0.map((q) => ({ x: piv.x + (q.x - piv.x) * cos - (q.y - piv.y) * sin, y: piv.y + (q.x - piv.x) * sin + (q.y - piv.y) * cos }));
      return;
    }
    const isCorner = d.handle in CORNER_INDEX;
    const mode = this.mode === 'free' ? (mods.ctrl ? (isCorner ? 'distort' : 'skew') : 'scale') : this.mode;
    if ((mode === 'distort' || mode === 'perspective') && !isCorner) {
      // edge handles in distort modes behave like skew
      this.skewEdge(d.handle, dx, dy, c0, mods.alt); return;
    }
    if (mode === 'distort') {
      const i = CORNER_INDEX[d.handle];
      this.corners = c0.map((q, k) => (k === i ? { x: q.x + dx, y: q.y + dy } : { ...q }));
      return;
    }
    if (mode === 'perspective') {
      const i = CORNER_INDEX[d.handle];
      const inv = invert(d.frame0);
      const u = apply(inv, p), u0 = apply(inv, d.p0);
      const du = u.x - u0.x, dv = u.y - u0.y;
      const out = c0.map((q) => ({ ...q }));
      const ex = { x: c0[1].x - c0[0].x, y: c0[1].y - c0[0].y }, ey = { x: c0[3].x - c0[0].x, y: c0[3].y - c0[0].y };
      // horizontal: mirror the partner corner on the same horizontal edge; vertical: same vertical edge
      const hPartner = [1, 0, 3, 2][i], vPartner = [3, 2, 1, 0][i];
      if (Math.abs(du) >= Math.abs(dv)) {
        out[i] = { x: c0[i].x + ex.x * du, y: c0[i].y + ex.y * du };
        out[hPartner] = { x: c0[hPartner].x - ex.x * du, y: c0[hPartner].y - ex.y * du };
      } else {
        out[i] = { x: c0[i].x + ey.x * dv, y: c0[i].y + ey.y * dv };
        out[vPartner] = { x: c0[vPartner].x - ey.x * dv, y: c0[vPartner].y - ey.y * dv };
      }
      this.corners = out; return;
    }
    if (mode === 'skew') { this.skewEdge(d.handle, dx, dy, c0, mods.alt); return; }
    // scale (affine, using the box frame at drag start)
    const inv = invert(d.frame0);
    const u = apply(inv, p);
    const [hx, hy] = HANDLE_UNIT[d.handle];
    const ax = mods.alt ? 0.5 : 1 - hx, ay = mods.alt ? 0.5 : 1 - hy;
    let sx = hx === 0.5 ? 1 : (u.x - ax) / (hx - ax || 1);
    let sy = hy === 0.5 ? 1 : (u.y - ay) / (hy - ay || 1);
    if (mods.shift !== false && isCorner && mods.shift) {
      const s = Math.abs(sx) > Math.abs(sy) ? Math.abs(sx) : Math.abs(sy);
      sx = Math.sign(sx || 1) * s; sy = Math.sign(sy || 1) * s;
    } else if (mods.shift && !isCorner) {
      const s = hx === 0.5 ? sy : sx; sx = s; sy = s;
    }
    if (Math.abs(sx) < 1e-4) sx = 1e-4; if (Math.abs(sy) < 1e-4) sy = 1e-4;
    const map = (qx: number, qy: number) => apply(d.frame0, { x: ax + (qx - ax) * sx, y: ay + (qy - ay) * sy });
    this.corners = [map(0, 0), map(1, 0), map(1, 1), map(0, 1)];
  }

  private skewEdge(h: Handle, dx: number, dy: number, c0: Point[], alt: boolean) {
    const out = c0.map((q) => ({ ...q }));
    const horiz = h === 'n' || h === 's';
    const axis = horiz ? { x: c0[1].x - c0[0].x, y: c0[1].y - c0[0].y } : { x: c0[3].x - c0[0].x, y: c0[3].y - c0[0].y };
    const len = Math.hypot(axis.x, axis.y) || 1;
    const t = (dx * axis.x + dy * axis.y) / len;
    const m = { x: (axis.x / len) * t, y: (axis.y / len) * t };
    const idx = h === 'n' ? [0, 1] : h === 's' ? [3, 2] : h === 'w' ? [0, 3] : [1, 2];
    const opp = h === 'n' ? [3, 2] : h === 's' ? [0, 1] : h === 'w' ? [1, 2] : [0, 3];
    for (const i of idx) out[i] = { x: c0[i].x + m.x, y: c0[i].y + m.y };
    if (alt) for (const i of opp) out[i] = { x: c0[i].x - m.x, y: c0[i].y - m.y };
    this.corners = out;
  }

  // ----- numeric -----
  setNumeric(v: Partial<{ x: number; y: number; w: number; h: number; angle: number }>) {
    const c = this.corners;
    let u = { x: c[1].x - c[0].x, y: c[1].y - c[0].y }, w = { x: c[3].x - c[0].x, y: c[3].y - c[0].y };
    let origin = { ...c[0] };
    if (v.w !== undefined) { const l = Math.hypot(u.x, u.y) || 1; const k = Math.max(0.01, v.w) / l; u = { x: u.x * k, y: u.y * k }; }
    if (v.h !== undefined) { const l = Math.hypot(w.x, w.y) || 1; const k = Math.max(0.01, v.h) / l; w = { x: w.x * k, y: w.y * k }; }
    if (v.angle !== undefined) {
      const cur = Math.atan2(u.y, u.x); const a = (v.angle * Math.PI) / 180 - cur;
      const ctr = { x: origin.x + (u.x + w.x) / 2, y: origin.y + (u.y + w.y) / 2 };
      const rot = (q: Point) => ({ x: q.x * Math.cos(a) - q.y * Math.sin(a), y: q.x * Math.sin(a) + q.y * Math.cos(a) });
      u = rot(u); w = rot(w);
      origin = { x: ctr.x - (u.x + w.x) / 2, y: ctr.y - (u.y + w.y) / 2 };
    }
    if (v.x !== undefined) origin.x = v.x;
    if (v.y !== undefined) origin.y = v.y;
    this.corners = [origin, { x: origin.x + u.x, y: origin.y + u.y }, { x: origin.x + u.x + w.x, y: origin.y + u.y + w.y }, { x: origin.x + w.x, y: origin.y + w.y }];
  }

  /** Applies an extra doc-space matrix to the current box (flip / rotate commands during a session). */
  applyMatrix(m: Matrix) { this.corners = this.corners.map((p) => apply(m, p)); }

  // ----- preview / commit -----
  transformedLayers(state: DocState): Layer[] {
    if (this.isAffine) {
      const D = this.delta();
      return this.originals.map((l) => applyDeltaTransform(l, D, multiply));
    }
    return this.originals.map((l) => this.warpLayer(l, state));
  }

  private warpLayer(l: Layer, state: DocState): Layer {
    // rasterize non-pixel layers, then project their pixels into the distorted quad
    let src: HTMLCanvasElement, srcRect: Rect;
    let raster: RasterLayer;
    if (l.type === 'raster') { raster = l; }
    else {
      const c = sharedCompositor.renderLayer(state, { ...l, mask: null, vectorMask: null, effects: { ...l.effects, dropShadow: { ...l.effects.dropShadow, enabled: false }, outerGlow: { ...l.effects.outerGlow, enabled: false }, stroke: { ...l.effects.stroke, enabled: false } }, opacity: 1 } as Layer);
      raster = { ...createRasterLayer(l.name, c), id: l.id, opacity: l.opacity, blendMode: l.blendMode, visible: l.visible, clipped: l.clipped, effects: l.effects, mask: l.mask, fillOpacity: l.type === 'group' || l.type === 'adjustment' ? 1 : l.fillOpacity };
    }
    src = raster.canvas;
    // map from layer-local rect (the original box in local space) → quad
    const inv = invert(raster.transform);
    const localStart = this.start.map((p) => apply(inv, p));
    srcRect = boundsOfPoints(localStart);
    const out = warpToQuad(src, srcRect, this.corners, state.width, state.height);
    return { ...raster, canvas: out.canvas, transform: translate(out.x, out.y) };
  }

  preview(engine: Engine) {
    const st = engine.state; if (!st) return;
    for (const l of this.transformedLayers(st)) engine.overrides.set(l.id, l);
    engine.invalidate();
  }

  commit(label = 'Free Transform') {
    if (!this.changed) return false;
    return commit((s) => {
      let layers = s.layers;
      for (const l of this.transformedLayers(s)) layers = updateLayer(layers, l.id, () => l);
      return { ...s, layers };
    }, { history: this.isAffine ? label : 'Distort' });
  }
}

function pointInQuad(p: Point, q: Point[]) {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    if ((q[i].y > p.y) !== (q[j].y > p.y) && p.x < ((q[j].x - q[i].x) * (p.y - q[i].y)) / (q[j].y - q[i].y) + q[i].x) inside = !inside;
  }
  return inside;
}

/** Projects `srcRect` of `src` onto a quad using a triangulated mesh (perspective-correct per cell). */
export function warpToQuad(src: HTMLCanvasElement, srcRect: Rect, quad: Point[], docW: number, docH: number) {
  const hm = squareToQuad(quad);
  const b = boundsOfPoints(quad);
  const x0 = Math.floor(Math.max(b.x, -docW)), y0 = Math.floor(Math.max(b.y, -docH));
  const x1 = Math.ceil(Math.min(b.x + b.w, docW * 2)), y1 = Math.ceil(Math.min(b.y + b.h, docH * 2));
  const out = createCanvas(Math.max(1, x1 - x0), Math.max(1, y1 - y0)); const x = ctx2d(out);
  const N = clamp(Math.round(Math.max(b.w, b.h) / 24), 8, 40);
  const pt = (i: number, j: number) => { const p = projectUnit(hm, i / N, j / N); return { x: p.x - x0, y: p.y - y0 }; };
  const sp = (i: number, j: number) => ({ x: srcRect.x + (srcRect.w * i) / N, y: srcRect.y + (srcRect.h * j) / N });
  x.imageSmoothingQuality = 'high';
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    tri(x, src, sp(i, j), sp(i + 1, j), sp(i, j + 1), pt(i, j), pt(i + 1, j), pt(i, j + 1));
    tri(x, src, sp(i + 1, j), sp(i + 1, j + 1), sp(i, j + 1), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1));
  }
  return { canvas: out, x: x0, y: y0 };
}

function tri(x: CanvasRenderingContext2D, img: HTMLCanvasElement, s0: Point, s1: Point, s2: Point, d0: Point, d1: Point, d2: Point) {
  // expand destination triangle slightly to hide seams
  const cx = (d0.x + d1.x + d2.x) / 3, cy = (d0.y + d1.y + d2.y) / 3;
  const grow = (p: Point) => { const dx = p.x - cx, dy = p.y - cy; const l = Math.hypot(dx, dy) || 1; return { x: p.x + (dx / l) * 0.6, y: p.y + (dy / l) * 0.6 }; };
  const g0 = grow(d0), g1 = grow(d1), g2 = grow(d2);
  const den = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (Math.abs(den) < 1e-9) return;
  const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / den;
  const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / den;
  const c = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / den;
  const d = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / den;
  const e = d0.x - a * s0.x - c * s0.y, f = d0.y - b * s0.x - d * s0.y;
  x.save();
  x.beginPath(); x.moveTo(g0.x, g0.y); x.lineTo(g1.x, g1.y); x.lineTo(g2.x, g2.y); x.closePath(); x.clip();
  x.setTransform(a, b, c, d, e, f);
  x.drawImage(img, 0, 0);
  x.restore();
}

/** Draws the transform box and handles in screen space. */
export function drawTransformBox(ctx: CanvasRenderingContext2D, engine: Engine, s: TransformSession, accent = '#4f8cff') {
  const q = s.corners.map((p) => engine.docToScreen(p));
  ctx.save();
  ctx.strokeStyle = accent; ctx.lineWidth = 1;
  ctx.beginPath(); q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
  for (const h of s.handlePositions()) {
    const p = engine.docToScreen(h.p);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = accent;
    ctx.fillRect(Math.round(p.x) - 4, Math.round(p.y) - 4, 8, 8); ctx.strokeRect(Math.round(p.x) - 4.5, Math.round(p.y) - 4.5, 9, 9);
  }
  const c = engine.docToScreen(s.center());
  ctx.beginPath(); ctx.arc(c.x, c.y, 3.5, 0, Math.PI * 2); ctx.stroke();
  // smart guides
  const st = engine.state;
  if (st) {
    ctx.strokeStyle = '#ff3ea5'; ctx.setLineDash([]);
    if (s.snapGuides.v !== null) { const a = engine.docToScreen({ x: s.snapGuides.v, y: -1e5 }), b = engine.docToScreen({ x: s.snapGuides.v, y: 1e5 }); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    if (s.snapGuides.h !== null) { const a = engine.docToScreen({ x: -1e5, y: s.snapGuides.h }), b = engine.docToScreen({ x: 1e5, y: s.snapGuides.h }); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  }
  ctx.restore();
}
