// Animation presets. Each one writes ordinary keyframes / effects / masks / layers, so everything
// stays editable after it is applied.
import type { Composition, Keyframe, MLayer, Prop, PropValue, Vec2, Vec3 } from './types';
import { applyEase, makeKey, snapTime, valueAt, type EasePreset } from './anim';
import { useMotion, mcommit, updateComp, activeComp, compTime, getProp, setProp } from './store';
import { newEffect, newMask, newShape, newSolid, newText, rectPathAt, ellipsePath } from './factory';
import { contentBounds } from './render/renderer';
import { toast } from '../state/uiStore';

export type PresetCategory = 'Text Animations' | 'Logo Animations' | 'Shape Animations' | 'Transitions' | 'Glitch' | 'Cinematic' | 'Minimal' | 'Modern' | 'Broadcast Graphics';
export const PRESET_CATEGORIES: PresetCategory[] = ['Text Animations', 'Logo Animations', 'Shape Animations', 'Transitions', 'Glitch', 'Cinematic', 'Minimal', 'Modern', 'Broadcast Graphics'];

interface Ctx { comp: Composition; t: number; fps: number; project: ReturnType<typeof useMotion.getState>['project'] }
export interface Preset {
  id: string; name: string; category: PresetCategory; description: string;
  /** transforms one selected layer */
  layer?: (l: MLayer, c: Ctx) => MLayer;
  /** creates new layers (broadcast graphics); returned top → bottom */
  create?: (c: Ctx) => MLayer[];
  textOnly?: boolean;
}

// ---------- helpers ----------
type K<T extends PropValue> = [number, T, EasePreset?, { in?: Vec2; out?: Vec2 }?];
/** Replaces keys inside [t0, t1] with the given ones (other keys are kept). */
function keys<T extends PropValue>(p: Prop<T>, list: K<T>[], fps: number): Prop<T> {
  const t0 = Math.min(...list.map((k) => k[0])), t1 = Math.max(...list.map((k) => k[0]));
  const add: Keyframe<T>[] = list.map(([t, v, e, h]) => { let k = applyEase(makeKey(snapTime(t, fps), v), e ?? 'linear'); if (h) k = { ...k, interp: 'bezier', ...(h.in ? { in: h.in } : {}), ...(h.out ? { out: h.out } : {}) }; return k; });
  const kept = p.k.filter((k) => k.t < t0 - 0.5 / fps || k.t > t1 + 0.5 / fps);
  return { v: p.v, k: [...kept, ...add].sort((a, b) => a.t - b.t) };
}
function withProp<T extends PropValue>(l: MLayer, path: string, fn: (p: Prop<T>) => Prop<T>): MLayer {
  const p = getProp(l, path) as Prop<T> | null; return p ? setProp(l, path, fn(p) as Prop) : l;
}
const at = <T extends PropValue>(l: MLayer, path: string, t: number) => valueAt(getProp(l, path) as Prop<T>, t);
function addFx(l: MLayer, type: string, params: Record<string, (p: Prop) => Prop> = {}): MLayer {
  const e = newEffect(type); if (!e) return l;
  for (const [k, fn] of Object.entries(params)) if (e.params[k]) e.params[k] = fn(e.params[k] as Prop) as never;
  return { ...l, effects: [...l.effects, e] };
}
const endOf = (l: MLayer, c: Ctx, d: number) => Math.max(l.inPoint, l.outPoint - d);
const fade = (l: MLayer, c: Ctx, t: number, d: number, from: number, to: number, e: EasePreset = 'easeOut') => withProp<number>(l, 'transform.opacity', (p) => keys(p, [[t, from, e], [t + d, to, 'easeIn']], c.fps));
const moveBy = (l: MLayer, c: Ctx, t: number, d: number, dx: number, dy: number, reverse = false, e: [EasePreset, EasePreset] = ['easeOut', 'easeIn']) => {
  const p0 = at<Vec3>(l, 'transform.position', reverse ? t : t + d);
  const off: Vec3 = [p0[0] + dx, p0[1] + dy, p0[2]];
  return withProp<Vec3>(l, 'transform.position', (p) => keys(p, reverse ? [[t, p0, e[0]], [t + d, off, e[1]]] : [[t, off, e[0]], [t + d, p0, e[1]]], c.fps));
};
const scaleTo = (l: MLayer, c: Ctx, list: [number, number, EasePreset?, { in?: Vec2; out?: Vec2 }?][]) => {
  const s0 = at<Vec3>(l, 'transform.scale', list[list.length - 1][0]);
  const f = (pct: number): Vec3 => [(s0[0] * pct) / 100, (s0[1] * pct) / 100, s0[2]];
  return withProp<Vec3>(l, 'transform.scale', (p) => keys(p, list.map(([t, v, e, h]) => [t, f(v), e, h] as K<Vec3>), c.fps));
};
const textDur = (l: MLayer) => (l.type === 'text' ? Math.min(4, Math.max(0.6, l.text.text.length * 0.05)) : 1);
const animator = (l: MLayer, c: Ctx, type: 'typewriter' | 'charReveal' | 'wordReveal', d: number): MLayer => {
  if (l.type !== 'text') return l;
  const progress = keys(l.text.animator.progress, [[c.t, 0, type === 'typewriter' ? 'linear' : 'linear'], [c.t + d, 100]], c.fps);
  return { ...l, text: { ...l.text, animator: { ...l.text.animator, type, progress } } };
};
const ELASTIC_OUT: Vec2 = [0.2, 1.6];
const BACK_OUT: Vec2 = [0.25, 1.4];

export const PRESETS: Preset[] = [
  // ----- Text -----
  { id: 'fade-in', name: 'Fade In', category: 'Text Animations', description: 'Opacity 0 → 100', layer: (l, c) => fade(l, c, c.t, 0.6, 0, 100) },
  { id: 'fade-out', name: 'Fade Out', category: 'Text Animations', description: 'Fades out at the layer end', layer: (l, c) => fade(l, c, endOf(l, c, 0.6), 0.6, 100, 0, 'easeIn') },
  { id: 'slide-in', name: 'Slide In', category: 'Text Animations', description: 'Slides in from the left', layer: (l, c) => fade(moveBy(l, c, c.t, 0.7, -c.comp.width * 0.25, 0), c, c.t, 0.35, 0, 100) },
  { id: 'slide-out', name: 'Slide Out', category: 'Text Animations', description: 'Slides out to the right at the layer end', layer: (l, c) => { const t = endOf(l, c, 0.7); return fade(moveBy(l, c, t, 0.7, c.comp.width * 0.25, 0, true, ['easeIn', 'easeIn']), c, t + 0.35, 0.35, 100, 0); } },
  { id: 'scale-in', name: 'Scale In', category: 'Text Animations', description: 'Grows from 0', layer: (l, c) => fade(scaleTo(l, c, [[c.t, 0, 'easeOut'], [c.t + 0.6, 100, 'easeIn']]), c, c.t, 0.3, 0, 100) },
  { id: 'scale-out', name: 'Scale Out', category: 'Text Animations', description: 'Shrinks to 0 at the layer end', layer: (l, c) => { const t = endOf(l, c, 0.6); return scaleTo(l, c, [[t, 100, 'easeOut'], [t + 0.6, 0, 'easeIn']]); } },
  { id: 'typewriter', name: 'Typewriter', category: 'Text Animations', description: 'Types the text letter by letter', textOnly: true, layer: (l, c) => animator(l, c, 'typewriter', textDur(l)) },
  { id: 'char-reveal', name: 'Character Reveal', category: 'Text Animations', description: 'Letters fade and rise in one by one', textOnly: true, layer: (l, c) => animator(l, c, 'charReveal', textDur(l) + 0.4) },
  { id: 'word-reveal', name: 'Word Reveal', category: 'Text Animations', description: 'Words fade and rise in one by one', textOnly: true, layer: (l, c) => animator(l, c, 'wordReveal', textDur(l) + 0.4) },
  { id: 'bounce', name: 'Bounce', category: 'Text Animations', description: 'Drops in and bounces', layer: (l, c) => {
    const t = c.t; const p0 = at<Vec3>(l, 'transform.position', t + 1);
    const y = (dy: number): Vec3 => [p0[0], p0[1] + dy, p0[2]];
    return fade(withProp<Vec3>(l, 'transform.position', (p) => keys(p, [[t, y(-c.comp.height * 0.4), 'easeIn'], [t + 0.45, y(0), 'easeOut'], [t + 0.62, y(-60), 'easeIn'], [t + 0.78, y(0), 'easeOut'], [t + 0.88, y(-18), 'easeIn'], [t + 0.98, y(0), 'easeOut']], c.fps)), c, t, 0.2, 0, 100);
  } },
  { id: 'pop', name: 'Pop', category: 'Text Animations', description: 'Pops in with a little overshoot', layer: (l, c) => fade(scaleTo(l, c, [[c.t, 0, 'easeOut'], [c.t + 0.25, 115, 'easeInOut'], [c.t + 0.4, 95, 'easeInOut'], [c.t + 0.5, 100, 'easeIn']]), c, c.t, 0.15, 0, 100) },
  { id: 'blur-in', name: 'Blur In', category: 'Text Animations', description: 'Comes into focus', layer: (l, c) => fade(addFx(l, 'gaussian-blur', { blurriness: (p) => keys(p as Prop<number>, [[c.t, 60, 'easeOut'], [c.t + 0.8, 0, 'easeIn']], c.fps) as Prop }), c, c.t, 0.5, 0, 100) },
  { id: 'blur-out', name: 'Blur Out', category: 'Text Animations', description: 'Goes out of focus at the end', layer: (l, c) => { const t = endOf(l, c, 0.8); return fade(addFx(l, 'gaussian-blur', { blurriness: (p) => keys(p as Prop<number>, [[t, 0, 'easeOut'], [t + 0.8, 60, 'easeIn']], c.fps) as Prop }), c, t + 0.3, 0.5, 100, 0); } },
  { id: 'glitch-text', name: 'Glitch', category: 'Text Animations', description: 'Glitchy entrance', layer: (l, c) => fade(addFx(l, 'glitch', { amount: (p) => keys(p as Prop<number>, [[c.t, 100, 'hold'], [c.t + 0.3, 40, 'hold'], [c.t + 0.5, 70, 'hold'], [c.t + 0.6, 0, 'hold']], c.fps) as Prop }), c, c.t, 0.1, 0, 100) },
  // ----- Logo -----
  { id: 'logo-reveal', name: 'Logo Reveal', category: 'Logo Animations', description: 'Scale, blur and fade into place', layer: (l, c) => fade(scaleTo(addFx(l, 'gaussian-blur', { blurriness: (p) => keys(p as Prop<number>, [[c.t, 40, 'easeOut'], [c.t + 1, 0, 'easeIn']], c.fps) as Prop }), c, [[c.t, 80, 'easeOut'], [c.t + 1.2, 100, 'easeIn']]), c, c.t, 0.7, 0, 100) },
  { id: 'spin-in', name: 'Spin In', category: 'Logo Animations', description: 'Spins and grows in', layer: (l, c) => {
    const r0 = at<number>(l, 'transform.rotation', c.t + 1);
    return fade(scaleTo(withProp<number>(l, 'transform.rotation', (p) => keys(p, [[c.t, r0 - 180, 'easeOut'], [c.t + 0.9, r0, 'easeIn']], c.fps)), c, [[c.t, 0, 'easeOut'], [c.t + 0.9, 100, 'easeIn']]), c, c.t, 0.4, 0, 100);
  } },
  { id: 'glow-pulse', name: 'Glow Pulse', category: 'Logo Animations', description: 'Adds a pulsing glow', layer: (l, c) => addFx(l, 'glow', { intensity: (p) => keys(p as Prop<number>, [[c.t, 0, 'easeInOut'], [c.t + 0.6, 200, 'easeInOut'], [c.t + 1.2, 60, 'easeInOut']], c.fps) as Prop, threshold: (p) => ({ ...p, v: 30 }) }) },
  { id: 'elastic-logo', name: 'Elastic Pop', category: 'Logo Animations', description: 'Springy scale-in', layer: (l, c) => fade(scaleTo(l, c, [[c.t, 0, 'bezier', { out: ELASTIC_OUT }], [c.t + 0.7, 100, 'easeIn']]), c, c.t, 0.2, 0, 100) },
  // ----- Shapes -----
  { id: 'draw-on', name: 'Draw On', category: 'Shape Animations', description: 'Draws the stroke along the path', layer: (l, c) => {
    if (l.type !== 'shape') return scaleTo(l, c, [[c.t, 0, 'easeOut'], [c.t + 0.6, 100]]);
    return { ...l, shape: { ...l.shape, strokeOn: true, trimEnd: keys(l.shape.trimEnd, [[c.t, 0, 'easeOut'], [c.t + 1, 100, 'easeIn']], c.fps) } };
  } },
  { id: 'grow', name: 'Grow', category: 'Shape Animations', description: 'Grows from 0 with an ease', layer: (l, c) => scaleTo(l, c, [[c.t, 0, 'easeOut'], [c.t + 0.6, 100, 'easeIn']]) },
  { id: 'pulse', name: 'Pulse', category: 'Shape Animations', description: 'Three soft pulses', layer: (l, c) => scaleTo(l, c, [0, 1, 2, 3, 4, 5, 6].map((i) => [c.t + i * 0.3, i % 2 ? 110 : 100, 'easeInOut'] as [number, number, EasePreset])) },
  { id: 'rotate-loop', name: 'Rotate', category: 'Shape Animations', description: 'One full turn every 2 seconds until the layer ends', layer: (l, c) => {
    const r0 = at<number>(l, 'transform.rotation', c.t); const turns = Math.max(1, Math.round((l.outPoint - c.t) / 2));
    return withProp<number>(l, 'transform.rotation', (p) => keys(p, [[c.t, r0, 'linear'], [c.t + turns * 2, r0 + 360 * turns, 'linear']], c.fps));
  } },
  { id: 'shake', name: 'Shake', category: 'Shape Animations', description: 'Quick random shake (1 s)', layer: (l, c) => {
    const p0 = at<Vec3>(l, 'transform.position', c.t); let seed = 7;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280 - 0.5) * 40;
    const list: K<Vec3>[] = []; for (let i = 0; i <= 12; i++) list.push([c.t + i / 12, i === 0 || i === 12 ? p0 : [p0[0] + rnd(), p0[1] + rnd(), p0[2]], 'linear']);
    return withProp<Vec3>(l, 'transform.position', (p) => keys(p, list, c.fps));
  } },
  // ----- Transitions -----
  { id: 'wipe-in', name: 'Wipe In', category: 'Transitions', description: 'Reveals left → right with an animated mask', layer: (l, c) => {
    const b = contentBounds(c.project, l, c.t) ?? { x: 0, y: 0, w: c.comp.width, h: c.comp.height };
    const m = newMask(rectPathAt(b.x, b.y, b.w, b.h), `Mask ${l.masks.length + 1}`);
    m.path = keys(m.path, [[c.t, rectPathAt(b.x, b.y, 0.01, b.h), 'easeOut'], [c.t + 0.8, rectPathAt(b.x, b.y, b.w, b.h), 'easeIn']], c.fps);
    m.feather = { v: 20, k: [] };
    return { ...l, masks: [...l.masks, m] };
  } },
  { id: 'circle-reveal', name: 'Circle Reveal', category: 'Transitions', description: 'Expanding circular mask', layer: (l, c) => {
    const b = contentBounds(c.project, l, c.t) ?? { x: 0, y: 0, w: c.comp.width, h: c.comp.height };
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = Math.hypot(b.w, b.h);
    const m = newMask(ellipsePath(r, r, cx, cy), `Mask ${l.masks.length + 1}`);
    m.path = keys(m.path, [[c.t, ellipsePath(1, 1, cx, cy), 'easeOut'], [c.t + 1, ellipsePath(r, r, cx, cy), 'easeIn']], c.fps);
    return { ...l, masks: [...l.masks, m] };
  } },
  { id: 'zoom-transition', name: 'Zoom In', category: 'Transitions', description: 'Zooms in from 200% with blur', layer: (l, c) => fade(scaleTo(addFx(l, 'gaussian-blur', { blurriness: (p) => keys(p as Prop<number>, [[c.t, 50, 'easeOut'], [c.t + 0.6, 0, 'easeIn']], c.fps) as Prop }), c, [[c.t, 200, 'easeOut'], [c.t + 0.6, 100, 'easeIn']]), c, c.t, 0.3, 0, 100) },
  { id: 'fade-black', name: 'Fade to Black', category: 'Transitions', description: 'Adds a black solid that fades in over 1 s', create: (c) => {
    const s = newSolid(c.comp, '#000000', c.t, c.comp.width, c.comp.height, 'Fade to Black');
    return [{ ...s, transform: { ...s.transform, opacity: keys(s.transform.opacity, [[c.t, 0, 'easeInOut'], [c.t + 1, 100, 'easeInOut']], c.fps) } }];
  } },
  { id: 'push-left', name: 'Push Left', category: 'Transitions', description: 'Slides out to the left at the layer end', layer: (l, c) => { const t = endOf(l, c, 0.6); return moveBy(l, c, t, 0.6, -c.comp.width, 0, true, ['easeInOut', 'easeInOut']); } },
  // ----- Glitch -----
  { id: 'glitch-burst', name: 'Glitch Burst', category: 'Glitch', description: 'Short digital glitch with RGB split', layer: (l, c) => addFx(addFx(l, 'glitch', { amount: (p) => keys(p as Prop<number>, [[c.t, 0, 'hold'], [c.t + 0.1, 90, 'hold'], [c.t + 0.25, 30, 'hold'], [c.t + 0.35, 80, 'hold'], [c.t + 0.5, 0, 'hold']], c.fps) as Prop }), 'rgb-split', { amount: (p) => keys(p as Prop<number>, [[c.t, 0, 'hold'], [c.t + 0.1, 20, 'hold'], [c.t + 0.5, 0, 'hold']], c.fps) as Prop }) },
  { id: 'rgb-shake', name: 'RGB Shake', category: 'Glitch', description: 'Chromatic shake for 1 s', layer: (l, c) => addFx(l, 'rgb-split', { amount: (p) => keys(p as Prop<number>, [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => [c.t + i / 8, i % 2 ? 14 : 2, 'linear'] as K<number>), c.fps) as Prop, angle: (p) => keys(p as Prop<number>, [[c.t, 0, 'linear'], [c.t + 1, 720, 'linear']], c.fps) as Prop }) },
  { id: 'digital-noise', name: 'Digital Noise', category: 'Glitch', description: 'Animated noise and displacement', layer: (l) => addFx(addFx(l, 'noise', { amount: (p) => ({ ...p, v: 25 }) }), 'displacement', { amount: (p) => ({ ...p, v: 6 }), size: (p) => ({ ...p, v: 40 }) }) },
  // ----- Cinematic -----
  { id: 'ken-burns', name: 'Slow Zoom (Ken Burns)', category: 'Cinematic', description: 'Slow push-in until the layer ends', layer: (l, c) => scaleTo(l, c, [[c.t, 100, 'linear'], [Math.max(c.t + 1, l.outPoint), 115, 'linear']]).valueOf() as MLayer },
  { id: 'cinematic-look', name: 'Cinematic Look', category: 'Cinematic', description: 'Teal & orange grade, vignette and grain', layer: (l) => addFx(addFx(addFx(l, 'color-balance', { sb: (p) => ({ ...p, v: 18 }), sg: (p) => ({ ...p, v: 6 }), hr: (p) => ({ ...p, v: 16 }), hg: (p) => ({ ...p, v: 6 }), hb: (p) => ({ ...p, v: -10 }) }), 'vignette', { amount: (p) => ({ ...p, v: 45 }) }), 'film-grain', { intensity: (p) => ({ ...p, v: 20 }) }) },
  { id: 'letterbox', name: 'Letterbox Bars', category: 'Cinematic', description: 'Adds 2.39:1 black bars', create: (c) => {
    const h = Math.max(1, Math.round((c.comp.height - c.comp.width / 2.39) / 2));
    const mk = (y: number, name: string) => { const s = newShape(c.comp, 'rect', c.t, { size: [c.comp.width, h], position: [c.comp.width / 2, y, 0], fill: '#000000' }); return { ...s, name, inPoint: 0 } as MLayer; };
    return [mk(h / 2, 'Letterbox Top'), mk(c.comp.height - h / 2, 'Letterbox Bottom')];
  } },
  { id: 'light-leak', name: 'Light Leak', category: 'Cinematic', description: 'Warm glowing light sweep', create: (c) => {
    const s = newShape(c.comp, 'ellipse', c.t, { size: [c.comp.width * 0.9, c.comp.height * 1.2], position: [-c.comp.width * 0.1, c.comp.height / 2, 0], fill: '#ff9a3c' });
    let l: MLayer = { ...s, name: 'Light Leak', blend: 'screen' };
    l = addFx(l, 'gaussian-blur', { blurriness: (p) => ({ ...p, v: 160 }) });
    l = fade(l, c, c.t, 0.8, 0, 70, 'easeInOut');
    return [moveBy(l, c, c.t, 3, 0, 0, false).valueOf() as MLayer].map((x) => withProp<Vec3>(x, 'transform.position', (p) => keys(p, [[c.t, [-c.comp.width * 0.1, c.comp.height / 2, 0], 'easeInOut'], [c.t + 3, [c.comp.width * 1.1, c.comp.height / 2, 0], 'easeInOut']], c.fps)));
  } },
  // ----- Minimal -----
  { id: 'soft-fade-up', name: 'Soft Fade Up', category: 'Minimal', description: 'Fades in while rising slightly', layer: (l, c) => fade(moveBy(l, c, c.t, 0.8, 0, 40), c, c.t, 0.8, 0, 100) },
  { id: 'line-reveal', name: 'Line Reveal', category: 'Minimal', description: 'Rises from behind an invisible line', layer: (l, c) => {
    const b = contentBounds(c.project, l, c.t) ?? { x: 0, y: 0, w: 100, h: 100 };
    const m = newMask(rectPathAt(b.x - 20, b.y - 10, b.w + 40, b.h + 20), `Mask ${l.masks.length + 1}`);
    return { ...moveBy(l, c, c.t, 0.7, 0, b.h * 1.1), masks: [...l.masks, m] };
  } },
  { id: 'tracking-in', name: 'Tracking In', category: 'Minimal', description: 'Letter spacing closes in', textOnly: true, layer: (l, c) => l.type !== 'text' ? l : fade({ ...l, text: { ...l.text, tracking: keys(l.text.tracking, [[c.t, 40, 'easeOut'], [c.t + 1.2, valueAt(l.text.tracking, c.t + 2), 'easeIn']], c.fps) } }, c, c.t, 0.6, 0, 100) },
  // ----- Modern -----
  { id: 'blur-slide', name: 'Blur Slide', category: 'Modern', description: 'Fast slide with motion blur', layer: (l, c) => fade({ ...moveBy(l, c, c.t, 0.5, c.comp.width * 0.3, 0), motionBlur: true }, c, c.t, 0.3, 0, 100) },
  { id: 'elastic-pop', name: 'Elastic Pop', category: 'Modern', description: 'Overshooting spring scale', layer: (l, c) => scaleTo(l, c, [[c.t, 0, 'bezier', { out: BACK_OUT }], [c.t + 0.55, 100, 'easeIn']]) },
  { id: 'flip-in', name: '3D Flip In', category: 'Modern', description: 'Flips in around Y (3D layer)', layer: (l, c) => fade({ ...withProp<number>({ ...l, threeD: true } as MLayer, 'transform.rotationY', (p) => keys(p, [[c.t, -90, 'easeOut'], [c.t + 0.8, 0, 'easeIn']], c.fps)) }, c, c.t, 0.3, 0, 100) },
  // ----- Broadcast -----
  { id: 'lower-third', name: 'Lower Third', category: 'Broadcast Graphics', description: 'Name + title bar that slides in', create: (c) => {
    const W = c.comp.width, H = c.comp.height; const y = H * 0.8; const x0 = W * 0.08;
    const barW = W * 0.36, barH = H * 0.1;
    let bar: MLayer = newShape(c.comp, 'rect', c.t, { size: [barW, barH], position: [x0 + barW / 2, y, 0], fill: '#4f8cff' });
    bar = { ...bar, name: 'Lower Third Bar' };
    bar = withProp<Vec3>(bar, 'transform.scale', (p) => keys(p, [[c.t, [0, 100, 100], 'easeOut'], [c.t + 0.5, [100, 100, 100], 'easeIn']], c.fps));
    bar = withProp<Vec3>(bar, 'transform.anchor', (p) => ({ ...p, v: [-barW / 2, 0, 0] }));
    bar = withProp<Vec3>(bar, 'transform.position', (p) => ({ ...p, v: [x0, y, 0] }));
    const nameL = newText(c.comp, 'Name Surname', c.t + 0.3, { size: Math.round(barH * 0.42), position: [x0 + barH * 0.3, y + barH * 0.15, 0] });
    let n: MLayer = { ...nameL, text: { ...nameL.text, align: 'left' } } as MLayer;
    n = fade(moveBy(n, c, c.t + 0.3, 0.5, -40, 0), c, c.t + 0.3, 0.4, 0, 100);
    const titleL = newText(c.comp, 'Title / Role', c.t + 0.45, { size: Math.round(barH * 0.28), color: '#cfe0ff', position: [x0 + barH * 0.3, y + barH * 1.05, 0] });
    let ti: MLayer = { ...titleL, text: { ...titleL.text, align: 'left', weight: 500 } } as MLayer;
    ti = fade(moveBy(ti, c, c.t + 0.45, 0.5, -40, 0), c, c.t + 0.45, 0.4, 0, 100);
    return [n, ti, bar];
  } },
  { id: 'title-card', name: 'Title Card', category: 'Broadcast Graphics', description: 'Big title with a line and subtitle', create: (c) => {
    const W = c.comp.width, H = c.comp.height;
    let title: MLayer = newText(c.comp, 'BIG TITLE', c.t, { size: Math.round(H * 0.12), position: [W / 2, H * 0.47, 0] });
    title = fade(scaleTo(title, c, [[c.t, 85, 'easeOut'], [c.t + 0.8, 100, 'easeIn']]), c, c.t, 0.6, 0, 100);
    let line: MLayer = newShape(c.comp, 'line', c.t + 0.3, { size: [W * 0.3, 0], position: [W / 2, H * 0.53, 0] });
    line = { ...line, shape: { ...(line as Extract<MLayer, { type: 'shape' }>).shape, strokeWidth: { v: Math.max(2, H * 0.004), k: [] }, trimStart: keys({ v: 0, k: [] }, [[c.t + 0.3, 50, 'easeOut'], [c.t + 1, 0, 'easeIn']], c.fps), trimEnd: keys({ v: 100, k: [] }, [[c.t + 0.3, 50, 'easeOut'], [c.t + 1, 100, 'easeIn']], c.fps) } } as MLayer;
    let sub: MLayer = newText(c.comp, 'subtitle goes here', c.t + 0.6, { size: Math.round(H * 0.04), color: '#d0d6de', position: [W / 2, H * 0.6, 0] });
    sub = fade(moveBy(sub, c, c.t + 0.6, 0.6, 0, 20), c, c.t + 0.6, 0.6, 0, 100);
    return [title, line, sub];
  } },
  { id: 'news-ticker', name: 'News Ticker', category: 'Broadcast Graphics', description: 'Scrolling text on a bar', create: (c) => {
    const W = c.comp.width, H = c.comp.height, h = H * 0.07, y = H - h / 2;
    const bar: MLayer = { ...newShape(c.comp, 'rect', c.t, { size: [W, h], position: [W / 2, y, 0], fill: '#c8102e' }), name: 'Ticker Bar' };
    const txt = newText(c.comp, 'BREAKING  •  Your headline scrolls here  •  KURD DESIGN MOTION', c.t, { size: Math.round(h * 0.5), position: [W, y + h * 0.18, 0] });
    let t: MLayer = { ...txt, text: { ...txt.text, align: 'left' }, name: 'Ticker Text' } as MLayer;
    const dur = Math.max(6, c.comp.duration - c.t);
    t = withProp<Vec3>(t, 'transform.position', (p) => keys(p, [[c.t, [W, y + h * 0.18, 0], 'linear'], [c.t + dur, [-W * 1.6, y + h * 0.18, 0], 'linear']], c.fps));
    return [t, bar];
  } },
];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id);

/** Applies a preset at the current time to the selected layers (or creates its layers). */
export function applyPreset(id: string, layerIds = useMotion.getState().selectedLayers) {
  const p = presetById(id); const comp = activeComp(); if (!p || !comp) { if (!comp) toast('Create a composition first.', 'warning'); return; }
  const s = useMotion.getState();
  const c: Ctx = { comp, t: compTime(), fps: comp.fps, project: s.project };
  if (p.create) {
    const layers = p.create(c);
    mcommit(updateComp(comp.id, (cc) => ({ ...cc, layers: [...layers, ...cc.layers] })), p.name);
    useMotion.setState({ selectedLayers: layers.map((l) => l.id), selectedKeys: [] });
    return;
  }
  const targets = comp.layers.filter((l) => layerIds.includes(l.id) && !l.locked);
  if (!targets.length) { toast('Select a layer to apply the preset to.', 'info'); return; }
  if (p.textOnly && !targets.some((l) => l.type === 'text')) { toast('This preset works on text layers.', 'info'); return; }
  mcommit(updateComp(comp.id, (cc) => ({ ...cc, layers: cc.layers.map((l) => (targets.some((x) => x.id === l.id) && (!p.textOnly || l.type === 'text') ? p.layer!(l, { ...c, comp: cc }) : l)) })), p.name);
  // reveal what the preset animated
  useMotion.setState((st) => ({ timeline: { ...st.timeline, expanded: { ...st.timeline.expanded, ...Object.fromEntries(targets.map((l) => [l.id, true])) } } }));
}

/** User presets: save the selected layer's animation (keyframes, effects, masks) relative to the CTI. */
export function saveUserPreset(name: string) {
  const comp = activeComp(); const s = useMotion.getState(); const l = comp?.layers.find((x) => x.id === s.selectedLayers[0]);
  if (!comp || !l) { toast('Select a layer whose animation you want to save.', 'info'); return; }
  const t = compTime();
  const data = JSON.stringify({ t, layer: l });
  mcommit((p) => ({ ...p, userPresets: [...p.userPresets, { id: `up_${Date.now().toString(36)}`, name: name.trim() || l.name, data }] }), 'Save Animation Preset');
  toast('Animation preset saved', 'success');
}
export function applyUserPreset(id: string) {
  const comp = activeComp(); const s = useMotion.getState(); if (!comp) return;
  const up = s.project.userPresets.find((p) => p.id === id); if (!up) return;
  const { t: t0, layer: src } = JSON.parse(up.data) as { t: number; layer: MLayer };
  const dt = compTime() - t0;
  const targets = comp.layers.filter((l) => s.selectedLayers.includes(l.id));
  if (!targets.length) { toast('Select a layer to apply the preset to.', 'info'); return; }
  const shiftProp = (p: Prop): Prop => ({ ...p, k: p.k.map((k) => ({ ...k, id: `${k.id}_${Math.random().toString(36).slice(2, 6)}`, t: snapTime(k.t + dt, comp.fps) })) });
  mcommit(updateComp(comp.id, (cc) => ({
    ...cc, layers: cc.layers.map((l) => {
      if (!targets.some((x) => x.id === l.id)) return l;
      let out: MLayer = { ...l, transform: Object.fromEntries(Object.entries(src.transform).map(([k, p]) => [k, (p as Prop).k.length ? shiftProp(p as Prop) : (l.transform as unknown as Record<string, Prop>)[k]])) as unknown as MLayer['transform'] };
      out = { ...out, effects: [...out.effects, ...JSON.parse(JSON.stringify(src.effects)).map((e: MLayer['effects'][number]) => ({ ...e, id: `fx_${Math.random().toString(36).slice(2, 9)}`, params: Object.fromEntries(Object.entries(e.params).map(([k, p]) => [k, shiftProp(p as Prop)])) }))] };
      return out;
    }),
  })), up.name);
}
