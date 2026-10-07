import type {
  AssetMeta, CameraLayer, Composition, Effect, LayerBase, LayerType, Mask, MLayer, MPath, MotionProject, ShapeKind, ShapeLayer, TextLayer, Transform, Vec2, Vec3,
} from './types';
import { prop } from './anim';
import { EFFECT_DEFS } from './render/effectDefs';
import { uid } from '../utils/id';

export const LABEL_COLORS = ['#e5484d', '#f2c94c', '#56c596', '#4f8cff', '#b07cff', '#f58a3c', '#4cc9f0', '#f06ba8', '#a3b18a', '#8d99ae'];
let labelIdx = 0;

export const COMP_PRESETS = [
  { id: '1080p', label: 'HD 1080p · 1920×1080', w: 1920, h: 1080 },
  { id: 'vertical', label: 'Vertical · 1080×1920', w: 1080, h: 1920 },
  { id: 'portrait', label: 'Portrait · 1080×1350', w: 1080, h: 1350 },
  { id: 'square', label: 'Square · 1080×1080', w: 1080, h: 1080 },
  { id: '4k', label: '4K UHD · 3840×2160', w: 3840, h: 2160 },
];
export const FPS_OPTIONS = [24, 25, 30, 50, 60];

export function newComposition(o: Partial<Composition> & { name?: string } = {}): Composition {
  const duration = o.duration ?? 10;
  return {
    id: uid('comp'), name: o.name ?? 'Comp 1', width: o.width ?? 1920, height: o.height ?? 1080, fps: o.fps ?? 30, duration,
    background: o.background ?? '#000000', layers: o.layers ?? [], markers: [], workStart: 0, workEnd: duration,
    motionBlur: o.motionBlur ?? true, shutterAngle: 180,
  };
}

export function emptyProject(name = 'Untitled Motion'): MotionProject {
  return { version: 1, name, comps: {}, compOrder: [], assets: {}, assetOrder: [], userPresets: [] };
}

export function defaultTransform(anchor: Vec3 = [0, 0, 0], position: Vec3 = [0, 0, 0]): Transform {
  return {
    anchor: prop<Vec3>(anchor), position: prop<Vec3>(position), scale: prop<Vec3>([100, 100, 100]),
    rotation: prop(0), rotationX: prop(0), rotationY: prop(0), opacity: prop(100),
  };
}

function base(comp: Composition, type: LayerType, name: string, t0: number, dur?: number): LayerBase {
  const end = dur !== undefined ? Math.min(comp.duration, t0 + dur) : comp.duration;
  return {
    id: uid('ly'), name, type, label: LABEL_COLORS[labelIdx++ % LABEL_COLORS.length], visible: true, audioOn: true, locked: false, solo: false, shy: false,
    parentId: null, inPoint: t0, outPoint: Math.max(end, t0 + 1 / comp.fps), start: t0, speed: 1, blend: 'normal', threeD: false, motionBlur: false,
    transform: defaultTransform([0, 0, 0], [comp.width / 2, comp.height / 2, 0]), effects: [], masks: [], effectsOn: true,
  };
}

const center = (comp: Composition): Vec3 => [comp.width / 2, comp.height / 2, 0];

export function newSolid(comp: Composition, color = '#4f8cff', t0 = 0, w = comp.width, h = comp.height, name = 'Solid'): MLayer {
  const b = base(comp, 'solid', name, t0);
  return { ...b, type: 'solid', color: prop(color), width: w, height: h, transform: defaultTransform([w / 2, h / 2, 0], center(comp)) };
}

export function newNull(comp: Composition, t0 = 0): MLayer {
  const b = base(comp, 'null', 'Null', t0);
  return { ...b, type: 'null', transform: defaultTransform([0, 0, 0], center(comp)) };
}

export function newAdjustment(comp: Composition, t0 = 0): MLayer {
  const b = base(comp, 'adjustment', 'Adjustment Layer', t0);
  return { ...b, type: 'adjustment', transform: defaultTransform([comp.width / 2, comp.height / 2, 0], center(comp)) };
}

export function newCamera(comp: Composition, mode: '2d' | '3d' = '3d', t0 = 0): CameraLayer {
  const b = base(comp, 'camera', mode === '3d' ? 'Camera 3D' : 'Camera 2D', t0);
  const focal = 50;
  return {
    ...b, type: 'camera', mode,
    zoom: prop(mode === '3d' ? focal : 100),
    transform: defaultTransform([0, 0, 0], mode === '3d' ? [comp.width / 2, comp.height / 2, -cameraDistance(comp, focal)] : center(comp)),
  };
}

/** distance at which a camera with this focal length shows the comp at 100% (36mm film width) */
export const cameraDistance = (comp: Composition, focalMM: number) => (comp.width * focalMM) / 36;

export function newMediaLayer(comp: Composition, asset: AssetMeta, t0 = 0): MLayer {
  if (asset.kind === 'audio') {
    const b = base(comp, 'audio', asset.name, t0, asset.duration);
    return { ...b, type: 'audio', assetId: asset.id, volume: prop(0), transform: defaultTransform() };
  }
  const fit = Math.min(1, comp.width / asset.width, comp.height / asset.height);
  const tr = defaultTransform([asset.width / 2, asset.height / 2, 0], center(comp));
  if (fit < 1) tr.scale = prop<Vec3>([fit * 100, fit * 100, 100]);
  if (asset.kind === 'video') {
    const b = base(comp, 'video', asset.name, t0, asset.duration);
    return { ...b, type: 'video', assetId: asset.id, volume: prop(0), transform: tr };
  }
  const b = base(comp, 'image', asset.name, t0);
  return { ...b, type: 'image', assetId: asset.id, transform: tr };
}

export function newPrecompLayer(comp: Composition, sub: Composition, t0 = 0): MLayer {
  const b = base(comp, 'precomp', sub.name, t0, sub.duration);
  return { ...b, type: 'precomp', compId: sub.id, transform: defaultTransform([sub.width / 2, sub.height / 2, 0], center(comp)) };
}

export function newText(comp: Composition, text = 'Your text', t0 = 0, opts: { font?: string; size?: number; color?: string; position?: Vec3 } = {}): TextLayer {
  const b = base(comp, 'text', text.split('\n')[0].slice(0, 32) || 'Text', t0);
  const size = opts.size ?? Math.round(comp.height / 10);
  return {
    ...b, type: 'text',
    transform: defaultTransform([0, 0, 0], opts.position ?? center(comp)),
    text: {
      text, font: opts.font ?? 'Inter', weight: 700, italic: false, size: prop(size), color: prop(opts.color ?? '#ffffff'), align: 'center',
      tracking: prop(0), leading: prop(Math.round(size * 1.2)), strokeOn: false, strokeColor: prop('#000000'), strokeWidth: prop(4),
      shadowOn: false, shadowColor: prop('#000000'), shadowBlur: prop(12), shadowDistance: prop(6), shadowAngle: 135,
      animator: { type: 'none', progress: prop(100), offsetY: 40, fade: true },
    },
  };
}

export function rectPath(w: number, h: number): MPath {
  const x = -w / 2, y = -h / 2;
  const v = (px: number, py: number) => ({ x: px, y: py, ix: 0, iy: 0, ox: 0, oy: 0 });
  return { closed: true, points: [v(x, y), v(x + w, y), v(x + w, y + h), v(x, y + h)] };
}
export function ellipsePath(w: number, h: number, cx = 0, cy = 0): MPath {
  const k = 0.5523, rx = w / 2, ry = h / 2;
  return {
    closed: true, points: [
      { x: cx, y: cy - ry, ix: -rx * k, iy: 0, ox: rx * k, oy: 0 },
      { x: cx + rx, y: cy, ix: 0, iy: -ry * k, ox: 0, oy: ry * k },
      { x: cx, y: cy + ry, ix: rx * k, iy: 0, ox: -rx * k, oy: 0 },
      { x: cx - rx, y: cy, ix: 0, iy: ry * k, ox: 0, oy: -ry * k },
    ],
  };
}
export function rectPathAt(x: number, y: number, w: number, h: number): MPath {
  const v = (px: number, py: number) => ({ x: px, y: py, ix: 0, iy: 0, ox: 0, oy: 0 });
  return { closed: true, points: [v(x, y), v(x + w, y), v(x + w, y + h), v(x, y + h)] };
}

export function newShape(comp: Composition, kind: ShapeKind, t0 = 0, o: { size?: Vec2; position?: Vec3; fill?: string; path?: MPath } = {}): ShapeLayer {
  const names: Record<ShapeKind, string> = { rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', line: 'Line', arrow: 'Arrow', path: 'Shape' };
  const b = base(comp, 'shape', names[kind], t0);
  const s = o.size ?? [Math.round(comp.height / 3), Math.round(comp.height / 3)];
  const isLine = kind === 'line' || kind === 'arrow';
  return {
    ...b, type: 'shape',
    transform: defaultTransform([0, 0, 0], o.position ?? center(comp)),
    shape: {
      kind, size: prop<Vec2>(isLine ? [s[0], 0] : s), roundness: prop(0), sides: kind === 'star' ? 5 : 6, innerRadius: prop(45),
      path: prop<MPath>(o.path ?? rectPath(s[0], s[1])),
      fillOn: !isLine && !(kind === 'path' && o.path && !o.path.closed), fill: prop(o.fill ?? '#4f8cff'),
      strokeOn: isLine || (kind === 'path' && !!o.path && !o.path.closed), stroke: prop('#ffffff'), strokeWidth: prop(isLine ? 8 : 4),
      trimStart: prop(0), trimEnd: prop(100),
    },
  };
}

export function newMask(path: MPath, name = 'Mask 1'): Mask {
  return { id: uid('mask'), name, mode: 'add', inverted: false, path: prop(path), feather: prop(0), opacity: prop(100), expansion: prop(0) };
}

export function newEffect(type: string): Effect | null {
  const def = EFFECT_DEFS.find((d) => d.id === type); if (!def) return null;
  const params: Effect['params'] = {};
  for (const p of def.params) params[p.key] = prop(p.default);
  return { id: uid('fx'), type, enabled: true, params };
}

/** Deep copy with fresh ids (duplicate). */
export function cloneLayer<T extends MLayer>(l: T, name = l.name): T {
  const c = JSON.parse(JSON.stringify(l)) as T;
  const fresh = (o: unknown): void => {
    if (Array.isArray(o)) o.forEach(fresh);
    else if (o && typeof o === 'object') {
      const r = o as Record<string, unknown>;
      if (typeof r.id === 'string' && /^(k|fx|mask)_/.test(r.id)) r.id = uid(r.id.split('_')[0]);
      Object.values(r).forEach(fresh);
    }
  };
  fresh(c);
  return { ...c, id: uid('ly'), name };
}
