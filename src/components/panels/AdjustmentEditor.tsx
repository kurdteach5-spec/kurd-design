import { useEffect, useMemo, useRef, useState } from 'react';
import type { Adjustment, CurvePoints, GradientStop, LevelsChannel, SelectiveColorKey } from '../../types/document';
import { Checkbox, ColorButton, Segmented, Select, Slider } from '../ui/controls';
import { curveLut, gradientLut } from '../../adjustments/process';
import { getEngine } from '../../canvas/engine';
import { ctx2d } from '../../utils/canvas';
import { LuPlus, LuTrash2 } from 'react-icons/lu';

type Ch = 'rgb' | 'r' | 'g' | 'b';
const CH_OPTS: { value: Ch; label: string }[] = [{ value: 'rgb', label: 'RGB' }, { value: 'r', label: 'Red' }, { value: 'g', label: 'Green' }, { value: 'b', label: 'Blue' }];
const CH_COLOR: Record<Ch, string> = { rgb: '#d8dce2', r: '#ff6b6b', g: '#5be38d', b: '#5ea2ff' };

/** Histogram of the current composite (sampled for speed). */
function useHistogram(ch: Ch) {
  return useMemo(() => {
    const c = getEngine()?.composite; const h = new Float32Array(256);
    if (!c || c.width < 2) return h;
    try {
      const step = Math.max(1, Math.floor(Math.sqrt((c.width * c.height) / 250_000)));
      const d = ctx2d(c, true).getImageData(0, 0, c.width, c.height).data;
      for (let y = 0; y < c.height; y += step) for (let x = 0; x < c.width; x += step) {
        const i = (y * c.width + x) * 4; if (!d[i + 3]) continue;
        const v = ch === 'r' ? d[i] : ch === 'g' ? d[i + 1] : ch === 'b' ? d[i + 2] : Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
        h[v]++;
      }
      let max = 0; for (let i = 1; i < 255; i++) max = Math.max(max, h[i]);
      for (let i = 0; i < 256; i++) h[i] = max ? Math.min(1, h[i] / max) : 0;
    } catch { /* ignore */ }
    return h;
  }, [ch]);
}

function Histogram({ ch, height = 60 }: { ch: Ch; height?: number }) {
  const h = useHistogram(ch);
  const d = `M0 ${height} ` + Array.from(h).map((v, i) => `L${i} ${height - v * height}`).join(' ') + ` L255 ${height} Z`;
  return <svg viewBox={`0 0 255 ${height}`} preserveAspectRatio="none" className="w-full block" style={{ height }} aria-hidden><path d={d} fill={CH_COLOR[ch]} opacity={0.35} /></svg>;
}

function CurvesEditor({ points, ch, onChange }: { points: CurvePoints; ch: Ch; onChange: (p: CurvePoints) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const lut = curveLut(points);
  const path = 'M' + Array.from(lut).map((v, i) => `${i} ${255 - v}`).join(' L');
  const toPt = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.round(Math.min(255, Math.max(0, ((e.clientX - r.left) / r.width) * 255))), y: Math.round(Math.min(255, Math.max(0, 255 - ((e.clientY - r.top) / r.height) * 255))) };
  };
  return (
    <div className="relative">
      <div className="absolute inset-0 pointer-events-none"><Histogram ch={ch} height={200} /></div>
      <svg ref={ref} viewBox="-2 -2 259 259" className="w-full aspect-square bg-[#1d2025] rounded-[4px] border border-line touch-none" role="img" aria-label="Curve"
        onPointerDown={(e) => {
          const p = toPt(e);
          let i = points.findIndex((q) => Math.abs(q.x - p.x) < 8 && Math.abs(q.y - p.y) < 12);
          if (i < 0) { const np = [...points, p].sort((a, b) => a.x - b.x); i = np.indexOf(p); onChange(np); }
          setDrag(i); (e.currentTarget as Element).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag === null) return;
          const p = toPt(e);
          const sorted = [...points]; const isEnd = drag === 0 || drag === points.length - 1;
          const minX = drag > 0 ? sorted[drag - 1].x + 1 : 0, maxX = drag < sorted.length - 1 ? sorted[drag + 1].x - 1 : 255;
          // dragging a middle point far outside removes it
          if (!isEnd && (p.y <= 0 || p.y >= 255) && Math.abs(p.x - sorted[drag].x) > 40) { sorted.splice(drag, 1); setDrag(null); onChange(sorted); return; }
          sorted[drag] = { x: Math.min(maxX, Math.max(minX, p.x)), y: p.y };
          onChange(sorted);
        }}
        onPointerUp={() => setDrag(null)}
        onDoubleClick={() => onChange([{ x: 0, y: 0 }, { x: 255, y: 255 }])}>
        {[64, 128, 192].map((v) => <g key={v} stroke="#3a4049" strokeWidth={0.6}><line x1={v} y1={0} x2={v} y2={255} /><line x1={0} y1={v} x2={255} y2={v} /></g>)}
        <line x1={0} y1={255} x2={255} y2={0} stroke="#4a515c" strokeWidth={0.6} strokeDasharray="3 3" />
        <path d={path} fill="none" stroke={CH_COLOR[ch]} strokeWidth={1.6} />
        {points.map((p, i) => <rect key={i} x={p.x - 3.5} y={255 - p.y - 3.5} width={7} height={7} fill={drag === i ? CH_COLOR[ch] : '#1d2025'} stroke={CH_COLOR[ch]} strokeWidth={1.2} />)}
      </svg>
      <div className="text-faint mt-1">Click to add points · drag a point off the graph to remove · double-click to reset</div>
    </div>
  );
}

function LevelsEditor({ ch, value, onChange }: { ch: Ch; value: LevelsChannel; onChange: (v: LevelsChannel) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="bg-[#1d2025] rounded-[4px] border border-line p-1"><Histogram ch={ch} height={70} /></div>
      <Slider label="Input black" value={value.inBlack} min={0} max={253} onChange={(v) => onChange({ ...value, inBlack: Math.min(v, value.inWhite - 2) })} />
      <Slider label="Midtones (gamma)" value={value.gamma} min={0.1} max={9.99} step={0.01} precision={2} onChange={(v) => onChange({ ...value, gamma: v })} />
      <Slider label="Input white" value={value.inWhite} min={2} max={255} onChange={(v) => onChange({ ...value, inWhite: Math.max(v, value.inBlack + 2) })} />
      <Slider label="Output black" value={value.outBlack} min={0} max={255} onChange={(v) => onChange({ ...value, outBlack: v })} />
      <Slider label="Output white" value={value.outWhite} min={0} max={255} onChange={(v) => onChange({ ...value, outWhite: v })} />
    </div>
  );
}

function GradientStopsEditor({ stops, onChange }: { stops: GradientStop[]; onChange: (s: GradientStop[]) => void }) {
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  const lut = gradientLut(sorted);
  const css = `linear-gradient(to right, ${Array.from({ length: 11 }, (_, i) => { const k = Math.round(i * 25.5) * 4; return `rgba(${lut[k]},${lut[k + 1]},${lut[k + 2]},${lut[k + 3] / 255}) ${i * 10}%`; }).join(',')})`;
  return (
    <div className="flex flex-col gap-2">
      <div className="h-5 rounded-[3px] checker border border-line overflow-hidden" dir="ltr"><div className="w-full h-full" style={{ background: css }} /></div>
      {sorted.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <ColorButton label="Stop color" color={s.color} onChange={(c) => onChange(sorted.map((x, j) => (j === i ? { ...x, color: c } : x)))} />
          <input type="range" className="slider flex-1" dir="ltr" min={0} max={100} value={Math.round(s.offset * 100)} aria-label="Stop position" style={{ ['--p' as string]: `${s.offset * 100}%` }}
            onChange={(e) => onChange(sorted.map((x, j) => (j === i ? { ...x, offset: Number(e.target.value) / 100 } : x)))} />
          <span className="num w-8 text-end text-muted">{Math.round(s.offset * 100)}%</span>
          <button type="button" className="icon-btn" aria-label="Remove stop" disabled={sorted.length <= 2} onClick={() => onChange(sorted.filter((_, j) => j !== i))}><LuTrash2 size={13} /></button>
        </div>
      ))}
      <button type="button" className="btn self-start inline-flex items-center gap-1" onClick={() => onChange([...sorted, { offset: 0.5, color: '#808080', opacity: 1 }])}><LuPlus size={13} />Add stop</button>
      <div className="text-faint">Dark tones map to the left color, light tones to the right.</div>
    </div>
  );
}

/** Controls for every adjustment type; used by adjustment layers and Image › Adjustments. */
export function AdjustmentEditor({ value, onChange }: { value: Adjustment; onChange: (a: Adjustment) => void }) {
  const [ch, setCh] = useState<Ch>('rgb');
  const [tone, setTone] = useState<'shadows' | 'midtones' | 'highlights'>('midtones');
  const [sc, setSc] = useState<SelectiveColorKey>('reds');
  useEffect(() => setCh('rgb'), [value.kind]);
  const a = value;
  switch (a.kind) {
    case 'brightness-contrast':
      return <div className="flex flex-col gap-3">
        <Slider label="Brightness" value={a.brightness} min={-150} max={150} onChange={(v) => onChange({ ...a, brightness: v })} />
        <Slider label="Contrast" value={a.contrast} min={-50} max={100} onChange={(v) => onChange({ ...a, contrast: v })} />
      </div>;
    case 'exposure':
      return <div className="flex flex-col gap-3">
        <Slider label="Exposure" value={a.exposure} min={-5} max={5} step={0.01} precision={2} onChange={(v) => onChange({ ...a, exposure: v })} />
        <Slider label="Offset" value={a.offset} min={-0.5} max={0.5} step={0.001} precision={3} onChange={(v) => onChange({ ...a, offset: v })} />
        <Slider label="Gamma" value={a.gamma} min={0.01} max={9.99} step={0.01} precision={2} onChange={(v) => onChange({ ...a, gamma: v })} />
      </div>;
    case 'hue-saturation':
      return <div className="flex flex-col gap-3">
        <Slider label="Hue" value={a.hue} min={-180} max={180} unit="°" onChange={(v) => onChange({ ...a, hue: v })} />
        <Slider label="Saturation" value={a.saturation} min={-100} max={100} onChange={(v) => onChange({ ...a, saturation: v })} />
        <Slider label="Lightness" value={a.lightness} min={-100} max={100} onChange={(v) => onChange({ ...a, lightness: v })} />
        <Checkbox label="Colorize" checked={a.colorize} onChange={(v) => onChange({ ...a, colorize: v, saturation: v && !a.saturation ? 25 : a.saturation, hue: v && !a.hue ? 30 : a.hue })} />
        <div className="h-2 rounded-full" style={{ background: 'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }} />
      </div>;
    case 'vibrance':
      return <div className="flex flex-col gap-3">
        <Slider label="Vibrance" value={a.vibrance} min={-100} max={100} onChange={(v) => onChange({ ...a, vibrance: v })} />
        <Slider label="Saturation" value={a.saturation} min={-100} max={100} onChange={(v) => onChange({ ...a, saturation: v })} />
      </div>;
    case 'levels':
      return <div className="flex flex-col gap-2">
        <Select value={ch} options={CH_OPTS} onChange={setCh} label="Channel" />
        <LevelsEditor ch={ch} value={a[ch]} onChange={(v) => onChange({ ...a, [ch]: v })} />
        <button type="button" className="btn self-start" onClick={() => onChange({ ...a, rgb: auto(), r: { ...a.r }, g: { ...a.g }, b: { ...a.b } })}>Auto</button>
      </div>;
    case 'curves':
      return <div className="flex flex-col gap-2">
        <Select value={ch} options={CH_OPTS} onChange={setCh} label="Channel" />
        <CurvesEditor ch={ch} points={a[ch]} onChange={(p) => onChange({ ...a, [ch]: p })} />
        <div className="flex gap-1.5">
          <button type="button" className="btn" onClick={() => onChange({ ...a, [ch]: [{ x: 0, y: 0 }, { x: 64, y: 50 }, { x: 192, y: 205 }, { x: 255, y: 255 }] })}>Contrast</button>
          <button type="button" className="btn" onClick={() => onChange({ ...a, [ch]: [{ x: 0, y: 0 }, { x: 128, y: 160 }, { x: 255, y: 255 }] })}>Brighten</button>
          <button type="button" className="btn" onClick={() => onChange({ ...a, [ch]: [{ x: 0, y: 0 }, { x: 255, y: 255 }] })}>Reset</button>
        </div>
      </div>;
    case 'color-balance': {
      const arr = a[tone];
      const setv = (i: number, v: number) => { const n = [...arr] as [number, number, number]; n[i] = v; onChange({ ...a, [tone]: n }); };
      return <div className="flex flex-col gap-3">
        <Segmented value={tone} onChange={setTone} options={[{ value: 'shadows', label: 'Shadows', title: 'Shadows' }, { value: 'midtones', label: 'Midtones', title: 'Midtones' }, { value: 'highlights', label: 'Highlights', title: 'Highlights' }]} />
        <Slider label="Cyan ↔ Red" value={arr[0]} min={-100} max={100} onChange={(v) => setv(0, v)} />
        <Slider label="Magenta ↔ Green" value={arr[1]} min={-100} max={100} onChange={(v) => setv(1, v)} />
        <Slider label="Yellow ↔ Blue" value={arr[2]} min={-100} max={100} onChange={(v) => setv(2, v)} />
        <Checkbox label="Preserve luminosity" checked={a.preserveLuminosity} onChange={(v) => onChange({ ...a, preserveLuminosity: v })} />
      </div>;
    }
    case 'black-white':
      return <div className="flex flex-col gap-3">
        {(['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'] as const).map((k) => (
          <Slider key={k} label={k[0].toUpperCase() + k.slice(1)} value={a[k]} min={-200} max={300} unit="%" onChange={(v) => onChange({ ...a, [k]: v })} />
        ))}
        <div className="flex items-center gap-2"><Checkbox label="Tint" checked={a.tint} onChange={(v) => onChange({ ...a, tint: v })} /><ColorButton label="Tint color" color={a.tintColor} onChange={(c) => onChange({ ...a, tintColor: c, tint: true })} /></div>
      </div>;
    case 'gradient-map':
      return <div className="flex flex-col gap-3">
        <GradientStopsEditor stops={a.stops} onChange={(stops) => onChange({ ...a, stops })} />
        <Checkbox label="Reverse" checked={a.reverse} onChange={(v) => onChange({ ...a, reverse: v })} />
      </div>;
    case 'selective-color': {
      const c = a.colors[sc];
      const keys: SelectiveColorKey[] = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks'];
      return <div className="flex flex-col gap-3">
        <Select label="Colors" value={sc} onChange={setSc} options={keys.map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) }))} />
        {(['c', 'm', 'y', 'k'] as const).map((k) => (
          <Slider key={k} label={{ c: 'Cyan', m: 'Magenta', y: 'Yellow', k: 'Black' }[k]} value={c[k]} min={-100} max={100} unit="%" onChange={(v) => onChange({ ...a, colors: { ...a.colors, [sc]: { ...c, [k]: v } } })} />
        ))}
        <Segmented value={a.mode} onChange={(m) => onChange({ ...a, mode: m })} options={[{ value: 'relative', label: 'Relative', title: 'Relative' }, { value: 'absolute', label: 'Absolute', title: 'Absolute' }]} />
      </div>;
    }
    case 'develop': {
      const S = (k: keyof typeof a, label: string, min: number, max: number, step = 1, precision = 0) =>
        <Slider key={k} label={label} value={a[k] as number} min={min} max={max} step={step} precision={precision} onChange={(v) => onChange({ ...a, [k]: v })} />;
      return <div className="flex flex-col gap-3">
        <div className="text-ink-strong font-medium">Light</div>
        {S('exposure', 'Exposure', -4, 4, 0.01, 2)}{S('brightness', 'Brightness', -100, 100)}{S('contrast', 'Contrast', -100, 100)}
        {S('highlights', 'Highlights', -100, 100)}{S('shadows', 'Shadows', -100, 100)}{S('whites', 'Whites', -100, 100)}{S('blacks', 'Blacks', -100, 100)}{S('gamma', 'Gamma', 0.2, 3, 0.01, 2)}
        <div className="text-ink-strong font-medium pt-1">Color</div>
        {S('temperature', 'Temperature', -100, 100)}{S('tint', 'Tint', -100, 100)}{S('vibrance', 'Vibrance', -100, 100)}{S('saturation', 'Saturation', -100, 100)}{S('hue', 'Hue', -180, 180)}
        <div className="text-ink-strong font-medium pt-1">Detail</div>
        {S('clarity', 'Clarity', -100, 100)}{S('sharpness', 'Sharpness', 0, 100)}
      </div>;
    }
    case 'threshold': return <Slider label="Threshold level" value={a.level} min={1} max={255} onChange={(v) => onChange({ ...a, level: v })} />;
    case 'posterize': return <Slider label="Levels" value={a.levels} min={2} max={64} onChange={(v) => onChange({ ...a, levels: v })} />;
    case 'invert': return <div className="text-muted">Inverts every color. No settings.</div>;
  }
}

function auto(): LevelsChannel {
  const c = getEngine()?.composite; const base = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
  if (!c) return base;
  const d = ctx2d(c, true).getImageData(0, 0, c.width, c.height).data; const h = new Uint32Array(256); let n = 0;
  for (let i = 0; i < d.length; i += 16) { if (!d[i + 3]) continue; h[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++; n++; }
  const clip = n * 0.001; let acc = 0, lo = 0, hi = 255;
  for (; lo < 255; lo++) { acc += h[lo]; if (acc > clip) break; }
  acc = 0; for (; hi > 0; hi--) { acc += h[hi]; if (acc > clip) break; }
  return { ...base, inBlack: Math.min(lo, 250), inWhite: Math.max(hi, lo + 4) };
}
