import type { DocState } from '../types/document';
import { closeDocument, commit, createDocument, currentState, getDoc, getDocState, isDirty, markSaved, openDocument, useDocuments, type NewDocOptions } from '../state/documentStore';
import { openDialog, toast, toastError, useUI, withBusy } from '../state/uiStore';
import { setTool } from '../state/toolStore';
import { readFile, isImportable, OPEN_ACCEPT } from '../file-system/importers';
import { createRasterLayer } from '../layers/factory';
import { insertLayers } from '../layers/tree';
import { multiply, scaleM, translate } from '../utils/math';
import { exportPdf, exportRaster, exportSvg, saveBlob, type ExportOptions } from '../file-system/exporters';
import { writePsd } from '../file-system/psd';
import { serializeProject } from '../file-system/project';
import { deleteAutosave, loadProject, saveProject, writeAutosave, listAutosaves, restoreAutosave, clearAutosaves } from '../file-system/storage';
import { getEngine } from '../canvas/engine';
import { uid } from '../utils/id';

export function newDocument(o: NewDocOptions) {
  createDocument(o);
  useUI.setState({ showHome: false });
}

export function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = multiple;
    input.style.display = 'none';
    input.onchange = () => { resolve([...(input.files ?? [])]); input.remove(); };
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}

/** Opens files as new documents (images become single-layer documents). */
export async function openFiles(files: File[]) {
  const valid = files.filter(isImportable);
  if (!valid.length) { if (files.length) toastError('Unsupported file format.'); return; }
  for (const file of valid) {
    await withBusy(`Opening ${file.name}…`, async () => {
      const r = await readFile(file);
      if (r.kind === 'document') {
        openDocument(r.name, r.state, { label: 'Open', saved: false });
        r.warnings.forEach((w) => toast(w, 'warning', 6000));
      } else {
        const st: DocState = { width: r.canvas.width, height: r.canvas.height, dpi: 72, colorMode: 'rgb', layers: [], activeLayerId: null, selectedLayerIds: [], editTarget: 'content', selection: null, guides: [] };
        const layer = createRasterLayer('Background', r.canvas);
        st.layers = [layer]; st.activeLayerId = layer.id;
        openDocument(r.name, st, { label: 'Open' });
        if (r.warning) toast(r.warning, 'warning', 6000);
      }
      useUI.setState({ showHome: false });
    });
  }
}

/** Places images as new layers in the active document (or opens them if no document is open). */
export async function importAsLayers(files: File[]) {
  const s = getDocState();
  if (!s) { await openFiles(files); return; }
  const valid = files.filter(isImportable);
  if (!valid.length) { toastError('Unsupported file format.'); return; }
  let placed = 0;
  for (const file of valid) {
    await withBusy(`Importing ${file.name}…`, async () => {
      const r = await readFile(file);
      if (r.kind === 'document') { openDocument(r.name, r.state, { label: 'Open' }); r.warnings.forEach((w) => toast(w, 'warning', 6000)); return; }
      const st = getDocState()!;
      const k = Math.min(1, (st.width * 0.95) / r.canvas.width, (st.height * 0.95) / r.canvas.height);
      const w = r.canvas.width * k, h = r.canvas.height * k;
      // keep full resolution; scale non-destructively through the layer transform
      const t = multiply(translate(Math.round((st.width - w) / 2) + placed * 20, Math.round((st.height - h) / 2) + placed * 20), scaleM(k, k));
      const layer = createRasterLayer(r.name, r.canvas, t);
      commit((d) => ({ ...d, layers: insertLayers(d.layers, [layer], d.activeLayerId, 'above'), activeLayerId: layer.id, selectedLayerIds: [layer.id], editTarget: 'content' }), { history: `Place ${r.name}` });
      if (r.warning) toast(r.warning, 'warning', 6000);
      placed++;
    });
  }
  if (placed) setTool('move');
}

export async function openWithPicker() { const f = await pickFiles(OPEN_ACCEPT, true); if (f.length) await openFiles(f); }
export async function placeWithPicker() { const f = await pickFiles(OPEN_ACCEPT, true); if (f.length) await importAsLayers(f); }

// ---------------- Save ----------------
export async function saveToProjects(name?: string, asNew = false): Promise<boolean> {
  const d = getDoc(); if (!d) return false;
  const projectId = asNew ? uid('proj') : d.projectId;
  const finalName = (name ?? d.name).trim() || 'Untitled';
  const ok = await withBusy('Saving…', async () => {
    await saveProject(projectId, finalName, currentState(d));
    return true;
  }, 'Unable to save. Your browser storage may be full or disabled — try File › Download Project instead.');
  if (ok) {
    markSaved(projectId, finalName, d.id);
    deleteAutosave(d.id).catch(() => {});
    toast(`Saved “${finalName}” to Projects`, 'success');
  }
  return !!ok;
}

export async function downloadProject() {
  const d = getDoc(); if (!d) return;
  await withBusy('Preparing project file…', async () => {
    const json = await serializeProject(d.name, currentState(d));
    await saveBlob(new Blob([JSON.stringify(json)], { type: 'application/json' }), `${d.name}.dps`);
  }, 'Unable to create the project file.');
}

export async function downloadPsd() {
  const d = getDoc(); if (!d) return;
  await withBusy('Writing PSD…', async () => {
    const { data, warnings } = writePsd(currentState(d));
    await saveBlob(new Blob([data as BlobPart], { type: 'image/vnd.adobe.photoshop' }), `${d.name}.psd`);
    warnings.forEach((w) => toast(w, 'info', 6000));
  }, 'PSD export failed. Please try again.');
}

export async function exportDocument(o: ExportOptions) {
  const d = getDoc(); if (!d) return false;
  if (o.format === 'psd') { await downloadPsd(); return true; }
  const res = await withBusy(`Exporting ${o.format.toUpperCase()}…`, async () => {
    const st = currentState(d);
    const blob = o.format === 'svg' ? await exportSvg(st, o) : o.format === 'pdf' ? await exportPdf(st, o) : await exportRaster(st, o);
    return await saveBlob(blob, `${d.name}.${o.format}`);
  }, 'Export failed. Please try again.');
  if (res) toast(`Exported ${d.name}.${o.format}`, 'success');
  return !!res;
}

export async function openProject(id: string) {
  await withBusy('Opening project…', async () => {
    const existing = Object.values(useDocuments.getState().docs).find((d) => d.projectId === id);
    if (existing) { useDocuments.setState({ activeId: existing.id }); useUI.setState({ showHome: false }); return; }
    const { meta, state } = await loadProject(id);
    openDocument(meta.name, state, { projectId: id, saved: true, label: 'Open' });
    useUI.setState({ showHome: false });
  }, 'Unable to open this project. It may be corrupted.');
}

export function requestClose(docId?: string) {
  const d = getDoc(docId); if (!d) return;
  if (isDirty(d)) { openDialog({ type: 'confirm-close', docId: d.id }); return; }
  closeNow(d.id);
}
export function closeNow(docId: string) {
  closeDocument(docId);
  deleteAutosave(docId).catch(() => {});
  getEngine()?.resetTransient();
  if (!useDocuments.getState().order.length) useUI.setState({ showHome: true });
}

// ---------------- Autosave & recovery ----------------
const autosaved = new Map<string, string>(); // docId → history entry id last written
let autosaveTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function autosaveTick() {
  if (running) return;
  running = true;
  try {
    const { docs } = useDocuments.getState();
    for (const d of Object.values(docs)) {
      const entry = d.history[d.historyIndex].id;
      if (!isDirty(d)) { if (autosaved.has(d.id)) { autosaved.delete(d.id); deleteAutosave(d.id).catch(() => {}); } continue; }
      if (autosaved.get(d.id) === entry) continue;
      await new Promise<void>((r) => ((window as unknown as { requestIdleCallback?: (cb: () => void, o?: unknown) => void }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 50)))(() => r(), { timeout: 2000 }));
      await writeAutosave(d.id, d.projectId, d.name, currentState(d));
      autosaved.set(d.id, entry);
    }
  } catch (e) { console.warn('Autosave failed', e); }
  finally { running = false; }
}

export function startAutosave() {
  if (autosaveTimer) return;
  autosaveTimer = setInterval(autosaveTick, 15000);
  window.addEventListener('beforeunload', (e) => {
    const dirty = Object.values(useDocuments.getState().docs).some(isDirty);
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void autosaveTick(); });
}

export async function checkRecovery() {
  try {
    const list = await listAutosaves();
    if (list.length) openDialog({ type: 'recover' });
  } catch { /* storage unavailable */ }
}

export async function recoverAll() {
  await withBusy('Recovering documents…', async () => {
    const list = await listAutosaves();
    for (const r of list) {
      const state = await restoreAutosave(r);
      openDocument(r.name, state, { projectId: r.projectId, label: 'Recovered' });
    }
    await clearAutosaves();
    useUI.setState({ showHome: false });
    toast(list.length > 1 ? `${list.length} documents recovered` : 'Document recovered', 'success');
  }, 'Unable to recover the previous document.');
}
export async function discardRecovery() { try { await clearAutosaves(); } catch { /* ignore */ } }

export { isDirty };
