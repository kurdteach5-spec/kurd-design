import type { Matrix, Rect, Point } from '../utils/math';

export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'hard-light' | 'darken' | 'lighten'
  | 'color-dodge' | 'color-burn' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity'
  | 'pass-through';

export interface GradientStop { offset: number; color: string; opacity: number }
export interface Paint {
  type: 'none' | 'solid' | 'linear' | 'radial';
  color: string;
  stops: GradientStop[];
  angle: number; // degrees, for linear
}
export interface StrokeStyle {
  enabled: boolean;
  color: string;
  width: number;
  align: 'center' | 'inside' | 'outside';
  dash: 'solid' | 'dashed' | 'dotted';
}

export interface DropShadowEffect { enabled: boolean; color: string; opacity: number; angle: number; distance: number; blur: number; spread: number }
export interface OuterGlowEffect { enabled: boolean; color: string; opacity: number; blur: number; spread: number }
export interface StrokeEffect { enabled: boolean; color: string; opacity: number; width: number }
export interface LayerEffects { dropShadow: DropShadowEffect; outerGlow: OuterGlowEffect; stroke: StrokeEffect }

/** Raster layer mask. Gray value: white reveals, black hides. Positioned by its own transform. */
export interface LayerMask {
  canvas: HTMLCanvasElement;
  transform: Matrix;
  /** Gray (0-255) used outside the mask canvas. */
  background: number;
  enabled: boolean;
  linked: boolean;
  density: number; // 0..1
  feather: number; // px
}

export interface PathNode { x: number; y: number; inX: number; inY: number; outX: number; outY: number }

export type ShapeKind = 'rect' | 'ellipse' | 'polygon' | 'star' | 'line' | 'path';
export interface ShapeGeometry {
  kind: ShapeKind;
  width: number;
  height: number;
  radius: number; // rect corner radius / polygon roundness
  sides: number; // polygon & star points
  innerRatio: number; // star inner radius (0..1)
  nodes: PathNode[]; // for path & line (local coordinates)
  closed: boolean;
  arrowStart: boolean;
  arrowEnd: boolean;
}

export interface VectorMask { geometry: ShapeGeometry; transform: Matrix; enabled: boolean; feather: number; invert: boolean }

interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..1
  fillOpacity: number; // 0..1
  blendMode: BlendMode;
  clipped: boolean; // clipped to the layer below
  mask: LayerMask | null;
  vectorMask: VectorMask | null;
  effects: LayerEffects;
}

export interface RasterLayer extends LayerBase {
  type: 'raster';
  canvas: HTMLCanvasElement;
  transform: Matrix;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  align: 'left' | 'center' | 'right' | 'justify';
  letterSpacing: number; // px
  lineHeight: number; // multiplier
  color: string;
  textOpacity: number; // 0..1
  transform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  stroke: { enabled: boolean; color: string; width: number };
  shadow: { enabled: boolean; color: string; opacity: number; offsetX: number; offsetY: number; blur: number };
}

export interface TextLayer extends LayerBase {
  type: 'text';
  text: string;
  style: TextStyle;
  /** null = point text; number = paragraph text wrapped to this width. */
  boxWidth: number | null;
  transform: Matrix;
}

export interface ShapeLayer extends LayerBase {
  type: 'shape';
  geometry: ShapeGeometry;
  fill: Paint;
  stroke: StrokeStyle;
  transform: Matrix;
}

export type CurvePoints = Point[];
export interface LevelsChannel { inBlack: number; inWhite: number; gamma: number; outBlack: number; outWhite: number }
export type CMYK = { c: number; m: number; y: number; k: number };

export type Adjustment =
  | { kind: 'brightness-contrast'; brightness: number; contrast: number }
  | { kind: 'levels'; rgb: LevelsChannel; r: LevelsChannel; g: LevelsChannel; b: LevelsChannel }
  | { kind: 'curves'; rgb: CurvePoints; r: CurvePoints; g: CurvePoints; b: CurvePoints }
  | { kind: 'exposure'; exposure: number; offset: number; gamma: number }
  | { kind: 'hue-saturation'; hue: number; saturation: number; lightness: number; colorize: boolean }
  | { kind: 'vibrance'; vibrance: number; saturation: number }
  | { kind: 'color-balance'; shadows: [number, number, number]; midtones: [number, number, number]; highlights: [number, number, number]; preserveLuminosity: boolean }
  | { kind: 'black-white'; reds: number; yellows: number; greens: number; cyans: number; blues: number; magentas: number; tint: boolean; tintColor: string }
  | { kind: 'gradient-map'; stops: GradientStop[]; reverse: boolean }
  | { kind: 'selective-color'; mode: 'relative' | 'absolute'; colors: Record<SelectiveColorKey, CMYK> }
  | { kind: 'develop'; exposure: number; brightness: number; contrast: number; highlights: number; shadows: number; whites: number; blacks: number; temperature: number; tint: number; vibrance: number; saturation: number; hue: number; gamma: number; clarity: number; sharpness: number }
  | { kind: 'invert' }
  | { kind: 'threshold'; level: number }
  | { kind: 'posterize'; levels: number };

export type AdjustmentKind = Adjustment['kind'];
export type SelectiveColorKey = 'reds' | 'yellows' | 'greens' | 'cyans' | 'blues' | 'magentas' | 'whites' | 'neutrals' | 'blacks';

export interface AdjustmentLayer extends LayerBase {
  type: 'adjustment';
  adjustment: Adjustment;
}

export interface GroupLayer extends LayerBase {
  type: 'group';
  children: Layer[]; // bottom → top
  expanded: boolean;
}

export type Layer = RasterLayer | TextLayer | ShapeLayer | AdjustmentLayer | GroupLayer;
export type LayerType = Layer['type'];
export type TransformableLayer = RasterLayer | TextLayer | ShapeLayer;

/** Selection is an immutable doc-sized alpha mask. */
export interface Selection {
  mask: HTMLCanvasElement;
  bounds: Rect;
}

export interface Guide { id: string; orientation: 'h' | 'v'; pos: number }

export type ColorMode = 'rgb' | 'grayscale';
export type EditTarget = 'content' | 'mask' | 'vectorMask';

/** The immutable, history-tracked state of a document. */
export interface DocState {
  width: number;
  height: number;
  dpi: number;
  colorMode: ColorMode;
  layers: Layer[]; // bottom → top
  activeLayerId: string | null;
  selectedLayerIds: string[];
  editTarget: EditTarget;
  selection: Selection | null;
  guides: Guide[];
}

export interface ViewState { zoom: number; panX: number; panY: number; rotation: number }

export interface HistoryEntry {
  id: string;
  label: string;
  state: DocState;
  mergeKey?: string;
  time: number;
  bytes: number;
}

export interface EditorDocument {
  id: string;
  name: string;
  projectId: string;
  history: HistoryEntry[];
  historyIndex: number;
  savedEntryId: string | null;
  view: ViewState;
  createdAt: number;
}
