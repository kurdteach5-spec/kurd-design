// UI language support: English, Central Kurdish (Sorani) and Arabic.
//
// The interface is written in English. Instead of threading a t() call through every component,
// a small DOM translator watches the page and swaps English text (text nodes and a few attributes
// such as title / aria-label / placeholder / data-tip) for the active language using the
// dictionaries in ./ckb.ts and ./ar.ts. React keeps rendering English; whenever it writes new
// text, the translator replaces it before the browser paints. Switching language re-translates
// the whole page in place, so nothing reloads and no work is lost. The layout is not mirrored:
// Kurdish and Arabic labels are isolated (Unicode RLI…PDI) so they read right-to-left in place.
//
// - Add a translation: put "English text": "translation" in ckb.ts / ar.ts.
// - Values that change ("Opening photo.jpg…") use templates: "Opening {0}…": "…{0}…".
// - Text that must never be translated (user content): put it inside an element with translate="no".
// - Strings not shown through the DOM (confirm(), canvas text): call tr().
import { create } from '../state/createStore';
import ckb from './ckb';
import ar from './ar';

export type Lang = 'en' | 'ckb' | 'ar';
export const LANGUAGES: { id: Lang; label: string; short: string }[] = [
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'ckb', label: 'کوردی', short: 'کو' },
  { id: 'ar', label: 'العربية', short: 'ع' },
];
const DICTS: Record<Exclude<Lang, 'en'>, Record<string, string>> = { ckb, ar };
const STORAGE_KEY = 'kurd-design-lang';

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'ckb' || saved === 'ar') return saved;
  } catch { /* storage blocked */ }
  for (const l of navigator.languages ?? [navigator.language]) {
    const c = (l || '').toLowerCase();
    if (c.startsWith('ckb') || c.startsWith('ku')) return 'ckb';
    if (c.startsWith('ar')) return 'ar';
    if (c.startsWith('en')) return 'en';
  }
  return 'en';
}

export const useLang = create<{ lang: Lang }>(() => ({ lang: detect() }));
export const getLang = () => useLang.getState().lang;
export const isRtl = (l: Lang = getLang()) => l !== 'en';

// ---------- string lookup ----------

/** Templates ("Opening {0}…") compiled to regexes, most specific (longest literal text) first. */
const templates: { rx: RegExp; key: string }[] = (() => {
  const keys = new Set([...Object.keys(ckb), ...Object.keys(ar)].filter((k) => /\{\d\}/.test(k)));
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...keys]
    .sort((a, b) => b.replace(/\{\d\}/g, '').length - a.replace(/\{\d\}/g, '').length)
    .map((key) => ({ key, rx: new RegExp('^' + key.split(/(\{\d\})/).map((p) => (/^\{\d\}$/.test(p) ? '(.+?)' : esc(p))).join('') + '$') }));
})();

const LRI = '\u2066', RLI = '\u2067', PDI = '\u2069';
const RTL_SCRIPT = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

function lookup(s: string, dict: Record<string, string>, depth = 0): string | null {
  const hit = dict[s];
  if (hit !== undefined) return hit;
  if (depth > 2 || !/[A-Za-z]/.test(s)) return null;
  // "New…" → translate "New" and keep the ellipsis
  if (s.endsWith('…')) { const t = lookup(s.slice(0, -1), dict, depth + 1); if (t !== null) return t + '…'; }
  // "Save As" when only "Save As…" is in the dictionary
  if (!s.endsWith('…')) { const t = dict[s + '…']; if (t !== undefined) return t.replace(/…$/, ''); }
  // "Brush Tool / Pencil Tool" → translate each part
  if (s.includes(' / ')) {
    const parts = s.split(' / ').map((p) => lookup(p, dict, depth + 1));
    if (parts.every((p) => p !== null)) return parts.join(' / ');
  }
  // "Brush Tool (B)" / "Undo (Ctrl+Z)" → keep the shortcut left-to-right
  const sc = /^(.+?) \(([^()]{1,24})\)$/.exec(s);
  if (sc) { const t = lookup(sc[1], dict, depth + 1); if (t !== null) return `${t} (${LRI}${sc[2]}${PDI})`; }
  for (const { rx, key } of templates) {
    const m = rx.exec(s);
    if (!m) continue;
    const tpl = dict[key]; if (tpl === undefined) continue;
    return tpl.replace(/\{(\d)\}/g, (_, i: string) => {
      const v = m[+i + 1] ?? '';
      const t = lookup(v, dict, depth + 1);
      if (t !== null) return t;
      // numbers, sizes and file names keep their own left-to-right order inside RTL sentences
      return /[0-9A-Za-z]/.test(v) ? LRI + v + PDI : v;
    });
  }
  return null;
}

/** Translate an English UI string into the active language (English is returned unchanged). */
export function tr(english: string, ...args: (string | number)[]): string {
  const lang = getLang();
  let out = english;
  if (lang !== 'en') {
    const dict = DICTS[lang];
    out = args.length ? (dict[english] ?? english) : (translateText(english, dict) ?? english);
  }
  return args.length ? out.replace(/\{(\d)\}/g, (_, i: string) => String(args[+i] ?? '')) : out;
}

/** Translates the trimmed core of a string, preserving surrounding whitespace. */
function translateText(s: string, dict: Record<string, string>): string | null {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s)!;
  const core = m[2].replace(/\s+/g, ' ');
  if (!core) return null;
  const t = lookup(core, dict);
  if (t === null) return null;
  // Kurdish/Arabic text keeps its own right-to-left reading order inside the (unchanged) left-to-right layout
  return m[1] + (RTL_SCRIPT.test(t) ? RLI + t + PDI : t) + m[3];
}

// ---------- DOM translator ----------

const ATTRS = ['title', 'aria-label', 'placeholder', 'data-tip', 'alt'];
const SKIP = '[translate="no"], [contenteditable=""], [contenteditable="true"], script, style, textarea';
const textOrig = new WeakMap<Text, string>();
const textWritten = new WeakMap<Text, string>();
const attrOrig = new WeakMap<Element, Map<string, string>>();
const attrWritten = new WeakMap<Element, Map<string, string>>();

function target(english: string): string {
  const lang = getLang();
  return lang === 'en' ? english : (translateText(english, DICTS[lang]) ?? english);
}

function doText(node: Text) {
  const parent = node.parentElement;
  if (!parent || parent.closest(SKIP)) return;
  const cur = node.nodeValue ?? '';
  let orig = textOrig.get(node);
  // anything we did not write ourselves is new English text from React
  if (orig === undefined || textWritten.get(node) !== cur) { orig = cur; textOrig.set(node, cur); }
  const next = target(orig);
  textWritten.set(node, next);
  if (next !== cur) node.nodeValue = next;
}

function doAttr(el: Element, name: string) {
  const cur = el.getAttribute(name);
  if (cur === null || el.closest(SKIP)) return;
  let o = attrOrig.get(el); if (!o) attrOrig.set(el, (o = new Map()));
  let w = attrWritten.get(el); if (!w) attrWritten.set(el, (w = new Map()));
  let orig = o.get(name);
  if (orig === undefined || w.get(name) !== cur) { orig = cur; o.set(name, cur); }
  const next = target(orig);
  w.set(name, next);
  if (next !== cur) el.setAttribute(name, next);
}

function doTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { doText(root as Text); return; }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  if (el.closest(SKIP)) return;
  for (const a of ATTRS) if (el.hasAttribute(a)) doAttr(el, a);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && (n as Element).matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text);
    else for (const a of ATTRS) if ((n as Element).hasAttribute(a)) doAttr(n as Element, a);
  }
}

function applyDocumentLang(lang: Lang) {
  const html = document.documentElement;
  html.lang = lang === 'en' ? 'en' : lang;
  // Only the language changes: the layout stays the same in every language.
  html.dir = 'ltr';
}

let observer: MutationObserver | null = null;

/** Starts translating the page. Call once before rendering. */
export function installI18n() {
  applyDocumentLang(getLang());
  if (observer) return;
  observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') doText(r.target as Text);
      else if (r.type === 'attributes') doAttr(r.target as Element, r.attributeName!);
      else r.addedNodes.forEach(doTree);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  doTree(document.body);
}

export function setLang(lang: Lang) {
  if (lang === getLang()) return;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* storage blocked: still switch for this visit */ }
  useLang.setState({ lang });
  applyDocumentLang(lang);
  doTree(document.body);
}
