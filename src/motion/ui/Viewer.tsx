// Composition viewer: renders the current frame and handles on-canvas tools
// (select/move/scale/rotate, anchor point, motion paths, masks, shapes, pen, text, hand, zoom, camera).
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import type { Composition, MLayer, MPath, PathVertex, Vec2, Vec3 } from '../types';
import { useMotion, activeComp, getProp, setTime } from '../store';
import * as A from '../actions';
import { valueAt, setAt, formatTimecode } from '../anim';
import { renderComp, layerCorners, compToLayer, layerToComp, compDeltaToParent, worldMatrix, isVisual, activeAt, contentBounds } from '../render/renderer';
import { apply4 } from '../render/mat4';
import { useAssetVersion, onVideoFrame } from '../media/assets';
import { syncPaused, togglePlay, stop } from '../media/playback';
import { useMotionUI } from '../uiState';
import { pointInPolygon } from '../../utils/math';
import { createCanvas, ctx2d } from '../../utils/canvas';
import { toast } from '../../state/uiStore';
import { pathToPath2D } from '../render/draw';
import { LuPlay, LuPause, LuSquare, LuSkipBack, LuSkipForward, LuStepBack, LuStepForward, LuRepeat, LuX } from 'react-icons/lu';

// ---------- frame cache (RAM preview) ----------
const frameCache = new Map<string, ImageBitmap>();
let cacheBytes = 0; let cacheSig = '';
function cachePut(key: string, bmp: ImageBitmap) {
  frameCache.set(key, bmp); cacheBytes += bmp.width * bmp.height * 4;
  while (cacheBytes > 700 * 1024 * 1024 && frameCache.size) { const k = frameCache.keys().next().value as string; const b = frameCache.get(k)!; cacheBytes -= b.width * b.height * 4; b.close(); frameCache.delete(k); }
}
function cacheReset(sig: string) { if (sig === cacheSig) return; cacheSig = sig; for (const b of frameCache.values()) b.close(); frameCache.clear(); cacheBytes = 0; }
export const cachedFrames = () => frameCache.size;

function hasVideo(project: ReturnType<typeof useMotion.getState>['project'], c: Composition, depth = 0): boolean {
  if (depth > 6) return false;
  return c.layers.some((l) => l.type === 'video' || (l.type === 'precomp' && !!project.comps[l.compId] && hasVideo(project, project.comps[l.compId], depth + 1)));
}

type Drag =
  | { kind: 'move'; ids: string[]; start: { x: number; y: number }; orig: Map<string, Vec3> }
  | { kind: 'scale'; id: string; handle: number; anchorScreen: { x: number; y: number }; startDist: { x: number; y: number }; orig: Vec3; axis: { x: boolean; y: boolean } }
  | { kind: 'rotate'; id: string; center: { x: number; y: number }; startAngle: number; orig: number }
  | { kind: 'anchor'; id: string; start: { x: number; y: number }; origA: Vec3; origP: Vec3 }
  | { kind: 'pathKey'; id: string; keyId: string; start: { x: number; y: number }; orig: Vec3 }
  | { kind: 'tangent'; id: string; keyId: string; which: 'so' | 'si' }
  | { kind: 'maskVertex'; id: string; maskId: string; index: number; part: 'p' | 'i' | 'o'; start: { x: number; y: number }; orig: MPath }
  | { kind: 'draw'; shape: 'rect' | 'ellipse' | 'polygon' | 'star'; a: { x: number; y: number }; b: { x: number; y: number } }
  | { kind: 'pan'; sx: number; sy: number; px: number; py: number }
  | { kind: 'camera'; id: string; sx: number; sy: number; mode: 'orbit' | 'pan' | 'dolly'; origP: Vec3; origRX: number; origRY: number }
  | { kind: 'zoombox' };

export function Viewer() {
  const comp = useMotion((s) => activeComp(s));
  const t = useMotion((s) => (s.activeCompId ? s.times[s.activeCompId] ?? 0 : 0));
  const project = useMotion((s) => s.project);
  const version = useMotion((s) => s.version);
  const quality = useMotion((s) => s.quality);
  const view = useMotion((s) => s.view);
  const tool = useMotion((s) => s.tool);
  const playing = useMotion((s) => s.playing);
  const selected = useMotion((s) => s.selectedLayers);
  const shapeMode = useMotion((s) => s.shapeToolMode);
  const ui = useMotionUI();
  const assetV = useAssetVersion((s) => s.v);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 450 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pen, setPen] = useState<{ pts: PathVertex[]; layerId: string | null } | null>(null);
  const [textEdit, setTextEdit] = useState<{ id: string; x: number; y: number } | null>(null);
  const [tick, setTick] = useState(0);
  const offscreen = useRef<HTMLCanvasElement | null>(null);
  const dragId = useRef(0);
  const finishPenRef = useRef<(closed: boolean) => void>(() => {});
  useEffect(() => {
    if (!pen) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finishPenRef.current(false); } if (e.key === 'Escape') { e.stopPropagation(); setPen(null); } };
    window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true);
  }, [pen]);
  useEffect(() => { if (tool !== 'pen') setPen(null); }, [tool]);

  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [!!comp]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const f = () => setTick((n) => n + 1); onVideoFrame.add(f); return () => { onVideoFrame.delete(f); }; }, []);
  useEffect(() => { syncPaused(); }, [t, comp?.id, version]);

  const dpr = window.devicePixelRatio || 1;
  const zoom = comp ? (view.fit ? Math.max(0.02, Math.min((size.w - 40) / comp.width, (size.h - 40) / comp.height)) : view.zoom) : 1;
  const ox = comp ? (size.w - comp.width * zoom) / 2 + (view.fit ? 0 : view.panX) : 0;
  const oy = comp ? (size.h - comp.height * zoom) / 2 + (view.fit ? 0 : view.panY) : 0;
  const toScreen = (p: { x: number; y: number }) => ({ x: ox + p.x * zoom, y: oy + p.y * zoom });
  const toComp = (sx: number, sy: number) => ({ x: (sx - ox) / zoom, y: (sy - oy) / zoom });

  // ----- render -----
  useEffect(() => {
    if (!comp) return;
    const raf = requestAnimationFrame(() => {
      const cv = canvas.current; if (!cv) return;
      const W = Math.round(size.w * dpr), H = Math.round(size.h * dpr);
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      const x = ctx2d(cv);
      x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, H);
      const q = Math.min(quality, Math.max(0.1, zoom * dpr));
      const sig = `${comp.id}|${version}|${q.toFixed(3)}|${assetV}`;
      cacheReset(sig);
      const frame = Math.round(t * comp.fps);
      const key = `${frame}`;
      let img: CanvasImageSource | null = playing ? frameCache.get(key) ?? null : null;
      if (!img) {
        offscreen.current ??= createCanvas(2, 2);
        img = renderComp(project, comp, t, { quality: q, transparent: true, mbSamples: comp.motionBlur ? (playing ? 4 : 8) : 0, videoKey: 'p' }, offscreen.current);
        if (playing && !hasVideo(project, comp)) createImageBitmap(img as HTMLCanvasElement).then((b) => { if (cacheSig === sig) cachePut(key, b); else b.close(); }).catch(() => {});
      }
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      // background: checkerboard or composition color
      if (ui.checker) { x.save(); x.fillStyle = checkerPattern(x); x.fillRect(ox, oy, comp.width * zoom, comp.height * zoom); x.restore(); }
      else { x.fillStyle = comp.background; x.fillRect(ox, oy, comp.width * zoom, comp.height * zoom); }
      x.imageSmoothingQuality = 'high';
      x.drawImage(img, ox, oy, comp.width * zoom, comp.height * zoom);
    });
    return () => cancelAnimationFrame(raf);
  }, [comp, t, project, version, quality, size, zoom, ox, oy, playing, ui.checker, assetV, tick, dpr]);

  if (!comp) return <EmptyViewer />;

  const selLayers = comp.layers.filter((l) => selected.includes(l.id));
  const single = selLayers.length === 1 ? selLayers[0] : null;

  // ----- hit testing -----
  const hitLayer = (p: { x: number; y: number }): MLayer | null => {
    for (const l of comp.layers) {
      if (!l.visible || !activeAt(l, t) || !isVisual(l) || l.locked || l.type === 'adjustment') continue;
      const c = layerCorners(project, comp, l, t);
      if (c && pointInPolygon(p, c)) return l;
    }
    return null;
  };

  // ----- pointer handling -----
  const onDown = (e: React.PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && tool === 'hand')) { startPan(e); return; }
    if (e.button !== 0) return;
    const r = box.current!.getBoundingClientRect();
    const sp = { x: e.clientX - r.left, y: e.clientY - r.top };
    const p = toComp(sp.x, sp.y);
    const target = (e.target as Element).closest('[data-h]') as HTMLElement | null;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (textEdit) { setTextEdit(null); }
    if (target) { startHandle(target.dataset, p, e); return; }
    switch (tool) {
      case 'zoom': zoomAt(sp, e.altKey ? 0.5 : 2); return;
      case 'text': {
        const hit = hitLayer(p);
        if (hit && hit.type === 'text') { A.selectLayers([hit.id]); setTextEdit({ id: hit.id, x: sp.x, y: sp.y }); return; }
        const id = A.addText('Text', [p.x, p.y, 0]);
        if (id) setTextEdit({ id, x: sp.x, y: sp.y });
        return;
      }
      case 'rect': case 'ellipse': case 'polygon': case 'star':
        setDrag({ kind: 'draw', shape: tool, a: p, b: p }); return;
      case 'pen': { penClick(p, e); return; }
      case 'camera': {
        const cam = comp.layers.find((l) => l.type === 'camera' && l.visible && activeAt(l, t));
        if (!cam) { toast('Add a camera first (Layer › New › Camera).', 'info'); return; }
        const tr = cam.transform;
        setDrag({ kind: 'camera', id: cam.id, sx: e.clientX, sy: e.clientY, mode: e.altKey ? 'dolly' : e.shiftKey ? 'pan' : 'orbit', origP: valueAt(tr.position, t), origRX: valueAt(tr.rotationX, t), origRY: valueAt(tr.rotationY, t) });
        return;
      }
      default: {
        const hit = hitLayer(p);
        if (!hit) { if (!e.shiftKey) A.selectLayers([]); return; }
        let ids = selected;
        if (e.shiftKey) { ids = selected.includes(hit.id) ? selected.filter((x) => x !== hit.id) : [...selected, hit.id]; A.selectLayers(ids); }
        else if (!selected.includes(hit.id)) { ids = [hit.id]; A.selectLayers(ids); }
        if (tool === 'rotate') { startRotate(hit, sp); return; }
        if (tool === 'anchor') { setDrag({ kind: 'anchor', id: hit.id, start: p, origA: valueAt(hit.transform.anchor, t), origP: valueAt(hit.transform.position, t) }); return; }
        const orig = new Map<string, Vec3>();
        for (const l of comp.layers) if (ids.includes(l.id) && !l.locked) orig.set(l.id, valueAt(l.transform.position, t));
        setDrag({ kind: 'move', ids: [...orig.keys()], start: p, orig });
      }
    }
  };

  const startPan = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    useMotion.setState((s) => ({ view: { ...s.view, fit: false, zoom, panX: view.fit ? 0 : s.view.panX, panY: view.fit ? 0 : s.view.panY } }));
    setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, px: view.fit ? 0 : view.panX, py: view.fit ? 0 : view.panY });
  };
  const zoomAt = (sp: { x: number; y: number }, f: number) => {
    const nz = Math.max(0.05, Math.min(16, zoom * f));
    const c = toComp(sp.x, sp.y);
    // keep the clicked point under the cursor
    const panX = sp.x - (size.w - comp.width * nz) / 2 - c.x * nz, panY = sp.y - (size.h - comp.height * nz) / 2 - c.y * nz;
    useMotion.setState({ view: { zoom: nz, fit: false, panX, panY } });
  };
  const startRotate = (l: MLayer, sp: { x: number; y: number }) => {
    const a = valueAt(l.transform.anchor, t); const c = toScreen(layerToComp(comp, l, t, a[0], a[1]));
    setDrag({ kind: 'rotate', id: l.id, center: c, startAngle: Math.atan2(sp.y - c.y, sp.x - c.x), orig: valueAt(l.transform.rotation, t) });
  };

  const startHandle = (d: DOMStringMap, p: { x: number; y: number }, e: React.PointerEvent) => {
    const l = comp.layers.find((x) => x.id === d.layer); if (!l) return;
    const r = box.current!.getBoundingClientRect(); const sp = { x: e.clientX - r.left, y: e.clientY - r.top };
    switch (d.h) {
      case 'scale': {
        const a = valueAt(l.transform.anchor, t); const anchorScreen = toScreen(layerToComp(comp, l, t, a[0], a[1]));
        const idx = Number(d.idx);
        setDrag({ kind: 'scale', id: l.id, handle: idx, anchorScreen, startDist: { x: sp.x - anchorScreen.x, y: sp.y - anchorScreen.y }, orig: valueAt(l.transform.scale, t), axis: { x: idx !== 1 && idx !== 5, y: idx !== 3 && idx !== 7 } });
        return;
      }
      case 'rotate': startRotate(l, sp); return;
      case 'anchor': setDrag({ kind: 'anchor', id: l.id, start: p, origA: valueAt(l.transform.anchor, t), origP: valueAt(l.transform.position, t) }); return;
      case 'pathKey': {
        const k = l.transform.position.k.find((x) => x.id === d.key); if (!k) return;
        setTime(k.t);
        setDrag({ kind: 'pathKey', id: l.id, keyId: k.id, start: p, orig: k.v as Vec3 }); return;
      }
      case 'tangent': setDrag({ kind: 'tangent', id: l.id, keyId: d.key!, which: d.which as 'so' | 'si' }); return;
      case 'mask': {
        const m = l.masks.find((x) => x.id === d.mask); if (!m) return;
        setDrag({ kind: 'maskVertex', id: l.id, maskId: m.id, index: Number(d.idx), part: (d.part as 'p' | 'i' | 'o') ?? 'p', start: p, orig: valueAt(m.path, t) });
        return;
      }
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const r = box.current!.getBoundingClientRect();
    const sp = { x: e.clientX - r.left, y: e.clientY - r.top };
    const p = toComp(sp.x, sp.y);
    const mk = `vdrag-${dragId.current}`;
    switch (drag.kind) {
      case 'pan': useMotion.setState((s) => ({ view: { ...s.view, fit: false, panX: drag.px + e.clientX - drag.sx, panY: drag.py + e.clientY - drag.sy } })); return;
      case 'move': {
        let dx = p.x - drag.start.x, dy = p.y - drag.start.y;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        const ids = drag.ids;
        A.setPropForLayers(ids, 'transform.position', (prop) => {
          const l = comp.layers.find((x) => getProp(x, 'transform.position') === prop)!;
          const o = drag.orig.get(l.id)!; const [px, py] = compDeltaToParent(comp, l, t, dx, dy);
          return [Math.round((o[0] + px) * 10) / 10, Math.round((o[1] + py) * 10) / 10, o[2]] as Vec3;
        }, 'Move Layer', mk);
        return;
      }
      case 'scale': {
        const l = comp.layers.find((x) => x.id === drag.id)!;
        const fx = drag.axis.x && Math.abs(drag.startDist.x) > 2 ? (sp.x - drag.anchorScreen.x) / drag.startDist.x : 1;
        const fy = drag.axis.y && Math.abs(drag.startDist.y) > 2 ? (sp.y - drag.anchorScreen.y) / drag.startDist.y : 1;
        let sx = fx, sy = fy;
        if (e.shiftKey || (drag.axis.x && drag.axis.y && !e.altKey)) { const f = drag.axis.x && drag.axis.y ? (Math.abs(fx) > Math.abs(fy) ? fx : fy) : drag.axis.x ? fx : fy; sx = drag.axis.x || e.shiftKey ? f : 1; sy = drag.axis.y || e.shiftKey ? f : 1; }
        A.setPropValue(l.id, 'transform.scale', [round1(drag.orig[0] * sx), round1(drag.orig[1] * sy), drag.orig[2]] as Vec3, mk, 'Scale');
        return;
      }
      case 'rotate': {
        let a = ((Math.atan2(sp.y - drag.center.y, sp.x - drag.center.x) - drag.startAngle) * 180) / Math.PI;
        if (e.shiftKey) a = Math.round(a / 15) * 15;
        A.setPropValue(drag.id, 'transform.rotation', round1(drag.orig + a), mk, 'Rotate');
        return;
      }
      case 'anchor': {
        const l = comp.layers.find((x) => x.id === drag.id)!;
        const la = compToLayer(comp, l, t, p.x, p.y), l0 = compToLayer(comp, l, t, drag.start.x, drag.start.y);
        const da = [la.x - l0.x, la.y - l0.y];
        // keep the layer in place: move position by the anchor change in parent space
        const w0 = layerToComp(comp, l, t, drag.origA[0], drag.origA[1]), w1 = layerToComp(comp, l, t, drag.origA[0] + da[0], drag.origA[1] + da[1]);
        const [pdx, pdy] = compDeltaToParent(comp, l, t, w1.x - w0.x, w1.y - w0.y);
        A.setPropValue(l.id, 'transform.anchor', [round1(drag.origA[0] + da[0]), round1(drag.origA[1] + da[1]), drag.origA[2]] as Vec3, mk + 'a', 'Move Anchor Point');
        A.setPropValue(l.id, 'transform.position', [round1(drag.origP[0] + pdx), round1(drag.origP[1] + pdy), drag.origP[2]] as Vec3, mk + 'p', 'Move Anchor Point');
        return;
      }
      case 'pathKey': {
        const l = comp.layers.find((x) => x.id === drag.id)!;
        const [dx, dy] = compDeltaToParent(comp, l, t, p.x - drag.start.x, p.y - drag.start.y);
        A.setKeyHandles(l.id, 'transform.position', drag.keyId, { v: [round1(drag.orig[0] + dx), round1(drag.orig[1] + dy), drag.orig[2]] }, 'Move Keyframe', mk);
        return;
      }
      case 'tangent': {
        const l = comp.layers.find((x) => x.id === drag.id)!;
        const k = l.transform.position.k.find((x) => x.id === drag.keyId); if (!k) return;
        const base = parentToComp(comp, l, t, k.v as Vec3);
        const [dx, dy] = compDeltaToParent(comp, l, t, p.x - base.x, p.y - base.y);
        const v: Vec2 = [round1(dx), round1(dy)];
        const mirror: Vec2 = [-v[0], -v[1]];
        A.setKeyHandles(l.id, 'transform.position', drag.keyId, drag.which === 'so' ? { so: v, ...(e.altKey ? {} : { si: mirror }) } : { si: v, ...(e.altKey ? {} : { so: mirror }) }, 'Edit Motion Path', mk);
        return;
      }
      case 'maskVertex': {
        const l = comp.layers.find((x) => x.id === drag.id)!;
        const a = compToLayer(comp, l, t, p.x, p.y), b = compToLayer(comp, l, t, drag.start.x, drag.start.y);
        const dx = a.x - b.x, dy = a.y - b.y;
        const pts = drag.orig.points.map((v, i) => {
          if (i !== drag.index) return v;
          if (drag.part === 'p') return { ...v, x: round1(v.x + dx), y: round1(v.y + dy) };
          const hx = a.x - v.x, hy = a.y - v.y;
          return drag.part === 'o' ? { ...v, ox: round1(hx), oy: round1(hy), ...(e.altKey ? {} : { ix: -round1(hx), iy: -round1(hy) }) } : { ...v, ix: round1(hx), iy: round1(hy), ...(e.altKey ? {} : { ox: -round1(hx), oy: -round1(hy) }) };
        });
        A.setPropValue(l.id, `mask:${drag.maskId}.path`, { ...drag.orig, points: pts }, mk, 'Edit Mask');
        return;
      }
      case 'draw': setDrag({ ...drag, b: p }); return;
      case 'camera': {
        const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        if (drag.mode === 'orbit') { A.setPropValue(drag.id, 'transform.rotationY', round1(drag.origRY + dx * 0.3), mk + 'y', 'Orbit Camera'); A.setPropValue(drag.id, 'transform.rotationX', round1(drag.origRX - dy * 0.3), mk + 'x', 'Orbit Camera'); }
        else if (drag.mode === 'pan') A.setPropValue(drag.id, 'transform.position', [round1(drag.origP[0] - dx / zoom), round1(drag.origP[1] - dy / zoom), drag.origP[2]] as Vec3, mk, 'Track Camera');
        else A.setPropValue(drag.id, 'transform.position', [drag.origP[0], drag.origP[1], round1(drag.origP[2] - dy * 4)] as Vec3, mk, 'Dolly Camera');
        return;
      }
    }
  };
  const onUp = () => {
    if (drag?.kind === 'draw') finishDraw(drag);
    dragId.current++;
    setDrag(null);
  };

  const finishDraw = (d: Extract<Drag, { kind: 'draw' }>) => {
    const x0 = Math.min(d.a.x, d.b.x), y0 = Math.min(d.a.y, d.b.y), w = Math.abs(d.b.x - d.a.x), h = Math.abs(d.b.y - d.a.y);
    if (w < 3 || h < 3) return;
    const target = shapeMode === 'mask' ? single : null;
    if (target && (d.shape === 'rect' || d.shape === 'ellipse')) {
      // mask in layer space (corners mapped through the layer transform)
      const a = compToLayer(comp, target, t, x0, y0), b = compToLayer(comp, target, t, x0 + w, y0 + h);
      A.addMaskShape(target.id, d.shape, { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
      return;
    }
    if (shapeMode === 'mask' && !target) toast('Select one layer to draw a mask on it. Drawing a shape layer instead.', 'info');
    A.addShape(d.shape, { size: [Math.round(w), Math.round(h)], position: [Math.round(x0 + w / 2), Math.round(y0 + h / 2), 0] });
  };

  // ----- pen -----
  const penClick = (p: { x: number; y: number }, e: React.PointerEvent) => {
    const target = shapeMode === 'mask' ? single : null;
    if (pen && pen.pts.length > 2) {
      const f = pen.pts[0]; const fs = toScreen(penToComp(f, pen.layerId)); const ps = toScreen(p);
      if (Math.hypot(fs.x - ps.x, fs.y - ps.y) < 9) { finishPen(true); return; }
    }
    const lp = target ? compToLayer(comp, target, t, p.x, p.y) : p;
    const v: PathVertex = { x: round1(lp.x), y: round1(lp.y), ix: 0, iy: 0, ox: 0, oy: 0 };
    const cur = pen ?? { pts: [], layerId: target?.id ?? null };
    const next = { ...cur, pts: [...cur.pts, v] };
    setPen(next);
    // drag to pull handles
    const el = e.currentTarget as HTMLElement; const r = box.current!.getBoundingClientRect();
    const mm = (ev: PointerEvent) => {
      const q = toComp(ev.clientX - r.left, ev.clientY - r.top);
      const lq = target ? compToLayer(comp, target, t, q.x, q.y) : q;
      const hx = lq.x - v.x, hy = lq.y - v.y;
      setPen((pp) => pp && { ...pp, pts: pp.pts.map((x, i) => (i === pp.pts.length - 1 ? { ...x, ox: round1(hx), oy: round1(hy), ix: -round1(hx), iy: -round1(hy) } : x)) });
    };
    const up = () => { el.removeEventListener('pointermove', mm); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mm); el.addEventListener('pointerup', up);
  };
  const penToComp = (v: PathVertex, layerId: string | null) => { const l = layerId ? comp.layers.find((x) => x.id === layerId) : null; return l ? layerToComp(comp, l, t, v.x, v.y) : v; };
  const finishPen = (closed: boolean) => {
    if (!pen || pen.pts.length < 2) { setPen(null); return; }
    const path: MPath = { points: pen.pts, closed };
    if (pen.layerId) A.addMask(pen.layerId, path);
    else {
      // shape layer positioned at the path's center
      const xs = pen.pts.map((p) => p.x), ys = pen.pts.map((p) => p.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      A.addShape('path', { path: { closed, points: pen.pts.map((p) => ({ ...p, x: round1(p.x - cx), y: round1(p.y - cy) })) }, position: [Math.round(cx), Math.round(cy), 0] });
    }
    setPen(null);
  };
  finishPenRef.current = finishPen;

  // ----- overlays -----
  const overlays: ReactElement[] = [];
  const S = (p: { x: number; y: number }) => toScreen(p);
  // comp frame
  overlays.push(<rect key="frame" x={ox} y={oy} width={comp.width * zoom} height={comp.height * zoom} fill="none" stroke="#3a4049" />);
  if (ui.showGrid) { const step = Math.max(comp.width, comp.height) / 12; for (let gx = step; gx < comp.width; gx += step) overlays.push(<line key={`gx${gx}`} x1={S({ x: gx, y: 0 }).x} y1={oy} x2={S({ x: gx, y: 0 }).x} y2={oy + comp.height * zoom} stroke="#ffffff22" />); for (let gy = step; gy < comp.height; gy += step) overlays.push(<line key={`gy${gy}`} x1={ox} y1={S({ x: 0, y: gy }).y} x2={ox + comp.width * zoom} y2={S({ x: 0, y: gy }).y} stroke="#ffffff22" />); }
  if (ui.showSafe) for (const [k, f] of [['a', 0.05], ['t', 0.1]] as const) overlays.push(<rect key={`safe${k}`} x={ox + comp.width * f * zoom} y={oy + comp.height * f * zoom} width={comp.width * (1 - 2 * f) * zoom} height={comp.height * (1 - 2 * f) * zoom} fill="none" stroke="#ffffff44" strokeDasharray="4 3" />);
  for (const l of selLayers) {
    if (!activeAt(l, t) && l.type !== 'camera') continue;
    const corners = layerCorners(project, comp, l, t);
    if (corners) {
      const sc = corners.map(S);
      overlays.push(<polygon key={`b${l.id}`} points={sc.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={l.label} strokeWidth={1.2} />);
      if (single && !l.threeD && (tool === 'select' || tool === 'rotate')) {
        const mids = [sc[0], mid(sc[0], sc[1]), sc[1], mid(sc[1], sc[2]), sc[2], mid(sc[2], sc[3]), sc[3], mid(sc[3], sc[0])];
        mids.forEach((p, i) => overlays.push(<rect key={`h${l.id}${i}`} data-h="scale" data-layer={l.id} data-idx={i} x={p.x - 4} y={p.y - 4} width={8} height={8} fill="#1b1e22" stroke={l.label} style={{ cursor: i % 4 === 0 ? 'nwse-resize' : i % 4 === 2 ? 'nesw-resize' : i % 4 === 1 ? 'ns-resize' : 'ew-resize' }} />));
        const top = mid(sc[0], sc[1]); const cen = mid(sc[0], sc[2]); const dir = norm({ x: top.x - cen.x, y: top.y - cen.y });
        const rp = { x: top.x + dir.x * 24, y: top.y + dir.y * 24 };
        overlays.push(<line key={`rl${l.id}`} x1={top.x} y1={top.y} x2={rp.x} y2={rp.y} stroke={l.label} />);
        overlays.push(<circle key={`r${l.id}`} data-h="rotate" data-layer={l.id} cx={rp.x} cy={rp.y} r={5} fill="#1b1e22" stroke={l.label} style={{ cursor: 'grab' }} />);
      }
    }
    // anchor point
    if (!l.threeD) {
      const a = valueAt(l.transform.anchor, t); const ap = S(layerToComp(comp, l, t, a[0], a[1]));
      overlays.push(<g key={`a${l.id}`} data-h="anchor" data-layer={l.id} style={{ cursor: 'move' }}><circle cx={ap.x} cy={ap.y} r={6} fill="none" stroke="#fff" strokeWidth={1.2} /><line x1={ap.x - 9} y1={ap.y} x2={ap.x + 9} y2={ap.y} stroke="#fff" /><line x1={ap.x} y1={ap.y - 9} x2={ap.x} y2={ap.y + 9} stroke="#fff" /></g>);
    }
    // motion path
    const pos = l.transform.position;
    if (ui.showPaths && pos.k.length > 1 && !l.threeD) {
      const pts: string[] = [];
      const t0 = pos.k[0].t, t1 = pos.k[pos.k.length - 1].t; const n = Math.min(400, Math.max(20, Math.round((t1 - t0) * comp.fps)));
      for (let i = 0; i <= n; i++) { const tt = t0 + ((t1 - t0) * i) / n; const v = valueAt(pos, tt); const sp = S(parentToComp(comp, l, t, v)); pts.push(`${sp.x},${sp.y}`); }
      overlays.push(<polyline key={`mp${l.id}`} points={pts.join(' ')} fill="none" stroke="#e8b04c" strokeWidth={1} strokeDasharray="3 3" />);
      // frame dots
      for (let f = Math.ceil(t0 * comp.fps); f <= t1 * comp.fps && f - t0 * comp.fps < 600; f++) { const v = valueAt(pos, f / comp.fps); const sp = S(parentToComp(comp, l, t, v)); overlays.push(<circle key={`fd${l.id}${f}`} cx={sp.x} cy={sp.y} r={1.2} fill="#e8b04c" />); }
      for (const k of pos.k) {
        const kp = S(parentToComp(comp, l, t, k.v as Vec3));
        if (single) for (const which of ['si', 'so'] as const) {
          const tv = k[which] ?? [0, 0];
          const hp = S(parentToComp(comp, l, t, [(k.v as Vec3)[0] + tv[0], (k.v as Vec3)[1] + tv[1], 0]));
          if (tv[0] || tv[1]) overlays.push(<line key={`tl${k.id}${which}`} x1={kp.x} y1={kp.y} x2={hp.x} y2={hp.y} stroke="#e8b04c88" />);
          overlays.push(<circle key={`t${k.id}${which}`} data-h="tangent" data-layer={l.id} data-key={k.id} data-which={which} cx={tv[0] || tv[1] ? hp.x : kp.x + (which === 'so' ? 10 : -10)} cy={tv[0] || tv[1] ? hp.y : kp.y} r={3.5} fill="#e8b04c" stroke="#1b1e22" style={{ cursor: 'crosshair', opacity: tv[0] || tv[1] ? 1 : 0.45 }} />);
        }
        overlays.push(<rect key={`pk${k.id}`} data-h="pathKey" data-layer={l.id} data-key={k.id} x={kp.x - 4} y={kp.y - 4} width={8} height={8} fill="#e8b04c" stroke="#1b1e22" style={{ cursor: 'move' }} />);
      }
    }
    // masks
    for (const m of l.masks) {
      const path = valueAt(m.path, t);
      const toS = (x: number, y: number) => S(layerToComp(comp, l, t, x, y));
      const d = svgPath(path, toS);
      overlays.push(<path key={`m${m.id}`} d={d} fill="none" stroke="#f2c94c" strokeWidth={1.2} />);
      if (single) path.points.forEach((v, i) => {
        const vp = toS(v.x, v.y);
        if (v.ox || v.oy) { const hp = toS(v.x + v.ox, v.y + v.oy); overlays.push(<line key={`mol${m.id}${i}`} x1={vp.x} y1={vp.y} x2={hp.x} y2={hp.y} stroke="#f2c94c88" />, <circle key={`mo${m.id}${i}`} data-h="mask" data-layer={l.id} data-mask={m.id} data-idx={i} data-part="o" cx={hp.x} cy={hp.y} r={3} fill="#f2c94c" />); }
        if (v.ix || v.iy) { const hp = toS(v.x + v.ix, v.y + v.iy); overlays.push(<line key={`mil${m.id}${i}`} x1={vp.x} y1={vp.y} x2={hp.x} y2={hp.y} stroke="#f2c94c88" />, <circle key={`mi${m.id}${i}`} data-h="mask" data-layer={l.id} data-mask={m.id} data-idx={i} data-part="i" cx={hp.x} cy={hp.y} r={3} fill="#f2c94c" />); }
        overlays.push(<rect key={`mv${m.id}${i}`} data-h="mask" data-layer={l.id} data-mask={m.id} data-idx={i} data-part="p" x={vp.x - 3.5} y={vp.y - 3.5} width={7} height={7} fill="#1b1e22" stroke="#f2c94c" style={{ cursor: 'move' }} />);
      });
    }
  }
  // null objects & cameras are invisible in renders but visible here
  for (const l of comp.layers) {
    if (!l.visible || !activeAt(l, t) || l.type !== 'null') continue;
    const c = layerCorners(project, comp, l, t); if (!c) continue;
    overlays.push(<polygon key={`null${l.id}`} points={c.map(S).map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={l.label} strokeDasharray="4 3" />);
  }
  if (drag?.kind === 'draw') {
    const a = S(drag.a), b = S(drag.b);
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    overlays.push(drag.shape === 'ellipse' ? <ellipse key="draw" cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill="#4f8cff22" stroke="#4f8cff" /> : <rect key="draw" x={x} y={y} width={w} height={h} fill="#4f8cff22" stroke="#4f8cff" />);
  }
  if (pen) {
    const pts = pen.pts.map((v) => ({ ...v, ...penToComp(v, pen.layerId) }));
    const target = pen.layerId ? comp.layers.find((x) => x.id === pen.layerId) : null;
    const toS = (x: number, y: number) => S(target ? layerToComp(comp, target, t, x, y) : { x, y });
    overlays.push(<path key="pen" d={svgPath({ points: pen.pts, closed: false }, toS)} fill="none" stroke="#4f8cff" strokeWidth={1.5} />);
    pts.forEach((v, i) => { const s = S(v); overlays.push(<rect key={`pv${i}`} x={s.x - 3.5} y={s.y - 3.5} width={7} height={7} fill={i === 0 ? '#4f8cff' : '#1b1e22'} stroke="#4f8cff" />); });
  }

  const cursor = tool === 'hand' ? (drag?.kind === 'pan' ? 'grabbing' : 'grab') : tool === 'zoom' ? 'zoom-in' : tool === 'text' ? 'text' : tool === 'select' || tool === 'anchor' ? 'default' : 'crosshair';
  const textLayer = textEdit ? comp.layers.find((l) => l.id === textEdit.id) : null;

  return (
    <div className="h-full flex flex-col min-h-0">
      <CompTabs />
      <div ref={box} className="relative flex-1 min-h-0 overflow-hidden bg-[#141619]" style={{ cursor }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onDoubleClick={(e) => {
          const r = box.current!.getBoundingClientRect(); const p = toComp(e.clientX - r.left, e.clientY - r.top);
          if (tool === 'pen') { finishPen(false); return; }
          const hit = hitLayer(p);
          if (hit?.type === 'text') { A.selectLayers([hit.id]); setTextEdit({ id: hit.id, x: e.clientX - r.left, y: e.clientY - r.top }); }
          else if (hit?.type === 'precomp') A.openComp(hit.compId);
        }}
        onWheel={(e) => {
          const r = box.current!.getBoundingClientRect();
          if (e.ctrlKey || e.altKey || !view.fit) { if (e.ctrlKey || e.altKey) { zoomAt({ x: e.clientX - r.left, y: e.clientY - r.top }, e.deltaY < 0 ? 1.12 : 1 / 1.12); return; } }
          if (!view.fit) useMotion.setState((s) => ({ view: { ...s.view, panX: s.view.panX - e.deltaX, panY: s.view.panY - e.deltaY } }));
        }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('text/kdm-item') || e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
        onDrop={(e) => {
          e.preventDefault(); e.stopPropagation();
          const id = e.dataTransfer.getData('text/kdm-item');
          const p = useMotion.getState().project;
          if (id) { if (p.assets[id]) A.addAssetLayer(id); else if (p.comps[id]) A.addCompLayer(id); return; }
          const files = [...(e.dataTransfer.files ?? [])]; if (files.length) void A.importFiles(files);
        }}>
        <canvas ref={canvas} className="absolute inset-0 w-full h-full" aria-label="Composition viewer" />
        <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
          <g style={{ pointerEvents: 'auto' }}>{overlays}</g>
        </svg>
        {textEdit && textLayer?.type === 'text' && (
          <div className="absolute z-10 bg-panel border border-accent rounded-[6px] shadow-xl p-1.5 flex flex-col gap-1" style={{ left: Math.min(textEdit.x, size.w - 270), top: Math.min(textEdit.y + 12, size.h - 120) }} onPointerDown={(e) => e.stopPropagation()}>
            <textarea autoFocus dir="auto" className="field !h-auto w-[250px] min-h-[64px] py-1 text-sm" defaultValue={textLayer.text.text === 'Text' ? '' : textLayer.text.text} placeholder="Type your text"
              aria-label="Edit text" onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => A.setLayer(textLayer.id, { text: { ...textLayer.text, text: e.target.value || ' ' }, name: e.target.value.split('\n')[0].slice(0, 32) || 'Text' } as Partial<MLayer>, 'Edit Text', `text-${textLayer.id}`)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) setTextEdit(null); }} />
            <div className="flex items-center gap-1.5"><span className="text-2xs text-faint flex-1">Ctrl+Enter or Esc to finish</span><button type="button" className="btn h-[22px] px-2 text-xs" onClick={() => setTextEdit(null)}>Done</button></div>
          </div>
        )}
        {pen && <div className="absolute left-2 top-2 text-2xs bg-black/60 text-ink px-2 py-1 rounded">Click to add points · drag for curves · click the first point to close · Enter to finish · Esc to cancel</div>}
        <ViewerInfo comp={comp} zoom={zoom} />
      </div>
      <PreviewBar comp={comp} t={t} zoom={zoom} />
    </div>
  );
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const norm = (v: { x: number; y: number }) => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; };
function svgPath(p: MPath, toS: (x: number, y: number) => { x: number; y: number }): string {
  if (!p.points.length) return '';
  const pts = p.points; const s0 = toS(pts[0].x, pts[0].y); let d = `M${s0.x},${s0.y}`;
  const seg = (a: PathVertex, b: PathVertex) => { const c1 = toS(a.x + a.ox, a.y + a.oy), c2 = toS(b.x + b.ix, b.y + b.iy), e = toS(b.x, b.y); d += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${e.x},${e.y}`; };
  for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i]);
  if (p.closed && pts.length > 2) { seg(pts[pts.length - 1], pts[0]); d += 'Z'; }
  return d;
}
/** Position values live in parent space; map them to comp space for drawing. */
function parentToComp(comp: Composition, l: MLayer, t: number, v: Vec3 | number[]): { x: number; y: number } {
  if (!l.parentId) return { x: v[0], y: v[1] };
  const parent = comp.layers.find((x) => x.id === l.parentId); if (!parent) return { x: v[0], y: v[1] };
  const r = apply4(worldMatrix(comp, parent, t), v[0], v[1]); return { x: r[0], y: r[1] };
}
let pattern: CanvasPattern | null = null;
function checkerPattern(x: CanvasRenderingContext2D) {
  if (!pattern) { const c = createCanvas(16, 16); const y = ctx2d(c); y.fillStyle = '#2a2e34'; y.fillRect(0, 0, 16, 16); y.fillStyle = '#353a42'; y.fillRect(0, 0, 8, 8); y.fillRect(8, 8, 8, 8); pattern = x.createPattern(c, 'repeat'); }
  return pattern ?? '#2a2e34';
}

function ViewerInfo({ comp, zoom }: { comp: Composition; zoom: number }) {
  const fps = useMotion((s) => s.measuredFps);
  const playing = useMotion((s) => s.playing);
  return <div className="absolute right-2 top-2 text-2xs text-faint bg-black/40 rounded px-1.5 py-0.5 pointer-events-none num">{comp.width}×{comp.height} · {Math.round(zoom * 100)}%{playing ? ` · ${fps}/${comp.fps} fps` : ''}</div>;
}

function CompTabs() {
  const open = useMotion((s) => s.openComps);
  const active = useMotion((s) => s.activeCompId);
  const comps = useMotion((s) => s.project.comps);
  return (
    <div className="h-[28px] shrink-0 flex items-end gap-px px-1 bg-panel border-b border-line overflow-x-auto" role="tablist" aria-label="Open compositions">
      {open.filter((id) => comps[id]).map((id) => (
        <div key={id} role="tab" aria-selected={id === active} className={`group flex items-center gap-1.5 h-[24px] ps-2.5 pe-1 rounded-t-[4px] cursor-default text-xs shrink-0 ${id === active ? 'bg-[#141619] text-ink-strong' : 'bg-[#22262b] text-muted hover:text-ink'}`}
          onClick={() => A.openComp(id)}>
          <span className="truncate max-w-[180px]" translate="no">{comps[id].name}</span>
          <button type="button" className="w-4 h-4 rounded flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-hover" aria-label={`Close ${comps[id].name}`} onClick={(e) => { e.stopPropagation(); A.closeCompTab(id); }}><LuX size={11} /></button>
        </div>
      ))}
    </div>
  );
}

function PreviewBar({ comp, t, zoom }: { comp: Composition; t: number; zoom: number }) {
  const playing = useMotion((s) => s.playing);
  const loop = useMotion((s) => s.loop);
  const quality = useMotion((s) => s.quality);
  const view = useMotion((s) => s.view);
  const Btn = ({ label, onClick, children, on }: { label: string; onClick: () => void; children: React.ReactNode; on?: boolean }) => (
    <button type="button" className={`icon-btn ${on ? '!text-accent' : ''}`} aria-label={label} data-tip={label} aria-pressed={on} onClick={onClick}>{children}</button>
  );
  return (
    <div className="h-9 shrink-0 flex items-center gap-1 px-2 bg-panel border-t border-line">
      <Btn label="Go to start (Home)" onClick={A.goToStart}><LuSkipBack size={15} /></Btn>
      <Btn label="Previous frame (Page Up)" onClick={() => A.stepFrames(-1)}><LuStepBack size={15} /></Btn>
      <button type="button" className="h-7 w-9 rounded-[5px] bg-accent text-white flex items-center justify-center" aria-label={playing ? 'Pause (Space)' : 'Play (Space)'} data-tip={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={togglePlay}>{playing ? <LuPause size={16} /> : <LuPlay size={16} />}</button>
      <Btn label="Stop" onClick={stop}><LuSquare size={13} /></Btn>
      <Btn label="Next frame (Page Down)" onClick={() => A.stepFrames(1)}><LuStepForward size={15} /></Btn>
      <Btn label="Go to end (End)" onClick={A.goToEnd}><LuSkipForward size={15} /></Btn>
      <Btn label="Loop" on={loop} onClick={() => useMotion.setState({ loop: !loop })}><LuRepeat size={14} /></Btn>
      <span className="num text-xs text-accent ms-2 w-[84px]">{formatTimecode(t, comp.fps)}</span>
      <div className="flex-1" />
      <label className="flex items-center gap-1.5 text-xs text-muted">Quality
        <select className="field h-[22px] text-xs" value={String(quality)} aria-label="Preview quality" onChange={(e) => useMotion.setState({ quality: Number(e.target.value) as 1 | 0.5 | 0.25 })}>
          <option value="1">Full</option><option value="0.5">Half</option><option value="0.25">Quarter</option>
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted">Zoom
        <select className="field h-[22px] text-xs" value={view.fit ? 'fit' : String(Math.round(view.zoom * 100))} aria-label="Viewer zoom"
          onChange={(e) => useMotion.setState((s) => ({ view: e.target.value === 'fit' ? { ...s.view, fit: true, panX: 0, panY: 0 } : { ...s.view, fit: false, zoom: Number(e.target.value) / 100, panX: 0, panY: 0 } }))}>
          <option value="fit">Fit ({Math.round(zoom * 100)}%)</option>{[25, 33, 50, 100, 200, 400].map((z) => <option key={z} value={z}>{z}%</option>)}
          {!view.fit && ![25, 33, 50, 100, 200, 400].includes(Math.round(view.zoom * 100)) && <option value={Math.round(view.zoom * 100)}>{Math.round(view.zoom * 100)}%</option>}
        </select>
      </label>
      <span className="text-2xs text-faint num ms-1">{comp.fps} fps</span>
    </div>
  );
}

function EmptyViewer() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-6 bg-[#141619]">
      <div className="text-ink-strong text-lg font-semibold">MOTION</div>
      <div className="text-muted max-w-[420px]">Create a composition, or import video, images or audio to start animating. You can also drop files anywhere here.</div>
      <div className="flex gap-2 flex-wrap justify-center">
        <button type="button" className="btn btn-primary" onClick={() => useMotionUI.setState({ dialog: { type: 'comp-settings', compId: null } })}>New Composition</button>
        <button type="button" className="btn" onClick={() => void import('../commands').then((m) => m.importDialog())}>Import File…</button>
        <button type="button" className="btn" onClick={() => void import('../commands').then((m) => m.openProjectDialog())}>Open Project…</button>
        <button type="button" className="btn" onClick={() => void import('../project').then((m) => m.restoreLast())}>Restore Last Session</button>
      </div>
    </div>
  );
}
export { contentBounds, pathToPath2D, setAt };
