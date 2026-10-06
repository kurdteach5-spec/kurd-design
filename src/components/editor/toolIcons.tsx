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
const Burn = svg(<><path d="M5 19c4-1 6-3 7-6 1 3 3 5 7 6" /><path d="M12 13c-2-2-2-5 0-8 2 3 2 6 0 8z" /></>);

export const TOOL_ICONS: Record<ToolId, (p: P) => ReactNode> = {
  'move': LuMove, 'marquee-rect': LuSquareDashed, 'marquee-ellipse': LuCircleDashed, 'lasso': LuLasso, 'lasso-polygon': PolyLasso,
  'magic-wand': LuWandSparkles, 'crop': LuCrop, 'eyedropper': LuPipette, 'brush': LuBrush, 'pencil': LuPencil, 'clone-stamp': LuStamp,
  'eraser': LuEraser, 'paint-bucket': LuPaintBucket, 'gradient': Gradient, 'blur': LuDroplet, 'sharpen': LuTriangle, 'smudge': LuFingerprint,
  'dodge': Dodge, 'burn': Burn, 'pen': LuPenTool, 'path-select': LuMousePointer2, 'text': LuType, 'shape-rect': LuSquare,
  'shape-ellipse': LuCircle, 'shape-polygon': LuHexagon, 'shape-line': LuSlash, 'hand': LuHand, 'zoom': LuZoomIn,
};
