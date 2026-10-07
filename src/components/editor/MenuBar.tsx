import { useEffect, useRef, useState } from 'react';
import { COMMANDS, formatShortcut, run, ADJUSTMENT_KINDS } from '../../shortcuts/commands';
import { FILTERS } from '../../filters/definitions';
import { LuCheck, LuChevronRight } from 'react-icons/lu';
import { useDocuments } from '../../state/documentStore';

type Entry = string | '-' | { label: string; items: Entry[] };
interface MenuDef { label: string; items: Entry[] }

const filterGroups = [...new Set(FILTERS.map((f) => f.group))].map((g) => ({ label: g, items: FILTERS.filter((f) => f.group === g).map((f) => `filter.${f.id}`) }));

export const MENUS: MenuDef[] = [
  { label: 'File', items: ['file.new', 'file.open', 'file.recent', 'file.home', '-', 'file.place', '-', 'file.save', 'file.saveAs', 'file.downloadProject', 'file.savePsd', '-', 'file.export', 'file.quickPng', '-', 'file.close'] },
  { label: 'Edit', items: ['edit.undo', 'edit.redo', '-', 'edit.cut', 'edit.copy', 'edit.copyMerged', 'edit.paste', 'edit.duplicate', 'edit.clear', '-', 'edit.fillFg', 'edit.fillBg', 'edit.stroke', '-', 'edit.freeTransform',
    { label: 'Transform', items: ['edit.transform.skew', 'edit.transform.distort', 'edit.transform.perspective', '-', 'edit.transform.rot180', 'edit.transform.rot90', 'edit.transform.rot-90', '-', 'edit.transform.flipH', 'edit.transform.flipV'] },
    '-', 'edit.shortcuts'] },
  { label: 'Image', items: [
    { label: 'Mode', items: ['image.mode.rgb', 'image.mode.gray'] },
    { label: 'Adjustments', items: ADJUSTMENT_KINDS.map((k) => `imageadj.${k}`) },
    '-', 'image.imageSize', 'image.canvasSize',
    { label: 'Image Rotation', items: ['image.rot180', 'image.rot90', 'image.rot-90', '-', 'image.flipH', 'image.flipV'] },
    '-', 'image.crop', 'image.trim', '-', 'image.adj.invert', 'image.adj.desaturate'] },
  { label: 'Layer', items: ['layer.new', { label: 'New Adjustment Layer', items: ADJUSTMENT_KINDS.map((k) => `adjlayer.${k}`) }, 'layer.duplicate', 'layer.delete', 'layer.rename', '-', 'layer.style',
    { label: 'Layer Mask', items: ['layer.mask.reveal', 'layer.mask.hide', 'layer.mask.selection', '-', 'layer.mask.edit', 'layer.mask.toggle', 'layer.mask.invert', '-', 'layer.mask.apply', 'layer.mask.delete'] },
    { label: 'Vector Mask', items: ['layer.vmask.reveal', 'layer.vmask.selection', '-', 'layer.vmask.delete'] },
    'layer.clip', '-', 'layer.group', 'layer.ungroup',
    { label: 'Arrange', items: ['layer.front', 'layer.forward', 'layer.backward', 'layer.back'] },
    { label: 'Align', items: ['layer.align.left', 'layer.align.hcenter', 'layer.align.right', '-', 'layer.align.top', 'layer.align.vcenter', 'layer.align.bottom', '-', 'layer.distribute.h', 'layer.distribute.v'] },
    '-', { label: 'Smart Objects', items: ['layer.smart.convert', 'layer.smart.edit', '-', 'layer.smart.rasterize'] }, 'layer.editText',
    '-', 'layer.mergeDown', 'layer.mergeVisible', 'layer.flatten', 'layer.rasterize', '-', 'layer.lock', 'layer.hide', 'layer.toSelection', '-', 'layer.selectUp', 'layer.selectDown'] },
  { label: 'Select', items: ['select.all', 'select.none', 'select.reselect', 'select.inverse', 'select.allLayers', '-', 'select.colorRange',
    { label: 'Modify', items: ['select.feather', 'select.expand', 'select.contract', 'select.border'] }, 'select.transform', '-', 'select.toMask', 'select.fromMask'] },
  { label: 'Filter', items: ['filter.last', 'filter.convertSmart', '-', ...filterGroups, '-', 'filter.dropShadow', 'filter.outerGlow'] },
  { label: 'View', items: ['view.zoomIn', 'view.zoomOut', 'view.fit', 'view.fill', 'view.100', 'view.200', 'view.center', '-', 'view.rotLeft', 'view.rotRight', 'view.rotReset', '-',
    'view.rulers', 'view.grid', 'view.guides', 'view.pixelGrid', 'view.extras', 'view.snap', '-', 'view.newGuide', 'view.guideCenter', 'view.clearGuides', 'view.gridSettings'] },
  { label: 'Window', items: ['window.layers', 'window.properties', 'window.color', 'window.swatches', 'window.history', 'window.adjustments', 'window.brush', 'window.character', 'window.paragraph', '-', 'window.docked', 'window.reset'] },
  { label: 'Help', items: ['help.shortcuts', '-', 'help.about'] },
];

function MenuList({ items, onDone, depth = 0 }: { items: Entry[]; onDone: () => void; depth?: number }) {
  const [active, setActive] = useState(-1);
  const [sub, setSub] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const actionable = items.map((e, i) => (e === '-' ? -1 : i)).filter((i) => i >= 0);
  useEffect(() => { if (depth === 0) ref.current?.focus(); }, [depth]);
  const activate = (i: number) => {
    const e = items[i];
    if (typeof e === 'string') { const c = COMMANDS.get(e); if (c && (!c.enabled || c.enabled())) { onDone(); run(e); } }
    else if (typeof e === 'object') setSub(i);
  };
  return (
    <div ref={ref} className="menu" role="menu" tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation();
          const pos = actionable.indexOf(active); const n = actionable.length;
          setActive(actionable[(pos + (e.key === 'ArrowDown' ? 1 : -1) + n) % n]); setSub(null);
        } else if (e.key === 'Enter' || (e.key === (document.documentElement.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight') && typeof items[active] === 'object')) { e.preventDefault(); e.stopPropagation(); if (active >= 0) activate(active); }
      }}>
      {items.map((e, i) => {
        if (e === '-') return <div key={i} className="menu-sep" role="separator" />;
        if (typeof e === 'object') {
          return (
            <div key={i} className="relative" onMouseEnter={() => { setActive(i); setSub(i); }}>
              <div className="menu-item" role="menuitem" aria-haspopup="menu" aria-expanded={sub === i} data-active={active === i}>
                <span className="w-3.5" /><span className="flex-1">{e.label}</span><LuChevronRight size={13} className="rtl:-scale-x-100" />
              </div>
              {sub === i && <div className="absolute start-full -top-1 ms-0.5 z-10"><MenuList items={e.items} onDone={onDone} depth={depth + 1} /></div>}
            </div>
          );
        }
        const c = COMMANDS.get(e); if (!c) return null;
        const enabled = !c.enabled || c.enabled();
        const checked = c.checked?.();
        return (
          <div key={i} className="menu-item" role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-keyshortcuts={c.shortcut?.split('|')[0].replace('Mod', 'Control')} aria-checked={checked} aria-disabled={!enabled} data-active={active === i && enabled}
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

export function MenuBar() {
  const [open, setOpen] = useState<number | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  useDocuments((s) => s.activeId); // re-render enabled states when switching documents
  useEffect(() => {
    if (open === null) return;
    const down = (e: PointerEvent) => { if (!bar.current?.contains(e.target as Node)) setOpen(null); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(null); }
      const rtl = document.documentElement.dir === 'rtl';
      const next = rtl ? 'ArrowLeft' : 'ArrowRight', prev = rtl ? 'ArrowRight' : 'ArrowLeft';
      if (e.key === next && !(e.target as HTMLElement).closest?.('[aria-haspopup]')) setOpen((o) => (o === null ? o : (o + 1) % MENUS.length));
      if (e.key === prev) setOpen((o) => (o === null ? o : (o - 1 + MENUS.length) % MENUS.length));
    };
    window.addEventListener('pointerdown', down, true); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); };
  }, [open]);
  return (
    <div ref={bar} className="flex items-center h-full" role="menubar">
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
