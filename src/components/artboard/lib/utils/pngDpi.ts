/**
 * Stamps a resolution onto a PNG.
 *
 * A canvas encodes with no `pHYs` chunk, and both sides read an unmarked PNG as
 * 300dpi — `readDPI` here, sharp's `density` in `uploadAsset`. A PDF page
 * rendered at any other resolution would therefore arrive at the wrong physical
 * size, and a sheet is priced on physical size.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = 0x49484452;
const PHYS = 0x70485973;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

export const withPngDpi = (png: Uint8Array, dpi: number): Uint8Array => {
  if (png.length < 33 || PNG_SIGNATURE.some((b, i) => png[i] !== b)) {
    throw new Error("withPngDpi: not a PNG");
  }

  // pHYs stores pixels per metre.
  const ppm = Math.round(dpi / 0.0254);
  const phys = new Uint8Array(21);
  const view = new DataView(phys.buffer);
  view.setUint32(0, 9);
  view.setUint32(4, PHYS);
  view.setUint32(8, ppm);
  view.setUint32(12, ppm);
  phys[16] = 1; // unit: metre
  view.setUint32(17, crc32(phys.subarray(4, 17)));

  const src = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= png.length) {
    const end = offset + 12 + src.getUint32(offset);
    const type = src.getUint32(offset + 4);
    // The spec allows one pHYs, so any existing one is replaced rather than
    // left for a decoder to choose between.
    if (type !== PHYS) parts.push(png.subarray(offset, end));
    // Straight after IHDR: pHYs must come before the image data.
    if (type === IHDR) parts.push(phys);
    offset = end;
  }

  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
