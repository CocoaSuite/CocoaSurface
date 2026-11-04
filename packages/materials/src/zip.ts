/**
 * A small ZIP writer and reader (PKWARE APPNOTE 6.3: stored or deflated entries, UTF-8 names, no ZIP64), and a
 * PNG encoder, for `.cocoamat` files. Pure: deflate comes from the standard `CompressionStream`, so it runs in
 * the editor and in Node alike.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
export const deflateRaw = (d: Uint8Array) => pipe(d, new CompressionStream('deflate-raw'));
export const inflateRaw = (d: Uint8Array) => pipe(d, new DecompressionStream('deflate-raw'));
const zlib = (d: Uint8Array) => pipe(d, new CompressionStream('deflate'));

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** Deflate it (method 8); otherwise stored. */
  deflate?: boolean;
}

// 1980-01-01 00:00: entries carry no real time, so the same material always makes the same bytes.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

export async function writeZip(entries: ZipEntry[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const body = e.deflate ? await deflateRaw(e.data) : e.data;
    const method = e.deflate ? 8 : 0;
    const crc = crc32(e.data);
    const local = new Uint8Array(30 + name.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x0800, true);
    v.setUint16(8, method, true);
    v.setUint16(10, DOS_TIME, true);
    v.setUint16(12, DOS_DATE, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, body.length, true);
    v.setUint32(22, e.data.length, true);
    v.setUint16(26, name.length, true);
    v.setUint16(28, 0, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const c = new DataView(cen.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, method, true);
    c.setUint16(12, DOS_TIME, true);
    c.setUint16(14, DOS_DATE, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, body.length, true);
    c.setUint32(24, e.data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    cen.set(name, 46);
    parts.push(local, body);
    central.push(cen);
    offset += local.length + body.length;
  }
  const size = central.reduce((s, x) => s + x.length, 0);
  const end = new Uint8Array(22);
  const d = new DataView(end.buffer);
  d.setUint32(0, 0x06054b50, true);
  d.setUint16(8, entries.length, true);
  d.setUint16(10, entries.length, true);
  d.setUint32(12, size, true);
  d.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
  let at = 0;
  for (const x of all) (out.set(x, at), (at += x.length));
  return out;
}

/** Entries by name, or what's wrong with the file. */
export async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array> | string> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) return 'This is not a ZIP file.';
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const dec = new TextDecoder('utf-8', { fatal: true });
  const out = new Map<string, Uint8Array>();
  for (let k = 0; k < count; k++) {
    if (p + 46 > bytes.length || v.getUint32(p, true) !== 0x02014b50) return 'The ZIP directory is broken.';
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const csize = v.getUint32(p + 20, true);
    const usize = v.getUint32(p + 24, true);
    const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
    const at = v.getUint32(p + 42, true);
    let name: string;
    try {
      name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    } catch {
      return 'A file name in it is not UTF-8.';
    }
    p += 46 + nlen + xlen + clen;
    if (flags & 1) return 'It is encrypted.';
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) return `Bad path “${name}”.`;
    if (name.endsWith('/')) continue;
    if (at + 30 > bytes.length || v.getUint32(at, true) !== 0x04034b50) return `“${name}” is broken.`;
    const start = at + 30 + v.getUint16(at + 26, true) + v.getUint16(at + 28, true);
    const raw = bytes.subarray(start, start + csize);
    if (raw.length !== csize) return `“${name}” is cut short.`;
    let data: Uint8Array;
    if (method === 0) data = raw;
    else if (method === 8) {
      try {
        data = await inflateRaw(raw);
      } catch {
        return `“${name}” is broken.`;
      }
    } else return `“${name}” uses a compression this can't read.`;
    if (data.length !== usize || crc32(data) !== crc) return `“${name}” is damaged.`;
    out.set(name, data);
  }
  return out;
}

/** An 8-bit PNG (1 channel grey, 3 RGB, 4 RGBA), rows top first. */
export async function encodePng(w: number, h: number, channels: 1 | 3 | 4, px: Uint8Array): Promise<Uint8Array> {
  const row = w * channels;
  const raw = new Uint8Array((row + 1) * h);
  for (let y = 0; y < h; y++) raw.set(px.subarray(y * row, (y + 1) * row), y * (row + 1) + 1);
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, w);
  hv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = channels === 1 ? 0 : channels === 3 ? 2 : 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', await zlib(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((s, x) => s + x.length, 0));
  let at = 0;
  for (const x of parts) (out.set(x, at), (at += x.length));
  return out;
}

/** RGBA pixels down to `channels` (grey takes red). */
export function channelsOf(rgba: Uint8Array, channels: 1 | 3 | 4): Uint8Array {
  if (channels === 4) return rgba;
  const n = rgba.length / 4;
  const out = new Uint8Array(n * channels);
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) out[i * channels + c] = rgba[i * 4 + c]!;
  return out;
}
