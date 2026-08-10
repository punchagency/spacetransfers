/**
 * Viewport-culling geometry for the artboard.
 *
 * `CanvasContainer` mounts only the items whose vertical band intersects the
 * visible scroll range. That makes large sheets viable, but it also means a
 * wrong extent hides real artwork — so these tests pin the property that
 * matters most: the computed band must never be *shorter* than what the item
 * actually draws. Rendering a few extra items is invisible; culling a visible
 * one is a bug the customer sees.
 */
import { describe, it, expect } from "vitest";
import { getItemVerticalExtent } from "../components/artboard/lib/utils/layoutHelpers";

const SHEET_W = 23.5;
const MARGIN = 0.15;
const GAP = 0.1;

const extent = (item: Parameters<typeof getItemVerticalExtent>[0]) =>
  getItemVerticalExtent(item, SHEET_W, MARGIN, GAP);

const base = { widthIn: 4, heightIn: 3, posY: 10, copies: 1 };

describe("getItemVerticalExtent", () => {
  it("spans exactly the item height for a single copy", () => {
    const { topIn, bottomIn } = extent(base);
    expect(topIn).toBe(10);
    expect(bottomIn).toBeCloseTo(13, 6);
  });

  it("stays one row while copies fit across the sheet width", () => {
    // 23.5in wide, 0.15 margins, 4in items: five fit on one row, so the band
    // must not grow.
    const { topIn, bottomIn } = extent({ ...base, copies: 5 });
    expect(bottomIn - topIn).toBeCloseTo(3, 6);
  });

  it("grows by whole rows once copies wrap", () => {
    // Six 4in copies need two rows: 3 + 0.1 + 3.
    const { bottomIn, topIn } = extent({ ...base, copies: 6 });
    expect(bottomIn - topIn).toBeCloseTo(6.1, 6);
  });

  it("accounts for a 90° nest rotation swapping width and height", () => {
    // Rotated, the cell is 3in wide × 4in tall, so a single copy is 4in tall.
    const { topIn, bottomIn } = extent({ ...base, nestRotation: 90 });
    expect(bottomIn - topIn).toBeCloseTo(4, 6);
  });

  it("respects flow columns when the layout engine assigns a lane", () => {
    // Two columns only, starting at column 0: four copies means two rows.
    const { topIn, bottomIn } = extent({
      ...base,
      copies: 4,
      flowCols: 2,
      flowStartCol: 0,
      flowEndCol: 1,
    });
    expect(bottomIn - topIn).toBeCloseTo(6.1, 6);
  });

  it("counts the short first row when a lane starts mid-row", () => {
    // Starting at column 1 of 2 leaves a single cell in the first row, so the
    // remaining two copies fill exactly one more row: 2 rows, not 1.
    const { topIn, bottomIn } = extent({
      ...base,
      copies: 3,
      flowCols: 2,
      flowStartCol: 1,
      flowEndCol: 0,
    });
    expect(bottomIn - topIn).toBeCloseTo(6.1, 6);
  });

  it("clamps a group that would overhang the 1200in sheet limit", () => {
    // Positioned past the end of the sheet; the item is pulled back so its
    // bottom lands exactly on the limit, matching ArtboardItem's own clamp.
    const { topIn, bottomIn } = extent({ ...base, posY: 1199 });
    expect(bottomIn).toBeCloseTo(1200, 6);
    expect(topIn).toBeCloseTo(1197, 6);
  });

  it("never reports a band shorter than the drawn height", () => {
    // The invariant culling depends on. Swept across shapes and copy counts
    // because an underestimate anywhere makes artwork disappear on scroll.
    for (const copies of [1, 2, 7, 25, 100]) {
      for (const heightIn of [0.5, 3, 11.25]) {
        for (const widthIn of [0.5, 4, 23]) {
          const e = extent({ widthIn, heightIn, posY: 5, copies });
          expect(e.bottomIn - e.topIn).toBeGreaterThanOrEqual(heightIn - 1e-6);
          expect(e.bottomIn).toBeGreaterThan(e.topIn);
        }
      }
    }
  });

  it("produces a finite band for degenerate dimensions", () => {
    // A zero-height item should not yield NaN and take the whole sheet with it.
    const e = extent({ widthIn: 0, heightIn: 0, posY: 0, copies: 1 });
    expect(Number.isFinite(e.topIn)).toBe(true);
    expect(Number.isFinite(e.bottomIn)).toBe(true);
  });
});

describe("cull decision", () => {
  // Mirrors the intersection test in CanvasContainer.
  const intersects = (
    item: Parameters<typeof getItemVerticalExtent>[0],
    scrollTop: number,
    viewportHeight: number,
    pxPerInch: number,
    overscanPx: number,
  ) => {
    const { topIn, bottomIn } = extent(item);
    const bandTop = scrollTop - overscanPx;
    const bandBottom = scrollTop + viewportHeight + overscanPx;
    return bottomIn * pxPerInch >= bandTop && topIn * pxPerInch <= bandBottom;
  };

  const PPI = 96;

  it("keeps an item inside the viewport", () => {
    expect(intersects({ ...base, posY: 2 }, 0, 800, PPI, 900)).toBe(true);
  });

  it("drops an item far below the viewport", () => {
    // 500in down at 96px/in is ~48000px — far outside a 800px viewport.
    expect(intersects({ ...base, posY: 500 }, 0, 800, PPI, 900)).toBe(false);
  });

  it("keeps an item just outside the viewport but within overscan", () => {
    // 12in ≈ 1152px, past an 800px viewport but inside the 900px overscan.
    expect(intersects({ ...base, posY: 12 }, 0, 800, PPI, 900)).toBe(true);
  });

  it("follows the viewport as the user scrolls", () => {
    const item = { ...base, posY: 500 };
    expect(intersects(item, 0, 800, PPI, 900)).toBe(false);
    // Scrolled to that item's band (500in × 96 = 48000px).
    expect(intersects(item, 48000, 800, PPI, 900)).toBe(true);
  });

  it("accounts for zoom when converting inches to scroll pixels", () => {
    // The same item and the same scroll position give different answers at
    // different zooms, which is the whole reason zoom is in the conversion.
    const item = { ...base, posY: 30 };
    // At 0.5× it sits at 30 × 48 = 1440px, inside the 1700px band.
    expect(intersects(item, 0, 800, PPI * 0.5, 900)).toBe(true);
    // At 3× the same item is at 30 × 288 = 8640px, well outside it.
    expect(intersects(item, 0, 800, PPI * 3, 900)).toBe(false);
    // Scrolling to it at 3× brings it back.
    expect(intersects(item, 8640, 800, PPI * 3, 900)).toBe(true);
  });

  it("keeps a tall multi-copy group visible from either end", () => {
    // 200 copies of a 3in item spans many rows; scrolling to its middle must
    // still render it even though its stored posY is far above the viewport.
    const tall = { ...base, posY: 0, copies: 200 };
    const { bottomIn } = extent(tall);
    expect(bottomIn).toBeGreaterThan(100);
    expect(intersects(tall, bottomIn * PPI - 400, 800, PPI, 900)).toBe(true);
  });
});
