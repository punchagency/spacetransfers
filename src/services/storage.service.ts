import crypto from "crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../config/env.js";
import sharp from "sharp";

/**
 * Where a customer's artwork goes.
 *
 * R2 only. Cloudinary is gone.
 *
 * Cloudinary capped an image at 10MB, so every upload was downscaled on the way
 * in and the file that got printed was not the file the customer sent — which
 * for a transfer business is the product being quietly degraded at the door.
 * R2 has no such cap and the bytes are stored exactly as they arrived.
 *
 * There is deliberately no fallback. An unconfigured server fails loudly on the
 * first upload rather than silently storing artwork somewhere nobody intends to
 * keep it.
 *
 * The one thing Cloudinary did that plain storage does not is generate
 * thumbnails by URL transformation. Every upload therefore writes a second
 * small object beside the original, following the `-thumb200.webp` convention
 * the codebase already used for local files.
 */

export type StoredObject = { url: string; publicId: string };

/**
 * All five are required. A half-configured R2 is the dangerous state — it would
 * take the no-downscale path and then fail to store anything.
 *
 * The public base URL is one of them. Without it there is no address a browser
 * can load the artwork from: the account endpoint (`<account>.r2.cloudflarestorage.com`)
 * is R2's S3 API and answers only signed requests, so an upload would succeed
 * and then show as a broken image everywhere. It used to be optional, with that
 * endpoint as a fallback described as working.
 */
export const isR2Configured = (): boolean =>
  Boolean(
    env.r2AccountId && env.r2AccessKeyId && env.r2SecretAccessKey && env.r2Bucket && env.r2PublicBaseUrl,
  );

let client: S3Client | null = null;

const r2 = (): S3Client => {
  if (client) return client;
  client = new S3Client({
    // R2 is S3-compatible but single-region; "auto" is what Cloudflare expects.
    region: "auto",
    // No limits by default: a stuck connection to storage held the upload (and
    // the customer's progress bar) open indefinitely. 5 seconds to connect, or
    // 2 minutes with no data moving, and it fails with an error instead.
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 120_000 },
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

/**
 * Whether a URL points at artwork this platform stored.
 *
 * Used as an input guard, so it matches the configured host rather than merely
 * checking the string looks like a URL — otherwise any address could be handed
 * to the server to fetch on a caller's behalf.
 */
export const isStoredArtworkUrl = (url: string): boolean => {
  const candidate = String(url || "");
  const base = env.r2PublicBaseUrl?.replace(/\/+$/, "");
  if (base && candidate.startsWith(base + "/")) return true;
  if (
    env.r2AccountId &&
    candidate.startsWith(`https://${env.r2AccountId}.r2.cloudflarestorage.com/`)
  ) {
    return true;
  }
  return isLegacyCloudinaryUrl(candidate);
};

/**
 * Artwork uploaded before the move to R2.
 *
 * Nothing writes to Cloudinary any more, but 261 of the 350 assets on record
 * still point at it. Rejecting those would break every existing design in the
 * editor, so they stay readable — this is a read-only concession to history,
 * not a second storage backend.
 *
 * These die when the previous developer's Cloudinary account is decommissioned.
 * Anything worth keeping has to be re-uploaded or migrated before that happens.
 */
export const isLegacyCloudinaryUrl = (url: string): boolean =>
  /^https:\/\/res\.cloudinary\.com\//.test(String(url || ""));

/**
 * Cloudinary made thumbnails by URL transformation. Kept only for the legacy
 * URLs above — new artwork gets a real thumbnail object written beside it.
 */
export const legacyCloudinaryThumbUrl = (url: string): string =>
  url.replace("/upload/", "/upload/c_fill,w_200,h_200,q_auto,f_webp/");

/** Public URL for a stored key, honouring a custom domain when one is set. */
export const publicUrlForKey = (key: string): string => {
  const base = env.r2PublicBaseUrl?.replace(/\/+$/, "");
  // Unreachable in practice — storeArtwork refuses first — but a URL no browser
  // can load must never be written into a design or an order.
  if (!base) throw new Error("R2_PUBLIC_BASE_URL is not set");
  return `${base}/${key}`;
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
export const THUMB_SUFFIX = "-thumb200.webp";

/** The thumbnail key for an object key — the convention `computeThumbUrl` reads. */
export const thumbKeyFor = (key: string): string => {
  const dot = key.lastIndexOf(".");
  return dot <= key.lastIndexOf("/") ? key + THUMB_SUFFIX : key.slice(0, dot) + THUMB_SUFFIX;
};

export const storeArtwork = async (
  buffer: Buffer,
  folder: string,
  contentType?: string,
): Promise<StoredObject> => {
  if (!isR2Configured()) {
    /*
     * Two audiences, two messages.
     *
     * This sentence went to the customer verbatim: an operator's checklist,
     * naming four of our environment variables, shown to someone whose upload
     * had just failed. They cannot act on it and should not see it. The
     * actionable version goes to the log, where the person who can act is.
     */
    console.error(
      "[storage] artwork storage is not configured — set R2_ACCOUNT_ID, " +
        "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_PUBLIC_BASE_URL",
    );
    const error = new Error(
      "We can't accept uploads at the moment. Nothing you did caused this — please try again shortly.",
    ) as Error & { statusCode?: number };
    error.statusCode = 503;
    throw error;
  }

  const type = contentType ?? (await sniffContentType(buffer));
  const key = buildObjectKey(folder, type);

  await r2().send(
    new PutObjectCommand({
      Bucket: env.r2Bucket!,
      Key: key,
      Body: buffer,
      ContentType: type,
    }),
  );

  /*
   * The thumbnail is best-effort: a failure here must not lose the artwork that
   * was just stored successfully. `computeThumbUrl` derives this path without
   * asking whether it exists, so a missing thumb degrades to a broken preview
   * rather than a failed upload.
   */
  try {
    const thumb = await sharp(buffer, { limitInputPixels: false })
      .resize(200, 200, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    await r2().send(
      new PutObjectCommand({
        Bucket: env.r2Bucket!,
        Key: thumbKeyFor(key),
        Body: thumb,
        ContentType: "image/webp",
      }),
    );
  } catch (e: any) {
    console.warn(`[STORAGE] thumbnail failed for ${key} — ${e?.message ?? e}`);
  }

  return { url: publicUrlForKey(key), publicId: key };
};
