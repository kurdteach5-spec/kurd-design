// Sound Library state: tracks (built-in + uploaded), favourites, play counts, filters and the player.
// Uploaded audio, covers and their details are kept in this browser (IndexedDB); favourites and counts in localStorage.
import { create } from '../state/createStore';
import { tr } from '../i18n';
import { useOnline } from './online';
import { BUILTIN, type Kind, type License, type Track } from './catalog';

// ---------------- persistence ----------------
const LS = { fav: 'sarwar-lib-fav', plays: 'sarwar-lib-plays', peaks: 'sarwar-lib-peaks-v1' };
const readJson = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const writeJson = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

const DB = 'sarwar-library'; const STORE = 'uploads';
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(STORE, mode); const req = fn(t.objectStore(STORE)); t.oncomplete = () => res(req ? req.result : undefined); t.onerror = () => rej(t.error); });
}
export interface UploadRecord extends Omit<Track, 'music' | 'sfx' | 'cover'> { audio: Blob; fileName: string; coverBlob: Blob | null; peaks?: number[] }
export async function loadUploads(): Promise<UploadRecord[]> { try { return ((await tx<UploadRecord[]>('readonly', (s) => s.getAll())) ?? []).sort((a, b) => b.addedAt - a.addedAt); } catch { return []; } }
export async function saveUpload(r: UploadRecord) { await tx('readwrite', (s) => s.put(r)); await refreshUploads(); }
export async function deleteUpload(id: string) { await tx('readwrite', (s) => s.delete(id)); await refreshUploads(); }
export async function getUpload(id: string): Promise<UploadRecord | undefined> { return tx<UploadRecord>('readonly', (s) => s.get(id)); }

// ---------------- store ----------------
export type SortKey = 'recent' | 'popular' | 'title' | 'duration' | 'bpm';
export interface Filters {
  q: string; kind: Kind | 'all'; category: string | 'all'; mood: string | 'all'; genre: string | 'all';
  duration: 'all' | 'xs' | 's' | 'm' | 'l'; bpm: 'all' | 'slow' | 'mid' | 'fast'; license: 'all' | 'free' | 'licensed';
  favorites: boolean; uploads: boolean; sort: SortKey;
  /** searching the free online library (Openverse) instead of the built-in sounds */
  online: boolean;
}
export const defaultFilters = (): Filters => ({ q: '', kind: 'music', category: 'all', mood: 'all', genre: 'all', duration: 'all', bpm: 'all', license: 'all', favorites: false, uploads: false, sort: 'recent', online: false });

export interface LibState {
  uploads: Track[];
  filters: Filters;
  favorites: string[];
  plays: Record<string, number>;
  peaks: Record<string, string>;
  /** player */
  current: string | null; playing: boolean; loading: string | null; time: number; duration: number; volume: number; loop: boolean;
  error: string | null;
  admin: { open: boolean; editId: string | null };
}
export const useLib = create<LibState>(() => ({
  uploads: [], filters: defaultFilters(), favorites: readJson<string[]>(LS.fav, []), plays: readJson<Record<string, number>>(LS.plays, {}),
  peaks: readJson<Record<string, string>>(LS.peaks, {}),
  current: null, playing: false, loading: null, time: 0, duration: 0, volume: readJson<number>('sarwar-lib-vol', 0.85), loop: false, error: null,
  admin: { open: false, editId: null },
}));
export const setFilters = (p: Partial<Filters>) => useLib.setState((s) => ({ filters: { ...s.filters, ...p } }));

export function toggleFavorite(id: string) {
  const s = useLib.getState(); const favorites = s.favorites.includes(id) ? s.favorites.filter((x) => x !== id) : [...s.favorites, id];
  useLib.setState({ favorites }); writeJson(LS.fav, favorites);
}
export function countPlay(id: string, by = 1) {
  const plays = { ...useLib.getState().plays, [id]: (useLib.getState().plays[id] ?? 0) + by };
  useLib.setState({ plays }); writeJson(LS.plays, plays);
}
export function savePeaks(id: string, peaks: Uint8Array) {
  let b = ''; for (const v of peaks) b += String.fromCharCode(v);
  const all = { ...useLib.getState().peaks, [id]: btoa(b) };
  useLib.setState({ peaks: all }); writeJson(LS.peaks, all);
}
export function peaksOf(id: string): Uint8Array | null {
  const s = useLib.getState().peaks[id]; if (!s) return null;
  try { const b = atob(s); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; } catch { return null; }
}

const coverUrls = new Map<string, string>();
export async function refreshUploads() {
  const list = await loadUploads();
  const uploads: Track[] = list.map((u) => {
    let cover = coverUrls.get(u.id) ?? null;
    if (u.coverBlob && !cover) { cover = URL.createObjectURL(u.coverBlob); coverUrls.set(u.id, cover); }
    if (u.peaks && !useLib.getState().peaks[u.id]) savePeaks(u.id, new Uint8Array(u.peaks));
    const { audio: _a, coverBlob: _c, fileName: _f, peaks: _p, ...t } = u; void _a; void _c; void _f; void _p;
    return { ...t, cover };
  });
  useLib.setState({ uploads });
}

export const allTracks = (s: LibState = useLib.getState()): Track[] => {
  const o = useOnline.getState();
  const online = [...o.saved, ...o.results.filter((r) => !o.saved.some((x) => x.id === r.id))];
  return [...s.uploads, ...BUILTIN, ...online];
};
export const trackById = (id: string | null) => (id ? allTracks().find((t) => t.id === id) ?? null : null);

const durOk = (d: number, f: Filters['duration']) => f === 'all' || (f === 'xs' ? d < 10 : f === 's' ? d >= 10 && d < 30 : f === 'm' ? d >= 30 && d < 60 : d >= 60);
const bpmOk = (b: number | null, f: Filters['bpm']) => f === 'all' || (b !== null && (f === 'slow' ? b < 90 : f === 'mid' ? b >= 90 && b <= 120 : b > 120));
const FREE: License[] = ['original', 'royalty-free', 'public-domain', 'cc0', 'cc-by', 'cc-by-sa', 'cc-by-nd'];
export const isFreeLicense = (l: License) => FREE.includes(l);

/** tracks matching the search and filters, sorted */
export function filterTracks(s: LibState): Track[] {
  const f = s.filters; const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  if (f.online && !f.favorites) return useOnline.getState().results;
  const out = allTracks(s).filter((t) => {
    if (t.remote && !f.favorites) return false;
    if (f.uploads && t.builtin) return false;
    if (f.favorites && !s.favorites.includes(t.id)) return false;
    if (!f.favorites && !f.uploads && f.kind !== 'all' && t.kind !== f.kind) return false;
    if (f.category !== 'all' && t.category !== f.category) return false;
    if (f.mood !== 'all' && !t.moods.includes(f.mood)) return false;
    if (f.genre !== 'all' && t.genre !== f.genre) return false;
    if (!durOk(t.duration, f.duration) || !bpmOk(t.bpm, f.bpm)) return false;
    if (f.license === 'free' && !FREE.includes(t.license)) return false;
    if (f.license === 'licensed' && FREE.includes(t.license)) return false;
    if (words.length) {
      // English words plus their Kurdish / Arabic names, so a search in the interface language works too
      const words0 = [t.title, t.categoryName, t.genre, ...t.moods, ...t.instruments, ...t.tags, t.description ?? '', t.kind === 'sfx' ? 'sound effect sfx' : 'music background'];
      const hay = [...words0, tr(t.categoryName), tr(t.genre), ...t.moods.map((m) => tr(m)), ...t.instruments.map((m) => tr(m)), tr(t.kind === 'sfx' ? 'Sound effects' : 'Background music')].join(' ').toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const by: Record<SortKey, (a: Track, b: Track) => number> = {
    recent: (a, b) => b.addedAt - a.addedAt,
    popular: (a, b) => (s.plays[b.id] ?? 0) - (s.plays[a.id] ?? 0) || b.addedAt - a.addedAt,
    title: (a, b) => a.title.localeCompare(b.title),
    duration: (a, b) => a.duration - b.duration,
    bpm: (a, b) => (a.bpm ?? 999) - (b.bpm ?? 999),
  };
  return out.sort(by[f.sort]);
}
