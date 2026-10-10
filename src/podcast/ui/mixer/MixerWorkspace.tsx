// Vision Mixer workspace: a live switcher for the podcast cameras. Multiview (or program / one input, chosen
// with VIDEO OUT) on top, the switcher panel below (hardware-style panel or the full software panel),
// palettes on the side and the recorded timeline at the bottom. Everything switched is recorded on the
// same timeline as the Podcast workspace, so it can be fine-tuned, rendered or exported there too.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { usePod, ensureTimeline, inputsOf, segmentAt } from '../../store';
import { pressInput, activeSS, useSS, ssLayout } from '../../mixer';
import { editTips } from '../../advisor';
import { analyze, setSoundSettings } from '../../store';
import { useLink } from '../PodTimeline';
import { FormatBox } from '../FormatBox';
import { useShortcutsDialog } from '../shortcuts';
import { toast } from '../../../state/uiStore';
import { SuperSourceEditor } from './Palettes';
import { useRenderJob, startRender, cancelRender, downloadLastRender } from '../../renderJob';
import { exportRange } from '../../exports';
import { RENDER_FORMATS, type RenderFormat } from '../../ffmpeg';
import { ConvertStatus } from '../ConvertStatus';
import { shortName } from '../../labels';
import { addSplit, removeSplit } from '../../store';
import { Multiview, BigWindow, FullInput, multiviewWindows, presetToCustom, useMvEdit, customOf, customRows } from './Multiview';
import { AtemPanel } from './AtemPanel';
import { SwitcherPanel } from './SwitcherPanel';
import { Palettes } from './Palettes';
import { Transport } from '../Monitors';
import { PodTimeline } from '../PodTimeline';
import { ErrorBoundary } from '../../../components/editor/Chrome';
import { useWindowSize } from '../../../utils/useWindowSize';
import { useMixerUI, type MixerUI } from './mixerUI';
import { installShortcuts } from '../shortcuts';
import { ShortcutsButton } from '../ShortcutsDialog';
export { useMixerUI };
import { LuMonitor, LuPencilRuler, LuColumns2, LuSmartphone, LuAudioLines, LuLightbulb, LuKeyboard, LuLayoutGrid, LuSettings2, LuX, LuChevronDown, LuChevronUp, LuFilm, LuCircleStop, LuDownload, LuPlus, LuCheck } from 'react-icons/lu';

/** a draggable divider between two areas; reports the drag distance from where it started */
function Splitter({ dir, onDrag, label, onReset }: { dir: 'col' | 'row'; onDrag: (d: number, start: boolean) => void; label: string; onReset?: () => void }) {
  return (
    <div role="separator" aria-orientation={dir === 'col' ? 'vertical' : 'horizontal'} aria-label={label} data-tip={`${label} — drag to resize, double-click to reset`}
      className={`group shrink-0 relative z-10 touch-none ${dir === 'col' ? 'w-[6px] -mx-[3px] cursor-col-resize' : 'h-[6px] -my-[3px] cursor-row-resize'}`}
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        e.preventDefault(); const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
        const x0 = e.clientX, y0 = e.clientY; onDrag(0, true);
        const mm = (ev: PointerEvent) => onDrag(dir === 'col' ? ev.clientX - x0 : ev.clientY - y0, false);
        const up = () => { el.removeEventListener('pointermove', mm); el.removeEventListener('pointerup', up); document.body.style.cursor = ''; };
        el.addEventListener('pointermove', mm); el.addEventListener('pointerup', up); document.body.style.cursor = dir === 'col' ? 'col-resize' : 'row-resize';
      }}>
      <div className={`absolute bg-accent opacity-0 group-hover:opacity-100 transition-opacity ${dir === 'col' ? 'top-0 bottom-0 left-[2px] w-[2px]' : 'left-0 right-0 top-[2px] h-[2px]'}`} />
    </div>
  );
}
/** drag helper: remembers the size when the drag starts */
function resizer(key: 'side' | 'panelH' | 'tlH', min: number, max: () => number, sign = 1) {
  let start = 0;
  return (d: number, first: boolean) => {
    if (first) { start = useMixerUI.getState()[key]; return; }
    useMixerUI.setState({ [key]: Math.round(Math.max(min, Math.min(max(), start + sign * d))) } as Partial<MixerUI>);
  };
}

/** height / width of the multiview for the current layout */
function mvRatio(): number {
  const s = usePod.getState(); const a = s.output.height / s.output.width; const n = multiviewWindows(s).length;
  if (s.videoOut !== 'mv') return a;
  if (s.multiview.layout === 'custom') { const c = customOf(s); return (customRows(c) * a) / c.cols + (useMvEdit.getState().on ? a / c.cols : 0); }
  if (s.multiview.layout === 'pgmBig') return (2 + Math.ceil(Math.max(0, n - 1) / 3)) * a / 3;
  if (s.multiview.layout === 'quad') return a / 2 + a / 2 + Math.ceil(Math.max(0, n - 8) / 4) * a / 4;
  return a / 2 + Math.ceil(n / 4) * a / 4;
}

/** the main monitor, as large as fits */
function MainView() {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const vout = usePod((s) => s.videoOut);
  const layoutKey = usePod((s) => `${s.videoOut}|${s.multiview.layout}|${multiviewWindows(s).length}|${s.output.width}x${s.output.height}|${JSON.stringify(s.multiview.custom ?? null)}`) + useMvEdit((s) => String(s.on));
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const fit = () => { const r = el.getBoundingClientRect(); setW(Math.max(200, Math.min(r.width - 8, (r.height - 8) / mvRatio()))); };
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect();
  }, [layoutKey]);
  const valid = usePod((s) => vout === 'mv' || vout === 'pgm' || inputsOf(s).includes(vout));
  const mvEdit = useMvEdit((s) => s.on);
  if (vout === 'ss') return <SuperSourceStudio />;
  if (vout === 'format') return <FormatStudio />;
  return (
    <div ref={box} className="relative flex-1 min-h-[120px] flex items-center justify-center bg-[#0b0c0e] overflow-hidden">
      {(vout === 'mv' || !valid) && (
        <button type="button" className={`absolute right-2 top-2 z-20 h-[24px] px-2 rounded-[5px] text-xs inline-flex items-center gap-1 ${mvEdit ? 'bg-accent' : 'bg-black/60 hover:bg-black/80'}`} style={{ color: '#fff' }} aria-pressed={mvEdit}
          onClick={() => { const s = usePod.getState(); if (s.multiview.layout !== 'custom') usePod.setState({ multiview: { ...s.multiview, layout: 'custom', custom: s.multiview.custom ?? presetToCustom(s.multiview.layout, s) } }); useMvEdit.setState({ on: !mvEdit }); }}>
          <LuLayoutGrid size={12} />{mvEdit ? 'Done' : 'Layout'}
        </button>
      )}
      <div style={{ width: w }}>
        {vout === 'mv' || !valid ? <Multiview /> : vout === 'pgm' ? <BigWindow kind="pgm" /> : <FullInput id={vout} />}
      </div>
    </div>
  );
}

/** every tool of the mixer, one click away */
function FeatureBar() {
  const vout = usePod((s) => s.videoOut);
  const mvEdit = useMvEdit((s) => s.on);
  const analysed = usePod((s) => !!s.analysis && !s.analysis.stub);
  const busy = usePod((s) => ['decoding', 'syncing', 'speakers', 'checking'].includes(s.phase));
  const mode = usePod((s) => s.settings.audioMode);
  const tips = usePod((s) => editTips(s).length);
  const B = ({ on, label, tip, onClick, children }: { on?: boolean; label: string; tip: string; onClick: () => void; children: ReactNode }) => (
    <button type="button" className={`h-[28px] px-2.5 rounded-[6px] text-xs inline-flex items-center gap-1.5 shrink-0 border ${on ? 'bg-accent border-accent' : 'border-line text-ink hover:bg-hover'}`} style={on ? { color: '#fff' } : undefined} aria-pressed={!!on} data-tip={tip} onClick={onClick}>{children}<span>{label}</span></button>
  );
  const mvLayout = () => { const s = usePod.getState(); if (s.multiview.layout !== 'custom') usePod.setState({ multiview: { ...s.multiview, layout: 'custom', custom: s.multiview.custom ?? presetToCustom(s.multiview.layout, s) } }); usePod.setState({ videoOut: 'mv' }); useMvEdit.setState({ on: !mvEdit }); };
  return (
    <div className="h-10 shrink-0 flex items-center gap-1.5 px-2 bg-[#191b1f] border-b border-line overflow-x-auto no-scrollbar" role="toolbar" aria-label="Mixer tools">
      <B on={vout === 'mv' && !mvEdit} label="Multiview" tip="Preview, program and every input" onClick={() => { useMvEdit.setState({ on: false }); usePod.setState({ videoOut: 'mv' }); }}><LuLayoutGrid size={14} /></B>
      <B on={vout === 'pgm'} label="Program" tip="The program picture, large" onClick={() => usePod.setState({ videoOut: 'pgm' })}><LuMonitor size={14} /></B>
      <B on={mvEdit} label="Design the multiview" tip="Make your own multiview: choose, size and move every window" onClick={mvLayout}><LuPencilRuler size={14} /></B>
      <B on={vout === 'ss'} label="SuperSource · split screen" tip="Make split screens: layout, cameras, borders per side, animation" onClick={() => { if (!activeSS()) ssLayout('side2'); usePod.setState({ videoOut: 'ss' }); }}><LuColumns2 size={14} /></B>
      <B on={vout === 'format'} label="Reels & sizes" tip="9:16 Reels / TikTok / Shorts, 4:5, 1:1, 16:9 … and centring the person (auto or by hand)" onClick={() => usePod.setState({ videoOut: vout === 'format' ? 'mv' : 'format' })}><LuSmartphone size={14} /></B>
      <B on={mode === 'picture'} label="Sound J / L cut" tip="The sound follows the picture on its own lane in the timeline, linked; unlink it to make J / L cuts" onClick={() => { setSoundSettings({ audioMode: 'picture' }); useMixerUI.setState({ timeline: true }); useLink.setState({ linked: false }); toast('Sound lane: drag a sound cut on the green lane to move it before (J) or after (L) the picture cut. Click the link icon to link them again.', 'info', 7000); }}><LuAudioLines size={14} /></B>
      <B on={analysed && tips > 0} label={analysed ? `Tips (${tips})` : busy ? 'Listening…' : 'Tips: who speaks'} tip="Finds who speaks when, then the timeline says which camera is better and where to cut" onClick={() => { useMixerUI.setState({ timeline: true }); if (!analysed && !busy) void analyze({ keepEdit: true }); }}><LuLightbulb size={14} /></B>
      <B label="Shortcuts" tip="Every tool on the keyboard — change any key" onClick={() => useShortcutsDialog.setState({ open: true })}><LuKeyboard size={14} /></B>
    </div>
  );
}

/** output size and framing, with the program picture in that size */
function FormatStudio() {
  const out = usePod((s) => s.output);
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(300);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const go = () => { const r = el.getBoundingClientRect(); setW(Math.max(120, Math.min(r.width - 16, ((r.height - 16) * out.width) / out.height))); };
    go(); const ro = new ResizeObserver(go); ro.observe(el); return () => ro.disconnect();
  }, [out.width, out.height]);
  return (
    <div className="flex-1 min-h-0 flex bg-[#101114]">
      <div ref={box} className="flex-1 min-w-0 flex items-center justify-center"><div style={{ width: w }}><BigWindow kind="pgm" /></div></div>
      <div className="w-[340px] shrink-0 border-s border-line bg-panel overflow-y-auto p-3 flex flex-col gap-2">
        <div className="flex items-center gap-2"><span className="text-sm font-semibold text-ink-strong flex-1">Reels & sizes</span><button type="button" className="btn btn-primary h-[26px] text-xs inline-flex items-center gap-1" onClick={() => usePod.setState({ videoOut: 'mv' })}><LuCheck size={13} />Done</button></div>
        <FormatBox />
      </div>
    </div>
  );
}

/** the large SuperSource editor (VIDEO OUT ▸ EDIT) */
function SuperSourceStudio() {
  const splits = usePod((s) => s.splits);
  usePod((s) => s.labels); useSS((s) => s.active);
  const id = activeSS();
  const pgm = usePod((s) => segmentAt(s.time, s.segments)?.cam ?? null);
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#101114]">
      <div className="h-9 shrink-0 flex items-center gap-1.5 px-2 border-b border-line bg-[#191b1f] overflow-x-auto no-scrollbar">
        <span className="text-xs font-semibold text-ink-strong shrink-0 me-1">SuperSource</span>
        {splits.map((x) => (
          <button key={x.id} type="button" className={`h-[24px] px-2 rounded-[5px] text-xs shrink-0 ${x.id === id ? 'bg-accent text-white' : 'btn'}`} onClick={() => useSS.setState({ active: x.id })} translate="no">{shortName(x.id)}</button>
        ))}
        <button type="button" className="btn h-[24px] text-xs inline-flex items-center gap-1 shrink-0" onClick={() => useSS.setState({ active: addSplit('side2') })}><LuPlus size={12} />New</button>
        {id && <button type="button" className="icon-btn !w-6 !h-6 shrink-0" aria-label="Remove SuperSource" data-tip="Remove SuperSource" onClick={() => { if (window.confirm('Remove this SuperSource? Shots that use it become black.')) removeSplit(id); }}><LuX size={13} /></button>}
        <div className="flex-1" />
        {id && <button type="button" className={`h-[26px] px-2.5 rounded-[5px] text-xs font-semibold shrink-0 ${pgm === id ? 'bg-[#d42020]' : 'bg-[#3a1d1d] hover:bg-[#5a2222]'}`} style={{ color: '#fff' }} onClick={() => pressInput(id)}>{pgm === id ? 'On program' : 'Put on program'}</button>}
        <button type="button" className="btn btn-primary h-[26px] text-xs inline-flex items-center gap-1 shrink-0" onClick={() => usePod.setState({ videoOut: 'mv' })}><LuCheck size={13} />Done</button>
      </div>
      <div className="flex-1 min-h-0 p-3">
        {id ? <SuperSourceEditor id={id} large /> : <div className="h-full flex items-center justify-center text-muted text-sm">Add cameras first.</div>}
      </div>
    </div>
  );
}

/** scales its content to fit the area (width and height), from 35 % up to 160 %; scrolls when even smaller */
function FitBox({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ k: 1, w: 0, h: 0 });
  useLayoutEffect(() => {
    const o = outer.current, i = inner.current; if (!o || !i) return;
    // offsetWidth / offsetHeight ignore the transform: they are the content's natural size
    const go = () => { const w = i.offsetWidth, h = i.offsetHeight; const k = Math.max(0.35, Math.min(1.6, (o.clientWidth - 4) / Math.max(1, w), (o.clientHeight - 2) / Math.max(1, h))); setFit((f) => (Math.abs(f.k - k) < 0.004 && f.w === w && f.h === h ? f : { k, w, h })); };
    go(); const ro = new ResizeObserver(go); ro.observe(o); ro.observe(i);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outer} className="w-full h-full overflow-auto no-scrollbar flex">
      <div className="m-auto relative shrink-0" style={{ width: fit.w ? fit.w * fit.k : undefined, height: fit.h ? fit.h * fit.k : undefined }}>
        <div ref={inner} className="w-max absolute left-0 top-0 origin-top-left" style={{ transform: `scale(${fit.k})` }}>{children}</div>
      </div>
    </div>
  );
}

/** Render: make the video file now (progress, cancel, download again) */
function RenderButton() {
  const job = useRenderJob((s) => s.p);
  const stage = useRenderJob((s) => s.stage);
  const fmt = usePod((s) => s.renderFormat);
  const last = useRenderJob((s) => s.last);
  const has = usePod((s) => s.segments.length > 0);
  const inP = usePod((s) => s.inPoint), outP = usePod((s) => s.outPoint);
  usePod((s) => s.analysis);
  const r = exportRange(); const len = Math.max(0, r.end - r.start);
  const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  if (job !== null) {
    return (
      <div className="flex items-center gap-2 shrink-0" role="status">
        <div className="w-[120px] h-1.5 rounded-full bg-[#1a1d21] overflow-hidden"><div className="h-full bg-accent" style={{ width: `${Math.round(job * 100)}%` }} /></div>
        <span className="text-xs num text-ink">{`${Math.round(job * 100)}%`}</span>
        {stage && <span className="text-2xs text-muted max-w-[180px] truncate">{stage}</span>}
        <button type="button" className="btn h-[26px] text-xs inline-flex items-center gap-1" onClick={cancelRender}><LuCircleStop size={13} />Cancel</button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 shrink-0">
      {last && <button type="button" className="icon-btn" aria-label="Download the last video again" data-tip="Download the last video again" onClick={() => void downloadLastRender()}><LuDownload size={14} /></button>}
      <select className="field h-[28px] text-xs w-[78px]" value={fmt} aria-label="Video file type" data-tip="File type of the rendered video" onChange={(e) => usePod.setState({ renderFormat: e.target.value as RenderFormat })}>
        {RENDER_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.id.toUpperCase()}</option>)}
      </select>
      <button type="button" className="btn btn-primary h-[28px] px-3 text-xs inline-flex items-center gap-1.5" disabled={!has} onClick={() => void startRender()}
        data-tip={`Render the program to a video file${inP !== null || outP !== null ? ' (I / O range)' : ''} · ${mmss(len)} · plays in real time`}>
        <LuFilm size={14} /><span>Render video</span><span className="num opacity-80">{mmss(len)}</span>
      </button>
    </div>
  );
}

export function MixerWorkspace() {
  const { w, h } = useWindowSize();
  const ui = useMixerUI();
  const cams = usePod((s) => s.cameras.length);
  useEffect(() => { installShortcuts(); ensureTimeline(); }, []);
  useEffect(() => { ensureTimeline(); }, [cams]);
  const dock = w >= 1100;
  const narrow = w < 760;
  const side = Math.max(240, Math.min(ui.side, Math.round(w * 0.45)));
  const tlH = Math.max(90, Math.min(ui.tlH, Math.round(h * 0.5)));
  const panelH = Math.max(90, Math.min(ui.panelH, Math.round(h * 0.7)));
  const dragSide = resizer('side', 240, () => Math.round(window.innerWidth * 0.45));
  const dragPanel = resizer('panelH', 90, () => Math.round(window.innerHeight * 0.7), -1);
  const dragTl = resizer('tlH', 90, () => Math.round(window.innerHeight * 0.5), -1);
  return (
    <div className="h-full flex flex-col min-h-0 min-w-0 bg-[#141619]">
      <div className="flex-1 min-h-0 flex relative">
        {dock && <aside className="shrink-0 bg-panel border-e border-line overflow-y-auto overflow-x-hidden" style={{ width: side }} aria-label="Switcher palettes"><ErrorBoundary label="palettes"><Palettes /></ErrorBoundary></aside>}
        {dock && <Splitter dir="col" label="Resize the side panel" onDrag={dragSide} onReset={() => useMixerUI.setState({ side: 320 })} />}
        <main className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="h-9 shrink-0 flex items-center gap-2 px-2 bg-panel border-b border-line overflow-x-auto no-scrollbar">
            {!dock && (
              <button type="button" className={`h-[28px] px-2.5 rounded-[5px] inline-flex items-center gap-1.5 text-xs shrink-0 ${ui.drawer ? 'bg-accent text-white' : 'text-ink hover:bg-hover border border-line'}`} aria-pressed={ui.drawer} onClick={() => useMixerUI.setState({ drawer: !ui.drawer })}>
                <LuSettings2 size={14} /><span>Inputs & SuperSource</span>
              </button>
            )}
            <div className="flex items-center rounded-[6px] border border-line overflow-hidden shrink-0" role="tablist" aria-label="Switcher panel">
              {([['mini', 'Hardware panel'], ['software', 'Software panel']] as const).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={ui.panel === id} className={`h-[26px] px-2.5 text-xs ${ui.panel === id ? 'bg-accent text-white' : 'text-muted hover:text-ink hover:bg-hover'}`} onClick={() => useMixerUI.setState({ panel: id })}>{label}</button>
              ))}
            </div>
            <div className="flex-1" />
            <ConvertStatus />
            <RenderButton />
            <ShortcutsButton />
            <button type="button" className="h-[26px] px-2 rounded-[5px] text-xs text-muted hover:text-ink hover:bg-hover inline-flex items-center gap-1 shrink-0" aria-pressed={ui.timeline} onClick={() => useMixerUI.setState({ timeline: !ui.timeline })}>
              {ui.timeline ? <LuChevronDown size={13} /> : <LuChevronUp size={13} />}<span>Timeline</span>
            </button>
          </div>
          <FeatureBar />
          <ErrorBoundary label="multiview"><MainView /></ErrorBoundary>
          <Splitter dir="row" label="Resize the switcher panel" onDrag={dragPanel} onReset={() => useMixerUI.setState({ panelH: Math.round(window.innerHeight * 0.3) })} />
          <div className="shrink-0 border-t border-line bg-[#17181b] overflow-hidden" style={{ height: panelH }}>
            <ErrorBoundary label="switcher">
              {ui.panel === 'mini' ? <FitBox><AtemPanel /></FitBox> : narrow ? <div className="h-full overflow-auto"><SwitcherPanel /></div> : <FitBox><SwitcherPanel /></FitBox>}
            </ErrorBoundary>
          </div>
        </main>
        {!dock && ui.drawer && (
          <>
            <div className="absolute inset-0 z-30 bg-black/40" onClick={() => useMixerUI.setState({ drawer: false })} aria-hidden />
            <aside className="absolute top-0 bottom-0 start-0 z-40 bg-panel border-e border-line flex flex-col shadow-[0_16px_40px_rgba(0,0,0,.55)]" style={{ width: Math.min(360, w - 40) }} aria-label="Switcher palettes">
              <div className="h-[30px] shrink-0 flex items-center px-3 border-b border-line-soft bg-[#202328]"><span className="flex-1 text-xs font-medium text-ink-strong">Inputs & SuperSource</span><button type="button" className="icon-btn" aria-label="Close panel" onClick={() => useMixerUI.setState({ drawer: false })}><LuX size={14} /></button></div>
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"><ErrorBoundary label="palettes"><Palettes /></ErrorBoundary></div>
            </aside>
          </>
        )}
      </div>
      {ui.timeline && (
        <>
          <Splitter dir="row" label="Resize the timeline" onDrag={dragTl} onReset={() => useMixerUI.setState({ tlH: 160 })} />
          <Transport />
          <div className="shrink-0 border-t border-line" style={{ height: tlH }}><ErrorBoundary label="timeline"><PodTimeline /></ErrorBoundary></div>
        </>
      )}
    </div>
  );
}
