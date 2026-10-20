// Online sounds: searches openly licensed audio (Creative Commons and public domain) through the
// Openverse API (WordPress.org), which gathers sounds from Freesound, Jamendo, Wikimedia Commons and more.
// Every result keeps its licence, creator and attribution; sounds play and download from the original host.
import { create } from '../state/createStore';
import type { Kind, License, Track } from './catalog';
import { MUSIC, SFX } from './catalog';

const API = 'https://api.openverse.org/v1/audio/';

/** good English search words for each category (the API is searched in English) */
export const ONLINE_QUERIES: Record<string, string> = {
  // music
  cinematic: 'cinematic', epic: 'epic trailer', emotional: 'emotional piano', sad: 'sad', happy: 'happy', corporate: 'corporate', news: 'news', documentary: 'documentary',
  action: 'action', suspense: 'suspense', horror: 'horror', ambient: 'ambient', inspirational: 'inspirational', motivational: 'motivational', relaxing: 'relaxing meditation',
  lofi: 'lofi', electronic: 'electronic', hiphop: 'hip hop', poprock: 'rock', classical: 'classical', kurdish: 'kurdish', arabic: 'arabic', sports: 'sport', podcast: 'podcast background',
  intro: 'intro', logo: 'logo', transitions: 'transition', tech: 'technology',
  // sound effects
  whoosh: 'whoosh', impacts: 'impact', risers: 'riser', explosions: 'explosion', weather: 'rain thunder wind', nature: 'birds nature', city: 'city traffic', footsteps: 'footsteps',
  ui: 'notification click', scifi: 'sci-fi', horror_sfx: 'horror', crowd: 'applause crowd', sports_sfx: 'whistle sport', news_sfx: 'news jingle', camera: 'camera shutter', glitch: 'glitch', foley: 'foley',
};
export const onlineQueryFor = (kind: Kind, category: string) => ONLINE_QUERIES[kind === 'sfx' && ['horror', 'sports', 'news'].includes(category) ? `${category}_sfx` : category]
  ?? (kind === 'sfx' ? SFX : MUSIC).find((c) => c.id === category)?.name ?? category;

const LIC: Record<string, License> = {
  cc0: 'cc0', pdm: 'public-domain', by: 'cc-by', 'by-sa': 'cc-by-sa', 'by-nd': 'cc-by-nd', 'by-nc': 'cc-by-nc', 'by-nc-sa': 'cc-by-nc-sa', 'by-nc-nd': 'cc-by-nc-nd', 'sampling+': 'sampling', 'nc-sampling+': 'sampling',
};

export interface OnlineQuery { q: string; kind: Kind | 'all'; commercial: boolean; length: 'all' | 'xs' | 's' | 'm' | 'l' }
export interface OnlineState {
  query: OnlineQuery | null;
  results: Track[];
  page: number; pages: number; total: number;
  loading: boolean; error: string | null;
  /** online tracks kept (favourites), so they stay in the library */
  saved: Track[];
}
const SAVED = 'sarwar-lib-online-saved';
const readSaved = (): Track[] => { try { return JSON.parse(localStorage.getItem(SAVED) || '[]'); } catch { return []; } };
export const useOnline = create<OnlineState>(() => ({ query: null, results: [], page: 0, pages: 0, total: 0, loading: false, error: null, saved: readSaved() }));
export function keepOnline(t: Track, keep: boolean) {
  const saved = keep ? [t, ...useOnline.getState().saved.filter((x) => x.id !== t.id)] : useOnline.getState().saved.filter((x) => x.id !== t.id);
  useOnline.setState({ saved }); try { localStorage.setItem(SAVED, JSON.stringify(saved.slice(0, 500))); } catch { /* storage full */ }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toTrack(r: any, kind: Kind): Track {
  const license = LIC[String(r.license ?? '').toLowerCase()] ?? 'licensed';
  const tags: string[] = Array.isArray(r.tags) ? r.tags.map((t: any) => String(t.name ?? t)).filter(Boolean).slice(0, 12) : [];
  const genres: string[] = Array.isArray(r.genres) ? r.genres.map(String) : [];
  const provider = String(r.source || r.provider || 'openverse');
  const ext = String(r.filetype || (String(r.url).match(/\.([a-z0-9]{2,4})(\?|$)/i)?.[1] ?? '')).toUpperCase();
  const lv = r.license_version ? ` ${r.license_version}` : '';
  const licName = license === 'cc0' ? 'CC0' : license === 'public-domain' ? 'Public Domain Mark' : `CC ${String(r.license).toUpperCase()}${lv}`;
  const attribution = r.attribution || `“${r.title || 'Untitled'}” by ${r.creator || 'unknown'} is licensed under ${licName}${r.license_url ? ` (${r.license_url})` : ''}. Source: ${r.foreign_landing_url || provider}.`;
  return {
    id: `ov_${r.id}`, kind, title: String(r.title || 'Untitled').slice(0, 120), category: `online-${provider}`, categoryName: provider[0].toUpperCase() + provider.slice(1),
    moods: tags.slice(0, 3), genre: genres[0] ? genres[0][0].toUpperCase() + genres[0].slice(1) : kind === 'sfx' ? 'Sound effect' : 'Music',
    instruments: [], tags, bpm: null, duration: r.duration ? Number(r.duration) / 1000 : 0, format: ext || 'Audio', license, attribution,
    description: r.creator ? `by ${r.creator}` : undefined, addedAt: r.indexed_on ? Date.parse(r.indexed_on) || 0 : 0, builtin: false, seed: 0,
    cover: typeof r.thumbnail === 'string' && r.thumbnail ? r.thumbnail : null,
    remote: { url: String(r.url), landing: String(r.foreign_landing_url || r.detail_url || ''), creator: String(r.creator || ''), creatorUrl: r.creator_url ?? null, licenseUrl: String(r.license_url || ''), provider, waveform: typeof r.waveform === 'string' ? r.waveform : null },
  };
}

const cache = new Map<string, { at: number; data: any }>();
let ticket = 0;
/** first page (page = 1) replaces the results, later pages add to them */
export async function searchOnline(q: OnlineQuery, page = 1) {
  const my = ++ticket;
  useOnline.setState((s) => ({ query: q, loading: true, error: null, ...(page === 1 ? { results: [], page: 0, pages: 0, total: 0 } : {}) }));
  const p = new URLSearchParams({ q: q.q.trim() || (q.kind === 'sfx' ? 'sound effect' : 'music'), page: String(page), page_size: '20', mature: 'false' });
  if (q.kind === 'music') p.set('category', 'music');
  if (q.kind === 'sfx') p.set('category', 'sound_effect');
  if (q.commercial) p.set('license_type', 'commercial');
  if (q.length !== 'all') p.set('length', q.length === 'xs' ? 'shortest' : q.length === 's' ? 'short' : q.length === 'm' ? 'medium' : 'long');
  const url = `${API}?${p}`;
  try {
    let data = cache.get(url);
    if (!data || Date.now() - data.at > 30 * 60 * 1000) {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.status === 429) throw new Error('Too many searches in a short time — please wait a minute and try again.');
      if (!res.ok) throw new Error(`The online library answered with an error (${res.status}).`);
      data = { at: Date.now(), data: await res.json() }; cache.set(url, data);
    }
    if (my !== ticket) return;
    const d = data.data;
    const kind: Kind = q.kind === 'music' ? 'music' : 'sfx';
    const items: Track[] = (d.results ?? []).filter((r: any) => r && r.url).map((r: any) => toTrack(r, q.kind === 'all' ? (r.category === 'music' ? 'music' : 'sfx') : kind));
    useOnline.setState((s) => ({ results: page === 1 ? items : [...s.results, ...items.filter((x) => !s.results.some((y) => y.id === x.id))], page, pages: Number(d.page_count ?? 1), total: Number(d.result_count ?? items.length), loading: false }));
  } catch (e) {
    if (my !== ticket) return;
    const msg = e instanceof TypeError ? 'The online library could not be reached. Check the internet connection and try again.' : (e as Error).message;
    useOnline.setState({ loading: false, error: msg });
  }
}

/** waveform points (0..1) from Openverse, for the waveform of an online sound */
export async function onlineWaveform(t: Track): Promise<number[] | null> {
  if (!t.remote?.waveform) return null;
  try { const r = await fetch(t.remote.waveform); if (!r.ok) return null; const j = await r.json(); return Array.isArray(j.points) ? j.points.map(Number) : null; } catch { return null; }
}
