import { describe, expect, it } from "vitest";
import {
  arrangeInitialLayout,
  calculateGridLayout,
  fitItemToPrintableArea,
  resolveDragPlacement,
  getItemFootprint,
  resolveFlowCols,
  separateCrowdedItems,
  sheetContentLengthIn,
} from "../components/artboard/lib/utils/layoutHelpers";

const SHEET = 23.5;
const MARGIN = 0.15;

const item = (id: number, widthIn: number, heightIn: number, extra: Record<string, unknown> = {}) => ({
  id,
  widthIn,
  heightIn,
  posX: MARGIN,
  posY: MARGIN,
  copies: 1,
  ...extra,
});

/** Deterministic, so a failure reproduces. */
const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

describe("sheet length (what the header bills)", () => {
  it("measures copies with the spacing setting, not a fixed gap", () => {
    // Eight 11in squares wrapped at two columns: four rows. The header used a
    // 0.06in gap here and quoted 44.18in for a sheet printing at 45.5in.
    const group = item(1, 11, 11, { copies: 8, flowCols: 2 });
    expect(sheetContentLengthIn([group], SHEET, MARGIN, 0.5)).toBeCloseTo(MARGIN + 4 * 11 + 3 * 0.5, 6);
  });

  it("measures a piece auto-nest turned on its side", () => {
    const nested = item(1, 20, 4, { nestRotation: 90 });
    expect(sheetContentLengthIn([nested], SHEET, MARGIN, 0.25)).toBeCloseTo(MARGIN + 20, 6);
  });

  it("wraps copies without a column count the way the export does", () => {
    // Four 5in pieces fit across, but 4+1 leaves three empty cells, so five wrap at three.
    const group = item(1, 5, 3, { copies: 5 });
    expect(resolveFlowCols(group, SHEET, MARGIN, 0.25)).toBe(3);
    expect(sheetContentLengthIn([group], SHEET, MARGIN, 0.25)).toBeCloseTo(MARGIN + 2 * 3 + 0.25, 6);
  });
});

describe("spacing holds for every piece", () => {
  const clearOf = (a: any, b: any, gap: number) => {
    const fa = getItemFootprint(a, SHEET, MARGIN, gap);
    const fb = getItemFootprint(b, SHEET, MARGIN, gap);
    return (
      fb.x >= fa.x + fa.w + gap - 1e-6 ||
      fa.x >= fb.x + fb.w + gap - 1e-6 ||
      fb.y >= fa.y + fa.h + gap - 1e-6 ||
      fa.y >= fb.y + fb.h + gap - 1e-6
    );
  };

  it("moves a hand-placed piece that is now too close, and nothing else", () => {
    const a = item(1, 4, 4, { posX: 1, posY: 1, pinned: true });
    const b = item(2, 4, 4, { posX: 5.1, posY: 1, pinned: true }); // 0.1in from a
    const c = item(3, 4, 4, { posX: 15, posY: 1, pinned: true });

    const moves = separateCrowdedItems([a, b, c], SHEET, MARGIN, 0.25);

    expect([...moves.keys()]).toEqual([2]);
    expect(clearOf(a, { ...b, ...moves.get(2) }, 0.25)).toBe(true);
    // The nearest clear spot, not a trip to the end of the sheet.
    expect(Math.hypot(moves.get(2)!.posX - b.posX, moves.get(2)!.posY - b.posY)).toBeLessThan(1);
  });

  it("never moves a locked piece", () => {
    const a = item(1, 4, 4, { posX: 1, posY: 1 });
    const b = item(2, 4, 4, { posX: 5.1, posY: 1, locked: true });

    const moves = separateCrowdedItems([a, b], SHEET, MARGIN, 0.25);

    expect(moves.has(2)).toBe(false);
    expect(clearOf({ ...a, ...moves.get(1) }, b, 0.25)).toBe(true);
  });

  it("leaves a sheet that already honours the spacing exactly as it is", () => {
    const packed = calculateGridLayout(
      [item(1, 6, 4), item(2, 3, 5), item(3, 8, 2, { copies: 3 }), item(4, 2, 2, { copies: 7 })],
      SHEET,
      0.25,
      true,
      MARGIN,
    );
    expect(separateCrowdedItems(packed, SHEET, MARGIN, 0.25).size).toBe(0);
  });
});

describe("auto-nest length", () => {
  const board = (seed: number, n: number) => {
    const r = rng(seed);
    return Array.from({ length: n }, (_, i) => item(i + 1, +(1 + r() * 9).toFixed(2), +(1 + r() * 9).toFixed(2)));
  };

  it("is never longer than a shelf pack of the same board", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const items = board(seed, 40);
      const nested = calculateGridLayout(items, SHEET, 0.25, true, MARGIN);
      const shelf = arrangeInitialLayout(items, SHEET, 0.25, MARGIN);
      expect(sheetContentLengthIn(nested, SHEET, MARGIN, 0.25)).toBeLessThanOrEqual(
        sheetContentLengthIn(shelf, SHEET, MARGIN, 0.25) + 1e-6,
      );
    }
  });

  it("keeps single pieces on the roll and apart", () => {
    const nested = calculateGridLayout(board(9, 60), SHEET, 0.25, true, MARGIN);
    const boxes = nested.map((it) => getItemFootprint(it, SHEET, MARGIN, 0.25));
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(MARGIN - 1e-6);
      expect(b.x + b.w).toBeLessThanOrEqual(SHEET - MARGIN + 1e-6);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap = a.x < b.x + b.w - 1e-6 && a.x + a.w > b.x + 1e-6 && a.y < b.y + b.h - 1e-6 && a.y + a.h > b.y + 1e-6;
        expect(overlap).toBe(false);
      }
    }
  });
});

describe("fitItemToPrintableArea", () => {
  const printable = SHEET - 2 * MARGIN;
  const fit = (it: any, canNestRotate = false) => fitItemToPrintableArea(it, SHEET, MARGIN, 0.25, canNestRotate);
  const right = (it: any) => getItemFootprint(it, SHEET, MARGIN, 0.25).x + getItemFootprint(it, SHEET, MARGIN, 0.25).w;

  it("moves a piece that runs off the right edge back onto the sheet", () => {
    // Reported: a photo pinned at 11.16in and then rotated to 20in wide reached 31.16in.
    const { item: next, scaled, changed } = fit(item(1, 20, 11.25, { posX: 11.16, pinned: true }));
    expect(changed).toBe(true);
    expect(scaled).toBe(false);
    expect(right(next)).toBeLessThanOrEqual(SHEET - MARGIN + 1e-6);
    expect([next.widthIn, next.heightIn]).toEqual([20, 11.25]);
  });

  it("scales a piece wider than the printable width down to fit, keeping its proportions", () => {
    const { item: next, scaled } = fit(item(1, 30, 16.875, { posX: 5 }));
    expect(scaled).toBe(true);
    expect(next.widthIn).toBeCloseTo(printable);
    expect(next.heightIn / next.widthIn).toBeCloseTo(16.875 / 30);
    expect(next.posX).toBeCloseTo(MARGIN);
  });

  it("leaves a piece the packer can turn to fit at full size", () => {
    // 30x10 does not fit across, but fits turned — auto-nest turns it instead.
    expect(fit(item(1, 30, 10), true).scaled).toBe(false);
    // Too big either way: shrunk.
    expect(fit(item(1, 30, 26), true).scaled).toBe(true);
  });

  it("measures a nested piece by its turned width", () => {
    const { item: next, changed } = fit(item(1, 20, 11.25, { nestRotation: 90, posX: 20 }));
    expect(changed).toBe(true);
    expect(right(next)).toBeLessThanOrEqual(SHEET - MARGIN + 1e-6);
    expect(next.widthIn).toBe(20);
  });

  it("re-wraps a copy group whose recorded columns no longer fit", () => {
    const { item: next } = fit(item(1, 5, 5, { copies: 6, flowCols: 6, posX: MARGIN }));
    expect(next.flowCols).toBeUndefined();
    expect(right(next)).toBeLessThanOrEqual(SHEET - MARGIN + 1e-6);
  });

  it("pushes a piece out of the top margin", () => {
    // The margin lines are the safe print area; the top one was enforced nowhere.
    const { item: next, changed, scaled } = fit(item(1, 5, 5, { posY: 0 }));
    expect(changed).toBe(true);
    expect(scaled).toBe(false);
    expect(next.posY).toBeCloseTo(MARGIN);
  });

  it("leaves a piece further down the sheet where it is", () => {
    expect(fit(item(1, 5, 5, { posY: 40 })).item.posY).toBe(40);
  });

  it("returns the same piece when it already fits", () => {
    const inside = item(1, 10, 10, { posX: 5 });
    const result = fit(inside);
    expect(result.changed).toBe(false);
    expect(result.item).toBe(inside);
  });
});

describe("resolveDragPlacement bounds", () => {
  const drop = (posX: number, posY: number) =>
    resolveDragPlacement(
      [{ id: 1, widthIn: 5, heightIn: 5, posX, posY, copies: 1 }],
      [1],
      SHEET,
      MARGIN,
      0.25,
    ).valid;

  it("accepts a drop inside the margins", () => {
    expect(drop(MARGIN, MARGIN)).toBe(true);
    expect(drop(SHEET - MARGIN - 5, 30)).toBe(true);
  });

  it("refuses a drop into the top margin, like the sides", () => {
    expect(drop(MARGIN, 0)).toBe(false);
    expect(drop(0, MARGIN)).toBe(false);
    expect(drop(SHEET - MARGIN - 5 + 0.01, MARGIN)).toBe(false);
  });
});
