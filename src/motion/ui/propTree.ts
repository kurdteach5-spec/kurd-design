// Describes which animatable properties a layer shows in the timeline / properties panel.
import type { MLayer } from '../types';
import { effectDef, type EffectParamDef } from '../render/effectDefs';

export type PropKind = 'number' | 'vec2' | 'vec3' | 'color' | 'path' | 'angle' | 'percent' | 'select' | 'checkbox' | 'point';
export interface PropMeta { path: string; label: string; kind: PropKind; unit?: string; min?: number; max?: number; step?: number; options?: { value: string; label: string }[]; dims?: number }
export interface PropGroup { id: string; label: string; props: PropMeta[]; sub?: { id: string; label: string; kind: 'mask' | 'effect'; props: PropMeta[] }[] }

const P = (path: string, label: string, kind: PropKind, o: Partial<PropMeta> = {}): PropMeta => ({ path, label, kind, ...o });

export function transformProps(l: MLayer): PropMeta[] {
  const d = l.threeD ? 3 : 2;
  const out = [
    P('transform.anchor', 'Anchor Point', d === 3 ? 'vec3' : 'vec2', { step: 1 }),
    P('transform.position', 'Position', d === 3 ? 'vec3' : 'vec2', { step: 1 }),
    P('transform.scale', 'Scale', d === 3 ? 'vec3' : 'vec2', { unit: '%', step: 1 }),
  ];
  if (l.threeD) out.push(P('transform.rotationX', 'X Rotation', 'angle'), P('transform.rotationY', 'Y Rotation', 'angle'), P('transform.rotation', 'Z Rotation', 'angle'));
  else out.push(P('transform.rotation', 'Rotation', 'angle'));
  if (l.type !== 'camera') out.push(P('transform.opacity', 'Opacity', 'percent', { min: 0, max: 100 }));
  if (l.type === 'camera' && l.mode === '2d') return [P('transform.position', 'Position', 'vec2'), P('transform.rotation', 'Rotation', 'angle')];
  return out;
}

const fxKind = (p: EffectParamDef): PropKind => (p.type === 'number' ? 'number' : p.type === 'angle' ? 'angle' : p.type === 'color' ? 'color' : p.type === 'point' ? 'point' : p.type === 'select' ? 'select' : 'checkbox');

export function layerGroups(l: MLayer): PropGroup[] {
  const g: PropGroup[] = [];
  if (l.type === 'text') g.push({ id: 'text', label: 'Text', props: [
    P('text.size', 'Font Size', 'number', { min: 1, max: 2000, unit: 'px' }), P('text.color', 'Fill Color', 'color'), P('text.tracking', 'Tracking', 'number', { min: -200, max: 1000, unit: 'px' }),
    P('text.leading', 'Leading', 'number', { min: 0, max: 4000, unit: 'px' }), P('text.strokeColor', 'Stroke Color', 'color'), P('text.strokeWidth', 'Stroke Width', 'number', { min: 0, max: 200, unit: 'px', step: 0.5 }),
    P('text.shadowColor', 'Shadow Color', 'color'), P('text.shadowBlur', 'Shadow Softness', 'number', { min: 0, max: 300, unit: 'px' }), P('text.shadowDistance', 'Shadow Distance', 'number', { min: 0, max: 1000, unit: 'px' }),
    P('text.animator.progress', 'Animator Progress', 'percent', { min: 0, max: 100 }),
  ] });
  if (l.type === 'shape') {
    const k = l.shape.kind;
    const props: PropMeta[] = [];
    if (k !== 'path') props.push(P('shape.size', k === 'line' || k === 'arrow' ? 'Length' : 'Size', 'vec2', { min: 0 }));
    if (k === 'rect') props.push(P('shape.roundness', 'Roundness', 'number', { min: 0, max: 5000, unit: 'px' }));
    if (k === 'star') props.push(P('shape.innerRadius', 'Inner Radius', 'percent', { min: 1, max: 100 }));
    if (k === 'path') props.push(P('shape.path', 'Path', 'path'));
    props.push(P('shape.fill', 'Fill Color', 'color'), P('shape.stroke', 'Stroke Color', 'color'), P('shape.strokeWidth', 'Stroke Width', 'number', { min: 0, max: 500, unit: 'px', step: 0.5 }),
      P('shape.trimStart', 'Trim Start', 'percent', { min: 0, max: 100 }), P('shape.trimEnd', 'Trim End', 'percent', { min: 0, max: 100 }));
    g.push({ id: 'contents', label: 'Contents', props });
  }
  if (l.type === 'solid') g.push({ id: 'solid', label: 'Solid', props: [P('color', 'Color', 'color')] });
  if (l.masks.length) g.push({ id: 'masks', label: 'Masks', props: [], sub: l.masks.map((m) => ({ id: m.id, label: m.name, kind: 'mask', props: [
    P(`mask:${m.id}.path`, 'Mask Path', 'path'), P(`mask:${m.id}.feather`, 'Mask Feather', 'number', { min: 0, max: 1000, unit: 'px' }),
    P(`mask:${m.id}.opacity`, 'Mask Opacity', 'percent', { min: 0, max: 100 }), P(`mask:${m.id}.expansion`, 'Mask Expansion', 'number', { min: -1000, max: 1000, unit: 'px' }),
  ] })) });
  if (l.effects.length) g.push({ id: 'effects', label: 'Effects', props: [], sub: l.effects.map((e) => {
    const d = effectDef(e.type);
    return { id: e.id, label: d?.name ?? e.type, kind: 'effect', props: (d?.params ?? []).map((p) => P(`fx:${e.id}.${p.key}`, p.label, fxKind(p), { min: p.min, max: p.max, step: p.step, unit: p.unit, options: p.options })) };
  }) });
  g.push({ id: 'transform', label: 'Transform', props: transformProps(l) });
  if (l.type === 'video' || l.type === 'audio') g.push({ id: 'audio', label: 'Audio', props: [P('volume', 'Audio Levels', 'number', { min: -48, max: 12, unit: 'dB', step: 0.1 })] });
  if (l.type === 'camera') g.push({ id: 'camera', label: 'Camera Options', props: [P('zoom', l.mode === '3d' ? 'Focal Length' : 'Zoom', 'number', { min: 1, max: l.mode === '3d' ? 400 : 2000, unit: l.mode === '3d' ? 'mm' : '%' })] });
  return g;
}

export function propMeta(l: MLayer, path: string): PropMeta | null {
  for (const g of layerGroups(l)) {
    const p = g.props.find((x) => x.path === path); if (p) return p;
    for (const s of g.sub ?? []) { const q = s.props.find((x) => x.path === path); if (q) return q; }
  }
  return null;
}
