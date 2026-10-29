// Draws the split screen as a picture: the whole frame with what is in the windows, or the frame alone with
// see-through windows (to put over your cameras in vMix, OBS, Premiere or the Vision Mixer).
import { areaPx, boxPx, defaultLabel, slantPoints, circleOf, type Content, type SplitStyle } from './store';
import type { Box } from './layouts';
import { tr } from '../i18n';

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
const loadImg = (src: string) => new Promise<HTMLImageElement | null>((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
function cover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, x: number, y: number, w: number, h: number) {
  if (!sw || !sh) return;
  const s = Math.max(w / sw, h / sh); ctx.drawImage(src, x + (w - sw * s) / 2, y + (h - sh * s) / 2, sw * s, sh * s);
}

export interface RenderOpts { boxes: Box[]; style: SplitStyle; contents: (Content | null)[]; labels: string[]; mode: 'full' | 'frame' | 'guide'; media?: Map<number, HTMLVideoElement | HTMLImageElement> }

export async function renderSplit(o: RenderOpts): Promise<HTMLCanvasElement> {
  const st = o.style;
  const cv = document.createElement('canvas'); cv.width = st.width; cv.height = st.height;
  const ctx = cv.getContext('2d')!;
  const W = st.width, H = st.height;
  // background
  if (st.bgType !== 'transparent') {
    if (st.bgType === 'solid') { ctx.fillStyle = st.bg1; ctx.fillRect(0, 0, W, H); }
    else {
      const a = (st.bgAngle * Math.PI) / 180, r = Math.hypot(W, H) / 2;
      const g = ctx.createLinearGradient(W / 2 - Math.cos(a) * r, H / 2 - Math.sin(a) * r, W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r);
      g.addColorStop(0, st.bg1); g.addColorStop(1, st.bg2); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      if (st.bgType === 'image' && st.bgImage) { const im = await loadImg(st.bgImage); if (im) cover(ctx, im, im.naturalWidth, im.naturalHeight, 0, 0, W, H); }
    }
  }
  const A = areaPx(st);
  ctx.save(); ctx.beginPath(); ctx.rect(A.x, A.y, A.w, A.h); ctx.clip();
  for (let i = 0; i < o.boxes.length; i++) {
    const b = o.boxes[i]; const p0 = boxPx(b, st); const p = b.shape === 'circle' ? circleOf(p0) : p0;
    const pts = slantPoints(b, p);
    const shape = (inset = 0) => {
      if (b.shape === 'circle') { ctx.beginPath(); ctx.arc(p.x + p.w / 2, p.y + p.h / 2, p.w / 2 - inset, 0, Math.PI * 2); return; }
      if (pts) { ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(p.x + x, p.y + y) : ctx.moveTo(p.x + x, p.y + y))); ctx.closePath(); return; }
      rr(ctx, p.x + inset, p.y + inset, p.w - inset * 2, p.h - inset * 2, Math.max(0, st.radius - inset));
    };
    if (st.glow) { ctx.save(); ctx.shadowColor = st.borderColor; ctx.shadowBlur = 24; shape(); ctx.fillStyle = '#000'; ctx.fill(); ctx.restore(); }
    ctx.save(); shape(); ctx.clip();
    if (o.mode === 'frame') { ctx.clearRect(p.x - 2, p.y - 2, p.w + 4, p.h + 4); }
    else {
      const el = o.media?.get(i); const c = o.contents[i];
      let drawn = false;
      if (o.mode === 'full' && el) {
        const sw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth, sh = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
        if (sw) { ctx.fillStyle = '#000'; ctx.fillRect(p.x, p.y, p.w, p.h); cover(ctx, el, sw, sh, p.x, p.y, p.w, p.h); drawn = true; }
      } else if (o.mode === 'full' && c?.kind === 'image') { const im = await loadImg(c.url); if (im) { cover(ctx, im, im.naturalWidth, im.naturalHeight, p.x, p.y, p.w, p.h); drawn = true; } }
      if (!drawn) {
        const col = b.role === 'host' ? st.hostColor : b.role === 'main' ? st.mainColor : st.guestColor;
        const g = ctx.createLinearGradient(p.x, p.y, p.x + p.w, p.y + p.h); g.addColorStop(0, col); g.addColorStop(1, '#0b0b16');
        ctx.fillStyle = g; ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `700 ${Math.max(14, Math.min(p.w, p.h) * 0.16)}px Inter, sans-serif`;
        ctx.fillText(String(i + 1), p.x + p.w / 2, p.y + p.h / 2);
      }
    }
    ctx.restore();
    if (st.borderW > 0) { ctx.save(); shape(); ctx.clip(); ctx.lineWidth = st.borderW * 2; ctx.strokeStyle = st.borderColor; shape(); ctx.stroke(); ctx.restore(); }
    if (st.labels) {
      const text = (o.labels[i] ?? '').trim() || tr(defaultLabel(b, i, o.boxes));
      const fs = Math.min(st.labelSize, p.h * 0.14, p.w * 0.08);
      ctx.save(); ctx.font = `700 ${fs}px Inter, "Noto Sans Arabic", sans-serif`;
      const rtl = /[؀-ۿ]/.test(text); ctx.direction = rtl ? 'rtl' : 'ltr';
      const tw = Math.min(ctx.measureText(text).width + fs * 1.2, p.w - fs);
      const lh = fs * 1.7, lx = rtl ? p.x + p.w - fs * 0.5 - tw : p.x + fs * 0.5, ly = p.y + p.h - lh - fs * 0.5;
      ctx.fillStyle = st.labelBg; rr(ctx, lx, ly, tw, lh, fs * 0.25); ctx.fill();
      ctx.fillStyle = st.labelColor; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText(text, lx + tw / 2, ly + lh / 2, tw - fs * 0.6); ctx.restore();
    }
  }
  ctx.restore();
  return cv;
}
export const toBlob = (cv: HTMLCanvasElement) => new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('The picture could not be saved.'))), 'image/png'));
