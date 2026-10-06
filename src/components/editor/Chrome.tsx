import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { useDocuments, selectActiveDoc, selectActiveState, isDirty, setActiveDocument } from '../../state/documentStore';
import { useCursor, useUI } from '../../state/uiStore';
import { useTools } from '../../state/toolStore';
import { getEngine, MIN_ZOOM, MAX_ZOOM } from '../../canvas/engine';
import { requestClose } from '../../editor/fileActions';
import { toolLabel } from '../../tools/registry';
import { allLayers } from '../../layers/tree';
import { formatBytes } from '../../utils/id';
import { openDialog } from '../../state/uiStore';
import { LuX, LuPlus, LuCircleAlert, LuCircleCheck, LuInfo, LuTriangleAlert, LuRotateCcw } from 'react-icons/lu';

export function DocumentTabs() {
  const order = useDocuments((s) => s.order);
  const docs = useDocuments((s) => s.docs);
  const activeId = useDocuments((s) => s.activeId);
  const showHome = useUI((s) => s.showHome);
  return (
    <div className="flex items-end h-full gap-px overflow-x-auto overflow-y-hidden" role="tablist" aria-label="Open documents">
      {order.map((id) => {
        const d = docs[id]; if (!d) return null;
        const st = d.history[d.historyIndex].state; const on = id === activeId && !showHome;
        const z = Math.round((d.view.zoom || 1) * 100);
        return (
          <div key={id} role="tab" aria-selected={on} tabIndex={0}
            className={`group flex items-center gap-2 h-[28px] pl-3 pr-1.5 rounded-t-[5px] cursor-default shrink-0 max-w-[260px] ${on ? 'bg-surround text-ink-strong' : 'bg-[#22262b] text-muted hover:text-ink'}`}
            onClick={() => { setActiveDocument(id); useUI.setState({ showHome: false }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { setActiveDocument(id); useUI.setState({ showHome: false }); } }}
            onAuxClick={(e) => { if (e.button === 1) requestClose(id); }}>
            <span className="truncate">{d.name}</span>
            <span className="text-faint num shrink-0">{z}% · {st.colorMode === 'rgb' ? 'RGB' : 'Gray'}</span>
            <button type="button" className="w-5 h-5 rounded-[3px] flex items-center justify-center hover:bg-hover shrink-0" aria-label={`Close ${d.name}`} onClick={(e) => { e.stopPropagation(); requestClose(id); }}>
              {isDirty(d) ? <span className="w-2 h-2 rounded-full bg-amber group-hover:hidden" aria-label="Unsaved changes" /> : null}
              <LuX size={12} className={isDirty(d) ? 'hidden group-hover:block' : ''} />
            </button>
          </div>
        );
      })}
      <button type="button" className="icon-btn mb-0.5 ml-1" aria-label="New document" data-tip="New document" onClick={() => openDialog({ type: 'new-document' })}><LuPlus size={14} /></button>
    </div>
  );
}

export function StatusBar() {
  const doc = useDocuments(selectActiveDoc);
  const st = useDocuments(selectActiveState);
  const cursor = useCursor();
  const tool = useTools((s) => s.tool);
  const [zoomText, setZoomText] = useState('');
  const zoom = doc ? Math.round((doc.view.zoom || 1) * 1000) / 10 : 100;
  useEffect(() => setZoomText(`${zoom}%`), [zoom]);
  if (!doc || !st) return <div className="flex items-center h-full px-3 text-faint">Ready</div>;
  const layers = allLayers(st.layers).length;
  const mem = st.width * st.height * 4;
  return (
    <div className="flex items-center h-full gap-4 px-2 text-muted num whitespace-nowrap overflow-hidden">
      <input className="field h-[20px] w-[64px] text-right" value={zoomText} aria-label="Zoom level"
        onChange={(e) => setZoomText(e.target.value)} onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setZoomText(`${zoom}%`); e.currentTarget.blur(); } }}
        onBlur={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) getEngine()?.zoomAt(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v / 100))); else setZoomText(`${zoom}%`); }} />
      <span data-tip="Canvas size">{st.width} × {st.height} px · {st.dpi} ppi</span>
      <span className="w-[120px]" data-tip="Cursor position">{cursor.x !== null ? `X ${cursor.x}  Y ${cursor.y}` : 'X –  Y –'}</span>
      <span className="hidden md:inline">{layers} {layers === 1 ? 'layer' : 'layers'} · {formatBytes(mem)}</span>
      {st.selection && <span className="hidden lg:inline text-[#9cc0ff]">Selection {Math.round(st.selection.bounds.w)} × {Math.round(st.selection.bounds.h)}</span>}
      {doc.view.rotation !== 0 && (
        <button type="button" className="inline-flex items-center gap-1 text-amber hover:text-ink" onClick={() => getEngine()?.rotateView(0, true)} aria-label="Reset view rotation">
          <LuRotateCcw size={12} />{Math.round(doc.view.rotation)}°
        </button>
      )}
      <div className="flex-1" />
      <span className="hidden sm:inline text-faint">{toolLabel(tool)}</span>
    </div>
  );
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const busy = useUI((s) => s.busy);
  const icon = { info: <LuInfo size={15} className="text-accent" />, success: <LuCircleCheck size={15} className="text-ok" />, error: <LuCircleAlert size={15} className="text-danger" />, warning: <LuTriangleAlert size={15} className="text-amber" /> };
  return (
    <>
      <div className="fixed bottom-9 left-1/2 -translate-x-1/2 z-[950] flex flex-col items-center gap-1.5 pointer-events-none" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="flex items-center gap-2 bg-[#2a2f36] border border-[#434a54] rounded-[6px] px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,.45)] text-ink-strong max-w-[520px]" style={{ animation: 'menu-in 120ms ease-out' }}>
            {icon[t.kind]}<span>{t.message}</span>
          </div>
        ))}
      </div>
      {busy && (
        <div className="fixed inset-0 z-[940] flex items-center justify-center bg-black/25" role="progressbar" aria-label={busy.label} aria-valuenow={busy.progress !== null ? Math.round(busy.progress * 100) : undefined}>
          <div className="bg-panel border border-line rounded-[8px] px-5 py-4 w-[300px] shadow-[0_16px_40px_rgba(0,0,0,.5)]">
            <div className="text-ink-strong mb-2.5">{busy.label}</div>
            <div className="h-1.5 rounded-full bg-[#1d2025] overflow-hidden">
              {busy.progress !== null
                ? <div className="h-full bg-accent transition-[width] duration-150" style={{ width: `${Math.round(busy.progress * 100)}%` }} />
                : <div className="h-full w-1/3 bg-accent rounded-full" style={{ animation: 'busy 1.1s ease-in-out infinite' }} />}
            </div>
          </div>
          <style>{'@keyframes busy{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}'}</style>
        </div>
      )}
    </>
  );
}

/** Keeps a crash in one part of the UI from taking down the editor. */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  constructor(props: { children: ReactNode; label: string }) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(`[${this.props.label}]`, error, info.componentStack); }
  render() {
    if (this.state.error) {
      return (
        <div className="p-4 flex flex-col gap-2 text-muted">
          <div className="text-ink-strong">The {this.props.label} hit an error.</div>
          <div className="text-faint text-2xs break-words">{this.state.error.message}</div>
          <button type="button" className="btn self-start" onClick={() => this.setState({ error: null })}>Reload {this.props.label}</button>
        </div>
      );
    }
    return this.props.children;
  }
}
