import { create } from './createStore';
import type { DocState, EditorDocument, HistoryEntry, ViewState, ColorMode, Layer } from '../types/document';
import { uid } from '../utils/id';
import { newBytes, MAX_HISTORY_BYTES, MAX_HISTORY_STATES } from '../history/historyMemory';
import { createRasterLayer } from '../layers/factory';
import { filledCanvas, createCanvas } from '../utils/canvas';
import { findLayer } from '../layers/tree';

export interface DocumentsState {
  docs: Record<string, EditorDocument>;
  order: string[];
  activeId: string | null;
}

export const useDocuments = create<DocumentsState>(() => ({ docs: {}, order: [], activeId: null }));

export interface CommitOptions {
  /** History label. Omit for state changes that should not create an undo step. */
  history?: string;
  /** Consecutive commits with the same key merge into one history step (e.g. slider drags). */
  mergeKey?: string;
}

const MERGE_WINDOW_MS = 1500;

export function getDoc(id?: string | null): EditorDocument | null {
  const s = useDocuments.getState();
  const did = id ?? s.activeId;
  return did ? s.docs[did] ?? null : null;
}
export function getDocState(id?: string | null): DocState | null {
  const d = getDoc(id);
  return d ? d.history[d.historyIndex].state : null;
}
export const currentState = (d: EditorDocument) => d.history[d.historyIndex].state;
export const isDirty = (d: EditorDocument) => d.history[d.historyIndex].id !== d.savedEntryId;

function setDoc(doc: EditorDocument) {
  useDocuments.setState((s) => ({ docs: { ...s.docs, [doc.id]: doc } }));
}

/**
 * The single entry point for changing a document. `recipe` receives the current
 * immutable state and returns the next one. Pixel canvases must never be mutated
 * after being committed — create a new canvas instead (history shares references).
 */
export function commit(recipe: (s: DocState) => DocState, opts: CommitOptions = {}, docId?: string | null): boolean {
  const doc = getDoc(docId);
  if (!doc) return false;
  const prev = currentState(doc);
  let next: DocState;
  try { next = recipe(prev); } catch (e) { console.error(e); throw e; }
  if (next === prev) return false;
  // keep active layer valid
  if (next.activeLayerId && !findLayer(next.layers, next.activeLayerId)) next = { ...next, activeLayerId: topLayerId(next.layers), selectedLayerIds: [] };
  if (!next.activeLayerId && next.layers.length) next = { ...next, activeLayerId: topLayerId(next.layers) };
  if (next.selectedLayerIds.some((id) => !findLayer(next.layers, id))) next = { ...next, selectedLayerIds: next.selectedLayerIds.filter((id) => findLayer(next.layers, id)) };

  const cur = doc.history[doc.historyIndex];
  const now = Date.now();
  let history = doc.history;
  let index = doc.historyIndex;

  if (!opts.history) {
    // no undo step: replace the current entry's state
    history = history.slice(); history[index] = { ...cur, state: next };
  } else if (opts.mergeKey && cur.mergeKey === opts.mergeKey && now - cur.time < MERGE_WINDOW_MS && index > 0) {
    history = history.slice(0, index + 1);
    const before = history[index - 1].state;
    history[index] = { ...cur, state: next, time: now, bytes: newBytes(before, next) };
  } else {
    const entry: HistoryEntry = { id: uid('h'), label: opts.history, state: next, mergeKey: opts.mergeKey, time: now, bytes: newBytes(prev, next) };
    history = [...history.slice(0, index + 1), entry];
    index = history.length - 1;
    // trim by count and memory, always keeping the current state
    let total = history.reduce((a, h) => a + h.bytes, 0);
    while (history.length > 1 && (history.length > MAX_HISTORY_STATES || total > MAX_HISTORY_BYTES)) {
      total -= history[0].bytes; history = history.slice(1); index--;
    }
  }
  setDoc({ ...doc, history, historyIndex: index });
  return true;
}

export function topLayerId(layers: Layer[]): string | null {
  return layers.length ? layers[layers.length - 1].id : null;
}

export function undo(docId?: string) {
  const d = getDoc(docId); if (!d || d.historyIndex === 0) return false;
  setDoc({ ...d, historyIndex: d.historyIndex - 1 }); return true;
}
export function redo(docId?: string) {
  const d = getDoc(docId); if (!d || d.historyIndex >= d.history.length - 1) return false;
  setDoc({ ...d, historyIndex: d.historyIndex + 1 }); return true;
}
export function jumpToHistory(index: number, docId?: string) {
  const d = getDoc(docId); if (!d || index < 0 || index >= d.history.length) return;
  setDoc({ ...d, historyIndex: index });
}
export function clearHistory(docId?: string) {
  const d = getDoc(docId); if (!d) return;
  const cur = d.history[d.historyIndex];
  setDoc({ ...d, history: [{ ...cur, label: 'Snapshot', bytes: 0 }], historyIndex: 0 });
}

export function setView(view: Partial<ViewState>, docId?: string) {
  const d = getDoc(docId); if (!d) return;
  setDoc({ ...d, view: { ...d.view, ...view } });
}
export function markSaved(projectId: string, name?: string, docId?: string) {
  const d = getDoc(docId); if (!d) return;
  setDoc({ ...d, projectId, name: name ?? d.name, savedEntryId: d.history[d.historyIndex].id });
}
export function renameDocument(name: string, docId?: string) {
  const d = getDoc(docId); if (!d) return; setDoc({ ...d, name });
}

export interface NewDocOptions {
  name: string; width: number; height: number; dpi: number; colorMode: ColorMode;
  background: 'white' | 'black' | 'transparent' | 'color'; backgroundColor?: string;
}

export function emptyState(width: number, height: number, dpi = 72, colorMode: ColorMode = 'rgb'): DocState {
  return { width, height, dpi, colorMode, layers: [], activeLayerId: null, selectedLayerIds: [], editTarget: 'content', selection: null, guides: [] };
}

export function createDocument(o: NewDocOptions): string {
  const st = emptyState(o.width, o.height, o.dpi, o.colorMode);
  let bg: HTMLCanvasElement;
  if (o.background === 'transparent') bg = createCanvas(o.width, o.height);
  else bg = filledCanvas(o.width, o.height, o.background === 'white' ? '#ffffff' : o.background === 'black' ? '#000000' : o.backgroundColor || '#ffffff');
  const layer = createRasterLayer(o.background === 'transparent' ? 'Layer 1' : 'Background', bg);
  st.layers = [layer]; st.activeLayerId = layer.id;
  return openDocument(o.name, st, { label: 'New Document' });
}

export function openDocument(name: string, state: DocState, opts: { projectId?: string; label?: string; saved?: boolean; view?: ViewState; smartLink?: EditorDocument['smartLink'] } = {}): string {
  const id = uid('doc');
  const entry: HistoryEntry = { id: uid('h'), label: opts.label ?? 'Open', state, time: Date.now(), bytes: newBytes(null, state) };
  const doc: EditorDocument = {
    id, name, projectId: opts.projectId ?? uid('proj'), history: [entry], historyIndex: 0,
    savedEntryId: opts.saved ? entry.id : null, view: opts.view ?? { zoom: 0, panX: 0, panY: 0, rotation: 0 }, createdAt: Date.now(),
    ...(opts.smartLink ? { smartLink: opts.smartLink } : {}),
  };
  useDocuments.setState((s) => ({ docs: { ...s.docs, [id]: doc }, order: [...s.order, id], activeId: id }));
  return id;
}

export function closeDocument(id: string) {
  useDocuments.setState((s) => {
    const docs = { ...s.docs }; delete docs[id];
    const order = s.order.filter((o) => o !== id);
    const idx = s.order.indexOf(id);
    const activeId = s.activeId === id ? order[Math.min(idx, order.length - 1)] ?? null : s.activeId;
    return { docs, order, activeId };
  });
}
export function setActiveDocument(id: string) { useDocuments.setState({ activeId: id }); }

/** Hook helpers */
export const selectActiveDoc = (s: DocumentsState) => (s.activeId ? s.docs[s.activeId] ?? null : null);
export const selectActiveState = (s: DocumentsState) => {
  const d = selectActiveDoc(s); return d ? d.history[d.historyIndex].state : null;
};
