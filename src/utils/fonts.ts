import { create } from '../state/createStore';

export interface FontDef {
  family: string; category: 'sans' | 'serif' | 'display' | 'mono' | 'script'; source: 'system' | 'google'; weights: number[];
  /** has true italics on Google Fonts (requesting an italic that doesn't exist makes the whole request fail) */
  italics?: boolean;
  /** designed for Arabic script (Kurdish Sorani, Arabic, Persian) */
  arabic?: boolean;
}

export const FONTS: FontDef[] = [
  { family: 'Inter', category: 'sans', source: 'google', weights: [300, 400, 500, 600, 700, 800, 900], italics: true },
  { family: 'Roboto', category: 'sans', source: 'google', weights: [300, 400, 500, 700, 900], italics: true },
  { family: 'Open Sans', category: 'sans', source: 'google', weights: [300, 400, 600, 700, 800], italics: true },
  { family: 'Montserrat', category: 'sans', source: 'google', weights: [300, 400, 500, 600, 700, 800, 900], italics: true },
  { family: 'Poppins', category: 'sans', source: 'google', weights: [300, 400, 500, 600, 700, 800, 900], italics: true },
  { family: 'Lato', category: 'sans', source: 'google', weights: [300, 400, 700, 900], italics: true },
  { family: 'Raleway', category: 'sans', source: 'google', weights: [300, 400, 500, 600, 700, 800, 900], italics: true },
  { family: 'Oswald', category: 'display', source: 'google', weights: [300, 400, 500, 600, 700] },
  { family: 'Bebas Neue', category: 'display', source: 'google', weights: [400] },
  { family: 'Anton', category: 'display', source: 'google', weights: [400] },
  { family: 'Playfair Display', category: 'serif', source: 'google', weights: [400, 500, 600, 700, 800, 900], italics: true },
  { family: 'Merriweather', category: 'serif', source: 'google', weights: [300, 400, 700, 900], italics: true },
  { family: 'Lora', category: 'serif', source: 'google', weights: [400, 500, 600, 700], italics: true },
  { family: 'DM Serif Display', category: 'serif', source: 'google', weights: [400], italics: true },
  { family: 'Pacifico', category: 'script', source: 'google', weights: [400] },
  { family: 'Dancing Script', category: 'script', source: 'google', weights: [400, 500, 600, 700] },
  { family: 'Lobster', category: 'script', source: 'google', weights: [400] },
  { family: 'JetBrains Mono', category: 'mono', source: 'google', weights: [300, 400, 500, 700, 800], italics: true },
  // Arabic-script fonts with the Kurdish Sorani letters (ڕ ڵ ێ ۆ ڤ ە)
  { family: 'Noto Sans Arabic', category: 'sans', source: 'google', weights: [300, 400, 500, 600, 700, 800, 900], arabic: true },
  { family: 'Vazirmatn', category: 'sans', source: 'google', weights: [300, 400, 500, 600, 700, 800, 900], arabic: true },
  { family: 'Noto Kufi Arabic', category: 'sans', source: 'google', weights: [300, 400, 500, 600, 700, 800, 900], arabic: true },
  { family: 'Noto Naskh Arabic', category: 'serif', source: 'google', weights: [400, 500, 600, 700], arabic: true },
  { family: 'Cairo', category: 'sans', source: 'google', weights: [300, 400, 500, 600, 700, 800, 900], arabic: true },
  { family: 'Tajawal', category: 'sans', source: 'google', weights: [300, 400, 500, 700, 800, 900], arabic: true },
  { family: 'Amiri', category: 'serif', source: 'google', weights: [400, 700], arabic: true },
  { family: 'Reem Kufi', category: 'display', source: 'google', weights: [400, 500, 600, 700], arabic: true },
  { family: 'Lalezar', category: 'display', source: 'google', weights: [400], arabic: true },
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
  sans: 'system-ui, -apple-system, "Segoe UI", Arial, "Noto Sans Arabic", Tahoma, sans-serif', serif: 'Georgia, "Times New Roman", "Noto Naskh Arabic", serif',
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
const loaded = new Set<string>();
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
/** Makes sure a font (and, for Kurdish/Arabic text, its Arabic-script glyphs) is loaded. */
export function ensureFont(family: string, weight = 400, italic = false, sample = '') {
  if (sample && ARABIC.test(sample)) {
    const def0 = FONTS.find((f) => f.family === family);
    // Latin-only fonts fall back to Noto Sans Arabic for Kurdish/Arabic letters
    if (!def0?.arabic) ensureFont(def0?.category === 'serif' ? 'Noto Naskh Arabic' : 'Noto Sans Arabic', Math.min(700, weight), false, 'ئابپ');
  }
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
      link.href = def.italics
        ? `https://fonts.googleapis.com/css2?family=${fam}:ital,wght@0,${ws.replace(/;/g, ';0,')};1,${ws.replace(/;/g, ';1,')}&display=swap`
        : `https://fonts.googleapis.com/css2?family=${fam}:wght@${ws}&display=swap`;
      link.onerror = () => { /* offline: fallback fonts are used */ };
      document.head.appendChild(link);
    } catch { /* ignore */ }
  }
  const script = sample && ARABIC.test(sample) ? 'ar' : 'latin';
  const spec = `${italic ? 'italic ' : ''}${weight} 32px "${family}"`;
  const id = `${spec}|${script}`;
  if ('fonts' in document && !loaded.has(id)) {
    loaded.add(id);
    document.fonts.load(spec, script === 'ar' ? 'ئابپڕڵێۆ' : 'BESbswy').then((faces) => {
      if (faces.length) useFontVersion.setState((s) => ({ version: s.version + 1 }));
    }).catch(() => { loaded.delete(id); });
  }
}

/** Preload the default UI/text font. */
export function initFonts() {
  ensureFont('Inter', 400);
  if ('fonts' in document) document.fonts.addEventListener?.('loadingdone', () => useFontVersion.setState((s) => ({ version: s.version + 1 })));
}
