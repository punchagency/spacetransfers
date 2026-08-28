import crypto from "crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../config/env.js";
import sharp from "sharp";
import { uploadBufferToCloudinary } from "../utils/cloudinary.js";

/**
 * Where a customer's artwork goes.
 *
 * Two backends, chosen by configuration rather than by a flag anyone has to
 * remember. R2 wins when it is fully configured; Cloudinary serves until then,
 * so nothing breaks before the client has finished provisioning.
 *
 * The difference is not cosmetic. Cloudinary caps an image at 10MB, so every
 * upload runs through `fitUnderCloudinaryLimit` and a print-resolution transfer
 * is downscaled on the way in — the file that gets printed is not the file the
 * customer sent. R2 has no such cap, so on that path the bytes are stored
 * exactly as they arrived. That is the entire reason for the move.
 */

export type StoredObject = { url: string; publicId: string };

/**
 * All four are required. A half-configured R2 is the dangerous state — it would
 * take the no-downscale path and then fail to store anything.
 */
export const isR2Configured = (): boolean =>
  Boolean(env.r2AccountId && env.r2AccessKeyId && env.r2SecretAccessKey && env.r2Bucket);

let client: S3Client | null = null;

const r2 = (): S3Client => {
  if (client) return client;
  client = new S3Client({
    // R2 is S3-compatible but single-region; "auto" is what Cloudflare expects.
    region: "auto",
    endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.r2AccessKeyId!,
      secretAccessKey: env.r2SecretAccessKey!,
    },
  });
  return client;
};

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/tiff": "tif",
  "application/pdf": "pdf",
};

/**
 * A key that cannot collide and cannot be guessed.
 *
 * Random rather than derived from the filename: two customers uploading
 * `logo.png` must not share a key, and an object key that encodes a customer's
 * filename is a small information leak on a bucket served over HTTP.
 */
export const buildObjectKey = (folder: string, contentType?: string): string => {
  const safeFolder = String(folder || "misc")
    .replace(/[^a-zA-Z0-9/_-]/g, "-")
    .replace(/^\/+|\/+$/g, "");
  const ext = EXT_BY_TYPE[String(contentType || "").toLowerCase()] ?? "bin";
  return `${safeFolder}/${Date.now()}-${crypto.randomBytes(12).toString("hex")}.${ext}`;
};

/** Public URL for a stored key, honouring a custom domain when one is set. */
export const publicUrlForKey = (key: string): string => {
  const base = env.r2PublicBaseUrl?.replace(/\/+$/, "");
  if (base) return `${base}/${key}`;
  // No custom domain configured yet: the bucket's own endpoint. Works, but a
  // custom domain is worth adding — this one leaks the account id in every
  // artwork URL a customer sees.
  return `https://${env.r2AccountId}.r2.cloudflarestorage.com/${env.r2Bucket}/${key}`;
};

/**
 * The real type of a buffer, read from the bytes.
 *
 * Detected rather than threaded through every caller: a wrong content type is
 * silent — the object stores fine and then a browser downloads it instead of
 * showing it — and the ten call sites do not all know what they are holding.
 */
const sharpFormatToMime: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  webp: "image/webp",
  tiff: "image/tiff",
};

export const sniffContentType = async (buffer: Buffer): Promise<string> => {
  if (buffer.subarray(0, 4).toString("latin1") === "%PDF") return "application/pdf";
  try {
    const { format } = await sharp(buffer, { limitInputPixels: false }).metadata();
    return sharpFormatToMime[String(format)] ?? "application/octet-stream";
  } catch {
    return "application/octet-stream";
  }
};

/**
 * Store artwork and return where it lives.
 *
 * `contentType` matters on the R2 path: an object stored without one is served
 * as `application/octet-stream`, which makes a browser download the file
 * instead of displaying it — the preview in the editor would silently break.
 */
export const storeArtwork = async (
  buffer: Buffer,
  folder: string,
  contentType?: string,
): Promise<StoredObject> => {
  if (!isR2Configured()) {
    // Cloudinary path. `uploadBufferToCloudinary` applies the 10MB downscale
    // itself, so it is not repeated here — that cap is the reason to move.
    return uploadBufferToCloudinary(buffer, folder);
  }

  const key = buildObjectKey(folder, contentType ?? (await sniffContentType(buffer)));
  await r2().send(
    new PutObjectCommand({
      Bucket: env.r2Bucket!,
      Key: key,
      Body: buffer,
      ContentType: contentType ?? (await sniffContentType(buffer)),
    }),
  );

  return { url: publicUrlForKey(key), publicId: key };
};
