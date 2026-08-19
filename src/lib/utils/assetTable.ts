/**
 * De-duplicates repeated asset URLs in an order payload.
 *
 * A gang sheet is, by design, the same few graphics repeated many times — that
 * is the product. But every placement was serialized with its own full copy of
 * the artwork URL, twice over (`assetId` and `croppedUrl`). A Cloudinary URL is
 * ~121 characters, so each placement cost ~360 bytes of which ~242 was the same
 * two strings written again:
 *
 *      placements   inline
 *           2000    0.70 MB
 *           5800    2.02 MB   ← crosses a 2 MB body limit
 *          15000    5.23 MB
 *
 * The unique-image count on such a sheet is typically 5–50. Sending the table
 * once and referring to entries by integer index makes the payload scale with
 * *distinct artwork* rather than with placement count, which removes the
 * ceiling rather than raising it.
 *
 * The wire format is deliberately plain — an array of URLs plus small integers.
 * It gzips well, is readable in devtools, and needs no decoder beyond an array
 * lookup.
 */

/** Wire shape for one gang-sheet item's artwork references. */
export interface AssetTable {
  /** Distinct URLs, in first-seen order. */
  urls: string[];
}

/** Index into `AssetTable.urls`, or -1 when the field was absent. */
export type AssetRef = number;

const NONE: AssetRef = -1;

/**
 * Builds an index over distinct strings.
 *
 * First-seen ordering keeps output stable for a given input, which matters for
 * inspecting a payload and for anything cached on it. A Map preserves insertion
 * order, so no sort is needed.
 */
export class AssetIndex {
  private readonly index = new Map<string, number>();

  /** Interns a URL and returns its reference, or -1 for an absent value. */
  ref(url: unknown): AssetRef {
    if (typeof url !== "string" || url === "") return NONE;
    const existing = this.index.get(url);
    if (existing !== undefined) return existing;
    const next = this.index.size;
    this.index.set(url, next);
    return next;
  }

  table(): AssetTable {
    return { urls: Array.from(this.index.keys()) };
  }

  get size(): number {
    return this.index.size;
  }
}

/**
 * Resolves a reference back to its URL.
 *
 * Shared with the server so both sides agree on what -1 and an out-of-range
 * index mean. Anything unresolvable becomes `undefined` rather than throwing: a
 * malformed reference should degrade one item's artwork, not reject an order
 * the customer has already paid for.
 */
export const deref = (table: AssetTable | undefined, ref: unknown): string | undefined => {
  if (!table || !Array.isArray(table.urls)) return undefined;
  if (typeof ref !== "number" || !Number.isInteger(ref) || ref < 0) return undefined;
  return table.urls[ref];
};
