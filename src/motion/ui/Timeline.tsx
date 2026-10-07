import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Composition, Keyframe, MLayer, Prop } from '../types';
import { useMotion, activeComp, getProp, setTime, setAutoKey, type KeyRef } from '../store';
import * as A from '../actions';
import { formatTimecode, parseTimecode, snapTime } from '../anim';
import { layerGroups, type PropMeta } from './propTree';
import { Diamond, PropLine } from './fields';
import { GraphEditor } from './GraphEditor';
import { assetData, useAssetVersion } from '../media/assets';
import { Popover } from '../../components/ui/controls';
import { useWindowSize } from '../../utils/useWindowSize';
import {
  LuEye, LuEyeOff, LuVolume2, LuVolumeX, LuLock, LuLockOpen, LuChevronRight, LuType, LuShapes, LuSquare, LuImage, LuFilm, LuMusic, LuBox, LuCamera,
  LuSlidersHorizontal, LuLayers, LuChartSpline, LuMagnet, LuFlag, LuTrash2, LuArrowUp, LuArrowDown, LuCircleDot, LuWand, LuPlus,
} from 'react-icons/lu';

const ROW = 22, LROW = 26;
/** Width of the layer outline column; it narrows (and drops columns) on small screens. */
type Outline = { w: number; parent: boolean; switches: boolean; av: boolean };
const outlineFor = (total: number): Outline =>
  total >= 1000 ? { w: 460, parent: true, switches: true, av: true }
  : total >= 760 ? { w: 366, parent: false, switches: true, av: true }
  : total >= 520 ? { w: 290, parent: false, switches: false, av: true }
  : { w: Math.max(170, Math.round(total * 0.46)), parent: false, switches: false, av: false };
const OutlineCtx = createContext<Outline>(outlineFor(1200));

type Row =
  | { kind: 'layer'; layer: MLayer; index: number }
  | { kind: 'group'; layer: MLayer; id: string; label: string; depth: number; key: string }
  | { kind: 'sub'; layer: MLayer; group: 'masks' | 'effects'; id: string; label: string; key: string }
  | { kind: 'prop'; layer: MLayer; meta: PropMeta; depth: number }
  | { kind: 'textSource'; layer: MLayer };

function buildRows(c: Composition, expanded: Record<string, boolean>, showShy: boolean): Row[] {
  const rows: Row[] = [];
  c.layers.forEach((l, index) => {
    if (l.shy && !showShy) return;
    rows.push({ kind: 'layer', layer: l, index });
    if (!expanded[l.id]) return;
    for (const g of layerGroups(l)) {
      const gk = `${l.id}:${g.id}`;
      rows.push({ kind: 'group', layer: l, id: g.id, label: g.label, depth: 1, key: gk });
      if (!expanded[gk]) continue;
      if (g.id === 'text') rows.push({ kind: 'textSource', layer: l });
      for (const p of g.props) rows.push({ kind: 'prop', layer: l, meta: p, depth: 2 });
      for (const s of g.sub ?? []) {
        const sk = `${gk}:${s.id}`;
        rows.push({ kind: 'sub', layer: l, group: g.id as 'masks' | 'effects', id: s.id, label: s.label, key: sk });
        if (expanded[sk] ?? true) for (const p of s.props) rows.push({ kind: 'prop', layer: l, meta: p, depth: 3 });
      }
    }
  });
  return rows;
}

const ICON: Record<MLayer['type'], typeof LuType> = { text: LuType, shape: LuShapes, solid: LuSquare, image: LuImage, video: LuFilm, audio: LuMusic, null: LuCircleDot, adjustment: LuWand, precomp: LuLayers, camera: LuCamera };

export function Timeline() {
  const comp = useMotion((s) => activeComp(s));
  const t = useMotion((s) => (s.activeCompId ? s.times[s.activeCompId] ?? 0 : 0));
  const tl = useMotion((s) => s.timeline);
  const selected = useMotion((s) => s.selectedLayers);
  const selectedKeys = useMotion((s) => s.selectedKeys);
  const [width, setWidth] = useState(800);
  const ol = outlineFor(useWindowSize().w);
  const LEFT_W = ol.w;
  const rightRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useAssetVersion((s) => s.v);

  useLayoutEffect(() => {
    const el = rightRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el); setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [comp?.id, tl.graph]);

  const rows = useMemo(() => (comp ? buildRows(comp, tl.expanded, tl.showShy) : []), [comp, tl.expanded, tl.showShy]);
  const playing = useMotion((s) => s.playing);
  // keep the time indicator visible while playing
  useEffect(() => {
    if (!playing) return;
    const x = t * tl.pxPerSec - tl.scroll;
    if (x > width - 20 || x < 0) useMotion.setState((s) => ({ timeline: { ...s.timeline, scroll: Math.max(0, t * tl.pxPerSec - 40) } }));
  }, [t, playing]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!comp) return <div className="h-full flex items-center justify-center text-muted">Create or open a composition to see its timeline.</div>;

  const pps = tl.pxPerSec, scroll = tl.scroll;
  const xOf = (time: number) => time * pps - scroll;
  const tOf = (x: number) => (x + scroll) / pps;
  const keySel = new Set(selectedKeys.map((k) => k.keyId));
  const setTl = (patch: Partial<typeof tl>) => useMotion.setState((s) => ({ timeline: { ...s.timeline, ...patch } }));
  const fitAll = () => setTl({ pxPerSec: Math.max(4, (width - 20) / comp.duration), scroll: 0 });


  return (
    <OutlineCtx.Provider value={ol}>
    <div className="h-full flex flex-col min-h-0 bg-[#1e2126]" onDragOver={(e) => { if (e.dataTransfer.types.includes('text/kdm-item')) e.preventDefault(); }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData('text/kdm-item'); if (!id) return;
        e.preventDefault(); e.stopPropagation();
        const r = rightRef.current?.getBoundingClientRect();
        const at = r && e.clientX > r.left ? snapTime(Math.max(0, tOf(e.clientX - r.left)), comp.fps) : t;
        const p = useMotion.getState().project;
        if (p.assets[id]) A.addAssetLayer(id, at); else if (p.comps[id]) A.addCompLayer(id, at);
      }}>
      <TimelineHeader comp={comp} t={t} onFit={fitAll} />
      <div className="flex border-b border-line shrink-0" style={{ height: 34 }}>
        <div className="shrink-0 border-e border-line flex items-end px-2 pb-1 gap-2 text-2xs text-faint select-none" style={{ width: LEFT_W }}>
          <span className={ol.av ? 'w-[86px] whitespace-nowrap' : 'w-[22px]'}>{ol.av ? 'A/V · Solo · Lock' : ''}</span><span className="w-5">#</span><span className="flex-1 truncate">Layer Name</span>{ol.switches && <span className="w-[70px]">Switches</span>}{ol.parent && <span className="w-[92px]">Parent</span>}
        </div>
        <div ref={rightRef} className="relative flex-1 min-w-0 overflow-hidden">
          <Ruler comp={comp} width={width} xOf={xOf} tOf={tOf} t={t} />
        </div>
      </div>
      <div className="flex-1 min-h-0 relative">
        {tl.graph ? (
          <div className="absolute inset-0 flex">
            <div className="shrink-0 border-e border-line overflow-y-auto" style={{ width: LEFT_W }}>
              {rows.map((r, i) => <OutlineRow key={i} r={r} comp={comp} t={t} selected={selected} />)}
            </div>
            <div className="relative flex-1 min-w-0"><GraphEditor comp={comp} t={t} xOf={xOf} tOf={tOf} width={width} /></div>
          </div>
        ) : (
          <div ref={scrollRef} className="absolute inset-0 overflow-y-auto overflow-x-hidden" onWheel={(e) => {
            if (e.altKey || e.ctrlKey) { e.preventDefault(); const r = rightRef.current!.getBoundingClientRect(); const mx = e.clientX - r.left; const at = tOf(mx); const f = e.deltaY < 0 ? 1.15 : 1 / 1.15; const np = Math.max(4, Math.min(4000, pps * f)); setTl({ pxPerSec: np, scroll: Math.max(0, at * np - mx) }); }
            else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { setTl({ scroll: Math.max(0, scroll + (e.shiftKey ? e.deltaY : e.deltaX)) }); }
          }}>
            <div className="flex relative" style={{ minHeight: '100%' }}>
              <div className="shrink-0 border-e border-line" style={{ width: LEFT_W }}>
                {rows.map((r, i) => <OutlineRow key={i} r={r} comp={comp} t={t} selected={selected} />)}
                <div className="h-16" />
              </div>
              <Tracks comp={comp} rows={rows} width={width} xOf={xOf} tOf={tOf} t={t} keySel={keySel} selected={selected} />
            </div>
          </div>
        )}
      </div>
      <HScroll comp={comp} width={width} />
    </div>
    </OutlineCtx.Provider>
  );
}

function TimelineHeader({ comp, t, onFit }: { comp: Composition; t: number; onFit: () => void }) {
  const tl = useMotion((s) => s.timeline);
  const [text, setText] = useState<string | null>(null);
  const setTl = (patch: Partial<typeof tl>) => useMotion.setState((s) => ({ timeline: { ...s.timeline, ...patch } }));
  return (
    <div className="h-9 shrink-0 flex items-center gap-2 px-2 border-b border-line bg-panel overflow-x-auto overflow-y-hidden no-scrollbar">
      <input className="field num h-[24px] w-[118px] shrink-0 text-[13px] text-accent font-medium" aria-label="Current time" value={text ?? formatTimecode(t, comp.fps)}
        onFocus={(e) => { setText(formatTimecode(t, comp.fps)); requestAnimationFrame(() => e.target.select()); }} onChange={(e) => setText(e.target.value)}
        onBlur={() => { if (text !== null) { const v = parseTimecode(text, comp.fps); if (v !== null) setTime(v); } setText(null); }}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setText(null); (e.target as HTMLInputElement).blur(); } }} />
      <span className="text-faint num text-xs whitespace-nowrap hidden md:inline">{`${Math.round(t * comp.fps)} · ${comp.fps} fps`}</span>
      <div className="w-px h-5 bg-line mx-1 shrink-0" />
      <AutoKeyButton />
      <HeaderToggle on={comp.motionBlur} label="Motion blur for the composition" onClick={() => A.updateCompSettings(comp.id, { motionBlur: !comp.motionBlur })}><span className="text-[11px] font-semibold">MB</span></HeaderToggle>
      <HeaderToggle on={tl.snap} label="Snapping" onClick={() => setTl({ snap: !tl.snap })}><LuMagnet size={14} /></HeaderToggle>
      <HeaderToggle on={!tl.showShy} label="Hide shy layers" onClick={() => setTl({ showShy: !tl.showShy })}><span className="text-[11px]">shy</span></HeaderToggle>
      <HeaderToggle on={tl.graph} label="Graph Editor (Shift+F3)" onClick={() => setTl({ graph: !tl.graph })}><LuChartSpline size={14} /></HeaderToggle>
      <HeaderToggle on={false} label="Add marker (*)" onClick={() => A.addMarker()}><LuFlag size={14} /></HeaderToggle>
      <div className="flex-1 min-w-[8px]" />
      <span className="text-faint text-xs hidden md:inline">Zoom</span>
      <input type="range" className="slider w-[90px] md:w-[120px] shrink-0" min={0} max={100} value={Math.round((Math.log(tl.pxPerSec / 4) / Math.log(1000)) * 100)} aria-label="Timeline zoom"
        style={{ ['--p' as string]: `${Math.round((Math.log(tl.pxPerSec / 4) / Math.log(1000)) * 100)}%` }}
        onChange={(e) => setTl({ pxPerSec: 4 * Math.pow(1000, Number(e.target.value) / 100) })} />
      <button type="button" className="btn h-[24px] px-2 text-xs shrink-0" onClick={onFit}>Fit</button>
    </div>
  );
}
function AutoKeyButton() {
  const on = useMotion((s) => s.autoKey);
  const label = on ? 'Auto-Keyframe is on: every change records a keyframe (Alt+Shift+K)' : 'Auto-Keyframe is off: click the stopwatch to animate a property (Alt+Shift+K)';
  return (
    <button type="button" aria-pressed={on} aria-label={label} data-tip={label} onClick={() => setAutoKey(!on)}
      className={`h-[24px] px-2 shrink-0 rounded-[4px] inline-flex items-center gap-1.5 text-[11px] font-semibold whitespace-nowrap border ${on ? 'bg-[#e5484d]/15 text-[#ff6b6f] border-[#e5484d]/50' : 'text-muted border-line hover:text-ink hover:bg-hover'}`}>
      <span className={`w-2 h-2 rounded-full ${on ? 'bg-[#ff4d52] shadow-[0_0_6px_#ff4d52]' : 'border border-current'}`} aria-hidden />
      <span>Auto-Key</span>
    </button>
  );
}

function HeaderToggle({ on, label, onClick, children }: { on: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={`h-[24px] min-w-[26px] px-1.5 shrink-0 rounded-[4px] inline-flex items-center justify-center ${on ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink hover:bg-hover'}`} aria-pressed={on} aria-label={label} data-tip={label} onClick={onClick}>{children}</button>;
}

// ---------- ruler (time, work area, markers) ----------
function niceStep(pps: number, fps: number) {
  const cands = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  return cands.find((s) => s * pps >= 70) ?? 600;
}
function Ruler({ comp, width, xOf, tOf, t }: { comp: Composition; width: number; xOf: (t: number) => number; tOf: (x: number) => number; t: number }) {
  const tl = useMotion((s) => s.timeline);
  const step = niceStep(tl.pxPerSec, comp.fps);
  const first = Math.max(0, Math.floor(tOf(0) / step) * step);
  const ticks: number[] = [];
  for (let x = first; x <= Math.min(comp.duration, tOf(width) + step); x += step) ticks.push(x);
  const [editMarker, setEditMarker] = useState<{ id: string; el: HTMLElement } | null>(null);
  const scrub = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const move = (cx: number) => { const tt = Math.max(0, Math.min(comp.duration, tOf(cx - r.left))); setTime(tl.snap ? snapToEdges(comp, tt, tl.pxPerSec) : tt); };
    move(e.clientX);
    const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
    const mm = (ev: PointerEvent) => move(ev.clientX);
    const up = () => { el.removeEventListener('pointermove', mm); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mm); el.addEventListener('pointerup', up);
  };
  const dragWork = (which: 'start' | 'end' | 'both') => (e: React.PointerEvent) => {
    e.stopPropagation(); const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
    const x0 = e.clientX, s0 = comp.workStart, e0 = comp.workEnd; const mk = `work-${Date.now()}`;
    const mm = (ev: PointerEvent) => {
      const dt = (ev.clientX - x0) / tl.pxPerSec;
      if (which === 'start') A.setWorkArea(s0 + dt, null, mk);
      else if (which === 'end') A.setWorkArea(null, e0 + dt, mk);
      else { const d = Math.max(-s0, Math.min(comp.duration - e0, dt)); A.setWorkArea(s0 + d, e0 + d, mk); }
    };
    const up = () => { el.removeEventListener('pointermove', mm); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mm); el.addEventListener('pointerup', up);
  };
  const ws = xOf(comp.workStart), we = xOf(comp.workEnd);
  return (
    <div className="absolute inset-0 select-none">
      {/* work area */}
      <div className="absolute top-0 h-[9px] bg-[#4f8cff55] cursor-grab touch-none" style={{ left: ws, width: Math.max(2, we - ws) }} onPointerDown={dragWork('both')} data-tip="Work area · drag the ends to change (B / N)">
        <div className="absolute -left-1 top-0 bottom-0 w-2 bg-accent cursor-ew-resize rounded-[2px]" onPointerDown={dragWork('start')} />
        <div className="absolute -right-1 top-0 bottom-0 w-2 bg-accent cursor-ew-resize rounded-[2px]" onPointerDown={dragWork('end')} />
      </div>
      <div className="absolute left-0 right-0 top-[9px] bottom-0 cursor-col-resize touch-none" onPointerDown={scrub} role="slider" aria-label="Time ruler" aria-valuenow={t}>
        {ticks.map((x) => (
          <div key={x} className="absolute bottom-0 h-[10px] border-s border-[#596270]" style={{ left: xOf(x) }}>
            <span className="absolute -top-[13px] left-1 text-[10px] text-faint num whitespace-nowrap">{step < 1 && Math.abs(x - Math.round(x)) > 1e-6 ? `${Math.round(x * comp.fps) % comp.fps}f` : formatShort(x)}</span>
          </div>
        ))}
        {/* end of composition */}
        <div className="absolute top-0 bottom-0 bg-[#00000055]" style={{ left: xOf(comp.duration), right: 0 }} />
      </div>
      {comp.markers.map((m) => (
        <div key={m.id} className="absolute bottom-0 -ml-[5px] w-[10px] h-[12px] cursor-ew-resize" style={{ left: xOf(m.t) }} data-tip={m.label || 'Marker · drag to move, double-click to name'}
          onPointerDown={(e) => {
            e.stopPropagation(); const el = e.currentTarget; el.setPointerCapture(e.pointerId); const x0 = e.clientX; const t0 = m.t; const mk = `mk-${m.id}-${Date.now()}`;
            const mm = (ev: PointerEvent) => A.updateMarker(m.id, { t: t0 + (ev.clientX - x0) / tl.pxPerSec }, mk);
            const up = () => { el.removeEventListener('pointermove', mm); el.removeEventListener('pointerup', up); };
            el.addEventListener('pointermove', mm); el.addEventListener('pointerup', up);
          }}
          onDoubleClick={(e) => setEditMarker({ id: m.id, el: e.currentTarget })}
          onContextMenu={(e) => { e.preventDefault(); A.removeMarker(m.id); }}>
          <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden><path d="M0 0h10v7l-5 5-5-5z" fill="#3ecf8e" /></svg>
          {m.label && <span className="absolute left-3 bottom-0 text-[10px] text-ok whitespace-nowrap">{m.label}</span>}
        </div>
      ))}
      {editMarker && (
        <Popover anchor={editMarker.el} onClose={() => setEditMarker(null)}>
          <div className="menu p-2 flex gap-1.5 items-center">
            <input autoFocus className="field w-[160px]" placeholder="Marker comment" defaultValue={comp.markers.find((m) => m.id === editMarker.id)?.label}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { A.updateMarker(editMarker.id, { label: e.currentTarget.value }); setEditMarker(null); } if (e.key === 'Escape') setEditMarker(null); }} />
            <button type="button" className="icon-btn" aria-label="Delete marker" onClick={() => { A.removeMarker(editMarker.id); setEditMarker(null); }}><LuTrash2 size={13} /></button>
          </div>
        </Popover>
      )}
      {/* time indicator head */}
      <div className="absolute bottom-0 -ml-[6px] pointer-events-none" style={{ left: xOf(t) }}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M0 0h12v6l-6 6-6-6z" fill="#4f8cff" /></svg>
      </div>
    </div>
  );
}
const formatShort = (s: number) => { const m = Math.floor(s / 60), ss = s - m * 60; return m ? `${m}:${String(Math.round(ss)).padStart(2, '0')}` : `${Math.round(ss * 100) / 100}s`; };

/** Snap a time to nearby edges, keys, markers and the time indicator. */
function snapToEdges(comp: Composition, t: number, pps: number, exclude?: Set<string>, includeCti = false): number {
  const cands: number[] = [0, comp.duration, comp.workStart, comp.workEnd, ...comp.markers.map((m) => m.t)];
  if (includeCti) cands.push(useMotion.getState().times[comp.id] ?? 0);
  for (const l of comp.layers) {
    if (exclude?.has(l.id)) continue;
    cands.push(l.inPoint, l.outPoint);
  }
  let best = t, bd = 7 / pps;
  for (const c of cands) { const d = Math.abs(c - t); if (d < bd) { bd = d; best = c; } }
  return best;
}

// ---------- outline (left) ----------
function OutlineRow({ r, comp, t, selected }: { r: Row; comp: Composition; t: number; selected: string[] }) {
  const expanded = useMotion((s) => s.timeline.expanded);
  const toggle = (key: string, def = false) => useMotion.setState((s) => ({ timeline: { ...s.timeline, expanded: { ...s.timeline.expanded, [key]: !(s.timeline.expanded[key] ?? def) } } }));
  if (r.kind === 'layer') return <LayerOutline l={r.layer} index={r.index} comp={comp} selected={selected.includes(r.layer.id)} open={!!expanded[r.layer.id]} onToggle={() => toggle(r.layer.id)} />;
  if (r.kind === 'group') {
    const open = !!expanded[r.key];
    return (
      <div className="flex items-center gap-1 text-xs text-ink cursor-default hover:bg-[#262a30]" style={{ height: ROW, paddingInlineStart: 26 + r.depth * 12 }} onClick={() => toggle(r.key)}>
        <LuChevronRight size={12} className={`transition-transform text-muted ${open ? 'rotate-90' : ''}`} />
        {r.id === 'effects' && <LuSlidersHorizontal size={11} className="text-muted" />}
        <span>{r.label}</span>
        {r.id === 'transform' && <button type="button" className="ms-auto me-2 text-2xs text-faint hover:text-ink" onClick={(e) => { e.stopPropagation(); resetTransform(r.layer, comp); }}>Reset</button>}
      </div>
    );
  }
  if (r.kind === 'sub') {
    const open = expanded[r.key] ?? true;
    if (r.group === 'masks') {
      const m = r.layer.masks.find((x) => x.id === r.id)!;
      return (
        <div className="flex items-center gap-1.5 text-xs cursor-default hover:bg-[#262a30]" style={{ height: ROW, paddingInlineStart: 26 + 2 * 12 }} onClick={() => toggle(r.key, true)}>
          <LuChevronRight size={12} className={`transition-transform text-muted ${open ? 'rotate-90' : ''}`} />
          <span className="w-2.5 h-2.5 rounded-[2px] bg-[#f2c94c]" aria-hidden />
          <span className="truncate flex-1 min-w-0">{m.name}</span>
          <select className="field h-[18px] text-2xs py-0" value={m.mode} aria-label="Mask mode" onClick={(e) => e.stopPropagation()} onChange={(e) => A.updateMask(r.layer.id, m.id, { mode: e.target.value as typeof m.mode }, 'Mask Mode')}>
            <option value="add">Add</option><option value="subtract">Subtract</option><option value="intersect">Intersect</option><option value="none">None</option>
          </select>
          <label className="flex items-center gap-1 text-2xs text-muted" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={m.inverted} onChange={(e) => A.updateMask(r.layer.id, m.id, { inverted: e.target.checked }, 'Invert Mask')} />Inverted</label>
          <button type="button" className="icon-btn !w-5 !h-5 me-1" aria-label="Delete mask" onClick={(e) => { e.stopPropagation(); A.removeMask(r.layer.id, m.id); }}><LuTrash2 size={11} /></button>
        </div>
      );
    }
    const fx = r.layer.effects.find((x) => x.id === r.id)!;
    return (
      <div className="flex items-center gap-1.5 text-xs cursor-default hover:bg-[#262a30]" style={{ height: ROW, paddingInlineStart: 26 + 2 * 12 }} onClick={() => toggle(r.key, true)}>
        <LuChevronRight size={12} className={`transition-transform text-muted ${open ? 'rotate-90' : ''}`} />
        <input type="checkbox" checked={fx.enabled} aria-label="Effect on/off" onClick={(e) => e.stopPropagation()} onChange={() => A.toggleEffect(r.layer.id, fx.id)} />
        <span className={`truncate flex-1 min-w-0 ${fx.enabled ? '' : 'text-faint line-through'}`}>{r.label}</span>
        <button type="button" className="icon-btn !w-5 !h-5" aria-label="Move effect up" onClick={(e) => { e.stopPropagation(); A.moveEffect(r.layer.id, fx.id, -1); }}><LuArrowUp size={11} /></button>
        <button type="button" className="icon-btn !w-5 !h-5" aria-label="Move effect down" onClick={(e) => { e.stopPropagation(); A.moveEffect(r.layer.id, fx.id, 1); }}><LuArrowDown size={11} /></button>
        <button type="button" className="icon-btn !w-5 !h-5 me-1" aria-label="Remove effect" onClick={(e) => { e.stopPropagation(); A.removeEffect(r.layer.id, fx.id); }}><LuTrash2 size={11} /></button>
      </div>
    );
  }
  if (r.kind === 'textSource') {
    const l = r.layer as Extract<MLayer, { type: 'text' }>;
    return (
      <div className="flex items-center gap-1.5 text-xs" style={{ height: ROW, paddingInlineStart: 26 + 2 * 12 + 22 }}>
        <span className="text-ink w-[96px] shrink-0">Source Text</span>
        <input className="field h-[18px] text-xs flex-1 min-w-0 me-2" dir="auto" value={l.text.text} aria-label="Source text"
          onChange={(e) => A.setLayer(l.id, { text: { ...l.text, text: e.target.value }, name: e.target.value.split('\n')[0].slice(0, 32) || 'Text' } as Partial<MLayer>, 'Edit Text', `text-${l.id}`)} onKeyDown={(e) => e.stopPropagation()} />
      </div>
    );
  }
  return (
    <div className="hover:bg-[#23272d]" style={{ height: ROW, paddingInlineStart: 26 + r.depth * 12, paddingInlineEnd: 8 }}>
      <PropLine layer={r.layer} meta={r.meta} t={t} fps={comp.fps} />
    </div>
  );
}

function resetTransform(l: MLayer, comp: Composition) {
  const tr = l.transform;
  const reset = (_p: Prop, v: unknown) => ({ v, k: [] }) as Prop;
  void comp;
  A.setLayer(l.id, { transform: { ...tr, scale: reset(tr.scale, [100, 100, 100]), rotation: reset(tr.rotation, 0), rotationX: reset(tr.rotationX, 0), rotationY: reset(tr.rotationY, 0), opacity: reset(tr.opacity, 100) } as MLayer['transform'] }, 'Reset Transform');
}

function Switch({ on, label, onClick, children, dim }: { on: boolean; label: string; onClick: (e: React.MouseEvent) => void; children: ReactNode; dim?: boolean }) {
  return <button type="button" className={`w-[20px] h-[18px] rounded-[3px] inline-flex items-center justify-center border ${on ? 'border-[#5a6574] bg-[#2f3640] text-ink' : 'border-transparent text-faint hover:text-muted'} ${dim ? 'opacity-50' : ''}`}
    aria-label={label} aria-pressed={on} data-tip={label} onClick={(e) => { e.stopPropagation(); onClick(e); }}>{children}</button>;
}

function LayerOutline({ l, index, comp, selected, open, onToggle }: { l: MLayer; index: number; comp: Composition; selected: boolean; open: boolean; onToggle: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [drop, setDrop] = useState<'above' | 'below' | null>(null);
  const ol = useContext(OutlineCtx);
  const Icon = ICON[l.type];
  const visual = l.type !== 'audio';
  const hasAudio = l.type === 'audio' || (l.type === 'video' && !!assetData(l.assetId)?.audio) || l.type === 'precomp';
  return (
    <div role="row" aria-selected={selected} draggable={!renaming}
      onDragStart={(e) => { e.dataTransfer.setData('text/kdm-layer', l.id); e.dataTransfer.effectAllowed = 'move'; if (!selected) A.selectLayers([l.id]); }}
      onDragOver={(e) => { if (!e.dataTransfer.types.includes('text/kdm-layer')) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setDrop(e.clientY - r.top < r.height / 2 ? 'above' : 'below'); }}
      onDragLeave={() => setDrop(null)}
      onDrop={(e) => {
        const id = e.dataTransfer.getData('text/kdm-layer'); setDrop(null); if (!id) return; e.preventDefault(); e.stopPropagation();
        const s = useMotion.getState(); const ids = s.selectedLayers.includes(id) ? s.selectedLayers : [id];
        A.reorderLayers(ids, drop === 'below' ? index + 1 : index);
      }}
      onClick={(e) => { const mod = e.ctrlKey || e.metaKey; if (e.shiftKey) { const s = useMotion.getState(); const last = comp.layers.findIndex((x) => x.id === s.selectedLayers[s.selectedLayers.length - 1]); const [a, b] = last < 0 ? [index, index] : [Math.min(last, index), Math.max(last, index)]; A.selectLayers(comp.layers.slice(a, b + 1).map((x) => x.id)); } else if (mod) useMotion.setState((s) => ({ selectedLayers: s.selectedLayers.includes(l.id) ? s.selectedLayers.filter((x) => x !== l.id) : [...s.selectedLayers, l.id] })); else A.selectLayers([l.id]); }}
      className={`relative flex items-center gap-1 pe-1.5 cursor-default border-b border-[#2a2e34] ${selected ? 'bg-[#2f4670]' : 'bg-[#22262b] hover:bg-[#282d33]'}`}
      style={{ height: LROW }}>
      {drop && <div className={`absolute left-0 right-0 h-0.5 bg-accent ${drop === 'above' ? '-top-px' : '-bottom-px'}`} />}
      <span className={`flex items-center gap-0.5 ps-1 shrink-0 ${ol.av ? 'w-[86px]' : 'w-[24px]'}`}>
        <Switch on={l.visible} label={l.visible ? 'Hide (eye)' : 'Show (eye)'} onClick={() => A.setLayer(l.id, { visible: !l.visible }, 'Show/Hide Layer')} dim={!visual}>{l.visible ? <LuEye size={12} /> : <LuEyeOff size={12} />}</Switch>
        {ol.av && <>
        <Switch on={l.audioOn && hasAudio} label={l.audioOn ? 'Mute audio' : 'Unmute audio'} onClick={() => A.setLayer(l.id, { audioOn: !l.audioOn }, 'Audio On/Off')} dim={!hasAudio}>{l.audioOn ? <LuVolume2 size={12} /> : <LuVolumeX size={12} />}</Switch>
        <Switch on={l.solo} label="Solo" onClick={() => A.setLayer(l.id, { solo: !l.solo }, 'Solo')}><span className={`w-2 h-2 rounded-full ${l.solo ? 'bg-amber' : 'border border-current'}`} /></Switch>
        <Switch on={l.locked} label={l.locked ? 'Unlock' : 'Lock'} onClick={() => A.setLayer(l.id, { locked: !l.locked }, 'Lock Layer')}>{l.locked ? <LuLock size={11} /> : <LuLockOpen size={11} className="opacity-60" />}</Switch>
        </>}
      </span>
      <span className="w-2.5 h-3.5 rounded-[2px] shrink-0" style={{ background: l.label }} aria-hidden />
      <span className="w-5 text-2xs text-faint num text-center shrink-0">{index + 1}</span>
      <button type="button" className="w-4 h-5 flex items-center justify-center text-muted hover:text-ink shrink-0" aria-label={open ? 'Collapse layer' : 'Expand layer'} aria-expanded={open} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
        <LuChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      <Icon size={12} className="text-muted shrink-0" />
      <div className="flex-1 min-w-0">
        {renaming ? (
          <input autoFocus className="field h-[18px] w-full text-xs" defaultValue={l.name} aria-label="Layer name" onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { A.setLayer(l.id, { name: e.currentTarget.value.trim() || l.name }, 'Rename Layer'); setRenaming(false); } if (e.key === 'Escape') setRenaming(false); }}
            onBlur={(e) => { A.setLayer(l.id, { name: e.currentTarget.value.trim() || l.name }, 'Rename Layer'); setRenaming(false); }} />
        ) : <span className={`block truncate text-xs ${l.visible ? 'text-ink' : 'text-faint'}`} onDoubleClick={(e) => { e.stopPropagation(); if (l.type === 'precomp') { A.openComp(l.compId); return; } setRenaming(true); }} data-tip={l.type === 'precomp' ? 'Double-click to open the composition' : undefined}>{l.name}</span>}
      </div>
      {ol.switches && <span className="flex items-center gap-0.5 w-[70px] shrink-0">
        <Switch on={!l.shy} label="Shy" onClick={() => A.setLayer(l.id, { shy: !l.shy }, 'Shy')}><span className="text-[9px]">{l.shy ? '◡' : '◠'}</span></Switch>
        <Switch on={l.effectsOn} label="Effects on/off (fx)" onClick={() => A.setLayer(l.id, { effectsOn: !l.effectsOn }, 'Effects On/Off')} dim={!l.effects.length}><span className="text-[10px] italic font-semibold">fx</span></Switch>
        <Switch on={l.motionBlur} label="Motion blur" onClick={() => A.setLayer(l.id, { motionBlur: !l.motionBlur }, 'Motion Blur')} dim={!visual}><span className="text-[9px] font-bold">◎</span></Switch>
        <Switch on={l.threeD} label="3D layer" onClick={() => A.setLayer(l.id, { threeD: !l.threeD }, '3D Layer')} dim={!visual || l.type === 'camera'}><LuBox size={11} /></Switch>
      </span>}
      {ol.parent && <select className="field h-[18px] w-[92px] text-2xs py-0 shrink-0" value={l.parentId ?? ''} aria-label="Parent" onClick={(e) => e.stopPropagation()} onChange={(e) => A.setParent(l.id, e.target.value || null)}>
        <option value="">None</option>
        {comp.layers.filter((x) => x.id !== l.id).map((x) => <option key={x.id} value={x.id}>{`${comp.layers.indexOf(x) + 1}. ${x.name}`}</option>)}
      </select>}
    </div>
  );
}

// ---------- tracks (right) ----------
function Tracks({ comp, rows, width, xOf, tOf, t, keySel, selected }: { comp: Composition; rows: Row[]; width: number; xOf: (t: number) => number; tOf: (x: number) => number; t: number; keySel: Set<string>; selected: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const pps = useMotion((s) => s.timeline.pxPerSec);
  const snap = useMotion((s) => s.timeline.snap);
  let y = 0;
  const placed = rows.map((r) => { const h = r.kind === 'layer' ? LROW : ROW; const top = y; y += h; return { r, top, h }; });

  const startKeyDrag = (e: React.PointerEvent, ref0: KeyRef) => {
    e.stopPropagation(); e.preventDefault();
    const s = useMotion.getState();
    const isSel = s.selectedKeys.some((k) => k.keyId === ref0.keyId);
    if (e.shiftKey) { useMotion.setState({ selectedKeys: isSel ? s.selectedKeys.filter((k) => k.keyId !== ref0.keyId) : [...s.selectedKeys, ref0] }); return; }
    if (!isSel) useMotion.setState({ selectedKeys: [ref0], selectedLayers: [ref0.layerId], graphProp: { layerId: ref0.layerId, path: ref0.path } });
    const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
    const x0 = e.clientX; let applied = 0; const mk = `keys-${Date.now()}`;
    const mm = (ev: PointerEvent) => {
      const dt = snapTime((ev.clientX - x0) / pps, comp.fps);
      if (dt !== applied) { A.moveSelectedKeys(dt - applied, mk); applied = dt; }
    };
    const up = () => { el.removeEventListener('pointermove', mm); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mm); el.addEventListener('pointerup', up);
  };

  const startBar = (e: React.PointerEvent, l: MLayer, mode: 'move' | 'in' | 'out') => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    const s = useMotion.getState();
    if (!s.selectedLayers.includes(l.id)) A.selectLayers([l.id], e.shiftKey);
    if (l.locked) return;
    const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
    const x0 = e.clientX; let applied = 0; const mk = `bar-${l.id}-${Date.now()}`;
    const ids = useMotion.getState().selectedLayers.includes(l.id) ? useMotion.getState().selectedLayers : [l.id];
    const ex = new Set(ids);
    const mm = (ev: PointerEvent) => {
      let dt = (ev.clientX - x0) / pps;
      if (mode === 'move') {
        if (snap) { const target = snapToEdges(comp, l.inPoint + dt, pps, ex, true); const target2 = snapToEdges(comp, l.outPoint + dt, pps, ex, true); if (target !== l.inPoint + dt) dt = target - l.inPoint; else if (target2 !== l.outPoint + dt) dt = target2 - l.outPoint; }
        dt = snapTime(dt, comp.fps);
        if (dt !== applied) { A.shiftLayersTime(ids, dt - applied, mk); applied = dt; }
      } else {
        const edge = mode === 'in' ? l.inPoint + dt : l.outPoint + dt;
        const tt = snap ? snapToEdges(comp, edge, pps, ex, true) : edge;
        A.trimLayer(l.id, mode === 'in' ? tt : null, mode === 'out' ? tt : null, mode === 'in' ? 'Trim In Point' : 'Trim Out Point', mk);
      }
    };
    const up = () => { el.removeEventListener('pointermove', mm); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mm); el.addEventListener('pointerup', up);
  };

  const startBox = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const r = ref.current!.getBoundingClientRect();
    const x0 = e.clientX - r.left, y0 = e.clientY - r.top;
    if (!e.shiftKey) useMotion.setState({ selectedKeys: [] });
    const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
    let moved = false;
    const mm = (ev: PointerEvent) => { const x1 = ev.clientX - r.left, y1 = ev.clientY - r.top; if (Math.abs(x1 - x0) + Math.abs(y1 - y0) > 4) moved = true; if (moved) setBox({ x0, y0, x1, y1 }); };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', mm); el.removeEventListener('pointerup', up);
      if (!moved) { setTime(snapTime(tOf(x0), comp.fps)); setBox(null); return; }
      const x1 = ev.clientX - r.left, y1 = ev.clientY - r.top;
      const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
      const refs: KeyRef[] = [...useMotion.getState().selectedKeys];
      for (const p of placed) {
        if (p.r.kind !== 'prop' || p.top + p.h < ay || p.top > by) continue;
        const prop = getProp(p.r.layer, p.r.meta.path); if (!prop) continue;
        for (const k of prop.k) { const kx = xOf(k.t); if (kx >= ax - 4 && kx <= bx + 4 && !refs.some((x) => x.keyId === k.id)) refs.push({ layerId: p.r.layer.id, path: p.r.meta.path, keyId: k.id }); }
      }
      useMotion.setState({ selectedKeys: refs }); setBox(null);
    };
    el.addEventListener('pointermove', mm); el.addEventListener('pointerup', up);
  };

  const p = useMotion.getState().project;
  return (
    <div ref={ref} className="relative flex-1 min-w-0 overflow-hidden touch-none" style={{ width }} onPointerDown={startBox}
      onContextMenu={(e) => { e.preventDefault(); if (useMotion.getState().selectedKeys.length) setMenu({ x: e.clientX, y: e.clientY }); }}>
      {/* work area shading */}
      <div className="absolute top-0 bottom-0 bg-white/[0.025] pointer-events-none" style={{ left: xOf(comp.workStart), width: xOf(comp.workEnd) - xOf(comp.workStart) }} />
      <div className="absolute top-0 bottom-0 bg-black/30 pointer-events-none" style={{ left: xOf(comp.duration), right: 0 }} />
      {placed.map(({ r, top, h }, i) => {
        if (r.kind === 'layer') {
          const l = r.layer; const sel = selected.includes(l.id);
          const a = xOf(l.inPoint), b = xOf(l.outPoint);
          let ghost: ReactNode = null;
          if (l.type === 'video' || l.type === 'audio' || l.type === 'precomp') {
            const len = l.type === 'precomp' ? p.comps[l.compId]?.duration : p.assets[l.assetId]?.duration;
            if (len) ghost = <div className="absolute rounded-[3px] border border-dashed border-white/15 pointer-events-none" style={{ left: xOf(l.start), width: (len / l.speed) * pps, top: top + 4, height: h - 8 }} />;
          }
          return (
            <div key={i}>
              <div className="absolute left-0 right-0 border-b border-[#2a2e34] pointer-events-none" style={{ top, height: h }} />
              {ghost}
              <div className={`absolute rounded-[3px] overflow-hidden cursor-grab ${sel ? 'ring-1 ring-white/80' : ''}`} role="presentation"
                style={{ left: a, width: Math.max(3, b - a), top: top + 3, height: h - 6, background: `${l.label}${sel ? 'cc' : '77'}` }}
                onPointerDown={(e) => startBar(e, l, 'move')} data-tip={`${l.name} · drag to move, drag the ends to trim`}>
                {(l.type === 'audio' || l.type === 'video') && <Waveform assetId={l.assetId} w={Math.max(3, b - a)} h={h - 6} start={(l.inPoint - l.start) * l.speed} dur={(l.outPoint - l.inPoint) * l.speed} />}
                <span className="absolute left-1.5 top-0 text-[10px] leading-[20px] text-white/85 truncate pointer-events-none" style={{ maxWidth: Math.max(0, b - a - 8) }}>{l.name}</span>
                <div className="absolute left-0 top-0 bottom-0 w-[6px] cursor-ew-resize hover:bg-white/30" onPointerDown={(e) => startBar(e, l, 'in')} />
                <div className="absolute right-0 top-0 bottom-0 w-[6px] cursor-ew-resize hover:bg-white/30" onPointerDown={(e) => startBar(e, l, 'out')} />
              </div>
              {/* collapsed: summary of the layer's keyframes */}
              <LayerKeySummary l={l} top={top} h={h} xOf={xOf} />
            </div>
          );
        }
        if (r.kind !== 'prop') return <div key={i} className="absolute left-0 right-0 border-b border-[#24282e] pointer-events-none" style={{ top, height: h }} />;
        const prop = getProp(r.layer, r.meta.path);
        return (
          <div key={i} className="absolute left-0 right-0 border-b border-[#24282e]" style={{ top, height: h }}>
            {prop && prop.k.length > 1 && <div className="absolute top-1/2 h-px bg-[#596270] pointer-events-none" style={{ left: xOf(prop.k[0].t), width: xOf(prop.k[prop.k.length - 1].t) - xOf(prop.k[0].t) }} />}
            {prop?.k.map((k) => (
              <div key={k.id} className="absolute top-1/2 -translate-y-1/2 -ml-[6px] w-[12px] h-[12px] flex items-center justify-center cursor-pointer" style={{ left: xOf(k.t) }}
                role="button" aria-label={`Keyframe at ${formatTimecode(k.t, comp.fps)}`} aria-pressed={keySel.has(k.id)}
                onPointerDown={(e) => startKeyDrag(e, { layerId: r.layer.id, path: r.meta.path, keyId: k.id })}
                onDoubleClick={(e) => { e.stopPropagation(); setTime(k.t); }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); const s = useMotion.getState(); if (!s.selectedKeys.some((x) => x.keyId === k.id)) useMotion.setState({ selectedKeys: [{ layerId: r.layer.id, path: r.meta.path, keyId: k.id }] }); setMenu({ x: e.clientX, y: e.clientY }); }}>
                <Diamond filled kind={keyKind(k)} selected={keySel.has(k.id)} size={11} />
              </div>
            ))}
          </div>
        );
      })}
      {/* time indicator */}
      <div className="absolute top-0 bottom-0 w-px bg-accent pointer-events-none" style={{ left: xOf(t), height: Math.max(y + 64, 2000) }} />
      {comp.markers.map((m) => <div key={m.id} className="absolute top-0 w-px bg-ok/40 pointer-events-none" style={{ left: xOf(m.t), height: Math.max(y + 64, 2000) }} />)}
      {box && <div className="absolute border border-accent bg-accent/10 pointer-events-none" style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />}
      {menu && <KeyMenu at={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

const keyKind = (k: Keyframe) => (k.interp === 'hold' ? 'hold' : k.interp === 'bezier' ? 'ease' : 'linear');

function LayerKeySummary({ l, top, h, xOf }: { l: MLayer; top: number; h: number; xOf: (t: number) => number }) {
  const expanded = useMotion((s) => !!s.timeline.expanded[l.id]);
  if (expanded) return null;
  const times = new Set<number>();
  const collect = (p: Prop) => p.k.forEach((k) => times.add(Math.round(k.t * 1000) / 1000));
  Object.values(l.transform).forEach(collect);
  l.effects.forEach((e) => Object.values(e.params).forEach((p) => collect(p as Prop)));
  l.masks.forEach((m) => [m.path, m.feather, m.opacity, m.expansion].forEach((p) => collect(p as Prop)));
  if (l.type === 'text') [l.text.size, l.text.color, l.text.tracking, l.text.animator.progress].forEach((p) => collect(p as Prop));
  if (l.type === 'shape') [l.shape.size, l.shape.fill, l.shape.trimEnd, l.shape.trimStart, l.shape.path].forEach((p) => collect(p as Prop));
  return <>{[...times].map((tt) => <div key={tt} className="absolute w-[5px] h-[5px] -ml-[2.5px] rotate-45 bg-white/70 pointer-events-none" style={{ left: xOf(tt), top: top + h - 7 }} />)}</>;
}

function KeyMenu({ at, onClose }: { at: { x: number; y: number }; onClose: () => void }) {
  const anchor = { getBoundingClientRect: () => new DOMRect(at.x, at.y, 0, 0), contains: () => false } as unknown as HTMLElement;
  const items: [string, () => void][] = [
    ['Linear', () => A.easeSelectedKeys('linear')], ['Easy Ease (F9)', () => A.easeSelectedKeys('easeInOut')], ['Easy Ease In', () => A.easeSelectedKeys('easeIn')],
    ['Easy Ease Out', () => A.easeSelectedKeys('easeOut')], ['Toggle Hold Keyframe', () => A.easeSelectedKeys('hold')],
    ['Copy', () => A.copySelectedKeys()], ['Duplicate', () => A.duplicateSelectedKeys()], ['Delete', () => A.deleteSelectedKeys()],
  ];
  return (
    <Popover anchor={anchor} onClose={onClose}>
      <div className="menu" role="menu">
        {items.map(([label, fn]) => <div key={label} role="menuitem" className="menu-item hover:bg-hover cursor-pointer" onClick={() => { onClose(); fn(); }}><span className="w-1" />{label}</div>)}
      </div>
    </Popover>
  );
}

function Waveform({ assetId, w, h, start, dur }: { assetId: string; w: number; h: number; start: number; dur: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const v = useAssetVersion((s) => s.v);
  useEffect(() => {
    const c = ref.current; const peaks = assetData(assetId)?.peaks; if (!c || !peaks) return;
    const W = Math.min(4000, Math.max(1, Math.round(w))), H = Math.max(1, Math.round(h));
    c.width = W; c.height = H; const x = c.getContext('2d')!; x.clearRect(0, 0, W, H);
    x.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < W; i++) {
      const s = Math.floor((start + (i / W) * dur) * 100), e = Math.max(s + 1, Math.floor((start + ((i + 1) / W) * dur) * 100));
      let m = 0; for (let j = s; j < e && j < peaks.length; j++) if (peaks[j] > m) m = peaks[j];
      const bh = Math.max(1, m * H * 0.9); x.fillRect(i, (H - bh) / 2, 1, bh);
    }
  }, [assetId, w, h, start, dur, v]);
  return <canvas ref={ref} className="absolute inset-0 w-full h-full pointer-events-none opacity-80" aria-hidden />;
}

function HScroll({ comp, width }: { comp: Composition; width: number }) {
  const tl = useMotion((s) => s.timeline);
  const total = Math.max(comp.duration * tl.pxPerSec + 80, width);
  const frac = Math.min(1, width / total), pos = Math.min(1 - frac, tl.scroll / total);
  return (
    <div className="h-3 shrink-0 bg-[#1a1d21] border-t border-line relative" style={{ marginInlineStart: useContext(OutlineCtx).w }}>
      <div className="absolute top-[3px] h-[6px] rounded-full bg-[#4a525d] hover:bg-[#5b6470] cursor-grab touch-none" style={{ left: `${pos * 100}%`, width: `${frac * 100}%` }}
        onPointerDown={(e) => {
          const el = e.currentTarget; el.setPointerCapture(e.pointerId); const x0 = e.clientX, s0 = tl.scroll; const pw = el.parentElement!.clientWidth;
          const mm = (ev: PointerEvent) => useMotion.setState((s) => ({ timeline: { ...s.timeline, scroll: Math.max(0, Math.min(total - width, s0 + ((ev.clientX - x0) / pw) * total)) } }));
          const up = () => { el.removeEventListener('pointermove', mm); el.removeEventListener('pointerup', up); };
          el.addEventListener('pointermove', mm); el.addEventListener('pointerup', up);
        }} />
    </div>
  );
}
export { LuPlus };
