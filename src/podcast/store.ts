// State and editing actions of the Podcast (multicam) workspace.
import { create } from '../state/createStore';
import { IMAGE_EXT, type RenderFormat } from './ffmpeg';
import { toast, toastError } from '../state/uiStore';
import { PodAnalyzer } from './analysisKernel';
import { autoEdit, cleanup, segId, paint } from './autoEdit';
import { automix, gainAt, type AutomixTrack } from './audioMix';
import { ANALYSIS_RATE, decodeLowRate, FrameProbe, loadAnySource, mediaKind } from './media';
import { PACING, defaultSettings, presetRects, noCrop, editKeyAt, type SSBox, VIRTUAL, defaultTrans, defaultKey, defaultDsk, defaultMultiview, type Analysis, type Camera, type CamRole, type EditSettings, type Pacing, type Rig, type Segment, type Source, type Speaker, type Split, type SplitLayout, type TransParams, type KeyConfig, type DskConfig, type Overlay, type MultiviewConfig } from './types';

export type Phase = 'idle' | 'decoding' | 'syncing' | 'speakers' | 'checking' | 'done' | 'error';
/** 'auto', 'mics' (all microphones) or a source id */
export type MasterAudio = string;
export type AudioMode = 'auto' | 'afv' | 'on' | 'off';

export interface OutputSettings { width: number; height: number; fit: 'cover' | 'contain'; quality: 'high' | 'medium' | 'small' }

export interface PodState {
  sources: Record<string, Source>;
  /** cameras in the user's order (keys 1…9) */
  cameras: Camera[];
  speakers: Speaker[];
  /** B-roll clip ids (not synchronised) */
  broll: string[];
  /** split-screen inputs */
  splits: Split[];
  /** workspace view: editing monitors or the vision mixer */
  panel: 'edit' | 'mixer';
  /** file format of the rendered video */
  renderFormat: RenderFormat;
  /** still pictures (media pool ids) used as inputs */
  stills: string[];
  /** framing of each camera picture in the output (Reels, square…): centre 0..1 and zoom */
  framing: Record<string, { x: number; y: number; zoom: number }>;
  /** vision mixer preview bus */
  previewInput: string | null;
  /** switcher: input names, colours, media pool and players, transition, keys, overlays, multiview */
  labels: Record<string, string>;
  colors: { col1: string; col2: string };
  media: { id: string; name: string; url: string }[];
  mp: [string | null, string | null];
  trans: TransParams;
  /** next transition: background and/or upstream key 1 */
  nextBg: boolean;
  nextKey: boolean;
  usk: KeyConfig;
  dsk: [DskConfig, DskConfig];
  ftbRate: number;
  overlays: Overlay[];
  multiview: MultiviewConfig;
  /** audio mixer per source (camera or microphone): auto = automix / master, AFV = heard while on program, ON, OFF; level in dB */
  audioIn: Record<string, { mode: AudioMode; db: number }>;
  /** ATEM Mini input buttons: CUT = hard cut, AUTO = the selected transition */
  cutMode: 'cut' | 'auto';
  /** big monitor of the mixer workspace (VIDEO OUT): multiview, program, or one input */
  videoOut: string;
  phase: Phase;
  progress: number;
  message: string;
  analysis: Analysis | null;
  /** result of the picture check: null = not run; changed = voices were re-assigned to other people */
  pictureCheck: { changed: boolean; confidence: number } | null;
  settings: EditSettings;
  segments: Segment[];
  past: Segment[][];
  future: Segment[][];
  edited: boolean;
  master: MasterAudio;
  time: number;
  playing: boolean;
  selected: string | null;
  /** export range (I / O keys) */
  inPoint: number | null;
  outPoint: number | null;
  view: { pxPerSec: number; scroll: number };
  output: OutputSettings;
}

let idSeq = 0;
const newId = (p: string) => `${p}${Date.now().toString(36)}${(idSeq++).toString(36)}`;
const savedNames = (() => { try { const n = JSON.parse(localStorage.getItem('kurd-podcast-speakers') || 'null'); return Array.isArray(n) ? (n as string[]) : null; } catch { return null; } })();

export const usePod = create<PodState>(() => ({
  sources: {}, cameras: [], broll: [], splits: [], panel: 'edit', previewInput: null, stills: [], framing: {}, renderFormat: 'mp4',
  labels: {}, colors: { col1: '#1e4fa8', col2: '#c0392b' }, media: [], mp: [null, null], trans: defaultTrans(), nextBg: true, nextKey: false,
  usk: defaultKey(), dsk: [defaultDsk('mp1'), defaultDsk('mp2')], ftbRate: 1, overlays: [], multiview: defaultMultiview(),
  audioIn: {}, cutMode: 'cut', videoOut: 'mv',
  speakers: (savedNames && savedNames.length >= 2 ? savedNames : ['', '']).slice(0, 8).map((name, i) => ({ id: `sp${i + 1}`, name, mic: null })),
  phase: 'idle', progress: 0, message: '', analysis: null, pictureCheck: null,
  settings: defaultSettings(), segments: [], past: [], future: [], edited: false,
  master: 'auto', time: 0, playing: false, selected: null, inPoint: null, outPoint: null,
  view: { pxPerSec: 20, scroll: 0 },
  output: { width: 1920, height: 1080, fit: 'cover', quality: 'high' },
}));
usePod.subscribe((s, p) => { if (s.speakers !== p.speakers) { try { localStorage.setItem('kurd-podcast-speakers', JSON.stringify(s.speakers.map((x) => x.name))); } catch { /* ignore */ } } });

const get = () => usePod.getState();
const set = usePod.setState;

/** speaker name, or "Speaker 1", "Speaker 2"… when none was typed */
export function speakerName(id: string, s: Pick<PodState, 'speakers'> = get()): string {
  const i = s.speakers.findIndex((x) => x.id === id);
  return s.speakers[i]?.name.trim() || `Speaker ${i + 1}`;
}

// ---------- rig ----------
export function rigOf(s: Pick<PodState, 'cameras' | 'speakers' | 'broll' | 'sources' | 'splits'> = get()): Rig {
  const speakerCams: Record<string, string[]> = {};
  for (const sp of s.speakers) speakerCams[sp.id] = s.cameras.filter((c) => c.role === 'speaker' && c.speaker === sp.id).map((c) => c.id);
  return {
    speakers: s.speakers.map((x) => x.id),
    speakerCams,
    wides: s.cameras.filter((c) => c.role === 'wide').map((c) => c.id),
    inserts: s.cameras.filter((c) => c.role === 'insert').map((c) => c.id),
    broll: s.broll.filter((id) => s.sources[id]).map((id) => ({ id, duration: s.sources[id].duration })),
    splits: s.splits.map((x) => ({ id: x.id, people: [...new Set(x.boxes.filter((b) => b.on).map((b) => s.cameras.find((k) => k.id === b.cam)?.speaker).filter((v): v is string => !!v))] })),
  };
}
export const isBroll = (id: string, s: Pick<PodState, 'broll'> = get()) => s.broll.includes(id);
export const splitOf = (id: string, s: Pick<PodState, 'splits'> = get()) => s.splits.find((x) => x.id === id) ?? null;
/** recordings and split screens the mixer can switch to (keys 1…9 in this order) */
export const inputsOf = (s: Pick<PodState, 'cameras' | 'splits' | 'broll'> & Partial<Pick<PodState, 'stills'>> = get()) => [...s.cameras.map((c) => c.id), ...s.splits.map((x) => x.id), ...s.broll, ...(s.stills ?? [])];
/** every switcher source: the inputs above + media players, colours, bars and black */
export const allInputsOf = (s: Pick<PodState, 'cameras' | 'splits' | 'broll'> & Partial<Pick<PodState, 'stills'>> = get()) => [...inputsOf(s), ...VIRTUAL];
/** synchronised sources: cameras + microphones */
export const syncedIds = (s: Pick<PodState, 'cameras' | 'speakers'> = get()) => [...s.cameras.map((c) => c.id), ...s.speakers.map((x) => x.mic).filter((m): m is string => !!m)];
export const refTrack = (s: Pick<PodState, 'cameras'> = get()): string | null => (s.cameras.find((c) => c.role === 'wide') ?? s.cameras[0])?.id ?? null;
export const camsReady = (s: Pick<PodState, 'cameras'> = get()) => s.cameras.length >= 2;

/** the rig changed: the analysis and the edit have to be made again */
function invalidate(extra: Partial<PodState> = {}) {
  // a vision-mixer timeline (no speech analysis) is kept: only its length follows the cameras
  if (get().analysis?.stub) { set({ phase: 'idle', message: '', ...extra }); ensureTimeline(true); return; }
  set({ analysis: null, phase: 'idle', message: '', pictureCheck: null, segments: [], past: [], future: [], selected: null, ...extra });
}

/**
 * The vision mixer needs a timeline even before (or without) "Analyse": a timeline covering the cameras,
 * starting on the first camera (or the wide shot).
 */
export function ensureTimeline(resize = false): boolean {
  const s = get();
  if (!s.cameras.length) return false;
  if (s.analysis && !resize) return true;
  const { start, end } = coverage();
  const a = start, b = end > start ? end : start + Math.max(1, ...s.cameras.map((c) => s.sources[c.id]?.duration ?? 0));
  if (s.analysis && !s.analysis.stub) return true;
  const frames = Math.max(1, Math.round((b - a) * 100));
  const an: Analysis = { rate: 100, t0: a, start: a, end: b, speakers: [], state: new Uint8Array(frames), levels: [], loud: new Float32Array(frames), separation: 0, syncConfidence: s.analysis?.syncConfidence ?? {}, stub: true };
  const first = s.cameras.find((c) => c.role === 'wide')?.id ?? s.cameras[0].id;
  let segs = s.segments.filter((x) => x.end > a && x.start < b).map((x) => ({ ...x, start: Math.max(a, x.start), end: Math.min(b, x.end) }));
  if (!segs.length) segs = [{ id: segId(), start: a, end: b, cam: first, reason: 'manual' }];
  else { segs[0].start = a; segs[segs.length - 1].end = b; }
  set({ analysis: an, segments: segs, time: Math.min(Math.max(s.time, a), b), overlays: s.overlays.filter((o) => o.end > a && o.start < b) });
  return true;
}

// ---------- cameras / speakers / B-roll ----------
export async function addCamera(file: File, role?: CamRole, speaker?: string | null) {
  try {
    const id = newId('cam');
    const src = await loadAnySource(id, file);
    if (src.kind !== 'video') throw new Error('Choose a video file for a camera.');
    const s = get();
    let r: CamRole = role ?? 'speaker'; let sp: string | null = speaker ?? null;
    if (!role) {
      // default: next person without a camera → a wide shot → another angle of the person with the fewest cameras
      // (the user changes it in the camera's "Shows" menu)
      const camsOf = (spId: string) => s.cameras.filter((c) => c.role === 'speaker' && c.speaker === spId).length;
      const free = s.speakers.find((x) => !camsOf(x.id));
      if (free) sp = free.id;
      else if (!s.cameras.some((c) => c.role === 'wide')) { r = 'wide'; sp = null; }
      else sp = [...s.speakers].sort((x, y) => camsOf(x.id) - camsOf(y.id))[0].id;
    }
    set((st) => ({ sources: { ...st.sources, [id]: src }, cameras: [...st.cameras, { id, role: r, speaker: r === 'speaker' ? sp : null }] }));
    invalidate();
  } catch (e) { toastError((e as Error).message); }
}
export async function replaceCameraFile(id: string, file: File) {
  try {
    const src = await loadAnySource(id, file);
    if (src.kind !== 'video') throw new Error('Choose a video file for a camera.');
    const old = get().sources[id]; if (old) URL.revokeObjectURL(old.url);
    set((st) => ({ sources: { ...st.sources, [id]: src } }));
    invalidate();
  } catch (e) { toastError((e as Error).message); }
}
export function setCameraRole(id: string, role: CamRole, speaker: string | null = null) {
  const had = !!get().analysis;
  set((s) => ({ cameras: s.cameras.map((c) => (c.id === id ? { ...c, role, speaker: role === 'speaker' ? speaker ?? s.speakers[0]?.id ?? null : null } : c)) }));
  if (had) { invalidate(); toast('Camera roles changed — analyse again to update the edit.', 'info', 5000); }
}
export function moveCamera(id: string, dir: -1 | 1) {
  set((s) => {
    const i = s.cameras.findIndex((c) => c.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= s.cameras.length) return {};
    const cams = s.cameras.slice(); [cams[i], cams[j]] = [cams[j], cams[i]];
    return { cameras: cams };
  });
}
function dropSource(id: string) {
  const old = get().sources[id]; if (old) URL.revokeObjectURL(old.url);
  set((s) => { const sources = { ...s.sources }; delete sources[id]; return { sources }; });
}
export function removeCamera(id: string) {
  dropSource(id);
  set((s) => ({ cameras: s.cameras.filter((c) => c.id !== id), splits: s.splits.map((x) => ({ ...x, boxes: x.boxes.map((b) => (b.cam === id ? { ...b, cam: null } : b)) })), segments: s.segments.map((x) => (x.cam === id ? { ...x, cam: 'blk' } : x)) }));
  invalidate();
}
export function addSpeaker(): string | null {
  if (get().speakers.length >= 8) return null;
  const id = newId('sp');
  set((s) => ({ speakers: [...s.speakers, { id, name: '', mic: null }] }));
  return id;
}
export function removeSpeaker(id: string) {
  const s = get(); if (s.speakers.length <= 2) { toastError('A conversation needs at least two speakers.'); return; }
  const sp = s.speakers.find((x) => x.id === id); if (sp?.mic) dropSource(sp.mic);
  set((st) => ({ speakers: st.speakers.filter((x) => x.id !== id), cameras: st.cameras.map((c) => (c.speaker === id ? { ...c, role: 'insert' as const, speaker: null } : c)) }));
  invalidate();
}
export function renameSpeaker(id: string, name: string) { set((s) => ({ speakers: s.speakers.map((x) => (x.id === id ? { ...x, name } : x)) })); }
export async function setSpeakerMic(id: string, file: File) {
  try {
    const sid = newId('mic');
    const src = await loadAnySource(sid, file);
    const old = get().speakers.find((x) => x.id === id)?.mic; if (old) dropSource(old);
    set((s) => ({ sources: { ...s.sources, [sid]: src }, speakers: s.speakers.map((x) => (x.id === id ? { ...x, mic: sid } : x)) }));
    invalidate();
  } catch (e) { toastError((e as Error).message); }
}
export function removeSpeakerMic(id: string) {
  const mic = get().speakers.find((x) => x.id === id)?.mic; if (!mic) return;
  dropSource(mic);
  set((s) => ({ speakers: s.speakers.map((x) => (x.id === id ? { ...x, mic: null } : x)) }));
  invalidate();
}
export async function addBroll(files: File[]) {
  for (const file of files) {
    try {
      const id = newId('br');
      const src = await loadAnySource(id, file);
      if (src.kind !== 'video') throw new Error(`${file.name}: B-roll must be a video.`);
      set((s) => ({ sources: { ...s.sources, [id]: src }, broll: [...s.broll, id] }));
    } catch (e) { toastError((e as Error).message); }
  }
  if (get().analysis) regenerate();
}
export function removeBroll(id: string) {
  dropSource(id);
  set((s) => ({ broll: s.broll.filter((x) => x !== id) }));
  if (get().analysis) regenerate();
}
// ---------- split screens (SuperSource) ----------
/** boxes for a preset, filled with the first camera of each person (wide shot first for picture-in-picture) */
export function presetBoxes(layout: SplitLayout, keep: (string | null)[] = []) {
  const s = get(); const o = s.output;
  const firsts = s.speakers.map((sp) => s.cameras.find((c) => c.role === 'speaker' && c.speaker === sp.id)?.id).filter((v): v is string => !!v);
  const all = s.cameras.map((c) => c.id);
  const wide = s.cameras.find((c) => c.role === 'wide')?.id;
  // people first (one camera each), then the other cameras — never the same camera twice when avoidable
  const pool = [...new Set([...(layout.startsWith('pip') && wide ? [wide] : []), ...firsts, ...all])];
  const used = new Set(keep.filter((k): k is string => !!k));
  const free = pool.filter((c) => !used.has(c));
  let f = 0;
  return presetRects(layout, o.width / o.height).map((r, i) => ({ ...r, cam: keep[i] ?? free[f++] ?? all[i % Math.max(1, all.length)] ?? null, crop: noCrop(), on: true }));
}
export function addSplit(layout: SplitLayout = 'side2'): string {
  const id = newId('split');
  set((st) => ({ splits: [...st.splits, { id, name: '', boxes: presetBoxes(layout), bg: '#0d0f12', border: 0, borderColor: '#ffffff', preset: layout }] }));
  if (get().analysis && !get().analysis!.stub) regenerate();
  return id;
}
export function updateSplit(id: string, patch: Partial<Split>) {
  set((s) => ({ splits: s.splits.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
}
/** the boxes being edited at the current time: the layout change in force (an animation keyframe), else the base layout */
export function editBoxesOf(sp: Split, T = get().time): SSBox[] { const k = editKeyAt(sp, T); return k < 0 ? sp.boxes : sp.keys![k].boxes; }
function editBoxes(id: string, f: (b: SSBox[]) => SSBox[], preset: SplitLayout | undefined) {
  set((s) => ({ splits: s.splits.map((x) => {
    if (x.id !== id) return x;
    const k = editKeyAt(x, s.time);
    if (k < 0) return { ...x, boxes: f(x.boxes), preset };
    return { ...x, keys: x.keys!.map((q, i) => (i === k ? { ...q, boxes: f(q.boxes) } : q)), preset };
  }) }));
}
export function applySplitPreset(id: string, layout: SplitLayout) {
  const s = get(); const sp = s.splits.find((x) => x.id === id); if (!sp) return;
  const boxes = presetBoxes(layout, editBoxesOf(sp).map((b) => b.cam)).map((b, i) => ({ ...b, ...(editBoxesOf(sp)[i]?.border ? { border: editBoxesOf(sp)[i].border } : {}) }));
  if (sp.anim?.animateChanges) {
    // recorded layout change: the boxes move to the new layout from now on
    const t = s.time; const keys = [...(sp.keys ?? []).filter((k) => Math.abs(k.t - t) > 0.02), { t, dur: sp.anim.changeDur, boxes }].sort((a, b) => a.t - b.t);
    updateSplit(id, { keys, preset: layout }); set({ edited: true });
    return;
  }
  editBoxes(id, () => boxes, layout);
}
export function updateBox(id: string, i: number, patch: Partial<Split['boxes'][number]>) {
  const moved = ['x', 'y', 'w', 'h', 'crop', 'on'].some((k) => k in patch);
  const sp = get().splits.find((x) => x.id === id);
  editBoxes(id, (bx) => bx.map((b, k) => (k === i ? { ...b, ...patch } : b)), moved ? undefined : sp?.preset);
}
export function addBox(id: string) {
  const cams = get().cameras;
  editBoxes(id, (bx) => (bx.length < 4 ? [...bx, { cam: cams[bx.length]?.id ?? null, x: 0.35, y: 0.35, w: 0.3, h: 0.3, crop: noCrop(), on: true }] : bx), undefined);
}
export function removeBox(id: string, i: number) {
  editBoxes(id, (bx) => bx.filter((_, k) => k !== i), undefined);
}
export function bringBoxToFront(id: string, i: number) { editBoxes(id, (bx) => { const b = [...bx]; const [m] = b.splice(i, 1); b.push(m); return b; }, undefined); }
export function removeSplitKey(id: string, t: number) { set((s) => ({ splits: s.splits.map((x) => (x.id === id ? { ...x, keys: (x.keys ?? []).filter((k) => Math.abs(k.t - t) > 1e-6) } : x)), edited: true })); }
export function removeSplit(id: string) {
  set((s) => ({ splits: s.splits.filter((x) => x.id !== id), previewInput: s.previewInput === id ? null : s.previewInput, segments: s.segments.map((x) => (x.cam === id ? { ...x, cam: 'blk' } : x)) }));
  if (get().analysis && !get().analysis!.stub) regenerate();
}

export function setOffset(id: string, offset: number) {
  set((s) => { const src = s.sources[id]; return src ? { sources: { ...s.sources, [id]: { ...src, offset } } } : {}; });
  if (get().analysis?.stub) ensureTimeline(true);
}

/** timeline range where all person and wide cameras recorded */
export function coverage(s: Pick<PodState, 'cameras' | 'sources'> = get()): { start: number; end: number } {
  let start = -Infinity, end = Infinity;
  for (const c of s.cameras) {
    if (c.role === 'insert') continue;
    const src = s.sources[c.id]; if (!src) continue;
    start = Math.max(start, -src.offset); end = Math.min(end, src.duration - src.offset);
  }
  if (!Number.isFinite(start)) return { start: 0, end: 0 };
  return { start, end: Math.max(start, end) };
}

// ---------- analysis ----------
let analyzer: PodAnalyzer | null = null;
let runId = 0;

/** keepEdit: find who speaks when (for the tips and suggestions) but keep the cuts already made */
export async function analyze(opts: { keepEdit?: boolean } = {}) {
  const s0 = get();
  if (!camsReady(s0)) { toastError('Add at least two cameras first.'); return; }
  if (!s0.cameras.some((c) => c.role === 'speaker')) { toastError('Set which camera shows which person (the "Shows" menu of each camera).'); return; }
  const my = ++runId;
  analyzer?.dispose(); analyzer = new PodAnalyzer();
  const az = analyzer;
  const alive = () => my === runId;
  const ids = syncedIds(s0);
  const decoded = new Set<string>();
  try {
    // 1. sound of every synchronised recording
    for (let i = 0; i < ids.length; i++) {
      const src = get().sources[ids[i]]; if (!src) continue;
      set({ phase: 'decoding', progress: i / ids.length, message: src.name });
      try {
        const pcm = await decodeLowRate(src.file);
        if (!alive()) return;
        await az.add(ids[i], pcm, ANALYSIS_RATE);
        decoded.add(ids[i]);
      } catch (e) { toast((e as Error).message, 'error', 7000); }
    }
    // 2. synchronisation against the reference camera (a wide shot when there is one)
    const order = [...s0.cameras.filter((c) => c.role === 'wide'), ...s0.cameras.filter((c) => c.role !== 'wide')].map((c) => c.id);
    const ref = order.find((id) => decoded.has(id));
    if (!ref) throw new Error('None of the cameras has readable sound, so they can\'t be synchronised automatically.');
    const conf: Record<string, number> = {};
    const offsets: Record<string, number> = { [ref]: 0 };
    const others = ids.filter((id) => id !== ref && decoded.has(id));
    for (let i = 0; i < others.length; i++) {
      set({ phase: 'syncing', progress: i / Math.max(1, others.length), message: get().sources[others[i]]?.name ?? '' });
      const r = await az.sync(ref, others[i]);
      if (!alive()) return;
      offsets[others[i]] = r.offset; conf[others[i]] = r.confidence;
    }
    set((s) => {
      const sources = { ...s.sources };
      for (const id of ids) { const src = sources[id]; if (src && offsets[id] !== undefined) sources[id] = { ...src, offset: offsets[id] }; }
      return { sources };
    });
    // 3. who speaks when — one signal per person: own microphone, else the sound of the person's camera
    set({ phase: 'speakers', progress: 0, message: '' });
    const st1 = get();
    const sig: { speaker: string; src: string; fromCam: boolean }[] = [];
    for (const sp of st1.speakers) {
      if (sp.mic && decoded.has(sp.mic)) { sig.push({ speaker: sp.id, src: sp.mic, fromCam: false }); continue; }
      const cam = st1.cameras.find((c) => c.role === 'speaker' && c.speaker === sp.id && decoded.has(c.id));
      if (cam) sig.push({ speaker: sp.id, src: cam.id, fromCam: true });
    }
    if (sig.length < 2) throw new Error('Each person needs their own camera or a microphone recording, so their voices can be told apart.');
    // people without a camera or microphone can't be told apart (unnamed empty entries are simply ignored)
    const missing = st1.speakers.filter((x) => !sig.some((g) => g.speaker === x.id) && x.name.trim());
    if (missing.length) toast(`No camera or microphone for: ${missing.map((x) => speakerName(x.id)).join(', ')}. Their speech counts as the closest voice.`, 'warning', 8000);
    const { start, end } = coverage();
    if (end - start < 2) throw new Error('The cameras don\'t overlap in time. Check that the videos are from the same recording.');
    const frames = Math.round((end - start) * 100);
    const sp = await az.speech(sig.map((g) => g.src), sig.map((g) => st1.sources[g.src].offset), start, frames);
    if (!alive()) return;
    let an: Analysis = { rate: 100, t0: start, start, end, speakers: sig.map((g) => g.speaker), ...sp, syncConfidence: conf };
    // 4. picture check: is each voice really the person on that camera? (only when voices come from camera sound)
    let check: PodState['pictureCheck'] = null;
    if (sig.some((g) => g.fromCam)) {
      set({ phase: 'checking', progress: 0, message: '' });
      const r = await pictureCheck(an, (p) => { if (alive()) set({ progress: p }); });
      if (!alive()) return;
      if (r) { check = { changed: r.changed, confidence: r.confidence }; if (r.changed) an = { ...an, speakers: r.speakers }; }
    }
    const old = get().segments;
    if (opts.keepEdit && old.length) {
      let segs = old.filter((x) => x.end > start && x.start < end).map((x) => ({ ...x, start: Math.max(start, x.start), end: Math.min(end, x.end) }));
      if (!segs.length) segs = autoEdit(an, get().settings, rigOf()); else { segs[0].start = start; segs[segs.length - 1].end = end; }
      set({ analysis: an, pictureCheck: check, phase: 'done', progress: 1, message: '', segments: segs, overlays: get().overlays.filter((o) => o.end > start && o.start < end) });
      toast('Speech analysed: the tips are on the timeline');
      return;
    }
    const segments = autoEdit(an, get().settings, rigOf());
    set({ analysis: an, pictureCheck: check, phase: 'done', progress: 1, message: '', segments, past: [], future: [], edited: false, time: start, selected: null, inPoint: null, outPoint: null });
    if (an.separation < 3) toast('The voices are hard to tell apart in this sound. For the best result add each person\'s microphone recording.', 'info', 9000);
    fitTimeline();
  } catch (e) {
    if (!alive()) return;
    set({ phase: 'error', message: (e as Error).message });
    toastError((e as Error).message);
  }
}

/** vision mixer: only synchronise the cameras and microphones by their sound (no speech analysis, no automatic edit) */
export async function syncOnly() {
  const s0 = get();
  if (s0.cameras.length < 2) { toastError('Add at least two cameras first.'); return; }
  const my = ++runId;
  analyzer?.dispose(); analyzer = new PodAnalyzer();
  const az = analyzer; const alive = () => my === runId;
  const ids = syncedIds(s0); const decoded = new Set<string>();
  try {
    for (let i = 0; i < ids.length; i++) {
      const src = get().sources[ids[i]]; if (!src) continue;
      set({ phase: 'decoding', progress: i / ids.length, message: src.name });
      try { const pcm = await decodeLowRate(src.file); if (!alive()) return; await az.add(ids[i], pcm, ANALYSIS_RATE); decoded.add(ids[i]); } catch (e) { toast((e as Error).message, 'error', 7000); }
    }
    const order = [...s0.cameras.filter((c) => c.role === 'wide'), ...s0.cameras.filter((c) => c.role !== 'wide')].map((c) => c.id);
    const ref = order.find((id) => decoded.has(id));
    if (!ref) throw new Error('None of the cameras has readable sound, so they can\'t be synchronised automatically.');
    const conf: Record<string, number> = {}; const offsets: Record<string, number> = { [ref]: 0 };
    const others = ids.filter((id) => id !== ref && decoded.has(id));
    for (let i = 0; i < others.length; i++) {
      set({ phase: 'syncing', progress: i / Math.max(1, others.length), message: get().sources[others[i]]?.name ?? '' });
      const r = await az.sync(ref, others[i]); if (!alive()) return;
      offsets[others[i]] = r.offset; conf[others[i]] = r.confidence;
    }
    set((s) => {
      const sources = { ...s.sources };
      for (const id of ids) { const src = sources[id]; if (src && offsets[id] !== undefined) sources[id] = { ...src, offset: offsets[id] }; }
      return { sources, phase: 'idle', progress: 1, message: '' };
    });
    if (!get().analysis || get().analysis!.stub) { set((s) => ({ analysis: s.analysis ? { ...s.analysis, syncConfidence: conf } : null })); ensureTimeline(true); set((s) => ({ analysis: s.analysis ? { ...s.analysis, syncConfidence: conf } : s.analysis })); }
    analyzer?.dispose(); analyzer = null;
    toast('Cameras synchronised');
  } catch (e) {
    if (!alive()) return;
    set({ phase: 'error', message: (e as Error).message }); toastError((e as Error).message);
  }
}

export function cancelAnalysis() { runId++; analyzer?.dispose(); analyzer = null; set({ phase: 'idle', message: '' }); }

/**
 * For every voice, measures how much each person's camera picture moves while that voice speaks
 * (people who talk move their head, mouth and hands). The voice → person assignment with the most
 * movement wins (all permutations, up to 6 people).
 */
async function pictureCheck(an: Analysis, onProgress: (p: number) => void): Promise<{ speakers: string[]; changed: boolean; confidence: number } | null> {
  const s = get();
  const N = an.speakers.length;
  if (N > 6) return null;
  const camOf = (spId: string) => s.cameras.find((c) => c.role === 'speaker' && c.speaker === spId)?.id ?? null;
  const cams = an.speakers.map(camOf);
  if (cams.filter(Boolean).length < 2) return null;
  const times = (k: number) => {
    const out: number[] = [];
    for (let i = 0; i < an.state.length;) {
      let j = i; while (j < an.state.length && an.state[j] === an.state[i]) j++;
      if (an.state[i] === k && j - i > 200) for (let q = i + 60; q < j - 60; q += 300) out.push(an.t0 + q / an.rate);
      i = j;
    }
    const step = Math.max(1, Math.floor(out.length / 10));
    return out.filter((_, q) => q % step === 0).slice(0, 10);
  };
  const T = an.speakers.map((_, k) => times(k + 1));
  if (T.filter((x) => x.length >= 2).length < 2) return null;
  const total = cams.filter(Boolean).length * T.reduce((a, b) => a + b.length, 0); let done = 0;
  // M[v][p]: median movement of person p's camera while voice v speaks
  const M: number[][] = an.speakers.map(() => an.speakers.map(() => NaN));
  for (let p = 0; p < N; p++) {
    const cam = cams[p]; if (!cam) continue;
    const src = s.sources[cam]; const probe = new FrameProbe(src.url);
    for (let v = 0; v < N; v++) {
      const vals: number[] = [];
      for (const t of T[v]) { const m = await probe.motion(t + src.offset); if (m !== null) vals.push(m); onProgress(++done / total); }
      vals.sort((a, b) => a - b);
      M[v][p] = vals.length ? vals[vals.length >> 1] : NaN;
    }
    probe.dispose();
  }
  // normalise each camera by its average movement, then score permutations
  const eps = 0.002;
  const L = M.map((row) => row.slice());
  for (let p = 0; p < N; p++) {
    const col = M.map((row) => row[p]).filter(Number.isFinite);
    const mean = col.reduce((a, b) => a + b, 0) / (col.length || 1);
    for (let v = 0; v < N; v++) L[v][p] = Number.isFinite(M[v][p]) ? Math.log((M[v][p] + eps) / (mean + eps)) : 0;
  }
  const perms: number[][] = [];
  const permute = (a: number[], k: number) => { if (k === a.length) { perms.push(a.slice()); return; } for (let i = k; i < a.length; i++) { [a[k], a[i]] = [a[i], a[k]]; permute(a, k + 1); [a[k], a[i]] = [a[i], a[k]]; } };
  permute(an.speakers.map((_, i) => i), 0);
  const score = (pm: number[]) => pm.reduce((acc, p, v) => acc + L[v][p], 0);
  const identity = score(an.speakers.map((_, i) => i));
  let best = perms[0], bestS = -Infinity;
  for (const pm of perms) { const sc = score(pm); if (sc > bestS) { bestS = sc; best = pm; } }
  const changed = bestS - identity > 0.3;
  return { speakers: changed ? best.map((p) => an.speakers[p]) : an.speakers, changed, confidence: bestS - identity };
}

/** assigns voice v to person `speaker` (swapping with whoever had that person) */
export function assignVoice(v: number, speaker: string) {
  const an = get().analysis; if (!an) return;
  const sp = an.speakers.slice(); const j = sp.indexOf(speaker);
  if (j === v) return;
  if (j >= 0) sp[j] = sp[v];
  sp[v] = speaker;
  set({ analysis: { ...an, speakers: sp } });
  regenerate();
}
/** two people: swap their voices */
export function swapSpeakers() {
  const an = get().analysis; if (!an || an.speakers.length < 2) return;
  assignVoice(0, an.speakers[1]);
  toast('Speakers swapped');
}

// ---------- automatic edit ----------
function pushHistory() {
  set((s) => ({ past: [...s.past.slice(-99), s.segments], future: [] }));
}
let lastRegen = 0;
export function regenerate() {
  const s = get(); if (!s.analysis || s.analysis.stub) return;
  if (performance.now() - lastRegen > 800) pushHistory();
  lastRegen = performance.now();
  set({ segments: autoEdit(s.analysis, s.settings, rigOf(s)), edited: false, selected: null });
}
export function setSettings(patch: Partial<EditSettings>) {
  set((s) => ({ settings: { ...s.settings, ...patch } }));
  regenerate();
}
/** one shot over the whole recording — for switching everything yourself in the vision mixer */
export function clearEdit() {
  const s = get(); const an = s.analysis; if (!an) return;
  const cam = s.cameras.find((c) => c.role === 'wide')?.id ?? s.cameras[0]?.id; if (!cam) return;
  pushHistory();
  set({ segments: [{ id: segId(), start: an.start, end: an.end, cam, reason: 'manual' }], edited: true, selected: null });
}
/** settings that don't change the cuts (sound, transition length) */
export function setSoundSettings(patch: Partial<Pick<EditSettings, 'audioMode' | 'duckDb' | 'mixDur'>>) {
  set((s) => ({ settings: { ...s.settings, ...patch } }));
}
export function setPacing(p: Pacing) { setSettings({ pacing: p, ...PACING[p] }); }

// ---------- manual editing ----------
function commitSegs(segs: Segment[]) {
  const s = get(); const an = s.analysis;
  const start = an?.start ?? segs[0]?.start ?? 0, end = an?.end ?? segs[segs.length - 1]?.end ?? 0;
  pushHistory();
  set({ segments: cleanup(segs, 1 / s.settings.fps, s.settings.fps, start, end), edited: true });
}
export const segmentAt = (t: number, segs = get().segments) => segs.find((x) => t >= x.start && t < x.end) ?? segs[segs.length - 1] ?? null;
/** where a B-roll clip should start when the user picks it for a shot: after its last use */
function brollStart(id: string, len: number, segs: Segment[]) {
  const dur = get().sources[id]?.duration ?? 0;
  let p = 0.5;
  for (const x of segs) if (x.cam === id && x.srcIn !== undefined) p = Math.max(p, x.srcIn + (x.end - x.start) + 0.5);
  return p + Math.min(len, 3) > dur ? 0 : p;
}

/** camera switch at time t (live switching while playing): t → next cut; `trans` = transition into it */
export function cutTo(cam: string, t = get().time, mix: number | TransParams = 0) {
  ensureTimeline();
  const segs = get().segments; const cur = segmentAt(t, segs); if (!cur || cur.cam === cam) return;
  const painted = paint(segs, t, cur.end, cam, 'manual', isBroll(cam) ? brollStart(cam, cur.end - t, segs) : undefined);
  const tp: TransParams | null = typeof mix === 'number' ? (mix > 0 ? { ...defaultTrans(), dur: mix } : null) : mix;
  commitSegs(tp ? painted.map((x) => (Math.abs(x.start - t) < 1e-6 && x.cam === cam ? { ...x, trans: { ...tp, dur: Math.min(tp.dur, (x.end - x.start) * 0.9) } } : x)) : painted);
}
/** vision mixer: preview → program (CUT, or AUTO with a dissolve); the old program goes to preview */
export function take(auto = false) {
  const s = get(); const pv = s.previewInput; if (!pv) return;
  const cur = segmentAt(s.time)?.cam ?? null;
  cutTo(pv, s.time, auto ? s.settings.mixDur : 0);
  set({ previewInput: cur && cur !== pv ? cur : pv });
}
/** change the camera of a whole shot */
export function setShotCam(id: string, cam: string) {
  const segs = get().segments; const x = segs.find((s) => s.id === id); if (!x || x.cam === cam) return;
  const srcIn = isBroll(cam) ? brollStart(cam, x.end - x.start, segs) : undefined;
  commitSegs(segs.map((s) => (s.id === id ? { id: s.id, start: s.start, end: s.end, cam, reason: 'manual' as const, ...(srcIn !== undefined ? { srcIn } : {}), ...(s.trans ? { trans: s.trans } : {}), ...(s.mix ? { mix: s.mix } : {}) } : s)));
  set({ selected: null });
}
export function splitAt(t = get().time) {
  const segs = get().segments; const cur = segmentAt(t, segs); if (!cur || t - cur.start < 0.1 || cur.end - t < 0.1) return;
  pushHistory();
  set({ segments: segs.flatMap((s) => (s.id === cur.id ? [{ ...s, end: t }, { ...s, id: segId(), start: t, reason: 'manual' as const, ...(s.srcIn !== undefined ? { srcIn: s.srcIn + (t - s.start) } : {}) }] : [s])), edited: true });
}
/** moves the cut between shot i-1 and shot i */
export function moveCut(i: number, t: number, final: boolean) {
  const s = get(); const segs = s.segments; if (i <= 0 || i >= segs.length) return;
  const f = 1 / s.settings.fps;
  const tt = Math.max(segs[i - 1].start + f, Math.min(segs[i].end - f, Math.round(t * s.settings.fps) / s.settings.fps));
  const d = tt - segs[i].start;
  const next = segs.map((x, k) => (k === i - 1 ? { ...x, end: tt } : k === i ? { ...x, start: tt, ...(x.srcIn !== undefined ? { srcIn: Math.max(0, x.srcIn + d) } : {}) } : x));
  set(final ? { segments: next, edited: true } : { segments: next });
}
export function beginCutDrag() { pushHistory(); }
/** removes a shot (the previous shot continues) */
export function deleteShot(id: string) {
  const segs = get().segments; const k = segs.findIndex((s) => s.id === id); if (k < 0 || segs.length < 2) return;
  const out = segs.map((s) => ({ ...s }));
  if (k > 0) out[k - 1].end = out[k].end;
  else { const d = out[1].start - out[0].start; out[1].start = out[0].start; if (out[1].srcIn !== undefined) out[1].srcIn = Math.max(0, out[1].srcIn - d); }
  out.splice(k, 1);
  commitSegs(out);
  set({ selected: null });
}
export function undo() { const s = get(); const p = s.past[s.past.length - 1]; if (!p) return; set({ segments: p, past: s.past.slice(0, -1), future: [s.segments, ...s.future], selected: null }); }
export function redo() { const s = get(); const f = s.future[0]; if (!f) return; set({ segments: f, future: s.future.slice(1), past: [...s.past, s.segments], selected: null }); }

// ---------- timeline view ----------
export function fitTimeline(width = 900) {
  const an = get().analysis; if (!an) return;
  const pps = Math.max(0.05, (width - 30) / Math.max(1, an.end - an.start));
  set({ view: { pxPerSec: pps, scroll: an.start * pps } });
}

/** master sound for preview and export */
export function masterTracks(s: Pick<PodState, 'master' | 'sources' | 'speakers' | 'cameras'> = get()): string[] {
  const mics = s.speakers.map((x) => x.mic).filter((m): m is string => !!m && !!s.sources[m]);
  if (s.master === 'mics') return mics;
  if (s.master !== 'auto') return s.sources[s.master] ? [s.master] : [];
  if (mics.length) return mics;
  const r = refTrack(s);
  return r ? [r] : [];
}

export function setInOut(which: 'in' | 'out' | 'clear', t = get().time) {
  if (which === 'clear') set({ inPoint: null, outPoint: null });
  else set(which === 'in' ? { inPoint: t } : { outPoint: t });
}

/** files dropped on the workspace: videos become cameras, sound files the microphones of people without one */
export async function addPodcastFiles(files: File[]) {
  for (const f of files) {
    const k = mediaKind(f);
    if (f.type.startsWith('image/') || IMAGE_EXT.test(f.name)) { const { addMedia } = await import('./mixer'); await addMedia([f], true); continue; }
    if (k === 'video') await addCamera(f);
    else if (k === 'audio') {
      const sp = get().speakers.find((x) => !x.mic);
      if (sp) await setSpeakerMic(sp.id, f); else toastError(`Every person already has a microphone (${f.name}).`);
    } else toastError(`Unsupported file: ${f.name}`);
  }
}


/** automix tracks for "sound follows the speaker" (cached) */
let mixCache: { key: unknown[]; tracks: AutomixTrack[] } | null = null;
export function automixTracks(s: PodState = get()): AutomixTrack[] {
  if (!s.analysis || s.settings.audioMode !== 'speaker') return [];
  const key = [s.analysis, s.settings.duckDb, s.speakers, s.cameras, s.sources];
  if (mixCache && mixCache.key.every((k, i) => k === key[i])) return mixCache.tracks;
  const tracks = automix(s.analysis, s.settings, s);
  mixCache = { key, tracks };
  return tracks;
}
/** sources that are heard in the program: automix tracks, or the master track(s) */
export function audibleTracks(s: PodState = get()): string[] {
  const mix = automixTracks(s);
  return mix.length ? mix.map((t) => t.source) : masterTracks(s);
}

// ---------- audio mixer (ATEM-style AFV / ON / OFF per source) ----------
/** is source `id` (a camera, or a person's microphone) part of what is on program at time T? */
export function onProgram(id: string, T: number, s: PodState = get()): boolean {
  const cam = segmentAt(T, s.segments)?.cam; if (!cam) return false;
  const shown = new Set<string>([cam]);
  for (const b of s.splits.find((x) => x.id === cam)?.boxes ?? []) if (b.on && b.cam) shown.add(b.cam);
  if (shown.has(id)) return true;
  const sp = s.speakers.find((x) => x.mic === id);
  return !!sp && s.cameras.some((c) => c.speaker === sp.id && c.role === 'speaker' && shown.has(c.id));
}
// ---------- sound follows the picture ----------
/** the sound sources of an input: a person's microphone (else the camera's own sound); null = keeps the previous sound (inserts, B-roll, stills) */
export function soundOf(cam: string, s: PodState = get()): string[] | null {
  const c = s.cameras.find((x) => x.id === cam);
  if (c) {
    if (c.role === 'speaker' && c.speaker) { const mic = s.speakers.find((x) => x.id === c.speaker)?.mic; if (mic && s.sources[mic]) return [mic]; }
    if (c.role === 'wide') { const mics = s.speakers.map((x) => x.mic).filter((m): m is string => !!m && !!s.sources[m]); if (mics.length) return mics; }
    if (c.role === 'insert') return null;
    return [cam];
  }
  const sp = s.splits.find((x) => x.id === cam);
  if (sp) { const out = new Set<string>(); for (const b of sp.boxes) if (b.on && b.cam) for (const x of soundOf(b.cam, s) ?? []) out.add(x); return out.size ? [...out] : null; }
  return null;
}
export interface SoundSeg { start: number; end: number; seg: number; sources: string[] }
let soundCache: { key: unknown[]; v: SoundSeg[] } | null = null;
/** the sound edit: follows the picture cuts, moved by each shot's audioShift (J / L cuts) */
export function soundSegments(s: PodState = get()): SoundSeg[] {
  const key = [s.segments, s.cameras, s.speakers, s.splits, s.sources];
  if (soundCache && soundCache.key.every((k, i) => k === key[i])) return soundCache.v;
  const segs = s.segments; const out: SoundSeg[] = [];
  let prevSrc: string[] = [];
  const firstSound = segs.map((x) => soundOf(x.cam, s)).find((x) => x) ?? [];
  segs.forEach((x, i) => {
    const a = i === 0 ? x.start : Math.max(segs[i - 1].start + 0.04, Math.min(x.end - 0.04, x.start + (x.audioShift ?? 0)));
    const src = soundOf(x.cam, s) ?? (prevSrc.length ? prevSrc : firstSound);
    if (out.length) out[out.length - 1].end = a;
    out.push({ start: a, end: x.end, seg: i, sources: src }); prevSrc = src;
  });
  soundCache = { key, v: out };
  return out;
}
export function pictureSoundsAt(T: number, s: PodState = get()): string[] {
  const v = soundSegments(s); let r = v[0]?.sources ?? [];
  for (const x of v) { if (x.start <= T) r = x.sources; else break; }
  return r;
}
/** J / L cut: the sound cut of shot i moves by `shift` seconds from the picture cut */
export function setAudioShift(i: number, shift: number, final = true) {
  const s = get(); const segs = s.segments; if (i <= 0 || i >= segs.length) return;
  const lim = Math.max(0, Math.min(segs[i].start - segs[i - 1].start, segs[i].end - segs[i].start) - 0.05);
  const v = Math.max(-lim, Math.min(lim, Math.round(shift * s.settings.fps) / s.settings.fps));
  const next = segs.map((x, k) => (k === i ? { ...x, audioShift: Math.abs(v) < 1e-4 ? undefined : v } : x));
  set(final ? { segments: next, edited: true } : { segments: next });
}

/** every source that can be heard in the program */
export function heardIds(s: PodState = get()): string[] {
  if (s.settings.audioMode === 'picture') {
    const out = new Set<string>([...s.cameras.map((c) => c.id), ...s.speakers.map((x) => x.mic).filter((m): m is string => !!m)].filter((id) => s.sources[id]));
    for (const [id, a] of Object.entries(s.audioIn)) if (a.mode === 'off') out.delete(id);
    return [...out];
  }
  const out = new Set(audibleTracks(s));
  for (const [id, a] of Object.entries(s.audioIn)) {
    if (!s.sources[id] || s.broll.includes(id)) continue;
    if (a.mode === 'off') out.delete(id); else if (a.mode === 'on' || a.mode === 'afv') out.add(id);
  }
  return [...out];
}
/** level of source `id` in the program at time T (0..~2) */
export function heardGain(id: string, T: number, s: PodState = get(), audible = new Set(audibleTracks(s))): number {
  const a = s.audioIn[id];
  const lin = a ? Math.pow(10, a.db / 20) : 1;
  const mode = a?.mode ?? 'auto';
  if (mode === 'off') return 0;
  if (mode === 'on') return lin;
  if (mode === 'afv') return onProgram(id, T, s) ? lin : 0;
  if (s.settings.audioMode === 'picture') return pictureSoundsAt(T, s).includes(id) ? lin : 0;
  if (!audible.has(id)) return 0;
  const tr = automixTracks(s).find((x) => x.source === id);
  return (tr && s.analysis ? gainAt(tr, s.analysis, T) : 1) * lin;
}
export function setAudioIn(id: string, patch: Partial<{ mode: AudioMode; db: number }>) {
  set((s) => { const cur = s.audioIn[id] ?? { mode: 'auto' as AudioMode, db: 0 }; return { audioIn: { ...s.audioIn, [id]: { ...cur, ...patch, db: Math.max(-60, Math.min(6, (patch.db ?? cur.db))) } } }; });
}
