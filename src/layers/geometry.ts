import type { Layer, TransformableLayer, DocState } from '../types/document';
import { contentBounds } from '../utils/canvas';
import { apply, rectCorners, transformRect, unionRect, type Point, type Rect, type Matrix, invert } from '../utils/math';
import { textLocalBounds } from '../canvas/textRender';
import { geometryLocalBounds, shapePath } from '../canvas/shapeRender';
import { smartContentCanvas } from '../canvas/compositor';

export const isTransformable = (l: Layer | null | undefined): l is TransformableLayer => !!l && (l.type === 'raster' || l.type === 'text' || l.type === 'shape' || l.type === 'smart');

/** Bounds of a layer's content in its own local coordinate space. */
export function localBounds(l: TransformableLayer): Rect | null {
  switch (l.type) {
    case 'raster': return contentBounds(l.canvas);
    case 'text': return textLocalBounds(l);
    case 'shape': return geometryLocalBounds(l.geometry, l.stroke.enabled ? l.stroke.width : 0);
    case 'smart': return { x: 0, y: 0, w: l.contents.width, h: l.contents.height };
  }
}

export function layerQuad(l: TransformableLayer): Point[] | null {
  const b = localBounds(l); if (!b) return null;
  return rectCorners(b).map((p) => apply(l.transform, p));
}

/** Axis-aligned bounds of a layer in document coordinates (groups → union of children). */
export function docBounds(l: Layer): Rect | null {
  if (l.type === 'group') return l.children.reduce<Rect | null>((acc, c) => unionRect(acc, c.visible ? docBounds(c) : null), null);
  if (l.type === 'adjustment') return null;
  const b = localBounds(l); if (!b) return null;
  return transformRect(l.transform, b);
}

/** Pixel-accurate hit test used by the move tool's auto-select. */
export function hitTestLayer(l: Layer, p: Point): boolean {
  if (!l.visible || l.type === 'adjustment') return false;
  if (l.type === 'group') return l.children.some((c) => hitTestLayer(c, p));
  const inv = invert(l.transform); const q = apply(inv, p);
  if (l.type === 'raster' || l.type === 'smart') {
    const canvas = l.type === 'raster' ? l.canvas : smartContentCanvas(l);
    const x = Math.floor(q.x), y = Math.floor(q.y);
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return false;
    try { return canvas.getContext('2d')!.getImageData(x, y, 1, 1).data[3] > 10; } catch { return false; }
  }
  const b = localBounds(l);
  if (!b) return false;
  if (l.type === 'shape') {
    const ctx = hitCtx();
    const path = shapePath(l.geometry);
    if (l.geometry.kind === 'line' || (l.geometry.kind === 'path' && !l.geometry.closed)) {
      ctx.lineWidth = Math.max(8, l.stroke.width + 6);
      return ctx.isPointInStroke(path, q.x, q.y);
    }
    return ctx.isPointInPath(path, q.x, q.y) || (l.stroke.enabled && (ctx.lineWidth = l.stroke.width + 4, ctx.isPointInStroke(path, q.x, q.y)));
  }
  return q.x >= b.x && q.y >= b.y && q.x <= b.x + b.w && q.y <= b.y + b.h;
}
let _hit: CanvasRenderingContext2D | null = null;
function hitCtx() { if (!_hit) _hit = document.createElement('canvas').getContext('2d')!; return _hit; }

/** Applies a document-space delta transform to a layer (and children / linked masks). */
export function applyDeltaTransform(l: Layer, delta: Matrix, mul: (a: Matrix, b: Matrix) => Matrix): Layer {
  const maskMoved = l.mask && l.mask.linked ? { ...l.mask, transform: mul(delta, l.mask.transform) } : l.mask;
  const vmask = l.vectorMask ? { ...l.vectorMask, transform: mul(delta, l.vectorMask.transform) } : l.vectorMask;
  if (l.type === 'group') return { ...l, mask: maskMoved, vectorMask: vmask, children: l.children.map((c) => applyDeltaTransform(c, delta, mul)) };
  if (l.type === 'adjustment') return { ...l, mask: maskMoved, vectorMask: vmask };
  return { ...l, transform: mul(delta, l.transform), mask: maskMoved, vectorMask: vmask } as Layer;
}

export function docRect(s: DocState): Rect { return { x: 0, y: 0, w: s.width, h: s.height }; }
