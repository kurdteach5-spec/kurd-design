import type { ReactNode } from 'react';
import { useUI, type PanelId, type PanelGroup } from '../../state/uiStore';
import { LayersPanel } from '../panels/LayersPanel';
import { PropertiesPanel } from '../panels/PropertiesPanel';
import { ColorPanel, SwatchesPanel, HistoryPanel, AdjustmentsPanel, BrushPanel, CharacterPanel, ParagraphPanel } from '../panels/OtherPanels';
import { LuChevronDown, LuLayers, LuSlidersHorizontal, LuPalette, LuGrid3X3, LuHistory, LuContrast, LuBrush, LuType, LuPilcrow, LuPanelRightClose, LuPanelRightOpen, LuX } from 'react-icons/lu';

export const PANEL_META: Record<PanelId, { label: string; icon: (p: { size?: number }) => ReactNode; render: () => ReactNode }> = {
  layers: { label: 'Layers', icon: LuLayers, render: () => <LayersPanel /> },
  properties: { label: 'Properties', icon: LuSlidersHorizontal, render: () => <PropertiesPanel /> },
  color: { label: 'Color', icon: LuPalette, render: () => <ColorPanel /> },
  swatches: { label: 'Swatches', icon: LuGrid3X3, render: () => <SwatchesPanel /> },
  history: { label: 'History', icon: LuHistory, render: () => <HistoryPanel /> },
  adjustments: { label: 'Adjustments', icon: LuContrast, render: () => <AdjustmentsPanel /> },
  brush: { label: 'Brush', icon: LuBrush, render: () => <BrushPanel /> },
  character: { label: 'Character', icon: LuType, render: () => <CharacterPanel /> },
  paragraph: { label: 'Paragraph', icon: LuPilcrow, render: () => <ParagraphPanel /> },
};

function setGroup(id: string, patch: Partial<PanelGroup>) {
  useUI.setState((s) => ({ groups: s.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) }));
}

function Group({ g, grow, floating }: { g: PanelGroup; grow: boolean; floating?: boolean }) {
  const hidden = useUI((s) => s.hiddenPanels);
  const tabs = g.tabs.filter((t) => !hidden.includes(t));
  if (!tabs.length) return null;
  const active = tabs.includes(g.active) ? g.active : tabs[0];
  const collapsed = g.collapsed && !floating;
  return (
    <section className={`flex flex-col min-h-0 border-b border-line ${collapsed ? 'shrink-0' : grow ? 'flex-1 min-h-[240px]' : 'shrink'}`} style={!collapsed && !grow && !floating ? { maxHeight: g.id === 'g-color' ? 300 : '40%', flexBasis: 'auto' } : undefined} aria-label={`${PANEL_META[active].label} panel`}>
      <div className="flex items-center h-[30px] bg-[#202328] border-b border-line-soft shrink-0 pl-1" role="tablist">
        {tabs.map((t) => (
          <button type="button" key={t} role="tab" aria-selected={t === active} className="panel-tab"
            onClick={() => setGroup(g.id, { active: t, collapsed: false })}>{PANEL_META[t].label}</button>
        ))}
        <div className="flex-1" />
        {floating
          ? <button type="button" className="icon-btn" aria-label="Close panel" onClick={() => useUI.setState({ floatingGroup: null })}><LuX size={14} /></button>
          : <button type="button" className="icon-btn" aria-label={collapsed ? 'Expand panel' : 'Collapse panel'} aria-expanded={!collapsed} onClick={() => setGroup(g.id, { collapsed: !g.collapsed })}>
              <LuChevronDown size={14} className={`transition-transform ${collapsed ? '-rotate-90' : ''}`} />
            </button>}
      </div>
      {!collapsed && <div className={`min-h-0 overflow-y-auto overflow-x-hidden ${grow ? 'flex-1' : ''}`} role="tabpanel">{PANEL_META[active].render()}</div>}
    </section>
  );
}

export function Sidebar() {
  const groups = useUI((s) => s.groups);
  const mode = useUI((s) => s.sidebarMode);
  const width = useUI((s) => s.sidebarWidth);
  const floating = useUI((s) => s.floatingGroup);
  const hidden = useUI((s) => s.hiddenPanels);

  if (mode === 'rail') {
    const fg = groups.find((g) => g.id === floating);
    return (
      <div className="relative h-full flex">
        {fg && (
          <div className="absolute right-full top-1 bottom-1 mr-1 z-30 flex flex-col rounded-[6px] border border-line bg-panel shadow-[0_16px_40px_rgba(0,0,0,.5)] overflow-hidden" style={{ width: Math.min(width, window.innerWidth - 100) }}>
            <Group g={fg} grow floating />
          </div>
        )}
        <div className="w-[38px] h-full flex flex-col items-center gap-0.5 py-1.5 bg-panel border-l border-line" data-tip-side="left">
          {groups.flatMap((g) => g.tabs.filter((t) => !hidden.includes(t)).map((t) => {
            const Icon = PANEL_META[t].icon; const on = floating === g.id && g.active === t;
            return (
              <button type="button" key={t} className="icon-btn" aria-pressed={on} aria-label={PANEL_META[t].label} data-tip={PANEL_META[t].label}
                onClick={() => { setGroup(g.id, { active: t }); useUI.setState({ floatingGroup: on ? null : g.id }); }}>
                <Icon size={16} />
              </button>
            );
          }))}
          <div className="flex-1" />
          <button type="button" className="icon-btn" aria-label="Dock panels" data-tip="Dock panels" data-tip-key="Tab" onClick={() => useUI.setState({ sidebarMode: 'docked', floatingGroup: null })}><LuPanelRightOpen size={16} /></button>
        </div>
      </div>
    );
  }

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget; el.setPointerCapture(e.pointerId);
    const x0 = e.clientX, w0 = width;
    const move = (ev: PointerEvent) => useUI.setState({ sidebarWidth: Math.max(240, Math.min(520, w0 - (ev.clientX - x0))) });
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };

  const lastOpen = [...groups].reverse().find((g) => !g.collapsed && g.tabs.some((t) => !hidden.includes(t)))?.id;
  return (
    <aside className="relative h-full flex flex-col bg-panel border-l border-line" style={{ width }} aria-label="Panels">
      <div className="absolute -left-1 top-0 bottom-0 w-2 cursor-col-resize z-10" onPointerDown={startResize} role="separator" aria-orientation="vertical" aria-label="Resize panels" />
      {groups.map((g) => <Group key={g.id} g={g} grow={g.id === lastOpen} />)}
      <div className="flex justify-end px-1 py-0.5 border-t border-line-soft mt-auto">
        <button type="button" className="icon-btn" aria-label="Collapse panels to icons" data-tip="Collapse to icons" data-tip-key="Tab" onClick={() => useUI.setState({ sidebarMode: 'rail' })}><LuPanelRightClose size={15} /></button>
      </div>
    </aside>
  );
}
