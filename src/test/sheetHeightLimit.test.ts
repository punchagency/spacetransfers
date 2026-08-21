import { describe, it, expect } from "vitest";
import {
  placeNewItems,
  getItemVerticalExtent,
  isSheetFull,
  remainingSheetHeightIn,
} from "../components/artboard/lib/utils/layoutHelpers";
import { CANVAS, MAX_SHEET_HEIGHT_IN } from "../config/artboard.config";

/**
 * Sheet-length limit.
 *
 * Written after a report that the artboard "hit its 1200-inch limit at about
 * 300 inches". It does not: the notice that fires there is the 1200-*item*
 * cap (`CANVAS.MAX_ITEMS`), an unrelated limit that happens to share the
 * number. These tests pin the two apart so neither can drift into the other,
 * and exercise the length limit at the heights that were asked about.
 */

const item = (id: number, posY: number, heightIn = 2, widthIn = 2) => ({
  id,
  posX: 0,
  posY,
  widthIn,
  heightIn,
  copies: 1,
  rotation: 0,
  locked: false,
  expanded: false,
  flipped: false,
  autoCrop: true,
  linked: true,
  price: 0,
  url: "",
});

describe("sheet length limit", () => {
  it("is 1200 inches, and the item cap is only a far-off safety ceiling", () => {
    expect(MAX_SHEET_HEIGHT_IN).toBe(1200);
    // The count cap must stay well above anything 1200in can hold, so the
    // LENGTH is always the limit that binds. ~76k half-inch placements fit in
    // 1200in; anything at or below that would silently become the real limit
    // again, which is the bug this whole area came from.
    expect(CANVAS.MAX_ITEMS).toBeGreaterThanOrEqual(76_000);
  });

  // The heights named in the bug report. None of these is near any limit, and
  // in particular 300in must behave exactly like 100in.
  for (const posY of [100, 300, 600, 900]) {
    it(`places an item at ${posY}in without clamping`, () => {
      const [placed] = placeNewItems(
        [item(1, posY)] as any,
        new Set([1]),
        CANVAS.SHEET_WIDTH_IN,
        CANVAS.DEFAULT_SPACING,
        CANVAS.DEFAULT_MARGIN,
      ) as any[];

      // The packer may flow it into a gap higher up — what must never happen
      // is it being pushed against the 1200in ceiling.
      expect(placed.posY).toBeGreaterThanOrEqual(0);
      expect(placed.posY + placed.heightIn).toBeLessThanOrEqual(MAX_SHEET_HEIGHT_IN);
    });
  }

  it("allows an item whose bottom edge lands exactly on 1200in", () => {
    const h = 2;
    const extent = getItemVerticalExtent(
      item(1, MAX_SHEET_HEIGHT_IN - h, h) as any,
      CANVAS.SHEET_WIDTH_IN,
      CANVAS.DEFAULT_MARGIN,
      CANVAS.DEFAULT_SPACING,
    );
    expect(extent.bottomIn).toBeLessThanOrEqual(MAX_SHEET_HEIGHT_IN + 1e-6);
    expect(extent.bottomIn).toBeCloseTo(MAX_SHEET_HEIGHT_IN, 6);
  });

  it("clamps an item that would extend past 1200in", () => {
    const h = 10;
    // Deliberately beyond the ceiling.
    const extent = getItemVerticalExtent(
      item(1, MAX_SHEET_HEIGHT_IN + 50, h) as any,
      CANVAS.SHEET_WIDTH_IN,
      CANVAS.DEFAULT_MARGIN,
      CANVAS.DEFAULT_SPACING,
    );
    expect(extent.bottomIn).toBeLessThanOrEqual(MAX_SHEET_HEIGHT_IN + 1e-6);
  });

  it("never returns a packed position past 1200in, even for a tall stack", () => {
    // 400 two-inch items is ~76in of content — comfortably inside the sheet,
    // and the packer must not invent positions beyond the ceiling for any of
    // them.
    const items = Array.from({ length: 400 }, (_, i) => item(i + 1, 0));
    const placed = placeNewItems(
      items as any,
      new Set(items.map((i) => i.id)),
      CANVAS.SHEET_WIDTH_IN,
      CANVAS.DEFAULT_SPACING,
      CANVAS.DEFAULT_MARGIN,
    ) as any[];

    for (const p of placed) {
      expect(p.posY).toBeGreaterThanOrEqual(0);
      expect(p.posY + p.heightIn).toBeLessThanOrEqual(MAX_SHEET_HEIGHT_IN + 1e-6);
    }
  });

  /**
   * The measurement behind the report.
   *
   * The physical height at which the item cap is reached is a function of
   * artwork size, not of any length limit — measured in-browser at ~166in for
   * 2in artwork and ~978in for 4in artwork. This asserts the relationship
   * rather than a specific number, so it documents *why* "about 300 inches"
   * was observed without being brittle about it.
   */
  it("the item cap can no longer be reached before the sheet fills", () => {
    const perRow = (sizeIn: number) =>
      Math.max(
        1,
        Math.floor(
          (CANVAS.SHEET_WIDTH_IN - 2 * CANVAS.DEFAULT_MARGIN) /
            (sizeIn + CANVAS.DEFAULT_SPACING),
        ),
      );
    const capHeight = (sizeIn: number) =>
      Math.ceil(CANVAS.MAX_ITEMS / perRow(sizeIn)) * (sizeIn + CANVAS.DEFAULT_SPACING);

    // With the cap raised, the height at which it *would* bite now exceeds the
    // sheet for every artwork size — so the sheet always fills first.
    for (const size of [0.5, 1, 2, 4]) {
      expect(capHeight(size)).toBeGreaterThan(MAX_SHEET_HEIGHT_IN);
    }
  });
});

describe("sheet length is the binding limit", () => {
  const many = (n: number, size = 1) =>
    Array.from({ length: n }, (_, i) => item(i + 1, 0, size, size));

  it("never packs an item past 1200in, even when given far more than fits", () => {
    // 25,000 one-inch items need ~1310in — more than the sheet has. Before the
    // packer had a ceiling this returned positions out past the sheet's end.
    const items = many(25_000);
    const overflowed = new Set<number>();
    const placed = placeNewItems(
      items as any,
      new Set(items.map((i) => i.id)),
      CANVAS.SHEET_WIDTH_IN,
      CANVAS.DEFAULT_SPACING,
      CANVAS.DEFAULT_MARGIN,
      overflowed,
    ) as any[];

    for (const p of placed) {
      if (overflowed.has(p.id)) continue;
      expect(p.posY + p.heightIn).toBeLessThanOrEqual(MAX_SHEET_HEIGHT_IN + 1e-3);
    }
    // And the ones that could not fit are reported rather than silently stacked.
    expect(overflowed.size).toBeGreaterThan(0);
  });

  it("reports nothing as overflowed when the batch comfortably fits", () => {
    const items = many(500);
    const overflowed = new Set<number>();
    placeNewItems(
      items as any,
      new Set(items.map((i) => i.id)),
      CANVAS.SHEET_WIDTH_IN,
      CANVAS.DEFAULT_SPACING,
      CANVAS.DEFAULT_MARGIN,
      overflowed,
    );
    expect(overflowed.size).toBe(0);
  });

  it("isSheetFull tracks length, not count", () => {
    // Thousands of images, nowhere near the sheet's end → not full.
    expect(isSheetFull(many(5_000) as any)).toBe(false);
    // A single image sitting at the bottom → full.
    expect(isSheetFull([item(1, MAX_SHEET_HEIGHT_IN - 1, 1)] as any)).toBe(true);
  });

  it("remaining length shrinks as content grows", () => {
    expect(remainingSheetHeightIn([] as any)).toBe(MAX_SHEET_HEIGHT_IN);
    expect(remainingSheetHeightIn([item(1, 100, 2)] as any)).toBeCloseTo(
      MAX_SHEET_HEIGHT_IN - 102,
      6,
    );
  });
});
