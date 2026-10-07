import { create } from '../state/createStore';

export type MotionDialog =
  | { type: 'comp-settings'; compId: string | null }
  | { type: 'shortcuts' }
  | { type: 'save-preset' }
  | { type: 'rename'; id: string };

export interface MotionUI {
  dialog: MotionDialog | null;
  leftTab: 'project' | 'effects';
  rightTab: 'properties' | 'render';
  timelineHeight: number;
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
  dialog: null, leftTab: 'project', rightTab: 'properties', timelineHeight: saved.timelineHeight ?? 320, editingText: null,
  showGrid: false, showSafe: false, showPaths: true, checker: false, lastRender: null,
}));
useMotionUI.subscribe((s, p) => { if (s.timelineHeight !== p.timelineHeight) { try { localStorage.setItem('kurd-motion-ui', JSON.stringify({ timelineHeight: s.timelineHeight })); } catch { /* ignore */ } } });

export const openMotionDialog = (d: MotionDialog) => useMotionUI.setState({ dialog: d });
export const closeMotionDialog = () => useMotionUI.setState({ dialog: null });
