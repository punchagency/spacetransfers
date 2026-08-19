import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GANGSHEET_SHEET_WIDTH_IN,
  GANGSHEET_PRINT_DPI,
  toPrintPixels,
  resolveRenderDpi,
  computeItemVerticalSpansIn,
  computeGangsheetCuts,
} from "../services/gangsheetExport.service.js";

/**
 * The physical-to-pixel contract for a printed gang sheet.
 *
 * The bug these cover: the sheet's pixel width is supposed to be a pure
 * function of its physical width and the print DPI, and it stopped being one in
 * two separate places — a canvas sized from the artwork's bounding box instead
 * of the sheet, and a memory cap that quietly lowered DPI on long rolls.
 */

const TARGET_LENGTH_IN = 100;

describe("print dimensions", () => {
  it("is a 23.5in sheet at 300 DPI", () => {
    assert.equal(GANGSHEET_SHEET_WIDTH_IN, 23.5);
    assert.equal(GANGSHEET_PRINT_DPI, 300);
  });

  it("renders 23.5in as exactly 7050px", () => {
    assert.equal(toPrintPixels(GANGSHEET_SHEET_WIDTH_IN, GANGSHEET_PRINT_DPI), 7050);
  });

  it("converts every physical dimension by the same rule", () => {
    assert.equal(toPrintPixels(10, 300), 3000);
    assert.equal(toPrintPixels(20, 300), 6000);
    assert.equal(toPrintPixels(1, 300), 300);
  });

  it("keeps full resolution for a sheet that fits one canvas", () => {
    // 23.5" x 100" at 300 DPI is ~846 MB of RGBA — inside the ceiling.
    const dpi = resolveRenderDpi({
      widthIn: GANGSHEET_SHEET_WIDTH_IN,
      heightIn: TARGET_LENGTH_IN,
      requestedDpi: GANGSHEET_PRINT_DPI,
    });
    assert.equal(dpi, GANGSHEET_PRINT_DPI);
    assert.equal(toPrintPixels(GANGSHEET_SHEET_WIDTH_IN, dpi), 7050);
  });

  it("cannot render a whole 1200in roll at print DPI — which is why bands exist", () => {
    // Documents the constraint the band renderer works around. If this ever
    // stops being capped, the band split is no longer load-bearing.
    const dpi = resolveRenderDpi({
      widthIn: GANGSHEET_SHEET_WIDTH_IN,
      heightIn: 1200,
      requestedDpi: GANGSHEET_PRINT_DPI,
    });
    assert.ok(dpi < GANGSHEET_PRINT_DPI, `expected a cap, got ${dpi}`);
    assert.ok(
      toPrintPixels(GANGSHEET_SHEET_WIDTH_IN, dpi) < 7050,
      "a capped whole-roll render is exactly the wrong-width bug",
    );
  });

  it("gives every band of a very long sheet the full 7050px width", () => {
    // The property that matters: however long the sheet, each part printed is
    // 23.5in wide at 300 DPI.
    const spans = computeItemVerticalSpansIn({
      sheetWidthIn: GANGSHEET_SHEET_WIDTH_IN,
      artboardItems: Array.from({ length: 60 }, (_, i) => ({
        widthIn: 4,
        heightIn: 6,
        posX: 1,
        posY: i * 20,
        copies: 1,
      })),
    });
    const cuts = computeGangsheetCuts({
      totalHeightIn: 1200,
      spans,
      targetLengthIn: TARGET_LENGTH_IN,
    });
    assert.ok(cuts.length > 1, "a 1200in sheet must split");

    for (const cut of cuts) {
      const bandHeightIn = cut.endIn - cut.startIn;
      const dpi = resolveRenderDpi({
        widthIn: GANGSHEET_SHEET_WIDTH_IN,
        heightIn: bandHeightIn,
        requestedDpi: GANGSHEET_PRINT_DPI,
      });
      assert.equal(dpi, GANGSHEET_PRINT_DPI, `band ${cut.startIn}-${cut.endIn} was downscaled`);
      assert.equal(toPrintPixels(GANGSHEET_SHEET_WIDTH_IN, dpi), 7050);
    }
  });

  it("tiles the sheet exactly — no row printed twice, none dropped", () => {
    const spans = computeItemVerticalSpansIn({
      sheetWidthIn: GANGSHEET_SHEET_WIDTH_IN,
      artboardItems: [
        { widthIn: 6, heightIn: 8, posX: 0.5, posY: 0, copies: 1 },
        // Straddles the 100in line, so the cut must move past it.
        { widthIn: 6, heightIn: 12, posX: 8, posY: 95, copies: 1 },
        { widthIn: 6, heightIn: 8, posX: 0.5, posY: 150, copies: 1 },
      ],
    });
    const totalHeightIn = 260;
    const cuts = computeGangsheetCuts({ totalHeightIn, spans, targetLengthIn: TARGET_LENGTH_IN });

    assert.equal(cuts[0].startIn, 0);
    assert.equal(cuts[cuts.length - 1].endIn, totalHeightIn);
    for (let i = 1; i < cuts.length; i++) {
      assert.equal(cuts[i].startIn, cuts[i - 1].endIn, "bands must be back-to-back");
    }

    const covered = cuts.reduce((sum, c) => sum + (c.endIn - c.startIn), 0);
    assert.ok(Math.abs(covered - totalHeightIn) < 1e-6, "bands must cover the sheet exactly");

    // No graphic may be split across a band boundary.
    for (const cut of cuts.slice(0, -1)) {
      for (const s of spans) {
        assert.ok(
          !(s.topIn < cut.endIn - 1e-6 && s.bottomIn > cut.endIn + 1e-6),
          `a graphic straddles the cut at ${cut.endIn}`,
        );
      }
    }
  });

  it("places a band's artwork at the same sheet coordinates, only offset", () => {
    // A band is an origin shift, not a re-layout: an item 150in down the sheet
    // sits 50in into the band that starts at 100in.
    const item = { widthIn: 4, heightIn: 6, posX: 7, posY: 150, copies: 1 };
    const [span] = computeItemVerticalSpansIn({
      sheetWidthIn: GANGSHEET_SHEET_WIDTH_IN,
      artboardItems: [item],
    });

    const bandTopIn = 100;
    assert.equal(span.topIn, 150);
    assert.equal(span.bottomIn, 156);
    assert.equal(toPrintPixels(span.topIn - bandTopIn, GANGSHEET_PRINT_DPI), 15000);
    // Horizontal position is untouched by banding.
    assert.equal(toPrintPixels(item.posX, GANGSHEET_PRINT_DPI), 2100);
  });
});
