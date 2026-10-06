import { isMac } from '../utils/id';
import { getDoc, getDocState, useDocuments } from '../state/documentStore';
import { openDialog, useUI, togglePanelVisible, resetWorkspace, focusPanel, toast, type PanelId } from '../state/uiStore';
import { useTools, swapColors, resetColors, setOptions, setTool } from '../state/toolStore';
import { getEngine } from '../canvas/engine';
import * as L from '../editor/layerActions';
import * as E from '../editor/editActions';
import * as F from '../editor/fileActions';
import { startFreeTransform, startTransformSelection, useTransform } from '../tools/transformState';
import { nudge } from '../tools/moveTool';
import { FILTERS } from '../filters/definitions';
import { ADJUSTMENT_LABELS } from '../layers/factory';
import type { AdjustmentKind, BlendMode } from '../types/document';
import { findLayer } from '../layers/tree';
import { uid } from '../utils/id';
import { commit } from '../state/documentStore';
import { selectColorRange } from '../tools/selectionTools';
import { hexToRgb } from '../utils/color';

export interface Command {
  id: string;
  label: string;
  /** e.g. "Mod+Shift+Z" — Mod is Ctrl (Cmd on macOS). Multiple separated by "|". */
  shortcut?: string;
  run: () => void;
  enabled?: () => boolean;
  checked?: () => boolean;
}

const hasDoc = () => !!getDocState();
const hasSel = () => !!getDocState()?.selection;
const activeLayer = () => { const s = getDocState(); return s ? findLayer(s.layers, s.activeLayerId) : null; };
const hasLayer = () => !!activeLayer();
const hasMask = () => !!activeLayer()?.mask;
const ui = () => useUI.getState();
const toggleUI = (k: 'showRulers' | 'showGrid' | 'showGuides' | 'showPixelGrid' | 'snap' | 'showSelectionEdges') => useUI.setState((s) => ({ [k]: !s[k] }) as Partial<typeof s>);

const list: Command[] = [
  // File
  { id: 'file.new', label: 'New…', shortcut: 'Mod+N|Alt+N', run: () => openDialog({ type: 'new-document' }) },
  { id: 'file.open', label: 'Open…', shortcut: 'Mod+O', run: () => void F.openWithPicker() },
  { id: 'file.recent', label: 'Open Recent…', run: () => openDialog({ type: 'projects' }) },
  { id: 'file.home', label: 'Home', run: () => useUI.setState({ showHome: true }) },
  { id: 'file.place', label: 'Import / Place Image…', shortcut: 'Mod+Shift+P', run: () => void F.placeWithPicker(), enabled: hasDoc },
  { id: 'file.save', label: 'Save', shortcut: 'Mod+S', run: () => void F.saveToProjects(), enabled: hasDoc },
  { id: 'file.saveAs', label: 'Save As…', shortcut: 'Mod+Shift+S', run: () => openDialog({ type: 'save-as' }), enabled: hasDoc },
  { id: 'file.downloadProject', label: 'Download Project (.dps)', run: () => void F.downloadProject(), enabled: hasDoc },
  { id: 'file.savePsd', label: 'Save as PSD', run: () => void F.downloadPsd(), enabled: hasDoc },
  { id: 'file.export', label: 'Export As…', shortcut: 'Mod+Alt+Shift+W|Mod+Shift+X', run: () => openDialog({ type: 'export' }), enabled: hasDoc },
  { id: 'file.quickPng', label: 'Quick Export as PNG', run: () => { const s = getDocState(); if (s) void F.exportDocument({ format: 'png', quality: 1, width: s.width, height: s.height, dpi: s.dpi, transparent: true, background: '#ffffff' }); }, enabled: hasDoc },
  { id: 'file.close', label: 'Close', shortcut: 'Mod+W|Alt+W', run: () => F.requestClose(), enabled: hasDoc },

  // Edit
  { id: 'edit.undo', label: 'Undo', shortcut: 'Mod+Z', run: E.doUndo, enabled: () => { const d = getDoc(); return !!d && (d.historyIndex > 0 || !!useTransform.getState().session); } },
  { id: 'edit.redo', label: 'Redo', shortcut: 'Mod+Shift+Z|Mod+Y', run: E.doRedo, enabled: () => { const d = getDoc(); return !!d && d.historyIndex < d.history.length - 1; } },
  { id: 'edit.cut', label: 'Cut', shortcut: 'Mod+X', run: () => void E.cut(), enabled: hasLayer },
  { id: 'edit.copy', label: 'Copy', shortcut: 'Mod+C', run: () => void E.copy(), enabled: hasLayer },
  { id: 'edit.copyMerged', label: 'Copy Merged', shortcut: 'Mod+Shift+C', run: () => void E.copy(true), enabled: hasDoc },
  { id: 'edit.paste', label: 'Paste', shortcut: 'Mod+V', run: () => void E.paste() },
  { id: 'edit.duplicate', label: 'Duplicate', shortcut: 'Mod+J', run: () => E.layerViaCopy(false), enabled: hasLayer },
  { id: 'edit.clear', label: 'Clear / Delete', shortcut: 'Delete|Backspace', run: () => E.clearSelectionPixels(), enabled: hasLayer },
  { id: 'edit.fillFg', label: 'Fill with Foreground', shortcut: 'Alt+Backspace|Alt+Delete', run: () => E.fillSelection('foreground'), enabled: hasLayer },
  { id: 'edit.fillBg', label: 'Fill with Background', shortcut: 'Mod+Backspace|Mod+Delete', run: () => E.fillSelection('background'), enabled: hasLayer },
  { id: 'edit.stroke', label: 'Stroke Selection (4px)', run: () => E.strokeSelection(4), enabled: hasSel },
  { id: 'edit.freeTransform', label: 'Free Transform', shortcut: 'Mod+T', run: () => startFreeTransform('free'), enabled: hasLayer },
  { id: 'edit.transform.skew', label: 'Skew', run: () => startFreeTransform('skew'), enabled: hasLayer },
  { id: 'edit.transform.distort', label: 'Distort', run: () => startFreeTransform('distort'), enabled: hasLayer },
  { id: 'edit.transform.perspective', label: 'Perspective', run: () => startFreeTransform('perspective'), enabled: hasLayer },
  { id: 'edit.transform.rot180', label: 'Rotate 180°', run: () => E.transformLayers('rot180'), enabled: hasLayer },
  { id: 'edit.transform.rot90', label: 'Rotate 90° Clockwise', run: () => E.transformLayers('rot90'), enabled: hasLayer },
  { id: 'edit.transform.rot-90', label: 'Rotate 90° Counter Clockwise', run: () => E.transformLayers('rot-90'), enabled: hasLayer },
  { id: 'edit.transform.flipH', label: 'Flip Horizontal', run: () => E.transformLayers('flipH'), enabled: hasLayer },
  { id: 'edit.transform.flipV', label: 'Flip Vertical', run: () => E.transformLayers('flipV'), enabled: hasLayer },
  { id: 'edit.shortcuts', label: 'Keyboard Shortcuts', shortcut: 'Mod+Alt+Shift+K', run: () => openDialog({ type: 'shortcuts' }) },

  // Image
  { id: 'image.mode.rgb', label: 'RGB Color', run: () => E.setColorMode('rgb'), enabled: hasDoc, checked: () => getDocState()?.colorMode === 'rgb' },
  { id: 'image.mode.gray', label: 'Grayscale', run: () => E.setColorMode('grayscale'), enabled: hasDoc, checked: () => getDocState()?.colorMode === 'grayscale' },
  { id: 'image.imageSize', label: 'Image Size…', shortcut: 'Mod+Alt+I', run: () => openDialog({ type: 'image-size' }), enabled: hasDoc },
  { id: 'image.canvasSize', label: 'Canvas Size…', shortcut: 'Mod+Alt+C', run: () => openDialog({ type: 'canvas-size' }), enabled: hasDoc },
  { id: 'image.rot180', label: 'Rotate 180°', run: () => E.rotateCanvas(180), enabled: hasDoc },
  { id: 'image.rot90', label: 'Rotate 90° Clockwise', run: () => E.rotateCanvas(90), enabled: hasDoc },
  { id: 'image.rot-90', label: 'Rotate 90° Counter Clockwise', run: () => E.rotateCanvas(-90), enabled: hasDoc },
  { id: 'image.flipH', label: 'Flip Canvas Horizontal', run: () => E.flipCanvas(true), enabled: hasDoc },
  { id: 'image.flipV', label: 'Flip Canvas Vertical', run: () => E.flipCanvas(false), enabled: hasDoc },
  { id: 'image.crop', label: 'Crop to Selection', run: E.cropToSelection, enabled: hasSel },
  { id: 'image.trim', label: 'Trim Transparent Pixels', run: E.trimTransparent, enabled: hasDoc },
  { id: 'image.adj.invert', label: 'Invert', shortcut: 'Mod+I', run: () => E.applyAdjustmentDestructive({ kind: 'invert' }, 'Invert'), enabled: hasLayer },
  { id: 'image.adj.desaturate', label: 'Desaturate', shortcut: 'Mod+Shift+U', run: () => E.applyAdjustmentDestructive({ kind: 'hue-saturation', hue: 0, saturation: -100, lightness: 0, colorize: false }, 'Desaturate'), enabled: hasLayer },

  // Layer
  { id: 'layer.new', label: 'New Layer', shortcut: 'Mod+Shift+N', run: L.newLayer, enabled: hasDoc },
  { id: 'layer.duplicate', label: 'Duplicate Layer', run: L.duplicateLayers, enabled: hasLayer },
  { id: 'layer.delete', label: 'Delete Layer', run: () => L.deleteLayers(), enabled: hasLayer },
  { id: 'layer.rename', label: 'Rename Layer…', shortcut: 'F2', run: () => { const l = activeLayer(); if (l) openDialog({ type: 'rename-layer', layerId: l.id }); }, enabled: hasLayer },
  { id: 'layer.style', label: 'Layer Style…', run: () => { const l = activeLayer(); if (l) openDialog({ type: 'layer-style', layerId: l.id }); }, enabled: hasLayer },
  { id: 'layer.mask.reveal', label: 'Add Mask: Reveal All', run: () => L.addLayerMask('reveal'), enabled: () => hasLayer() && !hasMask() },
  { id: 'layer.mask.hide', label: 'Add Mask: Hide All', run: () => L.addLayerMask('hide'), enabled: () => hasLayer() && !hasMask() },
  { id: 'layer.mask.selection', label: 'Add Mask: Reveal Selection', run: () => L.addLayerMask('selection'), enabled: () => hasSel() && hasLayer() && !hasMask() },
  { id: 'layer.mask.toggle', label: 'Disable / Enable Mask', run: () => L.toggleMaskEnabled(), enabled: hasMask },
  { id: 'layer.mask.invert', label: 'Invert Mask', run: L.invertMask, enabled: hasMask },
  { id: 'layer.mask.apply', label: 'Apply Mask', run: () => L.deleteLayerMask(true), enabled: hasMask },
  { id: 'layer.mask.delete', label: 'Delete Mask', run: () => L.deleteLayerMask(false), enabled: hasMask },
  { id: 'layer.mask.edit', label: 'Edit Mask', run: () => { const l = activeLayer(); if (l?.mask) L.setEditTarget(l.id, 'mask'); }, enabled: hasMask },
  { id: 'layer.vmask.reveal', label: 'Add Vector Mask: Reveal All', run: () => L.addVectorMask('reveal'), enabled: () => hasLayer() && !activeLayer()?.vectorMask },
  { id: 'layer.vmask.selection', label: 'Add Vector Mask: Selection Bounds', run: () => L.addVectorMask('selection'), enabled: () => hasSel() && hasLayer() && !activeLayer()?.vectorMask },
  { id: 'layer.vmask.delete', label: 'Delete Vector Mask', run: L.deleteVectorMask, enabled: () => !!activeLayer()?.vectorMask },
  { id: 'layer.clip', label: 'Create / Release Clipping Mask', shortcut: 'Mod+Alt+G', run: L.toggleClipping, enabled: hasLayer },
  { id: 'layer.group', label: 'Group Layers', shortcut: 'Mod+G', run: L.groupLayers, enabled: hasLayer },
  { id: 'layer.ungroup', label: 'Ungroup Layers', shortcut: 'Mod+Shift+G', run: L.ungroupLayers, enabled: () => activeLayer()?.type === 'group' },
  { id: 'layer.front', label: 'Bring to Front', shortcut: 'Mod+Shift+]', run: () => L.arrange('top'), enabled: hasLayer },
  { id: 'layer.forward', label: 'Bring Forward', shortcut: 'Mod+]', run: () => L.arrange('up'), enabled: hasLayer },
  { id: 'layer.backward', label: 'Send Backward', shortcut: 'Mod+[', run: () => L.arrange('down'), enabled: hasLayer },
  { id: 'layer.back', label: 'Send to Back', shortcut: 'Mod+Shift+[', run: () => L.arrange('bottom'), enabled: hasLayer },
  { id: 'layer.selectUp', label: 'Select Layer Above', shortcut: 'Alt+]', run: () => L.selectAdjacentLayer(1), enabled: hasLayer },
  { id: 'layer.selectDown', label: 'Select Layer Below', shortcut: 'Alt+[', run: () => L.selectAdjacentLayer(-1), enabled: hasLayer },
  { id: 'layer.mergeDown', label: 'Merge Down / Merge Selected', shortcut: 'Mod+E', run: L.mergeSelected, enabled: hasLayer },
  { id: 'layer.mergeVisible', label: 'Merge Visible', shortcut: 'Mod+Shift+E', run: L.mergeVisible, enabled: hasDoc },
  { id: 'layer.flatten', label: 'Flatten Image', run: L.flattenImage, enabled: hasDoc },
  { id: 'layer.rasterize', label: 'Rasterize Layer', run: L.rasterize, enabled: () => ['text', 'shape'].includes(activeLayer()?.type ?? '') },
  { id: 'layer.lock', label: 'Lock / Unlock Layer', shortcut: 'Mod+/', run: L.toggleLock, enabled: hasLayer },
  { id: 'layer.hide', label: 'Show / Hide Layer', shortcut: 'Mod+,', run: () => { const l = activeLayer(); if (l) L.toggleVisibility(l.id); }, enabled: hasLayer },
  { id: 'layer.align.left', label: 'Align Left Edges', run: () => L.alignLayers('left'), enabled: hasLayer },
  { id: 'layer.align.hcenter', label: 'Align Horizontal Centers', run: () => L.alignLayers('hcenter'), enabled: hasLayer },
  { id: 'layer.align.right', label: 'Align Right Edges', run: () => L.alignLayers('right'), enabled: hasLayer },
  { id: 'layer.align.top', label: 'Align Top Edges', run: () => L.alignLayers('top'), enabled: hasLayer },
  { id: 'layer.align.vcenter', label: 'Align Vertical Centers', run: () => L.alignLayers('vcenter'), enabled: hasLayer },
  { id: 'layer.align.bottom', label: 'Align Bottom Edges', run: () => L.alignLayers('bottom'), enabled: hasLayer },
  { id: 'layer.distribute.h', label: 'Distribute Horizontally', run: () => L.distributeLayers('h'), enabled: hasLayer },
  { id: 'layer.distribute.v', label: 'Distribute Vertically', run: () => L.distributeLayers('v'), enabled: hasLayer },
  { id: 'layer.toSelection', label: 'Load Layer as Selection', run: () => L.layerAlphaToSelection(), enabled: hasLayer },

  // Select
  { id: 'select.all', label: 'All', shortcut: 'Mod+A', run: E.selectAll, enabled: hasDoc },
  { id: 'select.none', label: 'Deselect', shortcut: 'Mod+D', run: E.deselect, enabled: hasSel },
  { id: 'select.reselect', label: 'Reselect', shortcut: 'Mod+Shift+D', run: E.reselect, enabled: hasDoc },
  { id: 'select.inverse', label: 'Inverse', shortcut: 'Mod+Shift+I', run: E.inverseSelection, enabled: hasDoc },
  { id: 'select.allLayers', label: 'All Layers', shortcut: 'Mod+Alt+A', run: E.selectAllLayers, enabled: hasDoc },
  { id: 'select.colorRange', label: 'Color Range (Foreground)', run: () => { const e = getEngine(); if (e) selectColorRange(e, hexToRgb(useTools.getState().foreground), 32); }, enabled: hasDoc },
  { id: 'select.feather', label: 'Feather…', shortcut: 'Shift+F6', run: () => openDialog({ type: 'selection-modify', op: 'feather' }), enabled: hasSel },
  { id: 'select.expand', label: 'Expand…', run: () => openDialog({ type: 'selection-modify', op: 'expand' }), enabled: hasSel },
  { id: 'select.contract', label: 'Contract…', run: () => openDialog({ type: 'selection-modify', op: 'contract' }), enabled: hasSel },
  { id: 'select.border', label: 'Border…', run: () => openDialog({ type: 'selection-modify', op: 'border' }), enabled: hasSel },
  { id: 'select.transform', label: 'Transform Selection', run: startTransformSelection, enabled: hasSel },
  { id: 'select.toMask', label: 'Layer Mask from Selection', run: () => L.addLayerMask('selection'), enabled: () => hasSel() && !hasMask() },
  { id: 'select.fromMask', label: 'Load Mask as Selection', run: L.maskToSelection, enabled: hasMask },

  // Filter
  { id: 'filter.last', label: 'Repeat Last Filter', shortcut: 'Mod+F', run: E.repeatLastFilter, enabled: () => hasLayer() && !!E.getLastFilter() },
  ...FILTERS.map((f) => ({ id: `filter.${f.id}`, label: `${f.name}${f.params.length ? '…' : ''}`, run: () => E.openFilterDialog(f.id), enabled: hasLayer } as Command)),
  { id: 'filter.dropShadow', label: 'Drop Shadow…', run: () => { const l = activeLayer(); if (l) openDialog({ type: 'layer-style', layerId: l.id, tab: 'dropShadow' }); }, enabled: hasLayer },
  { id: 'filter.outerGlow', label: 'Outer Glow…', run: () => { const l = activeLayer(); if (l) openDialog({ type: 'layer-style', layerId: l.id, tab: 'outerGlow' }); }, enabled: hasLayer },

  // View
  { id: 'view.zoomIn', label: 'Zoom In', shortcut: 'Mod+=|Mod++', run: () => getEngine()?.zoomStep(1), enabled: hasDoc },
  { id: 'view.zoomOut', label: 'Zoom Out', shortcut: 'Mod+-', run: () => getEngine()?.zoomStep(-1), enabled: hasDoc },
  { id: 'view.fit', label: 'Fit on Screen', shortcut: 'Mod+0', run: () => getEngine()?.fit(), enabled: hasDoc },
  { id: 'view.fill', label: 'Fill Screen', run: () => getEngine()?.fillScreen(), enabled: hasDoc },
  { id: 'view.100', label: '100%', shortcut: 'Mod+1', run: () => getEngine()?.zoomAt(1), enabled: hasDoc },
  { id: 'view.200', label: '200%', shortcut: 'Mod+2', run: () => getEngine()?.zoomAt(2), enabled: hasDoc },
  { id: 'view.center', label: 'Center Canvas', run: () => getEngine()?.center(), enabled: hasDoc },
  { id: 'view.rotLeft', label: 'Rotate View Left 15°', shortcut: 'Alt+Shift+,', run: () => getEngine()?.rotateView(-15), enabled: hasDoc },
  { id: 'view.rotRight', label: 'Rotate View Right 15°', shortcut: 'Alt+Shift+.', run: () => getEngine()?.rotateView(15), enabled: hasDoc },
  { id: 'view.rotReset', label: 'Reset View Rotation', shortcut: 'Escape', run: () => getEngine()?.rotateView(0, true), enabled: () => !!getDoc()?.view.rotation },
  { id: 'view.rulers', label: 'Rulers', shortcut: 'Mod+R', run: () => toggleUI('showRulers'), checked: () => ui().showRulers },
  { id: 'view.grid', label: 'Grid', shortcut: "Mod+'", run: () => toggleUI('showGrid'), checked: () => ui().showGrid },
  { id: 'view.guides', label: 'Guides', shortcut: 'Mod+;', run: () => toggleUI('showGuides'), checked: () => ui().showGuides },
  { id: 'view.pixelGrid', label: 'Pixel Grid', run: () => toggleUI('showPixelGrid'), checked: () => ui().showPixelGrid },
  { id: 'view.extras', label: 'Selection Edges', shortcut: 'Mod+H', run: () => toggleUI('showSelectionEdges'), checked: () => ui().showSelectionEdges },
  { id: 'view.snap', label: 'Snap', shortcut: 'Mod+Shift+;', run: () => toggleUI('snap'), checked: () => ui().snap },
  { id: 'view.newGuide', label: 'New Guide…', run: () => openDialog({ type: 'new-guide' }), enabled: hasDoc },
  { id: 'view.guideCenter', label: 'Add Center Guides', run: () => { const s = getDocState(); if (s) commit((st) => ({ ...st, guides: [...st.guides, { id: uid('g'), orientation: 'v', pos: st.width / 2 }, { id: uid('g'), orientation: 'h', pos: st.height / 2 }] }), { history: 'New Guides' }); }, enabled: hasDoc },
  { id: 'view.clearGuides', label: 'Clear Guides', run: () => commit((s) => ({ ...s, guides: [] }), { history: 'Clear Guides' }), enabled: () => !!getDocState()?.guides.length },
  { id: 'view.gridSettings', label: 'Grid Settings…', run: () => openDialog({ type: 'grid-settings' }) },

  // Window
  ...(['layers', 'properties', 'color', 'swatches', 'history', 'adjustments', 'brush', 'character', 'paragraph'] as PanelId[]).map((p) => ({
    id: `window.${p}`, label: p[0].toUpperCase() + p.slice(1), run: () => { if (ui().hiddenPanels.includes(p)) togglePanelVisible(p); focusPanel(p); }, checked: () => !ui().hiddenPanels.includes(p),
  } as Command)),
  { id: 'window.docked', label: 'Docked Panels', run: () => useUI.setState((s) => ({ sidebarMode: s.sidebarMode === 'docked' ? 'rail' : 'docked', floatingGroup: null })), checked: () => ui().sidebarMode === 'docked' },
  { id: 'window.reset', label: 'Reset Workspace', run: resetWorkspace },

  // Help
  { id: 'help.shortcuts', label: 'Keyboard Shortcuts', run: () => openDialog({ type: 'shortcuts' }) },
  { id: 'help.about', label: 'About KURD DESIGN', run: () => openDialog({ type: 'about' }) },

  // Tool / misc (keyboard only)
  { id: 'colors.swap', label: 'Swap Colors', shortcut: 'X', run: swapColors },
  { id: 'colors.reset', label: 'Default Colors', shortcut: 'D', run: resetColors },
  { id: 'brush.smaller', label: 'Decrease Brush Size', shortcut: '[', run: () => resizeBrush(-1) },
  { id: 'brush.larger', label: 'Increase Brush Size', shortcut: ']', run: () => resizeBrush(1) },
  { id: 'nudge.left', label: 'Nudge Left', shortcut: 'ArrowLeft', run: () => nudgeIfMove(-1, 0), enabled: hasLayer },
  { id: 'nudge.right', label: 'Nudge Right', shortcut: 'ArrowRight', run: () => nudgeIfMove(1, 0), enabled: hasLayer },
  { id: 'nudge.up', label: 'Nudge Up', shortcut: 'ArrowUp', run: () => nudgeIfMove(0, -1), enabled: hasLayer },
  { id: 'nudge.down', label: 'Nudge Down', shortcut: 'ArrowDown', run: () => nudgeIfMove(0, 1), enabled: hasLayer },
  { id: 'nudge.left10', label: 'Nudge Left 10px', shortcut: 'Shift+ArrowLeft', run: () => nudgeIfMove(-10, 0), enabled: hasLayer },
  { id: 'nudge.right10', label: 'Nudge Right 10px', shortcut: 'Shift+ArrowRight', run: () => nudgeIfMove(10, 0), enabled: hasLayer },
  { id: 'nudge.up10', label: 'Nudge Up 10px', shortcut: 'Shift+ArrowUp', run: () => nudgeIfMove(0, -10), enabled: hasLayer },
  { id: 'nudge.down10', label: 'Nudge Down 10px', shortcut: 'Shift+ArrowDown', run: () => nudgeIfMove(0, 10), enabled: hasLayer },
  { id: 'doc.next', label: 'Next Document', shortcut: 'Mod+Tab|Ctrl+PageDown', run: () => cycleDoc(1) },
];

function nudgeIfMove(dx: number, dy: number) {
  const t = useTools.getState().tool;
  if (t === 'move' || useTransform.getState().session) { nudge(dx, dy); return; }
  const e = getEngine(); if (!e) return;
  const v = e.viewState; e.setView({ panX: v.panX - dx * 10, panY: v.panY - dy * 10 });
}

function resizeBrush(dir: 1 | -1) {
  const s = useTools.getState(); const t = s.tool;
  const key = t === 'brush' ? 'brush' : t === 'pencil' ? 'pencil' : t === 'eraser' ? 'eraser' : t === 'clone-stamp' ? 'clone' : ['blur', 'sharpen', 'smudge'].includes(t) ? 'retouch' : ['dodge', 'burn'].includes(t) ? 'tone' : null;
  if (!key) return;
  const cur = (s.options[key] as { size: number }).size;
  const step = cur < 10 ? 1 : cur < 50 ? 5 : cur < 100 ? 10 : 25;
  setOptions(key, { size: Math.max(1, Math.min(2500, cur + dir * step)) } as never);
}

function cycleDoc(dir: number) {
  const { order, activeId } = useDocuments.getState(); if (order.length < 2) return;
  const i = order.indexOf(activeId ?? ''); useDocuments.setState({ activeId: order[(i + dir + order.length) % order.length] });
}

export const COMMANDS = new Map(list.map((c) => [c.id, c]));
export function run(id: string) {
  const c = COMMANDS.get(id);
  if (!c) return;
  if (c.enabled && !c.enabled()) return;
  try { c.run(); } catch (e) { console.error(e); toast(e instanceof Error ? e.message : 'Something went wrong.', 'error'); }
}

export const ADJUSTMENT_KINDS: AdjustmentKind[] = ['develop', 'brightness-contrast', 'levels', 'curves', 'exposure', 'hue-saturation', 'vibrance', 'color-balance', 'black-white', 'gradient-map', 'selective-color', 'invert', 'threshold', 'posterize'];
for (const k of ADJUSTMENT_KINDS) {
  COMMANDS.set(`adjlayer.${k}`, { id: `adjlayer.${k}`, label: `${ADJUSTMENT_LABELS[k]}…`, run: () => { L.newAdjustmentLayer(k); focusPanel('properties'); }, enabled: hasDoc });
  const destructiveKeys: Partial<Record<AdjustmentKind, string>> = { levels: 'Mod+L', curves: 'Mod+M', 'hue-saturation': 'Mod+U', 'color-balance': 'Mod+B', 'black-white': 'Mod+Alt+Shift+B' };
  COMMANDS.set(`imageadj.${k}`, { id: `imageadj.${k}`, label: `${ADJUSTMENT_LABELS[k]}…`, shortcut: destructiveKeys[k], run: () => openDialog({ type: 'adjustment', kind: k }), enabled: hasLayer });
}

export const BLEND_MODES: { value: BlendMode; label: string }[][] = [
  [{ value: 'normal', label: 'Normal' }],
  [{ value: 'darken', label: 'Darken' }, { value: 'multiply', label: 'Multiply' }, { value: 'color-burn', label: 'Color Burn' }],
  [{ value: 'lighten', label: 'Lighten' }, { value: 'screen', label: 'Screen' }, { value: 'color-dodge', label: 'Color Dodge' }],
  [{ value: 'overlay', label: 'Overlay' }, { value: 'soft-light', label: 'Soft Light' }, { value: 'hard-light', label: 'Hard Light' }],
  [{ value: 'difference', label: 'Difference' }, { value: 'exclusion', label: 'Exclusion' }],
  [{ value: 'hue', label: 'Hue' }, { value: 'saturation', label: 'Saturation' }, { value: 'color', label: 'Color' }, { value: 'luminosity', label: 'Luminosity' }],
];

// ---------------- Shortcut parsing & display ----------------
export interface KeyCombo { mod: boolean; shift: boolean; alt: boolean; ctrl: boolean; key: string }
export function parseShortcut(s: string): KeyCombo[] {
  return s.split('|').map((part) => {
    const keys = part.split(/\+(?!$)/);
    const key = keys.pop()!;
    return { mod: keys.includes('Mod'), shift: keys.includes('Shift'), alt: keys.includes('Alt'), ctrl: keys.includes('Ctrl'), key: key.length === 1 ? key.toLowerCase() : key };
  });
}

export function formatShortcut(s?: string): string {
  if (!s) return '';
  const first = s.split('|')[0];
  const parts = first.split(/\+(?!$)/);
  const map: Record<string, string> = isMac
    ? { Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃', Backspace: '⌫', Delete: '⌦', Escape: 'Esc', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Tab: '⇥' }
    : { Mod: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Ctrl: 'Ctrl', Backspace: 'Backspace', Delete: 'Del', Escape: 'Esc', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };
  const out = parts.map((p) => map[p] ?? (p.length === 1 ? p.toUpperCase() : p));
  return isMac ? out.join('') : out.join('+');
}

export function matches(e: KeyboardEvent, c: KeyCombo): boolean {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (c.mod !== mod) return false;
  if (c.ctrl && !e.ctrlKey) return false;
  if (!c.mod && !c.ctrl && (e.ctrlKey || e.metaKey)) return false;
  if (c.alt !== e.altKey) return false;
  let key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  // layout-independent fallbacks for punctuation / digits with modifiers
  if (e.code?.startsWith('Digit')) key = e.code.slice(5);
  if (e.code === 'BracketLeft') key = '['; if (e.code === 'BracketRight') key = ']';
  if (e.code === 'Equal') key = c.key === '+' ? '+' : '='; if (e.code === 'Minus') key = '-';
  if (e.code === 'Semicolon') key = ';'; if (e.code === 'Quote') key = "'"; if (e.code === 'Comma') key = ','; if (e.code === 'Period') key = '.'; if (e.code === 'Slash') key = '/';
  if (e.code?.startsWith('Key') && e.code.length === 4) key = e.code.slice(3).toLowerCase();
  if (key !== c.key) return false;
  // Shift must match exactly, except symbols that require shift on most layouts
  if (c.shift !== e.shiftKey && !(c.key === '+' && e.shiftKey)) return false;
  return true;
}

export function toolTip(label: string, shortcut?: string) { return shortcut ? `${label} (${formatShortcut(shortcut)})` : label; }
export { setTool };
