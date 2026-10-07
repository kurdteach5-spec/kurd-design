// Motion project files (.kdmotion = ZIP with project.json + media) and browser storage (IndexedDB).
import type { MotionProject } from './types';
import { ZipWriter, readZip } from './export/zip';
import { assetData, clearAssets, restoreAsset } from './media/assets';
import { useMotion, loadProjectState } from './store';
import { emptyProject } from './factory';
import { saveBlob } from '../file-system/exporters';
import { toast, toastError, withBusy } from '../state/uiStore';
import { clearRenderCache } from './render/renderer';

const FORMAT = 'kurd-design-motion';

export async function projectToBlob(p: MotionProject): Promise<Blob> {
  const zip = new ZipWriter();
  zip.add('project.json', new TextEncoder().encode(JSON.stringify({ format: FORMAT, project: p })));
  for (const id of p.assetOrder) {
    const d = assetData(id); if (!d) continue;
    zip.add(`assets/${id}`, new Uint8Array(await d.blob.arrayBuffer()));
  }
  return zip.finish('application/octet-stream');
}

export async function blobToProject(blob: Blob): Promise<MotionProject> {
  const files = readZip(await blob.arrayBuffer());
  const json = files.get('project.json'); if (!json) throw new Error('This is not a KURD DESIGN Motion project.');
  const parsed = JSON.parse(new TextDecoder().decode(json)) as { format: string; project: MotionProject };
  if (parsed.format !== FORMAT || !parsed.project?.comps) throw new Error('This is not a KURD DESIGN Motion project.');
  const p = parsed.project;
  clearAssets(); clearRenderCache();
  for (const id of p.assetOrder) {
    const meta = p.assets[id]; const bytes = files.get(`assets/${id}`);
    if (!meta || !bytes) continue;
    try { await restoreAsset(meta, new Blob([bytes as BlobPart], { type: meta.mime })); } catch (e) { console.warn('Missing media', meta.name, e); }
  }
  return p;
}

export async function saveProjectFile() {
  const s = useMotion.getState();
  await withBusy('Saving project…', async () => {
    const blob = await projectToBlob(s.project);
    if (await saveBlob(blob, `${s.project.name.replace(/[\\/:*?"<>|]+/g, '_') || 'motion'}.kdmotion${(window as unknown as { claude?: unknown }).claude ? '.zip' : ''}`)) {
      useMotion.setState({ savedVersion: s.version });
      void storeProject().catch(() => {});
      toast('Project saved', 'success');
    }
  }, 'Unable to save the project.');
}

export async function openProjectFile(file: File) {
  await withBusy(`Opening ${file.name}…`, async () => {
    const p = await blobToProject(file);
    loadProjectState(p);
    toast(`Opened ${p.name}`, 'success');
  }, 'Unable to open this project. It may be damaged or from a different app.');
}

export function newProject() {
  clearAssets(); clearRenderCache();
  loadProjectState(emptyProject());
}

// ---------- IndexedDB ----------
const DB = 'kurd-design-motion';
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('projects'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function put(key: string, value: unknown) {
  const d = await db();
  await new Promise<void>((res, rej) => { const tx = d.transaction('projects', 'readwrite'); tx.objectStore('projects').put(value, key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  d.close();
}
async function get<T>(key: string): Promise<T | undefined> {
  const d = await db();
  const v = await new Promise<T | undefined>((res, rej) => { const tx = d.transaction('projects', 'readonly'); const r = tx.objectStore('projects').get(key); r.onsuccess = () => res(r.result as T); r.onerror = () => rej(r.error); });
  d.close(); return v;
}

/** Keeps the current project in the browser so it survives reloads. */
export async function storeProject(key = 'last') {
  const s = useMotion.getState();
  if (!s.project.compOrder.length && !s.project.assetOrder.length) return;
  const blob = await projectToBlob(s.project);
  await put(key, { name: s.project.name, savedAt: Date.now(), blob });
}
export async function lastStored(): Promise<{ name: string; savedAt: number; blob: Blob } | undefined> {
  try { return await get('last'); } catch { return undefined; }
}
export async function restoreLast() {
  const rec = await lastStored(); if (!rec) { toast('No saved session found.', 'info'); return; }
  await withBusy('Restoring project…', async () => { loadProjectState(await blobToProject(rec.blob)); }, 'Unable to restore the project.');
}

let timer: ReturnType<typeof setInterval> | null = null;
let lastVersion = -1;
export function startMotionAutosave() {
  if (timer) return;
  timer = setInterval(() => {
    const s = useMotion.getState();
    if (s.version === lastVersion || s.playing) return;
    lastVersion = s.version;
    void storeProject().catch((e) => console.warn('Motion autosave failed', e));
  }, 20000);
}
export const reportError = (m: string) => toastError(m);
