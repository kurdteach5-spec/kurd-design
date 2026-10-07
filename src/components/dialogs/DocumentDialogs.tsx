import { useMemo, useState } from 'react';
import { Dialog, Row } from './Dialog';
import { closeDialog, toastError } from '../../state/uiStore';
import { PRESETS } from '../../editor/presets';
import { newDocument, exportDocument, saveToProjects, downloadProject, downloadPsd, closeNow } from '../../editor/fileActions';
import { checkSize } from '../../utils/canvas';
import { Checkbox, ColorButton, NumberField, Select, Slider } from '../ui/controls';
import { commit, getDoc, getDocState, renameDocument } from '../../state/documentStore';
import { resizeCanvasDoc, resizeImageDoc, type Anchor } from '../../layers/docOps';
import { getEngine } from '../../canvas/engine';
import { useTools } from '../../state/toolStore';
import type { ColorMode } from '../../types/document';
import type { ExportFormat } from '../../file-system/exporters';
import { renderDocument } from '../../canvas/compositor';
import { formatBytes } from '../../utils/id';
import { LuArrowLeftRight } from 'react-icons/lu';

type Unit = 'px' | 'in' | 'cm' | 'mm';
const toPx = (v: number, u: Unit, dpi: number) => (u === 'px' ? v : u === 'in' ? v * dpi : u === 'cm' ? (v / 2.54) * dpi : (v / 25.4) * dpi);
const fromPx = (v: number, u: Unit, dpi: number) => (u === 'px' ? v : u === 'in' ? v / dpi : u === 'cm' ? (v / dpi) * 2.54 : (v / dpi) * 25.4);

export function NewDocumentDialog() {
  const [name, setName] = useState('Untitled');
  const [w, setW] = useState(1920); const [h, setH] = useState(1080);
  const [unit, setUnit] = useState<Unit>('px');
  const [dpi, setDpi] = useState(72);
  const [mode, setMode] = useState<ColorMode>('rgb');
  const [bg, setBg] = useState<'white' | 'black' | 'transparent' | 'color'>('white');
  const [bgColor, setBgColor] = useState('#f4f6f8');
  const [preset, setPreset] = useState<string>('fhd');
  const pw = Math.round(toPx(w, unit, dpi)), ph = Math.round(toPx(h, unit, dpi));
  const err = checkSize(pw, ph);
  const submit = () => {
    if (err) { toastError(err); return; }
    closeDialog();
    newDocument({ name: name.trim() || 'Untitled', width: pw, height: ph, dpi, colorMode: mode, background: bg, backgroundColor: bgColor });
  };
  const pick = (id: string) => {
    const p = PRESETS.find((x) => x.id === id); setPreset(id);
    if (!p) return;
    setUnit('px'); setW(p.width); setH(p.height); setDpi(p.dpi); if (name === 'Untitled' || PRESETS.some((x) => x.name === name)) setName(p.name);
  };
  const prec = unit === 'px' ? 0 : 2;
  return (
    <Dialog title="New document" onClose={closeDialog} onSubmit={submit} width={640}
      footer={<><span className="flex-1 text-muted num">{err ?? `${pw} × ${ph} px · ${formatBytes(pw * ph * 4)} per layer`}</span><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn btn-primary" disabled={!!err} onClick={submit}>Create</button></>}>
      <div className="grid grid-cols-[200px_1fr] gap-5">
        <div className="flex flex-col gap-0.5 max-h-[360px] overflow-y-auto pe-1" role="listbox" aria-label="Presets">
          {(['Social', 'Print', 'Screen'] as const).map((g) => (
            <div key={g} className="flex flex-col gap-0.5">
              <div className="text-faint px-2 pt-2 pb-1">{g}</div>
              {PRESETS.filter((p) => p.group === g).map((p) => (
                <button type="button" key={p.id} role="option" aria-selected={preset === p.id} onClick={() => pick(p.id)}
                  className={`text-start px-2 py-1.5 rounded-[4px] ${preset === p.id ? 'bg-accent-soft text-ink-strong' : 'hover:bg-hover'}`}>
                  <div>{p.name}</div><div className="text-faint num text-2xs">{p.width} × {p.height}</div>
                </button>
              ))}
            </div>
          ))}
          <button type="button" role="option" aria-selected={preset === 'custom'} onClick={() => setPreset('custom')} className={`text-start px-2 py-1.5 rounded-[4px] mt-1 ${preset === 'custom' ? 'bg-accent-soft text-ink-strong' : 'hover:bg-hover'}`}>Custom</button>
        </div>
        <div className="flex flex-col gap-3">
          <Row label="Name"><input className="field w-full" value={name} onChange={(e) => setName(e.target.value)} data-autofocus /></Row>
          <Row label="Width">
            <NumberField value={w} min={0.01} precision={prec} onChange={(v) => { setW(v); setPreset('custom'); }} width={90} />
            <Select value={unit} onChange={(u) => { setW(+fromPx(pw, u, dpi).toFixed(u === 'px' ? 0 : 2)); setH(+fromPx(ph, u, dpi).toFixed(u === 'px' ? 0 : 2)); setUnit(u); }} options={[{ value: 'px', label: 'Pixels' }, { value: 'in', label: 'Inches' }, { value: 'cm', label: 'Centimeters' }, { value: 'mm', label: 'Millimeters' }]} />
          </Row>
          <Row label="Height">
            <NumberField value={h} min={0.01} precision={prec} onChange={(v) => { setH(v); setPreset('custom'); }} width={90} />
            <button type="button" className="icon-btn" aria-label="Swap orientation" data-tip="Swap width and height" onClick={() => { setW(h); setH(w); }}><LuArrowLeftRight size={14} /></button>
          </Row>
          <Row label="Resolution"><NumberField value={dpi} min={1} max={2400} onChange={setDpi} width={90} /><span className="text-muted">pixels / inch</span></Row>
          <Row label="Color mode"><Select value={mode} onChange={setMode} options={[{ value: 'rgb', label: 'RGB Color, 8-bit' }, { value: 'grayscale', label: 'Grayscale, 8-bit' }]} /></Row>
          <Row label="Background">
            <Select value={bg} onChange={setBg} options={[{ value: 'white', label: 'White' }, { value: 'black', label: 'Black' }, { value: 'transparent', label: 'Transparent' }, { value: 'color', label: 'Custom color' }]} />
            {bg === 'color' && <ColorButton label="Background color" color={bgColor} onChange={setBgColor} />}
          </Row>
          <div className="flex items-center justify-center h-[110px] rounded-[6px] bg-[#1d2025] border border-line-soft">
            {(() => { const k = 90 / Math.max(pw || 1, ph || 1); return <div className={bg === 'transparent' ? 'checker' : ''} style={{ width: Math.max(6, pw * k), height: Math.max(6, ph * k), background: bg === 'white' ? '#fff' : bg === 'black' ? '#000' : bg === 'color' ? bgColor : undefined, boxShadow: '0 2px 10px rgba(0,0,0,.4)' }} />; })()}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

export function ImageSizeDialog() {
  const s = getDocState()!;
  const [w, setW] = useState(s.width); const [h, setH] = useState(s.height);
  const [dpi, setDpi] = useState(s.dpi); const [lock, setLock] = useState(true); const [resample, setResample] = useState(true);
  const err = checkSize(w, h);
  const submit = () => {
    if (err) { toastError(err); return; }
    closeDialog();
    if (w === s.width && h === s.height && dpi === s.dpi) return;
    commit((st) => resizeImageDoc(st, w, h, dpi, resample), { history: 'Image Size' });
    requestAnimationFrame(() => getEngine()?.fit());
  };
  return (
    <Dialog title="Image size" onClose={closeDialog} onSubmit={submit}>
      <Row label="Width"><NumberField value={w} min={1} unit="px" width={90} onChange={(v) => { setW(v); if (lock) setH(Math.max(1, Math.round((v * s.height) / s.width))); }} /><span className="text-faint num">{Math.round((w / s.width) * 100)}%</span></Row>
      <Row label="Height"><NumberField value={h} min={1} unit="px" width={90} onChange={(v) => { setH(v); if (lock) setW(Math.max(1, Math.round((v * s.width) / s.height))); }} /><span className="text-faint num">{Math.round((h / s.height) * 100)}%</span></Row>
      <Row label=""><Checkbox label="Constrain proportions" checked={lock} onChange={setLock} /></Row>
      <Row label="Resolution"><NumberField value={dpi} min={1} max={2400} width={90} onChange={setDpi} /><span className="text-muted">{`ppi · ${(w / dpi).toFixed(2)} × ${(h / dpi).toFixed(2)} in`}</span></Row>
      <Row label=""><Checkbox label="Resample pixel layers" checked={resample} onChange={setResample} title="Off keeps original pixels and scales them through the layer transform" /></Row>
      <div className="text-faint">Text and shape layers stay sharp at any size.</div>
      {err && <div className="text-danger">{err}</div>}
    </Dialog>
  );
}

export function CanvasSizeDialog() {
  const s = getDocState()!;
  const [w, setW] = useState(s.width); const [h, setH] = useState(s.height);
  const [rel, setRel] = useState(false); const [anchor, setAnchor] = useState<Anchor>('c');
  const [ext, setExt] = useState<'background' | 'white' | 'black' | 'transparent'>('white');
  const W = rel ? s.width + w : w, H = rel ? s.height + h : h;
  const err = checkSize(W, H);
  const submit = () => {
    if (err) { toastError(err); return; }
    closeDialog();
    const color = ext === 'transparent' ? null : ext === 'background' ? useTools.getState().background : ext === 'white' ? '#ffffff' : '#000000';
    commit((st) => resizeCanvasDoc(st, W, H, anchor, color), { history: 'Canvas Size' });
    requestAnimationFrame(() => getEngine()?.fit());
  };
  const anchors: Anchor[] = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'];
  const anchorName: Record<Anchor, string> = { tl: 'Top left', t: 'Top', tr: 'Top right', l: 'Left', c: 'Center', r: 'Right', bl: 'Bottom left', b: 'Bottom', br: 'Bottom right' };
  return (
    <Dialog title="Canvas size" onClose={closeDialog} onSubmit={submit}>
      <div className="text-muted num">{`Current: ${s.width} × ${s.height} px`}</div>
      <Row label="Width"><NumberField value={w} min={rel ? -s.width + 1 : 1} unit="px" width={90} onChange={setW} /></Row>
      <Row label="Height"><NumberField value={h} min={rel ? -s.height + 1 : 1} unit="px" width={90} onChange={setH} /></Row>
      <Row label=""><Checkbox label="Relative" checked={rel} onChange={(v) => { setRel(v); setW(v ? 0 : s.width); setH(v ? 0 : s.height); }} /></Row>
      <Row label="Anchor">
        <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Anchor" dir="ltr">
          {anchors.map((a) => <button type="button" key={a} role="radio" aria-checked={anchor === a} aria-label={`Anchor: ${anchorName[a]}`} onClick={() => setAnchor(a)} className={`w-6 h-6 rounded-[3px] border ${anchor === a ? 'bg-accent border-accent' : 'border-line hover:bg-hover'}`} />)}
        </div>
      </Row>
      <Row label="Extension color"><Select value={ext} onChange={setExt} options={[{ value: 'white', label: 'White' }, { value: 'black', label: 'Black' }, { value: 'background', label: 'Background color' }, { value: 'transparent', label: 'Transparent' }]} /></Row>
      <div className="text-faint">Extension color fills new area on a layer named “Background”. Content outside the canvas is kept in its layers.</div>
      {err && <div className="text-danger">{err}</div>}
    </Dialog>
  );
}

export function ExportDialog() {
  const s = getDocState()!;
  const [format, setFormat] = useState<ExportFormat>('png');
  const [scale, setScale] = useState(100);
  const [quality, setQuality] = useState(90);
  const [dpi, setDpi] = useState(s.dpi);
  const [transparent, setTransparent] = useState(true);
  const [bg, setBg] = useState('#ffffff');
  const w = Math.max(1, Math.round((s.width * scale) / 100)), h = Math.max(1, Math.round((s.height * scale) / 100));
  const preview = useMemo(() => {
    try { const c = renderDocument(s); const k = Math.min(1, 220 / Math.max(c.width, c.height)); const t = document.createElement('canvas'); t.width = Math.max(1, c.width * k); t.height = Math.max(1, c.height * k); t.getContext('2d')!.drawImage(c, 0, 0, t.width, t.height); return t.toDataURL(); } catch { return ''; }
  }, [s]);
  const supportsAlpha = format === 'png' || format === 'webp' || format === 'svg';
  const submit = async () => {
    const err = checkSize(w, h); if (err) { toastError(err); return; }
    closeDialog();
    await exportDocument({ format, quality: quality / 100, width: w, height: h, dpi, transparent: supportsAlpha && transparent, background: bg });
  };
  return (
    <Dialog title="Export as" onClose={closeDialog} onSubmit={() => void submit()} width={560}
      footer={<><span className="flex-1 text-muted num">{format === 'psd' ? `${s.width} × ${s.height} px · layered` : `${w} × ${h} px`}</span><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn btn-primary" onClick={() => void submit()}>Export</button></>}>
      <div className="grid grid-cols-[1fr_220px] gap-5">
        <div className="flex flex-col gap-3">
          <Row label="Format"><Select value={format} width="100%" onChange={setFormat} options={[{ value: 'png', label: 'PNG' }, { value: 'jpg', label: 'JPG' }, { value: 'webp', label: 'WEBP' }, { value: 'svg', label: 'SVG (vector where possible)' }, { value: 'pdf', label: 'PDF' }, { value: 'psd', label: 'PSD (layered)' }]} /></Row>
          {format !== 'psd' && <>
            <Row label="Scale"><NumberField value={scale} min={1} max={800} unit="%" width={80} onChange={setScale} />
              <Select value={String([25, 50, 100, 200, 300].includes(scale) ? scale : '')} onChange={(v) => v && setScale(Number(v))} options={[{ value: '', label: 'Preset…' }, { value: '25', label: '0.25×' }, { value: '50', label: '0.5×' }, { value: '100', label: '1×' }, { value: '200', label: '2×' }, { value: '300', label: '3×' }]} /></Row>
            <Row label="Width"><NumberField value={w} min={1} unit="px" width={90} onChange={(v) => setScale((v / s.width) * 100)} /></Row>
            <Row label="Height"><NumberField value={h} min={1} unit="px" width={90} onChange={(v) => setScale((v / s.height) * 100)} /></Row>
            {(format === 'jpg' || format === 'webp' || format === 'pdf') && <Slider label="Quality" value={quality} min={1} max={100} unit="%" onChange={setQuality} />}
            {format !== 'svg' && <Row label="Resolution"><NumberField value={dpi} min={1} max={2400} width={80} onChange={setDpi} /><span className="text-muted">ppi</span></Row>}
            <Row label="Background">
              {supportsAlpha && <Checkbox label="Transparent" checked={transparent} onChange={setTransparent} />}
              {(!supportsAlpha || !transparent) && <ColorButton label="Background color" color={bg} onChange={setBg} />}
            </Row>
          </>}
          {format === 'svg' && <div className="text-faint">Text and shapes export as editable vectors; pixel layers, masks and effects are embedded as images.</div>}
          {format === 'psd' && <div className="text-faint">Keeps layers, names, order, groups, opacity, blend modes, masks and visibility. Text is saved as pixels.</div>}
        </div>
        <div className="flex items-center justify-center rounded-[6px] bg-[#1d2025] border border-line-soft p-2 min-h-[220px]">
          {preview && <img src={preview} alt="Export preview" className={`max-w-full max-h-[220px] ${supportsAlpha && transparent ? 'checker' : ''}`} style={!supportsAlpha || !transparent ? { background: bg } : undefined} />}
        </div>
      </div>
    </Dialog>
  );
}

export function SaveAsDialog() {
  const d = getDoc()!;
  const [name, setName] = useState(d.name);
  const save = async () => { closeDialog(); renameDocument(name.trim() || 'Untitled'); await saveToProjects(name, true); };
  return (
    <Dialog title="Save as" onClose={closeDialog} onSubmit={() => void save()}
      footer={<><button className="btn" onClick={() => { closeDialog(); renameDocument(name.trim() || 'Untitled'); void downloadPsd(); }}>Download PSD</button><button className="btn" onClick={() => { closeDialog(); renameDocument(name.trim() || 'Untitled'); void downloadProject(); }}>Download .dps</button><div className="flex-1" /><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn btn-primary" onClick={() => void save()}>Save to Projects</button></>}>
      <Row label="Name"><input className="field w-full" value={name} onChange={(e) => setName(e.target.value)} data-autofocus /></Row>
      <div className="text-faint">Projects are stored in this browser and keep every layer editable. Download a .dps file to back up or move a project to another computer.</div>
    </Dialog>
  );
}

export function ConfirmCloseDialog({ docId }: { docId: string }) {
  const d = getDoc(docId);
  if (!d) { closeDialog(); return null; }
  return (
    <Dialog title="Save changes?" onClose={closeDialog}
      footer={<><button className="btn btn-danger" onClick={() => { closeDialog(); closeNow(docId); }}>Don’t save</button><div className="flex-1" /><button className="btn" onClick={closeDialog}>Cancel</button>
        <button className="btn btn-primary" onClick={async () => { closeDialog(); const prev = getDoc()?.id; if (prev !== docId) (await import('../../state/documentStore')).setActiveDocument(docId); if (await saveToProjects()) closeNow(docId); }}>Save</button></>}>
      <div>{d.smartLink ? `Apply your changes to the smart object “${d.name}” before closing?` : `“${d.name}” has unsaved changes. Save it to Projects before closing?`}</div>
    </Dialog>
  );
}
