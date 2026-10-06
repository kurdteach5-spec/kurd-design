import type { DocState, EditorDocument, Layer, ViewState } from '../types/document';
import { useDocuments, getDoc, setView, currentState } from '../state/documentStore';
import { useUI, useCursor } from '../state/uiStore';
import { useTools } from '../state/toolStore';
import { Compositor, toGrayscale } from './compositor';
import { checker, createCanvas, ctx2d } from '../utils/canvas';
import { apply, clamp, invert, multiply, rotateM, scaleM, translate, type Matrix, type Point } from '../utils/math';
import { selectionOutline } from './selection';
import { maskPreview } from './effects';
import { findLayer } from '../layers/tree';
import type { Tool, ToolPointerEvent } from '../tools/types';

export const ZOOM_STEPS = [0.01, 0.02, 0.03, 0.05, 0.0667, 0.0833, 0.125, 0.1667, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 5, 6, 8, 12, 16, 24, 32, 64];
export const MIN_ZOOM = 0.01, MAX_ZOOM = 64;

type ToolResolver = (id: string) => Tool;
let resolveTool: ToolResolver = () => { throw new Error('tools not registered'); };
export function registerToolResolver(r: ToolResolver) { resolveTool = r; }

let current: Engine | null = null;
export const getEngine = () => current;

/** Subscribe to engine redraws, surviving engine re-creation (mount order independent). */
const globalListeners = new Set<() => void>();
export function subscribeEngine(fn: () => void): () => void {
  globalListeners.add(fn);
  return () => { globalListeners.delete(fn); };
}

/**
 * Renders the active document into the viewport and dispatches pointer input to tools.
 * React never re-renders for canvas changes; the engine subscribes to the stores directly.
 */
export class Engine {
  readonly view: HTMLCanvasElement;
  rulerTop: HTMLCanvasElement | null = null;
  rulerLeft: HTMLCanvasElement | null = null;
  readonly composite = createCanvas(1, 1);
  readonly compositor = new Compositor();
  /** Live layer replacements used by tools during an interaction. */
  overrides = new Map<string, Layer>();
  live = new Set<string>();
  hidden = new Set<string>();
  /** When set, the viewport shows this layer's mask in grayscale. */
  showMaskOf: string | null = null;
  width = 0; height = 0; dpr = 1;
  hover: Point | null = null;
  hoverScreen: Point | null = null;
  private compositeDirty = true;
  private fullQualityNext = false;
  /** Region needing recomposite; null = whole document. */
  private dirtyRect: { x: number; y: number; w: number; h: number } | null = null;
  private viewDirty = true;
  private raf = 0;
  private antsOffset = 0;
  private lastAnts = 0;
  private unsub: (() => void)[] = [];
  private lastDoc: EditorDocument | null = null;
  private lastState: DocState | null = null;
  pointerDown = false;
  private activeTool: Tool | null = null;
  private lastEvent: ToolPointerEvent | null = null;
  spaceHeld = false;
  private panStart: { x: number; y: number; panX: number; panY: number } | null = null;
  onCursorChange: ((c: string) => void) | null = null;
  /** Floating text editor and other DOM overlays position themselves from this. */
  listeners = new Set<() => void>();

  constructor(view: HTMLCanvasElement) {
    this.view = view;
    current = this;
    queueMicrotask(() => globalListeners.forEach((l) => l()));
    let refineTimer = 0;
    this.compositor.onRefine = () => { clearTimeout(refineTimer); refineTimer = window.setTimeout(() => { this.fullQualityNext = true; this.invalidate(); }, 320); };
    this.unsub.push(useDocuments.subscribe((s) => {
      const d = s.activeId ? s.docs[s.activeId] : null;
      if (d !== this.lastDoc) {
        const st = d ? currentState(d) : null;
        if (!this.lastDoc || !d || d.id !== this.lastDoc.id) { this.resetTransient(); if (d && d.view.zoom === 0) requestAnimationFrame(() => this.fit()); }
        if (st !== this.lastState) this.compositeDirty = true;
        this.viewDirty = true;
        this.lastDoc = d; this.lastState = st;
        this.schedule();
      }
    }));
    this.unsub.push(useUI.subscribe((s, p) => {
      if (s.showGrid !== p.showGrid || s.showGuides !== p.showGuides || s.showPixelGrid !== p.showPixelGrid || s.showRulers !== p.showRulers || s.gridSize !== p.gridSize || s.gridColor !== p.gridColor || s.showSelectionEdges !== p.showSelectionEdges) this.invalidateView();
    }));
    this.unsub.push(useTools.subscribe((s, p) => {
      if (s.tool !== p.tool) this.switchTool(s.tool);
      if (s.options !== p.options) this.invalidateView();
    }));
    this.lastDoc = getDoc(); this.lastState = this.lastDoc ? currentState(this.lastDoc) : null;
    this.switchTool(useTools.getState().tool);
    this.schedule();
  }

  destroy() {
    this.activeTool?.deactivate?.(this);
    this.unsub.forEach((u) => u()); cancelAnimationFrame(this.raf);
    if (current === this) current = null;
  }

  // ---------- document access ----------
  get doc(): EditorDocument | null { return this.lastDoc; }
  get state(): DocState | null { return this.lastState; }
  get viewState(): ViewState { return this.lastDoc?.view ?? { zoom: 1, panX: 0, panY: 0, rotation: 0 }; }
  get zoom() { return this.viewState.zoom || 1; }
  get tool() { return this.activeTool; }

  resetTransient() { this.overrides.clear(); this.live.clear(); this.hidden.clear(); this.showMaskOf = null; this.compositeDirty = true; }

  private switchTool(id: string) {
    if (this.activeTool?.id === id) return;
    this.activeTool?.deactivate?.(this);
    this.activeTool = resolveTool(id);
    this.activeTool.activate?.(this);
    this.updateCursor();
    this.invalidateView();
  }

  // ---------- invalidation ----------
  invalidate() { this.compositeDirty = true; this.dirtyRect = null; this.viewDirty = true; this.schedule(); }
  /** Recomposite only part of the document (cheap updates while painting). */
  invalidateRect(r: { x: number; y: number; w: number; h: number }) {
    if (this.compositeDirty && !this.dirtyRect) { this.viewDirty = true; this.schedule(); return; }
    const d = this.dirtyRect;
    const x0 = Math.floor(Math.min(r.x, d ? d.x : Infinity)), y0 = Math.floor(Math.min(r.y, d ? d.y : Infinity));
    const x1 = Math.ceil(Math.max(r.x + r.w, d ? d.x + d.w : -Infinity)), y1 = Math.ceil(Math.max(r.y + r.h, d ? d.y + d.h : -Infinity));
    this.dirtyRect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    this.compositeDirty = true; this.viewDirty = true; this.schedule();
  }
  invalidateView() { this.viewDirty = true; this.schedule(); }
  schedule() { if (!this.raf) this.raf = requestAnimationFrame(this.frame); }
  emit() { this.listeners.forEach((l) => l()); globalListeners.forEach((l) => l()); }

  setOverride(layer: Layer, live = true, rect?: { x: number; y: number; w: number; h: number } | null) {
    const had = this.overrides.has(layer.id);
    this.overrides.set(layer.id, layer); if (live) this.live.add(layer.id);
    if (rect && had && this.compositeFullDone) this.invalidateRect(rect); else this.invalidate();
  }
  /** Downscaled copy of the composite for fast drawing when zoomed out. */
  private mip: { canvas: HTMLCanvasElement; scale: number; valid: boolean } | null = null;
  /** True once the composite reflects the current overrides at least once in full. */
  private compositeFullDone = false;
  clearOverride(id?: string) { if (id) { this.overrides.delete(id); this.live.delete(id); } else { this.overrides.clear(); this.live.clear(); } this.invalidate(); }

  // ---------- geometry ----------
  resize(w: number, h: number) {
    const dpr = window.devicePixelRatio || 1;
    if (w === this.width && h === this.height && dpr === this.dpr) return;
    this.width = w; this.height = h; this.dpr = dpr;
    this.view.width = Math.round(w * dpr); this.view.height = Math.round(h * dpr);
    this.view.style.width = `${w}px`; this.view.style.height = `${h}px`;
    this.sizeRulers();
    this.invalidateView();
    this.emit();
  }
  sizeRulers() {
    const dpr = this.dpr;
    if (this.rulerTop) { const r = this.rulerTop.getBoundingClientRect(); this.rulerTop.width = Math.max(1, Math.round(r.width * dpr)); this.rulerTop.height = Math.max(1, Math.round(r.height * dpr)); }
    if (this.rulerLeft) { const r = this.rulerLeft.getBoundingClientRect(); this.rulerLeft.width = Math.max(1, Math.round(r.width * dpr)); this.rulerLeft.height = Math.max(1, Math.round(r.height * dpr)); }
  }

  /** doc → screen (CSS pixels) matrix. */
  viewMatrix(v: ViewState = this.viewState, st: DocState | null = this.state): Matrix {
    const W = st?.width ?? 0, H = st?.height ?? 0;
    const z = v.zoom || 1;
    return multiply(translate(this.width / 2 + v.panX, this.height / 2 + v.panY), multiply(rotateM((v.rotation * Math.PI) / 180), multiply(scaleM(z, z), translate(-W / 2, -H / 2))));
  }
  docToScreen(p: Point): Point { return apply(this.viewMatrix(), p); }
  screenToDoc(p: Point): Point { return apply(invert(this.viewMatrix()), p); }
  clientToScreen(cx: number, cy: number): Point { const r = this.view.getBoundingClientRect(); return { x: cx - r.left, y: cy - r.top }; }

  // ---------- view commands ----------
  setView(v: Partial<ViewState>) { setView(v); }
  fit(padding = 40) {
    const st = this.state; if (!st || !this.width) return;
    const z = Math.min((this.width - padding * 2) / st.width, (this.height - padding * 2) / st.height);
    setView({ zoom: clamp(z, MIN_ZOOM, MAX_ZOOM), panX: 0, panY: 0 });
  }
  fillScreen() {
    const st = this.state; if (!st || !this.width) return;
    setView({ zoom: clamp(Math.max(this.width / st.width, this.height / st.height), MIN_ZOOM, MAX_ZOOM), panX: 0, panY: 0 });
  }
  actualPixels() { setView({ zoom: 1 }); }
  center() { setView({ panX: 0, panY: 0 }); }
  /** Zoom keeping a screen point fixed. */
  zoomAt(z: number, anchor?: Point) {
    z = clamp(z, MIN_ZOOM, MAX_ZOOM);
    const v = this.viewState;
    const a = anchor ?? { x: this.width / 2, y: this.height / 2 };
    const docPt = this.screenToDoc(a);
    const nv = { ...v, zoom: z };
    const after = apply(this.viewMatrix(nv), docPt);
    setView({ zoom: z, panX: v.panX + (a.x - after.x), panY: v.panY + (a.y - after.y) });
  }
  zoomStep(dir: 1 | -1, anchor?: Point) {
    const z = this.zoom;
    const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z * 1.001) ?? MAX_ZOOM : [...ZOOM_STEPS].reverse().find((s) => s < z / 1.001) ?? MIN_ZOOM;
    this.zoomAt(next, anchor);
  }
  rotateView(deg: number, absolute = false) {
    const r = absolute ? deg : this.viewState.rotation + deg;
    setView({ rotation: ((r % 360) + 540) % 360 - 180 });
  }

  // ---------- input ----------
  makeEvent(e: PointerEvent | MouseEvent): ToolPointerEvent {
    const screen = this.clientToScreen(e.clientX, e.clientY);
    const pe = e as PointerEvent;
    return {
      doc: this.screenToDoc(screen), screen, button: e.button, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey,
      pressure: pe.pointerType === 'pen' ? (pe.pressure || 0.5) : 1, pointerType: pe.pointerType || 'mouse', native: pe,
    };
  }

  handleDown(e: PointerEvent) {
    if (!this.state) return;
    const ev = this.makeEvent(e);
    this.lastEvent = ev;
    if (e.button === 1 || this.spaceHeld || (this.activeTool?.id === 'hand')) {
      this.panStart = { x: ev.screen.x, y: ev.screen.y, panX: this.viewState.panX, panY: this.viewState.panY };
      this.pointerDown = true; this.updateCursor(); return;
    }
    if (e.button !== 0) return;
    this.pointerDown = true;
    try { this.activeTool?.onDown?.(ev, this); } catch (err) { this.reportError(err); }
    this.updateCursor();
    this.invalidateView();
  }
  handleMove(e: PointerEvent) {
    const ev = this.makeEvent(e);
    this.lastEvent = ev;
    this.hover = ev.doc; this.hoverScreen = ev.screen;
    if (this.state) {
      const inside = ev.doc.x >= 0 && ev.doc.y >= 0 && ev.doc.x < this.state.width && ev.doc.y < this.state.height;
      useCursor.setState({ x: Math.floor(ev.doc.x), y: Math.floor(ev.doc.y), color: inside ? null : null });
    }
    if (this.panStart) {
      setView({ panX: this.panStart.panX + ev.screen.x - this.panStart.x, panY: this.panStart.panY + ev.screen.y - this.panStart.y });
      return;
    }
    // coalesced events give smoother strokes
    if (this.pointerDown && typeof e.getCoalescedEvents === 'function' && this.activeTool?.onMove) {
      const list = e.getCoalescedEvents();
      if (list.length > 1) {
        try { for (const ce of list) this.activeTool.onMove(this.makeEvent(ce), this, true); } catch (err) { this.reportError(err); }
        this.invalidateView(); this.drawRulers(); return;
      }
    }
    try { this.activeTool?.onMove?.(ev, this, this.pointerDown); } catch (err) { this.reportError(err); }
    if (this.pointerDown || this.activeTool?.hoverOverlay) this.invalidateView();
    else this.drawRulers();
    this.updateCursor();
  }
  handleUp(e: PointerEvent) {
    const ev = this.makeEvent(e);
    if (this.panStart) { this.panStart = null; this.pointerDown = false; this.updateCursor(); return; }
    if (!this.pointerDown) return;
    this.pointerDown = false;
    try { this.activeTool?.onUp?.(ev, this); } catch (err) { this.reportError(err); }
    this.updateCursor();
    this.invalidateView();
  }
  handleLeave() { this.hover = null; this.hoverScreen = null; useCursor.setState({ x: null, y: null }); this.invalidateView(); }
  handleDoubleClick(e: MouseEvent) { try { this.activeTool?.onDoubleClick?.(this.makeEvent(e), this); } catch (err) { this.reportError(err); } }
  handleWheel(e: WheelEvent) {
    e.preventDefault();
    const screen = this.clientToScreen(e.clientX, e.clientY);
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.height : 1;
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const factor = Math.exp(-e.deltaY * scale * (e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 30 ? 0.01 : 0.0025));
      this.zoomAt(this.zoom * factor, screen);
    } else {
      const v = this.viewState;
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX, dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
      setView({ panX: v.panX - dx * scale, panY: v.panY - dy * scale });
    }
  }
  updateCursor() {
    let c = 'default';
    if (this.panStart) c = 'grabbing';
    else if (this.spaceHeld) c = 'grab';
    else if (this.activeTool) c = this.activeTool.cursor(this, this.lastEvent);
    this.onCursorChange?.(c);
  }
  reportError(err: unknown) {
    console.error(err);
    import('../state/uiStore').then((m) => m.toastError(err instanceof Error ? err.message : 'The tool encountered an error.'));
    this.pointerDown = false;
  }

  // ---------- rendering ----------
  private frame = (t: number) => {
    this.raf = 0;
    const st = this.state;
    if (this.compositeDirty && st) {
      this.compositeDirty = false;
      const clip = this.dirtyRect && this.composite.width === st.width && this.composite.height === st.height ? this.dirtyRect : undefined;
      this.dirtyRect = null;
      try {
        const fullQuality = this.fullQualityNext; this.fullQualityNext = false;
        this.compositor.render(st, this.composite, { overrides: this.overrides, live: this.live, hidden: this.hidden, clip, fullQuality });
        if (st.colorMode === 'grayscale') toGrayscale(this.composite);
        this.compositeFullDone = true;
        this.updateMip(clip ?? null);
      } catch (err) { console.error('Render failed', err); }
      this.viewDirty = true;
    }
    if (st?.selection && useUI.getState().showSelectionEdges) {
      if (t - this.lastAnts > 90) { this.antsOffset = (this.antsOffset + 1) % 16; this.lastAnts = t; this.viewDirty = true; }
      this.schedule();
    }
    if (this.viewDirty) { this.viewDirty = false; this.draw(); this.emit(); }
  };

  private mipScaleFor(z: number) {
    const target = z * this.dpr;
    let s = 1; while (s / 2 >= target && s > 1 / 32) s /= 2;
    return s;
  }
  /** Keeps the downscaled view copy in sync (only the changed region when possible). */
  private updateMip(clip: { x: number; y: number; w: number; h: number } | null) {
    const st = this.state; if (!st) return;
    const s = this.mipScaleFor(this.zoom);
    if (s >= 1) { this.mip = null; return; }
    const w = Math.max(1, Math.ceil(st.width * s)), h = Math.max(1, Math.ceil(st.height * s));
    if (!this.mip || this.mip.scale !== s || this.mip.canvas.width !== w || this.mip.canvas.height !== h) { this.mip = { canvas: createCanvas(w, h), scale: s, valid: false }; clip = null; }
    const x = ctx2d(this.mip.canvas); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    if (!clip || !this.mip.valid) {
      x.clearRect(0, 0, w, h); x.drawImage(this.composite, 0, 0, w, h); this.mip.valid = true; return;
    }
    const x0 = Math.max(0, Math.floor(clip.x * s) - 1), y0 = Math.max(0, Math.floor(clip.y * s) - 1);
    const x1 = Math.min(w, Math.ceil((clip.x + clip.w) * s) + 1), y1 = Math.min(h, Math.ceil((clip.y + clip.h) * s) + 1);
    if (x1 <= x0 || y1 <= y0) return;
    x.clearRect(x0, y0, x1 - x0, y1 - y0);
    x.drawImage(this.composite, x0 / s, y0 / s, (x1 - x0) / s, (y1 - y0) / s, x0, y0, x1 - x0, y1 - y0);
  }

  private draw() {
    const x = ctx2d(this.view);
    const dpr = this.dpr;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, this.view.width, this.view.height);
    const st = this.state;
    if (!st) return;
    const vm = this.viewMatrix();
    const z = this.zoom;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    // soft edge + checkerboard behind the document (cheap: no blur, so it stays fast on large zooms)
    const quad = [{ x: 0, y: 0 }, { x: st.width, y: 0 }, { x: st.width, y: st.height }, { x: 0, y: st.height }].map((p) => apply(vm, p));
    x.save();
    x.lineJoin = 'round';
    for (const [w, a] of [[10, 0.08], [6, 0.12], [3, 0.2]] as const) {
      x.strokeStyle = `rgba(0,0,0,${a})`; x.lineWidth = w;
      x.beginPath(); quad.forEach((p, i) => (i ? x.lineTo(p.x, p.y + 2) : x.moveTo(p.x, p.y + 2))); x.closePath(); x.stroke();
    }
    x.restore();
    x.save();
    x.beginPath(); quad.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath();
    x.fillStyle = checker(x); x.fill();
    x.restore();
    // composite
    x.save();
    x.transform(vm.a, vm.b, vm.c, vm.d, vm.e, vm.f);
    x.imageSmoothingEnabled = z < 2;
    x.imageSmoothingQuality = 'high';
    const maskLayer = this.showMaskOf ? findLayer(st.layers, this.showMaskOf) : null;
    if (maskLayer?.mask) x.drawImage(maskPreview(maskLayer.mask, st.width, st.height), 0, 0);
    else {
      const s = this.mipScaleFor(z);
      if (s < 1 && (!this.mip || this.mip.scale !== s || !this.mip.valid)) this.updateMip(null);
      if (s < 1 && this.mip?.valid) x.drawImage(this.mip.canvas, 0, 0, this.mip.canvas.width, this.mip.canvas.height, 0, 0, this.mip.canvas.width / s, this.mip.canvas.height / s);
      else x.drawImage(this.composite, 0, 0);
    }
    x.restore();
    const ui = useUI.getState();
    // pixel grid
    if (ui.showPixelGrid && z >= 8) this.drawPixelGrid(x, vm, st);
    if (ui.showGrid) this.drawGrid(x, vm, st, ui.gridSize, ui.gridColor);
    if (ui.showGuides && st.guides.length) this.drawGuides(x, vm, st);
    if (st.selection && ui.showSelectionEdges) this.drawSelection(x, vm, st);
    try { this.activeTool?.drawOverlay?.(x, this); } catch (err) { console.error(err); }
    this.drawRulers();
  }

  private visibleDocRect(vm: Matrix, st: DocState) {
    const inv = invert(vm);
    const pts = [{ x: 0, y: 0 }, { x: this.width, y: 0 }, { x: 0, y: this.height }, { x: this.width, y: this.height }].map((p) => apply(inv, p));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { x0: Math.max(0, Math.floor(Math.min(...xs))), y0: Math.max(0, Math.floor(Math.min(...ys))), x1: Math.min(st.width, Math.ceil(Math.max(...xs))), y1: Math.min(st.height, Math.ceil(Math.max(...ys))) };
  }

  private drawPixelGrid(x: CanvasRenderingContext2D, vm: Matrix, st: DocState) {
    const r = this.visibleDocRect(vm, st);
    x.save(); x.transform(vm.a, vm.b, vm.c, vm.d, vm.e, vm.f);
    x.lineWidth = 1 / this.zoom; x.strokeStyle = 'rgba(128,128,128,0.35)';
    x.beginPath();
    for (let i = r.x0; i <= r.x1; i++) { x.moveTo(i, r.y0); x.lineTo(i, r.y1); }
    for (let j = r.y0; j <= r.y1; j++) { x.moveTo(r.x0, j); x.lineTo(r.x1, j); }
    x.stroke(); x.restore();
  }

  private drawGrid(x: CanvasRenderingContext2D, vm: Matrix, st: DocState, size: number, color: string) {
    if (size * this.zoom < 4) return;
    x.save(); x.transform(vm.a, vm.b, vm.c, vm.d, vm.e, vm.f);
    x.lineWidth = 1 / this.zoom; x.strokeStyle = color; x.globalAlpha = 0.35;
    x.beginPath();
    for (let i = 0; i <= st.width; i += size) { x.moveTo(i, 0); x.lineTo(i, st.height); }
    for (let j = 0; j <= st.height; j += size) { x.moveTo(0, j); x.lineTo(st.width, j); }
    x.stroke();
    x.globalAlpha = 0.12; x.beginPath();
    const sub = size / 4;
    if (sub * this.zoom > 6) {
      for (let i = 0; i <= st.width; i += sub) { x.moveTo(i, 0); x.lineTo(i, st.height); }
      for (let j = 0; j <= st.height; j += sub) { x.moveTo(0, j); x.lineTo(st.width, j); }
      x.stroke();
    }
    x.restore();
  }

  private drawGuides(x: CanvasRenderingContext2D, vm: Matrix, st: DocState) {
    x.save();
    x.strokeStyle = '#19d3ff'; x.lineWidth = 1;
    const ext = Math.max(st.width, st.height) * 10;
    for (const g of st.guides) {
      const a = apply(vm, g.orientation === 'v' ? { x: g.pos, y: -ext } : { x: -ext, y: g.pos });
      const b = apply(vm, g.orientation === 'v' ? { x: g.pos, y: ext } : { x: ext, y: g.pos });
      x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
    }
    x.restore();
  }

  private drawSelection(x: CanvasRenderingContext2D, vm: Matrix, st: DocState) {
    const sel = st.selection!;
    const path = selectionOutline(sel);
    x.save();
    x.transform(vm.a, vm.b, vm.c, vm.d, vm.e, vm.f);
    x.lineWidth = 1 / this.zoom;
    x.setLineDash([4 / this.zoom, 4 / this.zoom]);
    x.strokeStyle = '#000'; x.lineDashOffset = -this.antsOffset / this.zoom; x.stroke(path);
    x.strokeStyle = '#fff'; x.lineDashOffset = (-this.antsOffset + 4) / this.zoom; x.stroke(path);
    x.restore();
  }

  drawRulers() {
    const st = this.state;
    const show = useUI.getState().showRulers;
    if (!show) return;
    for (const [c, horiz] of [[this.rulerTop, true], [this.rulerLeft, false]] as const) {
      if (!c) continue;
      const x = ctx2d(c); const dpr = this.dpr;
      const W = c.width / dpr, H = c.height / dpr;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.fillStyle = '#1b1d21'; x.fillRect(0, 0, W, H);
      x.strokeStyle = '#3a3e45'; x.beginPath();
      if (horiz) { x.moveTo(0, H - 0.5); x.lineTo(W, H - 0.5); } else { x.moveTo(W - 0.5, 0); x.lineTo(W - 0.5, H); }
      x.stroke();
      if (!st) continue;
      // rulers ignore view rotation (like most editors) and use the doc axis through the origin
      const z = this.zoom; const v = this.viewState;
      const originX = this.width / 2 + v.panX - (st.width / 2) * z;
      const originY = this.height / 2 + v.panY - (st.height / 2) * z;
      const origin = horiz ? originX : originY;
      const len = horiz ? W : H;
      const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
      const step = steps.find((s) => s * z >= 60) ?? 10000;
      const minor = step / (step % 5 === 0 ? 5 : 2);
      x.font = '9px Inter, system-ui, sans-serif'; x.fillStyle = '#8a9099'; x.strokeStyle = '#4a4f57';
      const start = Math.floor(-origin / z / minor) * minor;
      const end = (len - origin) / z;
      x.beginPath();
      for (let d = start; d <= end; d += minor) {
        const p = origin + d * z;
        const major = Math.abs(d / step - Math.round(d / step)) < 1e-6;
        const tick = major ? (horiz ? H : W) : (horiz ? H : W) * 0.3;
        if (horiz) { x.moveTo(Math.round(p) + 0.5, H); x.lineTo(Math.round(p) + 0.5, H - tick); }
        else { x.moveTo(W, Math.round(p) + 0.5); x.lineTo(W - tick, Math.round(p) + 0.5); }
        if (major) {
          const label = String(Math.round(d));
          if (horiz) x.fillText(label, p + 3, 9);
          else { x.save(); x.translate(9, p + 3); x.rotate(-Math.PI / 2); x.fillText(label, -x.measureText(label).width - 2, 0); x.restore(); }
        }
      }
      x.stroke();
      // cursor marker
      if (this.hoverScreen) {
        x.strokeStyle = '#4f8cff'; x.beginPath();
        if (horiz) { x.moveTo(this.hoverScreen.x + 0.5, 0); x.lineTo(this.hoverScreen.x + 0.5, H); }
        else { x.moveTo(0, this.hoverScreen.y + 0.5); x.lineTo(W, this.hoverScreen.y + 0.5); }
        x.stroke();
      }
    }
  }
}

/** Helper for tools: the doc state of the active document (live). */
export const activeState = () => getEngine()?.state ?? null;
