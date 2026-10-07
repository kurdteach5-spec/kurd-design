import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Positions a popup (menu, submenu) next to its anchor with `position: fixed`, so it is never cut off
 * by a scrolling parent (e.g. the menu bar on narrow screens) and always stays inside the window:
 * - "below": under the anchor, moved left if it would leave the right edge.
 * - "side": to the right of the anchor, or to the left when there's no room, or below it on very narrow screens.
 * Taller-than-window popups scroll.
 */
export function Floating({ getAnchor, side, children }: { getAnchor: () => HTMLElement | null | undefined; side: 'below' | 'side'; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      // a parent's ref may not be attached yet on the first pass; fall back to the DOM parent
      const el = ref.current; const a = (getAnchor() ?? el?.parentElement)?.getBoundingClientRect();
      if (!a || !el) return;
      const W = window.innerWidth, H = window.innerHeight;
      const w = el.offsetWidth, h = el.scrollHeight;
      let left: number, top: number;
      if (side === 'below') { left = Math.min(a.left, W - w - 4); top = a.bottom + 2; }
      else if (a.right + w + 2 <= W) { left = a.right + 2; top = a.top - 4; }
      else if (a.left - w - 2 >= 0) { left = a.left - w - 2; top = a.top - 4; }
      else { left = W - w - 4; top = a.bottom + 2; }
      left = Math.max(4, left);
      const maxH = Math.max(120, H - 8);
      top = Math.max(4, Math.min(top, H - Math.min(h, maxH) - 4));
      setPos((p) => (p && p.left === left && p.top === top && p.maxH === maxH ? p : { left, top, maxH }));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [getAnchor, side]);
  return (
    <div ref={ref} className="no-scrollbar" style={{ position: 'fixed', zIndex: 60, left: pos?.left ?? 0, top: pos?.top ?? 0, maxHeight: pos?.maxH, overflowY: 'auto', visibility: pos ? 'visible' : 'hidden' }}>
      {children}
    </div>
  );
}
