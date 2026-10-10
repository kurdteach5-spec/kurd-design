// Layout of the Mixer workspace (remembered in the browser).
import { create } from '../../../state/createStore';

export interface MixerUI { panel: 'mini' | 'software'; drawer: boolean; timeline: boolean; side: number; panelH: number; tlH: number }
export const LAYOUT_KEY = 'kurd-mixer-layout-2';
const savedLayout = (): Partial<MixerUI> => { try { return JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') as Partial<MixerUI>; } catch { return {}; } };
const vh = typeof window === 'undefined' ? 900 : window.innerHeight;
export const useMixerUI = create<MixerUI>(() => ({ panel: 'mini', drawer: false, timeline: true, side: 320, panelH: Math.round(vh * (typeof window !== 'undefined' && window.innerWidth < 760 ? 0.45 : 0.3)), tlH: Math.max(150, Math.round(vh * 0.2)), ...savedLayout() }));
useMixerUI.subscribe((s, p) => { if (s.side !== p.side || s.panelH !== p.panelH || s.tlH !== p.tlH || s.panel !== p.panel || s.timeline !== p.timeline) { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ side: s.side, panelH: s.panelH, tlH: s.tlH, panel: s.panel, timeline: s.timeline })); } catch { /* storage blocked */ } } });

