import type { AdjustmentKind, BlendMode, DocState, Layer, LayerEffects, VectorMask } from '../types/document';
import { commit, getDocState } from '../state/documentStore';
import { toast } from '../state/uiStore';
import {
  allLayers, arrangeLayer, findLayer, findParent, insertLayers, mapAllLayers, removeLayers, updateLayer,
} from '../layers/tree';
import { cloneLayer, createAdjustmentLayer, createEmptyRaster, createGroup, createMask, defaultGeometry } from '../layers/factory';
import { rasterizeLayer } from '../layers/docOps';
import { renderDocument, sharedCompositor } from '../canvas/compositor';
import { createCanvas, ctx2d, contentBounds } from '../utils/canvas';
import { translate, IDENTITY } from '../utils/math';
import { docBounds } from '../layers/geometry';
import { maskAlpha } from '../canvas/effects';
import { selectionFromAlpha } from '../canvas/selection';
import { useTools } from '../state/toolStore';

const active = (s: DocState) => findLayer(s.layers, s.activeLayerId);
const targets = (s: DocState) => (s.selectedLayerIds.length ? s.selectedLayerIds : s.activeLayerId ? [s.activeLayerId] : []);

function nextName(s: DocState, prefix: string) {
  const names = new Set(allLayers(s.layers).map((l) => l.name));
  let i = allLayers(s.layers).filter((l) => l.name.startsWith(prefix)).length + 1; let n = `${prefix} ${i}`;
  while (names.has(n)) { i++; n = `${prefix} ${i}`; }
  return n;
}

export function selectLayer(id: string, mode: 'single' | 'toggle' | 'range' = 'single') {
  commit((s) => {
    if (mode === 'toggle') {
      const sel = new Set(s.selectedLayerIds.length ? s.selectedLayerIds : s.activeLayerId ? [s.activeLayerId] : []);
      if (sel.has(id) && sel.size > 1) sel.delete(id); else sel.add(id);
      return { ...s, activeLayerId: id, selectedLayerIds: [...sel], editTarget: 'content' };
    }
    if (mode === 'range' && s.activeLayerId) {
      const order = allLayers(s.layers).map((l) => l.id);
      const a = order.indexOf(s.activeLayerId), b = order.indexOf(id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      return { ...s, selectedLayerIds: order.slice(lo, hi + 1), activeLayerId: id };
    }
    const l = findLayer(s.layers, id);
    const target = l?.type === 'adjustment' && l.mask ? 'mask' : 'content';
    return { ...s, activeLayerId: id, selectedLayerIds: [id], editTarget: target };
  });
}

export function setEditTarget(id: string, target: DocState['editTarget']) {
  commit((s) => ({ ...s, activeLayerId: id, selectedLayerIds: [id], editTarget: target }));
}

export function newLayer() {
  commit((s) => {
    const l = createEmptyRaster(nextName(s, 'Layer'), s.width, s.height);
    const ref = s.activeLayerId;
    const a = ref ? findLayer(s.layers, ref) : null;
    const layers = a?.type === 'group' && a.expanded ? insertLayers(s.layers, [l], ref, 'inside') : insertLayers(s.layers, [l], ref, 'above');
    return { ...s, layers, activeLayerId: l.id, selectedLayerIds: [l.id], editTarget: 'content' };
  }, { history: 'New Layer' });
}

export function newAdjustmentLayer(kind: AdjustmentKind) {
  commit((s) => {
    const l = { ...createAdjustmentLayer(kind), mask: createMask(s.width, s.height, 255) };
    return { ...s, layers: insertLayers(s.layers, [l], s.activeLayerId, 'above'), activeLayerId: l.id, selectedLayerIds: [l.id], editTarget: 'content' };
  }, { history: `New ${createAdjustmentLayer(kind).name} Layer` });
}

export function deleteLayers(ids?: string[]) {
  const s = getDocState(); if (!s) return;
  const del = new Set(ids ?? targets(s));
  if (!del.size) return;
  const remaining = removeLayers(s.layers, del);
  if (!allLayers(remaining).length) { toast('A document needs at least one layer.', 'warning'); return; }
  const locked = [...del].map((id) => findLayer(s.layers, id)).filter((l) => l?.locked);
  if (locked.length) { toast('Locked layers cannot be deleted.', 'warning'); return; }
  commit((st) => ({ ...st, layers: removeLayers(st.layers, del), selectedLayerIds: [], activeLayerId: null }), { history: del.size > 1 ? 'Delete Layers' : 'Delete Layer' });
}

export function duplicateLayers() {
  commit((s) => {
    const ids = targets(s); if (!ids.length) return s;
    let layers = s.layers; const newIds: string[] = [];
    for (const id of ids) {
      const l = findLayer(layers, id); if (!l) continue;
      const c = cloneLayer(l); newIds.push(c.id);
      layers = insertLayers(layers, [c], id, 'above');
    }
    return { ...s, layers, activeLayerId: newIds[newIds.length - 1] ?? s.activeLayerId, selectedLayerIds: newIds };
  }, { history: 'Duplicate Layer' });
}

export function renameLayer(id: string, name: string) {
  const n = name.trim(); if (!n) return;
  commit((s) => ({ ...s, layers: updateLayer(s.layers, id, (l) => ({ ...l, name: n })) }), { history: 'Rename Layer' });
}

export function setLayerProps(id: string, patch: Partial<Pick<Layer, 'opacity' | 'fillOpacity' | 'blendMode' | 'visible' | 'locked' | 'clipped'>>, label?: string) {
  const keys = Object.keys(patch).join(',');
  commit((s) => ({ ...s, layers: updateLayer(s.layers, id, (l) => ({ ...l, ...patch } as Layer)) }), {
    history: label ?? (patch.opacity !== undefined ? 'Opacity' : patch.fillOpacity !== undefined ? 'Fill Opacity' : patch.blendMode ? 'Blending Change' : patch.visible !== undefined ? (patch.visible ? 'Show Layer' : 'Hide Layer') : patch.locked !== undefined ? 'Lock Layer' : 'Layer Properties'),
    mergeKey: patch.opacity !== undefined || patch.fillOpacity !== undefined ? `props-${id}-${keys}` : undefined,
  });
}

export function setBlendMode(mode: BlendMode) {
  const s = getDocState(); if (!s) return;
  for (const id of targets(s)) setLayerProps(id, { blendMode: mode });
}

export function toggleVisibility(id: string, solo = false) {
  const s = getDocState(); if (!s) return;
  if (solo) {
    const others = allLayers(s.layers).filter((l) => l.id !== id && l.type !== 'group');
    const anyVisible = others.some((l) => l.visible);
    commit((st) => ({ ...st, layers: mapAllLayers(st.layers, (l) => (l.id === id ? { ...l, visible: true } : l.type === 'group' ? l : { ...l, visible: !anyVisible })) }), { history: 'Show/Hide Layers' });
    return;
  }
  const l = findLayer(s.layers, id); if (!l) return;
  setLayerProps(id, { visible: !l.visible });
}

export function updateEffects(id: string, fx: LayerEffects, label = 'Layer Style') {
  commit((s) => ({ ...s, layers: updateLayer(s.layers, id, (l) => ({ ...l, effects: fx })) }), { history: label, mergeKey: `fx-${id}` });
}

export function groupLayers() {
  const s = getDocState(); if (!s) return;
  const ids = targets(s); if (!ids.length) return;
  commit((st) => {
    const order = allLayers(st.layers).map((l) => l.id);
    const sorted = [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const members = sorted.map((id) => findLayer(st.layers, id)).filter(Boolean) as Layer[];
    const g = createGroup(nextName(st, 'Group'), members);
    const top = sorted[sorted.length - 1];
    let layers = insertLayers(st.layers, [g], top, 'above');
    layers = removeLayers(layers, new Set(sorted));
    return { ...st, layers, activeLayerId: g.id, selectedLayerIds: [g.id] };
  }, { history: 'Group Layers' });
}

export function ungroupLayers() {
  const s = getDocState(); const g = s && active(s);
  if (!s || !g || g.type !== 'group') { toast('Select a group to ungroup.', 'warning'); return; }
  commit((st) => {
    let layers = insertLayers(st.layers, g.children, g.id, 'above');
    layers = removeLayers(layers, new Set([g.id]));
    return { ...st, layers, activeLayerId: g.children[g.children.length - 1]?.id ?? null, selectedLayerIds: g.children.map((c) => c.id) };
  }, { history: 'Ungroup Layers' });
}

export function arrange(where: 'up' | 'down' | 'top' | 'bottom') {
  const s = getDocState(); if (!s?.activeLayerId) return;
  commit((st) => ({ ...st, layers: arrangeLayer(st.layers, st.activeLayerId!, where) }), { history: where === 'top' ? 'Bring to Front' : where === 'bottom' ? 'Send to Back' : where === 'up' ? 'Bring Forward' : 'Send Backward' });
}

export function selectAdjacentLayer(dir: 1 | -1) {
  const s = getDocState(); if (!s) return;
  const flat = allLayers(s.layers); const i = flat.findIndex((l) => l.id === s.activeLayerId);
  const n = flat[Math.max(0, Math.min(flat.length - 1, i + dir))];
  if (n) selectLayer(n.id);
}

/** Renders a list of sibling layers (bottom → top) to a single pixel layer. */
function mergeToRaster(s: DocState, layers: Layer[], name: string) {
  const canvas = renderDocument({ ...s, layers, colorMode: 'rgb' });
  const b = contentBounds(canvas, false);
  let c = canvas, t = IDENTITY;
  if (b && (b.w < s.width || b.h < s.height)) { c = createCanvas(b.w, b.h); ctx2d(c).drawImage(canvas, -b.x, -b.y); t = translate(b.x, b.y); }
  return { ...createEmptyRaster(name, 1, 1), canvas: c, transform: t };
}

export function mergeDown() {
  const s = getDocState(); const a = s && active(s);
  if (!s || !a) return;
  const loc = findParent(s.layers, a.id);
  if (!loc || loc.index === 0) { toast('There is no layer below to merge with.', 'warning'); return; }
  const below = loc.siblings[loc.index - 1];
  if (a.locked || below.locked) { toast('Locked layers cannot be merged.', 'warning'); return; }
  commit((st) => {
    const merged = mergeToRaster(st, [below, a], below.name);
    let layers = insertLayers(st.layers, [merged], below.id, 'below');
    layers = removeLayers(layers, new Set([a.id, below.id]));
    return { ...st, layers, activeLayerId: merged.id, selectedLayerIds: [merged.id] };
  }, { history: 'Merge Down' });
}

export function mergeSelected() {
  const s = getDocState(); if (!s) return;
  const ids = targets(s);
  if (ids.length < 2) { mergeDown(); return; }
  commit((st) => {
    const order = allLayers(st.layers).map((l) => l.id);
    const sorted = [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const members = sorted.map((id) => findLayer(st.layers, id)!).filter(Boolean);
    const merged = mergeToRaster(st, members, members[members.length - 1].name);
    let layers = insertLayers(st.layers, [merged], sorted[sorted.length - 1], 'above');
    layers = removeLayers(layers, new Set(sorted));
    return { ...st, layers, activeLayerId: merged.id, selectedLayerIds: [merged.id] };
  }, { history: 'Merge Layers' });
}

export function mergeVisible() {
  commit((st) => {
    const visible = st.layers.filter((l) => l.visible);
    if (!visible.length) return st;
    const merged = mergeToRaster(st, visible, 'Merged');
    const hidden = st.layers.filter((l) => !l.visible);
    return { ...st, layers: [...hidden, merged], activeLayerId: merged.id, selectedLayerIds: [merged.id] };
  }, { history: 'Merge Visible' });
}

export function flattenImage() {
  commit((st) => {
    const canvas = renderDocument({ ...st, colorMode: 'rgb' });
    const bg = createCanvas(st.width, st.height); const x = ctx2d(bg); x.fillStyle = '#ffffff'; x.fillRect(0, 0, st.width, st.height); x.drawImage(canvas, 0, 0);
    const l = { ...createEmptyRaster('Background', 1, 1), canvas: bg };
    return { ...st, layers: [l], activeLayerId: l.id, selectedLayerIds: [l.id] };
  }, { history: 'Flatten Image' });
}

export function rasterize() {
  const s = getDocState(); const a = s && active(s);
  if (!s || !a) return;
  if (a.type !== 'text' && a.type !== 'shape') { toast('Only text and shape layers need rasterizing.', 'info'); return; }
  commit((st) => ({ ...st, layers: updateLayer(st.layers, a.id, (l) => rasterizeLayer(st, l)) }), { history: `Rasterize ${a.type === 'text' ? 'Type' : 'Shape'}` });
}

export function toggleClipping() {
  const s = getDocState(); const a = s && active(s); if (!s || !a) return;
  const loc = findParent(s.layers, a.id);
  if (!a.clipped && (!loc || loc.index === 0)) { toast('A clipping mask needs a layer below.', 'warning'); return; }
  setLayerProps(a.id, { clipped: !a.clipped }, a.clipped ? 'Release Clipping Mask' : 'Create Clipping Mask');
}

export function toggleLock() { const s = getDocState(); const a = s && active(s); if (a) setLayerProps(a.id, { locked: !a.locked }, a.locked ? 'Unlock Layer' : 'Lock Layer'); }

// ---------------- Masks ----------------
export function addLayerMask(kind: 'reveal' | 'hide' | 'selection') {
  const s = getDocState(); const a = s && active(s); if (!s || !a) return;
  if (a.mask) { toast('This layer already has a mask.', 'info'); return; }
  let mask;
  if (kind === 'selection' && s.selection) {
    mask = createMask(s.width, s.height, 0);
    const x = ctx2d(mask.canvas); const tmp = createCanvas(s.width, s.height); const tx = ctx2d(tmp);
    tx.fillStyle = '#fff'; tx.fillRect(0, 0, s.width, s.height); tx.globalCompositeOperation = 'destination-in'; tx.drawImage(s.selection.mask, 0, 0);
    x.drawImage(tmp, 0, 0);
  } else mask = createMask(s.width, s.height, kind === 'hide' ? 0 : 255);
  commit((st) => ({ ...st, layers: updateLayer(st.layers, a.id, (l) => ({ ...l, mask })), editTarget: 'mask', selection: kind === 'selection' ? null : st.selection }), { history: 'Add Layer Mask' });
}

export function deleteLayerMask(apply = false) {
  const s = getDocState(); const a = s && active(s); if (!s || !a?.mask) return;
  if (apply) {
    if (a.type !== 'raster') { toast('Masks can only be applied to pixel layers.', 'warning'); return; }
    const px = sharedCompositor.renderLayer(s, { ...a, effects: { ...a.effects, dropShadow: { ...a.effects.dropShadow, enabled: false }, outerGlow: { ...a.effects.outerGlow, enabled: false }, stroke: { ...a.effects.stroke, enabled: false } }, fillOpacity: 1, vectorMask: null } as Layer);
    commit((st) => ({ ...st, layers: updateLayer(st.layers, a.id, (l) => ({ ...l, mask: null, canvas: px, transform: IDENTITY } as Layer)), editTarget: 'content' }), { history: 'Apply Layer Mask' });
    return;
  }
  commit((st) => ({ ...st, layers: updateLayer(st.layers, a.id, (l) => ({ ...l, mask: null })), editTarget: 'content' }), { history: 'Delete Layer Mask' });
}

export function toggleMaskEnabled(id?: string) {
  const s = getDocState(); const a = s && findLayer(s.layers, id ?? s.activeLayerId); if (!a?.mask) return;
  commit((st) => ({ ...st, layers: updateLayer(st.layers, a.id, (l) => ({ ...l, mask: { ...l.mask!, enabled: !l.mask!.enabled } })) }), { history: a.mask.enabled ? 'Disable Layer Mask' : 'Enable Layer Mask' });
}

export function invertMask() {
  const s = getDocState(); const a = s && active(s); if (!s || !a?.mask) return;
  const m = a.mask; const c = createCanvas(m.canvas.width, m.canvas.height); const x = ctx2d(c);
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.globalCompositeOperation = 'difference'; x.drawImage(m.canvas, 0, 0);
  commit((st) => ({ ...st, layers: updateLayer(st.layers, a.id, (l) => ({ ...l, mask: { ...m, canvas: c, background: 255 - m.background } })) }), { history: 'Invert Mask' });
}

export function setMaskProps(id: string, patch: Partial<{ density: number; feather: number; linked: boolean }>) {
  commit((st) => ({ ...st, layers: updateLayer(st.layers, id, (l) => (l.mask ? { ...l, mask: { ...l.mask, ...patch } } : l)) }), { history: 'Mask Properties', mergeKey: `mask-${id}-${Object.keys(patch).join()}` });
}

export function maskToSelection() {
  const s = getDocState(); const a = s && active(s); if (!s || !a?.mask) return;
  const alpha = maskAlpha(a.mask, s.width, s.height);
  const sel = selectionFromAlpha(alpha, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, s.width, s.height);
  commit((st) => ({ ...st, selection: sel }), { history: 'Load Selection' });
}

export function addVectorMask(kind: 'reveal' | 'selection') {
  const s = getDocState(); const a = s && active(s); if (!s || !a) return;
  if (a.vectorMask) { toast('This layer already has a vector mask.', 'info'); return; }
  const b = kind === 'selection' && s.selection ? s.selection.bounds : { x: 0, y: 0, w: s.width, h: s.height };
  const vm: VectorMask = { geometry: { ...defaultGeometry('rect', b.w, b.h) }, transform: translate(b.x, b.y), enabled: true, feather: 0, invert: false };
  commit((st) => ({ ...st, layers: updateLayer(st.layers, a.id, (l) => ({ ...l, vectorMask: vm })), editTarget: 'vectorMask' }), { history: 'Add Vector Mask' });
  useTools.setState({ tool: 'path-select' });
}
export function updateVectorMask(id: string, patch: Partial<VectorMask>, label = 'Vector Mask') {
  commit((st) => ({ ...st, layers: updateLayer(st.layers, id, (l) => (l.vectorMask ? { ...l, vectorMask: { ...l.vectorMask, ...patch } } : l)) }), { history: label, mergeKey: `vmask-${id}-${Object.keys(patch).join()}` });
}
export function deleteVectorMask() {
  const s = getDocState(); const a = s && active(s); if (!a?.vectorMask) return;
  commit((st) => ({ ...st, layers: updateLayer(st.layers, a.id, (l) => ({ ...l, vectorMask: null })), editTarget: 'content' }), { history: 'Delete Vector Mask' });
}

export function layerAlphaToSelection(id?: string) {
  const s = getDocState(); const l = s && findLayer(s.layers, id ?? s.activeLayerId); if (!s || !l) return;
  const c = sharedCompositor.renderLayer(s, l);
  const sel = selectionFromAlpha(c, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, s.width, s.height);
  commit((st) => ({ ...st, selection: sel }), { history: 'Load Selection' });
  if (!sel) toast('This layer has no visible pixels.', 'info');
}

// ---------------- Align / distribute ----------------
export function alignLayers(mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') {
  const s = getDocState(); if (!s) return;
  const ids = targets(s).filter((id) => { const l = findLayer(s.layers, id); return l && !l.locked && l.type !== 'adjustment'; });
  if (!ids.length) return;
  const items = ids.map((id) => ({ id, b: docBounds(findLayer(s.layers, id)!) })).filter((i) => i.b) as { id: string; b: NonNullable<ReturnType<typeof docBounds>> }[];
  if (!items.length) return;
  const ref = items.length > 1 ? items.reduce((acc, i) => ({ x: Math.min(acc.x, i.b.x), y: Math.min(acc.y, i.b.y), r: Math.max(acc.r, i.b.x + i.b.w), bt: Math.max(acc.bt, i.b.y + i.b.h) }), { x: Infinity, y: Infinity, r: -Infinity, bt: -Infinity })
    : s.selection ? { x: s.selection.bounds.x, y: s.selection.bounds.y, r: s.selection.bounds.x + s.selection.bounds.w, bt: s.selection.bounds.y + s.selection.bounds.h } : { x: 0, y: 0, r: s.width, bt: s.height };
  commit((st) => {
    let layers = st.layers;
    for (const { id, b } of items) {
      let dx = 0, dy = 0;
      if (mode === 'left') dx = ref.x - b.x; if (mode === 'right') dx = ref.r - (b.x + b.w); if (mode === 'hcenter') dx = (ref.x + ref.r) / 2 - (b.x + b.w / 2);
      if (mode === 'top') dy = ref.y - b.y; if (mode === 'bottom') dy = ref.bt - (b.y + b.h); if (mode === 'vcenter') dy = (ref.y + ref.bt) / 2 - (b.y + b.h / 2);
      layers = updateLayer(layers, id, (l) => shift(l, Math.round(dx), Math.round(dy)));
    }
    return { ...st, layers };
  }, { history: 'Align' });
}

export function distributeLayers(axis: 'h' | 'v') {
  const s = getDocState(); if (!s) return;
  const items = targets(s).map((id) => ({ id, b: docBounds(findLayer(s.layers, id)!) })).filter((i) => i.b) as { id: string; b: NonNullable<ReturnType<typeof docBounds>> }[];
  if (items.length < 3) { toast('Select at least three layers to distribute.', 'info'); return; }
  const key = axis === 'h' ? 'x' : 'y'; const size = axis === 'h' ? 'w' : 'h';
  items.sort((a, b) => a.b[key] + a.b[size] / 2 - (b.b[key] + b.b[size] / 2));
  const first = items[0].b[key] + items[0].b[size] / 2, last = items[items.length - 1].b[key] + items[items.length - 1].b[size] / 2;
  commit((st) => {
    let layers = st.layers;
    items.forEach((it, i) => {
      const target = first + ((last - first) * i) / (items.length - 1);
      const d = Math.round(target - (it.b[key] + it.b[size] / 2));
      layers = updateLayer(layers, it.id, (l) => shift(l, axis === 'h' ? d : 0, axis === 'v' ? d : 0));
    });
    return { ...st, layers };
  }, { history: 'Distribute' });
}

function shift(l: Layer, dx: number, dy: number): Layer {
  const mv = <T extends { e: number; f: number }>(m: T): T => ({ ...m, e: m.e + dx, f: m.f + dy });
  const mask = l.mask && l.mask.linked ? { ...l.mask, transform: mv(l.mask.transform) } : l.mask;
  const vectorMask = l.vectorMask ? { ...l.vectorMask, transform: mv(l.vectorMask.transform) } : null;
  if (l.type === 'group') return { ...l, mask, vectorMask, children: l.children.map((c) => shift(c, dx, dy)) };
  if (l.type === 'adjustment') return { ...l, mask, vectorMask };
  return { ...l, mask, vectorMask, transform: mv(l.transform) } as Layer;
}
export const shiftLayer = shift;

export function setAdjustment(id: string, adjustment: import('../types/document').Adjustment, mergeKey?: string) {
  commit((s) => ({ ...s, layers: updateLayer(s.layers, id, (l) => (l.type === 'adjustment' ? { ...l, adjustment } : l)) }), { history: 'Adjustment', mergeKey: mergeKey ?? `adj-${id}` });
}

export function toggleGroupExpanded(id: string) {
  commit((s) => ({ ...s, layers: updateLayer(s.layers, id, (l) => (l.type === 'group' ? { ...l, expanded: !l.expanded } : l)) }));
}
