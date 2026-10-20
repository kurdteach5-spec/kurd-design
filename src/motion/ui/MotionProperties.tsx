// Properties panel for the Motion workspace (layer settings + effect controls).
import type { BlendMode, Composition, Gradient, MLayer, Prop, PropValue, Repeater, ShapeKind, TextAnimatorType, TextRangeAnimator, Vec2 } from '../types';
import { useMotion, activeComp } from '../store';
import * as A from '../actions';
import { formatTimecode } from '../anim';
import { layerGroups } from './propTree';
import { PropLine, ScrubNumber } from './fields';
import { Section, Checkbox, Select, ColorButton } from '../../components/ui/controls';
import { FONTS } from '../../utils/fonts';
import { openMotionDialog } from '../uiState';
import { effectDef } from '../render/effectDefs';
import { LuTrash2, LuArrowUp, LuArrowDown, LuCopy, LuSquareDashed, LuCircleDashed } from 'react-icons/lu';

const BLENDS: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' }, { value: 'add', label: 'Add' }, { value: 'multiply', label: 'Multiply' }, { value: 'screen', label: 'Screen' }, { value: 'overlay', label: 'Overlay' },
  { value: 'soft-light', label: 'Soft Light' }, { value: 'hard-light', label: 'Hard Light' }, { value: 'darken', label: 'Darken' }, { value: 'lighten', label: 'Lighten' },
  { value: 'color-dodge', label: 'Color Dodge' }, { value: 'color-burn', label: 'Color Burn' }, { value: 'difference', label: 'Difference' }, { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue' }, { value: 'saturation', label: 'Saturation' }, { value: 'color', label: 'Color' }, { value: 'luminosity', label: 'Luminosity' },
];
export { BLENDS };

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[92px_1fr] items-center gap-2 min-h-[24px]"><span className="text-muted text-xs">{label}</span><div className="flex items-center gap-1.5 min-w-0 flex-wrap">{children}</div></div>
);

export function MotionProperties() {
  const comp = useMotion((s) => activeComp(s));
  const sel = useMotion((s) => s.selectedLayers);
  const t = useMotion((s) => (s.activeCompId ? s.times[s.activeCompId] ?? 0 : 0));
  if (!comp) return <div className="p-4 text-muted text-xs">No composition open.</div>;
  const layers = comp.layers.filter((l) => sel.includes(l.id));
  if (!layers.length) return <CompSection comp={comp} />;
  if (layers.length > 1) return (
    <div className="p-3 text-xs text-muted flex flex-col gap-2">
      <div className="text-ink">{layers.length} layers selected</div>
      <div>Dragging in the viewer moves all of them. Effects and presets apply to every selected layer.</div>
      <div className="flex gap-1.5 flex-wrap"><button className="btn" onClick={() => A.precompose()}>Pre-compose</button><button className="btn" onClick={() => A.duplicateLayers()}>Duplicate</button><button className="btn btn-danger" onClick={() => A.deleteLayers()}>Delete</button></div>
    </div>
  );
  return <LayerProps l={layers[0]} comp={comp} t={t} />;
}

function CompSection({ comp }: { comp: Composition }) {
  return (
    <div className="flex flex-col">
      <div className="px-3 py-2 border-b border-line-soft flex items-baseline gap-2"><span className="font-medium text-ink-strong truncate" translate="no">{comp.name}</span><span className="text-faint text-xs">Composition</span></div>
      <Section title="Composition">
        <Row label="Size"><span className="num text-xs">{comp.width} × {comp.height}</span></Row>
        <Row label="Frame rate"><span className="num text-xs">{comp.fps} fps</span></Row>
        <Row label="Duration"><span className="num text-xs">{formatTimecode(comp.duration, comp.fps)}</span></Row>
        <Row label="Background"><ColorButton color={comp.background} size={18} label="Background color" onChange={(c) => A.updateCompSettings(comp.id, { background: c })} /></Row>
        <Row label="Motion blur"><Checkbox checked={comp.motionBlur} label="Enabled" onChange={(v) => A.updateCompSettings(comp.id, { motionBlur: v })} /></Row>
        <Row label="Shutter angle"><ScrubNumber value={comp.shutterAngle} min={0} max={720} unit="°" label="Shutter angle" onChange={(v, f) => { if (f) A.updateCompSettings(comp.id, { shutterAngle: v }); }} /></Row>
        <button type="button" className="btn self-start" onClick={() => openMotionDialog({ type: 'comp-settings', compId: comp.id })}>Composition Settings…</button>
      </Section>
      <div className="px-3 py-2 text-2xs text-faint">Select a layer in the timeline or viewer to see its properties.</div>
    </div>
  );
}

function LayerProps({ l, comp, t }: { l: MLayer; comp: Composition; t: number }) {
  const set = (patch: Partial<MLayer>, label = 'Layer Change', mk?: string) => A.setLayer(l.id, patch, label, mk);
  const groups = layerGroups(l);
  const typeLabel: Record<MLayer['type'], string> = { solid: 'Solid', image: 'Image', video: 'Video', audio: 'Audio', text: 'Text', shape: 'Shape', null: 'Null Object', adjustment: 'Adjustment Layer', precomp: 'Composition', camera: 'Camera' };
  const fr = 1 / comp.fps;
  return (
    <div className="flex flex-col">
      <div className="px-3 py-2 border-b border-line-soft flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-[2px] shrink-0" style={{ background: l.label }} />
        <input className="field h-[22px] flex-1 min-w-0" value={l.name} aria-label="Layer name" onChange={(e) => set({ name: e.target.value }, 'Rename Layer', `name-${l.id}`)} onKeyDown={(e) => e.stopPropagation()} />
        <span className="text-faint text-xs shrink-0">{typeLabel[l.type]}</span>
      </div>
      <Section title="Layer">
        <Row label="In / Out">
          <ScrubNumber value={l.inPoint} step={fr} min={0} unit="s" label="In point" onChange={(v) => A.trimLayer(l.id, v, null, 'Trim In Point', `in-${l.id}`)} />
          <ScrubNumber value={l.outPoint} step={fr} min={0} unit="s" label="Out point" onChange={(v) => A.trimLayer(l.id, null, v, 'Trim Out Point', `out-${l.id}`)} />
        </Row>
        <Row label="Duration"><span className="num text-xs">{formatTimecode(l.outPoint - l.inPoint, comp.fps)}</span></Row>
        {(l.type === 'video' || l.type === 'audio' || l.type === 'precomp') && <Row label="Speed"><ScrubNumber value={Math.round(l.speed * 1000) / 10} step={1} min={5} max={1600} unit="%" label="Speed" onChange={(v) => {
          const sp = v / 100; set({ speed: sp, outPoint: Math.max(l.inPoint + fr, l.start + ((l.outPoint - l.start) * l.speed) / sp) } as Partial<MLayer>, 'Time Stretch', `speed-${l.id}`);
        }} /></Row>}
        <Row label="Parent">
          <select className="field h-[22px] text-xs w-full" value={l.parentId ?? ''} aria-label="Parent" onChange={(e) => A.setParent(l.id, e.target.value || null)}>
            <option value="">None</option>
            {comp.layers.filter((x) => x.id !== l.id).map((x) => <option key={x.id} value={x.id}>{`${comp.layers.indexOf(x) + 1}. ${x.name}`}</option>)}
          </select>
        </Row>
        {l.type !== 'audio' && l.type !== 'null' && l.type !== 'camera' && <Row label="Blend mode"><Select value={l.blend} width="100%" options={BLENDS} onChange={(v) => set({ blend: v }, 'Blending Mode')} /></Row>}
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {(l.type === 'precomp' || l.type === 'video') && <Checkbox checked={!!l.timeRemap} label="Time Remap" onChange={(v) => set({ timeRemap: v ? { v: 0, k: [{ id: `k_tr${Date.now()}`, t: l.inPoint, v: (l.inPoint - l.start) * l.speed, interp: 'linear', out: [1 / 3, 1 / 3], in: [2 / 3, 2 / 3] }, { id: `k_tr${Date.now() + 1}`, t: l.outPoint, v: (l.outPoint - l.start) * l.speed, interp: 'linear', out: [1 / 3, 1 / 3], in: [2 / 3, 2 / 3] }] } : null } as Partial<MLayer>, v ? 'Enable Time Remapping' : 'Remove Time Remapping')} />}
          {l.type !== 'audio' && l.type !== 'camera' && <Checkbox checked={!!l.autoOrient} label="Auto-Orient" onChange={(v) => set({ autoOrient: v }, 'Auto-Orient')} />}
          {l.type !== 'audio' && l.type !== 'camera' && <Checkbox checked={l.threeD} label="3D layer" onChange={(v) => set({ threeD: v }, '3D Layer')} />}
          {l.type !== 'audio' && <Checkbox checked={l.motionBlur} label="Motion blur" onChange={(v) => set({ motionBlur: v }, 'Motion Blur')} />}
          <Checkbox checked={l.solo} label="Solo" onChange={(v) => set({ solo: v }, 'Solo')} />
          <Checkbox checked={l.locked} label="Lock" onChange={(v) => set({ locked: v }, 'Lock')} />
        </div>
      </Section>

      {l.type === 'text' && <TextSettings l={l} />}
      {l.type === 'shape' && (
        <Section title="Shape">
          <Row label="Type"><Select value={l.shape.kind} width="100%" options={(['rect', 'ellipse', 'polygon', 'star', 'line', 'arrow', 'path'] as ShapeKind[]).map((k) => ({ value: k, label: { rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', line: 'Line', arrow: 'Arrow', path: 'Custom Path' }[k] }))} onChange={(v) => set({ shape: { ...l.shape, kind: v } } as Partial<MLayer>, 'Shape Type')} /></Row>
          {(l.shape.kind === 'polygon' || l.shape.kind === 'star') && <Row label="Points"><ScrubNumber value={l.shape.sides} min={3} max={64} label="Points" onChange={(v) => set({ shape: { ...l.shape, sides: Math.round(v) } } as Partial<MLayer>, 'Shape Points', `sides-${l.id}`)} /></Row>}
          <div className="flex gap-3"><Checkbox checked={l.shape.fillOn} label="Fill" onChange={(v) => set({ shape: { ...l.shape, fillOn: v } } as Partial<MLayer>, 'Fill')} /><Checkbox checked={l.shape.strokeOn} label="Stroke" onChange={(v) => set({ shape: { ...l.shape, strokeOn: v } } as Partial<MLayer>, 'Stroke')} /></div>
          <GradientRow l={l} which="fillGradient" label="Fill type" />
          <GradientRow l={l} which="strokeGradient" label="Stroke type" />
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <Checkbox checked={!!l.shape.repeater} label="Repeater" onChange={(v) => set({ shape: { ...l.shape, repeater: v ? newRepeater() : null } } as Partial<MLayer>, v ? 'Add Repeater' : 'Remove Repeater')} />
            {!l.shape.roundCorners && <button type="button" className="text-xs text-[#a78bfa] hover:underline" onClick={() => set({ shape: { ...l.shape, roundCorners: { v: 20, k: [] }, trimOffset: l.shape.trimOffset ?? { v: 0, k: [] } } } as Partial<MLayer>, 'Add Round Corners')}>+ Round Corners</button>}
          </div>
        </Section>
      )}
      {l.type === 'solid' && (
        <Section title="Solid">
          <Row label="Size"><ScrubNumber value={l.width} min={1} max={16000} label="Width" onChange={(v) => set({ width: Math.round(v) } as Partial<MLayer>, 'Solid Size', `sw-${l.id}`)} /><ScrubNumber value={l.height} min={1} max={16000} label="Height" onChange={(v) => set({ height: Math.round(v) } as Partial<MLayer>, 'Solid Size', `sh-${l.id}`)} /></Row>
        </Section>
      )}
      {l.type === 'camera' && (
        <Section title="Camera">
          <Row label="Type"><Select value={l.mode} width="100%" options={[{ value: '3d', label: '3D (perspective, moves 3D layers)' }, { value: '2d', label: '2D (pans, zooms and rotates the view)' }]} onChange={(v) => set({ mode: v, zoom: { v: v === '3d' ? 50 : 100, k: [] } } as Partial<MLayer>, 'Camera Type')} /></Row>
          <div className="text-2xs text-faint">{l.mode === '3d' ? 'Turn on the 3D switch of layers you want this camera to see in perspective. Drag in the viewer with the Camera tool (C) to orbit; Shift pans, Alt dollies.' : 'Animate Position, Rotation and Zoom to move across the composition.'}</div>
        </Section>
      )}

      {groups.filter((g) => g.id !== 'masks' && g.id !== 'effects').map((g) => (
        <Section key={g.id} title={g.label} defaultOpen={g.id !== 'audio' || true}>
          {g.props.map((m) => <PropLine key={m.path} layer={l} meta={m} t={t} fps={comp.fps} />)}
        </Section>
      ))}

      <Section title={`Masks${l.masks.length ? ` (${l.masks.length})` : ''}`} defaultOpen={l.masks.length > 0}>
        {l.masks.map((m) => {
          const g = groups.find((x) => x.id === 'masks')?.sub?.find((s) => s.id === m.id);
          return (
            <div key={m.id} className="flex flex-col gap-0.5 pb-1.5 border-b border-line-soft last:border-0">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-[2px] bg-[#f2c94c]" />
                <input className="field h-[20px] text-xs flex-1 min-w-0" value={m.name} aria-label="Mask name" onChange={(e) => A.updateMask(l.id, m.id, { name: e.target.value }, 'Rename Mask')} onKeyDown={(e) => e.stopPropagation()} />
                <select className="field h-[20px] text-xs" value={m.mode} aria-label="Mask mode" onChange={(e) => A.updateMask(l.id, m.id, { mode: e.target.value as typeof m.mode }, 'Mask Mode')}>
                  <option value="add">Add</option><option value="subtract">Subtract</option><option value="intersect">Intersect</option><option value="none">None</option>
                </select>
                <button type="button" className="icon-btn !w-5 !h-5" aria-label="Delete mask" onClick={() => A.removeMask(l.id, m.id)}><LuTrash2 size={12} /></button>
              </div>
              <Checkbox checked={m.inverted} label="Inverted" onChange={(v) => A.updateMask(l.id, m.id, { inverted: v }, 'Invert Mask')} />
              {g?.props.map((pm) => <PropLine key={pm.path} layer={l} meta={pm} t={t} fps={comp.fps} />)}
            </div>
          );
        })}
        {l.type !== 'null' && l.type !== 'camera' && l.type !== 'audio' && (
          <div className="flex gap-1.5 flex-wrap">
            <button type="button" className="btn inline-flex items-center gap-1" onClick={() => void import('../commands').then((c) => c.runM('m.maskRect'))}><LuSquareDashed size={13} />Rectangle mask</button>
            <button type="button" className="btn inline-flex items-center gap-1" onClick={() => void import('../commands').then((c) => c.runM('m.maskEllipse'))}><LuCircleDashed size={13} />Ellipse mask</button>
          </div>
        )}
        <div className="text-2xs text-faint">Draw masks with the shape tools or the Pen tool set to “Mask”. Drag mask points in the viewer.</div>
      </Section>

      <LayerEffects l={l} comp={comp} t={t} />
    </div>
  );
}

/** The layer's effects with all their settings (also shown on its own as the Effect Controls panel). */
export function LayerEffects({ l, comp, t }: { l: MLayer; comp: Composition; t: number }) {
  const groups = layerGroups(l);
  return (
    <Section title={`Effects${l.effects.length ? ` (${l.effects.length})` : ''}`} defaultOpen>
        {!l.effects.length && <div className="text-2xs text-faint">Add effects from the Effect menu or the Effects & Presets panel. Every setting can be keyframed.</div>}
        {l.effects.map((e) => {
          const g = groups.find((x) => x.id === 'effects')?.sub?.find((s) => s.id === e.id);
          return (
            <div key={e.id} className="flex flex-col gap-0.5 pb-1.5 border-b border-line-soft last:border-0">
              <div className="flex items-center gap-1.5">
                <input type="checkbox" checked={e.enabled} aria-label="Effect on/off" onChange={() => A.toggleEffect(l.id, e.id)} />
                <span className={`flex-1 text-xs font-medium ${e.enabled ? 'text-ink-strong' : 'text-faint line-through'}`}>{effectDef(e.type)?.name ?? e.type}</span>
                <button type="button" className="icon-btn !w-5 !h-5" aria-label="Move effect up" onClick={() => A.moveEffect(l.id, e.id, -1)}><LuArrowUp size={11} /></button>
                <button type="button" className="icon-btn !w-5 !h-5" aria-label="Move effect down" onClick={() => A.moveEffect(l.id, e.id, 1)}><LuArrowDown size={11} /></button>
                <button type="button" className="icon-btn !w-5 !h-5" aria-label="Duplicate effect" onClick={() => A.duplicateEffect(l.id, e.id)}><LuCopy size={11} /></button>
                <button type="button" className="icon-btn !w-5 !h-5" aria-label="Remove effect" onClick={() => A.removeEffect(l.id, e.id)}><LuTrash2 size={11} /></button>
              </div>
              {g?.props.map((pm) => <PropLine key={pm.path} layer={l} meta={pm} t={t} fps={comp.fps} />)}
              {e.type === 'chroma-key' && <div className="text-2xs text-faint">Tip: set Key Color to the screen color, raise Tolerance until the background disappears, then use Edge Softness and Spill Suppression. Turn on View Matte to check the edges.</div>}
            </div>
          );
        })}
      </Section>
  );
}

/** Effect Controls panel (like After Effects): the effects of the selected layer. */
export function EffectControls() {
  const comp = useMotion((s) => activeComp(s));
  const sel = useMotion((s) => s.selectedLayers);
  const t = useMotion((s) => (s.activeCompId ? s.times[s.activeCompId] ?? 0 : 0));
  const l = comp?.layers.find((x) => x.id === sel[0]);
  if (!comp || !l) return <div className="p-4 text-muted text-xs">Select a layer to see its effects. Add effects from the Effect menu or the Effects & Presets panel.</div>;
  return (
    <div className="flex flex-col">
      <div className="px-3 py-2 border-b border-line-soft flex items-center gap-2 text-xs"><span className="w-2.5 h-2.5 rounded-[2px] shrink-0" style={{ background: l.label }} /><span className="text-muted">{comp.name}</span><span className="text-faint">·</span><span className="text-ink-strong truncate" translate="no">{l.name}</span></div>
      <LayerEffects l={l} comp={comp} t={t} />
    </div>
  );
}

function TextSettings({ l }: { l: Extract<MLayer, { type: 'text' }> }) {
  const set = (patch: Partial<typeof l.text>, label = 'Text Change', mk?: string) => A.setLayer(l.id, { text: { ...l.text, ...patch } } as Partial<MLayer>, label, mk);
  const font = FONTS.find((f) => f.family === l.text.font);
  return (
    <Section title="Text">
      <textarea className="field !h-auto w-full min-h-[58px] py-1.5 leading-snug" dir="auto" value={l.text.text} aria-label="Source text"
        onChange={(e) => A.setLayer(l.id, { text: { ...l.text, text: e.target.value }, name: e.target.value.split('\n')[0].slice(0, 32) || 'Text' } as Partial<MLayer>, 'Edit Text', `text-${l.id}`)} onKeyDown={(e) => e.stopPropagation()} />
      <Row label="Font"><Select value={l.text.font} width="100%" options={[FONTS.filter((f) => !f.arabic && f.source === 'google').map((f) => ({ value: f.family, label: f.family })), FONTS.filter((f) => f.arabic).map((f) => ({ value: f.family, label: f.family })), FONTS.filter((f) => f.source === 'system').map((f) => ({ value: f.family, label: f.family }))]} onChange={(v) => set({ font: v }, 'Font')} /></Row>
      <Row label="Weight"><Select value={String(l.text.weight)} width="100%" options={(font?.weights ?? [400, 700]).map((w) => ({ value: String(w), label: String(w) }))} onChange={(v) => set({ weight: Number(v) }, 'Font Weight')} /></Row>
      <Row label="Align">
        {(['left', 'center', 'right'] as const).map((a) => <button key={a} type="button" className={`btn h-[22px] px-2 text-xs ${l.text.align === a ? '!border-accent !text-accent' : ''}`} onClick={() => set({ align: a }, 'Align Text')}>{a === 'left' ? 'Left' : a === 'center' ? 'Center' : 'Right'}</button>)}
        <Checkbox checked={l.text.italic} label="Italic" onChange={(v) => set({ italic: v }, 'Italic')} />
      </Row>
      <div className="flex gap-3"><Checkbox checked={l.text.strokeOn} label="Stroke" onChange={(v) => set({ strokeOn: v }, 'Text Stroke')} /><Checkbox checked={l.text.shadowOn} label="Shadow" onChange={(v) => set({ shadowOn: v }, 'Text Shadow')} />
        {l.text.shadowOn && <span className="flex items-center gap-1 text-xs text-muted">Angle <ScrubNumber value={l.text.shadowAngle} unit="°" label="Shadow angle" onChange={(v) => set({ shadowAngle: v }, 'Shadow Angle', `sa-${l.id}`)} /></span>}</div>
      <Row label="Animator">
        <Select value={l.text.animator.type} width="100%" options={(['none', 'typewriter', 'charReveal', 'wordReveal'] as TextAnimatorType[]).map((v) => ({ value: v, label: { none: 'None', typewriter: 'Typewriter', charReveal: 'Character Reveal', wordReveal: 'Word Reveal' }[v] }))}
          onChange={(v) => set({ animator: { ...l.text.animator, type: v } }, 'Text Animator')} />
      </Row>
      {l.text.animator.type !== 'none' && <>
        <div className="text-2xs text-faint">Animate “Animator Progress” (0 → 100%) below to reveal the text.</div>
        {(l.text.animator.type === 'charReveal' || l.text.animator.type === 'wordReveal') && <Row label="Rise"><ScrubNumber value={l.text.animator.offsetY} unit="px" label="Rise distance" onChange={(v) => set({ animator: { ...l.text.animator, offsetY: v } }, 'Animator', `ay-${l.id}`)} /><Checkbox checked={l.text.animator.fade} label="Fade" onChange={(v) => set({ animator: { ...l.text.animator, fade: v } }, 'Animator')} /></Row>}
      </>}
      <RangeAnimators l={l} />
    </Section>
  );
}

function newRepeater(): Repeater {
  const p = <T extends PropValue>(v: T) => ({ v, k: [] }) as Prop<T>;
  return { copies: p(3), offset: p(0), anchor: p<Vec2>([0, 0]), position: p<Vec2>([100, 0]), scale: p<Vec2>([100, 100]), rotation: p(0), startOpacity: p(100), endOpacity: p(100), composite: 'below' };
}

/** Solid colour or a linear / radial gradient with editable colour stops */
function GradientRow({ l, which, label }: { l: Extract<MLayer, { type: 'shape' }>; which: 'fillGradient' | 'strokeGradient'; label: string }) {
  const g = l.shape[which] ?? null;
  const set = (ng: Gradient | null, lab: string) => A.setLayer(l.id, { shape: { ...l.shape, [which]: ng } } as Partial<MLayer>, lab);
  const sz = l.shape.size.v;
  const def = (type: 'linear' | 'radial'): Gradient => ({ type, start: { v: type === 'radial' ? [0, 0] : [-sz[0] / 2, 0], k: [] }, end: { v: [sz[0] / 2, 0], k: [] }, stops: [{ o: 0, c: which === 'fillGradient' ? l.shape.fill.v : l.shape.stroke.v, a: 1 }, { o: 1, c: '#ffffff', a: 1 }] });
  return (
    <div className="flex flex-col gap-1">
      <Row label={label}>
        <select className="field h-[22px] text-xs flex-1" value={g ? g.type : 'solid'} aria-label={label} onChange={(e) => { const v = e.target.value; set(v === 'solid' ? null : g ? { ...g, type: v as 'linear' | 'radial' } : def(v as 'linear' | 'radial'), 'Gradient'); }}>
          <option value="solid">Solid colour</option><option value="linear">Linear gradient</option><option value="radial">Radial gradient</option>
        </select>
      </Row>
      {g && (
        <div className="flex flex-col gap-1 ps-[100px]">
          <div className="h-3 rounded-[3px] border border-line" style={{ background: `linear-gradient(90deg, ${[...g.stops].sort((a, b) => a.o - b.o).map((s) => `${s.c} ${Math.round(s.o * 100)}%`).join(', ')})` }} aria-hidden />
          {g.stops.map((st, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <ColorButton color={st.c} size={16} label={`Stop ${i + 1} colour`} onChange={(c) => set({ ...g, stops: g.stops.map((x, j) => (j === i ? { ...x, c } : x)) }, 'Gradient Colour')} />
              <ScrubNumber value={Math.round(st.o * 100)} min={0} max={100} unit="%" label={`Stop ${i + 1} position`} onChange={(v) => set({ ...g, stops: g.stops.map((x, j) => (j === i ? { ...x, o: v / 100 } : x)) }, 'Gradient Stop')} />
              <ScrubNumber value={Math.round(st.a * 100)} min={0} max={100} unit="%" label={`Stop ${i + 1} opacity`} onChange={(v) => set({ ...g, stops: g.stops.map((x, j) => (j === i ? { ...x, a: v / 100 } : x)) }, 'Gradient Opacity')} />
              {g.stops.length > 2 && <button type="button" className="icon-btn !w-5 !h-5" aria-label="Remove stop" onClick={() => set({ ...g, stops: g.stops.filter((_, j) => j !== i) }, 'Remove Gradient Stop')}><LuTrash2 size={11} /></button>}
            </div>
          ))}
          <button type="button" className="self-start text-xs text-[#a78bfa] hover:underline" onClick={() => set({ ...g, stops: [...g.stops, { o: 0.5, c: '#888888', a: 1 }] }, 'Add Gradient Stop')}>+ Colour stop</button>
        </div>
      )}
    </div>
  );
}

const ANIM_PROPS: { key: 'position' | 'scale' | 'rotation' | 'opacity' | 'fill' | 'tracking'; label: string; def: PropValue }[] = [
  { key: 'opacity', label: 'Opacity', def: 0 }, { key: 'position', label: 'Position', def: [0, 40] }, { key: 'scale', label: 'Scale', def: 0 },
  { key: 'rotation', label: 'Rotation', def: 45 }, { key: 'fill', label: 'Fill Color', def: '#ffb547' }, { key: 'tracking', label: 'Tracking', def: 10 },
];
/** After Effects text animators: Animate ▸ Opacity / Position / Scale… with a Range Selector */
function RangeAnimators({ l }: { l: Extract<MLayer, { type: 'text' }> }) {
  const list = l.text.animators ?? [];
  const t = useMotion((s) => (s.activeCompId ? s.times[s.activeCompId] ?? 0 : 0));
  const comp = useMotion((s) => activeComp(s));
  const save = (animators: TextRangeAnimator[], label: string) => A.setLayer(l.id, { text: { ...l.text, animators } } as Partial<MLayer>, label);
  const p = <T extends PropValue>(v: T) => ({ v, k: [] }) as Prop<T>;
  const add = (key: (typeof ANIM_PROPS)[number]['key']) => {
    const d = ANIM_PROPS.find((x) => x.key === key)!;
    const fps = comp?.fps ?? 30;
    // a ready range: the selector end sweeps 0 → 100% over one second from now (the classic reveal)
    const end: Prop<number> = { v: 0, k: [{ id: `k_${Date.now().toString(36)}a`, t, v: 0, interp: 'bezier', out: [0.33, 0], in: [0.67, 1] }, { id: `k_${Date.now().toString(36)}b`, t: t + Math.round(fps) / fps, v: 100, interp: 'bezier', out: [0.33, 0], in: [0.67, 1] }] };
    const a: TextRangeAnimator = { id: `tan${Date.now().toString(36)}`, name: `Animator ${list.length + 1}`, basedOn: 'chars', shape: 'square', start: p(0), end, offset: p(0), amount: p(100), [key]: p(d.def as never) };
    // the selected units take the property value; the reveal works by inverting: selector covers what is not yet shown
    a.start = { ...end, k: end.k.map((k) => ({ ...k, id: `${k.id}s` })) }; a.end = p(100);
    save([...list, a], 'Add Text Animator');
  };
  return (
    <div className="flex flex-col gap-1.5 pt-1 border-t border-line-soft">
      <div className="flex items-center gap-2"><span className="text-xs text-muted flex-1">Text animators (range selector)</span>
        <select className="field h-[22px] text-xs" value="" aria-label="Animate" onChange={(e) => { if (e.target.value) add(e.target.value as 'opacity'); }}>
          <option value="">Animate ▸</option>{ANIM_PROPS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
      </div>
      {list.map((a) => {
        const upd = (patch: Partial<TextRangeAnimator>, lab = 'Text Animator') => save(list.map((x) => (x.id === a.id ? { ...x, ...patch } : x)), lab);
        const metas = [
          { path: `tanim:${a.id}.start`, label: 'Start', kind: 'percent' as const }, { path: `tanim:${a.id}.end`, label: 'End', kind: 'percent' as const },
          { path: `tanim:${a.id}.offset`, label: 'Offset', kind: 'percent' as const },
          ...ANIM_PROPS.filter((x) => a[x.key]).map((x) => ({ path: `tanim:${a.id}.${x.key}`, label: x.label, kind: (x.key === 'position' ? 'vec2' : x.key === 'fill' ? 'color' : x.key === 'rotation' ? 'angle' : x.key === 'tracking' ? 'number' : 'percent') as 'percent' })),
        ];
        return (
          <div key={a.id} className="rounded-[6px] border border-line-soft p-1.5 flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-ink-strong flex-1 truncate">{a.name}</span>
              <select className="field h-[20px] text-2xs" value={a.basedOn} aria-label="Based on" onChange={(e) => upd({ basedOn: e.target.value as TextRangeAnimator['basedOn'] })}><option value="chars">Characters</option><option value="words">Words</option><option value="lines">Lines</option></select>
              <select className="field h-[20px] text-2xs" value={a.shape} aria-label="Shape" onChange={(e) => upd({ shape: e.target.value as TextRangeAnimator['shape'] })}><option value="square">Square</option><option value="rampUp">Ramp Up</option><option value="rampDown">Ramp Down</option><option value="triangle">Triangle</option><option value="round">Round</option><option value="smooth">Smooth</option></select>
              <button type="button" className="icon-btn !w-5 !h-5" aria-label="Remove animator" onClick={() => save(list.filter((x) => x.id !== a.id), 'Remove Text Animator')}><LuTrash2 size={11} /></button>
            </div>
            {comp && metas.map((m) => <PropLine key={m.path} layer={l} meta={m} t={t} fps={comp.fps} />)}
            <select className="field h-[20px] text-2xs self-start" value="" aria-label="Add property" onChange={(e) => { const d = ANIM_PROPS.find((x) => x.key === e.target.value); if (d) upd({ [d.key]: p(d.def as never) }, 'Add Animator Property'); }}>
              <option value="">Add ▸</option>{ANIM_PROPS.filter((x) => !a[x.key]).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </div>
        );
      })}
    </div>
  );
}
