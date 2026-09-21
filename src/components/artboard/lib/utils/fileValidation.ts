import {
  ACCEPTED_IMAGE_EXTENSIONS,
  ACCEPTED_IMAGE_TYPES,
  MAX_CONVERT_SOURCE_BYTES,
  MAX_UPLOAD_BYTES,
  UPLOAD_FORMAT_LABELS,
} from "../../../../config/artboard.config";
/**
 * Content-level validation for dropped files.
 *
 * A browser derives `File.type` from the *extension*, not the bytes. So a text
 * file renamed `artwork.png` — which is exactly what a partly-downloaded or
 * damaged file looks like — reports `type: "image/png"` and passes any check
 * based on the MIME type. It then fails much later, deep in an image decode,
 * where the only signal is an `onerror` with no detail and nothing useful to
 * tell the customer.
 *
 * Checking the magic bytes up front turns that into an immediate, specific
 * message, before a byte is uploaded. It also costs almost nothing: only the
 * first few bytes are read, not the whole file.
 *
 * The contents also decide *what* a file is. Every accepted format is converted
 * to PNG by `convertUpload`, which dispatches on the kind found here, so a PDF
 * named `.png` or an Illustrator file the system reports as a PostScript
 * document is simply opened as what it really is.
 */

/**
 * Longest head we read. Enough for every signature below, including the
 * compatible-brand list that separates an AVIF from a HEIC in the same
 * container.
 */
const SNIFF_BYTES = 64;

export type DetectedKind =
  | "png"
  | "jpeg"
  | "gif"
  | "webp"
  | "pdf"
  | "svg"
  | "avif"
  | "heic"
  | "tiff"
  | "bmp"
  | "psd"
  /** EPS, and Illustrator files saved without PDF compatibility. Refused. */
  | "postscript"
  | null;

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0): boolean =>
  signature.every((byte, i) => bytes[offset + i] === byte);

const ascii4 = (bytes: Uint8Array, offset: number) =>
  String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);

/**
 * Reads the first `count` bytes of a file.
 *
 * `Blob.arrayBuffer()` is the direct route and is what every current browser
 * provides, but it is not universal — and a validator that throws when its
 * *reading* mechanism is missing would reject every file, turning a missing API
 * into a total upload outage. `FileReader` has been available since long before
 * any browser this app supports, so it is the fallback.
 *
 * Only the head is sliced, so this stays cheap on a large artwork.
 */
const readHead = async (file: File, count: number): Promise<Uint8Array> => {
  const head = file.slice(0, count);

  if (typeof head.arrayBuffer === "function") {
    return new Uint8Array(await head.arrayBuffer());
  }

  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsArrayBuffer(head);
  });
};

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);

/**
 * Identifies a file from its leading bytes.
 *
 * Returns null when nothing matches, which is the case that matters: it means
 * the contents are not any image format we accept, whatever the name says.
 */
export const sniffFileKind = (bytes: Uint8Array): DetectedKind => {
  // \x89 P N G \r \n \x1a \n — the full 8-byte signature. The trailing CRLF/EOF
  // bytes are part of it precisely so that a PNG mangled by a text-mode
  // transfer stops matching, which is the corruption being caught here.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";

  // JPEG: SOI marker followed by any marker byte.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";

  // GIF87a / GIF89a
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "gif";

  // RIFF....WEBP — the size field sits between the two tags.
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "webp";
  }

  // %PDF- — PDFs, and Illustrator files saved PDF-compatible (Illustrator's default).
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";

  // 8BPS — Photoshop (.psd, and .psb large documents).
  if (startsWith(bytes, [0x38, 0x42, 0x50, 0x53])) return "psd";

  // %!PS — PostScript: EPS, or an Illustrator file saved without PDF
  // compatibility. The DOS EPS binary header (C5 D0 D3 C6) wraps the same.
  if (startsWith(bytes, [0x25, 0x21, 0x50, 0x53]) || startsWith(bytes, [0xc5, 0xd0, 0xd3, 0xc6])) {
    return "postscript";
  }

  // ISO-BMFF: 4-byte size, then "ftyp", then a major brand and compatible
  // brands. AVIF and HEIC share the container, so the brands separate them —
  // including the generic "mif1", which either can declare.
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const major = ascii4(bytes, 8);
    const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
    const compatible: string[] = [];
    for (let at = 16; at + 4 <= Math.min(bytes.length, boxSize || bytes.length); at += 4) {
      compatible.push(ascii4(bytes, at));
    }
    const brands = [major, ...compatible];
    if (brands.includes("avif") || brands.includes("avis")) return "avif";
    if (brands.some((b) => HEIC_BRANDS.has(b)) || major === "mif1" || major === "msf1") return "heic";
  }

  // TIFF, both byte orders: "II*\0" (little-endian) and "MM\0*" (big-endian).
  if (
    startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return "tiff";
  }

  // BM
  if (startsWith(bytes, [0x42, 0x4d])) return "bmp";

  // SVG is XML, so it has no binary signature — it is identified by its opening
  // markup instead. A UTF-8 BOM and leading whitespace are both common and
  // neither means the file is broken, so both are skipped before matching.
  const text = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes)
    .replace(/^﻿/, "")
    .trimStart()
    .toLowerCase();
  if (text.startsWith("<?xml") || text.startsWith("<svg") || text.startsWith("<!doctype svg")) {
    return "svg";
  }

  return null;
};

/** Kinds sent straight to the server. Everything else is converted to PNG first. */
const DIRECT_KINDS: readonly DetectedKind[] = ["png", "jpeg"];

/** Every kind `convertUpload` can turn into a printable image. */
const SUPPORTED_KINDS: readonly DetectedKind[] = [
  "png", "jpeg", "pdf", "svg", "psd", "tiff", "webp", "avif", "heic", "gif", "bmp",
];

/** The formats a customer can export to, as a sentence fragment. */
const EXPORT_ADVICE = "PNG, JPG, PDF or SVG";

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
};

/**
 * Whether a dropped or chosen file is worth opening at all.
 *
 * By reported type *or* extension. Operating systems often report no type for
 * `.ai`, `.psd` and `.heic` — Chrome gives an empty string for all three — so a
 * MIME-only filter discarded those files before their contents were read, and
 * told the customer the format was unsupported.
 */
export const isAcceptedUpload = (file: { name: string; type: string }): boolean =>
  (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type) ||
  (ACCEPTED_IMAGE_EXTENSIONS as readonly string[]).includes(extensionOf(file.name));

export interface FileValidationResult {
  ok: boolean;
  /** Customer-facing explanation. Only set when `ok` is false. */
  message?: string;
  /** What the bytes actually turned out to be, for logging and conversion. */
  detected: DetectedKind;
}

/**
 * The explanation for a PostScript file, which no browser can render.
 *
 * Worded for what the customer is holding: an Illustrator file only needs
 * re-saving with a box ticked, while an EPS needs exporting to another format.
 */
const postscriptMessage = (name: string) =>
  extensionOf(name) === ".ai"
    ? `“${name}” was saved without PDF compatibility, so it can't be opened here. In Illustrator, use File › Save As and tick “Create PDF Compatible File”, or export it as PDF or SVG, then upload that.`
    : `“${name}” is an EPS file, which can't be opened in the browser. In your design app, save or export it as PDF or SVG and upload that.`;

/**
 * Validates that a file is readable and is a format we can print.
 *
 * Deliberately permissive about *which* image format it is and strict about
 * whether it is an image at all. Rejecting a JPEG because it is named .png
 * would block a file that works perfectly; letting through a text file named
 * .png is what wedges the uploader.
 */
export const validateImageFile = async (file: File): Promise<FileValidationResult> => {
  // An empty file cannot be anything, and reads as a confusing "unreadable
  // image" further down the pipeline. Named explicitly because the usual cause
  // — a transfer that never started — has an obvious fix.
  if (file.size === 0) {
    return {
      ok: false,
      detected: null,
      message: `“${file.name}” is empty (0 bytes). The file may not have finished downloading — please re-export it and try again.`,
    };
  }

  let bytes: Uint8Array;
  try {
    bytes = await readHead(file, SNIFF_BYTES);
  } catch {
    // The file handle went stale — typically the file was moved or deleted
    // between being chosen and being read.
    return {
      ok: false,
      detected: null,
      message: `“${file.name}” could not be read from disk. Please re-export it and try again.`,
    };
  }

  const detected = sniffFileKind(bytes);

  /*
   * Refused before it is sent or opened, not after.
   *
   * PNG and JPEG go to the server as they are, so they meet its 64MB cap. The
   * other formats never leave the browser — only the PNG made from them does,
   * and that meets the same cap when it is uploaded — so they may be larger:
   * a layered print-size PSD or TIFF is routinely over 64MB.
   */
  const cap = detected === null || DIRECT_KINDS.includes(detected) ? MAX_UPLOAD_BYTES : MAX_CONVERT_SOURCE_BYTES;
  if (file.size > cap) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    const capMb = Math.round(cap / (1024 * 1024));
    return {
      ok: false,
      detected,
      message: `“${file.name}” is ${mb}MB, over the ${capMb}MB limit. Please re-export it at a smaller size or lower resolution and try again.`,
    };
  }

  if (detected === "postscript") {
    return { ok: false, detected, message: postscriptMessage(file.name) };
  }

  if (detected === null || !SUPPORTED_KINDS.includes(detected)) {
    return {
      ok: false,
      detected,
      message: `“${file.name}” could not be read — it isn't a supported image (${UPLOAD_FORMAT_LABELS.join(", ")}). It may be damaged or only partly downloaded. Please re-export it as ${EXPORT_ADVICE} and try again.`,
    };
  }

  return { ok: true, detected };
};
