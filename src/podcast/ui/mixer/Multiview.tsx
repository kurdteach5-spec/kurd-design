// Multiview: Preview and Program monitors plus a window per input, like a switcher's multiviewer.
// Layout, window count and the source of every window can be changed; tally (red = on air, green =
// preview), names, audio meters, safe areas and a clock can be switched on and off.
import { useEffect, useRef, useState } from 'react';
import { usePod, segmentAt, inputsOf, allInputsOf } from '../../store';
import { drawInputTo, drawProgramTo, frameListeners, levelOf } from '../../player';
import { liveListeners, liveTrans, setPreview, programCut, activeOverlay, previewOf } from '../../mixer';
import { suggestedInput } from '../../advisor';
import { create } from '../../../state/createStore';
import { longName, shortName } from '../../labels';
import { VIRTUAL, type MvCell, type MvLayout } from '../../types';
import { tcOf } from '../Monitors';
import { CamLabel } from '../SpeakerLabel';

/** sources of the small windows */
export function multiviewWindows(s = usePod.getState()): string[] {
  const rec = inputsOf(s);
  const auto = [...rec, ...VIRTUAL.filter((v) => v !== 'blk')];
  const n = s.multiview.count > 0 ? s.multiview.count : Math.max(4, Math.ceil(rec.length / 4) * 4);
  return Array.from({ length: n }, (_, i) => s.multiview.windows[i] || auto[i] || 'blk');
}

function useRedraw(draw: () => void, deps: unknown[]) {
  useEffect(() => {
    draw();
    frameListeners.add(draw); liveListeners.add(draw);
    const un = usePod.subscribe((s, p) => { if (!s.playing && (s.segments !== p.segments || s.splits !== p.splits || s.previewInput !== p.previewInput || s.time !== p.time || s.output !== p.output || s.overlays !== p.overlays || s.colors !== p.colors || s.mp !== p.mp || s.media !== p.media)) draw(); });
    const t = setInterval(() => { if (!usePod.getState().playing) draw(); }, 700);
    return () => { frameListeners.delete(draw); liveListeners.delete(draw); un(); clearInterval(t); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

function fitCanvas(c: HTMLCanvasElement, max: number) {
  const o = usePod.getState().output;
  const w = Math.min(max, Math.max(160, Math.round(c.clientWidth * (window.devicePixelRatio || 1))));
  const h = Math.round((w * o.height) / o.width);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
}

function decorate(c: HTMLCanvasElement, meterId: string | null, safe: boolean, meters: boolean) {
  const ctx = c.getContext('2d'); if (!ctx) return;
  const W = c.width, H = c.height;
  if (safe) {
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = Math.max(1, W / 640); ctx.setLineDash([W / 80, W / 120]);
    ctx.strokeRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9); ctx.strokeRect(W * 0.1, H * 0.1, W * 0.8, H * 0.8); ctx.restore();
  }
  if (meters && meterId) {
    const lv = levelOf(meterId); if (lv === null) return;
    const bw = Math.max(4, W / 60), x = W - bw - W / 80, top = H * 0.08, hh = H * 0.84;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x - 2, top - 2, bw + 4, hh + 4);
    const g = ctx.createLinearGradient(0, top + hh, 0, top);
    g.addColorStop(0, '#2ecc71'); g.addColorStop(0.7, '#2ecc71'); g.addColorStop(0.85, '#f1c40f'); g.addColorStop(1, '#e74c3c');
    ctx.fillStyle = g; ctx.fillRect(x, top + hh * (1 - lv), bw, hh * lv);
  }
}

/** window name: the typed name, else the camera / SuperSource name (translated role words) or the switcher source name */
function Label({ id, tally }: { id: string; tally: 'pgm' | 'pvw' | null }) {
  const typed = usePod((s) => s.labels[id]?.trim());
  const rec = usePod((s) => s.cameras.some((c) => c.id === id) || s.broll.includes(id));
  return (
    <div className={`absolute left-1/2 -translate-x-1/2 bottom-[4%] max-w-[92%] px-2 py-[1px] text-[11px] leading-[16px] font-semibold text-white truncate rounded-[2px] ${tally === 'pgm' ? 'bg-[#d42020]' : tally === 'pvw' ? 'bg-[#169c3a]' : 'bg-black/70'}`}>
      {typed ? <span translate="no">{typed}</span> : rec ? <CamLabel id={id} /> : longName(id)}
    </div>
  );
}

function InputWindow({ index, src, fill }: { index: number; src?: string; fill?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const id = usePod((s) => src ?? multiviewWindows(s)[index]);
  const mv = usePod((s) => s.multiview);
  const pgm = usePod((s) => segmentAt(s.time, s.segments)?.cam === id || (!!activeOverlay('usk', 1, s.time, s) && s.usk.fill === id));
  const pvw = usePod((s) => previewOf(s) === id);
  const suggested = usePod((s) => s.multiview.tally && suggestedInput(s) === id);
  const name = usePod((s) => longName(id, s));
  const [edit, setEdit] = useState(false);
  const options = usePod((s) => allInputsOf(s));
  useRedraw(() => { const c = ref.current; if (!c) return; fitCanvas(c, 640); drawInputTo(c, id); decorate(c, id, false, usePod.getState().multiview.meters); }, [id]);
  const tally = mv.tally ? (pgm ? 'pgm' : pvw ? 'pvw' : null) : null;
  return (
    <div className={`relative bg-black overflow-hidden group outline outline-2 -outline-offset-2 ${fill ? 'h-full' : ''} ${tally === 'pgm' ? 'outline-[#e02424]' : tally === 'pvw' ? 'outline-[#1fbf3a]' : suggested ? 'outline-[#f0b400]' : 'outline-[#2a2e34]'}`}
      onClick={() => setPreview(id)} onDoubleClick={() => programCut(id)} data-tip="Click: preview · double-click: program">
      <canvas ref={ref} className={fill ? 'block w-full h-full object-contain' : 'block w-full h-auto'} style={fill ? undefined : { aspectRatio: `${usePod.getState().output.width} / ${usePod.getState().output.height}` }} aria-label={name} />
      {mv.labels && <Label id={id} tally={tally} />}
      {suggested && !tally && <div className="absolute right-1 top-1 px-1.5 rounded-[2px] bg-[#f0b400] text-[9px] font-bold" style={{ color: '#000' }}>SUGGESTED</div>}
      {src === undefined && <button type="button" className="absolute top-1 left-1 h-[18px] px-1 rounded-[3px] bg-black/70 text-[10px] text-white opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={(e) => { e.stopPropagation(); setEdit(!edit); }} aria-label="Change window source">{`${index + 1} ▾`}</button>}
      {edit && src === undefined && (
        <select autoFocus className="absolute top-6 left-1 field h-[22px] text-xs max-w-[90%]" value={mv.windows[index] || ''} aria-label="Window source"
          onClick={(e) => e.stopPropagation()} onBlur={() => setEdit(false)}
          onChange={(e) => { const w = [...usePod.getState().multiview.windows]; w[index] = e.target.value; usePod.setState((s) => ({ multiview: { ...s.multiview, windows: w } })); setEdit(false); }}>
          <option value="">Automatic</option>
          {options.map((o) => <option key={o} value={o}>{`${shortName(o)} · ${longName(o)}`}</option>)}
        </select>
      )}
    </div>
  );
}

export function BigWindow({ kind, fill }: { kind: 'pgm' | 'pvw'; fill?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const mv = usePod((s) => s.multiview);
  const id = usePod((s) => (kind === 'pgm' ? segmentAt(s.time, s.segments)?.cam ?? null : previewOf(s)));
  const t = usePod((s) => s.time - (s.analysis?.start ?? 0));
  const fps = usePod((s) => s.settings.fps);
  const playing = usePod((s) => s.playing);
  const ftbOn = usePod((s) => !!activeOverlay('ftb', 1, s.time, s));
  useRedraw(() => {
    const c = ref.current; if (!c) return; fitCanvas(c, 1280);
    const s = usePod.getState();
    if (kind === 'pgm') drawProgramTo(c);
    else if (previewOf(s)) drawInputTo(c, previewOf(s)!);
    else { const ctx = c.getContext('2d'); if (ctx) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height); } }
    const pg = kind === 'pgm' ? segmentAt(s.time, s.segments)?.cam ?? null : null;
    decorate(c, kind === 'pgm' ? (liveTrans?.to ?? pg) : previewOf(s), s.multiview.safe, s.multiview.meters);
  }, [kind]);
  return (
    <div className={`relative bg-black overflow-hidden outline outline-2 -outline-offset-2 ${fill ? 'h-full' : ''} ${kind === 'pgm' ? 'outline-[#e02424]' : 'outline-[#1fbf3a]'}`}>
      <canvas ref={ref} className={fill ? 'block w-full h-full object-contain' : 'block w-full h-auto'} style={fill ? undefined : { aspectRatio: `${usePod.getState().output.width} / ${usePod.getState().output.height}` }} aria-label={kind === 'pgm' ? 'Program' : 'Preview'} />
      <div className={`absolute left-0 top-0 px-2 py-[1px] text-[11px] font-bold text-white ${kind === 'pgm' ? 'bg-[#d42020]' : 'bg-[#169c3a]'}`}>{kind === 'pgm' ? 'PROGRAM' : 'PREVIEW'}</div>
      {kind === 'pgm' && mv.clock && <div className="absolute right-2 top-1 num text-[12px] font-semibold text-white bg-black/60 px-1.5 rounded-[2px]" dir="ltr">{tcOf(t, fps)}</div>}
      {kind === 'pgm' && playing && <div className="absolute right-2 top-7 flex items-center gap-1 text-[10px] font-bold text-white"><span className="w-2 h-2 rounded-full bg-[#ff3b3b] animate-pulse" />REC</div>}
      {kind === 'pgm' && ftbOn && <div className="absolute left-2 top-7 text-[10px] font-bold text-white bg-[#d42020] px-1 rounded-[2px]">FTB</div>}
      {mv.labels && id && <Label id={id} tally={null} />}
    </div>
  );
}

/** a custom layout made from a preset (so it can be changed window by window) */
export function presetToCustom(layout: Exclude<MvLayout, 'custom'>, s = usePod.getState()): { cols: number; cells: MvCell[] } {
  const wins = multiviewWindows(s).map((src) => ({ src, cs: 1, rs: 1 }));
  if (layout === 'pgmBig') return { cols: 3, cells: [{ src: 'pgm', cs: 2, rs: 2 }, { src: 'pvw', cs: 1, rs: 1 }, ...wins] };
  return { cols: 4, cells: [{ src: 'pvw', cs: 2, rs: 2 }, { src: 'pgm', cs: 2, rs: 2 }, ...wins] };
}
export function customOf(s = usePod.getState()) { return s.multiview.custom ?? presetToCustom(s.multiview.layout === 'custom' ? 'classic' : s.multiview.layout, s); }
/** rows of a custom layout (dense packing, like the CSS grid that shows it) */
export function customRows(c: { cols: number; cells: MvCell[] }): number {
  const occ: boolean[][] = [];
  const free = (r: number, col: number, cs: number, rs: number) => { for (let y = r; y < r + rs; y++) for (let x = col; x < col + cs; x++) if (occ[y]?.[x]) return false; return true; };
  let rows = 0;
  for (const cell of c.cells) {
    const cs = Math.min(c.cols, Math.max(1, cell.cs)), rs = Math.max(1, cell.rs);
    for (let r = 0; ; r++) {
      let placed = false;
      for (let col = 0; col + cs <= c.cols; col++) if (free(r, col, cs, rs)) {
        for (let y = r; y < r + rs; y++) { occ[y] = occ[y] ?? []; for (let x = col; x < col + cs; x++) occ[y][x] = true; }
        rows = Math.max(rows, r + rs); placed = true; break;
      }
      if (placed) break;
    }
  }
  return Math.max(1, rows);
}
export const useMvEdit = create<{ on: boolean }>(() => ({ on: false }));
const setCustom = (f: (c: { cols: number; cells: MvCell[] }) => { cols: number; cells: MvCell[] }) =>
  usePod.setState((s) => ({ multiview: { ...s.multiview, layout: 'custom', custom: f(customOf(s)) } }));

function CellEditor({ i }: { i: number }) {
  const c = usePod((s) => customOf(s));
  const options = usePod((s) => allInputsOf(s));
  usePod((s) => s.labels);
  const cell = c.cells[i];
  const upd = (p: Partial<MvCell>) => setCustom((x) => ({ ...x, cells: x.cells.map((q, k) => (k === i ? { ...q, ...p } : q)) }));
  const move = (d: number) => setCustom((x) => { const cells = [...x.cells]; const j = Math.max(0, Math.min(cells.length - 1, i + d)); const [m] = cells.splice(i, 1); cells.splice(j, 0, m); return { ...x, cells }; });
  const B = ({ l, on, children }: { l: string; on: () => void; children: React.ReactNode }) => <button type="button" className="w-[22px] h-[22px] rounded-[4px] bg-black/75 hover:bg-accent text-[12px] leading-none flex items-center justify-center" style={{ color: '#fff' }} aria-label={l} data-tip={l} onClick={(e) => { e.stopPropagation(); on(); }}>{children}</button>;
  return (
    <div className="absolute inset-0 z-10 bg-black/35 flex flex-col items-center justify-center gap-1 p-1" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <select className="field h-[22px] text-xs max-w-[95%]" value={cell.src} aria-label={`Window ${i + 1} source`} onChange={(e) => upd({ src: e.target.value })}>
        <option value="pgm">PROGRAM</option><option value="pvw">PREVIEW</option><option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{`${shortName(o)} · ${longName(o)}`}</option>)}
      </select>
      <div className="flex gap-1 flex-wrap justify-center">
        <B l="Narrower" on={() => upd({ cs: Math.max(1, cell.cs - 1) })}>⇠</B>
        <B l="Wider" on={() => upd({ cs: Math.min(c.cols, cell.cs + 1) })}>⇢</B>
        <B l="Shorter" on={() => upd({ rs: Math.max(1, cell.rs - 1) })}>⇡</B>
        <B l="Taller" on={() => upd({ rs: Math.min(4, cell.rs + 1) })}>⇣</B>
      </div>
      <div className="flex gap-1">
        <B l="Move earlier" on={() => move(-1)}>◀</B>
        <B l="Move later" on={() => move(1)}>▶</B>
        <B l="Remove window" on={() => setCustom((x) => ({ ...x, cells: x.cells.filter((_, k) => k !== i) }))}>✕</B>
      </div>
      <span className="text-[10px] num" style={{ color: '#fff' }}>{`${cell.cs} × ${cell.rs}`}</span>
    </div>
  );
}

function CustomMultiview() {
  const c = usePod((s) => customOf(s));
  const a = usePod((s) => s.output.height / s.output.width);
  const edit = useMvEdit((s) => s.on);
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  useEffect(() => { const el = ref.current; if (!el) return; const go = () => setW(el.clientWidth); go(); const ro = new ResizeObserver(go); ro.observe(el); return () => ro.disconnect(); }, []);
  const gap = 3; const unit = (w - 2 * gap - (c.cols - 1) * gap) / c.cols;
  return (
    <div ref={ref} className="grid bg-[#0b0c0e] p-[3px]" style={{ gap, gridTemplateColumns: `repeat(${c.cols}, minmax(0, 1fr))`, gridAutoRows: Math.max(20, unit * a), gridAutoFlow: 'row dense' }}>
      {c.cells.map((cell, i) => (
        <div key={i} className="relative min-w-0 min-h-0" style={{ gridColumn: `span ${Math.min(c.cols, cell.cs)}`, gridRow: `span ${cell.rs}` }}>
          {cell.src === 'pgm' || cell.src === 'pvw' ? <BigWindow kind={cell.src} fill /> : cell.src ? <InputWindow index={i} src={cell.src} fill /> : <div className="h-full bg-[#15171a] outline outline-1 -outline-offset-1 outline-[#2a2e34]" />}
          {edit && <CellEditor i={i} />}
        </div>
      ))}
      {edit && (
        <button type="button" className="min-h-0 rounded-[3px] border border-dashed border-[#4a515c] text-muted hover:text-ink hover:border-accent text-xs" style={{ gridColumn: 'span 1' }}
          onClick={() => setCustom((x) => ({ ...x, cells: [...x.cells, { src: '', cs: 1, rs: 1 }] }))}>+ Window</button>
      )}
    </div>
  );
}

export function Multiview() {
  const mv = usePod((s) => s.multiview);
  const n = usePod((s) => multiviewWindows(s).length);
  if (mv.layout === 'custom') return <CustomMultiview />;
  const idx = Array.from({ length: n }, (_, i) => i);
  if (mv.layout === 'pgmBig') {
    return (
      <div className="grid gap-[3px] bg-[#0b0c0e] p-[3px]" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <div className="col-span-2 row-span-2"><BigWindow kind="pgm" /></div>
        <div><BigWindow kind="pvw" /></div>
        {idx.slice(0, 1).map((i) => <InputWindow key={i} index={i} />)}
        {idx.slice(1).map((i) => <InputWindow key={i} index={i} />)}
      </div>
    );
  }
  if (mv.layout === 'quad') {
    const q3 = idx.slice(0, 4), q4 = idx.slice(4, 8), rest = idx.slice(8);
    return (
      <div className="flex flex-col gap-[3px] bg-[#0b0c0e] p-[3px]">
        <div className="grid grid-cols-2 gap-[3px]"><BigWindow kind="pvw" /><BigWindow kind="pgm" /></div>
        <div className="grid grid-cols-2 gap-[3px]">
          <div className="grid grid-cols-2 gap-[3px]">{q3.map((i) => <InputWindow key={i} index={i} />)}</div>
          <div className="grid grid-cols-2 gap-[3px]">{q4.map((i) => <InputWindow key={i} index={i} />)}</div>
        </div>
        {rest.length > 0 && <div className="grid grid-cols-4 gap-[3px]">{rest.map((i) => <InputWindow key={i} index={i} />)}</div>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-[3px] bg-[#0b0c0e] p-[3px]">
      <div className="grid grid-cols-2 gap-[3px]"><BigWindow kind="pvw" /><BigWindow kind="pgm" /></div>
      <div className="grid grid-cols-4 gap-[3px]">{idx.map((i) => <InputWindow key={i} index={i} />)}</div>
    </div>
  );
}

/** one input, full size (VIDEO OUT 1…4) */
export function FullInput({ id }: { id: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const name = usePod((s) => longName(id, s));
  const pgm = usePod((s) => segmentAt(s.time, s.segments)?.cam === id);
  const mv = usePod((s) => s.multiview);
  useRedraw(() => { const c = ref.current; if (!c) return; fitCanvas(c, 1280); drawInputTo(c, id); decorate(c, id, usePod.getState().multiview.safe, usePod.getState().multiview.meters); }, [id]);
  return (
    <div className={`relative bg-black overflow-hidden outline outline-2 -outline-offset-2 ${pgm ? 'outline-[#e02424]' : 'outline-[#2a2e34]'}`}>
      <canvas ref={ref} className="block w-full h-auto" style={{ aspectRatio: `${usePod.getState().output.width} / ${usePod.getState().output.height}` }} aria-label={name} />
      {mv.labels && <Label id={id} tally={pgm ? 'pgm' : null} />}
    </div>
  );
}
