// Motion workspace state: the project (with undo/redo history) plus UI state (time, selection, tools…).
import { create } from '../state/createStore';
import type { Composition, MLayer, MotionProject, Prop, PropValue } from './types';
import { emptyProject } from './factory';

export type MotionTool = 'select' | 'hand' | 'zoom' | 'rotate' | 'anchor' | 'rect' | 'ellipse' | 'polygon' | 'star' | 'pen' | 'text' | 'camera';
export type Quality = 1 | 0.5 | 0.25;

export interface KeyRef { layerId: string; path: string; keyId: string }

export interface MotionState {
  project: MotionProject;
  past: { p: MotionProject; label: string; mergeKey?: string; at: number }[];
  future: { p: MotionProject; label: string }[];
  /** label of the change that produced the current project */
  label: string;
  version: number;
  savedVersion: number;
  activeCompId: string | null;
  /** composition tabs open in the viewer/timeline */
  openComps: string[];
  /** current time per composition (seconds) */
  times: Record<string, number>;
  selectedLayers: string[];
  selectedKeys: KeyRef[];
  /** property shown in the graph editor */
  graphProp: { layerId: string; path: string } | null;
  selectedProjectItem: string | null;
  playing: boolean;
  loop: boolean;
  quality: Quality;
  tool: MotionTool;
  /** shape tools draw masks on the selected layer instead of new shape layers */
  shapeToolMode: 'shape' | 'mask';
  view: { zoom: number; fit: boolean; panX: number; panY: number };
  timeline: { pxPerSec: number; scroll: number; graph: boolean; expanded: Record<string, boolean>; snap: boolean; showShy: boolean };
  /** actual playback rate measured during preview */
  measuredFps: number;
  /** Effects & Presets search */
  showMatte: boolean;
}

export const useMotion = create<MotionState>(() => ({
  project: emptyProject(), past: [], future: [], label: 'New Project', version: 0, savedVersion: 0,
  activeCompId: null, openComps: [], times: {}, selectedLayers: [], selectedKeys: [], graphProp: null, selectedProjectItem: null,
  playing: false, loop: true, quality: 0.5, tool: 'select', shapeToolMode: 'shape',
  view: { zoom: 1, fit: true, panX: 0, panY: 0 },
  timeline: { pxPerSec: 120, scroll: 0, graph: false, expanded: {}, snap: true, showShy: true },
  measuredFps: 0, showMatte: false,
}));

const MAX_UNDO = 200;

/** Applies a change to the project as one undoable step. Steps with the same mergeKey within 1.2 s merge. */
export function mcommit(recipe: (p: MotionProject) => MotionProject, label: string, mergeKey?: string) {
  const s = useMotion.getState();
  const next = recipe(s.project);
  if (next === s.project) return;
  const now = performance.now();
  const last = s.past[s.past.length - 1];
  const merge = mergeKey && s.label === label && last?.mergeKey === mergeKey && now - last.at < 1200;
  const past = merge ? s.past.map((e, i) => (i === s.past.length - 1 ? { ...e, at: now } : e)) : [...s.past, { p: s.project, label: s.label, mergeKey, at: now }].slice(-MAX_UNDO);
  useMotion.setState({ project: next, past, future: [], label, version: s.version + 1 });
}

/** Replace the project without an undo step (loading). */
export function loadProjectState(p: MotionProject) {
  const first = p.compOrder[0] ?? null;
  useMotion.setState((s) => ({
    project: p, past: [], future: [], label: 'Open', version: s.version + 1, savedVersion: s.version + 1,
    activeCompId: first, openComps: first ? [first] : [], times: {}, selectedLayers: [], selectedKeys: [], graphProp: null, playing: false,
  }));
}

export function mundo() {
  const s = useMotion.getState(); const prev = s.past[s.past.length - 1]; if (!prev) return;
  useMotion.setState({ project: prev.p, past: s.past.slice(0, -1), future: [{ p: s.project, label: s.label }, ...s.future], label: prev.label, version: s.version + 1 });
  sanitizeUi();
}
export function mredo() {
  const s = useMotion.getState(); const next = s.future[0]; if (!next) return;
  useMotion.setState({ project: next.p, future: s.future.slice(1), past: [...s.past, { p: s.project, label: s.label, at: 0 }], label: next.label, version: s.version + 1 });
  sanitizeUi();
}
export const undoLabel = () => useMotion.getState().label;
export const redoLabel = () => useMotion.getState().future[0]?.label ?? null;

/** Drops UI references to things that no longer exist (after undo/redo/delete). */
export function sanitizeUi() {
  useMotion.setState((s) => {
    const comps = s.project.comps;
    const openComps = s.openComps.filter((id) => comps[id]);
    const activeCompId = s.activeCompId && comps[s.activeCompId] ? s.activeCompId : openComps[0] ?? s.project.compOrder[0] ?? null;
    const comp = activeCompId ? comps[activeCompId] : null;
    const ids = new Set(comp?.layers.map((l) => l.id) ?? []);
    return {
      openComps: activeCompId && !openComps.includes(activeCompId) ? [...openComps, activeCompId] : openComps, activeCompId,
      selectedLayers: s.selectedLayers.filter((id) => ids.has(id)),
      selectedKeys: s.selectedKeys.filter((k) => ids.has(k.layerId)),
      graphProp: s.graphProp && ids.has(s.graphProp.layerId) ? s.graphProp : null,
    };
  });
}

// ---------- selectors ----------
export const activeComp = (s: MotionState = useMotion.getState()): Composition | null => (s.activeCompId ? s.project.comps[s.activeCompId] ?? null : null);
export const compTime = (s: MotionState = useMotion.getState(), compId = s.activeCompId) => (compId ? s.times[compId] ?? 0 : 0);
export function setTime(t: number, compId = useMotion.getState().activeCompId) {
  if (!compId) return;
  const comp = useMotion.getState().project.comps[compId]; if (!comp) return;
  const f = Math.round(Math.max(0, Math.min(comp.duration - 1 / comp.fps, t)) * comp.fps) / comp.fps;
  useMotion.setState((s) => (s.times[compId] === f ? s : { times: { ...s.times, [compId]: f } }));
}

export function updateComp(compId: string, fn: (c: Composition) => Composition) {
  return (p: MotionProject): MotionProject => {
    const c = p.comps[compId]; if (!c) return p;
    const n = fn(c); if (n === c) return p;
    return { ...p, comps: { ...p.comps, [compId]: n } };
  };
}
export function updateLayer(compId: string, layerId: string, fn: (l: MLayer) => MLayer) {
  return updateComp(compId, (c) => {
    let changed = false;
    const layers = c.layers.map((l) => { if (l.id !== layerId) return l; const n = fn(l); if (n !== l) changed = true; return n; });
    return changed ? { ...c, layers } : c;
  });
}

// ---------- property paths ----------
// "transform.position", "text.size", "shape.fill", "color", "volume", "zoom",
// "fx:<effectId>.<param>", "mask:<maskId>.<path|feather|opacity|expansion>"
export function getProp(l: MLayer, path: string): Prop | null {
  if (path.startsWith('fx:')) {
    const [id, key] = path.slice(3).split('.');
    return (l.effects.find((e) => e.id === id)?.params[key] as Prop) ?? null;
  }
  if (path.startsWith('mask:')) {
    const [id, key] = path.slice(5).split('.');
    const m = l.masks.find((x) => x.id === id);
    return m ? ((m as unknown as Record<string, Prop>)[key] ?? null) : null;
  }
  let o: unknown = l;
  for (const part of path.split('.')) { if (!o || typeof o !== 'object') return null; o = (o as Record<string, unknown>)[part]; }
  return o && typeof o === 'object' && 'k' in (o as object) && 'v' in (o as object) ? (o as Prop) : null;
}

export function setProp(l: MLayer, path: string, p: Prop): MLayer {
  if (path.startsWith('fx:')) {
    const [id, key] = path.slice(3).split('.');
    return { ...l, effects: l.effects.map((e) => (e.id === id ? { ...e, params: { ...e.params, [key]: p as Prop<never> } } : e)) };
  }
  if (path.startsWith('mask:')) {
    const [id, key] = path.slice(5).split('.');
    return { ...l, masks: l.masks.map((m) => (m.id === id ? { ...m, [key]: p } : m)) };
  }
  const parts = path.split('.');
  const set = (o: Record<string, unknown>, i: number): Record<string, unknown> => ({ ...o, [parts[i]]: i === parts.length - 1 ? p : set(o[parts[i]] as Record<string, unknown>, i + 1) });
  return set(l as unknown as Record<string, unknown>, 0) as unknown as MLayer;
}

/** All animatable property paths of a layer, for keyframe operations. */
export function allPropPaths(l: MLayer): string[] {
  const out = ['transform.anchor', 'transform.position', 'transform.scale', 'transform.rotation', 'transform.rotationX', 'transform.rotationY', 'transform.opacity'];
  if (l.type === 'solid') out.push('color');
  if (l.type === 'video' || l.type === 'audio') out.push('volume');
  if (l.type === 'camera') out.push('zoom');
  if (l.type === 'text') out.push('text.size', 'text.color', 'text.tracking', 'text.leading', 'text.strokeColor', 'text.strokeWidth', 'text.shadowColor', 'text.shadowBlur', 'text.shadowDistance', 'text.animator.progress');
  if (l.type === 'shape') out.push('shape.size', 'shape.roundness', 'shape.innerRadius', 'shape.path', 'shape.fill', 'shape.stroke', 'shape.strokeWidth', 'shape.trimStart', 'shape.trimEnd');
  for (const m of l.masks) out.push(`mask:${m.id}.path`, `mask:${m.id}.feather`, `mask:${m.id}.opacity`, `mask:${m.id}.expansion`);
  for (const e of l.effects) for (const k of Object.keys(e.params)) out.push(`fx:${e.id}.${k}`);
  return out;
}

export function mapLayerProps(l: MLayer, fn: (p: Prop, path: string) => Prop): MLayer {
  let out = l;
  for (const path of allPropPaths(l)) {
    const p = getProp(out, path); if (!p) continue;
    const n = fn(p, path); if (n !== p) out = setProp(out, path, n);
  }
  return out;
}

export type { PropValue };
