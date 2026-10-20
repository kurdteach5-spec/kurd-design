// Audio for the Sound Library: renders built-in tracks, decodes uploads, makes waveforms from the real
// samples, plays one preview at a time and saves WAV / MP3 downloads.
import type { Track } from './catalog';
import { renderMusic } from './music';
import { renderSfx } from './sfx';
import { useLib, getUpload, peaksOf, savePeaks, countPlay, trackById } from './store';
import { saveBlob } from '../file-system/exporters';
import { convert } from '../podcast/ffmpeg';
import { ZipWriter } from '../motion/export/zip';
import { onlineWaveform } from './online';
import { licenseOf } from './catalog';
import { toast, toastError } from '../state/uiStore';

export const PEAKS = 180;

// ---------------- buffers ----------------
const cache = new Map<string, AudioBuffer>();
const pending = new Map<string, Promise<AudioBuffer>>();
let decodeCtx: AudioContext | null = null;
const dctx = () => (decodeCtx ??= new AudioContext());

export function bufferFor(t: Track): Promise<AudioBuffer> {
  const hit = cache.get(t.id); if (hit) { cache.delete(t.id); cache.set(t.id, hit); return Promise.resolve(hit); }
  let p = pending.get(t.id);
  if (!p) {
    p = (async () => {
      let b: AudioBuffer;
      if (t.music) b = await renderMusic(t);
      else if (t.sfx) b = normalize(await renderSfx(t));
      else if (t.remote) b = await dctx().decodeAudioData(await (await remoteBlob(t)).arrayBuffer());
      else { const u = await getUpload(t.id); if (!u) throw new Error('This upload is no longer in the library.'); b = await dctx().decodeAudioData(await u.audio.arrayBuffer()); }
      cache.set(t.id, b); while (cache.size > 6) cache.delete(cache.keys().next().value as string);
      if (!peaksOf(t.id)) savePeaks(t.id, computePeaks(b));
      return b;
    })().finally(() => pending.delete(t.id));
    pending.set(t.id, p);
  }
  return p;
}

/** every sound effect peaks at −1 dBFS, so quiet effects are not too quiet and nothing clips */
export function normalize(b: AudioBuffer, target = 0.89): AudioBuffer {
  let peak = 0; for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; } }
  if (peak < 1e-4) return b;
  const k = target / peak; for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; }
  return b;
}

/** loudest sample per slice, 0..255 */
export function computePeaks(b: AudioBuffer, n = PEAKS): Uint8Array {
  const out = new Uint8Array(n); const chans = Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));
  const per = Math.max(1, Math.floor(b.length / n)); let max = 0; const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) { let m = 0; const s0 = i * per, s1 = Math.min(b.length, s0 + per); for (let s = s0; s < s1; s += 2) for (const d of chans) { const v = Math.abs(d[s]); if (v > m) m = v; } raw[i] = m; if (m > max) max = m; }
  for (let i = 0; i < n; i++) out[i] = Math.round((raw[i] / (max || 1)) * 255);
  return out;
}

/** waveform queue: renders visible tracks one after another, in idle time */
const queue: string[] = []; let busy = false;
export function requestPeaks(id: string) {
  if (peaksOf(id) || queue.includes(id)) return;
  queue.push(id); void pump();
}
async function pump() {
  if (busy) return; busy = true;
  while (queue.length) {
    const id = queue.shift()!; const t = trackById(id); if (!t || peaksOf(id)) continue;
    if (t.remote) continue; // online sounds: the waveform is fetched when the sound is played (keeps searches within the API limits)
    try {
      // the waveform only needs the shape of the sound: a quick low-rate render (the full one is made on play)
      if (t.music) savePeaks(id, computePeaks(await renderMusic(t, 8000)));
      else if (t.sfx) savePeaks(id, computePeaks(await renderSfx(t, 11025)));
      else await bufferFor(t);
    } catch { /* shown when played */ }
    await new Promise((r) => setTimeout(r, 30));
  }
  busy = false;
}

// ---------------- WAV ----------------
export function encodeWav(b: AudioBuffer): Blob {
  const ch = b.numberOfChannels, sr = b.sampleRate, n = b.length;
  const buf = new ArrayBuffer(44 + n * ch * 2); const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => b.getChannelData(c)); let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, data[c][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Blob([buf], { type: 'audio/wav' });
}

// ---------------- player ----------------
const el = typeof Audio !== 'undefined' ? new Audio() : (null as unknown as HTMLAudioElement);
let url: string | null = null; let ticket = 0; let resumeWhenFull = false;
if (el) {
  el.preload = 'auto';
  el.addEventListener('timeupdate', () => useLib.setState({ time: el.currentTime }));
  el.addEventListener('durationchange', () => {
    const t = trackById(useLib.getState().current);
    if (t?.builtin && el.duration < t.duration - 1) return; // the quick-start part: keep the full length on the bar
    if (Number.isFinite(el.duration)) useLib.setState({ duration: el.duration });
  });
  el.addEventListener('play', () => useLib.setState({ playing: true }));
  el.addEventListener('pause', () => useLib.setState({ playing: false }));
  el.addEventListener('ended', () => {
    // the quick-start part ended before the full render was ready: wait for it instead of stopping
    const s = useLib.getState(); const t = trackById(s.current); if (t?.music && el.duration < t.duration - 1) { resumeWhenFull = true; return; }
    useLib.setState({ playing: false, time: 0 });
  });
  el.volume = useLib.getState().volume;
  // smooth progress while playing
  const tick = () => { if (!el.paused) useLib.setState({ time: el.currentTime }); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
}

/** plays a track (switching from the one playing); clicking the playing track pauses it */
export async function playTrack(id: string, at?: number) {
  const s = useLib.getState();
  if (s.current === id && (url || el.src)) {
    if (at !== undefined) { el.currentTime = at * (el.duration || 0); if (el.paused) void el.play(); return; }
    if (el.paused) void el.play(); else el.pause();
    return;
  }
  const t = trackById(id); if (!t) return;
  const my = ++ticket; resumeWhenFull = false;
  el.pause();
  useLib.setState({ current: id, loading: id, time: 0, duration: t.duration, error: null });
  try {
    let src: Blob;
    if (t.remote) {
      // online sound: plays straight from its host
      if (url) URL.revokeObjectURL(url); url = null;
      el.src = t.remote.url; el.loop = useLib.getState().loop;
      if (at !== undefined) el.currentTime = at * t.duration;
      await el.play();
      countPlay(id);
      if (!peaksOf(id)) void onlineWaveform(t).then((pts) => { if (pts?.length) { const n = PEAKS; const m = Math.max(...pts) || 1; savePeaks(id, Uint8Array.from({ length: n }, (_, i) => Math.round((pts[Math.floor((i / n) * pts.length)] / m) * 255))); } });
      return;
    }
    if (!t.builtin) { const u = await getUpload(id); if (!u) throw new Error('This upload is no longer in the library.'); src = u.audio; void bufferFor(t).catch(() => {}); }
    else if (t.music && !cache.has(t.id) && t.duration > 20) {
      // quick start: the first seconds play while the whole piece renders, then it continues seamlessly
      const full = bufferFor(t);
      src = encodeWav(await renderMusic(t, 44100, 12));
      void full.then((b) => {
        if (my !== ticket) return;
        const pos = el.currentTime, wasPlaying = !el.paused || resumeWhenFull; resumeWhenFull = false;
        const u2 = URL.createObjectURL(encodeWav(b));
        if (url) URL.revokeObjectURL(url);
        url = u2; el.src = u2; el.currentTime = pos; useLib.setState({ duration: b.duration });
        if (wasPlaying) void el.play();
      }).catch(() => {});
    }
    else src = encodeWav(await bufferFor(t));
    if (my !== ticket) return;
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(src); el.src = url; el.loop = useLib.getState().loop;
    if (at !== undefined) el.currentTime = at * t.duration;
    await el.play();
    countPlay(id);
  } catch (e) {
    if (my !== ticket) return;
    useLib.setState({ error: (e as Error).message || 'This sound could not be played.' });
    toastError((e as Error).message || 'This sound could not be played.');
  } finally { if (my === ticket) useLib.setState({ loading: null }); }
}
export function togglePlay() { const s = useLib.getState(); if (!s.current) return; if (el.paused) void el.play(); else el.pause(); }
export function seek(frac: number) {
  const d = useLib.getState().duration || el.duration; if (!d) return;
  el.currentTime = Math.min(Math.max(0, Math.min(1, frac)) * d, Math.max(0, (el.duration || d) - 0.05));
}
export function setVolume(v: number) { el.volume = v; useLib.setState({ volume: v }); try { localStorage.setItem('sarwar-lib-vol', String(v)); } catch { /* ignore */ } }
export function setLoop(on: boolean) { el.loop = on; useLib.setState({ loop: on }); }
export function stopLibrary() { if (el) el.pause(); }

// ---------------- downloads ----------------
const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 80) || 'sound';
/** the file of an online sound (needs the host to allow downloads from other sites) */
const remoteBlobs = new Map<string, Blob>();
export async function remoteBlob(t: Track): Promise<Blob> {
  const hit = remoteBlobs.get(t.id); if (hit) return hit;
  const r = await fetch(t.remote!.url, { mode: 'cors' });
  if (!r.ok) throw new Error(`The file could not be fetched (${r.status}).`);
  const b = await r.blob(); remoteBlobs.set(t.id, b); while (remoteBlobs.size > 8) remoteBlobs.delete(remoteBlobs.keys().next().value as string);
  return b;
}
export async function audioBlob(t: Track, fmt: 'wav' | 'mp3' | 'original'): Promise<{ blob: Blob; name: string }> {
  const base = `${safe(t.title)}_SARWAR-Library`;
  if (t.remote) {
    const nameBase = `${safe(t.title)}_${safe(t.remote.creator || t.remote.provider)}`;
    const blob = await remoteBlob(t);
    const ext = (t.format || 'mp3').toLowerCase();
    if (fmt === 'original' || (fmt === 'mp3' && ext === 'mp3')) return { blob, name: `${nameBase}.${ext}` };
    const wav = encodeWav(await dctx().decodeAudioData(await blob.arrayBuffer()));
    if (fmt === 'wav') return { blob: wav, name: `${nameBase}.wav` };
    toast('Making the MP3… (the converter loads once, ~30 MB)', 'info', 4000);
    const mp3 = await convert(wav, 'in.wav', ['-c:a', 'libmp3lame', '-b:a', '256k'], 'out.mp3');
    return { blob: new Blob([mp3 as BlobPart], { type: 'audio/mpeg' }), name: `${nameBase}.mp3` };
  }
  if (fmt === 'original' && !t.builtin) { const u = await getUpload(t.id); if (u) return { blob: u.audio, name: u.fileName }; }
  const wav = encodeWav(await bufferFor(t));
  if (fmt === 'wav' || fmt === 'original') return { blob: wav, name: `${base}.wav` };
  toast('Making the MP3… (the converter loads once, ~30 MB)', 'info', 4000);
  const mp3 = await convert(wav, 'in.wav', ['-c:a', 'libmp3lame', '-b:a', '256k'], 'out.mp3');
  return { blob: new Blob([mp3 as BlobPart], { type: 'audio/mpeg' }), name: `${base}.mp3` };
}
export async function downloadTrack(t: Track, fmt: 'wav' | 'mp3' | 'original') {
  try {
    let got: { blob: Blob; name: string };
    try { got = await audioBlob(t, fmt); }
    catch (e) {
      if (!t.remote) throw e;
      // the host does not allow downloads from other sites: open the file there, where it can be saved
      const a = document.createElement('a'); a.href = t.remote.url; a.target = '_blank'; a.rel = 'noopener'; a.download = ''; document.body.appendChild(a); a.click(); a.remove();
      toast(`The file opened from ${t.remote.provider} — save it from there. Licence: ${licenseOf(t.license).label}.`, 'info', 7000);
      if (t.attribution) { try { await navigator.clipboard.writeText(t.attribution); toast('The attribution text was copied — paste it in your video description or credits.', 'success', 5000); } catch { /* clipboard blocked */ } }
      return;
    }
    const { blob, name } = got;
    try { await saveBlob(blob, name); }
    catch (e) {
      // some hosts only allow certain file types: deliver the audio inside a .zip
      if (!/can't be saved here/.test((e as Error).message)) throw e;
      const z = new ZipWriter(); z.add(name, new Uint8Array(await blob.arrayBuffer()));
      if (t.attribution) z.add('ATTRIBUTION.txt', new TextEncoder().encode(t.attribution));
      await saveBlob(z.finish(), name.replace(/\.[^.]+$/, '.zip'));
    }
    if (t.attribution && t.license !== 'original' && t.license !== 'cc0' && t.license !== 'public-domain') {
      try { await navigator.clipboard.writeText(t.attribution); toast('Downloaded. The attribution text was copied — paste it in your video description or credits.', 'success', 6000); } catch { toast(`Credit: ${t.attribution}`, 'info', 9000); }
    }
    countPlay(t.id, 0);
    useLib.setState((s) => ({ plays: { ...s.plays } }));
  } catch (e) { toastError((e as Error).message || 'The download failed.'); }
}
