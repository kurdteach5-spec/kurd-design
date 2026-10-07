import type { TextLayer, TextStyle } from '../types/document';
import { createCanvas, ctx2d } from '../utils/canvas';
import { fontStack, fontVersion, ensureFont } from '../utils/fonts';
import { rgba } from '../utils/color';
import type { Rect } from '../utils/math';

export interface TextLine { text: string; width: number; x: number; baseline: number; justifyGap: number }
export interface TextLayout { lines: TextLine[]; width: number; height: number; font: string; lineHeight: number }

let measureCtx: CanvasRenderingContext2D | null = null;
function mctx() { if (!measureCtx) measureCtx = ctx2d(createCanvas(8, 8)); return measureCtx; }

export const fontCss = (s: TextStyle) => `${s.italic ? 'italic ' : ''}${s.fontWeight} ${s.fontSize}px ${fontStack(s.fontFamily)}`;

export function transformText(text: string, t: TextStyle['transform']): string {
  switch (t) {
    case 'uppercase': return text.toUpperCase();
    case 'lowercase': return text.toLowerCase();
    case 'capitalize': return text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    default: return text;
  }
}

function measure(ctx: CanvasRenderingContext2D, s: string, spacing: number) {
  if (!s) return 0;
  return ctx.measureText(s).width + spacing * [...s].length;
}

const layoutCache = new WeakMap<TextLayer, { v: number; layout: TextLayout }>();

export function layoutText(layer: Pick<TextLayer, 'text' | 'style' | 'boxWidth'> & object): TextLayout {
  const v = fontVersion();
  const cached = layoutCache.get(layer as TextLayer);
  if (cached && cached.v === v) return cached.layout;
  const s = layer.style;
  ensureFont(s.fontFamily, s.fontWeight, s.italic, layer.text.slice(0, 200));
  const ctx = mctx();
  ctx.font = fontCss(s);
  const lh = s.fontSize * s.lineHeight;
  const m = ctx.measureText('Hg');
  const ascent = m.fontBoundingBoxAscent ?? s.fontSize * 0.8;
  const descent = m.fontBoundingBoxDescent ?? s.fontSize * 0.2;
  const top = (lh - (ascent + descent)) / 2 + ascent;
  const raw = transformText(layer.text, s.transform).split('\n');
  const lines: { text: string; width: number; last: boolean }[] = [];
  for (const para of raw) {
    if (layer.boxWidth == null) { lines.push({ text: para, width: measure(ctx, para, s.letterSpacing), last: true }); continue; }
    const words = para.split(/(\s+)/);
    let cur = '';
    const paraLines: { text: string; width: number; last: boolean }[] = [];
    for (const w of words) {
      const test = cur + w;
      if (cur.trim() && measure(ctx, test.trimEnd(), s.letterSpacing) > layer.boxWidth) {
        paraLines.push({ text: cur.trimEnd(), width: measure(ctx, cur.trimEnd(), s.letterSpacing), last: false });
        cur = w.trimStart();
        // hard-break very long words
        while (measure(ctx, cur, s.letterSpacing) > layer.boxWidth && cur.length > 1) {
          let i = cur.length - 1;
          while (i > 1 && measure(ctx, cur.slice(0, i), s.letterSpacing) > layer.boxWidth) i--;
          paraLines.push({ text: cur.slice(0, i), width: measure(ctx, cur.slice(0, i), s.letterSpacing), last: false });
          cur = cur.slice(i);
        }
      } else cur = test;
    }
    paraLines.push({ text: cur.trimEnd(), width: measure(ctx, cur.trimEnd(), s.letterSpacing), last: true });
    lines.push(...paraLines);
  }
  const maxW = Math.max(1, ...lines.map((l) => l.width));
  const boxW = layer.boxWidth ?? maxW;
  const out: TextLine[] = lines.map((l, i) => {
    let x = 0, gap = 0;
    if (s.align === 'center') x = (boxW - l.width) / 2;
    else if (s.align === 'right') x = boxW - l.width;
    else if (s.align === 'justify' && layer.boxWidth != null && !l.last) {
      const spaces = (l.text.match(/ /g) || []).length;
      if (spaces) gap = (boxW - l.width) / spaces;
    }
    return { text: l.text, width: l.width, x, baseline: top + i * lh, justifyGap: gap };
  });
  const layout: TextLayout = { lines: out, width: boxW, height: Math.max(lh, lines.length * lh), font: ctx.font, lineHeight: lh };
  layoutCache.set(layer as TextLayer, { v, layout });
  return layout;
}

export function textLocalBounds(layer: TextLayer): Rect {
  const l = layoutText(layer);
  return { x: 0, y: 0, w: Math.max(1, l.width), h: Math.max(1, l.height) };
}

const supportsLetterSpacing = (() => { try { return 'letterSpacing' in CanvasRenderingContext2D.prototype; } catch { return false; } })();

const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const STRONG_CHAR = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
/** True when the first letter of the text is Arabic-script / Hebrew (Kurdish, Arabic, Persian…). */
export function isRtlText(text: string): boolean {
  const m = STRONG_CHAR.exec(text);
  return !!m && RTL_CHAR.test(m[0]);
}

function drawLine(ctx: CanvasRenderingContext2D, line: TextLine, s: TextStyle, mode: 'fill' | 'stroke') {
  const draw = (t: string, x: number) => (mode === 'fill' ? ctx.fillText(t, x, line.baseline) : ctx.strokeText(t, x, line.baseline));
  const rtl = isRtlText(line.text);
  // right-to-left lines (Kurdish, Arabic) keep their word order and letter joining
  ctx.direction = rtl ? 'rtl' : 'ltr';
  if (line.justifyGap) {
    let x = line.x;
    const words = line.text.split(' ');
    for (const word of rtl ? words.reverse() : words) {
      drawSpaced(ctx, word, x, s.letterSpacing, draw);
      x += measure(ctx, word, s.letterSpacing) + measure(ctx, ' ', s.letterSpacing) + line.justifyGap;
    }
    return;
  }
  drawSpaced(ctx, line.text, line.x, s.letterSpacing, draw);
}

function drawSpaced(ctx: CanvasRenderingContext2D, text: string, x: number, spacing: number, draw: (t: string, x: number) => void) {
  if (!spacing) { draw(text, x); return; }
  if (supportsLetterSpacing) {
    const c = ctx as CanvasRenderingContext2D & { letterSpacing: string };
    const prev = c.letterSpacing; c.letterSpacing = `${spacing}px`; draw(text, x); c.letterSpacing = prev; return;
  }
  for (const ch of text) { draw(ch, x); x += ctx.measureText(ch).width + spacing; }
}

/** Draws text in layer-local coordinates (caller sets the layer transform). */
export function drawText(ctx: CanvasRenderingContext2D, layer: TextLayer, alpha = 1) {
  const s = layer.style;
  const L = layoutText(layer);
  ctx.save();
  ctx.font = L.font;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.globalAlpha *= alpha * s.textOpacity;
  ctx.lineJoin = 'round';
  if (s.shadow.enabled) {
    ctx.shadowColor = rgba(s.shadow.color, s.shadow.opacity);
    ctx.shadowBlur = s.shadow.blur;
    // shadow offsets are in device space; approximate using current scale
    const t = ctx.getTransform(); const k = Math.hypot(t.a, t.b) || 1;
    ctx.shadowOffsetX = s.shadow.offsetX * k; ctx.shadowOffsetY = s.shadow.offsetY * k; ctx.shadowBlur = s.shadow.blur * k;
  }
  if (s.stroke.enabled && s.stroke.width > 0) {
    ctx.strokeStyle = s.stroke.color; ctx.lineWidth = s.stroke.width * 2;
    for (const line of L.lines) drawLine(ctx, line, s, 'stroke');
    ctx.shadowColor = 'transparent';
  }
  ctx.fillStyle = s.color;
  for (const line of L.lines) drawLine(ctx, line, s, 'fill');
  ctx.shadowColor = 'transparent';
  if (s.underline || s.strikethrough) {
    const th = Math.max(1, s.fontSize / 14);
    for (const line of L.lines) {
      if (!line.text) continue;
      const w = line.justifyGap ? L.width - line.x : line.width;
      if (s.underline) ctx.fillRect(line.x, line.baseline + s.fontSize * 0.12, w, th);
      if (s.strikethrough) ctx.fillRect(line.x, line.baseline - s.fontSize * 0.28, w, th);
    }
  }
  ctx.restore();
}
