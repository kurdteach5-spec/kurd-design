import { useEffect, useRef } from 'react';
import { useMotion } from '../store';
import * as A from '../actions';
import { assetData, useAssetVersion } from '../media/assets';
import { formatTimecode } from '../anim';
import { renderComp } from '../render/renderer';
import { openMotionDialog } from '../uiState';
import { importDialog } from '../commands';
import { LuFilm, LuImage, LuMusic, LuLayers, LuPlus, LuUpload, LuTrash2, LuPencil } from 'react-icons/lu';

export function ProjectPanel() {
  const project = useMotion((s) => s.project);
  const sel = useMotion((s) => s.selectedProjectItem);
  const active = useMotion((s) => s.activeCompId);
  const items = [...project.compOrder.map((id) => ({ id, kind: 'comp' as const })), ...project.assetOrder.map((id) => ({ id, kind: 'asset' as const }))];
  return (
    <div className="h-full flex flex-col min-h-0">
      <ItemPreview id={sel} />
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-line-soft">
        <button type="button" className="icon-btn" aria-label="New composition" data-tip="New composition (Ctrl+N)" onClick={() => openMotionDialog({ type: 'comp-settings', compId: null })}><LuPlus size={15} /></button>
        <button type="button" className="icon-btn" aria-label="Import file" data-tip="Import (Ctrl+I)" onClick={() => void importDialog()}><LuUpload size={14} /></button>
        <div className="flex-1" />
        <button type="button" className="icon-btn" aria-label="Rename" data-tip="Rename" disabled={!sel} onClick={() => sel && openMotionDialog({ type: 'rename', id: sel })}><LuPencil size={13} /></button>
        <button type="button" className="icon-btn" aria-label="Delete item" data-tip="Delete" disabled={!sel} onClick={() => sel && A.deleteProjectItem(sel)}><LuTrash2 size={13} /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-1" role="listbox" aria-label="Project items"
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
        onDrop={(e) => { const f = [...(e.dataTransfer.files ?? [])]; if (f.length) { e.preventDefault(); e.stopPropagation(); void A.importFiles(f, false); } }}>
        {!items.length && <div className="px-3 py-4 text-muted text-xs">Your compositions and imported footage appear here. Drop files to import.</div>}
        {items.map(({ id, kind }) => {
          const comp = kind === 'comp' ? project.comps[id] : null; const a = kind === 'asset' ? project.assets[id] : null;
          if (!comp && !a) return null;
          const Icon = comp ? LuLayers : a!.kind === 'video' ? LuFilm : a!.kind === 'audio' ? LuMusic : LuImage;
          const dur = comp ? comp.duration : a!.duration;
          return (
            <div key={id} role="option" aria-selected={sel === id} draggable className={`flex items-center gap-2 h-[26px] px-2.5 cursor-default text-xs ${sel === id ? 'bg-[#2f4670]' : 'hover:bg-[#282d33]'}`}
              onDragStart={(e) => { e.dataTransfer.setData('text/kdm-item', id); e.dataTransfer.effectAllowed = 'copy'; }}
              onClick={() => useMotion.setState({ selectedProjectItem: id })}
              onDoubleClick={() => { if (comp) A.openComp(id); else A.addAssetLayer(id); }}
              data-tip={comp ? 'Double-click to open · drag into the timeline to nest' : 'Double-click or drag into the timeline to add'}>
              <Icon size={13} className={comp ? 'text-[#9b8cff]' : 'text-muted'} />
              <span className={`flex-1 truncate ${active === id ? 'text-accent' : 'text-ink'}`} translate="no">{comp?.name ?? a!.name}</span>
              <span className="text-faint num text-2xs">{dur ? `${Math.round(dur * 10) / 10}s` : ''}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ItemPreview({ id }: { id: string | null }) {
  const project = useMotion((s) => s.project);
  const v = useAssetVersion((s) => s.v);
  const ref = useRef<HTMLCanvasElement>(null);
  const comp = id ? project.comps[id] : null; const a = id ? project.assets[id] : null;
  useEffect(() => {
    const c = ref.current; if (!c || (!comp && !a)) return;
    const W = 240, H = 120; c.width = W; c.height = H;
    const x = c.getContext('2d')!; x.fillStyle = '#1d2025'; x.fillRect(0, 0, W, H);
    const fit = (w: number, h: number) => { const k = Math.min(W / w, H / h); return [(W - w * k) / 2, (H - h * k) / 2, w * k, h * k]; };
    if (comp) {
      const img = renderComp(project, comp, Math.min(comp.duration / 2, 1), { quality: Math.min(1, 240 / comp.width), videoKey: 'thumb' });
      const [dx, dy, dw, dh] = fit(comp.width, comp.height); x.drawImage(img, dx, dy, dw, dh);
    } else if (a?.kind === 'image') { const d = assetData(a.id)?.image; if (d) { const [dx, dy, dw, dh] = fit(a.width, a.height); x.drawImage(d, dx, dy, dw, dh); } }
    else if (a?.kind === 'audio' || a?.kind === 'video') {
      const peaks = assetData(a.id)?.peaks;
      if (a.kind === 'video') { const vid = document.createElement('video'); vid.muted = true; vid.src = assetData(a.id)?.url ?? ''; vid.currentTime = Math.min(1, a.duration / 2); vid.onseeked = () => { const [dx, dy, dw, dh] = fit(a.width, a.height); x.drawImage(vid, dx, dy, dw, dh); vid.removeAttribute('src'); vid.load(); }; }
      else if (peaks) { x.fillStyle = '#4f8cff'; for (let i = 0; i < W; i++) { const p = peaks[Math.floor((i / W) * peaks.length)] ?? 0; x.fillRect(i, H / 2 - p * H * 0.45, 1, Math.max(1, p * H * 0.9)); } }
    }
  }, [id, comp, a, v]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!comp && !a) return <div className="h-[34px] px-3 flex items-center text-faint text-2xs border-b border-line-soft">Select an item to see its details.</div>;
  return (
    <div className="flex gap-2.5 p-2 border-b border-line-soft">
      <canvas ref={ref} className="w-[112px] h-[56px] rounded-[3px] bg-[#1d2025] shrink-0" aria-hidden />
      <div className="min-w-0 text-2xs text-muted leading-relaxed">
        <div className="text-ink text-xs truncate" translate="no">{comp?.name ?? a!.name}</div>
        {comp ? <>
          <div className="num">{comp.width} × {comp.height}</div>
          <div className="num">{formatTimecode(comp.duration, comp.fps)} · {comp.fps} fps</div>
        </> : <>
          {a!.kind !== 'audio' && <div className="num">{a!.width} × {a!.height}</div>}
          {a!.duration > 0 && <div className="num">{Math.round(a!.duration * 100) / 100}s</div>}
          <div>{a!.kind === 'video' ? 'Video' : a!.kind === 'audio' ? 'Audio' : 'Image'}{a!.kind === 'video' && assetData(a!.id)?.audio ? ' · with audio' : ''}</div>
        </>}
      </div>
    </div>
  );
}
