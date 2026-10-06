import type { Tool, ToolPointerEvent } from './types';
import type { Engine } from '../canvas/engine';
import type { Layer, PathNode, ShapeGeometry, ShapeLayer, VectorMask } from '../types/document';
import { useTools, type ToolId } from '../state/toolStore';
import { commit } from '../state/documentStore';
import { createShapeLayer, defaultGeometry, defaultStroke, solidPaint } from '../layers/factory';
import { findLayer, insertLayers, layersTopDown, updateLayer } from '../layers/tree';
import { drawShape, polygonPoints, nodesPath, straightNode } from '../canvas/shapeRender';
import { hitTestLayer } from '../layers/geometry';
import { apply, invert, translate, boundsOfPoints, type Point, multiply } from '../utils/math';
import { combineSelection, maskFromDraw } from '../canvas/selection';
import { activeLayer } from './helpers';
import { toast } from '../state/uiStore';

const SHAPE_NAMES: Record<string, string> = { rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', line: 'Line', path: 'Path' };

function shapeFromDrag(kind: 'rect' | 'ellipse' | 'polygon' | 'line', a: Point, b: Point, e: { shift: boolean; alt: boolean }): ShapeLayer {
  const o = useTools.getState().options.shape;
  if (kind === 'line') {
    let end = b;
    if (e.shift) { const ang = Math.atan2(b.y - a.y, b.x - a.x); const s = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4); const d = Math.hypot(b.x - a.x, b.y - a.y); end = { x: a.x + Math.cos(s) * d, y: a.y + Math.sin(s) * d }; }
    const g: ShapeGeometry = { ...defaultGeometry('line', 0, 0), closed: false, nodes: [straightNode(0, 0), straightNode(end.x - a.x, end.y - a.y)], arrowStart: o.arrowStart, arrowEnd: o.arrowEnd };
    const st = { ...defaultStroke(o.stroke === '#0b1220' && !o.strokeEnabled ? o.fill : o.stroke, o.lineWidth), enabled: true, width: o.lineWidth };
    return createShapeLayer(o.arrowEnd || o.arrowStart ? 'Arrow' : 'Line', g, translate(a.x, a.y), { ...solidPaint(o.fill), type: 'none' }, st);
  }
  let w = b.x - a.x, h = b.y - a.y;
  if (e.shift) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; }
  let x = a.x, y = a.y;
  if (e.alt) { x -= w; y -= h; w *= 2; h *= 2; }
  const x0 = Math.min(x, x + w), y0 = Math.min(y, y + h);
  const realKind = kind === 'polygon' && o.star ? 'star' : kind;
  const g: ShapeGeometry = { ...defaultGeometry(realKind, Math.abs(w), Math.abs(h)), radius: kind === 'ellipse' ? 0 : o.radius, sides: o.sides, innerRatio: o.innerRatio };
  if (realKind === 'polygon' && o.sides === 3) g.radius = o.radius;
  const fill = o.fillEnabled ? solidPaint(o.fill) : { ...solidPaint(o.fill), type: 'none' as const };
  const name = realKind === 'polygon' && o.sides === 3 ? 'Triangle' : realKind === 'rect' && o.radius > 0 ? 'Rounded Rectangle' : SHAPE_NAMES[realKind];
  return createShapeLayer(name, g, translate(Math.round(x0), Math.round(y0)), fill, { ...defaultStroke(o.stroke, o.strokeWidth), enabled: o.strokeEnabled });
}

function insertShape(layer: Layer, label: string) {
  commit((s) => ({ ...s, layers: insertLayers(s.layers, [layer], s.activeLayerId, 'above'), activeLayerId: layer.id, selectedLayerIds: [layer.id], editTarget: 'content' }), { history: label });
}

function shapeTool(id: ToolId, kind: 'rect' | 'ellipse' | 'polygon' | 'line'): Tool {
  let a: Point | null = null, b: Point | null = null, mods = { shift: false, alt: false };
  const preview = () => (a && b ? shapeFromDrag(kind, a, b, mods) : null);
  return {
    id,
    cursor: () => 'crosshair',
    onDown(e) {
      if (e.alt && !a) { /* alt draws from center */ }
      a = e.doc; b = e.doc; mods = { shift: e.shift, alt: e.alt };
    },
    onMove(e, _en, dragging) { if (dragging && a) { b = e.doc; mods = { shift: e.shift, alt: e.alt }; } },
    onUp(_e, engine) {
      const st = engine.state; const layer = preview(); const start = a, end = b; a = b = null;
      if (!st || !layer || !start || !end) return;
      if (Math.hypot(end.x - start.x, end.y - start.y) < 2 / engine.zoom) {
        // a click creates a default-sized shape
        const size = Math.round(Math.min(st.width, st.height) / 4);
        const l2 = shapeFromDrag(kind, { x: start.x - size / 2, y: start.y - size / 2 }, { x: start.x + size / 2, y: start.y + (kind === 'line' ? -size / 2 : size / 2) }, { shift: false, alt: false });
        insertShape(l2, `${l2.name} Tool`); return;
      }
      insertShape(layer, `${layer.name} Tool`);
    },
    drawOverlay(ctx, engine) {
      const l = preview(); if (!l) return;
      const vm = engine.viewMatrix(); const t = multiply(vm, l.transform);
      ctx.save(); ctx.setTransform(engine.dpr * t.a, engine.dpr * t.b, engine.dpr * t.c, engine.dpr * t.d, engine.dpr * t.e, engine.dpr * t.f);
      drawShape(ctx, l, 0.85);
      ctx.restore();
      if (a && b) {
        const p = engine.docToScreen(b); const w = Math.round(Math.abs(b.x - a.x)), h = Math.round(Math.abs(b.y - a.y));
        ctx.save(); ctx.font = '11px Inter, sans-serif'; const label = kind === 'line' ? `${Math.round(Math.hypot(w, h))} px` : `W ${w}  H ${h}`;
        const tw = ctx.measureText(label).width + 10; ctx.fillStyle = 'rgba(20,22,26,0.9)'; ctx.fillRect(p.x + 12, p.y + 12, tw, 20);
        ctx.fillStyle = '#e8eaed'; ctx.fillText(label, p.x + 17, p.y + 26); ctx.restore();
      }
    },
  };
}
export const rectShapeTool = shapeTool('shape-rect', 'rect');
export const ellipseShapeTool = shapeTool('shape-ellipse', 'ellipse');
export const polygonShapeTool = shapeTool('shape-polygon', 'polygon');
export const lineShapeTool = shapeTool('shape-line', 'line');

// ---------------- Pen ----------------
let penNodes: PathNode[] = [];
let penDrag: number | null = null;
const KAPPA = 0.5522847498;

function drawPath(ctx: CanvasRenderingContext2D, engine: Engine, nodes: PathNode[], closed: boolean, m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, selected: number | null = null, showHandles = true) {
  if (!nodes.length) return;
  const vm = multiply(engine.viewMatrix(), m);
  ctx.save();
  ctx.save(); ctx.setTransform(engine.dpr * vm.a, engine.dpr * vm.b, engine.dpr * vm.c, engine.dpr * vm.d, engine.dpr * vm.e, engine.dpr * vm.f);
  const p = nodesPath(nodes, closed);
  ctx.restore();
  ctx.save(); ctx.setTransform(engine.dpr * vm.a, engine.dpr * vm.b, engine.dpr * vm.c, engine.dpr * vm.d, engine.dpr * vm.e, engine.dpr * vm.f);
  ctx.lineWidth = 1.5 / (engine.zoom * Math.hypot(m.a, m.b)); ctx.strokeStyle = '#4f8cff'; ctx.stroke(p); ctx.restore();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const s = engine.docToScreen(apply(m, n));
    if (showHandles && (selected === null || selected === i || selected === i - 1 || selected === i + 1)) {
      for (const h of [{ x: n.inX, y: n.inY }, { x: n.outX, y: n.outY }]) {
        if (h.x === n.x && h.y === n.y) continue;
        const hs = engine.docToScreen(apply(m, h));
        ctx.strokeStyle = '#4f8cff'; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(hs.x, hs.y); ctx.stroke();
        ctx.fillStyle = '#4f8cff'; ctx.beginPath(); ctx.arc(hs.x, hs.y, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.fillStyle = selected === i ? '#4f8cff' : '#fff'; ctx.strokeStyle = '#4f8cff';
    ctx.fillRect(s.x - 3.5, s.y - 3.5, 7, 7); ctx.strokeRect(s.x - 3.5, s.y - 3.5, 7, 7);
  }
  ctx.restore();
}

function finishPen(engine: Engine, closed: boolean) {
  const nodes = penNodes; penNodes = []; penDrag = null;
  const st = engine.state;
  if (!st || nodes.length < 2) { engine.invalidateView(); return; }
  const o = useTools.getState().options;
  const pts: Point[] = []; for (const n of nodes) pts.push({ x: n.x, y: n.y }, { x: n.inX, y: n.inY }, { x: n.outX, y: n.outY });
  const b = boundsOfPoints(pts);
  const ox = Math.floor(b.x), oy = Math.floor(b.y);
  const local = nodes.map((n) => ({ x: n.x - ox, y: n.y - oy, inX: n.inX - ox, inY: n.inY - oy, outX: n.outX - ox, outY: n.outY - oy }));
  const geometry: ShapeGeometry = { ...defaultGeometry('path', Math.ceil(b.w), Math.ceil(b.h)), nodes: local, closed };
  if (o.pen.mode === 'vector-mask') {
    const l = activeLayer(st);
    if (!l) { toast('Select a layer to add a vector mask to.', 'warning'); return; }
    const vm: VectorMask = { geometry: { ...geometry, closed: true }, transform: translate(ox, oy), enabled: true, feather: 0, invert: false };
    commit((s) => ({ ...s, layers: updateLayer(s.layers, l.id, (x) => ({ ...x, vectorMask: vm })), editTarget: 'vectorMask' }), { history: 'Add Vector Mask' });
    return;
  }
  if (o.pen.mode === 'selection') {
    const mask = maskFromDraw(st.width, st.height, (x) => x.fill(nodesPath(nodes, true)));
    const sel = combineSelection(st.selection, mask, 'new');
    commit((s) => ({ ...s, selection: sel }), { history: 'Make Selection' });
    return;
  }
  const s = o.shape;
  const fill = closed && s.fillEnabled ? solidPaint(s.fill) : { ...solidPaint(s.fill), type: 'none' as const };
  const stroke = { ...defaultStroke(s.stroke, s.strokeWidth || 2), enabled: !closed || s.strokeEnabled || !s.fillEnabled };
  const layer = createShapeLayer('Path', geometry, translate(ox, oy), fill, stroke);
  insertShape(layer, 'Pen Tool');
}

export const penTool: Tool = {
  id: 'pen',
  hoverOverlay: true,
  cursor: () => 'crosshair',
  hasSession: () => penNodes.length > 0,
  commit: (engine) => finishPen(engine, false),
  cancel: (engine) => { penNodes = []; engine.invalidateView(); },
  deactivate(engine) { if (penNodes.length > 1) finishPen(engine, false); penNodes = []; },
  onDown(e, engine) {
    if (penNodes.length > 2) {
      const f = engine.docToScreen(penNodes[0]);
      if (Math.hypot(f.x - e.screen.x, f.y - e.screen.y) < 8) { finishPen(engine, true); return; }
    }
    penNodes = [...penNodes, straightNode(e.doc.x, e.doc.y)];
    penDrag = penNodes.length - 1;
  },
  onMove(e, _engine, dragging) {
    if (!dragging || penDrag === null) return;
    const n = penNodes[penDrag];
    const out = { x: e.doc.x, y: e.doc.y };
    const inP = e.alt ? { x: n.inX, y: n.inY } : { x: 2 * n.x - out.x, y: 2 * n.y - out.y };
    penNodes = penNodes.map((q, i) => (i === penDrag ? { ...q, outX: out.x, outY: out.y, inX: inP.x, inY: inP.y } : q));
  },
  onUp() { penDrag = null; },
  onDoubleClick(_e, engine) { if (penNodes.length > 1) finishPen(engine, false); },
  onKeyDown(e, engine) {
    if (!penNodes.length) return false;
    if (e.key === 'Enter') { finishPen(engine, false); return true; }
    if (e.key === 'Escape') { penNodes = []; engine.invalidateView(); return true; }
    if (e.key === 'Backspace' || e.key === 'Delete') { penNodes = penNodes.slice(0, -1); engine.invalidateView(); return true; }
    return false;
  },
  drawOverlay(ctx, engine) {
    if (!penNodes.length) return;
    const nodes = engine.hover && penDrag === null ? [...penNodes, straightNode(engine.hover.x, engine.hover.y)] : penNodes;
    drawPath(ctx, engine, nodes, false, undefined, penNodes.length - 1);
    if (penNodes.length > 2 && engine.hoverScreen) {
      const f = engine.docToScreen(penNodes[0]);
      if (Math.hypot(f.x - engine.hoverScreen.x, f.y - engine.hoverScreen.y) < 8) { ctx.save(); ctx.strokeStyle = '#ffb547'; ctx.beginPath(); ctx.arc(f.x, f.y, 7, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
    }
  },
};

// ---------------- Path selection ----------------
/** Converts a parametric shape into editable bezier nodes. */
export function geometryToPath(g: ShapeGeometry): ShapeGeometry {
  if (g.kind === 'path' || g.kind === 'line') return g;
  let nodes: PathNode[] = [];
  const w = g.width, h = g.height;
  if (g.kind === 'rect') {
    const r = Math.min(g.radius, w / 2, h / 2);
    if (r <= 0) nodes = [straightNode(0, 0), straightNode(w, 0), straightNode(w, h), straightNode(0, h)];
    else {
      const k = r * KAPPA;
      const n = (x: number, y: number, ix: number, iy: number, ox: number, oy: number): PathNode => ({ x, y, inX: ix, inY: iy, outX: ox, outY: oy });
      nodes = [
        n(r, 0, r - k, 0, r, 0), n(w - r, 0, w - r, 0, w - r + k, 0), n(w, r, w, r - k, w, r), n(w, h - r, w, h - r, w, h - r + k),
        n(w - r, h, w - r + k, h, w - r, h), n(r, h, r, h, r - k, h), n(0, h - r, 0, h - r + k, 0, h - r), n(0, r, 0, r, 0, r - k),
      ];
    }
  } else if (g.kind === 'ellipse') {
    const rx = w / 2, ry = h / 2, kx = rx * KAPPA, ky = ry * KAPPA;
    nodes = [
      { x: rx, y: 0, inX: rx - kx, inY: 0, outX: rx + kx, outY: 0 },
      { x: w, y: ry, inX: w, inY: ry - ky, outX: w, outY: ry + ky },
      { x: rx, y: h, inX: rx + kx, inY: h, outX: rx - kx, outY: h },
      { x: 0, y: ry, inX: 0, inY: ry + ky, outX: 0, outY: ry - ky },
    ];
  } else nodes = polygonPoints(g).map((p) => straightNode(p.x, p.y));
  return { ...g, kind: 'path', nodes, closed: true, radius: 0 };
}

type PathTarget = { kind: 'shape'; layer: ShapeLayer } | { kind: 'vmask'; layer: Layer; vm: VectorMask };
function pathTarget(engine: Engine): PathTarget | null {
  const st = engine.state; const l = activeLayer(st);
  if (!st || !l) return null;
  if (st.editTarget === 'vectorMask' && l.vectorMask) return { kind: 'vmask', layer: l, vm: l.vectorMask };
  if (l.type === 'shape') return { kind: 'shape', layer: l };
  return null;
}
const geomOf = (t: PathTarget) => (t.kind === 'shape' ? t.layer.geometry : t.vm.geometry);
const matOf = (t: PathTarget) => (t.kind === 'shape' ? t.layer.transform : t.vm.transform);

let psDrag: { mode: 'anchor' | 'in' | 'out' | 'move'; index: number; start: Point; target: PathTarget; geom: ShapeGeometry } | null = null;
let psSelected: number | null = null;
let psPreview: PathTarget | null = null;

function hitNode(engine: Engine, t: PathTarget, s: Point): { mode: 'anchor' | 'in' | 'out'; index: number } | null {
  const g = geomOf(t); const m = matOf(t);
  const nodes = g.kind === 'path' || g.kind === 'line' ? g.nodes : geometryToPath(g).nodes;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const checks: ['anchor' | 'in' | 'out', Point][] = [['anchor', { x: n.x, y: n.y }]];
    if (psSelected === i || g.kind === 'path') checks.push(['in', { x: n.inX, y: n.inY }], ['out', { x: n.outX, y: n.outY }]);
    for (const [mode, p] of checks) {
      if (mode !== 'anchor' && p.x === n.x && p.y === n.y) continue;
      const q = engine.docToScreen(apply(m, p));
      if (Math.hypot(q.x - s.x, q.y - s.y) < 7) return { mode, index: i };
    }
  }
  return null;
}

function withGeom(t: PathTarget, g: ShapeGeometry, move?: Point): PathTarget {
  if (t.kind === 'shape') {
    const tr = move ? { ...t.layer.transform, e: t.layer.transform.e + move.x, f: t.layer.transform.f + move.y } : t.layer.transform;
    return { kind: 'shape', layer: { ...t.layer, geometry: g, transform: tr } };
  }
  const tr = move ? { ...t.vm.transform, e: t.vm.transform.e + move.x, f: t.vm.transform.f + move.y } : t.vm.transform;
  const vm = { ...t.vm, geometry: g, transform: tr };
  return { kind: 'vmask', layer: { ...t.layer, vectorMask: vm }, vm };
}

export const pathSelectTool: Tool = {
  id: 'path-select',
  cursor: () => 'default',
  onDown(e, engine) {
    let t = pathTarget(engine);
    const hitN = t ? hitNode(engine, t, e.screen) : null;
    if (t && hitN) {
      psSelected = hitN.index;
      psDrag = { mode: hitN.mode, index: hitN.index, start: e.doc, target: t, geom: geometryToPath(geomOf(t)) };
      return;
    }
    const st = engine.state; if (!st) return;
    if (!t || !(t.kind === 'shape' ? hitTestLayer(t.layer, e.doc) : true)) {
      const hit = layersTopDown(st.layers).find((l) => l.type === 'shape' && l.visible && !l.locked && hitTestLayer(l, e.doc)) as ShapeLayer | undefined;
      if (!hit) { psSelected = null; engine.invalidateView(); return; }
      commit((s) => ({ ...s, activeLayerId: hit.id, selectedLayerIds: [hit.id], editTarget: 'content' }));
      t = { kind: 'shape', layer: hit };
    }
    psSelected = null;
    psDrag = { mode: 'move', index: -1, start: e.doc, target: t, geom: geomOf(t) };
  },
  onMove(e, engine, dragging) {
    if (!dragging || !psDrag) return;
    const d = psDrag; const inv = invert(matOf(d.target));
    if (d.mode === 'move') {
      psPreview = withGeom(d.target, d.geom, { x: e.doc.x - d.start.x, y: e.doc.y - d.start.y });
    } else {
      const p = apply(inv, e.doc), p0 = apply(inv, d.start);
      const dx = p.x - p0.x, dy = p.y - p0.y;
      const nodes = d.geom.nodes.map((n, i) => {
        if (i !== d.index) return n;
        if (d.mode === 'anchor') return { x: n.x + dx, y: n.y + dy, inX: n.inX + dx, inY: n.inY + dy, outX: n.outX + dx, outY: n.outY + dy };
        if (d.mode === 'out') { const out = { x: n.outX + dx, y: n.outY + dy }; return { ...n, outX: out.x, outY: out.y, ...(e.alt ? {} : { inX: 2 * n.x - out.x, inY: 2 * n.y - out.y }) }; }
        const inn = { x: n.inX + dx, y: n.inY + dy }; return { ...n, inX: inn.x, inY: inn.y, ...(e.alt ? {} : { outX: 2 * n.x - inn.x, outY: 2 * n.y - inn.y }) };
      });
      psPreview = withGeom(d.target, { ...d.geom, nodes });
    }
    engine.setOverride(psPreview.layer, false);
  },
  onUp(_e, engine) {
    const p = psPreview; const d = psDrag; psDrag = null; psPreview = null;
    engine.clearOverride();
    if (!p || !d) return;
    commit((s) => ({ ...s, layers: updateLayer(s.layers, p.layer.id, () => p.layer) }), { history: d.mode === 'move' ? (p.kind === 'vmask' ? 'Move Vector Mask' : 'Move Shape') : 'Edit Path' });
  },
  onKeyDown(e, engine) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && psSelected !== null) {
      const t = pathTarget(engine); if (!t) return false;
      const g = geometryToPath(geomOf(t));
      if (g.nodes.length <= 2) return true;
      const ng = { ...g, nodes: g.nodes.filter((_, i) => i !== psSelected) };
      const nt = withGeom(t, ng); psSelected = null;
      commit((s) => ({ ...s, layers: updateLayer(s.layers, nt.layer.id, () => nt.layer) }), { history: 'Delete Anchor Point' });
      return true;
    }
    return false;
  },
  drawOverlay(ctx, engine) {
    const t = psPreview ?? pathTarget(engine); if (!t) return;
    const g = geometryToPath(geomOf(t));
    drawPath(ctx, engine, g.nodes, g.kind === 'line' ? false : g.closed, matOf(t), psSelected, true);
  },
};

export function _unused(e: ToolPointerEvent) { return e; }
export const shapeAt = (engine: Engine, p: Point) => engine.state ? layersTopDown(engine.state.layers).find((l) => l.type === 'shape' && hitTestLayer(l, p)) ?? null : null;
export const findAny = findLayer;
