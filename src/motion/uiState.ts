import { create } from '../state/createStore';

export type MotionDialog =
  | { type: 'comp-settings'; compId: string | null }
  | { type: 'shortcuts' }
  | { type: 'save-preset' }
  | { type: 'rename'; id: string }
  | { type: 'import-report'; name: string; summary: string; missing: string[]; skipped: string[] };

export type RightPanel = 'info' | 'preview' | 'effects' | 'align' | 'properties';
export type AeWorkspace = 'default' | 'animation' | 'effects' | 'minimal';
export const WORKSPACE_PANELS: Record<AeWorkspace, Record<RightPanel, boolean>> = {
  default: { info: true, preview: true, effects: true, align: false, properties: true },
  animation: { info: false, preview: true, effects: false, align: true, properties: true },
  effects: { info: false, preview: true, effects: true, align: false, properties: false },
  minimal: { info: false, preview: false, effects: false, align: false, properties: false },
};

export interface MotionUI {
  dialog: MotionDialog | null;
  leftTab: 'project' | 'effectControls';
  /** panels of the right-hand column (stacked like After Effects); which are open */
  rightOpen: Record<RightPanel, boolean>;
  /** the bottom panel group: the Timeline or the Render Queue */
  bottomTab: 'timeline' | 'render';
  /** After Effects-style workspace (panel layout) */
  aeWorkspace: AeWorkspace;
  /** timeline columns: layer switches or Mode / Track Matte (F4) */
  modesColumn: boolean;
  timelineHeight: number;
  /** on narrow screens, the side panel shown over the viewer */
  drawer: 'left' | 'right' | null;
  /** text layer being edited on the canvas */
  editingText: string | null;
  showGrid: boolean;
  showSafe: boolean;
  showPaths: boolean;
  checker: boolean;
  /** last render output, kept so it can be downloaded again */
  lastRender: { blob: Blob; name: string } | null;
}

const saved = (() => { try { return JSON.parse(localStorage.getItem('kurd-motion-ui') || '{}') as Partial<MotionUI>; } catch { return {}; } })();

export const useMotionUI = create<MotionUI>(() => ({
  dialog: null, leftTab: 'project', rightOpen: saved.rightOpen ?? WORKSPACE_PANELS[saved.aeWorkspace ?? 'default'], bottomTab: 'timeline', aeWorkspace: saved.aeWorkspace ?? 'default', modesColumn: saved.modesColumn ?? false, timelineHeight: saved.timelineHeight ?? Math.round(Math.max(200, Math.min(380, window.innerHeight * 0.36))), drawer: null, editingText: null,
  showGrid: false, showSafe: false, showPaths: true, checker: false, lastRender: null,
}));
useMotionUI.subscribe((s, p) => {
  if (s.timelineHeight === p.timelineHeight && s.rightOpen === p.rightOpen && s.aeWorkspace === p.aeWorkspace && s.modesColumn === p.modesColumn) return;
  try { localStorage.setItem('kurd-motion-ui', JSON.stringify({ timelineHeight: s.timelineHeight, rightOpen: s.rightOpen, aeWorkspace: s.aeWorkspace, modesColumn: s.modesColumn })); } catch { /* ignore */ }
});

/** switch to an After Effects-style workspace: which panels show and how */
export function setAeWorkspace(w: AeWorkspace) {
  useMotionUI.setState({ aeWorkspace: w, rightOpen: WORKSPACE_PANELS[w], leftTab: w === 'effects' ? 'effectControls' : 'project' });
  if (w === 'animation') void import('./store').then((m) => m.useMotion.setState((s) => ({ timeline: { ...s.timeline, graph: true } })));
  else void import('./store').then((m) => m.useMotion.setState((s) => ({ timeline: { ...s.timeline, graph: false } })));
}

/** what is under the pointer in the composition viewer (Info panel) */
export const useViewerInfo = create<{ x: number | null; y: number | null; rgba: [number, number, number, number] | null }>(() => ({ x: null, y: null, rgba: null }));

export const openMotionDialog = (d: MotionDialog) => useMotionUI.setState({ dialog: d });
export const closeMotionDialog = () => useMotionUI.setState({ dialog: null });
