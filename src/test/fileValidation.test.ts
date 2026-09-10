import { describe, it, expect } from "vitest";
import {
  sniffFileKind,
  validateImageFile,
} from "../components/artboard/lib/utils/fileValidation";
import { MAX_UPLOAD_BYTES } from "../config/artboard.config";

/** Real leading bytes for each format, as a browser would see them. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0];
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34];

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);

const file = (content: Uint8Array | string, name: string, type: string): File => {
  const body = typeof content === "string" ? ascii(content) : content;
  return new File([body], name, { type });
};

describe("sniffFileKind", () => {
  it("identifies the formats the app accepts", () => {
    expect(sniffFileKind(bytes(...PNG_MAGIC))).toBe("png");
    expect(sniffFileKind(bytes(...JPEG_MAGIC))).toBe("jpeg");
    expect(sniffFileKind(bytes(...PDF_MAGIC))).toBe("pdf");
    expect(sniffFileKind(ascii("GIF89a..."))).toBe("gif");
  });

  it("identifies WEBP by both of its tags", () => {
    // RIFF····WEBP — the length field sits between them, so a check that only
    // matched "RIFF" would also claim WAV and AVI files.
    const webp = new Uint8Array(16);
    webp.set(ascii("RIFF"), 0);
    webp.set(ascii("WEBP"), 8);
    expect(sniffFileKind(webp)).toBe("webp");

    const wav = new Uint8Array(16);
    wav.set(ascii("RIFF"), 0);
    wav.set(ascii("WAVE"), 8);
    expect(sniffFileKind(wav)).toBeNull();
  });

  it("identifies SVG through a BOM and leading whitespace", () => {
    // Both are extremely common in exported SVGs and neither means damage.
    expect(sniffFileKind(ascii("<svg xmlns="))).toBe("svg");
    expect(sniffFileKind(ascii('<?xml version="1.0"?>'))).toBe("svg");
    expect(sniffFileKind(ascii("\n  <svg "))).toBe("svg");
    expect(sniffFileKind(ascii("﻿<svg "))).toBe("svg");
  });

  it("rejects a PNG whose signature was mangled in transfer", () => {
    // The CRLF/EOF bytes at positions 4-7 exist precisely to detect a file
    // corrupted by a text-mode transfer. Truncating the signature must not pass.
    expect(sniffFileKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0a, 0x1a, 0x0a, 0x00))).toBeNull();
  });

  it("returns null for plain text", () => {
    expect(sniffFileKind(ascii("hello world, this is not an image"))).toBeNull();
  });

  it("returns null for an empty buffer", () => {
    expect(sniffFileKind(new Uint8Array(0))).toBeNull();
  });
});

describe("validateImageFile", () => {
  it("rejects text contents behind a .png name", async () => {
    // The reported bug. The browser reports type "image/png" from the
    // extension, so nothing based on the MIME type catches this.
    const corrupt = file("this is plain text, not a png", "artwork.png", "image/png");
    expect(corrupt.type).toBe("image/png");

    const result = await validateImageFile(corrupt);
    expect(result.ok).toBe(false);
    expect(result.detected).toBeNull();
    expect(result.message).toContain("artwork.png");
    // The message has to name the fix, not just the failure.
    expect(result.message).toMatch(/re-export/i);
  });

  it("rejects an empty file with its own explanation", async () => {
    const empty = file(new Uint8Array(0), "artwork.png", "image/png");
    const result = await validateImageFile(empty);
    expect(result.ok).toBe(false);
    // A zero-byte file is a distinct failure with a distinct cause, and saying
    // "not a valid image" about it would send someone looking in the wrong place.
    expect(result.message).toMatch(/empty|0 bytes/i);
  });

  it("accepts a genuine PNG", async () => {
    const png = file(bytes(...PNG_MAGIC, 0x00, 0x00, 0x00, 0x0d), "logo.png", "image/png");
    const result = await validateImageFile(png);
    expect(result.ok).toBe(true);
    expect(result.detected).toBe("png");
  });

  it("accepts a JPEG that happens to be named .png", async () => {
    // Mislabelling is not corruption: the file decodes and prints correctly, so
    // rejecting it would block work that would have succeeded.
    const jpeg = file(bytes(...JPEG_MAGIC), "photo.png", "image/png");
    const result = await validateImageFile(jpeg);
    expect(result.ok).toBe(true);
    expect(result.detected).toBe("jpeg");
  });

  it("rejects a PDF named .png, naming what it actually is", async () => {
    // Raster formats are interchangeable to the decoder; a PDF is not, and the
    // customer needs to know which file they actually grabbed.
    const pdf = file(bytes(...PDF_MAGIC), "artwork.png", "image/png");
    const result = await validateImageFile(pdf);
    expect(result.ok).toBe(false);
    expect(result.detected).toBe("pdf");
    expect(result.message).toContain("PDF");
  });

  it("rejects a real SVG", async () => {
    /**
     * SVG used to be accepted. It is now refused as a format: it is a vector
     * document with no intrinsic pixel dimensions, so the DPI reckoning the
     * print pipeline is built on has nothing to read and a sheet composited
     * from one cannot be resolution-checked.
     *
     * The extension gate in `filterFiles` stops `.svg` before it reaches here;
     * this covers the other route in — SVG content arriving under some other
     * name.
     */
    const svg = file('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>', "logo.svg", "image/svg+xml");
    const result = await validateImageFile(svg);
    expect(result.ok).toBe(false);
    expect(result.detected).toBe("svg");
    expect(result.message).toContain("isn't supported");
  });

  it("still identifies raster content behind an .svg name", async () => {
    // Content-wise this is a perfectly good PNG, so the *content* check passes
    // it — the `.svg` extension is what refuses it, one layer up in
    // `filterFiles`. Asserted so the division of responsibility stays explicit.
    const fake = file(bytes(...PNG_MAGIC), "logo.svg", "image/svg+xml");
    const result = await validateImageFile(fake);
    expect(result.detected).toBe("png");
  });

  it("accepts a real PDF", async () => {
    const pdf = file(bytes(...PDF_MAGIC), "artwork.pdf", "application/pdf");
    const result = await validateImageFile(pdf);
    expect(result.ok).toBe(true);
    expect(result.detected).toBe("pdf");
  });

  it("reads only the file's head, not the whole thing", async () => {
    // Validation runs on every file in a drop, so it must not pull a 200 MB
    // artwork into memory to look at its first eight bytes.
    const big = new Uint8Array(5_000_000);
    big.set(PNG_MAGIC, 0);
    const png = file(big, "huge.png", "image/png");

    let slicedTo: number | null = null;
    const originalSlice = png.slice.bind(png);
    Object.defineProperty(png, "slice", {
      value: (start?: number, end?: number) => {
        slicedTo = end ?? null;
        return originalSlice(start, end);
      },
    });

    const result = await validateImageFile(png);
    expect(result.ok).toBe(true);
    expect(slicedTo).toBe(16);
  });
});

/**
 * The server caps a file at 64MB. Without a matching check here the whole file
 * uploaded before being rejected — minutes of transfer to learn something the
 * browser knew before it started.
 */
describe("size ceiling", () => {
  // `sizeBytes`, not `bytes` — that name is the module's Uint8Array helper, and
  // shadowing it made the file builder call a number.
  const sized = (sizeBytes: number, name = "huge.png", type = "image/png") => {
    const f = file(bytes(...PNG_MAGIC), name, type);
    // A real 64MB File would make the suite crawl; only `size` is read.
    Object.defineProperty(f, "size", { value: sizeBytes });
    return f;
  };

  it("refuses a file over the limit before reading or uploading it", async () => {
    const result = await validateImageFile(sized(MAX_UPLOAD_BYTES + 1));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/over the 64MB limit/i);
    // Names the actual size, so "too big" is actionable rather than a verdict.
    expect(result.message).toMatch(/64\.0MB/);
  });

  it("accepts a file exactly at the limit", async () => {
    expect((await validateImageFile(sized(MAX_UPLOAD_BYTES))).ok).toBe(true);
  });

  it("still reports an empty file as empty, not as oversized", async () => {
    const result = await validateImageFile(sized(0));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/empty/i);
  });
});
