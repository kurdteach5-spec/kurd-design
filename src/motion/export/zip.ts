// Minimal ZIP writer/reader (stored, no compression) for image sequences and project files.
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(d: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export class ZipWriter {
  private parts: BlobPart[] = [];
  private central: Uint8Array[] = [];
  private offset = 0;
  private count = 0;

  add(name: string, data: Uint8Array) {
    const nameB = new TextEncoder().encode(name);
    const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nameB.length, true); h.setUint16(28, 0, true);
    this.parts.push(new Uint8Array(h.buffer), nameB, data as BlobPart);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, nameB.length, true); c.setUint32(42, this.offset, true);
    const entry = new Uint8Array(46 + nameB.length); entry.set(new Uint8Array(c.buffer)); entry.set(nameB, 46);
    this.central.push(entry);
    this.offset += 30 + nameB.length + data.length;
    this.count++;
  }

  finish(type = 'application/zip'): Blob {
    const size = this.central.reduce((a, b) => a + b.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, this.count, true); e.setUint16(10, this.count, true);
    e.setUint32(12, size, true); e.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...this.central, new Uint8Array(e.buffer)] as BlobPart[], { type });
  }
}

/** Reads stored (uncompressed) ZIP entries written by ZipWriter. */
export function readZip(buf: ArrayBuffer): Map<string, Uint8Array> {
  const d = new DataView(buf); const out = new Map<string, Uint8Array>();
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (d.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a project file');
  const n = d.getUint16(eocd + 10, true); let p = d.getUint32(eocd + 16, true);
  for (let i = 0; i < n; i++) {
    if (d.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupted project file');
    const method = d.getUint16(p + 10, true); const size = d.getUint32(p + 20, true);
    const nl = d.getUint16(p + 28, true), xl = d.getUint16(p + 30, true), cl = d.getUint16(p + 32, true);
    const local = d.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nl));
    if (method !== 0) throw new Error('Compressed project files are not supported');
    const lnl = d.getUint16(local + 26, true), lxl = d.getUint16(local + 28, true);
    out.set(name, new Uint8Array(buf, local + 30 + lnl + lxl, size));
    p += 46 + nl + xl + cl;
  }
  return out;
}
