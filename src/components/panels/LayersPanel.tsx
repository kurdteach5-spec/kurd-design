import { useRef, useState } from 'react';
import { useDocuments, selectActiveState, commit } from '../../state/documentStore';
import { flattenForPanel, findLayer, moveLayers } from '../../layers/tree';
import type { DocState, Layer } from '../../types/document';
import { LayerThumb, MaskThumb } from './LayerThumb';
import * as L from '../../editor/layerActions';
import { BLEND_MODES, run, ADJUSTMENT_KINDS } from '../../shortcuts/commands';
import { ADJUSTMENT_LABELS } from '../../layers/factory';
import { IconButton, NumberField, Popover, Select } from '../ui/controls';
import { openDialog } from '../../state/uiStore';
import { getEngine } from '../../canvas/engine';
import { isMac } from '../../utils/id';
import {
  LuEye, LuEyeOff, LuLock, LuLockOpen, LuFolder, LuFolderOpen, LuChevronRight, LuType, LuShapes, LuContrast, LuFilePlus, LuFolderPlus,
  LuTrash2, LuSparkles, LuSquareDashedBottom, LuCornerLeftDown, LuPenTool, LuLink,
} from 'react-icons/lu';

type Drop = { id: string; pos: 'above' | 'below' | 'inside' } | null;

export function LayersPanel() {
  const st = useDocuments(selectActiveState);
  const [drop, setDrop] = useState<Drop>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ el: HTMLElement; id: string; x: number; y: number } | null>(null);
  const [adjMenu, setAdjMenu] = useState<HTMLElement | null>(null);
  const dragIds = useRef<string[]>([]);
  if (!st) return <div className="p-4 text-muted">Open or create a document to see its layers.</div>;
  const rows = flattenForPanel(st.layers);
  const active = findLayer(st.layers, st.activeLayerId);
  const selected = new Set(st.selectedLayerIds.length ? st.selectedLayerIds : st.activeLayerId ? [st.activeLayerId] : []);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-2.5 py-2 flex flex-col gap-2 border-b border-line-soft">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <Select title="Blend mode" value={active?.blendMode ?? 'normal'} width="100%" onChange={(v) => L.setBlendMode(v)}
              options={active?.type === 'group' ? [[{ value: 'pass-through', label: 'Pass Through' }], ...BLEND_MODES] : BLEND_MODES} />
          </div>
          <NumberField label="Opacity" value={Math.round((active?.opacity ?? 1) * 100)} min={0} max={100} unit="%" width={52} disabled={!active}
            onChange={(v) => active && L.setLayerProps(active.id, { opacity: v / 100 })} />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-muted mr-1">Lock</span>
          <IconButton icon={active?.locked ? LuLock : LuLockOpen} label={active?.locked ? 'Unlock layer' : 'Lock layer'} pressed={!!active?.locked} onClick={() => L.toggleLock()} disabled={!active} square={22} size={13} />
          <IconButton icon={LuCornerLeftDown} label="Clipping mask" shortcut="Mod+Alt+G" pressed={!!active?.clipped} onClick={() => L.toggleClipping()} disabled={!active} square={22} size={13} />
          <div className="flex-1" />
          <NumberField label="Fill" value={Math.round((active?.fillOpacity ?? 1) * 100)} min={0} max={100} unit="%" width={52} disabled={!active || active.type === 'group' || active.type === 'adjustment'}
            onChange={(v) => active && L.setLayerProps(active.id, { fillOpacity: v / 100 })} />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-0.5" role="tree" aria-label="Layers" aria-multiselectable
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (drop && dragIds.current.length) commit((s) => ({ ...s, layers: moveLayers(s.layers, dragIds.current, drop.id, drop.pos) }), { history: 'Move Layer' });
          setDrop(null); dragIds.current = [];
        }}>
        {rows.map(({ layer, depth }) => (
          <LayerRow key={layer.id} layer={layer} depth={depth} st={st}
            selected={selected.has(layer.id)} active={layer.id === st.activeLayerId}
            drop={drop?.id === layer.id ? drop.pos : null} renaming={renaming === layer.id}
            onRename={(name) => { if (name !== null) L.renameLayer(layer.id, name); setRenaming(null); }}
            onStartRename={() => setRenaming(layer.id)}
            onDragStart={() => { dragIds.current = selected.has(layer.id) ? [...selected] : [layer.id]; }}
            onDragOverRow={(pos) => setDrop(dragIds.current.includes(layer.id) ? null : { id: layer.id, pos })}
            onContext={(el, x, y) => setMenu({ el, id: layer.id, x, y })} />
        ))}
      </div>
      <div className="flex items-center justify-end gap-0.5 px-1.5 h-9 border-t border-line-soft shrink-0">
        <IconButton icon={LuSparkles} label="Layer style" onClick={() => active && openDialog({ type: 'layer-style', layerId: active.id })} disabled={!active} />
        <IconButton icon={LuSquareDashedBottom} label={active?.mask ? 'Layer has a mask' : 'Add layer mask'} onClick={() => L.addLayerMask(st.selection ? 'selection' : 'reveal')} disabled={!active || !!active.mask} />
        <IconButton icon={LuContrast} label="New adjustment layer" onClick={(e) => setAdjMenu(e.currentTarget)} />
        <IconButton icon={LuFolderPlus} label="New group" shortcut="Mod+G" onClick={() => L.groupLayers()} disabled={!active} />
        <IconButton icon={LuFilePlus} label="New layer" shortcut="Mod+Shift+N" onClick={L.newLayer} />
        <IconButton icon={LuTrash2} label="Delete layer" onClick={() => L.deleteLayers()} disabled={!active} />
      </div>
      {adjMenu && (
        <Popover anchor={adjMenu} placement="left-start" onClose={() => setAdjMenu(null)}>
          <div className="menu" role="menu">
            {ADJUSTMENT_KINDS.map((k) => <div key={k} role="menuitem" className="menu-item hover:bg-hover cursor-pointer" onClick={() => { setAdjMenu(null); run(`adjlayer.${k}`); }}><span className="w-1" />{ADJUSTMENT_LABELS[k]}</div>)}
          </div>
        </Popover>
      )}
      {menu && <LayerContextMenu menu={menu} onClose={() => setMenu(null)} onRename={() => setRenaming(menu.id)} />}
    </div>
  );
}

function TypeIcon({ l }: { l: Layer }) {
  if (l.type === 'text') return <LuType size={12} />;
  if (l.type === 'shape') return <LuShapes size={12} />;
  if (l.type === 'adjustment') return <LuContrast size={12} />;
  return null;
}

function LayerRow({ layer, depth, st, selected, active, drop, renaming, onRename, onStartRename, onDragStart, onDragOverRow, onContext }: {
  layer: Layer; depth: number; st: DocState; selected: boolean; active: boolean; drop: 'above' | 'below' | 'inside' | null; renaming: boolean;
  onRename: (n: string | null) => void; onStartRename: () => void; onDragStart: () => void; onDragOverRow: (pos: 'above' | 'below' | 'inside') => void;
  onContext: (el: HTMLElement, x: number, y: number) => void;
}) {
  const mod = (e: React.MouseEvent) => (isMac ? e.metaKey : e.ctrlKey);
  const fx = layer.effects.dropShadow.enabled || layer.effects.outerGlow.enabled || layer.effects.stroke.enabled;
  const target = active ? st.editTarget : null;
  return (
    <div
      role="treeitem" aria-selected={selected} aria-level={depth + 1} aria-expanded={layer.type === 'group' ? layer.expanded : undefined}
      draggable={!renaming}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', layer.id); onDragStart(); }}
      onDragOver={(e) => {
        e.preventDefault(); e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect(); const y = (e.clientY - r.top) / r.height;
        onDragOverRow(layer.type === 'group' && y > 0.3 && y < 0.7 ? 'inside' : y < 0.5 ? 'above' : 'below');
      }}
      onClick={(e) => L.selectLayer(layer.id, mod(e) ? 'toggle' : e.shiftKey ? 'range' : 'single')}
      onContextMenu={(e) => { e.preventDefault(); if (!selected) L.selectLayer(layer.id); onContext(e.currentTarget, e.clientX, e.clientY); }}
      tabIndex={active ? 0 : -1}
      onKeyDown={(e) => { if (e.key === 'F2' || (e.key === 'Enter' && !renaming)) { e.preventDefault(); onStartRename(); } }}
      className={`group relative flex items-center gap-1.5 h-[42px] pr-2 cursor-default border-y border-transparent
        ${selected ? (active ? 'bg-[#2f4670]' : 'bg-[#2a3445]') : 'hover:bg-[#2b3037]'}
        ${drop === 'inside' ? '!border-accent' : ''}`}
      style={{ paddingLeft: 4 + depth * 14 }}
    >
      {drop === 'above' && <div className="absolute left-0 right-0 -top-px h-0.5 bg-accent pointer-events-none" />}
      {drop === 'below' && <div className="absolute left-0 right-0 -bottom-px h-0.5 bg-accent pointer-events-none" />}
      <button type="button" className="w-6 h-6 flex items-center justify-center text-muted hover:text-ink shrink-0" aria-label={layer.visible ? 'Hide layer' : 'Show layer'} data-tip={`${layer.visible ? 'Hide' : 'Show'} layer · Alt-click to solo`}
        onClick={(e) => { e.stopPropagation(); L.toggleVisibility(layer.id, e.altKey); }}>
        {layer.visible ? <LuEye size={14} /> : <LuEyeOff size={14} className="opacity-60" />}
      </button>
      {layer.type === 'group' ? (
        <button type="button" className="w-4 h-6 flex items-center justify-center text-muted hover:text-ink -mr-1" aria-label={layer.expanded ? 'Collapse group' : 'Expand group'}
          onClick={(e) => { e.stopPropagation(); L.toggleGroupExpanded(layer.id); }}>
          <LuChevronRight size={13} className={`transition-transform ${layer.expanded ? 'rotate-90' : ''}`} />
        </button>
      ) : layer.clipped ? <LuCornerLeftDown size={12} className="text-muted -mr-0.5 shrink-0" aria-label="Clipped" /> : null}
      <div className={`shrink-0 rounded-[3px] p-px ${target === 'content' && (layer.mask || layer.vectorMask) ? 'outline outline-1 outline-white/80' : ''}`}
        onClick={(e) => { if (mod(e)) { e.stopPropagation(); L.layerAlphaToSelection(layer.id); } else if (layer.mask || layer.vectorMask) { e.stopPropagation(); L.setEditTarget(layer.id, 'content'); } }}
        data-tip={`${isMac ? '⌘' : 'Ctrl'}-click to load as selection`}>
        {layer.type === 'group' ? <div className="w-8 h-8 flex items-center justify-center text-[#c9b37a]">{layer.expanded ? <LuFolderOpen size={20} /> : <LuFolder size={20} />}</div>
          : layer.type === 'adjustment' ? <div className="w-8 h-8 flex items-center justify-center bg-[#1d2025] rounded-[3px] text-muted"><LuContrast size={18} /></div>
          : <LayerThumb layer={layer} docW={st.width} docH={st.height} />}
      </div>
      {layer.mask && (
        <>
          <span role="button" aria-label={layer.mask.linked ? 'Unlink mask' : 'Link mask'} data-tip={layer.mask.linked ? 'Mask moves with layer' : 'Mask is unlinked'} className={`shrink-0 -mx-1 ${layer.mask.linked ? 'text-muted' : 'text-faint opacity-40'}`} onClick={(e) => { e.stopPropagation(); L.setMaskProps(layer.id, { linked: !layer.mask!.linked }); }}><LuLink size={10} /></span>
          <div className={`relative shrink-0 rounded-[3px] p-px ${target === 'mask' ? 'outline outline-1 outline-white/90' : ''}`}
            data-tip="Mask · Shift-click to disable · Alt-click to view"
            onClick={(e) => {
              e.stopPropagation();
              if (e.shiftKey) { L.toggleMaskEnabled(layer.id); return; }
              if (e.altKey) { const en = getEngine(); if (en) { en.showMaskOf = en.showMaskOf === layer.id ? null : layer.id; en.invalidateView(); } return; }
              L.setEditTarget(layer.id, 'mask');
            }}>
            <MaskThumb mask={layer.mask} docW={st.width} docH={st.height} />
            {!layer.mask.enabled && <span className="absolute inset-0 flex items-center justify-center text-danger text-lg font-bold pointer-events-none">✕</span>}
          </div>
        </>
      )}
      {layer.vectorMask && (
        <div className={`shrink-0 w-8 h-8 rounded-[3px] bg-[#9aa3ae] flex items-center justify-center text-[#1d2025] ${target === 'vectorMask' ? 'outline outline-1 outline-white' : ''} ${layer.vectorMask.enabled ? '' : 'opacity-40'}`}
          data-tip="Vector mask · Shift-click to disable" onClick={(e) => { e.stopPropagation(); if (e.shiftKey) L.updateVectorMask(layer.id, { enabled: !layer.vectorMask!.enabled }, 'Toggle Vector Mask'); else L.setEditTarget(layer.id, 'vectorMask'); }}>
          <LuPenTool size={14} />
        </div>
      )}
      <div className="flex-1 min-w-0 flex items-center gap-1.5 pl-0.5">
        {renaming ? (
          <input autoFocus className="field w-full" defaultValue={layer.name} aria-label="Layer name" onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') onRename(e.currentTarget.value); if (e.key === 'Escape') onRename(null); }}
            onBlur={(e) => onRename(e.currentTarget.value)} />
        ) : (
          <span className={`truncate ${layer.visible ? 'text-ink' : 'text-faint'} ${layer.clipped ? 'underline decoration-dotted underline-offset-2' : ''}`} onDoubleClick={(e) => { e.stopPropagation(); onStartRename(); }}>{layer.name}</span>
        )}
        <span className="text-muted shrink-0"><TypeIcon l={layer} /></span>
      </div>
      {fx && <span className="text-2xs italic text-muted shrink-0" data-tip="Layer style">fx</span>}
      {layer.blendMode !== 'normal' && layer.blendMode !== 'pass-through' && <span className="text-2xs text-faint shrink-0 hidden group-hover:inline">{layer.blendMode}</span>}
      {layer.locked && <LuLock size={12} className="text-muted shrink-0" aria-label="Locked" />}
    </div>
  );
}

function LayerContextMenu({ menu, onClose, onRename }: { menu: { el: HTMLElement; id: string; x: number; y: number }; onClose: () => void; onRename: () => void }) {
  const items: ([string, () => void] | '-')[] = [
    ['Rename…', onRename], ['Duplicate', L.duplicateLayers], ['Delete', () => L.deleteLayers()], '-',
    ['Layer Style…', () => openDialog({ type: 'layer-style', layerId: menu.id })], ['Create / Release Clipping Mask', L.toggleClipping], '-',
    ['Add Layer Mask', () => L.addLayerMask('reveal')], ['Add Vector Mask', () => L.addVectorMask('reveal')], ['Load as Selection', () => L.layerAlphaToSelection(menu.id)], '-',
    ['Group Layers', L.groupLayers], ['Merge Down / Selected', L.mergeSelected], ['Rasterize', L.rasterize], ['Flatten Image', L.flattenImage],
  ];
  const anchor = { getBoundingClientRect: () => new DOMRect(menu.x, menu.y, 0, 0), contains: () => false } as unknown as HTMLElement;
  return (
    <Popover anchor={anchor} onClose={onClose}>
      <div className="menu" role="menu">
        {items.map((it, i) => it === '-' ? <div key={i} className="menu-sep" /> :
          <div key={i} role="menuitem" className="menu-item hover:bg-hover cursor-pointer" onClick={() => { onClose(); it[1](); }}><span className="w-1" />{it[0]}</div>)}
      </div>
    </Popover>
  );
}
