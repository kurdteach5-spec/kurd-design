import type { Tool } from './types';
import type { Engine } from '../canvas/engine';
import { useTools } from '../state/toolStore';
import { commit } from '../state/documentStore';
import { cropDocument } from '../layers/docOps';
import { create } from '../state/createStore';
import { normRect, type Point, type Rect } from '../utils/math';

// ---------------- Hand ----------------
export const handTool: Tool = { id: 'hand', cursor: (engine) => (engine.pointerDown ? 'grabbing' : 'grab') };

// ---------------- Zoom ----------------
let zStart: { doc: Point; screen: Point } | null = null; let zEnd: Point | null = null; let zOut = false;
export const zoomTool: Tool = {
  id: 'zoom',
  cursor: (_e, ev) => (ev?.alt ? 'zoom-out' : 'zoom-in'),
  onDown(e) { zStart = { doc: e.doc, screen: e.screen }; zEnd = e.screen; zOut = e.alt; },
  onMove(e, _en, dragging) { if (dragging && zStart) zEnd = e.screen; },
  onUp(_e, engine) {
    if (!zStart || !zEnd) return;
    const dx = zEnd.x - zStart.screen.x, dy = zEnd.y - zStart.screen.y;
    if (Math.abs(dx) > 6 && Math.abs(dy) > 6 && !zOut) {
      const a = engine.screenToDoc(zStart.screen), b = engine.screenToDoc(zEnd);
      const r = normRect(a.x, a.y, b.x, b.y);
      const z = Math.min(engine.width / r.w, engine.height / r.h);
      const st = engine.state!;
      engine.setView({ zoom: Math.min(64, z), panX: -(r.x + r.w / 2 - st.width / 2) * z, panY: -(r.y + r.h / 2 - st.height / 2) * z });
    } else engine.zoomStep(zOut ? -1 : 1, zStart.screen);
    zStart = null; zEnd = null;
  },
  drawOverlay(ctx) {
    if (!zStart || !zEnd) return;
    ctx.save(); ctx.strokeStyle = '#4f8cff'; ctx.setLineDash([3, 3]);
    ctx.strokeRect(zStart.screen.x + 0.5, zStart.screen.y + 0.5, zEnd.x - zStart.screen.x, zEnd.y - zStart.screen.y); ctx.restore();
  },
};

// ---------------- Crop ----------------
export const useCrop = create<{ rect: Rect | null; version: number }>(() => ({ rect: null, version: 0 }));
type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move' | 'new';
let cDrag: { handle: CropHandle; start: Point; r0: Rect } | null = null;

function ratioValue(engine: Engine): number | null {
  const r = useTools.getState().options.crop.ratio;
  if (r === 'free') return null;
  if (r === 'original') { const s = engine.state!; return s.width / s.height; }
  const [a, b] = r.split(':').map(Number); return a / b;
}
const handles = (r: Rect): [CropHandle, Point][] => [
  ['nw', { x: r.x, y: r.y }], ['n', { x: r.x + r.w / 2, y: r.y }], ['ne', { x: r.x + r.w, y: r.y }], ['e', { x: r.x + r.w, y: r.y + r.h / 2 }],
  ['se', { x: r.x + r.w, y: r.y + r.h }], ['s', { x: r.x + r.w / 2, y: r.y + r.h }], ['sw', { x: r.x, y: r.y + r.h }], ['w', { x: r.x, y: r.y + r.h / 2 }],
];
function hit(engine: Engine, r: Rect, s: Point): CropHandle {
  for (const [id, p] of handles(r)) { const q = engine.docToScreen(p); if (Math.abs(q.x - s.x) < 8 && Math.abs(q.y - s.y) < 8) return id; }
  const d = engine.screenToDoc(s);
  if (d.x > r.x && d.y > r.y && d.x < r.x + r.w && d.y < r.y + r.h) return 'move';
  return 'new';
}
const setRect = (rect: Rect | null) => useCrop.setState((s) => ({ rect, version: s.version + 1 }));

export function applyCrop(engine: Engine) {
  const r = useCrop.getState().rect; const st = engine.state;
  if (!r || !st) return;
  const rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
  if (rect.w < 1 || rect.h < 1) return;
  if (!(rect.x === 0 && rect.y === 0 && rect.w === st.width && rect.h === st.height)) {
    commit((s) => cropDocument(s, rect, useTools.getState().options.crop.deleteCropped), { history: 'Crop' });
    requestAnimationFrame(() => engine.fit());
  }
  setRect(engine.state ? { x: 0, y: 0, w: engine.state.width, h: engine.state.height } : null);
}

export const cropTool: Tool = {
  id: 'crop',
  cursor(engine, e) {
    const r = useCrop.getState().rect; if (!r || !e) return 'crosshair';
    const h = cDrag?.handle ?? hit(engine, r, e.screen);
    return h === 'move' ? 'move' : h === 'new' ? 'crosshair' : h === 'n' || h === 's' ? 'ns-resize' : h === 'e' || h === 'w' ? 'ew-resize' : h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize';
  },
  activate(engine) { const st = engine.state; setRect(st ? { x: 0, y: 0, w: st.width, h: st.height } : null); },
  deactivate() { setRect(null); cDrag = null; },
  hasSession: () => !!useCrop.getState().rect,
  commit: (engine) => applyCrop(engine),
  cancel: (engine) => { const st = engine.state; setRect(st ? { x: 0, y: 0, w: st.width, h: st.height } : null); engine.invalidateView(); },
  onDown(e, engine) {
    const st = engine.state; if (!st) return;
    let r = useCrop.getState().rect ?? { x: 0, y: 0, w: st.width, h: st.height };
    const h = hit(engine, r, e.screen);
    if (h === 'new') { r = { x: e.doc.x, y: e.doc.y, w: 0, h: 0 }; setRect(r); }
    cDrag = { handle: h, start: e.doc, r0: { ...r } };
  },
  onMove(e, engine, dragging) {
    if (!dragging || !cDrag) return;
    const { handle, start, r0 } = cDrag; const dx = e.doc.x - start.x, dy = e.doc.y - start.y;
    let x0 = r0.x, y0 = r0.y, x1 = r0.x + r0.w, y1 = r0.y + r0.h;
    if (handle === 'move') { setRect({ ...r0, x: r0.x + dx, y: r0.y + dy }); return; }
    if (handle === 'new') { x1 = e.doc.x; y1 = e.doc.y; }
    else {
      if (handle.includes('w')) x0 += dx; if (handle.includes('e')) x1 += dx;
      if (handle.includes('n')) y0 += dy; if (handle.includes('s')) y1 += dy;
    }
    const ratio = ratioValue(engine) ?? (e.shift ? Math.abs(r0.w / (r0.h || 1)) || 1 : null);
    if (ratio) {
      const w = x1 - x0; let h = y1 - y0;
      if (handle === 'n' || handle === 's') { const nw = Math.abs(h) * ratio * Math.sign(w || 1); x1 = x0 + nw; }
      else { h = (Math.abs(w) / ratio) * Math.sign(h || 1); if (handle.includes('n')) y0 = y1 - h; else y1 = y0 + h; }
    }
    setRect(normRect(x0, y0, x1, y1));
  },
  onUp() { cDrag = null; },
  onDoubleClick(_e, engine) { applyCrop(engine); },
  onKeyDown(e, engine) {
    if (e.key === 'Enter') { applyCrop(engine); return true; }
    if (e.key === 'Escape') { cropTool.cancel!(engine); return true; }
    return false;
  },
  drawOverlay(ctx, engine) {
    const r = useCrop.getState().rect; const st = engine.state; if (!r || !st) return;
    const q = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }].map((p) => engine.docToScreen(p));
    ctx.save();
    ctx.fillStyle = 'rgba(10,11,13,0.55)';
    ctx.beginPath(); ctx.rect(0, 0, engine.width, engine.height);
    ctx.moveTo(q[0].x, q[0].y); q.slice(1).forEach((p) => ctx.lineTo(p.x, p.y)); ctx.closePath();
    ctx.fill('evenodd');
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
    ctx.beginPath(); q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    for (const t of [1 / 3, 2 / 3]) {
      const a = engine.docToScreen({ x: r.x + r.w * t, y: r.y }), b = engine.docToScreen({ x: r.x + r.w * t, y: r.y + r.h });
      const c = engine.docToScreen({ x: r.x, y: r.y + r.h * t }), d = engine.docToScreen({ x: r.x + r.w, y: r.y + r.h * t });
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    for (const [, p] of handles(r)) { const s = engine.docToScreen(p); ctx.fillRect(s.x - 4, s.y - 4, 8, 8); }
    const label = `${Math.round(r.w)} × ${Math.round(r.h)}`;
    ctx.font = '11px Inter, sans-serif'; const w = ctx.measureText(label).width + 12;
    ctx.fillStyle = 'rgba(20,22,26,0.9)'; ctx.fillRect(q[2].x - w, q[2].y + 8, w, 20);
    ctx.fillStyle = '#e8eaed'; ctx.fillText(label, q[2].x - w + 6, q[2].y + 22);
    ctx.restore();
  },
};
