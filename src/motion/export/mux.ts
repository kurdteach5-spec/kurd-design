// Container writers for WebCodecs output: MP4 (H.264 + AAC/Opus) and WebM (VP9/VP8 + Opus, alpha).
export interface MuxSample { data: Uint8Array; ts: number; /** µs */ dur: number; key: boolean; alpha?: Uint8Array }
export interface VideoTrackInfo { codec: 'avc' | 'vp9' | 'vp8'; width: number; height: number; fps: number; description?: Uint8Array; alpha?: boolean }
export interface AudioTrackInfo { codec: 'aac' | 'opus'; sampleRate: number; channels: number; description?: Uint8Array }

// ===================== MP4 =====================
class Buf {
  parts: Uint8Array[] = []; size = 0;
  u8(v: number) { this.push(new Uint8Array([v & 0xff])); }
  u16(v: number) { this.push(new Uint8Array([(v >> 8) & 0xff, v & 0xff])); }
  u24(v: number) { this.push(new Uint8Array([(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff])); }
  u32(v: number) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0); this.push(b); }
  u64(v: number) { const b = new Uint8Array(8); const d = new DataView(b.buffer); d.setUint32(0, Math.floor(v / 2 ** 32)); d.setUint32(4, v >>> 0); this.push(b); }
  str(s: string) { this.push(new TextEncoder().encode(s)); }
  push(b: Uint8Array) { this.parts.push(b); this.size += b.length; }
  bytes(): Uint8Array { const o = new Uint8Array(this.size); let p = 0; for (const x of this.parts) { o.set(x, p); p += x.length; } return o; }
}
function box(type: string, ...content: (Uint8Array | ((b: Buf) => void))[]): Uint8Array {
  const b = new Buf();
  for (const c of content) { if (c instanceof Uint8Array) b.push(c); else c(b); }
  const body = b.bytes();
  const o = new Buf(); o.u32(body.length + 8); o.str(type); o.push(body);
  return o.bytes();
}
const fullBox = (type: string, version: number, flags: number, ...content: (Uint8Array | ((b: Buf) => void))[]) => box(type, (b) => { b.u8(version); b.u24(flags); }, ...content);
const MATRIX = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000];

function esdsDescriptor(tag: number, body: Uint8Array): Uint8Array {
  const o = new Buf(); o.u8(tag);
  // 4-byte length (0x80 continuation)
  const n = body.length; o.u8(0x80 | ((n >> 21) & 0x7f)); o.u8(0x80 | ((n >> 14) & 0x7f)); o.u8(0x80 | ((n >> 7) & 0x7f)); o.u8(n & 0x7f);
  o.push(body); return o.bytes();
}

export function muxMP4(video: VideoTrackInfo, vSamples: MuxSample[], audio: AudioTrackInfo | null, aSamples: MuxSample[]): Blob {
  const VTS = 90000;
  const ftyp = box('ftyp', (b) => { b.str('isom'); b.u32(512); b.str('isom'); b.str('iso2'); b.str('avc1'); b.str('mp41'); });
  // mdat layout: all video samples, then audio samples
  const headerSize = 16; // 64-bit mdat header
  let offset = ftyp.length + headerSize;
  const vOff: number[] = [], aOff: number[] = [];
  for (const s of vSamples) { vOff.push(offset); offset += s.data.length; }
  for (const s of aSamples) { aOff.push(offset); offset += s.data.length; }
  const mdatSize = offset - ftyp.length;
  const large = offset > 0xffffffff;
  const durSec = Math.max(...vSamples.map((s) => (s.ts + s.dur) / 1e6), ...aSamples.map((s) => (s.ts + s.dur) / 1e6), 0.001);
  const durMs = Math.round(durSec * 1000);

  const stbl = (entries: Uint8Array, samples: MuxSample[], offs: number[], timescale: number, sync: boolean) => {
    const deltas = samples.map((s, i) => Math.max(1, Math.round(((samples[i + 1]?.ts ?? s.ts + s.dur) - s.ts) * timescale / 1e6)));
    // run-length stts
    const runs: [number, number][] = [];
    for (const d of deltas) { const last = runs[runs.length - 1]; if (last && last[1] === d) last[0]++; else runs.push([1, d]); }
    const parts = [
      fullBox('stsd', 0, 0, (b) => b.u32(1), entries),
      fullBox('stts', 0, 0, (b) => { b.u32(runs.length); for (const [c, d] of runs) { b.u32(c); b.u32(d); } }),
    ];
    if (sync) { const keys = samples.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean); if (keys.length < samples.length) parts.push(fullBox('stss', 0, 0, (b) => { b.u32(keys.length); keys.forEach((k) => b.u32(k)); })); }
    parts.push(fullBox('stsc', 0, 0, (b) => { b.u32(1); b.u32(1); b.u32(1); b.u32(1); }));
    parts.push(fullBox('stsz', 0, 0, (b) => { b.u32(0); b.u32(samples.length); samples.forEach((s) => b.u32(s.data.length)); }));
    parts.push(large ? fullBox('co64', 0, 0, (b) => { b.u32(offs.length); offs.forEach((o) => b.u64(o)); }) : fullBox('stco', 0, 0, (b) => { b.u32(offs.length); offs.forEach((o) => b.u32(o)); }));
    return box('stbl', ...parts);
  };
  const dinf = box('dinf', fullBox('dref', 0, 0, (b) => b.u32(1), fullBox('url ', 0, 1)));
  const tkhd = (id: number, w: number, h: number, isAudio: boolean) => fullBox('tkhd', 0, 3, (b) => {
    b.u32(0); b.u32(0); b.u32(id); b.u32(0); b.u32(durMs); b.u32(0); b.u32(0); b.u16(0); b.u16(isAudio ? 1 : 0); b.u16(isAudio ? 0x0100 : 0); b.u16(0);
    MATRIX.forEach((m) => b.u32(m)); b.u32(w * 65536); b.u32(h * 65536);
  });
  const mdhd = (ts: number, dur: number) => fullBox('mdhd', 0, 0, (b) => { b.u32(0); b.u32(0); b.u32(ts); b.u32(dur); b.u16(0x55c4); b.u16(0); });
  const hdlr = (type: string, name: string) => fullBox('hdlr', 0, 0, (b) => { b.u32(0); b.str(type); b.u32(0); b.u32(0); b.u32(0); b.str(name); b.u8(0); });

  const avc1 = box('avc1', (b) => {
    for (let i = 0; i < 6; i++) b.u8(0); b.u16(1); // data ref
    b.u16(0); b.u16(0); b.u32(0); b.u32(0); b.u32(0);
    b.u16(video.width); b.u16(video.height); b.u32(0x00480000); b.u32(0x00480000); b.u32(0); b.u16(1);
    const name = new Uint8Array(32); b.push(name); b.u16(0x18); b.u16(0xffff);
  }, box('avcC', video.description ?? new Uint8Array()));
  const vTrak = box('trak', tkhd(1, video.width, video.height, false),
    box('mdia', mdhd(VTS, Math.round(durSec * VTS)), hdlr('vide', 'KURD DESIGN Video'),
      box('minf', fullBox('vmhd', 0, 1, (b) => { b.u16(0); b.u16(0); b.u16(0); b.u16(0); }), dinf, stbl(avc1, vSamples, vOff, VTS, true))));

  let aTrak: Uint8Array | null = null;
  if (audio && aSamples.length) {
    const sr = audio.sampleRate;
    let entry: Uint8Array;
    const head = (b: Buf) => { for (let i = 0; i < 6; i++) b.u8(0); b.u16(1); b.u32(0); b.u32(0); b.u16(audio.channels); b.u16(16); b.u16(0); b.u16(0); b.u32(Math.min(65535, sr) * 65536); };
    if (audio.codec === 'aac') {
      const asc = audio.description ?? new Uint8Array([0x11, 0x90]);
      const dsi = esdsDescriptor(0x05, asc);
      const dcd = esdsDescriptor(0x04, (() => { const b = new Buf(); b.u8(0x40); b.u8(0x15); b.u24(0); b.u32(192000); b.u32(128000); b.push(dsi); return b.bytes(); })());
      const sl = esdsDescriptor(0x06, new Uint8Array([0x02]));
      const es = esdsDescriptor(0x03, (() => { const b = new Buf(); b.u16(2); b.u8(0); b.push(dcd); b.push(sl); return b.bytes(); })());
      entry = box('mp4a', head, fullBox('esds', 0, 0, es));
    } else {
      // Opus in ISO BMFF: dOps from the OpusHead fields
      const pre = audio.description && audio.description.length >= 19 ? new DataView(audio.description.buffer, audio.description.byteOffset).getUint16(10, true) : 312;
      entry = box('Opus', head, box('dOps', (b) => { b.u8(0); b.u8(audio.channels); b.u16(pre); b.u32(sr); b.u16(0); b.u8(0); }));
    }
    aTrak = box('trak', tkhd(2, 0, 0, true),
      box('mdia', mdhd(sr, Math.round(durSec * sr)), hdlr('soun', 'KURD DESIGN Audio'),
        box('minf', fullBox('smhd', 0, 0, (b) => { b.u16(0); b.u16(0); }), dinf, stbl(entry, aSamples, aOff, sr, false))));
  }
  const mvhd = fullBox('mvhd', 0, 0, (b) => {
    b.u32(0); b.u32(0); b.u32(1000); b.u32(durMs); b.u32(0x00010000); b.u16(0x0100); b.u16(0); b.u32(0); b.u32(0);
    MATRIX.forEach((m) => b.u32(m)); for (let i = 0; i < 6; i++) b.u32(0); b.u32(aTrak ? 3 : 2);
  });
  const moov = box('moov', mvhd, vTrak, ...(aTrak ? [aTrak] : []));
  const mdatHead = new Buf(); mdatHead.u32(1); mdatHead.str('mdat'); mdatHead.u64(mdatSize);
  return new Blob([ftyp, mdatHead.bytes(), ...vSamples.map((s) => s.data), ...aSamples.map((s) => s.data), moov] as BlobPart[], { type: 'video/mp4' });
}

// ===================== WebM (Matroska) =====================
type EB = Uint8Array;
function vint(n: number): Uint8Array {
  for (let len = 1; len <= 8; len++) {
    if (n < 2 ** (7 * len) - 1) {
      const o = new Uint8Array(len); let v = n;
      for (let i = len - 1; i >= 0; i--) { o[i] = v & 0xff; v = Math.floor(v / 256); }
      o[0] |= 1 << (8 - len); return o;
    }
  }
  throw new Error('size too large');
}
function idBytes(id: number): Uint8Array { const out: number[] = []; let v = id; while (v > 0) { out.unshift(v & 0xff); v = Math.floor(v / 256); } return new Uint8Array(out); }
function cat(parts: Uint8Array[]): Uint8Array { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; }
const el = (id: number, ...children: EB[]): EB => { const body = cat(children); return cat([idBytes(id), vint(body.length), body]); };
const uint = (id: number, v: number): EB => { const b: number[] = []; let x = v; do { b.unshift(x & 0xff); x = Math.floor(x / 256); } while (x > 0); return el(id, new Uint8Array(b)); };
const flt = (id: number, v: number): EB => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v); return el(id, b); };
const str = (id: number, s: string): EB => el(id, new TextEncoder().encode(s));

function opusHead(a: AudioTrackInfo): Uint8Array {
  if (a.description && a.description.length >= 19) return a.description;
  const b = new Uint8Array(19); const d = new DataView(b.buffer);
  b.set(new TextEncoder().encode('OpusHead')); b[8] = 1; b[9] = a.channels; d.setUint16(10, 312, true); d.setUint32(12, a.sampleRate, true); d.setInt16(16, 0, true); b[18] = 0;
  return b;
}

export function muxWebM(video: VideoTrackInfo, vSamples: MuxSample[], audio: AudioTrackInfo | null, aSamples: MuxSample[]): Blob {
  const ebml = el(0x1a45dfa3, uint(0x4286, 1), uint(0x42f7, 1), uint(0x42f2, 4), uint(0x42f3, 8), str(0x4282, 'webm'), uint(0x4287, 4), uint(0x4285, 2));
  const durMs = Math.max(...vSamples.map((s) => (s.ts + s.dur) / 1000), ...aSamples.map((s) => (s.ts + s.dur) / 1000), 1);
  const info = el(0x1549a966, uint(0x2ad7b1, 1000000), str(0x4d80, 'KURD DESIGN'), str(0x5741, 'KURD DESIGN Motion'), flt(0x4489, durMs));
  const vTrack = el(0xae, uint(0xd7, 1), uint(0x73c5, 1), uint(0x83, 1), str(0x86, video.codec === 'vp8' ? 'V_VP8' : 'V_VP9'),
    el(0xe0, uint(0xb0, video.width), uint(0xba, video.height), ...(video.alpha ? [uint(0x53c0, 1)] : [])));
  const tracks = [vTrack];
  if (audio && aSamples.length) {
    tracks.push(el(0xae, uint(0xd7, 2), uint(0x73c5, 2), uint(0x83, 2), str(0x86, 'A_OPUS'), el(0x63a2, opusHead(audio)), uint(0x56aa, 6500000), uint(0x56bb, 80000000),
      el(0xe1, flt(0xb5, audio.sampleRate), uint(0x9f, audio.channels))));
  }
  const tracksEl = el(0x1654ae6b, ...tracks);
  // interleave samples by time into clusters that start at video keyframes (max ~5 s)
  const all = [...vSamples.map((s) => ({ s, track: 1 })), ...aSamples.map((s) => ({ s, track: 2 }))].sort((a, b) => a.s.ts - b.s.ts || a.track - b.track);
  const clusters: { time: number; blocks: EB[] }[] = [];
  let cur: { time: number; blocks: EB[] } | null = null;
  for (const { s, track } of all) {
    const tms = Math.round(s.ts / 1000);
    if (!cur || (track === 1 && s.key && tms - cur.time > 0) || tms - cur.time > 5000) { cur = { time: tms, blocks: [] }; clusters.push(cur); }
    const rel = tms - cur.time;
    const head = new Uint8Array(4); head[0] = 0x80 | track; new DataView(head.buffer).setInt16(1, rel); head[3] = s.key ? 0x80 : 0;
    if (track === 1 && s.alpha && s.alpha.length) {
      const block = el(0xa1, cat([head.slice(0, 3), new Uint8Array([0]), s.data]));
      cur.blocks.push(el(0xa0, block, el(0x75a1, el(0xa6, uint(0xee, 1), el(0xa5, s.alpha)))));
    } else cur.blocks.push(el(0xa3, cat([head, s.data])));
  }
  const clusterEls = clusters.map((c) => el(0x1f43b675, uint(0xe7, c.time), ...c.blocks));
  // cues: one per cluster (positions relative to the segment data start)
  const before = cat([info, tracksEl]).length;
  let pos = before; const cuePoints: EB[] = [];
  clusters.forEach((c, i) => { cuePoints.push(el(0xbb, uint(0xb3, c.time), el(0xb7, uint(0xf7, 1), uint(0xf1, pos)))); pos += clusterEls[i].length; });
  const cues = el(0x1c53bb6b, ...cuePoints);
  const segment = el(0x18538067, info, tracksEl, ...clusterEls, cues);
  return new Blob([ebml, segment] as BlobPart[], { type: 'video/webm' });
}
