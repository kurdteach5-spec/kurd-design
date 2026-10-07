import { useEffect, useRef, useState } from 'react';
import { Engine } from '../../canvas/engine';
import { useUI, toastError } from '../../state/uiStore';
import { useDocuments } from '../../state/documentStore';
import { TextEditorOverlay } from './TextEditorOverlay';
import { importAsLayers } from '../../editor/fileActions';
import { commit } from '../../state/documentStore';
import { uid } from '../../utils/id';
import { LuImagePlus } from 'react-icons/lu';
import '../../tools/registry';

const RULER = 18;

export function Viewport() {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const top = useRef<HTMLCanvasElement>(null);
  const left = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [cursor, setCursor] = useState('default');
  const showRulers = useUI((s) => s.showRulers);
  const drop = useUI((s) => s.dropActive);
  const hasDoc = useDocuments((s) => !!s.activeId);
  const [guidePreview, setGuidePreview] = useState<{ o: 'h' | 'v'; screen: number } | null>(null);

  useEffect(() => {
    const engine = new Engine(canvas.current!);
    engineRef.current = engine;
    engine.rulerTop = top.current; engine.rulerLeft = left.current;
    engine.onCursorChange = setCursor;
    const el = host.current!;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); engine.resize(Math.floor(r.width), Math.floor(r.height)); engine.sizeRulers(); engine.drawRulers(); });
    ro.observe(el);
    const c = canvas.current!;
    const down = (e: PointerEvent) => { if (e.button === 2) return; c.setPointerCapture(e.pointerId); el.focus({ preventScroll: true }); engine.handleDown(e); };
    const move = (e: PointerEvent) => engine.handleMove(e);
    const up = (e: PointerEvent) => { if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId); engine.handleUp(e); };
    const wheel = (e: WheelEvent) => engine.handleWheel(e);
    const dbl = (e: MouseEvent) => engine.handleDoubleClick(e);
    const leave = () => engine.handleLeave();
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move); c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    // keep focus where tools put it (e.g. the on-canvas text editor) and avoid text selection
    const md = (e: MouseEvent) => e.preventDefault();
    c.addEventListener('mousedown', md);
    c.addEventListener('dblclick', dbl); c.addEventListener('pointerleave', leave);
    el.addEventListener('wheel', wheel, { passive: false });
    // stop the browser from interpreting stylus/touch as scroll
    c.style.touchAction = 'none';
    return () => {
      ro.disconnect(); engine.destroy();
      c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up);
      c.removeEventListener('mousedown', md); c.removeEventListener('dblclick', dbl); c.removeEventListener('pointerleave', leave); el.removeEventListener('wheel', wheel);
    };
  }, []);

  useEffect(() => { const e = engineRef.current; if (e) requestAnimationFrame(() => { e.sizeRulers(); e.drawRulers(); }); }, [showRulers]);

  // Drag guides out of the rulers
  const startGuide = (o: 'h' | 'v') => (e: React.PointerEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current; if (!engine?.state) return;
    const el = e.currentTarget; el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => { const p = engine.clientToScreen(ev.clientX, ev.clientY); setGuidePreview({ o, screen: o === 'v' ? p.x : p.y }); };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
      setGuidePreview(null);
      const p = engine.clientToScreen(ev.clientX, ev.clientY);
      if (p.x < 0 || p.y < 0 || p.x > engine.width || p.y > engine.height) return;
      const d = engine.screenToDoc(p);
      const pos = Math.round(o === 'v' ? d.x : d.y);
      commit((s) => ({ ...s, guides: [...s.guides, { id: uid('g'), orientation: o, pos }] }), { history: 'New Guide' });
      if (!useUI.getState().showGuides) useUI.setState({ showGuides: true });
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation(); useUI.setState({ dropActive: false });
    const files = [...e.dataTransfer.files];
    if (files.length) { await importAsLayers(files); return; }
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (url && /^https?:\/\//.test(url)) {
      try {
        const res = await fetch(url); const blob = await res.blob();
        await importAsLayers([new File([blob], url.split('/').pop()?.split('?')[0] || 'Image', { type: blob.type })]);
      } catch { toastError('Unable to load that image. Download it first, then drag the file in.'); }
    }
  };

  return (
    <div dir="ltr" className="relative w-full h-full grid bg-surround" style={{ gridTemplateColumns: showRulers ? `${RULER}px 1fr` : '0 1fr', gridTemplateRows: showRulers ? `${RULER}px 1fr` : '0 1fr' }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!useUI.getState().dropActive) useUI.setState({ dropActive: true }); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) useUI.setState({ dropActive: false }); }}
      onDrop={onDrop}>
      <div className="bg-[#1b1d21] border-r border-b border-line" />
      <canvas ref={top} className="w-full h-full cursor-s-resize" style={{ visibility: showRulers ? 'visible' : 'hidden' }} onPointerDown={startGuide('h')} aria-hidden />
      <canvas ref={left} className="w-full h-full cursor-e-resize" style={{ visibility: showRulers ? 'visible' : 'hidden' }} onPointerDown={startGuide('v')} aria-hidden />
      <div ref={host} className="relative overflow-hidden outline-none focus-visible:outline-none" style={{ cursor, outline: 'none' }} tabIndex={-1} aria-label="Canvas">
        <canvas ref={canvas} className="absolute left-0 top-0 block" role="img" aria-label="Document canvas" />
        <TextEditorOverlay />
        {guidePreview && (
          <div className="absolute pointer-events-none bg-[#19d3ff]" style={guidePreview.o === 'v' ? { left: guidePreview.screen, top: 0, bottom: 0, width: 1 } : { top: guidePreview.screen, left: 0, right: 0, height: 1 }} />
        )}
        {drop && (
          <div className="absolute inset-3 rounded-[10px] border-2 border-dashed border-accent bg-accent/10 flex items-center justify-center pointer-events-none z-20">
            <div className="flex flex-col items-center gap-2 text-ink-strong bg-panel/90 px-6 py-4 rounded-lg border border-line">
              <LuImagePlus size={28} className="text-accent" />
              <div className="font-medium text-sm">{hasDoc ? 'Drop to add as new layers' : 'Drop to open'}</div>
              <div className="text-muted">PNG, JPG, WEBP, SVG, GIF, BMP, TIFF, PSD</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
