import { useEffect, useRef, useState } from 'react';
import { useTools, setForeground, setBackground, recordColor, setOptions, setTool } from '../../state/toolStore';
import { useDocuments, selectActiveDoc, jumpToHistory, selectActiveState, clearHistory } from '../../state/documentStore';
import { ColorPicker } from '../ui/ColorPicker';
import { Checkbox, Segmented, Slider } from '../ui/controls';
import { ADJUSTMENT_KINDS, run } from '../../shortcuts/commands';
import { ADJUSTMENT_LABELS } from '../../layers/factory';
import { formatBytes } from '../../utils/id';
import { brushStamp } from '../../tools/brushEngine';
import { ctx2d } from '../../utils/canvas';
import { findLayer } from '../../layers/tree';
import { TextFields } from '../editor/OptionsBar';
import { ParagraphFields } from './PropertiesPanel';
import type { AdjustmentKind, TextLayer } from '../../types/document';
import {
  LuSun, LuChartLine, LuChartColumn, LuAperture, LuPalette, LuSparkle, LuScale, LuContrast, LuBlend, LuDroplets, LuEclipse, LuSquareStack, LuLayers2, LuSlidersHorizontal, LuPlus, LuTrash2, LuHistory,
} from 'react-icons/lu';

export function ColorPanel() {
  const fg = useTools((s) => s.foreground), bg = useTools((s) => s.background), history = useTools((s) => s.colorHistory);
  const [which, setWhich] = useState<'fg' | 'bg'>('fg');
  const target = { current: which };
  const commitTimer = useRef(0);
  return (
    <div className="p-3 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button type="button" className="w-7 h-7 rounded-[4px] border-2" style={{ background: fg, borderColor: target.current === 'fg' ? '#4f8cff' : '#4a515c' }} aria-label="Edit foreground color" onClick={() => setWhich('fg')} />
        <button type="button" className="w-7 h-7 rounded-[4px] border-2" style={{ background: bg, borderColor: target.current === 'bg' ? '#4f8cff' : '#4a515c' }} aria-label="Edit background color" onClick={() => setWhich('bg')} />
        <span className="text-muted">Editing {target.current === 'fg' ? 'foreground' : 'background'}</span>
      </div>
      <ColorPicker color={target.current === 'fg' ? fg : bg} onChange={(c) => {
        if (target.current === 'fg') setForeground(c, false); else setBackground(c, false);
        clearTimeout(commitTimer.current); commitTimer.current = window.setTimeout(() => recordColor(c), 700);
      }} />
      {history.length > 0 && (
        <div>
          <div className="text-muted mb-1.5">Recent colors</div>
          <div className="flex flex-wrap gap-1">
            {history.map((c) => <button type="button" key={c} className="w-5 h-5 rounded-[3px] border border-[#4a515c]" style={{ background: c }} aria-label={c} data-tip={c.toUpperCase()} onClick={() => setForeground(c)} onContextMenu={(e) => { e.preventDefault(); setBackground(c); }} />)}
          </div>
        </div>
      )}
    </div>
  );
}

export function SwatchesPanel() {
  const swatches = useTools((s) => s.swatches); const fg = useTools((s) => s.foreground);
  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(22px,1fr))] gap-1">
        {swatches.map((c, i) => (
          <button type="button" key={`${c}${i}`} className="aspect-square rounded-[3px] border border-[#4a515c] hover:scale-110 transition-transform" style={{ background: c }}
            aria-label={`Swatch ${c}`} data-tip={`${c.toUpperCase()} · right-click for background, Alt-click to remove`}
            onClick={(e) => { if (e.altKey) useTools.setState((s) => ({ swatches: s.swatches.filter((_, j) => j !== i) })); else setForeground(c); }}
            onContextMenu={(e) => { e.preventDefault(); setBackground(c); }} />
        ))}
      </div>
      <button type="button" className="btn self-start inline-flex items-center gap-1" onClick={() => useTools.setState((s) => ({ swatches: s.swatches.includes(fg) ? s.swatches : [...s.swatches, fg] }))}>
        <LuPlus size={13} />Add foreground color
      </button>
    </div>
  );
}

export function HistoryPanel() {
  const doc = useDocuments(selectActiveDoc);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' }); }, [doc?.historyIndex, doc?.history.length]);
  if (!doc) return <div className="p-4 text-muted">No document open.</div>;
  const total = doc.history.reduce((a, h) => a + h.bytes, 0);
  return (
    <div className="flex flex-col h-full min-h-0">
      <div ref={list} className="flex-1 min-h-0 overflow-y-auto py-1" role="listbox" aria-label="History">
        {doc.history.map((h, i) => (
          <div key={h.id} role="option" aria-selected={i === doc.historyIndex} aria-current={i === doc.historyIndex}
            className={`flex items-center gap-2 h-7 px-3 cursor-default ${i === doc.historyIndex ? 'bg-[#2f4670] text-ink-strong' : i > doc.historyIndex ? 'text-faint hover:bg-hover' : 'hover:bg-hover'}`}
            onClick={() => jumpToHistory(i)}>
            <LuHistory size={12} className="text-muted shrink-0" />
            <span className="truncate flex-1">{h.label}</span>
            {h.id === doc.savedEntryId && <span className="text-2xs text-ok">saved</span>}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 px-3 h-9 border-t border-line-soft text-faint">
        <span className="flex-1 num">{`${doc.history.length} states · ${formatBytes(total)}`}</span>
        <button type="button" className="icon-btn" aria-label="Clear history" data-tip="Clear history (keeps the current state)" onClick={() => clearHistory()}><LuTrash2 size={14} /></button>
      </div>
    </div>
  );
}

const ADJ_ICONS: Record<AdjustmentKind, (p: { size?: number }) => React.ReactNode> = {
  'develop': LuSlidersHorizontal, 'brightness-contrast': LuSun, 'levels': LuChartColumn, 'curves': LuChartLine, 'exposure': LuAperture,
  'hue-saturation': LuPalette, 'vibrance': LuSparkle, 'color-balance': LuScale, 'black-white': LuContrast, 'gradient-map': LuBlend,
  'selective-color': LuDroplets, 'invert': LuEclipse, 'threshold': LuSquareStack, 'posterize': LuLayers2,
};

export function AdjustmentsPanel() {
  const hasDoc = useDocuments((s) => !!s.activeId);
  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="text-muted">Add a non-destructive adjustment layer:</div>
      <div className="grid grid-cols-4 gap-1">
        {ADJUSTMENT_KINDS.map((k) => {
          const Icon = ADJ_ICONS[k];
          return (
            <button type="button" key={k} disabled={!hasDoc} className="icon-btn !w-full !h-10 flex-col gap-0.5" aria-label={ADJUSTMENT_LABELS[k]} data-tip={ADJUSTMENT_LABELS[k]} onClick={() => run(`adjlayer.${k}`)}>
              <Icon size={17} />
            </button>
          );
        })}
      </div>
      <div className="text-faint">Adjustment layers affect everything below them. Clip one to a layer (Ctrl/Cmd+Alt+G) to affect only that layer.</div>
    </div>
  );
}

function BrushPreview({ size, hardness }: { size: number; hardness: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const x = ctx2d(c); x.clearRect(0, 0, c.width, c.height);
    const d = Math.min(56, size); const stamp = brushStamp(d, hardness);
    // a short preview stroke
    x.globalAlpha = 0.9;
    for (let t = 0; t <= 1; t += 0.02) {
      const px = 20 + t * (c.width - 40), py = c.height / 2 + Math.sin(t * Math.PI * 2) * 14;
      const tc = document.createElement('canvas'); tc.width = stamp.width; tc.height = stamp.height; const tx = ctx2d(tc);
      tx.drawImage(stamp, 0, 0); tx.globalCompositeOperation = 'source-in'; tx.fillStyle = '#e8ebef'; tx.fillRect(0, 0, tc.width, tc.height);
      x.drawImage(tc, px - stamp.width / 2, py - stamp.height / 2);
    }
  }, [size, hardness]);
  return <canvas ref={ref} width={240} height={70} className="w-full h-[70px] bg-[#1d2025] rounded-[4px] border border-line" aria-hidden />;
}

export function BrushPanel() {
  const tool = useTools((s) => s.tool);
  const o = useTools((s) => s.options);
  const key = tool === 'eraser' ? 'eraser' : tool === 'clone-stamp' ? 'clone' : 'brush';
  const b = o[key] as { size: number; hardness: number; opacity: number; flow: number };
  const presets = [{ size: 3, hardness: 1 }, { size: 9, hardness: 1 }, { size: 24, hardness: 0.8 }, { size: 45, hardness: 0.5 }, { size: 90, hardness: 0 }, { size: 200, hardness: 0 }];
  return (
    <div className="p-3 flex flex-col gap-3">
      {!['brush', 'eraser', 'clone-stamp'].includes(tool) && (
        <div className="flex items-center gap-2 text-muted">Showing Brush settings. <button className="btn" onClick={() => setTool('brush')}>Select Brush</button></div>
      )}
      <div className="grid grid-cols-6 gap-1">
        {presets.map((p, i) => (
          <button type="button" key={i} className="icon-btn !w-full !h-9" aria-label={`${p.size}px brush, ${Math.round(p.hardness * 100)}% hard`} data-tip={`${p.size}px · ${Math.round(p.hardness * 100)}% hard`}
            onClick={() => setOptions(key, { size: p.size, hardness: p.hardness })}>
            <span className="rounded-full block" style={{ width: Math.min(22, 4 + p.size / 9), height: Math.min(22, 4 + p.size / 9), background: `radial-gradient(circle, #e8ebef ${p.hardness * 70}%, transparent 72%)` }} />
          </button>
        ))}
      </div>
      <BrushPreview size={b.size} hardness={b.hardness} />
      <Slider label="Size" value={b.size} min={1} max={500} unit="px" onChange={(v) => setOptions(key, { size: v })} />
      <Slider label="Hardness" value={Math.round(b.hardness * 100)} min={0} max={100} unit="%" onChange={(v) => setOptions(key, { hardness: v / 100 })} />
      <Slider label="Opacity" value={Math.round(b.opacity * 100)} min={1} max={100} unit="%" onChange={(v) => setOptions(key, { opacity: v / 100 })} />
      <Slider label="Flow" value={Math.round(b.flow * 100)} min={1} max={100} unit="%" onChange={(v) => setOptions(key, { flow: v / 100 })} />
      {key === 'brush' && <>
        <Slider label="Spacing" value={Math.round(o.brush.spacing * 100)} min={2} max={200} unit="%" onChange={(v) => setOptions('brush', { spacing: v / 100 })} />
        <Slider label="Smoothing" value={Math.round(o.brush.smoothing * 100)} min={0} max={100} unit="%" onChange={(v) => setOptions('brush', { smoothing: v / 100 })} />
        <div className="flex flex-col gap-1.5">
          <Checkbox label="Pen pressure controls size" checked={o.brush.pressureSize} onChange={(v) => setOptions('brush', { pressureSize: v })} />
          <Checkbox label="Pen pressure controls opacity" checked={o.brush.pressureOpacity} onChange={(v) => setOptions('brush', { pressureOpacity: v })} />
        </div>
      </>}
    </div>
  );
}

export function CharacterPanel() {
  return (
    <div className="p-3 flex flex-wrap gap-2 items-center">
      <TextFields />
      <div className="w-full text-faint">Applies to the selected text layer, or sets defaults for new text.</div>
    </div>
  );
}

export function ParagraphPanel() {
  const st = useDocuments(selectActiveState);
  const l = st ? findLayer(st.layers, st.activeLayerId) : null;
  return <div className="p-3"><ParagraphFields layer={l?.type === 'text' ? (l as TextLayer) : null} /></div>;
}

export { Segmented };
