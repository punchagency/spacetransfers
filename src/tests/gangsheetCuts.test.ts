import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeGangsheetCuts,
  computeItemVerticalSpansIn,
} from "../services/gangsheetExport.service.js";

/**
 * Gang sheet cutting.
 *
 * The rule the printer relies on: parts are cut at a 100in target, but a
 * graphic is never bisected — a piece straddling the line pushes the cut past
 * its own end. These tests pin both halves of that, plus the property that
 * makes the parts safe to print: they must tile the sheet exactly, so no
 * artwork is duplicated across a seam or dropped at one.
 */

const TARGET = 100;

/** Every part is back-to-back with its neighbour and the set covers the sheet. */
const assertTiles = (
  cuts: Array<{ startIn: number; endIn: number }>,
  totalHeightIn: number,
) => {
  assert.ok(cuts.length > 0, "expected at least one part");
  assert.equal(cuts[0].startIn, 0, "first part must start at the top");
  assert.ok(
    Math.abs(cuts[cuts.length - 1].endIn - totalHeightIn) < 1e-6,
    "last part must end at the bottom of the sheet",
  );
  for (let i = 1; i < cuts.length; i++) {
    assert.ok(
      Math.abs(cuts[i].startIn - cuts[i - 1].endIn) < 1e-6,
      `part ${i + 1} must begin exactly where part ${i} ended`,
    );
  }
  for (const c of cuts) assert.ok(c.endIn > c.startIn, "parts must be non-empty");
};

/** No cut line may fall strictly inside any graphic. */
const assertNoGraphicSplit = (
  cuts: Array<{ startIn: number; endIn: number }>,
  spans: Array<{ topIn: number; bottomIn: number }>,
) => {
  for (let i = 0; i < cuts.length - 1; i++) {
    const line = cuts[i].endIn;
    for (const s of spans) {
      assert.ok(
        !(s.topIn < line - 1e-6 && s.bottomIn > line + 1e-6),
        `cut at ${line}in slices the graphic spanning ${s.topIn}–${s.bottomIn}in`,
      );
    }
  }
};

describe("computeGangsheetCuts", () => {
  it("cuts on the target when nothing straddles the line", () => {
    // Graphics packed 0–99 and 100–199: the 100in line falls in a clean gap.
    const spans = [
      { topIn: 0, bottomIn: 99 },
      { topIn: 100, bottomIn: 199 },
    ];
    const cuts = computeGangsheetCuts({ totalHeightIn: 199, spans, targetLengthIn: TARGET });

    assert.equal(cuts.length, 2);
    assert.equal(cuts[0].endIn, 100);
    assertTiles(cuts, 199);
    assertNoGraphicSplit(cuts, spans);
  });

  it("extends the cut past a graphic that crosses the target", () => {
    // A 12in graphic sits across the 100in mark (96 → 108).
    const spans = [{ topIn: 96, bottomIn: 108 }];
    const cuts = computeGangsheetCuts({ totalHeightIn: 200, spans, targetLengthIn: TARGET });

    // Part one runs long — to 108 — so the piece is emitted whole.
    assert.equal(cuts[0].endIn, 108);
    assertTiles(cuts, 200);
    assertNoGraphicSplit(cuts, spans);
  });

  it("keeps extending when moving the cut lands inside a further graphic", () => {
    // Overlapping chain across the boundary: 98–104, 103–110, 109–115.
    const spans = [
      { topIn: 98, bottomIn: 104 },
      { topIn: 103, bottomIn: 110 },
      { topIn: 109, bottomIn: 115 },
    ];
    const cuts = computeGangsheetCuts({ totalHeightIn: 300, spans, targetLengthIn: TARGET });

    assert.equal(cuts[0].endIn, 115, "cut must clear the whole overlapping chain");
    assertTiles(cuts, 300);
    assertNoGraphicSplit(cuts, spans);
  });

  it("does not move a cut for a graphic that merely ends on the line", () => {
    // Ends exactly at 100 — already whole above the cut, so the target holds.
    const spans = [{ topIn: 90, bottomIn: 100 }];
    const cuts = computeGangsheetCuts({ totalHeightIn: 180, spans, targetLengthIn: TARGET });
    assert.equal(cuts[0].endIn, 100);
    assertNoGraphicSplit(cuts, spans);
  });

  it("emits one part when the sheet is shorter than the target", () => {
    const spans = [{ topIn: 0, bottomIn: 40 }];
    const cuts = computeGangsheetCuts({ totalHeightIn: 60, spans, targetLengthIn: TARGET });
    assert.deepEqual(cuts, [{ startIn: 0, endIn: 60 }]);
  });

  it("handles a single graphic longer than the target without splitting it", () => {
    // 250in graphic: the part has to run the whole way rather than cut it.
    const spans = [{ topIn: 0, bottomIn: 250 }];
    const cuts = computeGangsheetCuts({ totalHeightIn: 250, spans, targetLengthIn: TARGET });
    assert.equal(cuts.length, 1);
    assertTiles(cuts, 250);
    assertNoGraphicSplit(cuts, spans);
  });

  it("tiles a long sheet of many graphics with no split and no gaps", () => {
    // 400 graphics of 2in stacked with a 0.5in gap → 1000in of sheet.
    const spans = Array.from({ length: 400 }, (_, i) => ({
      topIn: i * 2.5,
      bottomIn: i * 2.5 + 2,
    }));
    const total = 400 * 2.5;
    const cuts = computeGangsheetCuts({ totalHeightIn: total, spans, targetLengthIn: TARGET });

    assertTiles(cuts, total);
    assertNoGraphicSplit(cuts, spans);
    // Each part should still be close to the 100in target, not wildly over.
    for (const c of cuts) assert.ok(c.endIn - c.startIn <= TARGET + 2.5);
  });

  it("returns nothing for a zero-height sheet", () => {
    assert.deepEqual(
      computeGangsheetCuts({ totalHeightIn: 0, spans: [], targetLengthIn: TARGET }),
      [],
    );
  });
});

describe("computeItemVerticalSpansIn", () => {
  it("reports one span per copy, wrapped into columns like the renderer", () => {
    // 4 copies of a 10in-wide item on a 23.5in sheet: 2 per row → 2 rows.
    const spans = computeItemVerticalSpansIn({
      sheetWidthIn: 23.5,
      artboardItems: [
        { widthIn: 10, heightIn: 5, posX: 0, posY: 0, copies: 4 },
      ],
      itemSpacingIn: 0.5,
      sheetMarginIn: 0,
    });

    assert.equal(spans.length, 4);
    const tops = [...new Set(spans.map((s) => Number(s.topIn.toFixed(4))))].sort((a, b) => a - b);
    assert.deepEqual(tops, [0, 5.5], "second row starts one height + gap down");
  });

  it("accounts for rotation widening an item's vertical footprint", () => {
    const upright = computeItemVerticalSpansIn({
      sheetWidthIn: 23.5,
      artboardItems: [{ widthIn: 10, heightIn: 2, posX: 0, posY: 0, copies: 1 }],
    });
    const turned = computeItemVerticalSpansIn({
      sheetWidthIn: 23.5,
      artboardItems: [{ widthIn: 10, heightIn: 2, posX: 0, posY: 0, rotation: 90, copies: 1 }],
    });

    const height = (s: Array<{ topIn: number; bottomIn: number }>) => s[0].bottomIn - s[0].topIn;
    assert.ok(Math.abs(height(upright) - 2) < 1e-6);
    // Rotated 90°, the 10in dimension is now the vertical one.
    assert.ok(Math.abs(height(turned) - 10) < 1e-6);
  });

  it("skips items with no usable dimensions", () => {
    const spans = computeItemVerticalSpansIn({
      sheetWidthIn: 23.5,
      artboardItems: [
        { widthIn: 0, heightIn: 5, posX: 0, posY: 0, copies: 2 },
        { widthIn: 5, heightIn: 5, posX: 0, posY: 0, copies: 1 },
      ],
    });
    assert.equal(spans.length, 1);
  });
});
