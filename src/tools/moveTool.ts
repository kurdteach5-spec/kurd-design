import type { Tool, ToolPointerEvent } from './types';
import type { Engine } from '../canvas/engine';
import type { DocState, Layer, RasterLayer } from '../types/document';
import { TransformSession, drawTransformBox, type Handle } from './transformSession';
import { useTransform, bumpTransform, commitTransform, cancelTransform, transformTargetIds } from './transformState';
import { useTools } from '../state/toolStore';
import { commit } from '../state/documentStore';
import { layersTopDown, findLayer, updateLayer, findParent } from '../layers/tree';
import { hitTestLayer } from '../layers/geometry';
import { getPaintTarget, activeLayer, snapLines, snapValue, snappingOn } from './helpers';
import { createCanvas, ctx2d } from '../utils/canvas';
import { makeSelection, selectionOutline } from '../canvas/selection';
import { translate } from '../utils/math';
import { editTextLayer } from './textTool';
import { editSmartContents } from '../editor/smartObjects';

interface FloatMove { target: ReturnType<typeof getPaintTarget> & object; floating: HTMLCanvasElement; selMask: HTMLCanvasElement; start: { x: number; y: number }; dx: number; dy: number; layer: RasterLayer }

let temp: TransformSession | null = null; // per-drag session when not in Free Transform
let tempKey: DocState | null = null;
let activeHandle: Handle | null = null;
let hoverHandle: Handle | null = null;
let floatMove: FloatMove | null = null;
let guideDrag: { id: string; orientation: 'h' | 'v' } | null = null;

function currentSession(engine: Engine): TransformSession | null {
  const s = useTransform.getState().session;
  if (s) return s;
  const st = engine.state;
  if (!st || !useTools.getState().options.move.showTransform) return null;
  if (tempKey !== st || (temp && temp.dragging === false && tempKey !== st)) { temp = TransformSession.create(st, transformTargetIds()); tempKey = st; }
  return temp;
}

function pickLayer(st: DocState, p: { x: number; y: number }): Layer | null {
  for (const l of layersTopDown(st.layers)) {
    if (l.type === 'group' || l.locked) continue;
    // skip layers inside hidden groups
    let hidden = !l.visible; let loc = findParent(st.layers, l.id);
    while (!hidden && loc?.parent) { if (!loc.parent.visible) hidden = true; loc = findParent(st.layers, loc.parent.id); }
    if (!hidden && hitTestLayer(l, p)) return l;
  }
  return null;
}

function guideAt(engine: Engine, e: ToolPointerEvent) {
  const st = engine.state; if (!st) return null;
  for (const g of st.guides) {
    const s = engine.docToScreen(g.orientation === 'v' ? { x: g.pos, y: e.doc.y } : { x: e.doc.x, y: g.pos });
    if (Math.hypot(s.x - e.screen.x, s.y - e.screen.y) < 4) return g;
  }
  return null;
}

export const moveTool: Tool = {
  id: 'move',
  hoverOverlay: false,
  cursor(engine, e) {
    if (guideDrag) return guideDrag.orientation === 'v' ? 'col-resize' : 'row-resize';
    if (e && engine.state && guideAt(engine, e)) return guideAt(engine, e)!.orientation === 'v' ? 'col-resize' : 'row-resize';
    const s = currentSession(engine);
    const h = activeHandle ?? hoverHandle;
    if (s && h && h !== 'inside') return s.cursorFor(h, engine);
    return 'move';
  },
  activate() { temp = null; tempKey = null; },
  deactivate(engine) { if (useTransform.getState().session) commitTransform(); temp = null; engine.clearOverride(); },
  hasSession: () => !!useTransform.getState().session,
  commit: () => commitTransform(),
  cancel: () => cancelTransform(),

  /** Double-click text to edit it, or a smart object to edit its contents. */
  onDoubleClick(e, engine) {
    const st = engine.state; if (!st) return;
    const hit = layersTopDown(st.layers).find((l) => (l.type === 'text' || l.type === 'smart') && l.visible && !l.locked && hitTestLayer(l, e.doc));
    if (!hit) return;
    if (useTransform.getState().session) commitTransform();
    if (hit.type === 'text') editTextLayer(hit.id); else editSmartContents(hit.id);
  },
  onDown(e, engine) {
    const st = engine.state; if (!st) return;
    const free = useTransform.getState().session;
    // guides
    const g = !free && guideAt(engine, e);
    if (g) { guideDrag = { id: g.id, orientation: g.orientation }; return; }

    let session = currentSession(engine);
    let handle = session ? session.hitTest(engine, e.screen) : null;
    if (free) {
      if (!handle) handle = 'inside';
      activeHandle = handle; free.beginDrag(handle, e.doc); return;
    }
    // auto-select / ctrl-click picks the layer under the cursor
    const opts = useTools.getState().options.move;
    if ((opts.autoSelect || e.ctrl) && (!handle || handle === 'inside')) {
      const hit = pickLayer(st, e.doc);
      if (hit && hit.id !== st.activeLayerId) {
        commit((s) => ({ ...s, activeLayerId: hit.id, selectedLayerIds: [hit.id], editTarget: 'content' }));
        const ns = engine.state!;
        temp = TransformSession.create(ns, [hit.id]); tempKey = ns; session = temp; handle = 'inside';
      }
    }
    const layer = activeLayer(engine.state);
    if (!layer) return;
    if (layer.locked) { import('../state/uiStore').then((m) => m.toast('This layer is locked.', 'warning')); return; }
    // move selected pixels
    if (st.selection && layer.type === 'raster' && (!handle || handle === 'inside') && st.editTarget === 'content') {
      const target = getPaintTarget(st);
      if (!target) return;
      const floating = createCanvas(target.canvas.width, target.canvas.height); const fx = ctx2d(floating);
      fx.drawImage(target.base, 0, 0);
      fx.globalCompositeOperation = 'destination-in'; fx.drawImage(st.selection.mask, -target.ox, -target.oy);
      const bx = ctx2d(target.base); bx.globalCompositeOperation = 'destination-out'; bx.drawImage(st.selection.mask, -target.ox, -target.oy); bx.globalCompositeOperation = 'source-over';
      floatMove = { target, floating, selMask: st.selection.mask, start: e.doc, dx: 0, dy: 0, layer };
      return;
    }
    if (!session) { session = TransformSession.create(st, transformTargetIds()); temp = session; tempKey = st; }
    if (!session) return;
    activeHandle = handle ?? 'inside';
    session.beginDrag(activeHandle, e.doc);
  },

  onMove(e, engine, dragging) {
    const st = engine.state; if (!st) return;
    if (guideDrag) {
      engine.invalidateView();
      const pos = Math.round(guideDrag.orientation === 'v' ? e.doc.x : e.doc.y);
      commit((s) => ({ ...s, guides: s.guides.map((g) => (g.id === guideDrag!.id ? { ...g, pos } : g)) }), { history: 'Move Guide', mergeKey: `guide-${guideDrag.id}` });
      return;
    }
    if (floatMove && dragging) {
      let dx = e.doc.x - floatMove.start.x, dy = e.doc.y - floatMove.start.y;
      if (e.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      dx = Math.round(dx); dy = Math.round(dy);
      floatMove.dx = dx; floatMove.dy = dy;
      const t = floatMove.target; const x = ctx2d(t.canvas);
      x.globalCompositeOperation = 'copy'; x.drawImage(t.base, 0, 0);
      x.globalCompositeOperation = 'source-over'; x.drawImage(floatMove.floating, dx, dy);
      engine.setOverride(t.preview());
      return;
    }
    const session = useTransform.getState().session ?? temp;
    if (dragging && session?.dragging) {
      session.dragTo(e.doc, { shift: e.shift, alt: e.alt, ctrl: e.ctrl && !!useTransform.getState().session }, st, engine);
      session.preview(engine);
      bumpTransform();
      return;
    }
    if (!dragging) {
      const s = currentSession(engine);
      const h = s ? s.hitTest(engine, e.screen) : null;
      if (h !== hoverHandle) { hoverHandle = h; engine.updateCursor(); }
    }
  },

  onUp(_e, engine) {
    if (guideDrag) {
      const st = engine.state;
      const g = st?.guides.find((x) => x.id === guideDrag!.id);
      if (st && g && (g.pos < -2 || (g.orientation === 'v' ? g.pos > st.width + 2 : g.pos > st.height + 2))) {
        // dragged off the canvas → remove
        commit((s) => ({ ...s, guides: s.guides.filter((x) => x.id !== guideDrag!.id) }), { history: 'Delete Guide' });
      }
      guideDrag = null; return;
    }
    if (floatMove) {
      const fm = floatMove; floatMove = null;
      if (fm.dx || fm.dy) {
        const st = engine.state!;
        const newMask = createCanvas(st.width, st.height); ctx2d(newMask).drawImage(fm.selMask, fm.dx, fm.dy);
        const canvas = fm.target.canvas; const { ox, oy } = fm.target; const id = fm.layer.id;
        commit((s) => ({
          ...s,
          layers: updateLayer(s.layers, id, (l) => ({ ...l, canvas: copy(canvas), transform: translate(ox, oy) } as Layer)),
          selection: makeSelection(newMask),
        }), { history: 'Move Selection Contents' });
      }
      engine.clearOverride();
      return;
    }
    const free = useTransform.getState().session;
    const session = free ?? temp;
    if (!session) return;
    session.endDrag();
    activeHandle = null;
    if (!free) {
      if (session.changed) session.commit(session.isAffine ? 'Move' : 'Distort');
      temp = null; tempKey = null;
      engine.clearOverride();
    }
    bumpTransform();
  },

  onKeyDown(e, engine) {
    if (!useTransform.getState().session) return false;
    if (e.key === 'Enter') { commitTransform(); return true; }
    if (e.key === 'Escape') { cancelTransform(); engine.invalidate(); return true; }
    return false;
  },

  drawOverlay(ctx, engine) {
    const free = useTransform.getState().session;
    const target = useTransform.getState().target;
    if (free && target === 'selection' && engine.state?.selection && free.isAffine) {
      const D = free.delta(); const vm = engine.viewMatrix();
      ctx.save(); ctx.transform(vm.a, vm.b, vm.c, vm.d, vm.e, vm.f); ctx.transform(D.a, D.b, D.c, D.d, D.e, D.f);
      ctx.strokeStyle = '#fff'; ctx.setLineDash([4 / engine.zoom, 4 / engine.zoom]); ctx.lineWidth = 1 / engine.zoom;
      ctx.stroke(selectionOutline(engine.state.selection)); ctx.restore();
    }
    if (floatMove) return;
    const s = free ?? currentSession(engine);
    if (s) drawTransformBox(ctx, engine, s, free ? '#ffb547' : '#4f8cff');
  },
};

function copy(c: HTMLCanvasElement) { const o = createCanvas(c.width, c.height); ctx2d(o).drawImage(c, 0, 0); return o; }

/** Nudges the active/selected layers (arrow keys). */
export function nudge(dx: number, dy: number) {
  const free = useTransform.getState().session;
  if (free) { free.corners = free.corners.map((p) => ({ x: p.x + dx, y: p.y + dy })); const e = import('../canvas/engine'); e.then((m) => { const en = m.getEngine(); if (en) free.preview(en); }); bumpTransform(); return; }
  const ids = transformTargetIds();
  if (!ids.length) return;
  commit((s) => {
    let layers = s.layers;
    for (const id of ids) {
      const l = findLayer(layers, id); if (!l) continue;
      layers = updateLayer(layers, id, (x) => moveLayerBy(x, dx, dy));
    }
    return { ...s, layers };
  }, { history: 'Nudge', mergeKey: 'nudge' });
}

function moveLayerBy(l: Layer, dx: number, dy: number): Layer {
  const T = translate(dx, dy);
  const mul = (a: typeof T, b: typeof T) => ({ a: b.a, b: b.b, c: b.c, d: b.d, e: b.e + a.e, f: b.f + a.f });
  const mask = l.mask && l.mask.linked ? { ...l.mask, transform: mul(T, l.mask.transform) } : l.mask;
  const vm = l.vectorMask ? { ...l.vectorMask, transform: mul(T, l.vectorMask.transform) } : null;
  if (l.type === 'group') return { ...l, mask, vectorMask: vm, children: l.children.map((c) => moveLayerBy(c, dx, dy)) };
  if (l.type === 'adjustment') return { ...l, mask, vectorMask: vm };
  return { ...l, transform: mul(T, l.transform), mask, vectorMask: vm } as Layer;
}

export { snapLines, snapValue, snappingOn };
