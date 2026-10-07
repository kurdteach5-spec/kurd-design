// KURD DESIGN · MOTION — data model.
// A project holds compositions; a composition holds layers; any animatable property is a Prop:
// a static value plus an optional list of keyframes. Everything is plain immutable data so the
// whole project can be undone/redone and saved as JSON (assets are stored separately as blobs).

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** Bezier path vertex; in/out handles are offsets relative to the vertex. */
export interface PathVertex { x: number; y: number; ix: number; iy: number; ox: number; oy: number }
export interface MPath { points: PathVertex[]; closed: boolean }

export type PropValue = number | Vec2 | Vec3 | string | MPath;

/** Interpolation used for the segment that starts at a keyframe. */
export type Interp = 'linear' | 'bezier' | 'hold';

export interface Keyframe<T extends PropValue = PropValue> {
  id: string;
  /** time in seconds (composition time of the layer's composition) */
  t: number;
  v: T;
  interp: Interp;
  /** temporal ease handles, as cubic-bezier control points in the unit square:
   *  out = (x1, y1) of the segment leaving this key, in = (x2, y2) of the segment arriving here */
  out: Vec2;
  in: Vec2;
  /** spatial tangents for position keyframes (motion paths), relative to the key value */
  so?: Vec2;
  si?: Vec2;
}

export interface Prop<T extends PropValue = PropValue> { v: T; k: Keyframe<T>[] }

export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn'
  | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity' | 'add';

export interface Transform {
  anchor: Prop<Vec3>;
  position: Prop<Vec3>;
  /** percent */
  scale: Prop<Vec3>;
  /** degrees (Z rotation) */
  rotation: Prop<number>;
  rotationX: Prop<number>;
  rotationY: Prop<number>;
  /** 0..100 */
  opacity: Prop<number>;
}

export type EffectParamValue = number | string | Vec2;
export interface Effect {
  id: string;
  /** effect definition id, see render/effectDefs.ts */
  type: string;
  enabled: boolean;
  params: Record<string, Prop<EffectParamValue>>;
}

export type MaskMode = 'add' | 'subtract' | 'intersect' | 'none';
export interface Mask {
  id: string;
  name: string;
  mode: MaskMode;
  inverted: boolean;
  path: Prop<MPath>;
  /** px */
  feather: Prop<number>;
  /** 0..100 */
  opacity: Prop<number>;
  /** px, grows (+) or shrinks (−) the mask */
  expansion: Prop<number>;
}

export type LayerType = 'solid' | 'image' | 'video' | 'audio' | 'text' | 'shape' | 'null' | 'adjustment' | 'precomp' | 'camera';

export interface LayerBase {
  id: string;
  name: string;
  type: LayerType;
  /** label color in the timeline */
  label: string;
  visible: boolean;
  audioOn: boolean;
  locked: boolean;
  solo: boolean;
  shy: boolean;
  parentId: string | null;
  /** composition time where the layer starts / ends showing */
  inPoint: number;
  outPoint: number;
  /** composition time of the source's time 0 (video, audio, precomp) */
  start: number;
  /** playback speed of the source (1 = normal) */
  speed: number;
  blend: BlendMode;
  threeD: boolean;
  motionBlur: boolean;
  transform: Transform;
  effects: Effect[];
  masks: Mask[];
  /** effects switch (fx) */
  effectsOn: boolean;
}

export interface SolidLayer extends LayerBase { type: 'solid'; color: Prop<string>; width: number; height: number }
export interface ImageLayer extends LayerBase { type: 'image'; assetId: string }
export interface VideoLayer extends LayerBase { type: 'video'; assetId: string; volume: Prop<number> }
export interface AudioLayer extends LayerBase { type: 'audio'; assetId: string; volume: Prop<number> }
export interface NullLayer extends LayerBase { type: 'null' }
export interface AdjustmentLayer extends LayerBase { type: 'adjustment' }
export interface PrecompLayer extends LayerBase { type: 'precomp'; compId: string }

export type TextAnimatorType = 'none' | 'typewriter' | 'charReveal' | 'wordReveal';
export interface TextData {
  text: string;
  font: string;
  weight: number;
  italic: boolean;
  size: Prop<number>;
  color: Prop<string>;
  align: 'left' | 'center' | 'right';
  /** px between characters */
  tracking: Prop<number>;
  /** px between lines (baseline to baseline) */
  leading: Prop<number>;
  strokeOn: boolean;
  strokeColor: Prop<string>;
  strokeWidth: Prop<number>;
  shadowOn: boolean;
  shadowColor: Prop<string>;
  shadowBlur: Prop<number>;
  shadowDistance: Prop<number>;
  shadowAngle: number;
  animator: { type: TextAnimatorType; progress: Prop<number>; offsetY: number; fade: boolean };
}
export interface TextLayer extends LayerBase { type: 'text'; text: TextData }

export type ShapeKind = 'rect' | 'ellipse' | 'polygon' | 'star' | 'line' | 'arrow' | 'path';
export interface ShapeData {
  kind: ShapeKind;
  size: Prop<Vec2>;
  roundness: Prop<number>;
  sides: number;
  /** star inner radius, 0..100 % */
  innerRadius: Prop<number>;
  path: Prop<MPath>;
  fillOn: boolean;
  fill: Prop<string>;
  strokeOn: boolean;
  stroke: Prop<string>;
  strokeWidth: Prop<number>;
  /** trim paths, 0..100 % */
  trimStart: Prop<number>;
  trimEnd: Prop<number>;
}
export interface ShapeLayer extends LayerBase { type: 'shape'; shape: ShapeData }

export interface CameraLayer extends LayerBase {
  type: 'camera';
  /** 2d: pans/zooms/rotates the whole view · 3d: perspective camera for 3D layers */
  mode: '2d' | '3d';
  /** 2d: percent · 3d: focal length in mm (35mm film) */
  zoom: Prop<number>;
}

export type MLayer = SolidLayer | ImageLayer | VideoLayer | AudioLayer | TextLayer | ShapeLayer | NullLayer | AdjustmentLayer | PrecompLayer | CameraLayer;

export interface Marker { id: string; t: number; label: string }

export interface Composition {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  /** seconds */
  duration: number;
  background: string;
  /** top → bottom, like a timeline */
  layers: MLayer[];
  markers: Marker[];
  workStart: number;
  workEnd: number;
  motionBlur: boolean;
  /** shutter angle in degrees */
  shutterAngle: number;
}

export type AssetKind = 'image' | 'video' | 'audio';
export interface AssetMeta {
  id: string;
  name: string;
  kind: AssetKind;
  mime: string;
  width: number;
  height: number;
  /** seconds (video/audio) */
  duration: number;
  hasAudio: boolean;
}

export interface MotionProject {
  version: 1;
  name: string;
  comps: Record<string, Composition>;
  /** order shown in the Project panel */
  compOrder: string[];
  assets: Record<string, AssetMeta>;
  assetOrder: string[];
  /** user-saved animation presets */
  userPresets: { id: string; name: string; data: string }[];
}
