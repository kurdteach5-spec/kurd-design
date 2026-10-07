import { useDocuments, selectActiveState, commit } from '../../state/documentStore';
import { findLayer, updateLayer } from '../../layers/tree';
import type { DocState, Layer, Paint, ShapeLayer, SmartObjectLayer, TextLayer, TextStyle } from '../../types/document';
import { editSmartContents, removeSmartFilter, setSmartFilterEnabled, setSmartFiltersEnabled } from '../../editor/smartObjects';
import { editTextLayer } from '../../tools/textTool';
import { filterById } from '../../filters/definitions';
import { Checkbox, ColorButton, IconButton, NumberField, Section, Segmented, Select, Slider } from '../ui/controls';
import { AdjustmentEditor } from './AdjustmentEditor';
import * as L from '../../editor/layerActions';
import { ADJUSTMENT_LABELS, LAYER_TYPE_LABEL, defaultGeometry } from '../../layers/factory';
import { TransformSession } from '../../tools/transformSession';
import { transformLayers } from '../../editor/editActions';
import { openDialog } from '../../state/uiStore';
import { applyTextStyle, setTextBoxWidth } from '../../tools/textTool';
import { TextFields } from '../editor/OptionsBar';
import { run } from '../../shortcuts/commands';
import { localBounds } from '../../layers/geometry';
import { LuFlipHorizontal2, LuFlipVertical2, LuRotateCw, LuRotateCcw, LuTrash2, LuPencil } from 'react-icons/lu';

function TransformSection({ st, layer }: { st: DocState; layer: Layer }) {
  const session = TransformSession.create(st, [layer.id]);
  if (!session) return null;
  const i = session.info();
  const set = (patch: Parameters<TransformSession['setNumeric']>[0]) => {
    const s = TransformSession.create(st, [layer.id]); if (!s) return;
    s.setNumeric(patch); s.commit('Transform');
  };
  return (
    <Section title="Transform">
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="X" value={Math.round(i.x)} onChange={(v) => set({ x: v })} unit="px" width={78} />
        <NumberField label="Y" value={Math.round(i.y)} onChange={(v) => set({ y: v })} unit="px" width={78} />
        <NumberField label="W" value={Math.round(i.w)} min={1} onChange={(v) => set({ w: v })} unit="px" width={78} />
        <NumberField label="H" value={Math.round(i.h)} min={1} onChange={(v) => set({ h: v })} unit="px" width={78} />
        <NumberField label="∠" title="Rotation" value={Math.round(i.angle * 10) / 10} precision={1} min={-180} max={180} onChange={(v) => set({ angle: v })} unit="°" width={78} />
      </div>
      <div className="flex gap-1">
        <IconButton icon={LuFlipHorizontal2} label="Flip horizontal" onClick={() => transformLayers('flipH')} />
        <IconButton icon={LuFlipVertical2} label="Flip vertical" onClick={() => transformLayers('flipV')} />
        <IconButton icon={LuRotateCcw} label="Rotate 90° counter clockwise" onClick={() => transformLayers('rot-90')} />
        <IconButton icon={LuRotateCw} label="Rotate 90° clockwise" onClick={() => transformLayers('rot90')} />
        <div className="flex-1" />
        <button type="button" className="btn" onClick={() => run('edit.freeTransform')}>Free Transform</button>
      </div>
    </Section>
  );
}

function PaintEditor({ paint, onChange }: { paint: Paint; onChange: (p: Paint) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Select value={paint.type} onChange={(t) => onChange({ ...paint, type: t, stops: t !== 'solid' && paint.stops[0].color === paint.color && paint.stops[1].color === '#000000' ? [{ offset: 0, color: paint.color, opacity: 1 }, { offset: 1, color: '#ffffff', opacity: 1 }] : paint.stops })}
          options={[{ value: 'none', label: 'None' }, { value: 'solid', label: 'Solid color' }, { value: 'linear', label: 'Linear gradient' }, { value: 'radial', label: 'Radial gradient' }]} />
        {paint.type === 'solid' && <ColorButton label="Fill color" color={paint.color} onChange={(c) => onChange({ ...paint, color: c })} />}
      </div>
      {(paint.type === 'linear' || paint.type === 'radial') && (
        <>
          <div className="flex items-center gap-2">
            <ColorButton label="Start color" color={paint.stops[0].color} onChange={(c) => onChange({ ...paint, stops: [{ ...paint.stops[0], color: c }, ...paint.stops.slice(1)] })} />
            <div className="flex-1 h-4 rounded-[3px] border border-line" style={{ background: `linear-gradient(to right, ${paint.stops.map((s) => `${s.color} ${s.offset * 100}%`).join(',')})` }} />
            <ColorButton label="End color" color={paint.stops[paint.stops.length - 1].color} onChange={(c) => onChange({ ...paint, stops: [...paint.stops.slice(0, -1), { ...paint.stops[paint.stops.length - 1], color: c }] })} />
          </div>
          {paint.type === 'linear' && <Slider label="Angle" value={paint.angle} min={-180} max={180} unit="°" onChange={(v) => onChange({ ...paint, angle: v })} />}
        </>
      )}
    </div>
  );
}

function ShapeSection({ layer }: { layer: ShapeLayer }) {
  const set = (patch: Partial<ShapeLayer>, label = 'Edit Shape', key = Object.keys(patch).join()) =>
    commit((s) => ({ ...s, layers: updateLayer(s.layers, layer.id, (l) => ({ ...l, ...patch } as Layer)) }), { history: label, mergeKey: `shape-${layer.id}-${key}` });
  const g = layer.geometry; const st = layer.stroke;
  return (
    <>
      <Section title="Appearance">
        {g.kind !== 'line' && <><div className="text-muted">Fill</div><PaintEditor paint={layer.fill} onChange={(fill) => set({ fill }, 'Shape Fill')} /></>}
        <div className="flex items-center gap-2 pt-1">
          <Checkbox label="Stroke" checked={st.enabled} onChange={(v) => set({ stroke: { ...st, enabled: v } }, 'Shape Stroke')} />
          <ColorButton label="Stroke color" color={st.color} onChange={(c) => set({ stroke: { ...st, color: c, enabled: true } }, 'Shape Stroke', 'strokecolor')} />
          <NumberField value={st.width} min={0} max={500} unit="px" onChange={(v) => set({ stroke: { ...st, width: v, enabled: v > 0 } }, 'Shape Stroke', 'strokewidth')} title="Stroke width" />
        </div>
        {st.enabled && <div className="flex items-center gap-2">
          {g.kind !== 'line' && <Select title="Stroke position" value={st.align} onChange={(v) => set({ stroke: { ...st, align: v } }, 'Shape Stroke')} options={[{ value: 'inside', label: 'Inside' }, { value: 'center', label: 'Center' }, { value: 'outside', label: 'Outside' }]} />}
          <Select title="Stroke style" value={st.dash} onChange={(v) => set({ stroke: { ...st, dash: v } }, 'Shape Stroke')} options={[{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }]} />
        </div>}
      </Section>
      <Section title="Shape">
        {(g.kind === 'rect' || g.kind === 'ellipse' || g.kind === 'polygon' || g.kind === 'star') && (
          <Select label="Type" value={g.kind} onChange={(k) => set({ geometry: { ...g, kind: k } }, 'Change Shape')} options={[{ value: 'rect', label: 'Rectangle' }, { value: 'ellipse', label: 'Ellipse' }, { value: 'polygon', label: 'Polygon' }, { value: 'star', label: 'Star' }]} />
        )}
        {g.kind === 'rect' && <Slider label="Corner radius" value={g.radius} min={0} max={Math.round(Math.min(g.width, g.height) / 2)} unit="px" onChange={(v) => set({ geometry: { ...g, radius: v } }, 'Corner Radius')} />}
        {(g.kind === 'polygon' || g.kind === 'star') && <>
          <Slider label={g.kind === 'star' ? 'Points' : 'Sides'} value={g.sides} min={3} max={40} onChange={(v) => set({ geometry: { ...g, sides: v } }, 'Polygon Sides')} />
          {g.kind === 'star' && <Slider label="Inner radius" value={Math.round(g.innerRatio * 100)} min={5} max={95} unit="%" onChange={(v) => set({ geometry: { ...g, innerRatio: v / 100 } }, 'Star Ratio')} />}
          <Slider label="Corner rounding" value={g.radius} min={0} max={200} unit="px" onChange={(v) => set({ geometry: { ...g, radius: v } }, 'Corner Radius')} />
        </>}
        {g.kind === 'line' && <div className="flex gap-3">
          <Checkbox label="Arrow start" checked={g.arrowStart} onChange={(v) => set({ geometry: { ...g, arrowStart: v } }, 'Arrowheads')} />
          <Checkbox label="Arrow end" checked={g.arrowEnd} onChange={(v) => set({ geometry: { ...g, arrowEnd: v } }, 'Arrowheads')} />
        </div>}
        {g.kind === 'path' && <Checkbox label="Closed path" checked={g.closed} onChange={(v) => set({ geometry: { ...g, closed: v } }, 'Close Path')} />}
        <div className="text-faint">Edit anchor points with the Path Selection tool (A).</div>
      </Section>
    </>
  );
}

/** Change the words of a text layer at any time (also: double-click the text with the Move or Type tool). */
function TextContentSection({ layer }: { layer: TextLayer }) {
  const change = (text: string) => commit((st) => ({
    ...st,
    layers: updateLayer(st.layers, layer.id, (l) => {
      const t = l as TextLayer;
      const autoName = t.name === (t.text.split('\n')[0].slice(0, 32) || 'Text');
      return { ...t, text, name: autoName ? text.split('\n')[0].slice(0, 32) || 'Text' : t.name };
    }),
  }), { history: 'Edit Text', mergeKey: `text-${layer.id}` });
  return (
    <Section title="Text">
      <textarea className="field w-full !h-auto min-h-[64px] py-1.5 resize-y leading-snug" dir="auto" aria-label="Text" value={layer.text}
        disabled={layer.locked} onChange={(e) => change(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      <button type="button" className="btn self-start inline-flex items-center gap-1.5" onClick={() => editTextLayer(layer.id)} disabled={layer.locked}><LuPencil size={13} />Edit on canvas</button>
    </Section>
  );
}

function SmartSection({ layer }: { layer: SmartObjectLayer }) {
  return (
    <Section title="Smart Object">
      <div className="text-muted num">{`Contents: ${layer.contents.width} × ${layer.contents.height} px · ${layer.contents.layers.length} ${layer.contents.layers.length === 1 ? 'layer' : 'layers'}`}</div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="btn btn-primary" onClick={() => editSmartContents(layer.id)}>Edit Contents</button>
        <button type="button" className="btn" onClick={() => run('layer.smart.rasterize')}>Rasterize</button>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <Checkbox label="Smart Filters" checked={layer.filtersEnabled} onChange={(v) => setSmartFiltersEnabled(layer.id, v)} />
      </div>
      {layer.filters.length === 0 && <div className="text-faint">Filters and Image › Adjustments you apply to a smart object stay editable here.</div>}
      {layer.filters.map((f, i) => (
        <div key={f.id} className="flex items-center gap-1.5">
          <Checkbox label={f.kind === 'filter' ? filterById(f.filter)?.name ?? f.filter : ADJUSTMENT_LABELS[f.adjustment.kind]} checked={f.enabled} onChange={(v) => setSmartFilterEnabled(layer.id, i, v)} />
          <div className="flex-1" />
          <IconButton icon={LuPencil} label="Change filter settings" onClick={() => openDialog({ type: 'smart-filter', layerId: layer.id, index: i })} square={22} size={13} />
          <IconButton icon={LuTrash2} label="Delete smart filter" onClick={() => removeSmartFilter(layer.id, i)} square={22} size={13} />
        </div>
      ))}
    </Section>
  );
}

function TextSection({ layer }: { layer: TextLayer }) {
  const s = layer.style;
  const set = (p: Partial<TextStyle>) => applyTextStyle(p);
  return (
    <>
      <TextContentSection layer={layer} />
      <Section title="Character">
        <div className="flex flex-wrap items-center gap-2"><TextFields compact /></div>
        <div className="flex flex-wrap items-center gap-2">
          <NumberField label="Tracking" value={s.letterSpacing} min={-50} max={200} step={0.5} precision={1} unit="px" onChange={(v) => set({ letterSpacing: v })} />
          <NumberField label="Leading" value={s.lineHeight} min={0.5} max={5} step={0.05} precision={2} onChange={(v) => set({ lineHeight: v })} width={50} />
        </div>
        <Slider label="Text opacity" value={Math.round(s.textOpacity * 100)} min={0} max={100} unit="%" onChange={(v) => set({ textOpacity: v / 100 })} />
        <Select label="Case" value={s.transform} onChange={(v) => set({ transform: v })} options={[{ value: 'none', label: 'As typed' }, { value: 'uppercase', label: 'UPPERCASE' }, { value: 'lowercase', label: 'lowercase' }, { value: 'capitalize', label: 'Capitalize' }]} />
        <div className="flex gap-3 flex-wrap">
          <Checkbox label="Italic" checked={s.italic} onChange={(v) => set({ italic: v })} />
          <Checkbox label="Underline" checked={s.underline} onChange={(v) => set({ underline: v })} />
          <Checkbox label="Strikethrough" checked={s.strikethrough} onChange={(v) => set({ strikethrough: v })} />
        </div>
      </Section>
      <Section title="Stroke & shadow" defaultOpen={s.stroke.enabled || s.shadow.enabled}>
        <div className="flex items-center gap-2">
          <Checkbox label="Stroke" checked={s.stroke.enabled} onChange={(v) => set({ stroke: { ...s.stroke, enabled: v } })} />
          <ColorButton label="Stroke color" color={s.stroke.color} onChange={(c) => set({ stroke: { ...s.stroke, color: c, enabled: true } })} />
          <NumberField value={s.stroke.width} min={0} max={100} step={0.5} precision={1} unit="px" onChange={(v) => set({ stroke: { ...s.stroke, width: v } })} title="Stroke width" />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox label="Shadow" checked={s.shadow.enabled} onChange={(v) => set({ shadow: { ...s.shadow, enabled: v } })} />
          <ColorButton label="Shadow color" color={s.shadow.color} onChange={(c) => set({ shadow: { ...s.shadow, color: c, enabled: true } })} />
        </div>
        {s.shadow.enabled && <div className="grid grid-cols-2 gap-2">
          <NumberField label="X" value={s.shadow.offsetX} onChange={(v) => set({ shadow: { ...s.shadow, offsetX: v } })} unit="px" />
          <NumberField label="Y" value={s.shadow.offsetY} onChange={(v) => set({ shadow: { ...s.shadow, offsetY: v } })} unit="px" />
          <NumberField label="Blur" value={s.shadow.blur} min={0} max={200} onChange={(v) => set({ shadow: { ...s.shadow, blur: v } })} unit="px" />
          <NumberField label="Opacity" value={Math.round(s.shadow.opacity * 100)} min={0} max={100} onChange={(v) => set({ shadow: { ...s.shadow, opacity: v / 100 } })} unit="%" />
        </div>}
      </Section>
      <Section title="Paragraph">
        <ParagraphFields layer={layer} />
      </Section>
    </>
  );
}

export function ParagraphFields({ layer }: { layer: TextLayer | null }) {
  const s = layer?.style;
  return (
    <div className="flex flex-col gap-2">
      <Segmented value={s?.align ?? 'left'} onChange={(v) => applyTextStyle({ align: v })} options={[
        { value: 'left', label: 'Left', title: 'Align left' }, { value: 'center', label: 'Center', title: 'Align center' }, { value: 'right', label: 'Right', title: 'Align right' }, { value: 'justify', label: 'Justify', title: 'Justify' },
      ]} />
      {layer && (
        <div className="flex items-center gap-2">
          <Select label="Type" value={layer.boxWidth == null ? 'point' : 'box'} onChange={(v) => setTextBoxWidth(v === 'point' ? null : Math.max(100, Math.round(localBounds(layer)?.w ?? 300)))} options={[{ value: 'point', label: 'Point text' }, { value: 'box', label: 'Paragraph (wrapping)' }]} />
          {layer.boxWidth != null && <NumberField label="Width" value={layer.boxWidth} min={10} max={20000} unit="px" width={64} onChange={(v) => commit((st) => ({ ...st, layers: updateLayer(st.layers, layer.id, (l) => ({ ...l, boxWidth: v } as Layer)) }), { history: 'Paragraph Width', mergeKey: `boxw-${layer.id}` })} />}
        </div>
      )}
      {!layer && <div className="text-faint">Select a text layer to edit its paragraph settings. Changes here set the defaults for new text.</div>}
    </div>
  );
}

function MaskSection({ layer }: { layer: Layer }) {
  const m = layer.mask!;
  return (
    <Section title="Layer mask">
      <Slider label="Density" value={Math.round(m.density * 100)} min={0} max={100} unit="%" onChange={(v) => L.setMaskProps(layer.id, { density: v / 100 })} />
      <Slider label="Feather" value={m.feather} min={0} max={250} unit="px" step={0.5} precision={1} onChange={(v) => L.setMaskProps(layer.id, { feather: v })} />
      <div className="flex flex-wrap gap-1.5">
        <button className="btn" onClick={L.invertMask}>Invert</button>
        <button className="btn" onClick={() => L.toggleMaskEnabled(layer.id)}>{m.enabled ? 'Disable' : 'Enable'}</button>
        <button className="btn" onClick={L.maskToSelection}>To selection</button>
        {layer.type === 'raster' && <button className="btn" onClick={() => L.deleteLayerMask(true)}>Apply</button>}
        <button className="btn btn-danger" onClick={() => L.deleteLayerMask(false)}>Delete</button>
      </div>
      <div className="text-faint">Paint black to hide, white to reveal, gray for partial transparency.</div>
    </Section>
  );
}

function VectorMaskSection({ layer }: { layer: Layer }) {
  const vm = layer.vectorMask!;
  const g = vm.geometry;
  const b = { x: vm.transform.e, y: vm.transform.f, w: g.width, h: g.height };
  const setG = (p: Partial<typeof g>) => L.updateVectorMask(layer.id, { geometry: { ...g, ...p } });
  return (
    <Section title="Vector mask">
      {g.kind !== 'path' && <Select label="Shape" value={g.kind === 'star' || g.kind === 'line' ? 'polygon' : g.kind} onChange={(k) => L.updateVectorMask(layer.id, { geometry: { ...defaultGeometry(k, g.width, g.height), radius: g.radius } })} options={[{ value: 'rect', label: 'Rectangle' }, { value: 'ellipse', label: 'Ellipse' }, { value: 'polygon', label: 'Polygon' }]} />}
      {g.kind !== 'path' && <div className="grid grid-cols-2 gap-2">
        <NumberField label="X" value={Math.round(b.x)} unit="px" width={70} onChange={(v) => L.updateVectorMask(layer.id, { transform: { ...vm.transform, e: v } })} />
        <NumberField label="Y" value={Math.round(b.y)} unit="px" width={70} onChange={(v) => L.updateVectorMask(layer.id, { transform: { ...vm.transform, f: v } })} />
        <NumberField label="W" value={Math.round(b.w)} min={1} unit="px" width={70} onChange={(v) => setG({ width: v })} />
        <NumberField label="H" value={Math.round(b.h)} min={1} unit="px" width={70} onChange={(v) => setG({ height: v })} />
      </div>}
      {g.kind === 'rect' && <Slider label="Corner radius" value={g.radius} min={0} max={Math.round(Math.min(g.width, g.height) / 2)} unit="px" onChange={(v) => setG({ radius: v })} />}
      <Slider label="Feather" value={vm.feather} min={0} max={250} unit="px" onChange={(v) => L.updateVectorMask(layer.id, { feather: v })} />
      <div className="flex gap-3">
        <Checkbox label="Invert" checked={vm.invert} onChange={(v) => L.updateVectorMask(layer.id, { invert: v }, 'Invert Vector Mask')} />
        <Checkbox label="Enabled" checked={vm.enabled} onChange={(v) => L.updateVectorMask(layer.id, { enabled: v }, 'Toggle Vector Mask')} />
      </div>
      <button className="btn btn-danger self-start" onClick={L.deleteVectorMask}>Delete vector mask</button>
    </Section>
  );
}

export function PropertiesPanel() {
  const st = useDocuments(selectActiveState);
  if (!st) return <div className="p-4 text-muted">No document open.</div>;
  const layer = findLayer(st.layers, st.activeLayerId);
  if (!layer) return <DocumentSection st={st} />;
  const fx = layer.effects;
  const hasFx = fx.dropShadow.enabled || fx.outerGlow.enabled || fx.stroke.enabled;
  return (
    <div className="flex flex-col">
      <div className="px-3 py-2 border-b border-line-soft flex items-baseline gap-2">
        <span className="font-medium text-ink-strong truncate">{layer.name}</span>
        <span className="text-faint shrink-0">{layer.type === 'adjustment' ? ADJUSTMENT_LABELS[layer.adjustment.kind] : LAYER_TYPE_LABEL[layer.type]}</span>
      </div>
      {st.editTarget === 'mask' && layer.mask && <MaskSection layer={layer} />}
      {st.editTarget === 'vectorMask' && layer.vectorMask && <VectorMaskSection layer={layer} />}
      {layer.type === 'adjustment' && (
        <Section title={ADJUSTMENT_LABELS[layer.adjustment.kind]}>
          <AdjustmentEditor value={layer.adjustment} onChange={(a) => L.setAdjustment(layer.id, a)} />
          {layer.mask && st.editTarget !== 'mask' && <button className="btn self-start" onClick={() => L.setEditTarget(layer.id, 'mask')}>Edit mask</button>}
        </Section>
      )}
      {layer.type === 'smart' && st.editTarget === 'content' && <SmartSection layer={layer} />}
      {(layer.type === 'raster' || layer.type === 'text' || layer.type === 'shape' || layer.type === 'smart') && st.editTarget === 'content' && <TransformSection st={st} layer={layer} />}
      {layer.type === 'shape' && st.editTarget === 'content' && <ShapeSection layer={layer} />}
      {layer.type === 'text' && st.editTarget === 'content' && <TextSection layer={layer} />}
      {layer.type !== 'adjustment' && (
        <Section title="Layer style" defaultOpen={hasFx}>
          <div className="flex flex-col gap-1.5">
            {(['dropShadow', 'outerGlow', 'stroke'] as const).map((k) => (
              <div key={k} className="flex items-center gap-2">
                <Checkbox label={{ dropShadow: 'Drop shadow', outerGlow: 'Outer glow', stroke: 'Stroke' }[k]} checked={fx[k].enabled}
                  onChange={(v) => L.updateEffects(layer.id, { ...fx, [k]: { ...fx[k], enabled: v } }, v ? 'Add Layer Style' : 'Remove Layer Style')} />
                <div className="flex-1" />
                <ColorButton label="Effect color" color={fx[k].color} size={18} onChange={(c) => L.updateEffects(layer.id, { ...fx, [k]: { ...fx[k], color: c, enabled: true } })} />
              </div>
            ))}
          </div>
          <button className="btn self-start" onClick={() => openDialog({ type: 'layer-style', layerId: layer.id })}>Edit layer style…</button>
        </Section>
      )}
      {layer.mask && st.editTarget !== 'mask' && layer.type !== 'adjustment' && (
        <div className="px-3 py-2"><button className="btn" onClick={() => L.setEditTarget(layer.id, 'mask')}>Edit layer mask</button></div>
      )}
      <DocumentSection st={st} collapsed />
    </div>
  );
}

function DocumentSection({ st, collapsed }: { st: DocState; collapsed?: boolean }) {
  return (
    <Section title="Document" defaultOpen={!collapsed}>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 num">
        <span className="text-muted">Size</span><span>{st.width} × {st.height} px</span>
        <span className="text-muted">Resolution</span><span>{st.dpi} ppi</span>
        <span className="text-muted">Print size</span><span>{(st.width / st.dpi * 2.54).toFixed(1)} × {(st.height / st.dpi * 2.54).toFixed(1)} cm</span>
        <span className="text-muted">Color mode</span><span>{st.colorMode === 'rgb' ? 'RGB, 8-bit' : 'Grayscale, 8-bit'}</span>
      </div>
      <div className="flex gap-1.5">
        <button className="btn" onClick={() => openDialog({ type: 'image-size' })}>Image size…</button>
        <button className="btn" onClick={() => openDialog({ type: 'canvas-size' })}>Canvas size…</button>
      </div>
    </Section>
  );
}
