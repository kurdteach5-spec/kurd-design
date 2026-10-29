// Split-screen layouts ("windows") like TV news channels: 1–18 windows in many arrangements — equal grids,
// a big presenter, two presenters, a big report in the middle, mosaics, L-shapes, picture in picture…
// Every box is a fraction (0–1) of the area you choose on the 1920×1080 screen, so they never leave it.

export type Role = 'host' | 'main' | 'guest';
export interface Box {
  x: number; y: number; w: number; h: number; role: Role;
  /** drawn over the others (picture in picture) */
  float?: boolean;
  /** 'slant': the inner edges lean (like many Arabic and Turkish news channels); 'circle': a round window */
  shape?: 'slant' | 'circle';
  /** keeps a 16:9 window inside its place (the background shows around it) */
  fit?: boolean;
}
export interface Layout { id: string; n: number; family: string; name: string; boxes: Box[] }

const B = (x: number, y: number, w: number, h: number, role: Role = 'guest', float = false): Box => ({ x, y, w, h, role, ...(float ? { float } : {}) });
const withShape = (boxes: Box[], shape: Box['shape']) => boxes.map((b) => ({ ...b, shape }));
const fitted = (boxes: Box[]) => boxes.map((b) => ({ ...b, fit: true }));

/** rows × cols, all equal */
function grid(r: number, c: number, x = 0, y = 0, w = 1, h = 1, role: Role = 'guest'): Box[] {
  const out: Box[] = [];
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) out.push(B(x + (j * w) / c, y + (i * h) / r, w / c, h / r, role));
  return out;
}
/** k boxes in a w×h region: the number of rows that keeps the boxes closest to 16:9; uneven last rows
 *  are either stretched to the full width or centred with the same box width */
function fill(k: number, x: number, y: number, w: number, h: number, mode: 'stretch' | 'center' = 'stretch', aspect = 16 / 9, role: Role = 'guest'): Box[] {
  if (k <= 0) return [];
  let best = { r: 1, score: Infinity };
  for (let r = 1; r <= k; r++) {
    const c = Math.ceil(k / r);
    const cell = ((w * aspect) / c) / (h / r);
    const waste = (r * c - k) * 0.35;
    const score = Math.abs(Math.log(cell / (16 / 9))) + waste;
    if (score < best.score) best = { r, score };
  }
  const r = best.r, c = Math.ceil(k / r);
  const counts = Array.from({ length: r }, (_, i) => Math.floor(k / r) + (i < k % r ? 1 : 0));
  const out: Box[] = [];
  counts.forEach((cnt, i) => {
    const bw = mode === 'stretch' ? w / cnt : w / c;
    const x0 = mode === 'stretch' ? x : x + (w - bw * cnt) / 2;
    for (let j = 0; j < cnt; j++) out.push(B(x0 + j * bw, y + (i * h) / r, bw, h / r, role));
  });
  return out;
}
/** k boxes in exactly r rows */
function rows(k: number, r: number, x: number, y: number, w: number, h: number, mode: 'stretch' | 'center' = 'stretch', role: Role = 'guest'): Box[] {
  const counts = Array.from({ length: r }, (_, i) => Math.floor(k / r) + (i < k % r ? 1 : 0)).filter((c) => c > 0);
  const c = Math.max(...counts); const out: Box[] = [];
  counts.forEach((cnt, i) => {
    const bw = mode === 'stretch' ? w / cnt : w / c; const x0 = mode === 'stretch' ? x : x + (w - bw * cnt) / 2;
    for (let j = 0; j < cnt; j++) out.push(B(x0 + j * bw, y + (i * h) / counts.length, bw, h / counts.length, role));
  });
  return out;
}
const row = (k: number, x: number, y: number, w: number, h: number, role: Role = 'guest') => grid(1, k, x, y, w, h, role);
const col = (k: number, x: number, y: number, w: number, h: number, role: Role = 'guest') => grid(k, 1, x, y, w, h, role);

function build(): Layout[] {
  const all: Layout[] = [];
  const add = (family: string, name: string, boxes: Box[]) => { if (boxes.length) all.push({ id: '', n: boxes.length, family, name, boxes }); };

  add('Full', 'One window', [B(0, 0, 1, 1, 'main')]);
  for (let n = 2; n <= 18; n++) {
    // equal
    add('Grid', 'Equal grid', fill(n, 0, 0, 1, 1, 'stretch'));
    add('Grid', 'Equal, centred', fill(n, 0, 0, 1, 1, 'center'));
    if (n <= 8) add('Columns', 'Side by side', row(n, 0, 0, 1, 1));
    if (n <= 6) add('Rows', 'Stacked', col(n, 0, 0, 1, 1));
    if (n >= 4 && n % 2 === 0 && n <= 16) add('Columns', 'Two rows', grid(2, n / 2));
    if (n >= 6 && n % 3 === 0) add('Grid', 'Three rows', grid(3, n / 3));
    // a big presenter on one side, the rest next to them
    for (const f of [0.5, 0.62]) {
      add('Big presenter', f > 0.6 ? 'Big presenter left, wide' : 'Big presenter left', [B(0, 0, f, 1, 'host'), ...fill(n - 1, f, 0, 1 - f, 1, 'stretch')]);
      add('Big presenter', f > 0.6 ? 'Big presenter right, wide' : 'Big presenter right', [...fill(n - 1, 0, 0, 1 - f, 1, 'stretch'), B(1 - f, 0, f, 1, 'host')]);
    }
    if (n <= 6) add('Big presenter', 'Presenter left, guests in a column', [B(0, 0, 0.66, 1, 'host'), ...col(n - 1, 0.66, 0, 0.34, 1)]);
    // big on top (report), the rest in a strip
    if (n <= 9) add('Big report', 'Big on top, strip below', [B(0, 0, 1, 0.66, 'main'), ...row(n - 1, 0, 0.66, 1, 0.34)]);
    if (n >= 4) add('Big report', 'Big on top, two strips', [B(0, 0, 1, 0.56, 'main'), ...fill(n - 1, 0, 0.56, 1, 0.44, 'stretch', 16 / 9 * 2)]);
    if (n <= 9) add('Big report', 'Strip on top, big below', [...row(n - 1, 0, 0, 1, 0.3), B(0, 0.3, 1, 0.7, 'main')]);
    // centre stage: the report in the middle, people on both sides (like AVA)
    if (n >= 3 && n <= 13) {
      const left = Math.ceil((n - 1) / 2), right = n - 1 - left;
      add('Centre stage', 'Report in the middle', [...col(left, 0, 0, 0.25, 1, left === 1 ? 'host' : 'guest'), B(0.25, 0, 0.5, 1, 'main'), ...col(right, 0.75, 0, 0.25, 1)]);
      if (left <= 6) add('Centre stage', 'Narrow sides, wide middle', [...col(left, 0, 0, 0.19, 1, left === 1 ? 'host' : 'guest'), B(0.19, 0, 0.62, 1, 'main'), ...col(right, 0.81, 0, 0.19, 1)]);
    }
    if (n >= 3 && n <= 10) add('Centre stage', 'Presenter, report, guests', [B(0, 0, 0.19, 1, 'host'), B(0.19, 0, 0.43, 1, 'main'), ...row(n - 2, 0.62, 0, 0.38, 1)]);
    if (n >= 4 && n <= 12) add('Centre stage', 'Presenter, report, guest grid', [B(0, 0, 0.22, 1, 'host'), B(0.22, 0, 0.45, 1, 'main'), ...fill(n - 2, 0.67, 0, 0.33, 1, 'stretch')]);
    // two presenters
    if (n >= 3) add('Two presenters', 'Presenters on both sides', [B(0, 0, 0.25, 1, 'host'), ...fill(n - 2, 0.25, 0, 0.5, 1, 'stretch'), B(0.75, 0, 0.25, 1, 'host')]);
    if (n >= 4) add('Two presenters', 'Presenters on top, guests below', [B(0, 0, 0.5, 0.55, 'host'), B(0.5, 0, 0.5, 0.55, 'host'), ...fill(n - 2, 0, 0.55, 1, 0.45, 'stretch', 16 / 9 * 1.6)]);
    if (n >= 3) add('Two presenters', 'Presenters left, guests right', [B(0, 0, 0.4, 0.5, 'host'), B(0, 0.5, 0.4, 0.5, 'host'), ...fill(n - 2, 0.4, 0, 0.6, 1, 'stretch')]);
    if (n >= 4 && n <= 10) add('Two presenters', 'Presenters, report, guests', [B(0, 0, 0.3, 0.5, 'host'), B(0, 0.5, 0.3, 0.5, 'host'), B(0.3, 0, 0.45, 1, 'main'), ...col(n - 3, 0.75, 0, 0.25, 1)]);
    // more for many windows
    for (const r of [2, 3, 4, 5]) if (n >= r * 2 && n <= r * 8) { add('Grid', `${r} rows`, rows(n, r, 0, 0, 1, 1, 'stretch')); add('Grid', `${r} rows, centred`, rows(n, r, 0, 0, 1, 1, 'center')); }
    if (n >= 5) {
      const left = Math.ceil((n - 1) / 2), right = n - 1 - left;
      add('Centre stage', 'Report in the middle, grids on the sides', [...fill(left, 0, 0, 0.27, 1, 'stretch', 16 / 9 * 0.27 / 0.5), B(0.27, 0, 0.46, 1, 'main'), ...fill(right, 0.73, 0, 0.27, 1, 'stretch', 16 / 9 * 0.27 / 0.5)]);
      add('Centre stage', 'Presenter in the middle, guests around', [...fill(left, 0, 0, 0.3, 1, 'stretch', 16 / 9 * 0.3 / 0.5), B(0.3, 0, 0.4, 1, 'host'), ...fill(right, 0.7, 0, 0.3, 1, 'stretch', 16 / 9 * 0.3 / 0.5)]);
    }
    if (n >= 4) add('Big report', 'Presenter and report, guests below', [B(0, 0, 0.35, 0.6, 'host'), B(0.35, 0, 0.65, 0.6, 'main'), ...fill(n - 2, 0, 0.6, 1, 0.4, 'stretch', 16 / 9 * 2.5)]);
    if (n >= 4) add('Big report', 'Presenter, report and guest grid', [B(0, 0, 0.25, 1, 'host'), B(0.25, 0, 0.4, 1, 'main'), ...fill(n - 2, 0.65, 0, 0.35, 1, 'stretch', 16 / 9 * 0.35)]);
    if (n >= 5) add('Two presenters', 'Two big in the middle, guests on the sides', [...fill(Math.ceil((n - 2) / 2), 0, 0, 0.22, 1, 'stretch', 16 / 9 * 0.22 / 0.5), B(0.22, 0, 0.28, 1, 'host'), B(0.5, 0, 0.28, 1, 'host'), ...fill(Math.floor((n - 2) / 2), 0.78, 0, 0.22, 1, 'stretch', 16 / 9 * 0.22 / 0.5)]);
    if (n >= 5) add('Grid', 'Big first row', [...row(Math.min(3, n - 2), 0, 0, 1, 0.5, 'host'), ...fill(n - Math.min(3, n - 2), 0, 0.5, 1, 0.5, 'stretch', 16 / 9 * 2)]);
    if (n >= 6) add('Big presenter', 'Big presenter, guests on three sides', (() => {
      const k = n - 1; const top = Math.ceil(k / 3), right = Math.ceil((k - top) / 2), bottom = k - top - right;
      return [...row(top, 0, 0, 0.75, 0.22), B(0, 0.22, 0.75, 0.56, 'host'), ...col(right, 0.75, 0, 0.25, 1), ...row(bottom, 0, 0.78, 0.75, 0.22)];
    })());
    // picture in picture
    if (n <= 5) {
      const s = Math.min(0.26, (0.94 - (n - 2) * 0.02) / (n - 1));
      const insets = Array.from({ length: n - 1 }, (_, i) => B(1 - 0.03 - s - i * (s + 0.02), 1 - 0.05 - s, s, s, 'guest', true));
      add('Picture in picture', 'Small windows on the picture', [B(0, 0, 1, 1, 'main'), ...insets]);
      if (n <= 4) add('Picture in picture', 'Small windows on the side', [B(0, 0, 1, 1, 'main'), ...Array.from({ length: n - 1 }, (_, i) => B(0.71, 0.05 + i * 0.31, 0.26, 0.27, 'guest', true))]);
    }
  }
  // mosaics: one double-size window in a grid
  for (let r = 2; r <= 5; r++) for (let c = 2; c <= 6; c++) {
    const n = r * c - 3; if (n < 3 || n > 18) continue;
    const cw = 1 / c, rh = 1 / r;
    const boxes: Box[] = [B(0, 0, cw * 2, rh * 2, 'main')];
    for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) if (!(i < 2 && j < 2)) boxes.push(B(j * cw, i * rh, cw, rh));
    add('Mosaic', `Mosaic ${c}×${r}, big top left`, boxes);
    const mid = Math.floor((c - 2) / 2);
    const b2: Box[] = [B(mid * cw, 0, cw * 2, rh * 2, 'main')];
    for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) if (!(i < 2 && j >= mid && j < mid + 2)) b2.push(B(j * cw, i * rh, cw, rh));
    if (mid > 0) add('Mosaic', `Mosaic ${c}×${r}, big in the middle`, b2);
  }
  // ideas from news channels around the world
  for (let n = 2; n <= 18; n++) {
    // 16:9 windows (DW, France 24, BBC two-ways): every window keeps the TV shape
    add('16:9 windows', '16:9 windows', fitted(fill(n, 0, 0, 1, 1, 'stretch')));
    add('16:9 windows', '16:9 windows, centred rows', fitted(fill(n, 0, 0, 1, 1, 'center')));
    if (n >= 3) add('16:9 windows', '16:9: big presenter and guests', fitted([B(0, 0, 0.58, 1, 'host'), ...fill(n - 1, 0.58, 0, 0.42, 1, 'stretch', 16 / 9 * 0.42)]));
    if (n >= 3) add('16:9 windows', '16:9: big report and guests', fitted([B(0, 0, 1, 0.62, 'main'), ...fill(n - 1, 0, 0.62, 1, 0.38, 'center', 16 / 9 / 0.38)]));
    if (n >= 4) add('16:9 windows', '16:9: two big, guests below', fitted([B(0, 0, 0.5, 0.6, 'host'), B(0.5, 0, 0.5, 0.6, 'main'), ...fill(n - 2, 0, 0.6, 1, 0.4, 'center', 16 / 9 / 0.4)]));
    // slanted windows (Al Arabiya, Sky News Arabia, TRT)
    if (n <= 5) add('Slanted', 'Slanted side by side', withShape(row(n, 0, 0, 1, 1), 'slant'));
    if (n >= 3 && n <= 5) add('Slanted', 'Slanted, big presenter', withShape([B(0, 0, 0.44, 1, 'host'), ...row(n - 1, 0.44, 0, 0.56, 1)], 'slant'));
    if (n >= 3 && n <= 5) add('Slanted', 'Slanted, report in the middle', withShape((() => { const l = Math.ceil((n - 1) / 2); const sides = (0.44 / (n - 1)); return [...row(l, 0, 0, sides * l, 1), B(sides * l, 0, 0.56, 1, 'main'), ...row(n - 1 - l, sides * l + 0.56, 0, 1 - sides * l - 0.56, 1)]; })(), 'slant'));
    if (n >= 4 && n <= 10) add('Slanted', 'Slanted top, guests below', [...withShape(row(Math.min(3, n - 2), 0, 0, 1, 0.58, 'host'), 'slant'), ...fill(n - Math.min(3, n - 2), 0, 0.58, 1, 0.42, 'stretch', 16 / 9 / 0.42)]);
    // debate: two big sides, the presenter between them (Fox, CNN debate nights)
    if (n === 3) {
      add('Debate', 'Debate: presenter in the middle', [B(0, 0, 0.36, 1), B(0.36, 0.22, 0.28, 0.78, 'host'), B(0.64, 0, 0.36, 1)]);
      add('Debate', 'Debate: presenter on top', [B(0, 0.34, 0.5, 0.66), B(0.33, 0, 0.34, 0.34, 'host'), B(0.5, 0.34, 0.5, 0.66)]);
    }
    if (n >= 4 && n <= 9) add('Debate', 'Debate: two sides and a panel', [B(0, 0, 0.36, 1), ...fill(n - 2, 0.36, 0, 0.28, 1, 'stretch', 16 / 9 * 0.28), B(0.64, 0, 0.36, 1)]);
    if (n >= 4 && n % 2 === 0 && n <= 12) add('Debate', 'Debate: two teams', [...fill(n / 2, 0, 0, 0.48, 1, 'stretch', 16 / 9 * 0.48), ...fill(n / 2, 0.52, 0, 0.48, 1, 'stretch', 16 / 9 * 0.48)]);
    // interviews with one window bigger (Sky News, BBC)
    if (n === 2) {
      add('Interview', 'Interview 60 / 40', [B(0, 0, 0.6, 1, 'host'), B(0.6, 0, 0.4, 1)]);
      add('Interview', 'Interview 40 / 60', [B(0, 0, 0.4, 1, 'host'), B(0.4, 0, 0.6, 1)]);
      add('Interview', 'Interview, guest above presenter', [B(0, 0, 1, 0.62), B(0.3, 0.62, 0.4, 0.38, 'host')]);
    }
    // the bigger middle (Al Jazeera triptych)
    if (n === 3 || n === 5) {
      const mid = n === 3 ? 0.46 : 0.34; const side = (1 - mid) / (n - 1);
      const boxes: Box[] = []; let x = 0;
      for (let i = 0; i < n; i++) { const w = i === (n - 1) / 2 ? mid : side; boxes.push(B(x, i === (n - 1) / 2 ? 0 : 0.08, w, i === (n - 1) / 2 ? 1 : 0.84, i === (n - 1) / 2 ? 'main' : 'guest')); x += w; }
      add('Triptych', n === 3 ? 'Three, bigger middle' : 'Five, bigger middle', boxes);
    }
    // newsroom wall: the report big at the top middle, people around and below (Euronews, NHK)
    if (n >= 5 && n <= 13) {
      const sides = 2, bottom = n - 1 - sides;
      add('Newsroom wall', 'Report on top, people around', [B(0, 0, 0.22, 0.62), B(0.22, 0, 0.56, 0.62, 'main'), B(0.78, 0, 0.22, 0.62), ...row(bottom, 0, 0.62, 1, 0.38)]);
    }
    // panels with a bigger top row (Euronews, Al Jazeera panels)
    if (n >= 6) add('Panel', 'Three big on top, guests below', [...row(3, 0, 0, 1, 0.5, 'host'), ...fill(n - 3, 0, 0.5, 1, 0.5, 'stretch', 16 / 9 * 2)]);
    if (n >= 8) add('Panel', 'Four big on top, guests below', [...row(4, 0, 0, 1, 0.5, 'host'), ...fill(n - 4, 0, 0.5, 1, 0.5, 'stretch', 16 / 9 * 2)]);
    if (n >= 7) add('Panel', 'Presenter and report on top, guest rows below', fitted([B(0, 0, 0.5, 0.5, 'host'), B(0.5, 0, 0.5, 0.5, 'main'), ...fill(n - 2, 0, 0.5, 1, 0.5, 'stretch', 16 / 9 * 2)]));
    if (n >= 6) add('Panel', 'Big presenter, guests in two columns', [B(0, 0, 0.5, 1, 'host'), ...rows(n - 1, Math.ceil((n - 1) / 2), 0.5, 0, 0.5, 1)]);
    if (n >= 9) add('Panel', 'Report centre, guests above and below', [...row(Math.ceil((n - 1) / 2), 0, 0, 1, 0.28), B(0.2, 0.28, 0.6, 0.44, 'main'), ...row(Math.floor((n - 1) / 2), 0, 0.72, 1, 0.28)]);
    // round windows over the picture (talk shows, YouTube shows)
    if (n >= 2 && n <= 6) {
      const k = n - 1, d = Math.min(0.3, 0.9 / k);
      add('Circles', 'Round guests on the picture', [B(0, 0, 1, 1, 'main'), ...Array.from({ length: k }, (_, i) => ({ ...B(0.5 - (k * d) / 2 + i * d + d * 0.06, 0.6, d * 0.88, 0.36, 'guest', true), shape: 'circle' as const }))]);
      add('Circles', 'Round guests at the side', [B(0, 0, 0.72, 1, 'main'), ...Array.from({ length: k }, (_, i) => ({ ...B(0.74, i / k + 0.02, 0.24, 1 / k - 0.04, 'guest'), shape: 'circle' as const }))]);
    }
    if (n >= 3 && n <= 8) add('Circles', 'Round windows in a row', withShape(row(n, 0, 0.1, 1, 0.8), 'circle'));
  }
  // two double-size windows in a grid
  for (let r = 2; r <= 5; r++) for (let c = 4; c <= 7; c++) {
    const n = r * c - 6; if (n < 4 || n > 18) continue;
    const cw = 1 / c, rh = 1 / r;
    const boxes: Box[] = [B(0, 0, cw * 2, rh * 2, 'host'), B(cw * 2, 0, cw * 2, rh * 2, 'main')];
    for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) if (!(i < 2 && j < 4)) boxes.push(B(j * cw, i * rh, cw, rh));
    add('Mosaic', `Mosaic ${c}×${r}, two big`, boxes);
  }
  // L-shape: a big window with small ones along the right and the bottom
  for (let r = 2; r <= 6; r++) for (let c = 2; c <= 7; c++) {
    const n = r + c - 1; if (n > 18) continue;
    const cw = 1 / c, rh = 1 / r;
    const boxes: Box[] = [B(0, 0, cw * (c - 1), rh * (r - 1), 'main')];
    for (let i = 0; i < r; i++) boxes.push(B(cw * (c - 1), i * rh, cw, rh));
    for (let j = 0; j < c - 1; j++) boxes.push(B(j * cw, rh * (r - 1), cw, rh));
    add('L-shape', `L-shape ${c}×${r}`, boxes);
  }
  // remove repeats, number them
  const seen = new Set<string>(); const out: Layout[] = [];
  for (const l of all) {
    const sig = l.boxes.map((b) => [b.x, b.y, b.w, b.h].map((v) => Math.round(v * 1000)).join(',') + (b.shape ?? '') + (b.fit ? 'f' : '')).sort().join('|');
    if (seen.has(sig)) continue; seen.add(sig);
    out.push({ ...l, id: `${l.n}-${out.filter((x) => x.n === l.n).length + 1}` });
  }
  return out.sort((a, b) => a.n - b.n);
}

export const LAYOUTS: Layout[] = build();
export const COUNTS = [...new Set(LAYOUTS.map((l) => l.n))].sort((a, b) => a - b);
export const FAMILIES = ['Grid', '16:9 windows', 'Columns', 'Rows', 'Big presenter', 'Big report', 'Centre stage', 'Two presenters', 'Interview', 'Debate', 'Panel', 'Slanted', 'Triptych', 'Newsroom wall', 'Circles', 'Picture in picture', 'Mosaic', 'L-shape', 'Full', 'Mine'];
