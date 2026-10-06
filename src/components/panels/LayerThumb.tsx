import { memo, useEffect, useRef } from 'react';
import type { Layer, LayerMask } from '../../types/document';
import { drawLayerContent } from '../../canvas/compositor';
import { ctx2d } from '../../utils/canvas';

function schedule(fn: () => void) {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: unknown) => number }).requestIdleCallback;
  if (ric) { const id = ric(fn, { timeout: 300 }); return () => (window as unknown as { cancelIdleCallback: (n: number) => void }).cancelIdleCallback(id); }
  const t = setTimeout(fn, 60); return () => clearTimeout(t);
}

/** Small preview of a layer's content in document space. */
export const LayerThumb = memo(function LayerThumb({ layer, docW, docH, size = 32 }: { layer: Layer; docW: number; docH: number; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const k = Math.min(size / docW, size / docH);
  const w = Math.max(1, Math.round(docW * k)), h = Math.max(1, Math.round(docH * k));
  useEffect(() => schedule(() => {
    const c = ref.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const x = ctx2d(c); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height);
    x.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
    try {
      const draw = (l: Layer) => { if (!l.visible) return; if (l.type === 'group') l.children.forEach(draw); else drawLayerContent(x, l, l.opacity); };
      draw({ ...layer, visible: true } as Layer);
    } catch { /* ignore thumbnail failures */ }
  }), [layer, k, w, h]);
  return <canvas ref={ref} className="checker block" style={{ width: w, height: h }} aria-hidden />;
});

export const MaskThumb = memo(function MaskThumb({ mask, docW, docH, size = 32 }: { mask: LayerMask; docW: number; docH: number; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const k = Math.min(size / docW, size / docH);
  const w = Math.max(1, Math.round(docW * k)), h = Math.max(1, Math.round(docH * k));
  useEffect(() => schedule(() => {
    const c = ref.current; if (!c) return;
    c.width = w * 2; c.height = h * 2;
    const x = ctx2d(c);
    x.fillStyle = `rgb(${mask.background},${mask.background},${mask.background})`; x.fillRect(0, 0, c.width, c.height);
    const t = mask.transform; const s = k * 2;
    x.setTransform(t.a * s, t.b * s, t.c * s, t.d * s, t.e * s, t.f * s); x.drawImage(mask.canvas, 0, 0);
  }), [mask, k, w, h]);
  return <canvas ref={ref} className="block" style={{ width: w, height: h, opacity: mask.enabled ? 1 : 0.4 }} aria-hidden />;
});
