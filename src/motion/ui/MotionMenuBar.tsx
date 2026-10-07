import { useEffect, useRef, useState } from 'react';
import { MCOMMANDS, EFFECT_MENU, runM } from '../commands';
import { formatShortcut } from '../../shortcuts/commands';
import { LuCheck, LuChevronRight } from 'react-icons/lu';
import { useMotion } from '../store';

type Entry = string | '-' | { label: string; items: Entry[] };

const MENUS: { label: string; items: Entry[] }[] = [
  { label: 'File', items: ['m.newProject', 'm.open', 'm.restore', '-', 'm.save', '-', 'm.import', '-', 'm.render', '-', 'm.design'] },
  { label: 'Edit', items: ['m.undo', 'm.redo', '-', 'm.copy', 'm.paste', 'm.duplicate', 'm.split', 'm.delete', '-', 'm.selectAll', 'm.deselect', 'm.selectKeys'] },
  { label: 'Composition', items: ['m.newComp', 'm.compSettings', '-', 'm.precompose', '-', 'm.workIn', 'm.workOut', 'm.trimComp', '-', 'm.marker', 'm.motionBlur', '-', 'm.render'] },
  { label: 'Layer', items: [
    { label: 'New', items: ['m.newSolid', 'm.newText', '-', 'm.newRect', 'm.newRounded', 'm.newEllipse', 'm.newPolygon', 'm.newStar', 'm.newLine', 'm.newArrow', '-', 'm.newNull', 'm.newAdjustment', '-', 'm.newCamera3d', 'm.newCamera2d'] },
    { label: 'Mask', items: ['m.maskRect', 'm.maskEllipse'] },
    '-', 'm.3d', 'm.mb', 'm.solo', 'm.lock', 'm.hide', '-', 'm.unparent', 'm.precompose', '-',
    { label: 'Time', items: ['m.trimIn', 'm.trimOut', '-', 'm.moveIn', 'm.moveOut', '-', 'm.split'] },
    { label: 'Arrange', items: ['m.front', 'm.forward', 'm.backward', 'm.back'] },
  ] },
  { label: 'Effect', items: ['m.removeEffects', '-', ...EFFECT_MENU] },
  { label: 'Animation', items: [
    { label: 'Keyframe Interpolation', items: ['m.linear', 'm.easy', 'm.easeIn', 'm.easeOut', 'm.hold'] },
    'm.autoBezier', 'm.linearPath', '-', 'm.selectKeys', 'm.revealTransform', 'm.revealAll', '-', 'm.fadeIn', 'm.fadeOut', 'm.savePreset', '-', 'm.prevKey', 'm.nextKey',
  ] },
  { label: 'View', items: ['m.zoomIn', 'm.zoomOut', 'm.fit', '-', 'm.qFull', 'm.qHalf', 'm.qQuarter', '-', 'm.grid', 'm.safe', 'm.paths', 'm.checker', '-', 'm.graph', 'm.tlZoomIn', 'm.tlZoomOut'] },
  { label: 'Help', items: ['m.shortcuts'] },
];

function MenuList({ items, onDone, depth = 0 }: { items: Entry[]; onDone: () => void; depth?: number }) {
  const [active, setActive] = useState(-1);
  const [sub, setSub] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useMotion((s) => s.version); // refresh enabled/checked states
  useEffect(() => { if (depth === 0) ref.current?.focus(); }, [depth]);
  const actionable = items.map((e, i) => (e === '-' ? -1 : i)).filter((i) => i >= 0);
  const activate = (i: number) => {
    const e = items[i];
    if (typeof e === 'string') { const c = MCOMMANDS.get(e); if (c && (!c.enabled || c.enabled())) { onDone(); runM(e); } }
    else if (typeof e === 'object') setSub(i);
  };
  return (
    <div ref={ref} className="menu max-h-[80vh] overflow-y-auto" role="menu" tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); const pos = actionable.indexOf(active); const n = actionable.length; setActive(actionable[(pos + (e.key === 'ArrowDown' ? 1 : -1) + n) % n]); setSub(null); }
        else if (e.key === 'Enter' || (e.key === 'ArrowRight' && typeof items[active] === 'object')) { e.preventDefault(); e.stopPropagation(); if (active >= 0) activate(active); }
      }}>
      {items.map((e, i) => {
        if (e === '-') return <div key={i} className="menu-sep" role="separator" />;
        if (typeof e === 'object') {
          return (
            <div key={i} className="relative" onMouseEnter={() => { setActive(i); setSub(i); }}>
              <div className="menu-item" role="menuitem" aria-haspopup="menu" aria-expanded={sub === i} data-active={active === i}><span className="w-3.5" /><span className="flex-1">{e.label}</span><LuChevronRight size={13} /></div>
              {sub === i && <div className="absolute start-full -top-1 ms-0.5 z-10"><MenuList items={e.items} onDone={onDone} depth={depth + 1} /></div>}
            </div>
          );
        }
        const c = MCOMMANDS.get(e); if (!c) return null;
        const enabled = !c.enabled || c.enabled();
        const checked = c.checked?.();
        return (
          <div key={i} className="menu-item" role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={checked} aria-disabled={!enabled} data-active={active === i && enabled}
            onMouseEnter={() => { setActive(i); setSub(null); }} onClick={() => activate(i)}>
            <span className="w-3.5 inline-flex">{checked && <LuCheck size={13} />}</span>
            <span className="flex-1">{c.label}</span>
            {c.shortcut && <span aria-hidden dir="ltr" className={`text-2xs ms-6 ${active === i && enabled ? 'text-white/80' : 'text-faint'}`}>{formatShortcut(c.shortcut)}</span>}
          </div>
        );
      })}
    </div>
  );
}

export function MotionMenuBar() {
  const [open, setOpen] = useState<number | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open === null) return;
    const down = (e: PointerEvent) => { if (!bar.current?.contains(e.target as Node)) setOpen(null); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(null); }
      if (e.key === 'ArrowRight' && !(e.target as HTMLElement).closest?.('[aria-haspopup]')) setOpen((o) => (o === null ? o : (o + 1) % MENUS.length));
      if (e.key === 'ArrowLeft') setOpen((o) => (o === null ? o : (o - 1 + MENUS.length) % MENUS.length));
    };
    window.addEventListener('pointerdown', down, true); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); };
  }, [open]);
  return (
    <div ref={bar} className="flex items-center h-full" role="menubar" aria-label="Motion menu">
      {MENUS.map((m, i) => (
        <div key={m.label} className="relative h-full">
          <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open === i}
            className={`h-full px-2.5 rounded-[4px] ${open === i ? 'bg-hover text-ink-strong' : 'text-ink hover:bg-hover'}`}
            onPointerDown={(e) => { e.preventDefault(); setOpen(open === i ? null : i); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); setOpen(i); } }}
            onMouseEnter={() => { if (open !== null) setOpen(i); }}>{m.label}</button>
          {open === i && <div className="absolute start-0 top-full mt-0.5 z-50"><MenuList items={m.items} onDone={() => setOpen(null)} /></div>}
        </div>
      ))}
    </div>
  );
}
