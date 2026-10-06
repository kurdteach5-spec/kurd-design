import type { DocState } from '../types/document';
import { fromStorageParts, toStorageParts, type ProjectFile } from './project';
import { renderDocument } from '../canvas/compositor';
import { canvasToBlob, createCanvas, ctx2d } from '../utils/canvas';

export interface ProjectMeta { id: string; name: string; createdAt: number; updatedAt: number; width: number; height: number; layers: number; thumb: Blob | null }
interface ProjectData { id: string; meta: ProjectFile['state']; blobs: Blob[] }
export interface AutosaveRecord { docId: string; projectId: string; name: string; savedAt: number; width: number; height: number; meta: ProjectFile['state']; blobs: Blob[]; thumb: Blob | null }

const DB = 'designpro-studio';
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('index')) db.createObjectStore('index', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('data')) db.createObjectStore('data', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('autosave')) db.createObjectStore('autosave', { keyPath: 'docId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Local storage is unavailable.'));
      req.onblocked = () => reject(new Error('Local storage is blocked.'));
    } catch (e) { reject(e); }
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then((db) => new Promise<T | undefined>((resolve, reject) => {
    const t = db.transaction(store, mode); const s = t.objectStore(store);
    let result: T | undefined;
    const req = fn(s);
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error ?? new Error('Storage error'));
    t.onabort = () => reject(t.error ?? new Error('Storage quota exceeded'));
  }));
}

export async function makeThumb(state: DocState, size = 320): Promise<Blob | null> {
  try {
    const full = renderDocument(state);
    const k = Math.min(1, size / Math.max(state.width, state.height));
    const c = createCanvas(Math.max(1, Math.round(state.width * k)), Math.max(1, Math.round(state.height * k)));
    const x = ctx2d(c); x.imageSmoothingQuality = 'high'; x.drawImage(full, 0, 0, c.width, c.height);
    return await canvasToBlob(c, 'image/webp', 0.85).catch(() => canvasToBlob(c, 'image/png'));
  } catch { return null; }
}

const countLayers = (s: DocState) => { let n = 0; const w = (ls: DocState['layers']) => { for (const l of ls) { n++; if (l.type === 'group') w(l.children); } }; w(s.layers); return n; };

export async function saveProject(id: string, name: string, state: DocState, createdAt = Date.now()): Promise<void> {
  const { meta, blobs } = await toStorageParts(state);
  const thumb = await makeThumb(state);
  const now = Date.now();
  const existing = await tx<ProjectMeta>('index', 'readonly', (s) => s.get(id));
  await tx('data', 'readwrite', (s) => s.put({ id, meta, blobs } satisfies ProjectData));
  await tx('index', 'readwrite', (s) => s.put({ id, name, createdAt: existing?.createdAt ?? createdAt, updatedAt: now, width: state.width, height: state.height, layers: countLayers(state), thumb } satisfies ProjectMeta));
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const all = (await tx<ProjectMeta[]>('index', 'readonly', (s) => s.getAll())) ?? [];
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: string): Promise<{ meta: ProjectMeta; state: DocState }> {
  const meta = await tx<ProjectMeta>('index', 'readonly', (s) => s.get(id));
  const data = await tx<ProjectData>('data', 'readonly', (s) => s.get(id));
  if (!meta || !data) throw new Error('This project could not be found.');
  return { meta, state: await fromStorageParts(data.meta, data.blobs) };
}

export async function renameProject(id: string, name: string) {
  const meta = await tx<ProjectMeta>('index', 'readonly', (s) => s.get(id));
  if (meta) await tx('index', 'readwrite', (s) => s.put({ ...meta, name, updatedAt: Date.now() }));
}

export async function deleteProject(id: string) {
  await tx('index', 'readwrite', (s) => s.delete(id));
  await tx('data', 'readwrite', (s) => s.delete(id));
}

export async function writeAutosave(docId: string, projectId: string, name: string, state: DocState) {
  const { meta, blobs } = await toStorageParts(state);
  const thumb = await makeThumb(state, 200);
  await tx('autosave', 'readwrite', (s) => s.put({ docId, projectId, name, savedAt: Date.now(), width: state.width, height: state.height, meta, blobs, thumb } satisfies AutosaveRecord));
}
export async function listAutosaves(): Promise<AutosaveRecord[]> { return (await tx<AutosaveRecord[]>('autosave', 'readonly', (s) => s.getAll())) ?? []; }
export async function deleteAutosave(docId: string) { await tx('autosave', 'readwrite', (s) => s.delete(docId)); }
export async function clearAutosaves() { await tx('autosave', 'readwrite', (s) => s.clear()); }
export async function restoreAutosave(r: AutosaveRecord): Promise<DocState> { return fromStorageParts(r.meta, r.blobs); }

export async function storageAvailable(): Promise<boolean> { try { await open(); return true; } catch { return false; } }
