// Which workspace is showing: the layered image editor (Design), the motion graphics editor (Motion)
// the multicam podcast editor (Podcast) or the live vision mixer (Mixer).
import { create } from './createStore';

export type Workspace = 'design' | 'motion' | 'podcast' | 'mixer' | 'library' | 'posts' | 'split';
const KEY = 'kurd-design-workspace';
const initial = (): Workspace => { try { const v = localStorage.getItem(KEY); return v === 'motion' || v === 'podcast' || v === 'mixer' || v === 'library' || v === 'posts' || v === 'split' ? v : 'design'; } catch { return 'design'; } };

const LAUNCH_KEY = 'kurd-design-launcher';
/** the start screen with the four sections is shown when the site opens (unless switched off) */
export const launcherOnStart = (): boolean => { try { return localStorage.getItem(LAUNCH_KEY) !== 'off'; } catch { return true; } };
export function setLauncherOnStart(on: boolean) { try { localStorage.setItem(LAUNCH_KEY, on ? 'on' : 'off'); } catch { /* storage blocked */ } }
export const useWorkspace = create<{ mode: Workspace; launcher: boolean }>(() => ({ mode: initial(), launcher: launcherOnStart() }));
export const openLauncher = () => useWorkspace.setState({ launcher: true });
export const isMotion = () => !useWorkspace.getState().launcher && useWorkspace.getState().mode === 'motion';
export const isPodcast = () => !useWorkspace.getState().launcher && useWorkspace.getState().mode === 'podcast';
export const isMixer = () => !useWorkspace.getState().launcher && useWorkspace.getState().mode === 'mixer';
export const isDesign = () => !useWorkspace.getState().launcher && useWorkspace.getState().mode === 'design';
export function setWorkspace(mode: Workspace) {
  useWorkspace.setState({ mode, launcher: false });
  try { localStorage.setItem(KEY, mode); } catch { /* storage blocked */ }
}
