import { describe, it, expect } from "vitest";
import {
  placeNewItems,
  calculateGridLayout,
  getItemFootprint,
} from "../components/artboard/lib/utils/layoutHelpers";
import { CANVAS } from "../config/artboard.config";

/**
 * Nesting into side gaps by rotation.
 *
 * The packer's rotation gate only asked whether an item fit the *sheet* width,
 * so a single-copy piece that fit the sheet but was too wide for the strip
 * beside a larger image was never offered the orientation that would have
 * fitted there. The strip stayed empty and the piece opened a new row.
 *
 * These tests pin the new behaviour and, just as importantly, the limits on
 * it: artwork is never resized, never duplicated, and never turned when it
 * already had a home the right way up.
 */

const W = CANVAS.SHEET_WIDTH_IN; // 23.5
const GAP = 0.1;
const MARGIN = 0.15;

const mk = (over: Partial<any> & { id: number }) => ({
  posX: 0,
  posY: 0,
  widthIn: 2,
  heightIn: 2,
  copies: 1,
  rotation: 0,
  locked: false,
  expanded: false,
  flipped: false,
  autoCrop: true,
  linked: true,
  price: 0,
  url: "",
  ...over,
});

const boxes = (placed: any[]) =>
  placed.map((p) => ({ id: p.id, ...getItemFootprint(p, W, MARGIN, GAP) }));

const countOverlaps = (placed: any[]) => {
  const b = boxes(placed);
  let n = 0;
  for (let i = 0; i < b.length; i++)
    for (let j = i + 1; j < b.length; j++) {
      const ox = Math.min(b[i].x + b[i].w, b[j].x + b[j].w) - Math.max(b[i].x, b[j].x);
      const oy = Math.min(b[i].y + b[i].h, b[j].y + b[j].h) - Math.max(b[i].y, b[j].y);
      if (ox > 1e-3 && oy > 1e-3) n++;
    }
  return n;
};

describe("rotating to nest into a side gap", () => {
  it("turns an item that is too wide for the strip beside a large image", () => {
    // A 16in-wide anchor leaves a ~7in strip on its right (23.2 usable).
    // The newcomer is 9in x 5in: too wide for the strip upright, but 5in wide
    // when turned, which fits.
    const anchor = mk({ id: 1, widthIn: 16, heightIn: 12, posX: MARGIN, posY: MARGIN });
    const newcomer = mk({ id: 2, widthIn: 9, heightIn: 5 });

    const placed = placeNewItems(
      [anchor, newcomer] as any,
      new Set([2]),
      W,
      GAP,
      MARGIN,
    ) as any[];

    const result = placed.find((p) => p.id === 2)!;
    expect(result.nestRotation).toBe(90);

    // And it genuinely nested beside the anchor rather than starting a row
    // underneath it.
    const anchorBox = boxes(placed).find((b) => b.id === 1)!;
    const newBox = boxes(placed).find((b) => b.id === 2)!;
    expect(newBox.y).toBeLessThan(anchorBox.y + anchorBox.h);
    expect(countOverlaps(placed)).toBe(0);
  });

  it("leaves an item upright when it already fits the gap that way", () => {
    // Same anchor, but a 4in x 6in newcomer fits the strip upright. The
    // conservatism that stops a portrait design being laid on its side for a
    // marginal scoring win has to survive this change.
    const anchor = mk({ id: 1, widthIn: 16, heightIn: 12, posX: MARGIN, posY: MARGIN });
    const newcomer = mk({ id: 2, widthIn: 4, heightIn: 6 });

    const placed = placeNewItems(
      [anchor, newcomer] as any,
      new Set([2]),
      W,
      GAP,
      MARGIN,
    ) as any[];

    expect(placed.find((p) => p.id === 2)!.nestRotation).toBe(0);
  });

  it("never rotates a square item", () => {
    const anchor = mk({ id: 1, widthIn: 16, heightIn: 12, posX: MARGIN, posY: MARGIN });
    const square = mk({ id: 2, widthIn: 9, heightIn: 9 });

    const placed = placeNewItems(
      [anchor, square] as any,
      new Set([2]),
      W,
      GAP,
      MARGIN,
    ) as any[];

    expect(placed.find((p) => p.id === 2)!.nestRotation).toBe(0);
  });
});

describe("nesting never alters the artwork", () => {
  /**
   * `multiCopy: false` keeps every group a single cell, which is what makes a
   * bounding-box overlap check meaningful: the packer reserves each group's
   * *true* cells, so the empty cells of a short last row are ordinary free
   * space that later items are packed into. Multi-copy groups therefore
   * interlock at bounding-box level by design, and asserting otherwise fails
   * on correct output — the same false positive `layoutGolden.test.ts`
   * documents.
   */
  const corpus = (multiCopy = true) => {
    let seed = 7;
    const r = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    return Array.from({ length: 150 }, (_, i) =>
      mk({
        id: i,
        widthIn: +(0.5 + r() * 10).toFixed(3),
        heightIn: +(0.5 + r() * 10).toFixed(3),
        copies: multiCopy ? 1 + Math.floor(r() * 4) : 1,
      }),
    );
  };

  it("preserves every item's dimensions and aspect ratio exactly", () => {
    const items = corpus();
    const before = new Map(items.map((i) => [i.id, { w: i.widthIn, h: i.heightIn }]));
    const placed = calculateGridLayout(items, W, GAP, true, MARGIN) as any[];

    for (const p of placed) {
      const src = before.get(p.id)!;
      // Rotation is a render flag; the stored dimensions must be untouched, or
      // the artwork would be stretched into a different aspect ratio.
      expect(p.widthIn).toBe(src.w);
      expect(p.heightIn).toBe(src.h);
      expect(p.widthIn / p.heightIn).toBeCloseTo(src.w / src.h, 12);
    }
  });

  it("places every item exactly once, with no duplication or loss", () => {
    const items = corpus();
    const placed = calculateGridLayout(items, W, GAP, true, MARGIN) as any[];

    expect(placed).toHaveLength(items.length);
    expect(new Set(placed.map((p) => p.id)).size).toBe(items.length);
    // Copy counts drive how much artwork is printed — nesting must not touch them.
    const copiesBefore = new Map(items.map((i) => [i.id, i.copies]));
    for (const p of placed) expect(p.copies).toBe(copiesBefore.get(p.id));
  });

  it("produces no overlapping footprints and respects the margins", () => {
    const items = corpus(false);
    const placed = calculateGridLayout(items, W, GAP, true, MARGIN) as any[];

    expect(countOverlaps(placed)).toBe(0);
    for (const b of boxes(placed)) {
      expect(b.x).toBeGreaterThanOrEqual(MARGIN - 1e-6);
      // Rotated or not, nothing may cross the 23.5in sheet's right margin.
      expect(b.x + b.w).toBeLessThanOrEqual(W - MARGIN + 1e-3);
    }
  });

  it("keeps the sheet no longer than the previous algorithm produced", () => {
    // Measured regression guard. Before rotation-into-gaps this corpus packed
    // to 217.5in single-copy and 577.5in multi-copy; it now reaches 209.3in
    // and 569.7in. The assertion is against the OLD figures, so it catches a
    // regression without breaking on further small improvements.
    const single = calculateGridLayout(corpus(false), W, GAP, true, MARGIN) as any[];
    const singleBottom = boxes(single).reduce((m, b) => Math.max(m, b.y + b.h), 0);
    expect(singleBottom).toBeLessThanOrEqual(217.5);

    const multi = calculateGridLayout(corpus(true), W, GAP, true, MARGIN) as any[];
    const multiBottom = boxes(multi).reduce((m, b) => Math.max(m, b.y + b.h), 0);
    expect(multiBottom).toBeLessThanOrEqual(577.5);
  });
});
