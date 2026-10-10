// Framing of each camera in the output picture — needed for vertical (Reels / TikTok / Shorts), square and
// 4:5 videos, where only part of a 16:9 camera fits. "Auto" finds where the person is: it samples frames
// across the recording and weighs skin-coloured pixels and movement (people who talk move), then centres
// on them, a little above the middle of the body so the face sits in the upper third.
import { usePod } from './store';

const W = 160, H = 90;

async function seek(v: HTMLVideoElement, t: number) {
  await new Promise<void>((r) => { const to = setTimeout(r, 3000); v.addEventListener('seeked', () => { clearTimeout(to); r(); }, { once: true }); v.currentTime = t; });
}

/** where the person is in a camera picture (0..1), or null when it can't tell */
export async function findPerson(id: string): Promise<{ x: number; y: number } | null> {
  const src = usePod.getState().sources[id]; if (!src || src.kind !== 'video') return null;
  const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = src.url;
  await new Promise<void>((r) => { if (v.readyState >= 1) r(); else { v.addEventListener('loadedmetadata', () => r(), { once: true }); setTimeout(r, 5000); } });
  const dur = Number.isFinite(v.duration) ? v.duration : src.duration; if (!dur) return null;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const col = new Float64Array(W), row = new Float64Array(H);
  let prev: Uint8ClampedArray | null = null;
  const N = 14;
  for (let k = 0; k < N; k++) {
    // pairs of frames 0.2 s apart: skin in both, movement between them
    const t = Math.min(dur - 0.3, (dur * (k + 0.5)) / N);
    for (const dt of [0, 0.2]) {
      await seek(v, t + dt);
      try { ctx.drawImage(v, 0, 0, W, H); } catch { return null; }
      const d = ctx.getImageData(0, 0, W, H).data;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4; const r = d[i], g = d[i + 1], b = d[i + 2];
        const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
        const skin = cb > 77 && cb < 127 && cr > 135 && cr < 175 && r > 60 ? 1 : 0;
        const motion = prev && dt > 0 ? Math.min(1, (Math.abs(r - prev[i]) + Math.abs(g - prev[i + 1]) + Math.abs(b - prev[i + 2])) / 90) : 0;
        const wgt = skin * 1 + motion * 0.6 + skin * motion * 2;
        col[x] += wgt; row[y] += wgt;
      }
      prev = d;
    }
    prev = null;
  }
  v.removeAttribute('src'); v.load();
  const median = (a: Float64Array) => { const tot = a.reduce((p, q) => p + q, 0); if (tot < 40) return null; let acc = 0; for (let i = 0; i < a.length; i++) { acc += a[i]; if (acc >= tot / 2) return (i + 0.5) / a.length; } return 0.5; };
  const x = median(col), y = median(row);
  if (x === null || y === null) return null;
  return { x, y: Math.max(0.3, Math.min(0.7, y + 0.08)) };
}

export async function autoFrame(ids: string[]): Promise<number> {
  let n = 0;
  for (const id of ids) {
    const p = await findPerson(id);
    if (!p) continue;
    n++;
    usePod.setState((s) => ({ framing: { ...s.framing, [id]: { x: p.x, y: p.y, zoom: s.framing[id]?.zoom ?? 1 } } }));
  }
  return n;
}

/** output formats: social media and broadcast sizes */
export const FORMATS: { id: string; label: string; w: number; h: number; group: string }[] = [
  { id: 'yt1080', label: 'YouTube · Full HD 16:9', w: 1920, h: 1080, group: '16:9' },
  { id: 'yt4k', label: 'YouTube · 4K 16:9', w: 3840, h: 2160, group: '16:9' },
  { id: 'hd720', label: 'HD 720p 16:9', w: 1280, h: 720, group: '16:9' },
  { id: 'reels', label: 'Reels · TikTok · Shorts 9:16', w: 1080, h: 1920, group: '9:16' },
  { id: 'story', label: 'Story · Status 9:16 (720p)', w: 720, h: 1280, group: '9:16' },
  { id: 'ig45', label: 'Instagram / Facebook post 4:5', w: 1080, h: 1350, group: '4:5' },
  { id: 'square', label: 'Square 1:1', w: 1080, h: 1080, group: '1:1' },
  { id: 'fb23', label: 'Vertical 2:3 (Pinterest)', w: 1000, h: 1500, group: '2:3' },
  { id: 'tv43', label: 'Classic TV 4:3', w: 1440, h: 1080, group: '4:3' },
  { id: 'cine', label: 'Cinema 21:9', w: 2560, h: 1080, group: '21:9' },
  { id: 'x169', label: 'X (Twitter) / LinkedIn 16:9', w: 1280, h: 720, group: '16:9' },
];
