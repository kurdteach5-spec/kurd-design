// Preview playback: advances the time indicator in real time, keeps video elements in sync and
// plays audio through Web Audio (with volume keyframes). Also collects audio for export.
import type { Composition, MLayer, MotionProject } from '../types';
import { valueAt } from '../anim';
import { useMotion, setTime, activeComp } from '../store';
import { activeAt, isVisual, sourceTime } from '../render/renderer';
import { assetData, getAudioContext, seekVideo, videoFor, allVideos } from './assets';

export const dbToGain = (db: number) => (db <= -48 ? 0 : Math.pow(10, db / 20));

// ---------- video sync ----------
interface VideoUse { el: HTMLVideoElement; t: number; rate: number }
/** Video elements the renderer will read at comp time t (recursing into precomps). */
export function videoUses(project: MotionProject, comp: Composition, t: number, key = 'p', depth = 0, out: VideoUse[] = []): VideoUse[] {
  if (depth > 6) return out;
  const anySolo = comp.layers.some((l) => l.solo && isVisual(l));
  for (const l of comp.layers) {
    if (!l.visible || !activeAt(l, t) || (anySolo && !l.solo)) continue;
    if (l.type === 'video') { const el = videoFor(l.assetId, `${key}:${l.id}`); if (el) out.push({ el, t: sourceTime(l, t), rate: l.speed }); }
    else if (l.type === 'precomp') { const sub = project.comps[l.compId]; if (sub) videoUses(project, sub, sourceTime(l, t), `${key}:${l.id}`, depth + 1, out); }
  }
  return out;
}

/** Seeks every video needed for an exact frame (export, paused scrubbing). */
export async function prepareFrame(project: MotionProject, comp: Composition, t: number, key = 'p') {
  const uses = videoUses(project, comp, t, key);
  await Promise.all(uses.map((u) => { if (!u.el.paused) u.el.pause(); return seekVideo(u.el, u.t); }));
}

function syncVideos(project: MotionProject, comp: Composition, t: number, playing: boolean) {
  const uses = videoUses(project, comp, t);
  const active = new Set(uses.map((u) => u.el));
  for (const u of uses) {
    if (playing) {
      if (Math.abs(u.el.playbackRate - u.rate) > 1e-3) u.el.playbackRate = Math.max(0.0625, Math.min(16, u.rate));
      if (u.el.paused) { u.el.currentTime = u.t; void u.el.play().catch(() => {}); }
      else if (Math.abs(u.el.currentTime - u.t) > 0.25) u.el.currentTime = u.t;
    } else {
      if (!u.el.paused) u.el.pause();
      if (Math.abs(u.el.currentTime - u.t) > 0.5 / comp.fps && !u.el.seeking) u.el.currentTime = u.t;
    }
  }
  for (const [k, el] of allVideos()) if (!active.has(el) && !el.paused && k.includes('|p:')) el.pause();
}

// ---------- audio ----------
export interface AudioClip { buffer: AudioBuffer; rootIn: number; rootOut: number; /** buffer time at rootIn */ srcIn: number; rate: number; gainAt: (rootT: number) => number; animated: boolean }

export function collectAudio(project: MotionProject, comp: Composition, map: { offset: number; rate: number } = { offset: 0, rate: 1 }, gainParent = (_t: number) => 1, depth = 0, out: AudioClip[] = []): AudioClip[] {
  if (depth > 6) return out;
  // root time → this comp's time: (rootT - offset) * rate
  const toLocal = (rt: number) => (rt - map.offset) * map.rate;
  const toRoot = (lt: number) => lt / map.rate + map.offset;
  const anySolo = comp.layers.some((l) => l.solo);
  for (const l of comp.layers) {
    if (!l.audioOn || (anySolo && !l.solo)) continue;
    if (l.type === 'audio' || l.type === 'video') {
      const d = assetData(l.assetId); if (!d?.audio) continue;
      const rootIn = toRoot(l.inPoint), rootOut = toRoot(l.outPoint);
      const vol = (l as Extract<MLayer, { volume: unknown }>).volume;
      out.push({
        buffer: d.audio, rootIn, rootOut, srcIn: sourceTime(l, l.inPoint), rate: l.speed * map.rate,
        gainAt: (rt) => dbToGain(valueAt(vol, toLocal(rt))) * gainParent(rt), animated: vol.k.length > 0 || depth > 0,
      });
    } else if (l.type === 'precomp' && l.visible) {
      const sub = project.comps[l.compId]; if (!sub) continue;
      // sub time = (local - start) * speed → root mapping
      const subMap = { offset: toRoot(l.start), rate: map.rate * l.speed };
      const lIn = toRoot(l.inPoint), lOut = toRoot(l.outPoint);
      const inner = collectAudio(project, sub, subMap, gainParent, depth + 1, []);
      for (const c of inner) {
        const a = Math.max(c.rootIn, lIn), b = Math.min(c.rootOut, lOut);
        if (b <= a) continue;
        out.push({ ...c, srcIn: c.srcIn + (a - c.rootIn) * c.rate, rootIn: a, rootOut: b });
      }
    }
  }
  return out;
}

/** Schedules clips on an audio context, starting at root time `from` until `to`. */
export function scheduleAudio(ctx: BaseAudioContext, clips: AudioClip[], from: number, to: number, when: number, fps: number): AudioBufferSourceNode[] {
  const nodes: AudioBufferSourceNode[] = [];
  for (const c of clips) {
    const a = Math.max(from, c.rootIn), b = Math.min(to, c.rootOut);
    if (b - a < 1e-3) continue;
    const src = ctx.createBufferSource(); src.buffer = c.buffer; src.playbackRate.value = c.rate;
    const g = ctx.createGain();
    const start = when + (a - from);
    if (c.animated) {
      const step = 1 / Math.max(30, fps);
      g.gain.setValueAtTime(c.gainAt(a), start);
      for (let t = a + step; t < b; t += step) g.gain.linearRampToValueAtTime(c.gainAt(t), when + (t - from));
    } else g.gain.value = c.gainAt(a);
    src.connect(g).connect(ctx.destination);
    const offset = c.srcIn + (a - c.rootIn) * c.rate;
    if (offset >= c.buffer.duration) continue;
    src.start(start, Math.max(0, offset), (b - a) * c.rate);
    nodes.push(src);
  }
  return nodes;
}

let sources: AudioBufferSourceNode[] = [];
function stopAudio() { for (const s of sources) { try { s.stop(); } catch { /* already stopped */ } } sources = []; }
function startAudio(project: MotionProject, comp: Composition, t: number) {
  stopAudio();
  const clips = collectAudio(project, comp);
  if (!clips.length) return;
  const ctx = getAudioContext();
  void ctx.resume();
  sources = scheduleAudio(ctx, clips, t, comp.workEnd > t ? comp.workEnd : comp.duration, ctx.currentTime + 0.03, comp.fps);
}

// ---------- transport ----------
let raf = 0;
let startPerf = 0, startT = 0;
let frames = 0, fpsT0 = 0;

export function play() {
  const s = useMotion.getState(); const comp = activeComp(s); if (!comp || s.playing) return;
  let t = s.times[comp.id] ?? 0;
  if (t >= comp.workEnd - 1 / comp.fps || t < comp.workStart) t = comp.workStart;
  setTime(t);
  startT = t; startPerf = performance.now(); frames = 0; fpsT0 = startPerf;
  useMotion.setState({ playing: true });
  startAudio(s.project, comp, t);
  syncVideos(s.project, comp, t, true);
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}

function tick(now: number) {
  const s = useMotion.getState(); const comp = activeComp(s);
  if (!s.playing || !comp) return;
  let t = startT + (now - startPerf) / 1000;
  const end = comp.workEnd;
  if (t >= end) {
    if (s.loop) { t = comp.workStart; startT = t; startPerf = now; startAudio(s.project, comp, t); for (const u of videoUses(s.project, comp, t)) u.el.currentTime = u.t; }
    else { setTime(end - 1 / comp.fps); pause(); return; }
  }
  const prev = s.times[comp.id];
  setTime(t);
  if (useMotion.getState().times[comp.id] !== prev) frames++;
  if (now - fpsT0 > 1000) { useMotion.setState({ measuredFps: Math.round((frames * 1000) / (now - fpsT0)) }); frames = 0; fpsT0 = now; }
  syncVideos(s.project, comp, t, true);
  raf = requestAnimationFrame(tick);
}

export function pause() {
  cancelAnimationFrame(raf);
  stopAudio();
  const s = useMotion.getState(); const comp = activeComp(s);
  useMotion.setState({ playing: false, measuredFps: 0 });
  if (comp) syncVideos(s.project, comp, s.times[comp.id] ?? 0, false);
}
export function stop() { const c = activeComp(); pause(); if (c) setTime(c.workStart); }
export function togglePlay() { if (useMotion.getState().playing) pause(); else play(); }

/** Keeps paused video frames in step with the time indicator. */
export function syncPaused() {
  const s = useMotion.getState(); const comp = activeComp(s);
  if (comp && !s.playing) syncVideos(s.project, comp, s.times[comp.id] ?? 0, false);
}
