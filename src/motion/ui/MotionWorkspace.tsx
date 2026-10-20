import { useEffect } from 'react';
import { MotionToolbar } from './MotionToolbar';
import { ProjectPanel } from './ProjectPanel';
import { Viewer } from './Viewer';
import { Timeline } from './Timeline';
import { EffectControls } from './MotionProperties';
import { RightStack, WorkspaceSwitcher } from './AePanels';
import { useMotion, activeComp } from '../store';
import { RenderPanel } from './RenderPanel';
import { MotionDialogs } from './MotionDialogs';
import { useMotionUI } from '../uiState';
import { installMotionKeyboard } from '../commands';
import { startMotionAutosave } from '../project';
import { ErrorBoundary } from '../../components/editor/Chrome';
import { useWindowSize } from '../../utils/useWindowSize';
import { LuFolderOpen, LuSlidersHorizontal, LuX } from 'react-icons/lu';

function Tabs<T extends string>({ value, tabs, onChange, onClose }: { value: T; tabs: { id: T; label: string }[]; onChange: (v: T) => void; onClose?: () => void }) {
  return (
    <div className="flex items-center h-[30px] bg-[#151522] border-b border-line-soft shrink-0 ps-1" role="tablist">
      {tabs.map((t) => <button key={t.id} type="button" role="tab" aria-selected={value === t.id} className="panel-tab shrink-0 whitespace-nowrap" onClick={() => onChange(t.id)}>{t.label}</button>)}
      <div className="flex-1" />
      {onClose && <button type="button" className="icon-btn me-0.5" aria-label="Close panel" onClick={onClose}><LuX size={14} /></button>}
    </div>
  );
}

/**
 * Layout adapts to the window:
 * - wide (≥ 1280 px): project/effects on the left, properties/render on the right, timeline below;
 * - medium (≥ 860 px): properties stay docked on the right, project/effects open as a drawer;
 * - narrow (phones, small tablets): both side panels open as drawers over the viewer.
 * The timeline height follows the window height and can be dragged.
 */
export function MotionWorkspace() {
  const ui = useMotionUI();
  const { w, h } = useWindowSize();
  useEffect(() => { installMotionKeyboard(); startMotionAutosave(); }, []);
  const minimal = ui.aeWorkspace === 'minimal';
  const dockLeft = w >= 1280 && !minimal;
  const dockRight = w >= 860 && !minimal;
  const comp = useMotion((s) => activeComp(s));
  const leftW = w >= 1600 ? 270 : 240;
  const rightW = w >= 1600 ? 320 : w >= 1100 ? 290 : 260;
  const drawerW = Math.min(340, w - 48);
  // the timeline keeps at least ~200 px for the viewer above it
  const maxTl = Math.max(150, h - 32 - 36 - 200);
  const tlH = Math.max(120, Math.min(ui.timelineHeight, maxTl));
  const drawer = ui.drawer === 'left' && dockLeft ? null : ui.drawer === 'right' && dockRight ? null : ui.drawer;
  const setDrawer = (d: 'left' | 'right' | null) => useMotionUI.setState({ drawer: d });

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget; el.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = tlH;
    const mm = (ev: PointerEvent) => useMotionUI.setState({ timelineHeight: Math.round(Math.max(120, Math.min(maxTl, h0 - (ev.clientY - y0)))) });
    const up = () => { el.removeEventListener('pointermove', mm); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mm); el.addEventListener('pointerup', up);
  };

  const left = (onClose?: () => void) => (
    <>
      <Tabs value={ui.leftTab} tabs={[{ id: 'project', label: 'Project' }, { id: 'effectControls', label: 'Effect Controls' }]} onChange={(v) => useMotionUI.setState({ leftTab: v })} onClose={onClose} />
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">{ui.leftTab === 'project' ? <ProjectPanel /> : <ErrorBoundary label="effect controls"><EffectControls /></ErrorBoundary>}</div>
    </>
  );
  const right = (onClose?: () => void) => (
    <>
      {onClose && <div className="h-[28px] shrink-0 flex justify-end items-center border-b border-line-soft"><button type="button" className="icon-btn me-0.5" aria-label="Close panel" onClick={onClose}><LuX size={14} /></button></div>}
      <div className="flex-1 min-h-0"><RightStack /></div>
    </>
  );
  const PanelButton = ({ side, label, icon }: { side: 'left' | 'right'; label: string; icon: React.ReactNode }) => (
    <button type="button" aria-pressed={drawer === side} aria-label={label} data-tip={label}
      className={`h-[28px] px-2 rounded-[5px] inline-flex items-center gap-1.5 text-xs shrink-0 ${drawer === side ? 'bg-accent text-white' : 'text-ink hover:bg-hover'}`}
      onClick={() => setDrawer(drawer === side ? null : side)}>{icon}<span className="hidden sm:inline whitespace-nowrap">{label}</span></button>
  );

  return (
    <div className="h-full flex flex-col min-h-0 min-w-0">
      <div className="h-9 shrink-0 bg-panel border-b border-line flex items-center min-w-0">
        <div className="flex-1 min-w-0 h-full"><MotionToolbar /></div>
        <div className="px-2 h-full flex items-center border-s border-line"><WorkspaceSwitcher /></div>
        {(!dockLeft || !dockRight) && (
          <div className="flex items-center gap-1 pe-2 ps-1 border-s border-line h-full shrink-0">
            {!dockLeft && <PanelButton side="left" label="Project" icon={<LuFolderOpen size={15} />} />}
            {!dockRight && <PanelButton side="right" label="Properties" icon={<LuSlidersHorizontal size={15} />} />}
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 flex relative">
        {dockLeft && <aside className="shrink-0 bg-panel border-e border-line flex flex-col min-h-0" style={{ width: leftW }} aria-label="Project and effects">{left()}</aside>}
        <main className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="flex-1 min-h-0"><ErrorBoundary label="viewer"><Viewer /></ErrorBoundary></div>
        </main>
        {dockRight && <aside className="shrink-0 bg-panel border-s border-line flex flex-col min-h-0" style={{ width: rightW }} aria-label="Properties and render">{right()}</aside>}
        {drawer && (
          <>
            <div className="absolute inset-0 z-30 bg-black/40" onClick={() => setDrawer(null)} aria-hidden />
            <aside className={`absolute top-0 bottom-0 z-40 bg-panel flex flex-col min-h-0 shadow-[0_16px_40px_rgba(0,0,0,.55)] ${drawer === 'left' ? 'start-0 border-e' : 'end-0 border-s'} border-line`}
              style={{ width: drawerW }} aria-label={drawer === 'left' ? 'Project and effects' : 'Properties and render'}>
              {drawer === 'left' ? left(() => setDrawer(null)) : right(() => setDrawer(null))}
            </aside>
          </>
        )}
      </div>
      <div className="h-1.5 shrink-0 cursor-row-resize bg-line hover:bg-accent/60 touch-none" role="separator" aria-orientation="horizontal" aria-label="Resize timeline" onPointerDown={startResize} />
      <div className="shrink-0 min-h-0 flex flex-col" style={{ height: tlH }}>
        <div className="h-[28px] shrink-0 flex items-end gap-px px-1 bg-panel border-b border-line" role="tablist" aria-label="Timeline panels">
          <button type="button" role="tab" aria-selected={ui.bottomTab === 'timeline'} className={`h-[24px] px-3 rounded-t-[6px] text-xs whitespace-nowrap ${ui.bottomTab === 'timeline' ? 'bg-[#141421] text-ink-strong' : 'text-muted hover:text-ink'}`} onClick={() => useMotionUI.setState({ bottomTab: 'timeline' })}>
            <span translate="no">{comp ? comp.name : ''}</span>{comp ? ' · ' : ''}Timeline
          </button>
          <button type="button" role="tab" aria-selected={ui.bottomTab === 'render'} className={`h-[24px] px-3 rounded-t-[6px] text-xs whitespace-nowrap ${ui.bottomTab === 'render' ? 'bg-[#141421] text-ink-strong' : 'text-muted hover:text-ink'}`} onClick={() => useMotionUI.setState({ bottomTab: 'render' })}>Render Queue</button>
        </div>
        <div className="flex-1 min-h-0">{ui.bottomTab === 'timeline' ? <ErrorBoundary label="timeline"><Timeline /></ErrorBoundary> : <div className="h-full overflow-y-auto bg-[#141421]"><div className="max-w-[720px]"><ErrorBoundary label="render"><RenderPanel /></ErrorBoundary></div></div>}</div>
      </div>
      <MotionDialogs />
    </div>
  );
}
