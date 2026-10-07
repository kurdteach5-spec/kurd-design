// Motion compositor: renders a composition at a time into a canvas.
// Order per layer: content → masks → effects → transform (parenting, 2D/3D camera) → motion blur → blend.
import type { BlendMode, CameraLayer, Composition, Mask, MLayer, MotionProject, Vec3 } from '../types';
import { valueAt } from '../anim';
import { applyEffects, effectsPad, glfx, type EvaluatedEffect } from './glfx';
import { effectDef } from './effectDefs';
import { drawShape, drawText, evalShape, evalText, layoutText, pathToPath2D, shapeBounds } from './draw';
import { I4, RX, RY, RZ, S, T, apply4, invert4, mul, scaleOf, affine, type M4 } from './mat4';
import { imageFor, videoFor, videoFrameSeq } from '../media/assets';
import { createCanvas, ctx2d } from '../../utils/canvas';
import { cameraDistance } from '../factory';

export interface RenderOptions {
  /** output pixels per comp pixel */
  quality: number;
  transparent?: boolean;
  /** motion blur samples (0 = off) */
  mbSamples?: number;
  /** key identifying the video element set (preview vs export) */
  videoKey?: string;
  depth?: number;
}

const GCO: Partial<Record<BlendMode, GlobalCompositeOperation>> = { normal: 'source-over', add: 'lighter' };
const gco = (b: BlendMode): GlobalCompositeOperation => GCO[b] ?? (b as GlobalCompositeOperation);

export const isVisual = (l: MLayer) => l.type !== 'audio' && l.type !== 'null' && l.type !== 'camera';
export const activeAt = (l: MLayer, t: number) => t >= l.inPoint - 1e-9 && t < l.outPoint - 1e-9;
export const sourceTime = (l: MLayer, t: number) => (t - l.start) * l.speed;

// ---------- transforms ----------
export function localMatrix(l: MLayer, t: number): M4 {
  const tr = l.transform;
  const a = valueAt(tr.anchor, t), p = valueAt(tr.position, t), s = valueAt(tr.scale, t);
  const rz = (valueAt(tr.rotation, t) * Math.PI) / 180;
  if (!l.threeD) return mul(mul(mul(T(p[0], p[1], 0), RZ(rz)), S(s[0] / 100, s[1] / 100, 1)), T(-a[0], -a[1], 0));
  const rx = (valueAt(tr.rotationX, t) * Math.PI) / 180, ry = (valueAt(tr.rotationY, t) * Math.PI) / 180;
  return mul(mul(mul(mul(mul(T(p[0], p[1], p[2]), RZ(rz)), RY(ry)), RX(rx)), S(s[0] / 100, s[1] / 100, s[2] / 100)), T(-a[0], -a[1], -a[2]));
}

/** Layer → composition matrix including parents. */
export function worldMatrix(comp: Composition, l: MLayer, t: number, seen = new Set<string>()): M4 {
  let m = localMatrix(l, t);
  if (l.parentId && !seen.has(l.id)) {
    seen.add(l.id);
    const parent = comp.layers.find((x) => x.id === l.parentId);
    if (parent) m = mul(worldMatrix(comp, parent, t, seen), m);
  }
  return m;
}

export interface CameraState {
  view2d: M4 | null;
  /** 3D: view matrix and focal length in comp px */
  view3d: M4;
  focal: number;
  explicit3d: boolean;
}
export function cameraAt(comp: Composition, t: number): CameraState {
  let cam2: CameraLayer | null = null, cam3: CameraLayer | null = null;
  for (const l of comp.layers) {
    if (l.type !== 'camera' || !l.visible || !activeAt(l, t)) continue;
    if (l.mode === '2d') cam2 ??= l; else cam3 ??= l;
  }
  let view2d: M4 | null = null;
  if (cam2) {
    const p = valueAt(cam2.transform.position, t); const z = Math.max(1, valueAt(cam2.zoom, t)) / 100;
    const r = (valueAt(cam2.transform.rotation, t) * Math.PI) / 180;
    view2d = mul(mul(mul(T(comp.width / 2, comp.height / 2), RZ(-r)), S(z, z)), T(-p[0], -p[1]));
  }
  if (cam3) {
    // camera orientation from its rotations, no scale; parented cameras follow their parent
    const p = valueAt(cam3.transform.position, t);
    const rz = (valueAt(cam3.transform.rotation, t) * Math.PI) / 180, rx = (valueAt(cam3.transform.rotationX, t) * Math.PI) / 180, ry = (valueAt(cam3.transform.rotationY, t) * Math.PI) / 180;
    let world = mul(mul(mul(T(p[0], p[1], p[2]), RZ(rz)), RY(ry)), RX(rx));
    if (cam3.parentId) { const par = comp.layers.find((x) => x.id === cam3!.parentId); if (par) world = mul(worldMatrix(comp, par, t), world); }
    return { view2d, view3d: invert4(world), focal: cameraDistance(comp, Math.max(1, valueAt(cam3.zoom, t))), explicit3d: true };
  }
  const f = cameraDistance(comp, 50);
  return { view2d, view3d: invert4(T(comp.width / 2, comp.height / 2, -f)), focal: f, explicit3d: false };
}

/** Projects a layer-local point of a 3D layer to comp px; w = depth (≤ 0 means behind the camera). */
export function project3d(comp: Composition, cam: CameraState, world: M4, x: number, y: number): { x: number; y: number; w: number } {
  const [wx, wy, wz] = apply4(world, x, y, 0);
  const [vx, vy, vz] = apply4(cam.view3d, wx, wy, wz);
  if (vz <= 1) return { x: NaN, y: NaN, w: vz };
  return { x: comp.width / 2 + (vx * cam.focal) / vz, y: comp.height / 2 + (vy * cam.focal) / vz, w: vz };
}

// ---------- content ----------
/** Layer-space bounds of the layer's content (before effects). */
export function contentBounds(project: MotionProject, l: MLayer, t: number): { x: number; y: number; w: number; h: number } | null {
  switch (l.type) {
    case 'solid': return { x: 0, y: 0, w: l.width, h: l.height };
    case 'image': case 'video': { const a = project.assets[l.assetId]; return a ? { x: 0, y: 0, w: a.width, h: a.height } : null; }
    case 'precomp': { const c = project.comps[l.compId]; return c ? { x: 0, y: 0, w: c.width, h: c.height } : null; }
    case 'adjustment': return null;
    case 'text': return layoutText(evalText(l.text, t)).bounds;
    case 'shape': return shapeBounds(evalShape(l.shape, t));
    case 'null': return { x: -50, y: -50, w: 100, h: 100 };
    default: return null;
  }
}

/** Draws the layer content in layer space into x (caller sets the transform). */
function drawContent(project: MotionProject, l: MLayer, t: number, x: CanvasRenderingContext2D, k: number, opts: RenderOptions) {
  switch (l.type) {
    case 'solid': x.fillStyle = valueAt(l.color, t); x.fillRect(0, 0, l.width, l.height); break;
    case 'image': { const img = imageFor(l.assetId); if (img) { x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0); } break; }
    case 'video': {
      const v = videoFor(l.assetId, `${opts.videoKey ?? 'p'}:${l.id}`);
      const a = project.assets[l.assetId];
      if (v && v.readyState >= 2 && a) x.drawImage(v, 0, 0, a.width, a.height);
      break;
    }
    case 'text': drawText(x, evalText(l.text, t)); break;
    case 'shape': drawShape(x, evalShape(l.shape, t)); break;
    case 'precomp': {
      const sub = project.comps[l.compId]; if (!sub || (opts.depth ?? 0) > 6) break;
      const q = Math.max(0.05, Math.min(2, k));
      const c = renderComp(project, sub, sourceTime(l, t), { ...opts, quality: q, transparent: true, depth: (opts.depth ?? 0) + 1, videoKey: `${opts.videoKey ?? 'p'}:${l.id}` });
      x.drawImage(c, 0, 0, sub.width, sub.height);
      break;
    }
  }
}

// ---------- masks ----------
function evalMasks(masks: Mask[], t: number) {
  return masks.filter((m) => m.mode !== 'none').map((m) => ({ mode: m.mode, inverted: m.inverted, path: valueAt(m.path, t), feather: valueAt(m.feather, t), opacity: valueAt(m.opacity, t) / 100, expansion: valueAt(m.expansion, t) }));
}
type EvMask = ReturnType<typeof evalMasks>[number];

/** Coverage canvas (alpha) for masks, in the source canvas space. */
function maskCanvas(masks: EvMask[], w: number, h: number, k: number, ox: number, oy: number): HTMLCanvasElement {
  const out = createCanvas(w, h); const x = ctx2d(out);
  if (masks[0].mode !== 'add') { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); }
  for (const m of masks) {
    const one = createCanvas(w, h); const y = ctx2d(one);
    y.setTransform(k, 0, 0, k, -ox * k, -oy * k);
    const p = pathToPath2D(m.path);
    if (m.feather > 0.01) y.filter = `blur(${(m.feather * k) / 2}px)`;
    y.fillStyle = '#fff';
    if (m.path.closed) y.fill(p);
    if (m.expansion > 0) { y.lineWidth = m.expansion * 2; y.lineJoin = 'round'; y.strokeStyle = '#fff'; y.stroke(p); }
    else if (m.expansion < 0) { y.globalCompositeOperation = 'destination-out'; y.lineWidth = -m.expansion * 2; y.lineJoin = 'round'; y.strokeStyle = '#fff'; y.stroke(p); }
    y.filter = 'none';
    if (m.inverted) { y.setTransform(1, 0, 0, 1, 0, 0); y.globalCompositeOperation = 'xor'; y.fillStyle = '#fff'; y.fillRect(0, 0, w, h); }
    x.globalAlpha = m.opacity;
    x.globalCompositeOperation = m.mode === 'add' ? 'source-over' : m.mode === 'subtract' ? 'destination-out' : 'destination-in';
    x.drawImage(one, 0, 0);
  }
  return out;
}

// ---------- layer raster cache ----------
interface Raster { canvas: HTMLCanvasElement; ox: number; oy: number; k: number }
const cache = new Map<string, { key: string; r: Raster }>();
function cacheGet(id: string, key: string) { const e = cache.get(id); if (e && e.key === key) { cache.delete(id); cache.set(id, e); return e.r; } return null; }
function cachePut(id: string, key: string, r: Raster) { cache.set(id, { key, r }); while (cache.size > 120) cache.delete(cache.keys().next().value as string); }
export function clearRenderCache() { cache.clear(); }

function evalEffects(l: MLayer, t: number): EvaluatedEffect[] {
  if (!l.effectsOn) return [];
  return l.effects.filter((e) => e.enabled).map((e) => {
    const params: EvaluatedEffect['params'] = {};
    for (const [k, p] of Object.entries(e.params)) params[k] = valueAt(p, t);
    return { type: e.type, params };
  });
}

/** Layer content with masks & effects as a raster (layer space, scale k). */
function layerRaster(project: MotionProject, comp: Composition, l: MLayer, t: number, k: number, opts: RenderOptions, world: M4): Raster | null {
  const b = contentBounds(project, l, t); if (!b || b.w <= 0 || b.h <= 0) return null;
  const masks = evalMasks(l.masks, t);
  const effects = evalEffects(l, t);
  const pad = effectsPad(effects);
  const ox = b.x - pad, oy = b.y - pad;
  let w = Math.ceil((b.w + pad * 2) * k), h = Math.ceil((b.h + pad * 2) * k);
  // keep huge layers within GPU limits
  const lim = 8192; if (w > lim || h > lim) { const f = lim / Math.max(w, h); k *= f; w = Math.ceil(w * f); h = Math.ceil(h * f); }
  w = Math.max(1, w); h = Math.max(1, h);
  const timeDep = l.type === 'video' || l.type === 'precomp' || effects.some((e) => effectDef(e.type)?.timeDependent?.(e.params)) || effects.some((e) => e.type === 'motion-blur');
  let contentKey: string;
  switch (l.type) {
    case 'text': contentKey = JSON.stringify(evalText(l.text, t)); break;
    case 'shape': contentKey = JSON.stringify(evalShape(l.shape, t)); break;
    case 'solid': contentKey = `${valueAt(l.color, t)}|${l.width}|${l.height}`; break;
    case 'image': contentKey = l.assetId + (imageFor(l.assetId) ? '' : '|loading'); break;
    case 'video': case 'precomp': contentKey = `v${videoFrameSeq}`; break;
    default: contentKey = '';
  }
  const key = `${contentKey}|${JSON.stringify(masks)}|${JSON.stringify(effects)}|${k.toFixed(3)}|${timeDep ? t : ''}|${opts.videoKey}`;
  const hit = cacheGet(l.id + (opts.videoKey ?? ''), key); if (hit) return hit;
  let canvas = createCanvas(w, h); const x = ctx2d(canvas);
  x.setTransform(k, 0, 0, k, -ox * k, -oy * k);
  drawContent(project, l, t, x, k, opts);
  x.setTransform(1, 0, 0, 1, 0, 0);
  if (masks.length) {
    const m = maskCanvas(masks, w, h, k, ox, oy);
    x.globalCompositeOperation = 'destination-in'; x.drawImage(m, 0, 0); x.globalCompositeOperation = 'source-over';
  }
  if (effects.length) {
    // velocity of the layer (comp px/s) mapped into source px for the Motion Blur effect
    let vel: [number, number] = [0, 0];
    if (effects.some((e) => e.type === 'motion-blur')) {
      const dt = 1 / comp.fps;
      const a = apply4(world, 0, 0), bb = apply4(worldMatrix(comp, l, t - dt), 0, 0);
      const vx = (a[0] - bb[0]) / dt, vy = (a[1] - bb[1]) / dt;
      const [m0, m1, m4, m5] = [world[0], world[1], world[4], world[5]]; const det = m0 * m5 - m1 * m4 || 1;
      vel = [((m5 * vx - m4 * vy) / det) * k, ((-m1 * vx + m0 * vy) / det) * k];
    }
    canvas = applyEffects(canvas, effects, { time: t, fps: comp.fps, scale: k, velocity: vel, seed: hashId(l.id) });
  }
  const r = { canvas, ox, oy, k };
  cachePut(l.id + (opts.videoKey ?? ''), key, r);
  return r;
}
const hashId = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (Math.abs(h) % 1000) / 10; };

// ---------- compositing ----------
const DIRECT_TYPES = new Set(['solid', 'image', 'video', 'text', 'shape']);

/** Renders `comp` at time t into a canvas of comp size × quality. */
export function renderComp(project: MotionProject, comp: Composition, t: number, opts: RenderOptions, target?: HTMLCanvasElement): HTMLCanvasElement {
  const q = opts.quality;
  const W = Math.max(1, Math.round(comp.width * q)), H = Math.max(1, Math.round(comp.height * q));
  const out = target ?? createCanvas(W, H);
  if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
  const x = ctx2d(out);
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
  x.clearRect(0, 0, W, H);
  if (!opts.transparent) { x.fillStyle = comp.background; x.fillRect(0, 0, W, H); }
  const anySolo = comp.layers.some((l) => l.solo && isVisual(l));
  const cam = cameraAt(comp, t);
  const base = S(q, q, 1);
  for (let i = comp.layers.length - 1; i >= 0; i--) {
    const l = comp.layers[i];
    if (!l.visible || !activeAt(l, t) || !isVisual(l)) continue;
    if (anySolo && !l.solo) continue;
    try {
      if (l.type === 'adjustment') { renderAdjustment(project, comp, l, t, x, W, H, q, cam); continue; }
      drawLayer(project, comp, l, t, x, base, cam, opts);
    } catch (e) { console.warn('Layer render failed', l.name, e); }
  }
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
  return out;
}

function drawLayer(project: MotionProject, comp: Composition, l: MLayer, t: number, x: CanvasRenderingContext2D, base: M4, cam: CameraState, opts: RenderOptions) {
  const opacity = Math.max(0, Math.min(1, valueAt(l.transform.opacity, t) / 100));
  if (opacity <= 0) return;
  const q = opts.quality;
  const world = worldMatrix(comp, l, t);
  const three = l.threeD;
  const view = three ? null : cam.view2d;
  const screenOf = (m: M4) => (view ? mul(mul(base, view), m) : mul(base, m));
  const kOf = (m: M4) => Math.max(0.05, Math.min(4, scaleOf(screenOf(m))));
  const hasFx = (l.effectsOn && l.effects.some((e) => e.enabled)) || l.masks.some((m) => m.mode !== 'none');
  const samples = opts.mbSamples && comp.motionBlur && l.motionBlur ? opts.mbSamples : 0;
  const times: number[] = [];
  if (samples > 1) {
    const dt = comp.shutterAngle / 360 / comp.fps;
    for (let i = 0; i < samples; i++) times.push(t - dt / 2 + (dt * i) / (samples - 1));
    const a = worldMatrix(comp, l, times[0]), b = worldMatrix(comp, l, times[times.length - 1]);
    if (a.every((v, i) => Math.abs(v - b[i]) < 1e-6)) times.length = 0;
  }
  const target = times.length ? accumCanvas(x.canvas.width, x.canvas.height) : x;
  const alpha = times.length ? opacity / times.length : opacity;
  target.globalCompositeOperation = times.length ? 'lighter' : gco(l.blend);
  const mats = times.length ? times.map((tt) => worldMatrix(comp, l, tt)) : [world];

  if (!three && !hasFx && DIRECT_TYPES.has(l.type)) {
    // vector/image content drawn straight through the transform (crisp at any zoom)
    const k = kOf(world);
    for (const m of mats) {
      target.save(); target.globalAlpha = alpha;
      const [a, b, c, d, e, f] = affine(screenOf(m)); target.setTransform(a, b, c, d, e, f);
      drawContent(project, l, t, target, k, opts);
      target.restore();
    }
  } else if (!three) {
    const r = layerRaster(project, comp, l, t, kOf(world), opts, world);
    if (!r) return;
    for (const m of mats) {
      const [a, b, c, d, e, f] = affine(mul(mul(screenOf(m), T(r.ox, r.oy)), S(1 / r.k, 1 / r.k)));
      target.save(); target.globalAlpha = alpha; target.setTransform(a, b, c, d, e, f);
      target.imageSmoothingQuality = 'high'; target.drawImage(r.canvas, 0, 0); target.restore();
    }
  } else {
    // 3D: perspective-correct quad on the GPU
    const fx = glfx();
    const r = layerRaster(project, comp, l, t, Math.max(0.1, Math.min(2, q * 1.5)), opts, world);
    if (!r) return;
    const w = r.canvas.width / r.k, h = r.canvas.height / r.k;
    for (const m of mats) {
      const pts = [[r.ox, r.oy], [r.ox + w, r.oy], [r.ox, r.oy + h], [r.ox + w, r.oy + h]].map(([px, py]) => project3d(comp, cam, m, px, py));
      if (pts.some((p) => !(p.w > 1))) continue;
      const W = target.canvas.width, H = target.canvas.height;
      if (fx) {
        const img = fx.perspective(r.canvas, r.canvas.width, r.canvas.height, pts.map((p) => ({ x: p.x * q, y: p.y * q, w: p.w })), W, H, 1);
        target.save(); target.setTransform(1, 0, 0, 1, 0, 0); target.globalAlpha = alpha; target.drawImage(img, 0, 0); target.restore();
      } else {
        // no WebGL: affine approximation from three corners
        const [p0, p1, p2] = pts;
        target.save(); target.globalAlpha = alpha;
        target.setTransform((p1.x - p0.x) * q / r.canvas.width, (p1.y - p0.y) * q / r.canvas.width, (p2.x - p0.x) * q / r.canvas.height, (p2.y - p0.y) * q / r.canvas.height, p0.x * q, p0.y * q);
        target.drawImage(r.canvas, 0, 0); target.restore();
      }
    }
  }
  if (times.length) {
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = gco(l.blend);
    x.drawImage(target.canvas, 0, 0); x.restore();
  }
  target.globalCompositeOperation = 'source-over';
}

let accum: HTMLCanvasElement | null = null;
function accumCanvas(w: number, h: number): CanvasRenderingContext2D {
  if (!accum) accum = createCanvas(w, h);
  if (accum.width !== w || accum.height !== h) { accum.width = w; accum.height = h; }
  const x = ctx2d(accum); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, w, h);
  return x;
}

/** Adjustment layer: applies its effects to everything below, within the layer's area and masks. */
function renderAdjustment(project: MotionProject, comp: Composition, l: MLayer, t: number, x: CanvasRenderingContext2D, W: number, H: number, q: number, cam: CameraState) {
  const effects = evalEffects(l, t);
  const opacity = valueAt(l.transform.opacity, t) / 100;
  if (!effects.length || opacity <= 0) return;
  const snapshot = createCanvas(W, H); ctx2d(snapshot).drawImage(x.canvas, 0, 0);
  const processed = applyEffects(snapshot, effects, { time: t, fps: comp.fps, scale: q, velocity: [0, 0], seed: hashId(l.id) });
  // coverage: the layer rectangle (comp-sized solid) with its masks, through its transform
  const cov = createCanvas(W, H); const c = ctx2d(cov);
  const world = worldMatrix(comp, l, t);
  const m = cam.view2d ? mul(mul(S(q, q), cam.view2d), world) : mul(S(q, q), world);
  const [a, b, cc, d, e, f] = affine(m);
  const masks = evalMasks(l.masks, t);
  if (masks.length) {
    const k = 1; const mc = maskCanvas(masks, comp.width, comp.height, k, 0, 0);
    c.setTransform(a, b, cc, d, e, f); c.drawImage(mc, 0, 0);
  } else { c.setTransform(a, b, cc, d, e, f); c.fillStyle = '#fff'; c.fillRect(0, 0, comp.width, comp.height); }
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-in'; c.drawImage(processed, 0, 0);
  x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
  // replace (not cover) the pixels under the adjustment: punch out, then add the processed pixels
  const hole = createCanvas(W, H); const hx = ctx2d(hole);
  hx.setTransform(a, b, cc, d, e, f);
  if (masks.length) hx.drawImage(maskCanvas(masks, comp.width, comp.height, 1, 0, 0), 0, 0); else { hx.fillStyle = '#fff'; hx.fillRect(0, 0, comp.width, comp.height); }
  x.globalAlpha = opacity; x.globalCompositeOperation = 'destination-out'; x.drawImage(hole, 0, 0);
  x.globalCompositeOperation = 'lighter'; x.drawImage(cov, 0, 0);
  x.restore();
}

/** World-space corners of a layer's content box (for viewer overlays). */
export function layerCorners(project: MotionProject, comp: Composition, l: MLayer, t: number): { x: number; y: number }[] | null {
  const b = contentBounds(project, l, t); if (!b) return null;
  const world = worldMatrix(comp, l, t);
  const cam = cameraAt(comp, t);
  const pts: [number, number][] = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
  if (l.threeD) {
    const pp = pts.map(([px, py]) => project3d(comp, cam, world, px, py));
    return pp.some((p) => !(p.w > 1)) ? null : pp.map((p) => ({ x: p.x, y: p.y }));
  }
  const m = cam.view2d ? mul(cam.view2d, world) : world;
  return pts.map(([px, py]) => { const r = apply4(m, px, py); return { x: r[0], y: r[1] }; });
}

/** comp-space point of a layer-local point (2D layers incl. 2D camera). */
export function layerToComp(comp: Composition, l: MLayer, t: number, px: number, py: number): { x: number; y: number } {
  const world = worldMatrix(comp, l, t);
  const cam = cameraAt(comp, t);
  if (l.threeD) { const p = project3d(comp, cam, world, px, py); return { x: p.x, y: p.y }; }
  const m = cam.view2d ? mul(cam.view2d, world) : world;
  const r = apply4(m, px, py); return { x: r[0], y: r[1] };
}
export function compToLayer(comp: Composition, l: MLayer, t: number, cx: number, cy: number): { x: number; y: number } {
  const world = worldMatrix(comp, l, t);
  const cam = cameraAt(comp, t);
  const m = cam.view2d && !l.threeD ? mul(cam.view2d, world) : world;
  const r = apply4(invert4(m), cx, cy); return { x: r[0], y: r[1] };
}
/** parent-space (position) delta for a comp-space delta (used when dragging layers). */
export function compDeltaToParent(comp: Composition, l: MLayer, t: number, dx: number, dy: number): [number, number] {
  let m = I4();
  if (l.parentId) { const p = comp.layers.find((x) => x.id === l.parentId); if (p) m = worldMatrix(comp, p, t); }
  const cam = cameraAt(comp, t);
  if (cam.view2d && !l.threeD) m = mul(cam.view2d, m);
  const inv = invert4(m);
  const a = apply4(inv, 0, 0), b = apply4(inv, dx, dy);
  return [b[0] - a[0], b[1] - a[1]];
}
export type { Vec3 };
