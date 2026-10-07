// Animated GIF encoder (median-cut palette per frame, optional Floyd–Steinberg dithering, LZW),
// running in a Web Worker. Everything inside gifKernel() must stay self-contained.
function gifKernel() {
  function medianCut(data: Uint8ClampedArray, maxColors: number): number[][] {
    // sample pixels (opaque only)
    const step = Math.max(1, Math.floor(data.length / 4 / 60000));
    const px: number[][] = [];
    for (let i = 0; i < data.length; i += 4 * step) if (data[i + 3] >= 128) px.push([data[i], data[i + 1], data[i + 2]]);
    if (!px.length) return [[0, 0, 0]];
    let boxes: number[][][] = [px];
    while (boxes.length < maxColors) {
      // split the box with the largest range
      let bi = -1, best = -1, ch = 0;
      for (let b = 0; b < boxes.length; b++) {
        const box = boxes[b]; if (box.length < 2) continue;
        for (let c = 0; c < 3; c++) {
          let lo = 255, hi = 0; for (const p of box) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; }
          const r = (hi - lo) * Math.sqrt(box.length);
          if (r > best) { best = r; bi = b; ch = c; }
        }
      }
      if (bi < 0 || best <= 0) break;
      const box = boxes[bi].sort((a, b) => a[ch] - b[ch]);
      const mid = box.length >> 1;
      boxes = [...boxes.slice(0, bi), box.slice(0, mid), box.slice(mid), ...boxes.slice(bi + 1)];
    }
    return boxes.map((box) => { const s = [0, 0, 0]; for (const p of box) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; } return s.map((v) => Math.round(v / box.length)); });
  }

  function lzw(indices: Uint8Array, minCode: number): number[] {
    const out: number[] = [];
    let cur = 0, curBits = 0;
    const emit = (code: number, size: number) => { cur |= code << curBits; curBits += size; while (curBits >= 8) { out.push(cur & 0xff); cur >>>= 8; curBits -= 8; } };
    const clear = 1 << minCode, eoi = clear + 1;
    let size = minCode + 1, next = eoi + 1;
    let dict = new Map<number, number>();
    emit(clear, size);
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = (prefix << 8) | k;
      const found = dict.get(key);
      if (found !== undefined) { prefix = found; continue; }
      emit(prefix, size);
      if (next < 4096) { dict.set(key, next++); if (next > (1 << size) && size < 12) size++; }
      else { emit(clear, size); dict = new Map(); size = minCode + 1; next = eoi + 1; }
      prefix = k;
    }
    emit(prefix, size); emit(eoi, size);
    if (curBits > 0) out.push(cur & 0xff);
    return out;
  }

  function frame(data: Uint8ClampedArray, w: number, h: number, delayCs: number, dither: boolean, first: boolean, loop: boolean): Uint8Array {
    const hasAlpha = (() => { for (let i = 3; i < data.length; i += 16) if (data[i] < 128) return true; return false; })();
    const pal = medianCut(data, hasAlpha ? 255 : 256);
    const transIndex = hasAlpha ? pal.length : -1;
    if (hasAlpha) pal.push([0, 0, 0]);
    let bits = 1; while ((1 << bits) < pal.length) bits++;
    const tableSize = 1 << bits;
    const cache = new Int16Array(32768).fill(-1);
    const nearest = (r: number, g: number, b: number) => {
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      const hit = cache[key]; if (hit >= 0) return hit;
      let bi = 0, bd = Infinity;
      for (let i = 0; i < pal.length; i++) { if (i === transIndex) continue; const p = pal[i]; const d = (p[0] - r) ** 2 * 2 + (p[1] - g) ** 2 * 3 + (p[2] - b) ** 2; if (d < bd) { bd = d; bi = i; } }
      cache[key] = bi; return bi;
    };
    const idx = new Uint8Array(w * h);
    const work = dither ? new Float32Array(w * h * 3) : null;
    if (work) for (let i = 0, j = 0; i < data.length; i += 4, j += 3) { work[j] = data[i]; work[j + 1] = data[i + 1]; work[j + 2] = data[i + 2]; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (data[i * 4 + 3] < 128) { idx[i] = transIndex; continue; }
      if (work) {
        const r = Math.max(0, Math.min(255, work[i * 3])), g = Math.max(0, Math.min(255, work[i * 3 + 1])), b = Math.max(0, Math.min(255, work[i * 3 + 2]));
        const n = nearest(r, g, b); idx[i] = n; const p = pal[n];
        const er = r - p[0], eg = g - p[1], eb = b - p[2];
        const spread = (dx: number, dy: number, f: number) => { const xx = x + dx, yy = y + dy; if (xx < 0 || xx >= w || yy >= h) return; const k = (yy * w + xx) * 3; work[k] += er * f; work[k + 1] += eg * f; work[k + 2] += eb * f; };
        spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
      } else idx[i] = nearest(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    }
    const out: number[] = [];
    if (first) {
      out.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, w & 0xff, w >> 8, h & 0xff, h >> 8, 0x70, 0, 0);
      if (loop) out.push(0x21, 0xff, 0x0b, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 0x03, 0x01, 0, 0, 0);
    }
    // graphic control: disposal 2 (restore to background) when transparent so frames don't pile up
    out.push(0x21, 0xf9, 0x04, (hasAlpha ? 2 << 2 : 1 << 2) | (hasAlpha ? 1 : 0), delayCs & 0xff, delayCs >> 8, hasAlpha ? transIndex : 0, 0);
    out.push(0x2c, 0, 0, 0, 0, w & 0xff, w >> 8, h & 0xff, h >> 8, 0x80 | (bits - 1));
    for (let i = 0; i < tableSize; i++) { const p = pal[i] ?? [0, 0, 0]; out.push(p[0], p[1], p[2]); }
    const minCode = Math.max(2, bits);
    out.push(minCode);
    const codes = lzw(idx, minCode);
    for (let i = 0; i < codes.length; i += 255) { const n = Math.min(255, codes.length - i); out.push(n, ...codes.slice(i, i + n)); }
    out.push(0);
    return new Uint8Array(out);
  }
  return { frame };
}

export class GifEncoder {
  private worker: Worker | null = null;
  private kernel: ReturnType<typeof gifKernel> | null = null;
  private chunks: Uint8Array[] = [];
  private pending = new Map<number, (b: Uint8Array) => void>();
  private seq = 0;
  private first = true;

  constructor(private w: number, private h: number, private loop = true, private dither = true) {
    try {
      const src = `const K=(${gifKernel.toString()})();self.onmessage=(e)=>{const m=e.data;const b=K.frame(new Uint8ClampedArray(m.buf),m.w,m.h,m.delay,m.dither,m.first,m.loop);self.postMessage({id:m.id,buf:b.buffer},[b.buffer]);};`;
      this.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      this.worker.onmessage = (e) => { const r = this.pending.get(e.data.id); this.pending.delete(e.data.id); r?.(new Uint8Array(e.data.buf)); };
    } catch { this.kernel = gifKernel(); }
  }

  async addFrame(data: Uint8ClampedArray, delaySeconds: number) {
    const delay = Math.max(2, Math.round(delaySeconds * 100));
    const first = this.first; this.first = false;
    let bytes: Uint8Array;
    if (this.worker) {
      const id = ++this.seq;
      const copy = new Uint8ClampedArray(data);
      bytes = await new Promise<Uint8Array>((res) => { this.pending.set(id, res); this.worker!.postMessage({ id, buf: copy.buffer, w: this.w, h: this.h, delay, dither: this.dither, first, loop: this.loop }, [copy.buffer]); });
    } else bytes = this.kernel!.frame(data, this.w, this.h, delay, this.dither, first, this.loop);
    this.chunks.push(bytes);
  }

  finish(): Blob {
    this.worker?.terminate();
    return new Blob([...this.chunks, new Uint8Array([0x3b])] as BlobPart[], { type: 'image/gif' });
  }
}
