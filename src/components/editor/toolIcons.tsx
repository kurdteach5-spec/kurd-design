import type { ReactNode } from 'react';
import {
  LuMove, LuSquareDashed, LuCircleDashed, LuLasso, LuWandSparkles, LuCrop, LuPipette, LuBrush, LuPencil, LuStamp, LuEraser,
  LuPaintBucket, LuDroplet, LuTriangle, LuFingerprint, LuPenTool, LuType, LuMousePointer2, LuSquare, LuCircle, LuHexagon,
  LuSlash, LuHand, LuZoomIn,
} from 'react-icons/lu';
import type { ToolId } from '../../state/toolStore';

type P = { size?: number | string; strokeWidth?: number; className?: string };
const svg = (children: ReactNode) => ({ size = 16, strokeWidth = 1.75, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>{children}</svg>
);

// Custom glyphs where a generic icon would be ambiguous.
const PolyLasso = svg(<><path d="M4 8l7-4 9 5-3 9-9 1z" strokeDasharray="2.5 2.5" /><circle cx="4" cy="8" r="1.4" fill="currentColor" /><circle cx="17" cy="18" r="1.4" fill="currentColor" /></>);
const Gradient = svg(<><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M7 8v8M10 8v8M13 8v8" opacity=".9" /><path d="M16 8v8" opacity=".5" /></>);
const Dodge = svg(<><circle cx="10" cy="9" r="5" /><path d="M13.5 12.5L20 19" /></>);
const QuickSel = svg(<><path d="M5 19l6-6" /><circle cx="15" cy="9" r="5" strokeDasharray="2.5 2.2" /><path d="M13 9h4M15 7v4" /></>);
const RowMarquee = svg(<><path d="M3 12h18" strokeDasharray="2.5 2" /><path d="M3 9v6M21 9v6" /></>);
const ColMarquee = svg(<><path d="M12 3v18" strokeDasharray="2.5 2" /><path d="M9 3h6M9 21h6" /></>);
const Heal = svg(<><rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="10" cy="12" r=".6" fill="currentColor" /><circle cx="14" cy="12" r=".6" fill="currentColor" /></>);
const HistBrush = svg(<><path d="M14 4l6 6-8.5 8.5a3 3 0 0 1-4.2 0l-1.8-1.8a3 3 0 0 1 0-4.2z" /><path d="M3 21c2 0 3-1 3-3" /><path d="M16 2.5a3 3 0 0 1 3 3" /></>);
const Sponge = svg(<><rect x="4" y="6" width="16" height="12" rx="3" /><circle cx="9" cy="10" r="1" /><circle cx="14" cy="13" r="1.2" /><circle cx="15.5" cy="9" r=".7" /></>);
const RotateView = svg(<><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 4v4h-4" /><path d="M9 15l3-6 3 6" /></>);
const Ruler = svg(<><rect x="2.5" y="8" width="19" height="8" rx="1.5" transform="rotate(-30 12 12)" /><path d="M8 13.5l-1-1.7M11 11.8l-1.5-2.6M14 10l-1-1.7M17 8.3l-1.5-2.6" /></>);
const Burn = svg(<><path d="M5 19c4-1 6-3 7-6 1 3 3 5 7 6" /><path d="M12 13c-2-2-2-5 0-8 2 3 2 6 0 8z" /></>);

export const TOOL_ICONS: Record<ToolId, (p: P) => ReactNode> = {
  'move': LuMove, 'marquee-rect': LuSquareDashed, 'marquee-ellipse': LuCircleDashed, 'lasso': LuLasso, 'lasso-polygon': PolyLasso,
  'magic-wand': LuWandSparkles, 'crop': LuCrop, 'eyedropper': LuPipette, 'brush': LuBrush, 'pencil': LuPencil, 'clone-stamp': LuStamp,
  'eraser': LuEraser, 'paint-bucket': LuPaintBucket, 'gradient': Gradient, 'blur': LuDroplet, 'sharpen': LuTriangle, 'smudge': LuFingerprint,
  'dodge': Dodge, 'burn': Burn, 'pen': LuPenTool, 'path-select': LuMousePointer2, 'text': LuType, 'shape-rect': LuSquare,
  'shape-ellipse': LuCircle, 'shape-polygon': LuHexagon, 'shape-line': LuSlash, 'hand': LuHand, 'zoom': LuZoomIn,
  'quick-select': QuickSel, 'marquee-row': RowMarquee, 'marquee-col': ColMarquee, 'spot-heal': Heal, 'history-brush': HistBrush, 'sponge': Sponge, 'rotate-view': RotateView, 'ruler': Ruler,
};
