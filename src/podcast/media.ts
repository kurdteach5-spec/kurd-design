// Media helpers for the multicam editor: metadata, low-rate audio for analysis, frame probes.
import type { Source } from './types';

export const ANALYSIS_RATE = 8000;
const MAX_DECODE_BYTES = 1.9e9;

export function mediaKind(f: File): 'video' | 'audio' | null {
  if (f.type.startsWith('video/') || VIDEO_EXT.test(f.name)) return 'video';
  if (f.type.startsWith('audio/') || AUDIO_EXT.test(f.name)) return 'audio';
  return null;
}

/**
 * Like loadSource, but a file the browser can't play (AVI, WMV, HEVC, MXF, WMA, AC3…) is first converted
 * to MP4 / M4A with the built-in converter.
 */
export async function loadAnySource(id: string, file: File): Promise<Source> {
  const kind = mediaKind(file);
  if (!kind) throw new Error(`Unsupported file: ${file.name}`);
  try {
    const src = await loadSource(id, file);
    if (kind === 'video' && !src.width) throw new Error('no picture');
    return src;
  } catch {
    const label = `Converting ${file.name}`;
    useConvert.setState({ label, p: 0 });
    try {
      const out = await toPlayable(file, kind, (p) => useConvert.setState({ p }), (n) => useConvert.setState({ label: `${file.name}: ${n}` }));
      return { ...(await loadSource(id, out)), name: file.name };
    } finally { useConvert.setState({ label: null, p: 0 }); }
  }
}

import { VIDEO_EXT, AUDIO_EXT, toPlayable } from './ffmpeg';
import { useConvert } from './convertStatus';

/** Loads duration/size of a file the browser can play. */
export function loadSource(id: string, file: File): Promise<Source> {
  const kind = mediaKind(file);
  if (!kind) return Promise.reject(new Error(`Unsupported file: ${file.name}`));
  const url = URL.createObjectURL(file);
  return new Promise((res, rej) => {
    const el = document.createElement(kind === 'video' ? 'video' : 'audio') as HTMLVideoElement;
    el.preload = 'metadata'; el.muted = true;
    el.onloadedmetadata = () => {
      res({ id, file, name: file.name, url, kind, duration: Number.isFinite(el.duration) ? el.duration : 0, width: el.videoWidth || 0, height: el.videoHeight || 0, offset: 0 });
      el.removeAttribute('src'); el.load();
    };
    el.onerror = () => { URL.revokeObjectURL(url); rej(new Error(kind === 'video' ? `This browser can't play ${file.name}. Use MP4 (H.264) or WebM.` : `This browser can't play ${file.name}.`)); };
    el.src = url;
  });
}

/** Mono audio at 8 kHz — enough for loudness, sync and speech detection, and light on memory. */
export async function decodeLowRate(file: File): Promise<Float32Array> {
  if (file.size > MAX_DECODE_BYTES) throw new Error(`${file.name} is too large to read its sound in the browser. Add the audio of this camera as a separate file (WAV/MP3).`);
  const buf = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, ANALYSIS_RATE);
  let ab: AudioBuffer;
  try { ab = await ctx.decodeAudioData(buf); } catch { throw new Error(`No readable sound in ${file.name}.`); }
  const n = ab.length, out = new Float32Array(n);
  for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / ab.numberOfChannels; }
  return out;
}

/**
 * Seeks a probe video and returns a small grayscale thumbnail of the frame, used to measure how much
 * a camera's picture moves (people who speak move their head and hands more).
 */
export class FrameProbe {
  private v: HTMLVideoElement;
  private c = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  constructor(url: string) {
    this.v = document.createElement('video'); this.v.muted = true; this.v.preload = 'auto'; this.v.src = url;
    this.c.width = 48; this.c.height = 27;
    this.ctx = this.c.getContext('2d', { willReadFrequently: true })!;
  }
  async grab(t: number): Promise<Float32Array | null> {
    const v = this.v;
    if (v.readyState < 1) await new Promise<void>((r) => { v.addEventListener('loadedmetadata', () => r(), { once: true }); setTimeout(r, 4000); });
    if (!(t >= 0 && t < v.duration)) return null;
    await new Promise<void>((r) => { const done = () => { clearTimeout(to); r(); }; const to = setTimeout(done, 3000); v.addEventListener('seeked', done, { once: true }); v.currentTime = t; });
    try { this.ctx.drawImage(v, 0, 0, 48, 27); } catch { return null; }
    const d = this.ctx.getImageData(0, 0, 48, 27).data, g = new Float32Array(48 * 27);
    for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
    return g;
  }
  /** mean absolute change between t and t + dt */
  async motion(t: number, dt = 0.3): Promise<number | null> {
    const a = await this.grab(t), b = await this.grab(t + dt);
    if (!a || !b) return null;
    let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / a.length;
  }
  dispose() { this.v.removeAttribute('src'); this.v.load(); }
}
