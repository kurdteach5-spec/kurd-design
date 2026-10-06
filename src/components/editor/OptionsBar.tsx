import { useEffect, useState, type ReactNode } from 'react';
import { useTools, setOptions, type SelectionMode } from '../../state/toolStore';
import { getEngine, subscribeEngine } from '../../canvas/engine';
import { useTransform, bumpTransform, commitTransform, cancelTransform } from '../../tools/transformState';
import { useCrop, applyCrop } from '../../tools/navTools';
import { useTextEdit, applyTextStyle, finishEditText } from '../../tools/textTool';
import { TOOLS, toolLabel } from '../../tools/registry';
import { TOOL_ICONS } from './toolIcons';
import { Checkbox, ColorButton, IconButton, NumberField, Segmented, Select } from '../ui/controls';
import { FONTS } from '../../utils/fonts';
import { alignLayers, distributeLayers } from '../../editor/layerActions';
import { useDocuments, selectActiveState } from '../../state/documentStore';
import { findLayer } from '../../layers/tree';
import type { TextStyle } from '../../types/document';
import {
  LuCheck, LuX, LuAlignHorizontalJustifyStart, LuAlignHorizontalJustifyCenter, LuAlignHorizontalJustifyEnd, LuAlignVerticalJustifyStart,
  LuAlignVerticalJustifyCenter, LuAlignVerticalJustifyEnd, LuAlignHorizontalSpaceAround, LuAlignVerticalSpaceAround, LuAlignLeft, LuAlignCenter,
  LuAlignRight, LuAlignJustify, LuItalic, LuUnderline, LuSquare, LuSquarePlus, LuSquareMinus, LuCombine, LuZoomIn, LuZoomOut,
} from 'react-icons/lu';

const Sep = () => <div className="w-px h-5 bg-line mx-1 shrink-0" />;
const Hint = ({ children }: { children: ReactNode }) => <span className="text-faint whitespace-nowrap">{children}</span>;

function useSession() {
  const [has, setHas] = useState(false);
  useEffect(() => {
    let raf = 0;
    const check = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setHas(!!getEngine()?.tool?.hasSession?.())); };
    check();
    const unsubs = [subscribeEngine(check), useTransform.subscribe(check), useCrop.subscribe(check), useTextEdit.subscribe(check), useTools.subscribe(check)];
    return () => { unsubs.forEach((u) => u()); cancelAnimationFrame(raf); };
  }, []);
  return has;
}

function ModeButtons({ value, onChange }: { value: SelectionMode; onChange: (m: SelectionMode) => void }) {
  return (
    <Segmented value={value} onChange={onChange} options={[
      { value: 'new', title: 'New selection', label: <LuSquare size={13} /> },
      { value: 'add', title: 'Add to selection (Shift)', label: <LuSquarePlus size={13} /> },
      { value: 'subtract', title: 'Subtract from selection (Alt)', label: <LuSquareMinus size={13} /> },
      { value: 'intersect', title: 'Intersect with selection (Shift+Alt)', label: <LuCombine size={13} /> },
    ]} />
  );
}

const pct = (v: number) => Math.round(v * 100);

function BrushFields({ k, hardness = true, flow = true }: { k: 'brush' | 'eraser' | 'clone'; hardness?: boolean; flow?: boolean }) {
  const o = useTools((s) => s.options[k]) as { size: number; hardness: number; opacity: number; flow: number };
  return (
    <>
      <NumberField label="Size" value={o.size} min={1} max={2500} unit="px" onChange={(v) => setOptions(k, { size: v })} width={62} />
      {hardness && <NumberField label="Hardness" value={pct(o.hardness)} min={0} max={100} unit="%" onChange={(v) => setOptions(k, { hardness: v / 100 })} />}
      <NumberField label="Opacity" value={pct(o.opacity)} min={1} max={100} unit="%" onChange={(v) => setOptions(k, { opacity: v / 100 })} />
      {flow && <NumberField label="Flow" value={pct(o.flow)} min={1} max={100} unit="%" onChange={(v) => setOptions(k, { flow: v / 100 })} />}
    </>
  );
}

function TransformFields() {
  useTransform((s) => s.version);
  const session = useTransform((s) => s.session);
  if (!session) return null;
  const i = session.info();
  const set = (patch: Parameters<typeof session.setNumeric>[0]) => { session.setNumeric(patch); const e = getEngine(); if (e) session.preview(e); bumpTransform(); };
  return (
    <>
      <NumberField label="X" value={Math.round(i.x)} onChange={(v) => set({ x: v })} unit="px" width={64} />
      <NumberField label="Y" value={Math.round(i.y)} onChange={(v) => set({ y: v })} unit="px" width={64} />
      <NumberField label="W" value={Math.round(i.w)} min={1} onChange={(v) => set({ w: v })} unit="px" width={64} />
      <NumberField label="H" value={Math.round(i.h)} min={1} onChange={(v) => set({ h: v })} unit="px" width={64} />
      <NumberField label="∠" title="Rotation" value={Math.round(i.angle * 10) / 10} precision={1} min={-180} max={180} onChange={(v) => set({ angle: v })} unit="°" width={60} />
      <Sep />
      <Select value={session.mode} title="Transform mode" onChange={(m) => { session.mode = m; bumpTransform(); }} options={[
        { value: 'free', label: 'Free transform' }, { value: 'skew', label: 'Skew' }, { value: 'distort', label: 'Distort' }, { value: 'perspective', label: 'Perspective' },
      ]} />
    </>
  );
}

function CropFields() {
  const o = useTools((s) => s.options.crop);
  const rect = useCrop((s) => s.rect);
  return (
    <>
      <Select label="Ratio" value={o.ratio} onChange={(v) => setOptions('crop', { ratio: v })} options={[
        { value: 'free', label: 'Free' }, { value: 'original', label: 'Original' }, { value: '1:1', label: '1 : 1 (Square)' }, { value: '4:3', label: '4 : 3' },
        { value: '3:2', label: '3 : 2' }, { value: '16:9', label: '16 : 9' }, { value: '9:16', label: '9 : 16 (Story)' },
      ]} />
      {rect && <>
        <NumberField label="W" value={Math.round(rect.w)} min={1} unit="px" width={64} onChange={(v) => useCrop.setState((s) => ({ rect: s.rect && { ...s.rect, w: v }, version: s.version + 1 }))} />
        <NumberField label="H" value={Math.round(rect.h)} min={1} unit="px" width={64} onChange={(v) => useCrop.setState((s) => ({ rect: s.rect && { ...s.rect, h: v }, version: s.version + 1 }))} />
      </>}
      <Checkbox label="Delete cropped pixels" checked={o.deleteCropped} onChange={(v) => setOptions('crop', { deleteCropped: v })} />
    </>
  );
}

const weightLabel: Record<number, string> = { 100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' };
export function TextFields({ compact = false }: { compact?: boolean }) {
  const defaults = useTools((s) => s.options.text);
  const st = useDocuments(selectActiveState);
  const editId = useTextEdit((s) => s.layerId);
  const layer = st ? findLayer(st.layers, editId ?? st.activeLayerId) : null;
  const s: TextStyle = layer?.type === 'text' ? layer.style : defaults;
  const font = FONTS.find((f) => f.family === s.fontFamily);
  const set = (p: Partial<TextStyle>) => applyTextStyle(p);
  return (
    <>
      <Select title="Font family" value={s.fontFamily} width={150} onChange={(v) => set({ fontFamily: v })}
        options={[FONTS.filter((f) => f.source === 'google').map((f) => ({ value: f.family, label: f.family })), FONTS.filter((f) => f.source === 'system').map((f) => ({ value: f.family, label: f.family }))]} />
      <Select title="Font weight" value={String(s.fontWeight)} width={96} onChange={(v) => set({ fontWeight: Number(v) })}
        options={(font?.weights ?? [400, 700]).map((w) => ({ value: String(w), label: weightLabel[w] ?? String(w) }))} />
      <NumberField title="Font size" label={<span className="font-serif">T</span>} value={s.fontSize} min={1} max={2000} unit="px" precision={1} onChange={(v) => set({ fontSize: v })} width={62} />
      <ColorButton label="Text color" color={s.color} onChange={(c) => set({ color: c })} />
      {!compact && <>
        <Segmented value={s.align} onChange={(v) => set({ align: v })} options={[
          { value: 'left', title: 'Align left', label: <LuAlignLeft size={13} /> }, { value: 'center', title: 'Align center', label: <LuAlignCenter size={13} /> },
          { value: 'right', title: 'Align right', label: <LuAlignRight size={13} /> }, { value: 'justify', title: 'Justify (paragraph text)', label: <LuAlignJustify size={13} /> },
        ]} />
        <IconButton icon={LuItalic} label="Italic" pressed={s.italic} onClick={() => set({ italic: !s.italic })} />
        <IconButton icon={LuUnderline} label="Underline" pressed={s.underline} onClick={() => set({ underline: !s.underline })} />
        <NumberField title="Letter spacing" label="VA" value={s.letterSpacing} min={-50} max={200} step={0.5} precision={1} unit="px" onChange={(v) => set({ letterSpacing: v })} />
        <NumberField title="Line height" label="↕" value={s.lineHeight} min={0.5} max={5} step={0.05} precision={2} onChange={(v) => set({ lineHeight: v })} width={50} />
      </>}
    </>
  );
}

function ShapeFields({ kind }: { kind: 'rect' | 'ellipse' | 'polygon' | 'line' | 'pen' }) {
  const o = useTools((s) => s.options.shape);
  const set = (p: Partial<typeof o>) => setOptions('shape', p);
  return (
    <>
      {kind !== 'line' && <>
        <Checkbox label="Fill" checked={o.fillEnabled} onChange={(v) => set({ fillEnabled: v })} />
        <ColorButton label="Fill color" color={o.fill} onChange={(c) => set({ fill: c, fillEnabled: true })} />
        <Sep />
        <Checkbox label="Stroke" checked={o.strokeEnabled} onChange={(v) => set({ strokeEnabled: v })} />
      </>}
      <ColorButton label="Stroke color" color={o.stroke} onChange={(c) => set({ stroke: c, strokeEnabled: true })} />
      {kind === 'line'
        ? <NumberField label="Weight" value={o.lineWidth} min={1} max={500} unit="px" onChange={(v) => set({ lineWidth: v })} />
        : <NumberField label="Width" value={o.strokeWidth} min={0} max={500} unit="px" onChange={(v) => set({ strokeWidth: v })} />}
      {kind === 'rect' && <><Sep /><NumberField label="Radius" value={o.radius} min={0} max={2000} unit="px" onChange={(v) => set({ radius: v })} /></>}
      {kind === 'polygon' && <>
        <Sep />
        <NumberField label="Sides" value={o.sides} min={3} max={64} onChange={(v) => set({ sides: v })} width={44} />
        <Checkbox label="Star" checked={o.star} onChange={(v) => set({ star: v })} />
        {o.star && <NumberField label="Inner" value={pct(o.innerRatio)} min={5} max={95} unit="%" onChange={(v) => set({ innerRatio: v / 100 })} />}
        <NumberField label="Round" value={o.radius} min={0} max={500} unit="px" onChange={(v) => set({ radius: v })} />
      </>}
      {kind === 'line' && <>
        <Sep />
        <Checkbox label="Arrow start" checked={o.arrowStart} onChange={(v) => set({ arrowStart: v })} />
        <Checkbox label="Arrow end" checked={o.arrowEnd} onChange={(v) => set({ arrowEnd: v })} />
      </>}
    </>
  );
}

function ToolOptions() {
  const tool = useTools((s) => s.tool);
  const o = useTools((s) => s.options);
  const transforming = useTransform((s) => !!s.session);
  switch (tool) {
    case 'move':
      return transforming ? <TransformFields /> : (
        <>
          <Checkbox label="Auto-select layer" checked={o.move.autoSelect} onChange={(v) => setOptions('move', { autoSelect: v })} title="Click picks the topmost layer under the cursor (Ctrl/Cmd-click works anytime)" />
          <Checkbox label="Transform controls" checked={o.move.showTransform} onChange={(v) => setOptions('move', { showTransform: v })} />
          <Sep />
          <IconButton icon={LuAlignHorizontalJustifyStart} label="Align left edges" onClick={() => alignLayers('left')} />
          <IconButton icon={LuAlignHorizontalJustifyCenter} label="Align horizontal centers" onClick={() => alignLayers('hcenter')} />
          <IconButton icon={LuAlignHorizontalJustifyEnd} label="Align right edges" onClick={() => alignLayers('right')} />
          <IconButton icon={LuAlignVerticalJustifyStart} label="Align top edges" onClick={() => alignLayers('top')} />
          <IconButton icon={LuAlignVerticalJustifyCenter} label="Align vertical centers" onClick={() => alignLayers('vcenter')} />
          <IconButton icon={LuAlignVerticalJustifyEnd} label="Align bottom edges" onClick={() => alignLayers('bottom')} />
          <IconButton icon={LuAlignHorizontalSpaceAround} label="Distribute horizontally" onClick={() => distributeLayers('h')} />
          <IconButton icon={LuAlignVerticalSpaceAround} label="Distribute vertically" onClick={() => distributeLayers('v')} />
          <Sep /><Hint>Single layer aligns to the canvas or selection</Hint>
        </>
      );
    case 'marquee-rect': case 'marquee-ellipse':
      return (
        <>
          <ModeButtons value={o.marquee.mode} onChange={(m) => setOptions('marquee', { mode: m })} />
          <NumberField label="Feather" value={o.marquee.feather} min={0} max={500} unit="px" onChange={(v) => setOptions('marquee', { feather: v })} />
          <Select label="Style" value={o.marquee.style} onChange={(v) => setOptions('marquee', { style: v })} options={[{ value: 'normal', label: 'Normal' }, { value: 'ratio', label: 'Fixed ratio' }, { value: 'fixed', label: 'Fixed size' }]} />
          {o.marquee.style !== 'normal' && <>
            <NumberField label="W" value={o.marquee.ratioW} min={0.01} precision={2} onChange={(v) => setOptions('marquee', { ratioW: v })} />
            <NumberField label="H" value={o.marquee.ratioH} min={0.01} precision={2} onChange={(v) => setOptions('marquee', { ratioH: v })} />
          </>}
        </>
      );
    case 'lasso': case 'lasso-polygon':
      return (
        <>
          <ModeButtons value={o.lasso.mode} onChange={(m) => setOptions('lasso', { mode: m })} />
          <NumberField label="Feather" value={o.lasso.feather} min={0} max={500} unit="px" onChange={(v) => setOptions('lasso', { feather: v })} />
          {tool === 'lasso-polygon' && <Hint>Click to add points · double-click or Enter to close · Backspace removes a point</Hint>}
        </>
      );
    case 'magic-wand':
      return (
        <>
          <ModeButtons value={o.wand.mode} onChange={(m) => setOptions('wand', { mode: m })} />
          <NumberField label="Tolerance" value={o.wand.tolerance} min={0} max={255} onChange={(v) => setOptions('wand', { tolerance: v })} width={48} />
          <Checkbox label="Anti-alias" checked={o.wand.antiAlias} onChange={(v) => setOptions('wand', { antiAlias: v })} />
          <Checkbox label="Contiguous" checked={o.wand.contiguous} onChange={(v) => setOptions('wand', { contiguous: v })} />
          <Checkbox label="Sample all layers" checked={o.wand.sampleAll} onChange={(v) => setOptions('wand', { sampleAll: v })} />
        </>
      );
    case 'crop': return <CropFields />;
    case 'eyedropper':
      return (
        <>
          <Select label="Sample size" value={String(o.eyedropper.size)} onChange={(v) => setOptions('eyedropper', { size: Number(v) as 1 | 3 | 5 })} options={[{ value: '1', label: 'Point' }, { value: '3', label: '3 × 3 average' }, { value: '5', label: '5 × 5 average' }]} />
          <Select label="Sample" value={o.eyedropper.sample} onChange={(v) => setOptions('eyedropper', { sample: v })} options={[{ value: 'all', label: 'All layers' }, { value: 'current', label: 'Current layer' }]} />
          <Hint>Alt-click sets the background color</Hint>
        </>
      );
    case 'brush':
      return (
        <>
          <BrushFields k="brush" />
          <NumberField label="Smoothing" value={pct(o.brush.smoothing)} min={0} max={100} unit="%" onChange={(v) => setOptions('brush', { smoothing: v / 100 })} />
          <Checkbox label="Pen pressure → size" checked={o.brush.pressureSize} onChange={(v) => setOptions('brush', { pressureSize: v })} />
        </>
      );
    case 'pencil':
      return (
        <>
          <NumberField label="Size" value={o.pencil.size} min={1} max={500} unit="px" onChange={(v) => setOptions('pencil', { size: v })} />
          <NumberField label="Opacity" value={pct(o.pencil.opacity)} min={1} max={100} unit="%" onChange={(v) => setOptions('pencil', { opacity: v / 100 })} />
          <Hint>Hard-edged, aliased strokes</Hint>
        </>
      );
    case 'eraser':
      return (
        <>
          <Select label="Mode" value={o.eraser.mode} onChange={(v) => setOptions('eraser', { mode: v })} options={[{ value: 'brush', label: 'Brush' }, { value: 'pencil', label: 'Pencil' }]} />
          <BrushFields k="eraser" hardness={o.eraser.mode === 'brush'} flow={o.eraser.mode === 'brush'} />
        </>
      );
    case 'clone-stamp':
      return (
        <>
          <BrushFields k="clone" />
          <Checkbox label="Aligned" checked={o.clone.aligned} onChange={(v) => setOptions('clone', { aligned: v })} />
          <Checkbox label="Sample all layers" checked={o.clone.sampleAll} onChange={(v) => setOptions('clone', { sampleAll: v })} />
          <Hint>Alt-click to set the source</Hint>
        </>
      );
    case 'blur': case 'sharpen': case 'smudge':
      return (
        <>
          <NumberField label="Size" value={o.retouch.size} min={1} max={1000} unit="px" onChange={(v) => setOptions('retouch', { size: v })} />
          <NumberField label="Hardness" value={pct(o.retouch.hardness)} min={0} max={100} unit="%" onChange={(v) => setOptions('retouch', { hardness: v / 100 })} />
          <NumberField label="Strength" value={pct(o.retouch.strength)} min={1} max={100} unit="%" onChange={(v) => setOptions('retouch', { strength: v / 100 })} />
        </>
      );
    case 'dodge': case 'burn':
      return (
        <>
          <NumberField label="Size" value={o.tone.size} min={1} max={1000} unit="px" onChange={(v) => setOptions('tone', { size: v })} />
          <Select label="Range" value={o.tone.range} onChange={(v) => setOptions('tone', { range: v })} options={[{ value: 'shadows', label: 'Shadows' }, { value: 'midtones', label: 'Midtones' }, { value: 'highlights', label: 'Highlights' }]} />
          <NumberField label="Exposure" value={pct(o.tone.exposure)} min={1} max={100} unit="%" onChange={(v) => setOptions('tone', { exposure: v / 100 })} />
        </>
      );
    case 'paint-bucket':
      return (
        <>
          <NumberField label="Opacity" value={pct(o.bucket.opacity)} min={1} max={100} unit="%" onChange={(v) => setOptions('bucket', { opacity: v / 100 })} />
          <NumberField label="Tolerance" value={o.bucket.tolerance} min={0} max={255} onChange={(v) => setOptions('bucket', { tolerance: v })} width={48} />
          <Checkbox label="Anti-alias" checked={o.bucket.antiAlias} onChange={(v) => setOptions('bucket', { antiAlias: v })} />
          <Checkbox label="Contiguous" checked={o.bucket.contiguous} onChange={(v) => setOptions('bucket', { contiguous: v })} />
          <Checkbox label="All layers" checked={o.bucket.sampleAll} onChange={(v) => setOptions('bucket', { sampleAll: v })} />
        </>
      );
    case 'gradient':
      return (
        <>
          <Select label="Colors" value={o.gradient.preset} onChange={(v) => setOptions('gradient', { preset: v })} options={[{ value: 'fg-bg', label: 'Foreground → Background' }, { value: 'fg-transparent', label: 'Foreground → Transparent' }, { value: 'bw', label: 'Black → White' }, { value: 'spectrum', label: 'Spectrum' }]} />
          <Select label="Type" value={o.gradient.type} onChange={(v) => setOptions('gradient', { type: v })} options={[{ value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }, { value: 'angle', label: 'Angle' }, { value: 'reflected', label: 'Reflected' }, { value: 'diamond', label: 'Diamond' }]} />
          <NumberField label="Opacity" value={pct(o.gradient.opacity)} min={1} max={100} unit="%" onChange={(v) => setOptions('gradient', { opacity: v / 100 })} />
          <Checkbox label="Reverse" checked={o.gradient.reverse} onChange={(v) => setOptions('gradient', { reverse: v })} />
        </>
      );
    case 'pen':
      return (
        <>
          <Select label="Make" value={o.pen.mode} onChange={(v) => setOptions('pen', { mode: v })} options={[{ value: 'shape', label: 'Shape layer' }, { value: 'vector-mask', label: 'Vector mask' }, { value: 'selection', label: 'Selection' }]} />
          {o.pen.mode === 'shape' && <><Sep /><ShapeFields kind="pen" /></>}
          <Sep /><Hint>Click for corners, drag for curves · click the first point to close · Enter finishes an open path</Hint>
        </>
      );
    case 'path-select': return <Hint>Click a shape to select it · drag anchors and handles to edit · Alt breaks handle symmetry · Delete removes an anchor</Hint>;
    case 'text': return <TextFields />;
    case 'shape-rect': return <ShapeFields kind="rect" />;
    case 'shape-ellipse': return <ShapeFields kind="ellipse" />;
    case 'shape-polygon': return <ShapeFields kind="polygon" />;
    case 'shape-line': return <ShapeFields kind="line" />;
    case 'hand':
      return (<><button className="btn" onClick={() => getEngine()?.fit()}>Fit screen</button><button className="btn" onClick={() => getEngine()?.fillScreen()}>Fill screen</button><button className="btn" onClick={() => getEngine()?.zoomAt(1)}>100%</button></>);
    case 'zoom':
      return (<>
        <IconButton icon={LuZoomIn} label="Zoom in" onClick={() => getEngine()?.zoomStep(1)} />
        <IconButton icon={LuZoomOut} label="Zoom out" onClick={() => getEngine()?.zoomStep(-1)} />
        <button className="btn" onClick={() => getEngine()?.zoomAt(1)}>100%</button><button className="btn" onClick={() => getEngine()?.fit()}>Fit screen</button>
        <Hint>Alt-click zooms out · drag to zoom into an area</Hint>
      </>);
    default: return null;
  }
}

export function OptionsBar() {
  const tool = useTools((s) => s.tool);
  const has = useSession();
  const transforming = useTransform((s) => !!s.session);
  const Icon = TOOL_ICONS[tool];
  const commit = () => {
    const e = getEngine(); if (!e) return;
    if (transforming) commitTransform(); else if (tool === 'crop') applyCrop(e); else if (tool === 'text') finishEditText(); else TOOLS[tool].commit?.(e);
  };
  const cancel = () => {
    const e = getEngine(); if (!e) return;
    if (transforming) cancelTransform(); else TOOLS[tool].cancel?.(e);
  };
  return (
    <div className="flex items-center gap-2.5 h-full px-2 overflow-x-auto overflow-y-hidden" role="toolbar" aria-label={`${toolLabel(tool)} options`}>
      <span className="flex items-center gap-1.5 text-ink-strong shrink-0 pr-1"><Icon size={15} /><span className="hidden xl:inline font-medium">{transforming ? 'Free Transform' : toolLabel(tool)}</span></span>
      <Sep />
      <ToolOptions />
      <div className="flex-1" />
      {(has || transforming) && (
        <div className="flex items-center gap-1 shrink-0 pl-2">
          <IconButton icon={LuX} label="Cancel" shortcut="Escape" onClick={cancel} />
          <button type="button" className="btn btn-primary h-[24px] px-2.5 inline-flex items-center gap-1 !bg-amber !border-amber !text-[#2a1c00]" onClick={commit} data-tip="Commit" data-tip-key="Enter"><LuCheck size={14} />Commit</button>
        </div>
      )}
    </div>
  );
}
