// Editing operations for the Motion workspace. Every change goes through mcommit (undoable).
import type { Composition, Keyframe, Mask, MLayer, MotionProject, MPath, Prop, PropValue, Vec2, Vec3 } from './types';
import {
  useMotion, mcommit, updateComp, updateLayer, getProp, setProp, mapLayerProps, activeComp, compTime, setTime, sanitizeUi, type KeyRef,
} from './store';
import {
  applyEase, makeKey, removeKeys, setAt, shiftKeys, snapTime, toggleAnimated, toggleKeyAt, valueAt, mapKeys, type EasePreset,
} from './anim';
import {
  newComposition, newSolid, newText, newShape, newNull, newAdjustment, newCamera, newMediaLayer, newPrecompLayer, newEffect, newMask, cloneLayer, rectPathAt, ellipsePath,
} from './factory';
import { importAsset, kindOf, forgetAsset } from './media/assets';
import { worldMatrix } from './render/renderer';
import { invert4, mul, apply4 } from './render/mat4';
import { toast, toastError } from '../state/uiStore';
import { uid } from '../utils/id';

const comp = () => activeComp();
const now = () => compTime();
const cid = () => useMotion.getState().activeCompId;

// ---------- compositions ----------
export function createComposition(o: Partial<Composition> = {}): string {
  const p = useMotion.getState().project;
  const c = newComposition({ name: o.name ?? `Comp ${p.compOrder.length + 1}`, ...o });
  mcommit((pr) => ({ ...pr, comps: { ...pr.comps, [c.id]: c }, compOrder: [...pr.compOrder, c.id] }), 'New Composition');
  openComp(c.id);
  return c.id;
}
export function openComp(id: string) {
  useMotion.setState((s) => ({ activeCompId: id, openComps: s.openComps.includes(id) ? s.openComps : [...s.openComps, id], selectedLayers: [], selectedKeys: [], graphProp: null, playing: false }));
}
export function closeCompTab(id: string) {
  useMotion.setState((s) => {
    const openComps = s.openComps.filter((x) => x !== id);
    return { openComps, activeCompId: s.activeCompId === id ? openComps[openComps.length - 1] ?? null : s.activeCompId, playing: false };
  });
}
export function updateCompSettings(id: string, patch: Partial<Composition>) {
  mcommit((p) => updateComp(id, (c) => {
    const n = { ...c, ...patch };
    if (patch.duration !== undefined) { n.workEnd = Math.min(n.workEnd === c.duration ? n.duration : n.workEnd, n.duration); n.workStart = Math.min(n.workStart, n.workEnd); }
    return n;
  })(p), 'Composition Settings');
}
export function deleteProjectItem(id: string) {
  const p = useMotion.getState().project;
  if (p.comps[id]) {
    const used = Object.values(p.comps).some((c) => c.layers.some((l) => l.type === 'precomp' && l.compId === id));
    mcommit((pr) => {
      const comps = { ...pr.comps }; delete comps[id];
      for (const [k, c] of Object.entries(comps)) if (c.layers.some((l) => l.type === 'precomp' && l.compId === id)) comps[k] = { ...c, layers: c.layers.filter((l) => !(l.type === 'precomp' && l.compId === id)) };
      return { ...pr, comps, compOrder: pr.compOrder.filter((x) => x !== id) };
    }, 'Delete Composition');
    if (used) toast('Layers using that composition were removed too.', 'info');
  } else if (p.assets[id]) {
    mcommit((pr) => {
      const assets = { ...pr.assets }; delete assets[id];
      const comps = { ...pr.comps };
      for (const [k, c] of Object.entries(comps)) if (c.layers.some((l) => 'assetId' in l && l.assetId === id)) comps[k] = { ...c, layers: c.layers.filter((l) => !('assetId' in l && l.assetId === id)) };
      return { ...pr, assets, comps, assetOrder: pr.assetOrder.filter((x) => x !== id) };
    }, 'Delete Footage');
  }
  sanitizeUi();
}
export function renameProjectItem(id: string, name: string) {
  const n = name.trim(); if (!n) return;
  mcommit((p) => p.comps[id] ? { ...p, comps: { ...p.comps, [id]: { ...p.comps[id], name: n } } } : p.assets[id] ? { ...p, assets: { ...p.assets, [id]: { ...p.assets[id], name: n } } } : p, 'Rename');
}

// ---------- import ----------
export async function importFiles(files: File[], addToComp = true): Promise<string[]> {
  const ids: string[] = [];
  for (const f of files) {
    if (!kindOf(f)) { toastError(`Unsupported file: ${f.name}`); continue; }
    try {
      const meta = await importAsset(f, f.name);
      mcommit((p) => ({ ...p, assets: { ...p.assets, [meta.id]: meta }, assetOrder: [...p.assetOrder, meta.id] }), 'Import');
      ids.push(meta.id);
    } catch (e) { toastError((e as Error).message || `Unable to import ${f.name}`); }
  }
  if (!ids.length) return ids;
  let c = comp();
  if (!c && addToComp) {
    // first footage: make a composition that matches it
    const first = ids.map((id) => useMotion.getState().project.assets[id]).find((a) => a.kind !== 'audio');
    createComposition({ name: first?.name.replace(/\.[^.]+$/, '') ?? 'Comp 1', width: first ? first.width : 1920, height: first ? first.height : 1080, duration: Math.max(5, Math.min(600, Math.ceil(Math.max(...ids.map((id) => useMotion.getState().project.assets[id].duration || 0))) || 10)) });
    c = comp();
  }
  if (c && addToComp) for (const id of ids) addAssetLayer(id);
  return ids;
}

// ---------- layers ----------
function insertLayer(l: MLayer, label: string) {
  const c = comp(); if (!c) { toast('Create a composition first.', 'warning'); return; }
  const sel = useMotion.getState().selectedLayers;
  const idx = sel.length ? Math.max(0, Math.min(...sel.map((id) => c.layers.findIndex((x) => x.id === id)).filter((i) => i >= 0))) : 0;
  mcommit(updateComp(c.id, (cc) => ({ ...cc, layers: [...cc.layers.slice(0, idx), l, ...cc.layers.slice(idx)] })), label);
  useMotion.setState({ selectedLayers: [l.id], selectedKeys: [] });
}
export function addSolid(color = '#4f8cff') { const c = comp(); if (c) insertLayer(newSolid(c, color, now(), c.width, c.height, `Solid ${c.layers.filter((l) => l.type === 'solid').length + 1}`), 'New Solid'); }
export function addText(text = 'Your text', position?: Vec3) { const c = comp(); if (c) { const l = newText(c, text, now(), { position }); insertLayer(l, 'New Text Layer'); return l.id; } return null; }
export function addShape(kind: Parameters<typeof newShape>[1], o?: Parameters<typeof newShape>[3]) { const c = comp(); if (c) { const l = newShape(c, kind, now(), o); insertLayer(l, 'New Shape Layer'); return l.id; } return null; }
export function addNull() { const c = comp(); if (c) insertLayer(newNull(c, now()), 'New Null Object'); }
export function addAdjustment() { const c = comp(); if (c) insertLayer(newAdjustment(c, now()), 'New Adjustment Layer'); }
export function addCamera(mode: '2d' | '3d' = '3d') { const c = comp(); if (c) insertLayer(newCamera(c, mode, now()), 'New Camera'); }
export function addAssetLayer(assetId: string, t = now()) {
  const c = comp(); const a = useMotion.getState().project.assets[assetId];
  if (c && a) insertLayer(newMediaLayer(c, a, t), 'Add Footage');
}
export function addCompLayer(compId: string, t = now()) {
  const c = comp(); const sub = useMotion.getState().project.comps[compId];
  if (!c || !sub) return;
  if (compId === c.id || dependsOn(useMotion.getState().project, compId, c.id)) { toast('A composition can’t contain itself.', 'warning'); return; }
  insertLayer(newPrecompLayer(c, sub, t), 'Add Composition');
}
function dependsOn(p: MotionProject, compId: string, target: string, seen = new Set<string>()): boolean {
  if (seen.has(compId)) return false; seen.add(compId);
  const c = p.comps[compId]; if (!c) return false;
  return c.layers.some((l) => l.type === 'precomp' && (l.compId === target || dependsOn(p, l.compId, target, seen)));
}

export function selectLayers(ids: string[], additive = false) {
  useMotion.setState((s) => ({ selectedLayers: additive ? [...new Set([...s.selectedLayers, ...ids])] : ids, selectedKeys: additive ? s.selectedKeys : [] }));
}
export const selectedLayerObjs = (): MLayer[] => { const c = comp(); const s = useMotion.getState().selectedLayers; return c ? c.layers.filter((l) => s.includes(l.id)) : []; };

export function setLayer(id: string, patch: Partial<MLayer>, label = 'Layer Change', mergeKey?: string) {
  const c = cid(); if (!c) return;
  mcommit(updateLayer(c, id, (l) => ({ ...l, ...patch } as MLayer)), label, mergeKey);
}
export function setLayers(ids: string[], patch: (l: MLayer) => Partial<MLayer>, label: string) {
  const c = cid(); if (!c) return;
  mcommit(updateComp(c, (cc) => ({ ...cc, layers: cc.layers.map((l) => (ids.includes(l.id) ? { ...l, ...patch(l) } as MLayer : l)) })), label);
}

export function deleteLayers(ids = useMotion.getState().selectedLayers) {
  const c = comp(); if (!c || !ids.length) return;
  if (c.layers.some((l) => ids.includes(l.id) && l.locked)) { toast('Locked layers cannot be deleted.', 'warning'); return; }
  mcommit(updateComp(c.id, (cc) => ({ ...cc, layers: cc.layers.filter((l) => !ids.includes(l.id)).map((l) => (l.parentId && ids.includes(l.parentId) ? reparentKeepWorld(cc, l, null) : l)) })), ids.length > 1 ? 'Delete Layers' : 'Delete Layer');
  useMotion.setState({ selectedLayers: [], selectedKeys: [] });
}

export function duplicateLayers(ids = useMotion.getState().selectedLayers) {
  const c = comp(); if (!c || !ids.length) return;
  const newIds: string[] = [];
  mcommit(updateComp(c.id, (cc) => {
    const layers: MLayer[] = [];
    for (const l of cc.layers) { if (ids.includes(l.id)) { const d = cloneLayer(l, `${l.name} copy`); newIds.push(d.id); layers.push(d); } layers.push(l); }
    return { ...cc, layers };
  }), 'Duplicate Layer');
  useMotion.setState({ selectedLayers: newIds, selectedKeys: [] });
}

/** Split selected layers at the current time (Ctrl/Cmd+Shift+D). */
export function splitLayers(ids = useMotion.getState().selectedLayers) {
  const c = comp(); if (!c) return;
  const t = now();
  const targets = c.layers.filter((l) => ids.includes(l.id) && t > l.inPoint && t < l.outPoint);
  if (!targets.length) { toast('Move the time indicator inside the selected layer to split it.', 'info'); return; }
  const newIds: string[] = [];
  mcommit(updateComp(c.id, (cc) => {
    const layers: MLayer[] = [];
    for (const l of cc.layers) {
      if (targets.some((x) => x.id === l.id)) {
        const second = { ...cloneLayer(l, l.name), inPoint: t } as MLayer; newIds.push(second.id);
        layers.push(second, { ...l, outPoint: t } as MLayer);
      } else layers.push(l);
    }
    return { ...cc, layers };
  }), 'Split Layer');
  useMotion.setState({ selectedLayers: newIds });
}

/** Trim: set in/out points (clamped to the source length for footage). */
export function trimLayer(id: string, inPoint: number | null, outPoint: number | null, label = 'Trim Layer', mergeKey?: string) {
  const c = comp(); if (!c) return;
  const p = useMotion.getState().project;
  mcommit(updateLayer(c.id, id, (l) => {
    let a = inPoint ?? l.inPoint, b = outPoint ?? l.outPoint;
    const fr = 1 / c.fps;
    if ((l.type === 'video' || l.type === 'audio' || l.type === 'precomp')) {
      const len = l.type === 'precomp' ? p.comps[l.compId]?.duration ?? Infinity : p.assets[l.assetId]?.duration ?? Infinity;
      a = Math.max(a, l.start); b = Math.min(b, l.start + len / l.speed);
    }
    a = snapTime(Math.max(0, a), c.fps); b = snapTime(Math.min(c.duration, b), c.fps);
    if (b - a < fr) { if (inPoint !== null) a = b - fr; else b = a + fr; }
    return { ...l, inPoint: a, outPoint: b };
  }), label, mergeKey);
}
export function trimToCTI(edge: 'in' | 'out') {
  const t = now();
  for (const id of useMotion.getState().selectedLayers) trimLayer(id, edge === 'in' ? t : null, edge === 'out' ? t : null, edge === 'in' ? 'Trim In Point' : 'Trim Out Point');
}

/** Moves layers in time (bars and their keyframes). */
export function shiftLayersTime(ids: string[], dt: number, mergeKey?: string) {
  const c = comp(); if (!c || !dt) return;
  const d = snapTime(dt, c.fps); if (!d) return;
  mcommit(updateComp(c.id, (cc) => ({
    ...cc,
    layers: cc.layers.map((l) => {
      if (!ids.includes(l.id) || l.locked) return l;
      const moved = { ...l, inPoint: l.inPoint + d, outPoint: l.outPoint + d, start: l.start + d } as MLayer;
      return mapLayerProps(moved, (p) => (p.k.length ? { ...p, k: p.k.map((k) => ({ ...k, t: k.t + d })) } : p));
    }),
  })), 'Move Layer in Time', mergeKey);
}

export function reorderLayers(ids: string[], toIndex: number) {
  const c = comp(); if (!c) return;
  mcommit(updateComp(c.id, (cc) => {
    const moving = cc.layers.filter((l) => ids.includes(l.id));
    const rest = cc.layers.filter((l) => !ids.includes(l.id));
    const before = cc.layers.slice(0, toIndex).filter((l) => !ids.includes(l.id)).length;
    return { ...cc, layers: [...rest.slice(0, before), ...moving, ...rest.slice(before)] };
  }), 'Reorder Layers');
}
export function arrange(dir: 'up' | 'down' | 'top' | 'bottom') {
  const c = comp(); const ids = useMotion.getState().selectedLayers; if (!c || !ids.length) return;
  const first = c.layers.findIndex((l) => ids.includes(l.id));
  const idx = dir === 'top' ? 0 : dir === 'bottom' ? c.layers.length : dir === 'up' ? Math.max(0, first - 1) : first + ids.length + 1;
  reorderLayers(ids, idx);
}

// ---------- parenting ----------
function reparentKeepWorld(c: Composition, l: MLayer, parentId: string | null): MLayer {
  const t = compTime(useMotion.getState(), c.id);
  const wasWorld = worldMatrix(c, l, t);
  const next = { ...l, parentId } as MLayer;
  const tr = l.transform;
  if (tr.position.k.length || tr.rotation.k.length || tr.scale.k.length || l.threeD) return next;
  let parentWorld = null;
  if (parentId) { const p = c.layers.find((x) => x.id === parentId); if (p) parentWorld = worldMatrix(c, p, t); }
  const local = parentWorld ? mul(invert4(parentWorld), wasWorld) : wasWorld;
  const a = tr.anchor.v;
  const pos = apply4(local, a[0], a[1], a[2]);
  const sx = Math.hypot(local[0], local[1]) * 100, sy = Math.hypot(local[4], local[5]) * 100 * Math.sign(local[0] * local[5] - local[1] * local[4] || 1);
  const rot = (Math.atan2(local[1], local[0]) * 180) / Math.PI;
  return { ...next, transform: { ...tr, position: { ...tr.position, v: [pos[0], pos[1], tr.position.v[2]] }, rotation: { ...tr.rotation, v: rot }, scale: { ...tr.scale, v: [sx, sy, tr.scale.v[2]] } } };
}
export function setParent(childId: string, parentId: string | null) {
  const c = comp(); if (!c) return;
  if (parentId) {
    // no cycles
    let p: string | null = parentId;
    while (p) { if (p === childId) { toast('A layer can’t be parented to its own child.', 'warning'); return; } p = c.layers.find((x) => x.id === p)?.parentId ?? null; }
  }
  mcommit(updateLayer(c.id, childId, (l) => reparentKeepWorld(c, l, parentId)), parentId ? 'Set Parent' : 'Remove Parent');
}

// ---------- precompose ----------
export function precompose(ids = useMotion.getState().selectedLayers, name?: string) {
  const c = comp(); if (!c || !ids.length) { toast('Select layers to precompose.', 'warning'); return; }
  const members = c.layers.filter((l) => ids.includes(l.id));
  const sub = newComposition({ name: name ?? `${members[0].name} Comp`, width: c.width, height: c.height, fps: c.fps, duration: c.duration, background: c.background, motionBlur: c.motionBlur });
  sub.layers = members.map((l) => (l.parentId && !ids.includes(l.parentId) ? { ...l, parentId: null } : l));
  const layer = newPrecompLayer(c, sub, 0);
  const firstIdx = c.layers.findIndex((l) => ids.includes(l.id));
  mcommit((p) => {
    const pr = { ...p, comps: { ...p.comps, [sub.id]: sub }, compOrder: [...p.compOrder, sub.id] };
    return updateComp(c.id, (cc) => {
      const rest = cc.layers.filter((l) => !ids.includes(l.id)).map((l) => (l.parentId && ids.includes(l.parentId) ? { ...l, parentId: null } : l));
      rest.splice(Math.min(firstIdx, rest.length), 0, layer);
      return { ...cc, layers: rest };
    })(pr);
  }, 'Pre-compose');
  useMotion.setState({ selectedLayers: [layer.id], selectedKeys: [] });
}

// ---------- properties & keyframes ----------
/** Values that Auto-Keyframe records (numbers, vectors, colors — not paths or text). */
const autoKeyable = (v: PropValue) => typeof v === 'number' || (Array.isArray(v) && v.every((x) => typeof x === 'number')) || (typeof v === 'string' && /^(#|rgb|hsl)/i.test(v));
/**
 * Sets a property at time t. Animated properties get a keyframe at t (new or updated).
 * With Auto-Keyframe on, a still property starts animating: a keyframe keeps the old value at the
 * layer's start and a new keyframe holds the new value at t, so the change animates right away.
 */
function writeAt(l: MLayer, p: Prop<PropValue>, t: number, v: PropValue, fps: number, auto = true): Prop<PropValue> {
  if (p.k.length || !auto || !useMotion.getState().autoKey || !autoKeyable(v) || JSON.stringify(v) === JSON.stringify(p.v)) return setAt(p, t, v, fps);
  const start = Math.max(0, l.inPoint);
  if (t - start < 0.5 / fps) return { v: p.v, k: [makeKey(t, v)] };
  return { v: p.v, k: [makeKey(snapTime(start, fps), p.v), makeKey(t, v)] };
}
export function setPropValue(layerId: string, path: string, v: PropValue, mergeKey?: string, label = 'Change Property', auto = true) {
  const c = comp(); if (!c) return;
  const t = now();
  mcommit(updateLayer(c.id, layerId, (l) => { const p = getProp(l, path); return p ? setProp(l, path, writeAt(l, p as Prop<PropValue>, t, v, c.fps, auto)) : l; }), label, mergeKey ?? `${layerId}:${path}`);
}
/** Apply the same value change to several selected layers (e.g. dragging a field with many layers selected). */
export function setPropForLayers(ids: string[], path: string, fn: (p: Prop) => PropValue, label = 'Change Property', mergeKey?: string) {
  const c = comp(); if (!c) return; const t = now();
  mcommit(updateComp(c.id, (cc) => ({ ...cc, layers: cc.layers.map((l) => { if (!ids.includes(l.id)) return l; const p = getProp(l, path); return p ? setProp(l, path, writeAt(l, p as Prop<PropValue>, t, fn(p), c.fps)) : l; }) })), label, mergeKey);
}
export function toggleStopwatch(layerId: string, path: string) {
  const c = comp(); if (!c) return; const t = now();
  mcommit(updateLayer(c.id, layerId, (l) => { const p = getProp(l, path); return p ? setProp(l, path, toggleAnimated(p, t)) : l; }), 'Toggle Animation');
}
export function toggleKeyframe(layerId: string, path: string) {
  const c = comp(); if (!c) return; const t = now();
  mcommit(updateLayer(c.id, layerId, (l) => { const p = getProp(l, path); return p ? setProp(l, path, toggleKeyAt(p, t, c.fps)) : l; }), 'Add/Remove Keyframe');
}

/** Groups key refs by layer → path. */
function groupKeys(refs: KeyRef[]) {
  const m = new Map<string, Map<string, Set<string>>>();
  for (const r of refs) {
    if (!m.has(r.layerId)) m.set(r.layerId, new Map());
    const pm = m.get(r.layerId)!; if (!pm.has(r.path)) pm.set(r.path, new Set());
    pm.get(r.path)!.add(r.keyId);
  }
  return m;
}
function editKeys(refs: KeyRef[], fn: (p: Prop, ids: Set<string>) => Prop, label: string, mergeKey?: string) {
  const c = comp(); if (!c || !refs.length) return;
  const g = groupKeys(refs);
  mcommit(updateComp(c.id, (cc) => ({
    ...cc, layers: cc.layers.map((l) => {
      const pm = g.get(l.id); if (!pm) return l;
      let out = l;
      for (const [path, ids] of pm) { const p = getProp(out, path); if (p) out = setProp(out, path, fn(p, ids)); }
      return out;
    }),
  })), label, mergeKey);
}
export function deleteSelectedKeys() {
  const s = useMotion.getState(); if (!s.selectedKeys.length) return false;
  editKeys(s.selectedKeys, (p, ids) => removeKeys(p, ids, now()), 'Delete Keyframes');
  useMotion.setState({ selectedKeys: [] });
  return true;
}
export function moveSelectedKeys(dt: number, mergeKey?: string) {
  const c = comp(); const s = useMotion.getState(); if (!c || !s.selectedKeys.length) return;
  editKeys(s.selectedKeys, (p, ids) => shiftKeys(p, ids, dt, c.fps), 'Move Keyframes', mergeKey);
}
export function easeSelectedKeys(preset: EasePreset) {
  const s = useMotion.getState(); if (!s.selectedKeys.length) { toast('Select keyframes first.', 'info'); return; }
  editKeys(s.selectedKeys, (p, ids) => mapKeys(p, ids, (k) => applyEase(k, preset)), preset === 'hold' ? 'Toggle Hold Keyframe' : preset === 'linear' ? 'Linear Keyframe' : 'Easy Ease');
}
export function setKeyHandles(layerId: string, path: string, keyId: string, patch: Partial<Pick<Keyframe, 'in' | 'out' | 'so' | 'si' | 'interp' | 'v' | 't'>>, label = 'Edit Keyframe', mergeKey?: string) {
  const c = comp(); if (!c) return;
  mcommit(updateLayer(c.id, layerId, (l) => {
    const p = getProp(l, path); if (!p) return l;
    const k = p.k.map((x) => (x.id === keyId ? { ...x, ...patch } as Keyframe : x)).sort((a, b) => a.t - b.t);
    return setProp(l, path, { ...p, k });
  }), label, mergeKey);
}

// keyframe clipboard
let keyClipboard: { path: string; keys: Keyframe[] }[] | null = null;
export function copySelectedKeys() {
  const c = comp(); const s = useMotion.getState(); if (!c || !s.selectedKeys.length) return false;
  const g = groupKeys(s.selectedKeys);
  const out: { path: string; keys: Keyframe[] }[] = [];
  let t0 = Infinity;
  for (const [layerId, pm] of g) {
    const l = c.layers.find((x) => x.id === layerId); if (!l) continue;
    for (const [path, ids] of pm) { const p = getProp(l, path); if (!p) continue; const keys = p.k.filter((k) => ids.has(k.id)); keys.forEach((k) => (t0 = Math.min(t0, k.t))); out.push({ path, keys }); }
  }
  keyClipboard = out.map((e) => ({ path: e.path, keys: e.keys.map((k) => ({ ...k, t: k.t - t0 })) }));
  toast(`${s.selectedKeys.length} keyframes copied`, 'success', 1800);
  return true;
}
export function pasteKeys() {
  const c = comp(); const s = useMotion.getState(); if (!c || !keyClipboard) return false;
  const target = s.selectedLayers[0]; if (!target) { toast('Select a layer to paste keyframes into.', 'info'); return true; }
  const t = now(); const refs: KeyRef[] = [];
  mcommit(updateLayer(c.id, target, (l) => {
    let out = l;
    for (const e of keyClipboard!) {
      const p = getProp(out, e.path); if (!p) continue;
      let np: Prop = p.k.length ? p : { ...p, k: [] };
      for (const k of e.keys) {
        const nk = { ...k, id: uid('k'), t: snapTime(t + k.t, c.fps) };
        np = { ...np, k: [...np.k.filter((x) => Math.abs(x.t - nk.t) > 0.5 / c.fps), nk].sort((a, b) => a.t - b.t) };
        refs.push({ layerId: target, path: e.path, keyId: nk.id });
      }
      out = setProp(out, e.path, np);
    }
    return out;
  }), 'Paste Keyframes');
  useMotion.setState({ selectedKeys: refs });
  return true;
}
export function duplicateSelectedKeys() { if (copySelectedKeys()) { const c = comp(); if (c) { setTime(now() + 10 / c.fps); pasteKeys(); } } }

/** Smooth (auto-bezier) motion path through the position keyframes. */
export function smoothMotionPath(layerId: string) {
  const c = comp(); if (!c) return;
  mcommit(updateLayer(c.id, layerId, (l) => {
    const p = l.transform.position; if (p.k.length < 2) return l;
    const k = p.k.map((key, i, arr) => {
      const prev = arr[i - 1]?.v ?? key.v, next = arr[i + 1]?.v ?? key.v;
      const tx = (next[0] - prev[0]) / 6, ty = (next[1] - prev[1]) / 6;
      return { ...key, so: [tx, ty] as Vec2, si: [-tx, -ty] as Vec2 };
    });
    return { ...l, transform: { ...l.transform, position: { ...p, k } } };
  }), 'Auto-Bezier Motion Path');
}
export function straightenMotionPath(layerId: string) {
  const c = comp(); if (!c) return;
  mcommit(updateLayer(c.id, layerId, (l) => ({ ...l, transform: { ...l.transform, position: { ...l.transform.position, k: l.transform.position.k.map((k) => ({ ...k, so: undefined, si: undefined })) } } })), 'Linear Motion Path');
}

// ---------- effects ----------
export function addEffect(type: string, ids = useMotion.getState().selectedLayers) {
  const c = comp(); if (!c) return;
  if (!ids.length) { toast('Select a layer to apply the effect to.', 'info'); return; }
  mcommit(updateComp(c.id, (cc) => ({ ...cc, layers: cc.layers.map((l) => { if (!ids.includes(l.id)) return l; const e = newEffect(type); return e ? { ...l, effects: [...l.effects, e] } : l; }) })), 'Add Effect');
  useMotion.setState((s) => ({ timeline: { ...s.timeline, expanded: { ...s.timeline.expanded, ...Object.fromEntries(ids.map((id) => [`${id}:effects`, true])) } } }));
}
export function removeEffect(layerId: string, effectId: string) {
  const c = cid(); if (c) mcommit(updateLayer(c, layerId, (l) => ({ ...l, effects: l.effects.filter((e) => e.id !== effectId) })), 'Remove Effect');
}
export function toggleEffect(layerId: string, effectId: string) {
  const c = cid(); if (c) mcommit(updateLayer(c, layerId, (l) => ({ ...l, effects: l.effects.map((e) => (e.id === effectId ? { ...e, enabled: !e.enabled } : e)) })), 'Toggle Effect');
}
export function moveEffect(layerId: string, effectId: string, dir: -1 | 1) {
  const c = cid(); if (!c) return;
  mcommit(updateLayer(c, layerId, (l) => {
    const i = l.effects.findIndex((e) => e.id === effectId); const j = i + dir;
    if (i < 0 || j < 0 || j >= l.effects.length) return l;
    const effects = [...l.effects]; [effects[i], effects[j]] = [effects[j], effects[i]];
    return { ...l, effects };
  }), 'Reorder Effects');
}
export function duplicateEffect(layerId: string, effectId: string) {
  const c = cid(); if (!c) return;
  mcommit(updateLayer(c, layerId, (l) => {
    const i = l.effects.findIndex((e) => e.id === effectId); if (i < 0) return l;
    const copy = JSON.parse(JSON.stringify(l.effects[i])); copy.id = uid('fx');
    return { ...l, effects: [...l.effects.slice(0, i + 1), copy, ...l.effects.slice(i + 1)] };
  }), 'Duplicate Effect');
}

// ---------- masks ----------
export function addMask(layerId: string, path: MPath) {
  const c = cid(); if (!c) return;
  let id = '';
  mcommit(updateLayer(c, layerId, (l) => { const m = newMask(path, `Mask ${l.masks.length + 1}`); id = m.id; return { ...l, masks: [...l.masks, m] }; }), 'New Mask');
  useMotion.setState((s) => ({ timeline: { ...s.timeline, expanded: { ...s.timeline.expanded, [`${layerId}:masks`]: true, [layerId]: true } } }));
  return id;
}
export function addMaskShape(layerId: string, shape: 'rect' | 'ellipse', b: { x: number; y: number; w: number; h: number }) {
  return addMask(layerId, shape === 'rect' ? rectPathAt(b.x, b.y, b.w, b.h) : ellipsePath(b.w, b.h, b.x + b.w / 2, b.y + b.h / 2));
}
export function updateMask(layerId: string, maskId: string, patch: Partial<Mask>, label = 'Mask Change') {
  const c = cid(); if (c) mcommit(updateLayer(c, layerId, (l) => ({ ...l, masks: l.masks.map((m) => (m.id === maskId ? { ...m, ...patch } : m)) })), label);
}
export function removeMask(layerId: string, maskId: string) {
  const c = cid(); if (c) mcommit(updateLayer(c, layerId, (l) => ({ ...l, masks: l.masks.filter((m) => m.id !== maskId) })), 'Delete Mask');
}

// ---------- markers & work area ----------
export function addMarker(label = '') {
  const c = comp(); if (!c) return;
  const t = now();
  mcommit(updateComp(c.id, (cc) => ({ ...cc, markers: [...cc.markers.filter((m) => Math.abs(m.t - t) > 0.5 / cc.fps), { id: uid('mk'), t, label }].sort((a, b) => a.t - b.t) })), 'Add Marker');
}
export function updateMarker(id: string, patch: { t?: number; label?: string }, mergeKey?: string) {
  const c = comp(); if (!c) return;
  mcommit(updateComp(c.id, (cc) => ({ ...cc, markers: cc.markers.map((m) => (m.id === id ? { ...m, ...patch, t: patch.t !== undefined ? snapTime(Math.max(0, Math.min(cc.duration, patch.t)), cc.fps) : m.t } : m)) })), 'Move Marker', mergeKey);
}
export function removeMarker(id: string) {
  const c = comp(); if (c) mcommit(updateComp(c.id, (cc) => ({ ...cc, markers: cc.markers.filter((m) => m.id !== id) })), 'Delete Marker');
}
export function setWorkArea(start: number | null, end: number | null, mergeKey?: string) {
  const c = comp(); if (!c) return;
  mcommit(updateComp(c.id, (cc) => {
    let a = start ?? cc.workStart, b = end ?? cc.workEnd;
    a = snapTime(Math.max(0, Math.min(a, cc.duration)), cc.fps); b = snapTime(Math.max(0, Math.min(b, cc.duration)), cc.fps);
    if (b - a < 1 / cc.fps) { if (start !== null) a = b - 1 / cc.fps; else b = a + 1 / cc.fps; }
    return { ...cc, workStart: a, workEnd: b };
  }), 'Work Area', mergeKey);
}

// ---------- navigation ----------
export function stepFrames(n: number) { const c = comp(); if (c) setTime(now() + n / c.fps); }
export function goToStart() { setTime(0); }
export function goToEnd() { const c = comp(); if (c) setTime(c.duration); }
/** Jump to the previous/next keyframe of the selected layers (J / K). */
export function jumpKey(dir: 1 | -1) {
  const c = comp(); const s = useMotion.getState(); if (!c) return;
  const t = now(); const times: number[] = [];
  const layers = s.selectedLayers.length ? c.layers.filter((l) => s.selectedLayers.includes(l.id)) : c.layers;
  for (const l of layers) mapLayerProps(l, (p) => { p.k.forEach((k) => times.push(k.t)); return p; });
  c.markers.forEach((m) => times.push(m.t));
  const cand = dir > 0 ? times.filter((x) => x > t + 1e-6).sort((a, b) => a - b)[0] : times.filter((x) => x < t - 1e-6).sort((a, b) => b - a)[0];
  if (cand !== undefined) setTime(cand);
}

/** Every keyframe of a layer (for "U" reveal / select all keys). */
export function selectAllKeys(layerIds = useMotion.getState().selectedLayers) {
  const c = comp(); if (!c) return;
  const refs: KeyRef[] = [];
  for (const l of c.layers) if (layerIds.includes(l.id)) mapLayerProps(l, (p, path) => { p.k.forEach((k) => refs.push({ layerId: l.id, path, keyId: k.id })); return p; });
  useMotion.setState({ selectedKeys: refs });
}

export { makeKey, valueAt };
export const forget = forgetAsset;
