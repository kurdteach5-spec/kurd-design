import { create } from './createStore';
import { uid } from '../utils/id';

export type PanelId = 'layers' | 'properties' | 'color' | 'swatches' | 'history' | 'adjustments' | 'brush' | 'character' | 'paragraph';
export interface PanelGroup { id: string; tabs: PanelId[]; active: PanelId; collapsed: boolean; height?: number }

export type DialogDescriptor =
  | { type: 'new-document' }
  | { type: 'image-size' }
  | { type: 'canvas-size' }
  | { type: 'export' }
  | { type: 'filter'; filter: string }
  | { type: 'adjustment'; kind: string }
  | { type: 'smart-filter'; layerId: string; filter?: string; kind?: string; index?: number }
  | { type: 'layer-style'; layerId: string; tab?: string }
  | { type: 'selection-modify'; op: 'feather' | 'expand' | 'contract' | 'border' }
  | { type: 'grid-settings' }
  | { type: 'shortcuts' }
  | { type: 'about' }
  | { type: 'recover' }
  | { type: 'projects' }
  | { type: 'save-as' }
  | { type: 'confirm-close'; docId: string }
  | { type: 'rename-layer'; layerId: string }
  | { type: 'confirm-rasterize'; layerId: string; next?: DialogDescriptor }
  | { type: 'color-picker'; target: 'foreground' | 'background' }
  | { type: 'new-guide' };

export interface Toast { id: string; kind: 'info' | 'success' | 'error' | 'warning'; message: string }
export interface Busy { label: string; progress: number | null }

export interface UIState {
  groups: PanelGroup[];
  hiddenPanels: PanelId[];
  sidebarWidth: number;
  sidebarMode: 'docked' | 'rail';
  floatingGroup: string | null; // in rail mode, which group is open
  showRulers: boolean;
  showGrid: boolean;
  showGuides: boolean;
  showPixelGrid: boolean;
  snap: boolean;
  showSelectionEdges: boolean;
  gridSize: number;
  gridColor: string;
  dialog: DialogDescriptor | null;
  toasts: Toast[];
  busy: Busy | null;
  dropActive: boolean;
  showHome: boolean;
}

const DEFAULT_GROUPS: PanelGroup[] = [
  { id: 'g-color', tabs: ['color', 'swatches'], active: 'color', collapsed: typeof window !== 'undefined' && window.innerHeight < 1000 },
  { id: 'g-props', tabs: ['properties', 'adjustments', 'brush', 'character', 'paragraph'], active: 'properties', collapsed: false },
  { id: 'g-layers', tabs: ['layers', 'history'], active: 'layers', collapsed: false },
];

const KEY = 'designpro.ui.v1';
function load(): Partial<UIState> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
const saved = load();

export const useUI = create<UIState>(() => ({
  groups: Array.isArray(saved.groups) && saved.groups.length === DEFAULT_GROUPS.length ? saved.groups : DEFAULT_GROUPS,
  hiddenPanels: saved.hiddenPanels ?? [],
  sidebarWidth: saved.sidebarWidth ?? 300,
  sidebarMode: typeof window !== 'undefined' && window.innerWidth < 1100 ? 'rail' : saved.sidebarMode ?? 'docked',
  floatingGroup: null,
  showRulers: saved.showRulers ?? true,
  showGrid: saved.showGrid ?? false,
  showGuides: saved.showGuides ?? true,
  showPixelGrid: saved.showPixelGrid ?? true,
  snap: saved.snap ?? true,
  showSelectionEdges: true,
  gridSize: saved.gridSize ?? 50,
  gridColor: saved.gridColor ?? '#4f8cff',
  dialog: null,
  toasts: [],
  busy: null,
  dropActive: false,
  showHome: true,
}));

let t: ReturnType<typeof setTimeout> | undefined;
useUI.subscribe((s) => {
  clearTimeout(t);
  t = setTimeout(() => {
    try {
      const { groups, hiddenPanels, sidebarWidth, sidebarMode, showRulers, showGrid, showGuides, showPixelGrid, snap, gridSize, gridColor } = s;
      localStorage.setItem(KEY, JSON.stringify({ groups, hiddenPanels, sidebarWidth, sidebarMode, showRulers, showGrid, showGuides, showPixelGrid, snap, gridSize, gridColor }));
    } catch { /* ignore */ }
  }, 300);
});

export function openDialog(d: DialogDescriptor) { useUI.setState({ dialog: d }); }
export function closeDialog() { useUI.setState({ dialog: null }); }

export function toast(message: string, kind: Toast['kind'] = 'info', ms = 3800) {
  const id = uid('t');
  useUI.setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }));
  setTimeout(() => useUI.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), ms);
}
export const toastError = (m: string) => toast(m, 'error', 6000);

export function setBusy(label: string | null, progress: number | null = null) {
  useUI.setState({ busy: label ? { label, progress } : null });
}

/** Runs an async task with a progress indicator; never lets errors escape to the app. */
export async function withBusy<T>(label: string, fn: (progress: (p: number) => void) => Promise<T>, errorMessage?: string): Promise<T | undefined> {
  setBusy(label, null);
  try {
    return await fn((p) => setBusy(label, p));
  } catch (e) {
    console.error(e);
    toastError(errorMessage ?? (e instanceof Error ? e.message : 'Something went wrong.'));
    return undefined;
  } finally { setBusy(null); }
}

export function focusPanel(panel: PanelId) {
  useUI.setState((s) => {
    const groups = s.groups.map((g) => (g.tabs.includes(panel) ? { ...g, active: panel, collapsed: false } : g));
    const gid = groups.find((g) => g.tabs.includes(panel))?.id ?? null;
    return { groups, hiddenPanels: s.hiddenPanels.filter((p) => p !== panel), floatingGroup: s.sidebarMode === 'rail' ? gid : s.floatingGroup };
  });
}
export function togglePanelVisible(panel: PanelId) {
  useUI.setState((s) => ({ hiddenPanels: s.hiddenPanels.includes(panel) ? s.hiddenPanels.filter((p) => p !== panel) : [...s.hiddenPanels, panel] }));
}
export function resetWorkspace() {
  useUI.setState({ groups: DEFAULT_GROUPS, hiddenPanels: [], sidebarWidth: 300, sidebarMode: window.innerWidth < 1100 ? 'rail' : 'docked' });
}

/** Cursor position lives in its own store so only the status bar re-renders on mouse move. */
export const useCursor = create<{ x: number | null; y: number | null; color: string | null }>(() => ({ x: null, y: null, color: null }));
