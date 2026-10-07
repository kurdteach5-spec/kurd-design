// Which workspace is showing: the layered image editor (Design) or the motion graphics editor (Motion).
import { create } from './createStore';

export type Workspace = 'design' | 'motion';
const KEY = 'kurd-design-workspace';
const initial = (): Workspace => { try { return localStorage.getItem(KEY) === 'motion' ? 'motion' : 'design'; } catch { return 'design'; } };

export const useWorkspace = create<{ mode: Workspace }>(() => ({ mode: initial() }));
export const isMotion = () => useWorkspace.getState().mode === 'motion';
export function setWorkspace(mode: Workspace) {
  useWorkspace.setState({ mode });
  try { localStorage.setItem(KEY, mode); } catch { /* storage blocked */ }
}
