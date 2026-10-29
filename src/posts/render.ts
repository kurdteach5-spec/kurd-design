// Draws a post as a design (canvas) in the profile's style: social card, big quote or news headline.
import { SIZES, type Post, type Profile, type Template } from './store';
import { loadImage } from './sources';
import { ensureFont, fontStack } from '../utils/fonts';

const RTL = /^[^A-Za-z]*[֐-ࣿיִ-ﻼ]/;
const hexA = (hex: string, a: number) => { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

export function formatDate(ms: number) {
  const d = new Date(ms);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${word}` : word;
      if (ctx.measureText(t).width <= maxW) { line = t; continue; }
      if (line) out.push(line);
      // very long words (links) are broken by letters
      if (ctx.measureText(word).width > maxW) {
        let part = '';
        for (const ch of word) { if (ctx.measureText(part + ch).width > maxW) { out.push(part); part = ch; } else part += ch; }
        line = part;
      } else line = word;
    }
    out.push(line);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

/** largest font size (≤ max) whose wrapped text fits the box; long text is cut with … */
function fitText(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, maxW: number, maxH: number, max: number, min: number, lh = 1.32) {
  let size = max, lines: string[] = [];
  for (; size >= min; size -= Math.max(1, Math.round(size * 0.06))) {
    ctx.font = font(size); lines = wrap(ctx, text, maxW);
    if (lines.length * size * lh <= maxH) return { size, lines, lh };
  }
  size = min; ctx.font = font(size); lines = wrap(ctx, text, maxW);
  const fit = Math.max(1, Math.floor(maxH / (size * lh)));
  if (lines.length > fit) { lines = lines.slice(0, fit); let l = lines[fit - 1]; while (l && ctx.measureText(`${l}…`).width > maxW) l = l.slice(0, -1); lines[fit - 1] = `${l.trimEnd()}…`; }
  return { size, lines, lh };
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight); const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}
function avatar(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, name: string, x: number, y: number, d: number, accent: string) {
  ctx.save(); ctx.beginPath(); ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2); ctx.clip();
  if (img) cover(ctx, img, x, y, d, d);
  else {
    ctx.fillStyle = accent; ctx.fillRect(x, y, d, d);
    ctx.fillStyle = '#fff'; ctx.font = `700 ${d * 0.4}px ${fontStack('Inter')}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?', x + d / 2, y + d / 2 + d * 0.02);
  }
  ctx.restore();
}
function badge(ctx: CanvasRenderingContext2D, x: number, cy: number, d: number, color: string) {
  ctx.save(); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x + d / 2, cy, d / 2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = d * 0.13; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(x + d * 0.28, cy + d * 0.02); ctx.lineTo(x + d * 0.44, cy + d * 0.17); ctx.lineTo(x + d * 0.73, cy - d * 0.16); ctx.stroke(); ctx.restore();
}
function ellipsize(ctx: CanvasRenderingContext2D, s: string, maxW: number) { if (ctx.measureText(s).width <= maxW) return s; while (s && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1); return `${s}…`; }

export const postText = (p: Pick<Post, 'text' | 'textOverride'>) => (p.textOverride?.trim() ? p.textOverride : p.text).trim();

export interface RenderInput { post: Pick<Post, 'text' | 'textOverride' | 'date' | 'images'>; profile: Pick<Profile, 'name' | 'handle' | 'avatar' | 'avatarAuto'>; tpl: Template }

/** draws the design at full size (scale < 1 for previews) */
export async function renderPost({ post, profile, tpl }: RenderInput, scale = 1): Promise<HTMLCanvasElement> {
  const { w: W0, h: H0 } = SIZES[tpl.size];
  const cv = document.createElement('canvas'); cv.width = Math.round(W0 * scale); cv.height = Math.round(H0 * scale);
  const ctx = cv.getContext('2d')!; ctx.scale(scale, scale);
  const W = W0, H = H0, u = W / 1080;
  const text = postText(post);
  // short posts are drawn bigger so the design is filled
  const grow = text.length < 90 ? 1.45 : text.length < 180 ? 1.2 : 1;
  const rtl = RTL.test(text);
  const weight = tpl.layout === 'headline' || tpl.bold ? 800 : 500;
  ensureFont(tpl.font, weight, false, text.slice(0, 60)); ensureFont(tpl.font, 700);
  try { await document.fonts.load(`${weight} 40px ${fontStack(tpl.font)}`, text.slice(0, 60) || 'A'); await document.fonts.load(`700 40px ${fontStack(tpl.font)}`); } catch { /* fonts API missing */ }
  const [bgImg, av, pic, logo] = await Promise.all([
    tpl.bgType === 'image' ? loadImage(tpl.bgImage) : null,
    tpl.showAvatar ? loadImage(profile.avatar || profile.avatarAuto) : null,
    tpl.showImage && post.images[0] ? loadImage(post.images[0]) : null,
    loadImage(tpl.logo),
  ]);
  const F = (px: number, wgt = weight) => `${wgt} ${px}px ${fontStack(tpl.font)}`;
  const UI = (px: number, wgt = 600) => `${wgt} ${px}px ${fontStack(tpl.font)}`;

  // background
  if (tpl.bgType === 'solid') { ctx.fillStyle = tpl.bg1; ctx.fillRect(0, 0, W, H); }
  else {
    const a = (tpl.bgAngle * Math.PI) / 180, r = Math.hypot(W, H) / 2;
    const g = ctx.createLinearGradient(W / 2 - Math.cos(a) * r, H / 2 - Math.sin(a) * r, W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r);
    g.addColorStop(0, tpl.bg1); g.addColorStop(1, tpl.bg2); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (bgImg) { cover(ctx, bgImg, 0, 0, W, H); if (tpl.bgDim > 0) { ctx.fillStyle = `rgba(0,0,0,${tpl.bgDim})`; ctx.fillRect(0, 0, W, H); } }
  }

  const pad = 72 * u;
  const footerH = (tpl.logo || tpl.footer ? 96 : 0) * u;
  const inner = tpl.cardOn ? 56 * u : 0;
  const boxX = pad, boxW = W - pad * 2;
  const maxH = H - pad * 2 - footerH;
  const cx = boxX + inner, cw = boxW - inner * 2;
  ctx.textBaseline = 'alphabetic';
  const dateStr = formatDate(post.date);
  const sub = [tpl.showHandle ? profile.handle : '', tpl.showDate ? dateStr : ''].filter(Boolean).join(' · ');
  const textAlignX = (lineDir: 'ltr' | 'rtl') => {
    if (tpl.align === 'center') { ctx.textAlign = 'center'; return cx + cw / 2; }
    ctx.direction = lineDir; ctx.textAlign = 'start'; return lineDir === 'rtl' ? cx + cw : cx;
  };

  const drawCard = (y: number, h: number) => {
    if (!tpl.cardOn) return;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.28)'; ctx.shadowBlur = 50 * u; ctx.shadowOffsetY = 18 * u;
    ctx.fillStyle = hexA(tpl.cardColor, tpl.cardOpacity); rrect(ctx, boxX, y, boxW, h, tpl.radius * u); ctx.fill(); ctx.restore();
  };
  const drawPic = (y: number, h: number) => { if (!pic || h < 40 * u) return; ctx.save(); rrect(ctx, cx, y, cw, h, Math.min(tpl.radius, 28) * u); ctx.clip(); cover(ctx, pic, cx, y, cw, h); ctx.restore(); };
  const nameRow = (x: number, y: number, d: number, nameSize: number, subSize: number, maxW: number) => {
    let tx = x;
    if (tpl.showAvatar) { avatar(ctx, av, profile.name, x, y, d, tpl.accent); tx = x + d + 24 * u; }
    const mid = y + d / 2;
    ctx.direction = 'ltr'; ctx.textAlign = 'left';
    ctx.font = UI(nameSize, 800); ctx.fillStyle = tpl.nameColor;
    const nm = ellipsize(ctx, profile.name, maxW - (tx - x) - nameSize * 1.4);
    const ny = sub ? mid - subSize * 0.25 : mid + nameSize * 0.35;
    ctx.fillText(nm, tx, ny);
    if (tpl.verified) badge(ctx, tx + ctx.measureText(nm).width + 12 * u, ny - nameSize * 0.36, nameSize * 0.9, tpl.accent);
    if (sub) { ctx.font = UI(subSize, 500); ctx.fillStyle = tpl.subColor; ctx.fillText(ellipsize(ctx, sub, maxW - (tx - x)), tx, mid + subSize * 1.05); }
  };

  if (tpl.layout === 'card') {
    const avD = 112 * u, headH = tpl.showAvatar || profile.name ? avD : 0, gap = 40 * u;
    const picMax = pic ? Math.min(maxH * (text ? 0.46 : 0.75), cw * 0.75) : 0;
    const textMaxH = Math.max(0, maxH - inner * 2 - headH - gap - (pic ? picMax + gap : 0));
    const fit = text ? fitText(ctx, text, (px) => F(px), cw, textMaxH, tpl.textSize * grow * u, 22 * u) : { size: 0, lines: [] as string[], lh: 1.32 };
    const textH = fit.lines.length * fit.size * fit.lh;
    const contentH = headH + (text ? gap + textH : 0) + (pic ? gap + picMax : 0);
    const cardH = Math.min(maxH, contentH + inner * 2);
    const y0 = pad + (maxH - cardH) / 2;
    drawCard(y0, cardH);
    let y = y0 + inner;
    nameRow(cx, y, avD, 44 * u, 32 * u, cw); y += headH;
    if (text) {
      y += gap; ctx.font = F(fit.size); ctx.fillStyle = tpl.textColor;
      for (const line of fit.lines) { const x = textAlignX(RTL.test(line) || (rtl && !/[A-Za-z]/.test(line)) ? 'rtl' : 'ltr'); y += fit.size * fit.lh; ctx.fillText(line, x, y - fit.size * (fit.lh - 1) / 2 - fit.size * 0.18); }
    }
    if (pic) { y += gap; drawPic(y, picMax); }
  } else if (tpl.layout === 'quote') {
    const qSize = 230 * u, avD = 96 * u, gap = 44 * u;
    const picH = pic ? Math.min(maxH * 0.3, 300 * u) : 0;
    const textMaxH = Math.max(0, maxH - inner * 2 - qSize * 0.55 - avD - gap * 2 - (pic ? picH + gap : 0));
    const fit = fitText(ctx, text || ' ', (px) => F(px), cw, textMaxH, tpl.textSize * 1.25 * grow * u, 24 * u, 1.28);
    const textH = fit.lines.length * fit.size * fit.lh;
    const contentH = qSize * 0.55 + textH + gap * 2 + avD + (pic ? picH + gap : 0);
    const cardH = Math.min(maxH, contentH + inner * 2);
    const y0 = pad + (maxH - cardH) / 2;
    drawCard(y0, cardH);
    let y = y0 + inner;
    ctx.font = `900 ${qSize}px ${fontStack('Georgia')}`; ctx.fillStyle = tpl.accent; ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.textAlign = tpl.align === 'center' ? 'center' : 'start';
    ctx.fillText(rtl ? '”' : '“', tpl.align === 'center' ? cx + cw / 2 : rtl ? cx + cw : cx - 8 * u, y + qSize * 0.72);
    y += qSize * 0.55;
    ctx.font = F(fit.size); ctx.fillStyle = tpl.textColor;
    for (const line of fit.lines) { const x = textAlignX(RTL.test(line) ? 'rtl' : 'ltr'); y += fit.size * fit.lh; ctx.fillText(line, x, y - fit.size * 0.25); }
    if (pic) { y += gap; drawPic(y, picH); y += picH; }
    y += gap;
    ctx.fillStyle = tpl.accent; const lw = 90 * u; ctx.fillRect(tpl.align === 'center' ? cx + cw / 2 - lw / 2 : rtl ? cx + cw - lw : cx, y - gap / 2 - 3 * u, lw, 6 * u);
    nameRow(cx, y, avD, 40 * u, 29 * u, cw);
  } else {
    // headline: label, big bold text with an accent bar, name strip at the bottom
    const labelH = tpl.label ? 74 * u : 0, avD = 92 * u, gap = 40 * u;
    const picH = pic ? Math.min(maxH * 0.34, cw * 0.56) : 0;
    const textMaxH = Math.max(0, maxH - inner * 2 - labelH - avD - gap * 2 - (pic ? picH + gap : 0));
    const barW = 14 * u;
    const fit = fitText(ctx, text || ' ', (px) => F(px, 800), cw - barW - 30 * u, textMaxH, tpl.textSize * 1.35 * grow * u, 26 * u, 1.18);
    const textH = fit.lines.length * fit.size * fit.lh;
    const contentH = labelH + gap + textH + gap + avD + (pic ? picH + gap : 0);
    const cardH = Math.min(maxH, contentH + inner * 2);
    const y0 = pad + (maxH - cardH) / 2;
    drawCard(y0, cardH);
    let y = y0 + inner;
    if (tpl.label) {
      ctx.font = UI(34 * u, 800); ctx.direction = RTL.test(tpl.label) ? 'rtl' : 'ltr'; ctx.textAlign = 'left';
      const lw = ctx.measureText(tpl.label).width + 52 * u;
      ctx.fillStyle = tpl.accent; rrect(ctx, rtl ? cx + cw - lw : cx, y, lw, labelH, 12 * u); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(tpl.label, (rtl ? cx + cw - lw : cx) + lw / 2, y + labelH / 2 + 12 * u);
      y += labelH;
    }
    y += gap;
    ctx.fillStyle = tpl.accent; ctx.fillRect(rtl ? cx + cw - barW : cx, y, barW, textH);
    ctx.font = F(fit.size, 800); ctx.fillStyle = tpl.textColor;
    const tx0 = rtl ? cx : cx + barW + 30 * u, tw = cw - barW - 30 * u;
    for (const line of fit.lines) {
      const lr = RTL.test(line) || rtl; ctx.direction = lr ? 'rtl' : 'ltr';
      ctx.textAlign = tpl.align === 'center' ? 'center' : 'start';
      const x = tpl.align === 'center' ? tx0 + tw / 2 : lr ? tx0 + tw : tx0;
      y += fit.size * fit.lh; ctx.fillText(line, x, y - fit.size * 0.2);
    }
    if (pic) { y += gap; drawPic(y, picH); y += picH; }
    y += gap;
    nameRow(cx, y, avD, 38 * u, 28 * u, cw);
  }

  // footer: logo + your text
  if (logo || tpl.footer) {
    const fy = H - pad * 0.55 - footerH / 2;
    const lh = tpl.logoSize * u, lw = logo ? (logo.naturalWidth / logo.naturalHeight) * lh : 0;
    const left = tpl.logoPos === 'bl' || tpl.logoPos === 'tl', top = tpl.logoPos === 'tl' || tpl.logoPos === 'tr';
    if (logo) ctx.drawImage(logo, left ? pad : W - pad - lw, top ? pad * 0.45 : fy - lh / 2, lw, lh);
    if (tpl.footer) {
      ctx.font = UI(30 * u, 600); ctx.fillStyle = tpl.footerColor;
      ctx.direction = RTL.test(tpl.footer) ? 'rtl' : 'ltr';
      const sameSide = !top && logo; ctx.textAlign = sameSide ? (left ? 'right' : 'left') : 'center';
      ctx.fillText(tpl.footer, sameSide ? (left ? W - pad : pad) : W / 2, fy + 10 * u);
    }
  }
  return cv;
}

export const canvasBlob = (cv: HTMLCanvasElement, format: 'png' | 'jpg') =>
  new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('The design could not be saved.'))), format === 'png' ? 'image/png' : 'image/jpeg', 0.93));

export const fileName = (profile: Pick<Profile, 'tab' | 'name'>, post: Pick<Post, 'date'>, format: 'png' | 'jpg') => {
  const d = new Date(post.date); const p = (n: number) => String(n).padStart(2, '0');
  return `${(profile.tab || profile.name).replace(/[^\w؀-ۿ-]+/g, '_')}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.${format}`;
};
