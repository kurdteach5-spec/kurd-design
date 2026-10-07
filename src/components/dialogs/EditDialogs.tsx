import { useEffect, useRef, useState } from 'react';
import { Dialog, Row } from './Dialog';
import { closeDialog, openDialog, toast, toastError, useUI, type DialogDescriptor } from '../../state/uiStore';
import { filterById, defaultParams } from '../../filters/definitions';
import { runFilter, cancelFilters } from '../../filters/runner';
import { getPaintTarget, type PaintTarget } from '../../tools/helpers';
import { commit, getDocState } from '../../state/documentStore';
import { getEngine } from '../../canvas/engine';
import { ctx2d, createCanvas } from '../../utils/canvas';
import { applyFilter, blendResult, modifySelection, applyAdjustmentDestructive, setLastFilter } from '../../editor/editActions';
import { Checkbox, ColorButton, NumberField, Select, Slider } from '../ui/controls';
import { AdjustmentEditor } from '../panels/AdjustmentEditor';
import { defaultAdjustment, ADJUSTMENT_LABELS } from '../../layers/factory';
import { applyAdjustment } from '../../adjustments/process';
import type { Adjustment, AdjustmentKind, LayerEffects } from '../../types/document';
import { findLayer, updateLayer } from '../../layers/tree';
import { updateEffects, renameLayer, rasterizeById, newLayer } from '../../editor/layerActions';
import { addSmartFilter, withSmartFilter, type NewSmartFilter } from '../../editor/smartObjects';
import { uid, debounce } from '../../utils/id';
import { COMMANDS, formatShortcut } from '../../shortcuts/commands';
import { TOOL_GROUPS } from '../../tools/registry';
import { listAutosaves, listProjects, deleteProject, renameProject, type AutosaveRecord, type ProjectMeta } from '../../file-system/storage';
import { recoverAll, discardRecovery, openProject } from '../../editor/fileActions';
import { timeAgo } from '../../utils/id';
import { LuTrash2, LuPencil, LuFolderOpen } from 'react-icons/lu';
import { tr } from '../../i18n';

// ---------------- Filter ----------------
export function FilterDialog({ id }: { id: string }) {
  const def = filterById(id)!;
  const [params, setParams] = useState(() => defaultParams(def));
  const [previewOn, setPreviewOn] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const target = useRef<PaintTarget | null>(null);
  const done = useRef<string | null>(null); // params key of the computed preview
  const seq = useRef(0);
  const key = JSON.stringify(params);

  useEffect(() => {
    const s = getDocState(); if (!s) return;
    target.current = getPaintTarget(s);
    if (!target.current) closeDialog();
    return () => { cancelFilters('preview'); getEngine()?.clearOverride(); };
  }, []);

  const compute = useRef(debounce(async (p: typeof params, k: string) => {
    const t = target.current; const s = getDocState(); if (!t || !s) return;
    const my = ++seq.current;
    setProgress(0);
    try {
      const w = t.canvas.width, h = t.canvas.height;
      const data = ctx2d(t.base, true).getImageData(0, 0, w, h).data;
      const out = await runFilter(id, new Uint8ClampedArray(data), w, h, p, (pr) => { if (my === seq.current) setProgress(pr); }, 'preview');
      if (my !== seq.current) return;
      const res = createCanvas(w, h); ctx2d(res).putImageData(new ImageData(new Uint8ClampedArray(out), w, h), 0, 0);
      blendResult(t.canvas, t.base, res, s, t.ox, t.oy);
      done.current = k;
      getEngine()?.setOverride(t.preview(), false);
    } catch (e) { if ((e as Error).message !== 'cancelled') { console.error(e); toastError('The filter preview failed.'); } }
    finally { if (my === seq.current) setProgress(null); }
  }, 220));

  useEffect(() => {
    if (!previewOn) { cancelFilters('preview'); getEngine()?.clearOverride(); done.current = null; return; }
    cancelFilters('preview');
    compute.current(params, key);
  }, [key, previewOn]); // eslint-disable-line react-hooks/exhaustive-deps

  const ok = async () => {
    const t = target.current;
    if (t && done.current === key && previewOn && progress === null) {
      t.commit(def.name); getEngine()?.clearOverride(); closeDialog();
      setLastFilter({ id, params });
      return;
    }
    compute.current.cancel(); cancelFilters('preview'); getEngine()?.clearOverride(); closeDialog();
    await applyFilter(id, params);
  };
  return (
    <Dialog title={def.name} onClose={() => { compute.current.cancel(); closeDialog(); }} onSubmit={() => void ok()} nonModal width={340}
      footer={<><Checkbox label="Preview" checked={previewOn} onChange={setPreviewOn} /><div className="flex-1" /><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn btn-primary" onClick={() => void ok()}>Apply</button></>}>
      {def.params.length === 0 && <div className="text-muted">This filter has no settings.</div>}
      {def.params.map((p) => p.type === 'range'
        ? <Slider key={p.key} label={p.label} value={Number(params[p.key])} min={p.min!} max={p.max!} step={p.step} precision={p.step && p.step < 1 ? 1 : 0} unit={p.unit === 'levels' ? '' : p.unit} onChange={(v) => setParams((x) => ({ ...x, [p.key]: v }))} />
        : p.type === 'select'
          ? <Row key={p.key} label={p.label}><Select value={String(params[p.key])} options={p.options!} onChange={(v) => setParams((x) => ({ ...x, [p.key]: v }))} /></Row>
          : <Checkbox key={p.key} label={p.label} checked={!!params[p.key]} onChange={(v) => setParams((x) => ({ ...x, [p.key]: v }))} />)}
      <div className="h-1 rounded-full bg-[#1d2025] overflow-hidden" aria-hidden>{progress !== null && <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.max(4, progress * 100)}%` }} />}</div>
      <div className="text-faint">{getDocState()?.selection ? 'Applies inside the selection.' : 'Applies to the whole layer.'}</div>
    </Dialog>
  );
}

// ---------------- Smart filter (non-destructive, on a smart object) ----------------
export function SmartFilterDialog({ layerId, filter, kind, index }: { layerId: string; filter?: string; kind?: string; index?: number }) {
  const layer = findLayer(getDocState()?.layers ?? [], layerId);
  const existing = layer?.type === 'smart' && index !== undefined ? layer.filters[index] ?? null : null;
  const filterId = existing?.kind === 'filter' ? existing.filter : filter;
  const def = filterId ? filterById(filterId) : undefined;
  const adjKind = (existing?.kind === 'adjustment' ? existing.adjustment.kind : kind) as AdjustmentKind | undefined;
  const [params, setParams] = useState(() => (existing?.kind === 'filter' ? existing.params : def ? defaultParams(def) : {}));
  const [adj, setAdj] = useState<Adjustment | null>(() => (existing?.kind === 'adjustment' ? existing.adjustment : adjKind ? defaultAdjustment(adjKind) : null));
  const [previewOn, setPreviewOn] = useState(true);
  const entry = (): NewSmartFilter | null => (def ? { kind: 'filter', filter: def.id, params } : adj ? { kind: 'adjustment', adjustment: adj } : null);
  const label = def ? def.name : adjKind ? ADJUSTMENT_LABELS[adjKind] : '';
  const preview = useRef(debounce((f: NewSmartFilter | null, on: boolean) => {
    const l = findLayer(getDocState()?.layers ?? [], layerId);
    if (!on || !f || !l || l.type !== 'smart') { getEngine()?.clearOverride(); return; }
    getEngine()?.setOverride(withSmartFilter(l, f, index), false);
  }, 180));
  useEffect(() => { preview.current(entry(), previewOn); }, [JSON.stringify(params), adj, previewOn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { preview.current.cancel(); getEngine()?.clearOverride(); }, []);
  if (!layer || layer.type !== 'smart' || (!def && !adj)) { closeDialog(); return null; }
  const ok = () => { preview.current.cancel(); getEngine()?.clearOverride(); closeDialog(); const f = entry(); if (f) { addSmartFilter(layerId, f, label, index); if (def) setLastFilter({ id: def.id, params }); } };
  return (
    <Dialog title={label} onClose={closeDialog} onSubmit={ok} nonModal width={340}
      footer={<><Checkbox label="Preview" checked={previewOn} onChange={setPreviewOn} /><div className="flex-1" /><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn btn-primary" onClick={ok}>Apply</button></>}>
      {def && def.params.length === 0 && <div className="text-muted">This filter has no settings.</div>}
      {def && def.params.map((p) => p.type === 'range'
        ? <Slider key={p.key} label={p.label} value={Number(params[p.key])} min={p.min!} max={p.max!} step={p.step} precision={p.step && p.step < 1 ? 1 : 0} unit={p.unit === 'levels' ? '' : p.unit} onChange={(v) => setParams((x) => ({ ...x, [p.key]: v }))} />
        : p.type === 'select'
          ? <Row key={p.key} label={p.label}><Select value={String(params[p.key])} options={p.options!} onChange={(v) => setParams((x) => ({ ...x, [p.key]: v }))} /></Row>
          : <Checkbox key={p.key} label={p.label} checked={!!params[p.key]} onChange={(v) => setParams((x) => ({ ...x, [p.key]: v }))} />)}
      {adj && <AdjustmentEditor value={adj} onChange={setAdj} />}
      <div className="text-faint">Smart filter: the original stays untouched. Change, hide or remove it later in the Properties panel.</div>
    </Dialog>
  );
}

// ---------------- Destructive adjustment ----------------
export function AdjustmentDialog({ kind }: { kind: AdjustmentKind }) {
  const [adj, setAdj] = useState<Adjustment>(() => defaultAdjustment(kind));
  const [previewOn, setPreviewOn] = useState(true);
  const target = useRef<PaintTarget | null>(null);
  useEffect(() => {
    const s = getDocState(); if (s) target.current = getPaintTarget(s);
    if (!target.current) closeDialog();
    return () => getEngine()?.clearOverride();
  }, []);
  const preview = useRef(debounce((a: Adjustment, on: boolean) => {
    const t = target.current; const s = getDocState(); if (!t || !s) return;
    if (!on) { getEngine()?.clearOverride(); return; }
    const x = ctx2d(t.base, true); const img = x.getImageData(0, 0, t.base.width, t.base.height);
    applyAdjustment(img.data, img.width, img.height, a);
    const res = createCanvas(img.width, img.height); ctx2d(res).putImageData(img, 0, 0);
    blendResult(t.canvas, t.base, res, s, t.ox, t.oy);
    getEngine()?.setOverride(t.preview(), false);
  }, 60));
  useEffect(() => { preview.current(adj, previewOn); }, [adj, previewOn]);
  const ok = () => { preview.current.cancel(); getEngine()?.clearOverride(); closeDialog(); applyAdjustmentDestructive(adj, ADJUSTMENT_LABELS[kind]); };
  return (
    <Dialog title={ADJUSTMENT_LABELS[kind]} onClose={closeDialog} onSubmit={ok} nonModal width={340}
      footer={<><Checkbox label="Preview" checked={previewOn} onChange={setPreviewOn} /><div className="flex-1" /><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn btn-primary" onClick={ok}>Apply</button></>}>
      <AdjustmentEditor value={adj} onChange={setAdj} />
      <div className="text-faint">This edits pixels directly. For a non-destructive version use Layer › New Adjustment Layer.</div>
    </Dialog>
  );
}

// ---------------- Layer style ----------------
export function LayerStyleDialog({ layerId, tab }: { layerId: string; tab?: string }) {
  const s = getDocState(); const layer = s ? findLayer(s.layers, layerId) : null;
  const original = useRef<LayerEffects | null>(layer?.effects ?? null);
  const [fx, setFx] = useState<LayerEffects | null>(layer?.effects ?? null);
  const [active, setActive] = useState<keyof LayerEffects>((tab as keyof LayerEffects) ?? 'dropShadow');
  const opened = useRef(false);
  useEffect(() => {
    if (!fx || !layer) return;
    if (!opened.current) { opened.current = true; if (tab && !fx[active].enabled) { const n = { ...fx, [active]: { ...fx[active], enabled: true } }; setFx(n); return; } }
    updateEffects(layerId, fx, 'Layer Style');
  }, [fx]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!layer || !fx) { closeDialog(); return null; }
  const set = <K extends keyof LayerEffects>(k: K, patch: Partial<LayerEffects[K]>) => setFx((f) => f && { ...f, [k]: { ...f[k], ...patch, enabled: true } });
  const cancel = () => {
    if (original.current) commit((st) => ({ ...st, layers: updateLayer(st.layers, layerId, (l) => ({ ...l, effects: original.current! })) }), {});
    closeDialog();
  };
  const tabs: { k: keyof LayerEffects; label: string }[] = [{ k: 'dropShadow', label: 'Drop shadow' }, { k: 'outerGlow', label: 'Outer glow' }, { k: 'stroke', label: 'Stroke' }];
  return (
    <Dialog title={`Layer style · ${layer.name}`} onClose={cancel} onSubmit={closeDialog} nonModal width={460}
      footer={<><button className="btn" onClick={cancel}>Cancel</button><button className="btn btn-primary" onClick={closeDialog}>OK</button></>}>
      <div className="grid grid-cols-[140px_1fr] gap-4">
        <div className="flex flex-col gap-0.5" role="tablist">
          {tabs.map((t) => (
            <div key={t.k} role="tab" aria-selected={active === t.k} className={`flex items-center gap-2 px-2 h-8 rounded-[4px] cursor-default ${active === t.k ? 'bg-accent-soft text-ink-strong' : 'hover:bg-hover'}`} onClick={() => setActive(t.k)}>
              <input type="checkbox" className="accent-[#4f8cff]" checked={fx[t.k].enabled} aria-label={`Enable ${t.label}`} onChange={(e) => setFx({ ...fx, [t.k]: { ...fx[t.k], enabled: e.target.checked } })} onClick={(e) => e.stopPropagation()} />
              {t.label}
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          {active === 'dropShadow' && <>
            <Row label="Color"><ColorButton label="Shadow color" color={fx.dropShadow.color} onChange={(c) => set('dropShadow', { color: c })} /></Row>
            <Slider label="Opacity" value={Math.round(fx.dropShadow.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => set('dropShadow', { opacity: v / 100 })} />
            <Slider label="Angle" value={fx.dropShadow.angle} min={-180} max={180} unit="°" onChange={(v) => set('dropShadow', { angle: v })} />
            <Slider label="Distance" value={fx.dropShadow.distance} min={0} max={300} unit="px" onChange={(v) => set('dropShadow', { distance: v })} />
            <Slider label="Spread" value={fx.dropShadow.spread} min={0} max={100} unit="%" onChange={(v) => set('dropShadow', { spread: v })} />
            <Slider label="Size" value={fx.dropShadow.blur} min={0} max={250} unit="px" onChange={(v) => set('dropShadow', { blur: v })} />
          </>}
          {active === 'outerGlow' && <>
            <Row label="Color"><ColorButton label="Glow color" color={fx.outerGlow.color} onChange={(c) => set('outerGlow', { color: c })} /></Row>
            <Slider label="Opacity" value={Math.round(fx.outerGlow.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => set('outerGlow', { opacity: v / 100 })} />
            <Slider label="Spread" value={fx.outerGlow.spread} min={0} max={100} unit="%" onChange={(v) => set('outerGlow', { spread: v })} />
            <Slider label="Size" value={fx.outerGlow.blur} min={0} max={250} unit="px" onChange={(v) => set('outerGlow', { blur: v })} />
          </>}
          {active === 'stroke' && <>
            <Row label="Color"><ColorButton label="Stroke color" color={fx.stroke.color} onChange={(c) => set('stroke', { color: c })} /></Row>
            <Slider label="Size" value={fx.stroke.width} min={1} max={100} unit="px" onChange={(v) => set('stroke', { width: v })} />
            <Slider label="Opacity" value={Math.round(fx.stroke.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => set('stroke', { opacity: v / 100 })} />
          </>}
        </div>
      </div>
    </Dialog>
  );
}

// ---------------- Small dialogs ----------------
export function SelectionModifyDialog({ op }: { op: 'feather' | 'expand' | 'contract' | 'border' }) {
  const [v, setV] = useState(op === 'feather' ? 5 : op === 'border' ? 10 : 4);
  const label = { feather: 'Feather radius', expand: 'Expand by', contract: 'Contract by', border: 'Border width' }[op];
  const submit = () => { closeDialog(); modifySelection(op, v); };
  return (
    <Dialog title={{ feather: 'Feather selection', expand: 'Expand selection', contract: 'Contract selection', border: 'Border selection' }[op]} onClose={closeDialog} onSubmit={submit} width={320}>
      <Row label={label}><NumberField value={v} min={0.5} max={500} step={0.5} precision={1} unit="px" width={80} onChange={setV} /></Row>
    </Dialog>
  );
}

export function GridSettingsDialog() {
  const ui = useUI();
  return (
    <Dialog title="Grid settings" onClose={closeDialog} onSubmit={closeDialog} width={320}>
      <Row label="Gridline every"><NumberField value={ui.gridSize} min={2} max={2000} unit="px" width={80} onChange={(v) => useUI.setState({ gridSize: v })} /></Row>
      <Row label="Color"><ColorButton label="Grid color" color={ui.gridColor} onChange={(c) => useUI.setState({ gridColor: c })} /></Row>
      <Row label=""><Checkbox label="Show grid" checked={ui.showGrid} onChange={(v) => useUI.setState({ showGrid: v })} /></Row>
    </Dialog>
  );
}

export function NewGuideDialog() {
  const [o, setO] = useState<'h' | 'v'>('v'); const [pos, setPos] = useState(0);
  const submit = () => { closeDialog(); commit((s) => ({ ...s, guides: [...s.guides, { id: uid('g'), orientation: o, pos }] }), { history: 'New Guide' }); useUI.setState({ showGuides: true }); };
  return (
    <Dialog title="New guide" onClose={closeDialog} onSubmit={submit} width={320}>
      <Row label="Orientation"><Select value={o} onChange={setO} options={[{ value: 'v', label: 'Vertical' }, { value: 'h', label: 'Horizontal' }]} /></Row>
      <Row label="Position"><NumberField value={pos} unit="px" width={80} onChange={setPos} /></Row>
    </Dialog>
  );
}

export function ConfirmRasterizeDialog({ layerId, next }: { layerId: string; next?: DialogDescriptor }) {
  const l = findLayer(getDocState()?.layers ?? [], layerId);
  const kind = l?.type === 'text' ? 'text' : l?.type === 'smart' ? 'smart' : 'shape';
  const rasterizeNow = () => { closeDialog(); if (rasterizeById(layerId) && next) openDialog(next); };
  const useNewLayer = () => { closeDialog(); newLayer(); toast('New empty layer added above. Paint on it — the original stays editable.', 'info', 3500); };
  return (
    <Dialog title="Rasterize this layer?" onClose={closeDialog} onSubmit={rasterizeNow} width={420}
      footer={<>
        <button type="button" className="btn" onClick={closeDialog}>Cancel</button>
        {!next && <button type="button" className="btn" onClick={useNewLayer}>Use a new layer</button>}
        <button type="button" className="btn btn-primary" onClick={rasterizeNow}>Rasterize</button>
      </>}>
      <p className="text-ink leading-relaxed">
        {kind === 'smart'
          ? `“${l?.name ?? ''}” is a smart object. It keeps its original contents and smart filters, but it has no pixels for this tool to change.`
          : kind === 'text'
          ? `“${l?.name ?? ''}” is a text layer. It stays sharp and editable (you can still change the words and font), but it has no pixels for this tool to change.`
          : `“${l?.name ?? ''}” is a shape layer. It stays sharp and editable (you can still change its size, color and corners), but it has no pixels for this tool to change.`}
      </p>
      <p className="text-muted mt-2 leading-relaxed">{kind === 'smart'
        ? "Rasterizing turns it into a normal pixel layer. After that it can't be edited as a smart object anymore (Undo brings it back)."
        : kind === 'text'
        ? "Rasterizing turns it into a normal pixel layer. After that it can't be edited as text anymore (Undo brings it back)."
        : "Rasterizing turns it into a normal pixel layer. After that it can't be edited as a shape anymore (Undo brings it back)."}</p>
    </Dialog>
  );
}

export function RenameLayerDialog({ layerId }: { layerId: string }) {
  const l = findLayer(getDocState()?.layers ?? [], layerId);
  const [name, setName] = useState(l?.name ?? '');
  const submit = () => { closeDialog(); renameLayer(layerId, name); };
  return (
    <Dialog title="Rename layer" onClose={closeDialog} onSubmit={submit} width={340}>
      <input className="field w-full" value={name} onChange={(e) => setName(e.target.value)} aria-label="Layer name" data-autofocus />
    </Dialog>
  );
}

export function ShortcutsDialog() {
  const groups: [string, string[]][] = [
    ['File', ['file.new', 'file.open', 'file.save', 'file.saveAs', 'file.export', 'file.place', 'file.close']],
    ['Edit', ['edit.undo', 'edit.redo', 'edit.cut', 'edit.copy', 'edit.copyMerged', 'edit.paste', 'edit.duplicate', 'edit.clear', 'edit.fillFg', 'edit.fillBg', 'edit.freeTransform']],
    ['Layers', ['layer.new', 'layer.group', 'layer.ungroup', 'layer.clip', 'layer.mergeDown', 'layer.mergeVisible', 'layer.forward', 'layer.backward', 'layer.front', 'layer.back', 'layer.selectUp', 'layer.selectDown', 'layer.rename', 'layer.lock']],
    ['Select', ['select.all', 'select.none', 'select.reselect', 'select.inverse', 'select.allLayers', 'select.feather']],
    ['Image', ['image.imageSize', 'image.canvasSize', 'imageadj.levels', 'imageadj.curves', 'imageadj.hue-saturation', 'imageadj.color-balance', 'image.adj.invert', 'image.adj.desaturate', 'filter.last']],
    ['View', ['view.zoomIn', 'view.zoomOut', 'view.fit', 'view.100', 'view.rulers', 'view.grid', 'view.guides', 'view.extras', 'view.snap', 'view.rotLeft', 'view.rotRight']],
    ['Painting', ['colors.swap', 'colors.reset', 'brush.smaller', 'brush.larger']],
  ];
  return (
    <Dialog title="Keyboard shortcuts" onClose={closeDialog} footer={null} width={780}>
      <div className="columns-1 md:columns-3 gap-6">
        <div className="break-inside-avoid mb-4">
          <div className="text-ink-strong font-medium mb-1.5">Tools</div>
          {TOOL_GROUPS.filter((g) => g.key).map((g) => <div key={g.id} className="flex justify-between gap-3 py-0.5"><span className="text-muted">{g.tools.map((t) => t.label).join(' / ')}</span><kbd className="text-ink num">{g.key}</kbd></div>)}
          <div className="flex justify-between gap-3 py-0.5"><span className="text-muted">Cycle tools in a group</span><kbd className="text-ink">Shift+key</kbd></div>
          <div className="flex justify-between gap-3 py-0.5"><span className="text-muted">Temporary Hand tool</span><kbd className="text-ink">Space</kbd></div>
          <div className="flex justify-between gap-3 py-0.5"><span className="text-muted">Set opacity 10–100%</span><kbd className="text-ink">1 … 0</kbd></div>
          <div className="flex justify-between gap-3 py-0.5"><span className="text-muted">Toggle panels</span><kbd className="text-ink">Tab</kbd></div>
          <div className="flex justify-between gap-3 py-0.5"><span className="text-muted">Nudge layer (×10 with Shift)</span><kbd className="text-ink">Arrows</kbd></div>
        </div>
        {groups.map(([title, ids]) => (
          <div key={title} className="break-inside-avoid mb-4">
            <div className="text-ink-strong font-medium mb-1.5">{title}</div>
            {ids.map((id) => { const c = COMMANDS.get(id); if (!c?.shortcut) return null; return <div key={id} className="flex justify-between gap-3 py-0.5"><span className="text-muted">{c.label.replace('…', '')}</span><kbd className="text-ink num">{formatShortcut(c.shortcut)}</kbd></div>; })}
          </div>
        ))}
      </div>
      <div className="text-faint">Some browsers reserve Ctrl+N, Ctrl+W and Ctrl+T. Alt+N and Alt+W work everywhere; Free Transform is also in the Edit menu and the Properties panel.</div>
    </Dialog>
  );
}

export function AboutDialog() {
  return (
    <Dialog title="About KURD DESIGN" onClose={closeDialog} footer={null} width={400}>
      <div className="flex items-center gap-3">
        <Logo size={40} />
        <div><div className="text-ink-strong text-sm font-bold tracking-[0.06em]">KURD DESIGN</div><div className="text-muted">Version 1.0 · runs entirely in your browser</div></div>
      </div>
      <p className="text-muted leading-relaxed">Layered photo editing and graphic design: non-destructive adjustment layers, masks, vector shapes and editable text, PSD import/export, and local projects with autosave. Your files never leave this device.</p>
    </Dialog>
  );
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="#2c3138" />
      <path d="M10 7v18M10 16l9-9M13.5 13l6.5 12" fill="none" stroke="#4f8cff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="9" r="3" fill="#ffb547" />
    </svg>
  );
}

export function RecoverDialog() {
  const [list, setList] = useState<AutosaveRecord[] | null>(null);
  useEffect(() => { listAutosaves().then(setList).catch(() => setList([])); }, []);
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  if (list && !list.length) { closeDialog(); return null; }
  return (
    <Dialog title="Recover previous document?" onClose={closeDialog} width={460}
      footer={<><button className="btn btn-danger" onClick={() => { closeDialog(); void discardRecovery(); toast('Unsaved work discarded', 'info'); }}>Discard</button><div className="flex-1" /><button className="btn" onClick={closeDialog}>Decide later</button><button className="btn btn-primary" onClick={() => { closeDialog(); void recoverAll(); }}>Recover</button></>}>
      <div className="text-muted">KURD DESIGN closed before these documents were saved:</div>
      <div className="flex flex-col gap-2">
        {list?.map((r) => {
          const u = r.thumb ? URL.createObjectURL(r.thumb) : null; if (u) urls.current.push(u);
          return (
            <div key={r.docId} className="flex items-center gap-3 p-2 rounded-[6px] bg-[#1d2025] border border-line-soft">
              <div className="w-14 h-14 flex items-center justify-center checker rounded-[3px] overflow-hidden shrink-0">{u && <img src={u} alt="" className="max-w-full max-h-full" />}</div>
              <div className="min-w-0"><div className="text-ink-strong truncate">{r.name}</div><div className="text-faint num">{`${r.width} × ${r.height} · autosaved ${timeAgo(r.savedAt)}`}</div></div>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

export function ProjectsDialog() {
  const [list, setList] = useState<ProjectMeta[] | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const reload = () => listProjects().then(setList).catch(() => { setList([]); toastError('Browser storage is unavailable.'); });
  useEffect(() => { void reload(); }, []);
  return (
    <Dialog title="Projects" onClose={closeDialog} footer={null} width={560}>
      {list === null ? <div className="text-faint">Loading…</div> : !list.length ? <div className="text-muted">No saved projects yet. Press Ctrl/Cmd+S in a document to save it here.</div> : (
        <div className="flex flex-col divide-y divide-line-soft">
          {list.map((p) => (
            <div key={p.id} className="flex items-center gap-3 py-2">
              <div className="flex-1 min-w-0">
                {renaming === p.id
                  ? <input autoFocus className="field w-full" defaultValue={p.name} aria-label="Project name" onKeyDown={async (e) => { e.stopPropagation(); if (e.key === 'Enter') { await renameProject(p.id, e.currentTarget.value.trim() || p.name); setRenaming(null); void reload(); } if (e.key === 'Escape') setRenaming(null); }} onBlur={() => setRenaming(null)} />
                  : <div className="text-ink-strong truncate">{p.name}</div>}
                <div className="text-faint num">{`${p.width} × ${p.height} · ${p.layers} layers · edited ${timeAgo(p.updatedAt)}`}</div>
              </div>
              <button type="button" className="icon-btn" aria-label={`Open ${p.name}`} data-tip="Open" onClick={() => { closeDialog(); void openProject(p.id); }}><LuFolderOpen size={15} /></button>
              <button type="button" className="icon-btn" aria-label={`Rename ${p.name}`} data-tip="Rename" onClick={() => setRenaming(p.id)}><LuPencil size={14} /></button>
              <button type="button" className="icon-btn" aria-label={`Delete ${p.name}`} data-tip="Delete" onClick={async () => { if (confirm(tr('Delete “{0}”? This can\'t be undone.', p.name))) { await deleteProject(p.id); void reload(); } }}><LuTrash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
