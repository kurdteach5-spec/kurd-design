// Synchronised playback of the camera recordings + the program (edited) picture.
// Every source has its own media element; the timeline clock follows the master sound when it plays,
// so picture and sound stay together. Elements that drift are nudged (small drift) or re-seeked.
// B-roll clips are not synchronised: they play from the shot's `srcIn` and are prepared (seeked)
// shortly before their shot starts.
import { usePod, masterTracks, refTrack, isBroll, audibleTracks, heardIds, heardGain, type PodState } from './store';
import { drawProgramAt, drawInput, type RenderCtx } from './compose';
import { liveTrans, mediaImage } from './mixer';

const els = new Map<string, HTMLMediaElement>();
/** called on every playback frame (vision mixer monitors) */
export const frameListeners = new Set<() => void>();
const urls = new Map<string, string>();
let raf = 0;
let clockStart = 0, clockT = 0;
let program: HTMLCanvasElement | null = null;
let lastStoreUpdate = 0;

/**
 * Where source `id` should be at timeline time T: { t, play } — play=false means hold (paused) at t,
 * null means the source is not needed now.
 */
export function mediaTime(id: string, T: number, s: Pick<PodState, 'sources' | 'broll' | 'segments'>): { t: number; play: boolean } | null {
  const src = s.sources[id]; if (!src) return null;
  if (!isBroll(id, s)) { const t = T + src.offset; return t >= 0 && t < src.duration ? { t, play: true } : null; }
  const segs = s.segments;
  const ci = segs.findIndex((x) => T >= x.start && T < x.end); const cur = segs[ci];
  if (cur && cur.cam === id) return { t: Math.min(src.duration - 0.05, (cur.srcIn ?? 0) + (T - cur.start)), play: true };
  // the previous shot keeps playing during a dissolve
  const prev = ci > 0 ? segs[ci - 1] : null;
  const td = cur?.trans?.dur ?? cur?.mix ?? 0;
  if (td && prev && prev.cam === id && T < cur!.start + td) return { t: Math.min(src.duration - 0.05, (prev.srcIn ?? 0) + (T - prev.start)), play: true };
  // prepare the next B-roll shot of this clip (within 2 s)
  const next = segs.find((x) => x.cam === id && x.start > T && x.start - T < 2);
  if (next) return { t: next.srcIn ?? 0, play: false };
  return null;
}

/** media element of a source (created on demand, re-created when the file changes) */
export function elementFor(id: string): HTMLMediaElement | null {
  const src = usePod.getState().sources[id];
  if (!src) { const old = els.get(id); if (old) { old.pause(); old.removeAttribute('src'); old.load(); els.delete(id); urls.delete(id); } return null; }
  let el = els.get(id);
  if (!el || urls.get(id) !== src.url) {
    if (el) { el.pause(); el.removeAttribute('src'); el.load(); }
    el = document.createElement(src.kind === 'video' ? 'video' : 'audio');
    el.preload = 'auto'; el.muted = true; (el as HTMLVideoElement).playsInline = true;
    el.src = src.url;
    el.addEventListener('seeked', () => { if (!usePod.getState().playing) { drawProgram(); frameListeners.forEach((f) => f()); } });
    el.addEventListener('loadeddata', () => { syncPaused(); });
    els.set(id, el); urls.set(id, src.url);
  }
  return el;
}

export function setProgramCanvas(c: HTMLCanvasElement | null) { program = c; drawProgram(); }

/** everything the renderer needs, for a canvas of W × H */
export function renderCtx(s: PodState, video: (id: string) => HTMLVideoElement | undefined, W: number, H: number): RenderCtx {
  return { W, H, fit: s.output.fit, splits: s.splits, video, image: (mp) => mediaImage(s.mp[mp === 'mp1' ? 0 : 1]), colors: s.colors, fallback: refTrack(s) ?? 'blk', time: s.time, framing: (id) => s.framing[id], still: (id) => mediaImage(id) };
}
const vid = (id: string) => els.get(id) as HTMLVideoElement | undefined;

/** draws the program (the edit) at the current time */
export function drawProgram(at?: number) {
  const c = program; if (!c) return;
  drawProgramTo(c, at);
}

/** draws the program into any canvas (vision mixer) */
export function drawProgramTo(c: HTMLCanvasElement, at?: number) {
  const s = usePod.getState(); const ctx = c.getContext('2d'); if (!ctx) return;
  drawProgramAt(ctx, at ?? s.time, s.segments, s.overlays, renderCtx(s, vid, c.width, c.height), liveTrans);
}

/** draws one input (camera, split screen, B-roll, switcher source) into a canvas — vision mixer monitors */
export function drawInputTo(c: HTMLCanvasElement, id: string) {
  const s = usePod.getState(); const ctx = c.getContext('2d'); if (!ctx) return;
  for (const cam of s.splits.find((x) => x.id === id)?.boxes.map((b) => b.cam) ?? [id]) if (cam) elementFor(cam);
  drawInput(ctx, id, renderCtx(s, vid, c.width, c.height));
}

export function drawFit(ctx: CanvasRenderingContext2D, v: HTMLVideoElement, W: number, H: number, fit: 'cover' | 'contain') {
  const k = fit === 'cover' ? Math.max(W / v.videoWidth, H / v.videoHeight) : Math.min(W / v.videoWidth, H / v.videoHeight);
  const w = v.videoWidth * k, h = v.videoHeight * k;
  ctx.drawImage(v, (W - w) / 2, (H - h) / 2, w, h);
}

const allIds = (): string[] => Object.keys(usePod.getState().sources);

// ---------- sound: every source goes through a gain (automix, master selection) ----------
let actx: AudioContext | null = null;
const gains = new WeakMap<HTMLMediaElement, GainNode>();
const analysers = new WeakMap<HTMLMediaElement, AnalyserNode>();
const meterBuf = new Float32Array(512);
/** current sound level of a source, 0..1 (−60…0 dBFS), for the multiview meters; null before playback starts */
export function levelOf(id: string): number | null {
  const el = els.get(id); const an = el ? analysers.get(el) : undefined; if (!an || !el || el.paused) return null;
  an.getFloatTimeDomainData(meterBuf);
  let sum = 0; for (let i = 0; i < meterBuf.length; i++) sum += meterBuf[i] * meterBuf[i];
  const db = 20 * Math.log10(Math.sqrt(sum / meterBuf.length) + 1e-9);
  return Math.max(0, Math.min(1, (db + 60) / 60));
}
function gainFor(el: HTMLMediaElement): GainNode | null {
  try {
    if (!actx) actx = new AudioContext();
    let g = gains.get(el);
    if (!g) {
      const src = actx.createMediaElementSource(el); g = actx.createGain(); src.connect(g); g.connect(actx.destination); gains.set(el, g);
      const an = actx.createAnalyser(); an.fftSize = 512; src.connect(an); analysers.set(el, an);
    }
    el.muted = false;
    return g;
  } catch { return null; }
}
/** sets every source's level for timeline time T (instant = no smoothing) */
function applyAudio(T: number, instant = false) {
  const s = usePod.getState();
  const audible = new Set(audibleTracks(s));
  const heard = new Set(heardIds(s));
  for (const id of allIds()) {
    const el = elementFor(id); if (!el || isBroll(id, s)) { if (el) el.muted = true; continue; }
    const want = heard.has(id) ? heardGain(id, T, s, audible) : 0;
    if (!actx && want === 0) { el.muted = true; continue; }
    const g = gainFor(el);
    if (!g || !actx) { el.muted = want < 0.5; continue; }
    if (instant) g.gain.value = want; else g.gain.setTargetAtTime(want, actx.currentTime, 0.012);
  }
}
function applyMute() { applyAudio(usePod.getState().time, true); }

/** paused: every element shows its frame for the current time */
export function syncPaused() {
  const s = usePod.getState();
  if (s.playing) return;
  for (const id of allIds()) {
    const el = elementFor(id); const m = mediaTime(id, s.time, s); if (!el || !m) continue;
    if (Math.abs(el.currentTime - m.t) > 0.02) el.currentTime = m.t;
  }
  drawProgram();
  frameListeners.forEach((f) => f());
}

export function seek(t: number) {
  const s = usePod.getState();
  const an = s.analysis;
  const lo = an?.start ?? 0, hi = an?.end ?? Infinity;
  const tt = Math.max(lo, Math.min(hi, t));
  if (s.playing) {
    usePod.setState({ time: tt });
    clockStart = performance.now(); clockT = tt;
    for (const id of allIds()) { const el = els.get(id); const m = mediaTime(id, tt, s); if (el && m) el.currentTime = m.t; }
  } else usePod.setState({ time: tt });
}

function clockTime(): number {
  const s = usePod.getState();
  // follow the first master element that is playing inside its recording
  for (const id of masterTracks(s)) {
    const el = els.get(id); const src = s.sources[id];
    if (el && src && !el.paused && el.readyState >= 3) return el.currentTime - src.offset;
  }
  return clockT + (performance.now() - clockStart) / 1000;
}

/** keeps one element at its wanted time while playing */
export function follow(el: HTMLMediaElement, m: { t: number; play: boolean } | null, strict: boolean) {
  if (!m) { if (!el.paused) el.pause(); return; }
  if (!m.play) { if (!el.paused) el.pause(); if (Math.abs(el.currentTime - m.t) > 0.05) el.currentTime = m.t; return; }
  if (el.paused) { el.currentTime = m.t; void el.play().catch(() => {}); return; }
  const drift = el.currentTime - m.t;
  if (Math.abs(drift) > (strict ? 0.12 : 0.25)) { el.currentTime = m.t; el.playbackRate = 1; }
  else if (Math.abs(drift) > 0.03) el.playbackRate = drift > 0 ? 0.97 : 1.03;
  else el.playbackRate = 1;
}

function tick() {
  const s = usePod.getState();
  if (!s.playing) return;
  const end = s.analysis?.end ?? Infinity;
  let t = clockTime();
  if (t >= end) { t = end; pause(); usePod.setState({ time: t }); return; }
  for (const id of allIds()) { const el = els.get(id); if (el) follow(el, mediaTime(id, t, s), isBroll(id, s)); }
  applyAudio(t);
  const now = performance.now();
  if (now - lastStoreUpdate > 33) { usePod.setState({ time: t }); lastStoreUpdate = now; }
  drawProgram(t);
  frameListeners.forEach((f) => f());
  raf = requestAnimationFrame(tick);
}

export function play() {
  const s = usePod.getState(); if (s.playing || !refTrack(s)) return;
  let t = s.time;
  if (s.analysis && t >= s.analysis.end - 0.05) t = s.analysis.start;
  applyAudio(t, true);
  void actx?.resume().catch(() => {});
  clockStart = performance.now(); clockT = t;
  for (const id of allIds()) {
    const el = elementFor(id); const m = mediaTime(id, t, s); if (!el || !m) continue;
    el.playbackRate = 1; el.currentTime = m.t;
    if (m.play) void el.play().catch(() => {});
  }
  usePod.setState({ playing: true, time: t });
  cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
}
export function pause() {
  cancelAnimationFrame(raf);
  for (const el of els.values()) el.pause();
  usePod.setState({ playing: false });
  syncPaused();
}
export const togglePlay = () => (usePod.getState().playing ? pause() : play());
export function step(frames: number) {
  const s = usePod.getState(); if (s.playing) pause();
  seek(s.time + frames / s.settings.fps);
}
/** stop everything (leaving the workspace) */
export function stopAll() { if (usePod.getState().playing) pause(); }
usePod.subscribe((s, p) => {
  if (s.master !== p.master || s.sources !== p.sources || s.speakers !== p.speakers || s.settings !== p.settings || s.analysis !== p.analysis || s.audioIn !== p.audioIn || (!s.playing && s.segments !== p.segments)) applyMute();
  if (!s.playing && (s.time !== p.time || s.sources !== p.sources)) syncPaused();
  else if (s.segments !== p.segments && !s.playing) syncPaused();
});
