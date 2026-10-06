/**
 * Minimal baseline TIFF decoder: 8-bit (and 16-bit) gray / RGB / RGBA / palette,
 * strips or tiles, compression none / PackBits / LZW / Deflate. Returns the first image.
 */
export async function decodeTiff(buf: ArrayBuffer): Promise<ImageData> {
  const dv = new DataView(buf);
  const le = dv.getUint16(0) === 0x4949;
  if (!le && dv.getUint16(0) !== 0x4d4d) throw new Error('Not a TIFF file');
  const u16 = (o: number) => dv.getUint16(o, le), u32 = (o: number) => dv.getUint32(o, le);
  if (u16(2) !== 42) throw new Error('Unsupported TIFF variant (BigTIFF)');
  const ifd = u32(4);
  const n = u16(ifd);
  const tags = new Map<number, number[]>();
  const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    const size = (TYPE_SIZE[type] || 1) * count;
    const off = size <= 4 ? e + 8 : u32(e + 8);
    const vals: number[] = [];
    for (let k = 0; k < Math.min(count, 1 << 20); k++) {
      if (type === 3) vals.push(u16(off + k * 2));
      else if (type === 4) vals.push(u32(off + k * 4));
      else if (type === 5) vals.push(u32(off + k * 8) / (u32(off + k * 8 + 4) || 1));
      else vals.push(dv.getUint8(off + k));
    }
    tags.set(tag, vals);
  }
  const g = (t: number, d?: number) => tags.get(t)?.[0] ?? d;
  const width = g(256)!, height = g(257)!;
  const bps = tags.get(258)?.[0] ?? 1;
  const compression = g(259, 1)!;
  const photometric = g(262, 2)!;
  const spp = g(277, 1)!;
  const planar = g(284, 1)!;
  const predictor = g(317, 1)!;
  const extra = tags.get(338)?.[0];
  if (bps !== 8 && bps !== 16) throw new Error(`Unsupported TIFF bit depth (${bps})`);
  if (planar !== 1) throw new Error('Planar TIFF files are not supported');
  const bpp = (bps / 8) * spp;
  const tiled = tags.has(322);
  const offsets = tiled ? tags.get(324)! : tags.get(273)!;
  const counts = tiled ? tags.get(325)! : tags.get(279)!;
  const tileW = tiled ? g(322)! : width;
  const tileH = tiled ? g(323)! : g(278, height)!;
  const raw = new Uint8Array(width * height * bpp);
  const tilesAcross = Math.ceil(width / tileW);

  for (let s = 0; s < offsets.length; s++) {
    const chunk = new Uint8Array(buf, offsets[s], counts[s]);
    let data: Uint8Array;
    if (compression === 1) data = chunk;
    else if (compression === 32773) data = packBits(chunk, tileW * tileH * bpp);
    else if (compression === 5) data = lzw(chunk, tileW * tileH * bpp);
    else if (compression === 8 || compression === 32946) data = await inflate(chunk);
    else throw new Error(`Unsupported TIFF compression (${compression})`);
    const rowBytes = tileW * bpp;
    if (predictor === 2 && bps === 8) for (let r = 0; r < tileH; r++) for (let x = bpp; x < rowBytes; x++) data[r * rowBytes + x] = (data[r * rowBytes + x] + data[r * rowBytes + x - bpp]) & 255;
    const tx = tiled ? (s % tilesAcross) * tileW : 0, ty = tiled ? Math.floor(s / tilesAcross) * tileH : s * tileH;
    for (let r = 0; r < tileH; r++) {
      const y = ty + r; if (y >= height) break;
      const cols = Math.min(tileW, width - tx);
      raw.set(data.subarray(r * rowBytes, r * rowBytes + cols * bpp), (y * width + tx) * bpp);
    }
  }
  const out = new ImageData(width, height); const d = out.data;
  const palette = tags.get(320);
  const read = (i: number) => (bps === 16 ? (le ? raw[i * 2 + 1] : raw[i * 2]) : raw[i]);
  const hasAlpha = spp >= 4 || (spp === 2) || extra !== undefined;
  for (let p = 0; p < width * height; p++) {
    const b = p * spp;
    let r: number, gg: number, bb: number, a = 255;
    if (photometric === 2) { r = read(b); gg = read(b + 1); bb = read(b + 2); if (hasAlpha && spp > 3) a = read(b + 3); }
    else if (photometric === 3 && palette) { const idx = raw[b]; const c = palette.length / 3; r = palette[idx] >> 8; gg = palette[c + idx] >> 8; bb = palette[2 * c + idx] >> 8; }
    else { let v = read(b); if (photometric === 0) v = 255 - v; r = gg = bb = v; if (spp === 2) a = read(b + 1); }
    if (extra === 1 && a > 0 && a < 255) { r = (r * 255) / a; gg = (gg * 255) / a; bb = (bb * 255) / a; }
    d[p * 4] = r; d[p * 4 + 1] = gg; d[p * 4 + 2] = bb; d[p * 4 + 3] = a;
  }
  return out;
}

function packBits(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected); let i = 0, o = 0;
  while (i < src.length && o < expected) {
    const n = (src[i++] << 24) >> 24;
    if (n >= 0) { for (let k = 0; k <= n && o < expected; k++) out[o++] = src[i++]; }
    else if (n !== -128) { const v = src[i++]; for (let k = 0; k < 1 - n && o < expected; k++) out[o++] = v; }
  }
  return out;
}

function lzw(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected); let o = 0;
  let dict: number[][] = [];
  const reset = () => { dict = []; for (let i = 0; i < 256; i++) dict.push([i]); dict.push([], []); };
  reset();
  let bitPos = 0, codeLen = 9, prev: number[] | null = null;
  const readCode = () => {
    let code = 0;
    for (let i = 0; i < codeLen; i++) { const byte = src[(bitPos + i) >> 3] ?? 0; code = (code << 1) | ((byte >> (7 - ((bitPos + i) & 7))) & 1); }
    bitPos += codeLen; return code;
  };
  while (bitPos + codeLen <= src.length * 8 && o < expected) {
    const code = readCode();
    if (code === 257) break;
    if (code === 256) { reset(); codeLen = 9; prev = null; continue; }
    let entry: number[];
    if (code < dict.length) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else break;
    for (const v of entry) { if (o < expected) out[o++] = v; }
    if (prev) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length + 1 >= 1 << codeLen && codeLen < 12) codeLen++;
  }
  return out;
}

async function inflate(src: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('Deflate-compressed TIFF is not supported in this browser');
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([src as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
