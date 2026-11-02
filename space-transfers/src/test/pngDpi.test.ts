import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { withPngDpi } from "../components/artboard/lib/utils/pngDpi";
import { readDPI } from "../components/artboard/lib/utils/imageUtils";

/**
 * A PDF page rendered to canvas encodes with no resolution, and both the store
 * and the server read an unmarked PNG as 300dpi. A page rendered at anything
 * else would be placed — and priced — at the wrong physical size unless its
 * real resolution is written into the file.
 */

// 1×1 PNG with no pHYs, as a canvas would produce.
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);

const chunks = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: { type: string; data: Uint8Array; crcOk: boolean }[] = [];
  for (let off = 8; off + 12 <= png.length; ) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(...png.subarray(off + 4, off + 8));
    const data = png.subarray(off + 8, off + 8 + len);
    const crc = view.getUint32(off + 8 + len);
    out.push({ type, data, crcOk: crc32(png.subarray(off + 4, off + 8 + len)) === crc });
    off += 12 + len;
  }
  return out;
};

// jsdom's File has no arrayBuffer(), which is all readDPI calls on it.
const dpiOf = (png: Uint8Array) =>
  readDPI({ arrayBuffer: async () => png.slice().buffer } as unknown as File);

describe("withPngDpi", () => {
  it("is read back at the resolution it was stamped with", async () => {
    for (const dpi of [300, 243, 191, 150]) {
      expect(await dpiOf(withPngDpi(PNG, dpi))).toEqual({ dpiX: dpi, dpiY: dpi });
    }
  });

  it("writes a valid chunk before the image data", () => {
    const list = chunks(withPngDpi(PNG, 300));
    expect(list.map((c) => c.type)).toEqual(["IHDR", "pHYs", "IDAT", "IEND"]);
    // A bad CRC makes strict decoders (libpng, and so sharp) reject the file.
    expect(list.every((c) => c.crcOk)).toBe(true);
  });

  it("replaces an existing resolution rather than adding a second", async () => {
    const twice = withPngDpi(withPngDpi(PNG, 72), 300);
    expect(chunks(twice).filter((c) => c.type === "pHYs")).toHaveLength(1);
    expect(await dpiOf(twice)).toEqual({ dpiX: 300, dpiY: 300 });
  });

  it("leaves the image itself untouched", () => {
    const idat = (png: Uint8Array) => chunks(png).find((c) => c.type === "IDAT")!.data;
    expect(Array.from(idat(withPngDpi(PNG, 300)))).toEqual(Array.from(idat(PNG)));
  });

  it("refuses bytes that are not a PNG", () => {
    expect(() => withPngDpi(new Uint8Array(64), 300)).toThrow();
  });
});
