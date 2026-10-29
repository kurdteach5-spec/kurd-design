// Auto Posts: follows public profiles (RSS / Atom feeds, Bluesky, Mastodon) and turns every new post
// into a ready design in the profile's own style. Profiles and their posts are kept in this browser (IndexedDB).
import { create } from '../state/createStore';

export type SourceType = 'rss' | 'bluesky' | 'mastodon' | 'truth' | 'telegram' | 'youtube' | 'api';
export type Layout = 'card' | 'quote' | 'headline';
export type SizeKey = 'square' | 'portrait' | 'story' | 'landscape' | 'custom';
export const SIZES: Record<SizeKey, { w: number; h: number; label: string }> = {
  square: { w: 1080, h: 1080, label: 'Square 1:1' },
  portrait: { w: 1080, h: 1350, label: 'Portrait 4:5' },
  story: { w: 1080, h: 1920, label: 'Story 9:16' },
  landscape: { w: 1600, h: 900, label: 'Wide 16:9' },
  custom: { w: 1080, h: 1920, label: 'Your size' },
};
/** a box inside the design (0–1 of the width / height) that the post always stays in */
export interface Area { x: number; y: number; w: number; h: number }
export const sizeOf = (t: Pick<Template, 'size' | 'customW' | 'customH'>) => (t.size === 'custom' ? { w: Math.max(200, Math.min(4000, Math.round(t.customW || 1080))), h: Math.max(200, Math.min(4000, Math.round(t.customH || 1920))) } : SIZES[t.size]);

export interface Template {
  layout: Layout; size: SizeKey; customW: number; customH: number;
  /** the post stays inside this box; null = the whole design with a margin */
  area: Area | null; vAlign: 'top' | 'center' | 'bottom';
  bgType: 'solid' | 'gradient' | 'image'; bg1: string; bg2: string; bgAngle: number; bgImage: string | null; bgDim: number;
  cardOn: boolean; cardColor: string; cardOpacity: number; radius: number;
  font: string; textSize: number; textColor: string; align: 'start' | 'center'; bold: boolean;
  nameColor: string; subColor: string; accent: string;
  showAvatar: boolean; showHandle: boolean; showDate: boolean; showImage: boolean; verified: boolean;
  label: string; logo: string | null; logoPos: 'tl' | 'tr' | 'bl' | 'br'; logoSize: number; footer: string; footerColor: string;
}
export const defaultTemplate = (): Template => ({
  layout: 'card', size: 'square', customW: 1080, customH: 1920, area: null, vAlign: 'center',
  bgType: 'gradient', bg1: '#1e1846', bg2: '#0b0a1f', bgAngle: 135, bgImage: null, bgDim: 0.35,
  cardOn: true, cardColor: '#ffffff', cardOpacity: 1, radius: 36,
  font: 'Inter', textSize: 52, textColor: '#0f1419', align: 'start', bold: false,
  nameColor: '#0f1419', subColor: '#536471', accent: '#7c5cff',
  showAvatar: true, showHandle: true, showDate: true, showImage: true, verified: true,
  label: 'NEW POST', logo: null, logoPos: 'br', logoSize: 70, footer: '', footerColor: '#ffffff',
});

export interface Profile {
  id: string; name: string; tab: string; handle: string;
  source: { type: SourceType; value: string };
  /** uploaded photo (data URL) or the photo the source gives (URL) */
  avatar: string | null; avatarAuto: string | null;
  /** minutes between checks (0.25 = every 15 seconds) */
  interval: number; template: Template;
  /** how the posts were read the last time (e.g. 'trumpstruth.org') */
  via?: string | null;
  lastChecked: number; lastError: string | null; checkedOnce: boolean; unread: number; createdAt: number;
}
export interface Post {
  id: string; profileId: string; text: string; url: string; date: number; images: string[];
  videos?: string[];
  /** 'text' makes a design without the post's picture */
  mode?: 'image' | 'text';
  /** your own wording (e.g. a translation) used in the design instead of the original text */
  textOverride?: string; isNew?: boolean; seenAt: number;
}

export interface Settings {
  proxy: string; notify: boolean; sound: boolean; autoDownload: boolean; autoPictures: boolean; format: 'png' | 'jpg';
  /** ScrapeCreators API key (X, Facebook, Instagram, TikTok, Threads, Truth Social) */
  apiKey: string;
}
const SETTINGS = 'sarwar-posts-settings';
const readSettings = (): Settings => { const d: Settings = { proxy: '/api/feed', notify: true, sound: true, autoDownload: false, autoPictures: false, format: 'png', apiKey: '' }; try { return { ...d, ...JSON.parse(localStorage.getItem(SETTINGS) || '{}') }; } catch { return d; } };

// ---------- IndexedDB ----------
const DB = 'sarwar-posts'; const STORE = 'kv';
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result); r.onerror = () => { dbp = null; rej(r.error); };
  });
}
async function kvGet<T>(key: string): Promise<T | undefined> {
  try { const d = await db(); return await new Promise((res, rej) => { const q = d.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => res(q.result as T); q.onerror = () => rej(q.error); }); } catch { return undefined; }
}
async function kvSet(key: string, value: unknown) {
  try { const d = await db(); await new Promise<void>((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(value, key); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); } catch { /* storage blocked */ }
}
async function kvDel(key: string) {
  try { const d = await db(); await new Promise<void>((res) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(key); t.oncomplete = () => res(); t.onerror = () => res(); }); } catch { /* storage blocked */ }
}

// ---------- store ----------
export interface PostsState {
  loaded: boolean; profiles: Profile[]; posts: Record<string, Post[]>; active: string | null;
  checking: Record<string, boolean>; settings: Settings;
}
export const usePosts = create<PostsState>(() => ({ loaded: false, profiles: [], posts: {}, active: null, checking: {}, settings: readSettings() }));

const MAX_POSTS = 150;
export async function loadPosts() {
  if (usePosts.getState().loaded) return;
  const profiles = ((await kvGet<Profile[]>('profiles')) ?? []).map((p) => ({ ...p, template: { ...defaultTemplate(), ...p.template } }));
  const posts: Record<string, Post[]> = {};
  for (const p of profiles) posts[p.id] = (await kvGet<Post[]>(`posts:${p.id}`)) ?? [];
  let active: string | null = null; try { active = localStorage.getItem('sarwar-posts-active'); } catch { /* blocked */ }
  usePosts.setState({ loaded: true, profiles, posts, active: profiles.some((p) => p.id === active) ? active : profiles[0]?.id ?? null });
}
const saveProfiles = () => kvSet('profiles', usePosts.getState().profiles);
const savePosts = (id: string) => kvSet(`posts:${id}`, usePosts.getState().posts[id] ?? []);

export function setActive(id: string | null) {
  usePosts.setState({ active: id });
  try { if (id) localStorage.setItem('sarwar-posts-active', id); } catch { /* blocked */ }
}
export function setSettings(p: Partial<Settings>) {
  const settings = { ...usePosts.getState().settings, ...p };
  usePosts.setState({ settings }); try { localStorage.setItem(SETTINGS, JSON.stringify(settings)); } catch { /* blocked */ }
}
export const profileById = (id: string | null) => usePosts.getState().profiles.find((p) => p.id === id) ?? null;

export function addProfile(p: Omit<Profile, 'id' | 'lastChecked' | 'lastError' | 'checkedOnce' | 'unread' | 'createdAt'>): Profile {
  const prof: Profile = { ...p, id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, lastChecked: 0, lastError: null, checkedOnce: false, unread: 0, createdAt: Date.now() };
  usePosts.setState((s) => ({ profiles: [...s.profiles, prof], posts: { ...s.posts, [prof.id]: [] } }));
  setActive(prof.id); void saveProfiles();
  return prof;
}
export function updateProfile(id: string, patch: Partial<Profile>) {
  usePosts.setState((s) => ({ profiles: s.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  void saveProfiles();
}
let tplTimer = 0;
export function updateTemplate(id: string, patch: Partial<Template>) {
  usePosts.setState((s) => ({ profiles: s.profiles.map((p) => (p.id === id ? { ...p, template: { ...p.template, ...patch } } : p)) }));
  clearTimeout(tplTimer); tplTimer = window.setTimeout(() => void saveProfiles(), 400);
}
export function removeProfile(id: string) {
  usePosts.setState((s) => { const posts = { ...s.posts }; delete posts[id]; const profiles = s.profiles.filter((p) => p.id !== id); return { profiles, posts, active: s.active === id ? profiles[0]?.id ?? null : s.active }; });
  void saveProfiles(); void kvDel(`posts:${id}`);
}
/** adds the posts that are not known yet; returns the new ones */
export function mergePosts(id: string, incoming: Omit<Post, 'profileId' | 'seenAt'>[], markNew: boolean): Post[] {
  const cur = usePosts.getState().posts[id] ?? [];
  const known = new Set(cur.map((p) => p.id));
  // the same post read from another place (e.g. the backup archive) has another id: match it by its words and time
  const sig = (p: { text: string; date: number }) => p.text.replace(/\s+/g, ' ').trim().slice(0, 80).toLowerCase();
  const same = (p: { text: string; date: number }) => { const k = sig(p); return !!k && cur.some((c) => sig(c) === k && Math.abs(c.date - p.date) < 15 * 60_000); };
  const now = Date.now();
  const fresh: Post[] = incoming.filter((p) => !known.has(p.id) && !same(p)).map((p) => ({ ...p, profileId: id, seenAt: now, isNew: markNew }));
  if (!fresh.length) return [];
  const all = [...fresh, ...cur].sort((a, b) => b.date - a.date).slice(0, MAX_POSTS);
  usePosts.setState((s) => ({ posts: { ...s.posts, [id]: all } }));
  void savePosts(id);
  return fresh.filter((p) => all.includes(p));
}
export function updatePost(profileId: string, postId: string, patch: Partial<Post>) {
  usePosts.setState((s) => ({ posts: { ...s.posts, [profileId]: (s.posts[profileId] ?? []).map((p) => (p.id === postId ? { ...p, ...patch } : p)) } }));
  void savePosts(profileId);
}
export function removePost(profileId: string, postId: string) {
  usePosts.setState((s) => ({ posts: { ...s.posts, [profileId]: (s.posts[profileId] ?? []).filter((p) => p.id !== postId) } }));
  void savePosts(profileId);
}
export function markSeen(profileId: string) {
  const list = usePosts.getState().posts[profileId] ?? [];
  const prof = profileById(profileId);
  if (prof?.unread) updateProfile(profileId, { unread: 0 });
  if (list.some((p) => p.isNew)) { usePosts.setState((s) => ({ posts: { ...s.posts, [profileId]: list.map((p) => (p.isNew ? { ...p, isNew: false } : p)) } })); void savePosts(profileId); }
}
export const totalUnread = (s: PostsState) => s.profiles.reduce((n, p) => n + (p.unread || 0), 0);

// ---------- your own saved styles ----------
export interface SavedStyle { id: string; name: string; tpl: Template; createdAt: number }
export const useStyles = create<{ list: SavedStyle[]; loaded: boolean }>(() => ({ list: [], loaded: false }));
export async function loadStyles() { if (useStyles.getState().loaded) return; useStyles.setState({ list: (await kvGet<SavedStyle[]>('styles')) ?? [], loaded: true }); }
export function saveStyle(name: string, tpl: Template) {
  const st: SavedStyle = { id: `s${Date.now().toString(36)}`, name: name.trim() || 'My style', tpl: { ...tpl }, createdAt: Date.now() };
  useStyles.setState((s) => ({ list: [st, ...s.list] })); void kvSet('styles', useStyles.getState().list);
  return st;
}
export function deleteStyle(id: string) { useStyles.setState((s) => ({ list: s.list.filter((x) => x.id !== id) })); void kvSet('styles', useStyles.getState().list); }
