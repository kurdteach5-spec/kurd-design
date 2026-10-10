// Keyboard shortcuts of the Podcast and Mixer workspaces: one list of actions, each with default keys
// that the user can change (kept in the browser). Keys are read from the physical key (KeyA, Digit1…),
// so they work the same with a Kurdish, Arabic or English keyboard layout.
import { create } from '../../state/createStore';
import { usePod, inputsOf, segmentAt, cutTo, setShotCam, splitAt, deleteShot, undo, redo, setInOut } from '../store';
import { performTransition, programCut, setPreview, keySet, activeOverlay, dskAuto, ftb, removeOverlay, ssOn, activeSS, ssLayout, previewOf } from '../mixer';
import { togglePlay, play, pause, step, seek } from '../player';
import { startRender } from '../renderJob';
import { editTips, applyTip } from '../advisor';
import { isMixer, isPodcast } from '../../state/workspace';
import { isEditable } from '../../shortcuts/keyboard';
import { useMixerUI } from './mixer/mixerUI';
import type { TransStyle } from '../types';

export type Scope = 'mixer' | 'podcast';
export interface Action { id: string; label: string; group: string; scopes: Scope[]; keys: string[]; run: () => void }

const S = () => usePod.getState();
const setT = (style: TransStyle) => usePod.setState((s) => ({ trans: { ...s.trans, style } }));
const nextTip = (apply: boolean) => {
  const s = S(); const tips = editTips(s); if (!tips.length) return;
  const sel = tips.find((x) => `tip:${x.key}` === s.selected);
  if (apply && sel) { applyTip(sel); usePod.setState({ selected: null }); return; }
  const n = tips.find((x) => x.t > s.time + 0.05) ?? tips[0];
  usePod.setState({ selected: `tip:${n.key}` }); if (s.playing) pause(); seek(n.t);
};
const delSelected = () => {
  const s = S(); if (!s.selected) return;
  if (s.overlays.some((o) => o.id === s.selected)) removeOverlay(s.selected); else deleteShot(s.selected);
  usePod.setState({ selected: null });
};
const jumpCut = (dir: 1 | -1) => {
  const s = S(); const cuts = s.segments.map((x) => x.start);
  const t = dir < 0 ? [...cuts].reverse().find((c) => c < s.time - 0.01) : cuts.find((c) => c > s.time + 0.01);
  if (t !== undefined) { if (s.playing) pause(); seek(t); }
};
/** Podcast: a camera number changes the current shot (paused) or cuts live (playing) */
const podCam = (i: number) => { const s = S(); const cam = inputsOf(s)[i]; if (!cam) return; if (s.playing) cutTo(cam); else { const id = s.selected ?? segmentAt(s.time)?.id; if (id) setShotCam(id, cam); } };
/** Mixer: input buttons (hardware panel: switch; software panel: preview) */
const mixInput = (i: number) => { const id = inputsOf(S())[i]; if (id) setPreview(id); };

const BOTH: Scope[] = ['mixer', 'podcast'];
const M: Scope[] = ['mixer'];
const P: Scope[] = ['podcast'];

export const ACTIONS: Action[] = [
  // switching
  ...Array.from({ length: 10 }, (_, i): Action => ({ id: `mixInput${i + 1}`, label: `Input ${i + 1} to preview`, group: 'Switching', scopes: M, keys: [String((i + 1) % 10)], run: () => mixInput(i) })),
  ...Array.from({ length: 9 }, (_, i): Action => ({ id: `program${i + 1}`, label: `Input ${i + 1} straight to program`, group: 'Switching', scopes: M, keys: [`Shift+${i + 1}`], run: () => { const id = inputsOf(S())[i]; if (id) programCut(id); } })),
  { id: 'cut', label: 'CUT: preview to program', group: 'Switching', scopes: M, keys: ['Space'], run: () => performTransition(false) },
  { id: 'auto', label: 'AUTO: preview to program with the effect', group: 'Switching', scopes: M, keys: ['Enter'], run: () => performTransition(true) },
  { id: 'swapPvw', label: 'Next input to preview', group: 'Switching', scopes: M, keys: ['Tab'], run: () => { const s = S(); const rec = inputsOf(s); const pv = previewOf(s); const i = pv ? rec.indexOf(pv) : -1; if (rec.length) setPreview(rec[(i + 1) % rec.length]); } },
  { id: 'ftb', label: 'Fade to black', group: 'Switching', scopes: M, keys: ['F'], run: ftb },
  // effects
  { id: 'mix', label: 'Effect: MIX', group: 'Effects', scopes: M, keys: ['M'], run: () => setT('mix') },
  { id: 'dip', label: 'Effect: DIP', group: 'Effects', scopes: M, keys: ['Shift+M'], run: () => setT('dip') },
  { id: 'wipe', label: 'Effect: WIPE', group: 'Effects', scopes: M, keys: ['W'], run: () => setT('wipe') },
  { id: 'dve', label: 'Effect: DVE push', group: 'Effects', scopes: M, keys: ['V'], run: () => setT('dve') },
  { id: 'durUp', label: 'Longer transition', group: 'Effects', scopes: M, keys: [']'], run: () => usePod.setState((s) => ({ trans: { ...s.trans, dur: Math.min(5, Math.round((s.trans.dur + 0.25) * 4) / 4) } })) },
  { id: 'durDown', label: 'Shorter transition', group: 'Effects', scopes: M, keys: ['['], run: () => usePod.setState((s) => ({ trans: { ...s.trans, dur: Math.max(0.25, Math.round((s.trans.dur - 0.25) * 4) / 4) } })) },
  // split screen, picture in picture, logo
  { id: 'ssOn', label: 'SuperSource on program', group: 'SuperSource & keys', scopes: M, keys: ['S'], run: ssOn },
  { id: 'ssEdit', label: 'SuperSource editor', group: 'SuperSource & keys', scopes: M, keys: ['E'], run: () => { if (!activeSS()) ssLayout('side2'); usePod.setState((s) => ({ videoOut: s.videoOut === 'ss' ? 'mv' : 'ss' })); } },
  { id: 'ssSide', label: 'SuperSource: side by side', group: 'SuperSource & keys', scopes: M, keys: ['Shift+S'], run: () => { ssLayout('side2'); } },
  { id: 'ssGrid', label: 'SuperSource: grid 2×2', group: 'SuperSource & keys', scopes: M, keys: ['Shift+G'], run: () => { ssLayout('grid4'); } },
  { id: 'pip', label: 'Picture in picture on / off', group: 'SuperSource & keys', scopes: M, keys: ['P'], run: () => keySet(!activeOverlay('usk', 1), true) },
  { id: 'dsk1', label: 'Logo / DSK 1 on / off', group: 'SuperSource & keys', scopes: M, keys: ['D'], run: () => dskAuto(0) },
  { id: 'dsk2', label: 'Logo / DSK 2 on / off', group: 'SuperSource & keys', scopes: M, keys: ['Shift+D'], run: () => dskAuto(1) },
  // monitors and layout
  { id: 'voutMv', label: 'Show the multiview', group: 'View', scopes: M, keys: ['F1'], run: () => usePod.setState({ videoOut: 'mv' }) },
  { id: 'voutPgm', label: 'Show the program', group: 'View', scopes: M, keys: ['F2'], run: () => usePod.setState({ videoOut: 'pgm' }) },
  { id: 'panel', label: 'Hardware ↔ software panel', group: 'View', scopes: M, keys: ['H'], run: () => useMixerUI.setState((u) => ({ panel: u.panel === 'mini' ? 'software' : 'mini' })) },
  { id: 'timeline', label: 'Show / hide the timeline', group: 'View', scopes: M, keys: ['T'], run: () => useMixerUI.setState((u) => ({ timeline: !u.timeline })) },
  // podcast: cameras
  ...Array.from({ length: 9 }, (_, i): Action => ({ id: `podCam${i + 1}`, label: `Camera ${i + 1}: for this shot (paused) / cut now (playing)`, group: 'Cameras', scopes: P, keys: [String(i + 1)], run: () => podCam(i) })),
  // playback (both)
  { id: 'playPause', label: 'Play / pause', group: 'Playback', scopes: P, keys: ['Space'], run: togglePlay },
  { id: 'rec', label: 'REC: play and record the switching', group: 'Playback', scopes: M, keys: ['R'], run: () => { if (S().segments.length) play(); } },
  { id: 'play', label: 'Play', group: 'Playback', scopes: BOTH, keys: ['L'], run: play },
  { id: 'pause', label: 'Stop / pause', group: 'Playback', scopes: BOTH, keys: ['K'], run: pause },
  { id: 'frameBack', label: 'One frame back', group: 'Playback', scopes: BOTH, keys: ['ArrowLeft'], run: () => step(-1) },
  { id: 'frameFwd', label: 'One frame forward', group: 'Playback', scopes: BOTH, keys: ['ArrowRight'], run: () => step(1) },
  { id: 'secBack', label: 'One second back', group: 'Playback', scopes: BOTH, keys: ['Shift+ArrowLeft'], run: () => seek(S().time - 1) },
  { id: 'secFwd', label: 'One second forward', group: 'Playback', scopes: BOTH, keys: ['Shift+ArrowRight'], run: () => seek(S().time + 1) },
  { id: 'prevCut', label: 'Previous cut', group: 'Playback', scopes: BOTH, keys: ['ArrowUp'], run: () => jumpCut(-1) },
  { id: 'nextCut', label: 'Next cut', group: 'Playback', scopes: BOTH, keys: ['ArrowDown'], run: () => jumpCut(1) },
  { id: 'home', label: 'Go to the start', group: 'Playback', scopes: BOTH, keys: ['Home'], run: () => seek(S().analysis?.start ?? 0) },
  { id: 'end', label: 'Go to the end', group: 'Playback', scopes: BOTH, keys: ['End'], run: () => seek(S().analysis?.end ?? 0) },
  // editing
  { id: 'undo', label: 'Undo', group: 'Edit', scopes: BOTH, keys: ['Mod+Z'], run: undo },
  { id: 'redo', label: 'Redo', group: 'Edit', scopes: BOTH, keys: ['Mod+Shift+Z', 'Mod+Y'], run: redo },
  { id: 'split', label: 'Split the shot here', group: 'Edit', scopes: P, keys: ['S'], run: () => splitAt() },
  { id: 'splitMix', label: 'Split the shot here', group: 'Edit', scopes: M, keys: ['B'], run: () => splitAt() },
  { id: 'delete', label: 'Remove the selected shot / key', group: 'Edit', scopes: BOTH, keys: ['Delete', 'Backspace'], run: delSelected },
  { id: 'in', label: 'Export range: in', group: 'Edit', scopes: BOTH, keys: ['I'], run: () => setInOut('in') },
  { id: 'out', label: 'Export range: out', group: 'Edit', scopes: BOTH, keys: ['O'], run: () => setInOut('out') },
  { id: 'clearRange', label: 'Clear the export range', group: 'Edit', scopes: BOTH, keys: ['Alt+X'], run: () => setInOut('clear') },
  { id: 'nextTip', label: 'Next editing tip', group: 'Edit', scopes: BOTH, keys: ['N'], run: () => nextTip(false) },
  { id: 'applyTip', label: 'Apply the selected tip', group: 'Edit', scopes: BOTH, keys: ['Shift+N'], run: () => nextTip(true) },
  { id: 'escape', label: 'Deselect / close', group: 'Edit', scopes: BOTH, keys: ['Escape'], run: () => { usePod.setState({ selected: null }); useMixerUI.setState({ drawer: false }); } },
  // output
  { id: 'render', label: 'Render the video', group: 'Output', scopes: BOTH, keys: ['Mod+Shift+E'], run: () => void startRender() },
  { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'Output', scopes: BOTH, keys: ['Shift+/'], run: () => useShortcutsDialog.setState({ open: true }) },
];

// ---------- user keys ----------
const STORE = 'kurd-shortcuts';
const loadUser = (): Record<string, string[]> => { try { return JSON.parse(localStorage.getItem(STORE) || '{}') as Record<string, string[]>; } catch { return {}; } };
export const useShortcuts = create<{ user: Record<string, string[]> }>(() => ({ user: loadUser() }));
useShortcuts.subscribe((s) => { try { localStorage.setItem(STORE, JSON.stringify(s.user)); } catch { /* storage blocked */ } });
export const useShortcutsDialog = create<{ open: boolean }>(() => ({ open: false }));

export const keysOf = (a: Action) => useShortcuts.getState().user[a.id] ?? a.keys;
export function setKeys(id: string, keys: string[] | null) {
  useShortcuts.setState((s) => { const user = { ...s.user }; if (keys === null) delete user[id]; else user[id] = keys; return { user }; });
}
export const resetAll = () => useShortcuts.setState({ user: {} });

/** "Mod+Shift+Z" from a key event — the physical key, so any keyboard layout works */
export function comboOf(e: KeyboardEvent): string | null {
  const c = e.code;
  let k: string;
  if (/^Key[A-Z]$/.test(c)) k = c.slice(3);
  else if (/^(Digit|Numpad)[0-9]$/.test(c)) k = c.slice(-1);
  else if (c === 'Space') k = 'Space';
  else if (c === 'BracketLeft') k = '['; else if (c === 'BracketRight') k = ']';
  else if (c === 'Slash') k = '/'; else if (c === 'Minus') k = '-'; else if (c === 'Equal') k = '=';
  else if (c === 'Comma') k = ','; else if (c === 'Period') k = '.'; else if (c === 'Semicolon') k = ';'; else if (c === 'Quote') k = "'"; else if (c === 'Backquote') k = '`';
  else k = e.key;
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(k)) return null;
  const mods = [(e.ctrlKey || e.metaKey) && 'Mod', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
  return [...mods, k].join('+');
}
/** how a key looks on screen */
export function keyLabel(k: string): string {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return k.replace('Mod', mac ? '⌘' : 'Ctrl').replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('Space', 'Space').replace(/\+/g, ' + ');
}

let installed = false;
export function installShortcuts() {
  if (installed) return; installed = true;
  window.addEventListener('keydown', (e) => {
    const scope: Scope | null = isMixer() ? 'mixer' : isPodcast() ? 'podcast' : null;
    if (!scope || e.defaultPrevented || isEditable(e.target) || document.querySelector('[role="dialog"]') || useShortcutsDialog.getState().open) return;
    const combo = comboOf(e); if (!combo) return;
    const a = ACTIONS.find((x) => x.scopes.includes(scope) && keysOf(x).includes(combo));
    if (!a) return;
    e.preventDefault();
    a.run();
  });
}
