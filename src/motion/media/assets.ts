// Runtime media for the Motion workspace: decoded images, video elements, audio buffers, waveforms.
// The project only stores AssetMeta; the bytes live here (and in saved project files).
import type { AssetKind, AssetMeta } from '../types';
import { uid } from '../../utils/id';
import { create } from '../../state/createStore';

export interface AssetData {
  blob: Blob;
  url: string;
  image?: HTMLImageElement | ImageBitmap;
  audio?: AudioBuffer | null;
  /** max |amplitude| per 1/100 s */
  peaks?: Float32Array;
}

const data = new Map<string, AssetData>();
/** bumps when decoded media becomes available, so views re-render */
export const useAssetVersion = create<{ v: number }>(() => ({ v: 0 }));
const bump = () => useAssetVersion.setState((s) => ({ v: s.v + 1 }));

export const assetData = (id: string) => data.get(id) ?? null;

let audioCtx: AudioContext | null = null;
export function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  return audioCtx;
}

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|ogv|mkv|avi)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|svg|avif|ico)$/i;

export function kindOf(file: { name: string; type: string }): AssetKind | null {
  if (file.type.startsWith('video/') || VIDEO_EXT.test(file.name)) return 'video';
  if (file.type.startsWith('audio/') || AUDIO_EXT.test(file.name)) return 'audio';
  if (file.type.startsWith('image/') || IMAGE_EXT.test(file.name)) return 'image';
  return null;
}

function loadImageEl(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = () => rej(new Error('Unable to decode image')); i.src = url; });
}

function videoMeta(url: string): Promise<{ w: number; h: number; d: number }> {
  return new Promise((res, rej) => {
    const v = document.createElement('video'); v.preload = 'metadata'; v.muted = true; v.playsInline = true;
    const done = () => { res({ w: v.videoWidth || 1280, h: v.videoHeight || 720, d: Number.isFinite(v.duration) ? v.duration : 10 }); v.removeAttribute('src'); v.load(); };
    v.onloadedmetadata = done;
    v.onerror = () => rej(new Error('This video format is not supported by the browser.'));
    v.src = url;
  });
}

async function decodeAudio(blob: Blob): Promise<AudioBuffer | null> {
  try { return await getAudioContext().decodeAudioData(await blob.arrayBuffer()); } catch { return null; }
}

function computePeaks(buf: AudioBuffer): Float32Array {
  const per = Math.max(1, Math.floor(buf.sampleRate / 100));
  const n = Math.ceil(buf.length / per);
  const out = new Float32Array(n);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      let m = out[i];
      const end = Math.min(d.length, (i + 1) * per);
      for (let j = i * per; j < end; j += 4) { const v = Math.abs(d[j]); if (v > m) m = v; }
      out[i] = m;
    }
  }
  return out;
}

/** Decodes a file into an asset (meta for the project + runtime data). */
export async function importAsset(file: File | Blob, name: string, id = uid('asset')): Promise<AssetMeta> {
  const kind = kindOf({ name, type: file.type });
  if (!kind) throw new Error(`Unsupported file: ${name}`);
  const url = URL.createObjectURL(file);
  const d: AssetData = { blob: file, url };
  let meta: AssetMeta;
  if (kind === 'image') {
    const img = await loadImageEl(url);
    d.image = img;
    meta = { id, name, kind, mime: file.type || 'image/*', width: img.naturalWidth || 512, height: img.naturalHeight || 512, duration: 0, hasAudio: false };
  } else if (kind === 'video') {
    const m = await videoMeta(url);
    meta = { id, name, kind, mime: file.type || 'video/mp4', width: m.w, height: m.h, duration: m.d, hasAudio: false };
    data.set(id, d);
    // audio track (decoded in the background; videos without sound simply have none)
    void decodeAudio(file).then((buf) => {
      d.audio = buf; if (buf) { d.peaks = computePeaks(buf); audioFound.set(id, true); bump(); }
    });
  } else {
    const buf = await decodeAudio(file);
    if (!buf) throw new Error(`Unable to decode audio: ${name}`);
    d.audio = buf; d.peaks = computePeaks(buf);
    meta = { id, name, kind, mime: file.type || 'audio/*', width: 0, height: 0, duration: buf.duration, hasAudio: true };
  }
  data.set(id, d);
  bump();
  return meta;
}
/** video assets whose audio track was found after import */
export const audioFound = new Map<string, boolean>();
export const hasAudio = (meta: AssetMeta) => meta.hasAudio || !!audioFound.get(meta.id) || !!data.get(meta.id)?.audio;

export function forgetAsset(id: string) {
  const d = data.get(id); if (!d) return;
  URL.revokeObjectURL(d.url); data.delete(id);
  for (const [k, v] of videos) if (k.startsWith(id + '|')) { v.pause(); v.removeAttribute('src'); v.load(); videos.delete(k); }
}
export function clearAssets() { for (const id of [...data.keys()]) forgetAsset(id); }

// ---------- video elements ----------
const videos = new Map<string, HTMLVideoElement>();
/** One <video> per (asset, layer instance) so layers can show different times. */
export function videoFor(assetId: string, key: string): HTMLVideoElement | null {
  const d = data.get(assetId); if (!d) return null;
  const k = `${assetId}|${key}`;
  let v = videos.get(k);
  if (!v) {
    v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    v.src = d.url;
    v.addEventListener('loadeddata', () => { videoFrameSeq++; bump(); }, { once: true });
    v.addEventListener('seeked', () => { videoFrameSeq++; onVideoFrame.forEach((f) => f()); });
    videos.set(k, v);
  }
  return v;
}
export const onVideoFrame = new Set<() => void>();
/** increments whenever any video element shows a new frame (cache key for video layers) */
export let videoFrameSeq = 0;
export const allVideos = () => videos;

/** Seeks a video element to time t and resolves when that frame is ready to draw. */
export function seekVideo(v: HTMLVideoElement, t: number, tolerance = 0.5 / 60): Promise<void> {
  const target = Math.max(0, Math.min(t, (Number.isFinite(v.duration) ? v.duration : t + 1) - 0.001));
  if (v.readyState >= 2 && Math.abs(v.currentTime - target) <= tolerance && !v.seeking) return Promise.resolve();
  return new Promise((res) => {
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); res(); };
    const timer = setTimeout(finish, 4000);
    const onSeeked = () => {
      v.removeEventListener('seeked', onSeeked);
      const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback;
      if (rvfc && !v.paused) rvfc.call(v, finish); else finish();
    };
    v.addEventListener('seeked', onSeeked);
    const start = () => { v.currentTime = target; };
    if (v.readyState >= 1) start(); else v.addEventListener('loadedmetadata', start, { once: true });
  });
}

/** Decoded image for image assets. */
export function imageFor(assetId: string): HTMLImageElement | ImageBitmap | null {
  return data.get(assetId)?.image ?? null;
}

/** Restores runtime data for assets loaded from a project file. */
export async function restoreAsset(meta: AssetMeta, blob: Blob) {
  await importAsset(new File([blob], meta.name, { type: meta.mime }), meta.name, meta.id);
}
