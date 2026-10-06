import { COMMANDS, matches, parseShortcut, run, type KeyCombo } from './commands';
import { getEngine } from '../canvas/engine';
import { useUI } from '../state/uiStore';
import { useTools, setTool, setOptions, type ToolId } from '../state/toolStore';
import { TOOL_GROUPS } from '../tools/registry';
import { isMac } from '../utils/id';
import { getDocState } from '../state/documentStore';
import { setLayerProps } from '../editor/layerActions';
import { findLayer } from '../layers/tree';

const parsed: { id: string; combos: KeyCombo[] }[] = [];
for (const c of COMMANDS.values()) if (c.shortcut) parsed.push({ id: c.id, combos: parseShortcut(c.shortcut) });

const lastInGroup = new Map<string, ToolId>();
useTools.subscribe((s, p) => {
  if (s.tool !== p.tool) { const g = TOOL_GROUPS.find((x) => x.tools.some((t) => t.id === s.tool)); if (g) lastInGroup.set(g.id, s.tool); }
});

export function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'range', 'button', 'color', 'submit'].includes(type);
  }
  return false;
}

let opacityTimer = 0; let opacityBuf = '';

function onKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented) return;
  const engine = getEngine();
  if (useUI.getState().dialog) return; // dialogs handle their own keys
  if (isEditable(e.target)) return; // never interfere with text entry
  if (e.code === 'Space') {
    if (engine && !engine.spaceHeld) { engine.spaceHeld = true; engine.updateCursor(); engine.invalidateView(); }
    e.preventDefault(); return;
  }
  if (e.key === 'Alt') { e.preventDefault(); return; }
  if (engine?.tool?.onKeyDown && engine.state) {
    try { if (engine.tool.onKeyDown(e, engine)) { e.preventDefault(); return; } } catch (err) { console.error(err); }
  }
  const mod = isMac ? e.metaKey : e.ctrlKey;
  // let the browser fire a real 'paste' event so we can read clipboard images
  if (mod && !e.shiftKey && !e.altKey && (e.key === 'v' || e.key === 'V' || e.code === 'KeyV')) return;
  // Tab toggles panels (like desktop editors)
  if (e.key === 'Tab' && !mod && !e.altKey) {
    e.preventDefault();
    useUI.setState((s) => ({ sidebarMode: s.sidebarMode === 'docked' ? 'rail' : 'docked', floatingGroup: null }));
    return;
  }
  for (const p of parsed) {
    if (p.combos.some((c) => matches(e, c))) {
      const cmd = COMMANDS.get(p.id)!;
      if (cmd.enabled && !cmd.enabled()) { if (mod) e.preventDefault(); continue; }
      e.preventDefault();
      run(p.id);
      return;
    }
  }
  if (mod || e.altKey) return;
  // number keys set opacity (brush tools: tool opacity; otherwise layer opacity)
  if (/^Digit\d$/.test(e.code) || /^Numpad\d$/.test(e.code)) {
    const d = e.code.slice(-1);
    opacityBuf += d; clearTimeout(opacityTimer);
    opacityTimer = window.setTimeout(() => { opacityBuf = ''; }, 500);
    const v = opacityBuf.length === 2 ? Number(opacityBuf) / 100 : d === '0' ? 1 : Number(d) / 10;
    const t = useTools.getState().tool;
    const key = t === 'brush' ? 'brush' : t === 'pencil' ? 'pencil' : t === 'eraser' ? 'eraser' : t === 'clone-stamp' ? 'clone' : t === 'paint-bucket' ? 'bucket' : t === 'gradient' ? 'gradient' : null;
    if (key) setOptions(key, { opacity: v } as never);
    else { const s = getDocState(); const l = s && findLayer(s.layers, s.activeLayerId); if (l) setLayerProps(l.id, { opacity: v }); }
    e.preventDefault(); return;
  }
  // tool keys
  const letter = e.key.length === 1 ? e.key.toUpperCase() : '';
  const group = TOOL_GROUPS.find((g) => g.key === letter);
  if (group) {
    e.preventDefault();
    const cur = useTools.getState().tool;
    const base = group.tools.some((t) => t.id === cur) ? cur : lastInGroup.get(group.id) ?? group.tools[0].id;
    if (e.shiftKey && group.tools.length > 1) {
      const i = group.tools.findIndex((t) => t.id === base);
      setTool(group.tools[(i + 1) % group.tools.length].id);
    } else setTool(base);
  }
}

function onKeyUp(e: KeyboardEvent) {
  const engine = getEngine();
  if (e.code === 'Space' && engine?.spaceHeld) { engine.spaceHeld = false; engine.updateCursor(); engine.invalidateView(); }
  if (engine?.tool?.onKeyUp && !isEditable(e.target)) engine.tool.onKeyUp(e, engine);
  engine?.updateCursor();
}

export function installKeyboard() {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => { const en = getEngine(); if (en?.spaceHeld) { en.spaceHeld = false; en.updateCursor(); } });
  return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
}
