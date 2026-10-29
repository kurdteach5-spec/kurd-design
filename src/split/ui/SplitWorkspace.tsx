// Split Screen section: pick how many windows you need and see every ready layout for that number; choose
// the part of the 1920×1080 screen they must stay in; fill the windows with pictures, videos or cameras;
// move and resize windows to make your own; save them; export the screen or a see-through frame.
import { useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as RPointerEvent, type DragEvent as RDragEvent } from 'react';
import { LAYOUTS, COUNTS, FAMILIES, type Box, type Layout } from '../layouts';
import { useSplit, setStyle, chooseLayout, setBoxes, setContent, setLabel, saveMine, deleteMine, defaultStyle, areaPx, boxPx, defaultLabel, slantPoints, circleOf, goodLayout, type Area, type SplitStyle } from '../store';
import { renderSplit, toBlob } from '../render';
import { saveBlob } from '../../file-system/exporters';
import { toast, toastError } from '../../state/uiStore';
import { tr } from '../../i18n';
import { useWindowSize } from '../../utils/useWindowSize';
import {
  LuMove, LuSquareDashed, LuPlus, LuTrash2, LuRotateCcw, LuSave, LuDownload, LuImage, LuVideo, LuCamera, LuX, LuChevronDown, LuFileJson, LuScanLine,
} from 'react-icons/lu';

const C = { bg: '#0b0b14', panel: '#0f0f1a', raised: '#1a1a2a', line: '#27273d', ink: '#e4e4f0', sub: '#9b9bb4', faint: '#62627e', accent: '#7c5cff', cyan: '#22d3ee' };
const inputStyle = { height: 30, padding: '0 8px', background: C.raised, border: `1px solid ${C.line}`, borderRadius: 7, color: C.ink, fontSize: 12.5, width: '100%', minWidth: 0 } as const;
const AREA_PRESETS: { name: string; area: Area | null }[] = [
  { name: 'Whole screen', area: null },
  { name: 'TV band (top & bottom free)', area: { x: 0, y: 0.13, w: 1, h: 0.72 } },
  { name: 'Above the lower third', area: { x: 0.03, y: 0.05, w: 0.94, h: 0.7 } },
  { name: 'Centred with margins', area: { x: 0.05, y: 0.08, w: 0.9, h: 0.84 } },
  { name: 'Left side (logo right)', area: { x: 0.02, y: 0.1, w: 0.78, h: 0.8 } },
];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const snap = (v: number) => Math.round(v * 96) / 96;

export function SplitWorkspace() {
  const { w } = useWindowSize();
  const narrow = w < 1100;
  const [tab, setTab] = useState<'layouts' | 'screen' | 'style'>('screen');
  const layouts = <LayoutGallery />;
  const style = <StylePanel />;
  return (
    <div className="h-full flex flex-col min-h-0" style={{ background: C.bg, color: C.ink }} data-section="split">
      <CountBar />
      {narrow && (
        <div className="shrink-0 flex gap-1 p-2 border-b" style={{ borderColor: C.line }}>
          {([['layouts', 'Layouts'], ['screen', 'Screen'], ['style', 'Style']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className="flex-1 h-8 rounded-lg text-[13px] font-semibold" style={{ background: tab === k ? `${C.accent}33` : 'transparent', color: tab === k ? '#fff' : C.sub }}>{l}</button>
          ))}
        </div>
      )}
      <div className="flex-1 min-h-0 flex">
        {(!narrow || tab === 'layouts') && <aside className={`${narrow ? 'flex-1' : 'w-[300px] border-e'} shrink-0 min-h-0 overflow-y-auto`} style={{ borderColor: C.line, background: C.panel }} aria-label="Layouts">{layouts}</aside>}
        {(!narrow || tab === 'screen') && <Stage />}
        {(!narrow || tab === 'style') && <aside className={`${narrow ? 'flex-1' : 'w-[320px] border-s'} shrink-0 min-h-0 overflow-y-auto`} style={{ borderColor: C.line, background: C.panel }} aria-label="Look">{style}</aside>}
      </div>
    </div>
  );
}

// ---------------- how many windows ----------------
function CountBar() {
  const count = useSplit((s) => s.count);
  const family = useSplit((s) => s.family);
  return (
    <div className="shrink-0 flex items-center gap-2 px-2 sm:px-3 h-[50px] border-b" style={{ borderColor: C.line, background: C.panel }}>
      <span className="text-[12.5px] font-semibold shrink-0 hidden sm:inline" style={{ color: C.sub }}>Windows</span>
      <div className="flex-1 min-w-0 flex gap-1 overflow-x-auto no-scrollbar" role="radiogroup" aria-label="How many windows">
        {(['all', ...COUNTS] as const).map((n) => (
          <button key={n} type="button" role="radio" aria-checked={count === n} onClick={() => useSplit.setState({ count: n })}
            className="h-8 min-w-[34px] px-2 rounded-lg text-[13px] font-bold tabular-nums shrink-0 border"
            style={{ borderColor: count === n ? C.accent : C.line, background: count === n ? C.accent : 'transparent', color: count === n ? '#fff' : C.ink }}>{n === 'all' ? tr('All') : n}</button>
        ))}
      </div>
      <select value={family} onChange={(e) => useSplit.setState({ family: e.target.value })} style={{ ...inputStyle, width: 170, height: 32 }} aria-label="Kind of layout">
        <option value="all">{tr('Every kind')}</option>
        {FAMILIES.map((f) => <option key={f} value={f}>{tr(f)}</option>)}
      </select>
    </div>
  );
}

// ---------------- gallery ----------------
function Thumb({ boxes, style, active }: { boxes: Box[]; style: SplitStyle; active: boolean }) {
  const W = style.width, H = style.height;
  const A = areaPx(style);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full block rounded-md" style={{ aspectRatio: `${W} / ${H}`, background: `linear-gradient(120deg, ${style.bg1}, ${style.bg2})`, outline: active ? `3px solid ${C.accent}` : 'none', outlineOffset: 2 }} aria-hidden>
      <rect x={A.x} y={A.y} width={A.w} height={A.h} fill="none" stroke="#ffffff33" strokeDasharray="18 12" strokeWidth={6} />
      {boxes.map((b, i) => {
        const p = boxPx(b, { ...style, gap: Math.max(style.gap, 14) });
        const fill = b.role === 'host' ? style.hostColor : b.role === 'main' ? style.mainColor : '#cbd5e1';
        if (b.shape === 'circle') { const c = circleOf(p); return <circle key={i} cx={c.x + c.w / 2} cy={c.y + c.h / 2} r={c.w / 2} fill={fill} stroke="#fff" strokeWidth={8} />; }
        const pts = slantPoints(b, p);
        if (pts) return <polygon key={i} points={pts.map(([x, y]) => `${p.x + x},${p.y + y}`).join(' ')} fill={fill} opacity={b.role === 'guest' ? 0.85 : 1} />;
        return <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={Math.min(style.radius, 30)} fill={fill} opacity={b.role === 'guest' ? 0.85 : 1} stroke={b.float ? '#fff' : 'none'} strokeWidth={6} />;
      })}
    </svg>
  );
}

function LayoutGallery() {
  const { count, family, layout, style, mine, showAll } = useSplit();
  const base = useMemo(() => [...mine, ...LAYOUTS].filter((l) => (count === 'all' || l.n === count) && (family === 'all' || l.family === family)), [count, family, mine]);
  const list = useMemo(() => (showAll ? base : base.filter((l) => l.family === 'Mine' || goodLayout(l.boxes, style))), [base, showAll, style]);
  const hidden = base.length - list.length;
  const groups = useMemo(() => { const m = new Map<string, Layout[]>(); for (const l of list) { const k = count === 'all' ? `${l.n}` : l.family; if (!m.has(k)) m.set(k, []); m.get(k)!.push(l); } return [...m.entries()]; }, [list, count]);
  return (
    <div className="p-3 pb-10">
      <div className="text-[12px] mb-2 flex items-center gap-2" style={{ color: C.faint }}><span className="flex-1">{tr('{0} layouts', list.length)}{count !== 'all' ? ` · ${tr('{0} windows', count)}` : ''}</span>
        {(hidden > 0 || showAll) && <button type="button" onClick={() => useSplit.setState({ showAll: !showAll })} className="underline" data-tip="Layouts with thin or small windows for this area are hidden">{showAll ? tr('Hide thin ones') : tr('+{0} thin ones', hidden)}</button>}
      </div>
      {!list.length && <div className="text-[13px] py-8 text-center" style={{ color: C.sub }}>No layout of this kind for this number of windows.</div>}
      {groups.map(([g, ls]) => (
        <section key={g} className="mb-4">
          <h3 className="m-0 mb-2 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: C.faint }}>{count === 'all' ? tr('{0} windows', g) : tr(g)}</h3>
          <div className="grid grid-cols-2 gap-2.5">
            {ls.map((l) => (
              <div key={l.id} className="relative group">
                <button type="button" onClick={() => chooseLayout(l)} className="block w-full text-start" aria-label={`${tr(l.name)} · ${l.n}`} data-tip={`${tr(l.name)} · ${tr('{0} windows', l.n)}`}>
                  <Thumb boxes={l.boxes} style={style} active={layout.id === l.id} />
                  <span className="block mt-1 text-[10.5px] leading-tight truncate" style={{ color: layout.id === l.id ? '#fff' : C.sub }}>{l.family === 'Mine' ? l.name : tr(l.name)}</span>
                </button>
                {l.family === 'Mine' && <button type="button" onClick={() => deleteMine(l.id)} className="absolute top-1 end-1 w-6 h-6 rounded-md bg-black/60 text-white inline-flex items-center justify-center opacity-0 group-hover:opacity-100" aria-label="Delete this layout"><LuTrash2 size={12} /></button>}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---------------- the screen ----------------
const mediaEls = new Map<number, HTMLVideoElement | HTMLImageElement>();

function Stage() {
  const { boxes, style, contents, labels, selected, editBoxes, editArea, layout, edited } = useSplit();
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setScale(Math.max(0.05, Math.min((r.width - 24) / style.width, (r.height - 24) / style.height))); });
    ro.observe(el); return () => ro.disconnect();
  }, [style.width, style.height]);
  const [name, setName] = useState('');
  const A = areaPx(style);
  const bg = style.bgType === 'transparent' ? 'repeating-conic-gradient(#2a2a3a 0% 25%, #1c1c28 0% 50%) 0 0 / 40px 40px'
    : style.bgType === 'solid' ? style.bg1
      : style.bgType === 'image' && style.bgImage ? `center / cover no-repeat url(${style.bgImage}), linear-gradient(${style.bgAngle}deg, ${style.bg1}, ${style.bg2})`
        : `linear-gradient(${style.bgAngle + 90}deg, ${style.bg1}, ${style.bg2})`;

  // dragging / resizing windows (in the area's 0–1 units)
  const dragBox = (e: RPointerEvent, i: number, mode: 'move' | 'tl' | 'tr' | 'bl' | 'br') => {
    if (!editBoxes) return;
    e.preventDefault(); e.stopPropagation();
    useSplit.setState({ selected: i });
    const sx = e.clientX, sy = e.clientY; const b0 = { ...boxes[i] }; const all0 = boxes.map((b) => ({ ...b }));
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / scale / A.w, dy = (ev.clientY - sy) / scale / A.h;
      const b = { ...b0 };
      if (mode === 'move') { b.x = clamp01(snap(b0.x + dx)); b.y = clamp01(snap(b0.y + dy)); b.x = Math.min(b.x, 1 - b.w); b.y = Math.min(b.y, 1 - b.h); }
      else {
        if (mode[1] === 'l') { const nx = clamp01(snap(b0.x + dx)); b.w = b0.w + (b0.x - nx); b.x = nx; } else b.w = Math.min(1 - b0.x, snap(b0.w + dx));
        if (mode[0] === 't') { const ny = clamp01(snap(b0.y + dy)); b.h = b0.h + (b0.y - ny); b.y = ny; } else b.h = Math.min(1 - b0.y, snap(b0.h + dy));
        b.w = Math.max(0.03, b.w); b.h = Math.max(0.03, b.h);
      }
      const next = all0.map((x, k) => (k === i ? b : x)); setBoxes(next);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const dragArea = (e: RPointerEvent, mode: 'move' | 'tl' | 'tr' | 'bl' | 'br') => {
    e.preventDefault(); e.stopPropagation();
    const a0 = style.area ?? { x: 0, y: 0, w: 1, h: 1 }; const sx = e.clientX, sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / scale / style.width, dy = (ev.clientY - sy) / scale / style.height;
      const a = { ...a0 };
      if (mode === 'move') { a.x = Math.min(1 - a.w, clamp01(a0.x + dx)); a.y = Math.min(1 - a.h, clamp01(a0.y + dy)); }
      else {
        if (mode[1] === 'l') { const nx = clamp01(a0.x + dx); a.w = a0.w + (a0.x - nx); a.x = nx; } else a.w = Math.min(1 - a0.x, a0.w + dx);
        if (mode[0] === 't') { const ny = clamp01(a0.y + dy); a.h = a0.h + (a0.y - ny); a.y = ny; } else a.h = Math.min(1 - a0.y, a0.h + dy);
        a.w = Math.max(0.05, a.w); a.h = Math.max(0.05, a.h);
      }
      setStyle({ area: { x: +a.x.toFixed(4), y: +a.y.toFixed(4), w: +a.w.toFixed(4), h: +a.h.toFixed(4) } });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const handles = (fn: (e: RPointerEvent, m: 'tl' | 'tr' | 'bl' | 'br') => void, color: string) => (['tl', 'tr', 'bl', 'br'] as const).map((k) => (
    <span key={k} onPointerDown={(e) => fn(e, k)} className="absolute bg-white touch-none" style={{ width: 22 / scale > 60 ? 60 : 22 / scale, height: 22 / scale > 60 ? 60 : 22 / scale, border: `${Math.max(3, 3 / scale)}px solid ${color}`, borderRadius: 4, [k[0] === 't' ? 'top' : 'bottom']: -11 / scale, [k[1] === 'l' ? 'left' : 'right']: -11 / scale, cursor: k === 'tl' || k === 'br' ? 'nwse-resize' : 'nesw-resize', zIndex: 5 }} />
  ));
  const onDrop = (e: RDragEvent, i: number) => {
    const f = e.dataTransfer?.files?.[0]; if (!f) return;
    e.preventDefault();
    if (!/^(image|video)\//.test(f.type)) { toastError(tr('Drop a picture or a video.')); return; }
    setContent(i, { url: URL.createObjectURL(f), kind: f.type.startsWith('video/') ? 'video' : 'image', name: f.name });
  };

  const exportAs = async (mode: 'full' | 'frame') => {
    try {
      const s = useSplit.getState();
      const cv = await renderSplit({ boxes: s.boxes, style: mode === 'frame' && s.style.bgType === 'transparent' ? s.style : s.style, contents: s.contents, labels: s.labels, mode, media: mediaEls });
      await saveBlob(await toBlob(cv), `split-${s.boxes.length}-${mode === 'frame' ? 'frame' : 'screen'}-${style.width}x${style.height}.png`);
    } catch (e) { toastError(tr((e as Error).message || 'The picture could not be saved.')); }
  };
  const exportJson = async () => {
    const s = useSplit.getState();
    const data = { width: s.style.width, height: s.style.height, area: areaPx(s.style), windows: s.boxes.map((b, i) => { const p = boxPx(b, s.style); return { window: i + 1, role: b.role, label: s.labels[i] || defaultLabel(b, i, s.boxes), x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.w), height: Math.round(p.h) }; }) };
    await saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `split-${s.boxes.length}-windows.json`);
  };
  const addBox = () => { const s = useSplit.getState(); setBoxes([...s.boxes, { x: 0.35, y: 0.3, w: 0.3, h: 0.4, role: 'guest', float: true }]); useSplit.setState({ selected: s.boxes.length, editBoxes: true }); };
  const delBox = () => { const s = useSplit.getState(); if (s.selected == null) return; setBoxes(s.boxes.filter((_, k) => k !== s.selected)); useSplit.setState({ selected: null }); };

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      <div className="shrink-0 flex flex-wrap items-center gap-1.5 px-3 py-2 border-b" style={{ borderColor: C.line }}>
        <span className="text-[13px] font-semibold text-white me-1 truncate max-w-[260px]">{layout.family === 'Mine' ? layout.name : tr(layout.name)}{edited ? ` · ${tr('changed')}` : ''}</span>
        <span className="text-[12px] tabular-nums me-auto" style={{ color: C.faint }}>{tr('{0} windows', boxes.length)} · {style.width}×{style.height}</span>
        <Tool on={editBoxes} onClick={() => useSplit.setState({ editBoxes: !editBoxes, editArea: false })} icon={<LuMove size={14} />} label="Move windows" />
        <Tool on={editArea} onClick={() => useSplit.setState({ editArea: !editArea, editBoxes: false, ...(style.area ? {} : {}) })} icon={<LuSquareDashed size={14} />} label="Edit the area" />
        <Tool onClick={addBox} icon={<LuPlus size={14} />} label="Add a window" />
        {selected != null && editBoxes && <Tool onClick={delBox} icon={<LuTrash2 size={14} />} label="Remove the window" />}
        {edited && <Tool onClick={() => chooseLayout(layout)} icon={<LuRotateCcw size={14} />} label="Undo my changes" />}
        <ExportMenu onPng={() => void exportAs('full')} onFrame={() => void exportAs('frame')} onJson={() => void exportJson()} />
      </div>
      <div ref={wrap} className="flex-1 min-h-0 relative flex items-center justify-center overflow-hidden" onPointerDown={() => useSplit.setState({ selected: null })}>
        <div style={{ width: style.width * scale, height: style.height * scale }} className="relative shrink-0 shadow-2xl">
          <div className="absolute top-0 left-0 origin-top-left overflow-hidden" style={{ width: style.width, height: style.height, transform: `scale(${scale})`, background: bg }}>
            {/* the area */}
            <div className="absolute pointer-events-none" style={{ left: A.x, top: A.y, width: A.w, height: A.h, outline: editArea ? 'none' : `${Math.max(1, 1.5 / scale)}px dashed rgba(255,255,255,0.18)` }} />
            {boxes.map((b, i) => {
              const p0 = boxPx(b, style); const p = b.shape === 'circle' ? circleOf(p0) : p0; const c = contents[i];
              const pts = slantPoints(b, p);
              const clip = pts ? `polygon(${pts.map(([x, y]) => `${x}px ${y}px`).join(', ')})` : undefined;
              const rad: number | string = b.shape === 'circle' ? '50%' : style.radius;
              const col = b.role === 'host' ? style.hostColor : b.role === 'main' ? style.mainColor : style.guestColor;
              const sel = selected === i;
              return (
                <div key={i} className="absolute" style={{ left: p.x, top: p.y, width: p.w, height: p.h, zIndex: b.float ? 2 : 1, cursor: editBoxes ? 'move' : 'pointer' }}
                  onPointerDown={(e) => { e.stopPropagation(); if (editBoxes) dragBox(e, i, 'move'); else useSplit.setState({ selected: i }); }}
                  onDragOver={(e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); }} onDrop={(e) => onDrop(e, i)}>
                  <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: rad, clipPath: clip, background: `linear-gradient(135deg, ${col}, #0b0b16)`, boxShadow: style.glow && !clip ? `0 0 24px ${style.borderColor}` : undefined }}>
                    {c?.kind === 'image' && <img src={c.url} alt="" draggable={false} ref={(el: HTMLImageElement | null) => { if (el) mediaEls.set(i, el); else mediaEls.delete(i); }} className="absolute inset-0 w-full h-full object-cover" />}
                    {(c?.kind === 'video' || c?.kind === 'camera') && <video key={c.url} autoPlay muted loop playsInline ref={(el: HTMLVideoElement | null) => { if (el) { mediaEls.set(i, el); if (c.stream && el.srcObject !== c.stream) el.srcObject = c.stream; } else mediaEls.delete(i); }} src={c.kind === 'video' ? c.url : undefined} className="absolute inset-0 w-full h-full object-cover" />}
                    {!c && <span className="absolute inset-0 flex flex-col items-center justify-center text-white/90 font-bold select-none" style={{ fontSize: Math.max(18, Math.min(p.w, p.h) * 0.16) }}>{i + 1}{p.h > 140 && <span className="text-white/60 font-medium mt-1" style={{ fontSize: Math.max(14, Math.min(p.w, p.h) * 0.06) }}>{tr('Drop a picture or video')}</span>}</span>}
                  </div>
                  {style.borderW > 0 && (pts
                    ? <svg className="absolute inset-0 pointer-events-none overflow-visible" width={p.w} height={p.h}><polygon points={pts.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke={style.borderColor} strokeWidth={style.borderW * 2} style={{ clipPath: clip }} /></svg>
                    : <div className="absolute inset-0 pointer-events-none" style={{ borderRadius: rad, boxShadow: `inset 0 0 0 ${style.borderW}px ${style.borderColor}` }} />)}
                  {style.labels && <Label text={(labels[i] ?? '').trim() || tr(defaultLabel(b, i, boxes))} st={style} w={p.w} h={p.h} />}
                  {sel && <div className="absolute pointer-events-none" style={{ inset: -4 / scale, border: `${3 / scale}px solid ${C.cyan}`, borderRadius: rad }} />}
                  {sel && editBoxes && handles((e, m) => dragBox(e, i, m), C.cyan)}
                </div>
              );
            })}
            {editArea && (
              <div className="absolute cursor-move touch-none" style={{ left: A.x, top: A.y, width: A.w, height: A.h, border: `${3 / scale}px dashed ${C.accent}`, background: `${C.accent}22`, zIndex: 10, boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)' }} onPointerDown={(e) => dragArea(e, 'move')}>
                <span className="absolute left-0 text-white font-semibold" style={{ top: -40 / scale > -120 ? -40 / scale : -120, fontSize: 16 / scale, background: C.accent, padding: `${2 / scale}px ${8 / scale}px`, borderRadius: 4 / scale }}>{tr('Windows area')} · {Math.round(A.w)}×{Math.round(A.h)}</span>
                {handles((e, m) => dragArea(e, m), C.accent)}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-t text-[12px]" style={{ borderColor: C.line, color: C.faint }}>
        <span className="flex-1 min-w-[200px]">{editBoxes ? tr('Drag a window to move it; drag its corners to resize. Windows always stay inside the area.') : editArea ? tr('Drag the area or its corners. Every layout fits inside it.') : tr('Click a window to fill it, or drop a picture / video on it.')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('Name for your layout')} style={{ ...inputStyle, width: 190 }} aria-label="Name for your layout" />
        <button type="button" onClick={() => { const l = saveMine(name); setName(''); toast(tr('Saved in your layouts: {0}', l.name), 'success'); }} className="h-[30px] px-3 rounded-lg text-[12.5px] font-semibold text-white inline-flex items-center gap-1.5" style={{ background: C.accent }}><LuSave size={14} /><span>Save layout</span></button>
      </div>
    </div>
  );
}

function Label({ text, st, w, h }: { text: string; st: SplitStyle; w: number; h: number }) {
  const fs = Math.min(st.labelSize, h * 0.14, w * 0.08);
  const rtl = /[؀-ۿ]/.test(text);
  return (
    <div className="absolute pointer-events-none font-bold truncate" dir={rtl ? 'rtl' : 'ltr'} translate="no"
      style={{ [rtl ? 'right' : 'left']: fs * 0.5, bottom: fs * 0.5, maxWidth: w - fs, fontSize: fs, lineHeight: `${fs * 1.7}px`, padding: `0 ${fs * 0.6}px`, background: st.labelBg, color: st.labelColor, borderRadius: fs * 0.25 }}>{text}</div>
  );
}

function Tool({ on, onClick, icon, label }: { on?: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className="h-8 px-2.5 rounded-lg text-[12.5px] font-semibold inline-flex items-center gap-1.5 border" style={{ borderColor: on ? C.accent : C.line, background: on ? `${C.accent}33` : 'transparent', color: on ? '#fff' : C.ink }}>{icon}<span className="hidden lg:inline">{label}</span></button>
  );
}

function ExportMenu({ onPng, onFrame, onJson }: { onPng: () => void; onFrame: () => void; onJson: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const h = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; window.addEventListener('pointerdown', h); return () => window.removeEventListener('pointerdown', h); }, [open]);
  const item = (label: string, sub: string, icon: ReactNode, fn: () => void) => (
    <button type="button" role="menuitem" onClick={() => { setOpen(false); fn(); }} className="w-full px-3 py-2 flex items-start gap-2.5 text-start rounded-md hover:bg-white/5"><span className="mt-0.5">{icon}</span><span><span className="block text-[12.5px] text-white">{label}</span><span className="block text-[11px]" style={{ color: C.faint }}>{sub}</span></span></button>
  );
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} className="h-8 px-3 rounded-lg text-[12.5px] font-semibold text-white inline-flex items-center gap-1.5" style={{ background: C.accent }}><LuDownload size={14} /><span>Export</span><LuChevronDown size={13} /></button>
      {open && (
        <div role="menu" className="absolute end-0 top-10 z-40 w-[290px] rounded-xl border p-1 shadow-2xl" style={{ background: C.raised, borderColor: C.line }}>
          {item(tr('Screen picture (PNG)'), tr('Everything as you see it, at full size.'), <LuImage size={15} />, onPng)}
          {item(tr('Frame with see-through windows (PNG)'), tr('Put it over your cameras in vMix, OBS, Premiere or the Vision Mixer.'), <LuScanLine size={15} />, onFrame)}
          {item(tr('Window positions (JSON)'), tr('The x, y, width and height of every window in pixels.'), <LuFileJson size={15} />, onJson)}
        </div>
      )}
    </div>
  );
}

// ---------------- the look ----------------
function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section className="px-4 py-3.5 border-b flex flex-col gap-2.5" style={{ borderColor: C.line }}><h3 className="m-0 text-[11.5px] font-bold uppercase tracking-[0.08em]" style={{ color: C.faint }}>{title}</h3>{children}</section>;
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-center gap-2 text-[12.5px] min-h-[30px]"><span className="flex-1 min-w-0" style={{ color: C.sub }}>{label}</span>{children}</div>;
}
function Num({ value, onChange, label, min = 0, max = 4000 }: { value: number; onChange: (v: number) => void; label: string; min?: number; max?: number }) {
  return <input type="number" dir="ltr" value={value} min={min} max={max} onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || 0)))} aria-label={label} style={{ ...inputStyle, width: 78 }} />;
}
function Color({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return <label className="inline-flex items-center gap-1.5 h-[30px] ps-1 pe-2 rounded-lg border cursor-pointer" style={{ borderColor: C.line, background: C.raised }}><input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="w-6 h-6 rounded border-0 p-0 bg-transparent cursor-pointer" /><span className="text-[11px] font-mono uppercase" style={{ color: C.sub }} translate="no">{value}</span></label>;
}
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className="w-10 h-[22px] rounded-full relative shrink-0" style={{ background: on ? C.accent : '#3a3a55' }}><span className="absolute top-[3px] w-4 h-4 rounded-full bg-white transition-all" style={{ insetInlineStart: on ? 21 : 3 }} /></button>;
}
function Range({ value, min, max, onChange, label, unit = 'px' }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string; unit?: string }) {
  return <div className="flex items-center gap-2 w-[170px]"><input type="range" dir="ltr" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} className="flex-1 accent-[#7c5cff]" /><span className="w-11 text-end text-[11.5px] tabular-nums" style={{ color: C.sub }}>{value}{unit}</span></div>;
}
const pickFile = (accept: string, done: (f: File) => void) => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => { const f = i.files?.[0]; if (f) done(f); }; i.click(); };

function SelectedWindow() {
  const { selected, boxes, contents, labels } = useSplit();
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  if (selected == null || !boxes[selected]) return null;
  const i = selected; const b = boxes[i]; const c = contents[i];
  const camera = async (deviceId?: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : { width: 1920, height: 1080 }, audio: false });
      setContent(i, { url: `camera:${Date.now()}`, kind: 'camera', name: stream.getVideoTracks()[0]?.label || 'Camera', stream });
      const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'); setCams(list);
    } catch { toastError(tr('The camera could not be opened. Allow the camera for this site.')); }
  };
  return (
    <Group title={tr('Window {0}', i + 1)}>
      <Row label="Kind"><select value={b.role} onChange={(e) => setBoxes(boxes.map((x, k) => (k === i ? { ...x, role: e.target.value as Box['role'] } : x)))} style={{ ...inputStyle, width: 150 }} aria-label="Kind of window">
        <option value="host">{tr('Presenter')}</option><option value="main">{tr('Report')}</option><option value="guest">{tr('Guest')}</option></select></Row>
      <Row label="Name on the window"><input value={labels[i] ?? ''} onChange={(e) => setLabel(i, e.target.value)} placeholder={tr(defaultLabel(b, i, boxes))} style={{ ...inputStyle, width: 150 }} aria-label="Name on the window" /></Row>
      <div className="grid grid-cols-3 gap-1.5">
        <button type="button" className="h-9 rounded-lg border text-[12px] inline-flex items-center justify-center gap-1.5 hover:bg-white/5" style={{ borderColor: C.line }} onClick={() => pickFile('image/*', (f) => setContent(i, { url: URL.createObjectURL(f), kind: 'image', name: f.name }))}><LuImage size={14} /><span>Picture</span></button>
        <button type="button" className="h-9 rounded-lg border text-[12px] inline-flex items-center justify-center gap-1.5 hover:bg-white/5" style={{ borderColor: C.line }} onClick={() => pickFile('video/*', (f) => setContent(i, { url: URL.createObjectURL(f), kind: 'video', name: f.name }))}><LuVideo size={14} /><span>Video</span></button>
        <button type="button" className="h-9 rounded-lg border text-[12px] inline-flex items-center justify-center gap-1.5 hover:bg-white/5" style={{ borderColor: C.line }} onClick={() => void camera()}><LuCamera size={14} /><span>Camera</span></button>
      </div>
      {cams.length > 1 && c?.kind === 'camera' && <select onChange={(e) => void camera(e.target.value)} style={inputStyle} aria-label="Camera">{cams.map((d, k) => <option key={d.deviceId} value={d.deviceId}>{d.label || `${tr('Camera')} ${k + 1}`}</option>)}</select>}
      {c && <div className="flex items-center gap-2 text-[12px]" style={{ color: C.sub }}><span className="flex-1 truncate" translate="no">{c.name}</span><button type="button" onClick={() => setContent(i, null)} className="h-7 px-2 rounded-md border inline-flex items-center gap-1 hover:bg-white/5" style={{ borderColor: C.line }}><LuX size={12} /><span>Empty</span></button></div>}
    </Group>
  );
}

function StylePanel() {
  const st = useSplit((s) => s.style);
  const set = setStyle;
  const area = st.area;
  return (
    <div className="pb-10">
      <SelectedWindow />
      <Group title="Screen size">
        <div className="flex items-center gap-2 text-[12.5px]"><Num value={st.width} onChange={(v) => set({ width: Math.max(320, v) })} label="Width" /><span style={{ color: C.faint }}>×</span><Num value={st.height} onChange={(v) => set({ height: Math.max(240, v) })} label="Height" /><span style={{ color: C.faint }}>px</span></div>
        <div className="flex flex-wrap gap-1.5">{[[1920, 1080], [3840, 2160], [1280, 720], [1080, 1920], [1080, 1080]].map(([w, h]) => <button key={`${w}x${h}`} type="button" onClick={() => set({ width: w, height: h })} className="h-7 px-2.5 rounded-md border text-[11.5px] tabular-nums" style={{ borderColor: st.width === w && st.height === h ? C.accent : C.line, color: C.sub }} translate="no">{w}×{h}</button>)}</div>
      </Group>
      <Group title="Windows area">
        <div className="text-[11.5px] leading-relaxed" style={{ color: C.faint }}>The part of the screen the windows stay in — leave room for your logo, the news bar or a title. Every layout fits inside it.</div>
        <div className="flex flex-col gap-1">
          {AREA_PRESETS.map((p) => { const on = JSON.stringify(p.area) === JSON.stringify(area); return <button key={p.name} type="button" onClick={() => set({ area: p.area ? { ...p.area } : null })} className="h-8 px-2.5 rounded-lg border text-[12px] text-start" style={{ borderColor: on ? C.accent : C.line, background: on ? `${C.accent}22` : 'transparent', color: on ? '#fff' : C.sub }}>{tr(p.name)}</button>; })}
        </div>
        {area ? (
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            {(['x', 'y', 'w', 'h'] as const).map((k) => {
              const full = k === 'x' || k === 'w' ? st.width : st.height;
              return <label key={k} className="flex items-center gap-1.5"><span className="w-12 shrink-0" style={{ color: C.sub }}>{tr(k === 'x' ? 'Left' : k === 'y' ? 'Top' : k === 'w' ? 'Width' : 'Height')}</span>
                <input type="number" dir="ltr" value={Math.round(area[k] * full)} onChange={(e) => { const v = Math.max(0, Number(e.target.value) || 0) / full; const a = { ...area, [k]: v }; a.w = Math.min(Math.max(0.05, a.w), 1); a.h = Math.min(Math.max(0.05, a.h), 1); a.x = Math.min(a.x, 1 - a.w); a.y = Math.min(a.y, 1 - a.h); set({ area: a }); }} aria-label={k} style={{ ...inputStyle, height: 28 }} /></label>;
            })}
          </div>
        ) : <Row label="Margin"><Range value={st.margin} min={0} max={200} onChange={(v) => set({ margin: v })} label="Margin" /></Row>}
        <button type="button" onClick={() => useSplit.setState({ editArea: true, editBoxes: false })} className="h-8 rounded-lg border text-[12px] inline-flex items-center justify-center gap-1.5 hover:bg-white/5" style={{ borderColor: C.line }}><LuSquareDashed size={14} /><span>Drag the area on the screen</span></button>
      </Group>
      <Group title="Windows">
        <Row label="Space between"><Range value={st.gap} min={0} max={60} onChange={(v) => set({ gap: v })} label="Space between" /></Row>
        <Row label="Round corners"><Range value={st.radius} min={0} max={60} onChange={(v) => set({ radius: v })} label="Round corners" /></Row>
        <Row label="Border"><Range value={st.borderW} min={0} max={16} onChange={(v) => set({ borderW: v })} label="Border" /></Row>
        {st.borderW > 0 && <Row label="Border colour"><Color value={st.borderColor} onChange={(v) => set({ borderColor: v })} label="Border colour" /></Row>}
        <Row label="Glow"><Toggle on={st.glow} onChange={(v) => set({ glow: v })} label="Glow" /></Row>
      </Group>
      <Group title="Background">
        <div className="flex flex-wrap gap-1.5">{(['gradient', 'solid', 'image', 'transparent'] as const).map((k) => <button key={k} type="button" onClick={() => set({ bgType: k })} className="h-8 px-3 rounded-lg border text-[12.5px] font-semibold" style={{ borderColor: st.bgType === k ? C.accent : C.line, background: st.bgType === k ? `${C.accent}2e` : 'transparent', color: st.bgType === k ? '#fff' : C.sub }}>{tr(k === 'gradient' ? 'Gradient' : k === 'solid' ? 'Colour' : k === 'image' ? 'Picture' : 'See-through')}</button>)}</div>
        {(st.bgType === 'gradient' || st.bgType === 'solid') && <Row label="Colours"><Color value={st.bg1} onChange={(v) => set({ bg1: v })} label="Background colour" />{st.bgType === 'gradient' && <Color value={st.bg2} onChange={(v) => set({ bg2: v })} label="Second colour" />}</Row>}
        {st.bgType === 'gradient' && <Row label="Angle"><Range value={st.bgAngle} min={0} max={360} onChange={(v) => set({ bgAngle: v })} label="Angle" unit="°" /></Row>}
        {st.bgType === 'image' && <div className="flex gap-1.5">
          <button type="button" className="h-9 flex-1 rounded-lg border text-[12.5px] inline-flex items-center justify-center gap-1.5 hover:bg-white/5" style={{ borderColor: C.line }} onClick={() => pickFile('image/*', (f) => { const r = new FileReader(); r.onload = () => set({ bgImage: String(r.result) }); r.readAsDataURL(f); })}><LuImage size={14} /><span>{st.bgImage ? 'Change picture' : 'Your studio picture'}</span></button>
          {st.bgImage && <button type="button" className="h-9 w-9 rounded-lg border inline-flex items-center justify-center hover:bg-white/5" style={{ borderColor: C.line }} onClick={() => set({ bgImage: null })} aria-label="Remove the picture"><LuX size={14} /></button>}
        </div>}
        <div className="grid grid-cols-5 gap-1.5">
          {[['#2a0a63', '#7b1fd6'], ['#0b1d4a', '#1e6fd9'], ['#3b0612', '#c8102e'], ['#0b0b0b', '#2b2b2b'], ['#0f3d3e', '#14b8a6'], ['#1a1033', '#ff4d6d'], ['#101826', '#f59e0b'], ['#f1f3f6', '#cbd5e1'], ['#0a2540', '#635bff'], ['#13001f', '#00d4ff']].map(([a, b]) => (
            <button key={a + b} type="button" onClick={() => set({ bgType: 'gradient', bg1: a, bg2: b })} className="h-8 rounded-md border" style={{ borderColor: C.line, background: `linear-gradient(120deg, ${a}, ${b})` }} aria-label={`${a} ${b}`} />
          ))}
        </div>
      </Group>
      <Group title="Names on the windows">
        <Row label="Show names"><Toggle on={st.labels} onChange={(v) => set({ labels: v })} label="Show names" /></Row>
        {st.labels && <>
          <Row label="Bar colour"><Color value={st.labelBg} onChange={(v) => set({ labelBg: v })} label="Bar colour" /></Row>
          <Row label="Text colour"><Color value={st.labelColor} onChange={(v) => set({ labelColor: v })} label="Text colour" /></Row>
          <Row label="Text size"><Range value={st.labelSize} min={14} max={60} onChange={(v) => set({ labelSize: v })} label="Text size" /></Row>
          <div className="text-[11.5px]" style={{ color: C.faint }}>Click a window to write its name (e.g. the presenter’s or the guest’s name).</div>
        </>}
      </Group>
      <Group title="Empty window colours">
        <Row label="Presenter"><Color value={st.hostColor} onChange={(v) => set({ hostColor: v })} label="Presenter colour" /></Row>
        <Row label="Report"><Color value={st.mainColor} onChange={(v) => set({ mainColor: v })} label="Report colour" /></Row>
        <Row label="Guest"><Color value={st.guestColor} onChange={(v) => set({ guestColor: v })} label="Guest colour" /></Row>
      </Group>
      <Group title="More">
        <button type="button" className="h-9 rounded-lg border text-[12.5px] hover:bg-white/5" style={{ borderColor: C.line, color: C.sub }} onClick={() => set(defaultStyle())}>Reset the look</button>
      </Group>
    </div>
  );
}
