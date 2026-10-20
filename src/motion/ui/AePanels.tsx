// After Effects-style panels for the Motion section: the stacked right column (Info, Preview, Effects & Presets,
// Align, Properties), the workspace switcher in the tools bar, and the panel headers with the ≡ menu look.
import { type ReactNode } from 'react';
import { useMotion, activeComp } from '../store';
import * as A from '../actions';
import { formatTimecode } from '../anim';
import { togglePlay, stop } from '../media/playback';
import { useMotionUI, useViewerInfo, setAeWorkspace, type RightPanel, type AeWorkspace } from '../uiState';
import { EffectsPresetsPanel } from './EffectsPresetsPanel';
import { MotionProperties } from './MotionProperties';
import { ErrorBoundary } from '../../components/editor/Chrome';
import {
  LuChevronRight, LuSkipBack, LuStepBack, LuPlay, LuPause, LuSquare, LuStepForward, LuSkipForward, LuRepeat,
  LuAlignStartVertical, LuAlignCenterVertical, LuAlignEndVertical, LuAlignStartHorizontal, LuAlignCenterHorizontal, LuAlignEndHorizontal,
  LuAlignHorizontalDistributeCenter, LuAlignVerticalDistributeCenter, LuMenu,
} from 'react-icons/lu';

/** an After Effects panel header: twirl, name and the ≡ panel menu mark */
export function PanelHead({ title, open, onToggle, right }: { title: string; open?: boolean; onToggle?: () => void; right?: ReactNode }) {
  return (
    <div className="h-[28px] shrink-0 flex items-center gap-1.5 ps-2 pe-1.5 bg-[#151522] border-b border-line-soft select-none">
      {onToggle ? (
        <button type="button" className="flex items-center gap-1.5 flex-1 min-w-0 h-full text-start text-xs font-semibold text-ink" aria-expanded={open} onClick={onToggle}>
          <LuChevronRight size={12} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} /><span className="truncate">{title}</span>
        </button>
      ) : <span className="flex-1 min-w-0 truncate text-xs font-semibold text-ink">{title}</span>}
      {right}
      <LuMenu size={12} className="text-faint shrink-0" aria-hidden />
    </div>
  );
}

function InfoPanel() {
  const info = useViewerInfo();
  const comp = useMotion((s) => activeComp(s));
  const t = useMotion((s) => (s.activeCompId ? s.times[s.activeCompId] ?? 0 : 0));
  const sel = useMotion((s) => s.selectedLayers);
  const l = comp?.layers.find((x) => x.id === sel[0]);
  const c = info.rgba;
  return (
    <div className="px-3 py-2 grid grid-cols-[1fr_1fr] gap-x-4 text-xs num" translate="no">
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="w-4 h-4 rounded-[3px] border border-line shrink-0" style={{ background: c ? `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})` : 'transparent' }} aria-hidden />
          <span className="text-[#ff7a7a]">R: {c ? c[0] : ''}</span>
        </span>
        <span className="ps-6 text-[#6ee7a0]">G: {c ? c[1] : ''}</span>
        <span className="ps-6 text-[#7cb3ff]">B: {c ? c[2] : ''}</span>
        <span className="ps-6 text-muted">A: {c ? c[3] : ''}</span>
      </div>
      <div className="flex flex-col gap-0.5 text-ink">
        <span>X: {info.x ?? ''}</span>
        <span>Y: {info.y ?? ''}</span>
      </div>
      <div className="col-span-2 mt-1.5 pt-1.5 border-t border-line-soft text-2xs text-muted truncate">
        {l ? `${l.name} · In ${formatTimecode(l.inPoint, comp!.fps)} · Out ${formatTimecode(l.outPoint, comp!.fps)} · Δ ${formatTimecode(l.outPoint - l.inPoint, comp!.fps)}` : comp ? `${comp.name} · ${formatTimecode(t, comp.fps)}` : ''}
      </div>
    </div>
  );
}

export function PreviewPanel() {
  const playing = useMotion((s) => s.playing);
  const loop = useMotion((s) => s.loop);
  const quality = useMotion((s) => s.quality);
  const comp = useMotion((s) => activeComp(s));
  const fps = useMotion((s) => s.measuredFps);
  const Btn = ({ label, onClick, children, on }: { label: string; onClick: () => void; children: ReactNode; on?: boolean }) => (
    <button type="button" className={`icon-btn ${on ? '!text-accent' : ''}`} aria-label={label} data-tip={label} aria-pressed={on} disabled={!comp} onClick={onClick}>{children}</button>
  );
  return (
    <div className="px-2.5 py-2 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-0.5">
        <Btn label="Go to start (Home)" onClick={A.goToStart}><LuSkipBack size={15} /></Btn>
        <Btn label="Previous frame (Page Up)" onClick={() => A.stepFrames(-1)}><LuStepBack size={15} /></Btn>
        <button type="button" className="h-8 w-11 shrink-0 rounded-[8px] text-white flex items-center justify-center disabled:opacity-40" style={{ background: 'linear-gradient(135deg,#8b6cff,#5b6cff)' }} disabled={!comp}
          aria-label={playing ? 'Pause (Space)' : 'Play (Space)'} data-tip={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={togglePlay}>{playing ? <LuPause size={17} /> : <LuPlay size={17} />}</button>
        <Btn label="Stop" onClick={stop}><LuSquare size={13} /></Btn>
        <Btn label="Next frame (Page Down)" onClick={() => A.stepFrames(1)}><LuStepForward size={15} /></Btn>
        <Btn label="Go to end (End)" onClick={A.goToEnd}><LuSkipForward size={15} /></Btn>
        <Btn label="Loop" on={loop} onClick={() => useMotion.setState({ loop: !loop })}><LuRepeat size={14} /></Btn>
      </div>
      <div className="grid grid-cols-[84px_1fr] items-center gap-x-2 gap-y-1.5 text-xs">
        <span className="text-muted">Resolution</span>
        <select className="field h-[22px] text-xs" value={String(quality)} aria-label="Preview resolution" onChange={(e) => useMotion.setState({ quality: Number(e.target.value) as 1 | 0.5 | 0.25 })}>
          <option value="1">Full</option><option value="0.5">Half</option><option value="0.25">Quarter</option>
        </select>
        <span className="text-muted">Frame rate</span>
        <span className="num text-ink">{comp ? `${playing && fps ? `${fps} / ` : ''}${comp.fps} fps` : '—'}</span>
      </div>
    </div>
  );
}

function AlignPanel() {
  const n = useMotion((s) => s.selectedLayers.length);
  const B = ({ label, onClick, children, off }: { label: string; onClick: () => void; children: ReactNode; off?: boolean }) => (
    <button type="button" className="icon-btn" aria-label={label} data-tip={label} disabled={off} onClick={onClick}>{children}</button>
  );
  const to: 'comp' | 'selection' = n > 1 ? 'selection' : 'comp';
  return (
    <div className="px-2.5 py-2 flex flex-col gap-1.5 text-xs">
      <div className="text-muted">{n > 1 ? 'Align layers to: Selection' : 'Align layers to: Composition'}</div>
      <div className="flex flex-wrap gap-0.5">
        <B label="Align Left" off={!n} onClick={() => A.alignLayers('left', to)}><LuAlignStartVertical size={16} /></B>
        <B label="Align Horizontal Center" off={!n} onClick={() => A.alignLayers('hcenter', to)}><LuAlignCenterVertical size={16} /></B>
        <B label="Align Right" off={!n} onClick={() => A.alignLayers('right', to)}><LuAlignEndVertical size={16} /></B>
        <span className="w-2" />
        <B label="Align Top" off={!n} onClick={() => A.alignLayers('top', to)}><LuAlignStartHorizontal size={16} /></B>
        <B label="Align Vertical Center" off={!n} onClick={() => A.alignLayers('vcenter', to)}><LuAlignCenterHorizontal size={16} /></B>
        <B label="Align Bottom" off={!n} onClick={() => A.alignLayers('bottom', to)}><LuAlignEndHorizontal size={16} /></B>
      </div>
      <div className="text-muted">Distribute layers</div>
      <div className="flex gap-0.5">
        <B label="Distribute Horizontally" off={n < 3} onClick={() => A.distributeLayers('h')}><LuAlignHorizontalDistributeCenter size={16} /></B>
        <B label="Distribute Vertically" off={n < 3} onClick={() => A.distributeLayers('v')}><LuAlignVerticalDistributeCenter size={16} /></B>
      </div>
    </div>
  );
}

const PANELS: { id: RightPanel; title: string; body: () => ReactNode; grow?: boolean }[] = [
  { id: 'info', title: 'Info', body: () => <InfoPanel /> },
  { id: 'preview', title: 'Preview', body: () => <PreviewPanel /> },
  { id: 'effects', title: 'Effects & Presets', body: () => <div className="h-[300px] flex flex-col min-h-0"><EffectsPresetsPanel /></div> },
  { id: 'align', title: 'Align', body: () => <AlignPanel /> },
  { id: 'properties', title: 'Properties', body: () => <ErrorBoundary label="properties"><MotionProperties /></ErrorBoundary> },
];

/** The right column: panels stacked one under the other, each opens and closes like in After Effects. */
export function RightStack() {
  const open = useMotionUI((s) => s.rightOpen);
  const toggle = (id: RightPanel) => useMotionUI.setState((s) => ({ rightOpen: { ...s.rightOpen, [id]: !s.rightOpen[id] } }));
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      {PANELS.map((p) => (
        <section key={p.id} className="border-b border-line" aria-label={p.title}>
          <PanelHead title={p.title} open={!!open[p.id]} onToggle={() => toggle(p.id)} />
          {open[p.id] && p.body()}
        </section>
      ))}
    </div>
  );
}

const WS: { id: AeWorkspace; label: string; tip: string }[] = [
  { id: 'default', label: 'Default', tip: 'Project and Effect Controls on the left, Info, Preview, Effects & Presets and Properties on the right' },
  { id: 'animation', label: 'Animation', tip: 'Graph Editor in the timeline, Preview, Align and Properties' },
  { id: 'effects', label: 'Effects', tip: 'Effect Controls on the left, Effects & Presets on the right' },
  { id: 'minimal', label: 'Minimal', tip: 'Only the composition and the timeline' },
];

/** Workspace names on the right of the tools bar, with Snapping, as in After Effects. */
export function WorkspaceSwitcher() {
  const ws = useMotionUI((s) => s.aeWorkspace);
  const snap = useMotion((s) => s.timeline.snap);
  return (
    <div className="flex items-center gap-2 shrink-0">
      <label className="hidden lg:flex items-center gap-1.5 text-xs text-muted cursor-pointer" data-tip="Snap layers, keyframes and the time indicator to edges and markers">
        <input type="checkbox" checked={snap} onChange={(e) => useMotion.setState((s) => ({ timeline: { ...s.timeline, snap: e.target.checked } }))} />Snapping
      </label>
      <div className="hidden md:flex items-center" role="radiogroup" aria-label="Workspace">
        {WS.map((w) => (
          <button key={w.id} type="button" role="radio" aria-checked={ws === w.id} data-tip={w.tip}
            className={`h-[26px] px-2 text-xs whitespace-nowrap border-b-2 ${ws === w.id ? 'text-[#a78bfa] border-[#7c5cff]' : 'text-muted border-transparent hover:text-ink'}`}
            onClick={() => setAeWorkspace(w.id)}>{w.label}</button>
        ))}
      </div>
    </div>
  );
}
