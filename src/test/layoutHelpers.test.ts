import { describe, it, expect } from "vitest";
import {
  planLocalDisplacement,
  placeNewItems,
  arrangeInitialLayout,
  getItemFootprint,
  computeEffectiveDpi,
  calculateGridLayout,
  type LayoutItem,
} from "../components/artboard/lib/utils/layoutHelpers";

const SHEET_W = 23.5;
const MARGIN = 0.15;
const GAP = 0.1;

const makeItem = (
  id: number,
  posX: number,
  posY: number,
  widthIn = 4,
  heightIn = 4,
  extra: Partial<LayoutItem> = {},
): LayoutItem => ({ id, posX, posY, widthIn, heightIn, copies: 1, ...extra });

const overlaps = (a: LayoutItem, b: LayoutItem) => {
  const fa = getItemFootprint(a, SHEET_W, MARGIN, GAP);
  const fb = getItemFootprint(b, SHEET_W, MARGIN, GAP);
  return (
    fa.x < fb.x + fb.w &&
    fa.x + fa.w > fb.x &&
    fa.y < fb.y + fb.h &&
    fa.y + fa.h > fb.y
  );
};

const applyMoves = (items: LayoutItem[], moves: Map<number, { posX: number; posY: number }>) =>
  items.map((it) => {
    const m = moves.get(it.id);
    return m ? { ...it, posX: m.posX, posY: m.posY } : it;
  });

describe("planLocalDisplacement", () => {
  it("returns no moves when nothing overlaps", () => {
    const items = [
      makeItem(1, 0.15, 0.15),
      makeItem(2, 5, 0.15),
      makeItem(3, 10, 0.15),
    ];
    const moves = planLocalDisplacement(items, [1], SHEET_W, MARGIN, GAP);
    expect(moves.size).toBe(0);
  });

  it("displaces only the overlapped neighbor, leaving distant items untouched", () => {
    const items = [
      makeItem(1, 4.5, 0.15), // dragged onto item 2
      makeItem(2, 5, 0.15),
      makeItem(3, 15, 0.15), // far away — must not move
      makeItem(4, 0.15, 20), // far away — must not move
    ];
    const moves = planLocalDisplacement(items, [1], SHEET_W, MARGIN, GAP);
    expect(moves.has(2)).toBe(true);
    expect(moves.has(3)).toBe(false);
    expect(moves.has(4)).toBe(false);

    const resolved = applyMoves(items, moves);
    for (let i = 0; i < resolved.length; i++) {
      for (let j = i + 1; j < resolved.length; j++) {
        expect(overlaps(resolved[i], resolved[j])).toBe(false);
      }
    }
  });

  it("never moves the active (dragged) items or locked items", () => {
    const items = [
      makeItem(1, 4.5, 0.15),
      makeItem(2, 5, 0.15, 4, 4, { locked: true }),
      makeItem(3, 9.3, 0.15),
    ];
    const moves = planLocalDisplacement(items, [1], SHEET_W, MARGIN, GAP);
    expect(moves.has(1)).toBe(false);
    expect(moves.has(2)).toBe(false);
  });

  it("swaps the overlapped neighbor into the vacated hole, moving nothing else", () => {
    // A tight 3-wide row. Grab the middle item and drop it onto its right
    // neighbor: iOS-style, the neighbor should take the hole the middle item
    // just left (a swap), and the far-left item must not budge at all.
    const items = [
      makeItem(1, 0.15, 0.15, 3, 3), // left — must stay put
      makeItem(2, 3.25, 0.15, 3, 3), // dragged (was middle), now over item 3
      makeItem(3, 6.35, 0.15, 3, 3), // right neighbor it lands on
    ];
    const origin = new Map([[2, { posX: 3.25, posY: 0.15 }]]);
    // Item 2 dragged right, squarely onto item 3 and fully clear of its own
    // origin slot (so the hole is genuinely open for item 3 to take).
    const dragged = items.map((it) =>
      it.id === 2 ? { ...it, posX: 6.5, posY: 0.15 } : it,
    );
    const moves = planLocalDisplacement(dragged, [2], SHEET_W, MARGIN, GAP, origin);

    expect(moves.has(1)).toBe(false); // untouched
    expect(moves.has(3)).toBe(true); // the only displaced item
    expect(moves.size).toBe(1);
    // Item 3 slides LEFT into the region item 2 vacated (same row, near the
    // hole) — not flung off to the right past the dragged item (~9.6").
    const m3 = moves.get(3)!;
    expect(m3.posX).toBeLessThan(4);
    expect(m3.posX).toBeGreaterThanOrEqual(MARGIN);
    expect(m3.posY).toBeCloseTo(0.15, 3);

    const resolved = applyMoves(dragged, moves);
    for (let i = 0; i < resolved.length; i++)
      for (let j = i + 1; j < resolved.length; j++)
        expect(overlaps(resolved[i], resolved[j])).toBe(false);
  });

  it("cascades pushes through a packed row without exploding the layout", () => {
    // A tight row of items; dragging onto the first should ripple locally.
    const items = [
      makeItem(1, 0.5, 0.5, 3, 3), // dragged, overlapping item 2
      makeItem(2, 2, 0.5, 3, 3),
      makeItem(3, 5.2, 0.5, 3, 3),
      makeItem(4, 8.4, 0.5, 3, 3),
      makeItem(5, 0.5, 15, 3, 3), // far below — stays put
    ];
    const moves = planLocalDisplacement(items, [1], SHEET_W, MARGIN, GAP);
    expect(moves.has(5)).toBe(false);
    const resolved = applyMoves(items, moves);
    for (let i = 0; i < resolved.length; i++) {
      for (let j = i + 1; j < resolved.length; j++) {
        expect(overlaps(resolved[i], resolved[j])).toBe(false);
      }
    }
  });

  it("reflows a displaced neighbor sideways within its row, not vertically", () => {
    // Dragging an item into a row must push the overlapped neighbor sideways
    // (same row) so the row stays intact — NOT eject it up/down and leave a
    // vertical gap. There's open room to the right in this row, so the neighbor
    // must stay on the row (posY unchanged) and move only in x.
    const items = [
      makeItem(1, 4.4, 0.15, 3, 3), // dragged, landing onto item 2
      makeItem(2, 5, 0.15, 3, 3), // overlapped neighbor — must slide sideways
      makeItem(3, 0.15, 6, 3, 3), // different row, far — must not move
    ];
    const moves = planLocalDisplacement(items, [1], SHEET_W, MARGIN, GAP);
    expect(moves.has(2)).toBe(true);
    expect(moves.has(3)).toBe(false);
    const m2 = moves.get(2)!;
    expect(m2.posY).toBeCloseTo(0.15, 4); // stayed on its row — no vertical pop
    expect(Math.abs(m2.posX - 5)).toBeGreaterThan(0.1); // actually moved sideways

    const resolved = applyMoves(items, moves);
    for (let i = 0; i < resolved.length; i++)
      for (let j = i + 1; j < resolved.length; j++)
        expect(overlaps(resolved[i], resolved[j])).toBe(false);
  });
});

describe("placeNewItems", () => {
  it("never repositions existing items and places new ones without overlap", () => {
    const existing = [
      makeItem(1, 0.15, 0.15, 6, 6),
      makeItem(2, 12, 0.15, 6, 6),
    ];
    const fresh = makeItem(3, 10, 30, 4, 4); // arbitrary drop position
    const all = [...existing, fresh];
    const result = placeNewItems(all, new Set([3]), SHEET_W, GAP, MARGIN);

    for (const ex of existing) {
      const r = result.find((it) => it.id === ex.id)!;
      expect(r.posX).toBe(ex.posX);
      expect(r.posY).toBe(ex.posY);
    }
    const placed = result.find((it) => it.id === 3)!;
    for (const ex of existing) {
      expect(overlaps(placed, result.find((it) => it.id === ex.id)!)).toBe(false);
    }
    // Should have used the gap between/beside the existing items rather than
    // being flung to the far bottom.
    expect(placed.posY).toBeLessThan(15);
  });
});

describe("arrangeInitialLayout", () => {
  it("fills a single row across the sheet width for mixed-height items", () => {
    // 2x3, 3x2, 2x2 — total width 7.2in of 23.2in usable: ALL must share row 1
    // (the gap packer used to stack the taller item below, wasting the row).
    const items = [
      makeItem(1, 0, 0, 3, 2),
      makeItem(2, 0, 0, 2, 2),
      makeItem(3, 0, 0, 2, 3),
    ];
    const result = arrangeInitialLayout(items, SHEET_W, GAP, MARGIN);
    for (const it of result) expect(it.posY).toBeCloseTo(MARGIN, 5);
    // tallest first, then left-to-right with the spacing gap
    const byX = [...result].sort((a, b) => a.posX - b.posX);
    expect(byX.map((i) => i.id)).toEqual([3, 1, 2]);
    expect(byX[0].posX).toBeCloseTo(MARGIN, 5);
    expect(byX[1].posX).toBeCloseTo(MARGIN + 2 + GAP, 5);
    expect(byX[2].posX).toBeCloseTo(MARGIN + 2 + GAP + 3 + GAP, 5);
  });

  it("wraps to a new shelf when the row is full, without overlaps", () => {
    // 6 items of 5x4: usable 23.2in fits 4 per row (4*5 + 3*0.1 = 20.3)
    const items = Array.from({ length: 6 }, (_, i) => makeItem(i + 1, 0, 0, 5, 4));
    const result = arrangeInitialLayout(items, SHEET_W, GAP, MARGIN);
    const row1 = result.filter((i) => Math.abs(i.posY - MARGIN) < 1e-6);
    const row2 = result.filter((i) => i.posY > MARGIN + 1e-6);
    expect(row1.length).toBe(4);
    expect(row2.length).toBe(2);
    for (const it of row2) expect(it.posY).toBeCloseTo(MARGIN + 4 + GAP, 5);
    for (let i = 0; i < result.length; i++)
      for (let j = i + 1; j < result.length; j++)
        expect(overlaps(result[i], result[j])).toBe(false);
  });

  it("backfills a later short item into an earlier row with room (first-fit)", () => {
    // Tall 20-wide item fills most of row 1; two 4x4s open row 2; a 2x1
    // sliver still fits beside the tall item in row 1.
    const items = [
      makeItem(1, 0, 0, 20, 6),
      makeItem(2, 0, 0, 4, 4),
      makeItem(3, 0, 0, 4, 4),
      makeItem(4, 0, 0, 2, 1),
    ];
    const result = arrangeInitialLayout(items, SHEET_W, GAP, MARGIN);
    const sliver = result.find((i) => i.id === 4)!;
    expect(sliver.posY).toBeCloseTo(MARGIN, 5); // joined row 1, not row 3
    for (let i = 0; i < result.length; i++)
      for (let j = i + 1; j < result.length; j++)
        expect(overlaps(result[i], result[j])).toBe(false);
  });
});

describe("computeEffectiveDpi", () => {
  it("uses widthIn for unrotated items", () => {
    expect(
      computeEffectiveDpi({ widthIn: 4, heightIn: 2, rotation: 0, nativeWidthPx: 1200 }),
    ).toBe(300);
  });

  it("measures against the swapped axis after a 90° rotation (no false low-DPI)", () => {
    // 1200×600 px image at 300 DPI → 4in × 2in. After rotate: widthIn=2, heightIn=4.
    // Pixel width (1200) still describes the image's own width axis, now shown
    // along heightIn — DPI must still read 300, not 1200/2 = 600 or a false low value.
    expect(
      computeEffectiveDpi({ widthIn: 2, heightIn: 4, rotation: 90, nativeWidthPx: 1200 }),
    ).toBe(300);
    expect(
      computeEffectiveDpi({ widthIn: 4, heightIn: 2, rotation: 180, nativeWidthPx: 1200 }),
    ).toBe(300);
    expect(
      computeEffectiveDpi({ widthIn: 2, heightIn: 4, rotation: 270, nativeWidthPx: 1200 }),
    ).toBe(300);
  });

  it("falls back to the stored dpi snapshot when no pixel data exists", () => {
    expect(computeEffectiveDpi({ widthIn: 4, dpi: 150 })).toBe(150);
    expect(computeEffectiveDpi({ widthIn: 4 })).toBeNull();
  });
});

describe("calculateGridLayout group-cell packing", () => {
  const sheetBottom = (items: LayoutItem[]) =>
    Math.max(...items.map((it) => {
      const fp = getItemFootprint(it, SHEET_W, MARGIN, GAP);
      return fp.y + fp.h;
    }));

  it("never produces a taller sheet with auto-nest on than off", () => {
    const items: LayoutItem[] = [
      makeItem(1, 0, 0, 4, 4, { copies: 4 }),
      makeItem(2, 0, 0, 3, 3),
      makeItem(3, 0, 0, 2, 2, { copies: 2 }),
      makeItem(4, 0, 0, 6, 5),
    ];
    const off = calculateGridLayout(items, SHEET_W, GAP, false, MARGIN);
    const on = calculateGridLayout(items, SHEET_W, GAP, true, MARGIN);
    expect(sheetBottom(on)).toBeLessThanOrEqual(sheetBottom(off) + 1e-6);
  });
});

describe("packing into a group's trailing cells", () => {
  it("places a later design into the empty cell of a short last row", () => {
    // 9 copies at 5 cols → row 1 holds 4, leaving col 4 empty. That cell is
    // real space: a design small enough must be packed INTO it rather than
    // opening a new row below the group.
    const items: LayoutItem[] = [
      makeItem(1, 0, 0, 3.2, 3.2, { copies: 9 }),
      makeItem(2, 0, 0, 3.0, 2.4),
    ];
    const out = calculateGridLayout(items, SHEET_W, GAP, true, MARGIN);
    const group = out.find((i) => i.id === 1)!;
    const filler = out.find((i) => i.id === 2)!;
    const cellStride = 3.2 + GAP;
    expect(group.flowCols).toBe(5);
    expect(filler.posX).toBeCloseTo(MARGIN + 4 * cellStride, 4);
    expect(filler.posY).toBeCloseTo(MARGIN + cellStride, 4);
  });

  it("does not abandon the strip beside a group to fill a cell inside it", () => {
    // The regression from filling holes as a post-pass: a design was pulled out
    // of the free strip beside the group and into a cell within it, turning a
    // small gap into a much larger one. Every design here must stay on-sheet
    // above the group's own bottom.
    const items: LayoutItem[] = [
      makeItem(1, 0, 0, 3.2, 3.2, { copies: 9 }),
      makeItem(2, 0, 0, 3.0, 2.4),
      makeItem(3, 0, 0, 3.0, 2.4),
      makeItem(4, 0, 0, 2.6, 2.0),
    ];
    const out = calculateGridLayout(items, SHEET_W, GAP, true, MARGIN);
    const groupBottom = getItemFootprint(out.find((i) => i.id === 1)!, SHEET_W, MARGIN, GAP);
    for (const id of [2, 3, 4]) {
      const fp = getItemFootprint(out.find((i) => i.id === id)!, SHEET_W, MARGIN, GAP);
      expect(fp.y + fp.h).toBeLessThanOrEqual(groupBottom.y + groupBottom.h + 1e-6);
    }
  });

  it("keeps a full grid's reservation intact (no phantom free cell)", () => {
    // 14 copies fills a 7-column grid exactly — there is NO trailing cell, so
    // the group's reservation is its whole bounding box and nothing may be
    // packed inside it. Guards the split reservation against over-reporting
    // free space on grids that happen to come out exactly full.
    const items: LayoutItem[] = [
      makeItem(1, 0, 0, 3.2, 3.2, { copies: 14 }),
      makeItem(2, 0, 0, 3.0, 2.4),
    ];
    const out = calculateGridLayout(items, SHEET_W, GAP, true, MARGIN);
    const group = out.find((i) => i.id === 1)!;
    // Premise check: a hole here would make the overlap assertion meaningless.
    expect(14 % group.flowCols!).toBe(0);
    const g = getItemFootprint(group, SHEET_W, MARGIN, GAP);
    const f = getItemFootprint(out.find((i) => i.id === 2)!, SHEET_W, MARGIN, GAP);
    const overlapping =
      f.x < g.x + g.w && f.x + f.w > g.x && f.y < g.y + g.h && f.y + f.h > g.y;
    expect(overlapping).toBe(false);
  });
});
