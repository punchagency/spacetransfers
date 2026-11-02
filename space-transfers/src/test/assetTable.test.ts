import { describe, it, expect } from "vitest";
import { AssetIndex, deref } from "../lib/utils/assetTable";

/**
 * A gang sheet is the same few graphics repeated many times — that is the
 * product. Every placement previously carried its own full copy of the artwork
 * URL, twice (`assetId` and `croppedUrl`), so a 5,000-placement sheet was ~2 MB
 * of mostly-repeated strings and exceeded the request body limit.
 */
const URL = (i: number) =>
  `https://res.cloudinary.com/dxxxxxxxx/image/upload/v1699999999/space-transfers/edited/${String(i).padStart(32, "0")}.png`;

/** Old shape: full URLs inline on every item. */
const inlineItem = (id: number, asset: number) => ({
  id, assetId: URL(asset), croppedUrl: URL(asset),
  widthIn: 5, heightIn: 5, posX: 0, posY: 0, rotation: 0, copies: 1, linked: false,
});

/** New shape: integer references into a per-sheet table. */
const buildDeduped = (placements: number, uniqueImages: number) => {
  const assets = new AssetIndex();
  const items = Array.from({ length: placements }, (_, i) => ({
    id: i,
    assetRef: assets.ref(URL(i % uniqueImages)),
    croppedRef: assets.ref(URL(i % uniqueImages)),
    widthIn: 5, heightIn: 5, posX: 0, posY: 0, rotation: 0, copies: 1, linked: false,
  }));
  return { items, assetTable: assets.table() };
};

const bytes = (v: unknown) => JSON.stringify(v).length;

describe("AssetIndex", () => {
  it("interns each distinct URL once", () => {
    const assets = new AssetIndex();
    expect(assets.ref(URL(1))).toBe(0);
    expect(assets.ref(URL(2))).toBe(1);
    expect(assets.ref(URL(1))).toBe(0);
    expect(assets.size).toBe(2);
  });

  it("returns -1 for absent values rather than inventing an entry", () => {
    const assets = new AssetIndex();
    for (const empty of ["", null, undefined, 42]) {
      expect(assets.ref(empty as any)).toBe(-1);
    }
    expect(assets.size).toBe(0);
  });

  it("preserves first-seen order so payloads are stable", () => {
    const assets = new AssetIndex();
    assets.ref(URL(3)); assets.ref(URL(1)); assets.ref(URL(3)); assets.ref(URL(2));
    expect(assets.table().urls).toEqual([URL(3), URL(1), URL(2)]);
  });
});

describe("payload size", () => {
  it("cuts a large sheet to roughly a third", () => {
    // Measured: ~1.74 MB inline vs ~0.59 MB deduped at 5,000 placements, since
    // ~242 of the ~360 bytes per item were two repeated copies of one URL.
    const before = bytes(Array.from({ length: 5000 }, (_, i) => inlineItem(i, i % 20)));
    const after = bytes(buildDeduped(5000, 20));
    expect(before / after).toBeGreaterThan(2.5);
  });

  it("moves the 2 MB ceiling roughly 3x further out", () => {
    // Inline crossed the limit at ~5,800 placements. The deduped shape has to
    // clear that comfortably — that is the whole point of the change.
    const LIMIT = 2 * 1024 * 1024;
    expect(bytes(Array.from({ length: 5800 }, (_, i) => inlineItem(i, i % 20)))).toBeGreaterThan(LIMIT);
    expect(bytes(buildDeduped(5800, 20))).toBeLessThan(LIMIT);
    expect(bytes(buildDeduped(15000, 20))).toBeLessThan(LIMIT);
  });

  it("scales with distinct artwork, not placement count", () => {
    // The property that removes the ceiling: 10x the placements must not cost
    // 10x the bytes when the artwork is the same.
    const small = bytes(buildDeduped(500, 20));
    const large = bytes(buildDeduped(5000, 20));
    expect(large / small).toBeLessThan(11);

    // And adding distinct artwork is what actually costs bytes.
    expect(bytes(buildDeduped(5000, 200))).toBeGreaterThan(large);
  });
});

describe("deref", () => {
  const table = { urls: [URL(1), URL(2)] };

  it("resolves a valid reference", () => {
    expect(deref(table, 0)).toBe(URL(1));
    expect(deref(table, 1)).toBe(URL(2));
  });

  it("returns undefined for anything unresolvable", () => {
    // Degrading one item's artwork beats rejecting an order already paid for.
    for (const bad of [-1, 2, 99, 1.5, "0", null, undefined, NaN]) {
      expect(deref(table, bad as any)).toBeUndefined();
    }
    expect(deref(undefined, 0)).toBeUndefined();
    expect(deref({ urls: null as any }, 0)).toBeUndefined();
  });

  it("round-trips every placement back to its original URL", () => {
    const { items, assetTable } = buildDeduped(200, 7);
    items.forEach((item, i) => {
      expect(deref(assetTable, item.assetRef)).toBe(URL(i % 7));
      expect(deref(assetTable, item.croppedRef)).toBe(URL(i % 7));
    });
  });
});
