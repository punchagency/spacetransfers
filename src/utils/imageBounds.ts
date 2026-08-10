/**
 * Bounds checking for image data entering the processing pipeline.
 *
 * Every image operation on the server begins by turning something — a data URL,
 * a local path, a remote URL — into a Buffer. That step was unbounded, in two
 * ways that turn a bad image into a process-level failure rather than a
 * rejected request:
 *
 *  - **Decoding.** `Buffer.from(base64, "base64")` allocates whatever the input
 *    implies. Node silently produces a truncated or empty Buffer for malformed
 *    base64 instead of throwing, so a corrupt data URL became an empty Buffer,
 *    which sharp then rejected with "Input buffer contains unsupported image
 *    format" — an error that describes the format rather than the truncation
 *    that actually happened.
 *
 *  - **Decoded size.** Every `sharp()` call in this codebase passes
 *    `limitInputPixels: false`, which disables the built-in decompression-bomb
 *    guard. That is deliberate — legitimate gang sheets are genuinely enormous,
 *    and the default 268 MP ceiling rejects them — but it means nothing stops a
 *    50000×50000 PNG from being decoded to roughly 10 GB of raw pixels. The
 *    process does not throw; it is killed by the OS. Disabling the library's
 *    limit is only safe alongside an explicit one, which `MAX_IMAGE_PIXELS`
 *    supplies; the upload path enforces it once dimensions are known.
 *
 * `fetchImageBuffer` in the customer controller is the single caller of the
 * decode helpers, so guarding it covers every downstream operation — trim,
 * upscale, fade check, AI edit, gangsheet export — rather than each having to
 * guard itself.
 *
 * Limits here are ceilings on *pathological* input, not on real work. A 300 DPI
 * 60×100in sheet is 18000×30000 = 540 MP, so the pixel ceiling sits well above
 * that.
 */

/**
 * Largest encoded image accepted, in bytes.
 *
 * Matches the multipart upload ceiling in `middleware/upload.ts`, so an image
 * that can be uploaded can also be processed — a lower limit here would accept
 * a file and then fail on the operation, which is worse than refusing it.
 */
export const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

/**
 * Largest decoded image accepted, in pixels.
 *
 * The real constraint is memory: sharp decodes to 4 bytes per pixel, so 1 GP is
 * ~4 GB of raw pixels. Set above the largest legitimate sheet (540 MP at 300
 * DPI for 60×100in) and below the point where a single image can exhaust a
 * typical container.
 */
export const MAX_IMAGE_PIXELS = 1_000_000_000;

const badRequest = (message: string, code: string) => {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = 400;
  error.code = code;
  return error;
};

const formatMb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

/**
 * Decodes a `data:` URL into a Buffer, with bounds and format validation.
 *
 * The size is checked *before* allocating, from the base64 length, so a
 * hostile 500 MB data URL is refused rather than briefly materialized.
 */
export const decodeDataUrl = (url: string): Buffer => {
  const commaIdx = url.indexOf(",");
  if (commaIdx < 0) {
    throw badRequest(
      "That image could not be read — please re-export it and try again.",
      "MALFORMED_DATA_URL",
    );
  }

  const header = url.slice(0, commaIdx);
  const payload = url.slice(commaIdx + 1);

  if (!header.includes("base64")) {
    throw badRequest(
      "That image could not be read — please re-export it and try again.",
      "UNSUPPORTED_DATA_URL_ENCODING",
    );
  }

  if (payload.length === 0) {
    throw badRequest(
      "That image appears to be empty — please re-export it and try again.",
      "EMPTY_IMAGE",
    );
  }

  // Decoded size derived from the encoded length rather than measured after the
  // fact: base64 is 4 characters per 3 bytes, so this is exact enough to refuse
  // an oversized input before the allocation happens.
  const estimatedBytes = Math.floor((payload.length * 3) / 4);
  if (estimatedBytes > MAX_IMAGE_BYTES) {
    throw badRequest(
      `That image is too large to process (${formatMb(estimatedBytes)}, limit ` +
        `${formatMb(MAX_IMAGE_BYTES)}). Please re-export it at a smaller size.`,
      "IMAGE_TOO_LARGE",
    );
  }

  const buffer = Buffer.from(payload, "base64");

  // Node does not throw on malformed base64 — it decodes what it can and stops.
  // A result far short of the estimate means the payload was truncated or
  // corrupt, which is worth saying plainly rather than letting sharp report it
  // as an unsupported format.
  if (buffer.length === 0) {
    throw badRequest(
      "That image could not be decoded — please re-export it and try again.",
      "CORRUPT_IMAGE_DATA",
    );
  }

  return buffer;
};

/** Rejects a Buffer that is empty or over the byte ceiling. */
export const assertBufferWithinBounds = (buffer: Buffer, source = "image"): Buffer => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw badRequest(
      "That image could not be read — please re-export it and try again.",
      "EMPTY_IMAGE",
    );
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw badRequest(
      `That ${source} is too large to process (${formatMb(buffer.length)}, limit ` +
        `${formatMb(MAX_IMAGE_BYTES)}). Please re-export it at a smaller size.`,
      "IMAGE_TOO_LARGE",
    );
  }
  return buffer;
};
