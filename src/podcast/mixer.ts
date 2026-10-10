// Vision mixer (switcher) actions, modelled on a Blackmagic ATEM: program/preview buses, CUT, AUTO, T-bar,
// transition styles, "next transition" (background / key), upstream key ON AIR, downstream keys with
// TIE / ON AIR / AUTO, fade to black. Everything is recorded on the timeline at the current time.
import { usePod, segmentAt, cutTo, ensureTimeline, addSplit, applySplitPreset, inputsOf, allInputsOf, type PodState } from './store';
import { create } from '../state/createStore';
import { IMAGE_EXT } from './ffmpeg';
import { toastError } from '../state/uiStore';
import { isVirtual, type DskConfig, type KeyConfig, type Overlay, type TransParams, type SplitLayout } from './types';

const get = () => usePod.getState();
const set = usePod.setState;
let seq = 0;
const oid = () => `ov${Date.now().toString(36)}${(seq++).toString(36)}`;
const frame = () => 1 / (get().settings.fps || 30);

// ---------- live transition (T-bar) ----------
/** a transition in progress (T-bar dragged, or AUTO running while paused) — drawn by the program monitor */
export let liveTrans: { from: string; to: string; p: number; tp: TransParams; t0: number } | null = null;
export const liveListeners = new Set<() => void>();
const notify = () => liveListeners.forEach((f) => f());

export const programAt = (t = get().time) => segmentAt(t)?.cam ?? null;

/** the preview bus: the chosen input, or — when none is chosen or it is already on program — the next input */
export function previewOf(s: PodState = get()): string | null {
  const pgm = segmentAt(s.time, s.segments)?.cam ?? null;
  const all = allInputsOf(s);
  if (s.previewInput && s.previewInput !== pgm && all.includes(s.previewInput)) return s.previewInput;
  const rec = inputsOf(s);
  if (!rec.length) return null;
  const i = pgm ? rec.indexOf(pgm) : -1;
  for (let k = 1; k <= rec.length; k++) { const c = rec[(i + k + rec.length) % rec.length]; if (c !== pgm) return c; }
  return null;
}

// ---------- overlays (keys, DSK, FTB) ----------
export function activeOverlay(kind: Overlay['kind'], slot: number, t = get().time, s: Pick<PodState, 'overlays'> = get()) {
  return s.overlays.find((o) => o.kind === kind && o.slot === slot && t >= o.start && t < o.end) ?? null;
}
/** turns a key / DSK / FTB on (until it is turned off or the next one starts) or off, at the current time */
function toggleOverlay(kind: Overlay['kind'], slot: number, fade: number, cfg: Partial<Pick<Overlay, 'key' | 'dsk'>> = {}) {
  if (!ensureTimeline()) { toastError('Add cameras first.'); return; }
  const s = get(); const t = s.time; const end = s.analysis!.end;
  const on = activeOverlay(kind, slot, t);
  let overlays: Overlay[];
  if (on) {
    overlays = s.overlays.map((o) => (o.id === on.id ? { ...o, end: t + fade, fadeOut: fade } : o)).filter((o) => o.end - o.start > frame());
  } else {
    const next = s.overlays.filter((o) => o.kind === kind && o.slot === slot && o.start > t).sort((a, b) => a.start - b.start)[0];
    overlays = [...s.overlays, { id: oid(), kind, slot, start: t, end: next ? next.start : end, fadeIn: fade, fadeOut: 0, ...cfg }];
  }
  set({ overlays, edited: true });
}
/** changing key settings while it is on air changes the recorded key too */
export function setKey(patch: Partial<KeyConfig>) {
  const s = get(); const usk = { ...s.usk, ...patch };
  const on = activeOverlay('usk', 1);
  set({ usk, overlays: on ? s.overlays.map((o) => (o.id === on.id ? { ...o, key: usk } : o)) : s.overlays });
}
export function setDsk(slot: 0 | 1, patch: Partial<DskConfig>) {
  const s = get(); const d = { ...s.dsk[slot], ...patch };
  const dsk: [DskConfig, DskConfig] = slot === 0 ? [d, s.dsk[1]] : [s.dsk[0], d];
  const on = activeOverlay('dsk', slot + 1);
  set({ dsk, overlays: on ? s.overlays.map((o) => (o.id === on.id ? { ...o, dsk: d } : o)) : s.overlays });
}
export const keyOnAir = () => toggleOverlay('usk', 1, 0, { key: get().usk });
export const dskCut = (slot: 0 | 1) => toggleOverlay('dsk', slot + 1, 0, { dsk: get().dsk[slot] });
export const dskAuto = (slot: 0 | 1) => toggleOverlay('dsk', slot + 1, get().dsk[slot].rate, { dsk: get().dsk[slot] });
export const ftb = () => toggleOverlay('ftb', 1, get().ftbRate);
export function removeOverlay(id: string) { set((s) => ({ overlays: s.overlays.filter((o) => o.id !== id), edited: true })); }

// ---------- buses ----------
export function setPreview(id: string) { set({ previewInput: id }); }
/** program bus: hot cut */
export function programCut(id: string) {
  if (!ensureTimeline()) return;
  const before = programAt(); cutTo(id);
  if (get().previewInput === id && before && before !== id) set({ previewInput: before }); // like a switcher: the old program goes to preview
}

/** CUT / AUTO: performs the next transition (background and/or key, plus tied DSKs) */
export function performTransition(auto: boolean) {
  if (!ensureTimeline()) { toastError('Add cameras first.'); return; }
  if (liveTrans) { liveTrans = null; notify(); } // a T-bar left half-way is replaced by the new transition
  const s = get();
  const tp = s.trans;
  const fade = auto ? tp.dur : 0;
  const pv = previewOf(s);
  const pgm = programAt();
  if (s.nextBg !== false && pv && pv !== pgm) { cutTo(pv, s.time, auto ? tp : 0); set({ previewInput: pgm }); }
  if (s.nextKey) toggleOverlay('usk', 1, fade, { key: s.usk });
  ([0, 1] as const).forEach((i) => { if (s.dsk[i].tie) toggleOverlay('dsk', i + 1, fade, { dsk: s.dsk[i] }); });
  if (auto && !s.playing) animateLive(pgm, pv, tp);
}

/** while paused, AUTO plays the transition on the program monitor so it can be seen */
function animateLive(from: string | null, to: string | null, tp: TransParams) {
  if (!from || !to || from === to) return;
  const start = performance.now();
  const step = () => {
    const p = Math.min(1, (performance.now() - start) / 1000 / Math.max(0.05, tp.dur));
    liveTrans = p < 1 ? { from, to, p, tp, t0: get().time } : null;
    notify();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- T-bar ----------
export function tbarMove(p: number) {
  if (!ensureTimeline()) return;
  const s = get(); const from = liveTrans?.from ?? programAt(); const to = liveTrans?.to ?? previewOf(s);
  if (!from || !to || from === to) return;
  if (p >= 0.999) {
    // transition complete: written to the timeline, lasting as long as the T-bar move (while playing)
    const t0 = liveTrans?.t0 ?? s.time;
    const dur = s.playing ? Math.max(frame(), s.time - t0) : s.trans.dur;
    liveTrans = null; notify();
    cutTo(to, s.playing ? t0 : s.time, { ...s.trans, dur });
    set({ previewInput: from });
    return;
  }
  liveTrans = { from, to, p: Math.max(0, p), tp: s.trans, t0: liveTrans?.t0 ?? s.time };
  notify();
}
export function tbarCancel() { liveTrans = null; notify(); }

// ---------- names, colours, media ----------
export const VIRTUAL_NAMES: Record<string, string> = { mp1: 'MP1', mp2: 'MP2', col1: 'COL1', col2: 'COL2', bars: 'BARS', blk: 'BLK' };
export function setLabel(id: string, name: string) { set((s) => ({ labels: { ...s.labels, [id]: name } })); }

const images = new Map<string, HTMLImageElement>();
export const mediaImage = (id: string | null | undefined) => (id ? images.get(id) : undefined);
/** pictures for the media pool; asInputs: each also becomes an input button (a still) */
export async function addMedia(files: File[], asInputs = false) {
  for (const f of files) {
    if (!f.type.startsWith('image/') && !IMAGE_EXT.test(f.name)) { toastError(`${f.name}: choose an image (PNG with transparency for logos and lower thirds).`); continue; }
    const url = URL.createObjectURL(f);
    const img = new Image(); img.src = url;
    try { await img.decode(); } catch { toastError(`Unable to read ${f.name}`); continue; }
    const id = `media${Date.now().toString(36)}${(seq++).toString(36)}`;
    images.set(id, img);
    set((s) => {
      const media = [...s.media, { id, name: f.name, url }];
      const mp: [string | null, string | null] = [s.mp[0] ?? id, s.mp[0] ? s.mp[1] ?? (s.mp[0] !== id ? id : null) : s.mp[1]];
      return { media, mp, stills: asInputs ? [...s.stills, id] : s.stills };
    });
  }
}
export function setMp(i: 0 | 1, id: string | null) { set((s) => ({ mp: (i === 0 ? [id, s.mp[1]] : [s.mp[0], id]) as [string | null, string | null] })); }
export function removeMedia(id: string) {
  images.delete(id);
  set((s) => ({ media: s.media.filter((m) => m.id !== id), stills: s.stills.filter((x) => x !== id), segments: s.segments.map((x) => (x.cam === id ? { ...x, cam: 'blk' } : x)), mp: s.mp.map((m) => (m === id ? null : m)) as [string | null, string | null] }));
}

// ---------- ATEM Mini style panel ----------
/** input button on a cut-bus panel: CUT mode cuts straight to it, AUTO mode makes the selected transition */
export function pressInput(id: string) {
  if (!ensureTimeline()) { toastError('Add cameras first.'); return; }
  const s = get();
  const pgm = programAt();
  if (s.cutMode === 'cut' || pgm === id) { cutTo(id); if (pgm && pgm !== id) set({ previewInput: pgm }); return; }
  cutTo(id, s.time, s.trans);
  if (pgm) set({ previewInput: pgm });
  if (!s.playing) animateLive(pgm, id, s.trans);
}
/** picture-in-picture position buttons: corner of the DVE key (top-left, top-right, bottom-left, bottom-right) */
export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export function pipCorner(c: Corner) {
  const k = get().usk; const w = k.dve.w, h = k.dve.h, m = 0.04;
  const x = c === 'tl' || c === 'bl' ? m : 1 - m - w;
  const y = c === 'tl' || c === 'tr' ? m * 16 / 9 : 1 - m * 16 / 9 - h;
  setKey({ type: 'dve', dve: { ...k.dve, x, y } });
}
export function pipCornerOf(k: KeyConfig): Corner | null {
  if (k.type !== 'dve') return null;
  const left = k.dve.x + k.dve.w / 2 < 0.5, top = k.dve.y + k.dve.h / 2 < 0.5;
  return `${top ? 't' : 'b'}${left ? 'l' : 'r'}` as Corner;
}
/** KEY / PIP ON and OFF buttons */
export function keySet(on: boolean, dve = false) {
  if (dve) {
    const k = get().usk; const cams = get().cameras.map((c) => c.id);
    const fill = isVirtual(k.fill) || !get().sources[k.fill] && !get().splits.some((x) => x.id === k.fill) ? (cams.find((c) => c !== programAt()) ?? cams[0] ?? k.fill) : k.fill;
    if (k.type !== 'dve' || fill !== k.fill) setKey({ type: 'dve', fill, keySrc: fill });
  }
  if (!!activeOverlay('usk', 1) !== on) keyOnAir();
}
export const isFtb = () => !!activeOverlay('ftb', 1);

// ---------- SuperSource quick controls ----------
/** the SuperSource the panel buttons work on */
export const useSS = create<{ active: string | null }>(() => ({ active: null }));
export function activeSS(): string | null {
  const sp = get().splits; const a = useSS.getState().active;
  return sp.find((x) => x.id === a)?.id ?? sp[0]?.id ?? null;
}
/** one click: makes the SuperSource with this layout (cameras filled in automatically) */
export function ssLayout(layout: SplitLayout): string | null {
  if (!get().cameras.length) { toastError('Add cameras first.'); return null; }
  let id = activeSS();
  if (id) applySplitPreset(id, layout); else id = addSplit(layout);
  useSS.setState({ active: id });
  return id;
}
/** puts the SuperSource on program (CUT or AUTO, like an input button) */
export function ssOn() {
  const id = activeSS() ?? ssLayout('side2'); if (!id) return;
  pressInput(id);
}
/** puts the SuperSource on preview (software panel: then CUT / AUTO) */
export function ssPreview() {
  const id = activeSS() ?? ssLayout('side2'); if (!id) return;
  setPreview(id);
}
