import { assetFingerprint } from "./assetIdentity";

/**
 * A change-detection snapshot of the board.
 *
 * This is compared against a baseline to decide whether to prompt about unsaved
 * work — it is never sent anywhere, so it must carry identity, not content.
 *
 * It previously embedded each item's `url` verbatim. Since the editor writes
 * canvas results back as `data:image/png;base64,…`, that meant serializing
 * every image on the board into one string; on a busy sheet the result exceeded
 * V8's ~512 MB string cap and `JSON.stringify` threw `RangeError: Invalid
 * string length`. Fingerprinting the URLs keeps the snapshot's discriminating
 * power while making its size track item count instead of pixel count.
 */
export const getGangsheetSnapshot = (items: any[]): string => {
  if (!Array.isArray(items)) return "[]";

  return JSON.stringify(
    items.map((it: any) => ({
      assetId: assetFingerprint(it.originalUrl || it.assetId || it.url),
      url: assetFingerprint(it.url),
      widthIn: Math.round((it.widthIn || 0) * 1000) / 1000,
      heightIn: Math.round((it.heightIn || 0) * 1000) / 1000,
      posX: Math.round((it.posX || 0) * 1000) / 1000,
      posY: Math.round((it.posY || 0) * 1000) / 1000,
      rotation: it.rotation || 0,
      copies: it.copies || 1,
      linked: Boolean(it.linked),
      autoCrop: it.autoCrop !== false,
      flipped: Boolean(it.flipped),
      locked: Boolean(it.locked),
      expanded: Boolean(it.expanded),
      groupId: it.groupId || null,
    })),
  );
};

