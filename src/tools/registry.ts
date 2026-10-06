import type { Tool } from './types';
import type { ToolId } from '../state/toolStore';
import { registerToolResolver } from '../canvas/engine';
import { moveTool } from './moveTool';
import { marqueeRectTool, marqueeEllipseTool, lassoTool, polygonLassoTool, magicWandTool } from './selectionTools';
import { brushTool_, pencilTool, eraserTool, cloneStampTool, blurTool, sharpenTool, smudgeTool, dodgeTool, burnTool, eyedropperTool, paintBucketTool, gradientTool } from './paintTools';
import { handTool, zoomTool, cropTool } from './navTools';
import { textTool } from './textTool';
import { rectShapeTool, ellipseShapeTool, polygonShapeTool, lineShapeTool, penTool, pathSelectTool } from './vectorTools';

export const TOOLS: Record<ToolId, Tool> = {
  'move': moveTool,
  'marquee-rect': marqueeRectTool,
  'marquee-ellipse': marqueeEllipseTool,
  'lasso': lassoTool,
  'lasso-polygon': polygonLassoTool,
  'magic-wand': magicWandTool,
  'crop': cropTool,
  'eyedropper': eyedropperTool,
  'brush': brushTool_,
  'pencil': pencilTool,
  'clone-stamp': cloneStampTool,
  'eraser': eraserTool,
  'paint-bucket': paintBucketTool,
  'gradient': gradientTool,
  'blur': blurTool,
  'sharpen': sharpenTool,
  'smudge': smudgeTool,
  'dodge': dodgeTool,
  'burn': burnTool,
  'pen': penTool,
  'path-select': pathSelectTool,
  'text': textTool,
  'shape-rect': rectShapeTool,
  'shape-ellipse': ellipseShapeTool,
  'shape-polygon': polygonShapeTool,
  'shape-line': lineShapeTool,
  'hand': handTool,
  'zoom': zoomTool,
};

registerToolResolver((id) => TOOLS[id as ToolId] ?? moveTool);

export interface ToolMeta { id: ToolId; label: string; key?: string }
export interface ToolGroup { id: string; key?: string; tools: ToolMeta[] }

/** Toolbox layout: grouped like a desktop editor; the group key cycles with Shift. */
export const TOOL_GROUPS: ToolGroup[] = [
  { id: 'move', key: 'V', tools: [{ id: 'move', label: 'Move Tool' }] },
  { id: 'marquee', key: 'M', tools: [{ id: 'marquee-rect', label: 'Rectangular Marquee' }, { id: 'marquee-ellipse', label: 'Elliptical Marquee' }] },
  { id: 'lasso', key: 'L', tools: [{ id: 'lasso', label: 'Lasso Tool' }, { id: 'lasso-polygon', label: 'Polygonal Lasso' }] },
  { id: 'wand', key: 'W', tools: [{ id: 'magic-wand', label: 'Magic Wand' }] },
  { id: 'crop', key: 'C', tools: [{ id: 'crop', label: 'Crop Tool' }] },
  { id: 'eyedropper', key: 'I', tools: [{ id: 'eyedropper', label: 'Eyedropper' }] },
  { id: 'brush', key: 'B', tools: [{ id: 'brush', label: 'Brush Tool' }, { id: 'pencil', label: 'Pencil Tool' }] },
  { id: 'clone', key: 'S', tools: [{ id: 'clone-stamp', label: 'Clone Stamp' }] },
  { id: 'eraser', key: 'E', tools: [{ id: 'eraser', label: 'Eraser Tool' }] },
  { id: 'fill', key: 'G', tools: [{ id: 'gradient', label: 'Gradient Tool' }, { id: 'paint-bucket', label: 'Paint Bucket' }] },
  { id: 'retouch', key: 'R', tools: [{ id: 'blur', label: 'Blur Tool' }, { id: 'sharpen', label: 'Sharpen Tool' }, { id: 'smudge', label: 'Smudge Tool' }] },
  { id: 'tone', key: 'O', tools: [{ id: 'dodge', label: 'Dodge Tool' }, { id: 'burn', label: 'Burn Tool' }] },
  { id: 'pen', key: 'P', tools: [{ id: 'pen', label: 'Pen Tool' }] },
  { id: 'text', key: 'T', tools: [{ id: 'text', label: 'Text Tool' }] },
  { id: 'path', key: 'A', tools: [{ id: 'path-select', label: 'Path Selection' }] },
  { id: 'shape', key: 'U', tools: [{ id: 'shape-rect', label: 'Rectangle Tool' }, { id: 'shape-ellipse', label: 'Ellipse Tool' }, { id: 'shape-polygon', label: 'Polygon Tool' }, { id: 'shape-line', label: 'Line Tool' }] },
  { id: 'hand', key: 'H', tools: [{ id: 'hand', label: 'Hand Tool' }] },
  { id: 'zoom', key: 'Z', tools: [{ id: 'zoom', label: 'Zoom Tool' }] },
];

export function toolLabel(id: ToolId) {
  for (const g of TOOL_GROUPS) { const t = g.tools.find((x) => x.id === id); if (t) return t.label; }
  return id;
}
export function groupOf(id: ToolId) { return TOOL_GROUPS.find((g) => g.tools.some((t) => t.id === id))!; }
