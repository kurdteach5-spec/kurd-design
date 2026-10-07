import { useMotion, type MotionTool } from '../store';
import { mundo, mredo } from '../store';
import { MCOMMANDS } from '../commands';
import { formatShortcut } from '../../shortcuts/commands';
import {
  LuMousePointer2, LuHand, LuZoomIn, LuRotateCw, LuCrosshair, LuSquare, LuCircle, LuPentagon, LuStar, LuPenTool, LuType, LuCamera, LuUndo2, LuRedo2,
} from 'react-icons/lu';

const TOOLS: { id: MotionTool; label: string; cmd: string; icon: typeof LuHand }[] = [
  { id: 'select', label: 'Selection Tool', cmd: 'm.tool.select', icon: LuMousePointer2 },
  { id: 'hand', label: 'Hand Tool', cmd: 'm.tool.hand', icon: LuHand },
  { id: 'zoom', label: 'Zoom Tool', cmd: 'm.tool.zoom', icon: LuZoomIn },
  { id: 'rotate', label: 'Rotation Tool', cmd: 'm.tool.rotate', icon: LuRotateCw },
  { id: 'anchor', label: 'Pan Behind (Anchor Point) Tool', cmd: 'm.tool.anchor', icon: LuCrosshair },
  { id: 'rect', label: 'Rectangle Tool', cmd: 'm.tool.rect', icon: LuSquare },
  { id: 'ellipse', label: 'Ellipse Tool', cmd: 'm.tool.rect', icon: LuCircle },
  { id: 'polygon', label: 'Polygon Tool', cmd: 'm.tool.rect', icon: LuPentagon },
  { id: 'star', label: 'Star Tool', cmd: 'm.tool.rect', icon: LuStar },
  { id: 'pen', label: 'Pen Tool', cmd: 'm.tool.pen', icon: LuPenTool },
  { id: 'text', label: 'Type Tool', cmd: 'm.tool.text', icon: LuType },
  { id: 'camera', label: 'Camera Tool', cmd: 'm.tool.camera', icon: LuCamera },
];

export function MotionToolbar() {
  const tool = useMotion((s) => s.tool);
  const mode = useMotion((s) => s.shapeToolMode);
  const canUndo = useMotion((s) => s.past.length > 0);
  const canRedo = useMotion((s) => s.future.length > 0);
  const label = useMotion((s) => s.label);
  const drawTool = tool === 'rect' || tool === 'ellipse' || tool === 'polygon' || tool === 'star' || tool === 'pen';
  return (
    <div className="h-full flex items-center gap-0.5 px-2 min-w-0 overflow-x-auto" role="toolbar" aria-label="Motion tools">
      {TOOLS.map((t) => {
        const sc = MCOMMANDS.get(t.cmd)?.shortcut;
        const Icon = t.icon;
        return (
          <button key={t.id} type="button" aria-label={t.label} aria-pressed={tool === t.id} data-tip={t.label} data-tip-key={sc ? formatShortcut(sc) : undefined}
            className={`w-[30px] h-[28px] rounded-[5px] flex items-center justify-center shrink-0 ${tool === t.id ? 'bg-accent text-white' : 'text-ink hover:bg-hover'}`}
            onClick={() => useMotion.setState({ tool: t.id })}><Icon size={16} /></button>
        );
      })}
      {drawTool && (
        <div className="flex items-center ms-2 rounded-[5px] border border-line overflow-hidden shrink-0" role="radiogroup" aria-label="Draw as">
          {(['shape', 'mask'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={`h-[24px] px-2.5 text-xs ${mode === m ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'}`} onClick={() => useMotion.setState({ shapeToolMode: m })}
              data-tip={m === 'shape' ? 'Draw new shape layers' : 'Draw masks on the selected layer'}>{m === 'shape' ? 'Shape' : 'Mask'}</button>
          ))}
        </div>
      )}
      <div className="flex-1" />
      <span className="text-2xs text-faint truncate max-w-[220px] hidden lg:inline">{label}</span>
      <button type="button" className="icon-btn" aria-label="Undo" data-tip="Undo" data-tip-key="Ctrl+Z" disabled={!canUndo} onClick={mundo}><LuUndo2 size={15} /></button>
      <button type="button" className="icon-btn" aria-label="Redo" data-tip="Redo" data-tip-key="Ctrl+Shift+Z" disabled={!canRedo} onClick={mredo}><LuRedo2 size={15} /></button>
    </div>
  );
}
