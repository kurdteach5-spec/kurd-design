import type { GroupLayer, Layer } from '../types/document';

export interface FlatLayer { layer: Layer; depth: number; parentId: string | null; index: number }

export function findLayer(layers: Layer[], id: string | null | undefined): Layer | null {
  if (!id) return null;
  for (const l of layers) {
    if (l.id === id) return l;
    if (l.type === 'group') { const f = findLayer(l.children, id); if (f) return f; }
  }
  return null;
}

export function findParent(layers: Layer[], id: string, parent: GroupLayer | null = null): { parent: GroupLayer | null; siblings: Layer[]; index: number } | null {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (l.id === id) return { parent, siblings: layers, index: i };
    if (l.type === 'group') { const f = findParent(l.children, id, l); if (f) return f; }
  }
  return null;
}

/** Top → bottom flattened order for the Layers panel. */
export function flattenForPanel(layers: Layer[], depth = 0, parentId: string | null = null, out: FlatLayer[] = []): FlatLayer[] {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    out.push({ layer: l, depth, parentId, index: i });
    if (l.type === 'group' && l.expanded) flattenForPanel(l.children, depth + 1, l.id, out);
  }
  return out;
}

/** Bottom → top flattened list of every layer (including group children). */
export function allLayers(layers: Layer[], out: Layer[] = []): Layer[] {
  for (const l of layers) { out.push(l); if (l.type === 'group') allLayers(l.children, out); }
  return out;
}

export function updateLayer(layers: Layer[], id: string, fn: (l: Layer) => Layer): Layer[] {
  let changed = false;
  const next = layers.map((l) => {
    if (l.id === id) { changed = true; return fn(l); }
    if (l.type === 'group') {
      const ch = updateLayer(l.children, id, fn);
      if (ch !== l.children) { changed = true; return { ...l, children: ch }; }
    }
    return l;
  });
  return changed ? next : layers;
}

export function mapAllLayers(layers: Layer[], fn: (l: Layer) => Layer): Layer[] {
  return layers.map((l) => {
    const m = fn(l);
    if (m.type === 'group') return { ...m, children: mapAllLayers(m.children, fn) };
    return m;
  });
}

export function removeLayers(layers: Layer[], ids: Set<string>): Layer[] {
  const out: Layer[] = [];
  for (const l of layers) {
    if (ids.has(l.id)) continue;
    if (l.type === 'group') {
      const ch = removeLayers(l.children, ids);
      out.push(ch === l.children ? l : { ...l, children: ch });
    } else out.push(l);
  }
  return out.length === layers.length && out.every((l, i) => l === layers[i]) ? layers : out;
}

/** Insert `newLayers` relative to a reference layer. position: 'above' | 'below' | 'inside' (top of group). */
export function insertLayers(layers: Layer[], newLayers: Layer[], refId: string | null, position: 'above' | 'below' | 'inside' = 'above'): Layer[] {
  if (!refId) return [...layers, ...newLayers];
  const loc = findParent(layers, refId);
  if (!loc) return [...layers, ...newLayers];
  if (position === 'inside') {
    return updateLayer(layers, refId, (g) => (g.type === 'group' ? { ...g, expanded: true, children: [...g.children, ...newLayers] } : g));
  }
  const at = position === 'above' ? loc.index + 1 : loc.index;
  if (!loc.parent) { const c = [...layers]; c.splice(at, 0, ...newLayers); return c; }
  return updateLayer(layers, loc.parent.id, (g) => {
    const gl = g as GroupLayer; const c = [...gl.children]; c.splice(at, 0, ...newLayers); return { ...gl, children: c };
  });
}

export function isDescendant(layers: Layer[], ancestorId: string, id: string): boolean {
  const a = findLayer(layers, ancestorId);
  if (!a || a.type !== 'group') return false;
  return !!findLayer(a.children, id);
}

/** Moves layers to a new position (used by drag & drop). */
export function moveLayers(layers: Layer[], ids: string[], refId: string, position: 'above' | 'below' | 'inside'): Layer[] {
  if (ids.includes(refId)) return layers;
  for (const id of ids) if (isDescendant(layers, id, refId)) return layers;
  // keep visual order: collect in bottom→top order
  const order = allLayers(layers).map((l) => l.id);
  const sorted = [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const moving = sorted.map((id) => findLayer(layers, id)).filter(Boolean) as Layer[];
  const removed = removeLayers(layers, new Set(ids));
  return insertLayers(removed, moving, refId, position);
}

/** Moves a single layer one step up/down among siblings (or to front/back). */
export function arrangeLayer(layers: Layer[], id: string, where: 'up' | 'down' | 'top' | 'bottom'): Layer[] {
  const loc = findParent(layers, id);
  if (!loc) return layers;
  const sib = [...loc.siblings];
  const [item] = sib.splice(loc.index, 1);
  let to = loc.index;
  if (where === 'up') to = Math.min(sib.length, loc.index + 1);
  else if (where === 'down') to = Math.max(0, loc.index - 1);
  else if (where === 'top') to = sib.length;
  else to = 0;
  sib.splice(to, 0, item);
  if (!loc.parent) return sib;
  return updateLayer(layers, loc.parent.id, (g) => ({ ...(g as GroupLayer), children: sib }));
}

export function layerIndexPath(layers: Layer[], id: string): number[] | null {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (l.id === id) return [i];
    if (l.type === 'group') { const p = layerIndexPath(l.children, id); if (p) return [i, ...p]; }
  }
  return null;
}

/** Topmost-first ordering helper for hit testing. */
export function layersTopDown(layers: Layer[]): Layer[] { return allLayers(layers).reverse(); }

export function isEffectivelyVisible(layers: Layer[], id: string): boolean {
  const walk = (ls: Layer[], parentVisible: boolean): boolean | null => {
    for (const l of ls) {
      const v = parentVisible && l.visible;
      if (l.id === id) return v;
      if (l.type === 'group') { const r = walk(l.children, v); if (r !== null) return r; }
    }
    return null;
  };
  return !!walk(layers, true);
}
