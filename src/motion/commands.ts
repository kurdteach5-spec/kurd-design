// Motion workspace command registry: drives menus, keyboard shortcuts and tooltips.
import * as A from './actions';
import { useMotion, mundo, mredo, activeComp, compTime, setTime, type MotionTool } from './store';
import { togglePlay, stop, pause } from './media/playback';
import { openMotionDialog, useMotionUI } from './uiState';
import { newProject, openProjectFile, saveProjectFile, restoreLast } from './project';
import { EFFECT_CATEGORIES, EFFECT_DEFS } from './render/effectDefs';
import { applyPreset } from './presets';
import { cloneLayer } from './factory';
import { mcommit, updateComp } from './store';
import { isEditable } from '../shortcuts/keyboard';
import { isMac } from '../utils/id';
import { toast } from '../state/uiStore';
import { isMotion, setWorkspace } from '../state/workspace';
import type { MLayer } from './types';

export interface MCommand { id: string; label: string; shortcut?: string; run: () => void; enabled?: () => boolean; checked?: () => boolean }

const hasComp = () => !!activeComp();
const hasSel = () => !!activeComp() && useMotion.getState().selectedLayers.length > 0;
const hasKeys = () => useMotion.getState().selectedKeys.length > 0;
const sel = () => A.selectedLayerObjs();

function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((res) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = multiple;
    i.onchange = () => res([...(i.files ?? [])]); i.click();
  });
}
export const importDialog = async () => { const f = await pickFiles('video/*,audio/*,image/*,.mov,.mkv,.m4a,.flac'); if (f.length) await A.importFiles(f); };
export const openProjectDialog = async () => { const f = await pickFiles('.kdmotion,.zip', false); if (f[0]) await openProjectFile(f[0]); };

let layerClipboard: MLayer[] | null = null;
function copy() {
  if (A.copySelectedKeys()) return;
  const l = sel(); if (!l.length) return;
  layerClipboard = l.map((x) => JSON.parse(JSON.stringify(x)));
  toast(`${l.length} ${l.length === 1 ? 'layer' : 'layers'} copied`, 'success', 1600);
}
function paste() {
  const c = activeComp(); if (!c) return;
  if (useMotion.getState().selectedKeys.length || !layerClipboard) { if (A.pasteKeys()) return; }
  if (!layerClipboard) return;
  const copies = layerClipboard.map((l) => cloneLayer(l, l.name));
  mcommit(updateComp(c.id, (cc) => ({ ...cc, layers: [...copies, ...cc.layers] })), 'Paste Layers');
  useMotion.setState({ selectedLayers: copies.map((l) => l.id), selectedKeys: [] });
}
function reveal(group: 'transform' | 'animated') {
  const c = activeComp(); const s = useMotion.getState(); if (!c) return;
  const ids = s.selectedLayers.length ? s.selectedLayers : c.layers.map((l) => l.id);
  const expanded = { ...s.timeline.expanded };
  for (const id of ids) {
    expanded[id] = true;
    if (group === 'transform') expanded[`${id}:transform`] = true;
    else for (const g of ['transform', 'text', 'contents', 'masks', 'effects', 'audio', 'camera']) expanded[`${id}:${g}`] = true;
  }
  useMotion.setState({ timeline: { ...s.timeline, expanded } });
}
const tool = (t: MotionTool) => () => useMotion.setState({ tool: t });

export const MCOMMANDS = new Map<string, MCommand>();
const add = (c: MCommand) => MCOMMANDS.set(c.id, c);
[
  // file
  { id: 'm.newProject', label: 'New Project', run: () => { if (useMotion.getState().version !== useMotion.getState().savedVersion && !confirm('Start a new project? Unsaved changes in this project will be lost (the last session stays in browser storage).')) return; newProject(); } },
  { id: 'm.open', label: 'Open Project…', shortcut: 'Mod+O', run: () => void openProjectDialog() },
  { id: 'm.restore', label: 'Restore Last Session', run: () => void restoreLast() },
  { id: 'm.save', label: 'Save Project', shortcut: 'Mod+S', run: () => void saveProjectFile() },
  { id: 'm.import', label: 'Import File…', shortcut: 'Mod+I', run: () => void importDialog() },
  { id: 'm.render', label: 'Render / Export…', shortcut: 'Mod+M', run: () => useMotionUI.setState({ rightTab: 'render' }), enabled: hasComp },
  { id: 'm.design', label: 'Switch to Design', run: () => { pause(); setWorkspace('design'); } },
  // edit
  { id: 'm.undo', label: 'Undo', shortcut: 'Mod+Z', run: mundo, enabled: () => useMotion.getState().past.length > 0 },
  { id: 'm.redo', label: 'Redo', shortcut: 'Mod+Shift+Z', run: mredo, enabled: () => useMotion.getState().future.length > 0 },
  { id: 'm.copy', label: 'Copy', shortcut: 'Mod+C', run: copy, enabled: () => hasSel() || hasKeys() },
  { id: 'm.paste', label: 'Paste', shortcut: 'Mod+V', run: paste, enabled: hasComp },
  { id: 'm.duplicate', label: 'Duplicate', shortcut: 'Mod+D', run: () => (hasKeys() ? A.duplicateSelectedKeys() : A.duplicateLayers()), enabled: () => hasSel() || hasKeys() },
  { id: 'm.split', label: 'Split Layer', shortcut: 'Mod+Shift+D', run: () => A.splitLayers(), enabled: hasSel },
  { id: 'm.delete', label: 'Delete', shortcut: 'Delete|Backspace', run: () => { if (!A.deleteSelectedKeys()) A.deleteLayers(); }, enabled: () => hasSel() || hasKeys() },
  { id: 'm.selectAll', label: 'Select All Layers', shortcut: 'Mod+A', run: () => { const c = activeComp(); if (c) A.selectLayers(c.layers.map((l) => l.id)); }, enabled: hasComp },
  { id: 'm.deselect', label: 'Deselect All', shortcut: 'Mod+Shift+A', run: () => useMotion.setState({ selectedLayers: [], selectedKeys: [] }) },
  // composition
  { id: 'm.newComp', label: 'New Composition…', shortcut: 'Mod+N', run: () => openMotionDialog({ type: 'comp-settings', compId: null }) },
  { id: 'm.compSettings', label: 'Composition Settings…', shortcut: 'Mod+K', run: () => { const c = activeComp(); if (c) openMotionDialog({ type: 'comp-settings', compId: c.id }); }, enabled: hasComp },
  { id: 'm.precompose', label: 'Pre-compose…', shortcut: 'Mod+Shift+C', run: () => A.precompose(), enabled: hasSel },
  { id: 'm.workIn', label: 'Set Work Area Start', shortcut: 'B', run: () => A.setWorkArea(compTime(), null), enabled: hasComp },
  { id: 'm.workOut', label: 'Set Work Area End', shortcut: 'N', run: () => A.setWorkArea(null, compTime() + 1 / (activeComp()?.fps ?? 30)), enabled: hasComp },
  { id: 'm.trimComp', label: 'Trim Comp to Work Area', run: () => { const c = activeComp(); if (c) A.updateCompSettings(c.id, { duration: c.workEnd - c.workStart }); }, enabled: hasComp },
  { id: 'm.marker', label: 'Add Marker', shortcut: '*|Shift+8', run: () => A.addMarker(), enabled: hasComp },
  { id: 'm.motionBlur', label: 'Enable Motion Blur', run: () => { const c = activeComp(); if (c) A.updateCompSettings(c.id, { motionBlur: !c.motionBlur }); }, enabled: hasComp, checked: () => !!activeComp()?.motionBlur },
  // layer
  { id: 'm.newSolid', label: 'Solid', shortcut: 'Mod+Y', run: () => A.addSolid(), enabled: hasComp },
  { id: 'm.newText', label: 'Text', shortcut: 'Mod+Alt+Shift+T', run: () => { A.addText(); }, enabled: hasComp },
  { id: 'm.newRect', label: 'Rectangle', run: () => A.addShape('rect'), enabled: hasComp },
  { id: 'm.newRounded', label: 'Rounded Rectangle', run: () => { const id = A.addShape('rect'); if (id) A.setPropValue(id, 'shape.roundness', 40); }, enabled: hasComp },
  { id: 'm.newEllipse', label: 'Ellipse', run: () => A.addShape('ellipse'), enabled: hasComp },
  { id: 'm.newPolygon', label: 'Polygon', run: () => A.addShape('polygon'), enabled: hasComp },
  { id: 'm.newStar', label: 'Star', run: () => A.addShape('star'), enabled: hasComp },
  { id: 'm.newLine', label: 'Line', run: () => A.addShape('line'), enabled: hasComp },
  { id: 'm.newArrow', label: 'Arrow', run: () => A.addShape('arrow'), enabled: hasComp },
  { id: 'm.newNull', label: 'Null Object', shortcut: 'Mod+Alt+Shift+Y', run: A.addNull, enabled: hasComp },
  { id: 'm.newAdjustment', label: 'Adjustment Layer', shortcut: 'Mod+Alt+Y', run: A.addAdjustment, enabled: hasComp },
  { id: 'm.newCamera3d', label: 'Camera (3D)', shortcut: 'Mod+Alt+Shift+C', run: () => A.addCamera('3d'), enabled: hasComp },
  { id: 'm.newCamera2d', label: 'Camera (2D)', run: () => A.addCamera('2d'), enabled: hasComp },
  { id: 'm.maskRect', label: 'New Rectangle Mask', run: () => { for (const l of sel()) { const c = activeComp()!; A.addMaskShape(l.id, 'rect', boundsFor(l, c)); } }, enabled: hasSel },
  { id: 'm.maskEllipse', label: 'New Ellipse Mask', run: () => { for (const l of sel()) { const c = activeComp()!; A.addMaskShape(l.id, 'ellipse', boundsFor(l, c)); } }, enabled: hasSel },
  { id: 'm.3d', label: '3D Layer', run: () => A.setLayers(useMotion.getState().selectedLayers, (l) => ({ threeD: !l.threeD }), '3D Layer'), enabled: hasSel, checked: () => sel().some((l) => l.threeD) },
  { id: 'm.mb', label: 'Layer Motion Blur', run: () => A.setLayers(useMotion.getState().selectedLayers, (l) => ({ motionBlur: !l.motionBlur }), 'Motion Blur'), enabled: hasSel, checked: () => sel().some((l) => l.motionBlur) },
  { id: 'm.solo', label: 'Solo', run: () => A.setLayers(useMotion.getState().selectedLayers, (l) => ({ solo: !l.solo }), 'Solo'), enabled: hasSel },
  { id: 'm.lock', label: 'Lock / Unlock', shortcut: 'Mod+L', run: () => A.setLayers(useMotion.getState().selectedLayers, (l) => ({ locked: !l.locked }), 'Lock Layer'), enabled: hasSel },
  { id: 'm.hide', label: 'Show / Hide', run: () => A.setLayers(useMotion.getState().selectedLayers, (l) => ({ visible: !l.visible }), 'Show/Hide Layer'), enabled: hasSel },
  { id: 'm.trimIn', label: 'Trim In Point to Time', shortcut: 'Alt+[', run: () => A.trimToCTI('in'), enabled: hasSel },
  { id: 'm.trimOut', label: 'Trim Out Point to Time', shortcut: 'Alt+]', run: () => A.trimToCTI('out'), enabled: hasSel },
  { id: 'm.moveIn', label: 'Move Layer Start to Time', shortcut: '[', run: () => { for (const l of sel()) A.shiftLayersTime([l.id], compTime() - l.inPoint); }, enabled: hasSel },
  { id: 'm.moveOut', label: 'Move Layer End to Time', shortcut: ']', run: () => { for (const l of sel()) A.shiftLayersTime([l.id], compTime() - l.outPoint); }, enabled: hasSel },
  { id: 'm.front', label: 'Bring to Front', shortcut: 'Mod+Shift+]', run: () => A.arrange('top'), enabled: hasSel },
  { id: 'm.forward', label: 'Bring Forward', shortcut: 'Mod+]', run: () => A.arrange('up'), enabled: hasSel },
  { id: 'm.backward', label: 'Send Backward', shortcut: 'Mod+[', run: () => A.arrange('down'), enabled: hasSel },
  { id: 'm.back', label: 'Send to Back', shortcut: 'Mod+Shift+[', run: () => A.arrange('bottom'), enabled: hasSel },
  { id: 'm.unparent', label: 'Remove Parent', run: () => { for (const l of sel()) A.setParent(l.id, null); }, enabled: hasSel },
  // animation
  { id: 'm.easy', label: 'Easy Ease', shortcut: 'F9', run: () => A.easeSelectedKeys('easeInOut'), enabled: hasKeys },
  { id: 'm.easeIn', label: 'Easy Ease In', shortcut: 'Shift+F9', run: () => A.easeSelectedKeys('easeIn'), enabled: hasKeys },
  { id: 'm.easeOut', label: 'Easy Ease Out', shortcut: 'Mod+Shift+F9', run: () => A.easeSelectedKeys('easeOut'), enabled: hasKeys },
  { id: 'm.linear', label: 'Linear', run: () => A.easeSelectedKeys('linear'), enabled: hasKeys },
  { id: 'm.hold', label: 'Toggle Hold Keyframe', shortcut: 'Mod+Alt+H', run: () => A.easeSelectedKeys('hold'), enabled: hasKeys },
  { id: 'm.autoBezier', label: 'Smooth Motion Path (Auto-Bezier)', run: () => { for (const l of sel()) A.smoothMotionPath(l.id); }, enabled: hasSel },
  { id: 'm.linearPath', label: 'Straight Motion Path', run: () => { for (const l of sel()) A.straightenMotionPath(l.id); }, enabled: hasSel },
  { id: 'm.selectKeys', label: 'Select All Keyframes', shortcut: 'Mod+Alt+A', run: () => A.selectAllKeys(), enabled: hasSel },
  { id: 'm.revealTransform', label: 'Reveal Transform', shortcut: 'P|S|R|A', run: () => reveal('transform'), enabled: hasComp },
  { id: 'm.revealAll', label: 'Reveal Animated Properties', shortcut: 'U', run: () => reveal('animated'), enabled: hasComp },
  { id: 'm.savePreset', label: 'Save Animation Preset…', run: () => openMotionDialog({ type: 'save-preset' }), enabled: hasSel },
  { id: 'm.fadeIn', label: 'Fade In', run: () => applyPreset('fade-in'), enabled: hasSel },
  { id: 'm.fadeOut', label: 'Fade Out', run: () => applyPreset('fade-out'), enabled: hasSel },
  { id: 'm.removeEffects', label: 'Remove All Effects', run: () => A.setLayers(useMotion.getState().selectedLayers, () => ({ effects: [] }), 'Remove All Effects'), enabled: hasSel },
  // view / transport
  { id: 'm.play', label: 'Play / Pause', shortcut: 'Space', run: togglePlay, enabled: hasComp },
  { id: 'm.stop', label: 'Stop', run: stop, enabled: hasComp },
  { id: 'm.loop', label: 'Loop Playback', run: () => useMotion.setState((s) => ({ loop: !s.loop })), checked: () => useMotion.getState().loop },
  { id: 'm.prevFrame', label: 'Previous Frame', shortcut: 'PageUp|Mod+ArrowLeft', run: () => A.stepFrames(-1), enabled: hasComp },
  { id: 'm.nextFrame', label: 'Next Frame', shortcut: 'PageDown|Mod+ArrowRight', run: () => A.stepFrames(1), enabled: hasComp },
  { id: 'm.back10', label: 'Back 10 Frames', shortcut: 'Shift+PageUp', run: () => A.stepFrames(-10), enabled: hasComp },
  { id: 'm.fwd10', label: 'Forward 10 Frames', shortcut: 'Shift+PageDown', run: () => A.stepFrames(10), enabled: hasComp },
  { id: 'm.start', label: 'Go to Start', shortcut: 'Home', run: A.goToStart, enabled: hasComp },
  { id: 'm.end', label: 'Go to End', shortcut: 'End', run: A.goToEnd, enabled: hasComp },
  { id: 'm.prevKey', label: 'Previous Keyframe', shortcut: 'J', run: () => A.jumpKey(-1), enabled: hasComp },
  { id: 'm.nextKey', label: 'Next Keyframe', shortcut: 'K', run: () => A.jumpKey(1), enabled: hasComp },
  { id: 'm.layerIn', label: 'Go to Layer In Point', shortcut: 'I', run: () => { const l = sel()[0]; if (l) setTime(l.inPoint); }, enabled: hasSel },
  { id: 'm.layerOut', label: 'Go to Layer Out Point', shortcut: 'O', run: () => { const l = sel()[0]; if (l) setTime(l.outPoint - 1 / (activeComp()?.fps ?? 30)); }, enabled: hasSel },
  { id: 'm.qFull', label: 'Full Quality', run: () => useMotion.setState({ quality: 1 }), checked: () => useMotion.getState().quality === 1 },
  { id: 'm.qHalf', label: 'Half Quality', run: () => useMotion.setState({ quality: 0.5 }), checked: () => useMotion.getState().quality === 0.5 },
  { id: 'm.qQuarter', label: 'Quarter Quality', run: () => useMotion.setState({ quality: 0.25 }), checked: () => useMotion.getState().quality === 0.25 },
  { id: 'm.zoomIn', label: 'Zoom In', shortcut: '.', run: () => zoomView(1.25), enabled: hasComp },
  { id: 'm.zoomOut', label: 'Zoom Out', shortcut: ',', run: () => zoomView(0.8), enabled: hasComp },
  { id: 'm.fit', label: 'Fit in Viewer', shortcut: 'Shift+/', run: () => useMotion.setState((s) => ({ view: { ...s.view, fit: true, panX: 0, panY: 0 } })), enabled: hasComp },
  { id: 'm.grid', label: 'Grid', run: () => useMotionUI.setState((s) => ({ showGrid: !s.showGrid })), checked: () => useMotionUI.getState().showGrid },
  { id: 'm.safe', label: 'Title/Action Safe', run: () => useMotionUI.setState((s) => ({ showSafe: !s.showSafe })), checked: () => useMotionUI.getState().showSafe },
  { id: 'm.paths', label: 'Motion Paths', run: () => useMotionUI.setState((s) => ({ showPaths: !s.showPaths })), checked: () => useMotionUI.getState().showPaths },
  { id: 'm.checker', label: 'Transparency Grid', run: () => useMotionUI.setState((s) => ({ checker: !s.checker })), checked: () => useMotionUI.getState().checker },
  { id: 'm.graph', label: 'Graph Editor', shortcut: 'Shift+F3', run: () => useMotion.setState((s) => ({ timeline: { ...s.timeline, graph: !s.timeline.graph } })), checked: () => useMotion.getState().timeline.graph },
  { id: 'm.tlZoomIn', label: 'Zoom Timeline In', shortcut: '=', run: () => useMotion.setState((s) => ({ timeline: { ...s.timeline, pxPerSec: Math.min(4000, s.timeline.pxPerSec * 1.4) } })) },
  { id: 'm.tlZoomOut', label: 'Zoom Timeline Out', shortcut: '-', run: () => useMotion.setState((s) => ({ timeline: { ...s.timeline, pxPerSec: Math.max(4, s.timeline.pxPerSec / 1.4) } })) },
  { id: 'm.shortcuts', label: 'Keyboard Shortcuts', run: () => openMotionDialog({ type: 'shortcuts' }) },
  // tools
  { id: 'm.tool.select', label: 'Selection Tool', shortcut: 'V', run: tool('select') },
  { id: 'm.tool.hand', label: 'Hand Tool', shortcut: 'H', run: tool('hand') },
  { id: 'm.tool.zoom', label: 'Zoom Tool', shortcut: 'Z', run: tool('zoom') },
  { id: 'm.tool.rotate', label: 'Rotation Tool', shortcut: 'W', run: tool('rotate') },
  { id: 'm.tool.anchor', label: 'Pan Behind (Anchor Point) Tool', shortcut: 'Y', run: tool('anchor') },
  { id: 'm.tool.rect', label: 'Rectangle Tool', shortcut: 'Q', run: () => { const t = useMotion.getState().tool; const cyc: MotionTool[] = ['rect', 'ellipse', 'polygon', 'star']; useMotion.setState({ tool: cyc.includes(t) ? cyc[(cyc.indexOf(t) + 1) % cyc.length] : 'rect' }); } },
  { id: 'm.tool.pen', label: 'Pen Tool', shortcut: 'G', run: tool('pen') },
  { id: 'm.tool.text', label: 'Type Tool', shortcut: 'T|Mod+T', run: tool('text') },
  { id: 'm.tool.camera', label: 'Camera Tool', shortcut: 'C', run: tool('camera') },
].forEach(add);

function boundsFor(l: MLayer, c: NonNullable<ReturnType<typeof activeComp>>) {
  if (l.type === 'solid') return { x: l.width * 0.15, y: l.height * 0.15, w: l.width * 0.7, h: l.height * 0.7 };
  if ('assetId' in l) { const a = useMotion.getState().project.assets[l.assetId]; if (a) return { x: a.width * 0.15, y: a.height * 0.15, w: a.width * 0.7, h: a.height * 0.7 }; }
  if (l.type === 'precomp') { const s = useMotion.getState().project.comps[l.compId]; if (s) return { x: s.width * 0.15, y: s.height * 0.15, w: s.width * 0.7, h: s.height * 0.7 }; }
  return { x: -c.width * 0.2, y: -c.height * 0.2, w: c.width * 0.4, h: c.height * 0.4 };
}
function zoomView(f: number) {
  useMotion.setState((s) => ({ view: { ...s.view, fit: false, zoom: Math.max(0.05, Math.min(16, s.view.zoom * f)) } }));
}

// effect commands (menu)
for (const d of EFFECT_DEFS) add({ id: `m.fx.${d.id}`, label: d.name, run: () => A.addEffect(d.id), enabled: hasSel });
export const EFFECT_MENU = EFFECT_CATEGORIES.map((c) => ({ label: c, items: EFFECT_DEFS.filter((d) => d.category === c).map((d) => `m.fx.${d.id}`) }));

export const runM = (id: string) => { const c = MCOMMANDS.get(id); if (c && (!c.enabled || c.enabled())) c.run(); };

// ---------- keyboard ----------
function comboOf(e: KeyboardEvent): string[] {
  const mods: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) mods.push('Mod');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  // with Alt/Shift on some layouts e.key changes; also try the physical key
  const fromCode = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : ({ BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Slash: '/', Equal: '=', Minus: '-', NumpadMultiply: '*', NumpadAdd: '=', NumpadSubtract: '-' } as Record<string, string>)[e.code] ?? e.code;
  return [[...mods, key].join('+'), [...mods, fromCode].join('+'), key === '*' ? '*' : ''];
}
function onKey(e: KeyboardEvent) {
  if (!isMotion() || e.defaultPrevented || isEditable(e.target) || useMotionUI.getState().dialog || (document.querySelector('[role="dialog"]'))) return;
  const combos = comboOf(e);
  for (const c of MCOMMANDS.values()) {
    if (!c.shortcut) continue;
    const opts = c.shortcut.split('|').map((s) => s.replace(/(^|\+)([a-z])$/, (_m, p, k) => p + k.toUpperCase()));
    if (opts.some((o) => combos.includes(o))) {
      e.preventDefault();
      if (!c.enabled || c.enabled()) c.run();
      return;
    }
  }
}
let installed = false;
export function installMotionKeyboard() { if (installed) return; installed = true; window.addEventListener('keydown', onKey); }
export { stop, togglePlay };
