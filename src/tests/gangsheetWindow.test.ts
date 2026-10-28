import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeItemVerticalSpansIn, placementReachesWindowIn, slots } from "../services/gangsheetExport.service.js";

/**
 * Which artwork one part of a split sheet loads.
 *
 * A part only draws what reaches its window, so the rest is not loaded. Ruling
 * out a placement that has a copy inside would leave a hole in the print file,
 * so these pin the rule against the same copy geometry the cut lines use.
 */

const SHEET = { sheetWidthIn: 23.5, itemSpacingIn: 0.25, sheetMarginIn: 0.25 };
const windowAt = (topIn: number, heightIn: number) => ({ leftIn: 0, topIn, widthIn: 23.5, heightIn });
const piece = (posY: number, extra: Record<string, unknown> = {}) => ({ widthIn: 4, heightIn: 3, posX: 1, posY, ...extra });

describe("which placements reach a window", () => {
  it("one inside, or crossing its edge, reaches it", () => {
    assert.equal(placementReachesWindowIn(piece(150), windowAt(100, 100), SHEET), true);
    assert.equal(placementReachesWindowIn(piece(98.5), windowAt(100, 100), SHEET), true, "crosses the top edge");
    assert.equal(placementReachesWindowIn(piece(199), windowAt(100, 100), SHEET), true, "crosses the bottom edge");
  });

  it("one well clear of it doesn't", () => {
    assert.equal(placementReachesWindowIn(piece(10), windowAt(100, 100), SHEET), false);
    assert.equal(placementReachesWindowIn(piece(300), windowAt(100, 100), SHEET), false);
  });

  it("allows an inch for rounding to whole pixels", () => {
    assert.equal(placementReachesWindowIn(piece(96.5), windowAt(100, 100), SHEET), true, "ends half an inch above");
    assert.equal(placementReachesWindowIn(piece(95), windowAt(100, 100), SHEET), false, "ends two inches above");
  });

  it("counts every copy, not just the first", () => {
    // 60 copies in 4 columns wrap into 15 rows of 3.25in: the first is far above, the last inside.
    const wrapped = piece(60, { copies: 60, flowCols: 4 });
    assert.equal(placementReachesWindowIn(wrapped, windowAt(100, 100), SHEET), true);
  });

  it("uses the drawn size of a rotated piece", () => {
    // A 10in × 1in strip turned 30° is drawn about 5.9in tall around its cell's
    // centre, so it reaches nearly 3in below a cell that ends at 97in.
    const turned = { widthIn: 10, heightIn: 1, posX: 1, posY: 96, rotation: 30 };
    assert.equal(placementReachesWindowIn(turned, windowAt(100, 100), SHEET), true);
    assert.equal(placementReachesWindowIn({ ...turned, rotation: 0 }, windowAt(100, 100), SHEET), false);
  });

  it("agrees with the cut geometry: any copy span inside a window means its placement reaches it", () => {
    const items = Array.from({ length: 40 }, (_, i) =>
      piece(i * 9.7, { copies: 1 + (i % 7), rotation: (i * 37) % 360, posX: (i * 3.1) % 18, nestRotation: i % 5 === 0 ? 90 : null }),
    );
    for (const w of [windowAt(0, 100), windowAt(100, 100), windowAt(200, 100), windowAt(300, 120)]) {
      for (const it of items) {
        const spans = computeItemVerticalSpansIn({ ...SHEET, artboardItems: [it] });
        const inside = spans.some((s) => s.bottomIn > w.topIn && s.topIn < w.topIn + w.heightIn);
        if (inside) assert.equal(placementReachesWindowIn(it, w, SHEET), true, JSON.stringify({ it, w }));
      }
    }
  });
});

describe("render slots", () => {
  it("lets `max` through at once and the rest in the order they asked", async () => {
    const limit = slots(1);
    const order: string[] = [];
    await limit.acquire();
    const b = limit.acquire().then(() => order.push("b"));
    const c = limit.acquire().then(() => order.push("c"));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(order, [], "both wait while the slot is held");
    limit.release();
    await b;
    assert.deepEqual(order, ["b"]);
    limit.release();
    await c;
    assert.deepEqual(order, ["b", "c"]);
    limit.release();
  });

  it("never holds more than `max`", async () => {
    const limit = slots(3);
    let held = 0;
    let most = 0;
    await Promise.all(
      Array.from({ length: 10 }, async () => {
        await limit.acquire();
        held++;
        most = Math.max(most, held);
        await new Promise((r) => setTimeout(r, 2));
        held--;
        limit.release();
      }),
    );
    assert.equal(most, 3);
  });
});
