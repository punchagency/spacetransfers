import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { orderSheets, pickOrderSheet, sheetContents, sheetSummaries } from "../utils/orderSheets.js";

const twoSheets = [
  { type: "gangsheet", name: "ice water", widthIn: 23.5, heightIn: 19.21, quantity: 1, artboardItems: [{ assetId: "a" }, { assetId: "b" }], previewImage: "/uploads/a.webp" },
  { type: "gangsheet", name: "Untitled gang sheet 4", widthIn: 23.5, heightIn: 12, quantity: 2, artboardItems: [{ assetId: "c", widthIn: 2.67, heightIn: 2 }] },
];

describe("order sheets", () => {
  it("lists every sheet, not only the first", () => {
    assert.equal(orderSheets(twoSheets).length, 2);
    const summaries = sheetSummaries(twoSheets);
    assert.deepEqual(summaries.map((s) => [s.index, s.name, s.quantity, s.itemCount, s.previewImage]), [
      [0, "ice water", 1, 2, "/uploads/a.webp"],
      [1, "Untitled gang sheet 4", 2, 1, null],
    ]);
  });

  it("picks the requested sheet, the first when none is named", () => {
    assert.equal(pickOrderSheet(twoSheets, undefined).sheet.name, "ice water");
    assert.equal(pickOrderSheet(twoSheets, "1").sheet.name, "Untitled gang sheet 4");
    assert.deepEqual(
      (({ index, count }) => ({ index, count }))(pickOrderSheet(twoSheets, 1)),
      { index: 1, count: 2 },
    );
  });

  it("refuses a sheet the order doesn't have instead of printing another", () => {
    for (const bad of ["2", "-1", "1.5", "abc"]) {
      assert.throws(() => pickOrderSheet(twoSheets, bad), (e: any) => e.statusCode === 400, bad);
    }
  });

  it("treats an untyped legacy order's first item as its sheet", () => {
    assert.equal(orderSheets([{ name: "old" }, { name: "other" }]).length, 1);
  });

  it("lists a sheet's graphics in the admin's row shape", () => {
    assert.deepEqual(sheetContents(twoSheets[1].artboardItems)[0].size, '2.67" × 2.00"');
  });
});
