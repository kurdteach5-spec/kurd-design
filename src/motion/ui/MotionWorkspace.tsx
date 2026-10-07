import { useEffect } from 'react';
import { MotionToolbar } from './MotionToolbar';
import { ProjectPanel } from './ProjectPanel';
import { EffectsPresetsPanel } from './EffectsPresetsPanel';
import { Viewer } from './Viewer';
import { Timeline } from './Timeline';
import { MotionProperties } from './MotionProperties';
import { RenderPanel } from './RenderPanel';
import { MotionDialogs } from './MotionDialogs';
import { useMotionUI } from '../uiState';
import { installMotionKeyboard } from '../commands';
import { startMotionAutosave } from '../project';
import { ErrorBoundary } from '../../components/editor/Chrome';

function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center h-[30px] bg-[#202328] border-b border-line-soft shrink-0 ps-1" role="tablist">
      {tabs.map((t) => <button key={t.id} type="button" role="tab" aria-selected={value === t.id} className="panel-tab shrink-0 whitespace-nowrap" onClick={() => onChange(t.id)}>{t.label}</button>)}
    </div>
  );
}

export function MotionWorkspace() {
  const ui = useMotionUI();
  useEffect(() => { installMotionKeyboard(); startMotionAutosave(); }, []);
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget; el.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = ui.timelineHeight;
    const mm = (ev: PointerEvent) => useMotionUI.setState({ timelineHeight: Math.max(140, Math.min(window.innerHeight - 260, h0 - (ev.clientY - y0))) });
    const up = () => { el.removeEventListener('pointermove', mm); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mm); el.addEventListener('pointerup', up);
  };
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="h-9 shrink-0 bg-panel border-b border-line"><MotionToolbar /></div>
      <div className="flex-1 min-h-0 flex">
        <aside className="w-[250px] shrink-0 bg-panel border-e border-line flex flex-col min-h-0 max-lg:hidden" aria-label="Project and effects">
          <Tabs value={ui.leftTab} tabs={[{ id: 'project', label: 'Project' }, { id: 'effects', label: 'Effects & Presets' }]} onChange={(v) => useMotionUI.setState({ leftTab: v })} />
          <div className="flex-1 min-h-0">{ui.leftTab === 'project' ? <ProjectPanel /> : <EffectsPresetsPanel />}</div>
        </aside>
        <main className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="flex-1 min-h-0"><ErrorBoundary label="viewer"><Viewer /></ErrorBoundary></div>
        </main>
        <aside className="w-[300px] shrink-0 bg-panel border-s border-line flex flex-col min-h-0 max-md:hidden" aria-label="Properties and render">
          <Tabs value={ui.rightTab} tabs={[{ id: 'properties', label: 'Properties' }, { id: 'render', label: 'Render' }]} onChange={(v) => useMotionUI.setState({ rightTab: v })} />
          <div className="flex-1 min-h-0 overflow-y-auto"><ErrorBoundary label="properties">{ui.rightTab === 'properties' ? <MotionProperties /> : <RenderPanel />}</ErrorBoundary></div>
        </aside>
      </div>
      <div className="h-1.5 shrink-0 cursor-row-resize bg-line hover:bg-accent/60" role="separator" aria-orientation="horizontal" aria-label="Resize timeline" onPointerDown={startResize} />
      <div className="shrink-0 min-h-0" style={{ height: ui.timelineHeight }}><ErrorBoundary label="timeline"><Timeline /></ErrorBoundary></div>
      <MotionDialogs />
    </div>
  );
}
