import { create } from './createStore';
import type { TextStyle } from '../types/document';
import { defaultTextStyle } from '../layers/factory';

export type ToolId =
  | 'move' | 'marquee-rect' | 'marquee-ellipse' | 'lasso' | 'lasso-polygon' | 'magic-wand' | 'crop' | 'eyedropper'
  | 'brush' | 'pencil' | 'clone-stamp' | 'eraser' | 'paint-bucket' | 'gradient' | 'blur' | 'sharpen' | 'smudge'
  | 'dodge' | 'burn' | 'pen' | 'path-select' | 'text' | 'shape-rect' | 'shape-ellipse' | 'shape-polygon' | 'shape-line'
  | 'hand' | 'zoom';

export type SelectionMode = 'new' | 'add' | 'subtract' | 'intersect';

export interface ToolOptions {
  move: { autoSelect: boolean; showTransform: boolean };
  marquee: { mode: SelectionMode; feather: number; antiAlias: boolean; style: 'normal' | 'ratio' | 'fixed'; ratioW: number; ratioH: number };
  lasso: { mode: SelectionMode; feather: number; antiAlias: boolean };
  wand: { mode: SelectionMode; tolerance: number; contiguous: boolean; sampleAll: boolean; antiAlias: boolean };
  crop: { ratio: 'free' | 'original' | '1:1' | '4:3' | '16:9' | '3:2' | '9:16'; deleteCropped: boolean };
  eyedropper: { sample: 'current' | 'all'; size: 1 | 3 | 5 };
  brush: { size: number; hardness: number; opacity: number; flow: number; smoothing: number; spacing: number; pressureSize: boolean; pressureOpacity: boolean };
  pencil: { size: number; opacity: number };
  eraser: { size: number; hardness: number; opacity: number; flow: number; mode: 'brush' | 'pencil' };
  clone: { size: number; hardness: number; opacity: number; flow: number; aligned: boolean; sampleAll: boolean };
  retouch: { size: number; hardness: number; strength: number; sampleAll: boolean };
  tone: { size: number; hardness: number; exposure: number; range: 'shadows' | 'midtones' | 'highlights' };
  bucket: { tolerance: number; contiguous: boolean; sampleAll: boolean; antiAlias: boolean; opacity: number };
  gradient: { type: 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond'; preset: 'fg-bg' | 'fg-transparent' | 'bw' | 'spectrum'; reverse: boolean; opacity: number; dither: boolean };
  text: TextStyle;
  shape: {
    fill: string; fillEnabled: boolean; stroke: string; strokeEnabled: boolean; strokeWidth: number; radius: number;
    sides: number; star: boolean; innerRatio: number; lineWidth: number; arrowStart: boolean; arrowEnd: boolean;
  };
  pen: { mode: 'shape' | 'vector-mask' | 'selection' };
  zoom: { scrubby: boolean };
}

export const defaultToolOptions = (): ToolOptions => ({
  move: { autoSelect: false, showTransform: true },
  marquee: { mode: 'new', feather: 0, antiAlias: true, style: 'normal', ratioW: 1, ratioH: 1 },
  lasso: { mode: 'new', feather: 0, antiAlias: true },
  wand: { mode: 'new', tolerance: 32, contiguous: true, sampleAll: false, antiAlias: true },
  crop: { ratio: 'free', deleteCropped: false },
  eyedropper: { sample: 'all', size: 1 },
  brush: { size: 24, hardness: 0.8, opacity: 1, flow: 1, smoothing: 0.3, spacing: 0.12, pressureSize: true, pressureOpacity: false },
  pencil: { size: 2, opacity: 1 },
  eraser: { size: 40, hardness: 0.8, opacity: 1, flow: 1, mode: 'brush' },
  clone: { size: 50, hardness: 0.5, opacity: 1, flow: 1, aligned: true, sampleAll: false },
  retouch: { size: 40, hardness: 0.5, strength: 0.5, sampleAll: false },
  tone: { size: 60, hardness: 0.3, exposure: 0.3, range: 'midtones' },
  bucket: { tolerance: 32, contiguous: true, sampleAll: false, antiAlias: true, opacity: 1 },
  gradient: { type: 'linear', preset: 'fg-bg', reverse: false, opacity: 1, dither: true },
  text: defaultTextStyle(),
  shape: { fill: '#4f8cff', fillEnabled: true, stroke: '#0b1220', strokeEnabled: false, strokeWidth: 4, radius: 0, sides: 6, star: false, innerRatio: 0.45, lineWidth: 6, arrowStart: false, arrowEnd: false },
  pen: { mode: 'shape' },
  zoom: { scrubby: false },
});

export interface ToolState {
  tool: ToolId;
  previousTool: ToolId | null; // for spring-loaded tools (space → hand)
  options: ToolOptions;
  foreground: string;
  background: string;
  colorHistory: string[];
  swatches: string[];
}

const DEFAULT_SWATCHES = [
  '#000000', '#3a3d42', '#7a7f87', '#c4c8ce', '#ffffff', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be',
  '#30b0ff', '#4f8cff', '#5856d6', '#af52de', '#ff2d92', '#a2845e', '#1b2a4a', '#0f5132', '#7c2d12', '#f5e6c8',
];

export const useTools = create<ToolState>(() => ({
  tool: 'move', previousTool: null, options: defaultToolOptions(),
  foreground: '#000000', background: '#ffffff', colorHistory: [], swatches: DEFAULT_SWATCHES,
}));

export function setTool(tool: ToolId) { useTools.setState({ tool }); }

export function setOptions<K extends keyof ToolOptions>(key: K, patch: Partial<ToolOptions[K]>) {
  useTools.setState((s) => ({ options: { ...s.options, [key]: { ...s.options[key], ...patch } } }));
}

export function setForeground(color: string, record = true) {
  useTools.setState((s) => ({ foreground: color, colorHistory: record ? pushHistory(s.colorHistory, color) : s.colorHistory }));
}
export function setBackground(color: string, record = true) {
  useTools.setState((s) => ({ background: color, colorHistory: record ? pushHistory(s.colorHistory, color) : s.colorHistory }));
}
export function recordColor(color: string) { useTools.setState((s) => ({ colorHistory: pushHistory(s.colorHistory, color) })); }
function pushHistory(h: string[], c: string) { return [c, ...h.filter((x) => x.toLowerCase() !== c.toLowerCase())].slice(0, 18); }
export function swapColors() { useTools.setState((s) => ({ foreground: s.background, background: s.foreground })); }
export function resetColors() { useTools.setState({ foreground: '#000000', background: '#ffffff' }); }

// Persist options and swatches between sessions.
const KEY = 'designpro.tools.v1';
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (saved) {
    const def = defaultToolOptions();
    const options = { ...def } as Record<string, unknown>;
    for (const k of Object.keys(def)) options[k] = { ...(def as unknown as Record<string, object>)[k], ...(saved.options?.[k] ?? {}) };
    useTools.setState({
      options: options as unknown as ToolOptions,
      foreground: saved.foreground ?? '#000000', background: saved.background ?? '#ffffff',
      colorHistory: saved.colorHistory ?? [], swatches: saved.swatches ?? DEFAULT_SWATCHES,
    });
  }
} catch { /* storage unavailable */ }
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useTools.subscribe((s) => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ options: s.options, foreground: s.foreground, background: s.background, colorHistory: s.colorHistory, swatches: s.swatches })); } catch { /* ignore */ }
  }, 400);
});
