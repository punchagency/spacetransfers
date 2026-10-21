/**
 * Sheet previews are for looking at, so they are drawn small.
 * Run with: npm test — no network, no database.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PREVIEW_DPI, needsRedraw } from "../services/orderPreview.service.js";

describe("sheet previews", () => {
  it("are drawn at preview size, far below print resolution", () => {
    assert.ok(PREVIEW_DPI <= 72);
    assert.ok(Math.round(23.5 * PREVIEW_DPI) >= 1000, "still sharp across a roll at full width");
  });

  it("are re-drawn only when stored bigger than that, and only our own files", () => {
    assert.equal(needsRedraw("/uploads/exports/printers/order-preview/o1/gangsheet_o1_600dpi_abc.webp"), true);
    assert.equal(needsRedraw("/uploads/exports/printers/order-preview/o1/gangsheet_o1_37dpi_abc.webp"), false);
    assert.equal(needsRedraw(`/uploads/exports/printers/order-preview/o1/gangsheet_o1_${PREVIEW_DPI}dpi_abc.webp`), false);
    assert.equal(needsRedraw("https://cdn.example/preview.png"), false);
    assert.equal(needsRedraw(null), false);
  });

  it("catches long sheets saved lossless below the preview DPI by their weight", () => {
    const long = "/uploads/exports/printers/order-preview/o1/gangsheet_o1_37dpi_abc.webp";
    assert.equal(needsRedraw(long, 11_900_000), true);
    assert.equal(needsRedraw(long, 400_000), false);
  });
});
