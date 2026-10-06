import type { DocState, Layer } from '../types/document';

/** Collects every pixel canvas referenced by a document state. */
export function collectCanvases(state: DocState, out = new Set<HTMLCanvasElement>()): Set<HTMLCanvasElement> {
  const walk = (ls: Layer[]) => {
    for (const l of ls) {
      if (l.type === 'raster') out.add(l.canvas);
      if (l.mask) out.add(l.mask.canvas);
      if (l.type === 'group') walk(l.children);
    }
  };
  walk(state.layers);
  if (state.selection) out.add(state.selection.mask);
  return out;
}

/** Approximate bytes newly allocated by `next` compared to `prev` (canvases are shared between states). */
export function newBytes(prev: DocState | null, next: DocState): number {
  const before = prev ? collectCanvases(prev) : new Set<HTMLCanvasElement>();
  let bytes = 0;
  for (const c of collectCanvases(next)) if (!before.has(c)) bytes += c.width * c.height * 4;
  return bytes;
}

export const MAX_HISTORY_STATES = 60;
export const MAX_HISTORY_BYTES = 900 * 1024 * 1024;
