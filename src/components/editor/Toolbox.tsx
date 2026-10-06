import { useRef, useState } from 'react';
import { useTools, setTool, swapColors, resetColors, setForeground, setBackground, type ToolId } from '../../state/toolStore';
import { TOOL_GROUPS } from '../../tools/registry';
import { TOOL_ICONS } from './toolIcons';
import { Popover } from '../ui/controls';
import { ColorPicker } from '../ui/ColorPicker';
import { getEngine } from '../../canvas/engine';
import { LuArrowLeftRight } from 'react-icons/lu';

export function Toolbox() {
  const tool = useTools((s) => s.tool);
  const [lastInGroup, setLast] = useState<Record<string, ToolId>>({});
  const [flyout, setFlyout] = useState<{ group: string; el: HTMLElement } | null>(null);
  const hold = useRef(0);

  return (
    <nav className="flex flex-col items-center gap-0.5 py-1.5 h-full overflow-y-auto overflow-x-hidden" aria-label="Tools" data-tip-side="right">
      {TOOL_GROUPS.map((g, gi) => {
        const inGroup = g.tools.some((t) => t.id === tool);
        const shown = inGroup ? tool : lastInGroup[g.id] ?? g.tools[0].id;
        const meta = g.tools.find((t) => t.id === shown)!;
        const Icon = TOOL_ICONS[shown];
        const sep = gi === 1 || gi === 6 || gi === 12 || gi === 16;
        return (
          <div key={g.id} className="w-full flex flex-col items-center">
            {sep && <div className="w-6 h-px bg-line my-1" />}
            <button
              type="button"
              className={`tool-btn relative w-[30px] h-[28px] rounded-[5px] flex items-center justify-center transition-colors ${inGroup ? 'bg-accent text-white' : 'text-[#aab1bb] hover:bg-hover hover:text-ink-strong'}`}
              aria-label={meta.label} aria-pressed={inGroup}
              data-tip={meta.label} data-tip-key={g.key}
              onClick={() => { setTool(shown); if (shown === 'hand') { /* double click fits */ } }}
              onDoubleClick={() => { if (shown === 'hand') getEngine()?.fit(); if (shown === 'zoom') getEngine()?.actualPixels(); }}
              onContextMenu={(e) => { e.preventDefault(); if (g.tools.length > 1) setFlyout({ group: g.id, el: e.currentTarget }); }}
              onPointerDown={(e) => { if (g.tools.length > 1) { const el = e.currentTarget; hold.current = window.setTimeout(() => setFlyout({ group: g.id, el }), 380); } }}
              onPointerUp={() => clearTimeout(hold.current)} onPointerLeave={() => clearTimeout(hold.current)}
            >
              <Icon size={16} />
              {g.tools.length > 1 && <span className={`absolute right-[2px] bottom-[2px] w-0 h-0 border-l-[4px] border-l-transparent border-b-[4px] ${inGroup ? 'border-b-white/80' : 'border-b-[#7d8590]'}`} />}
            </button>
          </div>
        );
      })}
      <ColorWells />
      {flyout && (
        <Popover anchor={flyout.el} placement="right-start" onClose={() => setFlyout(null)}>
          <div className="menu min-w-[190px]" role="menu">
            {TOOL_GROUPS.find((g) => g.id === flyout.group)!.tools.map((t) => {
              const Icon = TOOL_ICONS[t.id];
              return (
                <div key={t.id} role="menuitem" className="menu-item hover:bg-hover cursor-pointer" data-active={t.id === tool}
                  onClick={() => { setTool(t.id); setLast((l) => ({ ...l, [flyout.group]: t.id })); setFlyout(null); }}>
                  <Icon size={14} /><span className="flex-1">{t.label}</span>
                  <span className="text-faint text-2xs">{TOOL_GROUPS.find((g) => g.id === flyout.group)!.key}</span>
                </div>
              );
            })}
          </div>
        </Popover>
      )}
    </nav>
  );
}

function ColorWells() {
  const fg = useTools((s) => s.foreground), bg = useTools((s) => s.background);
  const [edit, setEdit] = useState<{ which: 'fg' | 'bg'; el: HTMLElement } | null>(null);
  return (
    <div className="mt-2 mb-1 relative w-[34px] h-[40px] shrink-0">
      <button type="button" aria-label="Background color" data-tip="Background color" className="absolute right-0 bottom-1 w-[20px] h-[20px] rounded-[3px] border border-[#5a616b] cursor-pointer"
        style={{ background: bg }} onClick={(e) => setEdit({ which: 'bg', el: e.currentTarget })} />
      <button type="button" aria-label="Foreground color" data-tip="Foreground color" className="absolute left-0 top-0 w-[20px] h-[20px] rounded-[3px] border border-[#5a616b] shadow-[0_0_0_1.5px_#24282e] cursor-pointer"
        style={{ background: fg }} onClick={(e) => setEdit({ which: 'fg', el: e.currentTarget })} />
      <button type="button" aria-label="Swap colors" data-tip="Swap colors" data-tip-key="X" className="absolute right-0 -top-0.5 text-muted hover:text-ink" onClick={swapColors}><LuArrowLeftRight size={10} /></button>
      <button type="button" aria-label="Default colors" data-tip="Default colors" data-tip-key="D" className="absolute left-0 bottom-0 w-[11px] h-[11px]" onClick={resetColors}>
        <span className="absolute left-0 top-0 w-[7px] h-[7px] bg-black border border-[#777]" /><span className="absolute right-0 bottom-0 w-[7px] h-[7px] bg-white border border-[#777]" />
      </button>
      {edit && (
        <Popover anchor={edit.el} placement="right-start" onClose={() => setEdit(null)}>
          <div className="menu p-3 w-[248px]">
            <div className="mb-2 font-medium text-ink-strong">{edit.which === 'fg' ? 'Foreground' : 'Background'} color</div>
            <ColorPicker color={edit.which === 'fg' ? fg : bg} onChange={(c) => (edit.which === 'fg' ? setForeground(c, false) : setBackground(c, false))} />
          </div>
        </Popover>
      )}
    </div>
  );
}
