import type { Adjustment, DocState, Layer } from '../types/document';
import { commit, getDocState, undo, redo } from '../state/documentStore';
import { toast, withBusy, openDialog } from '../state/uiStore';
import { useTools } from '../state/toolStore';
import { findLayer, insertLayers, updateLayer, allLayers } from '../layers/tree';
import { cloneLayer, createRasterLayer } from '../layers/factory';
import { getPaintTarget, applySelectionClip } from '../tools/helpers';
import { createCanvas, ctx2d, contentBounds } from '../utils/canvas';
import { renderDocument, sharedCompositor } from '../canvas/compositor';
import { translate } from '../utils/math';
import {
  selectAll as selAll, invertSelection, featherSelection, expandSelection, contractSelection, borderSelection,
} from '../canvas/selection';
import { cropDocument, flipDoc, rotateDoc } from '../layers/docOps';
import { applyAdjustment } from '../adjustments/process';
import { runFilter } from '../filters/runner';
import { filterById } from '../filters/definitions';
import { getClipboard, internalIsFresh, setClipboard, writeSystemClipboard, readSystemClipboardImages } from './clipboard';
import { deleteLayers } from './layerActions';
import { getEngine } from '../canvas/engine';
import { importAsLayers } from './fileActions';
import { useTransform, commitTransform, cancelTransform } from '../tools/transformState';
import { applyDeltaTransform, docBounds } from '../layers/geometry';
import { multiply, scaleAround, rotateAround, type Matrix } from '../utils/math';
import { useTextEdit } from '../tools/textTool';

// ---------------- Undo / redo ----------------
export function doUndo() {
  if (useTransform.getState().session) { cancelTransform(); return; }
  if (useTextEdit.getState().layerId) return; // the text editor handles its own undo
  undo(); getEngine()?.resetTransient();
}
export function doRedo() { redo(); getEngine()?.resetTransient(); }

// ---------------- Selection ----------------
let lastSelection: DocState['selection'] = null;
export function selectAll() { commit((s) => ({ ...s, selection: selAll(s.width, s.height) }), { history: 'Select All' }); }
export function deselect() {
  const s = getDocState(); if (!s?.selection) return;
  lastSelection = s.selection;
  commit((st) => ({ ...st, selection: null }), { history: 'Deselect' });
}
export function reselect() { if (lastSelection) { const sel = lastSelection; commit((s) => ({ ...s, selection: sel }), { history: 'Reselect' }); } }
export function inverseSelection() { commit((s) => ({ ...s, selection: invertSelection(s.selection, s.width, s.height) }), { history: 'Select Inverse' }); }
export function selectAllLayers() { commit((s) => { const ids = allLayers(s.layers).map((l) => l.id); return { ...s, selectedLayerIds: ids }; }); }

export function modifySelection(op: 'feather' | 'expand' | 'contract' | 'border', amount: number) {
  const s = getDocState(); if (!s?.selection) { toast('There is no active selection.', 'warning'); return; }
  const sel = s.selection;
  const next = op === 'feather' ? featherSelection(sel, amount) : op === 'expand' ? expandSelection(sel, amount) : op === 'contract' ? contractSelection(sel, amount, s.width, s.height) : borderSelection(sel, amount, s.width, s.height);
  commit((st) => ({ ...st, selection: next }), { history: { feather: 'Feather', expand: 'Expand', contract: 'Contract', border: 'Border' }[op] });
  if (!next) toast('The selection became empty.', 'info');
}

// ---------------- Clipboard ----------------
function activeLayer(s: DocState) { return findLayer(s.layers, s.activeLayerId); }

export async function copy(merged = false) {
  const s = getDocState(); if (!s) return;
  if (!s.selection && !merged) {
    const ids = s.selectedLayerIds.length ? s.selectedLayerIds : s.activeLayerId ? [s.activeLayerId] : [];
    const layers = ids.map((id) => findLayer(s.layers, id)).filter(Boolean) as Layer[];
    if (!layers.length) return;
    setClipboard({ kind: 'layers', layers, time: Date.now() });
    const img = renderDocument({ ...s, layers });
    toast(layers.length > 1 ? `${layers.length} layers copied` : 'Layer copied', 'success', 1500);
    await writeSystemClipboard(img);
    return;
  }
  const src = merged ? renderDocument(s) : (() => { const l = activeLayer(s); return l ? sharedCompositor.renderLayer(s, { ...l, opacity: 1 } as Layer) : null; })();
  if (!src) return;
  const b = s.selection ? s.selection.bounds : contentBounds(src) ?? { x: 0, y: 0, w: s.width, h: s.height };
  const bx = Math.max(0, Math.floor(b.x)), by = Math.max(0, Math.floor(b.y));
  const bw = Math.min(s.width, Math.ceil(b.x + b.w)) - bx, bh = Math.min(s.height, Math.ceil(b.y + b.h)) - by;
  if (bw <= 0 || bh <= 0) { toast('The selected area is empty.', 'warning'); return; }
  const c = createCanvas(bw, bh); const x = ctx2d(c);
  x.drawImage(src, -bx, -by);
  if (s.selection) { x.globalCompositeOperation = 'destination-in'; x.drawImage(s.selection.mask, -bx, -by); }
  setClipboard({ kind: 'pixels', canvas: c, x: bx, y: by, time: Date.now() });
  toast('Copied', 'success', 1200);
  await writeSystemClipboard(c);
}

export async function cut() {
  const s = getDocState(); if (!s) return;
  await copy();
  if (s.selection) clearSelectionPixels('Cut'); else deleteLayers();
}

export function pasteInternal(inPlace = true): boolean {
  const s = getDocState(); const clip = getClipboard();
  if (!s || !clip) return false;
  if (clip.kind === 'layers') {
    const copies = clip.layers.map((l) => cloneLayer(l, ''));
    commit((st) => ({ ...st, layers: insertLayers(st.layers, copies, st.activeLayerId, 'above'), activeLayerId: copies[copies.length - 1].id, selectedLayerIds: copies.map((c) => c.id) }), { history: 'Paste' });
    return true;
  }
  const fits = clip.x + clip.canvas.width <= s.width && clip.y + clip.canvas.height <= s.height;
  const x = inPlace && fits ? clip.x : Math.round((s.width - clip.canvas.width) / 2);
  const y = inPlace && fits ? clip.y : Math.round((s.height - clip.canvas.height) / 2);
  const layer = createRasterLayer('Pasted Layer', clip.canvas, translate(x, y));
  commit((st) => ({ ...st, layers: insertLayers(st.layers, [layer], st.activeLayerId, 'above'), activeLayerId: layer.id, selectedLayerIds: [layer.id], selection: null, editTarget: 'content' }), { history: 'Paste' });
  return true;
}

/** Paste from the menu: prefers our internal clipboard, else reads images from the system clipboard. */
export async function paste() {
  if (internalIsFresh() && pasteInternal()) return;
  const files = await readSystemClipboardImages();
  if (files.length) { await importAsLayers(files); return; }
  if (!pasteInternal()) toast('The clipboard does not contain an image. Use Ctrl+V to paste from other apps.', 'info');
}

/** Handles the browser 'paste' event (Ctrl+V). */
export async function handlePasteEvent(e: ClipboardEvent) {
  const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
  if (internalIsFresh() || !files.length) { if (pasteInternal()) { e.preventDefault(); return; } }
  if (files.length) { e.preventDefault(); await importAsLayers(files); return; }
  const text = e.clipboardData?.getData('text/plain');
  if (text && /^<svg[\s>]/i.test(text.trim())) { e.preventDefault(); await importAsLayers([new File([text], 'Pasted.svg', { type: 'image/svg+xml' })]); }
}

// ---------------- Pixel edits ----------------
export function clearSelectionPixels(label = 'Clear') {
  const s = getDocState(); if (!s) return;
  if (!s.selection) { deleteLayers(); return; }
  const t = getPaintTarget(s); if (!t) return;
  const x = ctx2d(t.canvas);
  if (t.kind === 'mask') {
    const fill = createCanvas(s.width, s.height); const fx = ctx2d(fill); fx.fillStyle = '#000'; fx.fillRect(0, 0, s.width, s.height); fx.globalCompositeOperation = 'destination-in'; fx.drawImage(s.selection.mask, 0, 0);
    x.drawImage(fill, -t.ox, -t.oy);
  } else { x.globalCompositeOperation = 'destination-out'; x.drawImage(s.selection.mask, -t.ox, -t.oy); }
  t.commit(label);
}

export function fillSelection(which: 'foreground' | 'background' | 'black' | 'white' | 'gray' = 'foreground') {
  const s = getDocState(); if (!s) return;
  const t = getPaintTarget(s); if (!t) return;
  const ts = useTools.getState();
  const color = which === 'foreground' ? ts.foreground : which === 'background' ? ts.background : which === 'black' ? '#000000' : which === 'white' ? '#ffffff' : '#808080';
  const fill = createCanvas(t.canvas.width, t.canvas.height); const fx = ctx2d(fill);
  fx.fillStyle = t.color(color); fx.fillRect(0, 0, fill.width, fill.height);
  applySelectionClip(fx, s, t.ox, t.oy);
  ctx2d(t.canvas).drawImage(fill, 0, 0);
  t.commit('Fill');
}

export function strokeSelection(width = 4) {
  const s = getDocState(); if (!s?.selection) { toast('Make a selection first.', 'warning'); return; }
  const t = getPaintTarget(s); if (!t) return;
  const ring = borderSelection(s.selection, width, s.width, s.height); if (!ring) return;
  const fill = createCanvas(s.width, s.height); const fx = ctx2d(fill); fx.fillStyle = t.color(useTools.getState().foreground); fx.fillRect(0, 0, s.width, s.height);
  fx.globalCompositeOperation = 'destination-in'; fx.drawImage(ring.mask, 0, 0);
  ctx2d(t.canvas).drawImage(fill, -t.ox, -t.oy);
  t.commit('Stroke');
}

/** Layer via copy/cut (Ctrl+J / Ctrl+Shift+J). */
export function layerViaCopy(cutPixels = false) {
  const s = getDocState(); if (!s) return;
  const l = activeLayer(s);
  if (!s.selection || !l) { import('./layerActions').then((m) => m.duplicateLayers()); return; }
  const px = sharedCompositor.renderLayer(s, { ...l, opacity: 1, blendMode: 'normal' } as Layer);
  const x = ctx2d(px); x.globalCompositeOperation = 'destination-in'; x.drawImage(s.selection.mask, 0, 0);
  const b = contentBounds(px, false);
  if (!b) { toast('The selected area is empty.', 'warning'); return; }
  const c = createCanvas(b.w, b.h); ctx2d(c).drawImage(px, -b.x, -b.y);
  const layer = createRasterLayer(cutPixels ? 'Layer via Cut' : 'Layer via Copy', c, translate(b.x, b.y));
  if (cutPixels && l.type === 'raster') {
    const t = getPaintTarget(s); if (!t) return;
    const tx = ctx2d(t.canvas); tx.globalCompositeOperation = 'destination-out'; tx.drawImage(s.selection.mask, -t.ox, -t.oy);
    const canvas = t.canvas, ox = t.ox, oy = t.oy;
    commit((st) => ({ ...st, layers: insertLayers(updateLayer(st.layers, l.id, (q) => ({ ...q, canvas, transform: translate(ox, oy) } as Layer)), [layer], l.id, 'above'), activeLayerId: layer.id, selectedLayerIds: [layer.id], selection: null }), { history: 'Layer via Cut' });
    return;
  }
  commit((st) => ({ ...st, layers: insertLayers(st.layers, [layer], l.id, 'above'), activeLayerId: layer.id, selectedLayerIds: [layer.id], selection: null }), { history: 'Layer via Copy' });
}

// ---------------- Transform shortcuts ----------------
export function transformLayers(kind: 'flipH' | 'flipV' | 'rot90' | 'rot-90' | 'rot180') {
  const session = useTransform.getState().session;
  const s = getDocState(); if (!s) return;
  const ids = s.selectedLayerIds.length ? s.selectedLayerIds : s.activeLayerId ? [s.activeLayerId] : [];
  const layers = ids.map((id) => findLayer(s.layers, id)).filter((l): l is Layer => !!l && !l.locked && l.type !== 'adjustment');
  if (!layers.length) { toast('Select an unlocked layer to transform.', 'warning'); return; }
  const b = layers.reduce<{ x: number; y: number; r: number; b: number } | null>((acc, l) => { const r = docBounds(l); if (!r) return acc; return acc ? { x: Math.min(acc.x, r.x), y: Math.min(acc.y, r.y), r: Math.max(acc.r, r.x + r.w), b: Math.max(acc.b, r.y + r.h) } : { x: r.x, y: r.y, r: r.x + r.w, b: r.y + r.h }; }, null);
  if (!b) return;
  const c = session ? session.center() : { x: (b.x + b.r) / 2, y: (b.y + b.b) / 2 };
  const m: Matrix = kind === 'flipH' ? scaleAround(-1, 1, c) : kind === 'flipV' ? scaleAround(1, -1, c) : rotateAround(kind === 'rot90' ? Math.PI / 2 : kind === 'rot-90' ? -Math.PI / 2 : Math.PI, c);
  if (session) { session.applyMatrix(m); const e = getEngine(); if (e) session.preview(e); useTransform.setState((st) => ({ version: st.version + 1 })); return; }
  const label = { flipH: 'Flip Horizontal', flipV: 'Flip Vertical', rot90: 'Rotate 90° CW', 'rot-90': 'Rotate 90° CCW', rot180: 'Rotate 180°' }[kind];
  commit((st) => { let ls = st.layers; for (const l of layers) ls = updateLayer(ls, l.id, (x) => applyDeltaTransform(x, m, multiply)); return { ...st, layers: ls }; }, { history: label });
}

export { commitTransform, cancelTransform };

// ---------------- Image ----------------
export function setColorMode(mode: DocState['colorMode']) { commit((s) => (s.colorMode === mode ? s : { ...s, colorMode: mode }), { history: mode === 'grayscale' ? 'Grayscale' : 'RGB Color' }); }
export function rotateCanvas(deg: 90 | -90 | 180) { commit((s) => rotateDoc(s, deg), { history: deg === 180 ? 'Rotate Canvas 180°' : deg === 90 ? 'Rotate Canvas 90° CW' : 'Rotate Canvas 90° CCW' }); requestAnimationFrame(() => getEngine()?.fit()); }
export function flipCanvas(h: boolean) { commit((s) => flipDoc(s, h), { history: h ? 'Flip Canvas Horizontal' : 'Flip Canvas Vertical' }); }
export function cropToSelection() {
  const s = getDocState(); if (!s?.selection) { toast('Make a selection to crop to.', 'warning'); return; }
  const b = s.selection.bounds;
  commit((st) => ({ ...cropDocument(st, b, false), selection: null }), { history: 'Crop' });
  requestAnimationFrame(() => getEngine()?.fit());
}
export function trimTransparent() {
  const s = getDocState(); if (!s) return;
  const b = contentBounds(renderDocument(s), false);
  if (!b) { toast('The image is fully transparent.', 'info'); return; }
  if (b.x === 0 && b.y === 0 && b.w === s.width && b.h === s.height) { toast('There are no transparent edges to trim.', 'info'); return; }
  commit((st) => cropDocument(st, b, false), { history: 'Trim' });
  requestAnimationFrame(() => getEngine()?.fit());
}

/** Destructive adjustment on the active pixel layer (respects the selection). */
export function applyAdjustmentDestructive(adj: Adjustment, label: string) {
  const s = getDocState(); if (!s) return;
  const t = getPaintTarget(s); if (!t) return;
  const x = ctx2d(t.canvas, true);
  const img = x.getImageData(0, 0, t.canvas.width, t.canvas.height);
  applyAdjustment(img.data, t.canvas.width, t.canvas.height, adj);
  const out = createCanvas(t.canvas.width, t.canvas.height); ctx2d(out).putImageData(img, 0, 0);
  blendResult(t.canvas, t.base, out, s, t.ox, t.oy);
  t.commit(label);
}

/** result → canvas, limited to the selection (lerp via 'lighter' on premultiplied pixels). */
export function blendResult(dst: HTMLCanvasElement, base: HTMLCanvasElement, result: HTMLCanvasElement, s: DocState, ox: number, oy: number) {
  const x = ctx2d(dst);
  x.save(); x.globalCompositeOperation = 'copy'; x.drawImage(base, 0, 0); x.restore();
  if (!s.selection) { x.save(); x.globalCompositeOperation = 'copy'; x.drawImage(result, 0, 0); x.restore(); return; }
  const inside = createCanvas(dst.width, dst.height); const ix = ctx2d(inside); ix.drawImage(result, 0, 0);
  ix.globalCompositeOperation = 'destination-in'; ix.drawImage(s.selection.mask, -ox, -oy);
  x.save(); x.globalCompositeOperation = 'destination-out'; x.drawImage(s.selection.mask, -ox, -oy);
  x.globalCompositeOperation = 'lighter'; x.drawImage(inside, 0, 0); x.restore();
}

let lastFilter: { id: string; params: Record<string, number | string | boolean> } | null = null;
export const getLastFilter = () => lastFilter;
export function setLastFilter(f: typeof lastFilter) { lastFilter = f; }

/** Runs a filter on the active layer (in a worker) and commits it. */
export async function applyFilter(id: string, params: Record<string, number | string | boolean>) {
  const s = getDocState(); if (!s) return;
  const def = filterById(id); if (!def) return;
  const t = getPaintTarget(s); if (!t) return;
  lastFilter = { id, params };
  await withBusy(`Applying ${def.name}…`, async (progress) => {
    const w = t.canvas.width, h = t.canvas.height;
    const data = ctx2d(t.base, true).getImageData(0, 0, w, h).data;
    const outData = await runFilter(id, new Uint8ClampedArray(data), w, h, params, progress);
    const out = createCanvas(w, h); ctx2d(out).putImageData(new ImageData(new Uint8ClampedArray(outData), w, h), 0, 0);
    blendResult(t.canvas, t.base, out, s, t.ox, t.oy);
    t.commit(def.name);
  }, 'Unable to apply the filter. Please try again.');
}

export function repeatLastFilter() {
  if (!lastFilter) { toast('No filter has been applied yet.', 'info'); return; }
  void applyFilter(lastFilter.id, lastFilter.params);
}

export function openFilterDialog(id: string) {
  const s = getDocState(); if (!s) return;
  if (!getPaintTarget(s)) return;
  openDialog({ type: 'filter', filter: id });
}
