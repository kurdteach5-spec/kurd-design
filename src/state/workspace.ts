// Which workspace is showing: the layered image editor (Design), the motion graphics editor (Motion)
// the multicam podcast editor (Podcast) or the live vision mixer (Mixer).
import { create } from './createStore';

export type Workspace = 'design' | 'motion' | 'podcast' | 'mixer';
const KEY = 'kurd-design-workspace';
const initial = (): Workspace => { try { const v = localStorage.getItem(KEY); return v === 'motion' || v === 'podcast' || v === 'mixer' ? v : 'design'; } catch { return 'design'; } };

export const useWorkspace = create<{ mode: Workspace }>(() => ({ mode: initial() }));
export const isMotion = () => useWorkspace.getState().mode === 'motion';
export const isPodcast = () => useWorkspace.getState().mode === 'podcast';
export const isMixer = () => useWorkspace.getState().mode === 'mixer';
export const isDesign = () => useWorkspace.getState().mode === 'design';
export function setWorkspace(mode: Workspace) {
  useWorkspace.setState({ mode });
  try { localStorage.setItem(KEY, mode); } catch { /* storage blocked */ }
}
