// Podcast / talk-show multicam auto-editor: data model.
//
// Timeline time ("T", seconds) is the clock of the reference recording (a wide shot, or the first
// camera). Every synchronised source has an offset so that sourceTime = T + offset.
// B-roll clips are not synchronised: a B-roll shot plays its clip from `srcIn`.

export interface Source {
  id: string;
  file: File;
  name: string;
  url: string;
  kind: 'video' | 'audio';
  duration: number;
  width: number;
  height: number;
  /** sourceTime = T + offset */
  offset: number;
}

/**
 * speaker: shows one person (medium shot, close-up…); wide: two-shot / group shot;
 * insert: a synchronised detail camera (hands, table, product, audience…).
 */
export type CamRole = 'speaker' | 'wide' | 'insert';

export interface Camera {
  /** = source id */
  id: string;
  role: CamRole;
  /** speaker id for role 'speaker' */
  speaker: string | null;
}

export interface Speaker {
  id: string;
  name: string;
  /** source id of this person's own microphone recording */
  mic: string | null;
}

/** Speech state per analysis frame (100 frames per second): 0 silence, 1…N = speaker index + 1, BOTH = several at once. */
export const SILENCE = 0;
export const BOTH = 255;

export interface Analysis {
  /** frames per second of the arrays below */
  rate: number;
  /** timeline time of frame 0 */
  t0: number;
  /** usable timeline range (where all synchronised cameras recorded) */
  start: number;
  end: number;
  /** speaker ids in the order used by `state` (state k+1 = speakers[k]) */
  speakers: string[];
  state: Uint8Array;
  /** 0..1 speech level of each speaker, and the combined loudness (for cutting on pauses) */
  levels: Float32Array[];
  loud: Float32Array;
  /** smallest dB distance between "own voice" and "other voices" over the speakers' signals */
  separation: number;
  /** sync confidence per source (peak-to-noise ratio of the cross-correlation) */
  syncConfidence: Record<string, number>;
  /** a timeline without speech analysis (vision mixer used before / without "Analyse") */
  stub?: boolean;
}

export type SegmentReason = 'speaker' | 'crosstalk' | 'pause' | 'opening' | 'closing' | 'reaction' | 'variety' | 'angle' | 'insert' | 'broll' | 'split' | 'manual';

/** SuperSource (split screen) box: a camera placed and cropped anywhere in the frame (0..1 coordinates). */
/** border of one box, each side on its own (fraction of the frame width) */
export interface BoxBorder { t: number; r: number; b: number; l: number; color: string }
export interface SSBox { cam: string | null; x: number; y: number; w: number; h: number; crop: { l: number; r: number; t: number; b: number }; on: boolean; border?: BoxBorder }
/** how the boxes come in when the SuperSource goes on air */
export type SSIntro = 'none' | 'slide' | 'zoom' | 'grow' | 'fade' | 'drop';
export interface SSAnim { intro: SSIntro; dur: number; animateChanges: boolean; changeDur: number }
export const defaultSSAnim = (): SSAnim => ({ intro: 'none', dur: 0.8, animateChanges: false, changeDur: 1 });
/** a layout change recorded at time t, moving the boxes to `boxes` over `dur` seconds */
export interface SSKey { t: number; dur: number; boxes: SSBox[] }
const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
/** the boxes the editor changes at time T: the last layout change before T, else the base layout */
export function editKeyAt(sp: Split, T: number): number { let k = -1; (sp.keys ?? []).forEach((x, i) => { if (x.t <= T + 1e-6) k = i; }); return k; }
/** box geometry at time T (layout changes animate with an ease-in-out) */
export function boxesAt(sp: Split, T: number | undefined): SSBox[] {
  const keys = sp.keys; if (!keys?.length || T === undefined) return sp.boxes;
  const k = editKeyAt(sp, T); if (k < 0) return sp.boxes;
  const key = keys[k]; const from = k > 0 ? keys[k - 1].boxes : sp.boxes;
  const p = key.dur > 0 ? Math.min(1, (T - key.t) / key.dur) : 1;
  if (p >= 1) return key.boxes;
  const e = ease(p);
  return key.boxes.map((b, i) => {
    const a = from[i] ?? { ...b, x: b.x + b.w / 2, y: b.y + b.h / 2, w: 0, h: 0 };
    return { ...b, x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), w: lerp(a.w, b.w, e), h: lerp(a.h, b.h, e), crop: { l: lerp(a.crop.l, b.crop.l, e), r: lerp(a.crop.r, b.crop.r, e), t: lerp(a.crop.t, b.crop.t, e), b: lerp(a.crop.b, b.crop.b, e) } };
  }).concat(from.slice(key.boxes.length).map((a) => ({ ...a, x: a.x + (a.w * e) / 2, y: a.y + (a.h * e) / 2, w: a.w * (1 - e), h: a.h * (1 - e) })));
}
/** intro animation of box i, `t` seconds after the SuperSource went on air: transform of the box, opacity */
export function introOf(anim: SSAnim | undefined, i: number, n: number, t: number, b: SSBox): { x: number; y: number; w: number; h: number; alpha: number } | null {
  if (!anim || anim.intro === 'none' || t < 0) return null;
  const stagger = Math.min(0.15, anim.dur * 0.2);
  const p = Math.max(0, Math.min(1, (t - i * stagger) / Math.max(0.05, anim.dur)));
  if (p >= 1) return null;
  const e = ease(p); const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  switch (anim.intro) {
    case 'slide': { const dir = cx < 0.5 ? -1 : 1; return { x: b.x + dir * (1 - e) * (b.w + 0.1 + (dir < 0 ? b.x : 1 - b.x - b.w)), y: b.y, w: b.w, h: b.h, alpha: 1 }; }
    case 'drop': return { x: b.x, y: b.y - (1 - e) * (b.y + b.h + 0.05), w: b.w, h: b.h, alpha: 1 };
    case 'zoom': { const k = 0.6 + 0.4 * e; return { x: cx - (b.w * k) / 2, y: cy - (b.h * k) / 2, w: b.w * k, h: b.h * k, alpha: e }; }
    case 'grow': return { x: cx - (b.w * e) / 2, y: cy - (b.h * e) / 2, w: b.w * e, h: b.h * e, alpha: 1 };
    case 'fade': return { x: b.x, y: b.y, w: b.w, h: b.h, alpha: e };
  }
  void n; return null;
}
/** Split-screen input (like ATEM SuperSource): several cameras in one picture, freely arranged. */
export interface Split { id: string; name: string; boxes: SSBox[]; bg: string; border: number; borderColor: string; /** the preset the boxes still match (cleared when a box is moved by hand) */ preset?: SplitLayout; anim?: SSAnim; keys?: SSKey[] }
export type SplitLayout = 'side2' | 'stack2' | 'side3' | 'grid4' | 'pip' | 'pip2' | 'cropped2';
export const SPLIT_PRESETS: SplitLayout[] = ['side2', 'cropped2', 'stack2', 'side3', 'grid4', 'pip', 'pip2'];
/** box rectangles of a preset (0..1 frame coordinates); aspect = frame width / height */
export function presetRects(layout: SplitLayout, aspect = 16 / 9, gap = 0.01): { x: number; y: number; w: number; h: number }[] {
  const g = gap, gy = gap * aspect;
  switch (layout) {
    case 'side2': return [{ x: 0, y: 0, w: (1 - g) / 2, h: 1 }, { x: (1 + g) / 2, y: 0, w: (1 - g) / 2, h: 1 }];
    case 'cropped2': { const w = 0.47, h = Math.min(0.95, w * aspect * 9 / 16); return [{ x: 0.02, y: (1 - h) / 2, w, h }, { x: 0.51, y: (1 - h) / 2, w, h }]; }
    case 'stack2': return [{ x: 0, y: 0, w: 1, h: (1 - gy) / 2 }, { x: 0, y: (1 + gy) / 2, w: 1, h: (1 - gy) / 2 }];
    case 'side3': { const w = (1 - 2 * g) / 3; return [0, 1, 2].map((i) => ({ x: i * (w + g), y: 0, w, h: 1 })); }
    case 'grid4': { const w = (1 - g) / 2, h = (1 - gy) / 2; return [0, 1, 2, 3].map((i) => ({ x: (i % 2) * (w + g), y: Math.floor(i / 2) * (h + gy), w, h })); }
    case 'pip': return [{ x: 0, y: 0, w: 1, h: 1 }, { x: 0.66, y: 0.64, w: 0.3, h: 0.3 }];
    case 'pip2': return [{ x: 0, y: 0, w: 1, h: 1 }, { x: 0.04, y: 0.64, w: 0.3, h: 0.3 }, { x: 0.66, y: 0.64, w: 0.3, h: 0.3 }];
  }
}
export const noCrop = () => ({ l: 0, r: 0, t: 0, b: 0 });

/** switcher inputs that are not recordings */
export const VIRTUAL = ['mp1', 'mp2', 'col1', 'col2', 'bars', 'blk'] as const;
export type VirtualInput = typeof VIRTUAL[number];
/** a switcher source that is not a recording: black, colours, bars, media players — and still pictures used as inputs */
export const isVirtual = (id: string): boolean => (VIRTUAL as readonly string[]).includes(id) || isStill(id);
/** a still picture (from the media pool) used as an input */
export const isStill = (id: string): boolean => id.startsWith('media');

/** transitions (vision mixer) */
export type TransStyle = 'mix' | 'dip' | 'wipe' | 'dve';
export type WipePattern = 'h' | 'v' | 'circle' | 'diamond' | 'box' | 'diagL' | 'diagR';
export interface TransParams { style: TransStyle; dur: number; dipColor: string; wipe: WipePattern; reverse: boolean; border: number; borderColor: string; dveDir: 'left' | 'right' | 'up' | 'down' }
export const defaultTrans = (): TransParams => ({ style: 'mix', dur: 1, dipColor: '#000000', wipe: 'h', reverse: false, border: 0, borderColor: '#ffffff', dveDir: 'left' });

/** upstream key */
export type KeyType = 'luma' | 'chroma' | 'pattern' | 'dve';
export interface KeyConfig {
  type: KeyType;
  fill: string;
  keySrc: string;
  clip: number; gain: number; invert: boolean;
  chroma: { color: string; tol: number; soft: number; spill: number };
  pattern: { shape: 'circle' | 'rect' | 'diamond'; size: number; x: number; y: number; invert: boolean };
  dve: { x: number; y: number; w: number; h: number; border: number; borderColor: string; crop: { l: number; r: number; t: number; b: number } };
}
export const defaultKey = (fill = 'col1'): KeyConfig => ({
  type: 'dve', fill, keySrc: fill, clip: 0.3, gain: 0.7, invert: false,
  chroma: { color: '#00b140', tol: 0.12, soft: 0.08, spill: 0.6 },
  pattern: { shape: 'circle', size: 0.5, x: 0.5, y: 0.5, invert: false },
  dve: { x: 0.64, y: 0.06, w: 0.32, h: 0.32, border: 0.004, borderColor: '#ffffff', crop: noCrop() },
});
/** downstream key (logos, lower thirds, titles) */
export interface DskConfig { fill: string; keySrc: 'alpha' | 'luma' | 'none'; clip: number; gain: number; invert: boolean; rate: number; tie: boolean }
export const defaultDsk = (fill = 'mp1'): DskConfig => ({ fill, keySrc: 'alpha', clip: 0.3, gain: 0.7, invert: false, rate: 1, tie: false });

/** keys, downstream keys and fade-to-black recorded on the timeline */
export interface Overlay {
  id: string;
  kind: 'usk' | 'dsk' | 'ftb';
  slot: number;
  start: number; end: number;
  fadeIn: number; fadeOut: number;
  key?: KeyConfig;
  dsk?: DskConfig;
}

/** multiview */
export type MvLayout = 'classic' | 'pgmBig' | 'quad' | 'custom';
/** a window of a custom multiview: 'pgm', 'pvw', an input id, or '' (empty); cs × rs grid cells */
export interface MvCell { src: string; cs: number; rs: number }
/** count 0 = one window per input (grows when cameras are added); windows[i] '' = automatic */
export interface MultiviewConfig { layout: MvLayout; windows: string[]; count: number; labels: boolean; tally: boolean; safe: boolean; meters: boolean; clock: boolean; custom?: { cols: number; cells: MvCell[] } }
export const defaultMultiview = (): MultiviewConfig => ({ layout: 'classic', windows: [], count: 0, labels: true, tally: true, safe: false, meters: true, clock: true });

export interface Segment {
  id: string;
  start: number;
  end: number;
  /** camera id, or a B-roll source id */
  cam: string;
  reason: SegmentReason;
  /** B-roll only: clip time at `start` */
  srcIn?: number;
  /** dissolve from the previous shot, starting at `start` (s) — older edits; new edits use `trans` */
  mix?: number;
  /** transition from the previous shot, starting at `start` */
  trans?: TransParams;
  /** sound cut relative to the picture cut (s): negative = the sound comes first (J-cut), positive = it comes later (L-cut) */
  audioShift?: number;
}

export type Pacing = 'calm' | 'balanced' | 'dynamic';
export type CutTiming = 'pause' | 'onset' | 'late';
export type InsertAmount = 'off' | 'few' | 'normal' | 'many';
/** seconds of continuous talk between two inserts */
export const INSERT_EVERY: Record<InsertAmount, number> = { off: 0, few: 45, normal: 25, many: 14 };

export interface EditSettings {
  pacing: Pacing;
  /** shortest shot (s) */
  minShot: number;
  /** longest uninterrupted shot of one speaker before a cutaway (s) */
  maxShot: number;
  /** speech shorter than this (s) from a listener doesn't cause a cut ("yeah", "mm-hmm") */
  minTurn: number;
  cutTiming: CutTiming;
  /** start / end on the wide shot (s, 0 = off) */
  openingWide: number;
  closingWide: number;
  /** cut to the wide shot when several people talk at the same time */
  wideOnCrosstalk: boolean;
  /** silence longer than this (s) goes to the wide shot */
  wideOnSilence: number;
  /** listener reaction shots during long answers */
  reactions: boolean;
  /** wide-shot cutaways during long answers */
  wideCutaways: boolean;
  /** speakers with several cameras: change angle between turns and inside long answers */
  angles: boolean;
  /** insert / B-roll shots during long answers */
  inserts: InsertAmount;
  /** length of an insert (s) */
  insertLen: number;
  /** split screen (when one shows both people) for quick back-and-forth and crosstalk between two people */
  splitDialog: boolean;
  /** sound: the master track(s), or only the person who is speaking (automix) */
  /** speaker = automix (only the person talking), master = one track, picture = the sound of what is on screen (cuts with the video, J/L cuts) */
  audioMode: 'master' | 'speaker' | 'picture';
  /** level of people who are not speaking in automix (dB; -60 = off) */
  duckDb: number;
  /** dissolve length for AUTO in the vision mixer (s) */
  mixDur: number;
  fps: number;
}

export const PACING: Record<Pacing, Pick<EditSettings, 'minShot' | 'maxShot' | 'minTurn' | 'wideOnSilence'>> = {
  calm: { minShot: 3, maxShot: 20, minTurn: 1.8, wideOnSilence: 4 },
  balanced: { minShot: 2, maxShot: 12, minTurn: 1.2, wideOnSilence: 3 },
  dynamic: { minShot: 1.2, maxShot: 7, minTurn: 0.8, wideOnSilence: 2 },
};

export const defaultSettings = (): EditSettings => ({
  pacing: 'balanced', ...PACING.balanced, cutTiming: 'pause', openingWide: 4, closingWide: 3,
  wideOnCrosstalk: true, reactions: true, wideCutaways: true, angles: true, inserts: 'normal', insertLen: 3,
  splitDialog: true, audioMode: 'speaker', duckDb: -60, mixDur: 0.5, fps: 30,
});

/** Everything the cutting rules need to know about the cameras. */
export interface Rig {
  speakers: string[];
  /** cameras of each speaker (by speaker id), in the user's order */
  speakerCams: Record<string, string[]>;
  wides: string[];
  inserts: string[];
  /** B-roll clips: id + length (s) */
  broll: { id: string; duration: number }[];
  /** split screens and the people they show */
  splits: { id: string; people: string[] }[];
}

export interface EditStats {
  duration: number;
  shots: number;
  cuts: number;
  /** average shot length (s) */
  asl: number;
  cutsPerMinute: number;
  /** screen time per camera / B-roll id (0..1) */
  share: Record<string, number>;
  /** talk time per speaker id + 'both' + 'silence' (0..1) */
  talk: Record<string, number>;
}

/** colors for cameras and speakers */
export const PALETTE = ['#4f8cff', '#f5a524', '#e5609a', '#9b7bff', '#3fc1d9', '#ff7a45', '#8bc34a', '#f06292'];
export const WIDE_COLOR = '#22c08a';
export const INSERT_COLOR = '#a1887f';
export const BROLL_COLOR = '#c0a060';
export const SPLIT_COLOR = '#b388ff';
export const VIRTUAL_COLOR = '#8a929d';
