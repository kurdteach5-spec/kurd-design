import type {
  Adjustment, AdjustmentKind, AdjustmentLayer, GroupLayer, Layer, LayerEffects, Paint, RasterLayer, ShapeGeometry,
  ShapeLayer, StrokeStyle, TextLayer, TextStyle, LevelsChannel, SelectiveColorKey, CMYK, LayerMask, SmartContents, SmartObjectLayer,
} from '../types/document';
import { uid } from '../utils/id';
import { IDENTITY, translate, type Matrix } from '../utils/math';
import { createCanvas } from '../utils/canvas';

export const defaultEffects = (): LayerEffects => ({
  dropShadow: { enabled: false, color: '#000000', opacity: 0.6, angle: 120, distance: 12, blur: 18, spread: 0 },
  outerGlow: { enabled: false, color: '#ffe08a', opacity: 0.8, blur: 24, spread: 0 },
  stroke: { enabled: false, color: '#000000', opacity: 1, width: 3 },
});

function base(name: string) {
  return {
    id: uid('layer'), name, visible: true, locked: false, opacity: 1, fillOpacity: 1,
    blendMode: 'normal' as const, clipped: false, mask: null, vectorMask: null, effects: defaultEffects(),
  };
}

export function createRasterLayer(name: string, canvas: HTMLCanvasElement, transform: Matrix = IDENTITY): RasterLayer {
  return { ...base(name), type: 'raster', canvas, transform: { ...transform } };
}

export function createSmartObject(name: string, contents: SmartContents, transform: Matrix = IDENTITY): SmartObjectLayer {
  return { ...base(name), type: 'smart', contents, transform: { ...transform }, filters: [], filtersEnabled: true };
}

export function createEmptyRaster(name: string, w: number, h: number): RasterLayer {
  return createRasterLayer(name, createCanvas(w, h));
}

export const defaultTextStyle = (): TextStyle => ({
  fontFamily: 'Inter', fontSize: 48, fontWeight: 400, italic: false, underline: false, strikethrough: false,
  align: 'left', letterSpacing: 0, lineHeight: 1.2, color: '#ffffff', textOpacity: 1, transform: 'none',
  stroke: { enabled: false, color: '#000000', width: 2 },
  shadow: { enabled: false, color: '#000000', opacity: 0.5, offsetX: 3, offsetY: 3, blur: 6 },
});

export function createTextLayer(text: string, x: number, y: number, style: TextStyle, boxWidth: number | null = null): TextLayer {
  const name = text.split('\n')[0].slice(0, 32) || 'Text';
  return { ...base(name), type: 'text', text, style: { ...style, stroke: { ...style.stroke }, shadow: { ...style.shadow } }, boxWidth, transform: translate(x, y) };
}

export const defaultGeometry = (kind: ShapeGeometry['kind'], w: number, h: number): ShapeGeometry => ({
  kind, width: w, height: h, radius: 0, sides: kind === 'star' ? 5 : 6, innerRatio: 0.45,
  nodes: [], closed: true, arrowStart: false, arrowEnd: false,
});

export const solidPaint = (color: string): Paint => ({
  type: 'solid', color, angle: 90,
  stops: [{ offset: 0, color, opacity: 1 }, { offset: 1, color: '#000000', opacity: 1 }],
});
export const defaultStroke = (color = '#000000', width = 0): StrokeStyle => ({ enabled: width > 0, color, width: Math.max(width, 1), align: 'center', dash: 'solid' });

export function createShapeLayer(name: string, geometry: ShapeGeometry, transform: Matrix, fill: Paint, stroke: StrokeStyle): ShapeLayer {
  return { ...base(name), type: 'shape', geometry, fill, stroke, transform: { ...transform } };
}

export function createGroup(name: string, children: Layer[] = []): GroupLayer {
  return { ...base(name), type: 'group', blendMode: 'pass-through', children, expanded: true };
}

const lv = (): LevelsChannel => ({ inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 });
const curve = () => [{ x: 0, y: 0 }, { x: 255, y: 255 }];
const cmyk = (): CMYK => ({ c: 0, m: 0, y: 0, k: 0 });

export function defaultAdjustment(kind: AdjustmentKind): Adjustment {
  switch (kind) {
    case 'brightness-contrast': return { kind, brightness: 0, contrast: 0 };
    case 'levels': return { kind, rgb: lv(), r: lv(), g: lv(), b: lv() };
    case 'curves': return { kind, rgb: curve(), r: curve(), g: curve(), b: curve() };
    case 'exposure': return { kind, exposure: 0, offset: 0, gamma: 1 };
    case 'hue-saturation': return { kind, hue: 0, saturation: 0, lightness: 0, colorize: false };
    case 'vibrance': return { kind, vibrance: 0, saturation: 0 };
    case 'color-balance': return { kind, shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0], preserveLuminosity: true };
    case 'black-white': return { kind, reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80, tint: false, tintColor: '#e1c29a' };
    case 'gradient-map': return { kind, reverse: false, stops: [{ offset: 0, color: '#1b1f3b', opacity: 1 }, { offset: 0.5, color: '#c4527a', opacity: 1 }, { offset: 1, color: '#ffe7a8', opacity: 1 }] };
    case 'selective-color': {
      const keys: SelectiveColorKey[] = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks'];
      return { kind, mode: 'relative', colors: Object.fromEntries(keys.map((k) => [k, cmyk()])) as Record<SelectiveColorKey, CMYK> };
    }
    case 'develop': return { kind, exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, temperature: 0, tint: 0, vibrance: 0, saturation: 0, hue: 0, gamma: 1, clarity: 0, sharpness: 0 };
    case 'invert': return { kind };
    case 'threshold': return { kind, level: 128 };
    case 'posterize': return { kind, levels: 4 };
  }
}

export const ADJUSTMENT_LABELS: Record<AdjustmentKind, string> = {
  'develop': 'Color Adjust', 'brightness-contrast': 'Brightness/Contrast', 'levels': 'Levels', 'curves': 'Curves',
  'exposure': 'Exposure', 'hue-saturation': 'Hue/Saturation', 'vibrance': 'Vibrance', 'color-balance': 'Color Balance',
  'black-white': 'Black & White', 'gradient-map': 'Gradient Map', 'selective-color': 'Selective Color',
  'invert': 'Invert', 'threshold': 'Threshold', 'posterize': 'Posterize',
};

export function createAdjustmentLayer(kind: AdjustmentKind): AdjustmentLayer {
  return { ...base(ADJUSTMENT_LABELS[kind]), type: 'adjustment', adjustment: defaultAdjustment(kind) };
}

/** Clone with fresh ids. Pixel canvases are immutable once committed, so they can be shared safely. */
export function cloneLayer(l: Layer, renameSuffix = ' copy'): Layer {
  const common = { id: uid('layer'), name: l.name + renameSuffix, mask: l.mask ? { ...l.mask } : null, vectorMask: l.vectorMask ? { ...l.vectorMask } : null };
  switch (l.type) {
    case 'raster': return { ...l, ...common };
    case 'group': return { ...l, ...common, children: l.children.map((c) => cloneLayer(c, '')) };
    default: return { ...l, ...common } as Layer;
  }
}

export function createMask(w: number, h: number, gray: number, transform: Matrix = IDENTITY): LayerMask {
  const c = createCanvas(w, h);
  const x = c.getContext('2d')!; x.fillStyle = `rgb(${gray},${gray},${gray})`; x.fillRect(0, 0, w, h);
  return { canvas: c, transform: { ...transform }, background: gray, enabled: true, linked: true, density: 1, feather: 0 };
}

export const LAYER_TYPE_LABEL: Record<Layer['type'], string> = {
  raster: 'Pixel layer', text: 'Text layer', shape: 'Shape layer', adjustment: 'Adjustment layer', group: 'Group', smart: 'Smart Object',
};
