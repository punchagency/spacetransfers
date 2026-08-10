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
 */

/** Longest signature we compare, so only this many bytes are ever read. */
const SNIFF_BYTES = 16;

export type DetectedKind = "png" | "jpeg" | "gif" | "webp" | "pdf" | "svg" | null;

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0): boolean =>
  signature.every((byte, i) => bytes[offset + i] === byte);

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

  // %PDF-
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";

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

/** Which detected kinds satisfy a declared MIME type. */
const ALLOWED_FOR_TYPE: Record<string, DetectedKind[]> = {
  // A JPEG named .png is a mislabelling, not a corruption: it decodes fine and
  // prints fine, so it is accepted rather than rejected on a technicality.
  "image/png": ["png", "jpeg", "gif", "webp"],
  "image/jpeg": ["jpeg", "png", "gif", "webp"],
  "image/svg+xml": ["svg"],
  "application/pdf": ["pdf"],
};

export interface FileValidationResult {
  ok: boolean;
  /** Customer-facing explanation. Only set when `ok` is false. */
  message?: string;
  /** What the bytes actually turned out to be, for logging. */
  detected: DetectedKind;
}

/**
 * Validates that a file's contents match what its name claims.
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

  if (detected === null) {
    return {
      ok: false,
      detected,
      message: `“${file.name}” could not be read — it isn't a valid image file. It may be damaged or only partly downloaded. Please re-export it and try again.`,
    };
  }

  const allowed = ALLOWED_FOR_TYPE[file.type];
  if (allowed && !allowed.includes(detected)) {
    // The contents are a real file of some kind, just not one that belongs
    // under this extension — worth saying exactly what it is, since the fix
    // (rename, or export properly) depends on knowing.
    return {
      ok: false,
      detected,
      message: `“${file.name}” is named as ${file.type.split("/")[1]?.toUpperCase() || "an image"} but contains ${detected.toUpperCase()} data. Please re-export it in the correct format.`,
    };
  }

  return { ok: true, detected };
};
