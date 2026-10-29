// Split Screen state: the chosen layout (boxes), the area on the screen it stays in, the look, what is in
// each window, and your own saved layouts. The look and your layouts are kept in this browser.
import { create } from '../state/createStore';
import { LAYOUTS, type Box, type Layout } from './layouts';

export interface Area { x: number; y: number; w: number; h: number }
export interface SplitStyle {
  width: number; height: number;
  /** the windows stay inside this part of the screen (0–1); null = the whole screen with a margin */
  area: Area | null; margin: number;
  gap: number; radius: number; borderW: number; borderColor: string; glow: boolean;
  bgType: 'solid' | 'gradient' | 'image' | 'transparent'; bg1: string; bg2: string; bgAngle: number; bgImage: string | null;
  labels: boolean; labelBg: string; labelColor: string; labelSize: number;
  hostColor: string; mainColor: string; guestColor: string;
}
export const defaultStyle = (): SplitStyle => ({
  width: 1920, height: 1080, area: { x: 0, y: 0.13, w: 1, h: 0.72 }, margin: 0,
  gap: 8, radius: 0, borderW: 2, borderColor: '#ffffff', glow: false,
  bgType: 'gradient', bg1: '#2a0a63', bg2: '#7b1fd6', bgAngle: 120, bgImage: null,
  labels: false, labelBg: '#7c3aed', labelColor: '#ffffff', labelSize: 30,
  hostColor: '#7c5cff', mainColor: '#22d3ee', guestColor: '#64748b',
});
export interface Content { url: string; kind: 'image' | 'video' | 'camera'; name: string; stream?: MediaStream }
export interface SplitState {
  count: number | 'all'; family: string | 'all';
  layout: Layout; boxes: Box[]; edited: boolean;
  style: SplitStyle; contents: (Content | null)[]; labels: string[];
  selected: number | null; editBoxes: boolean; editArea: boolean;
  /** also list layouts whose windows are thin or small for the area */
  showAll: boolean;
  mine: Layout[];
}
const KEY = 'sarwar-split-v1';
const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } })() as Partial<{ style: SplitStyle; layoutId: string; boxes: Box[]; labels: string[]; count: number | 'all'; mine: Layout[] }>;
const first = LAYOUTS.find((l) => l.id === saved.layoutId) ?? LAYOUTS.find((l) => l.n === 4 && l.family === 'Centre stage') ?? LAYOUTS[0];

export const useSplit = create<SplitState>(() => ({
  count: saved.count ?? 4, family: 'all',
  layout: first, boxes: saved.boxes ?? first.boxes, edited: !!saved.boxes && JSON.stringify(saved.boxes) !== JSON.stringify(first.boxes),
  style: { ...defaultStyle(), ...(saved.style ?? {}) }, contents: [], labels: saved.labels ?? [],
  selected: null, editBoxes: false, editArea: false, showAll: false, mine: saved.mine ?? [],
}));
let t = 0;
useSplit.subscribe((s) => {
  clearTimeout(t);
  t = window.setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ style: s.style, layoutId: s.layout.id, boxes: s.boxes, labels: s.labels, count: s.count, mine: s.mine })); }
    catch { try { localStorage.setItem(KEY, JSON.stringify({ style: { ...s.style, bgImage: null }, layoutId: s.layout.id, boxes: s.boxes, labels: s.labels, count: s.count, mine: s.mine })); } catch { /* storage full */ } }
  }, 300);
});

export const setStyle = (p: Partial<SplitStyle>) => useSplit.setState((s) => ({ style: { ...s.style, ...p } }));
export const chooseLayout = (l: Layout) => useSplit.setState({ layout: l, boxes: l.boxes.map((b) => ({ ...b })), edited: false, selected: null });
export const setBoxes = (boxes: Box[]) => useSplit.setState({ boxes, edited: true });
export function setContent(i: number, c: Content | null) {
  useSplit.setState((s) => {
    const contents = [...s.contents];
    const old = contents[i];
    if (old?.url.startsWith('blob:') && !contents.some((x, k) => k !== i && x?.url === old.url)) URL.revokeObjectURL(old.url);
    old?.stream?.getTracks().forEach((tr) => tr.stop());
    contents[i] = c; return { contents };
  });
}
export const setLabel = (i: number, v: string) => useSplit.setState((s) => { const labels = [...s.labels]; labels[i] = v; return { labels }; });
export function saveMine(name: string) {
  const s = useSplit.getState();
  const l: Layout = { id: `mine-${Date.now().toString(36)}`, n: s.boxes.length, family: 'Mine', name: name.trim() || `My layout ${s.mine.length + 1}`, boxes: s.boxes.map((b) => ({ ...b })) };
  useSplit.setState({ mine: [l, ...s.mine], layout: l, edited: false });
  return l;
}
export const deleteMine = (id: string) => useSplit.setState((s) => ({ mine: s.mine.filter((l) => l.id !== id) }));

/** the area in pixels */
export function areaPx(st: SplitStyle) {
  const W = st.width, H = st.height;
  if (st.area) return { x: st.area.x * W, y: st.area.y * H, w: st.area.w * W, h: st.area.h * H };
  return { x: st.margin, y: st.margin, w: W - st.margin * 2, h: H - st.margin * 2 };
}
/** a window in pixels, with the gap between windows (no gap at the edges of the area) */
export function boxPx(b: Box, st: SplitStyle) {
  const A = areaPx(st), g = st.gap / 2, e = 0.001;
  let x = A.x + b.x * A.w, y = A.y + b.y * A.h, w = b.w * A.w, h = b.h * A.h;
  if (b.float) return { x, y, w, h };
  const l = b.x > e ? g : 0, r = b.x + b.w < 1 - e ? g : 0, tp = b.y > e ? g : 0, bt = b.y + b.h < 1 - e ? g : 0;
  x += l; y += tp; w -= l + r; h -= tp + bt;
  w = Math.max(1, w); h = Math.max(1, h);
  if (b.fit) { const fw = Math.min(w, (h * 16) / 9), fh = (fw * 9) / 16; x += (w - fw) / 2; y += (h - fh) / 2; w = fw; h = fh; }
  return { x, y, w, h };
}
/** the outline of a window inside its box (for slanted windows), as points relative to the box; null = a plain (or round) box */
export function slantPoints(b: Box, p: { w: number; h: number }): [number, number][] | null {
  if (b.shape !== 'slant') return null;
  const e = 0.001, d = Math.min(p.h * 0.2, p.w * 0.3);
  const li = b.x > e, ri = b.x + b.w < 1 - e;
  return [[li ? d / 2 : 0, 0], [p.w + (ri ? d / 2 : 0), 0], [p.w - (ri ? d / 2 : 0), p.h], [li ? -d / 2 : 0, p.h]].map(([x, y]) => [Math.max(0, Math.min(p.w, x)), y]) as [number, number][];
}
/** a round window is a circle inside its box */
export function circleOf(p: { x: number; y: number; w: number; h: number }) { const d = Math.min(p.w, p.h); return { x: p.x + (p.w - d) / 2, y: p.y + (p.h - d) / 2, w: d, h: d }; }
/** windows that are too thin or too small for the area are hidden from the list */
export function goodLayout(boxes: Box[], st: SplitStyle) {
  const A = areaPx(st); const min = Math.max((70 * st.width) / 1920, Math.min(A.w, A.h) * 0.13);
  return boxes.every((b) => {
    let p = boxPx(b, st); if (b.shape === 'circle') p = circleOf(p);
    const ar = p.w / p.h;
    if (b.shape !== 'circle' && !b.fit && (ar < 0.55 || ar > 2.6)) return false;
    return Math.min(p.w, p.h) >= min && (p.w * p.h) / (A.w * A.h) >= 0.012;
  });
}
export const defaultLabel = (b: Box, i: number, boxes: Box[]) => {
  const same = boxes.filter((x) => x.role === b.role);
  const k = same.indexOf(b) + 1;
  return b.role === 'host' ? (same.length > 1 ? `Presenter ${k}` : 'Presenter') : b.role === 'main' ? 'Report' : `Guest ${boxes.filter((x, j) => x.role === 'guest' && j <= i).length}`;
};
