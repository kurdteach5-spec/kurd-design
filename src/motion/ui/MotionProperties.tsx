// Properties panel for the Motion workspace (layer settings + effect controls).
import type { BlendMode, Composition, MLayer, ShapeKind, TextAnimatorType } from '../types';
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
    </Section>
  );
}
