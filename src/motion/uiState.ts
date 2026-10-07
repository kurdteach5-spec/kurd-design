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
  dialog: null, leftTab: 'project', rightTab: 'properties', timelineHeight: saved.timelineHeight ?? Math.round(Math.max(200, Math.min(380, window.innerHeight * 0.36))), drawer: null, editingText: null,
  showGrid: false, showSafe: false, showPaths: true, checker: false, lastRender: null,
}));
useMotionUI.subscribe((s, p) => { if (s.timelineHeight !== p.timelineHeight) { try { localStorage.setItem('kurd-motion-ui', JSON.stringify({ timelineHeight: s.timelineHeight })); } catch { /* ignore */ } } });

export const openMotionDialog = (d: MotionDialog) => useMotionUI.setState({ dialog: d });
export const closeMotionDialog = () => useMotionUI.setState({ dialog: null });
