// Graph Editor: value curves of one property with draggable keyframes and bezier ease handles.
import { useLayoutEffect, useRef, useState } from 'react';
import type { Composition, Keyframe, MLayer, Prop, PropValue, Vec2 } from '../types';
import { useMotion, getProp, setTime, allPropPaths } from '../store';
import { valueAt, segmentProgress, snapTime, LINEAR_IN, LINEAR_OUT } from '../anim';
import * as A from '../actions';
import { propMeta } from './propTree';
import { hexToRgb } from '../../utils/color';

const DIM_COLORS = ['#ff6b6b', '#5ad17a', '#4f8cff'];
const PAD = 24;

function dimsOf(v: PropValue): number[] | null {
  if (typeof v === 'number') return [v];
  if (Array.isArray(v)) return v as number[];
  if (typeof v === 'string' && v.startsWith('#')) { const c = hexToRgb(v); return [c.r, c.g, c.b]; }
  return null; // paths: progress graph
}

export function GraphEditor({ comp, t, xOf, tOf, width }: { comp: Composition; t: number; xOf: (t: number) => number; tOf: (x: number) => number; width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(240);
  const gp = useMotion((s) => s.graphProp);
  const selectedLayers = useMotion((s) => s.selectedLayers);
  const selectedKeys = useMotion((s) => s.selectedKeys);
  useLayoutEffect(() => { const el = ref.current; if (!el) return; const ro = new ResizeObserver(() => setH(el.clientHeight)); ro.observe(el); setH(el.clientHeight); return () => ro.disconnect(); }, []);

  // property shown: the clicked one, else the first animated property of the selected layer
  let layer: MLayer | undefined; let path = '';
  if (gp) { layer = comp.layers.find((l) => l.id === gp.layerId); path = gp.path; }
  if (!layer || !getProp(layer, path)) {
    layer = comp.layers.find((l) => selectedLayers.includes(l.id)) ?? comp.layers.find((l) => allPropPaths(l).some((p) => getProp(l, p)?.k.length));
    path = layer ? allPropPaths(layer).find((p) => (getProp(layer!, p)?.k.length ?? 0) > 0) ?? '' : '';
  }
  const prop = layer && path ? getProp(layer, path) : null;
  const meta = layer && path ? propMeta(layer, path) : null;

  const toolbar = (
    <div className="absolute top-1.5 right-2 z-10 flex items-center gap-1">
      <span className="text-2xs text-muted me-2">{layer && meta ? `${layer.name} › ${meta.label}` : ''}</span>
      {([['easeInOut', 'Easy Ease'], ['easeIn', 'Ease In'], ['easeOut', 'Ease Out'], ['linear', 'Linear'], ['hold', 'Hold']] as const).map(([k, label]) => (
        <button key={k} type="button" className="btn h-[22px] px-2 text-2xs" disabled={!selectedKeys.length} onClick={() => A.easeSelectedKeys(k)}>{label}</button>
      ))}
    </div>
  );
  if (!layer || !prop || !prop.k.length) {
    return <div ref={ref} className="absolute inset-0 flex items-center justify-center text-muted text-xs">{toolbar}Click a property name, or select a layer with keyframes, to see its animation curve.</div>;
  }

  const keys = prop.k;
  const sample = (tt: number) => dimsOf(valueAt(prop as Prop<PropValue>, tt));
  const isProgress = !dimsOf(keys[0].v);
  // value range
  const t0 = Math.max(0, tOf(0)), t1 = tOf(width);
  let lo = Infinity, hi = -Infinity;
  const steps = Math.max(40, Math.round(width / 3));
  const curves: number[][][] = [];
  const nd = isProgress ? 1 : Math.min(dimsOf(keys[0].v)!.length, meta?.kind === 'vec2' || meta?.kind === 'point' ? 2 : 3);
  for (let d = 0; d < nd; d++) curves.push([]);
  for (let i = 0; i <= steps; i++) {
    const tt = t0 + ((t1 - t0) * i) / steps;
    let vals: number[];
    if (isProgress) {
      const seg = keys.findIndex((k, j) => k.t <= tt && (keys[j + 1]?.t ?? Infinity) > tt);
      vals = [seg < 0 ? 0 : keys[seg + 1] ? seg + segmentProgress(keys[seg], keys[seg + 1], tt) : seg];
    } else vals = sample(tt)!.slice(0, nd);
    vals.forEach((v, d) => { curves[d].push([xOf(tt), v]); lo = Math.min(lo, v); hi = Math.max(hi, v); });
  }
  for (const k of keys) { const vv = isProgress ? [keys.indexOf(k)] : dimsOf(k.v)!.slice(0, nd); vv.forEach((v) => { lo = Math.min(lo, v); hi = Math.max(hi, v); }); }
  if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
  const span = hi - lo; lo -= span * 0.1; hi += span * 0.1;
  const yOf = (v: number) => PAD + (1 - (v - lo) / (hi - lo)) * (h - PAD * 2);
  const vOf = (y: number) => lo + (1 - (y - PAD) / (h - PAD * 2)) * (hi - lo);
  const keyVal = (k: Keyframe, d: number) => (isProgress ? keys.indexOf(k) : dimsOf(k.v)![d]);
  const sel = new Set(selectedKeys.map((k) => k.keyId));

  const dragKey = (e: React.PointerEvent, k: Keyframe, d: number) => {
    e.stopPropagation(); e.preventDefault();
    const ref0 = { layerId: layer!.id, path, keyId: k.id };
    const s = useMotion.getState();
    if (e.shiftKey) { useMotion.setState({ selectedKeys: sel.has(k.id) ? s.selectedKeys.filter((x) => x.keyId !== k.id) : [...s.selectedKeys, ref0] }); return; }
    if (!sel.has(k.id)) useMotion.setState({ selectedKeys: [ref0] });
    const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY; let appliedT = 0; const mk = `gkey-${Date.now()}`;
    const v0 = keyVal(k, d);
    const mm = (ev: PointerEvent) => {
      const dt = snapTime((ev.clientX - x0) / ((xOf(1) - xOf(0)) || 1), comp.fps);
      if (!ev.altKey && dt !== appliedT) { A.moveSelectedKeys(dt - appliedT, mk); appliedT = dt; }
      if (!isProgress && typeof k.v !== 'string' && Math.abs(ev.clientY - y0) > 2) {
        const nv = v0 + (vOf(ev.clientY - y0 + yOf(v0)) - v0);
        const cur = getProp(useMotion.getState().project.comps[comp.id].layers.find((l) => l.id === layer!.id)!, path)!.k.find((x) => x.id === k.id);
        if (!cur) return;
        const value: PropValue = typeof cur.v === 'number' ? nv : (cur.v as number[]).map((x, i) => (i === d ? nv : x)) as PropValue;
        A.setKeyHandles(layer!.id, path, k.id, { v: value }, 'Edit Keyframe Value', mk + 'v');
      }
    };
    const up = () => { el.removeEventListener('pointermove', mm); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mm); el.addEventListener('pointerup', up);
  };

  // ease handles on the primary dimension
  const primary = isProgress ? 0 : (() => { for (let d = 0; d < nd; d++) if (keys.some((k, i) => keys[i + 1] && Math.abs(keyVal(keys[i + 1], d) - keyVal(k, d)) > 1e-6)) return d; return 0; })();
  const handles: { k: Keyframe; which: 'out' | 'in'; x: number; y: number; ax: number; ay: number; seg: [Keyframe, Keyframe] }[] = [];
  keys.forEach((k, i) => {
    const n = keys[i + 1]; if (!n || k.interp === 'hold') return;
    const dt = n.t - k.t; let dv = keyVal(n, primary) - keyVal(k, primary); if (Math.abs(dv) < 1e-9) dv = (hi - lo) * 0.25;
    const out = k.interp === 'linear' ? LINEAR_OUT : k.out; const inn = n.in;
    handles.push({ k, which: 'out', seg: [k, n], ax: xOf(k.t), ay: yOf(keyVal(k, primary)), x: xOf(k.t + out[0] * dt), y: yOf(keyVal(k, primary) + out[1] * dv) });
    handles.push({ k: n, which: 'in', seg: [k, n], ax: xOf(n.t), ay: yOf(keyVal(n, primary)), x: xOf(k.t + inn[0] * dt), y: yOf(keyVal(k, primary) + inn[1] * dv) });
  });
  const dragHandle = (e: React.PointerEvent, hd: (typeof handles)[number]) => {
    e.stopPropagation(); e.preventDefault();
    const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
    const r = ref.current!.getBoundingClientRect(); const mk = `handle-${Date.now()}`;
    const [a, b] = hd.seg; const dt = b.t - a.t; let dv = keyVal(b, primary) - keyVal(a, primary); if (Math.abs(dv) < 1e-9) dv = (hi - lo) * 0.25;
    const mm = (ev: PointerEvent) => {
      const tx = tOf(ev.clientX - r.left), vy = vOf(ev.clientY - r.top);
      const nx = Math.max(0, Math.min(1, (tx - a.t) / dt)), ny = (vy - keyVal(a, primary)) / dv;
      const pt: Vec2 = [Math.round(nx * 1000) / 1000, Math.round(ny * 1000) / 1000];
      if (hd.which === 'out') A.setKeyHandles(layer!.id, path, a.id, { out: pt, interp: 'bezier' }, 'Edit Ease Handle', mk);
      else A.setKeyHandles(layer!.id, path, b.id, { in: pt, ...(a.interp === 'linear' ? {} : {}) }, 'Edit Ease Handle', mk);
      if (hd.which === 'in' && a.interp === 'linear') A.setKeyHandles(layer!.id, path, a.id, { interp: 'bezier', out: [...LINEAR_OUT] as Vec2 }, 'Edit Ease Handle', mk + 'a');
    };
    const up = () => { el.removeEventListener('pointermove', mm); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mm); el.addEventListener('pointerup', up);
  };
  void LINEAR_IN;

  // grid
  const gridT: number[] = []; const step = [0.04, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60].find((s) => s * (xOf(1) - xOf(0)) >= 60) ?? 120;
  for (let x = Math.floor(t0 / step) * step; x <= t1; x += step) gridT.push(x);
  const gridV: number[] = []; const vstep = (() => { const raw = (hi - lo) / 5; const p = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw; })();
  for (let v = Math.ceil(lo / vstep) * vstep; v <= hi; v += vstep) gridV.push(v);

  return (
    <div ref={ref} className="absolute inset-0 bg-[#1b1e22] overflow-hidden touch-none" onPointerDown={(e) => { if (e.target === e.currentTarget || (e.target as Element).tagName === 'svg') { const r = ref.current!.getBoundingClientRect(); setTime(snapTime(tOf(e.clientX - r.left), comp.fps)); useMotion.setState({ selectedKeys: [] }); } }}>
      {toolbar}
      <svg width={width} height={h} className="absolute inset-0">
        {gridT.map((x) => <line key={`t${x}`} x1={xOf(x)} x2={xOf(x)} y1={0} y2={h} stroke="#2a2f36" />)}
        {gridV.map((v) => <g key={`v${v}`}><line x1={0} x2={width} y1={yOf(v)} y2={yOf(v)} stroke="#262a30" /><text x={4} y={yOf(v) - 2} fill="#69727e" fontSize="9">{isProgress ? '' : Math.round(v * 100) / 100}</text></g>)}
        <line x1={xOf(t)} x2={xOf(t)} y1={0} y2={h} stroke="#4f8cff" />
        {curves.map((pts, d) => <polyline key={d} fill="none" stroke={nd === 1 ? '#e8b04c' : DIM_COLORS[d]} strokeWidth={1.6} points={pts.map(([x, v]) => `${x},${yOf(v)}`).join(' ')} />)}
        {handles.map((hd, i) => <line key={`hl${i}`} x1={hd.ax} y1={hd.ay} x2={hd.x} y2={hd.y} stroke="#9aa3ae" strokeWidth={1} />)}
      </svg>
      {handles.map((hd, i) => (
        <div key={`h${i}`} className="absolute w-[9px] h-[9px] -ml-[4.5px] -mt-[4.5px] rounded-full bg-[#ffd166] border border-[#1b1e22] cursor-move" style={{ left: hd.x, top: hd.y }}
          role="slider" aria-label={`${hd.which === 'out' ? 'Outgoing' : 'Incoming'} ease handle`} onPointerDown={(e) => dragHandle(e, hd)} />
      ))}
      {keys.map((k) => Array.from({ length: nd }, (_, d) => (
        <div key={`${k.id}${d}`} className="absolute w-[9px] h-[9px] -ml-[4.5px] -mt-[4.5px] cursor-pointer" style={{ left: xOf(k.t), top: yOf(keyVal(k, d)), background: sel.has(k.id) ? '#ffb547' : '#e8eaed', border: '1px solid #1b1e22' }}
          role="button" aria-label="Keyframe" onPointerDown={(e) => dragKey(e, k, d)} />
      )))}
      <div className="absolute bottom-1.5 left-2 text-2xs text-faint">Drag keyframes to change time/value · drag yellow handles to shape the ease · Alt-drag keeps time</div>
    </div>
  );
}
