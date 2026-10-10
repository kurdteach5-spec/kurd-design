// Renders the edited program to a video file by playing the synchronised recordings in real time,
// drawing the chosen camera into a canvas and recording canvas + master sound with MediaRecorder.
// Hard cuts are frame-accurate to the display; the master sound is recorded untouched.
import { usePod, masterTracks, audibleTracks, heardIds, heardGain } from './store';
import { drawProgramAt } from './compose';
import { renderCtx } from './player';
import { pause as pausePreview, mediaTime, follow } from './player';
import { exportRange } from './exports';

export interface RenderJob { progress: number; elapsed: number; cancel: () => void }

const QUALITY: Record<'high' | 'medium' | 'small', number> = { high: 1, medium: 0.55, small: 0.3 };

export function recorderFormat(): { mime: string; ext: 'mp4' | 'webm' } | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const c: [string, 'mp4' | 'webm'][] = [
    // H.264/AAC MP4 plays everywhere; otherwise WebM (an MP4 holding VP9 would not open in many players)
    ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'mp4'], ['video/mp4;codecs=avc1.4d0028,mp4a.40.2', 'mp4'], ['video/mp4;codecs=avc1,mp4a', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'], ['video/webm;codecs=vp8,opus', 'webm'], ['video/webm', 'webm'], ['video/mp4', 'mp4'],
  ];
  for (const [mime, ext] of c) if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  return null;
}

export async function renderProgram(onProgress: (p: number) => void, signal: { cancelled: boolean }): Promise<{ blob: Blob; name: string } | null> {
  const s = usePod.getState();
  const fmt = recorderFormat();
  if (!fmt) throw new Error('This browser can\'t record video. Use Chrome or Edge, or download the edit for Premiere / DaVinci.');
  pausePreview();
  const { start, end } = exportRange();
  if (end - start < 0.5) throw new Error('The export range is empty.');
  const fps = Math.min(60, Math.round(s.settings.fps));
  const W = s.output.width, H = s.output.height;
  // the clock follows the master sound; what is heard is the master or the automix tracks
  const master = new Set(masterTracks());
  const baseAudible = new Set(audibleTracks(s));
  const audible = new Set(heardIds(s));
  const used = new Set<string>();
  for (const x of s.segments.filter((q) => q.end > start && q.start < end)) {
    used.add(x.cam);
    for (const b of s.splits.find((sp) => sp.id === x.cam)?.boxes ?? []) if (b.cam) used.add(b.cam);
  }
  for (const o of s.overlays) if (o.end > start && o.start < end) for (const id of [o.key?.fill, o.key?.keySrc, o.dsk?.fill]) {
    if (!id) continue; used.add(id); for (const b of s.splits.find((sp) => sp.id === id)?.boxes ?? []) if (b.cam) used.add(b.cam);
  }
  const ids = Object.keys(s.sources).filter((id) => used.has(id) || master.has(id) || audible.has(id));

  // fresh elements just for this render
  const els = new Map<string, HTMLMediaElement>();
  for (const id of ids) {
    const src = s.sources[id]!;
    const el = document.createElement(src.kind === 'video' ? 'video' : 'audio');
    el.preload = 'auto'; el.src = src.url; (el as HTMLVideoElement).playsInline = true;
    el.muted = !audible.has(id);
    els.set(id, el);
  }
  const ac = new AudioContext();
  const dest = ac.createMediaStreamDestination();
  const gainNodes = new Map<string, GainNode>();
  for (const id of audible) {
    const el = els.get(id); if (!el) continue;
    el.muted = false;
    const g = ac.createGain(); ac.createMediaElementSource(el).connect(g); g.connect(dest); gainNodes.set(id, g);
  }
  const setGains = (T: number) => {
    for (const [id, g] of gainNodes) g.gain.setTargetAtTime(heardGain(id, T, s, baseAudible), ac.currentTime, 0.012);
  };
  for (const [id, g] of gainNodes) g.gain.value = heardGain(id, start, s, baseAudible);
  await ac.resume().catch(() => {});

  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const stream = canvas.captureStream(fps);
  for (const tr of dest.stream.getAudioTracks()) stream.addTrack(tr);
  const pixels = W * H;
  const rec = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: Math.round(pixels * fps * 0.14 * QUALITY[s.output.quality]), audioBitsPerSecond: 192000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  const cleanup = () => { for (const el of els.values()) { el.pause(); el.removeAttribute('src'); el.load(); } void ac.close().catch(() => {}); stream.getTracks().forEach((t) => t.stop()); };

  // seek everything to the start and wait until it can play
  await Promise.all([...els].map(([id, el]) => new Promise<void>((res) => {
    const m = mediaTime(id, start, s);
    if (!m) { res(); return; }
    const go = () => { el.currentTime = m.t; };
    el.addEventListener('canplay', () => res(), { once: true });
    if (el.readyState >= 1) go(); else el.addEventListener('loadedmetadata', go, { once: true });
    setTimeout(() => res(), 8000);
  })));
  if (signal.cancelled) { cleanup(); return null; }

  const startWall = performance.now();
  const clock = () => {
    for (const id of master) { const el = els.get(id); const src = s.sources[id]!; if (el && !el.paused && el.readyState >= 2) return el.currentTime - src.offset; }
    return start + (performance.now() - startWall) / 1000;
  };
  const sync = (t: number) => {
    for (const [id, el] of els) {
      if (master.has(id) && !el.paused) continue; // the clock follows the master sound
      follow(el, mediaTime(id, t, s), s.broll.includes(id));
    }
  };

  return new Promise((resolve, reject) => {
    let done = false;
    rec.onstop = () => {
      cleanup();
      if (signal.cancelled) { resolve(null); return; }
      const name = `${(s.sources[s.cameras.find((c) => c.role === 'wide')?.id ?? s.cameras[0]?.id ?? '']?.name ?? 'podcast').replace(/\.[^.]+$/, '')}-edit.${fmt.ext}`;
      resolve({ blob: new Blob(chunks, { type: fmt.mime.split(';')[0] }), name });
    };
    rec.onerror = () => { cleanup(); reject(new Error('Recording failed.')); };
    for (const [id, el] of els) { const m = mediaTime(id, start, s); if (m?.play) void el.play().catch(() => {}); }
    rec.start(1000);
    const loop = () => {
      if (done) return;
      if (signal.cancelled) { done = true; rec.stop(); return; }
      const t = clock();
      if (t >= end) { done = true; onProgress(1); rec.stop(); return; }
      sync(t);
      setGains(t);
      drawProgramAt(ctx, t, s.segments, s.overlays, renderCtx(s, (id) => els.get(id) as HTMLVideoElement | undefined, W, H));
      onProgress((t - start) / (end - start));
    };
    // animation frames for smooth drawing, plus a timer so a hidden tab keeps going (more slowly)
    const raf = () => { if (done) return; loop(); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    const timer = setInterval(() => { if (done) clearInterval(timer); else if (document.hidden) loop(); }, 1000 / fps);
  });
}
