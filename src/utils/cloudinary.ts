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
 */
async function fitUnderCloudinaryLimit(buffer: Buffer): Promise<Buffer> {
  if (buffer.length <= CLOUDINARY_IMAGE_MAX_BYTES) return buffer;

  const meta = await sharp(buffer, { limitInputPixels: false }).metadata();

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

  let quality = 92;
  let attempt = buffer;
  while (quality >= 55) {
    attempt = await sharp(buffer, { limitInputPixels: false })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (attempt.length <= CLOUDINARY_IMAGE_MAX_BYTES) return attempt;
    quality -= 7;
  }

  // Byte size scales roughly with pixel area (∝ scale²), so halving repeatedly
  // is guaranteed to converge — a fixed floor (e.g. stopping at 0.4×) left
  // very large AI-upscaled buffers still over the cap with nowhere left to go,
  // which is exactly what surfaced as Cloudinary's raw "File size too large"
  // error reaching the client instead of a shrunk, uploadable file.
  let scale = 0.7;
  while (meta.width && Math.round(meta.width * scale) >= 200) {
    const targetWidth = Math.max(1, Math.round(meta.width * scale));
    const resized = sharp(buffer, { limitInputPixels: false }).resize(targetWidth);
    attempt =
      meta.format === "png"
        ? await resized.png({ compressionLevel: 9 }).toBuffer()
        : await resized.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    if (attempt.length <= CLOUDINARY_IMAGE_MAX_BYTES) return attempt;
    scale *= 0.7;
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
