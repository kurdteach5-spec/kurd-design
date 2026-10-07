import { useRef, useState, type ReactNode } from 'react';
import type { MLayer, Prop, PropValue, Vec2, Vec3 } from '../types';
import { valueAt, sameTime } from '../anim';
import { getProp, useMotion, setTime } from '../store';
import * as A from '../actions';
import type { PropMeta } from './propTree';
import { ColorButton } from '../../components/ui/controls';
import { LuTimer, LuLink, LuUnlink } from 'react-icons/lu';

const round = (v: number, step = 1) => { const p = step < 1 ? Math.max(1, Math.ceil(-Math.log10(step))) : 0; const k = 10 ** p; return Math.round(v * k) / k; };

/** After Effects–style value: drag left/right to change, click to type. */
export function ScrubNumber({ value, onChange, step = 1, min = -Infinity, max = Infinity, unit, label, width, disabled }: {
  value: number; onChange: (v: number, final: boolean) => void; step?: number; min?: number; max?: number; unit?: string; label?: string; width?: number; disabled?: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const moved = useRef(false);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  if (editing !== null) {
    const commit = (s: string) => { setEditing(null); const v = Number(s.replace(',', '.')); if (Number.isFinite(v)) onChange(clamp(v), true); };
    return <input autoFocus className="field num h-[18px] px-1 text-xs" style={{ width: width ?? 56 }} defaultValue={editing} aria-label={label}
      onFocus={(e) => e.currentTarget.select()} onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commit(e.currentTarget.value); if (e.key === 'Escape') setEditing(null); }} />;
  }
  return (
    <span role="spinbutton" aria-label={label} aria-valuenow={value} tabIndex={disabled ? -1 : 0}
      className={`num inline-block text-xs select-none whitespace-nowrap touch-none ${disabled ? 'text-faint' : 'text-[#7fb2ff] cursor-ew-resize hover:underline'}`}
      style={{ minWidth: width ? undefined : 28 }}
      onKeyDown={(e) => { if (e.key === 'Enter') setEditing(String(round(value, step))); if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); onChange(clamp(value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)), true); } }}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const el = e.currentTarget; el.setPointerCapture(e.pointerId);
        const x0 = e.clientX, v0 = value; moved.current = false; let last = value;
        const move = (ev: PointerEvent) => {
          const dx = ev.clientX - x0; if (Math.abs(dx) > 2) moved.current = true;
          if (!moved.current) return;
          const k = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
          last = clamp(round(v0 + dx * step * k, step * (ev.altKey ? 0.1 : 1)));
          onChange(last, false);
        };
        const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); if (!moved.current) setEditing(String(round(value, step))); else onChange(last, true); };
        el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
      }}>
      {round(value, step)}{unit ? <span className="text-faint">{unit === '%' || unit === '°' ? unit : ` ${unit}`}</span> : null}
    </span>
  );
}

export function Diamond({ filled, size = 9, kind = 'linear', selected }: { filled?: boolean; size?: number; kind?: 'linear' | 'bezier' | 'hold' | 'ease'; selected?: boolean }) {
  const fill = selected ? '#ffb547' : filled ? '#c6d0dc' : 'none';
  const stroke = selected ? '#ffb547' : '#c6d0dc';
  const s = size;
  if (kind === 'hold') return <svg width={s} height={s} viewBox="0 0 10 10" aria-hidden><path d="M1 1h8v8H1z" fill={fill} stroke={stroke} /></svg>;
  if (kind === 'ease') return <svg width={s} height={s} viewBox="0 0 10 10" aria-hidden><path d="M1 1 L5 5 L1 9 Z M9 1 L5 5 L9 9 Z" fill={fill} stroke={stroke} strokeLinejoin="round" /></svg>;
  return <svg width={s} height={s} viewBox="0 0 10 10" aria-hidden><path d="M5 0.8L9.2 5L5 9.2L0.8 5Z" fill={fill} stroke={stroke} /></svg>;
}

/** Stopwatch + ◀ ◆ ▶ keyframe navigator for one property. */
export function KeyControls({ layer, path, prop, t, fps }: { layer: MLayer; path: string; prop: Prop; t: number; fps: number }) {
  const animated = prop.k.length > 0;
  const atKey = prop.k.some((k) => sameTime(k.t, t, fps));
  const prev = [...prop.k].reverse().find((k) => k.t < t - 0.5 / fps);
  const next = prop.k.find((k) => k.t > t + 0.5 / fps);
  return (
    <span className="inline-flex items-center gap-0.5 shrink-0">
      <button type="button" className={`w-5 h-5 flex items-center justify-center rounded-[3px] ${animated ? 'text-accent' : 'text-faint hover:text-ink'}`}
        aria-label={animated ? 'Stop animating (stopwatch)' : 'Animate this property (stopwatch)'} aria-pressed={animated} data-tip={animated ? 'Stopwatch: animated' : 'Stopwatch: click to animate'}
        onClick={(e) => { e.stopPropagation(); A.toggleStopwatch(layer.id, path); }}><LuTimer size={13} /></button>
      {animated && (
        <span className="inline-flex items-center">
          <button type="button" className="w-3.5 h-5 text-[10px] text-muted hover:text-ink disabled:opacity-30" disabled={!prev} aria-label="Previous keyframe" onClick={(e) => { e.stopPropagation(); if (prev) setTime(prev.t); }}>◀</button>
          <button type="button" className="w-4 h-5 flex items-center justify-center" aria-label={atKey ? 'Remove keyframe' : 'Add keyframe'} onClick={(e) => { e.stopPropagation(); A.toggleKeyframe(layer.id, path); }}><Diamond filled={atKey} /></button>
          <button type="button" className="w-3.5 h-5 text-[10px] text-muted hover:text-ink disabled:opacity-30" disabled={!next} aria-label="Next keyframe" onClick={(e) => { e.stopPropagation(); if (next) setTime(next.t); }}>▶</button>
        </span>
      )}
    </span>
  );
}

const scaleLinks = new Map<string, boolean>();

/** Value editor for one property at the current time. */
export function PropValueEditor({ layer, meta, t, compact }: { layer: MLayer; meta: PropMeta; t: number; compact?: boolean }) {
  const prop = getProp(layer, meta.path);
  const [, force] = useState(0);
  if (!prop) return null;
  const v = valueAt(prop as Prop<PropValue>, t);
  const set = (nv: PropValue) => A.setPropValue(layer.id, meta.path, nv);
  const disabled = layer.locked;
  switch (meta.kind) {
    case 'number': case 'percent': case 'angle':
      return <ScrubNumber value={v as number} step={meta.step ?? (meta.kind === 'angle' ? 1 : 1)} min={meta.min} max={meta.max} unit={meta.kind === 'percent' ? '%' : meta.kind === 'angle' ? '°' : meta.unit} label={meta.label} disabled={disabled} onChange={(x) => set(x)} />;
    case 'vec2': case 'vec3': case 'point': {
      const arr = v as number[];
      const dims = meta.kind === 'vec3' ? 3 : 2;
      const isScale = meta.path === 'transform.scale';
      const linkKey = `${layer.id}`;
      const linked = isScale && (scaleLinks.get(linkKey) ?? true);
      const change = (i: number, x: number) => {
        const out = [...arr];
        if (linked && arr[i] !== 0) { const f = x / arr[i]; for (let d = 0; d < dims; d++) out[d] = d === i ? x : round(arr[d] * f, 0.01); }
        else out[i] = x;
        set(out as Vec2 | Vec3);
      };
      return (
        <span className="inline-flex items-center gap-2">
          {isScale && <button type="button" className="text-muted hover:text-ink" aria-label={linked ? 'Unlink scale' : 'Link scale'} aria-pressed={linked} onClick={(e) => { e.stopPropagation(); scaleLinks.set(linkKey, !linked); force((n) => n + 1); }}>{linked ? <LuLink size={11} /> : <LuUnlink size={11} />}</button>}
          {Array.from({ length: dims }, (_, i) => (
            <ScrubNumber key={i} value={arr[i] ?? 0} step={meta.step ?? 1} min={meta.min} max={meta.max} unit={meta.unit === '%' ? '%' : undefined} label={`${meta.label} ${'XYZ'[i]}`} disabled={disabled} onChange={(x) => change(i, x)} />
          ))}
        </span>
      );
    }
    case 'color':
      return <ColorButton color={String(v)} size={compact ? 14 : 18} label={meta.label} onChange={(c) => set(c)} />;
    case 'select':
      return (
        <select className="field h-[20px] text-xs" value={String(v)} disabled={disabled} aria-label={meta.label} onChange={(e) => set(e.target.value)} onClick={(e) => e.stopPropagation()}>
          {(meta.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case 'checkbox':
      return <input type="checkbox" checked={!!v} disabled={disabled} aria-label={meta.label} onChange={(e) => set(e.target.checked ? 1 : 0)} onClick={(e) => e.stopPropagation()} />;
    case 'path':
      return <span className="text-faint text-xs">{(prop.k.length ? 'Animated path' : 'Path')} · edit in viewer</span>;
  }
}

export function PropLine({ layer, meta, t, fps, extra }: { layer: MLayer; meta: PropMeta; t: number; fps: number; extra?: ReactNode }) {
  const graph = useMotion((s) => s.graphProp);
  const prop = getProp(layer, meta.path); if (!prop) return null;
  const isGraph = graph?.layerId === layer.id && graph.path === meta.path;
  return (
    <div className="flex items-center gap-1.5 min-h-[24px]">
      <KeyControls layer={layer} path={meta.path} prop={prop} t={t} fps={fps} />
      <span className={`text-xs truncate min-w-0 cursor-default ${isGraph ? 'text-accent' : 'text-ink'}`} style={{ flex: '0 1 120px' }}
        onClick={() => useMotion.setState({ graphProp: { layerId: layer.id, path: meta.path } })}>{meta.label}</span>
      <div className="flex-1 min-w-0 flex items-center gap-1">{<PropValueEditor layer={layer} meta={meta} t={t} />}{extra}</div>
    </div>
  );
}
