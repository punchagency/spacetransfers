import { v2 as cloudinary } from "cloudinary";
import sharp from "sharp";
import { env } from "../config/env.js";

cloudinary.config({
  cloud_name: env.cloudinaryCloudName,
  api_key: env.cloudinaryApiKey,
  api_secret: env.cloudinaryApiSecret,
});

export type CloudinaryUploadResult = { url: string; publicId: string };

// Cloudinary's Free plan hard-caps image uploads at exactly 10MB — confirmed
// via cloudinary.api.usage().media_limits.image_max_size_bytes. This is an
// account-level limit enforced on the final asset, not a per-request artifact
// of the plain upload endpoint, so chunked/resumable upload (upload_large)
// does NOT get around it — it still gets rejected once assembled. The only
// real fix is shrinking the file below the cap before it ever reaches
// Cloudinary.
const CLOUDINARY_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * libjpeg cannot encode a dimension over this many pixels. A 1200in sheet —
 * this platform's own configured ceiling (`MAX_SHEET_HEIGHT_IN`) — at 300 DPI
 * is 360,000px, well over five times this limit, so a sufficiently long
 * design reaches it for real. Encoding is guarded against it below rather
 * than letting sharp throw `Error: Processed image is too large for the
 * JPEG format` out of this function.
 */
const JPEG_MAX_DIMENSION = 65_500;

const canEncodeJpeg = (width: number, height: number): boolean =>
  width > 0 && width <= JPEG_MAX_DIMENSION && height > 0 && height <= JPEG_MAX_DIMENSION;

/**
 * 40,000px (~200×200) is small enough to guarantee termination — even
 * uncompressed RGBA at that size is ~156KB, far under Cloudinary's cap
 * regardless of content — while still resembling the original design closely
 * enough to be worth using over the hard-coded 200×200 backstop at the very
 * end of `fitUnderCloudinaryLimit`.
 */
const MIN_PIXEL_AREA = 40_000;

/**
 * The next candidate size for the downscale loop, or `null` once the floor is
 * reached.
 *
 * Pulled out as its own pure function — no image encoding, just arithmetic —
 * because this exact decision was the bug. The previous version stopped once
 * `width` alone crossed a threshold; for a narrow-but-very-tall design (a thin
 * banner or strap print, which this platform explicitly supports up to
 * 1200in long), width can already be under that threshold on the very first
 * check, so the loop never ran at all regardless of how enormous the height —
 * and therefore the true byte size — still was.
 *
 * The fix is the stopping condition itself: total pixel AREA against a floor,
 * which is orientation-agnostic — a 150×60,000 image and a 60,000×150 image
 * shrink identically. Being pure means this can be verified directly with
 * plain numbers, without paying for real image encoding on every test run.
 */
export function nextDownscaleCandidate(
  width: number,
  height: number,
  currentBytes: number,
  capBytes: number,
): { width: number; height: number } | null {
  if (width * height < MIN_PIXEL_AREA) return null;

  // Byte size scales roughly with pixel area, so scale ≈ √(target/current)
  // estimates the right step directly from the actual overage instead of a
  // blind ×0.7 decay — typically converging in 1–2 passes instead of up to 8,
  // which was also the majority of the reported request's 24-second latency.
  // A slight safety margin (0.92) below the exact estimate covers compression
  // ratio not being perfectly quadratic in pixel count for real content.
  const ratio = Math.min(0.7, Math.sqrt(capBytes / Math.max(1, currentBytes)) * 0.92);

  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/**
 * Shrinks a buffer under Cloudinary's size cap, trying the least destructive
 * option first since the result may be used for print:
 *   1. PNG: max lossless recompression (same pixels, denser DEFLATE) — real
 *      uploads are rarely saved at max compression, so this alone usually wins.
 *   2. PNG: palette quantization — lossless for flat-color/vector-style art
 *      (most DTF designs), only visibly lossy for photographic gradients.
 *   3. JPEG/other: incremental quality reduction via mozjpeg.
 *   4. Last resort only: proportional pixel downscale — the only pass that
 *      actually reduces print resolution.
 * Returns the original buffer untouched if it's already under the cap.
 *
 * The function's one invariant is that its return value is never larger than
 * `CLOUDINARY_IMAGE_MAX_BYTES` — every step below exists to guarantee that,
 * and the final backstop makes it unconditional.
 */
export async function fitUnderCloudinaryLimit(buffer: Buffer): Promise<Buffer> {
  if (buffer.length <= CLOUDINARY_IMAGE_MAX_BYTES) return buffer;

  const meta = await sharp(buffer, { limitInputPixels: false }).metadata();
  const origWidth = meta.width || 0;
  const origHeight = meta.height || 0;

  if (meta.format === "png") {
    const recompressed = await sharp(buffer, { limitInputPixels: false })
      .png({ compressionLevel: 9, effort: 10 })
      .toBuffer();
    if (recompressed.length <= CLOUDINARY_IMAGE_MAX_BYTES) return recompressed;

    for (const colors of [256, 192, 128]) {
      const paletted = await sharp(buffer, { limitInputPixels: false })
        .png({ compressionLevel: 9, palette: true, colors })
        .toBuffer();
      if (paletted.length <= CLOUDINARY_IMAGE_MAX_BYTES) return paletted;
    }
  }

  let attempt = buffer;
  if (canEncodeJpeg(origWidth, origHeight)) {
    let quality = 92;
    while (quality >= 55) {
      attempt = await sharp(buffer, { limitInputPixels: false })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      if (attempt.length <= CLOUDINARY_IMAGE_MAX_BYTES) return attempt;
      quality -= 7;
    }
  }

  // Downscale as the final resort — see `nextDownscaleCandidate` for why this
  // is where the reported bug lived and how the fix works.
  if (origWidth > 0 && origHeight > 0) {
    let candidate = nextDownscaleCandidate(
      origWidth,
      origHeight,
      attempt.length,
      CLOUDINARY_IMAGE_MAX_BYTES,
    );
    let safety = 0;
    while (candidate && safety < 12) {
      safety += 1;
      const { width, height } = candidate;

      const resized = sharp(buffer, { limitInputPixels: false }).resize(width, height, { fit: "fill" });
      attempt =
        meta.format === "png" || !canEncodeJpeg(width, height)
          ? await resized.png({ compressionLevel: 9 }).toBuffer()
          : await resized.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
      if (attempt.length <= CLOUDINARY_IMAGE_MAX_BYTES) return attempt;

      candidate = nextDownscaleCandidate(width, height, attempt.length, CLOUDINARY_IMAGE_MAX_BYTES);
    }
  }

  // Unconditional backstop. However this was reached — an exotic format,
  // metadata sharp couldn't read, or content that somehow survives all of the
  // above — a buffer over the cap must never leave this function, since that
  // is the one failure this whole function exists to prevent.
  if (attempt.length > CLOUDINARY_IMAGE_MAX_BYTES) {
    attempt = await sharp(buffer, { limitInputPixels: false })
      .resize(200, 200, { fit: "inside" })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }

  return attempt;
}

export const uploadBufferToCloudinary = async (
  buffer: Buffer,
  folder = "space-transfers/assets",
): Promise<CloudinaryUploadResult> => {
  const fitted = await fitUnderCloudinaryLimit(buffer);

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        overwrite: false,
        // Prevent Cloudinary from applying any incoming format or quality
        // transformation on upload so the stored file is always the original
        // bytes. "preserve_transparency" keeps the alpha channel on PNG assets.
        flags: "preserve_transparency",
      },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error("Cloudinary upload failed"));
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );
    stream.end(fitted);
  });
};

// Inserts Cloudinary transformation into the URL to generate a 200px thumbnail.
export const cloudinaryThumbUrl = (url: string): string =>
  url.replace("/upload/", "/upload/w_200,h_200,c_limit,f_webp/");

export const isCloudinaryUrl = (url: string): boolean =>
  url.includes("res.cloudinary.com");

export { cloudinary };
