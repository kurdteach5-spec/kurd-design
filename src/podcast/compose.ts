// Program renderer (preview, vision mixer monitors and the final render):
//   background (an input, or a transition between two: mix, dip, wipe, DVE push)
//   → upstream key (luma, chroma, pattern, DVE picture-in-picture)
//   → downstream keys 1 and 2 (logo / lower third / title, with alpha or luma key)
//   → fade to black.
// Inputs are recordings (cameras, B-roll), split screens (SuperSource boxes) and switcher sources
// (media players with images, two colours, colour bars, black).
import { isVirtual, boxesAt, introOf, type DskConfig, type KeyConfig, type Overlay, type Segment, type Split, type TransParams } from './types';

export interface RenderCtx {
  W: number; H: number;
  fit: 'cover' | 'contain';
  splits: Split[];
  video: (id: string) => HTMLVideoElement | undefined;
  image: (mp: 'mp1' | 'mp2') => HTMLImageElement | undefined;
  colors: { col1: string; col2: string };
  fallback: string;
  /** timeline time being drawn (SuperSource animation) */
  time?: number;
  /** when each input went on air (SuperSource intro animation) */
  onAir?: Record<string, number>;
  /** framing of a camera picture: centre (0..1 of the source) and zoom (≥ 1) */
  framing?: (id: string) => { x: number; y: number; zoom: number } | undefined;
  /** still pictures used as inputs */
  still?: (id: string) => HTMLImageElement | undefined;
}

const ready = (v?: HTMLVideoElement): v is HTMLVideoElement => !!v && v.readyState >= 2 && v.videoWidth > 0;

/** draws a picture into a rectangle, filling (cropping) or fitting it; `crop` cuts 0..0.5 of each side first */
export function drawSource(ctx: CanvasRenderingContext2D, v: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement, x: number, y: number, w: number, h: number, fit: 'cover' | 'contain', crop?: { l: number; r: number; t: number; b: number }, focus?: { x: number; y: number; zoom: number }) {
  const vw = 'videoWidth' in v ? v.videoWidth : 'naturalWidth' in v ? v.naturalWidth : v.width;
  const vh = 'videoHeight' in v ? v.videoHeight : 'naturalHeight' in v ? v.naturalHeight : v.height;
  if (!vw || !vh || w <= 0 || h <= 0) return;
  const c = crop ?? { l: 0, r: 0, t: 0, b: 0 };
  const sx = vw * c.l, sy = vh * c.t, sw = vw * Math.max(0.01, 1 - c.l - c.r), sh = vh * Math.max(0.01, 1 - c.t - c.b);
  const zoom = Math.max(1, focus?.zoom ?? 1);
  const k = (fit === 'cover' ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh)) * zoom;
  // visible part of the source (centred on the focus point, kept inside the picture)
  const visW = Math.min(sw, w / k), visH = Math.min(sh, h / k);
  const fx = focus ? focus.x * vw : sx + sw / 2, fy = focus ? focus.y * vh : sy + sh / 2;
  const ox = Math.max(sx, Math.min(sx + sw - visW, fx - visW / 2)), oy = Math.max(sy, Math.min(sy + sh - visH, fy - visH / 2));
  const dw = visW * k, dh = visH * k;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.drawImage(v, ox, oy, visW, visH, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

function bars(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const top = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
  const mid = ['#0000c0', '#131313', '#c000c0', '#131313', '#00c0c0', '#131313', '#c0c0c0'];
  const w = W / 7;
  top.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(Math.floor(i * w), 0, Math.ceil(w), H * 0.67); });
  mid.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(Math.floor(i * w), H * 0.67, Math.ceil(w), H * 0.08); });
  const low = ['#00214c', '#ffffff', '#32006a', '#131313', '#090909', '#131313', '#1d1d1d', '#131313'];
  const lw = [1.25, 1.25, 1.25, 1.25, 0.33, 0.33, 0.34, 1].map((x) => (x * W) / 7);
  let x = 0; low.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(Math.floor(x), H * 0.75, Math.ceil(lw[i]), H * 0.25); x += lw[i]; });
}

/** true when everything this input needs can be drawn */
export function inputReady(id: string, rc: RenderCtx): boolean {
  if (isVirtual(id)) return true;
  const sp = rc.splits.find((x) => x.id === id);
  if (sp) return sp.boxes.every((b) => !b.on || !b.cam || ready(rc.video(b.cam)));
  return ready(rc.video(id));
}

/** draws one input as a full frame */
export function drawInput(ctx: CanvasRenderingContext2D, id: string, rc: RenderCtx, W = rc.W, H = rc.H) {
  if (isVirtual(id)) {
    if (id === 'blk') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); return; }
    if (id === 'bars') { bars(ctx, W, H); return; }
    if (id === 'col1' || id === 'col2') { ctx.fillStyle = rc.colors[id]; ctx.fillRect(0, 0, W, H); return; }
    // media player: the image over black (its transparency shows black — use it as a DSK fill for logos)
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const img = id.startsWith('media') ? rc.still?.(id) : rc.image(id as 'mp1' | 'mp2'); if (img) drawSource(ctx, img, 0, 0, W, H, 'contain');
    return;
  }
  const sp = rc.splits.find((x) => x.id === id);
  if (sp) {
    ctx.fillStyle = sp.bg; ctx.fillRect(0, 0, W, H);
    const boxes = boxesAt(sp, rc.time);
    const since = rc.onAir?.[id] !== undefined && rc.time !== undefined ? rc.time - rc.onAir[id] : undefined;
    boxes.forEach((b0, i) => {
      if (!b0.on) return;
      const intro = since !== undefined ? introOf(sp.anim, i, boxes.length, since, b0) : null;
      const b = intro ? { ...b0, ...intro } : b0;
      const x = b.x * W, y = b.y * H, w = b.w * W, h = b.h * H;
      if (w < 1 || h < 1) return;
      ctx.save(); if (intro) ctx.globalAlpha = intro.alpha;
      const v = b.cam ? (isVirtual(b.cam) ? null : rc.video(b.cam)) : null;
      if (v && ready(v)) drawSource(ctx, v, x, y, w, h, 'cover', b.crop);
      else if (b.cam && isVirtual(b.cam)) { ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.translate(x, y); drawInput(ctx, b.cam, rc, w, h); ctx.restore(); }
      if (sp.border > 0) { ctx.strokeStyle = sp.borderColor; ctx.lineWidth = sp.border * W; ctx.strokeRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth); }
      const bd = b.border;
      if (bd && (bd.t || bd.r || bd.b || bd.l)) {
        // each side on its own, inside the box
        ctx.fillStyle = bd.color;
        if (bd.t) ctx.fillRect(x, y, w, Math.min(h, bd.t * W));
        if (bd.b) ctx.fillRect(x, y + h - Math.min(h, bd.b * W), w, Math.min(h, bd.b * W));
        if (bd.l) ctx.fillRect(x, y, Math.min(w, bd.l * W), h);
        if (bd.r) ctx.fillRect(x + w - Math.min(w, bd.r * W), y, Math.min(w, bd.r * W), h);
      }
      ctx.restore();
    });
    return;
  }
  const v = rc.video(id);
  if (ready(v)) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); drawSource(ctx, v, 0, 0, W, H, rc.fit, undefined, rc.framing?.(id)); }
}

// ---------- transitions ----------
function wipePath(ctx: CanvasRenderingContext2D, tp: TransParams, p: number, W: number, H: number) {
  ctx.beginPath();
  switch (tp.wipe) {
    case 'h': tp.reverse ? ctx.rect(W * (1 - p), 0, W * p, H) : ctx.rect(0, 0, W * p, H); break;
    case 'v': tp.reverse ? ctx.rect(0, H * (1 - p), W, H * p) : ctx.rect(0, 0, W, H * p); break;
    case 'circle': { const r = Math.hypot(W, H) / 2 * p; ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2); break; }
    case 'diamond': { const r = (W + H) / 2 * p; ctx.moveTo(W / 2, H / 2 - r); ctx.lineTo(W / 2 + r, H / 2); ctx.lineTo(W / 2, H / 2 + r); ctx.lineTo(W / 2 - r, H / 2); ctx.closePath(); break; }
    case 'box': ctx.rect(W / 2 * (1 - p), H / 2 * (1 - p), W * p, H * p); break;
    case 'diagL': case 'diagR': {
      const d = (W + H) * p; const left = (tp.wipe === 'diagL') !== tp.reverse;
      if (left) { ctx.moveTo(0, 0); ctx.lineTo(d, 0); ctx.lineTo(d - H, H); ctx.lineTo(0, H); }
      else { ctx.moveTo(W, 0); ctx.lineTo(W - d, 0); ctx.lineTo(W - d + H, H); ctx.lineTo(W, H); }
      ctx.closePath();
      break;
    }
  }
}

export function drawTransition(ctx: CanvasRenderingContext2D, from: string, to: string, p: number, tp: TransParams, rc: RenderCtx) {
  const W = rc.W, H = rc.H;
  p = Math.max(0, Math.min(1, p));
  switch (tp.style) {
    case 'mix':
      drawInput(ctx, from, rc); ctx.globalAlpha = p; drawInput(ctx, to, rc); ctx.globalAlpha = 1; return;
    case 'dip':
      if (p < 0.5) { drawInput(ctx, from, rc); ctx.globalAlpha = p * 2; } else { drawInput(ctx, to, rc); ctx.globalAlpha = (1 - p) * 2; }
      ctx.fillStyle = tp.dipColor; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; return;
    case 'wipe':
      drawInput(ctx, from, rc);
      ctx.save(); wipePath(ctx, tp, p, W, H);
      if (tp.border > 0 && p > 0 && p < 1) { ctx.lineWidth = tp.border * W * 2; ctx.strokeStyle = tp.borderColor; ctx.stroke(); }
      ctx.clip(); drawInput(ctx, to, rc); ctx.restore();
      if (tp.border > 0 && p > 0 && p < 1) { ctx.save(); wipePath(ctx, tp, p, W, H); ctx.lineWidth = tp.border * W; ctx.strokeStyle = tp.borderColor; ctx.stroke(); ctx.restore(); }
      return;
    case 'dve': {
      const dx = tp.dveDir === 'left' ? -1 : tp.dveDir === 'right' ? 1 : 0, dy = tp.dveDir === 'up' ? -1 : tp.dveDir === 'down' ? 1 : 0;
      ctx.save(); ctx.translate(dx * W * p, dy * H * p); drawInput(ctx, from, rc); ctx.restore();
      ctx.save(); ctx.translate(-dx * W * (1 - p), -dy * H * (1 - p)); drawInput(ctx, to, rc); ctx.restore();
      return;
    }
  }
}

/** background at time T: the shot, or a transition into it */
export function drawBackground(ctx: CanvasRenderingContext2D, T: number, segs: Segment[], rc: RenderCtx): boolean {
  const i = segs.findIndex((x) => T >= x.start && T < x.end);
  const seg = segs[i] ?? segs[segs.length - 1];
  const id = seg?.cam ?? rc.fallback; if (!id) return false;
  const prev = i > 0 ? segs[i - 1] : null;
  rc = { ...rc, time: T, onAir: { ...(prev ? { [prev.cam]: prev.start } : {}), ...(seg ? { [seg.cam]: seg.start } : {}) } };
  const tp: TransParams | null = seg?.trans ?? (seg?.mix ? { style: 'mix', dur: seg.mix, dipColor: '#000', wipe: 'h', reverse: false, border: 0, borderColor: '#fff', dveDir: 'left' } : null);
  if (seg && tp && prev && T < seg.start + tp.dur) {
    if (!inputReady(prev.cam, rc) || !inputReady(id, rc)) return false;
    drawTransition(ctx, prev.cam, id, (T - seg.start) / tp.dur, tp, rc);
    return true;
  }
  if (!inputReady(id, rc)) return false; // keep the last picture while a camera seeks
  drawInput(ctx, id, rc);
  return true;
}

// ---------- keyers ----------
const work = new Map<string, HTMLCanvasElement>();
function scratch(name: string, W: number, H: number) {
  let c = work.get(name); if (!c) { c = document.createElement('canvas'); work.set(name, c); }
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  return c;
}
const hex = (h: string) => { const n = parseInt(h.replace('#', '').padEnd(6, '0').slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/** fill input with a luma or chroma key applied, at a reduced resolution for speed */
function keyedLayer(fill: string, keySrc: string, mode: 'luma' | 'chroma', k: { clip: number; gain: number; invert: boolean; chroma?: KeyConfig['chroma'] }, rc: RenderCtx) {
  const s = Math.min(1, 960 / rc.W); const w = Math.max(2, Math.round(rc.W * s)), h = Math.max(2, Math.round(rc.H * s));
  const sub: RenderCtx = { ...rc, W: w, H: h };
  const fc = scratch('fill', w, h); const fctx = fc.getContext('2d', { willReadFrequently: true })!;
  drawInput(fctx, fill, sub);
  const img = fctx.getImageData(0, 0, w, h); const d = img.data;
  let kd = d;
  if (mode === 'luma' && keySrc !== fill) { const kc = scratch('key', w, h); const kctx = kc.getContext('2d', { willReadFrequently: true })!; drawInput(kctx, keySrc, sub); kd = kctx.getImageData(0, 0, w, h).data; }
  const soft = Math.max(0.004, (1 - k.gain) * 0.5);
  if (mode === 'luma') {
    for (let i = 0; i < d.length; i += 4) {
      const l = (0.2126 * kd[i] + 0.7152 * kd[i + 1] + 0.0722 * kd[i + 2]) / 255;
      let a = Math.max(0, Math.min(1, (l - k.clip) / soft)); if (k.invert) a = 1 - a;
      d[i + 3] = Math.round(d[i + 3] * a);
    }
  } else {
    const c = k.chroma!; const [kr, kg, kb] = hex(c.color);
    const kcb = -0.1146 * kr - 0.3854 * kg + 0.5 * kb, kcr = 0.5 * kr - 0.4542 * kg - 0.0458 * kb;
    const kn = Math.hypot(kcb, kcr) || 1;
    const green = kg >= kr && kg >= kb;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const cb = -0.1146 * r - 0.3854 * g + 0.5 * b, cr = 0.5 * r - 0.4542 * g - 0.0458 * b;
      const dist = Math.hypot(cb - kcb, cr - kcr) / (kn * 2);
      let a = Math.max(0, Math.min(1, (dist - c.tol) / Math.max(0.005, c.soft)));
      if (k.invert) a = 1 - a;
      d[i + 3] = Math.round(d[i + 3] * a);
      // spill: pull the key colour out of the edges
      if (c.spill > 0) {
        if (green) { const lim = Math.max(r, b); if (g > lim) d[i + 1] = Math.round(g - (g - lim) * c.spill); }
        else { const lim = Math.max(r, g); if (b > lim) d[i + 2] = Math.round(b - (b - lim) * c.spill); }
      }
    }
  }
  fctx.putImageData(img, 0, 0);
  return fc;
}

export function drawKey(ctx: CanvasRenderingContext2D, k: KeyConfig, alpha: number, rc: RenderCtx) {
  if (alpha <= 0) return;
  const W = rc.W, H = rc.H;
  ctx.save(); ctx.globalAlpha = alpha;
  if (k.type === 'dve') {
    const b = k.dve; const x = b.x * W, y = b.y * H, w = b.w * W, h = b.h * H;
    const v = isVirtual(k.fill) ? null : rc.splits.some((s) => s.id === k.fill) ? null : rc.video(k.fill);
    if (v && ready(v)) drawSource(ctx, v, x, y, w, h, 'cover', b.crop);
    else { const c = scratch('dve', Math.max(2, Math.round(w)), Math.max(2, Math.round(h))); const cx = c.getContext('2d')!; drawInput(cx, k.fill, { ...rc, W: c.width, H: c.height }); ctx.drawImage(c, x, y, w, h); }
    if (b.border > 0) { const lw = b.border * W; ctx.lineWidth = lw; ctx.strokeStyle = b.borderColor; ctx.strokeRect(x - lw / 2, y - lw / 2, w + lw, h + lw); }
  } else if (k.type === 'pattern') {
    const p = k.pattern; const cx = p.x * W, cy = p.y * H, r = (p.size * Math.min(W, H)) / 2;
    ctx.beginPath();
    if (p.invert) ctx.rect(0, 0, W, H);
    if (p.shape === 'circle') ctx.arc(cx, cy, r, 0, Math.PI * 2);
    else if (p.shape === 'rect') ctx.rect(cx - r * 1.6, cy - r, r * 3.2, r * 2);
    else { ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath(); }
    ctx.clip('evenodd');
    if (inputReady(k.fill, rc)) drawInput(ctx, k.fill, rc);
  } else if (inputReady(k.fill, rc) && (k.type !== 'luma' || inputReady(k.keySrc, rc))) {
    const layer = keyedLayer(k.fill, k.keySrc, k.type, k, rc);
    ctx.drawImage(layer, 0, 0, W, H);
  }
  ctx.restore();
}

export function drawDsk(ctx: CanvasRenderingContext2D, d: DskConfig, alpha: number, rc: RenderCtx) {
  if (alpha <= 0) return;
  ctx.save(); ctx.globalAlpha = alpha;
  const img = d.fill === 'mp1' || d.fill === 'mp2' ? rc.image(d.fill) : undefined;
  if (d.keySrc === 'alpha' && img) drawSource(ctx, img, 0, 0, rc.W, rc.H, 'contain');
  else if (d.keySrc === 'luma' && inputReady(d.fill, rc)) ctx.drawImage(keyedLayer(d.fill, d.fill, 'luma', d, rc), 0, 0, rc.W, rc.H);
  else if (inputReady(d.fill, rc)) drawInput(ctx, d.fill, rc);
  ctx.restore();
}

/** 0..1 opacity of an overlay at time T (fades in at its start, out at its end) */
export function overlayAlpha(o: Overlay, T: number) {
  if (T < o.start || T >= o.end) return 0;
  let a = 1;
  if (o.fadeIn > 0) a = Math.min(a, (T - o.start) / o.fadeIn);
  if (o.fadeOut > 0) a = Math.min(a, (o.end - T) / o.fadeOut);
  return Math.max(0, Math.min(1, a));
}

export function drawOverlays(ctx: CanvasRenderingContext2D, T: number, overlays: Overlay[], rc: RenderCtx, live?: { usk?: KeyConfig | null; dsk?: (DskConfig | null)[] }) {
  for (const o of overlays) if (o.kind === 'usk' && o.key) drawKey(ctx, live?.usk && T >= o.start && T < o.end ? live.usk : o.key, overlayAlpha(o, T), rc);
  for (const slot of [1, 2]) for (const o of overlays) if (o.kind === 'dsk' && o.slot === slot && o.dsk) drawDsk(ctx, o.dsk, overlayAlpha(o, T), rc);
  for (const o of overlays) if (o.kind === 'ftb') { const a = overlayAlpha(o, T); if (a > 0) { ctx.globalAlpha = a; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, rc.W, rc.H); ctx.globalAlpha = 1; } }
}

/** the whole program picture at time T */
export function drawProgramAt(ctx: CanvasRenderingContext2D, T: number, segs: Segment[], overlays: Overlay[], rc: RenderCtx, live?: { from: string; to: string; p: number; tp: TransParams } | null) {
  rc = { ...rc, time: T };
  if (live) { if (!inputReady(live.from, rc) || !inputReady(live.to, rc)) return; drawTransition(ctx, live.from, live.to, live.p, live.tp, rc); }
  else if (!drawBackground(ctx, T, segs, rc)) return;
  drawOverlays(ctx, T, overlays, rc);
}
