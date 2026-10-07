// Render queue: renders frames of a composition and encodes MP4 / WebM / GIF / image sequences.
import type { Composition, MotionProject } from '../types';
import { renderComp } from '../render/renderer';
import { prepareFrame, collectAudio, scheduleAudio } from '../media/playback';
import { muxMP4, muxWebM, type MuxSample, type AudioTrackInfo, type VideoTrackInfo } from './mux';
import { GifEncoder } from './gif';
import { ZipWriter } from './zip';
import { canvasToBlob, ctx2d } from '../../utils/canvas';

export type ExportFormat = 'mp4' | 'webm' | 'gif' | 'png-seq' | 'jpg-seq';
export interface ExportSettings {
  format: ExportFormat;
  /** output size */
  width: number;
  height: number;
  fps: number;
  /** 0..100 (JPEG / GIF dithering on above 50) */
  quality: number;
  /** Mbit/s for MP4 / WebM */
  bitrate: number;
  alpha: boolean;
  range: 'work' | 'all';
  audio: boolean;
  motionBlur: boolean;
}

export const FORMAT_INFO: Record<ExportFormat, { label: string; ext: string; alpha: boolean; audio: boolean }> = {
  mp4: { label: 'MP4 (H.264)', ext: 'mp4', alpha: false, audio: true },
  webm: { label: 'WebM (VP9)', ext: 'webm', alpha: true, audio: true },
  gif: { label: 'Animated GIF', ext: 'gif', alpha: true, audio: false },
  'png-seq': { label: 'PNG Sequence (.zip)', ext: 'zip', alpha: true, audio: false },
  'jpg-seq': { label: 'JPEG Sequence (.zip)', ext: 'zip', alpha: false, audio: false },
};

export const hasWebCodecs = () => typeof (window as unknown as { VideoEncoder?: unknown }).VideoEncoder === 'function';

async function pickVideoConfig(fmt: 'mp4' | 'webm', w: number, h: number, fps: number, bitrate: number, alpha: boolean): Promise<{ config: VideoEncoderConfig; codec: VideoTrackInfo['codec']; alpha: boolean }> {
  const big = w * h > 1920 * 1088 || fps > 30;
  const cands: { codec: string; kind: VideoTrackInfo['codec'] }[] = fmt === 'mp4'
    ? [{ codec: big ? 'avc1.640033' : 'avc1.640028', kind: 'avc' }, { codec: big ? 'avc1.4d0033' : 'avc1.4d0028', kind: 'avc' }, { codec: big ? 'avc1.420033' : 'avc1.42e028', kind: 'avc' }]
    : [{ codec: 'vp09.00.40.08', kind: 'vp9' }, { codec: 'vp09.00.10.08', kind: 'vp9' }, { codec: 'vp8', kind: 'vp8' }];
  for (const alphaTry of alpha ? [true, false] : [false]) {
    for (const c of cands) {
      const config: VideoEncoderConfig = { codec: c.codec, width: w, height: h, bitrate: Math.round(bitrate * 1e6), framerate: fps, ...(c.kind === 'avc' ? { avc: { format: 'avc' } } : {}), ...(alphaTry ? { alpha: 'keep' } : {}) } as VideoEncoderConfig;
      try { const s = await VideoEncoder.isConfigSupported(config); if (s.supported) return { config: s.config ?? config, codec: c.kind, alpha: alphaTry }; } catch { /* try next */ }
    }
  }
  throw new Error(fmt === 'mp4' ? 'This browser can’t encode H.264 video. Try WebM, GIF or an image sequence.' : 'This browser can’t encode WebM video. Try MP4, GIF or an image sequence.');
}

async function encodeAudio(project: MotionProject, comp: Composition, start: number, end: number, codec: 'aac' | 'opus'): Promise<{ info: AudioTrackInfo; samples: MuxSample[] } | null> {
  const clips = collectAudio(project, comp);
  if (!clips.length || typeof (window as unknown as { AudioEncoder?: unknown }).AudioEncoder !== 'function') return null;
  const sr = 48000, ch = 2;
  const ctx = new OfflineAudioContext(ch, Math.max(1, Math.ceil((end - start) * sr)), sr);
  scheduleAudio(ctx, clips, start, end, 0, comp.fps);
  const buf = await ctx.startRendering();
  const config: AudioEncoderConfig = { codec: codec === 'aac' ? 'mp4a.40.2' : 'opus', sampleRate: sr, numberOfChannels: ch, bitrate: 192000 };
  try { const s = await AudioEncoder.isConfigSupported(config); if (!s.supported) return null; } catch { return null; }
  const samples: MuxSample[] = []; let description: Uint8Array | undefined;
  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d);
      samples.push({ data: d, ts: chunk.timestamp, dur: chunk.duration ?? 0, key: true });
      if (meta?.decoderConfig?.description && !description) description = new Uint8Array(meta.decoderConfig.description as ArrayBuffer);
    },
    error: (e) => console.error(e),
  });
  enc.configure(config);
  const frame = 1024 * 4;
  for (let i = 0; i < buf.length; i += frame) {
    const n = Math.min(frame, buf.length - i);
    const data = new Float32Array(n * ch);
    for (let c = 0; c < ch; c++) data.set(buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)).subarray(i, i + n), c * n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round((i / sr) * 1e6), data });
    enc.encode(ad); ad.close();
  }
  await enc.flush(); enc.close();
  return { info: { codec, sampleRate: sr, channels: ch, description }, samples };
}

export interface ExportProgress { (p: number, label: string): void }

export async function exportComposition(project: MotionProject, comp: Composition, s: ExportSettings, progress: ExportProgress, signal: { cancelled: boolean }): Promise<Blob> {
  const start = s.range === 'work' ? comp.workStart : 0;
  const end = s.range === 'work' ? comp.workEnd : comp.duration;
  const n = Math.max(1, Math.round((end - start) * s.fps));
  const isVideo = s.format === 'mp4' || s.format === 'webm';
  let w = Math.max(2, Math.round(s.width)), h = Math.max(2, Math.round(s.height));
  if (s.format === 'mp4') { w -= w % 2; h -= h % 2; }
  const q = w / comp.width;
  const alpha = s.alpha && FORMAT_INFO[s.format].alpha;
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const out = ctx2d(canvas, s.format === 'gif');
  const render = async (i: number) => {
    const t = start + i / s.fps;
    await prepareFrame(project, comp, t, 'x');
    const frame = renderComp(project, comp, t, { quality: q, transparent: alpha, mbSamples: s.motionBlur ? 16 : 0, videoKey: 'x' });
    out.globalCompositeOperation = 'copy'; out.drawImage(frame, 0, 0, w, h); out.globalCompositeOperation = 'source-over';
  };

  if (isVideo) {
    if (!hasWebCodecs()) throw new Error('This browser can’t encode video. Use Chrome or Edge, or export a PNG sequence / GIF.');
    const fmt = s.format as 'mp4' | 'webm';
    const pick = await pickVideoConfig(fmt, w, h, s.fps, s.bitrate, alpha);
    const samples: MuxSample[] = []; let description: Uint8Array | undefined; let err: unknown = null;
    const enc = new VideoEncoder({
      output: (chunk, meta) => {
        const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d);
        const m = meta as (EncodedVideoChunkMetadata & { alphaSideData?: BufferSource }) | undefined;
        const alphaData = m?.alphaSideData ? new Uint8Array(m.alphaSideData instanceof ArrayBuffer ? m.alphaSideData : (m.alphaSideData as ArrayBufferView).buffer) : undefined;
        samples.push({ data: d, ts: chunk.timestamp, dur: chunk.duration ?? Math.round(1e6 / s.fps), key: chunk.type === 'key', alpha: alphaData });
        if (m?.decoderConfig?.description && !description) description = new Uint8Array(m.decoderConfig.description as ArrayBuffer);
      },
      error: (e) => { err = e; },
    });
    enc.configure(pick.config);
    const gop = Math.max(1, Math.round(s.fps * 2));
    for (let i = 0; i < n; i++) {
      if (signal.cancelled) { enc.close(); throw new Error('cancelled'); }
      if (err) throw err;
      await render(i);
      const vf = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / s.fps), duration: Math.round(1e6 / s.fps), ...(pick.alpha ? {} : { alpha: 'discard' }) } as VideoFrameInit);
      enc.encode(vf, { keyFrame: i % gop === 0 }); vf.close();
      while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 5));
      progress((i + 1) / n * 0.92, `Rendering frame ${i + 1} / ${n}`);
    }
    await enc.flush(); enc.close();
    if (err) throw err;
    progress(0.94, 'Encoding audio…');
    let audio: Awaited<ReturnType<typeof encodeAudio>> = null;
    if (s.audio) audio = await encodeAudio(project, comp, start, end, fmt === 'mp4' ? 'aac' : 'opus') ?? (fmt === 'mp4' ? await encodeAudio(project, comp, start, end, 'opus') : null);
    progress(0.98, 'Writing file…');
    const vinfo: VideoTrackInfo = { codec: pick.codec, width: w, height: h, fps: s.fps, description, alpha: pick.alpha };
    return fmt === 'mp4' ? muxMP4(vinfo, samples, audio?.info ?? null, audio?.samples ?? []) : muxWebM(vinfo, samples, audio?.info ?? null, audio?.samples ?? []);
  }

  if (s.format === 'gif') {
    const gif = new GifEncoder(w, h, true, s.quality > 50);
    for (let i = 0; i < n; i++) {
      if (signal.cancelled) throw new Error('cancelled');
      await render(i);
      await gif.addFrame(out.getImageData(0, 0, w, h).data, 1 / s.fps);
      progress((i + 1) / n, `Rendering frame ${i + 1} / ${n}`);
    }
    return gif.finish();
  }

  // image sequences
  const zip = new ZipWriter();
  const png = s.format === 'png-seq';
  const digits = String(n).length < 4 ? 4 : String(n).length;
  for (let i = 0; i < n; i++) {
    if (signal.cancelled) throw new Error('cancelled');
    await render(i);
    if (!png) { out.globalCompositeOperation = 'destination-over'; out.fillStyle = comp.background; out.fillRect(0, 0, w, h); out.globalCompositeOperation = 'source-over'; }
    const blob = await canvasToBlob(canvas, png ? 'image/png' : 'image/jpeg', png ? undefined : Math.max(0.1, s.quality / 100));
    zip.add(`${comp.name.replace(/[^\w\-]+/g, '_')}_${String(i).padStart(digits, '0')}.${png ? 'png' : 'jpg'}`, new Uint8Array(await blob.arrayBuffer()));
    progress((i + 1) / n, `Rendering frame ${i + 1} / ${n}`);
  }
  return zip.finish();
}
