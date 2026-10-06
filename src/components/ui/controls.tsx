import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatShortcut } from '../../shortcuts/commands';
import { clamp } from '../../utils/math';
import { ColorPicker } from './ColorPicker';

type IconType = (props: { size?: number | string; className?: string; strokeWidth?: number; style?: Record<string, unknown> }) => ReactNode;

export function IconButton({ icon: Icon, label, shortcut, onClick, pressed, disabled, size = 15, className = '', square }: {
  icon: IconType; label: string; shortcut?: string; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void; pressed?: boolean; disabled?: boolean; size?: number; className?: string; square?: number;
}) {
  return (
    <button
      type="button"
      className={`icon-btn ${className}`}
      style={square ? { width: square, height: square } : undefined}
      aria-label={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      data-tip={label}
      data-tip-key={shortcut ? formatShortcut(shortcut) : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={size} strokeWidth={1.75} />
    </button>
  );
}

/** Numeric input with a scrubbable label (drag horizontally to change). */
export function NumberField({ label, value, onChange, min = -Infinity, max = Infinity, step = 1, unit, width = 56, precision = 0, title, disabled }: {
  label?: ReactNode; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string; width?: number; precision?: number; title?: string; disabled?: boolean;
}) {
  const [text, setText] = useState(String(round(value, precision)));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(String(round(value, precision))); }, [value, editing, precision]);
  const commit = (t: string) => {
    // allow simple math like "200*2" or "50+10"
    let v = Number(t);
    if (Number.isNaN(v) && /^[\d.+\-*/() ]+$/.test(t)) { try { v = Number(Function(`"use strict";return (${t})`)()); } catch { v = NaN; } }
    if (Number.isFinite(v)) { const nv = clamp(v, min, max); if (round(nv, precision) !== round(value, precision)) onChange(nv); else setText(String(round(value, precision))); }
    else setText(String(round(value, precision)));
  };
  const scrub = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (disabled) return;
    const startX = e.clientX, start = value;
    const el = e.currentTarget; el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const k = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      onChange(clamp(round(start + Math.round((ev.clientX - startX) / 2) * step * k, precision), min, max));
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };
  return (
    <label className="inline-flex items-center gap-1.5 shrink-0" title={title}>
      {label !== undefined && <span className="text-muted cursor-ew-resize select-none" onPointerDown={scrub}>{label}</span>}
      <span className="relative inline-flex items-center">
        <input
          className="field num text-right" style={{ width, paddingRight: unit ? 18 : 6 }}
          value={text} disabled={disabled}
          onFocus={(e) => { setEditing(true); e.currentTarget.select(); }}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => { setEditing(false); commit(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { commit(e.currentTarget.value); e.currentTarget.blur(); }
            else if (e.key === 'Escape') { setText(String(round(value, precision))); e.currentTarget.blur(); }
            else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault(); const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
              const nv = clamp(round(value + d, precision), min, max); onChange(nv); setText(String(nv));
            }
          }}
          aria-label={title ?? (typeof label === 'string' ? label : undefined)}
        />
        {unit && <span className="absolute right-1.5 text-faint text-2xs pointer-events-none">{unit}</span>}
      </span>
    </label>
  );
}
const round = (v: number, p: number) => { const k = 10 ** p; return Math.round(v * k) / k; };

export function Slider({ label, value, min, max, step = 1, onChange, unit, precision = 0, inputWidth = 48 }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; unit?: string; precision?: number; inputWidth?: number;
}) {
  const p = ((value - min) / (max - min || 1)) * 100;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted">{label}</span>
        <NumberField value={value} onChange={onChange} min={min} max={max} step={step} unit={unit} width={inputWidth} precision={precision} title={label} />
      </div>
      <input type="range" className="slider" min={min} max={max} step={step} value={value} aria-label={label}
        style={{ ['--p' as string]: `${clamp(p, 0, 100)}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(clamp(0, min, max))} />
    </div>
  );
}

export function Select<T extends string>({ value, options, onChange, width, label, title }: {
  value: T; options: { value: T; label: string }[] | { value: T; label: string }[][]; onChange: (v: T) => void; width?: number | string; label?: string; title?: string;
}) {
  const groups = (Array.isArray(options[0]) ? options : [options]) as { value: T; label: string }[][];
  return (
    <label className={`inline-flex items-center gap-1.5 shrink-0 ${width === '100%' ? 'w-full' : ''}`}>
      {label && <span className="text-muted">{label}</span>}
      <select className="field" style={{ width }} value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={label ?? title} title={title}>
        {groups.map((g, i) => g.length && groups.length > 1
          ? <optgroup key={i} label="──────">{g.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
          : g.map((o) => <option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
    </label>
  );
}

export function Checkbox({ checked, onChange, label, title }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; title?: string }) {
  return (
    <label className="inline-flex items-center gap-1.5 cursor-pointer shrink-0" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[#4f8cff] w-3.5 h-3.5" />
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode; title: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-[5px] border border-line overflow-hidden shrink-0" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} aria-label={o.title} data-tip={o.title}
          className={`h-[22px] min-w-[24px] px-1.5 inline-flex items-center justify-center ${value === o.value ? 'bg-accent-soft text-[#9cc0ff]' : 'text-muted hover:bg-hover hover:text-ink'}`}
          onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** Floating layer anchored to an element. Closes on outside click / Escape. */
export function Popover({ anchor, onClose, children, placement = 'bottom-start', offset = 4 }: {
  anchor: HTMLElement | null; onClose: () => void; children: ReactNode; placement?: 'bottom-start' | 'right-start' | 'bottom-end' | 'left-start'; offset?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect(); const r = ref.current.getBoundingClientRect();
    let x = placement === 'right-start' ? a.right + offset : placement === 'bottom-end' ? a.right - r.width : placement === 'left-start' ? a.left - r.width - offset : a.left;
    let y = placement === 'right-start' || placement === 'left-start' ? a.top : a.bottom + offset;
    x = clamp(x, 4, window.innerWidth - r.width - 4); y = clamp(y, 4, window.innerHeight - r.height - 4);
    setPos({ x, y });
  }, [anchor, placement, offset]);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', down, true); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} className="fixed z-[900]" style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999 }}>{children}</div>,
    document.body,
  );
}

export function ColorButton({ color, onChange, label, size = 22, onCommit }: { color: string; onChange: (c: string) => void; label: string; size?: number; onCommit?: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} type="button" aria-label={label} data-tip={label}
        className="rounded-[4px] border border-[#4a515c] shrink-0 checker overflow-hidden cursor-pointer"
        style={{ width: size, height: size }} onClick={() => setOpen((o) => !o)}>
        <span className="block w-full h-full" style={{ background: color }} />
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => { setOpen(false); onCommit?.(color); }}>
          <div className="menu p-3 w-[248px]"><ColorPicker color={color} onChange={onChange} /></div>
        </Popover>
      )}
    </>
  );
}

export function Section({ title, children, defaultOpen = true, right }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-line-soft">
      <div className="flex items-center h-8 px-3">
        <button type="button" className="flex-1 text-left font-medium text-ink-strong flex items-center gap-1.5" aria-expanded={open} onClick={() => setOpen(!open)}>
          <svg width="8" height="8" viewBox="0 0 8 8" className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden><path d="M2 1l4 3-4 3z" fill="currentColor" /></svg>
          {title}
        </button>
        {right}
      </div>
      {open && <div className="px-3 pb-3 flex flex-col gap-2.5">{children}</div>}
    </div>
  );
}

/** Single global tooltip driven by data-tip attributes (cheap: one listener for the whole app). */
export function TooltipHost() {
  const [tip, setTip] = useState<{ text: string; key?: string; x: number; y: number; side: boolean } | null>(null);
  useEffect(() => {
    let timer = 0; let current: HTMLElement | null = null;
    const over = (e: PointerEvent) => {
      const el = (e.target as HTMLElement)?.closest?.('[data-tip]') as HTMLElement | null;
      if (el === current) return;
      current = el; clearTimeout(timer); setTip(null);
      if (!el) return;
      timer = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        const below = r.bottom + 30 < window.innerHeight;
        const side = el.closest('[data-tip-side="right"]');
        setTip({ side: !!side, text: el.dataset.tip!, key: el.dataset.tipKey, x: side ? r.right + 8 : r.left + r.width / 2, y: side ? r.top + r.height / 2 - 11 : below ? r.bottom + 6 : r.top - 28 });
      }, 450);
    };
    const hide = () => { clearTimeout(timer); current = null; setTip(null); };
    window.addEventListener('pointerover', over); window.addEventListener('pointerdown', hide, true); window.addEventListener('wheel', hide, { passive: true });
    return () => { window.removeEventListener('pointerover', over); window.removeEventListener('pointerdown', hide, true); window.removeEventListener('wheel', hide); };
  }, []);
  const ref = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);
  useLayoutEffect(() => {
    if (!tip || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    if (tip.side) { setDx(0); return; }
    const left = tip.x - r.width / 2;
    setDx(clamp(left, 4, window.innerWidth - r.width - 4) - tip.x);
  }, [tip]);
  if (!tip) return null;
  return createPortal(
    <div ref={ref} className="tip" role="tooltip" style={{ left: tip.x + dx, top: tip.y }}>{tip.text}{tip.key && <kbd>{tip.key}</kbd>}</div>,
    document.body,
  );
}
