// Names and colors of cameras, people and B-roll clips (shared by the UI and the exports).
import { usePod, speakerName, inputsOf, type PodState } from './store';
import { PALETTE, WIDE_COLOR, INSERT_COLOR, BROLL_COLOR, SPLIT_COLOR, VIRTUAL_COLOR, isVirtual, isStill } from './types';

type S = Pick<PodState, 'cameras' | 'speakers' | 'broll' | 'sources' | 'splits'>;

export function speakerColor(id: string, s: S = usePod.getState()) {
  const i = s.speakers.findIndex((x) => x.id === id);
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
}

/** color of a camera / B-roll clip on the timeline */
export function camColor(id: string, s: S = usePod.getState()) {
  if (isVirtual(id)) return VIRTUAL_COLOR;
  if (s.broll.includes(id)) return BROLL_COLOR;
  if (s.splits.some((x) => x.id === id)) return SPLIT_COLOR;
  const c = s.cameras.find((x) => x.id === id);
  if (!c) return '#666';
  if (c.role === 'wide') return WIDE_COLOR;
  if (c.role === 'insert') return INSERT_COLOR;
  return speakerColor(c.speaker ?? '', s);
}

/** keyboard number of an input (1…9): cameras, then split screens, then B-roll */
export const camKey = (id: string, s: S = usePod.getState()) => { const i = inputsOf(s).indexOf(id); return i >= 0 && i < 9 ? String(i + 1) : ''; };

/**
 * Parts of a camera's name: a role word that the UI translates ("Wide", "Insert", "B-roll", or the default
 * "Speaker n") and a part that is user content (a typed name, a file name), plus an angle number.
 */
export function camParts(id: string, s: S = usePod.getState()): { role: string; user: string; n: string } {
  if (isStill(id)) { const st = usePod.getState(); return { role: 'Picture', user: st.media.find((m) => m.id === id)?.name ?? '', n: '' }; }
  if (isVirtual(id)) return { role: ({ mp1: 'Media Player 1', mp2: 'Media Player 2', col1: 'Color 1', col2: 'Color 2', bars: 'Color Bars', blk: 'Black' } as Record<string, string>)[id], user: '', n: '' };
  if (s.broll.includes(id)) return { role: 'B-roll', user: s.sources[id]?.name ?? '', n: '' };
  const sp = s.splits.findIndex((x) => x.id === id);
  if (sp >= 0) return { role: 'SuperSource', user: s.splits[sp].name.trim(), n: s.splits.length > 1 && !s.splits[sp].name.trim() ? String(sp + 1) : '' };
  const c = s.cameras.find((x) => x.id === id);
  if (!c) return { role: '?', user: '', n: '' };
  if (c.role === 'wide' || c.role === 'insert') {
    const same = s.cameras.filter((x) => x.role === c.role);
    return { role: c.role === 'wide' ? 'Wide' : 'Insert', user: '', n: same.length > 1 ? String(same.indexOf(c) + 1) : '' };
  }
  const person = s.speakers.find((x) => x.id === c.speaker);
  const same = s.cameras.filter((x) => x.role === 'speaker' && x.speaker === c.speaker);
  const n = same.length > 1 ? String(same.indexOf(c) + 1) : '';
  const i = s.speakers.findIndex((x) => x.id === c.speaker);
  return person?.name.trim() ? { role: '', user: person.name.trim(), n } : { role: `Speaker ${i + 1}`, user: '', n };
}

/** plain-text name for exports (English role words) */
export function camName(id: string, s: S = usePod.getState()) {
  const p = camParts(id, s);
  if (p.role === 'B-roll' || p.role === 'Picture') return `${p.role} (${p.user})`;
  return [p.role, p.user].filter(Boolean).join(' ') + (p.n ? ` · angle ${p.n}` : '');
}
export { speakerName };

/** switcher button name (4–5 characters, like a hardware panel): typed name, or CAM1 / SS1 / BR1 / MP1 / COL1 / BARS / BLK */
export function shortName(id: string, s: S & Pick<PodState, 'labels'> = usePod.getState()): string {
  const typed = s.labels[id]?.trim(); if (typed) return typed.slice(0, 6);
  const v: Record<string, string> = { mp1: 'MP1', mp2: 'MP2', col1: 'COL1', col2: 'COL2', bars: 'BARS', blk: 'BLK' };
  if (v[id]) return v[id];
  const ci = s.cameras.findIndex((c) => c.id === id); if (ci >= 0) return `CAM${ci + 1}`;
  const si = s.splits.findIndex((x) => x.id === id); if (si >= 0) return `SS${si + 1}`;
  const bi = s.broll.indexOf(id); if (bi >= 0) return `BR${bi + 1}`;
  const pi = usePod.getState().stills.indexOf(id); if (pi >= 0) return `IMG${pi + 1}`;
  return '?';
}
/** multiview / tooltip name */
export function longName(id: string, s: S & Pick<PodState, 'labels'> = usePod.getState()): string {
  const typed = s.labels[id]?.trim(); if (typed) return typed;
  const v: Record<string, string> = { mp1: 'Media Player 1', mp2: 'Media Player 2', col1: 'Color 1', col2: 'Color 2', bars: 'Color Bars', blk: 'Black' };
  if (v[id]) return v[id];
  if (s.splits.some((x) => x.id === id)) return `SuperSource ${s.splits.findIndex((x) => x.id === id) + 1}`;
  return camName(id, s);
}
