import { create } from '../state/createStore';

export interface FontDef { family: string; category: 'sans' | 'serif' | 'display' | 'mono' | 'script'; source: 'system' | 'google'; weights: number[] }

export const FONTS: FontDef[] = [
  { family: 'Inter', category: 'sans', source: 'google', weights: [300, 400, 500, 600, 700, 800, 900] },
  { family: 'Roboto', category: 'sans', source: 'google', weights: [300, 400, 500, 700, 900] },
  { family: 'Open Sans', category: 'sans', source: 'google', weights: [300, 400, 600, 700, 800] },
  { family: 'Montserrat', category: 'sans', source: 'google', weights: [300, 400, 500, 600, 700, 800, 900] },
  { family: 'Poppins', category: 'sans', source: 'google', weights: [300, 400, 500, 600, 700, 800, 900] },
  { family: 'Lato', category: 'sans', source: 'google', weights: [300, 400, 700, 900] },
  { family: 'Raleway', category: 'sans', source: 'google', weights: [300, 400, 500, 600, 700, 800, 900] },
  { family: 'Oswald', category: 'display', source: 'google', weights: [300, 400, 500, 600, 700] },
  { family: 'Bebas Neue', category: 'display', source: 'google', weights: [400] },
  { family: 'Anton', category: 'display', source: 'google', weights: [400] },
  { family: 'Playfair Display', category: 'serif', source: 'google', weights: [400, 500, 600, 700, 800, 900] },
  { family: 'Merriweather', category: 'serif', source: 'google', weights: [300, 400, 700, 900] },
  { family: 'Lora', category: 'serif', source: 'google', weights: [400, 500, 600, 700] },
  { family: 'DM Serif Display', category: 'serif', source: 'google', weights: [400] },
  { family: 'Pacifico', category: 'script', source: 'google', weights: [400] },
  { family: 'Dancing Script', category: 'script', source: 'google', weights: [400, 500, 600, 700] },
  { family: 'Lobster', category: 'script', source: 'google', weights: [400] },
  { family: 'JetBrains Mono', category: 'mono', source: 'google', weights: [300, 400, 500, 700, 800] },
  { family: 'Arial', category: 'sans', source: 'system', weights: [400, 700] },
  { family: 'Helvetica', category: 'sans', source: 'system', weights: [400, 700] },
  { family: 'Verdana', category: 'sans', source: 'system', weights: [400, 700] },
  { family: 'Trebuchet MS', category: 'sans', source: 'system', weights: [400, 700] },
  { family: 'Georgia', category: 'serif', source: 'system', weights: [400, 700] },
  { family: 'Times New Roman', category: 'serif', source: 'system', weights: [400, 700] },
  { family: 'Courier New', category: 'mono', source: 'system', weights: [400, 700] },
  { family: 'Impact', category: 'display', source: 'system', weights: [400] },
];

export const FALLBACK: Record<FontDef['category'], string> = {
  sans: 'system-ui, -apple-system, "Segoe UI", Arial, sans-serif', serif: 'Georgia, "Times New Roman", serif',
  display: 'Impact, "Arial Black", sans-serif', mono: '"Courier New", monospace', script: 'cursive',
};

export function fontStack(family: string): string {
  const def = FONTS.find((f) => f.family === family);
  return `"${family}", ${FALLBACK[def?.category ?? 'sans']}`;
}

/** Bumped whenever a web font finishes loading so text layouts re-measure. */
export const useFontVersion = create<{ version: number }>(() => ({ version: 0 }));
export const fontVersion = () => useFontVersion.getState().version;

const requested = new Set<string>();
export function ensureFont(family: string, weight = 400, italic = false) {
  const def = FONTS.find((f) => f.family === family);
  if (!def || def.source !== 'google') return;
  const key = `${family}`;
  if (!requested.has(key)) {
    requested.add(key);
    try {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      const fam = family.replace(/ /g, '+');
      const ws = def.weights.join(';');
      link.href = `https://fonts.googleapis.com/css2?family=${fam}:ital,wght@0,${ws.replace(/;/g, ';0,')};1,${ws.replace(/;/g, ';1,')}&display=swap`;
      link.onerror = () => { /* offline: fallback fonts are used */ };
      document.head.appendChild(link);
    } catch { /* ignore */ }
  }
  const spec = `${italic ? 'italic ' : ''}${weight} 32px "${family}"`;
  if ('fonts' in document) {
    document.fonts.load(spec).then((faces) => {
      if (faces.length) useFontVersion.setState((s) => ({ version: s.version + 1 }));
    }).catch(() => { /* ignore */ });
  }
}

/** Preload the default UI/text font. */
export function initFonts() {
  ensureFont('Inter', 400);
  if ('fonts' in document) document.fonts.addEventListener?.('loadingdone', () => useFontVersion.setState((s) => ({ version: s.version + 1 })));
}
