import sharp from "sharp";
import { storeArtwork } from "../services/storage.service.js";

/**
 * A saved sheet's preview picture, kept in storage rather than in the database.
 *
 * Thumbnails arrive from the browser as `data:` URLs and used to be written
 * into the design document as-is — 20 to 140 KB of base64 each. The saved-sheet
 * list returns every design with its thumbnail inline, so opening the gallery
 * downloaded all of them in one response: a customer with four sheets pulled
 * ~280 KB before a single picture appeared, and it grew with every sheet they
 * saved. On a phone that is the request most likely to time out, and a timeout
 * there looked exactly like an empty account.
 *
 * Stored as a file, the list carries a short URL instead, the browser fetches
 * the pictures in parallel and caches them, and the second visit costs nothing.
 */

/** Longest edge of a stored preview. The gallery card is 260px wide; this covers it on a 2× screen. */
const THUMB_MAX_PX = 520;
const THUMB_QUALITY = 72;

export type ParsedDataUrl = { buffer: Buffer; contentType: string };

/**
 * The bytes behind a `data:` URL, or null for anything else — an https URL that
 * has already been stored, an empty string, a value that isn't a string.
 */
export const parseDataUrl = (value: unknown): ParsedDataUrl | null => {
  if (typeof value !== "string") return null;
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value.trim());
  if (!match) return null;
  const [, contentType, base64] = match;
  if (!contentType.startsWith("image/")) return null;
  try {
    const buffer = Buffer.from(base64, "base64");
    return buffer.length > 0 ? { buffer, contentType } : null;
  } catch {
    return null;
  }
};

/**
 * Stores a design thumbnail and returns its URL.
 *
 * Best-effort by design: if the value isn't a data URL it is already a stored
 * address and passes through untouched, and if storing fails the original value
 * is returned so a preview picture can never fail a customer's save.
 */
export const storeDesignThumbnail = async (thumbnail: unknown): Promise<unknown> => {
  const parsed = parseDataUrl(thumbnail);
  if (!parsed) return thumbnail;

  try {
    const resized = await sharp(parsed.buffer, { limitInputPixels: false })
      .resize({ width: THUMB_MAX_PX, height: THUMB_MAX_PX, fit: "inside", withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();
    const stored = await storeArtwork(resized, "design-thumbnails", "image/webp");
    return stored.url;
  } catch (error) {
    console.error("[designThumbnail] could not store a preview; keeping the inline copy", error);
    return thumbnail;
  }
};
