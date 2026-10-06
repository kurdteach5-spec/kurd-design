import type { LayerEffects, LayerMask, VectorMask } from '../types/document';
import { blurCanvas, createCanvas, ctx2d } from '../utils/canvas';
import { rgba } from '../utils/color';
import { deg2rad } from '../utils/math';
import { shapePath } from './shapeRender';

export const hasEffects = (e: LayerEffects) => e.dropShadow.enabled || e.outerGlow.enabled || e.stroke.enabled;

/** Solid-color silhouette of a canvas' alpha. */
function silhouette(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const c = createCanvas(src.width, src.height); const x = ctx2d(c);
  x.drawImage(src, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  return c;
}

/** Morphological dilation approximated by stamping the silhouette around a circle. */
export function dilate(src: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const c = createCanvas(src.width, src.height); const x = ctx2d(c);
  x.drawImage(src, 0, 0);
  if (radius <= 0) return c;
  const rings = Math.max(1, Math.ceil(radius / 3));
  for (let ring = 1; ring <= rings; ring++) {
    const r = (radius * ring) / rings;
    const steps = Math.max(8, Math.ceil(r * 2.2));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      x.drawImage(src, Math.cos(a) * r, Math.sin(a) * r);
    }
  }
  return c;
}

/**
 * Composes layer effects around the layer content. `content` is the layer rendered at
 * full opacity; fill opacity only affects the content, not the effects.
 */
export function renderWithEffects(content: HTMLCanvasElement, fx: LayerEffects, fillOpacity: number): HTMLCanvasElement {
  const out = createCanvas(content.width, content.height); const x = ctx2d(out);
  const W = content.width;
  if (fx.dropShadow.enabled) {
    const s = fx.dropShadow;
    let src = silhouette(content, '#000');
    if (s.spread > 0) src = dilate(src, (s.spread / 100) * s.blur + s.spread * 0.1);
    const a = deg2rad(s.angle);
    const dx = -Math.cos(a) * s.distance, dy = Math.sin(a) * s.distance;
    x.save();
    x.shadowColor = rgba(s.color, s.opacity); x.shadowBlur = s.blur;
    x.shadowOffsetX = dx + W * 2; x.shadowOffsetY = dy;
    x.drawImage(src, -W * 2, 0);
    x.restore();
  }
  if (fx.outerGlow.enabled) {
    const g = fx.outerGlow;
    let src = silhouette(content, g.color);
    if (g.spread > 0) src = dilate(src, (g.spread / 100) * g.blur);
    const blurred = blurCanvas(src, g.blur);
    x.save(); x.globalAlpha = g.opacity;
    x.drawImage(blurred, 0, 0);
    x.restore();
  }
  if (fx.stroke.enabled && fx.stroke.width > 0) {
    const s = fx.stroke;
    const sil = silhouette(content, s.color);
    const d = dilate(sil, s.width);
    x.save(); x.globalAlpha = s.opacity; x.drawImage(d, 0, 0); x.restore();
  }
  x.save(); x.globalAlpha = fillOpacity; x.drawImage(content, 0, 0); x.restore();
  return out;
}

const maskCache = new WeakMap<LayerMask, { w: number; h: number; c: HTMLCanvasElement }>();
/** Doc-sized canvas whose alpha channel holds the mask (white = opaque). */
export function maskAlpha(mask: LayerMask, w: number, h: number): HTMLCanvasElement {
  const hit = maskCache.get(mask);
  if (hit && hit.w === w && hit.h === h) return hit.c;
  let c = createCanvas(w, h); let x = ctx2d(c, true);
  const bg = mask.background;
  x.fillStyle = `rgb(${bg},${bg},${bg})`; x.fillRect(0, 0, w, h);
  const t = mask.transform;
  x.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
  x.imageSmoothingEnabled = true;
  x.drawImage(mask.canvas, 0, 0);
  x.setTransform(1, 0, 0, 1, 0, 0);
  if (mask.feather > 0) { c = blurCanvas(c, mask.feather); x = ctx2d(c, true); }
  const img = x.getImageData(0, 0, w, h); const d = img.data;
  const dens = mask.density;
  for (let i = 0; i < d.length; i += 4) {
    const g = d[i];
    d[i + 3] = 255 - dens * (255 - g);
    d[i] = d[i + 1] = d[i + 2] = 0;
  }
  x.putImageData(img, 0, 0);
  maskCache.set(mask, { w, h, c });
  return c;
}

const vmaskCache = new WeakMap<VectorMask, { w: number; h: number; c: HTMLCanvasElement }>();
export function vectorMaskAlpha(vm: VectorMask, w: number, h: number): HTMLCanvasElement {
  const hit = vmaskCache.get(vm);
  if (hit && hit.w === w && hit.h === h) return hit.c;
  let c = createCanvas(w, h); const x = ctx2d(c);
  const t = vm.transform;
  if (vm.invert) { x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.globalCompositeOperation = 'destination-out'; }
  x.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
  x.fillStyle = '#000';
  x.fill(shapePath(vm.geometry));
  x.setTransform(1, 0, 0, 1, 0, 0);
  if (vm.feather > 0) c = blurCanvas(c, vm.feather);
  vmaskCache.set(vm, { w, h, c });
  return c;
}

/** Visualizes a layer mask as a grayscale doc-sized canvas (for "show mask"). */
export function maskPreview(mask: LayerMask, w: number, h: number): HTMLCanvasElement {
  const c = createCanvas(w, h); const x = ctx2d(c);
  x.fillStyle = `rgb(${mask.background},${mask.background},${mask.background})`; x.fillRect(0, 0, w, h);
  const t = mask.transform; x.setTransform(t.a, t.b, t.c, t.d, t.e, t.f); x.drawImage(mask.canvas, 0, 0);
  return c;
}
