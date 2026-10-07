// Effect catalogue. Every parameter is a keyframeable property.
import type { EffectParamValue } from '../types';

export type EffectCategory = 'Blur' | 'Color Correction' | 'Distortion' | 'Glow' | 'Stylize' | 'Noise' | 'Sharpen' | 'Transform' | 'Keying' | 'Shadow';
export const EFFECT_CATEGORIES: EffectCategory[] = ['Blur', 'Color Correction', 'Distortion', 'Glow', 'Stylize', 'Noise', 'Sharpen', 'Transform', 'Keying', 'Shadow'];

export interface EffectParamDef {
  key: string;
  label: string;
  type: 'number' | 'color' | 'point' | 'select' | 'checkbox' | 'angle';
  default: EffectParamValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
}
export interface EffectDef {
  id: string;
  name: string;
  category: EffectCategory;
  params: EffectParamDef[];
  /** extra pixels the effect may draw outside the layer (in source px) */
  pad?: (p: Record<string, EffectParamValue>) => number;
  /** output changes over time even without keyframes (noise, grain, glitch) */
  timeDependent?: (p: Record<string, EffectParamValue>) => boolean;
}

const n = (key: string, label: string, def: number, min: number, max: number, step = 1, unit = ''): EffectParamDef => ({ key, label, type: 'number', default: def, min, max, step, unit });
const c = (key: string, label: string, def: string): EffectParamDef => ({ key, label, type: 'color', default: def });
const a = (key: string, label: string, def: number): EffectParamDef => ({ key, label, type: 'angle', default: def, min: -3600, max: 3600, step: 1, unit: '°' });
const b = (key: string, label: string, def: boolean): EffectParamDef => ({ key, label, type: 'checkbox', default: def ? 1 : 0, min: 0, max: 1 });
const num = (p: Record<string, EffectParamValue>, k: string) => Number(p[k]) || 0;

export const EFFECT_DEFS: EffectDef[] = [
  // Blur
  { id: 'gaussian-blur', name: 'Gaussian Blur', category: 'Blur', params: [n('blurriness', 'Blurriness', 10, 0, 500, 0.5, 'px'), { key: 'dims', label: 'Blur Dimensions', type: 'select', default: 'both', options: [{ value: 'both', label: 'Horizontal and Vertical' }, { value: 'h', label: 'Horizontal' }, { value: 'v', label: 'Vertical' }] }, b('repeat', 'Repeat Edge Pixels', false)],
    pad: (p) => (num(p, 'repeat') ? 0 : num(p, 'blurriness') * 2) },
  { id: 'directional-blur', name: 'Directional Blur', category: 'Blur', params: [a('direction', 'Direction', 0), n('length', 'Blur Length', 20, 0, 1000, 1, 'px')], pad: (p) => num(p, 'length') },
  { id: 'motion-blur', name: 'Motion Blur', category: 'Blur', params: [n('amount', 'Shutter', 100, 0, 400, 1, '%'), n('samples', 'Samples', 24, 4, 64)], pad: () => 200 },
  { id: 'radial-blur', name: 'Radial Blur', category: 'Blur', params: [n('amount', 'Amount', 20, 0, 100, 1, '%'), { key: 'mode', label: 'Type', type: 'select', default: 'zoom', options: [{ value: 'zoom', label: 'Zoom' }, { value: 'spin', label: 'Spin' }] }, { key: 'center', label: 'Center', type: 'point', default: [50, 50] }] },
  // Color correction
  { id: 'brightness-contrast', name: 'Brightness & Contrast', category: 'Color Correction', params: [n('brightness', 'Brightness', 0, -150, 150), n('contrast', 'Contrast', 0, -100, 100)] },
  { id: 'brightness', name: 'Brightness', category: 'Color Correction', params: [n('brightness', 'Brightness', 20, -150, 150)] },
  { id: 'contrast', name: 'Contrast', category: 'Color Correction', params: [n('contrast', 'Contrast', 20, -100, 100)] },
  { id: 'hue-saturation', name: 'Hue/Saturation', category: 'Color Correction', params: [a('hue', 'Master Hue', 0), n('saturation', 'Master Saturation', 0, -100, 100), n('lightness', 'Master Lightness', 0, -100, 100), b('colorize', 'Colorize', false)] },
  { id: 'color-balance', name: 'Color Balance', category: 'Color Correction', params: [n('sr', 'Shadow Red', 0, -100, 100), n('sg', 'Shadow Green', 0, -100, 100), n('sb', 'Shadow Blue', 0, -100, 100), n('mr', 'Midtone Red', 0, -100, 100), n('mg', 'Midtone Green', 0, -100, 100), n('mb', 'Midtone Blue', 0, -100, 100), n('hr', 'Highlight Red', 0, -100, 100), n('hg', 'Highlight Green', 0, -100, 100), n('hb', 'Highlight Blue', 0, -100, 100)] },
  { id: 'exposure', name: 'Exposure', category: 'Color Correction', params: [n('exposure', 'Exposure', 0, -5, 5, 0.05), n('gamma', 'Gamma', 1, 0.1, 5, 0.05)] },
  { id: 'tint', name: 'Tint', category: 'Color Correction', params: [c('black', 'Map Black To', '#000000'), c('white', 'Map White To', '#ffffff'), n('amount', 'Amount to Tint', 100, 0, 100, 1, '%')] },
  { id: 'fill', name: 'Fill', category: 'Color Correction', params: [c('color', 'Color', '#ff3b30'), n('opacity', 'Opacity', 100, 0, 100, 1, '%')] },
  { id: 'invert', name: 'Invert', category: 'Color Correction', params: [n('blend', 'Blend With Original', 0, 0, 100, 1, '%')] },
  // Distortion
  { id: 'displacement', name: 'Displacement', category: 'Distortion', params: [{ key: 'type', label: 'Type', type: 'select', default: 'turbulent', options: [{ value: 'turbulent', label: 'Turbulent' }, { value: 'wave', label: 'Wave' }] }, n('amount', 'Amount', 20, 0, 400, 1, 'px'), n('size', 'Size', 120, 2, 2000, 1, 'px'), n('evolution', 'Evolution', 0, -100000, 100000, 1), b('animate', 'Evolve Over Time', true)],
    pad: (p) => num(p, 'amount'), timeDependent: (p) => !!num(p, 'animate') },
  { id: 'wave-warp', name: 'Wave Warp', category: 'Distortion', params: [n('height', 'Wave Height', 10, 0, 500, 1, 'px'), n('width', 'Wave Width', 40, 1, 2000, 1, 'px'), a('direction', 'Direction', 90), n('speed', 'Wave Speed', 1, -20, 20, 0.1)], pad: (p) => num(p, 'height'), timeDependent: (p) => num(p, 'speed') !== 0 },
  { id: 'bulge', name: 'Bulge', category: 'Distortion', params: [n('radius', 'Radius', 30, 1, 100, 1, '%'), n('height', 'Bulge Height', 50, -100, 100, 1, '%'), { key: 'center', label: 'Center', type: 'point', default: [50, 50] }] },
  // Glow
  { id: 'glow', name: 'Glow', category: 'Glow', params: [n('threshold', 'Glow Threshold', 60, 0, 100, 1, '%'), n('radius', 'Glow Radius', 30, 0, 500, 1, 'px'), n('intensity', 'Glow Intensity', 100, 0, 400, 1, '%'), c('color', 'Glow Color', '#ffffff'), b('useColor', 'Use Glow Color', false)], pad: (p) => num(p, 'radius') * 2 },
  // Stylize
  { id: 'rgb-split', name: 'RGB Split', category: 'Stylize', params: [n('amount', 'Offset', 8, 0, 200, 0.5, 'px'), a('angle', 'Angle', 0)], pad: (p) => num(p, 'amount') },
  { id: 'chromatic-aberration', name: 'Chromatic Aberration', category: 'Stylize', params: [n('amount', 'Amount', 6, 0, 100, 0.5, 'px')] },
  { id: 'glitch', name: 'Glitch', category: 'Stylize', params: [n('amount', 'Amount', 50, 0, 100, 1, '%'), n('blocks', 'Block Size', 24, 2, 400, 1, 'px'), n('rgb', 'RGB Shift', 10, 0, 100, 1, 'px'), n('speed', 'Speed', 12, 0, 60, 1, '/s')], timeDependent: (p) => num(p, 'speed') > 0 && num(p, 'amount') > 0 },
  { id: 'pixelate', name: 'Pixelate', category: 'Stylize', params: [n('size', 'Cell Size', 16, 1, 400, 1, 'px')] },
  { id: 'vignette', name: 'Vignette', category: 'Stylize', params: [n('amount', 'Amount', 60, 0, 100, 1, '%'), n('size', 'Size', 60, 0, 150, 1, '%'), n('softness', 'Softness', 50, 1, 100, 1, '%'), c('color', 'Color', '#000000')] },
  { id: 'posterize', name: 'Posterize', category: 'Stylize', params: [n('levels', 'Level', 6, 2, 64)] },
  // Noise
  { id: 'noise', name: 'Noise', category: 'Noise', params: [n('amount', 'Amount of Noise', 20, 0, 100, 1, '%'), b('color', 'Use Color Noise', true), b('animate', 'Animate', true)], timeDependent: (p) => !!num(p, 'animate') },
  { id: 'film-grain', name: 'Film Grain', category: 'Noise', params: [n('intensity', 'Intensity', 35, 0, 100, 1, '%'), n('size', 'Grain Size', 1.5, 0.5, 8, 0.1, 'px'), b('animate', 'Animate', true)], timeDependent: (p) => !!num(p, 'animate') },
  // Sharpen
  { id: 'sharpen', name: 'Sharpen', category: 'Sharpen', params: [n('amount', 'Sharpen Amount', 40, 0, 500)] },
  // Transform
  { id: 'transform', name: 'Transform', category: 'Transform', params: [{ key: 'position', label: 'Position Offset', type: 'point', default: [0, 0] }, n('scale', 'Scale', 100, 0, 1000, 1, '%'), a('rotation', 'Rotation', 0), n('opacity', 'Opacity', 100, 0, 100, 1, '%')], pad: () => 0 },
  { id: 'flip', name: 'Flip', category: 'Transform', params: [b('h', 'Horizontal', true), b('v', 'Vertical', false)] },
  // Keying
  { id: 'chroma-key', name: 'Chroma Key (Green/Blue Screen)', category: 'Keying', params: [c('key', 'Key Color', '#00b140'), n('tolerance', 'Tolerance', 30, 0, 100, 0.5, '%'), n('softness', 'Edge Softness', 10, 0, 100, 0.5, '%'), n('spill', 'Spill Suppression', 60, 0, 100, 1, '%'), b('matte', 'View Matte', false)] },
  { id: 'luma-key', name: 'Luma Key', category: 'Keying', params: [n('threshold', 'Threshold', 20, 0, 100, 1, '%'), n('softness', 'Edge Softness', 10, 0, 100, 1, '%'), b('invert', 'Key Out Brighter', false)] },
  // Shadow
  { id: 'drop-shadow', name: 'Drop Shadow', category: 'Shadow', params: [c('color', 'Shadow Color', '#000000'), n('opacity', 'Opacity', 60, 0, 100, 1, '%'), a('direction', 'Direction', 135), n('distance', 'Distance', 12, 0, 1000, 1, 'px'), n('softness', 'Softness', 20, 0, 500, 1, 'px'), b('only', 'Shadow Only', false)],
    pad: (p) => num(p, 'distance') + num(p, 'softness') * 2 },
  { id: 'long-shadow', name: 'Long Shadow', category: 'Shadow', params: [c('color', 'Shadow Color', '#000000'), n('opacity', 'Opacity', 50, 0, 100, 1, '%'), a('direction', 'Direction', 135), n('length', 'Length', 120, 0, 2000, 1, 'px')], pad: (p) => num(p, 'length') },
];

export const effectDef = (id: string) => EFFECT_DEFS.find((d) => d.id === id);
