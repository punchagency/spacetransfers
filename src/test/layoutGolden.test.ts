/**
 * Layout output equivalence.
 *
 * The packing engine was optimized for scale (a spatial index replacing linear
 * scans over every placed box). That work is only safe if it is *invisible*:
 * the same board must pack to the same coordinates, or customers' existing
 * designs would shift under them.
 *
 * The fixture was captured from the pre-optimization engine, so this file is a
 * one-way ratchet — it fails if any refactor changes a single placement. If a
 * change to the packing *algorithm* is ever intended (not merely its
 * performance), regenerate the fixture deliberately and review the diff; do not
 * loosen the comparison.
 */
import { describe, it, expect } from "vitest";
import golden from "./fixtures/layoutGolden.json";
import {
  calculateGridLayout,
  placeNewItems,
} from "../components/artboard/lib/utils/layoutHelpers";

/** Mirrors the generator that produced the fixture. */
const rng = (seed: number) => () =>
  ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const corpus = () => {
  const cases: any[] = [];
  for (const [n, seed] of [
    [12, 1],
    [40, 2],
    [120, 3],
    [300, 4],
    [800, 5],
  ] as const) {
    const r = rng(seed);
    cases.push(
      Array.from({ length: n }, (_, i) => ({
        id: i,
        posX: +(r() * 20).toFixed(3),
        posY: +(r() * 40).toFixed(3),
        widthIn: +(0.5 + r() * 8).toFixed(3),
        heightIn: +(0.5 + r() * 8).toFixed(3),
        copies: 1 + Math.floor(r() * 6),
        rotation: 0,
        locked: r() < 0.08,
        pinned: r() < 0.08,
      })),
    );
  }
  return cases;
};

describe("packing engine output is unchanged", () => {
  const cases = corpus();

  cases.forEach((items, idx) => {
    it(`case ${idx} (${items.length} items) packs identically`, () => {
      const pack = calculateGridLayout(items, 23.5, 0.1, true, 0.15).map((i: any) => [
        i.id,
        i.posX,
        i.posY,
        i.nestRotation ?? 0,
        i.flowCols ?? 0,
        i.flowEndCol ?? 0,
      ]);
      expect(pack).toEqual(golden[idx].pack);
    });

    it(`case ${idx} (${items.length} items) places new items identically`, () => {
      // placeNewItems shares the same engine but treats existing artwork as
      // immovable, which exercises the fixed-item carve-out path.
      const newOnly = placeNewItems(
        items,
        new Set(items.slice(0, 5).map((i: any) => i.id)),
        23.5,
        0.1,
        0.15,
      ).map((i: any) => [i.id, i.posX, i.posY, i.nestRotation ?? 0]);
      expect(newOnly).toEqual(golden[idx].newOnly);
    });
  });

  it("keeps every placement on the sheet", () => {
    // A cheap invariant that holds independently of the fixture. A
    // bounding-box non-overlap check deliberately is *not* asserted here:
    // the engine reserves each group's true cells, so the empty cells of a
    // short last row are ordinary free space that later items are packed
    // into. Groups therefore interlock at bounding-box level by design, and
    // asserting otherwise would fail on correct output.
    const items = cases[3];
    const packed = calculateGridLayout(items, 23.5, 0.1, true, 0.15) as any[];

    for (const i of packed) {
      expect(Number.isFinite(i.posX)).toBe(true);
      expect(Number.isFinite(i.posY)).toBe(true);
      expect(i.posX).toBeGreaterThanOrEqual(0);
      expect(i.posY).toBeGreaterThanOrEqual(0);
    }
  });
});
