export interface FilterParam {
  key: string; label: string;
  type: 'range' | 'select' | 'checkbox';
  min?: number; max?: number; step?: number; unit?: string;
  options?: { value: string; label: string }[];
  default: number | string | boolean;
}
export interface FilterDef { id: string; name: string; group: string; params: FilterParam[]; instant?: boolean }

const r = (key: string, label: string, min: number, max: number, def: number, unit = '', step = 1): FilterParam => ({ key, label, type: 'range', min, max, default: def, unit, step });

export const FILTERS: FilterDef[] = [
  { id: 'gaussian-blur', name: 'Gaussian Blur', group: 'Blur', params: [r('radius', 'Radius', 0.5, 250, 4, 'px', 0.5)] },
  { id: 'box-blur', name: 'Box Blur', group: 'Blur', params: [r('radius', 'Radius', 1, 200, 3, 'px')] },
  { id: 'motion-blur', name: 'Motion Blur', group: 'Blur', params: [r('angle', 'Angle', -180, 180, 0, '°'), r('distance', 'Distance', 1, 500, 20, 'px')] },
  { id: 'radial-blur', name: 'Radial Blur', group: 'Blur', params: [
    r('amount', 'Amount', 1, 100, 15), { key: 'mode', label: 'Method', type: 'select', default: 'spin', options: [{ value: 'spin', label: 'Spin' }, { value: 'zoom', label: 'Zoom' }] },
    r('centerX', 'Center X', 0, 100, 50, '%'), r('centerY', 'Center Y', 0, 100, 50, '%'),
  ] },
  { id: 'sharpen', name: 'Sharpen', group: 'Sharpen', params: [r('amount', 'Amount', 1, 300, 50, '%')] },
  { id: 'unsharp-mask', name: 'Unsharp Mask', group: 'Sharpen', params: [r('amount', 'Amount', 1, 500, 100, '%'), r('radius', 'Radius', 0.5, 100, 2, 'px', 0.5), r('threshold', 'Threshold', 0, 255, 0, 'levels')] },
  { id: 'add-noise', name: 'Add Noise', group: 'Noise', params: [
    r('amount', 'Amount', 0, 100, 10, '%'),
    { key: 'distribution', label: 'Distribution', type: 'select', default: 'gaussian', options: [{ value: 'uniform', label: 'Uniform' }, { value: 'gaussian', label: 'Gaussian' }] },
    { key: 'monochromatic', label: 'Monochromatic', type: 'checkbox', default: false },
  ] },
  { id: 'median', name: 'Reduce Noise (Median)', group: 'Noise', params: [r('radius', 'Radius', 1, 10, 1, 'px')] },
  { id: 'pixelate', name: 'Pixelate (Mosaic)', group: 'Pixelate', params: [r('cellSize', 'Cell Size', 2, 200, 12, 'px')] },
  { id: 'emboss', name: 'Emboss', group: 'Stylize', params: [r('angle', 'Angle', -180, 180, 135, '°'), r('height', 'Height', 1, 20, 3, 'px'), r('amount', 'Amount', 1, 500, 100, '%')] },
  { id: 'find-edges', name: 'Find Edges', group: 'Stylize', params: [] },
  { id: 'glow', name: 'Glow (Bloom)', group: 'Stylize', params: [r('radius', 'Radius', 1, 200, 20, 'px'), r('intensity', 'Intensity', 0, 200, 80, '%'), r('threshold', 'Threshold', 0, 254, 160)] },
  { id: 'twirl', name: 'Twirl', group: 'Distort', params: [r('angle', 'Angle', -999, 999, 120, '°')] },
  { id: 'wave', name: 'Wave', group: 'Distort', params: [r('amplitude', 'Amplitude', 0, 200, 10, 'px'), r('wavelength', 'Wavelength', 2, 1000, 80, 'px')] },
  { id: 'pinch', name: 'Pinch', group: 'Distort', params: [r('amount', 'Amount', -100, 100, 50, '%')] },
  { id: 'spherize', name: 'Spherize', group: 'Distort', params: [r('amount', 'Amount', -100, 100, 80, '%')] },
];

export const filterById = (id: string) => FILTERS.find((f) => f.id === id);
export const defaultParams = (f: FilterDef) => Object.fromEntries(f.params.map((p) => [p.key, p.default])) as Record<string, number | string | boolean>;
