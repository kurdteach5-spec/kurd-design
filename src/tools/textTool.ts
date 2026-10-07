import type { Tool } from './types';
import type { Engine } from '../canvas/engine';
import type { TextLayer, TextStyle } from '../types/document';
import { create } from '../state/createStore';
import { useTools } from '../state/toolStore';
import { commit, getDocState, useDocuments } from '../state/documentStore';
import { findLayer, insertLayers, updateLayer, layersTopDown, removeLayers } from '../layers/tree';
import { createTextLayer } from '../layers/factory';
import { hitTestLayer, layerQuad } from '../layers/geometry';
import { translate, type Point } from '../utils/math';
import { textLocalBounds } from '../canvas/textRender';

export interface TextEditState {
  layerId: string | null;
  /** Pending new text (layer is created on first keystroke). */
  pending: { x: number; y: number; boxWidth: number | null } | null;
  version: number;
}
export const useTextEdit = create<TextEditState>(() => ({ layerId: null, pending: null, version: 0 }));

// switching documents ends any text editing session (it belongs to the previous document)
let lastActiveDoc: string | null = null;
useDocuments.subscribe((s) => {
  if (s.activeId === lastActiveDoc) return;
  lastActiveDoc = s.activeId;
  const t = useTextEdit.getState();
  if (t.layerId || t.pending) useTextEdit.setState((x) => ({ layerId: null, pending: null, version: x.version + 1 }));
});

export function editingLayer(): TextLayer | null {
  const { layerId } = useTextEdit.getState(); const s = getDocState();
  const l = s && layerId ? findLayer(s.layers, layerId) : null;
  return l && l.type === 'text' ? l : null;
}

export function beginEditText(layerId: string) {
  commit((s) => ({ ...s, activeLayerId: layerId, selectedLayerIds: [layerId], editTarget: 'content' }));
  useTextEdit.setState((s) => ({ layerId, pending: null, version: s.version + 1 }));
}

/** Edit an existing text layer later: switches to the Type tool and puts the cursor in the text. */
export function editTextLayer(layerId: string) {
  const s = getDocState(); const l = s ? findLayer(s.layers, layerId) : null;
  if (!l || l.type !== 'text') return;
  if (useTools.getState().tool !== 'text') useTools.setState({ tool: 'text' });
  beginEditText(layerId);
}

export function finishEditText() {
  const { layerId } = useTextEdit.getState();
  const l = editingLayer();
  if (l && !l.text.trim()) commit((s) => ({ ...s, layers: removeLayers(s.layers, new Set([l.id])) }), { history: 'Delete Empty Text' });
  else if (l && layerId) commit((s) => ({ ...s, layers: updateLayer(s.layers, layerId, (x) => ({ ...x, name: (x as TextLayer).text.split('\n')[0].slice(0, 32) || 'Text' })) }));
  useTextEdit.setState((s) => ({ layerId: null, pending: null, version: s.version + 1 }));
}

/** Called by the on-canvas editor whenever the text changes. */
export function setEditedText(text: string) {
  const st = useTextEdit.getState();
  if (st.pending && !st.layerId) {
    if (!text) return;
    const ts = useTools.getState();
    // new text uses the foreground color, like other desktop editors
    const style = { ...ts.options.text, color: ts.foreground };
    const layer = createTextLayer(text, st.pending.x, st.pending.y, style, st.pending.boxWidth);
    commit((s) => ({ ...s, layers: insertLayers(s.layers, [layer], s.activeLayerId, 'above'), activeLayerId: layer.id, selectedLayerIds: [layer.id], editTarget: 'content' }), { history: 'Type Tool', mergeKey: `text-${layer.id}` });
    useTextEdit.setState((s) => ({ layerId: layer.id, pending: null, version: s.version + 1 }));
    return;
  }
  if (!st.layerId) return;
  const id = st.layerId;
  commit((s) => ({ ...s, layers: updateLayer(s.layers, id, (l) => ({ ...l, text } as TextLayer)) }), { history: 'Edit Text', mergeKey: `text-${id}` });
}

/** Applies a style patch to the edited / active text layer, else to the tool defaults. */
export function applyTextStyle(patch: Partial<TextStyle>, label = 'Character Style') {
  const s = getDocState();
  const id = useTextEdit.getState().layerId ?? s?.activeLayerId;
  const l = s && id ? findLayer(s.layers, id) : null;
  const opts = useTools.getState().options;
  useTools.setState({ options: { ...opts, text: { ...opts.text, ...patch } } });
  if (l && l.type === 'text' && !l.locked) {
    commit((st) => ({ ...st, layers: updateLayer(st.layers, l.id, (x) => ({ ...x, style: { ...(x as TextLayer).style, ...patch } } as TextLayer)) }), { history: label, mergeKey: `style-${l.id}-${Object.keys(patch).join()}` });
  }
}

export function setTextBoxWidth(width: number | null) {
  const s = getDocState(); const id = s?.activeLayerId; const l = s && id ? findLayer(s.layers, id) : null;
  if (l && l.type === 'text') commit((st) => ({ ...st, layers: updateLayer(st.layers, l.id, (x) => ({ ...x, boxWidth: width } as TextLayer)) }), { history: width ? 'Convert to Paragraph Text' : 'Convert to Point Text' });
}

let dragStart: Point | null = null; let dragEnd: Point | null = null;

function textAt(engine: Engine, p: Point): TextLayer | null {
  const st = engine.state; if (!st) return null;
  for (const l of layersTopDown(st.layers)) if (l.type === 'text' && l.visible && !l.locked && hitTestLayer(l, p)) return l;
  return null;
}

export const textTool: Tool = {
  id: 'text',
  cursor: (engine, e) => (e && textAt(engine, e.doc) ? 'text' : 'text'),
  deactivate() { if (useTextEdit.getState().layerId || useTextEdit.getState().pending) finishEditText(); },
  hasSession: () => !!(useTextEdit.getState().layerId || useTextEdit.getState().pending),
  commit: () => finishEditText(),
  cancel: () => finishEditText(),
  onDown(e, engine) {
    const ed = useTextEdit.getState();
    if (ed.layerId) {
      const l = editingLayer();
      const q = l ? layerQuad(l) : null;
      if (l && q && hitTestLayer(l, e.doc)) return; // clicks inside the box are handled by the textarea
      finishEditText();
      return;
    }
    if (ed.pending) { finishEditText(); return; }
    const hit = textAt(engine, e.doc);
    if (hit) { beginEditText(hit.id); return; }
    dragStart = e.doc; dragEnd = e.doc;
  },
  onMove(e, _engine, dragging) { if (dragging && dragStart) dragEnd = e.doc; },
  onUp(_e, engine) {
    if (!dragStart || !dragEnd) return;
    const st = engine.state; const style = useTools.getState().options.text;
    const w = Math.abs(dragEnd.x - dragStart.x);
    const box = w > 8 / engine.zoom ? Math.max(20, w) : null;
    const x = box ? Math.min(dragStart.x, dragEnd.x) : dragStart.x;
    const y = box ? Math.min(dragStart.y, dragEnd.y) : dragStart.y - style.fontSize * style.lineHeight * 0.75;
    dragStart = dragEnd = null;
    if (!st) return;
    useTextEdit.setState((s) => ({ layerId: null, pending: { x: Math.round(x), y: Math.round(y), boxWidth: box }, version: s.version + 1 }));
  },
  onKeyDown(e) { if (e.key === 'Escape' && textTool.hasSession!()) { finishEditText(); return true; } return false; },
  drawOverlay(ctx, engine) {
    if (dragStart && dragEnd) {
      const a = engine.docToScreen(dragStart), b = engine.docToScreen(dragEnd);
      ctx.save(); ctx.strokeStyle = '#4f8cff'; ctx.setLineDash([4, 3]); ctx.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y); ctx.restore();
    }
    const l = editingLayer();
    if (l) {
      const b = textLocalBounds(l);
      const pts = [{ x: b.x - 2, y: b.y - 2 }, { x: b.x + Math.max(b.w, 4) + 2, y: b.y - 2 }, { x: b.x + Math.max(b.w, 4) + 2, y: b.y + b.h + 2 }, { x: b.x - 2, y: b.y + b.h + 2 }]
        .map((p) => engine.docToScreen({ x: l.transform.a * p.x + l.transform.c * p.y + l.transform.e, y: l.transform.b * p.x + l.transform.d * p.y + l.transform.f }));
      ctx.save(); ctx.strokeStyle = '#4f8cff'; ctx.setLineDash([3, 3]); ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke(); ctx.restore();
    }
  },
};

export const _translate = translate;
