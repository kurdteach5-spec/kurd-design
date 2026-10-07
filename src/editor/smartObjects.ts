// Smart objects: layers wrapped into one non-destructive layer.
// - Convert to Smart Object: selected layers become the embedded contents of one layer.
// - Scaling / rotating only changes the transform, so the contents never lose quality.
// - Filters and Image › Adjustments on a smart object are stored as editable "smart filters".
// - Edit Contents opens the embedded layers in their own tab; Save (Ctrl/Cmd+S) there updates the
//   smart object in the original document.
import type { DocState, Layer, SmartFilter, SmartObjectLayer } from '../types/document';
import { commit, getDoc, getDocState, currentState, markSaved, openDocument, setActiveDocument, useDocuments } from '../state/documentStore';
import { toast } from '../state/uiStore';
import { allLayers, findLayer, insertLayers, removeLayers, updateLayer } from '../layers/tree';
import { createSmartObject } from '../layers/factory';
import { applyDeltaTransform, docBounds } from '../layers/geometry';
import { multiply, scaleM, translate, unionRect, type Rect } from '../utils/math';
import { uid } from '../utils/id';
import { useTools } from '../state/toolStore';

const targets = (s: DocState) => (s.selectedLayerIds.length ? s.selectedLayerIds : s.activeLayerId ? [s.activeLayerId] : []);

export function activeSmart(s: DocState | null = getDocState()): SmartObjectLayer | null {
  const l = s ? findLayer(s.layers, s.activeLayerId) : null;
  return l && l.type === 'smart' && s!.editTarget === 'content' ? l : null;
}

/** Layer › Smart Objects › Convert to Smart Object (also Filter › Convert for Smart Filters). */
export function convertToSmartObject() {
  const s = getDocState(); if (!s) return;
  const ids = targets(s); if (!ids.length) { toast('Select a layer first.', 'warning'); return; }
  const order = allLayers(s.layers).map((l) => l.id);
  const sorted = [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const members = sorted.map((id) => findLayer(s.layers, id)).filter(Boolean) as Layer[];
  if (members.some((l) => l.locked)) { toast('Locked layers cannot be converted.', 'warning'); return; }
  // contents canvas = bounds of the selected layers (whole canvas when they are empty)
  let b: Rect | null = null;
  for (const l of members) b = unionRect(b, docBounds(l));
  if (!b || b.w < 1 || b.h < 1) b = { x: 0, y: 0, w: s.width, h: s.height };
  const x = Math.floor(b.x), y = Math.floor(b.y);
  const w = Math.max(1, Math.ceil(b.x + b.w) - x), h = Math.max(1, Math.ceil(b.y + b.h) - y);
  const inner = members.map((l, i) => {
    const moved = applyDeltaTransform(l, translate(-x, -y), multiply);
    return i === 0 && moved.clipped ? { ...moved, clipped: false } : moved;
  });
  const smart = createSmartObject(members.length === 1 ? members[0].name : 'Smart Object', { width: w, height: h, dpi: s.dpi, layers: inner }, translate(x, y));
  commit((st) => {
    let layers = insertLayers(st.layers, [smart], sorted[sorted.length - 1], 'above');
    layers = removeLayers(layers, new Set(sorted));
    return { ...st, layers, activeLayerId: smart.id, selectedLayerIds: [smart.id], editTarget: 'content' };
  }, { history: 'Convert to Smart Object' });
}

/** Opens the smart object's contents in a new tab. */
export function editSmartContents(layerId?: string) {
  const d = getDoc(); const s = getDocState(); if (!d || !s) return;
  const l = findLayer(s.layers, layerId ?? s.activeLayerId);
  if (!l || l.type !== 'smart') { toast('Select a smart object first.', 'warning'); return; }
  const open = Object.values(useDocuments.getState().docs).find((x) => x.smartLink?.parentDocId === d.id && x.smartLink.layerId === l.id);
  if (open) { setActiveDocument(open.id); return; }
  const top = l.contents.layers[l.contents.layers.length - 1] ?? null;
  const st: DocState = {
    width: l.contents.width, height: l.contents.height, dpi: l.contents.dpi, colorMode: s.colorMode, layers: l.contents.layers,
    activeLayerId: top?.id ?? null, selectedLayerIds: top ? [top.id] : [], editTarget: 'content', selection: null, guides: [],
  };
  openDocument(l.name, st, { saved: true, label: 'Open', smartLink: { parentDocId: d.id, layerId: l.id } });
  // a single text layer inside: go straight to editing it with the Type tool
  if (l.contents.layers.length === 1 && top?.type === 'text') useTools.setState({ tool: 'text' });
  toast('Editing the smart object’s contents. Save (Ctrl/Cmd+S) to update it.', 'info', 5000);
}

/** Writes a contents tab back into its smart object. Returns false when the original is gone. */
export function pushSmartContents(childDocId?: string): boolean {
  const child = getDoc(childDocId); const link = child?.smartLink; if (!child || !link) return false;
  const parent = getDoc(link.parentDocId);
  const ps = parent ? currentState(parent) : null;
  const l = ps ? findLayer(ps.layers, link.layerId) : null;
  if (!parent || !l || l.type !== 'smart') { toast('The original document or smart object is no longer open, so the changes can’t be applied.', 'warning', 6000); return false; }
  const cs = currentState(child);
  // keep the object the same size on the page if the contents canvas was resized
  const sx = l.contents.width / cs.width, sy = l.contents.height / cs.height;
  // grow the contents to fit, e.g. when edited text got longer than the original box
  let b: Rect = { x: 0, y: 0, w: cs.width, h: cs.height };
  for (const c of cs.layers) if (c.visible) b = unionRect(b, docBounds(c))!;
  const ox = Math.floor(b.x), oy = Math.floor(b.y);
  const w = Math.ceil(b.x + b.w) - ox, h = Math.ceil(b.y + b.h) - oy;
  const layers = ox || oy ? cs.layers.map((c) => applyDeltaTransform(c, translate(-ox, -oy), multiply)) : cs.layers;
  commit((st) => ({
    ...st,
    layers: updateLayer(st.layers, l.id, (x) => ({
      ...(x as SmartObjectLayer),
      contents: { width: w, height: h, dpi: cs.dpi, layers },
      transform: multiply(multiply((x as SmartObjectLayer).transform, scaleM(sx, sy)), translate(ox, oy)),
    })),
  }), { history: 'Update Smart Object' }, parent.id);
  markSaved(child.projectId, child.name, child.id);
  toast('Smart object updated', 'success');
  return true;
}

// ---------- smart filters ----------
function updateFilters(layerId: string, fn: (l: SmartObjectLayer) => Partial<SmartObjectLayer>, label: string, mergeKey?: string) {
  commit((s) => ({ ...s, layers: updateLayer(s.layers, layerId, (l) => (l.type === 'smart' ? { ...l, ...fn(l) } : l)) }), { history: label, mergeKey });
}
export type NewSmartFilter =
  | { kind: 'filter'; filter: string; params: Record<string, number | string | boolean> }
  | { kind: 'adjustment'; adjustment: Extract<SmartFilter, { kind: 'adjustment' }>['adjustment'] };

export function withSmartFilter(l: SmartObjectLayer, f: NewSmartFilter, index?: number): SmartObjectLayer {
  const filters = [...l.filters];
  if (index !== undefined && filters[index]) filters[index] = { ...f, id: filters[index].id, enabled: filters[index].enabled } as SmartFilter;
  else filters.push({ ...f, id: uid('sf'), enabled: true } as SmartFilter);
  return { ...l, filters, filtersEnabled: true };
}
export function addSmartFilter(layerId: string, f: NewSmartFilter, label: string, index?: number) {
  updateFilters(layerId, (l) => withSmartFilter(l, f, index), label);
}
export function setSmartFilterEnabled(layerId: string, index: number, enabled: boolean) {
  updateFilters(layerId, (l) => ({ filters: l.filters.map((f, i) => (i === index ? { ...f, enabled } : f)) }), enabled ? 'Show Smart Filter' : 'Hide Smart Filter');
}
export function setSmartFiltersEnabled(layerId: string, enabled: boolean) {
  updateFilters(layerId, () => ({ filtersEnabled: enabled }), enabled ? 'Show Smart Filters' : 'Hide Smart Filters');
}
export function removeSmartFilter(layerId: string, index: number) {
  updateFilters(layerId, (l) => ({ filters: l.filters.filter((_, i) => i !== index) }), 'Delete Smart Filter');
}
