import { useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { useTextEdit, setEditedText, finishEditText } from '../../tools/textTool';
import { useDocuments, selectActiveState } from '../../state/documentStore';
import { useTools } from '../../state/toolStore';
import { findLayer } from '../../layers/tree';
import { getEngine, subscribeEngine } from '../../canvas/engine';
import { multiply, translate } from '../../utils/math';
import { fontStack } from '../../utils/fonts';
import { layoutText } from '../../canvas/textRender';
import type { TextLayer } from '../../types/document';

/**
 * Direct on-canvas text editing: a transparent textarea is laid exactly over the
 * text layer (same font metrics, CSS-transformed by the view + layer matrices),
 * while the canvas renders the real text underneath as you type.
 */
export function TextEditorOverlay() {
  const { layerId, pending, version } = useTextEdit();
  const st = useDocuments(selectActiveState);
  const defaults = useTools((s) => s.options.text);
  const fg = useTools((s) => s.foreground);
  const [, tick] = useReducer((x: number) => x + 1, 0);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => subscribeEngine(tick), []);

  const layer = st && layerId ? findLayer(st.layers, layerId) as TextLayer | null : null;
  const active = !!(layer || pending);

  useLayoutEffect(() => {
    if (!active || !ref.current) return;
    const ta = ref.current;
    if (document.activeElement !== ta) { ta.focus(); if (layer) ta.select(); }
  }, [active, version, layer]);

  // keep textarea value in sync when undo/redo changes the text
  useEffect(() => {
    if (ref.current && layer && ref.current.value !== layer.text) ref.current.value = layer.text;
    if (ref.current && !layer && pending) ref.current.value = '';
  }, [layer, pending]);

  const engine = getEngine();
  if (!active || !engine || !st) return null;
  const style = layer?.style ?? { ...defaults, color: fg };
  const m = multiply(engine.viewMatrix(), layer ? layer.transform : translate(pending!.x, pending!.y));
  const boxWidth = layer ? layer.boxWidth : pending!.boxWidth;
  const L = layer ? layoutText(layer) : null;
  const width = boxWidth ?? Math.max(40, (L?.width ?? 0) + style.fontSize * 1.5);
  const height = Math.max(style.fontSize * style.lineHeight, (L?.height ?? 0)) + style.fontSize * style.lineHeight;

  return (
    <textarea
      ref={ref}
      aria-label="Edit text"
      spellCheck={false}
      defaultValue={layer?.text ?? ''}
      className="absolute left-0 top-0 resize-none border-0 p-0 m-0 bg-transparent overflow-hidden outline-none"
      style={{
        transformOrigin: '0 0',
        transform: `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`,
        width, height,
        font: `${style.italic ? 'italic ' : ''}${style.fontWeight} ${style.fontSize}px ${fontStack(style.fontFamily)}`,
        lineHeight: `${style.fontSize * style.lineHeight}px`,
        letterSpacing: `${style.letterSpacing}px`,
        textAlign: style.align,
        textTransform: style.transform,
        whiteSpace: boxWidth ? 'pre-wrap' : 'pre',
        color: 'transparent',
        caretColor: '#4f8cff',
        outline: 'none',
        zIndex: 5,
      }}
      onInput={(e) => setEditedText(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); finishEditText(); }
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
