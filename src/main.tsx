import { usePod } from './podcast/store';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { toastError } from './state/uiStore';
import { getDocState, useDocuments } from './state/documentStore';
import { allLayers } from './layers/tree';
import { getEngine } from './canvas/engine';
import { installI18n } from './i18n';
import { useMotion } from './motion/store';

// Last-resort safety net: report unexpected errors instead of failing silently.
window.addEventListener('error', (e) => {
  if (!e.error) return;
  console.error(e.error);
  toastError('Something went wrong. Your work is safe — try the action again.');
});
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  const msg = e.reason instanceof Error ? e.reason.message : '';
  if (/quota|memory|allocation/i.test(msg)) toastError('The browser ran out of memory. Try a smaller image or close other documents.');
});

// Small inspection hook for automated tests and debugging.
(window as unknown as Record<string, unknown>).__designpro = {
  state: () => getDocState(),
  engine: () => getEngine(),
  layers: () => { const s = getDocState(); return s ? allLayers(s.layers).map((l) => ({ id: l.id, name: l.name, type: l.type, opacity: l.opacity, blendMode: l.blendMode, visible: l.visible })) : []; },
  motion: () => useMotion.getState(),
  podcast: () => usePod.getState(),
  podcastSet: (p: Record<string, unknown>) => usePod.setState(p),
  history: () => { const s = useDocuments.getState(); const d = s.activeId ? s.docs[s.activeId] : null; return d ? { labels: d.history.map((h) => h.label), index: d.historyIndex } : null; },
};

installI18n();
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
