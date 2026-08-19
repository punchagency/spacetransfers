/**
 * Constant-cost identity and comparison for artwork-bearing objects.
 *
 * ## The failure this exists to prevent
 *
 *     RangeError: Invalid string length
 *       at JSON.stringify
 *
 * V8 caps a single string at roughly 512 MB. Nothing in this app deliberately
 * builds a string that large — but `JSON.stringify` on anything holding artwork
 * does, because the editor represents a canvas result (auto-crop, background
 * removal, an AI edit) as a `data:image/png;base64,…` URL living directly on
 * the item. One is tens of megabytes; a board holds many.
 *
 * Three call sites were doing exactly that, none of them to send data anywhere:
 *
 *  - `getGangsheetSnapshot` embedded `it.url` to detect unsaved changes, and
 *    `Editor` called it *during render* rather than in a memo — so every
 *    keystroke, hover and state flip re-serialized every image on the board.
 *  - `CheckoutModal` compared carts with
 *    `JSON.stringify(a) !== JSON.stringify(b)`, on an effect keyed to the cart
 *    itself, so every cart mutation serialized the whole cart twice.
 *  - The cart was persisted to `localStorage` with the data URLs still in it.
 *
 * Serialization was being used as a *comparison* primitive. That is the
 * architectural error: comparing two objects should not cost the size of the
 * images inside them. These helpers compare identity and geometry directly, so
 * cost tracks item count rather than pixel count.
 *
 * ## Why a fingerprint rather than the URL
 *
 * A hosted URL is ~120 characters and is itself a perfectly good identity, so
 * it is used as-is. A `data:` URL is the image, so it is reduced to its scheme,
 * declared MIME type and length. Two different images of byte-identical length
 * would collide — but the consequence of a collision here is only a missed
 * "unsaved changes" prompt, and every mutation that produces a new data URL
 * (crop, resize, background removal) changes its length in practice. Paying
 * O(bytes) per render to close that gap is not a trade worth making.
 */

/** Longest string treated as a reference rather than as embedded payload. */
const MAX_REFERENCE_LENGTH = 2048;

/**
 * A short, stable identity for an artwork reference.
 *
 * Costs O(1) regardless of how large the underlying image is.
 */
export const assetFingerprint = (url: unknown): string => {
  if (typeof url !== "string" || url === "") return "";
  if (!url.startsWith("data:")) {
    // A hosted URL is already short and unique. Long non-data URLs are
    // truncated rather than trusted wholesale so a pathological query string
    // cannot reintroduce the cost this function exists to avoid.
    return url.length <= MAX_REFERENCE_LENGTH ? url : url.slice(0, MAX_REFERENCE_LENGTH);
  }

  // `data:image/png;base64,` → keep the declared type, drop the payload.
  const comma = url.indexOf(",");
  const header = comma > 0 ? url.slice(0, comma) : "data:";
  return `${header}#${url.length}`;
};

/** True when a string is embedded image data rather than a reference to it. */
export const isDataUrl = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("data:");

/**
 * Fields that identify an item's visual state without touching its pixels.
 *
 * Kept explicit rather than derived from `Object.keys`: a future field holding
 * another data URL would otherwise silently rejoin the comparison and bring the
 * original bug back with it.
 */
const GEOMETRY_FIELDS = [
  "widthIn",
  "heightIn",
  "posX",
  "posY",
  "rotation",
  "copies",
  "quantity",
  "nestRotation",
  "flowCols",
  "flowStartCol",
  "flowEndCol",
] as const;

const FLAG_FIELDS = [
  "linked",
  "autoCrop",
  "flipped",
  "locked",
  "expanded",
  "pinned",
] as const;

/** Rounds a coordinate so float noise does not read as a change. */
const q = (value: unknown): number => Math.round((Number(value) || 0) * 1000) / 1000;

/**
 * Compares two artwork-bearing items for user-visible equality.
 *
 * Deliberately shallow and field-explicit. A deep structural walk would
 * traverse into the very payloads this is avoiding.
 */
export const itemsEquivalent = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;

  if (a.id !== b.id) return false;
  if (assetFingerprint(a.url) !== assetFingerprint(b.url)) return false;
  if (assetFingerprint(a.croppedUrl) !== assetFingerprint(b.croppedUrl)) return false;

  for (const field of GEOMETRY_FIELDS) {
    if (q(a[field]) !== q(b[field])) return false;
  }
  for (const field of FLAG_FIELDS) {
    if (Boolean(a[field]) !== Boolean(b[field])) return false;
  }
  return true;
};

/**
 * Compares two lists of artwork-bearing items.
 *
 * Replaces `JSON.stringify(a) !== JSON.stringify(b)` wherever that was used to
 * decide whether state needs updating.
 */
export const itemListsEquivalent = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!itemsEquivalent(a[i], b[i])) return false;
  }
  return true;
};

/**
 * Recursively replaces embedded image data with null.
 *
 * Applied *before* persisting rather than as a retry after a quota failure:
 * `JSON.stringify` on a board full of data URLs can exceed V8's string cap and
 * throw `RangeError` before `localStorage` ever gets the chance to report that
 * it is full, so the fallback never ran.
 *
 * Depth-limited because artboard items can hold parent back-references, and an
 * unguarded walk over one never returns.
 */
export const stripEmbeddedData = <T,>(value: T, depth = 0): T => {
  if (depth > 12) return null as unknown as T;
  if (value == null) return value;
  if (typeof value === "string") {
    return (value.startsWith("data:") ? null : value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => stripEmbeddedData(entry, depth + 1)) as unknown as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as unknown as object)) {
      out[key] = stripEmbeddedData((value as any)[key], depth + 1);
    }
    return out as unknown as T;
  }
  return value;
};
