import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_ROLL_WIDTH_IN, MIN_ROLL_WIDTH_IN, rollWidthError } from "../services/pricing.service.js";
import { orderSheetWidthIn, printedSheetExtentIn, printedSheetLengthIn } from "../services/gangsheetExport.service.js";

/**
 * The roll width is one number: the admin setting, which the artboard lays out
 * on, billing charges for, and every render prints at. An order records the
 * width it was built on, so a later change to the setting cannot move its print.
 */

describe("roll width", () => {
  it("renders an order at the width it was built on", () => {
    assert.equal(orderSheetWidthIn({ rollWidthIn: 22 }), 22);
    assert.equal(orderSheetWidthIn({ rollWidthIn: 30 }), 30);
  });

  it("renders orders from before the width was recorded at 23.5in", () => {
    for (const item of [undefined, null, {}, { rollWidthIn: null }, { rollWidthIn: 0 }, { rollWidthIn: "abc" }]) {
      assert.equal(orderSheetWidthIn(item as any), 23.5);
    }
  });

  it("wraps copies to the roll they were built on", () => {
    // Four 5in copies with no recorded columns: a 22in roll fits three across
    // (5 + 0.25 + 5 + 0.25 + 5 = 15.5, a fourth needs 20.75 of 21.7), a 12in roll two.
    const item = { widthIn: 5, heightIn: 5, posX: 0.15, posY: 0.15, copies: 4 };
    const on = (rollWidthIn: number) =>
      printedSheetLengthIn({ sheetWidthIn: rollWidthIn, artboardItems: [item], itemSpacingIn: 0.25, sheetMarginIn: 0.15 });
    assert.ok(Math.abs(on(22) - 5.15) < 1e-6, `22in roll: ${on(22)}`);
    assert.ok(Math.abs(on(12) - (0.15 + 5 + 0.25 + 5)) < 1e-6, `12in roll: ${on(12)}`);
  });

  it("measures how far across the roll the artwork reaches", () => {
    const sheet = (items: any[]) =>
      printedSheetExtentIn({ sheetWidthIn: 23.5, artboardItems: items, itemSpacingIn: 0.25, sheetMarginIn: 0.15 });
    // A 20x11.25in piece pinned at 11.16in — the overflow reported from the editor.
    assert.ok(Math.abs(sheet([{ widthIn: 20, heightIn: 11.25, posX: 11.16, posY: 0.15 }]).right - 31.16) < 1e-6);
    // The same piece moved inside the printable width.
    assert.ok(sheet([{ widthIn: 20, heightIn: 11.25, posX: 3.35, posY: 0.15 }]).right <= 23.35 + 1e-6);
    // A nested (quarter-turned) piece is measured by its turned footprint.
    assert.ok(Math.abs(sheet([{ widthIn: 20, heightIn: 11.25, posX: 0.15, posY: 0.15, nestRotation: 90 }]).right - 11.4) < 1e-6);
  });

  it("refuses a roll width no printer has", () => {
    for (const bad of [0, -1, 5.9, 64.1, 235, "", "wide", null, undefined, NaN]) {
      assert.ok(rollWidthError(bad), `${String(bad)} should be refused`);
    }
    for (const good of [MIN_ROLL_WIDTH_IN, 13, 22, 23.5, 24, 44, MAX_ROLL_WIDTH_IN, "23.5"]) {
      assert.equal(rollWidthError(good), null, `${String(good)} should be accepted`);
    }
  });
});
