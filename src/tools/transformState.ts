import { create } from '../state/createStore';
import { TransformSession, warpToQuad, type TransformMode } from './transformSession';
import { getEngine } from '../canvas/engine';
import { commit, getDocState } from '../state/documentStore';
import { setTool, useTools } from '../state/toolStore';
import { toast } from '../state/uiStore';
import { createCanvas, ctx2d } from '../utils/canvas';
import { makeSelection } from '../canvas/selection';
import { createRasterLayer } from '../layers/factory';
import { IDENTITY, rectCorners, type Matrix } from '../utils/math';
import { findLayer } from '../layers/tree';

export interface TransformStoreState {
  /** Active Free Transform session (persistent until commit/cancel). */
  session: TransformSession | null;
  target: 'layers' | 'selection';
  /** Bumped when the session changes so the options bar re-reads numbers. */
  version: number;
}
export const useTransform = create<TransformStoreState>(() => ({ session: null, target: 'layers', version: 0 }));
export const bumpTransform = () => useTransform.setState((s) => ({ version: s.version + 1 }));

export function transformTargetIds(): string[] {
  const s = getDocState(); if (!s) return [];
  const ids = s.selectedLayerIds.length > 1 ? s.selectedLayerIds : s.activeLayerId ? [s.activeLayerId] : [];
  return ids.filter((id) => { const l = findLayer(s.layers, id); return l && l.type !== 'adjustment' && !l.locked; });
}

export function startFreeTransform(mode: TransformMode = 'free') {
  const s = getDocState(); if (!s) return;
  const existing = useTransform.getState().session;
  if (existing) { existing.mode = mode; bumpTransform(); getEngine()?.invalidateView(); return; }
  const ids = transformTargetIds();
  if (!ids.length) { toast('Select an unlocked layer to transform.', 'warning'); return; }
  const session = TransformSession.create(s, ids);
  if (!session) { toast('The selected layer is empty.', 'warning'); return; }
  session.mode = mode;
  if (useTools.getState().tool !== 'move') setTool('move');
  useTransform.setState({ session, target: 'layers', version: 0 });
  getEngine()?.invalidateView();
}

export function startTransformSelection() {
  const s = getDocState(); if (!s?.selection) { toast('Make a selection first.', 'warning'); return; }
  const fake = { ...createRasterLayer('__selection', s.selection.mask), id: '__selection' };
  const session = TransformSession.fromCorners(['__selection'], [fake], rectCorners(s.selection.bounds));
  if (useTools.getState().tool !== 'move') setTool('move');
  useTransform.setState({ session, target: 'selection', version: 0 });
  getEngine()?.invalidateView();
}

export function commitTransform() {
  const { session, target } = useTransform.getState();
  if (!session) return;
  const engine = getEngine();
  if (target === 'selection') {
    const s = getDocState();
    if (s?.selection && session.changed) {
      let mask: HTMLCanvasElement;
      if (session.isAffine) {
        const D: Matrix = session.delta();
        mask = createCanvas(s.width, s.height); const x = ctx2d(mask); x.setTransform(D.a, D.b, D.c, D.d, D.e, D.f); x.drawImage(s.selection.mask, 0, 0);
      } else {
        const w = warpToQuad(s.selection.mask, s.selection.bounds, session.corners, s.width, s.height);
        mask = createCanvas(s.width, s.height); ctx2d(mask).drawImage(w.canvas, w.x, w.y);
      }
      commit((st) => ({ ...st, selection: makeSelection(mask) }), { history: 'Transform Selection' });
    }
  } else session.commit();
  useTransform.setState({ session: null, version: 0 });
  engine?.clearOverride();
}

export function cancelTransform() {
  if (!useTransform.getState().session) return;
  useTransform.setState({ session: null, version: 0 });
  getEngine()?.clearOverride();
}

export function isTransforming() { return !!useTransform.getState().session; }

export const IDENTITY_M = IDENTITY;
